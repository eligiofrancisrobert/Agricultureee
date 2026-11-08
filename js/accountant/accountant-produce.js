import { supabase } from '../connection.js';

const $ = (selector) => document.querySelector(selector);

const elements = {
    userName: $('#userName'),
    userInitial: $('#userInitial'),
    todayLabel: $('#todayLabel'),

    produceBody: $('#produceBody'),
    produceTableWrap: $('#produceTableWrap'),
    produceSearch: $('#produceSearch'),
    produceCount: $('#produceCount'),
    produceEmpty: $('#produceEmpty'),
    emptyTitle: $('#emptyTitle'),
    emptyMessage: $('#emptyMessage'),
    produceError: $('#produceError'),

    addPriceBtn: $('#addPriceBtn'),

    priceModal: $('#priceModal'),
    priceModalTitle: $('#priceModalTitle'),
    priceModalDescription: $('#priceModalDescription'),
    priceForm: $('#priceForm'),
    produceSelect: $('#produceSelect'),
    unitSelect: $('#unitSelect'),
    unitPriceInput: $('#unitPriceInput'),
    modalError: $('#modalError'),
    savePriceBtn: $('#savePriceBtn'),
    closePriceModal: $('#closePriceModal'),
    cancelPriceBtn: $('#cancelPriceBtn'),

    deleteModal: $('#deleteModal'),
    deleteMessage: $('#deleteMessage'),
    confirmDeleteBtn: $('#confirmDeleteBtn'),
    cancelDeleteBtn: $('#cancelDeleteBtn'),

    toastStack: $('#toastStack'),
    logoutBtn: $('#logoutBtn')
};

const peso = new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2
});

let currentStaff = null;
let assignedFarmId = null;

let availableProduce = [];
let priceRecords = [];

let editingPriceId = null;
let deletingPriceId = null;

let lastFocusedElement = null;

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    })[character]);
}

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `produce-toast ${type}`;
    toast.textContent = message;

    elements.toastStack.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));

    window.setTimeout(() => {
        toast.classList.remove('show');

        window.setTimeout(() => toast.remove(), 250);
    }, 3000);
}

function showError(message) {
    elements.produceError.textContent = message;
    elements.produceError.hidden = false;
    elements.produceTableWrap.hidden = true;
    elements.produceEmpty.hidden = true;
}

function hideError() {
    elements.produceError.hidden = true;
    elements.produceTableWrap.hidden = false;
}

function showModalError(message) {
    elements.modalError.textContent = message;
    elements.modalError.hidden = false;
}

function clearModalError() {
    elements.modalError.textContent = '';
    elements.modalError.hidden = true;
}

function setLoading() {
    elements.produceTableWrap.hidden = false;
    elements.produceEmpty.hidden = true;

    elements.produceBody.innerHTML = `
        <tr>
            <td colspan="4" class="table-message">
                Loading produce records...
            </td>
        </tr>
    `;
}

function normalizeText(value) {
    return String(value ?? '').trim();
}

function getProduceKey(cropName, unit) {
    return `${normalizeText(cropName).toLowerCase()}::${normalizeText(unit).toLowerCase()}`;
}

/* =========================================================
   PRODUCE AVAILABILITY FILTER
   ========================================================= */

function isProduceUnitPriced(cropName, unit) {
    const key = getProduceKey(cropName, unit);

    return priceRecords.some((record) =>
        getProduceKey(record.crop_name, record.unit) === key
    );
}

function getAvailableUnits(cropName, includePriced = false) {
    const crop = normalizeText(cropName).toLowerCase();

    return [...new Set(
        availableProduce
            .filter((item) =>
                normalizeText(item.crop_name).toLowerCase() === crop
            )
            .map((item) => normalizeText(item.unit))
            .filter(Boolean)
            .filter((unit) =>
                includePriced || !isProduceUnitPriced(cropName, unit)
            )
    )].sort((a, b) => a.localeCompare(b));
}

function getAvailableCropNames() {
    return [...new Set(
        availableProduce
            .map((item) => normalizeText(item.crop_name))
            .filter(Boolean)
    )]
        .filter((cropName) => getAvailableUnits(cropName).length > 0)
        .sort((a, b) => a.localeCompare(b));
}

function populateProduceSelect(selectedCrop = '', includeSelectedCrop = false) {
    const cropNames = getAvailableCropNames();

    // Keep the current produce selectable while editing its existing price.
    if (includeSelectedCrop && selectedCrop && !cropNames.includes(selectedCrop)) {
        cropNames.push(selectedCrop);
    }

    elements.produceSelect.replaceChildren();

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select produce';
    elements.produceSelect.appendChild(placeholder);

    cropNames.forEach((cropName) => {
        const option = document.createElement('option');
        option.value = cropName;
        option.textContent = cropName;
        elements.produceSelect.appendChild(option);
    });

    elements.produceSelect.value = selectedCrop;

    populateUnitSelect(selectedCrop, '', includeSelectedCrop);
}

function populateUnitSelect(cropName, selectedUnit = '', includePriced = false) {
    elements.unitSelect.replaceChildren();

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = cropName
        ? 'Select unit'
        : 'Select produce first';

    elements.unitSelect.appendChild(placeholder);

    if (!cropName) {
        elements.unitSelect.disabled = true;
        return;
    }

    const units = getAvailableUnits(cropName, includePriced);

    units.forEach((unit) => {
        const option = document.createElement('option');
        option.value = unit;
        option.textContent = unit;
        elements.unitSelect.appendChild(option);
    });

    elements.unitSelect.disabled = units.length === 0;
    elements.unitSelect.value = selectedUnit;
}

/* =========================================================
   PRODUCE TABLE
   ========================================================= */

function renderProduce(records) {
    elements.produceBody.replaceChildren();

    elements.produceCount.textContent =
        `${records.length} ${records.length === 1 ? 'produce record' : 'produce records'}`;

    elements.produceEmpty.hidden = records.length > 0;
    elements.produceTableWrap.hidden = records.length === 0;

    if (!records.length) {
        const hasSearch = Boolean(elements.produceSearch.value.trim());

        elements.emptyTitle.textContent = hasSearch
            ? 'No matching produce found'
            : 'No produce prices yet';

        elements.emptyMessage.textContent = hasSearch
            ? 'Try another search term.'
            : 'Click Add Price to set the selling price of your farm produce.';

        return;
    }

    const fragment = document.createDocumentFragment();

    records.forEach((record) => {
        const row = document.createElement('tr');

        const nameCell = document.createElement('td');
        nameCell.className = 'produce-name';
        nameCell.textContent = record.crop_name;

        const unitCell = document.createElement('td');
        unitCell.className = 'produce-unit';
        unitCell.textContent = record.unit;

        const priceCell = document.createElement('td');
        priceCell.className = 'produce-price';
        priceCell.textContent =
            `${peso.format(Number(record.unit_price))} / ${record.unit}`;

        const actionsCell = document.createElement('td');
        actionsCell.className = 'produce-actions';

        const actionGroup = document.createElement('div');
        actionGroup.className = 'action-buttons';

        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.className = 'table-action-btn edit-action';
        editButton.setAttribute(
            'aria-label',
            `Edit price for ${record.crop_name}`
        );
        editButton.title = 'Edit Price';

        editButton.innerHTML = `
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m16 4 4 4M4 20l4-.8L19 8a2.1 2.1 0 0 0-3-3L5 16l-1 4Z"/>
            </svg>
        `;

        editButton.addEventListener('click', () => openEditModal(record));

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'table-action-btn delete-action';
        deleteButton.setAttribute(
            'aria-label',
            `Delete price for ${record.crop_name}`
        );
        deleteButton.title = 'Delete Price';

        deleteButton.innerHTML = `
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6"/>
            </svg>
        `;

        deleteButton.addEventListener('click', () => openDeleteModal(record));

        actionGroup.append(editButton, deleteButton);
        actionsCell.appendChild(actionGroup);

        row.append(nameCell, unitCell, priceCell, actionsCell);
        fragment.appendChild(row);
    });

    elements.produceBody.appendChild(fragment);
}

function filterProduce() {
    const search = elements.produceSearch.value.trim().toLowerCase();

    const filtered = priceRecords.filter((record) =>
        normalizeText(record.crop_name).toLowerCase().includes(search)
        || normalizeText(record.unit).toLowerCase().includes(search)
    );

    renderProduce(filtered);
}

/* =========================================================
   ADD PRICE MODAL
   ========================================================= */

function openAddModal() {
    editingPriceId = null;
    lastFocusedElement = document.activeElement;

    elements.priceForm.reset();
    clearModalError();

    elements.priceModalTitle.textContent = 'Add Produce Price';

    elements.priceModalDescription.textContent =
        'Set the current selling price for your farm produce.';

    elements.savePriceBtn.textContent = 'Save Price';

    populateProduceSelect();

    elements.produceSelect.disabled = false;
    elements.unitSelect.disabled = true;

    elements.priceModal.hidden = false;
    document.body.classList.add('modal-open');

    elements.produceSelect.focus();
}

/* =========================================================
   EDIT PRICE MODAL
   ========================================================= */

function openEditModal(record) {
    editingPriceId = record.price_id;
    lastFocusedElement = document.activeElement;

    elements.priceForm.reset();
    clearModalError();

    elements.priceModalTitle.textContent = 'Edit Produce Price';

    elements.priceModalDescription.textContent =
        'Update the current selling price for this produce.';

    elements.savePriceBtn.textContent = 'Update Price';

    populateProduceSelect(record.crop_name, true);
    populateUnitSelect(record.crop_name, record.unit, true);

    elements.produceSelect.disabled = true;
    elements.unitSelect.disabled = true;

    elements.unitPriceInput.value =
        Number(record.unit_price).toFixed(2);

    elements.priceModal.hidden = false;
    document.body.classList.add('modal-open');

    elements.unitPriceInput.focus();
}

function closePriceModal() {
    elements.priceModal.hidden = true;
    document.body.classList.remove('modal-open');

    editingPriceId = null;
    clearModalError();

    if (lastFocusedElement?.focus) {
        lastFocusedElement.focus();
    }
}

/* =========================================================
   DELETE PRICE MODAL
   ========================================================= */

function openDeleteModal(record) {
    deletingPriceId = record.price_id;
    lastFocusedElement = document.activeElement;

    elements.deleteMessage.textContent =
        `Are you sure you want to delete the price for ${record.crop_name} (${record.unit})?`;

    elements.deleteModal.hidden = false;
    document.body.classList.add('modal-open');

    elements.cancelDeleteBtn.focus();
}

function closeDeleteModal() {
    elements.deleteModal.hidden = true;
    document.body.classList.remove('modal-open');

    deletingPriceId = null;

    if (lastFocusedElement?.focus) {
        lastFocusedElement.focus();
    }
}

/* =========================================================
   SAVE PRICE
   ========================================================= */

async function savePrice(event) {
    event.preventDefault();
    clearModalError();

    const cropName = normalizeText(elements.produceSelect.value);
    const unit = normalizeText(elements.unitSelect.value);
    const unitPrice = Number(elements.unitPriceInput.value);

    if (!cropName || !unit) {
        showModalError('Please select a produce and unit.');
        return;
    }

    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
        showModalError('Enter a valid price greater than zero.');
        return;
    }

    const isEditing = Boolean(editingPriceId);

    const payload = {
        farm_id: assignedFarmId,
        crop_name: cropName,
        unit,
        unit_price: unitPrice,
        updated_by: currentStaff.staff_id
    };

    elements.savePriceBtn.disabled = true;
    elements.savePriceBtn.textContent = isEditing
        ? 'Updating...'
        : 'Saving...';

    try {
        let result;

        if (isEditing) {
            result = await supabase
                .from('farm_produce_prices')
                .update({
                    unit_price: unitPrice,
                    updated_by: currentStaff.staff_id
                })
                .eq('price_id', editingPriceId)
                .eq('farm_id', assignedFarmId)
                .select('price_id')
                .maybeSingle();

        } else {
            result = await supabase
                .from('farm_produce_prices')
                .insert(payload)
                .select('price_id')
                .single();
        }

        if (result.error) {
            if (result.error.code === '23505') {
                throw new Error(
                    'A price record for this produce and unit already exists. Edit the existing record instead.'
                );
            }

            throw result.error;
        }

        if (isEditing && !result.data) {
            throw new Error(
                'The price was not updated. Please check your access or refresh the page.'
            );
        }

        closePriceModal();

        showToast(
            isEditing
                ? 'Produce price updated successfully.'
                : 'Produce price added successfully.'
        );

        await loadPriceRecords();

    } catch (error) {
        console.error('Save produce price error:', error);

        showModalError(
            error.message || 'Unable to save the produce price.'
        );

    } finally {
        elements.savePriceBtn.disabled = false;

        elements.savePriceBtn.textContent = isEditing
            ? 'Update Price'
            : 'Save Price';
    }
}

/* =========================================================
   DELETE PRICE
   ========================================================= */

async function deletePrice() {
    if (!deletingPriceId) return;

    elements.confirmDeleteBtn.disabled = true;
    elements.confirmDeleteBtn.textContent = 'Deleting...';

    try {
        const { data, error } = await supabase
            .from('farm_produce_prices')
            .delete()
            .eq('price_id', deletingPriceId)
            .eq('farm_id', assignedFarmId)
            .select('price_id');

        if (error) throw error;

        if (!data?.length) {
            throw new Error(
                'The price was not deleted. Please check your access or refresh the page.'
            );
        }

        closeDeleteModal();

        showToast('Produce price deleted successfully.');

        await loadPriceRecords();

    } catch (error) {
        console.error('Delete produce price error:', error);

        showToast(
            error.message || 'Unable to delete the produce price.',
            'error'
        );

    } finally {
        elements.confirmDeleteBtn.disabled = false;
        elements.confirmDeleteBtn.textContent = 'Delete Price';
    }
}

/* =========================================================
   LOAD PRICE RECORDS
   ========================================================= */

async function loadPriceRecords() {
    const { data, error } = await supabase
        .from('farm_produce_prices')
        .select('price_id, farm_id, crop_name, unit, unit_price, updated_at')
        .eq('farm_id', assignedFarmId)
        .order('crop_name', { ascending: true });

    if (error) throw error;

    priceRecords = data || [];

    elements.addPriceBtn.disabled =
        getAvailableCropNames().length === 0;

    filterProduce();
}

/* =========================================================
   LOAD AVAILABLE PRODUCE
   ========================================================= */

async function loadAvailableProduce() {
    const { data, error } = await supabase
        .from('warehouse_produce_inventory')
        .select('crop_name, unit')
        .eq('farm_id', assignedFarmId)
        .order('crop_name', { ascending: true });

    if (error) throw error;

    const uniqueProduce = new Map();

    (data || []).forEach((item) => {
        const cropName = normalizeText(item.crop_name);
        const unit = normalizeText(item.unit);

        if (!cropName || !unit) return;

        uniqueProduce.set(getProduceKey(cropName, unit), {
            crop_name: cropName,
            unit
        });
    });

    availableProduce = [...uniqueProduce.values()];
}

/* =========================================================
   ACCOUNTANT CONTEXT
   ========================================================= */

async function loadAccountantContext() {
    const { data: authData, error: authError } =
        await supabase.auth.getUser();

    if (authError) throw authError;

    const user = authData?.user;

    if (!user) {
        throw new Error(
            'Your session has expired. Please log in again.'
        );
    }

    const { data: staff, error: staffError } = await supabase
        .from('staff_accounts')
        .select('staff_id, full_name, role_id, status_id')
        .eq('user_id', user.id)
        .maybeSingle();

    if (staffError) throw staffError;

    if (
        !staff
        || Number(staff.role_id) !== 4
        || Number(staff.status_id) !== 1
    ) {
        throw new Error('Active Accountant account not found.');
    }

    currentStaff = staff;

    elements.userName.textContent = staff.full_name || 'Accountant';

    elements.userInitial.textContent =
        (staff.full_name || 'A').trim().charAt(0).toUpperCase();

    const { data: assignment, error: assignmentError } = await supabase
        .from('accountant_farm_assignments')
        .select('farm_id')
        .eq('staff_id', staff.staff_id)
        .maybeSingle();

    if (assignmentError) throw assignmentError;

    if (!assignment?.farm_id) {
        throw new Error(
            'No farm has been assigned to your Accountant account.'
        );
    }

    assignedFarmId = assignment.farm_id;
}

/* =========================================================
   LOAD PAGE DATA
   ========================================================= */

async function loadPageData() {
    hideError();
    setLoading();

    elements.addPriceBtn.disabled = true;

    try {
        await loadAccountantContext();
        await loadAvailableProduce();
        await loadPriceRecords();

        const unpricedCropNames = getAvailableCropNames();

        elements.addPriceBtn.disabled =
            unpricedCropNames.length === 0;

        if (!unpricedCropNames.length) {
            showToast(
                'All available produce already have price records.',
                'error'
            );
        }

    } catch (error) {
        console.error('Produce records loading error:', error);

        showError(
            error.message || 'Unable to load produce records.'
        );
    }
}

/* =========================================================
   INITIALIZE PAGE
   ========================================================= */

function initializePage() {
    elements.todayLabel.textContent = new Date().toLocaleDateString(
        'en-PH',
        {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        }
    );

    elements.produceSearch.addEventListener(
        'input',
        filterProduce
    );

    elements.addPriceBtn.addEventListener(
        'click',
        openAddModal
    );

    elements.produceSelect.addEventListener('change', () => {
        populateUnitSelect(elements.produceSelect.value);
    });

    elements.priceForm.addEventListener(
        'submit',
        savePrice
    );

    elements.closePriceModal.addEventListener(
        'click',
        closePriceModal
    );

    elements.cancelPriceBtn.addEventListener(
        'click',
        closePriceModal
    );

    elements.priceModal.addEventListener('click', (event) => {
        if (event.target.matches('[data-close-modal]')) {
            closePriceModal();
        }
    });

    elements.cancelDeleteBtn.addEventListener(
        'click',
        closeDeleteModal
    );

    elements.confirmDeleteBtn.addEventListener(
        'click',
        deletePrice
    );

    elements.deleteModal.addEventListener('click', (event) => {
        if (event.target.matches('[data-close-delete]')) {
            closeDeleteModal();
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;

        if (!elements.priceModal.hidden) {
            closePriceModal();

        } else if (!elements.deleteModal.hidden) {
            closeDeleteModal();
        }
    });

    elements.logoutBtn.addEventListener('click', async () => {
        elements.logoutBtn.disabled = true;

        const { error } = await supabase.auth.signOut();

        if (error) {
            console.error('Logout error:', error);

            elements.logoutBtn.disabled = false;

            showToast(
                'Unable to log out. Please try again.',
                'error'
            );

            return;
        }

        window.location.reload();
    });

    loadPageData();
}

initializePage();