# Phase 5｜正式來源初審與候選映射乾跑（2026-11-15 UTC+8）

## 結論
使用者新上傳 `marketdepth-local-history-2026-11-14T16-59-33-347Z.jsonl.gz` 是本階段唯一正式原始輸入。已完成全檔串流稽核、來源程式碼語意核對、Go 候選映射全量乾跑。未建立正式日庫、未發布 Drive、未決定 cutover（新舊切換時刻），未宣稱 Phase 5 正式匯入完成。

- 壓縮 165,937,369 bytes；SHA256 `88097e060d0c4cdd689971641e14b7a41c0857bcf2104b15ba119fe22d65e79b`。
- 解壓 415,340,421 bytes；SHA256 `d1d4cf64e04eb19bc7412d70d0cbb5904c8adb8ad867fcb79ce9caf70dec243e`。
- 329,184 行、20,578 blocks、68,799 depth、239,805 candles、1 manifest、1 summary。CRC/EOF、JSON duplicate keys、區塊計數、時間格、數值、總結與範圍均通過。無重複時間格；最長行 8,415 bytes。
- 深度 2026-09-26 19:07 至 2026-11-15 00:59，缺 2,114 分鐘；各商品 K 線 2026-09-20 12:45 至 2026-11-15 00:59，各79,935筆，無缺格。共57個有資料的日期；44個完整深度曆日。
- 4×3×5×2 深度矩陣，224,277個null、560個實際0，15,678個全null venue/asset rows，799,062個10欄均非null rows。非null不代表新版可信覆蓋。
- depth railway 66,193 / browser 2,606；quality null 66,194 / FORMAL_AVAILABLE_V2 2,605，只有29,565個 venue/asset rows有book quality（顯式雙側 observed 7,812）。K 線來源 binance-usdm 174,280 / null 65,525；全數 closed/complete，但 observedAt 缺70,069、早於收盤33,871、>=收盤135,865；不能因此推斷真實可用時間。depth a=t 15,707，a>t 53,092。

## 映射規則（候選，非正式發布批准）
已核對 V66 source `shared/local-history-export.ts`, `shared/minute-history.ts`, `shared/model.ts`, `shared/contract.ts`；原版 commit 1eba4b4ea8e07b1f6abd455f3d7d76a43c09030d。V66 export 為 per-block-version-at-read-time，並非全庫同一瞬間快照；日期採台灣時區，epoch ms 不改。

| 舊欄位 | MD-VNEXT-1 候選欄位／處理 |
|---|---|
| depth.t | t 原樣，每格拆12列，venue=binance/coinbase/kraken/bitfinex；asset=BTC/ETH/SOL |
| d[venue][asset][zone][side] | 5個不重疊區間的雙側金額，0–100、100–200、200–300、300–500、500–750 bps；USD名目金額（原quote按1:1假設，不做FX換算），不改數值、不補null |
| depth.a | quality_json.legacy_a，候選 available_at=NULL；舊30s合併及修訂不能證實真實可用時間 |
| quality.books[vi][ai].capturedAt | captured_at 原記錄，若無則NULL；可能是合併的較早捕獲時間，不視為精確現貨可用時間 |
| quality.books | quality_json.legacy_book 原完整物件與舊version；新 observed/trusted bps 全NULL，不把舊 grouped/P2/coverage提升為新版精確可信。BBO/mid原檔沒有，NULL |
| source/format/captured/issues/finalVersion、block metadata | quality_json原值；block revision不當新row revision；新source=legacy:v66-browser-jsonl-v1、status=legacy_unknown、revision=1 |
| candle asset/t/o/h/l/c/v | futures_1m對應欄位（v為base quantity）；quote_volume、taker、trade_count NULL |
| candle closed/complete/observedAt/source | quality_json原值；source null不推論為合成或官方；available_at=NULL、status=legacy_unknown，不標新版官方已收盤 |
| ratios/ALL4 | 原始gzip保留，不新增儲存欄；舊V66 ratio可使用部分有值區間/只1家，與新版嚴格完整區間、至少2家規則不同。歷史相容顯示必須分開標示，策略不可默認使用 |
| futures_10s | 0，禁止由1m合成 |

## 乾跑驗證
- 本地 Go1.23.2，`go test ./internal/legacy ./cmd/legacy-v66-dryrun` 通過。全量 MapV66Rows 及共享 model.Validate，逐列序列化雜湊；額外1,064筆通過 ValidateCandidate 嚴格候選驗證（不是全量嚴格驗證）。1,065,393 unique keys：825,588 spot + 239,805 F1，F10=0。全部候選 availability=NULL。57日的逐日筆數與獨立Python原始稽核相符；原始兩種SHA一致。ordered_candidate_digest `1dd0b2deb74d425e8dd0c185580e4149bac0646fb35371d192b6bf3c62e54cdd`。耗時36.82秒、peak RSS 410,468 KiB（外部環境，不可在512MiB VM執行）。
- 前兩次同步乾跑受執行時限中止；首次跑完資料後 summary 的 assets 與 manifest 類型不同，解析錯誤；已改為 RawMessage 並重跑成功。沒有發生行情數值映射錯誤。
- 本輪未落地日庫，沒有逐列回讀SQL結果、正式SourceProof或placement proof；待下一階段建立離線candidate ledger/day files、全量逐列核對以及隔離API驗收。乾跑的雜湊不能代替實體日庫驗證。
- 11/15的原檔有60個深度格及180根K線（720 spot+180 F1=900筆）。與長測/原11/14測試備份的重疊關係須以真實首個target、remote catalog、舊尾端驗證，不可自行宣稱無重疊。原57日候選可保留，正式placement須按source/cutover，混合日與衝突先分離保留，禁止overwrite。

## 復現
在較大記憶體的離線環境，將附錄的程式放進對應 VNext repo 路徑（已提交同等程式至 main）；原gzip保留於獨立安全目錄。

```sh
python3 audit_actual.py /path/to/immutable.jsonl.gz audit.json
cd vnext
go test ./internal/legacy ./cmd/legacy-v66-dryrun
go run ./cmd/legacy-v66-dryrun --input /path/to/immutable.jsonl.gz --sha256 88097e060d0c4cdd689971641e14b7a41c0857bcf2104b15ba119fe22d65e79b --raw-sha256 d1d4cf64e04eb19bc7412d70d0cbb5904c8adb8ad867fcb79ce9caf70dec243e > dryrun.json
```

## 下一階段
全量離線逐日SQLite候選建置、原始金額/NULL mask/來源/時間/品質逐列比對、日庫完整性與雜湊、idempotency、API及新舊重疊規則。任何正式上傳/匯入、清理或切換皆需獨立審核；24h長測不修改、不干擾。原始gzip不能被刪除或修改。
