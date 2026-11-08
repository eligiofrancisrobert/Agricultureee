import { h, donut, lineChart, pageHead, ROLE, STATUS } from './ui.js';
import { getStats } from './api.js';

const statBox = (label, value, cls = '') =>
    h('div', { class: `stat-box ${cls}` }, h('small', {}, label), h('b', {}, value));

/** Render platform totals, registration activity, and approval statistics. */
export async function render(root) {
    const s = await getStats();
    let mode = 'role';

    // --- Users overview (donut) ---
    const tabs = h('div', { class: 'tabs' });
    const overview = h('div', { class: 'donut-row' });

    const draw = () => {
        const meta = mode === 'role' ? ROLE : STATUS;
        const data = mode === 'role' ? s.byRole : s.byStatus;
        const items = Object.entries(meta).map(([k, m]) => ({ label: m.label, color: m.color, value: data[k] }));
        const pct = (v) => (s.total ? Math.round((v / s.total) * 100) : 0);

        overview.replaceChildren(
            donut(items),
            h('ul', { class: 'legend' }, items.map((i) =>
                h('li', {}, h('i', { style: `background:${i.color}` }),
                    h('div', {}, h('b', {}, i.label), h('small', {}, `${i.value} users (${pct(i.value)}%)`))))));

        tabs.replaceChildren(...[['role', 'By role'], ['status', 'By status']].map(([k, label]) =>
            h('button', { type: 'button', class: k === mode ? 'on' : '', onclick: () => { mode = k; draw(); } }, label)));
    };
    draw();

    // --- Queue panel ---
    const queue = h('section', { class: 'hero' },
        h('div', { class: 'hero-card' },
            h('div', { class: 'hero-head' },
                h('h3', {}, 'Applications queue'),
                h('a', { class: 'btn ghost', href: '#applications' }, 'Review applications')),
            h('div', { class: 'stat-boxes' },
                statBox('Pending', s.pending, 'warn'),
                statBox('Active', s.byStatus.active),
                statBox('Suspended', s.byStatus.suspended))));

    // --- Weekly registrations ---
    const w = s.weekly;
    const roles = Object.keys(ROLE);
    const sum = (a) => a.reduce((x, y) => x + y, 0);

    const growth = h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', {}, 'Registrations this week')),
        h('div', { class: 'tiles' }, roles.map((r) =>
            h('div', { class: 'tile', style: `--c:${ROLE[r].color}` }, h('small', {}, ROLE[r].label), h('b', {}, sum(w[r]))))),
        lineChart(w.labels, roles.map((r) => ({ name: ROLE[r].label, color: ROLE[r].color, values: w[r] }))));

    // --- Approval rate ---
    const approval = h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', {}, 'Approval rate'), h('a', { href: '#audit', class: 'muted' }, 'View logs')),
        h('ul', { class: 'bars' }, s.approval.map((a) =>
            h('li', {},
                h('b', {}, ROLE[a.role].label),
                h('div', {},
                    h('div', { class: 'bar' }, h('span', { style: `width:${a.rate}%;background:${ROLE[a.role].color}` })),
                    h('small', {}, `${a.approved} of ${a.decided} approved`)),
                h('span', { class: 'pct' }, `${a.rate}%`)))));

    root.append(
        pageHead('Dashboard', 'Platform activity at a glance.'),
        h('div', { class: 'grid-top' }, h('section', { class: 'card' }, h('h2', {}, 'Users overview'), tabs, overview), queue),
        h('div', { class: 'grid-bottom' }, growth, approval));
}
