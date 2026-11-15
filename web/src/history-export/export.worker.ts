/// <reference lib="webworker" />
import {localHistoryExportBlocks,readLocalHistoryExportBlock} from '../storage';
import {streamHistoryExport} from './stream';
const scope=self as unknown as DedicatedWorkerGlobalScope;
let ack:(()=>void)|undefined,active=false,lastProgress=0;
scope.onmessage=async(e:MessageEvent)=>{
 if(e.data.type==='ack'){ack?.();ack=undefined;return;}
 if(e.data.type!=='start'||active)return;active=true;
 try{
  const sink=new WritableStream<Uint8Array>({write(chunk){return new Promise<void>(resolve=>{ack=resolve;const bytes=new Uint8Array(chunk);scope.postMessage({type:'chunk',bytes},[bytes.buffer]);});}});
  const result=await streamHistoryExport({list:localHistoryExportBlocks,read:readLocalHistoryExportBlock},sink,e.data.startedAt,new AbortController().signal,p=>{
   if(Date.now()-lastProgress>100||p.blocks===p.totalBlocks){lastProgress=Date.now();scope.postMessage({type:'progress',progress:p});}
  });scope.postMessage({type:'complete',result});
 }catch(e){scope.postMessage({type:'error',message:e instanceof Error?e.message:'本機歷史匯出失敗。'});}
};
