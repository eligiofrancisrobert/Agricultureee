

export function initSidebarMenu({ breakpoint = 900, swipeDistance = 60 } = {}) {
    const shell = document.querySelector('.shell');
    const main = document.querySelector('.main');
    const sidebar = document.getElementById('sidebar');
    const toggle = document.getElementById('menuToggle');
    const closeButton = document.getElementById('menuClose');
    const backdrop = document.getElementById('sidebarBackdrop');

    if (!shell || !main || !sidebar || !toggle || !backdrop) {
        console.warn('Sidebar menu: required elements are missing.');
        return () => {};
    }

    const OPEN_CLASS = 'menu-open';
    const LOCK_CLASS = 'menu-locked';

    const mobileQuery = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const controller = new AbortController();
    const { signal } = controller;

    let lastFocused = null;

    const isMobile = () => mobileQuery.matches;
    const isOpen = () => shell.classList.contains(OPEN_CLASS);

    /**
     * Keep ARIA, scroll locking, and focus containment in step with the
     * open/closed state.
     * - Closed on mobile: the off-screen drawer is inert, so its links
     *   can't be tabbed to or read by screen readers.
     * - Open: the page behind it is inert, which keeps focus in the drawer.
     */
    function syncState() {
        const open = isOpen();

        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');

        document.body.classList.toggle(LOCK_CLASS, open);

        sidebar.inert = isMobile() && !open;
        main.inert = open;
    }

    function openMenu() {
        if (!isMobile() || isOpen()) return;

        lastFocused = document.activeElement;

        shell.classList.add(OPEN_CLASS);
        syncState();

        // Move focus into the drawer: the current page's link, else the first one.
        requestAnimationFrame(() => {
            const target =
                sidebar.querySelector('.nav a.active, .nav a[aria-current="page"]') ||
                sidebar.querySelector('.nav a');

            target?.focus({ preventScroll: true });
        });
    }

    function closeMenu({ restoreFocus = true } = {}) {
        if (!isOpen()) return;

        shell.classList.remove(OPEN_CLASS);
        syncState();

        if (restoreFocus) {
            const target = lastFocused?.isConnected ? lastFocused : toggle;
            target.focus({ preventScroll: true });
        }

        lastFocused = null;
    }

    // Hamburger and close buttons
    toggle.addEventListener('click', () => {
        isOpen() ? closeMenu() : openMenu();
    }, { signal });

    closeButton?.addEventListener('click', () => closeMenu(), { signal });

    // Tap outside the drawer
    backdrop.addEventListener('click', () => closeMenu(), { signal });

    // Escape closes the drawer
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && isOpen()) {
            event.preventDefault();
            closeMenu();
        }
    }, { signal });

    // Choosing a section closes the drawer
    sidebar.addEventListener('click', event => {
        if (event.target.closest('.nav a')) closeMenu();
    }, { signal });

    // Back/forward button or other hash navigation while the drawer is open
    window.addEventListener('hashchange', () => {
        closeMenu({ restoreFocus: false });
    }, { signal });

    // Keep Tab cycling inside the drawer while it is open
    sidebar.addEventListener('keydown', event => {
        if (event.key !== 'Tab' || !isOpen()) return;

        const focusable = [
            ...sidebar.querySelectorAll('a[href], button:not([disabled])')
        ].filter(element => element.offsetParent !== null);

        if (!focusable.length) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }, { signal });

    // Swipe left on the drawer to close it
    let touchStartX = 0;
    let touchStartY = 0;

    sidebar.addEventListener('touchstart', event => {
        const touch = event.changedTouches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
    }, { passive: true, signal });

    sidebar.addEventListener('touchend', event => {
        const touch = event.changedTouches[0];
        const dx = touch.clientX - touchStartX;
        const dy = touch.clientY - touchStartY;

        // Mostly horizontal, leftward swipe
        if (dx <= -swipeDistance && Math.abs(dy) < Math.abs(dx) / 2) {
            closeMenu();
        }
    }, { passive: true, signal });

    // Resizing past the breakpoint (e.g. rotating a tablet) resets everything
    mobileQuery.addEventListener('change', () => {
        closeMenu({ restoreFocus: false });
        syncState();
    }, { signal });

    syncState();

    // Cleanup, for when the shell is torn down
    return function destroySidebarMenu() {
        controller.abort();

        shell.classList.remove(OPEN_CLASS);
        document.body.classList.remove(LOCK_CLASS);

        sidebar.inert = false;
        main.inert = false;
    };
}