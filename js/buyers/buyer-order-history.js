import { supabase } from '../connection.js';

import {
    buyerReady,
    hasPermission
} from './main.js';

/* =========================================================
   TANIKALA - BUYER ORDER HISTORY
   Permission: order_history.view
   ========================================================= */

const TABLE_SALES = 'warehouse_sales';

const state = {
    buyer: null,
    orders: [],
    filteredOrders: [],
    loading: false,
    realtimeChannel: null,
    selectedOrder: null,
    search: '',
    date: '',
    sort: 'newest'
};

const elements = {
    todayLabel: document.getElementById('todayLabel'),
    userName: document.getElementById('userName'),
    userInitial: document.getElementById('userInitial'),
    logoutBtn: document.getElementById('logoutBtn'),

    totalCompletedOrders: document.getElementById('totalCompletedOrders'),
    totalItemsPurchased: document.getElementById('totalItemsPurchased'),
    totalAmountSpent: document.getElementById('totalAmountSpent'),

    historySearch: document.getElementById('historySearch'),
    historyDateFilter: document.getElementById('historyDateFilter'),
    historySort: document.getElementById('historySort'),
    resetHistoryFilters: document.getElementById('resetHistoryFilters'),

    historyLoading: document.getElementById('historyLoading'),
    historyError: document.getElementById('historyError'),
    historyOrdersContainer: document.getElementById('historyOrdersContainer'),
    historyOrdersList: document.getElementById('historyOrdersList'),
    historyResultsCount: document.getElementById('historyResultsCount'),

    historyEmpty: document.getElementById('historyEmpty'),
    historyEmptyTitle: document.getElementById('historyEmptyTitle'),
    historyEmptyMessage: document.getElementById('historyEmptyMessage'),

    historyModal: document.getElementById('historyModal'),
    historyModalContent: document.getElementById('historyModalContent'),
    closeHistoryModal: document.getElementById('closeHistoryModal'),
    historyModalDone: document.getElementById('historyModalDone'),

    toastStack: document.getElementById('toastStack')
};

/* =========================================================
   PAGE ACCESS
   ========================================================= */

function hideOrderHistoryPage() {
    cleanupRealtime();

    const main = document.querySelector('main');

    if (main) {
        main.hidden = true;
    } else {
        const pageElements = [
            elements.historyLoading,
            elements.historyError,
            elements.historyOrdersContainer,
            elements.historyEmpty,
            elements.historyModal
        ];

        pageElements.forEach(element => {
            if (element) element.hidden = true;
        });
    }

    const existingMessage = document.getElementById(
        'orderHistoryAccessDenied'
    );

    if (existingMessage) return;

    const denied = document.createElement('section');

    denied.id = 'orderHistoryAccessDenied';
    denied.className = 'access-denied';
    denied.setAttribute('role', 'alert');

    denied.innerHTML = `
        <h2>Access Restricted</h2>
        <p>You do not have permission to view your order history.</p>
    `;

    document.body.appendChild(denied);
}

/* =========================================================
   UTILITIES
   ========================================================= */

function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    })[char]);
}

function formatCurrency(value) {
    return new Intl.NumberFormat('en-PH', {
        style: 'currency',
        currency: 'PHP'
    }).format(Number(value) || 0);
}

function formatDate(value) {
    if (!value) return 'Not available';

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return 'Not available';
    }

    return date.toLocaleDateString('en-PH', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

function formatDateTime(value) {
    if (!value) return 'Not available';

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return 'Not available';
    }

    return date.toLocaleString('en-PH', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
}

function formatQuantity(quantity, unit) {
    const value = Number(quantity) || 0;

    const formatted = new Intl.NumberFormat('en-PH', {
        maximumFractionDigits: 2
    }).format(value);

    return `${formatted} ${unit || ''}`.trim();
}

function formatOrderNumber(saleId) {
    if (!saleId) return 'ORDER';

    return `ORDER #${String(saleId)
        .replace(/-/g, '')
        .slice(0, 8)
        .toUpperCase()}`;
}

function showToast(message, type = 'success') {
    if (!elements.toastStack) return;

    const toast = document.createElement('div');

    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    elements.toastStack.appendChild(toast);

    window.setTimeout(() => {
        toast.remove();
    }, 3500);
}

function setLoading(loading) {
    state.loading = loading;

    if (elements.historyLoading) {
        elements.historyLoading.hidden = !loading;
    }

    if (loading) {
        if (elements.historyOrdersContainer) {
            elements.historyOrdersContainer.hidden = true;
        }

        if (elements.historyEmpty) {
            elements.historyEmpty.hidden = true;
        }

        if (elements.historyError) {
            elements.historyError.hidden = true;
        }
    }
}

function showError(message) {
    if (!elements.historyError) return;

    elements.historyError.textContent = message;
    elements.historyError.hidden = false;

    if (elements.historyOrdersContainer) {
        elements.historyOrdersContainer.hidden = true;
    }

    if (elements.historyEmpty) {
        elements.historyEmpty.hidden = true;
    }
}

function getOrderItems(order) {
    return Array.isArray(order.warehouse_sale_items)
        ? order.warehouse_sale_items
        : [];
}

/* =========================================================
   LOAD COMPLETED ORDERS
   ========================================================= */

async function loadOrders() {
    if (!state.buyer || !hasPermission('order_history.view')) {
        return;
    }

    if (state.loading) return;

    setLoading(true);

    try {
        const { data, error } = await supabase
            .from(TABLE_SALES)
            .select(`
                sale_id,
                buyer_id,
                sale_status,
                payment_status,
                payment_type,
                total_amount,
                amount_paid,
                paid_at,
                created_at,
                delivered_at,
                completed_at,
                warehouse_sale_items (
                    sale_item_id,
                    produce_id,
                    farm_id,
                    crop_name,
                    quantity,
                    unit,
                    unit_price,
                    line_total
                )
            `)
            .eq('buyer_id', state.buyer.id)
            .eq('sale_status', 'completed')
            .order('completed_at', {
                ascending: false,
                nullsFirst: false
            });

        if (error) throw error;

        state.orders = data || [];

        calculateSummary();
        applyFilters();

        if (elements.historyError) {
            elements.historyError.hidden = true;
        }

    } catch (error) {
        console.error('Order History Error:', error);

        showError(
            error.message ||
            'Unable to load your completed orders. Please try again.'
        );

    } finally {
        setLoading(false);
    }
}

/* =========================================================
   SUMMARY CARDS
   ========================================================= */

function calculateSummary() {
    const totalOrders = state.orders.length;

    const totalItems = state.orders.reduce((total, order) => {
        const items = getOrderItems(order);

        return total + items.reduce((sum, item) => {
            return sum + (Number(item.quantity) || 0);
        }, 0);
    }, 0);

    const totalSpent = state.orders.reduce((total, order) => {
        return total + (Number(order.total_amount) || 0);
    }, 0);

    elements.totalCompletedOrders.textContent =
        totalOrders.toLocaleString('en-PH');

    elements.totalItemsPurchased.textContent =
        totalItems.toLocaleString('en-PH', {
            maximumFractionDigits: 2
        });

    elements.totalAmountSpent.textContent =
        formatCurrency(totalSpent);
}

/* =========================================================
   FILTER AND SORT
   ========================================================= */

function applyFilters() {
    if (!hasPermission('order_history.view')) return;

    let filtered = [...state.orders];

    if (state.search.trim()) {
        const search = state.search.toLowerCase().trim();

        filtered = filtered.filter(order => {
            const orderNumber = formatOrderNumber(order.sale_id)
                .toLowerCase();

            const itemMatch = getOrderItems(order).some(item =>
                String(item.crop_name || '')
                    .toLowerCase()
                    .includes(search)
            );

            return orderNumber.includes(search) || itemMatch;
        });
    }

    if (state.date) {
        filtered = filtered.filter(order => {
            const completedDate = order.completed_at
                ? new Date(order.completed_at)
                : null;

            if (
                !completedDate ||
                Number.isNaN(completedDate.getTime())
            ) {
                return false;
            }

            const year = completedDate.getFullYear();

            const month = String(
                completedDate.getMonth() + 1
            ).padStart(2, '0');

            const day = String(
                completedDate.getDate()
            ).padStart(2, '0');

            return `${year}-${month}-${day}` === state.date;
        });
    }

    switch (state.sort) {
        case 'oldest':
            filtered.sort((a, b) =>
                new Date(a.completed_at || a.created_at) -
                new Date(b.completed_at || b.created_at)
            );
            break;

        case 'highest':
            filtered.sort((a, b) =>
                Number(b.total_amount) - Number(a.total_amount)
            );
            break;

        case 'lowest':
            filtered.sort((a, b) =>
                Number(a.total_amount) - Number(b.total_amount)
            );
            break;

        default:
            filtered.sort((a, b) =>
                new Date(b.completed_at || b.created_at) -
                new Date(a.completed_at || a.created_at)
            );
    }

    state.filteredOrders = filtered;

    renderOrders();
}

/* =========================================================
   ORDER CARD
   ========================================================= */

function createOrderItemHTML(item) {
    return `
        <div class="history-order-item">

            <div class="history-item-information">

                <div class="history-item-image">
                    <span class="history-item-placeholder">🌱</span>
                </div>

                <div class="history-item-text">
                    <strong>${escapeHTML(item.crop_name)}</strong>

                    <span>
                        ${escapeHTML(formatQuantity(
                            item.quantity,
                            item.unit
                        ))}
                    </span>
                </div>

            </div>

            <div class="history-item-total">
                ${formatCurrency(item.line_total)}
            </div>

        </div>
    `;
}

function createOrderCardHTML(order) {
    const items = getOrderItems(order);

    const visibleItems = items.slice(0, 3);

    const remainingItems = items.length - visibleItems.length;

    const itemHTML = visibleItems.length
        ? visibleItems.map(createOrderItemHTML).join('')
        : '<p>No item records available.</p>';

    const moreItemsHTML = remainingItems > 0
        ? `
            <div class="history-more-items">
                + ${remainingItems} more item(s)
            </div>
        `
        : '';

    const paymentStatus = escapeHTML(
        order.payment_status || 'unpaid'
    );

    const paymentType = order.payment_type
        ? escapeHTML(order.payment_type)
        : 'Not specified';

    return `
        <article class="history-order-card"
            data-sale-id="${escapeHTML(order.sale_id)}">

            <div class="history-order-header">

                <div class="history-order-reference">
                    <strong>${formatOrderNumber(order.sale_id)}</strong>

                    <span>
                        Completed on ${formatDate(order.completed_at)}
                    </span>
                </div>

                <span class="history-completed-badge">
                    Completed
                </span>

            </div>

            <div class="history-order-body">

                <div class="history-order-items">
                    ${itemHTML}
                </div>

                ${moreItemsHTML}

                <div class="history-order-divider"></div>

                <div class="history-order-footer">

                    <div class="history-payment-information">
                        <span>Payment Status</span>
                        <strong>${paymentStatus}</strong>
                        <span>Payment Method: ${paymentType}</span>
                    </div>

                    <div class="history-order-total">
                        <span>Order Total</span>
                        <strong>${formatCurrency(order.total_amount)}</strong>
                    </div>

                </div>

            </div>

            <div class="history-order-actions">

                <button
                    type="button"
                    class="history-view-details"
                    data-action="view-details"
                    data-sale-id="${escapeHTML(order.sale_id)}">

                    View Details
                    <span aria-hidden="true">→</span>

                </button>

            </div>

        </article>
    `;
}

/* =========================================================
   RENDER ORDERS
   ========================================================= */

function renderOrders() {
    if (!hasPermission('order_history.view')) return;

    const orders = state.filteredOrders;

    elements.historyOrdersList.innerHTML = '';

    elements.historyResultsCount.textContent =
        `${orders.length} completed ${orders.length === 1 ? 'order' : 'orders'}`;

    if (state.orders.length === 0) {
        elements.historyOrdersContainer.hidden = true;
        elements.historyEmpty.hidden = false;

        elements.historyEmptyTitle.textContent =
            'No Completed Orders Yet';

        elements.historyEmptyMessage.textContent =
            'Your completed purchases will appear here once your orders have been successfully completed.';

        return;
    }

    if (orders.length === 0) {
        elements.historyOrdersContainer.hidden = true;
        elements.historyEmpty.hidden = false;

        elements.historyEmptyTitle.textContent =
            'No Matching Orders';

        elements.historyEmptyMessage.textContent =
            'No completed orders match your current search or date filter. Try changing your filters.';

        return;
    }

    elements.historyEmpty.hidden = true;
    elements.historyOrdersContainer.hidden = false;

    elements.historyOrdersList.innerHTML =
        orders.map(createOrderCardHTML).join('');
}

/* =========================================================
   ORDER DETAILS MODAL
   ========================================================= */

function openOrderDetails(saleId) {
    if (!hasPermission('order_history.view')) return;

    const order = state.orders.find(
        item => String(item.sale_id) === String(saleId)
    );

    if (!order) return;

    state.selectedOrder = order;

    const items = getOrderItems(order);

    const itemsHTML = items.map(item => `
        <div class="history-detail-item">

            <div class="history-detail-item-info">
                <strong>${escapeHTML(item.crop_name)}</strong>

                <span>
                    ${escapeHTML(formatQuantity(
                        item.quantity,
                        item.unit
                    ))}
                    × ${formatCurrency(item.unit_price)}
                </span>
            </div>

            <div class="history-detail-item-total">
                ${formatCurrency(item.line_total)}
            </div>

        </div>
    `).join('');

    elements.historyModalContent.innerHTML = `

        <section class="history-detail-section">

            <h3>Order Information</h3>

            <div class="history-detail-grid">

                <div class="history-detail-field">
                    <span>Order Number</span>
                    <strong>${formatOrderNumber(order.sale_id)}</strong>
                </div>

                <div class="history-detail-field">
                    <span>Order Status</span>
                    <strong>Completed</strong>
                </div>

                <div class="history-detail-field">
                    <span>Order Date</span>
                    <strong>${formatDateTime(order.created_at)}</strong>
                </div>

                <div class="history-detail-field">
                    <span>Completion Date</span>
                    <strong>${formatDateTime(order.completed_at)}</strong>
                </div>

                <div class="history-detail-field">
                    <span>Delivery Date</span>
                    <strong>${formatDateTime(order.delivered_at)}</strong>
                </div>

            </div>

        </section>

        <section class="history-detail-section">

            <h3>Purchased Products (${items.length})</h3>

            <div class="history-detail-items">
                ${itemsHTML || '<p>No product details available.</p>'}
            </div>

        </section>

        <section class="history-detail-section">

            <h3>Payment Information</h3>

            <div class="history-detail-grid">

                <div class="history-detail-field">
                    <span>Payment Status</span>
                    <strong>${escapeHTML(order.payment_status || 'unpaid')}</strong>
                </div>

                <div class="history-detail-field">
                    <span>Payment Method</span>
                    <strong>${escapeHTML(order.payment_type || 'Not specified')}</strong>
                </div>

                <div class="history-detail-field">
                    <span>Payment Date</span>
                    <strong>${formatDateTime(order.paid_at)}</strong>
                </div>

                <div class="history-detail-field">
                    <span>Amount Paid</span>
                    <strong>${formatCurrency(order.amount_paid)}</strong>
                </div>

            </div>

        </section>

        <div class="history-detail-total">
            <span>Total Order Amount</span>
            <strong>${formatCurrency(order.total_amount)}</strong>
        </div>

    `;

    elements.historyModal.hidden = false;
    elements.historyModal.setAttribute('aria-hidden', 'false');

    document.body.style.overflow = 'hidden';

    elements.closeHistoryModal.focus();
}

function closeOrderDetails() {
    if (!elements.historyModal) return;

    elements.historyModal.hidden = true;
    elements.historyModal.setAttribute('aria-hidden', 'true');

    document.body.style.overflow = '';

    state.selectedOrder = null;
}

/* =========================================================
   FILTER EVENTS
   ========================================================= */

function initializeFilters() {
    elements.historySearch.addEventListener('input', event => {
        if (!hasPermission('order_history.view')) return;

        state.search = event.target.value;
        applyFilters();
    });

    elements.historyDateFilter.addEventListener('change', event => {
        if (!hasPermission('order_history.view')) return;

        state.date = event.target.value;
        applyFilters();
    });

    elements.historySort.addEventListener('change', event => {
        if (!hasPermission('order_history.view')) return;

        state.sort = event.target.value;
        applyFilters();
    });

    elements.resetHistoryFilters.addEventListener('click', () => {
        if (!hasPermission('order_history.view')) return;

        state.search = '';
        state.date = '';
        state.sort = 'newest';

        elements.historySearch.value = '';
        elements.historyDateFilter.value = '';
        elements.historySort.value = 'newest';

        applyFilters();
    });
}

/* =========================================================
   MODAL EVENTS
   ========================================================= */

function initializeModal() {
    elements.historyOrdersList.addEventListener('click', event => {
        if (!hasPermission('order_history.view')) return;

        const button = event.target.closest(
            '[data-action="view-details"]'
        );

        if (!button) return;

        openOrderDetails(button.dataset.saleId);
    });

    elements.closeHistoryModal.addEventListener(
        'click',
        closeOrderDetails
    );

    elements.historyModalDone.addEventListener(
        'click',
        closeOrderDetails
    );

    elements.historyModal.addEventListener('click', event => {
        if (event.target === elements.historyModal) {
            closeOrderDetails();
        }
    });

    document.addEventListener('keydown', event => {
        if (
            event.key === 'Escape' &&
            !elements.historyModal.hidden
        ) {
            closeOrderDetails();
        }
    });
}

/* =========================================================
   REALTIME SUBSCRIPTION
   ========================================================= */

function initializeRealtime() {
    if (
        !state.buyer ||
        !hasPermission('order_history.view')
    ) {
        return;
    }

    cleanupRealtime();

    state.realtimeChannel = supabase
        .channel(`buyer-order-history-${state.buyer.id}`)
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: TABLE_SALES,
                filter: `buyer_id=eq.${state.buyer.id}`
            },
            () => {
                if (hasPermission('order_history.view')) {
                    loadOrders();
                }
            }
        )
        .subscribe(status => {
            if (status === 'CHANNEL_ERROR') {
                console.error(
                    'Order History Realtime subscription failed.'
                );
            }
        });
}

function cleanupRealtime() {
    if (state.realtimeChannel) {
        supabase.removeChannel(state.realtimeChannel);
        state.realtimeChannel = null;
    }
}

/* =========================================================
   CLEANUP
   ========================================================= */

window.addEventListener('pagehide', cleanupRealtime);

/* =========================================================
   INITIALIZATION
   ========================================================= */

async function initializeOrderHistory() {
    try {
        // Wait for shared Buyer authentication and permission loading.
        const auth = await buyerReady;

        if (!auth) return;

        // Stop initialization completely when permission is disabled.
        if (!hasPermission('order_history.view')) {
            hideOrderHistoryPage();
            return;
        }

        state.buyer = auth.user;

        // Shared main.js handles the header and logout.
        initializeFilters();
        initializeModal();

        await loadOrders();

        initializeRealtime();

    } catch (error) {
        console.error(
            'Buyer Order History Initialization Error:',
            error
        );

        setLoading(false);

        showError(
            error.message ||
            'Unable to initialize your order history.'
        );
    }
}

initializeOrderHistory();