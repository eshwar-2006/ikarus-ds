-- Private snapshot for the tables/policies affected by setup. Auth credentials
-- are deliberately excluded. Store outside the public build and source control.
select jsonb_build_object(
 'captured_at',now(),
 'profiles',(select coalesce(jsonb_agg(t),'[]'::jsonb) from public.profiles t),
 'teams',(select coalesce(jsonb_agg(t),'[]'::jsonb) from public.teams t),
 'competitions',(select coalesce(jsonb_agg(t),'[]'::jsonb) from public.competitions t),
 'stages',(select coalesce(jsonb_agg(t),'[]'::jsonb) from public.stages t),
 'quiz_drafts',(select coalesce(jsonb_agg(t),'[]'::jsonb) from public.quiz_drafts t),
 'quiz_attempts',(select coalesce(jsonb_agg(t),'[]'::jsonb) from public.quiz_attempts t),
 'policies',(select jsonb_agg(t) from pg_policies t where schemaname in ('public','storage')),
 'grants',(select jsonb_agg(t) from information_schema.role_table_grants t where table_schema='public'),
 'constraints',(select jsonb_agg(jsonb_build_object('table',conrelid::regclass::text,'name',conname,'definition',pg_get_constraintdef(oid))) from pg_constraint where connamespace='public'::regnamespace)
) as snapshot;
