/** The original pane heights always remain the baseline, never the enlarged result. */
export function integratedPaneLayout(baseline:readonly [number,number,number],canvas=1000){
 const first=Math.round(baseline[1]*1.10),second=Math.round(baseline[2]*1.10);
 return {height:canvas+first-baseline[1]+second-baseline[2],panes:[baseline[0],first,second] as const};
}
export function indicatorPaneLayout(height:number,baseline:readonly [number,number,number],enabled:boolean){return {height:enabled?height+baseline[1]+1:height,panes:enabled?[...baseline,baseline[1]]:[...baseline]};}
/** Match the chart's integer canvas budget, so fractional rounding cannot accumulate in its last pane. */
export function fixedPaneBaseline(height:number,panes:readonly [number,number,number],timeAxis:number):[number,number,number]{const available=Math.round(height)-Math.round(timeAxis)-2,depth=Math.round((available-Math.round(panes[0]))/2);return [available-2*depth,depth,depth];}
