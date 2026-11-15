/** Display clock only: never fetches data or replays missed timer callbacks. */
export class ViewportClock {
 private interval=0;private slot=0;private enabled=false;
 tick(at:number,interval:number,enabled:boolean){
  const slot=Math.floor(at/interval);
  if(!Number.isFinite(slot)||interval<=0)return 0;
  const continuing=this.interval===interval&&this.enabled&&enabled;
  const elapsed=continuing?Math.max(0,slot-this.slot):0;
  this.slot=this.interval===interval&&this.enabled===enabled?Math.max(this.slot,slot):slot;
  this.interval=interval;this.enabled=enabled;return elapsed;
 }
}

/** Preserve UTC position when a rolling grid drops its first cell or backfill
 * inserts earlier cells. Advancing adds cells without changing visible width. */
export function moveViewport(range:{from:number;to:number},oldOrigin:number,newOrigin:number,interval:number,steps:number){
 const delta=(oldOrigin-newOrigin)/interval+steps;
 return {from:range.from+delta,to:range.to+delta};
}
