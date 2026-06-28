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
const toolName = 'tools/world-d16e-state-mutation-audit.mjs';
const catalogId = 'world-d16e-state-mutation-catalog-2026-06-25';
const reportId = 'd16e-state-mutation-audit-2026-06-25';

const sourceCatalogs = [
  'world-d1af-scene-completion-catalog-2026-06-25',
  'world-d1ae-transition-controller-bridge-catalog-2026-06-25',
  'world-bank2-scene-routine-catalog-2026-06-25',
];

const expectedDirectWriteLines = [
  16403, 16482, 16500, 16520, 16546,
  16730, 16905, 16916,
  17455,
  17754, 17813, 17835, 17869,
  18240, 18260,
  18700, 18723, 18788, 18818, 18840, 18875,
];

const expectedHlMutationLines = [
  16441, 16458,
  16776, 16803, 16819, 16832,
  17340, 17368, 17402, 17492,
  17695, 17793,
  18134, 18183, 18208,
];

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

function labelOffset(label) {
  const match = /^_(?:LABEL|DATA)_([0-9A-F]+)_$/i.exec(String(label || ''));
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
  if (offset == null) return null;
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

function cleanCode(line) {
  return String(line || '').split(';')[0].trim();
}

function asmLabel(line) {
  const match = /^([A-Za-z_][A-Za-z0-9_]*):$/.exec(cleanCode(line));
  return match ? match[1] : null;
}

function lineCode(lines, line) {
  return cleanCode(lines[line - 1] || '');
}

function arraysEqual(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function assertLineSet(kind, found, expected) {
  const foundSorted = found.slice().sort((a, b) => a - b);
  const expectedSorted = expected.slice().sort((a, b) => a - b);
  if (!arraysEqual(foundSorted, expectedSorted)) {
    throw new Error(`Unexpected ${kind} line coverage: found ${foundSorted.join(',')}; expected ${expectedSorted.join(',')}`);
  }
}

function buildLineLabels(lines) {
  const labels = [];
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const label = asmLabel(lines[i]);
    if (label) current = label;
    labels[i + 1] = current;
  }
  return labels;
}

function previousMeaningful(lines, startLine) {
  for (let line = startLine - 1; line >= Math.max(1, startLine - 8); line--) {
    const code = lineCode(lines, line);
    if (!code) continue;
    return { line, code, isLabel: Boolean(asmLabel(lines[line - 1])) };
  }
  return null;
}

function inferImmediateA(lines, writeLine) {
  const prev = previousMeaningful(lines, writeLine);
  if (!prev || prev.isLabel) {
    return {
      valueHex: null,
      sourceLine: prev?.line || null,
      sourceCode: prev?.code || '',
      confidence: 'unknown_or_dynamic_a',
    };
  }
  const literal = /^ld\s+a,\s*\$([0-9A-F]{1,2})$/i.exec(prev.code);
  if (literal) {
    return {
      valueHex: hex(parseInt(literal[1], 16), 2),
      sourceLine: prev.line,
      sourceCode: prev.code,
      confidence: 'high_immediate_literal',
    };
  }
  if (/^xor\s+a$/i.test(prev.code)) {
    return {
      valueHex: '0x00',
      sourceLine: prev.line,
      sourceCode: prev.code,
      confidence: 'high_xor_a_clear',
    };
  }
  return {
    valueHex: null,
    sourceLine: prev.line,
    sourceCode: prev.code,
    confidence: 'unknown_or_dynamic_a',
  };
}

function collectDirectWrites(lines, lineLabels, mapData) {
  const writes = [];
  for (let i = 0; i < lines.length; i++) {
    const line = i + 1;
    const code = lineCode(lines, line);
    if (!/^ld\s+\(_RAM_D16E_\),\s*a$/i.test(code)) continue;
    const routineLabel = lineLabels[line] || '';
    const routineOffset = labelOffset(routineLabel);
    const valueInference = inferImmediateA(lines, line);
    writes.push({
      line,
      code,
      kind: 'direct_a_write',
      routineLabel,
      routineOffset: routineOffset == null ? null : hex(routineOffset, 5),
      region: compactRegion(containingRegion(mapData, routineOffset)),
      valueHex: valueInference.valueHex,
      valueInferenceConfidence: valueInference.confidence,
      valueSourceLine: valueInference.sourceLine,
      valueSourceCode: valueInference.sourceCode,
    });
  }
  return writes;
}

function mutationFromCode(code) {
  if (/^inc\s+\(hl\)$/i.test(code)) return { kind: 'hl_increment', operation: 'inc (hl)', valueHex: null };
  if (/^dec\s+\(hl\)$/i.test(code)) return { kind: 'hl_decrement', operation: 'dec (hl)', valueHex: null };
  const literal = /^ld\s+\(hl\),\s*\$([0-9A-F]{1,2})$/i.exec(code);
  if (literal) return { kind: 'hl_literal_write', operation: 'ld (hl), literal', valueHex: hex(parseInt(literal[1], 16), 2) };
  return null;
}

function collectHlMutations(lines, lineLabels, mapData) {
  const mutations = [];
  for (let i = 0; i < lines.length; i++) {
    const setupLine = i + 1;
    if (!/^ld\s+hl,\s*_RAM_D16E_$/i.test(lineCode(lines, setupLine))) continue;
    const mutationLine = setupLine + 1;
    const mutation = mutationFromCode(lineCode(lines, mutationLine));
    if (!mutation) continue;
    const routineLabel = lineLabels[setupLine] || '';
    const routineOffset = labelOffset(routineLabel);
    mutations.push({
      setupLine,
      mutationLine,
      setupCode: lineCode(lines, setupLine),
      code: lineCode(lines, mutationLine),
      ...mutation,
      routineLabel,
      routineOffset: routineOffset == null ? null : hex(routineOffset, 5),
      region: compactRegion(containingRegion(mapData, routineOffset)),
    });
  }
  return mutations;
}

function buildSourceCatalogPresence(mapData) {
  return Object.fromEntries(sourceCatalogs.map(id => [id, Boolean(catalogById(mapData, id))]));
}

function eventSummaryForRegion(event) {
  const summary = {
    kind: event.kind,
    line: event.line || event.mutationLine,
    routineLabel: event.routineLabel,
  };
  if (event.valueHex) summary.valueHex = event.valueHex;
  if (event.valueInferenceConfidence) summary.valueInferenceConfidence = event.valueInferenceConfidence;
  if (event.setupLine) summary.setupLine = event.setupLine;
  return summary;
}

function groupEventsByRegion(events) {
  const grouped = new Map();
  for (const event of events) {
    const key = event.region?.id || `unknown:${event.routineLabel}:${event.line || event.mutationLine}`;
    if (!grouped.has(key)) grouped.set(key, { region: event.region, events: [] });
    grouped.get(key).events.push(eventSummaryForRegion(event));
  }
  return [...grouped.values()].sort((a, b) => String(a.region?.offset || '').localeCompare(String(b.region?.offset || '')));
}

function buildCatalog(mapData, asmText) {
  const lines = asmText.split(/\r?\n/);
  const lineLabels = buildLineLabels(lines);
  const directWrites = collectDirectWrites(lines, lineLabels, mapData);
  const hlMutations = collectHlMutations(lines, lineLabels, mapData);
  assertLineSet('D16E direct writes', directWrites.map(write => write.line), expectedDirectWriteLines);
  assertLineSet('D16E HL mutations', hlMutations.map(mutation => mutation.mutationLine), expectedHlMutationLines);

  const allEvents = [...directWrites, ...hlMutations];
  const groupedRegionEvents = groupEventsByRegion(allEvents);
  const directValueConfidenceCounts = directWrites.reduce((counts, write) => {
    counts[write.valueInferenceConfidence] = (counts[write.valueInferenceConfidence] || 0) + 1;
    return counts;
  }, {});
  const hlMutationKindCounts = hlMutations.reduce((counts, event) => {
    counts[event.kind] = (counts[event.kind] || 0) + 1;
    return counts;
  }, {});

  const evidence = [
    'The current ASM contains 21 direct `_RAM_D16E_` writes using `ld (_RAM_D16E_), a`; this audit records each line and only assigns a literal value when the immediately preceding meaningful instruction proves A.',
    'The current ASM contains 15 confirmed HL-based `_RAM_D16E_` mutations where `ld hl, _RAM_D16E_` is immediately followed by `inc (hl)` or `ld (hl), literal`.',
    'ASM lines 16427-16431, 16754-16758, 17262-17266, 17653-17657, 18097-18101, and 18525-18530 identify the six state dispatchers that read `_RAM_D16E_`.',
    'The shared `_LABEL_816A_` completion path is entry 0 in each state table, as cataloged by world-d1af-scene-completion-catalog-2026-06-25.',
    'Direct writes at shared scene-5 labels such as _LABEL_92DF_, _LABEL_9310_, _LABEL_9332_, and _LABEL_9369_ are intentionally marked dynamic when the value in A can arrive from multiple branch paths.',
    'This audit stores labels, offsets, line numbers, RAM names, scalar immediate values, counts, and evidence only; no ROM bytes, decoded graphics, pixels, text, timing bytes, or audio data are embedded.',
  ];

  return {
    id: catalogId,
    type: 'd16e_transition_scene_state_mutation_catalog',
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs,
    sourceCatalogPresence: buildSourceCatalogPresence(mapData),
    scope: {
      stateIndexRam: '_RAM_D16E_',
      d1afCompletionCatalog: 'world-d1af-scene-completion-catalog-2026-06-25',
      directWritePattern: 'ld (_RAM_D16E_), a',
      hlSetupPattern: 'ld hl, _RAM_D16E_',
      confirmedHlMutationPatterns: ['inc (hl)', 'ld (hl), literal'],
      indirectWritesCovered: false,
    },
    directWrites,
    hlMutations,
    groupedRegionEvents,
    summary: {
      status: 'd16e_transition_scene_state_mutations_cataloged',
      confidence: 'high_for_explicit_d16e_writes_and_immediate_hl_mutations',
      directWriteCount: directWrites.length,
      hlMutationCount: hlMutations.length,
      totalMutationEventCount: allEvents.length,
      directValueConfidenceCounts,
      hlMutationKindCounts,
      groupedRegionCount: groupedRegionEvents.length,
      indirectWritesCovered: false,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
    },
    evidence,
    nextLeads: [
      'Build per-scene D16E transition graphs by following branch targets and immediate values from these mutation events.',
      'Trace shared scene-5 branch values into _LABEL_92DF_, _LABEL_9310_, _LABEL_9332_, and _LABEL_9369_ so their dynamic writes can be split into value-specific edges.',
      'Connect D16E state transitions to D186 countdown setup to predict the exact frame on which _LABEL_816A_ writes _RAM_D1AF_=0xFF.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const annotatedRegions = [];
  const annotatedRam = [];
  const evidence = catalog.evidence;

  const eventsByRegionId = new Map();
  for (const group of catalog.groupedRegionEvents) {
    if (!group.region?.id) continue;
    eventsByRegionId.set(group.region.id, group);
  }

  for (const region of mapData.regions || []) {
    const group = eventsByRegionId.get(region.id);
    if (!group) continue;
    region.analysis = region.analysis || {};
    region.analysis.d16eStateMutationAudit = {
      catalogId,
      kind: 'd16e_state_mutation_region',
      confidence: 'high_for_explicit_mutation_lines',
      eventCount: group.events.length,
      events: group.events,
      summary: 'Region contains confirmed _RAM_D16E_ state-index mutation events used by the bank-2 transition scene state machines.',
      evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotatedRegions.push(compactRegion(region));
  }

  for (const [address, kind, summary, confidence] of [
    ['$D16E', 'transition_scene_state_index_mutation_catalog', '_RAM_D16E_ has 21 direct writes and 15 confirmed immediate HL-based mutations in the bank-2 transition scene state machines.', 'high_for_explicit_mutations'],
    ['$D1AF', 'transition_completion_consumer_of_d16e_states', '_RAM_D1AF_ completion depends on D16E state flow reaching the shared _LABEL_816A_ entry 0 handler.', 'high_for_entry_zero_model'],
    ['$D186', 'd16e_completion_countdown_input', '_RAM_D186_ is the countdown decremented by _LABEL_816A_ before it writes _RAM_D1AF_=0xFF.', 'high'],
  ]) {
    const entry = findRam(mapData, address);
    if (!entry) continue;
    entry.analysis = entry.analysis || {};
    entry.analysis.d16eStateMutationAudit = {
      catalogId,
      kind,
      confidence,
      summary,
      evidence,
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
    mapData.transitionRoutineCatalogs = (mapData.transitionRoutineCatalogs || []).filter(item => item.id !== catalogId);
    mapData.transitionRoutineCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'd16e_state_mutation_audit',
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
      scope: catalog.scope,
      directWrites: catalog.directWrites,
      hlMutations: catalog.hlMutations,
      groupedRegionEvents: catalog.groupedRegionEvents,
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
    sourceCatalogPresence: catalog.sourceCatalogPresence,
    directWritesByConfidence: catalog.summary.directValueConfidenceCounts,
    hlMutationKindCounts: catalog.summary.hlMutationKindCounts,
    dynamicDirectWriteLines: catalog.directWrites
      .filter(write => write.valueInferenceConfidence === 'unknown_or_dynamic_a')
      .map(write => ({ line: write.line, routineLabel: write.routineLabel })),
  }, null, 2));
}

main();
