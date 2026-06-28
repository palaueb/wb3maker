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
const catalogId = 'world-entity-c3c0-frame-step-helper-gap-catalog-2026-06-25';
const reportId = 'entity-c3c0-frame-step-helper-gap-audit-2026-06-25';
const toolName = 'tools/world-entity-c3c0-frame-step-helper-gap-audit.mjs';

const sourceCatalogIds = {
  frameStepSeed: 'world-entity-c3c0-frame-step-seed-catalog-2026-06-25',
  targetSemantics: 'world-entity-c3c0-behavior-target-semantics-catalog-2026-06-25',
  collisionInternalHelpers: 'world-entity-collision-fragment-internal-helper-catalog-2026-06-25',
  localSubroutines: 'world-entity-c3c0-frame-step-local-subroutine-catalog-2026-06-25',
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseHex(value) {
  if (typeof value === 'number') return value;
  const match = /^0x([0-9A-F]+)$/i.exec(String(value || ''));
  return match ? parseInt(match[1], 16) : null;
}

function hex(value, width = 5) {
  return `0x${Number(value || 0).toString(16).toUpperCase().padStart(width, '0')}`;
}

function offsetOf(region) {
  return typeof region?.offset === 'number' ? region.offset : parseHex(region?.offset) || 0;
}

function regionBounds(region) {
  const start = offsetOf(region);
  return { start, end: start + Number(region?.size || 0) };
}

function findContainingRegion(mapData, offset) {
  return (mapData.regions || []).find(region => {
    const bounds = regionBounds(region);
    return offset >= bounds.start && offset < bounds.end;
  }) || null;
}

function regionRef(region) {
  if (!region) return null;
  return {
    id: region.id || '',
    offset: region.offset || '',
    size: Number(region.size || 0),
    type: region.type || 'unknown',
    name: region.name || '',
  };
}

function findCatalog(mapData, id) {
  for (const [key, value] of Object.entries(mapData)) {
    if (!Array.isArray(value) || !/catalog/i.test(key)) continue;
    const catalog = value.find(item => item?.id === id);
    if (catalog) return catalog;
  }
  return null;
}

function requireCatalog(mapData, id) {
  const catalog = findCatalog(mapData, id);
  if (!catalog) throw new Error(`Missing required catalog ${id}`);
  return catalog;
}

function unique(items) {
  return [...new Set((items || []).filter(item => item !== '' && item != null))]
    .sort((a, b) => String(a).localeCompare(String(b)));
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items || []) {
    const key = keyFn(item);
    if (key === '' || key == null) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function compactTargetModel(target) {
  return {
    behaviorStateIndex: target.behaviorStateIndex,
    targetOffset: target.targetOffset,
    modelRole: target.modelRole || '',
    readiness: target.readiness || '',
    targetRegion: target.targetRegion || null,
    semanticTags: target.semanticTags || [],
  };
}

function regionKnownRole(region) {
  const analysis = region?.analysis || {};
  if (analysis.entityRuntimeRoutineAudit?.role) {
    return {
      role: analysis.entityRuntimeRoutineAudit.role,
      roleSource: 'entityRuntimeRoutineAudit.role',
      confidence: analysis.entityRuntimeRoutineAudit.confidence || 'medium',
      evidence: analysis.entityRuntimeRoutineAudit.evidence || [],
    };
  }
  if (analysis.entityObjectRecordAudit?.kind) {
    return {
      role: analysis.entityObjectRecordAudit.kind,
      roleSource: 'entityObjectRecordAudit.kind',
      confidence: analysis.entityObjectRecordAudit.confidence || 'medium',
      evidence: analysis.entityObjectRecordAudit.evidence || [],
    };
  }
  if (analysis.bank0CodeFragmentAudit?.kind) {
    return {
      role: analysis.bank0CodeFragmentAudit.kind,
      roleSource: 'bank0CodeFragmentAudit.kind',
      confidence: analysis.bank0CodeFragmentAudit.confidence || 'medium',
      evidence: analysis.bank0CodeFragmentAudit.evidence || [],
    };
  }
  if (analysis.entityBehaviorCodeAudit?.kind) {
    return {
      role: analysis.entityBehaviorCodeAudit.kind,
      roleSource: 'entityBehaviorCodeAudit.kind',
      confidence: analysis.entityBehaviorCodeAudit.confidence || 'medium',
      evidence: analysis.entityBehaviorCodeAudit.evidence || [],
    };
  }
  if (analysis.entityBehaviorSplitAudit?.kind) {
    return {
      role: analysis.entityBehaviorSplitAudit.kind,
      roleSource: 'entityBehaviorSplitAudit.kind',
      confidence: analysis.entityBehaviorSplitAudit.confidence || 'medium',
      evidence: analysis.entityBehaviorSplitAudit.evidence || [],
    };
  }
  if (analysis.inferred?.kind) {
    return {
      role: analysis.inferred.kind,
      roleSource: 'inferred.kind',
      confidence: analysis.inferred.confidence || 'low',
      evidence: analysis.inferred.evidence || [],
    };
  }
  return {
    role: '',
    roleSource: '',
    confidence: 'low',
    evidence: [],
  };
}

function roleStatusForTarget(call, region, knownRole, sourceTarget, internalHelper) {
  if (internalHelper && call.targetInSegment) {
    return {
      roleClass: internalHelper.role,
      resolutionStatus: 'local_behavior_subroutine_role_known',
      confidence: internalHelper.confidence || 'medium',
      exactSemanticsPending: false,
      evidence: [
        `${internalHelper.sourceCatalogId} classifies ${call.targetOffset} as ${internalHelper.role}.`,
        ...(internalHelper.evidence || []).slice(0, 3),
      ],
    };
  }

  if (internalHelper) {
    return {
      roleClass: internalHelper.role,
      resolutionStatus: 'internal_helper_entry_role_known',
      confidence: internalHelper.confidence || 'medium',
      exactSemanticsPending: false,
      evidence: [
        `${internalHelper.sourceCatalogId} classifies ${call.targetOffset} as ${internalHelper.role}.`,
        ...(internalHelper.evidence || []).slice(0, 3),
      ],
    };
  }

  if (call.targetInSegment) {
    return {
      roleClass: 'local_behavior_state_subroutine_role_pending',
      resolutionStatus: 'local_target_inside_behavior_state_segment_pending',
      confidence: 'medium',
      exactSemanticsPending: true,
      evidence: [
        `${sourceCatalogIds.targetSemantics} reports a local call from ${sourceTarget.targetOffset} at ${call.offset} to ${call.targetOffset}.`,
        'The target remains inside the bounded behavior-state segment, so it is preserved as a local state helper pending branch-level trace.',
      ],
    };
  }

  const targetOffset = parseHex(call.targetOffset);
  const regionStart = offsetOf(region);
  const exactEntry = region && targetOffset === regionStart;
  if (knownRole.role && exactEntry) {
    return {
      roleClass: knownRole.role,
      resolutionStatus: 'region_entry_role_known',
      confidence: knownRole.confidence || 'medium',
      exactSemanticsPending: false,
      evidence: [
        `${knownRole.roleSource} classifies the target region as ${knownRole.role}.`,
        ...knownRole.evidence.slice(0, 3),
      ],
    };
  }
  if (knownRole.role && !exactEntry) {
    return {
      roleClass: `${knownRole.role}_internal_entry_role_pending`,
      resolutionStatus: 'region_class_known_exact_entry_pending',
      confidence: knownRole.confidence === 'high' ? 'medium' : knownRole.confidence || 'medium',
      exactSemanticsPending: true,
      evidence: [
        `${knownRole.roleSource} classifies the containing region as ${knownRole.role}.`,
        `The call target ${call.targetOffset} is inside ${region?.id || 'an unknown region'}, not at the region start, so exact helper semantics remain pending.`,
        ...knownRole.evidence.slice(0, 2),
      ],
    };
  }
  if (call.targetLabel) {
    return {
      roleClass: 'labeled_external_helper_role_pending',
      resolutionStatus: 'label_known_role_pending',
      confidence: 'medium',
      exactSemanticsPending: true,
      evidence: [
        `${sourceCatalogIds.targetSemantics} names the target as ${call.targetLabel}, but no helper role catalog classified it.`,
      ],
    };
  }
  return {
    roleClass: 'external_helper_role_pending',
    resolutionStatus: 'target_region_unclassified',
    confidence: 'low',
    exactSemanticsPending: true,
    evidence: [
      `${sourceCatalogIds.targetSemantics} reports a roleless external call to ${call.targetOffset}.`,
    ],
  };
}

function collectRolelessCalls(seedCatalog, semanticsCatalog) {
  const targetModels = seedCatalog.seedModel?.targetModels || [];
  const targetModelByOffset = new Map(targetModels.map(target => [target.targetOffset, compactTargetModel(target)]));
  const sourceTargets = (semanticsCatalog.targets || []).filter(target => targetModelByOffset.has(target.targetOffset));
  const calls = [];
  for (const sourceTarget of sourceTargets) {
    const model = targetModelByOffset.get(sourceTarget.targetOffset);
    for (const call of sourceTarget.callTargets || []) {
      if (call.targetRole) continue;
      const roleGapKind = call.targetInSegment
        ? 'local_role_pending_call'
        : call.targetLabel
          ? 'labeled_external_role_pending_call'
          : 'unlabeled_external_role_pending_call';
      calls.push({
        roleGapKind,
        behaviorStateIndex: model.behaviorStateIndex,
        sourceTargetOffset: sourceTarget.targetOffset,
        sourceTargetRole: model.modelRole,
        sourceTargetReadiness: model.readiness,
        sourceTargetRegion: model.targetRegion,
        sourceSemanticTags: model.semanticTags,
        callOffset: call.offset,
        callKind: call.kind || 'call',
        conditional: Boolean(call.conditional),
        targetOffset: call.targetOffset,
        targetLabel: call.targetLabel || '',
        targetInSegment: Boolean(call.targetInSegment),
      });
    }
  }
  return calls;
}

function buildInternalHelperIndex(internalHelperCatalog, localSubroutineCatalog) {
  const index = new Map();
  for (const helper of internalHelperCatalog?.helpers || []) {
    if (helper?.offset) index.set(helper.offset, {
      ...helper,
      sourceCatalogId: internalHelperCatalog.id,
    });
  }
  for (const helper of localSubroutineCatalog?.localSubroutines || []) {
    if (helper?.offset) index.set(helper.offset, {
      ...helper,
      sourceCatalogId: localSubroutineCatalog.id,
    });
  }
  return index;
}

function buildTargetModels(mapData, rolelessCalls, internalHelperIndex) {
  const byTarget = new Map();
  for (const call of rolelessCalls) {
    if (!byTarget.has(call.targetOffset)) byTarget.set(call.targetOffset, []);
    byTarget.get(call.targetOffset).push(call);
  }

  return [...byTarget.entries()].sort((a, b) => parseHex(a[0]) - parseHex(b[0])).map(([targetOffsetText, calls]) => {
    const targetOffset = parseHex(targetOffsetText);
    const region = findContainingRegion(mapData, targetOffset);
    const internalHelper = internalHelperIndex.get(targetOffsetText) || null;
    const knownRole = internalHelper ? {
      role: internalHelper.role,
      roleSource: `${sourceCatalogIds.collisionInternalHelpers}.helpers`,
      confidence: internalHelper.confidence || 'medium',
      evidence: internalHelper.evidence || [],
    } : regionKnownRole(region);
    const firstCall = calls[0] || {};
    const status = roleStatusForTarget(firstCall, region, knownRole, firstCall, internalHelper);
    return {
      targetOffset: targetOffsetText,
      targetLabel: firstCall.targetLabel || '',
      targetInBehaviorSegment: Boolean(firstCall.targetInSegment),
      targetRegion: regionRef(region),
      regionRole: knownRole.role,
      regionRoleSource: knownRole.roleSource,
      roleClass: status.roleClass,
      roleResolutionStatus: status.resolutionStatus,
      confidence: status.confidence,
      exactSemanticsPending: Boolean(status.exactSemanticsPending),
      sourceCallCount: calls.length,
      sourceCallOffsets: calls.map(call => call.callOffset).sort(),
      sourceBehaviorStateIndexes: unique(calls.map(call => call.behaviorStateIndex)),
      sourceTargetOffsets: unique(calls.map(call => call.sourceTargetOffset)),
      sourceTargetRoles: unique(calls.map(call => call.sourceTargetRole)),
      sourceSemanticTags: unique(calls.flatMap(call => call.sourceSemanticTags)),
      roleGapKinds: unique(calls.map(call => call.roleGapKind)),
      persistedRomByteCount: 0,
      persistedGameplayValueCount: 0,
      evidence: [
        `${sourceCatalogIds.targetSemantics} recorded ${calls.length} roleless callsite(s) to ${targetOffsetText} from the actor 0x26 frame-step seed targets.`,
        ...status.evidence,
      ],
    };
  });
}

function buildRegionGroups(targets) {
  const byRegion = new Map();
  for (const target of targets) {
    const key = target.targetRegion?.id || 'missing';
    if (!byRegion.has(key)) byRegion.set(key, []);
    byRegion.get(key).push(target);
  }
  return [...byRegion.entries()].map(([regionId, grouped]) => ({
    regionId,
    targetRegion: grouped.find(target => target.targetRegion)?.targetRegion || null,
    helperTargetCount: grouped.length,
    sourceCallCount: grouped.reduce((sum, target) => sum + target.sourceCallCount, 0),
    targetOffsets: grouped.map(target => target.targetOffset),
    roleClasses: unique(grouped.map(target => target.roleClass)),
    roleResolutionStatuses: unique(grouped.map(target => target.roleResolutionStatus)),
    sourceBehaviorStateIndexes: unique(grouped.flatMap(target => target.sourceBehaviorStateIndexes)),
    exactSemanticsPendingTargetCount: grouped.filter(target => target.exactSemanticsPending).length,
    confidence: grouped.some(target => target.confidence !== 'high') ? 'medium' : 'high',
    persistedRomByteCount: 0,
    persistedGameplayValueCount: 0,
    evidence: [
      `${grouped.length} actor 0x26 roleless helper target(s) resolve to this mapped region.`,
      `Role statuses: ${unique(grouped.map(target => target.roleResolutionStatus)).join(', ') || 'none'}.`,
    ],
  })).sort((a, b) => parseHex(a.targetRegion?.offset) - parseHex(b.targetRegion?.offset));
}

function buildCatalog(mapData) {
  const frameStepSeed = requireCatalog(mapData, sourceCatalogIds.frameStepSeed);
  const targetSemantics = requireCatalog(mapData, sourceCatalogIds.targetSemantics);
  const internalHelperCatalog = findCatalog(mapData, sourceCatalogIds.collisionInternalHelpers);
  const localSubroutineCatalog = findCatalog(mapData, sourceCatalogIds.localSubroutines);
  const internalHelperIndex = buildInternalHelperIndex(internalHelperCatalog, localSubroutineCatalog);
  const rolelessCalls = collectRolelessCalls(frameStepSeed, targetSemantics);
  const helperTargets = buildTargetModels(mapData, rolelessCalls, internalHelperIndex);
  const regionGroups = buildRegionGroups(helperTargets);
  const exactKnown = helperTargets.filter(target => !target.exactSemanticsPending);
  const pending = helperTargets.filter(target => target.exactSemanticsPending);
  const localPending = helperTargets.filter(target => target.roleResolutionStatus === 'local_target_inside_behavior_state_segment_pending');
  const internalPending = helperTargets.filter(target => target.roleResolutionStatus === 'region_class_known_exact_entry_pending');
  const regionEntryKnown = helperTargets.filter(target => target.roleResolutionStatus === 'region_entry_role_known');
  const regionKnown = helperTargets.filter(target => target.regionRole);
  const internalEntryKnown = helperTargets.filter(target => target.roleResolutionStatus === 'internal_helper_entry_role_known');
  const localEntryKnown = helperTargets.filter(target => target.roleResolutionStatus === 'local_behavior_subroutine_role_known');
  const sourceCatalogs = Object.values(sourceCatalogIds).filter(id =>
    (id !== sourceCatalogIds.collisionInternalHelpers || internalHelperCatalog) &&
    (id !== sourceCatalogIds.localSubroutines || localSubroutineCatalog)
  );

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs,
    summary: {
      candidateEntityType: frameStepSeed.summary?.candidateEntityType || '',
      candidateSeedLabel: frameStepSeed.summary?.candidateSeedLabel || '',
      behaviorListSource: frameStepSeed.summary?.behaviorListSource || '',
      sourceBehaviorTargetCount: Number(frameStepSeed.summary?.behaviorTargetCount || 0),
      rolelessCallsiteCount: rolelessCalls.length,
      externalRolelessCallsiteCount: rolelessCalls.filter(call => !call.targetInSegment).length,
      localRolelessCallsiteCount: rolelessCalls.filter(call => call.targetInSegment).length,
      uniqueHelperTargetCount: helperTargets.length,
      externalHelperTargetCount: helperTargets.filter(target => !target.targetInBehaviorSegment).length,
      localHelperTargetCount: helperTargets.filter(target => target.targetInBehaviorSegment).length,
      localPendingHelperTargetCount: localPending.length,
      regionBackedHelperTargetCount: regionKnown.length,
      roleKnownTargetCount: exactKnown.length,
      exactRegionRoleKnownTargetCount: regionEntryKnown.length,
      internalHelperEntryRoleKnownTargetCount: internalEntryKnown.length,
      localBehaviorSubroutineRoleKnownTargetCount: localEntryKnown.length,
      regionClassKnownExactEntryPendingTargetCount: internalPending.length,
      localExactSemanticsPendingTargetCount: localPending.length,
      exactSemanticsPendingTargetCount: pending.length,
      roleResolutionStatusCounts: countBy(helperTargets, target => target.roleResolutionStatus),
      roleClassCounts: countBy(helperTargets, target => target.roleClass),
      sourceBehaviorStateCallCounts: countBy(rolelessCalls, call => String(call.behaviorStateIndex)),
      targetRegionCount: regionGroups.filter(group => group.targetRegion).length,
      collisionInternalHelperCatalogBacked: Boolean(internalHelperCatalog),
      collisionInternalHelperCatalogId: internalHelperCatalog?.id || '',
      localSubroutineCatalogBacked: Boolean(localSubroutineCatalog),
      localSubroutineCatalogId: localSubroutineCatalog?.id || '',
      persistedRomByteCount: 0,
      persistedGameplayValueCount: 0,
      assetPolicy: 'Metadata only: actor ids, behavior-state indexes, call offsets, target offsets, labels, region ids, role classes, confidence, counts, and evidence. No ROM bytes, decoded graphics, coordinates, screenshots, music, text, instruction byte streams, or gameplay constants are embedded.',
    },
    rolelessCalls,
    helperTargets,
    regionGroups,
    evidence: [
      `${sourceCatalogIds.frameStepSeed} identifies actor 0x26 / _LABEL_6D13_ as the first metadata-backed C3C0 frame-step seed.`,
      `${sourceCatalogIds.targetSemantics} supplies bounded callsite metadata for the seed's five behavior targets without persisting instruction bytes.`,
      internalHelperCatalog
        ? `${sourceCatalogIds.collisionInternalHelpers} supplies exact roles for internal collision-fragment helper entries that were previously only region-class backed.`
        : 'Existing region audits supply reusable helper-role evidence for region-start targets and containing-region evidence for internal helper entries.',
      localSubroutineCatalog
        ? `${sourceCatalogIds.localSubroutines} supplies exact roles for local behavior-state subroutines that were previously local pending targets.`
        : 'Local behavior-state subroutines remain pending until a dedicated local-subroutine catalog is generated.',
    ],
    nextLeads: [
      'Use the role-resolved helper targets as named stubs for a read-only actor 0x26 frame-step diagnostic.',
      'Trace branch predicates and timer constants inside the state 0 and state 4 local helpers before promoting frame-exact JavaScript behavior.',
      'Join actor 0x26 room fixtures to this helper model to verify state transitions against rendered dynamic frame coverage.',
    ],
  };
}

function annotateRegion(region, group, catalog) {
  if (!region) return null;
  region.analysis = region.analysis || {};
  region.analysis.c3c0FrameStepHelperGapAudit = {
    catalogId,
    kind: 'c3c0_frame_step_helper_gap_region',
    confidence: group.confidence,
    entityType: catalog.summary.candidateEntityType,
    seedLabel: catalog.summary.candidateSeedLabel,
    behaviorListSource: catalog.summary.behaviorListSource,
    helperTargetCount: group.helperTargetCount,
    sourceCallCount: group.sourceCallCount,
    targetOffsets: group.targetOffsets,
    roleClasses: group.roleClasses,
    roleResolutionStatuses: group.roleResolutionStatuses,
    sourceBehaviorStateIndexes: group.sourceBehaviorStateIndexes,
    exactSemanticsPendingTargetCount: group.exactSemanticsPendingTargetCount,
    persistedRomByteCount: 0,
    persistedGameplayValueCount: 0,
    summary: `${group.helperTargetCount} roleless actor 0x26 helper target(s) resolve here; ${group.exactSemanticsPendingTargetCount} still need exact helper semantics.`,
    evidence: group.evidence,
    generatedAt: now,
    tool: toolName,
  };
  return {
    region: regionRef(region),
    helperTargetCount: group.helperTargetCount,
    sourceCallCount: group.sourceCallCount,
    targetOffsets: group.targetOffsets,
    roleResolutionStatuses: group.roleResolutionStatuses,
    exactSemanticsPendingTargetCount: group.exactSemanticsPendingTargetCount,
    confidence: group.confidence,
  };
}

function applyCatalog(mapData, catalog) {
  mapData.entityBehaviorCodeCatalogs = (mapData.entityBehaviorCodeCatalogs || []).filter(item => item.id !== catalogId);
  mapData.entityBehaviorCodeCatalogs.push(catalog);

  const annotatedRegions = [];
  for (const group of catalog.regionGroups || []) {
    const targetOffset = parseHex(group.targetOffsets?.[0]);
    const region = targetOffset == null ? null : findContainingRegion(mapData, targetOffset);
    const annotated = annotateRegion(region, group, catalog);
    if (annotated) annotatedRegions.push(annotated);
  }

  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'entity_c3c0_frame_step_helper_gap_audit',
    schemaVersion: 1,
    generatedAt: now,
    tool: `${toolName} --apply`,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: {
      ...catalog.summary,
      annotatedRegionCount: annotatedRegions.length,
    },
    annotatedRegions,
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
    helperTargets: catalog.helperTargets.map(target => ({
      targetOffset: target.targetOffset,
      roleClass: target.roleClass,
      roleResolutionStatus: target.roleResolutionStatus,
      sourceCallCount: target.sourceCallCount,
      confidence: target.confidence,
      exactSemanticsPending: target.exactSemanticsPending,
    })),
  }, null, 2));
}

main();
