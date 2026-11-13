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
