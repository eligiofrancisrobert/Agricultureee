
import { supabase } from '../connection.js';
import { h } from '../admin/ui.js';

/*
 * Workers page.
 * All styling lives in css/farm-manager/workers.css (classes prefixed "wk-").
 * This file only builds markup: no <style> element, no inline styles.
 */

const STAFF_ROLES = {
    2: 'Warehouse Officer',
    4: 'Accountant'
};

const STAFF_GROUPS = [
    { roleId: 2, title: 'Warehouse Officers' },
    { roleId: 4, title: 'Accountants' }
];

const FARMING_TYPES = {
    farm_operator_manager: 'Farm Owner / Operator Manager',
    tenant_lessee: 'Tenant / Lessee',
    farm_worker: 'Farm Worker'
};

const REPLENISHMENT_TABLE = 'warehouse_replenishment_requests';

/* ---------- Module-level state ---------- */

let activeModal = null;
let escapeHandler = null;
let requestRealtimeChannel = null;
let activeRequestStaffId = null;
let requestRefreshInProgress = false;
let requestRefreshPending = false;

/* ---------- Helpers ---------- */

const getSearchQuery = (ctx) =>
    (ctx?.query ?? '').trim().toLowerCase();

const getErrorMessage = (error) =>
    error?.message || 'Something went wrong. Please try again.';

const initials = (name) =>
    (name || '?')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0].toUpperCase())
        .join('');

const formatDateTime = (value) => {
    if (!value) return '—';

    const date = new Date(value);

    return Number.isNaN(date.getTime())
        ? '—'
        : date.toLocaleString('en-PH', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
};

const stateMessage = (text, isError = false) =>
    h('p', { class: `wk-state${isError ? ' is-error' : ''}` }, text);

const errorState = (text, onRetry) =>
    h(
        'div',
        { class: 'wk-state-group' },
        stateMessage(text, true),
        h(
            'button',
            {
                class: 'wk-btn wk-btn--ghost wk-btn--sm',
                type: 'button',
                onclick: onRetry
            },
            'Retry'
        )
    );

function setFeedback(element, text, type = '') {
    element.textContent = text;
    element.className = `wk-feedback${type ? ` is-${type}` : ''}`;
    element.hidden = !text;
}

/* ---------- Modal cleanup ---------- */

function closeRequestModal() {
    if (escapeHandler) {
        document.removeEventListener('keydown', escapeHandler);
        escapeHandler = null;
    }

    if (activeModal) {
        activeModal.remove();
        activeModal = null;
    }

    activeRequestStaffId = null;
}

/* ---------- Realtime cleanup ---------- */

function stopReplenishmentRealtime() {
    if (requestRealtimeChannel) {
        supabase.removeChannel(requestRealtimeChannel);
        requestRealtimeChannel = null;
    }

    requestRefreshInProgress = false;
    requestRefreshPending = false;
}

/** Called by main.js when the route changes. */
export function cleanup() {
    closeRequestModal();
    stopReplenishmentRealtime();
}

/** Render staff members, replenishment requests, and farm personnel assignment. */
export async function render(root, ctx) {
    let currentRequests = [];
    let staffCache = [];

    const staffHolder = h('div', { class: 'wk-holder' });
    const peopleHolder = h('div', { class: 'wk-holder' });

    root.append(
        h(
            'div',
            { class: 'wk-page' },

            h(
                'header',
                {},
                h('h1', { class: 'wk-title' }, 'Workers'),
                h(
                    'p',
                    { class: 'wk-subtitle' },
                    'Manage staff members and registered farm personnel in your municipality.'
                )
            ),

            h(
                'section',
                { class: 'wk-panel' },
                h(
                    'div',
                    { class: 'wk-panel-head' },
                    h('h2', { class: 'wk-panel-title' }, 'Staff Members'),
                    h(
                        'p',
                        { class: 'wk-panel-desc' },
                        'Warehouse Officers and Accountants assigned to farms within your municipality.'
                    )
                ),
                staffHolder
            ),

            h(
                'section',
                { class: 'wk-panel' },
                h(
                    'div',
                    { class: 'wk-panel-head' },
                    h('h2', { class: 'wk-panel-title' }, 'Farm Personnel'),
                    h(
                        'p',
                        { class: 'wk-panel-desc' },
                        'Assign registered farm owners, tenants, and workers to farms within your authorized municipality.'
                    )
                ),
                peopleHolder
            )
        )
    );

    /* ============================================================
       REPLENISHMENT REQUESTS
       ============================================================ */

    async function loadRequests() {
        const { data, error } = await supabase.rpc(
            'manager_list_replenishment_requests'
        );

        if (error) throw error;

        currentRequests = data ?? [];
    }

    const getPendingRequestCount = (staffId) =>
        currentRequests.filter(
            (request) =>
                request.requester_staff_id === staffId &&
                request.request_status === 'pending'
        ).length;

    /* ============================================================
       REALTIME REFRESH
       ============================================================ */

    async function refreshReplenishmentRequests() {
        if (requestRefreshInProgress) {
            requestRefreshPending = true;
            return;
        }

        requestRefreshInProgress = true;

        try {
            do {
                requestRefreshPending = false;

                const currentlyOpenStaffId = activeRequestStaffId;

                await loadRequests();

                // Update the number badges of Warehouse Officers.
                renderStaff();

                // Refresh the currently open request modal.
                if (currentlyOpenStaffId) {
                    openRequestModal(currentlyOpenStaffId);
                }

            } while (requestRefreshPending);

        } catch (error) {
            console.error(
                'Failed to refresh replenishment requests:',
                error
            );
        } finally {
            requestRefreshInProgress = false;
        }
    }

    function startReplenishmentRealtime() {
        stopReplenishmentRealtime();

        requestRealtimeChannel = supabase
            .channel('manager-replenishment-requests')

            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: REPLENISHMENT_TABLE
                },
                (payload) => {
                    console.log(
                        'Replenishment request changed:',
                        payload.eventType,
                        payload.new?.request_id ||
                        payload.old?.request_id
                    );

                    refreshReplenishmentRequests();
                }
            )

            .subscribe((status, error) => {
                console.log(
                    'Replenishment Realtime status:',
                    status
                );

                if (error) {
                    console.error(
                        'Replenishment Realtime error:',
                        error
                    );
                }

                if (status === 'SUBSCRIBED') {
                    console.log(
                        'Replenishment Realtime connected successfully.'
                    );
                }

                if (
                    status === 'CHANNEL_ERROR' ||
                    status === 'TIMED_OUT'
                ) {
                    console.error(
                        'Replenishment Realtime connection failed.'
                    );
                }
            });
    }

    /* ============================================================
       REQUEST REVIEW
       ============================================================ */


    async function reviewRequest(request, decision, buttons, feedback) {
        if (
            !window.confirm(
                `Are you sure you want to ${decision === 'approved' ? 'approve' : 'reject'} this replenishment request?`
            )
        ) {
            return;
        }

        const reviewNote = window.prompt('Review note (optional):', '');

        if (reviewNote === null) return;

        buttons.forEach((button) => {
            button.disabled = true;
        });

        setFeedback(feedback, 'Saving review...');

        try {
            const { error } = await supabase.rpc(
                'manager_review_replenishment_request',
                {
                    p_request_id: request.request_id,
                    p_decision: decision,
                    p_review_note: reviewNote.trim() || null
                }
            );

            if (error) throw error;

            await loadRequests();
            renderStaff();

            if (decision === 'approved') {
                closeRequestModal();

                // Open Browse Products with the approved request ID.
                location.hash = `browse-products/${request.request_id}`;
                return;
            }

            openRequestModal(request.requester_staff_id);

        } catch (error) {
            console.error(
                'Failed to review replenishment request:',
                error
            );

            setFeedback(feedback, getErrorMessage(error), 'error');

            buttons.forEach((button) => {
                button.disabled = false;
            });
        }
    }


    async function hideRequest(request, button, feedback) {
        if (!window.confirm('Hide this resolved request from your list?')) {
            return;
        }

        button.disabled = true;
        button.textContent = 'Hiding...';

        try {
            const { error } = await supabase.rpc(
                'manager_hide_replenishment_request',
                {
                    p_request_id: request.request_id
                }
            );

            if (error) throw error;

            await loadRequests();

            renderStaff();

            openRequestModal(request.requester_staff_id);

        } catch (error) {
            console.error(
                'Failed to hide replenishment request:',
                error
            );

            setFeedback(feedback, getErrorMessage(error), 'error');

            button.disabled = false;
            button.textContent = 'Hide Request';
        }
    }

    /* ============================================================
       REQUEST COMPONENTS
       ============================================================ */

    const detailRow = (label, value) =>
        h(
            'div',
            { class: 'wk-detail' },
            h('span', { class: 'wk-detail-label' }, label),
            h('span', { class: 'wk-detail-value' }, String(value))
        );

    function requestCard(request) {
        const unit = request.tool_unit || '';
        const feedback = h('p', {
            class: 'wk-feedback',
            hidden: true
        });

        const details = [
            [
                'Requested By',
                request.requester_name || 'Unknown Warehouse Officer'
            ],
            [
                'Requested Quantity',
                `${request.requested_quantity} ${unit}`.trim()
            ],
            [
                'Current Stock',
                `${request.tool_quantity ?? '—'} ${unit}`.trim()
            ],
            [
                'Farm',
                request.farm_name || '—'
            ],
            [
                'Reason',
                request.request_reason || '—'
            ],
            [
                'Submitted',
                formatDateTime(request.created_at)
            ]
        ];

        if (request.review_note) {
            details.push([
                'Review Note',
                request.review_note
            ]);
        }

        let actions;

        if (request.request_status === 'pending') {
            const approve = h(
                'button',
                {
                    class: 'wk-btn wk-btn--approve wk-btn--sm',
                    type: 'button'
                },
                'Approve'
            );

            const reject = h(
                'button',
                {
                    class: 'wk-btn wk-btn--reject wk-btn--sm',
                    type: 'button'
                },
                'Reject'
            );

            approve.addEventListener('click', () =>
                reviewRequest(
                    request,
                    'approved',
                    [approve, reject],
                    feedback
                )
            );

            reject.addEventListener('click', () =>
                reviewRequest(
                    request,
                    'rejected',
                    [approve, reject],
                    feedback
                )
            );

            actions = [approve, reject];

        } else {
            const hide = h(
                'button',
                {
                    class: 'wk-btn wk-btn--ghost wk-btn--sm',
                    type: 'button'
                },
                'Hide Request'
            );

            hide.addEventListener('click', () =>
                hideRequest(request, hide, feedback)
            );

            actions = [hide];
        }

        const statusKey = String(
            request.request_status || 'unknown'
        )
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, '');

        return h(
            'article',
            { class: 'wk-request' },

            h(
                'div',
                { class: 'wk-request-head' },

                h(
                    'div',
                    {},
                    h(
                        'h4',
                        { class: 'wk-request-title' },
                        request.tool_name || 'Unknown Inventory Item'
                    ),
                    h(
                        'span',
                        { class: 'wk-request-category' },
                        request.tool_category || 'Inventory'
                    )
                ),

                h(
                    'span',
                    { class: `wk-status is-${statusKey}` },
                    request.request_status
                )
            ),

            h(
                'div',
                { class: 'wk-request-details' },
                details.map(([label, value]) =>
                    detailRow(label, value)
                )
            ),

            h(
                'div',
                { class: 'wk-request-actions' },
                actions
            ),

            feedback
        );
    }

    /* ============================================================
       REQUEST MODAL
       ============================================================ */

    function openRequestModal(staffId) {
        closeRequestModal();

        activeRequestStaffId = staffId;

        const staff = staffCache.find(
            (member) => member.staff_id === staffId
        );

        const requests = currentRequests.filter(
            (request) => request.requester_staff_id === staffId
        );

        const closeButton = h(
            'button',
            {
                class: 'wk-modal-close',
                type: 'button',
                'aria-label': 'Close',
                onclick: closeRequestModal
            },
            '×'
        );

        const overlay = h(
            'div',
            {
                class: 'wk-modal-overlay',
                onclick: (event) => {
                    if (event.target === overlay) {
                        closeRequestModal();
                    }
                }
            },

            h(
                'div',
                {
                    class: 'wk-modal',
                    role: 'dialog',
                    'aria-modal': 'true',
                    'aria-labelledby': 'wkModalTitle'
                },

                h(
                    'div',
                    { class: 'wk-modal-head' },

                    h(
                        'div',
                        {},
                        h(
                            'h3',
                            {
                                class: 'wk-modal-title',
                                id: 'wkModalTitle'
                            },
                            'Replenishment Requests'
                        ),

                        h(
                            'p',
                            { class: 'wk-modal-subtitle' },
                            staff?.full_name || 'Warehouse Officer'
                        )
                    ),

                    closeButton
                ),

                h(
                    'div',
                    { class: 'wk-request-list' },

                    requests.length
                        ? requests.map(requestCard)
                        : stateMessage(
                            'No replenishment requests found for this Warehouse Officer.'
                        )
                )
            )
        );

        escapeHandler = (event) => {
            if (event.key === 'Escape') {
                closeRequestModal();
            }
        };

        document.addEventListener('keydown', escapeHandler);

        activeModal = overlay;

        document.body.append(overlay);

        closeButton.focus();
    }

    /* ============================================================
       STAFF MEMBERS
       ============================================================ */

    function staffCard(member, group) {
        const head = [
            h(
                'div',
                { class: 'wk-staff-identity' },

                h(
                    'span',
                    {
                        class: 'wk-avatar',
                        'aria-hidden': 'true'
                    },
                    initials(member.full_name)
                ),

                h(
                    'div',
                    { class: 'wk-staff-text' },

                    h(
                        'h4',
                        { class: 'wk-staff-name' },
                        member.full_name || 'Unnamed Staff'
                    ),

                    h(
                        'p',
                        { class: 'wk-staff-email' },
                        member.email || 'No email available'
                    )
                )
            )
        ];

        // Only Warehouse Officers submit replenishment requests.
        if (group.roleId === 2) {
            const pending = getPendingRequestCount(member.staff_id);

            head.push(
                h(
                    'button',
                    {
                        class: `wk-request-badge${pending === 0 ? ' is-zero' : ''}`,
                        type: 'button',
                        title: `${pending} pending replenishment request(s)`,
                        'aria-label': `View ${pending} replenishment requests`,
                        onclick: () => openRequestModal(member.staff_id)
                    },
                    String(pending)
                )
            );
        }

        return h(
            'article',
            { class: 'wk-staff-card' },

            h(
                'div',
                { class: 'wk-staff-head' },
                head
            ),

            h(
                'span',
                { class: 'wk-pill' },
                member.type
            ),

            h(
                'p',
                { class: 'wk-staff-meta' },
                `Municipality: ${member.municipality || '—'}`
            )
        );
    }

    function renderStaff() {
        const q = getSearchQuery(ctx);

        const rows = staffCache.filter((member) =>
            [
                member.full_name,
                member.email,
                member.type,
                member.municipality
            ]
                .join(' ')
                .toLowerCase()
                .includes(q)
        );

        const sections = STAFF_GROUPS.map((group) => {
            const members = rows.filter(
                (member) =>
                    Number(member.role_id) === group.roleId
            );

            return h(
                'section',
                {},

                h(
                    'h3',
                    { class: 'wk-group-title' },

                    group.title,

                    h(
                        'span',
                        { class: 'wk-group-count' },
                        String(members.length)
                    )
                ),

                h(
                    'div',
                    { class: 'wk-staff-grid' },

                    members.length
                        ? members.map((member) =>
                            staffCard(member, group)
                        )
                        : stateMessage(
                            q
                                ? `No ${group.title.toLowerCase()} match your search.`
                                : `No ${group.title.toLowerCase()} found.`
                        )
                )
            );
        });

        staffHolder.replaceChildren(
            h('div', { class: 'wk-groups' }, sections)
        );
    }

    async function loadStaff() {
        staffHolder.replaceChildren(
            stateMessage('Loading staff members...')
        );

        try {
            const [staffResult] = await Promise.all([
                supabase.rpc('manager_list_municipality_staff'),
                loadRequests()
            ]);

            if (staffResult.error) {
                throw staffResult.error;
            }

            staffCache = (staffResult.data ?? [])
                .filter((member) =>
                    [2, 4].includes(Number(member.role_id))
                )
                .map((member) => ({
                    ...member,
                    type:
                        STAFF_ROLES[member.role_id] || 'Staff'
                }));

            renderStaff();

        } catch (error) {
            console.error(
                'Failed to load staff members:',
                error
            );

            staffHolder.replaceChildren(
                errorState(
                    `Could not load staff members. ${getErrorMessage(error)}`,
                    loadStaff
                )
            );
        }
    }

    /* ============================================================
       FARM PERSONNEL
       ============================================================ */

    function personRow(person, farms) {
        let selectedFarmId = farms.some(
            (farm) => farm.farm_id === person.assigned_farm_id
        )
            ? person.assigned_farm_id
            : '';

        const select = h(
            'select',
            {
                class: 'wk-select',
                'aria-label': `Select farm for ${person.person_name}`
            },

            h(
                'option',
                { value: '' },
                'Select a farm'
            ),

            farms.map((farm) =>
                h(
                    'option',
                    { value: farm.farm_id },
                    farm.farm_name
                )
            )
        );

        select.value = selectedFarmId;

        select.addEventListener('change', () => {
            selectedFarmId = select.value;
        });

        const feedback = h('p', {
            class: 'wk-feedback',
            hidden: true
        });

        const idleLabel = person.assigned_farm_id
            ? 'Update Assignment'
            : 'Assign Farm';

        const button = h(
            'button',
            {
                class: 'wk-btn wk-btn--sm',
                type: 'button',
                disabled: farms.length === 0
            },
            idleLabel
        );

        if (!farms.length) {
            setFeedback(
                feedback,
                'No active farms are available in your municipality.'
            );
        }

        button.addEventListener('click', async () => {
            if (!selectedFarmId) {
                setFeedback(
                    feedback,
                    'Please select a farm first.',
                    'error'
                );
                return;
            }

            button.disabled = true;
            button.textContent = 'Saving...';

            setFeedback(feedback, '');

            try {
                const { error } = await supabase.rpc(
                    'manager_assign_farm_person',
                    {
                        p_person_id: person.person_id,
                        p_farm_id: selectedFarmId
                    }
                );

                if (error) throw error;

                await loadPeople();

            } catch (error) {
                console.error(
                    'Failed to assign farm personnel:',
                    error
                );

                setFeedback(
                    feedback,
                    getErrorMessage(error),
                    'error'
                );

                button.disabled = farms.length === 0;
                button.textContent = idleLabel;
            }
        });

        return h(
            'tr',
            {},

            h(
                'td',
                { 'data-label': 'Farm Personnel' },

                h(
                    'div',
                    { class: 'wk-person' },

                    h(
                        'span',
                        {
                            class: 'wk-avatar',
                            'aria-hidden': 'true'
                        },
                        initials(person.person_name)
                    ),

                    h(
                        'span',
                        { class: 'wk-person-name' },
                        person.person_name
                    )
                )
            ),

            h(
                'td',
                { 'data-label': 'Farming Arrangement' },

                FARMING_TYPES[person.farming_arrangement] ??
                person.farming_arrangement ??
                '—'
            ),

            h(
                'td',
                { 'data-label': 'Current Farm' },

                person.assigned_farm_name
                    ? h(
                        'div',
                        { class: 'wk-farm' },

                        h(
                            'span',
                            { class: 'wk-farm-name' },
                            person.assigned_farm_name
                        ),

                        h(
                            'span',
                            { class: 'wk-farm-location' },
                            person.assigned_farm_location || ''
                        )
                    )
                    : h(
                        'span',
                        { class: 'wk-muted' },
                        'Not assigned'
                    )
            ),

            h(
                'td',
                { 'data-label': 'Assign to Farm' },

                h(
                    'div',
                    { class: 'wk-assign' },
                    select,
                    button,
                    feedback
                )
            )
        );
    }

    async function loadPeople() {
        peopleHolder.replaceChildren(
            stateMessage('Loading farm personnel...')
        );

        try {
            const [farmsResult, peopleResult] = await Promise.all([
                supabase.rpc('manager_list_authorized_farms'),
                supabase.rpc('manager_list_farm_people')
            ]);

            if (farmsResult.error) {
                throw farmsResult.error;
            }

            if (peopleResult.error) {
                throw peopleResult.error;
            }

            const farms = farmsResult.data ?? [];
            const q = getSearchQuery(ctx);

            const uniquePeople = new Map();

            for (const row of peopleResult.data ?? []) {
                if (
                    !row.person_id ||
                    uniquePeople.has(row.person_id)
                ) {
                    continue;
                }

                uniquePeople.set(row.person_id, {
                    person_id: row.person_id,
                    person_name: row.person_name || 'Unnamed Farmer',
                    farming_arrangement: row.farming_arrangement,
                    assigned_farm_id: row.assigned_farm_id,
                    assigned_farm_name: row.assigned_farm_name,
                    assigned_farm_location: row.assigned_farm_location
                });
            }

            const people = [...uniquePeople.values()]
                .filter((person) =>
                    [
                        person.person_name,
                        FARMING_TYPES[person.farming_arrangement]
                    ]
                        .join(' ')
                        .toLowerCase()
                        .includes(q)
                )
                .sort((a, b) =>
                    a.person_name.localeCompare(b.person_name)
                );

            if (!people.length) {
                peopleHolder.replaceChildren(
                    stateMessage(
                        q
                            ? 'No farm personnel match your search.'
                            : 'No registered farm owners, tenants, or farm workers found.'
                    )
                );
                return;
            }

            peopleHolder.replaceChildren(
                h(
                    'div',
                    { class: 'wk-table-wrap' },

                    h(
                        'table',
                        { class: 'wk-table' },

                        h(
                            'thead',
                            {},

                            h(
                                'tr',
                                {},
                                h('th', {}, 'Farm Personnel'),
                                h('th', {}, 'Farming Arrangement'),
                                h('th', {}, 'Current Farm'),
                                h('th', {}, 'Assign to Farm')
                            )
                        ),

                        h(
                            'tbody',
                            {},
                            people.map((person) =>
                                personRow(person, farms)
                            )
                        )
                    )
                )
            );

        } catch (error) {
            console.error(
                'Failed to load farm personnel:',
                error
            );

            peopleHolder.replaceChildren(
                errorState(
                    `Could not load farm personnel. ${getErrorMessage(error)}`,
                    loadPeople
                )
            );
        }
    }

    /* ============================================================
       INITIAL LOAD + REALTIME SUBSCRIPTION
       ============================================================ */

    await Promise.all([
        loadStaff(),
        loadPeople()
    ]);

    startReplenishmentRealtime();
}
