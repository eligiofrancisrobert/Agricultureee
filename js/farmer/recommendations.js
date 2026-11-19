import { supabase } from "../connection.js";

const recommendationList = document.getElementById("recommendationList");
const searchInput = document.getElementById("recommendationSearch");
const sourceFilter = document.getElementById("recommendationSource");

const totalRecommendations = document.getElementById("totalRecommendations");
const monitoringCount = document.getElementById("monitoringCount");
const inspectionCount = document.getElementById("inspectionCount");

let recommendations = [];

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

function updateSummary() {
    totalRecommendations.textContent = recommendations.length;

    monitoringCount.textContent = recommendations.filter(
        item => item.source === "monitoring"
    ).length;

    inspectionCount.textContent = recommendations.filter(
        item => item.source === "inspection"
    ).length;
}

function renderRecommendations() {
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

async function loadRecommendations() {
    try {
        recommendationList.innerHTML = `
            <div class="loading-state">Loading recommendations...</div>
        `;

        const {
            data: { user },
            error: authError
        } = await supabase.auth.getUser();

        if (authError) throw authError;

        if (!user) {
            window.location.href = "../../login.html";
            return;
        }

        console.log("[Recommendations] Current farmer:", user.id);

        // 1. Retrieve the current farmer's plantings.
        const { data: plantings, error: plantingError } = await supabase
            .from("farm_plantings")
            .select("*")
            .eq("farmer_id", user.id);

        if (plantingError) throw plantingError;

        console.log("[Recommendations] Farmer plantings:", plantings);

        const plantingIds = (plantings || [])
            .map(planting => planting.id)
            .filter(Boolean);

        if (!plantingIds.length) {
            recommendations = [];
            updateSummary();

            recommendationList.innerHTML = `
                <div class="loading-state">
                    No plantings are currently linked to your account.
                </div>
            `;

            return;
        }

        const plantingMap = new Map(
            plantings.map(planting => [planting.id, planting])
        );

        // 2. Retrieve crop monitoring records.
        const { data: monitoringRecords, error: monitoringError } =
            await supabase
                .from("agricultural_technician_crop_monitoring")
                .select("*")
                .in("planting_id", plantingIds)
                .in("monitoring_status", ["submitted", "reviewed"])
                .order("monitoring_date", { ascending: false });

        if (monitoringError) throw monitoringError;

        console.log(
            "[Recommendations] Monitoring records:",
            monitoringRecords
        );

        // 3. Retrieve inspection records.
        // Exclude drafts so unfinished technician entries are not displayed.
        const { data: inspectionRecords, error: inspectionError } =
            await supabase
                .from("agricultural_inspections")
                .select("*")
                .in("planting_id", plantingIds)
                .order("inspection_date", { ascending: false });

        if (inspectionError) throw inspectionError;

        console.log(
            "[Recommendations] Inspection records:",
            inspectionRecords
        );

        // 4. Format monitoring recommendations.
        const monitoringItems = (monitoringRecords || []).map(record => {
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

        // 5. Format submitted/finalized inspection recommendations.
        const inspectionItems = (inspectionRecords || [])
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

        // 6. Combine both sources.
        recommendations = [
            ...monitoringItems,
            ...inspectionItems
        ].sort((a, b) => {
            return new Date(b.date || 0) - new Date(a.date || 0);
        });

        console.log(
            "[Recommendations] Final displayed records:",
            recommendations
        );

        updateSummary();
        renderRecommendations();

    } catch (error) {
        console.error("[Recommendations] Loading failed:", error);

        recommendationList.innerHTML = `
            <div class="loading-state">
                Unable to load recommendations.
                <br><br>
                ${escapeHTML(error.message)}
            </div>
        `;
    }
}

searchInput?.addEventListener("input", renderRecommendations);
sourceFilter?.addEventListener("change", renderRecommendations);

loadRecommendations();