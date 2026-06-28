#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const asmPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).asm');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-25T00:00:00Z';
const catalogId = 'world-sprite-palette-inheritance-catalog-2026-06-25';
const reportId = 'sprite-palette-inheritance-audit-2026-06-25';
const toolName = 'tools/world-sprite-palette-inheritance-audit.mjs';

const paletteTableCatalogId = 'world-palette-table-catalog-2026-06-24';
const zoneRecipeCatalogId = 'world-zone-recipe-catalog-2026-06-25';
const inlineRecipeCatalogId = 'world-inline-transition-recipe-catalog-2026-06-25';
const pointerFlowCatalogId = 'world-zone-descriptor-pointer-flow-catalog-2026-06-25';

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function cleanCode(line) {
  return line.split(';')[0].trim();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseOffset(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  return parseInt(value.replace(/^0x/i, ''), 16);
}

function offsetOf(region) {
  return parseOffset(region.offset);
}

function labelOffset(label) {
  const match = /^_LABEL_([0-9A-F]+)_$/i.exec(label || '');
  return match ? parseInt(match[1], 16) : null;
}

function findContainingRegion(mapData, offset) {
  if (offset == null) return null;
  return (mapData.regions || []).find(region => {
    const start = offsetOf(region);
    return offset >= start && offset < start + (region.size || 0);
  }) || null;
}

function regionRef(region) {
  if (!region) return null;
  return {
    id: region.id,
    offset: region.offset,
    size: region.size || 0,
    type: region.type || 'unknown',
    name: region.name || '',
  };
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === id);
    if (found) return found;
  }
  return null;
}

function pointerFlowSummaries(mapData) {
  const catalog = findCatalog(mapData, pointerFlowCatalogId);
  return Array.isArray(catalog?.flowSummaries) ? catalog.flowSummaries : [];
}

function pointerFlowRef(mapData, id) {
  const flow = pointerFlowSummaries(mapData).find(item => item.id === id) || null;
  if (!flow) {
    return {
      catalogId: pointerFlowCatalogId,
      flowId: id,
      found: false,
    };
  }
  return {
    catalogId: pointerFlowCatalogId,
    flowId: flow.id,
    kind: flow.kind,
    dispatchTable: flow.dispatchTable || null,
    dispatchEntryIndices: flow.dispatchEntryIndices || flow.transitionLoadEntryIndices || flow.directDispatchEntryIndices || null,
    ramRefs: flow.ramRefs || [],
    confidence: flow.confidence || 'medium',
    evidence: (flow.evidence || []).slice(0, 4),
    found: true,
  };
}

function inheritedPathClass(mapData, callerLabel, callLine) {
  const base = {
    exactSpritePaletteIndexStatus: 'requires_runtime_path_state',
    spritePaletteStateRam: '_RAM_CFF6_',
    reason: 'No _LABEL_8B2_ sprite-palette write occurs in the same routine before this _LABEL_2620_ call; the room load preserves whichever sprite palette is already active.',
  };

  if (callerLabel === '_LABEL_4903_') {
    return {
      ...base,
      kind: 'trigger_immediate_room_load_inherits_active_sprite_palette',
      pointerRam: '_RAM_CFFA_',
      flowRefs: [pointerFlowRef(mapData, 'trigger_immediate_room_load_cffa')],
      summary: '_LABEL_48A9_ writes a trigger destination to _RAM_CFFA_; _LABEL_4903_ immediately loads that descriptor while preserving the active sprite palette.',
      evidence: [
        'ASM line 11090 writes DE to _RAM_CFFA_ in _LABEL_48A9_.',
        'ASM line 11111 loads HL from _RAM_CFFA_; ASM line 11112 calls _LABEL_2620_.',
      ],
    };
  }

  if (callerLabel === '_LABEL_4CED_' || callerLabel === '_LABEL_4D08_') {
    return {
      ...base,
      kind: 'trigger_deferred_room_transition_inherits_active_sprite_palette',
      pointerRam: '_RAM_C26C_',
      flowRefs: [pointerFlowRef(mapData, 'trigger_deferred_room_transition_c26c')],
      summary: `${callerLabel} consumes a deferred descriptor pointer from _RAM_C26C_ after trigger dispatch; the active sprite palette is carried through the transition.`,
      evidence: [
        'ASM line 11129 stores DE in _RAM_C26C_ in _LABEL_492B_.',
        `${callerLabel} loads HL from _RAM_C26C_ immediately before the _LABEL_2620_ call at ASM line ${callLine}.`,
      ],
    };
  }

  if (callerLabel === '_LABEL_4E49_') {
    return {
      ...base,
      kind: 'staged_transition_followup_descriptor_inherits_active_sprite_palette',
      pointerRam: '_RAM_C26C_',
      flowRefs: [pointerFlowRef(mapData, 'transition_form_stage_bank2_request')],
      summary: '_LABEL_4E49_ either queues a bank-2 form-stage transition or skips the first inline descriptor and directly loads the follow-up descriptor, preserving the active sprite palette.',
      evidence: [
        'ASM lines 11771-11788 read _RAM_C26C_ and compare the selector with _RAM_CF5B_.',
        'ASM lines 11796-11801 skip six bytes, reload HL from _RAM_C26C_, and call _LABEL_2620_ for the follow-up descriptor.',
      ],
    };
  }

  if (callerLabel === '_LABEL_B44F_') {
    const phase = callLine === 20114 ? 'first_inline_descriptor_before_bank2_scene' : 'second_inline_descriptor_after_bank2_scene';
    const evidence = callLine === 20114
      ? [
        'ASM line 20113 loads HL from _RAM_C26C_; ASM line 20114 calls _LABEL_2620_ for the first inline descriptor.',
        'ASM lines 20115-20118 then advance _RAM_C26C_ by six bytes for the second descriptor.',
      ]
      : [
        'ASM line 20133 reloads HL from the advanced _RAM_C26C_; ASM line 20134 calls _LABEL_2620_ for the second inline descriptor.',
        'ASM lines 20119-20128 run the bank-2 transition scene between the two descriptor loads.',
      ];
    return {
      ...base,
      kind: 'bank2_transition_room_sequence_inherits_active_sprite_palette',
      phase,
      pointerRam: '_RAM_C26C_',
      flowRefs: [
        pointerFlowRef(mapData, 'transition_form_stage_bank2_request'),
        pointerFlowRef(mapData, 'bank2_transition_room_sequence_c26c'),
      ],
      summary: '_LABEL_B44F_ consumes a two-descriptor bank-2 transition room sequence from _RAM_C26C_; both room loads preserve the active sprite palette.',
      evidence,
    };
  }

  if (callerLabel === '_LABEL_B599_') {
    return {
      ...base,
      kind: 'bank2_finale_branch_room_load_inherits_active_sprite_palette',
      pointerRam: '_RAM_C26C_',
      flowRefs: [
        pointerFlowRef(mapData, 'bank2_transition_room_sequence_c26c'),
        pointerFlowRef(mapData, 'bank2_finale_branch_c26c'),
      ],
      summary: '_LABEL_B599_ is the final bank-2 transition scene branch that eventually loads the room at _RAM_C26C_ while preserving the active sprite palette.',
      evidence: [
        '_DATA_B515_ entry 5 targets _LABEL_B599_.',
        'ASM line 20305 loads HL from _RAM_C26C_; ASM line 20306 calls _LABEL_2620_.',
      ],
    };
  }

  return {
    ...base,
    kind: 'unclassified_runtime_prior_room_load',
    pointerRam: null,
    flowRefs: [],
    summary: `${callerLabel || 'Unknown routine'} calls _LABEL_2620_ with inherited sprite palette state.`,
    evidence: [`ASM line ${callLine} calls _LABEL_2620_.`],
  };
}

function collectLabelLines(lines) {
  const labels = new Map();
  for (let i = 0; i < lines.length; i++) {
    const match = /^(_LABEL_[0-9A-F]+_):/.exec(lines[i]);
    if (match) labels.set(match[1], i);
  }
  return labels;
}

function labelRef(mapData, label, line) {
  const offset = labelOffset(label);
  return {
    label,
    offset: offset == null ? null : hex(offset),
    line,
    region: regionRef(findContainingRegion(mapData, offset)),
  };
}

function findLine(lines, needle, fromIndex = 0, toIndex = lines.length) {
  for (let i = fromIndex; i < toIndex; i++) {
    if (lines[i].includes(needle)) return i + 1;
  }
  return null;
}

function findNextLabelIndex(lines, fromIndex) {
  for (let i = fromIndex + 1; i < lines.length; i++) {
    if (/^_LABEL_[0-9A-F]+_:/.test(lines[i])) return i;
  }
  return lines.length;
}

function nearestPreparedPair(lines, callLineIndex, routineStartIndex) {
  let hSource = null;
  let lSource = null;

  function sourceFromAssignment(register, expr, line) {
    const immMatch = /^\$([0-9A-F]{2})$/i.exec(expr);
    return {
      register,
      expr,
      line,
      value: immMatch ? parseInt(immMatch[1], 16) : null,
    };
  }

  function pairFromSources(mode, line) {
    const value = hSource?.value != null && lSource?.value != null
      ? (hSource.value << 8) | lSource.value
      : null;
    return {
      mode,
      line,
      value,
      bgSource: lSource,
      spriteSource: hSource,
    };
  }

  for (let i = callLineIndex - 1; i >= routineStartIndex; i--) {
    const code = cleanCode(lines[i]);
    if (!code) continue;
    const hlMatch = /\bld\s+hl,\s*\$([0-9A-F]{4})/i.exec(code);
    if (hlMatch) {
      if (!hSource && !lSource) {
        const value = parseInt(hlMatch[1], 16);
        return {
          mode: 'ld_hl_immediate',
          line: i + 1,
          value,
          bgSource: { register: 'l', expr: `$${(value & 0xFF).toString(16).toUpperCase().padStart(2, '0')}`, line: i + 1, value: value & 0xFF },
          spriteSource: { register: 'h', expr: `$${((value >> 8) & 0xFF).toString(16).toUpperCase().padStart(2, '0')}`, line: i + 1, value: (value >> 8) & 0xFF },
        };
      }
      return pairFromSources('ld_hl_immediate_clobbered_by_later_h_or_l_assignment', i + 1);
    }

    const hMatch = /\bld\s+h,\s*([^;]+)$/i.exec(code);
    if (hMatch && !hSource) hSource = sourceFromAssignment('h', hMatch[1].trim(), i + 1);
    const lMatch = /\bld\s+l,\s*([^;]+)$/i.exec(code);
    if (lMatch && !lSource) lSource = sourceFromAssignment('l', lMatch[1].trim(), i + 1);
    if (hSource && lSource) {
      return pairFromSources(hSource.value != null && lSource.value != null ? 'ld_h_ld_l_immediate' : 'ld_h_ld_l_dynamic', i + 1);
    }
  }
  if (hSource || lSource) return pairFromSources('partial_h_l_dynamic', Math.min(hSource?.line || Infinity, lSource?.line || Infinity));
  return null;
}

function findDescriptorSource(lines, callLineIndex, routineStartIndex) {
  for (let i = callLineIndex - 1; i >= routineStartIndex && i >= callLineIndex - 10; i--) {
    const code = cleanCode(lines[i]);
    const match = /\bld\s+hl,\s*(.+)$/i.exec(code);
    if (match) {
      return {
        mode: 'ld_hl_before_call',
        expr: match[1].trim(),
        line: i + 1,
      };
    }
  }
  return {
    mode: 'unknown',
    expr: '',
    line: null,
  };
}

function findPreviousPaletteCall(lines, callLineIndex, routineStartIndex) {
  for (let i = callLineIndex - 1; i >= routineStartIndex; i--) {
    if (!/\bcall\s+_LABEL_8B2_/i.test(cleanCode(lines[i]))) continue;
    const preparedPair = nearestPreparedPair(lines, i, routineStartIndex);
    if (!preparedPair) {
      return {
        line: i + 1,
        preparedPair: null,
      };
    }
    return {
      line: i + 1,
      preparedPair: {
        mode: preparedPair.mode,
        sourceLine: preparedPair.line,
        rawHL: preparedPair.value == null ? null : hex(preparedPair.value, 4),
        bgIndex: preparedPair.value == null ? null : preparedPair.value & 0xFF,
        spriteIndex: preparedPair.value == null ? null : (preparedPair.value >> 8) & 0xFF,
        bgSource: preparedPair.bgSource,
        spriteSource: preparedPair.spriteSource,
      },
    };
  }
  return null;
}

function classifySpriteStateBeforeRoomLoad(lines, callLineIndex, routineStartIndex) {
  const previousPaletteCall = findPreviousPaletteCall(lines, callLineIndex, routineStartIndex);
  if (!previousPaletteCall?.preparedPair) {
    return {
      status: 'runtime_prior_state',
      ownerStatus: 'not_initialized_in_same_routine',
      evidence: [
        `ASM line ${callLineIndex + 1} calls _LABEL_2620_; no earlier _LABEL_8B2_ call appears in the same top-level routine before this room load.`,
        '_LABEL_26F4_ later calls _LABEL_8B2_ with H=$FF, so the sprite palette comes from the prior _RAM_CFF6_ runtime state.',
      ],
    };
  }

  const pair = previousPaletteCall.preparedPair;
  if (pair.rawHL && pair.spriteIndex !== 0xFF) {
    return {
      status: 'confirmed_direct_initializer',
      ownerStatus: 'same_routine_direct_index',
      paletteLoaderCallLine: previousPaletteCall.line,
      sourceLine: pair.sourceLine,
      rawHL: pair.rawHL,
      bgIndex: pair.bgIndex,
      bgState: pair.bgIndex === 0xFF ? 'keep_existing' : 'direct_index',
      spriteIndex: pair.spriteIndex,
      spriteState: 'direct_index',
      evidence: [
        `ASM line ${pair.sourceLine} loads ${pair.rawHL} into HL before _LABEL_8B2_ at line ${previousPaletteCall.line}.`,
        `The high byte ${hex(pair.spriteIndex, 2)} updates _RAM_CFF6_ before _LABEL_2620_ at line ${callLineIndex + 1}.`,
      ],
    };
  }

  if (pair.rawHL && pair.spriteIndex === 0xFF) {
    return {
      status: 'runtime_prior_state',
      ownerStatus: 'same_routine_palette_call_keeps_sprite',
      paletteLoaderCallLine: previousPaletteCall.line,
      sourceLine: pair.sourceLine,
      rawHL: pair.rawHL,
      bgIndex: pair.bgIndex,
      bgState: pair.bgIndex === 0xFF ? 'keep_existing' : 'direct_index',
      spriteIndex: pair.spriteIndex,
      spriteState: 'keep_existing',
      evidence: [
        `ASM line ${pair.sourceLine} loads ${pair.rawHL}; the high byte is $FF, so _LABEL_8B2_ preserves the existing sprite palette.`,
      ],
    };
  }

  return {
    status: 'runtime_prior_state',
    ownerStatus: 'same_routine_dynamic_palette_call',
    paletteLoaderCallLine: previousPaletteCall.line,
    sourceLine: pair.sourceLine,
    sourceMode: pair.mode,
    evidence: [
      `ASM line ${previousPaletteCall.line} calls _LABEL_8B2_ before _LABEL_2620_ at line ${callLineIndex + 1}, but HL is dynamic in this static scan.`,
    ],
  };
}

function scanRoomLoadCallsites(mapData, asmText) {
  const lines = asmText.split(/\r?\n/);
  const callsites = [];
  let currentLabel = null;
  let currentStartIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const labelMatch = /^(_LABEL_[0-9A-F]+_):/.exec(lines[i]);
    if (labelMatch) {
      currentLabel = labelMatch[1];
      currentStartIndex = i;
      continue;
    }
    if (!/\bcall\s+_LABEL_2620_/i.test(cleanCode(lines[i]))) continue;
    const descriptorSource = findDescriptorSource(lines, i, currentStartIndex);
    const spriteState = classifySpriteStateBeforeRoomLoad(lines, i, currentStartIndex);
    if (spriteState.status !== 'confirmed_direct_initializer') {
      spriteState.inheritedPathClass = inheritedPathClass(mapData, currentLabel, i + 1);
      spriteState.ownerStatus = spriteState.inheritedPathClass.kind;
    }
    const callerOffset = labelOffset(currentLabel);
    callsites.push({
      id: `room_load_callsite_${(i + 1).toString().padStart(5, '0')}`,
      caller: labelRef(mapData, currentLabel, currentStartIndex + 1),
      callLine: i + 1,
      call: 'call _LABEL_2620_',
      descriptorSource,
      spritePaletteStateBeforeCall: spriteState,
      confidence: spriteState.status === 'confirmed_direct_initializer' ? 'high' : 'medium',
      evidence: [
        `ASM line ${i + 1} calls _LABEL_2620_ from ${currentLabel || 'unknown routine'}.`,
        `Routine ${currentLabel || 'unknown'} begins at ASM line ${currentStartIndex + 1}${callerOffset == null ? '' : ` / ROM ${hex(callerOffset)}`}.`,
      ],
    });
  }
  return callsites;
}

function buildInitializerPaths(callsites) {
  const byKey = new Map();
  for (const callsite of callsites) {
    const state = callsite.spritePaletteStateBeforeCall;
    if (state.status !== 'confirmed_direct_initializer') continue;
    const key = `${callsite.caller.label}:${state.paletteLoaderCallLine}:${state.rawHL}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        id: `sprite_palette_initializer_${callsite.caller.label.replace(/^_LABEL_|_$/g, '')}_${state.paletteLoaderCallLine}`,
        caller: callsite.caller,
        paletteLoaderCallLine: state.paletteLoaderCallLine,
        sourceLine: state.sourceLine,
        rawHL: state.rawHL,
        bgState: state.bgState,
        bgIndex: state.bgIndex,
        spriteState: state.spriteState,
        spriteIndex: state.spriteIndex,
        coveredRoomLoadCallLines: [],
        coveredRoomLoadCallsiteIds: [],
        confidence: 'high',
        evidence: state.evidence,
      });
    }
    const pathEntry = byKey.get(key);
    pathEntry.coveredRoomLoadCallLines.push(callsite.callLine);
    pathEntry.coveredRoomLoadCallsiteIds.push(callsite.id);
  }
  return [...byKey.values()];
}

function cachedRestorePath(mapData, lines, labels, id, saveLabel, restoreLabel, notes) {
  const saveIndex = labels.get(saveLabel);
  const restoreIndex = labels.get(restoreLabel);
  const saveEnd = saveIndex == null ? lines.length : findNextLabelIndex(lines, saveIndex);
  const restoreEnd = restoreIndex == null ? lines.length : findNextLabelIndex(lines, restoreIndex);
  const saveLine = saveIndex == null ? null : saveIndex + 1;
  const restoreLine = restoreIndex == null ? null : restoreIndex + 1;
  const savePaletteLine = saveIndex == null ? null : findLine(lines, 'ld hl, (_RAM_CFF5_)', saveIndex, saveEnd);
  const restorePaletteLine = restoreIndex == null ? null : findLine(lines, 'call _LABEL_8B2_', restoreIndex, restoreEnd);
  return {
    id,
    status: saveLine && restorePaletteLine ? 'confirmed_cached_restore' : 'incomplete_static_match',
    saveRoutine: saveLine == null ? null : labelRef(mapData, saveLabel, saveLine),
    restoreRoutine: restoreLine == null ? null : labelRef(mapData, restoreLabel, restoreLine),
    savedState: {
      palettePairRam: '_RAM_CFF5_/_RAM_CFF6_',
      scratchRam: '_RAM_CFF1_+0/+1',
      firstObservedSaveLine: savePaletteLine,
    },
    restoredState: {
      paletteLoaderRoutine: '_LABEL_8B2_',
      restoredFromScratchRam: '_RAM_CFF1_+0/+1',
      restoreCallLine: restorePaletteLine,
    },
    notes,
    confidence: saveLine && restorePaletteLine ? 'high' : 'low',
    evidence: [
      savePaletteLine
        ? `ASM line ${savePaletteLine} in ${saveLabel} reads _RAM_CFF5_/_RAM_CFF6_ for the cached palette pair.`
        : `No _RAM_CFF5_ save line found in ${saveLabel}.`,
      restorePaletteLine
        ? `ASM line ${restorePaletteLine} in ${restoreLabel} calls _LABEL_8B2_ after reloading L/H from the cached palette pair.`
        : `No _LABEL_8B2_ restore call found in ${restoreLabel}.`,
    ],
  };
}

function buildRestorePaths(mapData, asmText) {
  const lines = asmText.split(/\r?\n/);
  const labels = collectLabelLines(lines);
  return [
    cachedRestorePath(
      mapData,
      lines,
      labels,
      'cached_palette_restore_4D98_4DBA',
      '_LABEL_4D98_',
      '_LABEL_4DBA_',
      'Transition helper saves the active BG/SPR palette pair before a transition effect and restores it afterward.'
    ),
    cachedRestorePath(
      mapData,
      lines,
      labels,
      'cached_palette_restore_28AE_28E1',
      '_LABEL_28AE_',
      '_LABEL_28E1_',
      'Bank-0 scene helper saves the active BG/SPR palette pair before an effect path and restores it afterward.'
    ),
  ];
}

function inheritanceRef() {
  return {
    catalogId,
    model: 'preserved_runtime_sprite_palette_state',
    stateRam: '_RAM_CFF6_',
    ownerStatus: 'runtime_prior_state',
    loaderRoutine: '_LABEL_8B2_',
    preservingRoutine: '_LABEL_26F4_',
    evidenceRef: catalogId,
  };
}

function annotateSpritePaletteInheritance(mapData) {
  let recipeCount = 0;
  let preservedCount = 0;
  let annotatedCount = 0;
  const fields = ['zoneRecipes', 'inlineTransitionRecipes'];
  for (const field of fields) {
    for (const recipe of mapData[field] || []) {
      recipeCount++;
      const sprite = recipe.dependencies?.palette?.spritePalette;
      if (!sprite || sprite.status !== 'preserve_existing') continue;
      preservedCount++;
      sprite.inheritance = inheritanceRef();
      annotatedCount++;
    }
  }
  return {
    recipeCount,
    preservedSpritePaletteRecipeCount: preservedCount,
    annotatedRecipeCount: annotatedCount,
  };
}

function collectRecipeStats(mapData) {
  let recipeCount = 0;
  let preservedCount = 0;
  let inheritanceRefCount = 0;
  const ownerStatuses = new Map();
  for (const field of ['zoneRecipes', 'inlineTransitionRecipes']) {
    for (const recipe of mapData[field] || []) {
      recipeCount++;
      const sprite = recipe.dependencies?.palette?.spritePalette;
      if (sprite?.status === 'preserve_existing') preservedCount++;
      if (sprite?.inheritance?.catalogId === catalogId) {
        inheritanceRefCount++;
        const status = sprite.inheritance.ownerStatus || 'unknown';
        ownerStatuses.set(status, (ownerStatuses.get(status) || 0) + 1);
      }
    }
  }
  return {
    recipeCount,
    preservedSpritePaletteRecipeCount: preservedCount,
    inheritanceRefRecipeCount: inheritanceRefCount,
    ownerStatusCounts: Object.fromEntries([...ownerStatuses.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
  };
}

function countRuntimePathClasses(callsites) {
  const byKind = new Map();
  let pointerFlowBackedCount = 0;
  for (const callsite of callsites) {
    const state = callsite.spritePaletteStateBeforeCall;
    if (state.status === 'confirmed_direct_initializer') continue;
    const pathClass = state.inheritedPathClass || {};
    const kind = pathClass.kind || 'unclassified_runtime_prior_room_load';
    byKind.set(kind, (byKind.get(kind) || 0) + 1);
    if ((pathClass.flowRefs || []).some(flow => flow.found)) pointerFlowBackedCount++;
  }
  return {
    pathClassCounts: Object.fromEntries([...byKind.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    pointerFlowBackedRuntimePriorCallsiteCount: pointerFlowBackedCount,
  };
}

function buildCatalog(mapData, roomLoadCallsites, initializerPaths, restorePaths, recipeStats) {
  const directRoomLoadCallsites = roomLoadCallsites.filter(callsite =>
    callsite.spritePaletteStateBeforeCall.status === 'confirmed_direct_initializer'
  );
  const runtimePriorCallsites = roomLoadCallsites.filter(callsite =>
    callsite.spritePaletteStateBeforeCall.status !== 'confirmed_direct_initializer'
  );
  const directSpriteIndexes = [...new Set(directRoomLoadCallsites
    .map(callsite => callsite.spritePaletteStateBeforeCall.spriteIndex)
    .filter(value => value != null))]
    .sort((a, b) => a - b);
  const runtimePathStats = countRuntimePathClasses(roomLoadCallsites);
  const paletteLoaderRegion = regionRef(findContainingRegion(mapData, 0x08B2));
  const roomLoaderRegion = regionRef(findContainingRegion(mapData, 0x2620));
  const roomSubrecordRegion = regionRef(findContainingRegion(mapData, 0x26F4));
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [
      findCatalog(mapData, paletteTableCatalogId) ? paletteTableCatalogId : null,
      findCatalog(mapData, zoneRecipeCatalogId) ? zoneRecipeCatalogId : null,
      findCatalog(mapData, inlineRecipeCatalogId) ? inlineRecipeCatalogId : null,
      findCatalog(mapData, pointerFlowCatalogId) ? pointerFlowCatalogId : null,
    ].filter(Boolean),
    stateModel: {
      kind: 'sprite_palette_runtime_inheritance',
      bgPaletteRam: '_RAM_CFF5_',
      spritePaletteRam: '_RAM_CFF6_',
      paletteLoaderRoutine: '_LABEL_8B2_',
      paletteLoaderOffset: '0x008B2',
      paletteLoaderRegion,
      roomLoaderRoutine: '_LABEL_2620_',
      roomLoaderOffset: '0x02620',
      roomLoaderRegion,
      roomSubrecordRoutine: '_LABEL_26F4_',
      roomSubrecordOffset: '0x026F4',
      roomSubrecordRegion,
      keepExistingSentinel: '0xFF',
      bgPaletteTableCatalogId: paletteTableCatalogId,
      confidence: 'high',
    },
    summary: {
      roomLoadCallsiteCount: roomLoadCallsites.length,
      directInitializerBeforeRoomLoadCallsiteCount: directRoomLoadCallsites.length,
      runtimePriorStateRoomLoadCallsiteCount: runtimePriorCallsites.length,
      classifiedRuntimePriorStateRoomLoadCallsiteCount: Object.values(runtimePathStats.pathClassCounts).reduce((sum, count) => sum + count, 0),
      pointerFlowBackedRuntimePriorCallsiteCount: runtimePathStats.pointerFlowBackedRuntimePriorCallsiteCount,
      runtimePriorPathClassCounts: runtimePathStats.pathClassCounts,
      directInitializerPathCount: initializerPaths.length,
      cachedRestorePathCount: restorePaths.filter(pathEntry => pathEntry.status === 'confirmed_cached_restore').length,
      directSpriteIndexes,
      recipeCount: recipeStats.recipeCount,
      preservedSpritePaletteRecipeCount: recipeStats.preservedSpritePaletteRecipeCount,
      inheritanceRefRecipeCount: recipeStats.inheritanceRefRecipeCount,
      recipeOwnerStatusCounts: recipeStats.ownerStatusCounts,
      assetPolicy: 'Metadata only: ASM labels, lines, offsets, region ids, RAM names, palette indexes, callsite classifications, and recipe counts. No ROM bytes, palette data, graphics, or rendered assets are embedded.',
    },
    roomLoadCallsites,
    directInitializerPaths: initializerPaths,
    cachedRestorePaths: restorePaths,
    recipeInheritanceModel: {
      appliesToTopLevelRecipeFields: ['zoneRecipes', 'inlineTransitionRecipes'],
      dependencyPath: 'dependencies.palette.spritePalette.inheritance',
      ownerStatus: 'runtime_prior_state',
      reason: '_LABEL_26F4_ preserves the current _RAM_CFF6_ sprite palette for room loads, so a recipe cannot name a sprite palette index without the runtime path that established the state.',
      rendererExpectation: 'Scene simulation should carry CRAM sprite palette state from the entry/transition path instead of selecting a sprite palette from the room subrecord.',
    },
    evidence: [
      'ASM lines 2154-2164: _LABEL_8B2_ writes _RAM_CFF6_ only when H is not $FF.',
      'ASM lines 6495-6502: _LABEL_26F4_ masks the room subrecord flags/palette byte into L, sets H=$FF, and calls _LABEL_8B2_, preserving _RAM_CFF6_ for room loads.',
      'The scanned _LABEL_2620_ callsites identify which room-entry routines directly initialize the sprite palette before room load and which inherit prior runtime state.',
      'world-zone-descriptor-pointer-flow-catalog-2026-06-25 links inherited room-load callsites to the _RAM_CFFA_/_RAM_C26C_/_RAM_CF6A_/_RAM_D1AE_ pointer flows that selected the room descriptor.',
      'Cached restore paths _LABEL_4D98_/_LABEL_4DBA_ and _LABEL_28AE_/_LABEL_28E1_ preserve and restore the active BG/SPR palette pair through _RAM_CFF1_.',
    ],
  };
}

function main() {
  const mapData = readJson(mapPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const roomLoadCallsites = scanRoomLoadCallsites(mapData, asmText);
  const initializerPaths = buildInitializerPaths(roomLoadCallsites);
  const restorePaths = buildRestorePaths(mapData, asmText);
  const annotationStats = apply
    ? annotateSpritePaletteInheritance(mapData)
    : { recipeCount: 0, preservedSpritePaletteRecipeCount: 0, annotatedRecipeCount: 0 };
  const recipeStats = collectRecipeStats(mapData);
  const catalog = buildCatalog(mapData, roomLoadCallsites, initializerPaths, restorePaths, recipeStats);

  if (apply) {
    mapData.paletteCatalogs = (mapData.paletteCatalogs || []).filter(item => item.id !== catalogId);
    mapData.paletteCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'sprite_palette_inheritance_audit',
      schemaVersion: 1,
      generatedAt: now,
      tool: `${toolName} --apply`,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: {
        ...catalog.summary,
        annotatedRecipeCount: annotationStats.annotatedRecipeCount,
      },
      directInitializerPaths: catalog.directInitializerPaths,
      cachedRestorePaths: catalog.cachedRestorePaths,
      roomLoadCallsiteSample: catalog.roomLoadCallsites.slice(0, 16),
      evidence: catalog.evidence,
      nextLeads: [
        'Trace _RAM_CFF6_ writes through each transition state to assign concrete inherited sprite palette indexes where runtime path is known.',
        'Model entry/transition scene recipes that run the direct $01FF initializer paths before zone rendering.',
        'Extend browser rendering to carry the inherited sprite CRAM palette from previous scene state once entry-path recipes exist.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      annotatedRecipeCount: annotationStats.annotatedRecipeCount,
    },
    directInitializerPaths: catalog.directInitializerPaths,
    cachedRestorePaths: catalog.cachedRestorePaths.map(pathEntry => ({
      id: pathEntry.id,
      status: pathEntry.status,
      saveRoutine: pathEntry.saveRoutine?.label || null,
      restoreRoutine: pathEntry.restoreRoutine?.label || null,
      restoreCallLine: pathEntry.restoredState.restoreCallLine,
    })),
    runtimePriorStateCallsiteIds: catalog.roomLoadCallsites
      .filter(callsite => callsite.spritePaletteStateBeforeCall.status !== 'confirmed_direct_initializer')
      .map(callsite => callsite.id),
  }, null, 2));
}

main();
