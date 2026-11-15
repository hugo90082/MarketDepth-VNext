# MarketDepth VNext｜全階段重新審查（2026-11-15 UTC+8）

## 範圍與結論
重新讀原始完整規劃包 01–07、Phase0 review、Phase2 first results、A→C handoff、Phase7 cross-day acceptance、Phase5 Drive gate QA、main Master Log、GitHub 兩分支樹/關鍵實碼與真實離線驗收交付檔。這是規格/證據/關鍵程式碼審查，不是全 repo 逐行安全審計或重新執行全部測試；沒有主機 shell、真Drive、長測原報告或 C 最新成品。main c32dbd2c3632a66d25526112518ac0601c18a1e2、phase5-legacy-import-qa da2c4455cb7c5fff7742f30f0eabc9b80706aa98，兩分支已分岔（後者 ahead6/behind8），CI43664610819及43664462430 success；私人歷史 opt-in 測試由本機實跑，不能以CI替代。不得把已通過的模擬/離線驗收視為正式上線。
實際重新hash新/舊原始gzip、長測artifact14120388865及8個Phase5 ZIP，與既有記錄一致。原始資料未修改。

## 新的歷史匯出版本稽核
11/13匯出（11/12T16:47:32Z）SHA b9397b4f92b3c84d5d2271a411f47afe3eda0d24d3800e2f9176ec18c49f211e；11/15匯出（11/14T16:59:33Z）SHA 88097e060d0c4cdd689971641e14b7a41c0857bcf2104b15ba119fe22d65e79b。逐行 JSON canonical sorted-key SHA 比對，以(kind,t,asset)對齊（depth為整個矩陣）。舊65907 depth+231129 candles無任何舊有key消失；新增加2892 depth、8676 candles，231129既有candles全部內容相同；depth65514完全相同、393有差異。360筆只finalVersion改變（11/08），33筆（11/13 00:15–00:47 UTC+8）source由browser變railway，a/captured/d/finalVersion/quality/ratios/source改變，其中17筆issues亦變。33格共3960深度cells：1114相同、2596非NULL值變化、250 NULL→value、0 value→NULL。兩份匯出均保留，最新版仍是已確立的正式候選來源，不能宣稱舊快照位元相同或因果可用，不擅自將舊值補回。此為同一歷史來源不同匯出版本稽核，不恢復使用者取消的跨收集器行情數值比較。

## 需要補齊的驗收清單（優先順序非使用者新增批准）
R1 正式版本整合：main 尚無phase5 sealed/import/gate；cmd/marketdepth/main.go仍mock-only，cmd/marketdepth-staging/main.go是明示isolated_staging/production_ready=false，Drive namespace固定staging，新增--drive-lease-dir亦未部署。先隔離整合分支，合併後全tag/契約/前端驗收，建置固定artifact；正式namespace與遷移方式必須明確、不能把測試資料無聲轉正或將舊版writer切換到共享日檔。
R2 真歷史原始證據：原規劃06要求原始gzip存Drive legacy/及非秘密設定備份。現行v66_import_linux.go僅55個歷史日pair；import_inventory.go/importArchiveKey僅允許historical/active/catalog/loss，未支援legacy/config。需設計獨立原始證據歸檔或明確擴充白名單與驗證，兩份原始gzip+hash、來源稽核/版本差異證據、最終尾端匯出安全保存；不把1.45GB離線帳本或全量未壓縮日庫常駐512MiB VM。不得上傳秘密。正式上傳另批准。
R3 切點與混合日：目前候選僅至11/15 00:59，實際切換可能更晚。11/14及11/15共22500列held，55日plan硬編日期；原五代/840本機尾端及第九次新run必須保護。最後舊AWS/Railway/Sites未匯出尾端確認、再做正式尾端匯出與稽核，逐kind/t/asset/venue決定canonical並保存各source及衝突記錄、F10不合成、未知availability保留；legacyproof ValidateV66限單來源整曆日r1，InspectRecovery拒絕同日legacy與其他revision/active/loss共存，混合日與封存後修復/新revision的端到端能力必須補足或提出明確替代契約，不可抹除來源/覆寫封存/用测试日冒充正式日。
R4 真Drive：external fence目前callback、無正式發布CLI，flock只本機協作程序，drive.file只可見範圍；必須實際writer停止、所有roots/namespace/quota/原ID與hash、排他證據及新鮮placement、正式cutover、批准plan SHA。真Drive adapter全批發布/中斷重試/真復原及混合live/legacy catalog+API需驗收。禁止用合成計畫。
R5 前端：仍未取得C最新source/commit/build/proxy inventory/驗收。保留研究頁四所、監控六所含OKX/Bybit、監控直連與必要Go白名單relay、圖表/指標/策略、IndexedDB無損整數與revision/cache/409、舊資料標記、桌機/手機、登入及匯出。無正式靜態站/公開TLS部署證據。不得停止舊站。
R6 正式環境與長測：使用者報告第九次啟動，尚未收到實際first_target/PID/start/end/report，不推算結束時間。驗18流到期grid、實際非NULL、status、observed/trusted逐側（30min Binance BTC/ETH已有觀測≠完整可信750限制）、跨日seal、同process OAuth grant2+、長匯出、原始資源/無OOM/重啟、fresh recovery/未備份尾端。原CR-09至少兩次日界及一完整曆日仍是未滿足門檻，24h縮短不自動免除；另審是否補驗或明確接受剩餘風險，不自行延長。新舊數值對照已取消。
R7 正式容量/運維：原規劃04使用者接受1GB硬上限下必要時清最舊未備份完整日並記tombstone；隔離長測allow-capacity-loss=false安全限制不可混同正式政策。正式設定確認且保護active/OS/舊服務；實測日庫/讀取cache/Drive失效/清理/復原、31日單次串流及真前端同時負載。正式systemd/健康/日誌輪替、HTTPS/renewal/僅必要端口、密碼/secret scan/代理白名單、AWS方案餘額/遷移、rollback/舊資料最終備份仍須驗收。未新增資源。
R8 文件治理：Phase0表格/原07仍留舊對照字樣但最新修訂優先；HANDOFF_A早期狀態未更新、Master Log累積過程中有重複API紀錄，後續應由一份當前release checklist控制，歷史不刪。早先Gemini匯出任務已取消，repo仍有已建立的gemini-source-export workflow（不代表要繼續任務）；不再觸發或輸出資料，是否移除另議。此次只審核及記錄，不變更程式或運行。

## 推進建議
長測等待期間可先離線整合正式候選、補原始證據保存/混合日機制、正式發布命令及前端整合清單；不再重複已通過的55日全量映射。取得長測結果後以實際證據確定cutover與尾端，再真實唯讀審核，正式Drive發布另批准，完成端到端驗收後才批准切換。沒有操作真Drive、主機、舊服務或正式發布。