# 分鐘上游格式造成封存比對停滯

基準 v62。2026-11-01 使用者報告卡在封存歷史比對，已在實際 Chrome 分頁看到22/22、來源錯誤與每分鐘重試。唯讀 `/api/status` 明確回錯誤，最後成功時間停留前一日；`artifacts/probe-history-stall.mjs` 已實測失敗。

根因：Railway 前一日改為 `MARKET_DEPTH_COLLECTION_60S_5ZONE_USD_1`／`MD-SPOT-60S-USD-1`，Sites仍只驗證30秒。由公開health及GitHub來源model.go/server.go/README交叉確認，索引仍為 `MD-HISTORY-INDEX-3`；分鐘JSONL沒有cadence欄位。使用者確認是為節省Railway額度而調整。只讀來源，未改動Railway。

修正：僅明列接受既有30秒與已確認分鐘格式；保留美元政策、SHA256、gzip大小、資料形狀與時間格驗證，分鐘列驗證後補cadence=60000，避免舊半格轉換破壞資料。Recent同樣處理。新舊歷史與資料庫原樣保留。來源故障時UI明示等待、遵守既有冷卻與全站gate；分頁同步其狀態。

回歸：新分鐘health、已驗證舊主控續接新索引及15列封存、Recent三情境先紅後綠。另涵蓋null、零、數值不變、未知格式／單位／時間格拒收。246/246測試通過（同步更新之前配色、500MB改動的兩項過時斷言，沒有改回產品設定）。待發布後實際工作完成驗證；不以HTTP200視為成功。

發布後：v63／1b957abca5ced0b8e3a990fea8df289c9fa91b93，環境版本4與公開存取不變。原使用者分頁不重新整理即可在冷卻結束後完成舊工作（補回390）；使用既有按鈕比對目前3D，進度19→36→61→79／89後完成，補回76879個數值，BTC ALL4 0–300bps可用3696→4314／4320分鐘。api/status原本錯誤的同一個probe已轉綠，來源lastSuccess持續前進。未清除歷史、未修改Railway，也未將測試資料寫入正式庫。仍有少量缺格／尚未封存資料，未宣稱完整無缺。
