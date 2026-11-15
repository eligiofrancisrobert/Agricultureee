import { supabase } from '../connection.js';

// =====================================================
// HELPERS
// =====================================================

const h = (tag, className = '', text = '') => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== '') node.textContent = text;
    return node;
};

const formatStatus = value => {
    if (!value) return 'Unknown';
    return String(value)
        .replaceAll('_', ' ')
        .replace(/\b\w/g, char => char.toUpperCase());
};

const formatDate = value => {
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
};

const createBadge = (value, className = '') =>
    h('span', `at-status-badge ${className}`, formatStatus(value));

const createEmptyState = () => {
    const empty = h('div', 'at-empty-state');
    empty.append(
        h('h3', '', 'No Crop Assessments Found'),
        h('p', '', 'There are currently no crop assessment records available.')
    );
    return empty;
};

const createErrorState = () => {
    const error = h('div', 'at-error-state');
    error.textContent = 'Unable to load crop assessments. Please try again.';
    return error;
};

const getFarmerName = profile => {
    if (!profile) return 'Farmer information unavailable';

    const fullName =
        profile.full_name ||
        profile.fullName ||
        profile.name ||
        [
            profile.first_name,
            profile.middle_name,
            profile.last_name
        ].filter(Boolean).join(' ') ||
        [
            profile.firstname,
            profile.lastname
        ].filter(Boolean).join(' ');

    return fullName || profile.email || 'Farmer';
};

const createSection = (title, content) => {
    const section = h('div', 'at-assessment-section');
    section.append(
        h('h4', '', title),
        h('p', '', content || '—')
    );
    return section;
};

// =====================================================
// TOAST NOTIFICATIONS
// =====================================================

function createToastContainer() {
    const container = h('div', 'at-toast-container');
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-atomic', 'true');
    document.body.append(container);

    function show(message, type = 'success') {
        const toast = h('div', `at-toast at-toast-${type}`);

        const icon = h(
            'span',
            'at-toast-icon',
            type === 'success' ? '✓' :
            type === 'error' ? '!' : 'i'
        );

        const text = h('span', 'at-toast-message', message);
        toast.append(icon, text);
        container.append(toast);

        requestAnimationFrame(() => toast.classList.add('show'));

        const timeout = window.setTimeout(() => {
            toast.classList.remove('show');
            window.setTimeout(() => toast.remove(), 250);
        }, 4000);

        return () => {
            window.clearTimeout(timeout);
            toast.remove();
        };
    }

    return {
        show,
        destroy() {
            container.remove();
        }
    };
}

// =====================================================
// ACTION POPUP
// =====================================================

function createActionPopup() {
    const overlay = h('div', 'at-action-popup-overlay');
    overlay.hidden = true;

    const modal = h('section', 'at-action-popup');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'atActionPopupTitle');

    const header = h('div', 'at-action-popup-header');
    const title = h('h3', '', 'Confirm Action');
    title.id = 'atActionPopupTitle';

    const closeButton = h('button', 'at-action-popup-close', '×');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Close popup');
    header.append(title, closeButton);

    const body = h('div', 'at-action-popup-body');
    const message = h('p', 'at-action-popup-message');

    const textareaWrapper = h('div', 'at-action-popup-field');
    const textareaLabel = h('label', '', 'Remarks');
    const textarea = h('textarea', 'at-action-popup-textarea');

    textareaLabel.htmlFor = 'atActionPopupRemarks';
    textarea.id = 'atActionPopupRemarks';
    textarea.rows = 4;
    textareaWrapper.append(textareaLabel, textarea);

    const validation = h('p', 'at-action-popup-validation');
    validation.hidden = true;
    body.append(message, textareaWrapper, validation);

    const footer = h('div', 'at-action-popup-footer');

    const cancelButton = h('button', 'at-popup-cancel-button', 'Cancel');
    cancelButton.type = 'button';

    const confirmButton = h('button', 'at-popup-confirm-button', 'Confirm');
    confirmButton.type = 'button';

    footer.append(cancelButton, confirmButton);
    modal.append(header, body, footer);
    overlay.append(modal);
    document.body.append(overlay);

    let resolver = null;
    let previousFocus = null;
    let required = false;
    let busy = false;
    let originalConfirmText = 'Confirm';

    function finish(result) {
        if (!resolver) return;

        const callback = resolver;
        resolver = null;

        overlay.hidden = true;
        document.body.style.overflow = '';

        textarea.value = '';
        validation.hidden = true;
        busy = false;

        confirmButton.disabled = false;
        cancelButton.disabled = false;
        closeButton.disabled = false;

        if (previousFocus?.isConnected) previousFocus.focus();

        callback(result);
    }

    function close() {
        if (busy) return;
        finish(null);
    }

    function open(options = {}) {
        if (resolver) finish(null);

        previousFocus = document.activeElement;

        title.textContent = options.title || 'Confirm Action';
        message.textContent = options.message || '';

        originalConfirmText = options.confirmText || 'Confirm';
        confirmButton.textContent = originalConfirmText;
        confirmButton.className =
            `at-popup-confirm-button ${options.confirmClass || ''}`;

        required = options.required === true;

        textareaWrapper.hidden = !options.showTextarea;
        textareaLabel.textContent = options.textareaLabel || 'Remarks';
        textarea.placeholder = options.placeholder || 'Enter your remarks...';
        textarea.value = options.defaultValue || '';

        validation.textContent = '';
        validation.hidden = true;
        cancelButton.hidden = options.hideCancel === true;

        overlay.hidden = false;
        document.body.style.overflow = 'hidden';

        return new Promise(resolve => {
            resolver = resolve;

            window.setTimeout(() => {
                if (options.showTextarea) textarea.focus();
                else confirmButton.focus();
            }, 50);
        });
    }

    confirmButton.addEventListener('click', () => {
        if (busy) return;

        const notes = textarea.value.trim();

        if (required && !notes) {
            validation.textContent = 'Please provide the required feedback.';
            validation.hidden = false;
            textarea.focus();
            return;
        }

        finish({ confirmed: true, notes });
    });

    cancelButton.addEventListener('click', close);
    closeButton.addEventListener('click', close);

    overlay.addEventListener('click', event => {
        if (event.target === overlay) close();
    });

    const handleEscape = event => {
        if (event.key === 'Escape' && !overlay.hidden) {
            event.preventDefault();
            close();
        }
    };

    document.addEventListener('keydown', handleEscape);

    return {
        open,

        setBusy(value) {
            busy = value;
            confirmButton.disabled = value;
            cancelButton.disabled = value;
            closeButton.disabled = value;
            confirmButton.textContent = value
                ? 'Processing...'
                : originalConfirmText;
        },

        close,

        destroy() {
            if (resolver) finish(null);
            document.removeEventListener('keydown', handleEscape);
            overlay.remove();
        }
    };
}

// =====================================================
// COMPLETION REVIEW MODAL
// =====================================================

function createReviewModal() {
    const overlay = h('div', 'at-review-modal-overlay');
    overlay.setAttribute('role', 'presentation');
    overlay.hidden = true;

    const modal = h('section', 'at-review-modal');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'atReviewModalTitle');

    const header = h('div', 'at-review-modal-header');
    const title = h('h3', '', 'Farmer Completion Submission');
    title.id = 'atReviewModalTitle';

    const closeButton = h('button', 'at-review-modal-close', '×');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Close review modal');
    header.append(title, closeButton);

    const body = h('div', 'at-review-modal-body');
    const footer = h('div', 'at-review-modal-footer');

    modal.append(header, body, footer);
    overlay.append(modal);
    document.body.append(overlay);

    let previousFocus = null;

    function close() {
        overlay.hidden = true;
        body.replaceChildren();
        footer.replaceChildren();
        document.body.style.overflow = '';

        if (previousFocus?.isConnected) previousFocus.focus();
    }

    function addInfo(label, value) {
        const item = h('div', 'at-review-info-item');
        item.append(
            h('small', '', label),
            h('strong', '', value || '—')
        );
        body.append(item);
    }

    function open(record, onReview) {
        previousFocus = document.activeElement;
        body.replaceChildren();
        footer.replaceChildren();

        addInfo('Farmer', record.farmer_name);
        addInfo('Farm', record.farm_name);
        addInfo('Crop', record.crop_name);
        addInfo('Field', record.field_name);
        addInfo('Submitted', formatDate(record.submitted_at));

        const status = h('div', 'at-review-status-row');
        status.append(
            h('span', '', 'Submission Status'),
            createBadge(
                record.submission_status,
                `completion-${record.submission_status}`
            )
        );
        body.append(status);

        body.append(
            createSection(
                'Farmer Completion Notes',
                record.completion_notes || 'No completion notes provided.'
            )
        );

        const evidence = h('div', 'at-review-evidence');
        evidence.append(h('h4', '', 'Evidence Photo'));

        if (record.evidence_url) {
            const link = h('a', 'at-review-evidence-link');
            link.href = record.evidence_url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';

            const image = h('img', 'at-review-evidence-image');
            image.src = record.evidence_url;
            image.alt = 'Farmer completion evidence';
            image.loading = 'lazy';

            link.append(image);
            evidence.append(link);
        } else {
            evidence.append(
                h(
                    'p',
                    '',
                    record.evidence_photo_path
                        ? 'Evidence photo could not be loaded.'
                        : 'No evidence photo attached.'
                )
            );
        }

        body.append(evidence);

        if (record.review_notes) {
            body.append(
                createSection('Previous Review Feedback', record.review_notes)
            );
        }

        if (record.reviewed_at) {
            addInfo('Last Reviewed', formatDate(record.reviewed_at));
        }

        if (record.submission_status === 'submitted') {
            const verifyButton = h(
                'button',
                'at-completion-verify-button',
                'Verify Completion'
            );
            verifyButton.type = 'button';
            verifyButton.addEventListener('click', () => {
                onReview(record, 'verified', verifyButton);
            });

            const revisionButton = h(
                'button',
                'at-completion-revision-button',
                'Request Revision'
            );
            revisionButton.type = 'button';
            revisionButton.addEventListener('click', () => {
                onReview(record, 'needs_revision', revisionButton);
            });

            footer.append(verifyButton, revisionButton);
        } else {
            footer.append(
                h(
                    'p',
                    'at-review-completed-label',
                    record.submission_status === 'verified'
                        ? 'This submission has been verified.'
                        : 'A revision has been requested for this submission.'
                )
            );
        }

        overlay.hidden = false;
        document.body.style.overflow = 'hidden';
        closeButton.focus();
    }

    closeButton.addEventListener('click', close);

    overlay.addEventListener('click', event => {
        if (event.target === overlay) close();
    });

    const handleEscape = event => {
        if (event.key === 'Escape' && !overlay.hidden) close();
    };

    document.addEventListener('keydown', handleEscape);

    return {
        open,
        close,

        destroy() {
            close();
            document.removeEventListener('keydown', handleEscape);
            overlay.remove();
        }
    };
}

// =====================================================
// CROP ASSESSMENT CARD
// =====================================================

function createAssessmentCard(record, openReviewModal) {
    const card = h('article', 'at-assessment-card');
    const header = h('div', 'at-assessment-card-header');

    header.append(
        h('h3', 'at-assessment-title', record.farm?.farm_name || 'Unknown Farm'),
        createBadge(record.crop_health_status)
    );

    const date = h(
        'p',
        'at-assessment-date',
        `Assessment Date: ${formatDate(record.monitoring_date)}`
    );

    const details = h('div', 'at-assessment-details');

    const fields = [
        ['Growth Stage', formatStatus(record.growth_stage)],
        ['Monitoring Status', formatStatus(record.monitoring_status)],
        ['Pest Observed', record.pest_observed ? 'Yes' : 'No'],
        ['Disease Observed', record.disease_observed ? 'Yes' : 'No'],
        ['Action Required', record.action_required ? 'Yes' : 'No']
    ];

    fields.forEach(([label, value]) => {
        const item = h('div', 'at-assessment-detail');
        item.append(
            h('small', '', label),
            h('strong', '', value || '—')
        );
        details.append(item);
    });

    const observations = createSection(
        'Observations',
        record.observations || 'No observations recorded.'
    );

    const pestSection = createSection(
        'Pest Details',
        record.pest_observed
            ? record.pest_details || 'Pests observed, but no details provided.'
            : 'No pests observed.'
    );

    const diseaseSection = createSection(
        'Disease Details',
        record.disease_observed
            ? record.disease_details || 'Disease observed, but no details provided.'
            : 'No disease observed.'
    );

    const recommendation = h('div', 'at-assessment-recommendation');
    recommendation.append(
        h('h4', '', 'Recommended Action'),
        h('p', '', record.recommended_action || 'No recommended action provided.')
    );

    const actionBadge = h(
        'div',
        `at-assessment-action ${record.action_required ? 'is-required' : 'is-clear'}`,
        record.action_required
            ? 'Follow-up Action Required'
            : 'No Follow-up Action Required'
    );

    card.append(
        header,
        date,
        details,
        observations,
        pestSection,
        diseaseSection,
        recommendation,
        actionBadge
    );

    const completions = record.completions || [];

    if (completions.length > 0) {
        const submissionPanel = h('div', 'at-assessment-submission-panel');

        const pendingCount = completions.filter(
            item => item.submission_status === 'submitted'
        ).length;

        const submissionHeader = h(
            'div',
            'at-assessment-submission-header'
        );

        submissionHeader.append(
            h('strong', '', 'Farmer Submissions'),
            createBadge(
                pendingCount > 0 ? 'Pending Review' : 'Reviewed',
                pendingCount > 0
                    ? 'completion-submitted'
                    : 'completion-reviewed'
            )
        );

        const submissionInfo = h(
            'p',
            'at-assessment-submission-info',
            `${completions.length} submission${completions.length === 1 ? '' : 's'} received`
        );

        const submissionList = h('div', 'at-assessment-submission-list');

        completions.forEach(completion => {
            const row = h('div', 'at-assessment-submission-row');
            const info = h('div', 'at-assessment-submission-row-info');

            info.append(
                h('strong', '', completion.farmer_name || 'Farmer'),
                h('small', '', formatDate(completion.submitted_at))
            );

            const viewButton = h(
                'button',
                'at-view-submission-button',
                'View Submission'
            );
            viewButton.type = 'button';
            viewButton.addEventListener('click', () => {
                openReviewModal(completion);
            });

            row.append(
                info,
                createBadge(
                    completion.submission_status,
                    `completion-${completion.submission_status}`
                ),
                viewButton
            );

            submissionList.append(row);
        });

        submissionPanel.append(
            submissionHeader,
            submissionInfo,
            submissionList
        );

        card.append(submissionPanel);
    }

    return card;
}

// =====================================================
// MAIN RENDER
// =====================================================

export async function render(root, ctx) {
    root.replaceChildren();

    const page = h('section', 'at-page');
    const heading = h('div', 'at-page-heading');

    heading.append(
        h('h2', '', 'Crop Assessments'),
        h(
            'p',
            '',
            'Review crop health assessments, growth conditions, pest observations, disease findings, and Farmer completion submissions from your assigned farms.'
        )
    );

    const summaryGrid = h('div', 'at-assessment-summary-grid');

    const totalValue = h('strong', '', '0');
    const healthyValue = h('strong', '', '0');
    const actionValue = h('strong', '', '0');
    const pendingValue = h('strong', '', '0');

    const summaryCard = (label, value, className) => {
        const card = h('div', `at-assessment-summary-card ${className}`);
        card.append(value, h('span', '', label));
        return card;
    };

    summaryGrid.append(
        summaryCard('Total Assessments', totalValue, 'total'),
        summaryCard('Healthy Crops', healthyValue, 'healthy'),
        summaryCard('Action Required', actionValue, 'action'),
        summaryCard('Pending Reviews', pendingValue, 'pending')
    );

    const toolbar = h('div', 'at-assessment-toolbar');

    const search = h('input', 'at-search-input');
    search.type = 'search';
    search.placeholder = 'Search farm, observations, or recommendations...';
    search.setAttribute('aria-label', 'Search crop assessments');

    const createFilter = (label, options) => {
        const select = h('select', 'at-filter-select');
        select.setAttribute('aria-label', label);

        options.forEach(([value, text]) => {
            const option = h('option', '', text);
            option.value = value;
            select.append(option);
        });

        return select;
    };

    const healthFilter = createFilter('Filter crop health', [
        ['all', 'All Health Conditions'],
        ['healthy', 'Healthy'],
        ['good', 'Good'],
        ['fair', 'Fair'],
        ['poor', 'Poor'],
        ['critical', 'Critical']
    ]);

    const actionFilter = createFilter('Filter action required', [
        ['all', 'All Actions'],
        ['yes', 'Action Required'],
        ['no', 'No Action Required']
    ]);

    const reviewFilter = createFilter('Filter completion submissions', [
        ['all', 'All Assessments'],
        ['pending', 'With Pending Submissions'],
        ['reviewed', 'With Reviewed Submissions'],
        ['none', 'No Farmer Submissions']
    ]);

    toolbar.append(search, healthFilter, actionFilter, reviewFilter);

    const grid = h('div', 'at-assessments-grid');
    grid.setAttribute('aria-live', 'polite');
    grid.append(h('p', 'at-loading-text', 'Loading crop assessments...'));

    page.append(heading, summaryGrid, toolbar, grid);
    root.append(page);

    const reviewModal = createReviewModal();
    const actionPopup = createActionPopup();
    const toast = createToastContainer();

    let cancelled = false;
    let assessments = [];
    const reviewingIds = new Set();

    // Realtime state
    let realtimeChannel = null;
    let realtimeRefreshTimer = null;
    let realtimeRefreshInProgress = false;
    let realtimeRefreshPending = false;

    // =================================================
    // SUMMARY
    // =================================================

    function updateSummary(data) {
        totalValue.textContent = String(data.length);

        healthyValue.textContent = String(
            data.filter(record =>
                ['healthy', 'good'].includes(
                    String(record.crop_health_status || '').toLowerCase()
                )
            ).length
        );

        actionValue.textContent = String(
            data.filter(record => record.action_required === true).length
        );

        pendingValue.textContent = String(
            data.reduce((total, record) => {
                return total + (record.completions || []).filter(
                    completion => completion.submission_status === 'submitted'
                ).length;
            }, 0)
        );
    }

    // =================================================
    // DISPLAY
    // =================================================

    function displayAssessments() {
        if (cancelled) return;

        const keyword = search.value.trim().toLowerCase();
        const selectedHealth = healthFilter.value;
        const selectedAction = actionFilter.value;
        const selectedReview = reviewFilter.value;

        const filtered = assessments.filter(record => {
            const searchableValues = [
                record.farm?.farm_name,
                record.farm?.farm_location,
                record.growth_stage,
                record.crop_health_status,
                record.observations,
                record.pest_details,
                record.disease_details,
                record.recommended_action,
                ...(record.completions || []).flatMap(completion => [
                    completion.farmer_name,
                    completion.completion_notes,
                    completion.review_notes,
                    completion.submission_status
                ])
            ];

            const matchesSearch = searchableValues.some(value =>
                String(value || '').toLowerCase().includes(keyword)
            );

            const matchesHealth =
                selectedHealth === 'all' ||
                String(record.crop_health_status || '').toLowerCase() === selectedHealth;

            const matchesAction =
                selectedAction === 'all' ||
                (selectedAction === 'yes' && record.action_required === true) ||
                (selectedAction === 'no' && record.action_required === false);

            const completions = record.completions || [];

            const matchesReview =
                selectedReview === 'all' ||
                (
                    selectedReview === 'pending' &&
                    completions.some(item => item.submission_status === 'submitted')
                ) ||
                (
                    selectedReview === 'reviewed' &&
                    completions.some(item =>
                        ['verified', 'needs_revision'].includes(item.submission_status)
                    )
                ) ||
                (
                    selectedReview === 'none' &&
                    completions.length === 0
                );

            return matchesSearch && matchesHealth && matchesAction && matchesReview;
        });

        grid.replaceChildren();

        if (filtered.length === 0) {
            grid.append(createEmptyState());
            return;
        }

        filtered.forEach(record => {
            grid.append(
                createAssessmentCard(
                    record,
                    completion => reviewModal.open(completion, reviewCompletion)
                )
            );
        });
    }

    // =================================================
    // REVIEW FARMER SUBMISSION
    // =================================================

    async function reviewCompletion(record, decision, button) {
        if (cancelled || reviewingIds.has(record.completion_id)) return;
        if (!['verified', 'needs_revision'].includes(decision)) return;

        if (record.submission_status !== 'submitted') {
            await actionPopup.open({
                title: 'Already Reviewed',
                message: 'This submission has already been reviewed. Refresh the assessment list to see its latest status.',
                confirmText: 'Okay',
                hideCancel: true
            });
            return;
        }

        const isRevision = decision === 'needs_revision';

        const popupResult = await actionPopup.open({
            title: isRevision ? 'Request Revision' : 'Verify Completion',
            message: isRevision
                ? 'Provide clear instructions explaining what the Farmer needs to correct or submit again.'
                : 'Are you sure you want to verify this Farmer completion submission?',
            confirmText: isRevision ? 'Send Revision Request' : 'Verify Completion',
            confirmClass: isRevision ? 'revision' : 'success',
            showTextarea: true,
            required: isRevision,
            textareaLabel: isRevision
                ? 'Revision Instructions (Required)'
                : 'Verification Remarks (Optional)',
            placeholder: isRevision
                ? 'Explain what needs to be corrected...'
                : 'Add optional verification remarks...'
        });

        if (!popupResult?.confirmed || cancelled) return;

        const reviewNotes = popupResult.notes || null;

        reviewingIds.add(record.completion_id);

        const originalText = button.textContent;
        button.disabled = true;
        button.textContent = 'Processing...';

        try {
            const now = new Date().toISOString();

            const { data, error } = await supabase
                .from('crop_recommendation_completions')
                .update({
                    submission_status: decision,
                    review_notes: reviewNotes,
                    reviewed_by_staff_id: ctx.staff.staff_id,
                    reviewed_at: now,
                    updated_at: now
                })
                .eq('completion_id', record.completion_id)
                .eq('submission_status', 'submitted')
                .select('completion_id');

            if (error) throw error;

            if (!data || data.length === 0) {
                throw new Error(
                    'The submission was not updated. It may already have been reviewed or you may not have permission.'
                );
            }

            reviewModal.close();
            await loadAssessments();

            if (cancelled) return;

            toast.show(
                decision === 'verified'
                    ? 'Farmer completion successfully verified.'
                    : 'Revision request successfully sent.',
                'success'
            );

        } catch (error) {
            console.error('Failed to review Farmer submission:', error);

            button.disabled = false;
            button.textContent = originalText;

            toast.show(
                error.message || 'Unable to process this review. Please try again.',
                'error'
            );

        } finally {
            reviewingIds.delete(record.completion_id);
        }
    }

    // =================================================
    // LOAD ASSESSMENTS AND SUBMISSIONS
    // =================================================

    async function loadAssessments({ silent = false } = {}) {
        if (cancelled) return;

        // Keep existing content visible during automatic realtime refresh.
        if (!silent) {
            grid.replaceChildren(
                h('p', 'at-loading-text', 'Loading crop assessments...')
            );
        }

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
                evidence_photo_path,
                created_at,
                updated_at,
                farm:farmer_farms (
                    farm_name,
                    farm_location
                )
            `)
            .eq('technician_staff_id', ctx.staff.staff_id)
            .order('monitoring_date', { ascending: false });

        if (cancelled) return;

        if (error) {
            console.error('Failed to load crop assessments:', error);

            if (!silent) grid.replaceChildren(createErrorState());
            else toast.show('Unable to refresh crop assessments.', 'error');

            return;
        }

        const loadedAssessments = data || [];
        const monitoringIds = loadedAssessments.map(
            record => record.monitoring_id
        );

        if (monitoringIds.length > 0) {
            const { data: completionData, error: completionError } =
                await supabase
                    .from('crop_recommendation_completions')
                    .select(`
                        completion_id,
                        monitoring_id,
                        farmer_id,
                        completion_notes,
                        evidence_photo_path,
                        submission_status,
                        review_notes,
                        reviewed_by_staff_id,
                        submitted_at,
                        reviewed_at,
                        created_at
                    `)
                    .in('monitoring_id', monitoringIds)
                    .order('submitted_at', { ascending: false });

            if (cancelled) return;

            if (completionError) {
                console.error(
                    'Failed to load Farmer completion submissions:',
                    completionError
                );

                if (!silent) grid.replaceChildren(createErrorState());
                else toast.show('Unable to refresh Farmer submissions.', 'error');

                return;
            }

            const completions = completionData || [];

            const farmerIds = [
                ...new Set(completions.map(item => item.farmer_id))
            ];

            let profilesById = new Map();

            if (farmerIds.length > 0) {
                const { data: profiles, error: profilesError } =
                    await supabase
                        .from('profiles')
                        .select('*')
                        .in('id', farmerIds);

                if (cancelled) return;

                if (profilesError) {
                    console.error(
                        'Failed to load Farmer profiles:',
                        profilesError
                    );
                } else {
                    profilesById = new Map(
                        (profiles || []).map(profile => [
                            profile.id,
                            getFarmerName(profile)
                        ])
                    );
                }
            }

            for (const completion of completions) {
                if (cancelled) return;

                completion.farmer_name =
                    profilesById.get(completion.farmer_id) || 'Farmer';

                const monitoring = loadedAssessments.find(
                    item => item.monitoring_id === completion.monitoring_id
                );

                completion.farm_name =
                    monitoring?.farm?.farm_name || 'Unknown Farm';

                completion.crop_name = 'Crop information unavailable';
                completion.field_name = 'Field information unavailable';
                completion.evidence_url = null;

                if (monitoring?.planting_id) {
                    const { data: plantingData, error: plantingError } =
                        await supabase
                            .from('farm_plantings')
                            .select(`
                                crop_name,
                                field:farm_fields (
                                    field_name
                                )
                            `)
                            .eq('id', monitoring.planting_id)
                            .maybeSingle();

                    if (plantingError) {
                        console.error(
                            'Failed to load planting details:',
                            plantingError
                        );
                    }

                    if (plantingData) {
                        completion.crop_name =
                            plantingData.crop_name || 'Unknown Crop';

                        completion.field_name =
                            plantingData.field?.field_name || 'Unknown Field';
                    }
                }

                if (completion.evidence_photo_path) {
                    const { data: signedData, error: signedError } =
                        await supabase.storage
                            .from('farm-action-evidence')
                            .createSignedUrl(
                                completion.evidence_photo_path,
                                3600
                            );

                    if (signedError) {
                        console.error(
                            'Unable to access evidence photo:',
                            signedError
                        );
                    } else {
                        completion.evidence_url =
                            signedData?.signedUrl || null;
                    }
                }
            }

            if (cancelled) return;

            const completionMap = new Map();

            completions.forEach(completion => {
                if (!completionMap.has(completion.monitoring_id)) {
                    completionMap.set(completion.monitoring_id, []);
                }

                completionMap.get(completion.monitoring_id).push(completion);
            });

            loadedAssessments.forEach(record => {
                record.completions =
                    completionMap.get(record.monitoring_id) || [];
            });

        } else {
            loadedAssessments.forEach(record => {
                record.completions = [];
            });
        }

        if (cancelled) return;

        assessments = loadedAssessments;
        updateSummary(assessments);
        displayAssessments();
    }

    // =================================================
    // REALTIME
    // =================================================

    function scheduleRealtimeRefresh() {
        if (cancelled) return;

        window.clearTimeout(realtimeRefreshTimer);

        realtimeRefreshTimer = window.setTimeout(async () => {
            if (cancelled) return;

            if (realtimeRefreshInProgress) {
                realtimeRefreshPending = true;
                return;
            }

            realtimeRefreshInProgress = true;

            try {
                await loadAssessments({ silent: true });
            } catch (error) {
                console.error('Realtime Crop Assessment refresh failed:', error);
            } finally {
                realtimeRefreshInProgress = false;

                if (realtimeRefreshPending && !cancelled) {
                    realtimeRefreshPending = false;
                    scheduleRealtimeRefresh();
                }
            }
        }, 400);
    }

    function subscribeToAssessmentRealtime() {
        if (cancelled || realtimeChannel) return;

        const staffId = ctx.staff.staff_id;

        realtimeChannel = supabase
            .channel(`at-crop-assessments-${staffId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'agricultural_technician_crop_monitoring',
                    filter: `technician_staff_id=eq.${staffId}`
                },
                payload => {
                    console.log(
                        'Assigned crop monitoring changed:',
                        payload.eventType
                    );

                    scheduleRealtimeRefresh();
                }
            )
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'crop_recommendation_completions'
                },
                payload => {
                    console.log(
                        'Farmer completion submission changed:',
                        payload.eventType
                    );

                    scheduleRealtimeRefresh();
                }
            )
            .subscribe(status => {
                console.log('AT Crop Assessment realtime:', status);
            });
    }

    async function cleanupRealtime() {
        window.clearTimeout(realtimeRefreshTimer);

        if (realtimeChannel) {
            const channel = realtimeChannel;
            realtimeChannel = null;
            await supabase.removeChannel(channel);
        }
    }

    // =================================================
    // EVENTS
    // =================================================

    search.addEventListener('input', displayAssessments);
    healthFilter.addEventListener('change', displayAssessments);
    actionFilter.addEventListener('change', displayAssessments);
    reviewFilter.addEventListener('change', displayAssessments);

    // =================================================
    // INITIAL LOAD
    // =================================================

    await loadAssessments();

    if (!cancelled) {
        subscribeToAssessmentRealtime();
    }

    return {
        cleanup() {
            cancelled = true;

            search.removeEventListener('input', displayAssessments);
            healthFilter.removeEventListener('change', displayAssessments);
            actionFilter.removeEventListener('change', displayAssessments);
            reviewFilter.removeEventListener('change', displayAssessments);

            cleanupRealtime();

            reviewModal.destroy();
            actionPopup.destroy();
            toast.destroy();
        }
    };
}