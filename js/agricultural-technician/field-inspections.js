import { supabase } from '../connection.js';

/* ==========================================================
   FARM INSPECTION MAP: Agricultural Technician
   Tables:
     farmer_farms
     agricultural_technician_farm_assignments
     farm_fields
     farm_plantings
     agricultural_technician_crop_monitoring
     agricultural_inspections
   ========================================================== */

/* ---------- Configuration ---------- */
const STORAGE_BUCKET = 'crop-monitoring-photos';
const PHOTO_FOLDER = 'inspections';
const MAX_PHOTO_SIZE = 3 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const MAP_BACKGROUND_URL = null;

const MAP_W = 1200;
const MAP_H = 800;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

const DRAFT_STATUS = 'draft';
const SUBMITTED_STATUS = 'submitted';

const ACTIVE_PLANTING_STATUSES = ['planted', 'growing', 'ready'];

const DEFAULT_POLYGONS = [
    [[100, 100], [400, 85], [425, 320], [115, 345]],
    [[480, 90], [770, 110], [750, 335], [460, 310]],
    [[840, 100], [1110, 130], [1085, 360], [815, 335]],
    [[90, 440], [380, 420], [410, 700], [120, 715]],
    [[470, 410], [780, 395], [800, 690], [450, 705]],
    [[860, 420], [1120, 440], [1095, 700], [845, 690]]
];

const GROWTH_STAGES = [
    ['germination', 'Germination'],
    ['seedling', 'Seedling'],
    ['vegetative', 'Vegetative'],
    ['flowering', 'Flowering'],
    ['fruiting', 'Fruiting'],
    ['maturing', 'Maturing'],
    ['ready_for_harvest', 'Ready for Harvest']
];

const CONDITIONS = [
    ['excellent', 'Excellent'],
    ['good', 'Good'],
    ['satisfactory', 'Satisfactory'],
    ['needs_attention', 'Needs Attention'],
    ['critical', 'Critical']
];

// These values match the agricultural_inspections CHECK constraint.
const INSPECTION_TYPES = [
    ['routine', 'Routine'],
    ['crop_health', 'Crop Health'],
    ['pest', 'Pest'],
    ['disease', 'Disease'],
    ['soil', 'Soil'],
    ['follow_up', 'Follow-up'],
    ['other', 'Other']
];

const SOIL_CONDITIONS = [
    ['good', 'Good'],
    ['moist', 'Moist'],
    ['dry', 'Dry'],
    ['waterlogged', 'Waterlogged'],
    ['compacted', 'Compacted'],
    ['nutrient_deficient', 'Nutrient Deficient']
];

const TONE_LABELS = {
    good: 'Good',
    fair: 'Fair',
    poor: 'Poor',
    critical: 'Critical',
    unrated: 'Not yet rated',
    none: 'No active planting'
};

const ICONS = {
    plus: 'M12 5v14M5 12h14',
    minus: 'M5 12h14',
    expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
    collapse: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
    layers: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5',
    chevron: 'M9 6l6 6-6 6',
    back: 'M15 6l-6 6 6 6',
    close: 'M6 6l12 12M18 6L6 18',
    history: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 8v4l3 2',
    leaf: 'M5 19c0-8 5-13 14-14 0 9-5 14-13 14M5 19l7-7',
    clipboard: 'M9 4h6v3H9zM7 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-1M9 12h6M9 16h4'
};

/* ---------- DOM helpers ---------- */
const h = (tag, className = '', text = '') => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== '') node.textContent = text;
    return node;
};

const s = (tag, attrs = {}, className = '') => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (className) node.setAttribute('class', className);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    return node;
};

const icon = (name, size = 18) => {
    const svg = s('svg', {
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 2,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'aria-hidden': 'true'
    }, 'fim-icon');

    svg.append(s('path', { d: ICONS[name] }));
    return svg;
};

const iconButton = (name, label, className = 'fim-ctrl-btn') => {
    const button = h('button', className);
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.title = label;
    button.append(icon(name));
    return button;
};

const pad = n => String(n).padStart(2, '0');

const toLocalInput = value => {
    const d = new Date(value);
    const date = Number.isNaN(d.getTime()) ? new Date() : d;

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const formatDate = value => {
    if (!value) return '—';

    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';

    return d.toLocaleDateString('en-PH', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
};

const formatDateTime = value => {
    if (!value) return '—';

    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';

    return d.toLocaleString('en-PH', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
};

const formatStatus = value => {
    if (!value) return '—';

    return String(value)
        .replaceAll('_', ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
};

const isMissingColumn = error =>
    !!error && (
        error.code === '42703' ||
        /column .* does not exist/i.test(error.message || '')
    );

const toneOf = condition => {
    if (!condition) return 'unrated';

    if (['excellent', 'good'].includes(condition)) return 'good';
    if (condition === 'satisfactory') return 'fair';
    if (condition === 'needs_attention') return 'poor';
    if (condition === 'critical') return 'critical';

    // Compatibility with existing monitoring records.
    if (condition === 'healthy') return 'good';
    if (condition === 'fair') return 'fair';
    if (condition === 'poor') return 'poor';

    return 'unrated';
};

const stageOrder = stage =>
    GROWTH_STAGES.findIndex(([value]) => value === stage);

const stageLabel = stage =>
    GROWTH_STAGES.find(([value]) => value === stage)?.[1] || '—';

const emptyToNull = value => {
    const text = String(value ?? '').trim();
    return text === '' ? null : text;
};

function parsePolygon(raw) {
    let value = raw;

    if (typeof value === 'string') {
        try {
            value = JSON.parse(value);
        } catch {
            return null;
        }
    }

    if (!Array.isArray(value) || value.length < 3) return null;

    const points = value.map(point => [
        Number(point?.[0]),
        Number(point?.[1])
    ]);

    const valid = points.every(([x, y]) =>
        Number.isFinite(x) &&
        Number.isFinite(y) &&
        x >= 0 &&
        x <= MAP_W &&
        y >= 0 &&
        y <= MAP_H
    );

    return valid ? points : null;
}

function centroid(points) {
    const sum = points.reduce(
        (acc, [x, y]) => [acc[0] + x, acc[1] + y],
        [0, 0]
    );

    return {
        x: sum[0] / points.length,
        y: sum[1] / points.length
    };
}

function mulberry32(seed) {
    let t = seed;

    return () => {
        t += 0x6D2B79F5;

        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);

        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

/* ---------- Generated aerial-style background ---------- */
function buildDefs() {
    const defs = s('defs');

    const noise = s('filter', {
        id: 'fim-noise',
        x: 0,
        y: 0,
        width: '100%',
        height: '100%'
    });

    noise.append(
        s('feTurbulence', {
            type: 'fractalNoise',
            baseFrequency: '0.006 0.01',
            numOctaves: 4,
            seed: 11,
            result: 'n'
        }),
        s('feColorMatrix', {
            in: 'n',
            type: 'matrix',
            values: '0.55 0 0 0 0.10  0 0.75 0 0 0.16  0 0 0.28 0 0.04  0 0 0 0 1'
        })
    );

    const grain = s('filter', {
        id: 'fim-grain',
        x: 0,
        y: 0,
        width: '100%',
        height: '100%'
    });

    grain.append(
        s('feTurbulence', {
            type: 'fractalNoise',
            baseFrequency: '0.9',
            numOctaves: 2,
            seed: 4,
            result: 'g'
        }),
        s('feColorMatrix', {
            in: 'g',
            type: 'saturate',
            values: '0'
        })
    );

    const rows = [
        ['fim-rows-a', '#4e7a2e', '#3c6224', 9, 14],
        ['fim-rows-b', '#a39045', '#8c7a35', -18, 12],
        ['fim-rows-c', '#6f5c3c', '#5c4b30', 32, 16],
        ['fim-rows-d', '#3f7a45', '#2f6236', -6, 10],
        ['fim-rows-e', '#8d8b3c', '#767431', 24, 13],
        ['fim-rows-f', '#5a6d2c', '#485a22', -30, 15]
    ];

    rows.forEach(([id, base, line, angle, size]) => {
        const pattern = s('pattern', {
            id,
            width: size,
            height: size,
            patternUnits: 'userSpaceOnUse',
            patternTransform: `rotate(${angle})`
        });

        pattern.append(
            s('rect', {
                width: size,
                height: size,
                fill: base
            }),
            s('rect', {
                width: size / 2.6,
                height: size,
                fill: line
            })
        );

        defs.append(pattern);
    });

    const vignette = s('radialGradient', {
        id: 'fim-vignette',
        cx: '50%',
        cy: '50%',
        r: '75%'
    });

    vignette.append(
        s('stop', {
            offset: '60%',
            'stop-color': '#000',
            'stop-opacity': 0
        }),
        s('stop', {
            offset: '100%',
            'stop-color': '#000',
            'stop-opacity': 0.55
        })
    );

    defs.append(noise, grain, vignette);

    return defs;
}

function buildBackground() {
    const g = s('g', {}, 'fim-bg');

    if (MAP_BACKGROUND_URL) {
        g.append(s('image', {
            href: MAP_BACKGROUND_URL,
            x: 0,
            y: 0,
            width: MAP_W,
            height: MAP_H,
            preserveAspectRatio: 'xMidYMid slice'
        }));

        return g;
    }

    const rand = mulberry32(20260);
    const patternIds = ['a', 'b', 'c', 'd', 'e', 'f']
        .map(key => `url(#fim-rows-${key})`);

    g.append(
        s('rect', {
            width: MAP_W,
            height: MAP_H,
            fill: '#33441f'
        }),
        s('rect', {
            width: MAP_W,
            height: MAP_H,
            filter: 'url(#fim-noise)',
            opacity: 0.7
        })
    );

    for (let i = 0; i < 16; i += 1) {
        const x = rand() * MAP_W;
        const y = rand() * MAP_H;
        const w = 90 + rand() * 190;
        const hgt = 70 + rand() * 150;

        g.append(s('rect', {
            x,
            y,
            width: w,
            height: hgt,
            fill: patternIds[Math.floor(rand() * patternIds.length)],
            opacity: 0.45,
            transform: `rotate(${(rand() * 16 - 8).toFixed(1)} ${x + w / 2} ${y + hgt / 2})`
        }));
    }

    for (let i = 0; i < 130; i += 1) {
        const cx = rand() * MAP_W;
        const cy = rand() * MAP_H;
        const r = 5 + rand() * 11;

        g.append(
            s('circle', {
                cx: cx + 2,
                cy: cy + 3,
                r,
                fill: '#000',
                opacity: 0.25
            }),
            s('circle', {
                cx,
                cy,
                r,
                fill: rand() > 0.5 ? '#1f4a22' : '#2a5a2a',
                opacity: 0.9
            })
        );
    }

    g.append(
        s('ellipse', {
            cx: 1010,
            cy: 770,
            rx: 70,
            ry: 30,
            fill: '#27495a',
            opacity: 0.9
        }),
        s('ellipse', {
            cx: 1010,
            cy: 770,
            rx: 70,
            ry: 30,
            fill: 'none',
            stroke: '#4d7a8a',
            'stroke-width': 3,
            opacity: 0.6
        })
    );

    [
        'M0 372 C300 360 700 386 1200 370',
        'M442 0 C434 260 454 540 440 800',
        'M806 0 C812 260 800 540 812 800'
    ].forEach(d => {
        g.append(
            s('path', {
                d,
                fill: 'none',
                stroke: '#6e5f45',
                'stroke-width': 16,
                'stroke-linecap': 'round'
            }),
            s('path', {
                d,
                fill: 'none',
                stroke: '#a99a78',
                'stroke-width': 2,
                'stroke-dasharray': '10 14',
                opacity: 0.6
            })
        );
    });

    g.append(s('rect', {
        width: MAP_W,
        height: MAP_H,
        filter: 'url(#fim-grain)',
        opacity: 0.12
    }));

    return g;
}

/* ==========================================================
   PAGE
   ========================================================== */
export async function render(root, ctx = {}) {
    root.replaceChildren();

    const staffId = ctx.staff?.staff_id;

    const state = {
        farms: [],
        farmId: null,
        fields: [],
        plantings: [],
        monitoring: [],
        inspections: [],
        polygons: new Map(),
        selectedFieldId: null,
        needsInspectionColumns: false,
        needsPolygonColumn: false,
        saving: false,
        layer: 'satellite',
        view: {
            k: 1,
            x: 0,
            y: 0
        }
    };

    let disposed = false;
    let loadToken = 0;
    let previewUrl = null;
    let modalOnClose = null;
    let modalReturnFocus = null;
    let previousBodyOverflow = '';
    let toastTimer = null;

    const cleanups = [];

    const listen = (target, type, handler, options) => {
        target.addEventListener(type, handler, options);
        cleanups.push(() => target.removeEventListener(type, handler, options));
    };

    /* ---------- Page skeleton ---------- */
    const page = h('section', 'at-page');

    const heading = h('div', 'at-page-heading');
    heading.append(
        h('h2', '', 'Farm Inspection Map'),
        h('p', '', 'Select a field to review its crops and start an inspection.')
    );

    const shell = h('div', 'fim-page');

    const sidebar = h('aside', 'fim-sidebar');
    sidebar.setAttribute('aria-label', 'Farm and field details');

    const mapPane = h('div', 'fim-map is-layer-satellite');
    const stage = h('div', 'fim-stage');

    const tooltip = h('div', 'fim-tooltip');
    tooltip.hidden = true;

    const controls = h('div', 'fim-controls');

    const zoomInBtn = iconButton('plus', 'Zoom in');
    const zoomOutBtn = iconButton('minus', 'Zoom out');
    const fullscreenBtn = iconButton('expand', 'Toggle fullscreen');
    const layersBtn = iconButton('layers', 'Map layers');

    layersBtn.setAttribute('aria-expanded', 'false');

    controls.append(
        zoomInBtn,
        zoomOutBtn,
        fullscreenBtn,
        layersBtn
    );

    const layersPanel = h('div', 'fim-layers');
    layersPanel.hidden = true;

    const legend = h('div', 'fim-legend');

    ['good', 'fair', 'poor', 'critical', 'none'].forEach(tone => {
        const item = h('span', `fim-legend-item tone-${tone}`);
        item.append(
            h('i'),
            document.createTextNode(TONE_LABELS[tone])
        );
        legend.append(item);
    });

    mapPane.append(
        stage,
        controls,
        layersPanel,
        legend,
        tooltip
    );

    const modalHost = h('div', 'fim-modal');
    modalHost.hidden = true;

    shell.append(sidebar, mapPane, modalHost);
    page.append(heading, shell);
    root.append(page);

    /* ---------- Layers panel ---------- */
    (() => {
        layersPanel.append(
            h('strong', 'fim-layers-title', 'Map layers')
        );

        [
            ['satellite', 'Satellite'],
            ['dark', 'Dark'],
            ['terrain', 'Terrain']
        ].forEach(([value, label]) => {
            const row = h('label', 'fim-layers-row');
            const input = h('input');

            input.type = 'radio';
            input.name = 'fim-layer';
            input.value = value;
            input.checked = value === state.layer;

            input.addEventListener('change', () => {
                state.layer = value;

                mapPane.classList.remove(
                    'is-layer-satellite',
                    'is-layer-dark',
                    'is-layer-terrain'
                );

                mapPane.classList.add(`is-layer-${value}`);
            });

            row.append(input, h('span', '', label));
            layersPanel.append(row);
        });

        layersPanel.append(h('hr'));

        [
            ['fim-hide-labels', 'Field labels'],
            ['fim-hide-status', 'Condition colors']
        ].forEach(([cls, label]) => {
            const row = h('label', 'fim-layers-row');
            const input = h('input');

            input.type = 'checkbox';
            input.checked = true;

            input.addEventListener('change', () => {
                mapPane.classList.toggle(cls, !input.checked);
            });

            row.append(input, h('span', '', label));
            layersPanel.append(row);
        });
    })();

    /* ==========================================================
       DATA
       ========================================================== */

    // Only load farms actively assigned to the logged-in
    // Agricultural Technician.
    async function loadFarms() {
        if (!staffId) {
            state.farms = [];
            return;
        }

        const { data: assignments, error: assignmentError } = await supabase
            .from('agricultural_technician_farm_assignments')
            .select('farm_id')
            .eq('technician_staff_id', staffId)
            .eq('assignment_status', 'active');

        if (assignmentError) throw assignmentError;

        const farmIds = [
            ...new Set(
                (assignments || [])
                    .map(item => item.farm_id)
                    .filter(Boolean)
            )
        ];

        if (!farmIds.length) {
            state.farms = [];
            return;
        }

        const { data, error } = await supabase
            .from('farmer_farms')
            .select('id, farm_name, farm_location')
            .in('id', farmIds)
            .order('farm_name', { ascending: true });

        if (error) throw error;

        state.farms = data || [];
    }

    async function loadInspections() {
        if (!staffId || !state.farmId) {
            state.inspections = [];
            return;
        }

        const baseColumns = `
            inspection_id,
            technician_staff_id,
            farm_id,
            planting_id,
            inspection_date,
            inspection_type,
            overall_condition,
            findings,
            observations,
            action_required,
            inspection_status,
            created_at,
            updated_at
        `;

        const extraColumns = `
            , field_id,
            growth_stage_observation,
            pest_observed,
            pest_details,
            disease_observed,
            disease_details,
            soil_condition,
            recommended_action,
            evidence_photo_path
        `;

        const query = columns => supabase
            .from('agricultural_inspections')
            .select(columns)
            .eq('farm_id', state.farmId)
            .eq('technician_staff_id', staffId)
            .order('inspection_date', { ascending: false });

        let { data, error } = await query(baseColumns + extraColumns);

        if (error && isMissingColumn(error)) {
            state.needsInspectionColumns = true;
            ({ data, error } = await query(baseColumns));
        } else if (!error) {
            state.needsInspectionColumns = false;
        }

        if (error) throw error;

        state.inspections = data || [];
    }

    function assignPolygons() {
        state.polygons = new Map();

        const usedSlots = new Set();

        state.fields.forEach(field => {
            const custom = parsePolygon(field.map_polygon);

            if (custom) {
                state.polygons.set(field.id, custom);
            }
        });

        state.fields.forEach(field => {
            if (state.polygons.has(field.id)) return;

            const match = /(?:field\s*)?\b([a-f])\b\s*$/i.exec(
                String(field.field_name || '').trim()
            );

            if (!match) return;

            const slot = match[1].toLowerCase().charCodeAt(0) - 97;

            if (!usedSlots.has(slot)) {
                usedSlots.add(slot);
                state.polygons.set(field.id, DEFAULT_POLYGONS[slot]);
            }
        });

        state.fields.forEach(field => {
            if (state.polygons.has(field.id)) return;

            const slot = DEFAULT_POLYGONS.findIndex(
                (_, index) => !usedSlots.has(index)
            );

            if (slot === -1) return;

            usedSlots.add(slot);
            state.polygons.set(field.id, DEFAULT_POLYGONS[slot]);
        });
    }

    async function loadFarmData() {
        const farmId = state.farmId;

        state.fields = [];
        state.plantings = [];
        state.monitoring = [];
        state.inspections = [];
        state.selectedFieldId = null;

        const fieldQuery = columns => supabase
            .from('farm_fields')
            .select(columns)
            .eq('farm_id', farmId);

        let {
            data: fields,
            error: fieldError
        } = await fieldQuery('id, farm_id, field_name, map_polygon');

        if (fieldError && isMissingColumn(fieldError)) {
            state.needsPolygonColumn = true;

            ({
                data: fields,
                error: fieldError
            } = await fieldQuery('id, farm_id, field_name'));
        } else if (!fieldError) {
            state.needsPolygonColumn = false;
        }

        if (fieldError) throw fieldError;

        state.fields = (fields || []).sort((a, b) =>
            String(a.field_name || '').localeCompare(
                String(b.field_name || ''),
                undefined,
                { numeric: true }
            )
        );

        assignPolygons();

        if (state.fields.length) {
            const fieldIds = state.fields.map(field => field.id);

            const {
                data: plantings,
                error: plantingError
            } = await supabase
                .from('farm_plantings')
                .select(`
                    id,
                    crop_name,
                    crop_status,
                    sowing_date,
                    expected_harvest_date,
                    farmer_id,
                    field_id,
                    created_at,
                    farmer:profiles!farm_plantings_farmer_id_fkey (
                        full_name
                    )
                `)
                .in('field_id', fieldIds)
                .order('created_at', { ascending: false });

            if (plantingError) throw plantingError;

            state.plantings = plantings || [];

            const plantingIds = state.plantings.map(planting => planting.id);

            if (plantingIds.length) {
                const {
                    data: monitoring,
                    error: monitoringError
                } = await supabase
                    .from('agricultural_technician_crop_monitoring')
                    .select(`
                        monitoring_id,
                        planting_id,
                        growth_stage,
                        crop_health_status,
                        pest_observed,
                        disease_observed,
                        observations,
                        action_required,
                        recommended_action,
                        monitoring_date,
                        monitoring_status
                    `)
                    .in('planting_id', plantingIds)
                    .in('monitoring_status', ['submitted', 'reviewed'])
                    .order('monitoring_date', { ascending: false });

                if (monitoringError) {
                    console.error(
                        '[Farm Inspection Map] Monitoring error:',
                        monitoringError
                    );
                } else {
                    state.monitoring = monitoring || [];
                }
            }
        }

        await loadInspections();
    }

    /* ---------- Derived info per field ---------- */
    function getFieldInfo(field) {
        const plantings = state.plantings.filter(
            planting => planting.field_id === field.id
        );

        const current = plantings.find(planting =>
            ACTIVE_PLANTING_STATUSES.includes(planting.crop_status)
        ) || null;

        const display = current || plantings[0] || null;

        const plantingIds = new Set(
            plantings.map(planting => planting.id)
        );

        const monitoring = current
            ? state.monitoring.filter(
                record => record.planting_id === current.id
            )
            : [];

        const latestMonitoring = monitoring[0] || null;

        const highestStage = monitoring.reduce(
            (best, record) =>
                stageOrder(record.growth_stage) > stageOrder(best)
                    ? record.growth_stage
                    : best,
            monitoring[0]?.growth_stage || null
        );

        const inspections = state.inspections.filter(item =>
            item.field_id === field.id ||
            (!item.field_id && plantingIds.has(item.planting_id))
        );

        const latestCompleted = inspections.find(
            item => item.inspection_status === SUBMITTED_STATUS
        ) || null;

        const candidates = [];

        if (latestMonitoring?.crop_health_status) {
            candidates.push({
                condition: latestMonitoring.crop_health_status,
                time: new Date(latestMonitoring.monitoring_date).getTime()
            });
        }

        if (latestCompleted?.overall_condition) {
            candidates.push({
                condition: latestCompleted.overall_condition,
                time: new Date(latestCompleted.inspection_date).getTime()
            });
        }

        candidates.sort((a, b) => b.time - a.time);

        const condition = current
            ? candidates[0]?.condition || null
            : null;

        return {
            field,
            plantings,
            current,
            display,
            latestMonitoring,
            stage: highestStage,
            inspections,
            condition,
            tone: current ? toneOf(condition) : 'none'
        };
    }

    const getSelectedField = () =>
        state.fields.find(field => field.id === state.selectedFieldId) || null;

    const fieldLabel = field =>
        field?.field_name || 'Unnamed field';

    const getFarm = () =>
        state.farms.find(farm => farm.id === state.farmId) || null;

    function getHealthSummary(infos) {
        const active = infos.filter(info => info.current);

        const counts = {
            good: 0,
            fair: 0,
            poor: 0,
            critical: 0,
            unrated: 0
        };

        active.forEach(info => {
            counts[info.tone] += 1;
        });

        let tone = 'good';
        let label = 'Healthy';

        if (!active.length) {
            tone = 'none';
            label = 'No active plantings';
        } else if (counts.critical || counts.poor) {
            tone = counts.critical ? 'critical' : 'poor';
            label = 'Needs attention';
        } else if (counts.fair) {
            tone = 'fair';
            label = 'Fair';
        } else if (counts.unrated === active.length) {
            tone = 'unrated';
            label = 'Not yet rated';
        }

        return {
            counts,
            tone,
            label,
            activeCount: active.length
        };
    }

    /* ==========================================================
       MAP
       ========================================================== */
    let svg = null;
    let world = null;
    let zonesLayer = null;

    const zoneNodes = new Map();

    function buildMap() {
        stage.replaceChildren();
        zoneNodes.clear();

        svg = s('svg', {
            viewBox: `0 0 ${MAP_W} ${MAP_H}`,
            preserveAspectRatio: 'xMidYMid slice',
            role: 'group',
            'aria-label': 'Farm field map'
        }, 'fim-svg');

        world = s('g', {}, 'fim-world');
        zonesLayer = s('g', {}, 'fim-zones');

        world.append(
            buildBackground(),
            zonesLayer
        );

        svg.append(
            buildDefs(),
            world,
            s('rect', {
                width: MAP_W,
                height: MAP_H,
                fill: 'url(#fim-vignette)',
                'pointer-events': 'none'
            })
        );

        state.fields.forEach((field, index) => {
            const points = state.polygons.get(field.id);
            if (!points) return;

            const pts = points
                .map(point => point.join(','))
                .join(' ');

            const c = centroid(points);

            const zone = s('g', {
                tabindex: 0,
                role: 'button',
                'data-field-id': field.id
            }, 'fim-zone');

            const crop = s('polygon', {
                points: pts,
                fill: `url(#fim-rows-${'abcdef'[index % 6]})`
            }, 'fim-zone-crop');

            const shape = s('polygon', {
                points: pts
            }, 'fim-zone-shape');

            const anchor = s('g', {
                transform: `translate(${c.x.toFixed(1)} ${c.y.toFixed(1)})`
            });

            const tag = s('g', {}, 'fim-zone-tag');

            const dot = s('circle', {
                cx: 0,
                cy: -24,
                r: 6
            }, 'fim-zone-dot');

            const name = s('text', {
                x: 0,
                y: 0,
                'text-anchor': 'middle'
            }, 'fim-zone-label');

            name.textContent = fieldLabel(field);

            const sub = s('text', {
                x: 0,
                y: 20,
                'text-anchor': 'middle'
            }, 'fim-zone-sub');

            tag.append(dot, name, sub);
            anchor.append(tag);

            zone.append(crop, shape, anchor);
            zonesLayer.append(zone);

            zoneNodes.set(field.id, {
                zone,
                sub
            });
        });

        stage.append(svg);

        applyView();
        updateMapState();
    }

    function updateMapState() {
        state.fields.forEach(field => {
            const node = zoneNodes.get(field.id);
            if (!node) return;

            const info = getFieldInfo(field);
            const selected = field.id === state.selectedFieldId;

            node.zone.setAttribute(
                'class',
                `fim-zone tone-${info.tone}${selected ? ' is-selected' : ''}`
            );

            node.zone.setAttribute('aria-pressed', String(selected));

            node.zone.setAttribute(
                'aria-label',
                `${fieldLabel(field)}, ${info.current?.crop_name || 'no active planting'}, ${TONE_LABELS[info.tone]}`
            );

            node.sub.textContent = info.current?.crop_name || 'Fallow';

            if (selected) {
                zonesLayer.append(node.zone);
            }
        });
    }

    /* ---------- Zoom and pan ---------- */
    function clampView(k, x, y) {
        const kk = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

        return {
            k: kk,
            x: Math.min(0, Math.max(MAP_W - MAP_W * kk, x)),
            y: Math.min(0, Math.max(MAP_H - MAP_H * kk, y))
        };
    }

    function applyView() {
        if (!world || !svg) return;

        const { k, x, y } = state.view;

        world.style.transform = `translate(${x}px, ${y}px) scale(${k})`;

        svg.style.setProperty('--fim-inv', String(1 / k));

        zoomInBtn.disabled = k >= MAX_ZOOM - 0.001;
        zoomOutBtn.disabled = k <= MIN_ZOOM + 0.001;
    }

    function setView(next, animate = false) {
        state.view = clampView(next.k, next.x, next.y);

        world?.classList.toggle('is-animating', animate);

        applyView();
    }

    function toSvgPoint(clientX, clientY) {
        const ctm = svg?.getScreenCTM();

        if (!ctm) {
            return {
                x: MAP_W / 2,
                y: MAP_H / 2
            };
        }

        const pt = svg.createSVGPoint();

        pt.x = clientX;
        pt.y = clientY;

        const point = pt.matrixTransform(ctm.inverse());

        return {
            x: point.x,
            y: point.y
        };
    }

    function zoomAt(factor, point, animate = false) {
        const { k, x, y } = state.view;

        const nextK = Math.min(
            MAX_ZOOM,
            Math.max(MIN_ZOOM, k * factor)
        );

        const ratio = nextK / k;

        setView({
            k: nextK,
            x: point.x - (point.x - x) * ratio,
            y: point.y - (point.y - y) * ratio
        }, animate);
    }

    function zoomToField(field) {
        const points = state.polygons.get(field.id);
        if (!points) return;

        const c = centroid(points);
        const k = 1.8;

        setView({
            k,
            x: MAP_W / 2 - c.x * k,
            y: MAP_H / 2 - c.y * k
        }, true);
    }

    const resetView = () =>
        setView({
            k: 1,
            x: 0,
            y: 0
        }, true);

    const drag = {
        active: false,
        moved: false,
        startX: 0,
        startY: 0,
        originX: 0,
        originY: 0
    };

    function onPointerDown(event) {
        if (event.button !== 0 || !svg) return;

        drag.active = true;
        drag.moved = false;
        drag.startX = event.clientX;
        drag.startY = event.clientY;
        drag.originX = state.view.x;
        drag.originY = state.view.y;
    }

    function onPointerMove(event) {
        if (!drag.active) return;

        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;

        if (!drag.moved && Math.hypot(dx, dy) < 5) return;

        drag.moved = true;

        stage.classList.add('is-dragging');
        tooltip.hidden = true;

        const scale = svg.getScreenCTM()?.a || 1;

        setView({
            k: state.view.k,
            x: drag.originX + dx / scale,
            y: drag.originY + dy / scale
        });
    }

    function onPointerUp() {
        if (!drag.active) return;

        drag.active = false;

        stage.classList.remove('is-dragging');

        setTimeout(() => {
            drag.moved = false;
        }, 0);
    }

    function onWheel(event) {
        event.preventDefault();

        zoomAt(
            event.deltaY < 0 ? 1.18 : 1 / 1.18,
            toSvgPoint(event.clientX, event.clientY)
        );
    }

    function onStageClick(event) {
        if (drag.moved) return;

        const zone = event.target.closest?.('.fim-zone');

        if (zone) {
            selectField(zone.dataset.fieldId);
        } else if (state.selectedFieldId) {
            clearSelection();
        }
    }

    function onStageKey(event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;

        const zone = event.target.closest?.('.fim-zone');
        if (!zone) return;

        event.preventDefault();

        selectField(zone.dataset.fieldId);
    }

    function onStageHover(event) {
        if (drag.active) return;

        const zone = event.target.closest?.('.fim-zone');

        if (!zone) {
            tooltip.hidden = true;
            return;
        }

        const field = state.fields.find(
            item => String(item.id) === zone.dataset.fieldId
        );

        if (!field) return;

        const info = getFieldInfo(field);
        const rect = mapPane.getBoundingClientRect();

        tooltip.replaceChildren(
            h('strong', '', fieldLabel(field)),
            h(
                'span',
                '',
                `${info.current?.crop_name || 'No active planting'} · ${TONE_LABELS[info.tone]}`
            )
        );

        tooltip.style.left = `${Math.min(
            event.clientX - rect.left + 14,
            rect.width - 200
        )}px`;

        tooltip.style.top = `${event.clientY - rect.top + 14}px`;

        tooltip.hidden = false;
    }

    listen(stage, 'pointerdown', onPointerDown);
    listen(window, 'pointermove', onPointerMove);
    listen(window, 'pointerup', onPointerUp);
    listen(window, 'pointercancel', onPointerUp);
    listen(stage, 'wheel', onWheel, { passive: false });
    listen(stage, 'click', onStageClick);
    listen(stage, 'keydown', onStageKey);
    listen(stage, 'pointermove', onStageHover);
    listen(stage, 'pointerleave', () => {
        tooltip.hidden = true;
    });

    const centerPoint = () => ({
        x: MAP_W / 2,
        y: MAP_H / 2
    });

    listen(zoomInBtn, 'click', () =>
        zoomAt(1.4, centerPoint(), true)
    );

    listen(zoomOutBtn, 'click', () =>
        zoomAt(1 / 1.4, centerPoint(), true)
    );

    listen(layersBtn, 'click', () => {
        layersPanel.hidden = !layersPanel.hidden;

        layersBtn.setAttribute(
            'aria-expanded',
            String(!layersPanel.hidden)
        );
    });

    listen(fullscreenBtn, 'click', async () => {
        try {
            if (document.fullscreenElement) {
                await document.exitFullscreen();
            } else {
                await shell.requestFullscreen();
            }
        } catch (error) {
            console.error(
                '[Farm Inspection Map] Fullscreen error:',
                error
            );

            showToast('Fullscreen is not available in this browser.');
        }
    });

    listen(document, 'fullscreenchange', () => {
        const full = document.fullscreenElement === shell;

        fullscreenBtn.replaceChildren(
            icon(full ? 'collapse' : 'expand')
        );

        fullscreenBtn.setAttribute(
            'aria-label',
            full ? 'Exit fullscreen' : 'Enter fullscreen'
        );
    });

    /* ==========================================================
       TOAST
       ========================================================== */
    function showToast(message) {
        document.querySelector('.fim-toast')?.remove();

        const toast = h('div', 'toast fim-toast', message);

        toast.setAttribute('role', 'status');

        (
            document.fullscreenElement === shell
                ? shell
                : document.body
        ).append(toast);

        clearTimeout(toastTimer);

        toastTimer = setTimeout(() => {
            toast.remove();
        }, 3600);
    }

    /* ==========================================================
       SIDEBAR
       ========================================================== */
    function selectField(fieldId) {
        const field = state.fields.find(
            item => String(item.id) === String(fieldId)
        );

        if (!field) return;

        state.selectedFieldId = field.id;

        updateMapState();
        renderSidebar(true);
        zoomToField(field);
    }

    function clearSelection() {
        state.selectedFieldId = null;

        updateMapState();
        renderSidebar(true);
        resetView();
    }

    function toneBadge(tone, text) {
        return h(
            'span',
            `fim-pill tone-${tone}`,
            text || TONE_LABELS[tone]
        );
    }

    function statusBadge(status) {
        const draft = status === DRAFT_STATUS;

        return h(
            'span',
            `fim-pill ${draft ? 'is-draft' : `status-${status}`}`,
            draft ? 'Draft' : formatStatus(status)
        );
    }

    function infoRow(label, value) {
        const row = h('div', 'fim-info');

        row.append(
            h('small', '', label),
            h('strong', '', value || '—')
        );

        return row;
    }

    async function signPhoto(path) {
        if (!path) return null;

        const {
            data,
            error
        } = await supabase.storage
            .from(STORAGE_BUCKET)
            .createSignedUrl(path, 3600);

        if (error) {
            console.error(
                '[Farm Inspection Map] Photo URL error:',
                error
            );

            return null;
        }

        return data?.signedUrl || null;
    }

    function findInspectionField(inspection) {
        return state.fields.find(
            field => field.id === inspection.field_id
        ) || state.fields.find(field =>
            state.plantings.some(planting =>
                planting.id === inspection.planting_id &&
                planting.field_id === field.id
            )
        ) || null;
    }

    function inspectionItem(inspection, { showField = false } = {}) {
        const item = h('article', 'fim-record');

        const top = h('div', 'fim-record-top');
        const title = h('div');

        title.append(
            h('strong', '', formatStatus(inspection.inspection_type)),
            h('small', '', formatDateTime(inspection.inspection_date))
        );

        top.append(
            title,
            statusBadge(inspection.inspection_status)
        );

        const meta = h('div', 'fim-record-meta');

        if (showField) {
            const field = findInspectionField(inspection);

            if (field) {
                meta.append(
                    h('span', 'fim-chip', fieldLabel(field))
                );
            }
        }

        if (inspection.overall_condition) {
            meta.append(
                toneBadge(
                    toneOf(inspection.overall_condition),
                    formatStatus(inspection.overall_condition)
                )
            );
        }

        if (inspection.action_required) {
            meta.append(
                h('span', 'fim-pill status-action', 'Action required')
            );
        }

        item.append(top);

        if (meta.childNodes.length) {
            item.append(meta);
        }

        if (inspection.findings) {
            item.append(
                h('p', 'fim-record-text', inspection.findings)
            );
        }

        const actions = h('div', 'fim-record-actions');

        if (inspection.evidence_photo_path) {
            const link = h('a', 'fim-link', 'View photo');

            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.hidden = true;

            actions.append(link);

            signPhoto(inspection.evidence_photo_path).then(url => {
                if (disposed || !url) return;

                link.href = url;
                link.hidden = false;
            });
        }

        if (inspection.inspection_status === DRAFT_STATUS) {
            const field = findInspectionField(inspection);

            if (field) {
                const resume = h(
                    'button',
                    'fim-btn fim-btn-small',
                    'Continue draft'
                );

                resume.type = 'button';
                resume.disabled = state.needsInspectionColumns;

                resume.addEventListener('click', () => {
                    openInspectionForm(field, inspection);
                });

                actions.append(resume);
            }
        }

        if (actions.childNodes.length) {
            item.append(actions);
        }

        return item;
    }

    function renderOverview(infos) {
        const farm = getFarm();
        const summary = getHealthSummary(infos);

        const farmBlock = h('div', 'fim-farm');

        if (state.farms.length > 1) {
            const select = h('select', 'fim-farm-select');

            select.setAttribute('aria-label', 'Select farm');

            state.farms.forEach(item => {
                const option = h(
                    'option',
                    '',
                    item.farm_name || 'Unnamed farm'
                );

                option.value = item.id;
                option.selected = item.id === state.farmId;

                select.append(option);
            });

            select.addEventListener('change', async () => {
                state.farmId = select.value;
                await refreshFarm();
            });

            farmBlock.append(select);
        } else {
            farmBlock.append(
                h('h3', '', farm?.farm_name || 'Unnamed farm')
            );
        }

        farmBlock.append(
            h('p', '', farm?.farm_location || 'Location not set')
        );

        const stats = h('div', 'fim-stats');

        [
            [state.fields.length, 'Fields'],
            [summary.activeCount, 'Active plantings'],
            [state.inspections.length, 'Inspections']
        ].forEach(([value, label]) => {
            const box = h('div', 'fim-stat');

            box.append(
                h('strong', '', String(value)),
                h('span', '', label)
            );

            stats.append(box);
        });

        const health = h('section', 'fim-section');

        const healthHead = h('div', 'fim-section-head');

        healthHead.append(
            h('h4', '', 'Crop health'),
            toneBadge(summary.tone, summary.label)
        );

        health.append(healthHead);

        const bar = h('div', 'fim-health-bar');

        bar.setAttribute('role', 'img');
        bar.setAttribute(
            'aria-label',
            `Crop health: ${summary.label}`
        );

        if (summary.activeCount) {
            [
                'good',
                'fair',
                'poor',
                'critical',
                'unrated'
            ].forEach(tone => {
                if (!summary.counts[tone]) return;

                const segment = h('span', `tone-${tone}`);

                segment.style.flexGrow = String(summary.counts[tone]);

                bar.append(segment);
            });
        } else {
            bar.append(h('span', 'tone-none'));
        }

        health.append(bar);

        const counts = h('div', 'fim-health-counts');

        ['good', 'fair', 'poor', 'critical'].forEach(tone => {
            const item = h(
                'span',
                `fim-legend-item tone-${tone}`
            );

            item.append(
                h('i'),
                document.createTextNode(
                    `${TONE_LABELS[tone]} ${summary.counts[tone]}`
                )
            );

            counts.append(item);
        });

        health.append(counts);

        const list = h('section', 'fim-section');

        const listHead = h('div', 'fim-section-head');

        listHead.append(h('h4', '', 'Fields'));
        list.append(listHead);

        if (!infos.length) {
            list.append(
                h(
                    'p',
                    'fim-muted',
                    'No fields are registered for this farm yet.'
                )
            );
        }

        infos.forEach(info => {
            const row = h(
                'button',
                `fim-field-row tone-${info.tone}`
            );

            row.type = 'button';

            const main = h('span', 'fim-field-main');

            main.append(
                h('strong', '', fieldLabel(info.field)),
                h(
                    'small',
                    '',
                    `${info.current?.crop_name || 'Fallow'}${info.stage ? ` · ${stageLabel(info.stage)}` : ''}`
                )
            );

            row.append(
                h('i', 'fim-dot'),
                main,
                toneBadge(info.tone),
                icon('chevron', 16)
            );

            if (!state.polygons.has(info.field.id)) {
                row.title = 'This field has no position on the map.';
            }

            row.addEventListener('click', () => {
                selectField(info.field.id);
            });

            list.append(row);
        });

        const historyBtn = h(
            'button',
            'fim-btn fim-btn-ghost fim-btn-block'
        );

        historyBtn.type = 'button';

        historyBtn.append(
            icon('history', 16),
            document.createTextNode('View inspection history')
        );

        historyBtn.addEventListener('click', openHistory);

        sidebar.append(
            farmBlock,
            stats,
            health,
            list
        );

        if (state.needsInspectionColumns) {
            sidebar.append(setupNotice());
        }

        sidebar.append(historyBtn);
    }

    function setupNotice() {
        const notice = h('div', 'fim-notice');

        notice.setAttribute('role', 'alert');

        notice.append(
            h('strong', '', 'Database setup needed'),
            h(
                'p',
                '',
                'The inspection table is missing required columns. Verify the farm inspection database setup before saving inspections.'
            )
        );

        return notice;
    }

    function renderDetail(field) {
        const info = getFieldInfo(field);

        const back = h('button', 'fim-back');

        back.type = 'button';

        back.append(
            icon('back', 16),
            document.createTextNode('All fields')
        );

        back.addEventListener('click', clearSelection);

        const head = h('div', 'fim-detail-head');
        const titleWrap = h('div');

        titleWrap.append(
            h('h3', '', fieldLabel(field)),
            h('p', '', getFarm()?.farm_name || '')
        );

        head.append(
            titleWrap,
            toneBadge(info.tone)
        );

        const grid = h('div', 'fim-info-grid');
        const planting = info.display;

        grid.append(
            infoRow('Crop planted', planting?.crop_name || 'None'),
            infoRow(
                'Planting status',
                planting ? formatStatus(planting.crop_status) : 'No planting'
            ),
            infoRow(
                'Growth stage',
                info.stage ? stageLabel(info.stage) : 'Not recorded'
            ),
            infoRow(
                'Crop condition',
                info.condition
                    ? formatStatus(info.condition)
                    : TONE_LABELS[info.tone]
            ),
            infoRow('Farmer', planting?.farmer?.full_name),
            infoRow('Sowing date', formatDate(planting?.sowing_date)),
            infoRow(
                'Expected harvest',
                formatDate(planting?.expected_harvest_date)
            )
        );

        const latest = h('section', 'fim-section');
        const latestHead = h('div', 'fim-section-head');

        latestHead.append(
            h('h4', '', 'Latest monitoring record')
        );

        latest.append(latestHead);

        if (info.latestMonitoring) {
            const record = info.latestMonitoring;

            const box = h('article', 'fim-record');
            const top = h('div', 'fim-record-top');
            const title = h('div');

            title.append(
                h('strong', '', stageLabel(record.growth_stage)),
                h('small', '', formatDateTime(record.monitoring_date))
            );

            top.append(
                title,
                toneBadge(
                    toneOf(record.crop_health_status),
                    formatStatus(record.crop_health_status)
                )
            );

            const meta = h('div', 'fim-record-meta');

            meta.append(
                h(
                    'span',
                    'fim-chip',
                    `Pest: ${record.pest_observed ? 'Yes' : 'No'}`
                ),
                h(
                    'span',
                    'fim-chip',
                    `Disease: ${record.disease_observed ? 'Yes' : 'No'}`
                )
            );

            if (record.action_required) {
                meta.append(
                    h('span', 'fim-pill status-action', 'Action required')
                );
            }

            box.append(top, meta);

            if (record.observations) {
                box.append(
                    h('p', 'fim-record-text', record.observations)
                );
            }

            latest.append(box);
        } else {
            latest.append(
                h(
                    'p',
                    'fim-muted',
                    info.current
                        ? 'No monitoring records for this planting yet.'
                        : 'No active planting to monitor.'
                )
            );
        }

        const start = h('button', 'fim-btn fim-btn-block');

        start.type = 'button';

        start.append(
            icon('clipboard', 16),
            document.createTextNode('Start inspection')
        );

        start.disabled = state.needsInspectionColumns || !staffId;

        start.addEventListener('click', () => {
            openInspectionForm(field);
        });

        const previous = h('section', 'fim-section');
        const previousHead = h('div', 'fim-section-head');

        previousHead.append(
            h('h4', '', 'Previous inspections'),
            h('span', 'fim-chip', String(info.inspections.length))
        );

        previous.append(previousHead);

        if (!info.inspections.length) {
            previous.append(
                h(
                    'p',
                    'fim-muted',
                    'No inspections recorded for this field.'
                )
            );
        } else {
            const list = h('div', 'fim-records');

            info.inspections
                .slice(0, 5)
                .forEach(item => list.append(inspectionItem(item)));

            previous.append(list);

            if (info.inspections.length > 5) {
                const more = h(
                    'button',
                    'fim-link fim-link-button',
                    `View all ${info.inspections.length}`
                );

                more.type = 'button';

                more.addEventListener('click', () => {
                    openHistory(field.id);
                });

                previous.append(more);
            }
        }

        sidebar.append(
            back,
            head,
            grid,
            latest,
            start
        );

        if (state.needsInspectionColumns) {
            sidebar.append(setupNotice());
        }

        sidebar.append(previous);
    }

    function renderSidebar(resetScroll = false) {
        if (disposed) return;

        sidebar.replaceChildren();

        const infos = state.fields.map(getFieldInfo);
        const selected = getSelectedField();

        if (selected) {
            renderDetail(selected);
        } else {
            renderOverview(infos);
        }

        if (resetScroll) {
            sidebar.scrollTop = 0;
        }
    }

    /* ==========================================================
       MODAL
       ========================================================== */
    function openModal({
        title,
        subtitle = '',
        body,
        onClose = null
    }) {
        modalReturnFocus = document.activeElement;
        modalOnClose = onClose;

        modalHost.replaceChildren();

        const overlay = h('div', 'fim-modal-overlay');

        overlay.addEventListener('click', () => {
            closeModal();
        });

        const dialog = h('div', 'fim-modal-dialog');

        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-label', title);

        const head = h('div', 'fim-modal-head');
        const text = h('div');

        text.append(h('h3', '', title));

        if (subtitle) {
            text.append(h('p', '', subtitle));
        }

        const closeBtn = iconButton(
            'close',
            'Close',
            'fim-modal-close'
        );

        closeBtn.addEventListener('click', () => {
            closeModal();
        });

        head.append(text, closeBtn);
        dialog.append(head, body);

        modalHost.append(overlay, dialog);

        previousBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        modalHost.hidden = false;

        const focusTarget = dialog.querySelector(
            'select, input, textarea, button'
        );

        focusTarget?.focus();
    }

    function closeModal(force = false) {
        if (modalHost.hidden) return;
        if (state.saving && !force) return;

        modalHost.hidden = true;
        modalHost.replaceChildren();

        document.body.style.overflow = previousBodyOverflow;

        if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
            previewUrl = null;
        }

        modalOnClose?.();
        modalOnClose = null;

        if (modalReturnFocus?.isConnected) {
            modalReturnFocus.focus();
        }

        modalReturnFocus = null;
    }

    listen(document, 'keydown', event => {
        if (event.key === 'Escape' && !modalHost.hidden) {
            closeModal();
        }
    });

    /* ---------- Inspection history ---------- */
    function openHistory(fieldId = null) {
        const body = h('div', 'fim-modal-body');

        const filter = h('select', 'fim-farm-select');

        filter.setAttribute('aria-label', 'Filter by field');

        const all = h('option', '', 'All fields');

        all.value = '';
        filter.append(all);

        state.fields.forEach(field => {
            const option = h('option', '', fieldLabel(field));

            option.value = field.id;
            filter.append(option);
        });

        filter.value =
            typeof fieldId === 'string' || typeof fieldId === 'number'
                ? String(fieldId)
                : '';

        const list = h('div', 'fim-records');

        const draw = () => {
            list.replaceChildren();

            const items = state.inspections.filter(item => {
                if (!filter.value) return true;

                const field = state.fields.find(
                    current => String(current.id) === filter.value
                );

                const ids = new Set(
                    state.plantings
                        .filter(planting => planting.field_id === field?.id)
                        .map(planting => planting.id)
                );

                return (
                    String(item.field_id) === filter.value ||
                    (!item.field_id && ids.has(item.planting_id))
                );
            });

            if (!items.length) {
                list.append(
                    h('p', 'fim-muted', 'No inspections found.')
                );

                return;
            }

            items
                .slice(0, 50)
                .forEach(item => {
                    list.append(
                        inspectionItem(item, { showField: true })
                    );
                });
        };

        filter.addEventListener('change', draw);

        draw();

        body.append(filter, list);

        openModal({
            title: 'Inspection history',
            subtitle: getFarm()?.farm_name || '',
            body
        });
    }

    /* ---------- Inspection form ---------- */
    function formGroup(
        id,
        label,
        control,
        { required = false, hint = '' } = {}
    ) {
        const group = h('div', 'fim-form-group');

        const labelEl = h(
            'label',
            required ? 'is-required' : '',
            label
        );

        labelEl.htmlFor = id;
        control.id = id;

        group.append(labelEl, control);

        if (hint) {
            group.append(h('small', '', hint));
        }

        return group;
    }

    function selectControl(name, options, placeholder = '') {
        const select = h('select');

        select.name = name;

        if (placeholder) {
            const first = h('option', '', placeholder);

            first.value = '';
            select.append(first);
        }

        options.forEach(([value, label]) => {
            const option = h('option', '', label);

            option.value = value;
            select.append(option);
        });

        return select;
    }

    function textControl(name, rows, placeholder) {
        const area = h('textarea');

        area.name = name;
        area.rows = rows;
        area.placeholder = placeholder;

        return area;
    }

    const yesNo = () =>
        selectControl('yn', [
            ['false', 'No'],
            ['true', 'Yes']
        ]);

    function openInspectionForm(field, draft = null) {
        if (state.needsInspectionColumns) {
            showToast('The inspection database setup needs to be checked.');
            return;
        }

        const info = getFieldInfo(field);

        const form = h('form', 'fim-form');
        form.noValidate = true;

        const c = {};

        c.date = h('input');
        c.date.type = 'datetime-local';
        c.date.value = toLocalInput(
            draft?.inspection_date || new Date()
        );

        c.type = selectControl(
            'inspection_type',
            INSPECTION_TYPES,
            'Select inspection type'
        );

        c.condition = selectControl(
            'overall_condition',
            CONDITIONS,
            'Select overall condition'
        );

        c.stage = selectControl(
            'growth_stage_observation',
            GROWTH_STAGES,
            'Select growth stage'
        );

        c.soil = selectControl(
            'soil_condition',
            SOIL_CONDITIONS,
            'Select soil condition'
        );

        c.pest = yesNo();

        c.pestDetails = textControl(
            'pest_details',
            2,
            'Describe the pests observed...'
        );

        c.disease = yesNo();

        c.diseaseDetails = textControl(
            'disease_details',
            2,
            'Describe the disease observed...'
        );

        c.findings = textControl(
            'findings',
            3,
            'Summarize what you found...'
        );

        c.observations = textControl(
            'observations',
            3,
            'Any other observations...'
        );

        c.action = yesNo();

        c.actionDetails = textControl(
            'recommended_action',
            3,
            'Enter the recommended action...'
        );

        c.photo = h('input');
        c.photo.type = 'file';
        c.photo.accept = ALLOWED_PHOTO_TYPES.join(',');

        const preview = h('img', 'fim-photo-preview');

        preview.alt = 'Photo evidence preview';
        preview.hidden = true;

        if (draft) {
            c.type.value = draft.inspection_type || '';
            c.condition.value = draft.overall_condition || '';
            c.stage.value = draft.growth_stage_observation || '';
            c.soil.value = draft.soil_condition || '';

            c.pest.value = String(!!draft.pest_observed);
            c.pestDetails.value = draft.pest_details || '';

            c.disease.value = String(!!draft.disease_observed);
            c.diseaseDetails.value = draft.disease_details || '';

            c.findings.value = draft.findings || '';
            c.observations.value = draft.observations || '';

            c.action.value = String(!!draft.action_required);
            c.actionDetails.value = draft.recommended_action || '';
        } else if (info.stage) {
            c.stage.value = info.stage;
        }

        const g = {
            pestDetails: formGroup(
                'fimPestDetails',
                'Pest details',
                c.pestDetails
            ),

            diseaseDetails: formGroup(
                'fimDiseaseDetails',
                'Disease details',
                c.diseaseDetails
            ),

            actionDetails: formGroup(
                'fimActionDetails',
                'Recommended action',
                c.actionDetails
            )
        };

        const sync = () => {
            g.pestDetails.hidden = c.pest.value !== 'true';
            g.diseaseDetails.hidden = c.disease.value !== 'true';
            g.actionDetails.hidden = c.action.value !== 'true';
        };

        [c.pest, c.disease, c.action].forEach(element => {
            element.addEventListener('change', sync);
        });

        sync();

        const photoGroup = formGroup(
            'fimPhoto',
            'Photo evidence',
            c.photo,
            {
                hint: draft?.evidence_photo_path
                    ? 'A photo is already attached. Choose a new file to replace it. JPG, PNG, or WebP, max 3 MB.'
                    : 'JPG, PNG, or WebP. Maximum file size: 3 MB.'
            }
        );

        photoGroup.append(preview);

        const errorBox = h('p', 'fim-form-error');

        errorBox.setAttribute('role', 'alert');
        errorBox.hidden = true;

        const showError = message => {
            errorBox.textContent = message;
            errorBox.hidden = !message;

            if (message) {
                errorBox.scrollIntoView({
                    block: 'nearest',
                    behavior: 'smooth'
                });
            }
        };

        c.photo.addEventListener('change', () => {
            if (previewUrl) {
                URL.revokeObjectURL(previewUrl);
                previewUrl = null;
            }

            const file = c.photo.files?.[0];

            preview.hidden = true;
            preview.removeAttribute('src');

            showError('');

            if (!file) return;

            if (!ALLOWED_PHOTO_TYPES.includes(file.type)) {
                c.photo.value = '';

                showError(
                    'Only JPG, PNG, and WebP images are allowed.'
                );

                return;
            }

            if (file.size > MAX_PHOTO_SIZE) {
                c.photo.value = '';

                showError('Photo must not exceed 3 MB.');

                return;
            }

            previewUrl = URL.createObjectURL(file);
            preview.src = previewUrl;
            preview.hidden = false;
        });

        const row = (...groups) => {
            const wrap = h('div', 'fim-form-row');

            wrap.append(...groups);

            return wrap;
        };

        const cancelBtn = h(
            'button',
            'fim-btn fim-btn-ghost',
            'Cancel'
        );

        cancelBtn.type = 'button';

        cancelBtn.addEventListener('click', () => {
            closeModal();
        });

        const draftBtn = h(
            'button',
            'fim-btn fim-btn-ghost',
            'Save draft'
        );

        draftBtn.type = 'button';

        const submitBtn = h(
            'button',
            'fim-btn',
            'Submit inspection'
        );

        submitBtn.type = 'submit';

        const actions = h('div', 'fim-form-actions');

        actions.append(
            cancelBtn,
            draftBtn,
            submitBtn
        );

        form.append(
            row(
                formGroup(
                    'fimDate',
                    'Inspection date',
                    c.date,
                    { required: true }
                ),
                formGroup(
                    'fimType',
                    'Inspection type',
                    c.type,
                    { required: true }
                )
            ),

            row(
                formGroup(
                    'fimCondition',
                    'Overall crop condition',
                    c.condition,
                    { required: true }
                ),
                formGroup(
                    'fimStage',
                    'Growth stage observation',
                    c.stage
                )
            ),

            formGroup(
                'fimSoil',
                'Soil condition',
                c.soil
            ),

            formGroup(
                'fimPest',
                'Pest observed?',
                c.pest
            ),

            g.pestDetails,

            formGroup(
                'fimDisease',
                'Disease observed?',
                c.disease
            ),

            g.diseaseDetails,

            formGroup(
                'fimFindings',
                'Findings',
                c.findings,
                {
                    required: true,
                    hint: 'Required when submitting.'
                }
            ),

            formGroup(
                'fimObservations',
                'General observations',
                c.observations
            ),

            formGroup(
                'fimAction',
                'Action required?',
                c.action
            ),

            g.actionDetails,
            photoGroup,
            errorBox,
            actions
        );

        function validate(status) {
            if (
                !c.date.value ||
                Number.isNaN(new Date(c.date.value).getTime())
            ) {
                return 'Please enter the inspection date.';
            }

            if (!c.type.value) {
                return 'Please select the inspection type.';
            }

            if (!c.condition.value) {
                return 'Please select the overall crop condition.';
            }

            if (status === SUBMITTED_STATUS) {
                if (!c.findings.value.trim()) {
                    return 'Please enter your findings.';
                }

                if (
                    c.pest.value === 'true' &&
                    !c.pestDetails.value.trim()
                ) {
                    return 'Please describe the pests observed.';
                }

                if (
                    c.disease.value === 'true' &&
                    !c.diseaseDetails.value.trim()
                ) {
                    return 'Please describe the disease observed.';
                }

                if (
                    c.action.value === 'true' &&
                    !c.actionDetails.value.trim()
                ) {
                    return 'Please enter the recommended action.';
                }
            }

            return '';
        }

        async function save(status) {
            if (state.saving) return;

            const problem = validate(status);

            showError(problem);

            if (problem) return;

            const pestObserved = c.pest.value === 'true';
            const diseaseObserved = c.disease.value === 'true';
            const actionRequired = c.action.value === 'true';

            const record = {
                technician_staff_id: staffId,
                farm_id: state.farmId,
                field_id: field.id,
                planting_id: info.current?.id || info.display?.id || null,

                inspection_date: new Date(c.date.value).toISOString(),

                inspection_type: c.type.value,
                overall_condition: c.condition.value,

                growth_stage_observation: emptyToNull(c.stage.value),
                soil_condition: emptyToNull(c.soil.value),

                pest_observed: pestObserved,
                pest_details: pestObserved
                    ? emptyToNull(c.pestDetails.value)
                    : null,

                disease_observed: diseaseObserved,
                disease_details: diseaseObserved
                    ? emptyToNull(c.diseaseDetails.value)
                    : null,

                // findings is NOT NULL in the database.
                // Keep an empty string for drafts instead of null.
                findings: c.findings.value.trim(),

                observations: emptyToNull(c.observations.value),

                action_required: actionRequired,

                recommended_action: actionRequired
                    ? emptyToNull(c.actionDetails.value)
                    : null,

                inspection_status: status
            };

            const file = c.photo.files?.[0] || null;

            let uploadedPath = null;

            state.saving = true;

            [cancelBtn, draftBtn, submitBtn].forEach(button => {
                button.disabled = true;
            });

            (
                status === DRAFT_STATUS
                    ? draftBtn
                    : submitBtn
            ).textContent = 'Saving...';

            try {
                if (file) {
                    const extension =
                        file.type === 'image/jpeg'
                            ? 'jpg'
                            : file.type === 'image/png'
                                ? 'png'
                                : 'webp';

                    uploadedPath = `${PHOTO_FOLDER}/${state.farmId}/${crypto.randomUUID()}.${extension}`;

                    const {
                        error: uploadError
                    } = await supabase.storage
                        .from(STORAGE_BUCKET)
                        .upload(
                            uploadedPath,
                            file,
                            {
                                cacheControl: '3600',
                                upsert: false,
                                contentType: file.type
                            }
                        );

                    if (uploadError) {
                        uploadedPath = null;
                        throw uploadError;
                    }

                    record.evidence_photo_path = uploadedPath;
                }

                if (draft) {
                    const {
                        error
                    } = await supabase
                        .from('agricultural_inspections')
                        .update(record)
                        .eq('inspection_id', draft.inspection_id)
                        .eq('technician_staff_id', staffId)
                        .eq('inspection_status', DRAFT_STATUS);

                    if (error) throw error;

                    if (
                        uploadedPath &&
                        draft.evidence_photo_path
                    ) {
                        const {
                            error: removeError
                        } = await supabase.storage
                            .from(STORAGE_BUCKET)
                            .remove([draft.evidence_photo_path]);

                        if (removeError) {
                            console.error(
                                '[Farm Inspection Map] Old photo removal error:',
                                removeError
                            );
                        }
                    }
                } else {
                    const {
                        error
                    } = await supabase
                        .from('agricultural_inspections')
                        .insert(record);

                    if (error) throw error;
                }

                await loadInspections();

                state.saving = false;

                closeModal(true);

                updateMapState();
                renderSidebar();

                showToast(
                    status === DRAFT_STATUS
                        ? 'Draft saved.'
                        : 'Inspection submitted.'
                );
            } catch (error) {
                console.error(
                    '[Farm Inspection Map] Save error:',
                    error
                );

                if (uploadedPath) {
                    const {
                        error: cleanupError
                    } = await supabase.storage
                        .from(STORAGE_BUCKET)
                        .remove([uploadedPath]);

                    if (cleanupError) {
                        console.error(
                            '[Farm Inspection Map] Photo cleanup error:',
                            cleanupError
                        );
                    }
                }

                showError(
                    `Unable to save the inspection: ${error.message || 'Unknown error.'}`
                );

                state.saving = false;

                [cancelBtn, draftBtn, submitBtn].forEach(button => {
                    button.disabled = false;
                });

                draftBtn.textContent = 'Save draft';
                submitBtn.textContent = 'Submit inspection';
            }
        }

        draftBtn.addEventListener('click', () => {
            save(DRAFT_STATUS);
        });

        form.addEventListener('submit', event => {
            event.preventDefault();
            save(SUBMITTED_STATUS);
        });

        openModal({
            title: draft
                ? 'Continue inspection draft'
                : 'Start inspection',

            subtitle: `${fieldLabel(field)} · ${info.current?.crop_name || 'No active planting'}`,

            body: form
        });
    }

    /* ==========================================================
       LOAD
       ========================================================== */
    function renderMessage(title, text, className = 'fim-notice') {
        sidebar.replaceChildren();

        const box = h('div', className);

        box.setAttribute(
            'role',
            className === 'fim-notice'
                ? 'alert'
                : 'status'
        );

        box.append(
            h('strong', '', title),
            h('p', '', text)
        );

        sidebar.append(box);
    }

    async function refreshFarm() {
        const token = ++loadToken;

        renderMessage(
            'Loading farm...',
            'Fetching fields, plantings, and inspections.',
            'fim-empty'
        );

        stage.replaceChildren();

        try {
            await loadFarmData();

            if (disposed || token !== loadToken) return;

            buildMap();
            resetView();
            renderSidebar(true);
        } catch (error) {
            if (disposed || token !== loadToken) return;

            console.error(
                '[Farm Inspection Map] Loading error:',
                error
            );

            renderMessage(
                'Unable to load the farm map',
                error.message || 'Please try again.'
            );
        }
    }

    renderMessage(
        'Loading farm...',
        'Fetching your assigned farms.',
        'fim-empty'
    );

    try {
        await loadFarms();

        if (disposed) return;

        if (!state.farms.length) {
            renderMessage(
                'No farms assigned',
                'There are no active farms assigned to your Agricultural Technician account yet.',
                'fim-empty'
            );
        } else {
            state.farmId = state.farms[0].id;
            await refreshFarm();
        }
    } catch (error) {
        console.error(
            '[Farm Inspection Map] Farms error:',
            error
        );

        renderMessage(
            'Unable to load farms',
            error.message || 'Please try again.'
        );
    }

    return {
        cleanup() {
            disposed = true;

            clearTimeout(toastTimer);

            document.querySelector('.fim-toast')?.remove();

            cleanups.forEach(fn => fn());

            if (!modalHost.hidden) {
                document.body.style.overflow = previousBodyOverflow;
            }

            if (previewUrl) {
                URL.revokeObjectURL(previewUrl);
                previewUrl = null;
            }

            if (document.fullscreenElement === shell) {
                document.exitFullscreen?.();
            }
        }
    };
}