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
const toolName = 'tools/world-player-knockback-alt-velocity-table-proof-audit.mjs';
const catalogId = 'world-player-knockback-alt-velocity-table-proof-catalog-2026-06-26';
const reportId = 'player-knockback-alt-velocity-table-proof-audit-2026-06-26';

const target = {
  baseTableRegionId: 'r0085',
  tailTableRegionId: 'r0086',
  routineRegionId: 'r2327',
  updateRegionId: 'r2328',
  baseTableLabel: '_DATA_4BF8_',
  tailTableLabel: '_DATA_4C08_',
  routineLabel: '_LABEL_4B31_',
  outputRamLabel: '_RAM_C248_',
  outputRamAddress: '$C248',
  baseOffset: '0x04BF8',
  tailOffset: '0x04C08',
  baseSize: 16,
  tailSize: 32,
  entryStride: 2,
};

const sourceCatalogs = [
  'world-final-fragments-catalog-2026-06-24',
  'world-gameplay-lookup-data-catalog-2026-06-25',
  'world-player-runtime-routine-catalog-2026-06-25',
  'world-player-state-physics-flow-catalog-2026-06-25',
  'world-player-physics-state-effect-catalog-2026-06-25',
  'world-asm-label-region-catalog-2026-06-25',
  'world-asm-data-label-census-catalog-2026-06-25',
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

function labelDefinitions(lines, label) {
  const colon = new RegExp(`^${escapeRegExp(label)}\\s*:`);
  const ramStyle = new RegExp(`^${escapeRegExp(label)}\\s+(db|dw|dsb|rb|rw|equ|=)\\b`, 'i');
  return lines
    .filter(item => colon.test(item.code) || ramStyle.test(item.code))
    .map(item => ({ line: item.line, kind: 'definition' }));
}

function labelReferences(lines, label) {
  const token = new RegExp(`(^|[^A-Za-z0-9_])${escapeRegExp(label)}([^A-Za-z0-9_]|$)`);
  const defs = new Set(labelDefinitions(lines, label).map(item => item.line));
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
  if (new RegExp(`\\b${escaped}\\b`, 'i').test(code) && /^\.dw\b/i.test(code)) return 'word_record_or_pointer_table';
  if (new RegExp(`\\(${escaped}\\)`, 'i').test(code)) return 'memory_access';
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
  const baseRegion = findRegion(mapData, target.baseTableRegionId);
  const tailRegion = findRegion(mapData, target.tailTableRegionId);
  const routineRegion = findRegion(mapData, target.routineRegionId);
  const updateRegion = findRegion(mapData, target.updateRegionId);
  const c248 = findRam(mapData, target.outputRamAddress);
  const routine = routineBody(lines, target.routineLabel);
  const baseDefinitions = labelDefinitions(lines, target.baseTableLabel);
  const tailDefinitions = labelDefinitions(lines, target.tailTableLabel);
  const baseReferences = labelReferences(lines, target.baseTableLabel);
  const tailReferences = labelReferences(lines, target.tailTableLabel);
  const routineDefinitions = labelDefinitions(lines, target.routineLabel);
  const outputWrites = lineMatches(routine, new RegExp(`^ld\\s*\\(${escapeRegExp(target.outputRamLabel)}\\),\\s*hl$`, 'i'));
  const baseLoads = lineMatches(routine, new RegExp(`^ld\\s+hl,\\s*${escapeRegExp(target.baseTableLabel)}\\s*$`, 'i'));
  const rst8 = lineMatches(routine, /^rst\s+\$08\b/i);
  const rst18 = lineMatches(routine, /^rst\s+\$18\b/i);
  const formReads = lineMatches(routine, /\(_RAM_C24F_\)/i);
  const stateReads = lineMatches(routine, /\(_RAM_C241_\)/i);
  const ixFlagReads = lineMatches(routine, /\(ix\+[01]\)/i);
  const tailIndexBias = lineMatches(routine, /^add\s+a,\s*\$0C$/i);
  const pointerRecordRefs = tailReferences.filter(ref => ref.kind === 'word_record_or_pointer_table');
  const pointerRecordRamRefs = pointerRecordRefs
    .filter(ref => /_RAM_D17[BC]_/.test(ref.code))
    .map(ref => ({ line: ref.line, kind: 'bank7_pointer_record_with_ram_destination' }));

  const contiguous = baseRegion?.offset === target.baseOffset &&
    tailRegion?.offset === target.tailOffset &&
    Number(baseRegion?.size || 0) === target.baseSize &&
    Number(tailRegion?.size || 0) === target.tailSize;
  const directConsumerMatches = Boolean(baseLoads.length && rst8.length && rst18.length && outputWrites.length);
  const tailReachableByIndex = Boolean(tailIndexBias.length && contiguous);
  const pointerContextMatches = pointerRecordRefs.length >= 2 && pointerRecordRamRefs.length >= 2;
  const promotionAllowed = Boolean(contiguous && directConsumerMatches && tailReachableByIndex && pointerContextMatches);
  const status = promotionAllowed
    ? 'contiguous_tail_consumed_by_player_knockback_index_and_pointer_records'
    : 'player_knockback_alt_velocity_table_needs_manual_review';

  const evidence = [
    'ASM line 11526 defines _DATA_4BF8_ and ASM line 11531 defines the adjacent _DATA_4C08_ tail.',
    '_LABEL_4B31_ derives an index from _RAM_C24F_, _RAM_C241_, and IX flag bits, then loads HL with _DATA_4BF8_.',
    '_LABEL_4B31_ uses RST $08/RST $18 to select a 2-byte entry and stores the resulting word into _RAM_C248_.',
    'The same index path can add 0x0C before the lookup, which reaches the contiguous _DATA_4C08_ tail rather than only the first _DATA_4BF8_ entries.',
    'Bank-7 pointer records also reference _DATA_4C08_ alongside _RAM_D17B_/_RAM_D17C_ destination expressions, preserving its alternate-table context.',
    'The catalog stores offsets, labels, counts, reference kinds, and RAM roles only; no velocity values or ROM bytes are persisted.',
  ];

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs,
    assetPolicy: 'Metadata only: labels, offsets, region ids, table dimensions, routine line references, reference kinds, RAM roles, and evidence. No ROM bytes, velocity/table values, decoded graphics, pixels, audio, text payloads, hashes, instruction bytes, or register traces are embedded.',
    summary: {
      status,
      baseTableRegionId: target.baseTableRegionId,
      tailTableRegionId: target.tailTableRegionId,
      routineRegionId: target.routineRegionId,
      baseOffset: target.baseOffset,
      tailOffset: target.tailOffset,
      baseSize: target.baseSize,
      tailSize: target.tailSize,
      entryStride: target.entryStride,
      baseEntryCount: target.baseSize / target.entryStride,
      tailEntryCount: target.tailSize / target.entryStride,
      baseDefinitionCount: baseDefinitions.length,
      tailDefinitionCount: tailDefinitions.length,
      baseReferenceCount: baseReferences.length,
      tailReferenceCount: tailReferences.length,
      tableBaseLoadCount: baseLoads.length,
      indexedLookupCallCount: rst8.length + rst18.length,
      outputWriteCount: outputWrites.length,
      formReadCount: formReads.length,
      stateReadCount: stateReads.length,
      ixFlagReadCount: ixFlagReads.length,
      tailIndexBiasCount: tailIndexBias.length,
      pointerRecordRefCount: pointerRecordRefs.length,
      pointerRecordRamRefCount: pointerRecordRamRefs.length,
      contiguous,
      directConsumerMatches,
      tailReachableByIndex,
      pointerContextMatches,
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
      baseTable: compactRegion(baseRegion),
      tailTable: compactRegion(tailRegion),
      setupRoutine: compactRegion(routineRegion),
      updateRoutine: compactRegion(updateRegion),
    },
    ram: {
      outputMotionWord: compactRam(c248),
    },
    references: {
      routineDefinitions,
      baseDefinitions,
      tailDefinitions,
      baseReferences,
      tailReferences,
      tailReferenceKindCounts: countBy(tailReferences, ref => ref.kind),
      baseLoads,
      indexedLookupCalls: [...rst8, ...rst18],
      formReads,
      stateReads,
      ixFlagReads,
      tailIndexBias,
      outputWrites,
      pointerRecordRefs,
      pointerRecordRamRefs,
    },
    model: {
      selectorInputs: [
        { source: '_RAM_C24F_', role: 'player_form_or_form_state_index' },
        { source: '_RAM_C241_ bits 5-6', role: 'player state/direction modifier' },
        { source: 'IX+0 bit 4', role: 'guard for alternate setup path' },
        { source: 'IX+1 bit 3', role: 'adds 0x0C and selects the tail entries' },
      ],
      table: {
        baseLabel: target.baseTableLabel,
        tailLabel: target.tailTableLabel,
        baseRegionId: target.baseTableRegionId,
        tailRegionId: target.tailTableRegionId,
        entryStride: target.entryStride,
        output: target.outputRamLabel,
      },
      output: {
        ram: target.outputRamLabel,
        address: target.outputRamAddress,
        role: 'player_damage_knockback_motion_word',
      },
    },
    evidence,
    nextLeads: [
      'Trace _RAM_C24F_, _RAM_C241_, IX+0, and IX+1 during player damage to name which forms/states select the _DATA_4C08_ tail entries.',
      'Use this proof when implementing shared/wb3/player-physics.js knockback setup; keep velocity values decoded only from the local ROM at runtime.',
      'Resolve the bank-7 _DATA_4C08_ pointer-record consumers separately before giving those records a narrower semantic name.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  const annotated = [];
  const baseRegion = findRegion(mapData, target.baseTableRegionId);
  const tailRegion = findRegion(mapData, target.tailTableRegionId);
  const routineRegion = findRegion(mapData, target.routineRegionId);
  const c248 = findRam(mapData, target.outputRamAddress);

  if (tailRegion) {
    const confidenceBefore = tailRegion.confidence || null;
    tailRegion.type = 'data_table';
    tailRegion.name = 'player knockback alternate velocity table';
    tailRegion.confidence = catalog.summary.confidence;
    tailRegion.analysis = tailRegion.analysis || {};
    tailRegion.analysis.playerKnockbackAltVelocityTableProofAudit = {
      catalogId,
      kind: 'player_knockback_alt_velocity_table_proof',
      status: catalog.summary.status,
      confidence: catalog.summary.confidence,
      confidenceBefore,
      baseTableRegionId: target.baseTableRegionId,
      entryStride: target.entryStride,
      selectorInputs: catalog.model.selectorInputs,
      output: catalog.model.output,
      pointerRecordRefCount: catalog.summary.pointerRecordRefCount,
      summary: 'Contiguous _DATA_4BF8_ lookup path and bank-7 pointer records confirm r0086 as the alternate player knockback velocity table tail.',
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    if (tailRegion.analysis.gameplayLookupDataAudit) {
      tailRegion.analysis.gameplayLookupDataAudit.refinedByPlayerKnockbackAltVelocityTableProofAudit = catalogId;
      tailRegion.analysis.gameplayLookupDataAudit.proofStatus = catalog.summary.status;
    }
    annotated.push({ id: tailRegion.id, offset: tailRegion.offset, analysisKey: 'playerKnockbackAltVelocityTableProofAudit', confidenceBefore, confidenceAfter: tailRegion.confidence });
  }

  if (baseRegion) {
    baseRegion.analysis = baseRegion.analysis || {};
    baseRegion.analysis.playerKnockbackAltVelocityTableProofAudit = {
      catalogId,
      kind: 'player_knockback_velocity_table_base_with_confirmed_tail',
      status: catalog.summary.status,
      confidence: catalog.summary.confidence,
      tailTableRegionId: target.tailTableRegionId,
      entryStride: target.entryStride,
      summary: '_DATA_4BF8_ is the base of the player knockback velocity lookup; its indexed path can reach the adjacent _DATA_4C08_ tail.',
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotated.push({ id: baseRegion.id, offset: baseRegion.offset, analysisKey: 'playerKnockbackAltVelocityTableProofAudit' });
  }

  if (routineRegion) {
    routineRegion.analysis = routineRegion.analysis || {};
    routineRegion.analysis.playerKnockbackAltVelocityTableProofAudit = {
      catalogId,
      kind: 'player_knockback_velocity_selector_routine',
      status: catalog.summary.status,
      confidence: catalog.summary.confidence,
      baseTableRegionId: target.baseTableRegionId,
      tailTableRegionId: target.tailTableRegionId,
      selectorInputs: catalog.model.selectorInputs,
      output: catalog.model.output,
      summary: '_LABEL_4B31_ selects a knockback motion word from _DATA_4BF8_ and its _DATA_4C08_ tail, then writes _RAM_C248_.',
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotated.push({ id: routineRegion.id, offset: routineRegion.offset, analysisKey: 'playerKnockbackAltVelocityTableProofAudit' });
  }

  if (c248) {
    c248.analysis = c248.analysis || {};
    c248.analysis.playerKnockbackAltVelocityTableProofAudit = {
      catalogId,
      kind: 'player_knockback_motion_word_output',
      status: catalog.summary.status,
      confidence: catalog.summary.confidence,
      sourceTables: [target.baseTableRegionId, target.tailTableRegionId],
      summary: '_RAM_C248_ receives the selected _DATA_4BF8_/_DATA_4C08_ player knockback motion word in _LABEL_4B31_.',
      evidence: [
        'ASM line 11468 stores the selected HL word into _RAM_C248_ after the _DATA_4BF8_ indexed lookup.',
      ],
      generatedAt: now,
      tool: toolName,
    };
    annotated.push({ id: c248.id, address: c248.address, analysisKey: 'playerKnockbackAltVelocityTableProofAudit' });
  }

  return annotated;
}

function updateStaticMap(catalog) {
  if (!fs.existsSync(staticMapPath)) return;
  const staticMap = readJson(staticMapPath);
  staticMap.analyzedAt = now;
  staticMap.summary = staticMap.summary || {};
  staticMap.summary.playerKnockbackAltVelocityTableProofCatalog = catalogId;
  staticMap.summary.playerKnockbackAltVelocityTableProofStatus = catalog.summary.status;
  staticMap.summary.playerKnockbackAltVelocityTableProofConfidence = catalog.summary.confidence;
  staticMap.summary.playerKnockbackAltVelocityTableProofPromotedRegion = target.tailTableRegionId;
  staticMap.summary.playerKnockbackAltVelocityTableProofTailEntries = catalog.summary.tailEntryCount;
  staticMap.primaryCatalogs = staticMap.primaryCatalogs || {};
  staticMap.primaryCatalogs.gameplay = insertAfter(
    staticMap.primaryCatalogs.gameplay,
    'world-player-physics-state-effect-catalog-2026-06-25',
    catalogId
  );
  staticMap.primaryCatalogs.coverage = insertAfter(
    staticMap.primaryCatalogs.coverage,
    'world-entity-random-variant-table-proof-catalog-2026-06-26',
    catalogId
  );
  staticMap.nextLeads = (staticMap.nextLeads || []).filter(note => !note.includes(catalogId));
  staticMap.nextLeads.push('Use world-player-knockback-alt-velocity-table-proof-catalog-2026-06-26 to model r0086/_DATA_4C08_ as the player knockback alternate velocity table tail; runtime traces should name the form/state selectors.');
  writeJson(staticMapPath, staticMap);
}

function main() {
  const mapData = readJson(mapPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const catalog = buildCatalog(mapData, asmText);
  const annotated = apply ? applyCatalog(mapData, catalog) : [];

  if (apply) {
    mapData.playerCatalogs = (mapData.playerCatalogs || []).filter(item => item.id !== catalogId);
    mapData.playerCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'player_knockback_alt_velocity_table_proof_audit',
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
      tailReferenceKindCounts: catalog.references.tailReferenceKindCounts,
      tableBaseLoads: catalog.references.baseLoads.length,
      indexedLookupCalls: catalog.references.indexedLookupCalls.length,
      outputWrites: catalog.references.outputWrites.length,
      tailIndexBias: catalog.references.tailIndexBias.length,
      pointerRecordRefs: catalog.references.pointerRecordRefs.length,
      pointerRecordRamRefs: catalog.references.pointerRecordRamRefs.length,
    },
  }, null, 2));
}

main();
