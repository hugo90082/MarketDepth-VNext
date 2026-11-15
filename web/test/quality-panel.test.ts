import {test} from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {runInNewContext} from 'node:vm';
const nodes=(n:any):any[]=>Array.isArray(n)?n.flatMap(nodes):n&&typeof n==='object'?[n,...nodes(n.props?.children)]:[];
test('quality panel shows starting, cooldown, error and retry and submits the panel selection',async()=>{
 const mocks:Record<string,string>={react:'export const useMemo=f=>f();','react/jsx-runtime':'export const jsx=(type,props)=>({type,props}),jsxs=jsx;','lucide-react':'export const Waves="icon",Timer="icon";','./LocalCapacity':'export const LocalCapacity="local";','./market-history/Status':'export const MarketHistoryStatus="cloud";'};
 const out=await build({entryPoints:['src/QualityPanel.tsx'],bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});const m={exports:{} as any};runInNewContext(out.outputFiles[0].text,{module:m,exports:m.exports,Date,Intl});let selected:any;
 const market={rows:[],range:{from:0,to:60000},comparison:{ok:true,from:0,eligibleTo:60000,indexVersion:1,indexed:{from:0,to:60000},oldestAvailableTsMs:0,chunks:[],cacheComplete:false,lastCompleted:null},verifiedBlocks:[],recent:null,source:'browser',manual:null,manualStats:{recovered:0},manualAction:{phase:'idle',message:'',until:0},historyError:'',compare:(v:any)=>{selected=v;}};
 const render=(patch:any={})=>nodes(m.exports.QualityPanel({market:{...market,...patch},asset:'ETH',venue:'kraken',zones:[3,4],label:'300–750 bps',now:10000})),button=(all:any[])=>all.find(n=>n.type==='button'&&n.props.className==='compare-button');
 button(render()).props.onClick();assert.equal(selected.asset,'ETH');assert.equal(selected.venue,'kraken');assert.deepEqual([...selected.zones],[3,4]);
 const starting=button(render({manualAction:{phase:'starting',message:'正在準備比對',until:0}}));assert.equal(starting.props.disabled,true);assert.match(starting.props.children,/啟動/);
 const waiting=button(render({manualAction:{phase:'waiting',message:'限流等待',until:15000}}));assert.equal(waiting.props.children,'等待 5 秒');assert.equal(waiting.props.disabled,true);
 const error=render({manualAction:{phase:'error',message:'HTTP 400，請重試',until:0}});assert.equal(button(error).props.disabled,false);assert.equal(button(error).props.children,'重試比對');assert.ok(error.some(n=>n.props?.role==='alert'&&n.props.children.includes('HTTP 400')));
 assert.equal(button(render({manualAction:{phase:'error',message:'儲存錯誤',until:0,blocked:true}})).props.disabled,true);
 assert.equal(button(render({comparison:null,historyError:'讀取失敗'})).props.disabled,false);
 const paused=render({manual:{job:{complete:false},meta:{receivedChunks:22,totalChunks:22,nextAllowedAt:15000,connection:{state:'error'}}}});
 assert.ok(paused.some(n=>n.props?.role==='status'&&JSON.stringify(n.props.children).includes('等待來源恢復')),'source failure must not look like active comparison at 22/22');
 assert.equal(button(paused).props.children,'等待 5 秒');
});
