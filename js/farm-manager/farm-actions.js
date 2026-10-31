import { supabase } from '../connection.js';
import { h, toast } from '../admin/ui.js';

const STATUS_FILTERS = [
    'all',
    'pending',
    'accepted',
    'in_progress',
    'submitted',
    'revision_requested',
    'verified',
    'declined',
    'cancelled'
];

const STATUS_LABELS = {
    pending: 'Pending',
    accepted: 'Accepted',
    in_progress: 'In Progress',
    submitted: 'Submitted',
    revision_requested: 'Revision Requested',
    verified: 'Verified',
    declined: 'Declined',
    cancelled: 'Cancelled'
};

// Static, trusted SVG markup (no user data), drawn in currentColor
// so icons follow the light/dark theme.
const ICONS = {
    list: '<path d="M9 4h6v3H9z"/><path d="M9 5.5H7a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.5a2 2 0 0 0-2-2h-2"/><path d="M9 12h6M9 16h4"/>',
    activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="m21 16-5-5-8 9"/>'
};

let actions = [];
let activeFilter = 'all';
let viewRoot = null;
let farmActionsChannel = null;
let farmActionsReloadTimer = null;
let submissionsByAction = new Map();
let farmActionsPollingTimer = null;

function icon(name, className) {
    const span = h('span', {
        class: className,
        'aria-hidden': 'true'
    });

    span.innerHTML =
        `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" ` +
        `stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ` +
        `stroke-linejoin="round">${ICONS[name] ?? ''}</svg>`;

    return span;
}

// Safe CSS class suffix from a status code.
function statusKey(status) {
    return (
        String(status ?? '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, '-') || 'unknown'
    );
}

function statusClass(status) {
    const key = statusKey(status);
    return `fa-status fa-status-${key}`;
}

// "land_preparation" -> "Land Preparation"
function humanize(value) {
    return String(value ?? '')
        .replace(/[_-]+/g, ' ')
        .trim()
        .replace(/\b\w/g, character => character.toUpperCase());
}

function statusLabel(status) {
    return STATUS_LABELS[status] || humanize(status) || '—';
}

function dateLabel(value) {
    if (!value) return 'No deadline';

    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);

    if (Number.isNaN(date.getTime())) return String(value);

    return date.toLocaleDateString('en-PH', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function dateTimeLabel(value) {
    if (!value) return '—';

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return String(value);

    return date.toLocaleString('en-PH', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
}

function errorMessage(error) {
    if (
        error?.code === '42501' ||
        /row-level security|not authorized|permission denied/i.test(
            error?.message ?? ''
        )
    ) {
        return 'Access denied by database security. Check the RLS policies for this operation.';
    }

    return error?.message ||
        'Something went wrong. Please try again.';
}

function countByStatus(status) {
    return actions.filter(action => action.status === status).length;
}

function statCard(label, value, iconName, tone) {
    return h('article', { class: `fa-stat-card fa-tone-${tone}` },
        h('div', { class: 'fa-stat-info' },
            h('span', { class: 'fa-stat-label' }, label),
            h('strong', { class: 'fa-stat-value' }, String(value))
        ),
        icon(iconName, 'fa-stat-icon')
    );
}

function createStats() {
    return h('div', { class: 'fa-stats' },
        statCard('Total Actions', actions.length, 'list', 'primary'),
        statCard('Pending', countByStatus('pending'), 'clock', 'warning'),
        statCard('In Progress', countByStatus('in_progress'), 'activity', 'info'),
        statCard('For Review', countByStatus('submitted'), 'clock', 'warning'),
        statCard('Verified', countByStatus('verified'), 'check', 'success')
    );
}

function createHeader(onCreate) {
    const heading = h('div', { class: 'fa-heading' },
        h('div', {},
            h('h2', {}, 'Farm Actions'),
            h('p', {}, 'Assign, monitor, and review activities across your assigned farms.')
        )
    );

    const button = h('button', {
        type: 'button',
        class: 'fa-create-btn',
        onclick: onCreate
    }, '+ Create Action Request');

    return h('div', { class: 'fa-page-header' }, heading, button);
}

function createFilters(onRender) {
    const container = h('div', {
        class: 'fa-filters',
        role: 'group',
        'aria-label': 'Filter by status'
    });

    STATUS_FILTERS.forEach(status => {
        const label = status === 'all'
            ? 'All'
            : statusLabel(status);

        const total = status === 'all'
            ? actions.length
            : countByStatus(status);

        const button = h('button', {
            type: 'button',
            class: `fa-filter ${activeFilter === status ? 'active' : ''}`,
            'aria-pressed': String(activeFilter === status),
            onclick: () => {
                activeFilter = status;
                onRender();
            }
        },
            label,
            h('span', { class: 'fa-filter-count' }, String(total))
        );

        container.append(button);
    });

    return container;
}

function getFilteredActions() {
    return activeFilter === 'all'
        ? actions
        : actions.filter(action => action.status === activeFilter);
}

function createActionList(filtered, onRefresh) {
    if (!filtered.length) {
        const filtering = activeFilter !== 'all';

        return h('div', { class: 'fa-empty' },
            icon('list', 'fa-empty-icon'),
            h('h3', {}, 'No action requests found'),
            h('p', {},
                filtering
                    ? `No action requests with the status "${statusLabel(activeFilter)}".`
                    : 'Action requests assigned to your farmers will appear here.'
            )
        );
    }

    const list = h('div', { class: 'fa-action-list' });

    filtered.forEach(action => {
        const who = [action.farmer_name || 'Farmer', action.farm_name]
            .filter(Boolean)
            .join(' · ');

        const card = h('article', { class: 'fa-action-card' },
            h('div', { class: 'fa-action-top' },
                h('h3', {}, action.action_title || 'Untitled action'),
                h('span', { class: statusClass(action.status) },
                    statusLabel(action.status)
                )
            ),
            h('p', { class: 'fa-action-farmer' }, who),
            h('p', { class: 'fa-action-description' },
                action.description || 'No additional instructions.'
            ),
            h('div', { class: 'fa-action-meta' },
                h('span', {}, `Category: ${humanize(action.action_category) || '—'}`),
                h('span', {}, `Due: ${dateLabel(action.due_date)}`)
            ),

            ...(action.status === 'submitted'
                ? [
                    h('div', { class: 'fa-action-review' },
                        h('span', { class: 'fa-review-indicator' },
                            'Farmer submission received'
                        ),
                        h('button', {
                            type: 'button',
                            class: 'fa-review-btn',
                            onclick: () => openSubmissionReview(
                                action,
                                submissionsByAction.get(action.action_id),
                                onRefresh
                            )
                        }, 'View Submission & Review')
                    )
                ]
                : [])
        );

        list.append(card);
    });

    return list;
}

function renderPage(onCreate) {
    if (!viewRoot) return;

    const filtered = getFilteredActions();

    const countText = activeFilter === 'all'
        ? `${actions.length} total`
        : `${filtered.length} of ${actions.length}`;

    viewRoot.replaceChildren(
        createHeader(onCreate),
        createStats(),
        h('section', { class: 'fa-section' },
            h('div', { class: 'fa-section-header' },
                h('h3', {}, 'Action Requests'),
                h('span', { class: 'fa-result-count' }, countText)
            ),
            createFilters(() => renderPage(onCreate)),
            createActionList(filtered, async () => {
                await loadActions();

                if (viewRoot) {
                    renderPage(onCreate);
                }
            })
        )
    );
}


async function openCreateActionModal(onCreated) {
    let farmers = [];
    let farms = [];
    let managerUserId = null;

    try {
        const {
            data: { user },
            error: authError
        } = await supabase.auth.getUser();

        if (authError) throw authError;
        if (!user) throw new Error('No authenticated user found.');

        managerUserId = user.id;

        // Get the Farm Manager's staff record.
        const { data: staff, error: staffError } = await supabase
            .from('staff_accounts')
            .select('staff_id')
            .eq('user_id', user.id)
            .maybeSingle();

        if (staffError) throw staffError;
        if (!staff) throw new Error('Farm Manager account not found.');

        // Get assigned municipality.
        const { data: manager, error: managerError } = await supabase
            .from('farm_manager_details')
            .select('assigned_farm_location')
            .eq('staff_id', staff.staff_id)
            .maybeSingle();

        if (managerError) throw managerError;

        const assignedLocation =
            manager?.assigned_farm_location?.trim();

        if (!assignedLocation) {
            throw new Error('No municipality assigned to your account.');
        }

        // Load farmers, including tenants and farm workers.
        const { data: farmerData, error: farmerError } =
            await supabase.rpc('manager_list_residential_farmers');

        if (farmerError) throw farmerError;

        // Deduplicate using the actual profile ID.
        const uniqueFarmers = new Map();

        for (const farmer of farmerData ?? []) {
            if (!farmer.farmer_id) continue;

            if (!uniqueFarmers.has(farmer.farmer_id)) {
                uniqueFarmers.set(farmer.farmer_id, {
                    ...farmer,
                    full_name: farmer.full_name || 'Unnamed farmer',
                    email: farmer.email || ''
                });
            }
        }

        farmers = [...uniqueFarmers.values()];

        // Load farms independently of the selected farmer.
        const { data: farmData, error: farmError } = await supabase
            .from('farmer_farms')
            .select('id, farmer_id, farm_name, farm_location')
            .order('farm_name');

        if (farmError) throw farmError;

        function normalizeLocation(value) {
            return String(value ?? '')
                .trim()
                .replace(/\s+/g, ' ')
                .toLowerCase();
        }

        function isInAssignedMunicipality(location) {
            const assignedParts = normalizeLocation(assignedLocation)
                .split(',')
                .map(part => part.trim())
                .filter(Boolean);

            const locationParts = normalizeLocation(location)
                .split(',')
                .map(part => part.trim())
                .filter(Boolean);

            if (!assignedParts.length || !locationParts.length) {
                return false;
            }

            const municipality = assignedParts[0];
            const province = assignedParts[1] ?? '';

            const municipalityMatches =
                locationParts[0] === municipality ||
                locationParts.includes(municipality);

            const provinceMatches =
                !province || locationParts.includes(province);

            return municipalityMatches && provinceMatches;
        }

        farms = (farmData ?? []).filter(farm =>
            isInAssignedMunicipality(farm.farm_location)
        );

    } catch (error) {
        console.error('Could not load farmers and farms:', error);
        toast(errorMessage(error));
        return;
    }

    if (!farmers.length) {
        toast('No assigned residential farmers found.');
        return;
    }

    if (!farms.length) {
        toast('No farms found in your assigned municipality.');
        return;
    }

    // Farmer dropdown uses the actual profile ID.
    const farmerSelect = h(
        'select',
        { required: true },
        h('option', { value: '' }, 'Select farmer'),
        ...farmers.map(farmer =>
            h(
                'option',
                { value: farmer.farmer_id },
                farmer.full_name
            )
        )
    );

    // Farm dropdown is independent of farm ownership.
    const farmSelect = h(
        'select',
        { required: true },
        h('option', { value: '' }, 'Select farm'),
        ...farms.map(farm =>
            h(
                'option',
                { value: farm.id },
                `${farm.farm_name} — ${farm.farm_location || 'No location'}`
            )
        )
    );

    const titleInput = h('input', {
        type: 'text',
        maxlength: '150',
        placeholder: 'e.g. Prepare the soil before planting',
        required: true
    });

    const categorySelect = h(
        'select',
        { required: true },
        h('option', { value: '' }, 'Select category'),
        ...[
            'Land Preparation',
            'Fertilizing',
            'Irrigation',
            'Weeding',
            'Pest Control',
            'Inspection',
            'Pruning',
            'Other'
        ].map(category =>
            h('option', { value: category }, category)
        )
    );

    const descriptionInput = h('textarea', {
        rows: '4',
        placeholder: 'Enter instructions or additional details...'
    });

    const dueDateInput = h('input', {
        type: 'date'
    });

    const field = (label, control) =>
        h('label', { class: 'fa-form-field' },
            h('span', {}, label),
            control
        );

    const dialog = h('dialog', {
        class: 'fa-dialog',
        'aria-label': 'Create action request'
    });

    const submitButton = h('button', {
        type: 'submit',
        class: 'btn primary'
    }, 'Create Request');

    const form = h('form', { class: 'fa-create-form' },
        field('Farmer', farmerSelect),
        field('Farm', farmSelect),
        field('Action Title', titleInput),
        field('Action Category', categorySelect),
        field('Instructions', descriptionInput),
        field('Due Date (Optional)', dueDateInput),

        h('div', { class: 'fa-modal-actions' },
            h('button', {
                type: 'button',
                class: 'btn ghost',
                onclick: () => dialog.close()
            }, 'Cancel'),
            submitButton
        )
    );

    dialog.append(
        h('div', { class: 'fa-dialog-header' },
            h('div', {},
                h('h2', {}, 'Create Action Request'),
                h('p', {}, 'Assign an activity to one of your farmers.')
            ),
            h('button', {
                type: 'button',
                class: 'fa-close',
                'aria-label': 'Close',
                onclick: () => dialog.close()
            }, '×')
        ),
        form
    );

    dialog.addEventListener('close', () => dialog.remove());

    form.addEventListener('submit', async event => {
        event.preventDefault();

        if (!form.reportValidity()) return;

        const selectedFarmer = farmers.find(
            farmer => farmer.farmer_id === farmerSelect.value
        );

        // Validate farm by its ID only.
        // Do not require the selected farmer to own the farm.
        const selectedFarm = farms.find(
            farm => farm.id === farmSelect.value
        );

        if (!selectedFarmer || !selectedFarm) {
            toast('Please select a valid farmer and farm.');
            return;
        }

        submitButton.disabled = true;
        submitButton.textContent = 'Creating...';

        try {
            const payload = {
                manager_id: managerUserId,
                farmer_id: selectedFarmer.farmer_id,
                farm_id: selectedFarm.id,
                planting_id: null,
                action_title: titleInput.value.trim(),
                action_category: categorySelect.value,
                description: descriptionInput.value.trim() || null,
                due_date: dueDateInput.value || null,
                status: 'pending'
            };

            const { data: { user } } = await supabase.auth.getUser();

            const { data: farmAccess, error: accessError } =
                await supabase.rpc('can_manage_tanikala_farm', {
                    p_farm_id: payload.farm_id
                });

            const { data: farmerProfile, error: farmerError } =
                await supabase
                    .from('profiles')
                    .select('id, role, status')
                    .eq('id', payload.farmer_id)
                    .maybeSingle();

            console.log('FARM ACTION RLS DIAGNOSTIC:', {
                authUserId: user?.id,
                managerId: payload.manager_id,
                managerMatches: user?.id === payload.manager_id,
                farmId: payload.farm_id,
                farmAccess,
                accessError,
                farmerId: payload.farmer_id,
                farmerProfile,
                farmerError
            });

            const { error } = await supabase
                .from('farm_actions')
                .insert(payload);

            if (error) throw error;

            toast('Action request created successfully.');
            dialog.close();

            await onCreated();

        } catch (error) {
            console.error('Create action request failed:', error);
            toast(errorMessage(error));

            submitButton.disabled = false;
            submitButton.textContent = 'Create Request';
        }
    });

    document.body.append(dialog);
    dialog.showModal();
}

async function loadLookups() {
    const [farmResult, farmerResult] = await Promise.all([
        supabase
            .from('farmer_farms')
            .select('id, farm_name'),

        supabase.rpc('manager_list_residential_farmers')
    ]);

    if (farmResult.error) {
        console.warn('Could not load farm names:', farmResult.error);
    }

    if (farmerResult.error) {
        console.warn('Could not load farmer names:', farmerResult.error);
    }

    return {
        farms: new Map(
            (farmResult.data ?? []).map(farm => [
                farm.id,
                farm
            ])
        ),

        farmers: new Map(
            (farmerResult.data ?? []).map(farmer => [
                farmer.farmer_id,
                farmer
            ])
        )
    };
}


async function loadSubmissionDetails(actionList) {
    submissionsByAction = new Map();

    const submittedActions = actionList.filter(
        action => action.status === 'submitted'
    );

    if (!submittedActions.length) return;

    const actionIds = submittedActions.map(
        action => action.action_id
    );

    const { data: completions, error: completionError } = await supabase
        .from('farm_action_completions')
        .select(`
            completion_id,
            action_id,
            completion_notes,
            actual_completion_date,
            submission_number,
            submitted_at
        `)
        .in('action_id', actionIds)
        .order('submission_number', { ascending: false });

    if (completionError) throw completionError;

    const completionById = new Map();

    for (const completion of completions || []) {
        if (!submissionsByAction.has(completion.action_id)) {
            const submission = {
                ...completion,
                evidence: []
            };

            submissionsByAction.set(completion.action_id, submission);
            completionById.set(completion.completion_id, submission);
        }
    }

    const completionIds = [
        ...completionById.keys()
    ];

    if (!completionIds.length) return;

    const { data: evidenceRows, error: evidenceError } = await supabase
        .from('farm_action_evidence')
        .select(`
            evidence_id,
            completion_id,
            file_name,
            file_path,
            file_type,
            description,
            uploaded_at
        `)
        .in('completion_id', completionIds)
        .order('uploaded_at', { ascending: true });

    if (evidenceError) throw evidenceError;

    for (const evidence of evidenceRows || []) {
        const submission = completionById.get(
            evidence.completion_id
        );

        if (!submission) continue;

        const { data, error } = await supabase.storage
            .from('farm-action-evidence')
            .createSignedUrl(evidence.file_path, 300);

        if (error) {
            console.error('Evidence URL error:', error);
        }

        submission.evidence.push({
            ...evidence,
            signedUrl: data?.signedUrl || null
        });
    }
}

async function openSubmissionReview(action, completion, onReviewed) {
    if (!completion) {
        toast('No completion submission was found for this action.');
        return;
    }

    const dialog = h('dialog', {
        class: 'fa-dialog fa-review-dialog',
        'aria-label': 'Review farmer submission'
    });

    const notesInput = h('textarea', {
        rows: '4',
        placeholder: 'Share feedback on this submission, or explain what needs to be corrected before it can be verified...'
    });

    const verifyButton = h('button', {
        type: 'button',
        class: 'btn primary fa-btn-verify'
    }, 'Verify Submission');

    const revisionButton = h('button', {
        type: 'button',
        class: 'btn ghost fa-btn-revision'
    }, 'Request Revision');

    const closeDialog = () => dialog.close();

    const evidenceList = h('div', {
        class: 'fa-review-evidence'
    });

    if (!completion.evidence.length) {
        evidenceList.append(
            h('p', { class: 'fa-review-muted' }, 'No evidence files uploaded.')
        );
    } else {
        completion.evidence.forEach(file => {
            const isImage =
                /^image\//i.test(file.file_type || '') ||
                /\.(png|jpe?g|gif|webp|heic)$/i.test(file.file_name || '');

            const item = h('div', { class: 'fa-evidence-item' },
                icon(isImage ? 'image' : 'file', 'fa-evidence-icon'),
                h('div', { class: 'fa-evidence-info' },
                    h('strong', {}, file.file_name),
                    h('span', {}, file.description || file.file_type || 'Evidence')
                )
            );

            if (file.signedUrl) {
                const link = h('a', {
                    href: file.signedUrl,
                    target: '_blank',
                    rel: 'noopener noreferrer',
                    class: 'fa-evidence-link'
                }, 'View File');

                item.append(link);
            } else {
                item.append(
                    h('span', { class: 'fa-review-muted' },
                        'File preview unavailable'
                    )
                );
            }

            evidenceList.append(item);
        });
    }

    const submitReview = async decision => {
        const notes = notesInput.value.trim();

        if (decision === 'revision_requested' && !notes) {
            toast('Please provide instructions for the requested revision.');
            notesInput.focus();
            return;
        }

        verifyButton.disabled = true;
        revisionButton.disabled = true;

        verifyButton.textContent = 'Processing...';

        try {
            const { error } = await supabase.rpc(
                'review_farm_action_completion',
                {
                    p_completion_id: completion.completion_id,
                    p_decision: decision,
                    p_verification_notes: notes || null
                }
            );

            if (error) throw error;

            toast(
                decision === 'verified'
                    ? 'Submission verified successfully.'
                    : 'Revision requested successfully.'
            );

            dialog.close();
            await onReviewed();

        } catch (error) {
            console.error('Farm action review failed:', error);
            toast(errorMessage(error));

            verifyButton.disabled = false;
            revisionButton.disabled = false;
            verifyButton.textContent = 'Verify Submission';
        }
    };

    verifyButton.addEventListener('click', () => {
        submitReview('verified');
    });

    revisionButton.addEventListener('click', () => {
        submitReview('revision_requested');
    });

    const detail = (label, value) =>
        h('div', { class: 'fa-review-detail' },
            h('span', { class: 'fa-review-detail-label' }, label),
            h('strong', { class: 'fa-review-detail-value' }, value)
        );

    dialog.append(
        h('div', { class: 'fa-dialog-header' },
            h('div', { class: 'fa-review-heading' },
                h('h2', {}, 'Review Farmer Submission'),
                h('p', { class: 'fa-review-action-title' },
                    action.action_title || 'Farm Action'
                ),
                h('p', {}, `Submitted by ${action.farmer_name || 'Farmer'}`)
            ),
            h('button', {
                type: 'button',
                class: 'fa-close',
                'aria-label': 'Close',
                onclick: closeDialog
            }, '×')
        ),

        h('div', { class: 'fa-review-content' },
            h('div', { class: 'fa-review-details' },
                detail('Submission', `#${completion.submission_number}`),
                detail(
                    'Actual completion date',
                    dateLabel(completion.actual_completion_date)
                ),
                detail('Submitted', dateTimeLabel(completion.submitted_at))
            ),

            h('section', { class: 'fa-review-section' },
                h('div', { class: 'fa-review-section-head' },
                    h('h3', {}, 'Completion Notes')
                ),
                h('p', { class: 'fa-review-notes' },
                    completion.completion_notes || 'No completion notes provided.'
                )
            ),

            h('section', { class: 'fa-review-section fa-review-section--evidence' },
                h('div', { class: 'fa-review-section-head' },
                    h('h3', {}, 'Evidence Attachments'),
                    h('span', { class: 'fa-review-count' },
                        String(completion.evidence.length)
                    )
                ),
                evidenceList
            ),

            h('section', { class: 'fa-review-section' },
                h('div', { class: 'fa-review-section-head' },
                    h('h3', {}, 'Manager Feedback')
                ),
                h('label', { class: 'fa-form-field' },
                    h('span', {}, 'Notes (required when requesting revision)'),
                    notesInput
                )
            )
        ),

        h('div', { class: 'fa-modal-actions' },
            h('button', {
                type: 'button',
                class: 'btn ghost fa-btn-cancel',
                onclick: closeDialog
            }, 'Cancel'),
            revisionButton,
            verifyButton
        )
    );

    dialog.addEventListener('close', () => dialog.remove());

    document.body.append(dialog);
    dialog.showModal();
}

async function loadActions() {
    const {
        data: { user },
        error: authError
    } = await supabase.auth.getUser();

    if (authError) throw authError;
    if (!user) throw new Error('No authenticated user.');

    const [{ data, error }, lookups] = await Promise.all([
        supabase
            .from('farm_actions')
            .select(`
                action_id,
                action_title,
                action_category,
                description,
                due_date,
                status,
                farmer_id,
                farm_id
            `)
            .eq('manager_id', user.id)
            .order('created_at', { ascending: false }),

        loadLookups()
    ]);

    if (error) throw error;

    actions = (data || []).map(action => ({
        ...action,
        farm_name:
            lookups.farms.get(action.farm_id)?.farm_name ?? '',

        farmer_name:
            lookups.farmers.get(action.farmer_id)?.full_name ?? 'Farmer'
    }));

    await loadSubmissionDetails(actions);
}

// ---------- FARM ACTIONS REALTIME ----------

function cleanupRealtime() {
    clearTimeout(farmActionsReloadTimer);
    clearInterval(farmActionsPollingTimer);

    if (farmActionsChannel) {
        supabase.removeChannel(farmActionsChannel);
        farmActionsChannel = null;
    }
}



function subscribeToFarmActions(managerId, onUpdate) {
    cleanupRealtime();

    const scheduleRefresh = () => {
        clearTimeout(farmActionsReloadTimer);

        farmActionsReloadTimer = setTimeout(async () => {
            await onUpdate();
        }, 500);
    };

    farmActionsChannel = supabase
        .channel(`farm-manager-actions-${managerId}`)
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'farm_actions',
                filter: `manager_id=eq.${managerId}`
            },
            scheduleRefresh
        )
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'farm_action_responses'
            },
            scheduleRefresh
        )
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'farm_action_completions'
            },
            scheduleRefresh
        )
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'farm_action_evidence'
            },
            scheduleRefresh
        )
        .subscribe(status => {
            if (status === 'SUBSCRIBED') {
                console.log('Farm Manager Farm Actions Realtime connected.');
            } else if (status === 'CHANNEL_ERROR') {
                console.error('Farm Actions Realtime connection failed.');
            }
        });

    farmActionsPollingTimer = setInterval(async () => {
        await onUpdate();
    }, 2000);
}


export function cleanup() {
    cleanupRealtime();
    viewRoot = null;
}

export async function render(root, ctx) {
    viewRoot = root;
    actions = [];
    activeFilter = 'all';

    const renderCurrentPage = () => {
        renderPage(() => openCreateActionModal(load));
    };

    const load = async () => {
        root.replaceChildren(
            h('p', { class: 'muted' }, 'Loading Farm Actions...')
        );

        try {
            await loadActions();
            renderCurrentPage();
        } catch (error) {
            console.error('Failed to load Farm Actions:', error);

            root.replaceChildren(
                h('p', { class: 'msg error' }, errorMessage(error)),
                h('button', {
                    class: 'btn ghost',
                    type: 'button',
                    onclick: load
                }, 'Retry')
            );
        }
    };

    // Refresh data without displaying the loading screen.
    const refresh = async () => {
        try {
            await loadActions();

            if (viewRoot === root) {
                renderCurrentPage();
            }
        } catch (error) {
            console.error('Realtime Farm Actions refresh failed:', error);
        }
    };

    await load();

    const {
        data: { user },
        error
    } = await supabase.auth.getUser();

    if (!error && user) {
        subscribeToFarmActions(user.id, refresh);
    }
}