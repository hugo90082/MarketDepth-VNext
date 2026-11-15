import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Eye, EyeOff, LoaderCircle } from 'lucide-react';
import { AUTH_REQUIRED_EVENT } from './site-api';
import './auth.css';

const MarketApp = lazy(() => import('./UnifiedApp').then(module => ({ default: module.UnifiedApp })));
type AuthSession = { ok: true; authenticated: boolean; serverNowMs: number; expiresAt: number | null; data?: { authenticated?: boolean; expires_in?: number } };
function validSession(value: unknown): value is AuthSession {
 const data = value as AuthSession;
 if (!data || data.ok !== true) return false;
 if (typeof data.authenticated === 'boolean' && Number.isSafeInteger(data.serverNowMs)) {
  return data.authenticated ? Number.isSafeInteger(data.expiresAt) && data.expiresAt! > data.serverNowMs : data.expiresAt === null;
 }
 if (typeof data.data?.authenticated === 'boolean') {
  return true;
 }
 return false;
}
function Brand() { return <div className="brand"><span className="brand-mark" aria-hidden="true"><i/><i/><i/><i/></span><strong>MARKET<span>DEPTH</span></strong></div>; }
function AuthShell({ text }: { text: string }) { return <div className="auth-page"><section className="auth-card"><Brand/><p className="auth-loading" role="status"><LoaderCircle className="spin" size={18}/>{text}</p></section></div>; }

function Login({ checking, notice, onLogin }: { checking: boolean; notice: string; onLogin: (value: AuthSession) => void }) {
 const [password, setPassword] = useState(''), [shown, setShown] = useState(false), [submitting, setSubmitting] = useState(false);
 const [error, setError] = useState(''), [retryUntil, setRetryUntil] = useState(0), [now, setNow] = useState(Date.now());
 useEffect(() => { if (!retryUntil) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [retryUntil]);
 const remaining = Math.max(0, Math.ceil((retryUntil - now) / 1000));
 async function submit(event: FormEvent) {
  event.preventDefault(); if (checking || submitting || remaining || !password) return;
  setSubmitting(true); setError('');
  try {
   const response = await fetch('/api/auth/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }), signal: AbortSignal.timeout(15000) });
   if (response.status === 429) { const seconds = Math.max(1, Number(response.headers.get('retry-after')) || 60); const clock = Date.now(); setNow(clock); setRetryUntil(clock + seconds * 1000); setError('登入嘗試次數過多，請稍後再試。'); return; }
   if (response.status === 401) { setError('密碼錯誤，請再試一次。'); return; }
   if (!response.ok) throw new Error('AUTH_UNAVAILABLE');
   const value: unknown = await response.json(); if (!validSession(value) || !(value.authenticated ?? value.data?.authenticated)) throw new Error('AUTH_UNAVAILABLE');
   setPassword(''); onLogin(value);
  } catch { setError('暫時無法登入，請稍後再試。'); }
  finally { setSubmitting(false); }
 }
 return <div className="auth-page"><section className="auth-card" aria-labelledby="login-title"><Brand/><h1 id="login-title">授權歷史讀取與行情保存</h1><p className="auth-description">存取 MarketDepth VNext 即時與封存歷史資料需要授權。請輸入共用密碼，授權固定維持七天。</p><form onSubmit={event => void submit(event)}><label htmlFor="site-password">密碼</label><div className="auth-password"><input id="site-password" name="password" type={shown ? 'text' : 'password'} autoComplete="current-password" autoFocus required maxLength={256} value={password} onChange={event => setPassword(event.target.value)} disabled={submitting}/><button type="button" aria-label={shown ? '隱藏密碼' : '顯示密碼'} aria-pressed={shown} onClick={() => setShown(value => !value)}>{shown ? <EyeOff size={20}/> : <Eye size={20}/>}</button></div>{(error || notice) && <p className="auth-message" role="alert">{error || notice}{remaining > 0 && <span> {remaining} 秒後可再試</span>}</p>}<button className="auth-submit" type="submit" disabled={checking || submitting || remaining > 0 || !password}>{submitting ? <><LoaderCircle className="spin" size={18}/>登入中</> : checking ? '確認登入中' : '登入'}</button></form></section></div>;
}

export function AuthGate() {
 const [open,setOpen]=useState(location.pathname==='/login'),[checking,setChecking]=useState(false),[deferred,setDeferred]=useState(false);
 const channel=useRef<BroadcastChannel|null>(null);
 const check=useCallback(async()=>{
  setChecking(true);try{const r=await fetch('/api/auth/session',{credentials:'same-origin',cache:'no-store'});const value=await r.json();if(validSession(value)&&(value.authenticated??value.data?.authenticated)){setOpen(false);window.dispatchEvent(new Event('marketdepth-auth-resumed'));}}catch{}finally{setChecking(false);}
 },[]);
 useEffect(()=>{
  const required=()=>{setOpen(true);void check();};
  channel.current=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel('marketdepth-auth');channel.current?.addEventListener('message',()=>void check());
  window.addEventListener(AUTH_REQUIRED_EVENT,required);return()=>{window.removeEventListener(AUTH_REQUIRED_EVENT,required);channel.current?.close();};
 },[check]);
 function login(){setOpen(false);setDeferred(false);window.dispatchEvent(new Event('marketdepth-auth-resumed'));channel.current?.postMessage({type:'session-changed'});}
 function dismiss(){setOpen(false);setDeferred(true);window.dispatchEvent(new Event('marketdepth-auth-cancelled'));}
 return <><Suspense fallback={<AuthShell text="載入觀測站"/>}><MarketApp/></Suspense>{deferred&&!open&&<button className="auth-retry" onClick={()=>{setOpen(true);void check();}}>歷史讀取待授權 · 輸入密碼</button>}{open&&<div className="auth-modal" role="dialog" aria-modal="true" aria-label="歷史資料授權"><div><button className="auth-dismiss" onClick={dismiss}>稍後再讀取</button><Login checking={checking} notice="即時行情與監控仍持續運作。" onLogin={login}/></div></div>}</>;
}
