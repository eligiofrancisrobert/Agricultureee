
import { supabase } from "../connection.js";

import {
    initAccountantPage,
    escapeHtml,
    formatPeso,
    formatDate
} from "./main.js";

const $ = id => document.getElementById(id);

const PAGE_SIZE = 10;

const state = {
    sales: [],
    buyers: new Map(),
    filteredSales: [],
    currentPage: 1,
    loading: false
};

const amount = value => Number(value) || 0;

const normalize = value =>
    String(value ?? "").trim().toLowerCase();

const getBuyerName = sale => {
    return state.buyers.get(sale.buyer_id) ||
        `Buyer ${String(sale.buyer_id || "").slice(0, 8)}`;
};

const getPaymentType = type => {
    if (type === "cash") return "Cash";
    if (type === "e-payment") return "E-payment";
    return "-";
};

const getPaymentAmount = sale => {
    const paidAmount = amount(sale.amount_paid);

    if (paidAmount > 0) {
        return paidAmount;
    }

    if (sale.payment_status === "paid") {
        return amount(sale.total_amount);
    }

    if (sale.payment_status === "refunded") {
        return amount(sale.total_amount);
    }

    return 0;
};

const getPaymentDate = sale => {
    return sale.paid_at || sale.refunded_at || null;
};

const getStatusLabel = status => {
    const labels = {
        paid: "Paid",
        unpaid: "Unpaid",
        refunded: "Refunded"
    };

    return labels[normalize(status)] || "Unknown";
};

const getStatusClass = status => {
    const allowed = ["paid", "unpaid", "refunded"];
    const normalized = normalize(status);

    return allowed.includes(normalized)
        ? normalized
        : "unknown";
};

/** Fetch sales, resolve available buyer names, and apply the initial filters. */
async function loadPaymentHistory() {
    const { data, error } = await supabase
        .from("warehouse_sales")
        .select(`
            sale_id,
            buyer_id,
            sale_status,
            payment_status,
            payment_type,
            total_amount,
            amount_paid,
            paid_at,
            refunded_at,
            created_at
        `)
        .order("created_at", { ascending: false });

    if (error) throw error;

    state.sales = data || [];

    await loadBuyers();

    applyFilters();
}

/** Populate buyer names for the IDs present in the loaded sales. */
async function loadBuyers() {
    state.buyers.clear();

    const buyerIds = [
        ...new Set(
            state.sales
                .map(sale => sale.buyer_id)
                .filter(Boolean)
        )
    ];

    if (!buyerIds.length) return;

    const { data, error } = await supabase
        .from("buyer_details")
        .select("user_id, business_name")
        .in("user_id", buyerIds);

    if (error) {
        console.warn(
            "Unable to load buyer names:",
            error.message
        );
        return;
    }

    (data || []).forEach(buyer => {
        if (buyer.user_id && buyer.business_name) {
            state.buyers.set(
                buyer.user_id,
                buyer.business_name
            );
        }
    });
}

/** Filter loaded sales by search/status/type and reset pagination. */
function applyFilters() {
    const search = normalize($("paymentSearch")?.value);
    const status = normalize($("paymentStatusFilter")?.value || "all");
    const type = normalize($("paymentTypeFilter")?.value || "all");

    state.filteredSales = state.sales.filter(sale => {
        const buyer = normalize(getBuyerName(sale));
        const orderId = normalize(sale.sale_id);
        const paymentStatus = normalize(sale.payment_status);
        const paymentType = normalize(sale.payment_type);

        const matchesSearch =
            !search ||
            orderId.includes(search) ||
            buyer.includes(search);

        const matchesStatus =
            status === "all" ||
            paymentStatus === status;

        const matchesType =
            type === "all" ||
            (type === "none" && !paymentType) ||
            paymentType === type;

        return matchesSearch && matchesStatus && matchesType;
    });

    state.currentPage = 1;

    renderTable();
}

/** Render the current page of payment history and its empty state. */
function renderTable() {
    const tbody = $("paymentHistoryBody");
    const empty = $("paymentEmpty");

    if (!tbody) return;

    const totalRecords = state.filteredSales.length;
    const totalPages = Math.max(
        1,
        Math.ceil(totalRecords / PAGE_SIZE)
    );

    if (state.currentPage > totalPages) {
        state.currentPage = totalPages;
    }

    const startIndex = (state.currentPage - 1) * PAGE_SIZE;

    const pageRecords = state.filteredSales.slice(
        startIndex,
        startIndex + PAGE_SIZE
    );

    if (!pageRecords.length) {
        tbody.innerHTML = "";
        empty.hidden = false;
    } else {
        empty.hidden = true;

        tbody.innerHTML = pageRecords.map(sale => {
            const buyer = escapeHtml(getBuyerName(sale));
            const orderId = escapeHtml(
                String(sale.sale_id || "").slice(0, 8).toUpperCase()
            );

            const paymentType = escapeHtml(
                getPaymentType(sale.payment_type)
            );

            const paymentAmount = formatPeso(
                getPaymentAmount(sale)
            );

            const paymentDate = getPaymentDate(sale)
                ? escapeHtml(formatDate(getPaymentDate(sale)))
                : "-";

            const status = getStatusClass(sale.payment_status);
            const statusLabel = escapeHtml(
                getStatusLabel(sale.payment_status)
            );

            return `
                <tr>
                    <td>
                        <span class="order-id">#${orderId}</span>
                    </td>

                    <td>${buyer}</td>

                    <td>${paymentType}</td>

                    <td class="amount-cell">${paymentAmount}</td>

                    <td>${paymentDate}</td>

                    <td>
                        <span class="status-badge status-badge--${status}">
                            ${statusLabel}
                        </span>
                    </td>
                </tr>
            `;
        }).join("");
    }

    renderPagination(totalRecords, totalPages);
}

function renderPagination(totalRecords, totalPages) {
    const start = totalRecords === 0
        ? 0
        : (state.currentPage - 1) * PAGE_SIZE + 1;

    const end = Math.min(
        state.currentPage * PAGE_SIZE,
        totalRecords
    );

    $("paymentPaginationInfo").textContent =
        `Showing ${start}-${end} of ${totalRecords} records`;

    $("paymentPageNumber").textContent =
        `Page ${state.currentPage} of ${totalPages}`;

    $("previousPageBtn").disabled =
        state.currentPage <= 1;

    $("nextPageBtn").disabled =
        state.currentPage >= totalPages;
}

function changePage(direction) {
    const totalPages = Math.max(
        1,
        Math.ceil(state.filteredSales.length / PAGE_SIZE)
    );

    const nextPage = state.currentPage + direction;

    if (nextPage < 1 || nextPage > totalPages) return;

    state.currentPage = nextPage;

    renderTable();
}

function showLoading() {
    $("loadingState").hidden = false;
    $("errorState").hidden = true;
    $("paymentContent").hidden = true;
}

function showContent() {
    $("loadingState").hidden = true;
    $("errorState").hidden = true;
    $("paymentContent").hidden = false;
}

function showError(error) {
    console.error("Payment history error:", error);

    $("loadingState").hidden = true;
    $("paymentContent").hidden = true;
    $("errorState").hidden = false;

    $("errorMessage").textContent =
        error?.message || "Unable to load payment history.";
}

async function refreshPaymentHistory() {
    if (state.loading) return;

    state.loading = true;

    showLoading();

    try {
        await loadPaymentHistory();
        showContent();
    } catch (error) {
        showError(error);
    } finally {
        state.loading = false;
    }
}

function bindEvents() {
    $("paymentSearch")?.addEventListener(
        "input",
        applyFilters
    );

    $("paymentStatusFilter")?.addEventListener(
        "change",
        applyFilters
    );

    $("paymentTypeFilter")?.addEventListener(
        "change",
        applyFilters
    );

    $("previousPageBtn")?.addEventListener(
        "click",
        () => changePage(-1)
    );

    $("nextPageBtn")?.addEventListener(
        "click",
        () => changePage(1)
    );

    $("refreshPaymentsBtn")?.addEventListener(
        "click",
        refreshPaymentHistory
    );

    $("retryPaymentsBtn")?.addEventListener(
        "click",
        refreshPaymentHistory
    );
}

async function init() {
    try {
        const context = await initAccountantPage();

        if (!context) return;

        bindEvents();

        await refreshPaymentHistory();

    } catch (error) {
        console.error(
            "Unable to initialize payment history:",
            error
        );

        showError(error);
    }
}

init();
