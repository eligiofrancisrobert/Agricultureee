const MOBILE_QUERY = '(max-width: 900px)';

/** Add the responsive sidebar drawer controls when the page has a sidebar. */
export function initSidebarMenu() {
    const sidebar = document.querySelector('.sidebar');

    // Nothing to do on pages without a sidebar, or if already set up.
    if (!sidebar || document.querySelector('.menu-bar')) return;

    const media = window.matchMedia(MOBILE_QUERY);

    if (!sidebar.id) sidebar.id = 'app-sidebar';

    /* ---------- Menu bar ---------- */
    const bar = document.createElement('header');
    bar.className = 'menu-bar';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'menu-toggle';
    toggle.setAttribute('aria-controls', sidebar.id);
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open menu');

    for (let i = 0; i < 3; i += 1) {
        const line = document.createElement('span');
        line.className = 'menu-toggle-bar';
        toggle.append(line);
    }

    bar.append(toggle);

    // Reuse the sidebar logo so the brand stays visible in the bar.
    const brand = sidebar.querySelector('.brand, .logo');

    if (brand) {
        const brandCopy = brand.cloneNode(true);

        brandCopy.removeAttribute('id');
        brandCopy.querySelectorAll('[id]').forEach(node => {
            node.removeAttribute('id');
        });

        bar.append(brandCopy);
    }

    /* ---------- Backdrop ---------- */
    const backdrop = document.createElement('div');
    backdrop.className = 'menu-backdrop';
    backdrop.setAttribute('aria-hidden', 'true');

    document.body.prepend(bar);
    document.body.append(backdrop);
    document.documentElement.classList.add('has-menu-bar');

    /* ---------- Account controls (cart, notifications, profile) ---------- */
    // On small screens they move into the menu bar; on desktop they go back.
    const topbar = document.querySelector('.topbar');
    const topbarRight = topbar?.querySelector('.topbar-right');
    const chip = topbarRight?.querySelector('.chip');

    function placeAccountControls() {
        if (!topbar || !topbarRight) return;

        if (media.matches) {
            bar.append(topbarRight);
            if (chip) topbar.append(chip); // date + theme toggle stay in the page
        } else {
            topbar.append(topbarRight);
            if (chip) topbarRight.prepend(chip);
        }
    }

    placeAccountControls();
    media.addEventListener('change', placeAccountControls);

    /* ---------- Open / close ---------- */
    /** Apply the drawer state only while the mobile media query matches. */
    function setOpen(open) {
        const isOpen = Boolean(open) && media.matches;

        sidebar.classList.toggle('is-open', isOpen);
        backdrop.classList.toggle('is-visible', isOpen);
        document.body.classList.toggle('menu-open', isOpen);

        toggle.setAttribute('aria-expanded', String(isOpen));
        toggle.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu');
    }

    toggle.addEventListener('click', () => {
        setOpen(!sidebar.classList.contains('is-open'));
    });

    backdrop.addEventListener('click', () => setOpen(false));

    // Close after choosing a page.
    sidebar.addEventListener('click', event => {
        if (event.target.closest('a')) setOpen(false);
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && sidebar.classList.contains('is-open')) {
            setOpen(false);
            toggle.focus();
        }
    });

    window.addEventListener('hashchange', () => setOpen(false));

    // Leaving the small-screen layout (rotate, resize) resets the drawer.
    media.addEventListener('change', () => setOpen(false));
}

/**
 * Dashboard summary cards: find the first group of 3-8 sibling cards that each
 * show a number, and tag it so sidebar.css can show them two per row on phones.
 * Works on any role page, no card titles or class names needed.
 */
const NUMBER_RE = /^[\p{Sc}]?\s*[\d.,]+\s*[%kKmM]?$/u;

function markStatGrid() {
    const view = document.getElementById('view');
    if (!view || view.querySelector('.fm-stat-grid')) return;

    const hasNumber = el => [...el.querySelectorAll('*')].some(
        node => node.children.length === 0 && NUMBER_RE.test(node.textContent.trim())
    );

    for (const parent of view.querySelectorAll('*')) {
        const kids = [...parent.children];
        if (kids.length < 3 || kids.length > 8) continue;

        const isStatGrid = kids.every(kid =>
            kid.tagName === kids[0].tagName &&
            kid.textContent.trim().length < 80 &&
            hasNumber(kid)
        );
        if (!isStatGrid) continue;

        parent.classList.add('fm-stat-grid');
        kids.forEach(kid => kid.classList.add('fm-stat-card'));
        return;
    }
}

function initStatGrid() {
    const view = document.getElementById('view');
    if (!view) return;

    markStatGrid();
    // The dashboard is rendered by main.js, so watch for it.
    new MutationObserver(markStatGrid).observe(view, { childList: true, subtree: true });
}

function start() {
    initSidebarMenu();
    initStatGrid();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
    start();
}