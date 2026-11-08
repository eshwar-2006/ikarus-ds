-- All test records and declarations are rolled back; never retains demo data.
begin;
do $qualification_test$
declare actor uuid; q1 uuid; q2 uuid; q3 uuid; u uuid; t uuid; excluded uuid; eligible uuid;
 source jsonb; finalists jsonb; winner jsonb; blocked boolean;
begin
 select id into strict actor from public.profiles where role='president';
 select id into strict q1 from public.quiz_drafts where competition_code='TECHLIFT' and stage_name='Stage 1' and status='published';
 select id into strict q2 from public.quiz_drafts where competition_code='TECHLIFT' and stage_name='Stage 2' and status='published';
 select id into strict q3 from public.quiz_drafts where competition_code='TECHLIFT' and stage_name='Stage 3' and status='published';
 if exists(select 1 from public.round3_promotions where competition_code='TECHLIFT') then raise exception 'Do not run this test after live finalists are confirmed'; end if;
 for i in 1..6 loop
  u:=gen_random_uuid();t:=gen_random_uuid();
  insert into auth.users(id,email,role,aud) values(u,'qualification-rollback-'||u||'@example.invalid','authenticated','authenticated');
  insert into public.teams(id,competition_code,team_name,registration_number,members,status) values(t,'TECHLIFT','Rollback QA '||i,'ROLLBACK-'||t,'[]','registered');
  insert into public.profiles(id,team_id,full_name,role,competition_code) values(u,t,'Rollback QA '||i,'team','TECHLIFT');
  insert into public.quiz_attempts(quiz_id,user_id,score,max_score,status,started_at,submitted_at,manual_review_required) values(q1,u,10+i,20,'submitted',now()-interval '20 minutes',now()-interval '10 minutes',false);
  insert into public.quiz_attempts(quiz_id,user_id,score,max_score,status,started_at,submitted_at,manual_review_required,reviewed_score) values(q2,u,0,100,'reviewed',now()-interval '10 minutes',now()-interval '1 minute',true,70+i);
  if i=1 then excluded:=u;end if;if i=6 then eligible:=u;end if;
 end loop;
 source:=public.ikarus_round3_source('TECHLIFT');
 select jsonb_agg(item order by score desc) into finalists from (
  select jsonb_build_object('identity',p.team_id,'team_id',p.team_id,'team_name',p.full_name,'user_ids',jsonb_build_array(p.id),'score',sum(coalesce(a.reviewed_score,a.score)),'elapsed_ms',1140000) as item,sum(coalesce(a.reviewed_score,a.score)) as score
  from public.profiles p join public.quiz_attempts a on a.user_id=p.id
  where p.full_name like 'Rollback QA %' and a.quiz_id in(q1,q2) group by p.id,p.team_id,p.full_name order by score desc limit 5
 )chosen;
 blocked:=false;begin perform public.ikarus_confirm_round3('TECHLIFT','stale-version',finalists,actor);exception when others then if sqlerrm like 'Scores or registrations changed%' then blocked:=true;else raise;end if;end;
 if not blocked then raise exception 'Stale preview was accepted';end if;
 perform public.ikarus_confirm_round3('TECHLIFT',source->>'version',finalists,actor);
 if jsonb_array_length((select p.finalists from public.round3_promotions p where competition_code='TECHLIFT'))<>5 then raise exception 'More or fewer than five finalists';end if;
 blocked:=false;begin insert into public.quiz_attempts(quiz_id,user_id,status) values(q3,excluded,'in_progress');exception when others then if sqlerrm like 'Only confirmed top-five%' then blocked:=true;else raise;end if;end;
 if not blocked then raise exception 'Non-finalist could insert Round 3 attempt';end if;
 insert into public.quiz_attempts(quiz_id,user_id,status,manual_review_required,reviewed_score,max_score,started_at,submitted_at) values(q3,eligible,'reviewed',true,96,100,now()-interval '30 minutes',now());
 blocked:=false;begin update public.quiz_attempts set reviewed_score=100 where quiz_id=q2 and user_id=excluded;exception when others then if sqlerrm like 'Preliminary scores are locked%' then blocked:=true;else raise;end if;end;
 if not blocked then raise exception 'Preliminary scores changed after promotion';end if;
 source:=public.ikarus_competition_source('TECHLIFT',array['Stage 3']);winner:=(finalists->0)||jsonb_build_object('score',96);
 perform public.ikarus_confirm_winner('TECHLIFT',source->>'version',winner,actor);
 if (select w.winner->>'identity' from public.competition_winners w where competition_code='TECHLIFT') is distinct from winner->>'identity' then raise exception 'Wrong winner stored';end if;
 blocked:=false;begin update public.quiz_attempts set reviewed_score=97 where quiz_id=q3 and user_id=eligible;exception when others then if sqlerrm like 'Final-round scores are locked%' then blocked:=true;else raise;end if;end;
 if not blocked then raise exception 'Final score changed after declaring winner';end if;
end $qualification_test$;
rollback;
select true as qualification_guards_passed, true as all_demo_data_rolled_back;
