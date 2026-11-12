
export async function render({
    supabase,
    supplier,
    view,
    escapeHTML,
    formatCurrency,
    formatDate
}) {
    const supplierId = supplier.user_id;

    let orders = [];
    const busyOrders = new Set();
    let activeOrderId = null;
    let dialogResolver = null;
    let dialogSubmitting = false;
    let deliveryTimerInterval = null;
    let paymentConfirmationBusy = false;

    const STATUS_LABELS = {
        pending: "Pending",
        accepted: "Accepted",
        rejected: "Rejected",
        preparing: "Preparing",
        shipped: "Shipped",
        delivered: "Delivered",
        completed: "Completed",
        cancelled: "Cancelled"
    };

    // Supplier can only manage orders up to Shipped.
    // Payment Accepted moves Shipped -> Delivered.
    // Complete Order is handled by the Deliverer.
    const STATUS_ACTIONS = {
        pending: [
            { status: "accepted", label: "Accept Order" },
            { status: "rejected", label: "Reject Order" }
        ],
        accepted: [
            { status: "preparing", label: "Start Preparing" }
        ],
        preparing: [
            { status: "shipped", label: "Mark as Shipped" }
        ],
        shipped: [],
        delivered: [],
        rejected: [],
        completed: [],
        cancelled: []
    };

    view.innerHTML = `
        <section class="supplier-panel">
            <div class="panel-heading">
                <div>
                    <h3>Purchase Orders</h3>
                    <p>Review and manage purchase orders assigned to your business.</p>
                </div>

                <button type="button" class="text-action" id="refreshOrders">
                    <i class="fa-solid fa-rotate"></i> Refresh
                </button>
            </div>

            <div class="filter-row">
                <input
                    type="search"
                    id="orderSearch"
                    placeholder="Search order number..."
                />

                <select id="orderStatus">
                    <option value="">All Statuses</option>
                </select>
            </div>

            <div class="table-responsive" id="ordersTable">
                <div class="page-loading">
                    <i class="fa-solid fa-spinner fa-spin"></i>
                    Loading orders...
                </div>
            </div>
        </section>

        <!-- Order Details Modal -->
        <div class="modal-overlay" id="orderModal" hidden>
            <div class="modal-content">
                <div class="panel-heading">
                    <div>
                        <h3>Order Details</h3>
                        <p id="orderModalSubtitle"></p>
                    </div>

                    <button
                        type="button"
                        class="icon-button"
                        data-action="close-order-modal"
                        aria-label="Close"
                    >
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>

                <div id="orderDetails"></div>
            </div>
        </div>

        <!-- Workflow Modal -->
        <div class="modal-overlay supplier-workflow-overlay" id="workflowModal" hidden>
            <div
                class="modal-content supplier-workflow-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="workflowModalTitle"
            >
                <div class="panel-heading">
                    <div>
                        <h3 id="workflowModalTitle">Order Action</h3>
                        <p id="workflowModalSubtitle"></p>
                    </div>

                    <button
                        type="button"
                        class="icon-button"
                        data-action="close-workflow"
                        aria-label="Close"
                    >
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>

                <form id="workflowForm">
                    <div id="workflowModalBody"></div>

                    <div class="supplier-workflow-actions" id="workflowModalActions"></div>
                </form>
            </div>
        </div>
    `;

    const table = view.querySelector("#ordersTable");
    const search = view.querySelector("#orderSearch");
    const statusFilter = view.querySelector("#orderStatus");
    const modal = view.querySelector("#orderModal");
    const details = view.querySelector("#orderDetails");

    const workflowModal = view.querySelector("#workflowModal");
    const workflowForm = view.querySelector("#workflowForm");
    const workflowTitle = view.querySelector("#workflowModalTitle");
    const workflowSubtitle = view.querySelector("#workflowModalSubtitle");
    const workflowBody = view.querySelector("#workflowModalBody");
    const workflowActions = view.querySelector("#workflowModalActions");

    function safe(value) {
        return escapeHTML(String(value ?? ""));
    }

    function getStatusLabel(status) {
        return STATUS_LABELS[status] || status || "Unknown";
    }

    function formatTrackingDate(value) {
        if (!value) return "Not available";
        return formatDate(value, true);
    }

    function renderStatusBadge(status) {
        return `
            <span class="status-badge">
                ${safe(getStatusLabel(status))}
            </span>
        `;
    }

    function renderStatusActions(order) {
        const actions = STATUS_ACTIONS[order.order_status] || [];

        if (!actions.length) {
            return `<span class="muted">No further actions</span>`;
        }

        return `
            <div class="order-status-actions">
                ${actions.map(action => `
                    <button
                        type="button"
                        class="text-action status-action"
                        data-order-id="${safe(order.order_id)}"
                        data-new-status="${safe(action.status)}"
                        ${busyOrders.has(order.order_id) ? "disabled" : ""}
                    >
                        ${safe(action.label)}
                    </button>
                `).join("")}
            </div>
        `;
    }

    function renderOrders() {
        const query = search.value.trim().toLowerCase();
        const selectedStatus = statusFilter.value;

        const filtered = orders.filter(order => {
            const searchable = [
                order.order_number,
                order.order_status,
                order.notes
            ].join(" ").toLowerCase();

            return (
                searchable.includes(query) &&
                (!selectedStatus || order.order_status === selectedStatus)
            );
        });

        if (!filtered.length) {
            table.innerHTML = `
                <div class="empty-state">
                    <i class="fa-solid fa-clipboard-list"></i>
                    <p>No purchase orders found.</p>
                </div>
            `;
            return;
        }

        table.innerHTML = `
            <table class="supplier-table">
                <thead>
                    <tr>
                        <th>Order Number</th>
                        <th>Order Date</th>
                        <th>Status</th>
                        <th>Notes</th>
                        <th>Manage Order</th>
                        <th>Action</th>
                    </tr>
                </thead>

                <tbody>
                    ${filtered.map(order => `
                        <tr>
                            <td class="order-number">
                                ${safe(order.order_number)}
                            </td>

                            <td>
                                ${safe(formatDate(order.order_date))}
                            </td>

                            <td>
                                ${renderStatusBadge(order.order_status)}
                            </td>

                            <td>
                                ${safe(order.notes || "—")}
                            </td>

                            <td>
                                ${renderStatusActions(order)}
                            </td>

                            <td>
                                <button
                                    class="text-action view-order"
                                    data-id="${safe(order.order_id)}"
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
    }

    async function loadOrders() {
        const selectedStatus = statusFilter.value;

        table.innerHTML = `
            <div class="page-loading">
                <i class="fa-solid fa-spinner fa-spin"></i>
                Loading orders...
            </div>
        `;

        const { data, error } = await supabase
            .from("supplier_purchase_orders")
            .select(`
                order_id,
                supplier_id,
                requested_by,
                order_number,
                order_status,
                order_date,
                notes,
                created_at,
                updated_at,
                accepted_at,
                preparing_at,
                shipped_at,
                expected_delivery_at,
                delivered_at,
                completed_at
            `)
            .eq("supplier_id", supplierId)
            .order("created_at", { ascending: false });

        if (error) throw error;

        orders = data || [];

        const statuses = [...new Set([
            ...Object.keys(STATUS_LABELS),
            ...orders.map(order => order.order_status).filter(Boolean)
        ])];

        statusFilter.innerHTML = `
            <option value="">All Statuses</option>

            ${statuses.map(status => `
                <option value="${safe(status)}">
                    ${safe(getStatusLabel(status))}
                </option>
            `).join("")}
        `;

        statusFilter.value = statuses.includes(selectedStatus)
            ? selectedStatus
            : "";

        renderOrders();
    }

    function stopDeliveryTimer() {
        if (deliveryTimerInterval) {
            clearInterval(deliveryTimerInterval);
            deliveryTimerInterval = null;
        }
    }

    function formatRemainingTime(milliseconds) {
        const totalSeconds = Math.max(
            0,
            Math.floor(milliseconds / 1000)
        );

        const days = Math.floor(totalSeconds / 86400);
        const hours = Math.floor((totalSeconds % 86400) / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        if (days > 0) {
            return `${days}d ${hours}h ${minutes}m ${seconds}s`;
        }

        return `${hours}h ${minutes}m ${seconds}s`;
    }

    function updateDeliveryTimer() {
        const timerElement = details.querySelector("#deliveryCountdown");
        const paymentButton = details.querySelector("#paymentAcceptedButton");

        if (!timerElement) {
            stopDeliveryTimer();
            return;
        }

        const expectedDeliveryAt = new Date(
            timerElement.dataset.expectedDelivery
        ).getTime();

        if (!Number.isFinite(expectedDeliveryAt)) {
            timerElement.textContent = "Delivery schedule unavailable";

            if (paymentButton) {
                paymentButton.hidden = true;
            }

            stopDeliveryTimer();
            return;
        }

        const remaining = expectedDeliveryAt - Date.now();

        if (remaining > 0) {
            timerElement.textContent = formatRemainingTime(remaining);

            if (paymentButton) {
                paymentButton.hidden = true;
            }

            return;
        }

        timerElement.textContent = "Delivery timer expired";

        if (paymentButton) {
            paymentButton.hidden = false;
        }

        stopDeliveryTimer();
    }

    async function loadOrderPayment(orderId) {
        const { data: invoice, error: invoiceError } = await supabase
            .from("supplier_invoices")
            .select(`
                invoice_id,
                invoice_number,
                invoice_status
            `)
            .eq("order_id", orderId)
            .maybeSingle();

        if (invoiceError) throw invoiceError;

        if (!invoice) {
            return {
                invoice: null,
                payment: null
            };
        }

        const { data: payment, error: paymentError } = await supabase
            .from("supplier_order_payments")
            .select(`
                payment_id,
                payment_amount,
                payment_type,
                payment_status,
                payment_date
            `)
            .eq("invoice_id", invoice.invoice_id)
            .eq("payment_type", "cash")
            .limit(1)
            .maybeSingle();

        if (paymentError) throw paymentError;

        return {
            invoice,
            payment
        };
    }

    function renderPaymentInformation(order, invoice, payment) {
        const hasExpectedDelivery = Boolean(order.expected_delivery_at);

        const canAcceptPayment =
            order.order_status === "shipped" &&
            hasExpectedDelivery &&
            invoice &&
            ["submitted", "approved"].includes(invoice.invoice_status) &&
            payment &&
            payment.payment_type === "cash" &&
            payment.payment_status === "unpaid";

        const timerMarkup = order.order_status === "shipped"
            ? `
                <p>
                    <strong>Delivery Countdown:</strong>
                    <span
                        id="deliveryCountdown"
                        data-expected-delivery="${safe(order.expected_delivery_at || "")}"
                    >
                        Checking delivery time...
                    </span>
                </p>
            `
            : "";

        if (!invoice) {
            return `
                <section class="order-tracking-info">
                    <h4>
                        <i class="fa-solid fa-receipt"></i>
                        Payment Information
                    </h4>

                    <p>Invoice is not available for this order.</p>
                    ${timerMarkup}
                </section>
            `;
        }

        const paymentStatus = payment?.payment_status || "Not recorded";

        return `
            <section class="order-tracking-info">
                <h4>
                    <i class="fa-solid fa-receipt"></i>
                    Payment Information
                </h4>

                <p>
                    <strong>Invoice Number:</strong>
                    ${safe(invoice.invoice_number)}
                </p>

                <p>
                    <strong>Invoice Status:</strong>
                    ${safe(invoice.invoice_status)}
                </p>

                <p>
                    <strong>Payment Method:</strong>
                    ${safe(payment?.payment_type || "Not available")}
                </p>

                <p>
                    <strong>Payment Amount:</strong>
                    ${payment
                ? formatCurrency(payment.payment_amount)
                : "Not available"}
                </p>

                <p>
                    <strong>Payment Status:</strong>
                    ${safe(paymentStatus)}
                </p>

                ${payment?.payment_date ? `
                    <p>
                        <strong>Payment Date:</strong>
                        ${safe(formatTrackingDate(payment.payment_date))}
                    </p>
                ` : ""}

                ${timerMarkup}

                ${canAcceptPayment ? `
                    <div class="order-payment-actions">
                        <button
                            type="button"
                            class="text-action"
                            id="paymentAcceptedButton"
                            data-order-id="${safe(order.order_id)}"
                            hidden
                        >
                            <i class="fa-solid fa-circle-check"></i>
                            Payment Accepted
                        </button>
                    </div>
                ` : ""}
            </section>
        `;
    }

    async function showOrderDetails(orderId) {
        stopDeliveryTimer();

        const order = orders.find(
            item => String(item.order_id) === String(orderId)
        );

        if (!order) return;

        activeOrderId = orderId;

        view.querySelector("#orderModalSubtitle").textContent =
            order.order_number;

        modal.hidden = false;

        details.innerHTML = `
            <div class="page-loading">
                <i class="fa-solid fa-spinner fa-spin"></i>
                Loading details...
            </div>
        `;

        const { data: items, error } = await supabase
            .from("supplier_purchase_order_items")
            .select(`
                order_item_id,
                product_listing_id,
                quantity,
                unit_price,
                subtotal,
                created_at
            `)
            .eq("order_id", orderId)
            .order("created_at", { ascending: true });

        if (error) throw error;

        const listingIds = [...new Set(
            (items || [])
                .map(item => item.product_listing_id)
                .filter(Boolean)
        )];

        let productMap = {};

        if (listingIds.length) {
            const { data: products, error: productError } = await supabase
                .from("supplier_product_listings")
                .select(`
                    product_listing_id,
                    product_name,
                    unit
                `)
                .in("product_listing_id", listingIds)
                .eq("supplier_id", supplierId);

            if (productError) throw productError;

            productMap = Object.fromEntries(
                (products || []).map(product => [
                    product.product_listing_id,
                    {
                        name: product.product_name,
                        unit: product.unit
                    }
                ])
            );
        }

        const currentOrder = orders.find(
            item => String(item.order_id) === String(orderId)
        );

        if (!currentOrder) return;

        const { invoice, payment } = await loadOrderPayment(orderId);

        const itemRows = (items || []).length
            ? items.map(item => {
                const product = productMap[item.product_listing_id];
                const productName = product?.name || "Product listing unavailable";

                const subtotal = item.subtotal ??
                    Number(item.quantity) * Number(item.unit_price);

                return `
                    <tr>
                        <td>
                            ${safe(productName)}
                            ${product?.unit
                        ? `<small>${safe(product.unit)}</small>`
                        : ""}
                        </td>

                        <td>
                            ${Number(item.quantity).toLocaleString("en-PH")}
                        </td>

                        <td>${formatCurrency(item.unit_price)}</td>
                        <td>${formatCurrency(subtotal)}</td>
                    </tr>
                `;
            }).join("")
            : `
                <tr>
                    <td colspan="4" class="empty-state">
                        No order items found.
                    </td>
                </tr>
            `;

        details.innerHTML = `
            <div class="order-summary">
                <p>
                    <strong>Order Number:</strong>
                    ${safe(currentOrder.order_number)}
                </p>

                <p>
                    <strong>Order Date:</strong>
                    ${safe(formatDate(currentOrder.order_date, true))}
                </p>

                <p>
                    <strong>Status:</strong>
                    ${renderStatusBadge(currentOrder.order_status)}
                </p>

                <p>
                    <strong>Notes:</strong>
                    ${safe(currentOrder.notes || "—")}
                </p>
            </div>

            ${currentOrder.order_status === "preparing" ? `
                <div class="order-detail-actions">
                    ${renderStatusActions(currentOrder)}
                </div>
            ` : ""}

            ${currentOrder.shipped_at ? `
                <section class="order-tracking-info">
                    <h4>
                        <i class="fa-solid fa-truck"></i>
                        Delivery Information
                    </h4>

                    <p>
                        <strong>Shipped At:</strong>
                        ${safe(formatTrackingDate(currentOrder.shipped_at))}
                    </p>

                    <p>
                        <strong>Expected Delivery:</strong>
                        ${safe(formatTrackingDate(currentOrder.expected_delivery_at))}
                    </p>
                </section>
            ` : ""}

            ${renderPaymentInformation(currentOrder, invoice, payment)}

            ${currentOrder.delivered_at ? `
                <p>
                    <strong>Delivered At:</strong>
                    ${safe(formatTrackingDate(currentOrder.delivered_at))}
                </p>
            ` : ""}

            ${currentOrder.completed_at ? `
                <p>
                    <strong>Completed At:</strong>
                    ${safe(formatTrackingDate(currentOrder.completed_at))}
                </p>
            ` : ""}

            <h4>Ordered Products</h4>

            <div class="table-responsive">
                <table class="supplier-table">
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
        `;

        if (currentOrder.order_status === "shipped") {
            updateDeliveryTimer();

            if (details.querySelector("#deliveryCountdown")) {
                deliveryTimerInterval = setInterval(
                    updateDeliveryTimer,
                    1000
                );
            }
        }
    }

    /*
     * Reusable custom modal.
     * Resolves with submitted form data or null when cancelled.
     */
    function openWorkflowModal({
        title,
        subtitle = "",
        body,
        confirmLabel = "Confirm",
        confirmClass = "supplier-modal-primary",
        showCancel = true,
        form = true
    }) {
        if (dialogResolver) {
            dialogResolver(null);
            dialogResolver = null;
        }

        workflowTitle.textContent = title;
        workflowSubtitle.textContent = subtitle;
        workflowBody.innerHTML = body;

        workflowActions.innerHTML = `
            ${showCancel ? `
                <button
                    type="button"
                    class="supplier-modal-secondary"
                    data-action="cancel-workflow"
                >
                    Cancel
                </button>
            ` : ""}

            <button
                type="${form ? "submit" : "button"}"
                class="${confirmClass}"
                data-action="confirm-workflow"
            >
                ${safe(confirmLabel)}
            </button>
        `;

        workflowModal.hidden = false;
        dialogSubmitting = false;

        return new Promise(resolve => {
            dialogResolver = resolve;
        });
    }

    function closeWorkflowModal(result = null) {
        if (dialogSubmitting) return;

        workflowModal.hidden = true;

        const resolver = dialogResolver;
        dialogResolver = null;

        if (resolver) resolver(result);
    }

    function showFeedbackModal(title, message, type = "success") {
        const icon = type === "success"
            ? "fa-circle-check"
            : "fa-circle-exclamation";

        const iconClass = type === "success"
            ? "supplier-feedback-success"
            : "supplier-feedback-error";

        return openWorkflowModal({
            title,
            subtitle: "",
            body: `
                <div class="supplier-feedback-content">
                    <div class="supplier-feedback-icon ${iconClass}">
                        <i class="fa-solid ${icon}"></i>
                    </div>

                    <p>${safe(message)}</p>
                </div>
            `,
            confirmLabel: "Okay",
            confirmClass: "supplier-modal-primary",
            showCancel: false,
            form: false
        }).then(() => undefined);
    }

    async function showShipmentModal(order) {
        const defaultDate = new Date();
        defaultDate.setHours(defaultDate.getHours() + 1, 0, 0, 0);

        const dateValue = [
            defaultDate.getFullYear(),
            String(defaultDate.getMonth() + 1).padStart(2, "0"),
            String(defaultDate.getDate()).padStart(2, "0")
        ].join("-");

        const timeValue =
            `${String(defaultDate.getHours()).padStart(2, "0")}:` +
            `${String(defaultDate.getMinutes()).padStart(2, "0")}`;

        const result = await openWorkflowModal({
            title: "Ship Order",
            subtitle: `Set the expected delivery schedule for ${order.order_number}.`,
            confirmLabel: "Confirm Shipment",
            confirmClass: "supplier-modal-primary",
            body: `
                <div class="supplier-shipment-order">
                    <span>Order Number</span>
                    <strong>${safe(order.order_number)}</strong>
                </div>

                <div class="supplier-modal-field">
                    <label for="shipmentExpectedDate">
                        Expected Delivery Date
                    </label>

                    <input
                        type="date"
                        id="shipmentExpectedDate"
                        name="expectedDate"
                        min="${dateValue}"
                        value="${dateValue}"
                        required
                    >
                </div>

                <div class="supplier-modal-field">
                    <label for="shipmentExpectedTime">
                        Expected Delivery Time
                    </label>

                    <input
                        type="time"
                        id="shipmentExpectedTime"
                        name="expectedTime"
                        value="${timeValue}"
                        required
                    >
                </div>

                <div class="supplier-modal-hint">
                    <i class="fa-solid fa-circle-info"></i>
                    The Farm Manager will be able to see this delivery schedule
                    and track the remaining time.
                </div>

                <p class="supplier-modal-inline-error" id="workflowInlineError" hidden></p>
            `
        });

        if (!result) return;

        const date = result.expectedDate;
        const time = result.expectedTime;

        if (!date || !time) {
            await showFeedbackModal(
                "Incomplete Schedule",
                "Please provide the expected delivery date and time.",
                "error"
            );
            return;
        }

        const expectedDate = new Date(`${date}T${time}:00`);

        if (
            Number.isNaN(expectedDate.getTime()) ||
            expectedDate.getTime() <= Date.now()
        ) {
            await showFeedbackModal(
                "Invalid Delivery Schedule",
                "Expected delivery must be a valid date and time in the future.",
                "error"
            );
            return;
        }

        await updateOrderStatus(
            order.order_id,
            "shipped",
            null,
            expectedDate.toISOString()
        );
    }

    async function showRejectionModal(order) {
        const result = await openWorkflowModal({
            title: "Reject Order",
            subtitle: `Please provide a reason for rejecting ${order.order_number}.`,
            confirmLabel: "Reject Order",
            confirmClass: "supplier-modal-danger",
            body: `
                <div class="supplier-shipment-order">
                    <span>Order Number</span>
                    <strong>${safe(order.order_number)}</strong>
                </div>

                <div class="supplier-modal-field">
                    <label for="rejectionReason">
                        Reason for Rejection
                    </label>

                    <textarea
                        id="rejectionReason"
                        name="rejectionReason"
                        rows="4"
                        maxlength="1000"
                        placeholder="Enter the reason for rejecting this order..."
                        required
                    ></textarea>
                </div>
            `
        });

        if (!result) return;

        const reason = result.rejectionReason.trim();

        if (!reason) {
            await showFeedbackModal(
                "Reason Required",
                "Please provide a reason for rejecting this order.",
                "error"
            );
            return;
        }

        await updateOrderStatus(
            order.order_id,
            "rejected",
            reason
        );
    }

    async function showConfirmationModal(order, newStatus) {
        const action = (STATUS_ACTIONS[order.order_status] || [])
            .find(item => item.status === newStatus);

        if (!action) return;

        const confirmed = await openWorkflowModal({
            title: action.label,
            subtitle: `Order ${order.order_number}`,
            confirmLabel: "Continue",
            confirmClass: "supplier-modal-primary",
            form: false,
            body: `
                <div class="supplier-confirm-content">
                    <div class="supplier-confirm-icon">
                        <i class="fa-solid fa-circle-question"></i>
                    </div>

                    <p>
                        Are you sure you want to
                        <strong>${safe(action.label.toLowerCase())}</strong>
                        for this order?
                    </p>
                </div>
            `
        });

        if (confirmed) {
            await updateOrderStatus(order.order_id, newStatus);
        }
    }

    async function handlePaymentAccepted(orderId) {
        if (paymentConfirmationBusy) return;

        const order = orders.find(
            item => String(item.order_id) === String(orderId)
        );

        if (!order || order.order_status !== "shipped") {
            await showFeedbackModal(
                "Invalid Order",
                "Only shipped orders can have payment accepted.",
                "error"
            );
            return;
        }

        if (
            !order.expected_delivery_at ||
            new Date(order.expected_delivery_at).getTime() > Date.now()
        ) {
            await showFeedbackModal(
                "Delivery Timer Active",
                "Payment Accepted will become available after the expected delivery time.",
                "error"
            );

            return;
        }
        paymentConfirmationBusy = true;
        busyOrders.add(orderId);

        const paymentButton = details.querySelector(
            "#paymentAcceptedButton"
        );

        if (paymentButton) {
            paymentButton.disabled = true;
            paymentButton.innerHTML = `
                <i class="fa-solid fa-spinner fa-spin"></i>
                Processing...
            `;
        }

        try {
            const { data, error } = await supabase.rpc(
                "supplier_accept_order_cash_payment",
                {
                    p_order_id: orderId
                }
            );

            if (error) throw error;

            if (data?.success !== true) {
                throw new Error(
                    data?.message || "Payment confirmation was not completed."
                );
            }

            await loadOrders();

            if (
                activeOrderId === orderId &&
                !modal.hidden
            ) {
                await showOrderDetails(orderId);
            }

            await showFeedbackModal(
                "Payment Accepted",
                `Payment for order ${order.order_number} has been confirmed successfully. The order is now marked as Delivered.`,
                "success"
            );

        } catch (error) {
            console.error("Payment confirmation error:", error);

            await showFeedbackModal(
                "Unable to Accept Payment",
                error.message || "Payment confirmation failed. Please try again.",
                "error"
            );

        } finally {
            paymentConfirmationBusy = false;
            busyOrders.delete(orderId);

            renderOrders();

            if (
                activeOrderId === orderId &&
                !modal.hidden
            ) {
                try {
                    await showOrderDetails(orderId);
                } catch (error) {
                    console.error("Order details refresh error:", error);
                }
            }
        }
    }

    async function updateOrderStatus(
        orderId,
        newStatus,
        rejectionReason = null,
        expectedDeliveryAt = null
    ) {
        const order = orders.find(
            item => String(item.order_id) === String(orderId)
        );

        if (!order) {
            await showFeedbackModal(
                "Order Not Found",
                "The selected order could not be found. Refresh the page and try again.",
                "error"
            );
            return;
        }

        const allowedActions = STATUS_ACTIONS[order.order_status] || [];

        if (!allowedActions.some(action => action.status === newStatus)) {
            await showFeedbackModal(
                "Invalid Action",
                "This order status transition is not allowed.",
                "error"
            );
            return;
        }

        if (busyOrders.has(orderId)) return;

        busyOrders.add(orderId);
        renderOrders();

        if (activeOrderId === orderId && !modal.hidden) {
            stopDeliveryTimer();

            details.innerHTML = `
                <div class="page-loading">
                    <i class="fa-solid fa-spinner fa-spin"></i>
                    Updating order...
                </div>
            `;
        }

        try {
            let result;

            if (newStatus === "accepted" || newStatus === "rejected") {
                result = await supabase.rpc(
                    "supplier_review_farm_manager_order",
                    {
                        p_order_id: orderId,
                        p_decision: newStatus,
                        p_note: rejectionReason
                    }
                );
            } else {
                result = await supabase.rpc(
                    "supplier_update_farm_manager_order_status",
                    {
                        p_order_id: orderId,
                        p_new_status: newStatus,
                        p_expected_delivery_at: expectedDeliveryAt
                    }
                );
            }

            if (result.error) throw result.error;

            await loadOrders();

            if (activeOrderId === orderId && !modal.hidden) {
                await showOrderDetails(orderId);
            }

            await showFeedbackModal(
                "Order Updated Successfully",
                `Order ${order.order_number} has been updated to ${getStatusLabel(newStatus)}.`,
                "success"
            );

        } catch (error) {
            console.error("Order status update error:", error);

            try {
                await loadOrders();
            } catch (refreshError) {
                console.error("Order refresh error:", refreshError);
            }

            await showFeedbackModal(
                "Unable to Update Order",
                error.message || "Failed to update the order status. Please try again.",
                "error"
            );

        } finally {
            busyOrders.delete(orderId);
            renderOrders();

            if (activeOrderId === orderId && !modal.hidden) {
                try {
                    await showOrderDetails(orderId);
                } catch (error) {
                    console.error("Order details refresh error:", error);
                }
            }
        }
    }

    async function handleStatusAction(orderId, newStatus) {
        const order = orders.find(
            item => String(item.order_id) === String(orderId)
        );

        if (!order || busyOrders.has(orderId)) return;

        const allowedActions = STATUS_ACTIONS[order.order_status] || [];

        if (!allowedActions.some(action => action.status === newStatus)) {
            await showFeedbackModal(
                "Invalid Action",
                "This status transition is not allowed.",
                "error"
            );
            return;
        }

        if (newStatus === "shipped") {
            await showShipmentModal(order);
            return;
        }

        if (newStatus === "rejected") {
            await showRejectionModal(order);
            return;
        }

        await showConfirmationModal(order, newStatus);
    }

    // Search and status filters.
    search.addEventListener("input", renderOrders);
    statusFilter.addEventListener("change", renderOrders);

    // Event delegation for all order actions.
    view.addEventListener("click", async event => {
        const paymentButton = event.target instanceof Element
            ? event.target.closest("#paymentAcceptedButton")
            : null;

        if (paymentButton) {
            event.preventDefault();
            event.stopPropagation();

            if (
                paymentButton.disabled ||
                paymentConfirmationBusy
            ) {
                return;
            }

            const orderId = paymentButton.dataset.orderId;

            if (!orderId) {
                console.error("Payment button is missing its order ID.");
                return;
            }

            await handlePaymentAccepted(orderId);
            return;
        }

        const statusButton = event.target.closest(".status-action");

        if (statusButton) {
            await handleStatusAction(
                statusButton.dataset.orderId,
                statusButton.dataset.newStatus
            );
            return;
        }

        const detailsButton = event.target.closest(".view-order");

        if (detailsButton) {
            try {
                await showOrderDetails(detailsButton.dataset.id);
            } catch (error) {
                console.error("Order details error:", error);

                await showFeedbackModal(
                    "Unable to Load Details",
                    error.message || "Unable to load order details.",
                    "error"
                );
            }
            return;
        }

        if (event.target.closest("#refreshOrders")) {
            try {
                await loadOrders();
            } catch (error) {
                console.error("Order refresh error:", error);

                await showFeedbackModal(
                    "Refresh Failed",
                    error.message || "Unable to refresh orders.",
                    "error"
                );
            }
            return;
        }

        if (event.target.closest('[data-action="close-order-modal"]')) {
            stopDeliveryTimer();
            modal.hidden = true;
            activeOrderId = null;
            return;
        }

        if (event.target === modal) {
            stopDeliveryTimer();
            modal.hidden = true;
            activeOrderId = null;
            return;
        }

        if (event.target.closest('[data-action="cancel-workflow"]')) {
            closeWorkflowModal(null);
            return;
        }

        if (event.target.closest('[data-action="close-workflow"]')) {
            closeWorkflowModal(null);
            return;
        }

        if (event.target === workflowModal) {
            closeWorkflowModal(null);
        }
    });

    // Handle custom modal form submissions.
    workflowForm.addEventListener("submit", event => {
        event.preventDefault();

        if (dialogSubmitting || !dialogResolver) return;

        const formData = new FormData(workflowForm);
        const result = Object.fromEntries(formData.entries());

        dialogSubmitting = true;
        workflowModal.hidden = true;

        const resolver = dialogResolver;
        dialogResolver = null;

        if (resolver) resolver(result);
    });

    // Confirmation and feedback modal buttons.
    workflowActions.addEventListener("click", event => {
        const confirmButton = event.target.closest(
            '[data-action="confirm-workflow"]'
        );

        if (!confirmButton || dialogSubmitting) return;

        const formData = new FormData(workflowForm);
        const result = Object.fromEntries(formData.entries());

        dialogSubmitting = true;
        workflowModal.hidden = true;

        const resolver = dialogResolver;
        dialogResolver = null;

        if (resolver) resolver(result);
    });

    // Prevent accidental background scrolling when a modal is open.
    const originalOverflow = document.body.style.overflow;

    const modalObserver = new MutationObserver(() => {
        const hasOpenModal =
            !modal.hidden || !workflowModal.hidden;

        document.body.style.overflow = hasOpenModal
            ? "hidden"
            : originalOverflow;
    });

    modalObserver.observe(modal, {
        attributes: true,
        attributeFilter: ["hidden"]
    });

    modalObserver.observe(workflowModal, {
        attributes: true,
        attributeFilter: ["hidden"]
    });

    try {
        await loadOrders();
    } catch (error) {
        console.error("Orders loading error:", error);

        table.innerHTML = `
            <div class="page-error">
                ${safe(error.message || "Unable to load purchase orders.")}
            </div>
        `;
    }

    // Cleanup when this page is removed.
    return {
        cleanup() {
            stopDeliveryTimer();
            modalObserver.disconnect();
            document.body.style.overflow = originalOverflow;

            if (dialogResolver) {
                dialogResolver(null);
                dialogResolver = null;
            }
        }
    };
}
