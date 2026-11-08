import { supabase } from "../connection.js";
import {
    initAccountantPage,
    escapeHtml,
    formatPeso,
    formatDate,
    showToast
} from "./main.js";

/* ============================================================
   TANIKALA - ACCOUNTANT REPORTS
   Same design as the Farm Manager reports page:
   filter panel -> stats row -> one CARD PER REPORT
   (Preview + Download CSV) -> preview panel with table + pager.

   Reports:
   1. Sales Report            4. Monthly Sales Report
   2. Delivery Report         5. Payment Report
   3. Best-Selling Produce

   Sources: accountant_farm_assignments, staff_accounts,
            warehouse_sale_items, warehouse_sales, buyer_details

   Rules:
   - Revenue = paid transactions only (amount_paid, fallback total_amount).
   - Cancelled + unpaid orders are not orders / not collectible / not revenue.
   - Refunded transactions are tracked separately, never in collections.
   - Order status is separate from payment status.
   - Date filters use the order date (created_at).
   - Sale amounts are prorated to the farm(s) in scope, so an accountant
     never sees another farm's share of a mixed sale.

   The page content is built inside .dashboard-content, and the styles
   are injected by this file, so no HTML or CSS changes are needed.
   ============================================================ */

const PAGE_SIZE = 10;
const CHUNK = 100;
const OWNER_KEYS = [
    "accountant_id",
    "accountant_user_id",
    "user_id",
    "staff_id",
    "staff_account_id",
    "profile_id"
];

const SVG_NS = "http://www.w3.org/2000/svg";

const ICON = {
    chart: ["M4 20V10", "M10 20V4", "M16 20v-8", "M22 20H2"],
    receipt: ["M6 3h12v18l-3-2-3 2-3-2-3 2V3Z", "M9 8h6", "M9 12h6"],
    wallet: [
        "M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z",
        "M3 7l2-3h12",
        "M16 14h2"
    ],
    truck: [
        "M2 7h11v9H2Z",
        "M13 10h4l3 3v3h-7",
        "M6 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z",
        "M17 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"
    ],
    calendar: ["M4 6h16v15H4Z", "M4 10h16", "M8 3v4", "M16 3v4"],
    basket: [
        "M7 10V8a5 5 0 0 1 10 0v2",
        "M3 10h18l-1.5 9a2 2 0 0 1-2 1.7h-11a2 2 0 0 1-2-1.7L3 10Z",
        "M9 14v3",
        "M15 14v3"
    ],
    clock: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M12 7v5l3 2"],
    download: ["M12 3v12", "m7 10 5 5 5-5", "M4 21h16"],
    print: ["M7 9V3h10v6", "M7 17H4v-6h16v6h-3", "M7 14h10v7H7Z"],
    eye: [
        "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z",
        "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
    ]
};

function icon(paths, size = 20) {
    const svg = document.createElementNS(SVG_NS, "svg");

    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", size);
    svg.setAttribute("height", size);
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.8");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");

    for (const d of paths) {
        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", d);
        svg.append(path);
    }

    return svg;
}

/* Tiny DOM helper: h(tag, attrs, ...children) */
function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);

    for (const [key, value] of Object.entries(attrs || {})) {
        if (value === false || value === null || value === undefined) continue;

        if (key === "class") el.className = value;
        else if (key.startsWith("on") && typeof value === "function") {
            el.addEventListener(key.slice(2), value);
        } else if (value === true) el.setAttribute(key, "");
        else el.setAttribute(key, value);
    }

    children.flat(Infinity).forEach(child => {
        if (child === null || child === undefined || child === false) return;
        el.append(child instanceof Node ? child : String(child));
    });

    return el;
}

/* ============================================================
   STYLES (scoped with the ar- prefix)
   ============================================================ */

function injectStyles() {
    if (document.getElementById("ar-styles")) return;

    const style = document.createElement("style");
    style.id = "ar-styles";
    style.textContent = `
    .ar-dash { display: grid; gap: 20px; }
    .ar-panel {
        background: var(--surface-card, #fff);
        border: 1px solid var(--border, #e5e7eb);
        border-radius: 18px;
        padding: 24px;
        min-width: 0;
    }
    .ar-filters { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; }
    .ar-field { display: grid; gap: 6px; font-size: .85rem; color: var(--secondary-text, #6b7280); }
    .ar-field select, .ar-field input, .ar-search {
        padding: 11px 14px;
        border: 1px solid var(--border, #e5e7eb);
        border-radius: 12px;
        background: transparent;
        color: inherit;
        font: inherit;
    }
    .ar-field select option { color: #111; }
    .ar-note { font-size: .8rem; color: var(--secondary-text, #6b7280); }
    .ar-error { color: var(--error, #dc2626); width: 100%; font-size: .85rem; }

    .ar-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
    .ar-stat {
        display: flex; align-items: center; gap: 16px;
        background: var(--surface-card, #fff);
        border: 1px solid var(--border, #e5e7eb);
        border-radius: 18px;
        padding: 22px;
    }
    .ar-icon {
        flex: none; width: 56px; height: 56px; border-radius: 16px;
        display: grid; place-items: center;
        color: var(--c);
        background: color-mix(in srgb, var(--c) 16%, transparent);
    }
    .ar-stat-body { display: grid; gap: 2px; min-width: 0; }
    .ar-stat-label { font-weight: 600; font-size: .9rem; }
    .ar-stat-value { font-size: 1.7rem; line-height: 1.2; overflow-wrap: anywhere; }
    .ar-stat-body small { color: var(--secondary-text, #6b7280); }

    .ar-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
    .ar-card {
        display: flex; flex-direction: column; gap: 14px;
        border-top: 3px solid var(--c);
        cursor: pointer;
        transition: box-shadow .15s ease, transform .15s ease;
    }
    .ar-card:hover { transform: translateY(-2px); }
    .ar-card.on { box-shadow: 0 0 0 2px color-mix(in srgb, var(--c) 75%, transparent); }
    .ar-card-top { display: flex; justify-content: space-between; align-items: flex-start; }
    .ar-card h3 { margin: 0 0 6px; font-size: 1.15rem; }
    .ar-card p { margin: 0; color: var(--secondary-text, #6b7280); }
    .ar-card-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: auto; }

    .ar-pill {
        display: inline-flex; align-items: center;
        padding: 4px 12px; border-radius: 999px;
        font-size: .8rem; font-weight: 600;
        background: color-mix(in srgb, var(--secondary-text, #888) 18%, transparent);
    }

    .ar-btn {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 10px 16px; border-radius: 12px;
        border: 1px solid transparent;
        font: inherit; font-weight: 500; cursor: pointer;
        background: var(--primary-color, #2f7d32); color: #fff;
    }
    .ar-btn.ghost {
        background: color-mix(in srgb, var(--primary-color, #2f7d32) 14%, transparent);
        color: var(--primary-color, #2f7d32);
    }
    .ar-btn:disabled { opacity: .5; cursor: not-allowed; }

    .ar-preview-head { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 8px; }
    .ar-preview-head h3 { margin: 0 0 4px; font-size: 1.2rem; }
    .ar-preview-head p { margin: 0; color: var(--secondary-text, #6b7280); }
    .ar-head-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .ar-summary { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0; }
    .ar-charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin: 8px 0 18px; }
    .ar-chart h4 { margin: 0 0 8px; font-size: .95rem; }
    .ar-chart-wrap { position: relative; height: 260px; }
    .ar-toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; margin-bottom: 12px; }

    .ar-table-wrap { overflow-x: auto; }
    .ar-table { width: 100%; border-collapse: collapse; }
    .ar-table th, .ar-table td { padding: 14px 16px; text-align: left; white-space: nowrap; }
    .ar-table th { color: var(--secondary-text, #6b7280); font-weight: 500; border-bottom: 1px solid var(--border, #e5e7eb); cursor: pointer; user-select: none; }
    .ar-table td { border-bottom: 1px solid var(--border, #e5e7eb); }
    .ar-table td.num, .ar-table th.num { text-align: right; }
    .ar-table tbody tr:last-child td { border-bottom: 0; }

    .ar-badge {
        display: inline-block; padding: 4px 12px; border-radius: 999px;
        font-size: .8rem; font-weight: 500;
        color: var(--secondary-text, #6b7280);
        background: color-mix(in srgb, var(--secondary-text, #888) 18%, transparent);
    }
    .ar-badge--paid, .ar-badge--delivered, .ar-badge--completed {
        color: var(--success, #16a34a);
        background: color-mix(in srgb, var(--success, #16a34a) 18%, transparent);
    }
    .ar-badge--unpaid, .ar-badge--pending {
        color: var(--warning, #d97706);
        background: color-mix(in srgb, var(--warning, #d97706) 18%, transparent);
    }
    .ar-badge--refunded, .ar-badge--cancelled {
        color: var(--error, #dc2626);
        background: color-mix(in srgb, var(--error, #dc2626) 16%, transparent);
    }
    .ar-badge--in-transit, .ar-badge--e-payment {
        color: var(--primary-color, #2f7d32);
        background: color-mix(in srgb, var(--primary-color, #2f7d32) 16%, transparent);
    }

    .ar-pager { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-top: 14px; }
    .ar-pager-controls { display: flex; align-items: center; gap: 10px; }
    .ar-empty { margin: 16px 0; color: var(--secondary-text, #6b7280); text-align: center; }
    .ar-loading { color: var(--secondary-text, #6b7280); }
    .ar-error-box { display: grid; gap: 12px; justify-items: start; color: var(--error, #dc2626); }

    @media (max-width: 640px) {
        .ar-panel { padding: 16px; }
        .ar-stat { padding: 16px; }
    }
    `;

    document.head.append(style);
}

/* ============================================================
   MODULE STATE
   ============================================================ */

const data = {
    user: null,
    farms: [],        // { id, name }
    records: [],      // every sale joined with its in-scope items
    buyers: new Map()
};

let themeObserver = null;

/* ============================================================
   HELPERS
   ============================================================ */

const amount = value => Number(value) || 0;
const round2 = value => Math.round(amount(value) * 100) / 100;
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

const cssVar = (name, fallback = "") =>
    getComputedStyle(document.documentElement)
        .getPropertyValue(name)
        .trim() || fallback;

const dayKey = date => date.toLocaleDateString("en-CA");
const monthKey = date => dayKey(date).slice(0, 7);

const startOfDay = date =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate());

const endOfDay = date =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);

const parseInputDate = (value, end = false) => {
    if (!value) return null;
    const date = new Date(`${value}T${end ? "23:59:59.999" : "00:00:00"}`);
    return Number.isNaN(date.getTime()) ? null : date;
};

const toDate = value => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

const formatNumber = value =>
    new Intl.NumberFormat("en-PH", { maximumFractionDigits: 2 }).format(amount(value));

const shortId = id => String(id || "").slice(0, 8).toUpperCase() || "-";

const titleCase = value =>
    String(value || "-")
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, ch => ch.toUpperCase());

const slug = value =>
    String(value || "unknown").toLowerCase().replace(/[^a-z0-9_-]+/g, "-");

const chunk = (list, size) => {
    const out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
};

const typeLabel = type => {
    if (type === "e-payment") return "E-payment";
    if (type === "cash") return "Cash";
    return "Unspecified";
};

/* ---------- Business-rule predicates ---------- */
const saleStatus = sale => String(sale.sale_status || "").toLowerCase();
const isCancelled = sale => saleStatus(sale) === "cancelled";
const isPaid = sale => sale.payment_status === "paid";
const isRefunded = sale => sale.payment_status === "refunded";
const isUnpaid = sale => sale.payment_status === "unpaid" && !isCancelled(sale);
const isCancelledUnpaid = sale =>
    sale.payment_status === "unpaid" && isCancelled(sale);

const isDelivered = sale =>
    !isCancelled(sale) &&
    (Boolean(sale.delivered_at || sale.completed_at) ||
        ["delivered", "completed"].includes(saleStatus(sale)));

const deliveryState = sale => {
    if (isCancelled(sale)) return "cancelled";
    if (isDelivered(sale)) return "delivered";
    if (
        sale.shipped_at ||
        ["shipped", "in_transit", "in transit", "out_for_delivery"].includes(saleStatus(sale))
    ) {
        return "in transit";
    }
    return "pending";
};

/* Use amount_paid when available, fall back to total_amount. */
const collectedAmount = sale => {
    const paidAmount = amount(sale.amount_paid);
    return paidAmount > 0 ? paidAmount : amount(sale.total_amount);
};

const lineTotal = item =>
    amount(item.line_total) || amount(item.quantity) * amount(item.unit_price);

const buyerLabel = sale =>
    data.buyers.get(sale.buyer_id) ||
    `Buyer ${String(sale.buyer_id || "").slice(0, 8)}`;

const farmLabel = farmId =>
    data.farms.find(farm => farm.id === farmId)?.name ||
    `Farm ${String(farmId || "").slice(0, 8)}`;

/* ============================================================
   DATA LOADING
   ============================================================ */

async function fetchPaged(buildQuery) {
    const size = 1000;
    const all = [];
    let from = 0;

    for (;;) {
        const { data: rows, error } = await buildQuery().range(from, from + size - 1);
        if (error) throw error;

        all.push(...(rows || []));

        if (!rows || rows.length < size) break;
        from += size;
    }

    return all;
}

async function loadAssignedFarms(user) {
    const { data: rows, error } = await supabase
        .from("accountant_farm_assignments")
        .select("*");

    if (error) throw error;

    /* Every id this accountant may be stored under. */
    const ownerIds = new Set([user.id]);

    const { data: staff, error: staffError } = await supabase
        .from("staff_accounts")
        .select("*");

    if (staffError) {
        console.warn("Unable to read staff_accounts:", staffError.message);
    } else {
        (staff || []).forEach(row => {
            const isMe = [row.user_id, row.id, row.profile_id, row.auth_user_id]
                .some(value => value && value === user.id);

            if (isMe) {
                [row.id, row.staff_id, row.user_id]
                    .filter(Boolean)
                    .forEach(value => ownerIds.add(value));
            }
        });
    }

    const list = rows || [];
    const hasOwnerKey = list.some(row => OWNER_KEYS.some(key => key in row));

    /* If an owner column exists, require a match. Otherwise rely on RLS. */
    const mine = (hasOwnerKey
        ? list.filter(row =>
            OWNER_KEYS.some(key => row[key] && ownerIds.has(row[key])))
        : list
    ).filter(row =>
        row.is_active !== false &&
        !["inactive", "revoked", "removed"]
            .includes(String(row.status || "").toLowerCase())
    );

    const farms = new Map();

    mine.forEach(row => {
        if (!row.farm_id || farms.has(row.farm_id)) return;

        farms.set(row.farm_id, {
            id: row.farm_id,
            name: row.farm_name || row.name || `Farm ${String(row.farm_id).slice(0, 8)}`
        });
    });

    return [...farms.values()];
}

async function loadItems(farmIds) {
    const items = new Map();

    for (const ids of chunk(farmIds, CHUNK)) {
        const rows = await fetchPaged(() =>
            supabase
                .from("warehouse_sale_items")
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
                .in("farm_id", ids)
                .order("sale_item_id", { ascending: true })
        );

        rows.forEach(row => items.set(row.sale_item_id, row)); // de-duplicated
    }

    return [...items.values()];
}

async function loadSalesByIds(saleIds) {
    const sales = new Map();

    for (const ids of chunk(saleIds, CHUNK)) {
        const { data: rows, error } = await supabase
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
                delivered_at,
                completed_at,
                shipped_at,
                expected_delivery_at,
                created_at
            `)
            .in("sale_id", ids);

        if (error) throw error;

        (rows || []).forEach(row => sales.set(row.sale_id, row));
    }

    return [...sales.values()];
}

async function loadBuyers(sales) {
    const buyerIds = [...new Set(sales.map(sale => sale.buyer_id).filter(Boolean))];

    data.buyers.clear();
    if (!buyerIds.length) return;

    for (const ids of chunk(buyerIds, CHUNK)) {
        const { data: rows, error } = await supabase
            .from("buyer_details")
            .select("user_id, business_name")
            .in("user_id", ids);

        if (error) {
            /* Secondary lookup: never block the reports. */
            console.warn("Unable to load buyer business names:", error.message);
            return;
        }

        (rows || []).forEach(buyer => {
            if (buyer.user_id && buyer.business_name) {
                data.buyers.set(buyer.user_id, buyer.business_name);
            }
        });
    }
}

async function loadAllData(user) {
    data.user = user;
    data.farms = await loadAssignedFarms(user);

    if (!data.farms.length) {
        data.records = [];
        return;
    }

    const items = await loadItems(data.farms.map(farm => farm.id));
    const saleIds = [...new Set(items.map(item => item.sale_id).filter(Boolean))];
    const sales = saleIds.length ? await loadSalesByIds(saleIds) : [];

    await loadBuyers(sales);

    const itemsBySale = new Map();

    items.forEach(item => {
        if (!itemsBySale.has(item.sale_id)) itemsBySale.set(item.sale_id, []);
        itemsBySale.get(item.sale_id).push(item);
    });

    data.records = sales.map(sale => ({
        sale,
        items: itemsBySale.get(sale.sale_id) || []
    }));
}

/* ============================================================
   FILTERING + AGGREGATION
   ============================================================ */

function getRange(filters) {
    const now = new Date();
    const today = endOfDay(now);

    if (filters.from || filters.to || filters.period === "custom") {
        return {
            label: `${filters.from || "Start"} to ${filters.to || "Today"}`,
            start: parseInputDate(filters.from),
            end: parseInputDate(filters.to, true)
        };
    }

    switch (filters.period) {
        case "this-month":
            return {
                label: "This month",
                start: new Date(now.getFullYear(), now.getMonth(), 1),
                end: today
            };
        case "last-month":
            return {
                label: "Last month",
                start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
                end: endOfDay(new Date(now.getFullYear(), now.getMonth(), 0))
            };
        case "last-3-months":
            return {
                label: "Last 3 months",
                start: startOfDay(new Date(now.getFullYear(), now.getMonth() - 3, now.getDate())),
                end: today
            };
        case "this-year":
            return {
                label: "This year",
                start: new Date(now.getFullYear(), 0, 1),
                end: today
            };
        default:
            return { label: "All time", start: null, end: null };
    }
}

/*
 * Scope records to the chosen farm (or all assigned farms) and prorate
 * the sale amounts to the in-scope share of the sale.
 */
function scopeRecords(records, farmId) {
    const out = [];

    records.forEach(record => {
        const items = farmId
            ? record.items.filter(item => item.farm_id === farmId)
            : record.items;

        if (!items.length) return;

        const lines = items.reduce((sum, item) => sum + lineTotal(item), 0);
        const total = amount(record.sale.total_amount);

        let factor = 1;

        if (total > 0 && lines > 0) {
            const ratio = lines / total;
            factor = ratio >= 0.999 ? 1 : ratio;
        }

        out.push({
            sale: record.sale,
            items,
            total: total * factor,
            collected: collectedAmount(record.sale) * factor
        });
    });

    return out;
}

function filterRecords(filters, range) {
    return scopeRecords(data.records, filters.farm).filter(record => {
        const created = toDate(record.sale.created_at);

        if (range.start && (!created || created < range.start)) return false;
        if (range.end && (!created || created > range.end)) return false;
        if (filters.status && record.sale.payment_status !== filters.status) return false;
        if (filters.type && record.sale.payment_type !== filters.type) return false;

        return true;
    });
}

function summarize(records) {
    const s = {
        revenue: 0,
        orders: 0,
        paid: 0,
        unpaid: 0,
        refunded: 0,
        cash: 0,
        epay: 0,
        unpaidAmount: 0,
        refundedAmount: 0,
        deliveries: 0,
        delivered: 0,
        pending: 0,
        inTransit: 0,
        cancelled: 0
    };

    records.forEach(record => {
        const sale = record.sale;

        if (isCancelled(sale)) s.cancelled++;

        /* Cancelled unpaid orders are not orders, sales or collectible. */
        if (isCancelledUnpaid(sale)) return;

        s.orders++;

        if (isPaid(sale)) {
            s.paid++;
            s.revenue += record.collected;

            if (sale.payment_type === "cash") s.cash += record.collected;
            else if (sale.payment_type === "e-payment") s.epay += record.collected;
        } else if (isRefunded(sale)) {
            s.refunded++;
            s.refundedAmount += record.collected;
        } else if (isUnpaid(sale)) {
            s.unpaid++;
            s.unpaidAmount += record.total;
        }

        const delivery = deliveryState(sale);

        if (delivery !== "cancelled") {
            s.deliveries++;
            if (delivery === "delivered") s.delivered++;
            else s.pending++;
            if (delivery === "in transit") s.inTransit++;
        }
    });

    return s;
}

function buildProduceRows(records, metric) {
    const groups = new Map();

    /* Only paid sales count as sold revenue. */
    records.filter(record => isPaid(record.sale)).forEach(record => {
        record.items.forEach(item => {
            const name = item.crop_name || "Unnamed produce";
            const unit = item.unit || "";
            const key = `${item.produce_id || name.toLowerCase()}|${unit}`;

            if (!groups.has(key)) {
                groups.set(key, { name, unit, quantity: 0, revenue: 0, sales: new Set() });
            }

            const group = groups.get(key);
            group.quantity += amount(item.quantity);
            group.revenue += lineTotal(item);
            group.sales.add(record.sale.sale_id);
        });
    });

    return [...groups.values()]
        .map(group => ({
            name: group.name,
            unit: group.unit,
            quantity: group.quantity,
            revenue: group.revenue,
            transactions: group.sales.size
        }))
        .sort((a, b) => b[metric] - a[metric])
        .map((row, index) => ({ ...row, rank: index + 1 }));
}

function buildMonthlyRows(records) {
    const months = new Map();

    records.forEach(record => {
        const sale = record.sale;
        const created = toDate(sale.created_at);

        if (!created || isCancelledUnpaid(sale)) return;

        const key = monthKey(created);

        if (!months.has(key)) {
            months.set(key, {
                key,
                label: new Date(`${key}-01T00:00:00`).toLocaleDateString("en-PH", {
                    month: "long",
                    year: "numeric"
                }),
                revenue: 0,
                orders: 0,
                paid: 0,
                refunded: 0
            });
        }

        const row = months.get(key);
        row.orders++;

        if (isPaid(sale)) {
            row.paid++;
            row.revenue += record.collected;
        } else if (isRefunded(sale)) {
            row.refunded++;
        }
    });

    const rows = [...months.values()].sort((a, b) => a.key.localeCompare(b.key));

    rows.forEach((row, index) => {
        const prev = rows[index - 1];
        row.change = prev && prev.revenue > 0
            ? ((row.revenue - prev.revenue) / prev.revenue) * 100
            : null;
    });

    return rows;
}

function buildPaymentRows(records) {
    const groups = new Map();

    records.forEach(record => {
        const sale = record.sale;
        if (isCancelledUnpaid(sale)) return;

        const status = ["paid", "unpaid", "refunded"].includes(sale.payment_status)
            ? sale.payment_status
            : null;

        if (!status) return;

        const type = ["cash", "e-payment"].includes(sale.payment_type)
            ? sale.payment_type
            : "unspecified";

        const key = `${type}|${status}`;

        if (!groups.has(key)) groups.set(key, { type, status, count: 0, amount: 0 });

        const group = groups.get(key);
        group.count++;
        group.amount += status === "unpaid" ? record.total : record.collected;
    });

    return [...groups.values()];
}

/* ---------- Time buckets for trend charts ---------- */
function makeBuckets(records, range) {
    const dates = records.map(record => toDate(record.sale.created_at)).filter(Boolean);

    if (!dates.length && !(range.start && range.end)) return null;

    const min = new Date(Math.min(...dates.map(date => date.getTime())));
    const max = new Date(Math.max(...dates.map(date => date.getTime())));

    let start = startOfDay(range.start || min);
    let end = startOfDay(range.end || max);

    if (start > end) [start, end] = [end, start];

    const days = Math.round((end - start) / 86400000) + 1;
    const gran = days <= 92 ? "day" : "month";

    const keys = [];
    const labels = [];

    if (gran === "day") {
        for (let i = 0; i < days; i++) {
            const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
            keys.push(dayKey(date));
            labels.push(date.toLocaleDateString("en-PH", { month: "short", day: "numeric" }));
        }
    } else {
        const cursor = new Date(start.getFullYear(), start.getMonth(), 1);

        while (cursor <= end) {
            keys.push(monthKey(cursor));
            labels.push(cursor.toLocaleDateString("en-PH", { month: "short", year: "numeric" }));
            cursor.setMonth(cursor.getMonth() + 1);
        }
    }

    return {
        keys,
        labels,
        keyOf: date => (gran === "day" ? dayKey(date) : monthKey(date))
    };
}

/* ============================================================
   COLUMN BUILDERS
   ============================================================ */

const col = {
    text: (key, label, get) => ({
        key,
        label,
        get,
        fmt: value => (value === null || value === undefined || value === "") ? "-" : String(value)
    }),
    num: (key, label, get) => ({
        key,
        label,
        get,
        num: true,
        fmt: value => formatNumber(value)
    }),
    money: (key, label, get) => ({
        key,
        label,
        get,
        num: true,
        fmt: value => formatPeso(value),
        csv: row => round2(get(row))
    }),
    date: (key, label, get) => ({
        key,
        label,
        get: row => toDate(get(row))?.getTime() ?? null,
        fmt: value => value === null ? "-" : formatDate(new Date(value).toISOString()),
        csv: row => {
            const date = toDate(get(row));
            return date ? dayKey(date) : "";
        }
    }),
    badge: (key, label, get) => ({
        key,
        label,
        get,
        fmt: value => titleCase(value),
        badge: true
    })
};

const recordFarms = record =>
    [...new Set(record.items.map(item => farmLabel(item.farm_id)))].join(", ");

/* ============================================================
   REPORT DEFINITIONS
   ============================================================ */

function buildReports({ records, summary: s, range, metric }) {
    const produceRows = buildProduceRows(records, metric);
    const monthlyRows = buildMonthlyRows(records);
    const paymentRows = buildPaymentRows(records);
    const ctx = { records, range, metric, s, monthlyRows, produceRows };

    return [
        {
            id: "sales-report",
            title: "Sales Report",
            description: "Orders with their payment status. Only paid transactions count as revenue.",
            iconPaths: ICON.chart,
            color: "var(--success, #16a34a)",
            sort: { key: "date", dir: "desc" },
            columns: [
                col.text("id", "Order", r => shortId(r.sale.sale_id)),
                col.date("date", "Order Date", r => r.sale.created_at),
                col.text("buyer", "Buyer", r => buyerLabel(r.sale)),
                col.text("farm", "Farm", r => recordFarms(r)),
                col.badge("type", "Payment Type", r => r.sale.payment_type || "unspecified"),
                col.badge("payment", "Payment Status", r => r.sale.payment_status),
                col.badge("order", "Order Status", r => r.sale.sale_status),
                col.money("total", "Order Amount", r => r.total),
                col.money("collected", "Collected", r => isPaid(r.sale) ? r.collected : 0)
            ],
            rows: records,
            summary: [
                ["Revenue", formatPeso(s.revenue)],
                ["Orders", s.orders],
                ["Paid", s.paid],
                ["Unpaid", s.unpaid],
                ["Refunded", s.refunded],
                ["Cash", formatPeso(s.cash)],
                ["E-payment", formatPeso(s.epay)]
            ],
            charts: [{ title: "Sales trend (collections)", build: () => salesTrendChart(ctx) }]
        },
        {
            id: "delivery-report",
            title: "Delivery Report",
            description: "Delivery progress based on the actual order status and delivery dates.",
            iconPaths: ICON.truck,
            color: "var(--primary-color, #2f7d32)",
            sort: { key: "ordered", dir: "desc" },
            columns: [
                col.text("id", "Order", r => shortId(r.sale.sale_id)),
                col.text("buyer", "Buyer", r => buyerLabel(r.sale)),
                col.text("farm", "Farm", r => recordFarms(r)),
                col.badge("state", "Delivery", r => deliveryState(r.sale)),
                col.badge("order", "Order Status", r => r.sale.sale_status),
                col.date("ordered", "Ordered", r => r.sale.created_at),
                col.date("shipped", "Shipped", r => r.sale.shipped_at),
                col.date("expected", "Expected", r => r.sale.expected_delivery_at),
                col.date("delivered", "Delivered", r => r.sale.delivered_at || r.sale.completed_at)
            ],
            rows: records,
            summary: [
                ["Total deliveries", s.deliveries],
                ["Completed", s.delivered],
                ["Pending", s.pending],
                ["Cancelled orders", s.cancelled]
            ],
            charts: [
                { title: "Delivery trend", build: () => deliveryTrendChart(ctx) },
                { title: "Delivery performance", build: () => deliveryStatusChart(ctx) }
            ]
        },
        {
            id: "best-selling-produce",
            title: "Best-Selling Produce",
            description: "Produce ranking from paid sales only. Switch between quantity and revenue.",
            iconPaths: ICON.basket,
            color: "var(--warning, #d97706)",
            sort: { key: "rank", dir: "asc" },
            hasMetric: true,
            columns: [
                col.num("rank", "Rank", r => r.rank),
                col.text("name", "Produce", r => r.name),
                col.text("unit", "Unit", r => r.unit),
                col.num("quantity", "Quantity Sold", r => r.quantity),
                col.money("revenue", "Revenue", r => r.revenue),
                col.num("transactions", "Transactions", r => r.transactions)
            ],
            rows: produceRows,
            summary: [
                ["Produce items", produceRows.length],
                ["Ranked by", metric === "revenue" ? "Revenue" : "Quantity sold"]
            ],
            charts: [{
                title: `Top produce by ${metric === "revenue" ? "revenue" : "quantity sold"}`,
                build: () => produceChart(ctx)
            }]
        },
        {
            id: "monthly-sales",
            title: "Monthly Sales Report",
            description: "Revenue, orders, paid and refunded transactions per month.",
            iconPaths: ICON.calendar,
            color: "#8b5cf6",
            sort: { key: "month", dir: "desc" },
            columns: [
                { ...col.text("month", "Month", r => r.key), fmt: (value, r) => r.label },
                col.money("revenue", "Sales Revenue", r => r.revenue),
                col.num("orders", "Orders", r => r.orders),
                col.num("paid", "Paid Transactions", r => r.paid),
                col.num("refunded", "Refunded Transactions", r => r.refunded),
                {
                    ...col.num("change", "vs Previous Month", r => r.change),
                    fmt: value => value === null || value === undefined
                        ? "-"
                        : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`,
                    csv: r => r.change === null ? "" : Number(r.change.toFixed(1))
                }
            ],
            rows: monthlyRows,
            summary: [
                ["Months", monthlyRows.length],
                ["Revenue", formatPeso(s.revenue)],
                ["Orders", s.orders],
                ["Refunded", s.refunded]
            ],
            charts: [{ title: "Sales comparison across months", build: () => monthlyChart(ctx) }]
        },
        {
            id: "payment-report",
            title: "Payment Report",
            description: "Cash vs e-payment collections and paid, unpaid and refunded transactions.",
            iconPaths: ICON.wallet,
            color: "var(--error, #dc2626)",
            sort: { key: "type", dir: "asc" },
            columns: [
                col.badge("type", "Payment Type", r => r.type),
                col.badge("status", "Payment Status", r => r.status),
                col.num("count", "Transactions", r => r.count),
                col.money("amount", "Amount", r => r.amount)
            ],
            rows: paymentRows,
            summary: [
                ["Cash", formatPeso(s.cash)],
                ["E-payment", formatPeso(s.epay)],
                ["Paid", s.paid],
                ["Unpaid", `${s.unpaid} (${formatPeso(s.unpaidAmount)})`],
                ["Refunded", `${s.refunded} (${formatPeso(s.refundedAmount)})`]
            ],
            charts: [
                { title: "Collections by payment type", build: () => paymentTypeChart(ctx) },
                { title: "Payment distribution", build: () => paymentStatusChart(ctx) }
            ]
        }
    ];
}

/* ============================================================
   CHART BUILDERS  (each returns { hasData, config })
   ============================================================ */

function chartDefaults() {
    if (!window.Chart) return;

    window.Chart.defaults.font.family = "'Poppins', system-ui, sans-serif";
    window.Chart.defaults.color = cssVar("--secondary-text", "#6b7280");
}

const palette = () => ({
    primary: cssVar("--primary-color", "#2f7d32"),
    success: cssVar("--success", "#16a34a"),
    warning: cssVar("--warning", "#d97706"),
    danger: cssVar("--error", "#dc2626"),
    muted: cssVar("--secondary-text", "#6b7280"),
    border: cssVar("--border", "#e5e7eb"),
    card: cssVar("--surface-card", "#ffffff")
});

const pesoAxis = border => ({
    beginAtZero: true,
    grid: { color: border },
    ticks: { callback: value => formatPeso(value) }
});

function salesTrendChart({ records, range }) {
    const c = palette();
    const buckets = makeBuckets(records, range);
    const totals = new Map();

    if (buckets) {
        buckets.keys.forEach(key => totals.set(key, 0));

        records.forEach(record => {
            const created = toDate(record.sale.created_at);
            if (!created || !isPaid(record.sale)) return;

            const key = buckets.keyOf(created);
            if (totals.has(key)) totals.set(key, totals.get(key) + record.collected);
        });
    }

    const values = buckets ? buckets.keys.map(key => totals.get(key)) : [];

    return {
        hasData: values.some(value => value > 0),
        config: {
            type: "line",
            data: {
                labels: buckets?.labels || [],
                datasets: [{
                    label: "Collections",
                    data: values,
                    borderColor: c.primary,
                    backgroundColor: `color-mix(in srgb, ${c.primary} 15%, transparent)`,
                    fill: true,
                    tension: 0.3,
                    pointRadius: values.length > 31 ? 0 : 3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: ctx => formatPeso(ctx.parsed.y) } }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } },
                    y: pesoAxis(c.border)
                }
            }
        }
    };
}

function deliveryTrendChart({ records, range }) {
    const c = palette();
    const buckets = makeBuckets(records, range);
    const placed = new Map();
    const delivered = new Map();

    if (buckets) {
        buckets.keys.forEach(key => {
            placed.set(key, 0);
            delivered.set(key, 0);
        });

        records.forEach(record => {
            const sale = record.sale;
            if (isCancelled(sale)) return;

            const created = toDate(sale.created_at);

            if (created) {
                const key = buckets.keyOf(created);
                if (placed.has(key)) placed.set(key, placed.get(key) + 1);
            }

            if (isDelivered(sale)) {
                const at = toDate(sale.delivered_at || sale.completed_at);

                if (at) {
                    const key = buckets.keyOf(at);
                    if (delivered.has(key)) delivered.set(key, delivered.get(key) + 1);
                }
            }
        });
    }

    const placedValues = buckets ? buckets.keys.map(key => placed.get(key)) : [];
    const deliveredValues = buckets ? buckets.keys.map(key => delivered.get(key)) : [];

    return {
        hasData: [...placedValues, ...deliveredValues].some(value => value > 0),
        config: {
            type: "line",
            data: {
                labels: buckets?.labels || [],
                datasets: [
                    {
                        label: "Orders placed",
                        data: placedValues,
                        borderColor: c.muted,
                        backgroundColor: "transparent",
                        tension: 0.3,
                        pointRadius: placedValues.length > 31 ? 0 : 3
                    },
                    {
                        label: "Delivered",
                        data: deliveredValues,
                        borderColor: c.success,
                        backgroundColor: `color-mix(in srgb, ${c.success} 15%, transparent)`,
                        fill: true,
                        tension: 0.3,
                        pointRadius: deliveredValues.length > 31 ? 0 : 3
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: "bottom" } },
                scales: {
                    x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } },
                    y: { beginAtZero: true, grid: { color: c.border }, ticks: { precision: 0 } }
                }
            }
        }
    };
}

const doughnut = (labels, values, colors, c, tooltipFmt) => ({
    hasData: values.some(value => value > 0),
    config: {
        type: "doughnut",
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: colors,
                borderColor: c.card,
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: "62%",
            plugins: {
                legend: { position: "bottom" },
                tooltip: tooltipFmt
                    ? { callbacks: { label: ctx => `${ctx.label}: ${tooltipFmt(ctx.parsed)}` } }
                    : {}
            }
        }
    }
});

function deliveryStatusChart({ s }) {
    const c = palette();

    return doughnut(
        ["Delivered", "In transit", "Pending", "Cancelled"],
        [s.delivered, s.inTransit, s.pending - s.inTransit, s.cancelled],
        [c.success, c.primary, c.warning, c.muted],
        c
    );
}

function paymentTypeChart({ s }) {
    const c = palette();

    return doughnut(
        ["Cash", "E-payment"],
        [round2(s.cash), round2(s.epay)],
        [c.warning, c.primary],
        c,
        formatPeso
    );
}

function paymentStatusChart({ s }) {
    const c = palette();

    return doughnut(
        ["Paid", "Unpaid", "Refunded"],
        [s.paid, s.unpaid, s.refunded],
        [c.success, c.warning, c.danger],
        c
    );
}

function produceChart({ produceRows, metric }) {
    const c = palette();
    const rows = produceRows.slice(0, 10);

    return {
        hasData: rows.length > 0,
        config: {
            type: "bar",
            data: {
                labels: rows.map(row => row.unit ? `${row.name} (${row.unit})` : row.name),
                datasets: [{
                    label: metric === "revenue" ? "Revenue" : "Quantity sold",
                    data: rows.map(row => round2(row[metric])),
                    backgroundColor: c.primary,
                    borderRadius: 4
                }]
            },
            options: {
                indexAxis: "y",
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: ctx => metric === "revenue"
                                ? formatPeso(ctx.parsed.x)
                                : `${formatNumber(ctx.parsed.x)} ${rows[ctx.dataIndex]?.unit || ""}`.trim()
                        }
                    }
                },
                scales: {
                    x: metric === "revenue"
                        ? pesoAxis(c.border)
                        : { beginAtZero: true, grid: { color: c.border } },
                    y: { grid: { display: false } }
                }
            }
        }
    };
}

function monthlyChart({ monthlyRows }) {
    const c = palette();

    return {
        hasData: monthlyRows.some(row => row.orders > 0),
        config: {
            type: "bar",
            data: {
                labels: monthlyRows.map(row => row.label),
                datasets: [{
                    label: "Sales revenue",
                    data: monthlyRows.map(row => round2(row.revenue)),
                    backgroundColor: c.primary,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: ctx => formatPeso(ctx.parsed.y),
                            afterLabel: ctx => {
                                const row = monthlyRows[ctx.dataIndex];

                                return row
                                    ? [
                                        `Orders: ${row.orders}`,
                                        `Paid: ${row.paid}`,
                                        `Refunded: ${row.refunded}`
                                    ]
                                    : [];
                            }
                        }
                    }
                },
                scales: {
                    x: { grid: { display: false } },
                    y: pesoAxis(c.border)
                }
            }
        }
    };
}

/* ============================================================
   TABLE HELPERS + EXPORTS
   ============================================================ */

function tableRows(report, { search = "", sort = report.sort } = {}) {
    let rows = report.rows;
    const term = search.trim().toLowerCase();

    if (term) {
        rows = rows.filter(row =>
            report.columns.some(column =>
                column.fmt(column.get(row), row).toLowerCase().includes(term)));
    }

    const sortCol = report.columns.find(column => column.key === sort.key);

    if (sortCol) {
        const dir = sort.dir === "asc" ? 1 : -1;

        rows = [...rows].sort((a, b) => {
            const av = sortCol.get(a);
            const bv = sortCol.get(b);

            if (av === null || av === undefined) return 1;
            if (bv === null || bv === undefined) return -1;
            if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;

            return String(av).localeCompare(String(bv), undefined, {
                numeric: true,
                sensitivity: "base"
            }) * dir;
        });
    }

    return rows;
}

/* ---------- CSV ---------- */
function csvCell(value) {
    if (value === null || value === undefined) return "";

    let text = String(value);

    /* Neutralise spreadsheet formula injection for text cells. */
    if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;

    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(report) {
    const rows = tableRows(report);

    const lines = [
        report.columns.map(column => csvCell(column.label)).join(","),
        ...rows.map(row =>
            report.columns
                .map(column => csvCell(column.csv ? column.csv(row) : column.fmt(column.get(row), row)))
                .join(","))
    ];

    const blob = new Blob(["\ufeff", lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 10);

    const link = document.createElement("a");
    link.href = url;
    link.download = `${report.id}-${stamp}.csv`;
    document.body.append(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);
}

/* ---------- Print ---------- */
function printReport(report, filterLines, chartImages) {
    const rows = tableRows(report);

    const head = report.columns
        .map(column => `<th${column.num ? ' class="num"' : ""}>${escapeHtml(column.label)}</th>`)
        .join("");

    const body = rows.length
        ? rows.map(row => `<tr>${report.columns.map(column =>
            `<td${column.num ? ' class="num"' : ""}>${escapeHtml(column.fmt(column.get(row), row))}</td>`
        ).join("")}</tr>`).join("")
        : `<tr><td colspan="${report.columns.length}">No records for the selected filters.</td></tr>`;

    const summary = report.summary
        .map(([label, value]) =>
            `<tr><td>${escapeHtml(label)}</td><td class="num">${escapeHtml(value)}</td></tr>`)
        .join("");

    const charts = chartImages
        .map(src => `<img class="chart" alt="" src="${src}">`)
        .join("");

    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Tanikala - ${escapeHtml(report.title)}</title>
<style>
    * { box-sizing: border-box; }
    body { font-family: 'Poppins', Arial, sans-serif; color: #111; margin: 24px; font-size: 12px; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    h2 { font-size: 14px; margin: 20px 0 8px; }
    .meta { margin-bottom: 12px; color: #444; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    th, td { border: 1px solid #ccc; padding: 5px 7px; text-align: left; }
    th { background: #f0f0f0; }
    td.num, th.num { text-align: right; }
    tr { page-break-inside: avoid; }
    .charts { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
    img.chart { width: 100%; max-height: 240px; object-fit: contain; }
    @media print { body { margin: 0; } }
</style></head>
<body>
    <h1>${escapeHtml(report.title)}</h1>
    <div class="meta">${filterLines.map(escapeHtml).join("<br>")}</div>
    <h2>Summary</h2>
    <table><tbody>${summary}</tbody></table>
    ${charts ? `<div class="charts">${charts}</div>` : ""}
    <h2>Details</h2>
    <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
</body></html>`;

    const win = window.open("", "_blank");

    if (!win) {
        showToast("Allow pop-ups to print the report.", "error");
        return;
    }

    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();

    setTimeout(() => win.print(), 400);
}

/* ============================================================
   BUILDING BLOCKS  (same look as the farm manager reports)
   ============================================================ */

const emptyNote = text => h("p", { class: "ar-empty" }, text);

function statCard({ label, value, sub, color, iconPaths }) {
    return h(
        "div",
        { class: "ar-stat", style: `--c:${color}` },
        h("span", { class: "ar-icon" }, icon(iconPaths, 26)),
        h(
            "div",
            { class: "ar-stat-body" },
            h("span", { class: "ar-stat-label" }, label),
            h("b", { class: "ar-stat-value" }, String(value)),
            h("small", {}, sub)
        )
    );
}

function statsRow(s) {
    return h(
        "div",
        { class: "ar-stats" },
        statCard({
            label: "Sales Revenue",
            value: formatPeso(s.revenue),
            sub: "Paid transactions only",
            color: "var(--success, #16a34a)",
            iconPaths: ICON.chart
        }),
        statCard({
            label: "Total Orders",
            value: s.orders,
            sub: "Excludes cancelled unpaid",
            color: "var(--primary-color, #2f7d32)",
            iconPaths: ICON.receipt
        }),
        statCard({
            label: "Paid Orders",
            value: s.paid,
            sub: "Collected",
            color: "var(--success, #16a34a)",
            iconPaths: ICON.wallet
        }),
        statCard({
            label: "Unpaid Orders",
            value: s.unpaid,
            sub: "Still collectible",
            color: "var(--warning, #d97706)",
            iconPaths: ICON.clock
        }),
        statCard({
            label: "Refunded Orders",
            value: s.refunded,
            sub: "Not in collections",
            color: "var(--error, #dc2626)",
            iconPaths: ICON.receipt
        })
    );
}

function reportCard(report, onPreview) {
    const previewButton = h(
        "button",
        {
            class: "ar-btn ghost",
            type: "button",
            "data-preview": report.id,
            "aria-pressed": "false",
            onclick: event => {
                event.stopPropagation();
                onPreview(report);
            }
        },
        icon(ICON.eye, 16),
        "Preview"
    );

    const downloadButton = h(
        "button",
        {
            class: "ar-btn",
            type: "button",
            disabled: report.rows.length === 0,
            title: report.rows.length === 0
                ? "No records to download"
                : `Download ${report.title} as CSV`,
            onclick: event => {
                event.stopPropagation();
                downloadCsv(report);
            }
        },
        icon(ICON.download, 16),
        "Download CSV"
    );

    return h(
        "section",
        {
            class: "ar-panel ar-card",
            style: `--c:${report.color}`,
            "data-report": report.id,
            onclick: () => onPreview(report)
        },
        h(
            "div",
            { class: "ar-card-top" },
            h("span", { class: "ar-icon" }, icon(report.iconPaths, 26)),
            h("span", { class: "ar-pill" }, plural(report.rows.length, "record"))
        ),
        h("div", {}, h("h3", {}, report.title), h("p", {}, report.description)),
        h("div", { class: "ar-card-actions" }, previewButton, downloadButton)
    );
}

function pager({ page, totalPages, total, start, end, onPage }) {
    const prev = h("button", { type: "button", class: "ar-btn ghost" }, "Previous");
    const next = h("button", { type: "button", class: "ar-btn ghost" }, "Next");

    prev.disabled = page <= 1;
    next.disabled = page >= totalPages;

    prev.addEventListener("click", () => onPage(page - 1));
    next.addEventListener("click", () => onPage(page + 1));

    return h(
        "div",
        { class: "ar-pager" },
        h("span", { class: "ar-note" }, `Showing ${start + 1}-${end} of ${total}`),
        h(
            "div",
            { class: "ar-pager-controls" },
            prev,
            h("span", { class: "ar-note" }, `Page ${page} of ${totalPages}`),
            next
        )
    );
}

const field = (label, control) =>
    h("label", { class: "ar-field" }, h("span", {}, label), control);

const select = (label, options) =>
    h(
        "select",
        { "aria-label": label },
        options.map(([value, text]) => h("option", { value }, text))
    );

/* ============================================================
   FILTER BAR
   ============================================================ */

function filterBar(filters, onChange) {
    const period = select("Date range", [
        ["all", "All time"],
        ["this-month", "This month"],
        ["last-month", "Last month"],
        ["last-3-months", "Last 3 months"],
        ["this-year", "This year"],
        ["custom", "Custom range"]
    ]);

    const from = h("input", { type: "date" });
    const to = h("input", { type: "date" });

    const status = select("Payment status", [
        ["", "All statuses"],
        ["paid", "Paid"],
        ["unpaid", "Unpaid"],
        ["refunded", "Refunded"]
    ]);

    const type = select("Payment type", [
        ["", "All types"],
        ["cash", "Cash"],
        ["e-payment", "E-payment"]
    ]);

    const farm = select("Farm", [
        ["", "All assigned farms"],
        ...data.farms.map(item => [item.id, item.name])
    ]);

    period.value = filters.period;

    const clear = h("button", { type: "button", class: "ar-btn ghost" }, "Clear");
    const summary = h("small", { class: "ar-note", role: "status", style: "margin-left:auto;" });
    const message = h("small", { class: "ar-error", role: "alert" });

    const isDefault = () =>
        filters.period === "all" &&
        !filters.from && !filters.to &&
        !filters.status && !filters.type && !filters.farm;

    const sync = () => {
        clear.disabled = isDefault();
    };

    const apply = () => {
        if (from.value && to.value && from.value > to.value) {
            message.textContent = "The start date is after the end date.";
            return;
        }

        message.textContent = "";
        filters.period = period.value;
        filters.from = from.value;
        filters.to = to.value;
        filters.status = status.value;
        filters.type = type.value;
        filters.farm = farm.value;
        sync();
        onChange();
    };

    period.addEventListener("change", () => {
        if (period.value !== "custom") {
            from.value = "";
            to.value = "";
        }
        apply();
    });

    [from, to].forEach(input =>
        input.addEventListener("change", () => {
            period.value = from.value || to.value ? "custom" : "all";
            apply();
        }));

    [status, type, farm].forEach(input => input.addEventListener("change", apply));

    clear.addEventListener("click", () => {
        period.value = "all";
        from.value = "";
        to.value = "";
        status.value = "";
        type.value = "";
        farm.value = "";
        apply();
    });

    sync();

    return {
        summary,
        element: h(
            "section",
            { class: "ar-panel ar-filters" },
            field("Date range", period),
            field("From", from),
            field("To", to),
            field("Payment status", status),
            field("Payment type", type),
            field("Farm", farm),
            clear,
            summary,
            message
        )
    };
}

/* ============================================================
   REPORTS PAGE
   ============================================================ */

function reportsPage() {
    const filters = { period: "all", from: "", to: "", status: "", type: "", farm: "" };

    const preview = h("div");
    const grid = h("div", { class: "ar-grid" });
    let statsEl = h("div");

    let reports = [];
    let currentId = null;
    let metric = "quantity";
    let range = getRange(filters);
    let charts = [];
    let chartSlots = [];

    const view = { page: 1, search: "", sort: { key: "", dir: "asc" }, holder: null };

    const currentReport = () => reports.find(report => report.id === currentId);

    const destroyCharts = () => {
        charts.forEach(chart => chart.destroy());
        charts = [];
    };

    const filterLines = () => [
        `Date range: ${range.label}`,
        `Payment status: ${filters.status ? titleCase(filters.status) : "All"}`,
        `Payment type: ${filters.type ? typeLabel(filters.type) : "All"}`,
        `Farm: ${filters.farm ? farmLabel(filters.farm) : "All assigned farms"}`,
        `Generated: ${new Date().toLocaleString("en-PH")}`
    ];

    const doPrint = report => {
        const light = document.documentElement.getAttribute("data-theme") !== "dark";
        const images = report.id === currentId && light
            ? charts.map(chart => chart.toBase64Image())
            : [];

        printReport(report, filterLines(), images);
    };

    /* ----- Table inside the preview panel ----- */
    const drawTable = () => {
        const report = currentReport();
        if (!report || !view.holder) return;

        const rows = tableRows(report, view);
        const total = rows.length;
        const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

        view.page = Math.min(Math.max(view.page, 1), totalPages);

        const start = (view.page - 1) * PAGE_SIZE;
        const end = Math.min(start + PAGE_SIZE, total);
        const shown = rows.slice(start, end);

        if (!shown.length) {
            view.holder.replaceChildren(
                emptyNote(
                    view.search
                        ? "No records match your search."
                        : "No records for the selected filters."
                )
            );
            return;
        }

        const headCells = report.columns.map(column => {
            const active = view.sort.key === column.key;

            const th = h(
                "th",
                {
                    class: column.num ? "num" : "",
                    "aria-sort": active
                        ? (view.sort.dir === "asc" ? "ascending" : "descending")
                        : "none"
                },
                column.label + (active ? (view.sort.dir === "asc" ? " ▲" : " ▼") : "")
            );

            th.addEventListener("click", () => {
                view.sort = {
                    key: column.key,
                    dir: active && view.sort.dir === "asc" ? "desc" : "asc"
                };
                drawTable();
            });

            return th;
        });

        const cell = (column, row) => {
            const raw = column.get(row);

            if (column.badge) {
                return h(
                    "td",
                    {},
                    h("span", { class: `ar-badge ar-badge--${slug(raw)}` }, titleCase(raw))
                );
            }

            return h("td", column.num ? { class: "num" } : {}, column.fmt(raw, row));
        };

        view.holder.replaceChildren(
            h(
                "div",
                { class: "ar-table-wrap" },
                h(
                    "table",
                    { class: "ar-table" },
                    h("thead", {}, h("tr", {}, headCells)),
                    h(
                        "tbody",
                        {},
                        shown.map(row =>
                            h("tr", {}, report.columns.map(column => cell(column, row))))
                    )
                )
            ),
            pager({
                page: view.page,
                totalPages,
                total,
                start,
                end,
                onPage: page => {
                    view.page = page;
                    drawTable();
                }
            })
        );
    };

    /* ----- Charts inside the preview panel ----- */
    const drawCharts = (report, slots) => {
        destroyCharts();
        chartDefaults();

        report.charts.forEach((definition, index) => {
            const slot = slots[index];
            const { hasData, config } = definition.build();

            slot.wrap.hidden = !hasData;
            slot.empty.hidden = hasData;

            if (hasData && window.Chart) {
                charts.push(new window.Chart(slot.canvas, config));
            }
        });
    };

    /* ----- Preview panel ----- */
    const show = (report, scroll = false) => {
        currentId = report.id;
        view.page = 1;
        view.search = "";
        view.sort = { ...report.sort };

        const search = h("input", {
            type: "search",
            class: "ar-search",
            placeholder: "Search this report…",
            "aria-label": "Search this report"
        });

        search.addEventListener("input", () => {
            view.search = search.value;
            view.page = 1;
            drawTable();
        });

        view.holder = h("div");

        const printButton = h(
            "button",
            {
                class: "ar-btn ghost",
                type: "button",
                disabled: report.rows.length === 0
            },
            icon(ICON.print, 16),
            "Print"
        );

        printButton.addEventListener("click", () => doPrint(report));

        const toolbar = h("div", { class: "ar-toolbar" }, field("Search", search));

        if (report.hasMetric) {
            const metricSelect = select("Rank by", [
                ["quantity", "Quantity sold"],
                ["revenue", "Revenue"]
            ]);

            metricSelect.value = metric;

            metricSelect.addEventListener("change", () => {
                metric = metricSelect.value;
                build();
            });

            toolbar.append(field("Rank by", metricSelect));
        }

        chartSlots = report.charts.map(definition => {
            const canvas = h("canvas", {});
            const wrap = h("div", { class: "ar-chart-wrap" }, canvas);
            const empty = emptyNote("No data to chart for the selected filters.");

            return {
                canvas,
                wrap,
                empty,
                element: h(
                    "div",
                    { class: "ar-chart" },
                    h("h4", {}, definition.title),
                    wrap,
                    empty
                )
            };
        });

        const panel = h(
            "section",
            { class: "ar-panel", id: "ar-report-preview" },
            h(
                "div",
                { class: "ar-preview-head" },
                h("div", {}, h("h3", {}, `${report.title} preview`), h("p", {}, report.description)),
                h(
                    "div",
                    { class: "ar-head-actions" },
                    printButton,
                    h("span", { class: "ar-pill" }, plural(report.rows.length, "record"))
                )
            ),
            h(
                "div",
                { class: "ar-summary" },
                report.summary.map(([label, value]) =>
                    h("span", { class: "ar-pill" }, `${label}: ${value}`))
            ),
            h("div", { class: "ar-charts" }, chartSlots.map(slot => slot.element)),
            toolbar,
            view.holder
        );

        preview.replaceChildren(panel);
        drawCharts(report, chartSlots);
        drawTable();

        for (const card of grid.children) {
            const selected = card.dataset.report === report.id;

            card.classList.toggle("on", selected);
            card
                .querySelector("[data-preview]")
                ?.setAttribute("aria-pressed", String(selected));
        }

        if (scroll) preview.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    /* ----- Rebuild everything from the current filters ----- */
    const build = () => {
        range = getRange(filters);

        const records = filterRecords(filters, range);
        const summary = summarize(records);

        reports = buildReports({ records, summary, range, metric });

        const nextStats = statsRow(summary);
        statsEl.replaceWith(nextStats);
        statsEl = nextStats;

        grid.replaceChildren(
            ...reports.map(report => reportCard(report, r => show(r, true)))
        );

        show(reports.find(report => report.id === currentId) ?? reports[0]);

        const active =
            filters.period !== "all" ||
            filters.from || filters.to ||
            filters.status || filters.type || filters.farm;

        bar.summary.textContent = active
            ? `Showing ${plural(records.length, "order")} • ${range.label}`
            : "";
    };

    const bar = filterBar(filters, build);

    /* Redraw charts when the light/dark theme changes. */
    themeObserver?.disconnect();
    themeObserver = new MutationObserver(() => {
        const report = currentReport();
        if (report && chartSlots.length) drawCharts(report, chartSlots);
    });
    themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"]
    });

    const page = h("div", { class: "ar-dash" }, bar.element, statsEl, grid, preview);

    build();

    return page;
}

/* ============================================================
   MOUNT
   ============================================================ */

async function load(root) {
    root.replaceChildren(
        h("section", { class: "ar-panel ar-loading", role: "status" }, "Loading reports…")
    );

    try {
        let user = data.user;

        if (!user) {
            const { data: auth, error } = await supabase.auth.getUser();
            if (error || !auth?.user) throw error || new Error("Not signed in.");
            user = auth.user;
        }

        await loadAllData(user);

        if (!data.farms.length) {
            root.replaceChildren(
                h(
                    "section",
                    { class: "ar-panel" },
                    emptyNote("No farms are currently assigned to your account.")
                )
            );
            return;
        }

        root.replaceChildren(reportsPage());
    } catch (error) {
        console.error("Failed to load reports:", error);

        const retry = h("button", { class: "ar-btn", type: "button" }, "Try Again");
        retry.addEventListener("click", () => load(root));

        root.replaceChildren(
            h(
                "section",
                { class: "ar-panel ar-error-box" },
                h("p", {}, "Could not load the reports."),
                retry
            )
        );
    }
}

async function initializeReports() {
    const root =
        document.querySelector(".dashboard-content") ||
        document.querySelector("main");

    if (!root) return;

    injectStyles();

    try {
        const context = await initAccountantPage();
        if (!context) return;

        data.user = context.user;

        await load(root);
    } catch (error) {
        console.error("Accountant reports failed:", error);

        root.replaceChildren(
            h(
                "section",
                { class: "ar-panel ar-error-box" },
                h("p", {}, "Unable to load the reports. Please refresh or log in again.")
            )
        );
    }
}

initializeReports();