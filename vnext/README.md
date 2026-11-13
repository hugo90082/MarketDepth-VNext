# MarketDepth VNext｜後端開發與驗收入口

目前為 Phase 4 隔離開發候選，非正式部署。唯一權威進度：[10_MASTER_LOG.md](docs/10_MASTER_LOG.md)。固定契約 MD-VNEXT-1，原 SQL 不變。Phase 0 審查及 Phase 1–4 核心程式已建立，真實 Drive、Sydney 和前端仍待驗收；Phase 5 正式歷史檔待提供。

## 可重現建置與測試

需求 Linux、Go 1.23、CGO/C 編譯器（SQLite）、Python 3。從 vnext 目錄：

```sh
go mod download
go mod verify
go test ./...
go test -race ./...
go vet ./...
go test -tags 'live_ws sqlite_integration secure_auth' ./...
go build -tags 'live_ws sqlite_integration secure_auth' -o marketdepth-staging ./cmd/marketdepth-staging
python3 tests/schema_check.py
python3 tests/daily_sql_check.py
```

完整日容量測試使用額外 capacity_qa tag；以 GitHub Actions 已通過的工作為證據，不等同實際 VM 容量測試。

## 三種入口

- cmd/marketdepth：僅合成 mock，明示 --mock、numeric loopback。
- cmd/spotprobe：隔離短期實盤 spot probe，新資料目錄，不能替代正式四所覆蓋驗收。
- cmd/marketdepth-staging：整合 spot 60s、futures 10s/1m、SQLite、持久 journal、登入 API、可選 Drive 封存及容量管理。僅允許 numeric loopback；需要精確 HTTPS origin、MD_SESSION_KEY_B64 和 MD_PASSWORD_BCRYPT 環境變數。不可把秘密提交 GitHub。--init-staging 僅建立從未存在的絕對路徑；重啟須已有有效 staging marker。
- 同一 staging binary 的 --recover-catalog：僅 GET 遠端、重建全新隔離 catalog，不啟動收集。見 [RECOVERY_SETUP.md](docs/RECOVERY_SETUP.md)。

建置完成不代表可直接部署。正常 staging 需要獨立資料 root、外部 HTTPS reverse proxy、適當私密憑證及隔離驗收環境。Drive namespace 固定 MarketDepth-VNext-staging；憑證必須位於資料 root 外。--allow-capacity-loss 預設 false，正式驗收前不開啟。不得操作既有正式服務或歷史資料。

## 驗收證據與限制

- [後端回歸 43480678745](https://github.com/hugo90082/MarketDepth-VNext/actions/runs/43480678745)：Go checks / SQL contracts 通過。
- [完整日容量 QA 43480478564](https://github.com/hugo90082/MarketDepth-VNext/actions/runs/43480478564)：每組 47,520 筆合成資料，真 SQLite、mock Drive。不是 512MB VM 或 OS 硬 quota 驗收。
- 原始四所為 Binance、Coinbase、Kraken、Bitfinex；GitHub runner Binance 曾因連線限制失敗，Sydney 750bps 覆蓋仍待確認。
- API 契約：[OpenAPI](contract/openapi.json)、[SQL](contract/schema.sql)。早期 fixture/交接草案不等於最終前端接口；C 由 Codex 負責。
- Phase 5 歷史資料不得捏造 10s、不得將未知 available_at 改成已知，正式映射需取得新原始檔。

Phase 8 正式切換必須在 Phase 7 完整驗收後另行批准。
