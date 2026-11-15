/**
 * Chrome 要求 sidePanel.open() 必須由使用者手勢直接呼叫，因此不可轉送給背景程序。
 * @param {typeof chrome} chromeApi
 * @param {number | null | undefined} windowId
 */
export async function openSidePanel(chromeApi, windowId) {
  if (!Number.isInteger(windowId)) throw new Error("無法取得目前瀏覽器視窗");
  if (!chromeApi?.sidePanel?.open) throw new Error("目前的 Chrome 不支援側邊欄");
  await chromeApi.sidePanel.open({ windowId });
}
