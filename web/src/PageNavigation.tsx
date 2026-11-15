export function PageNavigation({route,change}:{route:string;change:(path:string)=>void}) {
 const monitor=route==='/monitor';
 return <nav className="page-navigation" aria-label="網站頁面">
  {([['/','研究'],['/monitor','監控']] as const).map(([path,label])=><a key={path} href={path} aria-current={(path==='/monitor'?monitor:!monitor)?'page':undefined} onClick={event=>{if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();change(path);}}>{label}</a>)}
  <a href={monitor?'/':'/monitor'} target="_blank" rel="noopener">在新分頁開啟{monitor?'研究':'監控'}</a>
 </nav>;
}
