import {ASSETS,depth} from './model';
import {marketHash,type MarketContent} from './market-history';
import type {StoredCandle} from './contract';
/** The block existing says nothing about its price coverage. Bits are closed, complete minutes. */
export function marketCandleMasks(candles:readonly StoredCandle[],base:number){
 const masks=[0,0,0];for(const c of candles){const i=ASSETS.indexOf(c.asset),slot=(c.t-base)/60000;if(i>=0&&c.interval===60000&&c.closed&&c.complete&&Number.isInteger(slot)&&slot>=0&&slot<15)masks[i]|=1<<slot;}return masks;
}
export const SOURCE_PATTERN=/^MD1-[a-f0-9]{64}$/;
export const sourceCode=(client:string)=>marketHash(['marketdepth-source-v1',client]).then(hash=>'MD1-'+hash);
export type MarketSource={code:string;configured:boolean;valid:boolean;isPrimary:boolean;canUpload:boolean;assignment:string};
export type OfferOutcome='saved'|'values-saved'|'superseded'|'conflict';
/** A receipt describes canonical storage, never upgrades a client's Railway claim. */
export function offerOutcome(offered:MarketContent,canonical:MarketContent,conflicts:readonly string[]):OfferOutcome{
 if(conflicts.length)return 'conflict';let metadata=false;
 for(const row of offered.rows){const other=canonical.rows.find(r=>r.t===row.t);if(!other||JSON.stringify(row.d)!==JSON.stringify(other.d))return 'superseded';metadata||=JSON.stringify(row)!==JSON.stringify(other);}
 for(const c of offered.candles){const other=canonical.candles.find(r=>r.asset===c.asset&&r.t===c.t);if(!other||(['o','h','l','c','v','complete','closed'] as const).some(k=>c[k]!==other[k]))return 'superseded';metadata||=JSON.stringify(c)!==JSON.stringify(other);}
 return metadata?'values-saved':'saved';
}
export type Coverage={rows:number;assets:{candles:number;depth300:number;depth750:number}[];conflicts:number};
export const emptyCoverage=():Coverage=>({rows:0,assets:ASSETS.map(()=>({candles:0,depth300:0,depth750:0})),conflicts:0});
export function blockCoverage(content:MarketContent,from:number,to:number,conflicts=0):Coverage{
 const rows=content.rows.filter(r=>r.t>=from&&r.t<to),out=emptyCoverage();out.rows=rows.length;out.conflicts=conflicts;
 ASSETS.forEach((asset,i)=>{out.assets[i]={candles:content.candles.filter(c=>c.asset===asset&&c.t>=from&&c.t<to&&c.closed&&c.complete).length,depth300:rows.filter(r=>depth(r,asset,'all4',[0,1,2]).ratio!==null).length,depth750:rows.filter(r=>depth(r,asset,'all4',[0,1,2,3,4]).ratio!==null).length};});return out;
}
export function sumCoverage(parts:Coverage[]){const out=emptyCoverage();for(const p of parts){out.rows+=p.rows;out.conflicts+=p.conflicts;p.assets.forEach((a,i)=>{out.assets[i].candles+=a.candles;out.assets[i].depth300+=a.depth300;out.assets[i].depth750+=a.depth750;});}return out;}
