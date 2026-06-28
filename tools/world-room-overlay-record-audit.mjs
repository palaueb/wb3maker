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
const catalogId = 'world-room-overlay-record-catalog-2026-06-25';
const reportId = 'room-overlay-record-audit-2026-06-25';

const sourceOffset = 0x10000;
const originalEndExclusive = 0x1071A;
const alignedEndExclusive = 0x10718;
const tailOffset = 0x10718;
const recordStride = 8;
const recordCount = (alignedEndExclusive - sourceOffset) / recordStride;

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function offsetOf(region) {
  return parseInt(region.offset, 16);
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

function findExactRegion(mapData, offset) {
  return (mapData.regions || []).find(region => offsetOf(region) === offset) || null;
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

function findRam(mapData, address) {
  return (mapData.ram || []).find(entry => (entry.address || '').toUpperCase() === address.toUpperCase()) || null;
}

function recordSamples() {
  return [0, 1, 2, 3, recordCount - 4, recordCount - 3, recordCount - 2, recordCount - 1]
    .filter((index, pos, arr) => index >= 0 && index < recordCount && arr.indexOf(index) === pos)
    .map(index => ({
      index,
      offset: hex(sourceOffset + index * recordStride),
      size: recordStride,
    }));
}

function buildCatalog(mapData) {
  const sourceRegion = findExactRegion(mapData, sourceOffset);
  const tailRegion = findExactRegion(mapData, tailOffset);
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-room-overlay-record-audit.mjs',
    summary: {
      sourceOffset: hex(sourceOffset),
      originalEndExclusive: hex(originalEndExclusive),
      alignedEndExclusive: hex(alignedEndExclusive),
      recordStride,
      recordCount,
      alignedRecordBytes: alignedEndExclusive - sourceOffset,
      unresolvedTailBytes: originalEndExclusive - alignedEndExclusive,
      recordTableType: 'tile_map',
      assetPolicy: 'Metadata only: offsets, record counts, stride, VDP write shape, RAM roles, and evidence. No ROM bytes or decoded tile values are embedded.',
    },
    table: {
      region: regionRef(sourceRegion),
      offset: hex(sourceOffset),
      endInclusive: hex(alignedEndExclusive - 1),
      recordStride,
      recordCount,
      recordSamples: recordSamples(),
      recordLayout: [
        { field: 'ix+0', role: 'top_row_vdp_write_0' },
        { field: 'ix+1', role: 'top_row_vdp_write_1' },
        { field: 'ix+2', role: 'next_row_vdp_write_0' },
        { field: 'ix+3', role: 'next_row_vdp_write_1' },
        { field: 'ix+4', role: 'top_row_vdp_write_2' },
        { field: 'ix+5', role: 'top_row_vdp_write_3' },
        { field: 'ix+6', role: 'next_row_vdp_write_2' },
        { field: 'ix+7', role: 'next_row_vdp_write_3' },
      ],
      vdpWriteShape: {
        rows: 2,
        writesPerRow: 4,
        rowStrideVramBytes: 0x40,
        sourceFieldOrder: ['ix+0', 'ix+1', 'ix+4', 'ix+5', 'ix+2', 'ix+3', 'ix+6', 'ix+7'],
      },
    },
    tail: {
      region: regionRef(tailRegion),
      offset: hex(tailOffset),
      endInclusive: hex(originalEndExclusive - 1),
      size: originalEndExclusive - alignedEndExclusive,
      confidence: 'low',
      role: 'unresolved_tail_before_c34e_pointer_table',
    },
    ramRoles: [
      {
        address: '$CF64',
        role: 'room_overlay_tile_record_index',
        confidence: 'high',
        summary: '_RAM_CF64_ is multiplied by 8 and added to _DATA_10000_ to select one overlay tile record.',
      },
      {
        address: '$D0DE',
        role: 'room_overlay_tile_record_pointer_low',
        confidence: 'high',
        summary: 'Low byte of scratch pointer written by ld (_RAM_D0DE_), hl after table indexing.',
      },
      {
        address: '$D0DF',
        role: 'room_overlay_tile_record_pointer_high',
        confidence: 'high',
        summary: 'High byte of scratch pointer written by ld (_RAM_D0DE_), hl after table indexing.',
      },
      {
        address: '$CF82',
        role: 'vdp_write_in_progress_flag',
        confidence: 'high',
        summary: 'Set while the selected overlay record is written through VDP data port helpers.',
      },
      {
        address: '$D21D',
        role: 'room_overlay_update_latched_flag',
        confidence: 'medium',
        summary: 'Set before the _RAM_CF64_ indexed overlay update path; exact lifetime needs broader trace.',
      },
    ],
    evidence: [
      'ASM lines 3542-3551: _RAM_CF64_ is multiplied by 8 and added to _DATA_10000_.',
      'ASM lines 3565-3570: bank 6 is selected and IX is loaded from the computed _DATA_10000_ record pointer.',
      'ASM lines 3574-3608: the routine writes IX+0, IX+1, IX+4, IX+5 to the current VDP address, then IX+2, IX+3, IX+6, IX+7 to VDP address + 0x40.',
      'The source region length 1818 bytes contains 1816 aligned bytes, exactly 227 complete 8-byte records, plus two unresolved bytes before the _DATA_1071A_ pointer table.',
    ],
  };
}

function annotateRam(mapData, catalog) {
  const changed = [];
  for (const role of catalog.ramRoles) {
    const entry = findRam(mapData, role.address);
    if (!entry) continue;
    const before = {
      address: entry.address,
      size: entry.size || 0,
      type: entry.type || '',
      name: entry.name || '',
      notes: entry.notes || '',
    };
    if (role.address === '$CF64' && (!entry.name || entry.name === 'CF64')) entry.name = 'ROOM OVERLAY TILE RECORD INDEX';
    if (role.address === '$D0DE' && (!entry.name || entry.name === 'D0DE')) entry.name = 'ROOM OVERLAY RECORD POINTER LO';
    if (role.address === '$D0DF' && (!entry.name || entry.name === 'D0DF')) entry.name = 'ROOM OVERLAY RECORD POINTER HI';
    if (role.address === '$D21D' && (!entry.name || entry.name === 'D21D')) entry.name = 'ROOM OVERLAY UPDATE FLAG';
    entry.analysis = entry.analysis || {};
    entry.analysis.roomOverlayRecordAudit = {
      catalogId,
      kind: role.role,
      confidence: role.confidence,
      summary: role.summary,
      evidence: catalog.evidence.slice(0, 3),
      generatedAt: now,
      tool: 'tools/world-room-overlay-record-audit.mjs',
    };
    changed.push({
      before,
      after: {
        address: entry.address,
        size: entry.size || 0,
        type: entry.type || '',
        name: entry.name || '',
        notes: entry.notes || '',
      },
      role: role.role,
      confidence: role.confidence,
    });
  }
  return changed;
}

function annotateRegions(mapData, catalog) {
  const changed = [];
  let nextId = nextRegionNumber(mapData);
  const sourceRegion = findExactRegion(mapData, sourceOffset);
  if (!sourceRegion) {
    return { changed, missing: [{ offset: hex(sourceOffset), reason: 'source region missing' }] };
  }

  const before = {
    id: sourceRegion.id,
    offset: sourceRegion.offset,
    size: sourceRegion.size || 0,
    type: sourceRegion.type || 'unknown',
    name: sourceRegion.name || '',
  };

  if ((sourceRegion.size || 0) === originalEndExclusive - sourceOffset) {
    sourceRegion.size = alignedEndExclusive - sourceOffset;
  }
  sourceRegion.type = 'tile_map';
  sourceRegion.name = 'room overlay tile record table';
  sourceRegion.confidence = 'high';
  sourceRegion.notes = '227 aligned 8-byte records selected by _RAM_CF64_ and written as two 4-byte VDP rows; raw tile values remain ROM-local.';
  sourceRegion.analysis = sourceRegion.analysis || {};
  sourceRegion.analysis.roomOverlayRecordAudit = {
    catalogId,
    kind: 'room_overlay_tile_record_table',
    confidence: 'high',
    typeBeforeAudit: before.type,
    typeAfterAudit: sourceRegion.type,
    sizeBeforeAudit: before.size,
    sizeAfterAudit: sourceRegion.size || 0,
    changedType: before.type !== sourceRegion.type,
    changedSize: before.size !== (sourceRegion.size || 0),
    recordStride,
    recordCount,
    vdpWriteShape: catalog.table.vdpWriteShape,
    summary: 'Aligned 8-byte tile overlay records selected by _RAM_CF64_ and written to two VDP rows.',
    evidence: catalog.evidence,
    generatedAt: now,
    tool: 'tools/world-room-overlay-record-audit.mjs',
  };
  changed.push({ before, after: regionRef(sourceRegion) });

  const tailSize = originalEndExclusive - alignedEndExclusive;
  let tailRegion = findExactRegion(mapData, tailOffset);
  if (!tailRegion) {
    tailRegion = {
      id: formatRegionId(nextId++),
      offset: hex(tailOffset),
      size: tailSize,
      type: 'data_table',
      name: 'unresolved tail after room overlay tile records',
      confidence: 'low',
      notes: 'Two bytes between the aligned room overlay record table and the _DATA_1071A_ pointer table; consumer not identified yet.',
    };
    mapData.regions.push(tailRegion);
  }
  const tailBefore = {
    id: tailRegion.id,
    offset: tailRegion.offset,
    size: tailRegion.size || 0,
    type: tailRegion.type || 'unknown',
    name: tailRegion.name || '',
  };
  tailRegion.size = tailSize;
  tailRegion.type = 'data_table';
  tailRegion.name = 'unresolved tail after room overlay tile records';
  tailRegion.confidence = 'low';
  tailRegion.notes = 'Two bytes between the aligned room overlay record table and the _DATA_1071A_ pointer table; consumer not identified yet.';
  tailRegion.analysis = tailRegion.analysis || {};
  tailRegion.analysis.roomOverlayRecordAudit = {
    catalogId,
    kind: 'unresolved_tail_after_room_overlay_records',
    confidence: 'low',
    typeBeforeAudit: tailBefore.type,
    typeAfterAudit: tailRegion.type,
    sizeBeforeAudit: tailBefore.size,
    sizeAfterAudit: tailRegion.size || 0,
    changedType: tailBefore.type !== tailRegion.type,
    changedSize: tailBefore.size !== (tailRegion.size || 0),
    summary: 'Preserved the two-byte remainder after the aligned overlay record table as unresolved metadata.',
    evidence: [
      `The confirmed overlay record model consumes ${alignedEndExclusive - sourceOffset} byte(s), ending at ${hex(alignedEndExclusive - 1)}.`,
      `_DATA_1071A_ starts at ${hex(originalEndExclusive)}, leaving this two-byte range unclaimed by the 8-byte record model.`,
      'No direct consumer for this tail has been identified yet.',
    ],
    generatedAt: now,
    tool: 'tools/world-room-overlay-record-audit.mjs',
  };
  changed.push({ before: tailBefore, after: regionRef(tailRegion) });

  mapData.regions.sort((a, b) => offsetOf(a) - offsetOf(b) || (a.size || 0) - (b.size || 0));
  return { changed, missing: [] };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const regionChanges = apply ? annotateRegions(mapData, catalog) : { changed: [], missing: [] };
  const ramChanges = apply ? annotateRam(mapData, catalog) : [];

  if (apply) {
    const finalCatalog = buildCatalog(mapData);
    mapData.roomDataCatalogs = (mapData.roomDataCatalogs || []).filter(item => item.id !== catalogId);
    mapData.roomDataCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'room_overlay_record_audit',
      generatedAt: now,
      tool: 'tools/world-room-overlay-record-audit.mjs --apply',
      schemaVersion: 1,
      summary: {
        ...finalCatalog.summary,
        changedRegions: regionChanges.changed.length,
        missingRegions: regionChanges.missing.length,
        annotatedRamEntries: ramChanges.length,
      },
      changedRegions: regionChanges.changed,
      missingRegions: regionChanges.missing,
      annotatedRamEntries: ramChanges,
      evidence: finalCatalog.evidence,
      nextLeads: [
        'Trace writes to _RAM_CF64_ to name the collision/object states that select each overlay record.',
        'Identify the consumer, if any, for the two-byte 0x10718 tail before _DATA_1071A_.',
        'Teach the analyzer to preview these overlay records from the user-loaded ROM as 2x4 tile patches without storing tile bytes in map.json.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    table: catalog.table,
    tail: catalog.tail,
    ramRoles: catalog.ramRoles,
    regionChanges,
    ramChanges,
  }, null, 2));
}

main();
