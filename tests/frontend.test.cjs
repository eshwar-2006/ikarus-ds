const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {parseHTML}=require('linkedom');const {root,database}=require('./helpers.cjs');
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(setImmediate);};
function frontend(){
 const {window}=parseHTML(fs.readFileSync(path.join(root,'index.html'),'utf8'));const {document}=window;
 // Supply the small browser APIs absent from linkedom.
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.getAttribute('value')||this.querySelector('option')?.getAttribute('value')||'';},set(value){this.querySelectorAll('option').forEach(o=>{if(o.getAttribute('value')===String(value))o.setAttribute('selected','');else o.removeAttribute('selected');});}});
 for(const cls of [window.HTMLInputElement,window.HTMLTextAreaElement])cls.prototype.checkValidity=function(){return true;};
 const intervals=new Map();let id=0;const calls=[];
 const context=vm.createContext({document,window,console,Date,URL,CSS:{escape:value=>String(value)},location:{origin:'http://localhost',pathname:'/',hash:''},history:{replaceState(){}},setInterval:fn=>{intervals.set(++id,fn);return id;},clearInterval:id=>intervals.delete(id),setTimeout:()=>++id,clearTimeout(){},queueMicrotask,fetch:async()=>({ok:true,json:async()=>({results:[]})})});
 vm.runInContext(fs.readFileSync(path.join(root,'app.js'),'utf8'),context);
 const tables={quiz_drafts:[]};const client=database(tables);client.auth={signOut:async()=>({error:null})};client.functions={invoke:async(name,options)=>{calls.push({name,body:options.body});return {data:{success:true},error:null};}};
 context.__client=client;vm.runInContext('supabaseClient=__client',context);
 const click=element=>{assert.ok(element,'button exists');element.dispatchEvent(new window.Event('click'));};
 return {context,document,window,intervals,calls,tables,client,click};
}
test('restored team dashboard survives close and reopen',async()=>{
 const f=frontend();f.context.invokeIkarusFunction=async()=>({competition_code:'TECHLIFT',quizzes:[]});
 f.context.showDashboard({id:'team-1',role:'team',competition_code:'TECHLIFT',full_name:'Team One'},'team@example.test');await flush();
 const portal=f.document.querySelector('.team-portal');f.context.closeLogin();f.context.openLogin('team');assert.equal(f.document.getElementById('loginModal').hidden,false);assert.equal(f.document.querySelector('.team-portal'),portal);assert.equal(f.document.getElementById('username'),null);
});

test('transport failures use the authenticated portal route; permission failures do not',async()=>{
 const f=frontend();let calls=0;f.context.AbortSignal=AbortSignal;
 f.client.auth.getSession=async()=>({data:{session:{access_token:'team-token'}}});
 f.window.IKARUS_SUPABASE_PUBLISHABLE_KEY='public-key';
 f.client.functions.invoke=async()=>({data:null,error:{message:'Failed to send a request to the Edge Function'}});
 f.context.fetch=async(url,options)=>{calls++;assert.equal(url,'/api/submit-quiz');assert.equal(options.headers.Authorization,'Bearer team-token');assert.equal(JSON.parse(options.body).answers[1],'A');return {ok:true,json:async()=>({success:true})};};
 assert.equal((await f.context.invokeIkarusFunction('submit-quiz',{quiz_id:'q1',answers:{1:'A'}})).success,true);
 assert.equal(calls,1);
 f.client.functions.invoke=async()=>({data:null,error:{message:'Forbidden',context:{status:403}}});
 await assert.rejects(f.context.invokeIkarusFunction('submit-quiz',{}),/Forbidden/);assert.equal(calls,1);
});

test('offline submission preserves local answers and retries without another click',async()=>{
 const f=frontend(),host=f.document.createElement('div');f.document.body.append(host);let submits=0;
 const storage=new Map();f.window.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
 f.context.invokeIkarusFunction=async(name,body)=>{
  if(name==='list-published-quizzes')return {competition_code:'TECHLIFT',quizzes:[{id:'retry',title:'Coding',stage_name:'Stage 2',attempt_status:'not_started'}]};
  if(name==='start-quiz')return {quiz:{id:'retry',title:'Coding',competition_code:'TECHLIFT',stage_name:'Stage 2',questions:[{position:1,text:'Write code',type:'code',marks:10}]},deadline_at:new Date(Date.now()+600000).toISOString()};
  if(name==='submit-quiz'){assert.equal(body.answers[1],'my code');if(++submits===1)throw Error('Network unavailable');return {message:'Submitted',score:0,max_score:10};}
  return {success:true};
 };
 f.context.renderTeamPortal({id:'team-retry',competition_code:'TECHLIFT'},host);await flush();
 const button=text=>[...host.querySelectorAll('button')].find(b=>b.textContent===text);
 f.click(button('Start stage'));await flush();const field=host.querySelector('textarea');field.value='my code';host.querySelector('.quiz-question-list').dispatchEvent(new f.window.Event('input'));
 assert.ok([...storage.values()].some(v=>v.includes('my code')));
 f.click(button('Submit stage'));await flush();assert.equal(submits,1);
 const later=Date.now()+9000;f.context.Date=class extends Date{static now(){return later;}};
 for(const callback of [...f.intervals.values()])callback();await flush();
 assert.equal(submits,2);assert.match(host.textContent,/Stage submitted successfully/);assert.ok(![...storage.keys()].some(k=>k.startsWith('ikarus-answers:')));
});
test('deadline locks answers, automatically submits, and retries an interrupted expiry submission',async()=>{
 const f=frontend(),host=f.document.createElement('div');f.document.body.append(host);let submits=0,now=Date.now();
 f.context.Date=class extends Date{static now(){return now;}};
 f.context.invokeIkarusFunction=async(name)=>{
  if(name==='list-published-quizzes')return {competition_code:'TECHLIFT',quizzes:[{id:'expiry',title:'Quiz',stage_name:'Stage 1',attempt_status:'not_started'}]};
  if(name==='start-quiz')return {quiz:{id:'expiry',title:'Quiz',competition_code:'TECHLIFT',stage_name:'Stage 1',questions:[{position:1,text:'Choose',type:'mcq',marks:1,options:[{label:'A',text:'One'},{label:'B',text:'Two'}]}]},deadline_at:new Date(now+1000).toISOString()};
  if(name==='submit-quiz'){if(++submits===1)throw Error('Network unavailable');return {message:'Submitted',score:1,max_score:1};}
  return {success:true};
 };
 f.context.renderTeamPortal({id:'expiry-team',competition_code:'TECHLIFT'},host);await flush();f.click([...host.querySelectorAll('button')].find(b=>b.textContent==='Start stage'));await flush();
 now+=1100;for(const callback of [...f.intervals.values()])callback();await flush();
 assert.equal(submits,1);assert.equal(host.querySelector('.quiz-timer').textContent,'00:00');assert.ok([...host.querySelectorAll('input')].every(input=>input.disabled));
 now+=8100;for(const callback of [...f.intervals.values()])callback();await flush();
 assert.equal(submits,2);assert.match(host.textContent,/Stage submitted successfully/);
});

test('manual stage saves schedule, reuses its draft, then publishes',async()=>{
 const f=frontend(),host=f.document.createElement('div');f.document.body.append(host);
 f.context.renderQuizReview({id:'p1',role:'president'}, {competition:'TECHLIFT',stage:'Stage 1',path:'uploads/TECHLIFT/manual-stage.pdf'},[{text:'Pick one',type:'mcq',options:[{text:'First'},{text:'Second'}],correct_answer:'A',marks:0}],{pageCount:0,pagesWithText:0,answerKeyFound:true},host);
 const dates=host.querySelectorAll('input[type="datetime-local"]');assert.equal(dates.length,2);dates[0].value='2026-10-30T09:30';dates[1].value='2026-10-30T10:00';
 const buttons=()=>[...host.querySelectorAll('button')];f.click(buttons().find(b=>b.textContent==='Save Draft'));await flush();assert.equal(f.tables.quiz_drafts.length,1);assert.ok(f.tables.quiz_drafts[0].opens_at);assert.equal(f.tables.quiz_drafts[0].quiz_payload.questions[0].marks,0);
 f.click(buttons().find(b=>b.textContent==='Save Draft'));await flush();assert.equal(f.tables.quiz_drafts.length,1,'saving again must update same draft');
 f.click(buttons().find(b=>b.textContent==='Publish Quiz'));await flush();assert.equal(f.calls.filter(c=>c.name==='publish-quiz').length,1);assert.equal(f.tables.quiz_drafts.length,1);
});
test('roster parser handles official title rows and duplicate registration IDs',()=>{
 const f=frontend();const parsed=f.context.rowsToTeams([['Official registration list'],['Team Name','Ticket ID'],['Alpha','T1']],'techlift.xlsx');assert.equal(parsed[0].competition_code,'TECHLIFT');assert.throws(()=>f.context.rowsToTeams([['Team Name','Ticket ID'],['Alpha','T1'],['Beta','t1']],'techlift.xlsx'),/duplicate/);
});
test('failed submission keeps timer and autosave alive; success cleans both',async()=>{
 const f=frontend(),host=f.document.createElement('div');f.document.body.append(host);let submits=0;const baselineIntervals=f.intervals.size;
 f.context.invokeIkarusFunction=async(name)=>{
  if(name==='list-published-quizzes')return {competition_code:'TECHLIFT',quizzes:[{id:'q1',title:'Coding',competition_code:'TECHLIFT',stage_name:'Stage 2',duration_minutes:20,attempt_status:'not_started'}]};
  if(name==='start-quiz')return {quiz:{id:'q1',title:'Coding',competition_code:'TECHLIFT',stage_name:'Stage 2',questions:[{position:1,text:'Write code',type:'code',marks:10}]},server_now:new Date().toISOString(),deadline_at:new Date(Date.now()+60000).toISOString()};
  if(name==='submit-quiz'){if(++submits===1)throw Error('Network unavailable');return {message:'Submitted',score:0,max_score:10,manual_review_required:true};}
  return {success:true};
 };
 const button=text=>[...host.querySelectorAll('button')].find(b=>b.textContent===text);
 f.context.renderTeamPortal({role:'team',competition_code:'TECHLIFT'},host);await flush();f.click(button('Start stage'));await flush();assert.equal(host.querySelector('textarea').maxLength,30000);const count=f.intervals.size;
 f.click(button('Submit stage'));await flush();assert.match(host.textContent,/submission will retry automatically/);assert.equal(f.intervals.size,count,'timers survive failed submission');
 f.click(button('Retry submission'));await flush();assert.match(host.textContent,/Stage submitted successfully/);assert.equal(f.intervals.size,baselineIntervals+1,'only existing public timers and stage-result polling remain');
});
test('fullscreen quiz locks on focus loss and resumes without resetting deadline',async()=>{
 const f=frontend(),host=f.document.createElement('div');f.document.body.append(host);const calls=[];
 f.document.documentElement.requestFullscreen=async()=>{f.document.fullscreenElement=f.document.documentElement;};
 f.document.exitFullscreen=async()=>{f.document.fullscreenElement=null;};
 f.context.invokeIkarusFunction=async(name,body)=>{calls.push({name,body});if(name==='list-published-quizzes')return {competition_code:'TECHLIFT',quizzes:[{id:'q1',title:'Quiz',stage_name:'Stage 1',duration_minutes:20,attempt_status:'not_started'}]};if(name==='start-quiz')return {quiz:{id:'q1',title:'Quiz',competition_code:'TECHLIFT',stage_name:'Stage 1',questions:[{position:1,text:'Choose',type:'mcq',marks:1,options:[{label:'A',text:'First'},{label:'B',text:'Second'}]}]},server_now:new Date().toISOString(),deadline_at:new Date(Date.now()+60000).toISOString()};return {success:true};};
 f.context.renderTeamPortal({role:'team',competition_code:'TECHLIFT'},host);await flush();f.click([...host.querySelectorAll('button')].find(b=>b.textContent==='Start stage'));await flush();
 assert.ok(f.document.getElementById('loginModal').classList.contains('quiz-active'));assert.ok(f.document.fullscreenElement);
 const timer=host.querySelector('.quiz-timer').textContent;f.window.dispatchEvent(new f.window.Event('blur'));await flush();assert.equal(host.querySelector('.quiz-focus-guard').hidden,false);assert.equal(host.querySelector('.quiz-question-list').inert,true);assert.equal(calls.filter(c=>c.name==='report-quiz-event').length,1);
 f.context.closeLogin();assert.equal(f.document.getElementById('loginModal').hidden,false,'active quiz cannot be dismissed');
 f.click([...host.querySelectorAll('button')].find(b=>b.textContent==='Return to fullscreen quiz'));await flush();assert.equal(host.querySelector('.quiz-focus-guard').hidden,true);assert.equal(host.querySelector('.quiz-question-list').inert,false);assert.equal(host.querySelector('.quiz-timer').textContent,timer);assert.equal(calls.filter(c=>c.name==='start-quiz').length,1,'return must not restart the attempt');
});
test('team login shows the matched name before issuing a session',async()=>{
 const f=frontend();let confirmed=false;
 f.client.auth.setSession=async()=>{confirmed=true;return {data:{user:{id:'t1',email:'team@example.invalid'}},error:null};};
 f.context.loadProfile=async()=>{};
 f.context.invokeIkarusFunction=async(name,body)=>body.action==='lookup'?{matches:[{team_name:'Alpha Team',competition_code:'TECHLIFT',year_group:1,challenge:'signed'}]}:{session:{access_token:'access',refresh_token:'refresh'}};
 f.context.openLogin('team');f.document.getElementById('teamTicketId').value='TICKET-123';await f.document.getElementById('loginForm').onsubmit({preventDefault(){}});await flush();assert.match(f.document.getElementById('loginForm').textContent,/Alpha Team/);assert.equal(confirmed,false);f.click([...f.document.querySelectorAll('button')].find(b=>b.textContent.includes('Yes, this is my team')));await flush();assert.equal(confirmed,true);
});

test('event tabs clear previous teams immediately and ignore late responses from earlier tabs',async()=>{
 const f=frontend(),host=f.document.createElement('div');f.document.body.append(host);const pending=[];
 f.context.invokeIkarusFunction=(name,body)=>new Promise(resolve=>pending.push({body,resolve}));f.context.renderProjectorScoreboard({role:'president'},host);
 const result=(c,name)=>({competition_code:c,stage_name:'All-round points',max_score:100,updated_at:new Date().toISOString(),rows:[{team_key:c,team_name:name,round_scores:{},score:0,has_score:false,rank:null,status:'Not started'}]});
 pending[0].resolve(result('TECHLIFT','Tech team'));await flush();assert.match(host.textContent,/Tech team/);
 f.click(host.querySelector('[data-event="DATAQUEST"]'));assert.doesNotMatch(host.textContent,/Tech team/);
 f.click(host.querySelector('[data-event="AI_NEXUS"]'));pending[2].resolve(result('AI_NEXUS','AI team'));await flush();pending[1].resolve(result('DATAQUEST','Data team'));await flush();assert.match(host.textContent,/AI team/);assert.doesNotMatch(host.textContent,/Data team/);
});
test('qualification event switch ignores an older event preview arriving last',async()=>{
 const f=frontend(),host=f.document.createElement('div');f.document.body.append(host);const pending=[];f.context.invokeIkarusFunction=(name,body)=>new Promise(resolve=>pending.push({body,resolve}));f.context.renderQualificationConsole({role:'president'},host);
 const select=host.querySelector('select');select.value='DATAQUEST';select.dispatchEvent(new f.window.Event('change'));
 const result=name=>({preliminary:{candidates:[{team_name:name,score:100,elapsed_ms:1000}],tie:[],blocking:''},final:{candidates:[]}});
 pending[1].resolve(result('Data finalist'));await flush();pending[0].resolve(result('Tech finalist'));await flush();assert.match(host.textContent,/Data finalist/);assert.doesNotMatch(host.textContent,/Tech finalist/);
});

test('officers can save drafts but cannot see a round publish action',async()=>{
 const f=frontend(),host=f.document.createElement('div');f.document.body.append(host);
 f.context.renderQuizReview({id:'o1',role:'officer'},{competition:'TECHLIFT',stage:'Stage 1',path:'uploads/TECHLIFT/manual-stage.pdf'},[{text:'Choose',type:'mcq',options:[{text:'A'},{text:'B'}],correct_answer:'A',marks:1}],{pageCount:0,pagesWithText:0,answerKeyFound:true},host);
 assert.ok([...host.querySelectorAll('button')].some(b=>b.textContent==='Save Draft'));assert.ok(![...host.querySelectorAll('button')].some(b=>b.textContent.includes('Publish')));
});

test('manual round editor retains judge guide and participant instructions when saved',async()=>{
 const f=frontend(),host=f.document.createElement('div');f.document.body.append(host);
 const existing={id:'manual-round',title:'Tech Mission',duration_minutes:60,quiz_payload:{instructions:'Complete the mission',organizer_reference:'Private marking rubric',source_sha256:'source-hash',questions:[]}};f.tables.quiz_drafts.push({...existing,status:'draft'});
 f.context.renderQuizReview({id:'p1',role:'president'},{competition:'TECHLIFT',stage:'Stage 3',path:'uploads/TECHLIFT/mission.pdf'},[{text:'Predict output',type:'subjective',options:[],correct_answer:'3\n3',marks:10}],{pageCount:0,pagesWithText:0,answerKeyFound:false},host,existing);
 assert.doesNotMatch(host.textContent,/No answer key was detected/);assert.match(host.textContent,/Manually judged round/);assert.match(host.textContent,/Private marking rubric/);
 f.click([...host.querySelectorAll('button')].find(b=>b.textContent==='Save Draft'));await flush();assert.equal(f.tables.quiz_drafts[0].quiz_payload.instructions,'Complete the mission');assert.equal(f.tables.quiz_drafts[0].quiz_payload.organizer_reference,'Private marking rubric');assert.equal(f.tables.quiz_drafts[0].quiz_payload.questions[0].correct_answer,'3\n3');
});

test('round manager separates competitions, orders rounds and keeps actions on the selected event',async()=>{
 const f=frontend(),host=f.document.createElement('div');f.document.body.append(host);
 for(const code of ['TECHLIFT','DATAQUEST','AI_NEXUS'])for(const n of [3,1,2])f.tables.quiz_drafts.push({id:code+n,competition_code:code,title:code+' - Stage '+n+' - Task '+n,stage_name:'Stage '+n,status:code==='TECHLIFT'&&n===3?'published':'draft',duration_minutes:20,quiz_payload:{questions:[]}});
 f.context.renderDraftManager({role:'president'},host);await flush();const cards=()=>[...host.querySelectorAll('.round-manager-card')];assert.deepEqual(cards().map(c=>c.dataset.round),['Stage 1','Stage 2','Stage 3']);assert.equal(cards().length,3);assert.equal(host.querySelectorAll('.round-card-actions button').length,4);assert.match(cards()[2].textContent,/Published/);
 f.click(host.querySelector('[data-event="DATAQUEST"]'));assert.equal(cards().length,3);assert.equal(host.querySelectorAll('.round-card-actions button').length,6);f.click(cards()[1].querySelector('.btn-primary'));await flush();assert.equal(f.calls.at(-1).body.quiz_id,'DATAQUEST2');
 f.click(host.querySelector('[data-event="AI_NEXUS"]'));f.click([...host.querySelectorAll('button')].find(b=>b.textContent==='Create draft'));assert.match(host.querySelector('.quiz-review-host').textContent,/AI_NEXUS/);
});

test('question navigation retains answers and review marks across resume and submits every question',async()=>{
 const f=frontend(),host=f.document.createElement('div');f.document.body.append(host);
 const storage=new Map();f.window.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
 const deadline=new Date(Date.now()+600000).toISOString();let submitted;
 f.context.invokeIkarusFunction=async(name,body)=>{
  if(name==='list-published-quizzes')return {competition_code:'TECHLIFT',quizzes:[{id:'navigation',title:'Quiz',competition_code:'TECHLIFT',stage_name:'Stage 1',attempt_status:'in_progress'}]};
  if(name==='start-quiz')return {quiz:{id:'navigation',title:'Quiz',competition_code:'TECHLIFT',stage_name:'Stage 1',duration_minutes:10,questions:[{position:2,type:'mcq',text:'First question',marks:1,options:[{label:'A',text:'Alpha'},{label:'B',text:'Beta'}]},{position:4,type:'subjective',text:'Second question',marks:2},{position:8,type:'true_false',text:'Third question',marks:1,options:[]}]},deadline_at:deadline,saved_answers:{2:'A'}};
  if(name==='submit-quiz'){submitted=body.answers;return {message:'Done',score:3,max_score:4,manual_review_required:true};}
  return {success:true};
 };
 const click=text=>f.click([...host.querySelectorAll('button')].find(b=>b.textContent===text));
 const visible=()=>[...host.querySelectorAll('.quiz-question')].filter(q=>!q.hidden);
 f.context.renderTeamPortal({id:'team-navigation',role:'team',competition_code:'TECHLIFT'},host);await flush();click('Resume attempt');await flush();
 assert.equal(visible().length,1);assert.match(visible()[0].textContent,/First question/);assert.ok(host.querySelector('.quiz-paging button').disabled);
 click('Mark for review');assert.equal(host.querySelector('.question-number').getAttribute('aria-label'),'Question 1: Answered, marked for review');
 click('Next');assert.match(visible()[0].textContent,/Second question/);const area=host.querySelector('textarea');area.value='Written answer';area.dispatchEvent(new f.window.Event('input',{bubbles:true}));
 assert.equal(host.querySelectorAll('.question-number.is-answered').length,2);click('Previous');assert.ok(host.querySelector('input[value="A"]').checked);click('Next');assert.equal(area.value,'Written answer');
 click('Mark for review');assert.equal(host.querySelectorAll('.question-number.is-review').length,2);
 f.context.renderTeamPortal({id:'team-navigation',role:'team',competition_code:'TECHLIFT'},host);await flush();click('Resume attempt');await flush();
 assert.match(visible()[0].textContent,/Second question/);assert.equal(host.querySelectorAll('.question-number.is-review').length,2);click('Unmark review');assert.equal(host.querySelectorAll('.question-number.is-review').length,1);
 host.querySelector('textarea').value='Final answer';host.querySelector('textarea').dispatchEvent(new f.window.Event('input',{bubbles:true}));click('Next');assert.ok([...host.querySelectorAll('.quiz-paging button')].find(b=>b.textContent==='Next').disabled);
 const radio=host.querySelector('input[name="q-8"][value="True"]');radio.checked=true;radio.dispatchEvent(new f.window.Event('input',{bubbles:true}));click('Submit stage');await flush();
 assert.deepEqual(JSON.parse(JSON.stringify(submitted)),{2:'A',4:'Final answer',8:'True'});assert.equal(storage.size,0);assert.match(host.textContent,/Stage submitted successfully/);
});

test('public leaderboard refreshes published scores, avoids overlapping reads and retains results on outages',async()=>{
 const f=frontend();f.document.getElementById('loginModal').hidden=true;await flush();let resolveRead,reads=0;
 f.context.fetch=()=>{reads++;return new Promise(resolve=>{resolveRead=resolve;});};
 const first=f.context.loadPublicResults();await f.context.loadPublicResults();assert.equal(reads,1);
 const payload=score=>({ok:true,json:async()=>({results:[{competition_code:'TECHLIFT',stage_name:'Stage 1',title:'Published quiz',results:[{rank:1,participant_name:'Team Alpha',score,max_score:100}]}]})});
 resolveRead(payload(60));await first;assert.match(f.document.getElementById('publicResults').textContent,/60\/100/);
 f.context.fetch=async()=>payload(75);await f.context.loadPublicResults();assert.match(f.document.getElementById('publicResults').textContent,/75\/100/);
 f.context.fetch=async()=>{throw Error('Offline');};await f.context.loadPublicResults();assert.match(f.document.getElementById('publicResults').textContent,/75\/100/);
});

test('judging selects one team, retains separate drafts and saves only the selected submission',async()=>{
 const f=frontend(),host=f.document.createElement('div');f.document.body.append(host);
 const attempts=['Alpha','Beta'].map((name,i)=>({id:name,competition_code:'TECHLIFT',stage_name:'Stage 2',status:'submitted',quiz_title:'Coding',participant_name:name,manual_review_required:true,reviewed_score:null,score:0,max_score:100,questions:[{position:1,type:'code',text:'Solve task'}],answers:{1:name+' code'}}));let reject=false;const saved=[];
 f.context.invokeIkarusFunction=async(name,body)=>{if(body.action==='list')return {attempts};if(body.action==='grade'){if(reject)throw Error('Save failed');saved.push(body);Object.assign(attempts.find(a=>a.id===body.attempt_id),{reviewed_score:Object.values(body.section_scores).reduce((n,v)=>n+v,0),section_scores:body.section_scores,reviewer_notes:body.reviewer_notes,status:'reviewed'});return {success:true};}};
 f.context.renderResultsConsole({role:'president'},host);await flush();
 const click=text=>f.click([...host.querySelectorAll('button')].find(b=>b.textContent===text));
 const edit=(selector,value)=>{const input=host.querySelector(selector);input.value=value;input.dispatchEvent(new f.window.Event('input',{bubbles:true}));};
 assert.equal(host.querySelectorAll('.judging-team-option').length,2);assert.equal(host.querySelectorAll('.result-card').length,1);assert.match(host.querySelector('.result-card').textContent,/Alpha code/);assert.ok(host.querySelector('.submission-responses').open);
 edit('.result-score','78');edit('.result-notes','Alpha review');click('Next team');assert.match(host.querySelector('.result-card').textContent,/Beta code/);assert.equal(host.querySelector('.result-score').value,'');
 edit('.result-score','25');click('Previous team');assert.equal(host.querySelector('.result-score').value,'78');assert.equal(host.querySelector('.result-notes').value,'Alpha review');click('Save grade');await flush();
 assert.equal(saved.length,1);assert.equal(saved[0].attempt_id,'Alpha');assert.equal(saved[0].section_scores['1:total'],78);assert.equal(attempts[1].reviewed_score,null);assert.equal(host.querySelector('.judging-team-option[aria-current="true"]').dataset.attempt,'Alpha');
 edit('.result-score','80');assert.equal(host.querySelector('.grade-approve').disabled,true);edit('.result-score','78');assert.equal(host.querySelector('.grade-approve').disabled,false);
 click('Next team');assert.equal(host.querySelector('.result-score').value,'25');reject=true;click('Save grade');await flush();assert.equal(host.querySelector('.result-score').disabled,false);assert.equal(host.querySelector('.result-score').value,'25');assert.match(host.textContent,/Save failed/);
 click('Previous team');click('Next team');assert.equal(host.querySelector('.result-score').value,'25');
 reject=false;click('Save grade');await flush();assert.equal(saved[1].attempt_id,'Beta');assert.equal(attempts[0].reviewed_score,78);assert.equal(attempts[1].reviewed_score,25);
});

test('manual rounds show every section and preserve document and video URLs in submitted responses',async()=>{
 const f=frontend(),host=f.document.createElement('div');f.document.body.append(host);let submitted;
 const original='Presentation response\n\nGoogle Drive folder: https://drive.google.com/drive/folders/example\n\nPresentation video: https://youtu.be/example';
 f.context.invokeIkarusFunction=async(name,body)=>{if(name==='list-published-quizzes')return {competition_code:'DATAQUEST',quizzes:[{id:'manual-sections',title:'Data Detective',stage_name:'Stage 3',attempt_status:'not_started'}]};if(name==='start-quiz')return {quiz:{id:'manual-sections',competition_code:'DATAQUEST',stage_name:'Stage 3',title:'Data Detective',duration_minutes:60,questions:[{position:1,type:'activity',section_title:'Analysis',text:'Analyze the data',marks:80},{position:2,type:'activity',section_title:'Presentation',text:'Present findings',marks:20,marking_criteria:[{label:'Presentation and Q&A',marks:20}],requires_evidence_link:true,requires_video_link:true}]},saved_answers:{2:original},deadline_at:new Date(Date.now()+600000).toISOString()};if(name==='submit-quiz'){submitted=body.answers;return {message:'Done',score:null,max_score:100,manual_review_required:true};}return {};};
 f.context.renderTeamPortal({id:'manual-team',role:'team',competition_code:'DATAQUEST'},host);await flush();f.click([...host.querySelectorAll('button')].find(b=>b.textContent==='Start stage'));await flush();
 assert.equal([...host.querySelectorAll('.quiz-question')].filter(q=>!q.hidden).length,2);assert.equal(host.querySelector('.quiz-paging').hidden,true);assert.match(host.textContent,/Presentation and Q&A - 20 marks/);
 assert.equal(host.querySelector('textarea[data-position="2"]').value,'Presentation response');assert.equal(host.querySelector('[data-kind="documents"]').value,'https://drive.google.com/drive/folders/example');assert.equal(host.querySelector('[data-kind="video"]').value,'https://youtu.be/example');
 f.click([...host.querySelectorAll('button')].find(b=>b.textContent==='Submit stage'));await flush();assert.equal(submitted[2],original);
});

test('judges enter marks beside each answer and cannot save an incomplete allocation',async()=>{
 const f=frontend(),host=f.document.createElement('div');f.document.body.append(host);let grade;
 const attempt={id:'sections',competition_code:'TECHLIFT',stage_name:'Stage 3',participant_name:'Team Sections',quiz_title:'Tech Mission',status:'submitted',score:0,max_score:30,manual_review_required:true,reviewed_score:null,questions:[{position:3,type:'code',text:'Explain errors and fix code',marks:30,section_title:'Debugging'}],answers:{3:'Explanation and code\n\nGoogle Drive folder: https://drive.google.com/drive/folders/example'},grading_sections:[{position:3,title:'Debugging',marks:30,instructions:'Private evaluation guidance',criteria:[{key:'3:explanation',label:'Error explanation',marks:15,guidance:'Check identified errors'},{key:'3:code',label:'Corrected code',marks:15,guidance:'Check corrected program'}]}]};
 f.context.invokeIkarusFunction=async(name,body)=>{if(body.action==='list')return {attempts:[attempt]};grade=body;Object.assign(attempt,{status:'reviewed',reviewed_score:Object.values(body.section_scores).reduce((n,v)=>n+v,0),section_scores:body.section_scores});return {reviewed_score:attempt.reviewed_score};};
 f.context.renderResultsConsole({role:'president'},host);await flush();const fields=host.querySelectorAll('.judge-answer-section .section-score');assert.equal(fields.length,2);assert.match(host.querySelector('.judge-answer-section').textContent,/Private evaluation guidance/);assert.equal(host.querySelector('.judge-evidence-links a').getAttribute('href'),'https://drive.google.com/drive/folders/example');
 const fill=(input,value)=>{input.value=value;input.dispatchEvent(new f.window.Event('input',{bubbles:true}));};const save=()=>f.click([...host.querySelectorAll('button')].find(b=>b.textContent==='Save grade'));
 fill(fields[0],'10');save();await flush();assert.equal(grade,undefined);assert.match(host.textContent,/Enter valid marks for every section/);fill(fields[1],'12');assert.match(host.querySelector('.section-calculated-total').textContent,/22 \/ 30/);save();await flush();assert.equal(grade.section_scores['3:explanation'],10);assert.equal(grade.section_scores['3:code'],12);assert.equal(grade.reviewed_score,undefined);assert.equal(attempt.reviewed_score,22);
});

test('split manual responses restore each part and keep evidence links with the final submission',async()=>{
 const f=frontend(),host=f.document.createElement('div');f.document.body.append(host);let saved;
 const response='--- Section: explanation ---\nIdentified errors\n\n--- Section: code ---\nprint(1)\n\nGoogle Drive folder: https://drive.google.com/folder\n\nPresentation video: https://youtu.be/demo';
 f.context.invokeIkarusFunction=async(name,body)=>{if(name==='list-published-quizzes')return {competition_code:'TECHLIFT',quizzes:[{id:'parts',title:'Mission',stage_name:'Stage 3',attempt_status:'not_started'}]};if(name==='start-quiz')return {quiz:{id:'parts',title:'Mission',competition_code:'TECHLIFT',stage_name:'Stage 3',questions:[{position:3,type:'code',text:'Explain and fix',marks:30,response_parts:[{key:'explanation',label:'Explanation',marks:15,type:'subjective'},{key:'code',label:'Corrected code',marks:15,type:'code'}],requires_evidence_link:true,requires_video_link:true}]},saved_answers:{3:response},deadline_at:new Date(Date.now()+600000).toISOString()};if(name==='submit-quiz'){saved=body.answers;return {message:'Saved',score:null,max_score:30,manual_review_required:true};}return {};};
 f.context.renderTeamPortal({role:'team',competition_code:'TECHLIFT'},host);await flush();f.click([...host.querySelectorAll('button')].find(b=>b.textContent==='Start stage'));await flush();assert.equal(host.querySelector('textarea[data-part="explanation"]').value,'Identified errors');assert.equal(host.querySelector('textarea[data-part="code"]').value,'print(1)');f.click([...host.querySelectorAll('button')].find(b=>b.textContent==='Submit stage'));await flush();assert.equal(saved[3],response);
});
