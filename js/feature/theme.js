const KEY = 'theme';
const OLD_KEY = 'tanikala-theme';
const root = document.documentElement;

function getSaved() {
    try {
        // Use the shared key, and fall back to the old one so nobody loses their saved choice.
        return localStorage.getItem(KEY) || localStorage.getItem(OLD_KEY);
    } catch {
        return null;
    }
}
function save(theme) {
    try {
        localStorage.setItem(KEY, theme);
    } catch {
        // Ignore blocked storage.
    }
}

function applyTheme(theme) {
    root.setAttribute('data-theme', theme);

    const toggle = document.getElementById('themeToggle');

    if (toggle) {
        const isDark = theme === 'dark';

        toggle.setAttribute('aria-pressed', String(isDark));
        toggle.setAttribute(
            'aria-label',
            isDark ? 'Switch to light mode' : 'Switch to dark mode'
        );
    }
}

// Apply the saved theme before the page paints.
applyTheme(getSaved() === 'dark' ? 'dark' : 'light');

document.addEventListener('DOMContentLoaded', () => {
    // Theme toggle
    const themeToggle = document.getElementById('themeToggle');

    if (themeToggle) {
        applyTheme(root.getAttribute('data-theme'));

        themeToggle.addEventListener('click', () => {
            const next =
                root.getAttribute('data-theme') === 'dark'
                    ? 'light'
                    : 'dark';

            applyTheme(next);
            save(next);
        });
    }

    // Mobile navigation (only on pages with these elements)
    const menuToggle = document.getElementById('menuToggle');
    const siteNav = document.getElementById('siteNav');

    if (menuToggle && siteNav) {
        menuToggle.addEventListener('click', () => {
            const isOpen = siteNav.classList.toggle('open');

            menuToggle.setAttribute('aria-expanded', String(isOpen));
            menuToggle.setAttribute(
                'aria-label',
                isOpen ? 'Close navigation' : 'Open navigation'
            );
            menuToggle.textContent = isOpen ? '×' : '☰';
        });

        siteNav.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                siteNav.classList.remove('open');
                menuToggle.setAttribute('aria-expanded', 'false');
                menuToggle.setAttribute('aria-label', 'Open navigation');
                menuToggle.textContent = '☰';
            });
        });
    }

    // Reveal service cards as they enter the viewport.
    const serviceCards = document.querySelectorAll('.service-card');

    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver(
            (entries, currentObserver) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('is-visible');
                        currentObserver.unobserve(entry.target);
                    }
                });
            },
            {
                threshold: 0.14,
                rootMargin: '0px 0px -35px 0px'
            }
        );

        serviceCards.forEach(card => observer.observe(card));
    } else {
        serviceCards.forEach(card => {
            card.classList.add('is-visible');
        });
    }

    // Footer year (only on pages containing #year).
    const yearElement = document.getElementById('year');

    if (yearElement) {
        yearElement.textContent = new Date().getFullYear();
    }
});
