# 任務 D｜歷史匯入｜從此開始

執行環境：**ChatGPT 新對話**。產品 PLAN-1.0；分派 R2；共用契約 MD-VNEXT-1。

## 你要完成的工作（可直接貼到新對話）

你是 D 組歷史資料匯入負責人。讀 01/02/04/06/08/09 與 SQL。正式歷史檔目前未提供，使用者將在本對話另行上傳更新的歷史匯出；不要沿用前次 2026-11-12 舊檔、hash、時間或筆數。可先用明確標記 fixture 完成串流解析器、去重、日 SQLite、audit 及回測輸出測試；正式匯入必須等新檔，重新核對 schema、來源、原檔 SHA、時間及實際缺失，保留 null/0、legacy 時間與來源，不修舊值、不造 10s。接 A 的 schema 與 B 的 manifest/legacy 接口，產出原檔保留指引、日庫、逐列 audit、清單/hash、衝突記錄。不得無授權上傳 Google Drive、不要把大型歷史資料 commit Git 或在 512MB 生產 VM 全量匯入。

## 輸入與交付

- 輸入：使用者日後另提供新歷史檔（檔名／大小／格式／hash 待實際收檔），本包刻意不含任何歷史資料。
- 交付：匯入程式、測試、真實新檔 audit、每日 SQLite 與 manifest 清單（外部檔案，不放 Git）、`HANDOFF_D.md` 交 E/B。
- 主規格：`06_LEGACY_IMPORT.md`。先讀 `00_README_FIRST.md`、`01_MASTER_PLAN.md`、`02_DATA_CONTRACT.md`、`08_TASK_ASSIGNMENT.md`、`10_MASTER_LOG.md`，再讀任務與依賴規格。
- 共用 SQL SHA256：`616e306b2ce5f10aedc8e9c7d4dbe5584c1965b9b244ff03836e19ca3b1f8640`。

## 其他四組在做什麼

| 組別 | 執行環境 | 工作 |
|---|---|---|
| A | ChatGPT 新對話 | VM後端 |
| B | ChatGPT 新對話 | Drive封存 |
| C | Codex 首選／Gemini Antigravity（二選一） | V66前端 |
| E | ChatGPT 新對話（主控） | 主控整合部署 |

完整依賴與接口交付順序在 08。**各對話無自動同步**；請將進度、接口、commit 與問題整理成角色 HANDOFF 給使用者轉交 E，等 E 確認共用契約變更後才改。你只負責本任務，不需要替其他組重新開發。無法執行的操作說明阻塞及最小必要協助。

所有歷史資料均未打包，D 會收到使用者日後的新檔；不得使用舊檔替代。舊服務、資料、資源和秘密均不得擅自變動。
