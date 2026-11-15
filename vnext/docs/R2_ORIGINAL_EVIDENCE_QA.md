# R2｜原始歷史證據獨立封存（2026-11-15 UTC+8）

## 目前完成
- tools/original_evidence_bundle.py（commit e804690282c53bf938a9fe0656f1e167c993ac0a，blob 24563227e2042a52ad4c622202e0d4237af8ba37）。本機相同 blob 執行 self-test 五項通過，0.019 秒：逐位元複製/回讀、不覆寫、錯來源/不完整、額外檔案/篡改、gzip 截斷、symlink/錯 manifest。release-qa CI 新增自測（07056bc4）；新 CI 結果尚未取得。
- 兩份既定輸入 SHA256 固定在程式，不接受使用者在 CLI 任意改 expected hash。新版另驗壓縮/解壓大小與 raw SHA；舊版 raw hash 由固定壓縮 bytes 解壓完整計算，非獨立既定值。1MiB 串流，不載入完整gzip/解壓資料；不重壓、不修值、不改原始檔。不接受 symlink、非普通檔、讀取時變動、重複輸出目錄、錯 hash/大小、超限、未完整解壓及額外檔案。輸出 0700 專用目錄，原始 bytes 0600，fsync，獨立回讀；失敗目錄保留、不自動刪除，驗證拒絕不完整 bundle。依賴獨占且可信的離線工作目錄，不是防同 UID 惡意並行修改的安全邊界。
- 工程候選：原始證據使用獨立 Drive 根 MarketDepth-VNext-evidence（名稱待審），與 staging/production 歷史日庫 namespace 分離。避免現有 strict import inventory 將 legacy/config 判為未知日庫物件；不修改日庫/manifest/復原契約。兩份 gzip 以完整 SHA256 作檔名，manifest 記 role、壓縮與解壓 hash/bytes，兩份皆保留；manifest 自身 SHA 作獨立驗收錨點。禁止覆寫、重壓、rotation 或垃圾桶退役原始證據。這是設計與離線工具，不是遠端 immutable/WORM 保證。
- 原始證據須在外部工作機操作，不在512MiB長測VM建置。真原始檔本輪未取得，沒有真資料重跑、真Drive上傳、正式匯入或批准。

## 使用（外部 Linux 工作機，已知兩份原始gzip，非部署）
```bash
python3 vnext/tools/original_evidence_bundle.py self-test
python3 vnext/tools/original_evidence_bundle.py prepare --old "$OLD_GZIP" --candidate "$NEW_GZIP" --output "$NEW_PRIVATE_BUNDLE"
python3 vnext/tools/original_evidence_bundle.py verify --bundle "$NEW_PRIVATE_BUNDLE" --manifest-sha256 "$VERIFIED_MANIFEST_SHA"
```
輸出 local_readback_verified=true 只代表本機回讀；remote_verified=false、publication_approved=false。manifest 必須與獨立保存之 hash 一致。不要把原始資料、帳本、憑證上傳 GitHub 或 CI。

## 尚未完成的真實歸檔門檻
1. 實際兩份 gzip 外部重跑並留 manifest SHA；來源稽核/393差異報告固定 hash。
2. 最終舊版尾端匯出另取原始檔、時間範圍、版本、hash、raw hash、稽核；不修改上述固定兩份來源，不自動將未知尾端納入。
3. 非秘密設定只允許由程式重新生成明確欄位（contract/schema/producer/交易對/區間/時區/頻率及數值公式版本），不直接拷貝任意 .env/JSON/YAML、OAuth、session key、bcrypt、API key、SSH 或主機私人設定。待建立 schema 及負面測試。
4. 獨立真 Drive namespace 及 scope/owner/quota/唯一 key/ID/重試 reservation/遠端媒體全量下載 hash 驗證；另保存遠端證據 manifest/ID/hash。須有批准及外部獨占寫入證據，drive.file 的可見性不能證明全帳戶無碰撞。遠端物件刪除/替換不得被稱作不可變保留。
5. 另行批准真上傳；驗證後才完成 R2，不因本機 self-test 通過而解鎖正式 run。現有兩份/最終尾端/非秘密設定和原五代/840尾端均須保護。
