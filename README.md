# RealScoreAI (Supabase/Postgres)

This project now uses PostgreSQL persistence (Supabase-compatible) for production-ready beta tracking.

## Stack

- Frontend: Vanilla HTML/CSS/JS
- Backend: Node.js + Express
- Database: Postgres (Supabase)
- Email: SMTP (`nodemailer`) with mock fallback in local dev only
- Payments: Stripe scaffolding

## Database status

Implemented persistent schema (4 core tables):

- `users`
- `leads`
- `events`
- `subscriptions`

Schema files:

- `/Users/dasiamitchell/StudioProjects/d308-mobile-application-development-android/lead-prioritization-engine/src/db/schema.sql`
- `/Users/dasiamitchell/StudioProjects/d308-mobile-application-development-android/lead-prioritization-engine/supabase/schema.sql`

## Supabase quick-start

1. Create a Supabase project.
2. Open SQL Editor and run `supabase/schema.sql`.
3. In project settings, copy the Postgres connection string.
4. Set env vars:

```bash
export DATABASE_URL='postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres'
export PGSSL=true
export ADMIN_KEY='change-this-admin-key'
export WEBHOOK_KEY='change-this-webhook-key'
export STRIPE_SECRET_KEY='sk_live_or_test_key'
export SMTP_HOST='smtp.sendgrid.net'
export SMTP_PORT=587
export SMTP_SECURE=false
export SMTP_USER='apikey'
export SMTP_PASS='<sendgrid_api_key>'
export SMTP_FROM='noreply@yourdomain.com'
# optional unless directly calling Supabase APIs from frontend/backend:
export SUPABASE_URL='https://<project-ref>.supabase.co'
export SUPABASE_ANON_KEY='<anon-key>'
```

## Run

```bash
cd /Users/dasiamitchell/StudioProjects/realscoreai
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000)

## Render deploy (recommended)

1. Push this folder to GitHub.
2. In Render, create a Web Service from that repo.
3. Build command: `npm install`
4. Start command: `npm start`
5. Set env vars from `.env.example`.
6. Set `APP_URL` to your Render URL.
7. Run `/api/health` to verify service is live.

You can also use `render.yaml` in this repo for Blueprint setup.

## Trial and data continuity

- Trial length is now 30 days.
- When a beta user converts to paid, data is retained because all user, lead, and event records remain tied to the same `users.id`.
- No beta reset is required.

## Metrics endpoint

- `GET /api/admin/metrics` (requires `x-admin-key`)

- `POST /api/admin/automation/beta-ending-reminders` (requires `x-admin-key`)

Returns:

- `totalUsers`
- `activeUsers7d`
- `totalLeads`
- `totalEvents`
- `avgScore`
- `leadsPerUser`

## Event logging coverage

Examples inserted into `events` table:

- `login`
- `logout`
- `dashboard_viewed`
- `score_updated`
- `followup_suggested`
- `followup_sent`
- `digest_sent`
- `auto_nurture_moved`
- `nurture_email_sent`
- `webhook_received`
- `subscription_started`
- `subscription_canceled`
- `beta_reminder_7d`
- `beta_reminder_1d`

## Real-time activity

- SSE stream: `GET /api/stream?token=...`
- Webhook ingest: `POST /api/webhooks/lead-activity` with `x-webhook-key`

This means lead events can be ingested from external channels and reflected live in the dashboard.

## Phase 1 external listing tracking

- Create tracked link: `POST /api/leads/:leadId/tracking-links`
- List tracked links: `GET /api/leads/:leadId/tracking-links`
- Public redirect tracker: `GET /r/:trackingId`

On click, the app logs `listing_clicked` into `events` and increments click count.

## Production hardening

- In production (`NODE_ENV=production`), startup fails if required env vars are missing.
- Stripe and SMTP mock fallbacks are disabled in production.

## SMTP verification endpoints (admin key required)

- `GET /api/admin/email/status`
- `POST /api/admin/email/test` with JSON body `{ "to": "you@example.com" }`


## New beta ops additions

- Lead CRUD in dashboard (create, edit, delete)
- Admin template editor (DB-backed `message_templates`)
- Admin one-click beta reminder runner (`/api/admin/automation/beta-ending-reminders`)
