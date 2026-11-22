import { supabase } from '../connection.js';
import { h, pageHead, select, toast } from './ui.js';

let root = null;
let catalog = [];
let accounts = [];
let roleDefaults = [];
let overrides = [];
let draftOverrides = new Map();

let selectedRole = 'farm_manager';
let selectedUserId = '';
let currentUserId = null;

let loading = false;
let saving = false;
let accountsLoading = false;
let searchTerm = '';

let loadRequestId = 0;
let accountRequestId = 0;

const PROFILE = [
    'dashboard.view',
    'profile.view',
    'profile.edit',
];

const ROLE_PERMISSIONS = {
    farm_manager: new Set([
        ...PROFILE,
        'farms.view', 'farms.edit',
        'staff.view',
        'farm_actions.view', 'farm_actions.create',
        'farm_actions.approve', 'farm_actions.edit',
        'plantings.view', 'plantings.create',
        'plant_now.view', 'plant_now.create',
        'plantings.view', 'plantings.create',
        'crops.view', 'crops.create', 'crops.edit', 'crops.delete',
        'harvests.view',
        'reports.view', 'reports.export',
        'products.view',
        'shopping_cart.view', 'shopping_cart.create',
        'shopping_cart.edit', 'shopping_cart.delete',
        'purchase_orders.view', 'purchase_orders.create',
        'purchase_orders.edit',
        'deliveries.view', 'deliveries.edit',
    ]),

    warehouse_officer: new Set([
        ...PROFILE,
        'inventory.view', 'inventory.manage', 'supplies.issue',
        'fertilizer_inventory.view', 'fertilizer_inventory.create',
        'fertilizer_inventory.edit', 'fertilizer_inventory.delete',
        'fertilizer.manage',
        'pesticide_inventory.view', 'pesticide_inventory.create',
        'pesticide_inventory.edit', 'pesticide_inventory.delete',
        'pesticide.manage',
        'harvest_inventory.view', 'harvest_inventory.edit',
        'equipment.view',
        'deliveries.view', 'deliveries.edit',
        'purchase_orders.view', 'purchase_orders.create',
        'purchase_orders.edit',
        'produce_records.view',
        'reports.view',
    ]),

    agricultural_technician: new Set([
        ...PROFILE,
        'assigned_farms.view', 'assigned_farms.edit',
        'crops.view',
        'plantings.view',
        'crop_assessments.view', 'crop_assessments.create',
        'crop_assessments.edit',
        'crop_monitoring.view', 'crop_monitoring.create',
        'crop_monitoring.edit',
        'field_inspections.view', 'field_inspections.create',
        'field_inspections.edit',
        'monitoring_reports.view',
        'recommendations.view',
        'activities.view', 'activities.create',
        'farm_actions.view', 'farm_actions.create',
    ]),

    accountant: new Set([
        ...PROFILE,
        'produce_records.view',
        'sales_records.view',
        'payment_history.view',
        'reports.view',
        'settings.view',
    ]),

    farmer: new Set([
        'dashboard.view',
        'activities.view',
        'activities.edit',
        'plantings.view',
        'plantings.edit',
        'recommendations.view',
        'recommendations.edit',
        'harvest_records.view',
        'harvest_records.edit',
    ]),

    buyer: new Set([
        'produce.view',
        'cart.view',
        'cart.create',
        'cart.edit',
        'cart.delete',
        'orders.create',
        'orders.view',
        'orders.cancel',
        'order_history.view',
        'profile.edit',
        'profile.password',
    ]),

    supplier: new Set([
        ...PROFILE,
        'products.view',
        'inventory.view',
        'purchase_orders.view', 'purchase_orders.edit',
        'deliveries.view', 'deliveries.edit',
        'invoices.view', 'invoices.create',
        'payment_history.view',
    ]),
};

const ROLES = [
    { key: 'farm_manager', label: 'Farm Manager', source: 'staff' },
    { key: 'warehouse_officer', label: 'Warehouse Officer', source: 'staff' },
    { key: 'agricultural_technician', label: 'Agricultural Technician', source: 'staff' },
    { key: 'accountant', label: 'Accountant', source: 'staff' },
    { key: 'farmer', label: 'Farmer', source: 'profile' },
    { key: 'buyer', label: 'Buyer', source: 'profile' },
    { key: 'supplier', label: 'Supplier', source: 'profile' },
];

const PROFILE_ROLE_VALUES = {
    farmer: 'farmer',
    buyer: 'buyer',
    supplier: 'supplier',
};

const ACTION_LABELS = {
    view: 'View',
    create: 'Create',
    edit: 'Edit',
    delete: 'Delete',
    approve: 'Approve',
    review: 'Review',
    manage: 'Manage',
    export: 'Export',
    assign: 'Assign',
    issue: 'Issue',
    track: 'Track',
    hide: 'Hide',
    reject: 'Reject',
    request_revision: 'Request Revision',
};

const $ = (selector) => root?.querySelector(selector);

function normalizeRole(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-zA-Z0-9]+/g, '_');
}

function getSelectedRole() {
    return ROLES.find((role) => role.key === selectedRole);
}

function getRoleLabel() {
    return getSelectedRole()?.label || selectedRole;
}

function permissionLabel(permission) {
    return ACTION_LABELS[permission.action_name]
        || String(permission.action_name || '')
            .replaceAll('_', ' ')
            .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getRoleCatalog() {
    const allowedKeys = ROLE_PERMISSIONS[selectedRole];

    if (!allowedKeys) return [];

    return catalog.filter((permission) =>
        allowedKeys.has(permission.permission_key)
    );
}

function getVisibleCatalog() {
    return getRoleCatalog().filter((permission) => {
        if (!searchTerm) return true;

        const search = searchTerm.toLowerCase();

        return (
            permission.module_name?.toLowerCase().includes(search)
            || permission.permission_key.toLowerCase().includes(search)
            || permission.action_name?.toLowerCase().includes(search)
        );
    });
}

function getRoleDefault(permissionKey) {
    return roleDefaults.find(
        (item) => item.permission_key === permissionKey
    )?.is_allowed ?? false;
}

function getIndividualOverride(permissionKey) {
    return overrides.find(
        (item) => item.permission_key === permissionKey
    );
}

function getPermissionState(permissionKey) {
    if (draftOverrides.has(permissionKey)) {
        const draftValue = draftOverrides.get(permissionKey);

        if (draftValue !== null) {
            return draftValue;
        }

        return getRoleDefault(permissionKey);
    }

    const override = getIndividualOverride(permissionKey);

    if (override) {
        return Boolean(override.is_allowed);
    }

    return getRoleDefault(permissionKey);
}

function getPermissionSource(permissionKey) {
    if (draftOverrides.has(permissionKey)) {
        return draftOverrides.get(permissionKey) === null
            ? 'Role default'
            : 'Unsaved individual change';
    }

    if (getIndividualOverride(permissionKey)) {
        return 'Individual override';
    }

    return 'Role default';
}

function setPermissionState(permissionKey, allowed) {
    const roleDefault = getRoleDefault(permissionKey);

    if (allowed === roleDefault) {
        draftOverrides.set(permissionKey, null);
    } else {
        draftOverrides.set(permissionKey, allowed);
    }

    render();
}

function hasUnsavedChanges() {
    return draftOverrides.size > 0;
}

function getSelectedAccount() {
    return accounts.find(
        (account) => account.user_id === selectedUserId
    ) || null;
}

function renderPermissionCard(permission) {
    const key = permission.permission_key;
    const allowed = getPermissionState(key);
    const source = getPermissionSource(key);

    const toggle = h(
        'button',
        {
            type: 'button',
            class: `permission-toggle ${allowed ? 'is-allowed' : 'is-denied'}`,
            role: 'switch',
            'aria-checked': String(allowed),
            'aria-label': `${permission.module_name}: ${permissionLabel(permission)}`,
            disabled: loading || saving,
            onclick: () => setPermissionState(key, !allowed),
        },
        h(
            'span',
            { class: 'permission-toggle-track' },
            h('span', { class: 'permission-toggle-thumb' })
        )
    );

    return h(
        'div',
        { class: 'permission-item' },
        h(
            'div',
            { class: 'permission-item-info' },
            h('strong', {}, permissionLabel(permission)),
            h('small', {}, key),
            h('small', { class: 'permission-source' }, source)
        ),
        h(
            'div',
            { class: 'permission-item-control' },
            h(
                'span',
                { class: `permission-state ${allowed ? 'allowed' : 'denied'}` },
                allowed ? 'Allowed' : 'Denied'
            ),
            toggle
        )
    );
}

function renderModule(moduleName, modulePermissions) {
    const allowedCount = modulePermissions.filter(
        (item) => getPermissionState(item.permission_key)
    ).length;

    return h(
        'section',
        { class: 'permission-module' },
        h(
            'div',
            { class: 'permission-module-head' },
            h('h3', {}, moduleName),
            h(
                'span',
                { class: 'permission-module-count' },
                `${allowedCount}/${modulePermissions.length} allowed`
            )
        ),
        h(
            'div',
            { class: 'permission-list' },
            modulePermissions.map(renderPermissionCard)
        )
    );
}

function render() {
    if (!root) return;

    const visible = getVisibleCatalog();

    const grouped = visible.reduce((groups, permission) => {
        const moduleName = permission.module_name || 'Other';
        (groups[moduleName] ||= []).push(permission);
        return groups;
    }, {});

    const roleSelect = select(
        ROLES.map((role) => [role.key, role.label]),
        selectedRole,
        (value) => {
            if (saving || value === selectedRole) return;
            changeRole(value);
        },
        'Select role'
    );

    roleSelect.className = 'form-control permission-role-select';
    roleSelect.disabled = loading || saving || accountsLoading;

    const accountOptions = [
        ['', 'Select user/staff'],
        ...accounts.map((account) => [
            account.user_id,
            `${account.full_name} — ${account.email}`,
        ]),
    ];

    const accountSelect = select(
        accountOptions,
        selectedUserId,
        (value) => {
            if (saving || value === selectedUserId) return;
            changeAccount(value);
        },
        'Select user/staff'
    );

    accountSelect.className = 'form-control permission-user-select';
    accountSelect.disabled = loading || saving || accountsLoading || accounts.length === 0;

    const search = h('input', {
        type: 'search',
        class: 'form-control permission-search',
        placeholder: 'Search modules or permissions...',
        value: searchTerm,
        disabled: loading || saving || !selectedUserId,
        oninput: (event) => {
            searchTerm = event.target.value;
            const cursorPosition = event.target.selectionStart;

            render();

            const box = $('.permission-search');

            if (box) {
                box.focus();
                box.setSelectionRange(cursorPosition, cursorPosition);
            }
        },
        'aria-label': 'Search permissions',
    });

    const allowedCount = visible.filter(
        (item) => getPermissionState(item.permission_key)
    ).length;

    const summary = h(
        'div',
        { class: 'permission-summary' },
        h(
            'div',
            {},
            h('strong', {}, allowedCount),
            h('span', {}, 'Allowed')
        ),
        h(
            'div',
            {},
            h('strong', {}, visible.length - allowedCount),
            h('span', {}, 'Denied')
        ),
        h(
            'div',
            {},
            h('strong', {}, visible.length),
            h('span', {}, 'Total Permissions')
        )
    );

    const selectedAccount = getSelectedAccount();

    const saveButton = h(
        'button',
        {
            type: 'button',
            class: 'btn btn-primary',
            disabled:
                saving
                || loading
                || accountsLoading
                || !selectedUserId
                || !hasUnsavedChanges(),
            onclick: savePermissions,
        },
        saving ? 'Saving...' : 'Save Changes'
    );

    const content = h(
        'div',
        { class: 'role-permissions' },

        h(
            'div',
            { class: 'permission-toolbar' },

            h(
                'div',
                { class: 'permission-role-field' },
                h('label', {}, 'Select Role'),
                roleSelect
            ),

            h(
                'div',
                { class: 'permission-user-field' },
                h('label', {}, 'Select User/Staff'),
                accountSelect
            ),

            h(
                'div',
                { class: 'permission-search-field' },
                h('label', {}, 'Find Permission'),
                search
            )
        ),

        selectedAccount
            ? h(
                'div',
                { class: 'permission-selected-account' },
                h('strong', {}, selectedAccount.full_name),
                h('span', {}, selectedAccount.email)
            )
            : null,

        accountsLoading
            ? h('p', { class: 'empty' }, 'Loading users/staff...')
            : null,

        !accountsLoading && accounts.length === 0
            ? h('p', { class: 'empty' }, 'No active accounts found for this role.')
            : null,

        selectedUserId
            ? summary
            : null,

        selectedUserId
            ? h(
                'div',
                { class: 'permission-notice' },
                'Changes apply only to the selected account. Individual overrides take priority over role defaults. Permissions without an individual override follow the role default.'
            )
            : h(
                'p',
                { class: 'empty' },
                'Select a role and user/staff account to display permissions.'
            ),

        loading
            ? h('p', { class: 'empty' }, 'Loading permissions...')
            : selectedUserId
                ? h(
                    'div',
                    { class: 'permission-modules' },
                    ...Object.entries(grouped)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([name, items]) =>
                            renderModule(
                                name,
                                [...items].sort((a, b) =>
                                    String(a.action_name || '').localeCompare(
                                        String(b.action_name || '')
                                    )
                                )
                            )
                        )
                )
                : null,

        !loading && selectedUserId && visible.length === 0
            ? h(
                'p',
                { class: 'empty' },
                'No permissions configured for this role.'
            )
            : null,

        h(
            'div',
            { class: 'permission-footer' },
            h(
                'span',
                {},
                selectedAccount
                    ? `Editing: ${selectedAccount.full_name}`
                    : `Role: ${getRoleLabel()}`
            ),
            saveButton
        )
    );

    root.replaceChildren(
        pageHead(
            'Individual Permissions',
            'Manage module and action access for specific users and staff accounts.'
        ),
        content
    );
}

async function changeRole(roleKey) {
    selectedRole = roleKey;
    selectedUserId = '';

    accounts = [];
    roleDefaults = [];
    overrides = [];
    draftOverrides.clear();

    searchTerm = '';
    loading = false;

    render();
    await loadAccounts();
}

async function changeAccount(userId) {
    selectedUserId = userId;

    roleDefaults = [];
    overrides = [];
    draftOverrides.clear();
    searchTerm = '';

    if (!userId) {
        loading = false;
        render();
        return;
    }

    await loadSelectedPermissions();
}

async function loadAccounts() {
    const requestId = ++accountRequestId;
    const role = getSelectedRole();

    if (!role) return;

    accountsLoading = true;
    accounts = [];
    selectedUserId = '';
    render();

    try {
        let result;

        if (role.source === 'staff') {
            const { data: roleData, error: roleError } = await supabase
                .from('staff_roles')
                .select('role_id, role_name');

            if (roleError) throw roleError;

            const staffRole = (roleData || []).find(
                (item) => normalizeRole(item.role_name) === role.key
            );

            if (!staffRole) {
                throw new Error(`Staff role not found: ${role.label}`);
            }

            result = await supabase
                .from('staff_accounts')
                .select('staff_id, user_id, full_name, email, status_id')
                .eq('role_id', staffRole.role_id)
                .eq('status_id', 1)
                .not('user_id', 'is', null)
                .order('full_name');

        } else {
            const profileRole = PROFILE_ROLE_VALUES[role.key];

            if (!profileRole) {
                throw new Error(`Profile role mapping not found: ${role.label}`);
            }

            result = await supabase
                .from('profiles')
                .select('id, full_name, email, role, status')
                .eq('role', profileRole)
                .is('deleted_at', null)
                .in('status', ['active', 'approved'])
                .order('full_name');
        }

        if (result.error) throw result.error;

        if (requestId !== accountRequestId) return;

        accounts = (result.data || [])
            .map((item) => ({
                user_id: item.user_id || item.id,
                full_name: item.full_name,
                email: item.email,
            }))
            .filter((item) => item.user_id);

    } catch (error) {
        if (requestId !== accountRequestId) return;

        console.error('Failed to load accounts:', error);
        toast(error.message || 'Failed to load users/staff.');

    } finally {
        if (requestId === accountRequestId) {
            accountsLoading = false;
            render();
        }
    }
}

async function loadSelectedPermissions() {
    if (!selectedUserId) return;

    const requestId = ++loadRequestId;
    const userId = selectedUserId;
    const roleKey = selectedRole;

    loading = true;
    roleDefaults = [];
    overrides = [];
    draftOverrides.clear();

    render();

    try {
        const [defaultsResult, overridesResult] = await Promise.all([
            supabase
                .from('role_permissions')
                .select('permission_key, is_allowed')
                .eq('role_key', roleKey),

            supabase
                .from('user_permissions')
                .select('user_id, permission_key, is_allowed')
                .eq('user_id', userId),
        ]);

        if (defaultsResult.error) throw defaultsResult.error;
        if (overridesResult.error) throw overridesResult.error;

        if (
            requestId !== loadRequestId
            || userId !== selectedUserId
            || roleKey !== selectedRole
        ) {
            return;
        }

        roleDefaults = (defaultsResult.data || []).map((item) => ({
            ...item,
            is_allowed: Boolean(item.is_allowed),
        }));

        overrides = (overridesResult.data || []).map((item) => ({
            ...item,
            is_allowed: Boolean(item.is_allowed),
        }));

    } catch (error) {
        if (requestId !== loadRequestId) return;

        console.error('Failed to load individual permissions:', error);
        toast(error.message || 'Failed to load individual permissions.');
    } finally {
        if (requestId === loadRequestId) {
            loading = false;
            render();
        }
    }
}

async function savePermissions() {
    if (
        saving
        || loading
        || !selectedUserId
        || !hasUnsavedChanges()
    ) {
        return;
    }

    const userId = selectedUserId;
    const roleKey = selectedRole;
    const changes = [...draftOverrides.entries()];

    saving = true;
    render();

    try {
        const rowsToUpsert = changes
            .filter(([, value]) => value !== null)
            .map(([permissionKey, allowed]) => ({
                user_id: userId,
                permission_key: permissionKey,
                is_allowed: allowed,
                updated_by: currentUserId,
                updated_at: new Date().toISOString(),
            }));

        const keysToDelete = changes
            .filter(([, value]) => value === null)
            .map(([permissionKey]) => permissionKey);

        if (rowsToUpsert.length > 0) {
            const { error } = await supabase
                .from('user_permissions')
                .upsert(rowsToUpsert, {
                    onConflict: 'user_id,permission_key',
                });

            if (error) throw error;
        }

        if (keysToDelete.length > 0) {
            const { error } = await supabase
                .from('user_permissions')
                .delete()
                .eq('user_id', userId)
                .in('permission_key', keysToDelete);

            if (error) throw error;
        }

        if (selectedUserId !== userId || selectedRole !== roleKey) {
            return;
        }

        toast('Individual permissions saved successfully.');

        await loadSelectedPermissions();

    } catch (error) {
        console.error('Failed to save individual permissions:', error);
        toast(error.message || 'Failed to save individual permissions.');
    } finally {
        saving = false;
        render();
    }
}

async function init() {
    if (!root) return;

    loading = true;
    render();

    try {
        const { data: userData, error: userError } =
            await supabase.auth.getUser();

        if (userError) throw userError;

        currentUserId = userData?.user?.id || null;

        if (!currentUserId) {
            throw new Error('Unable to verify administrator account.');
        }

        const { data: admin, error: adminError } = await supabase
            .from('admin_users')
            .select('user_id')
            .eq('user_id', currentUserId)
            .maybeSingle();

        if (adminError) throw adminError;

        if (!admin) {
            root.replaceChildren(
                h(
                    'p',
                    { class: 'empty' },
                    'You are not authorized to manage individual permissions.'
                )
            );
            return;
        }

        const { data: catalogData, error: catalogError } = await supabase
            .from('permission_catalog')
            .select('permission_key, module_name, action_name, description')
            .order('module_name')
            .order('action_name');

        if (catalogError) throw catalogError;

        catalog = catalogData || [];

        // Keep only permission keys that actually exist in the catalog.
        for (const [roleKey, permissionSet] of Object.entries(ROLE_PERMISSIONS)) {
            ROLE_PERMISSIONS[roleKey] = new Set(
                [...permissionSet].filter((key) =>
                    catalog.some((item) => item.permission_key === key)
                )
            );
        }

        loading = false;
        render();

        await loadAccounts();

    } catch (error) {
        console.error('Admin Settings initialization failed:', error);
        loading = false;

        root.replaceChildren(
            h(
                'p',
                { class: 'empty' },
                error.message || 'Failed to load Individual Permissions.'
            )
        );
    }
}

async function renderView(viewRoot) {
    root = viewRoot || document.getElementById('view');

    catalog = [];
    accounts = [];
    roleDefaults = [];
    overrides = [];
    draftOverrides = new Map();

    selectedRole = 'farm_manager';
    selectedUserId = '';
    currentUserId = null;

    loading = false;
    saving = false;
    accountsLoading = false;
    searchTerm = '';

    loadRequestId++;
    accountRequestId++;

    await init();
}

export { renderView as render };