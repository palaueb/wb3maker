#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-player-collision-runtime-hook-fixture-audit.mjs';
const sourceCatalogId = 'world-player-collision-frame-trace-scaffold-catalog-2026-06-26';
const catalogId = 'world-player-collision-runtime-hook-fixture-catalog-2026-06-26';
const reportId = 'player-collision-runtime-hook-fixture-audit-2026-06-26';
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

function parseOffset(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return NaN;
  return parseInt(value.replace(/^\$/, '0x'), 16);
}

function uniqueSorted(values) {
  return [...new Set((values || []).filter(value => value != null && value !== ''))].sort((a, b) => {
    const aNum = parseOffset(a);
    const bNum = parseOffset(b);
    if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;
    return String(a).localeCompare(String(b));
  });
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

function sumBy(items, valueFn) {
  return (items || []).reduce((sum, item) => sum + valueFn(item), 0);
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function findRamByAddress(mapData, address) {
  const normalized = String(address || '').toUpperCase().replace(/^0X/, '$');
  return (mapData.ram || []).find(entry => String(entry.address || '').toUpperCase() === normalized) || null;
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

function compactRam(ram) {
  if (!ram) return null;
  return {
    id: ram.id || '',
    address: ram.address || '',
    size: Number(ram.size || 0),
    type: ram.type || 'byte',
    name: ram.name || '',
  };
}

function fixtureId(prefix, id) {
  return `${prefix}_${String(id || '').replace(/[^A-Za-z0-9_]+/g, '_')}`;
}

function duplicateValues(values) {
  const seen = new Set();
  const dupes = new Set();
  for (const value of values || []) {
    if (seen.has(value)) dupes.add(value);
    seen.add(value);
  }
  return [...dupes].sort();
}

function eventPointsById(sourceCatalog) {
  return new Map((sourceCatalog.traceEventPoints || []).map(point => [point.id, point]));
}

function buildPlanIndex(sourceCatalog) {
  const plansByEventPointId = new Map();
  for (const plan of sourceCatalog.tracePlans || []) {
    for (const pointId of plan.traceEventPointIds || []) {
      if (!plansByEventPointId.has(pointId)) plansByEventPointId.set(pointId, []);
      plansByEventPointId.get(pointId).push(plan);
    }
  }
  return plansByEventPointId;
}

function runtimeEventPoints(sourceCatalog) {
  return (sourceCatalog.traceEventPoints || []).filter(point => point.runtimeHookStatus === 'runtime_hook_needed');
}

function promotionGateEventPoints(sourceCatalog) {
  return (sourceCatalog.traceEventPoints || []).filter(point => point.runtimeHookStatus === 'metadata_gate_ready_runtime_trace_pending');
}

function planRuntimeHookIds(plan, runtimeHookIdSet) {
  return (plan.traceEventPointIds || []).filter(id => runtimeHookIdSet.has(id));
}

function planPromotionGateIds(plan, gateIdSet) {
  return (plan.traceEventPointIds || []).filter(id => gateIdSet.has(id));
}

function hookCaptureFields(pointById, ids) {
  return uniqueSorted(ids.flatMap(id => pointById.get(id)?.captureFields || []));
}

function buildFixtures(mapData, sourceCatalog) {
  const pointById = eventPointsById(sourceCatalog);
  const plansByPointId = buildPlanIndex(sourceCatalog);
  const runtimePoints = runtimeEventPoints(sourceCatalog);
  const gatePoints = promotionGateEventPoints(sourceCatalog);
  const runtimeHookIdSet = new Set(runtimePoints.map(point => point.id));
  const gateIdSet = new Set(gatePoints.map(point => point.id));

  const hookFixtures = runtimePoints.map(point => {
    const region = findRegionById(mapData, point.region?.id) || point.region || null;
    const requiredByPlans = plansByPointId.get(point.id) || [];
    return {
      id: fixtureId('player_collision_runtime_hook_fixture', point.id),
      sourceHookId: point.id,
      sourceFamily: 'player_collision',
      label: point.label || '',
      eventKind: point.eventKind || '',
      region: compactRegion(region),
      romOffset: point.offset || region?.offset || '',
      asmLineEvidence: point.asmLineEvidence || [],
      addressable: Boolean(region?.id && (point.offset || region?.offset)),
      triggerModel: point.label === '_LABEL_1446_'
        ? 'Emit when the collision dispatcher reaches the named entry/path/exit point in the current player frame.'
        : 'Emit when the related collision helper is entered or returns within the same player collision frame.',
      captureFields: point.captureFields || [],
      capturePolicy: 'capture_field_names_only_runtime_values_not_persisted',
      dispatchKey: point.offset
        ? `rom:${point.offset}|event:${point.eventKind || 'collision'}`
        : `label:${point.label || point.id}|event:${point.eventKind || 'collision'}`,
      requiredByPlanIds: requiredByPlans.map(plan => plan.id),
      requiredByFlowIds: uniqueSorted(requiredByPlans.map(plan => plan.flowId)),
      requiredByStateSlots: uniqueSorted(requiredByPlans.map(plan => String(plan.stateSlot))),
      runtimeHookStatus: point.runtimeHookStatus,
      persistedRomByteCount: 0,
      persistedPixelCount: 0,
      persistedHashCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
      persistedRegisterTraceCount: 0,
      persistedCollisionCellValueCount: 0,
    };
  });

  const promotionGateFixtures = gatePoints.map(point => {
    const requiredByPlans = plansByPointId.get(point.id) || [];
    return {
      id: fixtureId('player_collision_promotion_gate_fixture', point.id),
      sourceHookId: point.id,
      sourceFamily: 'player_collision',
      label: point.label || 'metadata_gate',
      eventKind: point.eventKind || 'engine_port_promotion_gate',
      requiredEvidence: point.captureFields || [],
      requiredByPlanIds: requiredByPlans.map(plan => plan.id),
      requiredByFlowIds: uniqueSorted(requiredByPlans.map(plan => plan.flowId)),
      requiredByStateSlots: uniqueSorted(requiredByPlans.map(plan => String(plan.stateSlot))),
      evaluationModel: 'Evaluate after all linked collision runtime hook events share one same_frame_trace_id.',
      runtimeHookStatus: point.runtimeHookStatus,
      persistedRomByteCount: 0,
      persistedPixelCount: 0,
      persistedHashCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
      persistedRegisterTraceCount: 0,
      persistedCollisionCellValueCount: 0,
    };
  });

  const planFixtures = (sourceCatalog.tracePlans || []).map(plan => {
    const runtimeIds = planRuntimeHookIds(plan, runtimeHookIdSet);
    const gateIds = planPromotionGateIds(plan, gateIdSet);
    const callsiteRegions = uniqueSorted((plan.callSites || [])
      .map(site => site.componentRegion?.id)
      .filter(Boolean));
    return {
      id: fixtureId('player_collision_trace_plan_fixture', plan.id),
      sourcePlanId: plan.id,
      sourceFamily: 'player_collision',
      flowId: plan.flowId,
      stateSlot: plan.stateSlot,
      primaryLabel: plan.primaryLabel,
      role: plan.role,
      traceStatus: 'metadata_ready_runtime_values_missing',
      callSites: (plan.callSites || []).map(site => ({
        componentLabel: site.componentLabel,
        componentRegion: site.componentRegion || null,
        line: site.line,
        op: site.op,
        sequenceIndex: site.sequenceIndex,
      })),
      callsiteRegionIds: callsiteRegions,
      coOccurringPhysicsCallLabels: plan.coOccurringPhysicsCallLabels || [],
      transitionWriteCount: plan.transitionWriteCount || 0,
      motionWriteCount: plan.motionWriteCount || 0,
      requiredRamAddresses: plan.requiredRamAddresses || [],
      runtimeHookFixtureIds: runtimeIds.map(id => fixtureId('player_collision_runtime_hook_fixture', id)),
      promotionGateFixtureIds: gateIds.map(id => fixtureId('player_collision_promotion_gate_fixture', id)),
      captureFieldNames: uniqueSorted([
        ...hookCaptureFields(pointById, runtimeIds),
        ...hookCaptureFields(pointById, gateIds),
        ...(plan.requiredProofFields || []),
      ]),
      collisionBufferProvenanceRequirement: plan.collisionBufferProvenanceRequirement || null,
      promotionGate: plan.promotionGate || null,
      harnessStatus: 'metadata_ready_runtime_values_missing',
      persistedRomByteCount: 0,
      persistedPixelCount: 0,
      persistedHashCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
      persistedRegisterTraceCount: 0,
      persistedCollisionCellValueCount: 0,
    };
  });

  const requiredRamFixtures = (sourceCatalog.requiredRam || []).map(item => ({
    id: fixtureId('player_collision_required_ram_fixture', item.address),
    address: item.address,
    symbol: item.symbol,
    role: item.role,
    confidence: item.confidence,
    ram: compactRam(findRamByAddress(mapData, item.address)),
    capturePolicy: item.capturePolicy || 'runtime_value_may_be_observed_locally_but_not_persisted_in_project_metadata',
  }));

  return {
    hookFixtures,
    promotionGateFixtures,
    planFixtures,
    requiredRamFixtures,
    runtimeHookIdSet,
    gateIdSet,
    pointById,
  };
}

function validateFixtures(mapData, sourceCatalog, fixtures) {
  const allPointIds = new Set((sourceCatalog.traceEventPoints || []).map(point => point.id));
  const runtimeFixtureIds = new Set(fixtures.hookFixtures.map(fixture => fixture.id));
  const gateFixtureIds = new Set(fixtures.promotionGateFixtures.map(fixture => fixture.id));
  const unknownEventPointReferences = [];
  const plansWithoutRuntimeHooks = [];
  const plansWithoutPromotionGates = [];
  const planFixtureMissingRuntimeLinks = [];
  const planFixtureMissingGateLinks = [];

  for (const plan of sourceCatalog.tracePlans || []) {
    const pointRefs = plan.traceEventPointIds || [];
    const unknownRefs = pointRefs.filter(id => !allPointIds.has(id));
    if (unknownRefs.length) unknownEventPointReferences.push({ planId: plan.id, flowId: plan.flowId, unknownRefs });
    const runtimeRefs = planRuntimeHookIds(plan, fixtures.runtimeHookIdSet);
    const gateRefs = planPromotionGateIds(plan, fixtures.gateIdSet);
    if (!runtimeRefs.length) plansWithoutRuntimeHooks.push({ planId: plan.id, flowId: plan.flowId });
    if (!gateRefs.length) plansWithoutPromotionGates.push({ planId: plan.id, flowId: plan.flowId });
  }

  for (const fixture of fixtures.planFixtures || []) {
    const missingRuntime = (fixture.runtimeHookFixtureIds || []).filter(id => !runtimeFixtureIds.has(id));
    const missingGates = (fixture.promotionGateFixtureIds || []).filter(id => !gateFixtureIds.has(id));
    if (missingRuntime.length) planFixtureMissingRuntimeLinks.push({ planFixtureId: fixture.id, missingRuntime });
    if (missingGates.length) planFixtureMissingGateLinks.push({ planFixtureId: fixture.id, missingGates });
  }

  const runtimeHooksWithoutRegion = fixtures.hookFixtures.filter(fixture => !fixture.region?.id).map(fixture => fixture.sourceHookId);
  const runtimeHooksWithoutOffset = fixtures.hookFixtures.filter(fixture => !fixture.romOffset).map(fixture => fixture.sourceHookId);
  const runtimeHooksWithoutPlan = fixtures.hookFixtures.filter(fixture => !(fixture.requiredByPlanIds || []).length).map(fixture => fixture.sourceHookId);
  const requiredRamMissing = fixtures.requiredRamFixtures
    .filter(fixture => !fixture.ram)
    .map(fixture => ({ address: fixture.address, symbol: fixture.symbol, role: fixture.role }));
  const duplicateEventPointIds = duplicateValues((sourceCatalog.traceEventPoints || []).map(point => point.id));
  const duplicatePlanIds = duplicateValues((sourceCatalog.tracePlans || []).map(plan => plan.id));
  const duplicateFixtureIds = duplicateValues([
    ...fixtures.hookFixtures.map(fixture => fixture.id),
    ...fixtures.promotionGateFixtures.map(fixture => fixture.id),
    ...fixtures.planFixtures.map(fixture => fixture.id),
    ...fixtures.requiredRamFixtures.map(fixture => fixture.id),
  ]);
  const forbiddenCaptureFieldHints = uniqueSorted([
    ...fixtures.hookFixtures.flatMap(fixture => fixture.captureFields || []),
    ...fixtures.promotionGateFixtures.flatMap(fixture => fixture.requiredEvidence || []),
    ...fixtures.planFixtures.flatMap(fixture => fixture.captureFieldNames || []),
  ].filter(field => /romBytes|decodedTiles|tileValues|collisionCellValues|pixels|screenshots|audioSamples|instructionBytes|registerTracePayloads|hashes/i.test(field)));

  const issueCount =
    unknownEventPointReferences.length +
    plansWithoutRuntimeHooks.length +
    plansWithoutPromotionGates.length +
    planFixtureMissingRuntimeLinks.length +
    planFixtureMissingGateLinks.length +
    runtimeHooksWithoutRegion.length +
    runtimeHooksWithoutOffset.length +
    requiredRamMissing.length +
    duplicateEventPointIds.length +
    duplicatePlanIds.length +
    duplicateFixtureIds.length;

  return {
    unknownEventPointReferences,
    plansWithoutRuntimeHooks,
    plansWithoutPromotionGates,
    planFixtureMissingRuntimeLinks,
    planFixtureMissingGateLinks,
    runtimeHooksWithoutRegion,
    runtimeHooksWithoutOffset,
    runtimeHooksWithoutPlan,
    requiredRamMissing,
    duplicateEventPointIds,
    duplicatePlanIds,
    duplicateFixtureIds,
    forbiddenCaptureFieldHints,
    issueCount,
    readyForRuntimeHarness: issueCount === 0,
  };
}

function buildCatalog(mapData) {
  const sourceCatalog = requireCatalog(mapData, sourceCatalogId);
  const fixtures = buildFixtures(mapData, sourceCatalog);
  const validation = validateFixtures(mapData, sourceCatalog, fixtures);
  const uniqueCaptureFields = uniqueSorted(fixtures.planFixtures.flatMap(plan => plan.captureFieldNames || []));
  const planHookEdges = sumBy(fixtures.planFixtures, plan => (plan.runtimeHookFixtureIds || []).length);
  const planGateEdges = sumBy(fixtures.planFixtures, plan => (plan.promotionGateFixtureIds || []).length);

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [sourceCatalogId],
    assetPolicy: 'Metadata only: fixture ids, hook labels, offsets, region ids, ASM line references, flow ids, call lines, RAM symbol addresses, capture field names, counts, validation issues, and catalog links. No ROM bytes, decoded graphics, screen pixels, collision cell values, runtime register payloads, hashes, instruction bytes, audio bytes, or samples are embedded.',
    target: {
      sourceScaffoldCatalogId: sourceCatalogId,
      purpose: 'Expose a stable runtime hook fixture contract for proving the player collision pipeline before a clean JavaScript engine port.',
    },
    summary: {
      sourceTracePlanCount: sourceCatalog.summary?.tracePlanCount || 0,
      tracePlanFixtureCount: fixtures.planFixtures.length,
      runtimeHookFixtureCount: fixtures.hookFixtures.length,
      promotionGateFixtureCount: fixtures.promotionGateFixtures.length,
      requiredRamFixtureCount: fixtures.requiredRamFixtures.length,
      planHookEdgeCount: planHookEdges,
      planGateEdgeCount: planGateEdges,
      uniqueCaptureFieldCount: uniqueCaptureFields.length,
      uniqueCaptureFields,
      stateSlots: sourceCatalog.summary?.stateSlots || uniqueSorted(fixtures.planFixtures.map(plan => String(plan.stateSlot))),
      requiredRamFoundCount: fixtures.requiredRamFixtures.filter(fixture => fixture.ram).length,
      addressableRuntimeHookCount: fixtures.hookFixtures.filter(fixture => fixture.addressable).length,
      unresolvedRuntimeHookCount: fixtures.hookFixtures.filter(fixture => !fixture.addressable).length,
      runtimeHooksWithoutPlanCount: validation.runtimeHooksWithoutPlan.length,
      validationIssueCount: validation.issueCount,
      readyForRuntimeHarness: validation.readyForRuntimeHarness,
      eventKindCounts: countBy(fixtures.hookFixtures, fixture => fixture.eventKind),
      runtimeTraceConfirmedCount: sourceCatalog.summary?.runtimeTraceConfirmedCount || 0,
      promotionReadyCount: 0,
      enginePortReady: false,
      coverageChangedByThisAudit: false,
      persistedRomByteCount: 0,
      persistedPixelCount: 0,
      persistedHashCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
      persistedRegisterTraceCount: 0,
      persistedCollisionCellValueCount: 0,
    },
    emulatorEventContract: {
      eventKeys: [
        'hookFixtureId',
        'sourceHookId',
        'same_frame_trace_id',
        'frame',
        'pc',
        'sourceFamily',
        'flowId',
        'stateSlot',
        'eventKind',
        'capturedFieldNames',
        'planFixtureIds',
      ],
      persistPolicy: 'Runtime values may be inspected locally by the analyzer but must not be written into repository metadata.',
      sameFrameGateModel: 'Each collision trace plan requires all linked runtime hook events and the linked metadata gate evidence in the same same_frame_trace_id.',
      forbiddenPersistedFields: sourceCatalog.forbiddenPersistedFields || [],
    },
    hookFixtures: fixtures.hookFixtures,
    promotionGateFixtures: fixtures.promotionGateFixtures,
    planFixtures: fixtures.planFixtures,
    requiredRamFixtures: fixtures.requiredRamFixtures,
    validation,
    evidence: [
      `${sourceCatalogId} supplies the collision event ids, labels, capture field names, flow plans, required RAM fields, and promotion gate normalized into this fixture catalog.`,
      'Each runtime hook fixture is addressable only when the source event point has both a mapped region and a ROM offset.',
      'Each trace plan fixture links one player-state collision call site to all required runtime hook fixtures and the metadata gate without storing runtime values.',
      'The fixture contract preserves the source scaffold rule that _RAM_CB00_ may be persisted only as provenance id/classes, not collision cell values.',
    ],
    nextLeads: [
      'Wire clean-runtime or analyzer emulator callbacks to hookFixtures.dispatchKey and emit collision trace events in memory only.',
      'Use planFixtures.runtimeHookFixtureIds and promotionGateFixtureIds to require same-frame proof for each player-state collision flow.',
      'After reviewed runtime proof exists, update the source collision scaffold catalog with runtimeTraceConfirmed and only then port _LABEL_1446_ into shared/wb3/player-physics.js.',
    ],
  };
}

function addRegionDetail(details, regionId, role, fixture = null) {
  if (!regionId) return;
  if (!details.has(regionId)) {
    details.set(regionId, {
      roles: new Set(),
      fixtureIds: new Set(),
      sourceHookIds: new Set(),
      sourcePlanIds: new Set(),
      flowIds: new Set(),
      stateSlots: new Set(),
      callLines: new Set(),
    });
  }
  const detail = details.get(regionId);
  detail.roles.add(role);
  if (!fixture) return;
  detail.fixtureIds.add(fixture.id);
  if (fixture.sourceHookId) detail.sourceHookIds.add(fixture.sourceHookId);
  if (fixture.sourcePlanId) detail.sourcePlanIds.add(fixture.sourcePlanId);
  if (fixture.flowId) detail.flowIds.add(fixture.flowId);
  if (fixture.stateSlot != null) detail.stateSlots.add(String(fixture.stateSlot));
  for (const callSite of fixture.callSites || []) detail.callLines.add(String(callSite.line));
}

function annotateRegions(mapData, catalog) {
  const details = new Map();
  const changedRegions = [];
  const missingRegions = [];

  for (const fixture of catalog.hookFixtures || []) {
    addRegionDetail(details, fixture.region?.id, 'player_collision_runtime_hook_fixture_region', fixture);
  }
  for (const fixture of catalog.planFixtures || []) {
    for (const regionId of fixture.callsiteRegionIds || []) {
      addRegionDetail(details, regionId, 'player_collision_runtime_trace_plan_callsite_region', fixture);
    }
  }

  for (const [regionId, detail] of details) {
    const region = findRegionById(mapData, regionId);
    if (!region) {
      missingRegions.push({ id: regionId, role: [...detail.roles].sort().join(',') });
      continue;
    }
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.playerCollisionRuntimeHookFixtureAudit = {
        catalogId,
        sourceCatalogId,
        role: [...detail.roles].sort().join(','),
        confidence: 'medium_high',
        summary: 'Region participates in the metadata-only runtime hook fixture contract for proving the player collision pipeline before engine port.',
        detail: {
          fixtureIds: uniqueSorted([...detail.fixtureIds]),
          sourceHookIds: uniqueSorted([...detail.sourceHookIds]),
          sourcePlanIds: uniqueSorted([...detail.sourcePlanIds]),
          flowIds: uniqueSorted([...detail.flowIds]),
          stateSlots: uniqueSorted([...detail.stateSlots]),
          callLines: uniqueSorted([...detail.callLines]),
          readyForRuntimeHarness: catalog.summary.readyForRuntimeHarness,
          validationIssueCount: catalog.summary.validationIssueCount,
          enginePortReady: catalog.summary.enginePortReady,
        },
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type,
      name: region.name || '',
      role: [...detail.roles].sort().join(','),
      fixtureCount: detail.fixtureIds.size,
      flowIds: uniqueSorted([...detail.flowIds]),
    });
  }

  return { changedRegions, missingRegions };
}

function annotateRam(mapData, catalog) {
  const changedRam = [];
  const missingRam = [];

  for (const fixture of catalog.requiredRamFixtures || []) {
    const ram = findRamByAddress(mapData, fixture.address);
    if (!ram) {
      missingRam.push({ address: fixture.address, symbol: fixture.symbol || '', role: fixture.role || '' });
      continue;
    }
    if (apply) {
      ram.analysis = ram.analysis || {};
      ram.analysis.playerCollisionRuntimeHookFixtureAudit = {
        catalogId,
        sourceCatalogId,
        symbol: fixture.symbol || '',
        role: fixture.role || '',
        confidence: fixture.confidence || 'medium',
        summary: 'RAM variable is a named capture seed in the player collision runtime hook fixture contract. Runtime values remain local observations and are not project metadata.',
        capturePolicy: fixture.capturePolicy,
        runtimeHookFixtureCount: catalog.summary.runtimeHookFixtureCount,
        tracePlanFixtureCount: catalog.summary.tracePlanFixtureCount,
        readyForRuntimeHarness: catalog.summary.readyForRuntimeHarness,
        enginePortReady: catalog.summary.enginePortReady,
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRam.push({
      address: fixture.address,
      symbol: fixture.symbol || '',
      role: fixture.role || '',
      confidence: fixture.confidence || 'medium',
      capturePolicy: fixture.capturePolicy,
    });
  }

  return { changedRam, missingRam };
}

function reportSample(catalog) {
  return {
    summary: catalog.summary,
    hookFixtures: catalog.hookFixtures.map(fixture => ({
      id: fixture.id,
      sourceHookId: fixture.sourceHookId,
      eventKind: fixture.eventKind,
      regionId: fixture.region?.id || null,
      romOffset: fixture.romOffset,
      requiredByPlanCount: (fixture.requiredByPlanIds || []).length,
      addressable: fixture.addressable,
    })),
    planFixtures: catalog.planFixtures.map(fixture => ({
      id: fixture.id,
      flowId: fixture.flowId,
      stateSlot: fixture.stateSlot,
      runtimeHookFixtureCount: (fixture.runtimeHookFixtureIds || []).length,
      promotionGateFixtureCount: (fixture.promotionGateFixtureIds || []).length,
      requiredRamCount: (fixture.requiredRamAddresses || []).length,
      harnessStatus: fixture.harnessStatus,
    })),
    validation: {
      issueCount: catalog.validation.issueCount,
      readyForRuntimeHarness: catalog.validation.readyForRuntimeHarness,
      runtimeHooksWithoutPlan: catalog.validation.runtimeHooksWithoutPlan,
      forbiddenCaptureFieldHints: catalog.validation.forbiddenCaptureFieldHints,
    },
  };
}

function applyCatalog(mapData, catalog, annotation) {
  mapData.runtimeTraceHookFixtureCatalogs = (mapData.runtimeTraceHookFixtureCatalogs || []).filter(item => item.id !== catalogId);
  mapData.runtimeTraceHookFixtureCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'player_collision_runtime_hook_fixture_audit',
    generatedAt: now,
    tool: `${toolName} --apply`,
    schemaVersion,
    catalogId,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: catalog.summary,
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
    changedRam: annotation.changedRam,
    missingRam: annotation.missingRam,
    sample: reportSample(catalog),
    assetPolicy: catalog.assetPolicy,
    evidence: catalog.evidence,
    nextLeads: catalog.nextLeads,
  });
}

function insertAfter(list, afterId, newId) {
  const out = (list || []).filter(id => id !== newId);
  const index = out.indexOf(afterId);
  if (index === -1) out.push(newId);
  else out.splice(index + 1, 0, newId);
  return out;
}

function applyStaticMap(catalog) {
  if (!fs.existsSync(staticMapPath)) return null;
  const staticMap = readJson(staticMapPath);
  staticMap.analyzedAt = now;
  staticMap.summary = staticMap.summary || {};
  staticMap.summary.playerCollisionRuntimeHookFixtureCatalog = catalogId;
  staticMap.summary.playerCollisionRuntimeHookFixtureTracePlans = catalog.summary.tracePlanFixtureCount;
  staticMap.summary.playerCollisionRuntimeHookFixtureRuntimeHooks = catalog.summary.runtimeHookFixtureCount;
  staticMap.summary.playerCollisionRuntimeHookFixturePromotionGates = catalog.summary.promotionGateFixtureCount;
  staticMap.summary.playerCollisionRuntimeHookFixtureRequiredRam = catalog.summary.requiredRamFixtureCount;
  staticMap.summary.playerCollisionRuntimeHookFixturePlanHookEdges = catalog.summary.planHookEdgeCount;
  staticMap.summary.playerCollisionRuntimeHookFixtureValidationIssues = catalog.summary.validationIssueCount;
  staticMap.summary.playerCollisionRuntimeHookFixtureReady = catalog.summary.readyForRuntimeHarness;
  staticMap.summary.playerCollisionRuntimeHookFixtureEnginePortReady = catalog.summary.enginePortReady;
  staticMap.summary.playerCollisionRuntimeHookFixtureCoverageChanged = catalog.summary.coverageChangedByThisAudit;

  staticMap.primaryCatalogs = staticMap.primaryCatalogs || {};
  for (const bucket of ['gameplay', 'coverage']) {
    staticMap.primaryCatalogs[bucket] = insertAfter(
      staticMap.primaryCatalogs[bucket],
      sourceCatalogId,
      catalogId
    );
  }

  staticMap.nextLeads = (staticMap.nextLeads || []).filter(note => !note.includes(catalogId));
  const note = 'Use world-player-collision-runtime-hook-fixture-catalog-2026-06-26 as the clean-runtime/analyzer callback contract for proving the player collision pipeline without persisting runtime values.';
  const anchor = staticMap.nextLeads.findIndex(noteText => noteText.includes(sourceCatalogId));
  if (anchor === -1) staticMap.nextLeads.push(note);
  else staticMap.nextLeads.splice(anchor + 1, 0, note);

  writeJson(staticMapPath, staticMap);
  return {
    staticMapPath: path.relative(repoRoot, staticMapPath),
    summaryFieldsUpdated: [
      'playerCollisionRuntimeHookFixtureCatalog',
      'playerCollisionRuntimeHookFixtureTracePlans',
      'playerCollisionRuntimeHookFixtureRuntimeHooks',
      'playerCollisionRuntimeHookFixturePromotionGates',
      'playerCollisionRuntimeHookFixtureRequiredRam',
      'playerCollisionRuntimeHookFixturePlanHookEdges',
      'playerCollisionRuntimeHookFixtureValidationIssues',
      'playerCollisionRuntimeHookFixtureReady',
      'playerCollisionRuntimeHookFixtureEnginePortReady',
      'playerCollisionRuntimeHookFixtureCoverageChanged',
    ],
    primaryCatalogBucketsUpdated: ['gameplay', 'coverage'],
  };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const regionAnnotation = annotateRegions(mapData, catalog);
  const ramAnnotation = annotateRam(mapData, catalog);
  const annotation = { ...regionAnnotation, ...ramAnnotation };
  let staticMapUpdate = null;

  if (apply) {
    applyCatalog(mapData, catalog, annotation);
    writeJson(mapPath, mapData);
    staticMapUpdate = applyStaticMap(catalog);
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    reportId,
    summary: catalog.summary,
    validation: catalog.validation,
    sample: reportSample(catalog),
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
    changedRam: annotation.changedRam,
    missingRam: annotation.missingRam,
    staticMapUpdate,
  }, null, 2));
}

main();
