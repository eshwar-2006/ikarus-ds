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
