
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

// System Backup state
let backupHistory = [];
let backupLoading = false;
let backupCreating = false;
let backupDownloadingId = null;
let backupLoadError = '';

let backupPollTimer = null;
let backupPollInFlight = false;

const BACKUP_POLL_INTERVAL = 4000;

// Automatic Backup Schedule state
let backupSchedule = {
    enabled: false,
    backup_time: '02:00:00',
    timezone: 'Asia/Manila',
};

let backupScheduleLoading = false;
let backupScheduleSaving = false;
let backupScheduleLoaded = false;

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

// ----------------------------------------
// SYSTEM BACKUP HELPERS
// ----------------------------------------

function formatBackupDate(value) {
    if (!value) return 'Not available';

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return 'Not available';
    }

    return date.toLocaleString('en-PH', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}

function formatBackupSize(bytes) {
    const size = Number(bytes);

    if (!Number.isFinite(size) || size <= 0) {
        return '0 B';
    }

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(
        Math.floor(Math.log(size) / Math.log(1024)),
        units.length - 1
    );

    return `${(size / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

function formatBackupStatus(status) {
    const value = String(status || 'unknown')
        .trim()
        .toLowerCase();

    return value.charAt(0).toUpperCase() + value.slice(1);
}

function getBackupStatusClass(status) {
    const value = String(status || 'unknown').toLowerCase();

    if (['completed', 'success', 'successful'].includes(value)) {
        return 'completed';
    }

    if (['failed', 'cancelled'].includes(value)) {
        return 'failed';
    }

    if (['pending', 'running'].includes(value)) {
        return 'pending';
    }

    return 'pending';
}

// ----------------------------------------
// AUTOMATIC BACKUP SCHEDULE
// ----------------------------------------

async function loadBackupSchedule() {
    if (backupScheduleLoading) return;

    backupScheduleLoading = true;
    backupScheduleLoaded = false;
    render();

    try {
        const { data, error } = await supabase
            .from('backup_schedule_settings')
            .select('id, enabled, backup_time, timezone')
            .eq('id', 1)
            .maybeSingle();

        if (error) throw error;

        if (!data) {
            throw new Error('Backup schedule settings record was not found.');
        }

        backupSchedule = {
            enabled: Boolean(data.enabled),
            backup_time: String(data.backup_time || '02:00:00').slice(0, 5),
            timezone: data.timezone || 'Asia/Manila',
        };

        backupScheduleLoaded = true;

    } catch (error) {
        console.error('Failed to load backup schedule:', error);
        toast(error.message || 'Failed to load automatic backup schedule.');

    } finally {
        backupScheduleLoading = false;
        render();
    }
}

function updateBackupSchedule(field, value) {
    if (backupScheduleSaving || backupScheduleLoading) return;

    backupSchedule = {
        ...backupSchedule,
        [field]: value,
    };

    render();

    const control = $(`[data-backup-schedule="${field}"]`);

    if (control) {
        control.focus();
    }
}

async function saveBackupSchedule() {
    if (
        backupScheduleSaving
        || backupScheduleLoading
        || !backupScheduleLoaded
    ) {
        return;
    }

    const time = String(backupSchedule.backup_time || '').trim();
    const timezone = String(backupSchedule.timezone || '').trim();

    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
        toast('Please enter a valid backup time.');
        return;
    }

    if (!timezone) {
        toast('Please enter a valid timezone.');
        return;
    }

    backupScheduleSaving = true;
    render();

    try {
        const { data, error } = await supabase
            .from('backup_schedule_settings')
            .update({
                enabled: Boolean(backupSchedule.enabled),
                backup_time: `${time}:00`,
                timezone,
                updated_by: currentUserId,
                updated_at: new Date().toISOString(),
            })
            .eq('id', 1)
            .select('id, enabled, backup_time, timezone')
            .maybeSingle();

        if (error) throw error;

        if (!data) {
            throw new Error(
                'Schedule was not saved. Check the admin update permission for backup_schedule_settings.'
            );
        }

        backupSchedule = {
            enabled: Boolean(data.enabled),
            backup_time: String(data.backup_time || '02:00:00').slice(0, 5),
            timezone: data.timezone || 'Asia/Manila',
        };

        toast('Automatic backup schedule saved successfully.');

    } catch (error) {
        console.error('Failed to save backup schedule:', error);
        toast(error.message || 'Failed to save automatic backup schedule.');

    } finally {
        backupScheduleSaving = false;
        render();
    }
}

// ----------------------------------------
// BACKUP AUTOMATIC POLLING
// ----------------------------------------

function hasActiveBackup() {
    return backupHistory.some((backup) =>
        ['pending', 'running'].includes(
            String(backup.status || '').toLowerCase()
        )
    );
}

function stopBackupPolling() {
    if (backupPollTimer) {
        clearInterval(backupPollTimer);
        backupPollTimer = null;
    }
}

function syncBackupPolling() {
    if (hasActiveBackup()) {
        if (backupPollTimer) return;

        backupPollTimer = setInterval(() => {
            loadBackupHistory({ silent: true });
        }, BACKUP_POLL_INTERVAL);

        return;
    }

    stopBackupPolling();
}

async function loadBackupHistory({ silent = false } = {}) {
    if (backupPollInFlight) return;

    backupPollInFlight = true;

    if (!silent) {
        backupLoading = true;
        backupLoadError = '';
        render();
    }

    try {
        const { data, error } = await supabase
            .from('system_backup_logs')
            .select(`
                id,
                backup_type,
                status,
                database_status,
                storage_status,
                workflow_run_url,
                workflow_run_id,
                artifact_name,
                database_file_name,
                storage_archive_name,
                database_size_bytes,
                storage_size_bytes,
                total_size_bytes,
                error_message,
                started_at,
                completed_at,
                created_at
            `)
            .order('created_at', { ascending: false })
            .limit(10);

        if (error) throw error;

        backupHistory = data || [];
        backupLoadError = '';

    } catch (error) {
        console.error('Failed to load backup history:', error);

        if (!silent) {
            backupLoadError = error.message || 'Failed to load backup history.';
        }

    } finally {
        backupPollInFlight = false;

        if (!silent) {
            backupLoading = false;
        }

        render();
        syncBackupPolling();
    }
}

async function createSystemBackup() {
    if (backupCreating) return;

    backupCreating = true;
    render();

    try {
        const { data, error } = await supabase.functions.invoke(
            'admin-system-backup',
            {
                body: {
                    backupType: 'manual',
                },
            }
        );

        if (error) {
            throw new Error(
                error.message || 'Could not start the backup workflow.'
            );
        }

        if (!data?.success || !data?.backupId) {
            throw new Error(
                data?.error || 'The backup service returned an unexpected response.'
            );
        }

        toast('Backup successfully queued.');

        await loadBackupHistory();
        syncBackupPolling();

    } catch (error) {
        console.error('Failed to create system backup:', error);
        toast(error.message || 'Failed to create system backup.');

    } finally {
        backupCreating = false;
        render();
    }
}

function showBackupDownloadModal() {
    hideBackupDownloadModal();

    const modal = document.createElement('div');
    modal.id = 'backup-download-modal';
    modal.className = 'backup-download-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'backup-download-modal-title');

    const card = document.createElement('div');
    card.className = 'backup-download-modal-card';

    const spinner = document.createElement('div');
    spinner.className = 'backup-download-spinner';
    spinner.setAttribute('aria-hidden', 'true');

    const title = document.createElement('h3');
    title.id = 'backup-download-modal-title';
    title.textContent = 'Preparing Backup Download';

    const message = document.createElement('p');
    message.textContent =
        'Please wait while Tanikala retrieves and verifies your backup ZIP file. Do not close this page.';

    card.append(spinner, title, message);
    modal.appendChild(card);
    document.body.appendChild(modal);
}

function hideBackupDownloadModal() {
    document.getElementById('backup-download-modal')?.remove();
}

// ----------------------------------------
// DOWNLOAD COMPLETED BACKUP
// ----------------------------------------

async function downloadSystemBackup(backup) {
    if (backupDownloadingId) return;

    if (
        String(backup.status || '').toLowerCase() !== 'completed'
        || !backup.workflow_run_id
        || !backup.artifact_name
    ) {
        toast('This backup is not available for download.');
        return;
    }

    backupDownloadingId = backup.id;
    render();
    showBackupDownloadModal();

    try {
        const {
            data: sessionData,
            error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) throw sessionError;

        const accessToken = sessionData?.session?.access_token;

        if (!accessToken) {
            throw new Error('Your session has expired. Please sign in again.');
        }

        const response = await fetch(
            `${supabase.supabaseUrl}/functions/v1/admin-system-backup`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${accessToken}`,
                    'apikey': supabase.supabaseKey,
                },
                body: JSON.stringify({
                    action: 'download',
                    backupId: backup.id,
                }),
            }
        );

        if (!response.ok) {
            const responseText = await response.text();

            let errorMessage = `Download failed (${response.status}).`;

            try {
                const errorData = JSON.parse(responseText);
                errorMessage = errorData.error
                    || errorData.message
                    || errorMessage;
            } catch {
                if (responseText) {
                    errorMessage = responseText.slice(0, 500);
                }
            }

            throw new Error(errorMessage);
        }

        const blob = await response.blob();

        if (!blob || blob.size === 0) {
            throw new Error('The downloaded backup file is empty.');
        }

        const signature = new Uint8Array(
            await blob.slice(0, 4).arrayBuffer()
        );

        if (
            signature.length < 4
            || signature[0] !== 0x50
            || signature[1] !== 0x4B
        ) {
            throw new Error(
                'The server response is not a valid ZIP archive. Check the Edge Function download response.'
            );
        }

        const filename = `tanikala-system-backup-${backup.id}.zip`;
        const downloadBlob = new Blob(
            [blob],
            { type: 'application/zip' }
        );

        const downloadUrl = URL.createObjectURL(downloadBlob);

        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = filename;

        document.body.appendChild(link);
        link.click();
        link.remove();

        setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);

        toast('Backup download started.');

    } catch (error) {
        console.error('Backup download failed:', error);
        toast(error.message || 'Failed to download system backup.');

    } finally {
        hideBackupDownloadModal();
        backupDownloadingId = null;
        render();
    }
}

function renderBackupHistoryItem(backup) {
    const statusClass = getBackupStatusClass(backup.status);
    const isActive = ['pending', 'running'].includes(
        String(backup.status || '').toLowerCase()
    );

    const isCompleted =
        String(backup.status || '').toLowerCase() === 'completed';

    const isDownloading = backupDownloadingId === backup.id;

    const details = h(
        'div',
        { class: 'backup-history-details' },

        h(
            'div',
            {},
            h('strong', {}, formatBackupStatus(backup.status)),
            h(
                'small',
                {},
                `${String(backup.backup_type || 'manual').toUpperCase()} backup`
            )
        ),

        h(
            'div',
            {},
            h('strong', {}, formatBackupDate(backup.created_at)),
            h(
                'small',
                {},
                `Database: ${formatBackupStatus(backup.database_status)} · Storage: ${formatBackupStatus(backup.storage_status)}`
            )
        ),

        h(
            'div',
            {},
            h('strong', {}, formatBackupSize(backup.total_size_bytes)),
            h('small', {}, 'Total backup size')
        )
    );

    const links = [];

    if (isCompleted && backup.workflow_run_id && backup.artifact_name) {
        links.push(
            h(
                'button',
                {
                    type: 'button',
                    class: 'btn btn-primary backup-download-button',
                    disabled: Boolean(backupDownloadingId),
                    onclick: () => downloadSystemBackup(backup),
                },
                isDownloading ? 'Preparing Download...' : 'Download Backup'
            )
        );
    }

    if (backup.workflow_run_url) {
        links.push(
            h(
                'a',
                {
                    href: backup.workflow_run_url,
                    target: '_blank',
                    rel: 'noopener noreferrer',
                    class: 'backup-history-link',
                },
                'View GitHub Actions run'
            )
        );
    }

    if (backup.error_message) {
        links.push(
            h(
                'small',
                { class: 'backup-history-error' },
                backup.error_message
            )
        );
    }

    return h(
        'div',
        { class: 'backup-history-item' },

        h(
            'div',
            { class: 'backup-history-heading' },
            h(
                'strong',
                {},
                `Backup ${String(backup.id).slice(0, 8)}`
            ),
            h(
                'span',
                { class: `backup-status ${statusClass}` },
                formatBackupStatus(backup.status)
            )
        ),

        isActive
            ? h(
                'div',
                { class: 'backup-progress-indicator' },
                h('span', { class: 'backup-spinner' }),
                h(
                    'span',
                    {},
                    'Backup is in progress. Status updates automatically.'
                )
            )
            : null,

        details,

        h(
            'div',
            { class: 'backup-history-components' },
            h(
                'span',
                {},
                `Database: ${formatBackupSize(backup.database_size_bytes)}`
            ),
            h(
                'span',
                {},
                `Storage: ${formatBackupSize(backup.storage_size_bytes)}`
            )
        ),

        ...links
    );
}

// ----------------------------------------
// EXISTING PERMISSION RENDERING
// ----------------------------------------

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
        ),

        renderBackupSection()
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

        for (const [roleKey, permissionSet] of Object.entries(ROLE_PERMISSIONS)) {
            ROLE_PERMISSIONS[roleKey] = new Set(
                [...permissionSet].filter((key) =>
                    catalog.some((item) => item.permission_key === key)
                )
            );
        }

        loading = false;
        render();

        await Promise.all([
            loadAccounts(),
            loadBackupHistory(),
            loadBackupSchedule(),
        ]);

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

// ----------------------------------------
// SYSTEM BACKUP SECTION
// ----------------------------------------

function renderBackupSection() {
    const latestBackup = backupHistory[0] || null;

    const latestStatus = latestBackup
        ? formatBackupStatus(latestBackup.status)
        : backupLoading
            ? 'Loading...'
            : 'No backup yet';

    const latestDate = latestBackup
        ? formatBackupDate(latestBackup.created_at)
        : 'No backup records available';

    const statusClass = latestBackup
        ? getBackupStatusClass(latestBackup.status)
        : 'pending';

    const latestIsActive = latestBackup
        && ['pending', 'running'].includes(
            String(latestBackup.status || '').toLowerCase()
        );

    const historyContent = backupLoading
        ? h(
            'div',
            { class: 'backup-history-empty' },
            'Loading backup history...'
        )
        : backupLoadError
            ? h(
                'div',
                { class: 'backup-history-empty' },
                backupLoadError
            )
            : backupHistory.length > 0
                ? h(
                    'div',
                    { class: 'backup-history-list' },
                    ...backupHistory.map(renderBackupHistoryItem)
                )
                : h(
                    'div',
                    { class: 'backup-history-empty' },
                    'No backup history available yet.'
                );

    const scheduleTimeInput = h('input', {
        type: 'time',
        class: 'form-control',
        value: backupSchedule.backup_time,
        disabled: backupScheduleLoading || backupScheduleSaving || !backupScheduleLoaded,
        'data-backup-schedule': 'backup_time',
        oninput: (event) => {
            backupSchedule.backup_time = event.target.value;
        },
    });

    const scheduleTimezoneInput = h('input', {
        type: 'text',
        class: 'form-control',
        value: backupSchedule.timezone,
        placeholder: 'Asia/Manila',
        disabled: backupScheduleLoading || backupScheduleSaving || !backupScheduleLoaded,
        'data-backup-schedule': 'timezone',
        oninput: (event) => {
            backupSchedule.timezone = event.target.value;
        },
    });

    const scheduleEnabledInput = h('input', {
        type: 'checkbox',
        checked: backupSchedule.enabled,
        disabled: backupScheduleLoading || backupScheduleSaving || !backupScheduleLoaded,
        'data-backup-schedule': 'enabled',
        onchange: (event) => {
            backupSchedule.enabled = event.target.checked;
            render();
        },
    });

    return h(
        'section',
        { class: 'system-backup' },

        h(
            'div',
            { class: 'system-backup-header' },
            h(
                'div',
                {},
                h('h2', {}, 'System Backup & Recovery'),
                h(
                    'p',
                    {},
                    'Manage system backups and recovery operations to protect Tanikala data.'
                )
            ),
            h(
                'span',
                { class: `backup-status ${statusClass}` },
                latestStatus
            )
        ),

        latestIsActive
            ? h(
                'div',
                { class: 'backup-active-notice' },
                h('span', { class: 'backup-spinner' }),
                h(
                    'div',
                    {},
                    h('strong', {}, 'System backup is in progress'),
                    h(
                        'small',
                        {},
                        'Backup status refreshes automatically. Please wait while the database and uploaded files are being backed up.'
                    )
                )
            )
            : null,

        h(
            'div',
            { class: 'backup-overview' },

            h(
                'div',
                { class: 'backup-overview-card' },
                h('span', {}, 'Latest Backup'),
                h('strong', {}, latestDate),
                h(
                    'small',
                    {},
                    latestBackup
                        ? `Backup ID: ${String(latestBackup.id).slice(0, 8)}`
                        : 'No completed backup information yet'
                )
            ),

            h(
                'div',
                { class: 'backup-overview-card' },
                h('span', {}, 'Backup Status'),
                h('strong', {}, latestStatus),
                h(
                    'small',
                    {},
                    latestBackup
                        ? `Database: ${formatBackupStatus(latestBackup.database_status)} · Storage: ${formatBackupStatus(latestBackup.storage_status)}`
                        : 'Backup service connected'
                )
            ),

            h(
                'div',
                { class: 'backup-overview-card' },
                h('span', {}, 'Latest Backup Size'),
                h(
                    'strong',
                    {},
                    latestBackup
                        ? formatBackupSize(latestBackup.total_size_bytes)
                        : 'Not available'
                ),
                h(
                    'small',
                    {},
                    latestBackup
                        ? `Database: ${formatBackupSize(latestBackup.database_size_bytes)} · Storage: ${formatBackupSize(latestBackup.storage_size_bytes)}`
                        : 'No backup size available'
                )
            )
        ),

        h(
            'div',
            { class: 'backup-panel' },
            h('h3', {}, 'Create System Backup'),
            h(
                'p',
                {},
                'Create a protected copy of Tanikala database records and uploaded files.'
            ),
            h(
                'button',
                {
                    type: 'button',
                    class: 'btn btn-primary',
                    disabled: backupCreating || backupLoading || latestIsActive,
                    onclick: createSystemBackup,
                },
                backupCreating
                    ? 'Starting Backup...'
                    : latestIsActive
                        ? 'Backup in Progress...'
                        : 'Create Backup'
            ),
            h(
                'small',
                { class: 'backup-note' },
                'The backup will run securely through the configured GitHub Actions workflow. You can monitor its progress in Backup History.'
            )
        ),

        h(
            'div',
            { class: 'backup-panel' },
            h('h3', {}, 'Automatic Backup Schedule'),
            h(
                'p',
                {},
                'Configure the daily automatic backup time. The scheduler checks this setting every minute.'
            ),

            backupScheduleLoading
                ? h(
                    'p',
                    { class: 'backup-note' },
                    'Loading automatic backup settings...'
                )
                : null,

            h(
                'div',
                { class: 'backup-schedule-controls' },

                h(
                    'label',
                    { class: 'backup-schedule-toggle' },
                    scheduleEnabledInput,
                    'Enable automatic daily backup'
                ),

                h(
                    'div',
                    { class: 'backup-schedule-field' },
                    h('label', {}, 'Daily Backup Time'),
                    scheduleTimeInput
                ),

                h(
                    'div',
                    { class: 'backup-schedule-field' },
                    h('label', {}, 'Timezone'),
                    scheduleTimezoneInput
                ),

                h(
                    'button',
                    {
                        type: 'button',
                        class: 'btn btn-primary',
                        disabled:
                            backupScheduleLoading
                            || backupScheduleSaving
                            || !backupScheduleLoaded,
                        onclick: saveBackupSchedule,
                    },
                    backupScheduleSaving
                        ? 'Saving Schedule...'
                        : 'Save Schedule'
                )
            ),

            h(
                'small',
                { class: 'backup-note' },
                'The automatic scheduler uses the saved time and timezone. Disabling this option stops future automatic backups without affecting manual backups.'
            )
        ),

        h(
            'div',
            { class: 'backup-panel' },
            h(
                'div',
                { class: 'backup-history-header' },
                h(
                    'div',
                    {},
                    h('h3', {}, 'Backup History'),
                    h(
                        'p',
                        {},
                        'Review previous backup operations and their status.'
                    )
                ),
                h(
                    'button',
                    {
                        type: 'button',
                        class: 'btn btn-secondary',
                        disabled: backupLoading,
                        onclick: loadBackupHistory,
                    },
                    backupLoading ? 'Refreshing...' : 'Refresh'
                )
            ),
            historyContent
        ),

        h(
            'div',
            { class: 'backup-panel backup-recovery-panel' },
            h('h3', {}, 'System Recovery'),
            h(
                'p',
                {},
                'Restore Tanikala data from a previously created backup.'
            ),
            h(
                'div',
                { class: 'backup-warning' },
                'Recovery is currently unavailable. Restoring a backup can overwrite existing system data and must only be performed through a verified recovery process.'
            ),
            h(
                'button',
                {
                    type: 'button',
                    class: 'btn btn-danger',
                    disabled: true,
                },
                'Restore Backup'
            )
        )
    );
}

async function renderView(viewRoot) {
    stopBackupPolling();

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

    backupHistory = [];
    backupLoading = false;
    backupCreating = false;
    backupDownloadingId = null;
    backupLoadError = '';
    backupPollInFlight = false;

    backupSchedule = {
        enabled: false,
        backup_time: '02:00:00',
        timezone: 'Asia/Manila',
    };
    backupScheduleLoading = false;
    backupScheduleSaving = false;
    backupScheduleLoaded = false;

    loadRequestId++;
    accountRequestId++;

    await init();
}

export { renderView as render };
