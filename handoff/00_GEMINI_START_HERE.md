# MarketDepth VNext｜Gemini 完整交接入口（2026-11-15 UTC+8）

## 先讀這份
使用者決定將專案轉交 Gemini，所有可取得的程式及規格保留於私有 GitHub，其他交接資料另附 ZIP。不附任何正式歷史行情資料、真實日庫、來源帳本、OAuth token、API key、登入密碼或 SSH 私鑰。交接不是正式發布或資源變更批准。

**最新使用者更正：Railway 已有舊版收集器持續運行，AWS 不需要另外維持一套舊版收集器。不要再將 AWS 新舊雙跑、保留多餘舊 AWS 服務或新購主機當作必要條件。** Railway 正常狀態仍須實際核對；優先用原 AWS 512 MiB 主機單跑 VNext，若單跑實測不足再評估升級。不要讓重複架構、未必要的保留或繁複驗收阻礙完成產品。使用者這次僅批准交接資料，並未命令本次操作 AWS 或刪除資料。接手者應與使用者確認必要的實際服務操作，不重新引入不必要的要求。

## 版本與檔案入口
- 新版後端源碼基準：`4e8837394dfe59e61a8e4a0c9f3bb975e0dd70b3`，原分支 `vnext-release-qa`，CI run 43671320965 completed/success。此交接分支只增加規格、任務和交接說明；不是正式部署。
- 最新唯一主控紀錄：[vnext/docs/10_MASTER_LOG.md](../vnext/docs/10_MASTER_LOG.md)；[現況檢查表](../vnext/docs/RELEASE_READINESS_CHECKLIST.md)；[完整缺口審查](../vnext/docs/FINAL_READINESS_REVIEW_2026-11-15.md)。
- 原始規劃：[original_plan/00_README_FIRST.md](original_plan/00_README_FIRST.md)；修訂後 A–E 共用規格：[task_plan/00_README_FIRST.md](task_plan/00_README_FIRST.md)；分工：[tasks](tasks/)。原始 10_MASTER_LOG 為歷史規劃版本，不是現在的進度，以上最新文件與本交接更正優先。
- [舊版 MarketDepth](https://github.com/hugo90082/MarketDepth/tree/4d030e3c4dda2c85e5404e96e10b7fd6abed7c9c)：原收集器及 Railway 參考程式。不要將舊 30s API/清除資料目錄機制帶入 VNext。
- [V66 前端完整備份](https://github.com/hugo90082/MarketDepth_codex/tree/2c1d69d8e8b23ad877962178999e78b451295582)：原始 source ZIP（372 檔；SHA256 a4b3c0acdecd8972e4dbf307bddf5ede42e36fdc74a15d4aed8da505a2e98bd0），另有 Sites build。原 Sites commit 1eba4b4ea8e07b1f6abd455f3d7d76a43c09030d。新版 C 移植成果尚未取得，不要宣稱已整合。
- 原始規劃、修訂任務共用文件與 A–E 各自入口 30 個檔以 Git blob SHA 逐一核對原 bytes。原始計畫保持原樣，不能把其中已被改掉的舊要求視為最新決策。
- [資料契約](../vnext/contract/schema.sql)、[OpenAPI](../vnext/contract/openapi.json)、[前端介面](../vnext/docs/HANDOFF_A_INTERFACE.md)；合成 fixtures 可供離線測試，不是實際歷史行情。

## 固定現行產品規格
以 MD-VNEXT-1、實際程式與最新使用者決議為準。BTC/ETH/SOL；四所現貨 Binance/Coinbase/Kraken/Bitfinex，每60秒收集，五個互斥半開深度區 [0,100)、[100,200)、[200,300)、[300,500)、[500,750) bps；Binance USD-M 合約10秒成交聚合與官方1分鐘K線。UTC epoch ms，UTC+8每日分檔。每日預期 keys：17280 spot +25920 futures10s +4320 futures1m =47520，缺列與missing狀態分開；未知NULL不等於0，observed不等於trusted；ALL4依現行契約成對有效集合至少2家，不永久儲存衍生比值。Go/SQLite、本機日庫、小時Drive快照、每日封存、瀏覽器快取與 V66 HTTPS 前端。禁止臆造歷史 availability、F10、缺失欄位。原本研究線的15秒或其他交易所規格不可混入本專案。

## 目前進度（非正式上線）
| 項目 | 目前證據及限制 |
|---|---|
| A 收集器/SQLite/API | 已有完整候選程式、三組Go測試與整合CI；正式入口只允許mock/preflight，production run仍鎖定。 |
| B Drive/復原 | 小時備份、OAuth續期、獨立復原已實測；第九次長測未完成跨日封存。正式namespace及真發布仍待實作驗收。 |
| C V66 | 舊源碼與build有備份；最新移植、瀏覽器、TLS、31天匯出、公開部署尚無完成證據。 |
| D 歷史 | 最新來源57日1065393列離線映射/回讀/API已通過；55日1042893列單來源封存、mock批量發布及恢復驗收；11/14–15共22500列隔離，未正式Drive匯入。 |
| R2 | 固定兩原始gzip及非秘密source config工具，8合成測試、CI通過；未真實封存。本交接不附資料。 |
| R3 | 離線 mixed-day plan/CLI/test已通過CI，尚無可信source export adapter、混合日SQLite、同日revision/catalog/recovery/API端到端；切點待真實證據。 |
| R4 | 歷史匯入coordinator/gate已有，正式writer fence與namespace、發布CLI尚未完成。 |
| R6/R7 | 24h測試提前停止；待單跑及正式運維、HTTPS與完整跨日驗收。 |
| E | 整體尚未完成，無正式切換。 |

## 第九次停機證據（Codex 截圖回報，原始Markdown未取得）
2026-11-15 03:55:06 UTC+8，運行3h24m44s，主機可用記憶體79.65MiB觸發80MiB保護，僅新版停止。舊AWS健康正常；同時使用者指出 Railway 已有舊版。408筆原始資源取樣為Codex報告所述；停機前一間隔主機available下降51.65MiB，新版cgroup下降3.40MiB，暖機基線上移但最後半小時回落，不能確認洩漏或單一原因。OAuth續期兩次、一小時1980筆匯出驗證、到期行情格無缺列。九代18件SHA256/SQLite驗證；最新4970筆與停機原庫一致，另1781筆未上傳尾端補入隔離副本後6751筆逐列一致；先前840筆尾端獨立核對。資料原件沒有變更，三代早先退役物件在垃圾桶。復原成功不等於Drive快照已含全部尾端。第十次尚未啟動；完整24h、跨日封存和舊CR-09門檻仍未達，不把第九次標記通過。不要為舊CR-09擅自增加額外長測；由使用者決定剩餘驗收範圍。

## 接手優先順序
1. 不重做已通過的離線映射與既有核心；先檢查現有源碼、CI與最新規格，將已完成及缺口列清。
2. 核對 Railway 現有服務，再規劃讓 AWS 僅跑新版，維持80 MiB安全停止；避免為同機雙跑而購買主機。第十次如何啟動由 Gemini/Codex 在有主機權限的環境依使用者指示完成。
3. 以現有 R3/R4 實作為基礎，完成必要的資料接合、實際發布與復原，不用重複設計多餘的備援架構；歷史資料由使用者另行提供，勿要求本次重傳。
4. 接續 V66 前端 C，完成新版 API 接入、真前端及正式運行，依現行契約整合。
5. 確認未完成項目、以實測決策，不因舊文件而重啟舊的行情數值逐筆比較（使用者已取消）。未取得的證據明列，不假稱通過。所有後續成果更新最新 Master Log。

## 不在本交接中的東西
所有正式行情歷史 gzip、SQLite 日庫、來源帳本、停機行情尾端、Drive 原始行情備份均不包含。程式中的 synthetic fixtures 可保留。Codex 第九次原始 Markdown/監控取樣/本機腳本目前未能從此對話取得；只有回報截圖與主控紀錄，請向原 Codex 工作區取得，勿假造。既有 OAuth 授權實際憑證及其他秘密不移交至 GitHub 或 ZIP。私人儲存庫需要使用者自己的 GitHub 存取授權，不要改公開或貼 token。
