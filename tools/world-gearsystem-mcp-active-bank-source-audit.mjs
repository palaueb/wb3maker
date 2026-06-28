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
const defaultOutputPath = path.join(repoRoot, 'tmp/world-gearsystem-mcp-active-bank-source.local.json');
const catalogId = 'world-gearsystem-mcp-active-bank-source-catalog-2026-06-26';
const reportId = 'gearsystem-mcp-active-bank-source-audit-2026-06-26';
const toolName = 'tools/world-gearsystem-mcp-active-bank-source-audit.mjs';
const now = '2026-06-26T00:00:00Z';
const schemaVersion = 1;
const targetRegionIds = ['r2813', 'r2815', 'r2816', 'r2817', 'r0749'];

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
  return [...new Set((values || []).filter(Boolean))].sort();
}

function operationRegionIds(operation) {
  return [
    ...(operation.regionIds || []),
    ...(operation.source?.regionIds || []),
    operation.source?.regionId,
  ].filter(Boolean);
}

function compactOperation(operation) {
  return {
    operationId: operation.id,
    kind: operation.kind,
    regionIds: operationRegionIds(operation),
    hookIds: operation.source?.hookIds || [],
    labels: operation.source?.labels || [],
    sourceBank: operation.source?.bank || null,
    logicalAddress: operation.source?.logicalAddress || operation.arguments?.address || operation.arguments?.start_address || null,
    logicalEndAddress: operation.source?.logicalEndAddress || operation.arguments?.end_address || operation.arguments?.address || null,
    requiresActiveBank: (operation.source?.requiredCaptureFields || []).includes('active_bank'),
  };
}

function setupOperationsByRegion(setupPlan) {
  const byRegion = new Map();
  for (const operation of setupPlan.operations || []) {
    const compact = compactOperation(operation);
    if (!compact.requiresActiveBank) continue;
    for (const regionId of compact.regionIds) {
      if (!byRegion.has(regionId)) byRegion.set(regionId, []);
      byRegion.get(regionId).push(compact);
    }
  }
  return byRegion;
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData || {})) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === id);
    if (found) return found;
  }
  return null;
}

async function rpc(baseUrl, method, params = {}) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Math.floor(Math.random() * 1000000),
      method,
      params,
    }),
  });
  let json = null;
  try {
    const text = await response.text();
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return {
    ok: response.ok && !json?.error,
    status: response.status,
    json,
  };
}

async function callTool(baseUrl, name, args = {}) {
  return rpc(baseUrl, 'tools/call', {
    name,
    arguments: args,
  });
}

function parseToolTextJson(result) {
  const text = result.json?.result?.content?.find(item => item?.type === 'text')?.text || '{}';
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function safeKeys(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value).sort()
    : [];
}

function compactToolSchema(tool = {}) {
  const properties = tool.inputSchema?.properties || {};
  return {
    name: tool.name,
    description: tool.description || null,
    inputPropertyNames: Object.keys(properties).sort(),
    requiredPropertyNames: tool.inputSchema?.required || [],
  };
}

async function inspectMcp(baseUrl) {
  const init = await rpc(baseUrl, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'wb3-world-gearsystem-active-bank-source-audit', version: '1' },
  });
  if (!init.ok) {
    return {
      executed: true,
      initialized: false,
      initializeStatus: init.status,
      toolSchemas: [],
      mediaInfoKeys: [],
      memoryAreas: [],
      z80StatusKeys: [],
      z80StatusHasBankField: false,
      evidence: ['Gearsystem MCP initialize failed; no live capability shape was inspected.'],
    };
  }

  const toolList = await rpc(baseUrl, 'tools/list');
  const tools = toolList.json?.result?.tools || [];
  const selectedTools = tools
    .filter(tool => [
      'get_media_info',
      'list_memory_areas',
      'get_z80_status',
      'debug_get_status',
      'read_memory',
      'get_disassembly',
    ].includes(tool.name))
    .map(compactToolSchema)
    .sort((a, b) => a.name.localeCompare(b.name));

  const mediaInfo = parseToolTextJson(await callTool(baseUrl, 'get_media_info'));
  const memoryAreasResult = parseToolTextJson(await callTool(baseUrl, 'list_memory_areas'));
  const z80Status = parseToolTextJson(await callTool(baseUrl, 'get_z80_status'));
  const memoryAreas = (memoryAreasResult.areas || memoryAreasResult.memory_areas || memoryAreasResult || [])
    .filter(area => area && typeof area === 'object')
    .map(area => ({
      id: area.id,
      name: area.name,
      size: area.size,
    }));

  return {
    executed: true,
    initialized: true,
    initializeStatus: init.status,
    toolSchemas: selectedTools,
    mediaInfoKeys: safeKeys(mediaInfo),
    mediaInfoHasMapperName: safeKeys(mediaInfo).includes('cartridge_type'),
    mediaInfoHasMappedBankSlots: safeKeys(mediaInfo).some(key => /bank|slot|page/i.test(key) && ![
      'rom_bank_count',
      'rom_bank_count_8k',
    ].includes(key)),
    memoryAreas,
    memoryAreaHasMappedBankIdentity: memoryAreas.some(area => /bank\s+\d|page\s+\d|slot\s+\d/i.test(String(area.name || ''))),
    z80StatusKeys: safeKeys(z80Status),
    z80StatusHasBankField: Object.prototype.hasOwnProperty.call(z80Status, 'bank'),
    z80StatusHasPhysicalPcField: Object.prototype.hasOwnProperty.call(z80Status, 'physical_PC'),
    evidence: [
      'MCP tool schemas were inspected by name, descriptions, and input field names only.',
      'get_media_info/list_memory_areas/get_z80_status were inspected for key names and memory-area metadata only.',
      'No memory bytes, register values, PC values, disassembly bytes, or trace log entries were persisted.',
    ],
  };
}

function buildCandidateSources(capabilities) {
  return [
    {
      id: 'setup_plan_expected_bank',
      status: 'context_only_not_runtime_proof',
      acceptedForActiveBank: false,
      evidence: [
        'world-residual-mcp-setup-plan.json records sourceBank/expected bank context for each residual hook.',
        'A source bank in the setup plan identifies the intended ROM region but does not prove the live mapper state at a read breakpoint.',
      ],
    },
    {
      id: 'mcp_get_media_info',
      status: capabilities.mediaInfoHasMappedBankSlots
        ? 'has_bank_like_keys_requires_manual_review'
        : 'cartridge_metadata_only_no_mapper_slots',
      acceptedForActiveBank: false,
      observedKeys: capabilities.mediaInfoKeys || [],
      evidence: [
        'get_media_info exposes loaded cartridge/system metadata.',
        capabilities.mediaInfoHasMappedBankSlots
          ? 'The response has bank-like keys, but this audit does not yet validate them as current mapper slots.'
          : 'The response does not expose current mapped slot/page bank values.',
      ],
    },
    {
      id: 'mcp_list_memory_areas',
      status: capabilities.memoryAreaHasMappedBankIdentity
        ? 'area_names_include_bank_like_identity_requires_manual_review'
        : 'memory_area_layout_only_no_active_bank_identity',
      acceptedForActiveBank: false,
      observedAreas: capabilities.memoryAreas || [],
      evidence: [
        'list_memory_areas exposes area ids, names, and sizes.',
        capabilities.memoryAreaHasMappedBankIdentity
          ? 'Memory area names include bank-like text, but this audit does not validate them as current mapper slots.'
          : 'The listed ROM areas identify memory tabs/windows but not the active mapped ROM bank for a logical read.',
      ],
    },
    {
      id: 'mcp_get_z80_status_bank',
      status: capabilities.z80StatusHasBankField
        ? 'available_but_rejected_for_data_read_bank_without_semantics'
        : 'not_available',
      acceptedForActiveBank: false,
      observedKeyNames: capabilities.z80StatusKeys || [],
      evidence: [
        'get_z80_status exposes CPU/register status key names.',
        capabilities.z80StatusHasBankField
          ? 'The bank field exists, but this audit has not proven that it reports the mapped data page for a read breakpoint rather than the executing PC bank/context.'
          : 'No bank field was exposed in get_z80_status.',
      ],
    },
    {
      id: 'mcp_read_memory_mapper_mirror',
      status: 'rejected_until_emulator_confirms_mapper_latch_semantics',
      acceptedForActiveBank: false,
      evidence: [
        'Reading RAM mirror bytes such as _RAM_DFFF_/_RAM_FFFF_ would be a runtime memory-value observation.',
        'A prior one-off value from a RAM offset is not accepted because the MCP memory area/mirror semantics have not been validated as the mapper latch.',
      ],
    },
    {
      id: 'required_future_source',
      status: 'needs_emulator_mapper_slot_callback_or_explicit_mcp_field',
      acceptedForActiveBank: true,
      evidence: [
        'A trusted source must report the current mapped ROM bank for the logical data address that fired the read/execute breakpoint.',
        'Acceptable implementations include an explicit MCP mapper-slot field, an emulator callback carrying the mapped page bank, or a reviewed hook that records the mapper write and data read in the same frame.',
      ],
    },
  ];
}

function buildRegionRecords(mapData, setupPlan, capabilities, fieldProbeCatalog) {
  const byRegion = setupOperationsByRegion(setupPlan);
  return targetRegionIds.map(regionId => {
    const region = (mapData.regions || []).find(candidate => candidate.id === regionId);
    const operations = byRegion.get(regionId) || [];
    const fieldProbeRecord = (fieldProbeCatalog?.records || []).find(record => record.regionId === regionId) || null;
    const fieldProbeResolvedFields = fieldProbeRecord?.resolvedFields || [];
    return {
      regionId,
      regionOffset: region?.offset || null,
      regionType: region?.type || null,
      confidence: region?.confidence || null,
      status: 'active_bank_unresolved_no_trusted_mcp_source',
      activeBankRequired: operations.some(operation => operation.requiresActiveBank),
      trustedActiveBankSourceAvailable: false,
      activeBankAcceptedFromSourceBank: false,
      activeBankAcceptedFromZ80StatusBank: false,
      activeBankAcceptedFromRamMirror: false,
      fieldProbeAlreadyResolvedFields: fieldProbeResolvedFields,
      fieldProbeStillMissingActiveBank: fieldProbeRecord
        ? (fieldProbeRecord.unresolvedFields || []).includes('active_bank')
        : null,
      operationIds: uniqueSorted(operations.map(operation => operation.operationId)),
      sourceBanks: uniqueSorted(operations.map(operation => operation.sourceBank)),
      hookIds: uniqueSorted(operations.flatMap(operation => operation.hookIds || [])),
      nextRequiredSource: 'current_mapper_bank_for_breakpoint_logical_address',
      evidence: [
        'The residual runtime observation contract requires active_bank for this region before proof closure.',
        'Current Gearsystem MCP metadata does not expose a validated mapped data-page bank source.',
        fieldProbeRecord
          ? 'The callback field probe resolved non-bank fields where it hit, but left active_bank unresolved.'
          : 'No callback field probe record currently resolves this region.',
      ],
    };
  });
}

function buildCatalog(mapData, setupPlan, capabilities) {
  const fieldProbeCatalog = findCatalog(mapData, 'world-gearsystem-mcp-callback-field-probe-catalog-2026-06-26');
  const candidateSources = buildCandidateSources(capabilities);
  const records = buildRegionRecords(mapData, setupPlan, capabilities, fieldProbeCatalog);
  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceFiles: ['projects/WORLD/map.json', 'gearsystem/world-residual-mcp-setup-plan.json'],
    sourceCatalogs: fieldProbeCatalog ? [fieldProbeCatalog.id] : [],
    eventKind: 'wb3_gearsystem_mcp_active_bank_source_audit',
    activeBankSourceAuditOnly: true,
    assetPolicy: 'Metadata only: tool names, schema field names, response key names, memory area ids/names/sizes, region ids, operation ids, hook ids, bank-source statuses, booleans, counts, and evidence summaries. No ROM bytes, stream bytes, memory values, register values, PC values, disassembly bytes, VDP port values, decoded pixels, screenshots, hashes, audio bytes, samples, or instruction bytes are persisted.',
    capabilities,
    candidateSources,
    records,
    summary: {
      residualRegionCount: records.length,
      activeBankRequiredRegionCount: records.filter(record => record.activeBankRequired).length,
      trustedActiveBankSourceAvailable: false,
      trustedActiveBankSourceCount: candidateSources.filter(source => source.acceptedForActiveBank && source.id !== 'required_future_source').length,
      rejectedCandidateSourceCount: candidateSources.filter(source => !source.acceptedForActiveBank).length,
      futureRequiredSourceCount: 1,
      fieldProbeResolvedNonBankFieldRegionCount: records.filter(record =>
        (record.fieldProbeAlreadyResolvedFields || []).some(field => field !== 'active_bank')).length,
      activeBankStillUnresolvedRegionCount: records.filter(record => record.status === 'active_bank_unresolved_no_trusted_mcp_source').length,
      mcpCapabilityInspectionExecuted: capabilities.executed === true,
      mcpCapabilityInspectionInitialized: capabilities.initialized === true,
      mcpMediaInfoHasMappedBankSlots: capabilities.mediaInfoHasMappedBankSlots === true,
      mcpMemoryAreaHasMappedBankIdentity: capabilities.memoryAreaHasMappedBankIdentity === true,
      mcpZ80StatusHasBankField: capabilities.z80StatusHasBankField === true,
      mcpZ80StatusBankAcceptedForDataReadActiveBank: false,
      regionIds: records.map(record => record.regionId),
      operationIds: uniqueSorted(records.flatMap(record => record.operationIds || [])),
      hookIds: uniqueSorted(records.flatMap(record => record.hookIds || [])),
      persistedRomByteCount: 0,
      persistedStreamByteCount: 0,
      persistedTileIdCount: 0,
      persistedPaletteByteCount: 0,
      persistedPortValueCount: 0,
      persistedRegisterTraceCount: 0,
      persistedProgramCounterCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
    },
    commands: {
      launch: 'node tools/world-gearsystem-launch.mjs --port 7777',
      inspectLiveCapabilities: `node ${toolName} --execute --port 7777 --out tmp/world-gearsystem-mcp-active-bank-source.local.json`,
      apply: `node ${toolName} --apply --report tmp/world-gearsystem-mcp-active-bank-source.local.json`,
    },
    evidence: [
      'Residual runtime proof requires active_bank in reviewed observations.',
      'The current MCP metadata/tool surface does not provide a validated mapped data-page bank source.',
      'The audit rejects source-bank context, CPU status bank fields, and unvalidated RAM mirror reads as proof for active_bank.',
    ],
    nextLeads: [
      'Extend Gearsystem MCP to expose the current ROM bank mapped for a logical address at breakpoint time.',
      'Alternatively add a debugger callback that emits the mapper page bank alongside the read/execute breakpoint event.',
      'After active_bank is available, rerun callback field probes and feed reviewed observations through the residual closure pipeline.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  for (const record of catalog.records || []) {
    const region = (mapData.regions || []).find(candidate => candidate.id === record.regionId);
    if (!region) {
      missingRegions.push({ id: record.regionId, role: 'gearsystem_mcp_active_bank_source' });
      continue;
    }
    region.analysis = region.analysis || {};
    region.analysis.gearsystemMcpActiveBankSourceAudit = {
      catalogId,
      kind: 'gearsystem_mcp_active_bank_source_audit',
      status: record.status,
      activeBankRequired: record.activeBankRequired,
      trustedActiveBankSourceAvailable: false,
      activeBankAcceptedFromSourceBank: false,
      activeBankAcceptedFromZ80StatusBank: false,
      activeBankAcceptedFromRamMirror: false,
      fieldProbeAlreadyResolvedFields: record.fieldProbeAlreadyResolvedFields,
      fieldProbeStillMissingActiveBank: record.fieldProbeStillMissingActiveBank,
      operationIds: record.operationIds,
      sourceBanks: record.sourceBanks,
      hookIds: record.hookIds,
      nextRequiredSource: record.nextRequiredSource,
      summary: 'Documents that active_bank is still unresolved because current Gearsystem MCP metadata lacks a validated mapped data-page bank source.',
      evidence: record.evidence,
      generatedAt: now,
      tool: toolName,
    };
    changedRegions.push({
      id: record.regionId,
      status: record.status,
      activeBankRequired: record.activeBankRequired,
      trustedActiveBankSourceAvailable: false,
    });
  }

  mapData.gearsystemMcpActiveBankSourceCatalogs = (mapData.gearsystemMcpActiveBankSourceCatalogs || [])
    .filter(item => item.id !== catalogId);
  mapData.gearsystemMcpActiveBankSourceCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'gearsystem_mcp_active_bank_source_audit',
    generatedAt: now,
    schemaVersion,
    tool: `${toolName} --apply`,
    catalogId,
    sourceFiles: catalog.sourceFiles,
    sourceCatalogs: catalog.sourceCatalogs,
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
  staticMap.summary.gearsystemMcpActiveBankSourceCatalog = catalogId;
  staticMap.summary.gearsystemMcpActiveBankSourceRequiredRegionCount = catalog.summary.activeBankRequiredRegionCount;
  staticMap.summary.gearsystemMcpActiveBankSourceTrustedAvailable = catalog.summary.trustedActiveBankSourceAvailable;
  staticMap.summary.gearsystemMcpActiveBankSourceRejectedCandidateSourceCount = catalog.summary.rejectedCandidateSourceCount;
  staticMap.summary.gearsystemMcpActiveBankSourceFutureRequiredSourceCount = catalog.summary.futureRequiredSourceCount;
  staticMap.summary.gearsystemMcpActiveBankSourceStillUnresolvedRegionCount = catalog.summary.activeBankStillUnresolvedRegionCount;
  staticMap.summary.gearsystemMcpActiveBankSourceMcpZ80StatusHasBankField = catalog.summary.mcpZ80StatusHasBankField;
  staticMap.summary.gearsystemMcpActiveBankSourceMcpZ80StatusBankAcceptedForDataReadActiveBank = false;
  for (const name of forbiddenCounterNames) {
    staticMap.summary[`gearsystemMcpActiveBankSource${name[0].toUpperCase()}${name.slice(1)}`] = catalog.summary[name];
  }
  staticMap.generatedFrom = staticMap.generatedFrom || {};
  staticMap.generatedFrom[catalogId] = {
    generatedAt: now,
    tool: toolName,
    sourceMap: 'projects/WORLD/map.json',
    assetPolicy: catalog.assetPolicy,
  };
  staticMap.nextLeads = Array.isArray(staticMap.nextLeads) ? staticMap.nextLeads : [];
  const lead = 'Extend Gearsystem MCP with a validated mapper-slot/active_bank callback before closing residual runtime proof.';
  if (!staticMap.nextLeads.includes(lead)) staticMap.nextLeads.push(lead);
  writeJson(staticMapPath, staticMap);
}

function defaultCapabilities() {
  return {
    executed: false,
    initialized: false,
    toolSchemas: [],
    mediaInfoKeys: [],
    mediaInfoHasMapperName: null,
    mediaInfoHasMappedBankSlots: false,
    memoryAreas: [],
    memoryAreaHasMappedBankIdentity: false,
    z80StatusKeys: [],
    z80StatusHasBankField: null,
    z80StatusHasPhysicalPcField: null,
    evidence: [
      'Live MCP capability inspection was not executed; this plan records the active_bank source requirements only.',
    ],
  };
}

async function main() {
  const execute = hasArg('--execute');
  const apply = hasArg('--apply');
  const noWrite = hasArg('--no-write');
  const outputPath = resolveRepoPath(argValue('--out')) || defaultOutputPath;
  const reportPath = resolveRepoPath(argValue('--report')) || outputPath;
  const baseUrl = argValue('--url') || `http://${argValue('--address') || '127.0.0.1'}:${argValue('--port') || '7777'}`;
  const mapData = readJson(mapPath);
  const setupPlan = readJson(setupPlanPath);

  let capabilities = defaultCapabilities();
  if (execute) capabilities = await inspectMcp(baseUrl);
  if (!execute && apply) {
    const report = readJson(reportPath);
    capabilities = report.capabilities || capabilities;
  }
  const catalog = buildCatalog(mapData, setupPlan, capabilities);

  let result = { changedRegions: [], missingRegions: [] };
  if (apply) {
    result = applyCatalog(mapData, catalog);
    if (!noWrite) {
      writeJson(mapPath, mapData);
      updateStaticMap(catalog);
    }
  }
  if (!noWrite) writeJson(outputPath, catalog);
  console.log(JSON.stringify({
    ok: true,
    executed: execute,
    applied: apply,
    output: noWrite ? null : relative(outputPath),
    catalogId,
    summary: catalog.summary,
    changedRegions: result.changedRegions,
    missingRegions: result.missingRegions,
    assetPolicy: catalog.assetPolicy,
  }, null, 2));
}

main().catch(error => {
  console.error(JSON.stringify({
    ok: false,
    error: error.message,
    hint: 'Start Gearsystem first for --execute: node tools/world-gearsystem-launch.mjs --port 7777',
    persistedRomByteCount: 0,
    persistedStreamByteCount: 0,
    persistedTileIdCount: 0,
    persistedPaletteByteCount: 0,
    persistedPortValueCount: 0,
    persistedRegisterTraceCount: 0,
    persistedProgramCounterCount: 0,
    persistedPixelCount: 0,
    persistedAudioByteCount: 0,
    persistedInstructionByteCount: 0,
  }, null, 2));
  process.exitCode = 1;
});
