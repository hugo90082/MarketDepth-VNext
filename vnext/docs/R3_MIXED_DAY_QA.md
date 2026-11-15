# R3｜混合日離線接合方案及驗收（2026-11-15 UTC+8）

## 範圍與安全狀態
新增 internal/mixedday/plan.go 與 cmd/mixed-day-plan，僅離線 proposal，沒有 SQLite 寫入、Drive、正式切換或 deployment。既有 legacy sealed revision1、live manifest、catalog、API、recovery gate 原樣不動；不能把 proposal 當作正式日庫。第九次長測提前停止，使用者已交 Codex 分析；不在512MiB VM執行本工具。11/14、11/15共22500候選列仍 hold，原五代、840尾端及第九次四代及停機後尾端保留。

## 接合規則（工程候選，須獨立真實證據與批准）
- UTC+8 單一日期內，切點嚴格在日內且對齊分鐘；以行情主鍵時間 t 判定半開區間：[日始,cutover) 選明示 legacy 來源；[cutover,日末) 選明示 live 來源。對 futures bars，分鐘對齊避免 bar 跨切點。此為歷史 canonical 分配，不是 available_at 因果證明；所有 row 保留原 available_at/status/source/revision，不重標籤、不逐欄混合。
- 來源為已驗證單日 canonical Go JSONL envelope，格式 {"kind":"spot_depth","row":{...}} LF（同理 futures_10s / futures_1m），固定原檔 SHA256；每角色明示一份 authoritative SHA，額外來源只作證據。輸入最多8份、每份64MiB、合計128MiB，單行1MiB、每來源最多47520個唯一key。此為外部離線工作機預設，不是 VM 容量限制。原始 gzip、ledger、DB、source export、placement、報告須外部完整保存。
- 每列 model.Decode/Validate 及 canonical JSON byte equality；拒絕錯日、錯grid、重複主鍵、錯來源、未知/重複/缺少欄位、非 canonical 編碼、非LF、錯SHA及跨日切點。legacy 只接受既有 v66-browser-jsonl-v1、legacy_unknown、NULL available_at、revision1、quality 非NULL、spot observed/trusted NULL；拒絕 legacy F10。live 只接受 vm_vnext 與已知 available_at，model.Validate 確認時間因果下界。這些結構檢查不等於來源真實性驗證，不能證明來源不是測試資料。
- 指定來源缺列即 absent，即使另一來源同key有資料，不 fallback。missing status 是存在的占位列，不算有效行情；legacy_unknown 不假稱有效實盤。F10 在切點前為 unsupported_legacy，不合成；若有 live 試跑的 pre-cutover F10，僅保留 excluded evidence。每列仍須後續實際值品質驗收。
- 決策按 kind/t/venue/asset 穩定排序；每個全日47520 grid key 記錄 role、選取/缺列/unsupported、全部來源及 row SHA、status、是否選取、differing_evidence（整列 canonical hash 不同，含 provenance/status/availability，並非深度金額差異）。不恢復使用者取消的新舊行情數值一致性門檻。每種 kind 的 selected+absent=expected；另記 unsupported、missing_status、legacy_unknown、excluded_occurrences、differing_keys。所有 evidence 原資料仍在固定 source JSONL；報告不是原始資料替代品。
- 切點及 authority 必須由實際最終匯出/first_target/正式 writer fence/舊資料末端/真 Drive inventory/placement 報告確定。placement SHA 只綁定傳入證據檔 bytes，不驗證外部事實；明示 production_ready=false、publication_approved=false。不能自動把測試 run 轉為正式來源。

## 程式入口
在外部 Linux 私有工作機，使用獨立審核的絕對路徑/固定 SHA，輸出目錄必須不存在，所有驗證完成才建新0700目錄，0600排他寫 selected.jsonl 及 report.json，fsync與逐位元回讀；中斷殘留目錄不覆寫不刪除。stdout 回傳兩個 SHA 與統計。沒有網路、憑證或正式發布旗標。沒有獨立 CLI verify 模式，需以相同 inputs 在另一新目錄重跑比對；現行候選 SQLite 或原 gzip 尚需專用可驗證 export adapter 才能輸入，不可手工改 row 使它通過。

```bash
cd vnext
go test ./internal/mixedday ./cmd/mixed-day-plan
go build -o mixed-day-plan ./cmd/mixed-day-plan
./mixed-day-plan --day "$MIXED_DAY" --cutover-ms "$REVIEWED_CUTOVER_MS" \
  --legacy-sha256 "$LEGACY_DAY_SHA" --live-sha256 "$LIVE_DAY_SHA" \
  --placement "$REVIEWED_PLACEMENT" --placement-sha256 "$PLACEMENT_SHA" \
  --source "legacy:$LEGACY_DAY_SHA:$LEGACY_DAY_JSONL" \
  --source "live:$LIVE_DAY_SHA:$LIVE_DAY_JSONL" \
  --output "$NEW_OFFLINE_ROOT"
```

## 同日版本與正式封存（尚未實作；不能解鎖既有防護）
工程建議：單一混合日首次正式 archive revision，後續修復新增更高 revision，獨立 immutable object keys 與 manifest、前一版 digest/ID、完整 source proof/placement/decision report digest、完整逐列 hash/count；明確區分 archive revision 與 row source revision。舊版仍可精確下載，最新可見版本需單一 verified pointer，API cursor/ETag/cache 依 archive revision 失效；不得將 legacy sealed r1 修改 data_origin，亦不得將已有 active/loss 靜默轉正。正式建庫、mixed proof 版本、manifest validation、catalog/recovery/restore/HTTP/cache 的端到端測試需另做，既有 strict reject 維持。也須審核測試命名空間原備份不進正式 namespace。
- 本輪測試初版 17aed0c8 CI 43670239404 失敗：F10 兩分鐘分母誤寫18，實際 36 (12格x3)，程式回傳正確；2ce8567e 更正斷言，98b61c6f 加 LF 防護。CLI 247c119b、test ac5e00af 已提交；後續CI以真實結果為準。未用真實日庫或新舊尾端執行。
