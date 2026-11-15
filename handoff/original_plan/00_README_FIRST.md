# MarketDepth VNext｜總交接入口

版本：PLAN-1.0　日期：2026-11-13（Asia/Taipei）　狀態：**規劃已確認，尚未實作／部署**

## 1. 專案目標

將現有 AWS 收集器與 Codex Sites V66 網站整合為獨立、輕量、可跨裝置使用的私有市場研究站。VM 24 小時收集；Google Drive 是正式長期歷史檔案庫；使用者以電腦／手機瀏覽 HTTPS 網站，定期匯出資料至本地回測。未來搬 GCP 主要搬程式、設定、尚未封存資料，已封存歷史仍在同一個 Drive。

**本包是唯一有效的新規劃。** 舊 Railway 的 500MB 限制、15 分鐘 gzip chunk、12 小時分包、Recent 16 分鐘、全域 2 req/s、Sites D1 雲端同步、本地架站／SSH tunnel 主方案、Webhook、ALL6、秒級單點價格等均不再是新版需求。可以參考舊程式，但不得未經確認重新加入這些機制。

## 2. 文件閱讀／分派

| 檔案 | 負責工作 |
|---|---|
| `01_MASTER_PLAN.md` | 主控對話：決策、架構、範圍、狀態 |
| `02_DATA_CONTRACT.md` | 資料契約、收集、因果時間、回測 |
| `03_VM_BACKEND.md` | Go、SQLite、資料 API、資源控制 |
| `04_DRIVE_STORAGE.md` | Drive 授權、快照、封存、容量、還原 |
| `05_FRONTEND_V66.md` | Codex／Gemini 前端移植、瀏覽器快取、監控 |
| `06_LEGACY_IMPORT.md` | 舊資料稽核、匯入、對照測試 |
| `07_DEPLOY_QA.md` | AWS、HTTPS、安全、驗收、切換與遷移 |
| `08_TASK_ASSIGNMENT.md` | 任務依賴、可直接貼給新對話的提示詞 |
| `09_SOURCE_INVENTORY.md` | 原始資料、雜湊、程式庫、查證來源 |
| `10_MASTER_LOG.md` | 唯一總進度紀錄（各任務完成時回報更新） |
| `contract/schema.sql` | 供前後端共同使用的初版 SQLite DDL 契約 |

## 3. 開工先後

1. 主控凍結 `02_DATA_CONTRACT.md` 與 `contract/schema.sql`；若任何工作者認為有矛盾，先回報，不自行改契約。
2. 後端（A）與 Drive（B）可並行在 mock／測試資料夾開發；前端（C）依契約及 mock 開始移植；歷史匯入（D）獨立跑測試。
3. 整合（E）在隔離資料路徑與端口驗證，既有 AWS／Railway／Sites 不動；完成壓力測試、Drive 還原、登入、安全與回測測試後，才由使用者核准切換。
4. 主控收集各任務 commit、測試報告、偏差與阻塞，更新同一份 `10_MASTER_LOG.md`。不要讓各對話自行決定新的研究規則。

## 4. 新對話需提供的檔案

- 本交接 ZIP（每個對話都上傳；或由主控貼該任務文件）。
- 前端 C：`marketdepth-v66-source.zip`（1.14MB，372 個檔案）。原始碼 ZIP 已備份到私人 GitHub，工具未必能讀二進位，因此直接上傳 ZIP。
- 歷史 D：`marketdepth-local-history-2026-11-12T16-47-32-103Z.jsonl.gz`（158,980,753 bytes）。必須使用真實原始檔，不能用模擬資料替代。
- 後端 A：現有 GitHub `hugo90082/MarketDepth` 的指定 commit，詳見來源清單。
- 完整資料檔、V66 部署封包、密鑰均**沒有**放進規劃 ZIP；沒有任何 Google token／交易 API key／網站密碼。

## 5. 共通禁令

- 未經使用者同意不新增付費資源、不更動正式服務、不刪除舊資料、不啟用真實下單。
- 現貨固定四家、60 秒、五個獨立區間；合約固定 Binance USDT-M 三商品、10 秒 OHLC 與主動成交量，另存官方 1 分 K。
- 任何研究只可使用決策當時已取得的資訊；缺失不能補 0、補前值或用未來資料假裝有效。
- 測試、容量模擬、實際生產驗證必須分開敘述；沒有跑測試不得宣稱通過。
