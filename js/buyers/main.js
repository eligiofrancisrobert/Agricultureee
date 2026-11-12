
import { supabase } from "../connection.js";

/* ============================================================
   BUYER - shared module
   Theme, authentication guard, logout, toast and formatters.

   Directly reference this file in every Buyer HTML:
   <script type="module" src="../js/buyers/main.js"></script>
   ============================================================ */

const THEME_KEY = "theme";
const LOGIN_URL = "../../login.html";
const BUYER_ROLE = "buyer";

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

    if (toggle) {
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

/* ============ AUTHENTICATION ============ */

async function initializeBuyer() {
    initializeTheme();
    setupLogout();

    try {
        const {
            data: { user },
            error: authError
        } = await supabase.auth.getUser();

        if (authError || !user) {
            window.location.replace(LOGIN_URL);
            return;
        }

        const {
            data: profile,
            error: profileError
        } = await supabase
            .from("profiles")
            .select("id, role, status")
            .eq("id", user.id)
            .maybeSingle();

        if (profileError) throw profileError;

        const role = String(profile?.role ?? "")
            .trim()
            .toLowerCase();

        const status = String(profile?.status ?? "")
            .trim()
            .toLowerCase();

        const statusOk = ["active", "approved"].includes(status);

        if (!profile || role !== BUYER_ROLE || !statusOk) {
            console.warn("Buyer access denied:", profile);

            await supabase.auth.signOut();

            window.location.replace(LOGIN_URL);
            return;
        }

        setupHeader(user);

        console.log("Buyer authenticated:", {
            userId: user.id,
            profile
        });

    } catch (error) {
        console.error("Buyer initialization failed:", error);

        showToast(
            "Unable to initialize your account. Please log in again.",
            "error"
        );

        window.location.replace(LOGIN_URL);
    }
}

/* ============ AUTOMATIC INITIALIZATION ============ */

initializeBuyer();
