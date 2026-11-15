# MarketDepth 開發紀錄

## 目前計畫基準（2026-09-26 USD 交接更新）

- 完整修正版見 [task_plan.md](task_plan.md)。以下較早紀錄保留作為開發歷程，不再代表目前計畫。
- 已核對 `MARKETDEPTH_FRONTEND_USD_FINAL_HANDOFF_2026-09-26.zip` 全部五份文件。後端已提供 USD schema／1：1 政策，並記載舊 dataset 清除、新資料約從 14:52 起累積；本輪沒有呼叫 Railway 或另行驗證部署。
- 目前程式仍使用舊 schema；後續需同時更新版本驗證、隔離舊快取並停用舊 Recent 輪詢，不能僅修改顯示單位。
- 使用者最終決策：三資產由瀏覽器即時收集，Sites 僅提供交易所備援／歷史共用快取；本機最細保存 30 秒，上限 250 MB、無天數限制；USD／USDT 按 1：1 計算。
- Railway 僅補超過 15 分鐘的歷史缺口，所有訪客共用至少 60 秒一次的限制；近期缺口到期自動補一次。K 線 30s／1m／5m／15m、觀察區間 1H／4H。
- 待確認：後端精確交易對、分區邊界與 coverage 規則，以及新版 index／chunk 完整傳輸樣本。詳見修正版計畫第 6 節。
- 本輪僅更新計畫及紀錄，未修改應用程式、資料庫或發布版本。

## 目標
淺色交易終端；Sites 公開免登入但 noindex；Sites Worker + 內建 D1 承載 BFF、共享快取與跨實例鎖。

## 使用者新增限制
- 不在 Railway 新增、部署、修改任何服務／設定／資料，不新增外部付費服務。
- Railway 只讀現有 Collector API。使用者不必執行 railway login。
- 所有輪詢改由訪客觸發並經 D1 原子鎖合併；沒訪客就不輪詢，重新開啟補資料。

## 已確認
- 已建立 React / TypeScript / Vite 前端與 Sites Worker BFF、D1 快取。
- 正式 v1.1 health、indexVersion 200/400/409、chunk SHA256/304 與 Recent 增量已驗證。
- OpenAPI v1.1 未附 Recent response schema，沿用補充包並依最終資料語意驗證。
- Railway 不進行任何管理操作，僅讀取現有 API。
- Sites 專案已建立，ID 保存在 .openai/hosting.json；尚未公開部署。不可重複建立。

## 待完成
- [x] 共用模型、BFF 排程／快取／分頁／API
- [x] 淺色介面、同步圖表、歷史漸進載入
- [x] 17 項自動測試、TypeScript 與正式建置通過
- [x] 本機真實 BTC／ETH／SOL K 線與深度、1／4／24H、累積與單一交易所切換
- [x] 手機窄版檢查無水平溢出；桌面並列圖表與明細
- [ ] Sites Worker + D1 公開發布與匿名／noindex 驗收

## 發布紀錄（2026-09-26 臺北）
先前可讀取的 Sites 0.1.71 外掛目錄已不存在；重新搜尋 .codex 後找不到 sites-hosting/SKILL.md 或 site-workflow.mjs。
發布需要恢復 Sites 外掛的本機檔案，再使用其 source workflow 推送、封裝、保存版本與部署。
不可因腳本缺失改用 Railway，也不可宣稱已上線。Sites runtime secret 尚未設定。
目前 dist 已建置完成，但未與推送的 Git commit 綁定，不能直接當成可發布版本。

秘密不寫入本文件、Git 或前端。主 collector 不做任何修改。

Sites 外掛檔案已恢復，正在使用原專案進行正式發布。

## 2026-09-26 13:35 正式站診斷
- Sites 版本 1 先前已部署，但 audience 仍為 custom，匿名請求得到 401 登入頁。
- 本輪將 audience 更新為 public，再部署既有版本成功。deployment: appgdep_6ab75858c110819198852c9545cb8f51。
- 正式網址：https://marketdepth-observatory.magic-knoll-8651.chatgpt.site
- 匿名首頁 200、HTML noindex、API X-Robots-Tag 通過；首頁的 HTTP noindex 標頭未被 Sites 靜態資產層保留，HTML 標記有效。
- Recent 32 筆及歷史資料可讀，實際 UI 已顯示買賣數量與失衡；沒有瀏覽器 JS error。
- K 線尚未通過：Sites price connection.error=HTTP_403、data=[]；相同 fapi.binance.com URL 從本機回 200/1500 根，尚未取得雲端上游拒絕的詳細內容，不能斷定地區限制或 WAF 根因。
- 可重跑驗收：node scripts/verify-live.mjs，目前因 K 線未恢復而 exit 1。
- 本機 5173/8787 服務已停止，不能再使用昨天 localhost 預覽網址。
- Sites 外掛目錄在本輪再次消失；含提升權限唯讀檢查與 .codex 全目錄搜尋，都找不到 site-workflow.mjs。既有版本可透過連接器部署，但來源更新流程仍受阻。
- Railway 僅讀取現有 API，無任何管理變更。正式站不可標示完整驗收通過。


## 2026-09-27 v3 改造（進行中）
- 已開啟既有Sites來源，保留原project/audience及本機修改；不新增專案。
- 已加入shared契約/交易所計算、worker/history、worker/exchanges、瀏覽器market.worker與IndexedDB。
- 舊API回410，HEAD不觸發上游；D1 collector gate預扣60秒且遷移不刪除gate。
- Binance外側diff回歸、多訪客限速、重試、409/purge/cache、圖表計算共23測試通過；TypeScript通過。
- 尚未發布；接下來本機瀏覽器QA（停用Railway以避免双gate）、修正發現、build、原Sites發布及v3實際historical驗收。

## 2026-09-27 桌面滿版修正
已完成頂列整合、8px外側留白、01擴寬、02比值、錯誤tooltip及最新K棒每秒更新。25項測試／TypeScript通過，本機真實Binance合約價格與四交易所現貨已顯示；本機禁用Railway。手機版暫不處理。Sites原始碼檢查及發布進行中。

發布完成：Sites版本2，source 40a120f4f6e227bf0f35dcf21686cfff0e153544，deployment appgdep_6ab89381ec108191bfd55b090811e25c。正式站HTML noindex、X-Robots-Tag、舊API410及v3 status通過；經全站閘門驗證health/index並下載30筆真實chunk，SHA/gzip驗證後complete=true。桌面每秒報價與tooltip正常。Sites本機skill/helper路徑本次不存在，改用既有Sites connector＋短效記憶體憑證推送同一來源commit，tar保留dist/server/index.js、.openai/hosting.json及Drizzle，未更動任何Railway資源。發布後的驗收紀錄留在本機work文件，不影響已部署程式。
