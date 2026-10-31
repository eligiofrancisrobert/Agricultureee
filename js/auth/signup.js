
import { supabase } from "../connection.js";

const form = document.getElementById("signupForm");
const message = document.getElementById("message");
const button = document.getElementById("signupButton");

const roleSelect = document.getElementById("role");
const farmerTypeSelect = document.getElementById("farmerType");
const ownerOperatorFields = document.getElementById("ownerOperatorFields");
const nonOwnerFarmerNotice = document.getElementById("nonOwnerFarmerNotice");
const farmsContainer = document.getElementById("farmsContainer");
const farmTemplate = document.getElementById("farmTemplate");
const addFarmButton = document.getElementById("addFarmButton");

const farmProofField = document.getElementById("farmProofField");
const farmProofInput = document.getElementById("farmProof");
const farmerDocumentHint = document.getElementById("farmerDocumentHint");

let farmCounter = 0;

function showMessage(text, error = false) {
    if (!message) return;

    message.hidden = false;
    message.textContent = text;
    message.classList.toggle("error", error);
}

function clearMessage() {
    if (!message) return;

    message.hidden = true;
    message.textContent = "";
    message.classList.remove("error");
}

function value(id) {
    return document.getElementById(id)?.value.trim() ?? "";
}

function getFile(id) {
    return document.getElementById(id)?.files?.[0] ?? null;
}

function appendValue(data, key, id) {
    data.append(key, value(id));
}

function appendFile(data, key, id, label, required = true) {
    const file = getFile(id);

    if (!file && required) {
        throw new Error(`Please upload your ${label}.`);
    }

    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
        throw new Error(`${label} must be 5 MB or smaller.`);
    }

    const allowedTypes = [
        "application/pdf",
        "image/jpeg",
        "image/png",
    ];

    if (!allowedTypes.includes(file.type)) {
        throw new Error(`${label} must be a PDF, JPG, or PNG.`);
    }

    data.append(key, file, file.name);
}

function uniqueCrops(crops) {
    const seen = new Set();

    return crops
        .map(crop => String(crop).trim())
        .filter(crop => {
            if (!crop) return false;

            const key = crop.toLocaleLowerCase();

            if (seen.has(key)) return false;

            seen.add(key);
            return true;
        });
}

/*
 * Read crops from one farm card only.
 * Each farm owns its own crop checkboxes and custom crop input.
 */
function selectedCropsForFarm(farmCard) {
    const listed = Array.from(
        farmCard.querySelectorAll(
            '[data-crop]:checked'
        )
    )
        .map(input => input.dataset.crop || input.value)
        .filter(Boolean);

    const otherCheckbox = farmCard.querySelector(
        '[data-action="other-crop-toggle"]'
    );

    const otherInput = farmCard.querySelector(
        '[data-field="otherCropInput"]'
    );

    const custom = otherCheckbox?.checked
        ? (otherInput?.value ?? "")
            .split(",")
            .map(crop => crop.trim())
            .filter(Boolean)
        : [];

    return uniqueCrops([...listed, ...custom]);
}

function updateCropSummary(farmCard) {
    const summary = farmCard.querySelector(
        '[data-field="cropSummary"]'
    );

    if (!summary) return;

    const crops = selectedCropsForFarm(farmCard);

    if (crops.length === 0) {
        summary.textContent = "Choose your crops";
    } else if (crops.length <= 2) {
        summary.textContent = crops.join(", ");
    } else {
        summary.textContent = `${crops.length} crops selected`;
    }
}

function updateOtherCropField(farmCard) {
    const checkbox = farmCard.querySelector(
        '[data-action="other-crop-toggle"]'
    );

    const field = farmCard.querySelector(
        '[data-field="otherCropField"]'
    );

    if (!checkbox || !field) return;

    field.hidden = !checkbox.checked;

    if (!checkbox.checked) {
        const input = field.querySelector(
            '[data-field="otherCropInput"]'
        );

        if (input) input.value = "";
    }

    updateCropSummary(farmCard);
}

function updateFarmNumbers() {
    if (!farmsContainer) return;

    const farmCards = Array.from(
        farmsContainer.querySelectorAll(".farm-entry")
    );

    farmCards.forEach((card, index) => {
        const number = card.querySelector(".farm-entry-number");
        const title = card.querySelector(".farm-entry-title");
        const removeButton = card.querySelector(
            '[data-action="remove-farm"]'
        );

        if (number) number.textContent = `F ${index + 1}`;
        if (title) title.textContent = `Farm  ${index + 1} Details`;

        if (removeButton) {
            removeButton.hidden = farmCards.length === 1;
        }
    });
}


function addFarm() {
    if (!farmTemplate || !farmsContainer) {
        throw new Error(
            "The farm registration form could not be loaded."
        );
    }

    const fragment = farmTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".farm-entry");

    if (!card) {
        throw new Error("The farm form template is invalid.");
    }

    farmCounter += 1;
    card.dataset.farmIndex = String(farmCounter);

    const requiredElements = {
        nameInput: '[data-field="farmName"]',
        locationInput: '[data-field="farmLocation"]',
        cropDropdown: '[data-field="cropDropdown"]',
        cropTrigger: '[data-action="toggle-crops"]',
        cropSummary: '[data-field="cropSummary"]',
        otherInput: '[data-field="otherCropInput"]',
        farmNameLabel: '[data-label="farm-name"]',
        farmLocationLabel: '[data-label="farm-location"]',
        cropLabel: ".crop-picker-group > label",
        otherCropLabel: ".other-crop-field > label",
    };

    const elements = {};

    for (const [name, selector] of Object.entries(requiredElements)) {
        elements[name] = card.querySelector(selector);

        if (!elements[name]) {
            throw new Error(
                `Farm template is missing "${name}" (${selector}).`
            );
        }
    }

    const nameId = `farmName_${farmCounter}`;
    const locationId = `farmLocation_${farmCounter}`;
    const cropDropdownId = `farmCropDropdown_${farmCounter}`;
    const otherInputId = `farmOtherCrop_${farmCounter}`;

    elements.nameInput.id = nameId;
    elements.locationInput.id = locationId;
    elements.cropDropdown.id = cropDropdownId;
    elements.otherInput.id = otherInputId;

    elements.farmNameLabel.htmlFor = nameId;
    elements.farmLocationLabel.htmlFor = locationId;
    elements.cropLabel.id = `farmCropsLabel_${farmCounter}`;
    elements.otherCropLabel.htmlFor = otherInputId;

    elements.cropTrigger.setAttribute(
        "aria-controls",
        cropDropdownId
    );

    elements.cropTrigger.setAttribute(
        "aria-labelledby",
        `farmCropsLabel_${farmCounter}`
    );

    elements.cropDropdown.hidden = true;
    elements.cropTrigger.setAttribute("aria-expanded", "false");
    elements.cropSummary.textContent = "Choose your crops";

    farmsContainer.appendChild(fragment);

    updateFarmNumbers();

    return card;
}


function resetFarms() {
    if (!farmsContainer) return;

    farmsContainer.replaceChildren();
    farmCounter = 0;
}

function setFieldRequired(element, required) {
    if (!element) return;

    element.required = required;
}

function updateRoleSections() {
    const role = roleSelect?.value ?? "";

    document.querySelectorAll(".role-section[data-role]").forEach(section => {
        const visible = section.dataset.role === role;

        section.hidden = !visible;

        section.querySelectorAll("input, select, textarea").forEach(input => {
            if (input.type === "file") {
                input.disabled = !visible;
            }
        });
    });

    updateBuyerTypeFields();
    updateFarmerTypeFields();
}

function updateConditionalRequiredFields() {
    document.querySelectorAll("[data-required]").forEach(input => {
        const containingSection = input.closest(
            ".role-section[data-role]"
        );

        const visibleSection = !containingSection || !containingSection.hidden;
        const visibleField = !input.closest("[hidden]");

        input.required =
            input.dataset.required === "true" &&
            visibleSection &&
            visibleField;
    });
}

function updateBuyerTypeFields() {
    const buyerType = value("buyerType");
    const businessBuyer = roleSelect?.value === "buyer" &&
        buyerType === "business";

    document.querySelectorAll(
        '[data-role="buyer"] .conditional-business'
    ).forEach(field => {
        field.hidden = !businessBuyer;

        field.querySelectorAll("input, select").forEach(input => {
            input.disabled = !businessBuyer;
        });
    });

    updateConditionalRequiredFields();
}

function updateFarmerTypeFields() {
    const isFarmer = roleSelect?.value === "farmer";
    const farmerType = farmerTypeSelect?.value ?? "";
    const isOwner = isFarmer && farmerType === "owner_operator";
    const isNonOwner = isFarmer &&
        ["tenant_lessee", "hired_farmer"].includes(farmerType);
    const farmerTypeReminder = document.getElementById("farmerTypeReminder");
    const ownerFarmReminder = document.getElementById("ownerFarmReminder");

    if (ownerOperatorFields) {
        ownerOperatorFields.hidden = !isOwner;
    }

    if (nonOwnerFarmerNotice) {
        nonOwnerFarmerNotice.hidden = !isNonOwner;
    }

    if (farmProofField) {
        farmProofField.hidden = !isOwner;
    }

    if (farmerDocumentHint) {
        farmerDocumentHint.hidden = !isNonOwner;
    }

    if (farmProofInput) {
        farmProofInput.disabled = !isOwner;
        farmProofInput.required = isOwner;
    }

    if (farmsContainer) {
        farmsContainer.querySelectorAll("input").forEach(input => {
            input.disabled = !isOwner;
        });
    }

    updateConditionalRequiredFields();

    function updateFarmReminders() {
        const farmerType = document.getElementById("farmerType")?.value;
        const isOwner = farmerType === "owner_operator";

        if (farmerTypeReminder) {
            farmerTypeReminder.hidden = !isOwner;
        }

        if (ownerFarmReminder) {
            ownerFarmReminder.hidden = !isOwner;
        }

        document
            .querySelectorAll("[data-farm-location-reminder]")
            .forEach((reminder) => {
                reminder.hidden = !isOwner;
            });
    }
}

function resetRoleSpecificFields() {
    resetFarms();

    if (farmerTypeSelect) {
        farmerTypeSelect.value = "";
    }

    if (farmProofInput) {
        farmProofInput.value = "";
    }

    if (farmProofField) farmProofField.hidden = true;
    if (farmerDocumentHint) farmerDocumentHint.hidden = true;

    if (ownerOperatorFields) ownerOperatorFields.hidden = true;
    if (nonOwnerFarmerNotice) nonOwnerFarmerNotice.hidden = true;
}

function validateFarms() {
    const farmerType = value("farmerType");

    if (!["owner_operator", "tenant_lessee", "hired_farmer"].includes(farmerType)) {
        throw new Error("Please select your farmer type.");
    }

    if (farmerType !== "owner_operator") {
        return [];
    }

    const farmCards = Array.from(
        farmsContainer?.querySelectorAll(".farm-entry") ?? []
    );

    if (farmCards.length === 0) {
        throw new Error("Please add at least one farm.");
    }

    return farmCards.map((card, index) => {
        const farmName = card.querySelector('[data-field="farmName"]')
            ?.value.trim() ?? "";

        const farmLocation = card.querySelector('[data-field="farmLocation"]')
            ?.value.trim() ?? "";

        if (!farmName) {
            throw new Error(`Please enter a name for Farm ${index + 1}.`);
        }

        if (!farmLocation) {
            throw new Error(`Please enter the location for Farm ${index + 1}.`);
        }

        const crops = selectedCropsForFarm(card);

        if (crops.length === 0) {
            throw new Error(`Please select at least one crop for Farm ${index + 1}.`);
        }

        return {
            farmName,
            farmLocation,
            crops,
        };
    });
}

function appendFarmRegistration(data, farms) {
    data.append("farmerType", value("farmerType"));
    data.append("farms", JSON.stringify(farms));

    // Backward compatibility: legacy trigger/consumers may read these fields.
    if (farms.length > 0) {
        data.append("farmName", farms[0].farmName);
        data.append("farmLocation", farms[0].farmLocation);
        data.append("crops", JSON.stringify(farms[0].crops));
    } else {
        data.append("farmName", "");
        data.append("farmLocation", "");
        data.append("crops", JSON.stringify([]));
    }
}

// Submit registration through the existing Supabase Edge Function.
async function submitRegistration(data) {
    const { data: result, error } =
        await supabase.functions.invoke("register-applicant", {
            body: data,
        });

    if (error) {
        console.error("Edge Function error:", error);

        let details = error.message || "Registration request failed.";

        try {
            if (error.context) {
                const response = await error.context.clone().text();

                console.error("Edge Function response:", response);

                if (response) {
                    try {
                        const parsed = JSON.parse(response);
                        details = parsed.error || parsed.message || response;
                    } catch {
                        details = response;
                    }
                }
            }
        } catch (readError) {
            console.error("Could not read error response:", readError);
        }

        throw new Error(details);
    }

    if (!result?.success) {
        console.error("Registration result:", result);

        throw new Error(
            result?.error || "Registration could not be completed."
        );
    }

    return result;
}

/*
 * Dynamic farm crop-picker interactions.
 * Event delegation allows newly added farm cards to work automatically.
 */
farmsContainer?.addEventListener("click", event => {
    const actionButton = event.target.closest("button[data-action]");

    if (!actionButton) return;

    const card = actionButton.closest(".farm-entry");
    if (!card) return;

    const action = actionButton.dataset.action;

    if (action === "remove-farm") {
        const cards = farmsContainer.querySelectorAll(".farm-entry");

        if (cards.length <= 1) {
            showMessage("At least one farm is required for an Owner/Operator.", true);
            return;
        }

        card.remove();
        updateFarmNumbers();
        clearMessage();
        return;
    }

    if (action === "toggle-crops") {
        const dropdown = card.querySelector('[data-field="cropDropdown"]');
        const isOpen = actionButton.getAttribute("aria-expanded") === "true";

        dropdown.hidden = isOpen;
        actionButton.setAttribute("aria-expanded", String(!isOpen));
        return;
    }

    if (action === "clear-crops") {
        card.querySelectorAll("[data-crop]").forEach(input => {
            input.checked = false;
        });

        const otherCheckbox = card.querySelector(
            '[data-action="other-crop-toggle"]'
        );

        if (otherCheckbox) otherCheckbox.checked = false;

        const otherInput = card.querySelector(
            '[data-field="otherCropInput"]'
        );

        if (otherInput) otherInput.value = "";

        updateOtherCropField(card);
        return;
    }

    if (action === "done-crops") {
        const dropdown = card.querySelector('[data-field="cropDropdown"]');
        const trigger = card.querySelector('[data-action="toggle-crops"]');

        dropdown.hidden = true;
        trigger.setAttribute("aria-expanded", "false");
    }
});

farmsContainer?.addEventListener("change", event => {
    const card = event.target.closest(".farm-entry");
    if (!card) return;

    if (
        event.target.matches("[data-crop]") ||
        event.target.matches('[data-action="other-crop-toggle"]')
    ) {
        updateOtherCropField(card);
    }
});

farmsContainer?.addEventListener("input", event => {
    const card = event.target.closest(".farm-entry");
    if (!card) return;

    if (event.target.matches('[data-field="otherCropInput"]')) {
        updateCropSummary(card);
    }
});

addFarmButton?.addEventListener("click", () => {
    console.log("Add farm button clicked");

    try {
        const card = addFarm();

        console.log("Farm card created:", card);
        console.log(
            "Number of farm cards:",
            farmsContainer.querySelectorAll(".farm-entry").length
        );

        updateFarmerTypeFields();
        clearMessage();
    } catch (error) {
        console.error("Add farm failed:", error);
        showMessage(error.message || "Could not add another farm.", true);
    }
});

roleSelect?.addEventListener("change", () => {
    resetRoleSpecificFields();
    updateRoleSections();
    clearMessage();
});

farmerTypeSelect?.addEventListener("change", () => {
    updateFarmerTypeFields();
    clearMessage();
});

document.getElementById("buyerType")?.addEventListener("change", () => {
    updateBuyerTypeFields();
    clearMessage();
});

// Show / Hide Password
document.querySelectorAll(".toggle-password").forEach((button) => {
    button.addEventListener("click", () => {
        const targetId = button.dataset.target;
        const passwordInput = targetId
            ? document.getElementById(targetId)
            : button.parentElement.querySelector("input");

        if (!passwordInput) return;

        const isPassword = passwordInput.type === "password";
        passwordInput.type = isPassword ? "text" : "password";

        button.setAttribute(
            "aria-label",
            isPassword ? "Hide password" : "Show password"
        );

        button.setAttribute(
            "aria-pressed",
            String(isPassword)
        );
    });
});

// Initialize role-dependent fields.
updateRoleSections();
updateConditionalRequiredFields();

if (!form) {
    console.error('Signup form with ID "signupForm" was not found.');
} else {
    form.addEventListener("submit", async event => {
        event.preventDefault();
        clearMessage();

        updateConditionalRequiredFields();

        if (!form.checkValidity()) {
            form.reportValidity();
            return;
        }

        const firstName = value("firstName");
        const middleName = value("middleName");
        const surname = value("surname");
        const suffix = value("suffix");

        const fullName = [
            firstName,
            middleName,
            surname,
            suffix,
        ].filter(Boolean).join(" ");

        const email = value("email").toLowerCase();
        const password = document.getElementById("password")?.value ?? "";
        const confirmPassword =
            document.getElementById("confirmPassword")?.value ?? "";
        const role = value("role");

        const strongPassword =
            password.length >= 12 &&
            /[a-z]/.test(password) &&
            /[A-Z]/.test(password) &&
            /\d/.test(password) &&
            /[^A-Za-z0-9]/.test(password);

        if (!strongPassword) {
            showMessage(
                "Password must be at least 12 characters and include " +
                "a lowercase letter, an uppercase letter, a number, " +
                "and a symbol.",
                true
            );
            return;
        }

        if (password !== confirmPassword) {
            showMessage("Passwords do not match.", true);
            return;
        }

        if (!["farmer", "buyer", "supplier"].includes(role)) {
            showMessage("Please select a valid account type.", true);
            return;
        }

        if (button) {
            button.disabled = true;
            button.textContent = "Submitting registration...";
        }

        try {
            const data = new FormData();

            // Shared account information.
            data.append("firstName", firstName);
            data.append("middleName", middleName);
            data.append("surname", surname);
            data.append("suffix", suffix);
            data.append("fullName", fullName);
            data.append("email", email);
            data.append("password", password);
            data.append("role", role);

            appendValue(data, "phone", "phone");
            appendValue(data, "address", "address");

            // FARMER REGISTRATION.
            if (role === "farmer") {
                const farms = validateFarms();

                appendFarmRegistration(data, farms);

                appendFile(
                    data,
                    "farmerId",
                    "farmerId",
                    "valid ID"
                );

                const farmerType = value("farmerType");

                if (farmerType === "owner_operator") {
                    appendFile(
                        data,
                        "farmProof",
                        "farmProof",
                        "proof of farm ownership or operation"
                    );
                }
            }

            // BUYER REGISTRATION.
            if (role === "buyer") {
                appendValue(data, "buyerType", "buyerType");
                appendValue(data, "businessName", "buyerBusinessName");
                appendValue(data, "buyerProducts", "buyerProducts");

                appendFile(
                    data,
                    "buyerId",
                    "buyerId",
                    "valid ID"
                );

                if (value("buyerType") === "business") {
                    appendFile(
                        data,
                        "buyerPermit",
                        "buyerPermit",
                        "business permit"
                    );
                }
            }

            // SUPPLIER REGISTRATION.
            if (role === "supplier") {
                appendValue(data, "businessName", "supplierName");
                appendValue(data, "businessAddress", "supplierAddress");
                appendValue(data, "productsSupplied", "productsSupplied");

                appendFile(
                    data,
                    "supplierId",
                    "supplierId",
                    "valid ID"
                );

                appendFile(
                    data,
                    "businessPermit",
                    "supplierPermit",
                    "business permit"
                );
            }

            const result = await submitRegistration(data);

            showMessage(
                result.message ||
                "Registration submitted successfully. " +
                "Your application is pending administrator review."
            );

            form.reset();
            resetRoleSpecificFields();
            updateRoleSections();

        } catch (error) {
            console.error("Signup failed:", error);

            showMessage(
                error.message || "Registration failed. Please try again.",
                true
            );
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = "Submit Registration";
            }
        }
    });
}
