import { supabase } from '../connection.js';
import {
    createHarvestContributionsSection
} from './harvest-contributions.js';

const LOW_STOCK_THRESHOLD = 10;
const STORAGE_BUCKET = 'warehouse-inventory-photos';
const MAX_PHOTO_SIZE = 3 * 1024 * 1024;
const SIGNED_URL_EXPIRY = 3600;

const ALLOWED_PHOTO_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp'
];

let activeObjectUrls = new Set();
let activeModal = null;

/* =========================================================
GENERAL HELPERS
========================================================= */

function el(tag, className = '', text = '') {
    const node = document.createElement(tag);

    if (className) node.className = className;

    if (text !== undefined && text !== null) {
        node.textContent = text;
    }

    return node;
}

function button(text, className, onClick) {
    const node = el('button', className, text);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
}

function showMessage(container, message, type = 'info') {
    container.replaceChildren(
        el('p', `wo-inventory-message ${type}`, message)
    );
}

function formatNumber(value) {
    return Number(value || 0).toLocaleString('en-PH', {
        maximumFractionDigits: 2
    });
}

function formatDate(value) {
    if (!value) return '—';

    return new Date(value).toLocaleDateString('en-PH', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function formatDateTime(value) {
    if (!value) return '—';

    return new Date(value).toLocaleString('en-PH', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
}

function capitalize(value) {
    const text = String(value || '');
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function createSummaryCard(label, value, description) {
    const card = el('article', 'wo-stat-card');

    card.append(
        el('span', 'wo-stat-label', label),
        el('strong', 'wo-stat-value', String(value)),
        el('small', 'wo-stat-description', description)
    );

    return card;
}

function createTable(headers, rows) {
    const wrapper = el('div', 'wo-inventory-table-wrapper');
    const table = el('table', 'wo-inventory-table');
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');

    headers.forEach(header => {
        headerRow.append(el('th', '', header));
    });

    thead.append(headerRow);

    const tbody = document.createElement('tbody');

    rows.forEach(row => tbody.append(row));

    if (!rows.length) {
        const emptyRow = document.createElement('tr');
        const cell = el('td', 'wo-inventory-empty', 'No records found.');

        cell.colSpan = headers.length;
        emptyRow.append(cell);
        tbody.append(emptyRow);
    }

    table.append(thead, tbody);
    wrapper.append(table);

    return wrapper;
}

function createField(labelText, input, required = false) {
    const label = el('label', 'wo-inventory-field');

    label.append(
        el('span', '', `${labelText}${required ? ' *' : ''}`),
        input
    );

    return label;
}

function createInput({
    type = 'text',
    name,
    value = '',
    placeholder = '',
    min,
    max,
    step,
    required = false,
    maxLength
} = {}) {
    const input = el('input');

    input.type = type;

    if (name) input.name = name;
    if (value !== undefined && value !== null) input.value = value;
    if (placeholder) input.placeholder = placeholder;
    if (min !== undefined) input.min = min;
    if (max !== undefined) input.max = max;
    if (step !== undefined) input.step = step;
    if (maxLength !== undefined) input.maxLength = maxLength;

    input.required = required;

    return input;
}

function createSelect(options, placeholder = 'Select an option') {
    const select = el('select');

    const first = el('option', '', placeholder);
    first.value = '';
    first.disabled = true;
    first.selected = true;

    select.append(first);

    options.forEach(optionData => {
        const option = el('option', '', optionData.label);
        option.value = optionData.value;

        select.append(option);
    });

    return select;
}

function setFormMessage(message, text, type = 'error') {
    message.textContent = text;
    message.className = `wo-inventory-form-message ${type}`;
}

/** Return the authenticated user's ID or throw when the session is missing. */
async function getCurrentUserId() {
    const { data, error } = await supabase.auth.getUser();

    if (error) throw error;

    const userId = data?.user?.id;

    if (!userId) {
        throw new Error('Your session has expired. Please log in again.');
    }

    return userId;
}


/* =========================================================
PERMISSION HELPERS
========================================================= */

const permissionCache = new Map();

async function hasPermission(permission) {
    if (!permission) return false;

    if (permissionCache.has(permission)) {
        return permissionCache.get(permission);
    }

    const { data, error } = await supabase.rpc(
        'has_tanikala_permission',
        { p_permission_key: permission }
    );

    if (error) {
        console.error(`Permission check failed (${permission}):`, error);
        return false;
    }

    const allowed = data === true;
    permissionCache.set(permission, allowed);

    return allowed;
}

async function requirePermission(permission) {
    const allowed = await hasPermission(permission);

    if (!allowed) {
        throw new Error('You do not have permission to perform this action.');
    }

    return true;
}

function getInventoryPermissions(category) {
    if (category === 'Fertilizer') {
        return {
            view: 'fertilizer_inventory.view',
            create: 'fertilizer_inventory.create',
            edit: 'fertilizer_inventory.edit',
            delete: 'fertilizer_inventory.delete',
            manage: 'fertilizer.manage'
        };
    }

    if (category === 'Pesticide') {
        return {
            view: 'pesticide_inventory.view',
            create: 'pesticide_inventory.create',
            edit: 'pesticide_inventory.edit',
            delete: 'pesticide_inventory.delete',
            manage: 'pesticide.manage'
        };
    }

    if (category === 'Equipment') {
        return {
            view: 'equipment.view',
            manage: 'inventory.manage',
            issue: 'supplies.issue'
        };
    }

    return {
        view: 'inventory.view',
        manage: 'inventory.manage'
    };
}


/* =========================================================
PHOTO HELPERS
========================================================= */

const photoUrlCache = new Map();
const PHOTO_CACHE_DURATION = 55 * 60 * 1000;

function sanitizeFileName(fileName) {
    return fileName
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, '-')
        .replace(/-+/g, '-');
}

function validatePhoto(file) {
    if (!file) return;

    if (!ALLOWED_PHOTO_TYPES.includes(file.type)) {
        throw new Error('Only JPG, PNG, and WEBP images are allowed.');
    }

    if (file.size > MAX_PHOTO_SIZE) {
        throw new Error('Photo must not exceed 3 MB.');
    }
}

async function uploadInventoryPhoto(file, category) {
    if (!file) return null;

    validatePhoto(file);

    const safeCategory = String(category || 'other')
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-');

    let uploadFile = file;

    // Compress large images before uploading.
    if (
        file.type.startsWith('image/') &&
        file.type !== 'image/svg+xml' &&
        file.size > 500 * 1024
    ) {
        try {
            uploadFile = await compressInventoryPhoto(file);
        } catch (error) {
            console.warn('Photo compression skipped:', error);
        }
    }

    const fileName = `${crypto.randomUUID()}-${sanitizeFileName(file.name)}`;
    const filePath = `${safeCategory}/${fileName}`;

    const { data, error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(filePath, uploadFile, {
            cacheControl: '3600',
            upsert: false,
            contentType: uploadFile.type || file.type
        });

    if (error) throw error;

    return data.path;
}

async function compressInventoryPhoto(file) {
    const imageBitmap = await createImageBitmap(file);

    try {
        const maxDimension = 1600;
        const scale = Math.min(
            1,
            maxDimension / Math.max(
                imageBitmap.width,
                imageBitmap.height
            )
        );

        const canvas = document.createElement('canvas');
        canvas.width = Math.round(imageBitmap.width * scale);
        canvas.height = Math.round(imageBitmap.height * scale);

        const context = canvas.getContext('2d');

        context.drawImage(
            imageBitmap,
            0,
            0,
            canvas.width,
            canvas.height
        );

        const blob = await new Promise(resolve => {
            canvas.toBlob(resolve, 'image/webp', 0.78);
        });

        if (!blob) throw new Error('Image compression failed.');

        return new File(
            [blob],
            `${file.name.replace(/\.[^.]+$/, '')}.webp`,
            {
                type: 'image/webp',
                lastModified: Date.now()
            }
        );
    } finally {
        imageBitmap.close();
    }
}

function isDirectPhotoUrl(photoPath) {
    return /^https?:\/\//i.test(String(photoPath || ''));
}

function getCachedPhotoUrl(photoPath) {
    const cached = photoUrlCache.get(photoPath);

    if (!cached) return null;

    if (Date.now() >= cached.expiresAt) {
        photoUrlCache.delete(photoPath);
        return null;
    }

    return cached.url;
}

function cachePhotoUrl(photoPath, url) {
    if (!photoPath || !url) return;

    photoUrlCache.set(photoPath, {
        url,
        expiresAt: Date.now() + PHOTO_CACHE_DURATION
    });
}

/**
 * Batch-load signed URLs for inventory photos.
 * Existing valid URLs are reused from cache.
 */
async function loadPhotoUrls(photoPaths) {
    const uniquePaths = [
        ...new Set(
            (photoPaths || []).filter(path =>
                path && !isDirectPhotoUrl(path)
            )
        )
    ];

    const missingPaths = uniquePaths.filter(
        path => !getCachedPhotoUrl(path)
    );

    if (!missingPaths.length) return;

    const { data, error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .createSignedUrls(
            missingPaths,
            SIGNED_URL_EXPIRY
        );

    if (error) {
        console.error('Unable to batch-load inventory photos:', error);
        return;
    }

    (data || []).forEach(result => {
        if (result.error || !result.signedUrl || !result.path) {
            return;
        }

        cachePhotoUrl(result.path, result.signedUrl);
    });
}

/**
 * Resolve one photo URL.
 * Used by forms and individual photo previews.
 */
async function getPhotoUrl(photoPath) {
    if (!photoPath) return null;

    if (isDirectPhotoUrl(photoPath)) {
        return photoPath;
    }

    const cachedUrl = getCachedPhotoUrl(photoPath);

    if (cachedUrl) return cachedUrl;

    const { data, error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(
            photoPath,
            SIGNED_URL_EXPIRY
        );

    if (error) {
        console.error('Unable to generate photo URL:', error);
        return null;
    }

    const signedUrl = data?.signedUrl || null;

    if (signedUrl) {
        cachePhotoUrl(photoPath, signedUrl);
    }

    return signedUrl;
}

/**
 * Populate photo elements after inventory cards are displayed.
 * This does not block the initial card rendering.
 */
async function loadInventoryPhotos(container) {
    if (!container) return;

    const images = Array.from(
        container.querySelectorAll('img[data-photo-path]')
    );

    if (!images.length) return;

    const photoPaths = images.map(
        image => image.dataset.photoPath
    );

    await loadPhotoUrls(photoPaths);

    images.forEach(image => {
        const photoPath = image.dataset.photoPath;

        if (!photoPath || !image.isConnected) return;

        const photoUrl = getCachedPhotoUrl(photoPath);

        if (!photoUrl) {
            const wrapper = image.closest(
                '.wo-inventory-photo-wrapper'
            );

            if (wrapper) {
                wrapper.replaceChildren(
                    el('span', 'wo-inventory-no-photo', 'Photo unavailable')
                );
            }

            return;
        }

        image.src = photoUrl;
        delete image.dataset.photoPath;
    });
}

async function deleteInventoryPhoto(photoPath) {
    if (!photoPath || isDirectPhotoUrl(photoPath)) return;

    photoUrlCache.delete(photoPath);

    const { error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .remove([photoPath]);

    if (error) {
        console.error('Unable to delete inventory photo:', error);
    }
}

function createPhotoElement(photoPath, altText = 'Inventory photo') {
    const wrapper = el('div', 'wo-inventory-photo-wrapper');

    if (!photoPath) {
        wrapper.append(
            el('span', 'wo-inventory-no-photo', 'No photo')
        );

        return wrapper;
    }

    const image = el('img', 'wo-inventory-photo');

    image.alt = altText;
    image.loading = 'lazy';
    image.decoding = 'async';

    if (isDirectPhotoUrl(photoPath)) {
        image.src = photoPath;
    } else {
        image.dataset.photoPath = photoPath;

        wrapper.append(
            el('span', 'wo-inventory-no-photo', 'Loading photo...')
        );
    }

    image.addEventListener('load', () => {
        wrapper.querySelector('.wo-inventory-no-photo')?.remove();
    });

    image.addEventListener('error', () => {
        wrapper.replaceChildren(
            el('span', 'wo-inventory-no-photo', 'Photo unavailable')
        );
    });

    wrapper.append(image);

    return wrapper;
}

function createPhotoInput(
    currentPhotoUrl = null,
    labelText = 'Item Photo (Optional)'
) {
    const wrapper = el('div', 'wo-inventory-photo-input-wrapper');

    const label = el('label', '', labelText);
    const input = el('input');

    input.type = 'file';
    input.name = 'photo';
    input.accept = 'image/jpeg,image/png,image/webp';

    const hint = el(
        'small',
        'wo-inventory-photo-hint',
        'JPG, PNG, or WEBP. Maximum file size: 3 MB.'
    );

    const preview = el('div', 'wo-inventory-photo-preview');

    if (currentPhotoUrl) {
        const image = el('img');
        image.src = currentPhotoUrl;
        image.alt = 'Current photo';
        image.loading = 'lazy';
        image.decoding = 'async';

        preview.append(image);
    } else {
        preview.append(
            el('span', 'wo-inventory-no-photo', 'No photo selected')
        );
    }

    let currentObjectUrl = null;

    input.addEventListener('change', () => {
        if (currentObjectUrl) {
            URL.revokeObjectURL(currentObjectUrl);
            activeObjectUrls.delete(currentObjectUrl);
            currentObjectUrl = null;
        }

        const file = input.files?.[0];

        if (!file) {
            preview.replaceChildren(
                el('span', 'wo-inventory-no-photo', 'No photo selected')
            );
            return;
        }

        try {
            validatePhoto(file);
        } catch (error) {
            input.value = '';

            preview.replaceChildren(
                el('span', 'wo-inventory-no-photo', 'Invalid photo')
            );

            showAlert(error.message, 'error', 'Invalid photo');
            return;
        }

        currentObjectUrl = URL.createObjectURL(file);
        activeObjectUrls.add(currentObjectUrl);

        const image = el('img');
        image.src = currentObjectUrl;
        image.alt = 'Selected photo';
        image.decoding = 'async';

        preview.replaceChildren(image);
    });

    label.append(input);
    wrapper.append(label, hint, preview);

    return {
        wrapper,
        input
    };
}

function revokeObjectUrls() {
    activeObjectUrls.forEach(url => URL.revokeObjectURL(url));
    activeObjectUrls.clear();
}


/* =========================================================
MODAL
========================================================= */

function closeModal() {
    if (!activeModal) return;

    document.removeEventListener('keydown', activeModal.onKey);
    activeModal.overlay.remove();
    document.body.classList.remove('wo-modal-open');
    activeModal.previouslyFocused?.focus?.();

    activeModal = null;
}

function openModal(form) {
    closeModal();

    const overlay = el('div', 'wo-modal-overlay');
    const dialog = el('div', 'wo-modal');

    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const closeButton = button('×', 'wo-modal-close', closeModal);
    closeButton.setAttribute('aria-label', 'Close');

    dialog.append(closeButton, form);
    overlay.append(dialog);

    overlay.addEventListener('mousedown', event => {
        if (event.target === overlay) closeModal();
    });

    const onKey = event => {
        if (event.key === 'Escape') closeModal();
    };

    document.addEventListener('keydown', onKey);
    document.body.append(overlay);
    document.body.classList.add('wo-modal-open');

    activeModal = {
        overlay,
        onKey,
        previouslyFocused: document.activeElement
    };

    form.querySelector('input:not([type="file"]), select')?.focus();
}

/* =========================================================
CUSTOM DIALOGS (replaces native alert() / confirm())
========================================================= */

let activeDialog = null;

function injectDialogStyles() {
    if (document.getElementById('wo-dialog-styles')) return;

    const style = document.createElement('style');
    style.id = 'wo-dialog-styles';
    style.textContent = `
        .wo-dialog-overlay {
            position: fixed;
            inset: 0;
            z-index: 100000;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 1rem;
            background: rgba(0, 0, 0, 0.5);
        }
        .wo-dialog {
            width: 100%;
            max-width: 26rem;
            padding: 1.5rem;
            border-radius: 12px;
            border-top: 5px solid #2563eb;
            background: var(--surface, #fff);
            color: var(--text, #1f2937);
            box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
        }
        .wo-dialog.error,
        .wo-dialog.danger { border-top-color: #dc2626; }
        .wo-dialog.success { border-top-color: #16a34a; }
        .wo-dialog.warning { border-top-color: #d97706; }
        .wo-dialog-title {
            margin: 0 0 0.5rem;
            font-size: 1.15rem;
        }
        .wo-dialog-message {
            margin: 0 0 1.25rem;
            line-height: 1.5;
            white-space: pre-wrap;
            word-break: break-word;
        }
        .wo-dialog-actions {
            display: flex;
            justify-content: flex-end;
            gap: 0.5rem;
        }
        .wo-dialog-btn {
            padding: 0.55rem 1.1rem;
            border: 1px solid #d1d5db;
            border-radius: 8px;
            background: #f3f4f6;
            color: #1f2937;
            font: inherit;
            cursor: pointer;
        }
        .wo-dialog-btn.primary {
            border-color: #2563eb;
            background: #2563eb;
            color: #fff;
        }
        .wo-dialog-btn.danger {
            border-color: #dc2626;
            background: #dc2626;
            color: #fff;
        }
        .wo-dialog-btn:focus-visible {
            outline: 3px solid rgba(37, 99, 235, 0.45);
            outline-offset: 2px;
        }
    `;

    document.head.append(style);
}

/** Close the active custom dialog. Resolves its promise with `result`. */
function closeActiveDialog(result = false) {
    if (!activeDialog) return;

    const { overlay, onKey, previouslyFocused, resolve } = activeDialog;

    window.removeEventListener('keydown', onKey, true);
    overlay.remove();
    activeDialog = null;

    previouslyFocused?.focus?.();
    resolve(result);
}

function openDialog({
    title,
    message,
    type = 'info',
    confirmText = 'OK',
    cancelText = 'Cancel',
    showCancel = false
}) {
    injectDialogStyles();
    closeActiveDialog(false);

    return new Promise(resolve => {
        const overlay = el('div', 'wo-dialog-overlay');
        const dialog = el('div', `wo-dialog ${type}`);

        const titleId = `wo-dialog-title-${Date.now()}`;
        const messageId = `wo-dialog-message-${Date.now()}`;

        dialog.setAttribute('role', showCancel ? 'alertdialog' : 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', titleId);
        dialog.setAttribute('aria-describedby', messageId);

        const titleNode = el('h3', 'wo-dialog-title', title);
        titleNode.id = titleId;

        const messageNode = el('p', 'wo-dialog-message', message);
        messageNode.id = messageId;

        const actions = el('div', 'wo-dialog-actions');

        const confirmButton = button(
            confirmText,
            `wo-dialog-btn ${type === 'danger' ? 'danger' : 'primary'}`,
            () => closeActiveDialog(true)
        );

        if (showCancel) {
            actions.append(
                button(
                    cancelText,
                    'wo-dialog-btn',
                    () => closeActiveDialog(false)
                )
            );
        }

        actions.append(confirmButton);
        dialog.append(titleNode, messageNode, actions);
        overlay.append(dialog);

        // Alerts can be dismissed by clicking outside; confirms cannot.
        overlay.addEventListener('mousedown', event => {
            if (event.target === overlay && !showCancel) {
                closeActiveDialog(true);
            }
        });

        const onKey = event => {
            // Stop the underlying form modal from also reacting to the key.
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopImmediatePropagation();
                closeActiveDialog(false);
                return;
            }

            if (event.key === 'Tab') {
                const focusable = Array.from(
                    dialog.querySelectorAll('button:not([disabled])')
                );

                if (!focusable.length) return;

                const first = focusable[0];
                const last = focusable[focusable.length - 1];

                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            }
        };

        window.addEventListener('keydown', onKey, true);
        document.body.append(overlay);

        activeDialog = {
            overlay,
            onKey,
            resolve,
            previouslyFocused: document.activeElement
        };

        confirmButton.focus();
    });
}

/** Replacement for alert(). */
function showAlert(message, type = 'error', title = '') {
    const defaultTitles = {
        error: 'Something went wrong',
        success: 'Success',
        warning: 'Warning',
        info: 'Notice'
    };

    return openDialog({
        title: title || defaultTitles[type] || 'Notice',
        message: String(message || ''),
        type
    });
}

/** Replacement for confirm(). Resolves true or false. */
function showConfirm(message, {
    title = 'Please confirm',
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    danger = false
} = {}) {
    return openDialog({
        title,
        message: String(message || ''),
        type: danger ? 'danger' : 'warning',
        confirmText,
        cancelText,
        showCancel: true
    });
}

/* =========================================================
SHARED INVENTORY CARD
========================================================= */



function createInventoryCard({
    photoPath,
    title,
    details = [],
    onEdit,
    onDelete,
    onReplenish,
    replenishPending = false,
    deleteLabel = 'Delete',
    canEdit = true,
    canDelete = true,
    canReplenish = true
}) {
    const card = el('article', 'wo-inventory-card');

    const front = el('div', 'wo-card-face wo-card-front');

    front.setAttribute('role', 'button');
    front.setAttribute('aria-label', `${title}: show details`);
    front.tabIndex = 0;

    const photo = createPhotoElement(
        photoPath,
        `${title} photo`
    );

    photo.classList.add('wo-inventory-card-photo');

    const strip = el('div', 'wo-inventory-card-body');
    strip.append(el('h3', 'wo-inventory-card-title', title));

    front.append(photo, strip);

    const back = el('div', 'wo-card-face wo-card-back');

    const backHeader = el('div', 'wo-card-back-header');

    const backButton = button(
        '← Back',
        'wo-card-back-btn',
        () => setFlipped(false)
    );

    backHeader.append(
        el('h3', 'wo-card-back-title', title),
        backButton
    );

    const list = el('dl', 'wo-inventory-card-details');

    details.forEach(({ label, value }) => {
        const row = el('div', 'wo-inventory-card-detail');

        row.append(
            el('dt', '', label),
            el('dd', '', value)
        );

        list.append(row);
    });

    const actions = el(
        'div',
        'wo-inventory-actions wo-inventory-card-actions'
    );

    if (canEdit && typeof onEdit === 'function') {
        actions.append(
            button('Edit', 'wo-inventory-edit', onEdit)
        );
    }

    if (canDelete && typeof onDelete === 'function') {
        actions.append(
            button(deleteLabel, 'wo-inventory-delete', onDelete)
        );
    }

    if (canReplenish) {
        if (replenishPending) {
            const pendingButton = button(
                'Request Pending',
                'wo-inventory-replenish-pending',
                () => { }
            );

            pendingButton.disabled = true;
            actions.append(pendingButton);

        } else if (typeof onReplenish === 'function') {
            actions.append(
                button(
                    'Replenish',
                    'wo-inventory-replenish',
                    onReplenish
                )
            );
        }
    }

    back.append(backHeader, list);

    if (actions.childElementCount > 0) {
        back.append(actions);
    }

    function setFlipped(flipped) {
        card.classList.toggle('is-flipped', flipped);

        front.inert = flipped;
        back.inert = !flipped;

        front.setAttribute('aria-hidden', String(flipped));
        back.setAttribute('aria-hidden', String(!flipped));

        (flipped ? backButton : front).focus({
            preventScroll: true
        });
    }

    front.inert = false;
    back.inert = true;

    back.setAttribute('aria-hidden', 'true');

    front.addEventListener('click', () => setFlipped(true));

    front.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setFlipped(true);
        }
    });

    card.append(front, back);

    return card;
}



/* =========================================================
INVENTORY ITEM CRUD
========================================================= */

function getToolStatus(quantity) {
    if (quantity <= 0) {
        return { text: 'Out of Stock', className: 'out-of-stock' };
    }

    if (quantity <= LOW_STOCK_THRESHOLD) {
        return { text: 'Low Stock', className: 'low-stock' };
    }

    return { text: 'Available', className: 'available' };
}


function createToolCard(
    item,
    onEdit,
    onDelete,
    onReplenish,
    permissions = {}
) {
    const quantity = Number(item.tool_quantity || 0);
    const status = getToolStatus(quantity);
    const quantityText = `${formatNumber(quantity)} ${item.tool_unit || ''}`.trim();

    const {
        canEdit = true,
        canDelete = true,
        canReplenish = true,
        replenishPending = false
    } = permissions;

    return createInventoryCard({
        photoPath: item.photo_path,
        title: item.tool_name,
        details: [
            { label: 'Category', value: item.tool_category || '—' },
            { label: 'Quantity', value: quantityText },
            { label: 'Stock Status', value: status.text },
            { label: 'Last Updated', value: formatDate(item.updated_at) }
        ],
        onEdit: canEdit
            ? () => onEdit(item)
            : null,
        onDelete: canDelete
            ? () => onDelete(item)
            : null,
        onReplenish: canReplenish && quantity <= LOW_STOCK_THRESHOLD
            ? () => onReplenish(item)
            : null,
        canEdit,
        canDelete,
        canReplenish,
        replenishPending
    });
}


async function renderToolForm(category, item, onSaved) {
    const permissions = getInventoryPermissions(category);

    const permission = item
        ? (permissions.edit || permissions.manage)
        : (permissions.create || permissions.manage);

    try {
        await requirePermission(permission);
    } catch (error) {
        showAlert(error.message, 'error', 'Permission denied');
        return;
    }

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

    const categorySelect = el('select');
    categorySelect.name = 'tool_category';
    categorySelect.required = true;

    [
        'Fertilizer',
        'Pesticide',
        'Equipment',
        'Farm Tools',
        'Other'
    ].forEach(value => {
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

    const actions = el('div', 'wo-inventory-form-actions');

    const saveButton = el(
        'button',
        'wo-inventory-save',
        item ? 'Save Changes' : 'Add Item'
    );

    saveButton.type = 'submit';

    actions.append(
        saveButton,
        button('Cancel', 'wo-inventory-cancel', closeModal)
    );

    const message = el('p', 'wo-inventory-form-message');

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

        saveButton.disabled = true;
        saveButton.textContent = 'Saving...';
        message.textContent = '';

        let uploadedPhotoPath = null;

        try {
            // Recheck permission before database operations.
            await requirePermission(permission);

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
                !Number.isFinite(payload.tool_quantity)
                || payload.tool_quantity < 0
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

            if (result.error) throw result.error;

            if (
                item?.photo_path
                && uploadedPhotoPath
                && item.photo_path !== uploadedPhotoPath
            ) {
                await deleteInventoryPhoto(item.photo_path);
            }

            await onSaved();
            closeModal();

        } catch (error) {
            console.error('Inventory save failed:', error);

            if (uploadedPhotoPath) {
                await deleteInventoryPhoto(uploadedPhotoPath);
            }

            setFormMessage(
                message,
                error.message || 'Unable to save inventory item.'
            );

        } finally {
            saveButton.disabled = false;
            saveButton.textContent = item ? 'Save Changes' : 'Add Item';
        }
    });

    openModal(form);
}
/* =========================================================
WAREHOUSE RPC DATA
========================================================= */

/**
 * Load warehouse people and remove duplicate person entries.
 *
 * A person may be associated with multiple farms.
 * Keep all farm associations while returning only one
 * dropdown entry per person_id.
 */
async function getWarehousePeople() {
    const { data, error } = await supabase.rpc(
        'warehouse_inventory_get_people'
    );

    if (error) throw error;

    const peopleMap = new Map();

    (data || []).forEach(person => {
        const personId = String(person.person_id || '').trim();

        if (!personId) return;

        if (!peopleMap.has(personId)) {
            peopleMap.set(personId, {
                person_id: personId,
                person_name: person.person_name,
                relationship_type: person.relationship_type,
                farm_ids: [],
                farm_names: []
            });
        }

        const uniquePerson = peopleMap.get(personId);

        if (
            person.farm_id
            && !uniquePerson.farm_ids.includes(person.farm_id)
        ) {
            uniquePerson.farm_ids.push(person.farm_id);
        }

        if (
            person.farm_name
            && !uniquePerson.farm_names.includes(person.farm_name)
        ) {
            uniquePerson.farm_names.push(person.farm_name);
        }
    });

    return Array.from(peopleMap.values()).sort((a, b) =>
        String(a.person_name || '').localeCompare(
            String(b.person_name || ''),
            undefined,
            { sensitivity: 'base' }
        )
    );
}

async function getWarehousePlantings() {
    const { data, error } = await supabase.rpc(
        'warehouse_inventory_get_plantings'
    );

    if (error) throw error;

    return (data || []).map(planting => ({
        farm_id: planting.farm_id,
        farm_name: planting.farm_name,
        field_id: planting.field_id,
        field_name: planting.field_name,
        planting_id: planting.planting_id,
        crop_name: planting.crop_name,
        farmer_id: planting.farmer_id,
        farmer_name: planting.farmer_name,
        planting_status: planting.planting_status
    }));
}

function personLabel(person) {
    return person.person_name || 'Unknown person';
}

function plantingLabel(planting) {
    return `${planting.crop_name} — ${planting.field_name} (${planting.farm_name})`;
}

function getSelectedPerson(people, personId, farmId = null) {
    return people.find(person => (
        person.person_id === personId
        && (
            !farmId
            || person.farm_ids.includes(farmId)
        )
    ));
}

function getSelectedPlanting(plantings, plantingId) {
    return plantings.find(item => item.planting_id === plantingId);
}

/* =========================================================
EQUIPMENT: BORROWING
========================================================= */


async function renderEquipmentBorrowForm(item, people, onSaved) {
    try {
        await requirePermission('supplies.issue');
    } catch (error) {
        showAlert(error.message, 'error', 'Permission denied');
        return;
    }

    const form = el('form', 'wo-inventory-form');

    const quantityAvailable = Number(item.tool_quantity || 0);

    const personSelect = createSelect(
        people.map(person => ({
            value: person.person_id,
            label: personLabel(person)
        })),
        'Select borrower'
    );

    const quantityInput = createInput({
        type: 'number',
        name: 'quantity_borrowed',
        min: '0.01',
        max: quantityAvailable,
        step: '0.01',
        required: true,
        value: 1
    });

    const expectedReturnInput = createInput({
        type: 'datetime-local',
        name: 'expected_return_at'
    });

    const notesInput = el('textarea');
    notesInput.name = 'notes';
    notesInput.rows = 3;
    notesInput.placeholder = 'Optional borrowing notes';

    const message = el('p', 'wo-inventory-form-message');

    const saveButton = el(
        'button',
        'wo-inventory-save',
        'Confirm Borrowing'
    );

    saveButton.type = 'submit';

    const actions = el('div', 'wo-inventory-form-actions');

    actions.append(
        saveButton,
        button('Cancel', 'wo-inventory-cancel', closeModal)
    );

    form.append(
        el('h3', '', 'Borrow Equipment'),
        el(
            'p',
            'muted',
            `${item.tool_name} — Available: ${formatNumber(quantityAvailable)} ${item.tool_unit}`
        ),
        createField('Borrower', personSelect, true),
        createField('Quantity to Borrow', quantityInput, true),
        createField('Expected Return', expectedReturnInput),
        createField('Notes', notesInput),
        actions,
        message
    );

    form.addEventListener('submit', async event => {
        event.preventDefault();

        saveButton.disabled = true;
        saveButton.textContent = 'Processing...';

        try {
            await requirePermission('supplies.issue');

            const borrowerId = personSelect.value;
            const quantity = Number(quantityInput.value);

            if (!borrowerId) {
                throw new Error('Please select a borrower.');
            }

            if (!Number.isFinite(quantity) || quantity <= 0) {
                throw new Error(
                    'Borrowed quantity must be greater than zero.'
                );
            }

            if (quantity > quantityAvailable) {
                throw new Error(
                    'Borrowed quantity exceeds available stock.'
                );
            }

            const currentUserId = await getCurrentUserId();

            const borrowedAt = new Date();
            let expectedReturnAt = null;

            if (expectedReturnInput.value) {
                const expectedDate = new Date(
                    expectedReturnInput.value
                );

                if (Number.isNaN(expectedDate.getTime())) {
                    throw new Error('Invalid expected return date.');
                }

                if (expectedDate < borrowedAt) {
                    throw new Error(
                        'Expected return must not be in the past.'
                    );
                }

                expectedReturnAt = expectedDate.toISOString();
            }

            const { error } = await supabase
                .from('warehouse_equipment_borrow')
                .insert({
                    tool_id: item.tool_id,
                    borrower_user_id: borrowerId,
                    quantity_borrowed: quantity,
                    released_by: currentUserId,
                    expected_return_at: expectedReturnAt,
                    notes: notesInput.value.trim() || null
                });

            if (error) throw error;

            await onSaved();
            closeModal();

        } catch (error) {
            console.error('Equipment borrowing failed:', error);

            setFormMessage(
                message,
                error.message || 'Unable to record borrowing.'
            );

        } finally {
            saveButton.disabled = false;
            saveButton.textContent = 'Confirm Borrowing';
        }
    });

    openModal(form);
}

/* =========================================================
EQUIPMENT: RETURNS
========================================================= */

async function renderEquipmentReturnForm(borrow, remaining, people, onSaved) {
    const form = el('form', 'wo-inventory-form');

    const returnedBySelect = createSelect(
        people.map(person => ({
            value: person.person_id,
            label: personLabel(person)
        })),
        'Select person returning equipment'
    );

    const quantityInput = createInput({
        type: 'number',
        name: 'quantity_returned',
        min: '0.01',
        max: remaining,
        step: '0.01',
        required: true,
        value: remaining
    });

    const usableInput = createInput({
        type: 'number',
        name: 'quantity_usable',
        min: 0,
        step: '0.01',
        required: true,
        value: remaining
    });

    const damagedInput = createInput({
        type: 'number',
        name: 'quantity_damaged',
        min: 0,
        step: '0.01',
        required: true,
        value: 0
    });

    const notesInput = el('textarea');
    notesInput.name = 'notes';
    notesInput.rows = 3;

    const message = el('p', 'wo-inventory-form-message');

    const saveButton = el('button', 'wo-inventory-save', 'Record Return');
    saveButton.type = 'submit';

    const actions = el('div', 'wo-inventory-form-actions');

    actions.append(
        saveButton,
        button('Cancel', 'wo-inventory-cancel', closeModal)
    );

    // Keep the usable and damaged quantities equal to the return quantity.
    quantityInput.addEventListener('input', () => {
        const quantity = Number(quantityInput.value);
        const damaged = Number(damagedInput.value || 0);

        usableInput.value = Math.max(0, quantity - damaged);
    });

    damagedInput.addEventListener('input', () => {
        const quantity = Number(quantityInput.value);
        const damaged = Number(damagedInput.value || 0);

        usableInput.value = Math.max(0, quantity - damaged);
    });

    usableInput.addEventListener('input', () => {
        const quantity = Number(quantityInput.value);
        const usable = Number(usableInput.value || 0);

        damagedInput.value = Math.max(0, quantity - usable);
    });

    form.append(
        el('h3', '', 'Return Equipment'),
        el('p', 'muted', `${borrow.tool_name} — Outstanding: ${formatNumber(remaining)} ${borrow.tool_unit}`),
        createField('Returned By', returnedBySelect, true),
        createField('Quantity Returned', quantityInput, true),
        createField('Usable Quantity', usableInput, true),
        createField('Damaged Quantity', damagedInput, true),
        createField('Notes', notesInput),
        actions,
        message
    );

    form.addEventListener('submit', async event => {
        event.preventDefault();

        saveButton.disabled = true;
        saveButton.textContent = 'Processing...';

        try {
            const returnedBy = returnedBySelect.value;

            const quantityReturned = Number(quantityInput.value);
            const quantityUsable = Number(usableInput.value);
            const quantityDamaged = Number(damagedInput.value);

            if (!returnedBy) {
                throw new Error('Please select who returned the equipment.');
            }

            if (
                quantityReturned <= 0
                || quantityReturned > remaining
            ) {
                throw new Error('Invalid return quantity.');
            }

            if (
                quantityUsable < 0
                || quantityDamaged < 0
                || Math.abs(quantityUsable + quantityDamaged - quantityReturned) > 0.0001
            ) {
                throw new Error(
                    'Usable quantity plus damaged quantity must equal the returned quantity.'
                );
            }

            const currentUserId = await getCurrentUserId();

            const { error } = await supabase
                .from('warehouse_equipment_return')
                .insert({
                    borrow_id: borrow.borrow_id,
                    returned_by: returnedBy,
                    received_by: currentUserId,
                    quantity_returned: quantityReturned,
                    quantity_usable: quantityUsable,
                    quantity_damaged: quantityDamaged,
                    notes: notesInput.value.trim() || null
                });

            if (error) throw error;

            await onSaved();
            closeModal();

        } catch (error) {
            console.error('Equipment return failed:', error);
            setFormMessage(message, error.message || 'Unable to record return.');

        } finally {
            saveButton.disabled = false;
            saveButton.textContent = 'Record Return';
        }
    });

    openModal(form);
}

/* =========================================================
EQUIPMENT: INCIDENTS
========================================================= */

async function renderEquipmentIncidentForm(
    borrow,
    remaining,
    onSaved
) {
    const form = el('form', 'wo-inventory-form');

    const typeSelect = createSelect([
        { value: 'lost', label: 'Lost' },
        { value: 'damaged', label: 'Damaged' }
    ], 'Select incident type');
    typeSelect.required = true;

    const quantityInput = createInput({
        type: 'number',
        name: 'quantity_affected',
        min: '0.01',
        max: remaining,
        step: '0.01',
        required: true,
        value: 1
    });

    const descriptionInput = el('textarea');
    descriptionInput.name = 'description';
    descriptionInput.rows = 3;
    descriptionInput.required = true;
    descriptionInput.placeholder = 'Describe what happened';

    const photoField = createPhotoInput(null, 'Evidence Photo (Optional)');

    const message = el('p', 'wo-inventory-form-message');

    const saveButton = el('button', 'wo-inventory-save', 'Record Incident');
    saveButton.type = 'submit';

    const actions = el('div', 'wo-inventory-form-actions');

    actions.append(
        saveButton,
        button('Cancel', 'wo-inventory-cancel', closeModal)
    );

    form.append(
        el('h3', '', 'Report Equipment Incident'),
        el('p', 'muted', `${borrow.tool_name} — Outstanding: ${formatNumber(remaining)} ${borrow.tool_unit}`),
        createField('Incident Type', typeSelect, true),
        createField('Quantity Affected', quantityInput, true),
        createField('Description', descriptionInput, true),
        photoField.wrapper,
        actions,
        message
    );

    form.addEventListener('submit', async event => {
        event.preventDefault();

        saveButton.disabled = true;
        saveButton.textContent = 'Recording...';

        let uploadedPhotoPath = null;

        try {
            const quantity = Number(quantityInput.value);

            if (
                !Number.isFinite(quantity)
                || quantity <= 0
                || quantity > remaining
            ) {
                throw new Error('Invalid incident quantity.');
            }

            if (!descriptionInput.value.trim()) {
                throw new Error('Please describe the incident.');
            }

            const currentUserId = await getCurrentUserId();

            const selectedPhoto = photoField.input.files?.[0];

            if (selectedPhoto) {
                uploadedPhotoPath = await uploadInventoryPhoto(
                    selectedPhoto,
                    'equipment-incidents'
                );
            }

            const { error } = await supabase
                .from('warehouse_equipment_incidents')
                .insert({
                    borrow_id: borrow.borrow_id,
                    responsible_user_id: borrow.borrower_user_id,
                    recorded_by: currentUserId,
                    incident_type: typeSelect.value,
                    quantity_affected: quantity,
                    description: descriptionInput.value.trim(),
                    evidence_photo_path: uploadedPhotoPath
                });

            if (error) throw error;

            await onSaved();
            closeModal();

        } catch (error) {
            console.error('Equipment incident failed:', error);

            if (uploadedPhotoPath) {
                await deleteInventoryPhoto(uploadedPhotoPath);
            }

            setFormMessage(
                message,
                error.message || 'Unable to record incident.'
            );

        } finally {
            saveButton.disabled = false;
            saveButton.textContent = 'Record Incident';
        }
    });

    openModal(form);
}

/* =========================================================
EQUIPMENT: BORROWING / RETURN / INCIDENT HISTORY
========================================================= */

async function loadEquipmentHistory() {
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

    return {
        borrows: borrowResult.data || [],
        returns: returnResult.data || [],
        incidents: incidentResult.data || []
    };
}

function calculateOutstanding(borrow, returns, incidents) {
    const returned = returns
        .filter(item => item.borrow_id === borrow.borrow_id)
        .reduce(
            (sum, item) => sum + Number(item.quantity_returned || 0),
            0
        );

    const affected = incidents
        .filter(item => item.borrow_id === borrow.borrow_id)
        .reduce(
            (sum, item) => sum + Number(item.quantity_affected || 0),
            0
        );

    return Math.max(
        0,
        Number(borrow.quantity_borrowed || 0) - returned - affected
    );
}

function createEquipmentHistorySection(
    title,
    description,
    headers,
    rows
) {
    const section = el('section', 'wo-inventory-section');

    section.append(
        el('h2', '', title),
        el('p', 'muted', description),
        createTable(headers, rows)
    );

    return section;
}


async function renderEquipmentHistory(
    container,
    history,
    people,
    inventory,
    reload
) {
    const canManageTransactions = await hasPermission('supplies.issue');

    const peopleMap = new Map(
        people.map(person => [
            person.person_id,
            person.person_name
        ])
    );

    const inventoryMap = new Map(
        inventory.map(item => [
            item.tool_id,
            item
        ])
    );

    const borrowRows = history.borrows.map(borrow => {
        const row = document.createElement('tr');

        const item = inventoryMap.get(borrow.tool_id);
        const outstanding = calculateOutstanding(
            borrow,
            history.returns,
            history.incidents
        );

        const borrower = peopleMap.get(borrow.borrower_user_id)
            || 'Unknown person';

        const quantityText = `${formatNumber(borrow.quantity_borrowed)} ${item?.tool_unit || ''}`.trim();

        row.append(
            el('td', '', item?.tool_name || 'Unknown equipment'),
            el('td', '', borrower),
            el('td', '', quantityText),
            el('td', '', formatDateTime(borrow.borrowed_at)),
            el('td', '', formatDateTime(borrow.expected_return_at)),
            el(
                'td',
                '',
                `${formatNumber(outstanding)} ${item?.tool_unit || ''}`.trim()
            )
        );

        const actionCell = document.createElement('td');

        if (outstanding > 0 && item) {
            if (canManageTransactions) {
                actionCell.append(
                    button('Return', 'wo-inventory-edit', async () => {
                        try {
                            await requirePermission('supplies.issue');

                            const latestPeople = await getWarehousePeople();

                            await renderEquipmentReturnForm(
                                {
                                    ...borrow,
                                    tool_name: item.tool_name,
                                    tool_unit: item.tool_unit
                                },
                                outstanding,
                                latestPeople,
                                reload
                            );
                        } catch (error) {
                            showAlert(
                                error.message || 'Unable to open return form.',
                                'error',
                                'Unable to open return form'
                            );
                        }
                    }),

                    button('Incident', 'wo-inventory-delete', async () => {
                        try {
                            await requirePermission('supplies.issue');

                            await renderEquipmentIncidentForm(
                                {
                                    ...borrow,
                                    tool_name: item.tool_name,
                                    tool_unit: item.tool_unit
                                },
                                outstanding,
                                reload
                            );
                        } catch (error) {
                            showAlert(
                                error.message || 'Unable to open incident form.',
                                'error',
                                'Unable to open incident form'
                            );
                        }
                    })
                );
            } else {
                actionCell.textContent = 'View only';
            }
        } else {
            actionCell.textContent = 'Completed';
        }

        row.append(actionCell);

        return row;
    });

    const returnRows = history.returns.map(record => {
        const row = document.createElement('tr');

        const borrow = history.borrows.find(
            item => item.borrow_id === record.borrow_id
        );

        const tool = inventoryMap.get(borrow?.tool_id);

        row.append(
            el('td', '', tool?.tool_name || 'Unknown equipment'),
            el('td', '', peopleMap.get(record.returned_by) || 'Unknown person'),
            el('td', '', formatNumber(record.quantity_returned)),
            el('td', '', formatNumber(record.quantity_usable)),
            el('td', '', formatNumber(record.quantity_damaged)),
            el('td', '', formatDateTime(record.returned_at))
        );

        return row;
    });

    const incidentRows = history.incidents.map(record => {
        const row = document.createElement('tr');

        const borrow = history.borrows.find(
            item => item.borrow_id === record.borrow_id
        );

        const tool = inventoryMap.get(borrow?.tool_id);

        row.append(
            el('td', '', tool?.tool_name || 'Unknown equipment'),
            el('td', '', capitalize(record.incident_type)),
            el('td', '', formatNumber(record.quantity_affected)),
            el('td', '', peopleMap.get(record.responsible_user_id) || 'Unknown person'),
            el('td', '', formatDateTime(record.incident_date)),
            el('td', '', record.description || '—')
        );

        return row;
    });

    container.replaceChildren(
        createEquipmentHistorySection(
            'Borrowing Records',
            'Equipment released to farmers or workers.',
            [
                'Equipment',
                'Borrower',
                'Quantity Borrowed',
                'Borrowed At',
                'Expected Return',
                'Outstanding',
                'Actions'
            ],
            borrowRows
        ),
        createEquipmentHistorySection(
            'Return History',
            'Recorded equipment returns and condition breakdown.',
            [
                'Equipment',
                'Returned By',
                'Total Returned',
                'Usable',
                'Damaged',
                'Returned At'
            ],
            returnRows
        ),
        createEquipmentHistorySection(
            'Incident Reports',
            'Lost and damaged equipment reports.',
            [
                'Equipment',
                'Incident',
                'Quantity',
                'Responsible Person',
                'Incident Date',
                'Description'
            ],
            incidentRows
        )
    );
}

/* =========================================================
FERTILIZER / PESTICIDE USAGE FORM
========================================================= */


async function renderSupplyUsageForm(category, item, onSaved) {
    const isFertilizer = category === 'Fertilizer';

    const usagePermission = isFertilizer
        ? 'fertilizer.manage'
        : 'pesticide.manage';

    try {
        await requirePermission(usagePermission);
    } catch (error) {
        showAlert(error.message, 'error', 'Permission denied');
        return;
    }

    const tableName = isFertilizer
        ? 'warehouse_fertilizer_used'
        : 'warehouse_pesticide_used';

    const form = el('form', 'wo-inventory-form');
    const message = el('p', 'wo-inventory-form-message');

    const quantityAvailable = Number(item.tool_quantity || 0);

    const quantityInput = createInput({
        type: 'number',
        name: 'quantity_used',
        min: '0.01',
        max: quantityAvailable,
        step: '0.01',
        required: true,
        value: 1
    });

    const applicationDateInput = createInput({
        type: 'date',
        name: 'application_date',
        required: true,
        value: new Date().toISOString().slice(0, 10)
    });

    const methodInput = createInput({
        name: 'application_method',
        placeholder: 'e.g. Broadcasting, spraying, drenching',
        required: true
    });

    const notesInput = el('textarea');
    notesInput.name = 'notes';
    notesInput.rows = 3;
    notesInput.required = true;
    notesInput.placeholder = 'Additional notes';

    const growthStageInput = createInput({
        name: 'growth_stage',
        placeholder: 'e.g. Seedling, vegetative, flowering',
        required: true
    });

    const targetPestInput = createInput({
        name: 'target_pest',
        placeholder: 'Target pest or disease',
        required: true
    });

    const photoField = createPhotoInput(
        null,
        'Application Evidence Photo (Optional)'
    );

    const saveButton = el(
        'button',
        'wo-inventory-save',
        'Record Usage'
    );

    saveButton.type = 'submit';

    const actions = el('div', 'wo-inventory-form-actions');

    actions.append(
        saveButton,
        button('Cancel', 'wo-inventory-cancel', closeModal)
    );

    form.append(
        el('h3', '', `Record ${category} Usage`),
        el(
            'p',
            'muted',
            `${item.tool_name} — Available: ${formatNumber(quantityAvailable)} ${item.tool_unit}`
        ),
        message
    );

    saveButton.disabled = true;
    saveButton.textContent = 'Loading...';

    let people = [];
    let plantings = [];

    try {
        [people, plantings] = await Promise.all([
            getWarehousePeople(),
            getWarehousePlantings()
        ]);
    } catch (error) {
        console.error('Unable to load usage dropdowns:', error);

        setFormMessage(
            message,
            error.message || 'Unable to load farmer and planting records.'
        );

        form.append(
            button('Close', 'wo-inventory-cancel', closeModal)
        );

        openModal(form);
        return;
    }

    plantings = plantings.filter(planting => (
        String(planting.planting_status || '').toLowerCase() !== 'harvested'
    ));

    const personSelect = createSelect(
        people.map(person => ({
            value: person.person_id,
            label: personLabel(person)
        })),
        'Select farmer or worker'
    );

    personSelect.required = true;

    const plantingSelect = createSelect(
        plantings.map(planting => ({
            value: planting.planting_id,
            label: plantingLabel(planting)
        })),
        plantings.length
            ? 'Select crop / planting'
            : 'No unharvested plantings available'
    );

    plantingSelect.required = true;

    plantingSelect.addEventListener('change', () => {
        const planting = getSelectedPlanting(
            plantings,
            plantingSelect.value
        );

        if (!planting) return;

        const matchingPerson = getSelectedPerson(
            people,
            planting.farmer_id,
            planting.farm_id
        );

        if (matchingPerson) {
            personSelect.value = matchingPerson.person_id;
        }
    });

    form.append(
        createField('Farmer / Worker', personSelect, true),
        createField('Farm Planting', plantingSelect, true),
        createField('Quantity Used', quantityInput, true),
        createField('Application Date', applicationDateInput, true),
        createField('Application Method', methodInput, true),
        ...(isFertilizer
            ? [createField('Growth Stage', growthStageInput, true)]
            : [createField('Target Pest / Disease', targetPestInput, true)]),
        createField('Notes', notesInput, true),
        photoField.wrapper,
        actions
    );

    saveButton.disabled = false;
    saveButton.textContent = 'Record Usage';

    form.addEventListener('submit', async event => {
        event.preventDefault();

        saveButton.disabled = true;
        saveButton.textContent = 'Recording...';

        let uploadedPhotoPath = null;

        try {
            await requirePermission(usagePermission);

            const personId = personSelect.value;

            const planting = getSelectedPlanting(
                plantings,
                plantingSelect.value
            );

            const quantity = Number(quantityInput.value);

            if (!personId) {
                throw new Error('Please select a farmer or worker.');
            }

            if (!planting) {
                throw new Error('Please select a farm planting.');
            }

            const selectedPerson = getSelectedPerson(
                people,
                personId,
                planting.farm_id
            );

            if (!selectedPerson) {
                throw new Error(
                    'The selected person and planting must belong to the same farm.'
                );
            }

            if (!Number.isFinite(quantity) || quantity <= 0) {
                throw new Error('Usage quantity must be greater than zero.');
            }

            if (!methodInput.value.trim()) {
                throw new Error('Please enter the application method.');
            }

            if (!notesInput.value.trim()) {
                throw new Error('Please enter the notes.');
            }

            if (isFertilizer && !growthStageInput.value.trim()) {
                throw new Error('Please enter the growth stage.');
            }

            if (!isFertilizer && !targetPestInput.value.trim()) {
                throw new Error('Please enter the target pest or disease.');
            }

            if (quantity > quantityAvailable) {
                throw new Error('Usage quantity exceeds available stock.');
            }

            const currentUserId = await getCurrentUserId();

            const selectedPhoto = photoField.input.files?.[0];

            if (selectedPhoto) {
                uploadedPhotoPath = await uploadInventoryPhoto(
                    selectedPhoto,
                    isFertilizer
                        ? 'fertilizer-usage'
                        : 'pesticide-usage'
                );
            }

            const payload = {
                tool_id: item.tool_id,
                planting_id: planting.planting_id,
                used_by: personId,
                recorded_by: currentUserId,
                quantity_used: quantity,
                application_date: new Date(
                    `${applicationDateInput.value}T12:00:00`
                ).toISOString(),
                application_method: methodInput.value.trim(),
                notes: notesInput.value.trim(),
                evidence_photo_path: uploadedPhotoPath
            };

            if (isFertilizer) {
                payload.growth_stage = growthStageInput.value.trim();
            } else {
                payload.target_pest = targetPestInput.value.trim();
            }

            const { error } = await supabase
                .from(tableName)
                .insert(payload);

            if (error) throw error;

            uploadedPhotoPath = null;

            // The database stock trigger handles the stock deduction.
            await onSaved();
            closeModal();

        } catch (error) {
            console.error(`${category} usage recording failed:`, error);

            if (uploadedPhotoPath) {
                await deleteInventoryPhoto(uploadedPhotoPath);
            }

            setFormMessage(
                message,
                error.message || 'Unable to record usage.'
            );

        } finally {
            saveButton.disabled = false;
            saveButton.textContent = 'Record Usage';
        }
    });

    openModal(form);
}


/* =========================================================
FERTILIZER / PESTICIDE USAGE HISTORY
========================================================= */

async function loadSupplyUsageHistory(category) {
    const isFertilizer = category === 'Fertilizer';

    const tableName = isFertilizer
        ? 'warehouse_fertilizer_used'
        : 'warehouse_pesticide_used';

    const { data, error } = await supabase
        .from(tableName)
        .select('*')
        .order('application_date', { ascending: false });

    if (error) throw error;

    return data || [];
}

function createSupplyHistoryRows(
    records,
    inventory,
    people,
    plantings,
    category
) {
    const inventoryMap = new Map(
        inventory.map(item => [item.tool_id, item])
    );

    const peopleMap = new Map();

    people.forEach(person => {
        peopleMap.set(person.person_id, person.person_name);
    });

    const plantingMap = new Map(
        plantings.map(planting => [
            planting.planting_id,
            planting
        ])
    );

    const isFertilizer = category === 'Fertilizer';

    return records.map(record => {
        const row = document.createElement('tr');

        const item = inventoryMap.get(record.tool_id);
        const planting = plantingMap.get(record.planting_id);

        row.append(
            el('td', '', item?.tool_name || 'Unknown supply'),
            el('td', '', planting?.crop_name || 'Unknown crop'),
            el('td', '', planting?.farm_name || '—'),
            el('td', '', planting?.field_name || '—'),
            el('td', '', peopleMap.get(record.used_by) || 'Unknown person'),
            el(
                'td',
                '',
                `${formatNumber(record.quantity_used)} ${item?.tool_unit || ''}`.trim()
            ),
            el('td', '', formatDate(record.application_date)),
            el(
                'td',
                '',
                isFertilizer
                    ? record.growth_stage || '—'
                    : record.target_pest || '—'
            ),
            el('td', '', record.application_method || '—')
        );

        return row;
    });
}


async function renderSupplyHistory(
    container,
    category,
    records,
    inventory,
    people,
    plantings
) {
    const usagePermission = category === 'Fertilizer'
        ? 'fertilizer.manage'
        : 'pesticide.manage';

    const canManageUsage = await hasPermission(usagePermission);

    const rows = createSupplyHistoryRows(
        records,
        inventory,
        people,
        plantings,
        category
    );

    const section = el('section', 'wo-inventory-section');

    section.append(
        el('h2', '', `${category} Usage History`),
        el(
            'p',
            'muted',
            `Historical records of ${category.toLowerCase()} applications.`
        )
    );

    if (!canManageUsage) {
        section.append(
            el(
                'p',
                'muted',
                'You have view-only access to these usage records.'
            )
        );
    }

    section.append(
        createTable(
            [
                'Supply',
                'Crop',
                'Farm',
                'Field',
                'Used By',
                'Quantity Used',
                'Application Date',
                category === 'Fertilizer' ? 'Growth Stage' : 'Target Pest',
                'Method'
            ],
            rows
        )
    );

    container.replaceChildren(section);
}




async function renderReplenishmentRequestForm(category, item, onSaved) {
    try {
        await requirePermission('inventory.manage');
    } catch (error) {
        showAlert(error.message, 'error', 'Permission denied');
        return;
    }

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

    const actions = el('div', 'wo-inventory-form-actions');

    const submitButton = el(
        'button',
        'wo-inventory-save',
        'Submit Request'
    );

    submitButton.type = 'submit';

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
            await requirePermission('inventory.manage');

            console.log('Submitting replenishment request:', {
                category,
                tool_id: item.tool_id,
                requested_quantity: requestedQuantity
            });

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
                    data.message || 'Unable to submit replenishment request.'
                );
            }

            console.log('Replenishment request submitted:', data);

            closeModal();

            await onSaved();

            showAlert(
                'Replenishment request submitted successfully.',
                'success',
                'Request submitted'
            );

        } catch (error) {
            console.error('Replenishment request failed:', error);

            const errorMessage = error.message || '';

            let userMessage =
                'Unable to submit replenishment request. Please try again.';

            if (
                error.code === '23505' ||
                errorMessage.includes('uq_warehouse_replenishment_pending_tool') ||
                errorMessage.toLowerCase().includes('duplicate key')
            ) {
                userMessage =
                    'This item already has a pending replenishment request. Please wait for the Farm Manager to review it before submitting another request.';
            } else if (
                errorMessage.toLowerCase().includes('permission')
            ) {
                userMessage = errorMessage;
            }

            setFormMessage(message, userMessage);

            submitButton.disabled = false;
            submitButton.textContent = 'Submit Request';
        }
    });

    openModal(form);
}

/* =========================================================
TOOL INVENTORY PAGE
========================================================= */


async function renderToolsInventory(root, config, ctx) {
    const category = config.category;
    const permissions = getInventoryPermissions(category);

    const canView = await hasPermission(permissions.view);

    if (!canView) {
        showMessage(
            root,
            'You do not have permission to view this inventory.',
            'error'
        );
        return;
    }

    const [
        canCreate,
        canEdit,
        canDelete,
        canReplenish,
        canIssue,
        canManageUsage
    ] = await Promise.all([
        hasPermission(permissions.create || permissions.manage),
        hasPermission(permissions.edit || permissions.manage),
        hasPermission(permissions.delete || permissions.manage),
        hasPermission('inventory.manage'),
        hasPermission('supplies.issue'),
        hasPermission(permissions.manage)
    ]);

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

    if (canCreate) {
        const addButton = button(
            `+ Add ${category}`,
            'wo-inventory-add',
            () => renderToolForm(category, null, load)
        );

        toolbar.append(addButton);
    }

    page.append(
        heading,
        toolbar,
        summaryGrid,
        cardGrid
    );

    if (
        category === 'Equipment'
        || category === 'Fertilizer'
        || category === 'Pesticide'
    ) {
        page.append(historyContainer);
    }

    root.replaceChildren(page);

    async function load() {
        showMessage(cardGrid, 'Loading inventory...');

        const { data, error } = await supabase
            .from('warehouse_tools_inventory')
            .select('*')
            .eq('tool_category', category)
            .order('tool_name', { ascending: true });

        if (error) {
            console.error('Failed to load inventory:', error);

            showMessage(
                cardGrid,
                'Unable to load inventory. Check your database permissions.',
                'error'
            );

            return;
        }

        const allItems = data || [];
        const query = (ctx?.query || '').toLowerCase();

        const filteredItems = allItems.filter(item => {
            return [
                item.tool_name,
                item.tool_category,
                item.tool_unit
            ].some(value => String(value || '').toLowerCase().includes(query));
        });

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

        const labels = (config.sections || []).map(section => section.label);

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

        const cards = filteredItems.map(item => createToolCard(
            item,

            selected => renderToolForm(
                category,
                selected,
                load
            ),

            async selected => {
                try {
                    await requirePermission(
                        permissions.delete || permissions.manage
                    );

                    const confirmed = await showConfirm(
                        `Delete "${selected.tool_name}" from inventory? This action cannot be undone.`,
                        {
                            title: 'Delete inventory item',
                            confirmText: 'Delete',
                            danger: true
                        }
                    );

                    if (!confirmed) return;

                    await requirePermission(
                        permissions.delete || permissions.manage
                    );

                    const { error: deleteError } = await supabase
                        .from('warehouse_tools_inventory')
                        .delete()
                        .eq('tool_id', selected.tool_id);

                    if (deleteError) throw deleteError;

                    if (selected.photo_path) {
                        await deleteInventoryPhoto(selected.photo_path);
                    }

                    await load();

                } catch (error) {
                    console.error('Delete failed:', error);
                    showAlert(
                        error.message || 'Unable to delete item.',
                        'error',
                        'Delete failed'
                    );
                }
            },

            selected => renderReplenishmentRequestForm(
                category,
                selected,
                load
            ),

            {
                canEdit,
                canDelete,
                canReplenish,
                replenishPending: false
            }
        ));

        if (!cards.length) {
            showMessage(cardGrid, 'No records found.');
        } else {
            cardGrid.replaceChildren(...cards);
            void loadInventoryPhotos(cardGrid);
        }

        if (category === 'Equipment') {
            await loadEquipmentWorkflow(allItems);
        }

        if (category === 'Fertilizer' || category === 'Pesticide') {
            await loadSupplyWorkflow(allItems);
        }
    }

    async function loadEquipmentWorkflow(inventory) {
        try {
            const [people, history] = await Promise.all([
                getWarehousePeople(),
                loadEquipmentHistory()
            ]);

            const equipmentItems = inventory.filter(item => (
                Number(item.tool_quantity) > 0
            ));

            const workflowToolbar = el('div', 'wo-inventory-toolbar');

            workflowToolbar.append(
                el('h2', '', 'Equipment Transactions'),
                el(
                    'span',
                    'muted',
                    `${history.borrows.length} borrowing records`
                )
            );

            const borrowGrid = el('div', 'wo-inventory-card-grid');

            const borrowCards = equipmentItems.map(item => {
                const actionCard = el('article', 'wo-inventory-card');

                actionCard.append(
                    el('h3', '', item.tool_name),
                    el(
                        'p',
                        'muted',
                        `Available: ${formatNumber(item.tool_quantity)} ${item.tool_unit}`
                    )
                );

                if (canIssue) {
                    actionCard.append(
                        button(
                            'Borrow Equipment',
                            'wo-inventory-add',
                            async () => {
                                try {
                                    await requirePermission('supplies.issue');

                                    await renderEquipmentBorrowForm(
                                        item,
                                        people,
                                        load
                                    );
                                } catch (error) {
                                    showAlert(
                                        error.message,
                                        'error',
                                        'Permission denied'
                                    );
                                }
                            }
                        )
                    );
                }

                return actionCard;
            });

            if (borrowCards.length) {
                borrowGrid.replaceChildren(...borrowCards);
            } else {
                showMessage(
                    borrowGrid,
                    'No equipment items are currently available for borrowing.'
                );
            }

            const historySection = el('div', 'wo-inventory-history');

            await renderEquipmentHistory(
                historySection,
                history,
                people,
                inventory,
                load
            );

            historyContainer.replaceChildren(
                workflowToolbar,
                borrowGrid,
                historySection
            );

        } catch (error) {
            console.error('Equipment workflow failed:', error);

            showMessage(
                historyContainer,
                error.message || 'Unable to load equipment transaction records.',
                'error'
            );
        }
    }

    async function loadSupplyWorkflow(inventory) {
        try {
            const [people, plantings, records] = await Promise.all([
                getWarehousePeople(),
                getWarehousePlantings(),
                loadSupplyUsageHistory(category)
            ]);

            const usageToolbar = el('div', 'wo-inventory-toolbar');

            usageToolbar.append(
                el('h2', '', `${category} Applications`)
            );

            const usageGrid = el('div', 'wo-inventory-card-grid');

            const availableItems = inventory.filter(item => (
                Number(item.tool_quantity) > 0
            ));

            const usageCards = availableItems.map(item => {
                const card = el('article', 'wo-inventory-card');

                card.append(
                    el('h3', '', item.tool_name),
                    el(
                        'p',
                        'muted',
                        `Available: ${formatNumber(item.tool_quantity)} ${item.tool_unit}`
                    )
                );

                if (canManageUsage) {
                    card.append(
                        button(
                            `Record ${category} Usage`,
                            'wo-inventory-add',
                            async () => {
                                try {
                                    await requirePermission(permissions.manage);

                                    await renderSupplyUsageForm(
                                        category,
                                        item,
                                        load
                                    );
                                } catch (error) {
                                    showAlert(
                                        error.message,
                                        'error',
                                        'Permission denied'
                                    );
                                }
                            }
                        )
                    );
                }

                return card;
            });

            if (usageCards.length) {
                usageGrid.replaceChildren(...usageCards);
            } else {
                showMessage(
                    usageGrid,
                    `No ${category.toLowerCase()} items are currently available.`
                );
            }

            await renderSupplyHistory(
                historyContainer,
                category,
                records,
                inventory,
                people,
                plantings
            );

            historyContainer.prepend(
                usageToolbar,
                usageGrid
            );

        } catch (error) {
            console.error(`${category} workflow failed:`, error);

            showMessage(
                historyContainer,
                error.message || `Unable to load ${category.toLowerCase()} usage records.`,
                'error'
            );
        }
    }

    await load();
}

/* =========================================================
HARVEST / PRODUCE INVENTORY
========================================================= */

function getCropName(harvest) {
    return harvest?.farm_plantings?.crop_name
        || harvest?.farm_plantings?.products?.product_name
        || 'Unspecified Crop';
}

function getVerifiedQuantity(harvest) {
    return Number(
        harvest?.verified_quantity ?? harvest?.harvest_quantity ?? 0
    );
}


function createProduceCard(
    item,
    onEdit,
    onDelete,
    permissions = {}
) {
    const status = String(item.produce_status || 'available').toLowerCase();

    const cropName = item.crop_name || 'Unspecified Crop';
    const unit = item.unit || '';

    const availableQuantity = Number(item.available_quantity || 0);
    const reservedQuantity = Number(item.reserved_quantity || 0);
    const totalQuantity = availableQuantity + reservedQuantity;

    const canEdit = permissions.canEdit === true;

    const details = [
        { label: 'Crop', value: cropName },
        {
            label: 'Total Quantity',
            value: `${formatNumber(totalQuantity)} ${unit}`.trim()
        },
        {
            label: 'Available Quantity',
            value: `${formatNumber(availableQuantity)} ${unit}`.trim()
        },
        {
            label: 'Reserved Quantity',
            value: `${formatNumber(reservedQuantity)} ${unit}`.trim()
        },
        { label: 'Status', value: capitalize(status) },
        { label: 'Last Updated', value: formatDate(item.updated_at) }
    ];

    return createInventoryCard({
        photoPath: item.photo_path,
        title: cropName,
        details,

        onEdit: canEdit
            ? () => onEdit(item)
            : null,

        onDelete: canEdit
            ? () => onDelete(item)
            : null,

        canEdit,
        canDelete: canEdit,
        deleteLabel: 'Remove'
    });
}


async function renderProduceEditForm(item, onSaved) {
    try {
        await requirePermission('harvest_inventory.edit');
    } catch (error) {
        showAlert(error.message, 'error', 'Permission denied');
        return;
    }

    const form = el('form', 'wo-inventory-form');
    const heading = el('h3', '', 'Update Produce Inventory');

    const statusLabel = el('label', '', 'Produce Status');
    const statusSelect = el('select');

    statusSelect.name = 'produce_status';

    ['available', 'reserved', 'released', 'damaged'].forEach(status => {
        const option = el('option', '', capitalize(status));
        option.value = status;
        statusSelect.append(option);
    });

    statusSelect.value = item.produce_status || 'available';
    statusLabel.append(statusSelect);

    const currentPhotoUrl = await getPhotoUrl(item.photo_path);
    const photoField = createPhotoInput(
        currentPhotoUrl,
        'Produce Photo (Optional)'
    );

    const actions = el('div', 'wo-inventory-form-actions');

    const saveButton = el('button', 'wo-inventory-save', 'Save Changes');
    saveButton.type = 'submit';

    actions.append(
        saveButton,
        button('Cancel', 'wo-inventory-cancel', closeModal)
    );

    const message = el('p', 'wo-inventory-form-message');

    form.append(
        heading,
        statusLabel,
        photoField.wrapper,
        actions,
        message
    );

    form.addEventListener('submit', async event => {
        event.preventDefault();

        saveButton.disabled = true;
        saveButton.textContent = 'Saving...';
        message.textContent = '';

        let uploadedPhotoPath = null;

        try {
            await requirePermission('harvest_inventory.edit');

            const payload = {
                produce_status: statusSelect.value,
                updated_at: new Date().toISOString()
            };

            const selectedPhoto = photoField.input.files?.[0];

            if (selectedPhoto) {
                uploadedPhotoPath = await uploadInventoryPhoto(
                    selectedPhoto,
                    'harvest-produce'
                );

                payload.photo_path = uploadedPhotoPath;
            }

            const { data, error } = await supabase
                .from('warehouse_produce_inventory')
                .update(payload)
                .eq('produce_id', item.produce_id)
                .select('produce_id')
                .maybeSingle();

            if (error) throw error;

            if (!data) {
                throw new Error(
                    'Update was not applied. Check your permissions.'
                );
            }

            if (
                uploadedPhotoPath
                && item.photo_path
                && item.photo_path !== uploadedPhotoPath
            ) {
                await deleteInventoryPhoto(item.photo_path);
            }

            await onSaved();
            closeModal();

        } catch (error) {
            console.error('Produce update failed:', error);

            if (uploadedPhotoPath) {
                await deleteInventoryPhoto(uploadedPhotoPath);
            }

            setFormMessage(
                message,
                error.message || 'Unable to update produce record.'
            );

        } finally {
            saveButton.disabled = false;
            saveButton.textContent = 'Save Changes';
        }
    });

    openModal(form);
}

async function renderHarvestInventory(root, config, ctx) {
    const canView = await hasPermission('harvest_inventory.view');

    if (!canView) {
        showMessage(
            root,
            'You do not have permission to view Harvest Inventory.',
            'error'
        );
        return;
    }

    const canEdit = await hasPermission('harvest_inventory.edit');

    const page = el('section', 'wo-inventory-page');
    const heading = el('div', 'wo-page-heading');

    heading.append(
        el('h1', '', config.title),
        el('p', 'muted', config.description)
    );

    const summaryGrid = el('div', 'wo-stats-grid');
    const registeredSection = el('section', 'wo-inventory-section');

    registeredSection.append(
        el('h2', '', 'Warehouse Produce')
    );

    const registeredCards = el('div', 'wo-inventory-card-grid');

    const harvestContributions =
        createHarvestContributionsSection();

    const eligibleSection = el('section', 'wo-inventory-section');

    eligibleSection.append(
        el('h2', '', 'Confirmed Harvests Not Yet Added'),
        el(
            'p',
            'muted',
            'Add confirmed harvest records to the warehouse produce inventory.'
        )
    );

    const eligibleTable = el('div', 'wo-inventory-table-container');

    registeredSection.append(registeredCards);
    eligibleSection.append(eligibleTable);

    page.append(
        heading,
        summaryGrid,
        registeredSection,
        harvestContributions.element,
        eligibleSection
    );

    root.replaceChildren(page);

    let loadToken = 0;

    async function load() {
        const currentToken = ++loadToken;

        showMessage(registeredCards, 'Loading warehouse produce...');
        showMessage(eligibleTable, 'Loading confirmed harvests...');

        const [
            inventoryResult,
            contributionResult,
            harvestResult
        ] = await Promise.all([
            supabase
                .from('warehouse_produce_inventory')
                .select(`
                    produce_id,
                    harvest_id,
                    photo_path,
                    produce_status,
                    created_at,
                    updated_at,
                    available_quantity,
                    reserved_quantity,
                    farm_id,
                    crop_name,
                    unit
                `)
                .order('created_at', { ascending: false }),

            supabase
                .from('warehouse_produce_harvests')
                .select(`
                    contribution_id,
                    produce_id,
                    harvest_id,
                    quantity_added,
                    created_at
                `),

            supabase
                .from('harvested_crops')
                .select(`
                    harvest_id,
                    harvested_date,
                    harvest_quantity,
                    harvest_unit,
                    confirmation_status,
                    verified_quantity,
                    verification_notes,
                    planting_id,
                    farm_plantings!harvested_crops_planting_id_fkey (
                        crop_name,
                        products ( product_name )
                    )
                `)
                .eq('confirmation_status', 'confirmed')
                .order('harvested_date', { ascending: false })
        ]);

        if (currentToken !== loadToken) return;

        if (inventoryResult.error) {
            console.error(
                'Failed to load produce inventory:',
                inventoryResult.error
            );

            showMessage(
                registeredCards,
                'Unable to load warehouse produce inventory.',
                'error'
            );

            return;
        }

        if (contributionResult.error) {
            console.error(
                'Failed to load harvest contributions:',
                contributionResult.error
            );

            showMessage(
                eligibleTable,
                'Unable to check existing harvest contributions.',
                'error'
            );

            return;
        }

        if (harvestResult.error) {
            console.error(
                'Failed to load confirmed harvests:',
                harvestResult.error
            );

            showMessage(
                eligibleTable,
                'Unable to load confirmed harvest records.',
                'error'
            );

            return;
        }

        const inventoryRows = inventoryResult.data || [];
        const contributionRecords = contributionResult.data || [];
        const confirmedHarvests = harvestResult.data || [];

        const existingHarvestIds = new Set(
            contributionRecords.map(item => item.harvest_id)
        );

        const eligibleRows = confirmedHarvests.filter(
            harvest => !existingHarvestIds.has(harvest.harvest_id)
        );

        const query = String(ctx?.query || '').toLowerCase();

        const filteredInventory = inventoryRows.filter(item => {
            return [
                item.crop_name,
                item.produce_status,
                item.unit
            ].some(value =>
                String(value || '').toLowerCase().includes(query)
            );
        });

        const totalVerified = contributionRecords.reduce(
            (sum, item) => sum + Number(item.quantity_added || 0),
            0
        );

        const totalAvailable = inventoryRows.reduce(
            (sum, item) => sum + Number(item.available_quantity || 0),
            0
        );

        const cropTypes = new Set(
            inventoryRows
                .map(item =>
                    String(item.crop_name || '')
                        .trim()
                        .toLowerCase()
                )
                .filter(Boolean)
        );

        const labels = (config.sections || []).map(
            section => section.label
        );

        summaryGrid.replaceChildren(
            createSummaryCard(
                labels[0] || 'Crop Types',
                cropTypes.size,
                'Produce types in inventory'
            ),
            createSummaryCard(
                labels[1] || 'Total Verified Quantity',
                formatNumber(totalVerified),
                'Cumulative quantity added to warehouse inventory'
            ),
            createSummaryCard(
                labels[2] || 'Available Stock',
                formatNumber(totalAvailable),
                'Current available warehouse quantity'
            ),
            createSummaryCard(
                labels[3] || 'Verified Harvest Records',
                confirmedHarvests.length,
                'All confirmed harvest records'
            )
        );

        const registeredCardItems = await Promise.all(
            filteredInventory.map(item => createProduceCard(
                item,

                selected => renderProduceEditForm(
                    selected,
                    load
                ),

                async selected => {
                    try {
                        await requirePermission('harvest_inventory.edit');

                        const confirmed = await showConfirm(
                            'Remove this produce record from warehouse inventory? The original harvest record will remain.',
                            {
                                title: 'Remove produce record',
                                confirmText: 'Remove',
                                danger: true
                            }
                        );

                        if (!confirmed) return;

                        await requirePermission('harvest_inventory.edit');

                        const { error } = await supabase
                            .from('warehouse_produce_inventory')
                            .delete()
                            .eq('produce_id', selected.produce_id);

                        if (error) throw error;

                        if (selected.photo_path) {
                            await deleteInventoryPhoto(selected.photo_path);
                        }

                        await load();

                    } catch (error) {
                        console.error(
                            'Produce deletion failed:',
                            error
                        );

                        showAlert(
                            error.message
                            || 'Unable to remove produce record.',
                            'error',
                            'Remove failed'
                        );
                    }
                },

                { canEdit }
            ))
        );

        if (currentToken !== loadToken) return;

        if (!registeredCardItems.length) {
            showMessage(
                registeredCards,
                'No produce records found.'
            );
        } else {
            registeredCards.replaceChildren(
                ...registeredCardItems
            );

            void loadInventoryPhotos(registeredCards);
        }

        const filteredEligible = eligibleRows.filter(harvest => {
            return [
                getCropName(harvest),
                harvest.harvest_unit,
                harvest.harvest_id
            ].some(value =>
                String(value || '').toLowerCase().includes(query)
            );
        });

        const eligibleRowsUI = filteredEligible.map(harvest => {
            const row = document.createElement('tr');

            row.append(
                el('td', '', getCropName(harvest)),
                el('td', '', formatDate(harvest.harvested_date)),
                el(
                    'td',
                    '',
                    `${formatNumber(getVerifiedQuantity(harvest))} ${harvest.harvest_unit || ''}`.trim()
                ),
                el('td', '', 'Confirmed')
            );

            const actionCell = document.createElement('td');

            if (canEdit) {
                actionCell.append(
                    button(
                        'Add to Inventory',
                        'wo-inventory-add',
                        async event => {
                            const actionButton = event.currentTarget;

                            actionButton.disabled = true;
                            actionButton.textContent = 'Adding...';

                            try {
                                await requirePermission('harvest_inventory.edit');

                                const { error } = await supabase.rpc(
                                    'warehouse_add_confirmed_harvest',
                                    {
                                        p_harvest_id: harvest.harvest_id
                                    }
                                );

                                if (error) throw error;

                                await load();

                            } catch (error) {
                                console.error(
                                    'Failed to add harvest to inventory:',
                                    error
                                );

                                showAlert(
                                    error.message
                                    || 'Unable to add this harvest. It may already exist.',
                                    'error',
                                    'Unable to add harvest'
                                );

                                actionButton.disabled = false;
                                actionButton.textContent = 'Add to Inventory';
                            }
                        }
                    )
                );
            } else {
                actionCell.textContent = 'View only';
            }

            row.append(actionCell);

            return row;
        });

        eligibleTable.replaceChildren(
            createTable(
                [
                    'Crop',
                    'Harvest Date',
                    'Verified Quantity',
                    'Harvest Status',
                    'Action'
                ],
                eligibleRowsUI
            )
        );

        await harvestContributions.load(
            contributionRecords,
            inventoryRows
        );
    }

    await load();
}



/* =========================================================
PAGE ENTRY POINTS
========================================================= */

/** Render a configured inventory module and load its records and actions. */
export async function renderInventoryPage(root, config, ctx = {}) {
    closeModal();
    closeActiveDialog(false);
    revokeObjectUrls();

    if (config.type === 'harvest') {
        return renderHarvestInventory(root, config, ctx);
    }

    return renderToolsInventory(root, config, ctx);
}

/** Close the active inventory modal and revoke generated object URLs. */
export function cleanupInventoryPage() {
    closeModal();
    closeActiveDialog(false);
    revokeObjectUrls();
}