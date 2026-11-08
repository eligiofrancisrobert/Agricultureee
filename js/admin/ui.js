    // Small shared helpers. Strings are always appended as text nodes, so user data can't inject HTML.

    export const ROLE = {
        farmer: { label: 'Farmers', color: 'var(--primary-color)' },
        buyer: { label: 'Buyers', color: 'var(--warning)' },
        supplier: { label: 'Suppliers', color: 'var(--secondary)' },
    };

    export const STATUS = {
        active: { label: 'Active', color: 'var(--success)' },
        pending: { label: 'Pending', color: 'var(--warning)' },
        rejected: { label: 'Rejected', color: 'var(--secondary-text)' },
        suspended: { label: 'Suspended', color: 'var(--error)' },
    };

    /** Create an HTML element, bind on* attributes, and append text or nodes. */
    export const h = (tag, attrs = {}, ...kids) => {
        const el = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs || {})) {
            if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
            else if (k === 'class') el.className = v;
            else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
        }
        el.append(...kids.flat().filter((k) => k != null && k !== false));
        return el;
    };

    const NS = 'http://www.w3.org/2000/svg';
    const svg = (tag, attrs = {}, ...kids) => {
        const el = document.createElementNS(NS, tag);
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
        el.append(...kids);
        return el;
    };
    const svgText = (attrs, text) => svg('text', attrs, text);

    export const fmtDate = (iso) =>
        new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });

    export const fmtDateTime = (iso) =>
        new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

    export const badge = (status) => h('span', { class: `badge ${status}` }, STATUS[status]?.label ?? status);

    // Online/offline pill (reuses the existing green "active" and grey "rejected" badge colours).
    export const presence = (u) =>
        h('span', { class: `badge ${u.online ? 'active' : 'rejected'}` }, u.online ? 'Online' : 'Offline');

    export const lastLogin = (u) => (u.last_login ? fmtDateTime(u.last_login) : 'Never');

    export const person = (u) =>
        h('div', { class: 'person' },
            h('span', { class: 'avatar' }, u.name.split(' ').map((p) => p[0]).slice(0, 2).join('')),
            h('div', {}, h('b', {}, u.name)));

    export const pageHead = (title, sub, ...actions) =>
        h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, title), h('p', {}, sub)), ...actions);

    export const select = (options, value, onChange, label) =>
        h('select', { 'aria-label': label, onchange: (e) => onChange(e.target.value) },
            options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));


    /** Build a table from column renderers, including a configurable empty row. */
    export function table(cols, rows, empty = 'Nothing to show yet.') {
        return h('div', { class: 'table-wrap' },
            h('table', {},
                h('thead', {},
                    h('tr', {},
                        cols.map((c) => h('th', {}, c.label))
                    )
                ),
                h('tbody', {},
                    rows.length
                        ? rows.map((r) => h('tr', {},
                            cols.map((c) => h('td', {
                                class: c.label === 'Details'
                                    ? 'audit-details-td'
                                    : ''
                            }, c.cell(r)))
                        ))
                        : h('tr', {},
                            h('td', {
                                colspan: cols.length,
                                class: 'empty'
                            }, empty)
                        )
                )
            )
        );
    }


    let toastTimer;
    /** Show a temporary message using the shared admin toast element. */
    export function toast(message) {
        const t = document.getElementById('toast');
        t.textContent = message;
        t.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => (t.hidden = true), 2600);
    }

    /** Draw a donut chart from labeled values and their colors. */
    export function donut(items) {
        const total = items.reduce((a, i) => a + i.value, 0);
        const R = 70, C = 2 * Math.PI * R;
        let offset = 0;
        const el = svg('svg', { viewBox: '0 0 200 200', class: 'donut', role: 'img', 'aria-label': `Total ${total}` });
        el.append(svg('circle', { cx: 100, cy: 100, r: R, fill: 'none', stroke: 'var(--mint)', 'stroke-width': 30 }));
        for (const i of items) {
            const len = total ? (i.value / total) * C : 0;
            el.append(svg('circle', {
                cx: 100, cy: 100, r: R, fill: 'none', stroke: i.color, 'stroke-width': 30,
                'stroke-dasharray': `${len} ${C - len}`, 'stroke-dashoffset': -offset, transform: 'rotate(-90 100 100)',
            }));
            offset += len;
        }
        el.append(
            svgText({ x: 100, y: 102, 'text-anchor': 'middle', 'font-size': 30, 'font-weight': 600, fill: 'var(--text)' }, total),
            svgText({ x: 100, y: 124, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--muted)' }, 'users'));
        return el;
    }

    /** Draw weekly series and show the values at the pointer's nearest day. */
    export function lineChart(labels, series) {
        const W = 640, H = 230, L = 30, R = 10, T = 10, B = 26;
        const max = Math.max(1, ...series.flatMap((s) => s.values));
        const step = (W - L - R) / (labels.length - 1);
        const x = (i) => L + i * step;
        const y = (v) => T + (H - T - B) * (1 - v / max);

        const el = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'line-chart', role: 'img', 'aria-label': 'Weekly registrations by role' });
        for (let g = 0; g <= 4; g++) {
            const v = (max * g) / 4;
            el.append(svg('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: 'var(--border)' }),
                svgText({ x: L - 6, y: y(v) + 4, 'text-anchor': 'end' }, Math.round(v)));
        }
        labels.forEach((l, i) => el.append(svgText({ x: x(i), y: H - 6, 'text-anchor': 'middle' }, l)));
        for (const s of series) {
            el.append(svg('polyline', {
                fill: 'none', stroke: s.color, 'stroke-width': 2.5, 'stroke-linejoin': 'round',
                points: s.values.map((v, i) => `${x(i)},${y(v)}`).join(' '),
            }));
        }

        const guide = svg('line', { y1: T, y2: H - B, stroke: 'var(--muted)', 'stroke-dasharray': '4', visibility: 'hidden' });
        const tip = h('div', { class: 'tip', hidden: true });
        el.append(guide);

        el.addEventListener('pointermove', (e) => {
            const box = el.getBoundingClientRect();
            const px = ((e.clientX - box.left) / box.width) * W;
            const i = Math.min(labels.length - 1, Math.max(0, Math.round((px - L) / step)));
            guide.setAttribute('x1', x(i));
            guide.setAttribute('x2', x(i));
            guide.setAttribute('visibility', 'visible');
            tip.replaceChildren(h('b', {}, labels[i]),
                ...series.map((s) => h('div', {}, h('i', { style: `background:${s.color}` }), s.name, h('span', {}, s.values[i]))));
            tip.style.left = `${Math.min((x(i) / W) * 100, 68)}%`;
            tip.hidden = false;
        });
        el.addEventListener('pointerleave', () => { guide.setAttribute('visibility', 'hidden'); tip.hidden = true; });

        return h('div', { class: 'chart-wrap' }, el, tip);
    }