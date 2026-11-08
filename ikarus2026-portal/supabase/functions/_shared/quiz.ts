import { validateRubric } from './grading.ts';
export const ANSWER_LIMIT = 30000;
export async function finalizeExpiredAttempts(admin:any,quizzes:any[]){
 if(!quizzes.length)return;
 const now=new Date().toISOString();
 const {data:expired,error}=await admin.from('quiz_attempts').select('id,quiz_id,user_id,answers,deadline_at').in('quiz_id',quizzes.map(q=>q.id)).eq('status','in_progress').lt('deadline_at',now);
 if(error)throw new Error('Could not check expired attempts');
 const byQuiz=new Map(quizzes.map(q=>[q.id,q]));
 for(const attempt of expired||[]){
  const quiz:any=byQuiz.get(attempt.quiz_id);const questions=quiz?.quiz_payload?.questions;
  if(!Array.isArray(questions)||!questions.length)continue;
  const result=scoreQuestions(questions,attempt.answers||{});
  const {data:saved,error:saveError}=await admin.from('quiz_attempts').update({...result,status:'submitted',submitted_at:attempt.deadline_at}).eq('id',attempt.id).eq('status','in_progress').select('id').maybeSingle();
  if(saveError)throw new Error('Could not finalize an expired attempt');
  if(saved)await admin.from('ikarus_audit_events').insert({actor_id:attempt.user_id,action:'quiz_expired_submitted',entity_type:'quiz_attempt',entity_id:attempt.id,competition_code:quiz.competition_code,details:{quiz_id:quiz.id}});
 }
}
export function rankAttempts(attempts:any[],speedTie=false){
 const elapsed=(a:any)=>a.started_at&&a.submitted_at?Math.max(0,Date.parse(a.submitted_at)-Date.parse(a.started_at)):Infinity;
 const scored=attempts.filter(a=>a.status!=='in_progress'&&(!a.manual_review_required||a.reviewed_score!==null&&a.reviewed_score!==undefined)).map(a=>({...a,final_score:Number(a.reviewed_score??a.score)}));
 scored.sort((a,b)=>b.final_score-a.final_score||(speedTie?elapsed(a)-elapsed(b):0));
 const ranks=new Map();let last:any=null,rank=0;
 scored.forEach((a,i)=>{if(!last||a.final_score!==last.final_score||speedTie&&elapsed(a)!==elapsed(last))rank=i+1;ranks.set(a.user_id,rank);last=a;});
 return ranks;
}
export function publicQuiz(q:any) {
 return {id:q.id,title:q.title,competition_code:q.competition_code,stage_name:q.stage_name,duration_minutes:q.duration_minutes,opens_at:q.opens_at,closes_at:q.closes_at,
  instructions:typeof q.quiz_payload?.instructions==='string'?q.quiz_payload.instructions:'',
  dataset_csv:typeof q.quiz_payload?.dataset_csv==='string'?q.quiz_payload.dataset_csv:'',
  dataset_filename:typeof q.quiz_payload?.dataset_filename==='string'&&/^[a-zA-Z0-9_.-]+\.csv$/.test(q.quiz_payload.dataset_filename)?q.quiz_payload.dataset_filename:'dataset.csv',
  questions:(Array.isArray(q.quiz_payload?.questions)?q.quiz_payload.questions:[]).map((x:any,i:number)=>({position:Number.isInteger(x?.position)&&x.position>0?x.position:i+1,text:typeof x?.text==='string'?x.text:'',section_title:typeof x?.section_title==='string'?x.section_title:'',requires_evidence_link:x?.requires_evidence_link===true,requires_video_link:x?.requires_video_link===true,response_parts:Array.isArray(x?.response_parts)?x.response_parts.map((p:any)=>({key:p.key,label:p.label,marks:p.marks,type:p.type})):[],marking_criteria:Array.isArray(x?.grading_criteria)?x.grading_criteria.map((c:any)=>({label:c.label,marks:c.marks})):[],type:['mcq','true_false','subjective','code','activity'].includes(x?.type)?x.type:'subjective',options:Array.isArray(x?.options)?x.options.filter((o:any)=>o&&typeof o==='object').map((o:any)=>({label:typeof o.label==='string'?o.label:'',text:typeof o.text==='string'?o.text:''})).filter((o:any)=>o.label||o.text):[],marks:Number.isFinite(Number(x?.marks))&&Number(x.marks)>=0?Number(x.marks):0})).filter((x:any)=>x.text)};
}
export function validAnswers(answers: unknown): answers is Record<string,string> {
 return !!answers && typeof answers === 'object' && !Array.isArray(answers) &&
   Object.entries(answers).length <= 100 && Object.entries(answers).every(([k,v]) =>
     /^[1-9]\d*$/.test(k) && typeof v === 'string' && v.length <= ANSWER_LIMIT);
}
const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();
export function validateQuestions(questions: any): string | null {
 if (!Array.isArray(questions) || !questions.length || questions.length > 100) return 'A stage needs 1 to 100 questions';
 const positions = new Set();
 for (let i=0; i<questions.length; i++) {
  const q=questions[i];
  if (!q || !Number.isInteger(q.position) || q.position<1 || positions.has(q.position)) return `Question ${i+1} needs a unique positive position`;
  positions.add(q.position);
  if (typeof q.text!=='string' || !q.text.trim() || q.text.length>50000 || typeof q.marks!=='number' || !Number.isFinite(q.marks) || q.marks<0 || q.marks>10000) return `Question ${i+1} has invalid text or marks`;
  if (!['mcq','true_false','subjective','code','activity'].includes(q.type)) return `Question ${i+1} has an unsupported type`;
  const rubricError=validateRubric(q);if(rubricError)return `Question ${i+1}: ${rubricError}`;
  if (['subjective','code','activity'].includes(q.type)) continue;
  const options = q.type==='true_false' && !q.options?.length ? [{label:'True',text:'True'},{label:'False',text:'False'}] : q.options;
  if (!Array.isArray(options) || options.length<2 || options.length>8 || options.some(o=>!o || typeof o.label!=='string' || !o.label.trim() || typeof o.text!=='string' || !o.text.trim()) || new Set(options.map(o=>norm(o.label))).size!==options.length) return `Question ${i+1} needs 2 to 8 distinct labeled options`;
  if (!norm(q.correct_answer) || !options.some(o=>norm(o.label)===norm(q.correct_answer)||norm(o.text)===norm(q.correct_answer))) return `Question ${i+1}: correct answer must match an option`;
 }
 return null;
}
export function scoreQuestions(questions: any[], answers: Record<string,string>) {
 let score=0, max=0, manual=false;
 for (const q of questions) {
  const marks=Math.max(0,Number(q.marks)||0); max+=marks;
  if (['subjective','code','activity'].includes(q.type)) { manual=true; continue; }
  const answer=norm(answers[String(q.position)]), correct=norm(q.correct_answer);
  if (!answer || !correct) continue;
  const option=(q.options||[]).find((o:any)=>norm(o.label)===answer || norm(o.text)===answer);
  if (answer===correct || (option && (norm(option.label)===correct || norm(option.text)===correct))) score+=marks;
 }
 return {score:Math.round(score*100)/100,max_score:Math.round(max*100)/100,manual_review_required:manual};
}
