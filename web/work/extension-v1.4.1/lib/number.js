const MULTIPLIERS = new Map([
  ["K", 1_000],
  ["M", 1_000_000],
  ["B", 1_000_000_000],
  ["T", 1_000_000_000_000],
  ["萬", 10_000],
  ["億", 100_000_000],
]);

/**
 * 解析 CoinGlass 畫面上的數字。百分比保留「百分點」口徑，K/M/B 則展開。
 * @param {unknown} input
 * @returns {{ value: number, unit: "%" | "number", display: string } | null}
 */
export function parseDisplayNumber(input) {
  if (typeof input !== "string") return null;
  const display = input.trim();
  if (!display || /^(?:—|–|-|N\/A|NA|null)$/i.test(display)) return null;

  let text = display
    .replace(/[−﹣－]/g, "-")
    .replace(/，/g, ",")
    .replace(/\s+/g, "")
    .replace(/,/g, "");
  let negative = false;
  if (text.startsWith("(") && text.endsWith(")")) {
    negative = true;
    text = text.slice(1, -1);
  }

  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))([KMBT萬億])?(%)?$/i.exec(text);
  if (!match) return null;
  let value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const suffix = (match[2] ?? "").toUpperCase();
  value *= MULTIPLIERS.get(suffix) ?? 1;
  if (negative) value *= -1;
  return {
    value,
    unit: match[3] ? "%" : "number",
    display,
  };
}

/** @param {number} value */
export function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}
