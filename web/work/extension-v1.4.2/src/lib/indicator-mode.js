export const DEPTH_LABELS = Object.freeze([0.25, 0.5, 0.75, 1, 2, 3, 5, 10]);

/** @param {unknown} value */
function normalizedIndicatorName(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/訂單薄/g, "訂單簿")
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .toLowerCase();
}

/** @param {{indicator?: unknown}|null|undefined} target */
export function classifyIndicatorTarget(target) {
  const name = normalizedIndicatorName(target?.indicator);
  return name.includes("聚合現貨訂單簿深度比值") ? "depth-ratio" : "generic";
}

/** @param {unknown} value */
export function normalizeDepthLabel(value) {
  const number = Number(value);
  return DEPTH_LABELS.includes(number) ? number : null;
}
