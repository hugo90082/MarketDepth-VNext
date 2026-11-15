export const PROFILE_AXIS_GAP = 8;
export const PROFILE_CANDLE_GAP = 16;

import type {ProfileLevel} from '../../shared/order-book-profile';
export function profilePixelLevels(levels:ProfileLevel[],coordinate:(price:number)=>number|null){
 const pixels=new Map<string,{level:ProfileLevel;side:'bid'|'ask';y:number;count:number}>();
 for(const level of levels){const y=coordinate(level.price);if(y===null)continue;for(const side of ['bid','ask'] as const){if(level[side]<=0)continue;const key=side+':'+Math.round(y),old=pixels.get(key);if(!old)pixels.set(key,{level,side,y,count:1});else{old.count++;if(level[side]>old.level[side]||level[side]===old.level[side]&&(side==='bid'?level.price>old.level.price:level.price<old.level.price)){old.level=level;old.y=y;}}}}
 return [...pixels.values()];
}

// Include the last candle's entire logical cell, not just its centre.
export function profileVisibleRange(range: {from:number;to:number}, paneWidth:number, profileWidth:number) {
 if (!profileWidth) return {...range,to:range.to+10};
 const reserved=profileWidth+PROFILE_AXIS_GAP+PROFILE_CANDLE_GAP;
 const cells=range.to-range.from+1;
 return {...range,to:range.to+cells*reserved/Math.max(1,paneWidth-reserved)};
}

// Input is sorted by price coordinate. Output is the bottom of each text box.
export function profileLabelPositions(preferred:number[], height:number):number[] {
 const spacing=18,min=14,max=height-4;
 const positions=preferred.map(y=>Math.max(min,y));
 for(let i=1;i<positions.length;i++)positions[i]=Math.max(positions[i],positions[i-1]+spacing);
 if(positions.length&&positions.at(-1)!>max){
  positions[positions.length-1]=max;
  for(let i=positions.length-2;i>=0;i--)positions[i]=Math.min(positions[i],positions[i+1]-spacing);
 }
 return positions;
}
