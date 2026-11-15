import type {Asset,Venue} from './model';
export const PROFILE_VERSION=5;
export type ProfileMarket='spot'|'usdm';
export type ProfileSource='binance'|'coinbase';
export type ProfileMode=ProfileSource|'all4';
export type ProfileDemand={id:string;revision:number;asset:Asset;mode:ProfileMode;market?:ProfileMarket;low:number;high:number;height:number};
export type ProfileBin={low:number;high:number;bid:number;ask:number;bidComplete:boolean;askComplete:boolean;parts:Partial<Record<ProfileSource,{bid:number;ask:number;bidComplete:boolean;askComplete:boolean}>>};
export type ProfileQuality={source:ProfileSource;available:boolean;phase:string;activityAt:number;updateAt:number;snapshotAt:number;mid:number|null;tick:number;fallback:boolean;generation?:number;version?:number;eventAt?:number};
export type ProfileLevel={price:number;bid:number;ask:number;bidComplete:boolean;askComplete:boolean;parts:Partial<Record<ProfileSource,{bid:number;ask:number;bidObservedAt:number|null;askObservedAt:number|null;bidComplete:boolean;askComplete:boolean}>>};
export type ProfileTotal={percent:number;bid:number|null;ask:number|null;bidCount:number|null;askCount:number|null;bidComplete:boolean;askComplete:boolean;bidShare:number|null};
export type ProfileFrame={type:'profile-frame';id:string;revision:number;asset:Asset;mode:ProfileMode;market?:ProfileMarket;sampleAt:number;levels:ProfileLevel[];totals:ProfileTotal[];sources:ProfileQuality[];max:number;owner?:string;epoch?:number};
export const largeOrderThreshold=(asset:Asset)=>asset==='BTC'?1e6:asset==='ETH'?5e5:5e4;
export function formatLargeAmount(amount:number){const unit=amount>=1e6?1e6:1e3;return Number((amount/unit).toPrecision(3)).toString()+(unit===1e6?'M':'K');}
export function largeOrderTop(levels:ProfileLevel[],side:'bid'|'ask'){return levels.filter(l=>l[side]>0).sort((a,b)=>b[side]-a[side]||(side==='bid'?b.price-a.price:a.price-b.price)).slice(0,3);}
export const profileSources=(mode:ProfileMode):ProfileSource[]=>mode==='all4'?['binance','coinbase']:[mode];
export const demandSources=(d:ProfileDemand):ProfileSource[]=>d.market==='usdm'?['binance']:profileSources(d.mode);
export function supportedProfile(venue:Venue):venue is ProfileMode{return venue==='all4'||venue==='binance'||venue==='coinbase';}
export function validProfileDemand(d:ProfileDemand){return !!d&&['BTC','ETH','SOL'].includes(d.asset)&&['all4','binance','coinbase'].includes(d.mode)&&(d.market===undefined||d.market==='spot'||d.market==='usdm')&&(d.market!=='usdm'||d.mode==='binance')&&typeof d.id==='string'&&d.id.length<=160&&Number.isSafeInteger(d.revision)&&[d.low,d.high,d.height].every(Number.isFinite)&&d.low>=0&&d.high>d.low&&d.high<=1e9&&d.height>0;}
export function profileGrid(low:number,high:number,height:number,tick:number){
 const cells=Math.max(1,Math.min(160,Math.floor(height/8))),wanted=(high-low)/cells;
 const power=10**Math.floor(Math.log10(wanted)),nice=[1,2,5,10].find(n=>n*power>=wanted)??10;
 const unit=tick>0?tick:1e-8,steps=Math.max(1,Math.ceil(nice*power/unit-1e-9));
 let sized=steps,step=sized*unit,start=Math.floor(low/step+1e-9),end=Math.ceil(high/step-1e-9);
 while(end-start>160){const wantedNext=step*1.000001,p=10**Math.floor(Math.log10(wantedNext)),n=[1,2,5,10].find(n=>n*p>=wantedNext)??10;sized=Math.max(sized+1,Math.ceil(n*p/unit-1e-9));step=sized*unit;start=Math.floor(low/step+1e-9);end=Math.ceil(high/step-1e-9);}
 return {tick:unit,steps:sized,step,start,end};
}
export function priceTick(price:number,tick:number){return Math.round(price/tick);}
export function commonProfileTick(ticks:number[]){const values=ticks.filter(t=>Number.isFinite(t)&&t>0);if(!values.length)return 1e-8;const scale=1e8,gcd=(a:number,b:number):number=>b?gcd(b,a%b):a;return values.map(t=>Math.round(t*scale)).reduce(gcd)/scale||1e-8;}
export function formatMillions(amount:number){return (amount/1e6).toFixed(1).replace(/\.0$/,'')+'M';}
export function profileTop(bins:ProfileBin[],side:'bid'|'ask',low=-Infinity,high=Infinity){return bins.filter(b=>b.high>low&&b.low<high&&b[side]>=1e6).sort((a,b)=>b[side]-a[side]||(side==='bid'?b.low-a.low:a.low-b.low)).slice(0,3);}
export function profileKey(d:ProfileDemand,tick:number){return [d.market??'spot',d.asset,d.mode,tick,d.low,d.high,d.height].join(':');}
