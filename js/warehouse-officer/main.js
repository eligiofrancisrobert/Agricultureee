
import { supabase } from '../connection.js';
import { h, toast } from '../admin/ui.js';
import { hasPermission } from '../admin/permissions.js';

import {
    initNotifications,
    cleanupNotifications
} from '../shared/notifications.js';

// =====================================================
// CONFIGURATION
// =====================================================

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
    'fertilizer-inventory': 'inventory.view',
    'pesticide-inventory': 'inventory.view',
    equipment: 'inventory.view',
    'harvest-inventory': 'harvests.view',
    deliveries: 'inventory.view',
    settings: 'settings.view'
};

// Inventory pages use the shared parent module.
// The category is passed through ctx.inventoryType.
const INVENTORY_ROUTES = new Set([
    'fertilizer-inventory',
    'pesticide-inventory',
    'equipment',
    'harvest-inventory'
]);

// =====================================================
// ELEMENTS
// =====================================================

const root = document.getElementById('view');
const search = document.getElementById('woSearch');
const logoutButton = document.getElementById('logoutButton');
const html = document.documentElement;

const ctx = {
    query: '',
    staff: null,
    inventoryType: null
};

// =====================================================
// STATE
// =====================================================

let authorized = false;
let checking = false;
let activeViewModule = null;
let navigationSequence = 0;

const permissionCache = new Map();

let notificationInitialized = false;
let notificationInitializing = false;

// =====================================================
// ROUTING
// =====================================================

const route = () => {
    const name = location.hash.slice(1).split('/')[0];
    return TITLES[name] ? name : 'dashboard';
};

function getRoutePermission(key) {
    return ROUTE_PERMISSIONS[key] || null;
}

async function loadViewModule(key) {
    if (INVENTORY_ROUTES.has(key)) {
        ctx.inventoryType = key;

        return import('./inventory-template.js');
    }

    ctx.inventoryType = null;

    return import(`./${key}.js`);
}

// =====================================================
// PERMISSION CACHE
// =====================================================

async function loadRoutePermissions() {
    permissionCache.clear();

    const permissions = [
        ...new Set(
            Object.values(ROUTE_PERMISSIONS).filter(Boolean)
        )
    ];

    const results = await Promise.all(
        permissions.map(async (permission) => {
            try {
                const allowed = await hasPermission(permission);
                return [permission, Boolean(allowed)];
            } catch (error) {
                console.error(
                    `Permission check failed: ${permission}`,
                    error
                );

                return [permission, false];
            }
        })
    );

    results.forEach(([permission, allowed]) => {
        permissionCache.set(permission, allowed);
    });
}

function canAccessRoute(key) {
    const permission = getRoutePermission(key);

    if (!permission) return false;

    return permissionCache.get(permission) === true;
}

function updateNavigationPermissions() {
    document.querySelectorAll('.nav > a').forEach((anchor) => {
        const key = anchor.dataset.view;

        if (!key || !TITLES[key]) {
            anchor.hidden = true;
            return;
        }

        const allowed = canAccessRoute(key);

        anchor.hidden = !allowed;
        anchor.setAttribute('aria-hidden', String(!allowed));
    });
}

// =====================================================
// AUTHENTICATION
// =====================================================

async function requireWarehouseOfficer() {
    const {
        data: { user },
        error
    } = await supabase.auth.getUser();

    if (error || !user) return null;

    const { data: staff, error: staffError } = await supabase
        .from('staff_accounts')
        .select('staff_id, full_name, role_id, status_id')
        .eq('user_id', user.id)
        .maybeSingle();

    if (staffError || !staff) return null;

    if (
        Number(staff.role_id) !== WAREHOUSE_OFFICER_ROLE_ID ||
        Number(staff.status_id) !== ACTIVE_STATUS_ID
    ) {
        return null;
    }

    return staff;
}

// =====================================================
// PAGE CLEANUP
// =====================================================

function cleanupActivePage() {
    if (!activeViewModule) return;

    try {
        if (typeof activeViewModule.cleanup === 'function') {
            activeViewModule.cleanup();
        } else if (
            typeof activeViewModule.cleanupInventoryPage === 'function'
        ) {
            activeViewModule.cleanupInventoryPage();
        }
    } catch (error) {
        console.error('Page cleanup failed:', error);
    }

    activeViewModule = null;
}

// =====================================================
// ACCESS DENIED
// =====================================================

function renderAccessDenied(
    message = 'You do not have permission to access this page.'
) {
    if (!root) return;

    root.replaceChildren(
        h('div', { class: 'msg error' }, message)
    );
}

// =====================================================
// PAGE LOADING
// =====================================================

async function show() {
    if (!authorized || !root) return;

    const sequence = ++navigationSequence;
    const key = route();

    cleanupActivePage();

    document.querySelectorAll('.nav > a').forEach((anchor) => {
        anchor.classList.toggle(
            'active',
            anchor.dataset.view === key
        );
    });

    document.title =
        `${TITLES[key]} | Tanikala Warehouse Officer`;

    if (!canAccessRoute(key)) {
        renderAccessDenied(
            `You do not have permission to view ${TITLES[key]}.`
        );

        return;
    }

    root.replaceChildren(
        h('p', { class: 'muted' }, 'Loading...')
    );

    try {
        const view = await loadViewModule(key);

        if (sequence !== navigationSequence) {
            view.cleanup?.();
            view.cleanupInventoryPage?.();
            return;
        }

        const renderPage =
            view.render ||
            view.renderInventoryPage;

        if (typeof renderPage !== 'function') {
            throw new TypeError(
                `Page module for "${key}" does not export render() or renderInventoryPage().`
            );
        }

        activeViewModule = view;

        root.replaceChildren();

        if (INVENTORY_ROUTES.has(key)) {
            await renderPage(root, {
                type: key === 'harvest-inventory'
                    ? 'harvest'
                    : 'tools',
                category: key === 'equipment'
                    ? 'Equipment'
                    : key === 'fertilizer-inventory'
                        ? 'Fertilizer'
                        : key === 'pesticide-inventory'
                            ? 'Pesticide'
                            : null
            }, ctx);
        } else {
            await renderPage(root, ctx);
        }

        if (sequence !== navigationSequence) {
            if (activeViewModule === view) {
                cleanupActivePage();
            } else {
                view.cleanup?.();
                view.cleanupInventoryPage?.();
            }
        }

    } catch (error) {
        console.error(
            'Failed to load Warehouse Officer page:',
            error
        );

        if (sequence !== navigationSequence) return;

        cleanupActivePage();

        root.replaceChildren(
            h(
                'p',
                { class: 'msg error' },
                'This page could not load. Refresh and try again.'
            )
        );
    }
}

// =====================================================
// NOTIFICATIONS
// =====================================================

async function setupNotifications() {
    if (notificationInitialized || notificationInitializing) {
        return;
    }

    notificationInitializing = true;

    try {
        await initNotifications(supabase);
        notificationInitialized = true;
    } catch (error) {
        console.error(
            'Failed to initialize Warehouse Officer notifications:',
            error
        );
    } finally {
        notificationInitializing = false;
    }
}

function stopNotifications() {
    cleanupNotifications();

    notificationInitialized = false;
    notificationInitializing = false;
}

// =====================================================
// BOOT
// =====================================================

async function boot() {
    if (checking) return;

    checking = true;
    authorized = false;

    navigationSequence++;

    html.classList.remove('wo-authorized');

    stopNotifications();
    cleanupActivePage();

    try {
        const staff = await requireWarehouseOfficer();

        if (!staff) {
            await supabase.auth.signOut().catch(() => {});
            location.replace('../../login.html');
            return;
        }

        ctx.staff = staff;

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

        await loadRoutePermissions();

        authorized = true;

        html.classList.add('wo-authorized');

        updateNavigationPermissions();

        await show();

        void setupNotifications();

    } catch (error) {
        console.error(
            'Warehouse Officer initialization failed:',
            error
        );

        authorized = false;

        html.classList.remove('wo-authorized');

        toast('Unable to initialize your account. Please refresh.');

    } finally {
        checking = false;
    }
}

// =====================================================
// CHROME / GLOBAL EVENTS
// =====================================================

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
                html.dataset.theme === 'dark'
                    ? 'light'
                    : 'dark';

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
                }
            }, 200);
        });
    }

    window.addEventListener('hashchange', () => {
        void show();
    });

    window.addEventListener('pageshow', (event) => {
        if (event.persisted) {
            void boot();
        }
    });

    if (logoutButton) {
        logoutButton.addEventListener('click', async () => {
            if (logoutButton.disabled) return;

            logoutButton.disabled = true;
            logoutButton.textContent = 'Logging out...';

            stopNotifications();

            try {
                const { error } = await supabase.auth.signOut();

                if (error) throw error;

                authorized = false;
                navigationSequence++;

                cleanupActivePage();
                permissionCache.clear();

                html.classList.remove('wo-authorized');

                location.replace('../../login.html');

            } catch (error) {
                console.error('Logout failed:', error);

                logoutButton.disabled = false;
                logoutButton.textContent = 'Log out';

                if (authorized) {
                    void setupNotifications();
                }

                toast('Logout failed. Please try again.');
            }
        });
    }
}

// =====================================================
// START APPLICATION
// =====================================================

setupChrome();
void boot();
