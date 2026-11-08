const {execFileSync}=require('node:child_process');
const run=args=>JSON.parse(execFileSync('npx.cmd',['--offline','--cache','.npm-cache','wrangler',...args],{shell:true,encoding:'utf8',stdio:['ignore','pipe','pipe']}));
(async()=>{
 const auth=run(['auth','token','--json']),identity=run(['whoami','--json']);
 for(const account of identity.accounts){
  for(const endpoint of ['workers/scripts','workers/subdomain','workers/domains']){
   const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account.id}/${endpoint}`,{headers:{Authorization:`Bearer ${auth.token}`},signal:AbortSignal.timeout(30000)});
   if(!response.ok)throw Error(`Cloudflare lookup ${endpoint}: HTTP ${response.status}`);
   const data=await response.json();
   console.log(JSON.stringify({account:account.id,endpoint,result:endpoint==='workers/scripts'?data.result.map(x=>({id:x.id,modified_on:x.modified_on})):data.result}));
  }
 }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
