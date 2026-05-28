// === bootstrap ===

// Show the UI
figma.showUI(__html__, { width: 450, height: 700 });

// Handle preferences storage using Figma's clientStorage
async function loadPreferences() {
  try {
    var prefs = await figma.clientStorage.getAsync('stripThatOut-preferences');
    return prefs || {
      unlinkStyles: true,
      unlinkTokens: true
    };
  } catch (e) {
    console.error('Error loading preferences:', e);
    return {
      unlinkStyles: true,
      unlinkTokens: true
    };
  }
}

async function savePreferences(prefs) {
  try {
    await figma.clientStorage.setAsync('stripThatOut-preferences', prefs);
  } catch (e) {
    console.error('Error saving preferences:', e);
  }
}

// Load and send preferences to UI on startup
loadPreferences().then(function(prefs) {
  figma.ui.postMessage({
    type: 'preferences-loaded',
    preferences: prefs
  });
  sendStats();
});


// === walker ===

// Function to collect all nodes recursively before processing
function collectAllNodes(node, nodes) {
  if (!nodes) nodes = [];

  // Check if node still exists and is valid
  try {
    if (node.removed || !node.parent) {
      return nodes;
    }
  } catch (e) {
    return nodes;
  }

  nodes.push(node);
  if ('children' in node) {
    var children = node.children.slice();
    for (var i = 0; i < children.length; i++) {
      collectAllNodes(children[i], nodes);
    }
  }
  return nodes;
}

// Function to check if node is still valid
function isNodeValid(node) {
  try {
    return node && !node.removed && node.parent !== null;
  } catch (e) {
    return false;
  }
}

function sendStats() {
  var selection = figma.currentPage.selection;
  if (selection.length === 0) {
    figma.ui.postMessage({ type: 'stats', stats: null });
    return;
  }
  var all = [];
  for (var i = 0; i < selection.length; i++) {
    if (isNodeValid(selection[i])) collectAllNodes(selection[i], all);
  }
  var styles = { fill: 0, stroke: 0, effect: 0, text: 0, grid: 0 };
  var stylesTotal = 0;
  var variables = 0;
  for (var i = 0; i < all.length; i++) {
    var cats = getStyleCategories(all[i]);
    if (cats.fill) styles.fill++;
    if (cats.stroke) styles.stroke++;
    if (cats.effect) styles.effect++;
    if (cats.text) styles.text++;
    if (cats.grid) styles.grid++;
    if (hasAnyStyle(cats)) stylesTotal++;
    if (hasVariableApplied(all[i])) variables++;
  }
  figma.ui.postMessage({
    type: 'stats',
    stats: {
      layers: all.length,
      styles: styles,
      stylesTotal: stylesTotal,
      variables: variables
    }
  });
}

var statsTimer = null;
function debouncedSendStats() {
  if (statsTimer) clearTimeout(statsTimer);
  statsTimer = setTimeout(function() {
    statsTimer = null;
    sendStats();
  }, 200);
}

figma.on('selectionchange', debouncedSendStats);


// === origin ===


// === detach helpers ===

// Recursively detect if obj (or any nested array/object) contains a
// non-empty boundVariables map. Required for gradient paints where the
// variable binding lives on gradientStops[k].boundVariables, not on the
// paint object itself.
function hasNestedBoundVars(obj) {
  if (obj === null || typeof obj !== 'object') return false;
  if (Array.isArray(obj)) {
    for (var i = 0; i < obj.length; i++) {
      if (hasNestedBoundVars(obj[i])) return true;
    }
    return false;
  }
  if (obj.boundVariables && typeof obj.boundVariables === 'object') {
    for (var k in obj.boundVariables) {
      if (obj.boundVariables.hasOwnProperty(k)) return true;
    }
  }
  for (var key in obj) {
    if (obj.hasOwnProperty(key) && key !== 'boundVariables') {
      if (hasNestedBoundVars(obj[key])) return true;
    }
  }
  return false;
}

// Function to deep clone and remove boundVariables
function cloneWithoutBoundVars(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    var arr = [];
    for (var i = 0; i < obj.length; i++) {
      arr[i] = cloneWithoutBoundVars(obj[i]);
    }
    return arr;
  }

  var clone = {};
  for (var key in obj) {
    if (obj.hasOwnProperty(key) && key !== 'boundVariables') {
      clone[key] = cloneWithoutBoundVars(obj[key]);
    }
  }
  return clone;
}

// Function to remove styles per category. opts is an object with booleans
// for fill/stroke/effect/text/grid. Missing keys default to true (back-compat).
async function removeStyles(nodes, opts) {
  opts = opts || {};
  var doFill = opts.fill !== false;
  var doStroke = opts.stroke !== false;
  var doEffect = opts.effect !== false;
  var doText = opts.text !== false;
  var doGrid = opts.grid !== false;
  var removedCount = 0;

  for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i];

    if (!isNodeValid(node)) {
      continue;
    }

    if (doFill) {
      try {
        if ('fillStyleId' in node && node.fillStyleId && typeof node.setFillStyleIdAsync === 'function') {
          await node.setFillStyleIdAsync('');
          removedCount++;
        }
      } catch (e) {
        console.error('Error removing fill style:', e);
      }
    }

    if (doStroke) {
      try {
        if ('strokeStyleId' in node && node.strokeStyleId && typeof node.setStrokeStyleIdAsync === 'function') {
          await node.setStrokeStyleIdAsync('');
          removedCount++;
        }
      } catch (e) {
        console.error('Error removing stroke style:', e);
      }
    }

    if (doEffect) {
      try {
        if ('effectStyleId' in node && node.effectStyleId && typeof node.setEffectStyleIdAsync === 'function') {
          await node.setEffectStyleIdAsync('');
          removedCount++;
        }
      } catch (e) {
        console.error('Error removing effect style:', e);
      }
    }

    if (doText) {
      try {
        if (node.type === 'TEXT' && 'textStyleId' in node && node.textStyleId) {
          // setTextStyleIdAsync('') only drops the style reference. It does
          // not rewrite text content, so it does NOT require the font to be
          // loaded. A pre-load here would throw on missing fonts and the
          // text style would never detach — exactly what we want to avoid.
          await node.setTextStyleIdAsync('');
          removedCount++;
        }
      } catch (e) {
        console.error('Error removing text style:', e.message);
      }
    }

    if (doGrid) {
      try {
        if ('gridStyleId' in node && node.gridStyleId && typeof node.setGridStyleIdAsync === 'function') {
          await node.setGridStyleIdAsync('');
          removedCount++;
        }
      } catch (e) {
        console.error('Error removing grid style:', e);
      }
    }

    // backgroundStyleId is a PageNode property folded into the fill category
    // (Figma's setFillStyleIdAsync covers both per docs).
    if (doFill) {
      try {
        if ('backgroundStyleId' in node && node.backgroundStyleId && typeof node.setFillStyleIdAsync === 'function') {
          await node.setFillStyleIdAsync('');
          removedCount++;
        }
      } catch (e) {
        console.error('Error removing background style:', e);
      }
    }
  }

  return removedCount;
}


// Ensure every font used by a text node is loaded. Required before any
// write to font-dependent properties (fontSize, lineHeight, fills, etc.).
// Handles figma.mixed by loading each unique font across the character
// ranges. Failure to handle this caused unlinkTextBoundVariables to abort
// silently on mixed-font text whose styles had just been detached.
async function ensureTextFontsLoaded(node) {
  if (!node || node.type !== 'TEXT') return;
  if (node.fontName !== figma.mixed) {
    try { await figma.loadFontAsync(node.fontName); } catch (e) {}
    return;
  }
  var loaded = {};
  var length = node.characters.length;
  for (var i = 0; i < length; i++) {
    try {
      var fn = node.getRangeFontName(i, i + 1);
      var key = fn.family + '|' + fn.style;
      if (!loaded[key]) {
        await figma.loadFontAsync(fn);
        loaded[key] = true;
      }
    } catch (e) {}
  }
}

// Function to unlink text-specific bound variables
async function unlinkTextBoundVariables(node) {
  var unlinkedCount = 0;
  
  if (node.type !== 'TEXT') {
    return unlinkedCount;
  }
  
  try {
    var textBoundVars = node.boundVariables;
    
    if (!textBoundVars) {
      return unlinkedCount;
    }
    
    // Handle fontSize / lineHeight / letterSpacing / paragraphSpacing / paragraphIndent.
    // ensureTextFontsLoaded covers figma.mixed by walking the character
    // ranges; otherwise these writes fail and the binding stays attached.
    var simpleProps = ['fontSize', 'lineHeight', 'letterSpacing', 'paragraphSpacing', 'paragraphIndent'];
    for (var sp = 0; sp < simpleProps.length; sp++) {
      var prop = simpleProps[sp];
      if (!textBoundVars[prop]) continue;
      try {
        await ensureTextFontsLoaded(node);
        var current = node[prop];
        if (current === figma.mixed || current === undefined) continue;
        if (prop === 'fontSize' && typeof current !== 'number') continue;
        node.setBoundVariable(prop, null);
        node[prop] = current;
        unlinkedCount++;
      } catch (e) {
        console.error('Error unbinding ' + prop + ':', e.message);
      }
    }
    
    // Handle fontName (more complex)
    if (textBoundVars.fontName) {
      try {
        var currentFontName = node.fontName;
        if (currentFontName !== figma.mixed) {
          await figma.loadFontAsync(currentFontName);
          node.setBoundVariable('fontName', null);
          node.fontName = currentFontName;
          unlinkedCount++;
        }
      } catch (e) {
        console.error('Error unbinding fontName:', e);
      }
    }
    
  } catch (e) {
    console.error('Error unlinking text bound variables:', e);
  }
  
  return unlinkedCount;
}

// Function to unlink all bound variables from a node
async function unlinkAllBoundVariables(node) {
  var unlinkedCount = 0;
  
  if (!node.boundVariables) {
    return unlinkedCount;
  }
  
  // Get all possible properties that can have bound variables
  var allProps = [
    'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
    'opacity', 'cornerRadius', 'topLeftRadius', 'topRightRadius', 
    'bottomLeftRadius', 'bottomRightRadius', 'itemSpacing', 
    'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom',
    'layoutAlign', 'layoutGrow', 'layoutPositioning'
  ];
  
  for (var i = 0; i < allProps.length; i++) {
    var prop = allProps[i];
    
    if (node.boundVariables[prop]) {
      try {
        var currentValue = node[prop];
        
        // Only proceed if we have a concrete value
        if (currentValue !== figma.mixed && currentValue !== undefined) {
          node.setBoundVariable(prop, null);
          node[prop] = currentValue;
          unlinkedCount++;
        }
      } catch (e) {
        console.error('Error unbinding property ' + prop + ':', e.message);
      }
    }
  }
  
  return unlinkedCount;
}

// Function to unlink text segment variables (character-level)
async function unlinkTextSegmentVariables(node) {
  var unlinkedCount = 0;
  
  if (node.type !== 'TEXT') {
    return unlinkedCount;
  }
  
  try {
    await figma.loadFontAsync(node.fontName);
    var length = node.characters.length;
    
    if (length === 0) {
      return unlinkedCount;
    }
    
    // Check each character position for bound variables
    for (var i = 0; i < length; i++) {
      try {
        var rangeBoundVars = node.getRangeBoundVariables(i, i + 1);
        
        if (!rangeBoundVars) continue;
        
        // Handle fontSize at character level
        if (rangeBoundVars.fontSize) {
          try {
            var currentSize = node.getRangeFontSize(i, i + 1);
            if (typeof currentSize === 'number') {
              node.setRangeBoundVariables(i, i + 1, { fontSize: null });
              node.setRangeFontSize(i, i + 1, currentSize);
              unlinkedCount++;
            }
          } catch (e) {}
        }
        
        // Handle lineHeight at character level
        if (rangeBoundVars.lineHeight) {
          try {
            var currentLineHeight = node.getRangeLineHeight(i, i + 1);
            node.setRangeBoundVariables(i, i + 1, { lineHeight: null });
            node.setRangeLineHeight(i, i + 1, currentLineHeight);
            unlinkedCount++;
          } catch (e) {}
        }
        
        // Handle letterSpacing at character level
        if (rangeBoundVars.letterSpacing) {
          try {
            var currentLetterSpacing = node.getRangeLetterSpacing(i, i + 1);
            node.setRangeBoundVariables(i, i + 1, { letterSpacing: null });
            node.setRangeLetterSpacing(i, i + 1, currentLetterSpacing);
            unlinkedCount++;
          } catch (e) {}
        }
        
        // Handle fontName at character level
        if (rangeBoundVars.fontName) {
          try {
            var currentFontName = node.getRangeFontName(i, i + 1);
            if (currentFontName !== figma.mixed) {
              await figma.loadFontAsync(currentFontName);
              node.setRangeBoundVariables(i, i + 1, { fontName: null });
              node.setRangeFontName(i, i + 1, currentFontName);
              unlinkedCount++;
            }
          } catch (e) {}
        }
        
        // Handle fills at character level
        if (rangeBoundVars.fills) {
          try {
            var currentFills = node.getRangeFills(i, i + 1);
            if (currentFills !== figma.mixed && Array.isArray(currentFills)) {
              node.setRangeBoundVariables(i, i + 1, { fills: null });
              node.setRangeFills(i, i + 1, cloneWithoutBoundVars(currentFills));
              unlinkedCount++;
            }
          } catch (e) {}
        }
        
      } catch (e) {
        // Continue to next character
      }
    }
    
    
  } catch (e) {
    console.error('Error unlinking text segment variables:', e);
  }
  
  return unlinkedCount;
}

// Function to resolve string variable to its actual value
function resolveStringVariable(variableId) {
  try {
    var variable = figma.variables.getVariableById(variableId);
    if (variable && variable.resolvedType === 'STRING') {
      // Get the value for the current mode
      var collection = figma.variables.getVariableCollectionById(variable.variableCollectionId);
      if (collection) {
        var modes = collection.modes;
        if (modes && modes.length > 0) {
          var modeId = modes[0].modeId;
          var value = variable.valuesByMode[modeId];
          return value;
        }
      }
    }
  } catch (e) {
    console.error('Error resolving string variable:', e);
  }
  return null;
}

// Unbind a single font-binding field (fontFamily / fontStyle / fontWeight).
// Handles figma.mixed by walking character ranges and unbinding per range.
async function unlinkFontFieldBinding(node, field) {
  var unlinked = 0;
  if (!node.boundVariables || !node.boundVariables[field]) {
    // Field may also be bound per-range while node-level is empty: walk
    // segments below if mixed. For non-mixed, node.boundVariables is the
    // single source of truth.
  }
  try {
    var currentFontName = node.fontName;
    if (currentFontName !== figma.mixed) {
      if (!node.boundVariables || !node.boundVariables[field]) return 0;
      await figma.loadFontAsync(currentFontName);
      node.setBoundVariable(field, null);
      node.fontName = currentFontName;
      return 1;
    }
    // Mixed: iterate font-uniform ranges and unbind where the range carries
    // the binding. Skip cleanly past ranges without it.
    var length = node.characters.length;
    var i = 0;
    while (i < length) {
      var rangeFontName = node.getRangeFontName(i, i + 1);
      try { await figma.loadFontAsync(rangeFontName); } catch (e) {}
      var rangeEnd = i + 1;
      while (rangeEnd < length) {
        var next = node.getRangeFontName(rangeEnd, rangeEnd + 1);
        if (next.family === rangeFontName.family && next.style === rangeFontName.style) {
          rangeEnd++;
        } else break;
      }
      var rbv = node.getRangeBoundVariables(i, rangeEnd);
      if (rbv && rbv[field]) {
        var nullKey = {};
        nullKey[field] = null;
        node.setRangeBoundVariables(i, rangeEnd, nullKey);
        node.setRangeFontName(i, rangeEnd, rangeFontName);
        unlinked++;
      }
      i = rangeEnd;
    }
  } catch (e) {
    console.error('Error unbinding ' + field + ':', e.message);
  }
  return unlinked;
}

// Unbind every font-name-component string variable on a text node.
// Figma exposes three separate binding keys for typography variables:
// fontFamily, fontStyle, and fontWeight. The original implementation
// only handled fontFamily + fontStyle, so weight-keyed bindings
// survived the strip.
async function unlinkFontStringVariables(node) {
  if (node.type !== 'TEXT') return 0;
  var total = 0;
  total += await unlinkFontFieldBinding(node, 'fontFamily');
  total += await unlinkFontFieldBinding(node, 'fontStyle');
  total += await unlinkFontFieldBinding(node, 'fontWeight');
  return total;
}


// === strip ===

// Per-category style detection. Returns booleans for each Figma style type.
// backgroundStyleId is a PageNode property; folded into "fill" for stats since
// Figma's API treats it as a fill style and PageNodes rarely appear in selection.
function getStyleCategories(node) {
  var cats = { fill: false, stroke: false, effect: false, text: false, grid: false };
  try {
    if (node.fillStyleId) cats.fill = true;
    if (node.backgroundStyleId) cats.fill = true;
    if (node.strokeStyleId) cats.stroke = true;
    if (node.effectStyleId) cats.effect = true;
    if (node.gridStyleId) cats.grid = true;
    if (node.type === 'TEXT' && node.textStyleId) cats.text = true;
  } catch (e) {}
  return cats;
}

function hasAnyStyle(cats) {
  return cats.fill || cats.stroke || cats.effect || cats.text || cats.grid;
}

function paintListHasVars(list) {
  if (!Array.isArray(list)) return false;
  for (var i = 0; i < list.length; i++) {
    if (list[i] && list[i].boundVariables && Object.keys(list[i].boundVariables).length > 0) {
      return true;
    }
  }
  return false;
}

function hasVariableApplied(node) {
  try {
    if (node.boundVariables && Object.keys(node.boundVariables).length > 0) return true;
    if ('fills' in node && node.fills !== figma.mixed && paintListHasVars(node.fills)) return true;
    if ('strokes' in node && node.strokes !== figma.mixed && paintListHasVars(node.strokes)) return true;
    if ('effects' in node && node.effects !== figma.mixed && paintListHasVars(node.effects)) return true;
  } catch (e) {}
  return false;
}

// Function to unlink variable bindings (tokens)
async function unlinkTokens(nodes) {
  var unlinkedCount = 0;
  
  for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i];
    
    if (!isNodeValid(node)) {
      continue;
    }
    
    try {
      // Handle text nodes specially
      if (node.type === 'TEXT') {
        // Unlink font string variables FIRST (fontFamily, fontWeight)
        unlinkedCount += await unlinkFontStringVariables(node);
        
        // Unlink node-level text variables
        unlinkedCount += await unlinkTextBoundVariables(node);
        
        // Unlink character-level variables
        unlinkedCount += await unlinkTextSegmentVariables(node);
      }
      
      // Unlink all other bound variables
      unlinkedCount += await unlinkAllBoundVariables(node);
      
      // Handle fills with bound variables (including gradient stops)
      if ('fills' in node && node.fills !== figma.mixed && Array.isArray(node.fills)) {
        try {
          var fills = node.fills;
          var hasBinding = hasNestedBoundVars(fills);

          if (hasBinding) {
            if (node.type === 'TEXT') {
              await figma.loadFontAsync(node.fontName);
            }
            var newFills = cloneWithoutBoundVars(fills);
            node.fills = newFills;
            unlinkedCount++;
          }
        } catch (e) {
          console.error('Error processing fills:', e.message);
        }
      }

      // Handle strokes with bound variables (including gradient stops)
      if ('strokes' in node && node.strokes !== figma.mixed && Array.isArray(node.strokes)) {
        try {
          var strokes = node.strokes;
          var hasBinding = hasNestedBoundVars(strokes);

          if (hasBinding) {
            var newStrokes = cloneWithoutBoundVars(strokes);
            node.strokes = newStrokes;
            unlinkedCount++;
          }
        } catch (e) {
          console.error('Error processing strokes:', e.message);
        }
      }

      // Handle effects with bound variables (color/offset/radius/spread vars)
      if ('effects' in node && node.effects !== figma.mixed && Array.isArray(node.effects)) {
        try {
          var effects = node.effects;
          var hasBinding = hasNestedBoundVars(effects);

          if (hasBinding) {
            var newEffects = cloneWithoutBoundVars(effects);
            node.effects = newEffects;
            unlinkedCount++;
          }
        } catch (e) {
          console.error('Error processing effects:', e.message);
        }
      }

    } catch (e) {
      console.error('Error unlinking tokens from node:', node.name, e);
    }
  }
  
  return unlinkedCount;
}


// Process the selected nodes with progress updates
async function processSelection(options) {
  var selection = figma.currentPage.selection;

  if (selection.length === 0) {
    figma.ui.postMessage({
      type: 'error',
      message: 'Please select at least one object or frame'
    });
    return;
  }

  try {
    figma.ui.postMessage({
      type: 'progress',
      message: 'Starting...',
      percent: 5
    });

    var styleOpts = options.styles || {};
    var anyStyle = styleOpts.fill || styleOpts.stroke || styleOpts.effect || styleOpts.text || styleOpts.grid;

    var totalSteps = 0;
    if (anyStyle) totalSteps++;
    if (options.unlinkTokens) totalSteps++;

    var currentStep = 0;

    // Store selection roots
    var selectionRoots = selection.slice();

    // Collect nodes from selection
    figma.ui.postMessage({
      type: 'progress',
      message: 'Collecting nodes...',
      percent: 45
    });

    var allNodes = [];
    for (var i = 0; i < selectionRoots.length; i++) {
      if (isNodeValid(selectionRoots[i])) {
        collectAllNodes(selectionRoots[i], allNodes);
      }
    }


    // STEP 2: Remove styles BEFORE unlinking tokens (styles may contain token references)
    if (anyStyle) {
      currentStep++;
      figma.ui.postMessage({
        type: 'progress',
        message: 'Detaching styles...',
        percent: 50 + ((currentStep - 1) / totalSteps) * 25
      });
      await removeStyles(allNodes, styleOpts);
      
      // Re-collect nodes after removing styles
      allNodes = [];
      for (var i = 0; i < selectionRoots.length; i++) {
        if (isNodeValid(selectionRoots[i])) {
          collectAllNodes(selectionRoots[i], allNodes);
        }
      }
    }

    // STEP 3: Unlink tokens last (after styles are removed)
    if (options.unlinkTokens) {
      currentStep++;
      figma.ui.postMessage({
        type: 'progress',
        message: 'Detaching variables...',
        percent: 75 + ((currentStep - 1) / totalSteps) * 20
      });
      await unlinkTokens(allNodes);
    }

    figma.ui.postMessage({
      type: 'progress',
      message: 'Complete!',
      percent: 100
    });

    setTimeout(function() {
      var nodeCount = allNodes.length;
      figma.ui.postMessage({
        type: 'success',
        message: 'Stripped ' + nodeCount + ' ' + (nodeCount === 1 ? 'layer' : 'layers') + ' clean.'
      });
      sendStats();
    }, 500);

  } catch (e) {
    console.error('Processing error:', e);
    figma.ui.postMessage({
      type: 'error',
      message: e.message || 'Something went wrong while stripping.'
    });
  }
}


// === lint ===


// === router ===

// Listen for messages from the UI
figma.ui.onmessage = function(msg) {
  if (msg.type === 'strip') {
    processSelection({
      styles: msg.styles || {
        // Back-compat shim if UI sends old shape
        fill: !!msg.unlinkStyles,
        stroke: !!msg.unlinkStyles,
        effect: !!msg.unlinkStyles,
        text: !!msg.unlinkStyles,
        grid: !!msg.unlinkStyles
      },
      unlinkTokens: msg.unlinkTokens
    });
  } else if (msg.type === 'save-preferences') {
    savePreferences(msg.preferences);
  } else if (msg.type === 'load-preferences') {
    loadPreferences().then(function(prefs) {
      figma.ui.postMessage({
        type: 'preferences-loaded',
        preferences: prefs
      });
    });
  } else if (msg.type === 'cancel') {
    figma.closePlugin();
  }
};
