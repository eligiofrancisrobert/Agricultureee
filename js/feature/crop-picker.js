
const cropPicker = document.getElementById("cropPicker");

if (cropPicker) {
    const trigger = document.getElementById("cropPickerTrigger");
    const dropdown = document.getElementById("cropPickerDropdown");
    const summary = document.getElementById("cropPickerSummary");
    const clearButton = document.getElementById("clearCrops");
    const doneButton = document.getElementById("doneCrops");

    const otherCheckbox = document.getElementById("otherCropCheckbox");
    const otherField = document.getElementById("otherCropField");
    const otherInput = document.getElementById("otherCropInput");

    const cropInputs = Array.from(
        cropPicker.querySelectorAll('input[name="crops"]')
    );


    function getSelectedCrops() {
        const listedCrops = cropInputs
            .filter(input => input.checked)
            .map(input => input.value.trim())
            .filter(Boolean);

        const customCrops = otherCheckbox.checked
            ? otherInput.value
                .split(",")
                .map(crop => crop.trim())
                .filter(Boolean)
            : [];

        return [...new Set([...listedCrops, ...customCrops])];
    }

    window.getSelectedTanikalaCrops = getSelectedCrops;

    function updateCropSummary() {
        const crops = getSelectedCrops();

        if (crops.length === 0) {
            summary.textContent = "Choose your crops";
        } else if (crops.length <= 2) {
            summary.textContent = crops.join(", ");
        } else {
            summary.textContent = `${crops.length} crops selected`;
        }
    }

    function closeCropDropdown() {
        dropdown.hidden = true;
        trigger.setAttribute("aria-expanded", "false");
    }

    trigger.addEventListener("click", () => {
        const isOpen = trigger.getAttribute("aria-expanded") === "true";

        dropdown.hidden = isOpen;
        trigger.setAttribute("aria-expanded", String(!isOpen));
    });

    cropInputs.forEach(input => {
        input.addEventListener("change", updateCropSummary);
    });

    otherCheckbox.addEventListener("change", () => {
        otherField.hidden = !otherCheckbox.checked;

        if (!otherCheckbox.checked) {
            otherInput.value = "";
        }

        updateCropSummary();
    });

    otherInput.addEventListener("input", updateCropSummary);

    clearButton.addEventListener("click", () => {
        cropInputs.forEach(input => {
            input.checked = false;
        });

        otherCheckbox.checked = false;
        otherInput.value = "";
        otherField.hidden = true;

        updateCropSummary();
    });

    doneButton.addEventListener("click", closeCropDropdown);

    document.addEventListener("click", event => {
        if (!cropPicker.contains(event.target)) {
            closeCropDropdown();
        }
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            closeCropDropdown();
            trigger.focus();
        }
    });

    updateCropSummary();
}
