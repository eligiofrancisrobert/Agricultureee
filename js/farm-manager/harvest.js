import { supabase } from '../connection.js';
import { h, pageHead } from '../admin/ui.js';

const PAGE_SIZE = 5;
let harvestChannel = null;
let harvestReloadTimer = null;

const STATUSES = {
    planned: 'Planned',
    planted: 'Planted',
    growing: 'Growing',
    ready: 'Ready for Harvest',
    harvested: 'Harvested',
    on_hold: 'On Hold',
    failed: 'Failed',
    cancelled: 'Cancelled'
};

function normalize(value) {
    return String(value ?? '').trim().toLowerCase();
}

function dateLabel(value) {
    if (!value) return '—';

    const date = new Date(`${value}T00:00:00`);

    return Number.isNaN(date.getTime())
        ? value
        : date.toLocaleDateString('en-PH', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
}

function statusLabel(value) {
    return normalize(value)
        .split(/[_\s-]+/)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ') || 'Unknown';
}

function badge(value, type = 'planting') {
    const status = normalize(value) || 'unknown';
    const safeStatus = status.replace(/[^a-z0-9_-]/g, '');

    return h(
        'span',
        {
            class: `harvest-badge harvest-badge--${type} harvest-badge--${safeStatus}`
        },
        type === 'planting'
            ? (STATUSES[status] ?? statusLabel(status))
            : statusLabel(status)
    );
}

function statCard(label, value, description) {
    return h(
        'article',
        { class: 'harvest-stat' },
        h('span', { class: 'harvest-stat__label' }, label),
        h('strong', { class: 'harvest-stat__value' }, String(value)),
        h('span', { class: 'harvest-stat__description' }, description)
    );
}

/*
 * Farms are scoped by the current Farm Manager's staff ID.
 * farm_manager_assignments.manager_id references farm_manager_details.staff_id.
 */

function normalizeLocation(value) {
    return String(value ?? '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

function getLocationParts(value) {
    return normalizeLocation(value)
        .split(',')
        .map(part => part.trim())
        .filter(Boolean);
}

function isInAssignedMunicipality(location, assignedLocation) {
    const assignedParts = getLocationParts(assignedLocation);
    const locationParts = getLocationParts(location);

    if (!assignedParts.length || !locationParts.length) {
        return false;
    }

    const municipality = assignedParts[0];
    const province = assignedParts[1] ?? '';

    const municipalityMatches =
        locationParts[0] === municipality ||
        locationParts.some(part => part === municipality);

    const provinceMatches =
        !province ||
        locationParts.some(part => part === province);

    return municipalityMatches && provinceMatches;
}

async function loadAssignedFarms(staffId) {
    if (!staffId) {
        throw new Error(
            'Farm Manager staff ID is missing. Please log in again.'
        );
    }

    // Get the manager's assigned location.
    const { data: manager, error: managerError } = await supabase
        .from('farm_manager_details')
        .select('assigned_farm_location')
        .eq('staff_id', staffId)
        .maybeSingle();

    if (managerError) throw managerError;

    const assignedLocation =
        manager?.assigned_farm_location?.trim();

    if (!assignedLocation) {
        throw new Error(
            'No assigned farm location was found for your account.'
        );
    }

    // Fetch farms and match their locations.
    const { data: farms, error: farmError } = await supabase
        .from('farmer_farms')
        .select('id, farm_name, farm_location')
        .order('farm_name', { ascending: true });

    if (farmError) throw farmError;

    const matchedFarms = (farms ?? []).filter(farm =>
        isInAssignedMunicipality(
            farm.farm_location,
            assignedLocation
        )
    );

    console.log('[Harvest] Assigned location:', assignedLocation);
    console.log('[Harvest] Matching farms:', matchedFarms);

    return matchedFarms;
}

async function loadDashboardData(staff) {
    const farms = await loadAssignedFarms(staff?.staff_id);

    console.log('[Harvest] Farms loaded:', farms);

    if (!farms.length) {
        return { farms: [], rows: [] };
    }

    const farmMap = new Map(
        farms.map(farm => [farm.id, farm])
    );

    // 1. Load fields belonging to the matching farms.
    const { data: fields, error: fieldsError } = await supabase
        .from('farm_fields')
        .select('id, farm_id, field_name')
        .in('farm_id', farms.map(farm => farm.id));

    if (fieldsError) throw fieldsError;

    console.log('[Harvest] Fields:', fields);

    if (!fields?.length) {
        return { farms, rows: [] };
    }

    const fieldMap = new Map(
        fields.map(field => [field.id, field])
    );

    // 2. Load planting records belonging to those fields.
    const { data: plantings, error: plantingError } = await supabase
        .from('farm_plantings')
        .select(
            'id, field_id, product_id, crop_name, sowing_date, expected_harvest_date, status, activity_status, crop_status'
        )
        .in('field_id', fields.map(field => field.id))
        .order('expected_harvest_date', { ascending: true });

    if (plantingError) throw plantingError;

    console.log('[Harvest] Plantings:', plantings);

    const plantingRows = plantings ?? [];
    const plantingIds = plantingRows.map(planting => planting.id);

    if (!plantingIds.length) {
        return { farms, rows: [] };
    }

    // 3. Load harvest records linked to those planting IDs.
    const { data: harvests, error: harvestError } = await supabase
        .from('harvested_crops')
        .select(
            'harvest_id, planting_id, farmer_id, harvested_date, harvest_quantity, harvest_unit, confirmation_status, confirmed_at, notes, created_at'
        )
        .in('planting_id', plantingIds)
        .order('created_at', { ascending: false });

    if (harvestError) throw harvestError;

    console.log('[Harvest] Harvest records:', harvests);

    // 4. Group harvest records by planting ID.
    const harvestMap = new Map();

    for (const harvest of harvests ?? []) {
        const existing = harvestMap.get(harvest.planting_id) ?? [];
        existing.push(harvest);
        harvestMap.set(harvest.planting_id, existing);
    }

    // 5. Combine farm, field, planting, and harvest data.
    const rows = plantingRows.map(planting => {
        const field = fieldMap.get(planting.field_id);
        const farm = field
            ? farmMap.get(field.farm_id)
            : null;

        return {
            ...planting,
            farmName: farm?.farm_name ?? '—',
            fieldName: field?.field_name ?? '—',
            harvests: harvestMap.get(planting.id) ?? []
        };
    });

    return { farms, rows };
}

function renderTable(rows, searchTerm, statusFilter, page, onPageChange) {
    const filtered = rows.filter(row => {
        const searchable = normalize([
            row.crop_name,
            row.farmName,
            row.fieldName,
            row.activity_status,
            row.crop_status,
            ...row.harvests.map(item => item.confirmation_status)
        ].join(' '));

        const matchesSearch =
            !searchTerm || searchable.includes(searchTerm);

        const statuses = [
            normalize(row.activity_status),
            normalize(row.crop_status),
            normalize(row.status),
            ...row.harvests.map(item =>
                normalize(item.confirmation_status)
            )
        ];

        const matchesStatus =
            statusFilter === 'all' || statuses.includes(statusFilter);

        return matchesSearch && matchesStatus;
    });

    if (!filtered.length) {
        return {
            page: 1,
            element: h(
                'div',
                { class: 'harvest-empty' },
                'No harvest records match your search or filter.'
            )
        };
    }

    const tableRows = [];

    for (const row of filtered) {
        const harvestRecords = row.harvests.length
            ? row.harvests
            : [null];

        for (const harvest of harvestRecords) {
            tableRows.push(
                h(
                    'tr',
                    {},
                    h('td', {}, row.crop_name?.trim() || '—'),
                    h('td', {}, row.farmName),
                    h('td', {}, row.fieldName),
                    h('td', {}, dateLabel(row.expected_harvest_date)),
                    h(
                        'td',
                        {},
                        harvest
                            ? dateLabel(harvest.harvested_date)
                            : 'Not recorded'
                    ),
                    h(
                        'td',
                        {},
                        harvest && harvest.harvest_quantity != null
                            ? `${harvest.harvest_quantity} ${harvest.harvest_unit ?? ''}`.trim()
                            : '—'
                    ),
                    h(
                        'td',
                        {},
                        harvest
                            ? badge(harvest.confirmation_status, 'confirmation')
                            : badge(row.crop_status || row.status)
                    )
                )
            );
        }
    }

    // ---- Pagination ----
    const totalRecords = tableRows.length;
    const totalPages = Math.max(1, Math.ceil(totalRecords / PAGE_SIZE));
    const currentPage = Math.min(Math.max(page, 1), totalPages);
    const startIndex = (currentPage - 1) * PAGE_SIZE;
    const endIndex = Math.min(startIndex + PAGE_SIZE, totalRecords);
    const visibleRows = tableRows.slice(startIndex, endIndex);

    const prevButton = h(
        'button',
        { type: 'button', class: 'btn ghost harvest-page-btn' },
        'Previous'
    );
    const nextButton = h(
        'button',
        { type: 'button', class: 'btn ghost harvest-page-btn' },
        'Next'
    );

    prevButton.disabled = currentPage <= 1;
    nextButton.disabled = currentPage >= totalPages;

    prevButton.addEventListener('click', () => onPageChange(currentPage - 1));
    nextButton.addEventListener('click', () => onPageChange(currentPage + 1));

    const pager = h(
        'div',
        { class: 'harvest-pagination' },
        h(
            'span',
            { class: 'muted harvest-pagination__info' }
        ),
        h(
            'div',
            { class: 'harvest-pagination__controls' },
            prevButton,
            h(
                'span',
                { class: 'harvest-pagination__page' }
            ),
            nextButton
        )
    );

    const element = h(
        'div',
        {},
        h(
            'div',
            { class: 'harvest-table-wrap' },
            h(
                'table',
                { class: 'harvest-table' },
                h(
                    'thead',
                    {},
                    h(
                        'tr',
                        {},
                        h('th', {}, 'Crop'),
                        h('th', {}, 'Farm'),
                        h('th', {}, 'Field'),
                        h('th', {}, 'Expected Harvest'),
                        h('th', {}, 'Actual Harvest'),
                        h('th', {}, 'Quantity'),
                        h('th', {}, 'Status')
                    )
                ),
                h('tbody', {}, visibleRows)
            )
        ),
        pager
    );

    return { page: currentPage, element };
}

function cleanupHarvestRealtime() {
    clearTimeout(harvestReloadTimer);
    harvestReloadTimer = null;

    if (harvestChannel) {
        supabase.removeChannel(harvestChannel);
        harvestChannel = null;
    }
}

function subscribeToHarvestUpdates(onUpdate) {
    cleanupHarvestRealtime();

    harvestChannel = supabase
        .channel('farm-manager-harvest-dashboard')
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'farm_plantings'
            },
            payload => {
                console.log('[Harvest Realtime] Planting change:', payload);
                scheduleHarvestRefresh(onUpdate);
            }
        )
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'harvested_crops'
            },
            payload => {
                console.log('[Harvest Realtime] Harvest change:', payload);
                scheduleHarvestRefresh(onUpdate);
            }
        )
        .subscribe(status => {
            console.log('[Harvest Realtime] Status:', status);

            if (status === 'SUBSCRIBED') {
                console.log('Farm Manager Harvest Realtime connected.');
            }
        });
}

function scheduleHarvestRefresh(onUpdate) {
    clearTimeout(harvestReloadTimer);

    harvestReloadTimer = setTimeout(() => {
        onUpdate();
    }, 400);
}

export function cleanup() {
    cleanupHarvestRealtime();
}

export async function render(container, ctx) {
    cleanupHarvestRealtime();
    const page = h('div', { class: 'harvest-page' });
    const summary = h('div', { class: 'harvest-stats' });
    const scopeLabel = h('p', { class: 'harvest-location' });

    const search = h('input', {
        class: 'harvest-search',
        type: 'search',
        placeholder: 'Search crop, farm, field, or status...',
        'aria-label': 'Search harvest records'
    });

    const filter = h(
        'select',
        {
            class: 'harvest-filter',
            'aria-label': 'Filter harvest status'
        },
        h('option', { value: 'all' }, 'All statuses'),
        h('option', { value: 'planned' }, 'Planned'),
        h('option', { value: 'planted' }, 'Planted'),
        h('option', { value: 'growing' }, 'Growing'),
        h('option', { value: 'ready' }, 'Ready for Harvest'),
        h('option', { value: 'pending' }, 'Pending Confirmation'),
        h('option', { value: 'confirmed' }, 'Confirmed'),
        h('option', { value: 'rejected' }, 'Rejected')
    );

    const tableHolder = h('div', { class: 'harvest-table-holder' });

    const refreshButton = h(
        'button',
        { type: 'button', class: 'btn ghost harvest-refresh' },
        'Refresh'
    );

    page.append(
        pageHead('Harvest Dashboard'),
        scopeLabel,
        summary,
        h(
            'section',
            { class: 'card harvest-records-card' },
            h(
                'div',
                { class: 'harvest-toolbar' },
                h(
                    'div',
                    {},
                    h('h2', {}, 'Harvest Schedule & Records'),
                    h(
                        'p',
                        { class: 'muted' },
                        'Review expected harvest dates and submitted harvest records.'
                    )
                ),
                h(
                    'div',
                    { class: 'harvest-controls' },
                    search,
                    filter,
                    refreshButton
                )
            ),
            tableHolder
        )
    );

    container.append(page);

    let rows = [];
    let currentPage = 1;

    function updateTable() {
        const result = renderTable(
            rows,
            normalize(search.value),
            filter.value,
            currentPage,
            newPage => {
                currentPage = newPage;
                updateTable();
            }
        );

        currentPage = result.page; // keeps the page valid if results shrink
        tableHolder.replaceChildren(result.element);
    }

    async function load() {
        tableHolder.replaceChildren(
            h('p', { class: 'muted' }, 'Loading harvest records...')
        );
        refreshButton.disabled = true;

        try {
            const { farms, rows: loadedRows } =
                await loadDashboardData(ctx.staff);

            rows = loadedRows;

            scopeLabel.textContent =
                `Assigned farms: ${farms.length}`;

            const allHarvests = rows.flatMap(row => row.harvests);

            const pending = allHarvests.filter(
                item => normalize(item.confirmation_status) === 'pending'
            ).length;

            const confirmed = allHarvests.filter(
                item => normalize(item.confirmation_status) === 'confirmed'
            ).length;

            const quantity = allHarvests.reduce(
                (sum, item) => sum + Number(item.harvest_quantity || 0),
                0
            );

            const expected = rows.filter(row =>
                row.expected_harvest_date &&
                !['harvested', 'failed', 'cancelled'].includes(
                    normalize(row.crop_status)
                )
            ).length;

            summary.replaceChildren(
                statCard(
                    'Expected Harvests',
                    expected,
                    'Planting schedules'
                ),
                statCard(
                    'Pending Confirmation',
                    pending,
                    'Awaiting review'
                ),
                statCard(
                    'Confirmed Harvests',
                    confirmed,
                    'Confirmed records'
                ),
                statCard(
                    'Recorded Quantity',
                    quantity.toLocaleString('en-PH'),
                    'Sum of submitted quantities'
                )
            );

            if (!farms.length) {
                tableHolder.replaceChildren(
                    h(
                        'div',
                        { class: 'harvest-empty' },
                        'No farms are currently assigned to your account.'
                    )
                );
                return;
            }

            updateTable();
        } catch (error) {
            console.error(
                'Failed to load harvest dashboard:',
                error
            );

            tableHolder.replaceChildren(
                h(
                    'p',
                    { class: 'msg error' },
                    error.message || 'Could not load harvest records.'
                )
            );

            summary.replaceChildren();
            scopeLabel.textContent = '';
        } finally {
            refreshButton.disabled = false;
        }
    }

    search.addEventListener('input', () => {
        currentPage = 1;
        updateTable();
    });

    filter.addEventListener('change', () => {
        currentPage = 1;
        updateTable();
    });

    refreshButton.addEventListener('click', load);

    await load();

    subscribeToHarvestUpdates(load);
}