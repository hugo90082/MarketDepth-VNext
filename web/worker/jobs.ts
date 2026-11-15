import { CONTRACT, WINDOW, type Span } from '../shared/contract';
import {RESEARCH_RANGES} from '../shared/minute-history';
import { initialize, readSnapshot, type Env } from './db';
import { eligibleEnd, historyView, tickCollector, type HistoryState } from './history';

type Job={id:string;client:string;from_ts:number;to_ts:number;created_at:number;completed_at:number|null};
const cookieName='md_client';
export const clientCookie=(request:Request)=>{
 const raw=request.headers.get('cookie')?.match(/(?:^|;\s*)md_client=([a-f0-9-]{36})(?:;|$)/)?.[1];
 return raw&&/^[a-f0-9-]{36}$/.test(raw)?raw:null;
};
export const newClientCookie=(id:string)=>`${cookieName}=${id}; Path=/api; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`;
async function latest(db:D1Database,client:string){return db.prepare('SELECT * FROM md_jobs WHERE client=? AND completed_at IS NULL ORDER BY created_at DESC LIMIT 1').bind(client).first<Job>();}
async function byId(db:D1Database,id:string,client:string){return db.prepare('SELECT * FROM md_jobs WHERE id=? AND client=?').bind(id,client).first<Job>();}
const rangeFor=(hours:number,now:number)=>({from:Math.ceil((now-hours*3600000)/30000)*30000,to:eligibleEnd(now)});
export async function comparisonStatus(env:Env,client:string|null,hours:number,now=Date.now()){
 await initialize(env.DB);
 if(!(RESEARCH_RANGES as readonly number[]).includes(hours))throw new Error('BAD_RANGE');
 const range=rangeFor(hours,now),state=await readSnapshot<HistoryState>(env.DB,'v3-collector');
 const index=state?.index.filter(c=>c.endTsMs<=range.to&&c.endTsMs>range.from&&c.startTsMs<range.to)??[];
 const cached=new Set((await env.DB.prepare('SELECT id,sha FROM md_chunks').all<{id:string;sha:string}>()).results.map(c=>c.id+':'+c.sha));
 const last=client?await env.DB.prepare('SELECT * FROM md_jobs WHERE client=? AND completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 1').bind(client).first<Job>():null;
 const view=await historyView(env,[range],now,new Set(['*']));
 return {ok:true,...CONTRACT,eligibleTo:range.to,from:range.from,indexVersion:state?.indexVersion??null,indexed:state?.indexed??null,oldestAvailableTsMs:state?.oldest??null,
  chunks:index.map(c=>({id:c.id,sha256:c.sha256,startTsMs:c.startTsMs,endTsMs:c.endTsMs,cached:cached.has(c.id+':'+c.sha256)})),cacheComplete:view.meta.complete,
  lastCompleted:last?{id:last.id,from:last.from_ts,to:last.to_ts,at:last.completed_at,indexVersion:null}:null};
}
export async function startJob(env:Env,client:string,hours:number,now=Date.now()){
 await initialize(env.DB);
 if(!(RESEARCH_RANGES as readonly number[]).includes(hours))throw new Error('BAD_RANGE');
 const range=rangeFor(hours,now);
 const job:Job={id:crypto.randomUUID(),client,from_ts:range.from,to_ts:range.to,created_at:now,completed_at:null};
 if(job.to_ts<=job.from_ts||job.to_ts-job.from_ts>4320*3600000)throw new Error('BAD_RANGE');
 // One active job per browser, widened atomically when another tab requests more.
 // The collector lease serializes upstream I/O; there is no client cooldown.
 const active=await latest(env.DB,client);
 if(!active){
  const prior=await env.DB.prepare('SELECT * FROM md_jobs WHERE client=? AND completed_at IS NOT NULL AND from_ts<=? AND to_ts>=? ORDER BY completed_at DESC LIMIT 1').bind(client,job.from_ts,job.to_ts).first<Job>();
  if(prior)return {job:prior,cooldownUntil:0,reused:true};
 }
 await env.DB.prepare('INSERT INTO md_jobs(id,client,from_ts,to_ts,created_at) SELECT ?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM md_jobs WHERE client=? AND completed_at IS NULL)').bind(job.id,client,job.from_ts,job.to_ts,now,client).run();
 const existing=await latest(env.DB,client);
 if(!existing)throw new Error('JOB_STORAGE_UNAVAILABLE');
 await env.DB.prepare('UPDATE md_jobs SET from_ts=MAX(MIN(from_ts,?),MAX(to_ts,?)-?),to_ts=MAX(to_ts,?) WHERE id=?').bind(job.from_ts,job.to_ts,4320*3600000,job.to_ts,existing.id).run();
 return {job:(await byId(env.DB,existing.id,client))!,cooldownUntil:0,reused:existing.id!==job.id};
}
export async function viewJob(env:Env,id:string,client:string,now=Date.now(),have?:Set<string>){
 await initialize(env.DB);const job=await byId(env.DB,id,client);if(!job)return null;
 const before={from:job.from_ts,to:job.to_ts},cached=await historyView(env,[before],now,have);
 const oldest=cached.meta.oldestAvailableTsMs??before.from;
 const span:Span={from:Math.max(before.from,oldest),to:before.to};
 const view=span.from<span.to&&span.from!==before.from?await historyView(env,[span],now,have):cached;
 const complete=span.from>=span.to||view.meta.complete;
 const state=complete?await readSnapshot<HistoryState>(env.DB,'v3-collector'):null;
 const verificationIndex=state?.indexVersion===view.meta.indexVersion&&state?.indexed?{
  indexed:state.indexed,chunks:state.index.filter(c=>c.endTsMs<=eligibleEnd(now)&&c.endTsMs>before.from&&c.startTsMs<before.to).map(c=>({id:c.id,sha256:c.sha256,startTsMs:c.startTsMs,endTsMs:c.endTsMs}))
 }:null;
 if(complete&&!job.completed_at&&!have?.has('*')){const result=await env.DB.prepare('UPDATE md_jobs SET completed_at=? WHERE id=? AND completed_at IS NULL AND from_ts=? AND to_ts=?').bind(now,id,before.from,before.to).run();if(result.meta.changes)job.completed_at=now;}
 return {ok:true,...CONTRACT,job:{id:job.id,from:before.from,to:before.to,createdAt:job.created_at,completedAt:job.completed_at,complete,unavailableBefore:oldest>before.from?oldest:null},data:view.data,meta:{...view.meta,verificationIndex},cooldownUntil:0};
}
export async function advanceJob(env:Env,id:string,client:string,have?:Set<string>,authorize:()=>Promise<void>=async()=>{}){
 const current=await viewJob(env,id,client,Date.now(),new Set(['*']));if(!current)return null;
 if(!current.job.complete){const from=current.job.unavailableBefore??current.job.from;await tickCollector(env,[{from,to:current.job.to}],fetch,()=>Date.now(),true,authorize);}
 return viewJob(env,id,client,Date.now(),have);
}
