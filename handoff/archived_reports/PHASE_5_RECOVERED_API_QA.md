# Phase 5｜55 日歷史封存復原後 API 全量驗收
日期：2026-11-15 UTC+8。離線實測，不代表已正式發布。

## 來源與版本
- 分支 `phase5-legacy-import-qa`，測試 commit `12134d4c4d7e34fc4669361f1e816099a03e99c5`，測試檔 blob `a18ec33ff717dfe76ca8861e57d7e3cdc424b4ca`；CI run 43663117715 success（不含私人資料的 opt-in 測試）。
- 前輪 55 日合成計畫 SHA256 `75918607114f70736d751d9763f6beb2e53001d4f11a94e5d9eab09fb746d788`。使用其確切 gzip 檔及 55 份發布進度紀錄重建唯讀 mock remote（110 個物件，ID、大小、SHA、原清單相符）。不將合成 placement、cutover、租約或物件 ID 視為真實 Drive 證據。
- 候選 manifest SHA256 `d7ac243f9d692d7fcf827f018d5a95e8223261dd2d422aa712f71b0209ab3dbf`，來源帳本 SHA256 `6657aaad3f1a55843e4f6d49aa1342ce854fc52acb464f38b74ae76ccc24fab1`。11/14、11/15 共 22,500 筆隔離不納入。

## 真實資料測試結果
- 全新本地目錄 `RebuildVerifiedCatalog` 55 sealed days、55 revisions、0 snapshot-only、0 loss；135.352 秒、165 GET。關閉後重新開啟 catalog，RecoveryCompleted、全部 55 日禁止收集，使用 ArchiveReader 而非候選讀取器。
- TLS 測試伺服器、bcrypt、session cookie、未登入401、錯Origin403、無效查詢400、錯分頁游標/不同過濾409、跨午夜 BTC Binance 10列（limit3）；days狀態與 archive SHA/ETag，latest無假即時資料，sync無行情且指向 sealed history，logout通過。
- 55 次逐日 gzip JSONL API 匯出，逐筆 canonical JSON bytes 與來源帳本比對，spot 807588、F1 235305、F10 0，合計1042893；55份尾端唯一manifest、CRC/EOF、各kind計數及逐日缺格核對通過，沒有補值。原始 legacy_unknown / NULL availability/來源與品質 JSON 由逐列 byte equality 保證保留。
- 3 個代表性封存下載（09/20、11/03、11/13）Content-Length、實收 SHA256、X-Archive-SHA256、ETag 完全相符。held days 11/14、11/15 未被模擬目錄暴露；remote GET 285、PUT 0、110 物件數不變。history cache 清除成功。
- 測試 300.593s，含編譯 wall 301.61s，峰值 RSS 134360 KiB（本地測試，非512MiB Sydney 主機）。exit 0。詳見原始 log。

## 邊界及下一步
- 這是 55 日全量復原及逐日 API 匯出，並非 31 日單次匯出效能、正式公開 HTTPS、實際 Drive 或混合日測試。3 個下載抽驗，不是 55 次下載。mock 僅重建這 110 個 legacy 物件，不代表現存實盤備份也已納入本輪復原；此前批次 mock 測試另證明 11 個模擬既存物件不變。
- 此輪僅新增 opt-in 測試，未修改收集器/發布邏輯；不合併主分支、不部署、不操作 Drive 或長測主機。
- 下一步真實 Drive 唯讀 inventory、排他 ImportGate/持久 reservation 的實作與離線測試，實際操作等長測結束並核對真實 writer 狀態、保護基線、placement/cutover、11/14–15 混合日。正式發布另批准。

## 重現
在指定分支、原本已核對的候選 manifest 與 ledger 及前輪 mock prepared stage 下執行：
```bash
cd vnext
export MD_RECOVERED_QA_CANDIDATE_ROOT=/absolute/path/daily_candidates
export MD_RECOVERED_QA_MANIFEST_SHA256=d7ac243f9d692d7fcf827f018d5a95e8223261dd2d422aa712f71b0209ab3dbf
export MD_RECOVERED_QA_STAGE=/absolute/path/synthetic-qa-stage
go test -tags sqlite_integration,secure_auth ./internal/httpapi -run '^TestRealRecoveredLegacyAPI$' -v -count=1 -timeout 14m
```
測試固定前輪計畫 digest，若重新產生計畫導致 hash 改變，須另行驗證並更新測試固定 digest，不能當成真實發布批准。沒有 OAuth 輸入或實際遠端 PUT 功能。
