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
const catalogId = 'world-palette-table-catalog-2026-06-24';
const reportId = 'palette-table-audit-2026-06-24';
const tableStart = 0x1C5B0;
const tableEndExclusive = 0x1C800;
const recordSize = 16;
const loaderOffset = 0x08B2;

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

function regionBounds(region) {
  const start = parseInt(region.offset, 16);
  return { start, end: start + (region.size || 0) };
}

function findContainingRegion(mapData, offset) {
  return (mapData.regions || []).find(region => {
    const { start, end } = regionBounds(region);
    return offset >= start && offset < end;
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

function scanPaletteLoaderCallsites(asmText) {
  const lines = asmText.split(/\r?\n/);
  const callsites = [];
  let currentLabel = null;
  let currentOffset = null;

  function nearestPreparedPair(callLineIndex) {
    let hSource = null;
    let lSource = null;

    function sourceFromAssignment(reg, expr, line) {
      const immMatch = /^\$([0-9A-F]{2})$/i.exec(expr);
      return {
        register: reg,
        expr,
        line,
        value: immMatch ? parseInt(immMatch[1], 16) : null,
      };
    }

    function pairFromSources(mode) {
      const value = hSource?.value != null && lSource?.value != null
        ? (hSource.value << 8) | lSource.value
        : null;
      return {
        mode,
        line: Math.min(hSource?.line || lSource?.line || callLineIndex + 1, lSource?.line || hSource?.line || callLineIndex + 1),
        value,
        bgSource: lSource,
        spriteSource: hSource,
      };
    }

    for (let i = callLineIndex - 1; i >= 0 && i >= callLineIndex - 16; i--) {
      const raw = lines[i];
      if (/^_LABEL_[0-9A-F]+_:/.test(raw)) break;
      const code = cleanCode(raw);
      if (!code) continue;
      const hlMatch = /\bld\s+hl,\s*\$([0-9A-F]{4})/i.exec(code);
      if (hlMatch) {
        if (!hSource && !lSource) {
          const value = parseInt(hlMatch[1], 16);
          return {
            mode: 'ld_hl_immediate',
            line: i + 1,
            value,
            bgSource: { register: 'l', expr: `$${(value & 0xFF).toString(16).toUpperCase().padStart(2, '0')}`, line: i + 1, value: value & 0xFF },
            spriteSource: { register: 'h', expr: `$${((value >> 8) & 0xFF).toString(16).toUpperCase().padStart(2, '0')}`, line: i + 1, value: (value >> 8) & 0xFF },
          };
        }
        return pairFromSources('ld_hl_immediate_clobbered_by_later_h_or_l_assignment');
      }
      const hMatch = /\bld\s+h,\s*([^;\s]+(?:\s*[^;]*)?)$/i.exec(code);
      if (hMatch && !hSource) hSource = sourceFromAssignment('h', hMatch[1].trim(), i + 1);
      const lMatch = /\bld\s+l,\s*([^;\s]+(?:\s*[^;]*)?)$/i.exec(code);
      if (lMatch && !lSource) lSource = sourceFromAssignment('l', lMatch[1].trim(), i + 1);
      if (hSource && lSource) {
        return pairFromSources(hSource.value != null && lSource.value != null ? 'ld_h_ld_l_immediate' : 'ld_h_ld_l_dynamic');
      }
    }
    if (hSource || lSource) return pairFromSources('partial_h_l_dynamic');
    return null;
  }

  function classifyDynamicPaletteCallsite(callerLabel, preparedPair, callLine) {
    if (!preparedPair || preparedPair.value != null) return null;
    if (callerLabel === '_LABEL_26F4_') {
      return {
        kind: 'room_subrecord_bg_palette_preserve_sprite',
        bgSource: 'room subrecord flags/palette byte masked with $3F',
        spriteSource: '$FF keep-existing sentinel',
        confidence: 'high',
        evidence: [
          'ASM lines 6495-6502 reload the room subrecord flags/palette byte, mask it with $3F into L, set H=$FF, then call _LABEL_8B2_.',
          '_LABEL_8B2_ treats H=$FF as keep existing sprite palette.',
        ],
      };
    }
    if (callerLabel === '_LABEL_28E1_' || callerLabel === '_LABEL_4DBA_') {
      return {
        kind: 'cached_palette_pair_restore',
        bgSource: '_RAM_CFF1_ + 0',
        spriteSource: '_RAM_CFF1_ + 1',
        confidence: 'high',
        evidence: [
          `ASM line ${callLine} calls _LABEL_8B2_ after loading L/H from the _RAM_CFF1_ scratch structure.`,
          'ASM lines 11696-11705 save _RAM_CFF5_/_RAM_CFF6_ into _RAM_CFF1_+0/+1 before the paired restore paths.',
        ],
      };
    }
    return {
      kind: 'dynamic_hl_preparation',
      bgSource: preparedPair.bgSource?.expr || 'unknown',
      spriteSource: preparedPair.spriteSource?.expr || 'unknown',
      confidence: 'medium',
      evidence: [`ASM line ${callLine} calls _LABEL_8B2_ with non-immediate H/L sources.`],
    };
  }

  for (let i = 0; i < lines.length; i++) {
    const labelMatch = /^(_LABEL_[0-9A-F]+_):/.exec(lines[i]);
    if (labelMatch) {
      currentLabel = labelMatch[1];
      currentOffset = labelOffset(currentLabel);
      continue;
    }
    if (!/\bcall\s+_LABEL_8B2_/i.test(cleanCode(lines[i]))) continue;
    const preparedPair = nearestPreparedPair(i);
    const directIndexPair = preparedPair && preparedPair.value != null ? {
      sourceMode: preparedPair.mode,
      sourceLine: preparedPair.line,
      rawHL: hex(preparedPair.value, 4),
      bgIndex: preparedPair.value & 0xFF,
      spriteIndex: (preparedPair.value >> 8) & 0xFF,
    } : null;
    const dynamicContext = classifyDynamicPaletteCallsite(currentLabel, preparedPair, i + 1);
    callsites.push({
      line: i + 1,
      callerLabel: currentLabel,
      callerOffset: currentOffset == null ? null : hex(currentOffset),
      directIndexPair,
      preparedPair: preparedPair ? {
        sourceMode: preparedPair.mode,
        sourceLine: preparedPair.line,
        rawHL: preparedPair.value == null ? null : hex(preparedPair.value, 4),
        bgSource: preparedPair.bgSource,
        spriteSource: preparedPair.spriteSource,
      } : null,
      dynamicContext,
      confidence: directIndexPair ? 'high' : 'dynamic',
      evidence: directIndexPair
        ? [`ASM line ${preparedPair.line} loads ${directIndexPair.rawHL} before calling _LABEL_8B2_ at line ${i + 1}.`]
        : [
          `ASM line ${i + 1} calls _LABEL_8B2_ with HL prepared dynamically.`,
          ...(dynamicContext?.evidence || []),
        ],
    });
  }
  return callsites;
}

function indexState(index, recordCount) {
  if (index === 0xFF) return 'keep_existing';
  if (index >= 0 && index < recordCount) return 'table_record';
  return 'out_of_range';
}

function buildCatalog(mapData, asmText, romBytes) {
  const recordCount = (tableEndExclusive - tableStart) / recordSize;
  const callsites = scanPaletteLoaderCallsites(asmText).map(callsite => {
    if (!callsite.directIndexPair) return callsite;
    return {
      ...callsite,
      directIndexPair: {
        ...callsite.directIndexPair,
        bgState: indexState(callsite.directIndexPair.bgIndex, recordCount),
        spriteState: indexState(callsite.directIndexPair.spriteIndex, recordCount),
      },
    };
  });
  const usedBg = new Map();
  const usedSprite = new Map();
  for (const callsite of callsites) {
    const pair = callsite.directIndexPair;
    if (!pair) continue;
    if (pair.bgState === 'table_record') usedBg.set(pair.bgIndex, (usedBg.get(pair.bgIndex) || 0) + 1);
    if (pair.spriteState === 'table_record') usedSprite.set(pair.spriteIndex, (usedSprite.get(pair.spriteIndex) || 0) + 1);
  }
  const records = [];
  for (let index = 0; index < recordCount; index++) {
    const offset = tableStart + index * recordSize;
    const bytes = romBytes.subarray(offset, offset + recordSize);
    const allZero = bytes.every(byte => byte === 0);
    const region = findContainingRegion(mapData, offset);
    const regionType = region?.type || 'unknown';
    records.push({
      index,
      offset: hex(offset),
      size: recordSize,
      region: regionRef(region),
      kind: allZero ? 'zero_padding_or_black_palette' : 'palette_record',
      allZero,
      usedAsBgByDirectCallsites: usedBg.get(index) || 0,
      usedAsSpriteByDirectCallsites: usedSprite.get(index) || 0,
      confidence: regionType === 'palette' || (allZero && regionType === 'null') ? 'high' : 'medium',
      evidence: [
        `_LABEL_8B2_ multiplies palette index ${index} by 16 and copies record ${index} from _DATA_1C5B0_ + ${hex(index * recordSize, 4)}.`,
        region ? `Record belongs to mapped region ${region.id} (${region.type || 'unknown'}) at ${region.offset}.` : 'No containing map region found for this record.',
      ],
    });
  }
  const loaderRegion = findContainingRegion(mapData, loaderOffset);
  const loaderLine = findAsmLine(asmText, '_LABEL_8B2_:');
  const dataLine = findAsmLine(asmText, '_DATA_1C5B0_:');
  const directCallsites = callsites.filter(callsite => callsite.directIndexPair);
  const dynamicCallsites = callsites.filter(callsite => !callsite.directIndexPair);
  const outOfRangePairs = directCallsites.filter(callsite => (
    callsite.directIndexPair.bgState === 'out_of_range' ||
    callsite.directIndexPair.spriteState === 'out_of_range'
  ));
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-palette-table-audit.mjs',
    summary: {
      tableStart: hex(tableStart),
      tableEndExclusive: hex(tableEndExclusive),
      recordSize,
      recordCount,
      paletteRegionRecords: records.filter(record => record.region?.type === 'palette').length,
      zeroFilledRecords: records.filter(record => record.allZero).length,
      directCallsites: directCallsites.length,
      dynamicCallsites: dynamicCallsites.length,
      outOfRangeDirectPairs: outOfRangePairs.length,
      assetPolicy: 'Metadata only: palette record indices, offsets, zero-padding flags, region ownership, and loader callsite constants. No palette bytes or rendered colors are embedded.',
    },
    loader: {
      label: '_LABEL_8B2_',
      offset: hex(loaderOffset),
      region: regionRef(loaderRegion),
      bgIndexRam: '_RAM_CFF5_',
      spriteIndexRam: '_RAM_CFF6_',
      bgDestRam: '_RAM_CF9B_',
      spriteDestRam: '_RAM_CFAB_',
      tableLabel: '_DATA_1C5B0_',
      tableOffset: hex(tableStart),
      recordSize,
      evidence: [
        loaderLine ? `ASM line ${loaderLine}: _LABEL_8B2_ is the palette index loader routine.` : '_LABEL_8B2_ is the palette index loader routine.',
        dataLine ? `ASM line ${dataLine}: _DATA_1C5B0_ starts the 16-byte palette record table.` : '_DATA_1C5B0_ starts the 16-byte palette record table.',
        '_LABEL_8B2_ treats L as BG palette index and H as sprite palette index; $FF leaves the existing index unchanged.',
        '_LABEL_8B2_ multiplies each selected index by 16 and copies two 16-byte records into RAM palette buffers.',
      ],
    },
    records,
    callsites,
  };
}

function annotateMap(mapData, catalog) {
  const annotated = [];
  const loaderRegion = catalog.loader.region && mapData.regions.find(region => region.id === catalog.loader.region.id);
  if (loaderRegion) {
    loaderRegion.analysis = loaderRegion.analysis || {};
    loaderRegion.analysis.paletteLoaderAudit = {
      catalogId,
      kind: 'palette_index_loader',
      confidence: 'high',
      summary: '_LABEL_8B2_ loads BG and sprite palette records from _DATA_1C5B0_ using 16-byte indexed records.',
      loader: catalog.loader,
      generatedAt: now,
      tool: 'tools/world-palette-table-audit.mjs',
    };
    annotated.push({ id: loaderRegion.id, offset: loaderRegion.offset, type: loaderRegion.type, kind: 'palette_index_loader' });
  }

  const recordsByRegion = new Map();
  for (const record of catalog.records) {
    if (!record.region) continue;
    const list = recordsByRegion.get(record.region.id) || [];
    list.push(record);
    recordsByRegion.set(record.region.id, list);
  }
  for (const [regionId, records] of recordsByRegion) {
    const region = mapData.regions.find(item => item.id === regionId);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.paletteTableAudit = {
      catalogId,
      kind: records.every(record => record.allZero) ? 'palette_table_zero_padding' : 'palette_table_record',
      confidence: records.every(record => record.confidence === 'high') ? 'high' : 'medium',
      recordIndices: records.map(record => record.index),
      tableRange: { start: hex(tableStart), endExclusive: hex(tableEndExclusive) },
      recordSize,
      directUsage: {
        bg: records.reduce((sum, record) => sum + record.usedAsBgByDirectCallsites, 0),
        sprite: records.reduce((sum, record) => sum + record.usedAsSpriteByDirectCallsites, 0),
      },
      evidence: [
        '_LABEL_8B2_ indexes _DATA_1C5B0_ in 16-byte records for BG and sprite palette RAM buffers.',
        ...records.flatMap(record => record.evidence),
      ],
      generatedAt: now,
      tool: 'tools/world-palette-table-audit.mjs',
    };
    annotated.push({ id: region.id, offset: region.offset, type: region.type, kind: region.analysis.paletteTableAudit.kind });
  }
  return annotated;
}

function main() {
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const romBytes = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData, asmText, romBytes);
  const annotatedRegions = apply ? annotateMap(mapData, catalog) : [
    ...(catalog.loader.region ? [{ id: catalog.loader.region.id, offset: catalog.loader.region.offset, type: catalog.loader.region.type, kind: 'palette_index_loader' }] : []),
    ...catalog.records
      .filter(record => record.region)
      .map(record => ({ id: record.region.id, offset: record.region.offset, type: record.region.type, recordIndex: record.index })),
  ];

  if (apply) {
    mapData.paletteCatalogs = (mapData.paletteCatalogs || []).filter(catalogItem => catalogItem.id !== catalogId);
    mapData.paletteCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'palette_table_audit',
      generatedAt: now,
      tool: 'tools/world-palette-table-audit.mjs --apply',
      schemaVersion: 1,
      summary: catalog.summary,
      loader: catalog.loader,
      annotatedRegions,
      nextLeads: [
        'Map _DATA_1C800_ palette-effect pointer table and classify its variable-length CRAM update scripts.',
        'Connect sceneRecipes BG/SPR palette indices to this palette catalog by record index.',
        'Add analyzer palette diagnostics that show record index/provenance without storing palette bytes in project metadata.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    loader: catalog.loader,
    outOfRangeDirectPairs: catalog.callsites.filter(callsite => (
      callsite.directIndexPair &&
      (callsite.directIndexPair.bgState === 'out_of_range' || callsite.directIndexPair.spriteState === 'out_of_range')
    )),
    annotatedRegions,
  }, null, 2));
}

main();
