# Dual depth indicators and compact quality controls

## Implementation

- Retained the candle chart and order-book primitive instances; added a second independently updated ratio series in pane 2.
- Primary session setting remains `research-zone`; secondary uses `research-zone-secondary`, default `c4`. Primary default remains `c2`.
- Preserved primary summary/sidebar/zone-card behavior. Quality scope switches only the displayed asset and indicator.
- Quality and depth settings are mutually exclusive modeless popovers, with initial focus, Escape/outside close, and focus return.
- Canvas remains 900px; pane weights 580/150/150. Measured actual plot heights were 571/148/148px plus separators and time axis.
- Monitor header uses symmetric grid columns with the clock centered across the complete header.

## Validation

- TypeScript, frontend build and Worker build passed. Full regression suite: 152/152 passed.
- Final browser inspection exposed excessive React updates during integrated crosshair redraws. A deterministic asynchronous redraw-echo regression failed before the fix (queue remained nonempty after 20 callbacks), then passed after deduplicating horizontal-line options. Chart callbacks now propagate real pointer events only, while pointer leave explicitly clears synchronized peers. An actual TSX callback test protects both synthetic-event rejection and pane-2 pointer synchronization. No temporary instrumentation remains.
- Added independent cumulative-depth/missing-data tests, stable chart/viewport checks, shared scale checks, and pane-2 UTC crosshair synchronization with missing values and re-entry protection.
- Browser checked research tabs, integrated charts, stored independent settings, quality scope, exclusive popovers, keyboard focus, full-scale controls, contract profile retention during venue switches, and monitor clock keyboard/full-screen behavior.
- Desktop geometry checked at 1920x1080 and 2560x1440, plus equivalent CSS space for 125% scaling (1536x864 and 2048x1152); this is geometry validation, not an emulated device-pixel-ratio claim.
- Settings did not wrap, chart readouts did not overflow, three columns remained equal, and monitor clock center error was below 0.01px.
- Local BFF used `MARKETDEPTH_HISTORY_DISABLED=1`; no manual Railway history comparison was triggered.
- Concurrent research/monitor tabs crossed multiple 30-second samples with a stable owner, term and Worker boot time. All three assets continued updating and all nine indexes were ready. During the controlled switching interval book generations remained stable. A later long-running observation showed BTC USDM generation advancing while the same Worker remained active; do not equate an upstream/background book refresh with chart reconstruction or claim every book generation remained fixed for the entire session.
- Observed profile calculation p95 up to 11.3ms, Canvas p95 1.7ms, and derived work queue 0. These are session observations, not a new long-term performance benchmark.

## Rollback

- Baseline source: `6c0dc0f84a36d66f56adf8ae614857f2425b5fe3`.
- Keep v38: `appgprj_6ab6a1b2194081918e210013c8cc7320~appgver_11224aad5aa88191a668adbb365f97b1`.
- Publish only to the existing MarketDepth Site. No collector, historical format, alerts, authentication, plugin protocol or public API changes.

## Publication receipt

- v39 source: `974cfc0ce10b46c4408633e38b89da23c9acb9d0`.
- Saved version: `appgprj_6ab6a1b2194081918e210013c8cc7320~appgver_485523d7fa508191a34d10a1d6b62825`.
- Deployment: `appgdep_6ac87bdd3d4c81918f3434679cb962eb`, succeeded 2026-10-09 05:30:23 UTC.
- Production confirmed primary `c2`, secondary `c4`, three 900px canvases, quality ETH/indicator-2 view without changing chart assets, and no console errors. Monitor clock center was 959.994px on a 1920px viewport.
- After the crosshair fix, local browser source/depth operations and multiple subsequent 30-second updates produced no new maximum-update-depth warnings.
- Proof: `../marketdepth-v39.png`, `../marketdepth-v39-monitor.png`.
