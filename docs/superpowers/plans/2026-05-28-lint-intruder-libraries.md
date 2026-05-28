# Lint Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Lint mode to Strip 'em All! that scans a selected scope, lists styles and variables whose source library is not on a per-file allow-list, and lets the user select affected layers or detach intruders (per item, per library, or all).

**Architecture:** Single `code.js` (sandbox) split into commented sections — a shared walker, a new origin classifier, the existing Strip orchestrator, the new Lint orchestrator, and shared detach helpers. `ui.html` gains a `Strip | Lint` header toggle and a second screen with scope picker, grouped results, and actions. Allow-list persists per file via `figma.root.setPluginData`; UI prefs stay in `figma.clientStorage`.

**Tech Stack:** Vanilla HTML + JS, Figma Plugin API `1.0.0`, `documentAccess: "dynamic-page"`. No build, no test framework — verification is `node -c code.js`, Function-eval of the `<script>` block in `ui.html`, and a manual Figma smoke run after UI-touching tasks.

**Reference:** [docs/superpowers/specs/2026-05-28-lint-intruder-libraries-design.md](../specs/2026-05-28-lint-intruder-libraries-design.md)

**Branch:** `feat/intruder-linter` (already created).

**Verification primitives used in every task:**

- Syntax check: `node -c code.js`
- UI script check (run from repo root):

  ```bash
  node -e "const fs=require('fs');const html=fs.readFileSync('ui.html','utf8');const m=html.match(/<script[^>]*>([\s\S]*?)<\/script>/);if(!m){process.exit(1)};new Function(m[1]);console.log('ui script ok')"
  ```

- Manual Figma run: load the plugin via `Plugins > Development > Import plugin from manifest`, open it on a known file, exercise the change.

---

## File structure

| File | Role | Touched in tasks |
|------|------|------------------|
| `code.js` | Sandbox: router, walker, origin, strip, lint, detach helpers | 1, 3, 4, 5, 7, 8, 9, 10, 11, 12 |
| `ui.html` | UI iframe: mode toggle, strip screen, lint screen | 2, 5, 6, 7, 8, 9, 10, 11, 12 |
| `CLAUDE.md` | Project memory | 13 |
| `README.md` | Public docs | 13 |

---

### Task 1: Refactor `code.js` into commented sections (no behavior change)

**Why:** the file is ~812 lines and Lint mode will add another orchestrator plus a classifier. Sectioning now keeps the file navigable without introducing modules (which the sandbox does not support).

**Files:**
- Modify: `code.js` (whole file)

- [ ] **Step 1: Read `code.js` end to end and map current contents to the target sections**

  Target section order, top to bottom:

  ```
  // === bootstrap ===          showUI, preferences load/save, startup
  // === walker ===              tree walk + collect (shared, no detach)
  // === origin ===              classify source library (added in Task 3)
  // === detach helpers ===      atomic detach for one node + one item
  // === strip ===                existing Strip orchestrator + sendStats
  // === lint ===                 new orchestrator (added later)
  // === router ===              figma.ui.onmessage dispatch
  ```

  Identify, for each existing top-level declaration, which section it belongs to. The existing `figma.ui.onmessage = ...` block becomes the `router` section.

- [ ] **Step 2: Reorder functions under section banners**

  Add the section banner comments. Move existing functions under their banner. Do not rename anything. Do not change behavior. The `bootstrap` IIFE-ish code (`figma.showUI`, the `loadPreferences().then(...)`) stays at the bottom or top — pick top, immediately after the bootstrap banner.

  Concretely:
  - `loadPreferences`, `savePreferences`, the startup `.then(...)` block → `bootstrap`
  - `walkAndCollect` (or whichever function walks the tree to collect stats) → `walker`
  - The functions that perform actual detach on a node (`detachStylesFromNode`, `detachVariablesFromNode`, `ensureTextFontsLoaded`, `hasNestedBoundVars`, etc.) → `detach helpers`
  - The Strip orchestrator (`runStrip`, `sendStats`, `getStyleCategories`, etc.) → `strip`
  - `figma.ui.onmessage = ...` → `router`

  Leave `// === origin ===` and `// === lint ===` as empty banner blocks for now (Tasks 3+ fill them).

- [ ] **Step 3: Syntax check**

  Run: `node -c code.js`
  Expected: no output, exit 0.

- [ ] **Step 4: Manual smoke**

  Load the plugin in Figma, run Strip on a small selection with at least one styled layer. Confirm: stats card shows, Detach button works, no console errors. Behavior is identical to before.

- [ ] **Step 5: Commit**

  ```bash
  git add code.js
  git commit -m "refactor(code): split code.js into commented sections (no behavior change)"
  ```

---

### Task 2: Mode toggle in `ui.html` shell

**Why:** establish the two-mode UI shell with the Strip screen untouched and an empty Lint screen behind the toggle. Lock in the shared header before adding content.

**Files:**
- Modify: `ui.html`

- [ ] **Step 1: Wrap current Strip UI in `<section id="mode-strip">`**

  In `ui.html`, find the top-level container that holds the current Strip UI (the title, the switches card, the stats, the CTA, progress slot). Wrap that entire block in:

  ```html
  <section id="mode-strip" data-mode="strip">
    <!-- existing strip UI -->
  </section>
  ```

- [ ] **Step 2: Add an empty Lint screen sibling**

  Immediately after `#mode-strip`, add:

  ```html
  <section id="mode-lint" data-mode="lint" hidden>
    <p class="muted">Lint mode — coming up.</p>
  </section>
  ```

- [ ] **Step 3: Add a segmented header toggle above both sections**

  Just above `#mode-strip`, inside the same outer container, add:

  ```html
  <div class="mode-toggle" role="tablist" aria-label="Plugin mode">
    <button id="mode-btn-strip" class="mode-btn active" role="tab" aria-selected="true">Strip</button>
    <button id="mode-btn-lint" class="mode-btn" role="tab" aria-selected="false">Lint</button>
  </div>
  ```

- [ ] **Step 4: Add CSS for the toggle**

  In the existing `<style>` block, append:

  ```css
  .mode-toggle {
    display: inline-flex;
    background: #161616;
    border: 1px solid rgba(255, 232, 0, 0.10);
    border-radius: 999px;
    padding: 2px;
    margin: 0 0 12px;
    gap: 2px;
  }
  .mode-btn {
    font: 600 12px/1 'Inter', sans-serif;
    color: #9e9e9e;
    background: transparent;
    border: 0;
    padding: 6px 12px;
    border-radius: 999px;
    cursor: pointer;
  }
  .mode-btn.active {
    background: #ffe800;
    color: #0e0d0b;
  }
  [hidden] { display: none !important; }
  ```

- [ ] **Step 5: Wire toggle behavior in the existing `<script>` block**

  Inside the existing script, after `dom = {}` cache initialization, add:

  ```js
  dom.modeBtnStrip = document.getElementById('mode-btn-strip');
  dom.modeBtnLint  = document.getElementById('mode-btn-lint');
  dom.screenStrip  = document.getElementById('mode-strip');
  dom.screenLint   = document.getElementById('mode-lint');

  function setMode(mode) {
    var isStrip = mode === 'strip';
    dom.screenStrip.hidden = !isStrip;
    dom.screenLint.hidden  = isStrip;
    dom.modeBtnStrip.classList.toggle('active', isStrip);
    dom.modeBtnLint.classList.toggle('active', !isStrip);
    dom.modeBtnStrip.setAttribute('aria-selected', String(isStrip));
    dom.modeBtnLint.setAttribute('aria-selected', String(!isStrip));
  }

  dom.modeBtnStrip.addEventListener('click', function () { setMode('strip'); });
  dom.modeBtnLint.addEventListener('click',  function () { setMode('lint');  });
  ```

- [ ] **Step 6: UI script syntax check**

  ```bash
  node -e "const fs=require('fs');const html=fs.readFileSync('ui.html','utf8');const m=html.match(/<script[^>]*>([\s\S]*?)<\/script>/);if(!m){process.exit(1)};new Function(m[1]);console.log('ui script ok')"
  ```
  Expected: `ui script ok`.

- [ ] **Step 7: Manual Figma smoke**

  Open the plugin. Verify: toggle visible in header; Strip screen unchanged; clicking `Lint` swaps to the placeholder screen; clicking `Strip` swaps back; Strip flow still works end-to-end.

- [ ] **Step 8: Commit**

  ```bash
  git add ui.html
  git commit -m "feat(ui): add Strip | Lint mode toggle and empty Lint screen"
  ```

---

### Task 3: Origin classifier in `code.js`

**Why:** the lint walker needs a way to ask, "for this style id (or variable id), what is the source library?" Encapsulating this in one section keeps the heuristic and the API fallbacks isolated.

**Files:**
- Modify: `code.js` (`// === origin ===` section)

- [ ] **Step 1: Add subscribed-libraries cache helper**

  Under `// === origin ===`, add:

  ```js
  var __subscribedLibsCache = null;

  async function getSubscribedVariableLibs() {
    if (__subscribedLibsCache) return __subscribedLibsCache;
    try {
      var cols = await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
      __subscribedLibsCache = cols || [];
    } catch (e) {
      console.error('getAvailableLibraryVariableCollectionsAsync failed:', e);
      __subscribedLibsCache = [];
    }
    return __subscribedLibsCache;
  }

  function resetSubscribedLibsCache() { __subscribedLibsCache = null; }
  ```

- [ ] **Step 2: Add `classifyStyleOrigin(styleId)`**

  Add:

  ```js
  // Returns { libKey, libName, isLocal, isSubscribed } or null if the style is gone.
  async function classifyStyleOrigin(styleId) {
    if (!styleId || styleId === figma.mixed) return null;
    var style;
    try { style = await figma.getStyleByIdAsync(styleId); } catch (e) { return null; }
    if (!style) return null;
    if (!style.remote) {
      return { libKey: 'local', libName: 'Local', isLocal: true, isSubscribed: true };
    }
    var name = style.name || '';
    var prefix = name.indexOf('/') >= 0 ? name.split('/')[0].trim() : '';
    var subscribed = await getSubscribedVariableLibs();
    var match = prefix ? subscribed.find(function (c) { return c.libraryName === prefix; }) : null;
    if (match) {
      return { libKey: 'lib:' + prefix, libName: prefix, isLocal: false, isSubscribed: true };
    }
    if (prefix) {
      return { libKey: 'lib:' + prefix, libName: prefix, isLocal: false, isSubscribed: false };
    }
    var keyTail = (style.key || '').slice(0, 6);
    return {
      libKey: 'unknown:' + keyTail,
      libName: 'Unknown library (key: ' + keyTail + ')',
      isLocal: false,
      isSubscribed: false,
    };
  }
  ```

- [ ] **Step 3: Add `classifyVariableOrigin(variableId)`**

  Add:

  ```js
  async function classifyVariableOrigin(variableId) {
    if (!variableId) return null;
    var v;
    try { v = await figma.variables.getVariableByIdAsync(variableId); } catch (e) { return null; }
    if (!v) return null;
    var col;
    try { col = await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId); } catch (e) { col = null; }
    if (!col) return null;
    if (!col.remote) {
      return { libKey: 'local', libName: 'Local', isLocal: true, isSubscribed: true };
    }
    var subscribed = await getSubscribedVariableLibs();
    var match = subscribed.find(function (c) { return c.key === col.key; });
    if (match && match.libraryName) {
      return {
        libKey: 'lib:' + match.libraryName,
        libName: match.libraryName,
        isLocal: false,
        isSubscribed: true,
      };
    }
    var fallback = col.name || ('Unknown library (key: ' + (col.key || '').slice(0, 6) + ')');
    return {
      libKey: 'lib:' + fallback,
      libName: fallback,
      isLocal: false,
      isSubscribed: false,
    };
  }
  ```

- [ ] **Step 4: Syntax check**

  Run: `node -c code.js`
  Expected: no output.

- [ ] **Step 5: Commit**

  ```bash
  git add code.js
  git commit -m "feat(lint): add origin classifier for styles and variables"
  ```

---

### Task 4: Lint walker — build the `byLibrary` index

**Why:** before any UI, the sandbox needs a function that, given a root node array, returns the full index defined in the spec.

**Files:**
- Modify: `code.js` (`// === lint ===` section)

- [ ] **Step 1: Add the index builder**

  Under `// === lint ===`, add:

  ```js
  // Iterates nodes, classifies every style and variable found, returns an index.
  // Does NOT filter by allowed yet — the caller applies the allow-list separately.
  async function buildLintIndex(roots, onProgress) {
    var libs = {}; // libKey -> { name, isLocal, isSubscribed, styles: {}, variables: {} }

    function getLib(origin) {
      if (!libs[origin.libKey]) {
        libs[origin.libKey] = {
          name: origin.libName,
          isLocal: origin.isLocal,
          isSubscribed: origin.isSubscribed,
          styles: {},
          variables: {},
        };
      }
      return libs[origin.libKey];
    }

    function recordStyle(origin, styleId, styleType, nodeId) {
      var lib = getLib(origin);
      if (!lib.styles[styleId]) {
        lib.styles[styleId] = { id: styleId, name: '', type: styleType, layerIds: {} };
      }
      lib.styles[styleId].layerIds[nodeId] = true;
    }

    function recordVariable(origin, varId, nodeId) {
      var lib = getLib(origin);
      if (!lib.variables[varId]) {
        lib.variables[varId] = { id: varId, name: '', collection: '', layerIds: {} };
      }
      lib.variables[varId].layerIds[nodeId] = true;
    }

    var queue = roots.slice();
    var visited = 0;
    var total = roots.length; // dynamic; updated as we descend

    while (queue.length) {
      var node = queue.shift();
      visited++;
      if (visited % 200 === 0 && onProgress) {
        onProgress({ visited: visited, total: total });
      }

      // Styles
      var styleFields = [
        ['fillStyleId', 'fill'],
        ['strokeStyleId', 'stroke'],
        ['effectStyleId', 'effect'],
        ['gridStyleId', 'grid'],
        ['textStyleId', 'text'],
        ['backgroundStyleId', 'fill'],
      ];
      for (var i = 0; i < styleFields.length; i++) {
        var field = styleFields[i][0];
        var kind = styleFields[i][1];
        var sid = null;
        try { sid = node[field]; } catch (e) {}
        if (!sid || sid === figma.mixed) continue;
        var origin = await classifyStyleOrigin(sid);
        if (origin) recordStyle(origin, sid, kind, node.id);
      }

      // Variables: boundVariables flat + nested in paints/strokes
      var bound = node.boundVariables || {};
      var keys = Object.keys(bound);
      for (var k = 0; k < keys.length; k++) {
        var b = bound[keys[k]];
        if (!b) continue;
        var ids = Array.isArray(b) ? b.map(function (x) { return x && x.id; }) : [b.id];
        for (var j = 0; j < ids.length; j++) {
          if (!ids[j]) continue;
          var vo = await classifyVariableOrigin(ids[j]);
          if (vo) recordVariable(vo, ids[j], node.id);
        }
      }

      // Gradient stops (paints in fills/strokes carry variable bindings inside stops)
      var paintFields = ['fills', 'strokes'];
      for (var p = 0; p < paintFields.length; p++) {
        var paints = null;
        try { paints = node[paintFields[p]]; } catch (e) {}
        if (!paints || paints === figma.mixed || !paints.length) continue;
        for (var q = 0; q < paints.length; q++) {
          var paint = paints[q];
          if (!paint || !paint.gradientStops) continue;
          for (var r = 0; r < paint.gradientStops.length; r++) {
            var stop = paint.gradientStops[r];
            var bv = stop && stop.boundVariables;
            if (!bv) continue;
            var sk = Object.keys(bv);
            for (var s = 0; s < sk.length; s++) {
              var sid2 = bv[sk[s]] && bv[sk[s]].id;
              if (!sid2) continue;
              var so = await classifyVariableOrigin(sid2);
              if (so) recordVariable(so, sid2, node.id);
            }
          }
        }
      }

      if ('children' in node && node.children) {
        for (var c = 0; c < node.children.length; c++) {
          queue.push(node.children[c]);
          total++;
        }
      }
    }

    // Hydrate names now (one pass, dedup'd via the map structure)
    var libKeys = Object.keys(libs);
    for (var lk = 0; lk < libKeys.length; lk++) {
      var lib = libs[libKeys[lk]];
      var sids = Object.keys(lib.styles);
      for (var si = 0; si < sids.length; si++) {
        try {
          var s = await figma.getStyleByIdAsync(sids[si]);
          if (s) lib.styles[sids[si]].name = s.name;
        } catch (e) {}
      }
      var vids = Object.keys(lib.variables);
      for (var vi = 0; vi < vids.length; vi++) {
        try {
          var vv = await figma.variables.getVariableByIdAsync(vids[vi]);
          if (vv) {
            lib.variables[vids[vi]].name = vv.name;
            try {
              var c2 = await figma.variables.getVariableCollectionByIdAsync(vv.variableCollectionId);
              lib.variables[vids[vi]].collection = c2 ? c2.name : '';
            } catch (e) {}
          }
        } catch (e) {}
      }
    }

    return libs;
  }
  ```

- [ ] **Step 2: Add a serializer to convert the index for `postMessage`**

  Maps and Sets do not serialize; we used plain objects above so `layerIds` is `{id: true}`. Add a helper that turns it into the wire format expected by the UI:

  ```js
  function serializeLintIndex(libs, allowedKeys) {
    var byLibrary = [];
    var summary = { intruderLibraries: 0, affectedLayers: 0, intruderStyles: 0, intruderVariables: 0 };
    var seenLayer = {};
    var libKeys = Object.keys(libs);
    for (var i = 0; i < libKeys.length; i++) {
      var k = libKeys[i];
      var lib = libs[k];
      var allowed = allowedKeys[k] === true || lib.isLocal === true;
      var styles = Object.keys(lib.styles).map(function (sid) {
        var s = lib.styles[sid];
        var lids = Object.keys(s.layerIds);
        return { id: sid, name: s.name, type: s.type, layerIds: lids };
      });
      var variables = Object.keys(lib.variables).map(function (vid) {
        var v = lib.variables[vid];
        var lids = Object.keys(v.layerIds);
        return { id: vid, name: v.name, collection: v.collection, layerIds: lids };
      });
      byLibrary.push({
        libKey: k,
        name: lib.name,
        isLocal: lib.isLocal,
        isSubscribed: lib.isSubscribed,
        allowed: allowed,
        styles: styles,
        variables: variables,
      });
      if (!allowed) {
        summary.intruderLibraries++;
        summary.intruderStyles += styles.length;
        summary.intruderVariables += variables.length;
        for (var s2 = 0; s2 < styles.length; s2++) {
          for (var l2 = 0; l2 < styles[s2].layerIds.length; l2++) seenLayer[styles[s2].layerIds[l2]] = true;
        }
        for (var v2 = 0; v2 < variables.length; v2++) {
          for (var l3 = 0; l3 < variables[v2].layerIds.length; l3++) seenLayer[variables[v2].layerIds[l3]] = true;
        }
      }
    }
    summary.affectedLayers = Object.keys(seenLayer).length;
    return { byLibrary: byLibrary, summary: summary };
  }
  ```

- [ ] **Step 3: Syntax check**

  Run: `node -c code.js`
  Expected: no output.

- [ ] **Step 4: Commit**

  ```bash
  git add code.js
  git commit -m "feat(lint): walker that builds a byLibrary index and serializer for UI"
  ```

---

### Task 5: `lint-scan` orchestrator + scope picker UI

**Why:** wire the walker behind a message so the UI can request a scan. UI also needs the scope picker before this is useful.

**Files:**
- Modify: `code.js` (`lint` and `router` sections)
- Modify: `ui.html`

- [ ] **Step 1: In `code.js`, add scope resolver and orchestrator**

  Under `// === lint ===`, add:

  ```js
  async function resolveLintRoots(scope) {
    if (scope === 'selection') {
      var sel = figma.currentPage.selection;
      return sel && sel.length ? sel.slice() : [];
    }
    if (scope === 'page') {
      return figma.currentPage.children.slice();
    }
    if (scope === 'file') {
      await figma.loadAllPagesAsync();
      var pages = figma.root.children;
      var roots = [];
      for (var i = 0; i < pages.length; i++) {
        for (var j = 0; j < pages[i].children.length; j++) {
          roots.push(pages[i].children[j]);
        }
      }
      return roots;
    }
    return [];
  }

  // Cached index from the latest scan, so whitelist toggles re-filter without re-walking.
  var __lintLastIndex = null;
  var __lintLastScope = null;

  async function runLintScan(scope) {
    resetSubscribedLibsCache();
    figma.ui.postMessage({ type: 'lint-progress', message: 'Preparing scope...', percent: 0 });
    var roots = await resolveLintRoots(scope);
    if (!roots.length && scope === 'selection') {
      figma.ui.postMessage({ type: 'lint-error', message: 'Select layers first.' });
      return;
    }
    figma.ui.postMessage({ type: 'lint-progress', message: 'Scanning...', percent: 10 });
    var libs = await buildLintIndex(roots, function (p) {
      var pct = 10 + Math.min(80, Math.floor((p.visited / Math.max(1, p.total)) * 80));
      figma.ui.postMessage({ type: 'lint-progress', message: 'Scanning... ' + pct + '%', percent: pct });
    });
    __lintLastIndex = libs;
    __lintLastScope = scope;
    var allowedKeys = await loadLintAllowed();
    var payload = serializeLintIndex(libs, allowedKeys);
    figma.ui.postMessage({ type: 'lint-result', index: payload, scope: scope });
  }
  ```

- [ ] **Step 2: Add allow-list storage helpers (used in this task; refined in Task 10)**

  ```js
  async function loadLintAllowed() {
    try {
      var raw = figma.root.getPluginData('lintAllowedLibs');
      if (!raw) return { local: true };
      var arr = JSON.parse(raw);
      var map = { local: true };
      for (var i = 0; i < arr.length; i++) map[arr[i]] = true;
      return map;
    } catch (e) {
      return { local: true };
    }
  }

  async function saveLintAllowed(allowedMap) {
    var keys = Object.keys(allowedMap).filter(function (k) { return allowedMap[k] === true; });
    figma.root.setPluginData('lintAllowedLibs', JSON.stringify(keys));
  }
  ```

  Also, default-allow every subscribed variable library on first scan: in `runLintScan`, after `await loadLintAllowed()`, do:

  ```js
  var subs = await getSubscribedVariableLibs();
  for (var si = 0; si < subs.length; si++) {
    var k = 'lib:' + subs[si].libraryName;
    if (allowedKeys[k] !== false) allowedKeys[k] = true;
  }
  ```

- [ ] **Step 3: Route `lint-scan` in the router section**

  Inside the existing `figma.ui.onmessage` handler, add a branch:

  ```js
  if (msg.type === 'lint-scan') {
    runLintScan(msg.scope).catch(function (e) {
      figma.ui.postMessage({ type: 'lint-error', message: String(e && e.message || e) });
    });
    return;
  }
  ```

- [ ] **Step 4: In `ui.html`, fill `#mode-lint` pre-scan UI**

  Replace the placeholder paragraph with:

  ```html
  <section id="mode-lint" data-mode="lint" hidden>
    <div class="card">
      <div class="card-title">Scope</div>
      <div class="segmented" role="radiogroup" aria-label="Scope">
        <button class="seg-btn active" data-scope="selection" role="radio" aria-checked="true">Selection</button>
        <button class="seg-btn" data-scope="page" role="radio" aria-checked="false">Page</button>
        <button class="seg-btn" data-scope="file" role="radio" aria-checked="false">File</button>
      </div>
      <p class="muted small">Default: local file + subscribed libraries. Refine after scanning.</p>
    </div>

    <div class="progress-slot" id="lint-progress-slot">
      <div class="progress-bar"><div id="lint-progress-fill" class="progress-fill"></div></div>
      <div class="progress-label" id="lint-progress-label"></div>
    </div>

    <button id="lint-scan-btn" class="cta">Scan for intruders</button>

    <div id="lint-results" hidden></div>
    <div id="lint-error" class="error" hidden></div>
  </section>
  ```

- [ ] **Step 5: CSS for new lint elements**

  Append to the `<style>` block:

  ```css
  .segmented { display: inline-flex; gap: 2px; background: #111; border-radius: 999px; padding: 2px; }
  .seg-btn { font: 600 12px/1 'Inter'; color: #9e9e9e; background: transparent; border: 0; padding: 6px 12px; border-radius: 999px; cursor: pointer; }
  .seg-btn.active { background: #ffe800; color: #0e0d0b; }
  .progress-slot { opacity: 0; transition: opacity 120ms; margin: 12px 0; }
  .progress-slot.visible { opacity: 1; }
  .progress-bar { height: 4px; background: #222; border-radius: 2px; overflow: hidden; }
  .progress-fill { height: 100%; background: #ffe800; width: 0; transition: width 80ms linear; }
  .progress-label { font: 400 12px/1.4 'Inter'; color: #9e9e9e; margin-top: 6px; }
  .error { color: #ff6b6b; font: 400 12px/1.4 'Inter'; margin: 8px 0; }
  .small { font-size: 12px; }
  ```

- [ ] **Step 6: Wire UI handlers**

  In the existing `<script>` block, after the mode-toggle wiring, add:

  ```js
  dom.lintScope = 'selection';
  dom.lintScanBtn = document.getElementById('lint-scan-btn');
  dom.lintProgSlot = document.getElementById('lint-progress-slot');
  dom.lintProgFill = document.getElementById('lint-progress-fill');
  dom.lintProgLabel = document.getElementById('lint-progress-label');
  dom.lintResults = document.getElementById('lint-results');
  dom.lintError = document.getElementById('lint-error');

  Array.prototype.forEach.call(document.querySelectorAll('#mode-lint .seg-btn'), function (btn) {
    btn.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('#mode-lint .seg-btn'), function (b) {
        b.classList.remove('active');
        b.setAttribute('aria-checked', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-checked', 'true');
      dom.lintScope = btn.getAttribute('data-scope');
    });
  });

  dom.lintScanBtn.addEventListener('click', function () {
    dom.lintError.hidden = true;
    dom.lintResults.hidden = true;
    dom.lintProgSlot.classList.add('visible');
    dom.lintProgFill.style.width = '0%';
    dom.lintProgLabel.textContent = 'Scanning...';
    parent.postMessage({ pluginMessage: { type: 'lint-scan', scope: dom.lintScope } }, '*');
  });

  // Extend the existing window.onmessage handler with lint branches. Find the
  // existing function that handles `event.data.pluginMessage` and add:
  //
  //   if (msg.type === 'lint-progress') { ... }
  //   if (msg.type === 'lint-result')   { ... }
  //   if (msg.type === 'lint-error')    { ... }
  ```

  Concretely, inside the existing message handler, add these branches:

  ```js
  if (msg.type === 'lint-progress') {
    dom.lintProgSlot.classList.add('visible');
    dom.lintProgFill.style.width = (msg.percent || 0) + '%';
    dom.lintProgLabel.textContent = msg.message || '';
    return;
  }
  if (msg.type === 'lint-error') {
    dom.lintProgSlot.classList.remove('visible');
    dom.lintError.textContent = msg.message || 'Unknown error.';
    dom.lintError.hidden = false;
    return;
  }
  if (msg.type === 'lint-result') {
    dom.lintProgSlot.classList.remove('visible');
    dom.lintResults.hidden = false;
    // Rendering implemented in Task 6.
    dom.lintResults.textContent = 'Scan complete: ' + msg.index.summary.intruderLibraries + ' intruder library(ies).';
    window.__lintLastIndex = msg.index;
    return;
  }
  ```

- [ ] **Step 7: Smoke checks**

  ```bash
  node -c code.js
  ```

  Then UI script eval (same one-liner as the header).
  Expected: both pass.

- [ ] **Step 8: Manual Figma smoke**

  In Figma: switch to Lint mode. Pick Selection. Select 1 layer with a known remote style. Click `Scan for intruders`. Confirm: progress bar appears, then disappears; results area shows e.g. `Scan complete: 1 intruder library(ies).`. No console errors.

  Also try with empty selection — should show `Select layers first.` in the error area.

- [ ] **Step 9: Commit**

  ```bash
  git add code.js ui.html
  git commit -m "feat(lint): scope picker, lint-scan orchestrator, raw result wired to UI"
  ```

---

### Task 6: Render the grouped results UI

**Why:** the user needs to see what was found before any action makes sense.

**Files:**
- Modify: `ui.html`

- [ ] **Step 1: Replace the placeholder result rendering with a real renderer**

  In the `<script>` block, add a `renderLintResults(index)` function and call it from the existing `lint-result` branch:

  ```js
  function renderLintResults(index) {
    var root = dom.lintResults;
    root.innerHTML = '';

    // Summary
    var summary = document.createElement('div');
    summary.className = 'card';
    summary.innerHTML =
      '<div class="card-title">Found ' + index.summary.intruderLibraries + ' intruder ' +
      (index.summary.intruderLibraries === 1 ? 'library' : 'libraries') + '</div>' +
      '<div class="muted small">' + index.summary.affectedLayers + ' layers affected · ' +
      index.summary.intruderStyles + ' styles, ' + index.summary.intruderVariables + ' variables</div>';
    root.appendChild(summary);

    if (!index.byLibrary.length || index.summary.intruderLibraries === 0) {
      var empty = document.createElement('div');
      empty.className = 'card empty';
      empty.textContent = 'No intruders found in this scope.';
      root.appendChild(empty);
      return;
    }

    // One section per non-allowed library
    for (var i = 0; i < index.byLibrary.length; i++) {
      var lib = index.byLibrary[i];
      if (lib.allowed) continue;
      root.appendChild(renderLibrarySection(lib));
    }
  }

  function renderLibrarySection(lib) {
    var section = document.createElement('details');
    section.className = 'lib-section';
    section.open = true;
    section.dataset.libKey = lib.libKey;

    var summary = document.createElement('summary');
    summary.className = 'lib-header';
    summary.textContent = lib.name;
    section.appendChild(summary);

    var body = document.createElement('div');
    body.className = 'lib-body';

    // Allowed toggle + per-library actions (per-library detach implemented in Task 9)
    var controls = document.createElement('div');
    controls.className = 'lib-controls';
    controls.innerHTML =
      '<label class="lib-allow"><input type="checkbox" data-action="allow"> Mark as allowed</label>';
    body.appendChild(controls);

    if (lib.styles.length) {
      var sh = document.createElement('div');
      sh.className = 'group-title';
      sh.textContent = 'Styles (' + lib.styles.length + ')';
      body.appendChild(sh);
      for (var i = 0; i < lib.styles.length; i++) {
        body.appendChild(renderItemRow('style', lib.styles[i]));
      }
    }
    if (lib.variables.length) {
      var vh = document.createElement('div');
      vh.className = 'group-title';
      vh.textContent = 'Variables (' + lib.variables.length + ')';
      body.appendChild(vh);
      for (var j = 0; j < lib.variables.length; j++) {
        body.appendChild(renderItemRow('variable', lib.variables[j]));
      }
    }

    section.appendChild(body);
    return section;
  }

  function renderItemRow(kind, item) {
    var row = document.createElement('div');
    row.className = 'item-row';
    row.dataset.kind = kind;
    row.dataset.id = item.id;
    row.innerHTML =
      '<div class="item-name">' + escapeHtml(item.name || '(unnamed)') + '</div>' +
      '<div class="item-meta">' + item.layerIds.length + ' layers</div>' +
      '<div class="item-actions">' +
        '<button class="ghost-btn" data-action="select">select</button>' +
        '<button class="ghost-btn" data-action="detach">detach</button>' +
      '</div>';
    return row;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  ```

  Replace the placeholder line in the `lint-result` handler with `renderLintResults(msg.index);` and keep `window.__lintLastIndex = msg.index;` for later tasks.

- [ ] **Step 2: CSS for sections, rows, buttons**

  Append to `<style>`:

  ```css
  .lib-section { background: #161616; border: 1px solid rgba(255,232,0,0.10); border-radius: 8px; padding: 12px; margin: 8px 0; }
  .lib-header { font: 600 14px/1.2 'Inter'; color: #fff; cursor: pointer; list-style: none; }
  .lib-header::-webkit-details-marker { display: none; }
  .lib-body { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
  .lib-controls { display: flex; justify-content: space-between; align-items: center; }
  .lib-allow { color: #9e9e9e; font: 400 12px/1 'Inter'; display: inline-flex; gap: 6px; align-items: center; }
  .group-title { color: #9e9e9e; font: 600 12px/1 'Inter'; margin-top: 4px; }
  .item-row { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 8px; padding: 6px 0; }
  .item-name { color: #fff; font: 400 13px/1.2 'Inter'; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .item-meta { color: #9e9e9e; font: 400 12px/1 'Inter'; }
  .item-actions { display: inline-flex; gap: 4px; }
  .ghost-btn { font: 600 11px/1 'Inter'; color: #ffe800; background: transparent; border: 1px solid rgba(255,232,0,0.30); padding: 4px 8px; border-radius: 6px; cursor: pointer; }
  .ghost-btn:hover { background: rgba(255,232,0,0.06); }
  .card.empty { color: #9e9e9e; }
  ```

- [ ] **Step 3: UI script syntax check**

  Run the UI eval one-liner from the header.
  Expected: `ui script ok`.

- [ ] **Step 4: Manual Figma smoke**

  Scan a selection with a known mix. Confirm: summary card shows accurate counts; each non-allowed library renders its section expanded by default; styles and variables grouped; counts match a hand check on at least one item. Buttons exist but are inert.

- [ ] **Step 5: Commit**

  ```bash
  git add ui.html
  git commit -m "feat(lint): render grouped results with summary, library sections, and item rows"
  ```

---

### Task 7: `select` action

**Why:** the visual-confirmation step. Smallest interactive step — verifies the message round-trip before we add destructive actions.

**Files:**
- Modify: `code.js` (router + lint section)
- Modify: `ui.html` (event delegation)

- [ ] **Step 1: Sandbox handler in `code.js`**

  Under `// === lint ===`, add:

  ```js
  async function lintSelectLayers(layerIds) {
    if (!layerIds || !layerIds.length) return;
    var nodes = [];
    for (var i = 0; i < layerIds.length; i++) {
      try {
        var n = await figma.getNodeByIdAsync(layerIds[i]);
        if (n && n.type !== 'PAGE' && n.type !== 'DOCUMENT') nodes.push(n);
      } catch (e) {}
    }
    if (!nodes.length) return;
    // Switch to the page that contains the first node, if needed.
    var first = nodes[0];
    var page = first;
    while (page && page.type !== 'PAGE') page = page.parent;
    if (page && page !== figma.currentPage) {
      await figma.setCurrentPageAsync(page);
    }
    // Filter to nodes that live on the current page.
    var onPage = nodes.filter(function (n) {
      var p = n; while (p && p.type !== 'PAGE') p = p.parent; return p === figma.currentPage;
    });
    figma.currentPage.selection = onPage;
    figma.viewport.scrollAndZoomIntoView(onPage);
  }
  ```

  Route it:

  ```js
  if (msg.type === 'lint-select-layers') {
    lintSelectLayers(msg.layerIds).catch(function (e) {
      figma.ui.postMessage({ type: 'lint-error', message: String(e && e.message || e) });
    });
    return;
  }
  ```

- [ ] **Step 2: Event delegation in `ui.html`**

  In the `<script>` block, after `renderLintResults` is defined, add a single delegated listener bound once:

  ```js
  dom.lintResults.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-action]');
    if (!btn) return;
    var row = btn.closest('.item-row');
    var section = btn.closest('.lib-section');
    var action = btn.getAttribute('data-action');

    if (action === 'select' && row) {
      var item = findItemFromRow(row);
      if (item) parent.postMessage({ pluginMessage: { type: 'lint-select-layers', layerIds: item.layerIds } }, '*');
      return;
    }
    // detach, allow toggle, etc. wired in later tasks
  });

  function findItemFromRow(row) {
    var index = window.__lintLastIndex;
    if (!index) return null;
    var libKey = row.closest('.lib-section').dataset.libKey;
    var kind = row.dataset.kind;
    var id = row.dataset.id;
    var lib = index.byLibrary.find(function (l) { return l.libKey === libKey; });
    if (!lib) return null;
    var arr = kind === 'style' ? lib.styles : lib.variables;
    return arr.find(function (x) { return x.id === id; });
  }
  ```

- [ ] **Step 3: Smoke checks**

  `node -c code.js` and the UI eval one-liner. Both expected to pass.

- [ ] **Step 4: Manual Figma smoke**

  Scan, click `select` on an item with multiple layers across a frame. Confirm: those layers become selected; viewport scrolls and zooms; no console errors. Test with a node on another page (selecting on a page result) — page should switch.

- [ ] **Step 5: Commit**

  ```bash
  git add code.js ui.html
  git commit -m "feat(lint): select layers action for individual items"
  ```

---

### Task 8: Per-item `detach`

**Why:** the smallest destructive action. Once this works, per-library and detach-all are loops over the same primitive.

**Files:**
- Modify: `code.js` (detach helpers, lint, router)
- Modify: `ui.html` (delegated handler)

- [ ] **Step 1: Add `detachItemFromLayer` helper**

  Under `// === detach helpers ===`, add:

  ```js
  // Removes a single style binding from a node by checking each style field.
  async function removeStyleFromNode(node, styleId) {
    try { if (node.fillStyleId === styleId) await node.setFillStyleIdAsync(''); } catch (e) {}
    try { if (node.backgroundStyleId === styleId) await node.setFillStyleIdAsync(''); } catch (e) {}
    try { if (node.strokeStyleId === styleId) await node.setStrokeStyleIdAsync(''); } catch (e) {}
    try { if (node.effectStyleId === styleId) await node.setEffectStyleIdAsync(''); } catch (e) {}
    try { if (node.gridStyleId === styleId) await node.setGridStyleIdAsync(''); } catch (e) {}
    try { if (node.type === 'TEXT' && node.textStyleId === styleId) await node.setTextStyleIdAsync(''); } catch (e) {}
  }

  // Removes a single variable binding from a node, walking flat boundVariables and gradient stops.
  async function removeVariableFromNode(node, variableId) {
    var bound = node.boundVariables || {};
    var keys = Object.keys(bound);
    for (var i = 0; i < keys.length; i++) {
      var b = bound[keys[i]];
      if (!b) continue;
      var ids = Array.isArray(b) ? b.map(function (x) { return x && x.id; }) : [b.id];
      for (var j = 0; j < ids.length; j++) {
        if (ids[j] === variableId) {
          try { node.setBoundVariable(keys[i], null); } catch (e) {}
        }
      }
    }
    // Gradient stops in fills/strokes
    var paintFields = ['fills', 'strokes'];
    for (var p = 0; p < paintFields.length; p++) {
      var paints = null;
      try { paints = node[paintFields[p]]; } catch (e) {}
      if (!paints || paints === figma.mixed || !paints.length) continue;
      var nextPaints = JSON.parse(JSON.stringify(paints));
      var mutated = false;
      for (var q = 0; q < nextPaints.length; q++) {
        var stops = nextPaints[q].gradientStops;
        if (!stops) continue;
        for (var r = 0; r < stops.length; r++) {
          var bv = stops[r].boundVariables;
          if (!bv) continue;
          var sk = Object.keys(bv);
          for (var s = 0; s < sk.length; s++) {
            if (bv[sk[s]] && bv[sk[s]].id === variableId) {
              delete bv[sk[s]];
              mutated = true;
            }
          }
        }
      }
      if (mutated) {
        try { node[paintFields[p]] = nextPaints; } catch (e) {}
      }
    }
  }
  ```

- [ ] **Step 2: Add `runLintDetach(items)` in lint section**

  ```js
  async function runLintDetach(items) {
    var skipped = 0;
    var total = 0;
    for (var i = 0; i < items.length; i++) total += items[i].layerIds.length;
    var done = 0;
    for (var i2 = 0; i2 < items.length; i2++) {
      var it = items[i2];
      for (var j = 0; j < it.layerIds.length; j++) {
        var node = null;
        try { node = await figma.getNodeByIdAsync(it.layerIds[j]); } catch (e) {}
        if (!node) { skipped++; done++; continue; }
        if (it.kind === 'style') {
          await removeStyleFromNode(node, it.id);
        } else if (it.kind === 'variable') {
          await removeVariableFromNode(node, it.id);
        }
        done++;
        if (done % 25 === 0) {
          var pct = Math.floor((done / Math.max(1, total)) * 100);
          figma.ui.postMessage({ type: 'lint-progress', message: 'Detaching... ' + pct + '%', percent: pct });
        }
      }
    }
    figma.ui.postMessage({ type: 'lint-detach-done', skipped: skipped });
    // Re-scan so the UI reflects the new state.
    if (__lintLastScope) await runLintScan(__lintLastScope);
  }
  ```

- [ ] **Step 3: Route `lint-detach`**

  ```js
  if (msg.type === 'lint-detach') {
    runLintDetach(msg.items).catch(function (e) {
      figma.ui.postMessage({ type: 'lint-error', message: String(e && e.message || e) });
    });
    return;
  }
  ```

- [ ] **Step 4: Wire per-item detach in UI**

  Extend the delegated listener inside `dom.lintResults.addEventListener('click', ...)`:

  ```js
  if (action === 'detach' && row) {
    var item = findItemFromRow(row);
    if (!item) return;
    parent.postMessage({ pluginMessage: { type: 'lint-detach', items: [{
      kind: row.dataset.kind, id: item.id, layerIds: item.layerIds,
    }] } }, '*');
    return;
  }
  ```

  And add a `lint-detach-done` handler in the existing message handler:

  ```js
  if (msg.type === 'lint-detach-done') {
    // Result re-render will arrive via the follow-up `lint-result`. Nothing else to do here for now.
    return;
  }
  ```

- [ ] **Step 5: Smoke checks**

  `node -c code.js` + UI eval. Both expected to pass.

- [ ] **Step 6: Manual Figma smoke**

  Pick a selection with one styled layer using an intruder style. Scan, click `detach` on that item. Confirm: progress bar runs, then the section disappears (the item is gone, library may stay if other items remain). Layer no longer has that style applied (visible in the right sidebar).

  Repeat with a variable binding. Repeat with a layer that uses a variable inside a gradient stop.

- [ ] **Step 7: Commit**

  ```bash
  git add code.js ui.html
  git commit -m "feat(lint): per-item detach for styles and variables (incl. gradient stops)"
  ```

---

### Task 9: Detach-by-library and detach-all

**Why:** bulk actions on top of the per-item primitive.

**Files:**
- Modify: `ui.html`

- [ ] **Step 1: Add library-level controls in `renderLibrarySection`**

  Replace the `controls.innerHTML` in `renderLibrarySection` with:

  ```js
  controls.innerHTML =
    '<label class="lib-allow"><input type="checkbox" data-action="allow"> Mark as allowed</label>' +
    '<button class="ghost-btn" data-action="detach-library">Detach all from this library</button>';
  ```

- [ ] **Step 2: Add a global "Detach all intruders" CTA below the results**

  In `renderLintResults`, after the per-library loop, append:

  ```js
  if (index.summary.intruderLibraries > 0) {
    var bulk = document.createElement('button');
    bulk.id = 'lint-detach-all-btn';
    bulk.className = 'cta';
    bulk.textContent = 'Detach all intruders';
    root.appendChild(bulk);

    var rescan = document.createElement('button');
    rescan.className = 'ghost';
    rescan.textContent = 'Re-scan';
    rescan.addEventListener('click', function () { dom.lintScanBtn.click(); });
    root.appendChild(rescan);
  }
  ```

  CSS additions:

  ```css
  .ghost { font: 600 13px/1 'Inter'; color: #9e9e9e; background: transparent; border: 1px solid rgba(255,255,255,0.10); padding: 8px 12px; border-radius: 8px; margin-top: 6px; cursor: pointer; display: block; width: 100%; }
  ```

- [ ] **Step 3: Wire the new buttons in the delegated listener**

  Extend the listener:

  ```js
  if (action === 'detach-library' && section) {
    var libKey = section.dataset.libKey;
    var lib = (window.__lintLastIndex.byLibrary || []).find(function (l) { return l.libKey === libKey; });
    if (!lib) return;
    var items = lib.styles.map(function (s) { return { kind: 'style', id: s.id, layerIds: s.layerIds }; })
      .concat(lib.variables.map(function (v) { return { kind: 'variable', id: v.id, layerIds: v.layerIds }; }));
    parent.postMessage({ pluginMessage: { type: 'lint-detach', items: items } }, '*');
    return;
  }
  ```

  And outside the delegated listener (since the bulk button lives on `root`, the same delegation catches it — but the id-based handler is simpler):

  ```js
  document.addEventListener('click', function (e) {
    if (e.target && e.target.id === 'lint-detach-all-btn') {
      var idx = window.__lintLastIndex;
      if (!idx) return;
      var items = [];
      for (var i = 0; i < idx.byLibrary.length; i++) {
        var lib = idx.byLibrary[i];
        if (lib.allowed) continue;
        for (var s = 0; s < lib.styles.length; s++) {
          items.push({ kind: 'style', id: lib.styles[s].id, layerIds: lib.styles[s].layerIds });
        }
        for (var v = 0; v < lib.variables.length; v++) {
          items.push({ kind: 'variable', id: lib.variables[v].id, layerIds: lib.variables[v].layerIds });
        }
      }
      if (!items.length) return;
      parent.postMessage({ pluginMessage: { type: 'lint-detach', items: items } }, '*');
    }
  });
  ```

- [ ] **Step 4: Smoke checks**

  `node -c code.js` (no code change but keeps habit) + UI eval. Both expected to pass.

- [ ] **Step 5: Manual Figma smoke**

  Scan a selection with multiple items across 2 intruder libraries. Click `Detach all from this library` on the first one — confirm only items from that library disappear, summary updates. Re-run; click `Detach all intruders` — confirm both sections disappear and summary shows zero.

- [ ] **Step 6: Commit**

  ```bash
  git add ui.html
  git commit -m "feat(lint): detach-by-library and detach-all-intruders bulk actions"
  ```

---

### Task 10: Allow-list toggle + persistence + cached re-classify

**Why:** the user-refinable whitelist is the heart of the spec. Until now we used defaults only.

**Files:**
- Modify: `code.js`
- Modify: `ui.html`

- [ ] **Step 1: Add `lint-update-whitelist` message and re-classify path**

  In `code.js`, add:

  ```js
  async function updateLintWhitelist(libKey, allowed) {
    var current = await loadLintAllowed();
    if (allowed) current[libKey] = true;
    else delete current[libKey];
    await saveLintAllowed(current);
    if (__lintLastIndex) {
      var subs = await getSubscribedVariableLibs();
      for (var si = 0; si < subs.length; si++) {
        var k = 'lib:' + subs[si].libraryName;
        if (current[k] !== false) current[k] = true;
      }
      var payload = serializeLintIndex(__lintLastIndex, current);
      figma.ui.postMessage({ type: 'lint-result', index: payload, scope: __lintLastScope });
    }
  }
  ```

  Route it:

  ```js
  if (msg.type === 'lint-update-whitelist') {
    updateLintWhitelist(msg.libKey, msg.allowed).catch(function (e) {
      figma.ui.postMessage({ type: 'lint-error', message: String(e && e.message || e) });
    });
    return;
  }
  ```

- [ ] **Step 2: Wire the `Mark as allowed` checkbox in UI**

  Extend the delegated listener in `ui.html`:

  ```js
  if (action === 'allow' && section) {
    var libKey = section.dataset.libKey;
    parent.postMessage({ pluginMessage: { type: 'lint-update-whitelist', libKey: libKey, allowed: btn.checked } }, '*');
    return;
  }
  ```

  Note: `btn` here is the checkbox (`<input type="checkbox" data-action="allow">`), which `e.target.closest('button[data-action]')` does not match. Adjust the listener to also recognize inputs:

  ```js
  var btn = e.target.closest('[data-action]');
  if (!btn) return;
  ```

  Use that updated selector. The `action` switch already keys off `getAttribute('data-action')` so it works for both `<button>` and `<input>`.

- [ ] **Step 3: Smoke checks**

  `node -c code.js` + UI eval. Both expected to pass.

- [ ] **Step 4: Manual Figma smoke**

  Scan, check `Mark as allowed` on one of the intruder libraries. Confirm: that section disappears, summary updates. Reload the plugin: scan again. Confirm: the library still does not appear as an intruder (persistence works).

  Reload the file in a new tab to confirm `setPluginData` persisted across sessions.

- [ ] **Step 5: Commit**

  ```bash
  git add code.js ui.html
  git commit -m "feat(lint): per-file allow-list persistence and mark-as-allowed toggle"
  ```

---

### Task 11: File scope: load all pages with warning

**Why:** scope `file` needs `loadAllPagesAsync` before walking, and on big files we should warn first.

**Files:**
- Modify: `code.js`

- [ ] **Step 1: Pre-load progress message**

  In `runLintScan`, before calling `resolveLintRoots`, send a progress event when scope is `file`:

  ```js
  if (scope === 'file') {
    var pageCount = figma.root.children.length;
    if (pageCount > 20) {
      figma.ui.postMessage({ type: 'lint-progress', message: 'Loading ' + pageCount + ' pages... this may take a moment.', percent: 2 });
    } else {
      figma.ui.postMessage({ type: 'lint-progress', message: 'Loading all pages...', percent: 2 });
    }
  }
  ```

- [ ] **Step 2: Verify `loadAllPagesAsync` path**

  `resolveLintRoots('file')` already calls `await figma.loadAllPagesAsync()`. No code change there.

- [ ] **Step 3: Smoke checks**

  `node -c code.js`. Expected: pass.

- [ ] **Step 4: Manual Figma smoke**

  Open a multi-page file. Switch to Lint, pick File scope, scan. Confirm: the loading message appears before scanning starts; final result aggregates items across all pages.

- [ ] **Step 5: Commit**

  ```bash
  git add code.js
  git commit -m "feat(lint): file-scope loads all pages with a progress message"
  ```

---

### Task 12: Empty state + selection-changed chip + skipped notice

**Why:** the spec-defined edges that polish the experience.

**Files:**
- Modify: `code.js`
- Modify: `ui.html`

- [ ] **Step 1: Selection-changed chip**

  In `code.js`, when a `selectionchange` event fires after a scan with scope `selection`, send a message:

  ```js
  figma.on('selectionchange', function () {
    if (__lintLastScope === 'selection') {
      figma.ui.postMessage({ type: 'lint-selection-changed' });
    }
  });
  ```

  In `ui.html`, handle it:

  ```js
  if (msg.type === 'lint-selection-changed') {
    var chip = document.getElementById('lint-sel-changed-chip');
    if (!chip) {
      chip = document.createElement('div');
      chip.id = 'lint-sel-changed-chip';
      chip.className = 'chip';
      chip.textContent = 'Selection changed — re-scan?';
      dom.lintResults.insertBefore(chip, dom.lintResults.firstChild);
      chip.addEventListener('click', function () { dom.lintScanBtn.click(); });
    }
    return;
  }
  ```

  CSS:

  ```css
  .chip { background: rgba(255,232,0,0.12); color: #ffe800; font: 600 12px/1 'Inter'; padding: 6px 10px; border-radius: 999px; display: inline-block; margin-bottom: 8px; cursor: pointer; }
  ```

- [ ] **Step 2: Skipped notice after detach**

  In the existing `lint-detach-done` handler in `ui.html`, replace the empty body with:

  ```js
  if (msg.type === 'lint-detach-done') {
    if (msg.skipped && msg.skipped > 0) {
      var note = document.createElement('div');
      note.className = 'muted small';
      note.textContent = msg.skipped + ' items skipped: no longer present.';
      dom.lintResults.appendChild(note);
    }
    return;
  }
  ```

- [ ] **Step 3: Empty state is already handled in Task 6's renderer** — verify it still triggers when `index.summary.intruderLibraries === 0`.

- [ ] **Step 4: Smoke checks**

  `node -c code.js` + UI eval. Both expected to pass.

- [ ] **Step 5: Manual Figma smoke**

  - After a Selection scan, click a different layer in the canvas. Confirm: yellow chip appears above the results. Click it. Confirm: re-scan runs.
  - Detach an item, then quickly delete one of the source layers in another way before the auto-rescan finishes. Confirm: skipped notice appears.
  - Scan a clean selection with no intruders. Confirm: "No intruders found in this scope." card.

- [ ] **Step 6: Commit**

  ```bash
  git add code.js ui.html
  git commit -m "feat(lint): empty state, selection-changed chip, skipped-items notice"
  ```

---

### Task 13: README + CLAUDE.md updates

**Why:** publish notes and project memory must reflect the new mode.

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: README — add a Lint mode section**

  Append to `README.md` after the existing description:

  ```markdown
  ## Lint mode

  Switch to the **Lint** tab in the header to scan a Selection, the
  current Page, or the whole File for styles and variables whose source
  library is not on this file's allow-list. Findings are grouped by
  source library; for each item you can select the affected layers in
  the canvas or detach it. Libraries can also be detached in one click,
  or you can detach every intruder at once.

  The allow-list is per file. By default it includes the file's local
  styles and every subscribed library; you can mark or unmark any
  detected library to refine it.

  Identification of the source library for remote styles is best-effort
  (it uses the style's name prefix as a fallback). Variables are
  identified reliably.
  ```

- [ ] **Step 2: CLAUDE.md — add Lint mode notes**

  In `CLAUDE.md`, under `## Architecture decisions`, add:

  ```markdown
  - **Lint mode**: second top-level mode toggled in the header. Shares
    walker, detach helpers, and design system with Strip. Builds a
    `byLibrary` index of every style and variable in the chosen scope
    (Selection / Page / File), classifies origin by the existing
    subscribed-library API for variables and a name-prefix heuristic for
    styles (with `Unknown library (key: …)` fallback). Allow-list is
    per file via `figma.root.setPluginData('lintAllowedLibs', …)`.
  - **Re-classify cache**: scan keeps the full index in memory; toggling
    `Mark as allowed` only re-applies the allow-list filter on the
    cached index — no re-walk.
  ```

  Under `## Message protocol`, append:

  ```markdown
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
  ```

  Under `## Plugin API constraints learned`, append:

  ```markdown
  - Remote-style library name is not exposed reliably. Fall back to the
    name prefix and `style.key` (`Unknown library (key: abc123)`).
  - Remote-variable library name comes from
    `figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync()`
    matched by `collection.key`.
  - `figma.loadAllPagesAsync()` is required before walking the whole
    file under `documentAccess: "dynamic-page"`.
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add README.md CLAUDE.md
  git commit -m "docs: document Lint mode in README and CLAUDE.md"
  ```

---

## Self-review (run after writing the plan)

- **Spec coverage**: every spec section maps to a task above.
  - Mode toggle / shared shell → Task 2
  - Code layout → Task 1
  - Origin classification → Task 3
  - Allow-list (default + persistence + re-classify cache) → Tasks 5 (default), 10 (toggle + persistence + cache)
  - Known API limit (Unknown library fallback) → Task 3
  - Index shape → Task 4
  - Message protocol → Tasks 5, 7, 8, 9, 10, 12
  - UI (pre-scan, scanning, results, segmented controls, library section, item row) → Tasks 2, 5, 6, 9
  - Edge cases (missing items, mixed font, file scope, cancel, whitelist of absent libraries, selection mid-flight, gradient stops, prefixless remote style, per-mode unbind tooltip) → Tasks 3, 4, 8, 11, 12. *Per-mode unbind tooltip is deferred — not implemented but called out below.*
  - Risks → Task 3 (honest fallback), 4 + 10 (cached re-classify), 11 (file warning)
  - Deliverables → Tasks 1, 6, 9, 10, 13
  - Out of scope → not implemented (correct)
- **Cancel during scan/detach** is a stated edge case but not implemented as its own task — the spec says it follows "the same cooperative flag pattern Strip uses today". Recommend adding follow-up if Strip's flag is not trivially reused. Not blocking for v1.
- **Per-mode unbind tooltip** on `Detach all from this library` is in the spec but not implemented. Low-effort polish, can ship as a small follow-up.
- **Placeholders**: none — every step has the code or command it needs.
- **Type consistency**: `lint-detach` payload `{ kind, id, layerIds }` matches between Task 8 (sandbox handler), Task 8 (per-item dispatch), Task 9 (per-library and bulk dispatch). `__lintLastIndex` is used in both `code.js` (sandbox cache) and `window.__lintLastIndex` (UI cache) — distinct namespaces, distinct purposes, both used consistently.

Both gaps above are intentional v1 cuts. If the user wants them in scope, add Tasks 14 (cancel) and 15 (tooltip) at the end.
