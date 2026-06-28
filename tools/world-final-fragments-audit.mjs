#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const romPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).sms');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-24T00:00:00Z';
const catalogId = 'world-final-fragments-catalog-2026-06-24';
const reportId = 'final-fragments-audit-2026-06-24';

const FRAGMENTS = [
  {
    offset: 0x00479,
    inferredType: 'data_table',
    confidence: 'high',
    role: 'scroll_state_byte_table',
    summary: 'Eight-byte table indexed by (_RAM_CF54_ & $07) and copied back into _RAM_CF54_.',
    allowRetypeFrom: ['unknown', 'raw_byte'],
    evidence: [
      '_LABEL_3F8_ masks _RAM_CF54_ with $07, adds the result to _DATA_479_, reads one byte, and stores it back into _RAM_CF54_.',
      'The same index selects the adjacent _DATA_481_ word table that initializes _RAM_CF52_.',
    ],
  },
  {
    offset: 0x00C94,
    inferredType: 'code',
    confidence: 'medium',
    role: 'input_script_playback_helper',
    summary: 'Instruction-shaped helper block that updates input playback state and terminates with RET.',
    allowRetypeFrom: ['unknown'],
    evidence: [
      'ASM emits a 79-byte unlabeled block between _LABEL_C4D_ and _LABEL_CE3_; the bytes decode as Z80 instructions that read _RAM_D225_, _RAM_D226_, _RAM_D279_, _RAM_CF91_, _RAM_CF95_, and update _RAM_CFEE_/_RAM_CFF0_.',
      'The decoded block ends with RET and shares the same input-script RAM variables as _LABEL_BFD_ and _LABEL_C4D_.',
    ],
  },
  {
    offset: 0x0112B,
    inferredType: 'code',
    confidence: 'medium',
    role: 'unlabeled_arithmetic_helper',
    summary: 'Prior screen_prog inference is replaced by a code classification: the block decodes as a compact arithmetic helper and ends with RET.',
    allowRetypeFrom: ['unknown', 'screen_prog'],
    evidence: [
      'ASM emits a 25-byte unlabeled block at 0x0112B; the bytes decode as a Z80 routine beginning with LD HL,$0000 and ending with RET.',
      'No ASM call site passes this offset to _LABEL_604_, while the byte shape does not match a screen/name-table script.',
    ],
  },
  {
    offset: 0x0115C,
    inferredType: 'data_table',
    confidence: 'high',
    role: 'collision_out_of_bounds_tile_constant',
    summary: 'Single-byte fallback tile/collision value returned by _LABEL_1144_ when coordinates are outside the valid room range.',
    allowRetypeFrom: ['unknown', 'raw_byte'],
    evidence: [
      '_LABEL_1144_ jumps to _DATA_115C_, loads its single byte through HL, and returns when E is outside $10-$BF or H is beyond _RAM_D01A_.',
      'The byte is consumed as a return value, not executed and not decoded as screen/name-table bytecode.',
    ],
  },
  {
    offset: 0x012B9,
    inferredType: 'tile_map',
    confidence: 'high',
    role: 'collision_vdp_patch_tile_map',
    summary: 'Sixteen-byte 4x4 tile fragment written directly to VDP by _LABEL_126C_ with attribute $09.',
    allowRetypeFrom: ['unknown', 'screen_prog'],
    evidence: [
      '_LABEL_126C_ loads HL with _DATA_12B9_, then writes four rows of four bytes through RST $30 to VDP.',
      'Each tile byte is followed by attribute $09, and the routine never passes _DATA_12B9_ to the _LABEL_604_ screen_prog decoder.',
    ],
  },
  {
    offset: 0x0117A,
    inferredType: 'code',
    confidence: 'medium',
    role: 'collision_tile_write_helper',
    summary: 'Instruction-shaped block adjacent to collision/tile routines; jumps into _LABEL_11FF_.',
    allowRetypeFrom: ['unknown'],
    evidence: [
      'ASM emits a 19-byte unlabeled block immediately before _LABEL_118D_; the bytes decode as Z80 instructions that mask HL/DE tile coordinates, call _LABEL_1144_, read _RAM_CF64_, and jump to _LABEL_11FF_.',
      '_LABEL_118D_ and _LABEL_11FF_ are collision/tile update code using the same RAM variables and coordinate masks.',
    ],
  },
  {
    offset: 0x023D1,
    inferredType: 'tile_map',
    confidence: 'high',
    role: 'transition_vdp_tile_fragment_a',
    summary: 'Sixteen-byte 4x4 tile fragment selected by _LABEL_2324_ and written directly to VDP with attribute $01.',
    allowRetypeFrom: ['unknown', 'screen_prog'],
    evidence: [
      '_LABEL_2324_ loads HL with _DATA_23D1_ by default, then writes four rows of four bytes through RST $30.',
      'The routine writes attribute $01 after each tile byte and does not call _LABEL_604_ for this data.',
    ],
  },
  {
    offset: 0x023E1,
    inferredType: 'tile_map',
    confidence: 'high',
    role: 'transition_vdp_tile_fragment_b',
    summary: 'Alternative sixteen-byte 4x4 tile fragment selected by _LABEL_2324_ when _RAM_CF5B_ is at least $05.',
    allowRetypeFrom: ['unknown', 'screen_prog'],
    evidence: [
      '_LABEL_2324_ switches HL from _DATA_23D1_ to _DATA_23E1_ when _RAM_CF5B_ >= $05.',
      'The selected table is written as four rows of four tile bytes with attribute $01 through the direct VDP write path.',
    ],
  },
  {
    offset: 0x1071A,
    inferredType: 'pointer_table',
    confidence: 'high',
    role: 'bank4_c34e_pointer_table',
    summary: 'Eight-entry pointer table indexed by _RAM_C34E_; targets include banked data records and RAM-buffer sentinels.',
    allowRetypeFrom: ['unknown', 'raw_byte'],
    evidence: [
      'ASM identifies _DATA_1071A_ as "Pointer Table from 1071A to 10729 (8 entries, indexed by _RAM_C34E_)".',
      'The table entries point to _DATA_19B01_, _DATA_1A1B0_, _DATA_1B486_, _DATA_1AA51_, _DATA_18585_, and two RAM-buffer sentinel expressions.',
    ],
  },
  {
    offset: 0x1C270,
    inferredType: 'pointer_table',
    confidence: 'high',
    role: 'bank7_tile_fragment_pointer_table_prefix',
    summary: 'Pointer-table prefix used with the following _DATA_1C272_ table by _LABEL_3655_ and _LABEL_36A6_.',
    allowRetypeFrom: ['unknown', 'raw_byte'],
    evidence: [
      'ASM identifies _DATA_1C270_ as a one-entry pointer table pointing to _DATA_1C298_.',
      '_LABEL_3655_ indexes from _DATA_1C270_; _LABEL_36A6_ indexes from _DATA_1C270_ + 2, which is the adjacent _DATA_1C272_ pointer table.',
    ],
  },
  {
    offset: 0x037C5,
    inferredType: 'code',
    confidence: 'medium',
    role: 'menu_vdp_write_helper',
    summary: 'Instruction-shaped VDP/menu helper block that calls _LABEL_3713_ and then continues into the local _LABEL_3796_ branch target.',
    allowRetypeFrom: ['unknown'],
    evidence: [
      'ASM emits a 27-byte unlabeled block inside the _LABEL_3796_ area; the bytes decode as HL/DE setup, CALL _LABEL_3713_, more pointer adjustment, and JP _LABEL_3713_.',
      'The following local branch target in _LABEL_3796_ performs the same VDP/menu update flow before _LABEL_37F8_.',
    ],
  },
  {
    offset: 0x037E0,
    inferredType: 'code',
    confidence: 'high',
    role: 'menu_vdp_branch_target',
    summary: 'Local branch target of _LABEL_3796_ that updates menu/status VDP state.',
    allowRetypeFrom: ['unknown'],
    evidence: [
      '_LABEL_3796_ branches to the local +++ target immediately before _LABEL_37F8_; the bytes at 0x037E0 decode as that target body.',
      'The block calls _LABEL_382E_, reads _RAM_D117_/_RAM_D11C_, and falls into the _LABEL_37F8_ rendering helper.',
    ],
  },
  {
    offset: 0x03A9D,
    inferredType: 'code',
    confidence: 'medium',
    role: 'menu_vdp_tail_helper',
    summary: 'Instruction-shaped VDP/menu helper that jumps to _LABEL_3713_.',
    allowRetypeFrom: ['unknown'],
    evidence: [
      'ASM emits an 11-byte unlabeled block before _LABEL_3AA8_; the bytes decode as LD HL,$3D48, LD DE,$0920, LD B,$04, JP _LABEL_3713_.',
      'Nearby menu/status routines call _LABEL_3AA8_ and use _LABEL_3713_ for the same VDP write path.',
    ],
  },
  {
    offset: 0x03FFE,
    inferredType: 'text',
    confidence: 'high',
    role: 'status_text_tile_fragment',
    summary: 'First two bytes of a three-byte tile/text fragment written directly to VDP by _LABEL_3FB1_.',
    allowRetypeFrom: ['unknown'],
    evidence: [
      '_LABEL_3FB1_ loads HL with _DATA_3FFE_, sets VDP address $7930, then writes three tile bytes with the current attribute.',
      'The third byte is the adjacent 0x04000 bank-boundary fragment.',
    ],
  },
  {
    offset: 0x04000,
    inferredType: 'text',
    confidence: 'high',
    role: 'status_text_tile_fragment_tail',
    summary: 'Third byte of the _DATA_3FFE_ tile/text fragment consumed by _LABEL_3FB1_.',
    allowRetypeFrom: ['unknown'],
    evidence: [
      '_LABEL_3FB1_ writes three bytes starting at _DATA_3FFE_; because the stream crosses the bank boundary, the final byte is the 0x04000 fragment.',
    ],
  },
  {
    offset: 0x04001,
    inferredType: 'screen_prog',
    confidence: 'high',
    role: 'password_prompt_screen_prog_start',
    summary: 'Screen/name-table bytecode passed to _LABEL_604_ by _LABEL_3F5F_.',
    allowRetypeFrom: ['unknown', 'screen_prog'],
    evidence: [
      '_LABEL_3F5F_ loads BC with _DATA_4001_ and calls _LABEL_604_.',
      'The _LABEL_604_ decoder consumes the split bytecode stream through the 0x0400E terminator.',
    ],
  },
  {
    offset: 0x04002,
    inferredType: 'screen_prog',
    confidence: 'high',
    role: 'password_prompt_screen_prog_operand',
    summary: 'Operand byte inside the _DATA_4001_ screen/name-table bytecode stream.',
    allowRetypeFrom: ['unknown'],
    evidence: [
      '_LABEL_604_ consumes this byte as part of the _DATA_4001_ screen/name-table bytecode stream started at 0x04001.',
    ],
  },
  {
    offset: 0x04003,
    inferredType: 'screen_prog',
    confidence: 'high',
    role: 'password_prompt_screen_prog_operand_and_attr',
    summary: 'Split operand/attribute bytes inside the _DATA_4001_ screen/name-table bytecode stream.',
    allowRetypeFrom: ['unknown'],
    evidence: [
      '_LABEL_604_ consumes these bytes as part of the _DATA_4001_ screen/name-table bytecode stream started at 0x04001.',
    ],
  },
  {
    offset: 0x04005,
    inferredType: 'screen_prog',
    confidence: 'high',
    role: 'password_prompt_screen_prog_attr_operand',
    summary: 'Attribute operand inside the _DATA_4001_ screen/name-table bytecode stream.',
    allowRetypeFrom: ['unknown'],
    evidence: [
      '_LABEL_604_ consumes this byte as the attribute operand in the _DATA_4001_ screen/name-table bytecode stream.',
    ],
  },
  {
    offset: 0x04006,
    inferredType: 'screen_prog',
    confidence: 'high',
    role: 'password_prompt_screen_prog_tile_run_head',
    summary: 'First direct tile/text byte in the _DATA_4001_ screen/name-table bytecode stream.',
    allowRetypeFrom: ['unknown'],
    evidence: [
      '_LABEL_604_ consumes this byte as a direct tile write after the address and attribute commands in the _DATA_4001_ stream.',
    ],
  },
  {
    offset: 0x04007,
    inferredType: 'screen_prog',
    confidence: 'high',
    role: 'password_prompt_screen_prog_tile_run_tail',
    summary: 'Direct tile/text run and terminator inside the _DATA_4001_ screen/name-table bytecode stream.',
    allowRetypeFrom: ['unknown'],
    evidence: [
      '_LABEL_604_ consumes this region as the tail of the direct tile run and reaches the screen_prog terminator at 0x0400E.',
    ],
  },
  {
    offset: 0x04740,
    inferredType: 'data_table',
    confidence: 'high',
    role: 'timed_effect_sequence_table',
    summary: 'Three two-byte entries consumed by _LABEL_468D_ as effect/sound ids paired with delay counts.',
    allowRetypeFrom: ['unknown', 'screen_prog'],
    evidence: [
      '_LABEL_468D_ loops three times over _DATA_4740_, reads the first byte of each pair into _LABEL_5EB_, then reads the second byte into B before calling _LABEL_46C9_.',
      'The table is consumed as timed control data and is never passed to the _LABEL_604_ screen_prog decoder.',
    ],
  },
  {
    offset: 0x04BF8,
    inferredType: 'data_table',
    confidence: 'high',
    role: 'player_form_velocity_pointer_table',
    summary: 'Word table indexed by player/form state and copied into _RAM_C248_.',
    allowRetypeFrom: ['unknown'],
    evidence: [
      '_LABEL_4B31_ loads HL with _DATA_4BF8_, indexes it with RST $08/RST $18, and stores the selected word in _RAM_C248_.',
    ],
  },
  {
    offset: 0x04C08,
    inferredType: 'data_table',
    confidence: 'high',
    role: 'player_form_velocity_pointer_table_tail',
    summary: 'Continuation/child of the _DATA_4BF8_ word table, also referenced from the bank-7 pointer table at _DATA_1DB6C_.',
    allowRetypeFrom: ['unknown'],
    evidence: [
      '_LABEL_4B31_ can index from _DATA_4BF8_ into this contiguous table tail.',
      'ASM identifies _DATA_4C08_ as a child entry of the pointer table at _DATA_1DB6C_.',
    ],
  },
  {
    offset: 0x058B5,
    inferredType: 'data_table',
    confidence: 'high',
    role: 'entity_vertical_motion_sequence',
    summary: 'Terminated byte sequence used to update an entity vertical/motion field.',
    allowRetypeFrom: ['unknown'],
    evidence: [
      '_LABEL_583D_ stores _DATA_58B5_ in IX+42/IX+43.',
      '_LABEL_5882_ reads one byte per update from that pointer, loops back to _DATA_58B5_ on $80, and writes the value to IX+11.',
    ],
  },
  {
    offset: 0x05C2A,
    inferredType: 'data_table',
    confidence: 'high',
    role: 'palette_buffer_seed',
    summary: 'Thirty-two-byte palette-buffer seed copied to _RAM_CFBB_ by _LABEL_5BDD_ before palette buffer overlays are applied.',
    allowRetypeFrom: ['unknown', 'screen_prog'],
    evidence: [
      '_LABEL_5BDD_ copies 32 bytes from _DATA_5C2A_ to _RAM_CFBB_ with LDIR, then overlays selected bytes from _RAM_CF9B_ and _RAM_CFAB_ into palette buffers.',
      'The routine toggles _RAM_CFE2_ and waits through _LABEL_FEE_; no call path passes _DATA_5C2A_ to _LABEL_604_.',
    ],
  },
  {
    offset: 0x05DE2,
    inferredType: 'data_table',
    confidence: 'high',
    role: 'entity_value_word_table',
    summary: 'Sixteen two-byte values indexed by _LABEL_5D6A_ from entity state and room context.',
    allowRetypeFrom: ['unknown', 'screen_prog'],
    evidence: [
      '_LABEL_5D6A_ masks IX+62, optionally offsets the index when _RAM_CF66_ is $07, then indexes _DATA_5DE2_ through RST $08/RST $10.',
      'The selected value is combined with _LABEL_D36_ output and stored in IX+34, proving this is entity control data rather than screen_prog bytecode.',
    ],
  },
  {
    offset: 0x063E2,
    inferredType: 'data_table',
    confidence: 'high',
    role: 'entity_spawn_value_table',
    summary: 'Thirty-one-byte table indexed during entity/spawn setup before storing the selected value in _RAM_D025_.',
    allowRetypeFrom: ['unknown', 'screen_prog'],
    evidence: [
      'The routine immediately before _LABEL_6401_ indexes _DATA_63E2_ with an entity-derived counter after checking _RAM_D1EB_.',
      'The selected byte is stored in _RAM_D025_; this direct table lookup does not use the _LABEL_604_ screen_prog decoder.',
    ],
  },
  {
    offset: 0x064C5,
    inferredType: 'data_table',
    confidence: 'high',
    role: 'entity_motion_sequence',
    summary: 'Terminated entity motion byte sequence used by _LABEL_6401_/_LABEL_6498_ to update IX+9.',
    allowRetypeFrom: ['unknown', 'screen_prog'],
    evidence: [
      '_LABEL_6401_ stores _DATA_64C5_ into IX+24/IX+25 for active entity state.',
      '_LABEL_6498_ reads one byte per update from that pointer, loops back to _DATA_64C5_ on $80, and writes the value to IX+9.',
    ],
  },
  {
    offset: 0x069BC,
    inferredType: 'data_table',
    confidence: 'medium',
    role: 'entity_state_pointer_seed',
    summary: 'Two-byte entity state/table seed stored in IX+38/IX+39 before animation/state initialization.',
    allowRetypeFrom: ['unknown'],
    evidence: [
      '_LABEL_6974_ loads HL with _DATA_69BC_ and jumps to _LABEL_69E1_, which stores HL in IX+38/IX+39 and calls _LABEL_1318_.',
      'Adjacent routines use the same IX+38/IX+39 setup pattern with nearby small data tables before calling _LABEL_1318_.',
    ],
  },
  {
    offset: 0x0B841,
    inferredType: 'code',
    confidence: 'high',
    role: 'jump_table_dispatch_tail',
    summary: 'Executable dispatch code between two jump tables in the _LABEL_B82E_ routine.',
    allowRetypeFrom: ['unknown'],
    evidence: [
      '_LABEL_B82E_ emits RST $20 over the 0x0B839 jump table, then the local + branch at 0x0B841 loads IX+48 and dispatches through the 0x0B845 jump table.',
    ],
  },
  {
    offset: 0x0C01A,
    inferredType: 'code',
    confidence: 'high',
    role: 'fm_psg_init_loop_tail',
    summary: 'Middle of the _LABEL_C000_ FM/PSG initialization routine split out as an unknown fragment.',
    allowRetypeFrom: ['unknown'],
    evidence: [
      '_LABEL_C000_ initializes FM registers from _DATA_C02D_; bytes at 0x0C01A contain the DJNZ loop tail and PSG mute writes before RET.',
      '_LABEL_105C_ bank-switches to bank 3 and calls _LABEL_C000_ for sound initialization.',
    ],
  },
];

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function findContainingRegion(mapData, offset) {
  return mapData.regions.find(region => {
    const start = parseInt(region.offset, 16);
    return offset >= start && offset < start + (region.size || 0);
  }) || null;
}

function byteStats(rom, offset, size) {
  const bytes = rom.subarray(offset, offset + size);
  let zeros = 0;
  let ff = 0;
  let high = 0;
  for (const byte of bytes) {
    if (byte === 0) zeros++;
    if (byte === 0xFF) ff++;
    if (byte >= 0x80) high++;
  }
  return {
    size,
    zeroBytes: zeros,
    ffBytes: ff,
    highBitBytes: high,
    zeroRatio: Number((zeros / Math.max(1, size)).toFixed(4)),
    highBitRatio: Number((high / Math.max(1, size)).toFixed(4)),
  };
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

function screenProgVisitedShape(rom, startOffset) {
  const visited = [];
  const ops = [];
  let pc = startOffset;
  let endOffset = null;
  for (let i = 0; i < 64 && pc < rom.length; i++) {
    const opOffset = pc;
    const b = rom[pc++];
    visited.push(opOffset);
    if (b < 0xF0) {
      ops.push({ kind: 'tile', offset: hex(opOffset) });
      continue;
    }
    const kind = b & 0x07;
    if (kind === 0) {
      ops.push({ kind: 'end', offset: hex(opOffset) });
      endOffset = opOffset;
      break;
    }
    const lengths = { 1: 2, 2: 3, 3: 2, 4: 3, 5: 3, 6: 3, 7: 2 };
    const len = lengths[kind] || 1;
    for (let j = 1; j < len && pc < rom.length; j++) {
      visited.push(pc++);
    }
    ops.push({
      kind: ['end', 'attr', 'addr', 'literal', 'jump', 'fill', 'call', 'delay'][kind] || 'command',
      offset: hex(opOffset),
      length: len,
    });
  }
  return {
    startOffset: hex(startOffset),
    endOffset: endOffset == null ? null : hex(endOffset),
    visitedRange: visited.length ? { start: hex(Math.min(...visited)), endInclusive: hex(Math.max(...visited)) } : null,
    visitedCount: visited.length,
    opShape: ops,
  };
}

function buildCatalog(rom, mapData) {
  const screenProg4001 = screenProgVisitedShape(rom, 0x04001);
  const entries = FRAGMENTS.map(def => {
    const region = findContainingRegion(mapData, def.offset);
    const start = region ? parseInt(region.offset, 16) : def.offset;
    const size = region?.size || 0;
    const detail = {};
    if (def.offset >= 0x04001 && def.offset <= 0x0400E) {
      detail.screenProgShape = screenProg4001;
    }
    return {
      id: def.role + '_' + def.offset.toString(16).toUpperCase(),
      offset: hex(def.offset),
      inferredType: def.inferredType,
      confidence: def.confidence,
      role: def.role,
      summary: def.summary,
      region: regionRef(region),
      byteStats: region ? byteStats(rom, start, size) : null,
      evidence: def.evidence,
      detail,
    };
  });
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-final-fragments-audit.mjs',
    entries,
    summary: {
      auditedOffsets: entries.length,
      missingRegions: entries.filter(entry => !entry.region).length,
      typeCounts: entries.reduce((counts, entry) => {
        counts[entry.inferredType] = (counts[entry.inferredType] || 0) + 1;
        return counts;
      }, {}),
      confidenceCounts: entries.reduce((counts, entry) => {
        counts[entry.confidence] = (counts[entry.confidence] || 0) + 1;
        return counts;
      }, {}),
      assetPolicy: 'Metadata only: offsets, classifications, byte statistics, control-flow evidence, and decoder shape summaries. No ROM bytes or decoded copyrighted assets are embedded.',
    },
  };
}

function fragmentDefByOffset(offset) {
  return FRAGMENTS.find(def => def.offset === offset) || null;
}

function shouldChange(region, entry) {
  const currentType = region.type || 'unknown';
  if (currentType === entry.inferredType) return false;
  const offset = parseInt(entry.offset, 16);
  const def = fragmentDefByOffset(offset);
  const allowed = def?.allowRetypeFrom || ['unknown'];
  return allowed.includes(currentType);
}

function annotateRegion(region, entry) {
  const previousType = region.type || 'unknown';
  const changedType = shouldChange(region, entry);
  if (changedType) region.type = entry.inferredType;
  region.analysis = region.analysis || {};
  const existing = region.analysis.finalFragmentAudit || {};
  region.analysis.finalFragmentAudit = {
    kind: entry.role,
    summary: entry.summary,
    confidence: entry.confidence,
    typeBeforeAudit: existing.typeBeforeAudit || previousType,
    typeAfterAudit: region.type,
    changedType: existing.changedType || changedType,
    catalogId,
    detail: {
      auditedOffset: entry.offset,
      inferredType: entry.inferredType,
      byteStats: entry.byteStats,
      ...entry.detail,
    },
    evidence: entry.evidence,
    generatedAt: now,
    tool: 'tools/world-final-fragments-audit.mjs',
  };
  return changedType;
}

function annotateMap(mapData, catalog) {
  const changedRegions = [];
  const evidenceOnlyRegions = [];
  const missingRegions = [];
  const blockedRegions = [];
  for (const entry of catalog.entries) {
    const region = entry.region ? mapData.regions.find(r => r.id === entry.region.id) : null;
    if (!region) {
      missingRegions.push({ offset: entry.offset, inferredType: entry.inferredType, role: entry.role });
      continue;
    }
    const wouldChange = shouldChange(region, entry);
    const currentType = region.type || 'unknown';
    if (!apply) {
      const target = wouldChange ? changedRegions : (currentType === entry.inferredType ? evidenceOnlyRegions : blockedRegions);
      target.push({
        id: region.id,
        offset: region.offset,
        name: region.name || '',
        currentType,
        inferredType: entry.inferredType,
        confidence: entry.confidence,
        role: entry.role,
      });
      continue;
    }
    const previousType = currentType;
    const changed = annotateRegion(region, entry);
    const target = changed ? changedRegions : (region.type === entry.inferredType ? evidenceOnlyRegions : blockedRegions);
    target.push({
      id: region.id,
      offset: region.offset,
      name: region.name || '',
      previousType,
      type: region.type || 'unknown',
      inferredType: entry.inferredType,
      confidence: entry.confidence,
      role: entry.role,
    });
  }
  return { changedRegions, evidenceOnlyRegions, missingRegions, blockedRegions };
}

function collectConfirmedChangedRegions(mapData) {
  return mapData.regions
    .filter(region => region.analysis?.finalFragmentAudit?.catalogId === catalogId && region.analysis.finalFragmentAudit.changedType)
    .map(region => ({
      id: region.id,
      offset: region.offset,
      name: region.name || '',
      previousType: region.analysis.finalFragmentAudit.typeBeforeAudit || 'unknown',
      type: region.type || 'unknown',
      kind: region.analysis.finalFragmentAudit.kind,
      confidence: region.analysis.finalFragmentAudit.confidence,
    }));
}

function main() {
  const rom = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(rom, mapData);
  const annotation = annotateMap(mapData, catalog);

  if (apply) {
    const finalCatalog = buildCatalog(rom, mapData);
    const confirmedChangedRegions = collectConfirmedChangedRegions(mapData);
    mapData.fragmentCatalogs = (mapData.fragmentCatalogs || []).filter(c => c.id !== catalogId);
    mapData.fragmentCatalogs.push(finalCatalog);

    mapData.analysisReports = (mapData.analysisReports || []).filter(r => r.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'final_fragments_audit',
      generatedAt: now,
      tool: 'tools/world-final-fragments-audit.mjs --apply',
      schemaVersion: 1,
      summary: {
        ...finalCatalog.summary,
        changedRegionTypes: confirmedChangedRegions.length,
        changedRegionTypesThisRun: annotation.changedRegions.length,
        evidenceOnlyRegions: annotation.evidenceOnlyRegions.length,
        blockedRegions: annotation.blockedRegions.length,
        missingRegions: annotation.missingRegions.length,
      },
      changedRegions: confirmedChangedRegions,
      changedRegionsThisRun: annotation.changedRegions,
      evidenceOnlyRegions: annotation.evidenceOnlyRegions,
      blockedRegions: annotation.blockedRegions,
      missingRegions: annotation.missingRegions,
      entries: finalCatalog.entries,
      nextLeads: [
        'Trace the medium-confidence unlabeled code islands at 0x00C94, 0x0112B, 0x0117A, 0x037C5, and 0x03A9D to concrete callers or prove they are orphaned routines.',
        'Split the 0x04001 screen_prog bytecode stream into subrecords in tooling so command operands and direct tile runs are visible without changing ROM bytes.',
        'Use the now-zero unknown-region list to drive semantic coverage reports: asset class completeness, unresolved mixed regions, and behavior/RAM-variable coverage.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    changedRegionTypes: annotation.changedRegions.length,
    changedRegions: annotation.changedRegions,
    evidenceOnlyRegions: annotation.evidenceOnlyRegions,
    blockedRegions: annotation.blockedRegions,
    missingRegions: annotation.missingRegions,
  }, null, 2));
}

main();
