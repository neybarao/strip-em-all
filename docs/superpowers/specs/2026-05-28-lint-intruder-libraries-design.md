# Lint mode: detect and detach intruder styles and variables

**Status:** Approved design, ready for implementation plan
**Date:** 2026-05-28
**Branch:** `feat/intruder-linter`

## Problem

Figma files often accumulate styles and variables from libraries that no
longer belong: deprecated design systems, libraries copied from another
file, tokens from a parallel project, or remote items whose source library
was unsubscribed. There is no built-in way to audit "what does not belong
here", select the affected layers visually, or batch-detach the intruders.

Strip 'em All! already knows how to detach styles and variables. This
feature extends it with a discovery and triage step: scan a scope, group
findings by source library, let the user confirm which libraries are
"home", and offer surgical or bulk detach.

## Goals

- Surface every style and variable in a scope whose origin is not the
  current file and not on the user's allow-list of libraries
- Group findings by source library for clear triage
- Let the user select affected layers (visual confirmation) before
  detaching
- Offer per-item, per-library, and global detach actions
- Persist the allow-list per file so the audit is reproducible across
  sessions

## Non-goals

- Auto-fix by substitution (swap an intruder style for a local
  equivalent). Future feature.
- Value-similarity detection (flag hex values that match a local
  variable). Future feature.
- Per-mode variable detach. Plugin API limitation, already documented
  as a future RFC.

## User flow

1. User opens Strip 'em All!. Header now shows a `Strip | Lint`
   segmented toggle. Strip remains the default mode.
2. User switches to Lint.
3. User picks a scope: Selection, Page, or File.
4. User clicks `Scan for intruders`.
5. Sandbox walks the scope and builds an index of every style and
   variable found, classified by source library.
6. UI shows a summary and an expandable list grouped by source library.
   Each library section lets the user mark it as allowed (becomes
   "home" and disappears from the list on next classification), select
   all layers using its items, or detach all of them.
7. Inside each library section, every style and variable lists the
   number of affected layers and has two buttons: `select` (selects
   those layers in the canvas and zooms in) and `detach` (detaches just
   that item across those layers).
8. A global `Detach all intruders` CTA runs the bulk action over every
   item still flagged.
9. After any detach, the scan re-runs automatically so the summary
   stays accurate.

## Architecture

### Mode toggle

The plugin window stays 450x700. A segmented control in the header
switches between two top-level sections in `ui.html`: `#mode-strip` and
`#mode-lint`. CSS and the design system are shared. Each mode has its
own JS handlers wired to a shared `postMessage` router.

### Code layout

`code.js` stays a single file (Figma plugin sandbox does not run ES
modules without a build). Internally it is split into commented
sections:

```
// === router ===          message dispatch by mode
// === walker ===           tree walk + collect (shared)
// === origin ===           classify style/variable source library
// === detach helpers ===   atomic detach for one node + one item
// === strip ===            existing strip orchestration
// === lint ===             new: build byLibrary index, run lint actions
```

The detach primitives that the Strip orchestrator already uses get
pulled into the `detach helpers` section so the Lint orchestrator can
call them on a per-item basis without re-walking.

### Origin classification

For each style and variable found by the walker:

- **Style**: `await figma.getStyleByIdAsync(id)`, then check
  `style.remote`. Local styles get origin `Local`. Remote styles get
  classified by splitting `style.name` on the first `/`: the prefix is
  the conventional library namespace. When the prefix matches a known
  subscribed library or a library already in the file's allow-list, we
  use that name. Otherwise we group under `Unknown library` and append
  a short `style.key` discriminator so distinct unknowns do not collide.
- **Variable**: `await figma.variables.getVariableByIdAsync(id)`, then
  `await figma.variables.getVariableCollectionByIdAsync(variable.variableCollectionId)`.
  Local collections give origin `Local`. Remote collections we cross
  reference with `figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync()`
  to resolve the library name reliably.

### Known API limit

The Plugin API does not expose a fully reliable library name for remote
styles. We use the name-prefix heuristic and fall back to
`Unknown library (key: abc123)` rather than inventing a name. For
variables, detection is reliable via the team library API.

### Allow-list

Default on first scan in a file:

```
allowed = { local: true, subscribedLibraries: all }
```

Persisted per file via
`figma.root.setPluginData('lintAllowedLibs', JSON.stringify(libKeys))`.
Global UI preferences (last chosen scope, etc.) stay in
`figma.clientStorage`.

On scan, the sandbox merges defaults with the persisted list. The UI
shows the resulting allow-list as toggles next to each detected
library section so the user can refine in either direction:

- A subscribed library can be marked as intruder (untoggle "allowed")
- An unknown library can be marked as allowed

Re-classification after a toggle does not require a re-walk: the index
is cached and only the `allowed` filter is re-applied.

### Index shape

```ts
type LintIndex = {
  byLibrary: Map<libKey, {
    name: string,
    isLocal: boolean,
    isSubscribed: boolean,
    allowed: boolean,
    styles: Map<styleId, {
      name: string,
      type: 'fill' | 'stroke' | 'effect' | 'text' | 'grid',
      layerIds: Set<string>,
    }>,
    variables: Map<varId, {
      name: string,
      collection: string,
      layerIds: Set<string>,
    }>,
  }>,
  summary: {
    intruderLibraries: number,
    affectedLayers: number,
    intruderStyles: number,
    intruderVariables: number,
  },
};
```

### Message protocol additions

UI -> sandbox:

- `lint-scan { scope: 'selection' | 'page' | 'file' }`
- `lint-update-whitelist { libKey: string, allowed: boolean }`
- `lint-select-layers { layerIds: string[] }`
- `lint-detach { items: Array<{ kind: 'style' | 'variable', id: string, layerIds: string[] }> }`

Sandbox -> UI:

- `lint-progress { message, percent }`
- `lint-result { index }` (serialized; Maps and Sets become arrays)
- `lint-detach-done { skipped: number }`
- `lint-error { message }`

## UI

### Header

Logo, title, then a segmented control `Strip | Lint` aligned right.
Active segment uses the existing yellow `#ffe800` accent on a black
text. Inactive uses muted text on transparent.

### Lint mode, pre-scan state

```
┌─────────────────────────────────────┐
│  Scope                              │
│  ( Selection ) ( Page ) ( File )    │  segmented
├─────────────────────────────────────┤
│  Allowed libraries                  │
│  Default: local file + subscribed   │
│  libraries. Refine after scanning.  │
└─────────────────────────────────────┘
       [ Scan for intruders ]   yellow CTA
```

CTA is disabled with the hint `Select layers first` when scope is
Selection and the selection is empty.

### Scanning state

The existing progress bar slot is reused with copy `Scanning page... 42%`.

### Results state

```
┌─────────────────────────────────────┐
│  Found 3 intruder libraries         │
│  47 layers affected                 │
│  12 styles, 8 variables             │
└─────────────────────────────────────┘

┌─ Acme Design System ─────────[v]──┐
│  ☐ Mark as allowed                │
│  [ Detach all from this library ] │
│  ────────────────────────────────│
│  Styles (5)                       │
│   color/icons/strong     23 layers│
│       [select] [detach]           │
│   text/body/regular      11 layers│
│       [select] [detach]           │
│  Variables (3)                    │
│   color.brand.primary    18 layers│
│       [select] [detach]           │
└────────────────────────────────────┘

┌─ Unknown library (key: a3f...)  [>]
└─ Old Tokens v1                  [>]

         [ Detach all intruders ]   yellow CTA
         [ Re-scan ]                ghost
```

### Reused components

- Container 16px radius, sub-card 8px radius
- Yellow CTA + ghost button styles
- Switch (used for "Mark as allowed")
- Progress bar slot
- Stats card pattern (re-skinned as the summary at the top)

### New components

- Segmented control (used for mode and for scope)
- Collapsible library section (header always visible, body expand
  with `[v]` / `[>]`)
- Item row: name + count chip + two compact buttons (`select`,
  `detach`)

### Empty and edge states

- No intruders after scan: a single yellow-tinted card "No intruders
  found in this scope." with the bordered yellow style.
- Selection changed after scan in selection scope: a discreet chip
  reading "Selection changed - re-scan?" appears above the list. We
  do not invalidate or hide the results automatically.

## Edge cases

- **Style or variable disappeared between scan and detach**:
  `getStyleByIdAsync` returns `null`. We skip silently and aggregate
  into a final notice `N items skipped: no longer present`.
- **`figma.mixed` font on text nodes**: the existing walker already
  handles ranges. We reuse it. Detach pre-loads fonts only when the
  affected item is a text-property variable.
- **Scope `File` on a large file**: requires
  `await figma.loadAllPagesAsync()` before walking under
  `documentAccess: "dynamic-page"`. UI shows `Loading all pages...`
  before the progress bar.
- **Cancel during scan or detach**: same cooperative flag pattern Strip
  uses today.
- **Whitelist entries for libraries not in the scope**: kept in
  storage but not shown in the UI to avoid phantom rows.
- **Selection changes mid-flight**: never invalidate aggressively. The
  results stay; the chip prompts a re-scan.
- **Variable bindings nested in gradient stops**: the shared walker
  already handles this from prior Strip work.
- **Remote style with no `/` in the name**: cannot infer a library
  name from the prefix. Falls back to `Unknown library` with the key
  discriminator. Never invents a name.
- **Global per-mode unbind limit**: `setBoundVariable(field, null)` is
  global across modes. The library-level `Detach all from this library`
  button shows a small tooltip noting this when the section contains
  variables.

## Risks

1. Remote-style library identification is fragmented; we mitigate by
   being honest in the UI rather than guessing.
2. `loadAllPagesAsync` on huge files can be slow; the File scope shows
   a warning before scanning when the file has many pages.
3. Re-classifying on every whitelist toggle must be cheap; we cache
   the full index from the walk and only re-apply the allow-list
   filter.

## Deliverables

- `code.js` refactored with router, walker, origin, lint, strip,
  detach helpers sections
- `ui.html` extended with Lint mode (header toggle, scope picker,
  scan, grouped results, actions, summary)
- Per-file whitelist persistence via
  `figma.root.setPluginData('lintAllowedLibs', ...)`
- Smoke checks documented in repo: `node -c code.js` and a
  Function-eval of the `<script>` block in `ui.html`
- README updated with a Lint mode section
- CLAUDE.md updated with the new architectural decisions (dual mode,
  classification approach, allow-list persistence)

## Out of scope

- Auto-fix by substitution
- Near-match value detection
- Per-mode variable detach
- A separate plugin entry or repo
