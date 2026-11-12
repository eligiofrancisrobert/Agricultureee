
import { supabase } from '../connection.js';

const TABLE_SALES = 'warehouse_sales';
const TABLE_ITEMS = 'warehouse_sale_items';
const CANCEL_ORDER_RPC = 'buyer_cancel_sale';

const state = {
  buyerId: null,
  orders: [],
  filteredOrders: [],
  itemsBySale: new Map(),
  selectedOrder: null,
  loading: false,
  cancelling: false,
  selectedTrackingSaleId: null,
};

let realtimeChannel = null;
let realtimeReloadTimer = null;
let realtimeReloadQueued = false;
let countdownTimer = null;

function subscribeToBuyerOrderChanges() {
  if (!state.buyerId) return;

  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }

  realtimeChannel = supabase
    .channel(`buyer-orders-${state.buyerId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: TABLE_SALES,
        filter: `buyer_id=eq.${state.buyerId}`,
      },
      () => {
        scheduleBuyerRealtimeReload();
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.info('[Buyer Orders] Realtime connected.');
      }

      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error('[Buyer Orders] Realtime connection:', status);
      }
    });
}

function scheduleBuyerRealtimeReload() {
  window.clearTimeout(realtimeReloadTimer);

  realtimeReloadTimer = window.setTimeout(() => {
    if (state.loading) {
      realtimeReloadQueued = true;
      return;
    }

    loadOrders({ silent: true });
  }, 300);
}

function cleanupBuyerRealtime() {
  window.clearTimeout(realtimeReloadTimer);
  realtimeReloadTimer = null;
  realtimeReloadQueued = false;

  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}

const el = {
  todayLabel: document.getElementById('todayLabel'),
  userName: document.getElementById('userName'),
  userInitial: document.getElementById('userInitial'),
  logoutBtn: document.getElementById('logoutBtn'),

  mobileMenuBtn: document.getElementById('mobileMenuBtn'),
  sidebar: document.getElementById('sidebar'),

  totalOrders: document.getElementById('totalOrders'),
  pendingOrders: document.getElementById('pendingOrders'),
  processingOrders: document.getElementById('processingOrders'),
  completedOrders: document.getElementById('completedOrders'),

  search: document.getElementById('orderSearch'),
  statusFilter: document.getElementById('statusFilter'),
  refreshBtn: document.getElementById('refreshBtn'),

  loading: document.getElementById('loadingState'),
  error: document.getElementById('errorMessage'),
  ordersList: document.getElementById('ordersList'),

  empty: document.getElementById('emptyState'),
  emptyTitle: document.getElementById('emptyTitle'),
  emptyMessage: document.getElementById('emptyMessage'),

  modal: document.getElementById('orderModal'),
  modalOrderId: document.getElementById('modalOrderId'),
  modalOrderDate: document.getElementById('modalOrderDate'),
  modalBody: document.getElementById('modalBody'),
  closeModalBtn: document.getElementById('closeModalBtn'),
  modalDoneBtn: document.getElementById('modalDoneBtn'),

  toastStack: document.getElementById('toastStack'),
};

const peso = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 2,
});

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}

function formatMoney(value) {
  return peso.format(Number(value) || 0);
}

function formatDate(value, includeTime = false) {
  if (!value) return 'Not available';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Not available';
  }

  return new Intl.DateTimeFormat('en-PH', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    ...(includeTime
      ? {
        hour: 'numeric',
        minute: '2-digit',
      }
      : {}),
  }).format(date);
}

function formatStatus(value) {
  const status = normalize(value);

  const labels = {
    pending: 'Pending',
    confirmed: 'Confirmed',
    processing: 'Preparing',
    ready_for_shipment: 'Ready for Shipment',
    shipped: 'Shipped',
    delivered: 'Delivered',
    completed: 'Completed',
    cancelled: 'Cancelled'
  };

  return labels[status] || (value || 'Unknown');
}

function formatPaymentStatus(value) {
  const status = normalize(value);

  const labels = {
    unpaid: 'Unpaid',
    paid: 'Paid',
    refunded: 'Refunded',
  };

  return labels[status] || (value || 'Unknown');
}

function formatPaymentType(value) {
  const type = normalize(value);

  if (type === 'e-payment') return 'E-payment';
  if (type === 'cash') return 'Cash';

  return value || 'Not specified';
}

function getStatusClass(value) {
  const status = normalize(value);

  const allowed = [
    'pending',
    'confirmed',
    'processing',
    'ready_for_shipment',
    'shipped',
    'delivered',
    'completed',
    'cancelled',
  ];

  return allowed.includes(status) ? `status-${status}` : 'status-pending';
}

function getPaymentClass(value) {
  const status = normalize(value);

  const allowed = ['paid', 'unpaid', 'refunded'];

  return allowed.includes(status)
    ? `payment-${status}`
    : 'payment-unknown';
}

function showToast(message) {
  const toast = document.createElement('div');

  toast.className = 'order-toast';
  toast.textContent = message;

  el.toastStack.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
  }, 3000);
}

function showError(message) {
  el.error.textContent = message;
  el.error.hidden = false;
}

function hideError() {
  el.error.hidden = true;
  el.error.textContent = '';
}

function setLoading(loading) {
  state.loading = loading;
  el.loading.hidden = !loading;
  el.refreshBtn.disabled = loading;

  if (loading) {
    el.ordersList.hidden = true;
    el.empty.hidden = true;
  }
}

function setToday() {
  el.todayLabel.textContent = new Intl.DateTimeFormat('en-PH', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date());
}

async function loadBuyer() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) throw error;

  if (!user) {
    window.location.replace('../../login.html');
    return null;
  }

  state.buyerId = user.id;

  const metadata = user.user_metadata || {};

  const displayName =
    metadata.full_name ||
    metadata.fullName ||
    metadata.name ||
    user.email ||
    'Buyer';

  el.userName.textContent = displayName;
  el.userInitial.textContent =
    displayName.trim().charAt(0).toUpperCase() || 'B';

  return user;
}

/** Fetch the buyer's sales and items, optionally suppressing refresh loading UI. */
async function loadOrders({ silent = false } = {}) {
  if (!state.buyerId) return;

  if (state.loading) {
    realtimeReloadQueued = true;
    return;
  }

  const selectedOrderId = state.selectedOrder?.sale_id || null;
  const selectedTrackingId = state.selectedTrackingSaleId;

  state.loading = true;

  if (!silent) {
    setLoading(true);
  } else {
    hideError();
  }

  try {
    const { data: sales, error: salesError } = await supabase
      .from(TABLE_SALES)
      .select(`
        sale_id,
        buyer_id,
        sale_status,
        payment_status,
        payment_type,
        total_amount,
        amount_paid,
        shipped_at,
        expected_delivery_at,
        paid_at,
        notes,
        created_at,
        updated_at,
        refunded_at,
        delivered_at,
        completed_at
      `)
      .eq('buyer_id', state.buyerId)
      .order('created_at', { ascending: false });

    if (salesError) throw salesError;

    const orders = sales || [];

    state.orders = orders;
    state.itemsBySale.clear();

    if (orders.length > 0) {
      const saleIds = orders.map(order => order.sale_id);

      const { data: items, error: itemsError } = await supabase
        .from(TABLE_ITEMS)
        .select(`
          sale_item_id,
          sale_id,
          produce_id,
          farm_id,
          crop_name,
          quantity,
          unit,
          unit_price,
          line_total,
          created_at
        `)
        .in('sale_id', saleIds)
        .order('created_at', { ascending: true });

      if (itemsError) throw itemsError;

      for (const item of items || []) {
        if (!state.itemsBySale.has(item.sale_id)) {
          state.itemsBySale.set(item.sale_id, []);
        }

        state.itemsBySale.get(item.sale_id).push(item);
      }
    }

    updateSummary();
    applyFilters();

    // Refresh the currently open Order Details modal.
    if (selectedOrderId) {
      const updatedOrder = state.orders.find(
        order => String(order.sale_id) === String(selectedOrderId)
      );

      if (updatedOrder) {
        openOrderDetails(selectedOrderId);
      } else {
        closeOrderDetails();
      }
    }

    // Refresh the currently open Tracking modal.
    if (selectedTrackingId) {
      const updatedTrackingOrder = state.orders.find(
        order => String(order.sale_id) === String(selectedTrackingId)
      );

      if (
        updatedTrackingOrder &&
        normalize(updatedTrackingOrder.sale_status) === 'shipped'
      ) {
        renderTrackingModal(updatedTrackingOrder);
      } else {
        closeTrackingModal();
      }
    }

  } catch (error) {
    console.error('My Orders load failed:', error);

    showError(
      error?.message ||
      'Unable to load your orders. Please refresh the page.'
    );

    if (!silent) {
      el.ordersList.hidden = true;
      el.empty.hidden = true;
    }

  } finally {
    state.loading = false;

    if (!silent) {
      setLoading(false);
    }

    if (realtimeReloadQueued) {
      realtimeReloadQueued = false;
      scheduleBuyerRealtimeReload();
    }
  }
}

function updateSummary() {
  const orders = state.orders;

  el.totalOrders.textContent = orders.length;

  el.pendingOrders.textContent = orders.filter(
    (order) => normalize(order.sale_status) === 'pending'
  ).length;

  el.processingOrders.textContent = orders.filter(
    (order) => normalize(order.sale_status) === 'processing'
  ).length;

  el.completedOrders.textContent = orders.filter(
    (order) => normalize(order.sale_status) === 'completed'
  ).length;
}

function getOrderItems(order) {
  return state.itemsBySale.get(order.sale_id) || [];
}

function getProductSearchText(order) {
  return getOrderItems(order)
    .map((item) => item.crop_name || '')
    .join(' ')
    .toLowerCase();
}

function createOrderCard(order) {
  const items = getOrderItems(order);
  const itemCount = items.length;

  const productNames = items.map(
    item => item.crop_name || 'Unnamed produce'
  );

  const previewNames = productNames.slice(0, 3).join(', ');
  const remaining = Math.max(0, productNames.length - 3);

  const productPreview = previewNames
    ? `${previewNames}${remaining ? ` + ${remaining} more` : ''}`
    : 'No order items found';

  const status = normalize(order.sale_status);
  const paymentStatus = normalize(order.payment_status);
  const isShipped = status === 'shipped';

  return `
    <article class="order-card">
      <div class="order-card-top">
        <div>
          <div class="order-reference">
            Order #${escapeHTML(order.sale_id)}
          </div>
          <span class="order-date">
            Placed on ${escapeHTML(formatDate(order.created_at, true))}
          </span>
        </div>

        <div class="order-badges">
          <span class="status-badge ${getStatusClass(status)}">
            ${escapeHTML(formatStatus(status))}
          </span>
          <span class="payment-badge ${getPaymentClass(paymentStatus)}">
            ${escapeHTML(formatPaymentStatus(paymentStatus))}
          </span>
        </div>
      </div>

      <div class="order-card-middle">
        <div class="order-products">
          <strong>${itemCount} ${itemCount === 1 ? 'product' : 'products'}</strong>
          <span>${escapeHTML(productPreview)}</span>
        </div>

        <div class="order-total">
          <span>Order Total</span>
          <strong>${formatMoney(order.total_amount)}</strong>
        </div>
      </div>

      ${isShipped ? `
  <div class="order-payment-reminder ${paymentStatus === 'paid' ? 'is-paid' :
        paymentStatus === 'refunded' ? 'is-refunded' : ''
      }">
    <span class="payment-reminder-icon">
      ${paymentStatus === 'paid' ? '✓' :
        paymentStatus === 'refunded' ? '↩' : '₱'
      }
    </span>

    <div>
      <strong>
        ${paymentStatus === 'paid' ? 'Payment received' :
        paymentStatus === 'refunded' ? 'Payment refunded' :
          'Payment reminder'
      }
      </strong>

      <span>
        ${paymentStatus === 'paid'
        ? 'Your payment has been recorded.'
        : paymentStatus === 'refunded'
          ? 'This order is marked as refunded.'
          : `Please prepare ${formatMoney(order.total_amount)} for ${escapeHTML(formatPaymentType(order.payment_type))}.`
      }
      </span>
    </div>
  </div>
` : ''}

      <div class="order-card-bottom">
        <span class="payment-method">
          Payment: ${escapeHTML(formatPaymentType(order.payment_type))}
        </span>

        <div class="order-card-actions">
          ${isShipped ? `
            <button
              type="button"
              class="track-order-btn"
              data-track-sale-id="${escapeHTML(order.sale_id)}"
            >
              ⌖ Track Order
            </button>
          ` : ''}

          <button
            type="button"
            class="view-details-btn"
            data-sale-id="${escapeHTML(order.sale_id)}"
          >
            View Details →
          </button>
        </div>
      </div>
    </article>
  `;
}

function renderOrders(orders) {
  el.ordersList.innerHTML = '';

  if (!orders.length) {
    el.ordersList.hidden = true;
    el.empty.hidden = false;

    if (state.orders.length === 0) {
      el.emptyTitle.textContent = 'No orders yet';
      el.emptyMessage.textContent =
        'Your submitted orders will appear here.';
    } else {
      el.emptyTitle.textContent = 'No matching orders';
      el.emptyMessage.textContent =
        'Try changing your search or status filter.';
    }

    return;
  }

  el.ordersList.innerHTML = orders
    .map(createOrderCard)
    .join('');

  el.ordersList.hidden = false;
  el.empty.hidden = true;
}

function applyFilters() {
  const searchTerm = normalize(el.search.value);
  const statusFilter = normalize(el.statusFilter.value);

  const filtered = state.orders.filter((order) => {
    const matchesStatus =
      statusFilter === 'all' ||
      normalize(order.sale_status) === statusFilter;

    const searchable = [
      order.sale_id,
      order.sale_status,
      order.payment_status,
      order.payment_type,
      getProductSearchText(order),
    ].join(' ').toLowerCase();

    return matchesStatus && searchable.includes(searchTerm);
  });

  state.filteredOrders = filtered;

  renderOrders(filtered);
}

function createDetailField(label, value) {
  return `
    <div class="detail-field">
      <span>${escapeHTML(label)}</span>
      <strong>${escapeHTML(value)}</strong>
    </div>
  `;
}

function canBuyerCancelOrder(order) {
  return ['pending', 'confirmed'].includes(
    normalize(order?.sale_status)
  );
}

function createCancellationSection(order) {
  if (!canBuyerCancelOrder(order)) {
    return '';
  }

  return `
    <section class="detail-section cancellation-section">
      <h3>Cancel Order</h3>

      <p>
        You may cancel this order while it is still Pending or Confirmed.
        Once the order is being prepared, cancellation will no longer be available.
      </p>

      <button
        type="button"
        class="cancel-order-btn"
        id="cancelOrderBtn"
        data-sale-id="${escapeHTML(order.sale_id)}"
        ${state.cancelling ? 'disabled' : ''}
      >
        Cancel Order
      </button>
    </section>
  `;
}

function ensureTrackingModal() {
  let modal = document.getElementById('trackingModal');

  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'trackingModal';
  modal.className = 'tracking-modal-overlay';
  modal.hidden = true;

  modal.innerHTML = `
    <section class="tracking-modal" role="dialog" aria-modal="true">
      <header class="tracking-modal-header">
        <div>
          <span class="tracking-eyebrow">TANIKALA DELIVERY</span>
          <h2>Track Your Order</h2>
          <p id="trackingOrderReference"></p>
        </div>
        <button type="button" id="closeTrackingBtn" class="tracking-close-btn">×</button>
      </header>

      <div id="trackingModalBody" class="tracking-modal-body"></div>

      <footer class="tracking-modal-footer">
        <span>Grow together, from farm to table.</span>
      </footer>
    </section>
  `;

  document.body.appendChild(modal);

  modal.addEventListener('click', event => {
    if (event.target === modal) closeTrackingModal();
  });

  modal.querySelector('#closeTrackingBtn')
    .addEventListener('click', closeTrackingModal);

  modal.querySelector('#trackingDoneBtn')
    .addEventListener('click', closeTrackingModal);

  return modal;
}

function getCountdownMarkup(expectedAt) {
  if (!expectedAt) {
    return `
      <div class="tracking-no-estimate">
        Delivery schedule unavailable.
      </div>
    `;
  }

  const difference = new Date(expectedAt).getTime() - Date.now();

  if (!Number.isFinite(difference)) {
    return '<div class="tracking-no-estimate">Invalid delivery schedule.</div>';
  }

  if (difference <= 0) {
    return `
      <div class="tracking-arrival-state">
        <strong>Expected arrival time reached!</strong>
        <span>Your produce may arrive shortly. Please stay available.</span>
      </div>
    `;
  }

  const days = Math.floor(difference / 86400000);
  const hours = Math.floor((difference % 86400000) / 3600000);
  const minutes = Math.floor((difference % 3600000) / 60000);
  const seconds = Math.floor((difference % 60000) / 1000);

  return `
    <div class="tracking-countdown">
      ${days ? `
        <div class="countdown-unit">
          <strong>${String(days).padStart(2, '0')}</strong>
          <span>Days</span>
        </div>
      ` : ''}

      <div class="countdown-unit">
        <strong>${String(hours).padStart(2, '0')}</strong>
        <span>Hours</span>
      </div>

      <div class="countdown-unit">
        <strong>${String(minutes).padStart(2, '0')}</strong>
        <span>Minutes</span>
      </div>

      <div class="countdown-unit countdown-seconds">
        <strong>${String(seconds).padStart(2, '0')}</strong>
        <span>Seconds</span>
      </div>
    </div>
  `;
}

function updateTrackingCountdown(expectedAt) {
  const container = document.getElementById('trackingCountdown');

  if (container) {
    container.innerHTML = getCountdownMarkup(expectedAt);
  }
}

function renderTrackingModal(order) {
  const modal = ensureTrackingModal();

  state.selectedTrackingSaleId = order.sale_id;

  const expectedAt = order.expected_delivery_at;

  const paymentStatus = normalize(order.payment_status);

  let paymentReminder = '';

  if (paymentStatus === 'paid') {
    paymentReminder = `
      <div class="tracking-payment-reminder is-paid">
        <strong>✓ Payment received</strong>
        <p>Your payment of ${formatMoney(order.total_amount)} has been recorded.</p>
      </div>
    `;
  } else if (paymentStatus === 'refunded') {
    paymentReminder = `
      <div class="tracking-payment-reminder is-refunded">
        <strong>Payment refunded</strong>
        <p>This order is marked as refunded.</p>
      </div>
    `;
  } else {
    paymentReminder = `
      <div class="tracking-payment-reminder">
        <strong>₱ Payment reminder</strong>
        <p>
          Your order is on its way. Please prepare the exact order amount
          before the delivery arrives.
        </p>
        <strong class="tracking-payment-amount">
          ${formatMoney(order.total_amount)}
        </strong>
        <span>Payment method: ${escapeHTML(formatPaymentType(order.payment_type))}</span>
        <span>Payment status: ${escapeHTML(formatPaymentStatus(order.payment_status))}</span>
      </div>
    `;
  }

  modal.querySelector('#trackingOrderReference').textContent =
    `Order #${order.sale_id}`;

  modal.querySelector('#trackingModalBody').innerHTML = `
    <div class="tracking-hero">
      <div class="tracking-truck-scene">
        <div class="tracking-orbit orbit-one"></div>
        <div class="tracking-orbit orbit-two"></div>
        <div class="tracking-truck">🚚</div>
        <span class="tracking-road"></span>
      </div>

      <span class="tracking-live-label">
        <i></i> OUT FOR DELIVERY
      </span>

      <h3>Your produce is on its way!</h3>
      <p>The deliverer has picked up your order and it is now in transit.</p>
    </div>

    <section class="tracking-arrival-card">
      <span class="tracking-section-label">EXPECTED ARRIVAL</span>

      <strong class="tracking-arrival-date">
        ${escapeHTML(formatDate(expectedAt, true))}
      </strong>

      <div id="trackingCountdown">
        ${getCountdownMarkup(expectedAt)}
      </div>

      <p class="tracking-shipped-time">
        Picked up on ${escapeHTML(formatDate(order.shipped_at, true))}
      </p>
    </section>

    <section class="tracking-progress-section">
      <h3>Delivery progress</h3>

      <div class="tracking-progress">
        <div class="tracking-progress-step is-complete">
          <span class="tracking-step-marker">✓</span>
          <div>
            <strong>Order confirmed</strong>
            <small>Your order was accepted.</small>
          </div>
        </div>

        <div class="tracking-progress-step is-complete">
          <span class="tracking-step-marker">✓</span>
          <div>
            <strong>Preparing order</strong>
            <small>Your produce was prepared for dispatch.</small>
          </div>
        </div>

        <div class="tracking-progress-step is-current">
          <span class="tracking-step-marker"><i></i></span>
          <div>
            <strong>Shipped / In transit</strong>
            <small>Your deliverer has picked up the produce.</small>
          </div>
        </div>

        <div class="tracking-progress-step">
          <span class="tracking-step-marker"></span>
          <div>
            <strong>Delivered</strong>
            <small>Waiting for your order to arrive.</small>
          </div>
        </div>
      </div>
    </section>

    ${paymentReminder}
  `;

  modal.hidden = false;
  document.body.style.overflow = 'hidden';

  window.clearInterval(countdownTimer);
  updateTrackingCountdown(expectedAt);

  if (expectedAt) {
    countdownTimer = window.setInterval(() => {
      updateTrackingCountdown(expectedAt);
    }, 1000);
  }
}

function openTrackingModal(saleId) {
  const order = state.orders.find(
    item => String(item.sale_id) === String(saleId)
  );

  if (!order || normalize(order.sale_status) !== 'shipped') {
    showToast('Tracking is available once your order has shipped.');
    return;
  }

  renderTrackingModal(order);
}

function closeTrackingModal() {
  const modal = document.getElementById('trackingModal');

  if (modal) modal.hidden = true;

  window.clearInterval(countdownTimer);
  countdownTimer = null;

  state.selectedTrackingSaleId = null;

  if (el.modal.hidden) {
    document.body.style.overflow = '';
  }
}

function openOrderDetails(saleId) {
  const order = state.orders.find(
    (item) => String(item.sale_id) === String(saleId)
  );

  if (!order) {
    showToast('Order details could not be found.');
    return;
  }

  state.selectedOrder = order;

  const items = getOrderItems(order);

  el.modalOrderId.textContent = `Order #${order.sale_id}`;
  el.modalOrderDate.textContent =
    `Placed on ${formatDate(order.created_at, true)}`;

  const itemRows = items.length
    ? items.map((item) => {
      const quantity = Number(item.quantity) || 0;
      const unitPrice = Number(item.unit_price) || 0;
      const lineTotal = Number(item.line_total) || quantity * unitPrice;

      return `
          <tr>
            <td>${escapeHTML(item.crop_name || 'Unnamed produce')}</td>
            <td>${escapeHTML(quantity.toLocaleString('en-PH'))} ${escapeHTML(item.unit || '')}</td>
            <td>${formatMoney(unitPrice)}</td>
            <td>${formatMoney(lineTotal)}</td>
          </tr>
        `;
    }).join('')
    : `
      <tr>
        <td colspan="4">No order items found.</td>
      </tr>
    `;

  const amountPaid = Number(order.amount_paid) || 0;

  el.modalBody.innerHTML = `
    <section class="detail-section">
      <h3>Order Status</h3>

      <div class="detail-grid">
        ${createDetailField('Order Status', formatStatus(order.sale_status))}
        ${createDetailField('Payment Status', formatPaymentStatus(order.payment_status))}
        ${createDetailField('Payment Type', formatPaymentType(order.payment_type))}
        ${createDetailField('Order Date', formatDate(order.created_at, true))}
      </div>
    </section>

    <section class="detail-section">
      <h3>Ordered Products</h3>

      <div class="items-table-wrap">
        <table class="items-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Quantity</th>
              <th>Unit Price</th>
              <th>Subtotal</th>
            </tr>
          </thead>

          <tbody>
            ${itemRows}
          </tbody>
        </table>
      </div>
    </section>

    <section class="detail-section">
      <h3>Payment Summary</h3>

      <div class="detail-grid">
        ${createDetailField('Order Total', formatMoney(order.total_amount))}
        ${createDetailField('Amount Paid', formatMoney(amountPaid))}
      </div>
    </section>

    <section class="detail-section">
      <div class="modal-total">
        <span>Total Amount</span>
        <strong>${formatMoney(order.total_amount)}</strong>
      </div>
    </section>

    ${order.paid_at ? `
      <section class="detail-section">
        <h3>Payment Date</h3>
        <div class="detail-field">
          <strong>${escapeHTML(formatDate(order.paid_at, true))}</strong>
        </div>
      </section>
    ` : ''}

    ${order.delivered_at ? `
      <section class="detail-section">
        <h3>Delivery Date</h3>
        <div class="detail-field">
          <strong>${escapeHTML(formatDate(order.delivered_at, true))}</strong>
        </div>
      </section>
    ` : ''}

    ${order.completed_at ? `
      <section class="detail-section">
        <h3>Completion Date</h3>
        <div class="detail-field">
          <strong>${escapeHTML(formatDate(order.completed_at, true))}</strong>
        </div>
      </section>
    ` : ''}

    ${order.refunded_at ? `
      <section class="detail-section">
        <h3>Refund Date</h3>
        <div class="detail-field">
          <strong>${escapeHTML(formatDate(order.refunded_at, true))}</strong>
        </div>
      </section>
    ` : ''}

    ${order.notes ? `
      <section class="detail-section">
        <h3>Order Notes</h3>
        <div class="detail-field">
          <strong>${escapeHTML(order.notes)}</strong>
        </div>
      </section>
    ` : ''}

    ${createCancellationSection(order)}
  `;

  el.modal.hidden = false;
  document.body.style.overflow = 'hidden';
  el.closeModalBtn.focus();
}

/** Recheck the latest order status and request cancellation when still allowed. */
async function cancelBuyerOrder(saleId) {
  if (state.cancelling) return;

  const order = state.orders.find(
    (item) => String(item.sale_id) === String(saleId)
  );

  if (!order) {
    showToast('Order could not be found.');
    return;
  }

  if (!canBuyerCancelOrder(order)) {
    showToast('This order can no longer be cancelled.');
    return;
  }

  const confirmed = window.confirm(
    'Are you sure you want to cancel this order?\n\n' +
    'The reserved inventory will be returned to the warehouse.'
  );

  if (!confirmed) return;

  state.cancelling = true;

  const cancelButton = document.getElementById('cancelOrderBtn');

  if (cancelButton) {
    cancelButton.disabled = true;
    cancelButton.textContent = 'Cancelling...';
  }

  try {
    const { data, error } = await supabase.rpc(
      CANCEL_ORDER_RPC,
      {
        p_sale_id: saleId,
      }
    );

    if (error) throw error;

    if (!data?.success) {
      throw new Error(
        data?.message || 'The order could not be cancelled.'
      );
    }

    closeOrderDetails();

    showToast('Order cancelled. Reserved inventory has been restored.');

    await loadOrders();

  } catch (error) {
    console.error('Buyer order cancellation failed:', error);

    showToast(
      error?.message || 'Unable to cancel this order. Please try again.'
    );

    // Reload the latest status in case the Warehouse Officer
    // changed the order while the Buyer was viewing it.
    await loadOrders();

    if (state.selectedOrder) {
      openOrderDetails(saleId);
    }

  } finally {
    state.cancelling = false;
  }
}

function closeOrderDetails() {
  el.modal.hidden = true;
  state.selectedOrder = null;

  if (!state.selectedTrackingSaleId) {
    document.body.style.overflow = '';
  }
}

async function logout() {
  const { error } = await supabase.auth.signOut();

  if (error) {
    showToast(error.message || 'Unable to log out.');
    return;
  }

  window.location.replace('../../login.html');
}

function bindEvents() {
  el.search.addEventListener('input', applyFilters);
  el.statusFilter.addEventListener('change', applyFilters);

  el.refreshBtn.addEventListener('click', async () => {
    await loadOrders();
    showToast('Order list refreshed.');
  });

  el.logoutBtn.addEventListener('click', logout);

  el.ordersList.addEventListener('click', async event => {
    const trackButton = event.target.closest('.track-order-btn');

    if (trackButton) {
      openTrackingModal(trackButton.dataset.trackSaleId);
      return;
    }

    const detailsButton = event.target.closest('.view-details-btn');

    if (detailsButton) {
      openOrderDetails(detailsButton.dataset.saleId);
    }
  });

  // Event delegation for the dynamically rendered Cancel Order button.
  el.modalBody.addEventListener('click', async (event) => {
    const button = event.target.closest('#cancelOrderBtn');

    if (!button) return;

    await cancelBuyerOrder(button.dataset.saleId);
  });

  el.closeModalBtn.addEventListener('click', closeOrderDetails);
  el.modalDoneBtn.addEventListener('click', closeOrderDetails);

  el.modal.addEventListener('click', (event) => {
    if (event.target === el.modal && !state.cancelling) {
      closeOrderDetails();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;

    const trackingModal = document.getElementById('trackingModal');

    if (trackingModal && !trackingModal.hidden) {
      closeTrackingModal();
      return;
    }

    if (!el.modal.hidden && !state.cancelling) {
      closeOrderDetails();
    }
  });

  el.mobileMenuBtn.addEventListener('click', () => {
    el.sidebar.classList.toggle('open');
  });

  document.addEventListener('click', (event) => {
    if (
      window.innerWidth <= 760 &&
      !el.sidebar.contains(event.target) &&
      !el.mobileMenuBtn.contains(event.target)
    ) {
      el.sidebar.classList.remove('open');
    }
  });
}

/** Authenticate the buyer and initialize the order list and tracking controls. */
async function init() {
  setToday();
  bindEvents();
  window.addEventListener('beforeunload', cleanupBuyerRealtime);

  try {
    const user = await loadBuyer();

    if (!user) return;

    subscribeToBuyerOrderChanges();
    await loadOrders();

  } catch (error) {
    console.error('Buyer My Orders initialization failed:', error);

    showError(
      error?.message ||
      'Unable to initialize My Orders. Please refresh the page.'
    );
  }
}

init();
