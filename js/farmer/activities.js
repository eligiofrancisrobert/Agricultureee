import { supabase } from "../connection.js";

const activityList = document.getElementById("activityList");
const farmerName = document.getElementById("farmerName");
const farmerAvatar = document.getElementById("farmerAvatar");
const logoutButton = document.getElementById("logoutButton");
const logoutLabel = document.getElementById("logoutLabel");
const todayLabel = document.getElementById("todayLabel");
const themeToggle = document.getElementById("themeToggle");

let currentUser = null;
let activitiesRealtimeChannel = null;
let activitiesReloadTimer = null;

// Statuses where the farmer can still accept / decline.
const DECIDABLE_STATUSES = ["pending"];
const EVIDENCE_MAX_SIZE = 10 * 1024 * 1024;
const EVIDENCE_TYPES = ["image/jpeg", "image/png", "application/pdf"];

// ---------- HELPERS ----------

function createElement(tag, className = "", text = "") {
    const element = document.createElement(tag);

    if (className) element.className = className;
    if (text) element.textContent = text;

    return element;
}

function toStatusClass(status) {
    return String(status || "pending")
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
    activityList.replaceChildren(
        createElement("div", className, message)
    );
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

// One label-on-top / value-below block.
function createDetail(label, value) {
    const wrapper = createElement("div", "detail");
    wrapper.append(
        createElement("span", "detail-label", label),
        createElement("span", "detail-value", value || "Not specified")
    );
    return wrapper;
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

// ---------- FARM LOOKUP ----------

async function loadFarms(farmIds) {
    if (!farmIds.length) return new Map();

    const uniqueFarmIds = [...new Set(farmIds)];

    const { data: farms, error } = await supabase
        .from("farmer_farms")
        .select("id, farm_name, farm_location")
        .in("id", uniqueFarmIds);

    if (error) {
        console.error("Farm loading error:", error);
        return new Map();
    }

    return new Map((farms || []).map(farm => [farm.id, farm]));
}

// ---------- LINKED PLANTINGS ----------

async function loadPlantings(plantingIds) {
    if (!plantingIds.length) return new Map();

    const uniquePlantingIds = [...new Set(plantingIds)];

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
        .in("id", uniquePlantingIds);

    if (error) {
        console.error("Plantings loading error:", error);
        return new Map();
    }

    return new Map((plantings || []).map(p => [p.id, p]));
}

// ---------- ACCEPT / DECLINE ----------

async function updateActivityStatus(activity, newStatus, card, buttons) {
    buttons.forEach(button => button.disabled = true);

    const response = newStatus === "accepted" ? "accepted" : "declined";

    const { error } = await supabase.rpc("respond_to_farm_action", {
        p_action_id: activity.action_id,
        p_response: response,
        p_response_notes: null
    });

    if (error) {
        console.error("Activity response error:", error);
        buttons.forEach(button => button.disabled = false);

        const message = card.querySelector(".activity-card__message");
        if (message) {
            message.textContent = error.message || "Unable to respond to this activity.";
            message.hidden = false;
        }
        return;
    }

    await loadActivities();
}

async function startActivity(activity, button) {
    button.disabled = true;

    const { error } = await supabase.rpc("start_farm_action", {
        p_action_id: activity.action_id
    });

    if (error) {
        console.error("Start activity error:", error);
        button.disabled = false;
        alert(error.message || "Unable to start this activity.");
        return;
    }

    await loadActivities();
}

function getLocalDateValue() {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function openCompletionModal(activity) {
    const overlay = createElement("div", "activity-modal-overlay");
    const modal = createElement("form", "activity-completion-modal");

    const heading = createElement("h2", "", "Submit Activity Completion");
    const description = createElement(
        "p",
        "",
        `Submit your completed work for: ${activity.action_title || "Activity"}`
    );

    const notesLabel = createElement("label", "", "Completion Notes");
    const notes = createElement("textarea");
    notes.required = true;
    notes.rows = 4;
    notes.placeholder = "Describe the work you completed...";
    notesLabel.append(notes);

    const dateLabel = createElement("label", "", "Actual Completion Date");
    const date = createElement("input");
    date.type = "date";
    date.required = true;
    date.value = getLocalDateValue();
    date.max = getLocalDateValue();
    dateLabel.append(date);

    const evidenceLabel = createElement("label", "", "Evidence (JPG, PNG, or PDF; maximum 10MB each)");
    const evidence = createElement("input");
    evidence.type = "file";
    evidence.accept = ".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf";
    evidence.multiple = true;
    evidenceLabel.append(evidence);

    const message = createElement("p", "activity-card__message");
    message.hidden = true;

    const buttons = createElement("div", "activity-actions");

    const cancelButton = createElement("button", "btn-reject", "Cancel");
    cancelButton.type = "button";
    cancelButton.addEventListener("click", () => overlay.remove());

    const submitButton = createElement("button", "btn-approve", "Submit Completion");
    submitButton.type = "submit";

    buttons.append(cancelButton, submitButton);

    modal.append(
        heading,
        description,
        notesLabel,
        dateLabel,
        evidenceLabel,
        message,
        buttons
    );

    let completionId = null;
    const uploadedFileKeys = new Set();

    modal.addEventListener("submit", async event => {
        event.preventDefault();

        const files = [...evidence.files];

        const invalidFile = files.find(file =>
            !EVIDENCE_TYPES.includes(file.type) ||
            file.size > EVIDENCE_MAX_SIZE
        );

        if (invalidFile) {
            message.textContent =
                `${invalidFile.name}: only JPG, PNG, and PDF files up to 10MB are allowed.`;
            message.hidden = false;
            return;
        }

        submitButton.disabled = true;
        cancelButton.disabled = true;
        message.hidden = true;

        try {
            // Create the completion only once.
            // If evidence upload fails, the next attempt reuses this completion.
            if (!completionId) {
                const { data, error } = await supabase.rpc(
                    "submit_farm_action_completion",
                    {
                        p_action_id: activity.action_id,
                        p_completion_notes: notes.value.trim() || null,
                        p_actual_completion_date: date.value
                    }
                );

                if (error) throw error;

                completionId = data;
            }

            for (const file of files) {
                const fileKey = `${file.name}:${file.size}:${file.lastModified}`;

                if (uploadedFileKeys.has(fileKey)) continue;

                const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
                const filePath =
                    `${currentUser.id}/${completionId}/${crypto.randomUUID()}-${safeName}`;

                const { error: uploadError } = await supabase.storage
                    .from("farm-action-evidence")
                    .upload(filePath, file, {
                        contentType: file.type,
                        upsert: false
                    });

                if (uploadError) throw uploadError;

                const { error: insertError } = await supabase
                    .from("farm_action_evidence")
                    .insert({
                        completion_id: completionId,
                        uploaded_by: currentUser.id,
                        file_name: file.name,
                        file_path: filePath,
                        file_type: file.type,
                        description: null
                    });

                if (insertError) {
                    await supabase.storage
                        .from("farm-action-evidence")
                        .remove([filePath]);

                    throw insertError;
                }

                uploadedFileKeys.add(fileKey);
            }

            overlay.remove();
            await loadActivities();

        } catch (error) {
            console.error("Completion submission error:", error);

            message.textContent =
                completionId
                    ? "Completion was created, but evidence upload was incomplete. Select the remaining files and retry."
                    : error.message || "Unable to submit your completion.";

            message.hidden = false;
            submitButton.disabled = false;
            cancelButton.disabled = false;
        }
    });

    overlay.append(modal);
    document.body.append(overlay);
}

// ---------- ACTIVITY DISPLAY ----------

function createActivityCard(activity, planting, farm) {
    const card = createElement("article", "activity-card");
    card._planting = planting;
    card._farm = farm;

    // --- Header: title + category, status badge ---
    const header = createElement("div", "activity-card-header");
    const titleSection = createElement("div");

    titleSection.append(
        createElement("h3", "", activity.action_title || "Untitled Activity"),
        createElement(
            "p",
            "activity-category",
            activity.action_category || "General Activity"
        )
    );

    const statusText = activity.status || "Pending";

    header.append(
        titleSection,
        createElement(
            "span",
            `activity-status activity-status--${toStatusClass(statusText)}`,
            statusText.replaceAll("_", " ")
        )
    );

    card.append(header);

    // --- Description ---
    if (activity.description) {
        card.append(
            createElement("p", "activity-description", activity.description)
        );
    }

    // --- Key details (2 x 2) ---
    const details = createElement("div", "activity-details");

    details.append(
        createDetail("Farm", farm?.farm_name || "Unavailable"),
        createDetail("Location", farm?.farm_location),
        createDetail("Requested", formatDate(activity.requested_date)),
        createDetail("Due date", formatDate(activity.due_date))
    );

    card.append(details);

    // --- Planting info: collapsed so the card stays compact ---
    if (planting) {
        const toggle = createElement("details", "planting-information");

        toggle.append(
            createElement(
                "summary",
                "",
                `Related planting: ${planting.crop_name || "Not specified"}`
            )
        );

        const grid = createElement("div", "planting-grid");

        grid.append(
            createDetail("Planting status", planting.status),
            createDetail("Crop status", planting.crop_status),
            createDetail("Sowing date", formatDate(planting.sowing_date)),
            createDetail(
                "Expected harvest",
                formatDate(planting.expected_harvest_date)
            )
        );

        toggle.append(grid);

        if (planting.notes) {
            toggle.append(
                createElement("p", "activity-description", planting.notes)
            );
        }

        card.append(toggle);
    }

    // --- Footer: accept / decline ---
    // --- Footer: actions and messages ---
    const message = createElement("p", "activity-card__message");
    message.hidden = true;
    card.append(message);

    const status = String(activity.status || "pending").toLowerCase();
    const actions = createElement("div", "activity-actions");

    if (status === "pending") {
        const declineButton = createElement("button", "btn-reject", "Decline");
        declineButton.type = "button";

        const acceptButton = createElement("button", "btn-approve", "Accept");
        acceptButton.type = "button";

        declineButton.addEventListener("click", () => {
            if (!window.confirm("Decline this activity?")) return;

            updateActivityStatus(activity, "declined", card, [
                declineButton,
                acceptButton
            ]);
        });

        acceptButton.addEventListener("click", () => {
            updateActivityStatus(activity, "accepted", card, [
                declineButton,
                acceptButton
            ]);
        });

        actions.append(declineButton, acceptButton);
    }

    if (status === "accepted") {
        const startButton = createElement(
            "button",
            "btn-approve",
            "Start Activity"
        );

        startButton.type = "button";
        startButton.addEventListener("click", () => {
            startActivity(activity, startButton);
        });

        actions.append(startButton);
    }

    if (status === "in_progress" || status === "revision_requested") {
        const submitButton = createElement(
            "button",
            "btn-approve",
            status === "revision_requested"
                ? "Resubmit Completion"
                : "Submit Completion"
        );

        submitButton.type = "button";
        submitButton.addEventListener("click", () => {
            openCompletionModal(activity);
        });

        actions.append(submitButton);
    }

    if (status === "submitted") {
        card.append(
            createElement(
                "p",
                "activity-description",
                "Your completion has been submitted. Waiting for Farm Manager review."
            )
        );
    }

    if (status === "verified") {
        card.append(
            createElement(
                "p",
                "activity-description",
                "Your submitted activity has been verified."
            )
        );
    }

    if (status === "declined" || status === "cancelled") {
        card.append(
            createElement(
                "p",
                "activity-description",
                `This activity was ${status}.`
            )
        );
    }

    if (actions.children.length) {
        card.append(actions);
    }

    return card;
}

// ---------- LOAD ASSIGNED ACTIVITIES ----------

async function loadActivities() {
    displayMessage("Loading your assigned activities...", "loading-state");

    const { data: activities, error } = await supabase
        .from("farm_actions")
        .select(`
            action_id,
            manager_id,
            farmer_id,
            farm_id,
            planting_id,
            action_title,
            action_category,
            description,
            requested_date,
            due_date,
            status,
            created_at,
            updated_at
        `)
        .eq("farmer_id", currentUser.id)
        .order("requested_date", { ascending: false });

    if (error) {
        console.error("Activities loading error:", error);
        displayMessage(
            "Unable to load your assigned activities. Please refresh the page or try again later.",
            "error-state"
        );
        return;
    }

    if (!activities || activities.length === 0) {
        displayMessage("You currently have no activities assigned to you.");
        return;
    }

    const farmIds = activities.map(a => a.farm_id).filter(Boolean);
    const plantingIds = activities.map(a => a.planting_id).filter(Boolean);

    const [farmsMap, plantingsMap] = await Promise.all([
        loadFarms(farmIds),
        loadPlantings(plantingIds)
    ]);

    activityList.replaceChildren();

    activities.forEach(activity => {
        const planting = activity.planting_id
            ? plantingsMap.get(activity.planting_id)
            : null;

        const farm = activity.farm_id
            ? farmsMap.get(activity.farm_id)
            : null;

        activityList.append(createActivityCard(activity, planting, farm));
    });
}

// ---------- SUPABASE REALTIME ----------

function scheduleActivitiesReload() {
    clearTimeout(activitiesReloadTimer);

    activitiesReloadTimer = setTimeout(async () => {
        await loadActivities();
    }, 300);
}

function subscribeToActivityChanges() {
    if (activitiesRealtimeChannel) {
        supabase.removeChannel(activitiesRealtimeChannel);
    }

    activitiesRealtimeChannel = supabase
        .channel(`farmer-activities-${currentUser.id}`)

        // Assigned Farm Action changes.
        .on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: "farm_actions",
                filter: `farmer_id=eq.${currentUser.id}`
            },
            () => {
                scheduleActivitiesReload();
            }
        )

        // Changes to planting details linked to accessible activities.
        // RLS determines which planting records this Farmer can receive.
        .on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: "farm_plantings"
            },
            () => {
                scheduleActivitiesReload();
            }
        )

        .subscribe((status) => {
            if (status === "SUBSCRIBED") {
                console.log("My Activities Realtime connected.");
            } else if (status === "CHANNEL_ERROR") {
                console.error("My Activities Realtime connection failed.");
            }
        });
}

function cleanupActivitiesRealtime() {
    clearTimeout(activitiesReloadTimer);

    if (activitiesRealtimeChannel) {
        supabase.removeChannel(activitiesRealtimeChannel);
        activitiesRealtimeChannel = null;
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

async function initializeFarmerActivities() {
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

        const { data: { user }, error } = await supabase.auth.getUser();

        if (error || !user) {
            window.location.replace("../../login.html");
            return;
        }

        currentUser = user;

        const profile = await loadFarmerProfile(user);

        if (!profile) return;

        await loadActivities();

        subscribeToActivityChanges();
    } catch (error) {
        console.error("Farmer Activities Initialization Error:", error);
        displayMessage(
            error.message || "Something went wrong while loading the page.",
            "error-state"
        );
    }
}

initializeFarmerActivities();
window.addEventListener("beforeunload", cleanupActivitiesRealtime);