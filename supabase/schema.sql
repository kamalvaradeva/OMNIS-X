-- ============================================================================
-- OMNIS-X — Intelligent Campus Recovery System
-- Step 1: Supabase Postgres Schema, Indexes, Triggers & Row Level Security
-- Target: Supabase SQL Editor (safe to re-run idempotently where supported)
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- Shared trigger function: keeps updated_at synchronized on every UPDATE
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- 1. sim_sessions (one row per browser session / device identity)
-- ============================================================================
create table if not exists public.sim_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  label text not null default 'JGIT Campus Session',
  app_version text not null default '1.0.0',
  last_seen timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sim_sessions_label_nonempty check (length(trim(label)) > 0)
);

drop trigger if exists trg_sim_sessions_updated_at on public.sim_sessions;
create trigger trg_sim_sessions_updated_at
  before update on public.sim_sessions
  for each row execute function public.set_updated_at();

create index if not exists idx_sim_sessions_user_last_seen
  on public.sim_sessions (user_id, last_seen desc);

-- ============================================================================
-- 2. failure_queue (durable Dynamic Failure Builder queue with soft deletes)
-- ============================================================================
create table if not exists public.failure_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  session_id uuid not null references public.sim_sessions(id) on delete cascade,
  client_id text not null,
  config jsonb not null,
  position int not null default 0,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint failure_queue_session_client_unique unique (session_id, client_id),
  constraint failure_queue_position_nonneg check (position >= 0),
  constraint failure_queue_config_obj check (jsonb_typeof(config) = 'object'),
  constraint failure_queue_config_size check (pg_column_size(config) <= 204800)
);

drop trigger if exists trg_failure_queue_updated_at on public.failure_queue;
create trigger trg_failure_queue_updated_at
  before update on public.failure_queue
  for each row execute function public.set_updated_at();

create index if not exists idx_failure_queue_session_created
  on public.failure_queue (session_id, created_at desc);

create index if not exists idx_failure_queue_active_pos
  on public.failure_queue (session_id, deleted, position asc);

-- ============================================================================
-- 3. simulation_runs (executed crisis scenarios & computed metrics)
-- ============================================================================
create table if not exists public.simulation_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  session_id uuid not null references public.sim_sessions(id) on delete cascade,
  client_run_id text not null unique,
  scenario_id text not null,
  failure_configs jsonb not null default '[]'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  impacted_count int not null default 0,
  campus_health_pct numeric(5,2) not null default 100.00,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint simulation_runs_scenario_nonempty check (length(trim(scenario_id)) > 0),
  constraint simulation_runs_configs_arr check (jsonb_typeof(failure_configs) = 'array'),
  constraint simulation_runs_configs_size check (pg_column_size(failure_configs) <= 204800),
  constraint simulation_runs_metrics_obj check (jsonb_typeof(metrics) = 'object'),
  constraint simulation_runs_metrics_size check (pg_column_size(metrics) <= 204800),
  constraint simulation_runs_impacted_nonneg check (impacted_count >= 0),
  constraint simulation_runs_health_range check (campus_health_pct between 0 and 100)
);

drop trigger if exists trg_simulation_runs_updated_at on public.simulation_runs;
create trigger trg_simulation_runs_updated_at
  before update on public.simulation_runs
  for each row execute function public.set_updated_at();

create index if not exists idx_simulation_runs_session_created
  on public.simulation_runs (session_id, created_at desc);

-- ============================================================================
-- 4. recovery_events (selected / applied / undone / reset audit trail)
-- ============================================================================
create table if not exists public.recovery_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  session_id uuid not null references public.sim_sessions(id) on delete cascade,
  run_id uuid references public.simulation_runs(id) on delete set null,
  client_event_id text unique,
  event_type text not null,
  plan_rank int,
  plan_name text,
  plan_stats jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recovery_events_type_check check (event_type in ('selected', 'applied', 'undone', 'reset')),
  constraint recovery_events_rank_pos check (plan_rank is null or plan_rank >= 1),
  constraint recovery_events_stats_obj check (jsonb_typeof(plan_stats) = 'object'),
  constraint recovery_events_stats_size check (pg_column_size(plan_stats) <= 204800)
);

drop trigger if exists trg_recovery_events_updated_at on public.recovery_events;
create trigger trg_recovery_events_updated_at
  before update on public.recovery_events
  for each row execute function public.set_updated_at();

create index if not exists idx_recovery_events_session_created
  on public.recovery_events (session_id, created_at desc);

create index if not exists idx_recovery_events_run_created
  on public.recovery_events (run_id, created_at desc);

-- ============================================================================
-- 5. readiness_audits (N-1 / N-2 Zero-Failure Readiness Audit snapshots)
-- ============================================================================
create table if not exists public.readiness_audits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  session_id uuid not null references public.sim_sessions(id) on delete cascade,
  client_audit_id text unique,
  mode text not null,
  score numeric(5,2) not null,
  certified_count int not null,
  total_count int not null,
  results jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint readiness_audits_mode_check check (mode in ('N-1', 'N-2')),
  constraint readiness_audits_score_range check (score between 0 and 100),
  constraint readiness_audits_counts_valid check (certified_count >= 0 and total_count >= 0 and certified_count <= total_count),
  constraint readiness_audits_results_size check (pg_column_size(results) <= 204800)
);

drop trigger if exists trg_readiness_audits_updated_at on public.readiness_audits;
create trigger trg_readiness_audits_updated_at
  before update on public.readiness_audits
  for each row execute function public.set_updated_at();

create index if not exists idx_readiness_audits_session_created
  on public.readiness_audits (session_id, created_at desc);

-- ============================================================================
-- 6. notifications (stakeholder notices generated for recovery plans)
-- ============================================================================
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  session_id uuid not null references public.sim_sessions(id) on delete cascade,
  run_id uuid references public.simulation_runs(id) on delete set null,
  client_notice_id text unique,
  audience text not null,
  message text not null,
  sent boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notifications_audience_nonempty check (length(trim(audience)) > 0),
  constraint notifications_message_nonempty check (length(trim(message)) > 0)
);

drop trigger if exists trg_notifications_updated_at on public.notifications;
create trigger trg_notifications_updated_at
  before update on public.notifications
  for each row execute function public.set_updated_at();

create index if not exists idx_notifications_session_created
  on public.notifications (session_id, created_at desc);

-- ============================================================================
-- 7. app_log (sync conflict, dead-letter, & client telemetry log)
-- ============================================================================
create table if not exists public.app_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  session_id uuid references public.sim_sessions(id) on delete set null,
  client_log_id text unique,
  level text not null default 'info',
  message text not null,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_log_level_check check (level in ('debug', 'info', 'warn', 'error')),
  constraint app_log_message_nonempty check (length(trim(message)) > 0),
  constraint app_log_context_size check (pg_column_size(context) <= 204800)
);

drop trigger if exists trg_app_log_updated_at on public.app_log;
create trigger trg_app_log_updated_at
  before update on public.app_log
  for each row execute function public.set_updated_at();

create index if not exists idx_app_log_session_created
  on public.app_log (session_id, created_at desc);

-- ============================================================================
-- ROW LEVEL SECURITY (Strict user_id = auth.uid() across all user tables)
-- ============================================================================
alter table public.sim_sessions enable row level security;
alter table public.failure_queue enable row level security;
alter table public.simulation_runs enable row level security;
alter table public.recovery_events enable row level security;
alter table public.readiness_audits enable row level security;
alter table public.notifications enable row level security;
alter table public.app_log enable row level security;

-- Helper block to recreate clean per-operation policies safely on re-runs
do $$
declare
  tbl text;
  tables text[] := array[
    'sim_sessions',
    'failure_queue',
    'simulation_runs',
    'recovery_events',
    'readiness_audits',
    'notifications',
    'app_log'
  ];
begin
  foreach tbl in array tables loop
    execute format('drop policy if exists %I on public.%I', tbl || '_select_own', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_insert_own', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_update_own', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_delete_own', tbl);

    execute format(
      'create policy %I on public.%I for select to authenticated using (user_id = auth.uid())',
      tbl || '_select_own', tbl
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (user_id = auth.uid())',
      tbl || '_insert_own', tbl
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',
      tbl || '_update_own', tbl
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (user_id = auth.uid())',
      tbl || '_delete_own', tbl
    );
  end loop;
end $$;

-- ============================================================================
-- OPTIONAL INSTITUTIONAL REFERENCE TABLES (Read-Only for Authenticated Users)
-- Populated by supabase/seed.sql from data.js
-- ============================================================================
create table if not exists public.ref_faculty (
  id text primary key,
  name text not null,
  department text not null,
  designation text not null,
  qualifications jsonb not null default '[]'::jsonb,
  max_weekly_load int not null check (max_weekly_load > 0),
  bus_id text,
  is_hostel_warden text,
  created_at timestamptz not null default now()
);

create table if not exists public.ref_classrooms (
  id text primary key,
  name text not null,
  block text not null,
  department text not null,
  capacity int not null check (capacity > 0),
  room_type text not null,
  has_projector boolean not null default true,
  power_zone text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.ref_labs (
  id text primary key,
  name text not null,
  department text not null,
  lab_type text not null,
  capacity int not null check (capacity > 0),
  block text not null,
  power_zone text not null,
  requires_network boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.ref_buses (
  id text primary key,
  name text not null,
  route text not null,
  capacity int not null check (capacity > 0),
  student_load int not null default 0 check (student_load >= 0),
  linked_sections jsonb not null default '[]'::jsonb,
  linked_faculty jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ref_hostels (
  id text primary key,
  name text not null,
  capacity int not null check (capacity > 0),
  occupancy int not null default 0 check (occupancy >= 0),
  power_zone text not null,
  warden_id text,
  warden_name text,
  linked_sections jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.ref_faculty enable row level security;
alter table public.ref_classrooms enable row level security;
alter table public.ref_labs enable row level security;
alter table public.ref_buses enable row level security;
alter table public.ref_hostels enable row level security;

do $$
declare
  rtbl text;
  rtables text[] := array['ref_faculty', 'ref_classrooms', 'ref_labs', 'ref_buses', 'ref_hostels'];
begin
  foreach rtbl in array rtables loop
    execute format('drop policy if exists %I on public.%I', rtbl || '_read_auth', rtbl);
    execute format(
      'create policy %I on public.%I for select to authenticated using (auth.uid() is not null)',
      rtbl || '_read_auth', rtbl
    );
  end loop;
end $$;
