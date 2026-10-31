
document.querySelectorAll('.password-toggle[data-target]').forEach((button) => {
    button.addEventListener('click', (event) => {
        if (event.passwordToggleHandled) return;
        event.passwordToggleHandled = true;

        const input = document.getElementById(button.dataset.target);

        if (!input) return;

        const isHidden = input.type === 'password';

        input.type = isHidden ? 'text' : 'password';
        button.textContent = isHidden ? 'Hide' : 'Show';
        button.setAttribute(
            'aria-label',
            isHidden ? 'Hide password' : 'Show password'
        );
    });
});

const form = document.getElementById("resetPasswordForm");
const passwordInput = document.getElementById("newPassword");
const confirmPasswordInput = document.getElementById("confirmPassword");
const message = document.getElementById("message");
const saveButton = document.getElementById("saveButton");

// Loaded only when needed, so a problem in connection.js shows up as a
// readable message on submit instead of silently breaking the page.
async function getSupabase() {
    const module = await import("./connection.js");
    return module.supabase;
}

function showMessage(text, isError = false) {
    message.textContent = text;
    message.hidden = false;
    message.setAttribute("aria-live", isError ? "assertive" : "polite");
    message.style.background = isError ? "#FCE8E6" : "#E8EDDF";
    message.style.color = isError ? "#A12622" : "#35452D";
}

function isStrongPassword(password) {
    return (
        password.length >= 12 &&
        /[a-z]/.test(password) &&
        /[A-Z]/.test(password) &&
        /\d/.test(password) &&
        /[^A-Za-z0-9]/.test(password)
    );
}

form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const password = passwordInput.value;
    const confirmPassword = confirmPasswordInput.value;

    if (!isStrongPassword(password)) {
        showMessage(
            "Use at least 12 characters, including uppercase and lowercase letters, a number, and a symbol.",
            true
        );
        return;
    }

    if (password !== confirmPassword) {
        showMessage("The passwords do not match.", true);
        return;
    }

    saveButton.disabled = true;

    const buttonText = saveButton.querySelector("span");
    if (buttonText) buttonText.textContent = "Updating...";

    try {
        const supabase = await getSupabase();

        const { data: sessionData, error: sessionError } =
            await supabase.auth.getSession();

        if (sessionError) throw sessionError;

        if (!sessionData.session) {
            showMessage(
                "Your recovery session is missing or expired. Please request a new password reset link.",
                true
            );
            return;
        }

        const { error } = await supabase.auth.updateUser({
            password
        });

        if (error) throw error;

        showMessage(
            "Your password has been changed successfully. You can now log in with your new password."
        );

        form.reset();

        // form.reset() does not change the input type, so put the fields and
        // their buttons back to the hidden state.
        document.querySelectorAll('.password-toggle[data-target]').forEach((button) => {
            const input = document.getElementById(button.dataset.target);
            if (input) input.type = 'password';
            button.textContent = 'Show';
            button.setAttribute('aria-label', 'Show password');
        });

        await supabase.auth.signOut({ scope: "local" });
    } catch (error) {
        console.error("Password update error:", error);
        showMessage(
            error.message || "Unable to update your password. Please try again.",
            true
        );
    } finally {
        saveButton.disabled = false;
        if (buttonText) buttonText.textContent = "Save new password";
    }
});XMLDocument