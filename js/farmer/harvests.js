import { supabase } from '../connection.js';

// ==========================================
// ELEMENTS
// ==========================================

const farmerNameElement = document.getElementById('farmerName');
const farmerAvatarElement = document.getElementById('farmerAvatar');
const todayLabel = document.getElementById('todayLabel');

const logoutButton = document.getElementById('logoutButton');
const logoutLabel = document.getElementById('logoutLabel');
const themeToggle = document.getElementById('themeToggle');

const harvestForm = document.getElementById('harvestForm');
const plantingSelect = document.getElementById('plantingSelect');
const harvestedDateInput = document.getElementById('harvestedDate');
const harvestQuantityInput = document.getElementById('harvestQuantity');
const harvestUnitInput = document.getElementById('harvestUnit');
const harvestNotesInput = document.getElementById('harvestNotes');

const submitHarvestButton = document.getElementById('submitHarvestButton');
const harvestMessage = document.getElementById('harvestMessage');
const harvestHistoryBody = document.getElementById('harvestHistoryBody');
const rejectedHarvestBody = document.getElementById('rejectedHarvestBody');

// ==========================================
// STATE
// ==========================================

let currentUser = null;
let assignedPlantings = [];
let harvestRealtimeChannel = null;
let resubmittingHarvestId = null;

let canViewHarvests = false;
let canCreateHarvest = false;
let canEditHarvest = false;

const permissionCache = new Map();

const THEME_KEY = 'theme';

const FARMER_NAVIGATION_PERMISSIONS = {
    'farmer-dashboard.html': 'dashboard.view',
    'activities.html': 'activities.view',
    'plantings.html': 'plantings.view',
    'recommendations.html': 'recommendations.view',
    'harvest-records.html': 'harvest_records.view'
};

// ==========================================
// THEME
// ==========================================

function readSavedTheme() {
    try {
        return (
            localStorage.getItem(THEME_KEY) ||
            localStorage.getItem('tanikala-theme')
        );
    } catch {
        return null;
    }
}

function applyTheme(theme) {
    document.documentElement.setAttribute(
        'data-theme',
        theme === 'dark' ? 'dark' : 'light'
    );
}

(function initializeTheme() {
    applyTheme(readSavedTheme());

    themeToggle?.addEventListener('click', event => {
        event.stopImmediatePropagation();

        const next =
            document.documentElement.getAttribute('data-theme') === 'dark'
                ? 'light'
                : 'dark';

        applyTheme(next);

        try {
            localStorage.setItem(THEME_KEY, next);
        } catch {
            // Ignore blocked storage.
        }
    });

    window.addEventListener('storage', event => {
        if (
            (event.key === THEME_KEY || event.key === 'tanikala-theme') &&
            event.newValue
        ) {
            applyTheme(event.newValue);
        }
    });
})();

// ==========================================
// HELPERS
// ==========================================

function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => {
        const entities = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };

        return entities[character];
    });
}

function getLocalDate() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
}

function formatDate(dateValue) {
    if (!dateValue) return '—';

    const date = new Date(`${dateValue}T00:00:00`);

    if (Number.isNaN(date.getTime())) return '—';

    return date.toLocaleDateString('en-PH', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function formatQuantity(quantity, unit) {
    if (quantity === null || quantity === undefined) return '—';

    const formatted = Number(quantity).toLocaleString('en-PH', {
        maximumFractionDigits: 2
    });

    return `${formatted} ${unit || ''}`.trim();
}

function showMessage(message, type = 'success') {
    if (!harvestMessage) return;

    harvestMessage.textContent = message;
    harvestMessage.className = `harvest-message show ${type}`;
}

function clearMessage() {
    if (!harvestMessage) return;

    harvestMessage.textContent = '';
    harvestMessage.className = 'harvest-message';
}

function getStatusLabel(status) {
    const labels = {
        pending: 'Pending',
        in_progress: 'In Progress',
        confirmed: 'Confirmed',
        rejected: 'Rejected'
    };

    return labels[status] || status || 'Unknown';
}

function resetResubmissionState() {
    resubmittingHarvestId = null;

    if (submitHarvestButton) {
        submitHarvestButton.textContent = 'Submit Harvest Record';
    }
}

function hidePermissionsLoading() {
    document.body.classList.remove('permissions-loading');
}

function getFarmerDisplayName(user) {
    return (
        user.user_metadata?.full_name ||
        user.user_metadata?.fullName ||
        user.email?.split('@')[0] ||
        'Farmer'
    );
}

// ==========================================
// PERMISSIONS
// ==========================================

async function hasPermission(permissionKey) {
    if (permissionCache.has(permissionKey)) {
        return permissionCache.get(permissionKey);
    }

    try {
        const { data, error } = await supabase.rpc(
            'has_tanikala_permission',
            {
                p_permission_key: permissionKey
            }
        );

        if (error) throw error;

        const allowed = data === true;

        permissionCache.set(permissionKey, allowed);

        return allowed;

    } catch (error) {
        console.error(
            `Permission check failed (${permissionKey}):`,
            error
        );

        permissionCache.set(permissionKey, false);
        return false;
    }
}

async function loadHarvestPermissions() {
    const [
        viewPermission,
        createPermission,
        editPermission
    ] = await Promise.all([
        hasPermission('harvest_records.view'),
        hasPermission('harvest_records.create'),
        hasPermission('harvest_records.edit')
    ]);

    canViewHarvests = viewPermission;
    canCreateHarvest = createPermission;
    canEditHarvest = editPermission;

    return canViewHarvests;
}

/**
 * Checks all Farmer navigation permissions.
 * Disabled pages are hidden from the sidebar and Quick Access,
 * regardless of which Farmer page is currently open.
 */
async function applyNavigationPermissions() {
    const entries = Object.entries(FARMER_NAVIGATION_PERMISSIONS);

    const results = await Promise.all(
        entries.map(async ([page, permissionKey]) => ({
            page,
            allowed: await hasPermission(permissionKey)
        }))
    );

    const permissionMap = new Map(
        results.map(result => [result.page, result.allowed])
    );

    document.querySelectorAll(
        '.navigation a.nav-link[href], ' +
        '.quick-access a.access-card[href]'
    ).forEach(link => {
        const href = link.getAttribute('href');

        if (!href) return;

        let page;

        try {
            page = new URL(href, window.location.href)
                .pathname
                .split('/')
                .pop()
                .toLowerCase();
        } catch {
            return;
        }

        if (!Object.hasOwn(FARMER_NAVIGATION_PERMISSIONS, page)) {
            return;
        }

        const allowed = permissionMap.get(page) === true;

        link.hidden = !allowed;
        link.style.display = allowed ? '' : 'none';

        if (allowed) {
            link.removeAttribute('aria-hidden');
            link.removeAttribute('tabindex');
        } else {
            link.setAttribute('aria-hidden', 'true');
            link.setAttribute('tabindex', '-1');
        }
    });

    return permissionMap;
}

function configureHarvestForm() {
    if (!harvestForm) return;

    const canUseForm = canCreateHarvest || canEditHarvest;

    harvestForm.hidden = !canUseForm;

    if (!canUseForm) return;

    if (submitHarvestButton) {
        submitHarvestButton.disabled = true;

        submitHarvestButton.textContent = canCreateHarvest
            ? 'Submit Harvest Record'
            : 'Select a rejected record to resubmit';
    }

    if (plantingSelect) {
        plantingSelect.disabled = !canCreateHarvest && !canEditHarvest;
    }
}

function showAccessDenied() {
    if (harvestForm) {
        harvestForm.hidden = true;
    }

    if (harvestHistoryBody) {
        harvestHistoryBody.innerHTML = `
            <tr>
                <td colspan="6" class="harvest-empty">
                    You do not have permission to view harvest records.
                    Please contact your Administrator.
                </td>
            </tr>
        `;
    }

    if (rejectedHarvestBody) {
        rejectedHarvestBody.innerHTML = `
            <tr>
                <td colspan="5" class="harvest-empty">
                    You do not have permission to view harvest records.
                </td>
            </tr>
        `;
    }

    cleanupHarvestRealtime();
}

// ==========================================
// AUTHENTICATION
// ==========================================

async function validateFarmerSession() {
    const {
        data: { user },
        error: authError
    } = await supabase.auth.getUser();

    if (authError || !user) {
        window.location.replace('../../login.html');
        return false;
    }

    const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, role, status')
        .eq('id', user.id)
        .maybeSingle();

    if (profileError) {
        console.error('Profile loading error:', profileError);
        throw new Error('Unable to verify your Farmer account.');
    }

    if (
        !profile ||
        profile.role !== 'farmer' ||
        !['active', 'approved'].includes(
            String(profile.status || '').toLowerCase()
        )
    ) {
        await supabase.auth.signOut();
        window.location.replace('../../login.html');
        return false;
    }

    currentUser = user;

    return true;
}

// ==========================================
// FARMER PROFILE
// ==========================================

function displayFarmerProfile() {
    if (!currentUser) return;

    const displayName = getFarmerDisplayName(currentUser);

    if (farmerNameElement) {
        farmerNameElement.textContent = displayName;
    }

    if (farmerAvatarElement) {
        farmerAvatarElement.textContent = displayName
            .trim()
            .charAt(0)
            .toUpperCase();
    }
}

// ==========================================
// LOAD ASSIGNED PLANTINGS
// ==========================================
async function loadAssignedPlantings() {
    if (!canCreateHarvest && !canEditHarvest) return;
    if (!plantingSelect) return;

    plantingSelect.innerHTML = `
        <option value="">Loading ready-to-harvest plantings...</option>
    `;

    plantingSelect.disabled = true;

    try {
        const { data: plantings, error: plantingError } = await supabase
            .from('farm_plantings')
            .select(`
                id,
                crop_name,
                expected_harvest_date,
                crop_status,
                activity_status
            `)
            .eq('farmer_id', currentUser.id)
            .eq('crop_status', 'ready')
            .order('expected_harvest_date', { ascending: true });

        if (plantingError) throw plantingError;

        if (!plantings || plantings.length === 0) {
            assignedPlantings = [];

            plantingSelect.innerHTML = `
                <option value="">No ready-to-harvest plantings available</option>
            `;

            if (submitHarvestButton) {
                submitHarvestButton.disabled = true;
            }

            return;
        }

        const plantingIds = plantings.map(planting => planting.id);

        const { data: harvestRecords, error: harvestError } = await supabase
            .from('harvested_crops')
            .select('planting_id, confirmation_status')
            .eq('farmer_id', currentUser.id)
            .in('planting_id', plantingIds);

        if (harvestError) throw harvestError;

        // Exclude plantings with pending or confirmed harvest records.
        // Rejected records remain eligible for resubmission.
        const alreadySubmittedPlantingIds = new Set(
            (harvestRecords || [])
                .filter(record =>
                    record.confirmation_status !== 'rejected'
                )
                .map(record => record.planting_id)
        );

        assignedPlantings = plantings.filter(
            planting => !alreadySubmittedPlantingIds.has(planting.id)
        );

        if (assignedPlantings.length === 0) {
            plantingSelect.innerHTML = `
                <option value="">No available plantings for harvest submission</option>
            `;

            if (submitHarvestButton) {
                submitHarvestButton.disabled = true;
            }

            return;
        }

        plantingSelect.innerHTML = `
            <option value="">Select a ready-to-harvest planting</option>
            ${assignedPlantings.map(planting => `
                <option value="${escapeHTML(planting.id)}">
                    ${escapeHTML(planting.crop_name || 'Unnamed Crop')}
                </option>
            `).join('')}
        `;

        plantingSelect.disabled = false;

        updateSubmitButtonState();

    } catch (error) {
        console.error('Failed to load ready-to-harvest plantings:', error);

        assignedPlantings = [];

        plantingSelect.innerHTML = `
            <option value="">Unable to load plantings</option>
        `;

        if (submitHarvestButton) {
            submitHarvestButton.disabled = true;
        }

        showMessage(
            'Unable to load your available plantings. Please try again.',
            'error'
        );
    }
}

function updateSubmitButtonState() {
    if (!submitHarvestButton) return;

    if (resubmittingHarvestId) {
        submitHarvestButton.disabled = !canEditHarvest;
        submitHarvestButton.textContent = 'Resubmit Harvest';
        return;
    }

    submitHarvestButton.disabled =
        !canCreateHarvest || assignedPlantings.length === 0;

    submitHarvestButton.textContent = 'Submit Harvest Record';
}

// ==========================================
// SUBMIT / RESUBMIT HARVEST RECORD
// ==========================================

async function handleHarvestSubmission(event) {
    event.preventDefault();
    clearMessage();

    if (!currentUser) {
        showMessage('Your session has expired. Please log in again.', 'error');
        return;
    }

    const isResubmission = Boolean(resubmittingHarvestId);

    if (isResubmission && !canEditHarvest) {
        showMessage(
            'You do not have permission to edit or resubmit harvest records.',
            'error'
        );
        return;
    }

    if (!isResubmission && !canCreateHarvest) {
        showMessage(
            'You do not have permission to create harvest records.',
            'error'
        );
        return;
    }

    const plantingId = plantingSelect?.value;
    const harvestedDate = harvestedDateInput?.value;
    const quantity = Number(harvestQuantityInput?.value);
    const unit = harvestUnitInput?.value.trim();
    const notes = harvestNotesInput?.value.trim();

    const selectedPlanting = assignedPlantings.find(
        planting => planting.id === plantingId
    );

    if (!selectedPlanting) {
        showMessage('Please select one of your assigned plantings.', 'error');
        return;
    }

    if (!harvestedDate) {
        showMessage('Please select the harvest date.', 'error');
        return;
    }

    if (harvestedDate > getLocalDate()) {
        showMessage('Harvest date cannot be in the future.', 'error');
        return;
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
        showMessage('Please enter a harvest quantity greater than zero.', 'error');
        return;
    }

    if (!unit) {
        showMessage('Please select a harvest unit.', 'error');
        return;
    }

    const targetHarvestId = resubmittingHarvestId;

    if (submitHarvestButton) {
        submitHarvestButton.disabled = true;
        submitHarvestButton.textContent = isResubmission
            ? 'Resubmitting...'
            : 'Submitting...';
    }

    try {
        const harvestRecord = {
            planting_id: selectedPlanting.id,
            harvested_date: harvestedDate,
            harvest_quantity: quantity,
            harvest_unit: unit,
            confirmation_status: 'pending',
            verified_quantity: null,
            verification_notes: null,
            confirmed_at: null,
            notes: notes || null
        };

        if (isResubmission) {
            const result = await supabase
                .from('harvested_crops')
                .update(harvestRecord)
                .eq('harvest_id', targetHarvestId)
                .eq('farmer_id', currentUser.id)
                .eq('confirmation_status', 'rejected')
                .select('harvest_id')
                .maybeSingle();

            if (result.error) throw result.error;

            if (!result.data) {
                throw new Error(
                    'This harvest record is no longer rejected or cannot be updated. Please refresh the page.'
                );
            }
        } else {
            const result = await supabase
                .from('harvested_crops')
                .insert({
                    ...harvestRecord,
                    farmer_id: currentUser.id
                });

            if (result.error) throw result.error;
        }

        resetResubmissionState();

        if (harvestForm) {
            harvestForm.reset();
        }

        showMessage(
            isResubmission
                ? 'Harvest record successfully updated and resubmitted. It is now waiting for Warehouse Officer verification.'
                : 'Harvest record submitted successfully. It is now waiting for Warehouse Officer verification.',
            'success'
        );

        await loadHarvestHistory();

    } catch (error) {
        console.error('Harvest submission error:', error);

        showMessage(
            error.message || 'Failed to submit harvest record. Please try again.',
            'error'
        );

    } finally {
        updateSubmitButtonState();
    }
}

// ==========================================
// LOAD HARVEST HISTORY AND REJECTED RECORDS
// ==========================================

async function loadHarvestHistory() {
    if (!currentUser || !canViewHarvests) return;

    const { data: harvestRecords, error } = await supabase
        .from('harvested_crops')
        .select(`
            harvest_id,
            planting_id,
            harvested_date,
            harvest_quantity,
            harvest_unit,
            confirmation_status,
            verified_quantity,
            verification_notes,
            notes,
            created_at,
            confirmed_at
        `)
        .eq('farmer_id', currentUser.id)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Failed to load harvest history:', error);

        if (harvestHistoryBody) {
            harvestHistoryBody.innerHTML = `
                <tr>
                    <td colspan="6" class="harvest-empty">
                        Unable to load harvest records.
                    </td>
                </tr>
            `;
        }

        if (rejectedHarvestBody) {
            rejectedHarvestBody.innerHTML = `
                <tr>
                    <td colspan="5" class="harvest-empty">
                        Unable to load rejected harvests.
                    </td>
                </tr>
            `;
        }

        return;
    }

    const records = harvestRecords || [];

    if (records.length === 0) {
        if (harvestHistoryBody) {
            harvestHistoryBody.innerHTML = `
                <tr>
                    <td colspan="6" class="harvest-empty">
                        You have not submitted any harvest records yet.
                    </td>
                </tr>
            `;
        }

        if (rejectedHarvestBody) {
            rejectedHarvestBody.innerHTML = `
                <tr>
                    <td colspan="5" class="harvest-empty">
                        No rejected harvest submissions.
                    </td>
                </tr>
            `;
        }

        return;
    }

    const plantingIds = [
        ...new Set(records.map(record => record.planting_id).filter(Boolean))
    ];

    const { data: plantings, error: plantingError } = await supabase
        .from('farm_plantings')
        .select('id, crop_name')
        .in('id', plantingIds);

    if (plantingError) {
        console.error('Failed to load harvest crop names:', plantingError);
    }

    const plantingMap = new Map(
        (plantings || []).map(planting => [
            planting.id,
            planting.crop_name || 'Unnamed Crop'
        ])
    );

    const historyRecords = records.filter(record =>
        record.confirmation_status !== 'rejected'
    );

    if (harvestHistoryBody) {
        if (historyRecords.length === 0) {
            harvestHistoryBody.innerHTML = `
                <tr>
                    <td colspan="6" class="harvest-empty">
                        No active or verified harvest records.
                    </td>
                </tr>
            `;
        } else {
            harvestHistoryBody.innerHTML = historyRecords.map(record => {
                const cropName =
                    plantingMap.get(record.planting_id) || 'Crop record';

                const status = record.confirmation_status || 'pending';

                const verifiedQuantity =
                    status === 'confirmed'
                        ? formatQuantity(
                            record.verified_quantity,
                            record.harvest_unit
                        )
                        : '—';

                const remarks =
                    status === 'confirmed'
                        ? record.verification_notes || '—'
                        : '—';

                return `
                    <tr>
                        <td>${escapeHTML(cropName)}</td>
                        <td>${escapeHTML(formatDate(record.harvested_date))}</td>
                        <td>${escapeHTML(formatQuantity(
                            record.harvest_quantity,
                            record.harvest_unit
                        ))}</td>
                        <td>${escapeHTML(verifiedQuantity)}</td>
                        <td>
                            <span class="harvest-status status-${escapeHTML(status)}">
                                ${escapeHTML(getStatusLabel(status))}
                            </span>
                        </td>
                        <td>${escapeHTML(remarks)}</td>
                    </tr>
                `;
            }).join('');
        }
    }

    if (!rejectedHarvestBody) return;

    const rejectedRecords = records.filter(record =>
        record.confirmation_status === 'rejected'
    );

    if (rejectedRecords.length === 0) {
        rejectedHarvestBody.innerHTML = `
            <tr>
                <td colspan="5" class="harvest-empty">
                    No rejected harvests awaiting resubmission.
                </td>
            </tr>
        `;

        return;
    }

    rejectedHarvestBody.innerHTML = rejectedRecords.map(record => {
        const cropName =
            plantingMap.get(record.planting_id) || 'Crop record';

        return `
            <tr>
                <td>${escapeHTML(cropName)}</td>
                <td>${escapeHTML(formatDate(record.harvested_date))}</td>
                <td>${escapeHTML(formatQuantity(
                    record.harvest_quantity,
                    record.harvest_unit
                ))}</td>
                <td>${escapeHTML(
                    record.verification_notes ||
                    'No rejection remarks provided.'
                )}</td>
                <td>
                    ${canEditHarvest
                        ? `<button
                            type="button"
                            class="harvest-resubmit-btn"
                            data-resubmit-id="${escapeHTML(record.harvest_id)}"
                        >
                            Resubmit
                        </button>`
                        : '—'
                    }
                </td>
            </tr>
        `;
    }).join('');

    if (!canEditHarvest) return;

    rejectedHarvestBody
        .querySelectorAll('[data-resubmit-id]')
        .forEach(button => {
            button.addEventListener('click', () => {
                if (!canEditHarvest) return;

                const rejectedRecord = rejectedRecords.find(
                    record =>
                        String(record.harvest_id) ===
                        String(button.dataset.resubmitId)
                );

                if (!rejectedRecord) {
                    showMessage(
                        'Unable to find the rejected harvest record.',
                        'error'
                    );
                    return;
                }

                resubmittingHarvestId = rejectedRecord.harvest_id;

                if (plantingSelect) {
                    plantingSelect.value = rejectedRecord.planting_id;
                }

                if (harvestedDateInput) {
                    harvestedDateInput.value =
                        rejectedRecord.harvested_date || '';
                }

                if (harvestQuantityInput) {
                    harvestQuantityInput.value =
                        rejectedRecord.harvest_quantity ?? '';
                }

                if (harvestUnitInput) {
                    harvestUnitInput.value =
                        rejectedRecord.harvest_unit || '';
                }

                if (harvestNotesInput) {
                    harvestNotesInput.value =
                        rejectedRecord.notes || '';
                }

                if (submitHarvestButton) {
                    submitHarvestButton.disabled = false;
                    submitHarvestButton.textContent = 'Resubmit Harvest';
                }

                showMessage(
                    `Rejection Reason: ${
                        rejectedRecord.verification_notes ||
                        'No reason provided.'
                    } Please correct your details before resubmitting.`,
                    'error'
                );

                harvestForm?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center'
                });

                harvestQuantityInput?.focus();
            });
        });
}

// ==========================================
// REALTIME HARVEST UPDATES
// ==========================================

function subscribeToHarvestUpdates() {
    if (!currentUser || !canViewHarvests) return;

    if (harvestRealtimeChannel) {
        supabase.removeChannel(harvestRealtimeChannel);
    }

    harvestRealtimeChannel = supabase
        .channel(`farmer-harvests-${currentUser.id}`)
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'harvested_crops',
                filter: `farmer_id=eq.${currentUser.id}`
            },
            async () => {
                await loadHarvestHistory();
            }
        )
        .subscribe(status => {
            if (status === 'CHANNEL_ERROR') {
                console.error('Harvest Realtime subscription failed.');
            }
        });
}

function cleanupHarvestRealtime() {
    if (harvestRealtimeChannel) {
        supabase.removeChannel(harvestRealtimeChannel);
        harvestRealtimeChannel = null;
    }
}

// ==========================================
// LOGOUT
// ==========================================

function initializeLogout() {
    if (!logoutButton) return;

    logoutButton.addEventListener('click', async () => {
        if (logoutLabel) logoutLabel.textContent = 'Logging out...';

        logoutButton.disabled = true;
        cleanupHarvestRealtime();

        const { error } = await supabase.auth.signOut();

        if (error) {
            console.error('Logout error:', error);

            if (logoutLabel) logoutLabel.textContent = 'Log out';

            logoutButton.disabled = false;
            return;
        }

        window.location.replace('../../login.html');
    });
}

// ==========================================
// INITIALIZATION
// ==========================================

async function initializeHarvestPage() {
    document.body.classList.add('permissions-loading');

    try {
        // Basic page behavior first, so these work even if access is denied.
        initializeLogout();

        if (todayLabel) {
            todayLabel.textContent = new Date().toLocaleDateString('en-PH', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
        }

        if (harvestedDateInput) {
            harvestedDateInput.max = getLocalDate();
        }

        const isValidFarmer = await validateFarmerSession();

        if (!isValidFarmer) return;

        displayFarmerProfile();

        // Check all sidebar permissions first.
        await applyNavigationPermissions();

        // Check this page's own permissions.
        const hasViewPermission = await loadHarvestPermissions();

        if (!hasViewPermission) {
            showAccessDenied();
            return;
        }

        configureHarvestForm();

        if (canCreateHarvest || canEditHarvest) {
            await loadAssignedPlantings();
        }

        await loadHarvestHistory();

        subscribeToHarvestUpdates();

        harvestForm?.addEventListener('submit', handleHarvestSubmission);

    } catch (error) {
        console.error('Farmer Harvest Page Initialization Error:', error);

        showMessage(
            error.message || 'Something went wrong while loading the page.',
            'error'
        );

    } finally {
        hidePermissionsLoading();
    }
}

// ==========================================
// CLEANUP
// ==========================================

window.addEventListener('beforeunload', cleanupHarvestRealtime);

initializeHarvestPage();