import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { digest,ticketChallenge,readTicketChallenge } from '../_shared/ticket.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
const reply=(s:number,b:unknown)=>new Response(JSON.stringify(b),{status:s,headers:cors});
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return reply(405,{error:'POST required'});
 const url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(!url||!anon||!service)return reply(500,{error:'Ticket sign-in is not configured'});
 let body:any;try{body=await req.json();}catch{return reply(400,{error:'Invalid JSON'});}
 if(!body||!['lookup','confirm'].includes(body.action))return reply(400,{error:'Choose lookup or confirm'});
 const admin=createClient(url,service,{auth:{persistSession:false}});
 const ip=req.headers.get('cf-connecting-ip')||req.headers.get('x-forwarded-for')?.split(',')[0]||'unknown';
 const ipKey=await digest(service,'ticket-rate-ip|'+ip);
 const {data:allowed,error:rateError}=await admin.rpc('ikarus_ticket_rate_limit',{p_key:ipKey,p_limit:300});
 if(rateError)return reply(503,{error:'Ticket sign-in is temporarily unavailable'});
 if(!allowed)return reply(429,{error:'Too many sign-in requests. Please wait five minutes.'});
 if(body.action==='lookup'){
  if(typeof body.ticket_id!=='string'||body.ticket_id.trim().length<4||body.ticket_id.length>128)return reply(400,{error:'Enter your complete ticket ID'});
  const {data:teams,error}=await admin.rpc('ikarus_find_ticket',{p_ticket:body.ticket_id.trim()});
  if(error)return reply(503,{error:'Could not verify the ticket. Please try again.'});
  if(!teams?.length)return reply(404,{error:'No eligible team was found for this ticket ID. Check the ID or contact your event officer.'});
  const matches=[];
  for(const team of teams)matches.push({team_name:team.team_name,competition_code:team.competition_code,year_group:{TECHLIFT:1,DATAQUEST:2,AI_NEXUS:3}[team.competition_code as string],challenge:await ticketChallenge(service,team)});
  return reply(200,{matches});
 }
 if(typeof body.challenge!=='string'||body.challenge.length>2048)return reply(400,{error:'Confirm your team after checking the ticket'});
 const signed=await readTicketChallenge(service,body.challenge);
 if(!signed)return reply(401,{error:'Team confirmation expired. Enter your ticket ID again.'});
 const {data:team}=await admin.from('teams').select('id,team_name,registration_number,competition_code,status').eq('id',signed.team_id).single();
 if(!team||!['registered','checked_in'].includes(team.status)||signed.ticket_hash!==await digest(service,'ticket-id|'+team.registration_number.trim().toLowerCase()))return reply(403,{error:'This ticket is no longer eligible. Contact your event officer.'});
 const rate=await admin.rpc('ikarus_ticket_rate_limit',{p_key:'team|'+team.id,p_limit:20});
 if(rate.error||!rate.data)return reply(429,{error:'Too many team sign-in attempts. Please wait five minutes.'});
 let {data:link,error:linkError}=await admin.auth.admin.generateLink({type:'magiclink',email:`team-${team.id}@ikarus.invalid`});
 if(linkError||!link?.user||!link?.properties?.hashed_token)return reply(503,{error:'Could not prepare your team session. Please try again.'});
 if(!link.user.email_confirmed_at){
  const confirmed=await admin.auth.admin.updateUserById(link.user.id,{email_confirm:true});
  if(confirmed.error)return reply(503,{error:'Could not activate your team session.'});
  const fresh=await admin.auth.admin.generateLink({type:'magiclink',email:`team-${team.id}@ikarus.invalid`});link=fresh.data;linkError=fresh.error;
  if(linkError||!link?.user||!link?.properties?.hashed_token)return reply(503,{error:'Could not prepare your team session. Please try again.'});
 }
 const {error:profileError}=await admin.from('profiles').upsert({id:link.user.id,team_id:team.id,full_name:team.team_name,role:'team',competition_code:team.competition_code});
 if(profileError)return reply(503,{error:'Could not prepare your team profile. Contact the event officer.'});
 const auth=createClient(url,anon,{auth:{persistSession:false}});
 const {data:session,error:sessionError}=await auth.auth.verifyOtp({token_hash:link.properties.hashed_token,type:'magiclink'});
 if(sessionError||!session.session)return reply(503,{error:'Could not finish team sign-in. Please try confirming again.',code:sessionError?.code||'missing_session'});
 await admin.from('ikarus_audit_events').insert({actor_id:link.user.id,action:'team_ticket_login',entity_type:'team',entity_id:team.id,competition_code:team.competition_code,details:{}});
 return reply(200,{session:{access_token:session.session.access_token,refresh_token:session.session.refresh_token},team_name:team.team_name,competition_code:team.competition_code});
});
