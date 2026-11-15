# Adjusted chart viewport progression

## Request and behavior

Keep the user's horizontal zoom / right padding and manual price-scale state while advancing the displayed time window by one cell on each selected K-line boundary. Applies to BTC, ETH, SOL and integrated charts. A default-on `隨時間推進` checkbox shares a sessionStorage preference within the research tab; disabling anchors historical time, reenabling resumes without replaying disabled periods. `回到最新` still explicitly fits the observation range.

## Implementation

- Display-only ViewportClock counts UTC candle slots (1m through 12h), ignores duplicate/backward clock values, and advances a missed stretch in one operation.
- A whitespace time grid keeps missing candles aligned. Rolling eviction and earlier backfill translate logical indices while preserving UTC position and visible width. Only a normal new last cell uses grid.update; no new fetches, timers or collector changes.
- ChartSync advances the shared UTC range once, then applies each peer's own grid origin. Candle, grid and ratio writes form a single guarded transaction; restoration happens after all data updates.
- Actual Lightweight Charts browser QA caught intermediate base-index callbacks cancelling the advance. The grouped transaction fixes this; source/depth changes still avoid fitting or replacing chart/profile instances.
- StrictMode recreation resets display clock, grid and rendered-ratio refs.

## Verification

- Regression was red before implementation: manually adjusted range stayed at 8.25–16.75 instead of advancing to 9.25–17.75.
- 19 focused regression checks cover selected periods, gaps, pause/resume, backwards clock, rolling/preroll origin, three-peer deduplication and actual TSX source/depth/profile retention, including insertion callbacks.
- Isolated actual Charts + real Lightweight Charts fixture (no Railway/exchange traffic): integrated range 210.25–255.75 → 211.25–256.75 → 214.25–259.75; width stays 45.5 and autoPrice stays false across all three. Disabled clock stays fixed; single 5m mode advances one cell with identical width and manual price state.
- TypeScript and production build pass. At 1920×1080 and 2560×1440 with current browser zoom, all three 32px control rows remain on one line without horizontal overflow.

Baseline: v63 / 1b957abca5ced0b8e3a990fea8df289c9fa91b93. Existing prior work/minute-upstream-recovery.md notes retained.
