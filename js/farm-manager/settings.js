import { supabase } from '../connection.js';
import { h, toast } from '../admin/ui.js';

const MIN_PASSWORD_LENGTH = 8;

/* ---------- Data ---------- */
/** Read the current Supabase Auth email and account timestamps. */
async function loadAccount() {
    const {
        data: { user },
        error
    } = await supabase.auth.getUser();

    if (error) throw error;

    return {
        email: user?.email || '',
        createdAt: user?.created_at || '',
        lastSignIn: user?.last_sign_in_at || ''
    };
}

/* ---------- Helpers ---------- */
const initials = (name) =>
    (name || 'FM')
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
        { class: 'fm-settings-field' },
        h('small', {}, label),
        h('b', {}, value || 'Not set')
    );

const panelHeader = (title, subtitle, extra = '') =>
    h(
        'div',
        { class: 'fm-settings-panel-header' },
        h('div', {}, h('h3', {}, title), h('p', {}, subtitle)),
        extra
    );

/* ---------- Panels ---------- */
function profilePanel(staff, farm, account) {
    const name = staff?.full_name?.trim() || 'Farm Manager';
    const isActive = Number(staff?.status_id) === 1;

    const copyEmail = account.email
        ? h(
            'button',
            {
                class: 'fm-button fm-button-secondary',
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
        { class: 'fm-settings-panel' },
        panelHeader(
            'Profile',
            'Your account details',
            h('span', { class: 'fm-pill' }, 'Farm Manager')
        ),
        h(
            'div',
            { class: 'fm-profile-head' },
            h('span', { class: 'fm-profile-avatar' }, initials(name)),
            h(
                'div',
                { class: 'fm-profile-main' },
                h('b', {}, name),
                h('small', {}, account.email || 'No email on file')
            ),
            copyEmail
        ),
        h(
            'div',
            { class: 'fm-settings-fields' },
            field('Full name', name),
            field('Email', account.email),
            field('Role', 'Farm Manager'),
            field('Staff ID', staff?.staff_id),
            field('Account status', isActive ? 'Active' : 'Inactive'),
            field('Assigned farm', farm?.farm_name),
            field('Farm location', farm?.farm_location),
            field('Member since', formatDay(account.createdAt)),
            field('Last sign-in', formatDateTime(account.lastSignIn))
        )
    );
}

function appearancePanel() {
    const html = document.documentElement;

    const toggle = h('input', {
        type: 'checkbox',
        'aria-label': 'Dark mode'
    });

    toggle.checked = html.dataset.theme === 'dark';

    toggle.addEventListener('change', () => {
        const next = toggle.checked ? 'dark' : 'light';

        html.dataset.theme = next;
        localStorage.setItem('theme', next);
    });

    return h(
        'section',
        { class: 'fm-settings-panel' },
        panelHeader('Appearance', 'Choose how the dashboard looks'),
        h(
            'ul',
            { class: 'fm-settings-list' },
            h(
                'li',
                {},
                h(
                    'div',
                    {},
                    h('p', {}, 'Dark mode'),
                    h('small', {}, 'Use a darker theme that is easier on the eyes.')
                ),
                h('label', { class: 'fm-switch' }, toggle, h('span'))
            )
        )
    );
}

function securityPanel() {
    const message = h('p', { class: 'fm-settings-msg error' });
    message.hidden = true;

    const newPassword = h('input', {
        class: 'fm-form-input',
        id: 'fmNewPassword',
        type: 'password',
        autocomplete: 'new-password',
        placeholder: `At least ${MIN_PASSWORD_LENGTH} characters`
    });

    const confirmPassword = h('input', {
        class: 'fm-form-input',
        id: 'fmConfirmPassword',
        type: 'password',
        autocomplete: 'new-password',
        placeholder: 'Re-enter the new password'
    });

    const submit = h(
        'button',
        { class: 'fm-button', type: 'submit' },
        'Update password'
    );

    // Strength meter (advisory only).
    const strengthFill = h('div', { class: 'fm-strength-fill' });
    const strengthText = h('small', {});

    const strength = h(
        'div',
        { class: 'fm-strength', 'aria-live': 'polite' },
        h('div', { class: 'fm-strength-bar' }, strengthFill),
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
        id: 'fmShowPasswords'
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
        { class: 'fm-settings-form', novalidate: '' },
        h(
            'div',
            { class: 'fm-settings-form-field' },
            h('label', { for: 'fmNewPassword' }, 'New password'),
            newPassword
        ),
        strength,
        h(
            'div',
            { class: 'fm-settings-form-field' },
            h('label', { for: 'fmConfirmPassword' }, 'Confirm new password'),
            confirmPassword
        ),
        h(
            'label',
            { for: 'fmShowPasswords', class: 'fm-show-passwords' },
            showToggle,
            'Show passwords'
        ),
        message,
        h('div', { class: 'fm-settings-actions' }, submit)
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
        { class: 'fm-settings-panel' },
        panelHeader('Security', 'Change the password you use to sign in'),
        form
    );
}

function sessionsPanel() {
    const message = h('p', { class: 'fm-settings-msg error' });
    message.hidden = true;

    const button = h(
        'button',
        { class: 'fm-button fm-button-secondary', type: 'button' },
        'Sign out other devices'
    );

    button.addEventListener('click', async () => {
        if (
            !window.confirm(
                'Sign out of all other devices? You will stay signed in here.'
            )
        ) {
            return;
        }

        message.hidden = true;
        button.disabled = true;
        button.textContent = 'Signing out...';

        try {
            // "others" keeps the current session active.
            const { error } = await supabase.auth.signOut({ scope: 'others' });

            if (error) throw error;

            toast('Signed out of all other devices.');
        } catch (err) {
            console.error('Sign out of other devices failed:', err);
            message.textContent =
                err?.message || 'Could not sign out other devices. Please try again.';
            message.hidden = false;
        } finally {
            button.disabled = false;
            button.textContent = 'Sign out other devices';
        }
    });

    return h(
        'section',
        { class: 'fm-settings-panel' },
        panelHeader('Sessions', 'Sign out anywhere else your account is signed in'),
        h(
            'div',
            { class: 'fm-settings-form' },
            message,
            h('div', { class: 'fm-settings-actions' }, button)
        )
    );
}

/* ---------- Page ---------- */
/** Render profile, appearance, security, and session settings panels. */
export async function render(root, ctx) {
    const page = h('section', { class: 'fm-settings' });

    const heading = h(
        'div',
        { class: 'fm-page-heading' },
        h('h1', {}, 'Settings'),
        h('p', { class: 'muted' }, 'Manage your profile and how the dashboard looks.')
    );

    const holder = h('div');

    page.append(heading, holder);
    root.replaceChildren(page);

    const load = async () => {
        holder.replaceChildren(h('p', { class: 'muted' }, 'Loading settings...'));

        try {
            const account = await loadAccount();

            holder.replaceChildren(
                h(
                    'div',
                    { class: 'fm-settings-grid' },
                    profilePanel(ctx.staff, ctx.assignedFarm || ctx.farm, account),
                    h(
                        'div',
                        { class: 'fm-settings-stack' },
                        appearancePanel(),
                        securityPanel(),
                        sessionsPanel()
                    )
                )
            );
        } catch (err) {
            console.error('Failed to load settings:', err);

            holder.replaceChildren(
                h('p', { class: 'fm-settings-msg error' }, 'Could not load your settings.'),
                h(
                    'button',
                    {
                        class: 'fm-button fm-button-secondary',
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

export function cleanup() {}