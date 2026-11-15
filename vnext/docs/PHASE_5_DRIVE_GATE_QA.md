# Phase 5｜Drive 匯入閘門離線驗收（2026-11-15 UTC+8）

## 版本與結果
- 分支 `phase5-legacy-import-qa`，commit `da2c4455cb7c5fff7742f30f0eabc9b80706aa98`；13 個新增/修改 Go 檔案，功能及測試已在本機編譯驗證。未合併、未部署。
- `InspectImportInventory` 透過 appProperties 全分頁、可見根目錄同名檢查、遞迴父目錄查詢及第二次 namespace listing，核對 ID、邏輯鍵、實際父目錄、大小、SHA256、MIME、已知目錄結構；拒絕未知項目、移動、重複、頁面不完整、重複 pageToken、未知 quota。僅 GET Drive，不建立 reservation，OAuth token exchange 獨立。
- 模擬 HTTP Drive 實測 130 物件完整分頁；模擬 commit 後失敗再建立新 Client 使用原 reservation dir，重試 ID 不變、generate/upload 次數不增加。其他負面案例包含同名根、未知資料夾、未標記子物件、移動檔案、重複 ID。
- 同主機共同 namespace lease（flock，持有 FD、inode/owner/permission/nlink 核對），另取得每個已列舉資料根既有 `.writer.lock`；以 SQLite mode=ro/immutable 檢查乾淨 catalog，不執行 migration/checkpoint/replay；拒絕未處理 WAL/SHM/journal、pending intent、未完成 recovery、任何候選日碰撞。多根合併檢查與 catalog SHA 不變測試通過。
- `DriveImportGate` 綁定已審核 inventory 與 plan baseline，逐次檢查外部排他條件、共同鎖、所有已停止根、folder ID 與 root ID、容量和新鮮度；只允許計畫中的歷史月份祖先目錄新增。`RunDriveV66Import` 接入既有 immutable coordinator；固定 `<plan-root>/drive-state`，在 plan root 保存不可覆寫的 plan/inventory SHA 與 device/inode 綁定，每次 gate scan 再核對，防止目錄替換後重建 reservation。測試拒絕變更 approval digest、替換 state 目錄。
- 真實 55 日前輪合成計畫 SHA `75918607114f70736d751d9763f6beb2e53001d4f11a94e5d9eab09fb746d788`，以兩個實際測試 SQLite root + stub inventory 測試 gate：55 日/11 個既存模擬物件；9 類拒絕：外部 fence 失效、遠端不可用、過期 inventory、根變更、意外資料夾、受保護資料夾消失、新資料夾身份變更、第二 root 衝突、租約關閉；另拒絕錯誤 digest、錯誤 lease、缺少 fence。
- 本機 go test ./...、go test -tags sqlite_integration ./...、go test -tags live_ws,sqlite_integration,secure_auth ./...、go vet -tags live_ws,sqlite_integration,secure_auth ./...、schema_check.py、daily_sql_check.py 全 PASS；targeted 8 個測試與 review CLI build/help PASS。首輪 targeted test 的 time.Date 缺少 nanosecond 參數已修正；本機依賴使用既有離線 vendor 與 CGO_CFLAGS=-O1 -g0（非部署設定）。

## 唯讀工具與限制
`legacy-v66-drive-review` 只提供唯讀審核；輸出 placement.json、drive-inventory.json、baseline.json、summary.json（publication_approved=false、external_writer_fence_verified=false）。範圍 2026-09-20–11-15 全57日，須另行批准實際 cutover；未以真實帳號執行。未使用 OAuth 憑證、未讀寫真實 Drive、未停止長測、未修改舊服務或主機。

新分支 staging binary 在啟用 Drive 時要求 `--drive-lease-dir`，包括 recovery；同一 namespace 所有新程序應使用同一外部私有目錄。既有已運行長測 binary 不受此變更影響，且舊 binary 不遵守共同 namespace lease，仍必須另行停止與核對。Linux flock 只保障同一主機同一 inode 的協作程序，不能排除其他主機、未遵守協定程序、OAuth app 不可見的遠端物件。`ExternalWriterFence` 必須由後續正式操作工作流提供獨立可驗證的排他機制，沒有預設 true adapter、沒有真實發布 CLI。不得用合成計畫、合成 ID 或測試 fence 發布。真實 adapter 全55日端到端 Drive 發布未驗證；現有 mock HTTP transport、gate stub 及前輪 coordinator 分別驗收。正式操作先完成第九次長測、保護原備份、核實所有相關 writer 停止與目錄完整性、11/14–15交界及批准切點，再提交真實唯讀證據與匯入計畫。原兩日界/完整日 Phase0 CR-09 未滿足仍是阻塞；正式切換需獨立批准。

## 離線重現
```bash
cd vnext
go test ./internal/archive/drive ./internal/lease -run 'TestStrictImportInventory|TestImportInventoryPaginationAndDurableReservation|TestImportStateBoundToPlanAndDirectory|TestNamespaceLease|TestStoppedRootLock' -count=1 -v
MD_DRIVE_GATE_QA_STAGE=/absolute/path/synthetic-qa-stage go test -tags sqlite_integration ./internal/legacy ./internal/store -run 'TestStoppedDriveReviewMultipleRoots|TestRealPlanDriveGate|TestStoppedPlacementReadOnly' -count=1 -v
go build -tags sqlite_integration ./cmd/legacy-v66-drive-review
go test -tags live_ws,sqlite_integration,secure_auth ./...
go vet -tags live_ws,sqlite_integration,secure_auth ./...
```

## 後續真實唯讀審核命令（僅規格，現在不要執行）
```bash
./legacy-v66-drive-review --stopped-root "$VERIFIED_STOPPED_ROOT_1" \
  --stopped-root "$VERIFIED_STOPPED_ROOT_2" \
  --credentials "$PRIVATE_OAUTH_FILE" --drive-state "$EXISTING_PRIVATE_REVIEW_STATE" \
  --drive-lease-dir "$SHARED_PRIVATE_LEASE_DIR" --cutover-ms "$REVIEWED_CUTOVER_MS" \
  --out "$FRESH_REVIEW_OUTPUT"
```
須列舉所有實際相關 roots，而非只列兩個範例。審核結果不授權寫入，鎖釋放後必須重新取得並重驗。不得把秘密傳入聊天或提交 GitHub。現有 Phase5 plan prepare/inspect 使用正式審核的 placement、baseline 檔及其 SHA；本次尚未產生實際可發布計畫。