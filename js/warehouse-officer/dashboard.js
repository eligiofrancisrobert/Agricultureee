
import { supabase } from '../connection.js';

const MODULES = [
    {
        title: 'Harvest Records',
        description: 'Review and verify farmers’ harvest submissions.',
        icon: '📋',
        route: 'harvest-records'
    },
    {
        title: 'Fertilizer Inventory',
        description: 'Monitor fertilizer stocks and availability.',
        icon: '🌱',
        route: 'fertilizer-inventory'
    },
    {
        title: 'Pesticide Inventory',
        description: 'Monitor pesticide stocks and availability.',
        icon: '🧪',
        route: 'pesticide-inventory'
    },
    {
        title: 'Equipment',
        description: 'Monitor available agricultural equipment.',
        icon: '🚜',
        route: 'equipment'
    },
    {
        title: 'Harvest Inventory',
        description: 'View verified harvest records.',
        icon: '🌾',
        route: 'harvest-inventory'
    }
];

/** Create a DOM node and optionally set its class and text content. */
function element(tag, className, text) {
    const el = document.createElement(tag);

    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;

    return el;
}

/** Count harvest records, optionally limited to a confirmation status. */
async function getCount(status) {
    let query = supabase
        .from('harvested_crops')
        .select('harvest_id', { count: 'exact', head: true });

    if (status) {
        query = query.eq('confirmation_status', status);
    }

    const { count, error } = await query;

    if (error) {
        console.error(`Failed to load ${status || 'harvest'} count:`, error);
        return null;
    }

    return count ?? 0;
}

function createStat(label, value, description) {
    const card = element('article', 'wo-stat-card');

    card.append(
        element('span', 'wo-stat-label', label),
        element('strong', 'wo-stat-value', value === null ? '—' : value),
        element('small', 'wo-stat-description', description)
    );

    return card;
}

// Assigned Farm Card
/** Build the assigned-farm summary or its no-assignment message. */
function createAssignedFarmCard(farm) {
    const card = element('article', 'wo-assigned-farm-card');

    const header = element('div', 'wo-assigned-farm-header');

    header.append(
        element('span', 'wo-assigned-farm-icon', '🌾'),
        element('div', 'wo-assigned-farm-heading')
    );

    const heading = header.querySelector('.wo-assigned-farm-heading');

    heading.append(
        element('h2', '', 'My Assigned Farm'),
        element('span', 'wo-assigned-farm-status',
            farm ? 'Assigned' : 'Not Assigned')
    );

    card.append(header);

    if (!farm) {
        card.classList.add('wo-no-assigned-farm');

        card.append(
            element(
                'p',
                'wo-assigned-farm-empty',
                'You currently have no assigned farm. Please contact your administrator.'
            )
        );

        return card;
    }

    const details = element('div', 'wo-assigned-farm-details');

    const nameGroup = element('div', 'wo-farm-detail');
    nameGroup.append(
        element('span', 'wo-farm-detail-label', 'Farm Name'),
        element('strong', 'wo-farm-detail-value', farm.farm_name || 'Not available')
    );

    const locationGroup = element('div', 'wo-farm-detail');
    locationGroup.append(
        element('span', 'wo-farm-detail-label', 'Farm Location'),
        element('strong', 'wo-farm-detail-value', farm.farm_location || 'Not available')
    );

    details.append(nameGroup, locationGroup);
    card.append(details);

    return card;
}

function createModuleCard(module) {
    const card = element('a', 'wo-module-card');

    card.href = `#${module.route}`;

    card.append(
        element('span', 'wo-module-icon', module.icon),
        element('h3', '', module.title),
        element('p', '', module.description)
    );

    card.append(
        element('span', 'wo-module-link', 'Open module →')
    );

    return card;
}

/** Render the warehouse dashboard and load harvest status totals in parallel. */
export async function render(root, ctx) {
    const page = element('section', 'wo-dashboard');

    // Dashboard heading
    const heading = element('div', 'wo-page-heading');

    heading.append(
        element('h1', '', 'Warehouse Dashboard'),
        element(
            'p',
            'muted',
            `Welcome, ${ctx.staff?.full_name || 'Warehouse Officer'}.`
        )
    );

    page.append(heading);

    // Assigned farm information
    page.append(
        createAssignedFarmCard(ctx.assignedFarm)
    );

    // Harvest statistics
    const stats = element('div', 'wo-stats-grid');

    stats.append(
        createStat('Pending Harvests', '…', 'Awaiting verification'),
        createStat('In Progress', '…', 'Currently being checked'),
        createStat('Verified Harvests', '…', 'Successfully confirmed'),
        createStat('Rejected Harvests', '…', 'Submissions rejected')
    );

    page.append(stats);

    // Warehouse modules
    const modulesHeading = element('div', 'wo-section-heading');

    modulesHeading.append(
        element('h2', '', 'Warehouse Management'),
        element('p', 'muted', 'Manage warehouse records and resources.')
    );

    page.append(modulesHeading);

    const modulesGrid = element('div', 'wo-modules-grid');

    MODULES.forEach(module => {
        modulesGrid.append(createModuleCard(module));
    });

    page.append(modulesGrid);

    root.append(page);

    // Load statistics
    const [pending, inProgress, confirmed, rejected] = await Promise.all([
        getCount('pending'),
        getCount('in_progress'),
        getCount('confirmed'),
        getCount('rejected')
    ]);

    const values = [pending, inProgress, confirmed, rejected];

    stats.replaceChildren(
        createStat('Pending Harvests', values[0], 'Awaiting verification'),
        createStat('In Progress', values[1], 'Currently being checked'),
        createStat('Verified Harvests', values[2], 'Successfully confirmed'),
        createStat('Rejected Harvests', values[3], 'Submissions rejected')
    );
}

export function cleanup() {}
