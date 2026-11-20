/**
 * table-cards.js
 * Turns the accountant tables into mobile cards (styling is in table-cards.css).
 *
 *  - Copies each <th> text into the matching <td data-label>, so the JS that
 *    renders rows no longer has to add data-label by hand.
 *  - Tags each row/cell with a role (title, status, key value, extra, actions).
 *  - Colors the card's accent by its status badge (paid, pending, refunded...).
 *  - Long rows (more than 6 columns) collapse; tap the card to show or hide the rest.
 *
 * Works for rows that are rendered later by page scripts (MutationObserver).
 */

const MOBILE = window.matchMedia('(max-width: 760px)');

// Tables to convert. Modal item tables (.items-table) are left alone.
const TABLE_SELECTOR =
    '.data-table:not(.items-table), .produce-table, .sales-table, .ar-table';

// Rows with more columns than this collapse on small screens.
const MAX_FLAT_CELLS = 6;

// Columns that stay visible when a long card is collapsed (matched on header text).
const ALWAYS_SHOW = /status|amount|total|price|paid|balance|revenue|buyer|customer|date/i;

// Status badge text/class -> accent color. First match wins.
const TONES = [
    ['warning', /unpaid|pending|processing|partial|warning/i],
    ['error', /cancel|reject|fail|overdue/i],
    ['muted', /refund/i],
    ['success', /\bpaid\b|confirmed|delivered|completed|success|approved/i],
];

const ROLE_CLASSES = ['ac-head', 'ac-status', 'ac-key', 'ac-extra', 'ac-actions'];

/* ---------- Per-row work ---------- */

function toneFor(badge) {
    const text = `${badge.className} ${badge.textContent}`;
    const match = TONES.find(([, pattern]) => pattern.test(text));
    return match ? match[0] : null;
}

function enhanceRow(row, headers, index) {
    const cells = [...row.children].filter(cell => cell.tagName === 'TD');

    // Loading / empty / error rows (single cell or colspan) are not cards.
    if (cells.length < 2 || cells.some(cell => cell.colSpan > 1)) return;

    row.classList.add('ac-card');
    row.style.setProperty('--ac-i', String(Math.min(index, 8)));

    const collapsible = cells.length > MAX_FLAT_CELLS;
    let statusCell = null;

    cells.forEach((cell, i) => {
        cell.classList.remove(...ROLE_CLASSES);
        cell.classList.add('ac-cell');

        if (!cell.dataset.label && headers[i]) cell.dataset.label = headers[i];

        const label = cell.dataset.label || '';
        const isLast = i === cells.length - 1;
        const hasControls = Boolean(
            cell.querySelector('button, a, .action-buttons, .row-actions')
        );

        let role;
        if (i === 0) {
            role = 'ac-head';
        } else if (isLast && hasControls) {
            role = 'ac-actions';
        } else if (!statusCell && cell.querySelector('.status-badge')) {
            statusCell = cell;
            role = 'ac-status';
        } else if (
            ALWAYS_SHOW.test(label) ||
            cell.matches('.amount-cell, .produce-price') ||
            cell.querySelector('.status-badge')
        ) {
            role = 'ac-key';
        } else {
            role = 'ac-extra';
        }

        cell.classList.add(role);
    });

    // Header layout: title + status pill, or title only.
    row.classList.toggle('ac-has-status', Boolean(statusCell));

    // Accent color from the first status badge.
    ['success', 'warning', 'error', 'muted'].forEach(tone => {
        row.classList.remove(`ac-tone-${tone}`);
    });
    const badge = row.querySelector('.status-badge');
    const tone = badge ? toneFor(badge) : null;
    if (tone) row.classList.add(`ac-tone-${tone}`);

    // Tap to expand (long rows only).
    row.classList.toggle('ac-collapsible', collapsible);
    if (collapsible) {
        row.setAttribute('aria-expanded', String(row.classList.contains('is-expanded')));
        row.tabIndex = MOBILE.matches ? 0 : -1;
    } else {
        row.removeAttribute('aria-expanded');
        row.removeAttribute('tabindex');
    }
}

/* ---------- Per-table work ---------- */

function enhanceTable(table) {
    const headers = [...table.querySelectorAll('thead th')].map(th =>
        th.textContent.trim()
    );
    if (!headers.length) return;

    table.classList.add('ac-cards');
    table.parentElement?.classList.add('ac-cards-wrap');

    table.querySelectorAll(':scope > tbody > tr').forEach((row, index) => {
        enhanceRow(row, headers, index);
    });
}

function enhanceAll() {
    document.querySelectorAll(TABLE_SELECTOR).forEach(enhanceTable);
}

/* ---------- Expand / collapse ---------- */

function toggleRow(row) {
    const open = !row.classList.contains('is-expanded');
    row.classList.toggle('is-expanded', open);
    row.setAttribute('aria-expanded', String(open));
}

document.addEventListener('click', event => {
    if (!MOBILE.matches) return;

    const row = event.target.closest('tr.ac-collapsible');
    if (!row) return;

    // Let buttons, links and form fields do their own thing.
    if (event.target.closest('a, button, input, select, textarea, label')) return;

    toggleRow(row);
});

document.addEventListener('keydown', event => {
    if (!MOBILE.matches) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;

    const row = event.target;
    if (!(row instanceof HTMLElement) || !row.matches('tr.ac-collapsible')) return;

    event.preventDefault();
    toggleRow(row);
});

// Rows are only keyboard-focusable while the card layout is active.
MOBILE.addEventListener('change', () => {
    document.querySelectorAll('tr.ac-collapsible').forEach(row => {
        row.tabIndex = MOBILE.matches ? 0 : -1;
    });
});

/* ---------- Watch for rows rendered later ---------- */

let queued = false;

function schedule() {
    if (queued) return;
    queued = true;

    requestAnimationFrame(() => {
        queued = false;
        enhanceAll();
    });
}

function start() {
    enhanceAll();

    // Only class/attribute changes are made above, so this does not loop.
    new MutationObserver(schedule).observe(document.body, {
        childList: true,
        subtree: true,
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
    start();
}