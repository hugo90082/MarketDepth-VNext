type State={nextAllowedAt:number;blockedUntil:number;priorityAt?:number;priorityUntil?:number};
type Job<T>={priority:number;cost:number;signal?:AbortSignal;resolve:(state:T)=>void;reject:(error:unknown)=>void;abort?:()=>void};
/** Reserve only when dispatched so pending ordinary work cannot pre-reserve
 * the three core assets' entire sampling window. Exchange limits still apply. */
export function createReservationQueue<T extends State>(state:T,now=Date.now){
 const jobs:Job<T>[]= [];let timer:ReturnType<typeof setTimeout>|undefined;
 function pump(){
  clearTimeout(timer);if(!jobs.length)return;
  const delay=Math.max(state.nextAllowedAt,state.blockedUntil)-now();
  if(delay>0){timer=setTimeout(pump,delay);return;}
  jobs.sort((a,b)=>b.priority-a.priority);
  const candidate=jobs[0];
  if(!candidate.priority&&state.priorityAt!==undefined&&state.priorityUntil!==undefined&&now()<state.priorityUntil&&now()+candidate.cost>state.priorityAt){timer=setTimeout(pump,state.priorityUntil-now());return;}
  const job=jobs.shift()!;
  job.signal?.removeEventListener('abort',job.abort!);state.nextAllowedAt=now()+job.cost;job.resolve(state);pump();
 }
 return (cost:number,priority=0,signal?:AbortSignal)=>new Promise<T>((resolve,reject)=>{
  if(signal?.aborted){reject(signal.reason);return;}
  const job:Job<T>={cost,priority,signal,resolve,reject};job.abort=()=>{const i=jobs.indexOf(job);if(i>=0)jobs.splice(i,1);reject(signal?.reason);pump();};
  signal?.addEventListener('abort',job.abort,{once:true});jobs.push(job);pump();
 });
}
