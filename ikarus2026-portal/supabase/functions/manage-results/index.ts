import { gradingSections, calculateSectionGrade } from '../_shared/grading.ts';
import { scoreQuestions, finalizeExpiredAttempts } from '../_shared/quiz.ts';
import { roundAccess } from '../_shared/qualification.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json'};
const reply=(s:number,b:unknown)=>new Response(JSON.stringify(b),{status:s,headers:cors});
const validCode=(s:any)=>['TECHLIFT','DATAQUEST','AI_NEXUS'].includes(s);
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return reply(405,{error:'POST required'});
 const url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(!url||!anon||!service)return reply(500,{error:'Supabase Edge Function secrets are missing'});
 const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');if(!token)return reply(401,{error:'Authentication required'});
 const auth=createClient(url,anon,{auth:{persistSession:false}});const {data:{user},error:ae}=await auth.auth.getUser(token);if(ae||!user)return reply(401,{error:'Invalid session'});
 const admin=createClient(url,service,{auth:{persistSession:false}});const {data:profile}=await admin.from('profiles').select('role,competition_code').eq('id',user.id).single();
 if(!profile||!['president','officer'].includes(profile.role))return reply(403,{error:'Organizer account required'});
 let b:any;try{b=await req.json()}catch{return reply(400,{error:'Invalid JSON'});}if(!b||typeof b!=='object')return reply(400,{error:'Invalid request body'});const action=String(b.action||'list');
 if(!['list','grade','approve','publish'].includes(action))return reply(400,{error:'Unsupported action'});
 const president=profile.role==='president';
 if(action==='approve'||action==='publish'){if(!president)return reply(403,{error:'Only the President can approve or publish results'});}
 const getAttempt=async(id:string)=>{
   const {data:a,error}=await admin.from('quiz_attempts').select('*').eq('id',id).single();if(error||!a)return {a:null,q:null};
   const {data:q}=await admin.from('quiz_drafts').select('id,title,stage_name,competition_code,quiz_payload').eq('id',a.quiz_id).single();
   if(!q||(!president&&profile.competition_code!==q.competition_code))return {a:null,q:null};
   return {a,q};
 };
 if(action==='list'){
   let quizQuery=admin.from('quiz_drafts').select('id,title,stage_name,competition_code,quiz_payload');
   if(!president)quizQuery=quizQuery.eq('competition_code',profile.competition_code);
   const {data:quizzes,error:quizError}=await quizQuery;
   if(quizError)return reply(500,{error:'Could not load stages'});
   if(!quizzes?.length)return reply(200,{attempts:[]});
 try{await finalizeExpiredAttempts(admin,quizzes||[]);}catch{return reply(500,{error:'Could not finalize expired rounds. Please refresh.'});}
   const {data:attempts,error}=await admin.from('quiz_attempts').select('*').in('quiz_id',quizzes.map((q:any)=>q.id)).neq('status','in_progress').order('submitted_at',{ascending:false}).limit(1000);
   if(error)return reply(500,{error:'Could not load submissions'});
   const ids=[...new Set((attempts||[]).map((a:any)=>a.user_id))];
   const profiles=ids.length?await admin.from('profiles').select('id,full_name').in('id',ids):{data:[],error:null};
   if(profiles.error)return reply(500,{error:'Could not load team names'});
   const names=new Map((profiles.data||[]).map((p:any)=>[p.id,p.full_name]));
   const byQuiz=new Map(quizzes.map((q:any)=>[q.id,q]));
   const {data:focusEvents,error:focusError}=attempts?.length?await admin.from('ikarus_audit_events').select('entity_id,details,created_at').eq('action','quiz_focus_lost').in('entity_id',attempts.map((a:any)=>a.id)):{data:[],error:null};
   if(focusError)return reply(500,{error:'Could not load quiz focus records'});
   const filtered=(attempts||[]).map((a:any)=>{const q:any=byQuiz.get(a.quiz_id);return {...a,quiz_title:q.title,stage_name:q.stage_name,competition_code:q.competition_code,participant_name:names.get(a.user_id)||'Participant',grading_sections:gradingSections(q.quiz_payload?.questions||[]),questions:(q.quiz_payload?.questions||[]).map((x:any)=>({position:x.position,text:x.text,type:x.type,marks:x.marks,section_title:x.section_title,requires_evidence_link:x.requires_evidence_link,requires_video_link:x.requires_video_link,grading_instructions:x.grading_instructions,response_parts:x.response_parts,correct_answer:x.correct_answer,options:x.options}))};});
   return reply(200,{attempts:filtered.map((a:any)=>({...a,organizer_reference:(byQuiz.get(a.quiz_id) as any)?.quiz_payload?.organizer_reference||'',organizer_notes:(byQuiz.get(a.quiz_id) as any)?.quiz_payload?.organizer_notes||'',focus_events:(focusEvents||[]).filter((event:any)=>event.entity_id===a.id).map((event:any)=>({reason:event.details?.reason,created_at:event.created_at}))}))});
 }
 if(typeof b.attempt_id!=='string')return reply(400,{error:'attempt_id is required'});
 const {a,q}=await getAttempt(b.attempt_id);if(!a||!q)return reply(404,{error:'Submission not found or not authorized'});
 if(action==='grade'){
   try{const access=await roundAccess(admin,q,a.user_id);if(!access.allowed)return reply(409,{error:access.message});}catch{return reply(503,{error:'Could not verify score-lock state'});}
   if(a.status!=='submitted'&&a.status!=='reviewed')return reply(409,{error:'Only submitted work can be graded'});
   if(a.manual_review_required!==true)return reply(409,{error:'This submission does not require manual grading'});
   let grade:any;try{const questions=q.quiz_payload?.questions||[];const automatic=scoreQuestions(questions,a.answers||{});if(Math.abs(automatic.max_score-Number(a.max_score))>0.001)return reply(409,{error:'Round marks differ from this attempt. Contact the President.'});grade=calculateSectionGrade(questions,b.section_scores,automatic.score);}catch(e){return reply(400,{error:e instanceof Error?e.message:'Invalid section marks'});}
   const {data:updated,error}=await admin.from('quiz_attempts').update({...grade,reviewer_notes:String(b.reviewer_notes||'').slice(0,3000),reviewed_by:user.id,reviewed_at:new Date().toISOString(),status:'reviewed'}).eq('id',a.id).in('status',['submitted','reviewed']).select('id').maybeSingle();
   if(error||!updated)return reply(409,{error:'Could not save review'});
   await admin.from('ikarus_audit_events').insert({actor_id:user.id,action:'submission_graded',entity_type:'quiz_attempt',entity_id:a.id,competition_code:q.competition_code,details:{reviewed_score:grade.reviewed_score,section_scores:grade.section_scores}});
   return reply(200,{success:true,status:'reviewed',...grade});
 }
 if(action==='approve'){
   if(a.status!=='submitted'&&a.status!=='reviewed')return reply(409,{error:'Only submitted or reviewed results can be approved'});
   if(a.manual_review_required&&a.reviewed_score===null)return reply(409,{error:'Grade the written response before approval'});
   const {data:updated,error}=await admin.from('quiz_attempts').update({status:'approved',approved_by:user.id,approved_at:new Date().toISOString()}).eq('id',a.id).in('status',['submitted','reviewed']).select('id').maybeSingle();
   if(error||!updated)return reply(409,{error:'Could not approve result'});
   await admin.from('ikarus_audit_events').insert({actor_id:user.id,action:'result_approved',entity_type:'quiz_attempt',entity_id:a.id,competition_code:q.competition_code,details:{}});
   return reply(200,{success:true,status:'approved'});
 }
 if(a.status!=='approved')return reply(409,{error:'Approve the result before publishing'});
 const {data:updated,error}=await admin.from('quiz_attempts').update({status:'published',published_at:new Date().toISOString()}).eq('id',a.id).eq('status','approved').select('id').maybeSingle();
 if(error||!updated)return reply(409,{error:'Could not publish result'});
 await admin.from('ikarus_audit_events').insert({actor_id:user.id,action:'result_published',entity_type:'quiz_attempt',entity_id:a.id,competition_code:q.competition_code,details:{}});
 return reply(200,{success:true,status:'published'});
});
