import { supabase } from '../connection.js';

const MIN_PASSWORD_LENGTH = 8;
const THEME_KEY = 'theme';

const FARMER_NAVIGATION_PERMISSIONS = {
    'farmer-dashboard.html': 'dashboard.view',
    'activities.html': 'activities.view',
    'plantings.html': 'plantings.view',
    'recommendations.html': 'recommendations.view',
    'harvest-records.html': 'harvest_records.view'
};

/* ---------- Elements ---------- */
const settingsRoot = document.getElementById('settingsRoot');
const farmerNameElement = document.getElementById('farmerName');
const farmerAvatarElement = document.getElementById('farmerAvatar');
const logoutButton = document.getElementById('logoutButton');
const logoutLabel = document.getElementById('logoutLabel');
const todayLabel = document.getElementById('todayLabel');

/* ---------- State ---------- */
let currentUser = null;
let currentProfile = null;
let themeSwitch = null;

const permissionCache = new Map();

/* ---------- Small UI helpers ---------- */

/** Build a DOM element: h('div', { class: 'x', onclick }, child, child). */
function h(tag, attrs = {}, ...children) {
    const element = document.createElement(tag);

    for (const [key, value] of Object.entries(attrs || {})) {
        if (value === null || value === undefined || value === false) continue;

        if (key === 'class') {
            element.className = value;
        } else if (key.startsWith('on') && typeof value === 'function') {
            element.addEventListener(key.slice(2), value);
        } else {
            element.setAttribute(key, value === true ? '' : value);
        }
    }

    children.flat().forEach(child => {
        if (child === null || child === undefined || child === false || child === '') {
            return;
        }

        element.append(
            child instanceof Node ? child : document.createTextNode(String(child))
        );
    });

    return element;
}

/** Small message that disappears after a few seconds. */
function toast(message) {
    let region = document.getElementById('farmerToastRegion');

    if (!region) {
        region = h('div', {
            class: 'farmer-toast-region',
            id: 'farmerToastRegion',
            'aria-live': 'polite'
        });

        document.body.append(region);
    }

    const item = h('div', { class: 'farmer-toast' }, message);

    region.append(item);

    setTimeout(() => item.remove(), 3200);
}

/* ---------- Theme ---------- */

function readSavedTheme() {
    try {
        return (
            localStorage.getItem(THEME_KEY) ||
            localStorage.getItem('tanikala-theme')
        );
    } catch {
        return null;
    }
}

function applyTheme(theme) {
    const next = theme === 'dark' ? 'dark' : 'light';

    document.documentElement.setAttribute('data-theme', next);

    // Keep the Appearance switch in sync with the topbar toggle.
    if (themeSwitch) themeSwitch.checked = next === 'dark';
}

(function initializeTheme() {
    applyTheme(readSavedTheme());

    const toggle = document.getElementById('themeToggle');

    toggle?.addEventListener('click', event => {
        event.stopImmediatePropagation();

        const next =
            document.documentElement.getAttribute('data-theme') === 'dark'
                ? 'light'
                : 'dark';

        applyTheme(next);

        try {
            localStorage.setItem(THEME_KEY, next);
        } catch {
            // Ignore blocked storage.
        }
    });

    window.addEventListener('storage', event => {
        if (event.key === THEME_KEY && event.newValue) {
            applyTheme(event.newValue);
        }
    });
})();

/* ---------- Permissions (sidebar only) ---------- */

async function hasPermission(permissionKey) {
    if (permissionCache.has(permissionKey)) {
        return permissionCache.get(permissionKey);
    }

    try {
        const { data, error } = await supabase.rpc(
            'has_tanikala_permission',
            { p_permission_key: permissionKey }
        );

        if (error) throw error;

        const allowed = data === true;
        permissionCache.set(permissionKey, allowed);

        return allowed;

    } catch (error) {
        console.error(`Permission check failed (${permissionKey}):`, error);

        permissionCache.set(permissionKey, false);
        return false;
    }
}

/**
 * Hides sidebar links the Farmer is not allowed to open.
 * Settings is an account page, so it needs no permission of its own.
 */
async function applyNavigationPermissions() {
    const entries = Object.entries(FARMER_NAVIGATION_PERMISSIONS);

    const results = await Promise.all(
        entries.map(async ([page, permissionKey]) => ({
            page,
            allowed: await hasPermission(permissionKey)
        }))
    );

    const permissionMap = new Map(
        results.map(result => [result.page, result.allowed])
    );

    document.querySelectorAll(
        '.navigation a.nav-link[href], ' +
        '.quick-access a.access-card[href]'
    ).forEach(link => {
        const href = link.getAttribute('href');

        if (!href) return;

        let page;

        try {
            page = new URL(href, window.location.href)
                .pathname
                .split('/')
                .pop()
                .toLowerCase();
        } catch {
            return;
        }

        if (!Object.hasOwn(FARMER_NAVIGATION_PERMISSIONS, page)) return;

        const allowed = permissionMap.get(page) === true;

        link.hidden = !allowed;
        link.style.display = allowed ? '' : 'none';

        if (allowed) {
            link.removeAttribute('aria-hidden');
            link.removeAttribute('tabindex');
        } else {
            link.setAttribute('aria-hidden', 'true');
            link.setAttribute('tabindex', '-1');
        }
    });
}

/* ---------- Data ---------- */

function getFarmerDisplayName(user) {
    return (
        user.user_metadata?.full_name ||
        user.user_metadata?.fullName ||
        user.email?.split('@')[0] ||
        'Farmer'
    );
}

/** Verify the signed-in user is an active Farmer. */
async function validateFarmerSession() {
    const {
        data: { user },
        error: authError
    } = await supabase.auth.getUser();

    if (authError || !user) {
        window.location.replace('../../login.html');
        return false;
    }

    const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, role, status')
        .eq('id', user.id)
        .maybeSingle();

    if (profileError) {
        console.error('Profile loading error:', profileError);
        throw new Error('Unable to verify your Farmer account.');
    }

    if (
        !profile ||
        profile.role !== 'farmer' ||
        !['active', 'approved'].includes(
            String(profile.status || '').toLowerCase()
        )
    ) {
        await supabase.auth.signOut();
        window.location.replace('../../login.html');
        return false;
    }

    currentUser = user;
    currentProfile = profile;

    const name = getFarmerDisplayName(user);

    if (farmerNameElement) farmerNameElement.textContent = name;

    if (farmerAvatarElement) {
        farmerAvatarElement.textContent = name.trim().charAt(0).toUpperCase();
    }

    return true;
}

/** Best-effort lookup of the farms linked to this Farmer's activities. */
async function loadFarms() {
    try {
        const { data: actions, error } = await supabase
            .from('farm_actions')
            .select('farm_id')
            .eq('farmer_id', currentUser.id)
            .not('farm_id', 'is', null);

        if (error) throw error;

        const farmIds = [
            ...new Set((actions || []).map(action => action.farm_id))
        ];

        if (!farmIds.length) return [];

        const { data: farms, error: farmError } = await supabase
            .from('farmer_farms')
            .select('id, farm_name, farm_location')
            .in('id', farmIds);

        if (farmError) throw farmError;

        return farms || [];

    } catch (error) {
        console.error('Failed to load farms:', error);
        return [];
    }
}

/** Read the current Supabase Auth email and account timestamps. */
async function loadAccount() {
    const {
        data: { user },
        error
    } = await supabase.auth.getUser();

    if (error) throw error;

    return {
        name: getFarmerDisplayName(user),
        email: user?.email || '',
        createdAt: user?.created_at || '',
        lastSignIn: user?.last_sign_in_at || '',
        status: String(currentProfile?.status || '').toLowerCase()
    };
}

/* ---------- Helpers ---------- */
const initials = (name) =>
    (name || 'F')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0].toUpperCase())
        .join('');

const formatDay = (value) => {
    const date = new Date(value);

    return value && !Number.isNaN(date.getTime())
        ? date.toLocaleDateString('en-PH', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        })
        : '';
};

const formatDateTime = (value) => {
    const date = new Date(value);

    return value && !Number.isNaN(date.getTime())
        ? date.toLocaleString('en-PH', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        })
        : '';
};

// Advisory only: it never blocks saving a password that meets the minimum.
/** Calculate the advisory password meter score and presentation values. */
function passwordStrength(password) {
    const points = [
        password.length >= MIN_PASSWORD_LENGTH,
        password.length >= 12,
        /[a-z]/.test(password) && /[A-Z]/.test(password),
        /\d/.test(password),
        /[^A-Za-z0-9]/.test(password)
    ].filter(Boolean).length;

    if (points <= 1) return { label: 'Weak', color: 'var(--error)', percent: 25 };
    if (points <= 3) return { label: 'Fair', color: 'var(--warning)', percent: 55 };
    if (points === 4) return { label: 'Good', color: 'var(--success)', percent: 80 };

    return { label: 'Strong', color: 'var(--success)', percent: 100 };
}

const field = (label, value) =>
    h(
        'div',
        { class: 'farmer-settings-field' },
        h('small', {}, label),
        h('b', {}, value || 'Not set')
    );

const panelHeader = (title, subtitle, extra = '') =>
    h(
        'div',
        { class: 'farmer-settings-panel-header' },
        h('div', {}, h('h3', {}, title), h('p', {}, subtitle)),
        extra
    );

/* ---------- Panels ---------- */
function profilePanel(account, farms) {
    const name = account.name?.trim() || 'Farmer';
    const isActive = ['active', 'approved'].includes(account.status);

    const farmNames = farms.map(farm => farm.farm_name).filter(Boolean).join(', ');
    const farmLocations = farms.map(farm => farm.farm_location).filter(Boolean).join(', ');

    const copyEmail = account.email
        ? h(
            'button',
            {
                class: 'farmer-button farmer-button-secondary',
                type: 'button',
                onclick: async () => {
                    try {
                        await navigator.clipboard.writeText(account.email);
                        toast('Email copied.');
                    } catch (err) {
                        console.error('Copy failed:', err);
                        toast('Could not copy the email.');
                    }
                }
            },
            'Copy email'
        )
        : '';

    return h(
        'section',
        { class: 'farmer-settings-panel' },
        panelHeader(
            'Profile',
            'Your account details',
            h('span', { class: 'farmer-pill' }, 'Farmer')
        ),
        h(
            'div',
            { class: 'farmer-profile-head' },
            h('span', { class: 'farmer-profile-avatar' }, initials(name)),
            h(
                'div',
                { class: 'farmer-profile-main' },
                h('b', {}, name),
                h('small', {}, account.email || 'No email on file')
            ),
            copyEmail
        ),
        h(
            'div',
            { class: 'farmer-settings-fields' },
            field('Full name', name),
            field('Email', account.email),
            field('Role', 'Farmer'),
            field('Account status', isActive ? 'Active' : 'Inactive'),
            field('Farm', farmNames),
            field('Farm location', farmLocations),
            field('Member since', formatDay(account.createdAt)),
            field('Last sign-in', formatDateTime(account.lastSignIn))
        )
    );
}

function appearancePanel() {
    const toggle = h('input', {
        type: 'checkbox',
        'aria-label': 'Dark mode'
    });

    toggle.checked =
        document.documentElement.getAttribute('data-theme') === 'dark';

    toggle.addEventListener('change', () => {
        const next = toggle.checked ? 'dark' : 'light';

        applyTheme(next);

        try {
            localStorage.setItem(THEME_KEY, next);
        } catch {
            // Ignore blocked storage.
        }
    });

    themeSwitch = toggle;

    return h(
        'section',
        { class: 'farmer-settings-panel' },
        panelHeader('Appearance', 'Choose how the dashboard looks'),
        h(
            'ul',
            { class: 'farmer-settings-list' },
            h(
                'li',
                {},
                h(
                    'div',
                    {},
                    h('p', {}, 'Dark mode'),
                    h('small', {}, 'Use a darker theme that is easier on the eyes.')
                ),
                h('label', { class: 'farmer-switch' }, toggle, h('span'))
            )
        )
    );
}

function securityPanel() {
    const message = h('p', { class: 'farmer-settings-msg error' });
    message.hidden = true;

    const newPassword = h('input', {
        class: 'farmer-form-input',
        id: 'farmerNewPassword',
        type: 'password',
        autocomplete: 'new-password',
        placeholder: `At least ${MIN_PASSWORD_LENGTH} characters`
    });

    const confirmPassword = h('input', {
        class: 'farmer-form-input',
        id: 'farmerConfirmPassword',
        type: 'password',
        autocomplete: 'new-password',
        placeholder: 'Re-enter the new password'
    });

    const submit = h(
        'button',
        { class: 'farmer-button', type: 'submit' },
        'Update password'
    );

    // Strength meter (advisory only).
    const strengthFill = h('div', { class: 'farmer-strength-fill' });
    const strengthText = h('small', {});

    const strength = h(
        'div',
        { class: 'farmer-strength', 'aria-live': 'polite' },
        h('div', { class: 'farmer-strength-bar' }, strengthFill),
        strengthText
    );

    strength.hidden = true;

    newPassword.addEventListener('input', () => {
        if (!newPassword.value) {
            strength.hidden = true;
            return;
        }

        const result = passwordStrength(newPassword.value);

        strength.hidden = false;
        strengthFill.style.width = `${result.percent}%`;
        strengthFill.style.background = result.color;
        strengthText.textContent = `Password strength: ${result.label}`;
    });

    // Show / hide both password fields.
    const showToggle = h('input', {
        type: 'checkbox',
        id: 'farmerShowPasswords'
    });

    showToggle.addEventListener('change', () => {
        const type = showToggle.checked ? 'text' : 'password';

        newPassword.type = type;
        confirmPassword.type = type;
    });

    const showError = (text) => {
        message.textContent = text;
        message.hidden = false;
    };

    const form = h(
        'form',
        { class: 'farmer-settings-form', novalidate: '' },
        h(
            'div',
            { class: 'farmer-settings-form-field' },
            h('label', { for: 'farmerNewPassword' }, 'New password'),
            newPassword
        ),
        strength,
        h(
            'div',
            { class: 'farmer-settings-form-field' },
            h('label', { for: 'farmerConfirmPassword' }, 'Confirm new password'),
            confirmPassword
        ),
        h(
            'label',
            { for: 'farmerShowPasswords', class: 'farmer-show-passwords' },
            showToggle,
            'Show passwords'
        ),
        message,
        h('div', { class: 'farmer-settings-actions' }, submit)
    );

    /** Validate and submit the new password with Supabase Auth. */
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        message.hidden = true;

        if (newPassword.value.length < MIN_PASSWORD_LENGTH) {
            showError(
                `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
            );
            return;
        }

        if (newPassword.value !== confirmPassword.value) {
            showError('Passwords do not match.');
            return;
        }

        submit.disabled = true;
        submit.textContent = 'Updating...';

        try {
            const { error } = await supabase.auth.updateUser({
                password: newPassword.value
            });

            if (error) throw error;

            form.reset();
            strength.hidden = true;
            newPassword.type = 'password';
            confirmPassword.type = 'password';
            toast('Password updated.');
        } catch (err) {
            console.error('Password update failed:', err);
            showError(
                err?.message || 'Could not update the password. Please try again.'
            );
        } finally {
            submit.disabled = false;
            submit.textContent = 'Update password';
        }
    });

    return h(
        'section',
        { class: 'farmer-settings-panel' },
        panelHeader('Security', 'Change the password you use to sign in'),
        form
    );
}

/* ---------- Page ---------- */
/** Render profile, appearance, security, and session settings panels. */
async function renderSettings() {
    if (!settingsRoot) return;

    const load = async () => {
        settingsRoot.replaceChildren(
            h('p', { class: 'muted' }, 'Loading settings...')
        );

        try {
            const [account, farms] = await Promise.all([
                loadAccount(),
                loadFarms()
            ]);

            settingsRoot.replaceChildren(
                h(
                    'div',
                    { class: 'farmer-settings-grid' },
                    profilePanel(account, farms),
                    h(
                        'div',
                        { class: 'farmer-settings-stack' },
                        appearancePanel(),
                        securityPanel(),
                    )
                )
            );
        } catch (err) {
            console.error('Failed to load settings:', err);

            settingsRoot.replaceChildren(
                h('p', { class: 'farmer-settings-msg error' }, 'Could not load your settings.'),
                h(
                    'button',
                    {
                        class: 'farmer-button farmer-button-secondary',
                        type: 'button',
                        onclick: load
                    },
                    'Retry'
                )
            );
        }
    };

    await load();
}

/* ---------- Logout ---------- */
function initializeLogout() {
    if (!logoutButton) return;

    logoutButton.addEventListener('click', async () => {
        if (logoutLabel) logoutLabel.textContent = 'Logging out...';

        logoutButton.disabled = true;

        const { error } = await supabase.auth.signOut();

        if (error) {
            console.error('Logout error:', error);

            if (logoutLabel) logoutLabel.textContent = 'Log out';

            logoutButton.disabled = false;
            return;
        }

        window.location.replace('../../login.html');
    });
}

/* ---------- Initialization ---------- */
async function initializeSettingsPage() {
    document.body.classList.add('permissions-loading');

    try {
        initializeLogout();
        initializeComingSoonLinks();

        if (todayLabel) {
            todayLabel.textContent = new Date().toLocaleDateString('en-PH', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
        }

        const isValidFarmer = await validateFarmerSession();

        if (!isValidFarmer) return;

        // Check all sidebar permissions.
        await applyNavigationPermissions();

        await renderSettings();

    } catch (error) {
        console.error('Farmer Settings Initialization Error:', error);

        settingsRoot?.replaceChildren(
            h(
                'p',
                { class: 'farmer-settings-msg error' },
                error.message || 'Something went wrong while loading the page.'
            )
        );

    } finally {
        document.body.classList.remove('permissions-loading');
    }
}

initializeSettingsPage();