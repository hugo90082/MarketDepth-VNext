# 03｜VM 後端重建任務 A

## 目標

基於現有 Go 收集器已驗證的交易所模組，重建簡單、可移植、可回測的 SQLite 後端。允許重新設計全部 storage/server；保留舊版原始資料及運作中的正式服務。不得直接改主線或 production。

## 建議專案分層

```text
cmd/marketdepth/             # 單一執行檔
internal/collector/spot/    # 四家 adapter、排程、coverage
internal/collector/futures/ # aggTrade 聚合、1m closed kline、補漏
internal/store/             # daily SQLite、writer、讀取、snapshot
internal/archive/           # Drive interface + catalog (任務 B)
internal/httpapi/           # auth、資料 API、靜態站、匯出
internal/monitorproxy/      # V66 必要的中繼路由（與 C 協調）
internal/health/             # collector / disk / archive / process 狀態
contract/                  # 共用 schema、JSON 契約、fixtures
web/dist/                  # 已編譯靜態資產，非 VM 編譯
```

最少模組優先，不引入 Redis/Postgres/Kafka、Docker Compose 多服務或其他必要性未證明的常駐 daemon。SQLite 驅動及 Go 版本用測試選定、鎖定；現有 Docker 上線方式可保留，但最終只跑輕量 binary。

## 寫入設計

- 台灣日期一個 SQLite；當日及跨日 grace 期間的前一日可寫，其他唯讀。用 bounded queue／單 writer 交易批量寫每分鐘 12 列、每 10 秒 3 列、每分鐘 3 列官方 K；不要依賴純 RAM 緩衝到很久才寫入。
- ACTIVE 使用 WAL（預寫日誌），設定適當 busy_timeout、同步級別及 checkpoint。必須測試 kill -9、掉電模擬、重啟、WAL recovery；快照用 SQLite Online Backup API 或等效一致性機制。
- 儲存按 UTC+8 日切；回測的 t 不因分檔改變。讀取不可阻塞收集；長查詢使用 context timeout、bounded reader、唯讀連線。
- 不在啟動時因版本不符 `RemoveAll`。資料目錄隔離；若不相容，拒絕啟動並明確告警；匯入或 migration 顯式執行。
- 本地 catalog SQLite 小檔保存日期、archive revision/fileId/hash、pending 狀態、遺失記錄、少量設定。可從 Drive 的 manifest 與檔案 metadata 重建。長期歸檔詳見 04。
- 不保存原始高頻 WS、重複衍生值。健康狀態、重要事件及日誌輪替；監測 queue/drop、GC、OOM、swap、磁碟及網路。收集優先於匯出/下載/非必要 proxy。

## API v2（供前端 mock／整合）

建議固定 prefix `/api/v2`，舊 V66 同名路由由 adapter 處理而不是修改研究 UI 行為。全部市場資料接口需登入 cookie 或機器專用 read token（如將來確需）；瀏覽器不持有機器 token。

| Method / path | 參數 | 語意 |
|---|---|---|
| GET `/api/v2/meta` | — | 契約、時區、資產、交易所、區間、cadence、資料品質規則 |
| GET `/api/v2/health` | — | 最新各 feed 時間、狀態、延遲、缺口、archive/disk 狀態；登入後完整資訊 |
| GET `/api/v2/latest` | `kind` 可選 | 最後完成的原始 spot、10s、1m；不回傳未完成 bar |
| GET `/api/v2/days` | `from`, `to`（YYYY-MM-DD） | 日期 catalog（狀態、版本、可用區間、row counts、hash／etag、缺口） |
| GET `/api/v2/history` | `kind,from,to,cursor,limit,asset,venue` | `[from,to)` 時間範圍原始資料，分頁、有界；可選 asset/venue（spot） |
| GET `/api/v2/sync` | `kind,cursor` | 短週期增量，包含遲到／修復紀錄；若游標過期回傳 resync 提示 |
| GET `/api/v2/export` | `from,to,kinds,format` | 串流匯出指定日期／時間段，gzip JSONL 為基本格式；大型下載可用每日原始檔 bundle，無暫存大型完整檔 |
| GET `/api/v2/day/{day}` | `revision` 可選 | 選定已封存日 `.sqlite.gz` 下載、hash、etag；進行中日不當 sealed 檔案提供 |
| POST `/api/v2/auth/login` / logout | 密碼 / cookie | 認證／清除 cookie；安全規則在 07 |

- `kind` 枚舉 `spot_depth|futures_10s|futures_1m`；公開研究匯出可含 `events` 但不得含敏感資訊。from/to 一律 epoch ms（day 目錄例外）。
- JSON response 共同格式：`{"ok":true,"data":[...],"meta":{"contract_id":"MD-VNEXT-1","kind":"spot_depth","timezone":"Asia/Taipei","from":0,"to":0,"next_cursor":null,"complete":true,"gaps":[]}}`。錯誤 `{"ok":false,"error":{"code":"...","message":"..."}}`；`complete` 代表已完整回應請求範圍的可取得資料，非全部 feed 有效。
- 歷史穩定排序 `(t,venue,asset)` 或 `(t,asset)`；不只用 t 游標（同 t 多列）。封存 revision/etag 不同則重新取該日；避免一個不斷長大的全域 index JSON 每分鐘重寫。
- 增量不能只用最大 t，因為延遲修復可能是舊 t。建議日內單調 ingestion sequence／update cursor（或重疊窗口加 revision 核對並覆蓋）；設計由 A 確定後發布 mock。跨日、重啟、游標失效時依 `/days` revision 補抓。不能漏更正，也不能無聲重複。
- 資料超界／Drive 暫不可用：明確回 `gaps` 或適當 503／404；不返回假零或把已快取歷史當最新。429/Retry-After、401、5xx 客戶端退避；避免重試風暴。
- 建議 10 秒輪詢 latest/sync；歷史分日、分頁或串流 gzip。不限舊全域 2 req/s；初始 history 同時 1–2、export 同時 1（可設定），登入與重型路由各自限流、timeout。依壓測調整，勿宣稱認證即可完全防濫用。
- 瀏覽器做聚合與指標；VM 只做原始數據讀取與必要格式轉換，最多快取少量近期資料。API 不保存完整歷史到 RAM。

## 交付要求

新分支/新模組、Go test、fixtures、資料庫 schema 與版本測試、OpenAPI/JSON fixtures、build/release 方式、資源量測、失效及重啟測試。交付 commit SHA 及遷移說明；不得啟動正式改版。Drive 與前端請以 contract 對接，避免互相硬編碼路徑或改欄位。
