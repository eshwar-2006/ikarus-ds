const {test}=require('node:test'),assert=require('node:assert/strict');
test('portal backup route forwards only authenticated allowed requests to the fixed backend',async()=>{
 const worker=(await import('../scripts/portal-worker.mjs')).default;
 const original=global.fetch;const calls=[];
 global.fetch=async(url,options)=>{calls.push({url,options});return new Response('{"success":true}',{status:200});};
 const req=(path,options={})=>new Request('https://portal.test'+path,options);
 const headers={Authorization:'Bearer team-session',apikey:'public-key',Origin:'https://portal.test','Content-Type':'application/json'};
 try{
  assert.equal((await worker.fetch(req('/api/submit-quiz',{method:'POST'}),{})).status,401);
  assert.equal((await worker.fetch(req('/api/unknown',{method:'POST',headers}),{})).status,404);
  assert.equal((await worker.fetch(req('/api/submit-quiz',{headers}),{})).status,405);
  assert.equal((await worker.fetch(req('/api/submit-quiz',{method:'POST',headers:{...headers,Origin:'https://other.test'}}),{})).status,403);
  assert.equal(calls.length,0);
  const response=await worker.fetch(req('/api/submit-quiz',{method:'POST',headers,body:'{"quiz_id":"q1","answers":{"1":"A"}}'}),{});
  assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal(calls[0].url,'https://faxiasqmetqvdompxoxz.supabase.co/functions/v1/submit-quiz');
  assert.equal(calls[0].options.headers.Authorization,'Bearer team-session');assert.equal(JSON.parse(calls[0].options.body).answers[1],'A');
  global.fetch=async()=>{throw Error('offline');};
  assert.equal((await worker.fetch(req('/api/submit-quiz',{method:'POST',headers,body:'{}'}),{})).status,503);
  const asset=await worker.fetch(req('/app.js'),{ASSETS:{fetch:async()=>new Response('asset')}});assert.equal(await asset.text(),'asset');
 }finally{global.fetch=original;}
});
