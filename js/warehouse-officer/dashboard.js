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

/**
 * Resolve the Warehouse Officer's staff_id.
 * Uses ctx.staff when it already has one; otherwise looks it up
 * from the signed-in user (staff_accounts.user_id -> staff_id).
 */
async function getOfficerStaffId(ctx) {
    if (ctx?.staff?.staff_id) return ctx.staff.staff_id;

    const { data: authData, error: authError } = await supabase.auth.getUser();

    if (authError) throw authError;

    const userId = authData?.user?.id;

    if (!userId) return null;

    const { data, error } = await supabase
        .from('staff_accounts')
        .select('staff_id')
        .eq('user_id', userId)
        .maybeSingle();

    if (error) throw error;

    return data?.staff_id ?? null;
}

/**
 * Load the officer's active farm assignment directly from the same table
 * the admin page writes to (warehouse_officer_farm_assignments.officer_id
 * stores the officer's staff_id).
 * Returns { farm_name, farm_location } or null when none is found.
 */


async function loadAssignedFarm(ctx) {
    const staffId = await getOfficerStaffId(ctx);

    if (!staffId) {
        console.error('No Warehouse Officer staff_id found.');
        return null;
    }

    const { data: assignment, error: assignmentError } = await supabase
        .from('warehouse_officer_farm_assignments')
        .select(`
            farm_id,
            farmer_farms (
                id,
                farm_name,
                farm_location
            )
        `)
        .eq('staff_id', staffId)
        .order('assigned_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (assignmentError) {
        console.error('Failed to load WO farm assignment:', {
            staffId,
            code: assignmentError.code,
            message: assignmentError.message,
            details: assignmentError.details,
            hint: assignmentError.hint
        });
        throw assignmentError;
    }

    if (!assignment) {
        console.warn('No farm assignment found for staff:', staffId);
        return null;
    }

    const farm = assignment.farmer_farms;

    if (!farm) {
        console.error('Assignment exists but related farm was not returned:', assignment);
        return null;
    }

    return {
        farm_id: farm.id,
        farm_name: farm.farm_name,
        farm_location: farm.farm_location
    };
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

    // Assigned farm information (shown from ctx first, then refreshed
    // from the database if ctx did not provide it)
    let farmCard = createAssignedFarmCard(ctx.assignedFarm);

    page.append(farmCard);

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

    // If ctx has no assigned farm, look it up directly.
    const farmLookup = ctx.assignedFarm
        ? Promise.resolve(ctx.assignedFarm)
        : loadAssignedFarm(ctx).catch(error => {
            console.error('Failed to load assigned farm:', error);
            return null;
        });

    // Load statistics
    const [pending, inProgress, confirmed, rejected, assignedFarm] =
        await Promise.all([
            getCount('pending'),
            getCount('in_progress'),
            getCount('confirmed'),
            getCount('rejected'),
            farmLookup
        ]);

    if (assignedFarm && !ctx.assignedFarm) {
        const updatedCard = createAssignedFarmCard(assignedFarm);

        farmCard.replaceWith(updatedCard);
        farmCard = updatedCard;
    }

    const values = [pending, inProgress, confirmed, rejected];

    stats.replaceChildren(
        createStat('Pending Harvests', values[0], 'Awaiting verification'),
        createStat('In Progress', values[1], 'Currently being checked'),
        createStat('Verified Harvests', values[2], 'Successfully confirmed'),
        createStat('Rejected Harvests', values[3], 'Submissions rejected')
    );
}

export function cleanup() {}