# CoinGlass 後端瀏覽器收集可行性

查核日期：2026-10-11。此檔僅研究；未部署、未增加付費資源、未修改應用或 Railway。

## 結論

不透過插件、改由後端真正執行瀏覽器，技術方向可行。這與先前失敗的直接 HTTP／獨立 WebSocket 請求不同：瀏覽器會正常載入來源頁 JavaScript 與其資料流程。但目前只證明使用者 Chrome 頁面能取得三商品 2,168 筆歷史，不能推論雲端 headless 也一定取得。需要在預定執行環境實測原始事件；HTTP 200、頁面標題或 pong 皆不足以通過。

Cloudflare 現稱 Browser Run（舊稱 Browser Rendering），提供真實 headless Browser Sessions；官方文件要求另設 browser binding 或使用帳號 API。現有 `.openai/hosting.json` 只有 D1 DB、R2 null，沒有證據顯示 Sites 可直接配置 browser binding。一般 Worker 不是內建 Chromium。應先確認 Sites 支援配置，否則另設獨立的收集服務，Sites 僅讀取其去重結果，不能承諾只加幾行 Worker 就能完成。[Browser Run 設定](https://developers.cloudflare.com/browser-run/get-started/)

## 每分鐘重開與重用瀏覽器

- 每分鐘工作可由 Cron Trigger 啟動；官方支援每分鐘表達式與 scheduled handler。每輪需要互斥租約，前輪仍執行就跳過／合併，不堆積瀏覽器。[Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- 每分鐘重新啟動瀏覽器會重載大量前端資源、建立連線、等待資料，三商品切換與分頁又增加時間。可一次開一份瀏覽器依序处理三商品；不要每分鐘重抓七天。
- 常駐或重用 session 可省冷啟動，但整段開啟時間仍計費，並非只算每分鐘讀取的幾秒。官方建議多數工作重用 session；沒有固定最大壽命，但預設閒置 60 秒、keep_alive 可至 10 分鐘，平台更新仍會關閉 session。這意味需要恢復設計，不是保證永遠不斷。[Session 與限制](https://developers.cloudflare.com/browser-run/limits/)、[重用建議](https://developers.cloudflare.com/browser-run/faq/)
- 頁面有 WebSocket 時，不能只等 networkidle0；應等待明確的歷史資料事件及正常渲染。公開頁若回 bot challenge、登入要求或空內容，就記為不可用，不使用使用者 Cookie 或繞過驗證。Cloudflare 官方明示 Browser Run 會被識別為 bot，與使用者 Chrome 的網路環境不同。[Browser Run FAQ](https://developers.cloudflare.com/browser-run/faq/)

## 建議同步方式（待來源許可與實測）

初次補歷史一次；此後每分鐘讀三商品最新列表，持續分頁至早於上次成功時間加上重疊窗口。重疊窗口先暫定 5–10 分鐘，再由實測到達延遲調整，不能只取上一分鐘。斷線恢復按最後成功游標回補，至來源正常列表可取得範圍為止。

每筆原始 USD 金額 >100,000 才入庫，正好 100,000 排除。以来源 ID 優先、否則交易所／商品／合約／方向／事件毫秒／原始金額／價格指紋去重。若無 ID，完全相同事件仍可能無法區分。分頁、資料修正與即時交疊不重複加總。

需要保留正常網頁解碼後的精確 JSON，不能改用畫面 K／M 或最多三位小數的金額提示。每輪保留三商品成功範圍、截斷／分頁完整度及錯誤；沒取得資料不能宣稱沒發生爆倉。

後端保存與瀏覽器保存是不同存放範圍。可讓後端保存同步游標與去重資料，前端增量匯入既有 IndexedDB；原先未備份不刪、兩項七天清理條件仍適用瀏覽器紀錄。若後端也永久保存未備份資料，需要另定容量、備份與下載授權，不能沿用全站公開讀取而忽略資料授權。

## 費用與運作尺度

官方目前 Free 只有每日 10 分鐘 browser 時間；Paid 含每月 10 小時，額外每 browser 小時 US$0.09。Browser Sessions 並行額度含 10 個（按月平均每日尖峰），超額另計。[價格](https://developers.cloudflare.com/browser-run/pricing/)

以下為一個瀏覽器、30 天、每天每分鐘執行的推算，非量測：

| 每輪總 browser 時間 | 每日 browser 時間 | 每月時數 | Paid 額外 browser 時間費 |
|---|---:|---:|---:|
| 10 秒 | 4 小時 | 120 小時 | 約 US$9.90 |
| 20 秒 | 8 小時 | 240 小時 | 約 US$20.70 |
| 30 秒 | 12 小時 | 360 小時 | 約 US$31.50 |
| 全天常駐 | 24 小時 | 720 小時 | 約 US$63.90 |

不含 Workers 基本方案、儲存、查詢、重試或其他服務；若每商品分別開瀏覽器，計時需加總。免費額度不足以支撐一般每分鐘開頁工作，不能先宣稱免費又常駐。此研究未開通費用。

## 來源使用限制

CoinGlass 現行網站條款明列未經許可不得大量 scrape／crawl／extract，也限制複製、轉售或再散布資料。每分鐘三商品持續收集與在公開 MarketDepth 顯示，不能直接視為已被來源授權。需確認適用許可／取得來源授權；這是條款查核結果，不是「技術上做不到」。[CoinGlass 網站條款](https://www.coinglass.com/terms)

正式七天歷史及即時 API 都要求 Standard 或以上，與免費網頁流程不同；API 條款也限制未經書面同意的獨立大量資料庫、再散布與代理轉發。[歷史 API](https://docs.coinglass.com/reference/liquidation-order)、[即時 API](https://docs.coinglass.com/reference/ws-liquidation-order)、[API 條款](https://www.coinglass.com/api-terms)

## 可行性驗證門檻

1. 不依赖個人瀏覽器或插件的乾淨後端 session，正常載入來源頁。
2. 三商品均取得精確歷史資料，核對多交易所、方向、毫秒及原始金額；分頁至游標，不只讀可見幾十列。
3. 連續至少 30 分鐘每分鐘同步，捕獲至少一筆真實新增紀錄並與正常頁面核對；不得把心跳當事件。
4. 驗證後端網路來源可用、重新啟動補漏、并行互斥、資料去重、缺口標示，並量測三商品總 browser 秒數。
5. 確認來源許可與目標部署支援，才設正式排程及公開資料流。

## 與插件即時橋接相比的改善

如果採每分鐘歷史回補，驗收重點是「真實新增事件會出現在正常歷史列表，後端可在下一輪取得」，不需要先證明即時 WebSocket 訂閱可用；預期延遲為輪詢間隔加來源延遲／頁面載入時間，不能宣稱秒級即時。歷史輪詢仍需驗證延遲到達及修正記錄的重疊回補。

後端自有頁面可固定三商品、所有交易所、100K 篩選，不必同步後還原使用者 CoinGlass 頁面控制，因此先前插件篩選還原未過驗收不會直接阻塞此方案。它不能消除後端來源可用、精確資料取得、分頁完整度、費用與授權等驗證。
