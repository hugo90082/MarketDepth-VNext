import type {ClosedEpisode} from '../../shared/strategy-v37';
import {createLedger, type Ledger, type Notice} from '../../shared/strategy-v37-ledger';

export const MAX_NOTICES = 150;

let opening: Promise<IDBDatabase> | undefined;
function open() {
 return opening ??= new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open('marketdepth-strategy-v37-1m', 5);
  request.onupgradeneeded = event => {
   const db = request.result;
   if (event.oldVersion < 1) {
    db.createObjectStore('ledger');
    db.createObjectStore('history', {keyPath:'id'}).createIndex('strategy-time', ['strategyId', 'closedAt', 'id']);
    db.createObjectStore('notices', {keyPath:'id'}).createIndex('time', 'at');
    db.createObjectStore('sound');
   } else if (event.oldVersion < 5) {
    const tx = request.transaction!;
    tx.objectStore('ledger').clear();
    tx.objectStore('history').clear();
    tx.objectStore('notices').clear();
    tx.objectStore('sound').clear();
   }
  };
  request.onsuccess = () => {
   request.result.onversionchange = () => {request.result.close(); opening = undefined;};
   resolve(request.result);
  };
  request.onerror = () => {opening = undefined; reject(request.error);};
 });
}

function result<T>(request: IDBRequest<T>): Promise<T> {
 return new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
 });
}

function finished(transaction: IDBTransaction) {
 const promise = new Promise<void>((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onabort = () => reject(transaction.error ?? new Error('策略帳本寫入中斷'));
  transaction.onerror = () => reject(transaction.error);
 });
 void promise.catch(() => {});
 return promise;
}

export async function readLedger(): Promise<Ledger | undefined> {
 const db = await open();
 return result(db.transaction('ledger').objectStore('ledger').get('current'));
}

export async function commitLedger(ledger: Ledger, records: ClosedEpisode[], remove: string[], notices: Notice[],
 term: number, current: () => boolean) {
 const db = await open();
 if (!current()) return [];
 const tx = db.transaction(['ledger', 'history', 'notices'], 'readwrite'), done = finished(tx);
 const store = tx.objectStore('ledger');
 const existing = await result<Ledger | undefined>(store.get('current'));
 const previousTerm = await result<number | undefined>(store.get('term'));
 if (!current() || (existing?.revision ?? 0) !== ledger.revision || (previousTerm ?? 0) > term) {
  tx.abort();
  await done.catch(() => {});
  return null;
 }
 const history = tx.objectStore('history'), log = tx.objectStore('notices'), inserted: Notice[] = [];
 for (const id of new Set(remove)) {
  history.delete(id);
  ledger.historyVersions[id.slice(0, id.lastIndexOf(':'))] = ledger.revision + 1;
 }
 for (const record of records) {
  history.put(record);
  ledger.historyVersions[record.strategyId] = ledger.revision + 1;
 }
 for (const notice of notices) {
  if (await result(log.getKey(notice.id)) !== undefined) continue;
  log.add(notice);
  inserted.push(notice);
 }
 if (notices.length) {
  const total = await result(log.count());
  let excess = total - MAX_NOTICES;
  if (excess > 0) {
   await new Promise<void>((resolve, reject) => {
    const cursorReq = log.index('time').openCursor(null, 'next');
    cursorReq.onerror = () => reject(cursorReq.error);
    cursorReq.onsuccess = () => {
     const cursor = cursorReq.result;
     if (!cursor || excess <= 0) {resolve(); return;}
     excess--;
     cursor.delete();
     cursor.continue();
    };
   });
  }
 }
 if (!current()) {
  tx.abort();
  await done.catch(() => {});
  return null;
 }
 store.put(term, 'term');
 store.put({...ledger, revision:ledger.revision + 1}, 'current');
 await done;
 ledger.revision++;
 return inserted;
}

export async function resetLedger(target: number, from: number, term: number, current: () => boolean): Promise<Ledger | null> {
 const db = await open();
 if (!current()) return null;
 const tx = db.transaction(['ledger', 'history', 'notices', 'sound'], 'readwrite'), done = finished(tx);
 const store = tx.objectStore('ledger');
 const existing = await result<Ledger | undefined>(store.get('current'));
 const previousTerm = await result<number | undefined>(store.get('term'));
 if (!current() || (previousTerm ?? 0) > term) {
  tx.abort();
  await done.catch(() => {});
  return null;
 }
 tx.objectStore('history').clear();
 tx.objectStore('notices').clear();
 tx.objectStore('sound').clear();
 const fresh = createLedger(target, from);
 fresh.revision = (existing?.revision ?? 0) + 1;
 store.put(term, 'term');
 store.put(fresh, 'current');
 await done;
 return fresh;
}

export type HistoryCursor = [strategyId: string, closedAt: number, id: string];
export async function readHistory(strategyId: string, before?: HistoryCursor) {
 const db = await open();
 const index = db.transaction('history').objectStore('history').index('strategy-time');
 const range = IDBKeyRange.bound([strategyId, 0, ''], before ?? [strategyId, Number.MAX_SAFE_INTEGER, '\uffff'], false, !!before);
 const rows: ClosedEpisode[] = [];
 const request = index.openCursor(range, 'prev');
 return new Promise<{rows:ClosedEpisode[]; next?:HistoryCursor}>((resolve, reject) => {
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
   const cursor = request.result;
   if (cursor && rows.length < 12) {
    rows.push(cursor.value);
    cursor.continue();
    return;
   }
   const last = rows.at(-1);
   resolve({rows, ...(cursor && last ? {next:[last.strategyId, last.closedAt, last.id] as HistoryCursor} : {})});
  };
 });
}

export async function recentNotices(limit = MAX_NOTICES) {
 const db = await open();
 const request = db.transaction('notices').objectStore('notices').index('time').openCursor(null, 'prev');
 const notices: Notice[] = [];
 return new Promise<Notice[]>((resolve, reject) => {
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
   const cursor = request.result;
   if (!cursor || notices.length >= limit) {resolve(notices); return;}
   if (cursor.value?.kind === 'fill') notices.push(cursor.value);
   cursor.continue();
  };
 });
}

export async function claimSound(id: string) {
 const db = await open();
 const tx = db.transaction('sound', 'readwrite'), done = finished(tx), store = tx.objectStore('sound');
 const exists = await result(store.getKey(id));
 if (exists === undefined) store.add(Date.now(), id);
 await done;
 return exists === undefined;
}
