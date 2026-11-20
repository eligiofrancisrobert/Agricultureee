
import { supabase } from '../connection.js';

import {
  buyerReady,
  hasPermission,
  requirePermission,
} from './main.js';

const TABLE_CART = 'buyer_cart_items';
const TABLE_INVENTORY = 'warehouse_produce_inventory';
const TABLE_PRICES = 'farm_produce_prices';

const STORAGE_BUCKET = 'warehouse-inventory-photos';
const SIGNED_URL_EXPIRY = 3600;

// sessionStorage keys
const DESELECTED_KEY = 'tanikala_cart_deselected';
const CHECKOUT_KEY = 'tanikala_checkout_items';

const state = {
  buyerId: null,
  cartItems: [],
  deselectedIds: loadDeselectedIds(),
};

const el = {
  todayLabel: document.getElementById('todayLabel'),
  userName: document.getElementById('userName'),
  userInitial: document.getElementById('userInitial'),

  cartCount: document.getElementById('cartCount'),
  cartLoading: document.getElementById('cartLoading'),
  cartLayout: document.getElementById('cartLayout'),
  cartItemsList: document.getElementById('cartItemsList'),
  cartEmpty: document.getElementById('cartEmpty'),
  cartError: document.getElementById('cartError'),

  cartItemCount: document.getElementById('cartItemCount'),
  summaryItemCount: document.getElementById('summaryItemCount'),
  cartSubtotal: document.getElementById('cartSubtotal'),
  cartTotal: document.getElementById('cartTotal'),

  proceedCheckoutBtn: document.getElementById('proceedCheckoutBtn'),
  toastStack: document.getElementById('toastStack'),
};

const peso = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 2,
});

let pageInitialized = false;

/* ============================================================
   PERMISSIONS
   ============================================================ */

function canViewCart() {
  return hasPermission('cart.view');
}

function canEditCart() {
  return hasPermission('cart.edit');
}

function canDeleteCart() {
  return hasPermission('cart.delete');
}

function canCreateOrders() {
  return hasPermission('orders.create');
}

function denyCartPage() {
  state.cartItems = [];

  const main = document.querySelector('main');

  if (main) {
    main.hidden = true;
  }

  if (el.cartLoading) el.cartLoading.hidden = true;
  if (el.cartLayout) el.cartLayout.hidden = true;
  if (el.cartEmpty) el.cartEmpty.hidden = true;

  const existing = document.getElementById('buyerPermissionDenied');

  if (existing) return;

  const message = document.createElement('section');

  message.id = 'buyerPermissionDenied';
  message.style.cssText = `
    max-width: 600px;
    margin: 80px auto;
    padding: 40px 24px;
    text-align: center;
  `;

  message.innerHTML = `
    <h2>Access Denied</h2>
    <p>You do not have permission to view your shopping cart.</p>
    <a href="dashboard.html">Return to Dashboard</a>
  `;

  document.body.appendChild(message);
}

/* ============================================================
   GENERAL HELPERS
   ============================================================ */

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
  if (!el.cartError) return;

  el.cartError.textContent = message;
  el.cartError.hidden = false;
}

function hideError() {
  if (!el.cartError) return;

  el.cartError.hidden = true;
  el.cartError.textContent = '';
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

/* ============================================================
   SELECTION
   ============================================================ */

function loadDeselectedIds() {
  try {
    const raw = sessionStorage.getItem(DESELECTED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];

    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveDeselectedIds() {
  try {
    sessionStorage.setItem(
      DESELECTED_KEY,
      JSON.stringify([...state.deselectedIds])
    );
  } catch {
    // Ignore unavailable session storage.
  }
}

function hasValidPrice(product) {
  return (
    product.unit_price !== null &&
    product.unit_price !== undefined &&
    Number.isFinite(Number(product.unit_price))
  );
}

function isUnavailable(item) {
  const product = item.product;

  return (
    product.produce_status !== 'available' ||
    Number(product.available_quantity) <= 0 ||
    !hasValidPrice(product)
  );
}

function hasStockIssue(item) {
  return Number(item.quantity) > Number(item.product.available_quantity);
}

function isSelected(item) {
  return !isUnavailable(item) && !state.deselectedIds.has(item.cart_item_id);
}

function getSelectedItems() {
  return state.cartItems.filter(isSelected);
}

function pruneDeselectedIds() {
  const currentIds = new Set(
    state.cartItems.map((item) => item.cart_item_id)
  );

  for (const id of [...state.deselectedIds]) {
    if (!currentIds.has(id)) {
      state.deselectedIds.delete(id);
    }
  }

  saveDeselectedIds();
}

/* ============================================================
   CART COUNT
   ============================================================ */

async function loadCartCount() {
  if (!state.buyerId || !canViewCart()) return;

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

  if (el.cartCount) {
    el.cartCount.textContent = total > 99 ? '99+' : String(total);
    el.cartCount.hidden = total === 0;
  }
}

/* ============================================================
   PHOTO
   ============================================================ */

async function resolvePhotoUrl(path) {
  if (!path || !canViewCart()) return '';

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
    <div class="cart-item-placeholder">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 22V12"></path>
        <path d="M12 12C5 12 3 8 3 4c6 0 9 3 9 8"></path>
        <path d="M12 15c0-5 3-8 9-8 0 5-3 8-9 8"></path>
      </svg>
    </div>
  `;
}

/* ============================================================
   CART ITEM MARKUP
   ============================================================ */

function createSelectAllMarkup() {
  return `
    <div class="cart-select-bar">
      <label class="cart-select-all">
        <input
          type="checkbox"
          class="cart-item-checkbox"
          data-select-all
        >
        <span>Select all items</span>
      </label>

      <span class="cart-select-count" data-select-count></span>
    </div>
  `;
}

function createCartItemMarkup(item) {
  const product = item.product;

  const name = escapeHTML(product.crop_name || 'Unnamed produce');
  const unit = escapeHTML(product.unit || 'unit');

  const isDecimalUnit = normalize(product.unit) === 'kg';
  const step = isDecimalUnit ? '0.01' : '1';
  const min = isDecimalUnit ? '0.01' : '1';

  const quantity = Number(item.quantity);
  const available = Number(product.available_quantity);
  const price = Number(product.unit_price);

  const priceIsValid = hasValidPrice(product);
  const lineTotal = quantity * price;

  const imageMarkup = product.photo_url
    ? `
      <img
        class="cart-item-image"
        src="${escapeHTML(product.photo_url)}"
        alt="${name}"
        loading="lazy"
      >
    `
    : createPlaceholder();

  const unavailable = isUnavailable(item);
  const stockIssue = !unavailable && hasStockIssue(item);
  const selected = isSelected(item);

  // Quantity input and Update button require cart.edit.
  const editMarkup = canEditCart()
    ? `
      <label for="quantity-${escapeHTML(item.cart_item_id)}">
        Quantity (${unit})
      </label>

      <input
        id="quantity-${escapeHTML(item.cart_item_id)}"
        class="cart-quantity-input"
        type="number"
        min="${min}"
        max="${available}"
        step="${step}"
        value="${quantity}"
        data-quantity-input
        ${unavailable ? 'disabled' : ''}
      >

      <button
        type="button"
        class="cart-action-button cart-save-button"
        data-action="update"
        ${unavailable ? 'disabled' : ''}
      >
        Update quantity
      </button>
    `
    : `
      <div class="cart-readonly-quantity">
        <span>Quantity</span>
        <strong>${quantity.toLocaleString('en-PH')} ${unit}</strong>
      </div>
    `;

  // Remove button requires cart.delete.
  const removeMarkup = canDeleteCart()
    ? `
      <button
        type="button"
        class="cart-action-button cart-remove-button"
        data-action="remove"
      >
        Remove
      </button>
    `
    : '';

  return `
    <article
      class="cart-item ${selected ? 'is-selected' : 'is-unselected'}"
      data-cart-item-id="${escapeHTML(item.cart_item_id)}"
    >

      <div class="cart-item-image-wrap">
        <label
          class="cart-item-select"
          title="${unavailable ? 'Unavailable items cannot be selected' : 'Include in checkout'}"
        >
          <input
            type="checkbox"
            class="cart-item-checkbox"
            data-select-item
            aria-label="Select ${name} for checkout"
            ${selected ? 'checked' : ''}
            ${unavailable ? 'disabled' : ''}
          >
        </label>

        ${imageMarkup}
      </div>

      <div class="cart-item-content">

        <div class="cart-item-top">
          <div>
            <h3 class="cart-item-name">${name}</h3>
            <span class="cart-item-unit">Selling unit: ${unit}</span>
          </div>

          <div class="cart-item-price">
            ${priceIsValid ? peso.format(price) : 'Price unavailable'}
            <small>per ${unit}</small>
          </div>
        </div>

        <div class="cart-item-bottom">

          <div class="cart-quantity-control">
            ${editMarkup}

            <div class="cart-item-actions">
              ${removeMarkup}
            </div>
          </div>

          <div class="cart-item-subtotal">
            <span>Item subtotal</span>
            <strong>${priceIsValid ? peso.format(lineTotal) : '—'}</strong>
          </div>

        </div>

        ${unavailable ? `
          <div class="cart-error">
            This produce is currently unavailable or has no valid price, so it cannot be selected for checkout.
            ${canDeleteCart() ? 'You can remove it from your cart.' : ''}
          </div>
        ` : ''}

        ${stockIssue ? `
          <div class="cart-error">
            Only ${escapeHTML(available)} ${unit} currently available. Update the quantity before checkout.
          </div>
        ` : ''}

      </div>
    </article>
  `;
}

/* ============================================================
   SELECTION UI
   ============================================================ */

function syncSelectionUI() {
  const selectableItems = state.cartItems.filter(
    (item) => !isUnavailable(item)
  );

  const selectedCount = selectableItems.filter(isSelected).length;

  el.cartItemsList
    .querySelectorAll('.cart-item')
    .forEach((card) => {
      const item = state.cartItems.find(
        (entry) => entry.cart_item_id === card.dataset.cartItemId
      );

      if (!item) return;

      const selected = isSelected(item);
      const checkbox = card.querySelector('[data-select-item]');

      if (checkbox) checkbox.checked = selected;

      card.classList.toggle('is-selected', selected);
      card.classList.toggle('is-unselected', !selected);
    });

  const selectAll = el.cartItemsList.querySelector('[data-select-all]');

  if (selectAll) {
    selectAll.disabled = selectableItems.length === 0;

    selectAll.checked =
      selectableItems.length > 0 &&
      selectedCount === selectableItems.length;

    selectAll.indeterminate =
      selectedCount > 0 &&
      selectedCount < selectableItems.length;
  }

  const countLabel = el.cartItemsList.querySelector('[data-select-count]');

  if (countLabel) {
    countLabel.textContent =
      `${selectedCount} of ${state.cartItems.length} selected`;
  }
}

function updateSummary() {
  const items = state.cartItems;
  const selectedItems = getSelectedItems();

  const totalQuantity = selectedItems.reduce(
    (sum, item) => sum + Number(item.quantity),
    0
  );

  const subtotal = selectedItems.reduce(
    (sum, item) =>
      sum + Number(item.product.unit_price) * Number(item.quantity),
    0
  );

  if (el.cartItemCount) {
    el.cartItemCount.textContent =
      `${items.length} ${items.length === 1 ? 'item' : 'items'} in your cart · ${selectedItems.length} selected`;
  }

  if (el.summaryItemCount) {
    el.summaryItemCount.textContent = selectedItems.length
      ? `${selectedItems.length} (${totalQuantity.toLocaleString('en-PH')} total quantity)`
      : '0';
  }

  if (el.cartSubtotal) {
    el.cartSubtotal.textContent = peso.format(subtotal);
  }

  if (el.cartTotal) {
    el.cartTotal.textContent = peso.format(subtotal);
  }

  const hasCheckoutIssue = selectedItems.some(
    (item) => isUnavailable(item) || hasStockIssue(item)
  );

  if (el.proceedCheckoutBtn) {
    el.proceedCheckoutBtn.disabled =
      !canCreateOrders() ||
      selectedItems.length === 0 ||
      hasCheckoutIssue;

    el.proceedCheckoutBtn.hidden = !canCreateOrders();
  }

  syncSelectionUI();
}

/* ============================================================
   RENDER CART
   ============================================================ */

function renderCart() {
  if (!canViewCart()) {
    denyCartPage();
    return;
  }

  const items = state.cartItems;

  if (el.cartLoading) {
    el.cartLoading.hidden = true;
  }

  if (!items.length) {
    if (el.cartLayout) el.cartLayout.hidden = true;
    if (el.cartEmpty) el.cartEmpty.hidden = false;

    if (el.cartItemCount) {
      el.cartItemCount.textContent = '0 items in your cart';
    }

    if (el.summaryItemCount) {
      el.summaryItemCount.textContent = '0';
    }

    if (el.cartSubtotal) {
      el.cartSubtotal.textContent = peso.format(0);
    }

    if (el.cartTotal) {
      el.cartTotal.textContent = peso.format(0);
    }

    if (el.proceedCheckoutBtn) {
      el.proceedCheckoutBtn.disabled = true;
    }

    return;
  }

  if (el.cartEmpty) el.cartEmpty.hidden = true;
  if (el.cartLayout) el.cartLayout.hidden = false;

  if (el.cartItemsList) {
    el.cartItemsList.innerHTML =
      createSelectAllMarkup() +
      items.map(createCartItemMarkup).join('');
  }

  updateSummary();
}

/* ============================================================
   LOAD CART
   ============================================================ */

async function loadCart() {
  if (!requirePermission('cart.view')) {
    denyCartPage();
    return;
  }

  if (el.cartLoading) el.cartLoading.hidden = false;
  if (el.cartLayout) el.cartLayout.hidden = true;
  if (el.cartEmpty) el.cartEmpty.hidden = true;

  hideError();

  try {
    const { data: cartRows, error: cartError } = await supabase
      .from(TABLE_CART)
      .select('cart_item_id, buyer_id, produce_id, quantity, created_at')
      .eq('buyer_id', state.buyerId)
      .order('created_at', { ascending: false });

    if (cartError) throw cartError;

    if (!canViewCart()) {
      denyCartPage();
      return;
    }

    if (!cartRows?.length) {
      state.cartItems = [];
      pruneDeselectedIds();
      renderCart();
      await loadCartCount();
      return;
    }

    const produceIds = [
      ...new Set(cartRows.map((row) => row.produce_id))
    ];

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

    if (!canViewCart()) {
      denyCartPage();
      return;
    }

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

    if (!canViewCart()) {
      state.cartItems = [];
      denyCartPage();
      return;
    }

    pruneDeselectedIds();
    renderCart();

    await loadCartCount();

  } catch (error) {
    console.error('Cart loading failed:', error);

    if (el.cartLoading) el.cartLoading.hidden = true;
    if (el.cartLayout) el.cartLayout.hidden = true;
    if (el.cartEmpty) el.cartEmpty.hidden = true;

    showError(
      error?.message || 'Unable to load your shopping cart.'
    );
  }
}

/* ============================================================
   UPDATE CART ITEM
   ============================================================ */

async function updateCartItem(button) {
  if (!requirePermission('cart.edit')) return;

  if (!canViewCart()) {
    denyCartPage();
    return;
  }

  const card = button.closest('.cart-item');
  const cartItemId = card?.dataset.cartItemId;
  const input = card?.querySelector('[data-quantity-input]');

  const item = state.cartItems.find(
    (entry) => entry.cart_item_id === cartItemId
  );

  if (!item) return;

  const newQuantity = Number(input?.value);
  const product = item.product;

  const isDecimalUnit = normalize(product.unit) === 'kg';

  if (!Number.isFinite(newQuantity) || newQuantity <= 0) {
    showToast('Please enter a valid quantity.', 'error');
    input?.focus();
    return;
  }

  if (!isDecimalUnit && !Number.isInteger(newQuantity)) {
    showToast(`${product.unit} must be a whole number.`, 'error');
    input?.focus();
    return;
  }

  if (newQuantity > Number(product.available_quantity)) {
    showToast(
      `Only ${product.available_quantity} ${product.unit} currently available.`,
      'error'
    );

    input?.focus();
    return;
  }

  const originalText = button.textContent;

  button.disabled = true;
  button.textContent = 'Updating...';

  try {
    if (!requirePermission('cart.edit')) return;

    const { error } = await supabase
      .from(TABLE_CART)
      .update({
        quantity: newQuantity,
        updated_at: new Date().toISOString(),
      })
      .eq('cart_item_id', cartItemId)
      .eq('buyer_id', state.buyerId);

    if (error) throw error;

    showToast('Cart quantity updated.', 'success');
    await loadCart();

  } catch (error) {
    console.error('Cart quantity update failed:', error);

    showToast(
      error?.message || 'Unable to update cart quantity.',
      'error'
    );

  } finally {
    if (button.isConnected) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

/* ============================================================
   REMOVE CART ITEM
   ============================================================ */

async function removeCartItem(button) {
  if (!requirePermission('cart.delete')) return;

  if (!canViewCart()) {
    denyCartPage();
    return;
  }

  const card = button.closest('.cart-item');
  const cartItemId = card?.dataset.cartItemId;

  if (!cartItemId) return;

  const confirmed = window.confirm(
    'Are you sure you want to remove this item from your cart?'
  );

  if (!confirmed) return;

  button.disabled = true;
  button.textContent = 'Removing...';

  try {
    if (!requirePermission('cart.delete')) return;

    const { error } = await supabase
      .from(TABLE_CART)
      .delete()
      .eq('cart_item_id', cartItemId)
      .eq('buyer_id', state.buyerId);

    if (error) throw error;

    state.deselectedIds.delete(cartItemId);
    saveDeselectedIds();

    showToast('Item removed from your cart.', 'success');

    await loadCart();

  } catch (error) {
    console.error('Cart item removal failed:', error);

    showToast(
      error?.message || 'Unable to remove this item.',
      'error'
    );

    button.disabled = false;
    button.textContent = 'Remove';
  }
}

/* ============================================================
   CHECKBOX HANDLERS
   ============================================================ */

function handleSelectionChange(input) {
  if (!canViewCart()) return;

  if (input.matches('[data-select-all]')) {
    for (const item of state.cartItems) {
      if (isUnavailable(item)) continue;

      if (input.checked) {
        state.deselectedIds.delete(item.cart_item_id);
      } else {
        state.deselectedIds.add(item.cart_item_id);
      }
    }
  } else {
    const card = input.closest('.cart-item');
    const cartItemId = card?.dataset.cartItemId;

    if (!cartItemId) return;

    if (input.checked) {
      state.deselectedIds.delete(cartItemId);
    } else {
      state.deselectedIds.add(cartItemId);
    }
  }

  saveDeselectedIds();
  updateSummary();
}

/* ============================================================
   CHECKOUT
   ============================================================ */

function proceedToCheckout() {
  if (!requirePermission('orders.create')) return;

  if (!canViewCart()) {
    denyCartPage();
    return;
  }

  if (!state.cartItems.length) {
    showToast('Your cart is empty.', 'error');
    return;
  }

  const selectedItems = getSelectedItems();

  if (!selectedItems.length) {
    showToast('Select at least one item to checkout.', 'error');
    return;
  }

  const invalidItem = selectedItems.some(
    (item) => isUnavailable(item) || hasStockIssue(item)
  );

  if (invalidItem) {
    showToast(
      'Please review unavailable items or insufficient stock before checkout.',
      'error'
    );
    return;
  }

  try {
    sessionStorage.setItem(
      CHECKOUT_KEY,
      JSON.stringify(
        selectedItems.map((item) => item.cart_item_id)
      )
    );
  } catch (error) {
    console.error('Unable to save checkout selection:', error);

    showToast(
      'Unable to continue to checkout. Please try again.',
      'error'
    );

    return;
  }

  window.location.href = 'place-order.html';
}

/* ============================================================
   EVENTS
   ============================================================ */

function bindEvents() {
  // Logout is already handled by buyers/main.js.

  if (el.proceedCheckoutBtn) {
    el.proceedCheckoutBtn.addEventListener(
      'click',
      proceedToCheckout
    );
  }

  el.cartItemsList?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');

    if (!button || button.disabled) return;

    if (button.dataset.action === 'update') {
      if (!requirePermission('cart.edit')) return;
      updateCartItem(button);
    }

    if (button.dataset.action === 'remove') {
      if (!requirePermission('cart.delete')) return;
      removeCartItem(button);
    }
  });

  el.cartItemsList?.addEventListener('change', (event) => {
    const input = event.target.closest(
      '[data-select-item], [data-select-all]'
    );

    if (!input) return;

    handleSelectionChange(input);
  });
}

/* ============================================================
   INITIALIZATION
   ============================================================ */

async function init() {
  if (pageInitialized) return;

  pageInitialized = true;

  try {
    // Wait for authentication and permissions.
    const auth = await buyerReady;

    if (!auth) return;

    // Page-level permission.
    if (!hasPermission('cart.view')) {
      denyCartPage();
      return;
    }

    state.buyerId = auth.user.id;

    setToday();
    bindEvents();

    // Hide checkout if orders.create is disabled.
    if (el.proceedCheckoutBtn) {
      el.proceedCheckoutBtn.hidden = !canCreateOrders();
    }

    await Promise.all([
      loadCart(),
      loadCartCount(),
    ]);

  } catch (error) {
    console.error('Shopping cart initialization failed:', error);

    showError(
      error?.message || 'Unable to initialize your shopping cart.'
    );
  }
}

init();
