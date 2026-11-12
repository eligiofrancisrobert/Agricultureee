import { supabase } from "../connection.js";

/* ============================================================
   ACCOUNTANT - shared module
   Theme, auth guard (role: "Accountant"), logout, toast, formatters.
   Gamitin sa bawat accountant page:
     import { initAccountantPage } from "./accountant-common.js";
     const { user } = await initAccountantPage();
   ============================================================ */

const THEME_KEY = "theme";
const LOGIN_URL = "../../login.html";
const ACCOUNTANT_ROLE_ID = "accountant";

/* ============ THEME (same behavior as farmer main.js) ============ */

function readSavedTheme() {
    try {
        return localStorage.getItem(THEME_KEY) || localStorage.getItem("tanikala-theme");
    } catch {
        return null;
    }
}

function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme === "dark" ? "dark" : "light");
}

function initializeTheme() {
    applyTheme(readSavedTheme());

    const toggle = document.getElementById("themeToggle");

    if (toggle) {
        toggle.addEventListener("click", event => {
            event.stopImmediatePropagation();

            const next =
                document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";

            applyTheme(next);

            try {
                localStorage.setItem(THEME_KEY, next);
            } catch {
                // Ignore blocked storage.
            }
        });
    }

    window.addEventListener("storage", event => {
        if (event.key === THEME_KEY && event.newValue) applyTheme(event.newValue);
    });
}

/* ============ HELPERS ============ */

/** Escape HTML-sensitive characters before embedding a value in markup. */
export function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[ch]));
}

/** Format a numeric amount as Philippine pesos. */
export function formatPeso(amount) {
    return new Intl.NumberFormat("en-PH", {
        style: "currency",
        currency: "PHP"
    }).format(Number(amount) || 0);
}

/** Format a valid date for the accountant pages, or return a dash. */
export function formatDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
}

/** Add a temporary status or error toast when the toast stack exists. */
export function showToast(message, type = "success") {
    const stack = document.getElementById("toastStack");
    if (!stack) return;

    const toast = document.createElement("div");
    toast.className = `toast${type === "error" ? " toast--error" : ""}`;
    toast.setAttribute("role", type === "error" ? "alert" : "status");
    toast.textContent = message;
    stack.appendChild(toast);

    setTimeout(() => toast.remove(), 4000);
}

/* ============ PAGE INIT ============ */

function setupHeader(user) {
    const todayLabel = document.getElementById("todayLabel");

    if (todayLabel) {
        todayLabel.textContent = new Date().toLocaleDateString("en-PH", {
            weekday: "short",
            month: "short",
            day: "numeric"
        });
    }

    const fullName =
        user.user_metadata?.full_name ||
        user.user_metadata?.fullName ||
        user.email?.split("@")[0] ||
        "Accountant";

    const userName = document.getElementById("userName");
    const userInitial = document.getElementById("userInitial");

    if (userName) userName.textContent = fullName;
    if (userInitial) userInitial.textContent = fullName.trim().charAt(0).toUpperCase();
}

function setupLogout() {
    const button = document.getElementById("logoutBtn");
    if (!button) return;

    button.addEventListener("click", async () => {
        if (button.disabled) return;

        button.disabled = true;
        button.textContent = "Logging out...";

        try {
            // Sign out from Supabase.
            const { error } = await supabase.auth.signOut();

            if (error) throw error;

            // Replace current history entry.
            window.location.replace(LOGIN_URL);

        } catch (error) {
            console.error("Logout failed:", error);

            button.disabled = false;
            button.textContent = "Logout";

            showToast("Unable to log out. Please try again.", "error");
        }
    });
}

/* ============ SESSION GUARD ============ */

let sessionGuardReady = false;

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
            console.error("Session validation failed:", error);
            window.location.replace(LOGIN_URL);
        }
    });
    window.addEventListener("pagehide", () => {
        // Prevent protected page from being restored from bfcache.
        // This does not sign out the user.
    });
    supabase.auth.onAuthStateChange(event => {
        if (event === "SIGNED_OUT") {
            window.location.replace(LOGIN_URL);
        }
    });
}

/**
 * Runs theme, auth guard, header and logout.
 * Redirects to login if not signed in / not an active Accountant.
 * Returns { user, profile } or null (after redirect).
 */
export async function initAccountantPage() {
    initializeTheme();
    setupLogout();
    setupSessionGuard();

    try {
        const {
            data: { user },
            error: authError
        } = await supabase.auth.getUser();

        console.log("Accountant authentication:", {
            userId: user?.id,
            authError
        });

        if (authError || !user) {
            window.location.replace(LOGIN_URL);
            return null;
        }

        const { data: profile, error: profileError } = await supabase
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
            role === "accountant" &&
            ["active", "approved"].includes(status);

        console.log("Accountant access validation:", {
            userId: user.id,
            role,
            status,
            authorized
        });

        // Do not sign out a valid Supabase session just because
        // the profile authorization check failed.
        if (!authorized) {
            console.error("Accountant access denied:", profile);

            document.body.innerHTML = `
                <main style="padding:40px;text-align:center">
                    <h2>Access Denied</h2>
                    <p>Your account is not authorized to access this page.</p>
                    <button onclick="location.replace('../../login.html')">
                        Return to Login
                    </button>
                </main>
            `;

            return null;
        }

        setupHeader(user);

        return { user, profile };

    } catch (error) {
        console.error("Accountant initialization failed:", error);

        throw error;
    }
}