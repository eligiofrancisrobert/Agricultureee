import { supabase } from '../connection.js';

const TABLE_CART = 'buyer_cart_items';
const TABLE_INVENTORY = 'warehouse_produce_inventory';
const TABLE_PRICES = 'farm_produce_prices';

const STORAGE_BUCKET = 'warehouse-inventory-photos';
const SIGNED_URL_EXPIRY = 3600;

const CHECKOUT_RPC = 'buyer_checkout_cart';

const state = {
  buyerId: null,
  cartItems: [],
  isCheckingOut: false,
};

const el = {
  todayLabel: document.getElementById('todayLabel'),
  userName: document.getElementById('userName'),
  userInitial: document.getElementById('userInitial'),
  logoutBtn: document.getElementById('logoutBtn'),

  cartCount: document.getElementById('cartCount'),

  checkoutLoading: document.getElementById('checkoutLoading'),
  checkoutLayout: document.getElementById('checkoutLayout'),
  checkoutEmpty: document.getElementById('checkoutEmpty'),
  checkoutError: document.getElementById('checkoutError'),

  orderItemCount: document.getElementById('orderItemCount'),
  checkoutItemsList: document.getElementById('checkoutItemsList'),

  checkoutItemCount: document.getElementById('checkoutItemCount'),
  checkoutSubtotal: document.getElementById('checkoutSubtotal'),
  checkoutTotal: document.getElementById('checkoutTotal'),

  placeOrderBtn: document.getElementById('placeOrderBtn'),
  toastStack: document.getElementById('toastStack'),
};

const peso = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 2,
});

function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function priceKey(item) {
  return [
    item.farm_id ?? '',
    normalize(item.crop_name),
    normalize(item.unit),
  ].join('::');
}

function setToday() {
  if (!el.todayLabel) return;

  el.todayLabel.textContent = new Intl.DateTimeFormat('en-PH', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date());
}

function showToast(message, type = 'success') {
  if (!el.toastStack) return;

  const toast = document.createElement('div');
  toast.className = `produce-toast ${type}`;
  toast.textContent = message;

  el.toastStack.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('show'));

  window.setTimeout(() => {
    toast.classList.remove('show');
    window.setTimeout(() => toast.remove(), 250);
  }, 3000);
}

function showError(message) {
  el.checkoutError.textContent = message;
  el.checkoutError.hidden = false;
}

function hideError() {
  el.checkoutError.hidden = true;
  el.checkoutError.textContent = '';
}

async function loadBuyerHeader() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) throw error;

  if (!user) {
    window.location.href = '../../index.html';
    return null;
  }

  state.buyerId = user.id;

  const metadata = user.user_metadata || {};

  const displayName =
    metadata.full_name ||
    metadata.fullName ||
    metadata.name ||
    user.email ||
    'Buyer';

  el.userName.textContent = displayName;
  el.userInitial.textContent =
    displayName.trim().charAt(0).toUpperCase() || 'B';

  return user;
}

async function loadCartCount() {
  if (!state.buyerId) return;

  const { count, error } = await supabase
    .from(TABLE_CART)
    .select('cart_item_id', {
      count: 'exact',
      head: true,
    })
    .eq('buyer_id', state.buyerId);

  if (error) {
    console.warn('Unable to load cart count:', error.message);
    return;
  }

  const total = Number(count || 0);

  el.cartCount.textContent = total > 99 ? '99+' : String(total);
  el.cartCount.hidden = total === 0;
}

async function resolvePhotoUrl(path) {
  if (!path) return '';

  const cleanPath = String(path).replace(/^\/+/, '');

  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(cleanPath, SIGNED_URL_EXPIRY);

  if (error) {
    console.warn('Unable to load produce photo:', error.message);
    return '';
  }

  return data?.signedUrl || '';
}

function createPlaceholder() {
  return `
    <div class="checkout-item-placeholder">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 22V12"></path>
        <path d="M12 12C5 12 3 8 3 4c6 0 9 3 9 8"></path>
        <path d="M12 15c0-5 3-8 9-8 0 5-3 8-9 8"></path>
      </svg>
    </div>
  `;
}

function isItemValid(item) {
  const product = item.product;
  const price = product.unit_price;
  const quantity = Number(item.quantity);
  const available = Number(product.available_quantity);

  return (
    product.produce_status === 'available' &&
    Number.isFinite(quantity) &&
    quantity > 0 &&
    Number.isFinite(available) &&
    quantity <= available &&
    price !== null &&
    Number.isFinite(Number(price)) &&
    Number(price) >= 0
  );
}

function createCheckoutItemMarkup(item) {
  const product = item.product;

  const name = escapeHTML(product.crop_name || 'Unnamed produce');
  const unit = escapeHTML(product.unit || 'unit');

  const quantity = Number(item.quantity);
  const price = product.unit_price;
  const validPrice = price !== null && Number.isFinite(Number(price));

  const lineTotal = validPrice
    ? quantity * Number(price)
    : null;

  const imageMarkup = product.photo_url
    ? `
      <img
        class="checkout-item-image"
        src="${escapeHTML(product.photo_url)}"
        alt="${name}"
        loading="lazy"
      >
    `
    : createPlaceholder();

  return `
    <article class="checkout-item">

      <div class="checkout-item-image-wrap">
        ${imageMarkup}
      </div>

      <div class="checkout-item-info">
        <h4>${name}</h4>
        <p>Quantity: ${quantity.toLocaleString('en-PH')} ${unit}</p>
        <p>Unit price: ${validPrice ? peso.format(Number(price)) : 'Unavailable'} / ${unit}</p>
      </div>

      <div class="checkout-item-total">
        ${lineTotal !== null ? peso.format(lineTotal) : 'Unavailable'}
        <small>Item total</small>
      </div>

    </article>
  `;
}

function renderCheckout() {
  const items = state.cartItems;

  el.checkoutLoading.hidden = true;

  if (!items.length) {
    el.checkoutLayout.hidden = true;
    el.checkoutEmpty.hidden = false;

    el.orderItemCount.textContent = '0 items to order';
    el.checkoutItemCount.textContent = '0';
    el.checkoutSubtotal.textContent = peso.format(0);
    el.checkoutTotal.textContent = peso.format(0);

    el.placeOrderBtn.disabled = true;
    return;
  }

  el.checkoutEmpty.hidden = true;
  el.checkoutLayout.hidden = false;

  el.checkoutItemsList.innerHTML = items
    .map(createCheckoutItemMarkup)
    .join('');

  const totalQuantity = items.reduce(
    (sum, item) => sum + Number(item.quantity),
    0
  );

  const subtotal = items.reduce((sum, item) => {
    if (!isItemValid(item)) return sum;

    return sum +
      Number(item.quantity) *
      Number(item.product.unit_price);
  }, 0);

  const invalidItems = items.filter(
    (item) => !isItemValid(item)
  );

  el.orderItemCount.textContent =
    `${items.length} ${items.length === 1 ? 'item' : 'items'} ready for review`;

  el.checkoutItemCount.textContent =
    `${items.length} (${totalQuantity.toLocaleString('en-PH')} total quantity)`;

  el.checkoutSubtotal.textContent = peso.format(subtotal);
  el.checkoutTotal.textContent = peso.format(subtotal);

  if (invalidItems.length) {
    el.placeOrderBtn.disabled = true;

    showError(
      'Some items have insufficient stock, are unavailable, or have no valid price. Please return to your cart and update or remove those items.'
    );

  } else {
    el.placeOrderBtn.disabled = false;
    hideError();
  }
}

/** Load cart rows with current stock and prices for checkout validation. */
async function loadCheckoutItems() {
  el.checkoutLoading.hidden = false;
  el.checkoutLayout.hidden = true;
  el.checkoutEmpty.hidden = true;
  hideError();

  try {
    const { data: cartRows, error: cartError } = await supabase
      .from(TABLE_CART)
      .select('cart_item_id, buyer_id, produce_id, quantity, created_at')
      .eq('buyer_id', state.buyerId)
      .order('created_at', { ascending: false });

    if (cartError) throw cartError;

    if (!cartRows?.length) {
      state.cartItems = [];
      renderCheckout();
      await loadCartCount();
      return;
    }

    const produceIds = [...new Set(
      cartRows.map((row) => row.produce_id)
    )];

    const [inventoryResult, pricesResult] = await Promise.all([
      supabase
        .from(TABLE_INVENTORY)
        .select(`
          produce_id,
          farm_id,
          crop_name,
          photo_path,
          available_quantity,
          unit,
          produce_status
        `)
        .in('produce_id', produceIds),

      supabase
        .from(TABLE_PRICES)
        .select('farm_id, crop_name, unit, unit_price'),
    ]);

    if (inventoryResult.error) throw inventoryResult.error;
    if (pricesResult.error) throw pricesResult.error;

    const inventoryMap = new Map(
      (inventoryResult.data || []).map((item) => [
        item.produce_id,
        item,
      ])
    );

    const priceMap = new Map();

    for (const price of pricesResult.data || []) {
      priceMap.set(priceKey(price), Number(price.unit_price));
    }

    state.cartItems = await Promise.all(
      cartRows.map(async (row) => {
        const inventory = inventoryMap.get(row.produce_id);

        if (!inventory) {
          return {
            ...row,
            product: {
              crop_name: 'Unavailable produce',
              unit: 'unit',
              available_quantity: 0,
              produce_status: 'unavailable',
              unit_price: null,
              photo_url: '',
            },
          };
        }

        const unitPrice = priceMap.get(priceKey(inventory));
        const photoUrl = await resolvePhotoUrl(inventory.photo_path);

        return {
          ...row,
          product: {
            ...inventory,
            unit_price:
              unitPrice !== undefined && Number.isFinite(unitPrice)
                ? unitPrice
                : null,
            photo_url: photoUrl,
          },
        };
      })
    );

    renderCheckout();
    await loadCartCount();

  } catch (error) {
    console.error('Checkout summary loading failed:', error);

    el.checkoutLoading.hidden = true;
    el.checkoutLayout.hidden = true;
    el.checkoutEmpty.hidden = true;

    showError(
      error?.message || 'Unable to prepare your order summary.'
    );
  }
}

/** Validate checkout items and submit the selected order through the sale RPC. */
async function placeOrder() {
  if (state.isCheckingOut) return;

  if (!state.cartItems.length) {
    showToast('Your shopping cart is empty.', 'error');
    return;
  }

  const invalidItems = state.cartItems.filter(
    (item) => !isItemValid(item)
  );

  if (invalidItems.length) {
    showToast(
      'Please resolve unavailable items or insufficient stock first.',
      'error'
    );
    return;
  }

  const confirmed = window.confirm(
    'Are you sure you want to place your orders? Products from different farms will be placed as separate orders. Your available quantities will be checked again and reserved.'
  );

  if (!confirmed) return;

  state.isCheckingOut = true;

  const originalText = el.placeOrderBtn.textContent;

  el.placeOrderBtn.disabled = true;
  el.placeOrderBtn.textContent = 'Submitting Orders...';

  hideError();

  try {
    const { data, error } = await supabase.rpc(CHECKOUT_RPC);

    if (error) throw error;

    if (!data || data.success !== true) {
      throw new Error(
        data?.message || 'The system could not complete your orders.'
      );
    }

    const orders = Array.isArray(data.orders)
      ? data.orders
      : [];

    if (!orders.length || orders.some((order) => !order.sale_id)) {
      throw new Error(
        'The checkout response did not include valid order references. Please check My Orders before trying again.'
      );
    }

    console.log('Farm-specific orders created:', orders);

    showToast(
      `${orders.length} separate ${orders.length === 1 ? 'order' : 'orders'} successfully placed!`,
      'success'
    );

    window.location.href = 'buyer-orders.html';

  } catch (error) {
    console.error('Place Order failed:', {
      message: error?.message,
      details: error?.details,
      hint: error?.hint,
      code: error?.code,
    });

    showError(
      error?.message ||
      'Unable to place your orders. Please review your cart and try again.'
    );

    showToast(
      error?.message || 'Unable to place your orders.',
      'error'
    );

    state.isCheckingOut = false;
    el.placeOrderBtn.disabled = false;
    el.placeOrderBtn.textContent = originalText;

    await loadCheckoutItems();
  }
}

async function logout() {
  const { error } = await supabase.auth.signOut();

  if (error) {
    showToast(error.message || 'Unable to log out.', 'error');
    return;
  }

  window.location.href = '../../index.html';
}

function bindEvents() {
  el.logoutBtn?.addEventListener('click', logout);
  el.placeOrderBtn?.addEventListener('click', placeOrder);
}

/** Authenticate the buyer and initialize the checkout summary and controls. */
async function init() {
  setToday();
  bindEvents();

  try {
    const user = await loadBuyerHeader();

    if (!user) return;

    await Promise.all([
      loadCheckoutItems(),
      loadCartCount(),
    ]);

  } catch (error) {
    console.error('Place Order initialization failed:', error);

    el.checkoutLoading.hidden = true;

    showError(
      error?.message || 'Unable to initialize the Place Order page.'
    );
  }
}

init();