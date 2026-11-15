"use client";

import type {
  KeyboardEvent,
  RefObject,
} from "react";
import { useState } from "react";
import { MAX_SYMBOLS, type AggregateDepthSlot } from "./depth-settings.ts";
import type { SearchableMarket } from "./depth-ui.ts";
import { isDepthOption, type DepthOption } from "./depth-types.ts";
import {
  EXCHANGES,
  type Exchange,
} from "./depth-view-model.ts";

export function MonitorToolbar({
  aggregateDepthSlots,
  primaryDepth,
  depthMenu,
  toggleDepthMenu,
  onChangeDepthSlot,
  onToggleDepthSlot,
  onSetPrimaryDepth,
  marketBox,
  newCoin,
  symbols,
  marketLoading,
  marketOptions,
  marketError,
  marketMenu,
  marketIndex,
  selectedCoin,
  filteredMarkets,
  onMarketFocus,
  onMarketChange,
  onMarketKeyDown,
  addCoin,
  selectMarket,
  setMarketIndex,
  columnMenu,
  toggleColumnMenu,
  visibleExchanges,
  setVisibleExchanges,
  toggleExchange,
}: {
  aggregateDepthSlots: AggregateDepthSlot[];
  primaryDepth: DepthOption;
  depthMenu: boolean;
  toggleDepthMenu: () => void;
  onChangeDepthSlot: (index: number, depth: DepthOption) => string;
  onToggleDepthSlot: (index: number) => string;
  onSetPrimaryDepth: (depth: DepthOption) => void;
  marketBox: RefObject<HTMLDivElement | null>;
  newCoin: string;
  symbols: string[];
  marketLoading: boolean;
  marketOptions: SearchableMarket[];
  marketError: string;
  marketMenu: boolean;
  marketIndex: number;
  selectedCoin: string | null;
  filteredMarkets: SearchableMarket[];
  onMarketFocus: () => void;
  onMarketChange: (value: string) => void;
  onMarketKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  addCoin: () => void;
  selectMarket: (symbol: string) => void;
  setMarketIndex: (index: number) => void;
  columnMenu: boolean;
  toggleColumnMenu: () => void;
  visibleExchanges: Exchange[];
  setVisibleExchanges: (exchanges: Exchange[]) => void;
  toggleExchange: (exchange: Exchange) => void;
}) {
  return <div className="table-headline">
    <div className="table-summary"><h2>監控清單</h2></div>
    <div className="depth-slot-control">
      <button
        className="depth-slot-trigger"
        onClick={toggleDepthMenu}
        aria-expanded={depthMenu}
      >
        聚合深度 {aggregateDepthSlots.filter((slot) => slot.enabled).length} / 5⌄
      </button>
      {depthMenu && <div className="depth-slot-menu">
        <header><strong>聚合深度欄位</strong><small>🔔 為提醒基準</small></header>
        {aggregateDepthSlots.map((slot, index) => <DepthSlotRow
          key={`${index}:${slot.depth}`}
          index={index}
          slot={slot}
          primaryDepth={primaryDepth}
          onChangeDepth={onChangeDepthSlot}
          onToggle={onToggleDepthSlot}
          onSetPrimary={onSetPrimaryDepth}
        />)}
        <p>桌面顯示已開啟欄位；手機只顯示基準深度。</p>
      </div>}
    </div>
    <div className="table-tools">
      <div className="market-control" ref={marketBox}>
        <div className="product-combobox">
          <input
            value={newCoin}
            disabled={
              symbols.length >= MAX_SYMBOLS
              || (marketLoading && !marketOptions.length)
            }
            onFocus={onMarketFocus}
            onChange={(event) => onMarketChange(event.target.value)}
            onKeyDown={onMarketKeyDown}
            placeholder={
              symbols.length >= MAX_SYMBOLS
                ? "已達 20 個商品上限"
                : marketLoading && !marketOptions.length
                  ? "載入商品目錄…"
                  : marketError && !marketOptions.length
                    ? "點此重新載入商品"
                    : "搜尋商品，例如 ADA"
            }
            aria-label="搜尋要新增的商品"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={marketMenu && Boolean(newCoin.trim())}
            aria-controls="market-options"
            aria-activedescendant={
              marketIndex >= 0 ? `market-option-${marketIndex}` : undefined
            }
          />
          <button
            onClick={addCoin}
            disabled={!selectedCoin || symbols.length >= MAX_SYMBOLS}
            title={
              symbols.length >= MAX_SYMBOLS
                ? "每個瀏覽器最多監控 20 個商品"
                : "新增商品"
            }
          >
            ＋ 新增
          </button>
        </div>
        {marketMenu && Boolean(newCoin.trim()) && <div
          className="market-options"
          id="market-options"
          role="listbox"
        >
          {filteredMarkets.length
            ? filteredMarkets.map((item, index) => <button
              id={`market-option-${index}`}
              role="option"
              aria-selected={index === marketIndex}
              className={index === marketIndex ? "active" : ""}
              key={item.symbol}
              onMouseEnter={() => setMarketIndex(index)}
              onClick={() => selectMarket(item.symbol)}
            >
              <strong>{item.symbol}</strong>
              <span>{item.sourceCount} / 7</span>
              <small>{item.exchanges.join(" · ")}</small>
            </button>)
            : <p>沒有符合的可用商品</p>}
        </div>}
      </div>
      <div className="column-control">
        <button
          className="column-trigger"
          onClick={toggleColumnMenu}
          aria-expanded={columnMenu}
        >
          交易所欄位 {visibleExchanges.length} / 7⌄
        </button>
        {columnMenu && <div className="column-menu">
          <div className="column-menu-actions">
            <button onClick={() => setVisibleExchanges([...EXCHANGES])}>全部展開</button>
            <button onClick={() => setVisibleExchanges([])}>全部收起</button>
          </div>
          {EXCHANGES.map((exchange) => <label key={exchange}>
            <input
              type="checkbox"
              checked={visibleExchanges.includes(exchange)}
              onChange={() => toggleExchange(exchange)}
            />
            {exchange}
          </label>)}
        </div>}
      </div>
    </div>
  </div>;
}

function DepthSlotRow({
  index,
  slot,
  primaryDepth,
  onChangeDepth,
  onToggle,
  onSetPrimary,
}: {
  index: number;
  slot: AggregateDepthSlot;
  primaryDepth: DepthOption;
  onChangeDepth: (index: number, depth: DepthOption) => string;
  onToggle: (index: number) => string;
  onSetPrimary: (depth: DepthOption) => void;
}) {
  const [draft, setDraft] = useState(String(slot.depth));
  const [error, setError] = useState("");

  const commit = () => {
    const value = Number(draft);
    if (!isDepthOption(value)) {
      setError("需為 0.25～10，且為 0.25 倍數");
      return;
    }
    const nextError = onChangeDepth(index, value);
    setError(nextError);
    if (nextError) setDraft(String(slot.depth));
  };

  return <div className={`depth-slot-row${slot.enabled ? " enabled" : ""}`}>
    <label className="depth-slot-switch">
      <input
        type="checkbox"
        checked={slot.enabled}
        onChange={() => setError(onToggle(index))}
      />
      <span aria-hidden="true" />
      顯示
    </label>
    <label className="depth-slot-value">
      <input
        aria-label={`聚合深度槽位 ${index + 1}`}
        type="number"
        min="0.25"
        max="10"
        step="0.25"
        value={draft}
        onChange={(event) => { setDraft(event.target.value); setError(""); }}
        onBlur={commit}
        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
      />
      <span>％</span>
    </label>
    <label className="depth-slot-primary">
      <input
        type="radio"
        name="primary-depth"
        checked={slot.depth === primaryDepth}
        disabled={!slot.enabled}
        onChange={() => onSetPrimary(slot.depth)}
      />
      基準
    </label>
    {error && <small role="alert">{error}</small>}
  </div>;
}
