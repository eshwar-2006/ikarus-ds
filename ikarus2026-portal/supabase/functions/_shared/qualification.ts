export const isRound3=(stage:string)=>/^(?:stage|round)\s*3$/i.test(stage.trim());
export const isPreliminary=(stage:string)=>/^(?:stage|round)\s*[12]$/i.test(stage.trim());
export function accessFromState(quiz:any,userId:string,teamId:string|null,promotion:any,winner:any){
 if(isRound3(quiz.stage_name||'')){
  if(winner)return {allowed:false,message:'Round 3 is closed. The competition winner has been declared.'};
  if(!promotion)return {allowed:false,message:'Round 3 is locked until the President confirms the top five teams from Rounds 1 and 2.'};
  const qualified=(promotion.finalists||[]).some((f:any)=>teamId&&f.team_id===teamId||(f.user_ids||[]).includes(userId));
  return {allowed:qualified,message:qualified?'Qualified for Round 3':'Only the confirmed top five teams from Rounds 1 and 2 are eligible for Round 3.'};
 }
 return {allowed:!(promotion&&isPreliminary(quiz.stage_name||'')),message:promotion&&isPreliminary(quiz.stage_name||'')?'Rounds 1 and 2 are closed. The finalists have been confirmed.':''};
}
export async function roundAccess(admin:any,quiz:any,userId:string){
 const {data:registrationProfile,error:registrationError}=await admin.from('profiles').select('team_id,competition_code').eq('id',userId).single();
 if(registrationError)throw new Error('Could not verify event registration');
 if(!registrationProfile||registrationProfile.competition_code!==quiz.competition_code)return {allowed:false,message:'This stage is not assigned to your registered event.'};
 if(registrationProfile.team_id){
  const {data:team,error}=await admin.from('teams').select('competition_code,status').eq('id',registrationProfile.team_id).maybeSingle();
  if(error)throw new Error('Could not verify event registration');
  if(!team||team.competition_code!==quiz.competition_code||!['registered','checked_in'].includes(team.status))return {allowed:false,message:'Your event registration has changed. Sign in again with your ticket ID or contact your event officer.'};
 }
 if(!isRound3(quiz.stage_name||'')&&!isPreliminary(quiz.stage_name||''))return {allowed:true,message:''};
 const {data:promotion,error}=await admin.from('round3_promotions').select('finalists,created_at').eq('competition_code',quiz.competition_code).maybeSingle();
 if(error)throw new Error('Could not verify round qualification');
 if(!isRound3(quiz.stage_name))return {allowed:!promotion,message:promotion?'Rounds 1 and 2 are closed. Round 3 finalists have been confirmed.':''};
 if(!promotion)return {allowed:false,message:'Round 3 is locked until the President confirms the top five teams from Rounds 1 and 2.'};
 const {data:winner,error:we}=await admin.from('competition_winners').select('competition_code').eq('competition_code',quiz.competition_code).maybeSingle();
 if(we)throw new Error('Could not verify final-round status');
 if(winner)return {allowed:false,message:'Round 3 is closed. The competition winner has been declared.'};
 const {data:profile,error:pe}=await admin.from('profiles').select('team_id').eq('id',userId).single();
 if(pe)throw new Error('Could not verify team identity');
 const allowed=(promotion.finalists||[]).some((f:any)=>profile?.team_id&&f.team_id===profile.team_id||(f.user_ids||[]).includes(userId));
 return {allowed,message:allowed?'Qualified for Round 3':'Only the confirmed top five teams from Rounds 1 and 2 are eligible for Round 3.'};
}
export function finalCandidates(source:any,promotion:any){
 if(!promotion)return {candidates:[],blocking:'Confirm the Round 3 finalists first.',active:0,pending:0};
 if(source.quizzes?.length!==1)return {candidates:[],blocking:'Exactly one published Round 3 is required.',active:0,pending:0};
 const candidates=[];let active=0,pending=0;
 for(const f of promotion.finalists||[]){
  const ids=(source.profiles||[]).filter((p:any)=>f.team_id&&p.team_id===f.team_id||(f.user_ids||[]).includes(p.id)).map((p:any)=>p.id);
  const attempts=(source.attempts||[]).filter((a:any)=>ids.includes(a.user_id));
  if(attempts.length>1)return {candidates:[],blocking:'A finalist has multiple final-round attempts. Reconcile before declaring a winner.',active:0,pending:0};
  const a=attempts[0];if(!a)continue;
  if(a.status==='in_progress'){active++;continue;}if(a.manual_review_required&&a.reviewed_score==null){pending++;continue;}
  candidates.push({...f,score:Number(a.reviewed_score??a.score),elapsed_ms:Math.max(0,Date.parse(a.submitted_at)-Date.parse(a.started_at))});
 }
 candidates.sort((a,b)=>b.score-a.score||a.identity.localeCompare(b.identity));
 return {candidates,active,pending,blocking:active?'Wait for active Round 3 attempts to finish.':pending?'Grade all submitted Round 3 work before declaring a winner.':''};
}
export function qualificationCandidates(source:any){
 const quizzes=source.quizzes||[],attempts=source.attempts||[],profiles=source.profiles||[],teams=source.teams||[];
 if(quizzes.length!==2||new Set(quizzes.map((q:any)=>q.stage_name)).size!==2)return {candidates:[],blocking:'Exactly one published Round 1 and Round 2 are required.',pending:0,active:0};
 const byQuiz=new Map(quizzes.map((q:any)=>[q.id,q])),byProfile=new Map(profiles.map((p:any)=>[p.id,p]));
 const groups=new Map();let pending=0,active=0,duplicate=false;
 for(const a of attempts){
  const p:any=byProfile.get(a.user_id),q:any=byQuiz.get(a.quiz_id);if(!p||!q)continue;
  const matches=p.team_id?teams.filter((t:any)=>t.id===p.team_id):teams.filter((t:any)=>t.team_name===p.full_name);
  if(matches.length!==1||!['registered','checked_in'].includes(matches[0].status))continue;
  const team=matches[0],identity=team.id;
  if(!groups.has(identity))groups.set(identity,{identity,team_id:team?.id||null,team_name:team?.team_name||p.full_name||'Team',user_ids:[],rounds:{}});
  const row=groups.get(identity);if(!row.user_ids.includes(p.id))row.user_ids.push(p.id);
  if(row.rounds[q.stage_name])duplicate=true;
  row.rounds[q.stage_name]=a;
  if(a.status==='in_progress')active++;
  else if(a.manual_review_required&&a.reviewed_score==null)pending++;
 }
 const candidates=[];
 for(const row of groups.values()){
  const first=row.rounds['Stage 1'],second=row.rounds['Stage 2'];
  if(!first||!second||[first,second].some(a=>a.status==='in_progress'||a.manual_review_required&&a.reviewed_score==null))continue;
  const time=[first,second].reduce((sum,a)=>sum+Math.max(0,Date.parse(a.submitted_at)-Date.parse(a.started_at)),0);
  if(!Number.isFinite(time))return {candidates:[],blocking:'An attempt has no valid submission timing. Repair it before promotion.',pending,active};
  candidates.push({identity:row.identity,team_id:row.team_id,team_name:row.team_name,user_ids:row.user_ids,round1_score:Number(first.reviewed_score??first.score),round2_score:Number(second.reviewed_score??second.score),score:Math.round((Number(first.reviewed_score??first.score)+Number(second.reviewed_score??second.score))*100)/100,elapsed_ms:time});
 }
 candidates.sort((a,b)=>b.score-a.score||a.elapsed_ms-b.elapsed_ms||a.identity.localeCompare(b.identity));
 let rank=0,last:any=null;candidates.forEach((row:any,i)=>{if(!last||last.score!==row.score||last.elapsed_ms!==row.elapsed_ms)rank=i+1;row.rank=rank;last=row;});
 return {candidates,blocking:duplicate?'A team has multiple attempts for one preliminary round. Reconcile them before promotion.':active?'Wait for active preliminary attempts to finish.':pending?'Grade all submitted preliminary work before promotion.':'',pending,active};
}
export function selectFinalists(candidates:any[],tieIds:string[]=[]){
 if(!candidates.length)throw new Error('No team has completed and received scores for both preliminary rounds.');
 const limit=Math.min(5,candidates.length),cutoff=candidates[limit-1];
 const higher=candidates.filter(c=>c.score>cutoff.score||c.score===cutoff.score&&c.elapsed_ms<cutoff.elapsed_ms);
 const tied=candidates.filter(c=>c.score===cutoff.score&&c.elapsed_ms===cutoff.elapsed_ms),slots=limit-higher.length;
 if(tied.length<=slots)return {finalists:candidates.slice(0,limit),tie:[],tie_slots:0};
 const chosen=tied.filter(c=>tieIds.includes(c.identity));
 if(chosen.length!==slots||tieIds.length!==slots)return {finalists:[],tie:tied,tie_slots:slots};
 return {finalists:[...higher,...chosen],tie:[],tie_slots:0};
}
