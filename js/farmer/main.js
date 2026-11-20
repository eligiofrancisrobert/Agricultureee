
import { supabase } from "../connection.js";

// ---------- THEME ----------

const THEME_KEY = "theme";

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

(function initializeTheme() {
    applyTheme(readSavedTheme());

    const toggle = document.getElementById("themeToggle");

    toggle?.addEventListener("click", event => {
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

    window.addEventListener("storage", event => {
        if (event.key === THEME_KEY && event.newValue) {
            applyTheme(event.newValue);
        }
    });
})();

// ---------- ELEMENTS ----------

const farmerName = document.getElementById("farmerName");
const welcomeName = document.getElementById("welcomeName");
const farmerAvatar = document.getElementById("farmerAvatar");
const logoutButton = document.getElementById("logoutButton");
const todayLabel = document.getElementById("todayLabel");
const mainContent = document.querySelector(".main-content");

const logoutDefaultHTML = logoutButton?.innerHTML || "";

let currentUser = null;

// ---------- FARMER PERMISSIONS ----------

const FARMER_PAGE_PERMISSIONS = {
    "farmer-dashboard.html": "dashboard.view",
    "activities.html": "activities.view",
    "plantings.html": "plantings.view",
    "recommendations.html": "recommendations.view",
    "harvest-records.html": "harvest_records.view"
};

const permissionCache = new Map();

function getCurrentPage() {
    return window.location.pathname
        .split("/")
        .pop()
        .toLowerCase();
}

function getPermissionForPage(page) {
    return FARMER_PAGE_PERMISSIONS[page] || null;
}

/**
 * Checks the effective permission from Supabase.
 * Errors are denied by default.
 */
export async function hasFarmerPermission(permissionKey) {
    if (!permissionKey) return false;

    if (permissionCache.has(permissionKey)) {
        return permissionCache.get(permissionKey);
    }

    try {
        const { data, error } = await supabase.rpc(
            "has_tanikala_permission",
            {
                p_permission_key: permissionKey
            }
        );

        if (error) {
            console.error(
                `Permission check failed (${permissionKey}):`,
                error
            );

            permissionCache.set(permissionKey, false);
            return false;
        }

        const allowed = data === true;

        permissionCache.set(permissionKey, allowed);

        return allowed;

    } catch (error) {
        console.error(
            `Permission check error (${permissionKey}):`,
            error
        );

        permissionCache.set(permissionKey, false);
        return false;
    }
}

/**
 * Checks all Farmer page permissions and hides
 * unauthorized sidebar and Quick Access links.
 */
async function applyFarmerNavigationPermissions() {
    const entries = Object.entries(FARMER_PAGE_PERMISSIONS);

    const results = await Promise.all(
        entries.map(async ([page, permission]) => ({
            page,
            allowed: await hasFarmerPermission(permission)
        }))
    );

    const permissionMap = new Map(
        results.map(item => [item.page, item.allowed])
    );

    document.querySelectorAll(
        ".navigation a.nav-link[href], " +
        ".quick-access a.access-card[href]"
    ).forEach(link => {
        const href = link.getAttribute("href");

        if (!href) return;

        const page = href.split("?")[0].split("#")[0].split("/").pop();

        const permission = FARMER_PAGE_PERMISSIONS[page];

        // Do not modify unrelated links.
        if (!permission) return;

        const allowed = permissionMap.get(page) === true;

        link.hidden = !allowed;
        link.style.display = allowed ? "" : "none";

        if (allowed) {
            link.removeAttribute("aria-hidden");
            link.removeAttribute("tabindex");
        } else {
            link.setAttribute("aria-hidden", "true");
            link.setAttribute("tabindex", "-1");
        }
    });

    return permissionMap;
}

// ---------- ACCESS CONTROL ----------

function showAccessDenied() {
    if (!mainContent) return;

    mainContent.innerHTML = `
        <section class="information-section">
            <div>
                <h2>Access Restricted</h2>
                <p>
                    You do not have permission to access this page.
                    Please contact your Administrator.
                </p>
            </div>
        </section>
    `;
}

/**
 * Reusable initialization for every Farmer page.
 * Checks authentication, account status, navigation,
 * and permission to access the current page.
 */
export async function initializeFarmerPermissions() {
    document.body.classList.add("permissions-loading");

    try {
        const {
            data: { user },
            error: authError
        } = await supabase.auth.getUser();

        if (authError || !user) {
            window.location.replace("../../login.html");
            return false;
        }

        currentUser = user;

        const { data: profile, error: profileError } = await supabase
            .from("profiles")
            .select("id, role, status")
            .eq("id", user.id)
            .maybeSingle();

        if (profileError) throw profileError;

        if (
            !profile ||
            profile.role !== "farmer" ||
            !["active", "approved"].includes(profile.status)
        ) {
            await supabase.auth.signOut();
            window.location.replace("../../login.html");
            return false;
        }

        // Farmer profile information.
        const fullName =
            user.user_metadata?.full_name ||
            user.user_metadata?.fullName ||
            user.email?.split("@")[0] ||
            "Farmer";

        const firstName = fullName.trim().split(/\s+/)[0];

        if (farmerName) farmerName.textContent = fullName;
        if (welcomeName) welcomeName.textContent = firstName;

        if (farmerAvatar) {
            farmerAvatar.textContent = firstName.charAt(0).toUpperCase();
        }

        // Update date when the element exists.
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

        // Check every Farmer page permission.
        const permissionMap =
            await applyFarmerNavigationPermissions();

        // Check permission for the currently opened page.
        const currentPage = getCurrentPage();
        const currentPermission = getPermissionForPage(currentPage);

        if (currentPermission) {
            const allowed =
                permissionMap.get(currentPage) === true;

            if (!allowed) {
                showAccessDenied();
                return false;
            }
        }

        return true;

    } catch (error) {
        console.error(
            "Farmer permission initialization failed:",
            error
        );

        if (mainContent) {
            mainContent.innerHTML = `
                <div class="error-message">
                    <h2>Unable to load this page</h2>
                    <p>
                        Please refresh the page or log in again.
                    </p>
                </div>
            `;
        }

        return false;

    } finally {
        document.body.classList.remove("permissions-loading");
    }
}

// ---------- LOGOUT ----------

async function logout() {
    if (!currentUser || !logoutButton || logoutButton.disabled) return;

    logoutButton.disabled = true;
    logoutButton.textContent = "Logging out...";

    try {
        const { error } = await supabase.auth.signOut();

        if (error) throw error;

        window.location.replace("../../login.html");

    } catch (error) {
        console.error("Logout failed:", error);

        logoutButton.disabled = false;
        logoutButton.innerHTML = logoutDefaultHTML;

        alert("Unable to log out. Please try again.");
    }
}

logoutButton?.addEventListener("click", logout);

// ---------- COMING SOON ----------

document.querySelectorAll("[data-coming-soon]").forEach(link => {
    link.addEventListener("click", event => {
        event.preventDefault();
        alert("This feature is not yet available.");
    });
});

// ---------- INITIALIZE ----------

initializeFarmerPermissions();
