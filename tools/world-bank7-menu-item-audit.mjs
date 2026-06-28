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
const catalogId = 'world-bank7-menu-item-catalog-2026-06-24';
const reportId = 'bank7-menu-item-audit-2026-06-24';
const paletteCatalogId = 'world-palette-script-catalog-2026-06-24';

const POINTER_TABLES = [
  {
    offset: 0x1C000,
    count: 5,
    role: 'item_record_category_pointer_table',
    index: 'high nibble of A in _LABEL_2819_',
    summary: '_LABEL_2819_ selects one of five item/equipment record groups, then selects a subrecord pointer with the low nibble.',
  },
  {
    offset: 0x1C270,
    count: 1,
    role: 'item_display_table_root',
    index: 'high nibble of A in _LABEL_3655_',
    summary: '_LABEL_3655_ uses _DATA_1C270_ as a display-table root before copying four bytes to VDP.',
  },
  {
    offset: 0x1C272,
    count: 9,
    role: 'item_name_pointer_table',
    index: '_RAM_D0E0_ / high nibble of A in _LABEL_36A6_',
    summary: '_LABEL_36A6_ indexes _DATA_1C270_ + 2, then indexes the selected subtable before drawing item/name text.',
  },
];

const ITEM_RECORD_GROUPS = [
  0x1C00A,
  0x1C08C,
  0x1C0F2,
  0x1C10E,
  0x1C1CC,
  0x1C1EF,
];

const ITEM_NAME_POINTERS = [
  0x1C284,
  0x1C32C,
  0x1C3D9,
  0x1C47C,
  0x1C4E3,
];

const ITEM_NAME_TABLES = [
  0x1C298,
  0x1C2F2,
  0x1C340,
  0x1C3ED,
  0x1C488,
  0x1C4E9,
  0x1C502,
];

const LOOKUP_TABLES = [
  {
    offset: 0x1C550,
    role: 'item_menu_nibble_lookup',
    summary: 'Code at ASM lines 9050-9085 indexes this table by player form and menu state, then unpacks two nibbles per byte into RAM.',
  },
];

const PALETTE_TAIL_SPLIT = {
  sourceOffset: 0x1CABB,
  originalSize: 0x0205,
  keepType: 'palette_script',
  keepRole: 'palette_script_record_25_prefix',
  tailType: 'data_table',
  tailRole: 'unresolved_data_after_palette_script_prefix',
};

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function offsetOf(region) {
  return parseInt(region.offset, 16);
}

function findExactRegion(mapData, offset) {
  return (mapData.regions || []).find(region => offsetOf(region) === offset) || null;
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

function auditEvidence() {
  return [
    'ASM lines 6658-6674: _LABEL_2819_ indexes _DATA_1C000_ by item/equipment nibbles and returns the selected record pointer in HL.',
    'ASM lines 6554, 6583, 6613, 7044, 8008, 8218, and 8251 call _LABEL_2819_ and consume fields from the returned item/equipment record.',
    'ASM lines 8520-8558: _LABEL_3655_ indexes _DATA_1C270_ and copies a four-byte display record to VDP.',
    'ASM lines 8581-8601: _LABEL_36A6_ indexes _DATA_1C270_ + 2, then indexes the selected subtable and renders item/name data.',
    'ASM lines 8614-8631: _LABEL_36E8_ uses _DATA_1C220_ as fixed-width form-name text data.',
    'ASM lines 9050-9085: code indexes _DATA_1C550_ and unpacks two nibbles per byte into RAM.',
    'ASM lines 3355-3419: _LABEL_10BC_ decodes _DATA_1C800_ palette-effect scripts; the palette-script catalog parses script index 25 only through 0x1CB02.',
  ];
}

function paletteScript25Range(mapData) {
  const catalog = (mapData.paletteCatalogs || []).find(item => item.id === paletteCatalogId);
  const script = catalog?.scripts?.find(item => item.index === 25);
  const parsedBytes = script?.range?.parsedBytes;
  const start = script?.range?.start ? parseInt(script.range.start, 16) : PALETTE_TAIL_SPLIT.sourceOffset;
  if (start === PALETTE_TAIL_SPLIT.sourceOffset && parsedBytes > 0) {
    return {
      start,
      endExclusive: start + parsedBytes,
      parsedBytes,
      evidence: [
        `Palette script catalog ${paletteCatalogId} parses script index 25 from ${script.range.start} through ${script.range.endInclusive}.`,
        'Only the parsed prefix is consumed by _LABEL_10BC_; remaining bytes need a separate decoder and are kept as unresolved metadata.',
      ],
    };
  }
  return {
    start: PALETTE_TAIL_SPLIT.sourceOffset,
    endExclusive: PALETTE_TAIL_SPLIT.sourceOffset + 0x48,
    parsedBytes: 0x48,
    evidence: [
      'Fallback split uses the same 72-byte prefix reported by tools/world-palette-script-audit.mjs for script index 25.',
    ],
  };
}

function buildCatalog(mapData) {
  const paletteSplitRange = paletteScript25Range(mapData);
  const tailOffset = paletteSplitRange.endExclusive;
  const tailSize = PALETTE_TAIL_SPLIT.originalSize - paletteSplitRange.parsedBytes;
  const sourceRegion = findExactRegion(mapData, PALETTE_TAIL_SPLIT.sourceOffset);
  const tailRegion = findExactRegion(mapData, tailOffset);
  const splitCanApply = Boolean(
    sourceRegion &&
    sourceRegion.size === PALETTE_TAIL_SPLIT.originalSize &&
    !tailRegion &&
    paletteSplitRange.parsedBytes > 0 &&
    tailSize > 0
  );
  const splitAlreadyApplied = Boolean(
    sourceRegion &&
    sourceRegion.size === paletteSplitRange.parsedBytes &&
    (sourceRegion.type || 'unknown') === PALETTE_TAIL_SPLIT.keepType &&
    tailRegion &&
    tailRegion.size === tailSize
  );
  const splitBlockedReasons = [];
  if (!sourceRegion) splitBlockedReasons.push(`No exact source region exists at ${hex(PALETTE_TAIL_SPLIT.sourceOffset)}.`);
  if (sourceRegion && sourceRegion.size !== PALETTE_TAIL_SPLIT.originalSize && sourceRegion.size !== paletteSplitRange.parsedBytes) {
    splitBlockedReasons.push(`Unexpected source region size ${sourceRegion.size} at ${hex(PALETTE_TAIL_SPLIT.sourceOffset)}.`);
  }
  if (sourceRegion && sourceRegion.size === PALETTE_TAIL_SPLIT.originalSize && tailRegion) {
    splitBlockedReasons.push(`Tail target ${hex(tailOffset)} already has region ${tailRegion.id}.`);
  }

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-bank7-menu-item-audit.mjs',
    summary: {
      pointerTables: POINTER_TABLES.length,
      itemRecordGroups: ITEM_RECORD_GROUPS.length,
      itemNamePointerTables: ITEM_NAME_POINTERS.length,
      itemNameTables: ITEM_NAME_TABLES.length,
      lookupTables: LOOKUP_TABLES.length,
      paletteTailSplit: splitCanApply || splitAlreadyApplied ? 'available' : 'blocked',
      assetPolicy: 'Metadata only: offsets, labels, code references, table roles, parser ranges, and confidence. No ROM bytes, decoded item strings, graphics, or palette values are embedded.',
    },
    evidence: auditEvidence(),
    pointerTables: POINTER_TABLES.map(item => ({
      ...item,
      offset: hex(item.offset),
      confidence: 'high',
      region: regionRef(findExactRegion(mapData, item.offset)),
    })),
    itemRecordGroups: ITEM_RECORD_GROUPS.map(offset => ({
      offset: hex(offset),
      inferredType: 'item_data',
      role: 'item_equipment_record_group',
      confidence: 'high',
      region: regionRef(findExactRegion(mapData, offset)),
    })),
    itemNamePointers: ITEM_NAME_POINTERS.map(offset => ({
      offset: hex(offset),
      inferredType: 'pointer_table',
      role: 'item_name_subpointer_table',
      confidence: 'high',
      region: regionRef(findExactRegion(mapData, offset)),
    })),
    itemNameTables: ITEM_NAME_TABLES.map(offset => ({
      offset: hex(offset),
      inferredType: 'item_data',
      role: 'item_name_display_data',
      confidence: 'high',
      region: regionRef(findExactRegion(mapData, offset)),
    })),
    lookupTables: LOOKUP_TABLES.map(item => ({
      ...item,
      offset: hex(item.offset),
      inferredType: 'item_data',
      confidence: 'high',
      region: regionRef(findExactRegion(mapData, item.offset)),
    })),
    paletteTailSplit: {
      sourceOffset: hex(PALETTE_TAIL_SPLIT.sourceOffset),
      originalSize: PALETTE_TAIL_SPLIT.originalSize,
      parsedPrefix: {
        start: hex(paletteSplitRange.start),
        endExclusive: hex(paletteSplitRange.endExclusive),
        endInclusive: hex(paletteSplitRange.endExclusive - 1),
        size: paletteSplitRange.parsedBytes,
        type: PALETTE_TAIL_SPLIT.keepType,
        role: PALETTE_TAIL_SPLIT.keepRole,
      },
      tail: {
        start: hex(tailOffset),
        size: tailSize,
        type: PALETTE_TAIL_SPLIT.tailType,
        role: PALETTE_TAIL_SPLIT.tailRole,
      },
      sourceRegion: regionRef(sourceRegion),
      tailRegion: regionRef(tailRegion),
      canApply: splitCanApply,
      alreadyApplied: splitAlreadyApplied,
      blockedReasons: splitBlockedReasons,
      evidence: paletteSplitRange.evidence,
    },
  };
}

function annotateRegion(region, audit) {
  region.analysis = region.analysis || {};
  region.analysis.bank7MenuItemAudit = audit;
}

function shouldRetype(region, inferredType) {
  if (!region) return false;
  const current = region.type || 'unknown';
  if (current === inferredType) return false;
  if (inferredType === 'pointer_table') return ['screen_prog', 'data_table', 'item_data', 'unknown', 'raw_byte'].includes(current);
  if (inferredType === 'item_data') return ['screen_prog', 'data_table', 'unknown', 'raw_byte'].includes(current);
  return false;
}

function annotateTypedRegion(region, inferredType, role, confidence, summary, evidence) {
  const typeBefore = region.type || 'unknown';
  const changedType = shouldRetype(region, inferredType);
  if (changedType) region.type = inferredType;
  annotateRegion(region, {
    catalogId,
    kind: role,
    confidence,
    typeBeforeAudit: typeBefore,
    typeAfterAudit: region.type || typeBefore,
    changedType,
    summary,
    evidence,
    generatedAt: now,
    tool: 'tools/world-bank7-menu-item-audit.mjs',
  });
  return {
    id: region.id,
    offset: region.offset,
    size: region.size || 0,
    typeBefore,
    typeAfter: region.type || typeBefore,
    changedType,
    kind: role,
  };
}

function applyRetypes(mapData, catalog) {
  const changed = [];
  const evidenceOnly = [];
  const missing = [];
  const entries = [
    ...catalog.pointerTables.map(item => ({
      ...item,
      inferredType: 'pointer_table',
      summary: item.summary,
      evidence: auditEvidence().filter(text => text.includes('_DATA_1C000_') || text.includes('_DATA_1C270_')),
    })),
    ...catalog.itemRecordGroups.map(item => ({
      ...item,
      summary: '_LABEL_2819_ returns pointers into this item/equipment metadata group; callers consume fields for item display, ranking, and player-form-specific values.',
      evidence: auditEvidence().filter(text => text.includes('_LABEL_2819_') || text.includes('6554') || text.includes('6583')),
    })),
    ...catalog.itemNamePointers.map(item => ({
      ...item,
      summary: '_LABEL_36A6_ uses this subpointer table to select item/name display records.',
      evidence: auditEvidence().filter(text => text.includes('_DATA_1C270_ + 2') || text.includes('_LABEL_36A6_')),
    })),
    ...catalog.itemNameTables.map(item => ({
      ...item,
      summary: '_LABEL_36A6_ renders records selected through the item/name pointer tables; mapped as item display metadata, not screen bytecode.',
      evidence: auditEvidence().filter(text => text.includes('_LABEL_36A6_') || text.includes('_LABEL_3655_')),
    })),
    ...catalog.lookupTables.map(item => ({
      ...item,
      summary: item.summary,
      evidence: auditEvidence().filter(text => text.includes('_DATA_1C550_')),
    })),
  ];
  for (const item of entries) {
    const offset = parseInt(item.offset, 16);
    const region = findExactRegion(mapData, offset);
    if (!region) {
      missing.push({ offset: item.offset, inferredType: item.inferredType, role: item.role });
      continue;
    }
    const result = annotateTypedRegion(region, item.inferredType, item.role, item.confidence || 'high', item.summary, item.evidence);
    if (result.changedType) changed.push(result);
    else evidenceOnly.push(result);
  }
  return { changed, evidenceOnly, missing };
}

function applyPaletteTailSplit(mapData, catalog) {
  const split = catalog.paletteTailSplit;
  const sourceOffset = parseInt(split.sourceOffset, 16);
  const tailOffset = parseInt(split.tail.start, 16);
  const sourceRegion = findExactRegion(mapData, sourceOffset);
  const tailRegion = findExactRegion(mapData, tailOffset);
  const changed = [];
  const evidenceOnly = [];
  const blocked = [];

  if (split.canApply && sourceRegion) {
    const typeBefore = sourceRegion.type || 'unknown';
    sourceRegion.size = split.parsedPrefix.size;
    sourceRegion.type = split.parsedPrefix.type;
    annotateRegion(sourceRegion, {
      catalogId,
      kind: split.parsedPrefix.role,
      confidence: 'high',
      typeBeforeAudit: typeBefore,
      typeAfterAudit: sourceRegion.type,
      changedType: typeBefore !== sourceRegion.type,
      summary: 'Only the parsed prefix of the old region is consumed as _LABEL_10BC_ palette-script bytecode.',
      parsedRange: split.parsedPrefix,
      evidence: split.evidence,
      generatedAt: now,
      tool: 'tools/world-bank7-menu-item-audit.mjs',
    });
    changed.push({
      id: sourceRegion.id,
      offset: sourceRegion.offset,
      size: sourceRegion.size,
      typeBefore,
      typeAfter: sourceRegion.type,
      changedType: typeBefore !== sourceRegion.type,
      kind: split.parsedPrefix.role,
    });

    let nextId = nextRegionNumber(mapData);
    const newRegion = {
      id: formatRegionId(nextId++),
      offset: split.tail.start,
      size: split.tail.size,
      type: split.tail.type,
      name: 'unresolved data after palette script @ ' + split.tail.start,
      confidence: 'low',
      notes: 'Tail after parsed _LABEL_10BC_ palette-script prefix; format not decoded yet.',
      analysis: {
        bank7MenuItemAudit: {
          catalogId,
          kind: split.tail.role,
          confidence: 'low',
          typeBeforeAudit: 'covered_by_screen_prog_region',
          typeAfterAudit: split.tail.type,
          changedType: true,
          summary: 'Remaining bytes after the parsed palette-script prefix are not consumed by the palette-script decoder and need a later decoder.',
          evidence: split.evidence,
          generatedAt: now,
          tool: 'tools/world-bank7-menu-item-audit.mjs',
        },
      },
    };
    mapData.regions.push(newRegion);
    mapData.regions.sort((a, b) => offsetOf(a) - offsetOf(b) || (a.size || 0) - (b.size || 0));
    changed.push({
      id: newRegion.id,
      offset: newRegion.offset,
      size: newRegion.size,
      typeBefore: 'covered_by_screen_prog_region',
      typeAfter: newRegion.type,
      changedType: true,
      kind: split.tail.role,
    });
  } else if (split.alreadyApplied && sourceRegion && tailRegion) {
    const sourceResult = annotateTypedRegion(
      sourceRegion,
      split.parsedPrefix.type,
      split.parsedPrefix.role,
      'high',
      'Parsed palette-script prefix from _DATA_1C800_ entry 25.',
      split.evidence
    );
    const tailResult = annotateTypedRegion(
      tailRegion,
      split.tail.type,
      split.tail.role,
      'low',
      'Unresolved tail after parsed _LABEL_10BC_ palette-script prefix.',
      split.evidence
    );
    evidenceOnly.push(sourceResult, tailResult);
  } else {
    blocked.push({
      sourceOffset: split.sourceOffset,
      blockedReasons: split.blockedReasons,
      sourceRegion: regionRef(sourceRegion),
      tailRegion: regionRef(tailRegion),
    });
  }

  return { changed, evidenceOnly, blocked };
}

function changedRegionRefs(mapData) {
  return (mapData.regions || [])
    .filter(region => region.analysis?.bank7MenuItemAudit?.catalogId === catalogId)
    .map(region => ({
      id: region.id,
      offset: region.offset,
      size: region.size || 0,
      type: region.type || 'unknown',
      name: region.name || '',
      kind: region.analysis.bank7MenuItemAudit.kind,
      confidence: region.analysis.bank7MenuItemAudit.confidence,
    }));
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const retypes = applyRetypes(mapData, catalog);
  const split = applyPaletteTailSplit(mapData, catalog);

  if (apply) {
    const finalCatalog = buildCatalog(mapData);
    mapData.itemDataCatalogs = (mapData.itemDataCatalogs || []).filter(item => item.id !== catalogId);
    mapData.itemDataCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'bank7_menu_item_audit',
      generatedAt: now,
      tool: 'tools/world-bank7-menu-item-audit.mjs --apply',
      schemaVersion: 1,
      summary: {
        ...finalCatalog.summary,
        changedRegions: changedRegionRefs(mapData).length,
        retypeChangesThisRun: retypes.changed.length,
        splitChangesThisRun: split.changed.length,
        evidenceOnlyRegions: retypes.evidenceOnly.length + split.evidenceOnly.length,
        missingRegions: retypes.missing.length,
        blockedSplits: split.blocked.length,
      },
      changedRegions: changedRegionRefs(mapData),
      retypeChangesThisRun: retypes.changed,
      splitChangesThisRun: split.changed,
      evidenceOnlyRegions: [...retypes.evidenceOnly, ...split.evidenceOnly],
      missingRegions: retypes.missing,
      blockedSplits: split.blocked,
      evidence: finalCatalog.evidence,
      nextLeads: [
        'Decode item/equipment record fields returned by _LABEL_2819_ by tracing offsets 0, 1-4, 5, and 11 through the known callers.',
        'Model _LABEL_33FB_ item/name rendering so item display records can be previewed without embedding ROM text.',
        'Identify the unresolved 0x1CB03 tail consumer before assigning a more specific type than data_table.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    retypeChanges: retypes.changed,
    splitChanges: split.changed,
    evidenceOnlyRegions: [...retypes.evidenceOnly, ...split.evidenceOnly],
    missingRegions: retypes.missing,
    blockedSplits: split.blocked,
  }, null, 2));
}

main();
