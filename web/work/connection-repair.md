# 行情與雙頁修正紀錄

基準：v30 / 702aedf2bd128fa90b40023b4280138dcbab24eb。僅更新現有 MarketDepth；Railway 維持原狀。

- [x] Binance 初始化、即時恢復、世代檢查、快照覆蓋邊界。
- [x] 核心取樣準備、來源狀態、Coinbase 支援檢查。
- [x] 共用標題列導覽、樣式隔離、圓形燈號、自然表格高度。
- [x] 本機插件原地更新至 1.4.1，保留插件 ID 與儲存。
- [x] 回歸、型別、建置、桌面／手機／雙分頁驗收。
- [ ] 發布與回復點紀錄。

已重現：冷啟動三個 Binance 快照排隊使 ETH/SOL 超時；已關閉串流可被晚到事件恢復；全域按鈕 min-height 導致完整度燈號變形。

補充缺值原因：研究累積深度使用嚴格區間加總，外側未知區間讓已取得掛單也消失。V2 品質資訊允許只加總已取得的區間；未知值仍保持 null，缺少品質資訊或 V1 的舊資料沿用原規則。

驗證：網站 111 項測試、npm run check、npm run build 通過；插件 81 項測試與型別檢查通過。回歸涵蓋提前初始化、重用快照、序號缺口立即恢復、舊連線晚到訊息、Coinbase 無交易對與個別訂閱隔離、Bybit 備援順序、Bitfinex P2 預備連線、Kraken 動態分組、OKX 部分覆蓋與 Retry-After。

本機瀏覽器驗證：六家核心来源取得資料，研究 Binance 累積值顯示部分覆蓋；主控研究頁關閉後監控頁接手；兩頁導覽位於標題列；燈號 10×10px、圓角 50%；表格 scrollHeight 等於 clientHeight；手機研究頁寬度與 scrollWidth 皆 375px；操作選單在監控容器內以 fixed 顯示。Railway 在本機驗證期間停用。

插件：同一路徑 dist，ID figfigleplkknfcdiogmpcbipmabgdaf；31 個共同執行檔中只有 manifest.json 與 lib/public-manifest.js 改變，29 個不變。備份位於 work/local-extension-backup（不加入網站來源）。不存取或修改 Chrome 插件儲存；使用者仍需手動重新載入，再核對瀏覽器中的版本與既有規則、紀錄。

回復：保留 v30，版本 ID appgprj_6ab6a1b2194081918e210013c8cc7320~appgver_a05dd293139c8191a1d7dfca5f194893。發布結果另外記錄，不改動 Railway 收集器。
