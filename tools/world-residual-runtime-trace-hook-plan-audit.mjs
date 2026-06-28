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
const toolName = 'tools/world-residual-runtime-trace-hook-plan-audit.mjs';
const catalogId = 'world-residual-runtime-trace-hook-plan-catalog-2026-06-26';
const reportId = 'residual-runtime-trace-hook-plan-audit-2026-06-26';
const closureCatalogId = 'world-residual-runtime-proof-closure-index-catalog-2026-06-26';

const sourceCatalogs = [
  closureCatalogId,
  'world-low-confidence-residual-triage-catalog-2026-06-26',
  'world-residual-proof-consumer-catalog-2026-06-26',
  'world-room-overlay-tail-static-bound-proof-catalog-2026-06-26',
  'world-palette-tail-static-consumer-consolidation-catalog-2026-06-26',
  'world-bank7-sidecar-alias-proof-catalog-2026-06-26',
];

const hookSpecs = [
  {
    id: 'residual_overlay_cf64_index_read',
    label: '_LABEL_11F4_',
    offset: '0x011F4',
    mcpBreakpointOffsets: [
      {
        role: 'cf64_index_read_instruction',
        offset: '0x011FC',
        label: '_LABEL_11F4_+0x08',
        purpose: 'Break on the actual ld a, (_RAM_CF64_) instruction after the _LABEL_11F4_ early-return bytes.',
      },
      {
        role: 'd0de_computed_overlay_pointer_store',
        offset: '0x0120B',
        label: '_LABEL_11F4_+0x17',
        purpose: 'Break where the computed _DATA_10000_ + index*8 pointer is stored to _RAM_D0DE_.',
      },
    ],
    regionId: 'r2127',
    eventKind: 'room_overlay_cf64_index_read',
    hookClass: 'runtime_trace_hook',
    captureFields: [
      'same_frame_trace_id',
      'active_bank',
      '_RAM_CF64_',
      'overlay_record_index',
      'computed_record_offset',
      'computed_record_end_exclusive',
      '_RAM_D0DE_',
    ],
    appliesToRegionIds: ['r2813'],
    reason: 'Confirms whether runtime room-overlay index selection ever computes the two-byte tail after the 227 aligned overlay records.',
    asmEvidence: [
      { label: '_LABEL_11F4_', line: 3534, role: 'early-return label; not the useful breakpoint for the overlay selector path' },
      { label: '_RAM_CF64_', line: 3542, role: 'index byte read before overlay-record address calculation; instruction offset derives to 0x011FC from _LABEL_11F4_ + 8 bytes' },
      { label: '_RAM_D0DE_', line: 3552, role: 'computed overlay pointer store after index*8 + _DATA_10000_; instruction offset derives to 0x0120B from _LABEL_11F4_ + 0x17 bytes' },
    ],
  },
  {
    id: 'residual_room_overlay_loader_entry',
    label: '_LABEL_26F4_',
    offset: '0x026F4',
    regionId: 'r2091',
    eventKind: 'room_overlay_loader_entry',
    hookClass: 'runtime_trace_hook',
    captureFields: [
      'same_frame_trace_id',
      'active_bank',
      '_RAM_CF5E_',
      '_RAM_D0FE_',
      'loader_source_region_id',
      'loader_source_offset',
    ],
    appliesToRegionIds: ['r2813'],
    reason: 'Binds overlay index selection to the room asset loader path before any tail promotion.',
    asmEvidence: [
      { label: '_LABEL_26F4_', line: 6472, role: 'room asset loader routine' },
      { label: '_LABEL_26F4_', line: 6422, role: 'room setup callsite before palette/parser update' },
    ],
  },
  {
    id: 'residual_palette_parser_entry',
    label: '_LABEL_10BC_',
    offset: '0x010BC',
    regionId: 'r1976',
    eventKind: 'palette_parser_entry',
    hookClass: 'runtime_trace_hook',
    captureFields: [
      'same_frame_trace_id',
      'active_bank',
      '_RAM_CF65_',
      '_RAM_D020_',
      '_RAM_D022_',
      'palette_script_entry_index',
    ],
    appliesToRegionIds: ['r2815', 'r2816', 'r2817'],
    reason: 'Provides the palette parser context that must be separated from any true post-palette-tail consumer.',
    asmEvidence: [
      { label: '_LABEL_10BC_', line: 3355, role: 'palette script parser entry' },
      { label: '_LABEL_10BC_', line: 3382, role: 'parser command loop entry point after loading _RAM_D020_' },
    ],
  },
  {
    id: 'residual_palette_tail_cursor_watch',
    label: 'palette_tail_cursor_watchpoint',
    offset: null,
    regionId: null,
    eventKind: 'palette_tail_cursor_watchpoint',
    hookClass: 'runtime_trace_hook',
    captureFields: [
      'same_frame_trace_id',
      'active_bank',
      'consumer_label',
      'cursor_offset',
      'cursor_region_id',
      'physical_rom_offset',
      'physical_rom_region_id',
      'mapped_source_bank',
      'bank_context_matches_source',
      'access_role',
      'inside_palette_tail_region',
    ],
    appliesToRegionIds: ['r2815', 'r2816', 'r2817'],
    reason: 'Distinguishes _LABEL_10BC_ parser cursor context from a separate same-bank or physical-ROM-confirmed consumer addressing r2815-r2817 directly.',
    asmEvidence: [
      { label: '_DATA_1CBB9_', line: null, role: 'watchpoint target: post-palette seven-byte fragment' },
      { label: '_DATA_1CBC0_', line: null, role: 'watchpoint target: post-palette fill block' },
      { label: '_DATA_1CBD0_', line: null, role: 'watchpoint target: post-palette tile-index candidate' },
    ],
  },
  {
    id: 'residual_bank7_sidecar_controller_entry',
    label: '_LABEL_1E200_',
    offset: '0x1E200',
    regionId: 'r1907',
    eventKind: 'bank7_sidecar_controller_entry',
    hookClass: 'runtime_trace_hook',
    captureFields: [
      'same_frame_trace_id',
      'active_bank',
      '_RAM_CF8A_',
      '_RAM_CF8B_',
      'controller_phase',
    ],
    appliesToRegionIds: ['r0749'],
    reason: 'Captures the bank-7 routine adjacent to r0749 before any sidecar-consumer proof.',
    asmEvidence: [
      { label: '_LABEL_1E200_', line: 28647, role: 'bank-7 entity sequence controller entry' },
    ],
  },
  {
    id: 'residual_bank7_alias_loader_call',
    label: '_LABEL_1E200_',
    offset: '0x1E200',
    regionId: 'r1907',
    eventKind: 'bank7_alias_loader_call',
    hookClass: 'runtime_trace_hook',
    captureFields: [
      'same_frame_trace_id',
      'active_bank',
      'loaded_hl_label',
      'loaded_hl_offset',
      'called_loader_label',
      'source_region_id',
    ],
    appliesToRegionIds: ['r0749'],
    reason: 'Verifies the known loader-adjacent path resolves to _DATA_12337_ instead of r0749.',
    asmEvidence: [
      { label: '_DATA_12337_', line: 28658, role: '_LABEL_1E200_ loader source operand' },
      { label: '_LABEL_8FB_', line: 28659, role: 'loader call after _DATA_12337_ operand' },
    ],
  },
  {
    id: 'residual_bank7_sidecar_direct_watch',
    label: '_DATA_1E337_',
    offset: '0x1E337',
    regionId: 'r0749',
    eventKind: 'bank7_sidecar_direct_watchpoint',
    hookClass: 'runtime_trace_hook',
    captureFields: [
      'same_frame_trace_id',
      'active_bank',
      'consumer_label',
      'read_offset',
      'read_region_id',
      'access_role',
      'direct_bank7_consumer',
    ],
    appliesToRegionIds: ['r0749'],
    reason: 'Directly tests whether any active bank-7 consumer reads r0749 rather than an alias-shaped operand elsewhere.',
    asmEvidence: [
      { label: '_DATA_1E337_', line: 28779, role: 'bank-7 sidecar data block definition' },
    ],
  },
  {
    id: 'residual_runtime_promotion_gate',
    label: 'residual_runtime_promotion_gate',
    offset: null,
    regionId: null,
    eventKind: 'metadata_promotion_gate',
    hookClass: 'metadata_promotion_gate',
    captureFields: [
      'same_frame_trace_id',
      'target_region_id',
      'runtime_trace_kind',
      'direct_consumer_confirmed',
      'field_or_alias_only_rejected',
      'promotion_ready',
    ],
    appliesToRegionIds: ['r2813', 'r2815', 'r2816', 'r2817', 'r0749'],
    reason: 'Allows semantic promotion only after the region-specific runtime gate is satisfied by metadata-only events.',
    asmEvidence: [
      { label: 'metadata_gate', line: null, role: 'not an ASM label; combines the runtime hook events for one residual trace plan' },
    ],
  },
];

const regionHookMap = {
  r2813: {
    required: ['residual_overlay_cf64_index_read', 'residual_room_overlay_loader_entry', 'residual_runtime_promotion_gate'],
    optional: [],
    targetOffsets: ['0x10718'],
    proofQuestion: 'Does runtime overlay index selection compute record index 227 or another direct consumer for the 0x10718 tail?',
  },
  r2815: {
    required: ['residual_palette_parser_entry', 'residual_palette_tail_cursor_watch', 'residual_runtime_promotion_gate'],
    optional: [],
    targetOffsets: ['0x1CBB9'],
    proofQuestion: 'Does a same-bank non-palette consumer directly address the seven-byte 0x1CBB9 fragment?',
  },
  r2816: {
    required: ['residual_palette_parser_entry', 'residual_palette_tail_cursor_watch', 'residual_runtime_promotion_gate'],
    optional: [],
    targetOffsets: ['0x1CBC0'],
    proofQuestion: 'Does a same-bank non-palette consumer directly address the 0x1CBC0 fill block?',
  },
  r2817: {
    required: ['residual_palette_parser_entry', 'residual_palette_tail_cursor_watch', 'residual_runtime_promotion_gate'],
    optional: [],
    targetOffsets: ['0x1CBD0'],
    proofQuestion: 'Does a same-bank routine consume 0x1CBD0 as a bounded 15x16 tile-index payload?',
  },
  r0749: {
    required: ['residual_bank7_sidecar_controller_entry', 'residual_bank7_alias_loader_call', 'residual_bank7_sidecar_direct_watch', 'residual_runtime_promotion_gate'],
    optional: [],
    targetOffsets: ['0x1E337'],
    proofQuestion: 'Does any active bank-7 consumer read _DATA_1E337_ directly, or is the loader-shaped path only the _DATA_12337_ alias?',
  },
};

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
  const normalized = String(address || '').toUpperCase().replace(/^0X/, '$');
  return (mapData.ram || []).find(entry => String(entry.address || '').toUpperCase() === normalized) || null;
}

function compactRegion(region) {
  if (!region) return null;
  return {
    id: region.id,
    offset: region.offset,
    size: Number(region.size || 0),
    type: region.type || 'unknown',
    name: region.name || '',
    confidence: region.confidence || null,
  };
}

function stripComment(line) {
  return line.split(';')[0].trim();
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function asmLines(asmText) {
  return asmText.split(/\r?\n/).map((text, index) => ({
    line: index + 1,
    text,
    code: stripComment(text),
  }));
}

function lineRefs(lines, token) {
  const re = new RegExp(`(^|[^A-Za-z0-9_])${escapeRegExp(token)}([^A-Za-z0-9_]|$)`);
  return lines
    .filter(item => item.code && re.test(item.code))
    .map(item => ({
      line: item.line,
      kind: new RegExp(`^${escapeRegExp(token)}\\s*:`).test(item.code)
        ? 'definition'
        : (/^call\s+/i.test(item.code) ? 'callsite' : (/^ld\s+/i.test(item.code) ? 'load_or_store' : 'reference')),
    }));
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

function uniqueSorted(values) {
  return [...new Set((values || []).filter(Boolean))].sort();
}

function hookById() {
  return new Map(hookSpecs.map(hook => [hook.id, hook]));
}

function buildTracePlans(closureCatalog) {
  const hooks = hookById();
  return (closureCatalog.entries || []).map(entry => {
    const regionId = entry.region?.id;
    const config = regionHookMap[regionId] || { required: ['residual_runtime_promotion_gate'], optional: [], targetOffsets: [] };
    const requiredMissing = config.required.filter(id => !hooks.has(id));
    return {
      id: `residual_runtime_trace_plan_${regionId}`,
      region: entry.region,
      classId: entry.classId,
      closureStatus: entry.closureStatus,
      quarantineStatus: entry.quarantineStatus,
      sourceRuntimeGate: entry.runtimeGate || {},
      traceStatus: 'runtime_trace_pending',
      proofQuestion: config.proofQuestion || entry.runtimeGate?.requiredProof || '',
      targetOffsets: config.targetOffsets,
      requiredRuntimeHookIds: config.required,
      optionalRuntimeHookIds: config.optional,
      missingRequiredHookIds: requiredMissing,
      readyForRuntimeHarness: requiredMissing.length === 0,
      promotionGate: {
        sameFrameRequired: true,
        runtimeTraceConfirmed: false,
        promotionReady: false,
        coverageChangedByThisAudit: false,
        requiredEvidence: [
          'A same-frame trace id links the region-specific entry/watchpoint events to the metadata promotion gate.',
          entry.runtimeGate?.requiredProof || 'A concrete runtime consumer or selector proof must be captured.',
          'Persist only offsets, labels, region ids, booleans, and trace ids; do not persist ROM bytes, stream bytes, tile ids, palette values, port values, register traces, pixels, screenshots, or samples.',
        ],
      },
      blockers: {
        runtimeTraceConfirmed: false,
        directConsumerConfirmed: false,
        fieldOrAliasOnlyRejected: false,
        promotionReady: false,
      },
      evidenceCatalogs: [closureCatalogId, ...(entry.staticProofs || []).map(proof => proof.catalogId).filter(Boolean)],
      persistedRomByteCount: 0,
      persistedStreamByteCount: 0,
      persistedTileIdCount: 0,
      persistedPaletteByteCount: 0,
      persistedPortValueCount: 0,
      persistedRegisterTraceCount: 0,
      persistedPixelCount: 0,
    };
  });
}

function buildCatalog(mapData, asmText) {
  for (const id of sourceCatalogs) requireCatalog(mapData, id);
  const closureCatalog = requireCatalog(mapData, closureCatalogId);
  const lines = asmLines(asmText);
  const tracePlans = buildTracePlans(closureCatalog);
  const runtimeHooks = hookSpecs.filter(hook => hook.hookClass === 'runtime_trace_hook');
  const promotionGates = hookSpecs.filter(hook => hook.hookClass === 'metadata_promotion_gate');
  const asmReferenceSummary = {
    _RAM_CF64_: lineRefs(lines, '_RAM_CF64_'),
    _LABEL_10BC_: lineRefs(lines, '_LABEL_10BC_'),
    _LABEL_26F4_: lineRefs(lines, '_LABEL_26F4_'),
    _LABEL_1E200_: lineRefs(lines, '_LABEL_1E200_'),
    _DATA_1E337_: lineRefs(lines, '_DATA_1E337_'),
    _DATA_12337_: lineRefs(lines, '_DATA_12337_'),
  };

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs,
    assetPolicy: 'Metadata only: hook ids, labels, offsets, region ids, RAM symbols, ASM line numbers, trace plans, required evidence text, booleans, and counts. No ROM bytes, stream bytes, tile ids, palette values, audio data, VDP port values, register traces, decoded pixels, screenshots, hashes, instruction bytes, or samples are embedded.',
    target: {
      residualClosureCatalogId: closureCatalogId,
      residualRegionIds: uniqueSorted(tracePlans.map(plan => plan.region?.id)),
      reason: 'Turn the five statically closed residuals into concrete metadata-only runtime trace plans before any semantic promotion.',
    },
    summary: {
      sourceResidualCount: closureCatalog.summary?.residualCount || tracePlans.length,
      tracePlanCount: tracePlans.length,
      hookSpecCount: hookSpecs.length,
      runtimeHookSpecCount: runtimeHooks.length,
      promotionGateCount: promotionGates.length,
      requiredHookEdgeCount: tracePlans.reduce((sum, plan) => sum + plan.requiredRuntimeHookIds.length, 0),
      optionalHookEdgeCount: tracePlans.reduce((sum, plan) => sum + plan.optionalRuntimeHookIds.length, 0),
      readyTracePlanCount: tracePlans.filter(plan => plan.readyForRuntimeHarness).length,
      validationIssueCount: tracePlans.reduce((sum, plan) => sum + plan.missingRequiredHookIds.length, 0),
      targetOffsetCount: tracePlans.reduce((sum, plan) => sum + plan.targetOffsets.length, 0),
      traceKindCounts: countBy(tracePlans, plan => plan.sourceRuntimeGate?.traceKind),
      hookEventKindCounts: countBy(hookSpecs, hook => hook.eventKind),
      captureFieldCount: uniqueSorted(hookSpecs.flatMap(hook => hook.captureFields)).length,
      runtimeTraceConfirmedCount: 0,
      promotionReadyCount: 0,
      coverageChangedByThisAudit: false,
      persistedRomByteCount: 0,
      persistedStreamByteCount: 0,
      persistedTileIdCount: 0,
      persistedPaletteByteCount: 0,
      persistedAudioByteCount: 0,
      persistedPortValueCount: 0,
      persistedRegisterTraceCount: 0,
      persistedPixelCount: 0,
      persistedInstructionByteCount: 0,
    },
    hookSpecs,
    runtimeHooks,
    promotionGates,
    tracePlans,
    asmReferenceSummary,
    evidence: [
      `${closureCatalogId} marks r2813, r2815-r2817, and r0749 as closed for current static decoder queues and blocked on runtime proof.`,
      '_LABEL_11F4_ reads _RAM_CF64_ before computing an overlay-record address from _DATA_10000_.',
      '_LABEL_10BC_ is the bank-7 palette script parser; r2815-r2817 require a separate same-bank consumer before semantic promotion.',
      '_LABEL_1E200_ is the bank-7 sidecar-adjacent controller; the known loader operand is _DATA_12337_, so r0749 needs a direct bank-7 consumer trace.',
    ],
    nextLeads: [
      'Add a metadata-only fixture/evaluator for this hook plan, mirroring the bank-2 VDP trace evaluator pattern.',
      'When emulator hooks exist, emit only hook ids, trace ids, offsets, labels, region ids, and booleans into the evaluator.',
      'Update the specific residual proof catalog only after a gate produces direct-consumer confirmation or field/alias-only rejection.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  const participatingRegions = new Map();
  for (const plan of catalog.tracePlans || []) {
    if (!plan.region?.id) continue;
    if (!participatingRegions.has(plan.region.id)) {
      participatingRegions.set(plan.region.id, { roles: new Set(), planIds: new Set(), hookIds: new Set(), hookEventKinds: new Set() });
    }
    const detail = participatingRegions.get(plan.region.id);
    detail.roles.add('residual_runtime_trace_plan');
    detail.planIds.add(plan.id);
  }
  for (const hook of catalog.hookSpecs || []) {
    if (!hook.regionId) continue;
    if (!participatingRegions.has(hook.regionId)) {
      participatingRegions.set(hook.regionId, { roles: new Set(), planIds: new Set(), hookIds: new Set(), hookEventKinds: new Set() });
    }
    const detail = participatingRegions.get(hook.regionId);
    detail.roles.add(hook.hookClass);
    detail.hookIds.add(hook.id);
    detail.hookEventKinds.add(hook.eventKind);
  }

  for (const [regionId, detail] of participatingRegions) {
    const region = findRegion(mapData, regionId);
    if (!region) {
      missingRegions.push({ id: regionId, role: uniqueSorted([...detail.roles]).join(',') });
      continue;
    }
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.residualRuntimeTraceHookPlanAudit = {
        catalogId,
        kind: 'residual_runtime_trace_hook_plan_participant',
        roles: uniqueSorted([...detail.roles]),
        confidence: 'medium_high',
        tracePlanIds: uniqueSorted([...detail.planIds]),
        hookIds: uniqueSorted([...detail.hookIds]),
        hookEventKinds: uniqueSorted([...detail.hookEventKinds]),
        readyForRuntimeHarness: true,
        promotionReady: false,
        coverageChangedByThisAudit: false,
        summary: 'Region participates in the residual runtime trace hook plan; no semantic promotion is made by this audit.',
        evidence: catalog.evidence,
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type,
      roles: uniqueSorted([...detail.roles]),
      tracePlanIds: uniqueSorted([...detail.planIds]),
      hookIds: uniqueSorted([...detail.hookIds]),
    });
  }

  const cf64 = findRam(mapData, '$CF64');
  const changedRam = [];
  if (cf64) {
    if (apply) {
      cf64.analysis = cf64.analysis || {};
      cf64.analysis.residualRuntimeTraceHookPlanAudit = {
        catalogId,
        kind: 'residual_runtime_ram_trace_seed',
        role: 'room_overlay_index_selector_for_r2813_tail_gate',
        confidence: 'medium_high',
        hookId: 'residual_overlay_cf64_index_read',
        summary: '_RAM_CF64_ is the runtime selector seed for the r2813 room-overlay tail proof gate.',
        evidence: catalog.evidence,
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRam.push({ id: cf64.id, address: cf64.address, role: 'room_overlay_index_selector_for_r2813_tail_gate' });
  }

  return { changedRegions, missingRegions, changedRam };
}

function applyCatalog(mapData, catalog, annotation) {
  mapData.runtimeTraceHookCatalogs = (mapData.runtimeTraceHookCatalogs || []).filter(item => item.id !== catalogId);
  mapData.runtimeTraceHookCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    generatedAt: now,
    tool: toolName,
    schemaVersion: 1,
    catalogId,
    sourceCatalogs,
    summary: {
      ...catalog.summary,
      changedRegionCount: annotation.changedRegions.length,
      missingRegionCount: annotation.missingRegions.length,
      changedRamCount: annotation.changedRam.length,
    },
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
    changedRam: annotation.changedRam,
    evidence: catalog.evidence,
    nextLeads: catalog.nextLeads,
    assetPolicy: catalog.assetPolicy,
  });
  mapData.updatedAt = now;
}

function updateStaticMap(catalog) {
  const staticMap = readJson(staticMapPath);
  staticMap.summary = staticMap.summary || {};
  staticMap.summary.residualRuntimeTraceHookPlanCatalog = catalogId;
  staticMap.summary.residualRuntimeTraceHookPlanCount = catalog.summary.tracePlanCount;
  staticMap.summary.residualRuntimeTraceHookPlanReady = catalog.summary.readyTracePlanCount;
  staticMap.summary.residualRuntimeTraceHookSpecCount = catalog.summary.runtimeHookSpecCount;
  staticMap.summary.residualRuntimeTracePromotionGateCount = catalog.summary.promotionGateCount;
  staticMap.generatedFrom = staticMap.generatedFrom || {};
  staticMap.generatedFrom[catalogId] = {
    generatedAt: now,
    tool: toolName,
    sourceMap: 'projects/WORLD/map.json',
    assetPolicy: catalog.assetPolicy,
  };
  staticMap.nextLeads = Array.isArray(staticMap.nextLeads) ? staticMap.nextLeads : [];
  const lead = 'Use world-residual-runtime-trace-hook-plan-catalog-2026-06-26 as the metadata-only hook contract for proving or rejecting r2813, r2815-r2817, and r0749 runtime consumers.';
  if (!staticMap.nextLeads.includes(lead)) staticMap.nextLeads.push(lead);
  writeJson(staticMapPath, staticMap);
}

function main() {
  const mapData = readJson(mapPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const catalog = buildCatalog(mapData, asmText);
  const annotation = annotateMap(mapData, catalog);
  if (apply) {
    applyCatalog(mapData, catalog, annotation);
    writeJson(mapPath, mapData);
    updateStaticMap(catalog);
  }
  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    reportId,
    summary: catalog.summary,
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
    changedRam: annotation.changedRam,
  }, null, 2));
}

main();
