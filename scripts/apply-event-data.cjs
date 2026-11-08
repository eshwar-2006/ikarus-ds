const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const {root,url,key}=require('./supabase-admin.cjs')();
const {loadTS}=require('../tests/helpers.cjs');
const {validateQuestions}=loadTS(path.join(root,'ikarus2026-portal/supabase/functions/_shared/quiz.ts'));
const stages=JSON.parse(fs.readFileSync(path.join(root,'.private-backups/revised-event/manifest.json'),'utf8'));
const teams=JSON.parse(fs.readFileSync(path.join(root,'.private-backups/revised-event/teams.json'),'utf8'));
async function request(endpoint,options={}){for(let i=0;i<3;i++){try{return await fetch(endpoint,{...options,signal:AbortSignal.timeout(45000)});}catch(e){if(i===2)throw e;}}}
(async()=>{
 for(const stage of stages){const error=validateQuestions(stage.quiz_payload.questions);if(error)throw Error(`${stage.competition_code} ${stage.stage_name}: ${error}`);}
 for(const stage of stages){
  const data=fs.readFileSync(stage.source_file);if(crypto.createHash('sha256').update(data).digest('hex')!==stage.source_sha256)throw Error('Source PDF changed after review');
  const endpoint=`${url}/storage/v1/object/competition-materials/${stage.source_path}`,headers={apikey:key,Authorization:`Bearer ${key}`};
  let remote=await request(endpoint,{headers});
  if(remote.status===400||remote.status===404){const uploaded=await request(endpoint,{method:'POST',headers:{...headers,'Content-Type':'application/pdf','x-upsert':'false'},body:data});if(!uploaded.ok&&uploaded.status!==409)throw Error(`Private PDF upload failed: HTTP ${uploaded.status}`);remote=await request(endpoint,{headers});}
  if(!remote.ok||crypto.createHash('sha256').update(Buffer.from(await remote.arrayBuffer())).digest('hex')!==stage.source_sha256)throw Error('Private uploaded PDF did not match the supplied source');
  console.log(`Verified revised private reference: ${stage.competition_code} ${stage.stage_name}`);
 }
 const sqlValue=value=>"'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb";
 const content=stages.map(({source_file,...stage})=>stage);
 const sql=`begin;
do $event_import$ declare item jsonb; target uuid; begin
 for item in select * from jsonb_array_elements(${sqlValue(content)}) loop
  select id into strict target from public.quiz_drafts where competition_code=item->>'competition_code' and stage_name=item->>'stage_name' and status='published';
  if exists(select 1 from public.quiz_attempts where quiz_id=target) then raise exception 'A stage has attempts; question replacement requires organizer review'; end if;
 end loop;
 for item in select * from jsonb_array_elements(${sqlValue(teams)}) loop
  insert into public.teams(competition_code,team_name,registration_number,members)
   values(item->>'competition_code',item->>'team_name',item->>'registration_number',item->'members')
   on conflict(competition_code,(lower(trim(registration_number)))) do update set team_name=excluded.team_name,members=excluded.members;
 end loop;
 for item in select * from jsonb_array_elements(${sqlValue(content)}) loop
  update public.competitions set year_group=(item->>'year_group')::integer where code=item->>'competition_code';
  update public.quiz_drafts set title=item->>'title',duration_minutes=(item->>'duration_minutes')::integer,source_path=item->>'source_path',quiz_payload=item->'quiz_payload',updated_at=now()
   where competition_code=item->>'competition_code' and stage_name=item->>'stage_name' and status='published';
 end loop;
end $event_import$;
notify pgrst,'reload schema';
commit;
select jsonb_build_object('published_stages',(select count(*) from public.quiz_drafts where status='published'),'imported_team_records',${teams.length}) as imported;`;
 const file='.private-backups/revised-event/apply.sql';fs.writeFileSync(path.join(root,file),sql);
 const output=execFileSync('npx.cmd',['--offline','--cache','.npm-cache','supabase','db','query','--linked','--project-ref',new URL(url).hostname.split('.')[0],'--file',file,'--output-format','json'],{cwd:root,shell:true,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:1048576});
 const result=JSON.parse(output);console.log(JSON.stringify(result.rows));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
