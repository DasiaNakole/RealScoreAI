create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  name text not null,
  role text not null default 'beta' check (role in ('admin', 'beta', 'broker', 'agent')),
  beta_flag boolean not null default true,
  auto_send_followups boolean not null default true,
  market text,
  monthly_lead_volume integer,
  goal text,
  created_at timestamptz not null default now(),
  last_active_at timestamptz
);

alter table users add column if not exists auto_send_followups boolean not null default true;

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  email text not null,
  phone text,
  source text,
  notes text,
  last_contacted_at timestamptz,
  score integer not null default 0,
  bucket text not null default 'at_risk',
  status text not null default 'new',
  response_time_minutes integer not null default 60,
  message_intent text not null default 'unknown',
  follow_through_rate numeric(5,4) not null default 0,
  weekly_engagement_touches integer not null default 0,
  behavior_trend text not null default 'stable',
  confidence_score numeric(5,2) not null default 50,
  pipeline_progress jsonb not null default '{}'::jsonb,
  closed_at timestamptz,
  last_activity_at timestamptz,
  last_nurture_email_at timestamptz,
  last_suggested_follow_up_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table leads add column if not exists pipeline_progress jsonb not null default '{}'::jsonb;
alter table leads add column if not exists closed_at timestamptz;
alter table leads add column if not exists source text;
alter table leads add column if not exists notes text;
alter table leads add column if not exists last_contacted_at timestamptz;

create index if not exists idx_leads_user_id on leads(user_id);
create index if not exists idx_leads_score on leads(score desc);

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  lead_id uuid references leads(id) on delete set null,
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_events_user_id on events(user_id);
create index if not exists idx_events_lead_id on events(lead_id);
create index if not exists idx_events_event_type on events(event_type);
create index if not exists idx_events_created_at on events(created_at desc);

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references users(id) on delete cascade,
  stripe_customer_id text,
  plan text not null,
  status text not null,
  payment_method_last4 text,
  cardholder_name text,
  trial_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_subscriptions_user_id on subscriptions(user_id);

create table if not exists message_templates (
  key text primary key,
  subject text not null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tracking_links (
  id text primary key,
  user_id uuid not null references users(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  destination_url text not null,
  channel text not null default 'email',
  click_count integer not null default 0,
  last_clicked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_tracking_links_user_id on tracking_links(user_id);
create index if not exists idx_tracking_links_lead_id on tracking_links(lead_id);

create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  page text not null default 'dashboard',
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_feedback_user_id on feedback(user_id);
create index if not exists idx_feedback_created_at on feedback(created_at desc);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_leads_updated_at on leads;
create trigger trg_leads_updated_at
before update on leads
for each row execute function set_updated_at();

drop trigger if exists trg_subscriptions_updated_at on subscriptions;
create trigger trg_subscriptions_updated_at
before update on subscriptions
for each row execute function set_updated_at();

drop trigger if exists trg_message_templates_updated_at on message_templates;
create trigger trg_message_templates_updated_at
before update on message_templates
for each row execute function set_updated_at();
