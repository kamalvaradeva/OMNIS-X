-- ============================================================================
-- OMNIS-X — Student Login, Role-Based Access Control & Recovery Communication
-- Migration 002 (Non-Destructive, Idempotent)
-- Target: Run in Supabase SQL Editor AFTER schema.sql / 001_initial_schema.sql
-- ============================================================================

-- ============================================================================
-- 1. public.user_roles (Server-Authoritative Role Mapping; Read-Only to Clients)
-- ============================================================================
create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'student')),
  student_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_roles_student_id_check check (
    (role = 'student' and student_id is not null and length(trim(student_id)) > 0)
    or (role = 'admin')
  )
);

drop trigger if exists trg_user_roles_updated_at on public.user_roles;
create trigger trg_user_roles_updated_at
  before update on public.user_roles
  for each row execute function public.set_updated_at();

alter table public.user_roles enable row level security;

drop policy if exists user_roles_select_own on public.user_roles;
create policy user_roles_select_own
  on public.user_roles
  for select
  to authenticated
  using (user_id = auth.uid());

-- Never allow authenticated clients to insert/update/delete role assignments
revoke all on public.user_roles from anon;
revoke insert, update, delete on public.user_roles from authenticated;
grant select on public.user_roles to authenticated;

-- ============================================================================
-- 2. public.student_profiles (Maps Student ID -> Section, Dept, Sem, Bus, Hostel)
--    Notice: Does NOT store or expose internal authentication emails.
-- ============================================================================
create table if not exists public.student_profiles (
  student_id text primary key,
  user_id uuid unique references auth.users(id) on delete set null,
  full_name text not null,
  department text not null,
  semester int not null check (semester between 1 and 8),
  section_id text not null,
  bus_id text,
  hostel_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint student_profiles_id_nonempty check (length(trim(student_id)) > 0),
  constraint student_profiles_section_nonempty check (length(trim(section_id)) > 0)
);

drop trigger if exists trg_student_profiles_updated_at on public.student_profiles;
create trigger trg_student_profiles_updated_at
  before update on public.student_profiles
  for each row execute function public.set_updated_at();

create index if not exists idx_student_profiles_user_id
  on public.student_profiles (user_id);

create index if not exists idx_student_profiles_section_id
  on public.student_profiles (section_id);

-- ============================================================================
-- 3. SECURITY DEFINER Role Helper Functions (Safe, Non-Recursive RLS Helpers)
-- ============================================================================
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = auth.uid()
      and role = 'admin'
  );
$$;

create or replace function public.current_user_student_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select ur.student_id
  from public.user_roles ur
  where ur.user_id = auth.uid()
    and ur.role = 'student'
  limit 1;
$$;

create or replace function public.current_user_section_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select sp.section_id
  from public.student_profiles sp
  where sp.user_id = auth.uid()
     or sp.student_id = public.current_user_student_id()
  limit 1;
$$;

revoke all on function public.is_admin() from public;
revoke all on function public.current_user_student_id() from public;
revoke all on function public.current_user_section_id() from public;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.current_user_student_id() to authenticated;
grant execute on function public.current_user_section_id() to authenticated;

-- ============================================================================
-- 4. RLS Policies for student_profiles (Self-Read for Students; Full for Admins)
-- ============================================================================
alter table public.student_profiles enable row level security;

drop policy if exists student_profiles_select_authorized on public.student_profiles;
create policy student_profiles_select_authorized
  on public.student_profiles
  for select
  to authenticated
  using (
    public.is_admin()
    or user_id = auth.uid()
    or student_id = public.current_user_student_id()
  );

drop policy if exists student_profiles_admin_insert on public.student_profiles;
create policy student_profiles_admin_insert
  on public.student_profiles
  for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists student_profiles_admin_update on public.student_profiles;
create policy student_profiles_admin_update
  on public.student_profiles
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists student_profiles_admin_delete on public.student_profiles;
create policy student_profiles_admin_delete
  on public.student_profiles
  for delete
  to authenticated
  using (public.is_admin());

grant select, insert, update, delete on public.student_profiles to authenticated;
revoke all on public.student_profiles from anon;

-- ============================================================================
-- 5. Tighten Existing Admin Tables so Students CANNOT Read or Write Them
-- ============================================================================
do $$
declare
  tbl text;
  admin_tables text[] := array[
    'sim_sessions',
    'failure_queue',
    'simulation_runs',
    'recovery_events',
    'readiness_audits',
    'notifications',
    'app_log'
  ];
begin
  foreach tbl in array admin_tables loop
    execute format('drop policy if exists %I on public.%I', tbl || '_select_own', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_insert_own', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_update_own', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_delete_own', tbl);

    execute format(
      'create policy %I on public.%I for select to authenticated using (user_id = auth.uid() and public.is_admin())',
      tbl || '_select_own', tbl
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (user_id = auth.uid() and public.is_admin())',
      tbl || '_insert_own', tbl
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (user_id = auth.uid() and public.is_admin()) with check (user_id = auth.uid() and public.is_admin())',
      tbl || '_update_own', tbl
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (user_id = auth.uid() and public.is_admin())',
      tbl || '_delete_own', tbl
    );
  end loop;
end $$;

do $$
declare
  rtbl text;
  rtables text[] := array['ref_faculty', 'ref_classrooms', 'ref_labs', 'ref_buses', 'ref_hostels'];
begin
  foreach rtbl in array rtables loop
    execute format('drop policy if exists %I on public.%I', rtbl || '_read_auth', rtbl);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_admin())',
      rtbl || '_read_auth', rtbl
    );
  end loop;
end $$;

-- ============================================================================
-- 6. public.student_schedule_updates (Published Applied Recovery Changes)
-- ============================================================================
create table if not exists public.student_schedule_updates (
  id uuid primary key default gen_random_uuid(),
  published_by uuid not null default auth.uid(),
  session_id uuid not null references public.sim_sessions(id) on delete cascade,
  run_id uuid references public.simulation_runs(id) on delete set null,
  client_update_id text not null unique,
  batch_id text not null,
  section_id text not null,
  activity_id text not null,
  activity_kind text not null default 'timetable',
  subject_name text not null,
  subject_code text,
  change_status text not null,
  previous_details jsonb not null default '{}'::jsonb,
  updated_details jsonb not null default '{}'::jsonb,
  reason text not null,
  plan_rank int,
  plan_name text,
  resolved boolean not null default true,
  active boolean not null default true,
  reverted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ssu_status_check check (
    change_status in (
      'UNCHANGED',
      'RESCHEDULED',
      'FACULTY_CHANGED',
      'CLASSROOM_CHANGED',
      'LAB_CHANGED',
      'CANCELLED',
      'TRANSPORT_CHANGED',
      'REVERTED'
    )
  ),
  constraint ssu_prev_obj check (jsonb_typeof(previous_details) = 'object'),
  constraint ssu_upd_obj check (jsonb_typeof(updated_details) = 'object')
);

drop trigger if exists trg_ssu_updated_at on public.student_schedule_updates;
create trigger trg_ssu_updated_at
  before update on public.student_schedule_updates
  for each row execute function public.set_updated_at();

create index if not exists idx_ssu_section_active
  on public.student_schedule_updates (section_id, active, created_at desc);

create index if not exists idx_ssu_batch_id
  on public.student_schedule_updates (batch_id);

alter table public.student_schedule_updates enable row level security;

drop policy if exists ssu_select_authorized on public.student_schedule_updates;
create policy ssu_select_authorized
  on public.student_schedule_updates
  for select
  to authenticated
  using (
    public.is_admin()
    or section_id = public.current_user_section_id()
  );

drop policy if exists ssu_admin_insert on public.student_schedule_updates;
create policy ssu_admin_insert
  on public.student_schedule_updates
  for insert
  to authenticated
  with check (public.is_admin() and published_by = auth.uid());

drop policy if exists ssu_admin_update on public.student_schedule_updates;
create policy ssu_admin_update
  on public.student_schedule_updates
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists ssu_admin_delete on public.student_schedule_updates;
create policy ssu_admin_delete
  on public.student_schedule_updates
  for delete
  to authenticated
  using (public.is_admin());

grant select, insert, update, delete on public.student_schedule_updates to authenticated;
revoke all on public.student_schedule_updates from anon;

-- ============================================================================
-- 7. public.student_notifications (Targeted Recovery Communication Feed)
-- ============================================================================
create table if not exists public.student_notifications (
  id uuid primary key default gen_random_uuid(),
  published_by uuid not null default auth.uid(),
  session_id uuid not null references public.sim_sessions(id) on delete cascade,
  run_id uuid references public.simulation_runs(id) on delete set null,
  client_notif_id text not null unique,
  batch_id text not null,
  section_id text not null,
  activity_id text,
  change_status text not null,
  title text not null,
  description text not null,
  previous_summary text,
  updated_summary text,
  affected_date_time text,
  reason text not null,
  active boolean not null default true,
  reverted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sn_status_check check (
    change_status in (
      'RESCHEDULED',
      'FACULTY_CHANGED',
      'CLASSROOM_CHANGED',
      'LAB_CHANGED',
      'CANCELLED',
      'TRANSPORT_CHANGED',
      'INCOMPLETE_RECOVERY',
      'REVERTED'
    )
  )
);

drop trigger if exists trg_sn_updated_at on public.student_notifications;
create trigger trg_sn_updated_at
  before update on public.student_notifications
  for each row execute function public.set_updated_at();

create index if not exists idx_sn_section_created
  on public.student_notifications (section_id, created_at desc);

alter table public.student_notifications enable row level security;

drop policy if exists sn_select_authorized on public.student_notifications;
create policy sn_select_authorized
  on public.student_notifications
  for select
  to authenticated
  using (
    public.is_admin()
    or section_id = public.current_user_section_id()
  );

drop policy if exists sn_admin_insert on public.student_notifications;
create policy sn_admin_insert
  on public.student_notifications
  for insert
  to authenticated
  with check (public.is_admin() and published_by = auth.uid());

drop policy if exists sn_admin_update on public.student_notifications;
create policy sn_admin_update
  on public.student_notifications
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists sn_admin_delete on public.student_notifications;
create policy sn_admin_delete
  on public.student_notifications
  for delete
  to authenticated
  using (public.is_admin());

grant select, insert, update, delete on public.student_notifications to authenticated;
revoke all on public.student_notifications from anon;

-- ============================================================================
-- 8. Enable Supabase Realtime Publication on Student Tables (Idempotent)
-- ============================================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'student_schedule_updates'
    ) then
      alter publication supabase_realtime add table public.student_schedule_updates;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'student_notifications'
    ) then
      alter publication supabase_realtime add table public.student_notifications;
    end if;
  end if;
end $$;

-- ============================================================================
-- 9. Seed Institutional Student Profile Mapping & Link Existing Auth Users
--    (Maps STU001 to actual CSE Section D / SEC-CSE-4 in data.js;
--     and STU002 to ME Section B / SEC-ME-2 for isolation verification)
-- ============================================================================
insert into public.student_profiles (student_id, full_name, department, semester, section_id, bus_id, hostel_id)
values
  ('STU001', 'Aarav Sharma', 'CSE', 7, 'SEC-CSE-4', 'BUS-04', 'HST-04'),
  ('STU002', 'Diya Kulkarni', 'ME', 5, 'SEC-ME-2', 'BUS-02', 'HST-02')
on conflict (student_id) do update set
  full_name = excluded.full_name,
  department = excluded.department,
  semester = excluded.semester,
  section_id = excluded.section_id,
  bus_id = excluded.bus_id,
  hostel_id = excluded.hostel_id;

-- Auto-bind auth users by email if already created in Supabase Auth
insert into public.user_roles (user_id, role, student_id)
select u.id, 'admin', null
from auth.users u
where lower(u.email) = 'admin@omnisx.com'
on conflict (user_id) do update set
  role = 'admin',
  student_id = null;

insert into public.user_roles (user_id, role, student_id)
select u.id, 'student', 'STU001'
from auth.users u
where lower(u.email) = 'stu001@students.omnisx.com'
on conflict (user_id) do update set
  role = 'student',
  student_id = 'STU001';

insert into public.user_roles (user_id, role, student_id)
select u.id, 'student', 'STU002'
from auth.users u
where lower(u.email) = 'stu002@students.omnisx.com'
on conflict (user_id) do update set
  role = 'student',
  student_id = 'STU002';

update public.student_profiles sp
set user_id = u.id
from auth.users u
where (sp.student_id = 'STU001' and lower(u.email) = 'stu001@students.omnisx.com')
   or (sp.student_id = 'STU002' and lower(u.email) = 'stu002@students.omnisx.com');
