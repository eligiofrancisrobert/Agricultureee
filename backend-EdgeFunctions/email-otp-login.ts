
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.16";

const allowedOrigins = [
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "https://eligiofrancisrobert.github.io",
];

const MAX_FAILED_ATTEMPTS = 3;
const OTP_COOLDOWN_SECONDS = 60;

function getCorsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json",
  };

  if (origin && allowedOrigins.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing server secret: ${name}`);
  return value;
}

const hexToBytes = (hex: string) => {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("OTP_ENCRYPTION_KEY must be 64 hexadecimal characters.");
  }

  return new Uint8Array(
    hex.match(/.{2}/g)!.map((byte) => parseInt(byte, 16)),
  );
};

const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const fromBase64 = (value: string) =>
  Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

async function hashOtp(otp: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(requiredEnv("OTP_HASH_SECRET")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(otp),
  );

  return bytesToHex(new Uint8Array(digest));
}

async function encryptSession(session: unknown): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    hexToBytes(requiredEnv("OTP_ENCRYPTION_KEY")),
    "AES-GCM",
    false,
    ["encrypt"],
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(session)),
  );

  return `${toBase64(iv)}.${toBase64(new Uint8Array(encrypted))}`;
}

async function decryptSession(value: string): Promise<{
  access_token: string;
  refresh_token: string;
}> {
  const [ivText, cipherText] = value.split(".");

  if (!ivText || !cipherText) {
    throw new Error("Invalid encrypted session.");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    hexToBytes(requiredEnv("OTP_ENCRYPTION_KEY")),
    "AES-GCM",
    false,
    ["decrypt"],
  );

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(ivText) },
    key,
    fromBase64(cipherText),
  );

  return JSON.parse(new TextDecoder().decode(decrypted));
}

function createMailer() {
  return nodemailer.createTransport({
    host: requiredEnv("SMTP_HOSTNAME"),
    port: Number(requiredEnv("SMTP_PORT")),
    secure: Number(requiredEnv("SMTP_PORT")) === 465,
    auth: {
      user: requiredEnv("SMTP_USERNAME"),
      pass: requiredEnv("SMTP_PASSWORD"),
    },
  });
}

/* =========================================================
   LOGIN SECURITY HELPERS
   ========================================================= */

function getRequestInfo(req: Request) {
  const forwardedFor = req.headers.get("x-forwarded-for");

  const ipAddress =
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    forwardedFor?.split(",")[0]?.trim() ||
    null;

  const userAgent = req.headers.get("user-agent") || "Unknown";

  const browser =
    /Edg\//i.test(userAgent) ? "Microsoft Edge" :
    /OPR\//i.test(userAgent) ? "Opera" :
    /Chrome\//i.test(userAgent) ? "Google Chrome" :
    /Firefox\//i.test(userAgent) ? "Mozilla Firefox" :
    /Safari\//i.test(userAgent) ? "Safari" :
    "Unknown";

  const operatingSystem =
    /Windows NT/i.test(userAgent) ? "Windows" :
    /Android/i.test(userAgent) ? "Android" :
    /iPhone|iPad|iPod/i.test(userAgent) ? "iOS" :
    /Mac OS X/i.test(userAgent) ? "macOS" :
    /Linux/i.test(userAgent) ? "Linux" :
    "Unknown";

  const device =
    /iPad|Tablet/i.test(userAgent) ? "Tablet" :
    /Mobile|Android|iPhone/i.test(userAgent) ? "Mobile" :
    "Desktop";

  // Country-level approximation only. No precise location is inferred.
  const country =
    req.headers.get("cf-ipcountry") ||
    req.headers.get("x-vercel-ip-country") ||
    null;

  return {
    ip_address: ipAddress,
    location: country,
    device,
    browser,
    operating_system: operatingSystem,
    user_agent: userAgent,
  };
}

async function writeSecurityLog(
  admin: ReturnType<typeof createClient>,
  req: Request,
  eventType: string,
  details: {
    userId?: string | null;
    email?: string | null;
    metadata?: Record<string, unknown>;
  } = {},
) {
  try {
    const requestInfo = getRequestInfo(req);

    const { error } = await admin
      .from("login_security_logs")
      .insert({
        user_id: details.userId || null,
        email: details.email || null,
        event_type: eventType,
        ip_address: requestInfo.ip_address,
        location: requestInfo.location,
        device: requestInfo.device,
        browser: requestInfo.browser,
        operating_system: requestInfo.operating_system,
        metadata: {
          ...details.metadata,
          user_agent: requestInfo.user_agent,
        },
      });

    if (error) {
      console.error("Security log insert failed:", error.message);
    }
  } catch (error) {
    console.error(
      "Security log error:",
      error instanceof Error ? error.message : "Unknown error",
    );
  }
}

async function getSecurityAccount(
  admin: ReturnType<typeof createClient>,
  email: string,
) {
  const { data, error } = await admin
    .from("login_security_accounts")
    .select("user_id, email, failed_attempts, locked_at, locked_reason")
    .ilike("email", email)
    .maybeSingle();

  if (error) throw error;

  return data;
}

async function checkAccountLock(
  admin: ReturnType<typeof createClient>,
  req: Request,
  email: string,
  userId?: string,
) {
  let query = admin
    .from("login_security_accounts")
    .select("user_id, email, failed_attempts, locked_at, locked_reason");

  query = userId
    ? query.eq("user_id", userId)
    : query.ilike("email", email);

  const { data, error } = await query.maybeSingle();

  if (error) throw error;

  if (data?.locked_at) {
    await writeSecurityLog(admin, req, "LOGIN_BLOCKED", {
      userId: data.user_id,
      email: data.email,
      metadata: {
        reason: "Account is locked",
        locked_at: data.locked_at,
        failed_attempts: data.failed_attempts,
      },
    });

    return {
      locked: true,
      account: data,
    };
  }

  return {
    locked: false,
    account: data,
  };
}

async function recordFailedLogin(
  admin: ReturnType<typeof createClient>,
  req: Request,
  email: string,
  userId?: string,
  eventType = "LOGIN_FAILED",
) {
  const { data, error } = await admin.rpc("record_login_failure", {
    p_email: email,
  });

  if (error) {
    console.error("Failed login tracking failed:", error.message);
    throw new Error("Unable to record login security event.");
  }

  const result = Array.isArray(data) ? data[0] : data;

  await writeSecurityLog(admin, req, eventType, {
    userId: result?.account_user_id || userId || null,
    email,
    metadata: {
      failed_attempts: result?.failed_attempts ?? null,
      locked: result?.is_locked ?? false,
      locked_at: result?.account_locked_at ?? null,
    },
  });

  if (result?.is_locked) {
    await writeSecurityLog(admin, req, "ACCOUNT_LOCKED", {
      userId: result.account_user_id,
      email,
      metadata: {
        failed_attempts: result.failed_attempts,
        locked_at: result.account_locked_at,
        reason: "Three consecutive failed login attempts",
      },
    });
  }

  return result;
}

function lockedResponse() {
  return {
    success: false,
    error:
      "Your account has been locked after multiple failed login attempts. Please contact the Administrator to unlock your account.",
    locked: true,
  };
}

/* =========================================================
   EDGE FUNCTION
   ========================================================= */

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: corsHeaders,
    });

  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return json({ success: false, error: "Method not allowed." }, 405);
  }

  try {
    const body = await req.json();
    const action = body?.action;

    const supabaseUrl = requiredEnv("SUPABASE_URL");

    const anonKey =
      Deno.env.get("SUPABASE_ANON_KEY") ??
      requiredEnv("SUPABASE_PUBLISHABLE_KEY");

    const serviceRoleKey = requiredEnv("SERVICE_ROLE_KEY");

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    /* =====================================================
       REQUEST OTP
       ===================================================== */

    if (action === "request") {
      const email = String(body?.email ?? "").trim().toLowerCase();
      const password = String(body?.password ?? "");

      if (!email || !password) {
        return json(
          { success: false, error: "Email and password are required." },
          400,
        );
      }

      // Check account lockdown before password authentication.
      const lockCheck = await checkAccountLock(admin, req, email);

      if (lockCheck.locked) {
        return json(lockedResponse(), 423);
      }

      const authClient = createClient(supabaseUrl, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const { data: authData, error: authError } =
        await authClient.auth.signInWithPassword({ email, password });

      if (authError || !authData.user || !authData.session) {
        console.error("Supabase sign-in diagnostic:", {
          message: authError?.message,
          status: authError?.status,
          code: authError?.code,
        });

        const failure = await recordFailedLogin(
          admin,
          req,
          email,
          undefined,
          "PASSWORD_LOGIN_FAILED",
        );

        if (failure?.is_locked) {
          return json(lockedResponse(), 423);
        }

        return json(
          { success: false, error: "Invalid email or password." },
          401,
        );
      }

      // Check again after password authentication.
      // Prevent an OTP challenge from being created if the account
      // became locked during authentication.
      const userLockCheck = await checkAccountLock(
        admin,
        req,
        email,
        authData.user.id,
      );

      if (userLockCheck.locked) {
        await authClient.auth.signOut();
        return json(lockedResponse(), 423);
      }

      const otp = String(
        crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000,
      ).padStart(6, "0");

      const expiresAt = new Date(
        Date.now() + 10 * 60 * 1000,
      ).toISOString();

      const encryptedSession = await encryptSession({
        access_token: authData.session.access_token,
        refresh_token: authData.session.refresh_token,
      });

      await admin
        .from("login_otp_challenges")
        .update({ consumed_at: new Date().toISOString() })
        .eq("user_id", authData.user.id)
        .is("consumed_at", null);

      const { data: challenge, error: insertError } = await admin
        .from("login_otp_challenges")
        .insert({
          user_id: authData.user.id,
          email,
          otp_hash: await hashOtp(otp),
          encrypted_session: encryptedSession,
          expires_at: expiresAt,
        })
        .select("id")
        .single();

      if (insertError || !challenge) {
        console.error("Challenge insert failed:", insertError?.message);

        return json(
          { success: false, error: "Unable to start OTP verification." },
          500,
        );
      }

      try {
        await createMailer().sendMail({
          from: {
            name: "Tanikala",
            address: requiredEnv("SMTP_FROM"),
          },
          to: email,
          subject: "Your Tanikala verification code",
          text: `Your Tanikala login code is ${otp}. It expires in 10 minutes. If you did not request it, you can ignore this email.`,
          html: `<p>Your Tanikala login code is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">${otp}</p><p>This code expires in 10 minutes. If you did not request it, ignore this email.</p>`,
        });
      } catch (mailError) {
        await admin
          .from("login_otp_challenges")
          .delete()
          .eq("id", challenge.id);

        console.error(
          "OTP email failed:",
          mailError instanceof Error
            ? mailError.message
            : "Unknown email error",
        );

        return json(
          {
            success: false,
            error:
              "Unable to send the verification email. Check the SMTP settings.",
          },
          502,
        );
      }

      await writeSecurityLog(admin, req, "OTP_SENT", {
        userId: authData.user.id,
        email,
      });

      return json({ success: true, challengeId: challenge.id });
    }

    /* =====================================================
       VERIFY OTP
       ===================================================== */

    if (action === "verify") {
      const challengeId = String(body?.challengeId ?? "");
      const otp = String(body?.otp ?? "").trim();

      if (!/^[0-9a-f-]{36}$/i.test(challengeId) || !/^\d{6}$/.test(otp)) {
        return json(
          {
            success: false,
            error: "Invalid verification code or challenge.",
          },
          400,
        );
      }

      const { data: challenge, error: lookupError } = await admin
        .from("login_otp_challenges")
        .select(
          "id, user_id, email, otp_hash, encrypted_session, expires_at, attempts, consumed_at, otp_cooldown_until",
        )
        .eq("id", challengeId)
        .maybeSingle();

      if (lookupError) {
        console.error("Challenge lookup failed:", lookupError.message);

        return json(
          { success: false, error: "Unable to verify the code." },
          500,
        );
      }

      if (
        !challenge ||
        challenge.consumed_at ||
        new Date(challenge.expires_at).getTime() <= Date.now() ||
        challenge.attempts >= 5
      ) {
        return json(
          {
            success: false,
            error:
              "The code expired or is no longer valid. Please log in again.",
          },
          401,
        );
      }

      // A password login or another OTP attempt may have locked the account.
      const lockCheck = await checkAccountLock(
        admin,
        req,
        challenge.email,
        challenge.user_id,
      );

      if (lockCheck.locked) {
        return json(lockedResponse(), 423);
      }

      // Server-enforced cooldown.
      if (challenge.otp_cooldown_until) {
        const cooldownUntil = new Date(
          challenge.otp_cooldown_until,
        ).getTime();

        const remaining = Math.ceil(
          (cooldownUntil - Date.now()) / 1000,
        );

        if (remaining > 0) {
          return json(
            {
              success: false,
              error: `Please wait ${remaining} seconds before trying again.`,
              cooldown: true,
              retryAfter: remaining,
              cooldownUntil: challenge.otp_cooldown_until,
            },
            429,
          );
        }
      }

      // Preserve the existing attempt counter.
      const { error: attemptError } = await admin
        .from("login_otp_challenges")
        .update({ attempts: challenge.attempts + 1 })
        .eq("id", challengeId)
        .is("consumed_at", null);

      if (attemptError) {
        return json(
          { success: false, error: "Unable to verify the code." },
          500,
        );
      }

      if (await hashOtp(otp) !== challenge.otp_hash) {
        const cooldownUntil = new Date(
          Date.now() + OTP_COOLDOWN_SECONDS * 1000,
        ).toISOString();

        const { error: cooldownError } = await admin
          .from("login_otp_challenges")
          .update({
            otp_cooldown_until: cooldownUntil,
          })
          .eq("id", challengeId)
          .is("consumed_at", null);

        if (cooldownError) {
          console.error(
            "OTP cooldown update failed:",
            cooldownError.message,
          );

          return json(
            { success: false, error: "Unable to verify the code." },
            500,
          );
        }

        const failure = await recordFailedLogin(
          admin,
          req,
          challenge.email,
          challenge.user_id,
          "OTP_LOGIN_FAILED",
        );

        if (failure?.is_locked) {
          return json(lockedResponse(), 423);
        }

        await writeSecurityLog(admin, req, "OTP_COOLDOWN", {
          userId: challenge.user_id,
          email: challenge.email,
          metadata: {
            cooldown_seconds: OTP_COOLDOWN_SECONDS,
            cooldown_until: cooldownUntil,
          },
        });

        return json(
          {
            success: false,
            error: "Incorrect verification code. Please wait 60 seconds before trying again.",
            cooldown: true,
            retryAfter: OTP_COOLDOWN_SECONDS,
            cooldownUntil,
          },
          401,
        );
      }

      // Consume the OTP exactly once.
      const { data: consumed, error: consumeError } = await admin
        .from("login_otp_challenges")
        .update({ consumed_at: new Date().toISOString() })
        .eq("id", challengeId)
        .is("consumed_at", null)
        .select("id")
        .maybeSingle();

      if (consumeError || !consumed) {
        return json(
          {
            success: false,
            error:
              "This verification code has already been used. Please log in again.",
          },
          401,
        );
      }

      const session = await decryptSession(
        challenge.encrypted_session,
      );

      // Reset failed attempts after successful verification.
      const { error: resetError } = await admin.rpc(
        "reset_login_failures",
        {
          p_user_id: challenge.user_id,
        },
      );

      if (resetError) {
        // Do not break the existing successful login process.
        console.error(
          "Failed attempt reset failed:",
          resetError.message,
        );
      }

      await writeSecurityLog(admin, req, "LOGIN_SUCCESS", {
        userId: challenge.user_id,
        email: challenge.email,
      });

      return json({ success: true, session });
    }

    return json({ success: false, error: "Unknown action." }, 400);
  } catch (error) {
    console.error(
      "email-otp-login error:",
      error instanceof Error ? error.message : "Unknown error",
    );

    return json(
      {
        success: false,
        error: "The login verification service encountered an error.",
      },
      500,
    );
  }
});
