-- Preserve each judge-entered section mark separately from the calculated total.
alter table public.quiz_attempts add column if not exists section_scores jsonb not null default '{}'::jsonb;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.quiz_attempts'::regclass and conname='quiz_attempts_section_scores_object') then
    alter table public.quiz_attempts add constraint quiz_attempts_section_scores_object check(jsonb_typeof(section_scores)='object');
  end if;
end $$;
notify pgrst, 'reload schema';
