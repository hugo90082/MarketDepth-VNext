# MarketDepth v3

React／TypeScript／Vite 觀測站。即時現貨深度與 Binance USDⓈ-M K 線由瀏覽器直連交易所，IndexedDB 保存；Sites Worker／D1 只負責共用歷史快取及交易所失敗備援。

## 共用密碼登入

- `/login` 不需要帳號，沒有登出介面。主頁與所有資料 API 由 Worker 驗證登入；未登入時不掛載行情頁、不讀本機資料、不啟動行情 Worker。七天到期、回前景或恢復網路時重新驗證，到期停止行情與補齊工作，保留歷史與 `md_client`。
- Sites 秘密設定：`SITE_PASSWORD_SHA256` 是共用密碼的 SHA256 小寫十六進位摘要；`SITE_SESSION_SECRET` 是隨機 32 bytes 的小寫十六進位簽章密鑰。不得提交真實值或放入任何 `VITE_` 變數。缺少設定時保護內容停止提供。換摘要或簽章密鑰會使舊憑證失效。
- 登入 Cookie 為 HMAC-SHA256 簽章、固定七天、不續期的 `__Host-md_session`，使用 HttpOnly／Secure／SameSite=Lax／Path=/。僅 localhost HTTP 開發使用 `md_local_session`。同 IP 每 15 分鐘最多十次登入嘗試，D1 原子計數使用獨立 `v3-auth-rate:` 紀錄，不修改 Collector 閘門。
- 本站備援與歷史請求使用 `credentials: same-origin`；直接交易所請求仍為 `omit`。Cookie 不存 localStorage；密碼與密鑰不出現在 API 回應或日誌。API 收到 `AUTH_REQUIRED` 時卸載行情頁；多分頁同步登入與到期。
- 正式建置將 HTML 嵌入 Worker，`dist/client` 只保留公開程式與樣式資產、不放 `index.html`，避免 Sites 靜態路由略過主頁驗證。主頁與 `/login` 都由 Worker 回傳 `no-store` 與禁止收錄標頭。修改前端時請執行完整 `npm run build`。

## 資料與成本

- 契約：`MD-SPOT-30S-USD-3`、`MD-HISTORY-INDEX-3`、`MARKET_DEPTH_USD_NOTIONAL_TRUSTED_COVERAGE_V2`。識別字與 API 格式維持不變；金額為 USD notional，USD／USDT 按 1：1，後端值不重乘。
- 深度每30秒採樣，逐邊判定觀測覆蓋；Binance BTC/ETH 使用 REST5000 bootstrap、100ms Diff WebSocket 與 U/u 序號驗證。定期刷新 REST5000 時只取代新快照涵蓋的價位，保留外側已連續追蹤的掛單；失序或斷線才從乾淨快照重建。新版 Railway 正式 zone 與瀏覽器即時 zone 均由各自的觀測訂單簿計算，REST5000 原始可信邊界僅供品質稽核；兩端取樣時點不同，數值可能有差異。ALL4及累積先加總金額，覆蓋不足與斷線分開顯示。
- 瀏覽器三資產共用單一收集分頁，保存250MB，超量淘汰最舊；清除舊數量／USD v2快取一次，保留新資料。
- 瀏覽器即時列完整時不使用 Railway Recent；若所選資產的 Binance 觀測覆蓋不足，才呼叫 Sites `/api/depth/live-gap?target=...`。同一目標列由共用快取回應；尚未到達的列以短暫應用快取與 `since` 增量重試，不沿用舊版 30 秒 HTTP cooldown。未封存 Recent 只補本機缺值，不用後端 null 擦除瀏覽器已確認的單側，並標記為暫存；待 Historical 封存後仍需比對。已封存 Historical 整筆優先（包含 null）；舊版已封存的 Binance null 保留原樣，不因新版收集規則回填。其他封存歷史**只在使用者按下「比對並補齊」時**由 `POST /api/depth/backfill/jobs` 及 `/jobs/:id/advance` 補齊；開站、恢復連線及切換視窗不自動建立歷史工作。
- Historical、Recent 與驗證請求共用全站 D1 `collector` 原子閘門，每次 Railway Bearer 請求至少間隔 600 ms，順序發送而不並行。429 依 `Retry-After` 等待後續接原進度；索引分頁保留版本與游標，已驗證 chunk 不重抓。沒有缺口就沒有 Railway 歷史請求；無訪客不工作。
- 暖快取分批每次最多傳8個chunk，只有實際收到、保存並讀回的區塊才確認；7D的確認清單可完整送出。`GET /api/depth/backfill/status?hours=...` 僅讀 Sites 快取，不觸發 Railway。瀏覽器依 chunk ID、SHA256 和時間格記錄核對狀態；後端已確認的 null、尚未核對及本機快取遺失分開呈現。同一封存範圍的完成工作重用，後續新封存範圍才建立新工作。歷史服務只接受所選的1H／4H／12H／24H／2D／3D／5D／7D範圍。
- K線30s由實收成交建立，離線空白；1m直接Binance API，5m／15m聚合。預設觀察視窗24H、深度範圍0–300 bps累積。圖上的深度比值依K線週期彙整：先加總該週期每30秒樣本的買賣USD金額，再算失衡；任何樣本缺格或缺值都讓該週期留白。
- Futures串流採官方 `/market/stream`，參考 https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/market 。

## 本機

1. `npm ci`，`npm run build`。
2. 無Railway流量的驗收：PowerShell先設 `$env:MARKETDEPTH_HISTORY_DISABLED='1'`，並在程序環境設定測試用 `SITE_PASSWORD_SHA256`、`SITE_SESSION_SECRET`，再 `npm run dev:bff`。建置版可直接開 `http://127.0.0.1:8787/`。
3. 另開終端 `npm run dev -- --port 5173 --strictPort`，開啟 `http://127.0.0.1:5173/`。
4. 正式歷史驗收走已部署Sites的共用gate，避免本機與正式站各自發送；如確需獨立歷史測試，先協調停用另一套上游存取，再使用 `scripts/start-local.ps1` 於程序記憶體載入交接token。

本機D1在忽略的`.cache/d1`；不得提交token、交接ZIP或.env。

## 驗證與發布

- `npm test`：登入、固定七天到期、密碼更換、偽造憑證、同來源檢查、D1 原子登入限流、匿名請求不讀快取／不叫上游，以及交易所計算、觀測覆蓋、null/0、IndexedDB持久性／來源優先／容量、共享gate、中斷、401/429/409/404、SHA/304及舊API禁止輪詢。
- `npm run check`；`npm run build`。
- `node scripts/verify-built-auth.mjs`：用正式建置與資產優先路由驗證主頁不能繞過登入，使用暫時測試憑證，不連 Railway。
- `node scripts/verify-live.mjs` 驗證匿名導向登入、noindex 及資料 API 401，不觸發 Railway。若程序環境有 `SITE_QA_PASSWORD`，另外驗證登入 Cookie、固定期限、v3 狀態與舊路徑 410；不輸出密碼或 Cookie，不建立歷史工作。
- 使用Sites的site-workflow重新使用`.openai/hosting.json`專案，推送來源、由同一commit建置封裝，save_site_version再deploy_site_version，保持public。
- D1結構由既有Drizzle migration維護；版本清除是限定快取資料的一次性交易，不刪gate。

不新增／修改／部署Railway資源；不新增外部付費服務。HTML及API維持noindex、nofollow，不提交sitemap。公開站點無法保證所有爬蟲遵守。


## 來源復原與乖離線配色

Kraken 暫時性服務錯誤曾被誤判為不支援交易對，觸發六小時停抓。瀏覽器與 Sites 現在共用明確錯誤分類；只有明確的 unknown-pair 錯誤才判為不支援，服務錯誤及空簿保持可重試。非 Binance 直連在既有 30 秒整輪期限內預留備援時間，不放寬研究取樣時窗。回歸測試位於 `test/exchange-recovery.test.ts`。

三組乖離線配色保存在既有 v2 設定的可選 `common.bandColors`；缺少配色的舊設定沿用藍色並保留各商品距離。每組正負線共用顏色，外觀更新不重啟計算、不重建圖表或改變時間視窗。

Kraken 交易對精度由市場目錄取得；未知精度及首次快照從一個 tick 開始，取得實際中間價後才使用動態分組，避免 SOL 被粗分組為 100／110 美元而產生內圈假零。Sites 備援採相同規則，且不同分組寬度的快照不做五秒混合。回歸測試位於 `test/kraken-grouping.test.ts`。
