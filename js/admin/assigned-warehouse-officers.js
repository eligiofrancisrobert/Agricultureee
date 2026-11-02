
import { supabase } from '../connection.js';

const WAREHOUSE_OFFICER_ROLE_ID = 2;

const tbody = document.getElementById('assignedOfficersBody');
const searchInput = document.getElementById('officerSearch');
const assignmentFilter = document.getElementById('assignmentFilter');

const dialog = document.getElementById('farmAssignmentDialog');
const form = document.getElementById('farmAssignmentForm');
const officerSelect = document.getElementById('officerSelect');
const farmSelect = document.getElementById('farmSelect');

const message = document.getElementById('assignmentMessage');
const assignButton = document.getElementById('assignFarmBtn');
const cancelButton = document.getElementById('cancelFarmAssignment');

let allOfficers = [];
let assignments = [];
let farms = [];
let staffNames = new Map();
let adminStaffId = null;
let loading = false;

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

function getAssignment(officerId) {
    return assignments.find(
        (assignment) => assignment.staff_id === officerId
    );
}

function getFarm(farmId) {
    return farms.find((farm) => farm.id === farmId);
}

function getOfficer(officerId) {
    return allOfficers.find(
        (officer) => officer.staff_id === officerId
    );
}

function render() {
    const query = searchInput.value.trim().toLowerCase();
    const filter = assignmentFilter.value;

    const rows = allOfficers.filter((officer) => {
        const assignment = getAssignment(officer.staff_id);
        const farm = assignment
            ? getFarm(assignment.farm_id)
            : null;

        if (filter === 'assigned' && !assignment) return false;
        if (filter === 'unassigned' && assignment) return false;

        const searchable = [
            officer.full_name,
            officer.email,
            officer.status_name,
            farm?.farm_name,
            farm?.farm_location,
        ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

        return searchable.includes(query);
    });

    if (!rows.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6">
                    No Warehouse Officers found.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = rows.map((officer) => {
        const assignment = getAssignment(officer.staff_id);

        const farm = assignment
            ? getFarm(assignment.farm_id)
            : null;

        const farmDisplay = farm
            ? `
                <strong>${escapeHtml(farm.farm_name || 'Unnamed farm')}</strong>
                <div class="muted">
                    ${escapeHtml(farm.farm_location || '')}
                </div>
            `
            : '<span class="muted">Not assigned</span>';

        const assignedBy = assignment?.assigned_by
            ? staffNames.get(assignment.assigned_by) || 'Unknown admin'
            : 'No record';

        return `
            <tr>
                <td>
                    <strong>
                        ${escapeHtml(officer.full_name || 'Unnamed')}
                    </strong>
                    <div class="muted">
                        ${escapeHtml(officer.email || '')}
                    </div>
                </td>

                <td>${farmDisplay}</td>

                <td>${escapeHtml(assignedBy)}</td>

                <td>
                    ${escapeHtml(formatDate(assignment?.assigned_at))}
                </td>

                <td>
                    ${escapeHtml(officer.status_name || 'Unknown')}
                </td>

                <td>
                    <div class="actions">
                        <button
                            class="btn ghost"
                            type="button"
                            data-officer-id="${escapeHtml(officer.staff_id)}"
                            data-action="assign"
                        >
                            ${assignment ? 'Change Farm' : 'Assign Farm'}
                        </button>

                        ${assignment
                ? `
                                    <button
                                        class="btn ghost"
                                        type="button"
                                        data-officer-id="${escapeHtml(officer.staff_id)}"
                                        data-action="remove"
                                    >
                                        Remove
                                    </button>
                                `
                : ''
            }
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

async function loadAdminStaffId() {
    const {
        data: { user },
        error: authError
    } = await supabase.auth.getUser();

    if (authError) throw authError;

    if (!user) {
        throw new Error('No authenticated user found.');
    }

    const { data, error } = await supabase
        .from('staff_accounts')
        .select('staff_id')
        .eq('user_id', user.id)
        .maybeSingle();

    if (error) {
        throw error;
    }

    // Admin may not have a corresponding staff account.
    // assigned_by accepts NULL.
    adminStaffId = data?.staff_id ?? null;

    return adminStaffId;
}

async function loadOfficers() {
    const { data, error } = await supabase
        .from('staff_accounts')
        .select(`
            staff_id,
            full_name,
            email,
            role_id,
            status_id,
            staff_roles(role_name),
            account_statuses(status_name)
        `)
        .eq('role_id', WAREHOUSE_OFFICER_ROLE_ID)
        .order('full_name');

    if (error) throw error;

    allOfficers = (data || []).map((row) => ({
        staff_id: row.staff_id,
        full_name: row.full_name,
        email: row.email,
        status_id: row.status_id,
        role_name: row.staff_roles?.role_name || 'Warehouse Officer',
        status_name: row.account_statuses?.status_name || 'Unknown',
    }));

    console.log('Loaded Warehouse Officers:', allOfficers);
}

async function loadFarms() {
    const { data, error } = await supabase
        .from('farmer_farms')
        .select('id, farm_name, farm_location, farm_status')
        .order('farm_name');

    if (error) throw error;

    farms = data || [];

    console.log('Loaded farms:', farms);
}

async function loadAssignments() {
    const { data, error } = await supabase
        .from('warehouse_officer_farm_assignments')
        .select(`
            assignment_id,
            staff_id,
            farm_id,
            assigned_by,
            assigned_at,
            updated_at
        `)
        .order('assigned_at', { ascending: false });

    if (error) throw error;

    assignments = data || [];
}

async function loadAssignedByNames() {
    staffNames = new Map();

    const assignedByIds = [
        ...new Set(
            assignments
                .map((assignment) => assignment.assigned_by)
                .filter(Boolean)
        ),
    ];

    if (!assignedByIds.length) return;

    const { data, error } = await supabase
        .from('staff_accounts')
        .select('staff_id, full_name, email')
        .in('staff_id', assignedByIds);

    if (error) throw error;

    for (const staff of data || []) {
        staffNames.set(
            staff.staff_id,
            staff.full_name || staff.email || 'Admin'
        );
    }
}

function populateDropdowns() {
    officerSelect.innerHTML = `
        <option value="">Select a Warehouse Officer</option>

        ${allOfficers.map((officer) => `
            <option value="${escapeHtml(officer.staff_id)}">
                ${escapeHtml(
        officer.full_name || officer.email || 'Unnamed'
    )}
            </option>
        `).join('')}
    `;

    farmSelect.innerHTML = `
        <option value="">Select a farm</option>

        ${farms.map((farm) => `
            <option value="${escapeHtml(farm.id)}">
                ${escapeHtml(farm.farm_name || 'Unnamed farm')}
                — ${escapeHtml(farm.farm_location || 'No location')}
            </option>
        `).join('')}
    `;
}

async function loadData() {
    if (loading) return;

    loading = true;

    tbody.innerHTML = `
        <tr>
            <td colspan="6">Loading assignments...</td>
        </tr>
    `;

    try {
        await loadAdminStaffId();

        // Load officers directly using role_id = 2.
        await loadOfficers();

        // Load farms using farmer_farms.id.
        await loadFarms();

        // Load assignments.
        await loadAssignments();

        // Resolve the admin names in the assignment audit records.
        await loadAssignedByNames();

        populateDropdowns();
        render();

        showMessage('');
    } catch (error) {
        console.error(
            'Failed to load Warehouse Officer assignments:',
            error
        );

        tbody.innerHTML = `
            <tr>
                <td colspan="6">
                    Could not load Warehouse Officers or farm assignments.
                    Check the browser console for details.
                </td>
            </tr>
        `;

        showMessage(
            error.message || 'Failed to load assignment data.',
            true
        );
    } finally {
        loading = false;
    }
}

function openDialog(officerId = '') {
    form.reset();

    officerSelect.value = officerId;

    const assignment = officerId
        ? getAssignment(officerId)
        : null;

    farmSelect.value = assignment?.farm_id || '';

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

// Handle assignment and removal actions.
tbody.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');

    if (!button) return;

    const officerId = button.dataset.officerId;
    const action = button.dataset.action;

    if (action === 'assign') {
        openDialog(officerId);
        return;
    }

    if (action !== 'remove') return;

    const officer = getOfficer(officerId);
    const assignment = getAssignment(officerId);

    if (!officer || !assignment) return;

    const farm = getFarm(assignment.farm_id);

    const confirmed = window.confirm(
        `Remove ${officer.full_name} from ` +
        `"${farm?.farm_name || 'the assigned farm'}"?\n\n` +
        'The Warehouse Officer account and farm records will not be deleted.'
    );

    if (!confirmed) return;

    button.disabled = true;
    button.textContent = 'Removing...';

    try {
        const { data, error } = await supabase
            .from('warehouse_officer_farm_assignments')
            .delete()
            .eq('staff_id', officerId)
            .select('assignment_id');

        if (error) throw error;

        if (!data?.length) {
            throw new Error(
                'Assignment was not removed. Check the admin DELETE RLS policy.'
            );
        }

        await loadData();

        showMessage(
            `${officer.full_name} has been removed from the farm assignment.`
        );
    } catch (error) {
        console.error(
            'Remove Warehouse Officer assignment failed:',
            error
        );

        showMessage(
            error.message || 'Failed to remove assignment.',
            true
        );

        await loadData();
    }
});

// Search and filter.
searchInput.addEventListener('input', render);
assignmentFilter.addEventListener('change', render);

// Save or change farm assignment.
form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const officerId = officerSelect.value;
    const farmId = farmSelect.value;

    if (!officerId || !farmId) {
        showMessage(
            'Select a Warehouse Officer and a farm.',
            true
        );
        return;
    }

    const officer = getOfficer(officerId);

    if (!officer) {
        showMessage(
            'The selected Warehouse Officer could not be found.',
            true
        );
        return;
    }

    const selectedFarm = getFarm(farmId);

    if (!selectedFarm) {
        showMessage(
            'The selected farm could not be found.',
            true
        );
        return;
    }

    const submitButton = form.querySelector('[type="submit"]');

    submitButton.disabled = true;
    submitButton.textContent = 'Saving...';

    try {
        const now = new Date().toISOString();

        // staff_id is UNIQUE.
        // Existing officer assignment is updated automatically.
        const { error } = await supabase
            .from('warehouse_officer_farm_assignments')
            .upsert({
                staff_id: officerId,
                farm_id: farmId,
                assigned_by: adminStaffId,
                assigned_at: now,
                updated_at: now,
            }, {
                onConflict: 'staff_id',
            });

        if (error) throw error;

        dialog.close();

        await loadData();

        showMessage(
            `Farm assignment saved for ${officer.full_name}.`
        );
    } catch (error) {
        console.error(
            'Failed to save Warehouse Officer assignment:',
            error
        );

        showMessage(
            error.message || 'Failed to save the farm assignment.',
            true
        );
    } finally {
        submitButton.disabled = false;
        submitButton.innerHTML = `
            <span>Save Assignment</span>
            <span class="button-arrow">→</span>
        `;
    }
});

await loadData();
