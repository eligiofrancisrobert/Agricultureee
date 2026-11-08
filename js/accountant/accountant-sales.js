
import { supabase } from '../connection.js';

/* =========================================================
   TANIKALA - ACCOUNTANT SALES RECORDS
   ========================================================= */

const TABLE_SALES = 'warehouse_sales';
const TABLE_ITEMS = 'warehouse_sale_items';

const state = {
    sales: [],
    items: [],
    buyers: [],
    filteredSales: [],
    currentPage: 1,
    pageSize: 10,
    reportingPeriod: 'this_month',
    paymentStatus: 'all',
    paymentType: 'all',
    orderStatus: 'all',
    search: '',
    deliveryRange: 'monthly',
    produceBasis: 'quantity',
    monthlyYear: new Date().getFullYear(),
    charts: {},
    realtimeChannel: null,
    loading: false
};

const $ = selector => document.querySelector(selector);

const elements = {
    lastUpdated: $('#lastUpdated'),
    refresh: $('#refreshSalesBtn'),
    export: $('#exportSalesBtn'),

    reportingPeriod: $('#salesPeriodFilter'),

    revenue: $('#totalSalesRevenue'),
    totalOrders: $('#totalOrders'),
    paidOrders: $('#paidOrders'),
    unpaidOrders: $('#unpaidOrders'),
    refundedOrders: $('#refundedOrders'),

    deliveryChart: $('#deliveryChart'),
    deliveryFilter: $('#deliveryChartFilter'),

    produceChart: $('#bestSellingProduceChart'),
    produceBasis: $('#produceChartBasis'),
    produceLegend: $('#produceChartLegend'),

    monthlyChart: $('#monthlySalesChart'),
    monthlyYear: $('#monthlySalesYear'),

    search: $('#salesSearch'),
    paymentStatus: $('#paymentStatusFilter'),
    paymentType: $('#paymentTypeFilter'),
    orderStatus: $('#orderStatusFilter'),

    tableBody: $('#salesTableBody'),
    transactionCount: $('#transactionCount'),
    emptyState: $('#salesEmptyState'),

    paginationInfo: $('#paginationInfo'),
    currentPage: $('#currentPage'),
    previousPage: $('#prevPageBtn'),
    nextPage: $('#nextPageBtn'),

    modal: $('#saleDetailsModal'),
    modalTitle: $('#modalSaleId'),
    modalContent: $('#saleDetailsContent'),
    closeModal: $('#closeSaleModal'),
    closeModalFooter: $('#closeSaleModalFooter'),

    toast: $('#salesToast'),
    toastMessage: $('#salesToastMessage')
};

/* =========================================================
   HELPERS
   ========================================================= */

function peso(value) {
    return new Intl.NumberFormat('en-PH', {
        style: 'currency',
        currency: 'PHP'
    }).format(Number(value) || 0);
}

function number(value) {
    return new Intl.NumberFormat('en-PH', {
        maximumFractionDigits: 2
    }).format(Number(value) || 0);
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

    return new Date(value).toLocaleDateString('en-PH', {
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
        hour: '2-digit',
        minute: '2-digit'
    });
}

function normalize(value) {
    return String(value || '').trim().toLowerCase();
}

function showToast(message, type = 'info') {
    if (!elements.toast || !elements.toastMessage) {
        console.log(message);
        return;
    }

    const icon = elements.toast.querySelector('i');

    elements.toastMessage.textContent = message;

    if (icon) {
        icon.className = type === 'error'
            ? 'fa-solid fa-circle-exclamation'
            : type === 'success'
                ? 'fa-solid fa-circle-check'
                : 'fa-solid fa-circle-info';
    }

    elements.toast.classList.add('show');

    clearTimeout(showToast.timeout);

    showToast.timeout = setTimeout(() => {
        elements.toast.classList.remove('show');
    }, 3500);
}

function setLoading(loading) {
    state.loading = loading;

    if (elements.refresh) {
        elements.refresh.disabled = loading;
        elements.refresh.innerHTML = loading
            ? '<i class="fa-solid fa-spinner fa-spin"></i> Loading...'
            : '<i class="fa-solid fa-rotate"></i> Refresh';
    }
}

function getSaleDate(sale) {
    return sale.paid_at || sale.created_at;
}

function getSaleItems(saleId) {
    return state.items.filter(item => item.sale_id === saleId);
}

function getBuyerName(sale) {
    const buyer = state.buyers.find(
        item => item.user_id === sale.buyer_id
    );

    return buyer?.business_name || 'Unknown Buyer';
}

function getOrderStatusClass(status) {
    return normalize(status).replaceAll('_', '-');
}

function getPaymentStatusClass(status) {
    return normalize(status);
}

/* =========================================================
   FETCH DATA
   ========================================================= */

async function fetchSales() {
    setLoading(true);

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
                paid_at,
                delivered_at,
                completed_at,
                shipped_at,
                expected_delivery_at,
                created_at
            `)
            .order('created_at', { ascending: false });

        if (salesError) throw salesError;

        state.sales = sales || [];

        const saleIds = state.sales.map(sale => sale.sale_id);

        const buyerIds = [
            ...new Set(
                state.sales
                    .map(sale => sale.buyer_id)
                    .filter(Boolean)
            )
        ];

        state.items = [];
        state.buyers = [];

        if (saleIds.length) {
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
                .in('sale_id', saleIds);

            if (itemsError) throw itemsError;

            state.items = items || [];
        }

        if (buyerIds.length) {
            const { data: buyers, error: buyersError } = await supabase
                .from('buyer_details')
                .select('user_id, business_name')
                .in('user_id', buyerIds);

            if (buyersError) throw buyersError;

            state.buyers = buyers || [];
        }

        applyFilters();
        renderAll();

        if (elements.lastUpdated) {
            elements.lastUpdated.textContent =
                `Last updated: ${new Date().toLocaleTimeString('en-PH')}`;
        }

    } catch (error) {
        console.error('Accountant sales error:', error);

        showToast(
            `Unable to load sales records: ${error.message}`,
            'error'
        );

        if (elements.tableBody) {
            elements.tableBody.innerHTML = `
                <tr>
                    <td colspan="9" class="table-loading">
                        Unable to load sales records.
                    </td>
                </tr>
            `;
        }
    } finally {
        setLoading(false);
    }
}

/* =========================================================
   REPORTING PERIOD
   ========================================================= */

function getPeriodRange() {
    const now = new Date();

    const start = new Date(now);
    const end = new Date(now);

    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    switch (state.reportingPeriod) {
        case 'this_month':
            start.setDate(1);
            break;

        case 'last_month':
            start.setDate(1);
            start.setMonth(start.getMonth() - 1);
            end.setDate(0);
            break;

        case 'last_3_months':
            start.setDate(1);
            start.setMonth(start.getMonth() - 2);
            break;

        case 'this_year':
            start.setMonth(0, 1);
            break;

        case 'all':
        default:
            return null;
    }

    return { start, end };
}

/* =========================================================
   FILTERS
   ========================================================= */

function applyFilters() {
    const period = getPeriodRange();
    const search = normalize(state.search);

    state.filteredSales = state.sales.filter(sale => {
        const status = normalize(sale.payment_status);
        const type = normalize(sale.payment_type);
        const orderStatus = normalize(sale.sale_status);

        const saleDate = new Date(getSaleDate(sale));

        if (period && (
            saleDate < period.start ||
            saleDate > period.end
        )) {
            return false;
        }

        if (
            state.paymentStatus !== 'all' &&
            status !== state.paymentStatus
        ) {
            return false;
        }

        if (
            state.paymentType !== 'all' &&
            type !== state.paymentType
        ) {
            return false;
        }

        if (
            state.orderStatus !== 'all' &&
            orderStatus !== state.orderStatus
        ) {
            return false;
        }

        if (search) {
            const buyer = getBuyerName(sale);

            const searchable = [
                sale.sale_id,
                buyer,
                sale.payment_type,
                sale.payment_status,
                sale.sale_status
            ].join(' ').toLowerCase();

            if (!searchable.includes(search)) return false;
        }

        return true;
    });

    state.currentPage = 1;
}

/* =========================================================
   SUMMARY CARDS
   ========================================================= */

function renderSummary() {
    const period = getPeriodRange();

    const periodSales = state.sales.filter(sale => {
        if (!period) return true;

        const date = new Date(getSaleDate(sale));

        return date >= period.start && date <= period.end;
    });

    const paid = periodSales.filter(
        sale => normalize(sale.payment_status) === 'paid'
    );

    const unpaid = periodSales.filter(
        sale => normalize(sale.payment_status) === 'unpaid'
    );

    const refunded = periodSales.filter(
        sale => normalize(sale.payment_status) === 'refunded'
    );

    const revenue = paid.reduce(
        (sum, sale) => sum + Number(sale.total_amount || 0),
        0
    );

    elements.revenue.textContent = peso(revenue);
    elements.totalOrders.textContent = number(periodSales.length);
    elements.paidOrders.textContent = number(paid.length);
    elements.unpaidOrders.textContent = number(unpaid.length);
    elements.refundedOrders.textContent = number(refunded.length);
}

/* =========================================================
   TRANSACTION TABLE
   ========================================================= */

function renderTransactions() {
    const filtered = state.filteredSales;

    const total = filtered.length;
    const pages = Math.max(1, Math.ceil(total / state.pageSize));

    state.currentPage = Math.min(state.currentPage, pages);

    const start = (state.currentPage - 1) * state.pageSize;

    const pageSales = filtered.slice(
        start,
        start + state.pageSize
    );

    if (elements.transactionCount) {
        elements.transactionCount.textContent =
            `${total} Transaction${total !== 1 ? 's' : ''}`;
    }

    if (elements.paginationInfo) {
        const first = total ? start + 1 : 0;
        const last = Math.min(start + state.pageSize, total);

        elements.paginationInfo.textContent =
            `Showing ${first}–${last} of ${total} transactions`;
    }

    if (elements.currentPage) {
        elements.currentPage.textContent = state.currentPage;
    }

    if (elements.previousPage) {
        elements.previousPage.disabled = state.currentPage <= 1;
    }

    if (elements.nextPage) {
        elements.nextPage.disabled = state.currentPage >= pages;
    }

    if (elements.emptyState) {
        elements.emptyState.hidden = total > 0;
    }

    if (!elements.tableBody) return;

    if (!pageSales.length) {
        elements.tableBody.innerHTML = '';
        return;
    }

    elements.tableBody.innerHTML = pageSales.map(sale => {
        const items = getSaleItems(sale.sale_id);

        const itemSummary = items.length
            ? items.map(item =>
                `${escapeHTML(item.crop_name)} (${number(item.quantity)} ${escapeHTML(item.unit || '')})`
            ).join(', ')
            : 'No items';

        const status = normalize(sale.payment_status);
        const orderStatus = normalize(sale.sale_status);

        return `
            <tr>
                <td>
                    <span class="sale-id">
                        #${escapeHTML(sale.sale_id.slice(0, 8).toUpperCase())}
                    </span>
                </td>

                <td>${escapeHTML(getBuyerName(sale))}</td>

                <td class="sales-items-cell">
                    ${itemSummary}
                </td>

                <td class="sales-amount">
                    ${peso(sale.total_amount)}
                </td>

                <td>
                    <span class="status-badge ${getOrderStatusClass(orderStatus)}">
                        ${escapeHTML(orderStatus.replaceAll('_', ' '))}
                    </span>
                </td>

                <td>
                    <span class="status-badge ${getPaymentStatusClass(status)}">
                        ${escapeHTML(status)}
                    </span>
                </td>

                <td>${escapeHTML(sale.payment_type || '—')}</td>

                <td>${formatDate(getSaleDate(sale))}</td>

                <td>
                    <button
                        type="button"
                        class="btn-view-sale"
                        data-sale-id="${escapeHTML(sale.sale_id)}"
                        aria-label="View sale details">
                        <i class="fa-solid fa-eye"></i>
                        View
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    elements.tableBody.querySelectorAll('[data-sale-id]')
        .forEach(button => {
            button.addEventListener('click', () => {
                openSaleDetails(button.dataset.saleId);
            });
        });
}

/* =========================================================
   SALE DETAILS MODAL
   ========================================================= */

function openSaleDetails(saleId) {
    const sale = state.sales.find(
        item => item.sale_id === saleId
    );

    if (!sale) return;

    const items = getSaleItems(saleId);

    elements.modalTitle.textContent =
        `#${sale.sale_id.slice(0, 8).toUpperCase()}`;

    const rows = items.map(item => `
        <tr>
            <td>${escapeHTML(item.crop_name)}</td>
            <td>${number(item.quantity)} ${escapeHTML(item.unit || '')}</td>
            <td>${peso(item.unit_price)}</td>
            <td>${peso(item.line_total)}</td>
        </tr>
    `).join('');

    elements.modalContent.innerHTML = `
        <div class="sale-detail-summary">
            <div class="sale-detail-row">
                <span>Buyer</span>
                <strong>${escapeHTML(getBuyerName(sale))}</strong>
            </div>

            <div class="sale-detail-row">
                <span>Order ID</span>
                <strong>${escapeHTML(sale.sale_id)}</strong>
            </div>

            <div class="sale-detail-row">
                <span>Order Date</span>
                <strong>${formatDateTime(sale.created_at)}</strong>
            </div>

            <div class="sale-detail-row">
                <span>Payment Date</span>
                <strong>${formatDateTime(sale.paid_at)}</strong>
            </div>

            <div class="sale-detail-row">
                <span>Payment Type</span>
                <strong>${escapeHTML(sale.payment_type || '—')}</strong>
            </div>

            <div class="sale-detail-row">
                <span>Payment Status</span>
                <strong>${escapeHTML(sale.payment_status)}</strong>
            </div>

            <div class="sale-detail-row">
                <span>Order Status</span>
                <strong>${escapeHTML(sale.sale_status)}</strong>
            </div>
        </div>

        <div class="sale-detail-items">
            <h3>Purchased Produce</h3>

            <div class="table-wrap">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Produce</th>
                            <th>Quantity</th>
                            <th>Unit Price</th>
                            <th>Subtotal</th>
                        </tr>
                    </thead>

                    <tbody>
                        ${rows || `
                            <tr>
                                <td colspan="4">No item records found.</td>
                            </tr>
                        `}
                    </tbody>
                </table>
            </div>
        </div>

        <div class="sale-detail-total">
            <span>Total Amount</span>
            <strong>${peso(sale.total_amount)}</strong>
        </div>
    `;

    elements.modal.hidden = false;
    elements.modal.classList.add('show');
    document.body.classList.add('modal-open');
}

function closeSaleDetails() {
    if (!elements.modal) return;

    elements.modal.hidden = true;
    elements.modal.classList.remove('show');
    document.body.classList.remove('modal-open');
}

/* =========================================================
   CHART UTILITIES
   ========================================================= */

function destroyChart(name) {
    if (state.charts[name]) {
        state.charts[name].destroy();
        state.charts[name] = null;
    }
}

function getPaidSales() {
    return state.sales.filter(
        sale => normalize(sale.payment_status) === 'paid'
    );
}

/* =========================================================
   DELIVERY PERFORMANCE CHART
   ========================================================= */

function renderDeliveryChart() {
    if (!window.Chart || !elements.deliveryChart) return;

    destroyChart('delivery');

    const range = state.deliveryRange;
    const sales = state.sales.filter(sale =>
        ['delivered', 'completed'].includes(normalize(sale.sale_status))
    );

    const labels = [];
    const values = [];

    if (range === 'daily') {
        const today = new Date();

        for (let i = 6; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(today.getDate() - i);

            const key = date.toDateString();

            labels.push(date.toLocaleDateString('en-PH', {
                month: 'short',
                day: 'numeric'
            }));

            values.push(sales.filter(sale => {
                const deliveryDate = new Date(
                    sale.delivered_at || sale.completed_at || sale.paid_at
                );

                return deliveryDate.toDateString() === key;
            }).length);
        }
    } else if (range === 'monthly') {
        const year = new Date().getFullYear();

        for (let month = 0; month < 12; month++) {
            labels.push(new Date(year, month, 1).toLocaleDateString(
                'en-PH',
                { month: 'short' }
            ));

            values.push(sales.filter(sale => {
                const date = new Date(
                    sale.delivered_at || sale.completed_at || sale.paid_at
                );

                return date.getFullYear() === year &&
                    date.getMonth() === month;
            }).length);
        }
    } else {
        const years = [
            ...new Set(sales.map(sale =>
                new Date(
                    sale.delivered_at || sale.completed_at || sale.paid_at
                ).getFullYear()
            ))
        ].sort((a, b) => a - b);

        years.forEach(year => {
            labels.push(String(year));

            values.push(sales.filter(sale =>
                new Date(
                    sale.delivered_at || sale.completed_at || sale.paid_at
                ).getFullYear() === year
            ).length);
        });
    }

    state.charts.delivery = new Chart(elements.deliveryChart, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Completed Deliveries',
                data: values,
                borderColor: '#9AA76B',
                backgroundColor: 'rgba(154, 167, 107, 0.16)',
                fill: true,
                tension: 0.35,
                borderWidth: 2.5,
                pointRadius: 4,
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: context =>
                            `${context.raw} completed deliveries`
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { precision: 0 }
                }
            }
        }
    });
}

/* =========================================================
   BEST-SELLING PRODUCE CHART
   ========================================================= */

function renderProduceChart() {
    if (!window.Chart || !elements.produceChart) return;

    destroyChart('produce');

    const totals = new Map();

    getPaidSales().forEach(sale => {
        getSaleItems(sale.sale_id).forEach(item => {
            const name = item.crop_name || 'Unknown Produce';

            const value = state.produceBasis === 'revenue'
                ? Number(item.line_total || 0)
                : Number(item.quantity || 0);

            totals.set(name, (totals.get(name) || 0) + value);
        });
    });

    const sorted = [...totals.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 7);

    const labels = sorted.map(item => item[0]);
    const values = sorted.map(item => item[1]);

    const colors = [
        '#C65D3A',
        '#9AA76B',
        '#E8B66A',
        '#647C70',
        '#D98C72',
        '#8C735B',
        '#B6A58A'
    ];

    state.charts.produce = new Chart(elements.produceChart, {
        type: 'pie',
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: colors,
                borderWidth: 2,
                borderColor: '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: context => {
                            const value = context.raw;

                            return state.produceBasis === 'revenue'
                                ? `${context.label}: ${peso(value)}`
                                : `${context.label}: ${number(value)}`;
                        }
                    }
                }
            }
        }
    });

    if (elements.produceLegend) {
        elements.produceLegend.innerHTML = sorted.map((item, index) => `
            <div class="produce-legend-item">
                <span
                    class="produce-legend-color"
                    style="background:${colors[index]}">
                </span>

                <span class="produce-legend-name">
                    ${escapeHTML(item[0])}
                </span>

                <strong>
                    ${state.produceBasis === 'revenue'
                        ? peso(item[1])
                        : number(item[1])}
                </strong>
            </div>
        `).join('');
    }
}

/* =========================================================
   MONTHLY SALES CHART
   ========================================================= */

function populateYearFilter() {
    if (!elements.monthlyYear) return;

    const years = new Set([
        new Date().getFullYear(),
        ...getPaidSales().map(sale =>
            new Date(getSaleDate(sale)).getFullYear()
        )
    ]);

    const sorted = [...years].sort((a, b) => b - a);

    elements.monthlyYear.innerHTML = sorted.map(year => `
        <option value="${year}" ${year === state.monthlyYear ? 'selected' : ''}>
            ${year}
        </option>
    `).join('');

    if (!years.has(state.monthlyYear)) {
        state.monthlyYear = sorted[0];
        elements.monthlyYear.value = state.monthlyYear;
    }
}

function renderMonthlySalesChart() {
    if (!window.Chart || !elements.monthlyChart) return;

    destroyChart('monthly');

    const year = Number(state.monthlyYear);
    const monthlyTotals = Array(12).fill(0);

    getPaidSales().forEach(sale => {
        const date = new Date(getSaleDate(sale));

        if (date.getFullYear() === year) {
            monthlyTotals[date.getMonth()] +=
                Number(sale.total_amount || 0);
        }
    });

    state.charts.monthly = new Chart(elements.monthlyChart, {
        type: 'bar',
        data: {
            labels: [
                'January', 'February', 'March', 'April',
                'May', 'June', 'July', 'August',
                'September', 'October', 'November', 'December'
            ],
            datasets: [{
                label: 'Paid Sales Revenue',
                data: monthlyTotals,
                backgroundColor: '#C65D3A',
                borderRadius: 7,
                maxBarThickness: 42
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: context => peso(context.raw)
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: value =>
                            `₱${Number(value).toLocaleString('en-PH')}`
                    }
                },
                x: {
                    grid: { display: false }
                }
            }
        }
    });
}

/* =========================================================
   EXPORT CSV
   ========================================================= */

function exportSalesCSV() {
    if (!state.filteredSales.length) {
        showToast('There are no transactions to export.', 'error');
        return;
    }

    const headers = [
        'Sale ID',
        'Buyer',
        'Produce',
        'Quantity',
        'Unit',
        'Unit Price',
        'Line Total',
        'Total Amount',
        'Order Status',
        'Payment Status',
        'Payment Type',
        'Order Date',
        'Paid Date'
    ];

    const rows = [];

    state.filteredSales.forEach(sale => {
        const items = getSaleItems(sale.sale_id);

        if (!items.length) {
            rows.push([
                sale.sale_id,
                getBuyerName(sale),
                '',
                '',
                '',
                '',
                '',
                sale.total_amount,
                sale.sale_status,
                sale.payment_status,
                sale.payment_type,
                sale.created_at,
                sale.paid_at
            ]);
            return;
        }

        items.forEach(item => {
            rows.push([
                sale.sale_id,
                getBuyerName(sale),
                item.crop_name,
                item.quantity,
                item.unit,
                item.unit_price,
                item.line_total,
                sale.total_amount,
                sale.sale_status,
                sale.payment_status,
                sale.payment_type,
                sale.created_at,
                sale.paid_at
            ]);
        });
    });

    const csv = [headers, ...rows]
        .map(row => row.map(value => {
            const safe = String(value ?? '').replace(/"/g, '""');
            return `"${safe}"`;
        }).join(','))
        .join('\r\n');

    const blob = new Blob(['\uFEFF' + csv], {
        type: 'text/csv;charset=utf-8;'
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = `Tanikala-Sales-Report-${new Date()
        .toISOString()
        .slice(0, 10)}.csv`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);

    showToast('Sales report exported successfully.', 'success');
}

/* =========================================================
   RENDER
   ========================================================= */

function renderAll() {
    renderSummary();
    renderTransactions();
    populateYearFilter();
    renderDeliveryChart();
    renderProduceChart();
    renderMonthlySalesChart();
}

/* =========================================================
   REALTIME
   ========================================================= */

function subscribeRealtime() {
    if (state.realtimeChannel) {
        supabase.removeChannel(state.realtimeChannel);
    }

    state.realtimeChannel = supabase
        .channel('accountant-sales-records')
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: TABLE_SALES
            },
            () => fetchSales()
        )
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: TABLE_ITEMS
            },
            () => fetchSales()
        )
        .subscribe();
}

/* =========================================================
   EVENTS
   ========================================================= */

function bindEvents() {
    elements.reportingPeriod?.addEventListener('change', event => {
        state.reportingPeriod = event.target.value;
        applyFilters();
        renderAll();
    });

    elements.search?.addEventListener('input', event => {
        state.search = event.target.value;
        applyFilters();
        renderTransactions();
    });

    elements.paymentStatus?.addEventListener('change', event => {
        state.paymentStatus = event.target.value;
        applyFilters();
        renderTransactions();
    });

    elements.paymentType?.addEventListener('change', event => {
        state.paymentType = event.target.value;
        applyFilters();
        renderTransactions();
    });

    elements.orderStatus?.addEventListener('change', event => {
        state.orderStatus = event.target.value;
        applyFilters();
        renderTransactions();
    });

    elements.deliveryFilter?.addEventListener('change', event => {
        state.deliveryRange = event.target.value;
        renderDeliveryChart();
    });

    elements.produceBasis?.addEventListener('change', event => {
        state.produceBasis = event.target.value;
        renderProduceChart();
    });

    elements.monthlyYear?.addEventListener('change', event => {
        state.monthlyYear = Number(event.target.value);
        renderMonthlySalesChart();
    });

    elements.refresh?.addEventListener('click', fetchSales);
    elements.export?.addEventListener('click', exportSalesCSV);

    elements.previousPage?.addEventListener('click', () => {
        if (state.currentPage > 1) {
            state.currentPage--;
            renderTransactions();
        }
    });

    elements.nextPage?.addEventListener('click', () => {
        const pages = Math.ceil(
            state.filteredSales.length / state.pageSize
        );

        if (state.currentPage < pages) {
            state.currentPage++;
            renderTransactions();
        }
    });

    elements.closeModal?.addEventListener('click', closeSaleDetails);
    elements.closeModalFooter?.addEventListener('click', closeSaleDetails);

    elements.modal?.addEventListener('click', event => {
        if (event.target === elements.modal) {
            closeSaleDetails();
        }
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            closeSaleDetails();
        }
    });
}

/* =========================================================
   INITIALIZATION
   ========================================================= */

async function initAccountantSales() {
    bindEvents();
    await fetchSales();
    subscribeRealtime();
}

document.addEventListener('DOMContentLoaded', initAccountantSales);
