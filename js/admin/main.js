import { requireAdmin, logout, getStats } from './api.js';
import { h, toast } from './ui.js';

const TITLES = {
    dashboard: 'Dashboard',
    applications: 'Applications',
    users: 'Users',
    audit: 'Audit logs',
    settings: 'Settings',
    staff: 'Staff accounts',
};

const root = document.getElementById('view');
const search = document.getElementById('adminSearch');
const logoutButton = document.getElementById('logoutButton');
const usersParent = document.getElementById('usersParent');
const usersMenu = document.getElementById('usersMenu');
const html = document.documentElement;

let authorized = false;
let checking = false;

// Shared with every view. `sub` is the part after "users/" in the URL hash (e.g. "pending").
const ctx = { query: '', sub: '', refreshBadge };

// #users/pending -> { key: 'users', sub: 'pending' }
const route = () => {
    const [name, sub = ''] = location.hash.slice(1).split('/');
    return { key: TITLES[name] ? name : 'dashboard', sub };
};

async function refreshBadge() {
    try {
        const { pending } = await getStats();
        const bell = document.getElementById('bellCount');
        bell.textContent = pending;
        bell.hidden = !pending;
        document.getElementById('pendingCount').textContent = pending || '';
    } catch (err) {
        console.error('Could not refresh pending count:', err);
    }
}

const setMenu = (open) => {
    usersParent.setAttribute('aria-expanded', String(open));
    usersMenu.hidden = !open;
};

function syncNav({ key, sub }) {
    document.querySelectorAll('.nav > a').forEach((a) => a.classList.toggle('active', a.dataset.view === key));
    usersParent.classList.toggle('active', key === 'users');
    usersMenu.querySelectorAll('a').forEach((a) => a.classList.toggle('active', key === 'users' && a.dataset.sub === sub));
    if (key === 'users') setMenu(true);
}

async function show() {
    if (!authorized) return;

    const r = route();

    ctx.sub = r.sub;
    syncNav(r);

    document.title = `${TITLES[r.key] ?? 'Dashboard'} | Tanikala Admin`;

    root.replaceChildren(
        h('p', { class: 'muted' }, 'Loading...')
    );

    try {
        const view = await import(`./${r.key}.js`);

        root.replaceChildren();
        await view.render(root, ctx);

        refreshBadge();
    } catch (err) {
        console.error('Failed to load admin page:', err);

        root.replaceChildren(
            h(
                'p',
                { class: 'msg error' },
                'This page could not load. Check the browser console and Supabase permissions, then refresh.'
            )
        );
    }
}

// Verify the session is an admin, otherwise send back to login.
async function boot() {
    if (checking) return;
    checking = true;
    authorized = false;
    html.classList.remove('admin-authorized');

    const ok = await requireAdmin();
    checking = false;
    if (!ok) { location.replace('../../login.html'); return; }

    authorized = true;
    html.classList.add('admin-authorized');
    show();
}

function setupChrome() {
    document.getElementById('todayLabel').textContent =
        new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'short', day: 'numeric' });

    document.getElementById('themeToggle').addEventListener('click', () => {
        const next = html.dataset.theme === 'dark' ? 'light' : 'dark';
        html.dataset.theme = next;
        localStorage.setItem('theme', next);
    });

    // Users dropdown: opens and goes to all users; clicking again on the Users page collapses it
    usersParent.addEventListener('click', () => {
        if (route().key !== 'users') location.hash = 'users';
        else setMenu(usersMenu.hidden);
    });

    let timer;
    search.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            ctx.query = search.value.trim();
            // Dashboard has nothing to filter, so searching jumps to the user list
            if (route().key === 'dashboard' && ctx.query) location.hash = 'users';
            else show();
        }, 200);
    });

    window.addEventListener('hashchange', show);

    // Back/forward cache: re-check access instead of showing a stale admin page
    window.addEventListener('pageshow', (e) => { if (e.persisted) boot(); });

    logoutButton.addEventListener('click', async () => {
        if (logoutButton.disabled) return;
        logoutButton.disabled = true;
        logoutButton.textContent = 'Logging out...';
        authorized = false;
        html.classList.remove('admin-authorized');

        try {
            await logout();
            location.replace('../../login.html');
        } catch (err) {
            console.error('Logout failed:', err);
            logoutButton.disabled = false;
            logoutButton.textContent = 'Log out';
            toast('Logout failed. Please try again.');
            boot();
        }
    });
}

setupChrome();
boot();
