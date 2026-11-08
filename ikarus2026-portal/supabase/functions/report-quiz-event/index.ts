import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json'};
const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:cors});
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return reply(405,{error:'POST required'});
 const url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(!url||!anon||!service)return reply(500,{error:'Supabase Edge Function secrets are missing'});
 const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
 if(!token)return reply(401,{error:'Authentication required'});
 const auth=createClient(url,anon,{auth:{persistSession:false}});
 const {data:{user},error:authError}=await auth.auth.getUser(token);
 if(authError||!user)return reply(401,{error:'Invalid session'});
 let body:any;try{body=await req.json();}catch{return reply(400,{error:'Invalid JSON'});}
 if(!body||typeof body.quiz_id!=='string'||!['tab_hidden','window_blur','fullscreen_exit'].includes(body.reason))return reply(400,{error:'A quiz and supported focus event are required'});
 const admin=createClient(url,service,{auth:{persistSession:false}});
 const {data:attempt}=await admin.from('quiz_attempts').select('id,status').eq('quiz_id',body.quiz_id).eq('user_id',user.id).maybeSingle();
 if(!attempt||attempt.status!=='in_progress')return reply(409,{error:'No active attempt'});
 const {data:quiz}=await admin.from('quiz_drafts').select('competition_code').eq('id',body.quiz_id).single();
 const {data:latest}=await admin.from('ikarus_audit_events').select('created_at').eq('actor_id',user.id).eq('entity_id',attempt.id).eq('action','quiz_focus_lost').order('created_at',{ascending:false}).limit(1).maybeSingle();
 if(latest&&Date.now()-new Date(latest.created_at).getTime()<2000)return reply(200,{success:true,deduplicated:true});
 const {error}=await admin.from('ikarus_audit_events').insert({actor_id:user.id,action:'quiz_focus_lost',entity_type:'quiz_attempt',entity_id:attempt.id,competition_code:quiz?.competition_code,details:{reason:body.reason}});
 if(error)return reply(500,{error:'Could not record focus event'});
 return reply(200,{success:true});
});
