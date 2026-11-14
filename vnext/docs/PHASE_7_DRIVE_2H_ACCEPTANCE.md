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

## 8. 第五次實測失敗後的修正版（本節優先於第7節及所有 fresh-root writer 指令）
- 第五次 2m43s 停止，artifact14109993571（producer cc01c82b）；root 404 已排除，真 Drive 有兩個 folders、1 個 gzip（3950 bytes），無 manifest，verified0/pending1。遠端 GET metadata/media 均200，實收SHA符合預留。Google回報 application/x-gzip，舊 transport 要求 application/octet-stream，導致 identity conflict。舊服務 running/restart0/health正常。保留第四次失敗資料與第五次 /home/ubuntu/marketdepth-vnext-phase7-drive2h-r5.ccKZfDDZ/ 證據。
- 修正版 producer 929a89b0e347b2ec25e1fbc6587be7b2f77361a3，package43587845678、backend43587845692 必須均 completed/success 才可下載相應 artifact、驗證 SHA256SUMS/PRODUCER_COMMIT。只對 .sqlite.gz 允許 application/octet-stream/application/gzip/application/x-gzip，reservation MIME 仍 octet-stream；其他 identity/size/hash/manifest/raw SQLite/row 驗證不變。新增安全錯誤碼與 endpoint 類別，無 URL/secret。真 Drive 完整驗證仍待實測。
- **不能再使用新 writer root 或要求遠端為空**：這次有合法未完成物件，原 catalog 與 drive-state reservation 必須保留。確認第五次 writer 已停止、無其他 writer、舊 marketdepth 正常、原 root/marker/權限正常、資料目錄不與舊服務重疊。以完整唯讀 namespace listing 和同一 OAuth 比對原 drive-state、pending manifest、data key/id、父資料夾、metadata/size、實收 SHA、gzip/raw 及本機 pending 檔案；確認只有第五次原兩資料夾和同一3950-byte gzip，無其他未確認物件、無 manifest、pending1/verified0。若不同或不確定即停止，不刪除、不修改遠端資料、不手工修改 reservation 或 catalog。確認 pending day 仍是今日UTC+8；本輪2h不跨午夜。若已跨日或時間不足，先停止並另行設計安全補傳，不自行封存或跑過午夜。
- 先在隔離root之外建立0700證據目錄，在 writer 確定已停止的情況下完整唯讀備份第五次資料、catalog/WAL（若存在）、drive-state、pending gzip 及報告，保存 SHA256/路徑清單；憑證在外部不複製進證據。原路徑保留給 writer，副本只供證據，不從副本執行（pending path 是絕對路徑）。正常 publish 成功會清除工作暫存，因此此備份必要；原第四次資料完全不動。
- 原 staging_preflight.py 強制新 root 不存在，本輪不可對既有 root 執行該條件。改做等效唯讀檢查：新 binary SHA/ELF/--help、既有 staging marker、非 symlink/0700、所有路徑與舊資料分離、credential0600、可用磁碟>=2GB、MemAvailable>=150MiB、18082未占用、cgroup v2、舊容器及 namespace 確認。不可重新初始化資料目錄。
- 在原第五次 data root 用修正版 binary 啟動**不帶 --init-staging** 的正常 staging run，沿用相同 private credentials、auth、loopback、96MiB/CPU50%/no swap/80MiB停止條件及2h hard timeout，--producer-commit=929a89b0e347b2ec25e1fbc6587be7b2f77361a3。不要 --resume-recovered、--allow-capacity-loss 或移動 pending。ArchiveWorker 先 publish exact pending（原 manifest 的 producer 保持 cc01c82b，不改舊hash），成功後才產生新 generation（新 producer），不重新上傳同key。以原 pending ID / hash 核對首次 verified；新的 manifest 只可在真 gzip/raw/SQLite verifier 成功後發布。若首次 pending 五分鐘內未完成完整驗證，或資源/舊服務/namespace失敗，停止新版保留所有證據。不要把資料空窗補零或偷偷回填；分段統計第五次停止→本次首次target之間已知停止區間，本次到期格另計。
- pending verified 後在同一run完成2h，至少兩代不同 hourly_verified（其中至少一代本輪新建），若時窗容許應收集兩代本輪新建；分別記原與新 producer、generation、SHA/ID、status、row counts、retire evidence，不手動退役；兩次 real Drive 備份與下一代退役後的恢復都需要驗證。停止新版後才按第5節用 fresh recovery root --recover-catalog GET-only，並驗證最新 snapshot 原始資料與 stopped source 逐列；預期最新 generation producer=本輪新commit。回報完整 report、safe archive diagnostics、資源與逐流、pending retry同ID證據、manifest、復原及 old health。任何不確定均停止，不刪除遠端原物件或第四次/第五次證據，不改 OAuth scope、不停舊服務、不切換。

## 9. 第六次預檢後：所有測試 Drive 物件保留模式（本節優先於第8節和任何退役要求）
- 使用者提供第六次 Codex 截圖：artifact14111211715 已在本機及 Sydney 完整校驗，package43587845678/backend43587845692 均通過。原 pending 的 remote ID/parent/3950 bytes/SHA、逐位元組內容、解壓SQLite完整性與筆數均已核對；pending1/verified0。第四、第五次原目錄及第五次 stopped data/catalog/WAL/reservation/pending/report 備份完整、本機副本SHA相同；舊服務正常/restart0，remote未變更。因原程式自動 trash 前代，與第8節禁止刪除要求衝突，未啟動新版。這是正確的安全停止，非新 MIME 驗證失敗。
- 新版 producer 1a6806977bfbea886ef04a9813ad4b89a12a0b7f，package43591026043/backend43591026032，兩者均須 completed/success 才可下載對應新 artifact。核對 SHA256SUMS、PRODUCER_COMMIT、--help 包含 --preserve-active-backups。原 collector/schema/credentials/namespace 均不變。
- 原第五次 root /home/ubuntu/marketdepth-vnext-phase7-drive2h-r5.ccKZfDDZ/ 沿用，不從副本執行，不重新初始化，不修改 reservation/catalog。第六次停機備份已完成，先重核原檔與副本 hash、remote inventory、pending day、同一 writer 停止、舊服務及全部安全預檢；若 evidence 已改變/時間跨日/剩餘時間不足2h及復原預檢，停止。若仍符合第8節，無需重複製作相同備份。
- 啟動時**必須加 --preserve-active-backups**，且不帶 --init-staging/--resume-recovered/--allow-capacity-loss。只適用同一UTC+8日期的 staging QA；不跨午夜。此旗標會在原 catalog journal_meta 持久設定 archive_preserve_active_day，往後新版忘加旗標、日期不符或有舊日庫即拒絕/停止。禁止降回舊 binary、手工清除旗標或試圖重開其他 root 避開限制。使用 --producer-commit=1a6806977bfbea886ef04a9813ad4b89a12a0b7f，原 pending manifest producer 保持原 cc01c82b。
- 完成原 pending 後五分鐘 early gate；以原ID/SHA核對未重複上傳。之後同一run延續2h，至少兩代新 hourly_verified（若因時窗/停止條件不足則明確部分完成，不自行延長），另保留原 pending verified。新一代發布後，兩代均完整 readback/SQLite 驗證，將舊一代完整 PublishedRecord 以 archive_preserved/<day>/<generation> 記入 journal_meta、原子釋放 previous slot，log active_preserved；**不呼叫 TrashActiveObject，不把任何 Drive 物件移至垃圾桶**。遠端每代 manifest/gzip 必須維持未 trashed，數量增加而非只剩最新代。正常 active_retired 路徑不得出現；任何刪除意圖/異常、原始物件不見或資源停止條件即停止新版。
- 停止後 GET-only fresh recovery root 按第5節執行（復原命令不帶 preserve flag）。保留所有代的 manifest/gzip，復原仍以最新 active candidate 為準；較舊代都應有完整 verified 證據，報告逐代 ID/hash/row counts、preserved ledger 與全 namespace inventory，確認零 trash/刪除/移動。最新代與 stopped source 逐列對照。該 QA 模式僅用於此次同日保留證據；日常自動退役/跨日封存/24–48h長測仍另行驗收，不得以本輪取代。既有本機及 Drive 資料不刪除，舊服務不停止，OAuth 不擴權，正式切換未授權。

## 10. 第七次實測後：凍結已通過的 Drive binary，只補兩小時連續驗收（本節優先）
- 使用者回傳第七次 Codex 截圖：原pending約13秒 verified，同ID/SHA/producer；兩代新verified，三代gzip/manifest均保留，pending0；運行約5m52s，外部清單監控以root執行，與OAuth檔ubuntu owner檢查衝突而誤停止，改ubuntu唯讀查詢成功。停止後 fresh root GET-only獨立復原完成，最新snapshot 189筆資料與事件逐列一致，Drive inventory前後一致；舊容器running/restart0/health正常、OAuth不擴權、不切換。第七次證據位於 /home/ubuntu/marketdepth-vnext-drive2h-r7.xfJ7Aocb/（以實際報告路徑為準）。此為使用者回傳，主控未取得原始報告逐項獨立重驗。2h連續、長時資源、同process OAuth續期尚未完成。
- 固定**同一個**已通過CI/package artifact14112481628，producer 1a6806977bfbea886ef04a9813ad4b89a12a0b7f，ZIP SHA256 92596aec30cd28dd8bc3e1cb7e0a79abfe1aea9818db20b8d66c34b1fe218755。package43591026043、backend43591026032、log43591093480 completed/success。無需重新編譯/傳輸已驗證binary，不改後端或資料規格。
- 原第五次writer root（第七次實際使用者報告路徑為準）及既有三代是合法基線，不能再套用空inventory或pending1條件。唯讀核對同一stopped writer、無其他writer、pending0、current/previous/preserved ledger與三代完整pairs（含原remote ID/hash）一一相符、root及active folder identity正確、無未確認物件、marker/權限/日期/容量/舊服務/端口等預檢通過；保留第4–7次報告及第六次原始stopped備份。若previous仍存在，按同一保留模式正常完成，不手工改catalog。確認最新快照復原結果及所有本輪新資料基線。所有已verified pairs維持原樣，不要求遠端為空，不重做已通過的原pending發布。新run另存監控證據目錄，原writer root原地續收。
- 修正外部監控（非collector）：所有需讀OAuth的 Drive list/verify/token helper 均以與staging service相同的 ubuntu UID 執行（如 sudo -u ubuntu -- python3 <helper> ...）；不改憑證owner/mode、不用root執行憑證讀取、不將secret傳入root環境或stdout。需要root的systemd/cgroup/docker監控只負責資源及停止操作，與OAuth helper分離。正式啟動前，在實際排程/監控執行身分與環境下至少兩次完整唯讀inventory probe成功，確認錯誤可正確分類且不含秘密；不能只手動以ubuntu跑一次。保留真實錯誤的fail-closed，不取消資源/舊服務/identity安全停止條件；若再次發生監控身分問題，停止新版並修正外部工具。正常查詢只讀，不使用垃圾桶或修改遠端。
- 開始前用主機實際UTC+8時間確認同一preserve day，保留至少2h+15min安全餘裕至午夜；不足則停止並另行規劃，不能解除保留模式或改日期。原2h批准下重新執行完整7200秒連續run，已跑5m52s不累計。原root、不帶--init-staging、必帶--preserve-active-backups、同一producer、原96MiB/CPU50%/no swap/80MiB停止條件。MemAvailable>=150MiB、舊服務與quota等預檢保留。先監測正常啟動及既有backup/ledger可讀，**不再要求5分鐘內出新hourly generation**；已存在當前小時generation時應等下一個到期小時。按實際hour boundary+1min與worker retry節奏，在每個新到期generation可產生後5min內確認verified，未完成/反覆錯誤則安全停止。至少兩個本輪新hourly_verified、已有三代皆仍存在；若最後一個hour未滿完整驗證時間，如實列出，不延長7200秒。必要時在符合時間安全餘裕下選擇整點後數分鐘開始，避免末段碰到新hour的5min窗口。已知多次停機空窗與本輪新到期格分開統計，不補0。
- 保留每次verified及active_preserved紀錄、所有代ID/SHA/producer/counts/未trashed完整清單、CPU/RSS/cgroup/current/peak/OOM、host MemAvailable/old health、行情逐流及API、實際運行秒數；OAuth同process續期若無可核對安全證據，明確標未獨立證實（不要記token）。停止新版後用fresh recovery root GET-only重建最新代catalog並做latest snapshot逐列與stopped source比對，量化未上傳尾端；既有第七次復原證據保留。零遠端刪除/移動/退役、零舊服務修改，未批准24–48h跨日/正式切換。正常retirement及daily seal與跨日長測仍需獨立規劃，不能解除此root的同日持久QA政策或降版。此次只改驗收腳本，不修改binary。
