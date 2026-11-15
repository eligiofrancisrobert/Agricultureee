
import { supabase } from '../connection.js';

import {
    el,
    button,
    showMessage,
    formatNumber,
    formatDate,
    createSummaryCard,
    createField,
    createInput,
    createPhotoInput,
    uploadInventoryPhoto,
    getPhotoUrl,
    deleteInventoryPhoto,
    setFormMessage,
    openModal,
    closeModal,
    revokeObjectUrls,
    createInventoryCard
} from './inventory-helpers.js';

import {
    setEquipmentContext,
    loadEquipmentWorkflow,
    cleanupEquipment
} from './equipment.js';

import {
    setFertilizerContext,
    loadFertilizerWorkflow,
    cleanupFertilizer
} from './fertilizer-inventory.js';

import {
    setPesticideContext,
    loadPesticideWorkflow,
    cleanupPesticide
} from './pesticide-inventory.js';

import {
    render as renderHarvestInventory,
    cleanup as cleanupHarvestInventory
} from './harvest-inventory.js';

// =========================================================
// CONSTANTS
// =========================================================

const LOW_STOCK_THRESHOLD = 10;

const INVENTORY_CATEGORIES = [
    'Fertilizer',
    'Pesticide',
    'Equipment',
    'Farm Tools',
    'Other'
];

let currentLoadId = 0;
let currentPageId = 0;

// =========================================================
// INVENTORY STATUS
// =========================================================

function getToolStatus(quantity) {
    const stock = Number(quantity || 0);

    if (stock <= 0) {
        return {
            text: 'Out of Stock',
            className: 'out-of-stock'
        };
    }

    if (stock <= LOW_STOCK_THRESHOLD) {
        return {
            text: 'Low Stock',
            className: 'low-stock'
        };
    }

    return {
        text: 'Available',
        className: 'available'
    };
}

// =========================================================
// INVENTORY CARD
// =========================================================

async function createToolCard(item, onEdit, onDelete, onReplenish) {
    const quantity = Number(item.tool_quantity || 0);
    const status = getToolStatus(quantity);

    const quantityText =
        `${formatNumber(quantity)} ${item.tool_unit || ''}`.trim();

    return createInventoryCard({
        photoPath: item.photo_path,
        title: item.tool_name,
        details: [
            {
                label: 'Category',
                value: item.tool_category || '—'
            },
            {
                label: 'Quantity',
                value: quantityText
            },
            {
                label: 'Stock Status',
                value: status.text
            },
            {
                label: 'Last Updated',
                value: formatDate(item.updated_at)
            }
        ],
        onEdit: () => onEdit(item),
        onDelete: () => onDelete(item),
        onReplenish: quantity <= LOW_STOCK_THRESHOLD
            ? () => onReplenish(item)
            : null
    });
}

// =========================================================
// ADD / EDIT INVENTORY FORM
// =========================================================

async function renderToolForm(category, item, onSaved) {
    const form = el('form', 'wo-inventory-form');

    const heading = el(
        'h3',
        '',
        item ? 'Edit Inventory Item' : 'Add Inventory Item'
    );

    const nameInput = createInput({
        name: 'tool_name',
        required: true,
        maxLength: 150,
        value: item?.tool_name || ''
    });

    const categorySelect = document.createElement('select');
    categorySelect.name = 'tool_category';
    categorySelect.required = true;

    INVENTORY_CATEGORIES.forEach(value => {
        const option = el('option', '', value);
        option.value = value;
        categorySelect.append(option);
    });

    categorySelect.value = item?.tool_category || category;

    const quantityInput = createInput({
        type: 'number',
        name: 'tool_quantity',
        min: 0,
        step: '0.01',
        required: true,
        value: item?.tool_quantity ?? 0
    });

    const unitInput = createInput({
        name: 'tool_unit',
        placeholder: 'e.g. kg, liters, bags, pieces',
        required: true,
        maxLength: 30,
        value: item?.tool_unit || ''
    });

    const currentPhotoUrl = await getPhotoUrl(item?.photo_path);
    const photoField = createPhotoInput(currentPhotoUrl);

    const message = el('p', 'wo-inventory-form-message');

    const saveButton = el(
        'button',
        'wo-inventory-save',
        item ? 'Save Changes' : 'Add Item'
    );

    saveButton.type = 'submit';

    const actions = el('div', 'wo-inventory-form-actions');

    actions.append(
        saveButton,
        button('Cancel', 'wo-inventory-cancel', closeModal)
    );

    form.append(
        heading,
        createField('Item Name', nameInput, true),
        createField('Category', categorySelect, true),
        createField('Quantity', quantityInput, true),
        createField('Unit', unitInput, true),
        photoField.wrapper,
        actions,
        message
    );

    form.addEventListener('submit', async event => {
        event.preventDefault();

        if (saveButton.disabled) return;

        saveButton.disabled = true;
        saveButton.textContent = 'Saving...';
        message.textContent = '';

        let uploadedPhotoPath = null;

        try {
            const payload = {
                tool_name: nameInput.value.trim(),
                tool_category: categorySelect.value,
                tool_quantity: Number(quantityInput.value),
                tool_unit: unitInput.value.trim(),
                updated_at: new Date().toISOString()
            };

            if (!payload.tool_name || !payload.tool_unit) {
                throw new Error('Please complete all required fields.');
            }

            if (
                !Number.isFinite(payload.tool_quantity) ||
                payload.tool_quantity < 0
            ) {
                throw new Error('Quantity must be zero or greater.');
            }

            const selectedPhoto = photoField.input.files?.[0];

            if (selectedPhoto) {
                uploadedPhotoPath = await uploadInventoryPhoto(
                    selectedPhoto,
                    payload.tool_category
                );

                payload.photo_path = uploadedPhotoPath;
            }

            let result;

            if (item) {
                result = await supabase
                    .from('warehouse_tools_inventory')
                    .update(payload)
                    .eq('tool_id', item.tool_id);
            } else {
                result = await supabase
                    .from('warehouse_tools_inventory')
                    .insert(payload);
            }

            if (result.error) {
                throw result.error;
            }

            if (
                item?.photo_path &&
                uploadedPhotoPath &&
                item.photo_path !== uploadedPhotoPath
            ) {
                await deleteInventoryPhoto(item.photo_path);
            }

            closeModal();
            await onSaved();

        } catch (error) {
            console.error('Inventory save failed:', error);

            if (uploadedPhotoPath) {
                await deleteInventoryPhoto(uploadedPhotoPath);
            }

            setFormMessage(
                message,
                error.message || 'Unable to save inventory item.'
            );

            saveButton.disabled = false;
            saveButton.textContent = item ? 'Save Changes' : 'Add Item';
        }
    });

    openModal(form);
}

// =========================================================
// REPLENISHMENT REQUEST
// =========================================================

async function renderReplenishmentRequestForm(category, item, onSaved) {
    const form = el('form', 'wo-inventory-form');
    const message = el('p', 'wo-inventory-form-message');

    const quantityInput = createInput({
        type: 'number',
        name: 'requested_quantity',
        min: 1,
        step: 1,
        required: true,
        placeholder: 'Enter requested quantity'
    });

    const reasonInput = el('textarea');
    reasonInput.name = 'request_reason';
    reasonInput.rows = 3;
    reasonInput.maxLength = 500;
    reasonInput.required = true;
    reasonInput.placeholder = 'Explain why replenishment is needed';

    const submitButton = el(
        'button',
        'wo-inventory-save',
        'Submit Request'
    );

    submitButton.type = 'submit';

    const actions = el('div', 'wo-inventory-form-actions');

    actions.append(
        submitButton,
        button('Cancel', 'wo-inventory-cancel', closeModal)
    );

    form.append(
        el('h3', '', 'Request Replenishment'),
        el(
            'p',
            'muted',
            `Submit a replenishment request for ${item.tool_name}.`
        ),
        el('p', 'muted', `Category: ${category}`),
        el(
            'p',
            'muted',
            `Current Stock: ${formatNumber(item.tool_quantity)} ${item.tool_unit || ''}`
        ),
        createField('Requested Quantity', quantityInput, true),
        createField('Reason', reasonInput, true),
        actions,
        message
    );

    form.addEventListener('submit', async event => {
        event.preventDefault();

        if (submitButton.disabled) return;

        const requestedQuantity = Number(quantityInput.value);
        const reason = reasonInput.value.trim();

        if (
            !Number.isInteger(requestedQuantity) ||
            requestedQuantity <= 0
        ) {
            setFormMessage(
                message,
                'Enter a valid quantity greater than zero.'
            );
            return;
        }

        if (!reason) {
            setFormMessage(message, 'Please provide a reason.');
            return;
        }

        submitButton.disabled = true;
        submitButton.textContent = 'Submitting...';

        try {
            const { data, error } = await supabase.rpc(
                'wo_create_replenishment_request',
                {
                    p_tool_id: item.tool_id,
                    p_requested_quantity: requestedQuantity,
                    p_request_reason: reason
                }
            );

            if (error) throw error;

            if (data?.success === false) {
                throw new Error(
                    data.message ||
                    'Unable to submit replenishment request.'
                );
            }

            closeModal();
            await onSaved();

            alert('Replenishment request submitted successfully.');

        } catch (error) {
            console.error('Replenishment request failed:', error);

            let userMessage =
                'Unable to submit replenishment request. Please try again.';

            const errorMessage = String(error.message || '');

            if (
                error.code === '23505' ||
                errorMessage.includes(
                    'uq_warehouse_replenishment_pending_tool'
                ) ||
                errorMessage.toLowerCase().includes('duplicate key')
            ) {
                userMessage =
                    'This item already has a pending replenishment request. Please wait for the Farm Manager to review it before submitting another request.';
            }

            setFormMessage(message, userMessage);

            submitButton.disabled = false;
            submitButton.textContent = 'Submit Request';
        }
    });

    openModal(form);
}

// =========================================================
// LOAD INVENTORY RECORDS
// =========================================================

async function getInventory(category) {
    const { data, error } = await supabase
        .from('warehouse_tools_inventory')
        .select('*')
        .eq('tool_category', category)
        .order('tool_name', { ascending: true });

    if (error) throw error;

    return data || [];
}

// =========================================================
// INVENTORY SUMMARY
// =========================================================

function renderInventorySummary(summaryGrid, allItems, config) {
    const available = allItems.filter(
        item => Number(item.tool_quantity) > LOW_STOCK_THRESHOLD
    );

    const lowStock = allItems.filter(item => {
        const quantity = Number(item.tool_quantity);

        return quantity > 0 && quantity <= LOW_STOCK_THRESHOLD;
    });

    const outOfStock = allItems.filter(
        item => Number(item.tool_quantity) <= 0
    );

    const labels = (config.sections || []).map(
        section => section.label
    );

    summaryGrid.replaceChildren(
        createSummaryCard(
            labels[0] || 'Total Item Types',
            allItems.length,
            'Registered inventory items'
        ),
        createSummaryCard(
            labels[1] || 'Available Items',
            available.length,
            'Items above the low-stock threshold'
        ),
        createSummaryCard(
            labels[2] || 'Low Stock Items',
            lowStock.length,
            `At or below ${LOW_STOCK_THRESHOLD} units`
        ),
        createSummaryCard(
            labels[3] || 'Out of Stock',
            outOfStock.length,
            'Items with zero quantity'
        )
    );
}

// =========================================================
// TOOL INVENTORY PAGE
// =========================================================

async function renderToolsInventory(root, config, ctx = {}) {
    const category = config.category;
    const pageId = ++currentPageId;

    const page = el('section', 'wo-inventory-page');
    const heading = el('div', 'wo-page-heading');

    heading.append(
        el('h1', '', config.title),
        el('p', 'muted', config.description)
    );

    const toolbar = el('div', 'wo-inventory-toolbar');
    const summaryGrid = el('div', 'wo-stats-grid');
    const cardGrid = el('div', 'wo-inventory-card-grid');
    const historyContainer = el('div', 'wo-inventory-history');

    const addButton = button(
        `+ Add ${category}`,
        'wo-inventory-add',
        () => renderToolForm(category, null, load)
    );

    toolbar.append(addButton);

    page.append(
        heading,
        toolbar,
        summaryGrid,
        cardGrid
    );

    if (
        category === 'Equipment' ||
        category === 'Fertilizer' ||
        category === 'Pesticide'
    ) {
        page.append(historyContainer);
    }

    root.replaceChildren(page);

    async function load() {
        const loadId = ++currentLoadId;

        const isCurrentPage = () =>
            pageId === currentPageId &&
            loadId === currentLoadId &&
            page.isConnected;

        showMessage(cardGrid, 'Loading inventory...');

        try {
            const allItems = await getInventory(category);

            if (!isCurrentPage()) return;

            const query = String(ctx?.query || '').toLowerCase();

            const filteredItems = allItems.filter(item => {
                return [
                    item.tool_name,
                    item.tool_category,
                    item.tool_unit
                ].some(value =>
                    String(value || '').toLowerCase().includes(query)
                );
            });

            renderInventorySummary(
                summaryGrid,
                allItems,
                config
            );

            const cards = await Promise.all(
                filteredItems.map(item => createToolCard(
                    item,

                    selected => renderToolForm(
                        category,
                        selected,
                        load
                    ),

                    async selected => {
                        if (!confirm(
                            `Delete "${selected.tool_name}" from inventory?`
                        )) {
                            return;
                        }

                        const { error } = await supabase
                            .from('warehouse_tools_inventory')
                            .delete()
                            .eq('tool_id', selected.tool_id);

                        if (error) {
                            console.error('Delete failed:', error);
                            alert(
                                error.message ||
                                'Unable to delete item.'
                            );
                            return;
                        }

                        if (selected.photo_path) {
                            await deleteInventoryPhoto(selected.photo_path);
                        }

                        await load();
                    },

                    selected => renderReplenishmentRequestForm(
                        category,
                        selected,
                        load
                    )
                ))
            );

            if (!isCurrentPage()) return;

            if (!cards.length) {
                showMessage(cardGrid, 'No records found.');
            } else {
                cardGrid.replaceChildren(...cards);
            }

            if (category === 'Equipment') {
                setEquipmentContext(historyContainer, allItems);
                await loadEquipmentWorkflow();
            }

            if (category === 'Fertilizer') {
                setFertilizerContext(historyContainer, allItems);
                await loadFertilizerWorkflow();
            }

            if (category === 'Pesticide') {
                setPesticideContext(historyContainer, allItems);
                await loadPesticideWorkflow();
            }

        } catch (error) {
            if (!isCurrentPage()) return;

            console.error(
                `${category} inventory loading failed:`,
                error
            );

            showMessage(
                cardGrid,
                error.message ||
                'Unable to load inventory. Check your database permissions.',
                'error'
            );
        }
    }

    await load();
}

// =========================================================
// PAGE ENTRY POINTS
// =========================================================

export async function renderInventoryPage(root, config, ctx = {}) {
    cleanupInventoryPage();

    if (config.type === 'harvest') {
        return renderHarvestInventory(root, config, ctx);
    }

    return renderToolsInventory(root, config, ctx);
}

export function cleanupInventoryPage() {
    currentPageId++;
    currentLoadId++;

    closeModal();
    revokeObjectUrls();

    cleanupEquipment();
    cleanupFertilizer();
    cleanupPesticide();
    cleanupHarvestInventory();
}
