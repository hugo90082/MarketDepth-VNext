# Phase 7｜Sydney 隔離驗收操作手冊（準備版）
2026-11-14 UTC+8｜MD-VNEXT-1｜本文件不授權部署或切換；目前只有離線程式與合成測試。

## 1. 驗收前條件（必須逐項具備）
- 鎖定 CI 全綠的 40 字元 producer commit；外部 Linux/amd64 CGO build，記錄 binary SHA256、Go 版本及 module 驗證。不要在 512MiB VM 編譯。
- 確認現有 AWS 主機容量、舊服務資源及運行狀態；尚未有 SSH/SSM 執行通道的證據。不得自行購買主機、停舊服務、變更正式 DNS 或長期雙跑。若資源不足，先另行取得隔離測試批准。
- 只用全新絕對 staging root、0700、loopback 18082；HTTPS 同源代理另驗。正式 root 不可當測試路徑。Drive 僅 `MarketDepth-VNext-staging` 且真帳號操作需批准；憑證在 root 外、0600、不可進 Git/日庫/log。
- `--allow-capacity-loss` 保持 false。真資料不得為了過 QA 而執行強制遺失、清庫或移除舊資料。
- V66 source/build/代理清單仍由 C 提供；Phase 5 真歷史檔未取得。這些不妨礙離線工具測試，但阻擋整體上線。

## 2. 真實驗收窗口
24–48 小時且至少跨兩次 UTC+8 日界（若開始時間或停止時間不能覆蓋兩次午夜，延長）。建議完整包含兩個已封存日，另記錄首末 partial day；禁止把開始前/停止後的缺格誤標成市場故障。
紀錄 run ID、producer commit、UTC+8 start/end、boot ID、PID/start ticks、測試方式、所有異常及是否重啟。完整日的預期 key：
| 類別 | 流數 | 格數/流/日 | 合計 |
|---|---:|---:|---:|
| 現貨 60s | 12 | 1,440 | 17,280 |
| 合約 10s | 3 | 8,640 | 25,920 |
| 官方合約 1m | 3 | 1,440 | 4,320 |
| 總計 | 18 | | 47,520 |
完整 key ≠ 可用行情；present + absent = expected，status=missing 仍為 present。不能用補零、人工 10s 或忽略故障達標。

## 3. 每日日庫獨立稽核
僅在外部驗收機使用已從 verified sealed archive 還原的 raw SQLite copy；不可直接複製 active WAL 的主 DB，不能對正在寫入的文件使用 immutable 讀法。先驗證遠端 manifest 與 gzip、raw digest、復原內容；expected SHA 及 producer 必須由獨立驗證的 manifest 提供，不是臨時為未知檔案重算。輸出放在資料根目錄之外。

在 vnext/，Linux CGO：
```sh
go build -tags sqlite_integration -o /tmp/md-day-audit ./cmd/day-audit
/tmp/md-day-audit --sqlite /absolute/offline/2026-11-13.sqlite \
  --day 2026-11-13 --raw-sha256 "$VERIFIED_RAW_SHA" \
  --producer-commit "$VERIFIED_PRODUCER" > /absolute/qa/day-2026-11-13.json
```
結果含每個 stream 的 expected/present/absent、精確缺格區間、status、可用延遲 P50/P95/max（spot 相對目標 t；futures 相對 bar close）、每側 observed/trusted 750bps、五區 paired trusted、0–750 全區非 NULL 且雙側 trusted 的分鐘。ALL4 指標只計同資產同分鐘至少兩家 paired complete750；它不是策略訊號，也沒有自動評定市場可用率合格。核對事件、collector 及 archive log 的原因，另比對舊版同時窗/區間及 Binance 750bps。沒有來源證明不可稱真實 live。

## 4. 資源取樣
`tools/resource_probe.py` 為 Linux 單次唯讀觀測，取樣者需知道 staging 程序的 PID 與 start ticks。先人工核對該 PID 確為此 run 的 staging binary（例如 readlink /proc/PID/exe，檢查 binary hash），不要記錄可能含敏感資訊的完整環境或 command line。
```sh
# 從 vnext/，先指定已核對的 PID 與隔離 root
START_TICKS="$(python3 -c 'import sys; sys.path.insert(0,"tools"); from resource_probe import proc_stat; print(proc_stat(open("/proc/"+sys.argv[1]+"/stat").read())[0])' "$PID")"
python3 tools/resource_probe.py --root "$STAGING_ROOT" --pid "$PID" \
  --start-ticks "$START_TICKS" >> /absolute/qa/resource.jsonl
```
每 30 秒由已批准的測試環境取樣器呼叫，保留失敗/中斷紀錄；不要重啟後續寫原 run。不能在 ChatGPT 對話中假定有常駐取樣器；本輪未啟動任何程序。摘要在外部機離線執行：
```sh
python3 tools/resource_summary.py /absolute/qa/resource.jsonl \
  --max-gap-seconds 90 > /absolute/qa/resource-summary.json
```
P50/P95/max 為 nearest-rank 取樣統計；CPU 為單核 100%，雙核心可超過 100%。RSS 不代表全機或 cgroup memory peak；取樣磁碟 peak 不代表 OS 強制硬限。1,000,000,000 bytes 資料硬限、1,000,000,000 bytes 根磁碟保留；需另外核對 950/900MB 水位、reservation、kernel/cgroup OOM、swap、memory peak、systemd 重啟計數、CPU steal、主機空間及其他程序。程序/boot 身分改變、時計中斷、取樣缺口超過 90 秒或跨日不足不得宣稱連續通過。30s/90s 為驗收工具初始工程預設，可經明確記錄調整。

## 5. 最終實測驗收清單
- 交易所：12 現貨流按時間核對品質、REST/WS 失敗原因、observed vs trusted 750、幣安三商品；不能只看總 row count。
- 合約：10s 及官方 1m 分開，收盤前不可 available，修復、重複 ID、亂序、重連、無成交 vs 缺值。
- API：C 實測同源登入、401/403/409/429/503、history/sync、NULL/0、跨日、下載、長匯出與收集並行；導出 gzip 尾列及 SHA 核對。
- Drive：真帳號授權續期、hourly/daily verified、停止測試 writer 後 fresh isolated root restore（原 writer 停止須批准），核對全部行、manifest、hash、遺失/復原語意。測試不修改正式 namespace。
- 資源：24–48h 證據與兩次日界、RSS/CPU/allocated P50/P95/max、OOM/非預期重啟=0、容量保留；真實壓力下沒有資料無聲丟失。資源工具只提供部分證據。
- Rollback：記錄舊服務、獨立配置、停止 staging 的方式及驗證結果。Phase 8 需使用者另行批准，包含完整歷史尾端及切換時間。

各項證據列入 10_MASTER_LOG.md。沒有真實執行結果時保留未驗收；禁止以 CI/fixture 或單次健康查詢代替長測。


## 6. 新增唯讀部署前檢查（Phase 7 第二輪）
在已授權且具登入通道的 Sydney 主機，以將來執行 staging 的相同非 root 使用者執行。以下是尚未執行的範例；所有路徑和 SHA 必須由實際環境確認：
```sh
python3 tools/staging_preflight.py \
  --new-root "$NEW_STAGING_ROOT" --old-root "$VERIFIED_OLD_DATA_ROOT" \
  --binary "$STAGING_BINARY" --binary-sha256 "$VERIFIED_BINARY_SHA" \
  --credential "$PRIVATE_OAUTH_FILE" > /absolute/qa/preflight.json
```
如不測 Drive 可省略 credential；此時不能通過真 Drive 驗收。工具不建立目錄、不執行 binary、不 bind port、不讀取憑證內容、不登入 Google 或 AWS。檢查新的資料根目錄尚未存在、與既有資料根目錄無重疊、可寫且非群組/公開可寫的 parent、Linux amd64 ELF header 和檔案 SHA、credential owner/0600、meminfo、/proc/net TCP listeners、filesystem free。初始磁碟檢查至少 2GB（1GB 資料 + 1GB 根磁碟保留），不是容量預留。exit 0 只表示未發現這些具體 blocker；exit 2 有觀測 blocker；exit 1 不完整或無效。端口檢查不保留 port，路徑及資源也可在觀測後改變。ELF header 不等於可成功執行，需另驗 CGO/runtime 相容性。記憶體與舊服務雙跑仍需單獨審查；工具不會自行設定 memory threshold 或授權部署。不要使用 root 使用者部署。

## 7. 長測證據匯總
在外部驗收機（非 512MiB VM）用同一 run 原始 resource JSONL、全部完整日的 audit JSON，明確提供首次 collector target epoch ms 及 producer：
```sh
python3 tools/phase7_evidence.py --resources /absolute/qa/resource.jsonl \
  --producer-commit "$VERIFIED_PRODUCER" --first-target-ms "$FIRST_TARGET_MS" \
  --day-audit /absolute/qa/day-2026-11-13.json \
  --day-audit /absolute/qa/day-2026-11-14.json > /absolute/qa/evidence.json
```
只列實際完整觀測日，例示日期不代表真實測試結果。報告重算 resource summary、原始證據 SHA、UTC+8 完整日清單及 18 streams 的數量、status、缺格、延遲統計、覆蓋計數一致性；缺完整日、取樣不連續、容量違規、缺格、missing rows 都有明確 review blocker。起點以 first_target 為準，末端以最後 resource sample 為保守觀測邊界，部分日不納入 full-day 缺格判斷。必須另確認 collector 在整個窗口確實運作；resource probe 本身不能證明資料程序身分、日庫內容與此 run 的因果關係。匯總的 day JSON 是結構稽核證據，雜湊不能取代獨立 manifest/raw verification；不得使用人造報告當真結果。人工必須審查所有列出的 evidence（交易所、合約、事件、OOM、容量、Drive、API、舊服務、歷史），未授權時不執行。輸出永遠 production_ready=false/deployment_approved=false/cutover_approved=false，不存在自動上線路徑。
