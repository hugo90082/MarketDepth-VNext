# 04｜Google Drive 長期儲存與容量政策（任務 B）

## 1. 原則

Google Drive 是私有長期檔案庫，不是 mounted SQLite 讀寫磁碟，不用 GCS／額外付費 bucket。API 透過 VM 服務端授權；使用者瀏覽器永遠不拿 Drive token。所有已驗證歷史由 Drive 持久保存，除非使用者另行授權，不自動清除雲端正式檔。VM 仍須本地當日 SQLite、暫存、待上傳及 catalog。

建議資料夾（按 UTC+8 日）：

```text
MarketDepth/
  historical/2026/11/2026-11-13.r1.sqlite.gz
  historical/2026/11/2026-11-13.r1.manifest.json
  active/2026-11-13.snapshot.sqlite.gz  # 每小時更新同一邏輯檔
  active/2026-11-13.snapshot.manifest.json
  legacy/<使用者後續提供的新歷史匯出檔名>.jsonl.gz
  config/                               # 非秘密的設定備份
  catalog/                              # 可重建索引與永久缺口 ledger
```

不要用檔名當唯一 ID（Drive 可有同名檔）。保存 fileId、folderId、revision、hash，以 appProperties 或等效穩定邏輯鍵搜尋重試，避免 timeout 後重複建立。同日只有一個正式 writer；封存 revision 不覆蓋原檔。

## 2. 授權（部署前置）

- 使用者建立／選定 Google Cloud OAuth 專案，啟用 Drive API，使用合規、最小權限的使用者授權流程（例如 web server OAuth，離線存取），在使用者自己的 Drive 建立應用資料夾，優先 `drive.file`。不要要求全 Drive scope，除非有實際無法替代需求並獲使用者確認。
- Google 外部 Testing 發布狀態的 Drive refresh token 通常 7 天到期；以合規 production OAuth 配置及帳號實際政策測試長期有效性。不得假設 token 永久有效。服務帳號不可直接假設擁有個人 Drive 容量／所有權；若選其他方案先證明可行。
- 使用者親自同意授權；client secret/refresh token 保存在 VM root 專屬秘密檔，0600、非網頁可讀、非 GitHub、非聊天、非 shell history、非 logs；不要在交接包內保存。以 secret rotation、invalid_grant、重新授權流程處理失效。
- 先用獨立測試資料夾上傳下載、雜湊比對、token refresh、VM 重啟、撤銷權限後的錯誤與恢復；確定同一 OAuth 應用／授權可在未來 GCP 讀取已存在檔案。

## 3. 每小時與每日封存

狀態機：`ACTIVE -> SNAPSHOT_READY -> UPLOADING -> VERIFIED -> SEALED_REMOTE -> EVICTED_LOCAL`。錯誤停在待重試；不因上傳返回 HTTP 200 就刪資料。

1. 每小時將當日 active DB 以 Online Backup API 或安全等效方式生成一致性 SQLite 快照；不可直接複製仍有 WAL 的 `.sqlite`。驗證 quick_check、schema、筆數/時間，壓縮串流計算 SHA256；暫存檔 `.part` 使用原子 rename。
2. 上傳私有 Drive（可用 resumable）；只保留最新可恢復小時快照（同一 logical fileId 或受控 generation），manifest 最後更新。新快照驗證後才清前一代；保留至少一份已驗證代。禁止每小時無限制留完整副本。
3. 日界後完成前一日最後 spot/10s/1m（有 grace），停止該日 writer；checkpoint + close 或一致性 backup，`quick_check`，壓縮。日 manifest：contract、day、timezone、revision、source、完整區間、各表 row counts、缺格/缺值統計、size、SHA256、producer_commit、sealed_at、fileId。
4. 上傳、讀取遠端 metadata（若 SHA256 有值直接比較，否則下載串流驗證 SHA256；可比較 size），測試解壓資料庫；manifest 與 data 完全可取得才 commit catalog。上傳/manifest 中斷需重試恢復，不產生兩份相同正式檔。
5. 確認正式日檔可讀且無正在使用的本地讀者後，刪本地日檔、WAL/SHM、壓縮中間檔。當日快照待正式日檔驗證後清除或保留受限短期恢復代。遠端歷史永久保留。
6. 如晚到補抓確需更新已封存歷史，產生新 revision 與新 hash；manifest 標記 supersedes，舊版保留，browser cache 依 revision 失效；不要悄悄修改舊檔。

不在 collector writer goroutine 直接執行網路上傳。使用 bounded 單工作佇列、指數退避加 jitter、尊重 Retry-After；Google 故障時繼續本機收集並顯示最後成功備份時間。

## 4. 讀取與匯出

- 由 catalog 取得 fileId，不逐個掃全 Drive；Drive `files.get?alt=media` 下載二進位檔。限制 1–2 同時下載，按日期讀取，重複請求合併（singleflight）。
- 驗證 hash、大小、schema 後才放入暫存；解壓 sqlite 唯讀。暫存 LRU（最近最少使用）上限 100MB，含下載 `.part`、壓縮與解壓；不得因 100MB 上限而無聲回缺值。單日過大時採串流／單檔受控處理，保護總容量。
- 長歷史匯出逐日讀寫 response，一天處理完可釋放；不得將 6 個月全部解壓到記憶體或本地大檔。跨日保序，傳輸中斷明確重試，不能假裝已下載完整。
- 暫存只為改善效能，不是正式來源。Drive 故障時已在 cache 可正常讀，其他回 `ARCHIVE_UNAVAILABLE`，不影響 active collector。

## 5. 1GB 硬上限：使用者已確認強制刪除

容量為 VM 市場資料實際 allocated bytes（含 active SQLite、WAL/SHM、snapshot、pending、history cache、catalog；不含 OS/Docker、獨立下單資料及獨立輪替系統 logs）。建議高低水位：950MB 觸發、900MB 目標、1,000MB 硬上限。根磁碟至少 1GB；建議 1.5GB 提醒、1.2GB 警告、1GB 時先清行情資料/取消暫存任務，必要時停止非必要寫入並告警，不能危害 OS。

清理優先順序：
1. 已過期或不在用的 cache、失敗 `.part`、可重新產生的 snapshot；2. 已驗證雲端存在的本機日檔；3. 若仍逼近上限，逐日強制刪除最舊未成功上傳的完整日檔，**即使尚未同步也刪除**（使用者已明確選擇）。保護當日活躍 writer、正在讀寫檔、catalog、系統檔、交易紀錄。以容量預留及定期清理避免等到滿才處理。若無可清安全檔仍無法保持安全空間，停止非必要工作，最後只能暫停行情寫入並告警；不可刪活躍 DB 或 OS。

- 強制刪除前先持久記錄 tombstone：日、from/to、row counts、archive state、reason、刪除時間，明確 `permanent_loss`；保留小型 ledger，Drive 恢復後同步。若有已驗證 hourly snapshot，標記可恢復區間，只把剩餘區段標缺。使用者本地匯出可日後重新匯入，不能假定有備份。
- 不因 retention 直接刪 Drive 正式歷史。此規則優先於任何舊『未下載不可刪除』與 14 天政策。

## 6. 驗收

mock Drive + 真測試資料夾：upload timeout/重複、hash mismatch、token expiry、空間滿、跨日、重啟、讀取中 eviction、日檔 revision、manifest rebuild。模擬 VM 全失後以乾淨 VM + 授權重建 catalog、還原日檔及當日最新小時快照；逐列比對。量測 archive latency 與 RAM。每次對正式 Drive 的操作需在使用者批准範圍內，禁止刪非專案檔。
