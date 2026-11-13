# MarketDepth VNext｜唯一總進度紀錄

版本：PLAN-1.0／分派 R2；2026-11-13（UTC+8）。本檔由本統一主控對話維護，工作者交付進度回報，由主控合併。不需要每個對話自己建立不同 Master 規格。

## 已完成規劃

- [x] 使用者確認四家現貨交易所、60s、五區；不新增 OKX/Bybit；監控頁直連不改。
- [x] 使用者確認 Binance USDⓈ-M 三商品 10s OHLC＋成交量／主動買賣差；另存官方 1m。
- [x] 使用者確認 VM 架站、HTTPS＋密碼、Drive 每小時快照＋每日封存、1GB 容量強制刪最舊、全部舊資料匯入。
- [x] 原始資料保存、ALL4 至少兩家、瀏覽器負責衍生計算、IndexedDB 快取。
- [x] V66 source SHA256、372 檔及關鍵模組盤點；前次舊歷史 gzip 已稽核（僅背景，正式 D 等待新檔）。
- [x] 整理架構、DDL 草案、API 契約、分工、部署驗收、風險。

## 原始 R2 實作進度（歷史基線，非現況）

| 任務 | 狀態 | commit／證據 |
|---|---|---|
| A Go/SQLite/collector/API（ChatGPT） | 未開始 | — |
| B Drive/archive/retention（ChatGPT） | 未開始 | — |
| C V66 前端（Codex 或反重力） | 未開始 | — |
| D 歷史匯入（ChatGPT） | 等待使用者提供新檔；可先做工具 | — |
| E 主控、整合、HTTPS、部署（ChatGPT） | 可開始協調；部署等待 A–D | — |

## 待驗證與阻塞

- 使用者 Google Drive OAuth 一次授權、專用資料夾與實際空間；token refresh/還原未測。
- HTTPS 網域或 IP 憑證方式、憑證自動續期未定案；不擅自購買域名。
- 新收集器 10s/1m 與 Go/SQLite/網站並行的 512MB 真實負載及網路費用需壓測。
- V66 原版完整 npm 測試、build 未執行；監控頁 proxy/extension 在新 origin 需測。
- 正式新歷史檔尚未提供，匯入尚未執行；切換前確認歷史匯出以外的 AWS/Railway/Sites 尾端資料。
- DDL/JSON 共同契約的實作與測試尚未完成；SQL 草案已在生成交接時做基本建表語法檢查（不代表功能驗收）。

## 本輪無生產變更

沒有修改正式 GitHub、AWS、Railway、Sites、Google Drive 或歷史資料；沒有啟用交易機。僅產出本規劃包。

## 變更紀錄

- 2026-11-13 PLAN-1.0：整合最終決策，淘汰 Railway/Sites/本地常駐服務架構；加入 Drive 封存、原始資料契約、分派、驗收與來源清單。

- 2026-11-13 分派 R2：拆成五個獨立包，A/B/D/E 優先 ChatGPT，C 交 Codex 或反重力；D 以使用者日後新匯出為準；不附任何歷史資料。共用資料契約與架構不變。

## 2026-11-13｜R3 統一主控接管（Phase 0）
本輪 A/B/D/E 合併至本對話，C 僅 Codex。PLAN-1.0、MD-VNEXT-1 不變。
已讀四包全部共同規格及各任務入口，56 項 ZIP 成員，所有清單 SHA 驗證通過，共用 SQL SHA256 616e306b2ce5f10aedc8e9c7d4dbe5584c1965b9b244ff03836e19ca3b1f8640。
權威工程補充及 12 項風險處置見 PHASE_0_REVIEW.md；原 SQL 未改。
GitHub 指定 commit 核心七檔讀取成功；60s、五區、T±1500ms、已驗證來源確認，Bitfinex 精確 mapping 與完整回歸尚待 Phase 2。
AWS GetInstance 唯讀確認既有 Sydney Nano running、0.5GiB RAM、2 CPU、20GB、static IP；沒有證據表示 VM 內收集器本輪已驗證。
SQLite 3.46.1 quick_check ok/user_version=1；重複及 off-grid 被拒，負數/過早 available_at/未知 status 需應用驗證。容器 Go 1.23.2，Git 2.47.3；直接 git DNS 失敗，GitHub connector 正常。vnext 分支查詢無結果。沒有建立分支或變更遠端資源。

| 工作 | 現況 |
|---|---|
| Phase 0 E 規劃 | 完成；可進入隔離開發 |
| Phase 1 A/E 共同 scaffold/契約 | 下一步；未實作 |
| Phase 2–3 A 後端 | 未開始 |
| Phase 4 B Drive | 未開始；可先 mock |
| C Codex | 尚無交付；等 API mock / proxy inventory |
| Phase 5 D | 正式歷史未提供；可先 fixture |
| Phase 6–8 E 整合/部署/切換 | 待前置驗收與批准 |

工程決策：使用 R3 統一治理，保留外部契約；游標採 durable journal + reconcile/resync、Drive generation manifest 發布、總容量協調、歷史來源隔離、應用 validator 等為待實作驗收的工程預設（詳 Phase 0）。建議 repo 內 vnext/ 隔離子目錄，待確認 CI/部署 trigger。
下一步 Phase 1：隔離 scaffold、schema 一致性測試、API OpenAPI/JSON fixtures、store/archive interface、C 交接；完成後交 Codex。
阻塞：真新歷史、Drive OAuth/容量/授權、TLS、C proxy/前端交付、VM SSH/實際資源、容器網路依賴和 repo CI 規則尚未確認。
本輪生產變更：無。沒有修改 GitHub、AWS、Railway、Sites、Drive、舊資料，沒有下單或購買資源。

## 2026-11-13｜Phase 1 第一輪隔離實作
使用者批准開始開發，C 前端延後至後端達到一定程度；主控採 Phase 3 基本驗收後交 C 的工程安排，不提前要求前端工作。

- 已建立獨立 `vnext/` Go 1.23 module，model/store/archive/httpapi 及 CLI；無外部 Go 依賴。保留原始 schema.sql SHA256 616e306b2ce5f10aedc8e9c7d4dbe5584c1965b9b244ff03836e19ca3b1f8640。實際 SQL 測試及三種 API row 欄位一致。
- 完成 nullable row、基本值域/時間/狀態/OHLC/ID 驗證、台灣日界、記憶體 mock 批次寫入及 revision、history keyset、sync journal、generation 失效、gzip JSONL 及尾 manifest；7 個 GET 模擬路由，3 個 auth/day 預留路由回 501。所有 mock 回應標示 synthetic，CLI 只允許 loopback 與明示 --mock，無真資料。
- 已產出 OpenAPI 3.1 初稿、實際 mock JSON fixtures、C 接口草稿（不提前交 C）。初始 history limit 500/max 2000、查詢最大 31 日、日期目錄起訖均含；初始工程預設，正式壓測後再固定。
- 驗證：go build、go test（6 個具名測試函式）、go test -race、go vet 通過；SQLite quick_check/schema hash/NULL-0/PK/時間格/交易所限制通過；三種 OpenAPI row schema 與實際 JSON fixture 驗證通過；本機 HTTP fixture 擷取成功、gzip 完整性與公開 bind 拒絕測試通過。詳 docs/PHASE_1_TEST_RESULTS.txt。
- Phase 1 尚未全驗收：未建立正式持久化 store，mock journal 不可跨重啟持久化，history cursor 遇任意寫入即失效；真 auth、限流、daily archive、細緻 gaps/來源與品質驗證尚待後續階段。API draft 不宣稱為最終契約。GitHub connector 搜尋 workflow 無結果，不能證明無部署觸發；容器直接 GitHub 網路不可用，尚未推送，先以本地隔離程式包保存。SQLite 系統函式庫可用，driver 尚未選定；Phase 2 優先選已維護 driver、鎖版並測試，避免自製未驗證 driver。
- 使用者可提前建立 Google Cloud 專案 `MarketDepth-VNext`、啟用 Drive API、確認容量；OAuth client / redirect / secret 暫不需建立或提供。正式歷史檔仍待提供；前端不阻塞。
- 無正式 GitHub/AWS/Railway/Sites/Drive/歷史資料修改、無任何真行情連線、無資源購買。下一步 Phase 1 剩餘隔離版本與介面核對，接 Phase 2 真 SQLite writer / WAL / recovery / spot 移植。

## 2026-11-13｜Phase 2 第一輪：每日 SQLite primitive + 現貨深度核心
- 使用者已建立 Google Cloud 專案、啟用 Drive API，自述剩餘 69GB。正式 OAuth/實際可用容量未驗證。主控建議由應用首次授權後建立 `MarketDepth-VNext` 專屬可見根資料夾，以 folderId 固定；historical/active/legacy/catalog/config/staging 子目錄，測試與正式隔離。已有資料夾必須取得逐檔/資料夾授權，不僅憑 ID。未新增或寫入任何 Drive 檔。69GB 保存年限待真資料壓縮量測。
- 為防舊服務自動部署，建議新私有 repo `hugo90082/MarketDepth-VNext`、初始化 README、不連接部署；使用者需建立並允許 GitHub connector 存取。新 repo 尚未確認存在，未寫入任何 GitHub。後端 module 路徑改為對應新 repo `/vnext`；舊 repo/基準 commit 不改。
- 新增 Daily SQLite primitive（注入 database/sql driver），原 DDL embed、日期/contract/欄位/封存狀態檢查、WAL/FULL/busy_timeout、交易批次、初始 live revision=1、NULL/0、64-bit ID、同值 retry、衝突拒絕、跨日拒絕及讀取。尚非完整日庫管理器；修正先禁止，待 catalog/outbox 實作，禁止把原值覆寫。單連線離線 dump 不用於正式 API。
- 新增現貨 normalize + 五區/側別覆蓋/zero-null、Kraken exact-first merge、Bitfinex P1/P2 merge、T±1500ms、Binance SOL/Coinbase REST row 轉換，過窗 missing。GitHub 舊基準 `spot_rest.go` 已核實 Bitfinex tBTCUSD/tETHUSD/tSOLUSD（非 UST）、P1/P2 len250，Kraken XBTUSD/ETHUSD/SOLUSD；未完成舊程式完整回歸、未連實盤。
- 測試：Go build/test/race/vet 通過（不含 driver tag）；原 schema SHA256、Go 產生三表 SQL 在真 SQLite 參數化插入、NULL/0、64-bit 精度、rollback、已提交 WAL 子程序非正常關閉後恢復通過。詳 `docs/PHASE_2_FIRST_RESULTS.md`。驅動候選 mattn/go-sqlite3 v1.14.32 已鎖版；環境 DNS/proxy 受限下載失敗，go.sum 尚未取得，tag `sqlite_integration` 測試未執行成功。不可視為正式 Go/SQLite 驗收或掉電測試。
- 下一步：新 repo 可用後完成依賴與 CI 整合；daily manager/單寫入/跨日/獨立讀取/持久 catalog 與修正治理；移植四家實際取得方式與驗證 750bps，然後 Phase 3。C 仍暫緩，OAuth 到 Phase 4，最新歷史檔待提供。Phase 2 狀態：進行中，非完成。無生產環境、AWS、GitHub 舊版、Drive 或歷史資料變更。

## 2026-11-13｜Phase 2 第二輪：新版 GitHub、真 SQLite CI、日庫管理與 REST adapter
- 使用者已建立 private `hugo90082/MarketDepth-VNext`，並授權持續自主開發、遇不可自解問題再詢問。GitHub connector 確認 pull/push/admin 權限與原始 main `89b3e2a5563436ec2fe0c1cfe27e69fa0e615e4f`。建立獨立 develop，Phase 1/2 第一輪 38 檔逐一核對 Git blob SHA 完全相同，基準 commit `400363792e243392b090972fa9808cb7ec44da72`。main 不變。新增僅測試、不部署的 CI `5a4beec13e8985a702509c7267c4f9fb8940c7a6`。以 GitHub develop `vnext/docs/10_MASTER_LOG.md` 為唯一權威紀錄，本地下載為鏡像。
- GitHub Actions [run 43433476277](https://github.com/hugo90082/MarketDepth-VNext/actions/runs/43433476277) job 131912533141 已完成 success，逐步查證 Go tests/race/vet/build、真 `mattn/go-sqlite3 v1.14.32` `TestSQLiteDailyIntegration`、SQL tests 全過。真 driver 驗證初始寫入、同值 retry、不同值衝突拒絕、batch rollback、跨日拒絕、關閉重開、64-bit ID 與 NULL/0。Go.sum 已依該 run 日誌鎖定，後續 CI 加 `go mod verify` 與 tagged race。容器本身仍無 DNS，依賴由 CI 取得；不等同 VM 真實壓測。
- 新增 Linux Manager：專屬 0700 data root、flock 單 writer、拒絕 symlink、每次只持一個 writable daily handle、單日原子 batch、read-only 獨立 Get、不存在日期不建立、過期日拒寫、未來 t/available_at 拒絕。跨日 grace 暫定 5 分鐘（工程預設，待真排程/延遲驗收）；live writer 禁止開 legacy/mixed/sealed。新增 pinned SQLite DSN，read-only query_only、busy timeout/FULL/foreign_keys。離線 go test/race/vet 通過；初次測試 fixture 位於 grace 邊界導致預期錯誤，已修正測試時間為中午再驗證；新增 tagged 真 driver 跨日、互斥、重開、過期拒寫及不存在不建立測試，等待新 commit CI。仍缺 bounded queue、長歷史 Reader、持久 catalog/outbox、修正與 seal、1GB 協調；Manager.Get 短讀目前仍在 lifecycle lock 內，不可當正式查詢層。
- 新增 public REST adapter（固定 legacy URLs）：Binance SOL 5000、Coinbase full L2、Bitfinex P1/P2 len250、Kraken BTC/ETH GroupedBook depth1000/grouping1000、Kraken REST500 fallback。嚴格拒絕 malformed/錯誤 pair/HTTP 錯誤/多餘 JSON；不靜默跳過壞 level；預設 32MiB response cap、4s HTTP timeout 為暫定工程限額，須實測。捕獲時間為解碼完成時（沿用舊 convention）；返回 normalized depth 及 provenance，尚未連上 live scheduler。fixture 測試 go test/race/vet 通過。Kraken grouped pair/format、Binance live 750bps、Bitfinex 實際深度均未實盤驗證。P1/P2 各自窗驗證與 WS primary/coordinator 尚待整合；禁止 Binance BTC/ETH 走 SOL REST adapter。
- 本輪尚未完成 Phase 2：持續 Binance BTC/ETH diff WS exact-T/序列/refresh、Kraken WS primary、完整 12 row 取樣排程、日庫 manager+collector 整合與實盤 QA 尚未完成。下一步先完成這些與 durable catalog/outbox；Phase 3 後再交 C。未修改舊 repo/main、AWS 正式服務、Railway、Sites、Drive 或歷史檔。暫無需使用者操作；Drive OAuth、正式歷史資料及部署前驗收仍待對應階段。

## 2026-11-13｜Phase 2 第三輪：四家現貨完整取樣路徑初版（未實盤驗收）
- 第二輪 commit `30c861e6ee24cbb50941762c8c84f8bbea7f38b0`，GitHub Actions run 43433954851 / job 131914183725 已確認 success，包括 Go 單元、race、vet、真 SQLite tagged integration（Manager 跨日/鎖/讀取/重啟/過期拒寫）及 tagged race；schema/SQL 回歸通過。
- 重新核對舊 `orderbook.go`、`exchanges.go`、`spot_rest.go` 和 `go.sum`；保留 Binance 1000ms diff、REST5000、U/u bridge、45s depth freshness、5s headroom check、15m refresh。重寫單 mutable map + 3 個分鐘摘要 exact-T cut：在任何 T 後事件前凍結 T；可信邊界與簿同時切換；刷新期間保留外層並重播 0 數量刪除，避免舊 refresh 的潛在遠端撤單遺漏；必須證明 bridge，不以空 buffer 當就緒。序列錯誤、資料過期、異常 memory cap、receive clock 倒退 fail closed。以 feed admission lock 時刻為 causally admitted timestamp；socket 接收與 admission latency 待實測，`captured_at=T` for exact cut，quality 記錄最後 admitted depth ts/seq。上限 100 萬價位/簿、4096 bridge messages/20 萬 levels 為暫定 fail-closed 安全限額，非證實適合 512MB；不得靜默裁剪至失真。離線 bridge/cut/refresh deletion/trusted/observed/freshness/parity/session buffer 測試通過。
- 新增 `live_ws` build-tag Binance BTC/ETH 真 WS transport、REST bootstrap、重連/refresh 及 Kraken WS depth1000 三資產批量 snapshot；鎖定舊版 gorilla/websocket v1.5.3 與校驗碼。純離線核心 go test/race/vet 通過；網路 tag 真編譯/測試待下一次 CI，尚未發出任何真實行情請求。
- 新增 12-row 分鐘 sampler：原 T±1500ms 取樣窗、逐來源捕獲窗驗證、Kraken exact-first + group-only-on-unknown + REST fallback、Bitfinex P1/P2 固定且兩者都有效（沿用舊錯誤整列拒絕；修正舊只看 max recv 的問題）；grouped/rounded BBO 未確認保留 NULL，可信覆蓋只報 native exact，quality 含各來源 mid/coverage/captured_at 與側別出處。Kraken WS 比全批 deadline 提前 100ms、批處理 grace 150ms 為暫定工程預設，並不放寬取樣窗。明確 12 keys、不用晚到行情補造 missed window；每列 status+source_failures；events 表持久化及跨日回補未做。available_at 為批次處理完成時，正式 commit 發布與持久 journal 的時間語意尚需 Phase 3 驗證。
- 新增 `cmd/spotprobe`（linux/live_ws/sqlite_integration tags），必須新建不存在的 data-dir，1–10 分鐘、只寫獨立新 SQLite，不啟動正式服務；CI 只 build，不自動對外探測。實際四家交易所 live reach/coverage/舊版回歸、長時間資源與主機網路未驗證。現有 sandbox DNS 無法取得真資料；GitHub runner 可建置，但 Binance 地區連線限制可能影響 probe；最終需在隔離 Sydney 環境驗證，未改 AWS 正式服務。
- 本地 go test/race/vet、schema hash/fixture、SQL 回歸全數通過；待新 CI tagged build。Phase 2 尚未 freeze：真連線/750bps、Kraken fallback 格式/成功率、scheduler 真整合、events、bounded queue、durable catalog/outbox、資源及長時間 QA 尚待完成。Phase 3 合約及正式 API 未開始，C 保持延後。未修改舊 Repo/main、AWS、Railway、Sites、Drive、既有歷史；無下單或購買資源。
