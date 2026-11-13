import hashlib,sqlite3,pathlib,json
p=pathlib.Path(__file__).resolve().parents[1]/'contract/schema.sql'
assert hashlib.sha256(p.read_bytes()).hexdigest()=='616e306b2ce5f10aedc8e9c7d4dbe5584c1965b9b244ff03836e19ca3b1f8640'
c=sqlite3.connect(':memory:');c.executescript(p.read_text());assert c.execute('pragma quick_check').fetchone()==('ok',);assert c.execute('pragma user_version').fetchone()==(1,)
c.execute("insert into spot_depth(t,venue,asset,status,bid_0_100) values(0,'binance','BTC','partial',0)");assert c.execute('select bid_0_100,ask_0_100 from spot_depth').fetchone()==(0,None)
for sql in ["insert into spot_depth(t,venue,asset,status) values(0,'binance','BTC','partial')", "insert into spot_depth(t,venue,asset,status) values(1,'binance','BTC','partial')", "insert into spot_depth(t,venue,asset,status) values(60000,'okx','BTC','partial')"]:
 try:c.execute(sql)
 except sqlite3.IntegrityError:continue
 raise AssertionError(sql)
for kind in ['spot_depth','futures_10s','futures_1m']:
 cols={r[1] for r in c.execute('pragma table_info('+kind+')')}
 data=json.loads((p.parent/'fixtures'/f'{kind}.json').read_text())['data']
 assert data and all(set(r)==cols for r in data),(kind,cols)
print('PASS: schema SHA256, quick_check, version, NULL/0, PK, grid, venue, all fixture columns')
