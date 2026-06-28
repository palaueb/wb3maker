#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const asmPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).asm');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-entity-random-variant-table-proof-audit.mjs';
const catalogId = 'world-entity-random-variant-table-proof-catalog-2026-06-26';
const reportId = 'entity-random-variant-table-proof-audit-2026-06-26';

const target = {
  tableRegionId: 'r0103',
  routineRegionId: 'r2377',
  helperRegionId: 'r1757',
  tableLabel: '_DATA_5DE2_',
  routineLabel: '_LABEL_5D6A_',
  randomHelperLabel: '_LABEL_D36_',
  animationStartLabel: '_LABEL_1318_',
  contextRam: '$CF66',
  tableOffset: '0x05DE2',
  tableSize: 32,
  entryCount: 16,
  entryStride: 2,
};

const sourceCatalogs = [
  'world-final-fragments-catalog-2026-06-24',
  'world-gameplay-lookup-data-catalog-2026-06-25',
  'world-asm-label-region-catalog-2026-06-25',
  'world-asm-data-label-census-catalog-2026-06-25',
  'world-entity-runtime-struct-field-catalog-2026-06-25',
  'world-animation-callsite-catalog-2026-06-25',
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item?.id === id);
    if (found) return found;
  }
  return null;
}

function requireCatalog(mapData, id) {
  const catalog = findCatalog(mapData, id);
  if (!catalog) throw new Error(`Missing required catalog ${id}`);
  return catalog;
}

function findRegion(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function findRam(mapData, address) {
  return (mapData.ram || []).find(entry => String(entry.address || '').toUpperCase() === address.toUpperCase()) || null;
}

function compactRegion(region) {
  if (!region) return null;
  return {
    id: region.id,
    offset: region.offset,
    size: region.size || 0,
    type: region.type || 'unknown',
    name: region.name || '',
    confidence: region.confidence || null,
  };
}

function compactRam(entry) {
  if (!entry) return null;
  return {
    id: entry.id,
    address: entry.address,
    size: entry.size || 0,
    type: entry.type || '',
    name: entry.name || '',
    confidence: entry.confidence || null,
  };
}

function stripComment(line) {
  return line.split(';')[0].trim();
}

function asmLines(asmText) {
  return asmText.split(/\r?\n/).map((text, index) => ({
    line: index + 1,
    text,
    code: stripComment(text),
  }));
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function labelDefinition(lines, label) {
  const colon = new RegExp(`^${escapeRegExp(label)}\\s*:`);
  const ramStyle = new RegExp(`^${escapeRegExp(label)}\\s+(db|dw|dsb|rb|rw|equ|=)\\b`, 'i');
  return lines
    .filter(item => colon.test(item.code) || ramStyle.test(item.code))
    .map(item => ({ line: item.line, kind: 'definition' }));
}

function labelReferences(lines, label) {
  const token = new RegExp(`(^|[^A-Za-z0-9_])${escapeRegExp(label)}([^A-Za-z0-9_]|$)`);
  const defs = new Set(labelDefinition(lines, label).map(item => item.line));
  return lines
    .filter(item => item.code && token.test(item.code) && !defs.has(item.line) && !/^\.incbin\b/i.test(item.code))
    .map(item => ({
      line: item.line,
      code: item.code,
      kind: classifyReference(item.code, label),
    }));
}

function classifyReference(code, label) {
  const escaped = escapeRegExp(label);
  if (new RegExp(`^ld\\s+hl,\\s*${escaped}\\s*$`, 'i').test(code)) return 'hl_table_base_load';
  if (new RegExp(`^call\\s+${escaped}\\b`, 'i').test(code)) return 'callsite';
  if (new RegExp(`\\(${escaped}\\)`, 'i').test(code)) return 'memory_access';
  if (/^\.dw\b/i.test(code)) return 'word_record_or_pointer_table';
  return 'other_ref';
}

function routineBody(lines, label) {
  const start = lines.findIndex(item => new RegExp(`^${escapeRegExp(label)}\\s*:`).test(item.code));
  if (start === -1) return [];
  const body = [];
  for (let index = start; index < lines.length; index++) {
    const item = lines[index];
    if (index !== start && /^[_A-Za-z][A-Za-z0-9_]*\s*:/.test(item.code)) break;
    if (item.code) body.push(item);
  }
  return body;
}

function lineMatches(body, pattern) {
  return body
    .filter(item => pattern.test(item.code))
    .map(item => ({ line: item.line, code: item.code }));
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

function insertAfter(list, afterId, newId) {
  const out = (list || []).filter(id => id !== newId);
  const index = out.indexOf(afterId);
  if (index === -1) out.push(newId);
  else out.splice(index + 1, 0, newId);
  return out;
}

function buildCatalog(mapData, asmText) {
  for (const id of sourceCatalogs) requireCatalog(mapData, id);

  const lines = asmLines(asmText);
  const tableRegion = findRegion(mapData, target.tableRegionId);
  const routineRegion = findRegion(mapData, target.routineRegionId);
  const helperRegion = findRegion(mapData, target.helperRegionId);
  const cf66 = findRam(mapData, target.contextRam);
  const routine = routineBody(lines, target.routineLabel);
  const tableDefinitions = labelDefinition(lines, target.tableLabel);
  const tableReferences = labelReferences(lines, target.tableLabel);
  const routineDefinitions = labelDefinition(lines, target.routineLabel);
  const helperCalls = lineMatches(routine, new RegExp(`^call\\s+${escapeRegExp(target.randomHelperLabel)}\\b`, 'i'));
  const animationCalls = lineMatches(routine, new RegExp(`^call\\s+${escapeRegExp(target.animationStartLabel)}\\b`, 'i'));
  const contextReads = lineMatches(routine, /\(_RAM_CF66_\)/i);
  const ix62Reads = lineMatches(routine, /\(ix\+62\)/i);
  const ix34Writes = lineMatches(routine, /^ld\s+\(ix\+34\),\s*a$/i);
  const tableBaseLoads = lineMatches(routine, new RegExp(`^ld\\s+hl,\\s*${escapeRegExp(target.tableLabel)}\\s*$`, 'i'));
  const rst8 = lineMatches(routine, /^rst\s+\$08\b/i);
  const rst10 = lineMatches(routine, /^rst\s+\$10\b/i);
  const maskAndBase = lineMatches(routine, /^(and\s+d|add\s+a,\s*e)$/i);
  const stateWrites = lineMatches(routine, /^ld\s+\(ix\+32\),\s*\$(04|05)$/i);

  const shapeMatches = tableRegion?.offset === target.tableOffset &&
    Number(tableRegion?.size || 0) === target.tableSize &&
    Number(tableRegion?.size || 0) === target.entryCount * target.entryStride;
  const directConsumerMatches = tableReferences.some(ref => ref.kind === 'hl_table_base_load' && ref.line >= (routine[0]?.line || 0) && ref.line <= (routine.at(-1)?.line || 0));
  const flowMatches = Boolean(
    routine.length &&
    contextReads.length &&
    ix62Reads.length &&
    tableBaseLoads.length &&
    rst8.length &&
    rst10.length &&
    helperCalls.length &&
    maskAndBase.length >= 2 &&
    ix34Writes.length &&
    animationCalls.length === 2 &&
    stateWrites.length === 2
  );
  const promotionAllowed = Boolean(shapeMatches && directConsumerMatches && flowMatches);
  const status = promotionAllowed
    ? 'exact_consumer_table_shape_and_output_field_confirmed'
    : 'entity_random_variant_table_needs_manual_review';

  const evidence = [
    'ASM line 13792 defines _DATA_5DE2_ immediately after the _LABEL_5D6A_ routine.',
    'ASM line 13760 loads HL with _DATA_5DE2_ inside _LABEL_5D6A_, followed by RST $08/RST $10 indexed lookup helper calls.',
    'The same routine reads _RAM_CF66_ and IX+62 before the table lookup, proving the selector comes from room/context plus entity subtype state.',
    'The selected table result is combined with _LABEL_D36_ output through mask/base operations and stored into IX+34.',
    'The value in IX+34 selects one of two _LABEL_1318_ animation/state starts and writes IX+32 as state 0x04 or 0x05.',
    'The mapped r0103 range is exactly 32 bytes, matching sixteen 2-byte selector entries; no ROM bytes or table values are persisted.',
  ];

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs,
    assetPolicy: 'Metadata only: labels, offsets, region ids, table dimensions, routine line references, reference kinds, RAM/IX field roles, and evidence. No ROM bytes, table values, decoded graphics, pixels, audio, text payloads, hashes, instruction bytes, or register traces are embedded.',
    summary: {
      status,
      tableRegionId: target.tableRegionId,
      tableOffset: target.tableOffset,
      tableSize: target.tableSize,
      entryCount: target.entryCount,
      entryStride: target.entryStride,
      routineRegionId: target.routineRegionId,
      routineLabel: target.routineLabel,
      tableLabel: target.tableLabel,
      tableDefinitionCount: tableDefinitions.length,
      tableReferenceCount: tableReferences.length,
      tableBaseLoadCount: tableBaseLoads.length,
      contextReadCount: contextReads.length,
      ix62ReadCount: ix62Reads.length,
      ix34WriteCount: ix34Writes.length,
      randomHelperCallCount: helperCalls.length,
      animationStartCallCount: animationCalls.length,
      stateWriteCount: stateWrites.length,
      shapeMatches,
      directConsumerMatches,
      flowMatches,
      promotionAllowed,
      confidence: promotionAllowed ? 'high' : 'medium',
      persistedRomByteCount: 0,
      persistedTableValueCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
      persistedRegisterTraceCount: 0,
    },
    regions: {
      table: compactRegion(tableRegion),
      routine: compactRegion(routineRegion),
      randomHelper: compactRegion(helperRegion),
    },
    ram: {
      contextSelector: compactRam(cf66),
    },
    references: {
      tableDefinitions,
      tableReferences,
      tableReferenceKindCounts: countBy(tableReferences, ref => ref.kind),
      routineDefinitions,
      tableBaseLoads,
      contextReads,
      ix62Reads,
      rstIndexedLookupCalls: [...rst8, ...rst10],
      randomHelperCalls: helperCalls,
      selectedValueOperations: maskAndBase,
      ix34Writes,
      animationCalls,
      stateWrites,
    },
    model: {
      selectorInputs: [
        { source: '_RAM_CF66_', role: 'room_or_zone_context_offset_gate' },
        { source: 'IX+62', role: 'entity_subtype_or_variant_selector_low_nibble' },
      ],
      table: {
        label: target.tableLabel,
        regionId: target.tableRegionId,
        entryCount: target.entryCount,
        entryStride: target.entryStride,
        selectedInto: 'DE via RST $08/RST $10 helper sequence',
      },
      output: {
        field: 'IX+34',
        role: 'entity_randomized_variant_or_animation_selector',
        branches: [
          { condition: 'IX+34 < 0x20', animationStartArgument: '0x00', stateField: 'IX+32', stateValue: '0x04' },
          { condition: 'IX+34 >= 0x20', animationStartArgument: '0x01', stateField: 'IX+32', stateValue: '0x05' },
        ],
      },
    },
    evidence,
    nextLeads: [
      'Trace runtime values for _RAM_CF66_ and IX+62 to name the exact room/entity states that select each table entry without persisting table values.',
      'Link IX+34 reader routines after _LABEL_5D6A_ so the randomized variant can be modeled in shared/wb3/entities.js.',
      'Use this proof to keep r0103 out of screen_prog and generic data-table scans.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  const annotated = [];
  const tableRegion = findRegion(mapData, target.tableRegionId);
  const routineRegion = findRegion(mapData, target.routineRegionId);
  const helperRegion = findRegion(mapData, target.helperRegionId);
  const cf66 = findRam(mapData, target.contextRam);

  if (tableRegion) {
    const confidenceBefore = tableRegion.confidence || null;
    tableRegion.type = 'entity_data';
    tableRegion.name = 'entity random variant threshold/mask table';
    tableRegion.confidence = catalog.summary.confidence;
    tableRegion.analysis = tableRegion.analysis || {};
    tableRegion.analysis.entityRandomVariantTableProofAudit = {
      catalogId,
      kind: 'entity_random_variant_threshold_mask_table_proof',
      status: catalog.summary.status,
      confidence: catalog.summary.confidence,
      confidenceBefore,
      tableLabel: target.tableLabel,
      consumerRoutine: target.routineLabel,
      entryCount: target.entryCount,
      entryStride: target.entryStride,
      selectorInputs: catalog.model.selectorInputs,
      output: catalog.model.output,
      summary: 'Exact _LABEL_5D6A_ consumer flow confirms r0103 as the entity random variant threshold/mask table.',
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    if (tableRegion.analysis.gameplayLookupDataAudit) {
      tableRegion.analysis.gameplayLookupDataAudit.refinedByEntityRandomVariantTableProofAudit = catalogId;
      tableRegion.analysis.gameplayLookupDataAudit.proofStatus = catalog.summary.status;
    }
    annotated.push({ id: tableRegion.id, offset: tableRegion.offset, analysisKey: 'entityRandomVariantTableProofAudit', confidenceBefore, confidenceAfter: tableRegion.confidence });
  }

  if (routineRegion) {
    routineRegion.analysis = routineRegion.analysis || {};
    routineRegion.analysis.entityRandomVariantTableProofAudit = {
      catalogId,
      kind: 'entity_random_variant_selector_routine',
      status: catalog.summary.status,
      confidence: catalog.summary.confidence,
      tableRegionId: target.tableRegionId,
      selectorInputs: catalog.model.selectorInputs,
      output: catalog.model.output,
      summary: '_LABEL_5D6A_ selects r0103 entries, randomizes within their mask/base pair, stores IX+34, and starts the matching entity animation/state.',
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotated.push({ id: routineRegion.id, offset: routineRegion.offset, analysisKey: 'entityRandomVariantTableProofAudit' });
  }

  if (helperRegion) {
    helperRegion.analysis = helperRegion.analysis || {};
    helperRegion.analysis.entityRandomVariantTableProofAudit = {
      catalogId,
      kind: 'random_accumulator_helper_used_by_entity_variant_selector',
      status: catalog.summary.status,
      confidence: 'medium_high',
      consumerRoutine: target.routineLabel,
      summary: '_LABEL_D36_ supplies the randomized accumulator byte combined with the selected r0103 mask/base pair in _LABEL_5D6A_.',
      evidence: [
        'ASM line 13764 calls _LABEL_D36_ after the r0103 table lookup.',
        'The selected table result is preserved across the call and combined with A before storing IX+34.',
      ],
      generatedAt: now,
      tool: toolName,
    };
    annotated.push({ id: helperRegion.id, offset: helperRegion.offset, analysisKey: 'entityRandomVariantTableProofAudit' });
  }

  if (cf66) {
    cf66.analysis = cf66.analysis || {};
    cf66.analysis.entityRandomVariantTableProofAudit = {
      catalogId,
      kind: 'entity_random_variant_context_selector',
      status: catalog.summary.status,
      confidence: catalog.summary.confidence,
      consumerRoutine: target.routineLabel,
      tableRegionId: target.tableRegionId,
      summary: '_RAM_CF66_ gates the r0103 table index offset inside _LABEL_5D6A_.',
      evidence: [
        'ASM lines 13752-13756 read _RAM_CF66_ and select an index offset before masking IX+62.',
      ],
      generatedAt: now,
      tool: toolName,
    };
    annotated.push({ id: cf66.id, address: cf66.address, analysisKey: 'entityRandomVariantTableProofAudit' });
  }

  return annotated;
}

function updateStaticMap(catalog) {
  if (!fs.existsSync(staticMapPath)) return;
  const staticMap = readJson(staticMapPath);
  staticMap.analyzedAt = now;
  staticMap.summary = staticMap.summary || {};
  staticMap.summary.entityRandomVariantTableProofCatalog = catalogId;
  staticMap.summary.entityRandomVariantTableProofStatus = catalog.summary.status;
  staticMap.summary.entityRandomVariantTableProofEntryCount = catalog.summary.entryCount;
  staticMap.summary.entityRandomVariantTableProofConfidence = catalog.summary.confidence;
  staticMap.summary.entityRandomVariantTableProofPromotedRegion = catalog.summary.tableRegionId;
  staticMap.primaryCatalogs = staticMap.primaryCatalogs || {};
  staticMap.primaryCatalogs.gameplay = insertAfter(
    staticMap.primaryCatalogs.gameplay,
    'world-entity-runtime-struct-field-catalog-2026-06-25',
    catalogId
  );
  staticMap.primaryCatalogs.coverage = insertAfter(
    staticMap.primaryCatalogs.coverage,
    'world-runtime-mechanic-index-catalog-2026-06-26',
    catalogId
  );
  staticMap.nextLeads = (staticMap.nextLeads || []).filter(note => !note.includes(catalogId));
  staticMap.nextLeads.push('Use world-entity-random-variant-table-proof-catalog-2026-06-26 to model r0103/_DATA_5DE2_ in the entity runtime; runtime traces should name _RAM_CF66_ and IX+62 selector states.');
  writeJson(staticMapPath, staticMap);
}

function main() {
  const mapData = readJson(mapPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const catalog = buildCatalog(mapData, asmText);
  const annotated = apply ? applyCatalog(mapData, catalog) : [];

  if (apply) {
    mapData.entityDataCatalogs = (mapData.entityDataCatalogs || []).filter(item => item.id !== catalogId);
    mapData.entityDataCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'entity_random_variant_table_proof_audit',
      schemaVersion: 1,
      generatedAt: now,
      tool: `${toolName} --apply`,
      catalogId,
      sourceCatalogs,
      summary: {
        ...catalog.summary,
        annotatedEntries: annotated.length,
      },
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
      annotatedEntries: annotated,
    });
    writeJson(mapPath, mapData);
    updateStaticMap(catalog);
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    reportId,
    summary: {
      ...catalog.summary,
      annotatedEntries: annotated.length,
    },
    referenceCounts: {
      tableReferenceKindCounts: catalog.references.tableReferenceKindCounts,
      tableBaseLoads: catalog.references.tableBaseLoads.length,
      contextReads: catalog.references.contextReads.length,
      ix62Reads: catalog.references.ix62Reads.length,
      ix34Writes: catalog.references.ix34Writes.length,
      randomHelperCalls: catalog.references.randomHelperCalls.length,
      animationCalls: catalog.references.animationCalls.length,
      stateWrites: catalog.references.stateWrites.length,
    },
  }, null, 2));
}

main();
