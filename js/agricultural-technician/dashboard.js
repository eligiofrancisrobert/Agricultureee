
import { supabase } from '../connection.js';
import { h, pageHead } from '../admin/ui.js';

/* ==========================================================
   CONFIGURATION
   ========================================================== */

const TERMINAL_CROP_STATUSES = [
    'harvested',
    'failed',
    'cancelled'
];

const ATTENTION_HEALTH_STATUSES = [
    'poor',
    'critical'
];

const UPCOMING_HARVEST_DAYS = 7;

/* ==========================================================
   HELPERS
   ========================================================== */

const formatLabel = value => {
    if (!value) return 'Not specified';

    return String(value)
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, character => character.toUpperCase());
};

function localDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
}

function formatDate(value) {
    if (!value) return 'Not set';

    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);

    if (Number.isNaN(date.getTime())) return String(value);

    return date.toLocaleDateString('en-PH', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
}

function formatDateTime(value) {
    if (!value) return 'Not available';

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return 'Not available';

    return date.toLocaleString('en-PH', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
}

function isActivePlanting(planting) {
    return !TERMINAL_CROP_STATUSES.includes(
        String(planting.crop_status || '').toLowerCase()
    );
}

function badge(label, type = 'neutral') {
    return h(
        'span',
        {
            class: `at-status-badge at-status-${type}`
        },
        label
    );
}

function emptyState(message) {
    return h(
        'div',
        { class: 'at-dashboard-empty' },
        h('p', {}, message)
    );
}

function sectionHeader(title, description, link = null) {
    return h(
        'div',
        { class: 'at-dashboard-section-header' },
        h(
            'div',
            {},
            h('h2', {}, title),
            h('p', { class: 'muted' }, description)
        ),
        link
            ? h(
                'a',
                {
                    href: link.href,
                    class: 'at-dashboard-view-all'
                },
                link.label
            )
            : null
    );
}

function metricCard(title, value, description, icon, color) {
    return h(
        'article',
        {
            class: 'at-metric-card',
            style: `--metric-color:${color};`
        },
        h(
            'div',
            { class: 'at-metric-card-top' },
            h('span', { class: 'at-metric-icon' }, icon)
        ),
        h(
            'div',
            { class: 'at-metric-card-content' },
            h('p', { class: 'muted' }, title),
            h('h2', { class: 'at-metric-value' }, String(value)),
            h('span', { class: 'muted' }, description)
        )
    );
}

function createTable(headers, rows, emptyMessage) {
    if (!rows.length) return emptyState(emptyMessage);

    return h(
        'div',
        { class: 'at-dashboard-table-wrap' },
        h(
            'table',
            { class: 'at-dashboard-table' },
            h(
                'thead',
                {},
                h(
                    'tr',
                    {},
                    headers.map(header => h('th', {}, header))
                )
            ),
            h(
                'tbody',
                {},
                rows
            )
        )
    );
}

function tableRow(cells) {
    return h(
        'tr',
        {},
        cells.map(cell =>
            h('td', {}, cell)
        )
    );
}

function getHealthType(status) {
    const value = String(status || '').toLowerCase();

    if (value === 'healthy' || value === 'good') return 'success';
    if (value === 'fair' || value === 'satisfactory') return 'warning';
    if (value === 'poor' || value === 'needs_attention') return 'danger';
    if (value === 'critical') return 'critical';

    return 'neutral';
}

function getInspectionType(status) {
    const value = String(status || '').toLowerCase();

    if (value === 'submitted' || value === 'reviewed' || value === 'closed') {
        return 'success';
    }

    if (value === 'draft') return 'warning';

    return 'neutral';
}

function quickAction(title, description, icon, href) {
    return h(
        'a',
        {
            class: 'at-quick-action',
            href
        },
        h('span', { class: 'at-quick-action-icon' }, icon),
        h(
            'span',
            { class: 'at-quick-action-content' },
            h('strong', {}, title),
            h('small', {}, description)
        ),
        h('span', { class: 'at-quick-action-arrow' }, '→')
    );
}

/* ==========================================================
   DATA
   ========================================================== */

async function loadAssignedFarms(staffId) {
    const { data: assignments, error } = await supabase
        .from('agricultural_technician_farm_assignments')
        .select('farm_id')
        .eq('technician_staff_id', staffId)
        .eq('assignment_status', 'active')
        .is('unassigned_at', null);

    if (error) throw error;

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

    if (farmError) throw farmError;

    return farms ?? [];
}

async function loadPlantings(farmIds) {
    if (!farmIds.length) return [];

    const { data, error } = await supabase
        .from('farm_plantings')
        .select(`
            id,
            crop_name,
            crop_status,
            activity_status,
            sowing_date,
            expected_harvest_date,
            field_id,
            farm_fields!inner (
                id,
                farm_id,
                field_name
            )
        `)
        .in('farm_fields.farm_id', farmIds)
        .order('expected_harvest_date', {
            ascending: true,
            nullsFirst: false
        });

    if (error) throw error;

    return (data ?? []).map(planting => ({
        ...planting,
        farm_id: planting.farm_fields?.farm_id,
        field_name: planting.farm_fields?.field_name || 'Unnamed field'
    }));
}

async function loadMonitoring(staffId) {
    const { data, error } = await supabase
        .from('agricultural_technician_crop_monitoring')
        .select(`
            monitoring_id,
            planting_id,
            growth_stage,
            crop_health_status,
            action_required,
            observations,
            recommended_action,
            monitoring_date,
            monitoring_status
        `)
        .eq('technician_staff_id', staffId)
        .order('monitoring_date', { ascending: false });

    if (error) throw error;

    return data ?? [];
}

async function loadInspectionCount(staffId) {
    const now = new Date();

    const start = new Date(
        now.getFullYear(),
        now.getMonth(),
        1
    );

    const nextMonth = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        1
    );

    const { count, error } = await supabase
        .from('agricultural_inspections')
        .select('inspection_id', {
            count: 'exact',
            head: true
        })
        .eq('technician_staff_id', staffId)
        .gte('inspection_date', localDateString(start))
        .lt('inspection_date', localDateString(nextMonth));

    if (error) throw error;

    return count ?? 0;
}

async function loadRecentInspections(staffId) {
    const { data, error } = await supabase
        .from('agricultural_inspections')
        .select(`
            inspection_id,
            farm_id,
            planting_id,
            inspection_date,
            inspection_type,
            overall_condition,
            findings,
            action_required,
            inspection_status
        `)
        .eq('technician_staff_id', staffId)
        .order('inspection_date', { ascending: false })
        .limit(5);

    if (error) throw error;

    return data ?? [];
}

/* ==========================================================
   DASHBOARD SECTIONS
   ========================================================== */

function buildMetrics({
    farms,
    plantings,
    monitoring,
    inspectionCount,
    today,
    harvestLimit
}) {
    const activePlantings = plantings.filter(isActivePlanting);

    const needsAttention = activePlantings.filter(planting => {
        const records = monitoring.filter(
            record => record.planting_id === planting.id
        );

        const latest = records[0];

        if (!latest) return false;

        return latest.action_required === true ||
            ATTENTION_HEALTH_STATUSES.includes(
                String(latest.crop_health_status || '').toLowerCase()
            );
    });

    const upcomingHarvests = activePlantings.filter(planting => {
        if (!planting.expected_harvest_date) return false;

        const date = String(planting.expected_harvest_date).slice(0, 10);

        return date >= today && date <= harvestLimit;
    });

    const healthyPlants = activePlantings.filter(planting => {
        const latest = monitoring.find(
            record => record.planting_id === planting.id
        );

        return ['healthy', 'good'].includes(
            String(latest?.crop_health_status || '').toLowerCase()
        );
    });

    return h(
        'section',
        { class: 'at-dashboard-metrics' },

        metricCard(
            'Assigned Farms',
            farms.length,
            'Currently assigned to you',
            '🏡',
            '#C65D3A'
        ),

        metricCard(
            'Active Plantings',
            activePlantings.length,
            'Crops in active production',
            '🌱',
            '#6F9B62'
        ),

        metricCard(
            'Healthy Plants',
            healthyPlants.length,
            'Latest healthy or good condition',
            '💚',
            '#4D9A75'
        ),

        metricCard(
            'Needs Attention',
            needsAttention.length,
            'Requires monitoring or follow-up',
            '⚠️',
            '#D98B38'
        ),

        metricCard(
            'Inspections This Month',
            inspectionCount,
            'Inspections recorded this month',
            '📋',
            '#6486B5'
        ),

        metricCard(
            'Upcoming Harvests',
            upcomingHarvests.length,
            `Expected within ${UPCOMING_HARVEST_DAYS} days`,
            '🧺',
            '#A47A48'
        )
    );
}

function buildAttentionSection(plantings, monitoring, farms) {
    const farmMap = new Map(
        farms.map(farm => [farm.id, farm])
    );

    const attentionRows = [];

    for (const planting of plantings.filter(isActivePlanting)) {
        const latest = monitoring.find(
            record => record.planting_id === planting.id
        );

        if (!latest) continue;

        const health = String(
            latest.crop_health_status || ''
        ).toLowerCase();

        if (
            latest.action_required !== true &&
            !ATTENTION_HEALTH_STATUSES.includes(health)
        ) {
            continue;
        }

        const farm = farmMap.get(planting.farm_id);

        attentionRows.push(
            tableRow([
                planting.crop_name || 'Unnamed crop',
                farm?.farm_name || 'Unknown farm',
                badge(
                    formatLabel(latest.crop_health_status || 'Not assessed'),
                    getHealthType(latest.crop_health_status)
                ),
                latest.action_required
                    ? badge('Action required', 'danger')
                    : badge('Monitoring', 'warning'),
                formatDate(latest.monitoring_date)
            ])
        );
    }

    return h(
        'section',
        { class: 'at-dashboard-section at-dashboard-panel' },
        sectionHeader(
            'Plants Needing Attention',
            'Crops that require follow-up based on their latest monitoring.',
            {
                href: '#crop-monitoring',
                label: 'Open Crop Monitoring →'
            }
        ),
        createTable(
            ['Crop', 'Farm', 'Health', 'Status', 'Last Monitored'],
            attentionRows,
            'No crops currently require immediate attention.'
        )
    );
}

function buildHarvestSection(plantings, farms, today, harvestLimit) {
    const farmMap = new Map(
        farms.map(farm => [farm.id, farm])
    );

    const upcoming = plantings
        .filter(planting => {
            if (!isActivePlanting(planting)) return false;
            if (!planting.expected_harvest_date) return false;

            const date = String(
                planting.expected_harvest_date
            ).slice(0, 10);

            return date >= today && date <= harvestLimit;
        })
        .sort((a, b) =>
            String(a.expected_harvest_date)
                .localeCompare(String(b.expected_harvest_date))
        );

    const rows = upcoming.map(planting => {
        const farm = farmMap.get(planting.farm_id);

        return tableRow([
            planting.crop_name || 'Unnamed crop',
            farm?.farm_name || 'Unknown farm',
            planting.field_name,
            formatDate(planting.expected_harvest_date),
            badge(
                formatLabel(planting.crop_status),
                'success'
            )
        ]);
    });

    return h(
        'section',
        { class: 'at-dashboard-section at-dashboard-panel' },
        sectionHeader(
            'Upcoming Harvests',
            `Expected harvest dates within the next ${UPCOMING_HARVEST_DAYS} days.`
        ),
        createTable(
            ['Crop', 'Farm', 'Field', 'Expected Harvest', 'Crop Status'],
            rows,
            'No upcoming harvests within the next 7 days.'
        )
    );
}

function buildMonitoringSection(monitoring, plantings, farms) {
    const plantingMap = new Map(
        plantings.map(planting => [planting.id, planting])
    );

    const farmMap = new Map(
        farms.map(farm => [farm.id, farm])
    );

    const rows = monitoring.slice(0, 5).map(record => {
        const planting = plantingMap.get(record.planting_id);
        const farm = planting
            ? farmMap.get(planting.farm_id)
            : null;

        return tableRow([
            planting?.crop_name || 'Unknown crop',
            farm?.farm_name || 'Unknown farm',
            formatLabel(record.growth_stage),
            badge(
                formatLabel(record.crop_health_status),
                getHealthType(record.crop_health_status)
            ),
            formatDate(record.monitoring_date)
        ]);
    });

    return h(
        'section',
        { class: 'at-dashboard-section at-dashboard-panel' },
        sectionHeader(
            'Recent Crop Monitoring',
            'Your five latest crop monitoring records.',
            {
                href: '#crop-monitoring',
                label: 'View Monitoring →'
            }
        ),
        createTable(
            ['Crop', 'Farm', 'Growth Stage', 'Health', 'Monitoring Date'],
            rows,
            'No crop monitoring records found.'
        )
    );
}

function buildInspectionSection(inspections, farms) {
    const farmMap = new Map(
        farms.map(farm => [farm.id, farm])
    );

    const rows = inspections.map(inspection => {
        const farm = farmMap.get(inspection.farm_id);

        return tableRow([
            farm?.farm_name || 'Unknown farm',
            formatLabel(inspection.inspection_type),
            formatDate(inspection.inspection_date),
            badge(
                formatLabel(inspection.overall_condition),
                getHealthType(inspection.overall_condition)
            ),
            badge(
                formatLabel(inspection.inspection_status),
                getInspectionType(inspection.inspection_status)
            )
        ]);
    });

    return h(
        'section',
        { class: 'at-dashboard-section at-dashboard-panel' },
        sectionHeader(
            'Recent Farm Inspections',
            'Your latest recorded farm inspection activities.',
            {
                href: '#field-inspections',
                label: 'View Inspections →'
            }
        ),
        createTable(
            ['Farm', 'Inspection Type', 'Date', 'Condition', 'Status'],
            rows,
            'No farm inspections recorded yet.'
        )
    );
}

function buildFarmOverview(farms, plantings) {
    const rows = farms.map(farm => {
        const farmPlantings = plantings.filter(
            planting => planting.farm_id === farm.id
        );

        const activeCount = farmPlantings.filter(
            isActivePlanting
        ).length;

        return tableRow([
            farm.farm_name || 'Unnamed farm',
            farm.farm_location || 'Location not set',
            String(farmPlantings.length),
            String(activeCount),
            badge('Assigned', 'success')
        ]);
    });

    return h(
        'section',
        { class: 'at-dashboard-section at-dashboard-panel' },
        sectionHeader(
            'Assigned Farms Overview',
            'Farms currently assigned to your Agricultural Technician account.',
            {
                href: '#assigned-farms',
                label: 'View Assigned Farms →'
            }
        ),
        createTable(
            ['Farm', 'Location', 'Total Plantings', 'Active Plantings', 'Assignment'],
            rows,
            'No assigned farms found.'
        )
    );
}

function buildQuickActions() {
    return h(
        'section',
        { class: 'at-dashboard-section at-dashboard-panel' },
        sectionHeader(
            'Quick Actions',
            'Quickly access your Agricultural Technician tools.'
        ),
        h(
            'div',
            { class: 'at-quick-actions' },

            quickAction(
                'Crop Monitoring',
                'Record crop growth and health conditions.',
                '🌱',
                '#crop-monitoring'
            ),

            quickAction(
                'Farm Inspection Map',
                'View assigned farms and record inspections.',
                '🗺️',
                '#field-inspections'
            ),

            quickAction(
                'Monitoring Reports',
                'Preview and download monitoring summaries.',
                '📊',
                '#monitoring-reports'
            ),

            quickAction(
                'Assigned Farms',
                'Review your assigned agricultural farms.',
                '🏡',
                '#assigned-farms'
            )
        )
    );
}

/* ==========================================================
   MAIN DASHBOARD
   ========================================================== */

async function loadDashboardData(ctx, root) {
    const staffId = ctx?.staff?.staff_id;

    if (!staffId) {
        root.replaceChildren(
            h(
                'div',
                { class: 'at-dashboard-panel' },
                h(
                    'p',
                    { class: 'msg error' },
                    'Agricultural Technician account information is unavailable. Please sign in again.'
                )
            )
        );
        return;
    }

    try {
        const farms = await loadAssignedFarms(staffId);

        if (!farms.length) {
            root.replaceChildren(
                buildQuickActions(),
                h(
                    'section',
                    { class: 'at-dashboard-panel' },
                    emptyState(
                        'You currently have no active farm assignments. Contact your Farm Manager for assistance.'
                    )
                )
            );
            return;
        }

        const farmIds = farms.map(farm => farm.id);

        const [
            plantings,
            monitoring,
            inspectionCount,
            inspections
        ] = await Promise.all([
            loadPlantings(farmIds),
            loadMonitoring(staffId),
            loadInspectionCount(staffId),
            loadRecentInspections(staffId)
        ]);

        const today = localDateString();

        const harvestLimitDate = new Date();
        harvestLimitDate.setDate(
            harvestLimitDate.getDate() + UPCOMING_HARVEST_DAYS
        );

        const harvestLimit = localDateString(harvestLimitDate);

        const metrics = buildMetrics({
            farms,
            plantings,
            monitoring,
            inspectionCount,
            today,
            harvestLimit
        });

        root.replaceChildren(
            metrics,
            buildQuickActions(),
            buildAttentionSection(plantings, monitoring, farms),
            buildHarvestSection(
                plantings,
                farms,
                today,
                harvestLimit
            ),
            buildMonitoringSection(
                monitoring,
                plantings,
                farms
            ),
            buildInspectionSection(
                inspections,
                farms
            ),
            buildFarmOverview(
                farms,
                plantings
            )
        );

    } catch (error) {
        console.error(
            'Failed to load Agricultural Technician dashboard:',
            error
        );

        root.replaceChildren(
            h(
                'div',
                { class: 'at-dashboard-panel' },
                h(
                    'p',
                    { class: 'msg error' },
                    error.message || 'Could not load dashboard information.'
                ),
                h(
                    'button',
                    {
                        type: 'button',
                        class: 'btn ghost',
                        onclick: () => loadDashboardData(ctx, root)
                    },
                    'Retry'
                )
            )
        );
    }
}

/* ==========================================================
   PAGE RENDER
   ========================================================== */

export async function render(root, ctx) {
    const content = h('div', {
        class: 'at-dashboard-content'
    });

    const heading = h(
        'section',
        { class: 'page-heading' },
        h('h1', {}, 'Dashboard'),
        h(
            'p',
            { class: 'muted' },
            `Welcome back, ${ctx.staff?.full_name || 'Agricultural Technician'}. Here's your farm monitoring overview.`
        )
    );

    root.replaceChildren(
        heading,
        content
    );

    content.replaceChildren(
        h(
            'div',
            {
                class: 'at-dashboard-loading',
                'aria-live': 'polite'
            },
            'Loading your dashboard...'
        )
    );

    await loadDashboardData(ctx, content);
}
