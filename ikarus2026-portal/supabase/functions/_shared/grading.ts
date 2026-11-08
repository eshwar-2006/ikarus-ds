export const manualTypes = ['subjective','code','activity'];

export function gradingSections(questions:any[]) {
  return questions.filter(q=>manualTypes.includes(q.type)).map(q=>{
    const source=Array.isArray(q.grading_criteria)&&q.grading_criteria.length?q.grading_criteria:[{key:'total',label:'Question / section total',marks:q.marks}];
    return {position:q.position,title:q.section_title||`Question ${q.position}`,marks:Number(q.marks),instructions:q.grading_instructions||'',criteria:source.map((c:any)=>({key:`${q.position}:${c.key}`,label:c.label,marks:Number(c.marks),guidance:c.guidance||''}))};
  });
}

export function validateRubric(q:any):string|null {
  if(q.response_parts!==undefined){
    if(!manualTypes.includes(q.type)||!Array.isArray(q.response_parts)||!q.response_parts.length||q.response_parts.length>20)return 'Invalid response sections';
    const keys=new Set();let sum=0;for(const p of q.response_parts){if(!p||typeof p.key!=='string'||!/^\w{1,64}$/.test(p.key)||keys.has(p.key)||typeof p.label!=='string'||!p.label.trim()||typeof p.marks!=='number'||!Number.isFinite(p.marks)||p.marks<0||!manualTypes.includes(p.type))return 'Invalid response section';keys.add(p.key);sum+=p.marks;}
    if(Math.abs(sum-q.marks)>0.001)return 'Response section marks must add up to the question marks';
  }
  if(q.grading_criteria===undefined)return null;
  if(!manualTypes.includes(q.type)||!Array.isArray(q.grading_criteria)||!q.grading_criteria.length||q.grading_criteria.length>20)return 'Invalid section grading criteria';
  const keys=new Set();let sum=0;
  for(const c of q.grading_criteria){
    if(!c||typeof c.key!=='string'||!/^\w{1,64}$/.test(c.key)||keys.has(c.key)||typeof c.label!=='string'||!c.label.trim()||typeof c.marks!=='number'||!Number.isFinite(c.marks)||c.marks<0)return 'Invalid section grading criterion';
    keys.add(c.key);sum+=c.marks;
  }
  return Math.abs(sum-q.marks)>0.001?'Section criterion marks must add up to the question marks':null;
}

export function calculateSectionGrade(questions:any[],scores:any,automaticScore:number) {
  for(const q of questions){const error=validateRubric(q);if(error)throw Error(error);}
  const criteria=gradingSections(questions).flatMap(s=>s.criteria);
  if(!criteria.length)throw Error('No manually graded sections exist in this round');
  if(!scores||typeof scores!=='object'||Array.isArray(scores))throw Error('Enter marks for every section. Refresh the portal if you only see a total-score field.');
  const expected=new Set(criteria.map(c=>c.key));
  if(Object.keys(scores).some(key=>!expected.has(key)))throw Error('Unknown section in the submitted marks');
  let total=automaticScore;const checked:Record<string,number>={};
  for(const c of criteria){const value=scores[c.key];if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>c.marks||Math.abs(value*100-Math.round(value*100))>0.00001)throw Error(`Enter valid marks from 0 to ${c.marks} for ${c.label}`);checked[c.key]=value;total+=value;}
  return {reviewed_score:Math.round(total*100)/100,section_scores:checked};
}
