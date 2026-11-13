# Google Drive 授權與首次測試（Phase 4）

## 使用者在 Google Cloud 完成的設定

1. 選擇已啟用 Google Drive API 的 `MarketDepth-VNext` 專案。Google Auth Platform > Branding 設定名稱、支援信箱與聯絡信箱。個人 Gmail 使用 External；Workspace 組織帳號如適用可用 Internal。
2. Data Access 只設定 `https://www.googleapis.com/auth/drive.file`。External Testing 加入自己的 Google 帳號為測試使用者。長期正式使用前需要 In production 並依 Google 顯示的合規驗證要求辦理；Testing refresh token 一般七天到期。
3. Clients > Create client > Desktop app，命名 `MarketDepth-VNext-Desktop`，下載原始 JSON 到自己的安全電腦。不要放在 Repo、聊天、共享資料夾、shell history 或 CI logs。

參考官方文件：
- https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- https://developers.google.com/identity/protocols/oauth2/native-app
- https://developers.google.com/identity/protocols/oauth2

## 本機授權工具（程式已實作，待實際 OAuth 驗收）

在可信任的本機電腦以 Go 1.23.2 或以上，從新版 Repo 的 `vnext` 目錄執行（路徑自行替換，不必把憑證放進 Repo）：

```powershell
go run ./cmd/drive-authorize --client "C:\Private\client_secret.json" --out "C:\Private\marketdepth.oauth.json"
```

此工具只綁 127.0.0.1 隨機 port，輸出 Google 官方授權網址。使用自己的瀏覽器開啟，登入預計儲存資料的帳號，核對唯一的 Drive file scope 後同意。程式以 state、PKCE S256、loopback callback 及 offline access 換取更新權杖；不印出 token、不使用 OOB 複製授權碼。五分鐘內完成，拒絕覆寫已存在的輸出檔。

兩個 JSON 都是秘密檔，Windows 上務必放在只有自己可讀的目錄（NTFS ACL；Go 的 0600 不是 Windows ACL 的保證）。先不要將秘密檔交給任何聊天或工具。正式部署時，由使用者透過可信 SSH/SFTP 等安全方式把生成的 `.oauth.json` 放入 VM 專用秘密目錄，檔案權限 0600、僅服務帳號可讀；不能放在市場資料樹、網頁靜態目錄、Repo 或 CI。不要在正式服務未就緒前過早授權；短期測試 token 與正式長期授權分別驗證。當 token 被撤銷或 invalid_grant 時，需重新授權，不擴大 scope。

## 資料夾與測試

- 授權工具本身不建立 Drive 任何檔案。後端第一次上傳時在 My Drive 自動建立指定命名空間及層級。初次真實測試使用 `MarketDepth-VNext-staging`，正式使用 `MarketDepth-VNext`。同一 OAuth 應用、同一使用者及單 writer；不依同名資料夾認定專案，也不接管手動建立的同名資料夾。
- 傳輸層以 appProperties namespace / logical key、實際 parent ID、預分配 ID 和 SHA256 查證，持久 reservation 防止不確定上傳後重複建立。使用 resumable session 單次 PUT 串流；失敗由外層以相同 ID/新 reader 重試，目前不是斷點續傳。遠端發布仍需重新下載、SQLite 驗證及 catalog 登錄。
- 目前只完成模擬 HTTP 傳輸與 OAuth 本機測試，沒有真正使用者授權、Drive 測試、部署、每小時快照輪替、完整遠端 catalog 重建、API cache、容量強制清理或遠端刪除。My Drive root 在 drive.file 下的實際可見性、Google 回傳欄位、跨重啟 token 更新及失效處理皆需隔離驗收。若無法在 drive.file 下操作，先排查，不擅自改全 Drive 權限。
