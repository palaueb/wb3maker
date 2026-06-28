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
const toolName = 'tools/world-dynamic-graphics-runtime-hook-index-audit.mjs';
const catalogId = 'world-dynamic-graphics-runtime-hook-index-catalog-2026-06-26';
const reportId = 'dynamic-graphics-runtime-hook-index-audit-2026-06-26';
const schemaVersion = 1;

const sourceCatalogIds = {
  dynamicRoutePriority: 'world-graphics-dynamic-route-priority-catalog-2026-06-26',
  a48FrameTraceScaffold: 'world-player-a48-frame-trace-scaffold-catalog-2026-06-26',
  dynamic998A97FrameTraceScaffold: 'world-graphics-998-a97-frame-trace-scaffold-catalog-2026-06-26',
  runtimeEffectIndex: 'world-runtime-effect-index-catalog-2026-06-26',
  runtimeRamTraceSeed: 'world-runtime-ram-trace-seed-catalog-2026-06-26',
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
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

function normalizeEvent(sourceFamily, point) {
  const isGate = point.eventKind === 'coverage_promotion_gate';
  return {
    id: `${sourceFamily}_${point.id}`,
    sourceFamily,
    sourceEventPointId: point.id,
    label: point.label || '',
    region: point.region || null,
    offset: point.offset || null,
    asmLineEvidence: point.asmLineEvidence || [],
    eventKind: point.eventKind || '',
    captureFields: point.captureFields || [],
    reason: point.reason || '',
    runtimeHookStatus: point.runtimeHookStatus || 'runtime_hook_needed',
    hookClass: isGate ? 'metadata_promotion_gate' : 'runtime_trace_hook',
    triggerModel: isGate
      ? 'Evaluate after all same-frame hook events for one dynamic upload have been collected.'
      : 'Emit when the clean emulator reaches this routine label/offset with the listed RAM/register context available.',
    persistedRomByteCount: 0,
    persistedHashCount: 0,
    persistedInstructionByteCount: 0,
    persistedRegisterTraceCount: 0,
  };
}

function normalizePlan(sourceFamily, plan) {
  const sourceBytes = plan.localVerification?.sourceByteCount || plan.range?.sizeBytes || 0;
  const localNonzeroByteCount = plan.localVerification?.nonzeroByteCount || 0;
  const priorityClass = sourceFamily === 'a48'
    ? plan.queueKind
    : plan.priorityAction;
  return {
    id: `${sourceFamily}_${plan.id}`,
    sourceFamily,
    sourcePlanId: plan.id,
    spanId: plan.spanId,
    priorityClass,
    traceStatus: plan.traceStatus || '',
    region: plan.region || null,
    range: plan.range || null,
    sourceBank: plan.sourceBank || '',
    sourceRecordHighBytes: plan.sourceRecordHighBytes || [],
    sourceRecordWords: plan.sourceRecordWords || [],
    sourceByteCount: sourceBytes,
    localNonzeroByteCount,
    nonblankTileCount: plan.nonblankTileCount || 0,
    traceEventPointIds: (plan.traceEventPointIds || []).map(id => `${sourceFamily}_${id}`),
    ramTraceSeeds: plan.selectorRamTraceSeeds || plan.ramTraceSeeds || [],
    routeSummary: sourceFamily === 'a48'
      ? {
          routeId: 'record_derived_a48_player_animation_path',
          streamOffsets: plan.candidateA48Streams?.allStreamOffsets || [],
          commandStreamOffsets: plan.commandSelectorInputs?.commandStreamOffsets || [],
          commandPointerOffsets: plan.commandSelectorInputs?.commandPointerOffsets || [],
        }
      : {
          routeId: plan.routeId || 'record_derived_998_or_dynamic_decode_path',
          primaryRoutineLabels: plan.primaryRoute?.routineLabels || [],
          primaryCallerLabels: plan.primaryRoute?.callerLabels || [],
          expectedD0F3Values: plan.expectedD0F3Values || [],
        },
    blockers: {
      runtimeTraceConfirmed: Boolean(plan.runtimeTraceConfirmed || plan.promotionGate?.runtimeTraceConfirmed),
      promotionReady: Boolean(plan.promotionReady || plan.promotionGate?.promotionReady),
      acceptedGapGuarded: Boolean(plan.acceptedGapGuard),
      a97DecodeGuarded: Boolean(plan.a97DecodeGuard),
      consumerProofGuarded: Boolean(plan.consumerProofGuard),
      coverageChangedByThisAudit: false,
    },
    promotionGate: plan.promotionGate || {
      sameFrameRequired: true,
      requiredEvidence: [],
      runtimeTraceConfirmed: false,
      promotionReady: false,
      coverageChangedByThisAudit: false,
    },
    evidenceCatalogs: plan.evidenceCatalogs || [],
    persistedRomByteCount: 0,
    persistedHashCount: 0,
    persistedPixelCount: 0,
    persistedAudioByteCount: 0,
    persistedInstructionByteCount: 0,
    persistedRegisterTraceCount: 0,
  };
}

function buildCatalog(mapData) {
  const routePriority = requireCatalog(mapData, sourceCatalogIds.dynamicRoutePriority);
  const a48Scaffold = requireCatalog(mapData, sourceCatalogIds.a48FrameTraceScaffold);
  const dynamicScaffold = requireCatalog(mapData, sourceCatalogIds.dynamic998A97FrameTraceScaffold);
  requireCatalog(mapData, sourceCatalogIds.runtimeEffectIndex);
  requireCatalog(mapData, sourceCatalogIds.runtimeRamTraceSeed);

  const hookSpecs = [
    ...(dynamicScaffold.traceEventPoints || []).map(point => normalizeEvent('dynamic998A97', point)),
    ...(a48Scaffold.traceEventPoints || []).map(point => normalizeEvent('a48', point)),
  ];
  const runtimeHooks = hookSpecs.filter(hook => hook.hookClass === 'runtime_trace_hook');
  const promotionGates = hookSpecs.filter(hook => hook.hookClass === 'metadata_promotion_gate');
  const tracePlans = [
    ...(dynamicScaffold.tracePlans || []).map(plan => normalizePlan('dynamic998A97', plan)),
    ...(a48Scaffold.tracePlans || []).map(plan => normalizePlan('a48', plan)),
  ];
  const ramTraceSeeds = [...new Map([
    ...(dynamicScaffold.ramTraceSeeds || []),
    ...(a48Scaffold.selectorRamTraceSeeds || []),
    ...tracePlans.flatMap(plan => plan.ramTraceSeeds || []),
  ].map(seed => [seed.address || seed.symbol, seed])).values()];
  const seedRegions = uniqueSorted(tracePlans.map(plan => plan.region?.id));
  const participatingRegions = uniqueSorted([
    ...hookSpecs.map(hook => hook.region?.id),
    ...tracePlans.map(plan => plan.region?.id),
  ]);

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: Object.values(sourceCatalogIds),
    assetPolicy: 'Metadata only: offsets, labels, region ids, RAM symbols, source-record words, trace event ids, proof fields, counts, and catalog links. No ROM bytes, decoded graphics, pixels, screenshots, hashes, audio, text, instruction bytes, or register traces are embedded.',
    target: {
      sourceRoutePriorityCatalogId: sourceCatalogIds.dynamicRoutePriority,
      sourceScaffoldCatalogIds: [
        sourceCatalogIds.dynamic998A97FrameTraceScaffold,
        sourceCatalogIds.a48FrameTraceScaffold,
      ],
      reason: 'Provide one runtime-hook index for all 31 locally verified dynamic graphics source spans before any coverage promotion.',
    },
    summary: {
      sourcePriorityEntryCount: routePriority.summary?.priorityEntryCount || 0,
      tracePlanEntryCount: tracePlans.length,
      dynamic998A97TracePlanCount: tracePlans.filter(plan => plan.sourceFamily === 'dynamic998A97').length,
      a48TracePlanCount: tracePlans.filter(plan => plan.sourceFamily === 'a48').length,
      hookSpecCount: hookSpecs.length,
      runtimeHookSpecCount: runtimeHooks.length,
      promotionGateCount: promotionGates.length,
      ramTraceSeedCount: ramTraceSeeds.length,
      seedRegionCount: seedRegions.length,
      seedRegionIds: seedRegions,
      participatingRegionCount: participatingRegions.length,
      participatingRegionIds: participatingRegions,
      sourceBankCount: new Set(tracePlans.map(plan => plan.sourceBank).filter(Boolean)).size,
      sourceBanks: uniqueSorted(tracePlans.map(plan => plan.sourceBank)),
      sourceRecordHighBytes: uniqueSorted(tracePlans.flatMap(plan => plan.sourceRecordHighBytes || [])),
      sourceRecordWords: uniqueSorted(tracePlans.flatMap(plan => plan.sourceRecordWords || [])),
      sourceByteCount: sumBy(tracePlans, plan => plan.sourceByteCount || 0),
      localNonzeroByteCount: sumBy(tracePlans, plan => plan.localNonzeroByteCount || 0),
      nonblankTileCount: routePriority.summary?.nonblankTileCount ||
        sumBy(tracePlans, plan => plan.nonblankTileCount || 0),
      sourceFamilyCounts: countBy(tracePlans, plan => plan.sourceFamily),
      priorityClassCounts: countBy(tracePlans, plan => plan.priorityClass),
      hookClassCounts: countBy(hookSpecs, hook => hook.hookClass),
      eventKindCounts: countBy(hookSpecs, hook => hook.eventKind),
      hookStatusCounts: countBy(hookSpecs, hook => hook.runtimeHookStatus),
      guardedPlanCounts: {
        acceptedGapGuarded: tracePlans.filter(plan => plan.blockers.acceptedGapGuarded).length,
        a97DecodeGuarded: tracePlans.filter(plan => plan.blockers.a97DecodeGuarded).length,
        consumerProofGuarded: tracePlans.filter(plan => plan.blockers.consumerProofGuarded).length,
      },
      runtimeTraceConfirmedCount: tracePlans.filter(plan => plan.blockers.runtimeTraceConfirmed).length,
      promotionReadyCount: tracePlans.filter(plan => plan.blockers.promotionReady).length,
      coverageChangedByThisAudit: false,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
      persistedRegisterTraceCount: 0,
    },
    hookSpecs,
    runtimeHooks,
    promotionGates,
    ramTraceSeeds,
    tracePlans,
    evidence: [
      `${sourceCatalogIds.dynamicRoutePriority} supplies the complete 31-entry dynamic graphics route queue.`,
      `${sourceCatalogIds.dynamic998A97FrameTraceScaffold} supplies the 20 non-A48 998/A97 trace plans and event points.`,
      `${sourceCatalogIds.a48FrameTraceScaffold} supplies the 11 A48 player-animation trace plans and event points.`,
      'This unified index does not promote coverage. It is the metadata contract for later emulator/runtime trace instrumentation.',
    ],
    nextLeads: [
      'Use this catalog as the hook registry when adding emulator trace callbacks for dynamic graphics upload routines.',
      'Emit hook events using the normalized hook ids, then evaluate the promotion gates against same-frame evidence.',
      'After a trace proves a plan, write runtime confirmation back to the source scaffold catalog and then re-run the dynamic coverage audit.',
    ],
  };
}

function addRegionDetail(details, regionId, role, plan = null, hook = null) {
  if (!regionId) return;
  if (!details.has(regionId)) {
    details.set(regionId, {
      roles: new Set(),
      sourceFamilies: new Set(),
      spanIds: new Set(),
      hookIds: new Set(),
      sourceByteCount: 0,
    });
  }
  const detail = details.get(regionId);
  detail.roles.add(role);
  if (plan) {
    detail.sourceFamilies.add(plan.sourceFamily);
    detail.spanIds.add(plan.spanId);
    detail.sourceByteCount += plan.sourceByteCount || 0;
  }
  if (hook) {
    detail.sourceFamilies.add(hook.sourceFamily);
    detail.hookIds.add(hook.id);
  }
}

function annotateRegions(mapData, catalog) {
  const details = new Map();
  const changedRegions = [];
  const missingRegions = [];

  for (const hook of catalog.hookSpecs || []) {
    addRegionDetail(details, hook.region?.id, hook.hookClass, null, hook);
  }
  for (const plan of catalog.tracePlans || []) {
    addRegionDetail(details, plan.region?.id, 'dynamic_graphics_trace_plan_seed_region', plan, null);
  }

  for (const [regionId, detail] of details) {
    const region = findRegionById(mapData, regionId);
    if (!region) {
      missingRegions.push({ id: regionId, role: [...detail.roles].sort().join(',') });
      continue;
    }
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.dynamicGraphicsRuntimeHookIndexAudit = {
        catalogId,
        role: [...detail.roles].sort().join(','),
        confidence: 'medium_high',
        summary: 'Region participates in the unified dynamic graphics runtime hook index used to prove A48 and 998/A97 source spans before coverage promotion.',
        detail: {
          sourceFamilies: uniqueSorted([...detail.sourceFamilies]),
          spanIds: uniqueSorted([...detail.spanIds]),
          hookIds: uniqueSorted([...detail.hookIds]),
          sourceByteCount: detail.sourceByteCount,
          runtimeTraceConfirmedCount: catalog.summary.runtimeTraceConfirmedCount,
          promotionReadyCount: catalog.summary.promotionReadyCount,
          coverageChangedByThisAudit: false,
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
      sourceFamilies: uniqueSorted([...detail.sourceFamilies]),
      spanCount: detail.spanIds.size,
      hookCount: detail.hookIds.size,
    });
  }

  return { changedRegions, missingRegions };
}

function annotateRam(mapData, catalog) {
  const changedRam = [];
  const missingRam = [];
  for (const seed of catalog.ramTraceSeeds || []) {
    const ram = findRamByAddress(mapData, seed.address);
    if (!ram) {
      missingRam.push({ address: seed.address, symbol: seed.symbol, role: seed.role });
      continue;
    }
    if (apply) {
      ram.analysis = ram.analysis || {};
      ram.analysis.dynamicGraphicsRuntimeHookIndexAudit = {
        catalogId,
        symbol: seed.symbol,
        role: seed.role,
        confidence: seed.confidence || 'medium_high',
        summary: 'RAM variable is captured by the unified dynamic graphics runtime hook index for same-frame upload proof.',
        tracePlanEntryCount: catalog.summary.tracePlanEntryCount,
        runtimeHookSpecCount: catalog.summary.runtimeHookSpecCount,
        runtimeTraceConfirmedCount: catalog.summary.runtimeTraceConfirmedCount,
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRam.push({
      address: seed.address,
      symbol: seed.symbol,
      role: seed.role,
      confidence: seed.confidence || 'medium_high',
    });
  }
  return { changedRam, missingRam };
}

function reportSample(catalog) {
  return {
    summary: catalog.summary,
    topHooks: catalog.hookSpecs.slice(0, 24).map(hook => ({
      id: hook.id,
      sourceFamily: hook.sourceFamily,
      label: hook.label,
      regionId: hook.region?.id || null,
      eventKind: hook.eventKind,
      hookClass: hook.hookClass,
      runtimeHookStatus: hook.runtimeHookStatus,
    })),
    topTracePlans: catalog.tracePlans.slice(0, 16).map(plan => ({
      id: plan.id,
      spanId: plan.spanId,
      sourceFamily: plan.sourceFamily,
      priorityClass: plan.priorityClass,
      range: plan.range,
      sourceBank: plan.sourceBank,
      sourceByteCount: plan.sourceByteCount,
      localNonzeroByteCount: plan.localNonzeroByteCount,
      traceStatus: plan.traceStatus,
    })),
  };
}

function applyCatalog(mapData, catalog, annotation) {
  mapData.runtimeTraceHookCatalogs = (mapData.runtimeTraceHookCatalogs || []).filter(item => item.id !== catalogId);
  mapData.runtimeTraceHookCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'dynamic_graphics_runtime_hook_index_audit',
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
  staticMap.summary.dynamicGraphicsRuntimeHookIndexCatalog = catalogId;
  staticMap.summary.dynamicGraphicsRuntimeHookIndexTracePlans = catalog.summary.tracePlanEntryCount;
  staticMap.summary.dynamicGraphicsRuntimeHookIndexRuntimeHooks = catalog.summary.runtimeHookSpecCount;
  staticMap.summary.dynamicGraphicsRuntimeHookIndexPromotionGates = catalog.summary.promotionGateCount;
  staticMap.summary.dynamicGraphicsRuntimeHookIndexRamSeeds = catalog.summary.ramTraceSeedCount;
  staticMap.summary.dynamicGraphicsRuntimeHookIndexSourceBytes = catalog.summary.sourceByteCount;
  staticMap.summary.dynamicGraphicsRuntimeHookIndexRuntimeConfirmed = catalog.summary.runtimeTraceConfirmedCount;
  staticMap.summary.dynamicGraphicsRuntimeHookIndexCoverageChanged = catalog.summary.coverageChangedByThisAudit;

  staticMap.primaryCatalogs = staticMap.primaryCatalogs || {};
  for (const bucket of ['graphics', 'rendering', 'gameplay', 'coverage']) {
    staticMap.primaryCatalogs[bucket] = insertAfter(
      staticMap.primaryCatalogs[bucket],
      sourceCatalogIds.dynamic998A97FrameTraceScaffold,
      catalogId
    );
  }

  staticMap.nextLeads = (staticMap.nextLeads || []).filter(note => !note.includes(catalogId));
  const note = 'Use world-dynamic-graphics-runtime-hook-index-catalog-2026-06-26 as the unified hook registry for proving all 31 dynamic graphics source spans before coverage promotion.';
  const anchor = staticMap.nextLeads.findIndex(noteText => noteText.includes(sourceCatalogIds.dynamic998A97FrameTraceScaffold));
  if (anchor === -1) staticMap.nextLeads.push(note);
  else staticMap.nextLeads.splice(anchor + 1, 0, note);

  writeJson(staticMapPath, staticMap);
  return {
    staticMapPath: path.relative(repoRoot, staticMapPath),
    summaryFieldsUpdated: [
      'dynamicGraphicsRuntimeHookIndexCatalog',
      'dynamicGraphicsRuntimeHookIndexTracePlans',
      'dynamicGraphicsRuntimeHookIndexRuntimeHooks',
      'dynamicGraphicsRuntimeHookIndexPromotionGates',
      'dynamicGraphicsRuntimeHookIndexRamSeeds',
      'dynamicGraphicsRuntimeHookIndexSourceBytes',
      'dynamicGraphicsRuntimeHookIndexRuntimeConfirmed',
      'dynamicGraphicsRuntimeHookIndexCoverageChanged',
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
