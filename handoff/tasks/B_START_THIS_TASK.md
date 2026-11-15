# 任務 B｜Drive封存｜從此開始

執行環境：**ChatGPT 新對話**。產品 PLAN-1.0；分派 R2；共用契約 MD-VNEXT-1。

## 你要完成的工作（可直接貼到新對話）

你是 B 組 Drive 封存負責人。讀 01/02/03/04/07/08/09 與 SQL。先用 mock 做 Drive archive adapter、catalog、快照/manifest、SHA256、恢復、1GB 強制刪最舊與缺口 ledger。A 提供 store/archive 介面後對接同一 Go binary；不要另外建正式常駐 Python/Node 服務。提供 D 可用的 legacy 歸檔入口與 manifest 格式，交 `HANDOFF_B_ARCHIVE.md` 給 E/A/D。OAuth 使用者親自授權，提供可執行步驟，不索取 secrets、不在聊天貼 token，不使用測試模式七天權杖作長期方案。可用 mock 先驗收，真帳號測試需批准，正式 Drive 上傳由 E 協調。

## 輸入與交付

- 輸入：A 的介面交付尚待取得；可先用 mock。無歷史行情檔，無需 V66 ZIP。
- 交付：archive Go adapter、catalog/manifest、容量與還原測試、OAuth 安全文件、commit、`HANDOFF_B.md` 交 E/A；匯入接口交 D。
- 主規格：`04_DRIVE_STORAGE.md`。先讀 `00_README_FIRST.md`、`01_MASTER_PLAN.md`、`02_DATA_CONTRACT.md`、`08_TASK_ASSIGNMENT.md`、`10_MASTER_LOG.md`，再讀任務與依賴規格。
- 共用 SQL SHA256：`616e306b2ce5f10aedc8e9c7d4dbe5584c1965b9b244ff03836e19ca3b1f8640`。

## 其他四組在做什麼

| 組別 | 執行環境 | 工作 |
|---|---|---|
| A | ChatGPT 新對話 | VM後端 |
| C | Codex 首選／Gemini Antigravity（二選一） | V66前端 |
| D | ChatGPT 新對話 | 歷史匯入 |
| E | ChatGPT 新對話（主控） | 主控整合部署 |

完整依賴與接口交付順序在 08。**各對話無自動同步**；請將進度、接口、commit 與問題整理成角色 HANDOFF 給使用者轉交 E，等 E 確認共用契約變更後才改。你只負責本任務，不需要替其他組重新開發。無法執行的操作說明阻塞及最小必要協助。

所有歷史資料均未打包，D 會收到使用者日後的新檔；不得使用舊檔替代。舊服務、資料、資源和秘密均不得擅自變動。
