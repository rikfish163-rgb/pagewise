import ipaddr from 'ipaddr.js';
// Hosted requests use the Worker's public egress (no VPC or service binding).
// Check both families on every call, fail closed, and never follow redirects.
export async function assertPublicProvider(host:string,lookup:typeof fetch=fetch){
 const answers=await Promise.all(['A','AAAA'].map(async type=>{
  const r=await lookup('https://cloudflare-dns.com/dns-query?name='+encodeURIComponent(host)+'&type='+type,{headers:{Accept:'application/dns-json'},signal:AbortSignal.timeout(5000),redirect:'error'});
  if(!r.ok)throw Error('DNS unavailable');
  const data=await r.json() as {Status:number;Answer?:{type:number;data:string}[]};
  if(data.Status!==0)throw Error('DNS unavailable');
  return (data.Answer??[]).filter(a=>a.type===1||a.type===28).map(a=>a.data);
 }));
 const addrs=answers.flat();
 if(!addrs.length||addrs.some(a=>!ipaddr.isValid(a)||ipaddr.parse(a).range()!=='unicast'))throw Error('not a public endpoint');
}
