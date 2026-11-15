"use client";

import type {
  Dispatch,
  RefObject,
  SetStateAction,
} from "react";
import type {
  AlertLogEntry,
  Levels,
} from "./depth-settings.ts";
import { pluginAlertLabel } from "./plugin-alert-label.ts";

function formatLogTime(value: number) {
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

function logTypeLabel(entry: AlertLogEntry) {
  if (entry.pluginEvent) return pluginAlertLabel(entry.pluginEvent);
  if (entry.tone === "direction-buy") return "負轉正";
  if (entry.tone === "direction-sell") return "正轉負";
  if (entry.tone?.startsWith("buy") || entry.tone?.startsWith("sell")) {
    const side = entry.tone.startsWith("buy") ? "買" : "賣";
    const tier = entry.tone.endsWith("3")
      ? "III"
      : entry.tone.endsWith("2")
        ? "II"
        : "I";
    return `${side} ${tier}`;
  }
  if (entry.tone === "generic-up") return "高於／上穿";
  if (entry.tone === "generic-down") return "低於／下穿";
  if (entry.source === "coinglass-indicator-extension" || entry.type === "plugin") return "插件";
  if (entry.type === "threshold") return "門檻";
  if (entry.type === "direction") return "翻轉";
  return entry.type === "error" ? "抓取錯誤" : "系統";
}

export function AlertLogPanel({
  history,
  historyPane,
  onHistoryScroll,
  pluginConnection,
  pluginStatusText,
  pluginBackupText,
  canClearWebsiteHistory,
  canClearPluginHistory,
  canRestorePluginBackup,
  canKeepLivePluginBackup,
  onClearWebsiteHistory,
  onClearPluginHistory,
  onRestorePluginBackup,
  onKeepLivePluginBackup,
  globalLevels,
  setGlobalLevels,
}: {
  history: AlertLogEntry[];
  historyPane: RefObject<HTMLDivElement | null>;
  onHistoryScroll: () => void;
  pluginConnection: "connected" | "disconnected" | "incompatible";
  pluginStatusText: string;
  pluginBackupText: string;
  canClearWebsiteHistory: boolean;
  canClearPluginHistory: boolean;
  canRestorePluginBackup: boolean;
  canKeepLivePluginBackup: boolean;
  onClearWebsiteHistory: () => void;
  onClearPluginHistory: () => void;
  onRestorePluginBackup: () => void;
  onKeepLivePluginBackup: () => void;
  globalLevels: Levels;
  setGlobalLevels: Dispatch<SetStateAction<Levels>>;
}) {
  return <section className="alert-log" aria-label="提醒紀錄">
    <div className="alert-log-main">
      <div className="alert-log-bridge-bar">
        <span className="plugin-connection" title={pluginStatusText}>
          <i className={pluginConnection} aria-hidden="true" />
          <span>{pluginStatusText}</span>
        </span>
        <details className="plugin-history-actions">
          <summary>插件與紀錄</summary>
          <div>
            <section className="plugin-download" aria-label="下載 CoinGlass 指標提醒">
              <a
                className="plugin-download-link"
                href="/downloads/coinglass-indicator-alert-v1.4.1.zip"
                download
              >下載 CoinGlass 指標提醒 v1.4.1</a>
              <small>約 46 KB · SHA-256</small>
              <code title="954712687c2432b516deb43825b0a349727007003e4f6cbe7b825c81bfa86e4f">
                954712687c2432b516deb43825b0a349727007003e4f6cbe7b825c81bfa86e4f
              </code>
              <ol>
                <li>下載後解壓縮。</li>
                <li>開啟 <code>chrome://extensions</code>。</li>
                <li>啟用開發人員模式，選擇「載入未封裝項目」。</li>
              </ol>
              <p>更新時請覆蓋原資料夾，再到擴充功能頁重新載入。</p>
            </section>
            <p>{pluginBackupText}</p>
            <button type="button" onClick={onRestorePluginBackup} disabled={!canRestorePluginBackup || pluginConnection !== "connected"}>從網站恢復插件</button>
            <button type="button" onClick={onKeepLivePluginBackup} disabled={!canKeepLivePluginBackup}>以插件設定覆寫網站備份</button>
            <button type="button" onClick={onClearWebsiteHistory} disabled={!canClearWebsiteHistory}>清除網站紀錄</button>
            <button type="button" onClick={onClearPluginHistory} disabled={!canClearPluginHistory || pluginConnection !== "connected"}>清除插件紀錄</button>
          </div>
        </details>
      </div>
      <div
        className="alert-log-scroll"
        ref={historyPane}
        onScroll={onHistoryScroll}
        role="log"
        aria-live="polite"
      >
        {history.length === 0
          ? <p className="alert-log-empty">尚無提醒</p>
          : history.map((entry) => {
            return <article
            key={`${entry.source ?? "depthwatch"}:${entry.id}`}
            className={`log-entry ${entry.type}${entry.tone ? ` tone-${entry.tone}` : ""}`}
            title={`${formatLogTime(entry.time)}｜${entry.symbol}｜${logTypeLabel(entry)}｜${entry.message}${entry.pluginEvent ? `｜${entry.pluginEvent.exchange}｜${entry.pluginEvent.interval}｜${entry.pluginEvent.indicator}｜${entry.pluginEvent.output} ${entry.pluginEvent.displayValue}` : ""}`}
          >
            <time dateTime={new Date(entry.time).toISOString()}>
              {formatLogTime(entry.time)}
            </time>
            <span>{entry.symbol}</span>
            <b>{logTypeLabel(entry)}</b>
            <p>{entry.message}</p>
          </article>})}
      </div>
    </div>
    <aside className="global-settings-inline" aria-label="全域極端門檻設定">
      <div className="global-settings-heading">
        <div>
          <span>GLOBAL THRESHOLDS</span>
          <strong>全域極端門檻</strong>
        </div>
        <small>未覆寫商品沿用</small>
      </div>
      <div className="global-level-fields">
        <label>第一段
          <input
            aria-label="全域第一段極端值"
            type="number"
            min="0.01"
            max="0.68"
            step="0.01"
            value={globalLevels.level1}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (value > 0 && value < globalLevels.level2) {
                setGlobalLevels((current) => ({ ...current, level1: value }));
              }
            }}
          />
        </label>
        <label>第二段
          <input
            aria-label="全域第二段極端值"
            type="number"
            min="0.02"
            max="0.69"
            step="0.01"
            value={globalLevels.level2}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (value > globalLevels.level1 && value < globalLevels.level3) {
                setGlobalLevels((current) => ({ ...current, level2: value }));
              }
            }}
          />
        </label>
        <label>第三段
          <input
            aria-label="全域第三段極端值"
            type="number"
            min="0.03"
            max="0.7"
            step="0.01"
            value={globalLevels.level3}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (value > globalLevels.level2 && value <= 0.7) {
                setGlobalLevels((current) => ({ ...current, level3: value }));
              }
            }}
          />
        </label>
      </div>
      <div className="threshold-preview inline-preview">
        <span>−{globalLevels.level3}</span>
        <span>−{globalLevels.level2}</span>
        <span>−{globalLevels.level1}</span>
        <b>0</b>
        <span>+{globalLevels.level1}</span>
        <span>+{globalLevels.level2}</span>
        <span>+{globalLevels.level3}</span>
      </div>
      <p>第一段持續 60 秒才提醒；變更會立即套用並保存。</p>
    </aside>
  </section>;
}

export function ScheduleSettingsCard({
  refreshDraft,
  gapDraft,
  setRefreshDraft,
  setGapDraft,
  commitRefreshSeconds,
  commitGapSeconds,
  isLeader,
  pageVisible,
  refreshSeconds,
}: {
  refreshDraft: string;
  gapDraft: string;
  setRefreshDraft: (value: string) => void;
  setGapDraft: (value: string) => void;
  commitRefreshSeconds: () => void;
  commitGapSeconds: () => void;
  isLeader: boolean;
  pageVisible: boolean;
  refreshSeconds: number;
}) {
  return <aside className="schedule-settings-card" aria-label="更新排程設定">
    <div className="schedule-settings-heading"><span>UPDATE SCHEDULE</span><strong>更新排程</strong></div>
    <div className="schedule-fields compact">
      <label>其他商品週期<span><input aria-label="更新週期秒數" type="number" min="5" max="3600" step="1" value={refreshDraft} onChange={(event) => setRefreshDraft(event.target.value)} onBlur={commitRefreshSeconds} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />秒</span></label>
      <label>商品錯開<span><input aria-label="商品錯開秒數" type="number" min="0" max="60" step="0.1" value={gapDraft} onChange={(event) => setGapDraft(event.target.value)} onBlur={commitGapSeconds} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />秒</span></label>
    </div>
    <div className="schedule-status">
      <span>{pageVisible?'監控頁可見':'監控頁在背景'} · 其他商品目標 {pageVisible?refreshSeconds:refreshSeconds*5} 秒 · {isLeader?'行情主控':'接收共用資料'}</span>
      <small>BTC／ETH／SOL 固定 30 秒；其他商品依設定。背景監控頁的其他商品五倍降頻。</small>
    </div>
  </aside>;
}
