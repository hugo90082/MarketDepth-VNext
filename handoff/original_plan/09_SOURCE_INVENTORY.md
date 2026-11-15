# 09｜來源、檔案清單及查證紀錄

## 1. 原始檔案（使用者提供／可於原對話或檔案庫取得）

| 檔名 | 用途 | SHA256 |
|---|---|---|
| `marketdepth-v66-source.zip` | V66 372 檔原始碼，前端移植 | `a4b3c0acdecd8972e4dbf307bddf5ede42e36fdc74a15d4aed8da505a2e98bd0` |
| `marketdepth-local-history-2026-11-12T16-47-32-103Z.jsonl.gz` | 使用者瀏覽器歷史匯出，原始證據 | `b9397b4f92b3c84d5d2271a411f47afe3eda0d24d3800e2f9176ec18c49f211e` |
| `marketdepth-v66-sites-build.tar.gz` | GitHub 部署備份 21,681,628 bytes；正常移植不必取得 | `9752b80edd2f8c6a8e4d539b795d9a6f5a1acca28f449386b2378b00f8c7a365`（README 記錄，未在本次下載驗證） |

原始 source 1,135,782 bytes、history 158,980,753 bytes；前兩份已在本次 runtime 重新計算 SHA256，完整歷史 gzip 重新逐行解析，V66 ZIP 檢視 372 個檔案及關鍵模組。本包不重複附上上述資料與 build。請按 08 需求上傳原始檔。舊歷史不是整個 Sites D1/Railway/新 AWS 的完整備份。

## 2. GitHub／服務

- 舊正式收集器：https://github.com/hugo90082/MarketDepth ，AWS 目前部署基準 commit `4d030e3c4dda2c85e5404e96e10b7fd6abed7c9c`。參考 `config.go`, `exchanges.go`, `spot_rest.go`, `model.go`, `main.go`, `storage.go`, `server.go`, `recent.go`。尤其 `ensureDatasetFormat()` 在不符舊 marker 時會 `RemoveAll`，**不可沿用**。
- AWS 初次安裝腳本：分支 `ops/lightsail-sydney-nano-setup`，commit `b0b4350b34c55369d46f8a018e783a0c38d1f3ba`，`ops/lightsail-nano-bootstrap.sh`。不應拿舊 bootstrap 直接覆寫新版環境。
- V66 備份：https://github.com/hugo90082/MarketDepth_codex （private），README、source.zip、sites-build.tar.gz；原始 Sites commit `1eba4b4ea8e07b1f6abd455f3d7d76a43c09030d`。壓縮檔非展開原始碼；新對話需上傳 ZIP 或使用有權限的 GitHub clone。
- 原 Sites：https://marketdepth-observatory.magic-knoll-8651.chatgpt.site/ ，監控 `/monitor`。保留至新站驗收。README 有部分舊 30s 說明，不是新版契約。
- 舊 Railway production：`MarketDepth`，project `be58a0ef-0219-48d3-aaf2-6b04a1308d54`、service `b54c1b69-256f-4501-bb4e-91c1b185ba25`、deployment `416282a0-3ac3-4301-a0bd-aa8ab1f52a5e`（先前查詢狀態，非即時）；原 API `https://marketdepth-production.up.railway.app`，不得再用作新版主資料源。
- 早期前端交接（僅歷史）：`MARKETDEPTH_FRONTEND_API_HANDOFF_2026-09-25.md`、`MARKETDEPTH_FRONTEND_API_RATE_LIMIT_UPDATE_2026-09-29.md`、`MARKETDEPTH_BINANCE_DIRECT_FETCH_FRONTEND_REFERENCE_2026-09-29.md`。舊 30s、1s、分包、限流不沿用。

## 3. 先前 AWS 實測基線（不是新版驗收）

- 初啟動 `/health` 200，五筆分鐘快照 600/600 有效側值，container 18.9MiB/320MiB、CPU 0.07%（單次觀察）、restarts=0、OOM=false。
- 主機 `df -h`: 19G，5.8G used、13G free；當時 data 2.3M。RAM 約 412MiB 可見，available 187MiB，swap 112MiB/2GiB（初啟動）。
- 約 16 小時 AWS metrics（2026-11-12）：平常 CPU 小時均值約 0.48–0.68%，下載 75–112MB/h、上傳 1.4–1.6MB/h，主機狀態檢查失敗 0。不是新增 futures 或網站後的數據。
- HTTPS 公開 REST 新建連線每家 5 次中位：Bitfinex 42.2ms；Binance spot 138.5、futures 150.2；OKX 151.1、Bybit 153.2；Coinbase 251.7、Kraken 331.2；Gate spot 639.0（最慢1514.7）。各次 HTTP 200。TCP 多為附近網路入口，不能證明撮合主機延遲；Gate 未測合約長連線及真實下單，不作交易資格或下單速度依據。
- 容量估算：先前真實 1 日 spot SQLite 測試約 2.18MB；10s futures 容量模擬約 2.97MB（非真實 10s）；新版額外 1m、品質及 index，粗估 6–10MB/day，需實測。舊 12h package 約 0.675–0.75MB；舊包含秒價約 2.5MB 是使用者觀察，不是新版容量保證。

## 4. 官方技術來源（查證日期 2026-11-13；實作時再核對最新 API）

- Google Drive 最小權限與 drive.file：https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- Google Drive 上傳：https://developers.google.com/workspace/drive/api/reference/rest/v3/files/create
- Google Drive 下載：https://developers.google.com/workspace/drive/api/guides/manage-downloads
- Drive metadata、sha256Checksum：https://developers.google.com/workspace/drive/api/reference/rest/v3/files
- OAuth 2.0 refresh token、Testing 七天與失效：https://developers.google.com/identity/protocols/oauth2/
- OAuth web server flow：https://developers.google.com/identity/protocols/oauth2/web-server
- Let's Encrypt IP 憑證（短期、需自動續期）：https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability/
- Binance 官方 USDⓈ-M 市場 stream（V66 README 參考）：https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/market
- Binance USDⓈ-M REST market data：https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data

Google Drive 帳號可用空間、實際方案、OAuth consent、域名、TLS client 均未實測；不可依訂閱宣傳當成永久容量保證。沒有新增 Google Cloud 付費資源，沒有向 Drive 寫入資料。新 Binance stream 的現行 endpoint/限額需在實作當天核對並以真實公用資料驗收。
