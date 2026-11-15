const DATABASES=['marketdepth-liquidations','marketdepth-shared','marketdepth-backup-imports'] as const;
export async function retireLocalDatabases(factory:IDBFactory=indexedDB){
 const names=new Set((await factory.databases()).map(d=>d.name));
 for(const name of DATABASES){if(!names.has(name))continue;await new Promise<void>((resolve,reject)=>{
  const request=factory.deleteDatabase(name);
  request.onsuccess=()=>resolve();request.onerror=()=>reject(new Error('專用資料清理失敗，稍後重試'));
  request.onblocked=()=>reject(new Error('請重新整理或關閉其他舊版 MarketDepth 分頁，才能完成專用資料清理'));
 });}
}
export async function retireTemporaryBackups(){
 if(navigator.storage?.getDirectory){const dir=await navigator.storage.getDirectory() as FileSystemDirectoryHandle&{values():AsyncIterable<FileSystemHandle>};for await(const entry of dir.values())if(entry.kind==='file'&&/^marketdepth-.*\.mdbackup$/.test(entry.name))await dir.removeEntry(entry.name);}
 for(const db of await indexedDB.databases())if(db.name?.startsWith('marketdepth-backup-seen-'))await new Promise<void>((resolve,reject)=>{const r=indexedDB.deleteDatabase(db.name!);r.onsuccess=()=>resolve();r.onerror=r.onblocked=()=>reject(new Error('匯出暫存仍被舊分頁占用，稍後重試'));});
}
