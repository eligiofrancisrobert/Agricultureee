
import { supabase } from '../connection.js';
import { h, toast } from '../admin/ui.js';
import {
    initNotifications,
    cleanupNotifications
} from '../shared/notifications.js';

const WAREHOUSE_OFFICER_ROLE_ID = 2;
const ACTIVE_STATUS_ID = 1;

const TITLES = {
    dashboard: 'Dashboard',
    'harvest-records': 'Harvest Records',
    'fertilizer-inventory': 'Fertilizer Inventory',
    'pesticide-inventory': 'Pesticide Inventory',
    equipment: 'Equipment',
    'harvest-inventory': 'Harvest Inventory',
    deliveries: 'Deliveries',
    settings: 'Settings'
};

const ROUTE_PERMISSIONS = {
    dashboard: 'dashboard.view',
    'harvest-records': 'harvests.view',
    'harvest-inventory': 'harvests.view',
    'fertilizer-inventory': 'inventory.view',
    'pesticide-inventory': 'inventory.view',
    equipment: 'inventory.view',
    deliveries: 'inventory.view',
    settings: 'settings.view'
};

const root = document.getElementById('view');
const search = document.getElementById('woSearch');
const logoutButton = document.getElementById('logoutButton');
const html = document.documentElement;

const ctx = {
    query: '',
    staff: null
};

let authorized = false;
let checking = false;
let activeViewModule = null;
let permissionState = new Map();

const route = () => {
    const name = location.hash.slice(1).split('/')[0];
    return TITLES[name] ? name : 'dashboard';
};

// ============================================================
// AUTHENTICATION
// ============================================================

async function requireWarehouseOfficer() {
    console.log('[WO DIAGNOSTIC] Checking authenticated user...');

    const {
        data: { user },
        error
    } = await supabase.auth.getUser();

    if (error || !user) {
        console.error('[WO DIAGNOSTIC] AUTH USER CHECK FAILED:', {
            error,
            hasUser: !!user
        });

        return null;
    }

    console.log('[WO DIAGNOSTIC] Authenticated user found.');

    const { data: staff, error: staffError } = await supabase
        .from('staff_accounts')
        .select('staff_id, user_id, full_name, role_id, status_id')
        .eq('user_id', user.id)
        .maybeSingle();

    if (staffError || !staff) {
        console.error('[WO DIAGNOSTIC] STAFF ACCOUNT CHECK FAILED:', {
            staffError,
            hasStaff: !!staff
        });

        return null;
    }

    if (
        Number(staff.role_id) !== WAREHOUSE_OFFICER_ROLE_ID ||
        Number(staff.status_id) !== ACTIVE_STATUS_ID
    ) {
        console.error('[WO DIAGNOSTIC] STAFF VALIDATION FAILED:', {
            role_id: staff.role_id,
            expected_role_id: WAREHOUSE_OFFICER_ROLE_ID,
            status_id: staff.status_id,
            expected_status_id: ACTIVE_STATUS_ID
        });

        return null;
    }

    console.log('[WO DIAGNOSTIC] Warehouse Officer validation passed.');

    return staff;
}

// ============================================================
// PERMISSIONS
// ============================================================

async function loadPermissions() {
    permissionState.clear();

    const permissionKeys = [
        ...new Set(Object.values(ROUTE_PERMISSIONS))
    ];

    const results = await Promise.all(
        permissionKeys.map(async (permissionKey) => {
            const { data, error } = await supabase.rpc(
                'has_tanikala_permission',
                {
                    p_permission_key: permissionKey
                }
            );

            console.log('WO PERMISSION CHECK:', {
                permissionKey,
                data,
                error
            });

            if (error) {
                console.error(
                    `Permission check failed: ${permissionKey}`,
                    error
                );

                return [permissionKey, false];
            }

            return [permissionKey, data === true];
        })
    );

    permissionState = new Map(results);
}

function hasPermission(permissionKey) {
    return permissionState.get(permissionKey) === true;
}

function canAccessRoute(routeKey) {
    const permissionKey = ROUTE_PERMISSIONS[routeKey];

    if (!permissionKey) return false;

    return hasPermission(permissionKey);
}

function applyNavigationPermissions() {
    document.querySelectorAll('.nav > a').forEach((anchor) => {
        const viewKey = anchor.dataset.view;
        const permissionKey = ROUTE_PERMISSIONS[viewKey];

        if (!permissionKey) {
            anchor.hidden = true;
            return;
        }

        anchor.hidden = !hasPermission(permissionKey);
    });
}

function showAccessDenied() {
    root.replaceChildren(
        h(
            'div',
            { class: 'msg error' },
            'You do not have permission to access this page. Contact your administrator if you need access.'
        )
    );
}

// ============================================================
// PAGE ROUTING
// ============================================================

async function show() {
    if (!authorized) return;

    const key = route();

    if (!canAccessRoute(key)) {
        if (activeViewModule?.cleanup) {
            activeViewModule.cleanup();
        }

        activeViewModule = null;

        document.querySelectorAll('.nav > a').forEach((anchor) => {
            anchor.classList.remove('active');
        });

        showAccessDenied();
        return;
    }

    if (activeViewModule?.cleanup) {
        activeViewModule.cleanup();
    }

    activeViewModule = null;

    document.querySelectorAll('.nav > a').forEach((anchor) => {
        anchor.classList.toggle(
            'active',
            anchor.dataset.view === key
        );
    });

    document.title = `${TITLES[key]} | Tanikala Warehouse Officer`;

    root.replaceChildren(
        h('p', { class: 'muted' }, 'Loading...')
    );

    try {
        const view = await import(`./${key}.js`);

        if (typeof view.render !== 'function') {
            throw new Error(
                `${key}.js must export an async render(root, ctx) function.`
            );
        }

        if (!authorized || !canAccessRoute(key)) {
            showAccessDenied();
            return;
        }

        activeViewModule = view;

        root.replaceChildren();

        await view.render(root, ctx);
    } catch (err) {
        console.error('Failed to load Warehouse Officer page:', err);

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
// NOTIFICATIONS
// ============================================================

async function setupNotifications() {
    console.log('[WO DIAGNOSTIC] Setting up notifications...');

    cleanupNotifications();

    try {
        await initNotifications(supabase);
        console.log('[WO DIAGNOSTIC] Notifications initialized.');
    } catch (error) {
        console.error(
            'Failed to initialize Warehouse Officer notifications:',
            error
        );
    }
}

// ============================================================
// BOOT
// ============================================================

async function boot() {
    if (checking) {
        console.warn('[WO DIAGNOSTIC] Boot skipped: already checking.');
        return;
    }

    console.log('[WO DIAGNOSTIC] BOOT STARTED.');

    checking = true;
    authorized = false;

    html.classList.remove('wo-authorized');

    cleanupNotifications();
    permissionState.clear();

    try {
        const staff = await requireWarehouseOfficer();

        if (!staff) {
            console.error(
                '[WO DIAGNOSTIC] FORCED LOGOUT: Warehouse Officer validation returned null.'
            );

            const { error: signOutError } = await supabase.auth.signOut();

            console.error('[WO DIAGNOSTIC] Forced signOut result:', {
                signOutError
            });

            location.replace('../../login.html');
            return;
        }

        ctx.staff = staff;

        await loadPermissions();

        const avatar = document.getElementById('woAvatar');

        if (avatar) {
            avatar.textContent = (staff.full_name || 'WO')
                .split(/\s+/)
                .filter(Boolean)
                .map((part) => part[0])
                .slice(0, 2)
                .join('')
                .toUpperCase();
        }

        applyNavigationPermissions();

        authorized = true;

        html.classList.add('wo-authorized');

        await setupNotifications();
        await show();
    } catch (error) {
        console.error(
            'Warehouse Officer initialization failed:',
            error
        );

        authorized = false;
        permissionState.clear();

        html.classList.remove('wo-authorized');

        toast('Unable to initialize your account. Please refresh.');
    } finally {
        checking = false;
        console.log('[WO DIAGNOSTIC] BOOT FINISHED.');
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
                    location.hash = 'harvest-records';
                } else {
                    show();
                }
            }, 200);
        });
    }

    window.addEventListener('hashchange', show);

    window.addEventListener('pageshow', (event) => {
        if (event.persisted) {
            console.warn(
                '[WO DIAGNOSTIC] Persisted pageshow event triggered boot.'
            );

            boot();
        }
    });

    if (logoutButton) {
        logoutButton.addEventListener('click', async () => {
            console.error(
                '[WO DIAGNOSTIC] MANUAL LOGOUT BUTTON CLICK HANDLER TRIGGERED.'
            );

            if (logoutButton.disabled) return;

            logoutButton.disabled = true;
            logoutButton.textContent = 'Logging out...';

            cleanupNotifications();

            try {
                const { error } = await supabase.auth.signOut();

                if (error) throw error;

                authorized = false;
                permissionState.clear();

                html.classList.remove('wo-authorized');

                location.replace('../../login.html');
            } catch (err) {
                console.error('Logout failed:', err);

                logoutButton.disabled = false;
                logoutButton.textContent = 'Log out';

                if (authorized) {
                    await setupNotifications();
                }

                toast('Logout failed. Please try again.');
            }
        });
    }
}

setupChrome();
boot();
