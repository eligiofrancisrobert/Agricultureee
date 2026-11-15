
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

const route = () => {
    const name = location.hash.slice(1).split('/')[0];
    return TITLES[name] ? name : 'dashboard';
};

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

async function show() {
    if (!authorized) return;

    if (activeViewModule?.cleanup) {
        activeViewModule.cleanup();
    }

    activeViewModule = null;

    const key = route();

    document.querySelectorAll('.nav > a').forEach((anchor) => {
        anchor.classList.toggle('active', anchor.dataset.view === key);
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

async function setupNotifications() {
    cleanupNotifications();

    try {
        await initNotifications(supabase);
    } catch (error) {
        console.error(
            'Failed to initialize Warehouse Officer notifications:',
            error
        );
    }
}

async function boot() {
    if (checking) return;

    checking = true;
    authorized = false;

    html.classList.remove('wo-authorized');

    cleanupNotifications();

    try {
        const staff = await requireWarehouseOfficer();

        if (!staff) {
            await supabase.auth.signOut().catch(() => { });

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

        authorized = true;

        html.classList.add('wo-authorized');

        await setupNotifications();
        await show();
    } catch (error) {
        console.error('Warehouse Officer initialization failed:', error);

        authorized = false;
        html.classList.remove('wo-authorized');

        toast('Unable to initialize your account. Please refresh.');
    } finally {
        checking = false;
    }
}

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
            boot();
        }
    });

    if (logoutButton) {
        logoutButton.addEventListener('click', async () => {
            if (logoutButton.disabled) return;

            logoutButton.disabled = true;
            logoutButton.textContent = 'Logging out...';

            cleanupNotifications();

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
