
export async function render({ supabase, supplier, view, escapeHTML, formatDate }) {
    const supplierId = supplier.user_id;
    let deliveries = [];

    view.innerHTML = `
        <section class="supplier-panel">
            <div class="panel-heading">
                <div>
                    <h3>Deliveries</h3>
                    <p>Track the delivery progress of your purchase orders.</p>
                </div>
            </div>

            <div class="filter-row">
                <input type="search" id="deliverySearch"
                    placeholder="Search delivery number..." />
                <select id="deliveryStatus">
                    <option value="">All Statuses</option>
                </select>
            </div>

            <div id="deliveryList">
                <div class="page-loading">
                    <i class="fa-solid fa-spinner fa-spin"></i> Loading deliveries...
                </div>
            </div>
        </section>

        <div class="modal-overlay" id="deliveryModal" hidden>
            <div class="modal-content">
                <div class="panel-heading">
                    <h3>Delivery Details</h3>
                    <button type="button" class="icon-button"
                        id="closeDeliveryModal" aria-label="Close">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <div id="deliveryDetails"></div>
            </div>
        </div>
    `;

    const list = view.querySelector("#deliveryList");
    const search = view.querySelector("#deliverySearch");
    const statusFilter = view.querySelector("#deliveryStatus");
    const modal = view.querySelector("#deliveryModal");

    async function loadDeliveries() {
        const { data: orders, error: orderError } = await supabase
            .from("supplier_purchase_orders")
            .select("order_id, order_number")
            .eq("supplier_id", supplierId);

        if (orderError) throw orderError;

        const orderMap = Object.fromEntries(
            (orders || []).map(order => [order.order_id, order.order_number])
        );

        const orderIds = (orders || []).map(order => order.order_id);

        if (!orderIds.length) {
            deliveries = [];
            renderDeliveries();
            return;
        }

        const { data, error } = await supabase
            .from("supplier_deliveries")
            .select(`
                delivery_id,
                order_id,
                delivery_number,
                delivery_status,
                scheduled_at,
                shipped_at,
                delivered_at,
                delivery_notes,
                received_by,
                created_at
            `)
            .in("order_id", orderIds)
            .order("created_at", { ascending: false });

        if (error) throw error;

        deliveries = (data || []).map(delivery => ({
            ...delivery,
            order_number: orderMap[delivery.order_id] || "—"
        }));

        const statuses = [...new Set(
            deliveries.map(item => item.delivery_status).filter(Boolean)
        )];

        statusFilter.innerHTML = `
            <option value="">All Statuses</option>
            ${statuses.map(status => `
                <option value="${escapeHTML(status)}">${escapeHTML(status)}</option>
            `).join("")}
        `;

        renderDeliveries();
    }

    function renderDeliveries() {
        const query = search.value.trim().toLowerCase();
        const selectedStatus = statusFilter.value;

        const filtered = deliveries.filter(delivery => {
            return (
                String(delivery.delivery_number).toLowerCase().includes(query) ||
                String(delivery.order_number).toLowerCase().includes(query)
            ) && (
                !selectedStatus || delivery.delivery_status === selectedStatus
            );
        });

        if (!filtered.length) {
            list.innerHTML = `
                <div class="empty-state">
                    <i class="fa-solid fa-truck"></i>
                    <p>No delivery records found.</p>
                </div>
            `;
            return;
        }

        list.innerHTML = `
            <div class="table-responsive">
                <table class="supplier-table">
                    <thead>
                        <tr>
                            <th>Delivery Number</th>
                            <th>Order Number</th>
                            <th>Scheduled Date</th>
                            <th>Delivery Status</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filtered.map(delivery => `
                            <tr>
                                <td>${escapeHTML(delivery.delivery_number)}</td>
                                <td>${escapeHTML(delivery.order_number)}</td>
                                <td>${formatDate(delivery.scheduled_at)}</td>
                                <td>
                                    <span class="status-badge">
                                        ${escapeHTML(delivery.delivery_status)}
                                    </span>
                                </td>
                                <td>
                                    <button class="text-action view-delivery"
                                        data-id="${delivery.delivery_id}" type="button">
                                        View Details
                                    </button>
                                </td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            </div>
        `;

        list.querySelectorAll(".view-delivery").forEach(button => {
            button.addEventListener("click", () => {
                showDetails(button.dataset.id);
            });
        });
    }

    function showDetails(deliveryId) {
        const delivery = deliveries.find(item =>
            item.delivery_id === deliveryId
        );

        if (!delivery) return;

        view.querySelector("#deliveryDetails").innerHTML = `
            <div class="order-summary">
                <p><strong>Delivery Number:</strong> ${escapeHTML(delivery.delivery_number)}</p>
                <p><strong>Order Number:</strong> ${escapeHTML(delivery.order_number)}</p>
                <p><strong>Status:</strong> ${escapeHTML(delivery.delivery_status)}</p>
                <p><strong>Scheduled:</strong> ${formatDate(delivery.scheduled_at)}</p>
                <p><strong>Shipped:</strong> ${formatDate(delivery.shipped_at)}</p>
                <p><strong>Delivered:</strong> ${formatDate(delivery.delivered_at)}</p>
                <p><strong>Received By:</strong> ${escapeHTML(delivery.received_by || "—")}</p>
                <p><strong>Delivery Notes:</strong> ${escapeHTML(delivery.delivery_notes || "—")}</p>
            </div>
        `;

        modal.hidden = false;
    }

    search.addEventListener("input", renderDeliveries);
    statusFilter.addEventListener("change", renderDeliveries);

    view.querySelector("#closeDeliveryModal").addEventListener("click", () => {
        modal.hidden = true;
    });

    modal.addEventListener("click", event => {
        if (event.target === modal) modal.hidden = true;
    });

    try {
        await loadDeliveries();
    } catch (error) {
        console.error("Delivery loading error:", error);
        list.innerHTML = `
            <div class="page-error">${escapeHTML(error.message)}</div>
        `;
    }
}
