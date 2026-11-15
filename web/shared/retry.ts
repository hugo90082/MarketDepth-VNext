export function retryAfterMs(value:string|null,now=Date.now(),fallback=60000){
 const delay=value?(/^\d+(\.\d+)?$/.test(value)?Number(value)*1000:Date.parse(value)-now):0;
 return Number.isFinite(delay)&&delay>0?Math.max(fallback,delay):fallback;
}
export class ReconnectBackoff {
 private failures=0;private openedAt=0;
 opened(now=Date.now()){this.openedAt=now;}
 delay(now=Date.now(),blockedUntil=0){
  if(this.openedAt&&now-this.openedAt>=60000)this.failures=0;
  this.openedAt=0;
  return Math.max(blockedUntil-now,Math.min(60000,5000*2**Math.min(this.failures++,4)));
 }
}
