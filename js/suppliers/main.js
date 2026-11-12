
import { supabase } from "../connection.js";

/* =========================================================
   SUPPLIER CONFIGURATION
========================================================= */

const SUPPLIER_ROLE = "supplier";

const PAGE_TITLES = {
    dashboard: "Dashboard",
    products: "My Products",
    orders: "Purchase Orders",
    deliveries: "Deliveries",
    profile: "My Profile",
    settings: "Settings",
    invoices: "Invoices",
};

const PAGE_MODULES = {
    dashboard: () => import("./dashboard.js"),
    products: () => import("./product.js"),
    orders: () => import("./orders.js"),
    deliveries: () => import("./deliveries.js"),
    profile: () => import("./profile.js"),
    settings: () => import("./settings.js"),
    invoices: () => import("./invoices.js"),
};

const root = document.getElementById("view");
const logoutButton = document.getElementById("logoutButton");
const html = document.documentElement;

export let currentUser = null;
export let currentSupplier = null;

const ctx = {
    user: null,
    supplier: null,
};

let authorized = false;
let checking = false;
let activeViewModule = null;
let navigationRequest = 0;

/* =========================================================
   HELPERS
========================================================= */

function escapeHTML(value = "") {
    return String(value).replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
    })[character]);
}

export function formatCurrency(value) {
    return new Intl.NumberFormat("en-PH", {
        style: "currency",
        currency: "PHP",
    }).format(Number(value) || 0);
}

export function formatDate(value) {
    if (!value) return "—";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "—";
    }

    return date.toLocaleDateString("en-PH", {
        year: "numeric",
        month: "short",
        day: "numeric",
    });
}

export function showToast(message, type = "success") {
    const toast = document.getElementById("toast");

    if (!toast) {
        console[type === "error" ? "error" : "log"](message);
        return;
    }

    toast.textContent = message;
    toast.className = `toast toast-${type}`;
    toast.hidden = false;

    clearTimeout(toast._hideTimeout);

    toast._hideTimeout = setTimeout(() => {
        toast.hidden = true;
    }, 3500);
}

function showPageError(title, message) {
    if (!root) return;

    root.innerHTML = `
        <div class="page-error">
            <i class="fa-solid fa-circle-exclamation"></i>
            <h2>${escapeHTML(title)}</h2>
            <p>${escapeHTML(message)}</p>
        </div>
    `;
}

/* =========================================================
   ROUTING
========================================================= */

function route() {
    const name = location.hash.slice(1).split("/")[0];

    return PAGE_MODULES[name] ? name : "dashboard";
}

export async function navigateTo(page) {
    if (!PAGE_MODULES[page]) {
        page = "dashboard";
    }

    if (location.hash !== `#${page}`) {
        location.hash = page;
        return;
    }

    await show();
}

/* =========================================================
   THEME
========================================================= */

function updateThemeIcon(theme) {
    const button = document.getElementById("themeToggle");
    const icon = button?.querySelector("i");

    if (icon) {
        icon.className = theme === "dark"
            ? "fa-solid fa-sun"
            : "fa-solid fa-moon";
    }

    button?.setAttribute(
        "aria-label",
        theme === "dark"
            ? "Switch to light theme"
            : "Switch to dark theme"
    );
}

function setupTheme() {
    const savedTheme =
        localStorage.getItem("tanikala-theme") ||
        localStorage.getItem("theme") ||
        "light";

    html.setAttribute("data-theme", savedTheme);
    updateThemeIcon(savedTheme);

    const themeToggle = document.getElementById("themeToggle");

    themeToggle?.addEventListener("click", () => {
        const next =
            html.getAttribute("data-theme") === "dark"
                ? "light"
                : "dark";

        html.setAttribute("data-theme", next);

        localStorage.setItem("tanikala-theme", next);
        localStorage.setItem("theme", next);

        updateThemeIcon(next);
    });
}

/* =========================================================
   HEADER
========================================================= */

function setupHeader() {
    const accountName = currentSupplier?.full_name || "User";

    const avatar = document.getElementById("supplierAvatar");

    if (avatar) {
        avatar.textContent = accountName
            .trim()
            .charAt(0)
            .toUpperCase();
    }

    const todayLabel = document.getElementById("todayLabel");

    if (todayLabel) {
        todayLabel.textContent = new Date().toLocaleDateString(
            "en-PH",
            {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
            }
        );
    }
}

/* =========================================================
   SIDEBAR
========================================================= */

function setupSidebar() {
    const sidebarToggle = document.getElementById("sidebarToggle");
    const sidebar = document.getElementById("supplierSidebar");

    sidebarToggle?.addEventListener("click", () => {
        sidebar?.classList.toggle("sidebar-open");
    });

    document.querySelectorAll(".nav a[data-view]").forEach(anchor => {
        anchor.addEventListener("click", event => {
            const page = anchor.dataset.view;

            if (!PAGE_MODULES[page]) return;

            event.preventDefault();

            sidebar?.classList.remove("sidebar-open");

            if (route() !== page) {
                location.hash = page;
            } else {
                show();
            }
        });
    });
}

/* =========================================================
   AUTHENTICATION
========================================================= */

async function requireSupplier() {
    try {
        const {
            data: { user },
            error: authError,
        } = await supabase.auth.getUser();

        if (authError || !user) {
            console.error(
                "Supplier authentication failed:",
                authError
            );

            return null;
        }

        const {
            data: supplier,
            error: supplierError,
        } = await supabase
            .from("supplier_details")
            .select(`
                user_id,
                business_name,
                business_address
            `)
            .eq("user_id", user.id)
            .maybeSingle();

        if (supplierError || !supplier) {
            console.error(
                "Supplier account verification failed:",
                supplierError
            );

            return null;
        }

        const {
            data: profile,
            error: profileError,
        } = await supabase
            .from("profiles")
            .select("full_name")
            .eq("id", user.id)
            .maybeSingle();

        if (profileError) {
            console.error(
                "Supplier profile lookup failed:",
                profileError
            );

            return null;
        }

        const supplierAccount = {
            ...supplier,
            full_name:
                profile?.full_name ||
                user.user_metadata?.full_name ||
                user.email,
        };

        return {
            user,
            supplier: supplierAccount,
        };

    } catch (error) {
        console.error("Supplier verification error:", error);
        return null;
    }
}

/* =========================================================
   PAGE CLEANUP
========================================================= */

async function cleanupCurrentPage() {
    if (activeViewModule?.cleanup) {
        try {
            await activeViewModule.cleanup();
        } catch (error) {
            console.error(
                "Supplier page cleanup failed:",
                error
            );
        }
    }

    activeViewModule = null;
}

/* =========================================================
   PAGE ROUTING
========================================================= */

async function show() {
    if (!authorized || !root) return;

    const requestId = ++navigationRequest;

    await cleanupCurrentPage();

    if (!authorized || requestId !== navigationRequest) {
        return;
    }

    const key = route();

    document.querySelectorAll(".nav a[data-view]").forEach(anchor => {
        const active = anchor.dataset.view === key;

        anchor.classList.toggle("active", active);

        if (active) {
            anchor.setAttribute("aria-current", "page");
        } else {
            anchor.removeAttribute("aria-current");
        }
    });

    const pageTitle = document.getElementById("pageTitle");

    if (pageTitle) {
        pageTitle.textContent = PAGE_TITLES[key];
    }

    document.title =
        `${PAGE_TITLES[key]} | Tanikala Supplier`;

    root.innerHTML = `
        <div class="page-loading">
            <i class="fa-solid fa-spinner fa-spin"></i>
            <span>Loading...</span>
        </div>
    `;

    try {
        const module = await PAGE_MODULES[key]();

        if (requestId !== navigationRequest) return;

        if (typeof module.render !== "function") {
            throw new Error(
                `${key}.js must export a render() function.`
            );
        }

        activeViewModule = module;

        root.replaceChildren();

        await module.render({
            supabase,
            user: currentUser,
            supplier: currentSupplier,
            view: root,
            escapeHTML,
            formatCurrency,
            formatDate,
            showToast,
        });

        if (requestId !== navigationRequest) {
            await cleanupCurrentPage();
        }

    } catch (error) {
        if (requestId !== navigationRequest) return;

        console.error(
            `Failed to load Supplier ${key}:`,
            error
        );

        showPageError(
            `Unable to load ${PAGE_TITLES[key]}`,
            error.message || "An unexpected error occurred."
        );
    }
}

/* =========================================================
   LOGOUT
========================================================= */

async function handleLogout() {
    if (!logoutButton || logoutButton.disabled) return;

    logoutButton.disabled = true;
    logoutButton.textContent = "Logging out...";

    try {
        // Prevent additional page rendering.
        authorized = false;
        navigationRequest++;

        // Clean up the currently active page.
        await cleanupCurrentPage();

        // Sign out the authenticated user.
        const { error } = await supabase.auth.signOut();

        if (error) {
            throw error;
        }

        currentUser = null;
        currentSupplier = null;

        ctx.user = null;
        ctx.supplier = null;

        html.classList.remove("supplier-authorized");

        // Same redirect behavior as Farm Manager.
        location.replace("../../login.html");

    } catch (error) {
        console.error("Supplier logout failed:", error);

        logoutButton.disabled = false;
        logoutButton.textContent = "Log out";

        if (authorized) {
            showToast(
                error.message || "Unable to log out.",
                "error"
            );
        }
    }
}

/* =========================================================
   SESSION RESTORATION
========================================================= */

function setupSessionGuard() {
    window.addEventListener("pageshow", event => {
        if (event.persisted) {
            boot();
        }
    });
}

/* =========================================================
   TOPBAR AND EVENT LISTENERS
========================================================= */

function setupChrome() {
    setupTheme();
    setupSidebar();
    setupSessionGuard();

    if (logoutButton) {
        logoutButton.addEventListener("click", handleLogout);
    }

    window.addEventListener("hashchange", show);
}

/* =========================================================
   BOOT
========================================================= */

async function boot() {
    if (checking) return;

    checking = true;
    authorized = false;

    navigationRequest++;

    html.classList.remove("supplier-authorized");

    await cleanupCurrentPage();

    const result = await requireSupplier();

    checking = false;

    if (!result) {
        await supabase.auth.signOut().catch(error => {
            console.error("Supplier sign-out error:", error);
        });

        location.replace("../../login.html");
        return;
    }

    currentUser = result.user;
    currentSupplier = result.supplier;

    ctx.user = currentUser;
    ctx.supplier = currentSupplier;

    console.log("Supplier authenticated:", {
        userId: currentUser.id,
        accountName: currentSupplier.full_name,
        businessName: currentSupplier.business_name,
    });

    setupHeader();

    authorized = true;

    html.classList.add("supplier-authorized");

    await show();
}

/* =========================================================
   INITIALIZATION
========================================================= */

setupChrome();
boot();
