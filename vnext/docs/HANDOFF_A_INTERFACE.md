# A → C｜Phase 6 後端接口交接（0.2.0-phase6-backend）
2026-11-14｜MD-VNEXT-1｜後端程式實作版，未通過真實環境最終驗收。

C（V66 前端）由 Codex 負責；本文件提供接口與驗收清單，不代表已取得 V66 source ZIP、前端 build 或代理路由 inventory。不可將 mock 的成功視為正式資料成功。

## 1. 固定資料契約
- `contract/schema.sql`、`contract/openapi.json`、`contract/fixtures/`；DDL 不變。fixture 是合成資料，舊 cursor 不可跨程序使用。
- BTC/ETH/SOL；Binance/Coinbase/Kraken/Bitfinex 現貨每 60 秒；五個不重疊 [low,high) 區間 0–100、100–200、200–300、300–500、500–750 bps。幣安 USDⓈ-M 10s 與官方 1m 分開。每日預期 17,280 + 25,920 + 4,320 = 47,520 個 key；不表示必然全部可取得。
- 時間一律 epoch ms；日界 Asia/Taipei UTC+8。spot key=(t,venue,asset)，futures key=(t,asset)，kind 分開。revision 用於取代，不作為 cache 主鍵。NULL 不等於零，也不等於缺列。quality_json 是 JSON 字串或 null。
- 整數 wire format 保持 JSON integer；尤其 trade/agg ID、trade_count 可能超過 JS Number.MAX_SAFE_INTEGER，需 lossless JSON parser（無損整數解析），禁止先 response.json() 再補 BigInt。BigInt 寫入 IndexedDB 或可逆十進位文字由 C 選定；不要改 API wire format。
- observed/trusted coverage 分離；不可靠區間不能補 0。ALL4 是前端衍生：同一目標區間兩側完整的相同 venue 集合至少 2 家；公開組成、coverage、available_at 取參與列最大值。不得把缺值、換員誤作市場變動。累積區間必須逐區完整，不可跳過 null。歷史 available_at 未知不進策略。

## 2. HTTP 與安全
正式使用瀏覽器 HTTPS 同源 /api/v2；後端 loopback，禁止直接公開 port。合成 mock 另用 loopback 127.0.0.1:18081，無登入、標 synthetic-mock；live-local 需要登入且仍不代表 production_ready。
- POST /auth/login JSON {"password":"..."}，密碼 1–72 UTF-8 bytes；必須附精確 HTTPS Origin。成功 {"ok":true,"data":{"authenticated":true,"expires_in":604800}}，**沒有 meta**。
- POST /auth/logout 同源 Origin，成功 {"ok":true,"data":{"authenticated":false}}，撤銷 server session；無有效 cookie 亦可登出。
- Cookie `__Host-md_session`，Secure/HttpOnly/SameSite=Lax/Path=/，7天、無 Domain；程序重啟失效。前端不得自行讀取/儲存密碼、cookie 或 OAuth。GET 不需強行附 Origin，有 Origin 時必須吻合；不開放 CORS。
- 每個 data API 都需要登入，含 /health、/meta。401 清除前端已登入狀態，避免顯示上個使用者資料；403 origin 不符；429 依 Retry-After 退避；503 明確 unavailable，不能清掉好資料後假裝空；409 RESYNC_REQUIRED 見下。
- session 每分鐘120次請求，登入 IP 5次/分鐘、全域20次/分鐘、bcrypt 同時1個；四個 catalog read routes 共2個並行槽，export/day 共1個。反向代理的 RemoteAddr 可能共用 IP 限額；目前不信任 X-Forwarded-For。不可隨意放寬。
- 保留 Cache-Control:no-store、X-MarketDepth-Mode、Content-Type、Set-Cookie、Retry-After、ETag、X-Archive-SHA256、Content-Disposition、Content-Length；代理不得改寫下載 gzip、快取私人資料、轉發任意內部路由或向瀏覽器暴露 secret。

## 3. API 與資料同步
前綴 /api/v2。一般成功 envelope={ok,data,meta:{contract_id,timezone,mock,...}}；登入/登出例外。失敗 {ok:false,error:{code,message}}（未知路徑/框架層錯誤不保證 JSON）。
| GET route | 行為 |
|---|---|
| /meta | 固定 assets/venues/zones/cadence、ALL4門檻 |
| /health | 模式及狀態；live-local 不是 production_ready |
| /latest?kind=... | 單 kind 回陣列；逗號分隔多 kind 回所選 map，不能重複；省略回三種。各 kind 最新 committed t 未必相同，非完整歷史或游標 |
| /history | kind,from,to 必要；半開範圍，最多31日，limit 1–2000 預設500；asset/venue 選填，venue僅 spot；cursor 綁查詢及版本 |
| /sync | kind 必要，cursor 選填；依持久寫入序列，包含遲到修正。每 kind 獨立保存 cursor |
| /days | YYYY-MM-DD，起訖皆含、最多366日差；日級 row_counts、revision、sha256/etag、gaps |
| /export | from/to，選填 kinds、format=jsonl.gz，最多31日，gzip JSONL |
| /day/{day} | revision 選填；省略最新已驗封存版；無 archive 回503，mock 501 |

- history 按 (t,venue,asset) 或 (t,asset) 排序。第一頁提供範圍缺格摘要；後續頁 gaps 可能空。complete 只表示分頁結束，不代表全日完整。頁面結果應暫存，全部成功才替換該查詢範圍；409 丟棄未完成頁並重新查詢。無關新寫入不應使固定歷史範圍重抓。
- sync 初次空 cursor 從當前保留 journal 起點讀；不是完整歷史。已 compact/sealed、partial loss/recovered 的區間由 gaps 指示補 history。next_cursor 即使零列也必須保存。依 PK+revision upsert；相同 revision 但內容不一致視為錯誤。資料與 cursor 同一 IndexedDB transaction；409 需重新建立基線，回查 days/history，不可只清 cursor 而沿用錯誤 cache。
- 建議 C bootstrap：先取得並保留各 kind sync 基線，查 /days、按固定歷史時間範圍分頁，按版本 upsert，再接著 sync 補讀查詢期間的變化；任一409重建相關基線。不要從最大 t 推導增量。這是整合建議，尚待 C 測試。
- /days 狀態 fixture/missing/active_local/sealed_local/sealed_remote/permanent_loss/partial_remote/active_recovered_remote；日級 gaps 可能只是摘要，需 history 確認精確區間。loss 不可補 0；snapshot-only 不等於 confirmed loss。
- /export 每行 {"kind":...,"row":...}，末行 {"type":"manifest","complete":true,"mock":...,"contract_id":...,"row_counts":...,"gaps":...}。必須讀到 gzip EOF/CRC、唯一末行、完整計數及合法 row；未出現 kind 的 row_counts 按零筆處理（須與請求 kinds 對照）。HTTP200 或 gzip EOF 單獨不算成功；版本變動時可能沒有 manifest。分批匯入 staging cache，驗證完成才可提交，不可用失敗匯出覆寫正式資料。
- /day 回 application/gzip（不是 Content-Encoding:gzip），驗證實收 byte count 與 X-Archive-SHA256，ETag 是帶引號 manifest hash，不是 gzip SHA。日庫 raw 欄位/來源不改。不要把 503 當 404 或零資料。

## 4. C 交付及 Phase 6 驗收
C 提供原 V66 路由 inventory、source/commit、build 指令與結果、proxy allowlist、桌機/手機畫面；逐一對照 V66 功能。實測 login/logout/重啟失效、同源、無登入、history/sync/pagination/409、429、503、NULL/0、64-bit ID、ALL4 成員變化、封存 gzip SHA、跨日、長匯出及截斷拒絕。不得將 QA fixture 當 live，正式 legacy adapter/封存仍 gated。Phase 7 真實 Sydney 長測、真 Drive、TLS 和正式切換皆未核准／未完成。
