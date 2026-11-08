import { roundAccess } from '../_shared/qualification.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { validAnswers } from '../_shared/quiz.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json'};
const reply=(s:number,b:unknown)=>new Response(JSON.stringify(b),{status:s,headers:cors});
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return reply(405,{error:'POST required'});
 const url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(!url||!anon||!service)return reply(500,{error:'Supabase Edge Function secrets are missing'});
 const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');if(!token)return reply(401,{error:'Authentication required'});
 const auth=createClient(url,anon,{auth:{persistSession:false}});const {data:{user},error:ae}=await auth.auth.getUser(token);if(ae||!user)return reply(401,{error:'Invalid session'});
 const admin=createClient(url,service,{auth:{persistSession:false}});const {data:profile}=await admin.from('profiles').select('role,competition_code').eq('id',user.id).single();
 if(!profile||!['participant','team_member','team'].includes(profile.role))return reply(403,{error:'Team account required'});
 let b:any;try{b=await req.json()}catch{return reply(400,{error:'Invalid JSON'});}
 if(!b||typeof b.quiz_id!=='string'||!b.answers||typeof b.answers!=='object'||Array.isArray(b.answers))return reply(400,{error:'quiz_id and answers are required'});
 if(!validAnswers(b.answers))return reply(400,{error:'Answers must be strings of at most 30000 characters with numeric positions'});
 const {data:q}=await admin.from('quiz_drafts').select('id,competition_code,stage_name,status').eq('id',b.quiz_id).eq('status','published').maybeSingle();
 if(!q||q.competition_code!==profile.competition_code)return reply(403,{error:'Stage not assigned to this account'});
 try{const access=await roundAccess(admin,q,user.id);if(!access.allowed)return reply(403,{error:access.message});}catch{return reply(503,{error:'Could not verify round eligibility. Try again.'});}
 const {data:a}=await admin.from('quiz_attempts').select('id,status,deadline_at').eq('quiz_id',q.id).eq('user_id',user.id).maybeSingle();
 if(!a||a.status!=='in_progress')return reply(409,{error:'No active attempt'});
 if(!a.deadline_at||Date.now()>new Date(a.deadline_at).getTime())return reply(409,{error:'Stage deadline has passed'});
 const {data:saved,error}=await admin.from('quiz_attempts').update({answers:b.answers}).eq('id',a.id).eq('status','in_progress').select('id').maybeSingle();
 if(error)return reply(500,{error:'Could not save progress'});
 if(!saved)return reply(409,{error:'The attempt has already been submitted'});
 return reply(200,{success:true,saved_at:new Date().toISOString()});
});
