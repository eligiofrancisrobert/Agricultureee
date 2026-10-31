
import { supabase } from "../connection.js";

const plantingList = document.getElementById("plantingList");
const farmerName = document.getElementById("farmerName");
const farmerAvatar = document.getElementById("farmerAvatar");
const logoutButton = document.getElementById("logoutButton");
const logoutLabel = document.getElementById("logoutLabel");
const todayLabel = document.getElementById("todayLabel");
const themeToggle = document.getElementById("themeToggle");

let currentUser = null;
let plantingActivityStatuses = [];
let cropStatuses = [];
let plantingRealtimeChannel = null;
let plantingReloadTimer = null;
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

function displayMessage(message, className = "empty-state") {
    plantingList.replaceChildren(
        createElement("div", className, message)
    );
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
        .order("sowing_date", { ascending: false });

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

    // Preserve the current value if it is no longer active.
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
        feedback.textContent = "Saving...";
        feedback.className = "status-save-message";

        select.disabled = true;

        await onChange(select.value, select, feedback);

        select.disabled = false;
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

// ---------- PLANTING CARD ----------

function createPlantingCard(planting, activity, farm) {
    const card = createElement("article", "activity-card");

    // Header
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

    // Farm information
    const farmDetails = createElement("div", "activity-details");

    farmDetails.append(
        createDetail("Farm", farm?.farm_name || "Unavailable"),
        createDetail("Location", farm?.farm_location)
    );

    card.append(farmDetails);

    // Planting details
    const plantingDetails = createElement("div", "activity-details");

    plantingDetails.append(
        createDetail("Crop", planting.crop_name),
        createDetail("Planting date", formatDate(planting.sowing_date)),
        createDetail(
            "Expected harvest",
            formatDate(planting.expected_harvest_date)
        )
    );

    card.append(plantingDetails);

    // Editable statuses
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

    // Notes
    if (planting.notes) {
        card.append(
            createElement("p", "activity-description", planting.notes)
        );
    }

    return card;
}

// ---------- LOAD MY PLANTINGS ----------

async function loadMyPlantings() {
    displayMessage(
        "Loading your planting records...",
        "loading-state"
    );

    // 1. Get planting records assigned directly to this Farmer.
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
        .order("sowing_date", { ascending: false });

    if (error) {
        console.error("Assigned plantings loading error:", error);

        displayMessage(
            "Unable to load your planting records. Please refresh the page.",
            "error-state"
        );

        return;
    }

    if (!plantings || plantings.length === 0) {
        displayMessage(
            "You currently have no planting records assigned to you."
        );
        return;
    }

    // 2. Get the associated fields.
    const fieldIds = [
        ...new Set(plantings.map(p => p.field_id).filter(Boolean))
    ];

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

    const fieldsMap = new Map(
        (fields || []).map(field => [field.id, field])
    );

    // 3. Get the associated farms.
    const farmIds = [
        ...new Set((fields || []).map(field => field.farm_id).filter(Boolean))
    ];

    const farmsMap = await loadFarms(farmIds);

    // 4. Display planting cards.
    plantingList.replaceChildren();

    plantings.forEach(planting => {
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
}

// ---------- SUPABASE REALTIME ----------

function schedulePlantingsReload() {
    // Combine rapid database events into one reload.
    clearTimeout(plantingReloadTimer);

    plantingReloadTimer = setTimeout(async () => {
        await loadMyPlantings();
    }, 300);
}

function subscribeToPlantingChanges() {
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
        .subscribe((status) => {
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

// ---------- THEME ----------

function initializeTheme() {
    if (!themeToggle) return;

    const savedTheme = localStorage.getItem("tanikala-theme");

    if (savedTheme) {
        document.documentElement.setAttribute("data-theme", savedTheme);
    }

    themeToggle.addEventListener("click", () => {
        const currentTheme =
            document.documentElement.getAttribute("data-theme") || "light";

        const newTheme = currentTheme === "dark" ? "light" : "dark";

        document.documentElement.setAttribute("data-theme", newTheme);
        localStorage.setItem("tanikala-theme", newTheme);
    });
}

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

// ---------- INITIALIZATION ----------

async function initializeFarmerPlantings() {
    try {
        initializeTheme();
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

        await loadPlantingStatusOptions();
        await loadMyPlantings();

        subscribeToPlantingChanges();

    } catch (error) {
        console.error("Farmer Plantings Initialization Error:", error);

        displayMessage(
            error.message || "Something went wrong while loading the page.",
            "error-state"
        );
    }
}

initializeFarmerPlantings();
window.addEventListener("beforeunload", cleanupPlantingRealtime);
