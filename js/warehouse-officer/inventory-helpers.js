
import { supabase } from '../connection.js';

const STORAGE_BUCKET = 'warehouse-inventory-photos';
const MAX_PHOTO_SIZE = 3 * 1024 * 1024;
const SIGNED_URL_EXPIRY = 3600;
const PHOTO_URL_CACHE_MARGIN = 60;
const PHOTO_REQUEST_TIMEOUT = 15000;
const MAX_CONCURRENT_PHOTO_REQUESTS = 3;

const ALLOWED_PHOTO_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp'
];

const activeObjectUrls = new Set();

const photoUrlCache = new Map();
const photoUrlPending = new Map();
const photoRequestQueue = [];

let activePhotoRequests = 0;
let activeModal = null;

// =====================================================
// GENERAL HELPERS
// =====================================================

export function el(tag, className = '', text = '') {
    const node = document.createElement(tag);

    if (className) node.className = className;

    if (text !== undefined && text !== null) {
        node.textContent = text;
    }

    return node;
}

export function button(text, className, onClick) {
    const node = el('button', className, text);
    node.type = 'button';

    if (typeof onClick === 'function') {
        node.addEventListener('click', onClick);
    }

    return node;
}

export function showMessage(container, message, type = 'info') {
    container.replaceChildren(
        el('p', `wo-inventory-message ${type}`, message)
    );
}

export function formatNumber(value) {
    return Number(value || 0).toLocaleString('en-PH', {
        maximumFractionDigits: 2
    });
}

export function formatDate(value) {
    if (!value) return '—';

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return '—';

    return date.toLocaleDateString('en-PH', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

export function formatDateTime(value) {
    if (!value) return '—';

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return '—';

    return date.toLocaleString('en-PH', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
}

export function capitalize(value) {
    const text = String(value || '');
    return text.charAt(0).toUpperCase() + text.slice(1);
}

export function createSummaryCard(label, value, description) {
    const card = el('article', 'wo-stat-card');

    card.append(
        el('span', 'wo-stat-label', label),
        el('strong', 'wo-stat-value', String(value)),
        el('small', 'wo-stat-description', description)
    );

    return card;
}

export function createTable(headers, rows) {
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
        const cell = el(
            'td',
            'wo-inventory-empty',
            'No records found.'
        );

        cell.colSpan = headers.length;
        emptyRow.append(cell);
        tbody.append(emptyRow);
    }

    table.append(thead, tbody);
    wrapper.append(table);

    return wrapper;
}

export function createField(labelText, input, required = false) {
    const label = el('label', 'wo-inventory-field');

    label.append(
        el('span', '', `${labelText}${required ? ' *' : ''}`),
        input
    );

    return label;
}

export function createInput({
    type = 'text',
    name,
    value = '',
    placeholder = '',
    min,
    max,
    step,
    required = false,
    maxLength,
    disabled = false,
    readOnly = false
} = {}) {
    const input = el('input');

    input.type = type;

    if (name) input.name = name;

    if (value !== undefined && value !== null) {
        input.value = value;
    }

    if (placeholder) input.placeholder = placeholder;
    if (min !== undefined) input.min = min;
    if (max !== undefined) input.max = max;
    if (step !== undefined) input.step = step;
    if (maxLength !== undefined) input.maxLength = maxLength;

    input.required = required;
    input.disabled = disabled;
    input.readOnly = readOnly;

    return input;
}

export function createSelect(
    options,
    placeholder = 'Select an option'
) {
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

export function setFormMessage(message, text, type = 'error') {
    message.textContent = text;
    message.className = `wo-inventory-form-message ${type}`;
}

export async function getCurrentUserId() {
    const { data, error } = await supabase.auth.getUser();

    if (error) throw error;

    const userId = data?.user?.id;

    if (!userId) {
        throw new Error(
            'Your session has expired. Please log in again.'
        );
    }

    return userId;
}

// =====================================================
// PHOTO REQUEST QUEUE
// =====================================================

function processPhotoQueue() {
    while (
        activePhotoRequests < MAX_CONCURRENT_PHOTO_REQUESTS &&
        photoRequestQueue.length > 0
    ) {
        const next = photoRequestQueue.shift();

        activePhotoRequests++;

        Promise.resolve()
            .then(next.task)
            .then(next.resolve)
            .catch(next.reject)
            .finally(() => {
                activePhotoRequests--;
                processPhotoQueue();
            });
    }
}

function queuePhotoRequest(task) {
    return new Promise((resolve, reject) => {
        photoRequestQueue.push({
            task,
            resolve,
            reject
        });

        processPhotoQueue();
    });
}

// =====================================================
// PHOTO HELPERS
// =====================================================

function sanitizeFileName(fileName) {
    return String(fileName || 'photo')
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, '-')
        .replace(/-+/g, '-');
}

export function validatePhoto(file) {
    if (!file) return;

    if (!ALLOWED_PHOTO_TYPES.includes(file.type)) {
        throw new Error(
            'Only JPG, PNG, and WEBP images are allowed.'
        );
    }

    if (file.size > MAX_PHOTO_SIZE) {
        throw new Error('Photo must not exceed 3 MB.');
    }
}

export async function uploadInventoryPhoto(file, category) {
    if (!file) return null;

    validatePhoto(file);

    const safeCategory = String(category || 'other')
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-');

    const fileName =
        `${crypto.randomUUID()}-${sanitizeFileName(file.name)}`;

    const filePath = `${safeCategory}/${fileName}`;

    const { data, error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(filePath, file, {
            cacheControl: '3600',
            upsert: false,
            contentType: file.type
        });

    if (error) throw error;

    return data.path;
}

export async function getPhotoUrl(photoPath) {
    if (!photoPath) return null;

    const path = String(photoPath).trim();

    if (!path) return null;

    if (/^https?:\/\//i.test(path)) {
        return path;
    }

    const cached = photoUrlCache.get(path);

    if (cached) {
        if (cached.expiresAt > Date.now()) {
            return cached.url;
        }

        photoUrlCache.delete(path);
    }

    const pending = photoUrlPending.get(path);

    if (pending) {
        return pending;
    }

    const request = queuePhotoRequest(async () => {
        const cachedAgain = photoUrlCache.get(path);

        if (cachedAgain && cachedAgain.expiresAt > Date.now()) {
            return cachedAgain.url;
        }

        try {
            const { data, error } = await supabase.storage
                .from(STORAGE_BUCKET)
                .createSignedUrl(path, SIGNED_URL_EXPIRY);

            if (error) throw error;

            const url = data?.signedUrl || null;

            if (url) {
                photoUrlCache.set(path, {
                    url,
                    expiresAt:
                        Date.now() +
                        (SIGNED_URL_EXPIRY - PHOTO_URL_CACHE_MARGIN) * 1000
                });
            }

            return url;

        } catch (error) {
            console.error(
                'Unable to generate photo URL:',
                path,
                error
            );

            return null;
        }
    });

    photoUrlPending.set(path, request);

    try {
        return await request;
    } finally {
        photoUrlPending.delete(path);
    }
}

export async function deleteInventoryPhoto(photoPath) {
    if (!photoPath || /^https?:\/\//i.test(photoPath)) {
        return;
    }

    const path = String(photoPath).trim();

    if (!path) return;

    const { error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .remove([path]);

    if (error) {
        console.error(
            'Unable to delete inventory photo:',
            path,
            error
        );

        return;
    }

    photoUrlCache.delete(path);
    photoUrlPending.delete(path);
}

export function createPhotoElement(
    photoUrl,
    altText = 'Inventory photo'
) {
    const wrapper = el(
        'div',
        'wo-inventory-photo-wrapper'
    );

    if (!photoUrl) {
        wrapper.append(
            el('span', 'wo-inventory-no-photo', 'No photo')
        );

        return wrapper;
    }

    const image = el('img', 'wo-inventory-photo');

    image.src = photoUrl;
    image.alt = altText;
    image.loading = 'lazy';
    image.decoding = 'async';

    image.addEventListener('error', () => {
        wrapper.replaceChildren(
            el(
                'span',
                'wo-inventory-no-photo',
                'Photo unavailable'
            )
        );
    });

    wrapper.append(image);

    return wrapper;
}

export function createPhotoInput(
    currentPhotoUrl = null,
    labelText = 'Item Photo (Optional)'
) {
    const wrapper = el(
        'div',
        'wo-inventory-photo-input-wrapper'
    );

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

    const preview = el(
        'div',
        'wo-inventory-photo-preview'
    );

    if (currentPhotoUrl) {
        const image = el('img');

        image.src = currentPhotoUrl;
        image.alt = 'Current photo';
        image.loading = 'lazy';

        preview.append(image);
    } else {
        preview.append(
            el(
                'span',
                'wo-inventory-no-photo',
                'No photo selected'
            )
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
                el(
                    'span',
                    'wo-inventory-no-photo',
                    'No photo selected'
                )
            );

            return;
        }

        try {
            validatePhoto(file);
        } catch (error) {
            input.value = '';

            preview.replaceChildren(
                el(
                    'span',
                    'wo-inventory-no-photo',
                    'Invalid photo'
                )
            );

            alert(error.message);
            return;
        }

        currentObjectUrl = URL.createObjectURL(file);
        activeObjectUrls.add(currentObjectUrl);

        const image = el('img');

        image.src = currentObjectUrl;
        image.alt = 'Selected photo';
        image.loading = 'lazy';

        preview.replaceChildren(image);
    });

    label.append(input);
    wrapper.append(label, hint, preview);

    return {
        wrapper,
        input
    };
}

export function revokeObjectUrls() {
    activeObjectUrls.forEach(url => {
        URL.revokeObjectURL(url);
    });

    activeObjectUrls.clear();
}

// =====================================================
// MODAL
// =====================================================

export function closeModal() {
    if (!activeModal) return;

    document.removeEventListener(
        'keydown',
        activeModal.onKey
    );

    activeModal.overlay.remove();

    document.body.classList.remove('wo-modal-open');

    const previouslyFocused = activeModal.previouslyFocused;

    activeModal = null;

    if (previouslyFocused?.isConnected) {
        previouslyFocused.focus();
    }
}

export function openModal(form) {
    if (!form) return;

    closeModal();

    const overlay = el('div', 'wo-modal-overlay');
    const dialog = el('div', 'wo-modal');

    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const closeButton = button(
        '×',
        'wo-modal-close',
        closeModal
    );

    closeButton.setAttribute('aria-label', 'Close');

    dialog.append(closeButton, form);
    overlay.append(dialog);

    overlay.addEventListener('mousedown', event => {
        if (event.target === overlay) {
            closeModal();
        }
    });

    const onKey = event => {
        if (event.key === 'Escape') {
            closeModal();
        }
    };

    document.addEventListener('keydown', onKey);
    document.body.append(overlay);
    document.body.classList.add('wo-modal-open');

    activeModal = {
        overlay,
        onKey,
        previouslyFocused: document.activeElement
    };

    form.querySelector(
        'input:not([type="file"]):not([disabled]), select:not([disabled]), button:not([disabled])'
    )?.focus();
}

// =====================================================
// SHARED INVENTORY CARD
// =====================================================

export async function createInventoryCard({
    photoPath,
    title,
    details = [],
    onEdit,
    onDelete,
    onReplenish,
    replenishPending = false,
    deleteLabel = 'Delete'
}) {
    const card = el('article', 'wo-inventory-card');

    const front = el(
        'div',
        'wo-card-face wo-card-front'
    );

    front.setAttribute('role', 'button');
    front.setAttribute(
        'aria-label',
        `${title}: show details`
    );

    front.tabIndex = 0;

    const photo = createPhotoElement(
        null,
        `${title} photo`
    );

    photo.classList.add('wo-inventory-card-photo');

    const strip = el('div', 'wo-inventory-card-body');

    strip.append(
        el('h3', 'wo-inventory-card-title', title)
    );

    front.append(photo, strip);

    const back = el(
        'div',
        'wo-card-face wo-card-back'
    );

    const backHeader = el(
        'div',
        'wo-card-back-header'
    );

    const backButton = button(
        '← Back',
        'wo-card-back-btn',
        () => setFlipped(false)
    );

    backButton.tabIndex = -1;

    backHeader.append(
        el('h3', 'wo-card-back-title', title),
        backButton
    );

    const list = el(
        'dl',
        'wo-inventory-card-details'
    );

    details.forEach(({ label, value }) => {
        const row = el(
            'div',
            'wo-inventory-card-detail'
        );

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

    actions.append(
        button('Edit', 'wo-inventory-edit', onEdit),
        button(deleteLabel, 'wo-inventory-delete', onDelete)
    );

    if (replenishPending) {
        const pendingButton = button(
            'Request Pending',
            'wo-inventory-replenish-pending'
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

    back.append(backHeader, list, actions);

    function setFlipped(flipped) {
        card.classList.toggle('is-flipped', flipped);

        front.inert = flipped;
        back.inert = !flipped;

        front.setAttribute(
            'aria-hidden',
            String(flipped)
        );

        back.setAttribute(
            'aria-hidden',
            String(!flipped)
        );

        if (flipped) {
            backButton.tabIndex = 0;
            backButton.focus({ preventScroll: true });
        } else {
            backButton.tabIndex = -1;
            front.focus({ preventScroll: true });
        }
    }

    front.inert = false;
    back.inert = true;

    front.setAttribute('aria-hidden', 'false');
    back.setAttribute('aria-hidden', 'true');

    front.addEventListener('click', () => {
        setFlipped(true);
    });

    front.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setFlipped(true);
        }
    });

    card.append(front, back);

    // Load the image after the card is created.
    // A failed Storage request does not block the card.
    if (photoPath) {
        getPhotoUrl(photoPath).then(url => {
            if (!url || !card.isConnected) return;

            photo.replaceChildren();

            const image = el('img', 'wo-inventory-photo');

            image.src = url;
            image.alt = `${title} photo`;
            image.loading = 'lazy';
            image.decoding = 'async';

            image.addEventListener('error', () => {
                photo.replaceChildren(
                    el(
                        'span',
                        'wo-inventory-no-photo',
                        'Photo unavailable'
                    )
                );
            });

            photo.append(image);
        }).catch(error => {
            console.error(
                'Inventory card photo loading failed:',
                error
            );
        });
    }

    return card;
}
