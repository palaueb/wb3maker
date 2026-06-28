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
const stateCatalogId = 'world-bank2-vdp-stream-state-catalog-2026-06-25';
const rootProducerCatalogId = 'world-bank2-vdp-root-producer-catalog-2026-06-26';
const producerCatalogId = 'world-bank2-vdp-state-index-producer-catalog-2026-06-26';
const reachabilityCatalogId = 'world-bank2-vdp-state-candidate-reachability-catalog-2026-06-26';
const catalogId = 'world-bank2-vdp-state-index-coverage-catalog-2026-06-26';
const reportId = 'bank2-vdp-state-index-coverage-audit-2026-06-26';
const toolName = 'tools/world-bank2-vdp-state-index-coverage-audit.mjs';
const schemaVersion = 1;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseHex(value) {
  if (typeof value !== 'string') return NaN;
  return parseInt(value, 16);
}

function hex(n, pad = 2) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function countBy(items, keyFn) {
  return items.reduce((counts, item) => {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function findCatalog(collection, id, collectionName) {
  const catalog = (collection || []).find(item => item.id === id);
  if (!catalog) throw new Error(`Missing ${collectionName} catalog ${id}`);
  return catalog;
}

function decodedKindForRecord(record) {
  return record.decoded?.kind || record.decoded?.normalRecord?.kind || 'unknown_state_record';
}

function buildTableCoverage(table, modeledValues) {
  const modeledSet = new Set(modeledValues);
  const records = table.records || [];
  const modeledEntries = records
    .filter(record => modeledSet.has(record.index))
    .map(record => ({
      index: record.index,
      recordOffset: record.recordOffset,
      z80Pointer: record.z80Pointer,
      decodedKind: decodedKindForRecord(record),
    }));
  const unmodeledEntries = records
    .filter(record => !modeledSet.has(record.index))
    .map(record => ({
      index: record.index,
      recordOffset: record.recordOffset,
      z80Pointer: record.z80Pointer,
      decodedKind: decodedKindForRecord(record),
    }));
  const modeledValuesInRange = modeledValues.filter(index => index >= 0 && index < (table.entryCount || 0));
  return {
    rootIndex: table.rootIndex,
    tableOffset: table.tableOffset,
    entryCount: table.entryCount,
    byteLength: table.byteLength,
    modeledValuesInRange,
    modeledEntryCount: modeledEntries.length,
    unmodeledEntryCount: unmodeledEntries.length,
    firstUnmodeledEntryIndex: unmodeledEntries.length ? unmodeledEntries[0].index : null,
    modeledCoverageRatio: table.entryCount ? Number((modeledEntries.length / table.entryCount).toFixed(4)) : 0,
    modeledEntries,
    unmodeledEntrySummary: {
      count: unmodeledEntries.length,
      firstIndex: unmodeledEntries[0]?.index ?? null,
      lastIndex: unmodeledEntries[unmodeledEntries.length - 1]?.index ?? null,
      decodedKindCounts: countBy(unmodeledEntries, entry => entry.decodedKind),
    },
  };
}

function buildCatalog(mapData) {
  const stateCatalog = findCatalog(mapData.vdpStreamCatalogs, stateCatalogId, 'vdpStreamCatalogs');
  const rootProducerCatalog = findCatalog(mapData.vdpStreamRuntimeCatalogs, rootProducerCatalogId, 'vdpStreamRuntimeCatalogs');
  const producerCatalog = findCatalog(mapData.vdpStreamRuntimeCatalogs, producerCatalogId, 'vdpStreamRuntimeCatalogs');
  const reachabilityCatalog = findCatalog(mapData.vdpStreamReachabilityCatalogs, reachabilityCatalogId, 'vdpStreamReachabilityCatalogs');
  const modeledValues = (producerCatalog.summary.modeledValues || [])
    .map(parseHex)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const tables = (stateCatalog.stateRecordTables || []).map(table => buildTableCoverage(table, modeledValues));
  const modeledRecordOffsets = new Set(tables.flatMap(table => table.modeledEntries.map(entry => entry.recordOffset)));
  const allRecordOffsets = new Set((stateCatalog.stateRecordTables || []).flatMap(table => (table.records || []).map(record => record.recordOffset)));
  const candidates = (reachabilityCatalog.candidates || []).map(candidate => {
    const startOffset = candidate.range?.startOffset;
    return {
      id: candidate.id,
      startOffset,
      status: candidate.status,
      class: candidate.range?.class,
      isDecodedStateTableEntry: allRecordOffsets.has(startOffset),
      isModeledIndexEntry: modeledRecordOffsets.has(startOffset),
    };
  });
  const modeledEntryCount = tables.reduce((sum, table) => sum + table.modeledEntryCount, 0);
  const totalEntryCount = tables.reduce((sum, table) => sum + (table.entryCount || 0), 0);

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [stateCatalogId, rootProducerCatalogId, producerCatalogId, reachabilityCatalogId],
    targetRam: {
      rootPointer: rootProducerCatalog.targetRam,
      stateIndex: producerCatalog.targetRam,
    },
    summary: {
      rootTableCount: tables.length,
      rootProducerCount: rootProducerCatalog.summary.d15aProducerCount,
      modeledRootProducerCount: rootProducerCatalog.summary.modeledRootProducerCount,
      modeledRootIndexes: rootProducerCatalog.summary.modeledRootIndexes,
      rootSelectionFullyBound: rootProducerCatalog.summary.unresolvedRootProducerCount === 0
        && rootProducerCatalog.summary.allExpectedRootIndexesModeled
        && rootProducerCatalog.summary.noUnexpectedD15AStores,
      statePointerTableEntryCount: totalEntryCount,
      modeledIndexValueCount: modeledValues.length,
      modeledIndexValues: modeledValues.map(value => hex(value, 2)),
      modeledEntrySlotCount: modeledEntryCount,
      unmodeledEntrySlotCount: totalEntryCount - modeledEntryCount,
      uniqueModeledRecordOffsetCount: modeledRecordOffsets.size,
      candidateStateRecordCount: candidates.length,
      candidateStateRecordsAtDecodedTableEntries: candidates.filter(candidate => candidate.isDecodedStateTableEntry).length,
      candidateStateRecordsAtModeledIndexEntries: candidates.filter(candidate => candidate.isModeledIndexEntry).length,
      unresolvedProducerCount: producerCatalog.summary.unresolvedValueProducerCount,
      canFullyBoundRuntimeIndex: producerCatalog.summary.unresolvedValueProducerCount === 0,
      canFullyBoundRuntimeRootAndIndex: rootProducerCatalog.summary.unresolvedRootProducerCount === 0
        && rootProducerCatalog.summary.allExpectedRootIndexesModeled
        && rootProducerCatalog.summary.noUnexpectedD15AStores
        && producerCatalog.summary.unresolvedValueProducerCount === 0,
      assetPolicy: 'Metadata only: table indices, labels, offsets, inferred coverage counts, and catalog cross-references. No ROM bytes, decoded graphics, screenshots, hashes, or asset payloads are embedded.',
    },
    tables,
    candidateCrossCheck: {
      candidates,
      interpretation: 'No candidate state-record gap is currently a decoded state-table entry or a modeled root/index entry. With _RAM_D15A_ root selection and _RAM_D15D_ indices fully bounded for the audited bank-2 executable window, these candidates are not reachable through the modeled _LABEL_96FE_ state-table path.',
    },
    evidence: [
      `${stateCatalogId} supplies the six decoded bank-2 state pointer tables and their record targets.`,
      `${rootProducerCatalogId} supplies the modeled _RAM_D15A_ root-subtable selections consumed by _LABEL_96FE_.`,
      `${producerCatalogId} supplies the modeled _RAM_D15D_ state-entry index values consumed by _LABEL_96FE_/_LABEL_972B_.`,
      `${reachabilityCatalogId} supplies the state-record-shaped gap candidates that still lack confirmed table/control references.`,
    ],
    nextLeads: [
      'Treat state-record-shaped gaps with no table entry, modeled root/index entry, control-flow pointer, or raw pointer occurrence as non-reachable through the modeled bank-2 VDP state-table path.',
      'Trace _RAM_D1AE_ scene dispatch producers if top-level scene reachability needs to be tied to room transitions.',
      'Use root-table plus D15D coverage to promote or reject state-record-shaped gaps with stronger runtime evidence.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const region = (mapData.regions || []).find(item => item.id === 'r0186');
  if (!region) {
    return { changedRegions: [], missingRegions: [{ id: 'r0186', role: 'bank2_vdp_state_index_coverage_context' }] };
  }
  if (apply) {
    region.analysis = region.analysis || {};
    region.analysis.bank2VdpStateIndexCoverageAudit = {
      catalogId,
      kind: 'bank2_vdp_state_index_coverage_context',
      confidence: catalog.summary.canFullyBoundRuntimeRootAndIndex ? 'high' : 'medium',
      summary: 'Cross-links modeled _RAM_D15A_ root selections and _RAM_D15D_ state-entry index values with decoded bank-2 VDP state pointer tables.',
      detail: {
        rootTableCount: catalog.summary.rootTableCount,
        rootProducerCount: catalog.summary.rootProducerCount,
        modeledRootProducerCount: catalog.summary.modeledRootProducerCount,
        modeledRootIndexes: catalog.summary.modeledRootIndexes,
        rootSelectionFullyBound: catalog.summary.rootSelectionFullyBound,
        statePointerTableEntryCount: catalog.summary.statePointerTableEntryCount,
        modeledIndexValues: catalog.summary.modeledIndexValues,
        modeledEntrySlotCount: catalog.summary.modeledEntrySlotCount,
        unmodeledEntrySlotCount: catalog.summary.unmodeledEntrySlotCount,
        uniqueModeledRecordOffsetCount: catalog.summary.uniqueModeledRecordOffsetCount,
        candidateStateRecordsAtDecodedTableEntries: catalog.summary.candidateStateRecordsAtDecodedTableEntries,
        candidateStateRecordsAtModeledIndexEntries: catalog.summary.candidateStateRecordsAtModeledIndexEntries,
        unresolvedProducerCount: catalog.summary.unresolvedProducerCount,
        canFullyBoundRuntimeRootAndIndex: catalog.summary.canFullyBoundRuntimeRootAndIndex,
      },
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
  }
  return {
    changedRegions: [{ id: region.id, offset: region.offset, type: region.type, name: region.name, inferredAnalysis: 'bank2VdpStateIndexCoverageAudit' }],
    missingRegions: [],
  };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const annotation = annotateMap(mapData, catalog);
  if (apply) {
    mapData.vdpStreamRuntimeCatalogs = (mapData.vdpStreamRuntimeCatalogs || []).filter(item => item.id !== catalogId);
    mapData.vdpStreamRuntimeCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'bank2_vdp_state_index_coverage_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: catalog.summary,
      changedRegions: annotation.changedRegions,
      missingRegions: annotation.missingRegions,
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }
  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
  }, null, 2));
}

main();
