#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const asmPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).asm');
const romPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).sms');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-24T00:00:00Z';
const catalogId = 'world-screen-prog-table-catalog-2026-06-24';
const reportId = 'screen-prog-table-audit-2026-06-24';
const tableOffset = 0x1CCC0;
const tableEntries = 31;
const bank7Base = 0x1C000;

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function cleanCode(line) {
  return line.split(';')[0].trim();
}

function labelOffset(label) {
  const match = /^_LABEL_([0-9A-F]+)_$/i.exec(label || '');
  return match ? parseInt(match[1], 16) : null;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readWordLE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function z80ToBank7Rom(pointer) {
  if (pointer < 0x8000 || pointer >= 0xC000) return null;
  return bank7Base + (pointer - 0x8000);
}

function regionBounds(region) {
  const start = parseInt(region.offset, 16);
  return { start, end: start + (region.size || 0) };
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
    id: region.id,
    offset: region.offset,
    size: region.size || 0,
    type: region.type || 'unknown',
    name: region.name || '',
  };
}

function findAsmLine(asmText, needle) {
  const lines = asmText.split(/\r?\n/);
  const index = lines.findIndex(line => line.includes(needle));
  return index >= 0 ? index + 1 : null;
}

function screenProgEntryForRegion(mapData, regionId) {
  for (const catalog of mapData.screenProgCatalogs || []) {
    const entry = (catalog.entries || []).find(item => item.region?.id === regionId);
    if (entry) return entry;
  }
  return null;
}

function scanIndexWrites(asmText) {
  const lines = asmText.split(/\r?\n/);
  const writes = [];
  let currentLabel = null;
  let currentOffset = null;

  function findImmediateA(lineIndex) {
    for (let i = lineIndex - 1; i >= 0 && i >= lineIndex - 10; i--) {
      const raw = lines[i];
      if (/^_LABEL_[0-9A-F]+_:/.test(raw)) break;
      const code = cleanCode(raw);
      const imm = /\bld\s+a,\s*\$([0-9A-F]{2})/i.exec(code);
      if (imm) return { value: parseInt(imm[1], 16), line: i + 1, mode: 'ld_a_immediate' };
      if (/\bxor\s+a\b/i.test(code)) return { value: 0, line: i + 1, mode: 'xor_a' };
    }
    return null;
  }

  for (let i = 0; i < lines.length; i++) {
    const labelMatch = /^(_LABEL_[0-9A-F]+_):/.exec(lines[i]);
    if (labelMatch) {
      currentLabel = labelMatch[1];
      currentOffset = labelOffset(currentLabel);
      continue;
    }
    if (!/\bld\s+\(_RAM_CF81_\),\s*a/i.test(cleanCode(lines[i]))) continue;
    const immediate = findImmediateA(i);
    writes.push({
      line: i + 1,
      callerLabel: currentLabel,
      callerOffset: currentOffset == null ? null : hex(currentOffset),
      directIndex: immediate ? immediate.value : null,
      directIndexState: immediate ? (immediate.value < tableEntries ? 'table_entry' : 'out_of_range_or_state') : 'dynamic',
      sourceLine: immediate?.line || null,
      sourceMode: immediate?.mode || 'dynamic',
      evidence: immediate
        ? `ASM line ${immediate.line} sets A=${hex(immediate.value, 2)} before storing _RAM_CF81_ at line ${i + 1}.`
        : `ASM line ${i + 1} stores _RAM_CF81_ from a dynamic A value.`,
    });
  }
  return writes;
}

function buildCatalog(mapData, asmText, romBytes) {
  const tableRegion = findContainingRegion(mapData, tableOffset);
  const tableLine = findAsmLine(asmText, '_DATA_1CCC0_:');
  const decoderLine = findAsmLine(asmText, '_LABEL_604_:');
  const entries = [];
  for (let index = 0; index < tableEntries; index++) {
    const pointerOffset = tableOffset + index * 2;
    const pointer = readWordLE(romBytes, pointerOffset);
    const targetOffset = z80ToBank7Rom(pointer);
    const targetRegion = targetOffset == null ? null : findContainingRegion(mapData, targetOffset);
    const screenEntry = targetRegion ? screenProgEntryForRegion(mapData, targetRegion.id) : null;
    entries.push({
      index,
      pointerOffset: hex(pointerOffset),
      pointer: hex(pointer, 4),
      targetOffset: targetOffset == null ? null : hex(targetOffset),
      targetRegion: regionRef(targetRegion),
      screenProgSummary: screenEntry ? {
        catalogEntryId: screenEntry.id,
        confidence: screenEntry.confidence,
        terminated: screenEntry.terminated,
        endReason: screenEntry.endReason,
        ops: screenEntry.stats?.ops || 0,
        writtenCells: screenEntry.stats?.writtenCells || 0,
        warnings: (screenEntry.warnings || []).length,
        outsideRegionBytes: screenEntry.visitedRange?.outsideRegionBytes || 0,
      } : null,
      confidence: targetRegion?.type === 'screen_prog' && screenEntry ? 'high' : 'medium',
      evidence: [
        `_DATA_1CCC0_ entry ${index} points to ${targetOffset == null ? 'an invalid bank-7 pointer' : hex(targetOffset)}.`,
        targetRegion ? `Target falls in mapped region ${targetRegion.id} (${targetRegion.type || 'unknown'}).` : 'No mapped target region found.',
      ],
    });
  }
  const indexWrites = scanIndexWrites(asmText);
  const summary = {
    tableOffset: hex(tableOffset),
    entries: tableEntries,
    validBank7Pointers: entries.filter(entry => entry.targetOffset).length,
    mappedTargetRegions: entries.filter(entry => entry.targetRegion).length,
    screenProgTargets: entries.filter(entry => entry.targetRegion?.type === 'screen_prog').length,
    targetsWithDecodeSummary: entries.filter(entry => entry.screenProgSummary).length,
    directIndexWrites: indexWrites.filter(write => write.directIndexState === 'table_entry').length,
    dynamicIndexWrites: indexWrites.filter(write => write.directIndexState === 'dynamic').length,
    assetPolicy: 'Metadata only: pointer offsets, target offsets, region ids, screen_prog counts, and ASM evidence. No screen bytes, tile ids, or rendered text are embedded.',
  };
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-screen-prog-table-audit.mjs',
    summary,
    table: {
      label: '_DATA_1CCC0_',
      offset: hex(tableOffset),
      entries: tableEntries,
      indexRam: '_RAM_CF81_',
      decoder: '_LABEL_604_',
      region: regionRef(tableRegion),
      evidence: [
        tableLine ? `ASM line ${tableLine}: _DATA_1CCC0_ is a 31-entry pointer table indexed by _RAM_CF81_.` : '_DATA_1CCC0_ is a 31-entry pointer table indexed by _RAM_CF81_.',
        decoderLine ? `ASM line ${decoderLine}: _LABEL_604_ decodes the selected screen/name-table bytecode.` : '_LABEL_604_ decodes the selected screen/name-table bytecode.',
        'Catalog references screenProgCatalog decode summaries and stores metadata only.',
      ],
    },
    entries,
    indexWrites,
  };
}

function annotateMap(mapData, catalog) {
  const annotated = [];
  const tableRegion = catalog.table.region && mapData.regions.find(region => region.id === catalog.table.region.id);
  if (tableRegion) {
    const typeBefore = tableRegion.type || 'unknown';
    tableRegion.type = 'screen_prog_table';
    tableRegion.analysis = tableRegion.analysis || {};
    tableRegion.analysis.screenProgTableAudit = {
      catalogId,
      kind: 'screen_prog_pointer_table',
      confidence: 'high',
      typeBeforeAudit: typeBefore,
      typeAfterAudit: tableRegion.type,
      changedType: typeBefore !== tableRegion.type,
      summary: '_DATA_1CCC0_ is a 31-entry screen-program pointer table consumed through _RAM_CF81_ and _LABEL_604_.',
      table: catalog.table,
      evidence: catalog.table.evidence,
      generatedAt: now,
      tool: 'tools/world-screen-prog-table-audit.mjs',
    };
    annotated.push({ id: tableRegion.id, offset: tableRegion.offset, typeBefore, typeAfter: tableRegion.type, kind: 'screen_prog_pointer_table' });
  }

  const entriesByRegion = new Map();
  for (const entry of catalog.entries) {
    if (!entry.targetRegion) continue;
    const list = entriesByRegion.get(entry.targetRegion.id) || [];
    list.push(entry);
    entriesByRegion.set(entry.targetRegion.id, list);
  }
  for (const [regionId, entries] of entriesByRegion) {
    const region = mapData.regions.find(item => item.id === regionId);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.screenProgTableAudit = {
      catalogId,
      kind: 'screen_prog_table_target',
      confidence: entries.every(entry => entry.confidence === 'high') ? 'high' : 'medium',
      tableLabel: '_DATA_1CCC0_',
      entryIndices: entries.map(entry => entry.index),
      screenProgSummaries: entries.map(entry => entry.screenProgSummary).filter(Boolean),
      summary: `Target of _DATA_1CCC0_ screen-program table entr${entries.length === 1 ? 'y' : 'ies'} ${entries.map(entry => entry.index).join(', ')}.`,
      evidence: entries.flatMap(entry => entry.evidence),
      generatedAt: now,
      tool: 'tools/world-screen-prog-table-audit.mjs',
    };
    annotated.push({ id: region.id, offset: region.offset, type: region.type, kind: 'screen_prog_table_target', entryIndices: entries.map(entry => entry.index) });
  }
  return annotated;
}

function main() {
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const romBytes = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData, asmText, romBytes);
  const annotatedRegions = apply ? annotateMap(mapData, catalog) : [
    ...(catalog.table.region ? [{ id: catalog.table.region.id, offset: catalog.table.region.offset, typeBefore: catalog.table.region.type, typeAfter: 'screen_prog_table', kind: 'screen_prog_pointer_table' }] : []),
    ...catalog.entries
      .filter(entry => entry.targetRegion)
      .map(entry => ({ id: entry.targetRegion.id, offset: entry.targetRegion.offset, type: entry.targetRegion.type, kind: 'screen_prog_table_target', entryIndex: entry.index })),
  ];

  if (apply) {
    mapData.screenProgCatalogs = (mapData.screenProgCatalogs || []).filter(catalogItem => catalogItem.id !== catalogId);
    mapData.screenProgCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'screen_prog_table_audit',
      generatedAt: now,
      tool: 'tools/world-screen-prog-table-audit.mjs --apply',
      schemaVersion: 1,
      summary: catalog.summary,
      table: catalog.table,
      annotatedRegions,
      nextLeads: [
        'Map _RAM_CF81_ producers to game states so each screen-program table entry has a named context.',
        'Split compound screen-program records around embedded pointer tables only after subregion metadata is supported.',
        'Use this table catalog to drive reproducible previews for title, intro, ending, pause, and continue screens.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    table: catalog.table,
    invalidEntries: catalog.entries.filter(entry => !entry.targetOffset || !entry.targetRegion),
    annotatedRegions,
  }, null, 2));
}

main();
