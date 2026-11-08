const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {root,loadTS,edge}=require('./helpers.cjs');
const {scoreQuestions,validateQuestions,validAnswers,publicQuiz}=loadTS(path.join(root,'supabase/functions/_shared/quiz.ts'));
const objective={position:1,text:'Choose a language',type:'mcq',marks:2,options:[{label:'A',text:'Python'},{label:'B',text:'CSS'}],correct_answer:'A'};
const quiz=()=>({id:'quiz-1',title:'Test stage',stage_name:'Stage 1',competition_code:'TECHLIFT',duration_minutes:20,status:'published',quiz_payload:{questions:[structuredClone(objective)]},opens_at:null,closes_at:null});
const tables=()=>({profiles:[{id:'team-1',role:'team',competition_code:'TECHLIFT',full_name:'Team One'}],quiz_drafts:[quiz()],quiz_attempts:[],ikarus_audit_events:[]});
test('objective scoring accepts labels and text; unanswered questions earn no marks',()=>{
 assert.equal(scoreQuestions([objective],{}).score,0);assert.equal(scoreQuestions([objective],{'1':'a'}).score,2);assert.equal(scoreQuestions([objective],{'1':'Python'}).score,2);assert.equal(scoreQuestions([objective],{'1':'B'}).score,0);
 assert.equal(scoreQuestions([{...objective,correct_answer:''}],{}).score,0);
});
test('mixed objective and manual rounds retain automatic subtotal',()=>{
 const result=scoreQuestions([objective,{position:2,type:'code',marks:10}],{'1':'A','2':'print(1)'});assert.equal(result.score,2);assert.equal(result.max_score,12);assert.equal(result.manual_review_required,true);
});
test('publishing rejects ambiguous positions and invalid answer keys',()=>{
 assert.equal(validateQuestions([objective]),null);assert.match(validateQuestions([objective,objective]),/unique/);assert.match(validateQuestions([{...objective,correct_answer:'Z'}]),/match an option/);assert.match(validateQuestions([{...objective,type:'arbitrary'}]),/unsupported/);
});
test('code length and answer shape match browser limits',()=>{
 assert.equal(validAnswers({'1':'x'.repeat(30000)}),true);assert.equal(validAnswers({'1':'x'.repeat(30001)}),false);for(const answers of [null,[],{'1':{}},{'1':true},{wrong:'A'}])assert.equal(validAnswers(answers),false);
});
test('start, resume, save, submit and duplicate rejection work end to end',async()=>{
 const db=tables();const start=edge('start-quiz',db),save=edge('save-quiz-progress',db),submit=edge('submit-quiz',db);
 const first=await start({quiz_id:'quiz-1'});assert.equal(first.status,200);assert.ok(first.body.server_now);assert.equal(JSON.stringify(first.body).includes('correct_answer'),false);
 assert.equal((await save({quiz_id:'quiz-1',answers:{'1':'A'}})).status,200);
 const resumed=await start({quiz_id:'quiz-1'});assert.equal(resumed.body.resumed,true);assert.equal(resumed.body.saved_answers['1'],'A');assert.equal(db.quiz_attempts.length,1);
 const result=await submit({quiz_id:'quiz-1',answers:{'1':'A'}});assert.equal(result.status,200);assert.equal(result.body.score,2);
 assert.equal((await submit({quiz_id:'quiz-1',answers:{'1':'B'}})).status,409);assert.equal((await save({quiz_id:'quiz-1',answers:{'1':'B'}})).status,409);assert.equal((await start({quiz_id:'quiz-1'})).status,409);
});
test('expired attempts resume after scheduled close and submit only autosaved answers',async()=>{
 const db=tables();db.quiz_drafts[0].closes_at=new Date(Date.now()-1000).toISOString();db.quiz_attempts.push({id:'attempt-1',quiz_id:'quiz-1',user_id:'team-1',status:'in_progress',deadline_at:new Date(Date.now()-1000).toISOString(),answers:{'1':'B'}});
 assert.equal((await edge('start-quiz',db)({quiz_id:'quiz-1'})).status,200);
 assert.equal((await edge('save-quiz-progress',db)({quiz_id:'quiz-1',answers:{'1':'A'}})).status,409);
 const submitted=await edge('submit-quiz',db)({quiz_id:'quiz-1',answers:{'1':'A'}});assert.equal(submitted.status,200);assert.equal(submitted.body.score,0);assert.equal(db.quiz_attempts[0].answers['1'],'B');
});
test('all authenticated endpoints reject missing identity and handle browser preflight',async()=>{
 for(const name of ['start-quiz','submit-quiz','save-quiz-progress','get-published-quiz','list-published-quizzes','publish-quiz','manage-results','manage-accounts','report-quiz-event','live-scoreboard']){const call=edge(name,tables());assert.equal((await call({},'POST',null)).status,401,name);const preflight=await call(null,'OPTIONS',null);assert.equal(preflight.status,200,name);assert.match(preflight.headers.get('access-control-allow-headers'),/x-client-info/,name);}
});
test('cross-competition access and early starts are denied',async()=>{
 const db=tables();db.quiz_drafts[0].competition_code='DATAQUEST';assert.equal((await edge('start-quiz',db)({quiz_id:'quiz-1'})).status,403);
 db.quiz_drafts[0].competition_code='TECHLIFT';db.quiz_drafts[0].opens_at=new Date(Date.now()+60000).toISOString();assert.equal((await edge('start-quiz',db)({quiz_id:'quiz-1'})).status,403);
});
test('manual results require grading, president approval, and publication',async()=>{
 const db=tables();db.profiles[0].role='president';db.quiz_drafts[0].quiz_payload.questions=[{position:1,type:'code',text:'Code',marks:10}];db.quiz_attempts.push({id:'a1',quiz_id:'quiz-1',user_id:'team-1',status:'submitted',manual_review_required:true,max_score:10,reviewed_score:null,answers:{}});const call=edge('manage-results',db);
 assert.equal((await call({action:'approve',attempt_id:'a1'})).status,409);assert.equal((await call({action:'grade',attempt_id:'a1',reviewed_score:''})).status,400);
 assert.equal((await call({action:'grade',attempt_id:'a1',section_scores:{'1:total':8}})).status,200);assert.equal((await call({action:'approve',attempt_id:'a1'})).status,200);assert.equal((await call({action:'publish',attempt_id:'a1'})).status,200);assert.equal(db.quiz_attempts[0].status,'published');
});
test('officers cannot approve results or provision accounts',async()=>{
 const db=tables();db.profiles[0].role='officer';assert.equal((await edge('manage-results',db)({action:'approve',attempt_id:'a1'})).status,403);assert.equal((await edge('manage-accounts',db)({})).status,403);
});
test('judge list includes question context and saved answers, excludes active attempts',async()=>{
 const db=tables();db.profiles[0].role='officer';db.quiz_attempts.push({id:'a1',quiz_id:'quiz-1',user_id:'team-1',status:'submitted',answers:{'1':'A'}},{id:'a2',quiz_id:'quiz-1',user_id:'team-1',status:'in_progress'});const response=await edge('manage-results',db)({action:'list'});assert.equal(response.status,200);assert.equal(response.body.attempts.length,1);assert.equal(response.body.attempts[0].questions[0].text,objective.text);assert.equal(response.body.attempts[0].answers['1'],'A');
});
test('null request bodies return validation errors rather than crashing',async()=>{
 for(const name of ['start-quiz','submit-quiz','save-quiz-progress','get-published-quiz'])assert.equal((await edge(name,tables())(null)).status,400,name);
});
test('focus events can only be recorded against the authenticated account active attempt',async()=>{
 const db=tables(),call=edge('report-quiz-event',db);
 assert.equal((await call({quiz_id:'quiz-1',reason:'tab_hidden'})).status,409);
 db.quiz_attempts.push({id:'a1',quiz_id:'quiz-1',user_id:'someone-else',status:'in_progress'});
 assert.equal((await call({quiz_id:'quiz-1',reason:'tab_hidden'})).status,409);
 db.quiz_attempts[0].user_id='team-1';
 assert.equal((await call({quiz_id:'quiz-1',reason:'tab_hidden'})).status,200);
 assert.equal(db.ikarus_audit_events[0].actor_id,'team-1');assert.equal(db.ikarus_audit_events[0].details.reason,'tab_hidden');
 assert.equal((await call({quiz_id:'quiz-1',reason:'arbitrary'})).status,400);
});
test('public stage delivery exposes instructions and dataset but excludes private judging fields',()=>{
 const q=quiz();q.quiz_payload.instructions='Public brief';q.quiz_payload.dataset_csv='x,y\n1,2';q.quiz_payload.dataset_filename='data.csv';q.quiz_payload.organizer_reference='SECRET';q.quiz_payload.organizer_notes='PRIVATE';q.quiz_payload.verified_metrics={answer:42};
 const delivered=publicQuiz(q);assert.equal(delivered.instructions,'Public brief');assert.equal(delivered.dataset_filename,'data.csv');assert.equal(JSON.stringify(delivered).includes('SECRET'),false);assert.equal(JSON.stringify(delivered).includes('PRIVATE'),false);assert.equal(JSON.stringify(delivered).includes('correct_answer'),false);
});
test('ticket login requires confirmation, rejects tampering, and reuses one team identity',async()=>{
 const db=tables();db.teams=[{id:'t1',team_name:'Registered Team',registration_number:'TICKET-001',competition_code:'TECHLIFT',status:'registered'}];const call=edge('ticket-login',db);
 assert.equal((await call({action:'lookup',ticket_id:'bad-ticket'})).status,404);
 const lookup=await call({action:'lookup',ticket_id:' ticket-001 '});assert.equal(lookup.status,200);assert.equal(lookup.body.matches[0].team_name,'Registered Team');assert.equal(lookup.body.session,undefined);assert.equal(JSON.stringify(lookup.body).includes('registration_number'),false);
 const challenge=lookup.body.matches[0].challenge;assert.equal((await call({action:'confirm',challenge:challenge+'x'})).status,401);
 const confirmed=await call({action:'confirm',challenge});assert.equal(confirmed.status,200);assert.ok(confirmed.body.session.access_token);assert.equal(db.profiles.find(p=>p.id==='ticket-user').team_id,'t1');
 await call({action:'confirm',challenge});assert.equal(db.profiles.filter(p=>p.team_id==='t1').length,1);
 db.teams[0].status='disqualified';assert.equal((await call({action:'confirm',challenge})).status,403);
});
test('only President can register spot teams and see live scoreboard; pending grades are distinct',async()=>{
 const db=tables();db.teams=[{id:'t1',team_name:'Team One',competition_code:'TECHLIFT',status:'registered'}];db.profiles[0].team_id='t1';
 assert.equal((await edge('live-scoreboard',db)({competition_code:'TECHLIFT'})).status,403);
 assert.equal((await edge('manage-accounts',db)({action:'create_team',team_name:'Spot',competition_code:'TECHLIFT',members:[]})).status,403);
 db.profiles.push({id:'president',role:'president'});const spot=edge('manage-accounts',db,{id:'president'});const created=await spot({action:'create_team',team_name:'Spot',competition_code:'TECHLIFT',members:['Lead']});assert.equal(created.status,200);assert.match(created.body.team.ticket_id,/^IK26-/);
 db.quiz_attempts.push({id:'a1',quiz_id:'quiz-1',user_id:'team-1',status:'submitted',score:0,manual_review_required:true,reviewed_score:null});
 const response=await edge('live-scoreboard',db,{id:'president'})({competition_code:'TECHLIFT'});assert.equal(response.status,200);const row=response.body.rows.find(r=>r.team_name==='Team One');assert.equal(row.status,'Awaiting judging');assert.equal(row.has_score,false);assert.equal(JSON.stringify(response.body).includes('registration_number'),false);
});
test('expired saved answers are finalized and ranked when results are read',async()=>{
 const db=tables();db.quiz_attempts.push({id:'expired',quiz_id:'quiz-1',user_id:'team-1',status:'in_progress',deadline_at:new Date(Date.now()-1000).toISOString(),started_at:new Date(Date.now()-60000).toISOString(),answers:{'1':'A'}});
 const result=await edge('list-published-quizzes',db)({});assert.equal(result.status,200);assert.equal(db.quiz_attempts[0].status,'submitted');assert.equal(result.body.quizzes[0].score,2);assert.equal(result.body.quizzes[0].rank,1);assert.equal(db.ikarus_audit_events[0].action,'quiz_expired_submitted');
});

test('section grading validates each criterion and stores a server-calculated total with automatic marks',async()=>{
 const db=tables();db.profiles[0].role='president';db.quiz_drafts[0].quiz_payload.questions=[objective,{position:2,type:'code',text:'Debug',marks:8,grading_instructions:'PRIVATE GUIDE',grading_criteria:[{key:'reason',label:'Explanation',marks:3,guidance:'PRIVATE CRITERION'},{key:'code',label:'Corrected code',marks:5}]}];db.quiz_attempts.push({id:'sections',quiz_id:'quiz-1',user_id:'team-1',status:'submitted',max_score:10,score:2,manual_review_required:true,reviewed_score:null,answers:{1:'A',2:'Submitted code'}});const call=edge('manage-results',db);
 for(const scores of [undefined,{}, {'2:reason':1}, {'2:reason':1,'2:code':6},{'2:reason':-1,'2:code':4},{'2:reason':'1','2:code':4},{'2:reason':1,'2:code':4,unknown:0}])assert.equal((await call({action:'grade',attempt_id:'sections',section_scores:scores})).status,400);
 const result=await call({action:'grade',attempt_id:'sections',reviewed_score:999,section_scores:{'2:reason':1,'2:code':4},reviewer_notes:'Reviewed sections'});assert.equal(result.status,200);assert.equal(result.body.reviewed_score,7);assert.equal(db.quiz_attempts[0].reviewed_score,7);assert.equal(db.quiz_attempts[0].section_scores['2:code'],4);assert.equal(db.ikarus_audit_events[0].details.section_scores['2:reason'],1);
 const list=await call({action:'list'});assert.equal(list.body.attempts[0].grading_sections[0].instructions,'PRIVATE GUIDE');assert.equal(list.body.attempts[0].grading_sections[0].criteria[0].guidance,'PRIVATE CRITERION');
 const publicData=publicQuiz(db.quiz_drafts[0]);assert.equal(publicData.questions[1].marking_criteria[0].marks,3);assert.equal(JSON.stringify(publicData).includes('PRIVATE'),false);
 assert.match(validateQuestions([{position:1,text:'Bad allocation',type:'activity',marks:10,grading_criteria:[{key:'a',label:'A',marks:9}]}]),/add up/);
});
