# 06｜舊資料保存、匯入、回測（任務 D）

## 1. 原始資料（不得修改）

**正式輸入尚未提供。使用者將在任務 D 開始時另外上傳最新歷史匯出檔案。不要使用前一份舊匯出作為正式匯入來源，也不要要求其他組取得該檔。**

- 收到新檔後記錄實際檔名、bytes、SHA256、格式、manifest、各 record type、來源、開始/結束時間及完整性。若有多檔或重疊，先制定去重及來源規則，保留所有原檔，不擅自合併覆蓋。
- 之前已稽核的 2026-11-12 匯出（65,907 筆深度、231,129 筆 1m、2,114 個缺失分鐘）僅為歷史背景及解析器參考；**不得當作新檔的筆數、hash、時間範圍、驗收基準**。先確認新檔 schema 是否仍相同；如不同先報告映射差異。舊 30s 平均值與早期價格來源問題原樣保留，不重新修復。
- 尚未收到新檔時，可以用明確標示的合成 fixture 開發、測試匯入工具；不得將模擬結果當真實匯入完成。正式匯入／雲端上傳必須使用新檔，並依實際資料重算驗收。
- 永久保存新原始匯出與 SHA256，匯入副本不取代原始證據。新檔可能仍非整個 Sites D1/Railway/AWS 備份；切換前由 E 核對各來源尾端時間與缺口。

## 2. 匯入方式

- 在本地或較大記憶體測試環境串流解 gzip/JSONL（不可全載 RAM）。先驗 manifest、schema、順序、summary，記錄重複、缺失、非法值；不要相信 filename 或單一全域舊 schema 能證明每列實際來源。
- `depth.d[venue][asset][zone][side]`，venue 順序 binance/coinbase/kraken/bitfinex，asset BTC/ETH/SOL，zone 0–100/100–200/200–300/300–500/500–750，side bid/ask；每筆展開最多 12 個 `spot_depth` row。保留 null/0，`t` 原樣，`a` 映射 `available_at`（未知/矛盾則另標，不硬推時間），source、cadence、captured、issues、quality、format、finalVersion 放品質欄位；舊檔沒有 BBO/mid/coverage 就 NULL。`ratios` 不需再保存到新表，但原始檔永久保留可稽核。資料來源是 legacy railway/browser，不改成 vm_vnext。
- `candle` 讀 `asset,interval,t,o,h,l,c,v,closed,complete,observedAt,source`；匯入 `futures_1m` 對應欄位，quote volume、taker、count 未提供即 NULL；原有 `observedAt` 保留（早期過早／缺失不能當實際可用的證據）。未收盤標記保留為 legacy 狀態，不當正式已收盤使用。
- 不補造 10s 資料，不插值、不 forward fill、不用後續價格修補、不用缺失的品質欄位推測真相；對舊 30s 平均值不再修正。可依既有 `a` 或可辨認的原始模式標記，若不知道原生／合成來源就寫 unknown，不用一個固定 +30s 套全部。
- 對新檔按實際 record type 計數；每個 depth row 展開 12 個來源格（允許完全 null 的列），1m 依實際商品與筆數，若新檔無 10s 則輸出 0 筆 10s；不可從 1m 合成。若新檔原生含 10s，先驗證 schema/來源再向 E 確認映射。實際輸出計數、缺值及逐列比對必須重算；有任何違反 schema 或衝突，記錄 quarantine 而非無聲丟棄。每日日界採 Asia/Taipei；各日為獨立 SQLite archive；manifest 標 `data_origin=legacy`。
- 重複匯入 idempotent；若已與 VM 新版時間重疊，不任意覆蓋：新正式 source 與舊來源各自保存原版，明確設定切換時間及新資料優先的查詢規則；若同一日混合可建日檔新 revision，保留兩個原始來源與衝突紀錄。禁止覆寫原始 gzip 或雲端已封存版。
- 先用本地測試完成比對，經使用者批准才上傳 Drive `legacy/`（原始 gzip）和 `historical/`（每日 archive）。VM 不應在 512MB 主機上同時解壓整份 152MiB 原始檔、跑生產收集器與大量匯入。允許本地批次生成逐日檔並透過合規授權上傳；不必把完整歷史長留 VM。

## 3. 回測使用規則

- 新版正式訊號 `available_at <= decision_time`，10s 完整收盤後才能用 OHLC/volume；未知舊來源時間不得被宣稱為實盤因果安全。舊資料研究仍可用但清楚標 legacy、可選保守可用時間及研究限制，不擅自改原始欄位。
- ALL4 兩家即可是 UI 正式規則；回測可選四家完整、固定來源、venue_count 或不同品質條件。對比時不要把成員變動誤認為掛單變化。
- 原始各交易所的 5 zones 為基本；累積區、差值、比率和 CVD 由原始重算。
- 10s high/low 只能證明區間觸及，不確定先後；同 bar 雙觸採預先定義保守規則。不得從 1m 還原 10s、不得使用 future 資料。
- 匯出新格式應含 manifest、contract/version、source、時區、units、各 kind 筆數、缺口、revision/hash、時間範圍、資料可用時間。保留舊原始備份與回測輸出版本。

## 4. 驗收

逐日、逐 asset/venue/zone/side 比對原始金額與 null mask；時間戳、來源、OHLC、成交量比對；確認無重複、缺格統計不變；API 查詢與 UI 匯出抽樣 3 日、跨日、缺口、舊新交界。提供 machine-readable audit JSON 及中文摘要、匯入程式、命令、輸出清單/雜湊。不能以模擬行情替代真實歷史。
