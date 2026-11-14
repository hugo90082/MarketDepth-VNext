# Phase 5｜正式來源初審與候選映射乾跑（2026-11-15 UTC+8）

唯一正式原始輸入：使用者新上傳 marketdepth-local-history-2026-11-14T16-59-33-347Z.jsonl.gz。舊11/12匯出不當正式來源。
- gzip 165,937,369 bytes、SHA256 88097e060d0c4cdd689971641e14b7a41c0857bcf2104b15ba119fe22d65e79b；raw 415,340,421 bytes、SHA256 d1d4cf64e04eb19bc7412d70d0cbb5904c8adb8ad867fcb79ce9caf70dec243e。
- 全檔329,184行、20,578 blocks、68,799 depth、239,805 candles、manifest/summary各1。gzip EOF/CRC、重複JSON key、區塊與總計數、時間格、數值、範圍均通過；重複時間格及非法深度/OHLCV皆0。深度2026-09-26 19:07–2026-11-15 00:59，缺2114分鐘；各商品1m 2026-09-20 12:45–2026-11-15 00:59，各79935無缺格。57個有資料日期、44個完整深度曆日。
- 224277個深度null、560個實際零、15678個全null venue/asset列；799062列十欄非null但不等同可信750。來源railway66193/browser2606，quality null66194/V2 2605；29565個book quality，顯式雙側observed7812。K線binance-usdm174280/source null65525；observedAt null70069、早於收盤33871、>=收盤135865；全部closed/complete但不能證明實際可用時間。depth a=t15707、a>t53092。

## 候選映射
以 V66 commit 1eba4b4ea8e07b1f6abd455f3d7d76a43c09030d 的 shared/local-history-export.ts、minute-history.ts、model.ts、contract.ts 語意及 MD-VNEXT-1 schema/model/legacy validator 核對。原匯出是逐block讀取的版本，非全庫原子快照。
- depth.t原樣，依[venue][asset][zone][bid-ask]展12列，四所 Binance/Coinbase/Kraken/Bitfinex、BTC/ETH/SOL，五區0–100/100–200/200–300/300–500/500–750bps USD名目（原quote按1:1，不換匯）。原數值、null/0保留。BBO/mid沒有即NULL。
- 舊a、source/format/captured/issues/finalVersion/quality version、per-book完整物件、block ID/revision/readAt等保留quality_json；book capturedAt存在則原樣captured_at，不當實盤可用時間。新observed/trusted bps均NULL，不將舊grouped/P2/coverage升級成新版可信證據。全部available_at=NULL、status=legacy_unknown、source=legacy:v66-browser-jsonl-v1、revision=1。此為既有ValidateCandidate的保守候選要求；不推斷舊a等同真實可用時間，未知時間排除實盤因果策略。
- candle原asset/t/OHLC/v（base quantity）映射futures_1m，quote_volume/taker/count NULL；原observedAt/closed/complete/source保留quality_json。null source不假稱合成或官方，所有資料仍legacy_unknown。10s=0，不合成。
- ratios保留原gzip，不新增儲存欄。V66舊ratio可能接受部分已知區間及單一來源；與VNext至少2家且區間完整的ALL4規則不等價，歷史顯示須分離標示。不得將缺失分鐘補0。
- 11/15包含60 depth及180 candle，即720 spot+180 F1=900筆；與第9次長測/11/14 staging備份的重疊須等真實first_target、placement/cutover明確核對。不得自行覆寫或混合。

## 執行證據
本機 Go1.23.2，adapter 4e8e5e78、test 129645fa、CLI a6904313。go test ./internal/legacy ./cmd/legacy-v66-dryrun 通過。兩次同步執行時間限制中止；另一次發現summary.assets為object與manifest.assets array差異，修正後完整重跑成功：36.82秒、peak RSS410468KiB（不可在512MiB VM跑）。全量MapV66Rows+共享model.Validate、逐列序列化hash；額外1064筆ValidateCandidate嚴格抽查，非全量嚴格候選驗證。825588 spot、239805 F1、F10=0、共1065393唯一keys，unknown availability同數；57日逐日計數與獨立Python稽核一致。ordered_candidate_digest 1dd0b2deb74d425e8dd0c185580e4149bac0646fb35371d192b6bf3c62e54cdd。原始兩種SHA一致。未落地SQLite、未回讀SQL逐列、未做正式SourceProof/placement，未發布Drive或修改長測。完整版報告、audit.json、dryrun.json、Python稽核及Go程式打包交付使用者。
下一步：全量離線候選ledger/每日SQLite及逐列驗證、日庫hash、idempotency與隔離API，之後再審核混合日/正式匯入。原始gzip永久保留，不能因乾跑通過就宣稱Phase5完成。
