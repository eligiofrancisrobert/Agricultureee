
import { supabase } from '../connection.js';

const tbody = document.getElementById('assignedManagersBody');
const searchInput = document.getElementById('managerSearch');
const assignmentFilter = document.getElementById('assignmentFilter');
const dialog = document.getElementById('municipalityDialog');
const form = document.getElementById('municipalityForm');
const managerSelect = document.getElementById('managerSelect');
const municipalityInput = document.getElementById('municipalityInput');
const message = document.getElementById('assignmentMessage');
const assignButton = document.getElementById('assignMunicipalityBtn');
const cancelButton = document.getElementById('cancelAssignment');

let allManagers = [];
let managers = [];
let farmAssignments = [];
let farms = [];
let assignmentInfo = new Map();

function showMessage(text, error = false) {
    message.textContent = text;
    message.className = error ? 'msg error' : 'msg';
}

function escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    })[char]);
}

function getManager(managerId) {
    return allManagers.find((manager) => manager.id === managerId);
}

function getManagerFarms(managerId) {
    const farmIds = farmAssignments
        .filter((assignment) => assignment.manager_id === managerId)
        .map((assignment) => assignment.farm_id);

    return farms.filter((farm) => farmIds.includes(farm.id));
}

function formatDate(value) {
    if (!value) return 'No record';

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return 'No record';

    return date.toLocaleDateString('en-PH', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
}

/** Render assigned managers and their linked farms using the current search. */
function render() {
    const query = searchInput.value.trim().toLowerCase();

    const rows = managers.filter((manager) => {
        const location = manager.assigned_farm_location || '';

        if (!location.trim()) return false;

        const managerFarms = getManagerFarms(manager.id);

        const searchable = [
            manager.full_name,
            manager.email,
            location,
            ...managerFarms.flatMap((farm) => [
                farm.farm_name,
                farm.farm_location,
            ]),
        ].join(' ').toLowerCase();

        return searchable.includes(query);
    });

    if (!rows.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6">No assigned farm managers found.</td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = rows.map((manager) => {
        const location = manager.assigned_farm_location || '';
        const managerFarms = getManagerFarms(manager.id);
        const info = assignmentInfo.get(manager.id);

        const farmSummary = managerFarms.length
            ? `
                <strong>
                    ${managerFarms.length}
                    ${managerFarms.length === 1 ? 'farm' : 'farms'}
                </strong>
                <div class="muted">
                    ${managerFarms.map((farm) =>
                escapeHtml(farm.farm_name || 'Unnamed farm')
            ).join(', ')}
                </div>
            `
            : 'No farm assignments yet';

        return `
            <tr>
                <td>
                    <strong>${escapeHtml(manager.full_name || 'Unnamed')}</strong>
                    <div class="muted">${escapeHtml(manager.email || '')}</div>
                    <div class="muted">${escapeHtml(manager.status_name || '')}</div>
                </td>

                <td>${escapeHtml(location)}</td>

                <td>
                    ${escapeHtml(info?.assignedBy || 'No record')}
                </td>

                <td>${escapeHtml(formatDate(info?.assignedAt))}</td>

                <td>${farmSummary}</td>

                <td>
                    <div class="actions">
                        <button
                            class="btn ghost"
                            type="button"
                            data-manager-id="${escapeHtml(manager.id)}"
                            data-action="assign"
                        >
                            Change Municipality
                        </button>

                        <button
                            class="btn ghost"
                            type="button"
                            data-manager-id="${escapeHtml(manager.id)}"
                            data-action="remove-manager-farms"
                        >
                            Remove
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

/** Load manager, municipality, farm, and assignment metadata from Supabase. */
async function loadData() {
    tbody.innerHTML = `
        <tr>
            <td colspan="6">Loading assignments...</td>
        </tr>
    `;

    try {
        // 1. Load all Farm Manager accounts.
        const { data: managerRows, error: managerError } = await supabase
            .from('staff_account_overview')
            .select('staff_id, full_name, email, role_name, status_name')
            .eq('role_name', 'Farm Manager')
            .order('full_name');

        if (managerError) throw managerError;

        // 2. Load municipality assignment and its audit metadata.
        const { data: detailRows, error: detailError } = await supabase
            .from('farm_manager_details')
            .select(`
                staff_id,
                assigned_farm_location,
                municipality_assigned_by,
                municipality_assigned_at
            `);

        if (detailError) throw detailError;

        const detailsByManager = new Map(
            (detailRows || []).map((detail) => [
                detail.staff_id,
                detail,
            ])
        );

        allManagers = (managerRows || []).map((row) => {
            const detail = detailsByManager.get(row.staff_id);

            return {
                id: row.staff_id,
                full_name: row.full_name,
                email: row.email,
                status_name: row.status_name,
                assigned_farm_location:
                    detail?.assigned_farm_location || '',
                municipality_assigned_by:
                    detail?.municipality_assigned_by || null,
                municipality_assigned_at:
                    detail?.municipality_assigned_at || null,
            };
        });

        // Only managers with an assigned municipality appear in the table.
        managers = allManagers.filter(
            (manager) => manager.assigned_farm_location.trim() !== ''
        );

        // 3. Load farm assignments for the farm summary column only.
        // These records are NOT used for municipality audit information.
        const { data: assignmentRows, error: assignmentError } =
            await supabase
                .from('farm_manager_assignments')
                .select('manager_id, farm_id')
                .order('farm_id');

        if (assignmentError) throw assignmentError;

        farmAssignments = assignmentRows || [];

        // 4. Get the admin IDs from municipality assignment metadata.
        const assignedByIds = [
            ...new Set(
                allManagers
                    .map((manager) => manager.municipality_assigned_by)
                    .filter(Boolean)
            ),
        ];

        let profileRows = [];

        if (assignedByIds.length) {
            const { data, error } = await supabase
                .from('profiles')
                .select('id, full_name, email')
                .in('id', assignedByIds);

            if (error) throw error;

            profileRows = data || [];
        }

        const profilesById = new Map(
            profileRows.map((profile) => [
                profile.id,
                profile.full_name || profile.email || 'Admin',
            ])
        );

        // Municipality audit info is keyed by manager ID.
        assignmentInfo = new Map();

        for (const manager of allManagers) {
            if (
                manager.municipality_assigned_by ||
                manager.municipality_assigned_at
            ) {
                assignmentInfo.set(manager.id, {
                    assignedBy: manager.municipality_assigned_by
                        ? profilesById.get(
                            manager.municipality_assigned_by
                        ) || 'Unknown admin'
                        : 'No record',
                    assignedAt: manager.municipality_assigned_at,
                });
            }
        }

        // 5. Load farm names and locations for the table summary.
        const { data: farmRows, error: farmsError } = await supabase
            .from('farmer_farms')
            .select('id, farm_name, farm_location');

        if (farmsError) throw farmsError;

        farms = farmRows || [];

        // Include ALL managers so removed/unassigned managers can be selected.
        managerSelect.innerHTML = `
            <option value="">Select a farm manager</option>
            ${allManagers.map((manager) => `
                <option value="${escapeHtml(manager.id)}">
                    ${escapeHtml(
            manager.full_name || manager.email || 'Unnamed'
        )}
                </option>
            `).join('')}
        `;

        render();
    } catch (error) {
        console.error('Failed to load farm managers:', error);

        tbody.innerHTML = `
            <tr>
                <td colspan="6">
                    Could not load farm managers or assignments.
                    Check the console for details.
                </td>
            </tr>
        `;

        showMessage(
            error.message || 'Failed to load farm manager data.',
            true
        );
    }
}

function openDialog(managerId = '') {
    form.reset();
    managerSelect.value = managerId;

    const manager = getManager(managerId);

    municipalityInput.value =
        manager?.assigned_farm_location || '';

    showMessage('');

    if (typeof dialog.showModal === 'function') {
        dialog.showModal();
    }
}

assignButton.addEventListener('click', () => {
    openDialog();
});

cancelButton.addEventListener('click', () => {
    dialog.close();
});

// Change Municipality.
tbody.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="assign"]');

    if (!button) return;

    openDialog(button.dataset.managerId);
});

// Remove municipality assignment only.
tbody.addEventListener('click', async (event) => {
    const button = event.target.closest(
        '[data-action="remove-manager-farms"]'
    );

    if (!button) return;

    const managerId = button.dataset.managerId;
    const manager = getManager(managerId);

    if (!manager || !manager.assigned_farm_location?.trim()) {
        showMessage(
            'Could not find an active municipality assignment.',
            true
        );
        return;
    }

    const confirmed = window.confirm(
        `Remove ${manager.full_name} from ` +
        `"${manager.assigned_farm_location}"?\n\n` +
        'The manager account, farms, farmer records, and crop records ' +
        'will not be deleted.'
    );

    if (!confirmed) return;

    button.disabled = true;
    button.textContent = 'Removing...';

    try {
        const { data, error } = await supabase
            .from('farm_manager_details')
            .update({
                assigned_farm_location: null,
                municipality_assigned_by: null,
                municipality_assigned_at: null,
            })
            .eq('staff_id', managerId)
            .select('staff_id');

        if (error) throw error;

        if (!data || data.length === 0) {
            throw new Error(
                'The municipality assignment was not removed. ' +
                'Check the record and the admin UPDATE RLS policy.'
            );
        }

        await loadData();

        showMessage(
            `${manager.full_name} has been removed from the assigned municipality.`
        );
    } catch (error) {
        console.error('Remove municipality assignment failed:', error);

        showMessage(
            error.message || 'Failed to remove municipality assignment.',
            true
        );

        await loadData();
    }
});

// Search and filter events.
searchInput.addEventListener('input', render);
assignmentFilter.addEventListener('change', render);

// Save or change municipality assignment.
/** Save the selected manager's municipality assignment. */
form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const managerId = managerSelect.value;
    const location = municipalityInput.value.trim();

    if (!managerId || !location) {
        showMessage(
            'Select a farm manager and enter an assigned location.',
            true
        );
        return;
    }

    const manager = getManager(managerId);

    if (!manager) {
        showMessage(
            'The selected Farm Manager could not be found.',
            true
        );
        return;
    }

    const submitButton = form.querySelector('[type="submit"]');

    submitButton.disabled = true;
    submitButton.textContent = 'Saving...';

    try {
        // Identify the currently authenticated admin.
        const {
            data: { user },
            error: userError,
        } = await supabase.auth.getUser();

        if (userError) throw userError;

        if (!user) {
            throw new Error('Admin session not found. Please log in again.');
        }

        // Save municipality and audit metadata together.
        const { data, error } = await supabase
            .from('farm_manager_details')
            .update({
                assigned_farm_location: location,
                municipality_assigned_by: user.id,
                municipality_assigned_at: new Date().toISOString(),
            })
            .eq('staff_id', managerId)
            .select(`
                staff_id,
                assigned_farm_location,
                municipality_assigned_by,
                municipality_assigned_at
            `);

        if (error) throw error;

        if (!data || data.length === 0) {
            throw new Error(
                'No Farm Manager details record was updated. ' +
                'Check that the record exists and that your admin ' +
                'UPDATE RLS policy permits this change.'
            );
        }

        dialog.close();

        await loadData();

        showMessage(
            `Municipality assignment saved for ${manager.full_name}.`
        );
    } catch (error) {
        console.error('Failed to update assigned municipality:', error);

        showMessage(
            error.message || 'Failed to save the assigned municipality.',
            true
        );
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = 'Save Assignment';
    }
});

await loadData();
