# Phase 7｜真 Google Drive 兩小時隔離驗收執行單
2026-11-14 UTC+8｜使用者已明確批准本次真 Drive staging 備份及 2h 雙跑；不授權正式切換、其他 namespace、付費升級或停止舊容器。

## 1. 固定候選版本
- artifact 14107769635 / package run 43581030140 / backend CI 43581030130，均通過。
- producer commit 74e3de1e398af23dc6bbbb7ac72f0e50c75c6fdb。
- 外 ZIP SHA256 fd2229b7a343c07ea8af668d81c51f161de6720fe12c7053d31d416a0f43ce53。
- 使用 Sydney 已驗證 binary，不重新建置或變更 collector；核對 tar、SHA256SUMS、PRODUCER_COMMIT。前次 root /home/ubuntu/marketdepth-vnext-phase7-live3-14107769635.FSG2GGjU/ 僅保留為證據，禁止續寫。舊 /srv/marketdepth/data 不可更動。
- 使用者本機 Codex 經既有 SSH 執行；SSM 組織政策拒絕，不嘗試繞過。主控對話不能直接操作主機或聲稱已啟動。

## 2. 憑證與遠端預檢
1. 在已授權本機私密 OAuth 目錄找到先前 drive-authorize 產生的 *.oauth.json（四欄 client_id/client_secret/refresh_token/scope；只檢查格式及 scope=https://www.googleapis.com/auth/drive.file，不輸出內容）。Google 下載的 Desktop client JSON 不能直接當服務憑證。若有多個無法確認的候選、授權失效或找不到，停止並只回報原因。
2. 使用既有安全 SCP 通道，傳輸到 Sydney 新建的私密 0700 目錄中之 0600 檔案，ubuntu 擁有，位於所有行情 root 外。不要在聊天、命令參數、log、Git、Drive 行情備份或報告中列出秘密；只回報權限及檢查成功。Windows 原始授權檔保留。
3. 使用同一 OAuth app 的 refresh grant（token 只在記憶體），先 GET Drive about storageQuota，完整分頁 files.list：q=trashed = false and appProperties has { key='md_ns' and value='MarketDepth-VNext-staging' }；不得只列 manifest。fields 包含 nextPageToken,incompleteSearch,files(id,name,mimeType,appProperties,parents,size,sha256Checksum)；scope 所見有限，不代表全 Drive。另核對同名 root folder（若可見）、所有既有 writer 已停止。若有任何此 namespace 未經確認的物件（含 folder 或孤立 gzip）、重複 key、不完整搜尋、其他 writer、空間不足或不能證明安全，停止，不覆寫/刪除、不另造 namespace。預檢可見空間建議 >=100MB，不能判斷剩餘額度則回報並停止。測試前不建立遠端資料。
4. 再執行原 staging_preflight.py --credential，確認 cgroup v2、18082 未占用、MemAvailable>=150MiB、old container running/restart0/health正常，根磁碟足夠。保留 preflight 與 old baseline。若預計兩小時窗口含台灣午夜，這輪只驗 hourly，選不跨日的時窗；不自行延長雙跑或改日界。

## 3. 真實兩小時雙跑
全新資料 root、0700、原 transient systemd unit 隔離及安全監控；非 root 執行，MemoryMax=96M、MemorySwapMax=0、CPUQuota=50%、GOMEMLIMIT=64MiB、GOMAXPROCS=1。RuntimeMaxSec=7200，正常/異常都只停止新 writer，保留資料。原受限測試 harness 可以沿用，修正 runtime 及 Drive flags；不可改已驗證 binary。

必要 flags：
```sh
marketdepth-staging --init-staging --data-dir "$NEW_ROOT" \
  --listen 127.0.0.1:18082 --origin https://staging.invalid \
  --producer-commit 74e3de1e398af23dc6bbbb7ac72f0e50c75c6fdb \
  --drive-credentials "$PRIVATE_OAUTH_FILE"
```
沿用獨立 auth 環境變數，禁止輸出。--allow-capacity-loss 保持 false，--resume-recovered 不使用；不用公網 HTTPS、不開防火牆。Drive 唯一 namespace MarketDepth-VNext-staging。程式依原策略僅在新備份完整驗證後退役其上一代 active 備份（不手工刪除或清空垃圾桶）。若預檢已確認無既有物件，所有新增/退役均為本次 staging 測試資料。

每10秒監控主機 MemAvailable、舊容器 running/restarts/OOM/health、新 unit cgroup memory/current/peak/events、CPU、RSS、disk；每30秒保留資源probe原始樣本。低於80MiB可用記憶體、舊服務異常/重啟、新unit OOM/超限、容量違規、Drive 錯誤反覆或 namespace 碰撞時，只停止新版，不自行放寬上限、不無限重試。原始日誌私密，報告僅非敏感診斷。

## 4. 備份與證據
- 每小時 generation（該小時第1分鐘後可備份，首次有效資料後即可執行；並非一定要滿60分鐘才出第一份）。至少兩個不同 generation 達 hourly_verified；每個成功時從 API health/私密 catalog 的一致唯讀查詢保存 evidence，包括時間、day、generation、producer、size、raw_size、sha256/raw_sha256、row_counts、grid_through_exclusive、status_counts。後續退役可能只保留最新版，不能依結束時物件數反推成功次數。不要直接 copy live WAL DB 或修改 catalog。
- 確認第一個快照之後的交易所/合約/API收集未中斷，依實際到期格算分母，查 12 spot / 3 F10 / 3 F1 的 status、缺格、5區 observed/trusted、REST repair，ALL4每區成員。同步測試登入、history/sync、限定小範圍 export（核對 gzip EOF/CRC、manifest、計數）。CPU/記憶體/容量與無 OOM/重啟獨立驗收。
- OAuth 初次 grant + 長時操作結果；證明 refresh 時，使用不含秘密的實際刷新事件/有效期限及後續成功操作證據。如果沒有可核對的 in-process refresh 事件，標明續期未獨立證實（不能僅靠運行2h就宣稱完成）。可另以停止後 fresh process 做 token grant 及 GET 驗證；此不等同同一程序到期自動刷新。嚴禁 token 出現在報告。
- 查所有 namespace objects、核對 current manifest 和 data 之關聯及 metadata。確認無待完成 upload；若有 pending，保留證據，不強制刪除。不要求 final snapshot 含最後一秒（hourly snapshot 的未上傳尾端正常，應量化）。

## 5. 停止後復原（不雙 writer）
1. 確認新版 writer 終止、舊容器仍正常、沒有其他 staging writer；保留原本所有本機日庫與 catalog。復原在全新未存在 root，以同一資源限制的獨立 bounded transient unit 執行，預檢與安全停止相同。禁止啟動 collector 或 --resume-recovered。
```sh
marketdepth-staging --recover-catalog --init-staging \
  --data-dir "$NEW_RECOVERY_ROOT" \
  --drive-credentials "$PRIVATE_OAUTH_FILE" \
  --producer-commit 74e3de1e398af23dc6bbbb7ac72f0e50c75c6fdb
```
2. 核對 exit0、無 .recovery-build、snapshot_only_days（不跨日預期1）、sealed_days=0、loss=0、recovered active record/bitmap；此工具驗證 gzip/raw SHA/SQLite/列並重建 catalog，**不代表將 active snapshot 直接恢復為可寫日庫**。復原期間沒有遠端寫入，前後 inventory 相同。
3. 最新 active snapshot 額外唯讀下載到外部驗收機或受限獨立 scratch，驗證 manifest/data id、compressed/raw SHA及大小、SQLite quick_check、schema/producer/date/row_counts；逐 key 檢查 snapshot 的 revision/內容與 stopped source 日庫。在快照之後修復的 row 可能較新，按 revision/repair ledger 解釋，不假稱所有 final source row 都在快照；同 revision 不一致或無證據的缺列為失敗。不可把 snapshot-only 日期當 sealed/full-day 或把未知尾端當永久遺失。保持原檔與復原證據，不自動續收或清理。

## 6. 回傳及驗收
回傳完整 REPORT.md、逐流/逐分鐘CSV、resource JSONL/summary、所有 hourly_verified generation摘要、最新 manifest（非秘密）、復原 JSON及逐列對照摘要、old baseline/end。報告中不包含 OAuth/session/password、SSH key、token endpoint response 等秘密。
同一份 2h 實測若達到上述標準才標「hourly 真 Drive + 復原通過」；OAuth in-process 續期另列。沒有兩次 verified/完整復原、發生 OOM、出現不明 remote 物件或停止條件，標失敗/部分完成，原樣保留 evidence。
本輪不跑24–48h、不封存正式日、不改舊服務、不處理正式歷史、不發布正式V66、不切換。30min舊新數值比較可於測試結束後以原有證據另行唯讀執行，不與備份競搶 VM。

## 7. 第四次實測失敗後的修正版驗收（優先於上方舊 artifact）
- 2026-11-14 使用者回傳 Codex：OAuth refresh grant、quota、staging listing 成功；實際 GET /drive/v3/files/root=404。新版3m19s停止，spot36/36、F10 39/39、F1 6/6，兩分鐘API export 66筆及gzip/manifest驗證通過；cgroup peak33.38MiB、host min150.70MiB、無OOM；舊容器不受影響。遠端 inventory仍空、verified0，本機pending1。保留 /home/ubuntu/marketdepth-vnext-phase7-drive2h.ZTb8mn9Y/ 完整證據，不刪/續寫/搬移 pending、不手工改 manifest 或 catalog。
- 修正版 producer cc01c82b17a4fcf58fb7e7ce01c20d4432f28969，package43586576156、backend43586576197，均須 completed/success 才可下載對應新 artifact；以實際 SHA256SUMS/PRODUCER_COMMIT 核對。只改 Drive transport（root lookup/create/verify/recovery），collector/schema 不變。Google drive.file 保持原 scope，不重授權、不開 drive 全權；不再要求 GET /files/root 成功。用 appProperties 的 namespace/root key 全域唯一搜尋及 'root' in parents 搜尋相互核對，建立時省略 parents，依預先保留ID重試；直接讀取 app-owned folder 驗證 identity，移動/重複/不一致即停。真 Google 的 list alias 可用性仍需實測，不能把 fake transport 當實證。
- 先保留本機舊失敗目錄，重新唯讀查 namespace 確認仍為空、quota、安全門檻及舊服務，沿用既有0600憑證，開全新隔離root。不可刪遠端既有資料，若非空須停止核對。原2h批准仍限本輪重試、同樣安全限制；不另開並行 writer。
- 啟動同一受限2h run，將第一次 hourly_verified 作為 early gate：若首次到期快照在5分鐘內未完成遠端驗證或發生重複錯誤，立即只停新版、保留實際 HTTP endpoint/method/status 及去敏感錯誤；不可輸出 token、upload session URL 或憑證。若第一份已 verified 且其他安全條件均通過，在**同一個 run、同一個資料根**繼續至原2h hard timeout，勿重啟另開短測造成 namespace/key collision。至少兩代 verified + 停止後 recovery + active snapshot 逐列驗證均依原章節執行。
