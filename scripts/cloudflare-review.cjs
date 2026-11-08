const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const run=args=>JSON.parse(execFileSync('npx.cmd',['--offline','--cache','.npm-cache','wrangler',...args],{cwd:root,shell:true,encoding:'utf8',stdio:['ignore','pipe','pipe']}));
async function get(url,options={}){for(let i=0;i<3;i++){try{return await fetch(url,{...options,signal:AbortSignal.timeout(30000)});}catch(e){if(i===2)throw e;}}}
(async()=>{
 const auth=run(['auth','token','--json']),identity=run(['whoami','--json']);const account=identity.accounts.find(a=>a.id==='0606e9b22cc875047f2469943ed46461');if(!account)throw Error('Expected IKARUS Cloudflare account is unavailable');
 fs.mkdirSync(path.join(root,'.private-backups'),{recursive:true});
 for(const name of ['ikarus-2026-portal','ikarus-2026-portal-v2']){
  const base=`https://api.cloudflare.com/client/v4/accounts/${account.id}/workers/scripts/${name}`;
  const settings=await (await get(base+'/settings',{headers:{Authorization:`Bearer ${auth.token}`}})).json();
  console.log(JSON.stringify({name,settings:{compatibility_date:settings.result?.compatibility_date,assets:settings.result?.assets,bindings:settings.result?.bindings?.map(b=>({name:b.name,type:b.type})),keys:Object.keys(settings.result||{})}}));
  const content=await get(base+'/content',{headers:{Authorization:`Bearer ${auth.token}`}});if(content.ok)fs.writeFileSync(path.join(root,'.private-backups',`${name}-worker-content`),Buffer.from(await content.arrayBuffer()));
  const deployed=await get(`https://${name}.kathrotheeshwar.workers.dev`);const html=await deployed.text();fs.writeFileSync(path.join(root,'.private-backups',`${name}-index.html`),html);
  console.log(JSON.stringify({name,status:deployed.status,title:html.match(/<title>(.*?)<\/title>/is)?.[1],size:html.length,scripts:[...html.matchAll(/<script[^>]*src=["']([^"']+)/g)].map(m=>m[1]),hasTeamPortal:html.includes('teamLogin'),hasPublicResults:html.includes('publicResults')}));
 }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
