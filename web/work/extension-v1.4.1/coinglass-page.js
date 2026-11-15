(() => {
  const MARKER = "__coinglassIndicatorAlertPageV1";
  if (globalThis[MARKER]) return;
  globalThis[MARKER] = true;
  let lastHref = location.href;

  const tick = () => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      chrome.runtime.sendMessage({ type: "pinned-page-navigated" }).catch(() => undefined);
    }
    if (document.visibilityState !== "visible") return;
    chrome.runtime.sendMessage({ type: "capture-tick", visible: true }).catch(() => undefined);
  };

  window.setInterval(tick, 10_000);
  window.addEventListener("pageshow", tick);
  window.addEventListener("popstate", () => chrome.runtime.sendMessage({ type: "pinned-page-navigated" }).catch(() => undefined));
  window.addEventListener("hashchange", () => chrome.runtime.sendMessage({ type: "pinned-page-navigated" }).catch(() => undefined));
  tick();
})();
