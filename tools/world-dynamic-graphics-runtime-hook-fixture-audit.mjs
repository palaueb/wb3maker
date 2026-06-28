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
const toolName = 'tools/world-dynamic-graphics-runtime-hook-fixture-audit.mjs';
const sourceCatalogId = 'world-dynamic-graphics-runtime-hook-index-catalog-2026-06-26';
const catalogId = 'world-dynamic-graphics-runtime-hook-fixture-catalog-2026-06-26';
const reportId = 'dynamic-graphics-runtime-hook-fixture-audit-2026-06-26';
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

function sourceRegion(mapData, ref) {
  return findRegionById(mapData, ref?.id) || ref || null;
}

function fixtureId(prefix, id) {
  return `${prefix}_${String(id || '').replace(/[^A-Za-z0-9_]+/g, '_')}`;
}

function buildPlanIndex(catalog) {
  const plansByHookId = new Map();
  for (const plan of catalog.tracePlans || []) {
    for (const hookId of plan.traceEventPointIds || []) {
      if (!plansByHookId.has(hookId)) plansByHookId.set(hookId, []);
      plansByHookId.get(hookId).push(plan);
    }
  }
  return plansByHookId;
}

function planRuntimeHookIds(plan, runtimeHookIdSet) {
  return (plan.traceEventPointIds || []).filter(id => runtimeHookIdSet.has(id));
}

function planPromotionGateIds(plan, gateIdSet) {
  return (plan.traceEventPointIds || []).filter(id => gateIdSet.has(id));
}

function hookCaptureFields(hooksById, ids) {
  return uniqueSorted(ids.flatMap(id => hooksById.get(id)?.captureFields || []));
}

function buildFixtures(mapData, sourceCatalog) {
  const hooksById = new Map((sourceCatalog.hookSpecs || []).map(hook => [hook.id, hook]));
  const runtimeHooks = (sourceCatalog.hookSpecs || []).filter(hook => hook.hookClass === 'runtime_trace_hook');
  const promotionGates = (sourceCatalog.hookSpecs || []).filter(hook => hook.hookClass === 'metadata_promotion_gate');
  const runtimeHookIdSet = new Set(runtimeHooks.map(hook => hook.id));
  const gateIdSet = new Set(promotionGates.map(hook => hook.id));
  const plansByHookId = buildPlanIndex(sourceCatalog);

  const hookFixtures = runtimeHooks.map(hook => {
    const region = sourceRegion(mapData, hook.region);
    const romOffset = hook.offset || region?.offset || '';
    const requiredByPlans = plansByHookId.get(hook.id) || [];
    return {
      id: fixtureId('runtime_hook_fixture', hook.id),
      sourceHookId: hook.id,
      sourceFamily: hook.sourceFamily || '',
      label: hook.label || '',
      eventKind: hook.eventKind || '',
      region: compactRegion(region),
      romOffset,
      asmLineEvidence: hook.asmLineEvidence || [],
      addressable: Boolean(region?.id && romOffset),
      triggerModel: hook.triggerModel || '',
      captureFields: hook.captureFields || [],
      capturePolicy: 'capture_field_names_only_runtime_values_not_persisted',
      dispatchKey: romOffset ? `rom:${romOffset}|event:${hook.eventKind || 'runtime'}` : `label:${hook.label || hook.id}`,
      requiredByPlanIds: requiredByPlans.map(plan => plan.id),
      requiredBySpanIds: uniqueSorted(requiredByPlans.map(plan => plan.spanId)),
      runtimeHookStatus: hook.runtimeHookStatus || '',
      persistedRomByteCount: 0,
      persistedPixelCount: 0,
      persistedHashCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
      persistedRegisterTraceCount: 0,
    };
  });

  const promotionGateFixtures = promotionGates.map(gate => {
    const requiredByPlans = plansByHookId.get(gate.id) || [];
    return {
      id: fixtureId('promotion_gate_fixture', gate.id),
      sourceHookId: gate.id,
      sourceFamily: gate.sourceFamily || '',
      label: gate.label || 'metadata_gate',
      eventKind: gate.eventKind || 'coverage_promotion_gate',
      requiredEvidence: gate.captureFields || [],
      requiredByPlanIds: requiredByPlans.map(plan => plan.id),
      requiredBySpanIds: uniqueSorted(requiredByPlans.map(plan => plan.spanId)),
      evaluationModel: gate.triggerModel || 'Evaluate after same-frame runtime hooks are collected.',
      runtimeHookStatus: gate.runtimeHookStatus || '',
      persistedRomByteCount: 0,
      persistedPixelCount: 0,
      persistedHashCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
      persistedRegisterTraceCount: 0,
    };
  });

  const planFixtures = (sourceCatalog.tracePlans || []).map(plan => {
    const runtimeIds = planRuntimeHookIds(plan, runtimeHookIdSet);
    const gateIds = planPromotionGateIds(plan, gateIdSet);
    const captureFields = uniqueSorted([
      ...hookCaptureFields(hooksById, runtimeIds),
      ...hookCaptureFields(hooksById, gateIds),
      ...(plan.promotionGate?.requiredEvidence || []),
    ]);
    const region = sourceRegion(mapData, plan.region);
    return {
      id: fixtureId('trace_plan_fixture', plan.id),
      sourcePlanId: plan.id,
      spanId: plan.spanId || '',
      sourceFamily: plan.sourceFamily || '',
      priorityClass: plan.priorityClass || '',
      traceStatus: plan.traceStatus || '',
      sourceRegion: compactRegion(region),
      range: plan.range || null,
      sourceBank: plan.sourceBank || '',
      sourceRecordWords: plan.sourceRecordWords || [],
      sourceByteCount: Number(plan.sourceByteCount || 0),
      localNonzeroByteCount: Number(plan.localNonzeroByteCount || 0),
      nonblankTileCount: Number(plan.nonblankTileCount || 0),
      runtimeHookFixtureIds: runtimeIds.map(id => fixtureId('runtime_hook_fixture', id)),
      promotionGateFixtureIds: gateIds.map(id => fixtureId('promotion_gate_fixture', id)),
      captureFieldNames: captureFields,
      ramTraceSeedAddresses: uniqueSorted((plan.ramTraceSeeds || []).map(seed => seed.address)),
      routeSummary: plan.routeSummary || null,
      blockers: plan.blockers || {},
      promotionGate: plan.promotionGate || null,
      harnessStatus: 'metadata_ready_runtime_values_missing',
      persistedRomByteCount: 0,
      persistedPixelCount: 0,
      persistedHashCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
      persistedRegisterTraceCount: 0,
    };
  });

  return { hookFixtures, promotionGateFixtures, planFixtures, hooksById, runtimeHookIdSet, gateIdSet };
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

function validateFixtures(mapData, sourceCatalog, fixtures) {
  const allHookIds = new Set((sourceCatalog.hookSpecs || []).map(hook => hook.id));
  const runtimeFixtureIds = new Set(fixtures.hookFixtures.map(fixture => fixture.id));
  const gateFixtureIds = new Set(fixtures.promotionGateFixtures.map(fixture => fixture.id));
  const unknownHookReferences = [];
  const plansWithoutRuntimeHooks = [];
  const plansWithoutPromotionGates = [];
  const planFixtureMissingRuntimeLinks = [];
  const planFixtureMissingGateLinks = [];

  for (const plan of sourceCatalog.tracePlans || []) {
    const hookRefs = plan.traceEventPointIds || [];
    const unknownRefs = hookRefs.filter(id => !allHookIds.has(id));
    if (unknownRefs.length) unknownHookReferences.push({ planId: plan.id, spanId: plan.spanId, unknownRefs });
    const runtimeRefs = planRuntimeHookIds(plan, fixtures.runtimeHookIdSet);
    const gateRefs = planPromotionGateIds(plan, fixtures.gateIdSet);
    if (!runtimeRefs.length) plansWithoutRuntimeHooks.push({ planId: plan.id, spanId: plan.spanId });
    if (!gateRefs.length) plansWithoutPromotionGates.push({ planId: plan.id, spanId: plan.spanId });
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
  const duplicateHookIds = duplicateValues((sourceCatalog.hookSpecs || []).map(hook => hook.id));
  const duplicatePlanIds = duplicateValues((sourceCatalog.tracePlans || []).map(plan => plan.id));
  const duplicateFixtureIds = duplicateValues([
    ...fixtures.hookFixtures.map(fixture => fixture.id),
    ...fixtures.promotionGateFixtures.map(fixture => fixture.id),
    ...fixtures.planFixtures.map(fixture => fixture.id),
  ]);
  const missingRamSeeds = (sourceCatalog.ramTraceSeeds || [])
    .filter(seed => !findRamByAddress(mapData, seed.address))
    .map(seed => ({ address: seed.address, symbol: seed.symbol || '', role: seed.role || '' }));

  const issueCount =
    unknownHookReferences.length +
    plansWithoutRuntimeHooks.length +
    plansWithoutPromotionGates.length +
    planFixtureMissingRuntimeLinks.length +
    planFixtureMissingGateLinks.length +
    runtimeHooksWithoutRegion.length +
    runtimeHooksWithoutOffset.length +
    duplicateHookIds.length +
    duplicatePlanIds.length +
    duplicateFixtureIds.length +
    missingRamSeeds.length;

  return {
    unknownHookReferences,
    plansWithoutRuntimeHooks,
    plansWithoutPromotionGates,
    planFixtureMissingRuntimeLinks,
    planFixtureMissingGateLinks,
    runtimeHooksWithoutRegion,
    runtimeHooksWithoutOffset,
    runtimeHooksWithoutPlan,
    duplicateHookIds,
    duplicatePlanIds,
    duplicateFixtureIds,
    missingRamSeeds,
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
  const runtimeHookSourceFamilies = countBy(fixtures.hookFixtures, fixture => fixture.sourceFamily);
  const planSourceFamilies = countBy(fixtures.planFixtures, fixture => fixture.sourceFamily);

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [sourceCatalogId],
    assetPolicy: 'Metadata only: fixture ids, hook labels, offsets, region ids, capture field names, RAM symbol addresses, source span ids, counts, validation issues, and catalog links. No ROM bytes, decoded graphics, pixels, screenshots, hashes, audio, text, instruction bytes, register values, or runtime traces are embedded.',
    target: {
      sourceRuntimeHookIndexCatalogId: sourceCatalogId,
      purpose: 'Expose a stable metadata-only runtime hook fixture contract for proving dynamic graphics source spans before coverage promotion.',
    },
    summary: {
      sourceTracePlanCount: sourceCatalog.summary?.tracePlanEntryCount || 0,
      tracePlanFixtureCount: fixtures.planFixtures.length,
      runtimeHookFixtureCount: fixtures.hookFixtures.length,
      promotionGateFixtureCount: fixtures.promotionGateFixtures.length,
      planHookEdgeCount: planHookEdges,
      planGateEdgeCount: planGateEdges,
      uniqueCaptureFieldCount: uniqueCaptureFields.length,
      uniqueCaptureFields,
      ramTraceSeedCount: sourceCatalog.summary?.ramTraceSeedCount || (sourceCatalog.ramTraceSeeds || []).length,
      sourceByteCount: sourceCatalog.summary?.sourceByteCount || sumBy(fixtures.planFixtures, plan => plan.sourceByteCount || 0),
      localNonzeroByteCount: sourceCatalog.summary?.localNonzeroByteCount || sumBy(fixtures.planFixtures, plan => plan.localNonzeroByteCount || 0),
      addressableRuntimeHookCount: fixtures.hookFixtures.filter(fixture => fixture.addressable).length,
      unresolvedRuntimeHookCount: fixtures.hookFixtures.filter(fixture => !fixture.addressable).length,
      runtimeHooksWithoutPlanCount: validation.runtimeHooksWithoutPlan.length,
      validationIssueCount: validation.issueCount,
      readyForRuntimeHarness: validation.readyForRuntimeHarness,
      runtimeHookSourceFamilies,
      planSourceFamilies,
      runtimeTraceConfirmedCount: sourceCatalog.summary?.runtimeTraceConfirmedCount || 0,
      promotionReadyCount: sourceCatalog.summary?.promotionReadyCount || 0,
      coverageChangedByThisAudit: false,
      persistedRomByteCount: 0,
      persistedPixelCount: 0,
      persistedHashCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
      persistedRegisterTraceCount: 0,
    },
    emulatorEventContract: {
      eventKeys: [
        'hookFixtureId',
        'sourceHookId',
        'frame',
        'pc',
        'sourceFamily',
        'eventKind',
        'capturedFieldNames',
        'planFixtureIds',
      ],
      persistPolicy: 'Runtime values may be inspected live by the analyzer but must not be written into repository metadata.',
      sameFrameGateModel: 'Plan promotion requires all linked runtime hook events plus the linked metadata gate evidence in the same frame.',
    },
    hookFixtures: fixtures.hookFixtures,
    promotionGateFixtures: fixtures.promotionGateFixtures,
    planFixtures: fixtures.planFixtures,
    validation,
    evidence: [
      `${sourceCatalogId} supplies the hook ids, labels, capture field names, trace plans, RAM seeds, and promotion gates normalized into this fixture catalog.`,
      'Each runtime hook fixture is addressable only when the source hook has both a mapped region and a ROM offset.',
      'Each trace plan fixture links source span metadata to runtime hook fixtures and metadata gate fixtures without storing runtime values or ROM bytes.',
    ],
    nextLeads: [
      'Wire emulator or clean-engine callbacks to hookFixtures.dispatchKey and emit event records in memory only.',
      'Use planFixtures.runtimeHookFixtureIds and promotionGateFixtureIds to decide when one dynamic graphics span has same-frame proof.',
      'After runtime proof exists, update the source trace scaffold catalog with runtimeTraceConfirmed and rerun the graphics coverage audits.',
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
      sourceFamilies: new Set(),
      sourceByteCount: 0,
    });
  }
  const detail = details.get(regionId);
  detail.roles.add(role);
  if (!fixture) return;
  detail.fixtureIds.add(fixture.id);
  if (fixture.sourceHookId) detail.sourceHookIds.add(fixture.sourceHookId);
  if (fixture.sourcePlanId) detail.sourcePlanIds.add(fixture.sourcePlanId);
  if (fixture.sourceFamily) detail.sourceFamilies.add(fixture.sourceFamily);
  detail.sourceByteCount += fixture.sourceByteCount || 0;
}

function annotateRegions(mapData, catalog) {
  const details = new Map();
  const changedRegions = [];
  const missingRegions = [];

  for (const fixture of catalog.hookFixtures || []) {
    addRegionDetail(details, fixture.region?.id, 'runtime_hook_fixture_region', fixture);
  }
  for (const fixture of catalog.planFixtures || []) {
    addRegionDetail(details, fixture.sourceRegion?.id, 'runtime_trace_plan_fixture_source_region', fixture);
  }

  for (const [regionId, detail] of details) {
    const region = findRegionById(mapData, regionId);
    if (!region) {
      missingRegions.push({ id: regionId, role: [...detail.roles].sort().join(',') });
      continue;
    }
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.dynamicGraphicsRuntimeHookFixtureAudit = {
        catalogId,
        sourceCatalogId,
        role: [...detail.roles].sort().join(','),
        confidence: 'medium_high',
        summary: 'Region is part of the metadata-only runtime hook fixture contract for proving dynamic graphics source spans.',
        detail: {
          fixtureIds: uniqueSorted([...detail.fixtureIds]),
          sourceHookIds: uniqueSorted([...detail.sourceHookIds]),
          sourcePlanIds: uniqueSorted([...detail.sourcePlanIds]),
          sourceFamilies: uniqueSorted([...detail.sourceFamilies]),
          sourceByteCount: detail.sourceByteCount,
          readyForRuntimeHarness: catalog.summary.readyForRuntimeHarness,
          validationIssueCount: catalog.summary.validationIssueCount,
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
      sourceFamilyCount: detail.sourceFamilies.size,
    });
  }

  return { changedRegions, missingRegions };
}

function annotateRam(mapData, catalog) {
  const changedRam = [];
  const missingRam = [];
  const sourceCatalog = requireCatalog(mapData, sourceCatalogId);
  for (const seed of sourceCatalog.ramTraceSeeds || []) {
    const ram = findRamByAddress(mapData, seed.address);
    if (!ram) {
      missingRam.push({ address: seed.address, symbol: seed.symbol || '', role: seed.role || '' });
      continue;
    }
    if (apply) {
      ram.analysis = ram.analysis || {};
      ram.analysis.dynamicGraphicsRuntimeHookFixtureAudit = {
        catalogId,
        sourceCatalogId,
        symbol: seed.symbol || '',
        role: seed.role || '',
        confidence: seed.confidence || 'medium_high',
        summary: 'RAM variable is a named capture seed in the dynamic graphics runtime hook fixture contract.',
        runtimeHookFixtureCount: catalog.summary.runtimeHookFixtureCount,
        tracePlanFixtureCount: catalog.summary.tracePlanFixtureCount,
        readyForRuntimeHarness: catalog.summary.readyForRuntimeHarness,
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRam.push({
      address: seed.address,
      symbol: seed.symbol || '',
      role: seed.role || '',
      confidence: seed.confidence || 'medium_high',
    });
  }
  return { changedRam, missingRam };
}

function reportSample(catalog) {
  return {
    summary: catalog.summary,
    topHookFixtures: catalog.hookFixtures.slice(0, 20).map(fixture => ({
      id: fixture.id,
      sourceHookId: fixture.sourceHookId,
      sourceFamily: fixture.sourceFamily,
      eventKind: fixture.eventKind,
      regionId: fixture.region?.id || null,
      romOffset: fixture.romOffset,
      requiredByPlanCount: (fixture.requiredByPlanIds || []).length,
      addressable: fixture.addressable,
    })),
    topPlanFixtures: catalog.planFixtures.slice(0, 16).map(fixture => ({
      id: fixture.id,
      spanId: fixture.spanId,
      sourceFamily: fixture.sourceFamily,
      runtimeHookFixtureCount: (fixture.runtimeHookFixtureIds || []).length,
      promotionGateFixtureCount: (fixture.promotionGateFixtureIds || []).length,
      sourceByteCount: fixture.sourceByteCount,
      harnessStatus: fixture.harnessStatus,
    })),
    validation: {
      issueCount: catalog.validation.issueCount,
      readyForRuntimeHarness: catalog.validation.readyForRuntimeHarness,
      runtimeHooksWithoutPlan: catalog.validation.runtimeHooksWithoutPlan,
    },
  };
}

function applyCatalog(mapData, catalog, annotation) {
  mapData.runtimeTraceHookFixtureCatalogs = (mapData.runtimeTraceHookFixtureCatalogs || []).filter(item => item.id !== catalogId);
  mapData.runtimeTraceHookFixtureCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'dynamic_graphics_runtime_hook_fixture_audit',
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
  staticMap.summary.dynamicGraphicsRuntimeHookFixtureCatalog = catalogId;
  staticMap.summary.dynamicGraphicsRuntimeHookFixtureTracePlans = catalog.summary.tracePlanFixtureCount;
  staticMap.summary.dynamicGraphicsRuntimeHookFixtureRuntimeHooks = catalog.summary.runtimeHookFixtureCount;
  staticMap.summary.dynamicGraphicsRuntimeHookFixturePromotionGates = catalog.summary.promotionGateFixtureCount;
  staticMap.summary.dynamicGraphicsRuntimeHookFixturePlanHookEdges = catalog.summary.planHookEdgeCount;
  staticMap.summary.dynamicGraphicsRuntimeHookFixtureValidationIssues = catalog.summary.validationIssueCount;
  staticMap.summary.dynamicGraphicsRuntimeHookFixtureReady = catalog.summary.readyForRuntimeHarness;
  staticMap.summary.dynamicGraphicsRuntimeHookFixtureCoverageChanged = catalog.summary.coverageChangedByThisAudit;

  staticMap.primaryCatalogs = staticMap.primaryCatalogs || {};
  for (const bucket of ['graphics', 'rendering', 'gameplay', 'coverage']) {
    staticMap.primaryCatalogs[bucket] = insertAfter(
      staticMap.primaryCatalogs[bucket],
      sourceCatalogId,
      catalogId
    );
  }

  staticMap.nextLeads = (staticMap.nextLeads || []).filter(note => !note.includes(catalogId));
  const note = 'Use world-dynamic-graphics-runtime-hook-fixture-catalog-2026-06-26 as the emulator callback contract for proving dynamic graphics spans from hook events without persisting runtime values.';
  const anchor = staticMap.nextLeads.findIndex(noteText => noteText.includes(sourceCatalogId));
  if (anchor === -1) staticMap.nextLeads.push(note);
  else staticMap.nextLeads.splice(anchor + 1, 0, note);

  writeJson(staticMapPath, staticMap);
  return {
    staticMapPath: path.relative(repoRoot, staticMapPath),
    summaryFieldsUpdated: [
      'dynamicGraphicsRuntimeHookFixtureCatalog',
      'dynamicGraphicsRuntimeHookFixtureTracePlans',
      'dynamicGraphicsRuntimeHookFixtureRuntimeHooks',
      'dynamicGraphicsRuntimeHookFixturePromotionGates',
      'dynamicGraphicsRuntimeHookFixturePlanHookEdges',
      'dynamicGraphicsRuntimeHookFixtureValidationIssues',
      'dynamicGraphicsRuntimeHookFixtureReady',
      'dynamicGraphicsRuntimeHookFixtureCoverageChanged',
    ],
    primaryCatalogBucketsUpdated: ['graphics', 'rendering', 'gameplay', 'coverage'],
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
    sample: reportSample(catalog),
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
    changedRam: annotation.changedRam,
    missingRam: annotation.missingRam,
    staticMapUpdate,
  }, null, 2));
}

main();
