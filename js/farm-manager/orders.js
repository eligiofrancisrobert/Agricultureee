
import { supabase } from '../connection.js';
import { h, toast } from '../admin/ui.js';
import {
    initNotifications,
    cleanupNotifications
} from '../shared/notifications.js';

const FARM_MANAGER_ROLE_ID = 1;
const ACTIVE_STATUS_ID = 1;

const TITLES = {
    dashboard: 'Dashboard',
    farms: 'My farms',
    workers: 'Workers',
    'farm-actions': 'Farm Actions',
    'plant-now': 'Plant Now',
    crops: 'Crops',
    harvest: 'Harvest Dashboard',
    reports: 'Reports',
    settings: 'Settings',
    'browse-products': 'Browse Products'
};

const root = document.getElementById('view');
const search = document.getElementById('fmSearch');
const logoutButton = document.getElementById('logoutButton');
const html = document.documentElement;

const ctx = {
    query: '',
    staff: null,
    replenishmentRequestId: null
};

let authorized = false;
let checking = false;
let activeViewModule = null;

const route = () => {
    const name = location.hash.slice(1).split('/')[0];
    return TITLES[name] ? name : 'dashboard';
};

function getRouteRequestId() {
    if (route() !== 'browse-products') return null;

    const parts = location.hash.slice(1).split('/');
    return parts[1] || null;
}

async function requireFarmManager() {
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
        Number(staff.role_id) !== FARM_MANAGER_ROLE_ID ||
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

    ctx.replenishmentRequestId = getRouteRequestId();

    document.querySelectorAll('.nav > a').forEach((anchor) => {
        anchor.classList.toggle(
            'active',
            anchor.dataset.view === key
        );
    });

    document.title = `${TITLES[key]} | Tanikala Farm Manager`;

    root.replaceChildren(
        h('p', { class: 'muted' }, 'Loading...')
    );

    try {
        const view = await import(`./${key}.js`);

        activeViewModule = view;

        root.replaceChildren();

        await view.render(root, ctx);
    } catch (err) {
        console.error('Failed to load Farm Manager page:', err);

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
            'Failed to initialize Farm Manager notifications:',
            error
        );
    }
}

async function boot() {
    if (checking) return;

    checking = true;
    authorized = false;

    html.classList.remove('fm-authorized');

    cleanupNotifications();

    const staff = await requireFarmManager();

    checking = false;

    if (!staff) {
        await supabase.auth.signOut().catch(() => {});
        location.replace('../../login.html');
        return;
    }

    ctx.staff = staff;

    const avatar = document.getElementById('fmAvatar');

    if (avatar) {
        avatar.textContent = (staff.full_name || 'FM')
            .split(/\s+/)
            .filter(Boolean)
            .map((part) => part[0])
            .slice(0, 2)
            .join('')
            .toUpperCase();
    }

    authorized = true;

    html.classList.add('fm-authorized');

    await setupNotifications();
    await show();
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
                    location.hash = 'farms';
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

            try {
                cleanupNotifications();

                const { error } = await supabase.auth.signOut();

                if (error) throw error;

                authorized = false;
                html.classList.remove('fm-authorized');

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
