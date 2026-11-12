
import nodemailer from "npm:nodemailer";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return Response.json(
      { error: "Method not allowed." },
      { status: 405, headers: corsHeaders }
    );
  }

  try {
    const {
      name,
      email,
      subject,
      message,
    } = await req.json();

    if (
      typeof name !== "string" ||
      typeof email !== "string" ||
      typeof subject !== "string" ||
      typeof message !== "string" ||
      !name.trim() ||
      !email.trim() ||
      !subject.trim() ||
      !message.trim()
    ) {
      return Response.json(
        { error: "Please complete all fields." },
        { status: 400, headers: corsHeaders }
      );
    }

    if (
      name.length > 120 ||
      email.length > 254 ||
      subject.length > 200 ||
      message.length > 5000 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    ) {
      return Response.json(
        { error: "Please check your information and try again." },
        { status: 400, headers: corsHeaders }
      );
    }

    const smtpHost = Deno.env.get("SMTP_HOSTNAME");
    const smtpPort = Number(Deno.env.get("SMTP_PORT") || "587");
    const smtpUser = Deno.env.get("SMTP_USERNAME");
    const smtpPass = Deno.env.get("SMTP_PASSWORD");
    const recipient = Deno.env.get("CONTACT_TO_EMAIL");
    const smtpFrom = Deno.env.get("SMTP_FROM");

    if (!smtpHost || !smtpUser || !smtpPass || !recipient) {
      throw new Error("Email configuration is incomplete.");
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    await transporter.sendMail({
      from: `"Tanikala Website" <${smtpFrom || smtpUser}>`,
      to: recipient,
      replyTo: email.trim(),
      subject: `[Tanikala Contact] ${subject.trim()}`,
      text: [
        "New message from the Tanikala contact form",
        "",
        `Name: ${name.trim()}`,
        `Email: ${email.trim()}`,
        `Subject: ${subject.trim()}`,
        "",
        "Message:",
        message.trim(),
      ].join("\n"),
    });

    return Response.json(
      { success: true, message: "Your message has been sent successfully." },
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error("Contact email error:", error);

    return Response.json(
      { error: "Unable to send your message right now. Please try again later." },
      { status: 500, headers: corsHeaders }
    );
  }
});
