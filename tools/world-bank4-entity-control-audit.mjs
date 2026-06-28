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
const catalogId = 'world-bank4-entity-control-catalog-2026-06-24';
const reportId = 'bank4-entity-control-audit-2026-06-24';

const POINTER_TABLES = [
  { offset: 0x13C00, count: 5, index: '_RAM_C37E_', role: 'entity_tile_pair_script_table_a' },
  { offset: 0x13C0A, count: 7, index: '_RAM_C37E_', role: 'entity_tile_pair_script_table_b' },
  { offset: 0x13E01, count: 21, index: '_RAM_D1B0_', role: 'entity_interaction_sequence_table' },
];

const SCRIPT_OFFSETS = [
  0x13C18, 0x13C1F, 0x13C26, 0x13C2D, 0x13C34, 0x13C39, 0x13C3D,
  0x13C44, 0x13C4B, 0x13C52, 0x13C59, 0x13E2B, 0x13E3C, 0x13E4A,
  0x13E53, 0x13E5D, 0x13E69, 0x13E78, 0x13E85, 0x13EAE, 0x13EB7,
  0x13EC0, 0x13EC8, 0x13ED1, 0x13EDA, 0x13EE3, 0x13EEC, 0x13EF5,
  0x13EFE, 0x13F07, 0x13F10,
];

const DATA_TABLES = [
  {
    offset: 0x13CE0,
    inferredType: 'data_table',
    role: 'entity_motion_step_lookup',
    summary: 'Byte lookup table selected by _LABEL_1EC8_/_LABEL_1F17_ after _LABEL_1F01_ computes an index.',
  },
];

const SPLITS = [
  {
    sourceOffset: 0x13C60,
    originalSize: 0x0080,
    keepSize: 0x0007,
    keepType: 'entity_anim_script',
    keepRole: 'entity_tile_pair_script_with_zero_terminator',
    newRegions: [
      { offset: 0x13C67, size: 0x0079, type: 'null', name: 'padding after entity tile pair script @ 0x13C67', role: 'zero_padding_after_entity_tile_pair_script' },
    ],
  },
  {
    sourceOffset: 0x13F13,
    originalSize: 0x00ED,
    keepSize: 0x000A,
    keepType: 'entity_anim_script',
    keepRole: 'entity_interaction_sequence_with_ff_terminator',
    newRegions: [
      { offset: 0x13F1D, size: 0x00D3, type: 'null', name: 'padding after entity interaction sequence @ 0x13F1D', role: 'zero_padding_after_entity_interaction_sequence' },
      { offset: 0x13FF0, size: 0x0010, type: 'text', name: 'bank marker text @ 0x13FF0', role: 'bank_marker_text' },
    ],
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
    offset: region.offset,
    size: region.size || 0,
    type: region.type || 'unknown',
    name: region.name || '',
  };
}

function nextRegionNumber(mapData) {
  let maxId = 0;
  for (const region of mapData.regions || []) {
    const match = /^r(\d+)$/.exec(region.id || '');
    if (match) maxId = Math.max(maxId, Number(match[1]));
  }
  return maxId + 1;
}

function formatRegionId(number) {
  return 'r' + String(number).padStart(4, '0');
}

function catalogEvidence() {
  return [
    '_LABEL_1BE0_ selects _DATA_13C00_/_DATA_13C0A_ by _RAM_C37E_ and passes the selected tile-pair script to _LABEL_99B_, not to _LABEL_604_.',
    '_LABEL_1EC8_ and _LABEL_1F17_ index _DATA_13CE0_ as a byte lookup table after _LABEL_1F01_ computes an offset.',
    '_LABEL_608F_ selects _DATA_13E01_ entries by _RAM_D1B0_ and stores the selected sequence pointer in _RAM_D1B3_.',
    'The screen_prog reachability audit marks these regions unexplained by direct _LABEL_604_ sources, _DATA_1CCC0_ targets, or decoded root continuations.',
  ];
}

function buildCatalog(mapData) {
  const pointerTables = POINTER_TABLES.map(def => ({
    offset: hex(def.offset),
    count: def.count,
    index: def.index,
    role: def.role,
    region: regionRef(findExactRegion(mapData, def.offset)),
  }));
  const scripts = SCRIPT_OFFSETS.map(offset => ({
    offset: hex(offset),
    inferredType: 'entity_anim_script',
    confidence: 'high',
    role: offset < 0x13E00 ? 'entity_tile_pair_script' : 'entity_interaction_sequence',
    region: regionRef(findExactRegion(mapData, offset)),
  }));
  const dataTables = DATA_TABLES.map(def => ({
    offset: hex(def.offset),
    inferredType: def.inferredType,
    confidence: 'high',
    role: def.role,
    summary: def.summary,
    region: regionRef(findExactRegion(mapData, def.offset)),
  }));
  const splits = SPLITS.map(def => {
    const sourceRegion = findExactRegion(mapData, def.sourceOffset);
    const splitRegions = def.newRegions.map(item => findExactRegion(mapData, item.offset));
    const alreadySplit = Boolean(
      sourceRegion &&
      sourceRegion.size === def.keepSize &&
      (sourceRegion.type || 'unknown') === def.keepType &&
      splitRegions.every((region, index) => region && region.size === def.newRegions[index].size && (region.type || 'unknown') === def.newRegions[index].type)
    );
    const canSplit = Boolean(
      sourceRegion &&
      sourceRegion.size === def.originalSize &&
      splitRegions.every(region => !region)
    );
    const blockedReasons = [];
    if (!sourceRegion) blockedReasons.push(`No exact source region exists at ${hex(def.sourceOffset)}.`);
    if (sourceRegion && sourceRegion.size !== def.originalSize && sourceRegion.size !== def.keepSize) {
      blockedReasons.push(`Unexpected source region size ${sourceRegion.size} at ${hex(def.sourceOffset)}; expected ${def.originalSize} before split or ${def.keepSize} after split.`);
    }
    if (sourceRegion && sourceRegion.size === def.originalSize && splitRegions.some(Boolean)) {
      blockedReasons.push('One or more split target regions already exist, so automatic split would overlap existing metadata.');
    }
    return {
      sourceOffset: hex(def.sourceOffset),
      originalSize: def.originalSize,
      keepRange: { start: hex(def.sourceOffset), size: def.keepSize, type: def.keepType, role: def.keepRole },
      newRanges: def.newRegions.map(item => ({ start: hex(item.offset), size: item.size, type: item.type, role: item.role })),
      sourceRegion: regionRef(sourceRegion),
      newRegions: splitRegions.map(regionRef),
      canSplit,
      alreadySplit,
      blockedReasons,
    };
  });
  const missingRegions = [
    ...scripts.filter(item => !item.region),
    ...dataTables.filter(item => !item.region),
  ];
  const blockedSplits = splits.filter(item => item.blockedReasons.length && !item.alreadySplit);
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-bank4-entity-control-audit.mjs',
    pointerTables,
    scripts,
    dataTables,
    splits,
    evidence: catalogEvidence(),
    summary: {
      pointerTables: pointerTables.length,
      scripts: scripts.length + SPLITS.length,
      regularScriptRegions: scripts.length,
      dataTables: dataTables.length,
      splitCount: splits.length,
      canSplitCount: splits.filter(item => item.canSplit).length,
      alreadySplitCount: splits.filter(item => item.alreadySplit).length,
      blockedSplitCount: blockedSplits.length,
      missingRegions: missingRegions.length,
      assetPolicy: 'Metadata only: offsets, labels, region roles, parser evidence, and split boundaries. No ROM bytes, decoded graphics, or other copyrighted assets are embedded.',
    },
  };
}

function shouldRetype(region, inferredType) {
  if (!region) return false;
  const current = region.type || 'unknown';
  if (current === inferredType) return false;
  return ['screen_prog', 'unknown', 'data_table', 'raw_byte'].includes(current);
}

function annotateRegion(region, audit) {
  region.analysis = region.analysis || {};
  region.analysis.bank4EntityControlAudit = audit;
}

function annotateRetype(region, inferredType, role, summary) {
  const previousType = region.type || 'unknown';
  const changedType = shouldRetype(region, inferredType);
  if (changedType) region.type = inferredType;
  annotateRegion(region, {
    kind: role,
    summary,
    confidence: 'high',
    typeBeforeAudit: previousType,
    typeAfterAudit: region.type,
    changedType,
    catalogId,
    evidence: catalogEvidence(),
    generatedAt: now,
    tool: 'tools/world-bank4-entity-control-audit.mjs',
  });
  return changedType;
}

function applyRetypes(mapData, catalog) {
  const changed = [];
  const evidenceOnly = [];
  const blocked = [];
  const missing = [];
  const entries = [
    ...catalog.scripts.map(item => ({
      ...item,
      summary: item.role === 'entity_tile_pair_script'
        ? 'Pointer-table target selected by _DATA_13C00_/_DATA_13C0A_ for entity tile-pair rendering.'
        : 'Pointer-table target selected by _DATA_13E01_ for entity interaction/collection sequence handling.',
    })),
    ...catalog.dataTables,
  ];
  for (const item of entries) {
    const region = item.region ? mapData.regions.find(r => r.id === item.region.id) : null;
    if (!region) {
      missing.push({ offset: item.offset, inferredType: item.inferredType, role: item.role });
      continue;
    }
    const wouldChange = shouldRetype(region, item.inferredType);
    if (!wouldChange && (region.type || 'unknown') !== item.inferredType) {
      blocked.push({
        id: region.id,
        offset: region.offset,
        currentType: region.type || 'unknown',
        inferredType: item.inferredType,
        role: item.role,
      });
      continue;
    }
    if (!apply) {
      (wouldChange ? changed : evidenceOnly).push({
        id: region.id,
        offset: region.offset,
        name: region.name || '',
        currentType: region.type || 'unknown',
        inferredType: item.inferredType,
        role: item.role,
      });
      continue;
    }
    const previousType = region.type || 'unknown';
    const changedType = annotateRetype(region, item.inferredType, item.role, item.summary);
    (changedType ? changed : evidenceOnly).push({
      id: region.id,
      offset: region.offset,
      name: region.name || '',
      previousType,
      type: region.type || 'unknown',
      inferredType: item.inferredType,
      role: item.role,
    });
  }
  return { changed, evidenceOnly, blocked, missing };
}

function annotateKeptSplitRegion(region, def) {
  const previousType = region.type || 'unknown';
  const previousSize = region.size || 0;
  region.size = def.keepSize;
  region.type = def.keepType;
  annotateRegion(region, {
    kind: def.keepRole,
    summary: 'Terminated bank-4 entity control script split from trailing padding/marker bytes.',
    confidence: 'high',
    typeBeforeAudit: previousType,
    typeAfterAudit: region.type,
    sizeBeforeAudit: previousSize,
    sizeAfterAudit: region.size,
    changedType: previousType !== region.type,
    changedSize: previousSize !== region.size,
    catalogId,
    evidence: catalogEvidence(),
    generatedAt: now,
    tool: 'tools/world-bank4-entity-control-audit.mjs',
  });
}

function buildSplitRegion(regionId, sourceOffset, def) {
  return {
    id: regionId,
    offset: hex(def.offset),
    size: def.size,
    type: def.type,
    name: def.name,
    source: 'analysis',
    splitFromOffset: hex(sourceOffset),
    analysis: {
      bank4EntityControlAudit: {
        kind: def.role,
        summary: def.type === 'null'
          ? 'Padding split from a terminated bank-4 entity control script.'
          : 'ASCII bank marker split from a mixed entity control script/padding region.',
        confidence: 'high',
        typeBeforeAudit: 'split_from_mixed_region',
        typeAfterAudit: def.type,
        sizeBeforeAudit: 0,
        sizeAfterAudit: def.size,
        changedType: true,
        changedSize: true,
        catalogId,
        evidence: catalogEvidence(),
        generatedAt: now,
        tool: 'tools/world-bank4-entity-control-audit.mjs',
      },
    },
  };
}

function applySplits(mapData, catalog) {
  const changed = [];
  const evidenceOnly = [];
  const blocked = [];
  for (const split of catalog.splits) {
    const def = SPLITS.find(item => hex(item.sourceOffset) === split.sourceOffset);
    if (!def) continue;
    if (split.canSplit && apply) {
      const sourceRegion = findExactRegion(mapData, def.sourceOffset);
      annotateKeptSplitRegion(sourceRegion, def);
      const sourceIndex = mapData.regions.findIndex(region => region.id === sourceRegion.id);
      let nextId = nextRegionNumber(mapData);
      const newRegions = def.newRegions.map(item => buildSplitRegion(formatRegionId(nextId++), def.sourceOffset, item));
      mapData.regions.splice(sourceIndex + 1, 0, ...newRegions);
      changed.push(regionRef(sourceRegion), ...newRegions.map(regionRef));
    } else if (split.canSplit) {
      changed.push({ sourceOffset: split.sourceOffset, newRanges: split.newRanges });
    } else if (split.alreadySplit) {
      evidenceOnly.push({ sourceOffset: split.sourceOffset, newRanges: split.newRanges });
    } else {
      blocked.push({ sourceOffset: split.sourceOffset, blockedReasons: split.blockedReasons });
    }
  }
  return { changed, evidenceOnly, blocked };
}

function changedRegionRefs(mapData) {
  return (mapData.regions || [])
    .filter(region => region.analysis?.bank4EntityControlAudit?.catalogId === catalogId)
    .map(region => ({
      id: region.id,
      offset: region.offset,
      size: region.size || 0,
      type: region.type || 'unknown',
      name: region.name || '',
      kind: region.analysis.bank4EntityControlAudit.kind,
      confidence: region.analysis.bank4EntityControlAudit.confidence,
    }));
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const splitChanges = applySplits(mapData, catalog);
  const retypeChanges = applyRetypes(mapData, catalog);

  if (apply) {
    const finalCatalog = buildCatalog(mapData);
    mapData.entityAnimationCatalogs = (mapData.entityAnimationCatalogs || []).filter(item => item.id !== catalogId);
    mapData.entityAnimationCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'bank4_entity_control_audit',
      generatedAt: now,
      tool: 'tools/world-bank4-entity-control-audit.mjs --apply',
      schemaVersion: 1,
      summary: {
        ...finalCatalog.summary,
        changedRegions: changedRegionRefs(mapData).length,
        splitChangesThisRun: splitChanges.changed.length,
        retypeChangesThisRun: retypeChanges.changed.length,
        evidenceOnlyRegions: splitChanges.evidenceOnly.length + retypeChanges.evidenceOnly.length,
        blockedSplits: splitChanges.blocked.length,
        blockedRetypes: retypeChanges.blocked.length,
        missingRegions: retypeChanges.missing.length,
      },
      changedRegions: changedRegionRefs(mapData),
      splitChangesThisRun: splitChanges.changed,
      retypeChangesThisRun: retypeChanges.changed,
      evidenceOnlyRegions: [...splitChanges.evidenceOnly, ...retypeChanges.evidenceOnly],
      blockedSplits: splitChanges.blocked,
      blockedRetypes: retypeChanges.blocked,
      missingRegions: retypeChanges.missing,
      evidence: finalCatalog.evidence,
      nextLeads: [
        'Implement a small parser for the 0x13C00/0x13C0A tile-pair scripts and surface their command counts in the lab panel.',
        'Trace _RAM_C37E_ and _RAM_D1B0_ producers to name the animation/interaction states that select each entry.',
        'Use the reachability audit to continue demoting screen_prog false positives only when an alternate consumer is identified.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    splitChanges: splitChanges.changed,
    retypeChanges: retypeChanges.changed,
    evidenceOnlyRegions: [...splitChanges.evidenceOnly, ...retypeChanges.evidenceOnly],
    blockedSplits: splitChanges.blocked,
    blockedRetypes: retypeChanges.blocked,
    missingRegions: retypeChanges.missing,
  }, null, 2));
}

main();
