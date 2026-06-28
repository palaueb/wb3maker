#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-player-form-state-matrix-audit.mjs';
const catalogId = 'world-player-form-state-matrix-catalog-2026-06-26';
const reportId = 'player-form-state-matrix-audit-2026-06-26';
const schemaVersion = 1;

const sourceCatalogIds = {
  playerState: 'world-player-state-catalog-2026-06-24',
  stateGraph: 'world-player-engine-state-graph-catalog-2026-06-25',
  statePhysicsFlow: 'world-player-state-physics-flow-catalog-2026-06-25',
  ramTraceSeeds: 'world-runtime-ram-trace-seed-catalog-2026-06-26',
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items || []) {
    const key = keyFn(item);
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function catalogById(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === id);
    if (found) return found;
  }
  return null;
}

function requireCatalog(mapData, id) {
  const catalog = catalogById(mapData, id);
  if (!catalog) throw new Error(`Missing required catalog: ${id}`);
  return catalog;
}

function normalizeAddress(address) {
  return String(address || '').toUpperCase().replace(/^0X/, '$');
}

function findRamEntry(mapData, address) {
  const normalized = normalizeAddress(address);
  return (mapData.ram || []).find(entry => normalizeAddress(entry.address) === normalized) || null;
}

function findRegion(mapData, regionId) {
  return (mapData.regions || []).find(region => region.id === regionId) || null;
}

function compactRegion(region) {
  if (!region) return null;
  return {
    id: region.id,
    offset: region.offset,
    size: region.size || 0,
    type: region.type || '',
    name: region.name || '',
    confidence: region.confidence || null,
  };
}

function flowIndex(graphCatalog, flowCatalog) {
  const byPrimary = new Map();
  const byComponent = new Map();
  const byId = new Map();
  for (const node of graphCatalog.nodes || []) {
    byId.set(node.id, node);
    if (node.primaryLabel) byPrimary.set(node.primaryLabel, node);
    for (const label of node.componentLabels || []) {
      if (!byComponent.has(label)) byComponent.set(label, []);
      byComponent.get(label).push(node);
    }
  }

  const flowById = new Map((flowCatalog.flows || []).map(flow => [flow.flowId, flow]));
  return { byPrimary, byComponent, byId, flowById };
}

function resolveFlow(targetLabel, indexes) {
  if (!targetLabel) return null;
  const primary = indexes.byPrimary.get(targetLabel);
  if (primary) return { node: primary, matchKind: 'primary_label' };
  const componentMatches = indexes.byComponent.get(targetLabel) || [];
  if (componentMatches.length === 1) return { node: componentMatches[0], matchKind: 'component_label' };
  if (componentMatches.length > 1) {
    return {
      node: null,
      matchKind: 'ambiguous_component_label',
      candidateFlowIds: componentMatches.map(node => node.id),
    };
  }
  return null;
}

function compactFlow(node, flow, matchKind) {
  if (!node) return null;
  return {
    flowId: node.id,
    matchKind,
    primaryLabel: node.primaryLabel || '',
    mechanicGroup: node.mechanicGroup || '',
    physicsCategories: node.physicsCategories || [],
    transitionTargets: node.transitionTargets || [],
    inputDriven: Boolean(node.inputDriven),
    contactDriven: Boolean(node.contactDriven),
    environmentFlagDriven: Boolean(node.environmentFlagDriven),
    transitionWriteCount: node.transitionWriteCount || 0,
    motionWriteCount: (node.motionWrites || []).length,
    physicsCallCount: (flow?.physicsCalls || []).length,
  };
}

function buildOuterRows(stateCatalog) {
  return (stateCatalog.outerTable?.entries || []).map(entry => ({
    outerIndex: entry.index,
    selectorValue: `0x${entry.index.toString(16).toUpperCase().padStart(2, '0')}`,
    callerLabel: stateCatalog.outerTable.callerLabel,
    targetLabel: entry.targetLabel,
    targetRegion: entry.targetRegion || null,
    innerTableLabel: (stateCatalog.innerTables || []).find(table => table.outerIndex === entry.index)?.label || null,
    isNull: Boolean(entry.isNull),
  }));
}

function buildMatrixRows(stateCatalog, indexes) {
  const rows = [];
  for (const table of stateCatalog.innerTables || []) {
    for (const entry of table.entries || []) {
      const resolved = resolveFlow(entry.targetLabel, indexes);
      const flow = resolved?.node ? indexes.flowById.get(resolved.node.id) : null;
      rows.push({
        outerIndex: table.outerIndex,
        outerSelectorRam: stateCatalog.outerTable?.selectorRam || '_RAM_C24F_',
        innerStateSlot: entry.index,
        normalizedC260Value: `0x${entry.index.toString(16).toUpperCase().padStart(2, '0')}`,
        entryFlagC260Value: `0x${(entry.index | 0x80).toString(16).toUpperCase().padStart(2, '0')}`,
        innerSelectorRam: table.selectorRam,
        innerSelectorMask: table.selectorMask,
        innerTableLabel: table.label,
        innerTableOffset: table.offset,
        callerLabel: table.callerLabel,
        pointerOffset: entry.pointerOffset,
        targetLabel: entry.targetLabel,
        targetRegion: entry.targetRegion || null,
        isNull: Boolean(entry.isNull),
        resolvedFlow: resolved?.node ? compactFlow(resolved.node, flow, resolved.matchKind) : null,
        unresolvedReason: entry.isNull ? 'null_dispatch_entry'
          : resolved?.matchKind === 'ambiguous_component_label' ? 'ambiguous_component_label'
            : resolved ? null : 'target_not_present_in_player_state_graph',
        candidateFlowIds: resolved?.candidateFlowIds || [],
      });
    }
  }
  return rows;
}

function buildAmbiguousSlotResolution(graphCatalog, matrixRows) {
  const slotCounts = countBy((graphCatalog.nodes || []).filter(node => Number.isInteger(node.stateSlot)), node => String(node.stateSlot));
  const ambiguousSlots = Object.entries(slotCounts)
    .filter(([, count]) => count > 1)
    .map(([slot]) => Number(slot))
    .sort((a, b) => a - b);

  return ambiguousSlots.map(slot => {
    const rows = matrixRows.filter(row => row.innerStateSlot === slot);
    return {
      stateSlot: slot,
      candidateFlowIds: Array.from(new Set(rows.map(row => row.resolvedFlow?.flowId).filter(Boolean))).sort(),
      byOuterIndex: rows.map(row => ({
        outerIndex: row.outerIndex,
        targetLabel: row.targetLabel,
        flowId: row.resolvedFlow?.flowId || null,
        isNull: row.isNull,
        confidence: row.resolvedFlow ? 'high_table_target_match' : 'unresolved',
      })),
    };
  });
}

function buildFlowCoverage(graphCatalog, matrixRows) {
  const represented = new Set(matrixRows.map(row => row.resolvedFlow?.flowId).filter(Boolean));
  const innerNodes = (graphCatalog.nodes || []).filter(node => Number.isInteger(node.stateSlot));
  return {
    representedFlowCount: represented.size,
    representedFlowIds: Array.from(represented).sort(),
    unrepresentedInnerFlowIds: innerNodes.filter(node => !represented.has(node.id)).map(node => node.id).sort(),
    vectorSubstateFlowIds: (graphCatalog.nodes || [])
      .filter(node => node.mechanicGroup === 'vector_substate')
      .map(node => node.id)
      .sort(),
  };
}

function buildCatalog(mapData) {
  const stateCatalog = requireCatalog(mapData, sourceCatalogIds.playerState);
  const graphCatalog = requireCatalog(mapData, sourceCatalogIds.stateGraph);
  const flowCatalog = requireCatalog(mapData, sourceCatalogIds.statePhysicsFlow);
  requireCatalog(mapData, sourceCatalogIds.ramTraceSeeds);

  const indexes = flowIndex(graphCatalog, flowCatalog);
  const outerRows = buildOuterRows(stateCatalog);
  const matrixRows = buildMatrixRows(stateCatalog, indexes);
  const concreteRows = matrixRows.filter(row => !row.isNull);
  const unresolvedRows = matrixRows.filter(row => row.unresolvedReason && row.unresolvedReason !== 'null_dispatch_entry');
  const nullRows = matrixRows.filter(row => row.isNull);
  const ambiguousSlotResolution = buildAmbiguousSlotResolution(graphCatalog, matrixRows);
  const flowCoverage = buildFlowCoverage(graphCatalog, matrixRows);
  const invalidOuterSelectorValues = ['0x06', '0x07'];

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogIds: Object.values(sourceCatalogIds),
    assetPolicy: 'Metadata only: dispatch table labels, offsets, region ids, selector RAM labels, handler labels, flow ids, counts, and evidence references. No ROM bytes, instruction bytes, decoded graphics, pixels, screenshots, gameplay tables, text payloads, audio payloads, or hashes are embedded.',
    selectionRule: {
      source: 'world-player-state-catalog outer/inner dispatch tables plus world-player-engine-state-graph flow nodes.',
      purpose: 'Resolve _RAM_C24F_ outer form context and _RAM_C260_ inner state slots into concrete handler/flow targets for future frame traces.',
      limitation: 'This is a static dispatch matrix. It does not prove which values are reachable at runtime without a frame trace.',
    },
    dispatchModel: {
      outerSelectorRam: stateCatalog.outerTable?.selectorRam || '_RAM_C24F_',
      outerSelectorMask: stateCatalog.outerTable?.selectorMask || '$07',
      modeledOuterSelectorValues: outerRows.map(row => row.selectorValue),
      invalidOrUnmodeledOuterSelectorValues: invalidOuterSelectorValues,
      innerSelectorRam: '_RAM_C260_',
      innerSelectorMask: '$0F',
      c260EntryFlagInterpretation: 'Inner dispatch masks _RAM_C260_ with $0F; values with bit 7 set dispatch to the same low-nibble slot and are tracked as entryFlagC260Value.',
    },
    summary: {
      outerDispatcherCount: outerRows.length,
      innerTableCount: (stateCatalog.innerTables || []).length,
      matrixRowCount: matrixRows.length,
      concreteMatrixRowCount: concreteRows.length,
      nullMatrixRowCount: nullRows.length,
      unresolvedConcreteRowCount: unresolvedRows.length,
      ambiguousStateSlotCount: ambiguousSlotResolution.length,
      ambiguousStateSlots: ambiguousSlotResolution.map(item => item.stateSlot),
      representedInnerFlowCount: flowCoverage.representedFlowCount,
      unrepresentedInnerFlowCount: flowCoverage.unrepresentedInnerFlowIds.length,
      matrixRowsByOuterIndex: countBy(matrixRows, row => String(row.outerIndex)),
      concreteRowsByMechanicGroup: countBy(concreteRows, row => row.resolvedFlow?.mechanicGroup || 'unresolved'),
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
      persistedGameplayTableByteCount: 0,
    },
    outerRows,
    matrixRows,
    ambiguousSlotResolution,
    flowCoverage,
    evidence: [
      'world-player-state-catalog-2026-06-24 supplies the _DATA_4770_ outer table and six _RAM_C260_ inner dispatch tables with ASM line evidence.',
      'world-player-engine-state-graph-catalog-2026-06-25 supplies flow ids, mechanic groups, physics categories, and previously ambiguous transition targets.',
      'world-player-state-physics-flow-catalog-2026-06-25 supplies flow components, transition writes, physics calls, and RAM accesses.',
      'world-runtime-ram-trace-seed-catalog-2026-06-26 marks _RAM_C24F_ and _RAM_C260_ as priority frame-trace seeds.',
    ],
    nextLeads: [
      'Run a frame trace that records _RAM_C24F_, _RAM_C260_, target handler label, and transition writes every frame.',
      'Use the matrix to resolve state-slot 3 and state-slot 8 ambiguity before translating player-state dispatch to JavaScript.',
      'Confirm whether masked _RAM_C24F_ values 6 and 7 are unreachable, aliases, or invalid states.',
    ],
  };
}

function reportSample(catalog) {
  return {
    summary: catalog.summary,
    ambiguousSlotResolution: catalog.ambiguousSlotResolution,
    firstRows: catalog.matrixRows.slice(0, 12).map(row => ({
      outerIndex: row.outerIndex,
      innerStateSlot: row.innerStateSlot,
      targetLabel: row.targetLabel,
      flowId: row.resolvedFlow?.flowId || null,
      mechanicGroup: row.resolvedFlow?.mechanicGroup || null,
      isNull: row.isNull,
    })),
  };
}

function applyCatalog(mapData, catalog) {
  mapData.playerCatalogs = (mapData.playerCatalogs || []).filter(item => item.id !== catalogId);
  mapData.playerCatalogs.push(catalog);

  const ramC24f = findRamEntry(mapData, '$C24F');
  const ramC260 = findRamEntry(mapData, '$C260');
  for (const [ramEntry, role] of [[ramC24f, 'outer_form_dispatch_selector'], [ramC260, 'inner_state_dispatch_selector']]) {
    if (!ramEntry) continue;
    ramEntry.analysis = ramEntry.analysis || {};
    ramEntry.analysis.playerFormStateMatrixAudit = {
      catalogId,
      kind: role,
      confidence: 'high',
      summary: role === 'outer_form_dispatch_selector'
        ? '_RAM_C24F_ selects one of six modeled outer player dispatchers before _RAM_C260_ selects the inner state handler.'
        : '_RAM_C260_ low nibble selects the concrete inner player state handler within the current _RAM_C24F_ outer dispatcher.',
      dispatchModel: catalog.dispatchModel,
      generatedAt: now,
      tool: toolName,
    };
  }

  const stateCatalog = catalogById(mapData, sourceCatalogIds.playerState);
  const tableRegions = [
    stateCatalog?.outerTable?.region,
    ...(stateCatalog?.innerTables || []).map(table => table.region),
  ].filter(Boolean);
  for (const tableRegion of tableRegions) {
    const region = findRegion(mapData, tableRegion.id);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.playerFormStateMatrixAudit = {
      catalogId,
      kind: tableRegion.id === stateCatalog.outerTable?.region?.id ? 'outer_player_dispatch_table' : 'inner_player_state_dispatch_table',
      confidence: 'high',
      summary: 'Dispatch table participates in the _RAM_C24F_/_RAM_C260_ player form-state matrix.',
      generatedAt: now,
      tool: toolName,
    };
  }

  mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'player_form_state_matrix_audit',
    generatedAt: now,
    tool: `${toolName} --apply`,
    schemaVersion,
    catalogId,
    sourceCatalogIds: catalog.sourceCatalogIds,
    summary: catalog.summary,
    sample: reportSample(catalog),
    assetPolicy: catalog.assetPolicy,
    nextLeads: catalog.nextLeads,
  });
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  if (apply) {
    applyCatalog(mapData, catalog);
    fs.writeFileSync(mapPath, `${JSON.stringify(mapData, null, 2)}\n`);
  }
  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    reportId,
    summary: catalog.summary,
    sample: reportSample(catalog),
  }, null, 2));
}

main();
