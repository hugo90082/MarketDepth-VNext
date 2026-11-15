"use client";

import { formatDepthAmount } from "./depth-formatters.ts";
import type { DirectionalLevels } from "./depth-settings.ts";
import { axisPosition } from "./depth-ui.ts";
import {
  acquisitionModeLabel,
  money,
  ratio,
  type CoinRow,
  type Exchange,
  type Strength,
} from "./depth-view-model.ts";
import type { SourceResult } from "./depth-types.ts";

function DepthAxis({
  value,
  levels,
  exchange = false,
}: {
  value: number | null;
  levels: DirectionalLevels;
  exchange?: boolean;
}) {
  const markers = [
    { value: -levels.sell.level3, tier: 3, side: "sell" },
    { value: -levels.sell.level2, tier: 2, side: "sell" },
    { value: -levels.sell.level1, tier: 1, side: "sell" },
    { value: levels.buy.level1, tier: 1, side: "buy" },
    { value: levels.buy.level2, tier: 2, side: "buy" },
    { value: levels.buy.level3, tier: 3, side: "buy" },
  ];
  return <div className={`axis${exchange ? " exchange-axis" : ""}`}>
    {markers.map((marker) => <span
      key={`${marker.side}-${marker.tier}`}
      className={`threshold-marker tier-${marker.tier} ${marker.side}`}
      style={{ left: `${axisPosition(marker.value)}%` }}
      aria-hidden="true"
    />)}
    {value !== null && <i style={{ left: `${axisPosition(value)}%` }} />}
  </div>;
}

export function AggregateDepthChart({
  row,
  levels,
  mood,
  success,
  complete,
  onSort,
}: {
  row: CoinRow;
  levels: DirectionalLevels;
  mood: Strength;
  success: number;
  complete: number;
  onSort: (key: "asks" | "total" | "bids" | "complete") => void;
}) {
  const completeness = success === 0
    ? "unavailable"
    : complete === success
      ? "complete"
      : "partial";
  return <div className="depth-chart aggregate-chart">
    <div className="depth-ratio-line">
      <span
        className={`depth-status-dot ${row.imbalance === null ? "unavailable" : "available"}`}
        aria-label={row.imbalance === null ? "聚合資料未取得" : "聚合資料已取得"}
      />
      <strong className={`depth-ratio ${mood.cls}`}>{ratio(row.imbalance)}</strong>
      <button
        className={`depth-completeness-dot ${completeness}`}
        onClick={() => onSort("complete")}
        title={`完整 ${complete} / 成功 ${success}（共 6 家）`}
        aria-label={`聚合深度完整度：完整 ${complete} 家，成功 ${success} 家；點擊依完整來源數排序`}
      />
    </div>
    <div className="depth-amounts">
      <button className="depth-side" onClick={() => onSort("asks")} title="依聚合賣盤排序">
        {success ? formatDepthAmount(row.asks) : "—"}
      </button>
      <button className="depth-total" onClick={() => onSort("total")} title="依買賣總額排序">
        {success ? formatDepthAmount(row.bids + row.asks) : "—"}
      </button>
      <button className="depth-side" onClick={() => onSort("bids")} title="依聚合買盤排序">
        {success ? formatDepthAmount(row.bids) : "—"}
      </button>
    </div>
    <DepthAxis value={row.imbalance} levels={levels} />
  </div>;
}

export function ExchangeDepthChart({
  exchange,
  source,
  levels,
  className = "",
}: {
  exchange: Exchange;
  source?: SourceResult;
  levels: DirectionalLevels;
  className?: string;
}) {
  const usable = source
    && (source.status === "ok" || source.status === "partial")
    && source.bids + source.asks > 0;
  const value = usable ? source.imbalance : null;
  const total = usable ? source.bids + source.asks : 0;
  const available = Boolean(usable && value !== null);
  const completeness = !available
    ? "unavailable"
    : source?.status === "ok"
      ? "complete"
      : "partial";
  const completenessLabel = completeness === "complete"
    ? "完整深度"
    : completeness === "partial"
      ? "部分深度"
      : "未取得深度";
  const title = usable
    ? `${exchange} ${source.pair}｜訂單簿深度比值 ${ratio(value)}｜賣 $${money(source.asks)}｜總額 $${money(total)}｜買 $${money(source.bids)}｜${acquisitionModeLabel(source)}｜${source.feed ?? "REST"}`
    : `${exchange}｜${source?.error ?? "尚未取得"}`;

  return <td className={`exchange-value ${className}`} title={title}>
    <div className="depth-chart exchange-chart">
      <div className="depth-ratio-line">
        <span
          className={`depth-status-dot ${available ? "available" : "unavailable"}`}
          aria-label={available ? `${exchange} 資料已取得` : `${exchange} 資料未取得`}
        />
        <strong className={`depth-ratio ${value === null ? "neutral" : value > 0 ? "buy-text" : value < 0 ? "sell-text" : "neutral"}`}>
          {ratio(value)}
        </strong>
        <span
          className={`depth-completeness-dot ${completeness}`}
          title={`${exchange}：${completenessLabel}`}
          aria-label={`${exchange}：${completenessLabel}`}
        />
      </div>
      <div className="depth-amounts">
        <span className="depth-side">{available && source ? formatDepthAmount(source.asks) : "—"}</span>
        <span className="depth-total">{available ? formatDepthAmount(total) : "—"}</span>
        <span className="depth-side">{available && source ? formatDepthAmount(source.bids) : "—"}</span>
      </div>
      <DepthAxis value={value} levels={levels} exchange />
    </div>
  </td>;
}
