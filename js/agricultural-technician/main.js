
import { supabase } from '../connection.js';
import { h, toast } from '../admin/ui.js';
import { initSidebarMenu } from '../agricultural-technician/responsive.js';

const AGRICULTURAL_TECHNICIAN_ROLE_ID = 3;
const ACTIVE_STATUS_ID = 1;

const TITLES = {
    dashboard: 'Dashboard',
    'assigned-farms': 'Assigned Farms',
    'crop-monitoring': 'Crop Monitoring',
    'field-inspections': 'Field Inspections',
    'crop-assessments': 'Crop Assessments',
    recommendations: 'Recommendations',
    'monitoring-reports': 'Monitoring Reports',
    settings: 'Settings'
};

const root = document.getElementById('view');
const search = document.getElementById('atSearch');
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

    return staff;
}

// ============================================================
// PAGE ROUTING
// ============================================================

async function show() {
    if (!authorized) return;

    if (activeViewModule?.cleanup) {
        await activeViewModule.cleanup();
    }

    activeViewModule = null;

    const key = route();

    document.querySelectorAll('.nav > a').forEach((anchor) => {
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

        if (typeof view.render !== 'function') {
            throw new Error(
                `${key}.js must export an async render(root, ctx) function.`
            );
        }

        activeViewModule = view;

        root.replaceChildren();

        await view.render(root, ctx);

    } catch (err) {
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

    const staff = await requireAgriculturalTechnician();

    checking = false;

    if (!staff) {
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

    authorized = true;

    html.classList.add('at-authorized');

    await show();
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
                    location.hash = 'assigned-farms';
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
                if (activeViewModule?.cleanup) {
                    await activeViewModule.cleanup();
                }

                const { error } = await supabase.auth.signOut();

                if (error) throw error;

                authorized = false;
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

initSidebarMenu({
    breakpoint: 900,
    swipeDistance: 60
});

setupChrome();
boot();