(() => {
  const MARKER = "__coinglassIndicatorFrameV2";
  const MESSAGE_TYPE = "coinglass-indicator-frame-command";
  const hasLegend = () => Boolean(document.querySelector('[data-name="legend"]'));
  if (!hasLegend()) return null;
  if (globalThis[MARKER]) return "coinglass-indicator-frame";

  const text = (node) => String(node?.textContent ?? "").trim();
  const visible = (node) => {
    if (!(node instanceof Element)) return false;
    if (node.getAttribute("aria-hidden") === "true") return false;
    const style = getComputedStyle(node);
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) !== 0;
  };

  const identity = () => {
    const root = document.querySelector('[data-name="legend-series-item"]');
    return {
      symbolText: text(root?.querySelector('[data-name="legend-source-title"][class*="mainTitle-"]')),
      intervalText: text(root?.querySelector('[data-name="legend-source-title"][class*="intervalTitle-"]')),
      exchangeText: text(root?.querySelector('[data-name="legend-source-title"][class*="exchangeTitle-"]')),
    };
  };

  const outputNodes = (item, outputFilters = []) => {
    const preferred = [...item.querySelectorAll("[title], [data-value-title], [data-plot-name]")]
      .filter((node) => !node.closest('[data-name="legend-source-title"]'))
      .filter((node) => !node.closest('[data-name$="action"]'));
    const seen = new Set();
    return preferred.flatMap((node, outputIndex) => {
      const value = text(node);
      if (!/[0-9]/.test(value) || value.length > 60) return [];
      const label = String(
        node.getAttribute("title")
        || node.getAttribute("data-value-title")
        || node.getAttribute("data-plot-name")
        || node.getAttribute("aria-label")
        || `輸出 ${outputIndex + 1}`,
      ).trim();
      const key = `${label}\u0000${value}`;
      if (seen.has(key)) return [];
      if (outputFilters.length && !outputFilters.some((filter) => (
        Number(filter.outputIndex) === outputIndex && String(filter.output) === label
      ))) return [];
      seen.add(key);
      return [{ label, text: value, outputIndex }];
    });
  };

  const indicatorEntries = () => {
    const panes = [...document.querySelectorAll('[data-name="legend"]')];
    return panes.flatMap((pane, paneOrdinal) => [...pane.querySelectorAll('[data-name="legend-source-item"]')]
      .filter((item) => !item.matches('[data-name="legend-series-item"]'))
      .map((item, indicatorOrdinal) => {
        const titles = item.querySelectorAll('[data-name="legend-source-title"]');
        return {
          item,
          paneOrdinal,
          indicatorOrdinal,
          name: text(titles[0]),
          params: text(titles[1]),
        };
      }));
  };

  const indicators = (filters = []) => indicatorEntries()
      .map(({ item, paneOrdinal, indicatorOrdinal, name, params }) => {
        const indicatorFilters = filters.filter((filter) => (
          Number(filter.paneOrdinal) === paneOrdinal
          && (filter.indicatorOrdinal === undefined || Number(filter.indicatorOrdinal) === indicatorOrdinal)
          && String(filter.indicator) === name
          && String(filter.params) === params
        ));
        if (filters.length && !indicatorFilters.length) return null;
        return {
          paneOrdinal,
          indicatorOrdinal,
          name,
          params,
          visible: visible(item),
          outputs: outputNodes(item, indicatorFilters),
        };
      })
      .filter((indicator) => indicator?.name && indicator.outputs.length);

  const clearCrosshair = async () => {
    document.activeElement?.blur?.();
    const targets = document.querySelectorAll('[data-name="chart-widget"], canvas');
    for (const target of targets.length ? targets : [document.documentElement]) {
      for (const eventName of ["pointerleave", "mouseleave", "mouseout"]) {
        target.dispatchEvent(new MouseEvent(eventName, { bubbles: true, clientX: -1, clientY: -1 }));
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== MESSAGE_TYPE) return false;
    (async () => {
      if (message.action === "clear-crosshair") return clearCrosshair();
      if (message.action === "read") return { identity: identity(), indicators: indicators(Array.isArray(message.filters) ? message.filters : []) };
      if (message.action === "identity") return identity();
      throw new Error("不支援的圖表指令");
    })().then((value) => sendResponse({ ok: true, value })).catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : "CoinGlass 圖表讀取失敗",
    }));
    return true;
  });

  globalThis[MARKER] = true;
  return "coinglass-indicator-frame";
})();
