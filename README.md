# MarketDepth VNext

私人後端開發儲存庫。唯一長期開發主線：`main`。

- [開發紀錄](vnext/docs/10_MASTER_LOG.md)
- [後端原始碼與執行說明](vnext/README.md)
- [API 契約](vnext/contract/openapi.json)
- [資料庫結構](vnext/contract/schema.sql)

現階段為隔離開發，CI 只建置及測試，並無正式部署。真行情 probe 需手動觸發；不得以測試環境失效資料代替有效行情。C 組前端延後至 Phase 3 基礎驗收。
