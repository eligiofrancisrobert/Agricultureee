import { supabase } from '../connection.js';

const TABLE_CART = 'buyer_cart_items';

const state = {
  user: null,
};

const el = {
  todayLabel: document.getElementById('todayLabel'),
  userName: document.getElementById('userName'),
  userInitial: document.getElementById('userInitial'),
  logoutBtn: document.getElementById('logoutBtn'),
  cartCount: document.getElementById('cartCount'),
  toastStack: document.getElementById('toastStack'),

  loading: document.getElementById('profileLoading'),
  error: document.getElementById('profileError'),
  layout: document.getElementById('profileLayout'),

  avatar: document.getElementById('profileAvatar'),
  name: document.getElementById('profileName'),
  emailText: document.getElementById('profileEmailText'),
  typeBadge: document.getElementById('profileTypeBadge'),
  since: document.getElementById('profileSince'),

  detailsForm: document.getElementById('detailsForm'),
  fullName: document.getElementById('fullName'),
  email: document.getElementById('email'),
  phone: document.getElementById('phone'),
  buyerType: document.getElementById('buyerType'),
  businessField: document.getElementById('businessField'),
  businessName: document.getElementById('businessName'),
  deliveryAddress: document.getElementById('deliveryAddress'),
  saveDetailsBtn: document.getElementById('saveDetailsBtn'),

  passwordForm: document.getElementById('passwordForm'),
  newPassword: document.getElementById('newPassword'),
  confirmPassword: document.getElementById('confirmPassword'),
  savePasswordBtn: document.getElementById('savePasswordBtn'),
};

/* ============ HELPERS ============ */

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
  el.loading.hidden = true;
  el.layout.hidden = true;
  el.error.textContent = message;
  el.error.hidden = false;
}

function setInvalid(input, invalid) {
  if (invalid) {
    input.setAttribute('aria-invalid', 'true');
  } else {
    input.removeAttribute('aria-invalid');
  }
}

function getDisplayName(user) {
  const metadata = user.user_metadata || {};

  return (
    metadata.full_name ||
    metadata.fullName ||
    metadata.name ||
    user.email ||
    'Buyer'
  );
}

function getInitial(name) {
  return name.trim().charAt(0).toUpperCase() || 'B';
}

function typeLabel(type) {
  return type === 'business' ? 'Business' : 'Individual';
}

/* ============ LOAD ============ */

async function loadCartCount() {
  if (!state.user || !el.cartCount) return;

  const { count, error } = await supabase
    .from(TABLE_CART)
    .select('cart_item_id', { count: 'exact', head: true })
    .eq('buyer_id', state.user.id);

  if (error) {
    console.warn('Unable to load cart count:', error.message);
    return;
  }

  const total = Number(count || 0);

  el.cartCount.textContent = total > 99 ? '99+' : String(total);
  el.cartCount.hidden = total === 0;
}

function renderIdentity() {
  const user = state.user;
  const metadata = user.user_metadata || {};
  const displayName = getDisplayName(user);
  const type = metadata.buyer_type === 'business' ? 'business' : 'individual';

  // Shell header
  if (el.userName) el.userName.textContent = displayName;
  if (el.userInitial) el.userInitial.textContent = getInitial(displayName);

  // Identity card
  el.avatar.textContent = getInitial(displayName);
  el.name.textContent =
    type === 'business' && metadata.business_name
      ? metadata.business_name
      : displayName;
  el.emailText.textContent = user.email || '—';
  el.typeBadge.textContent = typeLabel(type);

  el.since.textContent = user.created_at
    ? `Member since ${new Intl.DateTimeFormat('en-PH', {
        month: 'long',
        year: 'numeric',
      }).format(new Date(user.created_at))}`
    : '';
}

function fillForm() {
  const user = state.user;
  const metadata = user.user_metadata || {};

  el.fullName.value = metadata.full_name || metadata.fullName || metadata.name || '';
  el.email.value = user.email || '';
  el.phone.value = metadata.phone || '';
  el.buyerType.value = metadata.buyer_type === 'business' ? 'business' : 'individual';
  el.businessName.value = metadata.business_name || '';
  el.deliveryAddress.value = metadata.delivery_address || '';

  toggleBusinessField();
}

function toggleBusinessField() {
  const isBusiness = el.buyerType.value === 'business';

  el.businessField.hidden = !isBusiness;

  if (!isBusiness) setInvalid(el.businessName, false);
}

/** Load the authenticated buyer profile and populate the identity and form. */
async function init() {
  setToday();
  bindEvents();

  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) throw error;

    if (!user) {
      window.location.href = '../../index.html';
      return;
    }

    state.user = user;

    renderIdentity();
    fillForm();

    el.loading.hidden = true;
    el.layout.hidden = false;

    await loadCartCount();

  } catch (error) {
    console.error('Profile loading failed:', error);
    showError(error?.message || 'Unable to load your profile.');
  }
}

/* ============ SAVE DETAILS ============ */

/** Validate and save buyer profile fields as Supabase Auth user metadata. */
async function saveDetails(event) {
  event.preventDefault();

  const fullName = el.fullName.value.trim();
  const phone = el.phone.value.trim();
  const buyerType = el.buyerType.value === 'business' ? 'business' : 'individual';
  const businessName = el.businessName.value.trim();
  const deliveryAddress = el.deliveryAddress.value.trim();

  [el.fullName, el.phone, el.businessName].forEach((input) =>
    setInvalid(input, false)
  );

  if (!fullName) {
    setInvalid(el.fullName, true);
    showToast('Please enter your full name.', 'error');
    el.fullName.focus();
    return;
  }

  if (phone && !/^[0-9+()\-\s]{7,20}$/.test(phone)) {
    setInvalid(el.phone, true);
    showToast('Please enter a valid phone number.', 'error');
    el.phone.focus();
    return;
  }

  if (buyerType === 'business' && !businessName) {
    setInvalid(el.businessName, true);
    showToast('Please enter your business name.', 'error');
    el.businessName.focus();
    return;
  }

  const originalText = el.saveDetailsBtn.textContent;
  el.saveDetailsBtn.disabled = true;
  el.saveDetailsBtn.textContent = 'Saving...';

  try {
    const { data, error } = await supabase.auth.updateUser({
      data: {
        full_name: fullName,
        phone,
        buyer_type: buyerType,
        business_name: buyerType === 'business' ? businessName : '',
        delivery_address: deliveryAddress,
      },
    });

    if (error) throw error;

    state.user = data.user || state.user;

    renderIdentity();
    fillForm();

    showToast('Profile saved.', 'success');

  } catch (error) {
    console.error('Profile update failed:', error);
    showToast(error?.message || 'Unable to save your profile.', 'error');

  } finally {
    el.saveDetailsBtn.disabled = false;
    el.saveDetailsBtn.textContent = originalText;
  }
}

/* ============ CHANGE PASSWORD ============ */

/** Validate the confirmation and update the signed-in buyer's password. */
async function changePassword(event) {
  event.preventDefault();

  const password = el.newPassword.value;
  const confirmation = el.confirmPassword.value;

  [el.newPassword, el.confirmPassword].forEach((input) =>
    setInvalid(input, false)
  );

  if (password.length < 8) {
    setInvalid(el.newPassword, true);
    showToast('Password must be at least 8 characters.', 'error');
    el.newPassword.focus();
    return;
  }

  if (password !== confirmation) {
    setInvalid(el.confirmPassword, true);
    showToast('Passwords do not match.', 'error');
    el.confirmPassword.focus();
    return;
  }

  const originalText = el.savePasswordBtn.textContent;
  el.savePasswordBtn.disabled = true;
  el.savePasswordBtn.textContent = 'Updating...';

  try {
    const { error } = await supabase.auth.updateUser({ password });

    if (error) throw error;

    el.passwordForm.reset();
    showToast('Password updated.', 'success');

  } catch (error) {
    console.error('Password update failed:', error);
    showToast(error?.message || 'Unable to update your password.', 'error');

  } finally {
    el.savePasswordBtn.disabled = false;
    el.savePasswordBtn.textContent = originalText;
  }
}

/* ============ EVENTS ============ */

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
  el.buyerType?.addEventListener('change', toggleBusinessField);
  el.detailsForm?.addEventListener('submit', saveDetails);
  el.passwordForm?.addEventListener('submit', changePassword);

  [el.fullName, el.phone, el.businessName, el.newPassword, el.confirmPassword]
    .forEach((input) =>
      input?.addEventListener('input', () => setInvalid(input, false))
    );
}

init();