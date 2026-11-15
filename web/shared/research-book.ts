import {ZONES,type Pair} from './model';
import type {RawBook} from '../src/monitor/depth-engine/order-book';
export type BookQuality={capturedAt:number;feed:string;bidBps:number;askBps:number;complete:boolean[];mode:string;lastMessageAt?:number;snapshotAt?:number;observedBidBps?:number;observedAskBps?:number;coverageMode?:'sequenced-diff'};
export function researchBook(book:RawBook):{zones:Pair[];quality:BookQuality}{
 const bestBid=book.bids[0]?.[0]??0,bestAsk=book.asks[0]?.[0]??0;
 if(!bestBid||!bestAsk||bestBid>=bestAsk)throw new Error('INVALID_BOOK');
 const mid=(bestBid+bestAsk)/2;
 const bidBps=Math.max(0,(mid-(book.verifiedBounds?.bid??book.bids.at(-1)?.[0]??bestBid))/mid*10000);
 const askBps=Math.max(0,((book.verifiedBounds?.ask??book.asks.at(-1)?.[0]??bestAsk)-mid)/mid*10000);
 const zones=ZONES.map(([lo,hi])=>{
  const side=(levels:RawBook['bids'],bid:boolean,coverage:number)=>{
   const rows=levels.filter(([p])=>{const distance=(bid?mid-p:p-mid)/mid*10000;return distance>=lo&&distance<hi;});
   // A range outside observed coverage is unknown, never an invented zero.
   return coverage<=lo&&!rows.length?null:rows.reduce((sum,[p,q])=>sum+p*q,0);
  };
  return [side(book.bids,true,bidBps),side(book.asks,false,askBps)] as Pair;
 });
 const observed=book.coverageMode==='sequenced-diff'?{coverageMode:book.coverageMode,snapshotAt:book.snapshotAt,observedBidBps:Math.max(0,(mid-(book.bids.at(-1)?.[0]??bestBid))/mid*10000),observedAskBps:Math.max(0,((book.asks.at(-1)?.[0]??bestAsk)-mid)/mid*10000)}:{};
 return {zones,quality:{capturedAt:book.capturedAt,feed:book.feed,bidBps,askBps,complete:ZONES.map(([,hi])=>bidBps>=hi&&askBps>=hi),mode:book.acquisitionMode,...(book.lastMessageAt?{lastMessageAt:book.lastMessageAt}:{}),...observed}};
}
