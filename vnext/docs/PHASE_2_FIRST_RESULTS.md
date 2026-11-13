# Phase 2 第一輪｜SQLite 寫入基礎與現貨深度核心

日期：2026-11-13（UTC+8）。狀態：部分完成，**非正式可部署**。

## 隔離決策

- 建議使用者在 `hugo90082` 建立私有新 Repo `MarketDepth-VNext`，初始化 README，不連接既有部署。後端 module 暫依新 repo 路徑 `github.com/hugo90082/MarketDepth-VNext/vnext`；新 repo 尚未確認建立及授權，沒有遠端寫入。
- Drive 已由使用者建立 Cloud 專案並啟用 Drive API，自述剩餘約 69GB。OAuth 尚未完成。預設應用自行建立可見的 `MarketDepth-VNext` 專屬根資料夾、保存 folderId；子目錄 historical/active/legacy/catalog/config/staging。已有資料夾需要經 app 授權（如 Picker），不能只憑 folderId 假設可寫。測試區與正式隔離。這是工程安排，未執行任何 Drive 操作。

## 實作

- `contract/schema.go` embed 原始 SQL；DDL 未更改。`internal/store/daily.go` 透過 `database/sql` 注入 SQLite 驅動。每日初始化、日期與契約檢查、WAL + FULL、busy timeout、quick_check、表欄位檢查、單連線及 mutex、交易批次寫入、精確 64-bit ID、NULL/0、同內容 retry no-op、衝突拒絕、跨日拒絕及日內讀取。只允許 `vm_vnext` 初始 revision=1，避免在 durable journal 與修正治理尚未完成前覆寫歷史。
- `internal/collector/spot/depth.go`：舊版五個半開區間、獨立側覆蓋、邊界容差、price×qty、重複價格/無效簿拒絕、Kraken exact-first 缺側補值、Bitfinex P1/P2 固定分區、不把零當缺值。`sample.go`：只允許 Binance SOL/Coinbase 原生 REST 快照轉 row；T±1500ms 之外明確 missing，保留 capture 及實際 available_at。Binance BTC/ETH 不可走此 helper。
- 指定舊 commit `4d030e3c4dda2c85e5404e96e10b7fd6abed7c9c` 的 `spot_rest.go` 核對：Bitfinex tBTCUSD/tETHUSD/tSOLUSD、P1/P2 len=250；Coinbase BTC-USD 等；Kraken XBTUSD/ETHUSD/SOLUSD；沿用現行四家。此處未完成完整舊程式回歸。
- `github.com/mattn/go-sqlite3 v1.14.32` 為待整合驗證的鎖版候選。依賴無法下載（本執行環境 DNS / proxy.golang.org 被拒），尚無 go.sum。`daily_integration_test.go` 使用 build tag `sqlite_integration`，需在可下載依賴環境執行：`go mod download github.com/mattn/go-sqlite3 && go test -tags sqlite_integration ./internal/store`。不能宣稱此測試已通過。

## 實測結果

- Go build、go test、go test -race、go vet：通過（無 sqlite_integration tag）。
- Spot 5 個測試：半開區間、750 邊界、獨立覆蓋、零值、非法簿、Kraken/Bitfinex merge、時間窗、mapping、REST row missing/partial、BTC/ETH 防誤用。
- `tests/schema_check.py`：原 SQL SHA256、欄位、版本及基礎約束通過。
- `tests/daily_sql_check.py`：Go 生成的實際參數化 INSERT 三表在 Python 系統 SQLite 執行；NULL/0、64-bit ID 不丟精度、交易 rollback、子程序提交後無 clean close 的 WAL 恢復與 reopen/quick_check 通過。此為 SQL/SQLite 層測試，不是 Go 驅動、掉電或 AWS 壓測。

## 尚未完成／阻塞

- 真 Go 驅動整合、go.sum、CI、daily manager/單一全域 writer、前一日 grace、獨立讀連線、備份、持久化 catalog/outbox、修正/同步 API、歷史回填、封存/容量控制。`DumpDayRows` 單連線串流可能佔 writer，僅內部離線 primitive，禁止用於正式 API。
- Spot 未連線：四家 HTTP/WS、Binance U/u bridge/exact-T/refresh、Kraken exact/grouped/REST、Bitfinex P1/P2 實際來源 provenance、12 列排程及事件、實盤覆蓋與舊版對照。沒有真行情、沒有正式寫入、沒有部署。
- 前端延至 Phase 3 基本驗收，Drive OAuth/真授權延至 Phase 4；最新歷史檔尚待提供。
