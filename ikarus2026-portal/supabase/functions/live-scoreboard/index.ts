import { finalizeExpiredAttempts } from '../_shared/quiz.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
const reply=(s:number,b:unknown)=>new Response(JSON.stringify(b),{status:s,headers:cors});
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return reply(405,{error:'POST required'});
 const url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(!url||!anon||!service)return reply(500,{error:'Supabase configuration missing'});
 const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');if(!token)return reply(401,{error:'Authentication required'});
 const auth=createClient(url,anon,{auth:{persistSession:false}});const {data:{user},error:authError}=await auth.auth.getUser(token);if(authError||!user)return reply(401,{error:'Invalid session'});
 const admin=createClient(url,service,{auth:{persistSession:false}});const {data:profile}=await admin.from('profiles').select('role').eq('id',user.id).single();if(profile?.role!=='president')return reply(403,{error:'President access required'});
 let body:any;try{body=await req.json();}catch{return reply(400,{error:'Invalid JSON'});}
 if(!body||!['TECHLIFT','DATAQUEST','AI_NEXUS'].includes(body.competition_code)||body.stage_name&&!['Stage 1','Stage 2','Stage 3','qualification'].includes(body.stage_name))return reply(400,{error:'Select a competition and valid stage'});
 let q=admin.from('quiz_drafts').select('id,stage_name,quiz_payload').eq('competition_code',body.competition_code).eq('status','published');if(body.stage_name==='qualification')q=q.in('stage_name',['Stage 1','Stage 2']);else if(body.stage_name)q=q.eq('stage_name',body.stage_name);
 const [{data:quizzes,error:qe},{data:teams,error:te},{data:profiles,error:pe}]=await Promise.all([q,admin.from('teams').select('id,team_name,status').eq('competition_code',body.competition_code).neq('status','disqualified'),admin.from('profiles').select('id,team_id,full_name').eq('competition_code',body.competition_code)]);
 if(qe||te||pe)return reply(500,{error:'Could not load competition scoreboard'});
 try{await finalizeExpiredAttempts(admin,quizzes||[]);}catch{return reply(500,{error:'Could not finalize expired rounds. Please refresh.'});}
 const {data:attempts,error:ae}=quizzes?.length?await admin.from('quiz_attempts').select('quiz_id,user_id,status,score,reviewed_score,manual_review_required,started_at,submitted_at').in('quiz_id',quizzes.map((x:any)=>x.id)).neq('status','in_progress'):{data:[],error:null};
 if(ae)return reply(500,{error:'Could not load scores'});
 const [{data:promotion,error:promotionError},{data:declared,error:winnerError}]=await Promise.all([admin.from('round3_promotions').select('finalists,created_at').eq('competition_code',body.competition_code).maybeSingle(),admin.from('competition_winners').select('winner,created_at').eq('competition_code',body.competition_code).maybeSingle()]);
 if(promotionError||winnerError)return reply(503,{error:'Could not load finalist and winner status'});
 const byProfile=new Map((profiles||[]).map((p:any)=>[p.id,p]));const byQuiz=new Map((quizzes||[]).map((q:any)=>[q.id,q]));
 const rows=new Map((teams||[]).map((t:any)=>[t.id,{team_key:t.id,team_name:t.team_name,score:0,has_score:false,graded_rounds:0,pending_reviews:0,round_scores:{} as any,elapsed_seconds:0,all_published:true}]));
 for(const a of attempts||[]){
  const p:any=byProfile.get(a.user_id),quiz:any=byQuiz.get(a.quiz_id);if(!p||!quiz)continue;
  let identity=p.team_id;
  if(!identity){const matches=(teams||[]).filter((t:any)=>t.team_name===p.full_name);identity=matches.length===1?matches[0].id:null;}
  // Only registrations in the selected competition can appear on its board.
  if(!identity||!rows.has(identity))continue;
  const row:any=rows.get(identity);
  if(a.manual_review_required&&a.reviewed_score===null){row.pending_reviews++;row.round_scores[quiz.stage_name]=null;row.all_published=false;continue;}
  row.score+=Number(a.reviewed_score??a.score);row.has_score=true;row.graded_rounds++;row.round_scores[quiz.stage_name]=Number(a.reviewed_score??a.score);row.all_published=row.all_published&&a.status==='published';
  if((body.stage_name==='qualification'||quiz.quiz_payload?.tie_breaker==='elapsed_time')&&a.started_at&&a.submitted_at)row.elapsed_seconds+=Math.max(0,(Date.parse(a.submitted_at)-Date.parse(a.started_at))/1000);
 }
 for(const row of rows.values() as any){row.qualified=promotion?(promotion.finalists||[]).some((f:any)=>f.identity===row.team_key):null;row.is_winner=declared?.winner?.identity===row.team_key;if(body.stage_name==='qualification'&&row.graded_rounds<2)row.has_score=false;}
 const ranked=[...rows.values()].sort((a:any,b:any)=>(body.stage_name==='Stage 3'?Number(b.is_winner)-Number(a.is_winner):0)||Number(b.has_score)-Number(a.has_score)||b.score-a.score||a.elapsed_seconds-b.elapsed_seconds||a.team_name.localeCompare(b.team_name));
 let last:any=null,rank=0;
 const result=ranked.map((row:any,i:number)=>{if(row.has_score&&(last===null||row.score!==last.score||row.elapsed_seconds!==last.elapsed_seconds||body.stage_name==='Stage 3'&&row.is_winner!==last.is_winner))rank=i+1;if(row.has_score)last=row;return {...row,rank:row.has_score?rank:null,score:Math.round(row.score*100)/100,status:row.is_winner?'Winner':body.stage_name==='Stage 3'&&row.qualified===false?'Not qualified':row.pending_reviews?'Awaiting judging':row.has_score?(row.all_published?'Published':'Provisional'):'Not started'};});
 const max=(quizzes||[]).reduce((total:number,q:any)=>total+(q.quiz_payload?.questions||[]).reduce((sum:number,x:any)=>sum+Number(x.marks||0),0),0);
 return reply(200,{competition_code:body.competition_code,stage_name:body.stage_name==='qualification'?'Rounds 1 + 2':body.stage_name||'All-round points',promotion:promotion?{confirmed_at:promotion.created_at,finalist_count:promotion.finalists.length}:null,winner:declared?{...declared.winner,declared_at:declared.created_at}:null,max_score:max,updated_at:new Date().toISOString(),rows:result});
});
