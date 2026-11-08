const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'../ikarus2026-portal');
function loadTS(file,extras={}){
 const exports={};const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(source,{exports,require:id=>{if(id.startsWith('https:'))return {createClient:extras.createClient};return loadTS(path.resolve(path.dirname(file),id));},Response,Request,URL,console,Date,crypto:require('node:crypto').webcrypto,btoa,atob,TextEncoder,TextDecoder,...extras},{filename:file});return exports;
}
function database(tables){
 return {from(name){
  tables[name]??=[];let filters=[],mode='read',values,one=false,limit=Infinity;
  const q={select(){return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},lt(k,v){filters.push(r=>r[k]!=null&&r[k]<v);return q;},neq(k,v){filters.push(r=>r[k]!==v);return q;},in(k,v){filters.push(r=>v.includes(r[k]));return q;},order(){return q;},limit(n){limit=n;return q;},single(){one=true;return q;},maybeSingle(){one=true;return q;},insert(v){mode='insert';values=v;return q;},upsert(v){mode='upsert';values=v;return q;},update(v){mode='update';values=v;return q;},then(resolve,reject){try{
    let rows=tables[name].filter(r=>filters.every(f=>f(r))).slice(0,limit);
    if(mode==='insert'){const items=(Array.isArray(values)?values:[values]).map((v,i)=>({id:`new-${tables[name].length+i}`,...v}));if(name==='quiz_attempts'&&items.some(v=>tables[name].some(r=>r.quiz_id===v.quiz_id&&r.user_id===v.user_id)))return Promise.resolve({data:null,error:{code:'23505'}}).then(resolve,reject);tables[name].push(...items);rows=items;}
    if(mode==='update')rows.forEach(r=>Object.assign(r,values));
    if(mode==='upsert'){const existing=tables[name].find(r=>r.id===values.id);if(existing)Object.assign(existing,values);else tables[name].push({...values});rows=[existing||values];}
    return Promise.resolve({data:one?(rows[0]||null):rows,error:null}).then(resolve,reject);
  }catch(e){return Promise.reject(e).then(resolve,reject);}}};return q;
 },rpc:async(name,args)=>({data:name==='ikarus_ticket_rate_limit'?true:name==='ikarus_find_ticket'?(tables.teams||[]).filter(t=>t.registration_number.trim().toLowerCase()===args.p_ticket.trim().toLowerCase()&&['registered','checked_in'].includes(t.status)):null,error:null})};
}
function edge(name,tables,user={id:'team-1'}){
 let handler;const admin=database(tables);admin.auth={admin:{generateLink:async()=>({data:{user:{id:'ticket-user',email_confirmed_at:'2026-10-29T00:00:00Z'},properties:{hashed_token:'test-token'}},error:null})}};
 const auth={auth:{getUser:async token=>({data:{user:token==='valid'?user:null},error:null}),verifyOtp:async()=>({data:{session:{access_token:'ticket-session',refresh_token:'ticket-refresh'}},error:null})}};
 loadTS(path.join(root,'supabase/functions',name,'index.ts'),{Deno:{env:{get:name=>name==='SUPABASE_SERVICE_ROLE_KEY'?'service':'configured'},serve:fn=>handler=fn},createClient:(url,key)=>key==='service'?admin:auth});
 return async(body,method='POST',token='valid')=>{const response=await handler(new Request('http://test.local',{method,headers:token?{Authorization:`Bearer ${token}`}:{},...(method==='POST'?{body:JSON.stringify(body)}:{})}));const text=await response.text();return {status:response.status,headers:response.headers,body:text==='ok'?{}:JSON.parse(text)};};
}
module.exports={root,loadTS,database,edge};
