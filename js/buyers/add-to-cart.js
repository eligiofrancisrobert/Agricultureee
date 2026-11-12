import { supabase } from '../connection.js';

const TABLE_CART = 'buyer_cart_items';
const TABLE_INVENTORY = 'warehouse_produce_inventory';
const TABLE_PRICES = 'farm_produce_prices';

const STORAGE_BUCKET = 'warehouse-inventory-photos';
const SIGNED_URL_EXPIRY = 3600;

// sessionStorage keys
const DESELECTED_KEY = 'tanikala_cart_deselected';   // unchecked items (kept while on the cart page)
const CHECKOUT_KEY = 'tanikala_checkout_items';      // cart_item_ids passed to place-order

const state = {
  buyerId: null,
  cartItems: [],
  // Items are selected by default. Only unchecked ones are tracked,
  // so newly added items are automatically selected.
  deselectedIds: loadDeselectedIds(),
};

const el = {
  todayLabel: document.getElementById('todayLabel'),
  userName: document.getElementById('userName'),
  userInitial: document.getElementById('userInitial'),
  logoutBtn: document.getElementById('logoutBtn'),

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

/* ============ SELECTION (checkboxes) ============ */

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
    /* storage unavailable: selection just won't persist */
  }
}

function hasValidPrice(product) {
  return (
    product.unit_price !== null &&
    product.unit_price !== undefined &&
    Number.isFinite(Number(product.unit_price))
  );
}

// Unavailable items can never be selected for checkout.
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
  // Drop ids that are no longer in the cart.
  const currentIds = new Set(state.cartItems.map((item) => item.cart_item_id));

  for (const id of [...state.deselectedIds]) {
    if (!currentIds.has(id)) state.deselectedIds.delete(id);
  }

  saveDeselectedIds();
}

/* ============ UI HELPERS ============ */

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
  el.cartError.textContent = message;
  el.cartError.hidden = false;
}

function hideError() {
  el.cartError.hidden = true;
  el.cartError.textContent = '';
}

async function loadBuyerHeader() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) throw error;

  if (!user) {
    window.location.replace('../../login.html');
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
    .select('cart_item_id', { count: 'exact', head: true })
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
    <div class="cart-item-placeholder">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 22V12"></path>
        <path d="M12 12C5 12 3 8 3 4c6 0 9 3 9 8"></path>
        <path d="M12 15c0-5 3-8 9-8 0 5-3 8-9 8"></path>
      </svg>
    </div>
  `;
}

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

            <div class="cart-item-actions">
              <button
                type="button"
                class="cart-action-button cart-save-button"
                data-action="update"
                ${unavailable ? 'disabled' : ''}
              >
                Update quantity
              </button>

              <button
                type="button"
                class="cart-action-button cart-remove-button"
                data-action="remove"
              >
                Remove
              </button>
            </div>
          </div>

          <div class="cart-item-subtotal">
            <span>Item subtotal</span>
            <strong>${priceIsValid ? peso.format(lineTotal) : '—'}</strong>
          </div>

        </div>

        ${unavailable ? `
          <div class="cart-error">
            This produce is currently unavailable or has no valid price, so it cannot be selected for checkout. You can remove it from your cart.
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

/* ============ SUMMARY + SELECTION SYNC ============ */

function syncSelectionUI() {
  const selectableItems = state.cartItems.filter(
    (item) => !isUnavailable(item)
  );

  const selectedCount = selectableItems.filter(isSelected).length;

  // Per-item checkbox + card state
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

  // Select all checkbox
  const selectAll = el.cartItemsList.querySelector('[data-select-all]');

  if (selectAll) {
    selectAll.disabled = selectableItems.length === 0;
    selectAll.checked =
      selectableItems.length > 0 && selectedCount === selectableItems.length;
    selectAll.indeterminate =
      selectedCount > 0 && selectedCount < selectableItems.length;
  }

  const countLabel = el.cartItemsList.querySelector('[data-select-count]');

  if (countLabel) {
    countLabel.textContent = `${selectedCount} of ${state.cartItems.length} selected`;
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
    (sum, item) => sum + Number(item.product.unit_price) * Number(item.quantity),
    0
  );

  el.cartItemCount.textContent =
    `${items.length} ${items.length === 1 ? 'item' : 'items'} in your cart · ${selectedItems.length} selected`;

  el.summaryItemCount.textContent = selectedItems.length
    ? `${selectedItems.length} (${totalQuantity.toLocaleString('en-PH')} total quantity)`
    : '0';

  el.cartSubtotal.textContent = peso.format(subtotal);
  el.cartTotal.textContent = peso.format(subtotal);

  // Only the selected items can block checkout.
  const hasCheckoutIssue = selectedItems.some(
    (item) => isUnavailable(item) || hasStockIssue(item)
  );

  el.proceedCheckoutBtn.disabled =
    selectedItems.length === 0 || hasCheckoutIssue;

  syncSelectionUI();
}

function renderCart() {
  const items = state.cartItems;

  el.cartLoading.hidden = true;

  if (!items.length) {
    el.cartLayout.hidden = true;
    el.cartEmpty.hidden = false;
    el.cartItemCount.textContent = '0 items in your cart';
    el.summaryItemCount.textContent = '0';
    el.cartSubtotal.textContent = peso.format(0);
    el.cartTotal.textContent = peso.format(0);
    el.proceedCheckoutBtn.disabled = true;
    return;
  }

  el.cartEmpty.hidden = true;
  el.cartLayout.hidden = false;

  el.cartItemsList.innerHTML =
    createSelectAllMarkup() +
    items.map(createCartItemMarkup).join('');

  updateSummary();
}

/** Fetch the buyer's cart with current inventory and price data for display. */
async function loadCart() {
  el.cartLoading.hidden = false;
  el.cartLayout.hidden = true;
  el.cartEmpty.hidden = true;
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
      pruneDeselectedIds();
      renderCart();
      await loadCartCount();
      return;
    }

    const produceIds = [...new Set(cartRows.map((row) => row.produce_id))];

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

    pruneDeselectedIds();
    renderCart();
    await loadCartCount();

  } catch (error) {
    console.error('Cart loading failed:', error);

    el.cartLoading.hidden = true;
    el.cartLayout.hidden = true;
    el.cartEmpty.hidden = true;

    showError(
      error?.message || 'Unable to load your shopping cart.'
    );
  }
}

/** Validate and persist a cart quantity against current inventory and unit rules. */
async function updateCartItem(button) {
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

    button.disabled = false;
    button.textContent = originalText;
  }
}

/** Delete the selected cart row and refresh the cart count and summary. */
async function removeCartItem(button) {
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

/* ============ CHECKBOX HANDLERS ============ */

/** Persist a checkbox selection change and update totals without rerendering. */
function handleSelectionChange(input) {
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

  // No full re-render, so typed quantities are not lost.
  updateSummary();
}

/** Pass selected cart item IDs to the checkout page through session storage. */
function proceedToCheckout() {
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

  // Only the checked items are passed to place-order.
  try {
    sessionStorage.setItem(
      CHECKOUT_KEY,
      JSON.stringify(selectedItems.map((item) => item.cart_item_id))
    );
  } catch (error) {
    console.error('Unable to save checkout selection:', error);
    showToast('Unable to continue to checkout. Please try again.', 'error');
    return;
  }

  window.location.href = 'place-order.html';
}

async function logout() {
  const { error } = await supabase.auth.signOut();

  if (error) {
    showToast(error.message || 'Unable to log out.', 'error');
    return;
  }

  window.location.replace('../../login.html');
}

function bindEvents() {
  el.logoutBtn?.addEventListener('click', logout);

  el.proceedCheckoutBtn?.addEventListener(
    'click',
    proceedToCheckout
  );

  el.cartItemsList?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');

    if (!button || button.disabled) return;

    if (button.dataset.action === 'update') {
      updateCartItem(button);
    }

    if (button.dataset.action === 'remove') {
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

/** Authenticate the buyer and initialize cart loading and event handlers. */
async function init() {
  setToday();
  bindEvents();

  try {
    const user = await loadBuyerHeader();

    if (!user) return;

    await Promise.all([
      loadCart(),
      loadCartCount(),
    ]);

  } catch (error) {
    console.error('Shopping cart initialization failed:', error);
    showError(error?.message || 'Unable to initialize your shopping cart.');
  }
}

init();