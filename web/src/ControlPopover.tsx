import {useEffect,useId,useRef,type ReactNode} from 'react';
import {ChevronDown} from 'lucide-react';

export function ControlPopover({label,open,onToggle,onClose,children,className=''}:{label:string;open:boolean;onToggle:()=>void;onClose:()=>void;children:ReactNode;className?:string}){
 const id=useId(),root=useRef<HTMLDivElement>(null),button=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null);
 const close=useRef(onClose);close.current=onClose;
 useEffect(()=>{
  if(!open)return;
  panel.current?.querySelector<HTMLElement>('button,select,input,[tabindex="0"]')?.focus();
  const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))close.current();};
  const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();close.current();}};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);button.current?.focus();};
 },[open]);
 return <div className={'control-popover '+className} ref={root}>
  <button type="button" className="control-popover-trigger" ref={button} aria-expanded={open} aria-controls={id} aria-haspopup="dialog" onClick={onToggle}>{label}<ChevronDown size={12}/></button>
  {open&&<div id={id} className="control-popover-panel" role="dialog" aria-label={label} ref={panel}>{children}</div>}
 </div>;
}
