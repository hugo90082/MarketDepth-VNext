# 08｜五組分工、共用介面、交接協議（PLAN-1.0 / 分派 R2）

## 1. 實際分派（優先 ChatGPT 對話）

| 任務 | 執行環境 | 唯一責任 | 需要的輸入 | 交付給誰 |
|---|---|---|---|---|
| A | ChatGPT 新對話 | Go 收集器、每日 SQLite、API、正式資料契約實作 | 本包、舊 MarketDepth GitHub 指定 commit | B/C/E |
| B | ChatGPT 新對話 | Drive 封存、恢復、1GB 清理、OAuth 指引 | 本包、A 的 archive/store 介面 | A/D/E |
| C | Codex（首選），或 Gemini Antigravity（反重力），二選一 | V66 前端移植、npm/瀏覽器驗收 | C 包內 source ZIP、A 的 API mock | A/E |
| D | ChatGPT 新對話 | 新歷史匯入工具、實際匯入、回測資料核對 | 本包；使用者之後另提供新歷史檔 | B/E |
| E | ChatGPT 新對話（主控） | 統整契約、合併、AWS/HTTPS/Drive 驗收與切換 | 本包、A–D 交付 | 使用者 |

四組使用 ChatGPT，只有 C 交給本地程式開發代理；不要同時叫 Codex 和反重力各自重寫 C。A/B/D/E 不得因工作量大就自行外包：先利用對話可用的 GitHub、AWS、容器與 Python 工具完成。缺少權限、工具或 runtime 時，明確回報已完成部分及最小必要操作；例如 GitHub 工具可讀寫程式碼不等於能直接 SSH，OAuth 使用者必須親自授權，VM shell 指令必要時由使用者在 SSH 執行。只把真正無法在對話完成的特定操作交給本地代理或使用者，不重新分派整項工作。

## 2. 啟動與依賴

- E 可現在開啟作主控，登記各包與契約 hash、確認工作分支及接口交付；**不是現在就部署**。A/B/C 可以並行啟動，D 可先寫工具／測試或等使用者提供新檔。A 是共同接口關鍵路徑。
- A 先交付 `contract/schema.sql` 的一致性測試、API/OpenAPI 及 JSON mock、store/archive Go interface、資料目錄規格；不等全部收集器完成才發給 B/C。C 可先審查/建置 V66、盤點監控 proxy；B 可先以 mock 開發；D 可先做 parser fixtures。
- B 接上 A 介面後提供 archive adapter、manifest/catalog、read/restore、retention 測試及 legacy 封存匯入入口；D 可用 A 的 schema 生成日檔，但只由 B/E 核准上傳，避免重複 writer。
- C 將必須保留的 monitor relay、auth、API 查詢與欄位需求先交 A；不得擅自改 API。A 回傳實際 mock／實作；C 接真測試服務驗收。D 交 E 真實新檔的 audit 與日庫清單，B/E 接入 archive，C 比對歷史查詢/匯出。
- E 收齊 A–D commit、測試、交付物後再做整合／24–48h 資源與資料驗收、跨兩個日界、TLS、Drive 真帳號、回復測試。原服務持續收集；正式切換必須使用者批准。

```text
A ──schema / API mock / store interface──> B、C、D
C ──必要 monitor proxy／前端接口需求──> A
B ──archive contract／restore──> A、D、E
D ──新歷史 audit／日檔 manifest──> B、E
A + B + C + D ──版本化交付──> E ──驗收、切換（需批准）
```

## 3. 共用檔與版本治理

每個 ZIP 都包含相同的完整 master 規劃 00–10、schema.sql、跨組分工及任務入口。先讀 `00_START_THIS_TASK.md`，再讀共同規格與自己負責的文件；其他任務文件用於了解依賴，不得越權實作或改規格。`MD-VNEXT-1` 與 `contract/schema.sql` 不改；如有矛盾提出 change request，由 E 整合確認並通知所有組後才更新，不能私下改欄位或研究邏輯。原始產品規格保持 PLAN-1.0，本次僅分派與歷史輸入更新（分派 R2）。

**各對話不會自動同步彼此內容。** 使用者將每組的版本化接口／handoff／commit 交給 E，E 更新唯一的 `10_MASTER_LOG.md`，再將需要的資訊轉交其他組（例如 A mock 給 B/C/D）。不要將各自 ZIP 內的初始 Log 當成最新狀態。任何小組接到新版契約或交接，先核對版本、commit 與 hash 再開工。

建議共用既有 `hugo90082/MarketDepth` 作整合 repo；舊正式 main 保持不動。E 確認是否可用下列分支後再執行 Git 變更（本包未建立分支）：`vnext/backend` (A)，`vnext/drive` (B)，`vnext/frontend` (C)，`vnext/legacy-import` (D)，`vnext/integration` (E)。以 A 提供的最小 scaffold/契約 commit 作其他實作分支的共同基礎；等待 scaffold 時可在獨立 workspace 使用 mock，不在同一分支併行寫檔。若 Codex 無法直接取得該 repo，可在本地完成並提供 patch、靜態 build、commit；E 匯入整合。不要將 159MB 等歷史原檔、日庫、secret 或 node_modules 提交 Git。所有檔案路徑、branch 名稱是協調建議，不是已存在的資源。

| 所有權 | 可修改範圍（建議） |
|---|---|
| A | cmd/marketdepth、internal/collector、internal/store、internal/httpapi、internal/monitorproxy、internal/health、API fixtures；schema 變更需 E 核准 |
| B | internal/archive、archive 測試、OAuth/restore 文件；對 A 共用介面提出 patch，避免改 A 的核心檔 |
| C | web/v66/（建議源碼目錄）、靜態 build pipeline、前端測試；Go proxy 由 A 實作 |
| D | tools/legacy-import/、匯入測試、audit/manifest 與匯出工具；日庫及原始資料只作外部交付 |
| E | 整合 branch、部署設定、QA、release、總 log；合併後才解衝突，不在其他組尚開發時覆蓋其分支 |

## 4. 強制回報／交付格式

每組提供 `HANDOFF_<角色>.md`（中文）、程式或 patch、可重現測試命令與證據、commit SHA／artifact SHA256、尚未解決事項。A 的接口早期交付可命名 `HANDOFF_A_INTERFACE.md`，C 的 proxy 需求 `HANDOFF_C_PROXY.md`，B 的 archive 介面 `HANDOFF_B_ARCHIVE.md`。內容至少有：

```text
任務／執行環境／分支／commit／契約版本：
狀態：未開始 | 開發中 | 可對接 | 測試通過（附證據） | 阻塞 | 完成
已完成及未完成：
對其他任務的輸入／輸出（檔名、版本、位置、hash）：
測試命令、結果、fixture/mock/真實環境區分：
契約偏差／變更申請（無則寫無）：
需要 E 或使用者決定／操作：
正式部署、資料及資源變動（無則寫無）：
下一步：
```

E 維護總 Log，發出必要的接口轉交與變更通知。原有 AWS/Railway/Sites 不得提前停用；不新增付費資源、不要貼 secrets、不實際下單。各小組只有其任務內測試與開發權，對真實雲端的操作需確認授權。
