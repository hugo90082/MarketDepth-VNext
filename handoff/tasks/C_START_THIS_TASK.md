# 任務 C｜V66前端｜從此開始

執行環境：**Codex 首選／Gemini Antigravity（二選一）**。產品 PLAN-1.0；分派 R2；共用契約 MD-VNEXT-1。

## 你要完成的工作（可直接貼到新對話）

你是 C 組，負責 V66 前端實作。解壓本包附的 `inputs/marketdepth-v66-source.zip`，先讀 01/02/03/05/07/08/09 與 SQL，核對 SHA256、原版 npm ci/test/check/build、列出基線缺陷。保留研究頁、所有指標/策略、匯出、手機、monitor 六所瀏覽器直連、CoinGlass 等必要功能；不要變更原監控收集行為。移除不必要的 Sites/Railway D1 歷史工作，對接 A 的 `/api/v2` mock；前端 IndexedDB 快取、Web Worker、ALL4 至少兩所、10s/1m，原始資料不依賴舊 Sites。先交 E/A `HANDOFF_C_PROXY.md`：原 Worker 中必要 route、請求/回應範例與安全要求，Go 端由 A 實作。最終提供可重現靜態 build 與桌機/手機/瀏覽器/匯出測試，VM 不跑 Node/Miniflare。不要修改正式 Sites、不要自建另一套後端，不把 secrets 或行情檔放入 Git。

## 輸入與交付

- 輸入：本包內已附 V66 原始碼 ZIP（1.14MB）；A API mock 後續由 E 轉交。
- 交付：前端 source commit、靜態 build、測試報告、功能對照、proxy 需求、`HANDOFF_C.md` 交 E/A。
- 主規格：`05_FRONTEND_V66.md`。先讀 `00_README_FIRST.md`、`01_MASTER_PLAN.md`、`02_DATA_CONTRACT.md`、`08_TASK_ASSIGNMENT.md`、`10_MASTER_LOG.md`，再讀任務與依賴規格。
- 共用 SQL SHA256：`616e306b2ce5f10aedc8e9c7d4dbe5584c1965b9b244ff03836e19ca3b1f8640`。

## 其他四組在做什麼

| 組別 | 執行環境 | 工作 |
|---|---|---|
| A | ChatGPT 新對話 | VM後端 |
| B | ChatGPT 新對話 | Drive封存 |
| D | ChatGPT 新對話 | 歷史匯入 |
| E | ChatGPT 新對話（主控） | 主控整合部署 |

完整依賴與接口交付順序在 08。**各對話無自動同步**；請將進度、接口、commit 與問題整理成角色 HANDOFF 給使用者轉交 E，等 E 確認共用契約變更後才改。你只負責本任務，不需要替其他組重新開發。無法執行的操作說明阻塞及最小必要協助。

所有歷史資料均未打包，D 會收到使用者日後的新檔；不得使用舊檔替代。舊服務、資料、資源和秘密均不得擅自變動。
