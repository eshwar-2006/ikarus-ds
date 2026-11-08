import { finalizeExpiredAttempts } from '../_shared/quiz.ts';
import { rankAttempts } from '../_shared/quiz.ts';
import { accessFromState } from '../_shared/qualification.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json'};
const reply=(s:number,b:unknown)=>new Response(JSON.stringify(b),{status:s,headers:cors});
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return reply(405,{error:'POST required'});
 const url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(!url||!anon||!service)return reply(500,{error:'Supabase Edge Function secrets are missing'});
 const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');if(!token)return reply(401,{error:'Authentication required'});
 const auth=createClient(url,anon,{auth:{persistSession:false}});const {data:{user},error:ae}=await auth.auth.getUser(token);if(ae||!user)return reply(401,{error:'Invalid session'});
 const admin=createClient(url,service,{auth:{persistSession:false}});
 const {data:profile}=await admin.from('profiles').select('role,competition_code,team_id').eq('id',user.id).single();
 if(!profile||!['participant','team_member','team'].includes(profile.role))return reply(403,{error:'Team account required'});
 if(!profile.competition_code||!['TECHLIFT','DATAQUEST','AI_NEXUS'].includes(profile.competition_code))return reply(403,{error:'Your team account has no valid competition assignment'});
 if(profile.team_id){
  const {data:team,error:teamError}=await admin.from('teams').select('competition_code,status').eq('id',profile.team_id).maybeSingle();
  if(teamError)return reply(503,{error:'Could not verify your event registration'});
  if(!team||team.competition_code!==profile.competition_code||!['registered','checked_in'].includes(team.status))return reply(403,{error:'Your event registration has changed. Sign in again with your ticket ID or contact your event officer.'});
 }
 const {data:quizzes,error}=await admin.from('quiz_drafts').select('id,title,competition_code,stage_name,status,duration_minutes,published_at,opens_at,closes_at,quiz_payload').eq('competition_code',profile.competition_code).in('status',['draft','published']).order('stage_name',{ascending:true});
 if(error)return reply(500,{error:'Could not load published stages'});
 try{await finalizeExpiredAttempts(admin,(quizzes||[]).filter((q:any)=>q.status==='published'));}catch{return reply(500,{error:'Could not finalize expired rounds. Please refresh.'});}
 const {data:attempts,error:attemptError}=quizzes?.length?await admin.from('quiz_attempts').select('quiz_id,user_id,status,score,max_score,manual_review_required,reviewed_score,published_at,started_at,submitted_at,deadline_at').in('quiz_id',quizzes.map((q:any)=>q.id)):{data:[],error:null};
 if(attemptError)return reply(500,{error:'Could not load round results'});
 const [{data:promotion,error:pe},{data:winner,error:we}]=await Promise.all([admin.from('round3_promotions').select('finalists').eq('competition_code',profile.competition_code).maybeSingle(),admin.from('competition_winners').select('competition_code').eq('competition_code',profile.competition_code).maybeSingle()]);
 if(pe||we)return reply(503,{error:'Could not verify round eligibility'});
 return reply(200,{competition_code:profile.competition_code,quizzes:(quizzes||[]).map((q:any)=>{
  if(q.status!=='published')return {id:q.id,title:q.title,competition_code:q.competition_code,stage_name:q.stage_name,publication_status:'draft',duration_minutes:q.duration_minutes,can_start:false,eligibility_message:'Locked until the President publishes this round.',attempt_status:'not_started',score:null,max_score:null,rank:null,awaiting_judging:false};
  const round=(attempts||[]).filter((a:any)=>a.quiz_id===q.id),a=round.find((a:any)=>a.user_id===user.id);
  const graded=a&&a.status!=='in_progress'&&(!a.manual_review_required||a.reviewed_score!==null);
  const access=accessFromState(q,user.id,profile.team_id,promotion,winner);
  return {id:q.id,title:q.title,competition_code:q.competition_code,stage_name:q.stage_name,duration_minutes:q.duration_minutes,published_at:q.published_at,opens_at:q.opens_at,closes_at:q.closes_at,can_start:access.allowed,eligibility_message:access.message,attempt_status:a?.status||'not_started',score:graded?(a.reviewed_score??a.score):null,max_score:a?.status!=='in_progress'?a?.max_score??null:null,rank:graded?rankAttempts(round,q.quiz_payload?.tie_breaker==='elapsed_time').get(user.id)??null:null,awaiting_judging:!!a&&a.status!=='in_progress'&&!graded,submitted_at:a?.submitted_at??null,deadline_at:a?.deadline_at??null};
 })});
});
