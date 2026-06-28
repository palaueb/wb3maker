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
const catalogId = 'world-entity-motion-delta-behavior-link-catalog-2026-06-25';
const reportId = 'entity-motion-delta-behavior-link-audit-2026-06-25';
const toolName = 'tools/world-entity-motion-delta-behavior-link-audit.mjs';

const sourceIds = {
  motionDelta: 'world-entity-motion-delta-field-provenance-catalog-2026-06-25',
  behaviorTableTargets: 'world-entity-behavior-table-target-catalog-2026-06-25',
  runtimeRoutines: 'world-entity-runtime-routine-catalog-2026-06-25',
  auxRoutines: 'world-aux-entity-routine-catalog-2026-06-25',
  bank0Behavior: 'world-bank0-entity-behavior-catalog-2026-06-25',
};

const analysisPriority = [
  'motionDeltaBehaviorLinkAudit',
  'entityRuntimeRoutineAudit',
  'auxEntityRoutineAudit',
  'bank0EntityBehaviorAudit',
  'bank0EntityInitHeadsAudit',
  'entityBehaviorTableTargetAudit',
  'bank2SceneRoutineAudit',
  'bank2TransitionRoutineAudit',
  'gameplayLookupDataAudit',
  'animationBehaviorFamilyAudit',
  'animationCallsiteAudit',
  'animationTileBaseAudit',
  'animationSpriteTileRangeAudit',
  'audioRequestCallsiteAudit',
  'entityRuntimeStructFieldAudit',
  'inferred',
];

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

function requireCatalog(mapData, id) {
  for (const [key, value] of Object.entries(mapData)) {
    if (!Array.isArray(value) || !/catalog/i.test(key)) continue;
    const catalog = value.find(item => item?.id === id);
    if (catalog) return catalog;
  }
  throw new Error(`Missing required catalog ${id}`);
}

function findCatalog(mapData, id) {
  for (const [key, value] of Object.entries(mapData)) {
    if (!Array.isArray(value) || !/catalog/i.test(key)) continue;
    const catalog = value.find(item => item?.id === id);
    if (catalog) return catalog;
  }
  return null;
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

function compactAnalysis(key, analysis) {
  if (!analysis) return null;
  return {
    key,
    catalogId: analysis.catalogId || '',
    kind: analysis.kind || analysis.role || analysis.family || '',
    family: analysis.family || '',
    confidence: analysis.confidence || '',
    table: analysis.dispatchTable || analysis.table || '',
    tableIndex: analysis.dispatchIndex ?? analysis.tableIndex ?? null,
    calls: Array.isArray(analysis.calls) ? analysis.calls.slice(0, 12) : [],
    ramRefs: Array.isArray(analysis.ramRefs) ? analysis.ramRefs.slice(0, 12) : [],
    summary: analysis.summary || '',
    evidence: Array.isArray(analysis.evidence) ? analysis.evidence.slice(0, 3) : [],
  };
}

function collectRegionAnalyses(region) {
  const analysis = region?.analysis || {};
  const out = [];
  for (const key of analysisPriority) {
    const ref = compactAnalysis(key, analysis[key]);
    if (ref) out.push(ref);
  }
  for (const key of Object.keys(analysis).sort()) {
    if (analysisPriority.includes(key)) continue;
    if (!/audit|inferred/i.test(key)) continue;
    const ref = compactAnalysis(key, analysis[key]);
    if (ref) out.push(ref);
  }
  return out.slice(0, 12);
}

function behaviorTableLinks(behaviorCatalog, label) {
  const links = [];
  for (const table of behaviorCatalog?.tables || []) {
    for (const group of table.targetGroups || []) {
      if (group.targetLabel !== label) continue;
      links.push({
        tableLabel: table.label,
        semanticRole: table.semanticRole,
        entryIndexes: group.entryIndexes || [],
        roleKind: group.role?.kind || '',
        roleSummary: group.role?.summary || '',
        confidence: group.role?.confidence || table.confidence || '',
        asmLine: group.asm?.asmLine || null,
        lineRange: group.asm?.lineRange || null,
        calls: (group.asm?.calls || []).map(call => call.label).slice(0, 12),
        branches: (group.asm?.branches || []).map(branch => branch.label).slice(0, 12),
        ixOffsets: (group.asm?.ixOffsets || []).map(offset => `IX+${offset}`),
        iyOffsets: (group.asm?.iyOffsets || []).map(offset => `IY+${offset}`),
      });
    }
  }
  return links;
}

function catalogEntries(catalog, label) {
  const entries = [];
  for (const key of ['entries', 'routines']) {
    for (const entry of catalog?.[key] || []) {
      if (entry.label !== label) continue;
      entries.push({
        catalogId: catalog.id,
        bucket: key,
        role: entry.role || '',
        family: entry.family || '',
        table: entry.table || '',
        tableIndex: entry.tableIndex ?? null,
        calls: Array.isArray(entry.calls) ? entry.calls.slice(0, 12) : [],
        ramRefs: Array.isArray(entry.ramRefs) ? entry.ramRefs.slice(0, 12) : [],
        summary: entry.summary || '',
        evidence: Array.isArray(entry.evidence) ? entry.evidence.slice(0, 3) : [],
      });
    }
  }
  return entries;
}

function classifyWriter(label, region, analyses, tableLinks) {
  const analysisByKey = new Map(analyses.map(item => [item.key, item]));
  const runtime = analysisByKey.get('entityRuntimeRoutineAudit');
  const aux = analysisByKey.get('auxEntityRoutineAudit');
  const bank2Scene = analysisByKey.get('bank2SceneRoutineAudit');
  const bank2Transition = analysisByKey.get('bank2TransitionRoutineAudit');
  const bank0 = analysisByKey.get('bank0EntityBehaviorAudit') || analysisByKey.get('bank0EntityInitHeadsAudit');
  const behaviorTarget = analysisByKey.get('entityBehaviorTableTargetAudit');
  const gameplayLookup = analysisByKey.get('gameplayLookupDataAudit');
  const data668e = tableLinks.find(link => link.tableLabel === '_DATA_668E_');
  const data7d49 = tableLinks.find(link => link.tableLabel === '_DATA_7D49_');
  const roleText = [runtime?.kind, runtime?.family, region?.name, aux?.kind, bank2Scene?.kind, bank2Transition?.kind].filter(Boolean).join(' ').toLowerCase();

  if (data7d49 || /c600|secondary_object/.test(roleText) || label === '_LABEL_7C65_' || label === '_LABEL_7E9C_' || label === '_LABEL_7EE1_') {
    if (label === '_LABEL_7C65_') {
      return {
        family: 'c600_secondary_object_record_initializer',
        role: 'record_stream_motion_delta_seed',
        confidence: 'high',
        reason: '_LABEL_7C65_ is the confirmed C600 secondary object scheduler and writes IX+30/IX+31 while initializing pending slots from record pointers.',
      };
    }
    if (label === '_LABEL_7E9C_' || label === '_LABEL_7EE1_') {
      return {
        family: 'c600_secondary_object_collision_response',
        role: 'floor_contact_motion_delta_reseed',
        confidence: 'high',
        reason: `${label} is a confirmed C600 floor/contact response reached from the _DATA_7D49_ state table.`,
      };
    }
    return {
      family: 'c600_secondary_object_state_update',
      role: 'state_update_motion_delta_use',
      confidence: 'high',
      reason: `${label} is linked to the _DATA_7D49_ C600 secondary state dispatch path.`,
    };
  }

  if (runtime?.kind === 'd0a4_pair_slot_scheduler' || label === '_LABEL_61CE_') {
    return {
      family: 'c640_d0a4_pair_slot_motion',
      role: 'pair_slot_spawn_motion_delta_seed',
      confidence: 'high',
      reason: '_LABEL_61CE_ initializes the two C640/C680 D0A4 pair slots and the active update path consumes IX+30/IX+31 through the delta helpers.',
    };
  }

  if (runtime?.kind === 'c740_twelve_slot_updater' || label === '_LABEL_62C6_') {
    return {
      family: 'c740_twelve_slot_motion',
      role: 'multi_slot_spawn_motion_delta_seed',
      confidence: 'medium',
      reason: '_LABEL_62C6_ is the confirmed C740 twelve-slot updater and writes IX+31 during slot initialization/update.',
    };
  }

  if (aux) {
    return {
      family: 'auxiliary_actor_motion',
      role: aux.kind || aux.role || 'auxiliary_motion_delta_writer',
      confidence: 'high',
      reason: `${label} has auxEntityRoutineAudit evidence and writes IX+30/IX+31 as part of auxiliary actor motion.`,
    };
  }

  if (bank2Scene) {
    return {
      family: 'bank2_scene_actor_motion',
      role: bank2Scene.kind || 'bank2_scene_motion_delta_writer',
      confidence: 'high',
      reason: `${label} is covered by bank2SceneRoutineAudit and writes IX+30/IX+31 in a scene-local actor path.`,
    };
  }

  if (bank2Transition) {
    return {
      family: 'bank2_transition_actor_motion',
      role: bank2Transition.kind || 'bank2_transition_motion_delta_writer',
      confidence: 'high',
      reason: `${label} is covered by bank2TransitionRoutineAudit and writes IX+30/IX+31 in a transition actor path.`,
    };
  }

  if (data668e || bank0 || behaviorTarget) {
    return {
      family: 'c3c0_entity_initializer_motion_seed',
      role: bank0?.kind || behaviorTarget?.kind || data668e?.roleKind || 'entity_initializer_motion_delta_seed',
      confidence: bank0 || behaviorTarget ? 'high' : 'medium',
      reason: `${label} is linked to _DATA_668E_ entity initialization and seeds IX+30/IX+31 for the C3C0 entity runtime slot.`,
    };
  }

  if (gameplayLookup) {
    return {
      family: 'gameplay_lookup_motion_seed',
      role: gameplayLookup.kind || 'lookup_selected_motion_delta_seed',
      confidence: 'medium',
      reason: `${label} has gameplayLookupDataAudit evidence but no stronger runtime-family link yet.`,
    };
  }

  return {
    family: 'unclassified_motion_delta_writer_context',
    role: 'needs_manual_trace',
    confidence: 'low',
    reason: `${label} writes IX+30/IX+31 but no existing behavior-family catalog links it yet.`,
  };
}

function compactReference(ref) {
  return {
    field: ref.field,
    axis: ref.axis,
    access: ref.access,
    writeKind: ref.writeKind || '',
    line: ref.line,
    context: ref.context,
    instructionSummary: ref.instructionSummary,
  };
}

function buildWriterLink(mapData, sourceCatalogs, routineSummary) {
  const offset = labelOffset(routineSummary.label);
  const region = offset == null ? null : findContainingRegion(mapData, offset);
  const analyses = collectRegionAnalyses(region);
  const refs = (sourceCatalogs.motionDelta.references || [])
    .filter(ref => ref.label === routineSummary.label)
    .sort((a, b) => a.line - b.line);
  const writerRefs = refs.filter(ref => ref.access === 'write' || ref.access === 'read_write');
  const readerRefs = refs.filter(ref => ref.access === 'read' || ref.access === 'read_write');
  const tableLinks = behaviorTableLinks(sourceCatalogs.behaviorTableTargets, routineSummary.label);
  const entries = [
    ...catalogEntries(sourceCatalogs.runtimeRoutines, routineSummary.label),
    ...catalogEntries(sourceCatalogs.auxRoutines, routineSummary.label),
    ...catalogEntries(sourceCatalogs.bank0Behavior, routineSummary.label),
  ];
  const classification = classifyWriter(routineSummary.label, region, analyses, tableLinks);
  const calls = unique([
    ...analyses.flatMap(item => item.calls || []),
    ...entries.flatMap(item => item.calls || []),
    ...tableLinks.flatMap(item => item.calls || []),
  ]);
  const deltaConsumerCalls = calls.filter(label => ['_LABEL_1B22_', '_LABEL_1B25_', '_LABEL_1B4B_', '_LABEL_6268_', '_LABEL_7D45_', '_LABEL_7D51_', '_LABEL_7DA3_', '_LABEL_7DD4_', '_LABEL_7DFD_'].includes(label));
  const evidence = [
    `${routineSummary.label} has ${writerRefs.length} IX+30/IX+31 writer reference(s) in ${sourceIds.motionDelta}.`,
    ...writerRefs.slice(0, 4).map(ref => `ASM line ${ref.line}: ${ref.instructionSummary} (${ref.field}, ${ref.access}).`),
    classification.reason,
    ...analyses.flatMap(item => item.evidence || []).slice(0, 4),
  ];

  return {
    label: routineSummary.label,
    offset: offset == null ? null : hex(offset),
    region: regionRef(region),
    classification,
    lineRange: routineSummary.lineRange,
    fields: routineSummary.fields,
    axes: routineSummary.axes,
    accessCounts: routineSummary.accessCounts,
    writeKindCounts: routineSummary.writeKindCounts,
    referenceCount: refs.length,
    writerReferenceCount: writerRefs.length,
    readerReferenceCount: readerRefs.length,
    writerReferences: writerRefs.map(compactReference),
    readerReferences: readerRefs.map(compactReference),
    behaviorTableLinks: tableLinks,
    sourceAnalyses: analyses,
    sourceCatalogEntries: entries,
    calls,
    deltaConsumerCalls,
    motionChainStatus: deltaConsumerCalls.length
      ? 'has_direct_or_scheduled_delta_consumer_link'
      : 'motion_seed_only_consumer_link_pending',
    persistedGameplayValueCount: 0,
    evidence,
  };
}

function buildCatalog(mapData) {
  const sourceCatalogs = {
    motionDelta: requireCatalog(mapData, sourceIds.motionDelta),
    behaviorTableTargets: findCatalog(mapData, sourceIds.behaviorTableTargets),
    runtimeRoutines: findCatalog(mapData, sourceIds.runtimeRoutines),
    auxRoutines: findCatalog(mapData, sourceIds.auxRoutines),
    bank0Behavior: findCatalog(mapData, sourceIds.bank0Behavior),
  };
  const missingSourceCatalogs = Object.entries(sourceCatalogs)
    .filter(([, catalog]) => !catalog)
    .map(([key]) => key);
  if (missingSourceCatalogs.length) throw new Error(`Missing source catalog(s): ${missingSourceCatalogs.join(', ')}`);

  const writerSummaries = (sourceCatalogs.motionDelta.routineSummaries || [])
    .filter(routine => Number(routine.accessCounts?.write || 0) || Number(routine.accessCounts?.read_write || 0))
    .sort((a, b) => {
      const ao = labelOffset(a.label) ?? 0;
      const bo = labelOffset(b.label) ?? 0;
      return ao - bo || a.label.localeCompare(b.label);
    });
  const writerLinks = writerSummaries.map(routine => buildWriterLink(mapData, sourceCatalogs, routine));
  const unresolvedWriterLinks = writerLinks.filter(link => link.classification.family === 'unclassified_motion_delta_writer_context');
  const behaviorTableLinkedWriterLinks = writerLinks.filter(link => link.behaviorTableLinks.length);

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: Object.values(sourceIds),
    summary: {
      writerRoutineCount: writerLinks.length,
      linkedWriterRoutineCount: writerLinks.filter(link => link.region).length,
      behaviorTableLinkedWriterRoutineCount: behaviorTableLinkedWriterLinks.length,
      c3c0InitializerWriterRoutineCount: writerLinks.filter(link => link.classification.family === 'c3c0_entity_initializer_motion_seed').length,
      auxiliaryActorWriterRoutineCount: writerLinks.filter(link => link.classification.family === 'auxiliary_actor_motion').length,
      c640PairSlotWriterRoutineCount: writerLinks.filter(link => link.classification.family === 'c640_d0a4_pair_slot_motion').length,
      c740SlotWriterRoutineCount: writerLinks.filter(link => link.classification.family === 'c740_twelve_slot_motion').length,
      c600RecordInitializerWriterRoutineCount: writerLinks.filter(link => link.classification.family === 'c600_secondary_object_record_initializer').length,
      c600CollisionResponseWriterRoutineCount: writerLinks.filter(link => link.classification.family === 'c600_secondary_object_collision_response').length,
      bank2SceneWriterRoutineCount: writerLinks.filter(link => link.classification.family === 'bank2_scene_actor_motion').length,
      bank2TransitionWriterRoutineCount: writerLinks.filter(link => link.classification.family === 'bank2_transition_actor_motion').length,
      gameplayLookupWriterRoutineCount: writerLinks.filter(link => link.classification.family === 'gameplay_lookup_motion_seed').length,
      unresolvedWriterRoutineCount: unresolvedWriterLinks.length,
      directOrScheduledDeltaConsumerLinkedWriterRoutineCount: writerLinks.filter(link => link.deltaConsumerCalls.length).length,
      motionSeedOnlyWriterRoutineCount: writerLinks.filter(link => !link.deltaConsumerCalls.length).length,
      writerReferenceCount: writerLinks.reduce((sum, link) => sum + link.writerReferenceCount, 0),
      readerReferenceCountInWriterRoutines: writerLinks.reduce((sum, link) => sum + link.readerReferenceCount, 0),
      familyCounts: countBy(writerLinks, link => link.classification.family),
      confidenceCounts: countBy(writerLinks, link => link.classification.confidence),
      persistedRomByteCount: 0,
      persistedGameplayValueCount: 0,
      assetPolicy: 'Metadata only: motion-delta field names, labels, offsets, counts, line numbers, behavior-family classifications, and existing audit evidence. No ROM bytes, decoded graphics, music, text, or gameplay tables are embedded.',
    },
    writerLinks,
    unresolvedWriterLinks: unresolvedWriterLinks.map(link => ({
      label: link.label,
      offset: link.offset,
      region: link.region,
      reason: link.classification.reason,
    })),
    evidence: [
      `${sourceIds.motionDelta} identifies IX+30/IX+31 writer routines and line references.`,
      `${sourceIds.behaviorTableTargets} links _DATA_668E_ and _DATA_7D49_ target routines to dispatch entries.`,
      'Region-level audits provide auxiliary, runtime, scene, transition, and gameplay-lookup family evidence.',
      'This catalog records only metadata and provenance; no ROM bytes or decoded asset payloads are persisted.',
    ],
    nextLeads: [
      'Trace motionSeedOnlyWriterRoutineCount writers to their later delta consumers so initializer constants become frame-step behavior.',
      'Resolve gameplay_lookup_motion_seed writers to the calling initializer/update families that consume their selected constants.',
      'Group C3C0 initializer motion seeds by behavior pointer list and room entity type without persisting raw entity records.',
    ],
  };
}

function annotateRegion(region, link) {
  if (!region) return null;
  region.analysis = region.analysis || {};
  region.analysis.motionDeltaBehaviorLinkAudit = {
    catalogId,
    kind: link.classification.family,
    role: link.classification.role,
    label: link.label,
    confidence: link.classification.confidence,
    fields: link.fields,
    axes: link.axes,
    writerReferenceCount: link.writerReferenceCount,
    readerReferenceCount: link.readerReferenceCount,
    behaviorTables: link.behaviorTableLinks.map(item => ({
      tableLabel: item.tableLabel,
      entryIndexes: item.entryIndexes,
      roleKind: item.roleKind,
    })),
    motionChainStatus: link.motionChainStatus,
    deltaConsumerCalls: link.deltaConsumerCalls,
    persistedGameplayValueCount: 0,
    summary: link.classification.reason,
    evidence: link.evidence.slice(0, 6),
    generatedAt: now,
    tool: toolName,
  };
  return {
    region: regionRef(region),
    label: link.label,
    kind: link.classification.family,
    confidence: link.classification.confidence,
  };
}

function applyCatalog(mapData, catalog) {
  mapData.entityRuntimeStructCatalogs = (mapData.entityRuntimeStructCatalogs || []).filter(item => item.id !== catalogId);
  mapData.entityRuntimeStructCatalogs.push(catalog);
  const annotatedRegions = [];
  for (const link of catalog.writerLinks) {
    const offset = labelOffset(link.label);
    const region = offset == null ? null : findContainingRegion(mapData, offset);
    const annotated = annotateRegion(region, link);
    if (annotated) annotatedRegions.push(annotated);
  }
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'entity_motion_delta_behavior_link_audit',
    schemaVersion: 1,
    generatedAt: now,
    tool: `${toolName} --apply`,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: {
      ...catalog.summary,
      annotatedRegions: annotatedRegions.length,
    },
    annotatedRegions,
    unresolvedWriterLinks: catalog.unresolvedWriterLinks,
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
    unresolvedWriterLinks: catalog.unresolvedWriterLinks,
  }, null, 2));
}

main();
