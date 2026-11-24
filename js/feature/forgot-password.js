
import { supabase } from "../connection.js";

const form = document.getElementById("forgotPasswordForm");
const emailInput = document.getElementById("email");
const message = document.getElementById("message");
const resetButton = document.getElementById("resetButton");

/** Display the recovery result. */
function showMessage(text, isError = false) {
    message.textContent = text;
    message.hidden = false;
    message.setAttribute("aria-live", isError ? "assertive" : "polite");
    message.style.background = isError ? "#FCE8E6" : "#E8EDDF";
    message.style.color = isError ? "#A12622" : "#35452D";
}

/** Get the correct reset-password URL for the current environment. */
function getResetRedirectUrl() {
    const hostname = window.location.hostname;

    // Local development
    if (hostname === "127.0.0.1" || hostname === "localhost") {
        return "http://127.0.0.1:5500/html/reset-password.html";
    }

    // GitHub Pages
    if (hostname === "eligiofrancisrobert.github.io") {
        return "https://eligiofrancisrobert.github.io/Tanikala/html/reset-password.html";
    }

    // Vercel production
    if (hostname === "tanikala.vercel.app") {
        return "https://tanikala.vercel.app/html/reset-password.html";
    }

    throw new Error("Unsupported application domain.");
}

/** Send the Supabase password recovery email. */
form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = emailInput.value.trim().toLowerCase();

    if (!emailInput.validity.valid || !email) {
        showMessage("Please enter a valid email address.", true);
        return;
    }

    resetButton.disabled = true;

    const buttonText = resetButton.querySelector("span");

    if (buttonText) {
        buttonText.textContent = "Sending...";
    }

    message.hidden = true;

    try {
        const redirectTo = getResetRedirectUrl();

        const { error } = await supabase.auth.resetPasswordForEmail(
            email,
            {
                redirectTo
            }
        );

        if (error) {
            throw error;
        }

        showMessage(
            "If an account exists with that email, a password reset link has been sent. Please check your inbox and spam folder."
        );

        form.reset();

    } catch (error) {
        console.error("Password recovery error:", error);

        showMessage(
            error.message === "Unsupported application domain."
                ? "This application domain is not configured for password recovery."
                : "Unable to send the recovery email. Please try again later.",
            true
        );

    } finally {
        resetButton.disabled = false;

        if (buttonText) {
            buttonText.textContent = "Send reset link";
        }
    }
});
