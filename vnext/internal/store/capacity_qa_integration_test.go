//go:build linux && sqlite_integration && capacity_qa

package store

import(
 "context"
 "fmt"
 "math/rand"
 "os"
 "path/filepath"
 "sync"
 "testing"
 "time"

 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive"
 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

// Synthetic high-entropy, populated fields: not exchange data and not a
// forecast of live compression. Exactly 47,520 contract keys in one day.
func qaMinute(t int64,r *rand.Rand)[]model.Row{
 out:=make([]model.Row,0,33)
 p:=func(v float64)*float64{return model.Ptr(v)}
 n:=func()*float64{return p(1+r.Float64()*1e8)}
 c:=func(t int64,k model.Kind,a string)model.Common{return model.Common{T:t,AvailableAt:model.Ptr(t+k.Interval()+200),Asset:a,Status:"ok",Source:model.Ptr(model.LiveSource),Revision:1}}
 for _,a:=range gridAssets{
  price:=100+r.Float64()*90000
  for _,v:=range gridVenues{
   common:=c(t,model.Spot,a)
   common.Quality=model.Ptr(fmt.Sprintf("{\"synthetic\":true,\"sequence\":%d,\"capture_lag_ms\":%d,\"source\":\"fixture\"}",r.Int63(),r.Intn(1500)))
   out=append(out,model.SpotRow{Common:common,Venue:v,BidPrice:p(price-0.01),AskPrice:p(price+0.01),MidPrice:p(price),Bid0100:n(),Ask0100:n(),Bid100200:n(),Ask100200:n(),Bid200300:n(),Ask200300:n(),Bid300500:n(),Ask300500:n(),Bid500750:n(),Ask500750:n(),ObservedBid:p(800+r.Float64()*20),ObservedAsk:p(800+r.Float64()*20),TrustedBid:p(750),TrustedAsk:p(750),CapturedAt:model.Ptr(t+100)})
  }
  for off:=int64(0);off<60000;off+=10000{
   o:=price+r.Float64()*10
   q1,q2:=1+r.Float64()*50,1+r.Float64()*50
   id:=r.Int63n(1<<50)
   out=append(out,model.Futures10Row{Common:c(t+off,model.F10,a),OHLC:model.OHLC{Open:p(o),High:p(o+1),Low:p(o-1),Close:p(o+0.5)},BuyQty:p(q1),SellQty:p(q2),BuyUSDT:p(q1*o),SellUSDT:p(q2*o),AggCount:model.Ptr(int64(20)),FirstAggID:model.Ptr(id),LastAggID:model.Ptr(id+19),FirstTradeID:model.Ptr(id*2),LastTradeID:model.Ptr(id*2+39)})
  }
  o:=price+r.Float64()*10;volume:=1+r.Float64()*100
  out=append(out,model.Futures1Row{Common:c(t,model.F1,a),OHLC:model.OHLC{Open:p(o),High:p(o+1),Low:p(o-1),Close:p(o+0.5)},Volume:p(volume),QuoteVolume:p(volume*o),TakerBuyQty:p(volume/2),TakerBuyUSDT:p(volume*o/2),TradeCount:model.Ptr(int64(100))})
 }
 return out
}
func qaMeasure(t *testing.T,root string)int64{t.Helper();n,e:=archive.MeasureAllocated(root);if e!=nil{t.Fatal(e)};return n}
// Sample allocated blocks during the entire operation, not just the final
// smaller file. This remains a sampled peak, not a kernel quota proof.
func qaPeak(t *testing.T,root string,job func()error)(int64,int64,int64){
 t.Helper();before:=qaMeasure(t,root);peak:=before
 stop:=make(chan struct{});var wg sync.WaitGroup;var measureErr error
 wg.Add(1);go func(){defer wg.Done();tick:=time.NewTicker(5*time.Millisecond);defer tick.Stop();for{select{case<-stop:return;case<-tick.C:n,e:=archive.MeasureAllocated(root);if e!=nil{measureErr=e;return};if n>peak{peak=n}}}}()
 e:=job();close(stop);wg.Wait()
 if e!=nil{t.Fatal(e)};if measureErr!=nil{t.Fatal(measureErr)}
 after:=qaMeasure(t,root);if after>peak{peak=after}
 return before,peak,after
}
func TestCapacityQAFullDay(t *testing.T){
 for _,mode:=range []string{"verified","partial_loss"}{
  t.Run(mode,func(t *testing.T){
   ctx,cancel:=context.WithTimeout(context.Background(),8*time.Minute);defer cancel()
   day:="2026-11-13";a,_,e:=dayRange(day,day);if e!=nil{t.Fatal(e)}
   now:=a;root:=filepath.Join(t.TempDir(),"live")
   m,e:=newManager(root,SQLiteOpener,func()time.Time{return now},5*time.Minute);if e!=nil{t.Fatal(e)};defer m.Close()
   j,e:=m.OpenCatalog(ctx);if e!=nil{t.Fatal(e)};defer j.Close()
   stage,verify:=filepath.Join(root,"qa-stage"),filepath.Join(root,"qa-verify")
   for _,p:=range []string{stage,verify}{if e=os.Mkdir(p,0700);e!=nil{t.Fatal(e)}}
   remote:=&sealedRemote{objects:map[string]storedArchiveObject{},keys:map[string]string{}}
   rng:=rand.New(rand.NewSource(42))
   rows:=0;start:=time.Now()
   for minute:=0;minute<1440;minute+=10{
    batch:=[]model.Row{}
    for q:=minute;q<minute+10;q++{batch=append(batch,qaMinute(a.UnixMilli()+int64(q)*60000,rng)...)}
    now=a.Add(time.Duration(minute+10)*time.Minute+time.Second)
    if e=j.Put(ctx,batch);e!=nil{t.Fatal(e)}
    rows+=len(batch)
    if mode=="partial_loss"&&minute+10==720{
     s,e:=m.CreateSnapshot(ctx,day,stage,archive.HourGeneration(now),"capacity-qa",150_000_000);if e!=nil{t.Fatal(e)}
     if _,e=j.PublishActiveSnapshot(ctx,remote,s,verify,150_000_000);e!=nil{t.Fatal(e)}
     if e=os.Remove(s.Path);e!=nil{t.Fatal(e)}
    }
   }
   if rows!=47520{t.Fatal(rows)}
   now=a.Add(24*time.Hour+6*time.Minute)
   if _,e=j.SealDay(ctx,day,"capacity-qa");e!=nil{t.Fatal(e)}
   next:=qaMinute(a.Add(24*time.Hour).UnixMilli(),rng)
   if e=j.Put(ctx,next);e!=nil{t.Fatal(e)}
   dbInfo,e:=os.Stat(filepath.Join(root,day+".sqlite"));if e!=nil{t.Fatal(e)}
   t.Logf("mode=%s rows=%d daily_logical_bytes=%d allocated_before_maintenance=%d fixture_elapsed=%s",mode,rows,dbInfo.Size(),qaMeasure(t,root),time.Since(start))
   allow:=func(context.Context,int64)(func(),error){return func(){},nil}
   c,e:=NewArchiveReadCache(m,remote,allow);if e!=nil{t.Fatal(e)}
   r,e:=NewArchiveReader(j,c);if e!=nil{t.Fatal(e)}
   if mode=="verified"{
    var rec archive.PublishedRecord
    before,peak,after:=qaPeak(t,root,func()error{
     s,e:=m.CreateSnapshot(ctx,day,stage,"g1","capacity-qa",150_000_000);if e!=nil{return e}
     rec,e=j.PublishSealedSnapshot(ctx,remote,s,verify,150_000_000);if e!=nil{return e}
     return os.Remove(s.Path)
    })
    t.Logf("snapshot raw_bytes=%d gzip_bytes=%d allocated_before=%d sampled_peak=%d after=%d",rec.Manifest.RawSize,rec.Manifest.Size,before,peak,after)
    if peak>=archive.HardLimit{t.Fatal("hard capacity exceeded")}
    if e=r.EvictVerifiedLocalDay(ctx,day);e!=nil{t.Fatal(e)}
    before,peak,after=qaPeak(t,root,func()error{return r.CompactVerifiedDay(ctx,day)})
    t.Logf("compact before=%d sampled_peak=%d after=%d",before,peak,after)
    if peak>=archive.HardLimit{t.Fatal("hard capacity exceeded")}
   }else{
    before,peak,after:=qaPeak(t,root,func()error{return j.EvictPartialDay(ctx,day)})
    t.Logf("partial_loss before=%d sampled_peak=%d after=%d extra_peak=%d",before,peak,after,peak-before)
    if peak-before>32_000_000||peak>=archive.HardLimit{t.Fatal("32MB emergency reservation inadequate",peak-before)}
    loss,e:=j.PartialLoss(ctx,day);if e!=nil{t.Fatal(e)}
    var recovered,lost int64
    for _,k:=range []model.Kind{model.Spot,model.F10,model.F1}{recovered+=loss.Record.Recoverable.Count(k);lost+=loss.Record.Lost.Count(k)}
    if recovered!=23760||lost!=23760{t.Fatal(recovered,lost)}
   }
   // Bounded history still resolves exact archived values after pruning.
   q:=Query{Kind:model.Spot,From:a.UnixMilli(),To:a.Add(time.Minute).UnixMilli(),Limit:12}
   p,e:=r.History(ctx,q);if e!=nil||len(p.Rows)!=12||len(p.Gaps)!=0{t.Fatal(p,e)}
   before:=qaMeasure(t,root)
   for i:=0;i<128;i++{state,e:=r.VacuumCatalogCycle(ctx);if e!=nil{t.Fatal(e)};if state=="idle"{break}}
   t.Logf("catalog vacuum allocated_before=%d allocated_after=%d",before,qaMeasure(t,root))
  })
 }
}
