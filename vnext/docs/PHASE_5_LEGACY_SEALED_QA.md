# Phase 5｜歷史封存與復原能力離線驗收（2026-11-15 UTC+8）

## 結果及證據
- 程式獨立分支 phase5-legacy-sealed-qa，commit 9ace419471819590f03efae4398599bc3f24ac4f；以 main b0e15f135f4eb7e983fa1a5825a0bfe3ff48ea8e 為基底，13 個程式檔案 Git blob SHA 與本機測試版本一致。未合併或部署。
- 真實 source review draft SHA256 e1a8d8feda9acc7fbecc4676a792f27929f96fd13069c1203995c57b6835c418；實際原始資料及候選日庫已於前階段全量核對。本輪使用**合成** placement 和 cutover（2026-11-14 00:00 UTC+8），不代表已核對真實遠端目錄或批准匯入。
- 55個日期 2026-09-20～11-13，全量807588 spot+235305 F1=1042893；F10=events=0。各日以新SQLite schema逐列建置，核對候選檔SHA、canonical row digest、來源/品質/NULL、封存proof、解壓後schema與列digest；55/55通過。合成驗收 raw681594880 bytes、gzip80021678 bytes，非正式上傳檔大小；五批測試14.714+16.220+15.709+16.239+5.323秒。11/14與11/15共22500列保持hold，不建置混合日。
- 11/13實際21600列（spot17280/F1 4320）：本機新日庫、模擬遠端 immutable two-object 發布、manifest失敗重試、同ID重試、GET-only新catalog復原、歷史查詢原列比對、sealed下載均通過，最終10.604秒。測試中先因scratch目錄權限不符遭安全拒絕，修正測試目錄0700後通過，未放寬程式。錯proof、篡改gzip、重覆build、live publisher拒絕legacy、重標live仍帶proof、legacy不走普通catalog註冊、同日recovery禁止收集皆驗證。
- 本機 Go1.23.2，GOPROXY=off/mod=vendor；go test -tags sqlite_integration ./... 及 -tags live_ws,sqlite_integration,secure_auth ./... 全部通過；新分支遠端CI尚未完成。上一階段main CI43625558446/43625642141/43625674720成功。

## 設計與保護
- shared legacyproof 独立封包，保留既有proof wire格式；legacy manifest 新增選用proof/hash欄位，live序列化不帶該欄位。legacy限完整曆日的單一V66來源、revision1、legacy-r1、sealed；禁止active、混合、與其他revision/active/loss同日復原。舊日live writer/封存/正常註冊維持live-only，正式legacy只透過驗證後的新catalog rebuild。
- PrepareReviewedV66Day 綁定已審核draft、placement及day proof SHA，held dates直接拒絕。BuildReviewedLegacySnapshot 使用全新私有目錄與SQLite schema，不修改原候選或移除旗標繞過，逐列重新建立、雜湊校驗。保留data_origin=legacy、status=legacy_unknown、available_at=NULL、新coverage未知，不製造10s；封存時間必須在切點之後。
- PublishPreparedLegacySnapshot 先私有固定副本並完整解壓/驗證再遠端操作，獨立immutable data+manifest與readback；失敗重試需原prepared bytes及manifest，不重建覆寫。RestoreVerifiedDay 可辨識經proof驗證的legacy，RecoveryGrid及歷史讀取支援；正常live路徑不放寬。此為程式能力，沒有接正式發布CLI、沒有OAuth/真Drive執行，沒有真實placement/排他操作批准。
- 本輪55日測試是離線建置與復原，單日mock remote及store reader驗收，不等同55日真Drive或正式HTTP/TLS驗收。既有API handler回歸測試通過；尚須用新catalog實際HTTP全量驗收，核對真實legacy缺格／來源資訊與V66顯示。需確認整合分支與main一致，完成CI。

## 下一步（不得提前寫Drive）
1. 完成歷史正式匯入協調器（先read-only inventory/plan、實際停止writer、確認namespace/quota、source proof與批准的cutover；每批再次核對碰撞，原備份保護、可中斷同ID重試、持久ledger，明確禁止混合日）。先離線mock全批與中斷情境驗收，正式歷史發布需另批准。
2. 等第九次24h實盤驗收結果與first_target/現存目錄、原五代及840本機尾端證據，處理11/14、11/15的時間接合及混合日（本版whole-legacy proof不支援）。不可將測試日期或其未證實尾端覆寫/補零。
3. 用新catalog做實際HTTP讀取、匯出、sealed下載、跨日與前端驗收，整合通過後才部署；正式切換另行批准。

## 重跑（離線）
```bash
export MD_REAL_CANDIDATE_ROOT=/path/to/daily_candidates
export MD_REAL_V66_REVIEW_DRAFT=/path/to/source_review.json
go test -tags sqlite_integration ./internal/legacy -run '^TestRealV66SealedBuildBatch$' -v -count=1 -parallel=4
go test -tags sqlite_integration ./internal/store -run '^TestRealLegacySealedRoundTrip$' -v -count=1
go test -tags live_ws,sqlite_integration,secure_auth ./...
```
測試可用 MD_REAL_V66_BATCH_START / END 切半開區間[0,55)。實際資料須先驗SHA。測試產物是synthetic QA，不可發布。未修改正式主機、舊服務、Drive、原始資料及運行中第九次長測。
