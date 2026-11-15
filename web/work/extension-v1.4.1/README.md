# CoinGlass 指標提醒 1.4.1

這份原始碼取自舊正式站實際發布的 1.4.0 下載檔；1.4.1 新增 MarketDepth 網域，維持 protocolVersion 2、CoinGlass 與原正式站橋接方式。

新網域涵蓋全部路由，讓由研究頁進入 `/monitor` 的 SPA 導覽也能連線。研究頁不送出橋接 hello；監控頁才啟用橋接。

發布下載檔在 `public/downloads/coinglass-indicator-alert-v1.4.1.zip`，其大小及 SHA-256 以同目錄 `release.json` 為準。更新時覆蓋原擴充套件資料夾，至 Chrome 擴充功能頁重新載入。
