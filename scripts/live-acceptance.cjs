// Controlled live test. Credentials stay in memory; only generated QA records
// are removed. Never logs tokens, passwords, answer keys, or real team names.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),config={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(root,'ikarus2026-portal/supabase-config.js'),'utf8'),config);
const url=config.window.IKARUS_SUPABASE_URL,publishable=config.window.IKARUS_SUPABASE_PUBLISHABLE_KEY,ref=new URL(url).hostname.split('.')[0];
const nonce=crypto.randomBytes(6).toString('hex'),users=[],quizzes=[],qaTeams=[];let adminKey,team,other,officer,president,passed=0;
function check(value,label){if(!value)throw Error(`FAIL: ${label}`);passed++;console.log(`PASS: ${label}`);}
async function request(route,{method='GET',body,token,key=publishable,headers={}}={}){
 let response;
 for(let retry=0;retry<3;retry++){
  try{response=await fetch(url+route,{method,headers:{apikey:key,...(token?{Authorization:`Bearer ${token}`} : {}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});break;}
  catch(e){if(retry===2)throw Error(`Network failed during ${method} ${route.split('?')[0]}`);}
 }
 const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:response.status,data};
}
const admin=(route,opts={})=>request(route,{...opts,key:adminKey,token:adminKey});
const fn=(name,body,token)=>request(`/functions/v1/${name}`,{method:'POST',body,token});
async function createAccount(role,competition){
 const email=`ikarus-qa-${nonce}-${role}-${competition.toLowerCase()}@example.invalid`,password=crypto.randomBytes(24).toString('base64url')+'aA1!';
 const created=await admin('/auth/v1/admin/users',{method:'POST',body:{email,password,email_confirm:true}});
 if(created.status!==200)throw Error(`QA account creation failed (HTTP ${created.status})`);
 const id=created.data.id;users.push(id);
 const profile=await admin('/rest/v1/profiles',{method:'POST',body:{id,full_name:`Portal QA ${nonce}`,role,competition_code:role==='president'?null:competition}});
 if(profile.status!==201)throw Error(`QA profile creation failed (HTTP ${profile.status})`);
 const signed=await request('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}});
 if(signed.status!==200)throw Error(`QA sign-in failed (HTTP ${signed.status})`);
 return {id,token:signed.data.access_token};
}
async function main(){
 const raw=execFileSync('npx.cmd',['--offline','--cache','.npm-cache','supabase','projects','api-keys','--project-ref',ref,'--reveal','--output-format','json'],{cwd:root,shell:true,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:1024*1024});
 const keys=JSON.parse(raw).keys;adminKey=keys.find(k=>k.name==='service_role')?.api_key;
 if(!adminKey)throw Error('A server-side key is required for controlled live tests');
 try{
  team=await createAccount('team','TECHLIFT');other=await createAccount('team','DATAQUEST');officer=await createAccount('officer','TECHLIFT');president=await createAccount('president','TECHLIFT');
  check(true,'temporary team, officer and president accounts can sign in');
  const questions=[{position:1,text:'QA: choose the first option',type:'mcq',marks:2,options:[{label:'A',text:'First'},{label:'B',text:'Second'}],correct_answer:'A'},{position:2,text:'QA: submit code for manual review',type:'code',marks:8,options:[],grading_criteria:[{key:'explanation',label:'Explanation',marks:3,guidance:'Check explanation'},{key:'code',label:'Code',marks:5,guidance:'Check code'}]}];
  const created=await request('/rest/v1/quiz_drafts?select=id',{method:'POST',token:president.token,headers:{Prefer:'return=representation'},body:{competition_code:'TECHLIFT',title:`Portal QA ${nonce}`,stage_name:'QA test',source_path:'uploads/TECHLIFT/qa-test.pdf',duration_minutes:5,quiz_payload:{questions},created_by:president.id,status:'draft'}});
  check(created.status===201,'organizer RLS permits draft creation');const quizId=created.data[0].id;quizzes.push(quizId);
  const bypass=await request(`/rest/v1/quiz_drafts?id=eq.${quizId}`,{method:'PATCH',token:president.token,body:{status:'published'}});check(bypass.status>=400,'direct browser publication is denied');
  const published=await fn('publish-quiz',{quiz_id:quizId},president.token);check(published.status===200,'secure stage publishing works');
  const anonDrafts=await request('/rest/v1/quiz_drafts?select=id&limit=1');check(anonDrafts.status>=400,'anonymous answer-key table reads are denied');
  const anonAttempts=await request('/rest/v1/quiz_attempts?select=id&limit=1');check(anonAttempts.status>=400,'anonymous attempt reads are denied');
  const list=await fn('list-published-quizzes',{},team.token);check(list.status===200&&list.data.quizzes.some(q=>q.id===quizId),'team sees assigned stages');
  check((await fn('start-quiz',{quiz_id:quizId},other.token)).status===403,'cross-competition stage start is denied');
  const started=await fn('start-quiz',{quiz_id:quizId},team.token);check(started.status===200&&!!started.data.deadline_at,'team can start a server-timed attempt');
  check(!JSON.stringify(started.data).includes('correct_answer')&&!JSON.stringify(started.data).includes('Check explanation')&&started.data.quiz.questions[1].marking_criteria[0].marks===3,'participant payload exposes criterion maxima but omits answer keys and private evaluation guidance');
  const answers={'1':'A','2':'// code\n'+'x'.repeat(6000)};
  check((await fn('save-quiz-progress',{quiz_id:quizId,answers},team.token)).status===200,'coding responses over 5000 characters autosave');
  const resumed=await fn('start-quiz',{quiz_id:quizId},team.token);check(resumed.status===200&&resumed.data.resumed&&resumed.data.saved_answers['2']===answers['2'],'refresh/resume restores saved code');
  check(resumed.data.deadline_at===started.data.deadline_at,'refresh does not reset the server deadline');
  check((await fn('report-quiz-event',{quiz_id:quizId,reason:'tab_hidden'},team.token)).status===200,'tab-switch focus event is recorded against the active attempt');
  const submitted=await fn('submit-quiz',{quiz_id:quizId,answers},team.token);check(submitted.status===200&&submitted.data.score===null&&submitted.data.max_score===10&&submitted.data.manual_review_required,'mixed submission awaits judging without presenting a partial score as final');
  check((await fn('submit-quiz',{quiz_id:quizId,answers},team.token)).status===409,'duplicate submission is rejected');
  const review=await fn('manage-results',{action:'list'},officer.token);const attempt=review.data.attempts?.find(a=>a.quiz_id===quizId);
  check(review.status===200&&attempt?.answers['2']===answers['2']&&attempt.questions.length===2,'assigned officer can inspect submitted answers and question context');
  check(attempt.focus_events?.some(event=>event.reason==='tab_hidden'),'organizer review includes quiz focus events');
  check((await fn('manage-results',{action:'approve',attempt_id:attempt.id},officer.token)).status===403,'officer cannot approve results');
  check((await fn('manage-results',{action:'approve',attempt_id:attempt.id},president.token)).status===409,'manual results cannot be approved before grading');
  check((await fn('manage-results',{action:'grade',attempt_id:attempt.id,section_scores:{'2:explanation':2}},officer.token)).status===400,'missing section marks are rejected');
  check((await fn('manage-results',{action:'grade',attempt_id:attempt.id,section_scores:{'2:explanation':4,'2:code':5}},officer.token)).status===400,'marks above a criterion maximum are rejected');
  check((await fn('manage-results',{action:'grade',attempt_id:attempt.id,section_scores:{'2:explanation':2,'2:code':5},reviewer_notes:'Temporary QA review'},officer.token)).status===200,'officer grading works');
  const stored=await admin('/rest/v1/quiz_attempts?select=reviewed_score,section_scores&id=eq.'+attempt.id);check(stored.status===200&&Number(stored.data[0].reviewed_score)===9&&stored.data[0].section_scores['2:explanation']===2&&stored.data[0].section_scores['2:code']===5,'individual criterion marks and server-calculated total persist in the live database');
  const privateScore=await fn('list-published-quizzes',{},team.token);const privateRound=privateScore.data.quizzes.find(q=>q.id===quizId);check(privateRound?.score===9&&privateRound.rank===1,'team sees judged round score and position before public publication');
  check((await fn('manage-results',{action:'approve',attempt_id:attempt.id},president.token)).status===200,'President approval works');
  const hidden=await request(`/functions/v1/public-results?quiz_id=${quizId}`);check(hidden.status===200&&hidden.data.results.every(g=>g.results.length===0),'approved results remain hidden before publication');
  // Validate publication on this generated QA record, then remove immediately.
  check((await fn('manage-results',{action:'publish',attempt_id:attempt.id},president.token)).status===200,'President result publication works');
  const visible=await request(`/functions/v1/public-results?quiz_id=${quizId}`);check(visible.status===200&&visible.data.results[0]?.results[0]?.score===9,'public results show only the final published score');
  check((await fn('manage-accounts',{},officer.token)).status===403,'officer account provisioning is denied');
  const provisioned=await fn('manage-accounts',{email:`ikarus-qa-${nonce}-provisioned@example.invalid`,password:crypto.randomBytes(24).toString('base64url')+'Aa1!',full_name:`Portal QA ${nonce}`,role:'team',competition_code:'TECHLIFT'},president.token);
  if(provisioned.data.user_id)users.push(provisioned.data.user_id);
  check(provisioned.status===200&&!!provisioned.data.user_id,'President can provision a team login and profile together');
  const privatePath='uploads/TECHLIFT/techlift-stage-1-quiz.pdf';
  for(const account of [team,other])check((await request(`/storage/v1/object/sign/competition-materials/${privatePath}`,{method:'POST',token:account.token,body:{expiresIn:60}})).status>=400,'team access to organizer PDFs is denied');
  check((await fn('live-scoreboard',{competition_code:'TECHLIFT'},officer.token)).status===403,'officer cannot access President projector scoreboard');
  const spot=await fn('manage-accounts',{action:'create_team',team_name:`Portal QA Ticket ${nonce}`,competition_code:'TECHLIFT',members:['QA Lead']},president.token);
  if(spot.data.team?.id)qaTeams.push(spot.data.team.id);check(spot.status===200&&!!spot.data.team.ticket_id,'President spot registration creates a team and ticket');
  const looked=await fn('ticket-login',{action:'lookup',ticket_id:spot.data.team.ticket_id});check(looked.status===200&&looked.data.matches[0]?.team_name===spot.data.team.team_name&&!looked.data.session,'ticket lookup shows the matched team before sign-in');
  const challenge=looked.data.matches[0].challenge;check((await fn('ticket-login',{action:'confirm',challenge:challenge+'x'})).status===401,'modified team confirmation is rejected');
  const signed=await fn('ticket-login',{action:'confirm',challenge});check(signed.status===200&&!!signed.data.session?.access_token,'confirming the team creates an authenticated session');
  let ticketToken=signed.data.session.access_token;const ticketUser=await request('/auth/v1/user',{token:ticketToken});check(ticketUser.status===200,'ticket session is accepted by Supabase Auth');
  users.push(ticketUser.data.id);
  const signedAgain=await fn('ticket-login',{action:'confirm',challenge});const sameUser=await request('/auth/v1/user',{token:signedAgain.data.session.access_token});check(sameUser.data.id===ticketUser.data.id,'repeat ticket login retains the same scoring identity');ticketToken=signedAgain.data.session.access_token;
  const objective=await request('/rest/v1/quiz_drafts?select=id',{method:'POST',token:president.token,headers:{Prefer:'return=representation'},body:{competition_code:'TECHLIFT',title:`Portal QA ${nonce}`,stage_name:'QA objective',source_path:'uploads/TECHLIFT/qa-test.pdf',duration_minutes:5,quiz_payload:{questions:[questions[0]]},created_by:president.id,status:'draft'}});
  if(objective.data[0]?.id)quizzes.push(objective.data[0].id);const objectiveId=objective.data[0].id;
  check((await fn('publish-quiz',{quiz_id:objectiveId},president.token)).status===200,'temporary objective round publishes');
  const ticketStart=await fn('start-quiz',{quiz_id:objectiveId},ticketToken);check(ticketStart.status===200,`ticket account can enter an assigned quiz${ticketStart.status!==200?` (HTTP ${ticketStart.status}: ${ticketStart.data.error||'request rejected'})`:''}`);
  const completed=await fn('submit-quiz',{quiz_id:objectiveId,answers:{'1':'A'}},ticketToken);check(completed.status===200&&completed.data.score===2&&completed.data.rank===1,'objective completion immediately returns round score and position');
  const board=await fn('live-scoreboard',{competition_code:'TECHLIFT'},president.token);const spotRow=board.data.rows?.find(r=>r.team_name===spot.data.team.team_name);check(board.status===200&&spotRow?.score===2&&spotRow.rank!==null,'President scoreboard reflects completed round scores and team positions');
  check(!JSON.stringify(board.data).includes(spot.data.team.ticket_id),'projector scoreboard does not expose team ticket IDs');
  const qualification=await fn('manage-qualification',{action:'preview',competition_code:'TECHLIFT'},president.token);check(qualification.status===200&&!qualification.data.promotion,'President can inspect preliminary qualification without promoting demo teams');
  check((await fn('manage-qualification',{action:'preview',competition_code:'TECHLIFT'},team.token)).status===403,'team accounts cannot manage finalists or declare a winner');
  const ai=await createAccount('team','AI_NEXUS');
  const eventQa={TECHLIFT:objectiveId};
  for(const code of ['DATAQUEST','AI_NEXUS']){const created=await request('/rest/v1/quiz_drafts?select=id',{method:'POST',token:president.token,headers:{Prefer:'return=representation'},body:{competition_code:code,title:'Portal QA '+nonce,stage_name:'QA event isolation',source_path:'uploads/'+code+'/qa-test.pdf',duration_minutes:5,quiz_payload:{questions:[questions[0]]},created_by:president.id,status:'draft'}});if(created.status!==201||!created.data[0]?.id)throw Error('Cannot create isolated event QA round');eventQa[code]=created.data[0].id;quizzes.push(eventQa[code]);check((await fn('publish-quiz',{quiz_id:eventQa[code]},president.token)).status===200,code+': temporary access-test round publishes without opening real rounds');}

  for(const [competition,account] of [['TECHLIFT',team],['DATAQUEST',other],['AI_NEXUS',ai]]){
   const assigned=await fn('list-published-quizzes',{},account.token);check(assigned.status===200&&assigned.data.competition_code===competition&&assigned.data.quizzes.every(q=>q.competition_code===competition),competition+': dashboard exposes only assigned event rounds');
   const registrations=await admin('/rest/v1/teams?select=id&competition_code=eq.'+competition+'&status=neq.disqualified');
   const scoreboard=await fn('live-scoreboard',{competition_code:competition},president.token);
   check(scoreboard.status===200&&JSON.stringify(scoreboard.data.rows.map(r=>r.team_key).sort())===JSON.stringify(registrations.data.map(t=>t.id).sort()),competition+': leaderboard contains exactly the selected event roster');
   const preview=await fn('manage-qualification',{action:'preview',competition_code:competition},president.token);check(preview.status===200&&!preview.data.promotion&&!preview.data.winner,competition+': qualification and winner state are separate and unchanged');
   for(const foreign of ['TECHLIFT','DATAQUEST','AI_NEXUS'].filter(c=>c!==competition)){
    const foreignQuiz=eventQa[foreign];
    for(const route of ['start-quiz','get-published-quiz','save-quiz-progress','submit-quiz'])check((await fn(route,{quiz_id:foreignQuiz,answers:{}},account.token)).status===403,competition+': '+route+' rejects '+foreign);
   }
   const originals=await admin(`/rest/v1/quiz_drafts?select=id,duration_minutes,quiz_payload,stage_name,status&status=in.(draft,published)&competition_code=eq.${competition}`);
   for(const original of originals.data.filter(q=>!quizzes.includes(q.id))){
    if(original.status==='draft'){for(const route of ['start-quiz','get-published-quiz','save-quiz-progress','submit-quiz'])check((await fn(route,{quiz_id:original.id,answers:{}},account.token)).status>=400,competition+' '+original.stage_name+': '+route+' keeps an unpublished round locked');continue;}
    if(original.stage_name==='Stage 3'){for(const route of ['start-quiz','get-published-quiz','save-quiz-progress','submit-quiz'])check((await fn(route,{quiz_id:original.id,answers:{}},account.token)).status===403,`${competition}: ${route} denies Round 3 before finalist confirmation`);continue;}
    const delivery=await fn('start-quiz',{quiz_id:original.id},account.token);
    check(delivery.status===200&&delivery.data.quiz.questions.length===original.quiz_payload.questions.length,`${competition} ${original.stage_name}: all stored questions are delivered`);
    check(delivery.data.quiz.questions.every((q,i)=>{const source=original.quiz_payload.questions[i];return q.text===source.text&&q.marks===source.marks&&q.options.length===(source.options||[]).length&&q.options.every((o,j)=>o.label===source.options[j].label&&o.text===source.options[j].text);}),`${competition} ${original.stage_name}: question text, options and marks match the database`);
    const time=Date.parse(delivery.data.deadline_at)-Date.parse(delivery.data.started_at);check(time>0&&time<=original.duration_minutes*60000,`${competition} ${original.stage_name}: server timer matches stage duration`);
    check(!JSON.stringify(delivery.data).includes('correct_answer'),`${competition} ${original.stage_name}: delivery keeps answer keys private`);
    check(delivery.data.quiz.instructions===(original.quiz_payload.instructions||''),`${competition} ${original.stage_name}: participant instructions match stored content`);
    if(original.quiz_payload.dataset_csv)check(delivery.data.quiz.dataset_csv===original.quiz_payload.dataset_csv,'Data Detective delivers the complete CSV dataset');
   }
  }
 }finally{
  // Delete only IDs created by this invocation, never existing competition data.
  for(const id of quizzes){const r=await admin(`/rest/v1/quiz_drafts?id=eq.${id}`,{method:'DELETE'});if(r.status!==204)throw Error('QA quiz cleanup failed');}
  if(users.length){
   if(users.some(id=>!/^[-0-9a-f]{36}$/.test(id)))throw Error('Invalid QA cleanup ID');
   const ids=users.map(id=>`'${id}'`).join(',');
   const file=path.join('.private-backups',`cleanup-${nonce}.sql`);fs.mkdirSync(path.join(root,'.private-backups'),{recursive:true});
   if(qaTeams.some(id=>!/^[-0-9a-f]{36}$/.test(id)))throw Error('Invalid QA team cleanup ID');
   const emails=qaTeams.length?qaTeams.map(id=>`'team-${id}@ikarus.invalid'`).join(','):"''";
   fs.writeFileSync(path.join(root,file),`begin; delete from public.ikarus_audit_events where actor_id in (${ids}) or actor_id in(select id from auth.users where email in (${emails})); delete from auth.users where (id in (${ids}) and email like 'ikarus-qa-${nonce}-%@example.invalid') or email in (${emails}); ${qaTeams.length?`delete from public.teams where id in (${qaTeams.map(id=>`'${id}'`).join(',')}) and team_name='Portal QA Ticket ${nonce}';`:''} commit;`);
   execFileSync('npx.cmd',['--offline','--cache','.npm-cache','supabase','db','query','--linked','--project-ref',ref,'--file',file,'--output-format','json'],{cwd:root,shell:true,encoding:'utf8',stdio:['ignore','pipe','pipe']});
  }
  console.log('Temporary QA records cleaned up.');
 }
 console.log(`${passed} live acceptance checks passed.`);
 fs.writeFileSync(path.join(root,'.private-backups/live-acceptance-result.json'),JSON.stringify({passed,completed_at:new Date().toISOString(),qa_records_cleaned:true},null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
