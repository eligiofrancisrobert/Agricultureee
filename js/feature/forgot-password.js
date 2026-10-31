
import { supabase } from "./connection.js";

const form = document.getElementById("forgotPasswordForm");
const emailInput = document.getElementById("email");
const message = document.getElementById("message");
const resetButton = document.getElementById("resetButton");

function showMessage(text, isError = false) {
    message.textContent = text;
    message.hidden = false;
    message.setAttribute("aria-live", isError ? "assertive" : "polite");
    message.style.background = isError ? "#FCE8E6" : "#E8EDDF";
    message.style.color = isError ? "#A12622" : "#35452D";
}

form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = emailInput.value.trim().toLowerCase();

    if (!emailInput.validity.valid || !email) {
        showMessage("Please enter a valid email address.", true);
        return;
    }

    resetButton.disabled = true;
    resetButton.querySelector("span").textContent = "Sending...";
    message.hidden = true;

    try {
        const redirectTo = window.location.hostname === "127.0.0.1" ||
            window.location.hostname === "localhost"
            ? "http://127.0.0.1:5500/html/reset-password.html"
            : "https://eligiofrancisrobert.github.io/Tanikala/html/reset-password.html";

        const { error } = await supabase.auth.resetPasswordForEmail(
            email,
            { redirectTo }
        );

        if (error) throw error;

        showMessage(
            "If an account exists with that email, a password reset link has been sent. Please check your inbox and spam folder."
        );

        form.reset();
    } catch (error) {
        console.error("Password recovery error:", error);
        showMessage(
            "Unable to send the recovery email. Please try again later.",
            true
        );
    } finally {
        resetButton.disabled = false;
        resetButton.querySelector("span").textContent = "Send reset link";
    }
});
