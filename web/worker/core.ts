import { validateRows, type Connection, type ChunkMeta, type IndexPage } from '../shared/model';
import { isContract } from '../shared/contract';
import {MINUTE_SPOT_SCHEMA,upstreamRows} from './upstream-format';
export const pending = ():Connection => ({state:'starting',lastSuccessAtMs:null,error:null});
export class UpstreamError extends Error { constructor(public status:number,public code:string,public retryMs=0){super(code);} }
export async function digest(bytes: ArrayBuffer | Uint8Array) {
  const buffer = bytes instanceof Uint8Array ? new Uint8Array(bytes).buffer : bytes;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(n => n.toString(16).padStart(2, '0')).join('');
}
export function validateIndex(page: IndexPage, version?: number) {
  if (!page.ok || !Array.isArray(page.data) || page.meta?.schema !== 'MD-HISTORY-INDEX-3' || !isContract(page.meta) || !Number.isSafeInteger(page.meta.indexVersion) ||
      !Number.isSafeInteger(page.meta.indexUpdatedTsMs) || !Number.isSafeInteger(page.nextCursor) || page.nextCursor < -1 ||
      (version !== undefined && page.meta.indexVersion !== version)) throw new Error('INVALID_INDEX');
  for (const c of page.data) if (!/^spot-\d+$/.test(c.id) || !/^[a-f0-9]{64}$/.test(c.sha256) || c.kind !== 'spot' || !['MD-SPOT-30S-USD-3',MINUTE_SPOT_SCHEMA].includes(c.schema) ||
    ![c.startTsMs, c.endTsMs, c.bytes, c.rows].every(Number.isSafeInteger) || c.startTsMs < 0 || c.endTsMs <= c.startTsMs || c.rows < 1 || c.rows > (c.schema===MINUTE_SPOT_SCHEMA?15:30) || c.bytes < 1 || c.bytes > 2_000_000) throw new Error('INVALID_CHUNK_META');
  return page;
}
export async function decodeChunk(bytes: ArrayBuffer, c: ChunkMeta) {
  if (bytes.byteLength !== c.bytes || await digest(bytes) !== c.sha256) throw new Error('CHUNK_CHECKSUM_FAILED');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.getReader(); let length = 0; const pieces: Uint8Array[] = [];
  while (true) { const r = await reader.read(); if (r.done) break; length += r.value.length; if (length > 8_000_000) { await reader.cancel(); throw new Error('CHUNK_TOO_LARGE'); } pieces.push(r.value); }
  const combined = new Uint8Array(length); let offset = 0;
  for (const p of pieces) { combined.set(p, offset); offset += p.length; }
  const rows = upstreamRows(new TextDecoder().decode(combined).trim().split('\n').map(s => JSON.parse(s)),c.schema);
  if (rows.length !== c.rows || rows.some(r => r.t < c.startTsMs || r.t >= c.endTsMs)) throw new Error('CHUNK_RANGE_FAILED');
  return rows;
}
