import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage','Access-Control-Allow-Methods':'GET, OPTIONS','Content-Type':'application/json'};
const reply=(s:number,b:unknown)=>new Response(JSON.stringify(b),{status:s,headers:cors});
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='GET'&&req.method!=='POST')return reply(405,{error:'GET or POST required'});
 const url=Deno.env.get('SUPABASE_URL'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(!url||!service)return reply(500,{error:'Supabase Edge Function secrets are missing'});
 const admin=createClient(url,service,{auth:{persistSession:false}});
 let quizId:string|null=null;try{if(req.method==='POST'){const b=await req.json();quizId=typeof b.quiz_id==='string'?b.quiz_id:null;}else quizId=new URL(req.url).searchParams.get('quiz_id')}catch{return reply(400,{error:'Invalid request'});}
 let query=admin.from('quiz_drafts').select('id,title,stage_name,competition_code').eq('status','published');
 if(quizId)query=query.eq('id',quizId);
 const {data:quizzes,error}=await query;if(error)return reply(500,{error:'Could not load published results'});
 const results:any[]=[];
 for(const q of quizzes||[]){
   const {data:attempts}=await admin.from('quiz_attempts').select('user_id,score,max_score,reviewed_score,published_at').eq('quiz_id',q.id).eq('status','published').order('published_at',{ascending:true});
   const ranked:any[]=[];
   for(const a of attempts||[]){const {data:p}=await admin.from('profiles').select('full_name').eq('id',a.user_id).maybeSingle();ranked.push({participant_name:p?.full_name||'Participant',score:a.reviewed_score??a.score,max_score:a.max_score,published_at:a.published_at});}
   ranked.sort((a,b)=>Number(b.score)-Number(a.score));
   results.push({quiz_id:q.id,title:q.title,stage_name:q.stage_name,competition_code:q.competition_code,results:ranked.map((r,i)=>({...r,rank:i+1}))});
 }
 return reply(200,{results});
});
