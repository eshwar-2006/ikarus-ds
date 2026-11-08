begin;
-- SOURCE: base-schema.sql
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


-- SOURCE: quiz-engine-migration.sql
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


-- SOURCE: competition-engine-migration.sql
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


-- SOURCE: portal-fixes-migration.sql
-- Run after the base, quiz-engine and competition-engine migrations.
-- A browser may edit drafts, but only Edge Functions can publish/freeze them.
-- Remove legacy public policies; permissive policies are ORed by Postgres.
do $$ declare pol record; begin
 for pol in select tablename,policyname from pg_policies
 where schemaname='public' and tablename in ('quiz_drafts','quiz_attempts') loop
  execute format('drop policy if exists %I on public.%I',pol.policyname,pol.tablename);
 end loop;
end $$;
revoke all on public.quiz_drafts from anon;
revoke all on public.quiz_attempts from anon,authenticated;
create policy "IKARUS quiz drafts organizer read" on public.quiz_drafts
 for select to authenticated using (public.ikarus_is_organizer_for(competition_code));
create policy "IKARUS quiz drafts organizer insert" on public.quiz_drafts
 for insert to authenticated with check (status='draft' and created_by=(select auth.uid()) and public.ikarus_is_organizer_for(competition_code));
drop policy if exists "IKARUS quiz drafts organizer update" on public.quiz_drafts;
create policy "IKARUS quiz drafts organizer update" on public.quiz_drafts
 for update to authenticated
 using (status='draft' and public.ikarus_is_organizer_for(competition_code))
 with check (status='draft' and public.ikarus_is_organizer_for(competition_code));
revoke update on public.quiz_drafts from authenticated;
grant update (title,stage_name,duration_minutes,opens_at,closes_at,quiz_payload,updated_at)
 on public.quiz_drafts to authenticated;
grant select on public.profiles to authenticated;
grant select,insert,update,delete on public.teams to authenticated;
grant all on public.quiz_drafts,public.quiz_attempts,public.profiles,
 public.teams,public.competitions,public.stages to service_role;
-- The authenticated account is the scoring identity; anonymous ticket attempts
-- cannot be admitted through the service endpoints or inserted into the table.
alter table public.quiz_attempts alter column user_id set not null;
do $$ begin
 if not exists (select 1 from pg_constraint where conrelid='public.quiz_attempts'::regclass and conname='quiz_attempts_user_id_fkey') then
  alter table public.quiz_attempts add constraint quiz_attempts_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
 end if;
end $$;
-- Enforce the deadline at the actual write, including requests racing with expiry.
create or replace function public.ikarus_guard_attempt_progress()
returns trigger language plpgsql set search_path=public as $$
begin
 if old.status='in_progress' and new.status='in_progress' and
    new.answers is distinct from old.answers and
    (old.deadline_at is null or clock_timestamp() > old.deadline_at) then
   raise exception 'Stage deadline has passed';
 end if;
 return new;
end $$;
drop trigger if exists ikarus_guard_attempt_progress on public.quiz_attempts;
create trigger ikarus_guard_attempt_progress before update on public.quiz_attempts
 for each row execute function public.ikarus_guard_attempt_progress();
notify pgrst, 'reload schema';


-- SOURCE: storage-access-migration.sql
-- Legacy policies labeled "organizer" were granted to public without a role
-- check. Remove those exact bucket policies and add restrictive guards so a
-- future permissive policy cannot expose this private bucket accidentally.
drop policy if exists "Allow organizer upload to competition-materials" on storage.objects;
drop policy if exists "Allow organizer read competition-materials" on storage.objects;
drop policy if exists "Allow organizer update competition-materials" on storage.objects;
drop policy if exists "Allow organizer delete competition-materials" on storage.objects;
drop policy if exists "IKARUS materials authenticated guard" on storage.objects;
create policy "IKARUS materials authenticated guard" on storage.objects
 as restrictive for all to authenticated
 using (bucket_id <> 'competition-materials' or public.ikarus_is_organizer_for((storage.foldername(name))[2]))
 with check (bucket_id <> 'competition-materials' or public.ikarus_is_organizer_for((storage.foldername(name))[2]));
drop policy if exists "IKARUS materials anonymous guard" on storage.objects;
create policy "IKARUS materials anonymous guard" on storage.objects
 as restrictive for all to anon
 using (bucket_id <> 'competition-materials')
 with check (bucket_id <> 'competition-materials');
update storage.buckets set public=false where id='competition-materials';
notify pgrst, 'reload schema';


-- SOURCE: ticket-login-migration.sql
alter table public.profiles add column if not exists team_id uuid references public.teams(id) on delete set null;
create unique index if not exists profiles_team_identity_unique on public.profiles(team_id) where team_id is not null;
create index if not exists teams_ticket_lookup_idx on public.teams(lower(trim(registration_number)));
create table if not exists public.ticket_login_rate_limits (
 key text primary key,
 window_started_at timestamptz not null default now(),
 requests integer not null default 1
);
alter table public.ticket_login_rate_limits enable row level security;
revoke all on public.ticket_login_rate_limits from public,anon,authenticated;
create or replace function public.ikarus_ticket_rate_limit(p_key text,p_limit integer)
returns boolean language plpgsql security definer set search_path=public as $$
declare allowed_count integer;
begin
 insert into public.ticket_login_rate_limits as limits(key) values (p_key)
 on conflict (key) do update set
 requests=case when limits.window_started_at<now()-interval '5 minutes' then 1 else limits.requests+1 end,
 window_started_at=case when limits.window_started_at<now()-interval '5 minutes' then now() else limits.window_started_at end
 returning requests into allowed_count;
 return allowed_count<=p_limit;
end $$;
create or replace function public.ikarus_find_ticket(p_ticket text)
returns setof public.teams language sql stable security definer set search_path=public as $$
 select * from public.teams where lower(trim(registration_number))=lower(trim(p_ticket)) and status in ('registered','checked_in');
$$;
revoke all on function public.ikarus_find_ticket(text) from public,anon,authenticated;
revoke all on function public.ikarus_ticket_rate_limit(text,integer) from public,anon,authenticated;
grant execute on function public.ikarus_find_ticket(text) to service_role;
grant execute on function public.ikarus_ticket_rate_limit(text,integer) to service_role;
notify pgrst,'reload schema';


-- SOURCE: round3-qualification-migration.sql
create table if not exists public.round3_promotions (
 competition_code text primary key references public.competitions(code),
 finalists jsonb not null check(jsonb_typeof(finalists)='array' and jsonb_array_length(finalists) between 1 and 5),
 source_version text not null,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
alter table public.round3_promotions enable row level security;
revoke all on public.round3_promotions from public,anon,authenticated,service_role;
grant select on public.round3_promotions to service_role;

create or replace function public.ikarus_competition_source(p_competition text,p_stages text[])
returns jsonb language sql stable security definer set search_path=public as $$
 with source as(select jsonb_build_object(
 'quizzes',coalesce((select jsonb_agg(jsonb_build_object('id',id,'stage_name',stage_name) order by id) from quiz_drafts where competition_code=p_competition and status='published' and stage_name=any(p_stages)),'[]'::jsonb),
 'attempts',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'quiz_id',a.quiz_id,'user_id',a.user_id,'status',a.status,'score',a.score,'reviewed_score',a.reviewed_score,'manual_review_required',a.manual_review_required,'started_at',a.started_at,'submitted_at',a.submitted_at) order by a.id) from quiz_attempts a join quiz_drafts q on q.id=a.quiz_id where q.competition_code=p_competition and q.status='published' and q.stage_name=any(p_stages)),'[]'::jsonb),
 'profiles',coalesce((select jsonb_agg(jsonb_build_object('id',id,'team_id',team_id,'full_name',full_name) order by id) from profiles where competition_code=p_competition and role in ('team','team_member','participant')),'[]'::jsonb),
 'teams',coalesce((select jsonb_agg(jsonb_build_object('id',id,'team_name',team_name,'status',status) order by id) from teams where competition_code=p_competition),'[]'::jsonb)
 ) as data) select data||jsonb_build_object('version',md5(data::text)) from source;
$$;
create or replace function public.ikarus_round3_source(p_competition text)
returns jsonb language sql stable security definer set search_path=public as $$
 select ikarus_competition_source(p_competition,array['Stage 1','Stage 2']);
$$;
create table if not exists public.competition_winners(
 competition_code text primary key references public.round3_promotions(competition_code),
 winner jsonb not null check(jsonb_typeof(winner)='object'),
 source_version text not null,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
alter table public.competition_winners enable row level security;
revoke all on public.competition_winners from public,anon,authenticated,service_role;
grant select on public.competition_winners to service_role;
create or replace function public.ikarus_confirm_winner(p_competition text,p_version text,p_winner jsonb,p_actor uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare current_source jsonb; result jsonb;
begin
 lock table public.quiz_attempts in share row exclusive mode;
 lock table public.profiles,public.teams,public.quiz_drafts in share mode;
 if not exists(select 1 from profiles where id=p_actor and role='president') then raise exception 'President access required'; end if;
 if not exists(select 1 from round3_promotions where competition_code=p_competition) then raise exception 'Confirm Round 3 finalists first'; end if;
 if exists(select 1 from competition_winners where competition_code=p_competition) then raise exception 'Winner has already been declared'; end if;
 current_source:=ikarus_competition_source(p_competition,array['Stage 3']);
 if current_source->>'version' is distinct from p_version then raise exception 'Final-round scores changed. Refresh the winner preview.'; end if;
 if jsonb_typeof(p_winner)<>'object' or p_winner->>'identity' is null then raise exception 'One winner is required'; end if;
 insert into competition_winners(competition_code,winner,source_version,created_by) values(p_competition,p_winner,p_version,p_actor) returning to_jsonb(competition_winners.*) into result;
 insert into ikarus_audit_events(actor_id,action,entity_type,entity_id,competition_code,details) values(p_actor,'competition_winner_declared','competition',null,p_competition,jsonb_build_object('winner',p_winner));
 return result;
end $$;
revoke all on function public.ikarus_competition_source(text,text[]) from public,anon,authenticated;
revoke all on function public.ikarus_confirm_winner(text,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.ikarus_competition_source(text,text[]) to service_role;
grant execute on function public.ikarus_confirm_winner(text,text,jsonb,uuid) to service_role;
create or replace function public.ikarus_confirm_round3(p_competition text,p_version text,p_finalists jsonb,p_actor uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare current_source jsonb; result jsonb;
begin
 lock table public.quiz_attempts in share row exclusive mode;
 lock table public.profiles,public.teams,public.quiz_drafts in share mode;
 if not exists(select 1 from profiles where id=p_actor and role='president') then raise exception 'President access required'; end if;
 if exists(select 1 from round3_promotions where competition_code=p_competition) then raise exception 'Finalists have already been confirmed'; end if;
 current_source:=ikarus_round3_source(p_competition);
 if current_source->>'version' is distinct from p_version then raise exception 'Scores or registrations changed. Refresh the qualification preview.'; end if;
 if jsonb_typeof(p_finalists)<>'array' or jsonb_array_length(p_finalists) not between 1 and 5 then raise exception 'Select at most five finalists'; end if;
 if (select count(distinct item->>'identity') from jsonb_array_elements(p_finalists)item)<>jsonb_array_length(p_finalists) then raise exception 'Duplicate or missing finalist identity'; end if;
 insert into round3_promotions(competition_code,finalists,source_version,created_by) values(p_competition,p_finalists,p_version,p_actor) returning to_jsonb(round3_promotions.*) into result;
 insert into ikarus_audit_events(actor_id,action,entity_type,entity_id,competition_code,details) values(p_actor,'round3_finalists_confirmed','competition',null,p_competition,jsonb_build_object('finalists',p_finalists,'tie_breaker','combined_elapsed_time'));
 return result;
end $$;
revoke all on function public.ikarus_round3_source(text) from public,anon,authenticated;
revoke all on function public.ikarus_confirm_round3(text,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.ikarus_round3_source(text) to service_role;
grant execute on function public.ikarus_confirm_round3(text,text,jsonb,uuid) to service_role;

create or replace function public.ikarus_guard_round_qualification()
returns trigger language plpgsql set search_path=public as $$
declare stage record; promotion jsonb; team uuid;
begin
 select competition_code,stage_name into stage from quiz_drafts where id=new.quiz_id;
 select finalists into promotion from round3_promotions where competition_code=stage.competition_code;
 if stage.stage_name ~* '^(stage|round)[[:space:]]*3$' then
  select team_id into team from profiles where id=new.user_id;
  if promotion is null or not exists(select 1 from jsonb_array_elements(promotion) f where (team is not null and f->>'team_id'=team::text) or (f->'user_ids') ? new.user_id::text) then
   raise exception 'Only confirmed top-five finalists are eligible for Round 3';
  end if;
  if exists(select 1 from competition_winners where competition_code=stage.competition_code) then
   if tg_op='INSERT' then raise exception 'Round 3 is closed. The winner has been declared'; end if;
   if new.answers is distinct from old.answers or new.score is distinct from old.score or new.reviewed_score is distinct from old.reviewed_score or new.started_at is distinct from old.started_at or new.submitted_at is distinct from old.submitted_at then raise exception 'Final-round scores are locked after winner declaration'; end if;
  end if;
 elsif stage.stage_name in ('Stage 1','Stage 2') and promotion is not null then
  if tg_op='INSERT' then raise exception 'Preliminary rounds are closed after finalist confirmation'; end if;
  if new.quiz_id is distinct from old.quiz_id or new.user_id is distinct from old.user_id or new.answers is distinct from old.answers or new.score is distinct from old.score or new.reviewed_score is distinct from old.reviewed_score or new.started_at is distinct from old.started_at or new.submitted_at is distinct from old.submitted_at then
   raise exception 'Preliminary scores are locked after finalist confirmation';
  end if;
 end if;
 return new;
end $$;
drop trigger if exists ikarus_guard_round_qualification on public.quiz_attempts;
create trigger ikarus_guard_round_qualification before insert or update on public.quiz_attempts for each row execute function public.ikarus_guard_round_qualification();
notify pgrst,'reload schema';


commit;
