import type { ExtensionAlertEvent } from "./plugin-alert-bridge.ts";

const RULE_LABELS: Record<ExtensionAlertEvent["ruleKind"], string> = {
  above: "高於",
  below: "低於",
  "cross-up": "上穿",
  "cross-down": "下穿",
  buy1: "買 I",
  buy2: "買 II",
  buy3: "買 III",
  sell1: "賣 I",
  sell2: "賣 II",
  sell3: "賣 III",
  "direction-buy": "負轉正",
  "direction-sell": "正轉負",
};

function fallbackIndicatorLabel(event: ExtensionAlertEvent) {
  if (event.mode === "depth-ratio" && Number.isFinite(event.depthLabel)) return `${event.depthLabel}%`;
  return event.indicator
    .replace(/^<[^>]+>\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40) || "指標";
}

export function pluginAlertLabel(event: ExtensionAlertEvent) {
  const indicator = event.indicatorLabel?.trim() || fallbackIndicatorLabel(event);
  const condition = RULE_LABELS[event.ruleKind] ?? "提醒";
  return `插件·${indicator}·${condition}`;
}
