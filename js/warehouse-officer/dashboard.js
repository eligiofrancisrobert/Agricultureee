
import { supabase } from '../connection.js';
import { hasPermission } from '../admin/permissions.js';

// =====================================================
// MODULES
// =====================================================

const MODULES = [
    {
        title: 'Harvest Records',
        description: 'Review and verify farmers’ harvest submissions.',
        icon: '📋',
        route: 'harvest-records',
        permission: 'harvests.view'
    },
    {
        title: 'Fertilizer Inventory',
        description: 'Monitor fertilizer stocks and availability.',
        icon: '🌱',
        route: 'fertilizer-inventory',
        permission: 'inventory.view'
    },
    {
        title: 'Pesticide Inventory',
        description: 'Monitor pesticide stocks and availability.',
        icon: '🧪',
        route: 'pesticide-inventory',
        permission: 'inventory.view'
    },
    {
        title: 'Equipment',
        description: 'Monitor available agricultural equipment.',
        icon: '🚜',
        route: 'equipment',
        permission: 'inventory.view'
    },
    {
        title: 'Harvest Inventory',
        description: 'View verified harvest records.',
        icon: '🌾',
        route: 'harvest-inventory',
        permission: 'harvests.view'
    }
];

// =====================================================
// HELPERS
// =====================================================

function element(tag, className, text) {
    const el = document.createElement(tag);

    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;

    return el;
}

// =====================================================
// PERMISSIONS
// =====================================================

async function checkDashboardPermission() {
    return await hasPermission('dashboard.view');
}

async function getAccessibleModules() {
    const results = await Promise.all(
        MODULES.map(async module => ({
            module,
            allowed: await hasPermission(module.permission)
        }))
    );

    return results
        .filter(item => item.allowed)
        .map(item => item.module);
}

// =====================================================
// HARVEST STATISTICS
// =====================================================

async function getCount(status) {
    let query = supabase
        .from('harvested_crops')
        .select('harvest_id', {
            count: 'exact',
            head: true
        });

    if (status) {
        query = query.eq('confirmation_status', status);
    }

    const { count, error } = await query;

    if (error) {
        console.error(
            `Failed to load ${status || 'harvest'} count:`,
            error
        );

        return null;
    }

    return count ?? 0;
}

// =====================================================
// WAREHOUSE OFFICER ACCOUNT
// =====================================================

async function getOfficerStaffId(ctx) {
    if (ctx?.staff?.staff_id) {
        return ctx.staff.staff_id;
    }

    const {
        data: authData,
        error: authError
    } = await supabase.auth.getUser();

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

// =====================================================
// ASSIGNED FARM
// =====================================================

async function loadAssignedFarm(ctx) {
    const staffId = await getOfficerStaffId(ctx);

    if (!staffId) {
        console.error('No Warehouse Officer staff_id found.');
        return null;
    }

    const { data: assignment, error } = await supabase
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

    if (error) {
        console.error('Failed to load WO farm assignment:', {
            staffId,
            code: error.code,
            message: error.message,
            details: error.details,
            hint: error.hint
        });

        throw error;
    }

    if (!assignment) {
        console.warn(
            'No farm assignment found for staff:',
            staffId
        );

        return null;
    }

    const farm = assignment.farmer_farms;

    if (!farm) {
        console.error(
            'Assignment exists but related farm was not returned:',
            assignment
        );

        return null;
    }

    return {
        farm_id: farm.id,
        farm_name: farm.farm_name,
        farm_location: farm.farm_location
    };
}

// =====================================================
// STATISTICS CARD
// =====================================================

function createStat(label, value, description) {
    const card = element('article', 'wo-stat-card');

    card.append(
        element('span', 'wo-stat-label', label),
        element(
            'strong',
            'wo-stat-value',
            value === null ? '—' : value
        ),
        element('small', 'wo-stat-description', description)
    );

    return card;
}

// =====================================================
// ASSIGNED FARM CARD
// =====================================================

function createAssignedFarmCard(farm) {
    const card = element('article', 'wo-assigned-farm-card');

    const header = element('div', 'wo-assigned-farm-header');

    header.append(
        element('span', 'wo-assigned-farm-icon', '🌾'),
        element('div', 'wo-assigned-farm-heading')
    );

    const heading = header.querySelector(
        '.wo-assigned-farm-heading'
    );

    heading.append(
        element('h2', '', 'My Assigned Farm'),
        element(
            'span',
            'wo-assigned-farm-status',
            farm ? 'Assigned' : 'Not Assigned'
        )
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

    const details = element(
        'div',
        'wo-assigned-farm-details'
    );

    const nameGroup = element('div', 'wo-farm-detail');

    nameGroup.append(
        element('span', 'wo-farm-detail-label', 'Farm Name'),
        element(
            'strong',
            'wo-farm-detail-value',
            farm.farm_name || 'Not available'
        )
    );

    const locationGroup = element(
        'div',
        'wo-farm-detail'
    );

    locationGroup.append(
        element('span', 'wo-farm-detail-label', 'Farm Location'),
        element(
            'strong',
            'wo-farm-detail-value',
            farm.farm_location || 'Not available'
        )
    );

    details.append(nameGroup, locationGroup);
    card.append(details);

    return card;
}

// =====================================================
// MODULE CARD
// =====================================================

function createModuleCard(module) {
    const card = element('a', 'wo-module-card');

    card.href = `#${module.route}`;

    card.append(
        element('span', 'wo-module-icon', module.icon),
        element('h3', '', module.title),
        element('p', '', module.description),
        element('span', 'wo-module-link', 'Open module →')
    );

    return card;
}

// =====================================================
// MODULES SECTION
// =====================================================

function createModulesSection(modules) {
    const section = element('section', 'wo-modules-section');

    const heading = element('div', 'wo-section-heading');

    heading.append(
        element('h2', '', 'Warehouse Management'),
        element(
            'p',
            'muted',
            'View accessible warehouse records and resources.'
        )
    );

    section.append(heading);

    const grid = element('div', 'wo-modules-grid');

    if (!modules.length) {
        grid.append(
            element(
                'p',
                'muted',
                'No warehouse modules are currently available to your account.'
            )
        );
    } else {
        modules.forEach(module => {
            grid.append(createModuleCard(module));
        });
    }

    section.append(grid);

    return section;
}

// =====================================================
// MAIN RENDER
// =====================================================

export async function render(root, ctx) {
    // Dashboard access check.
    const allowed = await checkDashboardPermission();

    if (!allowed) {
        root.replaceChildren(
            element(
                'p',
                'msg error',
                'You do not have permission to view the Warehouse Dashboard.'
            )
        );

        return;
    }

    const page = element('section', 'wo-dashboard');

    // Dashboard heading.
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

    // Assigned farm.
    let farmCard = createAssignedFarmCard(ctx.assignedFarm);

    page.append(farmCard);

    // Harvest statistics.
    const stats = element('div', 'wo-stats-grid');

    stats.append(
        createStat(
            'Pending Harvests',
            '…',
            'Awaiting verification'
        ),
        createStat(
            'In Progress',
            '…',
            'Currently being checked'
        ),
        createStat(
            'Verified Harvests',
            '…',
            'Successfully confirmed'
        ),
        createStat(
            'Rejected Harvests',
            '…',
            'Submissions rejected'
        )
    );

    page.append(stats);

    // Add page to root.
    root.replaceChildren(page);

    // Load accessible modules.
    const modulesPromise = getAccessibleModules();

    // Load assigned farm.
    const farmPromise = ctx.assignedFarm
        ? Promise.resolve(ctx.assignedFarm)
        : loadAssignedFarm(ctx).catch(error => {
            console.error(
                'Failed to load assigned farm:',
                error
            );

            return null;
        });

    // Load harvest statistics.
    const statisticsPromise = Promise.all([
        getCount('pending'),
        getCount('in_progress'),
        getCount('confirmed'),
        getCount('rejected')
    ]);

    const [
        accessibleModules,
        assignedFarm,
        [pending, inProgress, confirmed, rejected]
    ] = await Promise.all([
        modulesPromise,
        farmPromise,
        statisticsPromise
    ]);

    // Update assigned farm.
    if (assignedFarm && !ctx.assignedFarm) {
        ctx.assignedFarm = assignedFarm;

        const updatedCard = createAssignedFarmCard(
            assignedFarm
        );

        farmCard.replaceWith(updatedCard);
        farmCard = updatedCard;
    }

    // Update statistics.
    stats.replaceChildren(
        createStat(
            'Pending Harvests',
            pending,
            'Awaiting verification'
        ),
        createStat(
            'In Progress',
            inProgress,
            'Currently being checked'
        ),
        createStat(
            'Verified Harvests',
            confirmed,
            'Successfully confirmed'
        ),
        createStat(
            'Rejected Harvests',
            rejected,
            'Submissions rejected'
        )
    );

    // Render only modules the officer can access.
    page.append(
        createModulesSection(accessibleModules)
    );
}

// =====================================================
// CLEANUP
// =====================================================

export function cleanup() {}
