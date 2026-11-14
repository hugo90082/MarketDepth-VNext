# Phase 5｜57 日真實歷史候選資料 API 離線驗收
2026-11-15 UTC+8｜本輪非正式匯入、非正式封存、非實盤部署。

## 鎖定證據
- 原始 gzip 88097e060d0c4cdd689971641e14b7a41c0857bcf2104b15ba119fe22d65e79b；raw d1d4cf64e04eb19bc7412d70d0cbb5904c8adb8ad867fcb79ce9caf70dec243e。前輪驗證的 manifest SHA256 d7ac243f9d692d7fcf827f018d5a95e8223261dd2d422aa712f71b0209ab3dbf，57日 SQLite、帳本 SHA256 6657aaad3f1a55843e4f6d49aa1342ce854fc52acb464f38b74ae76ccc24fab1。
- 實際 Go 後端 httpapi.API + SQLite 讀取；本機 httptest.NewTLSServer，bcrypt cost10 測試密碼/session，非公開服務，無正式憑證。程式 b1206382eca5d0d045bb3d24d86b629729cbafd3（四檔blob逐一驗證），防呆測試 ec05c32ea3a0b58fc9371bf7b9d1f476b1cac108。
- Go1.23.2 / CGO / 原go.mod與go.sum。首次本機直接下載Go modules失敗（DNS/網路限制）；GitHub Actions43623874863成功go mod verify + vendor，artifact14125685651 ZIP SHA256 1475b1eaaded1818165152dd30dee5687e897ef043a5781e8e55dc72d09d8623，內部tar SHA256 adb24285f5ee2a880a73fa112519c2bb46778c95f337d06d8e8916f39e0d199b，兩個module檔SHA相符。本機GOPROXY=off編譯測試，不上傳任何市場資料至GitHub CI。依賴包不含歷史資料。
 
## 隔離模式及安全
- 新CandidateReader只有唯讀查詢介面，原57日的candidate_only=true、data_origin=legacy、schema、SHA、完整key grid、count、無sidecar、manifest狀態啟動時驗證；exclusive offline directory 前提，檔案stat檢查及結束全檔重hash。不是正式並行writer的讀取保證。
- API.Candidate=true、Live=true僅使用原authenticated API handler與export版本屏障，明示header X-MarketDepth-Mode: offline-candidate-qa，meta/manifest candidate_only=true, production_ready=false，days.state=candidate_only；此狀態只供QA，不新增正式OpenAPI state。拒絕候選Reader誤接一般live或匿名mock。無真collector、無Drive、無公開部署。history游標依session generation、kind、查詢、filter綁定；新process需重抓。正式API預設不變。
- sync 因沒有實盤ingestion journal，正確回503；day下載因未核准封存，正確回503；不得製造游標事件或封存證據。futures_10s為空，缺格正常顯示。正式讀寫/封存共同guard拒絕存在fixture_only或candidate_only marker（即使誤把data_origin改live也拒絕），新增負面測試通過。

## 真實結果
TestRealCandidateAPI (100.93s)，含57日全部api/v2/export（每天一個gzip、依既有500筆內部分頁）、每行raw JSON與來源帳本row_json byte-for-byte相符，全部唯一末manifest、EOF/CRC、row_counts、gap accounting通過。57/57日、825588 spot + 239805 F1 = 1065393、F10=0；NULL/0、原quality/legacy_unknown/available_at=NULL原樣。日清單57日、latest三種、跨11/14→11/15午夜BTC Binance 10筆（limit3、多頁、改filter/錯cursor→409）、無登入401、錯Origin403、登入/登出Secure HttpOnly cookie、錯kind400、sync/day503皆通過。結束57日與manifest SHA重驗不變。測試整體含編譯2:18.30、最大RSS389868KiB，非512MiB VM性能證據。原有store/httpapi suite本機通過；候選flag負面測試另通過。CI不跑真實資料（環境變數無值即skip），不能取代本次真實QA。
 
## 本機重現（非生產環境）
解開前輪日庫ZIP與證據帳本ZIP至同一獨立root（manifest完全一致；禁止覆蓋不同檔案）。保留原gzip。
```sh
cd vnext
export MD_CANDIDATE_QA_ROOT=/absolute/offline/daily_candidates
export MD_CANDIDATE_QA_MANIFEST_SHA256=d7ac243f9d692d7fcf827f018d5a95e8223261dd2d422aa712f71b0209ab3dbf
GOPROXY=off go test -mod=vendor -tags 'sqlite_integration secure_auth' ./internal/httpapi -run '^TestRealCandidateAPI$' -count=1 -v -timeout 15m
unset MD_CANDIDATE_QA_ROOT MD_CANDIDATE_QA_MANIFEST_SHA256
GOPROXY=off go test -mod=vendor -tags 'sqlite_integration secure_auth' ./internal/store ./internal/httpapi
```
需先在外部建置機取得並驗證pinned vendor，或使用已驗證的Go module cache（不用-mod=vendor）。正式VM不執行此QA。

## 仍未完成／下一步
1. 原55日（9/20–11/13，1042893列）為候選可審核日期，不代表真實placement清空。11/14及11/15（22500列）需隔離；等待第9次24h真實first_target/各日封存、原五代及最新staging inventory，再核對日期及逐key衝突。
2. 正式歷史archive路徑現有live metadata與validateLiveWrite護欄，不能直接用候選DB改檔名、移除flag或冒充live。需實作獨立的legacy proof驗證、正式日檔建立/封存、archive manifest版本/來源語意、catalog重建及API讀取對legacy_unknown的安全支援；保留原可用時間unknown與coverage unknown，無F10合成。先離線fixture再真實資料驗收。現有LegacyDayProof/InspectPlacement僅審核提案，不是授權或證明，需實際核對本機及完整Drive listing、正式cutover與來源/映射/日庫hash。混合日需另定revision與交界，不覆寫。
3. 長測完成前不修改VM、服務、Drive、原始資料或既有五代；正式發布/正式cutover需明確批准。V66真正前端、正式archive及TLS另驗。