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
const catalogId = 'world-entity-c3c0-motion-seed-family-catalog-2026-06-25';
const reportId = 'entity-c3c0-motion-seed-family-audit-2026-06-25';
const toolName = 'tools/world-entity-c3c0-motion-seed-family-audit.mjs';
const motionBehaviorCatalogId = 'world-entity-motion-delta-behavior-link-catalog-2026-06-25';
const behaviorTableTargetCatalogId = 'world-entity-behavior-table-target-catalog-2026-06-25';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function labelOffset(label) {
  const match = /^_(?:LABEL|DATA)_([0-9A-F]+)_$/i.exec(label || '');
  return match ? parseInt(match[1], 16) : null;
}

function offsetOf(region) {
  return typeof region?.offset === 'number' ? region.offset : parseInt(region?.offset || '0', 16);
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

function findContainingRegion(mapData, offset) {
  return (mapData.regions || []).find(region => {
    const start = offsetOf(region);
    return offset >= start && offset < start + (region.size || 0);
  }) || null;
}

function findCatalog(mapData, id) {
  for (const [key, value] of Object.entries(mapData)) {
    if (!Array.isArray(value) || !/catalog/i.test(key)) continue;
    const catalog = value.find(item => item?.id === id);
    if (catalog) return catalog;
  }
  return null;
}

function requireCatalog(mapData, id) {
  const catalog = findCatalog(mapData, id);
  if (!catalog) throw new Error(`Missing required catalog ${id}`);
  return catalog;
}

function cleanCode(line) {
  return line.split(';')[0].trim();
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function unique(items) {
  return [...new Set(items)].sort();
}

function buildAsmIndex(asmText) {
  const lines = asmText.split(/\r?\n/);
  const labelLines = new Map();
  for (let i = 0; i < lines.length; i++) {
    const match = /^(_(?:LABEL|DATA)_[0-9A-F]+_):/.exec(lines[i]);
    if (match) labelLines.set(match[1], i + 1);
  }
  return { lines, labelLines };
}

function labelBlock(asmIndex, label) {
  const startLine = asmIndex.labelLines.get(label);
  if (!startLine) return null;
  const lines = [];
  for (let i = startLine - 1; i < asmIndex.lines.length; i++) {
    if (i > startLine - 1 && /^_(?:LABEL|DATA)_[0-9A-F]+_:/.test(asmIndex.lines[i])) break;
    lines.push({ line: i + 1, code: cleanCode(asmIndex.lines[i]), raw: asmIndex.lines[i] });
  }
  return { label, startLine, lines };
}

function sharedTailStoresBehaviorList(asmIndex, label) {
  const block = labelBlock(asmIndex, label);
  if (!block) return false;
  const text = block.lines.map(line => line.code.toLowerCase());
  return text.some(code => /^ld\s+\(ix\+38\)\s*,\s*l$/i.test(code)) &&
    text.some(code => /^ld\s+\(ix\+39\)\s*,\s*h$/i.test(code));
}

function parseHlDataExpression(code) {
  const match = /^ld\s+hl\s*,\s*((?:_DATA_[0-9A-F]+_)(?:\s*[+-]\s*\d+)?)$/i.exec(code);
  if (!match) return null;
  const expression = match[1].replace(/\s+/g, ' ');
  const label = /_DATA_[0-9A-F]+_/i.exec(expression)?.[0] || '';
  const adjustmentMatch = /([+-])\s*(\d+)$/i.exec(expression);
  const pointerAdjustmentBytes = adjustmentMatch
    ? (adjustmentMatch[1] === '-' ? -1 : 1) * Number(adjustmentMatch[2])
    : 0;
  return { expression, label, pointerAdjustmentBytes };
}

function directBehaviorListLoads(asmIndex, label) {
  const block = labelBlock(asmIndex, label);
  if (!block) return [];
  const out = [];
  for (let i = 0; i < block.lines.length; i++) {
    const expr = parseHlDataExpression(block.lines[i].code);
    if (!expr) continue;
    let sawIx38 = false;
    let sawIx39 = false;
    let sharedTailLabel = '';
    let branchLine = null;
    let storeLine = null;
    let blockedByNextHlLoad = false;
    let sawDataLookupRst = false;
    for (let j = i + 1; j < block.lines.length && j <= i + 10; j++) {
      const code = block.lines[j].code;
      if (/^rst\s+\$0?8\b/i.test(code) || /^rst\s+\$10\b/i.test(code)) sawDataLookupRst = true;
      if (j > i + 1 && /^ld\s+hl\s*,/i.test(code)) {
        blockedByNextHlLoad = true;
        break;
      }
      if (/^ld\s+\(ix\+38\)\s*,\s*l$/i.test(code)) {
        sawIx38 = true;
        storeLine = storeLine || block.lines[j].line;
      }
      if (/^ld\s+\(ix\+39\)\s*,\s*h$/i.test(code)) {
        sawIx39 = true;
        storeLine = storeLine || block.lines[j].line;
      }
      const branch = /^jr\s+(_LABEL_[0-9A-F]+_)$/i.exec(code);
      if (!sawDataLookupRst && branch && sharedTailStoresBehaviorList(asmIndex, branch[1])) {
        sharedTailLabel = branch[1];
        branchLine = block.lines[j].line;
        break;
      }
      if (/^ret$/i.test(code)) break;
    }
    const endIndex = block.lines.length - 1;
    const nextLabelMatch = asmIndex.lines[block.startLine - 1 + block.lines.length]?.match(/^(_LABEL_[0-9A-F]+_):/);
    if (!blockedByNextHlLoad && !sawDataLookupRst && !sharedTailLabel && !(sawIx38 && sawIx39) && nextLabelMatch && sharedTailStoresBehaviorList(asmIndex, nextLabelMatch[1])) {
      sharedTailLabel = nextLabelMatch[1];
      branchLine = block.lines[endIndex]?.line || block.lines[i].line;
    }
    if (sawIx38 && sawIx39) {
      out.push({
        status: 'direct_store_to_ix38_ix39',
        expression: expr.expression,
        dataLabel: expr.label,
        dataOffset: hex(labelOffset(expr.label) || 0),
        pointerAdjustmentBytes: expr.pointerAdjustmentBytes,
        loadLine: block.lines[i].line,
        storeLine,
        sharedTailLabel: '',
        confidence: 'high',
      });
    } else if (sharedTailLabel) {
      out.push({
        status: 'shared_tail_store_to_ix38_ix39',
        expression: expr.expression,
        dataLabel: expr.label,
        dataOffset: hex(labelOffset(expr.label) || 0),
        pointerAdjustmentBytes: expr.pointerAdjustmentBytes,
        loadLine: block.lines[i].line,
        storeLine: null,
        branchLine,
        sharedTailLabel,
        confidence: expr.pointerAdjustmentBytes ? 'medium' : 'high',
      });
    }
  }
  return out;
}

function callerProvidedBehaviorLists(asmIndex, targetLabel) {
  const out = [];
  for (let i = 0; i < asmIndex.lines.length; i++) {
    const code = cleanCode(asmIndex.lines[i]);
    if (!new RegExp(`\\bjr\\s+${targetLabel}\\b`, 'i').test(code)) continue;
    let callerLabel = '';
    for (let j = i; j >= 0; j--) {
      const labelMatch = /^(_LABEL_[0-9A-F]+_):/.exec(asmIndex.lines[j]);
      if (labelMatch) {
        callerLabel = labelMatch[1];
        break;
      }
    }
    for (let j = i - 1; j >= 0 && j >= i - 6; j--) {
      const expr = parseHlDataExpression(cleanCode(asmIndex.lines[j]));
      if (!expr) continue;
      out.push({
        status: 'caller_provided_shared_tail_behavior_list',
        expression: expr.expression,
        dataLabel: expr.label,
        dataOffset: hex(labelOffset(expr.label) || 0),
        pointerAdjustmentBytes: expr.pointerAdjustmentBytes,
        callerLabel,
        loadLine: j + 1,
        branchLine: i + 1,
        sharedTailLabel: targetLabel,
        confidence: 'high',
      });
      break;
    }
  }
  return out;
}

function tableEntryIndexes(link) {
  const zeroBased = unique((link.behaviorTableLinks || [])
    .filter(item => item.tableLabel === '_DATA_668E_')
    .flatMap(item => item.entryIndexes || [])
    .map(String));
  const analysisIndexes = unique((link.sourceAnalyses || [])
    .map(item => item.tableIndex)
    .filter(item => item !== null && item !== undefined)
    .map(String));
  return {
    zeroBased: zeroBased.map(Number).sort((a, b) => a - b),
    analysisIndexes: analysisIndexes.map(Number).sort((a, b) => a - b),
  };
}

function buildSeed(mapData, asmIndex, link) {
  const offset = labelOffset(link.label);
  const region = offset == null ? null : findContainingRegion(mapData, offset);
  const directLoads = directBehaviorListLoads(asmIndex, link.label);
  const callerLoads = directLoads.length ? [] : callerProvidedBehaviorLists(asmIndex, link.label);
  const behaviorListSources = [...directLoads, ...callerLoads];
  const indexes = tableEntryIndexes(link);
  const tableRole = (link.behaviorTableLinks || []).find(item => item.tableLabel === '_DATA_668E_')?.roleKind ||
    (link.sourceAnalyses || []).find(item => item.table === '_DATA_668E_')?.kind ||
    '';
  const sourceSummary = (link.sourceAnalyses || []).find(item => item.table === '_DATA_668E_' || item.key === 'entityBehaviorTableTargetAudit')?.summary ||
    link.classification.reason;
  return {
    label: link.label,
    offset: link.offset,
    region: regionRef(region || link.region),
    table: '_DATA_668E_',
    tableEntryIndexesZeroBased: indexes.zeroBased,
    tableEntryIndexesFromAnalysis: indexes.analysisIndexes,
    tableRole,
    motionFields: link.fields,
    writerReferenceCount: link.writerReferenceCount,
    writerReferences: (link.writerReferences || []).map(ref => ({
      field: ref.field,
      line: ref.line,
      writeKind: ref.writeKind,
      instructionSummary: ref.instructionSummary,
    })),
    behaviorListSources,
    behaviorListStatus: behaviorListSources.length
      ? (callerLoads.length ? 'caller_provided_shared_tail' : 'resolved_from_initializer_block')
      : 'unresolved_behavior_list_source',
    confidence: behaviorListSources.length ? 'high' : 'medium',
    sourceSummary,
    evidence: [
      `${link.label} is classified by ${motionBehaviorCatalogId} as a C3C0 entity initializer motion seed.`,
      ...(link.writerReferences || []).slice(0, 3).map(ref => `ASM line ${ref.line}: ${ref.instructionSummary} (${ref.field}).`),
      ...behaviorListSources.slice(0, 3).map(source => source.callerLabel
        ? `ASM line ${source.loadLine}: ${source.callerLabel} loads ${source.expression} before branching to ${source.sharedTailLabel}.`
        : `ASM line ${source.loadLine}: ${link.label} loads ${source.expression} for ${source.status}.`),
      sourceSummary,
    ],
  };
}

function buildCatalog(mapData, asmText) {
  const motionBehaviorCatalog = requireCatalog(mapData, motionBehaviorCatalogId);
  requireCatalog(mapData, behaviorTableTargetCatalogId);
  const asmIndex = buildAsmIndex(asmText);
  const seeds = (motionBehaviorCatalog.writerLinks || [])
    .filter(link => link.classification?.family === 'c3c0_entity_initializer_motion_seed')
    .map(link => buildSeed(mapData, asmIndex, link))
    .sort((a, b) => (labelOffset(a.label) || 0) - (labelOffset(b.label) || 0));
  const behaviorListSources = seeds.flatMap(seed => seed.behaviorListSources.map(source => ({ ...source, seedLabel: seed.label })));
  const unresolved = seeds.filter(seed => seed.behaviorListStatus === 'unresolved_behavior_list_source');
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [motionBehaviorCatalogId, behaviorTableTargetCatalogId],
    summary: {
      seedRoutineCount: seeds.length,
      behaviorListResolvedSeedRoutineCount: seeds.filter(seed => seed.behaviorListSources.length).length,
      directInitializerBehaviorListSeedRoutineCount: seeds.filter(seed => seed.behaviorListStatus === 'resolved_from_initializer_block').length,
      callerProvidedBehaviorListSeedRoutineCount: seeds.filter(seed => seed.behaviorListStatus === 'caller_provided_shared_tail').length,
      unresolvedBehaviorListSeedRoutineCount: unresolved.length,
      behaviorListSourceCount: behaviorListSources.length,
      uniqueBehaviorListExpressionCount: unique(behaviorListSources.map(source => source.expression)).length,
      pointerAdjustmentExpressionCount: behaviorListSources.filter(source => source.pointerAdjustmentBytes !== 0).length,
      totalTableEntryReferences: seeds.reduce((sum, seed) => sum + seed.tableEntryIndexesZeroBased.length, 0),
      totalWriterReferenceCount: seeds.reduce((sum, seed) => sum + seed.writerReferenceCount, 0),
      statusCounts: countBy(seeds, seed => seed.behaviorListStatus),
      persistedRomByteCount: 0,
      persistedGameplayValueCount: 0,
      assetPolicy: 'Metadata only: C3C0 initializer labels, table indexes, behavior-list labels/expressions, line numbers, and evidence. No behavior-list bytes, ROM bytes, graphics, or gameplay tables are embedded.',
    },
    seeds,
    unresolvedSeeds: unresolved.map(seed => ({
      label: seed.label,
      offset: seed.offset,
      region: seed.region,
      tableEntryIndexesZeroBased: seed.tableEntryIndexesZeroBased,
      tableRole: seed.tableRole,
    })),
    evidence: [
      `${motionBehaviorCatalogId} supplies the C3C0 motion-delta seed routine set.`,
      `${behaviorTableTargetCatalogId} supplies _DATA_668E_ target-entry provenance.`,
      'ASM is scanned only for label/expression flow into IX+38/IX+39; behavior-list payload bytes are not copied or decoded here.',
    ],
    nextLeads: [
      'Decode behavior pointer-list entries as labels/routine targets only, without persisting list bytes.',
      'Link behavior-list labels to animation-family and room entity type usage so each motion seed can be named by actor class.',
      'Trace motion seed fields through the first update state for each behavior list to convert initializer constants into frame-step behavior.',
    ],
  };
}

function annotateRegion(region, seed) {
  if (!region) return null;
  region.analysis = region.analysis || {};
  region.analysis.c3c0MotionSeedFamilyAudit = {
    catalogId,
    kind: 'c3c0_motion_delta_seed_behavior_family',
    label: seed.label,
    confidence: seed.confidence,
    table: seed.table,
    tableEntryIndexesZeroBased: seed.tableEntryIndexesZeroBased,
    tableEntryIndexesFromAnalysis: seed.tableEntryIndexesFromAnalysis,
    tableRole: seed.tableRole,
    motionFields: seed.motionFields,
    writerReferenceCount: seed.writerReferenceCount,
    behaviorListStatus: seed.behaviorListStatus,
    behaviorListSources: seed.behaviorListSources.map(source => ({
      status: source.status,
      expression: source.expression,
      dataLabel: source.dataLabel,
      dataOffset: source.dataOffset,
      pointerAdjustmentBytes: source.pointerAdjustmentBytes,
      sharedTailLabel: source.sharedTailLabel || '',
      callerLabel: source.callerLabel || '',
      loadLine: source.loadLine,
      branchLine: source.branchLine || null,
      storeLine: source.storeLine || null,
      confidence: source.confidence,
    })),
    persistedGameplayValueCount: 0,
    summary: seed.sourceSummary,
    evidence: seed.evidence.slice(0, 6),
    generatedAt: now,
    tool: toolName,
  };
  return {
    region: regionRef(region),
    label: seed.label,
    behaviorListStatus: seed.behaviorListStatus,
    behaviorListSourceCount: seed.behaviorListSources.length,
  };
}

function applyCatalog(mapData, catalog) {
  mapData.entityBehaviorCatalogs = (mapData.entityBehaviorCatalogs || []).filter(item => item.id !== catalogId);
  mapData.entityBehaviorCatalogs.push(catalog);
  const annotatedRegions = [];
  for (const seed of catalog.seeds) {
    const offset = labelOffset(seed.label);
    const region = offset == null ? null : findContainingRegion(mapData, offset);
    const annotated = annotateRegion(region, seed);
    if (annotated) annotatedRegions.push(annotated);
  }
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'entity_c3c0_motion_seed_family_audit',
    schemaVersion: 1,
    generatedAt: now,
    tool: `${toolName} --apply`,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: {
      ...catalog.summary,
      annotatedRegions: annotatedRegions.length,
    },
    annotatedRegions,
    unresolvedSeeds: catalog.unresolvedSeeds,
    evidence: catalog.evidence,
    nextLeads: catalog.nextLeads,
  });
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData, fs.readFileSync(asmPath, 'utf8'));
  if (apply) {
    applyCatalog(mapData, catalog);
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }
  console.log(JSON.stringify({
    applied: apply,
    id: catalog.id,
    summary: catalog.summary,
    unresolvedSeeds: catalog.unresolvedSeeds,
  }, null, 2));
}

main();
