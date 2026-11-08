-- Apply before quiz-engine-migration.sql on a new project. No public sign-up
-- trigger: only an administrator may assign roles to existing Auth accounts.
create extension if not exists pgcrypto;
create table if not exists public.competitions (
  code text primary key check (code in ('TECHLIFT','DATAQUEST','AI_NEXUS')),
  name text not null,
  year_group integer,
  event_date date
);
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('president','officer','team','team_member','participant')),
  competition_code text references public.competitions(code),
  check (role = 'president' or competition_code is not null)
);
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  competition_code text not null references public.competitions(code),
  team_name text not null check (length(trim(team_name)) > 0),
  registration_number text not null check (length(trim(registration_number)) > 0),
  members jsonb not null default '[]'::jsonb check (jsonb_typeof(members) = 'array'),
  status text not null default 'registered',
  created_at timestamptz not null default now()
);
create table if not exists public.stages (
  id uuid primary key default gen_random_uuid(),
  competition_code text not null references public.competitions(code),
  stage_number integer not null check (stage_number between 1 and 3),
  name text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  unique (competition_code, stage_number)
);
insert into public.competitions(code,name,year_group,event_date) values
 ('TECHLIFT','TechLift',1,'2026-10-30'),
 ('DATAQUEST','DataQuest',2,'2026-10-30'),
 ('AI_NEXUS','AI Nexus',3,'2026-10-31') on conflict (code) do nothing;
insert into public.stages(competition_code,stage_number,name) values
 ('TECHLIFT',1,'Technical Quiz'),('TECHLIFT',2,'Coding Challenge'),('TECHLIFT',3,'Tech Mission'),
 ('DATAQUEST',1,'Data Science Quiz'),('DATAQUEST',2,'Data Challenge'),('DATAQUEST',3,'Data Detective'),
 ('AI_NEXUS',1,'AI/ML Quiz'),('AI_NEXUS',2,'Technical Challenge'),('AI_NEXUS',3,'AI Innovation')
 on conflict (competition_code,stage_number) do nothing;
alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.competitions enable row level security;
alter table public.stages enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
revoke all on public.teams from anon, authenticated;
grant select,insert,update,delete on public.teams to authenticated;
grant select on public.competitions,public.stages to authenticated;
drop policy if exists "IKARUS competition read" on public.competitions;
create policy "IKARUS competition read" on public.competitions for select to authenticated using (true);
drop policy if exists "IKARUS stages read" on public.stages;
create policy "IKARUS stages read" on public.stages for select to authenticated using (true);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values ('competition-materials','competition-materials',false,15728640,array['application/pdf'])
 on conflict (id) do nothing;
notify pgrst, 'reload schema';
