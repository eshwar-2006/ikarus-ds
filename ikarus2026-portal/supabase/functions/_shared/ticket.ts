const encoder=new TextEncoder();
const encode=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const decode=(value:string)=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
async function key(secret:string){return await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
export async function digest(secret:string,value:string){return encode(new Uint8Array(await crypto.subtle.sign('HMAC',await key(secret),encoder.encode(value))));}
export async function ticketChallenge(secret:string,team:any){
 const hash=await digest(secret,'ticket-id|'+team.registration_number.trim().toLowerCase());
 const payload=encode(encoder.encode(JSON.stringify({team_id:team.id,ticket_hash:hash,expires_at:Date.now()+300000})));
 return payload+'.'+await digest(secret,'ticket-confirm-v1|'+payload);
}
export async function readTicketChallenge(secret:string,challenge:string){
 try{
  const [payload,signature,...extra]=challenge.split('.');if(!payload||!signature||extra.length)return null;
  const valid=await crypto.subtle.verify('HMAC',await key(secret),decode(signature),encoder.encode('ticket-confirm-v1|'+payload));
  if(!valid)return null;const data=JSON.parse(new TextDecoder().decode(decode(payload)));
  if(typeof data.team_id!=='string'||typeof data.ticket_hash!=='string'||!Number.isFinite(data.expires_at)||data.expires_at<Date.now())return null;
  return data;
 }catch{return null;}
}
