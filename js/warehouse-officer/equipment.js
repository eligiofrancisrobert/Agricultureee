
import { supabase } from '../connection.js';

import {
    el,
    button,
    formatNumber,
    formatDateTime,
    createTable,
    createField,
    createInput,
    createSelect,
    setFormMessage,
    getCurrentUserId,
    uploadInventoryPhoto,
    deleteInventoryPhoto,
    createPhotoInput,
    closeModal,
    openModal
} from './inventory-helpers.js';

let currentRoot = null;
let currentInventory = [];
let currentPeople = [];
let currentBorrows = [];
let currentReturns = [];
let currentIncidents = [];
let isLoading = false;

// =====================================================
// GENERAL HELPERS
// =====================================================

function getPersonLabel(person) {
    return (
        person?.full_name ||
        person?.person_name ||
        person?.name ||
        person?.email ||
        'Unknown person'
    );
}

function getInventoryLabel(item) {
    return item?.tool_name || 'Unknown equipment';
}

function getOutstanding(borrow) {
    const returned = currentReturns
        .filter(record => record.borrow_id === borrow.borrow_id)
        .reduce(
            (sum, record) => sum + Number(record.quantity_returned || 0),
            0
        );

    const affected = currentIncidents
        .filter(record => record.borrow_id === borrow.borrow_id)
        .reduce(
            (sum, record) => sum + Number(record.quantity_affected || 0),
            0
        );

    return Math.max(
        0,
        Number(borrow.quantity_borrowed || 0) - returned - affected
    );
}

function getBorrowPerson(borrow) {
    return currentPeople.find(
        person => person.person_id === borrow.borrower_user_id
    );
}

function getEquipment(borrow) {
    return currentInventory.find(
        item => item.tool_id === borrow.tool_id
    );
}

function createForm(title) {
    const form = el('form', 'wo-inventory-form');
    form.append(el('h2', 'wo-inventory-form-title', title));
    return form;
}

function createMessageElement() {
    return el('p', 'wo-inventory-form-message');
}

function appendFormActions(form, message, submitLabel) {
    const actions = el('div', 'wo-inventory-form-actions');

    const cancel = button(
        'Cancel',
        'wo-btn-secondary',
        closeModal
    );

    const submit = el('button', 'wo-btn-primary', submitLabel);
    submit.type = 'submit';

    actions.append(cancel, submit);
    form.append(message, actions);

    return { submit, cancel };
}

function createPeopleOptions(people) {
    return people.map(person => ({
        value: person.person_id,
        label: getPersonLabel(person)
    }));
}

function capitalize(value = '') {
    return String(value)
        .replace(/_/g, ' ')
        .replace(/\b\w/g, char => char.toUpperCase());
}

// =====================================================
// EQUIPMENT BORROW FORM
// =====================================================

function renderEquipmentBorrowForm(item, people, onSaved) {
    const form = createForm('Borrow Equipment');
    const message = createMessageElement();

    const personSelect = createSelect(
        createPeopleOptions(people),
        'Select borrower'
    );

    const quantityInput = createInput({
        type: 'number',
        name: 'quantity_borrowed',
        min: 1,
        max: Number(item.tool_quantity || 0),
        value: 1,
        required: true
    });

    const expectedReturnInput = createInput({
        type: 'datetime-local',
        name: 'expected_return_at',
        required: true
    });

    const notesInput = createInput({
        name: 'notes',
        placeholder: 'Optional notes'
    });

    form.append(
        createField('Equipment', createInput({
            value: getInventoryLabel(item),
            disabled: true
        })),
        createField('Available Quantity', createInput({
            value: formatNumber(item.tool_quantity),
            disabled: true
        })),
        createField('Borrower', personSelect, true),
        createField('Quantity to Borrow', quantityInput, true),
        createField('Expected Return', expectedReturnInput, true),
        createField('Notes', notesInput)
    );

    const { submit } = appendFormActions(
        form,
        message,
        'Confirm Borrowing'
    );

    form.addEventListener('submit', async event => {
        event.preventDefault();

        if (submit.disabled) return;

        const quantity = Number(quantityInput.value);
        const borrowerId = personSelect.value;
        const expectedReturn = expectedReturnInput.value;

        if (!borrowerId) {
            setFormMessage(message, 'Please select a borrower.');
            return;
        }

        if (
            !Number.isInteger(quantity) ||
            quantity <= 0 ||
            quantity > Number(item.tool_quantity || 0)
        ) {
            setFormMessage(message, 'Enter a valid borrowing quantity.');
            return;
        }

        if (!expectedReturn) {
            setFormMessage(message, 'Please provide the expected return date.');
            return;
        }

        const borrowedAt = new Date();
        const expectedReturnAt = new Date(expectedReturn);

        if (
            Number.isNaN(expectedReturnAt.getTime()) ||
            expectedReturnAt.getTime() <= borrowedAt.getTime()
        ) {
            setFormMessage(
                message,
                'Expected return must be later than the current date and time.'
            );
            return;
        }

        submit.disabled = true;

        try {
            const userId = await getCurrentUserId();

            const { error } = await supabase
                .from('warehouse_equipment_borrow')
                .insert({
                    tool_id: item.tool_id,
                    borrower_user_id: borrowerId,
                    quantity_borrowed: quantity,
                    released_by: userId,
                    borrowed_at: borrowedAt.toISOString(),
                    expected_return_at: expectedReturnAt.toISOString(),
                    notes: notesInput.value.trim() || null
                });

            if (error) throw error;

            closeModal();
            await onSaved();

        } catch (error) {
            console.error('Equipment borrowing error:', error);

            setFormMessage(
                message,
                error.message || 'Unable to save borrowing record.'
            );

            submit.disabled = false;
        }
    });

    return form;
}

// =====================================================
// EQUIPMENT RETURN FORM
// =====================================================

function renderEquipmentReturnForm(borrow, remaining, people, onSaved) {
    const form = createForm('Return Equipment');
    const message = createMessageElement();

    const returnedBy = createSelect(
        createPeopleOptions(people),
        'Select borrower'
    );

    const quantityReturned = createInput({
        type: 'number',
        name: 'quantity_returned',
        min: 1,
        max: remaining,
        value: remaining,
        required: true
    });

    const quantityUsable = createInput({
        type: 'number',
        name: 'quantity_usable',
        min: 0,
        max: remaining,
        value: remaining,
        required: true
    });

    const quantityDamaged = createInput({
        type: 'number',
        name: 'quantity_damaged',
        min: 0,
        max: remaining,
        value: 0,
        required: true
    });

    const notes = createInput({
        name: 'notes',
        placeholder: 'Optional return notes'
    });

    const borrower = getBorrowPerson(borrow);

    if (borrower) {
        returnedBy.value = borrower.person_id;
    }

    form.append(
        createField('Equipment', createInput({
            value: getInventoryLabel(getEquipment(borrow)),
            disabled: true
        })),
        createField('Borrower', returnedBy, true),
        createField('Outstanding Quantity', createInput({
            value: remaining,
            disabled: true
        })),
        createField('Quantity Returned', quantityReturned, true),
        createField('Usable Quantity', quantityUsable, true),
        createField('Damaged Quantity', quantityDamaged, true),
        createField('Notes', notes)
    );

    const { submit } = appendFormActions(
        form,
        message,
        'Save Return'
    );

    function validateQuantities() {
        const returned = Number(quantityReturned.value);
        const usable = Number(quantityUsable.value);
        const damaged = Number(quantityDamaged.value);

        return (
            Number.isInteger(returned) &&
            Number.isInteger(usable) &&
            Number.isInteger(damaged) &&
            returned > 0 &&
            returned <= remaining &&
            usable >= 0 &&
            damaged >= 0 &&
            usable + damaged === returned
        );
    }

    form.addEventListener('submit', async event => {
        event.preventDefault();

        if (submit.disabled) return;

        if (!returnedBy.value) {
            setFormMessage(
                message,
                'Please select the person returning the equipment.'
            );
            return;
        }

        if (!validateQuantities()) {
            setFormMessage(
                message,
                'Usable and damaged quantities must equal the returned quantity.'
            );
            return;
        }

        submit.disabled = true;

        try {
            const userId = await getCurrentUserId();

            const { error } = await supabase
                .from('warehouse_equipment_return')
                .insert({
                    borrow_id: borrow.borrow_id,
                    returned_by: returnedBy.value,
                    received_by: userId,
                    quantity_returned: Number(quantityReturned.value),
                    quantity_usable: Number(quantityUsable.value),
                    quantity_damaged: Number(quantityDamaged.value),
                    notes: notes.value.trim() || null
                });

            if (error) throw error;

            closeModal();
            await onSaved();

        } catch (error) {
            console.error('Equipment return error:', error);

            setFormMessage(
                message,
                error.message || 'Unable to save return record.'
            );

            submit.disabled = false;
        }
    });

    return form;
}

// =====================================================
// EQUIPMENT INCIDENT FORM
// =====================================================

function renderEquipmentIncidentForm(borrow, remaining, onSaved) {
    const form = createForm('Report Equipment Incident');
    const message = createMessageElement();

    // Database constraint allows only: damaged, lost.
    const incidentType = createSelect([
        { value: 'damaged', label: 'Damaged' },
        { value: 'lost', label: 'Lost' }
    ], 'Select incident type');

    const quantityAffected = createInput({
        type: 'number',
        name: 'quantity_affected',
        min: 1,
        max: remaining,
        value: 1,
        required: true
    });

    const description = el('textarea', 'wo-inventory-textarea');
    description.name = 'description';
    description.placeholder = 'Describe the incident...';
    description.required = true;
    description.rows = 4;

    const photoInput = createPhotoInput();

    form.append(
        createField('Equipment', createInput({
            value: getInventoryLabel(getEquipment(borrow)),
            disabled: true
        })),
        createField('Outstanding Quantity', createInput({
            value: remaining,
            disabled: true
        })),
        createField('Incident Type', incidentType, true),
        createField('Quantity Affected', quantityAffected, true),
        createField('Description', description, true),
        photoInput.wrapper
    );

    const { submit } = appendFormActions(
        form,
        message,
        'Submit Incident'
    );

    form.addEventListener('submit', async event => {
        event.preventDefault();

        if (submit.disabled) return;

        const quantity = Number(quantityAffected.value);

        if (!['damaged', 'lost'].includes(incidentType.value)) {
            setFormMessage(message, 'Please select a valid incident type.');
            return;
        }

        if (
            !Number.isInteger(quantity) ||
            quantity <= 0 ||
            quantity > remaining
        ) {
            setFormMessage(message, 'Enter a valid affected quantity.');
            return;
        }

        if (!description.value.trim()) {
            setFormMessage(message, 'Please describe the incident.');
            return;
        }

        submit.disabled = true;

        let uploadedPhoto = null;

        try {
            const userId = await getCurrentUserId();
            const file = photoInput.input.files?.[0];

            if (file) {
                uploadedPhoto = await uploadInventoryPhoto(
                    file,
                    'equipment-incidents'
                );
            }

            const { error } = await supabase
                .from('warehouse_equipment_incidents')
                .insert({
                    borrow_id: borrow.borrow_id,
                    responsible_user_id: borrow.borrower_user_id,
                    recorded_by: userId,
                    incident_type: incidentType.value,
                    quantity_affected: quantity,
                    description: description.value.trim(),
                    evidence_photo_path: uploadedPhoto
                });

            if (error) throw error;

            closeModal();
            await onSaved();

        } catch (error) {
            console.error('Equipment incident error:', error);

            if (uploadedPhoto) {
                await deleteInventoryPhoto(uploadedPhoto);
            }

            setFormMessage(
                message,
                error.message || 'Unable to submit incident report.'
            );

            submit.disabled = false;
        }
    });

    return form;
}

// =====================================================
// LOAD EQUIPMENT RECORDS
// =====================================================

async function loadEquipmentRecords() {
    const [
        borrowResult,
        returnResult,
        incidentResult
    ] = await Promise.all([
        supabase
            .from('warehouse_equipment_borrow')
            .select('*')
            .order('borrowed_at', { ascending: false }),

        supabase
            .from('warehouse_equipment_return')
            .select('*')
            .order('returned_at', { ascending: false }),

        supabase
            .from('warehouse_equipment_incidents')
            .select('*')
            .order('incident_date', { ascending: false })
    ]);

    if (borrowResult.error) throw borrowResult.error;
    if (returnResult.error) throw returnResult.error;
    if (incidentResult.error) throw incidentResult.error;

    currentBorrows = borrowResult.data || [];
    currentReturns = returnResult.data || [];
    currentIncidents = incidentResult.data || [];
}

// =====================================================
// HISTORY TABLES
// =====================================================

function renderBorrowingHistory() {
    const rows = currentBorrows.map(borrow => {
        const item = getEquipment(borrow);
        const person = getBorrowPerson(borrow);
        const remaining = getOutstanding(borrow);

        const row = document.createElement('tr');

        [
            getInventoryLabel(item),
            getPersonLabel(person),
            formatNumber(borrow.quantity_borrowed),
            formatNumber(remaining),
            formatDateTime(borrow.borrowed_at),
            formatDateTime(borrow.expected_return_at),
            remaining > 0 ? 'Borrowed' : 'Returned'
        ].forEach(value => row.append(el('td', '', value)));

        const actionCell = document.createElement('td');

        if (remaining > 0) {
            actionCell.append(
                button('Return', 'wo-btn-primary wo-btn-small', () => {
                    openModal(
                        renderEquipmentReturnForm(
                            borrow,
                            remaining,
                            currentPeople,
                            loadEquipmentWorkflow
                        )
                    );
                }),
                button('Incident', 'wo-btn-secondary wo-btn-small', () => {
                    openModal(
                        renderEquipmentIncidentForm(
                            borrow,
                            remaining,
                            loadEquipmentWorkflow
                        )
                    );
                })
            );
        } else {
            actionCell.textContent = '—';
        }

        row.append(actionCell);
        return row;
    });

    return createTable(
        [
            'Equipment',
            'Borrower',
            'Borrowed',
            'Outstanding',
            'Borrowed At',
            'Expected Return',
            'Status',
            'Actions'
        ],
        rows
    );
}

function renderReturnHistory() {
    const rows = currentReturns.map(record => {
        const borrow = currentBorrows.find(
            item => item.borrow_id === record.borrow_id
        );

        const person = currentPeople.find(
            item => item.person_id === record.returned_by
        );

        const row = document.createElement('tr');

        [
            getInventoryLabel(borrow ? getEquipment(borrow) : null),
            getPersonLabel(person),
            formatNumber(record.quantity_returned),
            formatNumber(record.quantity_usable),
            formatNumber(record.quantity_damaged),
            formatDateTime(record.returned_at)
        ].forEach(value => row.append(el('td', '', value)));

        return row;
    });

    return createTable(
        [
            'Equipment',
            'Returned By',
            'Returned',
            'Usable',
            'Damaged',
            'Date'
        ],
        rows
    );
}

function renderIncidentHistory() {
    const rows = currentIncidents.map(record => {
        const borrow = currentBorrows.find(
            item => item.borrow_id === record.borrow_id
        );

        const person = currentPeople.find(
            item => item.person_id === record.responsible_user_id
        );

        const row = document.createElement('tr');

        [
            getInventoryLabel(borrow ? getEquipment(borrow) : null),
            getPersonLabel(person),
            capitalize(record.incident_type),
            formatNumber(record.quantity_affected),
            record.description || '—',
            formatDateTime(record.incident_date)
        ].forEach(value => row.append(el('td', '', value)));

        return row;
    });

    return createTable(
        [
            'Equipment',
            'Responsible Person',
            'Incident',
            'Quantity',
            'Description',
            'Date'
        ],
        rows
    );
}

function renderEquipmentHistory(root) {
    const section = el('section', 'wo-equipment-history');

    section.append(
        el('h2', 'wo-inventory-section-title', 'Equipment History')
    );

    const borrowing = el('section', 'wo-history-group');
    borrowing.append(
        el('h3', '', 'Borrowing Records'),
        renderBorrowingHistory()
    );

    const returns = el('section', 'wo-history-group');
    returns.append(
        el('h3', '', 'Return History'),
        renderReturnHistory()
    );

    const incidents = el('section', 'wo-history-group');
    incidents.append(
        el('h3', '', 'Incident Reports'),
        renderIncidentHistory()
    );

    section.append(borrowing, returns, incidents);
    root.append(section);
}

// =====================================================
// LOAD PEOPLE
// =====================================================

async function loadEquipmentPeople() {
    const { data, error } = await supabase.rpc(
        'warehouse_inventory_get_people'
    );

    if (error) throw error;

    const uniquePeople = new Map();

    (data || []).forEach(person => {
        if (person.person_id) {
            uniquePeople.set(person.person_id, person);
        }
    });

    currentPeople = [...uniquePeople.values()];
}

// =====================================================
// MAIN EQUIPMENT WORKFLOW
// =====================================================

export async function loadEquipmentWorkflow() {
    if (isLoading || !currentRoot) return;

    isLoading = true;
    const root = currentRoot;

    try {
        await Promise.all([
            loadEquipmentPeople(),
            loadEquipmentRecords()
        ]);

        if (root !== currentRoot) return;

        const section = el('section', 'wo-equipment-workflow');

        const availableItems = currentInventory.filter(
            item => Number(item.tool_quantity || 0) > 0
        );

        section.append(
            el('h2', 'wo-inventory-section-title', 'Equipment Borrowing')
        );

        if (!availableItems.length) {
            section.append(
                el(
                    'p',
                    'wo-inventory-empty',
                    'No equipment is currently available for borrowing.'
                )
            );
        } else {
            const cards = el('div', 'wo-inventory-action-grid');

            availableItems.forEach(item => {
                const card = el('article', 'wo-inventory-action-card');

                card.append(
                    el('h3', '', getInventoryLabel(item)),
                    el(
                        'p',
                        '',
                        `Available: ${formatNumber(item.tool_quantity)}`
                    ),
                    button('Borrow Equipment', 'wo-btn-primary', () => {
                        openModal(
                            renderEquipmentBorrowForm(
                                item,
                                currentPeople,
                                loadEquipmentWorkflow
                            )
                        );
                    })
                );

                cards.append(card);
            });

            section.append(cards);
        }

        section.append(
            el(
                'h2',
                'wo-inventory-section-title',
                'Equipment Transaction History'
            )
        );

        const history = el('div', 'wo-equipment-history-content');
        renderEquipmentHistory(history);
        section.append(history);

        const previous = root.querySelector('.wo-equipment-workflow');
        if (previous) previous.remove();

        root.append(section);

    } catch (error) {
        console.error('Equipment workflow loading error:', error);

        const errorBox = el(
            'p',
            'wo-inventory-message error',
            error.message || 'Unable to load equipment records.'
        );

        const previous = root.querySelector('.wo-equipment-workflow');

        if (previous) previous.replaceWith(errorBox);
        else root.append(errorBox);

    } finally {
        isLoading = false;
    }
}

// =====================================================
// MODULE ENTRY POINTS
// =====================================================

export function setEquipmentContext(root, inventory) {
    currentRoot = root;
    currentInventory = inventory || [];
}

export function cleanupEquipment() {
    closeModal();

    currentRoot = null;
    currentInventory = [];
    currentPeople = [];
    currentBorrows = [];
    currentReturns = [];
    currentIncidents = [];

    isLoading = false;
}
