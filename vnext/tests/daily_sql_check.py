"""Execute actual Go-generated bound INSERT statements using system SQLite.
Not a substitute for the Go driver integration test."""
import json, pathlib, sqlite3, tempfile, subprocess, sys, os
root=pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as tmp:
    p=pathlib.Path(tmp)
    plan=p/'plan.json'
    subprocess.run(['go','test','-count=1','-run','TestDailySQLContract','./internal/store'],cwd=root,env=dict(os.environ,MD_SQL_TEST_PLAN=str(plan)),check=True)
    items=json.loads(plan.read_text())
    db=p/'day.sqlite'; c=sqlite3.connect(db);c.executescript((root/'contract/schema.sql').read_text());assert c.execute('pragma journal_mode=WAL').fetchone()==('wal',);c.execute('pragma synchronous=FULL')
    with c:
        for i in items:c.execute(i['sql'],i['args'])
    assert c.execute('select bid_0_100,ask_0_100 from spot_depth').fetchone()==(0,None)
    assert c.execute('select first_agg_id from futures_10s').fetchone()==(9007199254740993,)
    try:
        with c:
            args=items[0]['args'].copy();args[2]='coinbase';c.execute(items[0]['sql'],args);c.execute(items[0]['sql'],items[0]['args'])
    except sqlite3.IntegrityError:pass
    else:raise AssertionError('duplicate accepted')
    assert c.execute('select count(*) from spot_depth').fetchone()==(1,)
    # Child commits then exits without clean close: recovery of committed WAL.
    cmd="import sqlite3,os,sys; c=sqlite3.connect(sys.argv[1]);c.execute('pragma journal_mode=WAL');c.execute('pragma synchronous=FULL');c.execute(\"insert into events(t,code) values(0,'wal_test')\");c.commit();os._exit(0)"
    subprocess.run([sys.executable,'-c',cmd,str(db)],check=True)
    assert c.execute('select code from events').fetchone()==('wal_test',)
    c.close();c=sqlite3.connect(db);assert c.execute('pragma quick_check').fetchone()==('ok',);assert c.execute('select code from events').fetchone()==('wal_test',);c.close()
    print('PASS: actual generated SQL, all three tables, NULL/zero, exact 64-bit ID, transaction rollback, committed WAL after abrupt child exit and reopen')
