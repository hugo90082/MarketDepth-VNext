import type {IChartApi,ISeriesApi,IPanePrimitive,IPrimitivePaneRenderer,PaneAttachedParameter,Time} from 'lightweight-charts';
import {largeOrderTop,formatLargeAmount,type ProfileFrame} from '../../shared/order-book-profile';
import {PROFILE_AXIS_GAP,profileLabelPositions,profilePixelLevels} from './layout';
const paints:number[]=[];
export function canvasDiagnostics(){const sorted=[...paints].sort((a,b)=>a-b);return {count:paints.length,p95:sorted[Math.floor(sorted.length*.95)]??0,max:sorted.at(-1)??0};}
export class ProfilePrimitive implements IPanePrimitive {
 private request=()=>{};private frame:ProfileFrame|null=null;private fingerprint='';
 private views=[{zOrder:()=>'top' as const,renderer:()=>this.renderer}];width=140;
 constructor(private chart:IChartApi,private series:ISeriesApi<'Candlestick'>,private viewport:(low:number,high:number,height:number)=>void){}
 attached({requestUpdate}:PaneAttachedParameter<Time>){this.request=requestUpdate;}
 detached(){this.request=()=>{};}
 paneViews(){return this.views;}
 updateAllViews(){const height=this.chart.paneSize(0).height,a=this.series.coordinateToPrice(0),b=this.series.coordinateToPrice(Math.max(1,height-1));if(a!==null&&b!==null&&a!==b)this.viewport(Math.max(0,Math.min(a,b)),Math.max(a,b),height);}
 set(frame:ProfileFrame|null,_stale:boolean,width:number){const fingerprint=JSON.stringify([frame?.levels,frame?.max,width]);this.frame=frame;this.width=width;if(this.fingerprint!==fingerprint){this.fingerprint=fingerprint;this.request();}}
 priceAt(y:number){return this.series.coordinateToPrice(y);}
 private renderer:IPrimitivePaneRenderer={draw:target=>target.useMediaCoordinateSpace(({context:ctx,mediaSize})=>{
  const frame=this.frame;if(!frame||!frame.max)return;const started=performance.now(),right=mediaSize.width-PROFILE_AXIS_GAP,left=right-this.width,bottom=mediaSize.height;
  const coordinate=(p:number)=>this.series.priceToCoordinate(p),visible=frame.levels.filter(l=>{const y=coordinate(l.price);return y!==null&&y>=0&&y<=bottom;});
  ctx.save();ctx.beginPath();ctx.rect(Math.max(0,left),0,this.width,bottom);ctx.clip();ctx.fillStyle='rgba(11,21,28,.76)';ctx.fillRect(left,0,this.width,bottom);
  for(const item of profilePixelLevels(visible,coordinate)) {const {level,side,y}=item;ctx.globalAlpha=level[side==='bid'?'bidComplete':'askComplete']?.7:.28;ctx.fillStyle=side==='bid'?'#37d8c5':'#ff6b58';const w=this.width*level[side]/frame.max;ctx.fillRect(right-w,y+(side==='bid'?0:-1.5),w,1.25);}
  ctx.globalAlpha=1;
  const labels=(['bid','ask'] as const).flatMap(side=>largeOrderTop(visible,side).map(level=>({side,level,y:coordinate(level.price)!}))).sort((a,b)=>a.y-b.y);
  const preferred=labels.map(label=>label.y+(label.side==='ask'?-1.5:0)-4),positions=profileLabelPositions(preferred,bottom);
  ctx.font='12px IBM Plex Mono, monospace';ctx.textAlign='right';ctx.textBaseline='bottom';
  labels.forEach((label,i)=>{const y=positions[i],color=label.side==='bid'?'#37d8c5':'#ff6b58',text=(label.side==='bid'?'買 ':'賣 ')+formatLargeAmount(label.level[label.side]),measure=ctx.measureText(text).width,textRight=right-4,textLeft=Math.max(left+2,textRight-measure);
   if(Math.abs(y-preferred[i])>.5){ctx.strokeStyle=color;ctx.beginPath();ctx.moveTo(right-2,label.y);ctx.lineTo(right-2,y-6);ctx.lineTo(textRight,y-6);ctx.stroke();}
   ctx.fillStyle='#0b151c';ctx.fillRect(textLeft-2,y-14,textRight-textLeft+4,14);ctx.fillStyle=color;ctx.fillText(text,textRight,y,this.width-6);
  });
  ctx.restore();
  if(location.hostname==='127.0.0.1'||location.hostname==='localhost'){paints.push(performance.now()-started);if(paints.length>512)paints.shift();}
 })};
}
