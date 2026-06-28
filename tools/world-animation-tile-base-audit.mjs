#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const asmPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).asm');
const apply = process.argv.includes('--apply');
const now = '2026-06-25T00:00:00Z';
const catalogId = 'world-animation-tile-base-catalog-2026-06-25';
const reportId = 'animation-tile-base-audit-2026-06-25';
const toolName = 'tools/world-animation-tile-base-audit.mjs';

const ABSOLUTE_SLOT_FIELDS = {
  _RAM_C2BF_: {
    slotBase: '_RAM_C280_',
    slotFieldOffset: '0x3F',
    rootField: '_RAM_C28E_',
    childField: '_RAM_C28F_',
  },
  _RAM_C3FF_: {
    slotBase: '_RAM_C3C0_',
    slotFieldOffset: '0x3F',
    rootField: '_RAM_C3CE_',
    childField: '_RAM_C3CF_',
  },
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function hexByte(n) {
  return '0x' + n.toString(16).toUpperCase().padStart(2, '0');
}

function normOffset(value) {
  if (value == null) return null;
  if (typeof value === 'number') return hex(value);
  return '0x' + String(value).replace(/^0x/i, '').toUpperCase().padStart(5, '0');
}

function normByte(value) {
  if (value == null) return null;
  if (typeof value === 'number') return hexByte(value & 0xff);
  const m = String(value).match(/^(?:0x|\$)?([0-9a-f]{1,2})$/i);
  if (!m) return null;
  return hexByte(parseInt(m[1], 16));
}

function offsetOf(region) {
  return typeof region.offset === 'number' ? region.offset : parseInt(region.offset, 16);
}

function findContainingRegion(mapData, offset) {
  return (mapData.regions || []).find(region => {
    const start = offsetOf(region);
    return offset >= start && offset < start + (region.size || 0);
  }) || null;
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
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

function labelOffset(label) {
  const match = String(label || '').match(/^_(?:LABEL|DATA)_([0-9A-F]+)_$/i);
  if (!match) return null;
  return parseInt(match[1], 16);
}

function parseImmediate(operand) {
  const match = String(operand || '').trim().match(/^\$([0-9A-F]{1,2})$/i);
  if (!match) return null;
  return parseInt(match[1], 16);
}

function parseAsm(asmText) {
  const lines = asmText.split(/\r?\n/);
  const parsed = [];
  let activeLabel = null;
  let activeOffset = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const labelMatch = raw.match(/^(_(?:LABEL|DATA)_[0-9A-F]+_):/i);
    if (labelMatch) {
      activeLabel = labelMatch[1];
      activeOffset = labelOffset(activeLabel);
    }
    const code = raw.replace(/;.*$/, '').trim();
    parsed.push({
      line: i + 1,
      raw,
      code,
      activeLabel,
      activeOffset,
    });
  }
  return parsed;
}

function findLabelLineIndex(parsed, label) {
  return parsed.findIndex(entry => entry.raw.startsWith(`${label}:`));
}

function parseDbByteValues(code) {
  if (!/^\.db\b/i.test(code)) return [];
  return [...code.matchAll(/\$([0-9A-F]{1,2})/gi)].map(match => parseInt(match[1], 16));
}

function collectDbBytes(parsed, label, byteLength) {
  const labelIndex = findLabelLineIndex(parsed, label);
  if (labelIndex < 0) return [];
  const bytes = [];
  for (let i = labelIndex + 1; i < parsed.length && bytes.length < byteLength; i++) {
    if (/^_(?:LABEL|DATA)_[0-9A-F]+_:/i.test(parsed[i].raw)) break;
    bytes.push(...parseDbByteValues(parsed[i].code));
  }
  return bytes.slice(0, byteLength);
}

function parseTileBaseWrite(code) {
  let match = code.match(/^ld\s+\(ix\+63\),\s*(.+)$/i);
  if (match) {
    const operand = match[1].trim();
    return {
      target: 'IX+63',
      targetKind: 'indexed_actor_slot_field',
      operand,
    };
  }

  match = code.match(/^ld\s+\((_RAM_C2BF_|_RAM_C3FF_)\),\s*a$/i);
  if (match) {
    const target = match[1].toUpperCase().replace(/^_RAM_/, '_RAM_');
    return {
      target,
      targetKind: 'absolute_actor_slot_field',
      operand: 'a',
      absoluteSlot: ABSOLUTE_SLOT_FIELDS[target],
    };
  }

  return null;
}

function isLabelBoundary(entry, currentLabel) {
  return entry.activeLabel && currentLabel && entry.activeLabel !== currentLabel;
}

function sourceFromLoadA(code, line) {
  let match = code.match(/^ld\s+a,\s*\$([0-9A-F]{1,2})$/i);
  if (match) {
    return {
      kind: 'immediate',
      value: hexByte(parseInt(match[1], 16)),
      expression: `$${match[1].toUpperCase().padStart(2, '0')}`,
      line,
      code,
    };
  }

  match = code.match(/^ld\s+a,\s*\((iy|ix)\+([0-9]+)\)$/i);
  if (match) {
    return {
      kind: `${match[1].toUpperCase()}_field`,
      value: null,
      expression: `${match[1].toUpperCase()}+${match[2]}`,
      line,
      code,
    };
  }

  match = code.match(/^ld\s+a,\s*\((_RAM_[A-Z0-9]+_)\)$/i);
  if (match) {
    return {
      kind: 'ram_read',
      value: null,
      expression: match[1],
      line,
      code,
    };
  }

  match = code.match(/^ld\s+a,\s*([bcdehl])$/i);
  if (match) {
    return {
      kind: 'register',
      value: null,
      expression: match[1].toUpperCase(),
      line,
      code,
    };
  }

  return null;
}

function parseATransform(code, line) {
  let match = code.match(/^(add|sub|and|or)\s+a?,?\s*\$([0-9A-F]{1,2})$/i);
  if (match) {
    return {
      line,
      code,
      op: match[1].toLowerCase(),
      value: hexByte(parseInt(match[2], 16)),
    };
  }
  match = code.match(/^(inc|dec)\s+a$/i);
  if (match) {
    return { line, code, op: match[1].toLowerCase(), value: null };
  }
  match = code.match(/^(rra|rrca|rlca|srl\s+a|res\s+[0-7],\s*a)$/i);
  if (match) {
    return { line, code, op: match[1].toLowerCase(), value: null };
  }
  return null;
}

function inferASource(parsed, writeIndex) {
  const transforms = [];
  const currentLabel = parsed[writeIndex].activeLabel;
  for (let i = writeIndex - 1; i >= 0 && i >= writeIndex - 32; i--) {
    const entry = parsed[i];
    if (isLabelBoundary(entry, currentLabel)) break;
    const code = entry.code;
    if (!code) continue;
    if (/^(call|jp|jr|ret|djnz|rst)\b/i.test(code)) {
      transforms.push({ line: entry.line, code, op: 'control_flow_before_source', value: null });
      continue;
    }
    if (/^xor\s+a$/i.test(code)) {
      return {
        kind: 'immediate_zero',
        value: '0x00',
        expression: 'xor a',
        line: entry.line,
        code,
        transforms: transforms.reverse().slice(0, 12),
      };
    }
    const source = sourceFromLoadA(code, entry.line);
    if (source) {
      return {
        ...source,
        transforms: transforms.reverse().slice(0, 12),
      };
    }
    const transform = parseATransform(code, entry.line);
    if (transform) transforms.push(transform);
  }
  return {
    kind: 'unknown_a',
    value: null,
    expression: 'A',
    line: null,
    code: null,
    transforms: transforms.reverse().slice(0, 12),
  };
}

function inferOperandSource(parsed, writeIndex, operand) {
  const immediate = parseImmediate(operand);
  if (immediate != null) {
    return {
      kind: immediate === 0 ? 'immediate_zero' : 'immediate',
      value: hexByte(immediate),
      expression: operand.toUpperCase(),
      line: parsed[writeIndex].line,
      code: parsed[writeIndex].code,
      transforms: [],
    };
  }
  if (/^a$/i.test(operand)) return inferASource(parsed, writeIndex);
  return {
    kind: 'unknown_operand',
    value: null,
    expression: operand,
    line: parsed[writeIndex].line,
    code: parsed[writeIndex].code,
    transforms: [],
  };
}

function parseSelectorStore(code, target) {
  let match = code.match(/^ld\s+\(ix\+(14|15)\),\s*(.+)$/i);
  if (match) {
    const field = match[1] === '14' ? 'root' : 'child';
    return {
      field,
      operand: match[2].trim(),
      target: `IX+${match[1]}`,
    };
  }

  const slot = target && ABSOLUTE_SLOT_FIELDS[target];
  if (!slot) return null;
  match = code.match(/^ld\s+\((_RAM_C28E_|_RAM_C28F_|_RAM_C3CE_|_RAM_C3CF_)\),\s*(.+)$/i);
  if (!match) return null;
  const ram = match[1];
  if (ram !== slot.rootField && ram !== slot.childField) return null;
  return {
    field: ram === slot.rootField ? 'root' : 'child',
    operand: match[2].trim(),
    target: ram,
  };
}

function inferSelectorSource(parsed, storeIndex, operand) {
  const immediate = parseImmediate(operand);
  if (immediate != null) {
    return {
      kind: 'immediate',
      value: hexByte(immediate),
      expression: operand.toUpperCase(),
      line: parsed[storeIndex].line,
      code: parsed[storeIndex].code,
    };
  }
  if (/^a$/i.test(operand)) {
    const source = inferASource(parsed, storeIndex);
    return {
      kind: source.kind,
      value: source.value,
      expression: source.expression,
      line: source.line,
      code: source.code,
      transforms: source.transforms,
    };
  }
  return {
    kind: 'unknown_operand',
    value: null,
    expression: operand,
    line: parsed[storeIndex].line,
    code: parsed[storeIndex].code,
  };
}

function findSelectorContext(parsed, writeIndex, target) {
  const currentLabel = parsed[writeIndex].activeLabel;
  const result = { root: null, child: null };
  for (let i = writeIndex - 1; i >= 0 && i >= writeIndex - 96; i--) {
    const entry = parsed[i];
    if (isLabelBoundary(entry, currentLabel)) break;
    const store = parseSelectorStore(entry.code, target);
    if (!store) continue;
    if (result[store.field]) continue;
    result[store.field] = {
      target: store.target,
      source: inferSelectorSource(parsed, i, store.operand),
      storeLine: entry.line,
      storeCode: entry.code,
    };
    if (result.root && result.child) break;
  }
  return {
    root: result.root,
    child: result.child,
    resolvedPair: {
      root: result.root?.source?.value || null,
      child: result.child?.source?.value || null,
    },
  };
}

function familySelectorKey(selectorPair) {
  const root = normByte(selectorPair?.root);
  const child = normByte(selectorPair?.child);
  if (!root || !child) return null;
  return `${root}:${child}`;
}

function buildFamilyIndex(mapData) {
  const index = new Map();
  const catalogDefs = [
    ['animationFamilyCatalogs', 'families'],
    ['animationBehaviorFamilyCatalogs', 'families'],
  ];

  function add(selectorPair, ref) {
    const key = familySelectorKey(selectorPair);
    if (!key) return;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(ref);
  }

  for (const [catalogKey, familyKey] of catalogDefs) {
    for (const catalog of mapData[catalogKey] || []) {
      for (const family of catalog[familyKey] || []) {
        const selectorPair = family.selectorPair || family.selectorProvenance?.selectorPair;
        add(selectorPair, {
          sourceCatalog: catalog.id,
          familyId: family.id,
          familyKind: family.kind,
          confidence: family.confidence || null,
          frameTargetConfidence: family.frameTargetConfidence || null,
          entityType: family.entityType ?? null,
          dispatchLabel: family.dispatchLabel || null,
          selectorPair,
          streamOffsets: (family.streams || family.selectedTarget?.streams || [])
            .map(stream => normOffset(stream.offset))
            .filter(Boolean)
            .slice(0, 12),
        });
      }
    }
  }
  return index;
}

function classifyWrite(write) {
  const source = write.source;
  const pair = write.selectorContext?.resolvedPair || {};
  if (source.kind === 'table_entry_low_byte') {
    return {
      role: 'table_driven_absolute_slot_tile_base',
      confidence: 'high',
      summary: 'Absolute _RAM_C3C0_ actor slot receives tile base from the low byte of a table record selected by _RAM_C24F_.',
    };
  }
  if (source.kind === 'IY_field' && source.expression === 'IY+5') {
    return {
      role: 'room_entity_record_tile_base',
      confidence: 'high',
      summary: 'Room entity initializer copies byte 5 of the room entity record into IX+63, the per-frame tile-base addend.',
    };
  }
  if (source.value === '0x76' && pair.root === '0x04') {
    return {
      role: 'fixed_root4_effect_tile_base',
      confidence: 'high',
      summary: 'Root-4 effect animation uses fixed tile base 0x76 before calling _LABEL_1318_.',
    };
  }
  if (source.kind === 'ram_read' && source.expression === '_RAM_D0FE_') {
    return {
      role: 'object_slot_tile_base_from_ram',
      confidence: 'high',
      summary: '_RAM_D0FE_ supplies the tile base for the initialized object slot.',
    };
  }
  if (source.value === '0x68' && write.target === '_RAM_C3FF_') {
    return {
      role: 'fixed_absolute_slot_tile_base',
      confidence: 'high',
      summary: 'Absolute _RAM_C3C0_ actor slot receives fixed tile base 0x68.',
    };
  }
  if (source.kind === 'register' && write.target === '_RAM_C3FF_') {
    return {
      role: 'table_driven_absolute_slot_tile_base',
      confidence: 'medium',
      summary: 'Absolute _RAM_C3C0_ actor slot receives tile base from a register loaded immediately before the write.',
    };
  }
  if (source.value === '0x00') {
    return {
      role: 'zero_tile_base',
      confidence: 'high',
      summary: 'Actor slot uses frame tile bytes without an added tile-base offset.',
    };
  }
  return {
    role: 'dynamic_tile_base',
    confidence: 'medium',
    summary: 'Tile base is written from a dynamic source that requires further caller/data tracing.',
  };
}

function decodePlayerFormTileBaseTable(mapData, parsed, familyIndex) {
  const tableLabel = '_DATA_BFB0_';
  const tableOffset = 0x0BFB0;
  const bytes = collectDbBytes(parsed, tableLabel, 10);
  const region = findContainingRegion(mapData, tableOffset);
  const entries = [];
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    const tileBase = hexByte(bytes[index]);
    const animationChild = hexByte(bytes[index + 1]);
    const selectorPair = { root: '0x02', child: animationChild };
    entries.push({
      index: index / 2,
      entryOffset: hex(tableOffset + index),
      selectedBy: '_RAM_C24F_',
      tileBase,
      animationSelector: {
        rootField: '_RAM_C3CE_',
        root: '0x02',
        childField: '_RAM_C3CF_',
        child: animationChild,
      },
      linkedFamilies: (familyIndex.get(familySelectorKey(selectorPair)) || []).slice(0, 12),
      evidence: [
        '_LABEL_BB13_ indexes _DATA_BFB0_ with _RAM_C24F_ through rst $08/rst $10.',
        '_LABEL_BB13_ writes selected E to _RAM_C3FF_ and selected D to _RAM_C3CF_.',
        '_LABEL_BB13_ later writes root selector 0x02 to _RAM_C3CE_ before calling _LABEL_1318_.',
      ],
    });
  }
  return {
    id: 'player_form_tile_base_table_BFB0',
    label: tableLabel,
    offset: hex(tableOffset),
    region: regionRef(region),
    entryCount: entries.length,
    byteLength: bytes.length,
    stride: 2,
    indexedBy: '_RAM_C24F_',
    consumerRoutine: '_LABEL_BB13_',
    consumerWriteId: null,
    semantics: {
      lowByte: 'Tile base copied to _RAM_C3FF_ (absolute alias of _RAM_C3C0_ + 0x3F / IX+63).',
      highByte: 'Animation child selector copied to _RAM_C3CF_; root selector _RAM_C3CE_ is set to 0x02 in _LABEL_BB13_.',
    },
    entries,
    confidence: entries.length === 5 ? 'high' : 'medium',
    evidence: [
      'ASM lines 20947-20952: _LABEL_BB13_ reads _RAM_C24F_, indexes _DATA_BFB0_, and writes the selected low byte to _RAM_C3FF_.',
      'ASM lines 20953-20954: _LABEL_BB13_ writes the selected high byte to _RAM_C3CF_.',
      'ASM lines 20969-20972: _LABEL_BB13_ increments A twice from zero and writes 0x02 to _RAM_C3CE_.',
      'ASM lines 21497-21499 define _DATA_BFB0_ as five two-byte parameter records.',
    ],
  };
}

function applyParameterTableSource(writes, parameterTables) {
  const playerFormTable = parameterTables.find(table => table.id === 'player_form_tile_base_table_BFB0');
  if (!playerFormTable) return;
  const write = writes.find(item => item.label === '_LABEL_BB13_' && item.target === '_RAM_C3FF_');
  if (!write) return;
  playerFormTable.consumerWriteId = write.id;
  write.source = {
    kind: 'table_entry_low_byte',
    value: null,
    expression: '_DATA_BFB0_[_RAM_C24F_].low',
    line: 20948,
    code: 'ld hl, _DATA_BFB0_',
    table: {
      id: playerFormTable.id,
      label: playerFormTable.label,
      offset: playerFormTable.offset,
    },
    transforms: [],
  };
  write.selectorContext = {
    ...write.selectorContext,
    root: {
      target: '_RAM_C3CE_',
      source: {
        kind: 'immediate',
        value: '0x02',
        expression: 'zero, inc, inc',
        line: 20971,
        code: 'ld (_RAM_C3CE_), a',
      },
      storeLine: 20971,
      storeCode: 'ld (_RAM_C3CE_), a',
    },
    child: {
      target: '_RAM_C3CF_',
      source: {
        kind: 'table_entry_high_byte',
        value: null,
        expression: '_DATA_BFB0_[_RAM_C24F_].high',
        line: 20954,
        code: 'ld (_RAM_C3CF_), a',
      },
      storeLine: 20954,
      storeCode: 'ld (_RAM_C3CF_), a',
    },
    resolvedPair: {
      root: '0x02',
      child: null,
    },
    tableDrivenPairs: playerFormTable.entries.map(entry => ({
      index: entry.index,
      selectorPair: {
        root: entry.animationSelector.root,
        child: entry.animationSelector.child,
      },
      tileBase: entry.tileBase,
      linkedFamilyCount: entry.linkedFamilies.length,
    })),
  };
  const classification = classifyWrite(write);
  write.role = classification.role;
  write.confidence = classification.confidence;
  write.summary = classification.summary;
  write.evidence = [
    `ASM line ${write.line}: ${write.code}`,
    'ASM line 20948: ld hl, _DATA_BFB0_',
    'ASM lines 20949-20954: rst $08/rst $10 selects a word; E goes to _RAM_C3FF_ and D goes to _RAM_C3CF_.',
    '_LABEL_792_ adds (IX+63) to each frame-stream tile byte before writing OAM tile ids.',
  ];
}

function compactWriteRef(write) {
  return {
    writeId: write.id,
    line: write.line,
    label: write.label,
    target: write.target,
    source: {
      kind: write.source.kind,
      value: write.source.value,
      expression: write.source.expression,
      line: write.source.line,
      code: write.source.code,
      table: write.source.table || null,
    },
    selectorPair: write.selectorContext.resolvedPair,
    tableDrivenPairs: (write.selectorContext.tableDrivenPairs || []).slice(0, 12),
    role: write.role,
    confidence: write.confidence,
    linkedFamilyCount: write.linkedFamilies.length,
  };
}

function compactParameterTableRef(table) {
  return {
    catalogId,
    id: table.id,
    label: table.label,
    offset: table.offset,
    entryCount: table.entryCount,
    stride: table.stride,
    indexedBy: table.indexedBy,
    consumerRoutine: table.consumerRoutine,
    consumerWriteId: table.consumerWriteId,
    semantics: table.semantics,
    entrySummaries: table.entries.map(entry => ({
      index: entry.index,
      entryOffset: entry.entryOffset,
      tileBase: entry.tileBase,
      animationSelector: entry.animationSelector,
      linkedFamilyCount: entry.linkedFamilies.length,
    })),
    confidence: table.confidence,
  };
}

function summarizeBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item) || 'unknown';
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, count]) => ({ key, count }));
}

function buildCatalog(mapData, asmText) {
  const parsed = parseAsm(asmText);
  const familyIndex = buildFamilyIndex(mapData);
  const writes = [];

  for (let i = 0; i < parsed.length; i++) {
    const parsedWrite = parseTileBaseWrite(parsed[i].code);
    if (!parsedWrite) continue;
    const source = inferOperandSource(parsed, i, parsedWrite.operand);
    const selectorContext = findSelectorContext(parsed, i, parsedWrite.target);
    const classification = classifyWrite({
      target: parsedWrite.target,
      source,
      selectorContext,
    });
    const activeOffset = parsed[i].activeOffset;
    const region = activeOffset == null ? null : findContainingRegion(mapData, activeOffset);
    const key = familySelectorKey(selectorContext.resolvedPair);
    const linkedFamilies = key ? familyIndex.get(key) || [] : [];
    const id = `tile_base_write_${String(writes.length + 1).padStart(2, '0')}_${parsed[i].line}`;
    writes.push({
      id,
      line: parsed[i].line,
      code: parsed[i].code,
      label: parsed[i].activeLabel,
      labelOffset: activeOffset == null ? null : hex(activeOffset),
      region: regionRef(region),
      target: parsedWrite.target,
      targetKind: parsedWrite.targetKind,
      absoluteSlot: parsedWrite.absoluteSlot || null,
      source,
      selectorContext,
      linkedFamilies: linkedFamilies.slice(0, 24),
      role: classification.role,
      confidence: classification.confidence,
      summary: classification.summary,
      evidence: [
        `ASM line ${parsed[i].line}: ${parsed[i].code}`,
        source.line ? `Source trace line ${source.line}: ${source.code}` : 'Source trace did not resolve within the local routine window.',
        '_LABEL_792_ adds (IX+63) to each frame-stream tile byte before writing OAM tile ids.',
      ],
    });
  }

  const parameterTables = [decodePlayerFormTileBaseTable(mapData, parsed, familyIndex)];
  applyParameterTableSource(writes, parameterTables);
  const resolvedDynamicSourceKinds = new Set(['IY_field', 'ram_read', 'table_entry_low_byte']);
  const unresolvedWrites = writes.filter(write => !write.source.value && !resolvedDynamicSourceKinds.has(write.source.kind));
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [
      'world-animation-frame-stream-catalog-2026-06-25',
      'world-animation-family-catalog-2026-06-25',
      'world-animation-behavior-family-catalog-2026-06-25',
    ],
    assetPolicy: 'Metadata only: ASM labels, offsets, RAM field names, selector pairs, source expressions, counts, family ids, and region ids. No ROM bytes, decoded graphics, audio, or text payloads are embedded.',
    semantics: {
      frameRenderer: '_LABEL_792_',
      tileBaseField: 'IX+63',
      tileBaseConsumer: '_LABEL_792_ reads one tile byte from the frame stream, adds (IX+63), and stores the result as the OAM tile id.',
      absoluteSlotAliases: ABSOLUTE_SLOT_FIELDS,
      roomEntitySource: '_LABEL_65B9_ copies room entity byte IY+5 into IX+63 after setting IX+14=0x02 and IX+15=IY+0.',
    },
    parameterTables,
    writes,
    summaries: {
      byRole: summarizeBy(writes, write => write.role),
      byTarget: summarizeBy(writes, write => write.target),
      bySourceKind: summarizeBy(writes, write => write.source.kind),
      bySourceValue: summarizeBy(writes, write => write.source.value || write.source.expression),
      bySelectorPair: summarizeBy(writes, write => {
        const pair = write.selectorContext.resolvedPair;
        return pair.root && pair.child ? `${pair.root}:${pair.child}` : null;
      }),
    },
    summary: {
      tileBaseWriterCount: writes.length,
      indexedIx63Writes: writes.filter(write => write.target === 'IX+63').length,
      absoluteSlotWrites: writes.filter(write => write.target !== 'IX+63').length,
      roomEntityRecordTileBaseWrites: writes.filter(write => write.role === 'room_entity_record_tile_base').length,
      fixedRoot4EffectTileBaseWrites: writes.filter(write => write.role === 'fixed_root4_effect_tile_base').length,
      zeroTileBaseWrites: writes.filter(write => write.role === 'zero_tile_base').length,
      tableOrRamDrivenWrites: writes.filter(write => /table|ram|dynamic/.test(write.role)).length,
      writesWithResolvedSelectorPair: writes.filter(write => write.selectorContext.resolvedPair.root && write.selectorContext.resolvedPair.child).length,
      writesLinkedToAnimationFamilies: writes.filter(write => write.linkedFamilies.length > 0).length,
      parameterTableCount: parameterTables.length,
      parameterTableRecords: parameterTables.reduce((sum, table) => sum + table.entryCount, 0),
      unresolvedSourceWrites: unresolvedWrites.length,
      assetPolicy: 'Metadata only: no ROM bytes, decoded graphics, audio, or text payloads are embedded.',
    },
  };
}

function annotateMap(mapData, catalog) {
  const refsByRegion = new Map();
  const tableRefsByRegion = new Map();
  const missingRegions = [];

  for (const write of catalog.writes) {
    let region = write.region?.id ? findRegionById(mapData, write.region.id) : null;
    if (!region && write.labelOffset) region = findContainingRegion(mapData, parseInt(write.labelOffset, 16));
    if (!region) {
      missingRegions.push({ writeId: write.id, label: write.label, labelOffset: write.labelOffset, line: write.line });
      continue;
    }
    if (!refsByRegion.has(region.id)) refsByRegion.set(region.id, { region, refs: [] });
    refsByRegion.get(region.id).refs.push(compactWriteRef(write));
  }

  for (const table of catalog.parameterTables || []) {
    let region = table.region?.id ? findRegionById(mapData, table.region.id) : null;
    if (!region) region = findContainingRegion(mapData, parseInt(table.offset, 16));
    if (!region) {
      missingRegions.push({ tableId: table.id, label: table.label, offset: table.offset });
      continue;
    }
    if (!tableRefsByRegion.has(region.id)) tableRefsByRegion.set(region.id, { region, refs: [] });
    tableRefsByRegion.get(region.id).refs.push(compactParameterTableRef(table));
  }

  const consumerRegion = findContainingRegion(mapData, 0x00792);
  if (consumerRegion) {
    if (!refsByRegion.has(consumerRegion.id)) refsByRegion.set(consumerRegion.id, { region: consumerRegion, refs: [] });
  }

  const annotatedRegions = [];
  const regionIds = new Set([...refsByRegion.keys(), ...tableRefsByRegion.keys()]);
  for (const regionId of regionIds) {
    const region = refsByRegion.get(regionId)?.region || tableRefsByRegion.get(regionId)?.region;
    const refs = refsByRegion.get(regionId)?.refs || [];
    const tableRefs = tableRefsByRegion.get(regionId)?.refs || [];
    region.analysis = region.analysis || {};
    const existing = region.analysis.animationTileBaseAudit || {};
    const existingRefs = (existing.tileBaseWrites || []).filter(ref => ref.catalogId !== catalogId);
    const existingTables = (existing.parameterTables || []).filter(ref => ref.catalogId !== catalogId);
    const isConsumer = offsetOf(region) <= 0x00792 && 0x00792 < offsetOf(region) + (region.size || 0);
    const isParameterTable = tableRefs.length > 0;
    region.analysis.animationTileBaseAudit = {
      kind: isConsumer
        ? 'animation_tile_base_consumer_and_writer_region'
        : isParameterTable && refs.length === 0
          ? 'animation_tile_base_parameter_table_region'
          : 'animation_tile_base_writer_region',
      catalogId,
      confidence: refs.some(ref => ref.confidence === 'medium') || tableRefs.some(ref => ref.confidence === 'medium') ? 'medium' : 'high',
      summary: isConsumer
        ? 'Region contains the _LABEL_792_ frame renderer that adds IX+63 to frame tile bytes before OAM output.'
        : isParameterTable && refs.length === 0
          ? 'Region contains a table whose selected parameter bytes supply actor tile-base and animation selector fields.'
        : 'Region writes the actor-slot tile-base field consumed by _LABEL_792_ frame rendering.',
      tileBaseWrites: [...existingRefs, ...refs.map(ref => ({ ...ref, catalogId }))].slice(0, 64),
      parameterTables: [...existingTables, ...tableRefs].slice(0, 16),
      consumer: isConsumer ? {
        label: '_LABEL_792_',
        offset: '0x00792',
        field: 'IX+63',
        behavior: 'Adds IX+63 to each frame-stream tile byte before writing the OAM tile id.',
      } : null,
      evidence: [
        '_LABEL_792_ adds (IX+63) to each frame-stream tile byte before writing OAM tile ids.',
        'Writer entries are derived from ASM stores to (IX+63), _RAM_C2BF_, and _RAM_C3FF_.',
        'Catalog and annotations store metadata only; no ROM bytes or decoded graphics are embedded.',
      ],
      generatedAt: now,
      tool: toolName,
    };
      annotatedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type || 'unknown',
      name: region.name || '',
      tileBaseWriteRefs: refs.length,
      parameterTableRefs: tableRefs.length,
      consumer: isConsumer,
    });
  }

  return { annotatedRegions, missingRegions };
}

function main() {
  const mapData = readJson(mapPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const catalog = buildCatalog(mapData, asmText);
  let annotation = { annotatedRegions: [], missingRegions: [] };

  if (apply) {
    annotation = annotateMap(mapData, catalog);
    const finalCatalog = buildCatalog(mapData, asmText);
    mapData.animationTileBaseCatalogs = (mapData.animationTileBaseCatalogs || []).filter(item => item.id !== catalogId);
    mapData.animationTileBaseCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'animation_tile_base_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      sourceCatalogs: finalCatalog.sourceCatalogs,
      summary: {
        ...finalCatalog.summary,
        annotatedRegions: annotation.annotatedRegions.length,
        missingRegions: annotation.missingRegions.length,
      },
      semantics: finalCatalog.semantics,
      summaries: finalCatalog.summaries,
      writerSamples: finalCatalog.writes.slice(0, 48),
      annotatedRegions: annotation.annotatedRegions,
      missingRegions: annotation.missingRegions,
      nextLeads: [
        'Link room entity records back to byte-5 tile-base values so root-2 behavior families can render with the correct sprite tile offset.',
        'Trace the fixed root-4 tile base 0x76 back to the VRAM loader stream that uploads its graphics into the local synthetic VRAM state.',
        'Use tile-base provenance with frame subrecords to build a browser-local metasprite preview that reports unresolved tile slots instead of guessing.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    summaries: catalog.summaries,
    annotatedRegions: annotation.annotatedRegions.length,
    missingRegions: annotation.missingRegions.length,
  }, null, 2));
}

main();
