
import { supabase } from '../connection.js';
import { createHarvestContributionsSection } from './harvest-contributions.js';

import {
    el,
    button,
    formatNumber,
    formatDate,
    createSummaryCard,
    createTable,
    createField,
    createInput,
    createSelect,
    setFormMessage,
    uploadInventoryPhoto,
    getPhotoUrl,
    deleteInventoryPhoto,
    createPhotoInput,
    closeModal,
    openModal
} from './inventory-helpers.js';

let currentRoot = null;
let currentProduce = [];
let currentContributions = [];
let currentHarvests = [];
let harvestContributions = null;
let loadId = 0;
let realtimeChannel = null;
let refreshPending = false;

const PRODUCE_TABLE = 'warehouse_produce_inventory';

function getCropName(harvest) {
    return (
        harvest?.farm_plantings?.crop_name ||
        harvest?.farm_plantings?.products?.product_name ||
        'Unspecified Crop'
    );
}

function getVerifiedQuantity(harvest) {
    return Number(harvest?.verified_quantity ?? harvest?.harvest_quantity ?? 0);
}

function getAvailableQuantity(produce) {
    return Number(produce?.available_quantity || 0);
}

function getReservedQuantity(produce) {
    return Number(produce?.reserved_quantity || 0);
}

function getProduceStatus(status) {
    const labels = {
        available: 'Available',
        reserved: 'Reserved',
        released: 'Released',
        damaged: 'Damaged'
    };

    return labels[status] || 'Unknown';
}

function getHarvestId(contribution) {
    return contribution?.harvest_id;
}

function createForm(title) {
    const form = el('form', 'wo-inventory-form');
    form.append(el('h2', 'wo-inventory-form-title', title));
    return form;
}

function createMessage() {
    return el('p', 'wo-inventory-form-message');
}

// =====================================================
// LOAD DATA
// =====================================================

async function loadProduce() {
    const { data, error } = await supabase
        .from(PRODUCE_TABLE)
        .select('*')
        .order('created_at', { ascending: false });

    if (error) throw error;
    currentProduce = data || [];
}

async function loadContributions() {
    const { data, error } = await supabase
        .from('warehouse_produce_harvests')
        .select('harvest_id, quantity_added');

    if (error) throw error;
    currentContributions = data || [];
}

async function loadConfirmedHarvests() {
    const { data, error } = await supabase
        .from('harvested_crops')
        .select(`
            *,
            farm_plantings!harvested_crops_planting_id_fkey (
                crop_name,
                products (
                    product_name
                )
            )
        `)
        .eq('confirmation_status', 'confirmed')
        .order('harvested_date', { ascending: false });

    if (error) throw error;
    currentHarvests = data || [];
}

async function loadHarvestData() {
    await Promise.all([
        loadProduce(),
        loadContributions(),
        loadConfirmedHarvests()
    ]);
}

// =====================================================
// PRODUCE CARD WITH PHOTO
// =====================================================

async function createProduceCard(produce) {
    const card = el('article', 'wo-produce-card');

    const photoUrl = await getPhotoUrl(produce.photo_path);

    if (photoUrl) {
        const image = document.createElement('img');
        image.src = photoUrl;
        image.alt = produce.produce_name || produce.crop_name || 'Warehouse Produce';
        image.className = 'wo-produce-card-image';
        image.loading = 'lazy';

        card.append(image);
    }

    const header = el('div', 'wo-produce-card-header');

    header.append(
        el(
            'h3',
            'wo-produce-card-title',
            produce.produce_name ||
            produce.crop_name ||
            'Warehouse Produce'
        ),
        el(
            'span',
            `wo-produce-status status-${produce.produce_status}`,
            getProduceStatus(produce.produce_status)
        )
    );

    const details = el('div', 'wo-produce-card-details');

    details.append(
        el('p', '', `Available: ${formatNumber(getAvailableQuantity(produce))}`),
        el('p', '', `Reserved: ${formatNumber(getReservedQuantity(produce))}`),
        el('p', '', `Updated: ${formatDate(produce.updated_at)}`)
    );

    const actions = el('div', 'wo-inventory-actions');

    actions.append(
        button('Edit', 'wo-btn-primary', () => openModal(renderProduceEditForm(produce))),
        button('Remove', 'wo-btn-danger', () => removeProduce(produce))
    );

    card.append(header, details, actions);

    return card;
}

// =====================================================
// EDIT PRODUCE FORM
// =====================================================

function renderProduceEditForm(produce) {
    const form = createForm('Update Warehouse Produce');
    const message = createMessage();

    const status = createSelect([
        { value: 'available', label: 'Available' },
        { value: 'reserved', label: 'Reserved' },
        { value: 'released', label: 'Released' },
        { value: 'damaged', label: 'Damaged' }
    ], 'Select status');

    status.value = produce.produce_status || 'available';

    const photo = createPhotoInput(
        null,
        'Replace Produce Photo (Optional)'
    );

    form.append(
        createField(
            'Produce',
            createInput({
                value: produce.produce_name || produce.crop_name || 'Warehouse Produce',
                disabled: true
            })
        ),
        createField('Produce Status', status, true),
        photo.wrapper
    );

    const actions = el('div', 'wo-inventory-form-actions');

    const cancel = button('Cancel', 'wo-btn-secondary', closeModal);
    const submit = el('button', 'wo-btn-primary', 'Save Changes');
    submit.type = 'submit';

    actions.append(cancel, submit);
    form.append(message, actions);

    form.addEventListener('submit', async event => {
        event.preventDefault();

        if (submit.disabled) return;

        if (!status.value) {
            setFormMessage(message, 'Please select a produce status.');
            return;
        }

        submit.disabled = true;

        let uploadedPhoto = null;

        try {
            const file = photo.input.files?.[0];

            if (file) {
                uploadedPhoto = await uploadInventoryPhoto(file, 'harvest-produce');
            }

            const payload = {
                produce_status: status.value,
                updated_at: new Date().toISOString()
            };

            if (uploadedPhoto) payload.photo_path = uploadedPhoto;

            const { data, error } = await supabase
                .from(PRODUCE_TABLE)
                .update(payload)
                .eq('produce_id', produce.produce_id)
                .select('produce_id, photo_path, produce_status')
                .maybeSingle();

            if (error) throw error;
            if (!data) throw new Error('No produce record was updated.');

            if (uploadedPhoto && produce.photo_path && produce.photo_path !== uploadedPhoto) {
                await deleteInventoryPhoto(produce.photo_path);
            }

            closeModal();
            await loadHarvestInventory();

        } catch (error) {
            console.error(error);

            if (uploadedPhoto) {
                await deleteInventoryPhoto(uploadedPhoto);
            }

            setFormMessage(message, error.message || 'Unable to update produce.');
            submit.disabled = false;
        }
    });

    return form;
}

// =====================================================
// REMOVE PRODUCE
// =====================================================

async function removeProduce(produce) {
    if (!window.confirm('Are you sure you want to remove this produce record?')) return;

    try {
        const { error } = await supabase
            .from(PRODUCE_TABLE)
            .delete()
            .eq('produce_id', produce.produce_id);

        if (error) throw error;

        if (produce.photo_path) {
            await deleteInventoryPhoto(produce.photo_path);
        }

        await loadHarvestInventory();

    } catch (error) {
        console.error(error);
        alert(error.message || 'Unable to remove produce record.');
    }
}

// =====================================================
// CONFIRMED HARVESTS
// =====================================================

function getContributedHarvestIds() {
    return new Set(currentContributions.map(getHarvestId));
}

function getEligibleHarvests() {
    const contributedIds = getContributedHarvestIds();

    return currentHarvests.filter(
        harvest => !contributedIds.has(harvest.harvest_id)
    );
}

function renderEligibleHarvests() {
    const rows = getEligibleHarvests().map(harvest => {
        const row = document.createElement('tr');

        [
            getCropName(harvest),
            formatNumber(getVerifiedQuantity(harvest)),
            formatDate(harvest.harvested_date),
            harvest.confirmation_status || 'Confirmed'
        ].forEach(value => row.append(el('td', '', value)));

        const actionCell = document.createElement('td');

        actionCell.append(
            button(
                'Add to Inventory',
                'wo-btn-primary wo-btn-small',
                () => addConfirmedHarvest(harvest)
            )
        );

        row.append(actionCell);
        return row;
    });

    return createTable(
        ['Crop', 'Verified Quantity', 'Harvest Date', 'Status', 'Action'],
        rows
    );
}

async function addConfirmedHarvest(harvest) {
    if (!window.confirm(`Add ${getCropName(harvest)} to warehouse produce inventory?`)) return;

    try {
        const { error } = await supabase.rpc(
            'warehouse_add_confirmed_harvest',
            { p_harvest_id: harvest.harvest_id }
        );

        if (error) throw error;
        await loadHarvestInventory();

    } catch (error) {
        console.error(error);
        alert(error.message || 'Unable to add confirmed harvest.');
    }
}

// =====================================================
// SUMMARY
// =====================================================

function renderHarvestSummary() {
    const cropTypes = new Set(currentHarvests.map(getCropName));

    const totalVerified = currentContributions.reduce(
        (sum, contribution) => sum + Number(contribution.quantity_added || 0),
        0
    );

    const totalAvailable = currentProduce.reduce(
        (sum, produce) => sum + getAvailableQuantity(produce),
        0
    );

    const grid = el('div', 'wo-inventory-summary-grid');

    grid.append(
        createSummaryCard('Crop Types', cropTypes.size, 'Confirmed crop varieties'),
        createSummaryCard('Total Verified Quantity', formatNumber(totalVerified), 'Quantity added to warehouse'),
        createSummaryCard('Available Stock', formatNumber(totalAvailable), 'Produce currently available'),
        createSummaryCard('Verified Harvest Records', currentHarvests.length, 'Confirmed harvest submissions')
    );

    return grid;
}

// =====================================================
// REALTIME
// =====================================================

function subscribeHarvestRealtime() {
    if (realtimeChannel) return;

    realtimeChannel = supabase
        .channel('warehouse-harvest-inventory-realtime')
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'warehouse_produce_inventory'
        }, scheduleHarvestRefresh)
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'warehouse_produce_harvests'
        }, scheduleHarvestRefresh)
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'harvested_crops'
        }, scheduleHarvestRefresh)
        .subscribe();
}

let refreshTimer = null;

function scheduleHarvestRefresh() {
    if (!currentRoot) return;

    if (refreshTimer) clearTimeout(refreshTimer);

    refreshTimer = setTimeout(async () => {
        refreshTimer = null;

        if (!currentRoot) return;

        await loadHarvestInventory();

    }, 250);
}

// =====================================================
// MAIN HARVEST INVENTORY
// =====================================================

export async function loadHarvestInventory() {
    if (!currentRoot) return;

    const root = currentRoot;
    const thisLoadId = ++loadId;

    const isCurrentLoad = () =>
        thisLoadId === loadId &&
        root === currentRoot &&
        root.isConnected;

    try {
        await loadHarvestData();

        if (!isCurrentLoad()) return;

        const page = el('div', 'wo-harvest-inventory-content');
        page.append(renderHarvestSummary());

        const produceSection = el('section', 'wo-harvest-produce-section');

        produceSection.append(
            el('h2', 'wo-inventory-section-title', 'Warehouse Produce')
        );

        const produceGrid = el('div', 'wo-inventory-card-grid');

        if (!currentProduce.length) {
            produceGrid.append(
                el('p', 'wo-inventory-empty', 'No warehouse produce records found.')
            );
        } else {
            const cards = await Promise.all(
                currentProduce.map(produce => createProduceCard(produce))
            );

            if (!isCurrentLoad()) return;
            produceGrid.append(...cards);
        }

        produceSection.append(produceGrid);
        page.append(produceSection);

        harvestContributions = createHarvestContributionsSection();

        page.append(harvestContributions.element);

        const eligibleSection = el('section', 'wo-confirmed-harvest-section');

        eligibleSection.append(
            el('h2', 'wo-inventory-section-title', 'Confirmed Harvests Not Yet Added'),
            renderEligibleHarvests()
        );

        page.append(eligibleSection);

        if (!isCurrentLoad()) return;

        const previous = root.querySelector('.wo-harvest-inventory-content');

        if (previous) previous.replaceWith(page);
        else root.append(page);

        if (harvestContributions?.load) {
            await harvestContributions.load();
        }

    } catch (error) {
        if (!isCurrentLoad()) return;

        console.error('Harvest inventory loading error:', error);

        const errorBox = el(
            'p',
            'wo-inventory-message error',
            error.message || 'Unable to load harvest inventory.'
        );

        const previous = root.querySelector('.wo-harvest-inventory-content');

        if (previous) previous.replaceWith(errorBox);
        else root.append(errorBox);
    }
}

// =====================================================
// MODULE ENTRY POINTS
// =====================================================

export async function render(root) {
    currentRoot = root;
    loadId++;

    closeModal();
    subscribeHarvestRealtime();

    await loadHarvestInventory();
}

export function cleanup() {
    loadId++;

    closeModal();

    if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
    }

    if (realtimeChannel) {
        supabase.removeChannel(realtimeChannel);
        realtimeChannel = null;
    }

    currentRoot = null;
    currentProduce = [];
    currentContributions = [];
    currentHarvests = [];
    harvestContributions = null;
}
