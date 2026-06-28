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
const catalogId = 'world-palette-script-catalog-2026-06-24';
const reportId = 'palette-script-audit-2026-06-24';
const pointerTableStart = 0x1C800;
const pointerTableEntries = 26;
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

function regionBounds(region) {
  const start = parseInt(region.offset, 16);
  return { start, end: start + (region.size || 0) };
}

function rangesOverlap(a, b) {
  return a.start < b.end && b.start < a.end;
}

function findContainingRegion(mapData, offset) {
  return (mapData.regions || []).find(region => {
    const bounds = regionBounds(region);
    return offset >= bounds.start && offset < bounds.end;
  }) || null;
}

function regionsOverlappingRange(mapData, range) {
  return (mapData.regions || []).filter(region => rangesOverlap(regionBounds(region), range));
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

function z80ToBank7Rom(pointer) {
  if (pointer < 0x8000 || pointer >= 0xC000) return null;
  return bank7Base + (pointer - 0x8000);
}

function readWordLE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function parsePaletteScript(romBytes, start) {
  const warnings = [];
  let pos = start;
  let writes = 0;
  let delayWrites = 0;
  let immediateWrites = 0;
  let steps = 0;
  let endReason = 'max_steps';
  let loopTarget = null;
  const destCounts = { '_RAM_CF9B_': 0, '_RAM_CFBB_': 0 };
  const slots = { '_RAM_CF9B_': new Set(), '_RAM_CFBB_': new Set() };

  while (pos < romBytes.length && steps < 2048) {
    steps++;
    const commandOffset = pos;
    const command = romBytes[pos++];
    if (command === 0xFF) {
      endReason = `0xFF END @ ${hex(commandOffset)}`;
      break;
    }
    if (command === 0xF0) {
      if (pos + 1 >= romBytes.length) {
        warnings.push(`F0 pointer at ${hex(commandOffset)} runs past ROM end.`);
        endReason = `truncated F0 @ ${hex(commandOffset)}`;
        break;
      }
      const pointer = readWordLE(romBytes, pos);
      pos += 2;
      const target = z80ToBank7Rom(pointer);
      loopTarget = target == null ? null : hex(target);
      endReason = `0xF0 JUMP @ ${hex(commandOffset)}`;
      if (target == null) warnings.push(`F0 pointer ${hex(pointer, 4)} is outside the bank-7 0x8000-0xBFFF window.`);
      break;
    }
    if (pos >= romBytes.length) {
      warnings.push(`Command at ${hex(commandOffset)} has no value byte.`);
      endReason = `truncated command @ ${hex(commandOffset)}`;
      break;
    }
    pos++;
    writes++;
    const dest = (command & 0x40) ? '_RAM_CF9B_' : '_RAM_CFBB_';
    const slot = command & 0x1F;
    destCounts[dest]++;
    slots[dest].add(slot);
    if (command & 0x80) {
      if (pos >= romBytes.length) {
        warnings.push(`Delayed command at ${hex(commandOffset)} has no delay byte.`);
        endReason = `truncated delay @ ${hex(commandOffset)}`;
        break;
      }
      pos++;
      delayWrites++;
    } else {
      immediateWrites++;
    }
  }

  return {
    start,
    endExclusive: pos,
    parsedBytes: pos - start,
    endReason,
    loopTarget,
    stats: {
      writes,
      immediateWrites,
      delayWrites,
      destCounts,
      slots: {
        '_RAM_CF9B_': [...slots['_RAM_CF9B_']].sort((a, b) => a - b),
        '_RAM_CFBB_': [...slots['_RAM_CFBB_']].sort((a, b) => a - b),
      },
    },
    warnings,
  };
}

function scanEffectIndexWrites(asmText) {
  const lines = asmText.split(/\r?\n/);
  const writes = [];
  let currentLabel = null;
  let currentOffset = null;

  function findImmediateA(lineIndex) {
    for (let i = lineIndex - 1; i >= 0 && i >= lineIndex - 8; i--) {
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
    if (!/\bld\s+\(_RAM_CF65_\),\s*a/i.test(cleanCode(lines[i]))) continue;
    const immediate = findImmediateA(i);
    writes.push({
      line: i + 1,
      callerLabel: currentLabel,
      callerOffset: currentOffset == null ? null : hex(currentOffset),
      directIndex: immediate ? immediate.value : null,
      sourceLine: immediate?.line || null,
      sourceMode: immediate?.mode || 'dynamic',
      evidence: immediate
        ? `ASM line ${immediate.line} sets A=${hex(immediate.value, 2)} before storing _RAM_CF65_ at line ${i + 1}.`
        : `ASM line ${i + 1} stores _RAM_CF65_ from a dynamic A value.`,
    });
  }
  return writes;
}

function pointerEntries(mapData, romBytes) {
  const entries = [];
  for (let index = 0; index < pointerTableEntries; index++) {
    const tableOffset = pointerTableStart + index * 2;
    const pointer = readWordLE(romBytes, tableOffset);
    const target = z80ToBank7Rom(pointer);
    entries.push({
      index,
      tableOffset: hex(tableOffset),
      pointer: hex(pointer, 4),
      targetOffset: target == null ? null : hex(target),
      targetRegion: target == null ? null : regionRef(findContainingRegion(mapData, target)),
      validBank7Pointer: target != null,
    });
  }
  return entries;
}

function buildCatalog(mapData, asmText, romBytes) {
  const tableRegion = findContainingRegion(mapData, pointerTableStart);
  const entries = pointerEntries(mapData, romBytes);
  const scripts = entries.map(entry => {
    if (!entry.validBank7Pointer) {
      return {
        index: entry.index,
        pointerEntry: entry,
        valid: false,
        warnings: [`Pointer ${entry.pointer} is outside the bank-7 script window.`],
      };
    }
    const start = parseInt(entry.targetOffset, 16);
    const parsed = parsePaletteScript(romBytes, start);
    const range = { start: parsed.start, end: parsed.endExclusive };
    const overlappingRegions = regionsOverlappingRange(mapData, range).map(region => {
      const bounds = regionBounds(region);
      const overlapStart = Math.max(bounds.start, range.start);
      const overlapEnd = Math.min(bounds.end, range.end);
      return {
        ...regionRef(region),
        overlapBytes: overlapEnd - overlapStart,
        fullyCoveredByParsedScript: bounds.start >= range.start && bounds.end <= range.end,
        parsedCoverageRatio: Number(((overlapEnd - overlapStart) / Math.max(1, bounds.end - bounds.start)).toFixed(4)),
      };
    });
    return {
      index: entry.index,
      pointerEntry: entry,
      valid: true,
      range: {
        start: hex(parsed.start),
        endExclusive: hex(parsed.endExclusive),
        endInclusive: hex(parsed.endExclusive - 1),
        parsedBytes: parsed.parsedBytes,
      },
      endReason: parsed.endReason,
      loopTarget: parsed.loopTarget,
      stats: parsed.stats,
      warningCount: parsed.warnings.length,
      warnings: parsed.warnings,
      overlappingRegions,
      evidence: [
        `_LABEL_10BC_ selects _DATA_1C800_ entry ${entry.index} through _RAM_CF65_ and decodes the stream at ${entry.targetOffset}.`,
        'Parser stores command counts, slots, delays, and control-flow offsets only; palette value bytes are not embedded.',
      ],
    };
  });
  const indexWrites = scanEffectIndexWrites(asmText).map(write => ({
    ...write,
    directIndexState: write.directIndex == null
      ? 'dynamic'
      : (write.directIndex < pointerTableEntries ? 'table_entry' : (write.directIndex === 0xFF || write.directIndex === 0xFE ? 'sentinel' : 'out_of_range')),
  }));
  const directUsage = new Map();
  for (const write of indexWrites) {
    if (write.directIndexState !== 'table_entry') continue;
    directUsage.set(write.directIndex, (directUsage.get(write.directIndex) || 0) + 1);
  }
  for (const script of scripts) {
    script.directIndexWriteCount = directUsage.get(script.index) || 0;
  }
  const tableLine = findAsmLine(asmText, '_DATA_1C800_:');
  const loaderLine = findAsmLine(asmText, '_LABEL_10BC_:');
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-palette-script-audit.mjs',
    summary: {
      pointerTableOffset: hex(pointerTableStart),
      pointerTableEntries,
      validPointers: entries.filter(entry => entry.validBank7Pointer).length,
      scripts: scripts.length,
      terminatedScripts: scripts.filter(script => script.endReason?.startsWith('0xFF')).length,
      loopedScripts: scripts.filter(script => script.endReason?.startsWith('0xF0')).length,
      parserWarnings: scripts.reduce((sum, script) => sum + (script.warningCount || 0), 0),
      directIndexWrites: indexWrites.filter(write => write.directIndexState === 'table_entry').length,
      dynamicIndexWrites: indexWrites.filter(write => write.directIndexState === 'dynamic').length,
      sentinelIndexWrites: indexWrites.filter(write => write.directIndexState === 'sentinel').length,
      assetPolicy: 'Metadata only: script offsets, pointer references, command counts, destination RAM slots, delay counts, and loop targets. No palette value bytes or rendered colors are embedded.',
    },
    loader: {
      label: '_LABEL_10BC_',
      offset: hex(0x10BC),
      region: regionRef(findContainingRegion(mapData, 0x10BC)),
      indexRam: '_RAM_CF65_',
      activePointerRam: '_RAM_D020_',
      delayRam: '_RAM_D022_',
      tableLabel: '_DATA_1C800_',
      tableRegion: regionRef(tableRegion),
      evidence: [
        loaderLine ? `ASM line ${loaderLine}: _LABEL_10BC_ decodes palette-effect scripts through _RAM_CF65_.` : '_LABEL_10BC_ decodes palette-effect scripts through _RAM_CF65_.',
        tableLine ? `ASM line ${tableLine}: _DATA_1C800_ is a 26-entry script pointer table indexed by _RAM_CF65_.` : '_DATA_1C800_ is a 26-entry script pointer table indexed by _RAM_CF65_.',
        '_LABEL_10BC_ treats $FF as inactive/end, $FE as script-in-progress, $F0 as an in-script pointer jump, bit 6 as destination buffer select, and bit 7 as delayed write.',
      ],
    },
    pointerEntries: entries,
    scripts,
    indexWrites,
  };
}

function annotateMap(mapData, catalog) {
  const annotated = [];
  const tableRegion = catalog.loader.tableRegion && mapData.regions.find(region => region.id === catalog.loader.tableRegion.id);
  if (tableRegion) {
    const typeBefore = tableRegion.type || 'unknown';
    tableRegion.type = 'palette_script_table';
    tableRegion.analysis = tableRegion.analysis || {};
    tableRegion.analysis.paletteScriptAudit = {
      catalogId,
      kind: 'palette_script_pointer_table',
      confidence: 'high',
      typeBeforeAudit: typeBefore,
      typeAfterAudit: tableRegion.type,
      changedType: typeBefore !== tableRegion.type,
      summary: '_DATA_1C800_ is a 26-entry pointer table for _LABEL_10BC_ palette-effect scripts.',
      loader: catalog.loader,
      evidence: catalog.loader.evidence,
      generatedAt: now,
      tool: 'tools/world-palette-script-audit.mjs',
    };
    annotated.push({ id: tableRegion.id, offset: tableRegion.offset, typeBefore, typeAfter: tableRegion.type, kind: 'palette_script_pointer_table' });
  }

  const scriptsByRegion = new Map();
  for (const script of catalog.scripts) {
    for (const ref of script.overlappingRegions || []) {
      const list = scriptsByRegion.get(ref.id) || [];
      list.push({ script, overlap: ref });
      scriptsByRegion.set(ref.id, list);
    }
  }
  const retypableTypes = new Set(['screen_prog', 'vdp_stream', 'palette', 'data_table', 'raw_byte']);
  for (const [regionId, items] of scriptsByRegion) {
    const region = mapData.regions.find(item => item.id === regionId);
    if (!region) continue;
    const typeBefore = region.type || 'unknown';
    const fullyCovered = items.some(item => item.overlap.fullyCoveredByParsedScript);
    const changedType = fullyCovered && retypableTypes.has(typeBefore);
    if (changedType) region.type = 'palette_script';
    region.analysis = region.analysis || {};
    region.analysis.paletteScriptAudit = {
      catalogId,
      kind: fullyCovered ? 'palette_script_record' : 'contains_palette_script_subrange',
      confidence: fullyCovered ? 'high' : 'medium',
      typeBeforeAudit: typeBefore,
      typeAfterAudit: region.type || typeBefore,
      changedType,
      scriptIndices: items.map(item => item.script.index),
      parsedRanges: items.map(item => item.script.range),
      directIndexWriteCount: items.reduce((sum, item) => sum + (item.script.directIndexWriteCount || 0), 0),
      stats: items.map(item => ({
        scriptIndex: item.script.index,
        writes: item.script.stats?.writes || 0,
        immediateWrites: item.script.stats?.immediateWrites || 0,
        delayWrites: item.script.stats?.delayWrites || 0,
        endReason: item.script.endReason,
        loopTarget: item.script.loopTarget,
        overlapBytes: item.overlap.overlapBytes,
        fullyCoveredByParsedScript: item.overlap.fullyCoveredByParsedScript,
        parsedCoverageRatio: item.overlap.parsedCoverageRatio,
      })),
      evidence: [
        ...new Set(items.flatMap(item => item.script.evidence || [])),
        fullyCovered
          ? 'The mapped region is fully covered by parsed _LABEL_10BC_ palette-script bytecode.'
          : 'Only a prefix/subrange of this mapped region is consumed by parsed _LABEL_10BC_ palette-script bytecode; remaining bytes need a separate decoder before region splitting.',
      ],
      generatedAt: now,
      tool: 'tools/world-palette-script-audit.mjs',
    };
    annotated.push({ id: region.id, offset: region.offset, typeBefore, typeAfter: region.type, changedType, kind: region.analysis.paletteScriptAudit.kind });
  }
  return annotated;
}

function main() {
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const romBytes = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData, asmText, romBytes);
  const annotatedRegions = apply ? annotateMap(mapData, catalog) : [
    ...(catalog.loader.tableRegion ? [{ id: catalog.loader.tableRegion.id, offset: catalog.loader.tableRegion.offset, typeBefore: catalog.loader.tableRegion.type, typeAfter: 'palette_script_table', kind: 'palette_script_pointer_table' }] : []),
    ...catalog.scripts.flatMap(script => (script.overlappingRegions || []).map(region => ({
      id: region.id,
      offset: region.offset,
      typeBefore: region.type,
      typeAfter: region.fullyCoveredByParsedScript ? 'palette_script' : region.type,
      kind: region.fullyCoveredByParsedScript ? 'palette_script_record' : 'contains_palette_script_subrange',
    }))),
  ];

  if (apply) {
    mapData.paletteCatalogs = (mapData.paletteCatalogs || []).filter(catalogItem => catalogItem.id !== catalogId);
    mapData.paletteCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'palette_script_audit',
      generatedAt: now,
      tool: 'tools/world-palette-script-audit.mjs --apply',
      schemaVersion: 1,
      summary: catalog.summary,
      loader: catalog.loader,
      annotatedRegions,
      nextLeads: [
        'Split the mixed _DATA_1CABB_ region after its parsed palette-script prefix once the trailing data format is identified.',
        'Connect direct _RAM_CF65_ writes to scene/state transitions so palette effects can be previewed by context.',
        'Add a read-only palette-effect timeline panel driven by _LABEL_10BC_ script metadata and local ROM bytes.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    loader: catalog.loader,
    scriptsWithWarnings: catalog.scripts.filter(script => script.warningCount),
    partialRegions: catalog.scripts.flatMap(script => (script.overlappingRegions || [])
      .filter(region => !region.fullyCoveredByParsedScript)
      .map(region => ({ scriptIndex: script.index, region }))),
    annotatedRegions,
  }, null, 2));
}

main();
