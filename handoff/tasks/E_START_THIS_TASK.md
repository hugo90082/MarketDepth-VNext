# 任務 E｜主控整合部署｜從此開始

執行環境：**ChatGPT 新對話（主控）**。產品 PLAN-1.0；分派 R2；共用契約 MD-VNEXT-1。

## 你要完成的工作（可直接貼到新對話）

你是 E 組唯一主控及整合部署負責人。先讀全部共用文件、SQL、08/10。現在可先協調 A–D 工作、建立/維護權威 Master Log、收接口與變更申請；不可在 A–D 尚未完成時正式切換。確認共同 scaffold、分支、接口傳遞（A mock 給 B/C/D；C proxy 需求給 A；B manifest 給 D；D 真實新檔 audit 給 B/E）。必要時在本 ChatGPT 對話利用 AWS/GitHub 連接工具與容器進行整合測試；缺少 SSH 權限則提供最小指令給使用者，不謊稱可直接控制 VM。A–D 交付後整合、測試 Google OAuth、Drive restore、TLS、登入、安全、24–48h 資源及資料測試與跨兩個日界，確認新歷史與未匯出尾端資料。舊 AWS/Railway/Sites 保持原狀，正式切換須使用者批准，不新增付費資源、不下單。只在證據齊備後接受交付。

## 輸入與交付

- 輸入：A/B/C/D 後續交付的 HANDOFF、commit/patch/build/audit、必要實際日檔；開始時不需要歷史原檔。
- 交付：更新 `10_MASTER_LOG.md`、整合 commit、可回復部署命令、QA 報告、資源證據、`HANDOFF_E.md`；交使用者。
- 主規格：`07_DEPLOY_QA.md`。先讀 `00_README_FIRST.md`、`01_MASTER_PLAN.md`、`02_DATA_CONTRACT.md`、`08_TASK_ASSIGNMENT.md`、`10_MASTER_LOG.md`，再讀任務與依賴規格。
- 共用 SQL SHA256：`616e306b2ce5f10aedc8e9c7d4dbe5584c1965b9b244ff03836e19ca3b1f8640`。

## 其他四組在做什麼

| 組別 | 執行環境 | 工作 |
|---|---|---|
| A | ChatGPT 新對話 | VM後端 |
| B | ChatGPT 新對話 | Drive封存 |
| C | Codex 首選／Gemini Antigravity（二選一） | V66前端 |
| D | ChatGPT 新對話 | 歷史匯入 |

完整依賴與接口交付順序在 08。**各對話無自動同步**；請將進度、接口、commit 與問題整理成角色 HANDOFF 給使用者轉交 E，等 E 確認共用契約變更後才改。你只負責本任務，不需要替其他組重新開發。無法執行的操作說明阻塞及最小必要協助。

所有歷史資料均未打包，D 會收到使用者日後的新檔；不得使用舊檔替代。舊服務、資料、資源和秘密均不得擅自變動。
