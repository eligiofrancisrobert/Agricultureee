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

const recommendationList = document.getElementById("recommendationList");
const searchInput = document.getElementById("recommendationSearch");
const sourceFilter = document.getElementById("recommendationSource");

const totalRecommendations = document.getElementById("totalRecommendations");
const monitoringCount = document.getElementById("monitoringCount");
const inspectionCount = document.getElementById("inspectionCount");

const farmerName = document.getElementById("farmerName");
const farmerAvatar = document.getElementById("farmerAvatar");
const logoutButton = document.getElementById("logoutButton");
const logoutLabel = document.getElementById("logoutLabel");
const todayLabel = document.getElementById("todayLabel");

let recommendations = [];
let currentUser = null;
let canViewRecommendations = false;

const permissionCache = new Map();

// ---------- FARMER NAVIGATION PERMISSIONS ----------

const FARMER_NAVIGATION_PERMISSIONS = {
    "farmer-dashboard.html": "dashboard.view",
    "activities.html": "activities.view",
    "plantings.html": "plantings.view",
    "recommendations.html": "recommendations.view",
    "harvest-records.html": "harvest_records.view"
};

// ---------- PERMISSIONS ----------

async function hasPermission(permissionKey) {
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

        if (error) throw error;

        const allowed = data === true;
        permissionCache.set(permissionKey, allowed);

        return allowed;

    } catch (error) {
        console.error(
            `Permission check failed (${permissionKey}):`,
            error
        );

        permissionCache.set(permissionKey, false);
        return false;
    }
}

/**
 * Checks all Farmer navigation permissions.
 * Disabled pages are hidden from the sidebar and Quick Access,
 * regardless of which Farmer page is currently open.
 */
async function applyNavigationPermissions() {
    const entries = Object.entries(FARMER_NAVIGATION_PERMISSIONS);

    const results = await Promise.all(
        entries.map(async ([page, permissionKey]) => ({
            page,
            allowed: await hasPermission(permissionKey)
        }))
    );

    const permissionMap = new Map(
        results.map(result => [result.page, result.allowed])
    );

    document.querySelectorAll(
        ".navigation a.nav-link[href], " +
        ".quick-access a.access-card[href]"
    ).forEach(link => {
        const href = link.getAttribute("href");

        if (!href) return;

        let page;

        try {
            page = new URL(href, window.location.href)
                .pathname
                .split("/")
                .pop()
                .toLowerCase();
        } catch {
            return;
        }

        if (!Object.hasOwn(FARMER_NAVIGATION_PERMISSIONS, page)) {
            return;
        }

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

function showAccessDenied() {
    if (recommendationList) {
        recommendationList.innerHTML = `
            <div class="loading-state">
                You do not have permission to view recommendations.
                Please contact your Administrator.
            </div>
        `;
    }

    if (totalRecommendations) totalRecommendations.textContent = "0";
    if (monitoringCount) monitoringCount.textContent = "0";
    if (inspectionCount) inspectionCount.textContent = "0";
}

// ---------- HELPERS ----------

function escapeHTML(value = "") {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[character]);
}

function formatDate(value) {
    if (!value) return "Date not specified";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "Date not specified";

    return date.toLocaleDateString("en-PH", {
        year: "numeric",
        month: "long",
        day: "numeric"
    });
}

function getCropName(planting) {
    return planting?.crop_name ||
        planting?.crop_type ||
        planting?.crop ||
        planting?.plant_name ||
        "Crop";
}

function getStatus(value) {
    return String(value || "").trim().toLowerCase();
}

function getFarmerDisplayName(user, profile) {
    return (
        user.user_metadata?.full_name ||
        user.user_metadata?.fullName ||
        profile?.full_name ||
        profile?.fullName ||
        user.email?.split("@")[0] ||
        "Farmer"
    );
}

// ---------- FARMER PROFILE ----------

async function loadFarmerProfile(user) {
    const { data: profile, error } = await supabase
        .from("profiles")
        .select("id, role, status")
        .eq("id", user.id)
        .maybeSingle();

    if (error) {
        console.error("Profile loading error:", error);
        throw new Error("Unable to verify your Farmer account.");
    }

    if (!profile || profile.role !== "farmer") {
        window.location.replace("../../login.html");
        return null;
    }

    const accountStatus = String(profile.status || "").toLowerCase();

    if (!["active", "approved"].includes(accountStatus)) {
        await supabase.auth.signOut();
        window.location.replace("../../login.html");
        return null;
    }

    const name = getFarmerDisplayName(user, profile);

    if (farmerName) farmerName.textContent = name;

    if (farmerAvatar) {
        farmerAvatar.textContent = name.charAt(0).toUpperCase();
    }

    return profile;
}

// ---------- SUMMARY ----------

function updateSummary() {
    if (totalRecommendations) {
        totalRecommendations.textContent = recommendations.length;
    }

    if (monitoringCount) {
        monitoringCount.textContent = recommendations.filter(
            item => item.source === "monitoring"
        ).length;
    }

    if (inspectionCount) {
        inspectionCount.textContent = recommendations.filter(
            item => item.source === "inspection"
        ).length;
    }
}

// ---------- RENDER RECOMMENDATIONS ----------

function renderRecommendations() {
    if (!recommendationList) return;

    const searchTerm = searchInput?.value.trim().toLowerCase() || "";
    const selectedSource = sourceFilter?.value || "all";

    const filtered = recommendations.filter(item => {
        const matchesSource =
            selectedSource === "all" ||
            item.source === selectedSource;

        const searchableText = [
            item.title,
            item.cropName,
            item.recommendation,
            item.observations,
            item.findings,
            item.growthStage,
            item.health,
            item.pestDetails,
            item.diseaseDetails,
            item.sourceLabel
        ].join(" ").toLowerCase();

        return matchesSource && searchableText.includes(searchTerm);
    });

    if (!filtered.length) {
        recommendationList.innerHTML = `
            <div class="loading-state">
                No recommendations found.
            </div>
        `;
        return;
    }

    recommendationList.innerHTML = filtered.map(item => `
        <article class="recommendation-card">

            <div class="recommendation-card-header">
                <h3>${escapeHTML(item.cropName)} - ${escapeHTML(item.title)}</h3>

                <span class="recommendation-tag">
                    ${escapeHTML(item.sourceLabel)}
                </span>
            </div>

            <div class="recommendation-meta">

                <span class="recommendation-tag">
                    ${escapeHTML(formatDate(item.date))}
                </span>

                ${item.growthStage ? `
                    <span class="recommendation-tag">
                        Growth: ${escapeHTML(item.growthStage)}
                    </span>
                ` : ""}

                ${item.health ? `
                    <span class="recommendation-tag">
                        Condition: ${escapeHTML(item.health)}
                    </span>
                ` : ""}

            </div>

            ${item.recommendation ? `
                <div class="recommendation-section">
                    <strong>Recommended Action</strong>
                    <p>${escapeHTML(item.recommendation)}</p>
                </div>
            ` : ""}

            ${item.observations ? `
                <div class="recommendation-section">
                    <strong>Observations</strong>
                    <p>${escapeHTML(item.observations)}</p>
                </div>
            ` : ""}

            ${item.findings ? `
                <div class="recommendation-section">
                    <strong>Inspection Findings</strong>
                    <p>${escapeHTML(item.findings)}</p>
                </div>
            ` : ""}

            ${item.pestDetails ? `
                <div class="recommendation-section">
                    <strong>Pest Observed</strong>
                    <p>${escapeHTML(item.pestDetails)}</p>
                </div>
            ` : ""}

            ${item.diseaseDetails ? `
                <div class="recommendation-section">
                    <strong>Disease Observed</strong>
                    <p>${escapeHTML(item.diseaseDetails)}</p>
                </div>
            ` : ""}

            ${item.actionRequired ? `
                <div class="recommendation-section">
                    <strong>Action Required</strong>
                    <p>Please review the Agricultural Technician's recommendation.</p>
                </div>
            ` : ""}

        </article>
    `).join("");
}

// ---------- LOAD RECOMMENDATIONS ----------

async function loadRecommendations() {
    if (!canViewRecommendations || !currentUser) return;

    if (recommendationList) {
        recommendationList.innerHTML = `
            <div class="loading-state">Loading recommendations...</div>
        `;
    }

    // 1. Retrieve the current farmer's plantings.
    const { data: plantings, error: plantingError } = await supabase
        .from("farm_plantings")
        .select("*")
        .eq("farmer_id", currentUser.id);

    if (plantingError) throw plantingError;

    const plantingIds = (plantings || [])
        .map(planting => planting.id)
        .filter(Boolean);

    if (!plantingIds.length) {
        recommendations = [];
        updateSummary();

        if (recommendationList) {
            recommendationList.innerHTML = `
                <div class="loading-state">
                    No plantings are currently linked to your account.
                </div>
            `;
        }

        return;
    }

    const plantingMap = new Map(
        plantings.map(planting => [planting.id, planting])
    );

    // 2. Retrieve crop monitoring and inspection records together.
    const [monitoringResult, inspectionResult] = await Promise.all([
        supabase
            .from("agricultural_technician_crop_monitoring")
            .select("*")
            .in("planting_id", plantingIds)
            .in("monitoring_status", ["submitted", "reviewed"])
            .order("monitoring_date", { ascending: false }),

        supabase
            .from("agricultural_inspections")
            .select("*")
            .in("planting_id", plantingIds)
            .order("inspection_date", { ascending: false })
    ]);

    if (monitoringResult.error) throw monitoringResult.error;
    if (inspectionResult.error) throw inspectionResult.error;

    const monitoringRecords = monitoringResult.data || [];
    const inspectionRecords = inspectionResult.data || [];

    // 3. Format monitoring recommendations.
    const monitoringItems = monitoringRecords.map(record => {
        const planting = plantingMap.get(record.planting_id);

        return {
            id: record.monitoring_id,
            source: "monitoring",
            sourceLabel: "Crop Monitoring",

            title: "Crop Monitoring Recommendation",

            cropName: getCropName(planting),
            plantingId: record.planting_id,

            date: record.monitoring_date,

            growthStage: record.growth_stage,
            health: record.crop_health_status,

            recommendation: record.recommended_action,
            observations: record.observations,

            pestDetails: record.pest_observed
                ? record.pest_details || "Pest observed"
                : "",

            diseaseDetails: record.disease_observed
                ? record.disease_details || "Disease observed"
                : "",

            actionRequired: record.action_required
        };
    });

    // 4. Format submitted/finalized inspection recommendations.
    const inspectionItems = inspectionRecords
        .filter(record => {
            const status = getStatus(record.inspection_status);

            return status !== "draft" &&
                status !== "cancelled" &&
                status !== "deleted";
        })
        .map(record => {
            const planting = plantingMap.get(record.planting_id);

            return {
                id: record.inspection_id,
                source: "inspection",
                sourceLabel: "Farm Inspection",

                title: record.inspection_type
                    ? `${record.inspection_type} Inspection`
                    : "Farm Inspection",

                cropName: getCropName(planting),
                plantingId: record.planting_id,

                date: record.inspection_date,

                health: record.overall_condition,

                recommendation: record.recommended_action,
                observations: record.observations,
                findings: record.findings,

                actionRequired: record.action_required
            };
        });

    // 5. Combine both sources, newest first.
    recommendations = [
        ...monitoringItems,
        ...inspectionItems
    ].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    updateSummary();
    renderRecommendations();
}

// ---------- EVENT LISTENERS ----------

searchInput?.addEventListener("input", renderRecommendations);
sourceFilter?.addEventListener("change", renderRecommendations);

// ---------- LOGOUT ----------

function initializeLogout() {
    if (!logoutButton) return;

    logoutButton.addEventListener("click", async () => {
        if (logoutLabel) logoutLabel.textContent = "Logging out...";

        logoutButton.disabled = true;

        const { error } = await supabase.auth.signOut();

        if (error) {
            console.error("Logout error:", error);

            if (logoutLabel) logoutLabel.textContent = "Log out";

            logoutButton.disabled = false;
            return;
        }

        window.location.replace("../../login.html");
    });
}

// ---------- COMING SOON ----------

document.querySelectorAll("[data-coming-soon]").forEach(link => {
    link.addEventListener("click", event => {
        event.preventDefault();
        alert("This feature is not yet available.");
    });
});

// ---------- INITIALIZATION ----------

async function initializeFarmerRecommendations() {
    document.body.classList.add("permissions-loading");

    try {
        initializeLogout();

        if (todayLabel) {
            todayLabel.textContent = new Date().toLocaleDateString("en-PH", {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric"
            });
        }

        const {
            data: { user },
            error
        } = await supabase.auth.getUser();

        if (error || !user) {
            window.location.replace("../../login.html");
            return;
        }

        currentUser = user;

        const profile = await loadFarmerProfile(user);

        if (!profile) return;

        // Check all sidebar permissions first.
        await applyNavigationPermissions();

        // Check this page's own permission.
        canViewRecommendations = await hasPermission("recommendations.view");

        if (!canViewRecommendations) {
            showAccessDenied();
            return;
        }

        await loadRecommendations();

    } catch (error) {
        console.error("Farmer Recommendations Initialization Error:", error);

        if (recommendationList) {
            recommendationList.innerHTML = `
                <div class="loading-state">
                    Unable to load recommendations.
                    <br><br>
                    ${escapeHTML(error.message)}
                </div>
            `;
        }

    } finally {
        document.body.classList.remove("permissions-loading");
    }
}

initializeFarmerRecommendations();