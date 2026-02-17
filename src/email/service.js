import nodemailer from "nodemailer";
const isProduction = process.env.NODE_ENV === "production";

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function createTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false") === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

function maskUser(user) {
  const value = String(user || "");
  if (!value) return "";
  if (value.length <= 4) return "***";
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

export function getSmtpStatus() {
  const configured = smtpConfigured();
  return {
    configured,
    mode: configured ? "smtp" : "mock",
    host: process.env.SMTP_HOST || "",
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false") === "true",
    from: process.env.SMTP_FROM || process.env.SMTP_USER || "",
    userHint: maskUser(process.env.SMTP_USER || "")
  };
}

export async function sendEmail({ to, subject, text }) {
  if (!to || !subject || !text) {
    throw new Error("to, subject, and text are required for email sending.");
  }

  if (!smtpConfigured()) {
    if (isProduction) {
      throw new Error("SMTP is not configured in production.");
    }
    return {
      mode: "mock",
      accepted: [to],
      subject,
      message: "SMTP not configured. Email was simulated."
    };
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const transport = createTransport();
  const result = await transport.sendMail({ from, to, subject, text });

  return {
    mode: "smtp",
    accepted: result.accepted || [],
    rejected: result.rejected || [],
    messageId: result.messageId
  };
}
