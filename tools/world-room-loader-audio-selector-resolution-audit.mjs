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
const toolName = 'tools/world-room-loader-audio-selector-resolution-audit.mjs';
const catalogId = 'world-room-loader-audio-selector-resolution-catalog-2026-06-25';
const reportId = 'room-loader-audio-selector-resolution-audit-2026-06-25';

const sourceCatalogs = [
  'world-room-loader-audio-suppression-catalog-2026-06-25',
  'world-zone-loader-caller-context-catalog-2026-06-25',
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(value, pad = 2) {
  return '0x' + Number(value).toString(16).toUpperCase().padStart(pad, '0');
}

function ramHex(value) {
  return '$' + Number(value).toString(16).toUpperCase().padStart(4, '0');
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
  return (mapData.ram || []).find(entry => String(entry.address || '').toUpperCase() === String(address).toUpperCase()) || null;
}

function compactRam(entry) {
  if (!entry) return null;
  return {
    id: entry.id || '',
    address: entry.address || '',
    size: Number(entry.size || 1),
    type: entry.type || 'byte',
    name: entry.name || '',
  };
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items || []) {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function cleanCode(line) {
  return String(line || '').split(';')[0].trim();
}

function lineCode(lines, line) {
  return cleanCode(lines[line - 1] || '');
}

function expectLine(lines, line, expected) {
  const code = lineCode(lines, line);
  if (!code.includes(expected)) {
    throw new Error(`ASM invariant failed at line ${line}: expected "${expected}", got "${code}"`);
  }
  return {
    line,
    code,
    expected,
  };
}

function clearRange(label, start, size, evidenceLines) {
  const endInclusive = start + size - 1;
  const selector = 0xC26E;
  return {
    label,
    start: ramHex(start),
    size: hex(size, 4),
    endInclusive: ramHex(endInclusive),
    clearsC26E: selector >= start && selector <= endInclusive,
    evidenceLines,
  };
}

function compactDescriptorSource(source) {
  if (!source) return null;
  if (source.kind === 'literal_descriptor_label') {
    return {
      kind: source.kind,
      target: source.target || '',
      romOffset: source.romOffset || '',
      region: source.region || null,
    };
  }
  if (source.kind === 'ram_descriptor_pointer') {
    return {
      kind: source.kind,
      target: source.target || '',
      ramLabel: source.ramLabel || '',
      address: source.address || '',
      ramEntry: source.ramEntry || null,
    };
  }
  return {
    kind: source.kind || 'unknown',
    target: source.target || null,
  };
}

function compactRecipeCoverage(coverage) {
  if (!coverage) return null;
  return {
    status: coverage.status || '',
    coverageKind: coverage.coverageKind || '',
    zoneRecipe: coverage.zoneRecipe || null,
    inlineTransitionRecipe: coverage.inlineTransitionRecipe || null,
    catalogs: coverage.catalogs || undefined,
    evidence: coverage.evidence || '',
  };
}

function buildResolutionForCallsite(site, lineChecks, clearRanges) {
  const base = {
    callLine: site.callLine,
    routineLabel: site.routineLabel,
    descriptorSource: compactDescriptorSource(site.descriptorSource),
    descriptorRecipeCoverage: compactRecipeCoverage(site.descriptorRecipeCoverage),
  };

  if (site.callLine === 1601 && site.routineLabel === '_LABEL_508_') {
    return {
      ...base,
      status: 'caller_clear_range_zero_unsuppressed',
      selectorHex: '0x00',
      immediateAudioRequest: true,
      remainingUnresolved: false,
      confidence: 'high',
      selectorEvidenceKind: 'caller_clear_range',
      clearRange: clearRanges.label108c,
      evidence: [
        'ASM line 1026 calls _LABEL_108C_ before ASM line 1032 calls _LABEL_508_ in the same startup/title path.',
        'ASM lines 3325-3334 show _LABEL_108C_ clearing $C240-$CA3F, which includes _RAM_C26E_ at $C26E.',
        'ASM lines 1583-1601 show _LABEL_508_ loading _DATA_10C96_ and calling _LABEL_2620_ without a local _RAM_C26E_ write after the clear.',
        'Selector 0x00 is outside the _LABEL_26F4_ suppression set, so this direct room load performs the immediate _LABEL_104B_ request.',
      ],
      lineChecks: [
        lineChecks.call108cBefore508,
        lineChecks.call508,
        lineChecks.label508,
        lineChecks.call2620In508,
        lineChecks.label108c,
        lineChecks.clear108cStart,
        lineChecks.clear108cSize,
        lineChecks.clear108cStore,
      ],
    };
  }

  if (site.callLine === 1477 || site.callLine === 1491) {
    return {
      ...base,
      status: 'entry_loop_prior_selector_unresolved',
      selectorHex: null,
      immediateAudioRequest: null,
      remainingUnresolved: true,
      confidence: 'medium',
      selectorEvidenceKind: 'negative_static_trace',
      clearRange: clearRanges.label10a4,
      evidence: [
        'ASM line 1054 calls _LABEL_3E1_ before ASM line 1055 calls _LABEL_3F8_ in the gameplay entry loop.',
        'ASM lines 1448-1457 show _LABEL_3E1_ clearing _RAM_CFF9_, _RAM_CF6A_, and other state, then calling _LABEL_10A4_; no _RAM_C26E_ write is present in that reset block.',
        'ASM lines 3340-3349 show _LABEL_10A4_ clearing $C280-$CA3F, which does not include _RAM_C26E_ at $C26E.',
        'ASM lines 1459-1491 show _LABEL_3F8_ reaching the literal _LABEL_2620_ calls without a local _RAM_C26E_ write, so the prior selector state is still unresolved.',
      ],
      lineChecks: [
        lineChecks.call3e1Before3f8,
        lineChecks.call3f8,
        lineChecks.label3e1,
        lineChecks.clearCf6aIn3e1,
        lineChecks.call10a4In3e1,
        lineChecks.label10a4,
        lineChecks.clear10a4Start,
        lineChecks.clear10a4Size,
        site.callLine === 1477 ? lineChecks.call2620In3f8First : lineChecks.call2620In3f8Second,
      ],
    };
  }

  if (site.callLine === 20100 && site.routineLabel === '_LABEL_B3D3_') {
    return {
      ...base,
      status: 'cf6a_dispatch_prior_selector_unresolved',
      selectorHex: null,
      immediateAudioRequest: null,
      remainingUnresolved: true,
      confidence: 'medium',
      selectorEvidenceKind: 'dynamic_dispatch_negative_static_trace',
      clearRange: clearRanges.label10a4,
      evidence: [
        'ASM lines 20043-20055 dispatch _LABEL_B3D3_ from _RAM_CF6A_=1 via the _DATA_B3CD_ table and clear _RAM_CF6A_ before jumping.',
        'ASM lines 11163-11167 show _LABEL_497A_ can set _RAM_CF6A_=1, but that producer does not write _RAM_C26E_.',
        'ASM line 20069 calls _LABEL_10A4_; ASM lines 3340-3349 show _LABEL_10A4_ clearing $C280-$CA3F, which does not include _RAM_C26E_ at $C26E.',
        'ASM lines 20058-20100 show _LABEL_B3D3_ reaching the _RAM_CFFA_ _LABEL_2620_ call without a local _RAM_C26E_ write, so the prior selector state remains dynamic.',
      ],
      lineChecks: [
        lineChecks.labelB3c0,
        lineChecks.readCf6aInB3c0,
        lineChecks.clearCf6aInB3c0,
        lineChecks.tableB3cd,
        lineChecks.labelB3d3,
        lineChecks.call10a4InB3d3,
        lineChecks.call2620InB3d3,
        lineChecks.label497a,
        lineChecks.writeCf6aOne,
      ],
    };
  }

  return {
    ...base,
    status: 'unclassified_unresolved_callsite',
    selectorHex: null,
    immediateAudioRequest: null,
    remainingUnresolved: true,
    confidence: 'low',
    selectorEvidenceKind: 'unclassified',
    evidence: ['This callsite was unresolved in the source catalog but is not covered by this refinement audit.'],
    lineChecks: [],
  };
}

function buildLineChecks(lines) {
  return {
    call108cBefore508: expectLine(lines, 1026, 'call _LABEL_108C_'),
    call508: expectLine(lines, 1032, 'call _LABEL_508_'),
    call3e1Before3f8: expectLine(lines, 1054, 'call _LABEL_3E1_'),
    call3f8: expectLine(lines, 1055, 'call _LABEL_3F8_'),
    label3e1: expectLine(lines, 1448, '_LABEL_3E1_:'),
    clearCf6aIn3e1: expectLine(lines, 1452, 'ld (_RAM_CF6A_), a'),
    call10a4In3e1: expectLine(lines, 1456, 'call _LABEL_10A4_'),
    label3f8: expectLine(lines, 1459, '_LABEL_3F8_:'),
    call2620In3f8First: expectLine(lines, 1477, 'call _LABEL_2620_'),
    call2620In3f8Second: expectLine(lines, 1491, 'call _LABEL_2620_'),
    label508: expectLine(lines, 1583, '_LABEL_508_:'),
    call2620In508: expectLine(lines, 1601, 'call _LABEL_2620_'),
    label108c: expectLine(lines, 3325, '_LABEL_108C_:'),
    clear108cStart: expectLine(lines, 3326, 'ld hl, _RAM_C240_'),
    clear108cSize: expectLine(lines, 3327, 'ld bc, $0800'),
    clear108cStore: expectLine(lines, 3329, 'ld (hl), $00'),
    label10a4: expectLine(lines, 3340, '_LABEL_10A4_:'),
    clear10a4Start: expectLine(lines, 3341, 'ld hl, _RAM_C280_'),
    clear10a4Size: expectLine(lines, 3342, 'ld bc, $07C0'),
    labelB3c0: expectLine(lines, 20043, '_LABEL_B3C0_:'),
    readCf6aInB3c0: expectLine(lines, 20044, 'ld a, (_RAM_CF6A_)'),
    clearCf6aInB3c0: expectLine(lines, 20049, 'ld (_RAM_CF6A_), a'),
    tableB3cd: expectLine(lines, 20055, '.dw _LABEL_B3D3_ _LABEL_B44F_ _LABEL_B6B0_'),
    labelB3d3: expectLine(lines, 20058, '_LABEL_B3D3_:'),
    call10a4InB3d3: expectLine(lines, 20069, 'call _LABEL_10A4_'),
    call2620InB3d3: expectLine(lines, 20100, 'call _LABEL_2620_'),
    label497a: expectLine(lines, 11164, '_LABEL_497A_:'),
    writeCf6aOne: expectLine(lines, 11166, 'ld (_RAM_CF6A_), a'),
    writeC26eIn4903: expectLine(lines, 11104, 'ld (_RAM_C26E_), a'),
    call2620In4903: expectLine(lines, 11112, 'call _LABEL_2620_'),
    writeCf6aTwoIn4e49: expectLine(lines, 11792, 'ld (_RAM_CF6A_), a'),
  };
}

function buildCatalog(mapData, asmText) {
  const lines = asmText.split(/\r?\n/);
  const lineChecks = buildLineChecks(lines);
  const suppressionCatalog = catalogById(mapData, 'world-room-loader-audio-suppression-catalog-2026-06-25');
  const callerCatalog = catalogById(mapData, 'world-zone-loader-caller-context-catalog-2026-06-25');
  if (!suppressionCatalog) throw new Error('Missing world-room-loader-audio-suppression-catalog-2026-06-25');
  if (!callerCatalog) throw new Error('Missing world-zone-loader-caller-context-catalog-2026-06-25');

  const unresolvedSourceCallsites = (suppressionCatalog.directCallsiteAudioSuppression?.callsites || [])
    .filter(site => site.status === 'selector_unresolved_prior_state');
  const callerByLine = new Map((callerCatalog.directCallsites || []).map(site => [Number(site.callLine), site]));
  const callsites = unresolvedSourceCallsites.map(site => {
    const richer = callerByLine.get(Number(site.callLine)) || site;
    return buildResolutionForCallsite({ ...site, ...richer }, lineChecks, {
      label108c: clearRange('_LABEL_108C_', 0xC240, 0x0800, [
        lineChecks.label108c,
        lineChecks.clear108cStart,
        lineChecks.clear108cSize,
        lineChecks.clear108cStore,
      ]),
      label10a4: clearRange('_LABEL_10A4_', 0xC280, 0x07C0, [
        lineChecks.label10a4,
        lineChecks.clear10a4Start,
        lineChecks.clear10a4Size,
      ]),
    });
  });

  const statusCounts = countBy(callsites, site => site.status);
  const unresolvedAfter = callsites.filter(site => site.remainingUnresolved);
  const resolved = callsites.filter(site => !site.remainingUnresolved);
  const evidence = [
    'This refinement starts from direct _LABEL_2620_ callsites previously marked selector_unresolved_prior_state by world-room-loader-audio-suppression-catalog-2026-06-25.',
    'ASM lines 1026 and 1032 prove the _LABEL_508_ caller executes _LABEL_108C_ before the room load; ASM lines 3325-3334 prove _LABEL_108C_ clears the range containing $C26E.',
    'ASM lines 1054-1055, 1448-1457, and 3340-3349 prove the _LABEL_3F8_ entry path reset does not clear $C26E before its literal room loads.',
    'ASM lines 20043-20100 and 11163-11167 prove the _LABEL_B3D3_ room load is entered from dynamic _RAM_CF6A_ dispatch and does not statically resolve $C26E.',
    'The audit stores labels, line numbers, offsets, region/RAM ids, counts, and evidence only; no ROM bytes, decoded assets, pixels, or audio data are embedded.',
  ];

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs,
    sourceCatalogPresence: Object.fromEntries(sourceCatalogs.map(id => [id, Boolean(catalogById(mapData, id))])),
    refinesCatalogId: suppressionCatalog.id,
    assetPolicy: 'Metadata only: ASM labels, line numbers, RAM addresses, clear ranges, region ids, descriptor ids, recipe ids, status counts, and evidence. No ROM bytes, decoded rooms, graphics, palettes, music streams, audio samples, text, pixels, or hashes are embedded.',
    selectorRam: {
      label: '_RAM_C26E_',
      address: '$C26E',
      role: 'room_loader_audio_suppression_selector',
    },
    dispatchRam: {
      label: '_RAM_CF6A_',
      address: '$CF6A',
      role: 'post-room-load_transition_dispatch_selector',
    },
    clearRanges: {
      label108c: clearRange('_LABEL_108C_', 0xC240, 0x0800, [
        lineChecks.label108c,
        lineChecks.clear108cStart,
        lineChecks.clear108cSize,
        lineChecks.clear108cStore,
      ]),
      label10a4: clearRange('_LABEL_10A4_', 0xC280, 0x07C0, [
        lineChecks.label10a4,
        lineChecks.clear10a4Start,
        lineChecks.clear10a4Size,
      ]),
    },
    callsites,
    remainingUnresolvedCallsites: unresolvedAfter.map(site => ({
      callLine: site.callLine,
      routineLabel: site.routineLabel,
      status: site.status,
      descriptorSource: site.descriptorSource,
      confidence: site.confidence,
    })),
    summary: {
      status: 'direct_room_loader_audio_selector_resolution_refined',
      confidence: 'high_for_label_508_zero_resolution_medium_for_remaining_negative_traces',
      sourceUnresolvedCallsiteCount: unresolvedSourceCallsites.length,
      refinedCallsiteCount: callsites.length,
      resolvedCallsiteCount: resolved.length,
      remainingUnresolvedCallsiteCount: unresolvedAfter.length,
      selectorZeroUnsuppressedCallsiteCount: callsites.filter(site => site.status === 'caller_clear_range_zero_unsuppressed').length,
      statusCounts,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
    },
    evidence,
    nextLeads: [
      'Trace _LABEL_3F8_ callers and pre-entry state to determine whether _RAM_C26E_ is intentionally preserved or initialized elsewhere before the gameplay entry room loads.',
      'Trace _RAM_CF6A_=1 producers from trigger records through _LABEL_497A_ and capture the associated prior _RAM_C26E_ value at _LABEL_B3D3_.',
      'Add an analyzer badge for direct room-loader audio selector state: statically zero, trigger-derived, cached/replayed, or unresolved dynamic.',
    ],
  };
}

function annotateRegion(region, key, value, annotatedRegions) {
  if (!region) return;
  region.analysis = region.analysis || {};
  region.analysis[key] = value;
  annotatedRegions.push(compactRegion(region));
}

function annotateMap(mapData, catalog) {
  const annotatedRegions = [];
  const annotatedRam = [];
  const region3f8 = containingRegion(mapData, 0x003F8);
  const region508 = containingRegion(mapData, 0x00508);
  const regionB3d3 = containingRegion(mapData, 0x0B3D3);
  const region26f4 = containingRegion(mapData, 0x026F4);
  const byRoutine = new Map();
  for (const site of catalog.callsites) {
    const list = byRoutine.get(site.routineLabel) || [];
    list.push({
      callLine: site.callLine,
      status: site.status,
      selectorHex: site.selectorHex,
      immediateAudioRequest: site.immediateAudioRequest,
      remainingUnresolved: site.remainingUnresolved,
      descriptorSource: site.descriptorSource,
      descriptorRecipeCoverage: site.descriptorRecipeCoverage,
      confidence: site.confidence,
    });
    byRoutine.set(site.routineLabel, list);
  }

  annotateRegion(region508, 'roomLoaderAudioSelectorResolutionAudit', {
    catalogId,
    kind: 'direct_room_loader_selector_zero_resolution',
    confidence: 'high',
    callsites: byRoutine.get('_LABEL_508_') || [],
    summary: '_LABEL_508_ is reached after _LABEL_108C_ clears $C240-$CA3F, so _RAM_C26E_ is zero at its _DATA_10C96_ _LABEL_2620_ call and immediate room audio is not suppressed.',
    evidence: catalog.callsites.find(site => site.callLine === 1601)?.evidence || catalog.evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);

  annotateRegion(region3f8, 'roomLoaderAudioSelectorResolutionAudit', {
    catalogId,
    kind: 'direct_room_loader_selector_prior_state_unresolved',
    confidence: 'medium',
    callsites: byRoutine.get('_LABEL_3F8_') || [],
    summary: '_LABEL_3F8_ literal room loads have reusable descriptor recipes, but the entry reset path proven here does not clear _RAM_C26E_; prior selector state remains unresolved.',
    evidence: (byRoutine.get('_LABEL_3F8_') || []).length ? catalog.callsites.find(site => site.routineLabel === '_LABEL_3F8_')?.evidence : catalog.evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);

  annotateRegion(regionB3d3, 'roomLoaderAudioSelectorResolutionAudit', {
    catalogId,
    kind: 'cf6a_dispatch_room_loader_selector_prior_state_unresolved',
    confidence: 'medium',
    callsites: byRoutine.get('_LABEL_B3D3_') || [],
    summary: '_LABEL_B3D3_ is selected by _RAM_CF6A_=1 and loads the _RAM_CFFA_ descriptor after _LABEL_10A4_; no static _RAM_C26E_ value is proven before the call.',
    evidence: catalog.callsites.find(site => site.callLine === 20100)?.evidence || catalog.evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);

  annotateRegion(region26f4, 'roomLoaderAudioSelectorResolutionAudit', {
    catalogId,
    kind: 'room_loader_audio_selector_refinement_summary',
    confidence: catalog.summary.confidence,
    summary: 'One previously unresolved direct _LABEL_2620_ room load is now proven selector-zero/unsuppressed; three direct loads remain unresolved dynamic selector-state leads.',
    statusCounts: catalog.summary.statusCounts,
    remainingUnresolvedCallsiteCount: catalog.summary.remainingUnresolvedCallsiteCount,
    evidence: catalog.evidence,
    generatedAt: now,
    tool: toolName,
  }, annotatedRegions);

  for (const [address, kind, summary] of [
    ['$C26E', 'room_loader_audio_selector_resolution_state', 'Selector state is proven zero for the _LABEL_508_ direct room load, remains unresolved before _LABEL_3F8_ literal loads and _LABEL_B3D3_ dynamic dispatch load.'],
    ['$CF6A', 'room_loader_audio_selector_dispatch_context', '_RAM_CF6A_ dispatches _LABEL_B3D3_ when set to 1; this dispatch alone does not prove the prior _RAM_C26E_ audio suppression selector.'],
  ]) {
    const entry = findRam(mapData, address);
    if (!entry) continue;
    entry.analysis = entry.analysis || {};
    entry.analysis.roomLoaderAudioSelectorResolutionAudit = {
      catalogId,
      kind,
      confidence: 'medium',
      summary,
      statusCounts: catalog.summary.statusCounts,
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotatedRam.push(compactRam(entry));
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
      type: 'room_loader_audio_selector_resolution_audit',
      schemaVersion: 1,
      generatedAt: now,
      tool: `${toolName} --apply`,
      sourceCatalogs,
      sourceCatalogPresence: catalog.sourceCatalogPresence,
      refinesCatalogId: catalog.refinesCatalogId,
      summary: {
        ...catalog.summary,
        annotatedRegionCount: annotation.annotatedRegions.length,
        annotatedRamCount: annotation.annotatedRam.length,
      },
      selectorRam: catalog.selectorRam,
      dispatchRam: catalog.dispatchRam,
      clearRanges: catalog.clearRanges,
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
    statusCounts: catalog.summary.statusCounts,
    remainingUnresolvedCallsites: catalog.remainingUnresolvedCallsites,
  }, null, 2));
}

main();
