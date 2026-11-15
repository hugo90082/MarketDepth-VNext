# Phase 5｜55 日歷史封存復原後 API 全量驗收
2026-11-15 UTC+8，離線實測，不代表正式發布。

## 版本、資料與結果
- phase5-legacy-import-qa commit 12134d4c4d7e34fc4669361f1e816099a03e99c5，測試 blob a18ec33ff717dfe76ca8861e57d7e3cdc424b4ca；CI43663117715 success，私有資料 opt-in 測試由本機實跑。
- 固定前輪合成計畫SHA75918607114f70736d751d9763f6beb2e53001d4f11a94e5d9eab09fb746d788；以55個prepared gzip及55份progress重建唯讀mock remote 110物件，逐一驗ID/size/manifest/hash。候選manifest SHA d7ac243f9d692d7fcf827f018d5a95e8223261dd2d422aa712f71b0209ab3dbf、來源帳本SHA6657aaad3f1a55843e4f6d49aa1342ce854fc52acb464f38b74ae76ccc24fab1。
- 全新目錄RebuildVerifiedCatalog 55 sealed days/55 revisions/0 snapshot-only/0 loss，135.352s、165 GET；關閉重開、RecoveryCompleted、55日禁止收集通過。實際ArchiveReader，非candidate reader。
- 實際Go HTTP/TLS/bcrypt/session：未登入401、錯Origin403、錯參數400、不同filter及非法cursor409、跨午夜BTC Binance 10列limit3、days SHA/ETag、latest/sync不冒充即時資料、登出通過。
- 55次逐日gzip JSONL HTTP匯出，807588 spot+235305 F1=1042893列，F10=0，逐列canonical JSON bytes與來源帳本一致；55份唯一尾manifest、CRC/EOF、計數與各kind缺格正確。保留legacy_unknown、NULL及原來源品質資料。
- 09/20、11/03、11/13 三個sealed下載實收SHA/Content-Length/X-Archive-SHA256/ETag通過。11/14及11/15共22500候選列保持隔離，未加入mock catalog。全程285 GET、0 PUT，110物件不變；清除history cache成功。
- 測試300.593s，wall301.61s（含編譯）、peak RSS134360KiB、exit0。完整ZIP MarketDepth_Phase5_封存復原與API全量驗收_2026-11-15.zip，10646 bytes，SHA256 b277c5e5abc2670263a5e81b1d0f8f4a896e5e6ddd6ad2560975d90eaa8e9db0，5檔CRC及SHA核對。

## 重現
```bash
cd vnext
export MD_RECOVERED_QA_CANDIDATE_ROOT=/absolute/path/daily_candidates
export MD_RECOVERED_QA_MANIFEST_SHA256=d7ac243f9d692d7fcf827f018d5a95e8223261dd2d422aa712f71b0209ab3dbf
export MD_RECOVERED_QA_STAGE=/absolute/path/synthetic-qa-stage
go test -tags sqlite_integration,secure_auth ./internal/httpapi -run '^TestRealRecoveredLegacyAPI$' -v -count=1 -timeout 14m
```
固定前輪QA計畫digest，重新建置如hash改變須另驗，不可視為發布批准。未上傳私人歷史資料至CI。

## 邊界
不是31日單次匯出、正式公開HTTPS、真Drive、混合日、實盤與legacy共同復原或55次sealed下載測試。只新增測試，不改收集/發布邏輯，不部署，不接觸長測主機/Drive。下一步實作真Drive唯讀inventory、排他ImportGate及持久reservation，先離線驗證。正式操作仍待長測報告、writer停止與排他證據、真實placement/cutover、既存保護基線、11/14–15混合日及使用者另批准。