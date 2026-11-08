// Fixed upstream and explicit routes: this cannot proxy arbitrary URLs or use server credentials.
const upstream = 'https://faxiasqmetqvdompxoxz.supabase.co/functions/v1/';
const routes = new Set(['start-quiz','save-quiz-progress','submit-quiz','report-quiz-event','list-published-quizzes','get-published-quiz']);
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const name = url.pathname.slice(5);
    const headers = {'Content-Type':'application/json','Cache-Control':'no-store'};
    if (!routes.has(name)) return new Response(JSON.stringify({error:'Unknown route'}),{status:404,headers});
    if (request.method !== 'POST') return new Response(JSON.stringify({error:'POST required'}),{status:405,headers});
    if (request.headers.get('Origin') && request.headers.get('Origin') !== url.origin) return new Response(JSON.stringify({error:'Origin rejected'}),{status:403,headers});
    if (!request.headers.get('Authorization') || !request.headers.get('apikey')) return new Response(JSON.stringify({error:'Authentication required'}),{status:401,headers});
    try {
      const response = await fetch(upstream + name, {
        method:'POST', headers:{Authorization:request.headers.get('Authorization'),apikey:request.headers.get('apikey'),'Content-Type':'application/json'},
        body:await request.text(), redirect:'manual', signal:AbortSignal.timeout(20000)
      });
      if(response.status>=300&&response.status<400)throw new Error('Unexpected upstream redirect');
      return new Response(response.body,{status:response.status,headers});
    } catch (error) {
      console.error('Quiz upstream transport failure:',error.name,error.message);
      return new Response(JSON.stringify({error:'Connection interrupted. Your answers are kept on this device; retrying is safe.'}),{status:503,headers});
    }
  }
};
