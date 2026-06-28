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
const now = '2026-06-26T00:00:00Z';
const stateCatalogId = 'world-bank2-vdp-stream-state-catalog-2026-06-25';
const catalogId = 'world-bank2-vdp-root-producer-catalog-2026-06-26';
const reportId = 'bank2-vdp-root-producer-audit-2026-06-26';
const toolName = 'tools/world-bank2-vdp-root-producer-audit.mjs';
const schemaVersion = 1;

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseHex(value) {
  if (typeof value !== 'string') return NaN;
  return parseInt(value, 16);
}

function parseHexByte(text) {
  const match = /\$([0-9A-F]{1,2})/i.exec(text || '');
  return match ? parseInt(match[1], 16) : null;
}

function parseLabelOffset(label) {
  const match = /^_LABEL_([0-9A-F]+)_$/i.exec(label || '');
  return match ? parseInt(match[1], 16) : null;
}

function countBy(items, keyFn) {
  return items.reduce((counts, item) => {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function normalizeLine(line) {
  return line.replace(/;.*/, '').trim();
}

function findRegionByOffset(mapData, offset) {
  return (mapData.regions || []).find(region => {
    const start = parseInt(region.offset, 16);
    return offset >= start && offset < start + (region.size || 0);
  }) || null;
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
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

function findBank2ExecutableWindow(lines) {
  const bankStart = lines.findIndex(line => line.includes('.BANK 2'));
  const dataStart = lines.findIndex((line, index) => index > bankStart && normalizeLine(line) === '_DATA_9AE0_:');
  return {
    start: bankStart >= 0 ? bankStart : 0,
    endExclusive: dataStart >= 0 ? dataStart : lines.length,
  };
}

function contextLinesWithinLabel(lines, index, before = 18, after = 0) {
  let start = Math.max(0, index - before);
  for (let lineIndex = index - 1; lineIndex >= start; lineIndex--) {
    if (/^_(LABEL|DATA)_[0-9A-F]+_:/i.test(normalizeLine(lines[lineIndex]))) {
      start = lineIndex + 1;
      break;
    }
  }
  let end = Math.min(lines.length - 1, index + after);
  for (let lineIndex = index + 1; lineIndex <= end; lineIndex++) {
    if (/^_(LABEL|DATA)_[0-9A-F]+_:/i.test(normalizeLine(lines[lineIndex]))) {
      end = lineIndex - 1;
      break;
    }
  }
  const out = [];
  for (let lineIndex = start; lineIndex <= end; lineIndex++) {
    const text = normalizeLine(lines[lineIndex]);
    if (text) out.push({ line: lineIndex + 1, text });
  }
  return out;
}

function nearestLabel(labels, lineIndex) {
  let found = null;
  for (const label of labels) {
    if (label.lineIndex > lineIndex) break;
    found = label;
  }
  return found;
}

function rootIndexModel(context) {
  const storeIndex = context.findIndex(item => item.text === 'ld (_RAM_D15A_), de');
  const before = storeIndex >= 0 ? context.slice(0, storeIndex) : context;
  const hasRootBase = before.some(item => item.text === 'ld hl, _DATA_9AE0_' || item.text === 'ld hl, $9AE0');
  const hasLookup = before.some(item => item.text === 'rst $08') && before.some(item => item.text === 'rst $10');
  const accumulatorSet = [...before].reverse().find(item => item.text === 'xor a' || /^ld a, \$[0-9A-F]{1,2}$/i.test(item.text));
  if (!hasRootBase || !hasLookup || !accumulatorSet) {
    return {
      kind: 'unresolved_root_table_lookup',
      values: [],
      confidence: 'low',
      hasRootBase,
      hasLookup,
    };
  }
  if (accumulatorSet.text === 'xor a') {
    return {
      kind: 'constant_root_index_zero',
      values: [0],
      confidence: 'high',
      sourceExpression: 'A=0 before _DATA_9AE0_ root-table lookup',
      hasRootBase,
      hasLookup,
    };
  }
  const value = parseHexByte(accumulatorSet.text);
  return {
    kind: 'constant_root_index_immediate',
    values: value == null ? [] : [value],
    confidence: value == null ? 'low' : 'high',
    sourceExpression: value == null ? null : `A=${hex(value, 2)} before _DATA_9AE0_ root-table lookup`,
    hasRootBase,
    hasLookup,
  };
}

function buildCatalog(mapData) {
  const stateCatalog = (mapData.vdpStreamCatalogs || []).find(catalog => catalog.id === stateCatalogId);
  if (!stateCatalog) throw new Error(`Missing state catalog ${stateCatalogId}`);

  const lines = fs.readFileSync(asmPath, 'utf8').split(/\r?\n/);
  const window = findBank2ExecutableWindow(lines);
  const labels = [];
  for (let index = window.start; index < window.endExclusive; index++) {
    const text = normalizeLine(lines[index]);
    const match = /^(_LABEL_[0-9A-F]+_):$/i.exec(text);
    if (!match) continue;
    const offset = parseLabelOffset(match[1]);
    labels.push({ label: match[1], offset, lineIndex: index, line: index + 1 });
  }

  const rootEntryByIndex = new Map((stateCatalog.rootEntries || []).map(entry => [entry.index, entry]));
  const setupByLabel = new Map((stateCatalog.setupStates || []).map(setup => [setup.label, setup]));
  const producers = [];
  for (let index = window.start; index < window.endExclusive; index++) {
    const text = normalizeLine(lines[index]);
    if (text !== 'ld (_RAM_D15A_), de') continue;
    const label = nearestLabel(labels, index);
    const context = contextLinesWithinLabel(lines, index, 18, 0);
    const model = rootIndexModel(context);
    const rootIndex = model.values.length === 1 ? model.values[0] : null;
    const rootEntry = rootIndex == null ? null : rootEntryByIndex.get(rootIndex) || null;
    const setup = label ? setupByLabel.get(label.label) || null : null;
    const labelRegion = label ? findRegionByOffset(mapData, label.offset) : null;
    producers.push({
      id: `d15a_root_producer_line_${index + 1}`,
      line: index + 1,
      kind: 'root_table_subtable_pointer_store',
      enclosingLabel: label ? {
        label: label.label,
        offset: hex(label.offset),
        line: label.line,
        region: regionRef(labelRegion),
      } : null,
      valueModel: model,
      rootIndex,
      rootEntry: rootEntry ? {
        index: rootEntry.index,
        pointerOffset: rootEntry.pointerOffset,
        z80Pointer: rootEntry.z80Pointer,
        targetOffset: rootEntry.targetOffset,
        targetWithinBundle: rootEntry.targetWithinBundle,
        setupRegion: rootEntry.setupRegion,
        targetRegion: rootEntry.targetRegion,
      } : null,
      setupState: setup ? {
        index: setup.index,
        label: setup.label,
        role: setup.role,
        region: setup.region,
      } : null,
      evidence: [
        `ASM line ${index + 1} stores DE into _RAM_D15A_.`,
        label ? `Nearest enclosing label is ${label.label} at ASM line ${label.line}.` : 'No enclosing label found in the bank-2 executable window.',
        rootIndex == null
          ? 'Root index is unresolved from the local ASM context.'
          : `Local ASM context selects _DATA_9AE0_ root-table entry ${rootIndex}.`,
      ],
    });
  }

  const modeled = producers.filter(producer => producer.rootIndex != null);
  const rootEntryCount = stateCatalog.rootEntries?.length || 0;
  const modeledRootIndexes = [...new Set(modeled.map(producer => producer.rootIndex))].sort((a, b) => a - b);
  const expectedRootIndexes = (stateCatalog.rootEntries || []).map(entry => entry.index).sort((a, b) => a - b);
  const allExpectedRootIndexesModeled = expectedRootIndexes.every(index => modeledRootIndexes.includes(index));
  const unexpectedRootIndexes = modeledRootIndexes.filter(index => !expectedRootIndexes.includes(index));

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [stateCatalogId],
    targetRam: {
      address: '$D15A',
      role: 'bank2_vdp_stream_root_subtable_pointer',
      consumer: '_LABEL_96FE_',
    },
    summary: {
      rootEntryCount,
      d15aProducerCount: producers.length,
      modeledRootProducerCount: modeled.length,
      unresolvedRootProducerCount: producers.length - modeled.length,
      modeledRootIndexes: modeledRootIndexes.map(value => hex(value, 2)),
      allExpectedRootIndexesModeled,
      unexpectedRootIndexes: unexpectedRootIndexes.map(value => hex(value, 2)),
      noUnexpectedD15AStores: producers.length === rootEntryCount && unexpectedRootIndexes.length === 0,
      rootTargetCounts: countBy(producers, producer => producer.rootEntry?.targetOffset || 'unresolved_target'),
      confidenceCounts: countBy(producers, producer => producer.valueModel.confidence),
      assetPolicy: 'Metadata only: ASM line numbers, labels, RAM roles, root-table indices, target offsets, and catalog cross-references. No ROM bytes, decoded graphics, screenshots, hashes, or asset payloads are embedded.',
    },
    producers,
    evidence: [
      `${stateCatalogId} supplies the decoded _DATA_9AE0_ root entries and setup-state labels.`,
      'The bank-2 executable window contains stores to _RAM_D15A_ immediately after _DATA_9AE0_ root-table lookup via RST $08/RST $10.',
      '_LABEL_96FE_ later consumes _RAM_D15A_ together with _RAM_D15D_ to select a state-record pointer.',
    ],
    nextLeads: [
      'Combine these root producers with the bounded _RAM_D15D_ producer catalog to build scene/root-specific state-record reachability.',
      'Use root/index coverage to reject state-record-shaped gaps that have no table entry, control-flow pointer, or raw pointer occurrence.',
      'Trace _RAM_D1AE_ scene dispatch producers if top-level scene reachability needs to be tied to room transitions.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  const bundleRegion = findRegionById(mapData, 'r0186');
  if (!bundleRegion) {
    missingRegions.push({ id: 'r0186', role: 'bank2_vdp_root_producer_context' });
  } else {
    if (apply) {
      bundleRegion.analysis = bundleRegion.analysis || {};
      bundleRegion.analysis.bank2VdpRootProducerAudit = {
        catalogId,
        kind: 'bank2_vdp_root_producer_context',
        confidence: catalog.summary.unresolvedRootProducerCount === 0 && catalog.summary.allExpectedRootIndexesModeled ? 'high' : 'medium',
        summary: 'Static producer catalog for _RAM_D15A_, the bank-2 VDP stream root-subtable pointer consumed by _LABEL_96FE_.',
        detail: {
          rootEntryCount: catalog.summary.rootEntryCount,
          d15aProducerCount: catalog.summary.d15aProducerCount,
          modeledRootProducerCount: catalog.summary.modeledRootProducerCount,
          unresolvedRootProducerCount: catalog.summary.unresolvedRootProducerCount,
          modeledRootIndexes: catalog.summary.modeledRootIndexes,
          allExpectedRootIndexesModeled: catalog.summary.allExpectedRootIndexesModeled,
          noUnexpectedD15AStores: catalog.summary.noUnexpectedD15AStores,
        },
        evidence: catalog.evidence,
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRegions.push({ id: bundleRegion.id, offset: bundleRegion.offset, type: bundleRegion.type, name: bundleRegion.name, inferredAnalysis: 'bank2VdpRootProducerAudit' });
  }

  for (const producer of catalog.producers) {
    const regionId = producer.enclosingLabel?.region?.id;
    if (!regionId) continue;
    const region = findRegionById(mapData, regionId);
    if (!region) {
      missingRegions.push({ id: regionId, role: 'bank2_vdp_root_producer_region' });
      continue;
    }
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.bank2VdpRootProducerAudit = {
        catalogId,
        kind: 'bank2_vdp_root_producer',
        confidence: producer.valueModel.confidence,
        label: producer.enclosingLabel.label,
        rootIndex: producer.rootIndex,
        rootIndexHex: producer.rootIndex == null ? null : hex(producer.rootIndex, 2),
        rootTablePointerOffset: producer.rootEntry?.pointerOffset || null,
        rootTableTargetOffset: producer.rootEntry?.targetOffset || null,
        d15aStoreLine: producer.line,
        summary: producer.rootIndex == null
          ? `${producer.enclosingLabel.label} stores _RAM_D15A_, but the local root-table index was not resolved.`
          : `${producer.enclosingLabel.label} selects _DATA_9AE0_ root-table entry ${producer.rootIndex} and stores the resulting subtable pointer in _RAM_D15A_.`,
        evidence: producer.evidence,
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRegions.push({ id: region.id, offset: region.offset, type: region.type, name: region.name, inferredAnalysis: 'bank2VdpRootProducerAudit' });
  }
  return { changedRegions, missingRegions };
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
      type: 'bank2_vdp_root_producer_audit',
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
