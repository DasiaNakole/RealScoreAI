import crypto from "crypto";
import express from "express";
import cors from "cors";

import { applyLeadEvent } from "./scoring/pipeline.js";
import { calculateLeadScore } from "./scoring/engine.js";
import { listPlans, plans } from "./billing/plans.js";
import { createCheckoutSession } from "./billing/stripe.js";
import { classifyIntentFromMessage } from "./ai/intelligence.js";
import { buildSuggestedFollowUp, buildDailyDigestEmail, buildMonthlyNurtureEmail, buildBetaEndingReminderEmail } from "./email/templates.js";
import { getSmtpStatus, sendEmail } from "./email/service.js";
import { runSchema } from "./db/client.js";
import {
  bumpTrackingLinkClick,
  createTrackingLink,
  createUser,
  createLead,
  deleteLeadForUser,
  getAdminMetrics,
  getLeadByEmailForUser,
  getLeadById,
  getLeadByIdForUser,
  getTrackingLinkById,
  getTemplateByKey,
  hasLeadEventType,
  listAllLeads,
  listTemplates,
  getSubscriptionByUserId,
  getUsageByUser,
  getUserByEmail,
  getUserById,
  hasUserEventForTrial,
  insertEvent,
  listTrialingUsers,
  listEventsForLead,
  listLeadsByUser,
  listTrackingLinksByLeadForUser,
  listUserEventsByType,
  touchUser,
  updateUserRole,
  updateUserPasswordHash,
  updateLeadForUser,
  updateLeadSnapshot,
  updateUserOnboarding,
  upsertTemplate,
  upsertSubscription
} from "./db/repo.js";

const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === "production";
const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const ADMIN_KEY = process.env.ADMIN_KEY || (!isProduction ? "beta-admin-2026" : "");
const WEBHOOK_KEY = process.env.WEBHOOK_KEY || (!isProduction ? "lead-webhook-2026" : "");
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || "");
const ADMIN_NAME = String(process.env.ADMIN_NAME || "RealScoreAI Admin").trim();

const sessions = new Map();
const invites = new Map();
const streamClients = new Map();
const passwordResetTokens = new Map();

const SEED_LEADS = [
  {
    name: "Alyssa Carter",
    email: "alyssa@example.com",
    phone: "555-210-0001",
    status: "touring",
    signals: { responseTimeMinutes: 8, messageIntent: "hot", followThroughRate: 0.9, weeklyEngagementTouches: 6 },
    lastActivityAt: "2026-02-15T15:00:00.000Z"
  },
  {
    name: "Marcus Lee",
    email: "marcus@example.com",
    phone: "555-210-0002",
    status: "new",
    signals: { responseTimeMinutes: 140, messageIntent: "warm", followThroughRate: 0.5, weeklyEngagementTouches: 2 },
    lastActivityAt: "2026-02-12T15:00:00.000Z"
  },
  {
    name: "Isabella Hart",
    email: "isabella@example.com",
    phone: "555-210-0003",
    status: "nurture",
    signals: { responseTimeMinutes: 500, messageIntent: "cold", followThroughRate: 0.2, weeklyEngagementTouches: 0 },
    lastActivityAt: "2026-02-08T15:00:00.000Z"
  },
  {
    name: "Noah Patel",
    email: "noah@example.com",
    phone: "555-210-0004",
    status: "qualified",
    signals: { responseTimeMinutes: 20, messageIntent: "warm", followThroughRate: 0.8, weeklyEngagementTouches: 4 },
    lastActivityAt: "2026-02-14T15:00:00.000Z"
  },
  {
    name: "Grace Kim",
    email: "grace@example.com",
    phone: "555-210-0005",
    status: "new",
    signals: { responseTimeMinutes: 60, messageIntent: "neutral", followThroughRate: 0.45, weeklyEngagementTouches: 1 },
    lastActivityAt: "2026-02-11T15:00:00.000Z"
  },
  {
    name: "Daniel Brooks",
    email: "daniel@example.com",
    phone: "555-210-0006",
    status: "new",
    signals: { responseTimeMinutes: 10, messageIntent: "hot", followThroughRate: 0.7, weeklyEngagementTouches: 5 },
    lastActivityAt: "2026-02-15T12:00:00.000Z"
  }
];

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function createPasswordResetToken(userId, ttlMs = 60 * 60 * 1000) {
  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = Date.now() + ttlMs;
  passwordResetTokens.set(token, { userId, expiresAt });
  return token;
}

function validateStrongPassword(password) {
  const value = String(password || "");
  const checks = [
    { ok: value.length >= 10, rule: "at least 10 characters" },
    { ok: /[A-Z]/.test(value), rule: "one uppercase letter" },
    { ok: /[a-z]/.test(value), rule: "one lowercase letter" },
    { ok: /[0-9]/.test(value), rule: "one number" },
    { ok: /[^A-Za-z0-9]/.test(value), rule: "one special character" }
  ];

  const failed = checks.filter((item) => !item.ok).map((item) => item.rule);
  return {
    valid: failed.length === 0,
    message: failed.length ? `Password must include ${failed.join(", ")}.` : ""
  };
}

function createSession(userId) {
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, { userId, createdAt: new Date().toISOString() });
  return token;
}

function sanitizeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    betaFlag: user.beta_flag,
    createdAt: user.created_at,
    lastActiveAt: user.last_active_at
  };
}

async function ensureAdminUser() {
  if (!ADMIN_EMAIL) return;

  const existing = await getUserByEmail(ADMIN_EMAIL);
  if (existing) {
    if (String(existing.role || "").toLowerCase() !== "admin") {
      await updateUserRole(existing.id, "admin", false);
    }
    return;
  }

  if (!ADMIN_PASSWORD) return;

  await createUser({
    email: ADMIN_EMAIL,
    passwordHash: hashPassword(ADMIN_PASSWORD),
    name: ADMIN_NAME,
    role: "admin",
    betaFlag: false
  });
}

async function loadDemoLeadsForUser(userId, { force = false } = {}) {
  const existing = await listLeadsByUser(userId);
  if (existing.length > 0 && !force) {
    return { createdCount: 0, skipped: true };
  }

  if (force && existing.length > 0) {
    for (const lead of existing) {
      await deleteLeadForUser(lead.id, userId);
    }
  }

  let createdCount = 0;
  for (const lead of SEED_LEADS) {
    const scored = calculateLeadScore(lead.signals);
    await createLead({
      userId,
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      status: lead.status,
      score: scored.score,
      bucket: scored.bucket,
      signals: lead.signals,
      behaviorTrend: "stable",
      confidenceScore: 62,
      lastActivityAt: lead.lastActivityAt
    });
    createdCount += 1;
  }

  return { createdCount, skipped: false };
}

async function getSubscriptionStatus(userId) {
  const subscription = await getSubscriptionByUserId(userId);
  if (!subscription) {
    return { hasAccess: false, reason: "missing_payment", subscription: null };
  }

  const now = Date.now();
  const trialEnds = subscription.trial_ends_at ? new Date(subscription.trial_ends_at).getTime() : 0;
  const paid = subscription.status === "active";
  const trialActive = subscription.status === "trialing" && now <= trialEnds;

  return {
    hasAccess: paid || trialActive,
    reason: paid || trialActive ? "ok" : "trial_expired",
    subscription: {
      planId: subscription.plan,
      status: subscription.status,
      trialEndsAt: subscription.trial_ends_at,
      paymentMethodLast4: subscription.payment_method_last4,
      cardholderName: subscription.cardholder_name
    }
  };
}

function getSessionFromRequest(req) {
  const authHeader = req.headers.authorization || "";
  const headerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const queryToken = typeof req.query.token === "string" ? req.query.token : "";
  const token = headerToken || queryToken;
  const session = sessions.get(token);
  return { token, session };
}

async function requireAuth(req, res, next) {
  const { token, session } = getSessionFromRequest(req);
  if (!session) {
    return res.status(401).json({ error: "Unauthorized. Please login." });
  }

  const user = await getUserById(session.userId);
  if (!user) {
    return res.status(401).json({ error: "Session is invalid." });
  }

  req.user = user;
  req.token = token;
  await touchUser(user.id);
  return next();
}

async function requireActiveAccess(req, res, next) {
  const access = await getSubscriptionStatus(req.user.id);
  if (!access.hasAccess) {
    return res.status(402).json({ error: "Payment required before dashboard access.", code: access.reason });
  }
  req.subscription = access.subscription;
  return next();
}

async function requireAdminAccess(req, res, next) {
  const key = req.headers["x-admin-key"] || req.query.adminKey || "";
  if (key && key === ADMIN_KEY) {
    return next();
  }

  const { token, session } = getSessionFromRequest(req);
  if (!session) {
    return res.status(401).json({ error: "Unauthorized. Please login." });
  }

  const user = await getUserById(session.userId);
  if (!user) {
    return res.status(401).json({ error: "Session is invalid." });
  }

  if (String(user.role || "").toLowerCase() !== "admin") {
    return res.status(403).json({ error: "Admin access required." });
  }

  req.user = user;
  req.token = token;
  await touchUser(user.id);
  return next();
}

function requireWebhookKey(req, res, next) {
  const key = req.headers["x-webhook-key"] || "";
  if (key !== WEBHOOK_KEY) {
    return res.status(401).json({ error: "Invalid webhook key." });
  }
  return next();
}

function addStreamClient(user, res) {
  const clientId = crypto.randomBytes(12).toString("hex");
  streamClients.set(clientId, { clientId, userId: user.id, res });
  return clientId;
}

function removeStreamClient(clientId) {
  streamClients.delete(clientId);
}

function broadcastToUser(userId, event, payload) {
  const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of streamClients.values()) {
    if (client.userId === userId) {
      client.res.write(message);
    }
  }
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
    return `"${text.replaceAll("\"", "\"\"")}"`;
  }
  return text;
}

function toCsv(rows, columns) {
  const header = columns.join(",");
  const lines = rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","));
  return [header, ...lines].join("\n");
}

const FOLLOW_THROUGH_SIGNAL_TO_RATE = {
  none: 0.1,
  replied: 0.35,
  docs_shared: 0.55,
  tour_booked: 0.75,
  multiple_tours: 0.88,
  offer_submitted: 0.97
};

function normalizeFollowThroughRate(rawRate, rawSignal) {
  const signal = String(rawSignal || "").trim().toLowerCase();
  if (signal && FOLLOW_THROUGH_SIGNAL_TO_RATE[signal] !== undefined) {
    return FOLLOW_THROUGH_SIGNAL_TO_RATE[signal];
  }

  const numeric = Number(rawRate);
  if (Number.isFinite(numeric)) {
    return Math.max(0, Math.min(1, numeric));
  }

  return FOLLOW_THROUGH_SIGNAL_TO_RATE.none;
}

const LEAD_PIPELINE_STEPS = [
  "consultation",
  "exclusive_buyer_agreement",
  "preapproval",
  "home_search",
  "schedule_visits",
  "home_inspection",
  "appraisal",
  "sign_documents",
  "closing",
  "closed"
];

function normalizePipelineProgress(rawProgress) {
  const source = rawProgress && typeof rawProgress === "object" ? rawProgress : {};
  const result = {};
  for (const step of LEAD_PIPELINE_STEPS) {
    result[step] = Boolean(source[step]);
  }
  return result;
}

const CHECKLIST_STAGE_LABELS = {
  consultation: "Consultation",
  exclusive_buyer_agreement: "Exclusive Buyer Agreement (EBA)",
  preapproval: "Preapproval",
  home_search: "Home Search",
  schedule_visits: "Schedule Visits",
  home_inspection: "Home Inspection",
  appraisal: "Appraisal",
  sign_documents: "Sign Documents",
  closing: "Closing",
  closed: "Closed",
  nurture: "Nurture"
};

function stageFromPipeline(progress) {
  let current = "consultation";
  for (const step of LEAD_PIPELINE_STEPS) {
    if (progress[step]) current = step;
  }
  return current;
}

function normalizeLeadStage(stage) {
  const value = String(stage || "").trim().toLowerCase();
  const legacy = {
    new: "consultation",
    qualified: "exclusive_buyer_agreement",
    touring: "schedule_visits",
    closed: "closed"
  };
  return legacy[value] || value || "consultation";
}

function isLeadClosed(lead) {
  const progress = normalizePipelineProgress(lead.pipelineProgress);
  const stage = normalizeLeadStage(lead.stage);
  return Boolean(progress.closed || stage === "closed");
}

function renderTemplateString(template, vars) {
  let output = String(template || "");
  for (const [key, value] of Object.entries(vars || {})) {
    output = output.replaceAll(`{{${key}}}`, String(value ?? ""));
  }
  return output;
}

async function resolveTemplate(key, fallbackSubject, fallbackBody, vars) {
  const stored = await getTemplateByKey(key);
  const subjectTemplate = stored?.subject || fallbackSubject;
  const bodyTemplate = stored?.body || fallbackBody;
  return {
    subject: renderTemplateString(subjectTemplate, vars),
    body: renderTemplateString(bodyTemplate, vars)
  };
}

function getPlanScopedTemplateKey(key, planScope) {
  const cleanKey = String(key || "").trim();
  const cleanScope = String(planScope || "all").trim().toLowerCase();
  if (cleanScope === "core" || cleanScope === "pro") {
    return `${cleanKey}__${cleanScope}`;
  }
  return cleanKey;
}

function normalizePlanId(planId) {
  return String(planId || "").trim().toLowerCase();
}

function isProPlan(planId) {
  return normalizePlanId(planId) === "pro";
}

async function resolveTemplateForPlan(planId, key, fallbackSubject, fallbackBody, vars) {
  const normalizedPlan = normalizePlanId(planId);
  const planScopedKey = normalizedPlan === "core" || normalizedPlan === "pro"
    ? `${key}__${normalizedPlan}`
    : key;

  if (planScopedKey !== key) {
    const planScoped = await getTemplateByKey(planScopedKey);
    if (planScoped) {
      return {
        subject: renderTemplateString(planScoped.subject, vars),
        body: renderTemplateString(planScoped.body, vars)
      };
    }
  }

  return resolveTemplate(key, fallbackSubject, fallbackBody, vars);
}

function buildToneProfile(messages) {
  if (!messages.length) {
    return {
      style: "unknown",
      confidence: 0.2,
      observations: ["Not enough sent follow-ups yet to infer tone."],
      rewriteHint: "Start by sending 3-5 follow-ups so RealScoreAI can infer your writing voice."
    };
  }

  const bodies = messages.map((item) => String(item.metadata?.body || ""));
  const joined = bodies.join(" ").toLowerCase();
  const totalChars = bodies.reduce((sum, body) => sum + body.length, 0);
  const avgLength = Math.round(totalChars / bodies.length);
  const questionCount = bodies.reduce((sum, body) => sum + (body.match(/\?/g) || []).length, 0);
  const ctaHits = (joined.match(/\b(call|reply|schedule|tour|today|tomorrow|this week)\b/g) || []).length;
  const softenerHits = (joined.match(/\b(if you|when you|no rush|whenever|happy to)\b/g) || []).length;

  const questionRate = questionCount / bodies.length;
  let style = "balanced";
  if (ctaHits > softenerHits + 2) style = "direct";
  if (softenerHits > ctaHits + 2) style = "consultative";

  const confidence = Math.min(0.95, 0.35 + messages.length * 0.08);
  const observations = [
    `Average message length: ${avgLength} chars`,
    `Average questions per message: ${questionRate.toFixed(1)}`,
    `Call-to-action markers: ${ctaHits}`,
    `Softening phrases: ${softenerHits}`
  ];

  const rewriteHint = style === "direct"
    ? "Keep concise CTA language and add one empathy line when intent is warm/cold."
    : style === "consultative"
      ? "Preserve supportive tone and end with one specific next-step CTA."
      : "Use your current balanced tone, then tailor CTA urgency by lead score.";

  return { style, confidence, observations, rewriteHint };
}

async function hydrateLead(lead) {
  const events = await listEventsForLead(lead.id, 200);
  return {
    ...lead,
    events,
    whyScore: calculateLeadScore(lead.signals).whyScore
  };
}

async function applyAndPersistLeadEvent(lead, event, userId) {
  const hydrated = await hydrateLead(lead);
  const updated = applyLeadEvent(hydrated, event);

  const persisted = await updateLeadSnapshot({
    id: updated.id,
    stage: updated.stage,
    score: updated.score,
    bucket: updated.bucket,
    signals: updated.signals,
    behaviorTrend: updated.behaviorTrend,
    confidenceScore: updated.confidenceScore,
    pipelineProgress: normalizePipelineProgress(updated.pipelineProgress || lead.pipelineProgress),
    closedAt: lead.closedAt || null,
    lastActivityAt: new Date().toISOString(),
    lastNurtureEmailAt: updated.lastNurtureEmailAt,
    lastSuggestedFollowUpAt: updated.lastSuggestedFollowUpAt
  });

  await insertEvent({
    userId,
    leadId: updated.id,
    eventType: event.type === "MESSAGE_RECEIVED" ? "message_received" : "score_updated",
    metadata: {
      value: event.value,
      eventType: event.type,
      meta: event.meta || {},
      score: updated.score,
      bucket: updated.bucket,
      behaviorTrend: updated.behaviorTrend,
      confidenceScore: updated.confidenceScore
    }
  });

  broadcastToUser(userId, "lead.updated", {
    leadId: updated.id,
    score: updated.score,
    bucket: updated.bucket,
    behaviorTrend: updated.behaviorTrend,
    confidenceScore: updated.confidenceScore
  });

  return {
    ...persisted,
    whyScore: updated.whyScore,
    aiIntentClassification: updated.aiIntentClassification
  };
}

app.use(cors());
app.use(express.json());
app.use(express.static(new URL("../public", import.meta.url).pathname));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "lead-prioritization-engine" });
});

app.get("/r/:trackingId", async (req, res) => {
  const trackingId = String(req.params.trackingId || "").trim();
  if (!trackingId) return res.status(404).send("Tracking link not found.");

  const link = await getTrackingLinkById(trackingId);
  if (!link) return res.status(404).send("Tracking link not found.");

  const updated = await bumpTrackingLinkClick(trackingId);
  await insertEvent({
    userId: link.user_id,
    leadId: link.lead_id,
    eventType: "listing_clicked",
    metadata: {
      trackingId,
      destinationUrl: link.destination_url,
      channel: link.channel,
      clickCount: updated?.click_count || link.click_count,
      userAgent: req.get("user-agent") || "",
      referrer: req.get("referer") || ""
    }
  });

  return res.redirect(302, link.destination_url);
});

app.get("/api/plans", (_req, res) => {
  res.json({ plans: listPlans() });
});

app.post("/api/auth/register", async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: "name, email, and password are required." });
  }

  const passwordCheck = validateStrongPassword(password);
  if (!passwordCheck.valid) {
    return res.status(400).json({ error: passwordCheck.message });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const existing = await getUserByEmail(normalizedEmail);
  if (existing) {
    return res.status(409).json({ error: "Account already exists. Please login." });
  }

  const user = await createUser({
    email: normalizedEmail,
    passwordHash: hashPassword(password),
    name: String(name).trim(),
    role: normalizedEmail === ADMIN_EMAIL && !ADMIN_PASSWORD ? "admin" : "beta",
    betaFlag: true
  });

  await insertEvent({ userId: user.id, eventType: "login", metadata: { source: "register" } });

  const token = createSession(user.id);
  return res.status(201).json({ token, user: sanitizeUser(user), onboardingComplete: false, subscription: null });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required." });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const user = await getUserByEmail(normalizedEmail);
  if (!user || user.password_hash !== hashPassword(password)) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  if (String(user.role || "").toLowerCase() === "demo_pending_reset") {
    return res.status(403).json({
      error: "Password reset required before first login. Check your email for the setup link or use Forgot password.",
      code: "password_reset_required"
    });
  }

  const token = createSession(user.id);
  await insertEvent({ userId: user.id, eventType: "login", metadata: { source: "password" } });

  const subscriptionState = await getSubscriptionStatus(user.id);

  return res.json({
    token,
    user: sanitizeUser(user),
    onboardingComplete: Boolean(user.market && user.monthly_lead_volume && user.goal),
    subscription: subscriptionState.subscription
  });
});

app.post("/api/auth/forgot-password", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email) return res.status(400).json({ error: "email is required." });

  const user = await getUserByEmail(email);
  if (user) {
    const token = createPasswordResetToken(user.id);

    const resetLink = `${APP_URL}/reset-password.html?token=${encodeURIComponent(token)}`;
    await sendEmail({
      to: user.email,
      subject: "Reset your RealScoreAI password",
      text: [
        `Hi ${String(user.name || "there").split(" ")[0]},`,
        "",
        "Use this link to reset your password:",
        resetLink,
        "",
        "This link expires in 60 minutes.",
        "",
        "- RealScoreAI"
      ].join("\n")
    });

    await insertEvent({
      userId: user.id,
      eventType: "password_reset_requested",
      metadata: { via: "forgot_password" }
    });
  }

  return res.json({
    ok: true,
    message: "If that email exists, a password reset link has been sent."
  });
});

app.post("/api/auth/reset-password", async (req, res) => {
  const token = String(req.body?.token || "").trim();
  const newPassword = String(req.body?.password || "");
  if (!token || !newPassword) {
    return res.status(400).json({ error: "token and password are required." });
  }

  const record = passwordResetTokens.get(token);
  if (!record || Date.now() > record.expiresAt) {
    passwordResetTokens.delete(token);
    return res.status(400).json({ error: "Reset token is invalid or expired." });
  }

  const passwordCheck = validateStrongPassword(newPassword);
  if (!passwordCheck.valid) {
    return res.status(400).json({ error: passwordCheck.message });
  }

  await updateUserPasswordHash(record.userId, hashPassword(newPassword));
  const updatedUser = await getUserById(record.userId);
  if (updatedUser && String(updatedUser.role || "").toLowerCase() === "demo_pending_reset") {
    await updateUserRole(record.userId, "beta", true);
  }
  passwordResetTokens.delete(token);

  await insertEvent({
    userId: record.userId,
    eventType: "password_reset_completed",
    metadata: {}
  });

  return res.json({ ok: true, message: "Password updated. You can now login." });
});

app.post("/api/auth/logout", requireAuth, async (req, res) => {
  sessions.delete(req.token);
  await insertEvent({ userId: req.user.id, eventType: "logout", metadata: {} });
  res.json({ ok: true });
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  const subscriptionState = await getSubscriptionStatus(req.user.id);
  res.json({
    user: sanitizeUser(req.user),
    onboardingComplete: Boolean(req.user.market && req.user.monthly_lead_volume && req.user.goal),
    subscription: subscriptionState.subscription,
    hasDashboardAccess: subscriptionState.hasAccess
  });
});

app.get("/api/stream", requireAuth, requireActiveAccess, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const clientId = addStreamClient(req.user, res);
  res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, clientId })}\n\n`);

  const heartbeat = setInterval(() => {
    res.write(`event: heartbeat\ndata: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`);
  }, 20000);

  req.on("close", () => {
    clearInterval(heartbeat);
    removeStreamClient(clientId);
  });
});

app.post("/api/onboarding", requireAuth, async (req, res) => {
  const { market, monthlyLeadVolume, goal } = req.body || {};
  if (!market || !monthlyLeadVolume || !goal) {
    return res.status(400).json({ error: "market, monthlyLeadVolume, and goal are required." });
  }

  const updated = await updateUserOnboarding(req.user.id, {
    market: String(market).trim(),
    monthlyLeadVolume: Number(monthlyLeadVolume),
    goal: String(goal).trim()
  });

  await insertEvent({ userId: req.user.id, eventType: "settings_changed", metadata: { onboarding: true } });

  res.json({ ok: true, onboarding: { market: updated.market, monthlyLeadVolume: updated.monthly_lead_volume, goal: updated.goal } });
});

app.get("/api/billing/status", requireAuth, async (req, res) => {
  res.json(await getSubscriptionStatus(req.user.id));
});

app.post("/api/billing/start-trial", requireAuth, async (req, res) => {
  const { planId, cardholderName, paymentMethodLast4 } = req.body || {};
  if (!planId || !plans[planId]) {
    return res.status(400).json({ error: "Valid planId is required." });
  }
  if (!cardholderName || !paymentMethodLast4) {
    return res.status(400).json({ error: "Payment details are required to start trial." });
  }

  const trialEnds = new Date(Date.now() + plans[planId].trialDays * 24 * 60 * 60 * 1000).toISOString();

  const subscription = await upsertSubscription({
    userId: req.user.id,
    plan: planId,
    status: "trialing",
    paymentMethodLast4: String(paymentMethodLast4).slice(-4),
    cardholderName: String(cardholderName).trim(),
    trialEndsAt: trialEnds
  });

  await insertEvent({ userId: req.user.id, eventType: "subscription_started", metadata: { plan: planId, status: "trialing" } });

  res.status(201).json({
    ok: true,
    subscription: {
      planId: subscription.plan,
      status: subscription.status,
      trialEndsAt: subscription.trial_ends_at,
      paymentMethodLast4: subscription.payment_method_last4,
      cardholderName: subscription.cardholder_name
    }
  });
});

app.post("/api/billing/checkout", requireAuth, async (req, res) => {
  try {
    const { planId, customerEmail } = req.body || {};
    const session = await createCheckoutSession({
      planId,
      customerEmail: customerEmail || req.user.email
    });
    res.json(session);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/billing/cancel", requireAuth, async (req, res) => {
  const existing = await getSubscriptionByUserId(req.user.id);
  if (!existing) return res.status(404).json({ error: "Subscription not found." });

  await upsertSubscription({
    userId: req.user.id,
    plan: existing.plan,
    status: "canceled",
    paymentMethodLast4: existing.payment_method_last4,
    cardholderName: existing.cardholder_name,
    trialEndsAt: existing.trial_ends_at,
    stripeCustomerId: existing.stripe_customer_id
  });

  await insertEvent({ userId: req.user.id, eventType: "subscription_canceled", metadata: { plan: existing.plan } });

  res.json({ ok: true, message: "Subscription canceled. Access will end per billing terms." });
});

app.get("/api/ai/classify-intent", requireAuth, requireActiveAccess, (req, res) => {
  const text = String(req.query.text || "");
  const fallback = String(req.query.fallback || "unknown");
  res.json(classifyIntentFromMessage(text, fallback));
});

app.get("/api/leads", requireAuth, requireActiveAccess, async (req, res) => {
  const leads = await listLeadsByUser(req.user.id);
  res.json({ leads: leads.map((lead) => ({ ...lead, whyScore: calculateLeadScore(lead.signals).whyScore })) });
});

app.get("/api/leads/closed", requireAuth, requireActiveAccess, async (req, res) => {
  const leads = await listLeadsByUser(req.user.id);
  const closed = leads
    .filter((lead) => isLeadClosed(lead))
    .map((lead) => ({
      ...lead,
      checklistStage: "closed",
      checklistStageLabel: "Closed",
      closedAt: lead.closedAt || lead.updatedAt
    }))
    .sort((a, b) => new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime());

  res.json({ closed });
});

app.get("/api/leads/:leadId", requireAuth, requireActiveAccess, async (req, res) => {
  const lead = await getLeadByIdForUser(req.params.leadId, req.user.id);
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  res.json({ lead: { ...lead, whyScore: calculateLeadScore(lead.signals).whyScore } });
});

app.get("/api/leads/:leadId/explanation", requireAuth, requireActiveAccess, async (req, res) => {
  const lead = await getLeadByIdForUser(req.params.leadId, req.user.id);
  if (!lead) return res.status(404).json({ error: "Lead not found" });

  const scored = calculateLeadScore(lead.signals);
  res.json({
    leadId: lead.id,
    score: lead.score,
    whyScore: scored.whyScore,
    aiIntentClassification: lead.aiIntentClassification,
    behaviorTrend: lead.behaviorTrend,
    confidenceScore: lead.confidenceScore
  });
});

app.get("/api/leads/:leadId/suggested-follow-up", requireAuth, requireActiveAccess, async (req, res) => {
  const lead = await getLeadByIdForUser(req.params.leadId, req.user.id);
  if (!lead) return res.status(404).json({ error: "Lead not found" });

  await insertEvent({ userId: req.user.id, leadId: lead.id, eventType: "followup_suggested", metadata: {} });

  const fallback = buildSuggestedFollowUp(lead, req.user.name);
  const firstName = String(lead.name || "").split(" ")[0] || "there";
  const templateKey = lead.signals.messageIntent === "hot" ? "followup_hot" : "followup_default";
  const templated = await resolveTemplateForPlan(req.subscription?.planId, templateKey, fallback.subject, fallback.body, {
    firstName,
    leadName: lead.name,
    score: lead.score,
    agentName: req.user.name || "RealScoreAI"
  });

  res.json({
    leadId: lead.id,
    isHighPriority: lead.score >= 75,
    score: lead.score,
    suggestion: { subject: templated.subject, body: templated.body }
  });
});

app.post("/api/leads/load-demo", requireAuth, requireActiveAccess, async (req, res) => {
  const force = Boolean(req.body?.force);
  const result = await loadDemoLeadsForUser(req.user.id, { force });

  await insertEvent({
    userId: req.user.id,
    eventType: "demo_leads_loaded",
    metadata: { force, createdCount: result.createdCount, skipped: result.skipped }
  });

  res.json({
    ok: true,
    createdCount: result.createdCount,
    skipped: result.skipped,
    message: result.skipped
      ? "You already have leads. Clear existing leads first or use force load."
      : `Loaded ${result.createdCount} demo leads.`
  });
});

app.get("/api/leads/:leadId/tracking-links", requireAuth, requireActiveAccess, async (req, res) => {
  const lead = await getLeadByIdForUser(req.params.leadId, req.user.id);
  if (!lead) return res.status(404).json({ error: "Lead not found" });

  const links = await listTrackingLinksByLeadForUser(lead.id, req.user.id);
  res.json({
    leadId: lead.id,
    links: links.map((item) => ({
      ...item,
      trackingUrl: `${APP_URL}/r/${item.id}`
    }))
  });
});

app.post("/api/leads/:leadId/tracking-links", requireAuth, requireActiveAccess, async (req, res) => {
  const lead = await getLeadByIdForUser(req.params.leadId, req.user.id);
  if (!lead) return res.status(404).json({ error: "Lead not found" });

  const destinationUrl = String(req.body?.destinationUrl || "").trim();
  const channel = String(req.body?.channel || "email").trim().toLowerCase();
  if (!destinationUrl) return res.status(400).json({ error: "destinationUrl is required." });
  if (!/^https?:\/\//i.test(destinationUrl)) {
    return res.status(400).json({ error: "destinationUrl must start with http:// or https://." });
  }

  const id = crypto.randomBytes(8).toString("hex");
  const link = await createTrackingLink({
    id,
    userId: req.user.id,
    leadId: lead.id,
    destinationUrl,
    channel
  });

  await insertEvent({
    userId: req.user.id,
    leadId: lead.id,
    eventType: "tracking_link_created",
    metadata: { trackingId: id, destinationUrl, channel }
  });

  res.status(201).json({
    link: {
      ...link,
      trackingUrl: `${APP_URL}/r/${id}`
    }
  });
});

app.post("/api/leads/:leadId/send-follow-up", requireAuth, requireActiveAccess, async (req, res) => {
  try {
    const lead = await getLeadByIdForUser(req.params.leadId, req.user.id);
    if (!lead) return res.status(404).json({ error: "Lead not found" });

    const defaultSuggestion = buildSuggestedFollowUp(lead, req.user.name);
    const subject = String(req.body?.subject || defaultSuggestion.subject);
    const body = String(req.body?.body || defaultSuggestion.body);

    const delivery = await sendEmail({
      to: lead.email,
      subject,
      text: body,
      replyTo: req.user.email,
      fromName: req.user.name
    });

    await updateLeadSnapshot({
      ...lead,
      lastSuggestedFollowUpAt: new Date().toISOString()
    });

    await insertEvent({
      userId: req.user.id,
      leadId: lead.id,
      eventType: "followup_sent",
      metadata: { subject, body, deliveryMode: delivery.mode }
    });

    res.json({ ok: true, leadId: lead.id, delivery });
  } catch (error) {
    res.status(400).json({ error: error.message || "Failed to send follow-up email." });
  }
});

app.post("/api/leads", requireAuth, requireActiveAccess, async (req, res) => {
  const {
    name,
    email,
    phone = null,
    stage = "consultation",
    responseTimeMinutes = 60,
    messageIntent = "unknown",
    followThroughRate = 0,
    followThroughSignal = "",
    weeklyEngagementTouches = 0,
    pipelineProgress = {}
  } = req.body || {};

  if (!name || !email) {
    return res.status(400).json({ error: "name and email are required." });
  }

  const signals = {
    responseTimeMinutes: Number(responseTimeMinutes),
    messageIntent: String(messageIntent),
    followThroughRate: normalizeFollowThroughRate(followThroughRate, followThroughSignal),
    weeklyEngagementTouches: Number(weeklyEngagementTouches)
  };
  const normalizedProgress = normalizePipelineProgress(pipelineProgress);
  const normalizedStage = normalizeLeadStage(stage) || stageFromPipeline(normalizedProgress);
  const closedAt = normalizedProgress.closed || normalizedStage === "closed"
    ? new Date().toISOString()
    : null;

  const scored = calculateLeadScore(signals);
  const lead = await createLead({
    userId: req.user.id,
    name: String(name).trim(),
    email: String(email).trim().toLowerCase(),
    phone: phone ? String(phone).trim() : null,
    status: normalizedStage,
    score: scored.score,
    bucket: scored.bucket,
    signals,
    behaviorTrend: "stable",
    confidenceScore: 60,
    pipelineProgress: normalizedProgress,
    closedAt,
    lastActivityAt: new Date().toISOString()
  });

  await insertEvent({
    userId: req.user.id,
    leadId: lead.id,
    eventType: "lead_created",
    metadata: { source: "manual_create" }
  });

  res.status(201).json({ lead: { ...lead, whyScore: scored.whyScore } });
});

app.put("/api/leads/:leadId", requireAuth, requireActiveAccess, async (req, res) => {
  const existing = await getLeadByIdForUser(req.params.leadId, req.user.id);
  if (!existing) return res.status(404).json({ error: "Lead not found" });

  const merged = {
    ...existing,
    name: String(req.body?.name ?? existing.name).trim(),
    email: String(req.body?.email ?? existing.email).trim().toLowerCase(),
    phone: req.body?.phone !== undefined ? String(req.body.phone || "").trim() || null : existing.phone,
    stage: normalizeLeadStage(String(req.body?.stage ?? existing.stage)),
    pipelineProgress: normalizePipelineProgress(req.body?.pipelineProgress ?? existing.pipelineProgress),
    signals: {
      responseTimeMinutes: Number(req.body?.responseTimeMinutes ?? existing.signals.responseTimeMinutes),
      messageIntent: String(req.body?.messageIntent ?? existing.signals.messageIntent),
      followThroughRate: normalizeFollowThroughRate(
        req.body?.followThroughRate ?? existing.signals.followThroughRate,
        req.body?.followThroughSignal ?? ""
      ),
      weeklyEngagementTouches: Number(req.body?.weeklyEngagementTouches ?? existing.signals.weeklyEngagementTouches)
    }
  };

  const scored = calculateLeadScore(merged.signals);
  const shouldClose = merged.pipelineProgress.closed || merged.stage === "closed";
  const closedAt = shouldClose ? (existing.closedAt || new Date().toISOString()) : null;
  const updated = await updateLeadForUser(existing.id, req.user.id, {
    ...merged,
    score: scored.score,
    bucket: scored.bucket,
    behaviorTrend: existing.behaviorTrend,
    confidenceScore: existing.confidenceScore,
    pipelineProgress: merged.pipelineProgress,
    closedAt,
    lastActivityAt: new Date().toISOString()
  });

  await insertEvent({
    userId: req.user.id,
    leadId: existing.id,
    eventType: "lead_updated",
    metadata: { score: scored.score, bucket: scored.bucket }
  });

  res.json({ lead: { ...updated, whyScore: scored.whyScore } });
});

app.delete("/api/leads/:leadId", requireAuth, requireActiveAccess, async (req, res) => {
  const deleted = await deleteLeadForUser(req.params.leadId, req.user.id);
  if (!deleted) return res.status(404).json({ error: "Lead not found" });

  await insertEvent({ userId: req.user.id, leadId: req.params.leadId, eventType: "lead_deleted", metadata: {} });
  res.json({ ok: true, leadId: req.params.leadId });
});

app.post("/api/leads/:leadId/events", requireAuth, requireActiveAccess, async (req, res) => {
  const lead = await getLeadByIdForUser(req.params.leadId, req.user.id);
  if (!lead) return res.status(404).json({ error: "Lead not found" });

  const { type, value, meta = {} } = req.body || {};
  if (!type) return res.status(400).json({ error: "Event type is required" });

  const updated = await applyAndPersistLeadEvent(lead, { type, value, meta }, req.user.id);

  res.json({
    leadId: updated.id,
    score: updated.score,
    bucket: updated.bucket,
    whyScore: updated.whyScore,
    aiIntentClassification: updated.aiIntentClassification,
    behaviorTrend: updated.behaviorTrend,
    confidenceScore: updated.confidenceScore
  });
});

app.post("/api/webhooks/lead-activity", requireWebhookKey, async (req, res) => {
  const { leadId, leadEmail, eventType = "MESSAGE_RECEIVED", value = "", channel = "external", messageText = "" } = req.body || {};

  let lead = null;
  if (leadId) {
    lead = await getLeadById(String(leadId));
  }

  if (!lead && leadEmail) {
    const userId = String(req.body?.userId || "");
    if (!userId) return res.status(400).json({ error: "userId is required when using leadEmail webhook lookup." });
    lead = await getLeadByEmailForUser(String(leadEmail), userId);
  }

  if (!lead) return res.status(404).json({ error: "Lead not found for webhook payload." });

  const updated = await applyAndPersistLeadEvent(
    lead,
    {
      type: String(eventType),
      value,
      meta: { channel, messageText: String(messageText || value || "") }
    },
    lead.userId
  );

  await insertEvent({ userId: lead.userId, leadId: lead.id, eventType: "webhook_received", metadata: { eventType, channel } });

  return res.json({
    ok: true,
    leadId: updated.id,
    score: updated.score,
    bucket: updated.bucket,
    behaviorTrend: updated.behaviorTrend,
    confidenceScore: updated.confidenceScore
  });
});

app.get("/api/dashboard", requireAuth, requireActiveAccess, async (req, res) => {
  const leads = await listLeadsByUser(req.user.id);
  const openLeads = leads.filter((lead) => !isLeadClosed(lead));

  const enrich = (lead) => {
    const progress = normalizePipelineProgress(lead.pipelineProgress);
    const stage = normalizeLeadStage(lead.stage);
    const stageFromList = progress && Object.keys(progress).length ? stageFromPipeline(progress) : stage;
    const stageRank = LEAD_PIPELINE_STEPS.indexOf(stageFromList);
    return {
      ...lead,
      checklistStage: stageFromList,
      checklistStageLabel: CHECKLIST_STAGE_LABELS[stageFromList] || "Consultation",
      preapproved: Boolean(progress.preapproval),
      hasEba: Boolean(progress.exclusive_buyer_agreement),
      stageRank: stageRank >= 0 ? stageRank : 0
    };
  };

  const enriched = openLeads.map(enrich);
  const top5 = enriched
    .filter((lead) => lead.hasEba && lead.preapproved)
    .sort((a, b) => b.stageRank - a.stageRank || b.score - a.score)
    .slice(0, 5);

  const onDeck = enriched
    .filter((lead) => lead.hasEba && !lead.preapproved)
    .sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt));

  const potentials = enriched
    .filter((lead) => !lead.hasEba)
    .sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt));

  await insertEvent({
    userId: req.user.id,
    eventType: "dashboard_viewed",
    metadata: { top5: top5.length, onDeck: onDeck.length, potentials: potentials.length }
  });

  res.json({
    top5: top5.map((lead) => ({ ...lead, whyScore: calculateLeadScore(lead.signals).whyScore })),
    onDeck: onDeck.map((lead) => ({ ...lead, whyScore: calculateLeadScore(lead.signals).whyScore })),
    potentials: potentials.map((lead) => ({ ...lead, whyScore: calculateLeadScore(lead.signals).whyScore }))
  });
});

app.get("/api/usage", requireAuth, requireActiveAccess, async (req, res) => {
  res.json({ userId: req.user.id, usage: await getUsageByUser(req.user.id) });
});

app.get("/api/ai/tone-profile", requireAuth, requireActiveAccess, async (req, res) => {
  const sentEvents = await listUserEventsByType(req.user.id, "followup_sent", 50);
  const profile = buildToneProfile(sentEvents);
  res.json({
    userId: req.user.id,
    sampleSize: sentEvents.length,
    profile
  });
});

app.get("/api/followups/sent-log", requireAuth, requireActiveAccess, async (req, res) => {
  const [events, leads] = await Promise.all([
    listUserEventsByType(req.user.id, "followup_sent", 50),
    listLeadsByUser(req.user.id)
  ]);

  const leadNameById = new Map(leads.map((lead) => [lead.id, lead.name]));
  const sentLog = events
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map((event) => ({
      id: event.id,
      leadId: event.leadId,
      leadName: leadNameById.get(event.leadId) || "Lead follow-up",
      type: event.meta?.source === "followup_cadence_auto" ? "Auto follow-up" : "Manual follow-up",
      mode: event.meta?.deliveryMode || "",
      subject: event.meta?.subject || "",
      createdAt: event.createdAt
    }));

  res.json({ sentLog });
});

app.post("/api/automation/auto-nurture", requireAuth, requireActiveAccess, async (req, res) => {
  try {
    const leads = await listLeadsByUser(req.user.id);
    const autoSendEnabled = isProPlan(req.subscription?.planId);
    const movedLeadIds = [];
    const emailedLeadIds = [];
    const manualReviewLeadIds = [];

    for (const lead of leads) {
      if (lead.score < 50) {
        if (lead.stage !== "nurture") {
          lead.stage = "nurture";
          movedLeadIds.push(lead.id);
          await insertEvent({ userId: req.user.id, leadId: lead.id, eventType: "auto_nurture_moved", metadata: {} });
        }

        const lastSent = lead.lastNurtureEmailAt ? new Date(lead.lastNurtureEmailAt).getTime() : 0;
        const shouldSend = !lastSent || Date.now() - lastSent >= 30 * 24 * 60 * 60 * 1000;

        if (shouldSend) {
          const fallback = buildMonthlyNurtureEmail(lead, req.user.name);
          const firstName = String(lead.name || "").split(" ")[0] || "there";
          const templated = await resolveTemplateForPlan(req.subscription?.planId, "nurture_monthly", fallback.subject, fallback.text, {
            firstName,
            leadName: lead.name,
            agentName: req.user.name || "RealScoreAI"
          });
          if (autoSendEnabled) {
            await sendEmail({
              to: lead.email,
              subject: templated.subject,
              text: templated.body,
              replyTo: req.user.email,
              fromName: req.user.name
            });
            lead.lastNurtureEmailAt = new Date().toISOString();
            emailedLeadIds.push(lead.id);
            await insertEvent({ userId: req.user.id, leadId: lead.id, eventType: "nurture_email_sent", metadata: { mode: "auto" } });
          } else {
            manualReviewLeadIds.push(lead.id);
            await insertEvent({ userId: req.user.id, leadId: lead.id, eventType: "nurture_email_due_manual", metadata: {} });
          }
        }

        await updateLeadSnapshot(lead);
      }
    }

    broadcastToUser(req.user.id, "dashboard.refresh", {
      reason: "auto_nurture_run",
      movedCount: movedLeadIds.length,
      emailedCount: emailedLeadIds.length
    });

    res.json({
      job: "auto_nurture_low_score",
      autoSendEnabled,
      emailAutomationMode: autoSendEnabled ? "auto" : "manual_only",
      threshold: 50,
      movedLeadIds,
      emailedLeadIds,
      manualReviewLeadIds,
      movedCount: movedLeadIds.length,
      emailedCount: emailedLeadIds.length,
      manualReviewCount: manualReviewLeadIds.length
    });
  } catch (error) {
    res.status(400).json({ error: error.message || "Auto-nurture failed." });
  }
});

app.post("/api/automation/weekly-reactivation", requireAuth, requireActiveAccess, async (req, res) => {
  const leads = await listLeadsByUser(req.user.id);
  const reminders = leads
    .filter((lead) => lead.score >= 50 && lead.score < 75)
    .filter((lead) => lead.lastActivityAt && Date.now() - new Date(lead.lastActivityAt).getTime() >= 5 * 24 * 60 * 60 * 1000)
    .map((lead) => ({ id: lead.id, name: lead.name, score: lead.score }));

  for (const reminder of reminders) {
    await insertEvent({ userId: req.user.id, leadId: reminder.id, eventType: "reactivation_sent", metadata: {} });
  }

  res.json({ job: "weekly_reactivation_reminder", reminders, count: reminders.length });
});

app.post("/api/automation/daily-digest", requireAuth, requireActiveAccess, async (req, res) => {
  try {
    const leads = await listLeadsByUser(req.user.id);
    const top = leads.slice().sort((a, b) => b.score - a.score).slice(0, 5).map((lead) => ({
      id: lead.id,
      name: lead.name,
      score: lead.score,
      reason: calculateLeadScore(lead.signals).whyScore.summary
    }));

    const fallback = buildDailyDigestEmail(req.user.name, top);
    const leadList = top.map((lead, idx) => `${idx + 1}. ${lead.name} (Score ${lead.score}) - ${lead.reason}`).join("\n");
    const firstName = String(req.user.name || "").split(" ")[0] || "there";
    const templated = await resolveTemplateForPlan(req.subscription?.planId, "digest_daily", fallback.subject, fallback.text, {
      firstName,
      leadList,
      agentName: req.user.name || "RealScoreAI"
    });
    const delivery = await sendEmail({ to: req.user.email, subject: templated.subject, text: templated.body });

    await insertEvent({ userId: req.user.id, eventType: "digest_sent", metadata: { leadCount: top.length, mode: delivery.mode } });

    res.json({ job: "daily_focus_digest", to: req.user.email, leadCount: top.length, leads: top, delivery });
  } catch (error) {
    res.status(400).json({ error: error.message || "Daily digest failed." });
  }
});

app.post("/api/automation/closed-followup-3m", requireAuth, requireActiveAccess, async (req, res) => {
  try {
    const leads = await listLeadsByUser(req.user.id);
    const autoSendEnabled = isProPlan(req.subscription?.planId);
    const now = Date.now();
    const sent = [];
    const dueManualReview = [];
    const skipped = [];

    for (const lead of leads) {
      if (!isLeadClosed(lead)) continue;

      const closedAtMs = lead.closedAt ? new Date(lead.closedAt).getTime() : new Date(lead.updatedAt).getTime();
      if (!closedAtMs || Number.isNaN(closedAtMs)) {
        skipped.push({ leadId: lead.id, reason: "invalid_closed_date" });
        continue;
      }

      const daysSince = Math.floor((now - closedAtMs) / (24 * 60 * 60 * 1000));
      if (daysSince < 90) {
        skipped.push({ leadId: lead.id, reason: "not_due_yet" });
        continue;
      }

      const alreadySent = await hasLeadEventType(lead.id, "closed_followup_sent_3m");
      if (alreadySent) {
        skipped.push({ leadId: lead.id, reason: "already_sent" });
        continue;
      }

      const firstName = String(lead.name || "").split(" ")[0] || "there";
      const fallbackSubject = `Checking in after your closing, ${firstName}`;
      const fallbackBody = [
        `Hi ${firstName},`,
        "",
        "It has been about 3 months since your closing, and I wanted to check in to make sure everything is going smoothly.",
        "",
        "If you need anything at all or know anyone who could use help buying or selling, I am happy to help.",
        "",
        `- ${String(req.user.name || "").trim() || "RealScoreAI"}`
      ].join("\n");

      const templated = await resolveTemplateForPlan(req.subscription?.planId, "closed_followup_3m", fallbackSubject, fallbackBody, {
        firstName,
        leadName: lead.name,
        agentName: req.user.name || "RealScoreAI"
      });

      if (autoSendEnabled) {
        const delivery = await sendEmail({
          to: lead.email,
          subject: templated.subject,
          text: templated.body,
          replyTo: req.user.email,
          fromName: req.user.name
        });

        await insertEvent({
          userId: req.user.id,
          leadId: lead.id,
          eventType: "closed_followup_sent_3m",
          metadata: {
            deliveryMode: delivery.mode,
            closedAt: lead.closedAt || lead.updatedAt,
            daysSinceClose: daysSince,
            mode: "auto"
          }
        });

        sent.push({ leadId: lead.id, leadName: lead.name, mode: delivery.mode, daysSinceClose: daysSince });
      } else {
        dueManualReview.push({
          leadId: lead.id,
          leadName: lead.name,
          daysSinceClose: daysSince,
          suggestion: templated
        });
        await insertEvent({
          userId: req.user.id,
          leadId: lead.id,
          eventType: "closed_followup_due_manual_3m",
          metadata: {
            closedAt: lead.closedAt || lead.updatedAt,
            daysSinceClose: daysSince
          }
        });
      }
    }

    res.json({
      job: "closed_followup_3m",
      autoSendEnabled,
      emailAutomationMode: autoSendEnabled ? "auto" : "manual_only",
      sentCount: sent.length,
      dueManualCount: dueManualReview.length,
      skippedCount: skipped.length,
      sent,
      dueManualReview,
      skipped
    });
  } catch (error) {
    res.status(400).json({ error: error.message || "Closed follow-up job failed." });
  }
});

app.post("/api/automation/followup-cadence", requireAuth, requireActiveAccess, async (req, res) => {
  if (!isProPlan(req.subscription?.planId)) {
    return res.status(403).json({ error: "Follow-up automation is available on the Pro plan only." });
  }
  const autoSendEnabled = isProPlan(req.subscription?.planId);
  const now = Date.now();
  const leads = await listLeadsByUser(req.user.id);
  const due = [];
  const autoSent = [];

  for (const lead of leads) {
    if (lead.score < 50) continue;
    if (isLeadClosed(lead)) continue;

    const cadenceMs = lead.score >= 75 ? 24 * 60 * 60 * 1000 : 72 * 60 * 60 * 1000;
    const cadenceLabel = lead.score >= 75 ? "24h" : "72h";
    const hasFollowupHistory = Boolean(lead.lastSuggestedFollowUpAt);
    const baseline = lead.lastSuggestedFollowUpAt || lead.lastActivityAt || lead.updatedAt || lead.createdAt;
    const baselineMs = baseline ? new Date(baseline).getTime() : 0;
    const isDue = !hasFollowupHistory || !baselineMs || now - baselineMs >= cadenceMs;

    if (!isDue) continue;

    const fallback = buildSuggestedFollowUp(lead, req.user.name);
    const firstName = String(lead.name || "").split(" ")[0] || "there";
    const templateKey = lead.signals.messageIntent === "hot" ? "followup_hot" : "followup_default";
    const templated = await resolveTemplateForPlan(req.subscription?.planId, templateKey, fallback.subject, fallback.body, {
      firstName,
      leadName: lead.name,
      score: lead.score,
      agentName: req.user.name || "RealScoreAI"
    });

    due.push({
      leadId: lead.id,
      leadName: lead.name,
      score: lead.score,
      cadence: cadenceLabel,
      suggestion: templated,
      autoSendEnabled
    });

    if (autoSendEnabled) {
      const delivery = await sendEmail({
        to: lead.email,
        subject: templated.subject,
        text: templated.body,
        replyTo: req.user.email,
        fromName: req.user.name
      });

      await insertEvent({
        userId: req.user.id,
        leadId: lead.id,
        eventType: "followup_sent",
        metadata: {
          subject: templated.subject,
          body: templated.body,
          deliveryMode: delivery.mode,
          source: "followup_cadence_auto"
        }
      });

      autoSent.push({
        leadId: lead.id,
        leadName: lead.name,
        mode: delivery.mode
      });
    }

    await updateLeadSnapshot({
      ...lead,
      lastSuggestedFollowUpAt: new Date().toISOString()
    });

    await insertEvent({
      userId: req.user.id,
      leadId: lead.id,
      eventType: "followup_cadence_due",
      metadata: { cadence: cadenceLabel, score: lead.score }
    });
  }

  if (due.length) {
    broadcastToUser(req.user.id, "dashboard.refresh", {
      reason: "followup_cadence_run",
      dueCount: due.length
    });
  }

  res.json({
    job: "followup_cadence",
    autoSendEnabled,
    emailAutomationMode: autoSendEnabled ? "auto" : "manual_only",
    dueCount: due.length,
    autoSentCount: autoSent.length,
    due,
    autoSent
  });
});

app.post("/api/admin/invites", requireAdminAccess, (req, res) => {
  const { email, name = "" } = req.body || {};
  if (!email) return res.status(400).json({ error: "email is required." });

  const cleanEmail = String(email).trim().toLowerCase();
  const inviteId = crypto.randomBytes(12).toString("hex");
  const invite = {
    id: inviteId,
    email: cleanEmail,
    name: String(name).trim(),
    status: "pending",
    createdAt: new Date().toISOString(),
    inviteUrl: `${APP_URL}/signup.html?email=${encodeURIComponent(cleanEmail)}`
  };

  invites.set(invite.id, invite);
  return res.status(201).json({ ok: true, invite });
});

app.get("/api/admin/invites", requireAdminAccess, (_req, res) => {
  const list = [...invites.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ invites: list });
});

app.post("/api/admin/invites/:inviteId/send", requireAdminAccess, async (req, res) => {
  const invite = invites.get(req.params.inviteId);
  if (!invite) return res.status(404).json({ error: "Invite not found." });

  await sendEmail({
    to: invite.email,
    subject: "Your RealScoreAI invite",
    text: [
      `Hi ${invite.name || "there"},`,
      "",
      "You have been invited to try RealScoreAI.",
      "",
      `Create your account here: ${invite.inviteUrl}`,
      "",
      "Your lead scoring, dashboard, and follow-up workflow will be available after signup.",
      "",
      "- RealScoreAI"
    ].join("\n"),
    fromName: "RealScoreAI"
  });

  invite.status = "sent";
  invite.sentAt = new Date().toISOString();
  invites.set(invite.id, invite);
  return res.json({ ok: true, invite });
});

app.post("/api/admin/demo-accounts", requireAdminAccess, async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const name = String(req.body?.name || "").trim();
  const requestedPlan = String(req.body?.plan || "core").trim().toLowerCase();
  const planId = requestedPlan === "pro" ? "pro" : "core";
  const trialDaysRaw = Number(req.body?.trialDays || 30);
  const trialDays = Number.isFinite(trialDaysRaw) ? Math.max(1, Math.min(90, Math.floor(trialDaysRaw))) : 30;

  if (!email || !name) {
    return res.status(400).json({ error: "name and email are required." });
  }

  const existing = await getUserByEmail(email);
  if (existing) {
    return res.status(409).json({ error: "A user with that email already exists." });
  }

  const tempPassword = crypto.randomBytes(32).toString("hex");
  const user = await createUser({
    email,
    passwordHash: hashPassword(tempPassword),
    name,
    role: "demo_pending_reset",
    betaFlag: true
  });

  const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toISOString();
  await upsertSubscription({
    userId: user.id,
    plan: planId,
    status: "trialing",
    trialEndsAt
  });

  const token = createPasswordResetToken(user.id, 24 * 60 * 60 * 1000);
  const resetLink = `${APP_URL}/reset-password.html?token=${encodeURIComponent(token)}`;

  await sendEmail({
    to: email,
    subject: `Your RealScoreAI ${planId.toUpperCase()} demo account`,
    text: [
      `Hi ${name.split(" ")[0] || "there"},`,
      "",
      `Your RealScoreAI ${planId.toUpperCase()} demo account is ready.`,
      "Set your password here to activate login:",
      resetLink,
      "",
      "This setup link expires in 24 hours. If it expires, use Forgot password on the login page.",
      "",
      "- RealScoreAI"
    ].join("\n"),
    fromName: "RealScoreAI"
  });

  await insertEvent({
    userId: user.id,
    eventType: "demo_account_created",
    metadata: { plan: planId, trialDays, trialEndsAt }
  });

  res.status(201).json({
    ok: true,
    demoAccount: { email, name, plan: planId, trialDays, trialEndsAt }
  });
});

app.get("/api/admin/metrics", requireAdminAccess, async (_req, res) => {
  res.json(await getAdminMetrics());
});

app.get("/api/admin/email/status", requireAdminAccess, async (_req, res) => {
  res.json({ smtp: getSmtpStatus() });
});

app.post("/api/admin/email/test", requireAdminAccess, async (req, res) => {
  try {
    const to = String(req.body?.to || "").trim();
    if (!to) {
      return res.status(400).json({ error: "to is required." });
    }

    const result = await sendEmail({
      to,
      subject: "RealScoreAI SMTP test",
      text: [
        "This is a RealScoreAI SMTP test email.",
        "",
        `Environment: ${process.env.NODE_ENV || "development"}`,
        `Timestamp: ${new Date().toISOString()}`
      ].join("\n"),
      replyTo: req.user?.email || "",
      fromName: req.user?.name || "RealScoreAI"
    });

    res.json({ ok: true, delivery: result, smtp: getSmtpStatus() });
  } catch (error) {
    res.status(400).json({ error: error.message || "Failed to send test email." });
  }
});

app.get("/api/admin/templates", requireAdminAccess, async (_req, res) => {
  const requestedPlan = String(_req.query.plan || "all").trim().toLowerCase();
  const templates = await listTemplates();
  if (requestedPlan === "all") {
    return res.json({ templates });
  }

  const suffix = `__${requestedPlan}`;
  const filtered = templates
    .filter((tpl) => tpl.key.endsWith(suffix))
    .map((tpl) => ({ ...tpl, baseKey: tpl.key.slice(0, -suffix.length), planScope: requestedPlan }));
  return res.json({ templates: filtered });
});

app.put("/api/admin/templates/:key", requireAdminAccess, async (req, res) => {
  const baseKey = String(req.params.key || "").trim();
  const subject = String(req.body?.subject || "").trim();
  const body = String(req.body?.body || "").trim();
  const planScope = String(req.body?.planScope || "all").trim().toLowerCase();
  const key = getPlanScopedTemplateKey(baseKey, planScope);

  if (!baseKey || !subject || !body) {
    return res.status(400).json({ error: "key, subject, and body are required." });
  }

  const template = await upsertTemplate({ key, subject, body });
  res.json({ template: { ...template, baseKey, planScope } });
});

app.post("/api/admin/automation/beta-ending-reminders", requireAdminAccess, async (_req, res) => {
  const users = await listTrialingUsers();
  const now = Date.now();
  const sent = [];
  const skipped = [];

  for (const user of users) {
    if (!user.beta_flag) {
      skipped.push({ userId: user.user_id, reason: "not_beta_flagged" });
      continue;
    }

    const trialEndsAt = new Date(user.trial_ends_at).getTime();
    if (Number.isNaN(trialEndsAt) || trialEndsAt <= now) {
      skipped.push({ userId: user.user_id, reason: "trial_expired_or_invalid" });
      continue;
    }

    const msLeft = trialEndsAt - now;
    const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
    const targetDays = daysLeft <= 1 ? 1 : daysLeft <= 7 ? 7 : 0;

    if (!targetDays) {
      skipped.push({ userId: user.user_id, reason: "outside_reminder_window" });
      continue;
    }

    const eventType = targetDays === 1 ? "beta_reminder_1d" : "beta_reminder_7d";
    const trialIso = new Date(user.trial_ends_at).toISOString();
    const alreadySent = await hasUserEventForTrial(user.user_id, eventType, trialIso);

    if (alreadySent) {
      skipped.push({ userId: user.user_id, reason: "already_sent_for_trial" });
      continue;
    }

    const email = buildBetaEndingReminderEmail({
      userName: user.name,
      plan: user.plan,
      daysLeft: targetDays
    });
    const firstName = String(user.name || "").split(" ")[0] || "there";
    const templated = await resolveTemplateForPlan(user.plan, "beta_ending", email.subject, email.text, {
      firstName,
      plan: user.plan,
      daysLeft: targetDays
    });

    const delivery = await sendEmail({
      to: user.email,
      subject: templated.subject,
      text: templated.body
    });

    await insertEvent({
      userId: user.user_id,
      eventType,
      metadata: {
        plan: user.plan,
        daysLeft: targetDays,
        trialEndsAt: trialIso,
        deliveryMode: delivery.mode
      }
    });

    sent.push({
      userId: user.user_id,
      email: user.email,
      daysLeft: targetDays,
      mode: delivery.mode
    });
  }

  res.json({
    job: "beta_ending_reminders",
    totalTrialing: users.length,
    sentCount: sent.length,
    skippedCount: skipped.length,
    sent,
    skipped
  });
});

app.get("/api/admin/export/usage.csv", requireAdminAccess, async (_req, res) => {
  const metrics = await getAdminMetrics();
  const rows = [
    {
      total_users: metrics.totalUsers,
      active_users_7d: metrics.activeUsers7d,
      total_leads: metrics.totalLeads,
      total_events: metrics.totalEvents,
      avg_score: metrics.avgScore,
      leads_per_user: metrics.leadsPerUser
    }
  ];

  const csv = toCsv(rows, ["total_users", "active_users_7d", "total_leads", "total_events", "avg_score", "leads_per_user"]);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="usage-export.csv"');
  res.send(csv);
});

app.get("/api/admin/export/leads.csv", requireAdminAccess, async (_req, res) => {
  const allLeads = [];
  const leads = await listAllLeads();
  for (const lead of leads) {
    allLeads.push({
      lead_id: lead.id,
      user_id: lead.userId,
      lead_name: lead.name,
      email: lead.email,
      status: lead.stage,
      score: lead.score,
      bucket: lead.bucket,
      behavior_trend: lead.behaviorTrend,
      confidence_score: lead.confidenceScore,
      message_intent: lead.signals.messageIntent,
      response_time_minutes: lead.signals.responseTimeMinutes,
      follow_through_rate: lead.signals.followThroughRate,
      weekly_engagement_touches: lead.signals.weeklyEngagementTouches,
      created_at: lead.createdAt,
      updated_at: lead.updatedAt
    });
  }

  const csv = toCsv(allLeads, [
    "lead_id",
    "user_id",
    "lead_name",
    "email",
    "status",
    "score",
    "bucket",
    "behavior_trend",
    "confidence_score",
    "message_intent",
    "response_time_minutes",
    "follow_through_rate",
    "weekly_engagement_touches",
    "created_at",
    "updated_at"
  ]);

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="leads-export.csv"');
  res.send(csv);
});

async function start() {
  if (isProduction) {
    const required = [
      "DATABASE_URL",
      "ADMIN_KEY",
      "WEBHOOK_KEY",
      "STRIPE_SECRET_KEY",
      "SMTP_HOST",
      "SMTP_USER",
      "SMTP_PASS"
    ];
    const missing = required.filter((key) => !process.env[key]);
    if (missing.length > 0) {
      throw new Error(`Missing required production environment variables: ${missing.join(", ")}`);
    }
  }

  await runSchema();
  await ensureAdminUser();
  app.listen(PORT, () => {
    console.log(`Lead engine running on http://localhost:${PORT}`);
  });
}

start().catch((error) => {
  console.error("Failed to start server:", error.message);
  process.exit(1);
});
