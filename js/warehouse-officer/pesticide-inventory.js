
import { supabase } from '../connection.js';

import {
    el,
    button,
    formatNumber,
    formatDate,
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

const TABLE = 'warehouse_pesticide_used';

let currentRoot = null;
let currentInventory = [];
let currentPeople = [];
let currentPlantings = [];
let currentUsage = [];
let isLoading = false;

// =====================================================
// HELPERS
// =====================================================

function personLabel(person) {
    return (
        person?.full_name ||
        person?.person_name ||
        person?.name ||
        person?.email ||
        'Unknown person'
    );
}

function plantingLabel(planting) {
    const crop =
        planting?.crop_name ||
        planting?.products?.product_name ||
        'Unspecified Crop';

    const field =
        planting?.field_name ||
        planting?.field?.field_name ||
        'Unspecified Field';

    return `${crop} — ${field}`;
}

function getPerson(personId) {
    return currentPeople.find(
        person => person.person_id === personId
    );
}

function getPlanting(plantingId) {
    return currentPlantings.find(
        planting => planting.planting_id === plantingId
    );
}

function getInventory(toolId) {
    return currentInventory.find(
        item => item.tool_id === toolId
    );
}

function createForm(title) {
    const form = el('form', 'wo-inventory-form');
    form.append(el('h2', 'wo-inventory-form-title', title));
    return form;
}

function createMessage() {
    return el('p', 'wo-inventory-form-message');
}

function appendActions(form, message, label) {
    const actions = el('div', 'wo-inventory-form-actions');

    const cancel = button(
        'Cancel',
        'wo-btn-secondary',
        closeModal
    );

    const submit = el('button', 'wo-btn-primary', label);
    submit.type = 'submit';

    actions.append(cancel, submit);
    form.append(message, actions);

    return submit;
}

// =====================================================
// LOAD DATA
// =====================================================

async function loadPeople() {
    const { data, error } = await supabase.rpc(
        'warehouse_inventory_get_people'
    );

    if (error) throw error;

    const unique = new Map();

    (data || []).forEach(person => {
        if (person.person_id) {
            unique.set(person.person_id, person);
        }
    });

    currentPeople = [...unique.values()];
}

async function loadPlantings() {
    const { data, error } = await supabase.rpc(
        'warehouse_inventory_get_plantings'
    );

    if (error) throw error;

    currentPlantings = (data || []).filter(
        planting => planting.planting_status !== 'harvested'
    );
}

async function loadUsage() {
    const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .order('application_date', { ascending: false });

    if (error) throw error;

    currentUsage = data || [];
}

// =====================================================
// PESTICIDE USAGE FORM
// =====================================================

function renderUsageForm(item, onSaved) {
    const form = createForm('Record Pesticide Usage');
    const message = createMessage();

    const personSelect = createSelect(
        currentPeople.map(person => ({
            value: person.person_id,
            label: personLabel(person)
        })),
        'Select farmer or farm worker'
    );

    const plantingSelect = createSelect(
        currentPlantings.map(planting => ({
            value: planting.planting_id,
            label: plantingLabel(planting)
        })),
        'Select planting'
    );

    const quantityInput = createInput({
        type: 'number',
        name: 'quantity_used',
        min: 0.01,
        step: '0.01',
        max: Number(item.tool_quantity || 0),
        required: true
    });

    const dateInput = createInput({
        type: 'date',
        name: 'application_date',
        value: new Date().toISOString().slice(0, 10),
        required: true
    });

    const targetPest = createInput({
        name: 'target_pest',
        placeholder: 'Enter target pest or disease',
        required: true
    });

    const method = createSelect([
        { value: 'spraying', label: 'Spraying' },
        { value: 'dusting', label: 'Dusting' },
        { value: 'soil_application', label: 'Soil Application' },
        { value: 'seed_treatment', label: 'Seed Treatment' },
        { value: 'other', label: 'Other' }
    ], 'Select application method');

    const notes = el('textarea', 'wo-inventory-textarea');
    notes.name = 'notes';
    notes.rows = 3;
    notes.placeholder = 'Additional notes (optional)';

    const photo = createPhotoInput(
        null,
        'Evidence Photo (Optional)'
    );

    form.append(
        createField(
            'Pesticide',
            createInput({
                value: item.tool_name,
                disabled: true
            })
        ),
        createField(
            'Available Stock',
            createInput({
                value: formatNumber(item.tool_quantity),
                disabled: true
            })
        ),
        createField('Used By', personSelect, true),
        createField('Planting', plantingSelect, true),
        createField('Quantity Used', quantityInput, true),
        createField('Application Date', dateInput, true),
        createField('Target Pest / Disease', targetPest, true),
        createField('Application Method', method, true),
        createField('Notes', notes),
        photo.wrapper
    );

    plantingSelect.addEventListener('change', () => {
        const planting = getPlanting(plantingSelect.value);

        if (!planting?.farmer_id) return;

        const assignedPerson = currentPeople.find(
            person =>
                person.person_id === planting.farmer_id &&
                (!planting.farm_id ||
                    !person.farm_ids ||
                    person.farm_ids.includes(planting.farm_id))
        );

        if (assignedPerson) {
            personSelect.value = assignedPerson.person_id;
        }
    });

    const submit = appendActions(
        form,
        message,
        'Save Usage'
    );

    form.addEventListener('submit', async event => {
        event.preventDefault();

        if (submit.disabled) return;

        const personId = personSelect.value;
        const plantingId = plantingSelect.value;
        const quantity = Number(quantityInput.value);
        const planting = getPlanting(plantingId);
        const person = getPerson(personId);

        if (!personId || !plantingId) {
            setFormMessage(
                message,
                'Please select the person and planting.'
            );
            return;
        }

        if (
            !Number.isFinite(quantity) ||
            quantity <= 0 ||
            quantity > Number(item.tool_quantity || 0)
        ) {
            setFormMessage(
                message,
                'Enter a valid quantity within the available stock.'
            );
            return;
        }

        if (
            planting?.farm_id &&
            person?.farm_ids?.length &&
            !person.farm_ids.includes(planting.farm_id)
        ) {
            setFormMessage(
                message,
                'The selected person is not assigned to this farm.'
            );
            return;
        }

        if (!targetPest.value.trim() || !method.value) {
            setFormMessage(
                message,
                'Please provide the target pest and application method.'
            );
            return;
        }

        submit.disabled = true;

        let uploadedPhoto = null;

        try {
            const userId = await getCurrentUserId();
            const file = photo.input.files?.[0];

            if (file) {
                uploadedPhoto = await uploadInventoryPhoto(
                    file,
                    'pesticide-usage'
                );
            }

            const { error } = await supabase
                .from(TABLE)
                .insert({
                    tool_id: item.tool_id,
                    planting_id: plantingId,
                    used_by: personId,
                    recorded_by: userId,
                    quantity_used: quantity,
                    application_date: dateInput.value,
                    target_pest: targetPest.value.trim(),
                    application_method: method.value,
                    notes: notes.value.trim() || null,
                    evidence_photo_path: uploadedPhoto
                });

            if (error) throw error;

            closeModal();
            await onSaved();

        } catch (error) {
            console.error(error);

            if (uploadedPhoto) {
                await deleteInventoryPhoto(uploadedPhoto);
            }

            setFormMessage(
                message,
                error.message || 'Unable to record pesticide usage.'
            );

            submit.disabled = false;
        }
    });

    return form;
}

// =====================================================
// REPLENISHMENT REQUEST
// =====================================================

function renderReplenishmentForm(item, onSaved) {
    const form = createForm('Request Pesticide Replenishment');
    const message = createMessage();

    const quantity = createInput({
        type: 'number',
        name: 'requested_quantity',
        min: 1,
        step: 1,
        required: true
    });

    const reason = el('textarea', 'wo-inventory-textarea');
    reason.name = 'request_reason';
    reason.rows = 3;
    reason.placeholder = 'Reason for replenishment';
    reason.required = true;

    form.append(
        createField(
            'Pesticide',
            createInput({
                value: item.tool_name,
                disabled: true
            })
        ),
        createField(
            'Current Stock',
            createInput({
                value: formatNumber(item.tool_quantity),
                disabled: true
            })
        ),
        createField('Requested Quantity', quantity, true),
        createField('Reason', reason, true)
    );

    const submit = appendActions(
        form,
        message,
        'Submit Request'
    );

    form.addEventListener('submit', async event => {
        event.preventDefault();

        if (submit.disabled) return;

        const requestedQuantity = Number(quantity.value);

        if (
            !Number.isInteger(requestedQuantity) ||
            requestedQuantity <= 0
        ) {
            setFormMessage(
                message,
                'Enter a valid requested quantity.'
            );
            return;
        }

        if (!reason.value.trim()) {
            setFormMessage(
                message,
                'Please provide a reason.'
            );
            return;
        }

        submit.disabled = true;

        try {
            const { error } = await supabase.rpc(
                'wo_create_replenishment_request',
                {
                    p_tool_id: item.tool_id,
                    p_requested_quantity: requestedQuantity,
                    p_request_reason: reason.value.trim()
                }
            );

            if (error) throw error;

            closeModal();
            await onSaved();

        } catch (error) {
            console.error(error);

            const duplicate =
                error.code === '23505' ||
                error.message?.includes(
                    'uq_warehouse_replenishment_pending_tool'
                );

            setFormMessage(
                message,
                duplicate
                    ? 'A pending replenishment request already exists for this item.'
                    : error.message || 'Unable to submit replenishment request.'
            );

            submit.disabled = false;
        }
    });

    return form;
}

// =====================================================
// USAGE HISTORY
// =====================================================

function renderUsageHistory(root) {
    const rows = currentUsage.map(record => {
        const item = getInventory(record.tool_id);
        const person = getPerson(record.used_by);
        const planting = getPlanting(record.planting_id);

        const row = document.createElement('tr');

        [
            item?.tool_name || 'Unknown pesticide',
            planting ? plantingLabel(planting) : 'Unknown planting',
            personLabel(person),
            formatNumber(record.quantity_used),
            formatDate(record.application_date),
            record.target_pest || '—',
            record.application_method || '—'
        ].forEach(value => {
            row.append(el('td', '', value));
        });

        return row;
    });

    const section = el('section', 'wo-supply-usage-history');

    section.append(
        el('h2', 'wo-inventory-section-title', 'Pesticide Usage History'),
        createTable(
            [
                'Pesticide',
                'Planting',
                'Used By',
                'Quantity',
                'Application Date',
                'Target Pest',
                'Method'
            ],
            rows
        )
    );

    root.append(section);
}

// =====================================================
// PESTICIDE WORKFLOW
// =====================================================

export async function loadPesticideWorkflow() {
    if (isLoading || !currentRoot) return;

    isLoading = true;

    const root = currentRoot;

    try {
        await Promise.all([
            loadPeople(),
            loadPlantings(),
            loadUsage()
        ]);

        if (root !== currentRoot) return;

        const section = el(
            'section',
            'wo-pesticide-workflow'
        );

        section.append(
            el(
                'h2',
                'wo-inventory-section-title',
                'Record Pesticide Usage'
            )
        );

        const availableItems = currentInventory.filter(
            item => Number(item.tool_quantity || 0) > 0
        );

        if (!availableItems.length) {
            section.append(
                el(
                    'p',
                    'wo-inventory-empty',
                    'No pesticide is currently available.'
                )
            );
        } else {
            const grid = el(
                'div',
                'wo-inventory-action-grid'
            );

            availableItems.forEach(item => {
                const card = el(
                    'article',
                    'wo-inventory-action-card'
                );

                card.append(
                    el('h3', '', item.tool_name),
                    el(
                        'p',
                        '',
                        `Available: ${formatNumber(item.tool_quantity)} ${item.tool_unit || ''}`
                    ),
                    button(
                        'Record Usage',
                        'wo-btn-primary',
                        () => {
                            openModal(
                                renderUsageForm(
                                    item,
                                    loadPesticideWorkflow
                                )
                            );
                        }
                    ),
                    button(
                        'Request Replenishment',
                        'wo-btn-secondary',
                        () => {
                            openModal(
                                renderReplenishmentForm(
                                    item,
                                    loadPesticideWorkflow
                                )
                            );
                        }
                    )
                );

                grid.append(card);
            });

            section.append(grid);
        }

        renderUsageHistory(section);

        const previous = root.querySelector(
            '.wo-pesticide-workflow'
        );

        if (previous) previous.replaceWith(section);
        else root.append(section);

    } catch (error) {
        console.error(
            'Pesticide workflow error:',
            error
        );

        const errorBox = el(
            'p',
            'wo-inventory-message error',
            error.message || 'Unable to load pesticide workflow.'
        );

        const previous = root.querySelector(
            '.wo-pesticide-workflow'
        );

        if (previous) previous.replaceWith(errorBox);
        else root.append(errorBox);

    } finally {
        isLoading = false;
    }
}

// =====================================================
// MODULE ENTRY POINTS
// =====================================================

export function setPesticideContext(root, inventory) {
    currentRoot = root;
    currentInventory = inventory || [];
}

export function cleanupPesticide() {
    closeModal();

    currentRoot = null;
    currentInventory = [];
    currentPeople = [];
    currentPlantings = [];
    currentUsage = [];

    isLoading = false;
}

export async function render(root, ctx = {}) {
    currentRoot = root;
    currentInventory = ctx.inventory || [];

    await loadPesticideWorkflow();
}
