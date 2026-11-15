# MarketDepth VNext｜正式版本整合 R1（2026-11-15 UTC+8）

狀態：整合分支建立、共用執行核心及正式唯讀設定預檢完成；正式收集器啟動尚未開放。不是 Phase8 核准、不是部署。

## 固定版本與驗證
- main a3ce24510d63e9b55af27a52096a61a412eb3769、phase5-legacy-import-qa da2c4455cb7c5fff7742f30f0eabc9b80706aa98，merge base b0e15f135f4eb7e983fa1a5825a0bfe3ff48ea8e。逐個 Git blob 比對，32個變更、0衝突、0遺漏最新main文件、0既有程式衝突；以雙 parent merge commit 4a18f1015544ff5cae8becb3013306e901779cc2 建立 vnext-release-qa。功能commit 849e86029e4c3122eedd4fefb22f7faf54091e0f，15檔Git blob與本機一致、2個舊位置移除（移到internal/runtimeapp，測試保留）。main及實盤未變更。
- 原 collector、store、API、Drive worker 與 recovery 流程集中到 internal/runtimeapp，保留原 staging CLI 及旗標；收集頻率、交易對、五區、契約、SQLite DDL、OAuth scope、數值公式不改。共同 namespace lock 移入 RunStaging/RecoverStaging 保持整段持有，必須位於資料/credential之外；既有 root 只認對應私有 marker 且拒絕雙 marker。
- 工程決定：正式 namespace 候選 MarketDepth-VNext（原規劃建議名稱），staging 保持 MarketDepth-VNext-staging；各自 marker及lock名分離。正式名稱/實際目錄仍須正式切換審核。原測試資料及原五代不自動移動、複製、轉正；既有長測 binary 不改。
- cmd/marketdepth 保留 --mock，新增完整標籤版本 --check-production。只檢查本機 canonical 絕對路徑、已列舉的 protected old/staging roots、外部私有OAuth檔及鎖目錄、numeric loopback、精確HTTPS origin、bcrypt、session key及producer 40-hex。憑證僅檢查格式和權限，不做OAuth交換。預檢成功仍回傳 production_ready=false、activation_allowed=false、network_checked=false；不建立 root/lock、不讀取/修改SQLite、不連線、無正式 run/recovery/Drive寫入命令。正式 profile 的內部 run/recovery/configuredDrive 防護仍拒絕。不得把此預檢當排他證明或批准。
- 本機Go1.23.2、已驗SHA的離線vendor、CGO_CFLAGS=-O1 -g0（測試環境）；三組go test、完整tag go vet、SQL schema/OpenAPI、daily_sql、legacy_inventory/raw_stage、resource_probe/staging_preflight/phase7_evidence全部通過。編譯兩個實際CLI，synthetic credential fixture測試預檢正例、無模式/假run/混合旗標、公開port、舊root、非HTTPS、缺lease及不建root/不改舊檔；通過。新增namespace互斥/隔離、root marker、runtime lock enforcement與拒絕production activation測試。曾因新增測試變數名稱遮蔽造成編譯失敗，修正名稱後全部重跑通過。私有歷史 opt-in 實跑證據仍為前輪，不重新上傳資料。
- 新 workflow release-qa.yml 僅隔離分支，無部署、無秘密，執行完整回歸/race/vet/契約、五個 binary 建置、CLI預檢及壓縮包完整性；package QA_ONLY、producer/SHA、非正式發行。CI run 43669115696；以實際Actions結果為準。請勿拿此候選取代現行長測版本。

## 預檢使用（離線；正式環境未執行）
```bash
go build -tags live_ws,sqlite_integration,secure_auth -o marketdepth ./cmd/marketdepth
./marketdepth --check-production --data-dir "$NEW_PRODUCTION_ROOT" \
  --protected-root "$EXISTING_OLD_ROOT" --protected-root "$EXISTING_STAGING_ROOT" \
  --drive-lease-dir "$PRIVATE_EXTERNAL_LOCK_DIR" --drive-credentials "$PRIVATE_OAUTH_FILE" \
  --producer-commit "$VERIFIED_BUILD_COMMIT" --listen 127.0.0.1:18083 --origin "$REVIEWED_HTTPS_ORIGIN"
```
MD_SESSION_KEY_B64/MD_PASSWORD_BCRYPT 由受保護環境注入；不要貼進聊天。實際 roots 必須列舉全部，以上僅範例，不是正式部署指令。

## 當前 release 門檻（FINAL_READINESS_REVIEW R1–R8 的當前狀態）
| 門檻 | 當前狀態 |
|---|---|
| R1 程式整合 | 分支整合/共用runtime/本機預檢完成；正式run、production namespace 的匯入與復原仍鎖定 |
| R2 原始gzip/非秘密config | 尚需正式不可變證據歸檔；兩份原始gzip及尾端版本皆永久保留，勿常駐VM |
| R3 混合日與切點 | 11/14、11/15保持隔離，正式尾端待實際cutover；同日revision/混合來源實作未完成 |
| R4 Drive正式發布 | 已有離線coordinator/gate，仍需真實writer fence、production namespace及發布CLI、批准計畫 |
| R5 V66 | 未取得最新C source/build/proxy/瀏覽器驗收 |
| R6 長測 | 使用者回報啟動，未取得實際第九次報告；原兩日界/完整曆日gate保留 |
| R7 正式運維 | 容量/HTTPS/31日匯出、正式systemd與回復未驗收 |
| R8 文件治理 | 本文件及Master Log追蹤；舊README早期mock說法以本次更新為準 |
下一步補 R2 原始證據封存與明確的production namespace/目錄隔離，保持正式run拒絕；R3、R4完成及實際長測/前端驗收後再決定啟動門檻，正式發布與Phase8另批准。未操作主機、真Drive、舊服務、OAuth或目前長測。