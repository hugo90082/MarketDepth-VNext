# 05｜V66 網站移植（任務 C：Codex／Gemini／前端對話）

## 1. 目標與來源

使用 `marketdepth-v66-source.zip` 的 372 個原始碼檔，React/TypeScript/Vite/Lightweight Charts 保留。V66 是 UI 與功能基準，不是新版資料來源架構。原始碼已備份在 `hugo90082/MarketDepth_codex`；解壓到獨立工作樹，不直接修改壓縮備份。新程式可另建分支/專案，主控負責整合，勿擅自修改已上線 Sites。

最重要：**研究頁改由 VM 提供正式原始資料；監控頁 `/monitor` 保持 V66 的直連行為、六家交易所及所有現有功能。** 不把監控頁的瀏覽器採樣混入正式研究資料，不把 OKX／Bybit 加入 VM 收集。

## 2. 程式模組對照（先讀實碼再改）

| 檔案/目錄 | 新版處理 |
|---|---|
| `package.json`, `scripts/build-client.mjs`, `scripts/build-worker.mjs`, `README.md` | 保留 React 前端、建立靜態前端 build；Worker/Miniflare 不作生產 runtime |
| `shared/contract.ts`, `shared/model.ts`, `shared/minute-history.ts`, `shared/chart-data.ts`, `shared/market-history.ts` | 以 MD-VNEXT-1 adapter 映射；正式現貨 60s，不再 30s 合併；保留舊匯入資料語意 |
| `src/site-api.ts`, `src/market-history/runtime.ts`, `src/market-history/Status.tsx` | 換 `/api/v2` history/sync/latest/days/status；自動增量補抓，來源與缺口提示 |
| `src/storage.ts`, `shared/managed-storage.ts`, `shared/market-sync.ts`, `src/market.worker.ts` | IndexedDB 快取與 Worker 保留；移除『瀏覽器是正式資料收集者』的研究頁路徑 |
| `src/history-export/`、`shared/local-history-export.ts` | 匯出支援 VM 全歷史（不僅瀏覽器快取）；保留舊格式相容或明確新格式，含 10s 及 1m |
| `src/indicators/calculate.worker.ts`, `src/strategy/` | 保留 RSI/均線/乖離/策略 V37、圖表；使用正式來源，測試時間可用性 |
| `src/monitor/browser-depth-worker/`, `src/monitor/depth-engine/`, `src/monitor/` | 監控頁不重寫；保留六家、選幣、排行、profile、警報、音效、外掛橋接 |
| `worker/coinbase-relay.ts`, `worker/monitor.ts`, `worker/exchanges.ts`, `worker/index.ts` | 盤點實際在用 route，與後端 A 合作移植最少必要的 Go proxy；不要無聲刪除 |
| `worker/auth.ts`, `src/AuthGate.tsx` | 對接 Go session；不在前端嵌密碼/token；登入過期/未授權停止請求 |
| `worker/history.ts`, `worker/jobs.ts`, `worker/recent.ts`, `worker/backfill-ack.ts`, `worker/db.ts`、D1 migrations | 舊 Sites 歷史快取、排程、全站閘門等非必要；逐條確認引用後移除，非直接刪整個 Worker |

注意：V66 README 某些說明仍寫 30s／舊 schema；實際程式與當前匯出已含 60s。不得據 README 回復 30s。原版正式站及 `/monitor` 保持不動，直到新站比對通過。

## 3. 研究頁資料生命週期

登入成功 → `/api/v2/meta` → 查 IndexedDB 本地已快取日期與 revision → `/days` 核對缺少或更新的日 → 逐日／分頁下載所需資料 → Web Worker 驗證、寫入 IndexedDB → 計算並繪圖。只下載使用者所需時間範圍及指標 warmup，不自動抓完整十年資料。

每 10 秒取得增量（預設），在 active date 追加新 10s、1m、spot；同一天的 repaired row 用 `(kind, t, venue?, asset, revision)` 更新快取。封存後依 revision/hash 對照；跨日、離線、重連、cache eviction 必須補缺；不要只以最後一筆 t 判斷所有資料完整。瀏覽器頁籤休眠／手機背景時暫停或降低頻率，回前景立即補抓。多分頁可共用同一快取並減少重複 HTTP；不需要舊版指定上傳來源、D1 同步鎖。

## 4. 運算移到瀏覽器

- ALL4、差值、比值、累積區間、CVD、10s 聚合、RSI/EMA/WMA/乖離、研究策略、圖表皆在 browser；計算規則以 02 為準。
- Web Worker 負責大量資料解碼、分批計算；使用 typed arrays/分頁/分段，避免整個歷史長期進主執行緒或渲染十萬點。
- 桌機快取軟上限 500MB、手機 100MB，依 `navigator.storage.estimate()` 動態調低（非保證 quota）；LRU 清除舊日期；瀏覽器清除資料不影響 Drive 主資料。登出後停止請求、清除 RAM；是否保留已下載 IndexedDB 給相同帳號須有明確選項，預設共用裝置可清除快取。
- `ALL4` 至少兩家完整配對才顯示，附 venue_count；不能修改 null 語意。1m 官方行情和 10s 行情獨立；任何前端生成的 1m 都要明確標示非官方。
- 長時間段圖表與匯出分開。圖表可 downsample 顯示，匯出必須全解析度，不因顯示抽樣少資料；大檔用 VM 串流下載或瀏覽器可用串流，不先塞整份到 RAM。
- 研究 UI 和真實下單隔離。前端不能持有交易 API key、不能負責真實風控及下單。

## 5. 監控頁（保留原功能）

瀏覽器原本的直連方式、OKX／Bybit、六家交易所計算、合約/現貨選擇、排行榜、深度輪廓、警報與音效維持。Coinbase relay、CORS/交易所失敗備援、market-meta/markets/market-selections、CoinGlass extension 的本地設定與網站 route 依實碼盤點，必要的低資源 API 由 Go 提供。proxy 僅白名單 exchange/asset/固定網址、限流、timeout，禁止任意 URL／SSRF；不可為修正地域限制提供繞過。前端 origin 變更會使舊 IndexedDB 與 localStorage 無法直接共用，提供可匯出的非秘密設定移轉方案；敏感憑證重新登入。

## 6. 建置、驗收與交付

先跑原版 `npm ci`, `npm test`, `npm run check`, `npm run build`（隔離，不接 production）；確認現有失敗項再改。用 mock API 測試，再接測試 VM。正式 build 只需要靜態 assets + SPA routing，Go 保護 HTML／所有私有 API；不得在資產或 service worker cache 存 secret。驗收：桌機、手機、登入/登出、過期、匿名 401、所有既有圖表/指標/策略、四家研究來源與六家監控、10s OHLC/delta、官方 1m、舊歷史、長區間匯出、離線補抓、cache revision/eviction、缺失不填值、重複同步無重複列。比對 V66 已確認功能，記錄任何刻意變更；不要僅做畫面截圖宣稱功能正常。

交付：commit SHA、可重現前端建置包、路由對照、測試紀錄、已保留／移除功能表、Go proxy 所需契約及未解問題。不得先部署或停用 Sites。
