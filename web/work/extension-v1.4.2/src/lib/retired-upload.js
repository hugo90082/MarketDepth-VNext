/** Removes only retired MarketDepth uploads, never alert preferences or logs.
 * @param {IDBFactory} [factory]
 * @param {{clear:(name:string)=>Promise<boolean>}} [alarms] */
export async function cleanupRetiredUpload(factory=globalThis.indexedDB,alarms=undefined){
 await alarms?.clear('marketdepth-shared-upload');
 if(!factory)return;
 if(!(await factory.databases()).some(db=>db.name==='marketdepth-extension-upload'))return;
 await new Promise((resolve,reject)=>{const request=factory.deleteDatabase('marketdepth-extension-upload');request.onsuccess=()=>resolve(undefined);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('舊上傳資料仍被占用；重新整理舊插件頁面後再重載。'));});
}
