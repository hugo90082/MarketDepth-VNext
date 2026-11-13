-- MD-VNEXT-1 daily SQLite schema; proposal approved direction, implementation untested until QA.
PRAGMA foreign_keys=ON;
PRAGMA user_version=1;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS spot_depth (
 t INTEGER NOT NULL CHECK(t%60000=0), available_at INTEGER,
 venue TEXT NOT NULL CHECK(venue IN ('binance','coinbase','kraken','bitfinex')),
 asset TEXT NOT NULL CHECK(asset IN ('BTC','ETH','SOL')),
 bid_price REAL, ask_price REAL, mid_price REAL,
 bid_0_100 REAL, ask_0_100 REAL, bid_100_200 REAL, ask_100_200 REAL,
 bid_200_300 REAL, ask_200_300 REAL, bid_300_500 REAL, ask_300_500 REAL,
 bid_500_750 REAL, ask_500_750 REAL,
 observed_bid_bps REAL, observed_ask_bps REAL, trusted_bid_bps REAL, trusted_ask_bps REAL,
 captured_at INTEGER, status TEXT NOT NULL, source TEXT, quality_json TEXT,
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1), PRIMARY KEY(t,venue,asset)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS futures_10s (
 t INTEGER NOT NULL CHECK(t%10000=0), available_at INTEGER,
 asset TEXT NOT NULL CHECK(asset IN ('BTC','ETH','SOL')),
 open REAL, high REAL, low REAL, close REAL,
 buy_qty REAL, sell_qty REAL, buy_usdt REAL, sell_usdt REAL,
 agg_count INTEGER, first_agg_id INTEGER, last_agg_id INTEGER, first_trade_id INTEGER,last_trade_id INTEGER,
 status TEXT NOT NULL, source TEXT, quality_json TEXT,
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1), PRIMARY KEY(t,asset)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS futures_1m (
 t INTEGER NOT NULL CHECK(t%60000=0), available_at INTEGER,
 asset TEXT NOT NULL CHECK(asset IN ('BTC','ETH','SOL')),
 open REAL, high REAL, low REAL, close REAL,
 volume REAL, quote_volume REAL, taker_buy_qty REAL, taker_buy_usdt REAL,trade_count INTEGER,
 status TEXT NOT NULL, source TEXT, quality_json TEXT,
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1), PRIMARY KEY(t,asset)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS events (
 id INTEGER PRIMARY KEY, t INTEGER NOT NULL, venue TEXT, asset TEXT,
 code TEXT NOT NULL, message TEXT, from_t INTEGER, to_t INTEGER, quality_json TEXT
);
-- meta includes contract_id=MD-VNEXT-1, day=YYYY-MM-DD, timezone=Asia/Taipei,
-- data_origin=live|legacy|mixed, archive_revision, producer_commit, created_at, sealed_at.
-- No ALL4, ratios, or cumulative columns. Derived at query/display/export.
-- No trigger auto-deleting data. Validation of value ranges, availability and state in application/tests.
-- Configure WAL and synchronous policy at runtime for ACTIVE DB only; backup SQLite API / safe sealed DB, never copy an active WAL DB alone.
