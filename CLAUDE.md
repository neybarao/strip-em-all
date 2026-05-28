# Strip 'em All! — Project Memory

## What it is

Figma plugin that detaches every applied style and variable from the
selected layers, writing the resolved values back as literals. The
layers look identical, they just stop referencing any library or token.

Useful for handoff prep, archiving a frozen state, or cleaning legacy
tokens out of a file.

## Stack

- Vanilla HTML + JS. No build step, no TypeScript, no lint, no tests.
- `ui.html` (UI iframe) ↔ `code.js` (sandbox) over
  `figma.ui.postMessage` / `parent.postMessage`.
- `manifest.json`: `api 1.0.0`, `documentAccess: "dynamic-page"`,
  `networkAccess` allows Google Fonts.
- Inter via Google Fonts (weights 400 / 600 / 700 only).
- `icon.png` is inlined into `ui.html` as a base64 data URL because
  the plugin iframe does not resolve relative file paths.

## File layout

```
manifest.json   plugin manifest, name + id + documentAccess
code.js         sandbox: tree walk, style detach, variable unbind, stats
ui.html         UI iframe: state, switches, prefs persistence, drain ticker
icon.png        512x512 banana icon (inlined into ui.html; also used by README)
README.md       Community-facing copy (icon + tagline)
```

## Message protocol

UI → sandbox:
- `strip { styles: {fill,stroke,effect,text,grid}, unlinkTokens }`
- `save-preferences { preferences: {...} }`
- `load-preferences`
- `cancel`

Sandbox → UI:
- `preferences-loaded { preferences }`
- `stats { stats: { layers, styles: {fill,stroke,effect,text,grid}, stylesTotal, variables } | null }`
- `progress { message, percent }`
- `success { message }`
- `error { message }`

UI → sandbox (Lint mode):
- `lint-scan { scope: 'selection' | 'page' | 'file' }`
- `lint-update-whitelist { libKey, allowed }`
- `lint-select-layers { layerIds }`
- `lint-detach { items: [{ kind, id, layerIds }] }`

Sandbox → UI (Lint mode):
- `lint-progress { message, percent }`
- `lint-result { index, scope }`
- `lint-detach-done { skipped }`
- `lint-selection-changed`
- `lint-error { message }`

## Plugin API constraints learned (don't relitigate)

- Under `documentAccess: "dynamic-page"`, direct assignment to
  `fillStyleId` / `strokeStyleId` / `effectStyleId` / `gridStyleId`
  **throws**. Always use `setFillStyleIdAsync` / `setStrokeStyleIdAsync`
  / `setEffectStyleIdAsync` / `setGridStyleIdAsync` / `setTextStyleIdAsync`.
  `setFillStyleIdAsync` covers `backgroundStyleId` too per docs.
- `setTextStyleIdAsync('')` does NOT require the font to be loaded.
  It only drops the style reference. Pre-loading the font here will
  fail on missing fonts and block the detach.
- Property writes for text (`fontSize`, `lineHeight`, `letterSpacing`,
  `paragraphSpacing`, `paragraphIndent`, `fontName`) DO require
  `loadFontAsync`. For `figma.mixed` fontName, walk ranges and load
  each unique font (`ensureTextFontsLoaded` in code.js).
- `setBoundVariable(field, null)` is GLOBAL across modes. The Plugin
  API has no per-mode unbind. Documented as future RFC.
- Typography variables can bind to three independent keys: `fontFamily`,
  `fontStyle`, AND `fontWeight`. Don't miss `fontWeight`.
- Gradient paints carry variable bindings inside
  `paint.gradientStops[k].boundVariables`, not on `paint.boundVariables`.
  Shallow checks miss them — use deep recursion (`hasNestedBoundVars`).
- `manifest.json` does NOT accept an `"icon"` field. Community plugin
  icon is uploaded separately during publish.
- Plugin iframe does not resolve relative paths to local files. Assets
  must be inlined or fetched over `networkAccess.allowedDomains`.

- Remote-style library name is not exposed reliably. Fall back to the
  name prefix and `style.key` (`Unknown library (key: abc123)`).
- Remote-variable library name comes from
  `figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync()`
  matched by `collection.key`.
- `figma.loadAllPagesAsync()` is required before walking the whole
  file under `documentAccess: "dynamic-page"`.

## Architecture decisions

- **Two-pass detach**: styles first, then variables. After style detach,
  re-walk the tree to pick up bindings that the style detach transferred
  onto the node directly.
- **Stats payload separates `stylesTotal` from per-category counts**.
  Per-category drives the 5-cell grid; total drives the "with styles"
  line.
- **Watchdog scales with selection size**: `60s + 10ms × layers`, cap 5min.
  Fixed timeouts falsely fired on huge selections where text style
  detach loaded many fonts.
- **`pluginState` shape is forward-only**: `{ styles: {fill,stroke,
  effect,text,grid}, unlinkTokens }`. `normalizePrefs` migrates the old
  `{ unlinkStyles: bool }` shape on load. Backend handler also accepts
  old `unlinkStyles` flag as a shim.
- **`dom = {}` cache** populated at bootstrap eliminates repeated
  `getElementById` calls in hot paths (drain ticker, stats update,
  toggle handlers).
- **Dark only.** Light mode was tried and pulled — `#ffe800` accent on
  light surfaces had bad contrast and the plugin is a single-purpose
  utility, not worth the polish to fix.

- **Lint mode**: second top-level mode toggled in the header. Shares
  walker, detach helpers, and design system with Strip. Builds a
  `byLibrary` index of every style and variable in the chosen scope
  (Selection / Page / File), classifies origin by the existing
  subscribed-library API for variables and a name-prefix heuristic for
  styles (with `Unknown library (key: ...)` fallback). Allow-list is
  per file via `figma.root.setPluginData('lintAllowedLibs', ...)`.
- **Re-classify cache**: scan keeps the full index in memory; toggling
  `Mark as allowed` only re-applies the allow-list filter on the
  cached index — no re-walk.

## Design system

- Background `#0e0d0b`, surface `#161616`, inner sub-card `#111111`.
- Primary yellow `#ffe800` (was `#ffe927` originally, then `#ffe800`
  to match Figma mockup tokens).
- Text white, muted `#9e9e9e`. Borders are very low-opacity tints
  (`rgba(255,232,0,0.10)` for yellow card borders).
- Inter 14px body, 22px / 600 title, 12-14px / 600 sub-toggle labels,
  16px / 600 CTA.
- Container radius 16px, sub-card radius 8px, switches 999px (pill).
- Switch states: off (outlined transparent), on (filled yellow + black
  thumb), indeterminate (yellow track + center thin thumb).
- Sub-toggles always visible (no accordion / chevron). Master + 5
  category switches stack inside one rounded container, divider
  between "Detach Styles" item and "Detach Variables" item.
- Stats card uses nested sub-cards (`Never nest cards` design law
  knowingly broken to match the user's mockup).
- Progress bar slot always reserved (opacity 0 ↔ 1) so the CTA never
  shifts.
- Window size: `450 × 700`.

## Commit history (most recent first)

| SHA       | Summary |
|-----------|---------|
| `3a38f78` | fix: detach text style on missing-font layers |
| `14e2894` | optimize+harden: cache DOM refs, scale watchdog, drop log noise |
| `5dace52` | merge `feat/granular-detach-and-safety` → main |
| `534d2c4` | fix(ui): reserve progress bar space so CTA isn't clipped |
| `329d0c7` | feat(ui): tighten CTA spacing, drop light mode |
| `880d4aa` | feat(ui): match new Figma mockup design (Inter, banana icon, nested stats sub-cards) |
| `1ee5474` | fix(manifest): drop unsupported `icon` field |
| `15fd741` | chore: add plugin icon and refresh README |
| `89f672f` | fix(ui): align master switches by moving chevron next to label |
| `ebb2406` | fix: unbind fontWeight + paragraphIndent text variables |
| `cbf444d` | fix: unbind text vars on mixed-font nodes after style detach |
| `09f7edd` | fix: detect variable bindings nested in gradient stops |
| `9284949` | feat: granular style category toggles + per-type stats |
| `853ddaa` | chore: migrate style detach to async setters (dynamic-page-safe) |
| `e448e45` | Polish UI: stats card, copy, hardening |
| `ca2d26d` | Remove Detach Components, restyle UI to shadcn with dark/light theme |

## Pending roadmap (from the original spec; partially done)

Done:
- [x] Granular style category toggles + per-type stats
- [x] Async style setter migration (dynamic-page safe)
- [x] Various variable-binding bug fixes (gradient stops, mixed fonts,
      fontWeight, missing-font styles)
- [x] Visual redesign to match Figma mockup
- [x] Watchdog scaling and DOM caching pass

Still pending:
- [ ] Granular variable collection toggles (sub-toggle per collection
      in use by the selection)
- [ ] Scope filters: include locked / include hidden
- [ ] Preview / dry-run panel with navigable layer list (uses
      `figma.viewport.scrollAndZoomIntoView`)
- [ ] Main Component impact warning modal before strip
- [ ] Cooperative cancellation during processing
- [ ] CHANGELOG / README updates and RFC for per-mode detach

## Out of scope

- **Per-mode variable detach.** Plugin API has no API to unbind a
  variable for one mode while keeping bindings on others. Future RFC
  with two workaround proposals:
  (a) snapshot value + create shadow variable per-mode + rebind, or
  (b) `setExplicitVariableModeForCollection` + global detach (makes
  the node monomodal for that property).

## Conventions

- Atomic commits per concern, descriptive multi-line bodies.
- Vocab: use "detach" everywhere in UI labels and progress messages
  (not "remove" / "unlink"). Backend internal variable names can still
  use "unlinkTokens" etc.
- No em-dashes in copy (use commas, colons, semicolons, periods).
- Before commit: `node -c code.js` and Function-eval the `<script>`
  block of `ui.html`. Catches syntax breaks early.
- Console: `console.error` only on real error paths. Drop verbose
  per-node `console.log`.

## Branches and remote

- `origin` = `https://github.com/neybarao/StripThatOut.git`
- `main` is the only published branch.
- `feat/granular-detach-and-safety` was the feature branch that landed
  the granular toggles and the bug-fix batch. Merged via `--no-ff` so
  the branch is preserved in the history.
- Several commits ahead of `origin/main`. Push when ready.

## Community publish notes

- Plugin name on the listing: `Strip 'em All!`.
- Icon for the cover: upload `icon.png` directly via the publish flow
  (manifest does not carry it).
- Description and tagline drafted in chat; not yet committed to a file.
- Tags suggested: `design-system`, `cleanup`, `handoff`, `variables`,
  `styles`, `tokens`.
