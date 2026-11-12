
export async function render({
    supabase,
    supplier,
    view,
    formatCurrency,
    formatDate
}) {
    const supplierId = supplier.user_id;

    const [
        orders,
        invoices,
        deliveries,
        products,
        recentOrders
    ] = await Promise.all([
        // Purchase Orders
        supabase
            .from("supplier_purchase_orders")
            .select("order_id", { count: "exact", head: true })
            .eq("supplier_id", supplierId),

        // Invoices
        supabase
            .from("supplier_invoices")
            .select("invoice_id", { count: "exact", head: true })
            .eq("supplier_id", supplierId),

        // Deliveries
        supabase
            .from("supplier_deliveries")
            .select(
                "delivery_id, supplier_purchase_orders!inner(supplier_id)",
                { count: "exact", head: true }
            )
            .eq("supplier_purchase_orders.supplier_id", supplierId),

        // Listed Products - Correct Table
        supabase
            .from("supplier_product_listings")
            .select("product_listing_id", {
                count: "exact",
                head: true
            })
            .eq("supplier_id", supplierId),

        // Recent Purchase Orders
        supabase
            .from("supplier_purchase_orders")
            .select("order_id, order_number, order_status, order_date")
            .eq("supplier_id", supplierId)
            .order("created_at", { ascending: false })
            .limit(5)
    ]);

    // Handle query errors
    const errors = [
        orders,
        invoices,
        deliveries,
        products,
        recentOrders
    ].filter(result => result.error);

    if (errors.length) {
        console.error("Supplier dashboard error:", errors[0].error);
        throw errors[0].error;
    }

    // Dashboard statistics
    const stats = [
        {
            label: "Purchase Orders",
            value: orders.count ?? 0,
            icon: "fa-clipboard-list",
            color: "orange"
        },
        {
            label: "Invoices",
            value: invoices.count ?? 0,
            icon: "fa-file-invoice",
            color: "green"
        },
        {
            label: "Deliveries",
            value: deliveries.count ?? 0,
            icon: "fa-truck",
            color: "blue"
        },
        {
            label: "Listed Products",
            value: products.count ?? 0,
            icon: "fa-box",
            color: "purple"
        }
    ];

    const statusClass = status => {
        const normalized = String(status || "").toLowerCase();

        return `status-${normalized.replace(/[^a-z0-9_-]/g, "")}`;
    };

    const supplierName =
        supplier.business_name ||
        supplier.full_name ||
        "Supplier";

    view.innerHTML = `
        <div class="dashboard-welcome">
            <div>
                <span class="section-eyebrow">SUPPLIER OVERVIEW</span>
                <h2>Welcome, ${escapeHTML(supplierName)}!</h2>
                <p>Manage your products, purchase orders, and deliveries.</p>
            </div>
        </div>

        <div class="supplier-stat-grid">
            ${stats.map(stat => `
                <article class="supplier-stat-card">
                    <div class="stat-icon ${stat.color}">
                        <i class="fa-solid ${stat.icon}"></i>
                    </div>

                    <div>
                        <span>${stat.label}</span>
                        <h3>${stat.value}</h3>
                    </div>
                </article>
            `).join("")}
        </div>

        <section class="supplier-panel">
            <div class="panel-heading">
                <div>
                    <h3>Recent Purchase Orders</h3>
                    <p>Your latest purchase order activities</p>
                </div>

                <button
                    class="text-action"
                    id="viewAllOrders"
                    type="button"
                >
                    View all
                    <i class="fa-solid fa-arrow-right"></i>
                </button>
            </div>

            <div class="table-responsive">
                <table class="supplier-table">
                    <thead>
                        <tr>
                            <th>Order Number</th>
                            <th>Order Date</th>
                            <th>Status</th>
                        </tr>
                    </thead>

                    <tbody>
                        ${
                            recentOrders.data?.length
                                ? recentOrders.data.map(order => `
                                    <tr>
                                        <td class="order-number">
                                            ${escapeHTML(order.order_number)}
                                        </td>

                                        <td>
                                            ${formatDate(order.order_date)}
                                        </td>

                                        <td>
                                            <span class="status-badge ${statusClass(order.order_status)}">
                                                ${escapeHTML(order.order_status)}
                                            </span>
                                        </td>
                                    </tr>
                                `).join("")
                                : `
                                    <tr>
                                        <td colspan="3" class="empty-state">
                                            No purchase orders yet.
                                        </td>
                                    </tr>
                                `
                        }
                    </tbody>
                </table>
            </div>
        </section>
    `;

    view.querySelector("#viewAllOrders")?.addEventListener("click", () => {
        window.location.hash = "#orders";
    });
}

function escapeHTML(value = "") {
    return String(value).replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[character]);
}
