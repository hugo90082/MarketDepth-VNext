import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import type {Asset,Venue} from '../../shared/model';
import type {Interval} from '../../shared/contract';
import {useMarketEngine} from '../useMarket';
type Selection={asset:Asset;assets:readonly Asset[];hours:number;interval:Interval;venue?:Venue;zones?:number[][]};
const Context=createContext<{market:ReturnType<typeof useMarketEngine>;select:(s:Selection)=>void}|null>(null);
export function ResearchProvider({children}:{children:ReactNode}){
 const [selection,select]=useState<Selection>({asset:'BTC',assets:['BTC'],hours:24,interval:60000});
 const market=useMarketEngine(selection.asset,selection.hours,selection.interval,selection.assets,{venue:selection.venue??'all4',zones:selection.zones??[[0,1,2],[0,1,2,3,4]]});
 return <Context.Provider value={{market,select}}>{children}</Context.Provider>;
}
export function useMarket(asset:Asset,hours:number,interval:Interval){
 const market=useMarkets([asset],hours,interval);return {...market,...market.assetViews[asset]};
}
export function useMarkets(assets:readonly Asset[],hours:number,interval:Interval,venue:Venue='all4',zones:number[][]=[[0,1,2],[0,1,2,3,4]]){
 const value=useContext(Context);if(!value)throw new Error('行情執行層未初始化');
 const key=assets.join(','),zoneKey=JSON.stringify(zones);
 useEffect(()=>value.select({asset:assets[0],assets:[...assets],hours,interval,venue,zones}),[key,hours,interval,venue,zoneKey]);return value.market;
}
