
import { supabase } from '../connection.js';
import { hasPermission } from '../admin/permissions.js';

const RPC_GET = 'warehouse_officer_get_deliveries';
const RPC_UPDATE = 'warehouse_officer_update_sale_status';
const RPC_CONFIRM_CASH_PAYMENT = 'warehouse_officer_confirm_cash_payment';

const state = {
    orders: [],
    filteredOrders: [],
    selectedOrder: null,
    shipmentSchedule: null,
    loading: false,
    updating: false,
    error: null,
    search: '',
    status: 'all',
    payment: 'all'
};

let rootElement = null;
let realtimeChannel = null;
let realtimeReloadTimer = null;
let realtimeReloadQueued = false;
let deliveryCountdownInterval = null;
let eventController = null;

let canViewDeliveries = false;
let canManageDeliveries = false;

// =====================================================
// CONSTANTS
// =====================================================

const STATUS_LABELS = {
    pending: 'Pending',
    confirmed: 'Confirmed',
    processing: 'Preparing',
    ready_for_shipment: 'Ready for Shipment',
    shipped: 'Shipped',
    delivered: 'Delivered',
    completed: 'Completed',
    cancelled: 'Cancelled'
};

const NEXT_STATUSES = {
    pending: ['confirmed', 'cancelled'],
    confirmed: ['processing', 'cancelled'],
    processing: ['ready_for_shipment'],
    ready_for_shipment: ['shipped'],
    shipped: [],
    delivered: ['completed'],
    completed: [],
    cancelled: []
};

const money = value =>
    new Intl.NumberFormat('en-PH', {
        style: 'currency',
        currency: 'PHP'
    }).format(Number(value || 0));

const dateTime = value => {
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
};

const escapeHTML = value =>
    String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    })[character]);

const statusLabel = status =>
    STATUS_LABELS[status] || status || 'Unknown';

const statusClass = status =>
    String(status || 'pending')
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '');

const getItems = order =>
    Array.isArray(order?.items) ? order.items : [];

const getBuyerDisplay = order =>
    order.business_name || order.buyer_name || 'Unknown Buyer';

// =====================================================
// PERMISSIONS
// =====================================================

async function checkPermissions() {
    const [view, manage] = await Promise.all([
        hasPermission('inventory.view'),
        hasPermission('supplies.issue')
    ]);

    canViewDeliveries = view === true;
    canManageDeliveries = manage === true;

    return canViewDeliveries;
}

async function verifyViewPermission() {
    canViewDeliveries =
        await hasPermission('inventory.view') === true;

    return canViewDeliveries;
}

async function verifyManagePermission() {
    canManageDeliveries =
        await hasPermission('supplies.issue') === true;

    if (!canManageDeliveries) {
        state.error =
            'You do not have permission to manage deliveries or issue supplies.';

        renderPage();
        return false;
    }

    return true;
}

// =====================================================
// DATE AND TIME HELPERS
// =====================================================

function getLocalDateValue(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
}

function getDefaultDeliveryTime() {
    const date = new Date();

    date.setHours(date.getHours() + 1, 0, 0, 0);

    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function hasDeliveryTimeArrived(order) {
    const expectedTime = Date.parse(order?.expected_delivery_at);

    return (
        Number.isFinite(expectedTime) &&
        Date.now() >= expectedTime
    );
}

function getDeliveryRemainingTime(order) {
    const expectedTime = Date.parse(order?.expected_delivery_at);

    if (!Number.isFinite(expectedTime)) return null;

    return Math.max(0, expectedTime - Date.now());
}

function formatDeliveryCountdown(milliseconds) {
    const totalSeconds = Math.floor(milliseconds / 1000);

    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (days > 0) {
        return `${days}d ${hours}h ${minutes}m ${seconds}s`;
    }

    return `${hours}h ${minutes}m ${seconds}s`;
}

// =====================================================
// FILTERS
// =====================================================

function applyFilters() {
    const search = state.search.trim().toLowerCase();

    state.filteredOrders = state.orders.filter(order => {
        const searchable = [
            order.sale_id,
            order.buyer_name,
            order.business_name,
            order.buyer_email,
            order.buyer_phone,
            order.delivery_address,
            ...getItems(order).map(item => item.crop_name)
        ];

        const matchesSearch = !search ||
            searchable.some(value =>
                String(value || '').toLowerCase().includes(search)
            );

        const matchesStatus =
            state.status === 'all' ||
            order.sale_status === state.status;

        const matchesPayment =
            state.payment === 'all' ||
            order.payment_status === state.payment;

        return matchesSearch && matchesStatus && matchesPayment;
    });
}

// =====================================================
// STATISTICS
// =====================================================

function renderStats() {
    const total = state.orders.length;

    const pending = state.orders.filter(
        order => order.sale_status === 'pending'
    ).length;

    const preparing = state.orders.filter(
        order => ['confirmed', 'processing'].includes(order.sale_status)
    ).length;

    const shipping = state.orders.filter(
        order => ['ready_for_shipment', 'shipped'].includes(order.sale_status)
    ).length;

    const delivered = state.orders.filter(
        order => ['delivered', 'completed'].includes(order.sale_status)
    ).length;

    return `
        <section class="delivery-stats">
            <article class="delivery-stat-card">
                <span class="delivery-stat-label">Total Orders</span>
                <strong>${total}</strong>
                <span class="delivery-stat-description">Orders from assigned farm</span>
            </article>

            <article class="delivery-stat-card">
                <span class="delivery-stat-label">Pending Orders</span>
                <strong>${pending}</strong>
                <span class="delivery-stat-description">Awaiting confirmation</span>
            </article>

            <article class="delivery-stat-card">
                <span class="delivery-stat-label">Confirmed / Preparing</span>
                <strong>${preparing}</strong>
                <span class="delivery-stat-description">Orders being prepared</span>
            </article>

            <article class="delivery-stat-card">
                <span class="delivery-stat-label">Ready / Shipped</span>
                <strong>${shipping}</strong>
                <span class="delivery-stat-description">Orders in shipment process</span>
            </article>

            <article class="delivery-stat-card">
                <span class="delivery-stat-label">Delivered / Completed</span>
                <strong>${delivered}</strong>
                <span class="delivery-stat-description">Orders received by buyers</span>
            </article>
        </section>
    `;
}

// =====================================================
// ORDER CARDS
// =====================================================

function renderOrderCard(order) {
    const items = getItems(order);

    const itemSummary = items.map(item =>
        `${escapeHTML(item.crop_name)} (${Number(item.quantity)} ${escapeHTML(item.unit)})`
    ).join(', ');

    return `
        <article class="delivery-order-card">
            <div class="delivery-order-top">
                <div>
                    <span class="delivery-order-reference">
                        ORDER #${escapeHTML(String(order.sale_id || '').slice(0, 8).toUpperCase())}
                    </span>

                    <h3>${escapeHTML(getBuyerDisplay(order))}</h3>

                    <span class="delivery-order-date">
                        ${dateTime(order.created_at)}
                    </span>
                </div>

                <span class="delivery-status delivery-status-${statusClass(order.sale_status)}">
                    ${escapeHTML(statusLabel(order.sale_status))}
                </span>
            </div>

            <div class="delivery-order-info">
                <div>
                    <span class="delivery-info-label">Buyer</span>
                    <strong>${escapeHTML(order.buyer_name || '—')}</strong>
                </div>

                <div>
                    <span class="delivery-info-label">Payment</span>
                    <strong>${escapeHTML(order.payment_status || '—')}</strong>
                </div>

                <div>
                    <span class="delivery-info-label">Payment Type</span>
                    <strong>${escapeHTML(order.payment_type || 'Not specified')}</strong>
                </div>

                <div>
                    <span class="delivery-info-label">Items</span>
                    <strong>${items.length} product(s)</strong>
                </div>
            </div>

            <div class="delivery-order-products">
                <span class="delivery-info-label">Products</span>
                <p>${itemSummary || 'No products found.'}</p>
            </div>

            <div class="delivery-order-bottom">
                <div>
                    <span class="delivery-info-label">Order Total</span>
                    <strong class="delivery-order-total">
                        ${money(order.total_amount)}
                    </strong>
                </div>

                <button
                    type="button"
                    class="delivery-view-button"
                    data-action="view-order"
                    data-order-id="${escapeHTML(order.sale_id)}"
                >
                    View Details
                </button>
            </div>
        </article>
    `;
}

function renderOrderList() {
    if (!state.filteredOrders.length) {
        return `
            <div class="delivery-empty-state">
                <div class="delivery-empty-icon">📦</div>
                <h3>No orders found</h3>
                <p>There are no orders matching your current search or filters.</p>
            </div>
        `;
    }

    return `
        <div class="delivery-order-list">
            ${state.filteredOrders.map(renderOrderCard).join('')}
        </div>
    `;
}

// =====================================================
// ORDER STATUS CONTROL
// =====================================================

function renderStatusControl(order) {
    if (!canManageDeliveries) {
        return `
            <div class="delivery-status-control">
                <label>Order Status</label>
                <p class="delivery-status-hint">
                    View-only access. You cannot update this order.
                </p>
            </div>
        `;
    }

    const allowed = NEXT_STATUSES[order.sale_status] || [];
    const disabled = state.updating || allowed.length === 0;

    const options = [
        `<option value="${escapeHTML(order.sale_status)}" selected>
            ${escapeHTML(statusLabel(order.sale_status))}
        </option>`,

        ...allowed.map(status => `
            <option value="${escapeHTML(status)}">
                ${escapeHTML(statusLabel(status))}
            </option>
        `)
    ].join('');

    return `
        <div class="delivery-status-control">
            <label for="deliveryStatusSelect">Update Order Status</label>

            <select
                id="deliveryStatusSelect"
                class="delivery-status-select"
                data-action="update-status"
                data-order-id="${escapeHTML(order.sale_id)}"
                ${disabled ? 'disabled' : ''}
            >
                ${options}
            </select>

            <p class="delivery-status-hint">
                ${allowed.length
                    ? 'Select the next allowed status.'
                    : order.sale_status === 'shipped'
                        ? 'Payment confirmation is required before this order can be marked as delivered.'
                        : 'This order has reached its final status.'}
            </p>
        </div>
    `;
}

// =====================================================
// PAYMENT CONFIRMATION
// =====================================================

function canConfirmCashPayment(order) {
    return (
        canManageDeliveries &&
        order?.sale_status === 'shipped' &&
        String(order?.payment_status || '').toLowerCase() === 'unpaid' &&
        Number(order?.total_amount) > 0 &&
        hasDeliveryTimeArrived(order)
    );
}

function renderCashPaymentConfirmation(order) {
    if (order?.sale_status !== 'shipped') return '';

    const paymentStatus = String(
        order.payment_status || ''
    ).toLowerCase();

    if (paymentStatus === 'paid') {
        return `
            <div class="delivery-cash-payment-box">
                <div class="delivery-cash-payment-info">
                    <span class="delivery-info-label">Payment</span>
                    <h4>Payment Already Confirmed</h4>
                    <p>This order is already marked as paid.</p>
                </div>
            </div>
        `;
    }

    if (paymentStatus !== 'unpaid') return '';

    const remaining = getDeliveryRemainingTime(order);

    if (remaining === null) {
        return `
            <div class="delivery-cash-payment-box">
                <div class="delivery-cash-payment-info">
                    <h4>Delivery Schedule Unavailable</h4>
                    <p>
                        The expected delivery date and time could not be
                        retrieved. Please check the delivery schedule.
                    </p>
                </div>
            </div>
        `;
    }

    if (!hasDeliveryTimeArrived(order)) {
        return `
            <div class="delivery-cash-payment-box">
                <div class="delivery-cash-payment-info">
                    <span class="delivery-info-label">Payment</span>
                    <h4>Awaiting Expected Delivery Time</h4>

                    <p>
                        Payment confirmation will become available
                        when the scheduled delivery time is reached.
                    </p>

                    <div class="delivery-countdown">
                        <span>Time Remaining</span>
                        <strong data-delivery-countdown>
                            ${formatDeliveryCountdown(remaining)}
                        </strong>
                    </div>

                    <p>
                        Expected Delivery:
                        <strong>${dateTime(order.expected_delivery_at)}</strong>
                    </p>
                </div>
            </div>
        `;
    }

    if (!canManageDeliveries) {
        return `
            <div class="delivery-cash-payment-box">
                <div class="delivery-cash-payment-info">
                    <span class="delivery-info-label">Payment</span>
                    <h4>Awaiting Payment Confirmation</h4>
                    <p>
                        The scheduled delivery time has been reached.
                        You have view-only access and cannot confirm payment.
                    </p>
                    <strong class="delivery-cash-payment-amount">
                        ${money(order.total_amount)}
                    </strong>
                </div>
            </div>
        `;
    }

    return `
        <div class="delivery-cash-payment-box">
            <div class="delivery-cash-payment-info">
                <span class="delivery-info-label">Payment</span>
                <h4>Expected Delivery Time Reached</h4>

                <p>
                    Confirm only after receiving the full payment.
                </p>

                <strong class="delivery-cash-payment-amount">
                    ${money(order.total_amount)}
                </strong>
            </div>

            <button
                type="button"
                class="delivery-payment-confirm-button"
                data-action="confirm-cash-payment"
                data-order-id="${escapeHTML(order.sale_id)}"
                ${state.updating ? 'disabled' : ''}
            >
                ${state.updating ? 'Processing...' : '✓ Payment Received'}
            </button>
        </div>
    `;
}

// =====================================================
// SHIPMENT MODAL
// =====================================================

function renderShipmentModal() {
    const schedule = state.shipmentSchedule;

    if (!schedule || !canManageDeliveries) return '';

    const order = state.orders.find(
        item => item.sale_id === schedule.saleId
    );

    if (!order) return '';

    return `
        <div class="delivery-modal-overlay" data-action="close-shipment-modal">
            <section
                class="delivery-modal delivery-shipment-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="shipment-modal-title"
                data-shipment-modal-content
            >
                <div class="delivery-modal-header">
                    <div>
                        <span class="delivery-order-reference">
                            ORDER #${escapeHTML(String(order.sale_id).slice(0, 8).toUpperCase())}
                        </span>

                        <h2 id="shipment-modal-title">Schedule Shipment</h2>
                    </div>

                    <button
                        type="button"
                        class="delivery-modal-close"
                        data-action="close-shipment-button"
                        aria-label="Close shipment scheduling"
                        ${state.updating ? 'disabled' : ''}
                    >&times;</button>
                </div>

                <form id="shipmentScheduleForm" class="delivery-modal-body">
                    <div class="delivery-shipment-intro">
                        <div class="delivery-shipment-icon">🚚</div>
                        <h3>Ready to dispatch this order?</h3>
                        <p>
                            Set the estimated arrival date and time.
                            The buyer will use this schedule to track the shipment.
                        </p>
                    </div>

                    <div class="delivery-shipment-buyer">
                        <span class="delivery-info-label">Buyer</span>
                        <strong>${escapeHTML(getBuyerDisplay(order))}</strong>

                        <span class="delivery-info-label">Delivery Address</span>
                        <strong>${escapeHTML(order.delivery_address || 'No delivery address provided')}</strong>
                    </div>

                    <div class="delivery-shipment-fields">
                        <div class="delivery-shipment-field">
                            <label for="expectedDeliveryDate">
                                Expected Delivery Date
                            </label>

                            <input
                                type="date"
                                id="expectedDeliveryDate"
                                name="expectedDeliveryDate"
                                class="delivery-shipment-input"
                                min="${getLocalDateValue()}"
                                value="${escapeHTML(schedule.date)}"
                                required
                                ${state.updating ? 'disabled' : ''}
                            >
                        </div>

                        <div class="delivery-shipment-field">
                            <label for="expectedDeliveryTime">
                                Expected Delivery Time
                            </label>

                            <input
                                type="time"
                                id="expectedDeliveryTime"
                                name="expectedDeliveryTime"
                                class="delivery-shipment-input"
                                value="${escapeHTML(schedule.time)}"
                                required
                                ${state.updating ? 'disabled' : ''}
                            >
                        </div>
                    </div>

                    <p class="delivery-status-hint">
                        The expected arrival will be saved to the order and
                        displayed in the buyer's Track Order modal.
                    </p>

                    <div class="delivery-shipment-actions">
                        <button
                            type="button"
                            class="delivery-shipment-cancel"
                            data-action="close-shipment-button"
                            ${state.updating ? 'disabled' : ''}
                        >
                            Cancel
                        </button>

                        <button
                            type="submit"
                            class="delivery-shipment-confirm"
                            ${state.updating ? 'disabled' : ''}
                        >
                            ${state.updating ? 'Saving Shipment...' : 'Confirm Shipment'}
                        </button>
                    </div>
                </form>
            </section>
        </div>
    `;
}

// =====================================================
// ORDER DETAILS MODAL
// =====================================================

function renderModal() {
    const order = state.selectedOrder;

    if (!order) return '';

    const items = getItems(order);

    return `
        <div class="delivery-modal-overlay" data-action="close-modal">
            <section
                class="delivery-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="delivery-modal-title"
                data-modal-content
            >
                <div class="delivery-modal-header">
                    <div>
                        <span class="delivery-order-reference">
                            ORDER #${escapeHTML(order.sale_id)}
                        </span>

                        <h2 id="delivery-modal-title">Order Details</h2>
                    </div>

                    <button
                        type="button"
                        class="delivery-modal-close"
                        data-action="close-modal-button"
                        aria-label="Close order details"
                        ${state.updating ? 'disabled' : ''}
                    >&times;</button>
                </div>

                <div class="delivery-modal-body">
                    <section class="delivery-detail-section">
                        <h3>Order Status Management</h3>

                        <div class="delivery-current-status">
                            <span>Current Status</span>

                            <strong class="delivery-status delivery-status-${statusClass(order.sale_status)}">
                                ${escapeHTML(statusLabel(order.sale_status))}
                            </strong>
                        </div>

                        ${renderStatusControl(order)}

                        ${renderCashPaymentConfirmation(order)}

                        ${order.sale_status === 'processing' ? `
                            <p class="delivery-no-cancel-note">
                                This order is being prepared. Cancellation is no longer allowed.
                            </p>
                        ` : ''}

                        ${order.sale_status === 'ready_for_shipment' ? `
                            <p class="delivery-status-hint">
                                The order has been packed and is ready to be dispatched.
                            </p>
                        ` : ''}

                        ${order.sale_status === 'shipped' ? `
                            <p class="delivery-status-hint">
                                The order has been handed over for delivery and is currently in transit.
                            </p>

                            <div class="delivery-detail-grid">
                                <div>
                                    <span>Shipped At</span>
                                    <strong>${dateTime(order.shipped_at)}</strong>
                                </div>

                                <div>
                                    <span>Expected Delivery</span>
                                    <strong>${dateTime(order.expected_delivery_at)}</strong>
                                </div>
                            </div>
                        ` : ''}
                    </section>

                    <section class="delivery-detail-section">
                        <h3>Buyer Information</h3>

                        <div class="delivery-detail-grid">
                            <div>
                                <span>Buyer Name</span>
                                <strong>${escapeHTML(order.buyer_name || '—')}</strong>
                            </div>

                            <div>
                                <span>Business Name</span>
                                <strong>${escapeHTML(order.business_name || 'Individual Buyer')}</strong>
                            </div>

                            <div>
                                <span>Email</span>
                                <strong>${escapeHTML(order.buyer_email || '—')}</strong>
                            </div>

                            <div>
                                <span>Phone</span>
                                <strong>${escapeHTML(order.buyer_phone || '—')}</strong>
                            </div>

                            <div class="delivery-detail-full">
                                <span>Delivery Address</span>
                                <strong>${escapeHTML(order.delivery_address || '—')}</strong>
                            </div>

                            <div>
                                <span>Buyer Type</span>
                                <strong>${escapeHTML(statusLabel(order.buyer_type || 'individual'))}</strong>
                            </div>
                        </div>
                    </section>

                    <section class="delivery-detail-section">
                        <h3>Order Information</h3>

                        <div class="delivery-detail-grid">
                            <div>
                                <span>Payment Status</span>
                                <strong>${escapeHTML(statusLabel(order.payment_status))}</strong>
                            </div>

                            <div>
                                <span>Payment Type</span>
                                <strong>${escapeHTML(order.payment_type || 'Not specified')}</strong>
                            </div>

                            <div>
                                <span>Amount Paid</span>
                                <strong>${order.amount_paid != null ? money(order.amount_paid) : '—'}</strong>
                            </div>

                            <div>
                                <span>Order Date</span>
                                <strong>${dateTime(order.created_at)}</strong>
                            </div>

                            <div>
                                <span>Paid At</span>
                                <strong>${dateTime(order.paid_at)}</strong>
                            </div>

                            <div>
                                <span>Delivered At</span>
                                <strong>${dateTime(order.delivered_at)}</strong>
                            </div>

                            <div>
                                <span>Completed At</span>
                                <strong>${dateTime(order.completed_at)}</strong>
                            </div>

                            <div>
                                <span>Refunded At</span>
                                <strong>${dateTime(order.refunded_at)}</strong>
                            </div>

                            <div class="delivery-detail-full">
                                <span>Order Notes</span>
                                <strong>${escapeHTML(order.notes || 'No additional notes.')}</strong>
                            </div>
                        </div>
                    </section>

                    <section class="delivery-detail-section">
                        <h3>Ordered Products</h3>

                        <div class="delivery-items-table-wrapper">
                            <table class="delivery-items-table">
                                <thead>
                                    <tr>
                                        <th>Product</th>
                                        <th>Quantity</th>
                                        <th>Unit Price</th>
                                        <th>Subtotal</th>
                                    </tr>
                                </thead>

                                <tbody>
                                    ${items.map(item => `
                                        <tr>
                                            <td>${escapeHTML(item.crop_name)}</td>
                                            <td>${Number(item.quantity)} ${escapeHTML(item.unit)}</td>
                                            <td>${money(item.unit_price)}</td>
                                            <td>${money(item.line_total)}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>

                        <div class="delivery-modal-total">
                            <span>Order Total</span>
                            <strong>${money(order.total_amount)}</strong>
                        </div>
                    </section>
                </div>
            </section>
        </div>
    `;
}

// =====================================================
// PAGE RENDERING
// =====================================================

function renderPage() {
    if (!rootElement) return;

    const farm =
        rootElement.dataset.farmName || 'Assigned Farm';

    rootElement.innerHTML = `
        <main class="deliveries-page">
            <div class="deliveries-heading">
                <div>
                    <span class="deliveries-eyebrow">WAREHOUSE OPERATIONS</span>
                    <h2>Deliveries</h2>
                    <p>Monitor orders from your assigned farm.</p>
                </div>
            </div>

            <div class="delivery-farm-banner">
                <div class="delivery-farm-icon">🌾</div>
                <div>
                    <span>Assigned Farm</span>
                    <strong>${escapeHTML(farm)}</strong>
                </div>
            </div>

            ${renderStats()}

            <section class="delivery-content">
                <div class="delivery-content-heading">
                    <div>
                        <h3>Customer Orders</h3>
                        <p>Orders containing products from your assigned farm.</p>
                    </div>

                    <button
                        type="button"
                        class="delivery-refresh-button"
                        data-action="refresh"
                        ${state.loading || state.updating ? 'disabled' : ''}
                    >
                        ${state.loading ? 'Loading...' : '↻ Refresh'}
                    </button>
                </div>

                <div class="delivery-toolbar">
                    <input
                        type="search"
                        class="delivery-search"
                        id="deliverySearch"
                        placeholder="Search order, buyer, or product..."
                        value="${escapeHTML(state.search)}"
                    >

                    <select class="delivery-filter" id="deliveryStatusFilter">
                        <option value="all">All Order Statuses</option>

                        ${Object.entries(STATUS_LABELS).map(([value, label]) => `
                            <option
                                value="${value}"
                                ${state.status === value ? 'selected' : ''}
                            >
                                ${label}
                            </option>
                        `).join('')}
                    </select>

                    <select class="delivery-filter" id="deliveryPaymentFilter">
                        <option value="all">All Payment Statuses</option>

                        ${['unpaid', 'paid', 'refunded'].map(status => `
                            <option
                                value="${status}"
                                ${state.payment === status ? 'selected' : ''}
                            >
                                ${statusLabel(status)}
                            </option>
                        `).join('')}
                    </select>
                </div>

                ${!canManageDeliveries ? `
                    <p class="delivery-status-hint">
                        View-only access. You can inspect orders but cannot update delivery statuses or payments.
                    </p>
                ` : ''}

                ${state.error
                    ? `<div class="delivery-error">${escapeHTML(state.error)}</div>`
                    : ''}

                <div class="delivery-results-count">
                    Showing ${state.filteredOrders.length} of ${state.orders.length} orders
                </div>

                ${state.loading && !state.orders.length
                    ? '<div class="delivery-loading">Loading orders...</div>'
                    : renderOrderList()}
            </section>
        </main>

        ${renderModal()}
        ${renderShipmentModal()}
    `;

    bindPageEvents();
    startDeliveryCountdown();
}

// =====================================================
// PAGE EVENTS
// =====================================================

function bindPageEvents() {
    eventController?.abort();

    eventController = new AbortController();

    const { signal } = eventController;

    rootElement.querySelector('#deliverySearch')
        ?.addEventListener('input', event => {
            state.search = event.target.value;

            const cursor = event.target.selectionStart;

            applyFilters();
            renderPage();

            const nextInput =
                rootElement.querySelector('#deliverySearch');

            nextInput?.focus();
            nextInput?.setSelectionRange(cursor, cursor);
        }, { signal });

    rootElement.querySelector('#deliveryStatusFilter')
        ?.addEventListener('change', event => {
            state.status = event.target.value;

            applyFilters();
            renderPage();
        }, { signal });

    rootElement.querySelector('#deliveryPaymentFilter')
        ?.addEventListener('change', event => {
            state.payment = event.target.value;

            applyFilters();
            renderPage();
        }, { signal });

    rootElement.querySelectorAll('[data-action="view-order"]')
        .forEach(button => {
            button.addEventListener('click', () => {
                state.selectedOrder = state.orders.find(
                    order => order.sale_id === button.dataset.orderId
                ) || null;

                state.error = null;
                renderPage();
            }, { signal });
        });

    rootElement.querySelector('[data-action="refresh"]')
        ?.addEventListener('click', () => loadOrders(), { signal });

    rootElement.querySelector('[data-action="close-modal-button"]')
        ?.addEventListener('click', closeModal, { signal });

    rootElement.querySelector('[data-action="close-modal"]')
        ?.addEventListener('click', event => {
            if (event.target === event.currentTarget) {
                closeModal();
            }
        }, { signal });

    rootElement.querySelector('#deliveryStatusSelect')
        ?.addEventListener('change', handleStatusChange, { signal });

    rootElement.querySelector('[data-action="confirm-cash-payment"]')
        ?.addEventListener('click', handleCashPaymentConfirmation, { signal });

    rootElement.querySelectorAll('[data-action="close-shipment-button"]')
        .forEach(button => {
            button.addEventListener('click', closeShipmentModal, { signal });
        });

    rootElement.querySelector('[data-action="close-shipment-modal"]')
        ?.addEventListener('click', event => {
            if (event.target === event.currentTarget) {
                closeShipmentModal();
            }
        }, { signal });

    rootElement.querySelector('#shipmentScheduleForm')
        ?.addEventListener('submit', handleShipmentScheduleSubmit, { signal });
}

// =====================================================
// LIVE DELIVERY COUNTDOWN
// =====================================================

function startDeliveryCountdown() {
    stopDeliveryCountdown();

    const order = state.selectedOrder;

    if (
        !order ||
        order.sale_status !== 'shipped' ||
        String(order.payment_status || '').toLowerCase() !== 'unpaid' ||
        !rootElement?.querySelector('[data-delivery-countdown]')
    ) {
        return;
    }

    deliveryCountdownInterval = setInterval(() => {
        const countdown = rootElement?.querySelector(
            '[data-delivery-countdown]'
        );

        if (!countdown) {
            stopDeliveryCountdown();
            return;
        }

        const remaining = getDeliveryRemainingTime(order);

        if (remaining === null || remaining <= 0) {
            stopDeliveryCountdown();

            // Re-render once the scheduled delivery time is reached.
            // This reveals the payment confirmation button when permitted.
            renderPage();
            return;
        }

        countdown.textContent =
            formatDeliveryCountdown(remaining);

    }, 1000);
}

function stopDeliveryCountdown() {
    if (deliveryCountdownInterval !== null) {
        clearInterval(deliveryCountdownInterval);
        deliveryCountdownInterval = null;
    }
}

// =====================================================
// MODAL CONTROLS
// =====================================================

function closeModal() {
    if (state.updating) return;

    state.selectedOrder = null;
    state.error = null;

    renderPage();
}

function closeShipmentModal() {
    if (state.updating) return;

    state.shipmentSchedule = null;
    state.error = null;

    renderPage();
}

// =====================================================
// CONFIRM PAYMENT
// =====================================================

async function handleCashPaymentConfirmation(event) {
    if (state.updating) return;

    if (!(await verifyManagePermission())) return;

    const saleId = event.currentTarget.dataset.orderId;

    const order = state.orders.find(
        item => item.sale_id === saleId
    );

    if (!order || !canConfirmCashPayment(order)) {
        state.error =
            'This order is not eligible for payment confirmation. Check its status, payment status, and expected delivery time.';

        renderPage();
        return;
    }

    const confirmed = window.confirm(
        `Confirm that the full payment of ${money(order.total_amount)} has been received?\n\n` +
        `Order: #${String(order.sale_id).slice(0, 8).toUpperCase()}\n` +
        `Buyer: ${getBuyerDisplay(order)}\n\n` +
        `This will mark the payment as PAID and the order as DELIVERED.\n` +
        `Partial payment is not allowed.\n\nContinue?`
    );

    if (!confirmed) return;

    state.updating = true;
    state.error = null;

    renderPage();

    try {
        const { data, error } = await supabase.rpc(
            RPC_CONFIRM_CASH_PAYMENT,
            {
                p_sale_id: saleId
            }
        );

        console.log('[Payment Confirmation] RPC data:', data);
        console.log('[Payment Confirmation] RPC error:', error);

        if (error) throw error;

        if (!data?.success) {
            throw new Error(
                data?.message || 'Unable to confirm payment.'
            );
        }

        await loadOrders();

        state.selectedOrder = state.orders.find(
            item => item.sale_id === saleId
        ) || null;

        state.error = null;

    } catch (error) {
        console.error('Payment confirmation failed:', error);

        state.error =
            error.message || 'Failed to confirm payment.';

        await loadOrders();

        state.selectedOrder = state.orders.find(
            item => item.sale_id === saleId
        ) || null;

    } finally {
        state.updating = false;

        renderPage();

        if (realtimeReloadQueued) {
            realtimeReloadQueued = false;
            scheduleRealtimeReload();
        }
    }
}

// =====================================================
// UPDATE ORDER STATUS
// =====================================================

async function handleStatusChange(event) {
    if (state.updating) return;

    if (!(await verifyManagePermission())) return;

    const select = event.currentTarget;
    const saleId = select.dataset.orderId;
    const newStatus = select.value;

    const order = state.orders.find(
        item => item.sale_id === saleId
    );

    if (!order || !newStatus || newStatus === order.sale_status) {
        return;
    }

    if (!NEXT_STATUSES[order.sale_status]?.includes(newStatus)) {
        state.error = 'This status transition is not allowed.';
        renderPage();
        return;
    }

    if (newStatus === 'shipped') {
        state.error = null;

        state.shipmentSchedule = {
            saleId,
            date: getLocalDateValue(),
            time: getDefaultDeliveryTime()
        };

        renderPage();
        return;
    }

    if (newStatus === 'cancelled') {
        if (!window.confirm(
            'Are you sure you want to cancel this order? This action cannot be undone.'
        )) {
            renderPage();
            return;
        }
    } else {
        const messages = {
            confirmed: 'Confirm this order?',
            processing: 'Move this order to Preparing?',
            ready_for_shipment: 'Mark this order as Ready for Shipment?',
            completed: 'Mark this order as Completed?'
        };

        if (!window.confirm(
            messages[newStatus] || 'Update this order status?'
        )) {
            renderPage();
            return;
        }
    }

    await updateOrderStatus(saleId, newStatus);
}

// =====================================================
// SHIPMENT SCHEDULE
// =====================================================

async function handleShipmentScheduleSubmit(event) {
    event.preventDefault();

    if (state.updating || !state.shipmentSchedule) return;

    if (!(await verifyManagePermission())) return;

    const form = event.currentTarget;

    const date = form.querySelector('#expectedDeliveryDate')?.value;
    const time = form.querySelector('#expectedDeliveryTime')?.value;

    if (!date || !time) {
        state.error =
            'Please provide the expected delivery date and time.';

        renderPage();
        return;
    }

    const expectedDate = new Date(`${date}T${time}:00`);

    if (Number.isNaN(expectedDate.getTime())) {
        state.error = 'Invalid expected delivery date or time.';
        renderPage();
        return;
    }

    if (expectedDate.getTime() <= Date.now()) {
        state.error = 'Expected delivery must be in the future.';
        renderPage();
        return;
    }

    const saleId = state.shipmentSchedule.saleId;

    if (!window.confirm(
        `Confirm shipment?\n\nExpected delivery: ${dateTime(expectedDate.toISOString())}`
    )) {
        return;
    }

    await updateOrderStatus(
        saleId,
        'shipped',
        expectedDate.toISOString()
    );
}

// =====================================================
// SUPABASE ORDER STATUS UPDATE
// =====================================================

async function updateOrderStatus(
    saleId,
    newStatus,
    expectedDeliveryAt = null
) {
    if (state.updating) return;

    if (!(await verifyManagePermission())) return;

    state.updating = true;
    state.error = null;

    renderPage();

    try {
        const rpcParams = {
            p_sale_id: saleId,
            p_new_status: newStatus
        };

        if (newStatus === 'shipped') {
            rpcParams.p_expected_delivery_at = expectedDeliveryAt;
        }

        const { data, error } = await supabase.rpc(
            RPC_UPDATE,
            rpcParams
        );

        if (error) throw error;

        if (!data?.success) {
            throw new Error(
                data?.message || 'Unable to update order status.'
            );
        }

        state.shipmentSchedule = null;

        await loadOrders();

        state.selectedOrder = state.orders.find(
            order => order.sale_id === saleId
        ) || null;

        state.error = null;

    } catch (error) {
        console.error('Order status update failed:', error);

        state.error =
            error.message || 'Failed to update order status.';

        await loadOrders();

        state.selectedOrder = state.orders.find(
            order => order.sale_id === saleId
        ) || null;

    } finally {
        state.updating = false;

        renderPage();

        if (realtimeReloadQueued) {
            realtimeReloadQueued = false;
            scheduleRealtimeReload();
        }
    }
}

// =====================================================
// LOAD ORDERS
// =====================================================

async function loadOrders({ silent = false } = {}) {
    if (!rootElement || !canViewDeliveries) return;

    if (state.loading) {
        realtimeReloadQueued = true;
        return;
    }

    if (!(await verifyViewPermission())) {
        state.orders = [];
        state.filteredOrders = [];

        state.error =
            'You no longer have permission to view deliveries.';

        renderPage();
        return;
    }

    const selectedId =
        state.selectedOrder?.sale_id || null;

    state.loading = true;

    if (!silent) {
        renderPage();
    }

    try {
        const { data, error } = await supabase.rpc(RPC_GET);

        if (error) throw error;

        if (!data?.success) {
            throw new Error(
                data?.message || 'Unable to retrieve assigned farm orders.'
            );
        }

        state.orders = Array.isArray(data.orders)
            ? data.orders
            : [];

        if (selectedId) {
            state.selectedOrder = state.orders.find(
                order => order.sale_id === selectedId
            ) || null;
        }

        applyFilters();

    } catch (error) {
        console.error('Deliveries loading failed:', error);

        state.error =
            error.message || 'Failed to load deliveries.';

        if (!silent) {
            state.orders = [];
            state.filteredOrders = [];
        }

    } finally {
        state.loading = false;

        renderPage();

        if (realtimeReloadQueued && !state.updating) {
            realtimeReloadQueued = false;
            scheduleRealtimeReload();
        }
    }
}

// =====================================================
// REALTIME
// =====================================================

function subscribeToOrderChanges() {
    if (realtimeChannel) {
        supabase.removeChannel(realtimeChannel);
        realtimeChannel = null;
    }

    realtimeChannel = supabase
        .channel('warehouse-deliveries-realtime')
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'warehouse_sales'
            },
            () => scheduleRealtimeReload()
        )
        .subscribe(status => {
            if (status === 'SUBSCRIBED') {
                console.info('[Deliveries] Realtime connected.');
            }

            if (
                status === 'CHANNEL_ERROR' ||
                status === 'TIMED_OUT'
            ) {
                console.error(
                    '[Deliveries] Realtime connection:',
                    status
                );
            }
        });
}

function scheduleRealtimeReload() {
    clearTimeout(realtimeReloadTimer);

    realtimeReloadTimer = setTimeout(() => {
        if (!rootElement || !canViewDeliveries) return;

        if (state.loading || state.updating) {
            realtimeReloadQueued = true;
            return;
        }

        loadOrders({ silent: true });
    }, 300);
}

// =====================================================
// INITIALIZATION
// =====================================================

export async function render(root, ctx = {}) {
    rootElement = root;

    // Reset previous page resources if render is called again.
    stopDeliveryCountdown();

    eventController?.abort();
    eventController = null;

    clearTimeout(realtimeReloadTimer);
    realtimeReloadTimer = null;
    realtimeReloadQueued = false;

    const allowed = await checkPermissions();

    if (!allowed) {
        rootElement.replaceChildren(
            Object.assign(document.createElement('p'), {
                className: 'msg error',
                textContent: 'You do not have permission to view deliveries.'
            })
        );

        return;
    }

    const farm = ctx.assignedFarm || {};

    rootElement.dataset.farmName = [
        farm.farm_name,
        farm.farm_location
    ].filter(Boolean).join(' • ') || 'Assigned Farm';

    state.search = ctx.query || '';
    state.error = null;
    state.shipmentSchedule = null;
    state.selectedOrder = null;
    state.loading = false;
    state.updating = false;

    applyFilters();
    renderPage();

    subscribeToOrderChanges();

    await loadOrders();
}

// =====================================================
// CLEANUP
// =====================================================

export function cleanup() {
    clearTimeout(realtimeReloadTimer);

    realtimeReloadTimer = null;
    realtimeReloadQueued = false;

    stopDeliveryCountdown();

    eventController?.abort();
    eventController = null;

    if (realtimeChannel) {
        supabase.removeChannel(realtimeChannel);
        realtimeChannel = null;
    }

    rootElement = null;

    state.orders = [];
    state.filteredOrders = [];
    state.selectedOrder = null;
    state.shipmentSchedule = null;

    state.loading = false;
    state.updating = false;
    state.error = null;

    state.search = '';
    state.status = 'all';
    state.payment = 'all';

    canViewDeliveries = false;
    canManageDeliveries = false;
}
