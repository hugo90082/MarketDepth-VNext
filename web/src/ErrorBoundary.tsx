import {Component,type ReactNode} from 'react';
export class ErrorBoundary extends Component<{children:ReactNode;label?:string},{error:Error|null;attempt:number}>{
 state={error:null as Error|null,attempt:0};
 static getDerivedStateFromError(error:Error){return {error};}
 render(){return this.state.error?<div className="error-recovery" role="alert"><strong>{this.props.label??'畫面暫時無法顯示'}</strong><p>資料仍保存在瀏覽器，可以重試顯示。</p><details><summary>錯誤資訊</summary><code>{this.state.error.name}：{this.state.error.message.slice(0,240)}</code></details><button onClick={()=>this.setState(s=>({error:null,attempt:s.attempt+1}))}>重新顯示</button><button onClick={()=>location.reload()}>重新載入網站</button></div>:<div key={this.state.attempt} style={{display:'contents'}}>{this.props.children}</div>;}
}
