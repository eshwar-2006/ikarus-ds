const {test}=require('node:test'),assert=require('node:assert/strict');
const {edge}=require('./helpers.cjs');
const codes=['TECHLIFT','DATAQUEST','AI_NEXUS'];
function data(){return {profiles:[{id:'president',role:'president'},...codes.map(c=>({id:c,role:'team',competition_code:c,team_id:'t-'+c,full_name:c})),...codes.map(c=>({id:'officer-'+c,role:'officer',competition_code:c}))],teams:codes.map(c=>({id:'t-'+c,team_name:c,competition_code:c,status:'registered'})),quiz_drafts:codes.flatMap(c=>[1,2,3].map(r=>({id:c+r,competition_code:c,title:c+' round '+r,stage_name:'Stage '+r,status:'published',duration_minutes:20,quiz_payload:{questions:[{position:1,type:'mcq',text:'Choose',marks:1,options:[{label:'A',text:'A'},{label:'B',text:'B'}],correct_answer:'A'}]}}))),quiz_attempts:[],round3_promotions:[],competition_winners:[]};}
test('each registered event gets only its three rounds and rejects every other event across quiz routes',async()=>{
 for(const c of codes){const db=data(),user={id:c};const list=await edge('list-published-quizzes',db,user)({competition_code:codes.find(x=>x!==c)});assert.equal(list.status,200);assert.equal(list.body.quizzes.length,3);assert.ok(list.body.quizzes.every(q=>q.competition_code===c));
 for(const other of codes.filter(x=>x!==c))for(const route of ['start-quiz','get-published-quiz','save-quiz-progress','submit-quiz'])for(const r of [1,2,3]){const res=await edge(route,db,user)({quiz_id:other+r,answers:{'1':'A'}});assert.equal(res.status,403,`${c} cannot use ${route} for ${other} round ${r}`);}
 const start=await edge('start-quiz',db,user)({quiz_id:c+1});assert.equal(start.status,200);assert.equal((await edge('submit-quiz',db,user)({quiz_id:c+1,answers:{'1':'A'}})).status,200);
 }
});
test('every leaderboard contains exactly its roster, with no orphan or foreign team scores',async()=>{
 const db=data();db.profiles.push({id:'orphan',role:'team',competition_code:'TECHLIFT',full_name:'Unregistered account'},{id:'wrong-link',role:'team',competition_code:'TECHLIFT',team_id:'t-DATAQUEST'});
 for(const p of db.profiles.filter(p=>p.role==='team'))db.quiz_attempts.push({quiz_id:'TECHLIFT1',user_id:p.id,status:'submitted',score:99,reviewed_score:null,manual_review_required:false});
 for(const c of codes){const result=await edge('live-scoreboard',db,{id:'president'})({competition_code:c});assert.equal(result.status,200);assert.deepEqual(result.body.rows.map(r=>r.team_key),['t-'+c]);assert.equal(result.body.rows[0].score,c==='TECHLIFT'?99:0);}
});
test('changed registration cannot list, start, fetch, save or submit stages from stale profile event',async()=>{
 const db=data();db.teams[0].competition_code='DATAQUEST';for(const route of ['list-published-quizzes','start-quiz','get-published-quiz','save-quiz-progress','submit-quiz'])assert.equal((await edge(route,db,{id:'TECHLIFT'})({quiz_id:'TECHLIFT1',answers:{'1':'A'}})).status,403,route);
});
test('each event officer sees and grades only their event submissions',async()=>{
 const db=data();for(const c of codes)db.quiz_attempts.push({id:'a-'+c,quiz_id:c+2,user_id:c,status:'submitted',score:0,manual_review_required:true,reviewed_score:null});
 for(const c of codes){const call=edge('manage-results',db,{id:'officer-'+c}),list=await call({action:'list'});assert.equal(list.status,200);assert.equal(list.body.attempts.length,1);assert.equal(list.body.attempts[0].competition_code,c);for(const other of codes.filter(x=>x!==c))assert.ok((await call({action:'grade',attempt_id:'a-'+other,reviewed_score:1})).status>=400);}
});

test('only President publication unlocks a draft round and records the event',async()=>{
 for(const c of codes){const db=data();db.quiz_drafts.find(q=>q.id===c+1).status='draft';
 const list=await edge('list-published-quizzes',db,{id:c})({});const locked=list.body.quizzes.find(q=>q.id===c+1);assert.equal(locked.can_start,false);assert.equal(locked.publication_status,'draft');assert.equal(JSON.stringify(locked).includes('correct_answer'),false);
 for(const route of ['start-quiz','get-published-quiz','save-quiz-progress','submit-quiz'])assert.ok((await edge(route,db,{id:c})({quiz_id:c+1,answers:{}})).status>=400);
 for(const id of [c,'officer-'+c])assert.equal((await edge('publish-quiz',db,{id})({quiz_id:c+1})).status,403);
 assert.equal((await edge('publish-quiz',db,{id:'president'})({quiz_id:c+1})).status,200);assert.equal(db.ikarus_audit_events[0].actor_id,'president');assert.equal(db.ikarus_audit_events[0].competition_code,c);
 assert.equal((await edge('start-quiz',db,{id:c})({quiz_id:c+1})).status,200);assert.equal((await edge('publish-quiz',db,{id:'president'})({quiz_id:c+1})).status,409);
 }
});
