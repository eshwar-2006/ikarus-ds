-- IKARUS 2026 competition engine: additive migration
-- Apply only after backing up the database and confirming this is the intended Supabase project.
-- Uses existing public.profiles and public.quiz_drafts created by quiz-engine-migration.sql.

alter table public.quiz_drafts
  add column if not exists opens_at timestamptz,
  add column if not exists closes_at timestamptz;

alter table public.quiz_attempts alter column submitted_at drop not null;

alter table public.quiz_attempts
  add column if not exists started_at timestamptz,
  add column if not exists deadline_at timestamptz,
  add column if not exists status text not null default 'submitted',
  add column if not exists reviewed_score numeric(8,2),
  add column if not exists reviewer_notes text,
  add column if not exists reviewed_by uuid references auth.users(id),
  add column if not exists reviewed_at timestamptz,
  add column if not exists approved_by uuid references auth.users(id),
  add column if not exists approved_at timestamptz,
  add column if not exists published_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='quiz_attempts_status_check') then
    alter table public.quiz_attempts add constraint quiz_attempts_status_check
      check (status in ('in_progress','submitted','reviewed','approved','published'));
  end if;
end $$;

alter table public.quiz_attempts
  drop constraint if exists quiz_attempts_reviewed_score_check;
alter table public.quiz_attempts
  add constraint quiz_attempts_reviewed_score_check
  check (reviewed_score is null or (reviewed_score >= 0 and reviewed_score <= max_score));

create index if not exists quiz_attempts_quiz_status_idx
  on public.quiz_attempts(quiz_id,status,submitted_at desc);
create index if not exists quiz_attempts_user_status_idx
  on public.quiz_attempts(user_id,status,started_at desc);

create table if not exists public.ikarus_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  competition_code text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.ikarus_audit_events enable row level security;
revoke all on public.ikarus_audit_events from anon, authenticated;
grant select, insert on public.ikarus_audit_events to service_role;

create or replace function public.ikarus_is_organizer_for(p_competition text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.role = 'president' or (p.role = 'officer' and p.competition_code = p_competition))
  );
$$;
revoke all on function public.ikarus_is_organizer_for(text) from public, anon;
grant execute on function public.ikarus_is_organizer_for(text) to authenticated;


-- Lock down profile visibility and team roster writes. Remove prior policies on these
-- two tables so an older permissive policy cannot silently override the intended access.
do $$ declare pol record; begin
  for pol in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname='public' and tablename in ('profiles','teams')
  loop
    execute format('drop policy if exists %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  end loop;
end $$;

alter table public.profiles enable row level security;
drop policy if exists "IKARUS profiles self read" on public.profiles;
create policy "IKARUS profiles self read" on public.profiles
  for select to authenticated using (id = (select auth.uid()));

alter table public.teams enable row level security;
drop policy if exists "IKARUS teams organizer read" on public.teams;
drop policy if exists "IKARUS teams president insert" on public.teams;
drop policy if exists "IKARUS teams president update" on public.teams;
drop policy if exists "IKARUS teams president delete" on public.teams;
create policy "IKARUS teams organizer read" on public.teams
  for select to authenticated using (
    exists (
      select 1 from public.profiles p
      where p.id=(select auth.uid())
        and (p.role='president' or (p.role='officer' and p.competition_code=teams.competition_code))
    )
  );
create policy "IKARUS teams president insert" on public.teams
  for insert to authenticated with check (
    exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='president')
  );
create policy "IKARUS teams president update" on public.teams
  for update to authenticated using (
    exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='president')
  ) with check (
    exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='president')
  );
create policy "IKARUS teams president delete" on public.teams
  for delete to authenticated using (
    exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='president')
  );

-- Prevent duplicate registration IDs within a competition. If this index fails,
-- reconcile pre-existing duplicate rows before continuing with live imports.
create unique index if not exists teams_competition_registration_unique
  on public.teams (competition_code, lower(trim(registration_number)));

notify pgrst, 'reload schema';
