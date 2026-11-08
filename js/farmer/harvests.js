
import { supabase } from '../connection.js';

// ==========================================
// ELEMENTS
// ==========================================

const farmerNameElement = document.getElementById('farmerName');
const farmerAvatarElement = document.getElementById('farmerAvatar');
const todayLabel = document.getElementById('todayLabel');

const logoutButton = document.getElementById('logoutButton');
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

const THEME_KEY = 'theme';

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

    if (themeToggle) {
        themeToggle.addEventListener('click', event => {
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
    }

    window.addEventListener('storage', event => {
        if (event.key === THEME_KEY && event.newValue) {
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
        .single();

    if (
        profileError ||
        !profile ||
        profile.role !== 'farmer' ||
        !['active', 'approved'].includes(profile.status)
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

    const metadata = currentUser.user_metadata || {};

    const firstName = metadata.first_name || metadata.firstName || '';
    const middleName = metadata.middle_name || metadata.middleName || '';
    const lastName = metadata.last_name || metadata.lastName || '';

    const fullName = [firstName, middleName, lastName]
        .filter(Boolean)
        .join(' ')
        .trim();

    const displayName =
        fullName ||
        metadata.full_name ||
        metadata.name ||
        currentUser.email?.split('@')[0] ||
        'Farmer';

    if (farmerNameElement) {
        farmerNameElement.textContent = displayName;
    }

    if (farmerAvatarElement) {
        farmerAvatarElement.textContent = displayName.charAt(0).toUpperCase();
    }

    if (todayLabel) {
        todayLabel.textContent = new Date().toLocaleDateString('en-PH', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    }
}

// ==========================================
// LOAD ASSIGNED PLANTINGS
// ==========================================

async function loadAssignedPlantings() {
    plantingSelect.innerHTML = `
        <option value="">Loading your plantings...</option>
    `;

    const { data, error } = await supabase
        .from('farm_plantings')
        .select(`
            id,
            crop_name,
            expected_harvest_date,
            crop_status,
            activity_status
        `)
        .eq('farmer_id', currentUser.id)
        .neq('crop_status', 'harvested')
        .order('expected_harvest_date', { ascending: true });

    if (error) {
        console.error('Failed to load assigned plantings:', error);

        plantingSelect.innerHTML = `
            <option value="">Unable to load plantings</option>
        `;

        showMessage(
            'Unable to load your assigned plantings. Please try again.',
            'error'
        );

        return;
    }

    assignedPlantings = data || [];

    if (assignedPlantings.length === 0) {
        plantingSelect.innerHTML = `
            <option value="">No eligible plantings available</option>
        `;

        plantingSelect.disabled = true;
        submitHarvestButton.disabled = true;

        return;
    }

    plantingSelect.disabled = false;
    submitHarvestButton.disabled = false;

    plantingSelect.innerHTML = `
        <option value="">Select an assigned planting</option>
        ${assignedPlantings.map(planting => `
            <option value="${escapeHTML(planting.id)}">
                ${escapeHTML(planting.crop_name || 'Unnamed Crop')}
            </option>
        `).join('')}
    `;
}

// ==========================================
// SUBMIT / OVERRIDE HARVEST RECORD
// ==========================================

async function handleHarvestSubmission(event) {
    event.preventDefault();
    clearMessage();

    if (!currentUser) {
        showMessage('Your session has expired. Please log in again.', 'error');
        return;
    }

    const plantingId = plantingSelect.value;
    const harvestedDate = harvestedDateInput.value;
    const quantity = Number(harvestQuantityInput.value);
    const unit = harvestUnitInput.value.trim();
    const notes = harvestNotesInput.value.trim();

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

    const isResubmission = Boolean(resubmittingHarvestId);
    const targetHarvestId = resubmittingHarvestId;

    submitHarvestButton.disabled = true;
    submitHarvestButton.textContent = isResubmission
        ? 'Resubmitting...'
        : 'Submitting...';

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

        let error;

        if (isResubmission) {
            // OVERRIDE the existing rejected record.
            // No new harvested_crops row is created.
            const result = await supabase
                .from('harvested_crops')
                .update(harvestRecord)
                .eq('harvest_id', targetHarvestId)
                .eq('farmer_id', currentUser.id)
                .eq('confirmation_status', 'rejected')
                .select('harvest_id')
                .maybeSingle();

            error = result.error;

            if (error) throw error;

            if (!result.data) {
                throw new Error(
                    'This harvest record is no longer rejected or cannot be updated. Please refresh the page.'
                );
            }
        } else {
            // New submission: create a new record.
            const result = await supabase
                .from('harvested_crops')
                .insert({
                    ...harvestRecord,
                    farmer_id: currentUser.id
                });

            error = result.error;

            if (error) throw error;
        }

        resetResubmissionState();
        harvestForm.reset();

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
        submitHarvestButton.disabled = assignedPlantings.length === 0;

        if (!resubmittingHarvestId) {
            submitHarvestButton.textContent = 'Submit Harvest Record';
        } else {
            submitHarvestButton.textContent = 'Resubmit Harvest';
        }
    }
}

// ==========================================
// LOAD HARVEST HISTORY AND REJECTED RECORDS
// ==========================================

async function loadHarvestHistory() {
    if (!currentUser) return;

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

        harvestHistoryBody.innerHTML = `
            <tr>
                <td colspan="6" class="harvest-empty">
                    Unable to load harvest records.
                </td>
            </tr>
        `;

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
        harvestHistoryBody.innerHTML = `
            <tr>
                <td colspan="6" class="harvest-empty">
                    You have not submitted any harvest records yet.
                </td>
            </tr>
        `;

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
        ...new Set(records.map(record => record.planting_id))
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

    // ==========================================
    // MY HARVEST HISTORY
    // Show pending, in-progress, and confirmed only.
    // Rejected records are displayed separately.
    // ==========================================

    const historyRecords = records.filter(record =>
        record.confirmation_status !== 'rejected'
    );

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

                    <td>
                        ${escapeHTML(formatQuantity(
                record.harvest_quantity,
                record.harvest_unit
            ))}
                    </td>

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

    // ==========================================
    // REJECTED HARVESTS
    // ==========================================

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

                <td>
                    ${escapeHTML(formatQuantity(
            record.harvest_quantity,
            record.harvest_unit
        ))}
                </td>

                <td>
                    ${escapeHTML(
            record.verification_notes ||
            'No rejection remarks provided.'
        )}
                </td>

                <td>
                    <button
                        type="button"
                        class="harvest-resubmit-btn"
                        data-resubmit-id="${escapeHTML(record.harvest_id)}"
                    >
                        Resubmit
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    // ==========================================
    // RESUBMIT BUTTON EVENTS
    // ==========================================

    rejectedHarvestBody
        .querySelectorAll('[data-resubmit-id]')
        .forEach(button => {
            button.addEventListener('click', () => {
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

                plantingSelect.value = rejectedRecord.planting_id;
                harvestedDateInput.value =
                    rejectedRecord.harvested_date || '';

                harvestQuantityInput.value =
                    rejectedRecord.harvest_quantity ?? '';

                harvestUnitInput.value =
                    rejectedRecord.harvest_unit || '';

                harvestNotesInput.value =
                    rejectedRecord.notes || '';

                submitHarvestButton.textContent = 'Resubmit Harvest';

                showMessage(
                    `Rejection Reason: ${rejectedRecord.verification_notes ||
                    'No reason provided.'
                    } Please correct your details before resubmitting.`,
                    'error'
                );

                harvestForm.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center'
                });

                harvestQuantityInput.focus();
            });
        });
}

// ==========================================
// REALTIME HARVEST UPDATES
// ==========================================

function subscribeToHarvestUpdates() {
    if (!currentUser) return;

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

// ==========================================
// LOGOUT
// ==========================================

async function handleLogout() {
    if (harvestRealtimeChannel) {
        await supabase.removeChannel(harvestRealtimeChannel);
        harvestRealtimeChannel = null;
    }

    const { error } = await supabase.auth.signOut();

    if (error) {
        console.error('Logout failed:', error);
        alert('Unable to log out. Please try again.');
        return;
    }

    window.location.replace('../../login.html');
}

// ==========================================
// INITIALIZATION
// ==========================================

async function initializeHarvestPage() {
    applyTheme(readSavedTheme() || 'light');

    harvestedDateInput.max = getLocalDate();

    const isValidFarmer = await validateFarmerSession();

    if (!isValidFarmer) return;

    displayFarmerProfile();

    await loadAssignedPlantings();
    await loadHarvestHistory();

    subscribeToHarvestUpdates();

    harvestForm.addEventListener('submit', handleHarvestSubmission);
    logoutButton?.addEventListener('click', handleLogout);

    document.querySelectorAll('[data-coming-soon]').forEach(link => {
        link.addEventListener('click', event => {
            event.preventDefault();
            alert('This feature is not yet available.');
        });
    });
}

// ==========================================
// CLEANUP
// ==========================================

window.addEventListener('beforeunload', () => {
    if (harvestRealtimeChannel) {
        supabase.removeChannel(harvestRealtimeChannel);
    }
});

initializeHarvestPage();
