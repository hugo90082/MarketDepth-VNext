import {CONTRACT,COLLECTION,isContract} from '../shared/contract';
import {validateRows,type SpotRow} from '../shared/model';
export const MINUTE_SPOT_SCHEMA='MD-SPOT-60S-USD-1';
export function sourceCadence(schema:string){if(schema===CONTRACT.schema)return 30000;if(schema===MINUTE_SPOT_SCHEMA)return 60000;throw Error('UPSTREAM_SCHEMA_MISMATCH');}
export function validUpstreamHealth(h:any){return h?.ok&&isContract(h)&&((h.schema===COLLECTION&&h.spotSchema===CONTRACT.schema&&h.spotCadenceMs===30000)||(h.schema==='MARKET_DEPTH_COLLECTION_60S_5ZONE_USD_1'&&h.spotSchema===MINUTE_SPOT_SCHEMA&&h.spotCadenceMs===60000));}
/** Native minute payloads omit cadence. Attach it only after checking their declared schema and grid. */
export function upstreamRows(raw:unknown,schema:string):SpotRow[]{const cadence=sourceCadence(schema),rows=validateRows(raw);if(rows.some(r=>r.t%cadence||r.cadence!==undefined&&r.cadence!==cadence))throw Error('UPSTREAM_CADENCE_MISMATCH');return cadence===60000?rows.map(r=>({...r,cadence:60000})):rows;}
