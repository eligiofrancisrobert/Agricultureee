const layout = document.querySelector(".page-layout");

// Page transition links
document.querySelectorAll(".topbar-text a").forEach((link) => {
    link.addEventListener("click", (event) => {
        const destination = link.href;

        // Allow normal browser behavior for external links
        if (new URL(destination).origin !== window.location.origin) {
            return;
        }

        event.preventDefault();

        if (layout) {
            layout.classList.add("is-swapping");

            window.setTimeout(() => {
                window.location.href = destination;
            }, 650);
        } else {
            window.location.href = destination;
        }
    });
});

// Password visibility toggles
// Each click is handled once. If another script also listens on the same
// button (or an old cached copy of it does), the second handler sees the flag
// and does nothing, so the field is never flipped twice.
document.querySelectorAll(".password-toggle").forEach((toggle) => {
    toggle.addEventListener("click", (event) => {
        if (event.passwordToggleHandled) return;
        event.passwordToggleHandled = true;

        const input = document.getElementById(toggle.dataset.target);

        if (!input) return;

        const show = input.type === "password";
        input.type = show ? "text" : "password";
        toggle.textContent = show ? "Hide" : "Show";
        toggle.setAttribute(
            "aria-label",
            show ? "Hide password" : "Show password"
        );
    });
});

// Login form behavior — only runs on the login page
const form = document.getElementById("loginForm");
const message = document.getElementById("message");
const button = document.getElementById("loginButton");

function showMessage(text, type) {
    if (!message) return;

    message.textContent = text;
    message.className = `message ${type}`;
    message.hidden = false;
}

if (form && message && button) {
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        message.hidden = true;

        const email = form.email.value.trim();
        const password = form.password.value;

        if (!email || !password) {
            showMessage(
                "Enter your email address and password.",
                "error"
            );
            return;
        }

        // Actual Supabase login will be connected separately.
        showMessage(
            "Login form is ready, but Supabase authentication is not connected here yet.",
            "error"
        );
    });
}