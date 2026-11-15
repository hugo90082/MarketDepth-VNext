export const CORE_SYMBOLS = new Set(['BTC','ETH','SOL']);
export type Presence = {id:string;visible:boolean;monitor:boolean;at:number};
export function preferredOwner(peers:Presence[]):string|undefined {
 return [...peers].sort((a,b)=>Number(b.visible)-Number(a.visible)||a.id.localeCompare(b.id))[0]?.id;
}
export function monitorPresence(peers:Presence[]) {
 const monitors=peers.filter(p=>p.monitor);
 return {active:monitors.length>0,visible:monitors.some(p=>p.visible),soundOwner:preferredOwner(monitors)};
}
export function nextCoreTarget(now:number){return (Math.floor((now+1500)/30000)+1)*30000;}
export function sourceInWindow(capturedAt:number,target:number){return Math.abs(capturedAt-target)<=1500;}
