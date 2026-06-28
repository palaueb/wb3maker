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
const catalogId = 'world-bank0-lookup-data-catalog-2026-06-24';
const reportId = 'bank0-lookup-data-audit-2026-06-24';

const LOOKUP_TABLES = [
  {
    offset: 0x0B4F,
    role: 'tile_decode_bitplane_lookup',
    confidence: 'high',
    summary: '_LABEL_A97_ tile decode path indexes this 16-byte-per-row lookup with _RAM_D0EC_ while expanding source tile data to VDP writes.',
    evidence: [
      'ASM lines 2453-2468: _LABEL_A97_ runs a tile decode/write loop.',
      'ASM lines 2503-2517: the inner decode helper loads DE with _DATA_B4F_.',
      'ASM lines 2517-2525: _RAM_D0EC_ is multiplied by 16 and added to _DATA_B4F_ before reading lookup bytes.',
    ],
  },
  {
    offset: 0x0CFF,
    role: 'random_state_seed_table',
    confidence: 'high',
    summary: '_LABEL_CE3_ copies this 55-byte table into _RAM_D0A5_; _LABEL_D36_ then mutates that RAM table as a pseudo-random source.',
    evidence: [
      'ASM lines 2777-2788: _LABEL_CE3_ copies _DATA_CFF_ to _RAM_D0A5_ with BC=0x0037.',
      'ASM lines 2801-2837: _LABEL_D36_ indexes and mutates _RAM_D0A5_.',
      'Multiple routines call _LABEL_D36_ for random-like values after _DATA_CFF_ has seeded the RAM table.',
    ],
  },
  {
    offset: 0x3B6D,
    role: 'password_character_remap_table',
    confidence: 'high',
    summary: '_LABEL_3B58_ remaps password/input character codes through this table.',
    evidence: [
      'ASM lines 9232-9245: _LABEL_3B58_ normalizes a character code, indexes _DATA_3B6D_, and returns the mapped value.',
      'ASM lines 10185 and 10207 call _LABEL_3B58_ before indexing the password alphabet table.',
    ],
  },
  {
    offset: 0x3BC1,
    role: 'password_alphabet_lookup_table',
    confidence: 'high',
    summary: 'Password encode/decode routines use this table as the selectable password alphabet.',
    evidence: [
      'ASM lines 9280-9286: decoded five-bit values index _DATA_3BC1_ and write the selected character to RAM.',
      'ASM lines 10188-10190 and 10210-10212 index _DATA_3BC1_ after password cursor adjustments.',
    ],
  },
  {
    offset: 0x3E58,
    role: 'password_field_width_table',
    confidence: 'high',
    summary: 'Password read/write routines use this five-byte table as field widths or bit counts.',
    evidence: [
      'ASM lines 9388-9403: password decode conditionally copies entries from _DATA_3E58_ to _RAM_CF3E_.',
      'ASM lines 9525-9537: password encode compares field values against _DATA_3E58_.',
    ],
  },
  {
    offset: 0x3E89,
    role: 'password_scramble_mask_table',
    confidence: 'high',
    summary: '_LABEL_3E5D_ selects one of four 9-byte masks and XORs it into the password work buffer.',
    evidence: [
      'ASM lines 9696-9715: _LABEL_3E5D_ computes an index and adds it to _DATA_3E89_.',
      'ASM lines 9717-9725: nine bytes from the selected _DATA_3E89_ record are XORed into _RAM_D145_.',
    ],
  },
  {
    offset: 0x3FC6,
    role: 'password_vdp_position_table',
    confidence: 'high',
    summary: 'Password display routines use this table as VDP destination pairs for editable password characters.',
    evidence: [
      'ASM lines 9856-9865: _LABEL_3F5F_ loads VDP address bytes from _DATA_3FC6_.',
      'ASM lines 10242-10255: cursor/display updates index _DATA_3FC6_ by password character position.',
    ],
  },
  {
    offset: 0x3FE2,
    role: 'password_vdp_position_table',
    confidence: 'high',
    summary: '_LABEL_3BE1_ streams password characters to VDP using address pairs from this table.',
    evidence: [
      'ASM lines 9298-9305: _LABEL_3BE1_ loads DE with _DATA_3FE2_ and reads VDP address bytes from it.',
      'ASM lines 9306-9310: the read address bytes are written to the VDP address port before character output.',
    ],
  },
];

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

function buildCatalog(mapData) {
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-bank0-lookup-data-audit.mjs',
    summary: {
      lookupTables: LOOKUP_TABLES.length,
      assetPolicy: 'Metadata only: offsets, labels, routine references, roles, and confidence. No ROM bytes, decoded text, graphics, or password strings are embedded.',
    },
    entries: LOOKUP_TABLES.map(item => ({
      offset: hex(item.offset),
      inferredType: 'data_table',
      role: item.role,
      confidence: item.confidence,
      summary: item.summary,
      evidence: item.evidence,
      region: regionRef(findExactRegion(mapData, item.offset)),
    })),
  };
}

function shouldRetype(region, inferredType) {
  if (!region) return false;
  const current = region.type || 'unknown';
  if (current === inferredType) return false;
  return inferredType === 'data_table' && ['screen_prog', 'unknown', 'raw_byte', 'text'].includes(current);
}

function annotateRegion(region, item) {
  const typeBefore = region.type || 'unknown';
  const changedType = shouldRetype(region, item.inferredType);
  if (changedType) region.type = item.inferredType;
  region.analysis = region.analysis || {};
  region.analysis.bank0LookupDataAudit = {
    catalogId,
    kind: item.role,
    confidence: item.confidence,
    typeBeforeAudit: typeBefore,
    typeAfterAudit: region.type || typeBefore,
    changedType,
    summary: item.summary,
    evidence: item.evidence,
    generatedAt: now,
    tool: 'tools/world-bank0-lookup-data-audit.mjs',
  };
  return {
    id: region.id,
    offset: region.offset,
    size: region.size || 0,
    typeBefore,
    typeAfter: region.type || typeBefore,
    changedType,
    kind: item.role,
  };
}

function applyAnnotations(mapData, catalog) {
  const changed = [];
  const evidenceOnly = [];
  const missing = [];
  for (const item of catalog.entries) {
    const region = findExactRegion(mapData, parseInt(item.offset, 16));
    if (!region) {
      missing.push({ offset: item.offset, inferredType: item.inferredType, role: item.role });
      continue;
    }
    const result = annotateRegion(region, item);
    if (result.changedType) changed.push(result);
    else evidenceOnly.push(result);
  }
  return { changed, evidenceOnly, missing };
}

function changedRegionRefs(mapData) {
  return (mapData.regions || [])
    .filter(region => region.analysis?.bank0LookupDataAudit?.catalogId === catalogId)
    .map(region => ({
      id: region.id,
      offset: region.offset,
      size: region.size || 0,
      type: region.type || 'unknown',
      name: region.name || '',
      kind: region.analysis.bank0LookupDataAudit.kind,
      confidence: region.analysis.bank0LookupDataAudit.confidence,
    }));
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const changes = applyAnnotations(mapData, catalog);

  if (apply) {
    const finalCatalog = buildCatalog(mapData);
    mapData.smallDataCatalogs = (mapData.smallDataCatalogs || []).filter(item => item.id !== catalogId);
    mapData.smallDataCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'bank0_lookup_data_audit',
      generatedAt: now,
      tool: 'tools/world-bank0-lookup-data-audit.mjs --apply',
      schemaVersion: 1,
      summary: {
        ...finalCatalog.summary,
        changedRegions: changedRegionRefs(mapData).length,
        retypeChangesThisRun: changes.changed.length,
        evidenceOnlyRegions: changes.evidenceOnly.length,
        missingRegions: changes.missing.length,
      },
      changedRegions: changedRegionRefs(mapData),
      retypeChangesThisRun: changes.changed,
      evidenceOnlyRegions: changes.evidenceOnly,
      missingRegions: changes.missing,
      nextLeads: [
        'Name the remaining bank-0 screen_prog candidates around 0x0D6B and 0x17E4 only after a direct consumer is found.',
        'Connect password lookup tables to a read-only password encoder/decoder preview that derives values from the local ROM.',
        'Document _LABEL_A97_ tile decode format so VRAM provenance can distinguish direct tile copies from lookup-expanded tile writes.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    retypeChanges: changes.changed,
    evidenceOnlyRegions: changes.evidenceOnly,
    missingRegions: changes.missing,
  }, null, 2));
}

main();
