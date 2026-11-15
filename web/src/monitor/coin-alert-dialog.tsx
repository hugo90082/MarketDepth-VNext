"use client";

import { useEffect, useState } from "react";
import type { AlertConfig, Levels } from "./depth-settings.ts";

type LevelsDraft = Record<keyof Levels, string>;
type AlertDraft = {
  enabled: boolean;
  custom: boolean;
  splitSides: boolean;
  shared: LevelsDraft;
  buy: LevelsDraft;
  sell: LevelsDraft;
  sound: boolean;
  notification: boolean;
};

const toDraftLevels = (levels: Levels): LevelsDraft => ({
  level1: String(levels.level1),
  level2: String(levels.level2),
  level3: String(levels.level3),
});

function parseLevels(value: LevelsDraft): Levels | null {
  const levels = {
    level1: Number(value.level1),
    level2: Number(value.level2),
    level3: Number(value.level3),
  };
  return Number.isFinite(levels.level1)
    && Number.isFinite(levels.level2)
    && Number.isFinite(levels.level3)
    && levels.level1 > 0
    && levels.level1 < levels.level2
    && levels.level2 < levels.level3
    && levels.level3 <= 0.7
    ? levels
    : null;
}

function createDraft(config: AlertConfig): AlertDraft {
  return {
    enabled: config.enabled,
    custom: config.custom,
    splitSides: config.splitSides,
    shared: toDraftLevels(config),
    buy: toDraftLevels(config.buyLevels),
    sell: toDraftLevels(config.sellLevels),
    sound: config.sound,
    notification: config.notification,
  };
}

export function CoinAlertDialog({
  symbol,
  config,
  onSave,
  onClose,
}: {
  symbol: string;
  config: AlertConfig;
  onSave: (symbol: string, config: AlertConfig) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => createDraft(config));
  const [error, setError] = useState("");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const setLevel = (group: "shared" | "buy" | "sell", key: keyof Levels, value: string) => {
    setError("");
    setDraft((current) => ({ ...current, [group]: { ...current[group], [key]: value } }));
  };

  const toggleSplit = (splitSides: boolean) => {
    setDraft((current) => ({
      ...current,
      splitSides,
      buy: { ...current.shared },
      sell: { ...current.shared },
    }));
    setError("");
  };

  const save = () => {
    const shared = parseLevels(draft.shared);
    const buy = parseLevels(draft.buy);
    const sell = parseLevels(draft.sell);
    if (draft.custom && (!shared || (draft.splitSides && (!buy || !sell)))) {
      setError("每側皆須符合 0 < 第一段 < 第二段 < 第三段 ≤ 0.7");
      return;
    }
    const safeShared = shared ?? { level1: config.level1, level2: config.level2, level3: config.level3 };
    onSave(symbol, {
      enabled: draft.enabled,
      custom: draft.custom,
      ...safeShared,
      splitSides: draft.custom && draft.splitSides,
      buyLevels: draft.custom && draft.splitSides && buy ? buy : { ...safeShared },
      sellLevels: draft.custom && draft.splitSides && sell ? sell : { ...safeShared },
      sound: draft.sound,
      notification: draft.notification,
    });
  };

  return <div className="modal-backdrop" onMouseDown={onClose}>
    <section className="modal alert-settings-modal" role="dialog" aria-modal="true" aria-labelledby="coin-alert-title" onMouseDown={(event) => event.stopPropagation()}>
      <button className="modal-close" onClick={onClose} aria-label="取消並關閉">×</button>
      <p className="eyebrow">{symbol} ALERT</p>
      <h2 id="coin-alert-title">{symbol} 提醒設定</h2>
      <div className="alert-toggle-row">
        <Toggle checked={draft.enabled} onChange={(enabled) => setDraft((current) => ({ ...current, enabled }))}>啟用提醒</Toggle>
        <Toggle checked={draft.custom} onChange={(custom) => setDraft((current) => ({ ...current, custom }))}>自訂此商品門檻</Toggle>
        <Toggle checked={draft.splitSides} disabled={!draft.custom} onChange={toggleSplit}>買盤／賣盤分開</Toggle>
      </div>

      <div className={!draft.custom ? "disabled-group" : ""}>
        {draft.splitSides
          ? <div className="directional-level-groups">
            <section className="sell-level-group"><strong>賣盤門檻</strong><ThresholdInputs group="sell" value={draft.sell} disabled={!draft.custom} onChange={setLevel} /></section>
            <section className="buy-level-group"><strong>買盤門檻</strong><ThresholdInputs group="buy" value={draft.buy} disabled={!draft.custom} onChange={setLevel} /></section>
          </div>
          : <section className="shared-level-group"><strong>買賣共用門檻</strong><ThresholdInputs group="shared" value={draft.shared} disabled={!draft.custom} onChange={setLevel} /></section>}
      </div>
      {error && <p className="modal-error" role="alert">{error}</p>}
      <p className="repeat-note">第一段持續超過門檻 60 秒才提醒一次；第二段以上立即提醒並每 60 秒重複。正負翻轉採 ±0.01 緩衝。</p>
      <div className="check-row">
        <Toggle checked={draft.sound} onChange={(sound) => setDraft((current) => ({ ...current, sound }))}>聲音</Toggle>
        <Toggle checked={draft.notification} onChange={(notification) => setDraft((current) => ({ ...current, notification }))}>系統通知</Toggle>
      </div>
      <button className="save" onClick={save}>完成設定</button>
    </section>
  </div>;
}

function ThresholdInputs({
  group,
  value,
  disabled,
  onChange,
}: {
  group: "shared" | "buy" | "sell";
  value: LevelsDraft;
  disabled: boolean;
  onChange: (group: "shared" | "buy" | "sell", key: keyof Levels, value: string) => void;
}) {
  return <div className="threshold-input-grid">
    {(["level1", "level2", "level3"] as const).map((key, index) => <label key={key}>第 {index + 1} 段
      <span>{group === "sell" ? "−" : "+"}<input disabled={disabled} type="number" min="0.01" max="0.7" step="0.01" value={value[key]} onChange={(event) => onChange(group, key, event.target.value)} /></span>
    </label>)}
  </div>;
}

function Toggle({
  checked,
  disabled = false,
  onChange,
  children,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  children: React.ReactNode;
}) {
  return <label className="toggle"><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><span />{children}</label>;
}
