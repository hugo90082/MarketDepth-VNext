export function formatDepthAmount(value: number) {
  if (!Number.isFinite(value)) return "—";
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) {
    return `${new Intl.NumberFormat("zh-TW", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value / 100_000_000)}億`;
  }
  if (absolute >= 10_000) {
    return `${new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 2 }).format(value / 10_000)}萬`;
  }
  return `${new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 2 }).format(value)}元`;
}
