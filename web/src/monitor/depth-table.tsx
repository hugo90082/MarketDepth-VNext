"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { positionActionMenu, type ActionMenuPosition } from "./action-menu.ts";
import {
  AggregateDepthChart,
  ExchangeDepthChart,
} from "./depth-chart.tsx";
import {
  aggregateRowAtDepth,
  aggregateSortKey,
} from "./aggregate-depth-view.ts";
import {
  formatFundingRate,
  formatMarketPrice,
  type MarketMetaDisplay,
} from "./market-meta.ts";
import { resolveAlertLevels, type DirectionalLevels, type Levels } from "./depth-settings.ts";
import type { DepthOption } from "./depth-types.ts";
import { selectCoinGlassChart } from "./depth-ui.ts";
import {
  EXCHANGES,
  acquisitionModeLabel,
  formatBucket,
  formatTime,
  money,
  ratio,
  statusLabel,
  type CoinRow,
  type Exchange,
  type SortKey,
} from "./depth-view-model.ts";
import type { ColumnBlock } from "./table-layout.ts";
import type { QueueStatus } from "./update-scheduler.ts";

type DragKind = "row" | "column";
type DragState = {
  kind: DragKind;
  id: string;
  target: string;
  x: number;
  y: number;
};

const SOURCE_CODE: Partial<Record<MarketMetaDisplay["exchange"], string>> = {
  OKX: "OKX",
  Bybit: "BYB",
  Coinbase: "CB",
  Bitfinex: "BFX",
  Kraken: "KRK",
};

const COLUMN_LABELS: Record<ColumnBlock, string> = {
  aggregate: "聚合深度比值",
  strength: "強弱狀態",
  exchanges: "交易所欄位 · 6 家",
  update: "更新",
};

function fullTime(value: number) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(value);
}

function marketTooltip(meta: MarketMetaDisplay | undefined) {
  if (!meta) return "尚未取得永續合約價格與預估資金費率";
  const rate = formatFundingRate(meta.fundingRate8h);
  return [
    `${meta.exchange} · ${meta.pair}`,
    `完整價格：${meta.price}`,
    `8 小時預估資金費率：${rate}`,
    `最後更新：${fullTime(meta.generatedAt)}`,
    meta.status === "stale" ? "目前顯示淡化的最後行情" : "",
  ].filter(Boolean).join("\n");
}

export function DepthTable({
  rows,
  visibleExchanges,
  aggregateDepths,
  primaryDepth,
  columnOrder,
  marketMeta,
  isMobile,
  globalLevels,
  expanded,
  queueStatus,
  pausedSymbols,
  clock,
  isLeader,
  onSort,
  onToggleExpanded,
  onTogglePause,
  onOpenSettings,
  onRemove,
  onMoveRow,
  onMoveColumn,
}: {
  rows: CoinRow[];
  visibleExchanges: Exchange[];
  aggregateDepths: DepthOption[];
  primaryDepth: DepthOption;
  columnOrder: ColumnBlock[];
  marketMeta: Record<string, MarketMetaDisplay>;
  isMobile: boolean;
  globalLevels: Levels;
  expanded: string | null;
  queueStatus: QueueStatus;
  pausedSymbols: string[];
  clock: number;
  isLeader: boolean;
  onSort: (key: SortKey) => void;
  onToggleExpanded: (symbol: string) => void;
  onTogglePause: (symbol: string) => void;
  onOpenSettings: (symbol: string) => void;
  onRemove: (symbol: string) => void;
  onMoveRow: (symbol: string, before: string) => void;
  onMoveColumn: (block: ColumnBlock, before: ColumnBlock) => void;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [actionSymbol, setActionSymbol] = useState<string | null>(null);
  const [desktopMenuPosition, setDesktopMenuPosition] = useState<ActionMenuPosition | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const actionTriggerRef = useRef<HTMLButtonElement | null>(null);
  const actionMenuRef = useRef<HTMLElement | null>(null);
  const pressRef = useRef<{
    kind: DragKind;
    id: string;
    x: number;
    y: number;
    timer: number;
  } | null>(null);
  const suppressClick = useRef("");

  useEffect(() => {
    dragRef.current = drag;
  }, [drag]);

  useEffect(() => {
    const move = (event: MouseEvent) => {
      const pressed = pressRef.current;
      if (pressed && !dragRef.current) {
        if (Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > 7) {
          window.clearTimeout(pressed.timer);
          pressRef.current = null;
        }
        return;
      }
      if (dragRef.current) {
        setDrag((current) => current ? {
          ...current,
          x: event.clientX,
          y: event.clientY,
        } : null);
      }
    };
    const up = () => {
      if (pressRef.current) {
        window.clearTimeout(pressRef.current.timer);
        pressRef.current = null;
      }
      const active = dragRef.current;
      if (!active) return;
      if (active.id !== active.target) {
        if (active.kind === "row") onMoveRow(active.id, active.target);
        else onMoveColumn(active.id as ColumnBlock, active.target as ColumnBlock);
      }
      dragRef.current = null;
      setDrag(null);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
    return () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
  }, [onMoveColumn, onMoveRow]);

  const closeActionMenu = useCallback((restoreFocus = true) => {
    const trigger = actionTriggerRef.current;
    setActionSymbol(null);
    setDesktopMenuPosition(null);
    if (restoreFocus) queueMicrotask(() => trigger?.focus());
  }, []);

  useEffect(() => {
    if (!actionSymbol || !isMobile) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeActionMenu();
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", keydown);
    };
  }, [actionSymbol, closeActionMenu, isMobile]);

  useLayoutEffect(() => {
    if (!actionSymbol || isMobile) return;
    const trigger = actionTriggerRef.current;
    const menu = actionMenuRef.current;
    if (!trigger || !menu) return;

    const anchor = trigger.getBoundingClientRect();
    const bounds = menu.getBoundingClientRect();
    const next = positionActionMenu(
      anchor,
      { width: bounds.width, height: bounds.height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setDesktopMenuPosition(next);
    const firstAction = menu.querySelector<HTMLElement>(
      "a[href], button:not(:disabled), [tabindex]:not([tabindex='-1'])",
    );
    firstAction?.focus();
  }, [actionSymbol, isMobile]);

  useEffect(() => {
    if (!actionSymbol || isMobile) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (actionMenuRef.current?.contains(target)) return;
      if (actionTriggerRef.current?.contains(target)) return;
      closeActionMenu();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeActionMenu();
    };
    const dismiss = () => closeActionMenu();
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keydown);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", keydown);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [actionSymbol, closeActionMenu, isMobile]);

  const beginPress = (
    kind: DragKind,
    id: string,
    event: ReactMouseEvent,
  ) => {
    if (isMobile || event.button !== 0) return;
    if (pressRef.current) window.clearTimeout(pressRef.current.timer);
    const x = event.clientX;
    const y = event.clientY;
    const timer = window.setTimeout(() => {
      suppressClick.current = `${kind}:${id}`;
      const next = { kind, id, target: id, x, y };
      dragRef.current = next;
      setDrag(next);
      pressRef.current = null;
    }, 400);
    pressRef.current = { kind, id, x, y, timer };
  };

  const enterTarget = (kind: DragKind, id: string) => {
    const active = dragRef.current;
    if (!active || active.kind !== kind || active.target === id) return;
    const next = { ...active, target: id };
    dragRef.current = next;
    setDrag(next);
  };

  const allowClick = (kind: DragKind, id: string) => {
    if (suppressClick.current !== `${kind}:${id}`) return true;
    suppressClick.current = "";
    return false;
  };

  const blockClass = (block: ColumnBlock) => [
    drag?.kind === "column" && drag.id === block ? "drag-source-block" : "",
    drag?.kind === "column" && drag.target === block && drag.id !== block
      ? "drag-target-block"
      : "",
  ].filter(Boolean).join(" ");

  const columnMouseDown = (
    block: ColumnBlock,
    event: ReactMouseEvent,
  ) => beginPress("column", block, event);

  const renderHeaderBlock = (block: ColumnBlock) => {
    if (block === "aggregate") {
      return <Fragment>{aggregateDepths.map((depth) => <th
        className={`aggregate-heading ${blockClass(block)}`}
        key={depth}
        onMouseDown={(event) => columnMouseDown(block, event)}
        onMouseEnter={() => enterTarget("column", block)}
        onClick={() => {
          if (allowClick("column", block)) onSort(aggregateSortKey(depth, "imbalance"));
        }}
        title={`短按依 ±${depth}% 聚合深度比值排序；長按 400ms 拖曳聚合深度群組`}
      >
        <span className="table-heading-line">
          <span className="desktop-label">聚合 ±{depth}%</span>
          <span className="mobile-label">±{depth}%</span>
          {depth === primaryDepth && <span
            aria-label="唯一提醒基準"
            className="primary-depth-icon"
            title="唯一提醒基準"
          >🔔</span>}
        </span>
      </th>)}</Fragment>;
    }
    if (block === "strength") {
      return <th
        className={blockClass(block)}
        onMouseDown={(event) => columnMouseDown(block, event)}
        onMouseEnter={() => enterTarget("column", block)}
        title="長按 400ms 拖曳強弱狀態欄"
      >
        <span className="table-heading-line">強弱狀態 ±{primaryDepth}%</span>
      </th>;
    }
    if (block === "update") {
      return <th
        className={`update-column ${blockClass(block)}`}
        onMouseDown={(event) => columnMouseDown(block, event)}
        onMouseEnter={() => enterTarget("column", block)}
        onClick={() => {
          if (allowClick("column", block)) onSort("time");
        }}
        title="短按排序；長按 400ms 拖曳更新欄"
      >
        更新
      </th>;
    }
    return <Fragment>
      {visibleExchanges.map((exchange) => <th
        className={`exchange-heading ${blockClass(block)}`}
        key={exchange}
        onMouseDown={(event) => columnMouseDown(block, event)}
        onMouseEnter={() => enterTarget("column", block)}
        onClick={() => {
          if (allowClick("column", block)) {
            onSort(`exchange:${exchange}`);
          }
        }}
        title={`${exchange}：短按排序；長按 400ms 拖曳六家交易所群組`}
      >
        <span className="table-heading-line">{exchange} ±{primaryDepth}%</span>
      </th>)}
    </Fragment>;
  };

  const renderRowBlock = (
    block: ColumnBlock,
    row: CoinRow,
    levels: DirectionalLevels,
    mood: ReturnType<typeof statusLabel>,
    queued: QueueStatus[string] | undefined,
    paused: boolean,
  ) => {
    const className = blockClass(block);
    if (block === "aggregate") {
      return <Fragment>{aggregateDepths.map((depth) => {
        const selectedRow = aggregateRowAtDepth(row, depth);
        const usable = selectedRow.sources.filter(
          (source) => (source.status === "ok" || source.status === "partial")
            && source.bids + source.asks > 0,
        );
        const success = usable.length;
        const complete = usable.filter((source) => source.status === "ok").length;
        return <td className={`aggregate-value ${className}`} key={depth}>
          <AggregateDepthChart
            row={selectedRow}
            levels={levels}
            mood={statusLabel(selectedRow.imbalance, levels)}
            success={success}
            complete={complete}
            onSort={(metric) => onSort(aggregateSortKey(depth, metric))}
          />
        </td>;
      })}</Fragment>;
    }
    if (block === "strength") {
      return <td className={className}>
        <span className={`pill ${mood.cls}`}>{mood.text}</span>
      </td>;
    }
    if (block === "exchanges") {
      return <Fragment>
        {visibleExchanges.map((exchange) => <ExchangeDepthChart
          className={className}
          key={exchange}
          exchange={exchange}
          source={row.sources.find((item) => item.exchange === exchange)}
          levels={levels}
        />)}
      </Fragment>;
    }
    return <td className={`update-column ${className}`} title={`取樣時間 ${fullTime(row.generatedAt)}；接收時間 ${fullTime(row.completedAt)}；資料年齡 ${row.generatedAt ? Math.max(0,Math.floor((clock-row.generatedAt)/1000))+" 秒" : "—"}`}>
      {paused
        ? <>
          <span className="paused-label">已暫停</span>
          <small>
            {row.completedAt ? `最後 ${formatTime(row.completedAt)}` : "尚無快照"}
          </small>
        </>
        : row.loading
          ? <>
            <span className="syncing">
              {row.startedAt ? "同步中…" : "等待排程"}
            </span>
            <small>
              {row.startedAt
                ? `已等待 ${Math.max(0, Math.floor((clock - row.startedAt) / 1000))} 秒`
                : "即將開始第一輪"}
            </small>
          </>
          : <>
            <span>{formatTime(row.generatedAt || row.completedAt)}</span>
            <small>
              {queued
                ? `排隊 ${queued.position} / ${queued.total}`
                : isLeader ? "等待下個週期" : "接收主分頁"}
            </small>
          </>}
    </td>;
  };

  const actionRow = rows.find((row) => row.symbol === actionSymbol);
  const actionPaused = actionRow
    ? pausedSymbols.includes(actionRow.symbol)
    : false;
  const actionChart = actionRow
    ? selectCoinGlassChart(
      actionRow.symbol,
      actionRow.binancePerp,
      actionRow.sources,
      EXCHANGES,
    )
    : null;

  const toggleActionMenu = (
    symbol: string,
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => {
    if (actionSymbol === symbol) {
      closeActionMenu();
      return;
    }
    actionTriggerRef.current = event.currentTarget;
    setDesktopMenuPosition(null);
    setActionSymbol(symbol);
  };

  const actionItems = (surface: "desktop" | "mobile") => {
    if (!actionRow) return null;
    const menuRole = surface === "desktop" ? "menuitem" : undefined;
    return <>
      {actionChart
        ? <a
          href={actionChart.href}
          target="_blank"
          rel="noopener noreferrer"
          role={menuRole}
          onClick={() => closeActionMenu(false)}
        >開啟 K 線</a>
        : <span
          className={surface === "desktop" ? "disabled-menu-action" : "disabled-sheet-action"}
          role={menuRole}
          aria-disabled="true"
          title="指定交易所沒有可用的 K 線"
        >無可用 K 線</span>}
      <button
        className={actionPaused ? "resume" : "pause"}
        role={menuRole}
        onClick={() => {
          onTogglePause(actionRow.symbol);
          closeActionMenu(false);
        }}
      >{actionPaused ? "繼續刷新" : "暫停刷新"}</button>
      <button role={menuRole} onClick={() => {
        onOpenSettings(actionRow.symbol);
        closeActionMenu(false);
      }}>商品設定</button>
      <button className="danger" role={menuRole} onClick={() => {
        if (window.confirm(`確定要刪除 ${actionRow.symbol}？`)) {
          onRemove(actionRow.symbol);
          closeActionMenu(false);
        }
      }}>刪除商品</button>
    </>;
  };

  return <>
    <div className={`table-scroll${drag ? " dragging-table" : ""}`}>
      <table style={{ minWidth: `${509 + Math.max(0, aggregateDepths.length - 1) * 260 + visibleExchanges.length * 220}px` }}>
        <thead>
          <tr>
            <th className="sticky-left" onClick={() => onSort("symbol")}>商品</th>
            {columnOrder.map((block) => (
              <Fragment key={block}>{renderHeaderBlock(block)}</Fragment>
            ))}
            <th className="sticky-right">操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const levels = resolveAlertLevels(row.alert, globalLevels);
            const mood = statusLabel(row.imbalance, levels);
            const queued = queueStatus[row.symbol];
            const paused = pausedSymbols.includes(row.symbol);
            const meta = marketMeta[row.symbol];
            const fundingClass = meta?.fundingRate8h == null
              ? "neutral"
              : meta.fundingRate8h > 0
                ? "positive"
                : meta.fundingRate8h < 0
                  ? "negative"
                  : "neutral";
            const sourceCode = meta?.exchange === "Binance"
              ? ""
              : meta ? SOURCE_CODE[meta.exchange] ?? "" : "";
            const rowDragClass = [
              expanded === row.symbol ? "selected" : "",
              drag?.kind === "row" && drag.id === row.symbol ? "drag-source-row" : "",
              drag?.kind === "row"
                && drag.target === row.symbol
                && drag.id !== row.symbol
                ? "drag-target-row"
                : "",
            ].filter(Boolean).join(" ");

            return <Fragment key={row.symbol}>
              <tr
                className={rowDragClass}
                onMouseEnter={() => enterTarget("row", row.symbol)}
              >
                <td className="sticky-left">
                  <button
                    className={`coin market-coin${meta?.status === "stale" ? " stale" : ""}`}
                    onMouseDown={(event) => beginPress("row", row.symbol, event)}
                    onClick={() => {
                      if (allowClick("row", row.symbol)) {
                        onToggleExpanded(row.symbol);
                      }
                    }}
                    title={`${marketTooltip(meta)}\n長按 400ms 可拖曳商品順序`}
                  >
                    <span className="chev">
                      {expanded === row.symbol ? "⌄" : "›"}
                    </span>
                    <span className="coin-price">
                      {formatMarketPrice(meta?.price)}
                    </span>
                    <strong>{row.symbol}</strong>
                    <span className={`coin-funding ${fundingClass}`}>
                      {sourceCode ? `${sourceCode}  ` : ""}
                      {formatFundingRate(meta?.fundingRate8h)}
                    </span>
                  </button>
                </td>
                {columnOrder.map((block) => <Fragment key={block}>
                  {renderRowBlock(
                    block,
                    row,
                    levels,
                    mood,
                    queued,
                    paused,
                  )}
                </Fragment>)}
                <td className="sticky-right">
                  <button
                    className="row-action-trigger"
                    onClick={(event) => toggleActionMenu(row.symbol, event)}
                    aria-label={`開啟 ${row.symbol} 操作`}
                    aria-haspopup={isMobile ? "dialog" : "menu"}
                    aria-expanded={actionSymbol === row.symbol}
                    aria-controls={actionSymbol === row.symbol
                      ? isMobile ? "mobile-action-sheet" : "desktop-action-menu"
                      : undefined}
                  >
                    ⋯
                  </button>
                </td>
              </tr>
              {expanded === row.symbol && <tr className="detail-row">
                <td colSpan={4 + aggregateDepths.length + visibleExchanges.length}>
                  <div className="source-grid">
                    {EXCHANGES.map((exchange) => {
                      const source = row.sources.find((item) => item.exchange === exchange);
                      const state = source?.status === "ok"
                        ? "完整"
                        : source?.status === "partial"
                          ? "部分"
                          : source?.status === "unsupported"
                            ? "無交易對"
                            : source?.status === "delayed"
                              ? "延遲"
                              : source?.status === "error" ? "失敗" : "等待";
                      return <article key={exchange} className={`source ${source?.status ?? "loading"}`}>
                        <div><strong>{exchange}</strong><span>{state}</span></div>
                        <p>
                          {source?.pair ?? "—"}{" "}
                          {source && source.pair !== "—" ? <b>{source.quote}</b> : null}
                        </p>
                        {source && (source.status === "ok" || source.status === "partial")
                          ? <dl>
                            <dt>統計深度</dt><dd>基準 ±{primaryDepth}%</dd>
                            <dt>訂單簿深度比值</dt><dd>{ratio(source.imbalance)}</dd>
                            <dt>買 / 賣</dt><dd>${money(source.bids)} / ${money(source.asks)}</dd>
                            <dt>覆蓋</dt><dd>−{source.bidCoverage.toFixed(2)}% / +{source.askCoverage.toFixed(2)}%</dd>
                            <dt>覆蓋驗證</dt><dd>{source.coverageVerified ? "已抵達目標邊界" : "部分深度"}</dd>
                            <dt>動態價區</dt><dd>{formatBucket(source.bucketSize)} {source.quote} · {source.bucketCount} 格</dd>
                            <dt>有效 / 原始檔位</dt><dd>{source.levels} / {source.rawLevelCount ?? (source.rawBidLevels + source.rawAskLevels)}</dd>
                            <dt>取得模式</dt><dd>{acquisitionModeLabel(source)}</dd>
                            <dt>資料來源</dt><dd>{source.feed ?? "REST"}</dd>
                            {source.fallbackReason ? <>
                              <dt>回退原因</dt><dd title={source.fallbackReason}>{source.fallbackReason}</dd>
                            </> : null}
                            <dt>快照狀態</dt><dd>{source.completeness ?? "partial"} · {source.snapshotCount ?? 1} 次 · {source.ageMs ?? 0}ms</dd>
                            <dt>實際取得</dt><dd>{fullTime(source.time)}</dd>
                            <dt>資料年齡</dt><dd>{Math.max(0,Math.floor((clock-source.time)/1000))} 秒</dd>
                            <dt>回應時間</dt><dd>{source.latency}ms</dd>
                          </dl>
                          : <small>{source?.error ?? "尚未取得"}</small>}
                      </article>;
                    })}
                  </div>
                </td>
              </tr>}
            </Fragment>;
          })}
        </tbody>
      </table>
    </div>

    {drag && !isMobile && <div
      className="drag-ghost"
      style={{ left: drag.x + 14, top: drag.y + 14 }}
    >
      {drag.kind === "row"
        ? drag.id
        : drag.id === "aggregate"
          ? `聚合深度 · ${aggregateDepths.length} 欄`
          : COLUMN_LABELS[drag.id as ColumnBlock]}
    </div>}

    {actionRow && !isMobile && typeof document !== "undefined" && createPortal(
      <section
        ref={actionMenuRef}
        id="desktop-action-menu"
        className="desktop-action-menu"
        role="menu"
        aria-label={`${actionRow.symbol} 操作`}
        data-placement={desktopMenuPosition?.placement ?? "bottom"}
        style={{
          left: desktopMenuPosition?.left ?? -1000,
          top: desktopMenuPosition?.top ?? -1000,
          visibility: desktopMenuPosition ? "visible" : "hidden",
        }}
      >
        <strong className="desktop-action-menu-title">{actionRow.symbol}</strong>
        <div className="desktop-action-menu-grid">
          {actionItems("desktop")}
        </div>
      </section>,
      document.querySelector('.monitor-page') ?? document.body,
    )}

    {actionRow && isMobile && <div
      className="mobile-action-backdrop"
      role="presentation"
      onMouseDown={() => closeActionMenu()}
    >
      <section
        id="mobile-action-sheet"
        className="mobile-action-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-action-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mobile-action-handle" />
        <div className="mobile-action-heading">
          <strong id="mobile-action-title">{actionRow.symbol}</strong>
          <button onClick={() => closeActionMenu()} aria-label="關閉">×</button>
        </div>
        <div className="mobile-action-grid">
          {actionItems("mobile")}
        </div>
      </section>
    </div>}
  </>;
}
