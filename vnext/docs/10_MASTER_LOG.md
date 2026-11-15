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

## 2026-11-13｜Phase 2 第四輪：真實行情 probe、原子失效事件及 bounded writer
- 第三輪 `671a6982a27d53d143d410cfefa19a39f381f23b` 的 CI run 43434813688 / job 131917056621 已逐步確認 success，含 live_ws + sqlite_integration 真編譯、tagged 測試/race、SQL contracts。前兩輪 CI 亦成功。
- 獨立 QA 分支 `qa/spot-probe-20261113`、commit `d095413acdc4662cfb15dfdb293562334dded747`，run 43434872608 / job 131917255011 完整 success（結構驗收，不等於四家覆蓋通過）。使用 GitHub runner 的公開行情、臨時 SQLite、兩個 60s 格（台灣時間 21:36/21:37）。預期/實際落盤皆 24 rows；18 ok、6 missing。Coinbase、Kraken、Bitfinex 各 6/6 ok，500–750bps 雙側欄位皆有值。Binance BTC/ETH dial_failed，SOL HTTP 451；無法驗證 Binance 750bps，可能為 runner 地區限制，不改 endpoint、不迴避限制。Kraken BTC exact trusted bid 僅約 475–489bps，外層由 grouped 補足，禁止把 grouped 當可信 exact；Bitfinex trusted NULL 符合契約。三家僅兩分鐘樣本，不代表長期可靠性。QA 無交易、無正式資料，無自動部署。
- 新增 bounded 單消費者寫入 queue（容量 1–64，probe 暫定 8；工程預設），滿時明確回錯、複製 row、防 typed nil、close drain，ack 僅於 commit 完成。新增現貨狀態轉換 events（missing/partial/recovered），跟新 row 同一 SQLite transaction，同值 retry 不重複，衝突/失敗 rollback。離線 go test/race/vet 通過；本輪真 driver/tagged CI 尚待新 commit 驗證。注意前一輪 probe 尚未含本輪 queue/events；跨日首筆事件狀態不延續前日，仍需持久 catalog 設計。
- AWS Sydney 唯讀 SSM DescribeInstanceInformation 無 managed node；沒有取得 SSH、沒有更改 VM 或部署。容器直接外連不可用。最終 Phase 2 真實 Binance 驗收、長時間/512MB/舊版對照仍未通過，待隔離 Sydney 可用執行環境。不得改正式服務、不得為測試擅購資源。其他離線開發不受此限制。
- 未完成：durable catalog/outbox、持久修正/游標、seal/1GB coordination、跨日狀態/恢復、正式 collector 排程/資源驗收、Phase 3 futures/正式 API；Phase 2 未 freeze，C 未交付。主控維持 develop 主線，main 舊初始 README 未改；無舊 GitHub/AWS 正式環境/Drive/歷史資料變更。Drive OAuth 與新版歷史依既定階段再處理。

## 2026-11-13｜主線收斂（使用者決議）
- 新私人 Repo 以 main 為唯一長期主線；develop 最新 65ba74857b641e9536fd0fbc6b423a3d22c7e1c7 的 CI run 43435403411 已完成 success。保留 QA commit d095413acdc4662cfb15dfdb293562334dded747 的祖先關係與手動 probe workflow，不再建立常駐 QA 分支。合併不改任何舊版 Repo、AWS 或正式部署。CI 改只在 main push / PR 及手動觸發；probe 改手動觸發。
- Binance 繼續沿用 Railway REST5000 + 1000ms Diff、750bps 觀測覆蓋與可信覆蓋分開的原則，不因 runner 451 改交易所或降深度。實際 Sydney 覆蓋與 RAM 驗收仍未通過；使用者認同既有邏輯，非豁免實測。
- main merge 3bc1799f2dcbcf3775aa53e63a3da0a6ba0dcd25，保留兩個舊分支祖先；一次性 cleanup run 43437339358 已成功，GitHub branches API 證實僅剩 main。cleanup 以確切 SHA、ancestry、force-with-lease 驗證後刪除兩個已合併 refs；移除一次性 workflow，常規 CI 仍為 contents:read。

## 2026-11-13｜Phase 2 第五輪：持久更新紀錄初版
- 新增獨立 catalog.db，不改 MD-VNEXT-1 日檔 DDL。WAL + FULL、generation、持久單批 intent、逐筆變更序號與 SHA256。intent 先提交，日檔再提交並讀回逐筆確認，最後原子發布序號及移除 intent。重啟可核對已提交的舊日（即使超過 grace）或透過原政策重試原批；無法核對時 fail closed，不宣稱同步完成。
- 已發布相同內容重試不重複序號；不同內容拒絕。Manager 開啟 catalog 模式後禁止直接 Put 繞過；現有日檔沒有有效 catalog 則拒絕靜默重建。按日期分組讀取單一唯讀連線，避免每列重開 SQLite。Sync 初版支持持久 cursor、2000 rows 分頁、種類/generation 驗證、遺失/不符時 resync。
- 工程預設：單批最多 1000 rows / 4 MiB intent，單頁最多 2000；未做 journal retention、遠端 catalog rebuild、讀者 lease、修正 revision 或 HMAC cursor，亦未將 journal 接入正式 API/collector；只接受 revision=1 的初始 live rows。尚需 1GB 總容量實測、保留策略及 publish time 語意核對。跨日未提交且已過 grace 的 intent 仍阻斷，需要後續恢復/缺口治理。
- 本地 go test/race/vet 及 schema/SQL 回歸通過；新增真 SQLite tagged 重啟/intent 前後兩種 crash 模擬、同值重試、過期已提交核對、跨 kind cursor、阻擋 bypass/靜默重建等測試，待 CI 驗證。正式服務/舊 repo/AWS/Drive 均未改。C 尚未交付。

## 2026-11-13｜Phase 2 第六輪：容量判斷與一致性快照初版
- main 唯一分支已驗證；main merge CI run 43437089832 與一次性 cleanup 所在提交的常規 CI run 43437339463 均 success。cleanup workflow 已從 main 移除。新增 journal commit `3cc7f48fe5a12d1356e786bec0ba70344e0bdc44`；其 CI run 43437583725 目前尚未確認完成。
- 補強 catalog 模式：重啟若已存在 catalog.db 或 sidecars，不允許 Manager 直接寫入（先開 catalog）；追加真驅動測試。讀取按日分組且 bounded 2000；目前同步持鎖時間仍需 512MB/長查詢壓測，不是正式 API。
- 新增 Linux allocated bytes 實測掃描（512-byte blocks、硬連結去重、拒絕 symlink/特殊檔）；純 PlanCapacity dry-run 使用 decimal 950MB/900MB/1GB 及 100MB cache，按 cache/failed part/rebuildable snapshot/remote verified day/unverified day 最舊優先。保護活躍、讀者、待寫與 catalog；最後一類標記 permanent loss 且 executor 必須先持久 tombstone。預留空間仍不足時拒絕 optional 或停止寫入。不含實際刪檔/雲端操作；根磁碟低水位、分類、lease、tombstone、執行器及並行 reservation 尚待整合。
- 新增 SQLite 一致性 snapshot primitive（真 driver tag）：專用 mode=ro 連線 VACUUM INTO（query_only OFF 只允許寫獨立目的檔），quick_check、版本/日期/契約、各表 counts、gzip 串流、SHA256、fsync、同 filesystem link 原子且不覆蓋。明確新 generation、非 sealed、非遠端 verified。工程預設：呼叫者明示 reserve，以 DB+WAL 大小 3 倍加 1 MiB 預檢，壓縮途中限制 reserve；raw SQLite 暫存本身沒有 OS hard quota，正式需容量/lease 協調，不能宣稱已達 1GB 硬上限。Python 真 SQLite 已確認 WAL+VACUUM INTO（含預建空檔、唯讀源）可行；Go tagged snapshot/解壓 ID 精度/重複 generation/持續 writer 的整合測試待 CI。
- 本地普通 Go test/race/vet 通過，容量優先順序、保護、cache、hard stop、稀疏檔及硬連結測試通過。未執行刪資料、上傳 Drive、部署或切換正式服務。日檔 seal、durable tombstone、catalog retention/remote rebuild、修正 revision、正式 API 和 futures 仍未完成；Phase 2 尚未 freeze。下一步續做封存與修正、接入 Phase 3，C 延後。

## 2026-11-13｜Phase 2 第七輪：日界封存與封存資訊
- journal commit `3cc7f48fe5a12d1356e786bec0ba70344e0bdc44` / CI run 43437583725 已確認 success（含真 SQLite restart/recovery、tagged/race）。容量及快照 commit `e296df4ced3c72ea5c0dbc60465e9834fd6e182f` / CI run 43438087950 尚在執行，不能先宣稱 tagged snapshot 通過。
- 合成一天 47,520 筆（17,280 spot / 25,920 10s / 4,320 1m；Python 真 SQLite 使用固定 DDL 及同構 journal_change 表，隨機價格/數量及近似品質 JSON，不含真行情、長時間 WAL 及事件）：daily SQLite 15,077,376 B，gzip 5,150,740 B，journal DB 7,954,432 B。只能作為容量初估，非真實上線尺寸。索引約 8MB/合成日，不可無限保留；封存確認後需裁剪安全前綴、保存 cursor floor 及可重建 catalog，待實作。
- 新增 Manager/Journal.SealDay（未自動排程）：只允許過台灣日界及 5min grace 的現有日檔；catalog mode 不能 bypass，待核對 intent 時禁止 seal。保留原 seal timestamp/producer，重複 seal 冪等；WAL TRUNCATE checkpoint、close，失敗保留 seal 並回錯，不刪檔。日檔 schema 不改。
- 擴充 archive.Manifest（不是 MD-VNEXT-1 row schema）：data_origin、expected/missing-grid counts、status counts、raw size/hash；snapshot 從 SQLite 複本驗證日期範圍、筆數及 sealed availability，sealed_at/producer 只能源自已封存日；active snapshot 仍不宣稱封存。壓縮及原始 SHA256 分開。現行只支援 live origin；legacy/mixed 由 D 階段處理。未逐側 NULL 統計、manifest 遠端 fileId/verified state 尚待 Drive 模組。
- spotprobe 現改走 Journal + bounded queue，啟動先 Recover；仍隔離新目錄，無正式部署。新增 seal/grace/pending/retry/封存快照 metadata/新日寫入的 tagged 測試；普通 Go test/race/vet 通過，真 driver CI 待驗證。仍需容量 executor、遠端 verified manifest/catalog/tombstone、修正 revision、完整 1GB/RAM/長時間驗收，Phase 2 未 freeze；Phase 3/C 未交付。沒有修改舊服務或雲端資料。

### Phase 2 第七輪補充：驗證與 active 缺格語意
- 容量/快照 commit `e296df4ced3c72ea5c0dbc60465e9834fd6e182f` 的 CI run 43438087950 / job 131928276703 已確認 success；真 SQLite TestSnapshotIncludesWALAndNeverOverwrites、TestDurableJournalRestartAndRecovery、TestJournalIntentBeforeDailyCommit、TestManagerRequiresExistingCatalogBeforeWrite 均通過，SQL contract hash/WAL crash recovery 通過。
- 封存 commit `0ac288b96a46ff9cdb17d2ebf7577aacd0af10b7`，CI run 43438626031 尚未完成。新增 `grid_through_exclusive`：active snapshot 只統計至各表最後實際寫入時間格的 exclusive end，未來時間不列缺格；sealed 才按完整台灣日計算。各欄位 NULL counts 獨立於缺格與已確認零值，供缺值統計；active 未到的時段或最後一格後停止的時段不宣稱已驗證覆蓋。此為 archive manifest 工程補充，不改固定行情欄位。新增測試；普通 Go test/vet 通過，tagged CI 待確認。

## 2026-11-13｜Phase 2 第八輪／Phase 3 合約核心第一輪
- 上輪 seal commit `0ac288b96a46ff9cdb17d2ebf7577aacd0af10b7` / CI 43438626031、manifest commit `de02424ffccc7ce1fd029e2a5bc72cf4e288eb9e` / CI 43438866737 均已確認 completed success。main 仍為唯一分支。
- 初步 active/grace 日內合約修復：只允許 missing/partial -> recovered，revision +1、available_at 不倒退、官方 REST 方法及 retrieved_at/complete 證據、完整 shape（含確認空桶），拒絕完整列、late 完整性未判定列、spot、sealed、越界、錯誤來源或未發生資料。未改 MD-VNEXT-1 DDL。catalog journal_repair 保存舊列原 JSON/新 hash，與 durable intent 同交易；日檔 compare-and-set + repair event 同交易，publish 再核對 prior hash。Sync 只回該 key 最新已提交 revision（不把舊 hash 當現行列比對），舊游標能取得新 revision；已過時 retry 拒絕、不再 stage。修正路徑只允許內部 collector 使用，非前端可寫。新增 active/grace/future/seal preflight，避免已知政策錯誤污染 intent。sealed 日檔修正新 archive revision、保留原 archive 仍待 D/B 模組；未做自動復原 scheduler。真 driver tagged repair/restart/crash/audit/cursor 測試待 CI。
- Phase 3 核心先行（Phase 2 實盤與硬容量 gate 尚未 freeze）：官方 Binance USD-M migration 文件確認 aggTrade/1m 都走 `wss://fstream.binance.com/market/stream?streams=...`。文件：https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/websocket-market-streams/Important-WebSocket-Change-Notice 及 https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data 。僅 BTCUSDT/ETHUSDT/SOLUSDT 公開流；無交易權限、無 API key。aggTrade 按 T 分桶，[t,t+10s)，同 ID 去重、相衝突拒絕、T/ID 排 OHLC、m=true 主動賣、USDT=price*qty、agg_count 非逐筆數。只在桶前後 bracket agg IDs 連續且時間單調、未標記故障時保守判 ok/empty；ID 跳號是 unconfirmed（不是證明缺單），不以真實 trade IDs 跳號判缺；後桶證據只影響完整性、不計入當桶，available_at 在桶結束及證據到達後。真正實盤的 ID 語意/延遲/coverage 仍需驗證。每資產 rolling window 最多 29,999 trades + predecessor、溢出 fail closed；初步 2s finalize delay，未經 512MB/高波動壓測，不是使用者新增固定規則。三資產共鎖 admission、每 10s 三列，每分鐘多三列官方 WS x=true closed kline；未收盤與錯配拒絕；遲到 K 不靜默覆寫，缺 K 明確 missing。WS reconnect 1-30s、read limit 1MiB/90s、取消時關閉、故障 taint；真 WS tagged build 待 CI，未發真合約請求。
- 官方 REST 恢復：1m 檢查 serverTime + 精確 open/close/欄位，10s 已收盤且距 serverTime <=24h，先取前置 ID 或 10s 前置時窗、再 fromId 分頁（每頁1000、最多6頁），要求 bracket proof，否則不產生修正。用實際取得完成時間標記 recovered。暫定單 client 240 weight/min、共享 header>=1800 或429/418 cooldown、5s request timeout、4MiB response cap；正式多模組共享 IP 限額待驗證。未做實盤 REST、修復工作佇列、隔離 futures probe、正式整合排程/API。合約 10s 與官方 1m 不強求一致。仍須驗證 late trade 處理、時鐘偏差、publish timing、資料缺口跨日及 restart。
- 本地 `go test ./...`、`go test -race ./...`、`go vet ./...` 通過，含 aggregate causal/order/dedup/empty/missing、window capacity、closed kline/collector 6-row、REST mock paging/gap/429/closed；固定 schema hash + Python 真 SQLite SQL 回歸通過。外部依賴由 GitHub CI 驗證。下一步：真 driver/WS CI、正式隔離 probe、封存索引/容量安全執行器、持久 reader 與 auth；現有 VM/舊 repo/Drive/歷史皆未修改。C 尚不交付。

## 2026-11-13｜Phase 3 第二輪：持久讀取與驗證、獨立合約 probe
- 合約及日內修正 commit `e723820a810e2c007adf1e05755847eaf6857093` / CI 43441394931 / job 131939609929 已確認 completed success，包含真 SQLite tagged repair/recovery、race、live_ws 編譯、SQL contract。
- Journal 實作正式本機 Reader：歷史以 keyset 排序且 cursor 綁 generation、kind、時間、asset/venue 及該範圍最高已提交 seq；範圍內新增/修正使 cursor 失效，範圍外寫入不影響。讀回指標核對實際 row/revision/hash，pending 或不一致拒絕服務，不填假值。SQL 聚合缺格（有 NULL row 不算缺格）；31 日/2000 rows/4096 gap ranges 限制，極端碎片需縮短查詢。Latest/Sync/Days 只讀本機已提交資料及 active_local/sealed_local/missing，不宣稱遠端已存在；未接遠端讀回及 retention，現有 cursor 非授權憑證、非簽章。歷史缺格表示查詢範圍內未存列，不等於來源故障；前端應只查已發生區間。鎖持有時間、讀寫競爭、跨種類匯出一致性仍需壓測/治理；export 失敗無 complete manifest，客戶端必須核對結尾。
- API Live mode 與 fixture 隔離，必須有 Auth；原 mock 不開放正式資料。新增可撤銷 HMAC session token + server registry（最多64 sessions，7日固定有效期，重啟登出）、__Host-md_session Secure/HttpOnly/SameSite=Lax、POST 精確 HTTPS Origin、跨來源拒絕、登入每來源5/min/全域20/min、單一 bcrypt 驗證及 session 120/min；實際 RemoteAddr，不信任轉送 header，正式反向代理與 TLS 設定待驗證。bcrypt cost 10–14，建議12須主機測試；x/crypto v0.41.0 pinned，維持 Go1.23.2 CI 基線，正式部署前須升受支援 toolchain 並做依賴安全審查。資料接口需登入、history 並行2/export1、逾時限制；錯誤不洩漏路徑，archive 尚回503，health 不宣稱 production ready。以上限額是工程預設，非使用者固定規格；未向使用者索取密碼或部署，marketdepth command 仍 mock-only。
- 新增真 SQLite HTTP 整合測試（測試專用 verifier，另有 bcrypt tagged 測試）：登入後 history/latest/sync 回已落盤 missing row、保留 NULL 且 mock=false。新增 `cmd/futuresprobe` (linux/live_ws/sqlite_integration)，明示不存在的隔離目錄、1–10分鐘、有限時長、public feeds only，逐10s finalize，單 writer Journal 落盤及逐筆 JSONL；CI 只 build，不發真行情請求。未做實盤 probe、自動補漏 worker、合併 scheduler 或正式啟動。合約 probe 可能同樣遭 runner 地域限制，最終 Sydney 實測 gate 不豁免。
- 本地普通 Go test/race/vet 通過。CI 改 main 且增加 secure_auth tag 與 futuresprobe build；本輪外部依賴/真 SQLite Reader/API/WS build 待 CI 實證。Phase 2 hard-cap/封存 catalog/retention/執行器、Phase 3 scheduler/repair worker/正式 API 啟動、Phase4 Drive、C 交付皆未完成。沒有改舊 repo、Railway、AWS、Drive、歷史或正式服務。

## 2026-11-13｜Phase 4 前置：封存還原驗證 primitive
- Reader/Auth/probe commit `58b3d4773e465308ac4dd3933a940b812d5f80bf` / CI 43442280751 已啟動，依賴下載通過，完整結果尚待確認。
- 新增 RestoreVerifiedDay：僅接受可信 catalog 中 sealed live manifest（固定 contract/day/timezone/revision/producer/fileID/generation），呼叫者先預留壓縮+raw 空間，私有獨立 cache。壓縮下載長度/sha256 必須相同、拒絕額外 bytes；單 gzip member、有解壓長度硬限制，raw size/hash 必須相同；SQLite quick_check、日期、schema、seal、revision、所有筆數/NULL/status/grid 統計重新計算比對。不覆寫原日檔、不覆寫既存 cache，完整驗證後 fsync + atomic no-replace link；失敗清理本次 temp。只接受 live origin，不涵蓋 legacy。可信 manifest 的取得/遠端 fileId驗證、catalog 註冊、cache lease、實際全局容量 reservation 仍待實作，不能僅靠此 primitive 宣稱遠端備份已驗證或允許刪除。
- 新增真 SQLite 來回 restore/篡改壓縮/超量/錯誤 manifest/重複還原/64-bit ID 測試；本地普通 Go test/vet 通過，tagged CI 待確認。沒有對 Drive 讀寫或刪除任何歷史。

## 2026-11-13｜Phase 3 第三輪：自動補漏工作器初版
- Reader/Auth/probe commit `58b3d4773e465308ac4dd3933a940b812d5f80bf` / CI 43442280751 / job 131942665463 已確認 completed success（Go checks、secure_auth、live_ws、真 SQLite Reader/API、SQL contracts）。restore commit `69b77d95e440614612014c5e1f3b4b418fd8ffac` / CI 43442532269 尚在執行。
- 新增 futures.RepairWorker.Cycle：由 durable Reader 重新辨識最近10分鐘內的已存在 missing/partial futures rows，重啟不依賴記憶體工作佇列；等待 close 後30秒、前日僅在跨日4分鐘內、一次最多3個官方1m及1個10s、每個REST任務30s timeout、單工、每 key/revision 最多3次記憶體 retry（1/2/3分鐘退避，重啟重置）。全部是待實盤負荷確認的工程預設，未涵蓋10分鐘以上歷史或缺格本身，未持久化 retry 計數。只提交 exact key/revision+1/recovered，journal 再做完整修正證據與 CAS 驗證；REST failure 不改原列，writer failure 明確停止本輪。未接正式排程或真 REST；未允許修正 sealed/spot。
- 本地普通 Go test/race/vet 通過；新增 fake Reader/Writer/REST 測試 covered complete skip、尚未成熟 skip、恢復版本、限量及退避，整合排程與實盤仍待驗證。維持 main、原服務與所有舊資料不變；C 延後。

## 2026-11-13｜Phase 3 第四輪：回歸審查、因果與跨類匯出修正、隔離整合程序
- 回歸基準 main `3255c150ea200f9e43fa4e9448a069f38a9a5c36`；只剩 main。GitHub 已查證最近六次 CI 43442874006（repair worker）、43442532269（restore）、43442280751（reader/auth）、43441394931（futures/repair）、43438866737（manifest）、43438626031（seal）均 completed success。重新核對固定資料契約、collectors、journal/revision、Reader/Auth、seal/restore、容量與原 API。不是完整實盤/安全審計，不豁免 AWS 512MB、Binance、Drive gate。
- 發現並修正：官方 WS closed 1m 的 available_at 原為 admission 時間，實際等 scheduled finalize 才發列；改為 batch finalize 時間，quality_json 保存原 received_at，測試拒絕提前可用。行情欄位/SQL 不改；仍須量測 queue + journal commit 到 HTTP 可見的實際延遲，available_at 此版為資料建構完成時間，非精確 SQLite commit ack。
- 發現並修正：原 export 每種 kind 各自穩定，但讀下一種時上一種可能已修復。新增 Journal.RangeVersion 以 selected kinds/range/generation/max seq 作 optimistic barrier，開始與結束一致才出 complete manifest；不同時間範圍新增不影響，範圍內新增/修復拒完整，無長時間持鎖。將來 catalog prune/rebuild 必須變更 generation 或提供同等失效保證。新增 fake multi-kind export + 真 SQLite range version 測試。
- 發現並修正：原 history bounded 2、export 1，但 latest/sync/days 可無限制等 catalog lock；統一四路由共用 2 slots、超出429，health/meta獨立，export 仍1。新增並行 regression test。尚須長查詢/高頻收集並行的512MB實測。
- 新增 `internal/service` supervisor + GuardedWriter，`cmd/marketdepth-staging` tagged (linux/live_ws/sqlite_integration/secure_auth) 隔離整合候選：一個程序兩條 spot Binance feed、四所分鐘 sampler、六條 futures combined stream、10s/1m finalize、近期補漏、共用 journal/queue(8)、loopback authenticated API；錯誤停止兄弟工作、正常 shutdown、啟動先 Recover，未確定寫入不重新生成，記錄已提交目標格。獨立的新私有資料目錄+staging marker，拒絕 legacy/unmarked/symlink 路徑、只綁 loopback、獨立密碼雜湊與 session key 由環境安全注入，禁止無授權啟動、未提供正式 TLS reverse proxy。未替代 mock command 或啟用任何部署；CI 只 build/test，未實際執行網路服務。
- Staging 暫時保守容量門檻：每次交易前後 measure allocated + root free；32MB reserve、950MB high water 前保留 reserve（即 918MB 起拒新寫）、根磁碟至少1GB+reserve，事後檢查硬上限/根空間，出錯停止且不刪任何資料。此為臨時工程防護，尚非 OS quota 或正式 950/900MB reclaim/1GB hard-cap，未實作使用者批准的 verified/forced eviction、tombstone、remote catalog；並行讀者/WAL 變動仍可能 fail closed。過度延遲>120s停止而非無限 catch-up；重啟暖機時間可能有缺格，Reader 明確 gaps，近期修復目前僅處理已存在缺失/partial rows。這些暫定參數不得直接視為正式 Freeze。增補 gitignore 防止 catalog/db/封存/憑證意外納版。
- 本地 go test ./...、go test -race ./...、go vet ./...、Python schema/SQL/WAL tests 通過；新增完整 tagged staging build/目錄保護測試由 CI 驗證。C 尚未交付，AWS/舊 Railway/正式歷史/Drive 均未修改。下一步確認 CI、完成 Drive catalog/保留與容量執行器、真實隔離部署及 API 交接，不宣稱 Phase 2/3 已正式驗收。

## 2026-11-13｜Phase 4 第一輪：不可變封存發布與持久化目錄
- Phase 3 第四輪回歸／staging commit `50a22801760117c986a625d04ade81d23c949449`，GitHub CI run 43446984394 已確認 completed success（Go tests/race/vet、真 SQLite tagged、完整 live_ws/secure_auth/staging build、SQL contracts）。未啟動 staging 真網路服務或部署；Phase 2/3 真實覆蓋、512MB 與 HTTPS 驗收仍待。
- 新增 archive.RemoteObjects 介面及 PublishSealed：按固定台灣日/revision logical key 建立不可變 data/manifest，provider 必須支援 exact-key idempotent retry、拒絕衝突；不依 filename 唯一、不覆寫遠端、不刪檔。先讀回 data 精確 ID/key/size/SHA256，執行 SQLite verifier 並再次核對實際讀回 bytes；通過才建立 manifest，manifest 也按精確 ID 讀回且與 canonical JSON 完全一致。任何錯誤/取消/部分成功/重複衝突不得回傳有效 publication；可保留未引用遠端 data 供同 key 重試。只支援 sealed live，active/legacy 尚未做；provider 仍是 mock，未連 Google。
- 新增 journal_archive additive catalog table（原 daily DDL/row schema 不變），RegisterArchive 只收已驗證 Publication，保存 manifest/data fileID、manifest fileID/SHA、完整 manifest JSON、verified_at，拒絕同日同 revision 不同內容，已知相同版本冪等。ArchiveRecord exact/latest 讀取並核對 manifest digest；此紀錄僅表示當時遠端驗證，不等於現時可達/允許刪 local；尚未接讀取 API、remote rebuild、snapshot identity/row-by-row journal reconciliation 及 eviction safety gate。
- 新增 Linux 真 SQLite `Journal.PublishSealedSnapshot`：先檢查私有驗證目錄、snapshot 無 symlink、實際壓縮 size/hash；遠端讀回使用 RestoreVerifiedDay 重新驗 raw/schema/日期/筆數/缺格/NULL 等，僅清本次專屬驗證 temp；完成後才短鎖 catalog 登錄。網路不持 writer lock。容量需呼叫者 lease/reserve，尚未接全域 coordinator；無任何歷史刪除。未實作真正 Google Drive OAuth、ID-based transport、active hourly pointer/rotation、manifest 遠端重建、tombstone/強制清理或部署。
- 本地 go test ./...、go test -race ./...、go vet ./... 通過。mock 測試逾時後重試、manifest upload failure、corrupt data/manifest、verifier failure、未讀完、active拒絕；真 SQLite 封存→remote mock→restore→catalog→restart、來源保留測試已加入，待新版 CI。原 AWS/Railway、正式資料、Google Drive 未修改，C 未交付。

## 2026-11-13｜Phase 4 第二輪：Drive v3 傳輸與 OAuth 授權準備
- 上一輪 commit `1e1b59b9f06e37f7ee39280b17ab9fcf8ba69f17` 的真 SQLite CI run 43447701152 已確認 completed success（包括 archive_publish 整合及 catalog restart）。使用者已建立 Cloud 專案、啟用 Drive API、約69GB剩餘；本輪要求告知還需要什麼，選定 desktop OAuth 一次性本機授權（不是對外 Web callback），不需要網域或公開授權網站。使用者建立 External/測試名單（若個人 Gmail）、最小 drive.file scope、Desktop client、下載 JSON 並保留本機，長期正式前 In production + 實際政策驗證。不得把秘密交聊天、Repo、CI；服務端秘密檔 0600，Windows 本機另外使用 ACL。授權工具尚未真登入，先等安全部署通道。
- 新增 `internal/archive/drive`：標準庫 HTTP、固定 Google token endpoint、drive.file scope、短期 access token cache、invalid_grant 明確重新授權、拒絕擴權／意外 refresh rotation、不記 secret 或 HTTP response body。新增 `cmd/drive-authorize` 本機隨機 127.0.0.1 loopback、state、PKCE S256、offline consent、私有輸出不可覆寫；JSON 文件需私有保存。`.gitignore` 加入 Google 憑證與 reservation 文件、CI build helper；新 `docs/DRIVE_AUTH_SETUP.md` 說明流程。採輕量標準庫實作以避免 512MB 主機額外依賴，真 Google OAuth / Windows ACL / token 長期刷新仍須驗收。
- Drive v3 transport 實作 archive.RemoteObjects：以 appProperties md_ns/md_key/md_sha256 + exact parent、預生成 ID、持久化 private reservation（同 namespace 只允許一 writer，外層仍需全域協調）自動建 My Drive 子資料夾。使用預分配 ID 的 resumable session 單 PUT 串流，未確認上傳失敗回錯，下次同 ID 重新查詢及重傳（不是跨請求 byte-offset 續傳）；拒絕 duplicate/incomplete search/immutable conflict、外域 session、重新導向、非專案路徑。OpenObject 只按本地已知 reservation 與 exact metadata/parent chain 讀取，不自動建立或修改。採 staging root `MarketDepth-VNext-staging`、正式 `MarketDepth-VNext`，不接管使用者手動同名資料夾。root access/Google metadata 真行為待驗收；本地 state 遺失的遠端重建未完成，reservation 檔必須納入容量及備份。此 transport 不提供任何刪除或覆寫方法。
- 本地 Go tests/race (drive)、vet、普通全套 tests 通過；mock 覆蓋權杖快取及 invalid_grant、憑證 0600／禁止覆寫、上傳已提交後503重啟冪等、同鍵衝突、重複 key、外域 session 拒絕、精確 ID 下載／namespace、路徑防護。真 Google 無授權，無任何遠端資料或 AWS 修改；待 CI 驗證新版。正式每小時 active generation/rotation、遠端 catalog rebuild + history cache、容量 executor/tombstone、snapshot schedule、隔離 VM/Drive live QA 均尚未完成；C 仍未交付。下一步先補 active 與 catalog/容量安全後才允許實盤清理。

## 2026-11-13｜OAuth 品牌頁及公開說明站
- Drive v3 傳輸 commit cac77278186e8b5871df55f802acf87d162ee393 的 CI run 43453104659 已確認 success。使用者已完成 Google Auth 基本設定及 drive.file；正式發布被品牌頁設定阻擋。
- 已新增獨立靜態站 vnext/docs/oauth-site（首頁、隱私權政策、服務條款、CSS、安全 headers），只供 OAuth 公開說明；不發布個人電子郵件、秘密、行情、私人原始碼，不連 API。HTML 結構與內部導覽檢查通過。依 Google 官方 OAuth policy，正式首頁須公開、隱私政策與首頁同網域、授權網域須可驗證；Vercel 免費網域是否接受尚未確定。
- Vercel team 存取目前 HTTP 403；已要求使用者在一次性連結完成 team consent。尚未建立 Vercel 專案、未部署、無可填的正式 URL。授權後只部署本目錄，再匿名驗證並確認 Console；不購買網域、不改其他既有專案。

## 2026-11-13｜OAuth 說明網站正式部署
- 使用者完成 Vercel team consent；獨立專案 marketdepth-vnext-info（prj_ViaUZcsDMAuhZVzh5wztN6OT1ZCs）以 commit b8cd09cdd354252ee0c198d717d79c440e657bdd 的 5 個靜態檔案 inline 部署，不連 Git、API、憑證或行情。Deployment dpl_88mNuRTp73sVHczXsqXjGFceJnbV，production READY，Vercel domain verified。
- 正式網址 https://marketdepth-vnext-info.vercel.app/ 、/privacy.html、/terms.html 均以獨立公開抓取（maxAge 0，無帳號 profile）確認 HTTP 200 與預期頁面標題、內容；其他工具的 DNS/抓取限制不當作網站故障。未修改其他 Vercel 專案或部署保護設定；沒有購買網域。
- 請使用者填 Google branding 三個 URL 及 marketdepth-vnext-info.vercel.app 授權網域，再嘗試發布。Google Search Console 網域所有權及正式發布是否成功仍待使用者確認；Vercel verified 不等於 Google verified。Drive 真 OAuth/讀寫尚未執行；既有正式服務與歷史資料不動。

## 2026-11-13｜Google OAuth 正式發布與本機授權工具交付
- 使用者提供 Audience 截圖：發布狀態「實際運作中」、使用者類型「外部」，已解除 Testing 發布狀態阻塞；不等於品牌驗證或實際 OAuth/Drive 讀寫驗收。依先前使用者設定僅 drive.file。下一步以正式狀態重新取得 offline refresh token，不沿用測試狀態權杖。
- 從已提交原始碼（cac77278186e8b5871df55f802acf87d162ee393；main.go/oauth.go/objects.go Git blob 分別核對 368a961abeebb6461797f262829a47f2f0b4135a/e70b5ebcdd8f128dcaaaad8f1a03931633add229/de2afeba59cbf93695f6ea5b437ace0fee69e681）重新執行 Go Drive 測試通過，Go 1.23.2 交叉編譯 Windows amd64、CGO_ENABLED=0、-trimpath，交付 MarketDepth_VNext_Drive_Authorize_Windows.zip（exe SHA256 06d924550629047bd3c04bdbfc72a0bd6d118fa3fadeb0fe80904319aabedac5）。ZIP 完整性測試通過；未簽章、未在 Windows 執行實際授權。
- 使用者在本機執行並自行保存 marketdepth.oauth.json，僅回報成功或遮蔽秘密的錯誤。工具不建立 Drive 資料、不碰 AWS；後續以安全管道佈署至隔離主機，真實 Drive staging 讀寫、更新權杖、快照輪替、容量清理仍待驗收。不索取秘密檔，不改既有正式服務。

## 2026-11-14｜Phase 4 小時快照世代與可恢復輪替
- 使用者已在 Windows 成功執行 OAuth 並確認兩個 JSON 自行保存。真實 token/Drive API 讀寫仍未驗證，不索取或傳輸秘密。最新五輪 CI 43456943378/43456066267/43455351309/43453104659/43447701152 全 success。
- 實作 active/YYYY-MM-DD.h<UTC epoch ms hourly slot>.sqlite.gz + manifest，同一日獨立世代、雙讀回及實際 SQLite active restore，active 與 sealed 嚴格分離。catalog journal_active 保存目前與上一個待退役版本，拒絕日期/世代/筆數/coverage 倒退；上一代未退役前拒絕第三代。新增 journal_archive_pending 單筆持久 upload intent，遠端副作用前記錄完全相同本機 snapshot；失敗時禁止其他世代/日檔取代 pending；catalog commit 後才清除。真 SQLite 崩潰/重啟測試已新增，待 CI。
- 退役前再次完整讀回最新 active 或 sealed，驗證 SQLite、hash 與筆數。只允許經原始 reservation / 父資料夾 / namespace / 精確 ID/hash 驗證的 active 物件進 Drive 垃圾桶，manifest 先於資料，失敗保持 ledger 以便重試；禁止 historical/legacy 或其他檔案。Drive trash 尚會占用空間、未永久刪除；需真 staging 確認保留策略及容量。未啟用排程/實際刪除，未碰正式服務。
- 普通 Go test/race/vet、原 SQL/schema 測試全 pass；sandbox 缺 SQLite driver module、tagged integration 交 GitHub CI。真 OAuth/每小時排程/失敗退避、容量 gate、遠端讀取、catalog 重建及 1GB 強制回收仍未完成。下一步先完成共享容量預留、封存 worker 與真隔離環境驗收。

## 2026-11-14｜Phase 4 備份排程及共享容量預留
- 前一提交 36ae58458ab3f11f469de570bb260ee559b5bc16 的 CI 43460113551 已完成 success，包含小時快照、真 SQLite、輪替/中斷重試。
- 新增單一 ArchiveWorker：每小時整點後 1 分鐘起可生成 active 世代；每日過日界+5分鐘才封存；優先續傳持久 pending，再處理過期日檔及 active 退役。每次 cycle 只處理一個有界工作；獨立 0700 scratch 及 owner marker，僅清理受控快照/驗證暫存，不刪原日檔。重啟先續傳完全相同壓縮檔，不重新產生已發送世代。
- 新增 CapacityGate，行情 writer 與選用 archive 工作共用預留，單一選用工作、保守雙重計算預留與實際占用；保留 32MB writer headroom、根磁碟 1GB。此為應用程式預留/檢查，不是 OS quota，尚未啟用日檔回收或永久缺口 tombstone。
- staging binary 選用 --drive-credentials (0600、絕對路徑、不可位於市場資料根目錄) 及 --producer-commit (40 hex)；只許 MarketDepth-VNext-staging namespace；不提供 production 選項。Drive 失敗不直接終止行情，30秒至15分鐘指數退避+jitter，遵守合法 Retry-After；health 顯示 archive state/last_archive_verified_at，log 不輸出秘密。未提供憑證時仍不連 Drive。未部署、未執行真 Drive。
- 普通 Go test/race/vet、schema 及實際 SQL 測試全 pass；新增 tagged 真 SQLite 跨小時、重啟、午夜 grace、未知 scratch 檔案保護測試，等待 GitHub CI。待辦：遠端歷史讀取/cache、catalog 重建、1GB 強制回收和真隔離環境讀寫/資源驗收。無正式服務變更。

## 2026-11-14｜Phase 4 遠端封存讀取 cache 基礎
- 上輪 f873899ffee991f1f4801269a7141927dede09ec / CI 43460859096 已確認 completed success，包含排程與真 SQLite。
- 新增單日 ArchiveReadCache（linux/sqlite_integration）：只接受已登錄的 sealed manifest exact revision；首次讀取重新驗證遠端 manifest/data、解壓 SQLite/統計/hash；100MB 含壓縮/解壓暫存及 4MiB headroom，呼叫共享容量 reserve。單一 cache slot，命中重新核對 raw hash，損壞重抓，換日/版本清除舊 cache；immutable read-only SQLite，不寫 WAL/SHM。只清 owned history-cache scratch，未知內容拒絕；重啟丟棄舊 cache。網路不能持 journal/manager lock。cache 不授權刪除本地日檔。
- 新增真 SQLite 整合測試：封存 mock remote、精確 row hash、重複查詢、cache byte 篡改重抓、遠端損壞拒絕。此輪直接提交 GitHub，尚待 CI，未在本地執行 tagged 測試。尚未接 History/Sync/Days/RangeVersion，仍須以 journal pointer 比對、跨日分頁版本 barrier、cache lease 與容量清理 executor；不宣稱遠端 API 已完成。未連真 Drive 或更動 AWS/舊服務。

## 2026-11-14｜Phase 4 封存歷史頁查詢路徑
- 抽出原 History 的 locked pointer plan，原本機讀取路徑仍保留；新增 HistoryWithArchive 按日解析最多 2000 pointers，僅在本機日檔不存在時嘗試已登錄 sealed archive，已存在但損壞不掩蓋；逐列 key/revision/hash 核對，結尾重查相同篩選範圍 seq/generation，網路不持 journal/manager lock。尚未接正式 HTTP Reader、Sync/Days，禁止日檔 eviction。
- 單一 cache constructor 綁 manager 生命週期，拒絕第二個活躍 instance。整合測試額外模擬隔離日檔移走後從 sealed remote 查回，再復原原檔，禁止 reader 重建本機日檔。兩輪新程式尚待 GitHub CI，不宣稱已驗收。未操作 AWS 或真 Drive。

## 2026-11-14｜歷史快取 CI 編譯回歸修正
- CI 43469857422、43470016058 均 failure，直接原因 archive_read_cache_linux.go 未使用 path/filepath import；兩次皆在 tagged build 停止，不能視為快取/歷史功能驗收。移除未使用 import，重新跑完整 CI。未改資料契約或正式環境。

## 2026-11-14｜Phase 4 遠端 Reader 接入隔離 HTTP API
- 新增 ArchiveReader，staging 提供 drive credentials 時 History/Sync/Days/RangeVersion 使用該 wrapper；無憑證時仍原本機 Journal。Sync 抽出 locked plan，遠端解析不持 j.mu；保持 seq cursor 原語意，按日取資料後恢復原順序、核對每列 hash/revision，之後的新 seq 下輪可讀；Latest 保持本機，不以舊封存假裝即時。History/Sync 遠端故障 503 ARCHIVE_UNAVAILABLE。Days 顯示 sealed_remote + revision/hash/etag；封存含缺格時回粗粒度提示 archive_has_grid_gaps_query_history，精確缺格需 History 查詢。API row/schema 未變；day/{day} 原始 gzip 仍待實作。
- 增加隔離測試中移走日檔後的 History、Sync 續游標、Days、RangeVersion。此輪直接提交，等待 CI；前輪 import 修正 CI 尚在執行。未開啟日檔 eviction、未連真 Drive，未更動 AWS。後續仍需原始檔下載、強制回收/tombstone、catalog 縮減重建、實盤驗收。

## 2026-11-14｜Phase 4 指定封存 revision 的原始 gzip 下載
- 新增 SealedDownloader / ArchiveReader.OpenSealed，接 /api/v2/day/{day}?revision=，驗證日期與版本，使用與 gzip JSONL export 共用的單一重型 route slot。只讀已登錄 sealed archive（指定 revision 或最新），先核對遠端 manifest、壓縮 hash/size、還原 SQLite 全部驗證，再返回原始 gzip bytes。HTTP Content-Length、ETag、X-Archive-SHA256 供瀏覽器判定完整；不讓未驗證串流先發出。mock 501、不含 Drive 憑證或 fileId。
- 下載與歷史 cache 共用 single slot，下載 lease 持有容量預留直到 Body.Close；100MB 內保守預留兩份 compressed + raw + 4MiB，超出明確 503。關閉後清理 owned scratch，重複 Close 安全。新增真 SQLite mock remote 下載 hash 及 lease 保護測試。此輪直接提交，CI 待驗證。未啟用日檔回收、未連使用者真 Drive、未動 AWS。

## 2026-11-14｜Phase 4 已驗證日檔安全回收原語（未接排程）
- 修正快取 import 的 CI 43473251933 已 success；包含真 SQLite 模擬封存回讀、損壞拒絕。新增 API wrapper 與原始 gzip 下載 CI 仍在驗證。
- 新增 ArchiveReader.EvictVerifiedLocalDay，僅在 caller 明確呼叫時執行；目前任何正式/隔離主程序皆未呼叫。拒絕 active/grace、未登錄、pending intent、開啟 writer、非空 WAL。先用單一 cache slot 強制重新讀回 sealed archive（不信舊 cache），核對 manifest/hash/SQLite，再串流計算全部三種資料表、meta、events 的邏輯 digest；持有 journal/manager lock 比對 local digest、最新 catalog record、無 pending，再刪 checkpointed sidecar + 本地日檔並 fsync 目錄。遠端檔與 journal pointers 保留。真 SQLite 隔離測試涵蓋 active、無 archive、遠端損壞、local events 不同拒刪、成功回收後 History 可讀。尚待 CI，未執行任何真實刪除。容量緊迫時新讀回可能因 reserve 拒絕，需提前清理/保留 headroom；此原語不是 1GB 強制 executor 或未上傳 loss tombstone。

## 2026-11-14｜Phase 4 已驗證日檔自動回收接入隔離版
- 上輪 CI 43473668464（原始日檔下載）及 43473883969（完整邏輯核對後回收）均 success。新 ReclaimVerifiedCycle 在 archive worker idle 時每 cycle 至多回收一個最舊已封存日檔；必須完成 active generations 退役、無 pending、grace 結束，另保護各 kind 最新日，避免 Latest 依賴遠端。成功後即清自身 cache。仍只允許已驗證等價本機副本回收，無未上傳日檔刪除或正式 Drive 刪除。staging 無憑證時不啟用；尚未實際部署。
- MeasureAllocated 對掃描中受控 scratch 消失的 ENOENT 不再誤判磁碟故障；root 消失/其他錯誤仍拒絕。加隔離整合測試驗證最新日保護、下一日收集後回收、遠端 History 還原。新提交需 CI 驗證。接下來做 tombstone 與索引縮減；仍非完整 1GB 強制回收。

- 立即修正新回收 fixture 的 CapturedAt 為 nullable pointer，避免編譯錯誤。完整 CI 以修正後版本為準。

## 2026-11-14｜Phase 4 無備份完整日之永久缺口 ledger 與 crash recovery
- 新增 journal_loss（本機 catalog，不改日庫 MD-VNEXT-1 schema），先 FULL synchronous 持久化 prepared record：日、起訖、各表筆數、revision、logical SHA256、archive state、reason、recorded_at；僅無任何已登錄 sealed/active backup、無 pending、已封存且非 active/grace 的日可進入。另核對 local / catalog 最新指標筆數。未核對的 active snapshot 不可當作全日永久遺失，直接拒絕此路徑。
- 新增明確未排程 EvictUnbackedDay；prepared 後刪安全 checkpointed sidecars/日檔、fsync root，再 transaction 標 removed、刪該日 journal_change、更新 generation。journal_repair 保留。prepared 時停讀寫；重啟 RecoverLoss 若 DB 仍在且 digest 一致則取消未完成嘗試（不自動刪），若 DB 已無且無 sidecar 則完成 ledger/游標失效；其他狀態停住。History gap 標 permanent_loss，Days state 同名，Sync 舊游標 409，未假造資料。尚未接自動強制刪除；有 active backup 的部分恢復及 ledger 遠端同步仍待做。新測試用隔離 fixture 模擬 unlink 前/後 crash。CI 待驗證；未刪任何真資料，未操作 AWS 或真 Drive。

## 2026-11-14｜Phase 4 封存日精確位元索引基礎
- 新增 GridIndex：依固定 (t,venue,asset) 順序、5,940 bytes/日（47,520 bits）保存三表每一 grid key 是否存在；綁 day/revision/manifest SHA，驗證各表 row counts，NULL/status missing row 仍是存在；依 kind/asset/venue 過濾、keyset pagination、合併精確 grid gaps。理論 bitmap 大小約 2.17MB/年（不含 SQLite/JSON/manifest overhead），遠低於逐列 journal。此為基礎資料結構，尚未生成持久 compact record 或刪任何 journal pointer。
- 新增完整日/多種過濾/游標/重複/非法 key/缺格測試。另 j.ready 核對記憶體及 DB generation，防止 loss tx ambiguous commit 後以舊游標繼續服務。待 CI；下一步從 sealed remote 與 journal latest pointers 雙重核對建立索引，再接 archive history/sync 及安全 prune。未操作真資料。

## 2026-11-14｜Phase 4 compacted day 查詢相容層（尚未 prune）
- journal_compact 新表存固定日 bitmap，loader 與最新 sealed archive record 核對完整 manifest 身份及各表筆數。ArchiveReader.History mixed plan 將現有 per-row pointers 與 compacted exact keys 合併保序、維持原 query/seq/generation cursor；第一頁 gap 以 bitmap 替換已縮減日的 grid_missing，無需為整段缺格掃 31 個 Drive 日檔。遠端讀取僅選中日、整檔 hash/SQLite 驗證；不再依賴被 prune 的每列 pointer。原 Journal 未連遠端而命中 compact day 明確 503，舊 HistoryWithArchive 防止競態漏資料。Sync 初始 cursor 會提示 sealed_history_query_history 範圍，由 /days+/history 補歷史；增量游標仍原 seq，未變 row schema。此輪未產生任何 compact 記錄、未刪 journal row，下一步做完整逐列核對後原子 prune 及測試。新提交 CI 待驗證。

## 2026-11-14｜Phase 4 已封存日逐筆核對與原子索引縮減（未排程）
- CompactVerifiedDay 僅適用已安全回收本機副本、非最新 kind、無 pending/active/loss 的已封存日；fresh remote readback 後每 256 pointers 分批比對 SQLite key/revision/hash，bitmap 筆數須完全等於 manifest；網路與遠端讀取不持 journal lock。最後重核 day count/max seq、最新 manifest、狀態，於同一 transaction 插入 bitmap、移除該日逐列指標、旋轉 generation；保留 journal_repair audit。共用容量 reserve，無法預留拒絕，不做未經驗證 prune。
- 新 catalog 初始化 incremental auto-vacuum，VacuumCatalogCycle 單次 256 pages 並 checkpoint/TRUNCATE；舊 mode=none 只重用 freelist，不做未預留 full-copy VACUUM。測試延伸已驗證日回收 fixture：混合 compact/active history、limit=1 跨日、精確 gap、sync resync 與 bootstrap hint、local-only 明確錯誤、vacuum 後回讀。此輪尚未接 compaction scheduler，等待 CI；真實 Drive/AWS 無操作。

## 2026-11-14｜Phase 4 永久缺口小型 ledger 遠端同步
- 新增 journal_loss_sync 與 SyncLossCycle：只選已 removed 的最舊未同步 tombstone；以 catalog/loss/YYYY-MM-DD.json 固定 immutable key、canonical bytes、SHA256 上傳，完整遠端 readback 核對，再持久記錄 object identity；失敗重試同 key/bytes，不會重複新增、覆寫或同步 prepared。共享容量預留，網路不持 journal lock。測試以 mock remote 注入 upload failure、重試、exact bytes/hash、去重。尚未接自動排程；部分 active backup 的 recovery record 仍需另行擴充；尚未完成 disaster recovery discovery。CI 待驗證，沒有任何真 Drive 寫入。

## 2026-11-14｜Phase 4 部分 active 備份可恢復精確證據
- ActiveRecoveryIndex 在 active snapshot 的遠端 readback/SQLite restore 內每 256 key 分頁計算原始 journalHash；固定 presence bitmap + 每 key 32 bytes hash（最多 1,520,640 bytes hashes/active 日，JSON 約 2.04MB），綁 manifest SHA、coverage、筆數及 revision。未來容量強制 loss 可比較本機最新 hash，區分已備份與未備份/修正版本，不以最後時間戳推定完整。
- journal_active_recovery 在 active catalog commit 後、durable pending clear 前寫入；中斷需重播同一 verified generation 才能補 index，manifest mismatch/缺 index 時不得 partial loss；sealed retirement transaction 同時移除 recovery index。新增 active 測試核對 exact row hashes 及封存後清除。部分 active 日強制 loss executor/reader 仍未完成，待 CI。無真資料或部署變更。

## 2026-11-14｜Phase 4 已驗證日索引縮減接入隔離備份排程
- CI 43474902772（永久 loss）、43475182588（bitmap）、43475342863（mixed history）、43475531350（原子 prune/vacuum）及 43474678040（正常回收修正）已 success。最初回收 fixture nullable CapturedAt 編譯問題已修。已確認 compact 後跨日 page、sync cursor resync、完整 gap 與 remote 回讀通過。
- 在 archive worker idle 時依順序 ReclaimVerifiedCycle -> CompactVerifiedCycle -> VacuumCatalogCycle，每次最多一個有界工作，candidate 最多 64 已封存日，跳過有本地副本/active/loss/最新 kind；不在 collector writer 做網路。新增 scheduler 選擇測試。active evidence publish 額外預留 8MiB catalog/WAL headroom（非 OS quota）。loss ledger sync/active evidence CI 尚待，未啟用強制未上傳刪除，未部署。後續待完成 partial loss、容量壓力 executor、disaster discovery/rebuild。

## 2026-11-14｜Phase 4 部分遺失 ledger 與 active snapshot 回讀相容層（未啟用刪除）
- 新 PartialLossRecord 將實際本機 latest keys 分成 recoverable/lost 兩個互斥固定 bitmap；空缺原本無 row 不屬於任何 bitmap；綁 active manifest SHA、revision、coverage、counts、local digest。prepared 阻止讀寫，removed 才可顯示。Days partial_remote + 可用筆數，History 依篩選精確標 permanent_loss，既有 grid_missing 不混淆。Cache 增加 active restore/read，只有已登錄 removed partial ledger 且 key recoverable 才允許讀取，仍核對原 journal row hash/revision，不能用舊修復版本代替。原始 sealed gzip route 不會把 active 當完整日。
- 尚無 partial ledger 寫入/刪除 executor，尚未啟用任何未上傳日檔強制清理。下一步實作 pre-unlink intent、精確 hash partition、atomic finalize、restart 測試；CI 待驗證。真實 Drive/AWS 無變更。

## 2026-11-14｜Phase 4 部分 active 備份日的強制 loss 原語（未排程）
- EvictPartialDay 只處理已封存本機、非最新 kind、已過 grace、無該日 pending/正式 sealed remote 的舊日。完全離線，使用上一輪已驗證 active recovery hashes；串流逐筆比對 local latest journal hash，精確 partition recoverable/lost，先持久 prepared record + 原本全日筆數/digest，才 unlink+fsync，再 transaction 刪失去的 keys 所有 revision 指標、保留 exact recoverable、更新 generation；repair audit 保留。無網路/無遠端刪除，active raw snapshot 仍保留。相異修復版本不能退回舊 row。
- RecoverPartialLoss 啟動前 reconciliation，仍有相同 DB 則取消未完成 intent（不刪），已 unlink 則使用原精確 partition finalize；不明狀態停讀寫。測試建立真 SQLite hourly、後來新增 spot/修復 1m、跨日後模擬兩種 crash，驗證 spot 可恢復、晚到/修復最新版永久缺口、Days partial_remote、拒絕 sealed download。尚未自動強制容量清理、partial loss ledger 尚待遠端同步。CI 待驗證，無真實資料操作。

## 2026-11-14｜Phase 4 部分遺失日以精確 bitmap 原子縮減索引
- Partial loss finalize 改為同 transaction 保留 verified active manifest + recoverable/lost bitmaps、核對各 kind 最新指標筆數、刪全日 per-row pointers 及已完成用途的 dense active evidence、旋轉 generation；journal_repair 留存。混合歷史 planner 同時載入 compacted sealed 與 removed partial，後者只讀 active snapshot exact recoverable keys、hash/SQLite 整檔驗證；gaps 重新以 Lost bitmap 標 permanent_loss，preexisting missing 不混淆。Sync 初始提示 partial_history_query_history，local-only 遇 partial 明確 503。此決策避免長期 Drive outage 造成每個部分遺失日仍累積 8MB 索引。
- 延伸真 SQLite fixture 檢查舊 pointers/dense index 清除、active history/修復遺失、sync bootstrap。新程式 CI 待驗證，尚未接自動強制刪除。未實際刪除使用者資料或操作真 Drive/AWS。

## 2026-11-14｜Phase 4 壓力預留與最舊安全未上傳日選擇器（未自動排程）
- CapacityGate.Status/NeedsForce/ReserveEmergency：以 projected 950MB 含 writer 32MB + loss 32MB headroom 觸發（實際約 886MB）；emergency 仍需實際 1GB hard cap、root 1GB、雙重預留與單任務，絕非 OS quota。32MB mutation 預算需 full-day 量測。正常 Reserve 不放寬。
- ArchiveWorker.ForceLossCycle 一次最多處理最舊 eligible closed day，TryLock 保護正在備份的 worker，排除 pending target、active/grace、各 kind 最新日、已驗證 sealed local、缺 exact active evidence；可在另一日 pending 保持完全不變時回收其他舊日。先取得 emergency reserve，local seal/checkpoint，依有無 active 證據執行 partial 或全日 durable loss。無網路操作。完整 loss/recovery 允許不相干 pending，禁止同日 pending。
- 新測試三日 fixture：最舊 pending 保護、下一最舊未備份 loss、最新日保護、reserve refusal 無刪除、pending bytes 不變。尚未啟用自動 force cycle；需將 capacity loop、cache/scratch 優先、writer preflight wait 與 startup high-pressure recovery 整合，及真 full-day allocation 測量。CI 待驗證，無真資料刪除或部署。

### Phase 4 CI correction — active recovery helper
- Tagged SQLite CI 43476499577 / 43476633334 failed compilation: `activeRecoveryForLocked` used `e=` after refactoring to a separate function. Corrected to scoped `e:=`; rerun required. No real storage touched.

### Phase 4 — immutable partial-loss ledger publication
- Extended verified immutable loss-ledger cycle to select oldest finalized full or partial loss. Partial ledger records active manifest identity and exact bitmaps at `catalog/loss/YYYY-MM-DD.partial.json`; re-read exact bytes before marking synced. Added idempotence fixture; tagged CI pending. No real cloud writes.

### Phase 4 CI 修正：永久缺口同步與緊急回收
- CI 43477066912：partial recovery 已通過，緊急回收 fixture 在第三日 00:03，第二日仍處 5 分鐘 grace，故正確無候選。將測試時間推至 00:09，不修改正式 grace。
- CI 43477149628：SQL Go 字串多餘單引號跳脫造成 unknown escape；移除。待新 CI 全套驗證。

### Phase 4 容量壓力安全整合基礎
- 新增 NewWaitingGuardedWriter：僅重試 journal 尚未收到 batch 的 pre-admission capacity refusal，最多 60 秒、同一批資料；post-commit ambiguous error 永不重試。緊急 reserve 持有時 writer 暫停，避免兩者同時分配磁碟。測試包含 pre-admission 恢復後 post-commit 不重試及 emergency writer 排他。
- 新增非阻塞 ClearDisposableScratch，只清已辨識暫存、保護 durable pending snapshot 原始目錄；ClearHistoryCache 只清可重建 cache。尚未接 destructive 自動回收，CI 待驗證。

### Phase 4 容量監控與自動回收整合（隔離版）
- PressureStep/獨立 capacityLoop（2s，20s context）依序測量、清可重建 cache、清安全 scratch、嘗試 verified day、重測後才容許 force；未知錯誤 fail closed。正常 archive idle maintenance 改共用 worker mutex，順序回收/compact/同步 loss ledger/vacuum。pending 只保護該日，其他 verified day 可正常回收。
- staging 預設禁止未備份日強制刪除，必須明確 --allow-capacity-loss 且有隔離 Drive 配置；此為安全 QA gate，不是正式部署設定。writer pre-admission bounded wait 60s，emergency exclusive。health 新增容量狀態/實際 allocated bytes/free bytes。測試 safe-first、cache 足夠、verified 成功、loss 預設關、未知錯誤拒絕。未執行真實清理；startup 高壓恢復及 full-day 預算量測仍待。

- CI 43478796889 捕捉緊急預留 release 未清 emergency flag，已修；正常 release 與預留配對不變，待新 CI。
### Phase 4 高壓重啟準備
- 完整 CI 43478642196 success（partial loss/bitmap/ledger/force fixture）。新 StartupPressure 在 feeds/queue 啟動前處理容量壓力，最多 16 次且每次 20s context，必須可量測釋放空間，無進展即停，無 Drive 時仍拒絕高壓啟動。catalog open/reconciliation 之前保留兩個 32MB headroom；並非 OS quota。正常資料第一個 target 改在 startup 完成後才選。未開啟未備份強制回收。測試 no-progress fail closed、cache 清理後進入寫入預算；新 CI 待驗證。

### Phase 4 災難復原：Drive 唯讀 discovery
- 新 RecoveryReader 無需原本本機 reservation ID；Discover 完整分頁列舉同 namespace 的 sealed/active manifest、loss ledger（僅 metadata，非驗證通過），拒絕 duplicate/incomplete/repeated token。OpenObject 重新核對 exact ID、logical key、唯一物件、從 My Drive root 到專屬 namespace 的父層、size/hash/MIME；不建立任何 folder/ID reservation、不允許 upload。測試以全新空 stateDir 讀取 mock Drive、duplicate/moved object 拒絕及零副作用。尚未接重建 catalog、真 Drive 未測。

### Phase 4 災難復原：遠端清單內容驗證與復原計畫
- ReadRecoveryMetadata 驗 exact object ID/key/size/hash 及實際 bytes；ReadRecoveryManifest 驗 canonical JSON、contract、logical key、sealed/active identity。InspectRecovery 將日期分類為最高 sealed revision、完整/部分 loss、僅 active candidate；拒絕同日 sealed/loss 衝突或 active identity 不符。僅 metadata 檢查不宣稱 snapshot verified；孤立 active 不把未知尾端定為永久遺失。未寫入 catalog，未操作真 Drive。

### Phase 4 復原資料相容層
- 新 journal_recovered_active 將僅有 hourly snapshot 的災難復原日獨立標記 active_recovered_remote，僅可讀 verified exact keys，缺格仍 grid_missing（未知尾端，不宣告永久遺失），Days 顯示 snapshot_only_unknown_tail，Sync bootstrap 提示另查 history，不能當完整 sealed 日下載。阻擋同日新寫入與已 compact/loss 日重新寫入。
- InspectRecovery 保留所有 sealed revisions（最高 revision 用查詢），設定 metadata 總 32MiB / 10000 物件防止無界記憶體。journal_recovery_state building 啟動拒絕、ready() 拒絕 building instance；尚未接實際 rebuild writer，CI 待驗證。未操作真資料。

### Phase 4 實際重建新 catalog（尚未部署）
- RebuildVerifiedCatalog 僅新空 catalog/無 daily files；先 Inspect metadata，持久化 recovery_state=building，逐 sealed revision/partial active/snapshot-only 完整遠端 gzip+raw hash/SQLite 驗證，再逐筆建立 exact bitmap；每日期 transaction 寫 compact/loss/recovered_active，loss ledger 已同步 identity 保留。全部 quick_check 後標 complete。中途中斷 building 狀態禁止讀寫/重啟，不覆寫既有日檔；尚不做自動 resume。CanCollectDay 阻擋恢復同日的未經核准混合寫入。僅 snapshot-only day 不宣告永久遺失；舊 sealed revision 也保留 download catalog。待 CI 及隔離重建 integration fixture。原資料未修改。

### Phase 4 災難重建整合測試
- 真 SQLite source 建立 sealed + active，mock Drive 保存後用新空 root 重建、關閉重啟，檢查跨日分頁、Days、舊 revision、禁止同日重疊、Latest 不將歷史當即時；改壞 active gzip 後重建必須失敗且 building catalog 不可讀/重啟。partial loss fixture 延伸以遠端 ledger+active 重建，精確 gap 仍可讀。待 CI。Drive discovery / metadata CI 43479383472 / 43479530552 success；高壓 startup 43479228387 success。無真實資料操作。

### Phase 4 復原 CLI 與受控恢復讀取
- 新 --recover-catalog --init-staging，僅全新隔離 root；durable .recovery-build 直到重建、close、fsync 成功才移除。只 GET Drive staging，無 HTTP/collector/archive publishing；失敗阻擋正常啟動。--resume-recovered 必須 explicit、已完成 catalog、Drive credentials；同日已有 recovered/archived 禁止收集。新 Drive missing-reservation fallback 僅明確 recovered root 啟用，仍驗完整 namespace ancestry/key/size/hash，不建立 ID，不掩蓋壞 reservation。新增 RECOVERY_SETUP.md。未執行真實恢復或部署，CI 待驗證。

### Phase 4 完整日容量 QA fixture
- 新 capacity_qa tag / 獨立只讀 GitHub CI：每一組合成 47,520 keys，完整數值欄位、固定 seed 高熵、真 SQLite/journal。verified 組量測 gzip/raw/snapshot/compact/vacuum；partial_loss 組 12h active snapshot、後 12h 新資料、跨日強制回收後精確 23,760 recovered + 23,760 lost，5ms 取樣 allocated peak，驗證 emergency 32MB 額外預留與 1GB 上限（取樣值不是硬 quota）。不碰真 Drive/AWS；資料是 fixture，不代表真實市場壓縮率/512MB RAM。待 workflow 結果。

- CI 43480128448：完整 sealed/active 重建及回讀通過至 corruption failure 分支；building catalog 的 local History 先命中 compact 判斷回 503 archive unavailable，而非明確 ErrRecoveryIncomplete。調整所有 History readiness check 在 compact 判斷前；ArchiveRecord 同樣拒絕 building。非放寬測試，阻擋未完成 catalog 更早。重跑 CI。

### Phase 4 完整日容量 QA 實測結果（2026-11-14 UTC+8）
- GitHub Actions 43480478564 success，commit ce9a57a1315d0844dca96a01cdd52bf05bab7fa9；兩組各 47,520 keys，37.23s 測試（hosted Linux runner，非 Sydney VM）。
- verified：日檔 logical 10,297,344 B，封存 raw 9,465,856 B、gzip 4,503,132 B。備份 sampled peak allocated 41,271,296 B；compact sampled peak 26,435,584 B；catalog vacuum 前 26,951,680 B、後 17,313,792 B（含當日/cache 等）。
- partial_loss：日檔 logical 10,297,344 B，刪除前 allocated 24,530,944 B，sampled peak 24,563,712 B，after 21,540,864 B，額外 sampled peak 32,768 B；32MB emergency reserve 通過此 fixture，精確 recoverable 23,760 / lost 23,760。vacuum 前 26,292,224 B、後 14,639,104 B。
- 仍不可宣稱 1GB 為 OS 硬 quota 或 512MB VM 已過實測；合成欄位、5ms sampled peak、mock Drive，不含真網路、實際品質 JSON 分布、多日壓力/OS reserve/長匯出併發。真 Drive 與 Sydney 驗收前不開正式強制遺失。災難重建最新 CI 43480678745 待查。

### Phase 4 接續核對（2026-11-14 UTC+8）
- GitHub Actions 43480678745 已 success，backend job 132076037800；Go checks / SQL contracts 均通過。未完成 recovery catalog 的 History/ArchiveRecord 阻擋修正已取得回歸證據。
- 保留隔離 gate：mock Drive 與合成 full-day QA 不代表真實 OAuth/Drive 或 Sydney 512MB/1GB 驗收。正式 force-loss 維持關閉；不得操作舊正式服務或歷史資料。
- 下一個驗收依序：隔離真 Drive OAuth 上傳/下載/復原（不提交本機憑證）、Sydney 四所即時覆蓋及資源長測、歷史匯入與前端整合。任何未取得真實證據的項目不標完成。

### 2026-11-14｜接續規格與操作入口稽核
- 重新讀取 Phase 0 review、schema、go.mod、staging CLI 與 recovery guide。發現 vnext/README.md 仍描述 Phase 1/2 mock-only、driver 未通過，與現有隔離程式/CI 不一致；已以 7e67f55a46086257309f7d2521d96352b75dd358 修正入口、build tags、憑證限制及真實驗收門。未改程式或契約。
- 確認 VNext 為 Binance/Coinbase/Kraken/Bitfinex 60s 五個非重疊區，合約 10s/官方 1m；不得沿用舊研究線 ALL4 成員或 15s 決策配置。Phase 5 可先進行 fixture/import 工具；正式新歷史檔尚未取得，不使用舊研究資料冒充。C 由 Codex，Phase 8 正式切換另行批准。
- 本次未取得本機 OAuth JSON 或 VM shell；真 Drive、Sydney、正式容量及歷史匯入仍未驗收。未更動正式服務或開啟強制遺失。

## 2026-11-14｜Phase 5 歷史匯入第一輪：原檔唯讀盤點
- 新增 tools/legacy_inventory.py（6dca1d0）：Python 標準庫，串流 gzip JSONL，原壓縮/解壓 SHA256、大小、筆數、頂層欄位及型別次數；原檔不改。拒絕重複 JSON key、非有限數、非法 UTF-8/JSON、非 object、空檔、gzip 損毀、讀取期間檔案變動。工程預設每行 4MiB、總解壓 20GiB（可明確調整）、512 頂層欄位、64 層深度。僅 inventory_only、mapping_approved=false；不假設舊格式，不寫任何日庫或 Drive。
- 新增 tests/legacy_inventory_test.py（3e173a7）：合成 fixture，檢查雙 hash、NULL/0 型別、重跑一致、原檔不變、無效 JSON、截斷、限制與多 gzip member；已接 backend-ci（4997cf6），本輪尚未取得新 CI 結果，不宣稱測試已通過。
- 執行方式：在 vnext 下 python3 tools/legacy_inventory.py <immutable-export.jsonl.gz>。正式新歷史檔仍未取得；下一步 source-specific nested mapping、逐列 audit、隔離 SQLite staging、去重/衝突及原始列保留。禁止將 1m 合成 10s、未知 available_at 保留 NULL；不修改 live schema。未操作正式服務、OAuth、AWS、Drive、歷史資料。

## 2026-11-14｜Phase 5 第二輪：原始資料隔離 SQLite
- 前輪 inventory CI 43483503634 尚在 Go checks，不能標 success。新增 validated-record callback（24c1671），只供隔離 staging 使用；原 inventory CLI 行為不變。
- 新增 tools/legacy_raw_stage.py（6bc1edf）：要求明示 compressed SHA256、新建從未存在的目錄，SQLite DELETE journal/FULL synchronous、8MiB cache；raw_payload 以 SHA256 去重且比較原始 bytes，occurrence 保留每次出現行號。原始 JSONL 可按行號逐 byte 重建（包含換行與 NULL/0/大整數）。整個來源單交易；gzip/JSON/hash/計數/SQLite 驗證失敗 rollback，保留 building marker；完整 commit/close/fsync 後移除 marker。不得將 raw_stage 當成正式日庫或 mapping 已批准。現階段單來源、同目錄重跑拒絕，非多來源語意去重或可續傳；長交易/磁碟需求尚未量測，只能在隔離離線環境，不放 Sydney 1GB 行情 root。
- 新增 tests/legacy_raw_stage_test.py（357d0ae），驗證原始 bytes 重建、duplicate occurrence、原檔不變、錯誤 hash/JSON rollback、截斷 gzip、重跑不覆寫；backend CI 接入（254bb9a），run 43483856433 in_progress，未宣稱通過。
- 下一步：明確來源 adapter + normalized candidate ledger，時間格/來源/可用時間/NULL 檢查與衝突分類；正式來源新檔仍未取得，不猜 mapping、不造 10s、不改 live schema。無正式資料、AWS、Drive 或憑證操作。

## 2026-11-14｜Phase 5 第三輪：候選列契約與衝突 ledger
- 前輪 inventory CI 43483503634 / job 132085787834 和 raw staging CI 43483856433 / job 132087014630 已核對 completed success；Go checks / SQL contracts（含 Python fixtures）全數通過。原始行 byte 重建、重複 occurrence、錯誤 SHA/JSON rollback 及不可覆寫取得測試證據。
- 新增 internal/legacy/candidate.go（5be3711）：使用共享 model.Decode/Validate；要求完整明示欄位（NULL 不等於省略），拒絕重複、未知、大小寫別名、尾端 JSON、非法 grid/venue/asset/值域；來源 SHA、raw SHA、原行號、adapter ID 為必要 evidence。第一版僅 spot/1m，legacy_unknown、available_at=NULL、revision=1、source=legacy:<adapter>；不接受 F10、不冒充官方 closed 或 live。產生 canonical JSON、SHA256、UTC+8 日、key；同 key 完全相同 candidate 或 conflict，不選 winner。這是保守候選層工程決策，非正式 mapping。
- 新增 candidate tests（3aa7c6e），檢查 null/zero、64-bit ID、時間格、非法 source/asset/venue、未知/重複欄位、10s 拒絕等。
- 新增 tagged SQLite ledger（f56cdf9）、測試（33070fc）、SQLite URI 路徑安全修正（f8ae95e）：只能建立新隔離 root；逐 evidence/key 保存完整候選與 hash，完全相同 replay 不重複，矛盾 replay 拒絕，不同證據同 key 可保留多個版本並計數；無自動 winner、無 live/Drive writes。相異 adapter provenance 也可能分類為 conflict，保守留待審核。此層未直接驗證 raw stage 的原始 SHA/line 內容、未接 source adapter 或正式發布、未做長批壓力/重開續傳。最新 CI 43484245426 queued，尚未宣稱通過。
- 下一步：綁定已完整核對的 raw stage 與 evidence、實作可重建的 source adapter fixture、逐行 quarantine/audit、明確 canonical 選擇及隔離日庫生成。真新歷史檔尚未取得；不猜欄位，不改 MD-VNEXT-1，無正式服務、AWS、Drive、OAuth 或真歷史資料操作。

## 2026-11-14｜Phase 5 第四輪：原始證據串接及逐行稽核
- 前輪候選 ledger CI 43484245426 查詢狀態 completed/success；未有 success 不標通過。已核對 Python raw stage schema 和共享 Go model，未改 MD-VNEXT-1。
- 新增 raw_stage_sqlite.go（3a00679）：要求外部核准 compressed SHA、原始 gzip、已完成 raw stage、無 building/sidecar；以唯讀 SQLite transaction 固定 snapshot、逐行順序及 raw SHA/bytes 對比原始 gzip、雙 hash、筆數、解壓限制、quick_check、孤立 payload 檢查；Line 從已驗證 snapshot 產生 provenance，不信任使用者自行聲稱的 hash。原始檔需離線不可變；未做真歷史檔或大型來源壓測。
- 新增 fixture adapter（7e2398e）：僅明示 normalized kind/row envelope，從已驗原始 bytes 轉換，不接受 caller 自行捏造的候選。Python-to-Go 整合測試（6290475）涵蓋原始 bytes、重複 occurrence、錯 hash/marker/竄改拒絕；raw stage 增 occurrence SHA index（a188c4a）。fixture 格式不代表真來源 mapping 已批准。
- 新增 fixture_run/fixture_audit（231cf70）及整批逐行 mapping（4eef8f7）：每一行 accepted/quarantined、原始 hash、原因；存取/證據錯誤中止，保留 building 狀態；批次重跑拒絕。測試三行中兩筆合法、一筆不支援 F10（ade94de），另加完成前候選與 audit 精確筆數/證據核對（8b3b8a4）。不選 canonical winner、不寫日庫、不發布。CI 43484551711 已啟動，最後修正仍待新 CI；不能先宣稱測試通過。
- 下一步：確認上述 CI，實作 fixture 唯讀 canonical plan（衝突/隔離列顯式阻擋）、獨立日庫生成與 schema/內容核對；真歷史來源欄位及可用時間尚待新檔確認，不能把 fixture 當真來源。單一 source mapping run 不自動續傳，未量測大檔磁碟或 per-row transaction 吞吐。無正式服務、AWS、Drive、OAuth 或歷史資料寫入。

## 2026-11-14｜Phase 5 第五輪：候選計畫與隔離日庫生成
- 前輪原始證據及逐行稽核最後修正 CI 43484595982 / job 132089574304 completed success；主控 commit 971b833 的 CI 43484629550 亦 success。前輪 candidate ledger、Python-to-Go、逐行 quarantine/audit、精確候選與 audit counts 取得回歸證據。
- 新增 fixture_plan_sqlite.go（666f364）：單來源 completed fixture run、每一行 accepted、audit/candidate count 與 evidence 完全相符；以 readonly transaction 按 day/kind/key 排序，逐列重新讀已驗原始 stage、重跑 adapter、比對 provenance/typed key/canonical JSON/hash。相同 key 完全相同候選才去重；任一 conflict、quarantine、building、tamper 皆阻擋。無自動衝突 winner 或真來源 mapping 核准。
- 新增 store/legacy_fixture_sqlite.go（e03926c）：只新建 fixture-YYYY-MM-DD.sqlite，原 MD-VNEXT-1 schema、既有 rowValues/readRow、逐列 SQL roundtrip、NULL/0/64-bit ID、UTC+8、quick_check、筆數；僅 legacy:fixture-v1 / legacy_unknown / available_at=NULL，無 F10、無 sealed_at、無 producer_commit，明確 fixture_only=true。未改既有 live writer 或資料契約。
- 新增 GenerateFixtureDays（9275bf9）：先全來源 preflight，再第二次驗證串流按日寫入，單日 transaction，僅新目錄，失敗保留 .fixture-days-building；無自動重跑覆蓋。新增 fixture-manifest.json（75e044a），source SHA、總數/去重數、每個日檔名、bytes、SHA256；工程預設最多10000日，manifest/dir fsync 後才移除 marker。僅離線 fixture，不是真正式封存或 capacity gate。
- 跨日測試（f1c2620、ed3e8fa）：4 occurrences、3 unique keys、2日、NULL/0、大整數、不造10s、不封存、manifest 對實際 bytes、conflict/quarantine/tamper/incomplete preflight 阻擋與不可覆寫。最新 CI 43485154023 queued，尚未取得新測試通過證據。
- 下一步：核對 CI、獨立日庫/manifest 唯讀驗證器、真來源 adapter 檔案到手再確認，legacy/mixed archive provenance 與正式重疊治理；不得將 fixture 發布到 Drive 或當成正式歷史。未量測大型來源、未實作 resume、多來源選擇、正式 seal/catalog/Drive 整合；無真資料、AWS、OAuth 或正式環境操作。

## 2026-11-14｜Phase 5 第六輪：日庫獨立驗證及可執行 QA
- 核對前輪 fixture day/manifest CI 43485154023、最新主控 CI 43485199292 / job 132091673944 completed success，Go checks / SQL contracts 全部通過。前輪跨兩日、NULL/0、64-bit、去重、conflict/quarantine/tamper/building fail-closed 已取得回歸證據。
- 新增 store/legacy_fixture_reader_sqlite.go（5d1dee6）：唯讀 snapshot、完整 embedded DDL sqlite_master 比對、精確 metadata（fixture_only=true、不封存）、user_version、quick_check、拒絕 10s/events、逐筆 typed SQL 與重新導出 canonical JSON 比對；日列數上限 21,600（12 spot streams + 3 futures1m streams 每分鐘）。不改原 schema/live writer。
- 新增 fixture_verify_sqlite.go（f38bc0d）：canonical manifest、明確檔名/日期/順序、完整目錄清單、size/SHA256、重新從已驗原始證據走 plan，比對每個日檔全部 expected keys/數值/實際列數；每日日檔前後 hash、manifest 最後重讀。只在離線不可變檔案前提使用，不是對惡意同時修改的安全邊界。測試（cb7a965）含兩日、building marker、修改數值/額外列/schema/metadata/events 並重新計算 manifest hash，仍必須拒絕；另驗 hash、manifest、缺檔。
- 新增獨立唯讀 ledger 重開（2602b77）與測試（fe43745），新 cmd/legacy-fixture-qa（d78c7c5）可明確 build-fixture 或 verify-fixture，必須提供 source、source-sha256、raw-stage、ledger、days。預設解壓上限 1GiB，明確可調；不是真實匯入 CLI，不接 Drive 或 catalog。既有 raw stage 先由 python3 tools/legacy_raw_stage.py 產出。從 vnext 執行 go run -tags sqlite_integration ./cmd/legacy-fixture-qa --mode verify-fixture --source <synthetic.gz> --source-sha256 <sha256> --raw-stage <raw-dir> --ledger <ledger-dir> --days <day-dir>。build-fixture 需全新 ledger/day dirs。最新 CI 43561613035 queued，尚未驗證本輪新程式。
- 下一步：查新 CI、真實來源 adapter/欄位/單位與時間語意（需新歷史檔）、legacy/mixed archive manifest provenance、重疊 cutover 治理。fixture-only 日庫絕不可正式封存。仍未取得正式來源檔、未完成大型來源效能及容量測試、未操作真 Drive/AWS/憑證/正式服務；既有資料不變。

## 2026-11-14｜Phase 5 第七輪：正式資料隔離與歷史日期碰撞預檢
- 核對第六輪 fixture verify/readonly CLI CI 43561613035 與主控 CI 43561638107 均 completed success；重新雜湊的竄改檔、獨立唯讀重新開啟等測試取得證據。合成歷史全流程已通過，非正式來源 mapping 核准。
- 審查 archive/restore/snapshot/seal/manager/catalog：現有封存與復原契約只接受 data_origin=live；不得直接放寬。發現 Manager.Get/GetMany 只核對 date/contract/timezone，可能在檔案改名後讀到非 live 資料。新增 rejectFixtureMeta（43898c6），接入 OpenDaily、validateDayMetadata（5c5f178）、Manager.Get/GetMany（4683342）、checkSnapshot（e6d7a4b）；snapshot 另拒絕 source 非 vm_vnext、NULL available_at、legacy_unknown。修正 Go SQL 字串不合法的單引號跳脫（42b0260），完整回歸待 CI。不是防惡意操作者任意重寫整個 DB 的安全邊界；原契約、封存路徑不改。
- 新增 Journal.InspectLegacyPlacement（3c28286）：唯讀本機 catalog 與檔案碰撞檢查，最多366個日期/次，必須指定明確且非未來 cutover；只將完整早於 cutover 且超過 grace 的空日標 local_clear。任何同日檔/sidecar、sealed/active/compact/loss/partial_loss/loss_sync/recovered_active/active_recovery、change/repair 指標皆阻擋；不完整 catalog 或 pending upload 全批拒絕。排序輸出原因；不核准匯入、不分配 revision、不合併資料、不執行正式寫入。預設整日隔離是保守工程決策，混合日另需逐列稽核與批准。測試（5fe356d）含 fixture 改名/重標 live、碰撞、cutover、pending；尚待 CI。
- Drive 恢復 Discover 本來只列 JSON metadata，無法看見孤立 gzip；新增 RecoveryReader.DiscoverPlacementObjects（6925108）唯讀列出 app namespace 內歷史/active/永久遺失的資料和 metadata key，包含 orphan data；分頁、日期/路徑、metadata、重複 key/ID、未知 archive key fail closed。測試（336430e）包含 orphan gzip、錯誤年月、重複、零 upload/reservation。僅 app 授權範圍的觀測結果，不保證 Drive 全域不存在物件，也未取得遠端內容完整性/獨立 parent 核對證據；仍須停止 writer 後重查及未來發佈時的 exact-key guard。
- 最新 CI 43563155384 尚 queued；本輪程式尚未確認通過。先前 CI 不代表新 guard 已驗收。下一步確認新 CI，整合本機與遠端碰撞清單、設計 source provenance 與正式 legacy/mixed 封存審查；真實歷史來源檔仍未取得，不能把 fixture 當真來源。未執行真 Drive GET/upload、AWS、OAuth 或任何正式資料/服務修改。

## 2026-11-14｜Phase 5 第八輪：整合日期預檢及歷史來源證明
- 前輪 CI 43563186748、43563155384、43563091304 均 completed/success；中間版本 43563003925、43563041004、43563071583 失敗，SQL 字串跳脫修正 42b0260 後回歸通過。fixture 排除、本機碰撞、Drive orphan gzip 檢查均取得測試證據；未實際接觸 Drive。
- 新增 RecoveryReader.PlacementNamespace（44c2ca8）及 legacy.InspectPlacement（9a5f066）：只接受 MarketDepth-VNext-staging，最多366日；本機預檢→完整 scoped Drive listing→再次本機預檢，前後不一致、遠端錯誤、重複識別或錯誤命名拒絕整份報告。不在網路 I/O 期間持有 collector locks。輸出日期、本機原因、遠端 key/ID、開始/完成時間、cutover、觀測物件數；只有 blocked 或 candidate_for_review，publication_approved=false。報告是 advisory observation，不是原子快照、保留權或正式批准；同日碰撞不選 winner。
- 新增 detached LegacyDayProof（219be03，測試 b5f763f）：day/cutover、排序的原始壓縮與解壓 SHA256、mapping artifact SHA、audit SHA、adapter ID、各來源映射 occurrence 數、canonical rows SHA、placement report SHA；只支援整日 legacy spot/1m，未證實 available_at 一律 NULL，unique+duplicate 數量一致，quarantine/conflict 非0拒絕，排除 fixture-v1，不造10s。這是結構契約而非實際證明，並未驗證傳入 SHA 的來源真實性或實際生成 canonical row/audit digest。未修改 live Manifest，也未開啟 legacy/mixed publish/restore。
- 報告 canonical JSON/SHA 驗證、獨立 cutoff 檢查（f9f2d7d）、proof/report digest+day+cutover 綁定（3d8aaf5），測試（90ff94a、156f4ad、f3e0db7）涵蓋本地/遠端碰撞、狀態變動、遠端失敗、namespace、重複、錯日期、假批准、錯雜湊、blocked 日期。最新 CI 43569297525 queued；本輪尚未取得通過證據。
- 下一步：先確認本輪 CI，正式來源檔到手後驗證真欄位、單位、來源時間及映射，生成逐列 evidence/audit 和實際 proof hash；真來源缺失時不得將 synthetic adapter 視作正式。正式 legacy/mixed 日庫封存、catalog revision/復原須另行設計與驗收，舊資料和即時服務不改。Phase 5 仍有真資料門檻；Phase 2–4 真實環境、Phase 6 前端、Phase 7 Sydney 長測可獨立推進但需相應環境或成果。未操作任何真 Drive/AWS/OAuth/正式歷史/舊服務。

## 2026-11-14｜Phase 6 第一輪：後端接口交接與契約漂移修正
- 核對前輪 Phase 5 最終 CI 43569328030、43569297525、43569282709、43569267121 completed/success；中間 43569254461 failure，修正 fixture 的歷史日期與 cutover（156f4ad）後成功。整合 placement/proof 結構測試已通過；真歷史來源映射、實際 proof、legacy/mixed 封存仍未完成，不繼續以合成規格替代真來源。Phase 5 等待真檔；先並行 Phase 6 後端交接。
- 核對 API.Handler/Auth、Journal/ArchiveReader、SealedDownload、OpenAPI/fixtures/HANDOFF_A_INTERFACE；發現文件仍是 Phase1，cookie 名稱、auth 成功 envelope、latest 多 kind、Day state、封存 header、403/429 未跟上實際程式。更新 OpenAPI 0.2.0-phase6-backend（aeca945），原 MD-VNEXT-1 SQL/row 欄位、wire handler 不改；文件版次變更非新產品契約。登入/登出沒有 meta；__Host-md_session；latest 多 kind；day/etag/hash；export 完整尾列；lossless integer 警告。Mock 仍無登入且 loopback only。
- 新增 frontend_handoff_test.go（9e38c98）測試現有 HTTP handler 的 auth envelope、多 kind map、重複 kind 拒絕、64-bit integer JSON 保真、download transport header 與 503；download 使用合成 transport bytes（不是實際 gzip SQLite），真正 restore 由既有 store 測試覆蓋。schema_check.py 新增 OpenAPI SQL/fixture 欄位、session、auth、day/download 的漂移檢查（3e5fb60），不是完整 OpenAPI validator。
- 更新 HANDOFF_A_INTERFACE.md（81bcf62），含完整中文 C 接口、60s/10s/1m、UTC+8、五區/ALL4/NULL、BigInt 解析、同源 proxy、cookie、429/503/409、history/sync/cache 建議、export EOF/CRC/manifest、下載 SHA、桌機/手機與 proxy inventory 驗收。C 由 Codex 負責；尚未取得其 source/build/route inventory。bootstrap 與 cache 策略為工程建議，尚待 C 驗證；未聲稱前端已完成。最新 CI 43569641007 queued，尚待確認本輪測試。
- 下一步：查本輪 CI，對接 C 交接成果；並行準備 Phase 7 隔離驗收工具及部署操作手冊（不動 AWS/Drive/舊 production）。真 Drive 與舊服務停機、正式 cutover 仍需批准；真歷史 gzip 未取得。無正式部署、真 Drive 操作或資料修改。

## 2026-11-14｜Phase 7 第一輪：隔離驗收工具與操作手冊
- 前輪 Phase 6 CI 43569666372 / 43569641007 / 43569577272 均 completed/success；OpenAPI、row schema、session、multi-kind、64-bit integer、下載 transport header 測試通過。C 實際 source/build/route inventory 仍未取得，不宣稱前端整合完成。
- 新增 store.AuditSealedDay（0501cfb）與 cmd/day-audit（0154988）：外部已驗證 sealed raw SQLite 的 SHA256/producer commit 必要；非 symlink、無 sidecar、≤1GB、immutable 唯讀、schema 精確比對、quick_check、live metadata/封存、逐列 model+live write 驗證、available_at 不早於 t/close 且不晚於 seal、日期/key 精確檢查、前後 SHA 相同。全日 18 streams/47,520 keys，present/absent/status 獨立、缺格區間、P50/P95/max lag、observed/trusted 750、雙側五區可信覆蓋（2573309）、ALL4 至少兩家 paired complete750 分鐘。僅離線稽核，不查遠端、不證明來源/策略/整體 production ready。初版稀疏日測試（b97efb0）與 CLI build commit CI 43570046608 已 success；新全日 47,520 missing rows（50df6b1）測試證明 grid complete 不等於行情有效，尚待 CI。
- 新增 tools/resource_probe.py（864d4a0）：Linux 單次 PID/start tick、boot ID、單調時鐘、CPU ticks、RSS、staging root allocated blocks（hardlink 去重）、fs free；拒絕非 staging marker、symlink/special files、PID reuse。僅觀測，需實際操作者核對 PID/binary；不啟動背景程序。resource_summary.py（0344cd4）：P50/P95/max、CPU 單核百分比、disk、min free、24h+且跨兩次 UTC+8 日界、取樣 gap、boot/process 身分及時計變化、1GB limit；不宣稱 OOM 核對或 production ready。30s cadence/90s gap 工程預設；RSS 非 cgroup 全量、取樣峰值非 hard cap。resource_probe_test.py（62c13b8）及 CI build/test（a754e8f）尚待結果。
- 新增 PHASE_7_QA_RUNBOOK.md（dfc40c5）：部署前門檻、全日 key/coverage/availability、獨立 restore 後 audit、取樣操作、24–48h 長測與兩個日界、OOM/restart/TLS/真 Drive/舊版對照/rollback 等。最新 CI 43570263637 queued；本輪最後版本未驗收。下一步確認新 CI、補真實 run 的監控/驗收證據匯總與部署安全清單，再處理隔離環境執行通道。Sydney 512MiB 既有實例先前唯讀查證但未取得 SSH/SSM shell，不能假設可執行或長期雙跑。真歷史原檔、C 前端成果及真 Drive 仍為門檻。未部署、未進行真 Drive/AWS 操作或停舊服務，正式 cutover 另行批准。

## 2026-11-14｜Phase 7 第二輪：部署預檢與長測證據報告
- 前輪 CI 43570293854 / 43570263637 / 43570216910 / 43570192006 / 43570165427 均 completed success；完整 47,520 missing rows、五區可信覆蓋、day-audit build、resource probe/summary 與 UTC+8 兩次日界的合成測試通過。不是 Sydney 真實驗收。
- 新增 tools/staging_preflight.py（643884d）及 tests/staging_preflight_test.py（b2e9140）：Linux amd64，新 root 不存在且不與明示舊資料 root 重疊，非 symlink/安全 parent，binary ELF header/可執行/不公開可寫/SHA256，憑證 regular/owner/0600（不讀內容）、meminfo、TCP 18082 listener、fs free。初始 2GB 可用磁碟門檻（1GB 資料+1GB 根磁碟保留），非實際資源 reservation；exit2 觀測 blocker、exit1 無效。不能證明 runtime/CGO 相容、port 保留、實際程序身分或 RAM 安全雙跑；僅唯讀當下觀測，沒有設定任意記憶體合格門檻、不授權部署。測試合成 ELF header（不執行）與 temp root、憑證 mode、無寫入、parser。
- 新增 tools/phase7_evidence.py（72b01da）及 tests/phase7_evidence_test.py（ea3ea83）：從 exact 原始 resource JSONL bytes 重算摘要/證據 hash，明示 producer/first_target_ms，UTC+8 首個完整日到最後 resource sample 的完整日清單；核對 day audit identity、18 streams、47,520 key、status/缺格 interval/lag/五區 coverage 計數及 ALL4 上界，拒絕重複或窗口外完整日。取樣/容量/缺 audit/缺格/missing status 列 blocker；永遠 review_required、production_ready=false/deployment_approved=false/cutover_approved=false。人工核對來源、PID/binary/collector 運行、實際 manifest/raw、OOM/cgroup、交易所覆蓋、合約修復、容量、Drive、並行 export、TLS/V66、舊服務及歷史切換。摘要 hash 不證明內容真實，不能替代真實執行，partial day 另審查；資料最多 64MiB 原始 resource + 31 day reports，應在外部驗收機跑。測試合成完整 47,520 missing，不能假裝有效行情。
- CI 新增兩組 Python tests（1f2d4ed），runbook 新增命令與限制（f0efff9）；最新完整 CI 43570550726、43570516861 in_progress，尚未確認本輪新測試通過。下一步先查 CI，轉向實際隔離測試環境取得：Sydney SSH/SSM 或使用者批准的替代測試機、確認舊服務及記憶體 headroom、外部 build/二進位交付，然後才可實際執行 preflight/長測。現有 512MiB VM 的真實執行權限仍未具備；真歷史檔與 C 前端也未取得。未執行真 Drive/AWS 操作、未啟動 collector、未停舊服務、未切換。Phase 8 必須另批。

## 2026-11-14｜Phase 7 第三輪：實際 binary 建置與 Sydney 主機門檻
- 第二輪最終 CI 43570579010 completed/success；preflight/evidence 工具及完整後端回歸通過。
- 新增 GitHub Actions staging-package.yml（c8147d6448b55491d299403fbcdbcebdbe6f3b03），Ubuntu24.04 amd64 CGO Go1.23.2，先 go mod verify、全 tag tests/schema/Python QA，再建置 marketdepth-staging/day-audit 及工具、BUILD_INFO/PRODUCER_COMMIT/SHA256SUMS。實際 run 43572240812 completed/success，job132378912833 的 sha256sum -c 成功，artifact ID 14104971571，14,102,521 bytes，GitHub zip digest 21d8a86bb754359495eec23f2d3f55af3db86134f030753486a9823a8b55248b，期限 2026-11-28T07:42:50Z。下載 https://github.com/hugo90082/MarketDepth-VNext/actions/runs/43572240812/artifacts/14104971571 。artifact 不是部署；第一版 ZIP 解壓後需恢復可執行權限。修正 731e64a564cad4fdeb29b0a861b888ec80f3e064 將 package 以 tar.gz 保留 mode，外層 SHA、解壓後 checksum、test -x 和兩個 binary --help smoke；不啟動 collector。新 package run 43572413046 與 CI43572413068 仍 in_progress，不宣稱已產出第二版。未在 Sydney 編譯/執行。
- AWS 唯讀查證（2026-11-14）：marketdepth-sydney-nano running，nano_3_2、Ubuntu24.04、2CPU/0.5GiB/20GB、static IP；SSM DescribeInstanceInformation=0 nodes，只有 TCP22 開放。最近24h（2026-11-13 15:43 至 11-14 15:43 UTC+8）Lightsail 300s 指標288筆，CPU average of averages=0.521%、最大 10.8167%，burst 平均100%、最低99.9681%。不是實際 RAM/磁碟/舊服務檢查；不依此批准雙跑。不曾取得/輸出 SSH 私鑰、token 或 OAuth。AWS API 無 shell 通道，需使用者從已登入 Lightsail browser SSH 或本機受控 SSH/Codex 做最小主機內唯讀檢查：free -m; df -h /; ps -eo pid,comm,rss --sort=-rss | head -n 12; ss -ltn。以此判斷是否可安全準備隔離 staging，不需傳密碼或私鑰。既有 production 未變更；未啟動 collector/Drive、未開 port/購買資源或停止舊服務。真歷史檔、C 前端、真 Drive、長測與正式 cutover 仍 gated。

## 2026-11-14｜Phase 7 第四輪：Sydney 主機內部觀測與可用部署包
- 731e64a 完整 package CI 43572413046、backend CI43572413068 均 completed/success；artifact 14104782397（14,008,954 bytes，GitHub zip digest 540a1ab71c1031e7dd3d6e377d876da2fd5a4f2b73b52154f8d33d7aa389f0fe，期限 2026-11-28T07:45:20Z）含 tar.gz 與其 SHA256；tar extraction/checksum/executable/--help smoke 通過。下載 https://github.com/hugo90082/MarketDepth-VNext/actions/runs/43572413046/artifacts/14104782397 。尚未上傳或在 Sydney 執行。
- 使用者從 Sydney SSH 回傳真主機 free/df/ps/ss：Mem total412 MiB、used229、free39、available182、swap2047 MiB used127；/dev/root 19G、used6.2G、avail13G（34%）；舊 marketdepth PID5081 RSS19304 KiB（約18.9MiB）、dockerd/containerd/amazon-ssm-agent 在運行；127.0.0.1:8080 已 listen，18082 未 listen。主機內 agent process 不等於 SSM 註冊，先前 AWS API 0 nodes。這是單次 snapshot，RSS 與 swap 不足以證明長期安全雙跑。暫不升級；先準備 verified package transfer，確認舊 Docker mount path、實際服務狀況及執行權限。以短測為下一 gate，建議初始 5 分鐘、独立 loopback、no Drive、no forced loss、限記憶體 96MiB/CPU 50% 單核、超限即停止新 staging、不動舊服務；這是保守待批准/實測的工程建議，非正式長測配置。不得將短測通過視為 24–48h/Drive/正式切換驗收。尚無本助手主機 shell；使用者本機 SSH/SCP 或 Codex 操作，私鑰不進對話或 repo。

## 2026-11-14｜Phase 7 第五輪：使用者回傳 Sydney binary 傳輸及舊服務基線
- 依使用者回傳 Codex 截圖（2026-11-14 16:00:34 UTC+8 取樣），artifact 14104782397 已以 SCP 傳至 Sydney /home/ubuntu/marketdepth-vnext-staging-14104782397.* 的獨立0700目錄（bin/marketdepth-staging、bin/day-audit）；外 ZIP SHA256 540a1ab71c1031e7dd3d6e377d876da2fd5a4f2b73b52154f8d33d7aa389f0fe 與 GitHub 相符，inner tar SHA256 ec321d798e0bc5d905d32c5fcdbc99fa2efb53d673a2f37b728d5f6e64c1f728 與隨附清單相符；主機重新驗證內容、兩個 --help exit0。此為使用者提供的實際操作報告，非本助手持有 host shell 直接驗證。部署包準備 gate 通過，尚未啟動收集器。
- 舊 Docker marketdepth：/srv/marketdepth/data -> /data rw，running、RestartCount=0、OOMKilled=false；未設 Healthcheck，不能聲稱 health=healthy。CPU0.07%、memory22.54MiB/320MiB、PIDs9；NET I/O6.55GB/93.9MB、block I/O224MB/325MB。舊服務持續運行，無 firewall/Drive/新 collector 修改。使用者報告本機 SSH key 工作副本已移除，原 key ACL 偏寬，應在本機修正，不傳 key 到對話/repo。
- 下一 gate：由使用者已授權的本機 Codex 執行一次短時隔離 smoke，僅 loopback18082、新0700資料根、無 Drive、無 forced loss、5min transient systemd unit（MemoryMax96MiB、MemorySwapMax0、CPUQuota50%、GOMEMLIMIT64MiB/GOMAXPROCS1 作為待驗證工程預設）；先確認 cgroup v2、最新 MemAvailable>=150MiB、舊容器基線、正確 binary SHA、port 無衝突，未滿足則不啟動。監控 old restart/OOM/running、host available、staging RSS/CPU/oom、API rows/status；MemAvailable<80MiB 或舊服務異常即只停止新 unit；五分鐘後停止且保留 QA data/evidence。臨時密碼/hash/session key 在主機私密檔或記憶體，禁輸出；不更改 TLS/防火牆，不停舊服務，不用正式 OAuth。短測不等於 Phase7 24–48h 或真 Drive 驗收；長測依短測證據另定資源與批准。

## 2026-11-14｜Phase 7：SSM 遠端通道註冊與 IAM 權限門檻
- 使用者於 Sydney SSH 完成 Snap amazon-ssm-agent 3.3.4793.0 hybrid activation；註冊成功，service active。AWS DescribeInstanceInformation 實際確認 mi-0fc1854fc3deb5df3、Name=marketdepth-sydney-nano、Ubuntu24.04、PingStatus=Online、2026-11-14T08:41:42.576Z。初始化 seelog/fingerprint warnings 不影響成功。無需重註冊；不保存 activation code/ID。
- 唯讀 IAM 模擬（STS/GetRole/SimulatePrincipalPolicy）：目前連線角色 AccountFullAccessRole，無 permissions boundary；對目標 managed-instance 與 AWS-RunShellScript document 的 ssm:SendCommand 均 explicitDeny，OrganizationsDecisionDetail.AllowedByOrganizations=false。無 matched identity policy statements。是組織層授權門檻，不能靠加 Allow 或管理員角色覆蓋，不修改/繞過組織政策。需要 AWS 組織管理者確認可否授權該節點與必要 document 的受限指令操作；尚未送出任何 Run Command、未產生該指令費用、未啟動 staging 或變更舊服務。若無法獲准，沿用使用者已驗證的本機 Codex/SSH 流程進行短測。正式長測、Drive、切換仍未驗收。

## 2026-11-14｜Phase 7：維持 AWS 免費方案，恢復實盤短測
- Organizations DescribeOrganization 確認 ALL features、目前為 member account，ListParents/ListPoliciesForTarget AccessDenied；AWS Settings 使用者截圖顯示免費方案180日、到期2027-05-11、抵用金US$119.96、Big Ideas Live Here active。使用者決定維持免費方案，暫不啟用進階功能、不退出組織、不修改 SCP。SSM node 維持 Online；不藉其他雲端權限繞過 SendCommand explicitDeny，未送出 SSM 付費命令。
- 回到已驗證本機 Codex/SSH 執行通道，使用已部署 artifact14104782397，先前5min隔離短測規格不變。核對真程式 flags --data-dir/--init-staging/--listen/--origin/--producer-commit，MD_SESSION_KEY_B64 需標準 base64 且解碼>=32 bytes、MD_PASSWORD_BCRYPT cost10..14；origin 必須 exact HTTPS 無 path（短測可用 https://staging.invalid 僅 header，無 DNS/TLS 變更）。直接 loopback HTTP 測試客戶端在記憶體保存 cookie、明示 Origin，不把 Secure cookie 當 browser HTTPS 驗收；密碼/hash/key 不寫 stdout/repo、不得改 auth。startup first target 為 now+10s 截到分鐘再加1min，五分鐘內未必有5個完整現貨格；以 actual first target 到最後完整可驗收格計算分母，未到期/官方1m修復延遲另列。保留 CPU/RSS/cgroup peak、exit原因、舊容器前後狀態及所有stream結果。實際執行仍待本機 Codex 回報，非本對話已啟動。Phase8及真Drive仍需另行批准。

## 2026-11-14｜Phase 7：Sydney 第一次真實短測及 Binance JSON 修正
- 使用者回傳 Codex 實測報告截圖：artifact14104782397，17:06:54–17:11:54 UTC+8，first target 17:08:00；舊容器 running、RestartCount=0、/health 正常。新服務按5min上限停止、18082釋放、Drive未啟用。資料保留 /home/ubuntu/marketdepth-vnext-phase7-short.cTkTDJKr/data、同層 REPORT.md。此為使用者報告，未取得原始 log/SQLite 或本助手 SSH，不能當成獨立重驗。
- 已到期格：spot48/48（40正常、8missing）；F10 69/69（3 recovered REST、66missing）；F1 9/9（6 recovered REST、3missing）。Binance BTC/ETH各缺4，SOL REST4/4雙側trusted750；Coinbase12/12雙側trusted750；Kraken ETH/SOL8/8雙側trusted750，BTC4格只賣側達標；Bitfinex12格observed雙側750，但 trusted未達（現行 P1/P2 grouped adapter 按設計不提供 native trusted，不可提升為可信）。WS 共42 JSON decode error，合約可用行全靠 REST recovery。API login/health/latest/history/sync pass；401/403 pass；history/sync結束前66 F10，最後3格在停止前後取樣差。資源：CPU avg0.71% one core/peak40.57%、RSS peak33.27MiB、cgroup memory peak30.54MiB、host MemAvailable min129.34MiB、無cgroup OOM。資源結果只適用此次 WS 失效負載，修正後須重新量測，不能批准長測。
- 審查發現確定程式缺陷：Go encoding/json struct field matching fallback case-insensitive，原 spot/futures event tag e 沒有 E，K線 low l 沒有 L，真 Binance wire 含 e/E、l/L。原合成測試省略字段。未取得42條原始錯誤內容，故不宣稱已證實每條錯誤皆由此造成。新增 binancewire.Object（37ea72f）exact-key、required/non-null、duplicate/trailing reject；未知欄位忽略但不 alias。spot decoder（fae44c3、394d1db）、aggTrade WS/REST（e9f6a55）、Kline（2a541f2、0d2a30b）保持本地 admitted_at、sequence、完整性與原 closed rule，不使用 E 為本地時間。新測試（4e26292、058eb81、45c4245、4b519d7）含 E/e、L/l、M/m、64-bit IDs、null/缺key/duplicate/零量刪除、REST與合約 combined。中間 CI 43579816636、43579787561 failure，原 open kline test 允許沒有OHLC，初版過嚴；0d2a30b 修正為 open 可忽略、closed 數字缺失仍拒絕。最新完整 CI43579869888、package43579869911（78a02b0）queued，尚待驗證與下載 artifact。未修改 data schema、頻率、交易對、trusted規則、舊服務或 AWS/Drive。
- 下一步：確認 CI/package成功後，Codex以全新獨立目錄傳輸新包，重跑相同5min限制；至少 Binance BTC/ETH bridge/bootstrap 正常、三商品實時F10/F1有有效資料且不靠REST替代、原JSON錯誤消失；同時核對各side coverage、所有到期grid、資源/OOM/舊服務。若仍失敗，要求精確error文字與必要的去識別 public feed sample，勿把 observed 當 trusted。Kraken BTC買側與Bitfinex native trust 待另審；長測/真Drive仍 blocked，SSM組織拒絕不變。

## 2026-11-14｜Phase 7：第二次 Sydney 五分鐘實測通過 WS；可信深度刷新改進
- GitHub package43579869911/backend43579869888/log43579912705 completed/success，artifact14108440588（producer78a02b0c0f6bea376e352e8969c9619e747cf043，ZIP SHA256 5605f81c3bcd28295b0e88d949a0d0bc939d4539d48bfb59116f9ac3d548c292）。使用者 Codex 截圖確認外/內/主機 SHA256 通過，17:22:37–17:27:37 UTC+8，first target17:23:00，僅停新版，舊容器保持 running/restart0/health正常、18082已釋放，Drive off。報告及資料保存在 /home/ubuntu/marketdepth-vnext-phase7-short2-14108440588.vUYUbKy6/（使用者截圖，未取得原始 SQLite/報告做獨立重驗）。
- 真行情：spot60/60正常，Binance BTC/ETH各5/5完成本地 book，WS JSON errors42→0。F10三商品各27/27，共81/81；官方F1各4/4，共12/12，均WS直收、REST repair0。Observed雙側750：Binance15/15、Coinbase15/15、Kraken10/15、Bitfinex15/15；trusted雙側750：Binance5/15（SOL全數，BTC/ETH不足）、Coinbase15/15、Kraken10/15（BTC僅賣側）、Bitfinex0/15（P1/P2 grouped 設計）。全筆正常非同義全深度可信；不可把 observed 或 status=ok 當完整證明。API login/health/latest/history/sync pass。CPU avg1.15%單核、peak49.42%；RSS peak36.71MiB、cgroup peak31.34MiB、host available min130.54MiB、無OOM。初次完整 feed 短測資源良好；不等同長測。
- Binance REST5000 限制是快照最多每側5000價位；Diff只提供改變過的外圍價位，極值不證明所有中間價格。發現 BinanceBook.Install refresh 原先每次用新快照 edge 覆蓋舊證明，即使 live序列不間斷且保留舊外圍 levels。721e522 改成僅在 gap-free refresh（舊 cursor 到新 last 逐步連續，無遺漏）時取最外側已證明的絕對價格 edge；新快照覆蓋區域按快照重置，其他既有資料仍依序列更新。若 gap 或 regression，refresh失敗，fresh bootstrap 會清空舊 book/coverage；BBO落在已證明區域外不再輸出有效mid。未證明的外圍不升級、未改頻率/交易對/SQL欄位/既有 observed 數值方法。9eaf5ef 新測試：深快照→淺刷新仍保留可信edge、跳號拒絕、fresh reset、未知外圍BBO拒絕。e0cc11d/2df6707 在既有 quality_json 加 snapshot_last_update_id/snapshot_bid_edge/snapshot_ask_edge/certified_bid_edge/certified_ask_edge/continuous_refresh_count，方便觀察初始及累積證明。這是工程上的保守改進，不保證750能完整達標；未更動現有5區資料欄位及保留不確定的規則。Bitfinex/Kraken維持目前口徑，先取得逐分鐘證據再決定。
- 新 package commit74e3de1e398af23dc6bbbb7ac72f0e50c75c6fdb，package43581030140/backend43581030130 in_progress；未確認本輪新測試及打包完成。下一步用成功 artifact全新隔離root，在同樣96MiB/CPU50%/no swap/no Drive下執行30分鐘（至少一次15m refresh；建議另保留首次快照與刷新前後每分鐘4側 observed/trusted/5區/quality、逐商品WS bootstrap/refresh/disconnect/repair、RSS/cgroup/CPU/host available、old health/OOM/restarts）。沿用150MiB preflight、80MiB立即停止、runtime hard timeout；若資源觸限/舊服務異常只停新版。30分鐘為新增工程驗收窗口，不是24–48h長測批准，不必改主機規格或停止舊服務；SSM policy限制未改、仍由Codex SSH操作。真Drive/歷史/V66/Phase8未完成。

## 2026-11-14｜Phase 7：第三次 Sydney 30分鐘實測；凍結收集候選，轉向 Drive 與新舊對照
- GitHub package43581030140/backend43581030130/log43581079314 全 completed/success。artifact14107769635，producer74e3de1e398af23dc6bbbb7ac72f0e50c75c6fdb，ZIP SHA256 fd2229b7a343c07ea8af668d81c51f161de6720fe12c7053d31d416a0f43ce53。使用者 Codex 截圖回傳 ZIP/tar/主機檔案 checksum 通過；17:37:14–18:07:14 UTC+8，first target17:38:00，僅停新版，舊容器 running/restart0/health正常，Drive off，資料及報告 /home/ubuntu/marketdepth-vnext-phase7-live3-14107769635.FSG2GGjU/。目前只取得截圖，未直接讀原始 SQLite、CSV 或舊版對照。
- 到期 key 972/972：spot360/360正常、F10 525/525（523 WS直收；ETH/SOL各1 REST recovered）、F1 87/87 WS直收；JSON error0。17:52:16 BTC/ETH 15min refresh 完成，continuous_refresh_count 0→1；17:52→17:53 BTC bid/ask trusted218.02/184.17→221.80/202.44bps，ETH696.88/617.26→702.76/646.28bps，保留較深買側絕對價邊界且賣側向外延伸。bps隨mid移動，不能僅憑bps變化推定覆蓋證明。Observed雙側750 Binance90/90、Coinbase90/90、Kraken60/90、Bitfinex90/90；trusted雙側750 Binance30/90（全SOL）、Coinbase90/90、Kraken60/90、Bitfinex0/90。Binance BTC/ETH trusted750仍0/30各自；逐流 CSV 已保留，Kraken各商品細項尚未取得本輪原檔。
- CPU avg1.39%單核、peak45.84%，RSS peak43.17MiB、cgroup memory peak43.33MiB；五分鐘 RSS median19.04→22.07MiB、末10分鐘 cgroup median21–22MiB，host MemAvailable min126.10MiB，無OOM。30min正常負載下未見明顯持續失控，不能證明24–48h/Drive峰值。原96MiB/CPU50%/no swap安全設定保留，暫無升級必要。
- 判斷：暫凍結74e3de1候選 binary，先不再改 collector、收集頻率、五區或可信標準。官方 Binance Spot WS 文件明示初始5000外只有變動價位可知；觀測750不是全段可信750，延長時間/加速WS也無法保證補齊。原需求的 observed750 可保留作舊版相容及品質標記的研究資料，但不可無聲替代嚴格 trusted、不可將未證明部分補0；ALL4 可信版每區兩側至少2家同一集合，需以逐流CSV重算有效分鐘，不能只看聚合成功率。舊版同時間/同區/同單位與對齊規則的唯讀對照尚未做（Phase2 gate）。先讓本機Codex讀已保留的17:38–18:07資料及舊 /srv/marketdepth/data 或既有唯讀API，對齊、逐資產/交易所/區/側比較與缺值，保存原始報告。未要求新改程式或重跑30min。
- 下一個有意義的實驗：使用同一已驗證 artifact，真Google Drive staging namespace的2h受限試運行（至少2次hourly verified、token refresh、遠端readback/gzip/raw/row equality；停止新writer後 fresh root --recover-catalog 唯讀復原，snapshot-only不是sealed，禁止resume）。正式24–48h、跨兩日界及daily seal留下一階段；新舊長時間雙跑和真Drive依Phase0另需使用者明確批准。Drive測試會建立staging物件並依既有保留策略退役上一代已驗證hourly物件（僅staging，不碰既有Drive其他資料）；先唯讀確認namespace無其他writer/衝突，不覆蓋既有測試或正式資料；OAuth僅本機私密檔經SSH安全傳輸至主機0700目錄內0600文件、資料根外、不輸出秘密。預檢/安全停止條件維持，封存/復原可能使記憶體高於本輪，若觸限則只停止新staging、保留證據、不放寬上限。若使用者未批准，不啟用Drive或長期雙跑。SSM仍被組織拒絕，Codex執行，V66/真歷史/Phase8待驗收。

## Phase 7：使用者批准真 Drive 2h 隔離雙跑
- 使用者回覆「好 開始」，批准真 Google Drive staging namespace 備份及兩小時雙跑。未批准正式切換、停舊服務、付費升級、其他 Drive 資料操作或後續24–48h長測。
- 新增 vnext/docs/PHASE_7_DRIVE_2H_ACCEPTANCE.md（f751ed93e56afa58bc40186eeddd280df51af686），固定已驗證 artifact14107769635/producer74e3de1。預檢含外部OAuth私密憑證 SCP、drive.file scope、quota、完整 namespace listing（含孤立bulk及folder；未知碰撞即停）、單writer、舊服務、150MiB可用記憶體、端口、cgroup；保留原96MiB/CPU50%/no swap/80MiB停止條件；兩小時 hard timeout，避免跨日，工程預設可見 Drive 剩餘空間100MB。不得自行放寬、續跑或改 collector。
- 至少兩個不同 hourly_verified generation，逐次保留 manifest/sha/row counts/grid/status，不能從最終只剩一份倒推；只在本次空 staging namespace 內依既有策略退役上一代，不手工刪除；API/export、資源及行情完整性一併驗收。停止新版 writer 後 fresh root --recover-catalog GET-only，snapshot_only_days 預期1，並額外下載最新 active snapshot 驗 compressed/raw SHA/SQLite/schema/逐列revision及stopped source對照；量化未備份尾端，不把復原catalog當可寫日庫或完整封存日。OAuth初次授權與 in-process refresh 分開，若無安全可核對事件則續期仍待證實。原30min新舊數值對照另行唯讀執行。
- 已將執行單交給使用者本機Codex/SSH通道；本對話尚未實際啟動 collector、傳輸憑證、執行遠端 Drive 寫入或復原。SSM explicitDeny不變；等待實測證據，不宣稱已通過。無 schema/collector 變更。

## 2026-11-14｜第四次 Sydney 實測：Drive root 404，修正最小權限 transport
- 使用者 Codex 截圖：3m19s觸發 Drive 錯誤停止；OAuth grant、quota、staging listing成功，使用同一憑證 GET /drive/v3/files/root 重現404。遠端 inventory空、verified0、本機pending1，原資料 /home/ubuntu/marketdepth-vnext-phase7-drive2h.ZTb8mn9Y/ 保留，OAuth在root外0600。spot36/36、F10 39/39、F1 6/6，兩分鐘export gzip/manifest66筆通過；cgroup peak33.38MiB、host min150.70MiB、無OOM；舊服務 running/restart0/health正常。真Drive及2h/recovery未通過；只取得使用者報告而非原始檔。
- Google官方文件 https://developers.google.com/workspace/drive/api/guides/folder 與 /guides/api-specific-auth：drive.file 只涵蓋 app 所建立/授權文件，files.create 不指定 parents 可直接建立 My Drive 頂層文件。原 client 強制 GET root，寫入、readback、retire、fresh recovery皆受影響。新 root.go（0500977）以全域 appProperties exact namespace/root key、'root' in parents 兩份完整搜尋與直接 GET app-owned ID 驗證 root；無 root GET，省略 parents POST，持久預留ID避免重複（409/ambiguous retry）；root移動/重複/不一致拒絕。objects.go（7b867cb）及 recovery.go（db70aaa）共用機制，既有具體parent reservation只接受相符，保留 scope/不可變hash/資料層規則。mock 6c4c130 預設 GET root=404、POST無parents、lost-response retry、fresh readonly recovery、moved/duplicate root；初版中間CI failure（尚未改fake），最終待驗證。Google真 'root' in parents alias 查詢/建立行為仍未驗證，若不成功 fail closed，禁止放寬權限。
- 新 package producer cc01c82b17a4fcf58fb7e7ce01c20d4432f28969，run43586576156、backend43586576197 queued，新增 drive regression gate；更新 PHASE_7_DRIVE_2H_ACCEPTANCE.md（773b954）第7節優先於舊artifact。原授權範圍內重試，同樣96MiB/50% CPU/80MiB停止條件，fresh root，舊失敗pending及原資料完整保留，重新確認遠端namespace空、無其他writer。單一2h run 首份verified五分鐘 early gate，成功直接繼續同一run，失敗只停止新版；不重啟另開root造成衝突。需要兩代verified、停止後獨立恢復及逐列對照。未實際傳輸新版、啟動測試或執行Drive寫入；不變更OAuth scope、collector/schema、舊服務。SSM仍受組織限制，需既有Codex SSH通道。

## 2026-11-14｜第五次 Sydney 實測：root 404 已解決，gzip MIME 相容性修正
- 前版 root fix package43586576156/backend43586576197/log43586625122 completed/success；使用者 Codex 截圖確認 artifact14109993571 SHA驗證通過。第5次2m43s停止：真Drive成功建立兩個folder及上傳首份gzip，GET metadata/media均200，3950 bytes與預留SHA256相符；Drive 自動辨識 application/x-gzip vs reserved application/octet-stream，造成 identity conflict。遠端1 gzip/無manifest、catalog pending1/verified0；原程式僅log兩次 retry_pending，未保留原upload HTTP status。第五次根目錄 /home/ubuntu/marketdepth-vnext-phase7-drive2h-r5.ccKZfDDZ/；第四次資料仍保留，舊容器 running/restart0/health正常、OAuth scope不變。未完成2h或獨立復原，報告來自使用者截圖，未直接取得原始檔。
- 修正 objects.go（2e9e634）僅對 reservation MIME=application/octet-stream 且 key尾碼 .sqlite.gz 接受 remote application/gzip/application/x-gzip；reservation及upload wire不變，JSON/folder/其他類型不放寬，完整ID/name/parent/namespace/size/SHA與raw SQLite/manifest checks照舊。recovery.go（87187cd）placement同規則；普通 readback、fresh recovery、retirement 共用 check。測試39c784e 模擬實際 MIME inference、lost response、same reserved ID、no duplicate upload、readback/recovery/placement/retire，拒絕錯 MIME及hash；初版 CI43587743259、package43587798492 等失敗，原因測試變數body未宣告（兩處），5ae16e4已修正。2944a53/da7d93e/3b85621新增 safe diagnostics：allowlisted HTTP method/endpoint類別/status及identity欄位；任意錯誤訊息/URL/secret不輸出。新 package929a89b0e347b2ec25e1fbc6587be7b2f77361a3，run43587845678、backend43587845692 in_progress，尚未確認最終CI。
- 更新 PHASE_7_DRIVE_2H_ACCEPTANCE.md 第8節（3beb0aa），取代第7節 fresh writer root：有合法原pending及同key遠端gzip，不能新root/新generation覆寫或刪遠端。先停writer確認同一OAuth、完整inventory僅原2 folder/1 gzip、pending及reservation/key/ID/hash/raw一致，保存原 stopped root完整唯讀副本及sha（不含憑證），保留原絕對path；第四次資料不動。原 root非fresh，改等效唯讀 preflight（marker/permissions/port/cgroup/memory/disk/old service/namespace等）。原第5次root以新版binary、不帶--init-staging 正常啟動、既有pending優先完成，舊manifest producer/hash不改，新generation用新commit；正常清理scratch前已有備份。已知停機空窗另列。仍限原2h授權、96MiB/50%CPU/no swap/80MiB停止條件，不跨午夜；若pending非今日或inventory不一致先停止，需另行補傳方案。首pending verified 5min early gate，成功同run續測至少兩代（至少1新建），停後fresh recovery GET-only與最新snapshot逐列核對。未實際啟動、刪除/重傳Drive物件、擴權、停舊服務或切換。SSM explicitDeny未變，仍需既有Codex SSH執行。

## 2026-11-14｜第六次 Sydney 預檢：保留原 Drive 檔案與自動退役衝突
- 前版 MIME fix package43587845678/backend43587845692/log43587924343 均 completed/success；使用者 Codex 截圖確認 artifact14111211715 兩端 checksum 通過。原 pending remote GET200/ID/parent/3950bytes/SHA/逐byte與本機gzip相符、解壓SQLite完整性/筆數相符；catalog pending1/verified0。第四/第五次原目錄保留，第五次 stopped data/catalog/WAL/Drive reservation/pending/report 已完整備份，本機與Sydney副本 SHA一致；舊服務running/restart0/health正常。沒有啟動新版、沒有改遠端/OAuth。原因：前一輪我要求保留既有Drive檔案，但現行正常rotation會自動trash前代，Codex正確停止，不是新MIME驗證失敗。
- 新 archive_preserve_linux.go（a56cb7a）：同日 staging QA policy journal_meta archive_preserve_active_day 持久且新版不能默認取消；拒絕跨日重用、已有previous待普通退役時切換。PreservePreviousActive（f572659）逐次完整驗證current與previous，原子寫 archive_preserved/<day>/<generation> 完整PublishedRecord且清除previous slot，不呼叫Trash；原普通retire/封存後retire在保留policy下拒絕。worker（bce531b）預留兩代中最大單次還原預算、active_preserved狀態，拒絕其他日期/非active pending；main（d2e9fb8）--preserve-active-backups 持久配置、需Drive且不允許forced loss/recovered resume；mode conflict停止worker group。舊版不認識新policy，因此禁止降版執行此root；本模式為同日驗收、非正式保留政策，不可跨日長期使用。每日SQL schema、collector、OAuth與namespace不變。復原現有InspectRecovery以最新active candidate為準；各舊代已獨立驗證及保存，不改成可寫日庫。
- cd09593 integration test：真SQLite+mock Drive，既有pending lost manifest、重啟同ID、三代保持6遠端物件/零trash、拒絕普通退役/封存退役、舊代損毀不放行、保留ledger2筆、重啟flag不可取消、fresh recovery選最新及跨日停止。新package producer 1a6806977bfbea886ef04a9813ad4b89a12a0b7f，run43591026043/backend43591026032 queued，最終CI仍待確認；測試非實際Google Drive驗證。runbook第9節（6c7de9c）取代第8節衝突：沿用第五次原root及第六次備份，重新核對同一pending/遠端inventory及今日日期，必加--preserve-active-backups、不重新初始化，不降版。原pending verified 5min gate後同一次2h收集至少兩代新verified，所有原/新gzip及manifest均保留、active_preserved且零trash，停止後fresh GET-only recovery與最新snapshot逐列驗證。時間跨日或不足2h即停並另設安全補傳；不刪除資料、不擴權、不停舊服務/正式切換。未實際啟動新版或改遠端；仍由本機Codex/SSH執行。日常retirement與daily seal尚待獨立驗收。

## 2026-11-14｜第七次 Sydney：真 Drive 三代備份、原pending接續及獨立復原通過
- package43591026043/backend43591026032/log43591093480 completed/success；artifact14112481628、producer1a6806977bfbea886ef04a9813ad4b89a12a0b7f、ZIP SHA256 92596aec30cd28dd8bc3e1cb7e0a79abfe1aea9818db20b8d66c34b1fe218755（14,036,992 bytes）。使用者回傳Codex截圖：原pending約13秒verified，原gzip ID/SHA/producer不變；另外兩代新備份verified，三代gzip+manifest均保留、pending0。停止後fresh獨立唯讀復原，最新快照189筆資料及事件逐列一致，Drive inventory前後相同。舊容器running/restart0/health正常，OAuth未擴權、未切換。證據 /home/ubuntu/marketdepth-vnext-drive2h-r7.xfJ7Aocb/（以原報告實際路徑為準）。主控僅取得截圖而非原始報告，不能宣稱獨立重驗。
- 兩小時未完成：新版約5m52s後停止，原因外部Codex監控以root跑OAuth owner check、憑證ubuntu擁有，誤觸停止；以ubuntu重查成功。此為外部監控身分錯誤，不是後端備份/復原失敗。真Drive hourly、同ID重試、保留三代、最新active GET-only recovery功能通過本次實測；連續2h資源與同process OAuth續期仍待驗證，日常retire/跨日seal/正式長測未通過或未執行。
- 凍結同一artifact，不修改collector/backend、無須重編或重新授權。runbook第10節（103f1276）更新：原第五次writer root及第七次三代verified為合法基線（pending0，current/previous/preserved ledger逐一核對全inventory），原始證據保留。全部OAuth監控helper以ubuntu執行，root只監控systemd/cgroup/docker；啟動前以實際排程身分連續完成兩次唯讀inventory probe，不改owner/mode、不輸出秘密、不關閉安全停止。確認同preserve day及距午夜至少2h15min；使用同一binary與producer、--preserve-active-backups、原root不init、原限制96MiB/CPU50%/no swap/80MiB停止條件，重新執行完整7200秒，不累計短測。既有generation不要求5min內產新備份；按下一到期小時+1min開始5min驗證窗口，至少兩個本輪新verified（不足明示部分完成，不延長）。所有已存在及新代零trash/移動；停後fresh GET-only recovery及逐列對照，保留全報告。若時間不足/跨日，需另行規劃，不改日期或解除持久保留mode。未實際啟動第八次測試，仍需本機Codex/SSH執行；SSM限制不變。尚未批准24–48h或正式切換。

## 2026-11-14｜第八次 Sydney：真 Drive 7200秒連續整合驗收通過
- 使用者 Codex 截圖：同一writer 20:26:58–22:26:58 UTC+8，7200s到上限只停新版；artifact14112481628、原第五次writer root、--preserve-active-backups。兩次實際ubuntu UID1000 inventory probe通過；前兩次150MiB預檢擋下，SSH結束/記憶體回升後第三次啟動。21:01:44及22:01:41 新兩代hourly_verified（到期44s/41s），停後全五代gzip+manifest重下載驗證、原三代ID/SHA一致、pending0、零trash。fresh GET-only獨立復原最新catalog，3341筆行情與事件逐列一致，inventory前後相同；另840筆快照後寫入仍保留本機，不能假稱已遠端備份、遺失或自動合併。舊容器running/restart0/health正常。證據 /home/ubuntu/marketdepth-vnext-drive2h-r8.yOISBkvz/（以原報告為準）。僅使用者截圖，尚未獨立取得原始資料重驗。
- spot1428/1428、F10 2139/2139、F1 354/354，缺列0（不能由此推定所有列market status=ok或trusted750）。CPU avg1.87%單核，RSS peak53.54MiB、cgroup peak60.06MiB、host available min127.63MiB、無OOM。原96MiB/CPU50%/no swap門檻下真Drive兩小時驗收通過，暫無升級必要；跨日封存/整日匯出峰值未知。OAuth drive.file維持，同程序token續期未獨立驗證。Phase4 hourly真備份/復原及2h gate完成，正常rotation/daily seal及24–48h長測未完成。
- 為補齊OAuth續期證據，5aeb3b6 TokenEvent只包含成功grant序號及expires_in_seconds，fc3aea7 staging main輸出安全日誌；d5dc6a9測試cache hit不發事件、同程序過期再grant2、invalid_grant不發成功事件。未改refresh策略、schema、collector、scope或保留機制。新候選3905aaf527a643e860555902749a55598f26fc38，package43613086023/backend43613086045 in_progress；尚待CI。原第八次binary及五代/原writer root均保留。
- 新增 PHASE_7_CROSS_DAY_ACCEPTANCE.md（621423e）：48h連續兩次UTC+8日界、至少一完整日47520 keys及兩個local sealed days（首日可能partial），獨立日庫稽核、長匯出、OAuth grant2+、資源、真Drive正常rotation/seal、fresh recovery。原同日preserve root不能跨日/解除/降版；計畫新日期以同一staging namespace fresh GET-only recover catalog（原11/14 snapshot-only保留）後使用已有 --resume-recovered 非重疊日期續收，正常rotation只允許本run新備份在完整驗證替代後移至垃圾桶；原五代及840本機尾端不動。原150/80MiB與96MiB/CPU50%限制維持。48h與本run新備份退役須使用者明確批准；未授權不啟動、不寫Drive、不停舊服務。SSM限制不變，仍需Codex/SSH。真歷史、新舊五區數值對照、V66及Phase8仍待獨立驗收。

## 2026-11-15｜第九次長測時窗縮短為24h（使用者要求）
- 使用者要求把48h雙跑縮短至24h。更新 PHASE_7_CROSS_DAY_ACCEPTANCE.md（2f5eb20）為86400秒同一writer、至少一次UTC+8午夜、至少一個sealed verified local day（首日可能partial）、其餘資源/Drive/OAuth/匯出/復原/原五代保護全部不變。完整曆日47520 keys是規格基準，不強行作為兩個partial day各自分母；依first_target及截止時刻逐流精確計數。原Phase0 CR-09兩日界及完整日證據未滿足時仍保留blocker，不宣稱48h原標準通過，不自行延長；正式切換仍另審。
- 新候選3905aaf527a643e860555902749a55598f26fc38，package43613086023/backend43613086045 completed/success，artifact14120388865，ZIP SHA256 50ed3e20abe2a35875308bb865aee7e2d9c57fafd7da28a51af2b4c432941150（14,038,705 bytes）。已備妥，尚未實際部署。原同日preserve root及五代、840尾端保留；fresh recovery→非重疊日期resume，不改原資料。使用者本輪只要求調整時窗，尚待明確批准24h雙跑、真Drive寫入及只對本輪新備份的正常退役；不得自行啟動或刪除。SSM限制不變，仍由本機Codex/SSH操作。

## 2026-11-15｜第九次24h跨日實盤驗收已獲批准
- 使用者回覆「那開始」，承接上一輪明示的24h雙跑、真Drive與本次新增且經完整驗證替代的小時備份正常退役。更新 PHASE_7_CROSS_DAY_ACCEPTANCE.md（1161a110）為已批准，新增第6節操作交接。原五代及原writer root、840筆尾端、舊服務、OAuth scope不變，禁止永久刪除、清空垃圾桶、正式切換、升級或自動延長。固定已通過CI/package的artifact14120388865、producer3905aaf527a643e860555902749a55598f26fc38。
- 實際須由本機Codex/SSH執行：全新root GET-only recovery→確認非重疊日期→--resume-recovered，正常rotation只限新run，原五代ID/hash/trashed狀態為保護基線；沿用96MiB/CPU50%/no swap/150MiB預檢/80MiB停止。systemd硬上限86400秒、同一PID及獨立監控，禁止重啟累計。取得實際啟動證據後才算長測開始；到期停新版、獨立復原及稽核。原兩次日界及完整曆日gate未滿足仍列blocker。未實際啟動主機、傳輸新包或改Drive，SSM拒絕不變。

## 2026-11-15｜使用者回報第九次長測已開始；並行工作
- 使用者回報「開始跑了」，實際主機 start/first_target/PID/unit/root 及預檢證據尚未取得，不推算截止時間或宣稱24h通過。沿用已批准的監控及自動停止流程，不修改執行中binary、配置、資源門檻、Drive namespace或舊服務。
- 長測期間並行：D真歷史先取得原始gzip/JSONL樣本、唯讀inventory與來源/單位/時間/欄位證據，禁止正式匯入；Phase2使用第3次已停止的30min evidence及同時段舊版資料在外部機唯讀比較（不在512MiB主機額外跑大匯出/解壓/匯入）；C/V66依 HANDOFF_A_INTERFACE.md 及contract本機mock整合、提供source/build/proxy inventory/測試報告，不指向實盤長測服務或改動部署。若資料尚在主機，避免與長測競搶資源，待停止後再取。
- 第九次結果回傳後，檢查跨日seal、normal rotation、OAuth同process續期、資源與恢復，24h範圍以實際到期格為準；原兩日界/完整日blocker保留。歷史正式匯入、真前端HTTPS驗收及Phase8仍需獨立審核，正式切換需另批准。

## 2026-11-15｜Phase 5 正式歷史來源到齊，初審與映射乾跑通過
- 使用者新上傳 marketdepth-local-history-2026-11-14T16-59-33-347Z.jsonl.gz，唯一正式原始輸入；165937369 bytes，SHA256 88097e060d0c4cdd689971641e14b7a41c0857bcf2104b15ba119fe22d65e79b；raw415340421 bytes，SHA256 d1d4cf64e04eb19bc7412d70d0cbb5904c8adb8ad867fcb79ce9caf70dec243e。329184行、20578 blocks、68799 depth、239805 candles、manifest/summary各1，CRC/EOF/區塊/範圍/計數/時間格/數值核對通過。深度9/26 19:07–11/15 00:59缺2114分鐘，各商品1m 9/20 12:45–11/15 00:59各79935無缺格，57日、44完整深度曆日。重複、非法值0；深度224277 null、560實際0、15678全null列；quality null66194，V2 2605；candle source null65525，observedAt null70069/早於close33871。原值不修、不補格。
- 核對V66源碼1eba4b4ea8e07b1f6abd455f3d7d76a43c09030d與MD-VNEXT-1；新adapter4e8e5e78、test129645fa、CLI a6904313。本地go test通過，最終乾跑36.82s/peak RSS410468KiB；全量模型驗證與序列化hash，嚴格ValidateCandidate抽1064筆，825588 spot+239805 F1=1065393唯一候選、F10=0。57日計數與獨立原始Python audit相符、原始兩SHA一致；ordered candidate digest 1dd0b2deb74d425e8dd0c185580e4149bac0646fb35371d192b6bf3c62e54cdd。先前同步超時及summary.assets array/object解析問題已處理；本輪尚無實體日庫或正式source/placement proof，不能稱正式匯入通過。
- 候選全部status legacy_unknown、available_at NULL、source legacy:v66-browser-jsonl-v1；原a/observedAt/source/quality/flags/block保留quality_json，原capturedAt有值照存，不認證實盤因果；新observed/trusted coverage及BBO缺證據均NULL，舊ratio與VNext嚴格ALL4分離，10s不造。11/15末60格720 spot+180 F1須等長測first_target及cutover核對；禁止覆寫/混合未批准資料。詳見 PHASE_5_REAL_V66_MAPPING.md（3ab8bcfa）。完整報告與audit/dryrun JSON、程式ZIP交付使用者，原始gzip未修改。下一步離線候選SQLite、全量逐列回讀、idempotency、隔離API及placement。第9次24h長測不干擾、未Drive發布/正式匯入，CI待核實。

## 2026-11-15｜Phase 5 離線每日候選 SQLite 建置與全量回讀完成
- 仍使用唯一正式原始 gzip 88097e060d0c4cdd689971641e14b7a41c0857bcf2104b15ba119fe22d65e79b／raw d1d4cf64e04eb19bc7412d70d0cbb5904c8adb8ad867fcb79ce9caf70dec243e；Go 全量候選流 1be37e95、Python 離線日庫建置／回讀 2a47eaa6（本機檔案與GitHub blob b3424968386c177cba7e25dfdf3fc9d96004feba 完全相符）。1,065,393 筆全數嚴格 ValidateCandidate（舊欄名 strict_candidate_samples 實為全量）、57個日庫、825588 spot＋239805 F1，F10=events=0。新舊來源與quality、NULL/0、日期、鍵、原始值逐列比對；關庫後全量SQL回讀及獨立原gzip重放、57個SQLite integrity_check/schema/meta 均通過，ordered digest 與前輪一致 1dd0b2deb74d425e8dd0c185580e4149bac0646fb35371d192b6bf3c62e54cdd；daily content digest ba7ed2ecd10978e2a67d7786dc19d82ae483e4a948ae672cdc59f910012456a2；224277 depth NULL／560 zero／15678全NULL列不變。建置187.79s、整體3:08.75、peak RSS445400KiB（離線工作環境，非512MiB主機）；第二次獨立唯讀完整重驗52.31s、manifest與全部檔hash不變，重跑同一輸出目錄拒絕 FileExistsError，不覆寫。未宣稱可重建相同 SQLite binary bytes，只驗證已建庫唯讀重放與拒絕覆寫。
- 57個 candidate 日庫696700928 bytes；獨立來源證據帳本1450844160 bytes，SHA256 6657aaad3f1a55843e4f6d49aa1342ce854fc52acb464f38b74ae76ccc24fab1，manifest SHA256 d7ac243f9d692d7fcf827f018d5a95e8223261dd2d422aa712f71b0209ab3dbf。交付兩ZIP：MarketDepth_Phase5_57個候選日庫_2026-11-15.zip（89029054 bytes，76eff96d6a2d90b77a438ba24eeacb06f51342a9b272ceca021610ce005ea1dc），MarketDepth_Phase5_來源證據帳本_2026-11-15.zip（258005928 bytes，34bcbb6c8a6adbd42d09330f84170d29341d80fd6af902c6741ac6ad9a835f95）；兩包CRC及內部58個DB SHA256全部核對，含相同manifest。帳本保留原始行號、行SHA、候選JSON、候選SHA等證據；原始gzip仍需保留。
- 55日（9/20至11/13）807588 spot＋235305 F1＝1042893列可進入歷史日庫審核，不代表正式核准。11/14整日21600列、11/15截至00:59共900列＝22500列另外隔離，先等第九次長測first_target、既有五代、正式Drive inventory、cutover證據再定placement。全部57個檔案明示candidate_only=true、production_import_approved=false、sealed=false，無正式封存標記；禁止當正式日庫發布、禁止覆蓋/混合。下一階段離線隔離API／查詢驗收、正式來源及placement proof，待長測結果後處理重疊及Drive正式匯入；本輪未接觸執行中主機、未上傳Drive、未部署、未更改現行資料。前輪CI 43620610344及Go候選流CI 43621145948成功，Python建置commit CI 43621269427查詢時進行中；本機真資料驗收已完成。

## 2026-11-15｜Phase 5 真實候選日庫隔離 API 全量驗收通過
- 以57個離線候選日庫及獨立來源帳本執行 TestRealCandidateAPI，實際Go HTTP handler、TLS測試伺服器、bcrypt/session；57次逐日gzip HTTP匯出，1,065,393筆（spot825588、F1 239805、F10 0）逐筆JSON bytes與帳本完全相符，gzip EOF/CRC、唯一尾manifest、計數與各類缺格計算均通過。跨午夜BTC/Binance過濾分頁10筆逐列相符；不同查詢/非法cursor 409；未登入401、錯Origin403、Cookie Secure/HttpOnly、登入登出、meta/health/latest/days及錯誤參數400均通過；候選sync/正式封存下載503、不允許當live使用。候選模式明示candidate_only=true、production_ready=false，前後日庫hash不變。測試manifest SHA256 d7ac243f9d692d7fcf827f018d5a95e8223261dd2d422aa712f71b0209ab3dbf。
- 實測100.93秒，含編譯138.30秒，peak RSS389868KiB，初次依賴下載DNS受限失敗後用離線vendor成功重跑（go.mod/go.sum固定）。退出0。完整測試程式4檔與本機blob一致，保存在獨立分支 phase5-offline-api-qa commit abba40bce2203ac672cdd7bf7997d9aabd2836e6，未合併main；另交付 MarketDepth_Phase5_隔離API驗收_2026-11-15.zip，SHA256 cf2cf8c5cb7a5ee75b5fcf8b5b4e6d261cd329756835b4882bc8619d096bf59d（原始測試log、manifest、程式及重跑指令）。此測試不是正式公開TLS、前端瀏覽器或31日單次匯出驗收。
- Phase5原始稽核、映射、57日建置、全量回讀、隔離API均通過。下一步核對正式來源證明/placement；11/14與11/15重疊仍待第九次長測報告與實際first_target、正式Drive inventory及切換邊界，不得擅自覆寫。未接觸執行中主機、未發布Drive、未改目前部署；候選日庫不代表正式歷史封存完成。

## 2026-11-15｜使用者簡化 Phase 2/7 新舊數值對照驗收
- 2026-11-15 使用者決議：取消舊／新收集器同時窗深度金額逐筆偏差、相關性及聚合數值一致性比較作為 Phase 2/7 驗收門檻；不同捕獲時間及訂單簿覆蓋天然有差異。保留新版自身的18流到期主鍵完整性、逐交易所/商品/區間/側的實際非NULL覆蓋、status與失敗原因、交易對/現貨合約/單位/區間及時間對齊正確性、finite/nonnegative/NULL與0、observed與trusted區分、ALL4同側完整paired集合至少2家等既有資料品質規則。不得將present/missing占位列當有效行情或把observed750當trusted750；若有效覆蓋不足或出現異常，依證據個別處理，不設定任意新數值門檻。此決議只免除跨版本行情數值比較，不免除原始歷史映射逐列核對、備份復原逐列一致性、歷史與新資料時間重疊/缺口檢查、跨日資源/API/Drive/OAuth/前端/正式切換等既有門檻。現行24h測試不改binary、監控、資源及運行時間；待其真實結果完成最終Phase2/7資料品質驗收。
- 不再要求Codex提取舊版同時窗資料做額外數值對照。Phase5正式來源/placement與11/14、11/15交界仍待長測報告；Phase6 V66整合獨立進行。本輪只修文件，無部署、資料修改、Drive寫入或正式切換。

## 2026-11-15｜Phase 5 歷史候選 API 全量離線驗收完成
- 57個已驗候選日庫（manifest SHA d7ac243f9d692d7fcf827f018d5a95e8223261dd2d422aa712f71b0209ab3dbf）、原始來源帳本（SHA6657aaad3f1a55843e4f6d49aa1342ce854fc52acb464f38b74ae76ccc24fab1），真Go API與本機TLS/bcrypt TestRealCandidateAPI 實跑100.93s；57次逐日gzip匯出，825588 spot+239805 F1=1065393 rows逐列raw JSON與來源帳本byte-for-byte相符、F10=0，57份唯一尾manifest/EOF CRC/row_counts/gap accounting通過，無不一致；跨11/14→11/15午夜BTC Binance filter、10列limit3分頁/錯filter及錯cursor409；days57日、latest、未授權401、錯Origin403、login/logout Secure HttpOnly cookie、錯kind400通過；sync/day因候選無journal或正式封存回503為預期。結束重hash57日與manifest完全一致，未改原檔。含編譯2:18.30、峰值RSS389868KiB（不代表512MiB VM運行）；原store/httpapi suite離線通過，candidate metadata負面測試通過。CI不含歷史真資料、環境變數無值即skip。
- 初始本地Go modules下載失敗（DNS/網路限制），GitHub workflow a6adfe41/run43623874863成功go mod verify/vendor，artifact14125685651 SHA256 1475b1eaaded1818165152dd30dee5687e897ef043a5781e8e55dc72d09d8623；vendor tar hash adb24285f5ee2a880a73fa112519c2bb46778c95f337d06d8e8916f39e0d199b、module檔hash一致。本機Go1.23.2、GOPROXY=off；未將歷史市場資料或秘密上傳CI。四檔byte-exact commit b1206382eca5d0d045bb3d24d86b629729cbafd3；guard負面測試 ec05c32ea3a0b58fc9371bf7b9d1f476b1cac108。CandidateReader唯讀且只接受固定manifest/hash/metadata/grid/schema；API明示offline-candidate-qa及candidate_only=true/production_ready=false，正式OpenAPI不新增候選狀態；拒絕當作live或匿名mock。正式storage guard拒絕fixture_only/candidate_only，即使誤將origin relabel live亦拒絕。離線exclusive目錄假設，不是live writer並行讀取保證。
- 詳見 PHASE_5_CANDIDATE_API_QA.md（0545d318），包括重現命令。實際測試日志及程式已在本機留存，ZIP生成並驗證成功但下載檔持久上傳失敗，不能宣稱使用者已收到。程式已進GitHub；CI43624708262/43624758217查詢時進行中。下一步正式legacy封存/manifest/catalog恢復/讀取支援與source proof；原55日1042893列僅候選，11/14–11/15共22500列隔離，仍需真實first_target/長測結果、local/Drive placement及cutover證據。禁止把候選DB改檔名或移除旗標當作正式日庫。本輪完全離線，未改運行中VM、Drive、舊服務及原五代，未正式匯入或切換。

## 2026-11-15｜Phase 5 來源證明草案及封存準備
- 原始gzip/raw、audit、adapter、全量候選stream、schema、57日manifest、來源帳本及57 SQLite hash重新核對；每日ledger主鍵/row digest、SQL計數、legacy_unknown/NULL availability、無F10/events、SQLite quick_check、gzip trial解壓SHA通過。15.17s、peak RSS102812KiB。55日1042893列，gzip候選80,025,306 bytes；11/14、11/15共22500列另隔離，gzip候選1,763,696 bytes；57日原始696700928 bytes、gzip合計81789002 bytes。最大單日19,148,800 raw/1,957,125 gzip（11/03）。候選壓縮試算不是正式sealed bytes或Drive quota。
- Source review draft SHA e1a8d8feda9acc7fbecc4676a792f27929f96fd13069c1203995c57b6835c418；cutover_ms/placement_report_sha256均NULL、publication_approved=false、sealed=false。BindV66Proofs使用真57日草案與明確synthetic placement，55日符合既有LegacyDayProof、2日保持hold，錯hash/碰撞拒絕。新增CLI僅離線綁定，真實報告及cutover尚未取得，不能稱已核准正式匯入。五檔byte-exact commit0646adb4a7fd9c5ffa21bf8d902346737a5b0adb；首次GitHub提交遇GraphQL錯誤且main已新增API紀錄，核對新head僅docs差異後以CAS非強制提交成功。文件PHASE_5_SOURCE_REVIEW.md（840b99a0）。真實來源及發布防護測試本機通過，CI觀測 [{"id":43625642141,"sha":"840b99a032b86e110a2d197dfe5326ae06344f0a","status":"in_progress","conclusion":null},{"id":43625558446,"sha":"0646adb4a7fd9c5ffa21bf8d902346737a5b0adb","status":"in_progress","conclusion":null}]。
- 實際11/13 candidate被checkSnapshot拒絕；archive.PublishSealed/Active拒絕legacy manifest，mock PUT/GET均0。既有live-only防護正確；下一步新增獨立正式legacy sealed build/publish/verify/recovery/catalog/API能力，proof持久化與live相容，禁止relabel live或移除候選旗標繞過。先offline mock驗證，正式Drive上傳須真實placement、cutover、獨立批准，11/14–11/15混合日另審。完整ZIP MarketDepth_Phase5_來源證明與封存準備_2026-11-15.zip，27036 bytes，SHA256 1c57f8e917138a06623512fb3051407f4242fcfa6db93db15d712937924a5667，12檔CRC與SHA通過。未修改運行中VM、舊服務、Drive及任何原始日庫；未正式匯入或切換。

## 2026-11-15｜Phase 5 legacy封存格式全量離線驗收
- 隔離分支 phase5-legacy-sealed-qa，commit9ace419471819590f03efae4398599bc3f24ac4f（基底main b0e15f135f4eb7e983fa1a5825a0bfe3ff48ea8e），13個程式檔Git blob與本機測試一致；文件PHASE_5_LEGACY_SEALED_QA.md（da6ab874）。未合併main或部署。上一階段CI43625558446/43625642141/43625674720成功；新分支尚未遠端CI，本機Go1.23.2/vendor的sqlite及完整live_ws,sqlite_integration,secure_auth回歸測試全通過。
- 實際57日來源草案SHA e1a8d8feda9acc7fbecc4676a792f27929f96fd13069c1203995c57b6835c418，合成placement/cutover 11/14 00:00 UTC+8，55個可審日期9/20–11/13逐日新SQLite/原候選SHA/row digest/來源proof/解壓還原/schema及資料核對全通過，807588 spot＋235305 F1＝1042893列，F10/events0；raw681594880、gzip80021678 bytes；合成驗收非真上傳容量。五批14.714/16.220/15.709/16.239/5.323秒，11/14–15共22500列保持hold。11/13單日21600列以mock remote完成manifest失敗重試、同ID、GET-only fresh catalog、歷史查詢與sealed下載，10.604s。初次私有scratch權限拒絕，修正測試0700後通過，未放寬防護。
- 新legacy proof/hash manifest欄位僅legacy使用，保留live相容；限單一V66來源完整曆日封存revision1，禁止active、mixed、同日多revision/active/loss共存。PrepareReviewedV66Day綁定draft/placement/proof digest並拒絕hold，BuildReviewedLegacySnapshot新建日庫不改候選，legacy_unknown/NULL available_at/無新coverage；PublishPreparedLegacySnapshot先完整本地readback、固定bytes才immutable兩物件發布；錯proof/篡改gzip/重複build拒絕、live-only發布與普通catalog註冊防護不變，legacy經verified fresh rebuild供歷史讀取。
- 下一步正式匯入協調器（真實placement、cutover、停止writer、排他租約、quota及批准、持久ledger及中斷重試；先mock全批）與復原後實際HTTP全量/跨日/前端驗收。55日尚未真Drive發布；11/14、11/15混合日依長測證據另審，原五代與840尾端保護不變。未操作正式Drive、VM、執行中第九次測試、舊服務或正式切換。

## 2026-11-15｜Phase 5 批量歷史匯入協調器全量離線驗收通過
- 獨立分支 phase5-legacy-import-qa，功能commit85bd5ee626860ba2b94e3fcc5364760afb6c9700（基底9ace4194），3個新檔byte-exact：v66_import_linux.go 181047f64022ee0935626540d3cbdfc34657571c、v66_import_real_test.go e15084766e04a676236b97f02d3c42551cf1d358、legacy-v66-plan/main.go 5bcf55c9dc5eb1da5ede09354e6c702a7cbb2ddb。離線prepare/inspect CLI不含發布命令；RunV66Import須獨立批准的plan SHA和實際外部排他ImportGate（尚未實作真Drive adapter）。每次PUT前fresh inventory/停止writer/lease/quota/local clearance，保護所有既存物件hash/ID，固定prepared bytes，fsync不可覆寫progress、同ID續傳、完成日重跑GET-only。55日staging budget250MB、單日reserve100MB，拒絕未知/同日衝突、orphan manifest、過期觀測、corrupt plan/壓縮檔/progress、本機併發等；本機flock不是遠端排他證據。
- 真資料55日1042893列（807588 spot＋235305 F1，F10/events0）、合成placement/cutover/producer/lease及mock remote。初版258.07s通過；最終版263.04s（wall264.01s、RSS196668KiB），55 gzip80021606 bytes，plan SHA75918607114f70736d751d9763f6beb2e53001d4f11a94e5d9eab09fb746d788，publication_approved=false。prepare148.27s、模擬發布75.93s、全量唯讀重跑37.72s，110新物件、111 PUT呼叫含一次同ID data retry、290GET、238 gate checks；data commit/manifest commit後逾時兩情境同ID續傳（mock_14/15），完整重跑0 PUT，55日110個unique IDs，11個模擬既存物件hash/ID不變，兩held日22500列不動。CLI inspect真跑通過，錯SHA拒絕；55gzip獨立hash/筆數及55 progress紀錄核對通過。首次CGO編譯超時後用離線vendor與CGO_CFLAGS=-O1 -g0重試，非部署設定變更。無真Drive操作。
- CI workflow f12fa90b/run43660685496三組go test通過、go vet指出上一階段移動SourceProof型別後測試unkeyed literal，修正具名欄位164c41934a04bc04cf0a505c90dae8378961892d（僅測試寫法）；本機targeted test/vet通過，遠端重跑觀測 [{"id":43660904031,"sha":"164c41934a04bc04cf0a505c90dae8378961892d","status":"completed","conclusion":"success"},{"id":43660685496,"sha":"f12fa90b6173f519cdd57bb1816e1f11df11f273","status":"completed","conclusion":"failure"}]。未合併main或部署。文件PHASE_5_IMPORT_COORDINATOR_QA.md（f5862cd7）；交付ZIP MarketDepth_Phase5_批量匯入控制程式驗收_2026-11-15.zip，44706 bytes SHA256 b8fd5ac1e788b8e6e249695ed9641dd927fb508e33b1ca08daf0826d3b63ad88，13檔CRC及SHA確認。ZIP合成QA plan/IDs不可當正式匯入證據。
- 下一步：全55日模擬已發布catalog fresh recovery及實際HTTP全量驗收；實作真實Drive ImportGate/排他租約/持久reservation與唯讀inventory入口（須先完成長測及writer停止證據）。真實placement、cutover、11/14–15重疊與原五代/840尾端保護待實際長測結果，正式匯入與Phase8另批准。未觸碰運行中長測、舊服務、主機及Drive。

## 2026-11-15｜Phase 5 歷史封存復原後 API 全量驗收通過
- 隔離分支 phase5-legacy-import-qa commit12134d4c4d7e34fc4669361f1e816099a03e99c5，新增測試 legacy_recovered_real_test.go blob a18ec33ff717dfe76ca8861e57d7e3cdc424b4ca；CI43663117715成功（私人資料 opt-in 由離線本機實跑）。報告 PHASE_5_RECOVERED_API_QA.md commit a1714b40。沿用前輪固定合成plan SHA75918607114f70736d751d9763f6beb2e53001d4f11a94e5d9eab09fb746d788、55 gzip及55 progress，重建110個唯讀mock物件，驗證ID/size/SHA/manifest；不把合成placement/ID視為真Drive證據。新空目錄RebuildVerifiedCatalog 55 sealed days、55 revisions、0 loss/snapshot-only，135.352s/165 GET；關閉重開、RecoveryCompleted及55日禁止收集通過。
- 實際ArchiveReader＋Go HTTP TLS/bcrypt/session；未登入401、錯Origin403、錯參數400、錯cursor/filter409、跨午夜BTC Binance 10列limit3、days SHA/ETag、latest/sync無假即時行情、登出通過。55次逐日gzip JSONL匯出全部1042893筆（807588 spot、235305 F1、F10=0）與來源帳本canonical JSON bytes逐筆完全一致，尾manifest、CRC/EOF、計數及缺格正確。09/20、11/03、11/13三個sealed下載SHA/Content-Length/ETag相符；11/14–15共22500候選列隔離。remote 285 GET、0 PUT、110物件不變；history cache清除成功。test300.593s、wall301.61s、peak RSS134360KiB、exit0。本輪ZIP MarketDepth_Phase5_封存復原與API全量驗收_2026-11-15.zip，10646 bytes，SHA256 b277c5e5abc2670263a5e81b1d0f8f4a896e5e6ddd6ad2560975d90eaa8e9db0，5檔CRC及SHA核對通過。
- 本輪不是31日單次匯出、55次下載、混合live/legacy復原、正式公開TLS或真Drive驗收。只新增測試，未合併主分支功能、部署或操作長測主機及Drive。下一步實作真Drive唯讀inventory及排他ImportGate/持久reservation，先離線測試；真實placement/cutover、11/14–15接合、既存基線、writer停止/排他及正式批准仍是必要門檻。
