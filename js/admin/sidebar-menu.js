
const MOBILE_QUERY = '(max-width: 800px)';

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

    /* ---------- Open / close ---------- */
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

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSidebarMenu, { once: true });
} else {
    initSidebarMenu();
}