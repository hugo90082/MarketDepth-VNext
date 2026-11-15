# Chart pane presentation refinement

- Baseline: v39, source `974cfc0ce10b46c4408633e38b89da23c9acb9d0`.
- Removed only indicator-pane headings. Retained top crosshair readout and depth selection controls.
- Pane stretch factors changed from 580/150/150 to 640/120/120. Both indicator panes retain the same factor; integer layout rounding can differ by 1px.
- Added faint fixed-value horizontal price lines at -0.6, -0.4, -0.2, +0.2, +0.4 and +0.6 to each histogram. Existing zero line and scale behavior retained. No extra price-axis badges.
- Integrated canvases changed from 900px to 945px (+5%); single-asset canvases stay 900px.
- Removed obsolete pane-heading position state; resize handling still preserves following/manual viewport behavior.

## Validation

- 10 relevant real-TSX/synchronization regressions passed, including independent cumulative values, gaps, source/depth switching without viewport reset, profile retention, and crosshair echo protection.
- TypeScript, client build and Worker build passed.
- Browser checked 1920x1080 and 2560x1440, integrated and BTC/ETH/SOL views, no indicator headings, independent controls and full-scale switching. No browser console errors observed.
- Actual single-asset rows: 630/118/119px plus separators/time axis; integrated: 662/124/125px plus separators/time axis. Total canvas heights exactly 900px and 945px respectively.
- Fixed lines inspected visually; no horizontal page overflow. Local history upstream disabled with `MARKETDEPTH_HISTORY_DISABLED=1`.
- No changes to data acquisition, alerts, history, profile lifecycle, monitor UI or authentication.

## Rollback

- Keep v39 saved version `appgprj_6ab6a1b2194081918e210013c8cc7320~appgver_485523d7fa508191a34d10a1d6b62825`.
- Publish to existing MarketDepth Site only.

## Publication receipt

- v40 source `240e96c95f732ff58fa4093b6996b152afe2414b`.
- Saved version `appgprj_6ab6a1b2194081918e210013c8cc7320~appgver_b440896f97308191ade32b83a4d005ea`.
- Deployment `appgdep_6ac8842581bc8191be3c2970ec85c852`, succeeded 2026-10-09 06:05:44 UTC.
- Production checked: 1920px viewport, all three canvases exactly 945px, no indicator headings or console errors. Screenshot `../marketdepth-v40.png`.
