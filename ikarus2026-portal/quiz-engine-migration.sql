-- IKARUS 2026 quiz engine migration (run in the Supabase SQL Editor for the SAME project
-- configured in supabase-config.js). Back up production data and review policies first.
create extension if not exists pgcrypto;

create table if not exists public.quiz_drafts (
  id uuid primary key default gen_random_uuid(),
  competition_code text not null check (competition_code in ('TECHLIFT','DATAQUEST','AI_NEXUS')),
  title text not null check (length(trim(title)) between 1 and 160),
  stage_name text not null check (length(trim(stage_name)) between 1 and 100),
  source_path text not null,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  duration_minutes integer not null default 20 check (duration_minutes between 1 and 240),
  quiz_payload jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  constraint quiz_drafts_source_path_allowed check (source_path ~ '^uploads/(TECHLIFT|DATAQUEST|AI_NEXUS)/[^/]+[.]pdf$')
);
create index if not exists quiz_drafts_competition_status_idx on public.quiz_drafts (competition_code,status,created_at desc);
create index if not exists quiz_drafts_created_by_idx on public.quiz_drafts (created_by,created_at desc);
alter table public.quiz_drafts enable row level security;

-- Only authenticated organizers can read/edit the answer-key-containing draft table.
drop policy if exists "IKARUS quiz drafts organizer read" on public.quiz_drafts;
drop policy if exists "IKARUS quiz drafts organizer insert" on public.quiz_drafts;
drop policy if exists "IKARUS quiz drafts organizer update" on public.quiz_drafts;
create policy "IKARUS quiz drafts organizer read" on public.quiz_drafts for select to authenticated
using (exists (select 1 from public.profiles p where p.id=(select auth.uid()) and (p.role='president' or (p.role='officer' and p.competition_code=quiz_drafts.competition_code))));
create policy "IKARUS quiz drafts organizer insert" on public.quiz_drafts for insert to authenticated
with check (status='draft' and created_by=(select auth.uid()) and exists (select 1 from public.profiles p where p.id=(select auth.uid()) and (p.role='president' or (p.role='officer' and p.competition_code=quiz_drafts.competition_code))));
create policy "IKARUS quiz drafts organizer update" on public.quiz_drafts for update to authenticated
using (status='draft' and exists (select 1 from public.profiles p where p.id=(select auth.uid()) and (p.role='president' or (p.role='officer' and p.competition_code=quiz_drafts.competition_code))))
with check (created_by=(select auth.uid()) and exists (select 1 from public.profiles p where p.id=(select auth.uid()) and (p.role='president' or (p.role='officer' and p.competition_code=quiz_drafts.competition_code))));
grant select,insert,update on public.quiz_drafts to authenticated;

-- Submissions are service-role-only. Do not grant authenticated users direct table access.
create table if not exists public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quiz_drafts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,
  score numeric(8,2) not null default 0,
  max_score numeric(8,2) not null default 0,
  manual_review_required boolean not null default false,
  submitted_at timestamptz not null default now(),
  unique (quiz_id,user_id)
);
alter table public.quiz_attempts enable row level security;
revoke all on public.quiz_attempts from anon, authenticated;

-- Keep the original source PDFs private. Policies are scoped to competition folders.
drop policy if exists "IKARUS private materials organizer read" on storage.objects;
drop policy if exists "IKARUS private materials organizer upload" on storage.objects;
create policy "IKARUS private materials organizer read" on storage.objects for select to authenticated
using (bucket_id='competition-materials' and exists (select 1 from public.profiles p where p.id=(select auth.uid()) and (p.role='president' or (p.role='officer' and p.competition_code=(storage.foldername(name))[2]))));
create policy "IKARUS private materials organizer upload" on storage.objects for insert to authenticated
with check (bucket_id='competition-materials' and exists (select 1 from public.profiles p where p.id=(select auth.uid()) and (p.role='president' or (p.role='officer' and p.competition_code=(storage.foldername(name))[2]))));

-- Tell PostgREST to refresh its table/function metadata cache.
notify pgrst, 'reload schema';
