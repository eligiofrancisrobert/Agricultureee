
import { supabase } from '../connection.js';
import { h, toast } from '../admin/ui.js';

const WAREHOUSE_OFFICER_ROLE_ID = 2;
const ACTIVE_STATUS_ID = 1;

const TITLES = {
    dashboard: 'Dashboard',
    'harvest-records': 'Harvest Records',
    'fertilizer-inventory': 'Fertilizer Inventory',
    'pesticide-inventory': 'Pesticide Inventory',
    equipment: 'Equipment',
    'harvest-inventory': 'Harvest Inventory',
    settings: 'Settings'
};

const root = document.getElementById('view');
const search = document.getElementById('woSearch');
const logoutButton = document.getElementById('logoutButton');
const html = document.documentElement;

// Shared context available to every Warehouse Officer view.
const ctx = {
    query: '',
    staff: null,
    assignedFarm: null
};

let authorized = false;
let checking = false;
let activeViewModule = null;

const route = () => {
    const name = location.hash.slice(1).split('/')[0];
    return TITLES[name] ? name : 'dashboard';
};

// Verify the authenticated user's Warehouse Officer account.
async function requireWarehouseOfficer() {
    const {
        data: { user },
        error
    } = await supabase.auth.getUser();

    if (error || !user) {
        console.error('Authentication failed:', error);
        return null;
    }

    const { data: staff, error: staffError } = await supabase
        .from('staff_accounts')
        .select('staff_id, full_name, role_id, status_id')
        .eq('user_id', user.id)
        .maybeSingle();

    if (staffError) {
        console.error('Failed to load staff account:', staffError);
        return null;
    }

    if (!staff) return null;

    if (
        Number(staff.role_id) !== WAREHOUSE_OFFICER_ROLE_ID ||
        Number(staff.status_id) !== ACTIVE_STATUS_ID
    ) {
        return null;
    }

    return staff;
}

// Load the farm assigned to the authenticated Warehouse Officer.
async function loadAssignedFarm() {
    const { data, error } = await supabase.rpc(
        'get_my_warehouse_officer_farm'
    );

    if (error) {
        console.error('Failed to load assigned farm:', error);
        throw error;
    }

    const farm = data?.[0] ?? null;

    if (!farm) {
        console.warn('No farm assigned to this Warehouse Officer.');
    } else {
        console.log('Assigned farm:', farm);
    }

    return farm;
}

// Display the active page.
async function show() {
    if (!authorized) return;

    // Clean up the previous page's Realtime subscriptions.
    if (activeViewModule?.cleanup) {
        activeViewModule.cleanup();
    }

    activeViewModule = null;

    const key = route();

    document.querySelectorAll('.nav > a').forEach((a) => {
        a.classList.toggle('active', a.dataset.view === key);
    });

    document.title = `${TITLES[key]} | Tanikala Warehouse Officer`;

    root.replaceChildren(
        h('p', { class: 'muted' }, 'Loading...')
    );

    try {
        const view = await import(`./${key}.js`);

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

// Authenticate, authorize, and initialize the Warehouse Officer.
async function boot() {
    if (checking) return;

    checking = true;
    authorized = false;

    html.classList.remove('wo-authorized');

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
                .split(' ')
                .map((part) => part[0])
                .slice(0, 2)
                .join('')
                .toUpperCase();
        }

        // Load the officer's assigned farm before opening any page.
        try {
            ctx.assignedFarm = await loadAssignedFarm();
        } catch (farmError) {
            console.error('Assigned farm initialization failed:', farmError);

            root.replaceChildren(
                h(
                    'p',
                    { class: 'msg error' },
                    'Unable to load your assigned farm. Please refresh or contact the administrator.'
                )
            );

            return;
        }

        authorized = true;
        html.classList.add('wo-authorized');

        await show();

    } catch (err) {
        console.error('Warehouse Officer initialization failed:', err);

        root.replaceChildren(
            h(
                'p',
                { class: 'msg error' },
                'Unable to initialize your account. Please try again.'
            )
        );

    } finally {
        checking = false;
    }
}

function setupChrome() {
    const todayLabel = document.getElementById('todayLabel');

    if (todayLabel) {
        todayLabel.textContent = new Date().toLocaleDateString('en-PH', {
            weekday: 'long',
            month: 'short',
            day: 'numeric'
        });
    }

    document.getElementById('themeToggle')?.addEventListener('click', () => {
        const next = html.dataset.theme === 'dark' ? 'light' : 'dark';

        html.dataset.theme = next;
        localStorage.setItem('theme', next);
    });

    let timer;

    search?.addEventListener('input', () => {
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

    window.addEventListener('hashchange', show);

    window.addEventListener('pageshow', (event) => {
        if (event.persisted) boot();
    });

    logoutButton?.addEventListener('click', async () => {
        if (logoutButton.disabled) return;

        logoutButton.disabled = true;
        logoutButton.textContent = 'Logging out...';

        try {
            const { error } = await supabase.auth.signOut();

            if (error) throw error;

            authorized = false;
            html.classList.remove('wo-authorized');

            location.replace('../../login.html');

        } catch (err) {
            console.error('Logout failed:', err);

            logoutButton.disabled = false;
            logoutButton.textContent = 'Log out';

            toast('Logout failed. Please try again.');
        }
    });
}

setupChrome();
boot();
