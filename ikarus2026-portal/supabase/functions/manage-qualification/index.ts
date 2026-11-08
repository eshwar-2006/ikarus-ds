import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { finalizeExpiredAttempts } from '../_shared/quiz.ts';
import { qualificationCandidates,selectFinalists,finalCandidates } from '../_shared/qualification.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:cors});
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return reply(405,{error:'POST required'});
 const url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(!url||!anon||!service)return reply(500,{error:'Supabase configuration missing'});
 const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');if(!token)return reply(401,{error:'Authentication required'});
 const auth=createClient(url,anon,{auth:{persistSession:false}}),admin=createClient(url,service,{auth:{persistSession:false}});
 const {data:{user},error:ae}=await auth.auth.getUser(token);if(ae||!user)return reply(401,{error:'Invalid session'});
 const {data:profile}=await admin.from('profiles').select('role').eq('id',user.id).single();if(profile?.role!=='president')return reply(403,{error:'President access required'});
 let b:any;try{b=await req.json();}catch{return reply(400,{error:'Invalid JSON'});}
 if(!b||!['TECHLIFT','DATAQUEST','AI_NEXUS'].includes(b.competition_code)||!['preview','finalists','winner'].includes(b.action||'preview'))return reply(400,{error:'Select a competition and supported action'});
 const comp=b.competition_code;
 const {data:quizzes,error:qe}=await admin.from('quiz_drafts').select('id,competition_code,stage_name,quiz_payload').eq('competition_code',comp).eq('status','published');if(qe)return reply(500,{error:'Could not load competition stages'});
 try{await finalizeExpiredAttempts(admin,quizzes||[]);}catch{return reply(500,{error:'Could not finalize expired attempts'});}
 const [{data:source,error:se},{data:finalSource,error:fe},{data:promotion,error:pe},{data:winner,error:we}]=await Promise.all([
  admin.rpc('ikarus_round3_source',{p_competition:comp}),admin.rpc('ikarus_competition_source',{p_competition:comp,p_stages:['Stage 3']}),
  admin.from('round3_promotions').select('*').eq('competition_code',comp).maybeSingle(),admin.from('competition_winners').select('*').eq('competition_code',comp).maybeSingle()
 ]);
 if(se||fe||pe||we||!source||!finalSource)return reply(500,{error:'Could not load qualification state'});
 const prelim=qualificationCandidates(source),final=finalCandidates(finalSource,promotion);
 const selection=prelim.candidates.length?selectFinalists(prelim.candidates):{finalists:[],tie:[],tie_slots:0};
 if(!b.action||b.action==='preview')return reply(200,{promotion,winner,preliminary:{...prelim,version:source.version,...selection},final:{...final,version:finalSource.version}});
 if(b.action==='finalists'){
  if(promotion)return reply(409,{error:'The finalists have already been confirmed'});
  if(prelim.blocking)return reply(409,{error:prelim.blocking});
  if(b.version!==source.version)return reply(409,{error:'Scores or registrations changed. Refresh the qualification preview.'});
  if(b.tie_ids!==undefined&&(!Array.isArray(b.tie_ids)||b.tie_ids.some((id:any)=>typeof id!=='string')))return reply(400,{error:'Invalid tie selection'});
  let selected;try{selected=selectFinalists(prelim.candidates,b.tie_ids||[]);}catch(e){return reply(409,{error:e.message});}
  if(selected.tie.length)return reply(409,{error:`An exact score-and-time tie remains. Select ${selected.tie_slots} team(s) from the tied group.`});
  const {data,error}=await admin.rpc('ikarus_confirm_round3',{p_competition:comp,p_version:source.version,p_finalists:selected.finalists,p_actor:user.id});
  if(error)return reply(409,{error:error.message||'Could not confirm finalists. Refresh and retry.'});return reply(200,{success:true,promotion:data});
 }
 if(winner)return reply(409,{error:'The winner has already been declared'});
 if(final.blocking)return reply(409,{error:final.blocking});
 if(!final.candidates.length)return reply(409,{error:'No finalist has a graded Round 3 result yet'});
 if(b.version!==finalSource.version)return reply(409,{error:'Final scores changed. Refresh the winner preview.'});
 if(b.judging_complete!==true)return reply(400,{error:'Confirm that final judging is complete before declaring the winner'});
 const leaders=final.candidates.filter((c:any)=>c.score===final.candidates[0].score);
 const selected=leaders.length===1?leaders[0]:leaders.find((c:any)=>c.identity===b.winner_id);
 if(!selected)return reply(409,{error:'Round 3 has a tied highest score. Select one winner from the tied leaders after judging review.'});
 const {data,error}=await admin.rpc('ikarus_confirm_winner',{p_competition:comp,p_version:finalSource.version,p_winner:selected,p_actor:user.id});
 if(error)return reply(409,{error:error.message||'Could not declare winner. Refresh and retry.'});return reply(200,{success:true,winner:data});
});
