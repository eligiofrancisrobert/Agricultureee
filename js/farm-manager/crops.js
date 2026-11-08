
import { supabase } from '../connection.js';

const root = document.getElementById('view');

const TABLE = 'crops_catalog';
const PAGE_SIZE = 10;

let crops = [];
let managerId = null;
let searchTerm = '';
let statusFilter = 'active';
let currentPage = 1;
let editingCrop = null;
let busy = false;

const $ = (selector) => root?.querySelector(selector);

const escapeHTML = (value = '') =>
    String(value).replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[char]);

const formatDate = (value) => {
    if (!value) return '—';

    const date = new Date(value);

    return Number.isNaN(date.getTime())
        ? '—'
        : date.toLocaleDateString('en-PH', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
};

function notify(message, type = 'error') {
    const messageBox = $('#cropMessage');

    if (messageBox) {
        messageBox.textContent = message;
        messageBox.className =
            `crop-message ${type === 'error' ? 'crop-error' : 'crop-success'}`;
        messageBox.hidden = false;
        return;
    }

    // Fallback if the page is not currently mounted.
    console[type === 'error' ? 'error' : 'log'](message);
}

function setBusy(value) {
    busy = value;

    root?.querySelectorAll(
        '#addCropButton, #cropForm button[type="submit"]'
    ).forEach((button) => {
        button.disabled = value;
    });
}

async function getManagerAccount() {
    const {
        data: { user },
        error: authError
    } = await supabase.auth.getUser();

    if (authError) throw authError;

    if (!user) {
        throw new Error('Your session has expired. Please log in again.');
    }

    const { data, error } = await supabase
        .from('staff_accounts')
        .select('staff_id, role_id, status_id')
        .eq('user_id', user.id)
        .maybeSingle();

    if (error) throw error;

    if (!data || data.role_id !== 1 || data.status_id !== 1) {
        throw new Error('An active Farm Manager account is required.');
    }

    return data.staff_id;
}

function getVisibleCrops() {
    const term = searchTerm.trim().toLowerCase();

    return crops.filter((crop) => {
        const name = (crop.crops_name || '').toLowerCase();
        const description = (crop.crops_description || '').toLowerCase();

        const matchesSearch =
            !term || name.includes(term) || description.includes(term);

        const deleted = Boolean(crop.crops_date_deleted);

        let matchesStatus;

        switch (statusFilter) {
            case 'active':
                matchesStatus = !deleted && crop.is_active;
                break;
            case 'inactive':
                matchesStatus = !deleted && !crop.is_active;
                break;
            case 'deleted':
                matchesStatus = deleted;
                break;
            case 'all':
                matchesStatus = true;
                break;
            default:
                matchesStatus = !deleted && crop.is_active;
        }

        return matchesSearch && matchesStatus;
    });
}

function renderStats() {
    const stats = $('#cropStats');
    if (!stats) return;

    const active = crops.filter(
        (crop) => !crop.crops_date_deleted && crop.is_active
    ).length;

    const inactive = crops.filter(
        (crop) => !crop.crops_date_deleted && !crop.is_active
    ).length;

    const deleted = crops.filter(
        (crop) => Boolean(crop.crops_date_deleted)
    ).length;

    stats.innerHTML = `
        <div class="crop-stat">
            <div class="crop-stat-label">Active Crops</div>
            <div class="crop-stat-value">${active}</div>
        </div>

        <div class="crop-stat">
            <div class="crop-stat-label">Inactive / Out of Season</div>
            <div class="crop-stat-value">${inactive}</div>
        </div>

        <div class="crop-stat">
            <div class="crop-stat-label">Deleted Crops</div>
            <div class="crop-stat-value">${deleted}</div>
        </div>
    `;
}

function statusMarkup(crop) {
    if (crop.crops_date_deleted) {
        return '<span class="crop-badge crop-badge-deleted">Deleted</span>';
    }

    if (crop.is_active) {
        return '<span class="crop-badge crop-badge-active">Active</span>';
    }

    return '<span class="crop-badge crop-badge-inactive">Inactive</span>';
}

function actionMarkup(crop) {
    const id = escapeHTML(crop.crops_id);

    if (crop.crops_date_deleted) {
        return `
            <button type="button" class="crop-btn"
                data-action="restore" data-id="${id}">
                Restore
            </button>
        `;
    }

    return `
        <button type="button" class="crop-btn"
            data-action="edit" data-id="${id}">
            Edit
        </button>

        <button type="button" class="crop-btn"
            data-action="toggle" data-id="${id}">
            ${crop.is_active ? 'Deactivate' : 'Reactivate'}
        </button>

        <button type="button" class="crop-btn crop-btn-danger"
            data-action="delete" data-id="${id}">
            Delete
        </button>
    `;
}

function renderTable() {
    const tbody = $('#cropTableBody');
    const count = $('#cropCount');
    const pagination = $('#cropPagination');

    if (!tbody || !pagination) return;

    const filtered = getVisibleCrops();
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

    currentPage = Math.min(currentPage, totalPages);

    const start = (currentPage - 1) * PAGE_SIZE;
    const visible = filtered.slice(start, start + PAGE_SIZE);

    if (count) {
        count.textContent = `${filtered.length} crop(s)`;
    }

    if (!visible.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="crop-empty">
                    No crops found.
                </td>
            </tr>
        `;
    } else {
        tbody.innerHTML = visible.map((crop) => `
            <tr>
                <td>
                    <div class="crop-name">
                        ${escapeHTML(crop.crops_name)}
                    </div>
                    <div class="crop-desc">
                        ${escapeHTML(crop.crops_description || 'No description')}
                    </div>
                </td>

                <td>${statusMarkup(crop)}</td>

                <td>${formatDate(crop.crops_date_updated)}</td>

                <td>
                    <div class="crop-actions">
                        ${actionMarkup(crop)}
                    </div>
                </td>
            </tr>
        `).join('');
    }

    pagination.innerHTML = `
        <span>Page ${currentPage} of ${totalPages}</span>

        <div class="crop-actions">
            <button type="button" class="crop-btn"
                data-action="previous" ${currentPage <= 1 ? 'disabled' : ''}>
                Previous
            </button>

            <button type="button" class="crop-btn"
                data-action="next" ${currentPage >= totalPages ? 'disabled' : ''}>
                Next
            </button>
        </div>
    `;
}


/** Fetch this manager's crop catalog and refresh the statistics and table. */
async function loadCrops() {
    if (!managerId) {
        throw new Error('Farm Manager account could not be identified.');
    }

    const { data, error } = await supabase
        .from('crops_catalog')
        .select(`
            crops_id,
            crops_name,
            crops_description,
            crops_date_add,
            crops_date_updated,
            crops_date_deleted,
            is_active,
            farm_manager_id
        `)
        .eq('farm_manager_id', managerId)
        .order('crops_name', { ascending: true });

    if (error) {
        console.error('Failed to load crops:', error);
        throw error;
    }

    // Store only this manager's crops in the page state.
    crops = data ?? [];

    // Refresh the statistics and table.
    renderStats();
    renderTable();
}


function openModal(crop = null) {
    editingCrop = crop;

    const modal = $('#cropModal');
    if (!modal) return;

    modal.hidden = false;

    modal.innerHTML = `
        <div class="crop-modal-backdrop" data-action="backdrop">
            <section class="crop-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="cropModalTitle">

                <h2 id="cropModalTitle">
                    ${crop ? 'Edit Crop' : 'Add Crop'}
                </h2>

                <p class="crop-desc">
                    ${crop
            ? 'Update the crop name or description.'
            : 'Add a crop to the central crop catalog.'}
                </p>

                <form id="cropForm">
                    <div class="crop-field">
                        <label for="cropName">Crop Name *</label>
                        <input
                            id="cropName"
                            name="crops_name"
                            maxlength="120"
                            required
                            autocomplete="off"
                            value="${escapeHTML(crop?.crops_name || '')}"
                        >
                    </div>

                    <div class="crop-field">
                        <label for="cropDescription">Description</label>
                        <textarea
                            id="cropDescription"
                            name="crops_description"
                            maxlength="1000"
                            placeholder="Optional crop description..."
                        >${escapeHTML(crop?.crops_description || '')}</textarea>
                    </div>

                    <div id="cropFormError"
                        class="crop-message crop-error" hidden></div>

                    <div class="crop-modal-actions">
                        <button type="button" class="crop-btn"
                            data-action="close-modal">
                            Cancel
                        </button>

                        <button type="submit"
                            class="crop-btn crop-btn-primary">
                            ${crop ? 'Save Changes' : 'Add Crop'}
                        </button>
                    </div>
                </form>
            </section>
        </div>
    `;

    $('#cropName')?.focus();
}

function closeModal() {
    const modal = $('#cropModal');

    if (modal) {
        modal.hidden = true;
        modal.innerHTML = '';
    }

    editingCrop = null;
}

/** Validate and persist the crop form, then refresh the catalog display. */
async function saveCrop(form) {
    if (busy) return;

    const name = form.elements.crops_name.value.trim();
    const description =
        form.elements.crops_description.value.trim() || null;

    const errorBox = $('#cropFormError');

    if (!name) {
        errorBox.textContent = 'Crop name is required.';
        errorBox.hidden = false;
        return;
    }

    if (name.length > 120) {
        errorBox.textContent = 'Crop name must not exceed 120 characters.';
        errorBox.hidden = false;
        return;
    }

    setBusy(true);

    try {
        if (editingCrop) {
            const { error } = await supabase
                .from(TABLE)
                .update({
                    crops_name: name,
                    crops_description: description
                })
                .eq('crops_id', editingCrop.crops_id)
                .is('crops_date_deleted', null);

            if (error) throw error;

            notify('Crop updated successfully.', 'success');
        } else {
            const { error } = await supabase
                .from(TABLE)
                .insert({
                    crops_name: name,
                    crops_description: description,
                    farm_manager_id: managerId
                });

            if (error) throw error;

            notify('Crop added successfully.', 'success');
        }

        closeModal();
        await loadCrops();
    } catch (error) {
        console.error('Failed to save crop:', error);

        if (errorBox) {
            errorBox.textContent =
                error.code === '23505'
                    ? 'A crop with this name already exists.'
                    : error.message || 'Unable to save crop.';

            errorBox.hidden = false;
        }
    } finally {
        setBusy(false);
    }
}

async function updateCrop(id, changes, successMessage) {
    if (busy) return;

    setBusy(true);

    try {
        const { error } = await supabase
            .from(TABLE)
            .update(changes)
            .eq('crops_id', id);

        if (error) throw error;

        notify(successMessage, 'success');
        await loadCrops();
    } catch (error) {
        console.error('Failed to update crop:', error);
        notify(error.message || 'Unable to update crop.');
    } finally {
        setBusy(false);
    }
}

async function handleRowAction(action, id) {
    if (action === 'previous') {
        currentPage = Math.max(1, currentPage - 1);
        renderTable();
        return;
    }

    if (action === 'next') {
        const totalPages = Math.max(
            1,
            Math.ceil(getVisibleCrops().length / PAGE_SIZE)
        );

        currentPage = Math.min(totalPages, currentPage + 1);
        renderTable();
        return;
    }

    const crop = crops.find((item) => String(item.crops_id) === String(id));
    if (!crop) return;

    if (action === 'edit') {
        openModal(crop);
        return;
    }

    if (action === 'toggle') {
        const activate = !crop.is_active;

        const confirmed = window.confirm(
            activate
                ? `Reactivate "${crop.crops_name}" for new plantings?`
                : `Deactivate "${crop.crops_name}"? It will no longer be available for new plantings.`
        );

        if (!confirmed) return;

        await updateCrop(
            crop.crops_id,
            { is_active: activate },
            activate ? 'Crop reactivated.' : 'Crop deactivated.'
        );

        return;
    }

    if (action === 'delete') {
        const confirmed = window.confirm(
            `Soft-delete "${crop.crops_name}"? Historical records will be retained.`
        );

        if (!confirmed) return;

        await updateCrop(
            crop.crops_id,
            {
                crops_date_deleted: new Date().toISOString(),
                is_active: false
            },
            'Crop moved to deleted records.'
        );

        return;
    }

    if (action === 'restore') {
        const confirmed = window.confirm(
            `Restore "${crop.crops_name}" to the crop catalog?`
        );

        if (!confirmed) return;

        await updateCrop(
            crop.crops_id,
            {
                crops_date_deleted: null,
                is_active: true
            },
            'Crop restored and activated.'
        );
    }
}

function bindEvents() {
    // Avoid adding duplicate listeners if the route is initialized again.
    if (root.dataset.cropsBound === 'true') return;
    root.dataset.cropsBound = 'true';

    root.addEventListener('click', async (event) => {
        const actionElement = event.target.closest('[data-action]');

        if (actionElement && root.contains(actionElement)) {
            const action = actionElement.dataset.action;
            const id = actionElement.dataset.id;

            if (action === 'close-modal') {
                closeModal();
                return;
            }

            if (action === 'backdrop' && event.target === actionElement) {
                closeModal();
                return;
            }

            if (action === 'previous' || action === 'next') {
                await handleRowAction(action);
                return;
            }

            if (id) {
                await handleRowAction(action, id);
                return;
            }
        }

        if (event.target.closest('#addCropButton')) {
            openModal();
        }
    });

    root.addEventListener('submit', async (event) => {
        if (event.target.id !== 'cropForm') return;

        event.preventDefault();
        await saveCrop(event.target);
    });

    root.addEventListener('input', (event) => {
        if (event.target.id === 'cropSearch') {
            searchTerm = event.target.value;
            currentPage = 1;
            renderTable();
        }
    });

    root.addEventListener('change', (event) => {
        if (event.target.id === 'cropStatusFilter') {
            statusFilter = event.target.value;
            currentPage = 1;
            renderTable();
        }
    });

    root.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !$('#cropModal')?.hidden) {
            closeModal();
        }
    });
}

function renderPage() {
    root.innerHTML = `
        <section class="fm-crops">
            <header class="crops-header">
                <div>
                    <h1 class="crops-title">Crop Catalog</h1>
                    <p class="crops-subtitle">
                        Manage crop types and seasonal availability.
                    </p>
                </div>

                <button type="button"
                    id="addCropButton"
                    class="crop-btn crop-btn-primary">
                    + Add Crop
                </button>
            </header>

            <div id="cropMessage" class="crop-message" hidden></div>

            <div id="cropStats" class="crop-stats"></div>

            <section class="crop-panel">
                <div class="crop-toolbar">
                    <div class="crop-toolbar-left">
                        <input
                            id="cropSearch"
                            class="crop-search"
                            type="search"
                            placeholder="Search crop name or description..."
                            aria-label="Search crops"
                        >

                        <select
                            id="cropStatusFilter"
                            class="crop-filter"
                            aria-label="Filter crop status">
                            <option value="active">Active crops</option>
                            <option value="inactive">Inactive crops</option>
                            <option value="deleted">Deleted crops</option>
                            <option value="all">All crops</option>
                        </select>
                    </div>

                    <span id="cropCount">0 crops</span>
                </div>

                <div class="crop-table-wrap">
                    <table class="crop-table">
                        <thead>
                            <tr>
                                <th>Crop</th>
                                <th>Status</th>
                                <th>Last Updated</th>
                                <th>Actions</th>
                            </tr>
                        </thead>

                        <tbody id="cropTableBody">
                            <tr>
                                <td colspan="4" class="crop-empty">
                                    Loading crops...
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div id="cropPagination" class="crop-pagination"></div>
            </section>

            <div id="cropModal" hidden></div>
        </section>
    `;
}

/** Initialize the crop catalog view, including its filters and editor actions. */
export async function render(container, ctx) {
    if (!container) {
        console.error('Farm Manager page root #view was not found.');
        return;
    }

    // The main router passes the page container.
    // Keep the shared root reference synchronized.
    renderPage();
    bindEvents();

    try {
        managerId = await getManagerAccount();
        await loadCrops();
    } catch (error) {
        console.error('Crop catalog initialization failed:', error);
        notify(error.message || 'Unable to initialize the crop catalog.');
    }
}
