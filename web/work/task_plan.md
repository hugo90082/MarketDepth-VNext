# MarketDepth Trusted Coverage v3 實作計畫
## 2026-09-29 Binance 前端直連調整
- 依使用者已驗證的取數方式，BTC／ETH 改為 REST5000 bootstrap 加 `@depth@100ms` Diff WebSocket；持續保存快照內外所有有效變動價位並維持序號檢查。
- 每 15 分鐘以新 REST5000 原子重建本地簿，清除上一輪累積的外側價位；失序、斷線與 REST 失敗維持既有重建及退避處理。
- 畫面將此數值標示為「觀測覆蓋」，歷史封存資料仍保留後端原始 null，不更寫既有 Historical。

## 2026-09-28 Binance／歷史下載修正（本節取代早期限制）
- 已重現：48H的190個chunk確認鍵超過16000字元而回400；1H擴到48H未擴充原範圍；5分鐘冷卻阻擋新工作。均加入回歸測試並修正。
- 依最新要求取消額外歷史限速：退休瀏覽器與D1的5分鐘冷卻，Collector取消固定60秒；保留全站單一執行租約、上游Retry-After、401停止及暫時錯誤退避。Railway資源與設定不變。
- 完整暖快取每次最多傳8個chunk，僅確認瀏覽器實際收到並保存的區塊；不會一次傳送48H整包或誤認未傳送資料已完成。所有訪客仍共用已驗證快取。
- 本節的舊可信邊界判定已由 2026-09-29 的前端直連調整取代。
- Binance BTC/ETH 原本使用 REST5000 加每秒 diff 並捨棄外側價位；2026-09-29 起改為 100ms diff 累積所有有效變動價位，每 15 分鐘重建。
- 真實20秒驗證：BTC/ETH各2個快照、每秒串流，均成功刷新與序號銜接，無解析或限流錯誤。當時BTC買側約92bps、ETH兩側約319/340bps；API未覆蓋的區間仍為null，不能承諾750bps永遠完整。
- 50項測試與TypeScript通過，本機桌面重新載入、48H、ETH四所比值與提示通過；既有Sites發布中，正式結果另記於驗收紀錄。手機版不改。

## 2026-09-28 前次修正紀錄
- 使用者 Chrome 實際白畫面：正式版 `setVisibleRange` 在尚無時間點時拋出 `Value is null`。改為先解析可用索引，再設定 logical range；空資料等待，圖表與根節點均有錯誤隔離，不清除有效快取。
- 歷史完整性優先：啟動／擴大 1/4/12/24/48H／已封存缺側可自動檢查與補齊；已確認缺值、重置前範圍及完整本機資料不重抓。保留手動按鈕與 5 分鐘工作起始冷卻。已開始工作快速逐塊完成、全站單一請求、遵守 429 與錯誤退避，取代早期固定 60 秒等待。
- Coinbase 改用公開 level2_batch + heartbeat，一條連線三商品；正常不再 30 秒重抓完整 L2。Bitfinex 採 F1（2 秒）P0/P2，保留 CRC 與心跳。Kraken 保留原始十進位字串驗證 CRC，降低每則更新排序成本。Binance bootstrap 使用較合理連線時限、每秒 diff、有限初始化佇列。
- 連線穩定滿 60 秒才重設重連退避；停流偵測 45 秒、重連 5–60 秒、Retry-After 支援日期。Sites 交易所備援依交易所共用閘門。
- 30 秒採樣容許 ±1500ms 真實擷取時窗，不因事件晚於格點 1ms 就丟棄；休眠逾時仍不倒填。
- 每秒只更新變動 K 棒，合併歷史讀取、30 秒區間讀取去重、跨分頁只同步工作摘要，歷史增量回傳；D1 先查 chunk 中繼資訊，僅批次讀取需要的本文。
- 41 項測試、TypeScript、正式建置通過。大型訂單簿堆疊溢位、Bitfinex 心跳誤判、壞快取、空時間軸、Kraken 精度與校驗均有回歸測試。
- 已完成四交易所 45 秒真實公開串流及 Bitfinex F1 20 秒驗證，未見 checksum 失敗或限流；長期表現仍取決於網路、同 IP 其他工具與交易所。
- 已在正式站完成 1H 真實歷史比對：3 chunks，補回 5206 個數值，後端缺 1414 個數值。新版待發布後在使用者原 Chrome 分頁驗收。
- 沿用既有 Sites；不新增、更改或部署任何 Railway 資源。保留 noindex。

更新：2026-09-27（Asia/Taipei）。依使用者核准的最終計畫實作，取代 USD v2／隔離舊快取方案。

## 已鎖定
- 後端 commit 4f80ef8a7145f6e5d97ae1c7f9b9f0b6fe683217；collection USD_3、Spot USD-3、index 3，dataset TRUSTED_COVERAGE_V2。
- 深度以 price×quantity 加總 USD notional；USD/USDT 1:1，可信覆蓋及逐邊 null，ALL4/累積先加總再算比值。
- 直接一次清除本站舊數量／USD v2／未知版深度快取；保留全域 gate、設定、密鑰。不碰 Railway 資料或設定。
- 瀏覽器採集 BTC/ETH/SOL，IndexedDB 250MB，Web Locks 單一分頁領導；僅缺資料才補。
- Railway 所有訪客共用 D1 閘門，每次至少間隔60秒，先持久化預算。僅封存且最新資料也超過15分鐘的歷史。無 Recent／定時 index／BFF K線輪詢。
- Binance BTC/ETH 完整bootstrap的trusted edges才可授權區間；Coinbase完整L2、Kraken精確WS加Grouped補缺、Bitfinex P0近/P2遠。正常coverage null不當成網路缺口。
- 新版Railway重複t整筆優先（含null）；409整輪重讀，gzip SHA與同版本cache；已刪chunk不再作為上游可用歷史供應。
- Binance Futures直連、30s即時聚合/1m REST加WS/5m15m由1m聚合，離線30s不補造。觀察1H/4H。
- 保留01–04配置；比值±0.7500預設、真值不截斷，02/04逐筆分母；深色840px圖表及放大指標；noindex公開原Sites。

## 執行進度
- [x] v3契約、全域gate、舊路徑410、D1一次清除、按缺口歷史API
- [x] 瀏覽器Worker收集、IndexedDB、領導分頁、直接K線
- [x] 圖表樣式、週期、比值與長條
- [x] 25項離線測試及TypeScript通過
- [x] 瀏覽器真實行情／IndexedDB、多分頁、重啟與桌面驗收；手機版依使用者最新要求暫不處理
- [x] v3真實歷史及正式Sites上線驗收

## 驗收範圍
trusted coverage、zero/null、單邊缺值、累積、資料老化、30s不造假、250MB淘汰、遷移重跑、401/429/409/404/5xx、SHA/304、並行/中斷60秒gate、旧客戶端/HEAD不觸發請求、匿名/noindex/秘密未洩漏。
本機UI QA先停用Railway連線，避免本機與正式站各自使用獨立gate；正式歷史驗收走共用站點gate。

## 9/27 桌面追加需求
- 滿版兩側8px、01自動延展，區塊6px間距、價格摘要緊縮。
- 頂列集中BTC/ETH/SOL、1H/4H、時間與連線狀態；移除大標題／橫幅，異常內容僅hover/focus提示。
- 02每家同時顯示USD金額及帶正負四位比值。
- 價格每秒由記憶體更新及BroadcastChannel傳遞，獨立於5秒快取保存與慢速歷史補齊；無新報價時不捏造價格。
- 25項測試、TypeScript及正式建置通過；Sites第2版已發布，正式歷史30筆chunk驗證通過。

## 發布紀錄
- 網址：https://marketdepth-observatory.magic-knoll-8651.chatgpt.site
- 版本2／commit 40a120f4f6e227bf0f35dcf21686cfff0e153544
- Deployment appgdep_6ab89381ec108191bfd55b090811e25c，succeeded。
- 正式站匿名HTML/noindex、v3 status、舊路徑410通過；health及index經共用gate成功，實際chunk解壓/SHA驗證後回傳30筆，complete=true。
- 桌面價格、1m/30s切換、4H切換、錯誤focus tooltip、歷史漸進載入已實測。手機版依要求暫不調整。
- 沒有新增、更改或部署Railway資源。
