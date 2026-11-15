# MarketDepth VNext｜共同交接入口

產品規劃：PLAN-1.0；分派修訂：R2；2026-11-13（Asia/Taipei）。狀態：規劃已確認，未開發／部署新版。

**先閱讀各包 `00_START_THIS_TASK.md`。** 五包共用這一版正式架構與 `MD-VNEXT-1`，不是五套不同規格。`08_TASK_ASSIGNMENT.md` 定義所有組責任、先後順序、版本治理及交付。主控 E 是唯一總進度維護者；對話互不自動同步。

目標：單台 VM Go 收集器＋每日 SQLite＋V66 靜態 HTTPS 網站，Google Drive 長期保存；瀏覽器做 ALL4/指標/圖表/研究計算，電腦及手機可查看，使用者本地只匯出與回測。無 Sites、Railway 或本地常駐服務依賴（舊服務仍保留至驗收）。固定四所現貨 60 秒、五區、三商品；Binance USDT-M 10 秒 OHLC＋主動成交量/金額、官方 1 分 K；ALL4 至少兩所；monitor 直連不改；1GB 強制清除；Drive 每小時快照、每日封存。

| 文件 | 用途 |
|---|---|
| 01_MASTER_PLAN.md | 使用者確認的產品規格與架構 |
| 02_DATA_CONTRACT.md / contract/schema.sql | 唯一共同資料契約、時間與 SQL |
| 03_VM_BACKEND.md | A 後端規格 |
| 04_DRIVE_STORAGE.md | B 封存、容量、OAuth |
| 05_FRONTEND_V66.md | C V66 移植 |
| 06_LEGACY_IMPORT.md | D 新歷史檔匯入、驗收 |
| 07_DEPLOY_QA.md | E 整合、部署、安全 |
| 08_TASK_ASSIGNMENT.md | 全組分工、依賴及跨對話回報 |
| 09_SOURCE_INVENTORY.md | 原始碼、舊基線、查證來源 |
| 10_MASTER_LOG.md | 初始共用 log，由 E 維護權威版本 |
| SHA256SUMS.txt | 本包文件校驗 |

- C 包已包含 V66 原始碼 ZIP（不是歷史行情資料）；其他組不需 V66 ZIP，A 透過 GitHub 查閱舊收集器。
- D 的正式歷史檔由使用者之後另行提供，檔名、hash、統計以實際新檔為準。五包都不包含歷史行情、日庫或 Sites 部署封包；不使用舊檔替代新檔。
- 禁止擅改原產品契約、正式服務、購買資源、刪舊資料或實際下單。不可使用未來資料或把 null 填 0。未實測不宣稱通過。需要變更先交 E。
