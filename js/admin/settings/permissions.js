
import { h, toast, pageHead } from '../ui.js';
import { supabase } from '../../connection.js';

// =====================================================
// ROLES
// =====================================================

const ROLES = [
    { key: 'farm_manager', label: 'Farm Manager' },
    { key: 'warehouse_officer', label: 'Warehouse Officer' },
    { key: 'agricultural_technician', label: 'Agricultural Technician' },
    { key: 'accountant', label: 'Accountant' },
    { key: 'farmer', label: 'Farmer' },
    { key: 'buyer', label: 'Buyer' },
    { key: 'supplier', label: 'Supplier' }
];

// Admin is excluded because admin_users has a full-access bypass.

// =====================================================
// PERMISSION GROUPS
// =====================================================

const GROUPS = [
    {
        title: 'Dashboard',
        permissions: ['dashboard.view']
    },
    {
        title: 'Users',
        permissions: ['users.view', 'users.manage']
    },
    {
        title: 'Applications',
        permissions: ['applications.view', 'applications.review']
    },
    {
        title: 'Staff Accounts',
        permissions: ['staff.view', 'staff.manage']
    },
    {
        title: 'Farm Management',
        permissions: ['farms.view', 'farms.manage']
    },
    {
        title: 'Plantings',
        permissions: ['plantings.view', 'plantings.manage']
    },
    {
        title: 'Harvests',
        permissions: ['harvests.view', 'harvests.manage']
    },
    {
        title: 'Inventory',
        permissions: [
            'inventory.view',
            'inventory.manage',
            'equipment.manage',
            'fertilizer.manage',
            'pesticide.manage',
            'supplies.issue'
        ]
    },
    {
        title: 'Reports',
        permissions: ['reports.view', 'reports.export']
    },
    {
        title: 'Audit Logs',
        permissions: ['audit_logs.view']
    },
    {
        title: 'System Settings',
        permissions: ['settings.view', 'settings.manage']
    },
    {
        title: 'Role Permissions',
        permissions: ['permissions.view', 'permissions.manage']
    }
];

// =====================================================
// HELPERS
// =====================================================

const getActionLabel = key =>
    key.split('.').at(-1)
        .replaceAll('_', ' ')
        .replace(/\b\w/g, letter => letter.toUpperCase());

const clonePermissions = values => ({ ...values });

const createPermissionRow = (permission, checked, description, onChange) => {
    const checkbox = h('input', {
        type: 'checkbox',
        checked,
        'aria-label': `${getActionLabel(permission)} permission`,
        onchange: event => onChange(event.target.checked)
    });

    return h('label', { class: 'permission-matrix-row' },
        h('div', { class: 'permission-row-info' },
            h('span', {}, getActionLabel(permission)),
            h('small', {}, description || permission)
        ),
        checkbox
    );
};

// =====================================================
// MAIN RENDER
// =====================================================

export async function render(root) {
    root.append(
        pageHead(
            'Roles & Permissions',
            'Configure which system features each role can access.'
        ),
        h('p', {
            class: 'muted permission-loading'
        }, 'Loading permissions...')
    );

    const loading = root.querySelector('.permission-loading');

    try {
        // -------------------------------------------------
        // AUTHENTICATED USER
        // -------------------------------------------------

        const {
            data: { user },
            error: authError
        } = await supabase.auth.getUser();

        if (authError) throw authError;
        if (!user) throw new Error('Administrator session not found.');

        // -------------------------------------------------
        // LOAD PERMISSION DATA
        // -------------------------------------------------

        const [
            { data: catalog, error: catalogError },
            { data: assignments, error: assignmentsError }
        ] = await Promise.all([
            supabase
                .from('permission_catalog')
                .select('permission_key, module_name, action_name, description')
                .order('module_name'),

            supabase
                .from('role_permissions')
                .select('role_key, permission_key, is_allowed')
        ]);

        if (catalogError) throw catalogError;
        if (assignmentsError) throw assignmentsError;

        const catalogRecords = catalog || [];
        const assignmentRecords = assignments || [];

        if (!catalogRecords.length) {
            throw new Error('No permissions found in permission_catalog.');
        }

        const catalogMap = new Map(
            catalogRecords.map(item => [item.permission_key, item])
        );

        // -------------------------------------------------
        // STATE
        // -------------------------------------------------

        let activeRole = ROLES[0].key;
        let saving = false;
        let changingRole = false;

        const selected = new Map();
        const original = new Map();

        // -------------------------------------------------
        // ELEMENTS
        // -------------------------------------------------

        const roleSelect = h('select', {
            class: 'permission-role-select',
            'aria-label': 'Select role'
        },
            ...ROLES.map(role =>
                h('option', {
                    value: role.key,
                    selected: role.key === activeRole
                }, role.label)
            )
        );

        const matrix = h('div', {
            class: 'permission-matrix'
        });

        const status = h('p', {
            class: 'permission-save-status',
            'aria-live': 'polite'
        });

        const saveButton = h('button', {
            type: 'button',
            class: 'btn permission-save-button'
        }, 'Save permissions');

        // -------------------------------------------------
        // PERMISSION STATE
        // -------------------------------------------------

        const initializeRole = roleKey => {
            if (selected.has(roleKey)) return;

            const initial = {};

            catalogRecords.forEach(item => {
                initial[item.permission_key] = false;
            });

            assignmentRecords
                .filter(item => item.role_key === roleKey)
                .forEach(item => {
                    if (item.permission_key in initial) {
                        initial[item.permission_key] = item.is_allowed;
                    }
                });

            selected.set(roleKey, clonePermissions(initial));
            original.set(roleKey, clonePermissions(initial));
        };

        const getValues = () => {
            initializeRole(activeRole);
            return selected.get(activeRole);
        };

        const hasChanges = roleKey => {
            initializeRole(roleKey);

            const current = selected.get(roleKey);
            const saved = original.get(roleKey);

            return Object.keys(current).some(
                key => current[key] !== saved[key]
            );
        };

        const updateStatus = () => {
            const values = getValues();
            const enabled = Object.values(values).filter(Boolean).length;
            const total = Object.keys(values).length;
            const dirty = hasChanges(activeRole);

            status.textContent = dirty
                ? `${enabled} of ${total} enabled · Unsaved changes`
                : `${enabled} of ${total} permissions enabled · All changes saved`;

            status.classList.toggle('is-dirty', dirty);
            saveButton.disabled = !dirty || saving;
            saveButton.textContent = saving
                ? 'Saving...'
                : 'Save permissions';
        };

        // -------------------------------------------------
        // MATRIX RENDERING
        // -------------------------------------------------

        const renderMatrix = () => {
            const values = getValues();

            matrix.replaceChildren();

            GROUPS.forEach(group => {
                const rows = group.permissions
                    .filter(key => catalogMap.has(key))
                    .map(key => {
                        const item = catalogMap.get(key);

                        return createPermissionRow(
                            key,
                            Boolean(values[key]),
                            item.description,
                            checked => {
                                values[key] = checked;
                                updateStatus();
                            }
                        );
                    });

                if (!rows.length) return;

                matrix.append(
                    h('section', {
                        class: 'permission-matrix-group'
                    },
                        h('h3', {}, group.title),
                        ...rows
                    )
                );
            });

            updateStatus();
        };

        // -------------------------------------------------
        // ROLE SWITCHING
        // -------------------------------------------------

        roleSelect.addEventListener('change', () => {
            if (saving || changingRole) return;

            const nextRole = roleSelect.value;

            if (nextRole === activeRole) return;

            if (hasChanges(activeRole)) {
                const confirmed = window.confirm(
                    'You have unsaved permission changes. Discard them and switch roles?'
                );

                if (!confirmed) {
                    roleSelect.value = activeRole;
                    return;
                }

                selected.set(
                    activeRole,
                    clonePermissions(original.get(activeRole))
                );
            }

            activeRole = nextRole;

            renderMatrix();
        });

        // -------------------------------------------------
        // SAVE PERMISSIONS
        // -------------------------------------------------

        saveButton.addEventListener('click', async () => {
            if (saving || !hasChanges(activeRole)) return;

            saving = true;
            saveButton.disabled = true;
            saveButton.textContent = 'Saving...';

            try {
                const values = getValues();

                const records = Object.entries(values).map(
                    ([permission_key, is_allowed]) => ({
                        role_key: activeRole,
                        permission_key,
                        is_allowed,
                        updated_by: user.id,
                        updated_at: new Date().toISOString()
                    })
                );

                const { error } = await supabase
                    .from('role_permissions')
                    .upsert(records, {
                        onConflict: 'role_key,permission_key'
                    });

                if (error) throw error;

                original.set(
                    activeRole,
                    clonePermissions(values)
                );

                toast('Role permissions saved successfully.');

            } catch (error) {
                console.error('Permission save failed:', error);

                toast(
                    error.message || 'Unable to save permissions.'
                );

            } finally {
                saving = false;
                updateStatus();
            }
        });

        // -------------------------------------------------
        // DISPLAY
        // -------------------------------------------------

        loading.remove();

        root.append(
            h('section', {
                class: 'permission-editor card'
            },
                h('div', {
                    class: 'permission-editor-header'
                },
                    h('div', {},
                        h('h3', {}, 'Permission Matrix'),
                        h('p', {
                            class: 'muted'
                        }, 'Select a role to configure its access.')
                    ),
                    roleSelect
                ),

                matrix,

                h('div', {
                    class: 'permission-editor-footer'
                },
                    status,
                    saveButton
                )
            )
        );

        renderMatrix();

    } catch (error) {
        console.error('Could not load roles and permissions:', error);

        loading.replaceWith(
            h('p', {
                class: 'msg error'
            },
                error.message ||
                'Unable to load permissions. Check Supabase access and database policies.'
            )
        );
    }
}
