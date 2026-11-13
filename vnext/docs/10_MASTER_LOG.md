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
