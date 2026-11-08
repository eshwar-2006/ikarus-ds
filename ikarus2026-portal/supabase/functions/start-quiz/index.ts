import { roundAccess } from '../_shared/qualification.ts';
import { publicQuiz as safeQuiz } from '../_shared/quiz.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json'};
const reply=(s:number,b:unknown)=>new Response(JSON.stringify(b),{status:s,headers:cors});
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return reply(405,{error:'POST required'});
 const url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(!url||!anon||!service)return reply(500,{error:'Supabase Edge Function secrets are missing'});
 const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');if(!token)return reply(401,{error:'Authentication required'});
 const auth=createClient(url,anon,{auth:{persistSession:false}});const {data:{user},error:ae}=await auth.auth.getUser(token);if(ae||!user)return reply(401,{error:'Invalid session'});
 const admin=createClient(url,service,{auth:{persistSession:false}});const {data:profile}=await admin.from('profiles').select('role,competition_code').eq('id',user.id).single();
 if(!profile||!['participant','team_member','team'].includes(profile.role))return reply(403,{error:'Team account required'});
 let b:any;try{b=await req.json()}catch{return reply(400,{error:'Invalid JSON'});}if(!b||typeof b.quiz_id!=='string')return reply(400,{error:'quiz_id is required'});
 const {data:q,error}=await admin.from('quiz_drafts').select('id,title,competition_code,stage_name,duration_minutes,opens_at,closes_at,quiz_payload,status').eq('id',b.quiz_id).eq('status','published').single();
 if(error||!q)return reply(404,{error:'Published stage not found'});if(profile.competition_code!==q.competition_code)return reply(403,{error:'This stage is not assigned to your competition'});
 try{const access=await roundAccess(admin,q,user.id);if(!access.allowed)return reply(403,{error:access.message});}catch{return reply(503,{error:'Could not verify round eligibility. Try again.'});}
 const nowMs=Date.now();
 if(q.opens_at&&nowMs<new Date(q.opens_at).getTime())return reply(403,{error:`This stage opens at ${q.opens_at}`});
 const quiz=safeQuiz(q);if(!quiz.questions.length)return reply(409,{error:'This stage has no participant-ready questions'});
 const {data:prior}=await admin.from('quiz_attempts').select('id,status,started_at,deadline_at,answers').eq('quiz_id',q.id).eq('user_id',user.id).maybeSingle();
 if(prior){
   if(prior.status!=='in_progress')return reply(409,{error:'This stage has already been submitted and cannot be restarted'});
   return reply(200,{success:true,quiz,server_now:new Date().toISOString(),started_at:prior.started_at,deadline_at:prior.deadline_at,saved_answers:prior.answers||{},resumed:true});
 }
 if(q.closes_at&&nowMs>new Date(q.closes_at).getTime())return reply(403,{error:'This stage is closed. Contact the competition Officer if you believe this is an error.'});
 const now=new Date();
 const durationDeadline=new Date(now.getTime()+Math.max(1,Math.min(240,Number(q.duration_minutes)||20))*60000);
 const scheduledClose=q.closes_at?new Date(q.closes_at):null;
 const deadline=scheduledClose&&scheduledClose<durationDeadline?scheduledClose:durationDeadline;
 const {data:attempt,error:insertErr}=await admin.from('quiz_attempts').insert({quiz_id:q.id,user_id:user.id,answers:{},score:0,max_score:0,manual_review_required:false,status:'in_progress',started_at:now.toISOString(),deadline_at:deadline.toISOString(),submitted_at:null}).select('started_at,deadline_at').single();
 if(insertErr){
   const {data:race}=await admin.from('quiz_attempts').select('status,started_at,deadline_at,answers').eq('quiz_id',q.id).eq('user_id',user.id).maybeSingle();
   if(race?.status==='in_progress')return reply(200,{success:true,quiz,server_now:new Date().toISOString(),started_at:race.started_at,deadline_at:race.deadline_at,saved_answers:race.answers||{},resumed:true});
   return reply(409,{error:'An attempt already exists or could not be started'});
 }
 await admin.from('ikarus_audit_events').insert({actor_id:user.id,action:'quiz_started',entity_type:'quiz',entity_id:q.id,competition_code:q.competition_code,details:{stage_name:q.stage_name}});
 return reply(200,{success:true,quiz,server_now:new Date().toISOString(),started_at:attempt.started_at,deadline_at:attempt.deadline_at,saved_answers:{},resumed:false});
});
