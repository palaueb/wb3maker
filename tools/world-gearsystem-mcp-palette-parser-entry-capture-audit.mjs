#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const setupPlanPath = path.join(repoRoot, 'gearsystem/world-residual-mcp-setup-plan.json');
const defaultOutputPath = path.join(repoRoot, 'tmp/world-gearsystem-mcp-palette-parser-entry-capture.local.json');
const physicalSourceCandidateCatalogId = 'world-gearsystem-mcp-physical-source-candidate-catalog-2026-06-26';
const captureChecklistCatalogId = 'world-residual-runtime-capture-checklist-catalog-2026-06-26';
const catalogId = 'world-gearsystem-mcp-palette-parser-entry-capture-catalog-2026-06-26';
const reportId = 'gearsystem-mcp-palette-parser-entry-capture-audit-2026-06-26';
const toolName = 'tools/world-gearsystem-mcp-palette-parser-entry-capture-audit.mjs';
const now = '2026-06-26T00:00:00Z';
const schemaVersion = 1;
const targetRegionIds = ['r2815', 'r2816', 'r2817'];
const parserRegionId = 'r1976';
const pointerTableRegionId = 'r0676';
const entry25ScriptRegionId = 'r0698';
const parserStateRamSymbols = ['$CF65', '$D020', '$D022'];

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

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function resolveRepoPath(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.resolve(repoRoot, filePath);
}

function relative(filePath) {
  return path.relative(repoRoot, filePath);
}

function uniqueSorted(values) {
  return [...new Set((values || []).filter(value => value !== null && value !== undefined && value !== ''))].sort();
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData || {})) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === id);
    if (found) return found;
  }
  return null;
}

function requireCatalog(mapData, id) {
  const catalog = findCatalog(mapData, id);
  if (!catalog) throw new Error(`Missing required catalog ${id}`);
  return catalog;
}

function regionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function ramByAddress(mapData, address) {
  return (mapData.ram || []).find(entry => String(entry.address || '').toUpperCase() === address.toUpperCase()) || null;
}

function compactRegion(region) {
  if (!region) return null;
  return {
    id: region.id,
    offset: region.offset,
    size: region.size,
    type: region.type,
    name: region.name || null,
    confidence: region.confidence || null,
  };
}

function compactRam(ram) {
  if (!ram) return null;
  return {
    id: ram.id,
    address: ram.address,
    size: ram.size,
    type: ram.type,
    name: ram.name || null,
    confidence: ram.confidence || null,
  };
}

function parserEntryOperation(setupPlan) {
  return (setupPlan.operations || []).find(operation =>
    operation.kind === 'execution_breakpoint' &&
    (operation.source?.hookIds || []).includes('residual_palette_parser_entry')) || null;
}

function checklistByRegion(catalog) {
  return new Map((catalog.checklists || []).map(entry => [entry.region?.id, entry]));
}

function physicalCandidateByRegion(catalog) {
  return new Map((catalog.records || []).map(record => [record.regionId, record]));
}

function hookChecklistEntry(checklist, hookId) {
  return (checklist?.hookChecklist || []).find(hook => hook.hookId === hookId) || null;
}

function buildRecord(mapData, checklistById, physicalById, operation, regionId) {
  const region = regionById(mapData, regionId);
  const checklist = checklistById.get(regionId);
  const parserHook = hookChecklistEntry(checklist, 'residual_palette_parser_entry');
  const tailHook = hookChecklistEntry(checklist, 'residual_palette_tail_cursor_watch');
  const candidate = physicalById.get(regionId);
  return {
    regionId,
    status: 'parser_entry_capture_ready_waiting_for_runtime_hit',
    targetRegion: compactRegion(region),
    parserRoutineRegion: compactRegion(regionById(mapData, parserRegionId)),
    pointerTableRegion: compactRegion(regionById(mapData, pointerTableRegionId)),
    entry25ScriptRegion: compactRegion(regionById(mapData, entry25ScriptRegionId)),
    executionBreakpoint: {
      operationId: operation?.id || null,
      logicalAddress: operation?.source?.logicalAddress || operation?.arguments?.address || null,
      romOffset: operation?.source?.romOffset || null,
      bank: operation?.source?.bank || null,
      label: operation?.source?.labels?.[0] || '_LABEL_10BC_',
      hookId: 'residual_palette_parser_entry',
    },
    captureFields: parserHook?.captureFields || operation?.source?.captureFields || [],
    requiredCaptureFields: parserHook?.requiredCaptureFields || operation?.source?.requiredCaptureFields || [],
    safeScalarRamFields: [
      {
        field: '_RAM_CF65_',
        address: '$CF65',
        role: 'palette_script_selector_or_sentinal',
        captureRule: 'At _LABEL_10BC_ entry, $FF means inactive/return, $FE means continue active script from _RAM_D020_, otherwise the byte is palette_script_entry_index.',
      },
      {
        field: '_RAM_D020_',
        address: '$D020',
        role: 'active_palette_script_pointer',
        captureRule: 'Persist only the pointer offset/region metadata when needed; do not persist script bytes or palette values.',
      },
      {
        field: '_RAM_D022_',
        address: '$D022',
        role: 'palette_script_delay_counter',
        captureRule: 'Persist only the scalar delay value when observed.',
      },
    ],
    fieldInterpretation: {
      paletteScriptEntryIndex: 'Derived from _RAM_CF65_ when _RAM_CF65_ is neither 0xFE nor 0xFF at _LABEL_10BC_ entry.',
      entry25Meaning: 'Index 25 selects _DATA_1CABB_ through _DATA_1C800_; static evaluator says entry 25 loops inside its parsed prefix and does not execute r2815-r2817.',
      sameFrameRequirement: 'This parser-entry event must share same_frame_trace_id with the tail cursor watch and promotion gate before residual closure can proceed.',
    },
    companionTailCapture: {
      hookId: 'residual_palette_tail_cursor_watch',
      captureFields: tailHook?.captureFields || [],
      derivedPhysicalSourceCandidateTraceId: candidate?.tailObservationCandidate?.same_frame_trace_id || null,
      derivedPhysicalRomOffset: candidate?.derivedPhysicalRomOffset || null,
      derivedPhysicalRomRegionId: candidate?.derivedPhysicalRomRegion?.id || null,
      candidateOnlyRejectedByBundle: true,
    },
    closureStatus: {
      parserEntryCaptureReady: Boolean(operation && parserHook),
      runtimeObservationPresent: false,
      closesResidualNow: false,
      missingForClosure: [
        'runtime hit at _LABEL_10BC_ with reviewed active_bank and palette_script_entry_index',
        'same_frame_trace_id shared with native physical-source tail cursor watch',
        'reviewed residual_runtime_promotion_gate',
      ],
    },
    evidence: [
      'ASM lines 3355-3373: _LABEL_10BC_ reads _RAM_CF65_, switches to bank 7, indexes _DATA_1C800_, stores the selected script pointer in _RAM_D020_, sets _RAM_CF65_ to 0xFE, and seeds _RAM_D022_.',
      'ASM lines 3375-3419: _LABEL_10BC_ continues the script from _RAM_D020_, treats 0xFF as end/inactive, handles 0xF0 jumps, and stores delay in _RAM_D022_.',
      'world-palette-cf65-entry25-evaluator-catalog-2026-06-26 records that entry 25 loops inside the parsed _DATA_1CABB_ prefix and has zero post-parser tail hits.',
      `${captureChecklistCatalogId} requires residual_palette_parser_entry for ${regionId} before residual closure.`,
      candidate?.derivedPhysicalRomRegion?.id
        ? `${physicalSourceCandidateCatalogId} currently derives the tail logical watchpoint to ${candidate.derivedPhysicalRomRegion.id}, but that candidate is not runtime proof.`
        : `${physicalSourceCandidateCatalogId} supplies candidate tail context, but no native physical source proof yet.`,
    ],
  };
}

function buildCatalog(mapData) {
  const setupPlan = readJson(setupPlanPath);
  const captureChecklist = requireCatalog(mapData, captureChecklistCatalogId);
  const physicalCandidates = requireCatalog(mapData, physicalSourceCandidateCatalogId);
  const operation = parserEntryOperation(setupPlan);
  const checklistById = checklistByRegion(captureChecklist);
  const physicalById = physicalCandidateByRegion(physicalCandidates);
  const records = targetRegionIds.map(regionId =>
    buildRecord(mapData, checklistById, physicalById, operation, regionId));
  const ramFields = parserStateRamSymbols.map(address => compactRam(ramByAddress(mapData, address)));
  const forbiddenCounters = Object.fromEntries(forbiddenCounterNames.map(name => [name, 0]));
  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    eventKind: 'wb3_gearsystem_mcp_palette_parser_entry_capture_audit',
    sourceCatalogs: [captureChecklistCatalogId, physicalSourceCandidateCatalogId],
    sourceFiles: ['gearsystem/world-residual-mcp-setup-plan.json'],
    assetPolicy: 'Metadata-only parser-entry capture audit: hook ids, labels, ROM offsets, RAM symbols, scalar field names, region ids, booleans, and evidence text. No ROM bytes, stream bytes, memory dumps, register traces, PC values, tile ids, palette values, VDP port values, decoded pixels, screenshots, hashes, instruction bytes, audio bytes, or samples are persisted.',
    summary: {
      targetRegionCount: records.length,
      parserEntryOperationReady: Boolean(operation),
      parserEntryCaptureReadyCount: records.filter(record => record.closureStatus.parserEntryCaptureReady).length,
      runtimeObservationPresentCount: 0,
      closesResidualNowCount: 0,
      safeScalarRamFieldCount: ramFields.filter(Boolean).length,
      executionBreakpointLogicalAddress: operation?.source?.logicalAddress || operation?.arguments?.address || null,
      executionBreakpointOperationId: operation?.id || null,
      requiredCaptureFields: uniqueSorted(records.flatMap(record => record.requiredCaptureFields)),
      captureFields: uniqueSorted(records.flatMap(record => record.captureFields)),
      targetRegionIds,
      parserRoutineRegionId: parserRegionId,
      pointerTableRegionId,
      entry25ScriptRegionId,
      ...forbiddenCounters,
    },
    ramFields,
    records,
    evidence: [
      'The parser-entry breakpoint is already generated in gearsystem/world-residual-mcp-setup-plan.json as an execution breakpoint at _LABEL_10BC_.',
      'Only named scalar RAM fields are part of the capture contract; script bytes, palette values, register traces, and memory dumps remain forbidden.',
      'This audit does not close residuals; it makes the missing parser-entry observation explicit and ready for a real MCP callback.',
    ],
    nextLeads: [
      'Run the Gearsystem MCP route with the _LABEL_10BC_ execution breakpoint enabled and capture same_frame_trace_id, active_bank, and palette_script_entry_index.',
      'When the tail watchpoint fires, assign the same same_frame_trace_id only if it belongs to the same runtime path/frame.',
      'Run the residual closure pipeline only after parser-entry and native physical-source tail observations are real reviewed runtime evidence.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  for (const record of catalog.records || []) {
    const region = regionById(mapData, record.regionId);
    if (!region) {
      missingRegions.push({ id: record.regionId, role: 'palette_parser_entry_capture_target' });
      continue;
    }
    region.analysis = region.analysis || {};
    region.analysis.gearsystemMcpPaletteParserEntryCaptureAudit = {
      catalogId,
      kind: 'gearsystem_mcp_palette_parser_entry_capture',
      status: record.status,
      parserRoutineRegionId: parserRegionId,
      executionBreakpoint: record.executionBreakpoint,
      requiredCaptureFields: record.requiredCaptureFields,
      safeScalarRamFields: record.safeScalarRamFields,
      entry25ScriptRegionId,
      parserEntryCaptureReady: record.closureStatus.parserEntryCaptureReady,
      runtimeObservationPresent: false,
      closesResidualNow: false,
      missingForClosure: record.closureStatus.missingForClosure,
      companionTailCapture: record.companionTailCapture,
      summary: 'Parser-entry capture contract is ready for this residual target; real runtime observation is still required before closure.',
      evidence: record.evidence,
      generatedAt: now,
      tool: toolName,
    };
    changedRegions.push({
      id: record.regionId,
      status: record.status,
      parserEntryCaptureReady: record.closureStatus.parserEntryCaptureReady,
      closesResidualNow: false,
    });
  }

  const parserRegion = regionById(mapData, parserRegionId);
  if (parserRegion) {
    parserRegion.analysis = parserRegion.analysis || {};
    parserRegion.analysis.gearsystemMcpPaletteParserEntryCaptureAudit = {
      catalogId,
      kind: 'gearsystem_mcp_palette_parser_entry_capture_routine',
      status: 'parser_entry_execution_breakpoint_ready',
      executionBreakpointLogicalAddress: catalog.summary.executionBreakpointLogicalAddress,
      executionBreakpointOperationId: catalog.summary.executionBreakpointOperationId,
      appliesToRegionIds: targetRegionIds,
      safeScalarRamFields: catalog.records[0]?.safeScalarRamFields || [],
      summary: '_LABEL_10BC_ parser-entry breakpoint is ready for metadata-only MCP capture.',
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    changedRegions.push({
      id: parserRegionId,
      status: 'parser_entry_execution_breakpoint_ready',
      executionBreakpointLogicalAddress: catalog.summary.executionBreakpointLogicalAddress,
    });
  } else {
    missingRegions.push({ id: parserRegionId, role: 'palette_parser_entry_capture_routine' });
  }

  for (const ram of catalog.ramFields || []) {
    const entry = ramByAddress(mapData, ram?.address);
    if (!entry) continue;
    entry.analysis = entry.analysis || {};
    entry.analysis.gearsystemMcpPaletteParserEntryCaptureAudit = {
      catalogId,
      kind: 'palette_parser_entry_scalar_capture_field',
      status: 'safe_scalar_runtime_capture_field',
      appliesToHookId: 'residual_palette_parser_entry',
      summary: 'Named scalar RAM field needed for _LABEL_10BC_ parser-entry observation; do not persist memory dumps or payload bytes.',
      evidence: catalog.evidence.slice(0, 2),
      generatedAt: now,
      tool: toolName,
    };
  }

  mapData.gearsystemMcpPaletteParserEntryCaptureCatalogs = (mapData.gearsystemMcpPaletteParserEntryCaptureCatalogs || [])
    .filter(item => item.id !== catalogId);
  mapData.gearsystemMcpPaletteParserEntryCaptureCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'gearsystem_mcp_palette_parser_entry_capture_audit',
    generatedAt: now,
    schemaVersion,
    tool: `${toolName} --apply`,
    catalogId,
    sourceCatalogs: catalog.sourceCatalogs,
    sourceFiles: catalog.sourceFiles,
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
  staticMap.summary.gearsystemMcpPaletteParserEntryCaptureCatalog = catalogId;
  staticMap.summary.gearsystemMcpPaletteParserEntryCaptureTargetRegionCount = catalog.summary.targetRegionCount;
  staticMap.summary.gearsystemMcpPaletteParserEntryCaptureReadyCount = catalog.summary.parserEntryCaptureReadyCount;
  staticMap.summary.gearsystemMcpPaletteParserEntryCaptureRuntimeObservationPresentCount = catalog.summary.runtimeObservationPresentCount;
  staticMap.summary.gearsystemMcpPaletteParserEntryCaptureClosesResidualNowCount = catalog.summary.closesResidualNowCount;
  staticMap.summary.gearsystemMcpPaletteParserEntryCaptureExecutionBreakpointLogicalAddress = catalog.summary.executionBreakpointLogicalAddress;
  staticMap.summary.gearsystemMcpPaletteParserEntryCaptureRequiredCaptureFields = catalog.summary.requiredCaptureFields;
  for (const name of forbiddenCounterNames) {
    staticMap.summary[`gearsystemMcpPaletteParserEntryCapture${name[0].toUpperCase()}${name.slice(1)}`] = catalog.summary[name];
  }
  staticMap.generatedFrom = staticMap.generatedFrom || {};
  staticMap.generatedFrom[catalogId] = {
    generatedAt: now,
    tool: toolName,
    sourceMap: 'projects/WORLD/map.json',
    assetPolicy: catalog.assetPolicy,
  };
  staticMap.nextLeads = Array.isArray(staticMap.nextLeads) ? staticMap.nextLeads : [];
  const lead = 'Use world-gearsystem-mcp-palette-parser-entry-capture-catalog-2026-06-26 to capture _LABEL_10BC_ parser-entry scalar fields before residual closure.';
  if (!staticMap.nextLeads.includes(lead)) staticMap.nextLeads.push(lead);
  writeJson(staticMapPath, staticMap);
}

function main() {
  const apply = hasArg('--apply');
  const noWrite = hasArg('--no-write');
  const outputPath = resolveRepoPath(argValue('--out')) || defaultOutputPath;
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  if (!noWrite) writeJson(outputPath, catalog);
  let result = { changedRegions: [], missingRegions: [] };
  if (apply) {
    result = applyCatalog(mapData, catalog);
    if (!noWrite) {
      writeJson(mapPath, mapData);
      updateStaticMap(catalog);
    }
  }
  console.log(JSON.stringify({
    ok: true,
    applied: apply,
    output: noWrite ? null : relative(outputPath),
    catalogId,
    summary: catalog.summary,
    changedRegions: result.changedRegions,
    missingRegions: result.missingRegions,
    assetPolicy: catalog.assetPolicy,
  }, null, 2));
}

main();
