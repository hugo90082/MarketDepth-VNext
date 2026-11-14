#!/usr/bin/env python3
"""Offline, non-publishable historical day database + exact provenance ledger."""
import argparse, collections, datetime as dt, gzip, hashlib, json, os, pathlib, sqlite3, subprocess, sys, time
TZ=dt.timezone(dt.timedelta(hours=8))
KINDS=('spot_depth','futures_1m')
VENUES=('binance','coinbase','kraken','bitfinex'); ASSETS=('BTC','ETH','SOL')
ZONES=('0_100','100_200','200_300','300_500','500_750')
DEPTH=tuple(f'{s}_{z}' for z in ZONES for s in ('bid','ask'))
ADAPTER='v66-browser-jsonl-v1'
def sha(b): return hashlib.sha256(b).hexdigest()
def file_sha(p):
    with open(p,'rb') as f: return hashlib.file_digest(f,'sha256').hexdigest()
def day(t): return dt.datetime.fromtimestamp(t/1000,TZ).strftime('%Y-%m-%d')
def require(ok,msg):
    if not ok: raise ValueError(msg)
def dump(p,x):
    with open(p,'x',encoding='utf-8') as f: json.dump(x,f,ensure_ascii=False,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
def ro(p):
    require(p.is_file() and not p.is_symlink(),f'unsafe file {p}')
    require(not any(pathlib.Path(str(p)+s).exists() for s in ('-wal','-shm','-journal')),f'sidecar {p}')
    c=sqlite3.connect(p.resolve().as_uri()+'?mode=ro',uri=True);c.execute('PRAGMA query_only=ON');return c

def db_new(p):
    fd=os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600);os.close(fd)
    c=sqlite3.connect(p);c.executescript('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA cache_size=-2048; PRAGMA foreign_keys=ON;');return c

def expected_meta(d,source,schema_sha):
    return {'contract_id':'MD-VNEXT-1','day':d,'timezone':'Asia/Taipei','data_origin':'legacy','archive_revision':'1','candidate_only':'true','source_sha256':source,'adapter':ADAPTER,'schema_sha256':schema_sha}

def schema_objects(c): return c.execute("SELECT type,name,tbl_name,coalesce(sql,'') FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").fetchall()

def main():
    p=argparse.ArgumentParser();p.add_argument('--input',type=pathlib.Path,required=True);p.add_argument('--dryrun',type=pathlib.Path,required=True);p.add_argument('--schema',type=pathlib.Path,required=True);p.add_argument('--producer',type=pathlib.Path,required=True);p.add_argument('--out',type=pathlib.Path,required=True);p.add_argument('--verify-only',action='store_true');a=p.parse_args()
    start=time.monotonic();expected=json.loads(a.dryrun.read_text());source=expected['source_sha256'];rawsha=expected['raw_sha256'];schema=a.schema.read_text();schema_sha=file_sha(a.schema);root=a.out.resolve();marker=root/'.candidate-building';manifest=root/'manifest.json';ledger_path=root/'candidate-ledger.sqlite';days_path=root/'days'
    require(file_sha(a.input)==source,'compressed source hash differs')
    prototype=sqlite3.connect(':memory:');prototype.executescript(schema);objects=schema_objects(prototype);columns={k:tuple(x[1] for x in prototype.execute('PRAGMA table_info('+k+')')) for k in KINDS};prototype.close()
    if not a.verify_only:
        root.mkdir(mode=0o700,parents=False,exist_ok=False);marker.write_text('OFFLINE CANDIDATE ONLY; incomplete\n');days_path.mkdir(mode=0o700)
        ledger=db_new(ledger_path);ledger.executescript('''CREATE TABLE provenance(seq INTEGER PRIMARY KEY, source_line INTEGER NOT NULL, raw_sha256 TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL,t INTEGER NOT NULL,venue TEXT NOT NULL,asset TEXT NOT NULL,row_sha256 TEXT NOT NULL,row_json BLOB NOT NULL,UNIQUE(kind,t,venue,asset)); CREATE INDEX provenance_day ON provenance(day,kind,t,venue,asset);CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL) WITHOUT ROWID;''');ledger.executemany('INSERT INTO meta VALUES(?,?)',{'source_sha256':source,'raw_sha256':rawsha,'adapter':ADAPTER,'candidate_only':'true','schema_sha256':schema_sha}.items());ledger.commit();ledger.execute('BEGIN')
        connections={};batches=collections.defaultdict(list);lb=[];counts=collections.defaultdict(collections.Counter);h=hashlib.sha256();n=0;summary=None
        def flush(d,k):
            if batches[d,k]:
                cols=columns[k];connections[d].executemany('INSERT INTO '+k+'('+','.join(cols)+') VALUES('+','.join('?' for _ in cols)+')',batches[d,k]);batches[d,k].clear()
        proc=subprocess.Popen([str(a.producer),'--input',str(a.input),'--sha256',source,'--raw-sha256',rawsha],stdout=subprocess.PIPE)
        try:
            for line in proc.stdout:
                e=json.loads(line);typ=e['type'];require(summary is None,'data after summary')
                if typ=='summary': summary=e;continue
                require(typ=='candidate','unexpected stream type');rj=e['row_json'].encode();r=json.loads(rj);d=e['day'];k=e['kind'];t=r['t'];venue=r.get('venue','');asset=r['asset'];n+=1
                require(k in KINDS and day(t)==d and set(r)==set(columns[k]) and sha(rj)==e['row_sha256'] and r['status']=='legacy_unknown' and r['available_at'] is None and r['revision']==1 and r['source']=='legacy:'+ADAPTER,'candidate contract/hash mismatch')
                if d not in connections:
                    require(d in expected['days'],'unexpected day');c=db_new(days_path/('candidate-'+d+'.sqlite'));c.executescript(schema);c.executemany('INSERT INTO meta VALUES(?,?)',expected_meta(d,source,schema_sha).items());c.commit();c.execute('BEGIN');connections[d]=c
                batches[d,k].append(tuple(r[x] for x in columns[k]));lb.append((n,e['line'],e['raw_sha256'],d,k,t,venue,asset,e['row_sha256'],rj));counts[d][k]+=1;h.update(f"{e['line']}\t{k}\t{e['row_sha256']}\n".encode())
                if len(batches[d,k])>=500:flush(d,k)
                if len(lb)>=1000:ledger.executemany('INSERT INTO provenance VALUES(?,?,?,?,?,?,?,?,?,?)',lb);lb.clear()
                if n%100000==0:print('mapped',n,flush=True)
            require(proc.wait()==0 and summary is not None,'producer did not complete')
            require(dict(counts)==expected['days'] and n==expected['unique_keys'] and h.hexdigest()==expected['ordered_candidate_digest'] and summary['ordered_candidate_digest']==h.hexdigest() and summary['counts']['strict_candidate_samples']==n,'candidate count/digest/full validation mismatch')
            for d,k in batches:flush(d,k)
            if lb:ledger.executemany('INSERT INTO provenance VALUES(?,?,?,?,?,?,?,?,?,?)',lb)
            for c in connections.values():c.commit();c.close()
            ledger.commit();ledger.close();dump(root/'candidate-stream-summary.json',summary)
        finally:
            if proc.poll() is None:proc.kill();proc.wait()
            for c in connections.values():c.close()
            ledger.close()
    else:
        require(not marker.exists() and manifest.is_file(),'incomplete output')
    # Independent post-close read-only verification of all rows, schema and evidence.
    print('reopen and verify',flush=True);lc=ro(ledger_path);require(lc.execute('PRAGMA integrity_check').fetchall()==[('ok',)],'ledger integrity');require(dict(lc.execute('SELECT key,value FROM meta'))=={'source_sha256':source,'raw_sha256':rawsha,'adapter':ADAPTER,'candidate_only':'true','schema_sha256':schema_sha},'ledger metadata');require(lc.execute('SELECT count(*) FROM provenance').fetchone()[0]==expected['unique_keys'],'ledger count')
    verified=0;files=[];nulls=zeroes=all_null=0;per_day={};h=hashlib.sha256();global_hash=hashlib.sha256()
    for d,ec in sorted(expected['days'].items()):
        f=days_path/('candidate-'+d+'.sqlite');c=ro(f);require(c.execute('PRAGMA integrity_check').fetchall()==[('ok',)] and c.execute('PRAGMA user_version').fetchone()==(1,) and schema_objects(c)==objects and dict(c.execute('SELECT key,value FROM meta'))==expected_meta(d,source,schema_sha),'day schema/integrity/meta '+d)
        require(c.execute('SELECT count(*) FROM futures_10s').fetchone()==(0,) and c.execute('SELECT count(*) FROM events').fetchone()==(0,),'fabricated rows');dc={};dh=hashlib.sha256()
        for k in KINDS:
            cols=columns[k];order='t,venue,asset' if k=='spot_depth' else 't,asset';actual=c.execute('SELECT '+','.join(cols)+' FROM '+k+' ORDER BY '+order);refs=lc.execute('SELECT t,venue,asset,row_sha256,row_json FROM provenance WHERE day=? AND kind=? ORDER BY t,venue,asset',(d,k));cnt=0
            from itertools import zip_longest
            for row,ref in zip_longest(actual,refs):
                require(row is not None and ref is not None,'row count differs');t,v,asset,digest,rj=ref;r=json.loads(rj);require(sha(rj)==digest and t==r['t'] and v==r.get('venue','') and asset==r['asset'] and tuple(r[x] for x in cols)==row and day(t)==d,'SQL row differs '+d+' '+k);require(r['available_at'] is None and r['status']=='legacy_unknown','invalid legacy row');cnt+=1;verified+=1;dh.update(f'{k}\t{t}\t{v}\t{asset}\t{digest}\n'.encode())
                if k=='spot_depth':
                    vals=[r[x] for x in DEPTH];nulls+=sum(x is None for x in vals);zeroes+=sum(x==0 for x in vals if x is not None);all_null+=all(x is None for x in vals)
            require(cnt==ec.get(k,0),'daily count differs');dc[k]=cnt
        c.close();per_day[d]=dc;files.append({'day':d,'name':str(f.relative_to(root)),'bytes':f.stat().st_size,'sha256':file_sha(f),'row_digest':dh.hexdigest(),'counts':dc});global_hash.update(f'{d}\t{dh.hexdigest()}\n'.encode())
    require(set(x.name for x in days_path.iterdir())==set(pathlib.Path(x['name']).name for x in files),'unexpected day files')
    # Re-stream exact original lines independently of Go. Compare every raw
    # price/depth, explicit null/zero and metadata against canonical evidence.
    print('independent raw-source replay verification',flush=True);refs=iter(lc.execute('SELECT seq,source_line,raw_sha256,kind,row_sha256,row_json FROM provenance ORDER BY seq'));rr=next(refs,None);rawh=hashlib.sha256();n=0;line_no=0;block=None;raw_counts=collections.Counter()
    with gzip.open(a.input,'rb') as src:
        for line_no,b in enumerate(src,1):
            rawh.update(b);x=json.loads(b);typ=x['type'];raw_counts[typ]+=1
            if typ=='block':block={k:x[k] for k in ('id','base','revision','readAt')};continue
            if typ not in ('depth','candle'):continue
            require(block is not None,'no block');raw_digest=sha(b);pairs=[(v,asset) for v in VENUES for asset in ASSETS] if typ=='depth' else [('',x['asset'])]
            for v,asset in pairs:
                n+=1;require(rr is not None,'missing evidence');seq,ln,rh,k,digest,rj=rr;require((seq,ln,rh)==(n,line_no,raw_digest) and sha(rj)==digest,'source evidence mismatch');r=json.loads(rj);q=json.loads(r['quality_json']);require(r['t']==x['t'] and r['asset']==asset and r.get('venue','')==v and q['legacy_block']==block,'raw key/block mismatch')
                if typ=='depth':
                    vi=VENUES.index(v);ai=ASSETS.index(asset);vals=[z for pair in x['d'][vi][ai] for z in pair];require(k=='spot_depth' and [r[y] for y in DEPTH]==vals,'raw depth mismatch');qual=x['quality'];book=qual['books'][vi][ai] if qual else None;capt=x['captured'][vi][ai] if x['captured'] else None
                    require(q['legacy_a']==x['a'] and q['legacy_source']==x['source'] and q['legacy_format']==x['format'] and q['legacy_cadence_ms']==x['cadence'] and q['legacy_final_version']==x['finalVersion'] and q['legacy_captured']==capt and q['legacy_issues']==x['issues'] and q['legacy_book']==book and q['legacy_quality_version']==(qual['version'] if qual else None) and r['captured_at']==(book['capturedAt'] if book else None) and all(r[z] is None for z in ('bid_price','ask_price','mid_price','observed_bid_bps','observed_ask_bps','trusted_bid_bps','trusted_ask_bps')),'raw depth metadata mismatch')
                else:
                    require(k=='futures_1m' and [r[y] for y in ('open','high','low','close','volume')]==[x[y] for y in ('o','h','l','c','v')] and q['legacy_source']==x['source'] and q['legacy_interval_ms']==x['interval'] and q['legacy_observed_at']==x['observedAt'] and q['legacy_closed']==x['closed'] and q['legacy_complete']==x['complete'] and all(r[z] is None for z in ('quote_volume','taker_buy_qty','taker_buy_usdt','trade_count')),'raw candle mismatch')
                h.update(f'{ln}\t{k}\t{digest}\n'.encode());rr=next(refs,None)
    require(rr is None and n==verified==expected['unique_keys'] and rawh.hexdigest()==rawsha and h.hexdigest()==expected['ordered_candidate_digest'],'full source replay mismatch');lc.close()
    result={'status':'offline_candidate_days_verified','candidate_only':True,'production_import_approved':False,'sealed':False,'source_sha256':source,'raw_sha256':rawsha,'schema_sha256':schema_sha,'adapter':ADAPTER,'unique_keys':verified,'source_lines':line_no,'raw_counts':dict(raw_counts),'day_count':len(files),'ordered_candidate_digest':h.hexdigest(),'daily_content_digest':global_hash.hexdigest(),'depth_nulls':nulls,'depth_zeros':zeroes,'depth_all_null_rows':all_null,'unknown_availability':verified,'futures_10s':0,'events':0,'ledger':{'name':ledger_path.name,'bytes':ledger_path.stat().st_size,'sha256':file_sha(ledger_path)},'files':files}
    if a.verify_only:
        require(json.loads(manifest.read_text())==result,'existing manifest differs');print('READ_ONLY_REPLAY_PASS',verified,len(files),round(time.monotonic()-start,2));return
    dump(manifest,result);marker.unlink();print('BUILD_PASS',verified,len(files),round(time.monotonic()-start,2),flush=True)
if __name__=='__main__':main()
