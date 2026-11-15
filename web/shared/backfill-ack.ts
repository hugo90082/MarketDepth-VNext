export type CompactHave={version:1;from:number;to:number;signature:string;bits:string};
export class HaveError extends Error{constructor(readonly code:'BAD_ACK'|'ACK_INDEX_CHANGED'){super(code);}}
const keysOf=(keys:readonly string[])=>[...new Set(keys)].sort();
async function signature(keys:string[],from:number,to:number){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([from,to,keys])));return [...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');}
export async function packHave(keys:readonly string[],held:ReadonlySet<string>,from:number,to:number):Promise<{have:string[]}|{haveCompact:CompactHave}>{
 const ordered=keysOf(keys);if(ordered.length>22000)throw new HaveError('BAD_ACK');
 if(ordered.length<=1024)return {have:ordered.filter(k=>held.has(k))};
 const bytes=new Uint8Array(Math.ceil(ordered.length/8));ordered.forEach((key,i)=>{if(held.has(key))bytes[i>>3]|=1<<(i%8);});
 return {haveCompact:{version:1,from,to,signature:await signature(ordered,from,to),bits:btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}};
}
export function validCompactHave(raw:any):raw is CompactHave{return raw?.version===1&&Number.isSafeInteger(raw.from)&&Number.isSafeInteger(raw.to)&&raw.from>=0&&raw.to>raw.from&&raw.to-raw.from<=4320*3600000+60000&&typeof raw.signature==='string'&&/^[a-f0-9]{64}$/.test(raw.signature)&&typeof raw.bits==='string'&&raw.bits.length<=4000&&/^[A-Za-z0-9_-]*$/.test(raw.bits);}
export async function unpackHave(raw:CompactHave,keys:readonly string[]){
 if(!validCompactHave(raw))throw new HaveError('BAD_ACK');const ordered=keysOf(keys);if(ordered.length>22000)throw new HaveError('BAD_ACK');
 if(await signature(ordered,raw.from,raw.to)!==raw.signature)throw new HaveError('ACK_INDEX_CHANGED');
 let binary:string;try{binary=atob(raw.bits.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-raw.bits.length%4)%4));}catch{throw new HaveError('BAD_ACK');}
 const length=Math.ceil(ordered.length/8);if(binary.length!==length||ordered.length%8&&length&&(binary.charCodeAt(length-1)>>(ordered.length%8)))throw new HaveError('BAD_ACK');
 return new Set(ordered.filter((_,i)=>!!(binary.charCodeAt(i>>3)&(1<<(i%8)))));
}
