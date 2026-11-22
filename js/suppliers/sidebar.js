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

    /* ---------- Account controls (profile) ---------- */
    // On small screens they move into the menu bar; on desktop they go back.
    const topbar = document.querySelector('.topbar');
    const topbarRight = topbar?.querySelector('.topbar-right');
    const chip = topbarRight?.querySelector('.chip');
    const themeButton = chip?.querySelector('#themeToggle, .icon-btn');

    function placeAccountControls() {
        if (!topbar || !topbarRight) return;

        if (media.matches) {
            // Theme toggle joins the avatar in the bar; the date is hidden by CSS.
            bar.append(topbarRight);
            if (themeButton) topbarRight.prepend(themeButton);
            if (chip) topbar.append(chip);
        } else {
            // Desktop: put the toggle back inside the date chip.
            if (themeButton && chip) chip.append(themeButton);
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

function startSidebar() {
    initSidebarMenu();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startSidebar, { once: true });
} else {
    startSidebar();
}

/**
 * Copies each table header's text onto its cells as data-label so the CSS can
 * show "Label: value" rows when tables turn into cards on small screens.
 * Views are rendered by page scripts, so a MutationObserver relabels new tables.
 */
const ROOT_SELECTOR = '#view';

function labelTable(table) {
    const headers = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim());
    if (!headers.length) return;

    table.querySelectorAll('tbody tr').forEach(row => {
        const cells = [...row.children].filter(el => el.tagName === 'TD');

        // Empty-state rows (one wide cell) are not labelled.
        if (cells.length === 1 && cells[0].colSpan > 1) {
            row.classList.add('table-empty-row');
            return;
        }

        cells.forEach((cell, index) => {
            if (!cell.hasAttribute('data-label') && headers[index]) {
                cell.setAttribute('data-label', headers[index]);
            }
        });
    });
}

function labelAllTables() {
    document.querySelectorAll(`${ROOT_SELECTOR} table`).forEach(labelTable);
}

function startTableLabels() {
    const root = document.querySelector(ROOT_SELECTOR);
    if (!root) return;

    let queued = false;
    new MutationObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
            queued = false;
            labelAllTables();
        });
    }).observe(root, { childList: true, subtree: true });

    labelAllTables();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startTableLabels, { once: true });
} else {
    startTableLabels();
}