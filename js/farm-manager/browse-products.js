import { supabase } from '../connection.js';
import { h } from '../admin/ui.js';

let active = false;
let ordersRealtimeChannel = null;
let trackingTimer = null;
let selectedTrackingOrderId = null;

const PRODUCT_PHOTO_BUCKET = 'supplier-product-photos';
const SIGNED_URL_EXPIRY = 3600;

const money = (value) =>
    Number(value || 0).toLocaleString('en-PH', {
        style: 'currency',
        currency: 'PHP'
    });

const date = (value) =>
    value
        ? new Date(value).toLocaleString('en-PH', {
            dateStyle: 'medium',
            timeStyle: 'short'
        })
        : '—';

const normalize = (value) => String(value ?? '').trim().toLowerCase();

const escapeHTML = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[character]);

const message = (text, error = false) =>
    h('p', { class: error ? 'msg error' : 'muted' }, text);

const button = (label, action, className = '') => {
    const element = h('button', {
        type: 'button',
        class: className || 'fm-orders-btn'
    }, label);

    element.addEventListener('click', action);
    return element;
};

const quantityRules = (unit) => {
    const decimal = normalize(unit) === 'kg';

    return {
        min: decimal ? '0.01' : '1',
        step: decimal ? '0.01' : '1',
        decimal
    };
};

function validateQuantity(quantity, unit, available) {
    if (!Number.isFinite(quantity) || quantity <= 0) {
        return 'Enter a valid quantity greater than zero.';
    }

    if (!quantityRules(unit).decimal && !Number.isInteger(quantity)) {
        return `Quantity for ${unit || 'this product'} must be a whole number.`;
    }

    if (quantity > Number(available)) {
        return `Only ${available} ${unit || ''} currently available.`;
    }

    return null;
}

function hasValidPrice(product) {
    return product?.price !== null &&
        product?.price !== undefined &&
        Number.isFinite(Number(product.price)) &&
        Number(product.price) >= 0;
}

function isUnavailable(item) {
    return !item.product ||
        Number(item.product.stock_quantity) <= 0 ||
        !hasValidPrice(item.product);
}

function hasStockIssue(item) {
    return Number(item.quantity) > Number(item.product.stock_quantity);
}

async function fetchSupplierNames(supplierIds) {
    if (!supplierIds.length) return {};

    const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', supplierIds);

    if (error) throw error;

    return Object.fromEntries(
        (data || []).map((profile) => [
            profile.id,
            profile.full_name || 'Supplier'
        ])
    );
}

async function attachProductPhotos(items) {
    const paths = [
        ...new Set(
            items
                .map((item) => item.photo_path)
                .filter((path) => path && !/^https?:\/\//i.test(path))
        )
    ];

    const urls = {};

    if (paths.length) {
        const { data, error } = await supabase.storage
            .from(PRODUCT_PHOTO_BUCKET)
            .createSignedUrls(paths, SIGNED_URL_EXPIRY);

        if (error) {
            console.error('Product photo URL error:', error);
        } else {
            (data || []).forEach((photo) => {
                if (photo.path && photo.signedUrl) {
                    urls[photo.path] = photo.signedUrl;
                }
            });
        }
    }

    return items.map((item) => {
        if (!item.photo_path) {
            return { ...item, photo_url: null };
        }

        if (/^https?:\/\//i.test(item.photo_path)) {
            return { ...item, photo_url: item.photo_path };
        }

        if (urls[item.photo_path]) {
            return { ...item, photo_url: urls[item.photo_path] };
        }

        const { data } = supabase.storage
            .from(PRODUCT_PHOTO_BUCKET)
            .getPublicUrl(item.photo_path);

        return {
            ...item,
            photo_url: data?.publicUrl || null
        };
    });
}

function productImage(product, className) {
    const placeholder = h(
        'div',
        { class: `${className}-placeholder` },
        'No Image Available'
    );

    if (!product?.photo_url) return placeholder;

    const img = h('img', {
        src: product.photo_url,
        alt: product.product_name || 'Product image',
        class: className,
        loading: 'lazy'
    });

    img.addEventListener('error', () => img.replaceWith(placeholder));

    return img;
}

export function cleanup() {
    active = false;

    if (ordersRealtimeChannel) {
        supabase.removeChannel(ordersRealtimeChannel);
        ordersRealtimeChannel = null;
    }

    if (trackingTimer) {
        window.clearInterval(trackingTimer);
        trackingTimer = null;
    }

    selectedTrackingOrderId = null;

    const modal = document.getElementById('fmTrackingModal');

    if (modal) modal.remove();

    document.body.style.overflow = '';
}

export async function render(root, ctx = {}) {
    active = true;

    const requestId = ctx.replenishmentRequestId || null;
    const cartMode = ctx.cartMode === true;

    const {
        data: { user },
        error: authError
    } = await supabase.auth.getUser();

    if (!active) return;

    if (authError || !user) {
        root.replaceChildren(message('Please log in again.', true));
        return;
    }

    let products = [];
    let cart = [];
    let orders = [];
    let currentTab = cartMode ? 'cart' : 'products';

    const page = h('div', { class: 'fm-orders-page' });
    const content = h('div', { class: 'fm-orders-content' });
    const feedback = h('p', {
        class: 'fm-orders-feedback',
        hidden: true
    });
    const tabs = h('div', { class: 'fm-orders-tabs' });

    function showFeedback(text, isError = false) {
        feedback.textContent = text;
        feedback.className = isError
            ? 'fm-orders-feedback is-error'
            : 'fm-orders-feedback';
        feedback.hidden = !text;
    }

    function notifyCartUpdated() {
        window.dispatchEvent(new CustomEvent('fm-cart-updated'));
    }

    function createTab(label, key) {
        const element = button(label, () => setTab(key));
        element.dataset.tab = key;
        return element;
    }

    tabs.append(
        createTab('Browse Products', 'products'),
        createTab('Cart', 'cart'),
        createTab('Purchase Orders', 'orders')
    );

    page.append(
        h(
            'header',
            { class: 'fm-orders-header' },
            h('h1', {}, cartMode ? 'Shopping Cart' : 'Browse Products'),
            h(
                'p',
                {},
                'Browse agricultural products and purchase directly from suppliers.'
            )
        ),
        tabs,
        feedback,
        content
    );

    root.replaceChildren(page);

    // =========================================
    // LOAD PRODUCTS
    // =========================================

    async function loadProducts() {
        const { data, error } = await supabase
            .from('supplier_product_listings')
            .select(`
                product_listing_id,
                supplier_id,
                product_name,
                description,
                price,
                stock_quantity,
                unit,
                photo_path
            `)
            .gt('stock_quantity', 0)
            .order('product_name', { ascending: true });

        if (error) throw error;
        if (!active) return;

        const rows = data || [];

        const supplierIds = [
            ...new Set(rows.map((item) => item.supplier_id).filter(Boolean))
        ];

        const [photoRows, supplierNames] = await Promise.all([
            attachProductPhotos(rows),
            fetchSupplierNames(supplierIds)
        ]);

        products = photoRows.map((item) => ({
            ...item,
            supplier_name: supplierNames[item.supplier_id] || 'Supplier'
        }));
    }

    // =========================================
    // LOAD CART
    // =========================================

    async function loadCart() {
        const { data, error } = await supabase
            .from('farm_manager_cart_items')
            .select(`
                cart_item_id,
                manager_user_id,
                replenishment_request_id,
                product_listing_id,
                quantity,
                created_at
            `)
            .eq('manager_user_id', user.id)
            .order('created_at', { ascending: true });

        if (error) throw error;
        if (!active) return;

        const rows = data || [];

        const listingIds = [
            ...new Set(rows.map((item) => item.product_listing_id).filter(Boolean))
        ];

        let listingMap = {};

        if (listingIds.length) {
            const { data: listings, error: listingError } = await supabase
                .from('supplier_product_listings')
                .select(`
                    product_listing_id,
                    supplier_id,
                    product_name,
                    price,
                    stock_quantity,
                    unit,
                    photo_path
                `)
                .in('product_listing_id', listingIds);

            if (listingError) throw listingError;

            const supplierIds = [
                ...new Set(
                    (listings || [])
                        .map((item) => item.supplier_id)
                        .filter(Boolean)
                )
            ];

            const [photoRows, supplierNames] = await Promise.all([
                attachProductPhotos(listings || []),
                fetchSupplierNames(supplierIds)
            ]);

            listingMap = Object.fromEntries(
                photoRows.map((item) => [
                    item.product_listing_id,
                    {
                        ...item,
                        supplier_name: supplierNames[item.supplier_id] || 'Supplier'
                    }
                ])
            );
        }

        cart = rows.map((item) => ({
            ...item,
            product: listingMap[item.product_listing_id] || {
                product_listing_id: item.product_listing_id,
                product_name: 'Unavailable product',
                supplier_name: 'Supplier',
                price: null,
                stock_quantity: 0,
                unit: '',
                photo_url: null
            }
        }));
    }

    // =========================================
    // ADD TO CART
    // =========================================

    async function addToCart(product, quantity, addButton) {
        const validation = validateQuantity(
            quantity,
            product.unit,
            product.stock_quantity
        );

        if (validation) {
            showFeedback(validation, true);
            return;
        }

        addButton.disabled = true;
        addButton.textContent = 'Adding...';

        try {
            const { error } = await supabase.rpc(
                'fm_add_supplier_product_to_cart',
                {
                    p_request_id: requestId,
                    p_product_listing_id: product.product_listing_id,
                    p_quantity: quantity
                }
            );

            if (error) throw error;

            await loadCart();

            notifyCartUpdated();
            showFeedback(`${product.product_name} added to cart.`);

            addButton.textContent = 'Added to Cart';

            if (currentTab === 'cart') renderCart();

        } finally {
            addButton.disabled = false;

            if (addButton.textContent !== 'Added to Cart') {
                addButton.textContent = 'Add to Cart';
            }
        }
    }

    // =========================================
    // BROWSE PRODUCTS
    // =========================================

    function renderProducts() {
        content.replaceChildren();

        const search = h('input', {
            type: 'search',
            placeholder: 'Search products or suppliers...',
            class: 'fm-orders-search'
        });

        const count = h('span', {
            class: 'fm-orders-product-count'
        });

        const toolbar = h(
            'div',
            { class: 'fm-orders-products-toolbar' },
            search,
            count
        );

        const grid = h('div', {
            class: 'fm-orders-grid fm-orders-browse-grid'
        });

        function draw(list) {
            grid.replaceChildren();

            count.textContent = `${list.length} products available`;

            if (!list.length) {
                grid.append(
                    h(
                        'div',
                        { class: 'fm-orders-empty' },
                        h('h3', {}, 'No products found'),
                        h('p', {}, 'Try another search or check back later.')
                    )
                );
                return;
            }

            list.forEach((product) => {
                const rules = quantityRules(product.unit);

                const quantityInput = h('input', {
                    type: 'number',
                    min: rules.min,
                    step: rules.step,
                    max: String(product.stock_quantity),
                    value: '1',
                    class: 'fm-orders-quantity'
                });

                const addButton = button(
                    'Add to Cart',
                    async () => {
                        try {
                            await addToCart(
                                product,
                                Number(quantityInput.value),
                                addButton
                            );
                        } catch (error) {
                            console.error('Add to cart failed:', error);
                            showFeedback(
                                error.message || 'Unable to add product to cart.',
                                true
                            );
                        }
                    },
                    'fm-orders-add-to-cart'
                );

                const card = h(
                    'article',
                    { class: 'fm-orders-product' },

                    h(
                        'div',
                        { class: 'fm-orders-product-image-wrap' },
                        productImage(product, 'fm-orders-product-image')
                    ),

                    h(
                        'div',
                        { class: 'fm-orders-product-details' },

                        h('h3', {}, product.product_name),

                        h(
                            'p',
                            { class: 'fm-orders-product-description' },
                            product.description || 'No description available.'
                        ),

                        h(
                            'p',
                            { class: 'fm-orders-product-supplier' },
                            `Supplier: ${product.supplier_name}`
                        ),

                        h(
                            'div',
                            { class: 'fm-orders-product-price-row' },
                            h(
                                'strong',
                                { class: 'fm-orders-product-price' },
                                money(product.price)
                            ),
                            h('span', {}, `per ${product.unit || 'unit'}`)
                        ),

                        h(
                            'p',
                            { class: 'fm-orders-product-stock' },
                            `Available stock: ${product.stock_quantity} ${product.unit || ''}`
                        ),

                        h(
                            'div',
                            { class: 'fm-orders-product-buy' },
                            h('label', {}, 'Quantity', quantityInput),
                            addButton
                        )
                    )
                );

                grid.append(card);
            });
        }

        search.addEventListener('input', () => {
            const query = normalize(search.value);

            draw(products.filter((product) =>
                [
                    product.product_name,
                    product.description,
                    product.supplier_name
                ]
                    .filter(Boolean)
                    .join(' ')
                    .toLowerCase()
                    .includes(query)
            ));
        });

        content.append(toolbar, grid);
        draw(products);
    }

    // =========================================
    // UPDATE CART QUANTITY
    // =========================================

    async function updateCartQuantity(item, quantity) {
        const validation = validateQuantity(
            quantity,
            item.product.unit,
            item.product.stock_quantity
        );

        if (validation) throw new Error(validation);

        const { error } = await supabase.rpc(
            'fm_update_supplier_cart_quantity',
            {
                p_cart_item_id: item.cart_item_id,
                p_quantity: quantity
            }
        );

        if (error) throw error;

        await loadCart();
        notifyCartUpdated();

        showFeedback('Cart quantity updated.');
        renderCart();
    }

    // =========================================
    // REMOVE CART ITEM
    // =========================================

    async function removeCartItem(item) {
        const { error } = await supabase.rpc(
            'fm_remove_supplier_cart_item',
            {
                p_cart_item_id: item.cart_item_id
            }
        );

        if (error) throw error;

        await loadCart();
        notifyCartUpdated();

        showFeedback('Product removed from cart.');
        renderCart();
    }

    // =========================================
    // CHECKOUT
    // =========================================

    async function checkout(groupRequestId) {
        const groupItems = cart.filter(
            (item) => item.replenishment_request_id === groupRequestId
        );

        if (!groupItems.length) {
            throw new Error('Your cart is empty.');
        }

        if (groupItems.some(
            (item) => isUnavailable(item) || hasStockIssue(item)
        )) {
            throw new Error(
                'Please review unavailable products or insufficient stock before checkout.'
            );
        }

        const { error } = await supabase.rpc(
            'fm_checkout_supplier_cart',
            {
                p_request_id: groupRequestId
            }
        );

        if (error) throw error;

        await loadCart();
        notifyCartUpdated();

        showFeedback('Purchase orders created successfully.');
        renderCart();
    }

    // =========================================
    // CART ITEM
    // =========================================

    function createCartItem(item) {
        const product = item.product;
        const unit = product.unit || 'unit';
        const unavailable = isUnavailable(item);
        const stockIssue = !unavailable && hasStockIssue(item);
        const rules = quantityRules(unit);

        const quantityInput = h('input', {
            type: 'number',
            min: rules.min,
            step: rules.step,
            max: String(product.stock_quantity),
            value: String(item.quantity),
            class: 'fm-orders-quantity'
        });

        quantityInput.disabled = unavailable;

        const updateButton = button(
            'Update',
            async () => {
                try {
                    updateButton.disabled = true;
                    await updateCartQuantity(item, Number(quantityInput.value));
                } catch (error) {
                    showFeedback(error.message, true);
                } finally {
                    updateButton.disabled = false;
                }
            },
            'fm-orders-cart-action fm-orders-cart-save'
        );

        updateButton.disabled = unavailable;

        const removeButton = button(
            'Remove',
            async () => {
                if (!window.confirm('Remove this product from your cart?')) return;

                try {
                    removeButton.disabled = true;
                    await removeCartItem(item);
                } catch (error) {
                    showFeedback(error.message, true);
                    removeButton.disabled = false;
                }
            },
            'fm-orders-cart-action fm-orders-cart-remove'
        );

        return h(
            'article',
            { class: 'fm-orders-cart-item' },

            h(
                'div',
                { class: 'fm-orders-cart-image-wrap' },
                productImage(product, 'fm-orders-cart-image')
            ),

            h(
                'div',
                { class: 'fm-orders-cart-content' },

                h('h3', {}, product.product_name),

                h(
                    'p',
                    { class: 'fm-orders-cart-meta' },
                    `Supplier: ${product.supplier_name} · ${unit}`
                ),

                h(
                    'p',
                    {},
                    hasValidPrice(product)
                        ? `${money(product.price)} per ${unit}`
                        : 'Price unavailable'
                ),

                h(
                    'div',
                    { class: 'fm-orders-cart-quantity' },
                    h('label', {}, 'Quantity', quantityInput),
                    updateButton,
                    removeButton
                ),

                h(
                    'strong',
                    { class: 'fm-orders-cart-subtotal' },
                    hasValidPrice(product)
                        ? `Subtotal: ${money(Number(item.quantity) * Number(product.price))}`
                        : 'Subtotal: —'
                ),

                unavailable
                    ? h('p', { class: 'fm-orders-cart-error' },
                        'This product is unavailable or has no valid price.')
                    : '',

                stockIssue
                    ? h('p', { class: 'fm-orders-cart-error' },
                        `Only ${product.stock_quantity} ${unit} currently available.`)
                    : ''
            )
        );
    }

    // =========================================
    // CART DISPLAY
    // =========================================

    function renderCart() {
        content.replaceChildren();

        if (!cart.length) {
            content.append(
                h(
                    'div',
                    { class: 'fm-orders-empty' },
                    h('h3', {}, 'Your cart is empty'),
                    h('p', {}, 'Browse products and add items to your cart.')
                )
            );
            return;
        }

        const groups = new Map();

        cart.forEach((item) => {
            const key = item.replenishment_request_id;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(item);
        });

        groups.forEach((items, groupRequestId) => {
            const validItems = items.filter((item) => !isUnavailable(item));

            const total = validItems.reduce(
                (sum, item) =>
                    sum + Number(item.quantity) * Number(item.product.price),
                0
            );

            const hasIssue = items.some(
                (item) => isUnavailable(item) || hasStockIssue(item)
            );

            const checkoutButton = button(
                'Checkout',
                async () => {
                    try {
                        checkoutButton.disabled = true;
                        checkoutButton.textContent = 'Processing...';

                        await checkout(groupRequestId);
                    } catch (error) {
                        showFeedback(error.message, true);
                    } finally {
                        checkoutButton.disabled = false;
                        checkoutButton.textContent = 'Checkout';
                    }
                },
                'fm-orders-checkout'
            );

            checkoutButton.disabled = hasIssue || !validItems.length;

            const groupTitle = groupRequestId
                ? `Replenishment Request: ${groupRequestId}`
                : 'Direct Purchase';

            const summary = h(
                'aside',
                { class: 'fm-orders-cart-summary' },

                h('h3', {}, 'Order Summary'),

                h(
                    'p',
                    {},
                    `${items.length} ${items.length === 1 ? 'product' : 'products'}`
                ),

                h(
                    'div',
                    { class: 'fm-orders-summary-total' },
                    h('span', {}, 'Total'),
                    h('strong', {}, money(total))
                ),

                hasIssue
                    ? h('p', { class: 'fm-orders-cart-error' },
                        'Resolve product availability or quantity issues before checkout.')
                    : '',

                checkoutButton
            );

            content.append(
                h(
                    'section',
                    { class: 'fm-orders-cart-group' },

                    h('h2', {}, groupTitle),

                    h(
                        'div',
                        { class: 'fm-orders-cart-layout' },

                        h(
                            'div',
                            { class: 'fm-orders-cart-list' },
                            items.map(createCartItem)
                        ),

                        summary
                    )
                )
            );
        });
    }

    // =========================================
    // PURCHASE ORDERS
    // =========================================

    async function loadOrders() {
        const { data, error } = await supabase
            .from('supplier_purchase_orders')
            .select(`
                order_id,
                supplier_id,
                order_number,
                order_status,
                order_date,
                notes,
                replenishment_request_id,
                created_at,
                accepted_at,
                preparing_at,
                shipped_at,
                expected_delivery_at,
                delivered_at,
                completed_at
            `)
            .eq('requested_by', user.id)
            .order('created_at', { ascending: false });

        if (error) throw error;

        orders = data || [];
    }

    async function renderOrders() {
        content.replaceChildren(message('Loading purchase orders...'));

        try {
            await loadOrders();

            if (!active || currentTab !== 'orders') return;

            if (!orders.length) {
                content.replaceChildren(
                    h(
                        'div',
                        { class: 'fm-orders-empty' },
                        h('h3', {}, 'No purchase orders found'),
                        h('p', {}, 'Your supplier purchase orders will appear here.')
                    )
                );
                return;
            }

            const orderIds = orders.map((item) => item.order_id);

            const [itemsResult, deliveriesResult] = await Promise.all([
                supabase
                    .from('supplier_purchase_order_items')
                    .select(`
                        order_item_id,
                        order_id,
                        product_listing_id,
                        quantity,
                        unit_price,
                        subtotal
                    `)
                    .in('order_id', orderIds),

                supabase
                    .from('supplier_deliveries')
                    .select(`
                        delivery_id,
                        order_id,
                        delivery_number,
                        delivery_status,
                        scheduled_at,
                        shipped_at,
                        delivered_at,
                        delivery_notes
                    `)
                    .in('order_id', orderIds)
            ]);

            if (itemsResult.error) throw itemsResult.error;
            if (deliveriesResult.error) throw deliveriesResult.error;

            const items = itemsResult.data || [];
            const deliveries = deliveriesResult.data || [];

            const listingIds = [
                ...new Set(
                    items.map((item) => item.product_listing_id).filter(Boolean)
                )
            ];

            let listingMap = {};

            if (listingIds.length) {
                const { data, error } = await supabase
                    .from('supplier_product_listings')
                    .select('product_listing_id, product_name, unit')
                    .in('product_listing_id', listingIds);

                if (error) throw error;

                listingMap = Object.fromEntries(
                    (data || []).map((item) => [
                        item.product_listing_id,
                        item
                    ])
                );
            }

            const supplierIds = [
                ...new Set(orders.map((item) => item.supplier_id).filter(Boolean))
            ];

            const supplierNames = await fetchSupplierNames(supplierIds);

            const cards = orders.map((order) => {
                const orderItems = items.filter(
                    (item) => item.order_id === order.order_id
                );

                const delivery = deliveries.find(
                    (item) => item.order_id === order.order_id
                );

                const total = orderItems.reduce(
                    (sum, item) =>
                        sum + Number(
                            item.subtotal ??
                            Number(item.quantity) * Number(item.unit_price)
                        ),
                    0
                );

                const orderCard = h(
                    'article',
                    { class: 'fm-orders-order' },

                    h('h3', {}, order.order_number),

                    h(
                        'p',
                        {},
                        `Supplier: ${supplierNames[order.supplier_id] || 'Supplier'}`
                    ),

                    h('p', {}, `Order Date: ${date(order.order_date)}`),

                    h(
                        'p',
                        { class: 'fm-orders-order-status' },
                        `Status: ${String(order.order_status || '').toUpperCase()}`
                    ),

                    h(
                        'div',
                        { class: 'fm-orders-order-items' },
                        orderItems.map((item) => {
                            const product = listingMap[item.product_listing_id];

                            return h(
                                'p',
                                {},
                                `${product?.product_name || 'Product'} — ${item.quantity} ${product?.unit || ''} × ${money(item.unit_price)}`
                            );
                        })
                    ),

                    h('strong', {}, `Total: ${money(total)}`),

                    order.replenishment_request_id
                        ? h('p', {},
                            `Replenishment Request: ${order.replenishment_request_id}`)
                        : h('p', {}, 'Direct Purchase')
                );

                if (delivery) {
                    orderCard.append(
                        h(
                            'div',
                            { class: 'fm-orders-delivery' },
                            h('h4', {}, 'Delivery'),
                            h('p', {}, `Delivery No.: ${delivery.delivery_number}`),
                            h('p', {}, `Status: ${delivery.delivery_status}`),
                            h('p', {}, `Scheduled: ${date(delivery.scheduled_at)}`),
                            h('p', {}, `Shipped: ${date(delivery.shipped_at)}`),
                            h('p', {}, `Delivered: ${date(delivery.delivered_at)}`),
                            h('p', {}, delivery.delivery_notes || '')
                        )
                    );
                }

                if (normalize(order.order_status) === 'shipped') {
                    orderCard.append(
                        button(
                            'Track Order',
                            () => openTrackingModal(order.order_id),
                            'fm-orders-track-button'
                        )
                    );
                }

                return orderCard;
            });

            if (!active || currentTab !== 'orders') return;

            content.replaceChildren(
                h('div', { class: 'fm-orders-list' }, cards)
            );

            if (selectedTrackingOrderId) {
                const updatedOrder = orders.find(
                    (item) => item.order_id === selectedTrackingOrderId
                );

                if (updatedOrder && normalize(updatedOrder.order_status) === 'shipped') {
                    renderTrackingModal(updatedOrder);
                } else {
                    closeTrackingModal();
                }
            }

        } catch (error) {
            console.error('Failed to load purchase orders:', error);

            content.replaceChildren(
                message(error.message || 'Could not load purchase orders.', true)
            );
        }
    }

    // =========================================
    // TRACKING COUNTDOWN
    // =========================================

    function formatCountdown(expectedAt) {
        if (!expectedAt) {
            return `
                <div class="fm-tracking-unavailable">
                    Expected delivery schedule is not available yet.
                </div>
            `;
        }

        const difference = new Date(expectedAt).getTime() - Date.now();

        if (!Number.isFinite(difference)) {
            return '<p>Invalid delivery schedule.</p>';
        }

        if (difference <= 0) {
            return `
                <div class="fm-tracking-arrival">
                    <strong>Expected delivery time reached!</strong>
                    <span>Your order may arrive shortly.</span>
                </div>
            `;
        }

        const days = Math.floor(difference / 86400000);
        const hours = Math.floor((difference % 86400000) / 3600000);
        const minutes = Math.floor((difference % 3600000) / 60000);
        const seconds = Math.floor((difference % 60000) / 1000);

        return `
            <div class="fm-tracking-countdown">
                <div><strong>${String(days).padStart(2, '0')}</strong><span>Days</span></div>
                <div><strong>${String(hours).padStart(2, '0')}</strong><span>Hours</span></div>
                <div><strong>${String(minutes).padStart(2, '0')}</strong><span>Minutes</span></div>
                <div><strong>${String(seconds).padStart(2, '0')}</strong><span>Seconds</span></div>
            </div>
        `;
    }

    function updateTrackingCountdown(expectedAt) {
        const container = document.getElementById('fmTrackingCountdown');

        if (container) {
            container.innerHTML = formatCountdown(expectedAt);
        }
    }

    // =========================================
    // TRACKING MODAL
    // =========================================

    function ensureTrackingModal() {
        let modal = document.getElementById('fmTrackingModal');

        if (modal) return modal;

        modal = document.createElement('div');
        modal.id = 'fmTrackingModal';
        modal.className = 'fm-tracking-overlay';
        modal.hidden = true;

        modal.innerHTML = `
            <section class="fm-tracking-modal" role="dialog" aria-modal="true"
                aria-labelledby="fmTrackingTitle">

                <header class="fm-tracking-header">
                    <div>
                        <span class="fm-tracking-eyebrow">TANIKALA ORDER TRACKING</span>
                        <h2 id="fmTrackingTitle">Track Your Order</h2>
                        <p id="fmTrackingReference"></p>
                    </div>

                    <button type="button" id="fmTrackingClose" aria-label="Close tracking">
                        ×
                    </button>
                </header>

                <div id="fmTrackingBody" class="fm-tracking-body"></div>

                <footer class="fm-tracking-footer">
                    Grow together, from farm to table.
                </footer>
            </section>
        `;

        document.body.append(modal);

        modal.addEventListener('click', (event) => {
            if (event.target === modal) closeTrackingModal();
        });

        modal.querySelector('#fmTrackingClose')
            .addEventListener('click', closeTrackingModal);

        return modal;
    }

    function getTrackingStepClass(order, step) {
        const status = normalize(order.order_status);

        const progress = {
            accepted: 1,
            preparing: 2,
            shipped: 3,
            delivered: 4,
            completed: 5
        };

        const current = progress[status] || 0;
        const stepNumber = progress[step] || 0;

        if (current > stepNumber) return 'is-complete';
        if (current === stepNumber) return 'is-current';

        return '';
    }

    function renderTrackingModal(order) {
        const modal = ensureTrackingModal();

        selectedTrackingOrderId = order.order_id;

        const expectedAt = order.expected_delivery_at;
        const status = normalize(order.order_status);

        const steps = [
            {
                status: 'accepted',
                title: 'Order Accepted',
                description: 'The supplier accepted your purchase order.',
                timestamp: order.accepted_at
            },
            {
                status: 'preparing',
                title: 'Preparing Order',
                description: 'The supplier is preparing your products.',
                timestamp: order.preparing_at
            },
            {
                status: 'shipped',
                title: 'Shipped / In Transit',
                description: 'Your order has been dispatched.',
                timestamp: order.shipped_at
            },
            {
                status: 'delivered',
                title: 'Delivered',
                description: 'Your order has arrived.',
                timestamp: order.delivered_at
            },
            {
                status: 'completed',
                title: 'Completed',
                description: 'Your purchase order has been completed.',
                timestamp: order.completed_at
            }
        ];

        modal.querySelector('#fmTrackingReference').textContent =
            `Order #${order.order_number}`;

        modal.querySelector('#fmTrackingBody').innerHTML = `
            <section class="fm-tracking-hero">
                <div class="fm-tracking-icon">🚚</div>

                <span class="fm-tracking-live">
                    ${status === 'shipped' ? '● IN TRANSIT' : escapeHTML(status.toUpperCase())}
                </span>

                <h3>
                    ${status === 'shipped'
                        ? 'Your order is on its way!'
                        : `Order ${escapeHTML(status)}`}
                </h3>

                <p>
                    ${status === 'shipped'
                        ? 'The supplier has dispatched your order. Monitor the expected delivery below.'
                        : 'Here is the latest progress of your purchase order.'}
                </p>
            </section>

            <section class="fm-tracking-arrival-card">
                <span class="fm-tracking-label">EXPECTED DELIVERY</span>
                <strong class="fm-tracking-date">${escapeHTML(date(expectedAt))}</strong>

                <div id="fmTrackingCountdown">
                    ${formatCountdown(expectedAt)}
                </div>

                <p>Shipped: ${escapeHTML(date(order.shipped_at))}</p>
            </section>

            <section class="fm-tracking-progress-section">
                <h3>Order Progress</h3>

                <div class="fm-tracking-progress">
                    ${steps.map((step) => {
                        const stepClass = getTrackingStepClass(order, step.status);

                        return `
                            <div class="fm-tracking-step ${stepClass}">
                                <span class="fm-tracking-marker">
                                    ${stepClass === 'is-complete' ? '✓' : ''}
                                </span>

                                <div>
                                    <strong>${step.title}</strong>
                                    <small>${step.description}</small>

                                    ${step.timestamp
                                        ? `<small class="fm-tracking-timestamp">${escapeHTML(date(step.timestamp))}</small>`
                                        : ''}
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </section>
        `;

        modal.hidden = false;
        document.body.style.overflow = 'hidden';

        if (trackingTimer) {
            window.clearInterval(trackingTimer);
            trackingTimer = null;
        }

        updateTrackingCountdown(expectedAt);

        if (expectedAt && status === 'shipped') {
            trackingTimer = window.setInterval(() => {
                updateTrackingCountdown(expectedAt);
            }, 1000);
        }
    }

    function openTrackingModal(orderId) {
        const order = orders.find(
            (item) => String(item.order_id) === String(orderId)
        );

        if (!order || normalize(order.order_status) !== 'shipped') {
            return;
        }

        renderTrackingModal(order);
    }

    function closeTrackingModal() {
        const modal = document.getElementById('fmTrackingModal');

        if (modal) modal.hidden = true;

        if (trackingTimer) {
            window.clearInterval(trackingTimer);
            trackingTimer = null;
        }

        selectedTrackingOrderId = null;
        document.body.style.overflow = '';
    }

    // =========================================
    // REALTIME ORDER UPDATES
    // =========================================

    function subscribeToOrderUpdates() {
        if (ordersRealtimeChannel) {
            supabase.removeChannel(ordersRealtimeChannel);
            ordersRealtimeChannel = null;
        }

        ordersRealtimeChannel = supabase
            .channel(`fm-purchase-orders-${user.id}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'supplier_purchase_orders',
                    filter: `requested_by=eq.${user.id}`
                },
                async () => {
                    if (!active) return;

                    if (currentTab === 'orders') {
                        await renderOrders();
                    }
                }
            )
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    console.info('[Farm Manager Orders] Realtime connected.');
                }

                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    console.error('[Farm Manager Orders] Realtime error:', status);
                }
            });
    }

    // =========================================
    // TAB SWITCHING
    // =========================================

    function setTab(tab) {
        currentTab = tab;

        tabs.querySelectorAll('button').forEach((element) => {
            element.classList.toggle(
                'active',
                element.dataset.tab === tab
            );
        });

        if (tab !== 'orders') {
            closeTrackingModal();
        }

        if (tab === 'products') renderProducts();
        if (tab === 'cart') renderCart();
        if (tab === 'orders') renderOrders();
    }

    // =========================================
    // INITIALIZE
    // =========================================

    try {
        await Promise.all([
            loadProducts(),
            loadCart()
        ]);

        if (!active) return;

        subscribeToOrderUpdates();

        setTab(currentTab);

    } catch (error) {
        console.error('Failed to initialize Browse Products:', error);

        content.replaceChildren(
            message(error.message || 'Could not load Browse Products.', true)
        );
    }
}