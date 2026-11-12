
import { supabase } from '../connection.js';
import { h, pageHead } from '../admin/ui.js';

const PREVIEW_PAGE_SIZE = 5;
const DUE_SOON_DAYS = 7;
const TERMINAL_CROP_STATUSES = ['harvested', 'failed', 'cancelled'];
const HEALTH_ORDER = ['healthy', 'good', 'fair', 'poor', 'critical', 'not-assessed'];

const SVG_NS = 'http://www.w3.org/2000/svg';

const ICON = {
    sprout: ['M12 21v-8', 'M12 13C7 13 4 10 4 5c5 0 8 3 8 8Z', 'M12 16c0-4 3-7 8-7 0 5-3 8-8 8'],
    barn: ['M4 21V10l8-6 8 6v11', 'M9 21v-7h6v7', 'M9 14l6 7M15 14l-6 7', 'M2 21h20'],
    basket: ['M7 10V8a5 5 0 0 1 10 0v2', 'M3 10h18l-1.5 9a2 2 0 0 1-2 1.7h-11a2 2 0 0 1-2-1.7L3 10Z', 'M9 14v3', 'M15 14v3'],
    clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 7v5l3 2'],
    alert: ['M12 3 2 20h20L12 3Z', 'M12 10v4', 'M12 17h.01'],
    heart: ['M12 20s-8-4.7-8-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 15.3 12 20 12 20Z'],
    download: ['M12 3v12', 'm7 10 5 5 5-5', 'M4 21h16'],
    eye: ['M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z']
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

/* ==========================================================
   DATA LOADING
   ========================================================== */

/**
 * Load active farms assigned to the current Agricultural Technician.
 * This is kept inside this module to avoid a missing farms.js import.
 */
async function loadAssignedFarms(technicianStaffId) {
    if (!technicianStaffId) {
        throw new Error('Agricultural Technician staff ID is missing.');
    }

    const { data: assignments, error: assignmentError } = await supabase
        .from('agricultural_technician_farm_assignments')
        .select('farm_id')
        .eq('technician_staff_id', technicianStaffId)
        .eq('assignment_status', 'active')
        .is('unassigned_at', null);

    if (assignmentError) {
        console.error('Failed to load farm assignments:', assignmentError);
        throw assignmentError;
    }

    const farmIds = [
        ...new Set(
            (assignments ?? [])
                .map(row => row.farm_id)
                .filter(Boolean)
        )
    ];

    if (!farmIds.length) return [];

    const { data: farms, error: farmError } = await supabase
        .from('farmer_farms')
        .select('id, farm_name, farm_location')
        .in('id', farmIds)
        .order('farm_name', { ascending: true });

    if (farmError) {
        console.error('Failed to load assigned farms:', farmError);
        throw farmError;
    }

    return farms ?? [];
}

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
            )
        `)
        .in('farm_fields.farm_id', farmIds)
        .order('expected_harvest_date', { ascending: true });

    if (error) {
        console.error('Failed to load planting records:', error);
        throw error;
    }

    return (data ?? []).map(planting => ({
        ...planting,
        farm_id: planting.farm_fields.farm_id
    }));
}

async function loadLatestMonitoring(staffId) {
    const { data, error } = await supabase
        .from('agricultural_technician_crop_monitoring')
        .select(`
            planting_id,
            growth_stage,
            crop_health_status,
            action_required,
            observations,
            recommended_action,
            monitoring_date
        `)
        .eq('technician_staff_id', staffId)
        .order('monitoring_date', { ascending: false });

    if (error) throw error;

    const latest = new Map();

    for (const record of data ?? []) {
        if (record.planting_id && !latest.has(record.planting_id)) {
            latest.set(record.planting_id, record);
        }
    }

    return latest;
}

async function loadCropStatusLabels() {
    const { data, error } = await supabase
        .from('crop_statuses')
        .select('code, label, display_order')
        .eq('is_active', true)
        .order('display_order', { ascending: true });

    if (error) throw error;

    return new Map(
        (data ?? []).map(status => [status.code, status.label])
    );
}

/* ==========================================================
   HELPERS
   ========================================================== */

const plural = (count, word) =>
    `${count} ${word}${count === 1 ? '' : 's'}`;

const formatLabel = value => {
    const text = String(value?.trim?.() || 'unknown')
        .replace(/[_-]+/g, ' ');

    return text.replace(/\b\w/g, character => character.toUpperCase());
};

const formatDate = value => {
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

    return formatLabel(code);
};

const slug = value =>
    (String(value ?? '').trim().toLowerCase() || 'unknown')
        .replace(/[^a-z0-9_-]/g, '');

function startOfToday() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
}

const isActive = planting =>
    !TERMINAL_CROP_STATUSES.includes(
        planting.crop_status?.trim().toLowerCase()
    );

function isUpcoming(planting, today) {
    if (!planting.expected_harvest_date || !isActive(planting)) {
        return false;
    }

    return new Date(`${planting.expected_harvest_date}T00:00:00`) >= today;
}

function isDueSoon(planting, today) {
    if (!isUpcoming(planting, today)) return false;

    const limit = new Date(today);
    limit.setDate(limit.getDate() + DUE_SOON_DAYS);

    return new Date(`${planting.expected_harvest_date}T00:00:00`) <= limit;
}

const healthSlug = record =>
    record?.crop_health_status
        ? slug(record.crop_health_status)
        : 'not-assessed';

const healthLabel = record =>
    record?.crop_health_status
        ? formatLabel(record.crop_health_status)
        : 'Not assessed';

function toCsv(columns, rows) {
    const escape = value =>
        `"${String(value ?? '').replace(/"/g, '""')}"`;

    return [
        columns.map(escape).join(','),
        ...rows.map(row =>
            columns.map(col => escape(row[col])).join(',')
        )
    ].join('\r\n');
}

function downloadCsv(report) {
    const columns = report.csvColumns ?? report.columns;
    const csv = toCsv(columns, report.csvRows ?? report.rows);
    const blob = new Blob(['\ufeff', csv], {
        type: 'text/csv;charset=utf-8'
    });

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

/* ==========================================================
   REPORT DEFINITIONS
   ========================================================== */

function buildReports(farms, plantings, latestMonitoring, cropLabels) {
    const farmById = new Map(
        farms.map(farm => [farm.id, farm])
    );

    const today = startOfToday();

    const plantingRow = planting => {
        const farm = farmById.get(planting.farm_id);
        const monitoring = latestMonitoring.get(planting.id);

        return {
            Crop: planting.crop_name || 'Unnamed crop',
            Farm: farm?.farm_name || 'Unnamed farm',
            'Sowing date': formatDate(planting.sowing_date),
            'Expected harvest': formatDate(planting.expected_harvest_date),
            'Crop status': statusLabel(planting.crop_status, cropLabels),
            Health: healthLabel(monitoring),
            _status: slug(planting.crop_status),
            _health: healthSlug(monitoring)
        };
    };

    const plantingCsvRow = planting => {
        const farm = farmById.get(planting.farm_id);
        const monitoring = latestMonitoring.get(planting.id);

        return {
            Crop: planting.crop_name || 'Unnamed crop',
            Farm: farm?.farm_name || 'Unnamed farm',
            Location: farm?.farm_location || 'Location not set',
            'Sowing date': planting.sowing_date ?? '',
            'Expected harvest': planting.expected_harvest_date ?? '',
            'Crop status': statusLabel(planting.crop_status, cropLabels),
            'Growth stage': monitoring?.growth_stage
                ? formatLabel(monitoring.growth_stage)
                : '',
            Health: healthLabel(monitoring),
            'Action required': monitoring
                ? (monitoring.action_required ? 'Yes' : 'No')
                : '',
            'Latest observations': monitoring?.observations ?? '',
            'Recommended action': monitoring?.recommended_action ?? ''
        };
    };

    const plantingColumns = [
        'Crop',
        'Farm',
        'Sowing date',
        'Expected harvest',
        'Crop status',
        'Health'
    ];

    const plantingCsvColumns = [
        'Crop',
        'Farm',
        'Location',
        'Sowing date',
        'Expected harvest',
        'Crop status',
        'Growth stage',
        'Health',
        'Action required',
        'Latest observations',
        'Recommended action'
    ];

    const active = plantings.filter(isActive);

    const needsAction = active.filter(
        planting =>
            latestMonitoring.get(planting.id)?.action_required === true
    );

    const forecast = plantings.filter(
        planting => isUpcoming(planting, today)
    );

    const healthGroups = new Map();

    for (const planting of active) {
        const key = healthSlug(latestMonitoring.get(planting.id));

        const group = healthGroups.get(key) ?? {
            label: healthLabel(latestMonitoring.get(planting.id)),
            plants: 0,
            farms: new Set()
        };

        group.plants += 1;
        group.farms.add(planting.farm_id);
        healthGroups.set(key, group);
    }

    const healthRows = [...healthGroups.entries()]
        .sort(([a], [b]) => {
            const ia = HEALTH_ORDER.indexOf(a);
            const ib = HEALTH_ORDER.indexOf(b);

            return (ia < 0 ? Infinity : ia) -
                (ib < 0 ? Infinity : ib);
        })
        .map(([, group]) => ({
            'Health status': group.label,
            'Active plants': group.plants,
            Farms: group.farms.size
        }));

    return [
        {
            id: 'active-plants',
            title: 'Active Plants',
            description: 'Plants that are still growing across your assigned farms.',
            iconPaths: ICON.sprout,
            color: 'var(--success)',
            columns: plantingColumns,
            csvColumns: plantingCsvColumns,
            rows: active.map(plantingRow),
            csvRows: active.map(plantingCsvRow)
        },
        {
            id: 'plants-needing-action',
            title: 'Plants Needing Action',
            description: 'Active plants whose latest monitoring requires follow-up.',
            iconPaths: ICON.alert,
            color: 'var(--warning)',
            columns: plantingColumns,
            csvColumns: plantingCsvColumns,
            rows: needsAction.map(plantingRow),
            csvRows: needsAction.map(plantingCsvRow)
        },
        {
            id: 'crop-health-summary',
            title: 'Crop Health Summary',
            description: 'Active plants grouped by their latest health status.',
            iconPaths: ICON.heart,
            color: 'var(--primary-color, var(--primary))',
            columns: ['Health status', 'Active plants', 'Farms'],
            rows: healthRows,
            csvRows: healthRows
        },
        {
            id: 'harvest-forecast',
            title: 'Harvest Forecast',
            description: 'Active plants with an upcoming expected harvest date.',
            iconPaths: ICON.basket,
            color: 'var(--secondary, var(--primary))',
            columns: plantingColumns,
            csvColumns: plantingCsvColumns,
            rows: forecast.map(plantingRow),
            csvRows: forecast.map(plantingCsvRow)
        }
    ];
}

/* ==========================================================
   BUILDING BLOCKS
   ========================================================== */

const emptyNote = text =>
    h('p', { class: 'fm-empty' }, text);

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

function statsRow({ farms, plantings, latestMonitoring }) {
    const today = startOfToday();
    const active = plantings.filter(isActive);

    const needsAction = active.filter(
        planting =>
            latestMonitoring.get(planting.id)?.action_required === true
    ).length;

    const healthy = active.filter(planting =>
        ['healthy', 'good'].includes(
            healthSlug(latestMonitoring.get(planting.id))
        )
    ).length;

    const dueSoon = plantings.filter(
        planting => isDueSoon(planting, today)
    ).length;

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
            label: 'Active Plants',
            value: active.length,
            sub: 'Still growing',
            color: 'var(--success)',
            iconPaths: ICON.sprout
        }),
        statCard({
            label: 'Healthy Plants',
            value: healthy,
            sub: 'Healthy or good condition',
            color: 'var(--success)',
            iconPaths: ICON.heart
        }),
        statCard({
            label: 'Needing Action',
            value: needsAction,
            sub: 'Follow-up required',
            color: 'var(--warning)',
            iconPaths: ICON.alert
        }),
        statCard({
            label: `Due in ${DUE_SOON_DAYS} Days`,
            value: dueSoon,
            sub: 'Expected harvest soon',
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
            onclick: event => {
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
            onclick: event => {
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

const badge = (text, key) =>
    h('span', { class: `fm-badge fm-badge--${key || 'unknown'}` }, text);

function pager({ page, totalPages, total, start, end, onPage }) {
    const prev = h(
        'button',
        {
            type: 'button',
            class: 'btn ghost fm-pager-btn',
            onclick: () => onPage(page - 1)
        },
        'Previous'
    );

    const next = h(
        'button',
        {
            type: 'button',
            class: 'btn ghost fm-pager-btn',
            onclick: () => onPage(page + 1)
        },
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

function cellFor(row, col) {
    if (col === 'Crop status') return badge(row[col], row._status);
    if (col === 'Health' && row._health) return badge(row[col], row._health);

    return String(row[col] ?? '');
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
                        h('tr', {}, report.columns.map(col => h('th', {}, col)))
                    ),
                    h(
                        'tbody',
                        {},
                        shown.map(row =>
                            h(
                                'tr',
                                {},
                                report.columns.map(col =>
                                    h('td', {}, cellFor(row, col))
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

/* ==========================================================
   FILTERS
   ========================================================== */

function filterPlantings(plantings, { farmId, cropStatus, from, to }) {
    if (!farmId && !cropStatus && !from && !to) return plantings;

    return plantings.filter(planting => {
        if (farmId && String(planting.farm_id) !== farmId) return false;

        if (
            cropStatus &&
            (planting.crop_status?.trim().toLowerCase() || 'unknown') !== cropStatus
        ) {
            return false;
        }

        if (!from && !to) return true;
        if (!planting.sowing_date) return false;

        const date = String(planting.sowing_date).slice(0, 10);

        return (!from || date >= from) && (!to || date <= to);
    });
}

const FILTER_FIELD_STYLE =
    'padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius);' +
    'background:var(--background);color:var(--primary-text);font:inherit;';

function filterBar(state, farmOptions, statusOptions, onChange) {
    const field = (label, control) =>
        h(
            'label',
            {
                style: 'display:grid;gap:4px;font-size:var(--fs-xs);color:var(--secondary-text);'
            },
            h('span', {}, label),
            control
        );

    const select = (label, allLabel, options) =>
        h(
            'select',
            { style: FILTER_FIELD_STYLE, 'aria-label': label },
            h('option', { value: '' }, allLabel),
            options.map(({ value, label: text }) =>
                h('option', { value }, text)
            )
        );

    const farm = select('Filter by farm', 'All farms', farmOptions);
    const status = select('Filter by crop status', 'All statuses', statusOptions);
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
        clear.disabled =
            !state.farmId && !state.cropStatus &&
            !state.from && !state.to;
    };

    const apply = () => {
        if (from.value && to.value && from.value > to.value) {
            message.textContent = 'The start date is after the end date.';
            return;
        }

        message.textContent = '';

        state.farmId = farm.value;
        state.cropStatus = status.value;
        state.from = from.value;
        state.to = to.value;

        sync();
        onChange();
    };

    farm.addEventListener('change', apply);
    status.addEventListener('change', apply);
    from.addEventListener('change', apply);
    to.addEventListener('change', apply);

    clear.addEventListener('click', () => {
        farm.value = '';
        status.value = '';
        from.value = '';
        to.value = '';
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
            field('Farm', farm),
            field('Crop status', status),
            field('Sown from', from),
            field('Sown to', to),
            clear,
            summary,
            message
        )
    };
}

function reportsPage({ farms, plantings: allPlantings, latestMonitoring, cropLabels }) {
    const state = {
        farmId: '',
        cropStatus: '',
        from: '',
        to: ''
    };

    const preview = h('div');
    const grid = h('div', { class: 'fm-report-grid' });
    let statsEl = h('div');

    let reports = [];
    let current = null;
    let page = 1;

    const renderPreview = () => {
        if (!current) return;

        const result = previewPanel(current, page, newPage => {
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

            card.querySelector('[data-preview]')
                ?.setAttribute('aria-pressed', String(selected));
        }

        if (scroll) {
            preview.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    };

    const build = () => {
        const plantings = filterPlantings(allPlantings, state);

        reports = buildReports(
            farms,
            plantings,
            latestMonitoring,
            cropLabels
        );

        const nextStats = statsRow({
            farms,
            plantings,
            latestMonitoring
        });

        statsEl.replaceWith(nextStats);
        statsEl = nextStats;

        grid.replaceChildren(
            ...reports.map(report =>
                reportCard(report, (selectedReport) =>
                    show(selectedReport, true)
                )
            )
        );

        show(
            reports.find(report => report.id === current?.id) ?? reports[0]
        );

        const filtered =
            state.farmId || state.cropStatus || state.from || state.to;

        filter.summary.textContent = filtered
            ? `Showing ${plantings.length} of ${plural(allPlantings.length, 'planting record')}`
            : '';
    };

    const statusCodes = [
        ...new Set(
            allPlantings.map(
                planting =>
                    planting.crop_status?.trim().toLowerCase() || 'unknown'
            )
        )
    ];

    const labelOrder = [...cropLabels.keys()];

    statusCodes.sort((a, b) => {
        const ia = labelOrder.indexOf(a);
        const ib = labelOrder.indexOf(b);

        return (ia < 0 ? Infinity : ia) -
            (ib < 0 ? Infinity : ib);
    });

    const statusOptions = statusCodes.map(code => ({
        value: code,
        label: statusLabel(code, cropLabels)
    }));

    const farmOptions = farms.map(farm => ({
        value: String(farm.id),
        label: farm.farm_name || 'Unnamed farm'
    }));

    const filter = filterBar(
        state,
        farmOptions,
        statusOptions,
        build
    );

    const pageEl = h(
        'div',
        { class: 'fm-dash' },
        filter.element,
        statsEl,
        grid,
        preview
    );

    build();

    return pageEl;
}

/* ==========================================================
   LOADING SKELETON
   ========================================================== */

function skeleton() {
    return h(
        'div',
        {
            class: 'fm-dash',
            'aria-busy': 'true',
            'aria-label': 'Loading reports'
        },
        h(
            'div',
            { class: 'fm-dash-stats' },
            ...[1, 2, 3, 4, 5].map(() =>
                h('div', { class: 'fm-skeleton fm-skeleton--stat' })
            )
        ),
        h(
            'div',
            { class: 'fm-report-grid' },
            ...[1, 2, 3, 4].map(() =>
                h('div', { class: 'fm-skeleton fm-skeleton--card' })
            )
        ),
        h('div', { class: 'fm-skeleton fm-skeleton--panel' })
    );
}

/* ==========================================================
   PAGE RENDER
   ========================================================== */

export async function render(root, ctx) {
    const holder = h('div');

    root.replaceChildren(
        pageHead(
            'Monitoring Reports',
            'Preview and download plant and monitoring summaries of your assigned farms.'
        ),
        holder
    );

    const load = async () => {
        holder.replaceChildren(skeleton());

        try {
            const staffId = ctx?.staff?.staff_id;

            if (!staffId) {
                throw new Error(
                    'Agricultural Technician staff information is unavailable. Please sign in again.'
                );
            }

            const farms = await loadAssignedFarms(staffId);

            if (!farms.length) {
                holder.replaceChildren(
                    h(
                        'section',
                        { class: 'fm-panel' },
                        emptyNote(
                            'No farms are currently assigned to your account.'
                        )
                    )
                );
                return;
            }

            const [plantings, latestMonitoring, cropLabels] =
                await Promise.all([
                    loadPlantings(farms.map(farm => farm.id)),
                    loadLatestMonitoring(staffId),
                    loadCropStatusLabels()
                ]);

            holder.replaceChildren(
                reportsPage({
                    farms,
                    plantings,
                    latestMonitoring,
                    cropLabels
                })
            );
        } catch (err) {
            console.error(
                'Failed to load monitoring reports:',
                err
            );

            holder.replaceChildren(
                h(
                    'p',
                    { class: 'msg error' },
                    err.message || 'Could not load the monitoring reports.'
                ),
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
