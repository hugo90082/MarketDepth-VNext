export const LOCAL_LIMIT=500*1024*1024;
export const LOCAL_TARGET=450*1024*1024;
export type ManagedVersion={id:string;at:number;bytes:number;revision:number;recoverableRevision?:number;marketCloudRevision?:number;pinned?:boolean;pending?:boolean;migrating?:boolean};
export function removable(v:ManagedVersion){return !v.pinned&&!v.pending&&!v.migrating&&(v.recoverableRevision===v.revision||v.marketCloudRevision===v.revision);}
export function cleanupPlan(records:ManagedVersion[],extraBytes=0){
 const total=records.reduce((n,r)=>n+r.bytes,extraBytes);let remaining=total;const ids:string[]=[];
 if(total>LOCAL_LIMIT)for(const r of [...records].filter(removable).sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id))){if(remaining<=LOCAL_TARGET)break;remaining-=r.bytes;ids.push(r.id);}
 return {total,remaining,ids,protectedBytes:records.filter(r=>!removable(r)).reduce((n,r)=>n+r.bytes,extraBytes)};
}
