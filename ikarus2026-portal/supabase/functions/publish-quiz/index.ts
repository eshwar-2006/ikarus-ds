import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { validateQuestions } from '../_shared/quiz.ts';
const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json'};
const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:cors});
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors});
  if(req.method!=='POST') return reply(405,{success:false,error:'POST required'});
  const url=Deno.env.get('SUPABASE_URL'), anon=Deno.env.get('SUPABASE_ANON_KEY'), service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!anon||!service) return reply(500,{success:false,error:'Edge Function secrets SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be configured.'});
  const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,''); if(!token) return reply(401,{success:false,error:'Authentication required'});
  const authClient=createClient(url,anon,{auth:{persistSession:false},global:{headers:{Authorization:`Bearer ${token}`}}});
  const {data:{user},error:authErr}=await authClient.auth.getUser(token); if(authErr||!user) return reply(401,{success:false,error:'Invalid or expired session'});
  const admin=createClient(url,service,{auth:{persistSession:false}});
  const {data:profile,error:profileErr}=await admin.from('profiles').select('role,competition_code').eq('id',user.id).single();
  if(profileErr||profile?.role!=='president') return reply(403,{success:false,error:'Only the President can publish a round and unlock it for teams'});
  let body; try{body=await req.json()}catch{return reply(400,{success:false,error:'Invalid JSON body'});}
  if(!body||typeof body.quiz_id!=='string') return reply(400,{success:false,error:'quiz_id is required'});
  const {data:quiz,error}=await admin.from('quiz_drafts').select('id,competition_code,status,quiz_payload,created_by,opens_at,closes_at').eq('id',body.quiz_id).single();
  if(error||!quiz) return reply(404,{success:false,error:'Quiz draft not found'});
  if(profile.role!=='president' && (profile.role!=='officer'||profile.competition_code!==quiz.competition_code)) return reply(403,{success:false,error:'You are not authorized to publish this competition'});
  if(quiz.status!=='draft') return reply(409,{success:false,error:'Only a draft can be published'});
  if((quiz.opens_at&&!quiz.closes_at)||(!quiz.opens_at&&quiz.closes_at)) return reply(400,{success:false,error:'Set both stage opening and closing times, or leave both blank for an always-open practice stage.'});
  if(quiz.opens_at&&quiz.closes_at&&new Date(quiz.closes_at)<=new Date(quiz.opens_at)) return reply(400,{success:false,error:'Stage closing time must be later than opening time.'});
  const questions=quiz.quiz_payload?.questions;
  const validationError=validateQuestions(questions);
  if(validationError)return reply(400,{success:false,error:validationError});
  if(!Array.isArray(questions)||!questions.length) return reply(400,{success:false,error:'Quiz contains no questions'});
  for(let i=0;i<questions.length;i++){
    const q=questions[i];
    if(!q.text||!Number.isFinite(Number(q.marks))||Number(q.marks)<0) return reply(400,{success:false,error:`Question ${i+1} has invalid text or marks`});
    if(!['subjective','code','activity'].includes(q.type) && !String(q.correct_answer||'').trim()) return reply(400,{success:false,error:`Question ${i+1} needs a verified correct answer`});
    if(q.type==='mcq'&&(!Array.isArray(q.options)||q.options.length<2)) return reply(400,{success:false,error:`Question ${i+1} needs at least two options`});
  }
  const {data:updated,error:updateErr}=await admin.from('quiz_drafts').update({status:'published',published_at:new Date().toISOString(),updated_at:new Date().toISOString(),quiz_payload:{...quiz.quiz_payload,answer_key_verified:true}}).eq('id',quiz.id).eq('status','draft').select('id').maybeSingle();
  if(updateErr) return reply(500,{success:false,error:`Could not publish quiz: ${updateErr.message}`});
  if(!updated)return reply(409,{success:false,error:'This round changed. Refresh before publishing.'});
  await admin.from('ikarus_audit_events').insert({actor_id:user.id,action:'round_published',entity_type:'quiz',entity_id:quiz.id,competition_code:quiz.competition_code,details:{}});
  return reply(200,{success:true,quiz_id:quiz.id,status:'published'});
});
