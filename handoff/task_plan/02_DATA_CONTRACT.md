# 02｜資料契約與收集規格（前後端共同基準）

契約 ID：`MD-VNEXT-1`；SQL 初版見 `contract/schema.sql`。本文件與 DDL 是開工契約，變更須由主控確認並更新版本、測試與前端 mock。資料欄位採 snake_case；JSON API 欄位同名。

## 1. 時間及因果安全

- 所有數字時間為 UTC Unix epoch milliseconds；顯示 Asia/Taipei UTC+8，禁止再加一次時差。
- `t` 為目標時間（spot）或區間開始時間（futures、kline）；半開區間 `[t,t+interval)`。
- `available_at` 是資料真正完成、可供決策使用的 UTC ms（包括原始取得與必要處理）；不可拿 `t` 取代。補抓資料須使用實際補抓完成時間。舊資料未確認則保留原欄位及未知標記，不宣稱 live-safe。
- Spot 60 秒 grid 只用該分鐘時間點的原生取樣；不能把後一個 30 秒平均當作當分鐘開始可用。
- Spot REST 請求可能在目標時間前後完成，沿用已驗證取樣窗與各來源語意，記錄實際捕獲時間與延遲；不應宣稱所有來源都精準是 T 時刻的快照。過窗記錄 null／失效；不放寬至任意時間。
- 10 秒 OHLC 只在區間結束、事件聚合完成後可見；不可用本區間未來高低價做同區間進場訊號。保守處理同一 10 秒內雙觸停損停利；OHLC 不代表逐筆撮合順序。
- 完整新資料日預期 spot 1,440 × 12 = 17,280 rows；futures_10s 8,640 × 3 = 25,920；官方 1m 1,440 × 3 = 4,320，合計 47,520 rows。新資料盡量明確寫缺失格；停機期間無 row 是 gap，不能假裝完整。舊匯出保留原來的缺格，不生造 row。

## 2. 現貨深度

固定資產 BTC/ETH/SOL，固定四交易所，取交易量已驗證的現貨交易對，沿用舊程式實際 mapping：

| 交易所 | 市場/來源（部署前從指定 commit 核對確切 symbol） |
|---|---|
| Binance | BTCUSDT、ETHUSDT、SOLUSDT；現貨 |
| Coinbase | BTC-USD、ETH-USD、SOL-USD |
| Kraken | 既有 USD 交易對及 WebSocket/REST 映射 |
| Bitfinex | 既有 USD/UST 交易對（不要擅自改 symbol） |

`spot_depth` 一列對應 `(t,venue,asset)`，一個有效完整日有 12 列/分鐘。五個獨立 zone：`[0,100) [100,200) [200,300) [300,500) [500,750)` bps。以當時 mid 作參考，使用 price × base quantity 表示 USD notional；延用 USD/USDT 名義 1:1、不換匯的規則。原有程式若端點邊界採不同約定，先對照並測試，不直接無聲改變分類。

欄位：`t, available_at, venue, asset, bid_price, ask_price, mid_price, bid_0_100, ask_0_100, ... bid_500_750, ask_500_750, observed_bid_bps, observed_ask_bps, trusted_bid_bps, trusted_ask_bps, captured_at, status, source, quality_json, revision`。

- 金額及最佳買賣價無法確認則 NULL；確認沒有掛單才為 0；每個側別獨立。
- observed 與 trusted coverage 分開。尤其 Binance BTC/ETH 的 REST 初始可信範圍不可假裝到 750bps；持續正確序列的觀測簿可按現行已驗證政策出值，並保存品質資訊。
- `source` 新資料為 `vm_vnext`；`status` 例如 `ok/partial/missing/late/recovered/legacy_unknown`，完整性需以欄位 + 品質共同判斷。`quality_json` 僅保存必要的側別覆蓋、失效原因與來源；未知為 null，不用原始金額倒推出品質。
- Binance BTC/ETH：REST5000 bootstrap + persistent diff WS + U/u bridge、序列驗證、exact-T cut、edge/headroom refresh、重連重建；目前原始版本 diff 1000ms。SOL：REST5000。Coinbase：full L2 REST。Kraken：WS exact depth1000 + BTC/ETH GroupedBook 輔助只填未覆蓋側，REST fallback；Bitfinex：P1 0–100、P2 100–750。對照指定 commit 回歸驗證，禁止因低資源擅自降低資料品質。
- OKX、Bybit 不加入 VM 收集或歷史儲存；監控頁仍照原設計直連。

## 3. ALL4 與衍生計算（瀏覽器）

對單一 `asset`、選定 zone 或累積區間與時間格：一個 venue 的必要 bid/ask 全部非 NULL 才為有效配對；累積區間內任一必要側未知，該 venue 在該區間無效。先加金額再計算比值。不可先平均各 venue 的 ratio。

```text
valid_venues = 所有必要 bid/ask 完整的 venue
venue_count = len(valid_venues)
若 venue_count < 2: ALL4 = null
否則 B = sum(valid_venues.bid), A = sum(valid_venues.ask)
delta = B-A
imbalance = (B-A)/(B+A)；若 B+A=0 則 null
```

UI 保留 ALL4 名稱；同時顯示參與家數與資料完整性。研究可選 `ALL4_STRICT`（四所全部有效才出值），但不是 UI 預設，也不改使用者目前原則。匯出可選衍生欄位；正式 archive 不保存衍生值。跨週期 aggregation 必須先檢查時間格、使用已完成資料；不盲目平均比率。累積 0–200/300/500/750 由必要獨立 zone 相加。

## 4. Binance USDⓈ-M 10 秒行情

使用公開 `aggTrade` WS（非 spot、非 mark price、非指數）。固定三商品；優先用官方目前文件的 `market` stream route（V66 已有 `/market/stream`），部署時驗證訂閱、ping/pong、交易對及 endpoint，不能照抄失效 URL。持續收資料，不只每 10 秒 REST 取一次。

每筆 aggTrade 依成交時間 `T` 分桶，按成交時間與 agg ID 決定 OHLC 順序；同 ID 去重，確保重連、重放不重複計量。買方 maker `m=true` 表示主動賣；`m=false` 為主動買。qty 為 base asset，notional = price × qty（USDT）。事件可能有延遲、亂序、斷線；檢查序列及官方欄位語意，不把每次 ID 跳號一律當作已證實的成交缺口或完整。

`futures_10s`：`t, available_at, asset, open,high,low,close,buy_qty,sell_qty,buy_usdt,sell_usdt,agg_count,first_agg_id,last_agg_id,first_trade_id,last_trade_id,status,source,quality_json,revision`。`agg_count` 是聚合訊息數，不宣稱真實逐筆成交數；總量、買賣差值、CVD 由前端算，跨日 CVD 起點需明示。

- 正常無成交且可確認 feed 覆蓋：qty/notional/count 為 0，OHLC 為 null，status=`empty`；若圖表需要前值畫線僅顯示層處理，不修改研究表。
- 斷線、未確認完整、失序未修復：status `partial/missing`，不以 0 代替未知；可保留實際收到的部分數值並清楚標記，完整回測預設排除。
- 短暫漏段可用官方 REST aggTrades 補抓（遵守 rate weight、時間限制與分頁），不可將補抓的時間冒充當時可用；原先有效資料不要無聲覆寫。每日檔封存後有必要修復才產生新 revision，非例行改寫。
- aggTrade 可涵蓋的成交範圍不一定等於官方 K 線，故另存官方 1m；不要硬要求完全一致。

## 5. 官方 1 分 K

`futures_1m`：`t,available_at,asset,open,high,low,close,volume,quote_volume,taker_buy_qty,taker_buy_usdt,trade_count,status,source,quality_json,revision`。

從 Binance USDⓈ-M 官方 closed kline（WS `x=true` 或對應已收盤 REST）保存，未完成 K 不進正式表。REST 補漏需標記 `recovered` 及實際可用時間。舊資料只保留已存在欄位與原始 source／observedAt；不以 1m 補造 10s。新版 1m 是獨立官方來源，不用 10s 結果冒充官方。

## 6. 事件與版本

`events` 只記重要變化：feed disconnect/reconnect、sequence gap、snapshot timeout、coverage shortage、repair、clock skew、restart、archive failed、data eviction、disk pressure。限制重複訊息頻率，不儲存高頻原始訊息。保留 UTC 時間、venue/asset、code、message、相關時間範圍。

PK：spot `(t,venue,asset)`；合約 `(t,asset)`。`revision` 預設 1、每次允許的修正遞增。`available_at` 不能因後修倒退；需要同時保留原始狀態時使用原版 archive／原始匯出。封存前的 upsert 應確定不覆蓋有效完整資料（除非可證實修正）。封存後 revision +1，保留原版文件。回測應記錄資料集、檔案 revision、時間範圍和 SHA256；不得用新版修復後數值假稱原始實盤可用。
