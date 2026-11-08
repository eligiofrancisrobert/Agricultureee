
import { supabase } from '../connection.js';

const ACCOUNTANT_ROLE_ID = 4;
const TABLE = 'accountant_farm_assignments';

const tbody = document.getElementById('assignedAccountantsBody');
const search = document.getElementById('accountantSearch');
const filter = document.getElementById('assignmentFilter');

const dialog = document.getElementById('farmAssignmentDialog');
const form = document.getElementById('farmAssignmentForm');
const accountantSelect = document.getElementById('accountantSelect');
const farmSelect = document.getElementById('farmSelect');

const message = document.getElementById('assignmentMessage');

let accountants = [];
let assignments = [];
let farms = [];
let adminNames = new Map();
let adminStaffId = null;

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

const getAssignment = id => assignments.find(a => a.staff_id === id);
const getFarm = id => farms.find(f => f.id === id);
const getAccountant = id => accountants.find(a => a.staff_id === id);

function showMessage(text = '', error = false) {
    message.textContent = text;
    message.className = error ? 'msg error' : 'msg';
}

async function loadData() {
    tbody.innerHTML = '<tr><td colspan="6">Loading assignments...</td></tr>';

    try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError) throw authError;
        if (!user) throw new Error('No authenticated user found.');

        const [admin, staff, farmData, assignmentData] = await Promise.all([
            supabase.from('staff_accounts')
                .select('staff_id')
                .eq('user_id', user.id)
                .maybeSingle(),

            supabase.from('staff_accounts')
                .select('staff_id, full_name, email, staff_roles(role_name), account_statuses(status_name)')
                .eq('role_id', ACCOUNTANT_ROLE_ID)
                .order('full_name'),

            supabase.from('farmer_farms')
                .select('id, farm_name, farm_location')
                .order('farm_name'),

            supabase.from(TABLE)
                .select('assignment_id, staff_id, farm_id, assigned_by, assigned_at')
                .order('assigned_at', { ascending: false })
        ]);

        for (const result of [admin, staff, farmData, assignmentData]) {
            if (result.error) throw result.error;
        }

        adminStaffId = admin.data?.staff_id ?? null;
        accountants = staff.data || [];
        farms = farmData.data || [];
        assignments = assignmentData.data || [];

        const adminIds = [
            ...new Set(assignments.map(a => a.assigned_by).filter(Boolean))
        ];

        const { data: admins, error: adminError } = adminIds.length
            ? await supabase.from('staff_accounts')
                .select('staff_id, full_name, email')
                .in('staff_id', adminIds)
            : { data: [], error: null };

        if (adminError) throw adminError;

        adminNames = new Map(
            (admins || []).map(a => [
                a.staff_id,
                a.full_name || a.email || 'Admin'
            ])
        );

        render();
        populateDropdowns();

        showMessage();

    } catch (error) {
        console.error('Load Accountant assignments:', error);
        tbody.innerHTML = '<tr><td colspan="6">Failed to load assignments.</td></tr>';
        showMessage(error.message || 'Failed to load assignments.', true);
    }
}

function render() {
    const query = search.value.trim().toLowerCase();

    const rows = accountants.filter(accountant => {
        const assignment = getAssignment(accountant.staff_id);
        const farm = assignment ? getFarm(assignment.farm_id) : null;

        if (filter.value === 'assigned' && !assignment) return false;
        if (filter.value === 'unassigned' && assignment) return false;

        return [
            accountant.full_name,
            accountant.email,
            accountant.account_statuses?.status_name,
            farm?.farm_name,
            farm?.farm_location
        ].filter(Boolean).join(' ').toLowerCase().includes(query);
    });

    tbody.innerHTML = rows.length ? rows.map(accountant => {
        const assignment = getAssignment(accountant.staff_id);
        const farm = assignment ? getFarm(assignment.farm_id) : null;

        return `
            <tr>
                <td>
                    <strong>${escapeHtml(accountant.full_name || 'Unnamed')}</strong>
                    <div class="muted">${escapeHtml(accountant.email)}</div>
                </td>
                <td>
                    ${farm ? `
                        <strong>${escapeHtml(farm.farm_name)}</strong>
                        <div class="muted">${escapeHtml(farm.farm_location)}</div>
                    ` : '<span class="muted">Not assigned</span>'}
                </td>
                <td>${escapeHtml(adminNames.get(assignment?.assigned_by) || 'No record')}</td>
                <td>${formatDate(assignment?.assigned_at)}</td>
                <td>${escapeHtml(accountant.account_statuses?.status_name || 'Unknown')}</td>
                <td>
                    <div class="actions">
                        <button type="button" class="btn ghost"
                            data-action="assign"
                            data-id="${escapeHtml(accountant.staff_id)}">
                            ${assignment ? 'Change Farm' : 'Assign Farm'}
                        </button>

                        ${assignment ? `
                            <button type="button" class="btn ghost"
                                data-action="remove"
                                data-id="${escapeHtml(accountant.staff_id)}">
                                Remove
                            </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('') : '<tr><td colspan="6">No Accountants found.</td></tr>';
}

function populateDropdowns(currentStaffId = '') {
    const occupied = new Set(
        assignments
            .filter(a => a.staff_id !== currentStaffId)
            .map(a => a.farm_id)
    );

    accountantSelect.innerHTML =
        '<option value="">Select an Accountant</option>' +
        accountants.map(a => `
            <option value="${escapeHtml(a.staff_id)}">
                ${escapeHtml(a.full_name || a.email)}
            </option>
        `).join('');

    farmSelect.innerHTML =
        '<option value="">Select a farm</option>' +
        farms.filter(f => !occupied.has(f.id)).map(f => `
            <option value="${escapeHtml(f.id)}">
                ${escapeHtml(f.farm_name)} — ${escapeHtml(f.farm_location)}
            </option>
        `).join('');
}

function openDialog(id = '') {
    form.reset();
    populateDropdowns(id);

    accountantSelect.value = id;
    farmSelect.value = getAssignment(id)?.farm_id || '';

    showMessage();
    dialog.showModal();
}

document.getElementById('assignFarmBtn').addEventListener('click', () => {
    openDialog();
});

document.getElementById('cancelFarmAssignment').addEventListener('click', () => {
    dialog.close();
});

accountantSelect.addEventListener('change', () => {
    const id = accountantSelect.value;

    populateDropdowns(id);
    accountantSelect.value = id;
    farmSelect.value = getAssignment(id)?.farm_id || '';
});

search.addEventListener('input', render);
filter.addEventListener('change', render);

tbody.addEventListener('click', async event => {
    const button = event.target.closest('[data-action]');
    if (!button) return;

    const id = button.dataset.id;
    const accountant = getAccountant(id);
    const assignment = getAssignment(id);

    if (button.dataset.action === 'assign') {
        openDialog(id);
        return;
    }

    if (button.dataset.action !== 'remove' || !accountant || !assignment) return;

    const farm = getFarm(assignment.farm_id);

    if (!confirm(`Remove ${accountant.full_name || accountant.email} from ${farm?.farm_name || 'this farm'}?`)) {
        return;
    }

    button.disabled = true;

    try {
        const { data, error } = await supabase.from(TABLE)
            .delete()
            .eq('staff_id', id)
            .select('assignment_id');

        if (error) throw error;
        if (!data?.length) {
            throw new Error('Could not remove assignment. Check DELETE permissions.');
        }

        await loadData();
        showMessage('Accountant assignment removed.');

    } catch (error) {
        console.error('Remove Accountant assignment:', error);
        await loadData();
        showMessage(error.message || 'Failed to remove assignment.', true);
    }
});

form.addEventListener('submit', async event => {
    event.preventDefault();

    const staffId = accountantSelect.value;
    const farmId = farmSelect.value;

    if (!staffId || !farmId) {
        showMessage('Select an Accountant and a farm.', true);
        return;
    }

    if (!adminStaffId) {
        showMessage('Your admin staff record was not found. Cannot save assignment.', true);
        return;
    }

    const button = form.querySelector('[type="submit"]');
    button.disabled = true;

    try {
        const now = new Date().toISOString();

        const { error } = await supabase.from(TABLE).upsert({
            staff_id: staffId,
            farm_id: farmId,
            assigned_by: adminStaffId,
            assigned_at: now,
            updated_at: now
        }, { onConflict: 'staff_id' });

        if (error?.code === '23505') {
            throw new Error('This farm is already assigned to another Accountant.');
        }

        if (error) throw error;

        dialog.close();
        await loadData();
        showMessage('Accountant farm assignment saved.');

    } catch (error) {
        console.error('Save Accountant assignment:', error);
        showMessage(error.message || 'Failed to save assignment.', true);

    } finally {
        button.disabled = false;
    }
});

await loadData();
