import {test} from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {runInNewContext} from 'node:vm';
import {defaultIndicators} from '../shared/technical-indicators';
import {indicatorPaneLayout,integratedPaneLayout,fixedPaneBaseline} from '../shared/pane-layout';
test('calculator worker updates tails, handles closed-bar corrections, and rejects obsolete context',async()=>{
 const b=await build({entryPoints:['src/indicators/calculate.worker.ts'],bundle:true,write:false,format:'iife',platform:'browser'}),messages:any[]=[],self:any={postMessage:(m:any)=>messages.push(m)};runInNewContext(b.outputFiles[0].text,{self});
 const settings=defaultIndicators();settings.average.length=3;settings.rsi.length=2;const bars=[1,2,3].map((c,i)=>({t:i*60000,c,closed:true,complete:true}));
 self.onmessage({data:{type:'reset',id:'BTC',key:'new',from:60000,interval:60000,settings,bars}});assert.equal(messages[0].points.length,2);
 self.onmessage({data:{type:'tail',id:'BTC',key:'old',bars:[{t:180000,c:4,closed:false}]}});assert.equal(messages.length,1);
 for(let i=0;i<5;i++)self.onmessage({data:{type:'tail',id:'BTC',key:'new',bars:[{t:120000,c:3,closed:true,complete:true},{t:180000,c:4,closed:false}]}});
 assert.ok(messages.slice(1).every(m=>m.reset===false&&m.points.length===1&&m.points[0].average===20/6));
 self.onmessage({data:{type:'tail',id:'BTC',key:'new',bars:[{t:120000,c:4,closed:true,complete:true},{t:180000,c:4,closed:false}]}});assert.equal(messages.at(-1).reset,true);assert.equal(messages.at(-1).points.at(-1).average,22/6);
});
test('RSI adds exactly one indicator plus separator and never compounds existing pane enlargement',()=>{
 assert.deepEqual(fixedPaneBaseline(1026,[701,145,147],32),[700,146,146]);
 const old=[702,132,132] as const,integrated=integratedPaneLayout(old),baseline=integrated.panes;
 for(let i=0;i<20;i++){const open=indicatorPaneLayout(integrated.height,baseline,true),closed=indicatorPaneLayout(integrated.height,baseline,false);assert.deepEqual(open.panes.slice(0,3),baseline);assert.equal(open.panes[3],baseline[1]);assert.equal(open.height,integrated.height+baseline[1]+1);assert.deepEqual(closed.panes,baseline);assert.equal(closed.height,integrated.height);}
});
