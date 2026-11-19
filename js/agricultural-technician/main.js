
import { supabase } from '../connection.js';
import { h, toast } from '../admin/ui.js';
import { initSidebarMenu } from './responsive.js';
import {
    loadPermissions,
    hasPermission,
    clearPermissions
} from './permissions.js';

const AGRICULTURAL_TECHNICIAN_ROLE_ID = 3;
const ACTIVE_STATUS_ID = 1;

const TITLES = {
    dashboard: 'Dashboard',
    'assigned-farms': 'Assigned Farms',
    'crop-monitoring': 'Crop Monitoring',
    'field-inspections': 'Field Inspections',
    'crop-assessments': 'Crop Assessments',
    'monitoring-reports': 'Monitoring Reports',
    settings: 'Settings'
};

const ROUTE_PERMISSIONS = {
    dashboard: 'dashboard.view',
    'assigned-farms': 'assigned_farms.view',
    'crop-monitoring': 'crop_monitoring.view',
    'field-inspections': 'field_inspections.view',
    'crop-assessments': 'crop_assessments.view',
    'monitoring-reports': 'monitoring_reports.view',
    settings: 'profile.view'
};

const root = document.getElementById('view');
const search = document.getElementById('atSearch');
const logoutButton = document.getElementById('logoutButton');
const html = document.documentElement;

const ctx = {
    query: '',
    staff: null,
    hasPermission
};

let authorized = false;
let checking = false;
let activeViewModule = null;
let viewRequest = 0;

// ============================================================
// ROUTING
// ============================================================

const route = () => {
    const name = location.hash.slice(1).split('/')[0];
    return TITLES[name] ? name : 'dashboard';
};

function canAccessRoute(key) {
    const permission = ROUTE_PERMISSIONS[key];
    return Boolean(permission && hasPermission(permission));
}

function getFirstAllowedRoute() {
    return Object.keys(TITLES).find(canAccessRoute) || null;
}

// ============================================================
// SIDEBAR PERMISSIONS
// ============================================================

function updateSidebarPermissions() {
    document.querySelectorAll('.nav a[data-view]').forEach((anchor) => {
        const key = anchor.dataset.view;
        const allowed = canAccessRoute(key);

        anchor.hidden = !allowed;
        anchor.style.display = allowed ? '' : 'none';
        anchor.setAttribute('aria-hidden', String(!allowed));
        anchor.tabIndex = allowed ? 0 : -1;

        if (!allowed) {
            anchor.classList.remove('active');
            anchor.removeAttribute('aria-current');
        }
    });
}

// ============================================================
// AUTHENTICATION AND ROLE VALIDATION
// ============================================================

async function requireAgriculturalTechnician() {
    const {
        data: { user },
        error
    } = await supabase.auth.getUser();

    if (error || !user) return null;

    const { data: staff, error: staffError } = await supabase
        .from('staff_accounts')
        .select('staff_id, full_name, email, role_id, status_id')
        .eq('user_id', user.id)
        .maybeSingle();

    if (staffError) {
        console.error(
            'Failed to load Agricultural Technician account:',
            staffError
        );
        return null;
    }

    if (!staff) return null;

    if (
        Number(staff.role_id) !== AGRICULTURAL_TECHNICIAN_ROLE_ID ||
        Number(staff.status_id) !== ACTIVE_STATUS_ID
    ) {
        return null;
    }

    return {
        ...staff,
        user_id: user.id
    };
}

// ============================================================
// VIEW CLEANUP
// ============================================================

async function cleanupCurrentView() {
    if (activeViewModule?.cleanup) {
        try {
            await activeViewModule.cleanup();
        } catch (error) {
            console.error('View cleanup failed:', error);
        }
    }

    activeViewModule = null;
}

// ============================================================
// PAGE ROUTING
// ============================================================

async function show() {
    if (!authorized) return;

    const requestId = ++viewRequest;
    let key = route();

    if (!canAccessRoute(key)) {
        const fallback = getFirstAllowedRoute();

        if (!fallback) {
            await cleanupCurrentView();

            root.replaceChildren(
                h(
                    'section',
                    { class: 'at-access-denied' },
                    h('h2', {}, 'Access Restricted'),
                    h(
                        'p',
                        {},
                        'You do not have permission to access any available section. Please contact your administrator.'
                    )
                )
            );

            return;
        }

        key = fallback;
        history.replaceState(null, '', `#${fallback}`);
    }

    await cleanupCurrentView();

    if (requestId !== viewRequest) return;

    document.querySelectorAll('.nav a[data-view]').forEach((anchor) => {
        const active = anchor.dataset.view === key;

        anchor.classList.toggle('active', active);

        if (active) {
            anchor.setAttribute('aria-current', 'page');
        } else {
            anchor.removeAttribute('aria-current');
        }
    });

    document.title = `${TITLES[key]} | Tanikala Agricultural Technician`;

    root.replaceChildren(
        h('p', { class: 'muted' }, 'Loading...')
    );

    try {
        const view = await import(`./${key}.js`);

        if (requestId !== viewRequest) return;

        if (typeof view.render !== 'function') {
            throw new Error(
                `${key}.js must export an async render(root, ctx) function.`
            );
        }

        activeViewModule = view;

        root.replaceChildren();

        await view.render(root, ctx);

    } catch (err) {
        if (requestId !== viewRequest) return;

        console.error(
            `Failed to load Agricultural Technician page (${key}):`,
            err
        );

        root.replaceChildren(
            h(
                'p',
                { class: 'msg error' },
                'This page could not load. Refresh and try again.'
            )
        );
    }
}

// ============================================================
// AUTHORIZATION BOOT
// ============================================================

async function boot() {
    if (checking) return;

    checking = true;
    authorized = false;

    html.classList.remove('at-authorized');

    try {
        const staff = await requireAgriculturalTechnician();

        if (!staff) {
            clearPermissions();
            await supabase.auth.signOut().catch(() => {});
            location.replace('../../login.html');
            return;
        }

        ctx.staff = staff;

        const avatar = document.getElementById('atAvatar');

        if (avatar) {
            avatar.textContent = (staff.full_name || 'AT')
                .split(/\s+/)
                .filter(Boolean)
                .map((part) => part[0])
                .slice(0, 2)
                .join('')
                .toUpperCase();
        }

        // Load role defaults and individual overrides.
        await loadPermissions(true);

        console.log(
            'Dashboard permission:',
            hasPermission('dashboard.view')
        );

        updateSidebarPermissions();

        authorized = true;
        html.classList.add('at-authorized');

        const firstAllowed = getFirstAllowedRoute();

        if (!firstAllowed) {
            await show();
            return;
        }

        if (!canAccessRoute(route())) {
            history.replaceState(null, '', `#${firstAllowed}`);
        }

        await show();

    } catch (error) {
        console.error(
            'Agricultural Technician initialization failed:',
            error
        );

        html.classList.add('at-authorized');

        root.replaceChildren(
            h(
                'p',
                { class: 'msg error' },
                'Unable to initialize your account permissions. Check the browser console for details.'
            )
        );

    } finally {
        checking = false;
    }
}

// ============================================================
// TOPBAR AND EVENT LISTENERS
// ============================================================

function setupChrome() {
    const todayLabel = document.getElementById('todayLabel');
    const themeToggle = document.getElementById('themeToggle');

    if (todayLabel) {
        todayLabel.textContent = new Date().toLocaleDateString(
            'en-PH',
            {
                weekday: 'long',
                month: 'short',
                day: 'numeric'
            }
        );
    }

    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const next =
                html.dataset.theme === 'dark' ? 'light' : 'dark';

            html.dataset.theme = next;
            localStorage.setItem('theme', next);
        });
    }

    let timer;

    if (search) {
        search.addEventListener('input', () => {
            clearTimeout(timer);

            timer = setTimeout(() => {
                ctx.query = search.value.trim().toLowerCase();

                if (route() === 'dashboard' && ctx.query) {
                    const target = canAccessRoute('assigned-farms')
                        ? 'assigned-farms'
                        : getFirstAllowedRoute();

                    if (target) {
                        location.hash = target;
                    }
                } else if (authorized) {
                    show();
                }
            }, 200);
        });
    }

    window.addEventListener('hashchange', show);

    window.addEventListener('pageshow', (event) => {
        if (event.persisted) {
            boot();
        }
    });

    if (logoutButton) {
        logoutButton.addEventListener('click', async () => {
            if (logoutButton.disabled) return;

            logoutButton.disabled = true;
            logoutButton.textContent = 'Logging out...';

            try {
                await cleanupCurrentView();

                const { error } = await supabase.auth.signOut();

                if (error) throw error;

                authorized = false;
                clearPermissions();

                html.classList.remove('at-authorized');

                location.replace('../../login.html');

            } catch (err) {
                console.error('Logout failed:', err);

                logoutButton.disabled = false;
                logoutButton.textContent = 'Log out';

                toast('Logout failed. Please try again.');
            }
        });
    }
}

// ============================================================
// INITIALIZATION
// ============================================================

initSidebarMenu({
    breakpoint: 900,
    swipeDistance: 60
});

setupChrome();
boot();
