# Phase 5｜歷史匯入控制程式全量離線驗收（2026-11-15，UTC+8）

## 結論
- 55 日（2026-09-20～11-13）、1,042,893 筆實際歷史候選資料，全批次計畫、封存、模擬遠端不可變發布、中斷續傳及完整唯讀重驗均通過。807,588 spot＋235,305 futures_1m；10s 合約資料及 events 為 0，未合成。
- 11/14、11/15 共 22,500 筆繼續隔離，不能以本程式發布混合日。
- 所有真實行情只在本機使用；遠端、目錄、租約、切點、producer 及既存物件均為測試模擬，不能充作正式匯入授權。實際 Drive 寫入 0，未接觸長測主機，未修改舊服務。
- GitHub `phase5-legacy-import-qa`：功能 commit `85bd5ee626860ba2b94e3fcc5364760afb6c9700`，CI workflow `f12fa90b6173f519cdd57bb1816e1f11df11f273`，具名欄位測試修正 `164c41934a04bc04cf0a505c90dae8378961892d`。基底為前輪 `9ace419471819590f03efae4398599bc3f24ac4f`。未合併 main 或部署。

## 實測數據
| 項目 | 初版 | 最終版 |
|---|---:|---:|
| 日期數 | 55 | 55 |
| 資料筆數 | 1,042,893 | 1,042,893 |
| gzip bytes | 80,021,603 | 80,021,606 |
| 新建遠端物件（模擬） | 110 | 110 |
| 完整重跑新增物件／PUT | 0 | 0 |
| 保護原物件（模擬） | 11 | 11 |
| 測試耗時（秒） | 258.07 | 263.04 |
| peak RSS（KiB，含測試命令） | 200,784 | 196,668 |

最終版建立計畫 148.27s、故障後續傳全批 75.93s、重跑唯讀 37.72s；111 次 PUT 呼叫（含一次相同 data key/ID 重試）、110 次新物件建立、290 GET、238 gate 檢查。兩種故障：data commit 後回應逾時、manifest commit 後回應逾時；首次資料 `mock_14`、首次 manifest `mock_15` 均未更換。所有已完成日期重新復原及讀回核對，重跑 0 PUT，既存 11 物件 ID 與 bytes 不變。獨立核對最終 55 gzip 檔的 SHA256 與 row_counts；55 份完成紀錄、110 個 unique mock IDs、manifest 與計畫相符。最終 QA 計畫 SHA256 `75918607114f70736d751d9763f6beb2e53001d4f11a94e5d9eab09fb746d788`；來源草案 SHA256 `e1a8d8feda9acc7fbecc4676a792f27929f96fd13069c1203995c57b6835c418`。合成切點 11/14 00:00，`publication_approved=false`。實際正式容量須用真實計畫重算。

## 安全設計與驗收
- 離線 `PrepareV66Import` 先 bind 57 日來源證明與 placement，驗 55 個 eligible、2 個 hold、全 namespace 既存 archive inventory、實際候選及 proof hash；逐日新建，完整 gzip 檔和計畫保留，私有路徑、磁碟預留、總 staging budget 250 MB，單日 reserve 100 MB，fsync 與不可覆寫 plan。建置中斷未產生 plan 不可發布。
- `InspectV66Import`/CLI `legacy-v66-plan` 驗計畫 SHA 與全部55 gzip，未寫 Drive。實際 CLI inspect 成功，錯誤 SHA 拒絕。沒有 publish 命令。
- `RunV66Import` 需獨立批准的 exact plan SHA 及外部 `ImportGate` 真實排他租約；本地 flock 防止同目錄並行，不能代替遠端排他。每次 PUT 前及完成後重查 fresh 完整 inventory、quota、local clear、租約和 writer 停止；所有既存物件完整 byte hash 起迄重驗，保護 original IDs；unknown、同日不同 revision、orphan manifest、out-of-order remote objects 均拒絕。允許下一未完成日 exact data 或 data+manifest；兩物件完整 readback 後才 fsync 不可覆寫 progress record。再執行時重驗全部 completed pairs，不 PUT；不自動重建、覆寫、刪除或合併 catalog。
- 已驗證拒絕：wrong plan SHA、writer active、wrong lease、incomplete/stale inventory、local collision、quota不足、remote collision、protected bytes 變更、orphan manifest、最後一日 gzip 損毀（首個遠端寫入前拒絕整批）、local concurrent process、corrupt progress。另驗證 archive key 日期/父路徑、ID unique。所有測試錯誤情境皆不新增遠端寫入。
- 真資料測試 Go1.23.2、GOPROXY=off、vendor 由既有驗證包提供。首次 sqlite CGO 編譯超時，改用 CGO_CFLAGS=-O1 -g0 完成；不涉及 production build flag 變更。CI 43660685496 三組 go test 已通過，但 go vet 發現上一輪移動型別後測試用 unkeyed struct literal；修正為 keyed fields，未改功能；本機 targeted test 和 go vet 通過。第二次 CI 43660904031 記錄時 in_progress，需查實際結果。

## 尚未完成的正式環節
1. 真實 ImportGate / publisher adapter：需能確實維持同 namespace 排他操作權（停止 VNext writer、確認無其他 root/writer，持續驗證租約及 inventory）、可驗證 Drive quota 與持久 reservation state；本機 flock 或布林旗標不能代替。實作並驗收前，不得以 mock 或任意輸入構造正式發布授權。
2. 用全批次模擬已發布目錄重建新 catalog，實際 HTTP /history、/export、/days、/day 全量讀取與來源／缺格核對；本輪是逐日 store-level 完整復原，不等同整批正式 API 驗收。
3. 第九次長測結果、first_target、原五代及本機840尾端、實際11/14與11/15重疊、切點與真實 placement；持續隔離混合日。正式匯入需另行批准，且應保留真實 source draft、placement、完整 inventory 及批准計畫與持久 Drive state；合成計畫不可使用。
4. V66 前端整合、正式部署與切換仍各自驗收。未修改主機/Drive/目前長測。