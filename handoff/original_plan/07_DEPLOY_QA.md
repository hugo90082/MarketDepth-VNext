# 07｜部署、安全、資源驗收與遷移（任務 E）

## 1. 已有 AWS 資源（僅供本次交接，不新增資源）

- Lightsail `marketdepth-sydney-nano`，`ap-southeast-2` Sydney，Ubuntu 24.04 LTS，Nano `nano_3_2`，2 shared vCPU／0.5 GiB／20GB SSD／512GB 套餐流量；US$5/月。
- 已附加固定 IP `marketdepth-sydney-ip`，IPv4 `32.237.51.17`。SSH `ubuntu`。先前已關閉 HTTP 80，僅 22 對外，舊 Docker API `127.0.0.1:8080`。不要把 8080 直接公開。
- 現有容器 `marketdepth`、image `marketdepth:sydney-nano`；舊程式 `/srv/marketdepth/source`，資料 `/srv/marketdepth/data/market-depth`，秘密 `/etc/marketdepth/marketdepth.env`（root 0600）；2GiB swap。禁止覆寫。原先 Docker 320MiB limit、640MiB memory+swap、日誌輪替；新設定要以實測調整，不能保證 512MB 足夠。
- 現有 AWS free plan 查得 ACTIVE、當時餘額 US$120，預定 2027-05-11 19:41 台灣時間到期；此為先前查詢，不是即時餘額。切換前重新檢查 AWS 方案、credits、過期時間、GCP 適用方案與帳務，提前備份，勿假定免費永續。未新增磁碟/快照/bucket 等付費項。
- 原 Railway `MarketDepth` production（Singapore）及 Sites V66 保持原狀，直到使用者確認遷移。以前 AWS 監控及命令實測見 09。

## 2. 隔離與部署策略

先本地／CI build（Go binary、V66 靜態 assets），不在 512MB 生產 VM 大量編譯。新程式使用 `/srv/marketdepth-vnext/`、獨立 SQLite path、獨立 container/service name、測試端口例如 localhost:18081。使用 fixture/mock 先測。並行真實收集會重複請求交易所、增加負載，僅短時間受控驗證；不得長期雙 writer 同一 Drive 日檔。若 VM 資源不足，先在本地或 CI 驗證，經使用者批准短時切換測試並設回復路徑。

新 production 採 restart policy/systemd、健康檢查、輪替日誌、有限資源，Go 單一服務 + 輕量 TLS reverse proxy；秘密由 root/專用帳號檔注入。記錄 commit、artifact hash、config template、migration/rollback。任何 `rm`、資料轉換及停舊服務前需備份並確認。不得因資料格式不符自動刪除目錄。

## 3. HTTPS 與安全

使用者選一般 HTTPS＋密碼，可任意裝置瀏覽。優先既有網域 DNS A 指固定 IP；沒有網域時可評估 Let's Encrypt 已提供短期 IP 憑證，需實測 ACME client 支援、頻繁自動續期與手機信任；不可假設所有代理都支援，也不可用自簽憑證要求使用者忽略警告。不擅自購買域名。TLS 成功後僅按需要開 443，若 ACME HTTP 驗證或跳轉需 80 再明確配置；22 儘可能以安全方式限制來源並保持可管理。VM 內部 API 保持 loopback。測試 public TLS、renewal、port scan；不將管理端口、SQLite、備份路徑公開。

- 共用密碼（不需帳號）使用有 salt 的密碼雜湊（Argon2id/bcrypt 等，按 512MB 設資源上限並壓測），不能只用單純 SHA256 當安全密碼儲存。session 簽章密鑰獨立，cookie Secure、HttpOnly、SameSite=Lax、Path=/；可沿用 V66 7 天固定有效期作建議預設，支援登出、密碼/密鑰換新失效。未登入或 session 過期不回 private data。
- 登入 per-IP rate limit + bounded auth concurrency；輸入長度限制、CSRF（跨站請求偽造）防護與 Origin 檢查；不可只靠密碼防重型下載。重型 endpoint 限制並行、rate/timeout、stream；監控中繼白名單。API/HTML/私有下載 no-store 或私有快取，`noindex,nofollow` 不能替代 auth。
- 避免 XSS/路徑穿越/SQL injection/SSRF；SQL bind params，檔名 whitelist，私有檔不由 static path 直出；CSP 依 V66 實際 WebSocket/CoinGlass 需求調整。CORS 不允許任意 credential origin。所有匿名 API 路徑、SPA deep link、匯出、備份均測。
- Google OAuth secret、網站密碼、交易 key 不出現在前端、GitHub、chat、log、匯出、雲端公開 link。Google Drive 只存市場資料及非秘密設定。下單系統獨立，不是本次範圍。

## 4. 驗收矩陣（建議門檻，非已驗證結果）

| 類別 | 驗收 |
|---|---|
| 資料採樣 | 24h 完整日預期 17,280 spot +25,920 10s +4,320 1m；排程缺格逐筆解釋；非 null 比例分 venue/asset/zone/side，不以 100% 填值冒充成功 |
| 因果 | 未完成 10s/1m 不進正式表；spot available_at、錯過窗口、恢復資料時鐘、舊時間與新時間測試；成交量方向、ID 去重、遲到、日界 |
| 交易所 | 4 家 ×3 商品，與現有已驗證 collector 同時段比較，尤其 Binance 750bps observed/trusted、Kraken grouping、Bitfinex P1/P2；差異需解釋，不單看非 null |
| 合約 | Binance 公開 stream、close/volume/qty/notional 合理、正常零/斷線缺失分開、短缺口補抓、官方 1m 交叉檢查，不要求 aggTrade 完全等於官方 K |
| 儲存 | 24h row counts、SQLite quick_check、WAL 快照、重啟及跨日、磁碟門檻、併發讀取與 eviction、1GB 模擬；確保 active 與交易資料不刪 |
| Drive | 小時快照／每日上傳下載 SHA256、重試去重、假 200/hash mismatch、OAuth 失效、還原 catalog／全新 VM；至少跨 2 日界觀察，正式前驗證真帳號 |
| API | auth、分頁、同 t 多列、遲到修復、etag/revision、缺口、Drive 不可用、取消下載、7/30 日串流；測試一個長匯出與正常收集同時進行 |
| 前端 | V66 功能清單、桌機及手機、登入過期、研究數據 60s、10s/1m、監控直連、快取清除、舊新資料並存、匯出可回測 |
| 資源 | 至少 24–48h，CPU/RAM/swap/OOM/restarts、GC/queue、disk growth、network bytes、burst credits；收集不能因重型下載失效；以 P50/P95/max 報告，不能僅引用空閒時數字 |
| 安全 | TLS/renewal、匿名 401、cookie、password brute-force、CSRF、secret scan、白名單 proxy；外部僅必要端口 |

建議第一版負載驗收以 1 個桌機+1 個手機/模擬瀏覽器、同時一次長匯出及 archive 為主；觀察不 OOM、不重啟、不持續 swap 抖動、無因資源導致的長時間採樣失敗。資源超標先節制併發/中繼/暫存、避免長時間雙收集，再討論升級；不先購買更高方案。門檻不是保證交易資料永遠完整。

## 5. 正式切換順序（需使用者批准）

1. 舊歷史匯出原檔與 SHA 已備份；新匯入核對；V66 source 已備份；另外確認舊 AWS 自部署後尚未包含於使用者舊匯出的時間段及 Railway/Sites 未匯出資料，先另存。瀏覽器匯出不等於整個 D1；缺口不能無聲捨棄。
2. 新程式測試 VM、Drive 測試及正式資料夾、TLS、前端、資源全部通過，明確列出仍存在的限制。
3. 主控記錄舊／新切換時刻、各 feed 最後 t/ID、archive revision、回復命令。舊資料只讀保留，新 writer 使用新資料目錄與不同 source，不雙寫相同雲端檔。觀察新站正常。
4. 使用者確認後，才停舊 AWS 容器/Railway/Sites；不要直接刪資源或資料。退回時避免新舊重疊被靜默覆寫，保留 gap ledger。

## 6. 未來搬遷 GCP

先重新評估 GCP 可用方案與網路位置、費用。新 VM 安裝同一 build、授權同一 Drive、重建 catalog、restore 必要設定；舊 VM 最後 seal/snapshot，停 writer，再啟動新 writer，切換 DNS/憑證，驗證歷史與最新時間、無重複或缺口。已封存歷史不用搬檔；必須搬或封存尚未同步 active/pending、秘密需安全重新配置。研究/下單分開，Gate 地域資格、連線及訂單安全另案確認，未經批准不實際下單。
