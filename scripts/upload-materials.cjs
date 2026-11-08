const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {root,url,key}=require('./supabase-admin.cjs')();
async function fetchRetry(endpoint,options){for(let i=0;i<3;i++){try{return await fetch(endpoint,{...options,signal:AbortSignal.timeout(60000)});}catch(e){if(i===2)throw e;}}}
(async()=>{
 const files=fs.readdirSync(path.join(root,'private-materials')).filter(name=>name.endsWith('.pdf'));
 for(const name of files){
  const competition=name.startsWith('techlift-')?'TECHLIFT':name.startsWith('dataquest-')?'DATAQUEST':'AI_NEXUS';
  const object=`uploads/${competition}/${name}`,endpoint=`${url}/storage/v1/object/competition-materials/${object}`;
  const headers={apikey:key,Authorization:`Bearer ${key}`};
  const data=fs.readFileSync(path.join(root,'private-materials',name));
  let remote=await fetchRetry(endpoint,{headers});
  if(remote.status===404||remote.status===400){
   const uploaded=await fetchRetry(endpoint,{method:'POST',headers:{...headers,'Content-Type':'application/pdf','x-upsert':'false'},body:data});
   if(!uploaded.ok&&uploaded.status!==409)throw Error(`Upload failed for ${name}: HTTP ${uploaded.status}`);
   remote=await fetchRetry(endpoint,{headers});
  }
  if(!remote.ok)throw Error(`Could not verify ${name}: HTTP ${remote.status}`);
  const hash=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
  if(hash(Buffer.from(await remote.arrayBuffer()))!==hash(data))throw Error(`Existing material differs: ${object}. It was not overwritten.`);
  console.log(`Verified private material: ${object}`);
 }
 console.log(`${files.length} private PDFs verified.`);
})().catch(e=>{console.error(e.message);process.exitCode=1;});
