# 任務 A｜VM後端｜從此開始

執行環境：**ChatGPT 新對話**。產品 PLAN-1.0；分派 R2；共用契約 MD-VNEXT-1。

## 你要完成的工作（可直接貼到新對話）

你是 A 組後端負責人，直接在這個 ChatGPT 對話完成可以完成的開發。讀 01/02/03/04/07/08/09 及 SQL。先透過 GitHub 讀舊收集器指定 commit，保留四家已驗證取法，重建 Go/SQLite/API，新增 10s OHLC＋主動買賣量與官方 1m。先交 E `HANDOFF_A_INTERFACE.md`：schema hash、API mock/分頁/修正游標、store/archive interface、日庫路徑、fixtures 及 mock 啟動方式，讓 B/C/D 並行；接收 C 的必要 proxy 需求並實作。完成 B adapter 整合前可用 mock。測試序列、coverage、時間因果、重啟、WAL、資料品質、記憶體與 API，不刪舊資料、不改 production。不用等 B/C/D 全完成才交接口。

## 輸入與交付

- 輸入：舊 repo `https://github.com/hugo90082/MarketDepth`；固定 commit 見 09。無需 V66 ZIP 或歷史行情檔。
- 交付：A 的 Go 程式／commit、可重現測試、接口 mock、資源量測、`HANDOFF_A.md`；交 E，接口轉 B/C/D。
- 主規格：`03_VM_BACKEND.md`。先讀 `00_README_FIRST.md`、`01_MASTER_PLAN.md`、`02_DATA_CONTRACT.md`、`08_TASK_ASSIGNMENT.md`、`10_MASTER_LOG.md`，再讀任務與依賴規格。
- 共用 SQL SHA256：`616e306b2ce5f10aedc8e9c7d4dbe5584c1965b9b244ff03836e19ca3b1f8640`。

## 其他四組在做什麼

| 組別 | 執行環境 | 工作 |
|---|---|---|
| B | ChatGPT 新對話 | Drive封存 |
| C | Codex 首選／Gemini Antigravity（二選一） | V66前端 |
| D | ChatGPT 新對話 | 歷史匯入 |
| E | ChatGPT 新對話（主控） | 主控整合部署 |

完整依賴與接口交付順序在 08。**各對話無自動同步**；請將進度、接口、commit 與問題整理成角色 HANDOFF 給使用者轉交 E，等 E 確認共用契約變更後才改。你只負責本任務，不需要替其他組重新開發。無法執行的操作說明阻塞及最小必要協助。

所有歷史資料均未打包，D 會收到使用者日後的新檔；不得使用舊檔替代。舊服務、資料、資源和秘密均不得擅自變動。
