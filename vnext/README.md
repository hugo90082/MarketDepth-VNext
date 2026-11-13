# MarketDepth VNext — Phase 1 開發基礎
本目錄是獨立 Go module，預定放置於舊 repo 的 `vnext/`，不得覆蓋根目錄程式。當前只提供明確標示的合成資料 mock，不可當正式服務使用。舊版基準 commit: 4d030e3c4dda2c85e5404e96e10b7fd6abed7c9c。

## 執行
需求 Go 1.23；本階段無第三方 Go 套件。Python 3 用於原始 SQLite 契約檢查。

```sh
go test ./...
go test -race ./...
go vet ./...
python3 tests/schema_check.py
go build -o marketdepth-vnext ./cmd/marketdepth
./marketdepth-vnext --mock --listen 127.0.0.1:18081
```
瀏覽 `http://127.0.0.1:18081/api/v2/meta` 或 `/api/v2/latest`。缺少 `--mock` 或使用非 loopback 會直接拒絕啟動。fixture 固定為台灣時間 2026-11-13 00:00 起兩分鐘，不是真實行情。

## 本版邊界
- `internal/model`：三種型別、可空欄位、基本值域與 live availability 驗證。正式 writer 仍需驗證來源、捕獲窗口、status 品質與提交時間。
- `internal/store`：讀寫接口、測試用記憶體實作。非 durable、全域版本使歷史游標失效、非安全簽章 cursor，僅限測試，不可用於實盤。未實作 revision 歷史封存、WAL 與 durable journal。
- `internal/archive`：資料與 manifest 介面，未連接雲端。
- `internal/httpapi`：模擬 meta/health/latest/days/history/sync/export，auth 及 sealed day 501；無正式認證／限流、無 live feed。`contract/openapi.json` 是開發草稿，回應部分資料型別仍須正式化。
- `contract/schema.sql` 保持原始 SHA256 不變；fixtures 由測試服務產生。詳細狀態見 `docs/10_MASTER_LOG.md`（打包時同一主控紀錄的快照）及 `docs/HANDOFF_A_INTERFACE.md`。

下一步：完成 Phase 1 遠端隔離版本與介面細化；Phase 2 SQLite 日庫、單 writer、WAL／重啟測試及舊現貨收集模組移植。絕不直接部署至舊 VM。

## Phase 2 開發中

離線 SQLite/spot primitive 已加入；不是正式服務。`go test ./...`、`go test -race ./...`、`go vet ./...`、`python tests/schema_check.py`、`python tests/daily_sql_check.py` 為離線測試。真 Go driver 需可下載依賴：`go mod download github.com/mattn/go-sqlite3 && go test -tags sqlite_integration ./internal/store`，目前未通過此驗收（網路阻塞）。詳 `docs/PHASE_2_FIRST_RESULTS.md`。不要部署本版；CLI 仍只提供 loopback mock。
