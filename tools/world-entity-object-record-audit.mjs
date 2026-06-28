#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-24T00:00:00Z';
const catalogId = 'world-entity-object-record-catalog-2026-06-24';
const reportId = 'entity-object-record-audit-2026-06-24';

const SPLITS = [
  {
    sourceOffset: 0x07AE4,
    originalSize: 0x00A8,
    keepSize: 0x005F,
    keepType: 'code',
    keepRole: 'entity_behavior_code_before_object_records',
    newOffset: 0x07B43,
    newSize: 0x0049,
    newType: 'entity_data',
    newName: 'entity object record stream @ 0x7B43',
    newRole: 'entity_object_record_stream_prefix',
  },
  {
    sourceOffset: 0x07BA4,
    originalSize: 0x00A8,
    keepSize: 0x0062,
    keepType: 'entity_data',
    keepRole: 'entity_object_record_stream_continuation',
    newOffset: 0x07C06,
    newSize: 0x0046,
    newType: 'code',
    newName: 'entity object record loader helper @ 0x7C06',
    newRole: 'entity_object_record_loader_helper',
  },
];

const RETYPES = [
  {
    offset: 0x07B8C,
    inferredType: 'entity_data',
    role: 'entity_object_record_stream_middle',
    summary: 'Continuation of the object record stream between the 0x7B43 prefix and the 0x7BA4 continuation.',
  },
];

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function findExactRegion(mapData, offset) {
  return (mapData.regions || []).find(region => parseInt(region.offset, 16) === offset) || null;
}

function regionRef(region) {
  if (!region) return null;
  return {
    id: region.id,
    name: region.name || '',
    type: region.type || 'unknown',
    offset: region.offset,
    size: region.size || 0,
  };
}

function nextRegionId(mapData) {
  let maxId = 0;
  for (const region of mapData.regions || []) {
    const match = /^r(\d+)$/.exec(region.id || '');
    if (match) maxId = Math.max(maxId, Number(match[1]));
  }
  return 'r' + String(maxId + 1).padStart(4, '0');
}

function splitAlreadyApplied(mapData, def) {
  const sourceRegion = findExactRegion(mapData, def.sourceOffset);
  const newRegion = findExactRegion(mapData, def.newOffset);
  return Boolean(
    sourceRegion &&
    sourceRegion.size === def.keepSize &&
    (sourceRegion.type || 'unknown') === def.keepType &&
    newRegion &&
    newRegion.size === def.newSize &&
    (newRegion.type || 'unknown') === def.newType
  );
}

function splitCanApply(mapData, def) {
  const sourceRegion = findExactRegion(mapData, def.sourceOffset);
  const newRegion = findExactRegion(mapData, def.newOffset);
  return Boolean(
    sourceRegion &&
    sourceRegion.size === def.originalSize &&
    !newRegion &&
    parseInt(sourceRegion.offset, 16) === def.sourceOffset
  );
}

function splitBlockedReasons(mapData, def) {
  const sourceRegion = findExactRegion(mapData, def.sourceOffset);
  const newRegion = findExactRegion(mapData, def.newOffset);
  const reasons = [];
  if (!sourceRegion) reasons.push(`No exact source region exists at ${hex(def.sourceOffset)}.`);
  if (sourceRegion && sourceRegion.size !== def.originalSize && sourceRegion.size !== def.keepSize) {
    reasons.push(`Unexpected source region size ${sourceRegion.size} at ${hex(def.sourceOffset)}; expected ${def.originalSize} before split or ${def.keepSize} after split.`);
  }
  if (sourceRegion && sourceRegion.size === def.originalSize && newRegion) {
    reasons.push(`A region already exists at ${hex(def.newOffset)}, so automatic split would overlap existing metadata.`);
  }
  return reasons;
}

function buildCatalog(mapData) {
  const splits = SPLITS.map(def => {
    const sourceRegion = findExactRegion(mapData, def.sourceOffset);
    const newRegion = findExactRegion(mapData, def.newOffset);
    const alreadySplit = splitAlreadyApplied(mapData, def);
    const canSplit = splitCanApply(mapData, def);
    return {
      id: `${def.keepRole}_${def.sourceOffset.toString(16).toUpperCase()}`,
      sourceOffset: hex(def.sourceOffset),
      originalSize: def.originalSize,
      keepRange: { start: hex(def.sourceOffset), size: def.keepSize, type: def.keepType, role: def.keepRole },
      newRange: { start: hex(def.newOffset), size: def.newSize, type: def.newType, role: def.newRole },
      sourceRegion: regionRef(sourceRegion),
      newRegion: regionRef(newRegion),
      canSplit,
      alreadySplit,
      blockedReasons: splitBlockedReasons(mapData, def),
    };
  });
  const retypes = RETYPES.map(def => {
    const region = findExactRegion(mapData, def.offset);
    return {
      id: `${def.role}_${def.offset.toString(16).toUpperCase()}`,
      offset: hex(def.offset),
      inferredType: def.inferredType,
      confidence: 'high',
      role: def.role,
      summary: def.summary,
      region: regionRef(region),
    };
  });
  const blockedSplits = splits.filter(split => split.blockedReasons.length && !split.alreadySplit);
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-entity-object-record-audit.mjs',
    objectRecordStream: {
      start: hex(0x07B43),
      endExclusive: hex(0x07C06),
      size: 0x00C3,
      segments: [
        { start: hex(0x07B43), size: 0x0049, regionRole: 'entity_object_record_stream_prefix' },
        { start: hex(0x07B8C), size: 0x0018, regionRole: 'entity_object_record_stream_middle' },
        { start: hex(0x07BA4), size: 0x0062, regionRole: 'entity_object_record_stream_continuation' },
      ],
    },
    helperRoutine: {
      start: hex(0x07C06),
      endExclusive: hex(0x07C65),
      localSegments: [
        { start: hex(0x07C06), size: 0x0046, regionRole: 'entity_object_record_loader_helper' },
        { start: hex(0x07C4C), size: 0x0018, regionRole: 'entity_behavior_code_tail_before_7C65' },
        { start: hex(0x07C64), size: 0x0001, regionRole: 'entity_behavior_code_return_tail' },
      ],
    },
    splits,
    retypes,
    evidence: [
      'The target-backed entity behavior code region at 0x7AE4 contains the 0x7AFD behavior dispatch target and ends in a local return before the record stream at 0x7B43.',
      'The record stream spans 0x7B43-0x7C05 and is followed by a callable helper at 0x7C06; the helper continues through the existing 0x7C4C and 0x7C64 code-tail regions.',
      '_LABEL_7C65_ consumes a pointer from IX+48/IX+49, reads fixed record fields with RST $10, and copies them into IX object slots including +15, +53/+54, +8/+9, +10/+11, +30/+31, +52/+33, and +55.',
      '_LABEL_2EDF_ and _LABEL_2EFB_ pass 0x7B8C/0x7BA4-like values as VDP destination addresses to _LABEL_3655_/_LABEL_3083_; those are not ROM source reads and explain the false screen_prog labels.',
    ],
    summary: {
      splitCount: splits.length,
      retypeCount: retypes.length,
      canSplitCount: splits.filter(split => split.canSplit).length,
      alreadySplitCount: splits.filter(split => split.alreadySplit).length,
      blockedSplitCount: blockedSplits.length,
      missingRetypeRegions: retypes.filter(item => !item.region).length,
      assetPolicy: 'Metadata only: offsets, region boundaries, labels, roles, and evidence. No ROM bytes or decoded copyrighted assets are embedded.',
    },
  };
}

function annotateRegion(region, audit) {
  region.analysis = region.analysis || {};
  region.analysis.entityObjectRecordAudit = audit;
}

function annotateKeptRegion(region, def, previousType, previousSize) {
  region.size = def.keepSize;
  region.type = def.keepType;
  annotateRegion(region, {
    kind: def.keepRole,
    summary: def.keepType === 'code'
      ? 'Behavior-code prefix split away from the following entity object record stream.'
      : 'Entity object record stream prefix split away from the following helper routine.',
    confidence: 'high',
    typeBeforeAudit: previousType,
    typeAfterAudit: region.type,
    sizeBeforeAudit: previousSize,
    sizeAfterAudit: region.size,
    changedType: previousType !== region.type,
    changedSize: previousSize !== region.size,
    catalogId,
    detail: {
      originalRange: { start: hex(def.sourceOffset), size: def.originalSize },
      keptRange: { start: hex(def.sourceOffset), size: def.keepSize },
      splitRange: { start: hex(def.newOffset), size: def.newSize },
    },
    evidence: catalogEvidence(),
    generatedAt: now,
    tool: 'tools/world-entity-object-record-audit.mjs',
  });
}

function buildSplitRegion(mapData, def) {
  return {
    id: nextRegionId(mapData),
    offset: hex(def.newOffset),
    size: def.newSize,
    type: def.newType,
    name: def.newName,
    source: 'analysis',
    splitFromOffset: hex(def.sourceOffset),
    analysis: {
      entityObjectRecordAudit: {
        kind: def.newRole,
        summary: def.newType === 'code'
          ? 'Callable helper split from a mixed entity object record/code region.'
          : 'Entity object record stream split from a mixed entity behavior code/data region.',
        confidence: 'high',
        typeBeforeAudit: 'split_from_mixed_region',
        typeAfterAudit: def.newType,
        sizeBeforeAudit: 0,
        sizeAfterAudit: def.newSize,
        changedType: true,
        changedSize: true,
        catalogId,
        detail: {
          originalRange: { start: hex(def.sourceOffset), size: def.originalSize },
          splitRange: { start: hex(def.newOffset), size: def.newSize },
        },
        evidence: catalogEvidence(),
        generatedAt: now,
        tool: 'tools/world-entity-object-record-audit.mjs',
      },
    },
  };
}

function catalogEvidence() {
  return [
    'The split is bounded by local control flow: target-backed behavior code before 0x7B43, fixed-width object record data from 0x7B43-0x7C05, and a callable helper at 0x7C06.',
    '_LABEL_7C65_ reads a pointer from IX+48/IX+49 and consumes record fields into IX object slots, matching the 0x7B43-0x7C05 stream role.',
    'The previous screen_prog classification came from label-collision addresses that are used as VDP destinations by menu drawing routines, not as ROM bytecode inputs.',
  ];
}

function applySplit(mapData, def) {
  const sourceRegion = findExactRegion(mapData, def.sourceOffset);
  if (!sourceRegion || !splitCanApply(mapData, def)) return [];
  const previousType = sourceRegion.type || 'unknown';
  const previousSize = sourceRegion.size || 0;
  annotateKeptRegion(sourceRegion, def, previousType, previousSize);
  const newRegion = buildSplitRegion(mapData, def);
  const index = mapData.regions.findIndex(region => region.id === sourceRegion.id);
  mapData.regions.splice(index + 1, 0, newRegion);
  return [sourceRegion, newRegion];
}

function shouldRetype(region, inferredType) {
  if (!region) return false;
  const type = region.type || 'unknown';
  if (type === inferredType) return false;
  return ['screen_prog', 'unknown', 'raw_byte', 'data_table'].includes(type);
}

function annotateRetype(region, def) {
  const previousType = region.type || 'unknown';
  const changedType = shouldRetype(region, def.inferredType);
  if (changedType) region.type = def.inferredType;
  annotateRegion(region, {
    kind: def.role,
    summary: def.summary,
    confidence: 'high',
    typeBeforeAudit: previousType,
    typeAfterAudit: region.type,
    changedType,
    catalogId,
    evidence: catalogEvidence(),
    generatedAt: now,
    tool: 'tools/world-entity-object-record-audit.mjs',
  });
  return changedType;
}

function applyRetypes(mapData) {
  const changed = [];
  const evidenceOnly = [];
  const missing = [];
  const blocked = [];
  for (const def of RETYPES) {
    const region = findExactRegion(mapData, def.offset);
    if (!region) {
      missing.push({ offset: hex(def.offset), inferredType: def.inferredType, role: def.role });
      continue;
    }
    const willChange = shouldRetype(region, def.inferredType);
    if (!willChange && (region.type || 'unknown') !== def.inferredType) {
      blocked.push({
        id: region.id,
        offset: region.offset,
        name: region.name || '',
        currentType: region.type || 'unknown',
        inferredType: def.inferredType,
        role: def.role,
      });
      continue;
    }
    const previousType = region.type || 'unknown';
    const changedType = apply ? annotateRetype(region, def) : willChange;
    const item = {
      id: region.id,
      offset: region.offset,
      name: region.name || '',
      previousType,
      type: apply ? region.type || 'unknown' : previousType,
      inferredType: def.inferredType,
      role: def.role,
    };
    (changedType ? changed : evidenceOnly).push(item);
  }
  return { changed, evidenceOnly, missing, blocked };
}

function applyCatalog(mapData, initialCatalog) {
  const splitChanges = [];
  const splitEvidenceOnly = [];
  const splitBlocked = [];
  for (const split of initialCatalog.splits) {
    const def = SPLITS.find(item => hex(item.sourceOffset) === split.sourceOffset);
    if (!def) continue;
    if (split.canSplit && apply) {
      splitChanges.push(...applySplit(mapData, def).map(region => regionRef(region)));
    } else if (split.canSplit) {
      splitChanges.push({ sourceOffset: split.sourceOffset, newOffset: split.newRange.start, role: split.newRange.role });
    } else if (split.alreadySplit) {
      splitEvidenceOnly.push({ sourceOffset: split.sourceOffset, newOffset: split.newRange.start, role: split.newRange.role });
    } else {
      splitBlocked.push({ sourceOffset: split.sourceOffset, blockedReasons: split.blockedReasons });
    }
  }
  const retypeChanges = applyRetypes(mapData);
  return { splitChanges, splitEvidenceOnly, splitBlocked, retypeChanges };
}

function changedRegionRefs(mapData) {
  return (mapData.regions || [])
    .filter(region => region.analysis?.entityObjectRecordAudit?.catalogId === catalogId)
    .map(region => ({
      id: region.id,
      offset: region.offset,
      name: region.name || '',
      type: region.type || 'unknown',
      size: region.size || 0,
      kind: region.analysis.entityObjectRecordAudit.kind,
      confidence: region.analysis.entityObjectRecordAudit.confidence,
    }));
}

function main() {
  const mapData = readJson(mapPath);
  const initialCatalog = buildCatalog(mapData);
  const changes = applyCatalog(mapData, initialCatalog);

  if (apply) {
    const finalCatalog = buildCatalog(mapData);
    mapData.entityObjectRecordCatalogs = (mapData.entityObjectRecordCatalogs || []).filter(c => c.id !== catalogId);
    mapData.entityObjectRecordCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(r => r.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'entity_object_record_audit',
      generatedAt: now,
      tool: 'tools/world-entity-object-record-audit.mjs --apply',
      schemaVersion: 1,
      summary: {
        ...finalCatalog.summary,
        changedRegions: changedRegionRefs(mapData).length,
        splitChangesThisRun: changes.splitChanges.length,
        retypeChangesThisRun: changes.retypeChanges.changed.length,
        splitEvidenceOnly: changes.splitEvidenceOnly.length,
        retypeEvidenceOnly: changes.retypeChanges.evidenceOnly.length,
        blockedSplits: changes.splitBlocked.length,
        blockedRetypes: changes.retypeChanges.blocked.length,
      },
      changedRegions: changedRegionRefs(mapData),
      splitChangesThisRun: changes.splitChanges,
      retypeChangesThisRun: changes.retypeChanges.changed,
      splitEvidenceOnly: changes.splitEvidenceOnly,
      retypeEvidenceOnly: changes.retypeChanges.evidenceOnly,
      blockedSplits: changes.splitBlocked,
      blockedRetypes: changes.retypeChanges.blocked,
      missingRetypeRegions: changes.retypeChanges.missing,
      evidence: finalCatalog.evidence,
      nextLeads: [
        'Promote the 0x7B43-0x7C05 record stream into a browser parser that lists record stride and field meanings without storing bytes.',
        'Trace which setup routines place 0x7B43-0x7C05 pointers into IX+48/IX+49 before _LABEL_7C65_ consumes them.',
        'Continue removing medium-confidence screen_prog false positives whose only evidence is a VDP destination address collision.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: initialCatalog.summary,
    splitChanges: changes.splitChanges,
    retypeChanges: changes.retypeChanges.changed,
    splitEvidenceOnly: changes.splitEvidenceOnly,
    retypeEvidenceOnly: changes.retypeChanges.evidenceOnly,
    blockedSplits: changes.splitBlocked,
    blockedRetypes: changes.retypeChanges.blocked,
    missingRetypeRegions: changes.retypeChanges.missing,
  }, null, 2));
}

main();
