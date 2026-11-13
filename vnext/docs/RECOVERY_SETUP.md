# 災難復原｜隔離版操作規格

本工具只適用 `MarketDepth-VNext-staging`。先停止舊寫入者；不要同時啟動兩台寫入同一 Drive namespace 的服務。此版本未完成真 Drive / Sydney 驗收，不應在正式資料上執行。

## 唯讀重建

使用已安全保存在主機上的 OAuth 憑證（資料目錄外、權限 0600），指定**從未存在的新目錄**：

```sh
./marketdepth-staging --recover-catalog --init-staging \
  --data-dir /absolute/new-isolated-recovery \
  --drive-credentials /absolute/private/marketdepth.oauth.json \
  --producer-commit <40-char-git-commit>
```

僅執行遠端 GET、驗證 manifest / gzip / SQLite / 每筆列及重建本機 catalog，無遠端上傳、刪除或服務啟動。成功輸出 sealed_days、sealed_revisions、full_loss_days、partial_loss_days、snapshot_only_days。失敗保留 .recovery-build 與 building catalog，禁止自動啟動；人工檢查後另選全新目錄重跑，不覆寫原本資料。

已完整封存保留所有 revision；部分遺失只恢復 ledger 已確認的 keys；僅小時快照的日期標 active_recovered_remote，不把未觀測尾端標為永久遺失。當日若已存在 recovered snapshot，禁止在同日自動混合寫入。跨日後仍需明確 --resume-recovered 且確認原 writer 已停止。原始下載的 sealed 路徑不會提供 active 檔當完整日。

復原索引無法重建未上傳的本機資料或尚未同步的 loss ledger、原先 catalog 中未另行備份的 repair 舊列稽核。此限制需在正式災難驗收另行檢查。
