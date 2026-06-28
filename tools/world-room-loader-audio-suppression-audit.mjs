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
const toolName = 'tools/world-room-loader-audio-suppression-audit.mjs';
const catalogId = 'world-room-loader-audio-suppression-catalog-2026-06-25';
const reportId = 'room-loader-audio-suppression-audit-2026-06-25';

const sourceCatalogs = [
  'world-room-loader-field-bound-catalog-2026-06-25',
  'world-zone-loader-caller-context-catalog-2026-06-25',
  'world-zone-trigger-record-catalog-2026-06-25',
  'world-zone-trigger-destination-role-catalog-2026-06-25',
  'world-zone-recipe-catalog-2026-06-25',
  'world-inline-transition-recipe-catalog-2026-06-25',
  'world-audio-request-taxonomy-catalog-2026-06-25',
];

const suppressedSelectors = [0x09, 0x0D, 0x0F, 0x1E];
const suppressedSelectorSet = new Set(suppressedSelectors);
const roomDescriptorRoles = new Set(['room_descriptor_direct_cffa', 'room_descriptor_deferred_c26c']);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(value, pad = 2) {
  return '0x' + Number(value).toString(16).toUpperCase().padStart(pad, '0');
}

function parseHex(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const match = /^(?:0x|\$)?([0-9A-F]+)$/i.exec(String(value));
  return match ? parseInt(match[1], 16) : null;
}

function catalogById(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item?.id === id);
    if (found) return found;
  }
  return null;
}

function regionStart(region) {
  return parseHex(region?.offset) ?? 0;
}

function regionEnd(region) {
  return regionStart(region) + Number(region?.size || 0);
}

function containingRegion(mapData, offset) {
  return (mapData.regions || [])
    .filter(region => offset >= regionStart(region) && offset < regionEnd(region))
    .sort((a, b) => Number(a.size || 0) - Number(b.size || 0) || String(a.id).localeCompare(String(b.id)))[0] || null;
}

function compactRegion(region) {
  if (!region) return null;
  return {
    id: region.id || '',
    offset: region.offset || '',
    size: Number(region.size || 0),
    type: region.type || 'unknown',
    name: region.name || '',
  };
}

function findRam(mapData, address) {
  return (mapData.ram || []).find(entry => String(entry.address || '').toUpperCase() === address.toUpperCase()) || null;
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items || []) {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function increment(map, key, amount = 1) {
  map.set(key, (map.get(key) || 0) + amount);
}

function histogramObject(map) {
  return Object.fromEntries([...map.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([key, value]) => [hex(key, 2), value]));
}

function parseJumpTable4cad(asmText) {
  const match = /_DATA_4CAD_:\n\.dw ([^\n]+)\n\.dw ([^\n]+)\n\.dw ([^\n]+)\n\.dw ([^\n]+)/.exec(asmText);
  if (!match) return [];
  return match.slice(1)
    .join(' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((label, index) => {
      const selector = index + 1;
      return {
        selector,
        selectorHex: hex(selector, 2),
        dispatchLabel: label,
        suppressesImmediateAudio: suppressedSelectorSet.has(selector),
      };
    });
}

function compactRoleRecord(record) {
  return {
    entryOffset: record.entryOffset || '',
    rawOpcode: record.rawOpcode || '',
    opcodeIndex: Number(record.opcodeIndex || 0),
    selectorHex: hex(Number(record.opcodeIndex || 0) & 0x3F, 2),
    role: record.role || '',
    consumer: record.consumer || '',
    destinationDescriptorId: record.destination?.descriptorId || null,
    destinationOffset: record.destination?.romOffset || null,
  };
}

function classifyRoleRecord(record) {
  const selector = Number(record.opcodeIndex || 0) & 0x3F;
  const suppressed = suppressedSelectorSet.has(selector);
  if (record.role === 'form_stage_transition_record') {
    return {
      selector,
      selectorHex: hex(selector, 2),
      status: 'suppressed_inline_transition_descriptor_audio_cached_then_replayed',
      immediateCall: false,
      laterReplay: true,
      reason: 'Form-stage transition opcode 0x0F routes through _LABEL_4E49_/_LABEL_B44F_; _LABEL_26F4_ suppresses immediate _LABEL_104B_ while later code replays _RAM_CFF9_.',
    };
  }
  if (record.role === 'room_descriptor_deferred_c26c' && suppressed) {
    return {
      selector,
      selectorHex: hex(selector, 2),
      status: 'suppressed_deferred_room_audio_cached_then_replayed',
      immediateCall: false,
      laterReplay: true,
      reason: 'Deferred room selector is in the _LABEL_26F4_ suppression set; _LABEL_4D08_/_LABEL_4EB0_ paths replay _RAM_CFF9_ after the transition wait.',
    };
  }
  if (record.role === 'room_descriptor_direct_cffa' && !suppressed) {
    return {
      selector,
      selectorHex: hex(selector, 2),
      status: 'unsuppressed_direct_room_audio_request',
      immediateCall: true,
      laterReplay: false,
      reason: '_LABEL_4903_ writes _RAM_C26E_ from the trigger opcode and immediately calls _LABEL_2620_; cataloged direct-room selectors are outside the suppression set.',
    };
  }
  if (record.role === 'room_descriptor_deferred_c26c' && !suppressed) {
    return {
      selector,
      selectorHex: hex(selector, 2),
      status: 'unsuppressed_deferred_room_audio_request',
      immediateCall: true,
      laterReplay: false,
      reason: 'Deferred room selector is outside the _LABEL_26F4_ suppression set.',
    };
  }
  return {
    selector,
    selectorHex: hex(selector, 2),
    status: suppressed ? 'suppressed_non_room_descriptor_path' : 'unsuppressed_non_room_descriptor_path',
    immediateCall: !suppressed,
    laterReplay: false,
    reason: 'Trigger role is not a room descriptor load path for this audit.',
  };
}

function buildTriggerPathSummary(roleCatalog) {
  const records = roleCatalog?.recordRoles || [];
  const relevant = records.filter(record => roomDescriptorRoles.has(record.role) || record.role === 'form_stage_transition_record');
  const pathRecords = relevant.map(record => ({
    ...compactRoleRecord(record),
    audioSuppression: classifyRoleRecord(record),
  }));
  const statusCounts = countBy(pathRecords, item => item.audioSuppression.status);
  const roleStatusCounts = countBy(pathRecords, item => `${item.role}:${item.audioSuppression.status}`);
  const selectorCounts = new Map();
  const selectorSuppressionCounts = new Map();
  for (const item of pathRecords) {
    const selector = item.audioSuppression.selector;
    increment(selectorCounts, selector);
    increment(selectorSuppressionCounts, `${hex(selector, 2)}:${item.audioSuppression.immediateCall ? 'immediate' : 'cached'}`);
  }
  const suppressedRecords = pathRecords.filter(item => !item.audioSuppression.immediateCall);
  const unsuppressedRecords = pathRecords.filter(item => item.audioSuppression.immediateCall);
  return {
    recordCount: pathRecords.length,
    statusCounts,
    roleStatusCounts,
    selectorCounts: histogramObject(selectorCounts),
    selectorSuppressionCounts: Object.fromEntries([...selectorSuppressionCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    suppressedRecordCount: suppressedRecords.length,
    unsuppressedRecordCount: unsuppressedRecords.length,
    suppressedSamples: suppressedRecords.slice(0, 16),
    unsuppressedSamples: unsuppressedRecords.slice(0, 16),
    pathRecords,
  };
}

function classifyZoneRecipeIncoming(zoneRecipe, incomingRecords) {
  const suppressed = incomingRecords.filter(record => !record.audioSuppression.immediateCall);
  const unsuppressed = incomingRecords.filter(record => record.audioSuppression.immediateCall);
  let status = 'no_cataloged_incoming_room_trigger';
  if (suppressed.length && unsuppressed.length) status = 'mixed_suppressed_and_unsuppressed_incoming_triggers';
  else if (suppressed.length) status = 'only_suppressed_cached_incoming_triggers';
  else if (unsuppressed.length) status = 'only_unsuppressed_immediate_incoming_triggers';
  return {
    recipeId: zoneRecipe.id || '',
    descriptorId: zoneRecipe.sourceDescriptorId || '',
    descriptorOffset: zoneRecipe.descriptor?.romOffset || '',
    subrecordOffset: zoneRecipe.subrecord?.romOffset || '',
    audioRequestId: zoneRecipe.dependencies?.audioRequest?.requestId ?? zoneRecipe.audio?.requestId ?? null,
    audioRequestIdHex: zoneRecipe.dependencies?.audioRequest?.requestIdHex || zoneRecipe.audio?.requestIdHex || null,
    status,
    incomingTriggerRecordCount: incomingRecords.length,
    suppressedIncomingTriggerCount: suppressed.length,
    unsuppressedIncomingTriggerCount: unsuppressed.length,
    incomingSelectorCounts: countBy(incomingRecords, record => record.selectorHex),
    incomingTriggerSamples: incomingRecords.slice(0, 8).map(record => ({
      entryOffset: record.entryOffset,
      rawOpcode: record.rawOpcode,
      selectorHex: record.selectorHex,
      role: record.role,
      consumer: record.consumer,
      audioStatus: record.audioSuppression.status,
    })),
  };
}

function buildZoneRecipeSummary(mapData, triggerPathSummary) {
  const byDescriptor = new Map();
  for (const record of triggerPathSummary.pathRecords) {
    if (!roomDescriptorRoles.has(record.role)) continue;
    const descriptorId = record.destinationDescriptorId;
    if (!descriptorId) continue;
    const list = byDescriptor.get(descriptorId) || [];
    list.push(record);
    byDescriptor.set(descriptorId, list);
  }

  const recipeSummaries = (mapData.zoneRecipes || []).map(recipe =>
    classifyZoneRecipeIncoming(recipe, byDescriptor.get(recipe.sourceDescriptorId || '') || [])
  );
  const statusCounts = countBy(recipeSummaries, item => item.status);
  const audioRequestStatusCounts = {};
  for (const item of recipeSummaries) {
    const request = item.audioRequestIdHex || 'unknown';
    const key = `${request}:${item.status}`;
    audioRequestStatusCounts[key] = (audioRequestStatusCounts[key] || 0) + 1;
  }
  return {
    recipeCount: recipeSummaries.length,
    statusCounts,
    audioRequestStatusCounts: Object.fromEntries(Object.entries(audioRequestStatusCounts).sort((a, b) => a[0].localeCompare(b[0]))),
    samplesByStatus: Object.fromEntries(
      Object.keys(statusCounts).sort().map(status => [
        status,
        recipeSummaries.filter(item => item.status === status).slice(0, 12),
      ])
    ),
    recipeSummaries,
  };
}

function buildInlineTransitionSummary(mapData) {
  const recipes = mapData.inlineTransitionRecipes || [];
  const summaries = recipes.map(recipe => {
    const selector = Number(recipe.sourceTriggerRecord?.opcodeIndex ?? 0) & 0x3F;
    const suppressed = suppressedSelectorSet.has(selector);
    return {
      recipeId: recipe.id || '',
      descriptorOffset: recipe.descriptor?.romOffset || '',
      subrecordOffset: recipe.subrecord?.romOffset || '',
      triggerRecordEntryOffset: recipe.sourceTriggerRecord?.triggerRecordEntryOffset || '',
      branch: recipe.sourceTriggerRecord?.branch || '',
      branchRole: recipe.sourceTriggerRecord?.branchRole || '',
      selector,
      selectorHex: hex(selector, 2),
      audioRequestId: recipe.dependencies?.audioRequest?.requestId ?? recipe.audio?.requestId ?? null,
      audioRequestIdHex: recipe.dependencies?.audioRequest?.requestIdHex || recipe.audio?.requestIdHex || null,
      status: suppressed
        ? 'suppressed_inline_transition_descriptor_audio_cached_then_replayed'
        : 'unsuppressed_inline_transition_descriptor_audio_request',
    };
  });
  return {
    recipeCount: summaries.length,
    statusCounts: countBy(summaries, item => item.status),
    selectorCounts: countBy(summaries, item => item.selectorHex),
    samples: summaries.slice(0, 12),
    recipes: summaries,
  };
}

function buildStaticCallsiteSummary(callerCatalog) {
  const callsites = callerCatalog?.directCallsites || [];
  const summaries = callsites.map(site => {
    let status = 'selector_unresolved_prior_state';
    let selectorHex = null;
    let evidence = 'No static write to _RAM_C26E_ was proven immediately before this _LABEL_2620_ call.';
    if (site.routineLabel === '_LABEL_4903_') {
      status = 'cataloged_trigger_direct_cffa_unsuppressed';
      evidence = '_LABEL_4903_ writes _RAM_C26E_ from trigger opcode B; cataloged _LABEL_4903_ opcodes are outside the suppression set.';
    } else if (site.routineLabel === '_LABEL_4CED_') {
      status = 'cataloged_deferred_c26c_unsuppressed';
      evidence = '_DATA_4CAD_ selectors that dispatch to _LABEL_4CED_ are outside the suppression set.';
    } else if (site.routineLabel === '_LABEL_4D08_') {
      status = 'cataloged_deferred_c26c_suppressed_then_replayed';
      evidence = '_DATA_4CAD_ selectors 0x09 and 0x0D dispatch to _LABEL_4D08_; _LABEL_4D08_ replays _RAM_CFF9_ after the transition wait.';
    } else if (site.routineLabel === '_LABEL_4E49_') {
      status = 'cataloged_form_stage_suppressed_then_replayed';
      selectorHex = '0x0F';
      evidence = 'Cataloged form-stage trigger records use selector 0x0F; _LABEL_4E49_ replays _RAM_CFF9_ after the transition wait when it performs the immediate follow-up load.';
    } else if (site.routineLabel === '_LABEL_B44F_') {
      status = 'cataloged_form_stage_suppressed_then_replayed';
      selectorHex = '0x0F';
      evidence = '_LABEL_B44F_ is entered from _RAM_CF6A_=2 after the form-stage selector 0x0F path and replays _RAM_CFF9_ after each staged room load.';
    } else if (site.routineLabel === '_LABEL_B599_') {
      status = 'static_selector_zero_unsuppressed';
      selectorHex = '0x00';
      evidence = '_LABEL_B599_ clears _RAM_C26E_ immediately before calling _LABEL_2620_, so _LABEL_26F4_ does not suppress the immediate audio request.';
    }
    return {
      callLine: site.callLine,
      routineLabel: site.routineLabel,
      descriptorSource: site.descriptorSource,
      descriptorRecipeCoverage: site.descriptorRecipeCoverage,
      selectorHex,
      status,
      evidence,
    };
  });
  return {
    callsiteCount: summaries.length,
    statusCounts: countBy(summaries, item => item.status),
    callsites: summaries,
  };
}

function buildCatalog(mapData, asmText) {
  const roleCatalog = catalogById(mapData, 'world-zone-trigger-destination-role-catalog-2026-06-25');
  const callerCatalog = catalogById(mapData, 'world-zone-loader-caller-context-catalog-2026-06-25');
  const fieldCatalog = catalogById(mapData, 'world-room-loader-field-bound-catalog-2026-06-25');
  const triggerPathSummary = buildTriggerPathSummary(roleCatalog);
  const zoneRecipeSummary = buildZoneRecipeSummary(mapData, triggerPathSummary);
  const inlineTransitionSummary = buildInlineTransitionSummary(mapData);
  const staticCallsites = buildStaticCallsiteSummary(callerCatalog);
  const jumpTable = parseJumpTable4cad(asmText);
  const jumpTableSuppressedEntries = jumpTable.filter(entry => entry.suppressesImmediateAudio);
  const evidence = [
    'ASM lines 6503-6520: _LABEL_26F4_ caches changed room audio byte +17 into _RAM_CFF9_, then suppresses immediate _LABEL_104B_ when (_RAM_C26E_ & $3F) is $0D, $09, $0F, or $1E.',
    'ASM lines 11078-11113: _LABEL_48A9_/_LABEL_4903_ write _RAM_C26E_ from the trigger opcode and immediately load the _RAM_CFFA_ descriptor through _LABEL_2620_.',
    'ASM lines 11608-11613: _DATA_4CAD_ dispatches deferred _RAM_C26C_ transition selectors after _RAM_C26E_ is masked and decremented.',
    'ASM lines 11633-11646 and 11825-11832: selectors $09/$0D and $1E route through _LABEL_4D08_, which replays _RAM_CFF9_ after the transition wait.',
    'ASM lines 11770-11813 and 20107-20149: selector $0F form-stage paths route through _LABEL_4E49_/_LABEL_B44F_ and replay _RAM_CFF9_ after staged room loads.',
    'Trigger role and recipe catalogs provide descriptor ids, trigger opcodes, and recipe ids only; no room, graphics, or audio bytes are embedded.',
  ];

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs,
    sourceCatalogPresence: Object.fromEntries(sourceCatalogs.map(id => [id, Boolean(catalogById(mapData, id))])),
    assetPolicy: 'Metadata only: ASM labels, line numbers, selector ids, trigger roles, descriptor ids, recipe ids, offsets, counts, and evidence. No ROM bytes, decoded rooms, graphics, palettes, music streams, audio samples, text, pixels, or hashes are embedded.',
    suppressionModel: {
      sourceRoutine: '_LABEL_26F4_',
      sourceByteOffset: 17,
      cacheRam: '_RAM_CFF9_',
      selectorRam: '_RAM_C26E_',
      selectorMask: '0x3F',
      suppressedSelectors: suppressedSelectors.map(value => hex(value, 2)),
      immediateRequestRoutine: '_LABEL_104B_',
      replayRam: '_RAM_CFF9_',
      replayRoutines: ['_LABEL_4D08_', '_LABEL_4E49_', '_LABEL_B44F_', '_LABEL_B599_'],
    },
    jumpTable4cad: {
      selectorCount: jumpTable.length,
      entries: jumpTable,
      suppressedEntries: jumpTableSuppressedEntries,
    },
    triggerPaths: {
      ...triggerPathSummary,
      pathRecords: undefined,
    },
    zoneRecipeAudioSuppression: zoneRecipeSummary,
    inlineTransitionAudioSuppression: inlineTransitionSummary,
    directCallsiteAudioSuppression: staticCallsites,
    existingCatalogRefs: {
      roomLoaderFieldBound: fieldCatalog ? {
        id: fieldCatalog.id,
        combinedSourceCount: Number(fieldCatalog.summary?.combinedSourceCount || 0),
        uniqueAudioRequestCount: Number(fieldCatalog.summary?.uniqueAudioRequestCount || 0),
        outOfAudioRequestTableCount: Number(fieldCatalog.summary?.outOfAudioRequestTableCount || 0),
      } : null,
      triggerDestinationRoles: roleCatalog ? {
        id: roleCatalog.id,
        triggerRecordCount: Number(roleCatalog.summary?.triggerRecordCount || 0),
        directRoomDescriptorCount: Number(roleCatalog.summary?.directRoomDescriptorCount || 0),
        stagedTransitionRecordCount: Number(roleCatalog.summary?.stagedTransitionRecordCount || 0),
      } : null,
      zoneLoaderCallerContext: callerCatalog ? {
        id: callerCatalog.id,
        directZoneLoaderCallsiteCount: Number(callerCatalog.summary?.directZoneLoaderCallsiteCount || 0),
      } : null,
    },
    summary: {
      status: 'room_loader_audio_suppression_paths_cataloged_for_trigger_and_transition_recipes',
      confidence: 'high_for_cataloged_trigger_paths_medium_for_global_runtime',
      suppressedSelectorCount: suppressedSelectors.length,
      triggerPathRecordCount: triggerPathSummary.recordCount,
      triggerPathSuppressedRecordCount: triggerPathSummary.suppressedRecordCount,
      triggerPathUnsuppressedRecordCount: triggerPathSummary.unsuppressedRecordCount,
      zoneRecipeCount: zoneRecipeSummary.recipeCount,
      zoneRecipeStatusCounts: zoneRecipeSummary.statusCounts,
      inlineTransitionRecipeCount: inlineTransitionSummary.recipeCount,
      inlineTransitionStatusCounts: inlineTransitionSummary.statusCounts,
      directCallsiteStatusCounts: staticCallsites.statusCounts,
      unresolvedDirectCallsiteCount: staticCallsites.statusCounts.selector_unresolved_prior_state || 0,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
    },
    evidence,
    nextLeads: [
      'Resolve the remaining literal/new-game _LABEL_2620_ callsites whose _RAM_C26E_ prior state is not proven locally.',
      'Add analyzer badges for zone recipes: immediate audio, cached/replayed audio, mixed incoming audio behavior, or unresolved selector state.',
      'Tie replay timing to transition wait loops frame-by-frame for exact engine reconstruction.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const annotatedRegions = [];
  const routineRegion = containingRegion(mapData, 0x026F4);
  if (routineRegion) {
    routineRegion.analysis = routineRegion.analysis || {};
    routineRegion.analysis.roomLoaderAudioSuppressionAudit = {
      catalogId,
      kind: 'room_loader_audio_suppression_model',
      confidence: catalog.summary.confidence,
      suppressedSelectors: catalog.suppressionModel.suppressedSelectors,
      triggerPathSuppressedRecordCount: catalog.summary.triggerPathSuppressedRecordCount,
      triggerPathUnsuppressedRecordCount: catalog.summary.triggerPathUnsuppressedRecordCount,
      zoneRecipeStatusCounts: catalog.summary.zoneRecipeStatusCounts,
      inlineTransitionStatusCounts: catalog.summary.inlineTransitionStatusCounts,
      summary: '_LABEL_26F4_ always caches changed room audio byte +17 into _RAM_CFF9_; selected _RAM_C26E_ values suppress immediate _LABEL_104B_ and rely on later replay.',
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotatedRegions.push(compactRegion(routineRegion));
  }

  const roomDataRegion = containingRegion(mapData, 0x10C96);
  if (roomDataRegion) {
    roomDataRegion.analysis = roomDataRegion.analysis || {};
    roomDataRegion.analysis.roomLoaderAudioSuppressionAudit = {
      catalogId,
      kind: 'room_trigger_audio_suppression_summary',
      confidence: 'high_for_cataloged_trigger_paths',
      triggerPathRecordCount: catalog.summary.triggerPathRecordCount,
      triggerPathSuppressedRecordCount: catalog.summary.triggerPathSuppressedRecordCount,
      triggerPathUnsuppressedRecordCount: catalog.summary.triggerPathUnsuppressedRecordCount,
      zoneRecipeStatusCounts: catalog.summary.zoneRecipeStatusCounts,
      summary: 'Cataloged room trigger paths now identify which incoming room loads play audio immediately and which cache/replay _RAM_CFF9_.',
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotatedRegions.push(compactRegion(roomDataRegion));
  }

  const annotatedRam = [];
  for (const [address, kind, summary] of [
    ['$CFF9', 'room_loader_audio_cache_and_replay_source', '_RAM_CFF9_ caches room-loader audio byte +17 and is replayed by transition paths after immediate _LABEL_104B_ suppression.'],
    ['$C26E', 'room_loader_audio_suppression_selector', '_RAM_C26E_ low six bits select whether _LABEL_26F4_ calls _LABEL_104B_ immediately or only caches _RAM_CFF9_.'],
  ]) {
    const entry = findRam(mapData, address);
    if (!entry) continue;
    entry.analysis = entry.analysis || {};
    entry.analysis.roomLoaderAudioSuppressionAudit = {
      catalogId,
      kind,
      confidence: 'high',
      suppressedSelectors: catalog.suppressionModel.suppressedSelectors,
      summary,
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotatedRam.push({
      id: entry.id,
      address: entry.address,
      name: entry.name || '',
      kind,
    });
  }

  return { annotatedRegions, annotatedRam };
}

function main() {
  const mapData = readJson(mapPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const catalog = buildCatalog(mapData, asmText);
  let annotation = { annotatedRegions: [], annotatedRam: [] };

  if (apply) {
    annotation = annotateMap(mapData, catalog);
    mapData.roomDataCatalogs = (mapData.roomDataCatalogs || []).filter(item => item.id !== catalogId);
    mapData.roomDataCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'room_loader_audio_suppression_audit',
      schemaVersion: 1,
      generatedAt: now,
      tool: `${toolName} --apply`,
      sourceCatalogs,
      sourceCatalogPresence: catalog.sourceCatalogPresence,
      summary: {
        ...catalog.summary,
        annotatedRegionCount: annotation.annotatedRegions.length,
        annotatedRamCount: annotation.annotatedRam.length,
      },
      suppressionModel: catalog.suppressionModel,
      existingCatalogRefs: catalog.existingCatalogRefs,
      annotatedRegions: annotation.annotatedRegions,
      annotatedRam: annotation.annotatedRam,
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      annotatedRegionCount: annotation.annotatedRegions.length,
      annotatedRamCount: annotation.annotatedRam.length,
    },
    suppressedSelectors: catalog.suppressionModel.suppressedSelectors,
    triggerPathStatusCounts: catalog.triggerPaths.statusCounts,
    zoneRecipeStatusCounts: catalog.zoneRecipeAudioSuppression.statusCounts,
    inlineTransitionStatusCounts: catalog.inlineTransitionAudioSuppression.statusCounts,
    directCallsiteStatusCounts: catalog.directCallsiteAudioSuppression.statusCounts,
  }, null, 2));
}

main();
