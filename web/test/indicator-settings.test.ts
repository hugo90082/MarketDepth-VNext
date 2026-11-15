import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {runInNewContext} from 'node:vm';
import {defaultIndicators} from '../shared/technical-indicators';
import {defaultIndicatorPreferences,parseIndicatorPreferences,settingsForAsset} from '../shared/indicator-preferences';
const bundle=build({entryPoints:['src/indicators/settings.ts'],bundle:true,write:false,format:'cjs',platform:'node',plugins:[{name:'react-boundary',setup(b){b.onResolve({filter:/^react$/},()=>({path:'react',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const useSyncExternalStore=()=>{};'}));}}]});
async function fixture(legacy?:unknown,saved?:unknown){
 const output=await bundle,store=new Map<string,string>(),handlers=new Map<string,Function>(),module={exports:{} as any};let fail=false;
 if(legacy)store.set('marketdepth-technical-indicators-v1',JSON.stringify(legacy));if(saved)store.set('marketdepth-technical-indicators-v3',JSON.stringify(saved));
 runInNewContext(output.outputFiles[0].text,{module,exports:module.exports,window:{addEventListener:(key:string,cb:Function)=>handlers.set(key,cb)},localStorage:{getItem:(k:string)=>store.get(k),setItem:(k:string,v:string)=>{if(fail)throw Error('quota');store.set(k,v);}}});
 return {...module.exports,store,handlers,fail:()=>{fail=true;}};
}

test('per-symbol settings merge latest state, preserve other identities and reject invalid or failed writes',async()=>{
 const f=await fixture(),p=f.indicatorPreferences,before=p.settings(),draft=defaultIndicatorPreferences();
 draft.assets.BTC.average.length=200;draft.assets.BTC.unit='percent';draft.assets.BTC.upper[0].bps=43.25;draft.assets.BTC.bandColors[0]='#ff00aa';p.applyAsset('BTC',draft.assets.BTC);
 assert.equal(p.settings().BTC.average.length,200);assert.equal(p.settings().ETH,before.ETH);assert.equal(p.settings().SOL,before.SOL);
 draft.assets.ETH.average.kind='EMA';p.applyAsset('ETH',draft.assets.ETH);assert.equal(p.settings().BTC.average.length,200,'stale draft cannot overwrite BTC');
 assert.equal(p.snapshot().assets.BTC.bandColors[0],'#ff00aa');const old=p.snapshot();assert.throws(()=>p.applyAsset('SOL',{...draft.assets.SOL,average:{...draft.assets.SOL.average,length:0}}));assert.equal(p.snapshot(),old);
 f.fail();assert.throws(()=>p.applyAsset('BTC',defaultIndicatorPreferences().assets.BTC));assert.equal(p.settings().BTC.average.length,200);
});
test('v1 and v2 migrate all saved parameters and preserve independent distances',async()=>{
 const legacy=defaultIndicators();legacy.average.kind='EMA';legacy.average.length=200;legacy.rsi.length=21;legacy.upper[2].bps=125;
 const v1=parseIndicatorPreferences(legacy);for(const a of ['BTC','ETH','SOL'] as const)assert.equal(settingsForAsset(v1,a).average.length,200);
 const v2={version:2,common:{unit:'percent',average:legacy.average,rsi:legacy.rsi,upperVisible:[true,false,true],lowerVisible:[false,true,true],bandColors:['#FF00AA','#abcdef','#112233']},distances:{BTC:{upper:[40,60,90],lower:[40,60,90]},ETH:{upper:[44,66,99],lower:[45,67,100]},SOL:{upper:[50,70,110],lower:[55,77,111]}}};
 const clean=parseIndicatorPreferences(v2);assert.equal(clean.version,3);assert.equal(clean.assets.ETH.lower[2].bps,100);assert.equal(clean.assets.SOL.upper[0].bps,50);assert.equal(clean.assets.BTC.average.kind,'EMA');assert.equal(clean.common.rsi.length,21);assert.equal(clean.assets.SOL.bandColors[0],'#ff00aa');clean.assets.BTC.average.length=12;assert.equal(clean.assets.ETH.average.length,200);
 const f=await fixture();f.store.set('marketdepth-technical-indicators-v2',JSON.stringify(v2));assert.equal(f.indicatorPreferences.settings().ETH.lower[2].bps,100);assert.equal(JSON.parse(f.store.get(f.INDICATOR_SETTINGS_KEY)!).version,3);
});
test('settings persist, synchronize tabs and retain numeric identity on appearance-only updates',async()=>{
 const f=await fixture(),p=f.indicatorPreferences;let changes=0;p.subscribe(()=>changes++);const before=p.settings(),next=structuredClone(p.snapshot());next.assets.ETH.bandColors[1]='#112233';p.applyAsset('ETH',next.assets.ETH);assert.equal(p.settings().ETH,before.ETH);assert.equal(changes,1);
 const remote=structuredClone(p.snapshot());remote.assets.SOL.average.length=321;f.store.set(f.INDICATOR_SETTINGS_KEY,JSON.stringify(remote));f.handlers.get('storage')!({key:f.INDICATOR_SETTINGS_KEY,newValue:JSON.stringify(remote)});assert.equal(p.settings().SOL.average.length,321);assert.equal(p.settings().BTC,before.BTC);
 p.applyRsi({...p.snapshot().common.rsi,length:21});assert.equal(p.settings().BTC.rsi.length,21);assert.equal(p.settings().SOL.average.length,321);
 const restored=await fixture(undefined,JSON.parse(f.store.get(f.INDICATOR_SETTINGS_KEY)!));assert.equal(restored.indicatorPreferences.settings().SOL.average.length,321);
 const invalid=structuredClone(p.snapshot());invalid.assets.BTC.bandColors=['red'];assert.throws(()=>p.apply(invalid));
});
