"use client";

import { useEffect } from "react";
import type { AlertEvent } from "./alert-policy.ts";

const PREVIEWS: Array<{ event: AlertEvent; label: string; detail: string }> = [
  { event: "buy1", label: "買盤 I", detail: "高" },
  { event: "buy2", label: "買盤 II", detail: "高 → 更高" },
  { event: "buy3", label: "買盤 III", detail: "高 → 更高 → 最高" },
  { event: "sell1", label: "賣盤 I", detail: "低" },
  { event: "sell2", label: "賣盤 II", detail: "低 → 更低" },
  { event: "sell3", label: "賣盤 III", detail: "低 → 更低 → 最低" },
  { event: "direction-buy", label: "負轉正", detail: "低 → 高長滑音" },
  { event: "direction-sell", label: "正轉負", detail: "高 → 低長滑音" },
];

export function SoundPreviewDialog({
  onPreview,
  onClose,
}: {
  onPreview: (event: AlertEvent) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return <div className="modal-backdrop" onMouseDown={onClose}>
    <section className="modal sound-preview-modal" role="dialog" aria-modal="true" aria-labelledby="sound-preview-title" onMouseDown={(event) => event.stopPropagation()}>
      <button className="modal-close" onClick={onClose} aria-label="關閉聲音試聽">×</button>
      <p className="eyebrow">ALERT SOUND</p>
      <h2 id="sound-preview-title">聲音試聽</h2>
      <p className="modal-intro">試聽不會開啟通知，也不會寫入提醒紀錄。</p>
      <div className="sound-preview-grid">
        {PREVIEWS.map((item) => <button className={item.event.startsWith("direction") ? "direction" : item.event.startsWith("buy") ? "buy" : "sell"} key={item.event} onClick={() => onPreview(item.event)}>
          <strong>{item.label}</strong><small>{item.detail}</small>
        </button>)}
      </div>
    </section>
  </div>;
}
