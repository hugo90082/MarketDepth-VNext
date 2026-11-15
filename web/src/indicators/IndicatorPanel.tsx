import {useState,type ReactNode} from 'react';
import {ASSETS,type Asset} from '../../shared/model';
import {defaultIndicatorPreferences,type IndicatorPreferences} from '../../shared/indicator-preferences';
import {indicatorPreferences,useIndicatorPreferences} from './settings';

export function IndicatorPanel({children,asset='BTC'}:{children:ReactNode;asset?:Asset}){
 const current=useIndicatorPreferences(),[tab,setTab]=useState<'depth'|'average'|'rsi'>('average'),[selected,setSelected]=useState<Asset>(asset),[draft,setDraft]=useState(()=>structuredClone(current)),[error,setError]=useState('');
 const patch=(fn:(s:IndicatorPreferences)=>void)=>setDraft(old=>{const next=structuredClone(old);fn(next);return next;});
 const apply=()=>{try{if(tab==='average')indicatorPreferences.applyAsset(selected,draft.assets[selected]);else indicatorPreferences.applyRsi(draft.common.rsi);setError('');}catch(e){setError(e instanceof Error?e.message:'設定無效。');}};
 const c=draft.assets[selected],d=c;
 return <div className="indicator-settings">
  <div className="indicator-tabs" role="tablist" aria-label="指標設定分類">{([['depth','深度'],['average','均線／乖離'],['rsi','RSI']] as const).map(([key,label])=><button key={key} type="button" role="tab" aria-selected={tab===key} onClick={()=>setTab(key)}>{label}</button>)}</div>
  {tab==='depth'?<div role="tabpanel">{children}</div>:<form onSubmit={e=>{e.preventDefault();apply();}}>
   {tab==='average'?<>
    <label>商品<select aria-label="指標商品" value={selected} onChange={e=>setSelected(e.target.value as Asset)}>{ASSETS.map(a=><option key={a}>{a}</option>)}</select></label>
    <div className="indicator-form-row">
     <label>均線種類<select aria-label="均線種類" value={c.average.kind} onChange={e=>patch(s=>{s.assets[selected].average.kind=e.target.value as typeof c.average.kind;})}><option value="MA">MA（簡單平均）</option><option value="EMA">EMA</option><option value="WMA">WMA</option></select></label>
     <label>均線長度<input aria-label="均線長度" type="number" min={1} max={2000} step={1} value={Number.isNaN(c.average.length)?'':c.average.length} onChange={e=>patch(s=>{s.assets[selected].average.length=e.target.valueAsNumber;})}/></label>
     <label className="indicator-check"><input type="checkbox" checked={c.average.visible} onChange={e=>patch(s=>{s.assets[selected].average.visible=e.target.checked;})}/>顯示中線</label>
    </div>
    <div className="indicator-unit">
     <label>單位<select aria-label="乖離單位" value={c.unit} onChange={e=>patch(s=>{s.assets[selected].unit=e.target.value as typeof c.unit;})}><option value="bps">bps</option><option value="percent">%</option></select></label><small>100 bps＝1%</small>
    </div>
    <div className="indicator-band-head"><span>正向</span><span>負向</span></div>
    {[0,1,2].map(i=><div className="indicator-band-row" key={i}><label className="paired-band-toggle"><input aria-label={`第${i+1}組正負乖離線顯示`} type="checkbox" checked={c.upper[i].visible} onChange={e=>patch(s=>{s.assets[selected].upper[i].visible=e.target.checked;s.assets[selected].lower[i].visible=e.target.checked;})}/></label>{(['upper','lower'] as const).map(side=>{
     const name=side==='upper'?'正':'負';
     return <label key={side} className={side==='upper'?'indicator-upper':'indicator-lower'}>
      <span>{side==='upper'?'+':'−'}</span>
      <input aria-label={`${name}向第${i+1}條幅度`} type="number" min={c.unit==='bps'?.1:.001} max={c.unit==='bps'?9999:99.99} step="any" value={Number.isNaN(d[side][i].bps)?'':Number((d[side][i].bps/(c.unit==='bps'?1:100)).toFixed(8))} onChange={e=>patch(s=>{s.assets[selected][side][i].bps=e.target.valueAsNumber*(s.assets[selected].unit==='bps'?1:100);})}/><span>{c.unit==='bps'?'bps':'%'}</span>
     </label>;
    })}</div>)}
    <div className="indicator-colors">{c.bandColors.map((color,i)=><label key={i}>第 {i+1} 組 ±<input aria-label={`第${i+1}組乖離線選色`} type="color" value={/^#[0-9a-f]{6}$/i.test(color)?color:'#3b82f6'} onChange={e=>patch(s=>{s.assets[selected].bandColors[i]=e.target.value;})}/><input aria-label={`第${i+1}組乖離線色碼`} type="text" value={color} maxLength={7} spellCheck={false} onChange={e=>patch(s=>{s.assets[selected].bandColors[i]=e.target.value;})}/></label>)}</div>
    <p className="indicator-note">{selected} 乖離距離獨立保存；每組正負線共用一個顏色，均線、配色、單位與顯示開關均按商品保存；RSI 維持共用。以目前 K 線週期的永續合約收盤價計算。</p>
   </>:<>
    <label className="indicator-check"><input aria-label="顯示 RSI" type="checkbox" checked={draft.common.rsi.enabled} onChange={e=>patch(s=>{s.common.rsi.enabled=e.target.checked;})}/>顯示 RSI</label>
    <div className="indicator-form-row">
     <label>週期<input aria-label="RSI 週期" type="number" min={2} max={1000} step={1} value={Number.isNaN(draft.common.rsi.length)?'':draft.common.rsi.length} onChange={e=>patch(s=>{s.common.rsi.length=e.target.valueAsNumber;})}/></label>
     <label>超買<input aria-label="RSI 超買" type="number" min={.01} max={99.99} step="any" value={Number.isNaN(draft.common.rsi.upper)?'':draft.common.rsi.upper} onChange={e=>patch(s=>{s.common.rsi.upper=e.target.valueAsNumber;})}/></label>
     <label>超賣<input aria-label="RSI 超賣" type="number" min={.01} max={99.99} step="any" value={Number.isNaN(draft.common.rsi.lower)?'':draft.common.rsi.lower} onChange={e=>patch(s=>{s.common.rsi.lower=e.target.valueAsNumber;})}/></label>
    </div><p className="indicator-note">Wilder 平滑 · 0–100。黃色虛線固定標示 15／85。</p>
   </>}
   {error&&<p className="indicator-error" role="alert">{error}</p>}
   <div className="indicator-actions"><button type="button" onClick={()=>{patch(s=>{const defaults=defaultIndicatorPreferences();if(tab==='average')s.assets[selected]=defaults.assets[selected];else s.common.rsi=defaults.common.rsi;});setError('');}}>恢復預設</button><span>僅保存於此瀏覽器</span><button type="submit">套用</button></div>
  </form>}
 </div>;
}
