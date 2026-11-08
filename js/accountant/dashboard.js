
import { supabase } from "../connection.js";
import {
    initAccountantPage,
    escapeHtml,
    formatPeso,
    formatDate
} from "./main.js";

/* ============================================================
   TANIKALA - ACCOUNTANT DASHBOARD
   Source:
   - warehouse_sales
   - buyer_details

   Collections: paid transactions only.
   Cancelled unpaid orders are excluded from unpaid statistics.
   Refunded transactions are tracked separately.
   ============================================================ */

const $ = id => document.getElementById(id);

const state = {
    sales: [],
    buyers: new Map(),
    trendChart: null,
    statusChart: null
};

const amount = value => Number(value) || 0;

const cssVar = name =>
    getComputedStyle(document.documentElement)
        .getPropertyValue(name)
        .trim();

const typeLabel = type => {
    if (type === "e-payment") return "E-payment";
    if (type === "cash") return "Cash";
    return "-";
};

const isCancelled = sale =>
    String(sale.sale_status || "").toLowerCase() === "cancelled";

const isPaid = sale =>
    sale.payment_status === "paid";

const isUnpaid = sale =>
    sale.payment_status === "unpaid" && !isCancelled(sale);

const isRefunded = sale =>
    sale.payment_status === "refunded";

/*
 * Use amount_paid when available.
 * Fall back to total_amount for older paid records
 * where amount_paid has not been populated.
 */
const collectedAmount = sale => {
    const paidAmount = amount(sale.amount_paid);

    return paidAmount > 0
        ? paidAmount
        : amount(sale.total_amount);
};

const buyerLabel = sale =>
    state.buyers.get(sale.buyer_id) ||
    `Buyer ${String(sale.buyer_id || "").slice(0, 8)}`;

/* ============================================================
   DATA
   ============================================================ */

async function loadSales() {
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

    return data || [];
}

async function loadBuyers() {
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
            "Unable to load buyer business names:",
            error.message
        );
        return;
    }

    state.buyers.clear();

    (data || []).forEach(buyer => {
        if (buyer.user_id && buyer.business_name) {
            state.buyers.set(
                buyer.user_id,
                buyer.business_name
            );
        }
    });
}

/* ============================================================
   FILTER HELPERS
   ============================================================ */
const paidSales = () =>
    state.sales.filter(isPaid);

const completedSales = () =>
    state.sales.filter(sale =>
        String(sale.sale_status || "").toLowerCase() === "completed"
    );

const cancelledSales = () =>
    state.sales.filter(isCancelled);

const refundedSales = () =>
    state.sales.filter(isRefunded);

/* ============================================================
   SUMMARY CARDS
   ============================================================ */

function renderStats() {
    const paid = paidSales();
    const completed = completedSales();
    const cancelled = cancelledSales();
    const refunded = refundedSales();

    const totalCollections = paid.reduce(
        (sum, sale) => sum + collectedAmount(sale),
        0
    );

    $("statTotal").textContent = formatPeso(totalCollections);
    $("statCompleted").textContent = completed.length;
    $("statCancelled").textContent = cancelled.length;
    $("statRefunded").textContent = refunded.length;
}

/* ============================================================
   CHART DEFAULTS
   ============================================================ */

function chartDefaults() {
    if (!window.Chart) return;

    window.Chart.defaults.font.family =
        "'Poppins', system-ui, sans-serif";

    window.Chart.defaults.color =
        cssVar("--secondary-text");
}

const dayKey = date =>
    date.toLocaleDateString("en-CA");

/* ============================================================
   COLLECTION TRENDS
   ============================================================ */

function renderTrend() {
    if (!window.Chart) return;

    const days = Number($("trendRange").value) || 30;

    const totals = new Map();
    const labels = [];

    for (let i = days - 1; i >= 0; i--) {
        const date = new Date();

        date.setDate(date.getDate() - i);

        const key = dayKey(date);

        totals.set(key, 0);
        labels.push(key);
    }

    paidSales().forEach(sale => {
        if (!sale.paid_at) return;

        const key = dayKey(
            new Date(sale.paid_at)
        );

        if (totals.has(key)) {
            totals.set(
                key,
                totals.get(key) + collectedAmount(sale)
            );
        }
    });

    const values = labels.map(key => totals.get(key));

    const hasData = values.some(value => value > 0);

    $("trendEmpty").hidden = hasData;
    $("trendChart").parentElement.hidden = !hasData;

    if (state.trendChart) {
        state.trendChart.destroy();
        state.trendChart = null;
    }

    if (!hasData) return;

    const primary = cssVar("--primary-color");

    state.trendChart = new window.Chart(
        $("trendChart"),
        {
            type: "line",

            data: {
                labels: labels.map(key =>
                    new Date(`${key}T00:00:00`).toLocaleDateString(
                        "en-PH",
                        {
                            month: "short",
                            day: "numeric"
                        }
                    )
                ),

                datasets: [{
                    label: "Collections",
                    data: values,
                    borderColor: primary,
                    backgroundColor:
                        `color-mix(in srgb, ${primary} 15%, transparent)`,
                    fill: true,
                    tension: 0.3,
                    pointRadius: days > 30 ? 0 : 3
                }]
            },

            options: {
                responsive: true,
                maintainAspectRatio: false,

                plugins: {
                    legend: {
                        display: false
                    },

                    tooltip: {
                        callbacks: {
                            label: context =>
                                formatPeso(context.parsed.y)
                        }
                    }
                },

                scales: {
                    x: {
                        grid: {
                            display: false
                        },
                        ticks: {
                            maxTicksLimit: 8
                        }
                    },

                    y: {
                        beginAtZero: true,

                        grid: {
                            color: cssVar("--border")
                        },

                        ticks: {
                            callback: value =>
                                formatPeso(value)
                        }
                    }
                }
            }
        }
    );
}

/* ============================================================
   ORDER STATUS OVERVIEW
   Cancelled unpaid orders are excluded.
   ============================================================ */

function renderStatusChart() {
    if (!window.Chart) return;

    const counts = [
        completedSales().length,
        cancelledSales().length
    ];

    const hasData = counts.some(count => count > 0);

    $("statusEmpty").hidden = hasData;
    $("statusChart").parentElement.hidden = !hasData;

    if (state.statusChart) {
        state.statusChart.destroy();
        state.statusChart = null;
    }

    if (!hasData) return;

    state.statusChart = new window.Chart(
        $("statusChart"),
        {
            type: "doughnut",
            data: {
                labels: [
                    "Completed Orders",
                    "Cancelled Orders"
                ],
                datasets: [{
                    data: counts,
                    backgroundColor: [
                        cssVar("--success"),
                        cssVar("--secondary-text")
                    ],
                    borderColor: cssVar("--surface-card"),
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: "62%",
                plugins: {
                    legend: {
                        position: "bottom"
                    }
                }
            }
        }
    );
}

function renderCharts() {
    chartDefaults();
    renderTrend();
    renderStatusChart();
}

/* ============================================================
   RECENT PAYMENT TRANSACTIONS
   ============================================================ */

function renderRecent() {
    const rows = state.sales
        .filter(sale =>
            ["paid", "refunded"].includes(sale.payment_status) &&
            sale.paid_at
        )
        .sort((a, b) =>
            new Date(b.paid_at) - new Date(a.paid_at)
        )
        .slice(0, 5);

    $("recentEmpty").hidden = rows.length > 0;

    $("recentBody").closest(".table-wrap").hidden =
        rows.length === 0;

    $("recentBody").innerHTML = rows
        .map(sale => `
            <tr>
                <td>
                    ${escapeHtml(
                        String(sale.sale_id)
                            .slice(0, 8)
                            .toUpperCase()
                    )}
                </td>

                <td>
                    ${escapeHtml(buyerLabel(sale))}
                </td>

                <td>
                    ${escapeHtml(typeLabel(sale.payment_type))}
                </td>

                <td>
                    ${formatPeso(
                        sale.payment_status === "refunded"
                            ? 0
                            : collectedAmount(sale)
                    )}
                </td>

                <td>
                    ${formatDate(sale.paid_at)}
                </td>

                <td>
                    <span class="status-badge status-badge--${escapeHtml(sale.payment_status)}">
                        ${escapeHtml(sale.payment_status)}
                    </span>
                </td>
            </tr>
        `)
        .join("");
}

/* ============================================================
   INITIALIZATION
   ============================================================ */

async function initializeDashboard() {
    try {
        const context = await initAccountantPage();

        if (!context) return;

        state.sales = await loadSales();

        /*
         * Buyer lookup is secondary.
         * A buyer_details RLS error should not prevent
         * the financial dashboard from displaying.
         */
        await loadBuyers();

        $("loadingState").hidden = true;
        $("dashboardContent").hidden = false;

        renderStats();
        renderRecent();
        renderCharts();

        $("trendRange").addEventListener(
            "change",
            renderTrend
        );

        /*
         * Redraw charts when light/dark theme changes.
         */
        const themeObserver = new MutationObserver(() => {
            renderCharts();
        });

        themeObserver.observe(
            document.documentElement,
            {
                attributes: true,
                attributeFilter: ["data-theme"]
            }
        );

    } catch (error) {
        console.error(
            "Accountant dashboard failed:",
            error
        );

        $("loadingState").hidden = true;
        $("errorState").hidden = false;

        $("errorState").textContent =
            "Unable to load the dashboard. Please refresh the page or log in again.";
    }
}

initializeDashboard();
