# A → C 接口草案（暫不交 Codex 開工）
狀態：Phase 1 開發版 0.1.0，MD-VNEXT-1 不變。使用者決定 C 延後到 Phase 3 基本驗收後；此檔僅供後端固定接口，不代表正式 API 已可用。

- 原始欄位與 `contract/schema.sql` 完全相同，NULL 不省略、0 不替代缺值。`quality_json` 是可為 null 的 JSON 字串，非巢狀物件。
- `contract/openapi.json` 是 OpenAPI 3.1 初稿，`contract/fixtures/*.json` 是測試服務實際產生的 JSON。例子中的 cursor 是舊測試程序的值，不得拿去另一程序重用。`export.jsonl.gz` 只含合成資料。
- `GET /api/v2/latest?kind=...` 回傳該 kind 最新目標格全部可取得列；省略 kind 時 data 為三種 kind 的 map。不得用最大 t 當增量游標。
- history：`from/to` epoch ms、半開區間、初始最大 31 日、limit 1–2000（預設 500）、排序 spot `(t,venue,asset)`、futures `(t,asset)`；有 next_cursor 繼續。模擬版本中任何寫入使原 history cursor 失效；正式版將優先使用日版本或一致性快照，避免收集時不斷重抓。`complete` 表示分頁讀完，`gaps` 另列缺格；NULL 列不是不存在的 row。正式缺格與 archive unavailable 仍待實作。
- sync：不帶 cursor 取得目前模擬 journal 起點，依寫入序列，不依 t，包含修正；依 PK upsert，revision 較新才替換，不能把相同時間不同交易所視作同一列。next_cursor 即使沒有資料也要保存。409 `RESYNC_REQUIRED` 代表游標不再有效；回查 `/days`、重新抓受影響日或全快取。正式 durable journal 尚未實作。
- days：from/to 為 YYYY-MM-DD，含起訖日，最多 366 日差；mock state=fixture，from/to 是日界線，不表示全日有資料。正式 catalog/日 revision 尚待實作。
- export：gzip JSONL，逐列 `{"kind":...,"row":...}`，末列 `type=manifest`、row_counts、gaps、complete；沒有末列即不完整。mock 按 kind 分組、kind 內時間排序；正式版跨日串流及 events 尚未驗收。
- auth/login、auth/logout、day/{day} 目前固定回 501；正式安全機制 Phase 3、封存下載 Phase 4。mock 不接真資料且只允許本機地址，不能部署對外。
- 真正交 C 時需更新此檔、API 版本、真實驗收證據及 V66 proxy 路由清單。
