import {retryAfterMs} from './retry';
export function backfillFailure(status:number,retryAfter:string|null,now:number){
 return {stop:status>=400&&status<500&&![404,408,429].includes(status),reset:status===404,
  retryAt:now+(retryAfterMs(retryAfter,now,0)||(status===429?30000:5000))};
}
export function acknowledgeChunks(previous:Set<string>,loaded:string[],delivered:string[]){
 const received=new Set([...previous,...delivered]);
 return new Set(loaded.filter(key=>received.has(key)));
}
