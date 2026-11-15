
import { supabase } from "../connection.js";

const form = document.getElementById("loginForm");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const message = document.getElementById("message");
const button = document.getElementById("loginButton");

const otpModal = document.getElementById("otpModal");
const otpForm = document.getElementById("otpForm");
const otpEmail = document.getElementById("otpEmail");
const otpError = document.getElementById("otpError");
const otpVerifyButton = document.getElementById("otpVerifyButton");
const otpCooldown = document.getElementById("otpCooldown");
const otpDigits = [...document.querySelectorAll(".otp-digit")];
const otpCancel = document.getElementById("otpCancel");
const otpClose = document.getElementById("otpClose");

let otpSubmitting = false;
let resendSubmitting = false;
let otpCancelled = false;
let verifiedSession = null;

let otpCooldownInterval = null;
let otpCooldownUntil = 0;

let resendCooldownInterval = null;
let resendCooldownUntil = 0;

/* =========================================================
   RESEND CODE UI
   ========================================================= */

const otpResendButton = document.createElement("button");
otpResendButton.type = "button";
otpResendButton.id = "otpResendButton";
otpResendButton.textContent = "Resend code";
otpResendButton.disabled = false;

otpResendButton.style.marginTop = "10px";
otpResendButton.style.width = "100%";
otpResendButton.style.cursor = "pointer";

otpVerifyButton.insertAdjacentElement(
    "afterend",
    otpResendButton
);

const otpResendStatus = document.createElement("p");
otpResendStatus.id = "otpResendStatus";
otpResendStatus.hidden = true;
otpResendStatus.setAttribute("aria-live", "polite");
otpResendStatus.style.marginTop = "8px";
otpResendStatus.style.textAlign = "center";
otpResendStatus.style.fontSize = "13px";

otpResendButton.insertAdjacentElement(
    "afterend",
    otpResendStatus
);

/* =========================================================
   LOGIN PAGE
   ========================================================= */

function clearLoginCredentials() {
    if (passwordInput) passwordInput.value = "";
    if (emailInput) emailInput.value = "";
    if (form) form.reset();
}

clearLoginCredentials();

window.addEventListener("pageshow", clearLoginCredentials);
window.addEventListener("pagehide", clearLoginCredentials);

function showMessage(text, isError = false) {
    message.hidden = false;
    message.textContent = text;
    message.classList.toggle("error", isError);
}

/* =========================================================
   OTP VERIFICATION COOLDOWN
   ========================================================= */

function updateVerifyButton() {
    if (otpSubmitting) {
        otpVerifyButton.disabled = true;
        otpVerifyButton.textContent = "Verifying...";
        return;
    }

    if (otpCooldownUntil > Date.now()) {
        otpVerifyButton.disabled = true;
        otpVerifyButton.textContent = "Verify code";
        return;
    }

    otpVerifyButton.disabled = false;
    otpVerifyButton.textContent = "Verify code";
}

function stopOtpCooldown() {
    if (otpCooldownInterval !== null) {
        clearInterval(otpCooldownInterval);
        otpCooldownInterval = null;
    }

    otpCooldownUntil = 0;

    if (otpCooldown) {
        otpCooldown.hidden = true;
        otpCooldown.textContent = "";
    }

    updateVerifyButton();
}

function updateOtpCooldown() {
    const remaining = Math.max(
        0,
        Math.ceil((otpCooldownUntil - Date.now()) / 1000)
    );

    if (remaining <= 0) {
        stopOtpCooldown();
        return;
    }

    otpCooldown.hidden = false;
    otpCooldown.textContent =
        `Please wait ${remaining} seconds before trying again.`;

    updateVerifyButton();
}

function startOtpCooldown(cooldownUntil, retryAfter = 60) {
    if (otpCooldownInterval !== null) {
        clearInterval(otpCooldownInterval);
        otpCooldownInterval = null;
    }

    const serverDeadline = cooldownUntil
        ? new Date(cooldownUntil).getTime()
        : NaN;

    otpCooldownUntil = Number.isFinite(serverDeadline)
        ? serverDeadline
        : Date.now() + Number(retryAfter) * 1000;

    otpError.hidden = true;
    otpError.textContent = "";

    updateOtpCooldown();

    if (otpCooldownUntil > Date.now()) {
        otpCooldownInterval = setInterval(
            updateOtpCooldown,
            250
        );
    }
}

/* =========================================================
   OTP RESEND COOLDOWN
   ========================================================= */

function stopResendCooldown() {
    if (resendCooldownInterval !== null) {
        clearInterval(resendCooldownInterval);
        resendCooldownInterval = null;
    }

    resendCooldownUntil = 0;

    otpResendButton.disabled = false;
    otpResendButton.textContent = "Resend code";
}

function updateResendCooldown() {
    const remaining = Math.max(
        0,
        Math.ceil((resendCooldownUntil - Date.now()) / 1000)
    );

    if (remaining <= 0) {
        stopResendCooldown();
        return;
    }

    otpResendButton.disabled = true;
    otpResendButton.textContent = `Resend code (${remaining}s)`;
}

function startResendCooldown(cooldownUntil, retryAfter = 60) {
    if (resendCooldownInterval !== null) {
        clearInterval(resendCooldownInterval);
        resendCooldownInterval = null;
    }

    const serverDeadline = cooldownUntil
        ? new Date(cooldownUntil).getTime()
        : NaN;

    resendCooldownUntil = Number.isFinite(serverDeadline)
        ? serverDeadline
        : Date.now() + Number(retryAfter) * 1000;

    updateResendCooldown();

    if (resendCooldownUntil > Date.now()) {
        resendCooldownInterval = setInterval(
            updateResendCooldown,
            250
        );
    }
}

/* =========================================================
   OTP MODAL
   ========================================================= */

function openOtpModal(email) {
    stopOtpCooldown();
    stopResendCooldown();

    otpSubmitting = false;
    resendSubmitting = false;

    otpEmail.textContent = email;
    otpError.hidden = true;
    otpError.textContent = "";

    otpResendStatus.hidden = true;
    otpResendStatus.textContent = "";

    otpForm.reset();

    otpVerifyButton.disabled = false;
    otpVerifyButton.textContent = "Verify code";

    otpResendButton.disabled = false;
    otpResendButton.textContent = "Resend code";

    otpModal.hidden = false;
    otpCancelled = false;

    requestAnimationFrame(() => otpDigits[0].focus());
}

function closeOtpModal() {
    if (otpSubmitting || resendSubmitting) return;

    otpCancelled = true;

    stopOtpCooldown();
    stopResendCooldown();

    otpModal.hidden = true;
}

function getOtpValue() {
    return otpDigits.map(input => input.value).join("");
}

function setOtpError(text) {
    otpError.textContent = text;
    otpError.hidden = false;
}

/* =========================================================
   OTP INPUT HANDLING
   ========================================================= */

otpDigits.forEach((input, index) => {
    input.addEventListener("input", () => {
        input.value = input.value.replace(/\D/g, "").slice(-1);

        if (input.value && index < otpDigits.length - 1) {
            otpDigits[index + 1].focus();
        }

        otpError.hidden = true;
    });

    input.addEventListener("keydown", event => {
        if (
            event.key === "Backspace" &&
            !input.value &&
            index > 0
        ) {
            otpDigits[index - 1].focus();
        }

        if (event.key === "ArrowLeft" && index > 0) {
            otpDigits[index - 1].focus();
        }

        if (
            event.key === "ArrowRight" &&
            index < otpDigits.length - 1
        ) {
            otpDigits[index + 1].focus();
        }
    });

    input.addEventListener("paste", event => {
        event.preventDefault();

        const pasted = event.clipboardData
            .getData("text")
            .replace(/\D/g, "")
            .slice(0, 6);

        if (!pasted) return;

        otpDigits.forEach((digit, i) => {
            digit.value = pasted[i] || "";
        });

        otpDigits[Math.min(pasted.length, 5)].focus();
    });
});

otpCancel.addEventListener("click", closeOtpModal);
otpClose.addEventListener("click", closeOtpModal);

otpModal.addEventListener("click", event => {
    if (event.target === otpModal) closeOtpModal();
});

/* =========================================================
   ACCOUNT ROLE AND DASHBOARD REDIRECTION
   ========================================================= */

async function getApprovedDestination(userId) {
    // 1. Check administrator accounts.
    const { data: admin, error: adminError } = await supabase
        .from("admin_users")
        .select("user_id")
        .eq("user_id", userId)
        .maybeSingle();

    if (adminError) {
        console.error("Admin lookup failed:", adminError);
        throw new Error("Unable to check your administrator account.");
    }

    if (admin) {
        return "./pages/admin/admin-dashboard.html";
    }

    // 2. Check staff accounts.
    const { data: staff, error: staffError } = await supabase
        .from("staff_accounts")
        .select("staff_id, user_id, role_id, status_id")
        .eq("user_id", userId)
        .maybeSingle();

    if (staffError) {
        console.error("Staff lookup failed:", staffError);
        throw new Error("Unable to check your staff account.");
    }

    if (staff) {
        if (staff.status_id !== 1) {
            throw new Error(
                "Your staff account is inactive or unavailable. Contact the administrator."
            );
        }

        const { data: role, error: roleError } = await supabase
            .from("staff_roles")
            .select("role_name")
            .eq("role_id", staff.role_id)
            .maybeSingle();

        if (roleError) {
            console.error("Staff role lookup failed:", roleError);
            throw new Error("Unable to check your staff role.");
        }

        if (!role) {
            throw new Error("Your staff role could not be found.");
        }

        const staffRolePages = {
            "Farm Manager": "./pages/farm-manager/farm-manager-dashboard.html",
            "Warehouse Officer": "./pages/warehouse-officer/warehouse-officer-dashboard.html",
            "Agricultural Technician": "./pages/agricultural-technician/agricultural-technician-dashboard.html",
            "Accountant": "./pages/accountant/accountant-dashboard.html",
            "Admin": "./pages/admin/admin-dashboard.html"
        };

        const destination = staffRolePages[role.role_name];

        if (!destination) {
            throw new Error("Your staff role is not recognized.");
        }

        return destination;
    }

    // 3. Check Farmer, Buyer, and Supplier accounts.
    const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("id, role, status")
        .eq("id", userId)
        .maybeSingle();

    if (profileError) {
        console.error("Profile lookup failed:", profileError);
        throw new Error(
            "Unable to check your profile. Please try again."
        );
    }

    if (!profile) {
        console.error("No visible profile found for user ID:", userId);
        throw new Error(
            "Your profile could not be found. Please contact the administrator."
        );
    }

    if (profile.status === "pending") {
        throw new Error(
            "Your registration is still pending administrator approval."
        );
    }

    if (profile.status === "rejected") {
        throw new Error(
            "Your registration was rejected. Please contact the administrator."
        );
    }

    if (!["active", "approved"].includes(profile.status)) {
        throw new Error("Your account is not active.");
    }

    const rolePages = {
        farmer: "./pages/farmer/farmer-dashboard.html",
        buyer: "./pages/buyers/browse-produce.html",
        supplier: "./pages/supplier/supplier-dashboard.html"
    };

    const destination = rolePages[profile.role];

    if (!destination) {
        throw new Error("Your account role is not recognized.");
    }

    return destination;
}

/* =========================================================
   EDGE FUNCTION REQUEST HANDLER
   ========================================================= */

async function invokeOtpFunction(body) {
    const { data, error } = await supabase.functions.invoke(
        "email-otp-login",
        { body }
    );

    if (error) {
        let responseBody = {};

        try {
            if (error.context && typeof error.context.json === "function") {
                responseBody = await error.context.clone().json();
            }
        } catch {
            // Preserve the original Supabase error.
        }

        console.error("OTP function error:", responseBody || error);

        const otpError = new Error(
            responseBody.error || error.message
        );

        otpError.cooldown = responseBody.cooldown === true;
        otpError.retryAfter = responseBody.retryAfter;
        otpError.cooldownUntil = responseBody.cooldownUntil;
        otpError.locked = responseBody.locked === true;

        throw otpError;
    }

    if (!data?.success) {
        const otpError = new Error(
            data?.error || "The OTP request failed."
        );

        otpError.cooldown = data?.cooldown === true;
        otpError.retryAfter = data?.retryAfter;
        otpError.cooldownUntil = data?.cooldownUntil;
        otpError.locked = data?.locked === true;

        throw otpError;
    }

    return data;
}

/* =========================================================
   RESEND OTP
   ========================================================= */

async function resendOtp(challengeId) {
    if (resendSubmitting || otpSubmitting) return;

    if (resendCooldownUntil > Date.now()) {
        updateResendCooldown();
        return;
    }

    resendSubmitting = true;

    otpResendButton.disabled = true;
    otpResendButton.textContent = "Sending...";

    otpResendStatus.hidden = true;
    otpResendStatus.textContent = "";

    otpError.hidden = true;
    otpError.textContent = "";

    try {
        const data = await invokeOtpFunction({
            action: "resend",
            challengeId
        });

        if (!data.challengeId) {
            throw new Error(
                "The server did not return a valid verification challenge."
            );
        }

        otpDigits.forEach(input => {
            input.value = "";
        });

        startResendCooldown(
            data.cooldownUntil,
            data.retryAfter || 60
        );

        otpResendStatus.textContent =
            "A new verification code has been sent to your email.";

        otpResendStatus.hidden = false;

        otpDigits[0].focus();

    } catch (error) {
        console.error("Resend OTP error:", error);

        if (error.cooldown) {
            startResendCooldown(
                error.cooldownUntil,
                error.retryAfter || 60
            );
        } else if (error.locked) {
            setOtpError(
                error.message || "Your account is locked."
            );
        } else {
            setOtpError(
                error.message || "Unable to resend the verification code."
            );
        }

    } finally {
        resendSubmitting = false;

        if (resendCooldownUntil > Date.now()) {
            updateResendCooldown();
        } else {
            otpResendButton.disabled = false;
            otpResendButton.textContent = "Resend code";
        }
    }
}

/* =========================================================
   LOGIN FORM SUBMISSION
   ========================================================= */

form.addEventListener("submit", async event => {
    event.preventDefault();
    message.hidden = true;

    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    button.disabled = true;
    button.textContent = "Sending OTP...";

    let sessionEstablished = false;

    try {
        const email = emailInput.value.trim().toLowerCase();
        const password = passwordInput.value;

        // STEP 1: Verify password and request an email OTP.
        const requestData = await invokeOtpFunction({
            action: "request",
            email,
            password
        });

        const challengeId = requestData.challengeId;

        if (!challengeId) {
            throw new Error(
                "The server did not return an OTP challenge."
            );
        }

        passwordInput.value = "";

        showMessage(`A verification code was sent to ${email}.`);

        // STEP 2: Display the OTP modal.
        openOtpModal(email);

        button.textContent = "Waiting for verification...";

        const otp = await new Promise(resolve => {
            let settled = false;

            const finish = value => {
                if (settled) return;

                settled = true;
                resolve(value);
            };

            // Resend button.
            otpResendButton.onclick = async () => {
                await resendOtp(challengeId);
            };

            // OTP verification.
            otpForm.onsubmit = async otpEvent => {
                otpEvent.preventDefault();

                if (otpCooldownUntil > Date.now()) {
                    updateOtpCooldown();
                    return;
                }

                const code = getOtpValue();

                if (!/^\d{6}$/.test(code)) {
                    setOtpError("Enter all six digits.");
                    return;
                }

                if (otpSubmitting || resendSubmitting) return;

                otpSubmitting = true;
                updateVerifyButton();

                try {
                    // STEP 3: Verify the OTP.
                    const verifyData = await invokeOtpFunction({
                        action: "verify",
                        challengeId,
                        otp: code
                    });

                    if (
                        !verifyData.session?.access_token ||
                        !verifyData.session?.refresh_token
                    ) {
                        throw new Error(
                            "The server did not return a valid login session."
                        );
                    }

                    verifiedSession = verifyData.session;

                    stopOtpCooldown();
                    stopResendCooldown();

                    otpModal.hidden = true;

                    finish(code);

                } catch (error) {
                    otpDigits.forEach(input => {
                        input.value = "";
                    });

                    if (error.cooldown || error.locked) {
                        otpError.hidden = true;
                        otpError.textContent = "";

                        if (error.cooldown) {
                            startOtpCooldown(
                                error.cooldownUntil,
                                error.retryAfter || 60
                            );
                        }

                        if (error.locked) {
                            setOtpError(
                                error.message || "Your account is locked."
                            );
                        }

                    } else {
                        setOtpError(
                            error.message || "Invalid code. Please try again."
                        );

                        otpDigits[0].focus();
                    }

                } finally {
                    otpSubmitting = false;
                    updateVerifyButton();
                }
            };

            const finishOnCancel = () => {
                if (otpCancelled) finish(null);
            };

            otpCancel.addEventListener("click", finishOnCancel, {
                once: true
            });

            otpClose.addEventListener("click", finishOnCancel, {
                once: true
            });
        });

        if (otp === null) {
            showMessage(
                "Verification cancelled. Please log in again."
            );

            return;
        }

        // STEP 4: Establish the verified Supabase session.
        if (
            !verifiedSession?.access_token ||
            !verifiedSession?.refresh_token
        ) {
            throw new Error("Unable to establish your login session.");
        }

        const { data: sessionData, error: sessionError } =
            await supabase.auth.setSession({
                access_token: verifiedSession.access_token,
                refresh_token: verifiedSession.refresh_token
            });

        if (sessionError) throw sessionError;

        if (!sessionData?.user) {
            throw new Error("Unable to establish your login session.");
        }

        sessionEstablished = true;

        // STEP 5: Check status and route to the correct page.
        const destination = await getApprovedDestination(
            sessionData.user.id
        );

        window.location.replace(destination);

    } catch (error) {
        console.error("Login error:", error);

        if (sessionEstablished) {
            await supabase.auth.signOut().catch(() => {});
        }

        showMessage(
            error.message || "Unable to log in. Please try again.",
            true
        );

    } finally {
        button.disabled = false;
        button.textContent = "Log in →";
    }
});
