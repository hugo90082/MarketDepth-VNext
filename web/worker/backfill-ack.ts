import {HaveError,unpackHave,validCompactHave} from '../shared/backfill-ack';
import {historyView} from './history';import type {Env} from './db';
export async function resolveHave(env:Env,body:{have?:unknown;haveCompact?:unknown}){
 if(body.haveCompact!==undefined){if(body.have!==undefined||!validCompactHave(body.haveCompact))throw new HaveError('BAD_ACK');const c=body.haveCompact,view=await historyView(env,[{from:c.from,to:c.to}],Date.now(),new Set(['*']));return unpackHave(c,view.meta.loadedChunkKeys);}
 if(body.have===undefined)return undefined;
 if(!Array.isArray(body.have)||body.have.length>4096||!body.have.every(x=>typeof x==='string'&&x.length<=180&&/:[a-f0-9]{64}$/.test(x)))throw new HaveError('BAD_ACK');
 return new Set<string>(body.have as string[]);
}
