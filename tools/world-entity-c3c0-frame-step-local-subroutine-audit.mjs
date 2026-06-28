#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-25T00:00:00Z';
const catalogId = 'world-entity-c3c0-frame-step-local-subroutine-catalog-2026-06-25';
const reportId = 'entity-c3c0-frame-step-local-subroutine-audit-2026-06-25';
const toolName = 'tools/world-entity-c3c0-frame-step-local-subroutine-audit.mjs';

const sourceCatalogIds = {
  helperGap: 'world-entity-c3c0-frame-step-helper-gap-catalog-2026-06-25',
  frameStepSeed: 'world-entity-c3c0-frame-step-seed-catalog-2026-06-25',
  runtimeStruct: 'world-entity-runtime-struct-field-catalog-2026-06-25',
};

const localDefinitions = [
  {
    offset: 0x06F96,
    label: '_LOCAL_6F96_',
    role: 'entity_state0_entry_animation_timer_helper',
    behaviorStateIndex: 0,
    sourceTargetOffset: '0x06F88',
    confidence: 'high',
    fieldRefs: ['IX+0', 'IX+32', 'IX+33'],
    calls: ['_LABEL_1318_', '_LABEL_1330_'],
    summary: 'State-local helper that marks the state as initialized, starts/ticks animation, seeds the timer/age counter, and updates a slot flag from that timer path.',
    evidence: [
      'world-entity-c3c0-frame-step-helper-gap-catalog-2026-06-25 records 0x06F88 calling local target 0x06F96 inside the same behavior segment.',
      'Local opcode scan of 0x06F96-0x06FC2 references IX+0, IX+32, IX+33 and calls _LABEL_1318_ followed by _LABEL_1330_; no instruction byte stream is persisted.',
      'world-entity-runtime-struct-field-catalog-2026-06-25 identifies IX+32 as behavior_state and IX+33 as timer_age_counter.',
    ],
  },
  {
    offset: 0x078B7,
    label: '_LOCAL_78B7_',
    role: 'entity_state4_signed_x_velocity_seed_helper',
    behaviorStateIndex: 4,
    sourceTargetOffset: '0x0789B',
    confidence: 'high',
    fieldRefs: ['IX+8', 'IX+9', 'IX+17', 'IX+32', 'IX+40', 'IX+41'],
    calls: [],
    summary: 'State-local helper that marks the state as initialized and seeds horizontal velocity from IX+40/IX+41, with sign selected from the IX+17 facing-direction field.',
    evidence: [
      'world-entity-c3c0-frame-step-helper-gap-catalog-2026-06-25 records 0x0789B calling local target 0x078B7 inside the same behavior segment.',
      'Local opcode scan of 0x078B7 references IX+32, IX+40/IX+41, IX+17, and IX+8/IX+9; no instruction byte stream is persisted.',
      'world-entity-runtime-struct-field-catalog-2026-06-25 identifies IX+8/IX+9 as horizontal_velocity_word and IX+17 as facing_direction.',
    ],
  },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseHex(value) {
  if (typeof value === 'number') return value;
  const match = /^0x([0-9A-F]+)$/i.exec(String(value || ''));
  return match ? parseInt(match[1], 16) : null;
}

function hex(value, width = 5) {
  return `0x${Number(value || 0).toString(16).toUpperCase().padStart(width, '0')}`;
}

function offsetOf(region) {
  return typeof region?.offset === 'number' ? region.offset : parseHex(region?.offset) || 0;
}

function findContainingRegion(mapData, offset) {
  return (mapData.regions || []).find(region => {
    const start = offsetOf(region);
    return offset >= start && offset < start + Number(region.size || 0);
  }) || null;
}

function regionRef(region) {
  if (!region) return null;
  return {
    id: region.id || '',
    offset: region.offset || '',
    size: Number(region.size || 0),
    type: region.type || 'unknown',
    name: region.name || '',
  };
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

function unique(items) {
  return [...new Set((items || []).filter(item => item !== '' && item != null))]
    .sort((a, b) => String(a).localeCompare(String(b)));
}

function linkedTarget(helperGap, offsetText) {
  const target = (helperGap.helperTargets || []).find(item => item.targetOffset === offsetText);
  return target ? {
    sourceCallCount: Number(target.sourceCallCount || 0),
    sourceCallOffsets: target.sourceCallOffsets || [],
    sourceBehaviorStateIndexes: target.sourceBehaviorStateIndexes || [],
    sourceTargetOffsets: target.sourceTargetOffsets || [],
    roleGapKinds: target.roleGapKinds || [],
  } : {
    sourceCallCount: 0,
    sourceCallOffsets: [],
    sourceBehaviorStateIndexes: [],
    sourceTargetOffsets: [],
    roleGapKinds: [],
  };
}

function fieldRoleIndex(runtimeStruct) {
  const index = new Map();
  for (const field of runtimeStruct.fields || []) {
    index.set(`${field.register}+${field.offset}`, {
      role: field.role || '',
      fieldGroup: field.fieldGroup || '',
      confidence: field.confidence || '',
    });
  }
  return index;
}

function buildCatalog(mapData) {
  const helperGap = requireCatalog(mapData, sourceCatalogIds.helperGap);
  const frameStepSeed = requireCatalog(mapData, sourceCatalogIds.frameStepSeed);
  const runtimeStruct = requireCatalog(mapData, sourceCatalogIds.runtimeStruct);
  const fieldRoles = fieldRoleIndex(runtimeStruct);
  const localSubroutines = localDefinitions.map(def => {
    const offsetText = hex(def.offset);
    const region = findContainingRegion(mapData, def.offset);
    return {
      offset: offsetText,
      label: def.label,
      role: def.role,
      behaviorStateIndex: def.behaviorStateIndex,
      sourceTargetOffset: def.sourceTargetOffset,
      confidence: def.confidence,
      region: regionRef(region),
      fieldRefs: def.fieldRefs.map(token => ({
        token,
        role: fieldRoles.get(token)?.role || '',
        fieldGroup: fieldRoles.get(token)?.fieldGroup || '',
        confidence: fieldRoles.get(token)?.confidence || '',
      })),
      calls: def.calls,
      actor26Link: linkedTarget(helperGap, offsetText),
      persistedRomByteCount: 0,
      persistedInstructionByteCount: 0,
      persistedGameplayValueCount: 0,
      summary: def.summary,
      evidence: def.evidence,
    };
  });
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: Object.values(sourceCatalogIds),
    summary: {
      candidateEntityType: frameStepSeed.summary?.candidateEntityType || '',
      candidateSeedLabel: frameStepSeed.summary?.candidateSeedLabel || '',
      behaviorListSource: frameStepSeed.summary?.behaviorListSource || '',
      localSubroutineCount: localSubroutines.length,
      localSubroutineRegionCount: unique(localSubroutines.map(item => item.region?.id)).length,
      actor26LinkedLocalSubroutineCount: localSubroutines.filter(item => item.actor26Link.sourceCallCount > 0).length,
      actor26LinkedCallsiteCount: localSubroutines.reduce((sum, item) => sum + item.actor26Link.sourceCallCount, 0),
      behaviorStateIndexes: unique(localSubroutines.map(item => item.behaviorStateIndex)),
      fieldRefTokens: unique(localSubroutines.flatMap(item => item.fieldRefs.map(ref => ref.token))),
      externalCallLabels: unique(localSubroutines.flatMap(item => item.calls)),
      persistedRomByteCount: 0,
      persistedInstructionByteCount: 0,
      persistedGameplayValueCount: 0,
      assetPolicy: 'Metadata only: local subroutine offsets, labels, roles, field/RAM labels, call labels, callsite offsets, counts, and evidence. No ROM bytes, decoded instruction byte streams, graphics, coordinates, screenshots, music, text, or gameplay constants are embedded.',
    },
    localSubroutines,
    evidence: [
      `${sourceCatalogIds.helperGap} identifies 0x06F96 and 0x078B7 as local role-pending subroutines for actor 0x26.`,
      `${sourceCatalogIds.frameStepSeed} limits this catalog to the selected actor 0x26 / _LABEL_6D13_ frame-step seed.`,
      `${sourceCatalogIds.runtimeStruct} supplies the field-role vocabulary for IX+0, IX+8/IX+9, IX+17, IX+32, IX+33, and IX+40/IX+41.`,
    ],
    nextLeads: [
      'Build a read-only actor 0x26 frame-step diagnostic using the now role-resolved helper/local-subroutine targets.',
      'Trace branch predicates and timer constants inside these local helpers before promoting frame-exact behavior code.',
      'Join actor 0x26 room fixtures to this helper model to verify state transitions against rendered dynamic frame coverage.',
    ],
  };
}

function annotateRegion(region, subroutines, catalog) {
  if (!region) return null;
  region.analysis = region.analysis || {};
  region.analysis.c3c0FrameStepLocalSubroutineAudit = {
    catalogId,
    kind: 'c3c0_frame_step_local_subroutine_region',
    confidence: subroutines.some(item => item.confidence !== 'high') ? 'medium' : 'high',
    entityType: catalog.summary.candidateEntityType,
    seedLabel: catalog.summary.candidateSeedLabel,
    localSubroutineCount: subroutines.length,
    localSubroutineOffsets: subroutines.map(item => item.offset),
    localSubroutineRoles: subroutines.map(item => item.role),
    behaviorStateIndexes: unique(subroutines.map(item => item.behaviorStateIndex)),
    fieldRefTokens: unique(subroutines.flatMap(item => item.fieldRefs.map(ref => ref.token))),
    persistedRomByteCount: 0,
    persistedInstructionByteCount: 0,
    persistedGameplayValueCount: 0,
    summary: `${subroutines.length} local actor 0x26 frame-step subroutine(s) inside this behavior region now have metadata-only roles.`,
    evidence: [
      `${catalog.id} names local subroutine offset(s) ${subroutines.map(item => item.offset).join(', ')}.`,
      'No instruction bytes, decoded instruction streams, or literal gameplay constants are stored.',
    ],
    generatedAt: now,
    tool: toolName,
  };
  return {
    region: regionRef(region),
    localSubroutineCount: subroutines.length,
    localSubroutineOffsets: subroutines.map(item => item.offset),
    localSubroutineRoles: subroutines.map(item => item.role),
  };
}

function applyCatalog(mapData, catalog) {
  mapData.entityBehaviorCodeCatalogs = (mapData.entityBehaviorCodeCatalogs || []).filter(item => item.id !== catalogId);
  mapData.entityBehaviorCodeCatalogs.push(catalog);

  const byRegion = new Map();
  for (const subroutine of catalog.localSubroutines || []) {
    const regionId = subroutine.region?.id;
    if (!regionId) continue;
    if (!byRegion.has(regionId)) byRegion.set(regionId, []);
    byRegion.get(regionId).push(subroutine);
  }
  const annotatedRegions = [];
  for (const [regionId, subroutines] of byRegion) {
    const region = (mapData.regions || []).find(item => item.id === regionId);
    const annotated = annotateRegion(region, subroutines, catalog);
    if (annotated) annotatedRegions.push(annotated);
  }

  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'entity_c3c0_frame_step_local_subroutine_audit',
    schemaVersion: 1,
    generatedAt: now,
    tool: `${toolName} --apply`,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: {
      ...catalog.summary,
      annotatedRegionCount: annotatedRegions.length,
    },
    annotatedRegions,
    evidence: catalog.evidence,
    nextLeads: catalog.nextLeads,
  });
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  if (apply) {
    applyCatalog(mapData, catalog);
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }
  console.log(JSON.stringify({
    applied: apply,
    id: catalog.id,
    summary: catalog.summary,
    localSubroutines: catalog.localSubroutines.map(item => ({
      offset: item.offset,
      role: item.role,
      behaviorStateIndex: item.behaviorStateIndex,
      sourceCallCount: item.actor26Link.sourceCallCount,
      fieldRefs: item.fieldRefs.map(ref => ref.token),
      calls: item.calls,
    })),
  }, null, 2));
}

main();
