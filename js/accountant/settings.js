
import { supabase } from "../connection.js";
import { h, toast } from "../admin/ui.js";
import { initAccountantPage } from "./main.js";

const MIN_PASSWORD_LENGTH = 8;

/* ============================================================
   TANIKALA - ACCOUNTANT SETTINGS
   Uses the shared Accountant authentication from main.js.

   Context:
   - ctx.user
   - ctx.profile

   Profile table fields:
   - id
   - role
   - status
   ============================================================ */

/* ---------- Data ---------- */

function loadAccount(user) {
    return {
        email: user?.email || "",
        createdAt: user?.created_at || "",
        lastSignIn: user?.last_sign_in_at || ""
    };
}

/* ---------- Helpers ---------- */

const initials = name =>
    (name || "AC")
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
        return {
            label: "Weak",
            color: "var(--error)",
            percent: 25
        };
    }

    if (points <= 3) {
        return {
            label: "Fair",
            color: "var(--warning)",
            percent: 55
        };
    }

    if (points === 4) {
        return {
            label: "Good",
            color: "var(--success)",
            percent: 80
        };
    }

    return {
        label: "Strong",
        color: "var(--success)",
        percent: 100
    };
}

const field = (label, value) =>
    h(
        "div",
        { class: "acc-settings-field" },
        h("small", {}, label),
        h("b", {}, value || "Not set")
    );

const panelHeader = (title, subtitle, extra = "") =>
    h(
        "div",
        { class: "acc-settings-panel-header" },
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

function profilePanel(user, profile, account) {
    const name =
        user?.user_metadata?.full_name ||
        user?.user_metadata?.fullName ||
        user?.email?.split("@")[0] ||
        "Accountant";

    const status = String(profile?.status || "unknown");

    const isActive = ["active", "approved"].includes(
        status.toLowerCase()
    );

    const copyEmail = account.email
        ? h(
            "button",
            {
                class: "acc-button acc-button-secondary",
                type: "button",
                onclick: async () => {
                    try {
                        await navigator.clipboard.writeText(
                            account.email
                        );

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
        { class: "acc-settings-panel" },

        panelHeader(
            "Profile",
            "Your account details",
            h("span", { class: "acc-pill" }, "Accountant")
        ),

        h(
            "div",
            { class: "acc-profile-head" },

            h(
                "span",
                { class: "acc-profile-avatar" },
                initials(name)
            ),

            h(
                "div",
                { class: "acc-profile-main" },
                h("b", {}, name),
                h(
                    "small",
                    {},
                    account.email || "No email on file"
                )
            ),

            copyEmail
        ),

        h(
            "div",
            { class: "acc-settings-fields" },

            field("Full name", name),
            field("Email", account.email),
            field("Role", "Accountant"),
            field("Account ID", user?.id),
            field(
                "Account status",
                isActive ? "Active" : status
            ),
            field("Member since", formatDay(account.createdAt)),
            field(
                "Last sign-in",
                formatDateTime(account.lastSignIn)
            )
        )
    );
}

/* ============================================================
   APPEARANCE PANEL
   ============================================================ */

function appearancePanel() {
    const html = document.documentElement;

    const toggle = h("input", {
        type: "checkbox",
        "aria-label": "Dark mode"
    });

    toggle.checked = html.dataset.theme === "dark";

    toggle.addEventListener("change", () => {
        const next = toggle.checked ? "dark" : "light";

        html.dataset.theme = next;

        try {
            localStorage.setItem("theme", next);
        } catch (error) {
            console.warn("Unable to save theme preference:", error);
        }
    });

    return h(
        "section",
        { class: "acc-settings-panel" },

        panelHeader(
            "Appearance",
            "Choose how the dashboard looks"
        ),

        h(
            "ul",
            { class: "acc-settings-list" },

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
                    { class: "acc-switch" },
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
    const message = h("p", {
        class: "acc-settings-msg error"
    });

    message.hidden = true;

    const newPassword = h("input", {
        class: "acc-form-input",
        id: "accNewPassword",
        type: "password",
        autocomplete: "new-password",
        placeholder: `At least ${MIN_PASSWORD_LENGTH} characters`
    });

    const confirmPassword = h("input", {
        class: "acc-form-input",
        id: "accConfirmPassword",
        type: "password",
        autocomplete: "new-password",
        placeholder: "Re-enter the new password"
    });

    const submit = h(
        "button",
        {
            class: "acc-button",
            type: "submit"
        },
        "Update password"
    );

    const strengthFill = h("div", {
        class: "acc-strength-fill"
    });

    const strengthText = h("small", {});

    const strength = h(
        "div",
        {
            class: "acc-strength",
            "aria-live": "polite"
        },
        h(
            "div",
            { class: "acc-strength-bar" },
            strengthFill
        ),
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

        strengthText.textContent =
            `Password strength: ${result.label}`;
    });

    const showToggle = h("input", {
        type: "checkbox",
        id: "accShowPasswords"
    });

    showToggle.addEventListener("change", () => {
        const type = showToggle.checked
            ? "text"
            : "password";

        newPassword.type = type;
        confirmPassword.type = type;
    });

    const showError = text => {
        message.textContent = text;
        message.hidden = false;
    };

    const form = h(
        "form",
        {
            class: "acc-settings-form",
            novalidate: ""
        },

        h(
            "div",
            { class: "acc-settings-form-field" },
            h(
                "label",
                { for: "accNewPassword" },
                "New password"
            ),
            newPassword
        ),

        strength,

        h(
            "div",
            { class: "acc-settings-form-field" },
            h(
                "label",
                { for: "accConfirmPassword" },
                "Confirm new password"
            ),
            confirmPassword
        ),

        h(
            "label",
            {
                for: "accShowPasswords",
                class: "acc-show-passwords"
            },
            showToggle,
            "Show passwords"
        ),

        message,

        h(
            "div",
            { class: "acc-settings-actions" },
            submit
        )
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
        { class: "acc-settings-panel" },

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
    const message = h("p", {
        class: "acc-settings-msg error"
    });

    message.hidden = true;

    const button = h(
        "button",
        {
            class: "acc-button acc-button-secondary",
            type: "button"
        },
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
            console.error(
                "Sign out of other devices failed:",
                error
            );

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
        { class: "acc-settings-panel" },

        panelHeader(
            "Sessions",
            "Sign out anywhere else your account is signed in"
        ),

        h(
            "div",
            { class: "acc-settings-form" },
            message,
            h(
                "div",
                { class: "acc-settings-actions" },
                button
            )
        )
    );
}

/* ============================================================
   PAGE RENDER
   ============================================================ */

export async function render(root, ctx) {
    if (!root || !ctx?.user || !ctx?.profile) {
        throw new Error(
            "Settings requires an authenticated Accountant context."
        );
    }

    const page = h("section", {
        class: "acc-settings"
    });

    const heading = h(
        "div",
        { class: "acc-page-heading" },

        h("h1", {}, "Settings"),

        h(
            "p",
            { class: "muted" },
            "Manage your profile and how the dashboard looks."
        )
    );

    const holder = h("div");

    page.append(heading, holder);
    root.replaceChildren(page);

    const account = loadAccount(ctx.user);

    holder.replaceChildren(
        h(
            "div",
            { class: "acc-settings-grid" },

            profilePanel(ctx.user, ctx.profile, account),

            h(
                "div",
                { class: "acc-settings-stack" },

                appearancePanel(),
                securityPanel(),
                sessionsPanel()
            )
        )
    );
}

/* ============================================================
   INITIALIZATION
   ============================================================ */

async function initializeSettings() {
    const root = document.getElementById("settingsRoot");

    if (!root) {
        console.error(
            "Accountant Settings: #settingsRoot was not found."
        );
        return;
    }

    try {
        const context = await initAccountantPage();

        // Authentication failed or user was redirected.
        if (!context) return;

        await render(root, context);

    } catch (error) {
        console.error(
            "Accountant Settings initialization failed:",
            error
        );

        root.replaceChildren(
            h(
                "section",
                { class: "acc-settings" },

                h("h1", {}, "Settings"),

                h(
                    "p",
                    { class: "acc-settings-msg error" },
                    "Unable to load your settings. Please refresh the page or log in again."
                )
            )
        );
    }
}

initializeSettings();

export function cleanup() {}
