
import { supabase } from '../connection.js';
import { h, toast } from '../admin/ui.js';
import {
    initNotifications,
    cleanupNotifications
} from '../shared/notifications.js';

const FARM_MANAGER_ROLE_ID = 1;
const ACTIVE_STATUS_ID = 1;

const TITLES = {
    dashboard: 'Dashboard',
    farms: 'My farms',
    workers: 'Workers',
    'farm-actions': 'Farm Actions',
    'plant-now': 'Plant Now',
    crops: 'Crops',
    harvest: 'Harvest Dashboard',
    reports: 'Reports',
    settings: 'Settings',
    'browse-products': 'Browse Products'
};

const root = document.getElementById('view');
const search = document.getElementById('fmSearch');
const logoutButton = document.getElementById('logoutButton');
const html = document.documentElement;

const ctx = {
    query: '',
    staff: null,
    replenishmentRequestId: null,
    cartMode: false
};

let authorized = false;
let checking = false;
let activeViewModule = null;

let cartButton = null;
let cartBadge = null;
let cartChannel = null;
let cartUserId = null;

const route = () => {
    const name = location.hash.slice(1).split('/')[0];
    return TITLES[name] ? name : 'dashboard';
};

function getRouteRequestId() {
    if (route() !== 'browse-products') return null;

    const parts = location.hash.slice(1).split('/');
    return parts[1] && parts[1] !== 'cart'
        ? parts[1]
        : null;
}

function isCartRoute() {
    if (route() !== 'browse-products') return false;

    return location.hash.slice(1).split('/')[1] === 'cart';
}

async function requireFarmManager() {
    const {
        data: { user },
        error
    } = await supabase.auth.getUser();

    if (error || !user) return null;

    const { data: staff, error: staffError } = await supabase
        .from('staff_accounts')
        .select('staff_id, full_name, role_id, status_id')
        .eq('user_id', user.id)
        .maybeSingle();

    if (staffError || !staff) return null;

    if (
        Number(staff.role_id) !== FARM_MANAGER_ROLE_ID ||
        Number(staff.status_id) !== ACTIVE_STATUS_ID
    ) {
        return null;
    }

    return staff;
}

// ============================================================
// GLOBAL SHOPPING CART ICON
// ============================================================

function cleanupCartButton() {
    if (cartChannel) {
        supabase.removeChannel(cartChannel);
        cartChannel = null;
    }

    if (cartButton) {
        cartButton.remove();
        cartButton = null;
        cartBadge = null;
    }

    cartUserId = null;
}

async function updateCartBadge() {
    if (!cartUserId || !cartBadge) return;

    const { count, error } = await supabase
        .from('farm_manager_cart_items')
        .select('cart_item_id', {
            count: 'exact',
            head: true
        })
        .eq('manager_user_id', cartUserId);

    if (error) {
        console.error('Failed to load shopping cart count:', error);
        return;
    }

    if (!cartBadge) return;

    const total = Number(count || 0);

    cartBadge.textContent = total > 99
        ? '99+'
        : String(total);

    cartBadge.hidden = total === 0;
    cartButton?.setAttribute(
        'aria-label',
        `Shopping cart, ${total} items`
    );
}

async function setupShoppingCart() {
    cleanupCartButton();

    const topbar = document.querySelector('.topbar-right');

    if (!topbar) {
        console.error('Shopping cart: .topbar-right was not found.');
        return;
    }

    const {
        data: { user },
        error
    } = await supabase.auth.getUser();

    if (error || !user) return;

    cartUserId = user.id;

    cartButton = document.createElement('button');
    cartButton.type = 'button';
    cartButton.className = 'fm-shopping-cart-button';
    cartButton.title = 'Shopping Cart';
    cartButton.setAttribute('aria-label', 'Shopping Cart');

    cartButton.style.cssText = `
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 42px;
        height: 42px;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: transparent;
        color: inherit;
        cursor: pointer;
        flex-shrink: 0;
    `;

    cartButton.innerHTML = `
        <svg
            viewBox="0 0 24 24"
            width="22"
            height="22"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
        >
            <circle cx="9" cy="21" r="1"></circle>
            <circle cx="20" cy="21" r="1"></circle>
            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
        </svg>
    `;

    cartBadge = document.createElement('span');
    cartBadge.className = 'fm-shopping-cart-count';
    cartBadge.hidden = true;

    cartBadge.style.cssText = `
        position: absolute;
        top: 0;
        right: -2px;
        min-width: 17px;
        height: 17px;
        padding: 0 4px;
        display: none;
        align-items: center;
        justify-content: center;
        border-radius: 20px;
        background: #c65d3a;
        color: #fff;
        font-size: 10px;
        font-weight: 700;
        line-height: 17px;
        box-sizing: border-box;
    `;

    Object.defineProperty(cartBadge, 'hidden', {
        configurable: true,
        get() {
            return this.style.display === 'none';
        },
        set(value) {
            this.style.display = value ? 'none' : 'flex';
        }
    });

    cartButton.append(cartBadge);

    cartButton.addEventListener('click', () => {
        location.hash = 'browse-products/cart';
    });

    // Place the cart immediately before the notification bell.
    const notificationCenter = topbar.querySelector(
        '.notification-center'
    );

    if (notificationCenter) {
        topbar.insertBefore(cartButton, notificationCenter);
    } else {
        const avatar = topbar.querySelector('#fmAvatar');

        if (avatar) {
            topbar.insertBefore(cartButton, avatar);
        } else {
            topbar.append(cartButton);
        }
    }

    await updateCartBadge();

    cartChannel = supabase
        .channel(`fm-cart-${user.id}`)
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'farm_manager_cart_items',
                filter: `manager_user_id=eq.${user.id}`
            },
            () => {
                updateCartBadge();
            }
        )
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                updateCartBadge();
            }
        });
}

// ============================================================
// PAGE ROUTING
// ============================================================

async function show() {
    if (!authorized) return;

    if (activeViewModule?.cleanup) {
        activeViewModule.cleanup();
    }

    activeViewModule = null;

    const key = route();

    ctx.replenishmentRequestId = getRouteRequestId();
    ctx.cartMode = isCartRoute();

    document.querySelectorAll('.nav > a').forEach((anchor) => {
        anchor.classList.toggle(
            'active',
            anchor.dataset.view === key
        );
    });

    document.title = `${TITLES[key]} | Tanikala Farm Manager`;

    root.replaceChildren(
        h('p', { class: 'muted' }, 'Loading...')
    );

    try {
        const view = await import(`./${key}.js`);

        if (typeof view.render !== 'function') {
            throw new Error(
                `${key}.js must export an async render(root, ctx) function.`
            );
        }

        activeViewModule = view;

        root.replaceChildren();

        await view.render(root, ctx);
    } catch (err) {
        console.error('Failed to load Farm Manager page:', err);

        root.replaceChildren(
            h(
                'p',
                { class: 'msg error' },
                'This page could not load. Refresh and try again.'
            )
        );
    }
}

// ============================================================
// NOTIFICATIONS
// ============================================================

async function setupNotifications() {
    cleanupNotifications();

    try {
        await initNotifications(supabase);
    } catch (error) {
        console.error(
            'Failed to initialize Farm Manager notifications:',
            error
        );
    }
}

// ============================================================
// AUTHENTICATION
// ============================================================

async function boot() {
    if (checking) return;

    checking = true;
    authorized = false;

    html.classList.remove('fm-authorized');

    cleanupNotifications();
    cleanupCartButton();

    const staff = await requireFarmManager();

    checking = false;

    if (!staff) {
        await supabase.auth.signOut().catch(() => {});
        location.replace('../../login.html');
        return;
    }

    ctx.staff = staff;

    const avatar = document.getElementById('fmAvatar');

    if (avatar) {
        avatar.textContent = (staff.full_name || 'FM')
            .split(/\s+/)
            .filter(Boolean)
            .map((part) => part[0])
            .slice(0, 2)
            .join('')
            .toUpperCase();
    }

    authorized = true;

    html.classList.add('fm-authorized');

    await setupNotifications();
    await setupShoppingCart();
    await show();
}

// ============================================================
// TOPBAR AND EVENT LISTENERS
// ============================================================

function setupChrome() {
    const todayLabel = document.getElementById('todayLabel');
    const themeToggle = document.getElementById('themeToggle');

    if (todayLabel) {
        todayLabel.textContent = new Date().toLocaleDateString(
            'en-PH',
            {
                weekday: 'long',
                month: 'short',
                day: 'numeric'
            }
        );
    }

    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const next =
                html.dataset.theme === 'dark' ? 'light' : 'dark';

            html.dataset.theme = next;
            localStorage.setItem('theme', next);
        });
    }

    let timer;

    if (search) {
        search.addEventListener('input', () => {
            clearTimeout(timer);

            timer = setTimeout(() => {
                ctx.query = search.value.trim().toLowerCase();

                if (route() === 'dashboard' && ctx.query) {
                    location.hash = 'farms';
                } else {
                    show();
                }
            }, 200);
        });
    }

    window.addEventListener('hashchange', show);

    window.addEventListener('pageshow', (event) => {
        if (event.persisted) {
            boot();
        }
    });

    if (logoutButton) {
        logoutButton.addEventListener('click', async () => {
            if (logoutButton.disabled) return;

            logoutButton.disabled = true;
            logoutButton.textContent = 'Logging out...';

            try {
                cleanupNotifications();
                cleanupCartButton();

                const { error } = await supabase.auth.signOut();

                if (error) throw error;

                authorized = false;
                html.classList.remove('fm-authorized');

                location.replace('../../login.html');
            } catch (err) {
                console.error('Logout failed:', err);

                logoutButton.disabled = false;
                logoutButton.textContent = 'Log out';

                if (authorized) {
                    await setupNotifications();
                    await setupShoppingCart();
                }

                toast('Logout failed. Please try again.');
            }
        });
    }
}

setupChrome();
boot();
