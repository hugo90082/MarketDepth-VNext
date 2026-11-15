import {dynamicBucketSize} from './depth-types';
const GROUPINGS=[1,5,10,25,50,100,250,500,1000] as const;
/** Begin at one tick until a real midpoint and catalog tick size are known. */
export function krakenGrouping(mid:number,tickSize:number){
 if(!(mid>0)||!(tickSize>0)||!Number.isFinite(mid)||!Number.isFinite(tickSize))return 1;
 const target=dynamicBucketSize(mid,tickSize)/tickSize;
 return GROUPINGS.reduce<number>((nearest,value)=>Math.abs(value-target)<Math.abs(nearest-target)?value:nearest,1);
}
