import { supabase } from "../connection.js";
import { h, toast } from "../admin/ui.js";

const MIN_PASSWORD_LENGTH = 8;

/* ============================================================
   TANIKALA - SUPPLIER SETTINGS
   Panels: Profile, Appearance, Security, Sessions
   ============================================================ */

/* ---------- Helpers ---------- */

const initials = name =>
    (name || "SP")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part[0].toUpperCase())
        .join("");

const formatDay = value => {
    const date = new Date(value);

    return value && !Number.isNaN(date.getTime())
        ? date.toLocaleDateString("en-PH", {
            year: "numeric",
            month: "short",
            day: "numeric"
        })
        : "Not available";
};

const formatDateTime = value => {
    const date = new Date(value);

    return value && !Number.isNaN(date.getTime())
        ? date.toLocaleString("en-PH", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit"
        })
        : "Not available";
};

function passwordStrength(password) {
    const points = [
        password.length >= MIN_PASSWORD_LENGTH,
        password.length >= 12,
        /[a-z]/.test(password) && /[A-Z]/.test(password),
        /\d/.test(password),
        /[^A-Za-z0-9]/.test(password)
    ].filter(Boolean).length;

    if (points <= 1) {
        return { label: "Weak", color: "var(--error)", percent: 25 };
    }

    if (points <= 3) {
        return { label: "Fair", color: "var(--warning)", percent: 55 };
    }

    if (points === 4) {
        return { label: "Good", color: "var(--success)", percent: 80 };
    }

    return { label: "Strong", color: "var(--success)", percent: 100 };
}

const field = (label, value) =>
    h(
        "div",
        { class: "sup-settings-field" },
        h("small", {}, label),
        h("b", {}, value || "Not set")
    );

const panelHeader = (title, subtitle, extra = "") =>
    h(
        "div",
        { class: "sup-settings-panel-header" },
        h(
            "div",
            {},
            h("h3", {}, title),
            h("p", {}, subtitle)
        ),
        extra
    );

/* ============================================================
   PROFILE PANEL
   ============================================================ */

function profilePanel(user) {
    const email = user?.email || "";

    const name =
        user?.user_metadata?.full_name ||
        user?.user_metadata?.fullName ||
        user?.user_metadata?.company_name ||
        email.split("@")[0] ||
        "Supplier";

    const copyEmail = email
        ? h(
            "button",
            {
                class: "sup-button sup-button-secondary",
                type: "button",
                onclick: async () => {
                    try {
                        await navigator.clipboard.writeText(email);
                        toast("Email copied.");
                    } catch (error) {
                        console.error("Copy failed:", error);
                        toast("Could not copy the email.");
                    }
                }
            },
            "Copy email"
        )
        : "";

    return h(
        "section",
        { class: "sup-settings-panel" },

        panelHeader(
            "Profile",
            "Your account details",
            h("span", { class: "sup-pill" }, "Supplier")
        ),

        h(
            "div",
            { class: "sup-profile-head" },

            h("span", { class: "sup-profile-avatar" }, initials(name)),

            h(
                "div",
                { class: "sup-profile-main" },
                h("b", {}, name),
                h("small", {}, email || "No email on file")
            ),

            copyEmail
        ),

        h(
            "div",
            { class: "sup-settings-fields" },

            field("Name", name),
            field("Email", email),
            field("Role", "Supplier"),
            field("Account ID", user?.id),
            field("Member since", formatDay(user?.created_at)),
            field("Last sign-in", formatDateTime(user?.last_sign_in_at))
        )
    );
}

/* ============================================================
   APPEARANCE PANEL
   ============================================================ */

function appearancePanel() {
    const html = document.documentElement;

    const savedTheme =
        localStorage.getItem("tanikala-theme") ||
        localStorage.getItem("theme") ||
        html.dataset.theme ||
        "light";

    const toggle = h("input", {
        type: "checkbox",
        "aria-label": "Dark mode"
    });

    toggle.checked = savedTheme === "dark";

    toggle.addEventListener("change", () => {
        const next = toggle.checked ? "dark" : "light";

        html.setAttribute("data-theme", next);

        try {
            localStorage.setItem("tanikala-theme", next);
            localStorage.setItem("theme", next);
        } catch (error) {
            console.warn("Unable to save theme preference:", error);
        }

        // Keep the header theme button icon in sync.
        const icon = document.querySelector("#themeToggle i");

        if (icon) {
            icon.className =
                next === "dark"
                    ? "fa-solid fa-sun"
                    : "fa-solid fa-moon";
        }
    });

    return h(
        "section",
        { class: "sup-settings-panel" },

        panelHeader(
            "Appearance",
            "Choose how the Supplier Portal looks"
        ),

        h(
            "ul",
            { class: "sup-settings-list" },

            h(
                "li",
                {},

                h(
                    "div",
                    {},
                    h("p", {}, "Dark mode"),
                    h(
                        "small",
                        {},
                        "Use a darker theme that is easier on the eyes."
                    )
                ),

                h(
                    "label",
                    { class: "sup-switch" },
                    toggle,
                    h("span")
                )
            )
        )
    );
}

/* ============================================================
   SECURITY PANEL
   ============================================================ */

function securityPanel() {
    const message = h("p", { class: "sup-settings-msg error" });
    message.hidden = true;

    const newPassword = h("input", {
        class: "sup-form-input",
        id: "supNewPassword",
        type: "password",
        autocomplete: "new-password",
        placeholder: `At least ${MIN_PASSWORD_LENGTH} characters`
    });

    const confirmPassword = h("input", {
        class: "sup-form-input",
        id: "supConfirmPassword",
        type: "password",
        autocomplete: "new-password",
        placeholder: "Re-enter the new password"
    });

    const submit = h(
        "button",
        { class: "sup-button", type: "submit" },
        "Update password"
    );

    const strengthFill = h("div", { class: "sup-strength-fill" });
    const strengthText = h("small", {});

    const strength = h(
        "div",
        { class: "sup-strength", "aria-live": "polite" },
        h("div", { class: "sup-strength-bar" }, strengthFill),
        strengthText
    );

    strength.hidden = true;

    newPassword.addEventListener("input", () => {
        if (!newPassword.value) {
            strength.hidden = true;
            return;
        }

        const result = passwordStrength(newPassword.value);

        strength.hidden = false;
        strengthFill.style.width = `${result.percent}%`;
        strengthFill.style.background = result.color;
        strengthText.textContent = `Password strength: ${result.label}`;
    });

    const showToggle = h("input", {
        type: "checkbox",
        id: "supShowPasswords"
    });

    showToggle.addEventListener("change", () => {
        const type = showToggle.checked ? "text" : "password";

        newPassword.type = type;
        confirmPassword.type = type;
    });

    const showError = text => {
        message.textContent = text;
        message.hidden = false;
    };

    const form = h(
        "form",
        { class: "sup-settings-form", novalidate: "" },

        h(
            "div",
            { class: "sup-settings-form-field" },
            h("label", { for: "supNewPassword" }, "New password"),
            newPassword
        ),

        strength,

        h(
            "div",
            { class: "sup-settings-form-field" },
            h("label", { for: "supConfirmPassword" }, "Confirm new password"),
            confirmPassword
        ),

        h(
            "label",
            { for: "supShowPasswords", class: "sup-show-passwords" },
            showToggle,
            "Show passwords"
        ),

        message,

        h("div", { class: "sup-settings-actions" }, submit)
    );

    form.addEventListener("submit", async event => {
        event.preventDefault();
        message.hidden = true;

        if (newPassword.value.length < MIN_PASSWORD_LENGTH) {
            showError(
                `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
            );
            return;
        }

        if (newPassword.value !== confirmPassword.value) {
            showError("Passwords do not match.");
            return;
        }

        submit.disabled = true;
        submit.textContent = "Updating...";

        try {
            const { error } = await supabase.auth.updateUser({
                password: newPassword.value
            });

            if (error) throw error;

            form.reset();

            strength.hidden = true;
            newPassword.type = "password";
            confirmPassword.type = "password";

            toast("Password updated.");

        } catch (error) {
            console.error("Password update failed:", error);

            showError(
                error?.message ||
                "Could not update the password. Please try again."
            );

        } finally {
            submit.disabled = false;
            submit.textContent = "Update password";
        }
    });

    return h(
        "section",
        { class: "sup-settings-panel" },

        panelHeader(
            "Security",
            "Change the password you use to sign in"
        ),

        form
    );
}

/* ============================================================
   SESSIONS PANEL
   ============================================================ */

function sessionsPanel() {
    const message = h("p", { class: "sup-settings-msg error" });
    message.hidden = true;

    const button = h(
        "button",
        { class: "sup-button sup-button-secondary", type: "button" },
        "Sign out other devices"
    );

    button.addEventListener("click", async () => {
        if (
            !window.confirm(
                "Sign out of all other devices? You will stay signed in here."
            )
        ) {
            return;
        }

        message.hidden = true;
        button.disabled = true;
        button.textContent = "Signing out...";

        try {
            const { error } = await supabase.auth.signOut({
                scope: "others"
            });

            if (error) throw error;

            toast("Signed out of all other devices.");

        } catch (error) {
            console.error("Sign out of other devices failed:", error);

            message.textContent =
                error?.message ||
                "Could not sign out other devices. Please try again.";

            message.hidden = false;

        } finally {
            button.disabled = false;
            button.textContent = "Sign out other devices";
        }
    });

    return h(
        "section",
        { class: "sup-settings-panel" },

        panelHeader(
            "Sessions",
            "Sign out anywhere else your account is signed in"
        ),

        h(
            "div",
            { class: "sup-settings-form" },
            message,
            h("div", { class: "sup-settings-actions" }, button)
        )
    );
}

/* ============================================================
   PAGE RENDER
   ============================================================ */

export async function render({ view }) {
    if (!view) {
        throw new Error("Supplier Settings requires a view element.");
    }

    const page = h(
        "section",
        { class: "sup-settings" },

        h(
            "div",
            { class: "sup-page-heading" },
            h("h1", {}, "Settings"),
            h(
                "p",
                { class: "muted" },
                "Manage your profile and how the Supplier Portal looks."
            )
        )
    );

    const holder = h("div");

    page.append(holder);
    view.replaceChildren(page);

    try {
        const { data, error } = await supabase.auth.getUser();

        if (error) throw error;

        const user = data?.user;

        if (!user) throw new Error("No authenticated user found.");

        holder.replaceChildren(
            h(
                "div",
                { class: "sup-settings-grid" },

                profilePanel(user),

                h(
                    "div",
                    { class: "sup-settings-stack" },

                    appearancePanel(),
                    securityPanel(),
                    sessionsPanel()
                )
            )
        );

    } catch (error) {
        console.error("Supplier Settings failed to load:", error);

        holder.replaceChildren(
            h(
                "p",
                { class: "sup-settings-msg error" },
                "Unable to load your settings. Please refresh the page or log in again."
            )
        );
    }
}