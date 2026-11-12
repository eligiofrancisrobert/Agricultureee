import { supabase } from "../connection.js";
import { h, toast } from "../admin/ui.js";

const MIN_PASSWORD_LENGTH = 8;

/* ============================================================
   TANIKALA - AGRICULTURAL TECHNICIAN SETTINGS
   Panels: Profile, Appearance, Security, Sessions
   ============================================================ */

/* ---------- Helpers ---------- */

const initials = name =>
    (name || "AT")
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
        { class: "at-settings-field" },
        h("small", {}, label),
        h("b", {}, value || "Not set")
    );

const panelHeader = (title, subtitle, extra = "") =>
    h(
        "div",
        { class: "at-settings-panel-header" },
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

function profilePanel(user, staff) {
    const email = user?.email || "";

    const name =
        staff?.full_name ||
        user?.user_metadata?.full_name ||
        user?.user_metadata?.fullName ||
        email.split("@")[0] ||
        "Agricultural Technician";

    const copyEmail = email
        ? h(
            "button",
            {
                class: "at-button at-button-secondary",
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
        { class: "at-settings-panel" },

        panelHeader(
            "Profile",
            "Your account details",
            h("span", { class: "at-pill" }, "Agricultural Technician")
        ),

        h(
            "div",
            { class: "at-profile-head" },

            h("span", { class: "at-profile-avatar" }, initials(name)),

            h(
                "div",
                { class: "at-profile-main" },
                h("b", {}, name),
                h("small", {}, email || "No email on file")
            ),

            copyEmail
        ),

        h(
            "div",
            { class: "at-settings-fields" },

            field("Name", name),
            field("Email", email),
            field("Role", "Agricultural Technician"),
            field("Staff ID", staff?.staff_id),
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
        { class: "at-settings-panel" },

        panelHeader(
            "Appearance",
            "Choose how the Agricultural Technician Portal looks"
        ),

        h(
            "ul",
            { class: "at-settings-list" },

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
                    { class: "at-switch" },
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
    const message = h("p", { class: "at-settings-msg error" });
    message.hidden = true;

    const newPassword = h("input", {
        class: "at-form-input",
        id: "atNewPassword",
        type: "password",
        autocomplete: "new-password",
        placeholder: `At least ${MIN_PASSWORD_LENGTH} characters`
    });

    const confirmPassword = h("input", {
        class: "at-form-input",
        id: "atConfirmPassword",
        type: "password",
        autocomplete: "new-password",
        placeholder: "Re-enter the new password"
    });

    const submit = h(
        "button",
        { class: "at-button", type: "submit" },
        "Update password"
    );

    const strengthFill = h("div", { class: "at-strength-fill" });
    const strengthText = h("small", {});

    const strength = h(
        "div",
        { class: "at-strength", "aria-live": "polite" },
        h("div", { class: "at-strength-bar" }, strengthFill),
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
        id: "atShowPasswords"
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
        { class: "at-settings-form", novalidate: "" },

        h(
            "div",
            { class: "at-settings-form-field" },
            h("label", { for: "atNewPassword" }, "New password"),
            newPassword
        ),

        strength,

        h(
            "div",
            { class: "at-settings-form-field" },
            h("label", { for: "atConfirmPassword" }, "Confirm new password"),
            confirmPassword
        ),

        h(
            "label",
            { for: "atShowPasswords", class: "at-show-passwords" },
            showToggle,
            "Show passwords"
        ),

        message,

        h("div", { class: "at-settings-actions" }, submit)
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
        { class: "at-settings-panel" },

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
    const message = h("p", { class: "at-settings-msg error" });
    message.hidden = true;

    const button = h(
        "button",
        { class: "at-button at-button-secondary", type: "button" },
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
        { class: "at-settings-panel" },

        panelHeader(
            "Sessions",
            "Sign out anywhere else your account is signed in"
        ),

        h(
            "div",
            { class: "at-settings-form" },
            message,
            h("div", { class: "at-settings-actions" }, button)
        )
    );
}

/* ============================================================
   PAGE RENDER
   ============================================================ */

export async function render(root, ctx) {
    if (!root) {
        throw new Error("Agricultural Technician Settings requires a root element.");
    }

    const page = h(
        "section",
        { class: "at-settings" },

        h(
            "div",
            { class: "at-page-heading" },
            h("h2", {}, "Settings"),
            h(
                "p",
                {},
                "Manage your profile and how the Agricultural Technician Portal looks."
            )
        )
    );

    const holder = h("div");

    page.append(holder);
    root.replaceChildren(page);

    try {
        const { data, error } = await supabase.auth.getUser();

        if (error) throw error;

        const user = data?.user;

        if (!user) throw new Error("No authenticated user found.");

        holder.replaceChildren(
            h(
                "div",
                { class: "at-settings-grid" },

                profilePanel(user, ctx?.staff),

                h(
                    "div",
                    { class: "at-settings-stack" },

                    appearancePanel(),
                    securityPanel(),
                    sessionsPanel()
                )
            )
        );

    } catch (error) {
        console.error("Agricultural Technician Settings failed to load:", error);

        holder.replaceChildren(
            h(
                "p",
                { class: "at-settings-msg error" },
                "Unable to load your settings. Please refresh the page or log in again."
            )
        );
    }
}