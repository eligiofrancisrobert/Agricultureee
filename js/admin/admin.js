
import { supabase } from "../connection.js";

const logoutButton = document.getElementById("logoutButton");
const refreshButton = document.getElementById("refreshApplications");
const roleFilter = document.getElementById("roleFilter");
const tableBody = document.getElementById("applicationsTableBody");
const message = document.getElementById("applicationMessage");

let checkingAccess = false;
let accessGranted = false;
let pendingApplications = [];

function showMessage(text) {
    if (message) message.textContent = text;
}

function formatRole(role) {
    const normalized = String(role ?? "").toLowerCase();

    const labels = {
        farmer: "Farmer",
        buyer: "Buyer",
        supplier: "Supplier"
    };

    return labels[normalized] ?? String(role ?? "Unknown");
}

function formatDate(dateValue) {
    if (!dateValue) return "—";

    const date = new Date(dateValue);

    if (Number.isNaN(date.getTime())) return "—";

    return date.toLocaleDateString("en-PH", {
        year: "numeric",
        month: "short",
        day: "numeric"
    });
}

function createCell(value) {
    const cell = document.createElement("td");
    cell.textContent = value ?? "—";
    return cell;
}



/** Show a profile and load its farmer, buyer, or supplier details from Supabase. */
async function showApplicationDetails(app) {
    if (!accessGranted) return;

    document.getElementById("applicationDetails")?.remove();

    const panel = document.createElement("section");
    panel.id = "applicationDetails";
    panel.className = "application-details";

    const heading = document.createElement("h2");
    heading.textContent = "Application Details";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "Close";
    closeButton.addEventListener("click", () => panel.remove());

    panel.append(heading, closeButton);

    function addField(label, value) {
        const line = document.createElement("p");
        const strong = document.createElement("strong");

        strong.textContent = `${label}: `;
        line.append(strong, document.createTextNode(
            value === null || value === undefined || value === ""
                ? "—"
                : String(value)
        ));

        panel.appendChild(line);
    }

    function addHeading(text) {
        const element = document.createElement("h3");
        element.textContent = text;
        panel.appendChild(element);
    }

    function addMessage(text) {
        const element = document.createElement("p");
        element.textContent = text;
        panel.appendChild(element);
    }

    document.querySelector(".applications-section")?.appendChild(panel);

    // Basic profile information
    addHeading("Personal Information");
    addField("Full name", app.full_name);
    addField("Email", app.email);
    addField("Phone", app.phone);
    addField("Residential address", app.residential_address);
    addField("Role", formatRole(app.role));
    addField("Status", app.status);
    addField("Date submitted", formatDate(app.created_at));

    try {
        // Load role-specific details.
        addHeading("Additional Information");


        if (app.role === "farmer") {
            const { data: farms, error: farmsError } = await supabase
                .from("farmer_farms")
                .select("id, farm_name, farm_location")
                .eq("farmer_id", app.id)
                .order("created_at", { ascending: true });

            if (farmsError) throw farmsError;

            if (!farms?.length) {
                addField("Farm name", "None listed");
                addField("Farm location", "None listed");
                addField("Crops grown", "None listed");
            }

            for (const farm of farms ?? []) {
                addHeading(`Farm: ${farm.farm_name}`);

                addField("Farm name", farm.farm_name);
                addField("Farm location", farm.farm_location);

                const { data: crops, error: cropsError } = await supabase
                    .from("farmer_farm_crops")
                    .select("crop_name")
                    .eq("farm_id", farm.id)
                    .order("crop_name", { ascending: true });

                if (cropsError) throw cropsError;

                addField(
                    "Crops grown",
                    (crops ?? []).map(crop => crop.crop_name).join(", ") ||
                    "None listed"
                );
            }
        }
        else if (app.role === "buyer") {
            const { data, error } = await supabase
                .from("buyer_details")
                .select("buyer_type, business_name")
                .eq("user_id", app.id)
                .maybeSingle();

            if (error) throw error;

            addField("Buyer type", data?.buyer_type);
            addField("Business name", data?.business_name);

            const { data: interests, error: interestsError } =
                await supabase
                    .from("buyer_interests")
                    .select("product_id")
                    .eq("user_id", app.id);

            if (interestsError) throw interestsError;

            const interestIds = [...new Set(
                (interests ?? []).map(item => item.product_id)
            )];

            let interestNames = [];

            if (interestIds.length) {
                const { data: products, error: productsError } =
                    await supabase
                        .from("products")
                        .select("id, product_name")
                        .in("id", interestIds);

                if (productsError) throw productsError;

                interestNames = (products ?? []).map(p => p.product_name);
            }

            addField(
                "Interested products",
                interestNames.join(", ") || "None listed"
            );

        } else if (app.role === "supplier") {
            const { data, error } = await supabase
                .from("supplier_details")
                .select("business_name, business_address")
                .eq("user_id", app.id)
                .maybeSingle();

            if (error) throw error;

            addField("Business name", data?.business_name);
            addField("Business address", data?.business_address);

            const { data: supplies, error: suppliesError } =
                await supabase
                    .from("supplier_products")
                    .select("product_id")
                    .eq("user_id", app.id);

            if (suppliesError) throw suppliesError;

            const supplyIds = [...new Set(
                (supplies ?? []).map(item => item.product_id)
            )];

            let supplyNames = [];

            if (supplyIds.length) {
                const { data: products, error: productsError } =
                    await supabase
                        .from("products")
                        .select("id, product_name")
                        .in("id", supplyIds);

                if (productsError) throw productsError;

                supplyNames = (products ?? []).map(p => p.product_name);
            }

            addField(
                "Supplied products",
                supplyNames.join(", ") || "None listed"
            );
        }
    } catch (error) {
        console.error("Failed to load applicant details:", error);
        addMessage(
            "Some additional information could not be loaded. Check the browser console and Supabase permissions."
        );
    }

    // Load private registration documents through the Edge Function.
    addHeading("Registration Documents");

    const documentsContainer = document.createElement("div");
    documentsContainer.textContent = "Loading documents...";
    panel.appendChild(documentsContainer);

    try {
        const { data, error } = await supabase.functions.invoke(
            "admin-review-application",
            {
                body: {
                    action: "list",
                    userId: app.id
                }
            }
        );

        if (error) throw error;
        if (data?.error) throw new Error(data.error);

        const documents = data?.documents ?? [];
        documentsContainer.replaceChildren();

        if (!documents.length) {
            documentsContainer.textContent =
                "No registration documents found for this applicant.";
            return;
        }

        for (const doc of documents) {
            const item = document.createElement("div");
            item.className = "document-item";

            const label = document.createElement("p");
            label.textContent =
                `${String(doc.document_type ?? "Document").replaceAll("_", " ")} — ` +
                `Status: ${doc.review_status ?? "Unknown"}`;

            const viewButton = document.createElement("button");
            viewButton.type = "button";
            viewButton.textContent = "View document";

            viewButton.addEventListener("click", async () => {
                if (!accessGranted || viewButton.disabled) return;

                viewButton.disabled = true;
                viewButton.textContent = "Preparing document...";

                try {
                    const { data: result, error: viewError } =
                        await supabase.functions.invoke(
                            "admin-review-application",
                            {
                                body: {
                                    action: "view",
                                    documentId: doc.id
                                }
                            }
                        );

                    if (viewError) throw viewError;
                    if (result?.error) throw new Error(result.error);
                    if (!result?.signedUrl) {
                        throw new Error("No document viewing link was returned.");
                    }

                    const opened = window.open(
                        result.signedUrl,
                        "_blank",
                        "noopener,noreferrer"
                    );

                    if (!opened) {
                        alert(
                            "The browser may have blocked the new tab. Allow pop-ups and try again."
                        );
                    }
                } catch (error) {
                    console.error("Document viewing failed:", error);
                    alert("Could not open the document. Check the browser console.");
                } finally {
                    viewButton.disabled = false;
                    viewButton.textContent = "View document";
                }
            });

            item.append(label, viewButton);
            documentsContainer.appendChild(item);
        }
    } catch (error) {
        console.error("Failed to load registration documents:", error);
        documentsContainer.textContent =
            "Could not load documents. Check the browser console and Edge Function logs.";
    }
}

/** Filter loaded application profiles and rebuild the applications table. */
function renderApplications() {
    if (!tableBody) return;

    tableBody.replaceChildren();

    const selectedRole = roleFilter?.value ?? "all";

    const filteredApplications = pendingApplications.filter((app) => {
        return selectedRole === "all" ||
            String(app.role).toLowerCase() === selectedRole;
    });

    if (filteredApplications.length === 0) {
        showMessage(
            selectedRole === "all"
                ? "No pending applications found."
                : `No pending ${selectedRole} applications found.`
        );
        return;
    }

    for (const app of filteredApplications) {
        const row = document.createElement("tr");

        row.append(
            createCell(app.full_name),
            createCell(app.email),
            createCell(formatRole(app.role)),
            createCell(formatDate(app.created_at)),
            createCell(app.status)
        );

        const actionCell = document.createElement("td");
        const viewButton = document.createElement("button");

        viewButton.type = "button";
        viewButton.textContent = "View details";

        viewButton.addEventListener("click", () => {
            showApplicationDetails(app);
        });

        actionCell.appendChild(viewButton);
        row.appendChild(actionCell);
        tableBody.appendChild(row);
    }

    showMessage(`${filteredApplications.length} pending application(s).`);
}


/** Fetch application profiles and update the current application list. */
async function loadApplications() {
    if (!accessGranted) return;

    if (refreshButton) refreshButton.disabled = true;
    showMessage("Loading applications...");

    try {
        const { data, error } = await supabase
            .from("profiles")
            .select(
                "id, full_name, email, phone, residential_address, role, status, created_at"
            )
            .eq("status", "pending")
            .order("created_at", { ascending: false });

        if (error) throw error;

        pendingApplications = data ?? [];
        renderApplications();
    } catch (error) {
        console.error("Failed to load applications:", error);
        pendingApplications = [];
        tableBody?.replaceChildren();

        showMessage(
            "Could not load applications. Check the browser console and Supabase permissions."
        );
    } finally {
        if (refreshButton) refreshButton.disabled = false;
    }
}

/** Verify the signed-in user is an administrator before enabling this page. */
async function verifyAdminAccess() {
    if (checkingAccess) return;
    checkingAccess = true;
    accessGranted = false;

    document.documentElement.classList.remove("admin-authorized");

    try {
        const {
            data: { user },
            error: userError
        } = await supabase.auth.getUser();

        if (userError || !user) {
            window.location.replace("./login.html");
            return;
        }

        const { data: admin, error: adminError } = await supabase
            .from("admin_users")
            .select("user_id")
            .eq("user_id", user.id)
            .maybeSingle();

        if (adminError) {
            console.error("Admin lookup failed:", adminError);
            window.location.replace("./login.html");
            return;
        }

        if (!admin) {
            await supabase.auth.signOut();
            window.location.replace("./login.html");
            return;
        }

        accessGranted = true;
        document.documentElement.classList.add("admin-authorized");

        await loadApplications();
    } catch (error) {
        console.error("Admin verification failed:", error);
        window.location.replace("./login.html");
    } finally {
        checkingAccess = false;
    }
}

roleFilter?.addEventListener("change", renderApplications);
refreshButton?.addEventListener("click", loadApplications);

verifyAdminAccess();

window.addEventListener("pageshow", async (event) => {
    if (event.persisted) {
        document.documentElement.classList.remove("admin-authorized");
        accessGranted = false;
        await verifyAdminAccess();
    }
});

logoutButton?.addEventListener("click", async () => {
    if (logoutButton.disabled) return;

    logoutButton.disabled = true;
    logoutButton.textContent = "Logging out...";

    document.documentElement.classList.remove("admin-authorized");
    accessGranted = false;

    const { error } = await supabase.auth.signOut();

    if (error) {
        console.error("Logout failed:", error);
        alert("Logout failed. Please try again.");

        logoutButton.disabled = false;
        logoutButton.textContent = "Logout";

        await verifyAdminAccess();
        return;
    }

    window.location.replace("./login.html");
});
