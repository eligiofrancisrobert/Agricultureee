
import { supabase } from '../connection.js';

let cleanupHandler = null;

const STORAGE_BUCKET = 'crop-monitoring-photos';
const MAX_PHOTO_SIZE = 3 * 1024 * 1024;

const ALLOWED_PHOTO_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp'
];

const GROWTH_STAGES = [
    { value: 'germination', label: 'Germination' },
    { value: 'seedling', label: 'Seedling' },
    { value: 'vegetative', label: 'Vegetative' },
    { value: 'flowering', label: 'Flowering' },
    { value: 'fruiting', label: 'Fruiting' },
    { value: 'maturing', label: 'Maturing' },
    { value: 'ready_for_harvest', label: 'Ready for Harvest' }
];

const HEALTH_STATUSES = [
    { value: 'healthy', label: 'Healthy' },
    { value: 'good', label: 'Good' },
    { value: 'fair', label: 'Fair' },
    { value: 'poor', label: 'Poor' },
    { value: 'critical', label: 'Critical' }
];

export async function render(root, ctx = {}) {
    if (cleanupHandler) cleanupHandler();

    root.innerHTML = `
        <section class="crop-monitoring-page">
            <div class="page-header">
                <div>
                    <h2>Crop Monitoring</h2>
                    <p>Monitor planted crops from farmers in your assigned farms.</p>
                </div>
            </div>

            <div class="crop-monitoring-toolbar">
                <span id="cropCount">Loading crops...</span>
            </div>

            <div id="cropMonitoringContent">
                <p>Loading planted crops...</p>
            </div>

            <div
                id="monitoringModal"
                class="crop-monitoring-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="monitoringModalTitle"
                hidden
            >
                <div
                    class="crop-monitoring-modal-overlay"
                    data-action="close-modal"
                ></div>

                <div class="crop-monitoring-modal-dialog">
                    <div class="crop-monitoring-modal-header">
                        <div>
                            <h3 id="monitoringModalTitle">Add Monitoring Record</h3>
                            <p id="monitoringModalCropName"></p>
                        </div>

                        <button
                            type="button"
                            class="monitoring-modal-close"
                            data-action="close-modal"
                            aria-label="Close modal"
                        >&times;</button>
                    </div>

                    <form id="cropMonitoringForm" class="crop-monitoring-form">
                        <div class="form-group">
                            <label for="monitoringGrowthStage">Growth Stage</label>
                            <select
                                id="monitoringGrowthStage"
                                name="growth_stage"
                                required
                            >
                                <option value="">Select growth stage</option>
                            </select>
                            <small>Growth stage cannot move backward.</small>
                        </div>

                        <div class="form-group">
                            <label for="monitoringHealth">Crop Health Status</label>
                            <select
                                id="monitoringHealth"
                                name="crop_health_status"
                                required
                            >
                                <option value="">Select crop health</option>
                                ${HEALTH_STATUSES.map(status => `
                                    <option value="${status.value}">
                                        ${status.label}
                                    </option>
                                `).join('')}
                            </select>
                        </div>

                        <div class="form-group">
                            <label for="monitoringPest">Pest Observed?</label>
                            <select id="monitoringPest" name="pest_observed" required>
                                <option value="false">No</option>
                                <option value="true">Yes</option>
                            </select>
                        </div>

                        <div class="form-group">
                            <label for="monitoringPestDetails">Pest Details</label>
                            <textarea
                                id="monitoringPestDetails"
                                name="pest_details"
                                rows="2"
                                placeholder="Describe the observed pests..."
                            ></textarea>
                        </div>

                        <div class="form-group">
                            <label for="monitoringDisease">Disease Observed?</label>
                            <select
                                id="monitoringDisease"
                                name="disease_observed"
                                required
                            >
                                <option value="false">No</option>
                                <option value="true">Yes</option>
                            </select>
                        </div>

                        <div class="form-group">
                            <label for="monitoringDiseaseDetails">Disease Details</label>
                            <textarea
                                id="monitoringDiseaseDetails"
                                name="disease_details"
                                rows="2"
                                placeholder="Describe the observed disease..."
                            ></textarea>
                        </div>

                        <div class="form-group">
                            <label for="monitoringObservations">Observations</label>
                            <textarea
                                id="monitoringObservations"
                                name="observations"
                                rows="4"
                                required
                                placeholder="Enter crop observations..."
                            ></textarea>
                        </div>

                        <div class="form-group">
                            <label for="monitoringPhoto">Monitoring Photo</label>
                            <input
                                type="file"
                                id="monitoringPhoto"
                                name="monitoring_photo"
                                accept="image/jpeg,image/png,image/webp"
                            >
                            <small>JPG, PNG, or WebP. Maximum file size: 3 MB.</small>

                            <img
                                class="monitoring-photo-preview"
                                alt="Monitoring photo preview"
                                hidden
                            >
                        </div>

                        <div class="form-group">
                            <label for="monitoringActionRequired">Action Required?</label>
                            <select
                                id="monitoringActionRequired"
                                name="action_required"
                                required
                            >
                                <option value="false">No</option>
                                <option value="true">Yes</option>
                            </select>
                        </div>

                        <div class="form-group">
                            <label for="monitoringRecommendedAction">Recommended Action</label>
                            <textarea
                                id="monitoringRecommendedAction"
                                name="recommended_action"
                                rows="3"
                                placeholder="Enter recommended actions..."
                            ></textarea>
                        </div>

                        <div class="monitoring-form-actions">
                            <button
                                type="button"
                                class="cancel-monitoring-btn"
                                data-action="close-modal"
                            >
                                Cancel
                            </button>

                            <button
                                type="submit"
                                class="save-monitoring-btn"
                            >
                                Submit Monitoring Record
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </section>
    `;

    const content = root.querySelector('#cropMonitoringContent');
    const count = root.querySelector('#cropCount');

    const modal = root.querySelector('#monitoringModal');
    const modalTitle = root.querySelector('#monitoringModalCropName');
    const modalForm = root.querySelector('#cropMonitoringForm');
    const growthStageSelect = root.querySelector('#monitoringGrowthStage');
    const photoPreview = root.querySelector('.monitoring-photo-preview');

    let crops = [];
    let monitoringRecords = [];
    let isSaving = false;
    let previewUrl = null;
    let previousBodyOverflow = '';
    let alertModal = null;

    const expandedHistoryIds = new Set();

    // ============================================================
    // THEME-AWARE ALERT MODAL
    // ============================================================

    function injectAlertStyles() {
        if (document.getElementById('crop-monitoring-alert-styles')) return;

        const style = document.createElement('style');
        style.id = 'crop-monitoring-alert-styles';

        style.textContent = `
            .crop-alert-overlay {
                position: fixed;
                inset: 0;
                z-index: 100000;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
                background: rgba(0, 0, 0, 0.48);
                backdrop-filter: blur(4px);
                -webkit-backdrop-filter: blur(4px);
                animation: cropAlertFadeIn 0.18s ease;
            }

            .crop-alert-dialog {
                --crop-alert-bg: var(--card-bg, var(--surface, #ffffff));
                --crop-alert-text: var(--text-primary, var(--text-color, #242424));
                --crop-alert-muted: var(--text-secondary, #777777);
                --crop-alert-border: var(--border-color, #e7e3dc);
                --crop-alert-primary: var(--primary-color, #C65D3A);

                width: 100%;
                max-width: 420px;
                padding: 30px;
                border: 1px solid var(--crop-alert-border);
                border-radius: 18px;
                background: var(--crop-alert-bg);
                color: var(--crop-alert-text);
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.22);
                text-align: center;
                animation: cropAlertSlideIn 0.22s ease;
            }

            .crop-alert-icon {
                width: 58px;
                height: 58px;
                margin: 0 auto 17px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 50%;
                font-size: 27px;
                font-weight: 700;
            }

            .crop-alert-dialog[data-type="success"] .crop-alert-icon {
                color: #27864d;
                background: rgba(39, 134, 77, 0.13);
            }

            .crop-alert-dialog[data-type="error"] .crop-alert-icon {
                color: #d04444;
                background: rgba(208, 68, 68, 0.13);
            }

            .crop-alert-dialog[data-type="warning"] .crop-alert-icon {
                color: #bd8525;
                background: rgba(189, 133, 37, 0.14);
            }

            .crop-alert-dialog[data-type="info"] .crop-alert-icon {
                color: var(--crop-alert-primary);
                background: color-mix(
                    in srgb,
                    var(--crop-alert-primary) 14%,
                    transparent
                );
            }

            .crop-alert-title {
                margin: 0 0 9px;
                color: var(--crop-alert-text);
                font-size: 19px;
                font-weight: 700;
            }

            .crop-alert-message {
                margin: 0;
                color: var(--crop-alert-muted);
                font-size: 14px;
                line-height: 1.65;
                white-space: pre-line;
                overflow-wrap: anywhere;
            }

            .crop-alert-actions {
                display: flex;
                justify-content: center;
                margin-top: 25px;
            }

            .crop-alert-ok {
                min-width: 115px;
                padding: 11px 25px;
                border: none;
                border-radius: 9px;
                background: var(--crop-alert-primary);
                color: #ffffff;
                font: inherit;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
                transition: opacity 0.2s ease, transform 0.2s ease;
            }

            .crop-alert-ok:hover {
                opacity: 0.9;
                transform: translateY(-1px);
            }

            .crop-alert-ok:focus-visible {
                outline: 3px solid var(--crop-alert-primary);
                outline-offset: 3px;
            }

            html[data-theme="dark"] .crop-alert-dialog,
            body[data-theme="dark"] .crop-alert-dialog,
            html.dark .crop-alert-dialog,
            body.dark .crop-alert-dialog,
            html.dark-mode .crop-alert-dialog,
            body.dark-mode .crop-alert-dialog,
            html[data-mode="dark"] .crop-alert-dialog,
            body[data-mode="dark"] .crop-alert-dialog {
                --crop-alert-bg: var(--card-bg, var(--surface, #242424));
                --crop-alert-text: var(--text-primary, var(--text-color, #f5f5f5));
                --crop-alert-muted: var(--text-secondary, #b8b8b8);
                --crop-alert-border: var(--border-color, #414141);
                --crop-alert-primary: var(--primary-color, #E07852);
            }

            @media (prefers-reduced-motion: reduce) {
                .crop-alert-overlay,
                .crop-alert-dialog {
                    animation: none;
                }
            }

            @keyframes cropAlertFadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }

            @keyframes cropAlertSlideIn {
                from {
                    opacity: 0;
                    transform: translateY(12px) scale(0.98);
                }
                to {
                    opacity: 1;
                    transform: translateY(0) scale(1);
                }
            }

            @media (max-width: 480px) {
                .crop-alert-dialog {
                    padding: 25px 20px;
                }
            }
        `;

        document.head.appendChild(style);
    }

    function showAlertModal(message, type = 'info', title = '') {
        injectAlertStyles();

        if (alertModal) {
            alertModal.remove();
            alertModal = null;
        }

        const alertSettings = {
            success: {
                icon: '✓',
                title: title || 'Success'
            },
            error: {
                icon: '!',
                title: title || 'Something went wrong'
            },
            warning: {
                icon: '!',
                title: title || 'Attention'
            },
            info: {
                icon: 'i',
                title: title || 'Notice'
            }
        };

        const settings = alertSettings[type] || alertSettings.info;

        const overlay = document.createElement('div');
        overlay.className = 'crop-alert-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'crop-alert-dialog';
        dialog.dataset.type = type;
        dialog.setAttribute('role', 'alertdialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', 'cropAlertTitle');
        dialog.setAttribute('aria-describedby', 'cropAlertMessage');

        const icon = document.createElement('div');
        icon.className = 'crop-alert-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = settings.icon;

        const heading = document.createElement('h3');
        heading.className = 'crop-alert-title';
        heading.id = 'cropAlertTitle';
        heading.textContent = settings.title;

        const description = document.createElement('p');
        description.className = 'crop-alert-message';
        description.id = 'cropAlertMessage';
        description.textContent = String(message ?? '');

        const actions = document.createElement('div');
        actions.className = 'crop-alert-actions';

        const okButton = document.createElement('button');
        okButton.type = 'button';
        okButton.className = 'crop-alert-ok';
        okButton.textContent = 'OK';

        actions.appendChild(okButton);
        dialog.append(icon, heading, description, actions);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        alertModal = overlay;

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        function closeAlert() {
            if (!overlay.isConnected) return;

            overlay.remove();

            if (alertModal === overlay) {
                alertModal = null;
            }

            document.body.style.overflow = previousOverflow;
            document.removeEventListener('keydown', handleAlertEscape);
        }

        okButton.addEventListener('click', closeAlert);

        overlay.addEventListener('click', event => {
            if (event.target === overlay) {
                closeAlert();
            }
        });

        function handleAlertEscape(event) {
            if (event.key === 'Escape' && alertModal === overlay) {
                closeAlert();
            }
        }

        document.addEventListener('keydown', handleAlertEscape);

        okButton.focus();

        return closeAlert;
    }

    function escapeHTML(value) {
        return String(value ?? '').replace(/[&<>"']/g, char => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        })[char]);
    }

    function formatDate(value) {
        if (!value) return '—';

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) return '—';

        return date.toLocaleDateString('en-PH', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    }

    function formatDateTime(value) {
        if (!value) return '—';

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) return '—';

        return date.toLocaleString('en-PH', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
    }

    function getStageOrder(stage) {
        return GROWTH_STAGES.findIndex(item => item.value === stage);
    }

    function getStageLabel(stage) {
        return GROWTH_STAGES.find(item => item.value === stage)?.label || 'Not specified';
    }

    function getHealthLabel(status) {
        return HEALTH_STATUSES.find(item => item.value === status)?.label || status || '—';
    }

    function getLatestStage(plantingId) {
        const records = monitoringRecords.filter(record =>
            record.planting_id === plantingId &&
            ['submitted', 'reviewed'].includes(record.monitoring_status) &&
            record.growth_stage
        );

        if (!records.length) return null;

        return records.reduce((highest, record) => {
            return getStageOrder(record.growth_stage) >
                getStageOrder(highest)
                ? record.growth_stage
                : highest;
        }, records[0].growth_stage);
    }

    function getStageOptions(plantingId) {
        const latestStage = getLatestStage(plantingId);
        const latestOrder = getStageOrder(latestStage);

        return GROWTH_STAGES
            .filter((stage, index) =>
                latestStage === null || index >= latestOrder
            )
            .map(stage => `
                <option value="${stage.value}">
                    ${stage.label}
                </option>
            `)
            .join('');
    }

    function getCropHistory(plantingId) {
        return monitoringRecords
            .filter(record =>
                record.planting_id === plantingId &&
                ['submitted', 'reviewed'].includes(record.monitoring_status)
            )
            .sort((a, b) =>
                new Date(b.monitoring_date) - new Date(a.monitoring_date)
            );
    }

    function getStatusBadge(status) {
        const labels = {
            submitted: 'Submitted',
            reviewed: 'Reviewed',
            draft: 'Draft'
        };

        return `
            <span class="monitoring-history-status ${escapeHTML(status || '')}">
                ${escapeHTML(labels[status] || status || 'Unknown')}
            </span>
        `;
    }

    function renderHistory(plantingId) {
        const records = getCropHistory(plantingId);
        const isExpanded = expandedHistoryIds.has(plantingId);
        const historyId = `monitoring-history-${plantingId}`;

        return `
            <section class="monitoring-history">
                <button
                    type="button"
                    class="monitoring-history-toggle ${isExpanded ? 'is-expanded' : ''}"
                    data-action="toggle-history"
                    data-planting-id="${escapeHTML(plantingId)}"
                    aria-expanded="${isExpanded}"
                    aria-controls="${escapeHTML(historyId)}"
                >
                    <span class="monitoring-history-toggle-info">
                        <strong>Monitoring History</strong>
                        <span class="monitoring-history-count">
                            ${records.length} record(s)
                        </span>
                    </span>

                    <span class="monitoring-history-chevron" aria-hidden="true">
                        ${isExpanded ? '▲' : '▼'}
                    </span>
                </button>

                <div
                    id="${escapeHTML(historyId)}"
                    class="monitoring-history-content"
                    ${isExpanded ? '' : 'hidden'}
                >
                    ${records.length ? `
                        <div class="monitoring-history-list">
                            ${records.map(record => `
                                <article class="monitoring-history-item">
                                    <div class="monitoring-history-item-header">
                                        <div>
                                            <strong>${escapeHTML(formatDateTime(record.monitoring_date))}</strong>
                                            <span class="monitoring-history-stage">
                                                ${escapeHTML(getStageLabel(record.growth_stage))}
                                            </span>
                                        </div>

                                        ${getStatusBadge(record.monitoring_status)}
                                    </div>

                                    <div class="monitoring-history-details">
                                        <div>
                                            <span>Crop Health</span>
                                            <strong>${escapeHTML(getHealthLabel(record.crop_health_status))}</strong>
                                        </div>

                                        <div>
                                            <span>Pest Observed</span>
                                            <strong>${record.pest_observed ? 'Yes' : 'No'}</strong>
                                        </div>

                                        <div>
                                            <span>Disease Observed</span>
                                            <strong>${record.disease_observed ? 'Yes' : 'No'}</strong>
                                        </div>

                                        <div>
                                            <span>Action Required</span>
                                            <strong>${record.action_required ? 'Yes' : 'No'}</strong>
                                        </div>
                                    </div>

                                    ${record.pest_observed ? `
                                        <div class="monitoring-history-description">
                                            <span>Pest Details</span>
                                            <p>${escapeHTML(record.pest_details || 'No details provided.')}</p>
                                        </div>
                                    ` : ''}

                                    ${record.disease_observed ? `
                                        <div class="monitoring-history-description">
                                            <span>Disease Details</span>
                                            <p>${escapeHTML(record.disease_details || 'No details provided.')}</p>
                                        </div>
                                    ` : ''}

                                    <div class="monitoring-history-description">
                                        <span>Observations</span>
                                        <p>${escapeHTML(record.observations || 'No observations provided.')}</p>
                                    </div>

                                    ${record.action_required ? `
                                        <div class="monitoring-history-description">
                                            <span>Recommended Action</span>
                                            <p>${escapeHTML(record.recommended_action || 'No recommendation provided.')}</p>
                                        </div>
                                    ` : ''}

                                    ${record.evidence_photo_url ? `
                                        <div class="monitoring-history-photo">
                                            <span>Evidence Photo</span>
                                            <a
                                                href="${escapeHTML(record.evidence_photo_url)}"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                            >
                                                <img
                                                    src="${escapeHTML(record.evidence_photo_url)}"
                                                    alt="Crop monitoring evidence"
                                                    loading="lazy"
                                                >
                                            </a>
                                        </div>
                                    ` : ''}
                                </article>
                            `).join('')}
                        </div>
                    ` : `
                        <div class="monitoring-history-empty">
                            <p>No monitoring records yet.</p>
                            <small>Submitted crop monitoring records will appear here.</small>
                        </div>
                    `}
                </div>
            </section>
        `;
    }

    function displayCrops() {
        count.textContent = `${crops.length} planted crop(s)`;

        if (!crops.length) {
            content.innerHTML = `
                <div class="empty-state">
                    <h3>No planted crops found</h3>
                    <p>There are currently no planted crops in your assigned farms.</p>
                </div>
            `;
            return;
        }

        content.innerHTML = `
            <div class="crop-monitoring-grid">
                ${crops.map(crop => {
                    const latestStage = getLatestStage(crop.id);

                    return `
                        <article class="crop-monitoring-card">
                            <div class="crop-card-header">
                                <div>
                                    <h3>${escapeHTML(crop.crop_name || 'Unnamed Crop')}</h3>
                                    <span class="crop-status-badge">
                                        ${escapeHTML(crop.crop_status || 'Planted')}
                                    </span>
                                </div>
                            </div>

                            <div class="crop-card-details">
                                <div>
                                    <span>Farmer</span>
                                    <strong>${escapeHTML(crop.farmer?.full_name || 'Unknown Farmer')}</strong>
                                </div>

                                <div>
                                    <span>Farm</span>
                                    <strong>${escapeHTML(crop.farm?.farm_name || '—')}</strong>
                                </div>

                                <div>
                                    <span>Location</span>
                                    <strong>${escapeHTML(crop.farm?.farm_location || '—')}</strong>
                                </div>

                                <div>
                                    <span>Field</span>
                                    <strong>${escapeHTML(crop.field?.field_name || '—')}</strong>
                                </div>

                                <div>
                                    <span>Sowing Date</span>
                                    <strong>${formatDate(crop.sowing_date)}</strong>
                                </div>

                                <div>
                                    <span>Expected Harvest</span>
                                    <strong>${formatDate(crop.expected_harvest_date)}</strong>
                                </div>

                                <div>
                                    <span>Latest Growth Stage</span>
                                    <strong>${escapeHTML(getStageLabel(latestStage))}</strong>
                                </div>
                            </div>

                            <button
                                type="button"
                                class="monitor-crop-btn"
                                data-action="open-monitoring"
                                data-planting-id="${escapeHTML(crop.id)}"
                            >
                                Add Monitoring Record
                            </button>

                            ${renderHistory(crop.id)}
                        </article>
                    `;
                }).join('')}
            </div>
        `;
    }

    function openModal(plantingId) {
        if (isSaving) return;

        const crop = crops.find(item => item.id === plantingId);

        if (!crop) {
            showAlertModal(
                'Selected crop could not be found.',
                'error'
            );
            return;
        }

        modalForm.reset();
        modalForm.dataset.plantingId = plantingId;

        modalTitle.textContent =
            `${crop.crop_name || 'Unnamed Crop'} · ${crop.farm?.farm_name || 'Farm'}`;

        growthStageSelect.innerHTML = `
            <option value="">Select growth stage</option>
            ${getStageOptions(plantingId)}
        `;

        if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
            previewUrl = null;
        }

        photoPreview.removeAttribute('src');
        photoPreview.hidden = true;

        previousBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        modal.hidden = false;
        modal.classList.add('is-open');

        growthStageSelect.focus();
    }

    function closeModal() {
        if (isSaving) return;

        modal.hidden = true;
        modal.classList.remove('is-open');

        document.body.style.overflow = previousBodyOverflow;

        modalForm.reset();
        delete modalForm.dataset.plantingId;

        if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
            previewUrl = null;
        }

        photoPreview.removeAttribute('src');
        photoPreview.hidden = true;
    }

    async function loadMonitoringRecords(plantingIds) {
        monitoringRecords = [];

        if (!plantingIds.length) return;

        const { data, error } = await supabase
            .from('agricultural_technician_crop_monitoring')
            .select(`
                monitoring_id,
                planting_id,
                farm_id,
                technician_staff_id,
                growth_stage,
                crop_health_status,
                pest_observed,
                pest_details,
                disease_observed,
                disease_details,
                observations,
                action_required,
                recommended_action,
                monitoring_date,
                monitoring_status,
                evidence_photo_path
            `)
            .in('planting_id', plantingIds)
            .in('monitoring_status', ['submitted', 'reviewed'])
            .order('monitoring_date', { ascending: false });

        if (error) throw error;

        monitoringRecords = data || [];

        await Promise.all(
            monitoringRecords.map(async record => {
                if (!record.evidence_photo_path) return;

                const { data: signedData, error: signedError } =
                    await supabase.storage
                        .from(STORAGE_BUCKET)
                        .createSignedUrl(record.evidence_photo_path, 3600);

                if (signedError) {
                    console.error(
                        '[Crop Monitoring] Photo URL error:',
                        signedError
                    );
                    return;
                }

                record.evidence_photo_url = signedData?.signedUrl || null;
            })
        );
    }

    async function loadCrops() {
        content.innerHTML = '<p>Loading planted crops...</p>';

        try {
            const { data: authData, error: authError } =
                await supabase.auth.getUser();

            if (authError) throw authError;

            if (!authData?.user) {
                throw new Error('No authenticated user found.');
            }

            const { data: farms, error: farmError } = await supabase
                .from('farmer_farms')
                .select('id, farm_name, farm_location');

            if (farmError) throw farmError;

            if (!farms?.length) {
                crops = [];
                monitoringRecords = [];
                displayCrops();
                return;
            }

            const farmIds = farms.map(farm => farm.id);

            const { data: fields, error: fieldError } = await supabase
                .from('farm_fields')
                .select('id, farm_id, field_name')
                .in('farm_id', farmIds);

            if (fieldError) throw fieldError;

            if (!fields?.length) {
                crops = [];
                monitoringRecords = [];
                displayCrops();
                return;
            }

            const fieldIds = fields.map(field => field.id);

            const { data: plantings, error: plantingError } =
                await supabase
                    .from('farm_plantings')
                    .select(`
                        id,
                        crop_name,
                        crop_status,
                        sowing_date,
                        expected_harvest_date,
                        farmer_id,
                        field_id,
                        farmer:profiles!farm_plantings_farmer_id_fkey (
                            full_name
                        )
                    `)
                    .in('field_id', fieldIds)
                    .eq('crop_status', 'planted')
                    .not('farmer_id', 'is', null)
                    .order('created_at', { ascending: false });

            if (plantingError) throw plantingError;

            crops = (plantings || []).map(planting => {
                const field = fields.find(item => item.id === planting.field_id);
                const farm = farms.find(item => item.id === field?.farm_id);

                return { ...planting, field, farm };
            }).filter(crop => crop.field && crop.farm);

            displayCrops();

            try {
                await loadMonitoringRecords(crops.map(crop => crop.id));
                displayCrops();
            } catch (monitoringError) {
                console.error(
                    '[Crop Monitoring] Monitoring records error:',
                    monitoringError
                );

                monitoringRecords = [];
                displayCrops();
            }

        } catch (error) {
            console.error('[Crop Monitoring] Loading error:', error);

            content.innerHTML = `
                <div class="error-state">
                    <h3>Unable to load planted crops</h3>
                    <p>${escapeHTML(error.message)}</p>
                </div>
            `;

            count.textContent = 'Unable to load crops';
        }
    }

    async function uploadMonitoringPhoto(file, plantingId) {
        if (!file) return null;

        if (!ALLOWED_PHOTO_TYPES.includes(file.type)) {
            throw new Error('Only JPG, PNG, and WebP images are allowed.');
        }

        if (file.size > MAX_PHOTO_SIZE) {
            throw new Error('Photo must not exceed 3 MB.');
        }

        const extension = file.type === 'image/jpeg'
            ? 'jpg'
            : file.type === 'image/png'
                ? 'png'
                : 'webp';

        const filePath = `${plantingId}/${crypto.randomUUID()}.${extension}`;

        const { error } = await supabase.storage
            .from(STORAGE_BUCKET)
            .upload(filePath, file, {
                cacheControl: '3600',
                upsert: false,
                contentType: file.type
            });

        if (error) throw error;

        return filePath;
    }

    async function saveMonitoring(form) {
        if (isSaving) return;

        const plantingId = form.dataset.plantingId;
        const crop = crops.find(item => item.id === plantingId);

        if (!crop) {
            showAlertModal(
                'Selected crop could not be found.',
                'error'
            );
            return;
        }

        const staffId = ctx.staff?.staff_id;

        if (!staffId) {
            showAlertModal(
                'Unable to identify the Agricultural Technician staff account.',
                'error'
            );
            return;
        }

        const formData = new FormData(form);
        const growthStage = formData.get('growth_stage');
        const latestStage = getLatestStage(plantingId);

        if (!growthStage) {
            showAlertModal(
                'Please select a growth stage.',
                'warning'
            );
            return;
        }

        if (
            latestStage &&
            getStageOrder(growthStage) < getStageOrder(latestStage)
        ) {
            showAlertModal(
                `Growth stage cannot move backward. Latest recorded stage: ${getStageLabel(latestStage)}.`,
                'warning'
            );
            return;
        }

        const photoFile = formData.get('monitoring_photo');

        if (photoFile && photoFile.size > 0) {
            if (!ALLOWED_PHOTO_TYPES.includes(photoFile.type)) {
                showAlertModal(
                    'Only JPG, PNG, and WebP images are allowed.',
                    'warning'
                );
                return;
            }

            if (photoFile.size > MAX_PHOTO_SIZE) {
                showAlertModal(
                    'Photo must not exceed 3 MB.',
                    'warning'
                );
                return;
            }
        }

        const pestObserved = formData.get('pest_observed') === 'true';
        const diseaseObserved = formData.get('disease_observed') === 'true';
        const actionRequired = formData.get('action_required') === 'true';

        const pestDetails = String(formData.get('pest_details') || '').trim();
        const diseaseDetails = String(formData.get('disease_details') || '').trim();
        const recommendedAction = String(formData.get('recommended_action') || '').trim();

        if (pestObserved && !pestDetails) {
            showAlertModal(
                'Please provide the pest details.',
                'warning'
            );
            return;
        }

        if (diseaseObserved && !diseaseDetails) {
            showAlertModal(
                'Please provide the disease details.',
                'warning'
            );
            return;
        }

        if (actionRequired && !recommendedAction) {
            showAlertModal(
                'Please provide the recommended action.',
                'warning'
            );
            return;
        }

        const record = {
            planting_id: crop.id,
            farm_id: crop.farm.id,
            technician_staff_id: staffId,
            growth_stage: growthStage,
            crop_health_status: formData.get('crop_health_status'),
            pest_observed: pestObserved,
            pest_details: pestObserved ? pestDetails : null,
            disease_observed: diseaseObserved,
            disease_details: diseaseObserved ? diseaseDetails : null,
            observations: String(formData.get('observations') || '').trim(),
            action_required: actionRequired,
            recommended_action: actionRequired ? recommendedAction : null,
            monitoring_date: new Date().toISOString(),
            monitoring_status: 'submitted'
        };

        const submitButton = form.querySelector('.save-monitoring-btn');
        const closeButtons = modal.querySelectorAll('[data-action="close-modal"]');

        let uploadedPhotoPath = null;

        isSaving = true;

        submitButton.disabled = true;
        submitButton.textContent = 'Uploading and submitting...';

        closeButtons.forEach(button => {
            button.disabled = true;
        });

        try {
            if (photoFile && photoFile.size > 0) {
                uploadedPhotoPath = await uploadMonitoringPhoto(
                    photoFile,
                    plantingId
                );

                record.evidence_photo_path = uploadedPhotoPath;
            }

            const { error } = await supabase
                .from('agricultural_technician_crop_monitoring')
                .insert(record);

            if (error) throw error;

            await loadMonitoringRecords(crops.map(item => item.id));

            expandedHistoryIds.add(plantingId);

            isSaving = false;
            closeButtons.forEach(button => {
                button.disabled = false;
            });

            closeModal();
            displayCrops();

            showAlertModal(
                'Crop monitoring record submitted successfully.',
                'success'
            );

        } catch (error) {
            console.error('[Crop Monitoring] Save error:', error);

            if (uploadedPhotoPath) {
                const { error: cleanupError } = await supabase.storage
                    .from(STORAGE_BUCKET)
                    .remove([uploadedPhotoPath]);

                if (cleanupError) {
                    console.error(
                        '[Crop Monitoring] Photo cleanup error:',
                        cleanupError
                    );
                }
            }

            showAlertModal(
                `Unable to save monitoring record: ${error.message}`,
                'error'
            );

        } finally {
            isSaving = false;

            submitButton.disabled = false;
            submitButton.textContent = 'Submit Monitoring Record';

            closeButtons.forEach(button => {
                button.disabled = false;
            });
        }
    }

    function handlePhotoPreview(event) {
        const input = event.target;

        if (!input.matches('input[name="monitoring_photo"]')) return;

        if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
            previewUrl = null;
        }

        const file = input.files?.[0];

        if (!file) {
            photoPreview.removeAttribute('src');
            photoPreview.hidden = true;
            return;
        }

        if (!ALLOWED_PHOTO_TYPES.includes(file.type)) {
            input.value = '';
            photoPreview.hidden = true;

            showAlertModal(
                'Only JPG, PNG, and WebP images are allowed.',
                'warning'
            );
            return;
        }

        if (file.size > MAX_PHOTO_SIZE) {
            input.value = '';
            photoPreview.hidden = true;

            showAlertModal(
                'Photo must not exceed 3 MB.',
                'warning'
            );
            return;
        }

        previewUrl = URL.createObjectURL(file);
        photoPreview.src = previewUrl;
        photoPreview.hidden = false;
    }

    function handleContentClick(event) {
        const button = event.target.closest('[data-action]');
        if (!button) return;

        if (button.dataset.action === 'open-monitoring') {
            openModal(button.dataset.plantingId);
            return;
        }

        if (button.dataset.action === 'toggle-history') {
            const plantingId = button.dataset.plantingId;

            if (!plantingId) return;

            if (expandedHistoryIds.has(plantingId)) {
                expandedHistoryIds.delete(plantingId);
            } else {
                expandedHistoryIds.add(plantingId);
            }

            displayCrops();
        }
    }

    function handleModalClick(event) {
        const button = event.target.closest('[data-action]');

        if (!button) return;

        if (button.dataset.action === 'close-modal') {
            closeModal();
        }
    }

    function handleModalSubmit(event) {
        if (event.target !== modalForm) return;

        event.preventDefault();

        if (!modalForm.reportValidity()) return;

        saveMonitoring(modalForm);
    }

    function handleEscape(event) {
        if (event.key !== 'Escape') return;

        if (alertModal) return;

        if (!modal.hidden) {
            closeModal();
        }
    }

    content.addEventListener('click', handleContentClick);
    modal.addEventListener('click', handleModalClick);
    modal.addEventListener('change', handlePhotoPreview);
    modalForm.addEventListener('submit', handleModalSubmit);
    document.addEventListener('keydown', handleEscape);

    await loadCrops();

    cleanupHandler = () => {
        content.removeEventListener('click', handleContentClick);
        modal.removeEventListener('click', handleModalClick);
        modal.removeEventListener('change', handlePhotoPreview);
        modalForm.removeEventListener('submit', handleModalSubmit);
        document.removeEventListener('keydown', handleEscape);

        document.body.style.overflow = previousBodyOverflow;

        if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
            previewUrl = null;
        }

        if (alertModal) {
            alertModal.remove();
            alertModal = null;
        }

        cleanupHandler = null;
    };

    return {
        cleanup() {
            if (cleanupHandler) cleanupHandler();
        }
    };
}
