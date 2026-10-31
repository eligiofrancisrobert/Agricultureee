import { supabase } from '../connection.js';
import { h, pageHead, donut } from '../admin/ui.js';
import { loadFarms } from './farms.js';

const COLORS = [
    'var(--primary-color)',
    'var(--secondary)',
    'var(--warning)',
    'var(--success)',
    'var(--error)',
    'var(--secondary-text)'
];

// Max rows shown in each dashboard list card.
const CARD_LIMIT = 5;

// Crop statuses that no longer count as an upcoming harvest.
// Adjust these codes to match your crop_statuses table.
const TERMINAL_CROP_STATUSES = ['harvested', 'failed', 'cancelled'];

/* ---------- Icons (same 24x24, 1.8 stroke style as the sidebar) ---------- */
const SVG_NS = 'http://www.w3.org/2000/svg';

const ICON = {
    chevron: ['m9 6 6 6-6 6'],
    pin: ['M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z', 'M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z'],
    calendar: ['M7 3v4M17 3v4M4 9h16', 'M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z'],
    users: [
        'M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2',
        'M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
        'M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75'
    ],
    sprout: ['M12 21v-8', 'M12 13C7 13 4 10 4 5c5 0 8 3 8 8Z', 'M12 16c0-4 3-7 8-7 0 5-3 8-8 8'],
    barn: ['M4 21V10l8-6 8 6v11', 'M9 21v-7h6v7', 'M9 14l6 7M15 14l-6 7', 'M2 21h20'],
    basket: [
        'M7 10V8a5 5 0 0 1 10 0v2',
        'M3 10h18l-1.5 9a2 2 0 0 1-2 1.7h-11a2 2 0 0 1-2-1.7L3 10Z',
        'M9 14v3',
        'M15 14v3'
    ],
    bars: ['M5 21V11', 'M12 21V4', 'M19 21v-7'],
    sliders: [
        'M4 7h9M17 7h3M4 17h3M11 17h9',
        'M15 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
        'M9 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z'
    ],
    pie: ['M12 3v9h9', 'M20.5 15A9 9 0 1 1 9 3.5'],
    map: ['M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z', 'M9 4v14', 'M15 6v14'],
    bolt: ['M13 2 4 14h7l-1 8 9-12h-7l1-8Z'],
    clipboard: [
        'M9 4h6v3H9z',
        'M7 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-1',
        'M9 13l2 2 4-4'
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

/* ---------- Data loaders ---------- */
async function loadAssignedMunicipality() {
    const {
        data: { user },
        error: authError
    } = await supabase.auth.getUser();

    if (authError) throw authError;
    if (!user) throw new Error('No authenticated user found.');

    const { data: staff, error: staffError } = await supabase
        .from('staff_accounts')
        .select('staff_id')
        .eq('user_id', user.id)
        .maybeSingle();

    if (staffError) throw staffError;
    if (!staff) throw new Error('Farm Manager staff record not found.');

    const { data, error } = await supabase
        .from('farm_manager_details')
        .select('assigned_farm_location')
        .eq('staff_id', staff.staff_id)
        .maybeSingle();

    if (error) throw error;

    return data?.assigned_farm_location?.trim() || null;
}

// Every farmer returned by the manager's farmer-list RPC
// (owners/operators, tenants/lessees and farm workers),
// de-duplicated by email, falling back to the name.
async function loadFarmers() {
    const { data, error } = await supabase.rpc(
        'manager_list_residential_farmers'
    );

    if (error) throw error;

    const unique = new Map();

    for (const farmer of data ?? []) {
        const email = farmer.email?.trim().toLowerCase();
        const name = farmer.full_name?.trim();
        const key = email || name?.toLowerCase();

        if (key && !unique.has(key)) {
            unique.set(key, {
                name: name || 'Unnamed farmer',
                email: farmer.email?.trim() || ''
            });
        }
    }

    return [...unique.values()];
}

// code -> label, from the same reference tables Plant Management uses.
async function loadStatusLabels(table) {
    const { data, error } = await supabase
        .from(table)
        .select('code, label, display_order')
        .eq('is_active', true)
        .order('display_order', { ascending: true });

    if (error) throw error;

    return new Map((data ?? []).map((status) => [status.code, status.label]));
}

// Fallback only when a code has no matching reference record.
const fallbackLabel = (code) =>
    String(code)
        .replace(/[_-]+/g, ' ')
        .trim()
        .replace(/\b\w/g, (character) => character.toUpperCase());

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

    return (data ?? []).map((planting) => ({
        ...planting,
        farm_id: planting.farm_fields.farm_id
    }));
}

// Crop status breakdown for the donut chart.
function tallyStatuses(plantings, cropLabels) {
    const counts = new Map();

    for (const planting of plantings) {
        const code = planting.crop_status?.trim().toLowerCase() || 'unknown';

        counts.set(code, (counts.get(code) ?? 0) + 1);
    }

    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([code, value], index) => ({
            name: cropLabels.get(code) || fallbackLabel(code),
            value,
            color: COLORS[index % COLORS.length]
        }));
}

// farm_id -> unique crop status labels
function plantingsByFarm(plantings, cropLabels) {
    const map = new Map();

    for (const planting of plantings) {
        const code = planting.crop_status?.trim().toLowerCase() || 'unknown';
        const label = cropLabels.get(code) || fallbackLabel(code);

        if (!map.has(planting.farm_id)) {
            map.set(planting.farm_id, new Set());
        }

        map.get(planting.farm_id).add(label);
    }

    return new Map(
        [...map].map(([farmId, labels]) => [farmId, [...labels]])
    );
}

/* ---------- Helpers ---------- */
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

const initials = (name) =>
    (name || '?')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0].toUpperCase())
        .join('');

function greeting() {
    const hour = new Date().getHours();

    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
}

// Number of farms growing each crop (top 5 + "Other crops").
function tally(crops) {
    const byName = new Map();

    for (const crop of crops) {
        const key = crop.crop_name?.trim();

        if (!key) continue;

        if (!byName.has(key)) byName.set(key, new Set());

        byName.get(key).add(crop.farm_id);
    }

    const sorted = [...byName]
        .map(([name, farms]) => ({ name, value: farms.size }))
        .sort((a, b) => b.value - a.value);

    const top = sorted.slice(0, 5);
    const rest = sorted.slice(5).reduce((total, crop) => total + crop.value, 0);

    if (rest) top.push({ name: 'Other crops', value: rest });

    return top.map((crop, index) => ({
        ...crop,
        color: COLORS[index % COLORS.length]
    }));
}

// farm_id -> sorted list of unique crop names
function cropsByFarm(crops) {
    const map = new Map();

    for (const crop of crops) {
        const name = crop.crop_name?.trim();

        if (!name) continue;

        if (!map.has(crop.farm_id)) map.set(crop.farm_id, new Set());

        map.get(crop.farm_id).add(name);
    }

    return new Map([...map].map(([id, names]) => [id, [...names].sort()]));
}

function fillSidebarUser(ctx) {
    const fullName = ctx?.staff?.full_name?.trim();

    if (!fullName) return;

    const nameEl = document.getElementById('fmUserName');
    const avatarEl = document.getElementById('fmUserAvatar');

    if (nameEl) nameEl.textContent = fullName;
    if (avatarEl) avatarEl.textContent = initials(fullName);
}

const formatDate = (value) =>
    value
        ? new Date(`${value}T00:00:00`).toLocaleDateString('en-PH', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        })
        : 'Not set';

/* ---------- Building blocks ---------- */
const emptyNote = (text) => h('p', { class: 'fm-empty' }, text);

function panelHead(title, iconPaths, href) {
    return h(
        'div',
        { class: 'fm-panel-head' },
        h('h2', {}, icon(iconPaths, 20), title),
        href ? h('a', { class: 'fm-viewall', href }, 'View all') : ''
    );
}

function statCard({ label, value, sub, href, color, iconPaths }) {
    return h(
        'a',
        { class: 'fm-stat-card', href, style: `--c:${color}` },
        h('span', { class: 'fm-stat-icon' }, icon(iconPaths, 26)),
        h(
            'div',
            { class: 'fm-stat-body' },
            h('span', { class: 'fm-stat-label' }, label),
            h('b', { class: 'fm-stat-value' }, String(value)),
            h('small', {}, sub)
        ),
        h('span', { class: 'fm-stat-chev' }, icon(ICON.chevron, 16))
    );
}

/* ---------- Cards ---------- */
function statsRow({ farms, farmers, plantings, areas }) {
    return h(
        'div',
        { class: 'fm-dash-stats' },
        statCard({
            label: 'Assigned Farms',
            value: farms.length,
            sub: `Across ${plural(areas, 'area')}`,
            href: '#farms',
            color: 'var(--primary-color)',
            iconPaths: ICON.sprout
        }),
        statCard({
            label: 'Farmers Under You',
            value: farmers.length,
            sub: 'Registered farmers',
            href: '#farmers',
            color: 'var(--secondary)',
            iconPaths: ICON.users
        }),
        statCard({
            label: 'Planting Records',
            value: plantings.length,
            sub: 'Across all assigned farms',
            href: '#plant-now',
            color: 'var(--success)',
            iconPaths: ICON.sprout
        }),
        statCard({
            label: 'Upcoming Harvests',
            value: plantings.filter((planting) => {
                if (!planting.expected_harvest_date) return false;

                const today = new Date();
                today.setHours(0, 0, 0, 0);

                const harvestDate = new Date(
                    `${planting.expected_harvest_date}T00:00:00`
                );

                return (
                    harvestDate >= today &&
                    !TERMINAL_CROP_STATUSES.includes(
                        planting.crop_status?.trim().toLowerCase()
                    )
                );
            }).length,
            sub: 'Expected harvest dates',
            href: '#harvest',
            color: 'var(--warning)',
            iconPaths: ICON.basket
        })
    );
}

function assignedFarmsCard(farms, statusMap) {
    const rows = farms.slice(0, CARD_LIMIT).map((farm) => {
        const statuses = statusMap.get(farm.id) ?? [];

        const place = [
            farm.farm_location || 'Location not set',
            farm.farmerName
        ].filter(Boolean).join(' · ');

        return h(
            'a',
            { class: 'fm-row', href: '#farms' },
            h('span', { class: 'fm-thumb' }, icon(ICON.barn, 24)),
            h(
                'div',
                { class: 'fm-row-main' },
                h('b', {}, farm.farm_name || 'Unnamed farm'),
                h('small', { class: 'fm-meta' }, icon(ICON.pin, 13), place),
                h(
                    'small',
                    { class: 'fm-meta' },
                    icon(ICON.sprout, 13),
                    statuses.length
                        ? statuses.join(', ')
                        : 'No planting records'
                )
            ),
            h(
                'span',
                { class: statuses.length ? 'fm-pill' : 'fm-pill off' },
                statuses.length
                    ? plural(statuses.length, 'status')
                    : 'No plantings'
            ),
            icon(ICON.chevron, 16)
        );
    });

    return h(
        'section',
        { class: 'fm-panel' },
        panelHead('Assigned Farms', ICON.clipboard, '#farms'),
        rows.length
            ? h('div', {}, rows)
            : emptyNote('No farms are available for your assigned area yet.')
    );
}

function plantingScheduleCard(plantings) {
    const rows = plantings.slice(0, CARD_LIMIT);

    const content = rows.length
        ? h('div', {},
            h('div', { class: 'fm-list' },
                rows.map((planting) =>
                    h('a', { class: 'fm-row', href: '#harvest' },
                        h('span', { class: 'fm-thumb' }, icon(ICON.sprout, 24)),
                        h('div', { class: 'fm-row-main' },
                            h('b', {}, planting.crop_name || 'Unnamed crop'),
                            h('small', { class: 'fm-meta' },
                                icon(ICON.calendar, 13),
                                `Sowing: ${formatDate(planting.sowing_date)}`
                            ),
                            h('small', { class: 'fm-meta' },
                                icon(ICON.basket, 13),
                                `Harvest: ${formatDate(planting.expected_harvest_date)}`
                            )
                        ),
                        icon(ICON.chevron, 16)
                    )
                )
            ),
            plantings.length > CARD_LIMIT
                ? h('a', { class: 'fm-more', href: '#harvest' }, 'View all')
                : ''
        )
        : emptyNote('No planting schedules found for your assigned farms.');

    return h('section', { class: 'fm-panel' },
        h('div', { class: 'fm-panel-header' },
            h('div', {},
                h('h3', {}, 'Planting Schedule'),
                h('p', {}, 'Upcoming and recorded plantings')
            ),
            h('span', { class: 'fm-pill' }, `${plantings.length} records`)
        ),
        content
    );
}

function farmersCard(farmers) {
    const rows = farmers.slice(0, CARD_LIMIT).map((farmer) =>
        h(
            'a',
            { class: 'fm-row', href: '#farmers' },
            h(
                'div',
                { class: 'person' },
                h('span', { class: 'avatar' }, initials(farmer.name)),
                h(
                    'div',
                    { class: 'fm-row-main' },
                    h('b', {}, farmer.name),
                    h('small', {}, farmer.email || 'No email on file')
                )
            ),
            icon(ICON.chevron, 16)
        )
    );

    return h(
        'section',
        { class: 'fm-panel' },
        panelHead('My Farmers', ICON.users, '#farmers'),
        rows.length
            ? h('div', {}, rows)
            : emptyNote('No farmers found for your area yet.')
    );
}

function plantingStatusCard(plantings, cropLabels) {
    const items = tallyStatuses(plantings, cropLabels);
    const total = plantings.length;

    let body;

    if (!items.length) {
        body = emptyNote(
            'No planting records are available for your assigned farms yet.'
        );
    } else {
        const chart = donut(items);
        const unit = [...chart.querySelectorAll('text')].pop();

        if (unit) unit.textContent = 'plantings';

        body = h(
            'div',
            { class: 'donut-row' },
            chart,
            h(
                'ul',
                { class: 'legend' },
                items.map((item) =>
                    h(
                        'li',
                        {},
                        h('i', { style: `background:${item.color}` }),
                        h(
                            'div',
                            {},
                            h('b', {}, item.name),
                            h(
                                'small',
                                {},
                                `${plural(item.value, 'planting')} · ${Math.round((item.value / total) * 100)
                                }%`
                            )
                        )
                    )
                )
            )
        );
    }

    return h(
        'section',
        { class: 'fm-panel' },
        panelHead('Planting Status Overview', ICON.pie, '#plant-now'),
        body
    );
}

function quickActionsCard() {
    const actions = [
        ['Add Planting', '#plant-now', ICON.sprout, 'var(--success)'],
        ['Manage Farmers', '#farmers', ICON.users, 'var(--warning)'],
        ['View Reports', '#reports', ICON.bars, 'var(--primary-color)'],
        ['Farm Actions', '#farm-actions', ICON.sliders, 'var(--secondary-text)']
    ];

    return h(
        'section',
        { class: 'fm-panel' },
        panelHead('Quick Actions', ICON.bolt),
        h(
            'div',
            { class: 'fm-quick' },
            actions.map(([label, href, paths, color]) =>
                h('a', { href, style: `--c:${color}` }, icon(paths, 24), label)
            )
        )
    );
}

function dashboard({ farms, farmers, plantings, cropLabels }) {
    const statusMap = plantingsByFarm(plantings, cropLabels);

    const areas = new Set(
        farms.map((farm) => farm.farm_location?.trim()).filter(Boolean)
    ).size;

    return h(
        'div',
        { class: 'fm-dash' },
        statsRow({ farms, farmers, plantings, areas }),
        h(
            'div',
            { class: 'fm-grid-main' },
            assignedFarmsCard(farms, statusMap),
            plantingScheduleCard(plantings)
        ),
        h(
            'div',
            { class: 'fm-grid-bottom' },
            farmersCard(farmers),
            plantingStatusCard(plantings, cropLabels),
            quickActionsCard()
        )
    );
}

/* ---------- Page ---------- */
export async function render(root, ctx) {
    const holder = h('div');

    const name = ctx?.staff?.full_name?.split(' ')[0] ?? '';

    const today = new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });

    fillSidebarUser(ctx);

    root.append(
        pageHead(
            name ? `${greeting()}, ${name}!` : `${greeting()}!`,
            "Here's what's happening with your assigned farms today.",
            h('div', { class: 'fm-date' }, icon(ICON.calendar, 18), today)
        ),
        holder
    );

    const load = async () => {
        holder.replaceChildren(
            h('p', { class: 'muted' }, 'Loading dashboard...')
        );

        try {
            const [municipality, farms, farmers] = await Promise.all([
                loadAssignedMunicipality(),
                loadFarms(),
                loadFarmers()
            ]);

            const [plantings, cropLabels] = await Promise.all([
                loadPlantings(farms.map((farm) => farm.id)),
                // Labels are non-critical: fall back to readable codes.
                loadStatusLabels('crop_statuses').catch((err) => {
                    console.error('Could not load crop status labels:', err);
                    return new Map();
                })
            ]);

            const note = municipality
                ? ''
                : h(
                    'p',
                    { class: 'msg error' },
                    'No municipality is assigned to you yet. Please contact the administrator.'
                );

            holder.replaceChildren(
                note,
                dashboard({ farms, farmers, plantings, cropLabels })
            );
        } catch (err) {
            console.error('Failed to load dashboard:', err);

            holder.replaceChildren(
                h('p', { class: 'msg error' }, 'Could not load the dashboard.'),
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