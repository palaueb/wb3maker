#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildResidualRuntimeTraceObservationAudit } from './world-residual-runtime-trace-observation-audit.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const defaultOutputPath = path.join(repoRoot, 'tmp/world-gearsystem-mcp-palette-tail-closure-observation-assembler.local.json');
const defaultObservationsPath = path.join(repoRoot, 'tmp/local-hook-observations.palette-tail-closure.local.json');
const defaultParserReportPath = path.join(repoRoot, 'tmp/world-gearsystem-mcp-palette-parser-entry-observation.local.json');
const defaultParserFailedReportPath = path.join(repoRoot, 'tmp/world-gearsystem-mcp-palette-parser-entry-observation.initialize-failed.local.json');
const defaultParserObservationsPath = path.join(repoRoot, 'tmp/local-hook-observations.palette-parser-entry.local.json');
const defaultTailObservationsPath = path.join(repoRoot, 'tmp/local-hook-observations.palette-tail.local.json');
const defaultPhysicalLiveReportPath = path.join(repoRoot, 'tmp/world-gearsystem-mcp-physical-source-byte-compare-live.local.json');
const defaultPhysicalFailedReportPath = path.join(repoRoot, 'tmp/world-gearsystem-mcp-physical-source-byte-compare-live.initialize-failed.local.json');

const tailObservationCatalogId = 'world-gearsystem-mcp-palette-tail-observation-catalog-2026-06-26';
const parserCaptureCatalogId = 'world-gearsystem-mcp-palette-parser-entry-observation-capture-catalog-2026-06-26';
const physicalCompareCatalogId = 'world-gearsystem-mcp-physical-source-byte-compare-plan-catalog-2026-06-26';
const catalogId = 'world-gearsystem-mcp-palette-tail-closure-observation-assembler-catalog-2026-06-26';
const reportId = 'gearsystem-mcp-palette-tail-closure-observation-assembler-2026-06-26';
const toolName = 'tools/world-gearsystem-mcp-palette-tail-closure-observation-assembler.mjs';
const now = '2026-06-26T00:00:00Z';
const schemaVersion = 1;
const targetRegionIds = ['r2815', 'r2816', 'r2817'];

const forbiddenCounterNames = [
  'persistedRomByteCount',
  'persistedStreamByteCount',
  'persistedTileIdCount',
  'persistedPaletteByteCount',
  'persistedPortValueCount',
  'persistedRegisterTraceCount',
  'persistedProgramCounterCount',
  'persistedPixelCount',
  'persistedAudioByteCount',
  'persistedInstructionByteCount',
  'persistedHashCount',
];

function hasArg(name) {
  return process.argv.includes(name);
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] || null;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readJsonMaybe(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return {
      exists: false,
      path: filePath,
      value: null,
    };
  }
  return {
    exists: true,
    path: filePath,
    value: readJson(filePath),
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function resolveRepoPath(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.resolve(repoRoot, filePath);
}

function relative(filePath) {
  return filePath ? path.relative(repoRoot, filePath) : null;
}

function uniqueSorted(values) {
  return [...new Set((values || []).filter(value => value !== null && value !== undefined && value !== ''))].sort();
}

function countBy(values) {
  const counts = {};
  for (const value of values || []) counts[value] = (counts[value] || 0) + 1;
  return counts;
}

function forbiddenCounters() {
  return Object.fromEntries(forbiddenCounterNames.map(name => [name, 0]));
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData || {})) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === id);
    if (found) return found;
  }
  return null;
}

function regionById(mapData, regionId) {
  return (mapData.regions || []).find(region => region.id === regionId) || null;
}

function observationsFromInput(input) {
  if (Array.isArray(input)) return input;
  if (!input || typeof input !== 'object') return [];
  if (Array.isArray(input.observations)) return input.observations;
  if (Array.isArray(input.hooks)) return input.hooks;
  if (Array.isArray(input.events)) return input.events;
  if (Array.isArray(input.observationInput?.observations)) return input.observationInput.observations;
  const captureObservation = input.capture?.observation;
  return captureObservation ? [captureObservation] : [];
}

function traceIdFromObservation(observation) {
  return observation?.same_frame_trace_id ||
    observation?.sameFrameTraceId ||
    observation?.traceId ||
    observation?.frameTraceId ||
    observation?.fields?.same_frame_trace_id ||
    observation?.fields?.sameFrameTraceId ||
    observation?.fields?.traceId ||
    observation?.fields?.frameTraceId ||
    '';
}

function regionIdFromTailObservation(observation) {
  return observation?.cursor_region_id ||
    observation?.regionId ||
    observation?.targetRegionId ||
    observation?.target_region_id ||
    observation?.fields?.cursor_region_id ||
    observation?.fields?.regionId ||
    observation?.fields?.target_region_id ||
    null;
}

function normalizeParserObservation(observation) {
  if (!observation || typeof observation !== 'object') return null;
  return {
    hookId: observation.hookId || observation.hook_id || 'residual_palette_parser_entry',
    same_frame_trace_id: traceIdFromObservation(observation),
    active_bank: observation.active_bank ?? observation.fields?.active_bank ?? null,
    palette_script_entry_index: observation.palette_script_entry_index ?? observation.fields?.palette_script_entry_index ?? null,
  };
}

function normalizeTailObservation(observation) {
  if (!observation || typeof observation !== 'object') return null;
  return {
    hookId: observation.hookId || observation.hook_id || 'residual_palette_tail_cursor_watch',
    same_frame_trace_id: traceIdFromObservation(observation),
    active_bank: observation.active_bank ?? observation.fields?.active_bank ?? null,
    consumer_label: observation.consumer_label ?? observation.fields?.consumer_label ?? null,
    cursor_offset: observation.cursor_offset ?? observation.fields?.cursor_offset ?? null,
    cursor_region_id: regionIdFromTailObservation(observation),
    access_role: observation.access_role ?? observation.fields?.access_role ?? null,
    inside_palette_tail_region: observation.inside_palette_tail_region ?? observation.fields?.inside_palette_tail_region ?? null,
  };
}

function reportStatus(report) {
  if (!report) return 'missing';
  return report.summary?.status || report.capture?.status || report.eventKind || 'present';
}

function sourceDescriptor(source) {
  return {
    exists: source.exists,
    path: relative(source.path),
    eventKind: source.value?.eventKind || null,
    executed: source.value?.executed ?? null,
    status: reportStatus(source.value),
    observationCount: observationsFromInput(source.value).length,
  };
}

function byTraceId(observations) {
  const out = new Map();
  for (const observation of observations || []) {
    const traceId = traceIdFromObservation(observation);
    if (!traceId) continue;
    if (!out.has(traceId)) out.set(traceId, []);
    out.get(traceId).push(observation);
  }
  return out;
}

function physicalTraceId(record) {
  return record?.same_frame_trace_id ||
    record?.sameFrameTraceId ||
    record?.traceId ||
    record?.frameTraceId ||
    record?.observation?.same_frame_trace_id ||
    '';
}

function selectedPhysicalLiveSource(physicalLive, physicalFailed) {
  if (physicalLive.exists) return physicalLive;
  return physicalFailed.exists ? physicalFailed : physicalLive;
}

function physicalLiveState(physicalSource) {
  const report = physicalSource.value;
  if (!physicalSource.exists) return 'physical_live_report_missing';
  if (report?.summary?.status === 'initialize_failed') return 'physical_live_report_initialize_failed';
  if (report?.summary?.initialized === false) return 'physical_live_report_not_initialized';
  if (report?.summary?.status !== 'live_compare_executed') return 'physical_live_report_not_executed';
  return 'physical_live_report_executed';
}

function physicalRecordsByRegion(physicalSource) {
  const out = new Map();
  for (const record of physicalSource.value?.records || []) {
    if (record?.regionId) out.set(record.regionId, record);
  }
  return out;
}

function tailObservationsByRegion(tailObservations) {
  const out = new Map();
  for (const raw of tailObservations || []) {
    const observation = normalizeTailObservation(raw);
    if (!observation?.cursor_region_id) continue;
    out.set(observation.cursor_region_id, observation);
  }
  return out;
}

function physicalBank(record) {
  if (record?.mapped_source_bank !== undefined && record?.mapped_source_bank !== null) return Number(record.mapped_source_bank);
  const unique = (record?.matchedPhysicalSources || [])[0];
  if (unique?.bank !== undefined && unique?.bank !== null) return Number(unique.bank);
  return null;
}

function physicalRegionId(record) {
  return record?.physical_rom_region_id || (record?.matchedPhysicalSources || [])[0]?.physicalRomRegionId || null;
}

function physicalOffset(record) {
  return record?.physical_rom_offset || (record?.matchedPhysicalSources || [])[0]?.physicalRomOffset || null;
}

function physicalSourceFields(record, tailObservation) {
  const bank = physicalBank(record);
  const physicalRegion = physicalRegionId(record);
  return {
    physical_rom_offset: physicalOffset(record),
    physical_rom_region_id: physicalRegion,
    mapped_source_bank: bank,
    bank_context_matches_source: bank !== null && Number(tailObservation.active_bank) === bank,
  };
}

function parserObservationComplete(observation) {
  return Boolean(observation &&
    observation.same_frame_trace_id &&
    observation.active_bank !== null &&
    observation.active_bank !== undefined &&
    observation.palette_script_entry_index !== null &&
    observation.palette_script_entry_index !== undefined);
}

function tailObservationComplete(observation) {
  return Boolean(observation &&
    observation.same_frame_trace_id &&
    observation.active_bank !== null &&
    observation.active_bank !== undefined &&
    observation.consumer_label &&
    observation.cursor_offset &&
    observation.cursor_region_id &&
    observation.access_role &&
    observation.inside_palette_tail_region === true);
}

function promotionDisposition(regionId, tailObservation, physicalRecord, compareRecord) {
  const fields = physicalSourceFields(physicalRecord, tailObservation);
  const matchedExpected = physicalRecord?.matchedExpectedSource === true || fields.physical_rom_region_id === regionId;
  const aliasRegionId = compareRecord?.currentAliasCandidate?.regionId || physicalRecord?.currentAliasCandidate?.regionId || null;
  const matchedAlias = physicalRecord?.matchedAliasCandidate === true ||
    (aliasRegionId && fields.physical_rom_region_id === aliasRegionId);

  if (matchedExpected && fields.bank_context_matches_source) {
    return {
      status: 'direct_consumer',
      access_role: 'direct_consumer',
      direct_consumer_confirmed: true,
      field_or_alias_only_rejected: false,
      promotion_ready: true,
    };
  }
  if (matchedAlias || fields.bank_context_matches_source === false) {
    return {
      status: 'field_or_alias_only_rejection',
      access_role: tailObservation.access_role,
      direct_consumer_confirmed: false,
      field_or_alias_only_rejected: true,
      promotion_ready: false,
    };
  }
  return {
    status: 'unsupported_physical_source_disposition',
    access_role: tailObservation.access_role,
    direct_consumer_confirmed: false,
    field_or_alias_only_rejected: false,
    promotion_ready: false,
  };
}

function buildRegionRecord(mapData, regionId, sources, lookups) {
  const region = regionById(mapData, regionId);
  const tail = lookups.tailByRegion.get(regionId) || null;
  const traceId = traceIdFromObservation(tail);
  const parserCandidates = traceId ? lookups.parserByTrace.get(traceId) || [] : [];
  const parser = parserCandidates.map(normalizeParserObservation).find(parserObservationComplete) || null;
  const physicalRecord = lookups.physicalByRegion.get(regionId) || null;
  const compareRecord = lookups.compareByRegion.get(regionId) || null;
  const physicalTrace = physicalTraceId(physicalRecord);
  const physicalState = physicalLiveState(sources.physicalSource);
  const blocks = [];

  if (!tail) blocks.push('missing_tail_cursor_observation');
  else if (!tailObservationComplete(tail)) blocks.push('tail_cursor_required_fields_missing');

  if (!parser) blocks.push('missing_parser_entry_same_frame_observation');
  else if (Number(parser.active_bank) !== Number(tail.active_bank)) blocks.push('parser_entry_active_bank_mismatch');

  if (physicalState !== 'physical_live_report_executed') blocks.push(physicalState);
  if (!physicalRecord) blocks.push('missing_physical_source_record');
  else if (physicalRecord.uniquePhysicalSource !== true) blocks.push('physical_source_unique_match_missing');

  if (physicalRecord?.uniquePhysicalSource === true) {
    if (!physicalTrace) blocks.push('physical_source_same_frame_trace_id_missing');
    else if (traceId && physicalTrace !== traceId) blocks.push('physical_source_same_frame_trace_id_mismatch');
  }

  let observations = [];
  let disposition = null;
  if (blocks.length === 0) {
    const sourceFields = physicalSourceFields(physicalRecord, tail);
    disposition = promotionDisposition(regionId, tail, physicalRecord, compareRecord);
    if (disposition.status === 'unsupported_physical_source_disposition') {
      blocks.push('unsupported_physical_source_disposition');
    } else {
      const closedTail = {
        ...tail,
        ...sourceFields,
        access_role: disposition.access_role,
      };
      observations = [
        parser,
        closedTail,
        {
          hookId: 'residual_runtime_promotion_gate',
          kind: 'promotion_gate',
          same_frame_trace_id: traceId,
          target_region_id: regionId,
          target_offset: region?.offset || tail.cursor_offset,
          runtime_trace_kind: 'palette_tail_closure_physical_source',
          direct_consumer_confirmed: disposition.direct_consumer_confirmed,
          field_or_alias_only_rejected: disposition.field_or_alias_only_rejected,
          promotion_ready: disposition.promotion_ready,
        },
      ];
    }
  }

  const status = blocks.length
    ? `blocked_${blocks[0]}`
    : disposition?.status === 'direct_consumer'
      ? 'closure_observation_group_ready_for_direct_consumer_review'
      : 'closure_observation_group_ready_for_alias_rejection_review';

  return {
    regionId,
    regionOffset: region?.offset || null,
    regionType: region?.type || null,
    status,
    blockedReasons: uniqueSorted(blocks),
    completeObservationGroupReady: blocks.length === 0,
    emittedObservationCount: observations.length,
    sameFrameTraceId: traceId || null,
    parserEntryTraceMatched: Boolean(parser),
    tailObservationReady: Boolean(tail && tailObservationComplete(tail)),
    physicalLiveStatus: physicalState,
    physicalUniqueSourceReady: physicalRecord?.uniquePhysicalSource === true,
    physicalSameFrameTraceReady: Boolean(physicalRecord?.uniquePhysicalSource === true && physicalTrace && physicalTrace === traceId),
    physicalSource: physicalRecord ? {
      uniquePhysicalSource: physicalRecord.uniquePhysicalSource === true,
      physical_rom_offset: physicalOffset(physicalRecord),
      physical_rom_region_id: physicalRegionId(physicalRecord),
      mapped_source_bank: physicalBank(physicalRecord),
      matchedExpectedSource: physicalRecord.matchedExpectedSource === true,
      matchedAliasCandidate: physicalRecord.matchedAliasCandidate === true,
    } : null,
    tailObservation: tail,
    parserObservation: parser,
    promotionDisposition: disposition?.status || null,
    observations,
    evidence: [
      `${tailObservationCatalogId} supplies the reviewed tail cursor observation fields when available.`,
      `${parserCaptureCatalogId} must supply residual_palette_parser_entry in the same trace group before closure.`,
      `${physicalCompareCatalogId} must supply a live unique physical source match with the same trace id before closure.`,
      'Assembler output is candidate-only while any required gate is missing.',
    ],
  };
}

function buildObservationInput(catalog, observationsPath) {
  const observations = catalog.records.flatMap(record => record.observations || []);
  const complete = catalog.summary.completeObservationGroupCount > 0;
  return {
    schemaVersion: 1,
    eventKind: complete
      ? 'wb3_palette_tail_closure_runtime_observations'
      : 'wb3_gearsystem_mcp_observation_candidates',
    candidateOnly: !complete,
    generatedBy: toolName,
    sourceCatalogs: catalog.sourceCatalogs,
    sourceReports: catalog.sourceReports,
    observations,
    assetPolicy: 'Metadata-only closure observations: hook ids, trace ids, region ids, offsets, labels, banks, booleans, and disposition fields only. No ROM bytes, stream bytes, memory dumps, tile ids, palette values, VDP port values, register traces, program counters, decoded pixels, screenshots, hashes, instruction bytes, audio bytes, or samples are persisted.',
    summary: {
      completeObservationGroupCount: catalog.summary.completeObservationGroupCount,
      observationCount: observations.length,
      candidateOnly: !complete,
      observationsOutputPath: relative(observationsPath),
      ...forbiddenCounters(),
    },
  };
}

function buildCatalog(mapData, options = {}) {
  const parserReport = readJsonMaybe(options.parserReportPath || defaultParserReportPath);
  const parserFailedReport = readJsonMaybe(options.parserFailedReportPath || defaultParserFailedReportPath);
  const parserObservationsFile = readJsonMaybe(options.parserObservationsPath || defaultParserObservationsPath);
  const tailObservationsFile = readJsonMaybe(options.tailObservationsPath || defaultTailObservationsPath);
  const physicalLiveReport = readJsonMaybe(options.physicalLiveReportPath || defaultPhysicalLiveReportPath);
  const physicalFailedReport = readJsonMaybe(options.physicalFailedReportPath || defaultPhysicalFailedReportPath);
  const physicalSource = selectedPhysicalLiveSource(physicalLiveReport, physicalFailedReport);

  const tailCatalog = findCatalog(mapData, tailObservationCatalogId);
  const parserCatalog = findCatalog(mapData, parserCaptureCatalogId);
  const physicalCatalog = findCatalog(mapData, physicalCompareCatalogId);
  const parserObservations = [
    ...observationsFromInput(parserObservationsFile.value),
    ...observationsFromInput(parserReport.value),
    ...observationsFromInput(parserFailedReport.value),
  ].map(normalizeParserObservation).filter(Boolean);
  const tailObservations = observationsFromInput(tailObservationsFile.value).map(normalizeTailObservation).filter(Boolean);
  const compareByRegion = new Map((physicalCatalog?.records || []).map(record => [record.regionId, record]));
  const records = targetRegionIds.map(regionId => buildRegionRecord(mapData, regionId, {
    physicalSource,
  }, {
    tailByRegion: tailObservationsByRegion(tailObservations),
    parserByTrace: byTraceId(parserObservations),
    physicalByRegion: physicalRecordsByRegion(physicalSource),
    compareByRegion,
  }));
  const blockedReasons = uniqueSorted(records.flatMap(record => record.blockedReasons || []));
  const sourceReports = [
    sourceDescriptor(parserObservationsFile),
    sourceDescriptor(parserReport),
    sourceDescriptor(parserFailedReport),
    sourceDescriptor(tailObservationsFile),
    sourceDescriptor(physicalLiveReport),
    sourceDescriptor(physicalFailedReport),
  ];
  const completeObservationGroupCount = records.filter(record => record.completeObservationGroupReady).length;
  const catalog = {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    eventKind: 'wb3_gearsystem_mcp_palette_tail_closure_observation_assembler',
    sourceCatalogs: [
      tailObservationCatalogId,
      parserCaptureCatalogId,
      physicalCompareCatalogId,
    ],
    sourceReports,
    assetPolicy: 'Metadata only: report paths, statuses, hook ids, trace ids, region ids, offsets, labels, bank numbers, booleans, counts, blocked reasons, and sanitized summaries. No ROM bytes, stream bytes, memory dumps, tile ids, palette values, VDP port values, register traces, program counters, decoded pixels, screenshots, hashes, instruction bytes, audio bytes, or samples are persisted.',
    summary: {
      assemblerReady: true,
      targetRegionCount: records.length,
      sourceCatalogPresentCount: [tailCatalog, parserCatalog, physicalCatalog].filter(Boolean).length,
      tailObservationReadyCount: records.filter(record => record.tailObservationReady).length,
      parserEntrySameFrameReadyCount: records.filter(record => record.parserEntryTraceMatched).length,
      physicalUniqueSourceReadyCount: records.filter(record => record.physicalUniqueSourceReady).length,
      physicalSameFrameTraceReadyCount: records.filter(record => record.physicalSameFrameTraceReady).length,
      completeObservationGroupCount,
      emittedObservationCount: records.reduce((sum, record) => sum + record.emittedObservationCount, 0),
      outputCandidateOnly: completeObservationGroupCount === 0,
      guardStatus: completeObservationGroupCount > 0
        ? 'closure_observation_groups_ready_for_review'
        : `blocked_${blockedReasons[0] || 'no_complete_observation_group'}`,
      blockedReasons,
      blockedReasonCounts: countBy(records.flatMap(record => record.blockedReasons || [])),
      physicalLiveStatus: physicalLiveState(physicalSource),
      requiresSameFrameParserEntry: true,
      requiresLivePhysicalSourceMatch: true,
      requiresSameFramePhysicalSourceTraceId: true,
      rejectsInitializeFailedPhysicalReport: true,
      rejectsMissingParserEntryObservation: true,
      rejectsMissingActiveBank: true,
      rejectsCandidateOnlyInputs: true,
      rejectsGeneratedCandidateTraceIds: true,
      observationsOutputPath: relative(options.observationsPath || defaultObservationsPath),
      regionIds: records.map(record => record.regionId),
      ...forbiddenCounters(),
    },
    records,
    evidence: [
      'The assembler joins tail cursor observations, parser-entry observations, and live physical-source matches only when they share the same trace id.',
      'Current local inputs do not contain a same-frame parser-entry observation or initialized live physical-source report, so the output is candidate-only.',
      'The emitted observation file is intentionally candidate-only until every required gate is present.',
    ],
    nextLeads: [
      'Run the parser-entry capture adapter while stopped in the same trace group as a palette-tail read.',
      'Run the live physical-source byte compare while stopped at the same palette-tail read and include a trusted same_frame_trace_id in the live report.',
      'Rerun this assembler, then feed the non-candidate observation output to the residual closure pipeline for review.',
    ],
  };
  catalog.observationInput = buildObservationInput(catalog, options.observationsPath || defaultObservationsPath);
  catalog.observationAuditSummary = buildResidualRuntimeTraceObservationAudit(mapData, catalog.observationInput, {
    source: relative(options.observationsPath || defaultObservationsPath),
    regionIds: targetRegionIds,
  }).summary;
  return catalog;
}

function applyCatalog(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  for (const record of catalog.records || []) {
    const region = regionById(mapData, record.regionId);
    if (!region) {
      missingRegions.push({ id: record.regionId, role: 'palette_tail_closure_observation_assembler_target' });
      continue;
    }
    region.analysis = region.analysis || {};
    region.analysis.gearsystemMcpPaletteTailClosureObservationAssemblerAudit = {
      catalogId,
      kind: 'gearsystem_mcp_palette_tail_closure_observation_assembler',
      status: record.status,
      completeObservationGroupReady: record.completeObservationGroupReady,
      blockedReasons: record.blockedReasons,
      sameFrameTraceId: record.sameFrameTraceId,
      tailObservationReady: record.tailObservationReady,
      parserEntryTraceMatched: record.parserEntryTraceMatched,
      physicalLiveStatus: record.physicalLiveStatus,
      physicalUniqueSourceReady: record.physicalUniqueSourceReady,
      physicalSameFrameTraceReady: record.physicalSameFrameTraceReady,
      physicalSource: record.physicalSource,
      promotionDisposition: record.promotionDisposition,
      outputCandidateOnly: catalog.summary.outputCandidateOnly,
      requiresSameFrameParserEntry: true,
      requiresLivePhysicalSourceMatch: true,
      requiresSameFramePhysicalSourceTraceId: true,
      summary: 'Strict palette-tail closure assembler status; residual remains quarantined unless parser-entry, tail, and physical-source observations align in the same trace group.',
      evidence: record.evidence,
      generatedAt: now,
      tool: toolName,
    };
    changedRegions.push({
      id: record.regionId,
      status: record.status,
      completeObservationGroupReady: record.completeObservationGroupReady,
      blockedReasons: record.blockedReasons,
    });
  }

  mapData.gearsystemMcpPaletteTailClosureObservationAssemblerCatalogs = (mapData.gearsystemMcpPaletteTailClosureObservationAssemblerCatalogs || [])
    .filter(item => item.id !== catalogId);
  mapData.gearsystemMcpPaletteTailClosureObservationAssemblerCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'gearsystem_mcp_palette_tail_closure_observation_assembler',
    generatedAt: now,
    schemaVersion,
    tool: `${toolName} --apply`,
    catalogId,
    sourceCatalogs: catalog.sourceCatalogs,
    sourceReports: catalog.sourceReports,
    summary: {
      ...catalog.summary,
      changedRegionCount: changedRegions.length,
      missingRegionCount: missingRegions.length,
    },
    changedRegions,
    missingRegions,
    evidence: catalog.evidence,
    nextLeads: catalog.nextLeads,
    assetPolicy: catalog.assetPolicy,
  });
  mapData.updatedAt = now;
  return { changedRegions, missingRegions };
}

function updateStaticMap(catalog) {
  const staticMap = readJson(staticMapPath);
  staticMap.summary = staticMap.summary || {};
  staticMap.summary.gearsystemMcpPaletteTailClosureObservationAssemblerCatalog = catalogId;
  staticMap.summary.gearsystemMcpPaletteTailClosureObservationAssemblerReady = catalog.summary.assemblerReady === true;
  staticMap.summary.gearsystemMcpPaletteTailClosureObservationAssemblerStatus = catalog.summary.guardStatus;
  staticMap.summary.gearsystemMcpPaletteTailClosureCompleteObservationGroupCount = catalog.summary.completeObservationGroupCount;
  staticMap.summary.gearsystemMcpPaletteTailClosureOutputCandidateOnly = catalog.summary.outputCandidateOnly === true;
  staticMap.summary.gearsystemMcpPaletteTailClosurePhysicalLiveStatus = catalog.summary.physicalLiveStatus;
  staticMap.summary.gearsystemMcpPaletteTailClosureBlockedReasons = catalog.summary.blockedReasons;
  staticMap.summary.gearsystemMcpPaletteTailClosureBlockedReasonCounts = catalog.summary.blockedReasonCounts;
  staticMap.summary.gearsystemMcpPaletteTailClosureRequiresSameFrameParserEntry = catalog.summary.requiresSameFrameParserEntry === true;
  staticMap.summary.gearsystemMcpPaletteTailClosureRequiresLivePhysicalSourceMatch = catalog.summary.requiresLivePhysicalSourceMatch === true;
  staticMap.summary.gearsystemMcpPaletteTailClosureRequiresSameFramePhysicalSourceTraceId = catalog.summary.requiresSameFramePhysicalSourceTraceId === true;
  for (const name of forbiddenCounterNames) {
    staticMap.summary[`gearsystemMcpPaletteTailClosure${name[0].toUpperCase()}${name.slice(1)}`] = catalog.summary[name];
  }
  staticMap.generatedFrom = staticMap.generatedFrom || {};
  staticMap.generatedFrom[catalogId] = {
    generatedAt: now,
    tool: toolName,
    sourceMap: 'projects/WORLD/map.json',
    assetPolicy: catalog.assetPolicy,
  };
  staticMap.nextLeads = Array.isArray(staticMap.nextLeads) ? staticMap.nextLeads : [];
  const lead = 'Use world-gearsystem-mcp-palette-tail-closure-observation-assembler-catalog-2026-06-26 after live parser-entry and physical-source reports exist for the same trace group.';
  if (!staticMap.nextLeads.includes(lead)) staticMap.nextLeads.push(lead);
  writeJson(staticMapPath, staticMap);
}

function main() {
  const apply = hasArg('--apply');
  const noWrite = hasArg('--no-write');
  const outputPath = resolveRepoPath(argValue('--out')) || defaultOutputPath;
  const observationsPath = resolveRepoPath(argValue('--observations-out')) || defaultObservationsPath;
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData, {
    parserReportPath: resolveRepoPath(argValue('--parser-report')) || defaultParserReportPath,
    parserFailedReportPath: resolveRepoPath(argValue('--parser-failed-report')) || defaultParserFailedReportPath,
    parserObservationsPath: resolveRepoPath(argValue('--parser-observations')) || defaultParserObservationsPath,
    tailObservationsPath: resolveRepoPath(argValue('--tail-observations')) || defaultTailObservationsPath,
    physicalLiveReportPath: resolveRepoPath(argValue('--physical-live-report')) || defaultPhysicalLiveReportPath,
    physicalFailedReportPath: resolveRepoPath(argValue('--physical-failed-report')) || defaultPhysicalFailedReportPath,
    observationsPath,
  });
  if (!noWrite) {
    writeJson(outputPath, catalog);
    writeJson(observationsPath, catalog.observationInput);
  }
  let annotation = { changedRegions: [], missingRegions: [] };
  if (apply) {
    annotation = applyCatalog(mapData, catalog);
    if (!noWrite) {
      writeJson(mapPath, mapData);
      updateStaticMap(catalog);
    }
  }
  console.log(JSON.stringify({
    ok: true,
    applied: apply,
    output: noWrite ? null : relative(outputPath),
    observationsOutput: noWrite ? null : relative(observationsPath),
    catalogId,
    summary: catalog.summary,
    observationAuditSummary: catalog.observationAuditSummary,
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
    assetPolicy: catalog.assetPolicy,
  }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      error: error.message,
      ...forbiddenCounters(),
    }, null, 2));
    process.exitCode = 1;
  }
}
