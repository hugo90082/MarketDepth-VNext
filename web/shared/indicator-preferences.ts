import {ASSETS,type Asset} from './model';
import {defaultIndicators,indicatorSettings,type IndicatorSettings} from './technical-indicators';
export const DEFAULT_BAND_COLORS=['#3bf7c8','#f7903b','#3b82f6'];
export type AssetPreference=Pick<IndicatorSettings,'unit'|'average'|'upper'|'lower'>&{bandColors:string[]};
export type IndicatorPreferences={version:3;common:Pick<IndicatorSettings,'rsi'>;assets:Record<Asset,AssetPreference>};
export type AssetIndicators=Record<Asset,IndicatorSettings>;
const preference=(s:IndicatorSettings,colors=DEFAULT_BAND_COLORS):AssetPreference=>({unit:s.unit,average:{...s.average},upper:s.upper.map(b=>({...b})),lower:s.lower.map(b=>({...b})),bandColors:[...colors]});
export const defaultIndicatorPreferences=():IndicatorPreferences=>{const s=defaultIndicators();return {version:3,common:{rsi:{...s.rsi}},assets:Object.fromEntries(ASSETS.map(a=>[a,preference(s)])) as Record<Asset,AssetPreference>};};
export function settingsForAsset(p:IndicatorPreferences,a:Asset):IndicatorSettings{const s=p.assets[a];return {version:1,unit:s.unit,average:{...s.average},upper:s.upper.map(b=>({...b})),lower:s.lower.map(b=>({...b})),rsi:{...p.common.rsi}};}
/** Preserve legacy common parameters and each symbol's independent distances. */
export function parseIndicatorPreferences(raw:any):IndicatorPreferences{
 if(raw?.version===1){const s=indicatorSettings(raw),next=defaultIndicatorPreferences();next.common.rsi={...s.rsi};for(const a of ASSETS)next.assets[a]=preference(s);return parseIndicatorPreferences(next);}
 if(raw?.version===2){const next=defaultIndicatorPreferences(),c=raw.common;if(!c||!raw.distances)throw Error('指標設定格式無效。');for(const a of ASSETS){const d=raw.distances[a];const s=indicatorSettings({version:1,unit:c.unit,average:c.average,rsi:c.rsi,upper:d?.upper?.map((bps:number,i:number)=>({bps,visible:c.upperVisible?.[i]})),lower:d?.lower?.map((bps:number,i:number)=>({bps,visible:c.lowerVisible?.[i]}))});next.assets[a]=preference(s,c.bandColors??DEFAULT_BAND_COLORS);next.common.rsi={...s.rsi};}return parseIndicatorPreferences(next);}
 if(raw?.version!==3||!raw.common||!raw.assets)throw Error('指標設定格式無效。');
 const next=defaultIndicatorPreferences();for(const a of ASSETS){const s=indicatorSettings(settingsForAsset(raw,a)),colors=raw.assets[a].bandColors;if(!Array.isArray(colors)||colors.length!==3||colors.some(c=>typeof c!=='string'||!/^#[0-9a-f]{6}$/i.test(c)))throw Error('三組乖離線顏色須為 #RRGGBB 格式。');for(let i=0;i<3;i++)s.upper[i].visible=s.lower[i].visible=s.upper[i].visible||s.lower[i].visible;next.assets[a]=preference(s,colors.map(c=>c.toLowerCase()));next.common.rsi={...s.rsi};}return next;
}
