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
const toolName = 'tools/world-d16e-dynamic-branch-value-audit.mjs';
const catalogId = 'world-d16e-dynamic-branch-value-catalog-2026-06-25';
const reportId = 'd16e-dynamic-branch-value-audit-2026-06-25';

const sourceCatalogs = [
  'world-d16e-state-mutation-catalog-2026-06-25',
  'world-d1af-scene-completion-catalog-2026-06-25',
  'world-bank2-scene-routine-catalog-2026-06-25',
];

const dynamicTargets = [
  {
    targetLabel: '_LABEL_92DF_',
    targetOffset: 0x092DF,
    writeLine: 18788,
    resolvedValues: [
      { valueHex: '0x02', sourceKind: 'fallthrough_literal', sourceLine: 18786, branchLine: null, sourceLabel: '_LABEL_92DD_' },
      { valueHex: '0x03', sourceKind: 'local_branch_literal', sourceLine: 18808, branchLine: 18809, sourceLabel: '_LABEL_92FB_' },
      { valueHex: '0x0A', sourceKind: 'entry_branch_literal', sourceLine: 18547, branchLine: 18548, sourceLabel: '_LABEL_90EA_' },
    ],
  },
  {
    targetLabel: '_LABEL_9310_',
    targetOffset: 0x09310,
    writeLine: 18818,
    resolvedValues: [
      { valueHex: '0x04', sourceKind: 'fallthrough_literal', sourceLine: 18816, branchLine: null, sourceLabel: '_LABEL_9309_' },
      { valueHex: '0x05', sourceKind: 'local_branch_literal', sourceLine: 18830, branchLine: 18831, sourceLabel: '_LABEL_931D_' },
      { valueHex: '0x0B', sourceKind: 'entry_branch_incremented_literal', sourceLine: 18547, incrementLine: 18549, branchLine: 18550, sourceLabel: '_LABEL_90EA_' },
    ],
  },
  {
    targetLabel: '_LABEL_9332_',
    targetOffset: 0x09332,
    writeLine: 18840,
    resolvedValues: [
      { valueHex: '0x06', sourceKind: 'fallthrough_literal', sourceLine: 18838, branchLine: null, sourceLabel: '_LABEL_9330_' },
      { valueHex: '0x07', sourceKind: 'local_branch_literal', sourceLine: 18865, branchLine: 18866, sourceLabel: '_LABEL_9354_' },
      { valueHex: '0x0C', sourceKind: 'entry_branch_literal', sourceLine: 18554, branchLine: 18555, sourceLabel: '_LABEL_90EA_' },
    ],
  },
  {
    targetLabel: '_LABEL_9369_',
    targetOffset: 0x09369,
    writeLine: 18875,
    resolvedValues: [
      { valueHex: '0x08', sourceKind: 'fallthrough_literal', sourceLine: 18873, branchLine: null, sourceLabel: '_LABEL_9362_' },
      { valueHex: '0x09', sourceKind: 'local_branch_literal', sourceLine: 18885, branchLine: 18886, sourceLabel: '_LABEL_9371_' },
      { valueHex: '0x0D', sourceKind: 'entry_branch_incremented_literal', sourceLine: 18554, incrementLine: 18556, branchLine: 18557, sourceLabel: '_LABEL_90EA_' },
    ],
  },
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

function lineCode(lines, line) {
  return cleanCode(lines[line - 1] || '');
}

function expectLine(lines, line, expected) {
  const code = lineCode(lines, line);
  if (!code.includes(expected)) {
    throw new Error(`ASM invariant failed at line ${line}: expected "${expected}", got "${code}"`);
  }
  return { line, code, expected };
}

function buildLineChecks(lines) {
  return {
    scene5EntryLabel: expectLine(lines, 18533, '_LABEL_90EA_:'),
    scene5Load0a: expectLine(lines, 18547, 'ld a, $0A'),
    scene5Jump92df: expectLine(lines, 18548, 'jp nc, _LABEL_92DF_'),
    scene5Increment0a: expectLine(lines, 18549, 'inc a'),
    scene5Jump9310: expectLine(lines, 18550, 'jp _LABEL_9310_'),
    scene5Load0c: expectLine(lines, 18554, 'ld a, $0C'),
    scene5Jump9332: expectLine(lines, 18555, 'jp z, _LABEL_9332_'),
    scene5Increment0c: expectLine(lines, 18556, 'inc a'),
    scene5Jump9369: expectLine(lines, 18557, 'jp _LABEL_9369_'),

    label92dd: expectLine(lines, 18785, '_LABEL_92DD_:'),
    load02: expectLine(lines, 18786, 'ld a, $02'),
    label92df: expectLine(lines, 18787, '_LABEL_92DF_:'),
    write92df: expectLine(lines, 18788, 'ld (_RAM_D16E_), a'),
    load03: expectLine(lines, 18808, 'ld a, $03'),
    jump92df: expectLine(lines, 18809, 'jr _LABEL_92DF_'),

    load04: expectLine(lines, 18816, 'ld a, $04'),
    label9310: expectLine(lines, 18817, '_LABEL_9310_:'),
    write9310: expectLine(lines, 18818, 'ld (_RAM_D16E_), a'),
    load05: expectLine(lines, 18830, 'ld a, $05'),
    jump9310: expectLine(lines, 18831, 'jr _LABEL_9310_'),

    label9330: expectLine(lines, 18837, '_LABEL_9330_:'),
    load06: expectLine(lines, 18838, 'ld a, $06'),
    label9332: expectLine(lines, 18839, '_LABEL_9332_:'),
    write9332: expectLine(lines, 18840, 'ld (_RAM_D16E_), a'),
    load07: expectLine(lines, 18865, 'ld a, $07'),
    jump9332: expectLine(lines, 18866, 'jr _LABEL_9332_'),

    load08: expectLine(lines, 18873, 'ld a, $08'),
    label9369: expectLine(lines, 18874, '_LABEL_9369_:'),
    write9369: expectLine(lines, 18875, 'ld (_RAM_D16E_), a'),
    load09: expectLine(lines, 18885, 'ld a, $09'),
    jump9369: expectLine(lines, 18886, 'jr _LABEL_9369_'),
  };
}

function buildSourceCatalogPresence(mapData) {
  return Object.fromEntries(sourceCatalogs.map(id => [id, Boolean(catalogById(mapData, id))]));
}

function buildCatalog(mapData, asmText) {
  const lines = asmText.split(/\r?\n/);
  const lineChecks = buildLineChecks(lines);
  const stateMutationCatalog = catalogById(mapData, 'world-d16e-state-mutation-catalog-2026-06-25');
  const dynamicLines = new Set((stateMutationCatalog?.directWrites || [])
    .filter(write => write.valueInferenceConfidence === 'unknown_or_dynamic_a')
    .map(write => Number(write.line)));
  const expectedDynamicLines = dynamicTargets.map(target => target.writeLine);
  for (const line of expectedDynamicLines) {
    if (!dynamicLines.has(line)) {
      throw new Error(`Expected line ${line} to be dynamic in world-d16e-state-mutation-catalog-2026-06-25`);
    }
  }

  const targets = dynamicTargets.map(target => ({
    ...target,
    targetOffset: hex(target.targetOffset, 5),
    targetRegion: compactRegion(containingRegion(mapData, target.targetOffset)),
    resolvedValueCount: target.resolvedValues.length,
    resolvedValueSet: target.resolvedValues.map(value => value.valueHex),
  }));

  const evidence = [
    'world-d16e-state-mutation-catalog-2026-06-25 intentionally marked lines 18788, 18818, 18840, and 18875 dynamic because the value in A can arrive from multiple branch paths.',
    'ASM lines 18547-18550 route 0x0A to _LABEL_92DF_ or increment it to 0x0B before _LABEL_9310_.',
    'ASM lines 18554-18557 route 0x0C to _LABEL_9332_ or increment it to 0x0D before _LABEL_9369_.',
    'ASM lines 18785-18809 prove _LABEL_92DF_ writes _RAM_D16E_ with values 0x02, 0x03, or 0x0A depending on the incoming path.',
    'ASM lines 18816-18831 prove _LABEL_9310_ writes _RAM_D16E_ with values 0x04, 0x05, or 0x0B depending on the incoming path.',
    'ASM lines 18837-18866 prove _LABEL_9332_ writes _RAM_D16E_ with values 0x06, 0x07, or 0x0C depending on the incoming path.',
    'ASM lines 18873-18886 prove _LABEL_9369_ writes _RAM_D16E_ with values 0x08, 0x09, or 0x0D depending on the incoming path.',
    'This audit stores labels, offsets, line numbers, RAM names, scalar immediate values, counts, and evidence only; no ROM bytes, decoded graphics, pixels, text, timing bytes, or audio data are embedded.',
  ];

  return {
    id: catalogId,
    type: 'd16e_dynamic_branch_value_resolution',
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs,
    sourceCatalogPresence: buildSourceCatalogPresence(mapData),
    scope: {
      stateIndexRam: '_RAM_D16E_',
      sceneIndex: 5,
      sceneController: '_LABEL_901B_',
      stateDispatcher: '_LABEL_90C6_',
      stateTable: '_DATA_90CA_',
      resolvedDynamicWriteLines: expectedDynamicLines,
    },
    lineChecks,
    targets,
    summary: {
      status: 'd16e_dynamic_branch_values_resolved',
      confidence: 'high_for_listed_branch_edges',
      resolvedWriteLineCount: targets.length,
      resolvedIncomingEdgeCount: targets.reduce((sum, target) => sum + target.resolvedValueCount, 0),
      resolvedValueCount: new Set(targets.flatMap(target => target.resolvedValueSet)).size,
      unresolvedDynamicWriteCountAfterThisAudit: Math.max(0, dynamicLines.size - targets.length),
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
    },
    evidence,
    nextLeads: [
      'Convert these scene-5 dynamic value sets into explicit D16E state graph edges with branch predicates once _LABEL_941F_/_LABEL_9444_/_LABEL_9472_/_LABEL_9491_/_LABEL_949F_/_LABEL_94BF_/_LABEL_94EB_/_LABEL_951A_ predicates are named.',
      'Use resolved values 0x02-0x0D to verify _DATA_90CA_ state-table target coverage for the finale transition scene.',
      'Trace writes to _RAM_D15D_, _RAM_D156_, and _RAM_D158_ in these target blocks to model scene-5 movement direction and velocity setup.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const annotatedRegions = [];
  const annotatedRam = [];
  const evidence = catalog.evidence;

  for (const target of catalog.targets) {
    const region = containingRegion(mapData, parseHex(target.targetOffset));
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.d16eDynamicBranchValueAudit = {
      catalogId,
      kind: 'd16e_dynamic_write_value_resolution',
      confidence: 'high_for_listed_branch_edges',
      writeLine: target.writeLine,
      resolvedValueSet: target.resolvedValueSet,
      resolvedValues: target.resolvedValues,
      summary: `${target.targetLabel} writes _RAM_D16E_ with one of ${target.resolvedValueSet.join(', ')} depending on incoming scene-5 branch path.`,
      evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotatedRegions.push(compactRegion(region));
  }

  const sceneEntryRegion = containingRegion(mapData, 0x090EA);
  if (sceneEntryRegion) {
    sceneEntryRegion.analysis = sceneEntryRegion.analysis || {};
    sceneEntryRegion.analysis.d16eDynamicBranchValueAudit = {
      catalogId,
      kind: 'd16e_scene5_entry_branch_source',
      confidence: 'high',
      summary: '_LABEL_90EA_ supplies high transition-state values 0x0A, 0x0B, 0x0C, and 0x0D to the shared scene-5 D16E write labels.',
      evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotatedRegions.push(compactRegion(sceneEntryRegion));
  }

  const ram = findRam(mapData, '$D16E');
  if (ram) {
    ram.analysis = ram.analysis || {};
    ram.analysis.d16eDynamicBranchValueAudit = {
      catalogId,
      kind: 'scene5_dynamic_state_value_resolution',
      confidence: 'high_for_listed_branch_edges',
      summary: 'The four previously dynamic scene-5 _RAM_D16E_ write sites are resolved into 12 explicit incoming value edges covering values 0x02-0x0D.',
      evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotatedRam.push(compactRam(ram));
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
      type: 'd16e_dynamic_branch_value_audit',
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
      targets: catalog.targets,
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
    targets: catalog.targets.map(target => ({
      targetLabel: target.targetLabel,
      writeLine: target.writeLine,
      resolvedValueSet: target.resolvedValueSet,
    })),
  }, null, 2));
}

main();
