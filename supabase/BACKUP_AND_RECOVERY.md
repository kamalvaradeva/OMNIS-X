# OMNIS-X Backup, Point-in-Time Recovery & Schema Migrations

## 1. Schema Versioning (`supabase/migrations/`)
All schema changes are versioned sequentially in `supabase/migrations/`:
- `001_initial_schema.sql` — Initial 7 user-scoped operational tables (`sim_sessions`, `failure_queue`, `simulation_runs`, `recovery_events`, `readiness_audits`, `notifications`, `app_log`), `updated_at` triggers, indexes, strict `user_id = auth.uid()` RLS policies, and 5 read-only campus reference tables (`ref_faculty`, `ref_classrooms`, `ref_labs`, `ref_buses`, `ref_hostels`).

When evolving the database:
1. Create the next numbered SQL script (`002_<description>.sql`).
2. Keep every migration idempotent (`create table if not exists`, `add column if not exists`, `drop policy if exists`).
3. Apply in Supabase Dashboard **SQL Editor** or via Supabase CLI (`supabase db push`).

## 2. Automated Daily Backups & Point-in-Time Recovery (PITR)
- **Supabase Daily Backups:** Enabled automatically on paid Pro plans under **Database -> Backups -> Scheduled Backups**.
- **Point-in-Time Recovery (PITR):** Enable the **PITR add-on** under **Database -> Backups -> Point in Time** to allow second-level recovery before accidental deletions or corrupted deployments.

## 3. Manual `pg_dump` Backup
Run from a secure admin terminal (never from the browser):
```bash
# Binary custom-format dump of public schema (recommended for pg_restore)
pg_dump "$SUPABASE_DB_URL" --schema=public --format=custom --no-owner --no-acl -f "omnisx_public_$(date +%Y%m%d).dump"

# Plain SQL backup
pg_dump "$SUPABASE_DB_URL" --schema=public --no-owner --no-acl -f "omnisx_public_$(date +%Y%m%d).sql"
```

## 4. Client-Side User Backup
Users can click **Export my data (JSON)** inside **Institutional Data** to download a complete snapshot containing local cache, pending outbox, dead-letter records, and all user-scoped Supabase table rows.
