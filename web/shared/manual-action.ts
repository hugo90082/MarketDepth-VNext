import type {Asset,Venue} from './model';
export type ComparisonSelection={asset:Asset;venue:Venue;zones:number[]};
export type ManualAction={phase:'idle'|'starting'|'waiting'|'error'|'done';message:string;until:number;blocked?:boolean};
export const idleManual=():ManualAction=>({phase:'idle',message:'',until:0});
