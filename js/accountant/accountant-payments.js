import { supabase } from "../connection.js";
import {
    initAccountantPage,
    escapeHtml,
    formatPeso,
    formatDate,
    showToast
} from "./main.js";

/* ============================================================
   ACCOUNTANT - PAYMENT MANAGEMENT
   Read:  public.warehouse_sales, public.warehouse_sale_items
   Write: RPC warehouse_record_payment ONLY (walang direct update
          sa payment_status / amount_paid / paid_at / refunded_at)
   ============================================================ */

const $ = id => document.getElementById(id);

let sales = [];

const shortId = id => String(id ?? "").slice(0, 8).toUpperCase();
const typeLabel = type =>
    type === "e-payment" ? "E-payment" : type === "cash" ? "Cash" : "Not set";
const text = value => (value ? String(value).replace(/[-_]/g, " ") : "-");

// TODO: palitan ng buyer name kapag nakumpirma na ang buyer relationship.
const buyerLabel = sale => `Buyer ${String(sale.buyer_id ?? "").slice(0, 8)}`;

/* ============ DATA ============ */

/** Load warehouse sales used by payment review; payment changes use the RPC. */
async function loadSales() {
    const { data, error } = await supabase
        .from("warehouse_sales")
        .select(
            "sale_id, buyer_id, sale_status, payment_status, payment_type, " +
            "total_amount, amount_paid, paid_at, refunded_at, created_at, " +
            "delivered_at, completed_at, notes"
        )
        .order("created_at", { ascending: false });

    if (error) throw error;
    return data ?? [];
}

/* ============ FILTERS + TABLE ============ */

/** Apply the current text, payment, type, and date filters to loaded sales. */
function filteredSales() {
    const query = $("searchInput").value.trim().toLowerCase();
    const status = $("statusFilter").value;
    const type = $("typeFilter").value;
    const from = $("dateFrom").value ? new Date(`${$("dateFrom").value}T00:00:00`) : null;
    const to = $("dateTo").value ? new Date(`${$("dateTo").value}T23:59:59.999`) : null;

    return sales.filter(sale => {
        if (query && !String(sale.sale_id).toLowerCase().includes(query)) return false;
        if (status && sale.payment_status !== status) return false;
        if (type && sale.payment_type !== type) return false;

        const created = new Date(sale.created_at);
        if (from && created < from) return false;
        if (to && created > to) return false;

        return true;
    });
}

function actionButtons(sale) {
    const view = `<button type="button" class="btn-outline btn-sm" data-action="view" data-id="${escapeHtml(sale.sale_id)}">View</button>`;

    if (sale.payment_status !== "unpaid") return view;

    const label = sale.payment_type === "e-payment" ? "Verify Payment" : "Record Payment";

    return `${view}<button type="button" class="btn-approve btn-sm" data-action="record" data-id="${escapeHtml(sale.sale_id)}">${label}</button>`;
}

/** Render the matching payment rows and their available actions. */
function renderTable() {
    const rows = filteredSales();

    $("resultCount").textContent = `${rows.length} of ${sales.length} orders`;
    $("tableWrap").hidden = rows.length === 0;
    $("emptyState").hidden = rows.length > 0;
    $("emptyState").textContent = sales.length
        ? "No orders match your filters."
        : "No warehouse orders yet.";

    $("ordersBody").innerHTML = rows
        .map(sale => `
            <tr>
                <td>${escapeHtml(shortId(sale.sale_id))}</td>
                <td>${escapeHtml(buyerLabel(sale))}</td>
                <td>${formatDate(sale.created_at)}</td>
                <td>${formatPeso(sale.total_amount)}</td>
                <td>${escapeHtml(typeLabel(sale.payment_type))}</td>
                <td><span class="status-badge status-badge--${escapeHtml(sale.payment_status)}">${escapeHtml(sale.payment_status)}</span></td>
                <td style="text-transform:capitalize">${escapeHtml(text(sale.sale_status))}</td>
                <td><div class="row-actions">${actionButtons(sale)}</div></td>
            </tr>`)
        .join("");
}

/* ============ MODALS ============ */

/** Create a dismissible modal that closes on Escape or an outside click. */
function openModal(html) {
    const overlay = document.createElement("div");
    overlay.className = "activity-modal-overlay";
    overlay.innerHTML = `<div class="activity-completion-modal" role="dialog" aria-modal="true">${html}</div>`;

    const close = () => {
        overlay.remove();
        document.removeEventListener("keydown", onKey);
    };
    const onKey = event => {
        if (event.key === "Escape") close();
    };

    overlay.addEventListener("click", event => {
        if (event.target === overlay) close();
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);

    return { overlay, close };
}

const detail = (label, value) => `
    <div class="detail">
        <span class="detail-label">${label}</span>
        <span class="detail-value">${value}</span>
    </div>`;

function orderDetails(sale) {
    return `
        <div class="detail-grid">
            ${detail("Order ID", escapeHtml(shortId(sale.sale_id)))}
            ${detail("Buyer", escapeHtml(buyerLabel(sale)))}
            ${detail("Order Date", formatDate(sale.created_at))}
            ${detail("Total Amount", formatPeso(sale.total_amount))}
            ${detail("Payment Type", escapeHtml(typeLabel(sale.payment_type)))}
            ${detail("Payment Status", escapeHtml(text(sale.payment_status)))}
            ${detail("Sale Status", escapeHtml(text(sale.sale_status)))}
            ${detail("Amount Paid", formatPeso(sale.amount_paid))}
            ${detail("Paid On", formatDate(sale.paid_at))}
            ${detail("Refunded On", formatDate(sale.refunded_at))}
        </div>`;
}

/** Show sale details and fetch its warehouse sale items for the modal. */
async function viewOrder(sale) {
    const { overlay, close } = openModal(`
        <h2>Order ${escapeHtml(shortId(sale.sale_id))}</h2>
        ${orderDetails(sale)}
        ${sale.notes ? `<p class="modal-note">Notes: ${escapeHtml(sale.notes)}</p>` : ""}
        <div id="itemsBox" class="modal-note">Loading items...</div>
        <div class="activity-actions">
            <button type="button" class="btn-outline" data-close>Close</button>
        </div>`);

    overlay.querySelector("[data-close]").addEventListener("click", close);

    const box = overlay.querySelector("#itemsBox");
    const { data, error } = await supabase
        .from("warehouse_sale_items")
        .select("crop_name, quantity, unit, unit_price, line_total")
        .eq("sale_id", sale.sale_id);

    if (error) {
        console.error("Load order items failed:", error);
        box.textContent = "Unable to load order items.";
        return;
    }

    if (!data.length) {
        box.textContent = "No items found for this order.";
        return;
    }

    box.className = "table-wrap";
    box.innerHTML = `
        <table class="data-table items-table">
            <thead><tr><th>Crop</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr></thead>
            <tbody>
                ${data.map(item => `
                    <tr>
                        <td>${escapeHtml(item.crop_name)}</td>
                        <td>${escapeHtml(item.quantity)} ${escapeHtml(item.unit ?? "")}</td>
                        <td>${formatPeso(item.unit_price)}</td>
                        <td>${formatPeso(item.line_total)}</td>
                    </tr>`).join("")}
            </tbody>
        </table>`;
}

function confirmRecord(sale) {
    const hasType = ["cash", "e-payment"].includes(sale.payment_type);

    const note = sale.payment_type === "e-payment"
        ? "Confirm that you reviewed the e-payment and that it is valid."
        : sale.payment_type === "cash"
            ? "Confirm that the cash was collected from the buyer."
            : "Select how this order was paid, then confirm.";

    const { overlay, close } = openModal(`
        <h2>Record Payment</h2>
        <p class="modal-note">${note}</p>
        ${orderDetails(sale)}
        ${hasType ? "" : `
            <label class="modal-field">Payment Type
                <select id="modalType" class="field-select">
                    <option value="">Select type</option>
                    <option value="cash">Cash</option>
                    <option value="e-payment">E-payment</option>
                </select>
            </label>`}
        <p class="modal-note">Amount to record: <strong>${formatPeso(sale.total_amount)}</strong></p>
        <div class="activity-actions">
            <button type="button" class="btn-outline" data-close>Cancel</button>
            <button type="button" class="btn-approve" id="confirmRecord">Confirm Payment</button>
        </div>`);

    const confirmButton = overlay.querySelector("#confirmRecord");
    overlay.querySelector("[data-close]").addEventListener("click", close);

    confirmButton.addEventListener("click", async () => {
        const paymentType = hasType ? sale.payment_type : overlay.querySelector("#modalType").value;

        if (!paymentType) {
            showToast("Please select a payment type.", "error");
            return;
        }

        confirmButton.disabled = true;
        confirmButton.textContent = "Recording...";

        const { error } = await supabase.rpc("warehouse_record_payment", {
            p_sale_id: sale.sale_id,
            p_payment_type: paymentType
        });

        if (error) {
            console.error("Record payment failed:", error);
            showToast(error.message || "Unable to record payment.", "error");
            confirmButton.disabled = false;
            confirmButton.textContent = "Confirm Payment";
            return;
        }

        close();
        showToast(`Payment recorded for order ${shortId(sale.sale_id)}.`);

        try {
            sales = await loadSales();
            renderTable();
        } catch (reloadError) {
            console.error("Reload failed:", reloadError);
            showToast("Payment saved, but the list could not refresh. Please reload.", "error");
        }
    });
}

/* ============ INIT ============ */

async function initializePayments() {
    try {
        const context = await initAccountantPage();
        if (!context) return;

        sales = await loadSales();

        $("loadingState").hidden = true;
        renderTable();

        ["searchInput", "statusFilter", "typeFilter", "dateFrom", "dateTo"].forEach(id =>
            $(id).addEventListener(id === "searchInput" ? "input" : "change", renderTable)
        );

        $("clearFilters").addEventListener("click", () => {
            ["searchInput", "statusFilter", "typeFilter", "dateFrom", "dateTo"].forEach(id => {
                $(id).value = "";
            });
            renderTable();
        });

        $("ordersBody").addEventListener("click", event => {
            const button = event.target.closest("button[data-action]");
            if (!button) return;

            const sale = sales.find(s => s.sale_id === button.dataset.id);
            if (!sale) return;

            if (button.dataset.action === "view") viewOrder(sale);
            if (button.dataset.action === "record") confirmRecord(sale);
        });
    } catch (error) {
        console.error("Payment management failed:", error);

        $("loadingState").hidden = true;
        $("errorState").hidden = false;
        $("errorState").textContent =
            "Unable to load orders. Please refresh the page or log in again.";
    }
}

initializePayments();