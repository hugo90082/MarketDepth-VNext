import {exportManifest,exportDepth,exportCandle,ExportTotals,type ExportProgress} from '../../shared/local-history-export';
import type {LocalHistoryExportBlock} from '../storage';
export type ExportSource={list:()=>Promise<string[]>;read:(id:string)=>Promise<LocalHistoryExportBlock>};
/** Backpressure is preserved all the way from the file to this single-block reader. */
export async function streamHistoryExport(source:ExportSource,sink:WritableStream<Uint8Array>,startedAt:number,signal:AbortSignal,progress:(p:ExportProgress)=>void){
 signal.throwIfAborted();const ids=await source.list();signal.throwIfAborted();
 if(!ids.length)throw new Error('這個瀏覽器尚無可匯出的本機歷史資料。');
 const compression=new CompressionStream('gzip'),writer=compression.writable.getWriter(),encoder=new TextEncoder(),totals=new ExportTotals();
 const piping=compression.readable.pipeTo(sink,{signal});void piping.catch(()=>{});
 const line=async(value:unknown)=>{signal.throwIfAborted();await writer.write(encoder.encode(JSON.stringify(value)+'\n'));};
 try{
  await line(exportManifest(startedAt,ids.length));progress({blocks:0,totalBlocks:ids.length,depthRows:0,candles:0});
  for(const id of ids){
   signal.throwIfAborted();const b=await source.read(id);signal.throwIfAborted();
   const rows=b.rows.filter(r=>r.t<=startedAt),candles=b.candles.filter(c=>c.t<=startedAt);
   await line({type:'block',id:b.id,base:b.base,revision:b.revision,readAt:b.readAt,depthRows:rows.length,candles:candles.length});
   for(const c of candles){await line(exportCandle(c));totals.candle(c);}
   for(const row of rows){await line(exportDepth(row));totals.depth(row);}
   totals.blocks++;progress({blocks:totals.blocks,totalBlocks:ids.length,depthRows:totals.depthRows,candles:totals.candles});
  }
  if(!totals.depthRows&&!totals.candles)throw new Error('這個瀏覽器尚無可匯出的本機歷史資料。');
  const summary=totals.summary(Date.now());await line(summary);await writer.close();await piping;return summary;
 }catch(e){await writer.abort(e).catch(()=>{});await piping.catch(()=>{});throw e;}
}
