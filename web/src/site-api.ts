export const AUTH_REQUIRED_EVENT='marketdepth-auth-required';
export const SAVED_PASSWORD_KEY='marketdepth-saved-password';
let waiting:Promise<boolean>|undefined;
let silentPromise:Promise<boolean>|undefined;

export async function trySilentLogin():Promise<boolean>{
 if(typeof window==='undefined')return false;
 if(silentPromise)return silentPromise;
 let saved='';
 try{saved=localStorage.getItem(SAVED_PASSWORD_KEY)??'';}catch{return false;}
 if(!saved)return false;
 silentPromise=(async()=>{
  try{
   const r=await fetch('/api/auth/login',{
    method:'POST',
    credentials:'same-origin',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({password:saved}),
    signal:AbortSignal.timeout(10000),
   });
   if(r.status===401){
    try{localStorage.removeItem(SAVED_PASSWORD_KEY);}catch{}
    return false;
   }
   return r.ok;
  }catch{
   return false;
  }finally{
   silentPromise=undefined;
  }
 })();
 return silentPromise;
}

function authorization(){
 if(waiting)return waiting;
 waiting=new Promise<boolean>(resolve=>{
  const done=(ok:boolean)=>{window.removeEventListener('marketdepth-auth-resumed',success);window.removeEventListener('marketdepth-auth-cancelled',cancel);waiting=undefined;resolve(ok);};
  const success=()=>done(true),cancel=()=>done(false);
  window.addEventListener('marketdepth-auth-resumed',success);window.addEventListener('marketdepth-auth-cancelled',cancel);window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
 });return waiting;
}
export async function siteFetch(input:RequestInfo|URL,init:RequestInit={},onExpired?:()=>void):Promise<Response>{
 const retryInput=input instanceof Request?input.clone():input;
 const response=await fetch(input,{...init,credentials:'same-origin'});
 if(response.status!==401)return response;
 const body=await response.clone().json().catch(()=>null) as {error?:{code?:string}}|null;
 if(body?.error?.code!=='AUTH_REQUIRED'&&body?.error?.code!=='UNAUTHORIZED')return response;
 if(typeof window==='undefined')return response;
 if(await trySilentLogin()){
  window.dispatchEvent(new Event('marketdepth-auth-resumed'));
  return fetch(retryInput as RequestInfo,{...init,signal:AbortSignal.timeout(15000),credentials:'same-origin'});
 }
 onExpired?.();
 const granted=await authorization();if(!granted||init.signal?.aborted&&init.signal.reason?.name!=='TimeoutError')return response;
 return fetch(retryInput as RequestInfo,{...init,signal:AbortSignal.timeout(15000),credentials:'same-origin'});
}
