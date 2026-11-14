# Phase 7｜24 小時跨日隔離驗收計畫（使用者已批准）
2026-11-15 UTC+8 修訂；依使用者要求將本輪縮短為24h。使用者已回覆「那開始」，批准本文件的24h隔離雙跑、真Drive寫入及本輪新備份正常退役；其餘安全限制不變。不得修改舊服務或正式切換。

## 1. 已通過的基線
第八次使用 artifact14112481628（1a6806977bfbea886ef04a9813ad4b89a12a0b7f），同一writer 2026-11-14 20:26:58–22:26:58 UTC+8運行7200s；新備份21:01:44及22:01:41 verified，五代gzip/manifest均保留，原三代ID/SHA一致，pending0，未trash。新目錄GET-only復原最新catalog，3341筆行情與事件逐列相符，另840筆快照後寫入仍在本機。spot1428/1428、F10 2139/2139、F1 354/354均無缺列（不等同所有列皆有有效行情或trusted750）。CPU avg1.87%單核、RSS peak53.54MiB、cgroup peak60.06MiB、host available min127.63MiB、無OOM；舊容器running/restart0/health正常。兩次150MiB預檢拒絕後，SSH結束且記憶體恢復才啟動，門檻有效。OAuth drive.file，in-process token refresh未獨立證實。
使用者截圖提供證據，原報告位於 /home/ubuntu/marketdepth-vnext-drive2h-r8.yOISBkvz/（以主機實際路徑為準）。未取得原始資料做主控獨立重驗。五代備份、原第五次writer root及第4–8次全部證據作為不可修改的基線；840筆尾端不得刪除、假稱已備份或自動合併。

## 2. 候選版本與唯一安全啟動路徑
- 新候選 producer3905aaf527a643e860555902749a55598f26fc38，package43613086023 / backend43613086045，兩者已確認completed/success；artifact 14120388865，ZIP sha256:50ed3e20abe2a35875308bb865aee7e2d9c57fafd7da28a51af2b4c432941150，使用該版本及校驗清單。
- 相對第八次只新增 OAuth 成功換發序號與 expires_in_seconds（無 token、client ID、secret、URL 或 response body）；不改行情、時間、SQL schema、Drive scope、刷新策略、保留/退役邏輯。每一個writer process 依自身日誌核對grant1及後續grant2+，外部probe不算。
- 原writer持久同日保留模式不能跨日；禁止移除其journal_meta flag、降版、改日期或重用原root。利用已實作的明確災難復原→非重疊日期續收路徑：所有既有writer停止，唯讀核對完整namespace及五代pairs、ID/SHA/parent/ledger、原root與840尾端保留。若任何新物件或不一致，停止核對。
- 於新的UTC+8日期，先用同一新候選、外部0600 OAuth檔、全新0700 root、--recover-catalog --init-staging 執行GET-only復原；不帶preserve flag、不啟動collector。確認recovery complete、snapshot_only_days=1、sealed_days=0、loss=0，原五代inventory未變。其復原catalog是唯讀舊日期索引，並非把原日庫或尾端轉成可寫資料。
- 只在 first_target 日期與所有remote recovered days無重疊、沒有其他writer時，使用這個新 recovered root（不是舊writer root）啟動 --resume-recovered，**不帶 --init-staging、--preserve-active-backups 或 --allow-capacity-loss**。沿用固定namespace MarketDepth-VNext-staging；保護既有11/14五代資料，正常rotation只管理新run產生的local day/generation；若預檢發現新日期已有remote物件或舊日期被操作即停。復原讀取舊日是允許的，舊日期的 remote 與 local 證據不得更改或刪除。新run的 hourly manifest/gzip 經下一代或sealed完整驗證後才可依既有策略移至垃圾桶；這是使用者已批准的本輪正常退役測試，不允許永久刪除、清空垃圾桶或手動清理。記錄所有新run retired IDs 並核對不屬原五代。

## 3. 連續時窗
24h=86400秒，單一writer PID/start ticks/boot ID，同一run，不重啟後累計。選擇新的UTC+8日期且午夜後至少30分鐘、午夜前至少30分鐘的啟動時刻，使運行期間跨一次午夜且有足夠封存grace及驗證時間。實際由本機執行者核對時鐘與first_target，不自動排程。首末partial day各按實際到期格稽核，兩段相加接近一日但不等同完整曆日；原11/14與本run間空窗不補零。此次縮短的驗收不滿足原Phase0 CR-09兩日界及至少一完整曆日稽核要求；其剩餘風險明列待驗，不宣稱原48h門檻通過、不自行延長。
原資源門檻不變：非root ubuntu、loopback18082、96MiB MemoryMax、no swap、CPUQuota50%、GOMEMLIMIT64MiB/GOMAXPROCS1；啟動前MemAvailable>=150MiB、磁碟>=2GB、credential0600、binary SHA/ELF/--help、舊service baseline、cgroup v2、端口及quota（建議可見剩餘>=100MB；不足即停）。RuntimeMaxSec=86400。OAuth helper只以ubuntu執行，root資源監控分開，先實際執行身分連查兩次。每10s安全監控及每30s原始資源取樣。MemAvailable<80MiB、OOM/資源超限、舊服務異常、非預期重啟、namespace/identity衝突、未到期或已到期備份異常按明確時間窗判定；到期hour+1min起5min未verified或反覆錯誤即停新writer；跨日封存允許原5min grace及另10min完整驗證窗口（工程預設，若實測不足先停並 review）。不放寬限制、不修改舊服務或AWS方案。

## 4. 驗收項目
- 18 streams、到期grid、缺列、status/missing/late/repair分開；每完整日47520 keys（17280 spot/25920 F10/4320 F1），day-audit只用已驗證sealed copy；750 observed/trusted逐側、五區paired coverage及ALL4成員至少2家，不能以present代表有效行情。保留首末partial及每個日界前後5min。
- 每小時verified與daily sealed（首個partial day封存須如實標partial、完整日完整性另審）；逐代manifest/id/hash/size/count/producer/coverage及新run正常retire證據；舊五代不變且未trashed。跨一次日界後至少一個local day sealed verified（依實際起點標記partial）。不能把原11/14 snapshot-only日當sealed或覆寫。
- 同writer實際成功grant1及grant2+、時間與有效期限一致，後續 verified Drive 操作；無敏感值。初次 grant 不等同續期，若未觀測不可通過。
- 資源 P50/P95/max、cgroup峰值及OOM、capacity used/reservation、磁碟1GB保留、原始30s樣本；禁止超過90s取樣間隔或切換PID而宣稱連續。測試至少一次受限長匯出與live收集同時，使用單一API客戶端，核gzip尾manifest及計數/游標，觀察延遲/資源；不要把整日解壓/稽核併行放在512MiB主機。
- 停止新writer後 fresh GET-only recovery root；核對所有sealed及最新active、原11/14 recovered snapshot仍存在，restore前後inventory一致；最新active與stopped local逐列、量化末端未備份資料，不把active未知尾端當永久遺失。sealed partial day用外部day-audit及實際first_target/日界的到期格核對，不把開始前缺格算成市場故障；phase7_evidence原完整日門檻若未滿足應保留blocker，不能改工具門檻或捏造完整日。正常日庫清理僅既有verified安全策略；不得啟用forced loss。
- 保留所有報告、逐流CSV、資源及日誌、原五代基線、新run上傳/退役、manifest、復原與逐列比對。舊版同時窗五區/單位/對齊比較、V66前端及真歷史仍獨立gated，長測不代表正式上線。

## 5. 授權範圍
使用者已批准24h新舊雙跑、真Drive寫入及**只對本次新run已被完整驗證替代的小時備份進行正常垃圾桶退役**。原五代及舊資料一律保留。不得退役原五代或任何不屬本次run的物件。主控不具SSM SendCommand權限；實際由既有本機Codex/SSH執行。執行者須先完成全部預檢，若不符合則停止；批准不代表已啟動。Phase8另行批准。

## 6. 第九次實際執行交接
- 已批准，直接按第2–4節完成，不需再次逐項確認；任何安全停止或預檢不符即停新版並回報。使用固定artifact14120388865，不重編或改程式。
- 先完成新的復原目錄及非重疊日期驗證，再在該目錄以 --resume-recovered 啟動，保留舊writer root與全部五代，禁止對舊root啟用普通rotation。新run的初始inventory將原五代ID列入禁止變更清單；若任何舊ID/雜湊/trashed狀態改變立即停止，不以人工清理作修復。
- 在host以有硬上限的systemd unit執行86400s、獨立監控，SSH斷線不應終止監控/服務；本機Codex須實際核對服務與監控已啟動，回報UTC+8起止、unit、PID、root、首次target與初始健康結果。24h到期只停止新版，依第4節完成獨立復原、對照、稽核及最終報告。禁止自動重啟或延長。若原完整曆日/兩日界門檻未滿足，保留該blocker。
