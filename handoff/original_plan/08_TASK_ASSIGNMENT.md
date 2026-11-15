# 08｜分派工作與新對話提示詞

所有工作對話共用本包版本。**先指定負責範圍，不能各自重新規劃產品。** 允許提出工程改善；若影響共同資料契約，先向主控提出偏差，不直接更改。每個任務交付中文說明、commit SHA、測試結果、未解問題；主控更新 `10_MASTER_LOG.md`。

## 分派表

| 任務 | 建議對話 | 輸入 | 輸出及依賴 |
|---|---|---|---|
| A：VM 收集器／SQLite／API | 新 GPT/Codex 後端對話 | 本包、MarketDepth 舊 repo 指定 commit | Go 新版、SQL/API fixtures、測試；對接 B、C |
| B：Google Drive／封存 | 新 GPT/Codex 儲存對話 | 本包、A 的 store 介面 | archive adapter、catalog、OAuth 說明、容量及還原測試；先 mock 再實帳號 |
| C：V66 前端移植 | Codex 或 Gemini Antigravity | 本包、V66 source ZIP | React 靜態 build、API adapter、monitor proxy 契約、功能測試；先 mock A |
| D：歷史匯入／回測格式 | 新研究／資料對話 | 本包、原始歷史 gzip | 每日 SQLite、匯入程式、逐列 audit、匯出格式；不需要改網站 |
| E：整合與部署／QA | 主控或新部署對話 | A/B/C/D 交付物 | 測試 VM、HTTPS、Drive 真帳號、壓測、切換與回復 |

## 任務 A 提示詞（直接貼）

> 你負責 MarketDepth VNext 任務 A：重建 Go VM 收集器、SQLite storage、資料 API。先讀交接包 00/01/02/03/07/09 與 contract/schema.sql，核對舊 repo 指定 commit，沿用已驗證的四家交易所深度取得及品質政策；固定 60 秒、五區、BTC/ETH/SOL。新增 Binance USDT-M 三商品 10 秒 OHLC＋主動買賣量/金額，另存官方 1 分 K。資料因果安全、null≠0，不保存衍生欄位，支援日 SQLite/快照/增量 API/串流匯出。請先寫實作計畫及介面，確認契約無矛盾再實作測試。與 B 對接 archive，與 C 發布 API mock。不得修改 production、刪資料、購買資源或實際下單。最終交付程式、測試、commit、建置與資源量測說明，更新任務紀錄供主控合併。

## 任務 B 提示詞

> 你負責 MarketDepth VNext 任務 B：Google Drive 私有長期封存及恢復。讀 00/01/02/04/07/09 與 schema.sql。依照已確認政策，每小時 active 安全快照、每天日檔封存，驗證 SHA256 及 manifest 後清除本地，使用戶未來搬 GCP 時可直接讀同一 Drive。1GB VM 硬上限，故障未上傳亦逐天刪最舊，留永久缺口紀錄；不得自動刪正式 Drive 歷史。先做 mock adapter、重試/去重/還原/容量測試；OAuth 最小權限、需要使用者一次親自授權，不要索取 token 貼到對話。與 A 確認 store interface；不能直接掛 Drive 寫 SQLite。未經同意不操作正式帳號或上線。交付程式、測試、commit、安全授權與恢復步驟。

## 任務 C 提示詞

> 你負責 MarketDepth VNext 任務 C：移植 V66 網站到 VM 上的 Go HTTP API。先讀本包 00/01/02/03/05/07/09，解壓附上的 marketdepth-v66-source.zip，先完整讀原始碼、跑基線測試，再進行修改。保留所有研究圖表、指標、策略、匯出和監控功能；研究頁改由正式 VM 資料供應（60s spot、10s futures、官方 1m），ALL4 至少兩家有效配對、前端計算，IndexedDB 只做快取，Web Worker 背景運算。`/monitor` 不改交易所直連行為，OKX/Bybit 保留，盤點並向 A 提出必要中繼 API。移除舊 Railway/Sites D1 歷史工作及 gate，不新增本機服務依賴。用 mock v2 API 先測，建立靜態 build、桌機/手機/登入/匯出/舊新資料相容測試。不得修改或停用正式 Sites。交付 commit、build、功能對照及測試結果。

## 任務 D 提示詞

> 你負責 MarketDepth VNext 任務 D：歷史資料匯入與回測匯出。讀 00/01/02/06/09、schema.sql，使用附上的 marketdepth-local-history-2026-11-12T16-47-32-103Z.jsonl.gz 真實資料，先驗 SHA256。串流匯入每日 SQLite，保存舊資料 source、品質、時間及 null/0，保留原始 gzip，不清洗/補造 10 秒資料；逐日逐欄核對、記錄缺格與舊時間語意，避免把後來取得的資訊當即時可用。產出程式、資料庫清單、audit、manifest、匯出方式。不要覆寫原始檔或正式 AWS/Drive；實際上傳需主控批准。任何與舊版數量不符的情況先查清楚並回報。

## 任務 E 提示詞（A/B/C/D 完成才開始）

> 你負責 MarketDepth VNext 整合部署。先讀全部交接文件、各任務 commit/測試紀錄及 MASTER LOG。核對共同契約並跑整合測試；使用現有 Sydney Lightsail Nano 512MB，隔離資料及服務、保留舊 AWS/Railway/Sites；先測 Google Drive 授權、還原及 HTTPS，再完成 24–48h 資料與資源壓測、至少跨兩日界的封存測試。確認匿名、密鑰及磁碟保護。真實切換需使用者批准；先備份未匯出的舊歷史，制定回復方式。未經同意不新增付費服務、不停舊服務、不下單。交付 QA、部署命令、版本、資源統計、待確認事項，更新總 Log。

## 工作進度回報格式

```text
任務／分支／commit：
狀態：未開始 | 開發中 | 測試通過（附證據） | 阻塞 | 完成
已完成：
測試命令及結果（真實／mock／模擬分開）：
資料契約偏差（無則寫無）：
待主控決定或使用者授權：
部署與資料變動（無則寫無）：
交付檔案／位置／SHA256：
下一步：
```
