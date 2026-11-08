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
