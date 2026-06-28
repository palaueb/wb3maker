#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const finalDispositionCatalogId = 'world-bank2-vdp-residual-final-disposition-catalog-2026-06-26';
const drawFieldCatalogId = 'world-bank2-vdp-residual-draw-field-catalog-2026-06-26';
const streamStateCatalogId = 'world-bank2-vdp-stream-state-catalog-2026-06-25';
const layoutCatalogId = 'world-bank2-vdp-stream-layout-catalog-2026-06-25';
const catalogId = 'world-bank2-vdp-runtime-trace-hook-plan-catalog-2026-06-26';
const reportId = 'bank2-vdp-runtime-trace-hook-plan-audit-2026-06-26';
const toolName = 'tools/world-bank2-vdp-runtime-trace-hook-plan-audit.mjs';
const schemaVersion = 1;

const hookSpecs = [
  {
    id: 'bank2_vdp_978e_renderer_entry',
    label: '_LABEL_978E_',
    offset: '0x0978E',
    eventKind: 'bank2_vdp_renderer_entry',
    hookClass: 'runtime_trace_hook',
    captureFields: ['_RAM_D176_', '_RAM_D178_', '_RAM_D151_', '_RAM_D154_', 'same_frame_trace_id'],
    reason: 'Binds one renderer invocation to the pointer-list root and clipping/window state before _LABEL_97D9_ scans draw segment pointers.',
    asmLineEvidence: ['ASM lines 19520-19539 load _RAM_D176_ into HL before entering _LABEL_97D9_.'],
  },
  {
    id: 'bank2_vdp_97d9_pointer_list_reader',
    label: '_LABEL_97D9_',
    offset: '0x097D9',
    eventKind: 'bank2_vdp_draw_pointer_list_entry',
    hookClass: 'runtime_trace_hook',
    captureFields: ['pointer_list_cursor_offset', 'selected_segment_offset', 'selected_segment_is_zero_terminator', 'same_frame_trace_id'],
    reason: 'Confirms whether a real _RAM_D176_ pointer-list entry selects one of the weak residual draw-boundary offsets.',
    asmLineEvidence: ['ASM lines 19542-19554 read a word from HL, stop on zero, and jump into the selected draw segment when nonzero.'],
  },
  {
    id: 'bank2_vdp_97e6_segment_entry',
    label: '_LABEL_97E6_',
    offset: '0x097E6',
    eventKind: 'bank2_vdp_draw_segment_entry',
    hookClass: 'runtime_trace_hook',
    captureFields: ['segment_entry_offset', '_RAM_D17A_', '_RAM_D17B_', '_RAM_D178_', 'same_frame_trace_id'],
    reason: 'Captures the segment entry actually reached from the pointer-list reader before VDP address setup.',
    asmLineEvidence: ['ASM lines 19557-19568 read the segment setup word, add _RAM_D17A_/_RAM_D17B_, and store the resulting address in _RAM_D178_.'],
  },
  {
    id: 'bank2_vdp_9812_draw_field_step',
    label: '_LABEL_9812_',
    offset: '0x09812',
    eventKind: 'bank2_vdp_draw_segment_field_step',
    hookClass: 'runtime_trace_hook',
    captureFields: ['segment_entry_offset', 'field_offset', 'field_role', 'field_is_inside_target_gap', 'same_frame_trace_id'],
    reason: 'Distinguishes a boundary selected as a segment entry from a raw word encountered only as a field inside another segment candidate.',
    asmLineEvidence: ['ASM lines 19583-19615 loop over draw fields, emitting/clipping tile-word pairs until a control path is reached.'],
  },
  {
    id: 'bank2_vdp_9861_control_step',
    label: '_LABEL_9861_',
    offset: '0x09861',
    eventKind: 'bank2_vdp_draw_segment_control_step',
    hookClass: 'runtime_trace_hook',
    captureFields: ['segment_entry_offset', 'control_field_offset', 'control_path_role', 'same_frame_trace_id'],
    reason: 'Records symbolic control-path roles without persisting control byte values from the ROM stream.',
    asmLineEvidence: ['ASM lines 19625-19654 dispatch F0+ draw-stream control paths and resume or jump to a new draw address.'],
  },
  {
    id: 'bank2_vdp_98a5_segment_return',
    label: '_LABEL_98A5_',
    offset: '0x098A5',
    eventKind: 'bank2_vdp_draw_segment_return_to_pointer_list',
    hookClass: 'runtime_trace_hook',
    captureFields: ['segment_entry_offset', 'return_pointer_list_cursor_offset', 'same_frame_trace_id'],
    reason: 'Closes one selected segment and links it back to the pointer-list scan at _LABEL_97D9_.',
    asmLineEvidence: ['ASM lines 19693-19695 return from a segment and resume pointer-list scanning at _LABEL_97D9_.'],
  },
  {
    id: 'bank2_vdp_residual_promotion_gate',
    label: 'bank2_vdp_residual_promotion_gate',
    offset: null,
    eventKind: 'metadata_promotion_gate',
    hookClass: 'metadata_promotion_gate',
    captureFields: ['same_frame_trace_id', 'selected_segment_offset', 'target_boundary_offset', 'target_gap_id'],
    reason: 'Promotes or rejects each weak residual boundary only after same-frame pointer-list and segment-entry evidence exists.',
    asmLineEvidence: ['Gate combines _LABEL_97D9_, _LABEL_97E6_, and _LABEL_9812_ events; it is not an ASM label.'],
  },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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
  if (!catalog) throw new Error(`Missing required catalog ${id}`);
  return catalog;
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function countBy(items, keyFn) {
  return items.reduce((counts, item) => {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function uniqueSorted(values) {
  return [...new Set((values || []).filter(value => value != null && value !== ''))].sort((a, b) => {
    const an = Number.parseInt(String(a).replace(/^\$/, '0x'), 16);
    const bn = Number.parseInt(String(b).replace(/^\$/, '0x'), 16);
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
    return String(a).localeCompare(String(b));
  });
}

function targetByParent(drawFieldCatalog) {
  const byParent = new Map();
  for (const target of drawFieldCatalog.targets || []) {
    if (!target.parentGapId) continue;
    if (!byParent.has(target.parentGapId)) byParent.set(target.parentGapId, []);
    byParent.get(target.parentGapId).push(target);
  }
  return byParent;
}

function compactTarget(target) {
  return {
    id: target.id,
    parentGapId: target.parentGapId,
    targetOffset: target.targetOffset,
    boundaryKind: target.boundaryKind,
    disposition: target.disposition,
    confidence: target.confidence,
    sourceStatusCounts: target.sourceStatusCounts || {},
    decodedSourceGapCounts: target.decodedSourceGapCounts || {},
    sourceCandidatesConsumingBeyondGap: target.sourceCandidatesConsumingBeyondGap || 0,
  };
}

function buildTracePlans(finalCatalog, drawFieldCatalog) {
  const targetsByParent = targetByParent(drawFieldCatalog);
  return (finalCatalog.unresolvedTraceLeads || []).map((lead, index) => {
    const targets = (targetsByParent.get(lead.id) || []).map(compactTarget);
    const targetBoundaryOffsets = uniqueSorted(targets.map(target => target.targetOffset));
    return {
      id: `bank2_vdp_residual_trace_plan_${index}_${lead.id}`,
      parentGapId: lead.id,
      parentGapRange: lead.range,
      layoutClass: lead.layoutClass,
      finalDisposition: lead.finalDisposition,
      confidence: lead.confidence,
      traceStatus: 'runtime_trace_pending',
      traceQuestion: 'Does a confirmed _RAM_D176_ pointer-list entry select this gap start or tail boundary as an actual draw-segment entry?',
      targetBoundaryOffsets,
      targetBoundaries: targets,
      requiredRuntimeHookIds: [
        'bank2_vdp_978e_renderer_entry',
        'bank2_vdp_97d9_pointer_list_reader',
        'bank2_vdp_97e6_segment_entry',
        'bank2_vdp_9812_draw_field_step',
        'bank2_vdp_residual_promotion_gate',
      ],
      optionalRuntimeHookIds: [
        'bank2_vdp_9861_control_step',
        'bank2_vdp_98a5_segment_return',
      ],
      promotionGate: {
        sameFrameRequired: true,
        runtimeTraceConfirmed: false,
        promotionReady: false,
        coverageChangedByThisAudit: false,
        requiredEvidence: [
          'A _LABEL_978E_ renderer event and one or more _LABEL_97D9_ pointer-list entry events share the same_frame_trace_id.',
          'A _LABEL_97D9_ selected_segment_offset equals one targetBoundaryOffset, and the following _LABEL_97E6_ segment_entry_offset matches it.',
          'If _LABEL_9812_ reaches the target only as a field_offset from a different segment_entry_offset, keep the boundary as weak/non-promoted.',
          'Persist only offsets, roles, and yes/no proof fields; do not persist stream bytes, VDP port values, decoded pixels, or register traces.',
        ],
      },
      blockers: {
        runtimeTraceConfirmed: false,
        directPointerListProducerConfirmed: false,
        fieldOnlyContextRejected: false,
        promotionReady: false,
      },
      evidenceCatalogs: [finalDispositionCatalogId, drawFieldCatalogId],
      persistedRomByteCount: 0,
      persistedStreamByteCount: 0,
      persistedOpcodeCount: 0,
      persistedPortValueCount: 0,
      persistedRegisterTraceCount: 0,
      persistedPixelCount: 0,
    };
  });
}

function buildRamTraceSeeds(mapData, streamStateCatalog) {
  const wanted = new Set(['$D176', '$D178', '$D17A', '$D17B', '$D151', '$D154']);
  const symbolForAddress = address => `_RAM_${String(address || '').replace(/^\$/, '').toUpperCase()}_`;
  const fromCatalog = (streamStateCatalog.ramRoles || [])
    .filter(role => wanted.has(role.address || role[0]))
    .map(role => ({
      address: role.address || role[0],
      symbol: role.symbol || symbolForAddress(role.address || role[0]),
      role: role.role || role[1] || 'bank2_vdp_trace_seed',
      confidence: role.confidence || role[3] || 'medium',
    }));
  const present = new Set(fromCatalog.map(seed => seed.address));
  for (const address of wanted) {
    if (present.has(address)) continue;
    const ram = (mapData.ram || []).find(entry => String(entry.address || '').toUpperCase() === address);
    fromCatalog.push({
      address,
      symbol: symbolForAddress(address),
      role: 'bank2_vdp_trace_seed',
      confidence: ram ? 'medium' : 'low',
    });
  }
  return fromCatalog;
}

function buildCatalog(mapData) {
  const finalCatalog = requireCatalog(mapData, finalDispositionCatalogId);
  const drawFieldCatalog = requireCatalog(mapData, drawFieldCatalogId);
  const streamStateCatalog = requireCatalog(mapData, streamStateCatalogId);
  const layoutCatalog = requireCatalog(mapData, layoutCatalogId);
  const tracePlans = buildTracePlans(finalCatalog, drawFieldCatalog);
  const runtimeHooks = hookSpecs.filter(hook => hook.hookClass === 'runtime_trace_hook');
  const promotionGates = hookSpecs.filter(hook => hook.hookClass === 'metadata_promotion_gate');
  const ramTraceSeeds = buildRamTraceSeeds(mapData, streamStateCatalog);

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [finalDispositionCatalogId, drawFieldCatalogId, streamStateCatalogId, layoutCatalogId],
    assetPolicy: 'Metadata only: hook ids, labels, offsets, RAM symbols, target boundary offsets, field roles, proof gates, and counts. No ROM bytes, stream bytes, decoded graphics, VDP port values, screenshots, hashes, instruction bytes, register traces, or asset payloads are embedded.',
    target: {
      regionId: 'r0186',
      region: finalCatalog.bundle?.region || null,
      reason: 'Resolve the four bank-2 VDP residual weak draw-boundary leads by proving whether the live _RAM_D176_ pointer-list selects them.',
    },
    summary: {
      unresolvedTraceLeadCount: finalCatalog.summary?.unresolvedTraceLeadCount || tracePlans.length,
      tracePlanCount: tracePlans.length,
      targetBoundaryCount: tracePlans.reduce((sum, plan) => sum + plan.targetBoundaryOffsets.length, 0),
      hookSpecCount: hookSpecs.length,
      runtimeHookSpecCount: runtimeHooks.length,
      promotionGateCount: promotionGates.length,
      ramTraceSeedCount: ramTraceSeeds.length,
      targetBoundaryKindCounts: countBy(tracePlans.flatMap(plan => plan.targetBoundaries), target => target.boundaryKind),
      sourceDecodedGapCounts: countBy(tracePlans.flatMap(plan => plan.targetBoundaries.flatMap(target => Object.keys(target.decodedSourceGapCounts || {}))), key => key),
      layoutDecodedCoverageBytes: layoutCatalog.summary?.decodedCoverageBytes || 0,
      layoutResidualGapBytes: layoutCatalog.summary?.gapBytes || 0,
      runtimeTraceConfirmedCount: 0,
      promotionReadyCount: 0,
      coverageChangedByThisAudit: false,
      persistedRomByteCount: 0,
      persistedStreamByteCount: 0,
      persistedOpcodeCount: 0,
      persistedPortValueCount: 0,
      persistedRegisterTraceCount: 0,
      persistedPixelCount: 0,
    },
    hookSpecs,
    runtimeHooks,
    promotionGates,
    ramTraceSeeds,
    tracePlans,
    evidence: [
      `${finalDispositionCatalogId} identifies four weak draw-boundary leads that cannot be promoted without runtime pointer-list evidence.`,
      `${drawFieldCatalogId} records the eight gap-start/tail target offsets and explains existing raw hits as field contexts, not confirmed producers.`,
      'ASM _LABEL_978E_ loads _RAM_D176_ and enters _LABEL_97D9_; _LABEL_97D9_ reads segment pointers; _LABEL_97E6_ enters the selected segment; _LABEL_9812_ steps draw fields.',
      'This audit records a runtime trace contract only. It does not confirm any boundary and does not promote coverage.',
    ],
    nextLeads: [
      'Add emulator callbacks for the hook ids in this catalog and emit metadata-only events keyed by same_frame_trace_id.',
      'Run representative bank-2 VDP scenes and evaluate each promotion gate against selected_segment_offset and segment_entry_offset.',
      'If a boundary is selected by _LABEL_97D9_/_LABEL_97E6_, update the residual final disposition catalog; otherwise keep it rejected as field-only context.',
    ],
  };
}

function findRamByAddress(mapData, address) {
  return (mapData.ram || []).find(entry => String(entry.address || '').toUpperCase() === String(address || '').toUpperCase()) || null;
}

function annotateMap(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  const region = findRegionById(mapData, 'r0186');
  if (!region) {
    missingRegions.push({ id: 'r0186', role: 'bank2_vdp_runtime_trace_hook_plan' });
  } else {
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.bank2VdpRuntimeTraceHookPlanAudit = {
        catalogId,
        kind: 'bank2_vdp_runtime_trace_hook_plan',
        confidence: 'medium_high',
        summary: 'Runtime trace-hook plan for the four weak bank-2 VDP residual draw-boundary leads; no coverage is promoted by this audit.',
        detail: {
          tracePlanCount: catalog.summary.tracePlanCount,
          targetBoundaryCount: catalog.summary.targetBoundaryCount,
          runtimeHookSpecCount: catalog.summary.runtimeHookSpecCount,
          promotionGateCount: catalog.summary.promotionGateCount,
          ramTraceSeedCount: catalog.summary.ramTraceSeedCount,
          runtimeTraceConfirmedCount: catalog.summary.runtimeTraceConfirmedCount,
          promotionReadyCount: catalog.summary.promotionReadyCount,
          coverageChangedByThisAudit: catalog.summary.coverageChangedByThisAudit,
        },
        evidence: catalog.evidence,
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type,
      name: region.name || '',
      role: 'bank2_vdp_runtime_trace_hook_plan',
    });
  }

  const changedRam = [];
  const missingRam = [];
  for (const seed of catalog.ramTraceSeeds || []) {
    const ram = findRamByAddress(mapData, seed.address);
    if (!ram) {
      missingRam.push(seed);
      continue;
    }
    if (apply) {
      ram.analysis = ram.analysis || {};
      ram.analysis.bank2VdpRuntimeTraceHookPlanAudit = {
        catalogId,
        kind: 'bank2_vdp_runtime_trace_seed',
        symbol: seed.symbol,
        role: seed.role,
        confidence: seed.confidence,
        summary: 'RAM variable should be captured by the bank-2 VDP residual runtime trace harness.',
        tracePlanCount: catalog.summary.tracePlanCount,
        runtimeTraceConfirmedCount: catalog.summary.runtimeTraceConfirmedCount,
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRam.push({
      address: seed.address,
      symbol: seed.symbol,
      role: seed.role,
      confidence: seed.confidence,
    });
  }

  return { changedRegions, missingRegions, changedRam, missingRam };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const annotation = annotateMap(mapData, catalog);

  if (apply) {
    mapData.runtimeTraceHookCatalogs = (mapData.runtimeTraceHookCatalogs || []).filter(item => item.id !== catalogId);
    mapData.runtimeTraceHookCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'bank2_vdp_runtime_trace_hook_plan_audit',
      generatedAt: now,
      schemaVersion,
      tool: `${toolName} --apply`,
      catalogId,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: catalog.summary,
      changedRegions: annotation.changedRegions,
      missingRegions: annotation.missingRegions,
      changedRam: annotation.changedRam,
      missingRam: annotation.missingRam,
      sample: {
        hookSpecs: catalog.hookSpecs.map(hook => ({
          id: hook.id,
          label: hook.label,
          eventKind: hook.eventKind,
          hookClass: hook.hookClass,
        })),
        tracePlans: catalog.tracePlans.map(plan => ({
          id: plan.id,
          parentGapId: plan.parentGapId,
          targetBoundaryOffsets: plan.targetBoundaryOffsets,
          traceStatus: plan.traceStatus,
        })),
      },
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
      assetPolicy: catalog.assetPolicy,
    });
    fs.writeFileSync(mapPath, `${JSON.stringify(mapData, null, 2)}\n`);
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    hookSpecs: catalog.hookSpecs.map(hook => ({
      id: hook.id,
      label: hook.label,
      eventKind: hook.eventKind,
      hookClass: hook.hookClass,
    })),
    tracePlans: catalog.tracePlans.map(plan => ({
      id: plan.id,
      parentGapId: plan.parentGapId,
      parentGapRange: plan.parentGapRange,
      targetBoundaryOffsets: plan.targetBoundaryOffsets,
      traceStatus: plan.traceStatus,
      requiredRuntimeHookIds: plan.requiredRuntimeHookIds,
    })),
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
    changedRam: annotation.changedRam,
    missingRam: annotation.missingRam,
  }, null, 2));
}

main();
