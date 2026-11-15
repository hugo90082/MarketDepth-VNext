import {useSyncExternalStore} from 'react';
import {ASSETS,type Asset} from '../../shared/model';
import {DEFAULT_BAND_COLORS,defaultIndicatorPreferences,parseIndicatorPreferences,settingsForAsset,type IndicatorPreferences,type AssetIndicators,type AssetPreference} from '../../shared/indicator-preferences';
export const LEGACY_INDICATOR_SETTINGS_KEY='marketdepth-technical-indicators-v1';
export const PREVIOUS_INDICATOR_SETTINGS_KEY='marketdepth-technical-indicators-v2';
const OLD_ASSET_SETTINGS_KEY='marketdepth-technical-indicators-v3';
export const INDICATOR_SETTINGS_KEY='marketdepth-technical-indicators-v4';
let current=defaultIndicatorPreferences(),loaded=false,resolved=Object.fromEntries(ASSETS.map(a=>[a,settingsForAsset(current,a)])) as AssetIndicators;
const listeners=new Set<()=>void>(),emit=()=>{for(const f of listeners)f();};
function replace(next:IndicatorPreferences){const choices={...resolved};for(const a of ASSETS){const s=settingsForAsset(next,a);if(JSON.stringify(s)!==JSON.stringify(resolved[a]))choices[a]=s;if(JSON.stringify(next.assets[a].bandColors)===JSON.stringify(current.assets[a].bandColors))next.assets[a].bandColors=current.assets[a].bandColors;}current=next;resolved=choices;}
function load(){
 if(loaded||typeof window==='undefined')return;loaded=true;
 try{const raw=localStorage.getItem(INDICATOR_SETTINGS_KEY),legacy=raw?null:localStorage.getItem(OLD_ASSET_SETTINGS_KEY)??localStorage.getItem(PREVIOUS_INDICATOR_SETTINGS_KEY)??localStorage.getItem(LEGACY_INDICATOR_SETTINGS_KEY);if(raw||legacy){const next=parseIndicatorPreferences(JSON.parse((raw||legacy)!));if(!raw)for(const a of ASSETS)next.assets[a].bandColors=[...DEFAULT_BAND_COLORS];replace(next);if(!raw)try{localStorage.setItem(INDICATOR_SETTINGS_KEY,JSON.stringify(current));}catch{}}}catch{}
 window.addEventListener('storage',e=>{if(e.key!==INDICATOR_SETTINGS_KEY&&e.key!==null)return;try{replace(e.newValue?parseIndicatorPreferences(JSON.parse(e.newValue)):defaultIndicatorPreferences());emit();}catch{}});
}
function latest(){load();const saved=localStorage.getItem(INDICATOR_SETTINGS_KEY);return saved?parseIndicatorPreferences(JSON.parse(saved)):current;}
export const indicatorPreferences={applyAsset(asset:Asset,value:AssetPreference){const saved=latest();this.apply({...saved,assets:{...saved.assets,[asset]:value}});},applyRsi(value:IndicatorPreferences['common']['rsi']){const saved=latest();this.apply({...saved,common:{rsi:value}});},snapshot(){load();return current;},settings(){load();return resolved;},subscribe(f:()=>void){load();listeners.add(f);return()=>{listeners.delete(f);};},apply(s:IndicatorPreferences){const next=parseIndicatorPreferences(s);localStorage.setItem(INDICATOR_SETTINGS_KEY,JSON.stringify(next));replace(next);emit();}};
export const useIndicatorPreferences=()=>useSyncExternalStore(indicatorPreferences.subscribe,indicatorPreferences.snapshot);
export const useIndicatorSettings=()=>useSyncExternalStore(indicatorPreferences.subscribe,indicatorPreferences.settings);
export const useIndicatorColors=()=>useSyncExternalStore(indicatorPreferences.subscribe,()=>indicatorPreferences.snapshot().assets);
