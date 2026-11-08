const roleSelect = document.getElementById('role');

/** Clear a conditional form field without changing checkbox/radio values. */
function clearField(field) {
    if (field.type === 'checkbox' || field.type === 'radio') {
        // Uncheck only. Never touch .value, because it holds the crop name.
        if (field.checked) {
            field.checked = false;
            // Lets the crop picker update its summary and hide "Other crop".
            field.dispatchEvent(new Event('change', { bubbles: true }));
        }
    } else if (field.tagName === 'SELECT') {
        field.selectedIndex = 0;
    } else {
        // text, file, textarea
        field.value = '';
    }
}

/** Show the selected role's fields and update their required state. */
function updateConditionalFields() {
    const selectedRole = roleSelect.value;

    document.querySelectorAll('.role-section').forEach(section => {
        const visible = section.dataset.role === selectedRole;

        if (!visible) {
            section.querySelectorAll('input, select, textarea')
                .forEach(clearField);
        }

        section.hidden = !visible;

        section.querySelectorAll('[data-required="true"]')
            .forEach(field => {
                field.required = visible;
            });
    });

    updateBuyerBusinessFields();
}

/** Toggle business-only buyer fields and clear them when hidden. */
function updateBuyerBusinessFields() {
    const isBusiness =
        roleSelect.value === 'buyer' &&
        document.getElementById('buyerType').value === 'business';

    document.querySelectorAll('.conditional-business')
        .forEach(section => {
            section.hidden = !isBusiness;

            section.querySelectorAll('[data-required="true"]')
                .forEach(field => {
                    field.required = isBusiness;

                    if (!isBusiness) {
                        clearField(field);
                    }
                });
        });
}

roleSelect.addEventListener('change', updateConditionalFields);

document.getElementById('buyerType')
    .addEventListener('change', updateBuyerBusinessFields);

updateConditionalFields();