const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const context={window:{}};vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../ikarus2026-portal/supabase-config.js'),'utf8'),context);
const base=context.window.IKARUS_SUPABASE_URL,key=context.window.IKARUS_SUPABASE_PUBLISHABLE_KEY;
(async()=>{
 for(const [name,url,options] of [
  ['Auth settings',`${base}/auth/v1/settings`,{headers:{apikey:key}}],
  ['Public results',`${base}/functions/v1/public-results`,{headers:{apikey:key}}],
  ...['start-quiz','save-quiz-progress','submit-quiz','publish-quiz','manage-results','list-published-quizzes','get-published-quiz'].map(name=>[`${name} CORS`,`${base}/functions/v1/${name}`,{method:'OPTIONS',headers:{Origin:'http://127.0.0.1:4173','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,apikey,content-type,x-client-info'}}])
 ]){
  try{const r=await fetch(url,{...options,signal:AbortSignal.timeout(10000)});const cors=r.headers.get('access-control-allow-headers');console.log(`${name}: HTTP ${r.status}${cors?' | '+cors:''}`);}catch(e){console.log(`${name}: ${e.cause?.code||e.message}`);process.exitCode=1;}
 }
})();
