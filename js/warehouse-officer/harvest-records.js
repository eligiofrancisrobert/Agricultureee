
import { supabase } from '../connection.js';

let activeChannel = null;
let refreshTimer = null;
let renderToken = 0;

function el(tag, className = '', text = '') {
    const node = document.createElement(tag);

    if (className) node.className = className;

    if (text !== undefined && text !== null) {
        node.textContent = text;
    }

    return node;
}

async function loadOfficerAssignedFarm(ctx) {
    if (ctx.assignedFarm?.farm_id || ctx.assignedFarm?.id) {
        return {
            farm_id: ctx.assignedFarm.farm_id || ctx.assignedFarm.id,
            farm_name: ctx.assignedFarm.farm_name || '',
            farm_location: ctx.assignedFarm.farm_location || ''
        };
    }

    const staffId = ctx.staff?.staff_id;

    if (!staffId) {
        throw new Error('Warehouse Officer staff ID is missing.');
    }

    const { data: assignment, error: assignmentError } = await supabase
        .from('warehouse_officer_farm_assignments')
        .select('farm_id')
        .eq('staff_id', staffId)
        .order('assigned_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (assignmentError) throw assignmentError;

    if (!assignment?.farm_id) {
        throw new Error('No farm assignment found for this Warehouse Officer.');
    }

    const { data: farm, error: farmError } = await supabase
        .from('farmer_farms')
        .select('id, farm_name, farm_location')
        .eq('id', assignment.farm_id)
        .maybeSingle();

    if (farmError) throw farmError;

    if (!farm) {
        throw new Error('Assigned farm could not be accessed.');
    }

    return {
        farm_id: farm.id,
        farm_name: farm.farm_name,
        farm_location: farm.farm_location
    };
}

function formatDate(value) {
    if (!value) return '—';

    return new Date(`${value}T00:00:00`).toLocaleDateString('en-PH', {
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

function statusLabel(status) {
    const labels = {
        pending: 'Pending',
        in_progress: 'In Progress',
        confirmed: 'Verified',
        rejected: 'Rejected'
    };

    return labels[status] || status || 'Unknown';
}

function statusClass(status) {
    return `wo-harvest-status wo-status-${status || 'unknown'}`;
}

function createDetail(label, value) {
    const item = el('div', 'wo-harvest-detail');

    item.append(
        el('span', 'wo-harvest-detail-label', label),
        el('strong', 'wo-harvest-detail-value', value ?? '—')
    );

    return item;
}

function createVerificationForm(record, refresh) {
    const form = el('form', 'wo-verification-form');

    const heading = el('h3', '', 'Verify Harvest Submission');
    const quantityLabel = el('label', 'wo-form-label', 'Verified Quantity');

    const quantityInput = el('input', 'wo-form-input');
    quantityInput.type = 'number';
    quantityInput.min = '0.01';
    quantityInput.step = 'any';
    quantityInput.placeholder = 'Enter actual harvested quantity';
    quantityInput.required = true;

    quantityLabel.append(quantityInput);

    const decisionLabel = el('label', 'wo-form-label', 'Verification Decision');
    const decisionSelect = el('select', 'wo-form-input');

    [
        { value: 'confirmed', label: 'Confirm Harvest' },
        { value: 'rejected', label: 'Reject Submission' }
    ].forEach(option => {
        const optionElement = el('option', '', option.label);
        optionElement.value = option.value;
        decisionSelect.append(optionElement);
    });

    decisionLabel.append(decisionSelect);

    const notesLabel = el('label', 'wo-form-label', 'Verification Notes');
    const notesInput = el('textarea', 'wo-form-input');
    notesInput.rows = 3;
    notesInput.placeholder = 'Enter remarks or reason for rejection';

    notesLabel.append(notesInput);

    const submitButton = el(
        'button',
        'wo-button wo-button-primary',
        'Submit Verification'
    );
    submitButton.type = 'submit';

    const updateFormFields = () => {
        const isRejected = decisionSelect.value === 'rejected';

        quantityInput.disabled = isRejected;
        quantityInput.required = !isRejected;

        if (isRejected) quantityInput.value = '';

        notesInput.required = isRejected;
    };

    decisionSelect.addEventListener('change', updateFormFields);

    form.append(
        heading,
        quantityLabel,
        decisionLabel,
        notesLabel,
        submitButton
    );

    form.addEventListener('submit', async event => {
        event.preventDefault();

        const decision = decisionSelect.value;
        const verifiedQuantity = decision === 'confirmed'
            ? Number(quantityInput.value)
            : null;

        const verificationNotes = notesInput.value.trim();

        if (
            decision === 'confirmed' &&
            (!Number.isFinite(verifiedQuantity) || verifiedQuantity <= 0)
        ) {
            alert('Enter a valid verified quantity greater than zero.');
            return;
        }

        if (decision === 'rejected' && !verificationNotes) {
            alert('Please provide a reason for rejecting this harvest.');
            return;
        }

        submitButton.disabled = true;
        submitButton.textContent = 'Submitting...';

        try {
            const { error } = await supabase.rpc(
                'finalize_harvest_verification',
                {
                    p_harvest_id: record.harvest_id,
                    p_decision: decision,
                    p_verified_quantity: verifiedQuantity,
                    p_verification_notes: verificationNotes || null
                }
            );

            if (error) throw error;

            alert(
                decision === 'confirmed'
                    ? 'Harvest successfully verified.'
                    : 'Harvest submission successfully rejected.'
            );

            await refresh();

        } catch (error) {
            console.error('Harvest verification failed:', error);
            alert(error.message || 'Unable to submit harvest verification.');
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = 'Submit Verification';
        }
    });

    return form;
}

function createRecordCard(record, ctx, refresh) {
    const card = el('article', 'wo-harvest-card');
    const header = el('div', 'wo-harvest-card-header');
    const titleGroup = el('div', 'wo-harvest-card-title');

    titleGroup.append(
        el('h2', '', record.farm_plantings?.crop_name || 'Harvest Submission'),
        el('small', 'wo-harvest-id', `Record ID: ${record.harvest_id}`)
    );

    header.append(
        titleGroup,
        el(
            'span',
            statusClass(record.confirmation_status),
            statusLabel(record.confirmation_status)
        )
    );

    const details = el('div', 'wo-harvest-details-grid');

    details.append(
        createDetail('Harvest Date', formatDate(record.harvested_date)),
        createDetail(
            'Reported Quantity',
            `${record.harvest_quantity ?? '—'} ${record.harvest_unit || ''}`.trim()
        ),
        createDetail('Submitted', formatDateTime(record.created_at)),
        createDetail('Farmer ID', record.farmer_id),
        createDetail('Planting ID', record.planting_id)
    );

    if (record.notes) {
        details.append(createDetail('Farmer Notes', record.notes));
    }

    card.append(header, details);

    const footer = el('div', 'wo-harvest-card-footer');

    if (record.confirmation_status === 'pending') {
        const claimButton = el(
            'button',
            'wo-button wo-button-primary',
            'Claim Harvest'
        );

        claimButton.type = 'button';

        claimButton.addEventListener('click', async () => {
            claimButton.disabled = true;
            claimButton.textContent = 'Claiming...';

            try {
                const { error } = await supabase.rpc(
                    'claim_harvest',
                    { p_harvest_id: record.harvest_id }
                );

                if (error) throw error;

                alert('Harvest successfully claimed for verification.');
                await refresh();

            } catch (error) {
                console.error('Failed to claim harvest:', error);
                alert(error.message || 'Unable to claim this harvest.');
                claimButton.disabled = false;
                claimButton.textContent = 'Claim Harvest';
            }
        });

        footer.append(claimButton);

    } else if (record.confirmation_status === 'in_progress') {
        if (record.claimed_by === ctx.staff?.staff_id) {
            footer.append(createVerificationForm(record, refresh));
        } else {
            footer.append(
                el(
                    'p',
                    'wo-harvest-info',
                    'This harvest is currently being verified by another Warehouse Officer.'
                )
            );
        }

    } else if (record.confirmation_status === 'confirmed') {
        footer.append(
            el(
                'p',
                'wo-harvest-success',
                `Verified Quantity: ${record.verified_quantity ?? '—'} ${record.harvest_unit || ''}`
            ),
            el(
                'small',
                'wo-harvest-info',
                `Verified on: ${formatDateTime(record.confirmed_at)}`
            )
        );

        if (record.verification_notes) {
            footer.append(
                el('p', 'wo-harvest-info', `Notes: ${record.verification_notes}`)
            );
        }

    } else if (record.confirmation_status === 'rejected') {
        footer.append(
            el(
                'p',
                'wo-harvest-rejected',
                `Rejection Reason: ${record.verification_notes || 'No reason provided.'}`
            )
        );
    }

    card.append(footer);

    return card;
}

export async function render(root, ctx) {
    cleanup();

    const currentToken = ++renderToken;

    let currentStatus = 'all';
    let records = [];
    let assignedFarm = null;
    let farmId = null;

    const page = el('section', 'wo-harvest-records');
    const heading = el('div', 'wo-page-heading');

    heading.append(
        el('h1', '', 'Harvest Records'),
        el(
            'p',
            'muted',
            'Review and verify harvest submissions from your assigned farm.'
        )
    );

    const farmInfo = el(
        'p',
        'wo-assigned-farm-context',
        'Assigned Farm: Loading...'
    );

    const toolbar = el('div', 'wo-harvest-toolbar');
    const filter = el('select', 'wo-form-input wo-harvest-filter');

    [
        { value: 'all', label: 'All Records' },
        { value: 'pending', label: 'Pending' },
        { value: 'in_progress', label: 'In Progress' },
        { value: 'confirmed', label: 'Verified' },
        { value: 'rejected', label: 'Rejected' }
    ].forEach(item => {
        const option = el('option', '', item.label);
        option.value = item.value;
        filter.append(option);
    });

    const refreshButton = el(
        'button',
        'wo-button wo-button-secondary',
        'Refresh'
    );
    refreshButton.type = 'button';

    const recordsContainer = el('div', 'wo-harvest-list');

    toolbar.append(filter, refreshButton);
    page.append(heading, farmInfo, toolbar, recordsContainer);
    root.replaceChildren(page);

    function displayRecords() {
        if (currentToken !== renderToken) return;

        let filtered = [...records];

        if (currentStatus !== 'all') {
            filtered = filtered.filter(
                record => record.confirmation_status === currentStatus
            );
        }

        const searchTerm = (ctx.query || '').trim().toLowerCase();

        if (searchTerm) {
            filtered = filtered.filter(record => {
                const searchable = [
                    record.harvest_id,
                    record.farmer_id,
                    record.planting_id,
                    record.harvested_date,
                    record.harvest_quantity,
                    record.harvest_unit,
                    record.confirmation_status,
                    record.farm_plantings?.crop_name,
                    record.notes
                ].join(' ').toLowerCase();

                return searchable.includes(searchTerm);
            });
        }

        if (!filtered.length) {
            recordsContainer.replaceChildren(
                el(
                    'p',
                    'wo-empty-state',
                    'No harvest records found for your assigned farm.'
                )
            );
            return;
        }

        recordsContainer.replaceChildren(
            ...filtered.map(record =>
                createRecordCard(record, ctx, loadRecords)
            )
        );
    }


    async function loadRecords() {
        if (currentToken !== renderToken) return;

        if (!farmId) {
            recordsContainer.replaceChildren(
                el('p', 'msg error', 'No assigned farm found.')
            );
            return;
        }

        recordsContainer.replaceChildren(
            el('p', 'muted', 'Loading harvest records...')
        );

        try {
            console.log('[HARVEST DEBUG] Farm ID:', farmId);

            // STEP 1: Get fields belonging to the assigned farm.
            const { data: fields, error: fieldsError } = await supabase
                .from('farm_fields')
                .select('id')
                .eq('farm_id', farmId);

            console.log('[HARVEST DEBUG] Fields:', fields);
            console.log('[HARVEST DEBUG] Fields error:', fieldsError);

            if (fieldsError) throw fieldsError;

            if (currentToken !== renderToken) return;

            const fieldIds = (fields || []).map(field => field.id);

            if (!fieldIds.length) {
                console.warn('[HARVEST DEBUG] No fields found.');
                records = [];
                displayRecords();
                return;
            }

            // STEP 2: Get plantings belonging to those fields.
            const { data: plantings, error: plantingsError } = await supabase
                .from('farm_plantings')
                .select('id, crop_name, field_id')
                .in('field_id', fieldIds);

            console.log('[HARVEST DEBUG] Plantings:', plantings);
            console.log('[HARVEST DEBUG] Plantings error:', plantingsError);

            if (plantingsError) throw plantingsError;

            if (currentToken !== renderToken) return;

            const plantingIds = (plantings || []).map(planting => planting.id);

            if (!plantingIds.length) {
                console.warn('[HARVEST DEBUG] No plantings found.');
                records = [];
                displayRecords();
                return;
            }

            // STEP 3: Get every harvest record linked to those plantings.
            const { data: harvests, error: harvestError } = await supabase
                .from('harvested_crops')
                .select('*')
                .in('planting_id', plantingIds)
                .order('created_at', { ascending: false });

            console.log('[HARVEST DEBUG] Harvests:', harvests);
            console.log('[HARVEST DEBUG] Harvest error:', harvestError);

            if (harvestError) throw harvestError;

            if (currentToken !== renderToken) return;

            const plantingMap = new Map(
                (plantings || []).map(planting => [
                    planting.id,
                    planting
                ])
            );

            records = (harvests || []).map(record => ({
                ...record,
                farm_plantings: plantingMap.get(record.planting_id) || null
            }));

            console.log('[HARVEST DEBUG] Total records:', records.length);
            console.log('[HARVEST DEBUG] New Mandrake record:',
                records.find(record =>
                    record.harvest_id === '083dc3e7-a72e-4dfb-b073-336b957f57d5'
                )
            );

            displayRecords();

        } catch (error) {
            console.error('[HARVEST DEBUG] Failed to load harvest records:', error);

            if (currentToken !== renderToken) return;

            recordsContainer.replaceChildren(
                el(
                    'p',
                    'msg error',
                    `Unable to load harvest records: ${error.message || 'Unknown error'}`
                )
            );
        }
    }


    function subscribeToHarvestChanges() {
        if (currentToken !== renderToken || !farmId) return;

        activeChannel = supabase
            .channel(`wo-harvest-${ctx.staff.staff_id}-${farmId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'harvested_crops'
                },
                payload => {
                    console.log('Harvest record changed:', payload.eventType);

                    clearTimeout(refreshTimer);

                    refreshTimer = setTimeout(() => {
                        if (currentToken === renderToken) {
                            loadRecords();
                        }
                    }, 400);
                }
            )
            .subscribe(status => {
                console.log('Harvest Realtime status:', status);
            });
    }

    filter.addEventListener('change', () => {
        currentStatus = filter.value;
        displayRecords();
    });

    refreshButton.addEventListener('click', loadRecords);

    try {
        assignedFarm = await loadOfficerAssignedFarm(ctx);

        if (currentToken !== renderToken) return;

        farmId = assignedFarm.farm_id;
        ctx.assignedFarm = assignedFarm;

        farmInfo.textContent =
            `Assigned Farm: ${assignedFarm.farm_name || 'Not available'} — ${assignedFarm.farm_location || ''}`;

        subscribeToHarvestChanges();
        await loadRecords();

    } catch (error) {
        console.error('Failed to resolve assigned farm:', error);

        farmInfo.textContent = 'Assigned Farm: Not available';

        recordsContainer.replaceChildren(
            el(
                'p',
                'msg error',
                error.message || 'Unable to load assigned farm.'
            )
        );
    }
}

export function cleanup() {
    renderToken++;

    if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
    }

    if (activeChannel) {
        supabase.removeChannel(activeChannel);
        activeChannel = null;
    }
}
