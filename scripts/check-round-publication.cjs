// Controlled publication smoke test. Only newly generated QA records are cleaned up.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),{execFileSync}=require('child_process');
const {root,url,key}=require('./supabase-admin.cjs')();const nonce=crypto.randomBytes(6).toString('hex'),users=[],quizIds=[];let checks=0;
async function request(route,body,token=key,method=body===undefined?'GET':'POST'){
 const r=await fetch(url+route,{method,headers:{apikey:key,Authorization:'Bearer '+token,'Content-Type':'application/json',Prefer:'return=representation'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});return {status:r.status,data:await r.json()};
}
function check(ok,label){if(!ok)throw Error(label);checks++;console.log('PASS: '+label);}
async function account(role,code){const email=`ikarus-qa-publication-${nonce}-${users.length}@example.invalid`,password=crypto.randomBytes(24).toString('base64url')+'aA1!';const created=await request('/auth/v1/admin/users',{email,password,email_confirm:true});if(created.status!==200)throw Error('QA creation failed');users.push(created.data.id);const profile=await request('/rest/v1/profiles',{id:created.data.id,full_name:'Publication QA '+nonce,role,competition_code:code});if(profile.status!==201)throw Error('QA profile failed');const signed=await request('/auth/v1/token?grant_type=password',{email,password});if(signed.status!==200)throw Error('QA login failed');return signed.data.access_token;}
const call=(name,body,token)=>request('/functions/v1/'+name,body,token);
(async()=>{try{
 const president=await account('president',null),officer=await account('officer','TECHLIFT');let tech;
 for(const code of ['TECHLIFT','DATAQUEST','AI_NEXUS']){
  const team=await account('team',code);if(code==='TECHLIFT')tech=team;const list=await call('list-published-quizzes',{},team);check(list.status===200&&list.data.quizzes.length===3&&list.data.quizzes.every(q=>q.competition_code===code&&q.publication_status==='draft'&&!q.can_start),code+': all three real rounds await President publication');check(!JSON.stringify(list.data).includes('correct_answer')&&!JSON.stringify(list.data).includes('questions'),code+': locked cards reveal no question content');
  const denials=await Promise.all(list.data.quizzes.flatMap(q=>['start-quiz','get-published-quiz','save-quiz-progress','submit-quiz'].map(async route=>{const r=await call(route,{quiz_id:q.id,answers:{}},team);return r.status>=400;})));check(denials.every(Boolean),code+': all question and submission routes deny unpublished rounds');
 }
 const inserted=await request('/rest/v1/quiz_drafts',{title:'Publication QA '+nonce,competition_code:'TECHLIFT',stage_name:'QA publication',source_path:'uploads/TECHLIFT/qa-publication.pdf',status:'draft',duration_minutes:1,created_by:users[0],quiz_payload:{questions:[{position:1,type:'mcq',text:'QA selection',marks:1,options:[{label:'A',text:'One'},{label:'B',text:'Two'}],correct_answer:'A'}]}});if(inserted.status!==201)throw Error('QA draft failed');const id=inserted.data[0].id;quizIds.push(id);
 check((await call('publish-quiz',{quiz_id:id},officer)).status===403,'Officer cannot publish or unlock a round');check((await call('publish-quiz',{quiz_id:id},tech)).status===403,'Team cannot publish a round');check((await call('publish-quiz',{quiz_id:id},president)).status===200,'President Publish action releases only the selected QA round');
 check((await call('start-quiz',{quiz_id:id},tech)).status===200,'President publication unlocks the selected round for its teams');
 const audits=await request('/rest/v1/ikarus_audit_events?select=action&entity_id=eq.'+id+'&action=eq.round_published');check(audits.data.length===1,'Publication records the President action in the audit log');
 }finally{
 if(users.some(id=>!/^[-0-9a-f]{36}$/.test(id))||quizIds.some(id=>!/^[-0-9a-f]{36}$/.test(id)))throw Error('Invalid QA cleanup identifiers');
 const ids=users.map(x=>"'"+x+"'").join(',')||"null",qids=quizIds.map(x=>"'"+x+"'").join(',')||"null";
 const sql=`begin; delete from public.ikarus_audit_events where actor_id in (${ids}); delete from public.quiz_drafts where id in (${qids}) and title='Publication QA ${nonce}'; delete from auth.users where id in (${ids}) and email like 'ikarus-qa-publication-${nonce}-%@example.invalid'; commit;`;
 const file=path.join('.private-backups','cleanup-publication-'+nonce+'.sql');fs.writeFileSync(path.join(root,file),sql);execFileSync('npx.cmd',['--offline','--cache','.npm-cache','supabase','db','query','--linked','--project-ref','faxiasqmetqvdompxoxz','--file',file,'--output-format','json'],{cwd:root,shell:true,stdio:['ignore','pipe','pipe']});console.log('Temporary publication QA records removed.');
 }console.log(checks+' publication checks passed. All nine real rounds remain unpublished.');})().catch(e=>{console.error(e.message);process.exitCode=1;});
