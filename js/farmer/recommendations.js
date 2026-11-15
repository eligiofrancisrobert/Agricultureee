import { supabase } from "../connection.js";

// =====================================================
// ELEMENTS
// =====================================================

const farmerName = document.getElementById("farmerName");
const farmerAvatar = document.getElementById("farmerAvatar");
const todayLabel = document.getElementById("todayLabel");
const logoutButton = document.getElementById("logoutButton");

const recommendationsContainer =
    document.getElementById("recommendationsList") ||
    document.getElementById("recommendationsContainer") ||
    document.getElementById("advisoryList");

const searchInput =
    document.getElementById("searchInput") ||
    document.getElementById("recommendationSearch");

const categoryFilter = document.getElementById("categoryFilter");
const priorityFilter = document.getElementById("priorityFilter");
const statusFilter = document.getElementById("statusFilter");

const totalCount =
    document.getElementById("totalRecommendations") ||
    document.getElementById("totalCount");

const highPriorityCount =
    document.getElementById("highPriorityRecommendations") ||
    document.getElementById("highPriorityCount");

const activeCount =
    document.getElementById("activeRecommendations") ||
    document.getElementById("activeCount");

const logoutDefaultHTML = logoutButton?.innerHTML || "";

let currentUser = null;
let recommendations = [];
let completionsByMonitoring = new Map();
let submittingMonitoringIds = new Set();
let openMonitoringIds = new Set();

// Realtime state
let realtimeChannel = null;
let realtimeRefreshTimer = null;
let realtimeRefreshInProgress = false;
let realtimeRefreshPending = false;
let recommendationsPageActive = true;

// =====================================================
// THEME
// =====================================================

const THEME_KEY = "theme";

function applyTheme(theme) {
    document.documentElement.setAttribute(
        "data-theme",
        theme === "dark" ? "dark" : "light"
    );
}

function initializeTheme() {
    let savedTheme = "light";

    try {
        savedTheme =
            localStorage.getItem(THEME_KEY) ||
            localStorage.getItem("tanikala-theme") ||
            "light";
    } catch {
        // Use light theme if storage is unavailable.
    }

    applyTheme(savedTheme);

    const themeToggle = document.getElementById("themeToggle");

    themeToggle?.addEventListener("click", event => {
        event.stopImmediatePropagation();

        const nextTheme =
            document.documentElement.getAttribute("data-theme") === "dark"
                ? "light"
                : "dark";

        applyTheme(nextTheme);

        try {
            localStorage.setItem(THEME_KEY, nextTheme);
        } catch {
            // Ignore blocked storage.
        }
    });

    window.addEventListener("storage", event => {
        if (event.key === THEME_KEY && event.newValue) {
            applyTheme(event.newValue);
        }
    });
}

// =====================================================
// DATE
// =====================================================

function initializeDate() {
    if (!todayLabel) return;

    todayLabel.textContent = new Date().toLocaleDateString("en-PH", {
        weekday: "short",
        month: "short",
        day: "numeric"
    });
}

// =====================================================
// AUTHENTICATION
// =====================================================

async function validateFarmer() {
    const {
        data: { user },
        error: authError
    } = await supabase.auth.getUser();

    if (authError || !user) {
        window.location.replace("../../login.html");
        return null;
    }

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
        return null;
    }

    currentUser = user;

    const fullName =
        user.user_metadata?.full_name ||
        user.user_metadata?.fullName ||
        user.email?.split("@")[0] ||
        "Farmer";

    const firstName = fullName.trim().split(/\s+/)[0];

    if (farmerName) farmerName.textContent = fullName;

    if (farmerAvatar) {
        farmerAvatar.textContent = firstName.charAt(0).toUpperCase();
    }

    return user;
}

// =====================================================
// HELPERS
// =====================================================

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => {
        const entities = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;"
        };

        return entities[character];
    });
}

function formatDate(value) {
    if (!value) return "Date unavailable";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "Date unavailable";
    }

    return date.toLocaleDateString("en-PH", {
        year: "numeric",
        month: "short",
        day: "numeric"
    });
}

function normalizeValue(value) {
    if (!value) return "Unknown";

    return String(value)
        .replace(/_/g, " ")
        .replace(/\b\w/g, character => character.toUpperCase());
}

function getFarmName(item) {
    return item.farm?.farm_name || "Unknown Farm";
}

function getFarmLocation(item) {
    return item.farm?.farm_location || "Location unavailable";
}

function getFieldName(item) {
    return item.planting?.field?.field_name || "Field unavailable";
}

function getCropName(item) {
    return (
        item.planting?.crop_name ||
        item.planting?.product?.product_name ||
        "Crop unavailable"
    );
}

function getMonitoringStatus(item) {
    return item.monitoring_status || "pending";
}

function getPriority(item) {
    const health = String(item.crop_health_status || "").toLowerCase();

    if (
        health.includes("critical") ||
        health.includes("severe") ||
        item.disease_observed ||
        item.pest_observed
    ) {
        return "high";
    }

    if (
        health.includes("poor") ||
        health.includes("moderate") ||
        item.action_required
    ) {
        return "medium";
    }

    return "low";
}

function getLatestCompletion(monitoringId) {
    return completionsByMonitoring.get(monitoringId) || null;
}

function getCompletionStatusLabel(status) {
    const labels = {
        submitted: "Submitted for Review",
        verified: "Verified",
        needs_revision: "Revision Requested"
    };

    return labels[status] || "Not Started";
}

function getCompletionStatusClass(status) {
    const classes = {
        submitted: "submitted",
        verified: "verified",
        needs_revision: "needs-revision"
    };

    return classes[status] || "not-started";
}

// =====================================================
// FETCH FARMER RECOMMENDATIONS
// =====================================================

async function fetchRecommendations({ silent = false } = {}) {
    if (!currentUser || !recommendationsPageActive) return;

    // Avoid replacing the page with a loading message during realtime refresh.
    if (!silent && recommendationsContainer) {
        recommendationsContainer.innerHTML = `
            <div class="recommendation-loading">
                Loading recommended actions...
            </div>
        `;
    }

    const { data, error } = await supabase
        .from("agricultural_technician_crop_monitoring")
        .select(`
            monitoring_id,
            planting_id,
            farm_id,
            technician_staff_id,
            growth_stage,
            crop_health_status,
            pest_observed,
            pest_details,
            disease_observed,
            disease_details,
            observations,
            action_required,
            recommended_action,
            monitoring_date,
            monitoring_status,
            created_at,
            updated_at,

            farm:farmer_farms!agricultural_technician_crop_monitoring_farm_id_fkey (
                id,
                farmer_id,
                farm_name,
                farm_location
            ),

            planting:farm_plantings!agricultural_technician_crop_monitoring_planting_id_fkey (
                id,
                farmer_id,
                crop_name,
                field:farm_fields!farm_plantings_field_id_fkey (
                    id,
                    field_name,
                    farm_id
                ),
                product:products (
                    product_name
                )
            )
        `)
        .eq("action_required", true)
        .not("recommended_action", "is", null)
        .order("monitoring_date", { ascending: false });

    if (error) {
        console.error("Failed to load recommended actions:", error);
        throw error;
    }

    recommendations = (data || []).filter(item => {
        const action = String(item.recommended_action || "").trim();

        if (!action) return false;

        if (!item.farm || item.farm.farmer_id !== currentUser.id) {
            return false;
        }

        if (!item.planting || item.planting.farmer_id !== currentUser.id) {
            return false;
        }

        if (
            !item.planting.field ||
            item.planting.field.farm_id !== item.farm_id
        ) {
            return false;
        }

        return true;
    });

    await fetchCompletionRecords();

    if (!recommendationsPageActive) return;

    populateFilters();
    updateSummary();
    renderRecommendations();
}

// =====================================================
// FETCH COMPLETION RECORDS
// =====================================================

async function fetchCompletionRecords() {
    completionsByMonitoring.clear();

    if (recommendations.length === 0) return;

    const monitoringIds = recommendations.map(
        item => item.monitoring_id
    );

    const { data, error } = await supabase
        .from("crop_recommendation_completions")
        .select(`
            completion_id,
            monitoring_id,
            farmer_id,
            completion_notes,
            evidence_photo_path,
            submission_status,
            review_notes,
            submitted_at,
            reviewed_at,
            created_at
        `)
        .eq("farmer_id", currentUser.id)
        .in("monitoring_id", monitoringIds)
        .order("submitted_at", { ascending: false });

    if (error) {
        console.error("Failed to load completion records:", error);
        throw error;
    }

    (data || []).forEach(record => {
        if (!completionsByMonitoring.has(record.monitoring_id)) {
            completionsByMonitoring.set(record.monitoring_id, record);
        }
    });
}

// =====================================================
// REALTIME
// =====================================================

function scheduleRealtimeRefresh() {
    if (!recommendationsPageActive) return;

    window.clearTimeout(realtimeRefreshTimer);

    realtimeRefreshTimer = window.setTimeout(async () => {
        if (!recommendationsPageActive) return;

        if (realtimeRefreshInProgress) {
            realtimeRefreshPending = true;
            return;
        }

        realtimeRefreshInProgress = true;

        try {
            await fetchRecommendations({ silent: true });
        } catch (error) {
            console.error("Realtime recommendations refresh failed:", error);
        } finally {
            realtimeRefreshInProgress = false;

            if (realtimeRefreshPending && recommendationsPageActive) {
                realtimeRefreshPending = false;
                scheduleRealtimeRefresh();
            }
        }
    }, 400);
}

function subscribeToRecommendationsRealtime() {
    if (!currentUser || realtimeChannel) return;

    realtimeChannel = supabase
        .channel(`farmer-recommendations-${currentUser.id}`)
        // Monitoring records do not contain farmer_id.
        // The fetched records are filtered using the farmer's farm and planting.
        .on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: "agricultural_technician_crop_monitoring"
            },
            payload => {
                console.log("Crop monitoring changed:", payload.eventType);
                scheduleRealtimeRefresh();
            }
        )
        .on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: "crop_recommendation_completions",
                filter: `farmer_id=eq.${currentUser.id}`
            },
            payload => {
                console.log("Completion record changed:", payload.eventType);
                scheduleRealtimeRefresh();
            }
        )
        .subscribe(status => {
            console.log("Farmer recommendations realtime:", status);
        });
}

async function cleanupRecommendationsRealtime() {
    recommendationsPageActive = false;

    window.clearTimeout(realtimeRefreshTimer);

    if (realtimeChannel) {
        const channel = realtimeChannel;
        realtimeChannel = null;
        await supabase.removeChannel(channel);
    }
}

window.addEventListener("pagehide", cleanupRecommendationsRealtime, {
    once: true
});

// =====================================================
// FILTER OPTIONS
// =====================================================

function populateSelectOptions(element, values, defaultLabel) {
    if (!element) return;

    const currentValue = element.value;

    const uniqueValues = [...new Set(
        values.filter(value =>
            value !== null &&
            value !== undefined &&
            value !== ""
        )
    )].sort();

    element.innerHTML = `
        <option value="">${defaultLabel}</option>
        ${uniqueValues.map(value => `
            <option value="${escapeHTML(value)}">
                ${escapeHTML(normalizeValue(value))}
            </option>
        `).join("")}
    `;

    if (uniqueValues.includes(currentValue)) {
        element.value = currentValue;
    }
}

function populateFilters() {
    populateSelectOptions(
        priorityFilter,
        recommendations.map(getPriority),
        "All Priorities"
    );

    populateSelectOptions(
        statusFilter,
        recommendations.map(getMonitoringStatus),
        "All Statuses"
    );
}

// =====================================================
// SUMMARY
// =====================================================

function updateSummary() {
    if (totalCount) {
        totalCount.textContent = recommendations.length;
    }

    if (highPriorityCount) {
        highPriorityCount.textContent = recommendations.filter(
            item => getPriority(item) === "high"
        ).length;
    }

    if (activeCount) {
        activeCount.textContent = recommendations.filter(item => {
            const status = String(
                getMonitoringStatus(item)
            ).toLowerCase();

            return !["archived", "cancelled", "completed"].includes(status);
        }).length;
    }
}

// =====================================================
// FILTERING
// =====================================================

function getFilteredRecommendations() {
    const searchTerm = searchInput?.value.trim().toLowerCase() || "";
    const selectedPriority = priorityFilter?.value || "";
    const selectedStatus = statusFilter?.value || "";

    return recommendations.filter(item => {
        const searchableText = [
            item.recommended_action,
            item.growth_stage,
            item.crop_health_status,
            item.pest_details,
            item.disease_details,
            item.observations,
            getFarmName(item),
            getFarmLocation(item),
            getFieldName(item),
            getCropName(item),
            item.monitoring_status
        ].join(" ").toLowerCase();

        const matchesSearch =
            !searchTerm || searchableText.includes(searchTerm);

        const matchesPriority =
            !selectedPriority ||
            getPriority(item) === selectedPriority;

        const matchesStatus =
            !selectedStatus ||
            getMonitoringStatus(item) === selectedStatus;

        return matchesSearch && matchesPriority && matchesStatus;
    });
}

// =====================================================
// COMPLETION SECTION
// =====================================================

function renderCompletionSection(item) {
    const completion = getLatestCompletion(item.monitoring_id);
    const status = completion?.submission_status || null;

    if (status === "verified") {
        return `
            <div class="recommendation-completion verified">
                <h4>Action Completion</h4>
                <span class="completion-status verified">Verified</span>
                <p>Your Agricultural Technician has verified this completed action.</p>
                ${
                    completion.completion_notes
                        ? `<p><strong>Your Notes:</strong> ${escapeHTML(completion.completion_notes)}</p>`
                        : ""
                }
                <p><strong>Submitted:</strong> ${escapeHTML(formatDate(completion.submitted_at))}</p>
            </div>
        `;
    }

    if (status === "submitted") {
        return `
            <div class="recommendation-completion submitted">
                <h4>Action Completion</h4>
                <span class="completion-status submitted">Submitted for Review</span>
                <p>Your completion has been submitted. Wait for your Agricultural Technician to review it.</p>
                ${
                    completion.completion_notes
                        ? `<p><strong>Your Notes:</strong> ${escapeHTML(completion.completion_notes)}</p>`
                        : ""
                }
                <p><strong>Submitted:</strong> ${escapeHTML(formatDate(completion.submitted_at))}</p>
                ${completion.evidence_photo_path ? "<p>Evidence photo uploaded successfully.</p>" : ""}
            </div>
        `;
    }

    const isRevision = status === "needs_revision";

    return `
        <div class="recommendation-completion">
            <h4>Action Completion</h4>

            ${
                isRevision
                    ? `
                        <div class="completion-revision-notice">
                            <span class="completion-status needs-revision">Revision Requested</span>
                            <p>Your Agricultural Technician requested changes to your previous submission.</p>
                            ${
                                completion.review_notes
                                    ? `<div><strong>Technician Feedback:</strong><p>${escapeHTML(completion.review_notes)}</p></div>`
                                    : ""
                            }
                            <p><strong>Previous Submission:</strong> ${escapeHTML(formatDate(completion.submitted_at))}</p>
                        </div>
                    `
                    : `
                        <p>Once you have completed the recommended action, submit it for review.</p>
                    `
            }

            <form class="completion-form" data-monitoring-id="${escapeHTML(item.monitoring_id)}">
                <label>
                    Completion Notes
                    <textarea name="completion_notes" rows="4" maxlength="3000" required placeholder="Describe how you completed the recommended action...">${isRevision ? escapeHTML(completion.completion_notes || "") : ""}</textarea>
                </label>

                <label>
                    Evidence Photo (Optional)
                    <input type="file" name="evidence_photo" accept="image/jpeg,image/png,image/webp">
                </label>

                <small>Accepted formats: JPG, PNG, WEBP. Maximum file size: 5 MB.</small>

                <button type="submit" class="completion-submit-button">
                    ${isRevision ? "Resubmit for Review" : "Submit for Review"}
                </button>
            </form>
        </div>
    `;
}

// =====================================================
// SUBMIT COMPLETION
// =====================================================

async function submitCompletion(form) {
    const monitoringId = form.dataset.monitoringId;

    if (!monitoringId || submittingMonitoringIds.has(monitoringId)) {
        return;
    }

    const recommendation = recommendations.find(
        item => item.monitoring_id === monitoringId
    );

    if (!recommendation) {
        alert("Recommendation not found.");
        return;
    }

    const previousCompletion = getLatestCompletion(monitoringId);

    if (
        previousCompletion?.submission_status === "submitted" ||
        previousCompletion?.submission_status === "verified"
    ) {
        alert("This recommendation cannot be submitted again.");
        return;
    }

    const notesInput = form.querySelector('[name="completion_notes"]');
    const photoInput = form.querySelector('[name="evidence_photo"]');
    const submitButton = form.querySelector('button[type="submit"]');

    const completionNotes = notesInput?.value.trim() || "";
    const photo = photoInput?.files?.[0] || null;

    if (!completionNotes) {
        alert("Please provide completion notes.");
        notesInput?.focus();
        return;
    }

    if (photo) {
        const allowedTypes = ["image/jpeg", "image/png", "image/webp"];

        if (!allowedTypes.includes(photo.type)) {
            alert("Please select a JPG, PNG, or WEBP image.");
            return;
        }

        if (photo.size > 5 * 1024 * 1024) {
            alert("The evidence photo must not exceed 5 MB.");
            return;
        }
    }

    const confirmed = window.confirm(
        "Submit this completed action for Agricultural Technician review?"
    );

    if (!confirmed) return;

    submittingMonitoringIds.add(monitoringId);

    if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = "Submitting...";
    }

    let insertedRecord = null;
    let evidencePath = null;

    try {
        const { data, error: insertError } = await supabase
            .from("crop_recommendation_completions")
            .insert({
                monitoring_id: monitoringId,
                farmer_id: currentUser.id,
                completion_notes: completionNotes,
                submission_status: "submitted"
            })
            .select(`
                completion_id,
                monitoring_id,
                farmer_id,
                completion_notes,
                evidence_photo_path,
                submission_status,
                review_notes,
                submitted_at,
                reviewed_at,
                created_at
            `)
            .single();

        if (insertError) throw insertError;

        insertedRecord = data;

        if (photo) {
            const extension = photo.name.split(".").pop()?.toLowerCase();

            const safeExtension = [
                "jpg",
                "jpeg",
                "png",
                "webp"
            ].includes(extension) ? extension : "jpg";

            const fileName = `${crypto.randomUUID()}.${safeExtension}`;

            evidencePath =
                `${currentUser.id}/${insertedRecord.completion_id}/${fileName}`;

            const { error: uploadError } = await supabase.storage
                .from("farm-action-evidence")
                .upload(evidencePath, photo, {
                    cacheControl: "3600",
                    upsert: false,
                    contentType: photo.type
                });

            if (uploadError) {
                throw new Error(
                    `Completion was saved, but evidence upload failed: ${uploadError.message}`
                );
            }

            const { error: updateError } = await supabase
                .from("crop_recommendation_completions")
                .update({
                    evidence_photo_path: evidencePath,
                    updated_at: new Date().toISOString()
                })
                .eq("completion_id", insertedRecord.completion_id)
                .eq("farmer_id", currentUser.id);

            if (updateError) {
                throw new Error(
                    `Evidence uploaded, but its path could not be saved: ${updateError.message}`
                );
            }

            insertedRecord.evidence_photo_path = evidencePath;
        }

        await fetchCompletionRecords();
        renderRecommendations();

        alert(
            photo
                ? "Your completion and evidence photo have been submitted for review."
                : "Your completion has been submitted for review."
        );

    } catch (error) {
        console.error("Completion submission failed:", error);

        if (insertedRecord && evidencePath) {
            await supabase.storage
                .from("farm-action-evidence")
                .remove([evidencePath])
                .catch(() => {});
        }

        alert(
            error.message ||
            "Unable to submit your completion. Please try again."
        );

        if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent =
                previousCompletion?.submission_status === "needs_revision"
                    ? "Resubmit for Review"
                    : "Submit for Review";
        }

    } finally {
        submittingMonitoringIds.delete(monitoringId);
    }
}

// =====================================================
// RENDER RECOMMENDATIONS WITH DROPDOWN
// =====================================================

function renderRecommendations() {
    if (!recommendationsContainer) {
        console.error(
            "Recommendations container not found. Check the HTML element ID."
        );
        return;
    }

    const filteredRecommendations = getFilteredRecommendations();

    if (filteredRecommendations.length === 0) {
        recommendationsContainer.innerHTML = `
            <div class="empty-state">
                <h3>No recommended actions found</h3>
                <p>
                    ${
                        recommendations.length === 0
                            ? "Your Agricultural Technician has not submitted any recommended actions for your crop plantings yet."
                            : "Try changing your search or filters."
                    }
                </p>
            </div>
        `;
        return;
    }

    recommendationsContainer.innerHTML = filteredRecommendations
        .map(item => {
            const priority = getPriority(item);
            const status = getMonitoringStatus(item);
            const latestCompletion = getLatestCompletion(item.monitoring_id);

            return `
                <article class="recommendation-card">
                    <div class="recommendation-card-header">
                        <div class="recommendation-heading">
                            <span class="recommendation-category">Crop Monitoring</span>
                            <h3>${escapeHTML(getCropName(item))}</h3>
                        </div>

                        <div class="recommendation-badges">
                            <span class="priority-badge at-priority-${escapeHTML(priority)}">
                                ${escapeHTML(normalizeValue(priority))} Priority
                            </span>
                            <span class="status-badge">
                                ${escapeHTML(normalizeValue(status))}
                            </span>
                            ${
                                latestCompletion
                                    ? `<span class="completion-status ${getCompletionStatusClass(latestCompletion.submission_status)}">${escapeHTML(getCompletionStatusLabel(latestCompletion.submission_status))}</span>`
                                    : ""
                            }
                        </div>
                    </div>

                    <p class="recommendation-preview">${escapeHTML(item.recommended_action)}</p>

                    <details
                        class="recommendation-more"
                        data-monitoring-id="${escapeHTML(item.monitoring_id)}"
                        ${openMonitoringIds.has(item.monitoring_id) ? "open" : ""}
                    >
                        <summary>
                            <span class="more-label-closed">View Details</span>
                            <span class="more-label-open">Hide Details</span>
                        </summary>

                        <div class="recommendation-more-body">
                            <div class="recommendation-farm">
                                <p><strong>Farm:</strong> ${escapeHTML(getFarmName(item))}</p>
                                <p><strong>Location:</strong> ${escapeHTML(getFarmLocation(item))}</p>
                                <p><strong>Field:</strong> ${escapeHTML(getFieldName(item))}</p>
                                <p><strong>Crop:</strong> ${escapeHTML(getCropName(item))}</p>
                                <p><strong>Growth Stage:</strong> ${escapeHTML(normalizeValue(item.growth_stage))}</p>
                                <p><strong>Crop Health:</strong> ${escapeHTML(normalizeValue(item.crop_health_status))}</p>
                            </div>

                            <div class="recommendation-content">
                                <h4>Recommended Action</h4>
                                <p>${escapeHTML(item.recommended_action)}</p>

                                ${
                                    item.observations
                                        ? `<div class="recommendation-observations"><h4>Technician Observations</h4><p>${escapeHTML(item.observations)}</p></div>`
                                        : ""
                                }

                                ${
                                    item.pest_observed && item.pest_details
                                        ? `<p><strong>Pest Observed:</strong> ${escapeHTML(item.pest_details)}</p>`
                                        : ""
                                }

                                ${
                                    item.disease_observed && item.disease_details
                                        ? `<p><strong>Disease Observed:</strong> ${escapeHTML(item.disease_details)}</p>`
                                        : ""
                                }
                            </div>

                            ${renderCompletionSection(item)}
                        </div>
                    </details>

                    <div class="recommendation-footer">
                        <span>Recorded on ${escapeHTML(formatDate(item.monitoring_date || item.created_at))}</span>
                    </div>
                </article>
            `;
        })
        .join("");
}

// =====================================================
// SEARCH, FILTERS AND DROPDOWN EVENTS
// =====================================================

function initializeFilters() {
    searchInput?.addEventListener("input", renderRecommendations);
    categoryFilter?.addEventListener("change", renderRecommendations);
    priorityFilter?.addEventListener("change", renderRecommendations);
    statusFilter?.addEventListener("change", renderRecommendations);

    recommendationsContainer?.addEventListener("toggle", event => {
        const details = event.target;

        if (!details.matches?.("details.recommendation-more")) return;

        const monitoringId = details.dataset.monitoringId;

        if (!monitoringId) return;

        if (details.open) {
            openMonitoringIds.add(monitoringId);
        } else {
            openMonitoringIds.delete(monitoringId);
        }
    }, true);

    recommendationsContainer?.addEventListener("submit", async event => {
        const form = event.target.closest(".completion-form");

        if (!form) return;

        event.preventDefault();
        await submitCompletion(form);
    });
}

// =====================================================
// LOGOUT
// =====================================================

async function logout() {
    if (!currentUser || !logoutButton || logoutButton.disabled) return;

    logoutButton.disabled = true;
    logoutButton.textContent = "Logging out...";

    try {
        await cleanupRecommendationsRealtime();

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

// =====================================================
// INITIALIZATION
// =====================================================

async function initializeRecommendations() {
    initializeTheme();
    initializeDate();
    initializeFilters();

    logoutButton?.addEventListener("click", logout);

    try {
        const user = await validateFarmer();

        if (!user) return;

        await fetchRecommendations();

        if (recommendationsPageActive) {
            subscribeToRecommendationsRealtime();
        }

    } catch (error) {
        console.error("Recommendations initialization failed:", error);

        if (recommendationsContainer) {
            recommendationsContainer.innerHTML = `
                <div class="error-message">
                    <h3>Unable to load recommendations</h3>
                    <p>Please refresh the page or try again later.</p>
                </div>
            `;
        }
    }
}

initializeRecommendations();