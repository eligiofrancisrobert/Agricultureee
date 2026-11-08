import { supabase } from '../connection.js';

const TABLE_INVENTORY = 'warehouse_produce_inventory';
const TABLE_PRICES = 'farm_produce_prices';
const TABLE_CART = 'buyer_cart_items';

const STORAGE_BUCKET = 'warehouse-inventory-photos';
const SIGNED_URL_EXPIRY = 3600;

const state = {
  products: [],
  filteredProducts: [],
  buyerId: null,
};

const el = {
  todayLabel: document.getElementById('todayLabel'),
  userName: document.getElementById('userName'),
  userInitial: document.getElementById('userInitial'),
  logoutBtn: document.getElementById('logoutBtn'),

  search: document.getElementById('produceSearch'),
  sort: document.getElementById('sortProduce'),

  resultCount: document.getElementById('resultCount'),
  loading: document.getElementById('loadingState'),
  grid: document.getElementById('produceGrid'),

  empty: document.getElementById('produceEmpty'),
  emptyTitle: document.getElementById('emptyTitle'),
  emptyMessage: document.getElementById('emptyMessage'),

  error: document.getElementById('produceError'),
  toastStack: document.getElementById('toastStack'),
  cartCount: document.getElementById('cartCount'),
};

const peso = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 2,
});

function setToday() {
  if (!el.todayLabel) return;

  el.todayLabel.textContent = new Intl.DateTimeFormat('en-PH', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date());
}

function showError(message) {
  if (!el.error) return;

  el.error.textContent = message;
  el.error.hidden = false;
}

function hideError() {
  if (!el.error) return;

  el.error.hidden = true;
  el.error.textContent = '';
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

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}

function priceKey(item) {
  return [
    item.farm_id ?? '',
    normalize(item.crop_name),
    normalize(item.unit),
  ].join('::');
}

function setLoading(isLoading) {
  el.loading.hidden = !isLoading;

  if (isLoading) {
    el.grid.hidden = true;
    el.empty.hidden = true;
  }
}

async function resolvePhotoUrl(path) {
  if (!path) return '';

  const cleanPath = String(path).replace(/^\/+/, '');

  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(cleanPath, SIGNED_URL_EXPIRY);

  if (error) {
    console.warn(`Unable to load image: ${cleanPath}`, error.message);
    return '';
  }

  return data?.signedUrl || '';
}

async function loadBuyerHeader() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }

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

  if (el.userName) {
    el.userName.textContent = displayName;
  }

  if (el.userInitial) {
    el.userInitial.textContent =
      displayName.trim().charAt(0).toUpperCase() || 'B';
  }

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

async function loadProducts() {
  setLoading(true);
  hideError();

  try {
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
          produce_status,
          created_at
        `)
        .eq('produce_status', 'available')
        .gt('available_quantity', 0)
        .order('created_at', { ascending: false }),

      supabase
        .from(TABLE_PRICES)
        .select('farm_id, crop_name, unit, unit_price'),
    ]);

    if (inventoryResult.error) throw inventoryResult.error;
    if (pricesResult.error) throw pricesResult.error;

    const priceMap = new Map();

    for (const price of pricesResult.data || []) {
      priceMap.set(priceKey(price), Number(price.unit_price));
    }

    const inventory = inventoryResult.data || [];

    state.products = await Promise.all(
      inventory.map(async (item) => {
        const unitPrice = priceMap.get(priceKey(item));
        const photoUrl = await resolvePhotoUrl(item.photo_path);

        return {
          ...item,
          unit_price:
            unitPrice !== undefined && Number.isFinite(unitPrice)
              ? unitPrice
              : null,
          photo_url: photoUrl,
        };
      })
    );

    applyFilters();

  } catch (error) {
    console.error('Browse Produce load failed:', error);

    showError(
      error?.message ||
      'Unable to load available produce. Please refresh the page and try again.'
    );

    el.resultCount.textContent = 'Could not load products';
    el.grid.hidden = true;
    el.empty.hidden = true;

  } finally {
    setLoading(false);
  }
}

function createImageMarkup(product) {
  const placeholder = `
    <div class="produce-image-placeholder" aria-label="No product photo available">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 22V12"></path>
        <path d="M12 12C5 12 3 8 3 4c6 0 9 3 9 8"></path>
        <path d="M12 15c0-5 3-8 9-8 0 5-3 8-9 8"></path>
      </svg>
    </div>
  `;

  if (!product.photo_url) return placeholder;

  return `
    <img
      class="produce-card-image"
      src="${escapeHTML(product.photo_url)}"
      alt="${escapeHTML(product.crop_name || 'Produce')}"
      loading="lazy"
      onerror="this.outerHTML='<div class=&quot;produce-image-placeholder&quot;><span>Image unavailable</span></div>'"
    >
  `;
}

function createProductCard(product) {
  const name = escapeHTML(product.crop_name || 'Unnamed produce');
  const unit = escapeHTML(product.unit || 'unit');
  const quantity = Number(product.available_quantity || 0);

  const isDecimalUnit = normalize(product.unit) === 'kg';

  const quantityStep = isDecimalUnit ? '0.01' : '1';
  const quantityMin = isDecimalUnit ? '0.01' : '1';

  const maxQuantity = isDecimalUnit
    ? quantity
    : Math.floor(quantity);

  const hasPrice =
    product.unit_price !== null &&
    Number.isFinite(product.unit_price) &&
    product.unit_price >= 0;

  const priceMarkup = !hasPrice
    ? '<span class="price-unavailable">Price unavailable</span>'
    : `
      <span class="produce-card-price">
        ${peso.format(product.unit_price)}
      </span>
      <span class="produce-card-price-unit">/ ${unit}</span>
    `;

  return `
    <article class="produce-card" data-produce-id="${escapeHTML(product.produce_id)}">

      <div class="produce-card-image-wrap">
        ${createImageMarkup(product)}
        <span class="produce-availability">Available</span>
      </div>

      <div class="produce-card-body">

        <div class="produce-card-heading">
          <h3 class="produce-card-name">${name}</h3>
          <span class="produce-card-unit">${unit}</span>
        </div>

        <div class="produce-card-price-row">
          ${priceMarkup}
        </div>

        <div class="produce-card-stock">
          <span>Available stock</span>
          <strong>${quantity.toLocaleString('en-PH')} ${unit}</strong>
        </div>

        <div class="add-cart-controls">
          <label class="quantity-label">
            Quantity
            <input
              type="number"
              class="product-quantity"
              min="${quantityMin}"
              max="${maxQuantity}"
              step="${quantityStep}"
              value="1"
              inputmode="${isDecimalUnit ? 'decimal' : 'numeric'}"
              aria-label="Quantity for ${name}"
              ${maxQuantity < Number(quantityMin) ? 'disabled' : ''}
            >
          </label>

          <button
            type="button"
            class="add-to-cart-btn"
            data-produce-id="${escapeHTML(product.produce_id)}"
            ${!hasPrice || quantity <= 0 ? 'disabled' : ''}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 3h2l2.2 11.2a2 2 0 0 0 2 1.6h8.9a2 2 0 0 0 2-1.6L22 7H6" />
              <path d="M10 20h.01M18 20h.01" />
              <path d="M12 8v6M9 11h6" />
            </svg>
            Add to Cart
          </button>
        </div>

      </div>
    </article>
  `;
}

function renderProducts(products) {
  el.grid.innerHTML = '';

  if (!products.length) {
    el.grid.hidden = true;
    el.empty.hidden = false;

    el.emptyTitle.textContent = state.products.length
      ? 'No matching produce'
      : 'No produce available';

    el.emptyMessage.textContent = state.products.length
      ? 'Try another search term.'
      : 'There are currently no available products to display.';

    el.resultCount.textContent = '0 products';
    return;
  }

  el.grid.innerHTML = products.map(createProductCard).join('');
  el.grid.hidden = false;
  el.empty.hidden = true;

  el.resultCount.textContent =
    `${products.length} ${products.length === 1 ? 'product' : 'products'} available`;
}

function applyFilters() {
  const searchTerm = el.search.value.trim().toLowerCase();
  const sortValue = el.sort.value;

  let products = state.products.filter((product) => {
    const searchable =
      `${product.crop_name || ''} ${product.unit || ''}`.toLowerCase();

    return searchable.includes(searchTerm);
  });

  products = [...products];

  switch (sortValue) {
    case 'name-asc':
      products.sort((a, b) =>
        String(a.crop_name).localeCompare(String(b.crop_name))
      );
      break;

    case 'price-asc':
      products.sort((a, b) => {
        if (a.unit_price === null) return 1;
        if (b.unit_price === null) return -1;
        return a.unit_price - b.unit_price;
      });
      break;

    case 'price-desc':
      products.sort((a, b) => {
        if (a.unit_price === null) return 1;
        if (b.unit_price === null) return -1;
        return b.unit_price - a.unit_price;
      });
      break;

    default:
      products.sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at)
      );
  }

  state.filteredProducts = products;
  renderProducts(products);
}

async function addToCart(button) {
  if (!state.buyerId) {
    showToast('Please log in to add items to your cart.', 'error');
    return;
  }

  const produceId = button.dataset.produceId;
  const card = button.closest('.produce-card');
  const quantityInput = card?.querySelector('.product-quantity');

  const requestedQuantity = Number(quantityInput?.value);

  if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
    showToast('Please enter a valid quantity.', 'error');
    quantityInput?.focus();
    return;
  }

  const product = state.products.find(
    (item) => item.produce_id === produceId
  );

  if (!product) {
    showToast('Product information is no longer available. Refresh the page.', 'error');
    return;
  }

  if (product.unit_price === null) {
    showToast('This product currently has no selling price.', 'error');
    return;
  }

  const originalButtonText = button.innerHTML;

  button.disabled = true;
  button.textContent = 'Adding...';

  try {
    // Always validate against the latest inventory quantity.
    const { data: latestProduct, error: stockError } = await supabase
      .from(TABLE_INVENTORY)
      .select('produce_id, available_quantity, produce_status')
      .eq('produce_id', produceId)
      .maybeSingle();

    if (stockError) throw stockError;

    if (
      !latestProduct ||
      latestProduct.produce_status !== 'available' ||
      Number(latestProduct.available_quantity) <= 0
    ) {
      throw new Error('This product is no longer available.');
    }

    const availableStock = Number(latestProduct.available_quantity);

    // Check whether this produce is already in the buyer's cart.
    const { data: existingItem, error: existingError } = await supabase
      .from(TABLE_CART)
      .select('cart_item_id, quantity')
      .eq('buyer_id', state.buyerId)
      .eq('produce_id', produceId)
      .maybeSingle();

    if (existingError) throw existingError;

    const existingQuantity = Number(existingItem?.quantity || 0);
    const newQuantity = existingQuantity + requestedQuantity;

    if (newQuantity > availableStock) {
      throw new Error(
        `Insufficient stock. You already have ${existingQuantity} in your cart. Available stock is ${availableStock}.`
      );
    }

    let saveResult;

    if (existingItem) {
      saveResult = await supabase
        .from(TABLE_CART)
        .update({
          quantity: newQuantity,
          updated_at: new Date().toISOString(),
        })
        .eq('cart_item_id', existingItem.cart_item_id)
        .eq('buyer_id', state.buyerId);
    } else {
      saveResult = await supabase
        .from(TABLE_CART)
        .insert({
          buyer_id: state.buyerId,
          produce_id: produceId,
          quantity: requestedQuantity,
        });
    }

    if (saveResult.error) throw saveResult.error;

    quantityInput.value = '1';

    await loadCartCount();

    showToast(
      `${product.crop_name} added to your cart.`,
      'success'
    );

  } catch (error) {
    console.error('Add to cart failed:', error);

    showToast(
      error?.message || 'Unable to add this product to your cart.',
      'error'
    );

  } finally {
    button.disabled = false;
    button.innerHTML = originalButtonText;
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
  el.search?.addEventListener('input', applyFilters);
  el.sort?.addEventListener('change', applyFilters);
  el.logoutBtn?.addEventListener('click', logout);

  el.grid?.addEventListener('click', (event) => {
    const button = event.target.closest('.add-to-cart-btn');

    if (!button || button.disabled) return;

    addToCart(button);
  });
}

async function init() {
  setToday();
  bindEvents();

  try {
    const user = await loadBuyerHeader();

    if (!user) return;

    await Promise.all([
      loadProducts(),
      loadCartCount(),
    ]);

  } catch (error) {
    console.error('Buyer page initialization failed:', error);
    showError(error?.message || 'Unable to initialize the Buyer page.');
  }
}

init();