# Phase 5｜歷史來源證明與封存準備（2026-11-15 UTC+8）

## 結論
- 原始 gzip、解壓內容、來源稽核、映射器、全量候選產生器、SQL schema、57 日候選 manifest、來源帳本及每個 SQLite SHA256 再次驗證。逐日 ledger 主鍵/候選雜湊摘要、SQL 計數、歷史標記、NULL availability、空 10s/events、quick_check 均通過。逐日暫存 gzip（level 6、mtime 0）解壓後雜湊相同；無正式封存或遠端寫入。15.17s、峰值 RSS 102812 KiB。來源證明**草案** SHA256 e1a8d8feda9acc7fbecc4676a792f27929f96fd13069c1203995c57b6835c418。
- 55 日 1,042,893 筆、候選 gzip 80,025,306 bytes；11/14～11/15 兩日 22,500 筆，1,763,696 bytes，隔離。共 81,789,002 bytes，原日庫 696,700,928 bytes。最大單日候選 raw 19,148,800 bytes、gzip 1,957,125 bytes（11/03）。這是候選壓縮試算，不是正式封存容量或 Drive quota；正式 proof/metadata 會改變檔案。原始 gzip、日庫、帳本全部保留，不可用此試算取代容量門檻。
- BindV66Proofs／CLI 已驗證：用實際草案及**明確合成**的 57 日 placement 觀測，55 日證明符合現有 LegacyDayProof、兩日不輸出；錯誤 draft/placement SHA、碰撞均拒絕；所有輸出 publication_approved=false。真實 placement 尚未觀測、cutover 未定；草案 cutover_ms/placement_report_sha256 均 NULL，不可直接發布。此工具要求核定的實際 cutover、真實停止 writer 環境的 local+remote 觀測及獨立摘要；只驗證結構與綁定，不證明觀測真實或取得發布權。
- 現有 archive.PublishSealed／PublishActive 拒絕 data_origin=legacy；snapshot.checkSnapshot 只接受 live，實際 11/13 候選被拒絕；mock remote PUT/GET 均 0。這是正確的既有防護。不得改標 live、移除 candidate_only 或只改 manifestKeys 便發布。程式 commit 0646adb4a7fd9c5ffa21bf8d902346737a5b0adb。測試為離線，不代表真 Google Drive、正式 TLS 或長測完成。

## 下一步：正式 legacy 封存能力（尚未實作）
1. 新增獨立的歷史封存建置入口（不直接修改候選檔）：必須逐日核對完整原始證據、獨立 mapping/audit/rows SHA、已綁定的真實 placement、明確 cutover 及發布批准。新輸出與原候選隔離，固定 `data_origin=legacy`、`legacy_unknown`、`available_at=NULL`、無 10s/events；候選防護保留於原路徑。正式封存日期是實際封存時刻，不是假造的歷史可用時間。
2. 定義向後相容的 sealed legacy manifest／proof 綁定（不得允許 legacy active generation，也不得無條件放寬 live validator）；驗證 proof digest、正確原始來源、日界、revision、每列 origin/status/null、SQLite schema／counts／SHA、缺格範圍、壓縮讀回。考慮 proof 持久化在 sealed SQLite 和 manifest 的明確版本欄位，必須同步擴充遠端讀取、復原、日庫 catalog、API history/export/day；既有 live manifest 仍應完全相容。
3. 單 writer，既有 staging/正式 namespace 不混用、不假設空；停止後取得完整 local + Drive inventory（含孤立 gzip、已封存、active、loss 與 pending），用現有 InspectPlacement 真實報告；任一碰撞或不確定停止。55 日可先審核但不直接推定沒有碰撞。11/14、11/15 另作歷史/新版切點與混合日版本規劃，保護原五代及 840 筆本地尾端。混合日不能用本版 whole-legacy proof。
4. 先在完全離線 mock 上做正式 legacy publish / 失敗重試 / GET-only recovery / catalog / API 測試，尤其未知來源、hash 不符、重複 key、manifest 寫入中斷與誤標 live。不得覆寫原始、不得清除 loss 或碰撞資料。之後才取得使用者正式 Drive 歷史寫入批准，先少量批次驗證再逐日發布；正式切換另行批准。

## 重現
在 vnext 專案根目錄執行（外部離線機，使用已驗證原始檔與資料夾）：
```
python3 tools/legacy_v66_source_review.py --candidates "$CANDIDATES" --input "$ORIGINAL_GZIP" --audit "$AUDIT_JSON" --adapter internal/legacy/v66_adapter.go --stream cmd/legacy-v66-candidates/main.go --schema contract/schema.sql --out "$NEW_REVIEW_JSON"
MD_REAL_V66_REVIEW_DRAFT="$NEW_REVIEW_JSON" go test -tags sqlite_integration ./internal/legacy -run TestRealV66DraftBindingSyntheticPlacement -v -count=1
MD_REAL_CANDIDATE_SQLITE="$CANDIDATES/days/candidate-2026-11-13.sqlite" go test -tags sqlite_integration ./internal/store -run TestRealLegacyCandidatePublicationGuard -v -count=1
```
後續僅在取得真實 placement 與外部核對的 canonical report digest 時，才可執行：
```
go run -tags sqlite_integration ./cmd/legacy-v66-bind-review --draft "$NEW_REVIEW_JSON" --draft-sha256 "$VERIFIED_DRAFT_SHA" --placement "$ACTUAL_PLACEMENT_JSON" --placement-sha256 "$VERIFIED_CANONICAL_PLACEMENT_SHA" > "$NEW_BOUND_REVIEW_JSON"
```
後者不是發布指令。其輸出只是來源與目錄觀測的綁定審核，仍須獨立核實真實與新鮮度及正式批准。