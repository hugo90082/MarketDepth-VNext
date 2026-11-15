# MarketDepth VNext｜唯一總進度紀錄

版本：PLAN-1.0／分派 R2；2026-11-13（UTC+8）。本檔由主控對話維護，工作者交付進度回報，由主控合併。不需要每個對話自己建立不同 Master 規格。

## 已完成規劃

- [x] 使用者確認四家現貨交易所、60s、五區；不新增 OKX/Bybit；監控頁直連不改。
- [x] 使用者確認 Binance USDⓈ-M 三商品 10s OHLC＋成交量／主動買賣差；另存官方 1m。
- [x] 使用者確認 VM 架站、HTTPS＋密碼、Drive 每小時快照＋每日封存、1GB 容量強制刪最舊、全部舊資料匯入。
- [x] 原始資料保存、ALL4 至少兩家、瀏覽器負責衍生計算、IndexedDB 快取。
- [x] V66 source SHA256、372 檔及關鍵模組盤點；前次舊歷史 gzip 已稽核（僅背景，正式 D 等待新檔）。
- [x] 整理架構、DDL 草案、API 契約、分工、部署驗收、風險。

## 實作進度（尚未開始）

| 任務 | 狀態 | commit／證據 |
|---|---|---|
| A Go/SQLite/collector/API（ChatGPT） | 未開始 | — |
| B Drive/archive/retention（ChatGPT） | 未開始 | — |
| C V66 前端（Codex 或反重力） | 未開始 | — |
| D 歷史匯入（ChatGPT） | 等待使用者提供新檔；可先做工具 | — |
| E 主控、整合、HTTPS、部署（ChatGPT） | 可開始協調；部署等待 A–D | — |

## 待驗證與阻塞

- 使用者 Google Drive OAuth 一次授權、專用資料夾與實際空間；token refresh/還原未測。
- HTTPS 網域或 IP 憑證方式、憑證自動續期未定案；不擅自購買域名。
- 新收集器 10s/1m 與 Go/SQLite/網站並行的 512MB 真實負載及網路費用需壓測。
- V66 原版完整 npm 測試、build 未執行；監控頁 proxy/extension 在新 origin 需測。
- 正式新歷史檔尚未提供，匯入尚未執行；切換前確認歷史匯出以外的 AWS/Railway/Sites 尾端資料。
- DDL/JSON 共同契約的實作與測試尚未完成；SQL 草案已在生成交接時做基本建表語法檢查（不代表功能驗收）。

## 本輪無生產變更

沒有修改正式 GitHub、AWS、Railway、Sites、Google Drive 或歷史資料；沒有啟用交易機。僅產出本規劃包。

## 變更紀錄

- 2026-11-13 PLAN-1.0：整合最終決策，淘汰 Railway/Sites/本地常駐服務架構；加入 Drive 封存、原始資料契約、分派、驗收與來源清單。

- 2026-11-13 分派 R2：拆成五個獨立包，A/B/D/E 優先 ChatGPT，C 交 Codex 或反重力；D 以使用者日後新匯出為準；不附任何歷史資料。共用資料契約與架構不變。
