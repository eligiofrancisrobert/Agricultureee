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
})();

// ---------- ELEMENTS ----------

const plantingList = document.getElementById("plantingList");
const farmerName = document.getElementById("farmerName");
const farmerAvatar = document.getElementById("farmerAvatar");
const logoutButton = document.getElementById("logoutButton");
const logoutLabel = document.getElementById("logoutLabel");
const todayLabel = document.getElementById("todayLabel");

let currentUser = null;
let plantingActivityStatuses = [];
let cropStatuses = [];
let plantingRealtimeChannel = null;
let plantingReloadTimer = null;

let canViewPlantings = false;
let canEditPlantings = false;

// Pagination
const PAGE_SIZE = 6;
let currentPage = 1;
let allPlantings = [];
let fieldsMap = new Map();
let farmsMap = new Map();

// Latest assignment date per planting
let assignmentDatesMap = new Map();

// ---------- PLANTING CARD SORTING ----------

const ACTIVITY_STATUS_ORDER = [
    "assigned",
    "accepted",
    "preparing",
    "awaiting_supplies",
    "ready_to_plant",
    "in_progress",
    "completed",
    "cancelled"
];

const activityStatusOrderMap = new Map(
    ACTIVITY_STATUS_ORDER.map((status, index) => [
        status,
        index
    ])
);

const paginationNav = document.createElement("nav");
paginationNav.className = "pagination";
paginationNav.setAttribute("aria-label", "Planting records pages");

if (plantingList) {
    plantingList.after(paginationNav);
}

const paginationStyle = document.createElement("style");
paginationStyle.textContent = `
    .pagination {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: center;
        gap: 0.75rem;
        margin: 1.25rem 0;
    }
    .pagination:empty { display: none; }
    .pagination-info { font-size: 0.9rem; opacity: 0.8; }
    .pagination-button {
        padding: 0.45rem 0.9rem;
        border: 1px solid currentColor;
        border-radius: 0.5rem;
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
    }
    .pagination-button:hover:not(:disabled) { opacity: 0.75; }
    .pagination-button:disabled { opacity: 0.4; cursor: not-allowed; }
`;
document.head.append(paginationStyle);

// ---------- HELPERS ----------

function createElement(tag, className = "", text = "") {
    const element = document.createElement(tag);

    if (className) element.className = className;
    if (text) element.textContent = text;

    return element;
}

function toStatusClass(status) {
    return String(status || "unknown")
        .toLowerCase()
        .trim()
        .replaceAll("_", "-")
        .replaceAll(" ", "-");
}

function formatDate(dateValue) {
    if (!dateValue) return "Not specified";

    const date = new Date(dateValue);

    if (Number.isNaN(date.getTime())) {
        return "Not specified";
    }

    return date.toLocaleDateString("en-PH", {
        year: "numeric",
        month: "short",
        day: "numeric"
    });
}

function getDateTimestamp(dateValue) {
    if (!dateValue) return 0;

    const timestamp = new Date(dateValue).getTime();

    return Number.isNaN(timestamp) ? 0 : timestamp;
}

function displayMessage(message, className = "empty-state") {
    if (paginationNav) {
        paginationNav.replaceChildren();
    }

    if (plantingList) {
        plantingList.replaceChildren(
            createElement("div", className, message)
        );
    }
}

function createDetail(label, value) {
    const wrapper = createElement("div", "detail");

    wrapper.append(
        createElement("span", "detail-label", label),
        createElement("span", "detail-value", value || "Not specified")
    );

    return wrapper;
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

// ---------- PERMISSIONS ----------

const FARMER_NAVIGATION_PERMISSIONS = {
    "farmer-dashboard.html": "dashboard.view",
    "activities.html": "activities.view",
    "plantings.html": "plantings.view",
    "recommendations.html": "recommendations.view",
    "harvest-records.html": "harvest_records.view"
};

const permissionCache = new Map();

async function checkPermission(permissionKey) {
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

async function loadPlantingPermissions() {
    const [viewPermission, editPermission] = await Promise.all([
        checkPermission("plantings.view"),
        checkPermission("plantings.edit")
    ]);

    canViewPlantings = viewPermission;
    canEditPlantings = editPermission;

    return canViewPlantings;
}

async function applyNavigationPermissions() {
    const entries = Object.entries(
        FARMER_NAVIGATION_PERMISSIONS
    );

    const results = await Promise.all(
        entries.map(async ([page, permissionKey]) => ({
            page,
            allowed: await checkPermission(permissionKey)
        }))
    );

    const permissionMap = new Map(
        results.map(result => [
            result.page,
            result.allowed
        ])
    );

    const navigationLinks = document.querySelectorAll(
        ".navigation a.nav-link[href], " +
        ".quick-access a.access-card[href]"
    );

    navigationLinks.forEach(link => {
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

function hidePermissionsLoading() {
    document.body.classList.remove("permissions-loading");
}

function showAccessDenied() {
    cleanupPlantingRealtime();

    displayMessage(
        "You do not have permission to view planting records. Please contact your Farm Manager or Administrator.",
        "empty-state"
    );

    if (paginationNav) {
        paginationNav.replaceChildren();
    }
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

// ---------- STATUS OPTIONS ----------

async function loadPlantingStatusOptions() {
    const [activityResult, cropResult] = await Promise.all([
        supabase
            .from("planting_activity_statuses")
            .select("code, label, description")
            .eq("is_active", true)
            .order("display_order"),

        supabase
            .from("crop_statuses")
            .select("code, label, description")
            .eq("is_active", true)
            .order("display_order")
    ]);

    if (activityResult.error) {
        throw activityResult.error;
    }

    if (cropResult.error) {
        throw cropResult.error;
    }

    plantingActivityStatuses = activityResult.data || [];
    cropStatuses = cropResult.data || [];
}

// ---------- FARM LOOKUP ----------

async function loadFarms(farmIds) {
    const uniqueFarmIds = [...new Set(farmIds.filter(Boolean))];

    if (!uniqueFarmIds.length) return new Map();

    const { data: farms, error } = await supabase
        .from("farmer_farms")
        .select("id, farm_name, farm_location")
        .in("id", uniqueFarmIds);

    if (error) {
        console.error("Farm loading error:", error);
        throw new Error("Unable to load the associated farm information.");
    }

    return new Map(
        (farms || []).map(farm => [farm.id, farm])
    );
}

// ---------- ASSIGNMENT DATE LOOKUP ----------

async function loadAssignmentDates(plantingIds) {
    const uniquePlantingIds = [
        ...new Set(plantingIds.filter(Boolean))
    ];

    if (!uniquePlantingIds.length) {
        return new Map();
    }

    const { data: assignments, error } = await supabase
        .from("farm_actions")
        .select("planting_id, created_at")
        .eq("farmer_id", currentUser.id)
        .in("planting_id", uniquePlantingIds)
        .not("planting_id", "is", null)
        .order("created_at", { ascending: false });

    if (error) {
        console.error("Assignment date loading error:", error);

        throw new Error(
            "Unable to load assignment dates for your planting records."
        );
    }

    const latestDates = new Map();

    (assignments || []).forEach(assignment => {
        if (!assignment.planting_id || !assignment.created_at) {
            return;
        }

        const existingDate = latestDates.get(assignment.planting_id);

        const newTimestamp = getDateTimestamp(assignment.created_at);
        const existingTimestamp = getDateTimestamp(existingDate);

        if (
            !existingDate ||
            newTimestamp > existingTimestamp
        ) {
            latestDates.set(
                assignment.planting_id,
                assignment.created_at
            );
        }
    });

    return latestDates;
}

// ---------- LOAD LINKED PLANTINGS ----------

async function loadPlantings(plantingIds) {
    const uniquePlantingIds = [...new Set(plantingIds.filter(Boolean))];

    if (!uniquePlantingIds.length) return new Map();

    const { data: plantings, error } = await supabase
        .from("farm_plantings")
        .select(`
            id,
            field_id,
            product_id,
            sowing_date,
            expected_harvest_date,
            status,
            notes,
            crop_name,
            activity_status,
            crop_status
        `)
        .in("id", uniquePlantingIds)
        .order("sowing_date", { ascending: true });

    if (error) {
        console.error("Plantings loading error:", error);
        throw new Error("Unable to load your planting records.");
    }

    return new Map(
        (plantings || []).map(planting => [planting.id, planting])
    );
}

// ---------- STATUS DROPDOWN ----------

function createStatusDropdown(label, statuses, currentValue, onChange) {
    const wrapper = createElement("div", "detail");

    const labelElement = createElement(
        "span",
        "detail-label",
        label
    );

    const select = createElement("select", "status-select");

    statuses.forEach(status => {
        const option = document.createElement("option");

        option.value = status.code;
        option.textContent = status.label;
        option.title = status.description || "";

        select.append(option);
    });

    if (
        currentValue &&
        !statuses.some(status => status.code === currentValue)
    ) {
        const currentOption = document.createElement("option");

        currentOption.value = currentValue;
        currentOption.textContent =
            `${currentValue.replaceAll("_", " ")} (Inactive)`;
        currentOption.selected = true;

        select.append(currentOption);
    }

    select.value = currentValue || "";

    const feedback = createElement(
        "small",
        "status-save-message"
    );

    select.addEventListener("change", async () => {
        if (!canEditPlantings) {
            select.value = currentValue || "";
            return;
        }

        feedback.textContent = "Saving...";
        feedback.className = "status-save-message";

        select.disabled = true;

        try {
            await onChange(select.value, select, feedback);
        } finally {
            select.disabled = false;
        }
    });

    wrapper.append(labelElement, select, feedback);

    return wrapper;
}

// ---------- SAVE PLANTING STATUS ----------

async function savePlantingStatus(
    planting,
    column,
    newValue,
    select,
    feedback
) {
    if (!canEditPlantings) {
        select.value = planting[column] || "";
        feedback.textContent = "You do not have permission to edit plantings.";
        feedback.className =
            "status-save-message status-save-error";

        return false;
    }

    const previousValue = planting[column];

    if (newValue === previousValue) {
        feedback.textContent = "";
        return false;
    }

    const { data, error } = await supabase
        .from("farm_plantings")
        .update({
            [column]: newValue
        })
        .eq("id", planting.id)
        .eq("farmer_id", currentUser.id)
        .select("id")
        .maybeSingle();

    if (error || !data) {
        console.error("Planting status update error:", error);

        select.value = previousValue;

        feedback.textContent =
            error?.message || "Unable to update this planting status.";

        feedback.className =
            "status-save-message status-save-error";

        return false;
    }

    planting[column] = newValue;

    feedback.textContent = "Status updated successfully.";
    feedback.className =
        "status-save-message status-save-success";

    return true;
}

// ---------- PLANTING CARD ----------

function createPlantingCard(planting, activity, farm) {
    const card = createElement("article", "activity-card");

    const header = createElement("div", "activity-card-header");
    const titleSection = createElement("div");

    titleSection.append(
        createElement(
            "h3",
            "",
            planting.crop_name || "Unnamed Crop"
        ),
        createElement(
            "p",
            "activity-category",
            activity.action_title || "Assigned Activity"
        )
    );

    const statusBadge = createElement(
        "span",
        `activity-status activity-status--${toStatusClass(
            planting.activity_status
        )}`,
        String(planting.activity_status || "Unknown")
            .replaceAll("_", " ")
    );

    header.append(titleSection, statusBadge);
    card.append(header);

    const farmDetails = createElement("div", "activity-details");

    farmDetails.append(
        createDetail("Farm", farm?.farm_name || "Unavailable"),
        createDetail("Location", farm?.farm_location)
    );

    card.append(farmDetails);

    const plantingDetails = createElement("div", "activity-details");

    plantingDetails.append(
        createDetail("Crop", planting.crop_name),
        createDetail("Planting date", formatDate(planting.sowing_date)),
        createDetail(
            "Expected harvest",
            formatDate(planting.expected_harvest_date)
        )
    );

    const assignmentDate = assignmentDatesMap.get(planting.id);

    if (assignmentDate) {
        plantingDetails.append(
            createDetail("Assigned date", formatDate(assignmentDate))
        );
    }

    card.append(plantingDetails);

    if (canEditPlantings) {
        const statusDetails = createElement("div", "activity-details");

        const activityDropdown = createStatusDropdown(
            "Planting Activity Status",
            plantingActivityStatuses,
            planting.activity_status,
            async (newValue, select, feedback) => {
                const saved = await savePlantingStatus(
                    planting,
                    "activity_status",
                    newValue,
                    select,
                    feedback
                );

                if (saved) {
                    statusBadge.textContent =
                        newValue.replaceAll("_", " ");

                    statusBadge.className =
                        `activity-status activity-status--${toStatusClass(newValue)}`;

                    // Re-sort cards after activity status changes.
                    sortPlantings();
                    renderPlantingsPage();
                }
            }
        );

        const cropDropdown = createStatusDropdown(
            "Crop Status",
            cropStatuses,
            planting.crop_status,
            async (newValue, select, feedback) => {
                await savePlantingStatus(
                    planting,
                    "crop_status",
                    newValue,
                    select,
                    feedback
                );
            }
        );

        statusDetails.append(activityDropdown, cropDropdown);
        card.append(statusDetails);
    }

    if (planting.notes) {
        card.append(
            createElement("p", "activity-description", planting.notes)
        );
    }

    return card;
}

// ---------- SORT PLANTINGS ----------

function sortPlantings() {
    allPlantings.sort((a, b) => {
        const statusA = String(a.activity_status || "")
            .toLowerCase()
            .trim();

        const statusB = String(b.activity_status || "")
            .toLowerCase()
            .trim();

        const orderA = activityStatusOrderMap.has(statusA)
            ? activityStatusOrderMap.get(statusA)
            : ACTIVITY_STATUS_ORDER.length;

        const orderB = activityStatusOrderMap.has(statusB)
            ? activityStatusOrderMap.get(statusB)
            : ACTIVITY_STATUS_ORDER.length;

        // First: workflow status order
        if (orderA !== orderB) {
            return orderA - orderB;
        }

        // Second: latest assignment date first
        const assignmentDateA = assignmentDatesMap.get(a.id);
        const assignmentDateB = assignmentDatesMap.get(b.id);

        const timestampA = getDateTimestamp(assignmentDateA);
        const timestampB = getDateTimestamp(assignmentDateB);

        if (timestampA !== timestampB) {
            return timestampB - timestampA;
        }

        // Fallback: latest sowing date first
        return (
            getDateTimestamp(b.sowing_date) -
            getDateTimestamp(a.sowing_date)
        );
    });
}

// ---------- LOAD MY PLANTINGS ----------

async function loadMyPlantings() {
    if (!canViewPlantings || !currentUser) return;

    displayMessage(
        "Loading your planting records...",
        "loading-state"
    );

    const { data: plantings, error } = await supabase
        .from("farm_plantings")
        .select(`
            id,
            farmer_id,
            field_id,
            product_id,
            sowing_date,
            expected_harvest_date,
            status,
            notes,
            crop_name,
            activity_status,
            crop_status
        `)
        .eq("farmer_id", currentUser.id)
        .order("sowing_date", { ascending: true, nullsFirst: false });

    if (error) {
        console.error("Assigned plantings loading error:", error);

        displayMessage(
            "Unable to load your planting records. Please refresh the page.",
            "error-state"
        );

        return;
    }

    if (!plantings || plantings.length === 0) {
        allPlantings = [];
        assignmentDatesMap = new Map();
        currentPage = 1;

        displayMessage(
            "You currently have no planting records assigned to you."
        );

        return;
    }

    const fieldIds = [
        ...new Set(plantings.map(p => p.field_id).filter(Boolean))
    ];

    if (fieldIds.length) {
        const { data: fields, error: fieldError } = await supabase
            .from("farm_fields")
            .select("id, farm_id, field_name")
            .in("id", fieldIds);

        if (fieldError) {
            console.error("Field loading error:", fieldError);

            displayMessage(
                "Unable to load the farm field information.",
                "error-state"
            );

            return;
        }

        fieldsMap = new Map(
            (fields || []).map(field => [field.id, field])
        );
    } else {
        fieldsMap = new Map();
    }

    const farmIds = [
        ...new Set(
            [...fieldsMap.values()]
                .map(field => field.farm_id)
                .filter(Boolean)
        )
    ];

    farmsMap = await loadFarms(farmIds);

    // Get the latest assignment timestamp for every planting.
    assignmentDatesMap = await loadAssignmentDates(
        plantings.map(planting => planting.id)
    );

    allPlantings = plantings;

    // Sort by activity status workflow,
    // then latest assignment date within the same status.
    sortPlantings();

    currentPage = 1;

    renderPlantingsPage();
}

// ---------- PAGINATION ----------

function getTotalPages() {
    return Math.max(1, Math.ceil(allPlantings.length / PAGE_SIZE));
}

function goToPage(page) {
    currentPage = page;
    renderPlantingsPage();

    plantingList.scrollIntoView({
        behavior: "smooth",
        block: "start"
    });
}

function renderPlantingsPage() {
    if (!canViewPlantings) return;

    const totalPages = getTotalPages();

    currentPage = Math.min(Math.max(currentPage, 1), totalPages);

    const start = (currentPage - 1) * PAGE_SIZE;
    const pageItems = allPlantings.slice(start, start + PAGE_SIZE);

    plantingList.replaceChildren();

    pageItems.forEach(planting => {
        const field = fieldsMap.get(planting.field_id);
        const farm = field
            ? farmsMap.get(field.farm_id)
            : null;

        const activity = {
            action_title: field?.field_name
                ? `Field: ${field.field_name}`
                : "Assigned Planting"
        };

        plantingList.append(
            createPlantingCard(planting, activity, farm)
        );
    });

    renderPagination(start, pageItems.length, totalPages);
}

function renderPagination(start, shownCount, totalPages) {
    paginationNav.replaceChildren();

    if (totalPages <= 1) return;

    const previousButton = createElement(
        "button",
        "pagination-button",
        "Previous"
    );

    previousButton.type = "button";
    previousButton.disabled = currentPage === 1;

    previousButton.addEventListener("click", () => {
        goToPage(currentPage - 1);
    });

    const nextButton = createElement(
        "button",
        "pagination-button",
        "Next"
    );

    nextButton.type = "button";
    nextButton.disabled = currentPage === totalPages;

    nextButton.addEventListener("click", () => {
        goToPage(currentPage + 1);
    });

    const info = createElement(
        "span",
        "pagination-info",
        `Page ${currentPage} of ${totalPages} ` +
        `(showing ${start + 1}-${start + shownCount} of ${allPlantings.length})`
    );

    paginationNav.append(previousButton, info, nextButton);
}

// ---------- SUPABASE REALTIME ----------

function schedulePlantingsReload() {
    if (!canViewPlantings) return;

    clearTimeout(plantingReloadTimer);

    plantingReloadTimer = setTimeout(async () => {
        await loadMyPlantings();
    }, 300);
}

function subscribeToPlantingChanges() {
    if (!canViewPlantings || !currentUser) return;

    if (plantingRealtimeChannel) {
        supabase.removeChannel(plantingRealtimeChannel);
    }

    plantingRealtimeChannel = supabase
        .channel(`farmer-plantings-${currentUser.id}`)
        .on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: "farm_plantings",
                filter: `farmer_id=eq.${currentUser.id}`
            },
            () => {
                schedulePlantingsReload();
            }
        )
        .on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: "farm_actions",
                filter: `farmer_id=eq.${currentUser.id}`
            },
            () => {
                schedulePlantingsReload();
            }
        )
        .subscribe(status => {
            if (status === "SUBSCRIBED") {
                console.log("My Plantings Realtime connected.");
            } else if (status === "CHANNEL_ERROR") {
                console.error("My Plantings Realtime connection failed.");
            }
        });
}

function cleanupPlantingRealtime() {
    clearTimeout(plantingReloadTimer);

    if (plantingRealtimeChannel) {
        supabase.removeChannel(plantingRealtimeChannel);
        plantingRealtimeChannel = null;
    }
}

// ---------- LOGOUT ----------

function initializeLogout() {
    if (!logoutButton) return;

    logoutButton.addEventListener("click", async () => {
        if (logoutLabel) {
            logoutLabel.textContent = "Logging out...";
        }

        logoutButton.disabled = true;

        const { error } = await supabase.auth.signOut();

        if (error) {
            console.error("Logout error:", error);

            if (logoutLabel) {
                logoutLabel.textContent = "Log out";
            }

            logoutButton.disabled = false;
            return;
        }

        window.location.replace("../../login.html");
    });
}

// ---------- INITIALIZATION ----------

async function initializeFarmerPlantings() {
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

        // Check all sidebar permissions, including the current page.
        const permissionMap = await applyNavigationPermissions();

        canViewPlantings =
            permissionMap.get("plantings.html") === true;

        canEditPlantings = await checkPermission("plantings.edit");

        if (!canViewPlantings) {
            showAccessDenied();
            return;
        }

        await loadPlantingStatusOptions();
        await loadMyPlantings();

        subscribeToPlantingChanges();

    } catch (error) {
        console.error("Farmer Plantings Initialization Error:", error);

        displayMessage(
            error.message || "Something went wrong while loading the page.",
            "error-state"
        );
    } finally {
        document.body.classList.remove("permissions-loading");
    }
}

initializeFarmerPlantings();

window.addEventListener("beforeunload", cleanupPlantingRealtime);