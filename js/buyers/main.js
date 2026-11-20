
import { supabase } from "../connection.js";

/* ============================================================
   BUYER - SHARED MODULE
   Authentication, permissions, theme, logout and formatters.
   ============================================================ */

const THEME_KEY = "theme";
const LOGIN_URL = "../../login.html";
const BUYER_ROLE = "buyer";

let currentPermissions = new Map();
let permissionsLoaded = false;
let sessionGuardReady = false;

/* ============ THEME ============ */

function readSavedTheme() {
    try {
        return (
            localStorage.getItem(THEME_KEY) ||
            localStorage.getItem("tanikala-theme")
        );
    } catch {
        return null;
    }
}

function applyTheme(theme) {
    document.documentElement.setAttribute(
        "data-theme",
        theme === "dark" ? "dark" : "light"
    );
}

function initializeTheme() {
    applyTheme(readSavedTheme());

    const toggle = document.getElementById("themeToggle");

    if (toggle && toggle.dataset.themeInitialized !== "true") {
        toggle.dataset.themeInitialized = "true";

        toggle.addEventListener("click", event => {
            event.stopImmediatePropagation();

            const next =
                document.documentElement.getAttribute("data-theme") === "dark"
                    ? "light"
                    : "dark";

            applyTheme(next);

            try {
                localStorage.setItem(THEME_KEY, next);
            } catch {
                // Ignore blocked storage.
            }
        });
    }

    window.addEventListener("storage", event => {
        if (event.key === THEME_KEY && event.newValue) {
            applyTheme(event.newValue);
        }
    });
}

/* ============ HELPERS ============ */

export function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[ch]));
}

export function formatPeso(amount) {
    return new Intl.NumberFormat("en-PH", {
        style: "currency",
        currency: "PHP"
    }).format(Number(amount) || 0);
}

export function formatDate(value) {
    if (!value) return "-";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "-";

    return date.toLocaleDateString("en-PH", {
        year: "numeric",
        month: "short",
        day: "numeric"
    });
}

export function showToast(message, type = "success") {
    const stack = document.getElementById("toastStack");

    if (!stack) return;

    const toast = document.createElement("div");

    toast.className =
        `toast${type === "error" ? " toast--error" : ""}`;

    toast.setAttribute(
        "role",
        type === "error" ? "alert" : "status"
    );

    toast.textContent = message;
    stack.appendChild(toast);

    setTimeout(() => toast.remove(), 4000);
}

/* ============ PERMISSIONS ============ */

async function loadBuyerPermissions(userId) {
    const [roleResult, userResult] = await Promise.all([
        supabase
            .from("role_permissions")
            .select("permission_key, is_allowed")
            .eq("role_key", BUYER_ROLE),

        supabase
            .from("user_permissions")
            .select("permission_key, is_allowed")
            .eq("user_id", userId)
    ]);

    if (roleResult.error) {
        throw roleResult.error;
    }

    if (userResult.error) {
        throw userResult.error;
    }

    const roleDefaults = new Map(
        (roleResult.data || []).map(item => [
            item.permission_key,
            Boolean(item.is_allowed)
        ])
    );

    const individualOverrides = new Map(
        (userResult.data || []).map(item => [
            item.permission_key,
            Boolean(item.is_allowed)
        ])
    );

    currentPermissions = new Map(roleDefaults);

    // Individual permissions override role defaults.
    for (const [key, allowed] of individualOverrides) {
        currentPermissions.set(key, allowed);
    }

    permissionsLoaded = true;

    console.log("Buyer permissions loaded:", {
        roleDefaults: roleDefaults.size,
        individualOverrides: individualOverrides.size,
        effectivePermissions: currentPermissions.size
    });

    return currentPermissions;
}

export function hasPermission(permissionKey) {
    if (!permissionsLoaded || !permissionKey) {
        return false;
    }

    return currentPermissions.get(permissionKey) === true;
}

export function hasAnyPermission(permissionKeys = []) {
    return permissionKeys.some(key => hasPermission(key));
}

export function hasAllPermissions(permissionKeys = []) {
    return permissionKeys.every(key => hasPermission(key));
}

export function getBuyerPermissions() {
    return new Map(currentPermissions);
}

export function requirePermission(permissionKey) {
    if (hasPermission(permissionKey)) {
        return true;
    }

    showToast(
        "You do not have permission to perform this action.",
        "error"
    );

    return false;
}

export function applyPermissionVisibility(container = document) {
    const elements = [];

    if (container.matches?.("[data-permission]")) {
        elements.push(container);
    }

    elements.push(
        ...container.querySelectorAll("[data-permission]")
    );

    elements.forEach(element => {
        const permissionKey = element.dataset.permission;
        const action = element.dataset.permissionAction || "hide";
        const allowed = hasPermission(permissionKey);

        if (action === "disable") {
            element.disabled = !allowed;
            element.setAttribute("aria-disabled", String(!allowed));
        } else {
            element.hidden = !allowed;
        }
    });
}

/* ============ HEADER ============ */

function setupHeader(user) {
    const todayLabel = document.getElementById("todayLabel");

    if (todayLabel) {
        todayLabel.textContent = new Date().toLocaleDateString(
            "en-PH",
            {
                weekday: "short",
                month: "short",
                day: "numeric"
            }
        );
    }

    const fullName =
        user.user_metadata?.full_name ||
        user.user_metadata?.fullName ||
        user.email?.split("@")[0] ||
        "Buyer";

    const userName = document.getElementById("userName");
    const userInitial = document.getElementById("userInitial");

    if (userName) {
        userName.textContent = fullName;
    }

    if (userInitial) {
        userInitial.textContent =
            fullName.trim().charAt(0).toUpperCase();
    }
}

/* ============ LOGOUT ============ */

function setupLogout() {
    const button = document.getElementById("logoutBtn");

    if (!button || button.dataset.logoutInitialized === "true") {
        return;
    }

    button.dataset.logoutInitialized = "true";

    const defaultHTML = button.innerHTML;

    button.addEventListener("click", async () => {
        if (button.disabled) return;

        button.disabled = true;
        button.textContent = "Logging out...";

        try {
            const { error } = await supabase.auth.signOut();

            if (error) throw error;

            window.location.replace(LOGIN_URL);

        } catch (error) {
            console.error("Buyer logout failed:", error);

            button.disabled = false;
            button.innerHTML = defaultHTML;

            showToast(
                "Unable to log out. Please try again.",
                "error"
            );
        }
    });
}

/* ============ SESSION GUARD ============ */

function setupSessionGuard() {
    if (sessionGuardReady) return;

    sessionGuardReady = true;

    window.addEventListener("pageshow", async () => {
        try {
            const {
                data: { session },
                error
            } = await supabase.auth.getSession();

            if (error || !session) {
                window.location.replace(LOGIN_URL);
            }
        } catch (error) {
            console.error("Buyer session validation failed:", error);
            window.location.replace(LOGIN_URL);
        }
    });

    supabase.auth.onAuthStateChange(event => {
        if (event === "SIGNED_OUT") {
            currentPermissions.clear();
            permissionsLoaded = false;

            window.location.replace(LOGIN_URL);
        }
    });
}

/* ============ ACCESS DENIED ============ */

function showAccessDenied(
    message = "Your account is not authorized to access this page."
) {
    currentPermissions.clear();
    permissionsLoaded = false;

    document.body.innerHTML = `
        <main style="padding:40px;text-align:center">
            <h2>Access Denied</h2>
            <p>${escapeHtml(message)}</p>
            <button id="returnToLogin">
                Return to Login
            </button>
        </main>
    `;

    document
        .getElementById("returnToLogin")
        ?.addEventListener("click", () => {
            window.location.replace(LOGIN_URL);
        });
}

/* ============ PAGE INIT ============ */

export async function initBuyerPage() {
    initializeTheme();
    setupLogout();
    setupSessionGuard();

    currentPermissions.clear();
    permissionsLoaded = false;

    try {
        const {
            data: { user },
            error: authError
        } = await supabase.auth.getUser();

        if (authError || !user) {
            window.location.replace(LOGIN_URL);
            return null;
        }

        const {
            data: profile,
            error: profileError
        } = await supabase
            .from("profiles")
            .select("id, role, status")
            .eq("id", user.id)
            .maybeSingle();

        if (profileError) {
            throw profileError;
        }

        const role = String(profile?.role ?? "")
            .trim()
            .toLowerCase();

        const status = String(profile?.status ?? "")
            .trim()
            .toLowerCase();

        const authorized =
            Boolean(profile) &&
            role === BUYER_ROLE &&
            ["active", "approved"].includes(status);

        if (!authorized) {
            console.error("Buyer access denied:", {
                userId: user.id,
                role,
                status
            });

            showAccessDenied();
            return null;
        }

        // Permissions must load before page scripts continue.
        await loadBuyerPermissions(user.id);

        setupHeader(user);
        applyPermissionVisibility();

        return {
            user,
            profile,
            permissions: getBuyerPermissions()
        };

    } catch (error) {
        console.error("Buyer initialization failed:", error);

        showAccessDenied(
            "Unable to verify your account permissions. Please contact the administrator."
        );

        return null;
    }
}

/* ============ AUTOMATIC INITIALIZATION ============ */

// Export the same initialization promise to Buyer page scripts.
// Do not call initBuyerPage() again inside individual page scripts.
export const buyerReady = initBuyerPage();
