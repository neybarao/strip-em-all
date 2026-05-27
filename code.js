// Show the UI
figma.showUI(__html__, { width: 450, height: 660 });

// Handle preferences storage using Figma's clientStorage
async function loadPreferences() {
  try {
    var prefs = await figma.clientStorage.getAsync('stripThatOut-preferences');
    console.log('Loaded preferences:', prefs);
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
    console.log('Saved preferences:', prefs);
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
  }, 120);
}

figma.on('selectionchange', debouncedSendStats);

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
          // Load font before modifying text properties
          if (node.fontName !== figma.mixed) {
            await figma.loadFontAsync(node.fontName);
          } else {
            var length = node.characters.length;
            var loadedFonts = {};
            for (var j = 0; j < length; j++) {
              try {
                var fontName = node.getRangeFontName(j, j + 1);
                var fontKey = fontName.family + '-' + fontName.style;
                if (!loadedFonts[fontKey]) {
                  await figma.loadFontAsync(fontName);
                  loadedFonts[fontKey] = true;
                }
              } catch (e) {}
            }
          }
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

  console.log('Total styles removed: ' + removedCount);
  return removedCount;
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
    
    // Handle fontSize
    if (textBoundVars.fontSize) {
      try {
        await figma.loadFontAsync(node.fontName);
        var currentSize = node.fontSize;
        if (typeof currentSize === 'number') {
          node.setBoundVariable('fontSize', null);
          node.fontSize = currentSize;
          unlinkedCount++;
          console.log('Unbound fontSize from text:', node.name);
        }
      } catch (e) {
        console.error('Error unbinding fontSize:', e);
      }
    }
    
    // Handle lineHeight
    if (textBoundVars.lineHeight) {
      try {
        await figma.loadFontAsync(node.fontName);
        var currentLineHeight = node.lineHeight;
        node.setBoundVariable('lineHeight', null);
        node.lineHeight = currentLineHeight;
        unlinkedCount++;
        console.log('Unbound lineHeight from text:', node.name);
      } catch (e) {
        console.error('Error unbinding lineHeight:', e);
      }
    }
    
    // Handle letterSpacing
    if (textBoundVars.letterSpacing) {
      try {
        await figma.loadFontAsync(node.fontName);
        var currentLetterSpacing = node.letterSpacing;
        node.setBoundVariable('letterSpacing', null);
        node.letterSpacing = currentLetterSpacing;
        unlinkedCount++;
        console.log('Unbound letterSpacing from text:', node.name);
      } catch (e) {
        console.error('Error unbinding letterSpacing:', e);
      }
    }
    
    // Handle paragraphSpacing
    if (textBoundVars.paragraphSpacing) {
      try {
        await figma.loadFontAsync(node.fontName);
        var currentParagraphSpacing = node.paragraphSpacing;
        node.setBoundVariable('paragraphSpacing', null);
        node.paragraphSpacing = currentParagraphSpacing;
        unlinkedCount++;
        console.log('Unbound paragraphSpacing from text:', node.name);
      } catch (e) {
        console.error('Error unbinding paragraphSpacing:', e);
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
          console.log('Unbound fontName from text:', node.name);
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
          console.log('Unbound ' + prop + ' from:', node.name);
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
    
    console.log('Unbound ' + unlinkedCount + ' text segment variables from:', node.name);
    
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

// Function to unbind font properties with string variables
async function unlinkFontStringVariables(node) {
  var unlinkedCount = 0;
  
  if (node.type !== 'TEXT') {
    return unlinkedCount;
  }
  
  try {
    var textBoundVars = node.boundVariables;
    
    if (!textBoundVars) {
      return unlinkedCount;
    }
    
    // Handle fontFamily string variable
    if (textBoundVars.fontFamily) {
      try {
        console.log('Found fontFamily string variable on:', node.name);
        
        // Get current font name
        var currentFontName = node.fontName;
        
        if (currentFontName !== figma.mixed) {
          // Load the current font
          await figma.loadFontAsync(currentFontName);
          
          // Unbind the variable
          node.setBoundVariable('fontFamily', null);
          
          // Reapply the font
          node.fontName = currentFontName;
          
          unlinkedCount++;
          console.log('Unbound fontFamily string variable from:', node.name, 'font:', currentFontName.family);
        } else {
          // Handle mixed fonts
          var length = node.characters.length;
          var processedRanges = [];
          
          for (var i = 0; i < length; i++) {
            // Check if this range was already processed
            var alreadyProcessed = false;
            for (var k = 0; k < processedRanges.length; k++) {
              if (i >= processedRanges[k].start && i < processedRanges[k].end) {
                alreadyProcessed = true;
                break;
              }
            }
            if (alreadyProcessed) continue;
            
            var rangeFontName = node.getRangeFontName(i, i + 1);
            await figma.loadFontAsync(rangeFontName);
            
            // Find the extent of this font
            var rangeEnd = i + 1;
            for (var j = i + 1; j < length; j++) {
              var nextFont = node.getRangeFontName(j, j + 1);
              if (nextFont.family === rangeFontName.family && nextFont.style === rangeFontName.style) {
                rangeEnd = j + 1;
              } else {
                break;
              }
            }
            
            // Unbind for this range
            var rangeBoundVars = node.getRangeBoundVariables(i, rangeEnd);
            if (rangeBoundVars && rangeBoundVars.fontFamily) {
              node.setRangeBoundVariables(i, rangeEnd, { fontFamily: null });
              node.setRangeFontName(i, rangeEnd, rangeFontName);
              unlinkedCount++;
            }
            
            processedRanges.push({ start: i, end: rangeEnd });
            i = rangeEnd - 1;
          }
          
          console.log('Unbound fontFamily string variable from mixed text:', node.name);
        }
      } catch (e) {
        console.error('Error unbinding fontFamily string variable:', e.message);
      }
    }
    
    // Handle fontStyle string variable (this is what fontWeight actually controls)
    if (textBoundVars.fontStyle) {
      try {
        console.log('Found fontStyle string variable on:', node.name);
        
        // Get current font name
        var currentFontName = node.fontName;
        
        if (currentFontName !== figma.mixed) {
          // Load the current font
          await figma.loadFontAsync(currentFontName);
          
          // Unbind the variable
          node.setBoundVariable('fontStyle', null);
          
          // Reapply the font
          node.fontName = currentFontName;
          
          unlinkedCount++;
          console.log('Unbound fontStyle string variable from:', node.name, 'style:', currentFontName.style);
        } else {
          // Handle mixed fonts
          var length = node.characters.length;
          var processedRanges = [];
          
          for (var i = 0; i < length; i++) {
            // Check if this range was already processed
            var alreadyProcessed = false;
            for (var k = 0; k < processedRanges.length; k++) {
              if (i >= processedRanges[k].start && i < processedRanges[k].end) {
                alreadyProcessed = true;
                break;
              }
            }
            if (alreadyProcessed) continue;
            
            var rangeFontName = node.getRangeFontName(i, i + 1);
            await figma.loadFontAsync(rangeFontName);
            
            // Find the extent of this font
            var rangeEnd = i + 1;
            for (var j = i + 1; j < length; j++) {
              var nextFont = node.getRangeFontName(j, j + 1);
              if (nextFont.family === rangeFontName.family && nextFont.style === rangeFontName.style) {
                rangeEnd = j + 1;
              } else {
                break;
              }
            }
            
            // Unbind for this range
            var rangeBoundVars = node.getRangeBoundVariables(i, rangeEnd);
            if (rangeBoundVars && rangeBoundVars.fontStyle) {
              node.setRangeBoundVariables(i, rangeEnd, { fontStyle: null });
              node.setRangeFontName(i, rangeEnd, rangeFontName);
              unlinkedCount++;
            }
            
            processedRanges.push({ start: i, end: rangeEnd });
            i = rangeEnd - 1;
          }
          
          console.log('Unbound fontStyle string variable from mixed text:', node.name);
        }
      } catch (e) {
        console.error('Error unbinding fontStyle string variable:', e.message);
      }
    }
    
  } catch (e) {
    console.error('Error unlinking font string variables:', e);
  }
  
  return unlinkedCount;
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
      
      // Handle fills with bound variables
      if ('fills' in node && node.fills !== figma.mixed && Array.isArray(node.fills)) {
        try {
          var fills = node.fills;
          var hasBinding = false;
          
          for (var j = 0; j < fills.length; j++) {
            if (fills[j].boundVariables) {
              hasBinding = true;
              break;
            }
          }
          
          if (hasBinding) {
            if (node.type === 'TEXT') {
              await figma.loadFontAsync(node.fontName);
            }
            var newFills = cloneWithoutBoundVars(fills);
            node.fills = newFills;
            unlinkedCount++;
            console.log('Unbound fills from:', node.name);
          }
        } catch (e) {
          console.error('Error processing fills:', e.message);
        }
      }

      // Handle strokes with bound variables
      if ('strokes' in node && node.strokes !== figma.mixed && Array.isArray(node.strokes)) {
        try {
          var strokes = node.strokes;
          var hasBinding = false;
          
          for (var j = 0; j < strokes.length; j++) {
            if (strokes[j].boundVariables) {
              hasBinding = true;
              break;
            }
          }
          
          if (hasBinding) {
            var newStrokes = cloneWithoutBoundVars(strokes);
            node.strokes = newStrokes;
            unlinkedCount++;
            console.log('Unbound strokes from:', node.name);
          }
        } catch (e) {
          console.error('Error processing strokes:', e.message);
        }
      }

      // Handle effects with bound variables
      if ('effects' in node && node.effects !== figma.mixed && Array.isArray(node.effects)) {
        try {
          var effects = node.effects;
          var hasBinding = false;
          
          for (var j = 0; j < effects.length; j++) {
            if (effects[j].boundVariables) {
              hasBinding = true;
              break;
            }
          }
          
          if (hasBinding) {
            var newEffects = cloneWithoutBoundVars(effects);
            node.effects = newEffects;
            unlinkedCount++;
            console.log('Unbound effects from:', node.name);
          }
        } catch (e) {
          console.error('Error processing effects:', e.message);
        }
      }

    } catch (e) {
      console.error('Error unlinking tokens from node:', node.name, e);
    }
  }
  
  console.log('Total token bindings unlinked: ' + unlinkedCount);
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

    console.log('Processing ' + allNodes.length + ' nodes for styles and tokens...');

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
