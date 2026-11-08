import { supabase } from "../connection.js";
const _origSignOut = supabase.auth.signOut.bind(supabase.auth);
supabase.auth.signOut = (...args) => {
    alert("signOut called from:\n" + new Error().stack);
    return _origSignOut(...args);
};
/* ============================================================
   ACCOUNTANT - shared module
   Theme, auth guard (role: "Accountant"), logout, toast, formatters.
   Gamitin sa bawat accountant page:
     import { initAccountantPage } from "./accountant-common.js";
     const { user } = await initAccountantPage();
   ============================================================ */

const THEME_KEY = "theme";
const LOGIN_URL = "../../login.html";
const ACCOUNTANT_ROLE = "Accountant";

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
            console.error("Logout failed:", error);
            button.disabled = false;
            button.innerHTML = defaultHTML;
            showToast("Unable to log out. Please try again.", "error");
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

    const {
        data: { user },
        error: authError
    } = await supabase.auth.getUser();

    console.log("auth:", { userId: user?.id, authError });

    if (authError || !user) {
        window.location.replace(LOGIN_URL);
        return null;
    }

    const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("id, role, status")
        .eq("id", user.id)
        .maybeSingle();

    console.log("profile:", { profile, profileError });

    if (profileError) throw profileError;

    const role = String(profile?.role ?? "").trim().toLowerCase();
    const statusOk = ["active", "approved"].includes(profile?.status);

    if (!profile || role !== "accountant" || !statusOk) {
        console.warn("Accountant access denied:", { profile });
        await supabase.auth.signOut();
        window.location.replace(LOGIN_URL);
        return null;
    }

    setupHeader(user);

    return { user, profile };
}