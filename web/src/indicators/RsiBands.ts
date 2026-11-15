import type {ISeriesApi} from 'lightweight-charts';
/** Paint only the pane background, using the RSI series' own 0–100 coordinates. */
export class RsiBands{
 constructor(private series:ISeriesApi<'Line'>,private levels:()=>{upper:number;lower:number}){}
 paneViews(){return [{zOrder:()=> 'bottom' as const,renderer:()=>({draw:(target:any)=>target.useMediaCoordinateSpace(({context,mediaSize}:{context:CanvasRenderingContext2D;mediaSize:{width:number;height:number}})=>{const {upper,lower}=this.levels(),high=this.series.priceToCoordinate(upper),low=this.series.priceToCoordinate(lower);if(high===null||low===null)return;context.save();context.fillStyle='#ff6b581b';context.fillRect(0,0,mediaSize.width,Math.max(0,high));context.fillStyle='#37d8c516';context.fillRect(0,low,mediaSize.width,Math.max(0,mediaSize.height-low));context.restore();})})}];}
}
