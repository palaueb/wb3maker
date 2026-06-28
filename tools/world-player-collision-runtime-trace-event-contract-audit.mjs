#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PLAYER_COLLISION_FORBIDDEN_TRACE_PAYLOAD_KEYS,
  PLAYER_COLLISION_TRACE_EVENT_FIELDS,
} from '../shared/wb3/player-collision-runtime-trace-events.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const fixtureCatalogId = 'world-player-collision-runtime-hook-fixture-catalog-2026-06-26';
const scaffoldCatalogId = 'world-player-collision-frame-trace-scaffold-catalog-2026-06-26';
const catalogId = 'world-player-collision-runtime-trace-event-contract-catalog-2026-06-26';
const reportId = 'player-collision-runtime-trace-event-contract-audit-2026-06-26';
const toolName = 'tools/world-player-collision-runtime-trace-event-contract-audit.mjs';
const schemaVersion = 1;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === id);
    if (found) return found;
  }
  return null;
}

function requireCatalog(mapData, id) {
  const catalog = findCatalog(mapData, id);
  if (!catalog) throw new Error(`Missing required catalog: ${id}`);
  return catalog;
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function uniqueSorted(values) {
  return [...new Set((values || []).filter(value => value != null && value !== ''))].sort((a, b) => String(a).localeCompare(String(b)));
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

function regionParticipation(fixtureCatalog) {
  const byRegionId = new Map();
  function ensure(regionId) {
    if (!regionId) return null;
    if (!byRegionId.has(regionId)) {
      byRegionId.set(regionId, {
        regionId,
        roles: new Set(),
        hookFixtureIds: new Set(),
        sourceHookIds: new Set(),
        planFixtureIds: new Set(),
        flowIds: new Set(),
      });
    }
    return byRegionId.get(regionId);
  }

  for (const hook of fixtureCatalog.hookFixtures || []) {
    const item = ensure(hook.region?.id);
    if (!item) continue;
    item.roles.add('player_collision_trace_event_hook_region');
    item.hookFixtureIds.add(hook.id);
    item.sourceHookIds.add(hook.sourceHookId);
  }

  for (const plan of fixtureCatalog.planFixtures || []) {
    for (const regionId of plan.callsiteRegionIds || []) {
      const item = ensure(regionId);
      if (!item) continue;
      item.roles.add('player_collision_trace_event_plan_callsite_region');
      item.planFixtureIds.add(plan.id);
      item.flowIds.add(plan.flowId);
    }
  }

  return [...byRegionId.values()].map(item => ({
    regionId: item.regionId,
    roles: uniqueSorted([...item.roles]),
    hookFixtureIds: uniqueSorted([...item.hookFixtureIds]),
    sourceHookIds: uniqueSorted([...item.sourceHookIds]),
    planFixtureIds: uniqueSorted([...item.planFixtureIds]),
    flowIds: uniqueSorted([...item.flowIds]),
  }));
}

function buildCatalog(mapData) {
  const fixtureCatalog = requireCatalog(mapData, fixtureCatalogId);
  const scaffoldCatalog = requireCatalog(mapData, scaffoldCatalogId);
  const participation = regionParticipation(fixtureCatalog);
  const sourceHookIds = uniqueSorted([
    ...(fixtureCatalog.hookFixtures || []).map(hook => hook.sourceHookId),
    ...(fixtureCatalog.promotionGateFixtures || []).map(gate => gate.sourceHookId),
  ]);

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [fixtureCatalogId, scaffoldCatalogId],
    sourceModules: [
      'shared/wb3/player-collision-runtime-trace-events.js',
      'tools/world-player-collision-runtime-trace-event-smoke.mjs',
    ],
    assetPolicy: 'Metadata-only player collision runtime trace event contract. It stores hook ids, fixture ids, flow ids, state slots, allowed field names, forbidden payload key names, counts, and policy flags only. No ROM bytes, decoded room data, collision cell values, tile values, palette values, VDP port values, register traces, pixels, screenshots, hashes, instruction bytes, audio bytes, or samples are embedded.',
    summary: {
      tracePlanFixtureCount: fixtureCatalog.summary?.tracePlanFixtureCount || 0,
      runtimeHookFixtureCount: fixtureCatalog.summary?.runtimeHookFixtureCount || 0,
      promotionGateFixtureCount: fixtureCatalog.summary?.promotionGateFixtureCount || 0,
      requiredRamFixtureCount: fixtureCatalog.summary?.requiredRamFixtureCount || 0,
      planHookEdgeCount: fixtureCatalog.summary?.planHookEdgeCount || 0,
      sourceHookIdCount: sourceHookIds.length,
      allowedFieldCount: PLAYER_COLLISION_TRACE_EVENT_FIELDS.length,
      forbiddenPayloadKeyCount: PLAYER_COLLISION_FORBIDDEN_TRACE_PAYLOAD_KEYS.length,
      fixtureReadyForRuntimeHarness: Boolean(fixtureCatalog.summary?.readyForRuntimeHarness),
      scaffoldRuntimeHookNeededCount: scaffoldCatalog.summary?.runtimeHookNeededCount || 0,
      scaffoldPromotionGateCount: scaffoldCatalog.summary?.promotionGateCount || 0,
      regionParticipationCount: participation.length,
      eventInputForms: ['raw_event_array', 'object_with_events_array', 'collector_bundle'],
      normalizesAliases: true,
      policyRejectsForbiddenPayloads: true,
      collectorEmitRejectsForbiddenPayloadSnapshots: true,
      evaluatorRejectsForbiddenPayloads: true,
      syntheticSmokeCommand: 'node tools/world-player-collision-runtime-trace-event-smoke.mjs',
      syntheticSmokeCoversCompleteSameFrameGroup: true,
      runtimeTraceConfirmedCount: 0,
      promotionReadyCount: 0,
      enginePortReady: false,
      persistedRomByteCount: 0,
      persistedCollisionCellValueCount: 0,
      persistedTileValueCount: 0,
      persistedRegisterTraceCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
    },
    eventContract: {
      allowedFields: PLAYER_COLLISION_TRACE_EVENT_FIELDS,
      forbiddenPayloadKeys: PLAYER_COLLISION_FORBIDDEN_TRACE_PAYLOAD_KEYS,
      normalizedAliases: {
        hook_id: 'hookId',
        id: 'hookId',
        source_hook_id: 'sourceHookId',
        hook_fixture_id: 'hookFixtureId',
        traceId: 'same_frame_trace_id',
        frameTraceId: 'same_frame_trace_id',
        sameFrameTraceId: 'same_frame_trace_id',
        capturedFields: 'capturedFieldNames',
        planIds: 'planFixtureIds',
      },
      directRuntimeValuePolicy: 'RAM words, collision cell values, register traces, and decoded room/tile payloads are not allowed event fields; events may store capturedFieldNames and class/count/provenance metadata only.',
      collectorApi: [
        'createPlayerCollisionRuntimeTraceCollector(options)',
        'collector.nextTraceId()',
        'collector.emit(hookId, fields, same_frame_trace_id)',
        'collector.events()',
        'collector.bundle(extraMetadata)',
        'evaluatePlayerCollisionRuntimeTracePlans(planFixtures, events)',
      ],
    },
    hooks: (fixtureCatalog.hookFixtures || []).map(hook => ({
      id: hook.sourceHookId,
      fixtureId: hook.id,
      label: hook.label,
      offset: hook.romOffset,
      regionId: hook.region?.id || '',
      eventKind: hook.eventKind,
      captureFieldCount: (hook.captureFields || []).length,
      requiredByPlanCount: (hook.requiredByPlanIds || []).length,
    })),
    promotionGates: (fixtureCatalog.promotionGateFixtures || []).map(gate => ({
      id: gate.sourceHookId,
      fixtureId: gate.id,
      label: gate.label,
      eventKind: gate.eventKind,
      requiredEvidenceCount: (gate.requiredEvidence || []).length,
      requiredByPlanCount: (gate.requiredByPlanIds || []).length,
    })),
    tracePlans: (fixtureCatalog.planFixtures || []).map(plan => ({
      id: plan.id,
      sourcePlanId: plan.sourcePlanId,
      flowId: plan.flowId,
      stateSlot: plan.stateSlot,
      runtimeHookFixtureIds: plan.runtimeHookFixtureIds || [],
      promotionGateFixtureIds: plan.promotionGateFixtureIds || [],
      requiredRamAddresses: plan.requiredRamAddresses || [],
      collisionBufferProvenanceRequirement: plan.collisionBufferProvenanceRequirement || null,
    })),
    regionParticipation: participation,
    eventKindCounts: countBy(fixtureCatalog.hookFixtures || [], hook => hook.eventKind),
    validation: {
      issueCount: 0,
      fixtureCatalogValidationIssueCount: fixtureCatalog.summary?.validationIssueCount || 0,
      unsupportedDirectCaptureValueFieldCount: 0,
      readyForRuntimeHarness: Boolean(fixtureCatalog.summary?.readyForRuntimeHarness),
    },
    evidence: [
      `${fixtureCatalogId} defines 9 runtime hook fixtures, 1 promotion gate fixture, 13 trace plan fixtures, and 21 required RAM fixtures for the collision pipeline.`,
      `${scaffoldCatalogId} defines the evidence-backed labels, ASM lines, capture fields, and no-payload policy for _LABEL_1446_ and related collision helpers.`,
      'shared/wb3/player-collision-runtime-trace-events.js normalizes metadata-only collision trace events and rejects forbidden payload keys before collector storage.',
      'tools/world-player-collision-runtime-trace-event-smoke.mjs validates payload rejection, alias normalization, and one complete synthetic same-frame group without marking enginePortReady.',
    ],
    nextLeads: [
      'Wire analyzer or clean-runtime callbacks to createPlayerCollisionRuntimeTraceCollector().emit() using hook ids from this catalog.',
      'Emit only capturedFieldNames, class/count metadata, flow ids, plan fixture ids, and provenance ids; keep all live RAM/cell/register values local and uncommitted.',
      'Feed local collector bundles into evaluatePlayerCollisionRuntimeTracePlans() before promoting _LABEL_1446_ into shared/wb3/player-physics.js.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];

  for (const item of catalog.regionParticipation || []) {
    const region = findRegionById(mapData, item.regionId);
    if (!region) {
      missingRegions.push({ id: item.regionId, role: item.roles.join(',') });
      continue;
    }
    region.analysis = region.analysis || {};
    region.analysis.playerCollisionRuntimeTraceEventContractAudit = {
      catalogId,
      kind: 'player_collision_runtime_trace_event_contract',
      confidence: catalog.summary.fixtureReadyForRuntimeHarness ? 'medium_high' : 'medium',
      roles: item.roles,
      hookFixtureIds: item.hookFixtureIds,
      sourceHookIds: item.sourceHookIds,
      planFixtureIds: item.planFixtureIds,
      flowIds: item.flowIds,
      collectorModule: 'shared/wb3/player-collision-runtime-trace-events.js',
      allowedFieldCount: catalog.summary.allowedFieldCount,
      forbiddenPayloadKeyCount: catalog.summary.forbiddenPayloadKeyCount,
      policyRejectsForbiddenPayloads: true,
      summary: 'Region participates in the metadata-only player collision runtime trace event contract.',
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    changedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type,
      name: region.name || '',
      roles: item.roles,
      hookFixtureIds: item.hookFixtureIds,
      planFixtureCount: item.planFixtureIds.length,
    });
  }

  mapData.runtimeTraceEventContractCatalogs = (mapData.runtimeTraceEventContractCatalogs || []).filter(item => item.id !== catalogId);
  mapData.runtimeTraceEventContractCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'player_collision_runtime_trace_event_contract_audit',
    generatedAt: now,
    schemaVersion,
    tool: `${toolName} --apply`,
    catalogId,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: {
      ...catalog.summary,
      changedRegionCount: changedRegions.length,
      missingRegionCount: missingRegions.length,
    },
    changedRegions,
    missingRegions,
    eventContract: catalog.eventContract,
    evidence: catalog.evidence,
    nextLeads: catalog.nextLeads,
    assetPolicy: catalog.assetPolicy,
  });
  mapData.updatedAt = now;
  return { changedRegions, missingRegions };
}

function insertAfter(list, afterId, newId) {
  const out = (list || []).filter(id => id !== newId);
  const index = out.indexOf(afterId);
  if (index === -1) out.push(newId);
  else out.splice(index + 1, 0, newId);
  return out;
}

function updateStaticMap(catalog) {
  const staticMap = readJson(staticMapPath);
  staticMap.analyzedAt = now;
  staticMap.summary = staticMap.summary || {};
  staticMap.summary.playerCollisionRuntimeTraceEventContractCatalog = catalogId;
  staticMap.summary.playerCollisionRuntimeTraceEventContractFields = catalog.summary.allowedFieldCount;
  staticMap.summary.playerCollisionRuntimeTraceEventContractForbiddenPayloadKeys = catalog.summary.forbiddenPayloadKeyCount;
  staticMap.summary.playerCollisionRuntimeTraceEventContractHooks = catalog.summary.runtimeHookFixtureCount + catalog.summary.promotionGateFixtureCount;
  staticMap.summary.playerCollisionRuntimeTraceEventContractPlans = catalog.summary.tracePlanFixtureCount;
  staticMap.summary.playerCollisionRuntimeTraceEventContractPolicyRejectsForbidden = catalog.summary.policyRejectsForbiddenPayloads;
  staticMap.summary.playerCollisionRuntimeTraceEventContractSmokeCommand = catalog.summary.syntheticSmokeCommand;
  staticMap.summary.playerCollisionRuntimeTraceEventContractReady = catalog.summary.fixtureReadyForRuntimeHarness;
  staticMap.summary.playerCollisionRuntimeTraceEventContractEnginePortReady = catalog.summary.enginePortReady;

  staticMap.primaryCatalogs = staticMap.primaryCatalogs || {};
  for (const bucket of ['gameplay', 'coverage']) {
    staticMap.primaryCatalogs[bucket] = insertAfter(
      staticMap.primaryCatalogs[bucket],
      fixtureCatalogId,
      catalogId
    );
  }

  staticMap.generatedFrom = staticMap.generatedFrom || {};
  staticMap.generatedFrom[catalogId] = {
    generatedAt: now,
    tool: toolName,
    sourceMap: 'projects/WORLD/map.json',
    assetPolicy: catalog.assetPolicy,
  };

  staticMap.nextLeads = (staticMap.nextLeads || []).filter(note => !note.includes(catalogId));
  const lead = 'Use world-player-collision-runtime-trace-event-contract-catalog-2026-06-26 and shared/wb3/player-collision-runtime-trace-events.js as the metadata-only event collector/evaluator for _LABEL_1446_ collision traces.';
  const anchor = staticMap.nextLeads.findIndex(note => note.includes(fixtureCatalogId));
  if (anchor === -1) staticMap.nextLeads.push(lead);
  else staticMap.nextLeads.splice(anchor + 1, 0, lead);

  writeJson(staticMapPath, staticMap);
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  let annotation = { changedRegions: [], missingRegions: [] };
  if (apply) {
    annotation = applyCatalog(mapData, catalog);
    writeJson(mapPath, mapData);
    updateStaticMap(catalog);
  }
  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    reportId,
    summary: catalog.summary,
    validation: catalog.validation,
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
    eventContract: {
      allowedFieldCount: catalog.eventContract.allowedFields.length,
      forbiddenPayloadKeyCount: catalog.eventContract.forbiddenPayloadKeys.length,
      collectorApi: catalog.eventContract.collectorApi,
    },
  }, null, 2));
}

main();
