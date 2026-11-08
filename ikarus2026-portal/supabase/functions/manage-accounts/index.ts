import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json'};
const reply=(s:number,b:unknown)=>new Response(JSON.stringify(b),{status:s,headers:cors});
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
 const admin=createClient(url,service,{auth:{persistSession:false}});
 const {data:profile}=await admin.from('profiles').select('role').eq('id',user.id).single();
 if(profile?.role!=='president')return reply(403,{error:'Only the President can create accounts'});
 let body:any;try{body=await req.json();}catch{return reply(400,{error:'Invalid JSON'});}
 if(body?.action==='create_team'){
  if(typeof body.team_name!=='string'||!body.team_name.trim()||body.team_name.length>160||!['TECHLIFT','DATAQUEST','AI_NEXUS'].includes(body.competition_code)||!Array.isArray(body.members)||body.members.length>10||body.members.some((name:any)=>typeof name!=='string'||name.length>160))return reply(400,{error:'Enter a team name, competition, and valid member names'});
  const ticket='IK26-'+crypto.randomUUID().replaceAll('-','').slice(0,12).toUpperCase();
  const {data:team,error}=await admin.from('teams').insert({team_name:body.team_name.trim(),competition_code:body.competition_code,registration_number:ticket,members:body.members.map((name:string)=>name.trim()).filter(Boolean),status:'registered'}).select('id,team_name,competition_code,registration_number').single();
  if(error||!team)return reply(409,{error:'Could not register the team. Please try again.'});
  await admin.from('ikarus_audit_events').insert({actor_id:user.id,action:'spot_team_registered',entity_type:'team',entity_id:team.id,competition_code:team.competition_code,details:{}});
  return reply(200,{success:true,team:{id:team.id,team_name:team.team_name,competition_code:team.competition_code,ticket_id:team.registration_number}});
 }
 if(!body||typeof body.email!=='string'||!body.email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)||body.email.length>254||typeof body.password!=='string'||body.password.length<12||body.password.length>128)return reply(400,{error:'Enter a valid email and a password of 12 to 128 characters'});
 if(!['officer','team'].includes(body.role)||!['TECHLIFT','DATAQUEST','AI_NEXUS'].includes(body.competition_code)||typeof body.full_name!=='string'||!body.full_name.trim()||body.full_name.length>160)return reply(400,{error:'A display name, competition, and team/officer role are required'});
 const {data:created,error:createError}=await admin.auth.admin.createUser({email:body.email.trim(),password:body.password,email_confirm:true});
 if(createError||!created.user)return reply(409,{error:createError?.message||'Could not create account'});
 const {error:profileError}=await admin.from('profiles').insert({id:created.user.id,full_name:body.full_name.trim(),role:body.role,competition_code:body.competition_code});
 if(profileError){
  const {error:cleanupError}=await admin.auth.admin.deleteUser(created.user.id);
  return reply(500,{error:cleanupError?`Account ${created.user.id} exists without a profile. Ask the administrator to repair it before retrying.`:'Profile creation failed; the new login was rolled back. Check the database migration.'});
 }
 await admin.from('ikarus_audit_events').insert({actor_id:user.id,action:'account_created',entity_type:'profile',entity_id:created.user.id,competition_code:body.competition_code,details:{role:body.role}});
 return reply(200,{success:true,user_id:created.user.id});
});
