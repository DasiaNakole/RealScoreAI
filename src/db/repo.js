import { pool } from "./client.js";

function mapLead(row) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    source: row.source,
    notes: row.notes,
    lastContactedAt: row.last_contacted_at,
    stage: row.status,
    score: Number(row.score),
    bucket: row.bucket,
    signals: {
      responseTimeMinutes: Number(row.response_time_minutes),
      messageIntent: row.message_intent,
      followThroughRate: Number(row.follow_through_rate),
      weeklyEngagementTouches: Number(row.weekly_engagement_touches)
    },
    behaviorTrend: row.behavior_trend,
    confidenceScore: Number(row.confidence_score),
    pipelineProgress: row.pipeline_progress || {},
    closedAt: row.closed_at,
    lastActivityAt: row.last_activity_at,
    lastNurtureEmailAt: row.last_nurture_email_at,
    lastSuggestedFollowUpAt: row.last_suggested_follow_up_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    aiIntentClassification: {
      intent: row.message_intent,
      confidence: Number(row.confidence_score) / 100,
      source: "stored_state",
      reason: "Loaded from persisted lead state."
    }
  };
}

export async function createUser({ email, passwordHash, name, role = "beta", betaFlag = true }) {
  const result = await pool.query(
    `insert into users (email, password_hash, name, role, beta_flag, last_active_at)
     values ($1, $2, $3, $4, $5, now())
     returning id, email, name, role, beta_flag, created_at, last_active_at`,
    [email, passwordHash, name, role, betaFlag]
  );
  return result.rows[0];
}

export async function getUserByEmail(email) {
  const result = await pool.query(
    `select id, email, password_hash, name, role, beta_flag, created_at, last_active_at, market, monthly_lead_volume, goal
     from users where email = $1`,
    [email]
  );
  return result.rows[0] || null;
}

export async function getUserById(userId) {
  const result = await pool.query(
    `select id, email, password_hash, name, role, beta_flag, created_at, last_active_at, market, monthly_lead_volume, goal
     from users where id = $1`,
    [userId]
  );
  return result.rows[0] || null;
}

export async function listUsers() {
  const result = await pool.query(
    `select u.id, u.email, u.name, u.role, u.beta_flag, u.created_at, u.last_active_at,
            s.plan, s.status as subscription_status, s.trial_ends_at
     from users u
     left join subscriptions s on s.user_id = u.id
     order by created_at desc`
  );
  return result.rows;
}

export async function deleteUserById(userId) {
  const result = await pool.query(
    `delete from users
     where id = $1
     returning id, email, name, role`,
    [userId]
  );
  return result.rows[0] || null;
}

export async function touchUser(userId) {
  await pool.query(`update users set last_active_at = now() where id = $1`, [userId]);
}

export async function updateUserPasswordHash(userId, passwordHash) {
  await pool.query(`update users set password_hash = $2, last_active_at = now() where id = $1`, [userId, passwordHash]);
}

export async function updateUserRole(userId, role, betaFlag = false) {
  const result = await pool.query(
    `update users
     set role = $2, beta_flag = $3, last_active_at = now()
     where id = $1
     returning id, email, password_hash, name, role, beta_flag, created_at, last_active_at, market, monthly_lead_volume, goal`,
    [userId, role, betaFlag]
  );
  return result.rows[0] || null;
}

export async function updateUserOnboarding(userId, { market, monthlyLeadVolume, goal }) {
  const result = await pool.query(
    `update users
     set market = $2, monthly_lead_volume = $3, goal = $4, last_active_at = now()
     where id = $1
     returning id, email, name, role, beta_flag, created_at, last_active_at, market, monthly_lead_volume, goal`,
    [userId, market, monthlyLeadVolume, goal]
  );
  return result.rows[0];
}

export async function upsertSubscription({ userId, plan, status, paymentMethodLast4 = null, cardholderName = null, trialEndsAt = null, stripeCustomerId = null }) {
  const result = await pool.query(
    `insert into subscriptions (user_id, plan, status, payment_method_last4, cardholder_name, trial_ends_at, stripe_customer_id)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (user_id)
     do update set
       plan = excluded.plan,
       status = excluded.status,
       payment_method_last4 = excluded.payment_method_last4,
       cardholder_name = excluded.cardholder_name,
       trial_ends_at = excluded.trial_ends_at,
       stripe_customer_id = coalesce(excluded.stripe_customer_id, subscriptions.stripe_customer_id),
       updated_at = now()
     returning *`,
    [userId, plan, status, paymentMethodLast4, cardholderName, trialEndsAt, stripeCustomerId]
  );
  return result.rows[0];
}

export async function getSubscriptionByUserId(userId) {
  const result = await pool.query(`select * from subscriptions where user_id = $1`, [userId]);
  return result.rows[0] || null;
}

export async function listTrialingUsers() {
  const result = await pool.query(
    `select
      u.id as user_id,
      u.email,
      u.name,
      u.role,
      u.beta_flag,
      s.plan,
      s.status,
      s.trial_ends_at
     from users u
     join subscriptions s on s.user_id = u.id
     where s.status = 'trialing' and s.trial_ends_at is not null`
  );
  return result.rows;
}

export async function listLeadsByUser(userId) {
  const result = await pool.query(
    `select * from leads where user_id = $1 order by score desc, updated_at desc`,
    [userId]
  );
  return result.rows.map(mapLead);
}

export async function listAllLeads() {
  const result = await pool.query(`select * from leads order by updated_at desc`);
  return result.rows.map(mapLead);
}

export async function getLeadByIdForUser(leadId, userId) {
  const result = await pool.query(
    `select * from leads where id = $1 and user_id = $2`,
    [leadId, userId]
  );
  return result.rows[0] ? mapLead(result.rows[0]) : null;
}

export async function getLeadById(leadId) {
  const result = await pool.query(`select * from leads where id = $1`, [leadId]);
  return result.rows[0] ? mapLead(result.rows[0]) : null;
}

export async function getLeadByEmailForUser(leadEmail, userId) {
  const result = await pool.query(
    `select * from leads where lower(email) = lower($1) and user_id = $2`,
    [leadEmail, userId]
  );
  return result.rows[0] ? mapLead(result.rows[0]) : null;
}

export async function createLead({
  userId,
  name,
  email,
  phone = null,
  source = null,
  notes = null,
  lastContactedAt = null,
  status = "new",
  score,
  bucket,
  signals,
  behaviorTrend,
  confidenceScore,
  pipelineProgress = {},
  closedAt = null,
  lastActivityAt = null
}) {
  const result = await pool.query(
    `insert into leads (
      user_id, name, email, phone, source, notes, last_contacted_at, status, score, bucket,
      response_time_minutes, message_intent, follow_through_rate, weekly_engagement_touches,
      behavior_trend, confidence_score, pipeline_progress, closed_at, last_activity_at
    )
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19)
    returning *`,
    [
      userId,
      name,
      email,
      phone,
      source,
      notes,
      lastContactedAt,
      status,
      score,
      bucket,
      signals.responseTimeMinutes,
      signals.messageIntent,
      signals.followThroughRate,
      signals.weeklyEngagementTouches,
      behaviorTrend,
      confidenceScore,
      JSON.stringify(pipelineProgress || {}),
      closedAt,
      lastActivityAt
    ]
  );
  return mapLead(result.rows[0]);
}

export async function updateLeadSnapshot(lead) {
  const result = await pool.query(
    `update leads
     set status = $2,
         source = $3,
         notes = $4,
         last_contacted_at = $5,
         score = $6,
         bucket = $7,
         response_time_minutes = $8,
         message_intent = $9,
         follow_through_rate = $10,
         weekly_engagement_touches = $11,
         behavior_trend = $12,
         confidence_score = $13,
         pipeline_progress = $14::jsonb,
         closed_at = $15,
         last_activity_at = $16,
         last_nurture_email_at = $17,
         last_suggested_follow_up_at = $18,
         updated_at = now()
     where id = $1
     returning *`,
    [
      lead.id,
      lead.stage,
      lead.source,
      lead.notes,
      lead.lastContactedAt,
      lead.score,
      lead.bucket,
      lead.signals.responseTimeMinutes,
      lead.signals.messageIntent,
      lead.signals.followThroughRate,
      lead.signals.weeklyEngagementTouches,
      lead.behaviorTrend,
      lead.confidenceScore,
      JSON.stringify(lead.pipelineProgress || {}),
      lead.closedAt,
      lead.lastActivityAt,
      lead.lastNurtureEmailAt,
      lead.lastSuggestedFollowUpAt
    ]
  );
  return result.rows[0] ? mapLead(result.rows[0]) : null;
}

export async function updateLeadForUser(leadId, userId, payload) {
  const result = await pool.query(
    `update leads
     set name = $3,
         email = $4,
         phone = $5,
         source = $6,
         notes = $7,
         last_contacted_at = $8,
         status = $9,
         score = $10,
         bucket = $11,
         response_time_minutes = $12,
         message_intent = $13,
         follow_through_rate = $14,
         weekly_engagement_touches = $15,
         behavior_trend = $16,
         confidence_score = $17,
         pipeline_progress = $18::jsonb,
         closed_at = $19,
         last_activity_at = $20,
         updated_at = now()
     where id = $1 and user_id = $2
     returning *`,
    [
      leadId,
      userId,
      payload.name,
      payload.email,
      payload.phone,
      payload.source,
      payload.notes,
      payload.lastContactedAt,
      payload.stage,
      payload.score,
      payload.bucket,
      payload.signals.responseTimeMinutes,
      payload.signals.messageIntent,
      payload.signals.followThroughRate,
      payload.signals.weeklyEngagementTouches,
      payload.behaviorTrend,
      payload.confidenceScore,
      JSON.stringify(payload.pipelineProgress || {}),
      payload.closedAt,
      payload.lastActivityAt
    ]
  );
  return result.rows[0] ? mapLead(result.rows[0]) : null;
}

export async function deleteLeadForUser(leadId, userId) {
  const result = await pool.query(`delete from leads where id = $1 and user_id = $2 returning id`, [leadId, userId]);
  return result.rows[0] || null;
}

export async function insertEvent({ userId, leadId = null, eventType, metadata = {} }) {
  const result = await pool.query(
    `insert into events (user_id, lead_id, event_type, metadata)
     values ($1, $2, $3, $4::jsonb)
     returning *`,
    [userId, leadId, eventType, JSON.stringify(metadata)]
  );
  return result.rows[0];
}

export async function hasUserEventForTrial(userId, eventType, trialEndsAtIso) {
  const result = await pool.query(
    `select exists(
      select 1
      from events
      where user_id = $1
        and event_type = $2
        and metadata->>'trialEndsAt' = $3
    ) as found`,
    [userId, eventType, trialEndsAtIso]
  );

  return Boolean(result.rows[0]?.found);
}

export async function getTemplateByKey(key) {
  const result = await pool.query(`select key, subject, body, created_at, updated_at from message_templates where key = $1`, [key]);
  return result.rows[0] || null;
}

export async function listTemplates() {
  const result = await pool.query(`select key, subject, body, created_at, updated_at from message_templates order by key asc`);
  return result.rows;
}

export async function upsertTemplate({ key, subject, body }) {
  const result = await pool.query(
    `insert into message_templates (key, subject, body)
     values ($1, $2, $3)
     on conflict (key)
     do update set
       subject = excluded.subject,
       body = excluded.body,
       updated_at = now()
     returning key, subject, body, created_at, updated_at`,
    [key, subject, body]
  );
  return result.rows[0];
}

export async function listEventsForLead(leadId, limit = 50) {
  const result = await pool.query(
    `select id, lead_id, user_id, event_type, metadata, created_at
     from events
     where lead_id = $1
     order by created_at asc
     limit $2`,
    [leadId, limit]
  );

  return result.rows.map((row) => ({
    id: row.id,
    leadId: row.lead_id,
    userId: row.user_id,
    type: row.event_type,
    value: row.metadata?.value ?? "",
    meta: row.metadata || {},
    createdAt: row.created_at
  }));
}

export async function listUserEventsByType(userId, eventType, limit = 100) {
  const result = await pool.query(
    `select id, user_id, lead_id, event_type, metadata, created_at
     from events
     where user_id = $1 and event_type = $2
     order by created_at desc
     limit $3`,
    [userId, eventType, limit]
  );

  return result.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    leadId: row.lead_id,
    eventType: row.event_type,
    metadata: row.metadata || {},
    createdAt: row.created_at
  }));
}

export async function getUsageByUser(userId) {
  const result = await pool.query(
    `select event_type, count(*)::int as count
     from events
     where user_id = $1
     group by event_type`,
    [userId]
  );

  const lookup = Object.fromEntries(result.rows.map((row) => [row.event_type, row.count]));

  return {
    scoredEvents: lookup.score_updated || 0,
    digestsSent: lookup.digest_sent || 0,
    reactivationsSent: lookup.reactivation_sent || 0,
    autoNurtureMoves: lookup.auto_nurture_moved || 0,
    nurtureEmailsSent: lookup.nurture_email_sent || 0,
    followUpSuggestionsGenerated: lookup.followup_suggested || 0,
    followUpEmailsSent: lookup.followup_sent || 0
  };
}

export async function getAdminMetrics() {
  const [users, activeUsers, leads, events, avgScore, leadsPerUser] = await Promise.all([
    pool.query(`select count(*)::int as total from users`),
    pool.query(`select count(*)::int as total from users where last_active_at >= now() - interval '7 day'`),
    pool.query(`select count(*)::int as total from leads`),
    pool.query(`select count(*)::int as total from events`),
    pool.query(`select coalesce(avg(score), 0)::numeric(10,2) as avg_score from leads`),
    pool.query(
      `select coalesce(avg(lead_count), 0)::numeric(10,2) as leads_per_user
       from (
         select u.id, count(l.id) as lead_count
         from users u
         left join leads l on l.user_id = u.id
         group by u.id
       ) t`
    )
  ]);

  return {
    totalUsers: users.rows[0].total,
    activeUsers7d: activeUsers.rows[0].total,
    totalLeads: leads.rows[0].total,
    totalEvents: events.rows[0].total,
    avgScore: Number(avgScore.rows[0].avg_score),
    leadsPerUser: Number(leadsPerUser.rows[0].leads_per_user)
  };
}

export async function createTrackingLink({ id, userId, leadId, destinationUrl, channel = "email" }) {
  const result = await pool.query(
    `insert into tracking_links (id, user_id, lead_id, destination_url, channel)
     values ($1, $2, $3, $4, $5)
     returning id, user_id, lead_id, destination_url, channel, click_count, last_clicked_at, created_at`,
    [id, userId, leadId, destinationUrl, channel]
  );
  return result.rows[0];
}

export async function listTrackingLinksByLeadForUser(leadId, userId) {
  const result = await pool.query(
    `select id, user_id, lead_id, destination_url, channel, click_count, last_clicked_at, created_at
     from tracking_links
     where user_id = $1 and lead_id = $2
     order by created_at desc`,
    [userId, leadId]
  );
  return result.rows;
}

export async function hasLeadEventType(leadId, eventType) {
  const result = await pool.query(
    `select exists(
      select 1
      from events
      where lead_id = $1 and event_type = $2
    ) as found`,
    [leadId, eventType]
  );
  return Boolean(result.rows[0]?.found);
}

export async function getTrackingLinkById(id) {
  const result = await pool.query(
    `select id, user_id, lead_id, destination_url, channel, click_count, last_clicked_at, created_at
     from tracking_links
     where id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

export async function bumpTrackingLinkClick(id) {
  const result = await pool.query(
    `update tracking_links
     set click_count = click_count + 1,
         last_clicked_at = now()
     where id = $1
     returning id, user_id, lead_id, destination_url, channel, click_count, last_clicked_at, created_at`,
    [id]
  );
  return result.rows[0] || null;
}

export async function createFeedback({ userId, page = "dashboard", message }) {
  const result = await pool.query(
    `insert into feedback (user_id, page, message)
     values ($1, $2, $3)
     returning id, user_id, page, message, created_at`,
    [userId, page, message]
  );
  return result.rows[0];
}
