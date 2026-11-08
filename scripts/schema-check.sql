select table_name,column_name,data_type,is_nullable,column_default
from information_schema.columns where table_schema='public' and table_name in
 ('profiles','teams','competitions','stages','quiz_drafts','quiz_attempts','ikarus_audit_events')
order by table_name,ordinal_position;
select tablename,policyname,cmd,qual,with_check from pg_policies
where schemaname='public' and tablename in ('profiles','teams','quiz_drafts','quiz_attempts');
select role,count(*) from public.profiles group by role;
select status,count(*) from public.quiz_drafts group by status;
select status,count(*) from public.quiz_attempts group by status;
select id,public,file_size_limit from storage.buckets where id='competition-materials';
select name from storage.objects where bucket_id='competition-materials';
