
import { supabase } from '../connection.js';

import {
  buyerReady,
  hasPermission,
  requirePermission,
  showToast as buyerToast,
} from './main.js';

const TABLE_INVENTORY = 'warehouse_produce_inventory';
const TABLE_PRICES = 'farm_produce_prices';
const TABLE_CART = 'buyer_cart_items';

const STORAGE_BUCKET = 'warehouse-inventory-photos';
const SIGNED_URL_EXPIRY = 3600;
const PHOTO_CACHE_TTL = 55 * 60 * 1000;
const PHOTO_BATCH_SIZE = 50;

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

let inventoryChannel = null;
let pricesChannel = null;

let realtimeRefreshTimeout = null;
let isRefreshingProducts = false;
let pendingRefresh = false;

let pageInitialized = false;

const photoCache = new Map();

/* ============================================================
   PERMISSION HELPERS
   ============================================================ */

function canViewProduce() {
  return hasPermission('produce.view');
}

function canAddToCart() {
  return hasPermission('cart.create');
}

function denyProducePage() {
  unsubscribeFromBuyerRealtime();

  state.products = [];
  state.filteredProducts = [];

  const main = document.querySelector('main');

  if (main) {
    main.hidden = true;
  }

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
    <p>You do not have permission to view available produce.</p>
    <a href="dashboard.html">Return to Dashboard</a>
  `;

  document.body.appendChild(message);
}

function showToast(message, type = 'success') {
  if (el.toastStack) {
    const toast = document.createElement('div');

    toast.className = `produce-toast ${type}`;
    toast.textContent = message;

    el.toastStack.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));

    window.setTimeout(() => {
      toast.classList.remove('show');
      window.setTimeout(() => toast.remove(), 250);
    }, 3000);

    return;
  }

  buyerToast(message, type === 'error' ? 'error' : 'success');
}

/* ============================================================
   GENERAL HELPERS
   ============================================================ */

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
    String(item.farm_id ?? '').trim(),
    normalize(item.crop_name),
    normalize(item.unit),
  ].join('::');
}

function cleanPhotoPath(path) {
  if (!path) return '';

  return String(path).replace(/^\/+/, '').trim();
}

function getCachedPhotoUrl(path) {
  const cleanPath = cleanPhotoPath(path);

  if (!cleanPath) return '';

  const cached = photoCache.get(cleanPath);

  if (!cached) return '';

  if (Date.now() >= cached.expiresAt) {
    photoCache.delete(cleanPath);
    return '';
  }

  return cached.url || '';
}

function setCachedPhotoUrl(path, url) {
  const cleanPath = cleanPhotoPath(path);

  if (!cleanPath || !url) return;

  photoCache.set(cleanPath, {
    url,
    expiresAt: Date.now() + PHOTO_CACHE_TTL,
  });
}

function setLoading(isLoading) {
  if (!el.loading) return;

  el.loading.hidden = !isLoading;

  if (isLoading) {
    if (el.grid) el.grid.hidden = true;
    if (el.empty) el.empty.hidden = true;
  }
}

/* ============================================================
   PRODUCT PHOTOS
   ============================================================ */

async function loadProductPhotos(products) {
  if (!canViewProduce()) return;

  const photoProducts = new Map();

  for (const product of products) {
    const path = cleanPhotoPath(product.photo_path);

    if (!path) continue;

    if (!getCachedPhotoUrl(path)) {
      if (!photoProducts.has(path)) {
        photoProducts.set(path, []);
      }

      photoProducts.get(path).push(product.produce_id);
    }
  }

  const paths = [...photoProducts.keys()];

  if (!paths.length) return;

  console.log('Loading uncached product photos:', paths.length);

  const batches = [];

  for (let i = 0; i < paths.length; i += PHOTO_BATCH_SIZE) {
    batches.push(paths.slice(i, i + PHOTO_BATCH_SIZE));
  }

  await Promise.all(
    batches.map(async (batch) => {
      try {
        if (!canViewProduce()) return;

        const { data, error } = await supabase.storage
          .from(STORAGE_BUCKET)
          .createSignedUrls(batch, SIGNED_URL_EXPIRY);

        if (error) {
          console.warn('Batch photo loading failed:', error.message);
          return;
        }

        for (let i = 0; i < batch.length; i++) {
          if (!canViewProduce()) return;

          const requestedPath = batch[i];
          const result = data?.[i];

          if (!result || result.error || !result.signedUrl) {
            console.warn(
              'Unable to generate photo URL:',
              requestedPath,
              result?.error
            );
            continue;
          }

          setCachedPhotoUrl(requestedPath, result.signedUrl);

          const produceIds = photoProducts.get(requestedPath) || [];

          for (const produceId of produceIds) {
            updateProductPhoto(produceId, requestedPath, result.signedUrl);
          }
        }
      } catch (error) {
        console.error('Product photo batch error:', error);
      }
    })
  );
}

function updateProductPhoto(produceId, photoPath, photoUrl) {
  if (!canViewProduce()) return;

  const currentProduct = state.products.find(
    (product) => product.produce_id === produceId
  );

  if (!currentProduct) return;

  if (cleanPhotoPath(currentProduct.photo_path) !== photoPath) {
    return;
  }

  const cards = el.grid?.querySelectorAll('.produce-card');

  if (!cards?.length) return;

  for (const card of cards) {
    if (card.dataset.produceId !== produceId) continue;

    const placeholder = card.querySelector(
      '.produce-image-placeholder[data-photo-produce-id]'
    );

    if (!placeholder) return;

    const image = document.createElement('img');

    image.className = 'produce-card-image';
    image.alt = currentProduct.crop_name || 'Produce';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.src = photoUrl;

    image.addEventListener('error', () => {
      const fallback = document.createElement('div');

      fallback.className = 'produce-image-placeholder';
      fallback.textContent = 'Image unavailable';

      image.replaceWith(fallback);
    }, { once: true });

    placeholder.replaceWith(image);

    return;
  }
}

/* ============================================================
   CART COUNT
   ============================================================ */

async function loadCartCount() {
  if (!state.buyerId || !canAddToCart()) {
    if (el.cartCount) {
      el.cartCount.hidden = true;
    }

    return;
  }

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
   LOAD PRODUCTS
   ============================================================ */

async function loadProducts({ initial = false } = {}) {
  if (!canViewProduce()) {
    denyProducePage();
    return;
  }

  if (initial) {
    setLoading(true);
  }

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

    if (!canViewProduce()) {
      denyProducePage();
      return;
    }

    if (inventoryResult.error) throw inventoryResult.error;
    if (pricesResult.error) throw pricesResult.error;

    const priceMap = new Map();

    for (const price of pricesResult.data || []) {
      const key = priceKey(price);
      const value = Number(price.unit_price);

      if (Number.isFinite(value)) {
        priceMap.set(key, value);
      }
    }

    const inventory = inventoryResult.data || [];

    const products = inventory.map((item) => {
      const key = priceKey(item);
      const unitPrice = priceMap.get(key);

      return {
        ...item,
        unit_price:
          unitPrice !== undefined ? unitPrice : null,
        photo_url: getCachedPhotoUrl(item.photo_path),
      };
    });

    state.products = products;

    console.log('Buyer products loaded:', {
      inventoryCount: inventory.length,
      priceCount: priceMap.size,
      matchedPrices: products.filter(
        (product) => product.unit_price !== null
      ).length,
      unmatchedProducts: products
        .filter((product) => product.unit_price === null)
        .map((product) => ({
          crop_name: product.crop_name,
          farm_id: product.farm_id,
          unit: product.unit,
        })),
    });

    applyFilters();

    // Photos load separately in the background.
    loadProductPhotos(products);

  } catch (error) {
    console.error('Browse Produce load failed:', error);

    showError(
      error?.message ||
      'Unable to load available produce. Please refresh the page and try again.'
    );

    if (initial) {
      if (el.resultCount) {
        el.resultCount.textContent = 'Could not load products';
      }

      if (el.grid) el.grid.hidden = true;
      if (el.empty) el.empty.hidden = true;
    }

    throw error;

  } finally {
    if (initial) {
      setLoading(false);
    }
  }
}

/* ============================================================
   REALTIME
   ============================================================ */

function scheduleProductsRefresh() {
  if (!canViewProduce()) {
    denyProducePage();
    return;
  }

  window.clearTimeout(realtimeRefreshTimeout);

  realtimeRefreshTimeout = window.setTimeout(async () => {
    if (!canViewProduce()) {
      denyProducePage();
      return;
    }

    if (isRefreshingProducts) {
      pendingRefresh = true;
      return;
    }

    isRefreshingProducts = true;

    try {
      do {
        pendingRefresh = false;

        if (!canViewProduce()) {
          denyProducePage();
          break;
        }

        await loadProducts();

      } while (pendingRefresh && canViewProduce());

    } catch (error) {
      console.error('Realtime product refresh failed:', error);
    } finally {
      isRefreshingProducts = false;

      if (pendingRefresh && canViewProduce()) {
        scheduleProductsRefresh();
      }
    }
  }, 800);
}

function subscribeToInventoryRealtime() {
  if (!canViewProduce()) return;

  inventoryChannel = supabase
    .channel('buyer-produce-inventory-realtime')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: TABLE_INVENTORY,
      },
      (payload) => {
        if (!canViewProduce()) return;

        console.log('Inventory realtime update:', payload);
        scheduleProductsRefresh();
      }
    )
    .subscribe((status) => {
      console.log('Inventory realtime status:', status);

      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error('Inventory realtime subscription failed.');
      }
    });
}

function subscribeToPricesRealtime() {
  if (!canViewProduce()) return;

  pricesChannel = supabase
    .channel('buyer-produce-prices-realtime')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: TABLE_PRICES,
      },
      (payload) => {
        if (!canViewProduce()) return;

        console.log('PRICE REALTIME EVENT:', payload);
        scheduleProductsRefresh();
      }
    )
    .subscribe((status, error) => {
      console.log('PRICE REALTIME STATUS:', status);

      if (error) {
        console.error('PRICE REALTIME ERROR:', error);
      }
    });
}

function subscribeToBuyerRealtime() {
  if (!canViewProduce()) return;

  subscribeToInventoryRealtime();
  subscribeToPricesRealtime();
}

function unsubscribeFromBuyerRealtime() {
  if (inventoryChannel) {
    supabase.removeChannel(inventoryChannel);
    inventoryChannel = null;
  }

  if (pricesChannel) {
    supabase.removeChannel(pricesChannel);
    pricesChannel = null;
  }

  window.clearTimeout(realtimeRefreshTimeout);
}

/* ============================================================
   PRODUCT DISPLAY
   ============================================================ */

function createImageMarkup(product) {
  const placeholder = `
    <div
      class="produce-image-placeholder"
      aria-label="Loading product photo"
      data-photo-produce-id="${escapeHTML(product.produce_id)}"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 22V12"></path>
        <path d="M12 12C5 12 3 8 3 4c6 0 9 3 9 8"></path>
        <path d="M12 15c0-5 3-8 9-8 0 5-3 8-9 8"></path>
      </svg>
    </div>
  `;

  if (!product.photo_path) {
    return `
      <div class="produce-image-placeholder" aria-label="No product photo available">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 22V12"></path>
          <path d="M12 12C5 12 3 8 3 4c6 0 9 3 9 8"></path>
          <path d="M12 15c0-5 3-8 9-8 0 5-3 8-9 8"></path>
        </svg>
      </div>
    `;
  }

  if (!product.photo_url) return placeholder;

  return `
    <img
      class="produce-card-image"
      src="${escapeHTML(product.photo_url)}"
      alt="${escapeHTML(product.crop_name || 'Produce')}"
      loading="lazy"
      decoding="async"
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

  // Only render cart controls when cart.create is allowed.
  const cartControlsMarkup = canAddToCart()
    ? `
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
    `
    : '';

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

        ${cartControlsMarkup}

      </div>
    </article>
  `;
}

function renderProducts(products) {
  if (!canViewProduce()) {
    denyProducePage();
    return;
  }

  if (!el.grid) return;

  el.grid.innerHTML = '';

  if (!products.length) {
    el.grid.hidden = true;

    if (el.empty) {
      el.empty.hidden = false;

      if (el.emptyTitle) {
        el.emptyTitle.textContent = state.products.length
          ? 'No matching produce'
          : 'No produce available';
      }

      if (el.emptyMessage) {
        el.emptyMessage.textContent = state.products.length
          ? 'Try another search term.'
          : 'There are currently no available products to display.';
      }
    }

    if (el.resultCount) {
      el.resultCount.textContent = '0 products';
    }

    return;
  }

  el.grid.innerHTML = products.map(createProductCard).join('');
  el.grid.hidden = false;

  if (el.empty) {
    el.empty.hidden = true;
  }

  if (el.resultCount) {
    el.resultCount.textContent =
      `${products.length} ${products.length === 1 ? 'product' : 'products'} available`;
  }
}

function applyFilters() {
  if (!canViewProduce()) {
    denyProducePage();
    return;
  }

  const searchTerm = (el.search?.value || '').trim().toLowerCase();
  const sortValue = el.sort?.value || 'newest';

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

/* ============================================================
   ADD TO CART
   ============================================================ */

async function addToCart(button) {
  if (!requirePermission('cart.create')) {
    return;
  }

  if (!canViewProduce()) {
    denyProducePage();
    return;
  }

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

  if (requestedQuantity > Number(product.available_quantity)) {
    showToast('Requested quantity exceeds available stock.', 'error');
    quantityInput?.focus();
    return;
  }

  const originalButtonText = button.innerHTML;

  button.disabled = true;
  button.textContent = 'Adding...';

  try {
    if (!requirePermission('cart.create')) return;

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

    if (!requirePermission('cart.create')) return;

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

    if (quantityInput) quantityInput.value = '1';

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

/* ============================================================
   EVENTS
   ============================================================ */

function bindEvents() {
  el.search?.addEventListener('input', applyFilters);
  el.sort?.addEventListener('change', applyFilters);

  // Logout is already handled by buyers/main.js.
  el.grid?.addEventListener('click', (event) => {
    const button = event.target.closest('.add-to-cart-btn');

    if (!button || button.disabled) return;

    if (!requirePermission('cart.create')) {
      return;
    }

    addToCart(button);
  });
}

/* ============================================================
   INITIALIZATION
   ============================================================ */

async function init() {
  if (pageInitialized) return;

  pageInitialized = true;

  try {
    // Wait for authentication and permission loading.
    const auth = await buyerReady;

    if (!auth) return;

    // Page-level permission.
    if (!hasPermission('produce.view')) {
      denyProducePage();
      return;
    }

    state.buyerId = auth.user.id;

    setToday();
    bindEvents();

    const tasks = [
      loadProducts({ initial: true }),
    ];

    // Cart count is only needed when the Buyer can add to cart.
    if (canAddToCart()) {
      tasks.push(loadCartCount());
    } else if (el.cartCount) {
      el.cartCount.hidden = true;
    }

    await Promise.all(tasks);

    if (!canViewProduce()) {
      denyProducePage();
      return;
    }

    subscribeToBuyerRealtime();

  } catch (error) {
    console.error('Buyer page initialization failed:', error);

    showError(
      error?.message || 'Unable to initialize the Buyer page.'
    );
  }
}

window.addEventListener('pagehide', unsubscribeFromBuyerRealtime);

init();
