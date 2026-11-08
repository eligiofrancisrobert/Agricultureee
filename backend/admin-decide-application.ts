
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.16";

const allowedOrigins = [
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "https://eligiofrancisrobert.github.io",
];

/** Build CORS headers and reflect only origins explicitly trusted by the app. */
function cors(origin: string | null): Record<string, string> {
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

/**
 * Read a required server-side secret.
 * @throws {Error} When the named environment variable is absent or empty.
 */
function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing server secret: ${name}`);
  return value;
}

/** Serialize a JSON response using the status and headers selected by the handler. */
function response(
  body: unknown,
  status: number,
  headers: Record<string, string>,
) {
  return new Response(JSON.stringify(body), { status, headers });
}

/** Escape untrusted text before embedding it in an HTML email body. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char] ?? char);
}

/** Create the SMTP transport from deployment-provided server secrets. */
function createMailer() {
  return nodemailer.createTransport({
    host: env("SMTP_HOSTNAME"),
    port: Number(env("SMTP_PORT")),
    secure: Number(env("SMTP_PORT")) === 465,
    auth: {
      user: env("SMTP_USERNAME"),
      pass: env("SMTP_PASSWORD"),
    },
  });
}

// Handle browser preflight first, then authenticate and authorize every decision
// before changing a profile. This service-role client must never trust the UI alone.
Deno.serve(async (req: Request) => {
  const headers = cors(req.headers.get("origin"));

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  if (req.method !== "POST") {
    return response({ error: "Method not allowed." }, 405, headers);
  }

  try {
    const authorization = req.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) {
      return response({ error: "Authentication required." }, 401, headers);
    }

    const supabaseUrl = env("SUPABASE_URL");
    const anonKey =
      Deno.env.get("SUPABASE_ANON_KEY") ??
      env("SUPABASE_PUBLISHABLE_KEY");
    const serviceRoleKey =
      Deno.env.get("SERVICE_ROLE_KEY") ??
      env("SUPABASE_SERVICE_ROLE_KEY");

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: { user }, error: authError } =
      await userClient.auth.getUser();

    if (authError || !user) {
      return response({ error: "Invalid authentication." }, 401, headers);
    }

    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Verify admin access on the server for every decision.
    const { data: admin, error: adminError } = await db
      .from("admin_users")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (adminError) {
      console.error("Admin verification failed:", adminError.message);
      return response({ error: "Could not verify admin access." }, 500, headers);
    }

    if (!admin) {
      return response({ error: "Administrator access required." }, 403, headers);
    }

    // Normalize and constrain input before using it in a database query or email.
    const body = await req.json();
    const userId = String(body?.userId ?? "").trim();
    const requestedStatus = String(body?.status ?? "").trim().toLowerCase();
    const reason = String(body?.reason ?? "").trim().slice(0, 1000);

    if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) {
      return response({ error: "A valid applicant ID is required." }, 400, headers);
    }

    if (!["active", "rejected", "suspended"].includes(requestedStatus)) {
      return response({ error: "Unsupported status." }, 400, headers);
    }

    if (requestedStatus === "rejected" && !reason) {
      return response({
        error: "A rejection reason is required."
      }, 400, headers);
    }

    // Match the UI mapping in js/admin/api.js.
    const databaseStatus: Record<string, string> = {
      active: "approved",
      rejected: "rejected",
      suspended: "suspended",
    };

    const { data: applicant, error: lookupError } = await db
      .from("profiles")
      .select("id, full_name, email, role, status")
      .eq("id", userId)
      .maybeSingle();

    if (lookupError) {
      console.error("Applicant lookup failed:", lookupError.message);
      return response({ error: "Could not load the applicant." }, 500, headers);
    }

    if (!applicant) {
      return response({ error: "Applicant not found." }, 404, headers);
    }

    // Avoid duplicate writes and notifications when an account already matches.
    const previousStatus = applicant.status;
    const nextStatus = databaseStatus[requestedStatus];

    if (previousStatus === nextStatus) {
      return response({
        success: true,
        emailSent: false,
        unchanged: true,
        message: "The account already has this status.",
      }, 200, headers);
    }

    const { data: updated, error: updateError } = await db
      .from("profiles")
      .update({ status: nextStatus })
      .eq("id", userId)
      .select("id, full_name, email, role, status")
      .single();

    if (updateError || !updated) {
      console.error("Status update failed:", updateError?.message);
      return response({
        error: "Could not update the application status.",
      }, 500, headers);
    }

    // Only email actual application decisions, not suspensions/reactivations.
    // Only application approval/rejection transitions trigger email; other
    // administrative status changes are persisted without notifying the user.
    const shouldSendApproval =
      requestedStatus === "active" &&
      ["pending", "rejected"].includes(previousStatus);

    const shouldSendRejection =
      requestedStatus === "rejected" &&
      previousStatus === "pending";

    if (!shouldSendApproval && !shouldSendRejection) {
      return response({
        success: true,
        emailSent: false,
        message: "Account status updated.",
      }, 200, headers);
    }

    if (!updated.email) {
      return response({
        success: true,
        emailSent: false,
        message: "Status updated, but the applicant has no email address.",
      }, 200, headers);
    }

    // Prepare plain-text and escaped HTML variants for the same decision notice.
    const name = updated.full_name || "Tanikala applicant";
    const safeName = escapeHtml(name);
    const loginUrl =
      Deno.env.get("APP_LOGIN_URL") ||
      "https://eligiofrancisrobert.github.io/Agricultureee/html/login.html";

    const approval = shouldSendApproval;
    const subject = approval
      ? "Your Tanikala account has been approved"
      : "Update on your Tanikala application";

    const text = approval
      ? `Hello ${name},

Your Tanikala ${updated.role} account has been approved.

You can now visit Tanikala and sign in:
${loginUrl}

Thank you,
Tanikala Team`
      : `Hello ${name},

Thank you for applying to Tanikala. Unfortunately, your application has been rejected at this time.

Reason for rejection:
${reason}

You may sign in using your existing account and reapply after correcting the issues identified by the administrator:
${loginUrl}

Your previous registration documents will be retained unless you replace them during reapplication.

Thank you,
Tanikala Team`;

    const html = approval
      ? `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#29251f">
       <h2>Your Tanikala account is approved!</h2>
       <p>Hello ${safeName},</p>
       <p>Your Tanikala <strong>${escapeHtml(updated.role)}</strong> account has been approved.</p>
       <p>You can now sign in to Tanikala.</p>
       <p><a href="${escapeHtml(loginUrl)}" style="display:inline-block;padding:12px 18px;background:#c65d3a;color:white;text-decoration:none;border-radius:6px">Visit Tanikala</a></p>
       <p>Thank you,<br>Tanikala Team</p>
     </div>`
      : `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#29251f">
       <h2>Update on your Tanikala application</h2>
       <p>Hello ${safeName},</p>
       <p>Thank you for applying to Tanikala. Unfortunately, your application has been rejected at this time.</p>
       <p><strong>Reason for rejection:</strong></p>
       <p>${escapeHtml(reason).replace(/\n/g, "<br>")}</p>
       <p>You may sign in using your existing account and reapply after correcting the issues identified by the administrator.</p>
       <p><a href="${escapeHtml(loginUrl)}" style="display:inline-block;padding:12px 18px;background:#c65d3a;color:white;text-decoration:none;border-radius:6px">Sign in to Tanikala</a></p>
       <p>Your previous registration documents will be retained unless you replace them during reapplication.</p>
       <p>Thank you,<br>Tanikala Team</p>
     </div>`;

    // Status changes are durable even if SMTP fails, so mail failure is reported
    // separately rather than suggesting that the database update was rolled back.
    try {
      await createMailer().sendMail({
        from: {
          name: "Tanikala",
          address: env("SMTP_FROM"),
        },
        to: updated.email,
        subject,
        text,
        html,
      });

      return response({
        success: true,
        emailSent: true,
        message: approval
          ? "Application approved and email sent."
          : "Application rejected and email sent.",
      }, 200, headers);
    } catch (mailError) {
      console.error(
        "Decision email failed:",
        mailError instanceof Error ? mailError.message : "Unknown email error",
      );

      // The status remains saved; the email can be retried separately.
      return response({
        success: true,
        emailSent: false,
        message: "Status updated, but the notification email could not be sent.",
      }, 200, headers);
    }
  } catch (error) {
    console.error(
      "admin-decide-application error:",
      error instanceof Error ? error.message : "Unknown error",
    );

    return response({
      error: "An unexpected server error occurred.",
    }, 500, headers);
  }
});
