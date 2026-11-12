
export async function render({
    supabase,
    supplier,
    view,
    escapeHTML,
    formatCurrency,
    formatDate
}) {
    const supplierId = supplier.user_id;

    let invoices = [];
    let ordersMap = {};

    view.innerHTML = `
        <section class="supplier-panel">
            <div class="panel-heading">
                <div>
                    <h3>Invoices</h3>
                    <p>Manage and monitor invoices submitted for your purchase orders.</p>
                </div>
            </div>

            <div class="dashboard-stats">
                <div class="stat-card">
                    <div>
                        <p>Total Invoices</p>
                        <h3 id="totalInvoices">0</h3>
                    </div>
                    <i class="fa-solid fa-file-invoice"></i>
                </div>

                <div class="stat-card">
                    <div>
                        <p>Pending Verification</p>
                        <h3 id="pendingInvoices">0</h3>
                    </div>
                    <i class="fa-solid fa-clock"></i>
                </div>

                <div class="stat-card">
                    <div>
                        <p>Verified Invoices</p>
                        <h3 id="verifiedInvoices">0</h3>
                    </div>
                    <i class="fa-solid fa-circle-check"></i>
                </div>

                <div class="stat-card">
                    <div>
                        <p>Rejected Invoices</p>
                        <h3 id="rejectedInvoices">0</h3>
                    </div>
                    <i class="fa-solid fa-circle-xmark"></i>
                </div>
            </div>

            <div class="filter-row">
                <input
                    type="search"
                    id="invoiceSearch"
                    placeholder="Search invoice number or order number..."
                />

                <select id="invoiceStatus">
                    <option value="">All Statuses</option>
                </select>
            </div>

            <div class="table-responsive" id="invoicesTable">
                <div class="page-loading">
                    <i class="fa-solid fa-spinner fa-spin"></i>
                    Loading invoices...
                </div>
            </div>
        </section>

        <div class="modal-overlay" id="invoiceModal" hidden>
            <div class="modal-content">
                <div class="panel-heading">
                    <div>
                        <h3>Invoice Details</h3>
                        <p id="invoiceModalSubtitle"></p>
                    </div>

                    <button
                        type="button"
                        class="icon-button"
                        id="closeInvoiceModal"
                        aria-label="Close"
                    >
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>

                <div id="invoiceDetails"></div>
            </div>
        </div>
    `;

    const table = view.querySelector("#invoicesTable");
    const search = view.querySelector("#invoiceSearch");
    const statusFilter = view.querySelector("#invoiceStatus");
    const modal = view.querySelector("#invoiceModal");

    function getStatusClass(status) {
        const value = String(status || "").toLowerCase();

        if (value.includes("verified") || value.includes("paid")) {
            return "success";
        }

        if (value.includes("reject") || value.includes("cancel")) {
            return "danger";
        }

        if (value.includes("pending")) {
            return "warning";
        }

        return "";
    }

    function updateOverview() {
        const total = invoices.length;

        const pending = invoices.filter(invoice =>
            String(invoice.invoice_status || "").toLowerCase().includes("pending")
        ).length;

        const verified = invoices.filter(invoice =>
            String(invoice.invoice_status || "").toLowerCase().includes("verified")
        ).length;

        const rejected = invoices.filter(invoice =>
            String(invoice.invoice_status || "").toLowerCase().includes("reject")
        ).length;

        view.querySelector("#totalInvoices").textContent = total;
        view.querySelector("#pendingInvoices").textContent = pending;
        view.querySelector("#verifiedInvoices").textContent = verified;
        view.querySelector("#rejectedInvoices").textContent = rejected;
    }

    async function loadInvoices() {
        const { data, error } = await supabase
            .from("supplier_invoices")
            .select(`
                invoice_id,
                supplier_id,
                order_id,
                invoice_number,
                invoice_date,
                due_date,
                invoice_status,
                invoice_document_path,
                submitted_at,
                verified_by,
                verified_at,
                verification_notes,
                created_at,
                updated_at
            `)
            .eq("supplier_id", supplierId)
            .order("created_at", { ascending: false });

        if (error) throw error;

        invoices = data || [];

        const orderIds = [
            ...new Set(
                invoices
                    .map(invoice => invoice.order_id)
                    .filter(Boolean)
            )
        ];

        ordersMap = {};

        if (orderIds.length) {
            const { data: orders, error: orderError } = await supabase
                .from("supplier_purchase_orders")
                .select("order_id, order_number")
                .in("order_id", orderIds)
                .eq("supplier_id", supplierId);

            if (orderError) throw orderError;

            ordersMap = Object.fromEntries(
                (orders || []).map(order => [
                    order.order_id,
                    order.order_number
                ])
            );
        }

        const statuses = [
            ...new Set(
                invoices
                    .map(invoice => invoice.invoice_status)
                    .filter(Boolean)
            )
        ];

        statusFilter.innerHTML = `
            <option value="">All Statuses</option>
            ${statuses.map(status => `
                <option value="${escapeHTML(status)}">
                    ${escapeHTML(status)}
                </option>
            `).join("")}
        `;

        updateOverview();
        renderInvoices();
    }

    function renderInvoices() {
        const query = search.value.trim().toLowerCase();
        const selectedStatus = statusFilter.value;

        const filtered = invoices.filter(invoice => {
            const invoiceNumber = String(
                invoice.invoice_number || ""
            ).toLowerCase();

            const orderNumber = String(
                ordersMap[invoice.order_id] || ""
            ).toLowerCase();

            const matchesSearch =
                invoiceNumber.includes(query) ||
                orderNumber.includes(query);

            const matchesStatus =
                !selectedStatus ||
                invoice.invoice_status === selectedStatus;

            return matchesSearch && matchesStatus;
        });

        if (!filtered.length) {
            table.innerHTML = `
                <div class="empty-state">
                    <i class="fa-solid fa-file-invoice"></i>
                    <p>No invoices found.</p>
                </div>
            `;
            return;
        }

        table.innerHTML = `
            <table class="supplier-table">
                <thead>
                    <tr>
                        <th>Invoice Number</th>
                        <th>Purchase Order</th>
                        <th>Invoice Date</th>
                        <th>Due Date</th>
                        <th>Status</th>
                        <th>Action</th>
                    </tr>
                </thead>

                <tbody>
                    ${filtered.map(invoice => `
                        <tr>
                            <td class="order-number">
                                ${escapeHTML(invoice.invoice_number || "—")}
                            </td>

                            <td>
                                ${escapeHTML(
                                    ordersMap[invoice.order_id] || "—"
                                )}
                            </td>

                            <td>
                                ${invoice.invoice_date
                                    ? formatDate(invoice.invoice_date)
                                    : "—"}
                            </td>

                            <td>
                                ${invoice.due_date
                                    ? formatDate(invoice.due_date)
                                    : "—"}
                            </td>

                            <td>
                                <span class="status-badge ${getStatusClass(invoice.invoice_status)}">
                                    ${escapeHTML(invoice.invoice_status || "Unknown")}
                                </span>
                            </td>

                            <td>
                                <button
                                    class="text-action view-invoice"
                                    data-id="${escapeHTML(invoice.invoice_id)}"
                                    type="button"
                                >
                                    View Details
                                </button>
                            </td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        `;

        table.querySelectorAll(".view-invoice").forEach(button => {
            button.addEventListener("click", async () => {
                try {
                    await showInvoiceDetails(button.dataset.id);
                } catch (error) {
                    console.error("Invoice details error:", error);
                    alert(error.message);
                }
            });
        });
    }

    async function showInvoiceDetails(invoiceId) {
        const invoice = invoices.find(
            item => item.invoice_id === invoiceId
        );

        if (!invoice) return;

        const details = view.querySelector("#invoiceDetails");

        const orderNumber =
            ordersMap[invoice.order_id] || "—";

        view.querySelector("#invoiceModalSubtitle").textContent =
            invoice.invoice_number || "Invoice";

        modal.hidden = false;

        details.innerHTML = `
            <div class="page-loading">
                <i class="fa-solid fa-spinner fa-spin"></i>
                Loading invoice details...
            </div>
        `;

        const { data: payments, error: paymentError } = await supabase
            .from("supplier_order_payments")
            .select(`
                payment_id,
                invoice_id,
                payment_reference,
                payment_amount,
                payment_type,
                payment_status,
                payment_date,
                payment_notes,
                created_at
            `)
            .eq("invoice_id", invoiceId)
            .order("payment_date", { ascending: false });

        if (paymentError) throw paymentError;

        const paymentRecords = payments || [];

        const totalPayments = paymentRecords.reduce(
            (total, payment) =>
                total + Number(payment.payment_amount || 0),
            0
        );

        details.innerHTML = `
            <div class="order-summary">
                <h4>Invoice Information</h4>

                <p>
                    <strong>Invoice Number:</strong>
                    ${escapeHTML(invoice.invoice_number || "—")}
                </p>

                <p>
                    <strong>Purchase Order:</strong>
                    ${escapeHTML(orderNumber)}
                </p>

                <p>
                    <strong>Invoice Date:</strong>
                    ${invoice.invoice_date
                        ? formatDate(invoice.invoice_date)
                        : "—"}
                </p>

                <p>
                    <strong>Due Date:</strong>
                    ${invoice.due_date
                        ? formatDate(invoice.due_date)
                        : "—"}
                </p>

                <p>
                    <strong>Submitted At:</strong>
                    ${invoice.submitted_at
                        ? formatDate(invoice.submitted_at)
                        : "—"}
                </p>

                <p>
                    <strong>Status:</strong>
                    <span class="status-badge ${getStatusClass(invoice.invoice_status)}">
                        ${escapeHTML(invoice.invoice_status || "Unknown")}
                    </span>
                </p>

                <p>
                    <strong>Document Path:</strong>
                    ${escapeHTML(invoice.invoice_document_path || "Not provided")}
                </p>

                <p>
                    <strong>Verification Date:</strong>
                    ${invoice.verified_at
                        ? formatDate(invoice.verified_at)
                        : "Not yet verified"}
                </p>

                <p>
                    <strong>Verification Notes:</strong>
                    ${escapeHTML(invoice.verification_notes || "No notes provided.")}
                </p>
            </div>

            <div class="order-summary">
                <h4>Payment Summary</h4>

                <p>
                    <strong>Payment Records:</strong>
                    ${paymentRecords.length}
                </p>

                <p>
                    <strong>Total Recorded Payments:</strong>
                    ${formatCurrency(totalPayments)}
                </p>
            </div>

            <h4>Payment History</h4>

            <div class="table-responsive">
                <table class="supplier-table">
                    <thead>
                        <tr>
                            <th>Reference</th>
                            <th>Amount</th>
                            <th>Payment Type</th>
                            <th>Status</th>
                            <th>Payment Date</th>
                        </tr>
                    </thead>

                    <tbody>
                        ${paymentRecords.length
                            ? paymentRecords.map(payment => `
                                <tr>
                                    <td>
                                        ${escapeHTML(payment.payment_reference || "—")}
                                    </td>

                                    <td>
                                        ${formatCurrency(payment.payment_amount)}
                                    </td>

                                    <td>
                                        ${escapeHTML(payment.payment_type || "—")}
                                    </td>

                                    <td>
                                        <span class="status-badge ${getStatusClass(payment.payment_status)}">
                                            ${escapeHTML(payment.payment_status || "Unknown")}
                                        </span>
                                    </td>

                                    <td>
                                        ${payment.payment_date
                                            ? formatDate(payment.payment_date)
                                            : "—"}
                                    </td>
                                </tr>

                                ${payment.payment_notes ? `
                                    <tr>
                                        <td colspan="5">
                                            <strong>Payment Notes:</strong>
                                            ${escapeHTML(payment.payment_notes)}
                                        </td>
                                    </tr>
                                ` : ""}
                            `).join("")
                            : `
                                <tr>
                                    <td colspan="5" class="empty-state">
                                        No payment records found.
                                    </td>
                                </tr>
                            `
                        }
                    </tbody>
                </table>
            </div>
        `;
    }

    search.addEventListener("input", renderInvoices);
    statusFilter.addEventListener("change", renderInvoices);

    view.querySelector("#closeInvoiceModal").addEventListener("click", () => {
        modal.hidden = true;
    });

    modal.addEventListener("click", event => {
        if (event.target === modal) {
            modal.hidden = true;
        }
    });

    try {
        await loadInvoices();
    } catch (error) {
        console.error("Invoices loading error:", error);

        table.innerHTML = `
            <div class="page-error">
                ${escapeHTML(error.message)}
            </div>
        `;
    }
}
