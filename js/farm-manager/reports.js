
import { supabase } from '../connection.js';
import { h, pageHead } from '../admin/ui.js';
import { loadFarms } from './farms.js';

const PREVIEW_PAGE_SIZE = 5;
const DUE_SOON_DAYS = 7;
const TERMINAL_CROP_STATUSES = ['harvested', 'failed', 'cancelled'];

const SVG_NS = 'http://www.w3.org/2000/svg';

const ICON = {
    sprout: ['M12 21v-8', 'M12 13C7 13 4 10 4 5c5 0 8 3 8 8Z', 'M12 16c0-4 3-7 8-7 0 5-3 8-8 8'],
    barn: ['M4 21V10l8-6 8 6v11', 'M9 21v-7h6v7', 'M9 14l6 7M15 14l-6 7', 'M2 21h20'],
    basket: [
        'M7 10V8a5 5 0 0 1 10 0v2',
        'M3 10h18l-1.5 9a2 2 0 0 1-2 1.7h-11a2 2 0 0 1-2-1.7L3 10Z',
        'M9 14v3',
        'M15 14v3'
    ],
    clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 7v5l3 2'],
    download: ['M12 3v12', 'm7 10 5 5 5-5', 'M4 21h16'],
    eye: [
        'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z',
        'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'
    ]
};

function icon(paths, size = 20) {
    const svg = document.createElementNS(SVG_NS, 'svg');

    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');

    for (const d of paths) {
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', d);
        svg.append(path);
    }

    return svg;
}

/* ---------- Data ---------- */
async function loadPlantings(farmIds) {
    if (!farmIds?.length) return [];

    const { data, error } = await supabase
        .from('farm_plantings')
        .select(`
            id,
            activity_status,
            crop_status,
            crop_name,
            field_id,
            sowing_date,
            expected_harvest_date,
            farm_fields!inner (
                farm_id
            ),
            harvested_crops (
                harvest_quantity,
                harvest_unit,
                confirmation_status
            )
        `)
        .in('farm_fields.farm_id', farmIds)
        .order('expected_harvest_date', { ascending: true });

    if (error) {
        console.error('Failed to load planting records:', error);
        throw error;
    }

    return (data ?? []).map((planting) => ({
        ...planting,
        farm_id: planting.farm_fields.farm_id
    }));
}

async function loadCropStatusLabels() {
    const { data, error } = await supabase
        .from('crop_statuses')
        .select('code, label, display_order')
        .eq('is_active', true)
        .order('display_order', { ascending: true });

    if (error) throw error;

    return new Map((data ?? []).map((status) => [status.code, status.label]));
}

/* ---------- Helpers ---------- */
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

const formatDate = (value) => {
    if (!value) return 'Not set';

    const date = new Date(`${value}T00:00:00`);

    return Number.isNaN(date.getTime())
        ? String(value)
        : date.toLocaleDateString('en-PH', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
};

const statusLabel = (status, labels) => {
    const code = status?.trim();

    if (code && labels?.get(code)) return labels.get(code);

    const text = (code || 'unknown').replace(/[_-]+/g, ' ');

    return text.replace(/\b\w/g, (character) => character.toUpperCase());
};

const statusSlug = (status) =>
    (status?.trim().toLowerCase() || 'unknown').replace(/[^a-z0-9_-]/g, '');

function startOfToday() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
}

function isUpcoming(planting, today) {
    if (!planting.expected_harvest_date) return false;

    const harvestDate = new Date(`${planting.expected_harvest_date}T00:00:00`);

    return (
        harvestDate >= today &&
        !TERMINAL_CROP_STATUSES.includes(
            planting.crop_status?.trim().toLowerCase()
        )
    );
}

function isDueSoon(planting, today) {
    if (!isUpcoming(planting, today)) return false;

    const limit = new Date(today);
    limit.setDate(limit.getDate() + DUE_SOON_DAYS);

    return new Date(`${planting.expected_harvest_date}T00:00:00`) <= limit;
}

function getConfirmedHarvestTotals(planting) {
    const totalsByUnit = new Map();

    for (const harvest of planting.harvested_crops ?? []) {
        if (harvest.confirmation_status !== 'confirmed') continue;

        const unit = harvest.harvest_unit?.trim() || 'Unspecified';
        const quantity = Number(harvest.harvest_quantity);

        if (!Number.isFinite(quantity)) continue;

        totalsByUnit.set(
            unit,
            (totalsByUnit.get(unit) ?? 0) + quantity
        );
    }

    const entries = [...totalsByUnit.entries()];

    return {
        Quantity: entries.length
            ? entries.map(([, quantity]) =>
                Number(quantity.toFixed(3)).toString()
            ).join(', ')
            : '—',
        Unit: entries.length
            ? entries.map(([unit]) => unit).join(', ')
            : '—'
    };
}

function toCsv(columns, rows) {
    const escape = (value) =>
        `"${String(value ?? '').replace(/"/g, '""')}"`;

    return [
        columns.map(escape).join(','),
        ...rows.map((row) => columns.map((col) => escape(row[col])).join(','))
    ].join('\r\n');
}

/** Download the selected report rows as a CSV file. */
function downloadCsv(report) {
    const csv = toCsv(report.columns, report.csvRows ?? report.rows);
    const blob = new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 10);

    const link = document.createElement('a');
    link.href = url;
    link.download = `${report.id}-${stamp}.csv`;
    document.body.append(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);
}

/* ---------- Report definitions ---------- */
function buildReports(farms, plantings, cropLabels) {
    const farmById = new Map(farms.map((farm) => [farm.id, farm]));
    const today = startOfToday();

    const plantingRow = (planting) => {
        const farm = farmById.get(planting.farm_id);

        return {
            Crop: planting.crop_name || 'Unnamed crop',
            Farm: farm?.farm_name || 'Unnamed farm',
            Location: farm?.farm_location || 'Location not set',
            'Sowing date': formatDate(planting.sowing_date),
            'Expected harvest': formatDate(planting.expected_harvest_date),
            'Crop status': statusLabel(planting.crop_status, cropLabels),
            _status: statusSlug(planting.crop_status),
            ...getConfirmedHarvestTotals(planting)
        };
    };

    const plantingCsvRow = (planting) => {
        const farm = farmById.get(planting.farm_id);

        return {
            Crop: planting.crop_name || 'Unnamed crop',
            Farm: farm?.farm_name || 'Unnamed farm',
            Location: farm?.farm_location || 'Location not set',
            'Sowing date': planting.sowing_date ?? '',
            'Expected harvest': planting.expected_harvest_date ?? '',
            'Crop status': statusLabel(planting.crop_status, cropLabels),
            ...getConfirmedHarvestTotals(planting)
        };
    };

    const upcoming = plantings.filter((planting) => isUpcoming(planting, today));

    const harvested = plantings.filter(
        (planting) =>
            planting.crop_status?.trim().toLowerCase() === 'harvested'
    );

    const countByFarm = new Map();

    for (const planting of plantings) {
        countByFarm.set(
            planting.farm_id,
            (countByFarm.get(planting.farm_id) ?? 0) + 1
        );
    }

    const plantingColumns = [
        'Crop',
        'Farm',
        'Location',
        'Sowing date',
        'Expected harvest',
        'Crop status'
    ];

    const farmRows = farms.map((farm) => ({
        Farm: farm.farm_name || 'Unnamed farm',
        Location: farm.farm_location || 'Location not set',
        Farmer: farm.farmerName || 'Not set',
        Plantings: countByFarm.get(farm.id) ?? 0
    }));

    return [
        {
            id: 'planting-summary',
            title: 'Planting Summary',
            description: 'Every planting record across your assigned farms.',
            iconPaths: ICON.sprout,
            color: 'var(--success)',
            columns: plantingColumns,
            rows: plantings.map(plantingRow),
            csvRows: plantings.map(plantingCsvRow)
        },
        {
            id: 'harvest-report',
            title: 'Harvest Report',
            description: 'Plantings that have been confirmed as harvested.',
            iconPaths: ICON.basket,
            color: 'var(--success)',
            columns: [...plantingColumns, 'Quantity', 'Unit'],
            rows: harvested.map(plantingRow),
            csvRows: harvested.map(plantingCsvRow)
        },
        {
            id: 'harvest-forecast',
            title: 'Harvest Forecast',
            description: 'Plantings that are expected to be harvested soon.',
            iconPaths: ICON.basket,
            color: 'var(--warning)',
            columns: plantingColumns,
            rows: upcoming.map(plantingRow),
            csvRows: upcoming.map(plantingCsvRow)
        },
        {
            id: 'farm-overview',
            title: 'Farm Overview',
            description: 'Assigned farms with their location, farmer and plantings.',
            iconPaths: ICON.barn,
            color: 'var(--primary-color, var(--primary))',
            columns: ['Farm', 'Location', 'Farmer', 'Plantings'],
            rows: farmRows,
            csvRows: farmRows
        }
    ];
}

/* ---------- Building blocks ---------- */
const emptyNote = (text) => h('p', { class: 'fm-empty' }, text);

function statCard({ label, value, sub, color, iconPaths }) {
    return h(
        'div',
        { class: 'fm-stat-card', style: `--c:${color}` },
        h('span', { class: 'fm-stat-icon' }, icon(iconPaths, 26)),
        h(
            'div',
            { class: 'fm-stat-body' },
            h('span', { class: 'fm-stat-label' }, label),
            h('b', { class: 'fm-stat-value' }, String(value)),
            h('small', {}, sub)
        )
    );
}

function statsRow({ farms, plantings, reports }) {
    const forecast = reports.find((report) => report.id === 'harvest-forecast');
    const harvested = reports.find((report) => report.id === 'harvest-report');
    const today = startOfToday();
    const dueSoon = plantings.filter((planting) => isDueSoon(planting, today)).length;

    return h(
        'div',
        { class: 'fm-dash-stats' },
        statCard({
            label: 'Assigned Farms',
            value: farms.length,
            sub: 'Included in reports',
            color: 'var(--primary-color, var(--primary))',
            iconPaths: ICON.barn
        }),
        statCard({
            label: 'Planting Records',
            value: plantings.length,
            sub: 'Across all assigned farms',
            color: 'var(--success)',
            iconPaths: ICON.sprout
        }),
        statCard({
            label: 'Harvested Crops',
            value: harvested?.rows.length ?? 0,
            sub: 'Confirmed harvested plantings',
            color: 'var(--success)',
            iconPaths: ICON.basket
        }),
        statCard({
            label: 'Upcoming Harvests',
            value: forecast?.rows.length ?? 0,
            sub: 'Expected harvest dates',
            color: 'var(--warning)',
            iconPaths: ICON.basket
        }),
        statCard({
            label: `Due in ${DUE_SOON_DAYS} Days`,
            value: dueSoon,
            sub: 'Needs attention soon',
            color: 'var(--secondary, var(--primary))',
            iconPaths: ICON.clock
        })
    );
}

function reportCard(report, onPreview) {
    const previewButton = h(
        'button',
        {
            class: 'btn ghost',
            type: 'button',
            'data-preview': report.id,
            'aria-pressed': 'false',
            onclick: (event) => {
                event.stopPropagation();
                onPreview(report);
            }
        },
        icon(ICON.eye, 16),
        'Preview'
    );

    const downloadButton = h(
        'button',
        {
            class: 'btn',
            type: 'button',
            disabled: report.rows.length === 0,
            title: report.rows.length === 0
                ? 'No records to download'
                : `Download ${report.title} as CSV`,
            onclick: (event) => {
                event.stopPropagation();
                downloadCsv(report);
            }
        },
        icon(ICON.download, 16),
        'Download CSV'
    );

    return h(
        'section',
        {
            class: 'fm-panel fm-report-card',
            style: `--c:${report.color}`,
            'data-report': report.id,
            onclick: () => onPreview(report)
        },
        h(
            'div',
            { class: 'fm-report-top' },
            h('span', { class: 'fm-stat-icon' }, icon(report.iconPaths, 26)),
            h('span', { class: 'fm-pill' }, plural(report.rows.length, 'record'))
        ),
        h(
            'div',
            { class: 'fm-report-body' },
            h('h3', {}, report.title),
            h('p', {}, report.description)
        ),
        h('div', { class: 'fm-report-actions' }, previewButton, downloadButton)
    );
}

function statusBadge(row) {
    return h(
        'span',
        { class: `fm-badge fm-badge--${row._status || 'unknown'}` },
        row['Crop status']
    );
}

function pager({ page, totalPages, total, start, end, onPage }) {
    const prev = h(
        'button',
        { type: 'button', class: 'btn ghost fm-pager-btn', onclick: () => onPage(page - 1) },
        'Previous'
    );
    const next = h(
        'button',
        { type: 'button', class: 'btn ghost fm-pager-btn', onclick: () => onPage(page + 1) },
        'Next'
    );

    prev.disabled = page <= 1;
    next.disabled = page >= totalPages;

    return h(
        'div',
        { class: 'fm-pager' },
        h('span', { class: 'fm-report-note' }, `Showing ${start + 1}-${end} of ${total}`),
        h(
            'div',
            { class: 'fm-pager-controls' },
            prev,
            h('span', { class: 'fm-pager-page' }, `Page ${page} of ${totalPages}`),
            next
        )
    );
}

function previewPanel(report, requestedPage, onPage) {
    const total = report.rows.length;
    const totalPages = Math.max(1, Math.ceil(total / PREVIEW_PAGE_SIZE));
    const page = Math.min(Math.max(requestedPage, 1), totalPages);
    const start = (page - 1) * PREVIEW_PAGE_SIZE;
    const end = Math.min(start + PREVIEW_PAGE_SIZE, total);
    const shown = report.rows.slice(start, end);

    const body = shown.length
        ? h(
            'div',
            {},
            h(
                'div',
                { class: 'table-wrap' },
                h(
                    'table',
                    {},
                    h(
                        'thead',
                        {},
                        h('tr', {}, report.columns.map((col) => h('th', {}, col)))
                    ),
                    h(
                        'tbody',
                        {},
                        shown.map((row) =>
                            h(
                                'tr',
                                {},
                                report.columns.map((col) =>
                                    h(
                                        'td',
                                        {},
                                        col === 'Crop status'
                                            ? statusBadge(row)
                                            : String(row[col] ?? '')
                                    )
                                )
                            )
                        )
                    )
                )
            ),
            pager({ page, totalPages, total, start, end, onPage })
        )
        : emptyNote('No records for this report yet.');

    return {
        page,
        element: h(
            'section',
            { class: 'fm-panel', id: 'fm-report-preview' },
            h(
                'div',
                { class: 'fm-panel-header' },
                h(
                    'div',
                    {},
                    h('h3', {}, `${report.title} preview`),
                    h('p', {}, report.description)
                ),
                h('span', { class: 'fm-pill' }, plural(total, 'record'))
            ),
            body
        )
    };
}

/* ---------- Date filter ---------- */
function filterPlantings(plantings, { basis, from, to, cropStatus }) {
    if (!from && !to && !cropStatus) return plantings;

    return plantings.filter((planting) => {
        if (
            cropStatus &&
            (planting.crop_status?.trim().toLowerCase() || 'unknown') !== cropStatus
        ) {
            return false;
        }

        if (!from && !to) return true;

        const value = planting[basis];

        if (!value) return false;

        const date = String(value).slice(0, 10);

        return (!from || date >= from) && (!to || date <= to);
    });
}

const FILTER_FIELD_STYLE =
    'padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius);' +
    'background:var(--background);color:var(--primary-text);font:inherit;';

function dateFilterBar(state, statusOptions, onChange) {
    const field = (label, control) =>
        h(
            'label',
            { style: 'display:grid;gap:4px;font-size:var(--fs-xs);color:var(--secondary-text);' },
            h('span', {}, label),
            control
        );

    const status = h(
        'select',
        { style: FILTER_FIELD_STYLE, 'aria-label': 'Filter by crop status' },
        h('option', { value: '' }, 'All statuses'),
        statusOptions.map(({ value, label }) => h('option', { value }, label))
    );

    const from = h('input', { type: 'date', style: FILTER_FIELD_STYLE });
    const to = h('input', { type: 'date', style: FILTER_FIELD_STYLE });

    const clear = h(
        'button',
        { type: 'button', class: 'btn ghost' },
        'Clear'
    );

    const summary = h('small', {
        class: 'fm-report-note',
        role: 'status',
        style: 'margin-left:auto;'
    });

    const message = h('small', {
        role: 'alert',
        style: 'color:var(--error);width:100%;'
    });

    const sync = () => {
        clear.disabled = !state.from && !state.to && !state.cropStatus;
    };

    const apply = () => {
        if (from.value && to.value && from.value > to.value) {
            message.textContent = 'The start date is after the end date.';
            return;
        }

        message.textContent = '';
        state.cropStatus = status.value;
        state.from = from.value;
        state.to = to.value;
        sync();
        onChange();
    };

    status.addEventListener('change', apply);
    from.addEventListener('change', apply);
    to.addEventListener('change', apply);

    clear.addEventListener('click', () => {
        from.value = '';
        to.value = '';
        status.value = '';
        apply();
    });

    sync();

    return {
        summary,
        element: h(
            'section',
            {
                class: 'fm-panel',
                style: 'display:flex;flex-wrap:wrap;align-items:flex-end;gap:12px;'
            },
            field('Crop status', status),
            field('From', from),
            field('To', to),
            clear,
            summary,
            message
        )
    };
}

function reportsPage({ farms, plantings: allPlantings, cropLabels }) {
    const state = { basis: 'sowing_date', from: '', to: '', cropStatus: '' };

    const preview = h('div');
    const grid = h('div', { class: 'fm-report-grid' });
    let statsEl = h('div');

    let reports = [];
    let current = null;
    let page = 1;

    const renderPreview = () => {
        const result = previewPanel(current, page, (newPage) => {
            page = newPage;
            renderPreview();
        });

        page = result.page;
        preview.replaceChildren(result.element);
    };

    const show = (report, scroll = false) => {
        current = report;
        page = 1;
        renderPreview();

        for (const card of grid.children) {
            const selected = card.dataset.report === report.id;

            card.classList.toggle('on', selected);
            card
                .querySelector('[data-preview]')
                ?.setAttribute('aria-pressed', String(selected));
        }

        if (scroll) {
            preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    };

    const build = () => {
        const plantings = filterPlantings(allPlantings, state);

        reports = buildReports(farms, plantings, cropLabels);

        const nextStats = statsRow({ farms, plantings, reports });
        statsEl.replaceWith(nextStats);
        statsEl = nextStats;

        grid.replaceChildren(
            ...reports.map((report) => reportCard(report, (r) => show(r, true)))
        );

        show(reports.find((report) => report.id === current?.id) ?? reports[0]);

        filter.summary.textContent =
            state.from || state.to || state.cropStatus
                ? `Showing ${plantings.length} of ${plural(allPlantings.length, 'planting record')}`
                : '';
    };

    const statusCodes = [
        ...new Set(
            allPlantings.map(
                (planting) => planting.crop_status?.trim().toLowerCase() || 'unknown'
            )
        )
    ];

    const labelOrder = [...cropLabels.keys()];

    statusCodes.sort((a, b) => {
        const ia = labelOrder.indexOf(a);
        const ib = labelOrder.indexOf(b);

        return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib);
    });

    const statusOptions = statusCodes.map((code) => ({
        value: code,
        label: statusLabel(code, cropLabels)
    }));

    const filter = dateFilterBar(state, statusOptions, build);

    const page_ = h(
        'div',
        { class: 'fm-dash' },
        filter.element,
        statsEl,
        grid,
        preview
    );

    build();

    return page_;
}

/* ---------- Loading skeleton ---------- */
function skeleton() {
    return h(
        'div',
        { class: 'fm-dash', 'aria-busy': 'true', 'aria-label': 'Loading reports' },
        h(
            'div',
            { class: 'fm-dash-stats' },
            ...[1, 2, 3, 4, 5].map(() => h('div', { class: 'fm-skeleton fm-skeleton--stat' }))
        ),
        h(
            'div',
            { class: 'fm-report-grid' },
            ...[1, 2, 3, 4].map(() => h('div', { class: 'fm-skeleton fm-skeleton--card' }))
        ),
        h('div', { class: 'fm-skeleton fm-skeleton--panel' })
    );
}

/* ---------- Page ---------- */
/** Load report data and render filters, previews, pagination, and CSV export. */
export async function render(root) {
    const holder = h('div');

    root.append(
        pageHead(
            'Reports',
            'Preview and download summaries of your assigned farms.'
        ),
        holder
    );

    const load = async () => {
        holder.replaceChildren(skeleton());

        try {
            const farms = await loadFarms();

            if (!farms.length) {
                holder.replaceChildren(
                    h(
                        'section',
                        { class: 'fm-panel' },
                        emptyNote('No farms are currently assigned to your account.')
                    )
                );
                return;
            }

            const [plantings, cropLabels] = await Promise.all([
                loadPlantings(farms.map((farm) => farm.id)),
                loadCropStatusLabels().catch((err) => {
                    console.error('Could not load crop status labels:', err);
                    return new Map();
                })
            ]);

            holder.replaceChildren(reportsPage({ farms, plantings, cropLabels }));
        } catch (err) {
            console.error('Failed to load reports:', err);

            holder.replaceChildren(
                h('p', { class: 'msg error' }, 'Could not load the reports.'),
                h(
                    'button',
                    {
                        class: 'btn ghost staff-retry',
                        type: 'button',
                        onclick: load
                    },
                    'Retry'
                )
            );
        }
    };

    await load();
}
