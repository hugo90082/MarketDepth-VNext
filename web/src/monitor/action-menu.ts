export type ActionMenuAnchor = {
  top: number;
  right: number;
  bottom: number;
};

export type ActionMenuSize = {
  width: number;
  height: number;
};

export type ActionMenuViewport = {
  width: number;
  height: number;
};

export type ActionMenuPosition = {
  left: number;
  top: number;
  placement: "top" | "bottom";
};

export function positionActionMenu(
  anchor: ActionMenuAnchor,
  menu: ActionMenuSize,
  viewport: ActionMenuViewport,
  margin = 12,
  gap = 8,
): ActionMenuPosition {
  const minLeft = margin;
  const maxLeft = Math.max(margin, viewport.width - menu.width - margin);
  const left = Math.min(maxLeft, Math.max(minLeft, anchor.right - menu.width));
  const canOpenBelow = anchor.bottom + gap + menu.height <= viewport.height - margin;
  const placement = canOpenBelow ? "bottom" : "top";
  const desiredTop = canOpenBelow
    ? anchor.bottom + gap
    : anchor.top - gap - menu.height;
  const maxTop = Math.max(margin, viewport.height - menu.height - margin);
  const top = Math.min(maxTop, Math.max(margin, desiredTop));

  return { left, top, placement };
}
