import { supabase } from "../connection.js";

// ---------- THEME ----------
// Same key as js/feature/theme.js ("theme"), shared by every farmer page.

const THEME_KEY = "theme";
const MIN_PASSWORD_LENGTH = 8;

function readSavedTheme() {
    try {
        return (
            localStorage.getItem(THEME_KEY) ||
            localStorage.getItem("tanikala-theme")
        );
    } catch {
        return null;
    }
}

function applyTheme(theme) {
    document.documentElement.setAttribute(
        "data-theme",
        theme === "dark" ? "dark" : "light"
    );
}

(function initializeTheme() {
    applyTheme(readSavedTheme());

    const toggle = document.getElementById("themeToggle");

    if (toggle) {
        toggle.addEventListener("click", event => {
            // Stop any other theme handler on this button so the theme
            // is never toggled twice by one click.
            event.stopImmediatePropagation();

            const next =
                document.documentElement.getAttribute("data-theme") === "dark"
                    ? "light"
                    : "dark";

            applyTheme(next);

            try {
                localStorage.setItem(THEME_KEY, next);
            } catch {
                // Ignore blocked storage.
            }
        });
    }

    // Keep other open pages in sync.
    window.addEventListener("storage", event => {
        if (event.key === THEME_KEY && event.newValue) {
            applyTheme(event.newValue);
        }
    });
})();

const farmerName = document.getElementById("farmerName");
const farmerAvatar = document.getElementById("farmerAvatar");
const logoutButton = document.getElementById("logoutButton");
const todayLabel = document.getElementById("todayLabel");
const settingsRoot = document.getElementById("settingsRoot");

const logoutDefaultHTML = logoutButton.innerHTML;

let currentUser = null;

/* ============ DATE ============ */

todayLabel.textContent = new Date().toLocaleDateString("en-PH", {
    weekday: "short",
    month: "short",
    day: "numeric"
});

/* ============ SMALL HELPERS ============ */

/** Create an element: h("div", { class: "x", onclick }, child, "text"). */
function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);

    for (const [key, value] of Object.entries(attrs || {})) {
        if (value === false || value === null || value === undefined) continue;

        if (key.startsWith("on") && typeof value === "function") {
            el.addEventListener(key.slice(2), value);
        } else {
            el.setAttribute(key, value === true ? "" : value);
        }
    }

    for (const child of children.flat()) {
        if (child === "" || child === null || child === undefined || child === false) {
            continue;
        }

        el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }

    return el;
}

let toastTimer = null;

/** Show a short message at the bottom of the screen. */
function toast(message) {
    let box = document.getElementById("frmrToast");

    if (!box) {
        box = h("div", { id: "frmrToast", class: "frmr-toast", role: "status" });
        document.body.append(box);
    }

    box.textContent = message;
    box.classList.add("show");

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => box.classList.remove("show"), 2500);
}

const initials = name =>
    (name || "FR")
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
        : "";
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
        : "";
};

// Advisory only: it never blocks saving a password that meets the minimum.
/** Calculate the advisory password meter score and presentation values. */
function passwordStrength(password) {
    const points = [
        password.length >= MIN_PASSWORD_LENGTH,
        password.length >= 12,
        /[a-z]/.test(password) && /[A-Z]/.test(password),
        /\d/.test(password),
        /[^A-Za-z0-9]/.test(password)
    ].filter(Boolean).length;

    if (points <= 1) return { label: "Weak", color: "var(--error)", percent: 25 };
    if (points <= 3) return { label: "Fair", color: "var(--warning)", percent: 55 };
    if (points === 4) return { label: "Good", color: "var(--success)", percent: 80 };

    return { label: "Strong", color: "var(--success)", percent: 100 };
}

const field = (label, value) =>
    h(
        "div",
        { class: "frmr-settings-field" },
        h("small", {}, label),
        h("b", {}, value || "Not set")
    );

const panelHeader = (title, subtitle, extra = "") =>
    h(
        "div",
        { class: "frmr-settings-panel-header" },
        h("div", {}, h("h3", {}, title), h("p", {}, subtitle)),
        extra
    );

/* ============ PANELS ============ */

function profilePanel(info) {
    const copyEmail = info.email
        ? h(
            "button",
            {
                class: "frmr-button frmr-button-secondary",
                type: "button",
                onclick: async () => {
                    try {
                        await navigator.clipboard.writeText(info.email);
                        toast("Email copied.");
                    } catch (err) {
                        console.error("Copy failed:", err);
                        toast("Could not copy the email.");
                    }
                }
            },
            "Copy email"
        )
        : "";

    return h(
        "section",
        { class: "frmr-settings-panel" },
        panelHeader(
            "Profile",
            "Your account details",
            h("span", { class: "frmr-pill" }, "Farmer")
        ),
        h(
            "div",
            { class: "frmr-profile-head" },
            h("span", { class: "frmr-profile-avatar" }, initials(info.name)),
            h(
                "div",
                { class: "frmr-profile-main" },
                h("b", {}, info.name),
                h("small", {}, info.email || "No email on file")
            ),
            copyEmail
        ),
        h(
            "div",
            { class: "frmr-settings-fields" },
            field("Full name", info.name),
            field("Email", info.email),
            field("Role", "Farmer"),
            field("Account status", info.status),
            field("Contact number", info.contact),
            field("Member since", formatDay(info.createdAt)),
            field("Last sign-in", formatDateTime(info.lastSignIn))
        )
    );
}

function appearancePanel() {
    const html = document.documentElement;

    const toggle = h("input", {
        type: "checkbox",
        "aria-label": "Dark mode"
    });

    toggle.checked = html.dataset.theme === "dark";

    toggle.addEventListener("change", () => {
        const next = toggle.checked ? "dark" : "light";

        applyTheme(next);

        try {
            localStorage.setItem(THEME_KEY, next);
        } catch {
            // Ignore blocked storage.
        }
    });

    // Keep the switch in sync when the top bar theme button is used.
    new MutationObserver(() => {
        toggle.checked = html.dataset.theme === "dark";
    }).observe(html, { attributes: true, attributeFilter: ["data-theme"] });

    return h(
        "section",
        { class: "frmr-settings-panel" },
        panelHeader("Appearance", "Choose how the dashboard looks"),
        h(
            "ul",
            { class: "frmr-settings-list" },
            h(
                "li",
                {},
                h(
                    "div",
                    {},
                    h("p", {}, "Dark mode"),
                    h("small", {}, "Use a darker theme that is easier on the eyes.")
                ),
                h("label", { class: "frmr-switch" }, toggle, h("span"))
            )
        )
    );
}

function securityPanel() {
    const message = h("p", { class: "frmr-settings-msg error" });
    message.hidden = true;

    const newPassword = h("input", {
        class: "frmr-form-input",
        id: "frmrNewPassword",
        type: "password",
        autocomplete: "new-password",
        placeholder: `At least ${MIN_PASSWORD_LENGTH} characters`
    });

    const confirmPassword = h("input", {
        class: "frmr-form-input",
        id: "frmrConfirmPassword",
        type: "password",
        autocomplete: "new-password",
        placeholder: "Re-enter the new password"
    });

    const submit = h(
        "button",
        { class: "frmr-button", type: "submit" },
        "Update password"
    );

    // Strength meter (advisory only).
    const strengthFill = h("div", { class: "frmr-strength-fill" });
    const strengthText = h("small", {});

    const strength = h(
        "div",
        { class: "frmr-strength", "aria-live": "polite" },
        h("div", { class: "frmr-strength-bar" }, strengthFill),
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

    // Show / hide both password fields.
    const showToggle = h("input", {
        type: "checkbox",
        id: "frmrShowPasswords"
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
        { class: "frmr-settings-form", novalidate: true },
        h(
            "div",
            { class: "frmr-settings-form-field" },
            h("label", { for: "frmrNewPassword" }, "New password"),
            newPassword
        ),
        strength,
        h(
            "div",
            { class: "frmr-settings-form-field" },
            h("label", { for: "frmrConfirmPassword" }, "Confirm new password"),
            confirmPassword
        ),
        h(
            "label",
            { for: "frmrShowPasswords", class: "frmr-show-passwords" },
            showToggle,
            "Show passwords"
        ),
        message,
        h("div", { class: "frmr-settings-actions" }, submit)
    );

    /** Validate and submit the new password with Supabase Auth. */
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
        } catch (err) {
            console.error("Password update failed:", err);
            showError(
                err?.message || "Could not update the password. Please try again."
            );
        } finally {
            submit.disabled = false;
            submit.textContent = "Update password";
        }
    });

    return h(
        "section",
        { class: "frmr-settings-panel" },
        panelHeader("Security", "Change the password you use to sign in"),
        form
    );
}

function sessionsPanel() {
    const message = h("p", { class: "frmr-settings-msg error" });
    message.hidden = true;

    const button = h(
        "button",
        { class: "frmr-button frmr-button-secondary", type: "button" },
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
            // "others" keeps the current session active.
            const { error } = await supabase.auth.signOut({ scope: "others" });

            if (error) throw error;

            toast("Signed out of all other devices.");
        } catch (err) {
            console.error("Sign out of other devices failed:", err);
            message.textContent =
                err?.message || "Could not sign out other devices. Please try again.";
            message.hidden = false;
        } finally {
            button.disabled = false;
            button.textContent = "Sign out other devices";
        }
    });

    return h(
        "section",
        { class: "frmr-settings-panel" },
        panelHeader("Sessions", "Sign out anywhere else your account is signed in"),
        h(
            "div",
            { class: "frmr-settings-form" },
            message,
            h("div", { class: "frmr-settings-actions" }, button)
        )
    );
}

/** Render the settings panels into the page. */
function renderSettings(info) {
    settingsRoot.replaceChildren(
        h(
            "section",
            { class: "frmr-settings" },
            h(
                "div",
                { class: "frmr-settings-grid" },
                profilePanel(info),
                h(
                    "div",
                    { class: "frmr-settings-stack" },
                    appearancePanel(),
                    securityPanel(),
                    sessionsPanel()
                )
            )
        )
    );
}

/* ============ PAGE ============ */
/** Verify the signed-in farmer, fill the header identity, and render settings. */
async function initializeSettingsPage() {
    try {
        const {
            data: { user },
            error: authError
        } = await supabase.auth.getUser();

        if (authError || !user) {
            window.location.replace("../../login.html");
            return;
        }

        currentUser = user;

        const { data: profile, error: profileError } = await supabase
            .from("profiles")
            .select("id, role, status")
            .eq("id", user.id)
            .maybeSingle();

        if (profileError) throw profileError;

        if (
            !profile ||
            profile.role !== "farmer" ||
            !["active", "approved"].includes(profile.status)
        ) {
            await supabase.auth.signOut();
            window.location.replace("../../login.html");
            return;
        }

        const fullName =
            user.user_metadata?.full_name ||
            user.user_metadata?.fullName ||
            user.email?.split("@")[0] ||
            "Farmer";

        farmerName.textContent = fullName;
        farmerAvatar.textContent = fullName.trim().charAt(0).toUpperCase();

        renderSettings({
            name: fullName,
            email: user.email || "",
            status: profile.status.charAt(0).toUpperCase() + profile.status.slice(1),
            contact:
                user.user_metadata?.contact_number ||
                user.user_metadata?.phone ||
                user.phone ||
                "",
            createdAt: user.created_at || "",
            lastSignIn: user.last_sign_in_at || ""
        });

    } catch (error) {
        console.error("Settings page initialization failed:", error);

        settingsRoot.replaceChildren(
            h(
                "div",
                { class: "error-message" },
                h("h2", {}, "Unable to load your settings"),
                h("p", {}, "Please refresh the page or log in again.")
            )
        );
    }
}

/** Sign out the current farmer and redirect to the login page. */
async function logout() {
    if (!currentUser || logoutButton.disabled) return;

    logoutButton.disabled = true;
    logoutButton.textContent = "Logging out...";

    try {
        const { error } = await supabase.auth.signOut();

        if (error) throw error;

        window.location.replace("../../login.html");

    } catch (error) {
        console.error("Logout failed:", error);

        logoutButton.disabled = false;
        logoutButton.innerHTML = logoutDefaultHTML;

        alert("Unable to log out. Please try again.");
    }
}

logoutButton.addEventListener("click", logout);

initializeSettingsPage();