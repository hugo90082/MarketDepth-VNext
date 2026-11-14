# MarketDepth VNext｜Phase 0 統一規劃核對與工程補充
2026-11-13 UTC+8｜PLAN-1.0 / 分派 R3 / MD-VNEXT-1
狀態：架構審查通過；允許隔離開發，不代表實盤、部署或完整驗收通過。

## 1. 基準與治理
四包各 14 項，SHA256SUMS 所列檔案全部相符；共用文件及 SQL 位元一致。原包不可覆寫。
SQL SHA256：616e306b2ce5f10aedc8e9c7d4dbe5584c1965b9b244ff03836e19ca3b1f8640。
使用者本輪指示優先於舊 R2 任務分派；A/B/D/E 本對話，C 僅 Codex。01 產品規格、02+SQL 資料契約、03–07 實作、08 分派（以 R3 覆蓋）、09 來源、10 唯一進度。新工程預設可測試及更正，不變更產品要求；若需變更外部欄位、語意或日庫 schema，先記錄變更、更新版本及通知 C，不無聲更改。
正式 main、舊 AWS/Railway/Sites、歷史資料、秘密不變。真 Drive 操作、付費、停舊服務及正式切換需使用者批准。交易執行不在範圍。

## 2. 已查證
GitHub 指定 commit 4d030e3c4dda2c85e5404e96e10b7fd6abed7c9c：已經由連接工具取得 config.go、exchanges.go、spot_rest.go、storage.go、go.mod、model.go、main.go；並非全部實碼已完成回歸。
- Go 1.23；60s、五區 [low,high)、USD/USDT 名義 1:1；REST 前置及接受窗口皆 1500ms（T±1500ms）。
- Binance BTC/ETH REST5000 + @depth 1000ms diff、U/u bridge、exact-T cut、15m bootstrap 與 edge refresh；SOL REST5000。Coinbase full L2 REST BTC-USD/ETH-USD/SOL-USD。
- Kraken REST XBTUSD/ETHUSD/SOLUSD，WS BTC/USD、ETH/USD、SOL/USD；exact depth1000，BTC/ETH grouped 只填不足側；REST500 fallback。Bitfinex P1/P2 保留，精確 symbol 尚須讀完整映射。
- Binance observed/trusted 分離，不能把 observed 當完整可信 750bps。舊 storage.go 有 RemoveAll，禁止移植。
- GitHub 查詢 vnext 無結果；未建分支。連接工具讀成功；容器 git ls-remote DNS 失敗。容器 Go 1.23.2、Git 2.47.3、SQLite 3.46.1。依賴下載和可重現建置尚未確認。
- AWS GetInstance 唯讀：marketdepth-sydney-nano running，nano_3_2、Ubuntu 24.04、2 CPU、0.5GiB、20GB、static IP 已附加。無 SSH、容器內健康或帳務即時驗證。
- SQLite 記憶體建表 quick_check=ok、user_version=1；null 可寫、重複 PK 及 off-grid 拒絕；負數、10s 提早 available_at、未知 status 可寫（依原 SQL 設計由應用驗證，須補測）。
- 四包無真歷史檔、無 C source ZIP（C 自行持有）。

## 3. 工程審查與處置（不修改原 DDL）
| ID | 風險或歧義 | 工程決策 / 驗收 |
|---|---|---|
| CR-01 | per-row available_at 與整批/修正語意 | 新 spot 可見時間至少為完成與提交時刻及 t；組合 ALL4 的可用時間取參與列最大值，保留原始捕獲時間及每側來源/時間；歷史重修不能回填較早可用時間。新 10s/1m 不早於收盤。 |
| CR-02 | 日內修正不能以 t 或 row revision 當全域游標 | 建議在獨立本機 durable catalog 實作全域 ingestion journal、單調序號與 generation；日庫提交和 journal 不假設跨 WAL 原子性，設 durable intent/outbox/reconcile，重啟若不能證明完整則強制 resync，原日庫 schema 不改。history cursor 绑定 query、排序、日 revision；active 變動時提供一致快照或明確重抓。sync 游標過期/封存換版須明確 resync。 |
| CR-03 | Drive 快照 data/manifest 無跨檔交易 | 每次新 generation 上傳並驗證，再發布 manifest 指向 verified fileId/hash；保留上一驗證代直到新 manifest 可讀驗證，失敗不刪。封存與快照狀態分開，單 writer、logical key 去重，恢復以 verified manifest 為準。 |
| CR-04 | WAL、暫存、下載及快照可能突破 1GB | 所有行情 allocated bytes + 任務預留同一 budget coordinator，含 WAL、SHM、catalog、part、壓縮解壓、快照、讀取 cache；950/900MB 水位、1,000MB 硬限、根磁碟 1GB 保留。100MB cache 不足時僅受控單日處理且仍在總限內；無空間回明確錯誤。刪除先持久化 tombstone，區分已有小時快照可恢復段；保護 active、reader、OS、舊 production。 |
| CR-05 | 10s 亂序、重連、無成交與日封存 | event-time T 分桶，(T,aggID) 排序、asset+ID 去重；以可證明覆蓋及有界 lateness/修復窗口結算，不能僅憑 ID 跳號或無消息判定；重啟可重放並去重，不完整標 partial/missing；官方 1m 獨立。grace 初始至少 2m，實測再定；封存之後修復新 revision。 |
| CR-06 | legacy off-grid、未知時間、重疊 | 新檔收到才驗映射；原始非對齊/非法資料 quarantine 並保留原始證據，禁止 round 或造10s。unknown available_at 保留 NULL/原始欄位，策略排除；不同來源各自保存、cutover 時刻前後明確選擇 canonical，混合日新 revision、衝突逐列 audit。不可把 1m legacy 標官方 closed。 |
| CR-07 | 原 SQL 不驗證負值、狀態、非有限值、時間因果 | 以型別及 app validators + fixtures 驗證 finite、非負、BBO/OHLC、狀態/來源、day/t、null/0；新資料拒絕或 quarantine，不偷偷修舊值。 |
| CR-08 | 多來源品質不一致、BBO/mid 語意 | Kraken grouped/Bitfinex P1/P2 每側來源、捕獲時間及參考 mid 留 quality_json；主 BBO 採明確 primary 並不假稱同一快照；保留既定 zone 算法及單位語意驗證；不再要求舊新版實測數值一致性比較；ALL4 按完整 paired venue 集合，揭露成員變動，研究不將換員誤認為變化。 |
| CR-09 | 512MB 雙收集、備份及長匯出互搶 | 外部 build/fixture/CI 先測；新服務獨立路徑及 loopback，禁止未授權長期雙跑。資源壓測需跨至少兩日界，收集優先、限制並行及記憶體；若不可能安全驗證，先使用測試環境或取得短時測試批准。 |
| CR-10 | C 尚無 API 最終 mock；登入和匯出邊界 | 先定 OpenAPI、JSON fixtures、nullable/status/gaps、cursor/reset、登入 cookie、CSRF、gzip JSONL 完整性（尾端 manifest/計數、截斷可偵測）、日期 revision。cache canonical key 不含 row revision（revision 用來判斷取代）。登入頁與必要公開靜態資產可匿名；私有內容須驗證。C 先交 proxy route inventory，A 再實作白名單。 |
| CR-11 | OAuth、TLS、歷史尾端、Drive quota | 真帳號測試、憑證續期、空間、授權失效、完整復原、新舊末端資料核對皆為切換必備；不可預設免費額度或永續 token。 |
| CR-12 | 新舊 archive 同日碰撞與封存版本 | 日檔 revision 由唯一 catalog 協調，不能各來源自行發布相同 day/r；封存前多來源 staging 隔離，manifest 原始來源和 hash 明確；無重疊批准不做合併發布。 |

## 4. 統一開發階段與驗收門
| Phase | 工作 | 驗收（未完成不得宣稱通過） |
|---|---|---|
| 0 | 共用規劃審查 | 四包 hash、核心舊碼、SQL probe、AWS 唯讀、風險登錄；本輪完成 |
| 1 | A/E scaffold 與共同介面 | 隔離分支；原 schema hash、Go store/archive interface、OpenAPI、mock、fixtures、測試及 C 交接；API 不需等 collector 完成 |
| 2 | A SQLite/store + spot | 12 streams/分鐘，與舊版同時間窗/zone 比對，null/0/coverage、時鐘、WAL/restart、單 writer |
| 3 | A futures + API 完整化 | 10s OHLC/主動量/金額、官方 1m、ID/亂序/補漏、收盤可用時間；history/sync/auth/streaming、revision |
| 4 | B Drive + retention | mock crash/retry/hash/restore/eviction、容量預留與 tombstone；實際 OAuth 及真 Drive 測試後續 gated |
| 5 | D 歷史匯入 | fixture 串流、idempotence、逐列 audit；真檔收到再驗 hash、schema、null、日庫及衝突，不造資料 |
| 6 | A/E+C 整合 | C build、proxy inventory、桌機/手機、登入、快取、舊新資料、V66 功能；合併隔離 integration 分支 |
| 7 | E 隔離部署與最終 QA | 24–48h 且跨至少兩日界（必要時延長）；47,520 預期 grid/日、缺格原因、四所 coverage、資源 P50/P95/max、無 OOM/非預期重啟、長匯出並行、Drive 真帳號 restore、TLS/安全、rollback |
| 8 | E 正式切換 | 真歷史與舊尾端全保存；使用者批准、記錄切換時間及最後 t/ID、回復路徑；使用者確認後才停舊服務 |

C 可自 Phase 1 前就盤點 V66，Phase 1 mock 交付後並行；B/D fixture 可先做，正式接口依賴 Phase 1。各 phase 逐項記證據，不以 mock 取代真實驗收。
建議新程式放原 repo 的 vnext/ 子目錄以避免舊根 module/Dockerfile 被無意觸發；分支 vnext/backend、drive、frontend、legacy-import、integration 以共同 scaffold 起點。是否有自動部署 trigger 必須先核對，不直接更新 main。
GitHub 連接工具可讀寫，但本地容器 DNS 不通；下一步先確認依賴取得/CI 與分支部署規則。無法證明安全時先本地 scaffold，待可重現 build 再提交。

## 驗收範圍修訂（2026-11-15；優先於前文）
2026-11-15 使用者決議：取消舊／新收集器同時窗深度金額逐筆偏差、相關性及聚合數值一致性比較作為 Phase 2/7 驗收門檻；不同捕獲時間及訂單簿覆蓋天然有差異。保留新版自身的18流到期主鍵完整性、逐交易所/商品/區間/側的實際非NULL覆蓋、status與失敗原因、交易對/現貨合約/單位/區間及時間對齊正確性、finite/nonnegative/NULL與0、observed與trusted區分、ALL4同側完整paired集合至少2家等既有資料品質規則。不得將present/missing占位列當有效行情或把observed750當trusted750；若有效覆蓋不足或出現異常，依證據個別處理，不設定任意新數值門檻。此決議只免除跨版本行情數值比較，不免除原始歷史映射逐列核對、備份復原逐列一致性、歷史與新資料時間重疊/缺口檢查、跨日資源/API/Drive/OAuth/前端/正式切換等既有門檻。現行24h測試不改binary、監控、資源及運行時間；待其真實結果完成最終Phase2/7資料品質驗收。
