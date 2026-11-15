# Fixed indicator ticks and paired guide colors

- Baseline v40: source `240e96c95f732ff58fa4093b6996b152afe2414b`.
- Indicator automatic tick text suppressed through the series tickmarks formatter, while exact crosshair numeric formatting remains unchanged.
- Fixed right-side labels use actual series price coordinates at 0, +/-0.2, +/-0.4 and +/-0.6. Positive/negative pairs share cyan, gold and lavender respectively; guide lines use faint versions of the same colors.
- Compact 12px tick text avoids the chart library's price-label padding clipping neighboring labels in full-scale mode. Nearby ticks yield to the native crosshair badge, and return when the pointer leaves. No React state writes are required for tick layout.
- Tick redraw observer uses model pane heights and skips initial incomplete pane geometry, avoiding access to not-yet-created pane widgets during mount.
- Integrated canvases are 1000px. Single-asset canvases remain 900px and pane proportions remain 640/120/120.

## Validation

- Relevant 10 real-TSX/source-switching and chart synchronization regressions pass; TypeScript/client/Worker builds pass.
- Browser checked 1920x1080 and 2560x1440, default and +/-1 full-scale modes, single-asset and integrated views, and reload. Right-side labels contain no +/-0.5; +/-0.2/0.4/0.6 and zero are aligned with their guides.
- At 900px/full-scale, fixed labels have 11.7px center spacing and 10px line boxes, with no cropping. Integrated canvases all measure exactly 1000px.
- Browser console has no new errors after the pane mount guard fix. No horizontal document overflow observed.
- Local QA disables Railway history upstream. No acquisition, historical data, authentication, alerts or collector changes.

## Rollback

- Keep v40 `appgprj_6ab6a1b2194081918e210013c8cc7320~appgver_b440896f97308191ade32b83a4d005ea`.
- Publish to the existing MarketDepth Site only.

## Publication receipt

- v41 source: `73657a4a4b0d236f77cd1aa6577c721e71e03b71`.
- Saved version: `appgprj_6ab6a1b2194081918e210013c8cc7320~appgver_10eb650d02748191825dfb17807cc97b`.
- Deployment: `appgdep_6ac88be7ac2c8191b80550405e1c533a`, succeeded at `2026-10-09T06:38:47.779140+00:00`.
- Production verification: three integrated canvases measure 1000px; paired fixed tick colors match the guides; no new console errors after deployment.
- Proof image: `../marketdepth-v41.png`. Owned local QA servers and temporary browser tab closed.
