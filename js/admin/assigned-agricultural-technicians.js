
import { supabase } from '../connection.js';

const TECHNICIAN_ROLE_ID = 3;
const MAX_ACTIVE_FARMS = 3;
const TABLE = 'agricultural_technician_farm_assignments';

const tbody = document.getElementById('assignedTechniciansBody');
const search = document.getElementById('technicianSearch');
const filter = document.getElementById('assignmentFilter');

const dialog = document.getElementById('farmAssignmentDialog');
const form = document.getElementById('farmAssignmentForm');
const technicianSelect = document.getElementById('technicianSelect');
const farmOptions = document.getElementById('farmOptions');
const message = document.getElementById('assignmentMessage');

let technicians = [];
let assignments = [];
let farms = [];
let adminNames = new Map();
let currentAdminId = null;

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
})[char]);

const formatDate = value => {
    if (!value) return 'No record';

    const date = new Date(value);

    return Number.isNaN(date.getTime())
        ? 'No record'
        : date.toLocaleDateString('en-PH', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
};

const getTechnician = id =>
    technicians.find(technician => technician.staff_id === id);

const getFarm = id =>
    farms.find(farm => farm.id === id);

const getActiveAssignments = technicianId =>
    assignments.filter(assignment =>
        assignment.technician_staff_id === technicianId &&
        assignment.assignment_status === 'active'
    );

function showMessage(text = '', error = false) {
    message.textContent = text;
    message.className = error ? 'msg error' : 'msg';
}

function getAssignedFarmIds(technicianId) {
    return new Set(
        getActiveAssignments(technicianId).map(assignment => assignment.farm_id)
    );
}

/** Load active technicians, farms, assignments, and assignment administrators. */

async function loadData() {
    tbody.innerHTML = '<tr><td colspan="6">Loading assignments...</td></tr>';

    try {
        const { data: authData, error: authError } =
            await supabase.auth.getUser();

        if (authError) throw authError;

        const user = authData?.user;

        if (!user) {
            throw new Error('No authenticated user found.');
        }

        // Verify admin profile for assigned_by FK.
        const { data: adminProfile, error: profileError } =
            await supabase.from('profiles')
                .select('id')
                .eq('id', user.id)
                .maybeSingle();

        if (profileError) throw profileError;

        if (!adminProfile) {
            throw new Error(
                'Admin profile was not found. Cannot record farm assignments.'
            );
        }

        currentAdminId = adminProfile.id;

        // Load all Agricultural Technician staff accounts directly.
        const [
            staffResult,
            technicianDetailsResult,
            farmResult,
            assignmentResult
        ] = await Promise.all([
            supabase.from('staff_accounts')
                .select(`
                    staff_id,
                    full_name,
                    email,
                    role_id,
                    status_id,
                    account_statuses (
                        status_name
                    )
                `)
                .eq('role_id', TECHNICIAN_ROLE_ID)
                .order('full_name'),

            supabase.from('agricultural_technician_details')
                .select('staff_id'),

            supabase.from('farmer_farms')
                .select('id, farm_name, farm_location, farm_status')
                .order('farm_name'),

            supabase.from(TABLE)
                .select(`
                    assignment_id,
                    technician_staff_id,
                    farm_id,
                    assigned_by,
                    assigned_at,
                    unassigned_at,
                    assignment_status
                `)
                .order('assigned_at', { ascending: false })
        ]);

        for (const result of [
            staffResult,
            technicianDetailsResult,
            farmResult,
            assignmentResult
        ]) {
            if (result.error) throw result.error;
        }

        // Keep every role 3 account visible.
        technicians = staffResult.data || [];

        // Check which staff accounts have technician detail records.
        const technicianDetailIds = new Set(
            (technicianDetailsResult.data || [])
                .map(item => item.staff_id)
        );

        // Retain assignment eligibility information.
        technicians = technicians.map(technician => ({
            ...technician,
            hasTechnicianDetails: technicianDetailIds.has(
                technician.staff_id
            )
        }));

        farms = farmResult.data || [];
        assignments = assignmentResult.data || [];

        // Load only admin profile IDs to avoid depending on
        // optional/nonexistent profile name columns.
        const adminIds = [
            ...new Set(
                assignments
                    .map(item => item.assigned_by)
                    .filter(Boolean)
            )
        ];

        const { data: admins, error: adminError } = adminIds.length
            ? await supabase.from('profiles')
                .select('id')
                .in('id', adminIds)
            : { data: [], error: null };

        if (adminError) throw adminError;

        adminNames = new Map(
            (admins || []).map(admin => [
                admin.id,
                'Admin'
            ])
        );

        render();
        populateTechnicians();

        showMessage();

        console.log('Agricultural Technicians loaded:', technicians);
        console.log('Technician details found:', technicianDetailIds.size);
        console.log('Farm assignments loaded:', assignments.length);

    } catch (error) {
        console.error('Load Agricultural Technician assignments:', error);

        tbody.innerHTML =
            '<tr><td colspan="6">Failed to load assignments.</td></tr>';

        showMessage(
            error.message || 'Failed to load assignments.',
            true
        );
    }
}


/** Render each technician and all of their active farm assignments. */
function render() {
    const query = search.value.trim().toLowerCase();

    const rows = technicians.filter(technician => {
        const activeAssignments = getActiveAssignments(technician.staff_id);

        if (filter.value === 'assigned' && !activeAssignments.length) {
            return false;
        }

        if (filter.value === 'unassigned' && activeAssignments.length) {
            return false;
        }

        const assignedFarms = activeAssignments
            .map(assignment => getFarm(assignment.farm_id))
            .filter(Boolean);

        return [
            technician.full_name,
            technician.email,
            technician.account_statuses?.status_name,
            ...assignedFarms.map(farm => farm.farm_name),
            ...assignedFarms.map(farm => farm.farm_location)
        ].filter(Boolean).join(' ').toLowerCase().includes(query);
    });

    tbody.innerHTML = rows.length ? rows.map(technician => {
        const activeAssignments =
            getActiveAssignments(technician.staff_id);

        const latestAssignment = activeAssignments
            .slice()
            .sort((a, b) =>
                new Date(b.assigned_at) - new Date(a.assigned_at)
            )[0];

        const assignedFarmHtml = activeAssignments.length
            ? activeAssignments.map(assignment => {
                const farm = getFarm(assignment.farm_id);

                if (!farm) return '';

                return `
                    <div class="assigned-farm-item">
                        <strong>${escapeHtml(farm.farm_name)}</strong>
                        <div class="muted">
                            ${escapeHtml(farm.farm_location || 'No location')}
                        </div>
                        <div class="muted">
                            Assigned: ${formatDate(assignment.assigned_at)}
                        </div>
                        <button type="button"
                            class="btn ghost"
                            data-action="unassign"
                            data-id="${escapeHtml(assignment.assignment_id)}">
                            Unassign
                        </button>
                    </div>
                `;
            }).join('')
            : '<span class="muted">No assigned farms</span>';

        const assignedBy = latestAssignment
            ? adminNames.get(latestAssignment.assigned_by) || 'No record'
            : 'No record';

        return `
            <tr>
                <td>
                    <strong>${escapeHtml(technician.full_name || 'Unnamed')}</strong>
                    <div class="muted">${escapeHtml(technician.email)}</div>
                </td>

                <td>${assignedFarmHtml}</td>

                <td>${escapeHtml(assignedBy)}</td>

                <td>${formatDate(latestAssignment?.assigned_at)}</td>

                <td>
                    ${escapeHtml(
            technician.account_statuses?.status_name || 'Unknown'
        )}
                </td>

                <td>
                    <button type="button"
                        class="btn ghost"
                        data-action="assign"
                        data-id="${escapeHtml(technician.staff_id)}">
                        Assign More Farms
                    </button>
                </td>
            </tr>
        `;
    }).join('') : `
        <tr>
            <td colspan="6">No Agricultural Technicians found.</td>
        </tr>
    `;
}

/** Populate the technician selector. */

function populateTechnicians(selectedId = '') {
    technicianSelect.innerHTML =
        '<option value="">Select an Agricultural Technician</option>' +
        technicians.map(technician => `
            <option
                value="${escapeHtml(technician.staff_id)}"
                ${!technician.hasTechnicianDetails ? 'disabled' : ''}>
                ${escapeHtml(
            technician.full_name || technician.email || 'Unnamed'
        )}
                ${!technician.hasTechnicianDetails
                ? '(Missing technician details)'
                : ''}
            </option>
        `).join('');

    technicianSelect.value = selectedId;
    renderFarmOptions();
}


/** Render selectable farms while excluding existing active assignments. */
function renderFarmOptions() {
    const technicianId = technicianSelect.value;

    if (!technicianId) {
        farmOptions.innerHTML =
            '<p class="muted">Select a technician first.</p>';
        return;
    }

    const assignedIds = getAssignedFarmIds(technicianId);
    const activeCount = assignedIds.size;
    const remainingSlots = MAX_ACTIVE_FARMS - activeCount;

    const availableFarms = farms.filter(farm =>
        farm.farm_status !== 'inactive' &&
        farm.farm_status !== 'archived' &&
        !assignedIds.has(farm.id)
    );

    if (!availableFarms.length) {
        farmOptions.innerHTML =
            '<p class="muted">No additional farms available.</p>';
        return;
    }

    farmOptions.innerHTML = `
        <p class="muted">
            Currently assigned: ${activeCount}/${MAX_ACTIVE_FARMS}.
            Remaining slots: ${remainingSlots}.
        </p>

        ${availableFarms.map(farm => `
            <label class="farm-option">
                <input
                    type="checkbox"
                    name="farmIds"
                    value="${escapeHtml(farm.id)}"
                    ${remainingSlots <= 0 ? 'disabled' : ''}>
                <span>
                    <strong>${escapeHtml(farm.farm_name)}</strong>
                    <small>${escapeHtml(farm.farm_location || 'No location')}</small>
                </span>
            </label>
        `).join('')}
    `;

    farmOptions.querySelectorAll('input[name="farmIds"]')
        .forEach(checkbox => {
            checkbox.addEventListener('change', enforceFarmLimit);
        });
}

/** Prevent selecting more farms than the technician's remaining capacity. */
function enforceFarmLimit() {
    const technicianId = technicianSelect.value;
    const activeCount = getAssignedFarmIds(technicianId).size;
    const remainingSlots = MAX_ACTIVE_FARMS - activeCount;

    const checked = [
        ...farmOptions.querySelectorAll(
            'input[name="farmIds"]:checked'
        )
    ];

    if (checked.length > remainingSlots) {
        checked[checked.length - 1].checked = false;

        showMessage(
            `You can only assign ${remainingSlots} more farm(s) to this technician.`,
            true
        );
    } else {
        showMessage();
    }

    const unchecked = [
        ...farmOptions.querySelectorAll(
            'input[name="farmIds"]:not(:checked)'
        )
    ];

    unchecked.forEach(checkbox => {
        checkbox.disabled =
            remainingSlots <= 0 || checked.length >= remainingSlots;
    });
}

function openDialog(technicianId = '') {
    form.reset();
    showMessage();

    populateTechnicians(technicianId);
    dialog.showModal();
}

/** Open the assignment dialog for a new assignment. */
document.getElementById('assignFarmBtn')
    .addEventListener('click', () => openDialog());

document.getElementById('cancelFarmAssignment')
    .addEventListener('click', () => dialog.close());

technicianSelect.addEventListener('change', renderFarmOptions);

search.addEventListener('input', render);
filter.addEventListener('change', render);

/** Handle assignment and unassignment actions. */
tbody.addEventListener('click', async event => {
    const button = event.target.closest('[data-action]');
    if (!button) return;

    const action = button.dataset.action;
    const id = button.dataset.id;

    if (action === 'assign') {
        openDialog(id);
        return;
    }

    if (action !== 'unassign') return;

    const assignment = assignments.find(item =>
        item.assignment_id === id &&
        item.assignment_status === 'active'
    );

    if (!assignment) return;

    const technician = getTechnician(assignment.technician_staff_id);
    const farm = getFarm(assignment.farm_id);

    const technicianName =
        technician?.full_name || technician?.email || 'this technician';

    const farmName = farm?.farm_name || 'this farm';

    if (!confirm(
        `Unassign ${technicianName} from ${farmName}? The assignment history will be retained.`
    )) {
        return;
    }

    button.disabled = true;

    try {
        const { data, error } = await supabase.from(TABLE)
            .update({
                assignment_status: 'inactive',
                unassigned_at: new Date().toISOString()
            })
            .eq('assignment_id', id)
            .eq('assignment_status', 'active')
            .select('assignment_id');

        if (error) throw error;

        if (!data?.length) {
            throw new Error(
                'Could not unassign this farm. Check update permissions.'
            );
        }

        await loadData();
        showMessage('Farm assignment successfully set to inactive.');

    } catch (error) {
        console.error('Unassign farm:', error);
        await loadData();
        showMessage(
            error.message || 'Failed to unassign farm.',
            true
        );
    }
});

/** Insert additional farm assignments without replacing existing assignments. */
form.addEventListener('submit', async event => {
    event.preventDefault();

    const technicianId = technicianSelect.value;

    const selectedFarmIds = [
        ...new Set(
            [...farmOptions.querySelectorAll(
                'input[name="farmIds"]:checked'
            )].map(input => input.value)
        )
    ];

    if (!technicianId) {
        showMessage('Select an Agricultural Technician.', true);
        return;
    }

    if (!selectedFarmIds.length) {
        showMessage('Select at least one farm.', true);
        return;
    }

    const technician = getTechnician(technicianId);

    if (!technician) {
        showMessage('Selected technician was not found.', true);
        return;
    }

    if (!currentAdminId) {
        showMessage('Admin account was not verified.', true);
        return;
    }

    const currentCount = getAssignedFarmIds(technicianId).size;

    if (currentCount + selectedFarmIds.length > MAX_ACTIVE_FARMS) {
        showMessage(
            `A technician can only have ${MAX_ACTIVE_FARMS} active farm assignments.`,
            true
        );
        return;
    }

    const button = form.querySelector('[type="submit"]');
    button.disabled = true;

    try {
        const now = new Date().toISOString();

        const records = selectedFarmIds.map(farmId => ({
            technician_staff_id: technicianId,
            farm_id: farmId,
            assigned_by: currentAdminId,
            assigned_at: now,
            assignment_status: 'active'
        }));

        const { error } = await supabase.from(TABLE)
            .insert(records);

        if (error?.code === '23505') {
            throw new Error(
                'One or more selected farms are already actively assigned to this technician.'
            );
        }

        if (error) throw error;

        dialog.close();

        await loadData();

        showMessage(
            `${selectedFarmIds.length} farm assignment(s) saved successfully.`
        );

    } catch (error) {
        console.error('Save Agricultural Technician assignments:', error);

        showMessage(
            error.message || 'Failed to save farm assignments.',
            true
        );

    } finally {
        button.disabled = false;
    }
});

await loadData();
