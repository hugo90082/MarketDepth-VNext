#!/usr/bin/env python3
"""Pinned-source review only. Never seals, publishes, or invents placement evidence."""
import argparse, collections, datetime as dt, gzip, hashlib, json, os, pathlib, sqlite3, tempfile
TZ=dt.timezone(dt.timedelta(hours=8))
PINS={'source':'88097e060d0c4cdd689971641e14b7a41c0857bcf2104b15ba119fe22d65e79b','raw':'d1d4cf64e04eb19bc7412d70d0cbb5904c8adb8ad867fcb79ce9caf70dec243e','manifest':'d7ac243f9d692d7fcf827f018d5a95e8223261dd2d422aa712f71b0209ab3dbf','audit':'9163cca2d528eaae1aceb0d64b77cd6d8899f525afac047dffa11907460c951d','adapter':'184e5a624d8223b34d82b4065ca1edb745ac007add2f80fe8ecd45fc11c283e6','stream':'4cc8ce0fe7cbb4ee7b6d57c574f74dc0ae33e3ec3dddb941f4ec4bfcded1115b','schema':'616e306b2ce5f10aedc8e9c7d4dbe5584c1965b9b244ff03836e19ca3b1f8640'}
def require(ok,msg):
    if not ok:raise ValueError(msg)
def sha(p):
    require(p.is_file() and not p.is_symlink(),'unsafe file '+str(p))
    with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def ro(p):
    require(not any(os.path.lexists(str(p)+s) for s in ('-wal','-shm','-journal')),'sidecar '+str(p));c=sqlite3.connect(p.resolve().as_uri()+'?mode=ro',uri=True);c.execute('PRAGMA query_only=ON');return c

def review(a):
    r=a.candidates.resolve();mf=r/'manifest.json';require(not (r/'.candidate-building').exists(),'incomplete')
    for key,p in [('source',a.input),('manifest',mf),('audit',a.audit),('adapter',a.adapter),('stream',a.stream),('schema',a.schema)]:require(sha(p)==PINS[key],'hash mismatch '+key)
    with gzip.open(a.input,'rb') as f:require(hashlib.file_digest(f,'sha256').hexdigest()==PINS['raw'],'raw hash')
    m=json.loads(mf.read_text());require(m['candidate_only'] and not m['sealed'] and not m['production_import_approved'] and m['source_sha256']==PINS['source'] and m['raw_sha256']==PINS['raw'] and m['schema_sha256']==PINS['schema'],'wrong candidate manifest')
    ledger=r/m['ledger']['name'];require(sha(ledger)==m['ledger']['sha256'] and ledger.stat().st_size==m['ledger']['bytes'],'ledger hash')
    files=m['files'];require(len(files)==len({x['day'] for x in files})==57 and [x['day'] for x in files]==sorted(x['day'] for x in files),'days')
    require(set(x.name for x in (r/'days').iterdir())==set(pathlib.Path(x['name']).name for x in files),'inventory')
    result=[];total=collections.Counter();allh=hashlib.sha256();lc=ro(ledger)
    try:
        for i,f in enumerate(files):
            d=f['day'];p=r/f['name'];require(f['name']=='days/candidate-'+d+'.sqlite' and p.stat().st_size==f['bytes'] and sha(p)==f['sha256'],'file mismatch '+d)
            start=dt.datetime.strptime(d,'%Y-%m-%d').replace(tzinfo=TZ);end=start+dt.timedelta(days=1);lo=int(start.timestamp()*1000);hi=int(end.timestamp()*1000)
            dh=hashlib.sha256();counts={};db=ro(p)
            try:
                require(db.execute('PRAGMA quick_check').fetchall()==[('ok',)],'integrity '+d)
                meta=dict(db.execute('SELECT key,value FROM meta'));require(meta.get('candidate_only')=='true' and meta.get('data_origin')=='legacy' and meta.get('source_sha256')==PINS['source'] and 'sealed_at' not in meta and 'producer_commit' not in meta,'candidate guard '+d)
                for k,limit in [('spot_depth',17280),('futures_1m',4320)]:
                    n=0
                    for t,v,asset,h in lc.execute('SELECT t,venue,asset,row_sha256 FROM provenance WHERE day=? AND kind=? ORDER BY t,venue,asset',(d,k)):
                        require(lo<=t<hi and len(h)==64,'ledger row identity');dh.update(f'{k}\t{t}\t{v}\t{asset}\t{h}\n'.encode());n+=1
                    sql_n,bad=db.execute(f"SELECT count(*),coalesce(sum(CASE WHEN available_at IS NOT NULL OR status<>'legacy_unknown' OR source IS NULL OR source<>'legacy:v66-browser-jsonl-v1' OR revision<>1 OR t<? OR t>=? THEN 1 ELSE 0 END),0) FROM {k}",(lo,hi)).fetchone();require(n==sql_n==f['counts'][k] and n<=limit and bad==0,'row counts '+d);counts[k]=n
                require(all(db.execute('SELECT count(*) FROM '+k).fetchone()[0]==0 for k in ('futures_10s','events')),'invented rows')
            finally:db.close()
            require(dh.hexdigest()==f['row_digest'],'day canonical digest '+d);allh.update(f'{d}\t{dh.hexdigest()}\n'.encode())
            # Deterministic temporary gzip trial, not a sealed archive.
            with tempfile.TemporaryFile() as tmp:
                with gzip.GzipFile(filename='',fileobj=tmp,mode='wb',mtime=0,compresslevel=6) as gz,p.open('rb') as src:
                    while b:=src.read(1<<20):gz.write(b)
                size=tmp.tell();tmp.seek(0);gh=hashlib.file_digest(tmp,'sha256').hexdigest();tmp.seek(0)
                with gzip.GzipFile(fileobj=tmp,mode='rb') as gz:require(hashlib.file_digest(gz,'sha256').hexdigest()==f['sha256'],'gzip restore '+d)
            require(sha(p)==f['sha256'],'candidate changed '+d)
            n=sum(counts.values());hold=d in ('2026-11-14','2026-11-15');require(hold or d<'2026-11-14','date boundary');group='held' if hold else 'review';total[group+'_days']+=1;total[group+'_rows']+=n;total[group+'_gzip_bytes']+=size;total['raw_bytes']+=f['bytes'];total.update(counts)
            result.append({'day':d,'from_ms':lo,'to_ms_exclusive':hi,'status':'hold_overlap_review' if hold else 'source_review_candidate','candidate_sha256':f['sha256'],'candidate_bytes':f['bytes'],'candidate_gzip_bytes':size,'candidate_gzip_sha256':gh,'canonical_rows_sha256':dh.hexdigest(),'unique_spot':counts['spot_depth'],'unique_futures_1m':counts['futures_1m'],'unknown_availability':n,'duplicate_occurrences':0,'quarantined':0,'conflicts':0,'sources':[{'compressed_sha256':PINS['source'],'uncompressed_sha256':PINS['raw'],'mapping_sha256':PINS['adapter'],'audit_sha256':PINS['audit'],'adapter':'v66-browser-jsonl-v1','mapped_occurrences':n}], 'cutover_ms':None,'placement_report_sha256':None,'publication_approved':False})
            if (i+1)%10==0:print('reviewed',i+1,flush=True)
        require(lc.execute('SELECT count(*) FROM provenance').fetchone()[0]==m['unique_keys'],'ledger total')
    finally:lc.close()
    require(allh.hexdigest()==m['daily_content_digest'] and total['review_days']==55 and total['held_days']==2 and total['review_rows']==1042893 and total['held_rows']==22500 and total['spot_depth']==825588 and total['futures_1m']==239805,'global totals')
    require(sha(ledger)==m['ledger']['sha256'] and sha(mf)==PINS['manifest'],'evidence changed')
    return {'version':'v66-source-review-draft-v1','pins':PINS,'ledger_sha256':m['ledger']['sha256'],'daily_content_digest':allh.hexdigest(),'gzip_trial_level':6,'gzip_trial_mtime':0,'totals':dict(total),'cutover_ms':None,'placement_report_sha256':None,'placement_observed':False,'publication_approved':False,'sealed':False,'days':result}
if __name__=='__main__':
    ap=argparse.ArgumentParser()
    for name in ('candidates','input','audit','adapter','stream','schema','out'):ap.add_argument('--'+name,type=pathlib.Path,required=True)
    a=ap.parse_args();require(not os.path.lexists(a.out),'output exists');x=review(a)
    with a.out.open('x',encoding='utf-8') as f:json.dump(x,f,ensure_ascii=False,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
    print('SOURCE_REVIEW_PASS',x['totals'],flush=True)
