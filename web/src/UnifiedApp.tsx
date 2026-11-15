import {useEffect,useState} from 'react';
import {App} from './App';
import {useMonitorRuntime} from './monitor/depth-monitor';
import {marketRuntime} from './runtime/client';
import {ResearchProvider} from './runtime/ResearchProvider';
import {PageNavigation} from './PageNavigation';
import './monitor/styles.css';
import './unified.css';
import {localMaintenance} from './local-maintenance';
import {marketHistoryRuntime} from './market-history/runtime';
import {strategyRuntime} from './strategy/runtime';
import {StrategyToasts} from './strategy/StrategyPanel';
function Pages(){
 const [route,setRoute]=useState(location.pathname);
 const [capable,setCapable]=useState(marketRuntime.profileCapability);
 const change=(next:string)=>{history.pushState(null,'',next);setRoute(next);};
 const navigation=<PageNavigation route={route} change={change}/>;
 const monitor=useMonitorRuntime(route==='/monitor',navigation);
 useEffect(()=>{marketRuntime.start();localMaintenance.start();marketHistoryRuntime.start();strategyRuntime.start();const pop=()=>setRoute(location.pathname);window.addEventListener('popstate',pop);return()=>{window.removeEventListener('popstate',pop);strategyRuntime.stop();marketRuntime.stop();};},[]);
 useEffect(()=>marketRuntime.setRoute(route),[route]);
 useEffect(()=>marketRuntime.events(m=>{if(m.type==='profile-capability')setCapable(m.capable);}),[]);
 return <>{capable===false&&<div className="runtime-version-notice" role="status">行情主控版本不同，請重新整理所有研究與監控分頁。</div>}{route==='/monitor'?monitor:<App navigation={navigation}/>}<StrategyToasts/></>;
}
export function UnifiedApp(){return <ResearchProvider><Pages/></ResearchProvider>;}
