import type {BookConnection} from './runtime/books';
import {marketRuntime} from './runtime/client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ASSETS, VENUES, validateRows, type Asset, type HistoryPayload,type Venue } from '../shared/model';
import { CONTRACT, aggregateCandles, mergeRecentGap, type Span, type Interval, type StoredRow, type StoredCandle } from '../shared/contract';
import { retryAfterMs } from '../shared/retry';
import { validCandle } from '../shared/chart-data';
import {idleManual,type ManualAction,type ComparisonSelection} from '../shared/manual-action';
import { parseKlines } from '../shared/klines';
import * as storage from './storage';
import { blockSignature, statusAfterCompletedJob, type ComparisonStatus, type IndexedChunk, type VerifiedBlock } from './history-quality';
import type { historyView } from '../worker/history';
import { AUTH_REQUIRED_EVENT } from './site-api';
import {localMaintenance} from './local-maintenance';
import {marketHistoryRuntime} from './market-history/runtime';
import {
 fetchVNextDays,
 fetchVNextHistoryKind,
 groupSpotRowsToStoredRows,
 mapFutures1mToStoredCandles,
 type VNextSpotRow,
 type VNextFutures1mRow,
} from './vnext-adapter';
import { splitTaipeiSpans } from './strategy/replay-helpers';

type Backfill=Awaited<ReturnType<typeof historyView>>;
type Coverage=Partial<Record<Asset,{bidBps:number;askBps:number;at:number;snapshotAt?:number;observedBidBps?:number;observedAskBps?:number;coverageMode?:'sequenced-diff'}|null>>;
type ManualJob={ok:true;job:{id:string;from:number;to:number;createdAt:number;completedAt:number|null;complete:boolean;unavailableBefore:number|null};data:StoredRow[];meta:Backfill['meta']&{verificationIndex?:{indexed:Span;chunks:Omit<IndexedChunk,'cached'>[]}|null};cooldownUntil:number};
const pending={state:'starting' as const,lastSuccessAtMs:null,error:null};
const BLOCK_MS = 15 * 60_000;
const MANUAL_SLICE_MS = 6 * 3_600_000;

function parseDayStartMs(day: string): number {
 const t = Date.parse(`${day}T00:00:00Z`);
 return Number.isFinite(t) ? t : 0;
}

export function useMarketEngine(asset:Asset,hours:number,interval:Interval=60000,assets:readonly Asset[]=[asset],view:{venue:Venue;zones:number[][]}={venue:'all4',zones:[[0,1,2],[0,1,2,3,4]]}){
 const windowKey=assets.join(',')+':'+hours;const windowRevision=useRef({key:windowKey,value:0});if(windowRevision.current.key!==windowKey)windowRevision.current={key:windowKey,value:windowRevision.current.value+1};
 const viewKey=windowKey+':'+interval+':'+view.venue+':'+JSON.stringify(view.zones);
 const current=useRef({asset,hours,assets,interval,view,viewKey,revision:0});current.current={asset,hours,assets,interval,view,viewKey,revision:windowRevision.current.value};
 const [rows,setRows]=useState<StoredRow[]>([]),[rawCandles,setCandles]=useState<StoredCandle[]>([]);
 const [liveCandles,setLiveCandles]=useState<StoredCandle[]>([]);
 const [connections,setConnections]=useState<Record<string,BookConnection>>({});
 const [coverage,setCoverage]=useState<Coverage>({});
 const [backfill,setBackfill]=useState<Backfill|null>(null),[storageError,setStorageError]=useState('');
 const [comparison,setComparison]=useState<ComparisonStatus|null>(null),[verifiedBlocks,setVerifiedBlocks]=useState<VerifiedBlock[]>([]);
 const [historyError,setHistoryError]=useState('');
 const [manual,setManual]=useState<ManualJob|null>(null);
 const [manualStats,setManualStats]=useState({recovered:0,backendMissing:0});
 const [manualAction,setManualAction]=useState<ManualAction>(idleManual);
 const [bytes,setBytes]=useState(0),[busy,setBusy]=useState(true),[now,setNow]=useState(Date.now());
 const [errors,setErrors]=useState({history:false,recent:false,price:false});
 const [priceErrors,setPriceErrors]=useState<Partial<Record<Asset,boolean>>>({});
 const refreshRef=useRef(()=>{}),compareRef=useRef<(selection?:ComparisonSelection)=>void>(()=>{}),priceAt=useRef<Record<string,number>>({});
 useEffect(()=>{
  let stopped=false,worker:ReturnType<typeof marketRuntime.research>|null=null,leader=false,running=false,historyStopped=false,authPaused=false,priceRetry=0,manualId:string|null=null;
  let starting=false,restoring=true,nextPriceScan=0,nextRepair=0,dataRevision=0,lastRead='',reading:Promise<void>|null=null;
  let historyFatal=false;
  let statusKey='',statusBusy=false;
  let totals={recovered:0,backendMissing:0};
  let timer:ReturnType<typeof setTimeout>,releaseLock:(()=>void)|undefined;
  const owner=crypto.randomUUID(),controller=new AbortController(),candleBuffer=new Map<string,StoredCandle>();
  const liveBuffer=new Map<string,StoredCandle>();
  const channel=marketRuntime.researchChannel();
  const peers=new Map<string,{hours:number;at:number}>();
  let recentFallbackTarget=0,recentFallbackRunning=false,recentFallbackTimer:ReturnType<typeof setTimeout>|undefined;
  const signal=()=>AbortSignal.any([controller.signal,AbortSignal.timeout(45000)]);
  const manualSignal=()=>AbortSignal.any([controller.signal,AbortSignal.timeout(90000)]);

  async function fillLiveGap(row:StoredRow,attempt=0){
   const missing=current.current.assets.some(a=>{const ai=ASSETS.indexOf(a);return !(row.quality?.books[0]?.[ai]&&row.captured?.[0]?.[ai])&&row.d[0][ai].some(zone=>zone.some(value=>value===null));});
   if(stopped||authPaused||recentFallbackRunning||row.t<recentFallbackTarget||(row.t===recentFallbackTarget&&attempt===0)||!missing)return;
   if(row.t>recentFallbackTarget){clearTimeout(recentFallbackTimer);recentFallbackTarget=row.t;}
   recentFallbackRunning=true;let retryMs=0;
   try{
    const spotRows=await fetchVNextHistoryKind<VNextSpotRow>('spot_depth',row.t,row.t+60000,signal());
    const grouped=groupSpotRowsToStoredRows(spotRows);
    const canonical=validateRows(grouped);
    if(canonical.length){
     const local=new Map((await storage.loadRows(canonical[0].t,canonical.at(-1)!.t)).map(value=>[value.t,value]));
     await storage.save(canonical.map(value=>mergeRecentGap(local.get(value.t),value)));
     dataRevision++;
     channel?.postMessage({type:'changed'});
    }else{
     retryMs=3000;
    }
   }catch{retryMs=5000;}finally{recentFallbackRunning=false;if(retryMs&&attempt<5&&!stopped&&recentFallbackTarget===row.t)recentFallbackTimer=setTimeout(()=>void fillLiveGap(row,attempt+1),retryMs);}
  }

  const startWorker=()=>{
   if(stopped||worker)return;leader=true;worker=marketRuntime.research();
   worker.onmessage=e=>{const m=e.data;if(m.type==='book-status'){if(m.state.market==='usdm')return;setConnections(old=>({...old,[m.state.exchange+':'+m.state.symbol]:m.state}));return;}if(m.type==='auth-required'){window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));return;}if(m.type==='row'){setCoverage(m.coverage??{});channel?.postMessage({type:'coverage',coverage:m.coverage??{}});setErrors(e=>({...e,recent:!!m.row.issues?.length}));setRows(old=>old.some(r=>r.t===m.row.t&&r.source!=='browser')?old:[...old.filter(r=>r.t!==m.row.t&&r.t>=Date.now()-current.current.hours*3600000),m.row].sort((a,b)=>a.t-b.t));setBusy(false);if(!leader)return;const stamp=marketRuntime.collectorStamp();if(!marketRuntime.isCollector(stamp))return;void storage.save([m.row],[],true,{term:stamp!.epoch,current:()=>marketRuntime.isCollector(stamp)}).then(async()=>{if(!marketRuntime.isCollector(stamp))return;dataRevision++;channel?.postMessage({type:'changed'});await readLocal();}).catch(storageFail);}
    if(m.type==='candle'){const c={...m.candle,observedAt:m.at??m.candle.observedAt};if(!validCandle(c))return;candleBuffer.set(`${c.asset}:${c.interval}:${c.t}`,c);liveBuffer.set(`${c.asset}:${c.interval}`,c);if(m.at)priceAt.current[c.asset]=m.at;}
   };
   worker.onerror=()=>{setErrors(e=>({...e,recent:true,price:true}));};worker.postMessage('start');
  };
  const storageFail=(e:unknown)=>{if(!stopped)setStorageError(e instanceof Error?e.message:'瀏覽器儲存空間無法使用');};
  async function readLocal(){
   if(reading)return reading;
   const end=Date.now(),{assets:selected,hours:h,revision,interval:chosen,view:selection,viewKey:readView}=current.current;
   const readRevision=dataRevision;
   const key=`${readView}:${Math.floor(end/60000)}:${readRevision}`;if(key===lastRead)return;
   reading=(async()=>{const [r,c,b,proof]=await Promise.all([storage.loadRowsView(end-h*3600000,end,chosen,{...selection,assets:selected}),Promise.all(selected.map(a=>storage.loadCandlesView(a,Math.floor((end-h*3600000)/chosen)*chosen,end,chosen))),storage.getMeta<number>('bytes'),storage.verifiedBlocks()]);
    if(stopped||revision!==current.current.revision||readView!==current.current.viewKey)return;
    lastRead=key;setRows(r);setCandles(c.flat());setBytes(b??0);setVerifiedBlocks(proof);setNow(end);setBusy(false);if(storage.storageNotice())setStorageError(storage.storageNotice());
   })();try{await reading;}finally{reading=null;if(!stopped&&(revision!==current.current.revision||readView!==current.current.viewKey||readRevision!==dataRevision))void readLocal().catch(storageFail);}
  }
  async function fillPrices(h:number){
   h=localMaintenance.requestedHours();if(!h)return;
   const stamp=marketRuntime.collectorStamp(),revision=current.current.revision;const valid=()=>!stopped&&marketRuntime.isCollector(stamp)&&revision===current.current.revision;if(!valid())return;
   if(await storage.getMeta('quotaBlocked')||Date.now()<priceRetry||Date.now()<nextPriceScan)return;nextPriceScan=Date.now()+30000;
   const end=Math.floor(Date.now()/60000)*60000,from=Math.floor((end-h*3600000)/900000)*900000;
   const results=await Promise.allSettled(ASSETS.map(async a=>{
    let first=await storage.firstMissingCandle(a,from,end);if(first===null||!valid())return;
    for(let read=0;read<8;read++){
     const checked:number=first;await marketHistoryRuntime.beforeCandleFetch(checked);if(!valid())return;
     first=await storage.firstMissingCandle(a,from,end);if(first===null)return;
     if(first===checked)break;if(read===7)return;
    }
    const until=await marketHistoryRuntime.candleFetchBoundary(first,end,a);if(!valid()||until<=first)return;
    const request={startTime:first,endTime:until-1,limit:(until-first)/60000};
    const response=await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${a}USDT&interval=1m&startTime=${request.startTime}&endTime=${request.endTime}&limit=${request.limit}`,{signal:signal(),credentials:'omit'});
    if(!response.ok){priceRetry=Date.now()+retryAfterMs(response.headers.get('retry-after'));throw new Error(`HTTP ${response.status}`);}
    const received=parseKlines(await response.json(),a,Date.now()).map(c=>({...c,source:'binance-usdm' as const}));if(!valid())return;
    if(!received.length){priceRetry=Date.now()+60000;throw new Error('KLINE_NO_PROGRESS');}
    await storage.save([],received,true,{term:stamp!.epoch,current:valid});if(valid()){dataRevision++;}
   }));
   if(!valid())return;const failed=results.some(r=>r.status==='rejected');if(failed)priceRetry=Math.max(priceRetry,Date.now()+30000);if(!stopped){setPriceErrors(Object.fromEntries(ASSETS.map((a,i)=>[a,results[i].status==='rejected'])));setErrors(e=>({...e,price:failed}));}
  }

  async function buildComparisonStatus(h:number, sig:AbortSignal):Promise<ComparisonStatus>{
   const days=await fetchVNextDays('2026-01-01','2026-12-31',sig);
   const nowMs=Date.now();
   const eligibleTo=Math.floor(nowMs/BLOCK_MS)*BLOCK_MS;
   const from=Math.floor((eligibleTo-h*3600000)/BLOCK_MS)*BLOCK_MS;
   const dayStarts=days.map(d=>d.from||parseDayStartMs(d.day)).filter(t=>t>0).sort((a,b)=>a-b);
   const oldestAvailableTsMs=dayStarts.length?dayStarts[0]:from;
   const indexedFrom=Math.min(from,oldestAvailableTsMs);
   const chunks:IndexedChunk[]=[];
   for(let start=Math.max(from,oldestAvailableTsMs);start<eligibleTo;start+=BLOCK_MS){
    const end=start+BLOCK_MS;
    chunks.push({
     id:`vnext-${start}`,
     startTsMs:start,
     endTsMs:end,
     sha256:`vnext-${start}-${end}`,
     cached:true,
    });
   }
   const indexVersion=days.length;
   return {
    ok:true,
    from,
    eligibleTo,
    indexVersion,
    indexed:{from:indexedFrom,to:eligibleTo},
    oldestAvailableTsMs,
    chunks,
    cacheComplete:true,
    lastCompleted:comparison?.lastCompleted??null,
   };
  }

  async function refreshComparisonStatus(force=false):Promise<ComparisonStatus|null>{
   const h=current.current.hours,key=`${h}:${Math.floor((Date.now()-900000)/900000)}`;
   if(statusBusy||!force&&statusKey===key)return null;
   statusBusy=true;
   try{
    const data=await buildComparisonStatus(h,signal());
    statusKey=key;if(!stopped){setComparison(data);setHistoryError(old=>old.startsWith('歷史比對狀態')?'':old);}return data;
   }catch{if(!stopped)setHistoryError('歷史比對狀態暫時無法讀取');return null;}
   finally{statusBusy=false;}
  }

  async function startManual(selection?:ComparisonSelection,hours=current.current.hours){
   if(starting)return;
   if(historyFatal){setManualAction({phase:'error',message:'歷史寫入或格式驗證失敗；請處理儲存問題並重新整理',until:0,blocked:true});return;}
   if(restoring){setManualAction({phase:'waiting',message:'正在恢復歷史工作，請稍後再試',until:Date.now()+1000});return;}
   if(Date.now()<nextRepair){setManualAction({phase:'waiting',message:'歷史服務要求等待，時間到後可重試',until:nextRepair});return;}
   starting=true;historyStopped=false;authPaused=false;setHistoryError('');setManualAction({phase:'starting',message:'正在檢查 VNext 封存狀態並準備比對…',until:0});
   try{
    const status=await buildComparisonStatus(hours,manualSignal());
    setComparison(status);
    const chosen=selection??{asset:current.current.asset,venue:current.current.view.venue,zones:current.current.view.zones[0]};
    const startFrom=Math.max(status.from,status.oldestAvailableTsMs??status.from);
    const endTo=status.eligibleTo;
    let recovered=0,backendMissing=0;
    const slices=splitTaipeiSpans(startFrom,endTo,MANUAL_SLICE_MS);
    for(let i=0;i<slices.length;i++){
     if(stopped)return;
     const slice=slices[i];
     setManualAction({phase:'starting',message:`正在從 VNext 同步 ${chosen.asset} 歷史資料 · 區段 ${i+1}/${slices.length}`,until:0});
     const spotRows=await fetchVNextHistoryKind<VNextSpotRow>('spot_depth',slice.from,slice.to,{signal:manualSignal(),priority:'high'});
     const f1mRows=await fetchVNextHistoryKind<VNextFutures1mRow>('futures_1m',slice.from,slice.to,{signal:manualSignal(),priority:'high'});
     const grouped=groupSpotRowsToStoredRows(spotRows);
     const canonical=validateRows(grouped).map(r=>({...r,source:'railway' as const,format:CONTRACT.datasetFormat,...(status.indexVersion!==null?{finalVersion:status.indexVersion}:{})}));
     const candles=mapFutures1mToStoredCandles(f1mRows);
     const local=new Map((canonical.length?await storage.loadRows(canonical[0].t,canonical.at(-1)!.t):[]).map(r=>[r.t,r]));
     for(const row of canonical)for(let venue=0;venue<4;venue++)for(let assetIdx=0;assetIdx<3;assetIdx++)for(let zone=0;zone<5;zone++)for(let side=0;side<2;side++){
      const value=row.d[venue][assetIdx][zone][side],previous=local.get(row.t)?.d[venue][assetIdx][zone][side];
      if(value===null)backendMissing++;else if(previous===undefined||previous===null)recovered++;
     }
     if(canonical.length||candles.length){
      await storage.save(canonical,candles);
      dataRevision++;
     }
    }
    const checkedAt=Date.now();
    await storage.confirm([{from:status.from,to:endTo}]);
    const existingBlocks=await storage.verifiedBlocks();
    const byBase=new Map<number,VerifiedBlock>(existingBlocks.map(b=>[b.base,b]));
    const fullMask=(1<<30)-1;
    for(const chunk of status.chunks){
     const base=chunk.startTsMs;
     byBase.set(base,{
      base,
      signature:blockSignature(status.chunks,base),
      confirmedMask:fullMask,
      presentMask:fullMask,
      checkedAt,
      indexVersion:status.indexVersion??1,
     });
    }
    const proof=[...byBase.values()].sort((a,b)=>a.base-b.base);
    await storage.saveVerifiedBlocks(proof);
    setVerifiedBlocks(proof);
    const jobId=`vnext-job-${checkedAt}`;
    const completedStatus:ComparisonStatus={
     ...status,
     lastCompleted:{id:jobId,from:status.from,to:endTo,at:checkedAt,indexVersion:status.indexVersion??1},
    };
    setComparison(statusAfterCompletedJob(completedStatus,checkedAt,current.current.hours));
    totals={recovered,backendMissing};
    const jobData:ManualJob={
     ok:true,
     job:{id:jobId,from:status.from,to:endTo,createdAt:checkedAt,completedAt:checkedAt,complete:true,unavailableBefore:status.oldestAvailableTsMs},
     data:[],
     meta:{
      schema:CONTRACT.schema,
      datasetFormat:CONTRACT.datasetFormat,
      depthUnit:CONTRACT.depthUnit,
      quoteToUSDPolicy:CONTRACT.quoteToUSDPolicy,
      indexVersion:status.indexVersion,
      receivedChunks:status.chunks.length,
      totalChunks:status.chunks.length,
      complete:true,
      indexReady:true,
      oldestAvailableTsMs:status.oldestAvailableTsMs,
      nextAllowedAt:checkedAt,
      confirmed:[{from:status.from,to:endTo}],
      loadedChunkKeys:status.chunks.map(c=>`${c.id}:${c.sha256}`),
      deliveredChunks:[],
      connection:{state:'ok',lastSuccessAtMs:checkedAt,error:null},
     } as any,
     cooldownUntil:checkedAt,
    };
    const action:ManualAction={phase:'done',message:'本輪比對完成',until:0};
    if(!stopped){
     setManual(jobData);
     setManualStats(totals);
     setBackfill(jobData);
     setHistoryError('');
     setManualAction(action);
     setErrors(e=>({...e,history:false}));
    }
    void marketHistoryRuntime.comparisonComplete(jobId);
    channel?.postMessage({type:'job-state',manual:{...jobData,data:[]},stats:totals,action});
    channel?.postMessage({type:'changed'});
    await readLocal();
   }catch(error){
    nextRepair=Math.max(nextRepair,Date.now()+2000);
    const message=authPaused?'歷史授權尚未完成，可重新啟動比對':error instanceof Error&&error.name==='TimeoutError'?'比對請求逾時，請重試':error instanceof Error?error.message:'比對失敗，請重試';
    setHistoryError(message);
    setManualAction({phase:'error',message,until:nextRepair,blocked:historyFatal});
    setErrors(e=>({...e,history:true}));
   }finally{starting=false;}
  }

  let nextRecentVNextSync=0,nextGapHealAt=0,nextVNextVersionAt=0,lastHealHours=0,vnextVersion=1;
  const repairedBucketAt=new Map<number,number>();
  async function syncRecentVNext(){
   if(stopped||authPaused||Date.now()<nextRecentVNextSync)return;
   nextRecentVNextSync=Date.now()+15000;
   try{
    const now=Date.now();
    if(now>=nextVNextVersionAt){
     nextVNextVersionAt=now+300_000;
     try{
      const days=await fetchVNextDays('2026-01-01','2026-12-31',signal());
      if(days.length>vnextVersion)vnextVersion=days.length;
     }catch{}
    }
    const to=Math.ceil(now/60000)*60000;
    const from=to-15*60000;
    const [spotRows,f1mRows]=await Promise.all([
     fetchVNextHistoryKind<VNextSpotRow>('spot_depth',from,to,signal()),
     fetchVNextHistoryKind<VNextFutures1mRow>('futures_1m',from,to,signal()),
    ]);
    if(stopped)return;
    const grouped=groupSpotRowsToStoredRows(spotRows);
    const canonical=validateRows(grouped).map(r=>({...r,source:'railway' as const,format:CONTRACT.datasetFormat,finalVersion:vnextVersion}));
    const candles=mapFutures1mToStoredCandles(f1mRows);
    let savedAny=false;
    if(canonical.length||candles.length){
     await storage.save(canonical,candles);
     savedAny=true;
    }
    const viewHours=Math.min(24,Math.max(1,current.current.hours));
    if(!stopped&&!authPaused&&(Date.now()>=nextGapHealAt||viewHours>lastHealHours)){
     nextGapHealAt=Date.now()+60_000;
     lastHealHours=viewHours;
     const scanTo=Math.floor(from/BLOCK_MS)*BLOCK_MS;
     const scanFrom=Math.floor((to-viewHours*3600_000)/BLOCK_MS)*BLOCK_MS;
     if(scanTo>scanFrom){
      const viewAsset=current.current.asset;
      const ai=Math.max(0,ASSETS.indexOf(viewAsset));
      const viewVenue=current.current.view.venue;
      const vi=viewVenue==='all4'?-1:VENUES.indexOf(viewVenue);
      const [localRows,localCandles]=await Promise.all([
       storage.loadRows(scanFrom,scanTo-1),
       storage.loadCandles(viewAsset,scanFrom,scanTo-1),
      ]);
      const spotBuckets=new Map<number,number>();
      for(const r of localRows){
       if(r.cadence!==60000)continue;
       const ok=vi<0
        ?VENUES.every((_,idx)=>r.d[idx]?.[ai]?.some(([bid,ask])=>bid!==null&&ask!==null))
        :r.d[vi]?.[ai]?.some(([bid,ask])=>bid!==null&&ask!==null);
       if(!ok)continue;
       const base=Math.floor(r.t/BLOCK_MS)*BLOCK_MS;
       spotBuckets.set(base,(spotBuckets.get(base)??0)+1);
      }
      const candleBuckets=new Map<number,number>();
      for(const c of localCandles){
       if(c.interval!==60000||!c.closed||!c.complete)continue;
       const base=Math.floor(c.t/BLOCK_MS)*BLOCK_MS;
       candleBuckets.set(base,(candleBuckets.get(base)??0)+1);
      }
      const healNow=Date.now();
      const missingSpans:{from:number;to:number}[]=[];
      for(let b=scanFrom;b<scanTo;b+=BLOCK_MS){
       const prevTry=repairedBucketAt.get(b)??0;
       if(healNow-prevTry<300_000)continue;
       if((spotBuckets.get(b)??0)>=15&&(candleBuckets.get(b)??0)>=15)continue;
       const prev=missingSpans.at(-1);
       const sameTaipeiDay=prev&&Math.floor((prev.from+8*3600_000)/86_400_000)===Math.floor((b+8*3600_000)/86_400_000);
       if(prev&&sameTaipeiDay&&prev.to===b&&prev.to-prev.from<6*3600_000)prev.to=b+BLOCK_MS;
       else if(missingSpans.length<2)missingSpans.push({from:b,to:b+BLOCK_MS});
      }
      for(const span of missingSpans){
       if(stopped||authPaused)break;
       for(let b=span.from;b<span.to;b+=BLOCK_MS)repairedBucketAt.set(b,healNow);
       const [gapSpot,gapF1m]=await Promise.all([
        fetchVNextHistoryKind<VNextSpotRow>('spot_depth',span.from,span.to,signal()),
        fetchVNextHistoryKind<VNextFutures1mRow>('futures_1m',span.from,span.to,signal()),
       ]);
       if(stopped)return;
       const gapRows=validateRows(groupSpotRowsToStoredRows(gapSpot)).map(r=>({...r,source:'railway' as const,format:CONTRACT.datasetFormat,finalVersion:vnextVersion}));
       const gapCandles=mapFutures1mToStoredCandles(gapF1m);
       if(gapRows.length||gapCandles.length){
        await storage.save(gapRows,gapCandles);
        savedAny=true;
       }
      }
     }
    }
    if(savedAny){
     dataRevision++;
     channel?.postMessage({type:'changed'});
    }
   }catch{}
  }

  async function update(){
   if(stopped||running)return;running=true;
   try{
    channel?.postMessage({type:'window',owner,hours:current.current.hours});
    for(const [id,p]of peers)if(Date.now()-p.at>=20000)peers.delete(id);
    const h=Math.max(current.current.hours,...[...peers.values()].map(p=>p.hours));
    if(leader){if(candleBuffer.size){const batch=[...candleBuffer.values()],stamp=marketRuntime.collectorStamp();candleBuffer.clear();if(marketRuntime.isCollector(stamp))await storage.save([],batch,true,{term:stamp!.epoch,current:()=>marketRuntime.isCollector(stamp)});}await Promise.allSettled([syncRecentVNext(),fillPrices(h)]);}
    await refreshComparisonStatus();
    await readLocal();
   }catch(e){storageFail(e);}finally{running=false;if(!stopped){timer=setTimeout(()=>void update(),5000);}}
  }
  const liveTimer=setInterval(()=>{setNow(Date.now());if(leader&&liveBuffer.size){const candles=[...liveBuffer.values()];setLiveCandles(candles);channel?.postMessage({type:'prices',candles});}},1000);
  channel?.addEventListener('message',e=>{if(e.data.type==='coverage'&&!leader)setCoverage(e.data.coverage);});
  channel?.addEventListener('message',e=>{if(e.data.type==='window')peers.set(e.data.owner,{hours:e.data.hours,at:Date.now()});if(e.data.type==='changed'){dataRevision++;void readLocal().catch(storageFail);}if(e.data.type==='prices'&&!leader)setLiveCandles(e.data.candles);if(e.data.type==='manual-job'&&e.data.id){manualId=e.data.id;}if(e.data.type==='job-state'&&!leader){manualId=e.data.manual.job.complete?null:e.data.manual.job.id;setBackfill(e.data.manual);setManual(e.data.manual);setManualStats(e.data.stats);if(e.data.action)setManualAction(e.data.action);}});
  const resume=()=>{if(!document.hidden){clearTimeout(timer);void update();}};
  const authNeeded=()=>setManualAction({phase:'waiting',message:'等待歷史存取授權，即時行情持續運作',until:0});
  const authCancel=()=>{authPaused=true;setHistoryError('歷史讀取待授權，即時行情持續運作');setManualAction({phase:'error',message:'歷史授權已取消，可按重試比對',until:0});};
  const authResume=()=>{authPaused=false;historyStopped=historyFatal;nextRepair=0;setManualAction(starting?{phase:'starting',message:'授權完成，正在啟動比對…',until:0}:idleManual());resume();};
  window.addEventListener(AUTH_REQUIRED_EVENT,authNeeded);window.addEventListener('marketdepth-auth-cancelled',authCancel);window.addEventListener('marketdepth-auth-resumed',authResume);
  refreshRef.current=()=>{lastRead='';nextPriceScan=0;void readLocal().catch(storageFail);clearTimeout(timer);void update();};
  const manualRef=(selection?:ComparisonSelection)=>void startManual(selection);compareRef.current=manualRef;
  void storage.initStorage().then(async()=>{
   if(stopped)return;
   await storage.setMeta('manualJobId',null);
   let collectorKey='';const syncLeader=()=>{const stamp=marketRuntime.collectorStamp(),key=stamp?stamp.id+':'+stamp.epoch:'';if(key!==collectorKey){collectorKey=key;candleBuffer.clear();liveBuffer.clear();}leader=marketRuntime.isLeader();if(!worker)startWorker();leader=marketRuntime.isLeader();};
   syncLeader();releaseLock=marketRuntime.subscribe(syncLeader);
   await readLocal();
   restoring=false;
   void update();
  }).catch(e=>{restoring=false;storageFail(e);if(!stopped){startWorker();leader=marketRuntime.isLeader();setBusy(false);void update();}});
  document.addEventListener('visibilitychange',resume);window.addEventListener('online',resume);
  return()=>{stopped=true;controller.abort();clearTimeout(timer);clearTimeout(recentFallbackTimer);clearInterval(liveTimer);worker?.terminate();releaseLock?.();channel?.close();document.removeEventListener('visibilitychange',resume);window.removeEventListener('online',resume);window.removeEventListener(AUTH_REQUIRED_EVENT,authNeeded);window.removeEventListener('marketdepth-auth-cancelled',authCancel);window.removeEventListener('marketdepth-auth-resumed',authResume);};
 },[]);
 useEffect(()=>{refreshRef.current();},[viewKey]);
 useEffect(()=>localMaintenance.setView(hours),[hours]);
 const combinedCandles=useMemo(()=>{const merged=new Map(rawCandles.map(c=>[`${c.asset}:${c.interval}:${c.t}`,c]));for(const c of liveCandles){const key=`${c.asset}:${c.interval}:${c.t}`,old=merged.get(key);if(!old||(c.observedAt??0)>=(old.observedAt??0))merged.set(key,c);}return [...merged.values()];},[rawCandles,liveCandles]);
 const candlesByAsset=useMemo(()=>Object.fromEntries(ASSETS.map(a=>[a,aggregateCandles(combinedCandles.filter(c=>c.asset===a),interval)])) as Record<Asset,StoredCandle[]>,[combinedCandles,interval]);
 const candles=candlesByAsset[asset];
 const assetViews=Object.fromEntries(ASSETS.map(a=>{const data=candlesByAsset[a],observed=combinedCandles.reduce((n,c)=>c.asset===a?Math.max(n,c.observedAt??Math.min(now,c.t+c.interval)):n,priceAt.current[a]??0);return [a,{candles:data,priceObservedAt:observed||undefined,price:{at:now,payload:{ok:true as const,data,meta:{asset:a,ageMs:data.length?Math.max(0,now-observed):null,connection:{...pending,state:priceErrors[a]?'error' as const:'ok' as const}}}}}];})) as Record<Asset,{candles:StoredCandle[];priceObservedAt:number|undefined;price:{at:number;payload:{ok:true;data:StoredCandle[];meta:{asset:Asset;ageMs:number|null;connection:typeof pending|{state:'ok'|'error';lastSuccessAtMs:null;error:null}}}}}>;
 const latest=rows.filter(r=>r.d.some(v=>v[ASSETS.indexOf(asset)].some(p=>p.some(n=>n!==null)))).at(-1);
 const latestPrice=combinedCandles.reduce((n,c)=>c.asset===asset?Math.max(n,c.observedAt??Math.min(now,c.t+c.interval)):n,priceAt.current[asset]??0);
 const recent={at:now,payload:{ok:true as const,data:rows,meta:{dataAgeMs:latest?Math.max(0,now-latest.t):null,stale:!latest||now-latest.t>60000,latestTargetTsMs:latest?.t??null,connection:{...pending,state:latest?'ok' as const:'starting' as const}}}};
 const price={at:now,payload:{ok:true as const,data:candles,meta:{asset,ageMs:candles.length?Math.max(0,now-latestPrice):null,connection:{...pending,state:errors.price?'error' as const:'ok' as const}}}};
 const coversWindow=!!manual&&manual.job.from<=now-hours*3600000+30000;
 const history:HistoryPayload={ok:true,data:rows.filter(r=>r.source==='railway'),meta:{indexVersion:backfill?.meta.indexVersion??null,loadedChunks:backfill?.meta.receivedChunks??0,totalChunks:backfill?.meta.totalChunks??0,complete:coversWindow&&(backfill?.meta.complete??false),indexReady:coversWindow&&(backfill?.meta.indexReady??false),oldestRetainedTsMs:backfill?.meta.oldestAvailableTsMs??null,connection:backfill?.meta.connection??pending}};
 return {rows,candles,assetViews,history,recent,price,priceObservedAt:latestPrice||undefined,range:{from:now-hours*3600000,to:now},errors,busy,storageError,historyError,bytes,source:latest?.source,manual,manualStats,manualAction,coverage,connections,comparison,verifiedBlocks,compare:(selection?:ComparisonSelection)=>compareRef.current(selection),refresh:()=>refreshRef.current()};
}
