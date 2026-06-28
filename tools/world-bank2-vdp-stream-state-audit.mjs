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
const now = '2026-06-25T00:00:00Z';
const catalogId = 'world-bank2-vdp-stream-state-catalog-2026-06-25';
const reportId = 'bank2-vdp-stream-state-audit-2026-06-25';
const toolName = 'tools/world-bank2-vdp-stream-state-audit.mjs';

const bundleOffset = 0x09AE0;
const bundleEndInclusive = 0x0B3BF;
const rootCount = 6;

const setupStates = [
  {
    index: 0,
    regionId: 'r1866',
    label: '_LABEL_8026_',
    role: 'bank2_stream_state_0_setup',
    name: '_LABEL_8026_ bank-2 stream state 0 setup',
    confidence: 'high',
    summary: 'Initializes bank-2 stream state 0 by selecting _DATA_9AE0_ root-table entry 0 and storing the selected subtable pointer in _RAM_D15A_.',
    evidence: [
      'ASM lines 16376-16384 load A=0, HL=_DATA_9AE0_, use RST $08/RST $10, and store DE in _RAM_D15A_.',
      'ASM lines 16390-16404 clear _RAM_D15D_, set _RAM_D17F_, then call _LABEL_96FE_ and _LABEL_978E_.',
    ],
  },
  {
    index: 1,
    regionId: 'r2464',
    label: '_LABEL_82A7_',
    role: 'bank2_stream_state_1_setup',
    name: '_LABEL_82A7_ bank-2 stream state 1 setup',
    confidence: 'high',
    summary: 'Initializes bank-2 stream state 1 by selecting _DATA_9AE0_ root-table entry 1 and storing the selected subtable pointer in _RAM_D15A_.',
    evidence: [
      'ASM lines 16693-16700 load A=1, HL=0x9AE0, use RST $08/RST $10, and store DE in _RAM_D15A_.',
      'ASM lines 16726-16730 clear _RAM_D15D_, set _RAM_D17F_ bit 0, and call the stream/update path.',
    ],
  },
  {
    index: 2,
    regionId: 'r2483',
    label: '_LABEL_8682_',
    role: 'bank2_stream_state_2_setup',
    name: '_LABEL_8682_ bank-2 stream state 2 setup',
    confidence: 'high',
    summary: 'Initializes bank-2 stream state 2 by selecting _DATA_9AE0_ root-table entry 2 and storing the selected subtable pointer in _RAM_D15A_.',
    evidence: [
      'ASM lines 17232-17239 load A=2, HL=0x9AE0, use RST $08/RST $10, and store DE in _RAM_D15A_.',
      'ASM lines 17222-17225 call _LABEL_86D3_, _LABEL_96FE_, _LABEL_978E_, and the state-specific update routine after setup.',
    ],
  },
  {
    index: 3,
    regionId: 'r2495',
    label: '_LABEL_898F_',
    role: 'bank2_stream_state_3_setup',
    name: '_LABEL_898F_ bank-2 stream state 3 setup',
    confidence: 'high',
    summary: 'Initializes bank-2 stream state 3 by selecting _DATA_9AE0_ root-table entry 3 and storing the selected subtable pointer in _RAM_D15A_.',
    evidence: [
      'ASM lines 17624-17631 load A=3, HL=0x9AE0, use RST $08/RST $10, and store DE in _RAM_D15A_.',
      'ASM lines 17614-17617 call _LABEL_89DE_, _LABEL_96FE_, _LABEL_978E_, and the state-specific update routine after setup.',
    ],
  },
  {
    index: 4,
    regionId: 'r2511',
    label: '_LABEL_8D0D_',
    role: 'bank2_stream_state_4_setup',
    name: '_LABEL_8D0D_ bank-2 stream state 4 setup',
    confidence: 'high',
    summary: 'Initializes bank-2 stream state 4 by selecting _DATA_9AE0_ root-table entry 4 and storing the selected subtable pointer in _RAM_D15A_.',
    evidence: [
      'ASM lines 18068-18075 load A=4, HL=0x9AE0, use RST $08/RST $10, and store DE in _RAM_D15A_.',
      'ASM lines 18058-18061 call _LABEL_8D5C_, _LABEL_96FE_, _LABEL_978E_, and the state-specific update routine after setup.',
    ],
  },
  {
    index: 5,
    regionId: 'r2522',
    label: '_LABEL_901B_',
    role: 'bank2_stream_state_5_setup',
    name: '_LABEL_901B_ bank-2 stream state 5 setup',
    confidence: 'high',
    summary: 'Initializes bank-2 stream state 5 by selecting _DATA_9AE0_ root-table entry 5 and storing the selected subtable pointer in _RAM_D15A_.',
    evidence: [
      'ASM lines 18448-18455 load A=5, HL=0x9AE0, use RST $08/RST $10, and store DE in _RAM_D15A_.',
      'ASM lines 18439-18442 call _LABEL_90C6_, _LABEL_96FE_, _LABEL_978E_, and the state-specific update routine after setup.',
    ],
  },
];

const routines = [
  {
    regionId: 'r1865',
    label: '_LABEL_8000_',
    role: 'bank2_stream_state_dispatch',
    name: '_LABEL_8000_ bank-2 stream state dispatch',
    confidence: 'high',
    summary: 'Dispatches _RAM_D1AE_ through the six bank-2 stream states that use _DATA_9AE0_.',
    evidence: [
      'ASM lines 16345-16362 dispatch _RAM_D1AE_ through the six-entry jump table at _DATA_801A_.',
    ],
  },
  {
    regionId: 'r2580',
    label: '_LABEL_9980_',
    role: 'bank2_stream_object_list_consumer',
    name: '_LABEL_9980_ bank-2 stream object-list consumer',
    confidence: 'high',
    summary: 'Consumes records from the pointer stored in _RAM_D180_, copies each four-byte record to _RAM_D162_, and calls _LABEL_1D76_.',
    evidence: [
      'ASM lines 19794-19811 load HL from _RAM_D180_, copy one id plus three bytes into _RAM_D162_ and following bytes, and call _LABEL_1D76_.',
    ],
  },
  {
    regionId: 'r2581',
    label: '_LABEL_99A1_',
    role: 'bank2_stream_damage_object_consumer',
    name: '_LABEL_99A1_ bank-2 stream damage/object consumer',
    confidence: 'high',
    summary: 'Consumes records from the pointer stored in _RAM_D182_, drives _LABEL_1E4E_, and applies player/entity damage through _LABEL_1EC8_ when contact is detected.',
    evidence: [
      'ASM lines 19813-19829 load HL from _RAM_D182_, copy one id plus three bytes into _RAM_D162_ and following bytes, call _LABEL_1E4E_, and stop when IX bit 3 is set.',
      'ASM lines 19830-19851 call _LABEL_1EC8_ using _RAM_D17D_ and subtract the damage result from _RAM_D16A_.',
    ],
  },
  {
    regionId: 'r2583',
    label: '_LABEL_9A9F_',
    role: 'bank2_stream_hud_init',
    name: '_LABEL_9A9F_ bank-2 stream HUD initializer',
    confidence: 'high',
    summary: 'Draws the small HUD screen program at _DATA_9AA8_ and updates the _RAM_D16A_ display.',
    evidence: [
      'ASM lines 20024-20028 load BC with _DATA_9AA8_, call _LABEL_604_, then jump to _LABEL_9A44_.',
    ],
  },
];

const ramRoles = [
  ['$D15A', 'bank2_vdp_stream_root_subtable_pointer', 'Pointer to the selected _DATA_9AE0_ root subtable for the active bank-2 stream state.', 'high'],
  ['$D15D', 'bank2_vdp_stream_state_entry_index', 'Index into the active _RAM_D15A_ subtable, advanced by state-specific logic before _LABEL_96FE_ loads a stream record.', 'high'],
  ['$D15E', 'bank2_vdp_stream_delay_counter', 'Delay/countdown byte loaded by _LABEL_972B_ and decremented before resuming from _RAM_D170_.', 'high'],
  ['$D170', 'bank2_vdp_stream_resume_pointer', 'Resume pointer after the active _LABEL_972B_ stream-state record.', 'high'],
  ['$D172', 'bank2_vdp_stream_loop_pointer', 'Saved pointer used by F1/F2-style control flow in the _LABEL_972B_ stream interpreter.', 'medium'],
  ['$D174', 'bank2_vdp_stream_repeat_pointer', 'Saved pointer used with _RAM_D16F_ by the repeat control path in _LABEL_972B_.', 'medium'],
  ['$D176', 'bank2_vdp_stream_pointer_list', 'First pointer loaded from each stream-state record and consumed by _LABEL_97D9_/_LABEL_9812_ as VDP draw data.', 'high'],
  ['$D180', 'bank2_vdp_stream_object_list_pointer', 'Second pointer loaded from each stream-state record and consumed by _LABEL_9980_.', 'high'],
  ['$D182', 'bank2_vdp_stream_damage_object_list_pointer', 'Third pointer loaded from each stream-state record and consumed by _LABEL_99A1_.', 'high'],
  ['$D17F', 'bank2_vdp_stream_reload_flags', 'Control flags checked by _LABEL_96FE_; bit 7 forces subtable reload and bit 0 is set by some state setup paths.', 'medium'],
  ['$D162', 'bank2_stream_object_record_buffer', 'Temporary four-byte object/damage record buffer filled from _RAM_D180_/_RAM_D182_ streams.', 'high'],
  ['$D16A', 'bank2_stream_health_or_meter_word', 'Word decremented by _LABEL_99A1_ after damage lookup and displayed by _LABEL_9A44_.', 'medium'],
  ['$D17D', 'bank2_stream_contact_damage_index', 'Contact/damage index copied from player state and passed to _LABEL_1EC8_ by _LABEL_99A1_.', 'high'],
];

const pointerRoles = [
  {
    role: 'vdp_draw_pointer_list',
    destinationRam: '_RAM_D176_',
    consumer: '_LABEL_97D9_/_LABEL_9812_',
    summary: 'Pointer to the VDP draw pointer-list consumed by the stream renderer.',
  },
  {
    role: 'object_list_pointer',
    destinationRam: '_RAM_D180_',
    consumer: '_LABEL_9980_',
    summary: 'Pointer to object-list records copied into _RAM_D162_ and processed by _LABEL_1D76_.',
  },
  {
    role: 'damage_object_list_pointer',
    destinationRam: '_RAM_D182_',
    consumer: '_LABEL_99A1_',
    summary: 'Pointer to object/damage-list records copied into _RAM_D162_ and processed by _LABEL_1E4E_/_LABEL_1EC8_.',
  },
];

const controlOpcodes = {
  0xFF: {
    role: 'reload_from_subtable',
    handler: '_LABEL_9755_',
    operandBytes: 0,
    summary: 'Clears _RAM_D15E_ and sets _RAM_D17F_ bit 7 so the state reloads from the active subtable.',
  },
  0xFE: {
    role: 'loop_to_saved_pointer',
    handler: '_LABEL_9762_',
    operandBytes: 0,
    summary: 'Loads HL from _RAM_D172_ and resumes stream-state parsing.',
  },
  0xFD: {
    role: 'jump_pointer_and_save_loop',
    handler: '_LABEL_9767_',
    operandBytes: 2,
    summary: 'Reads a pointer with RST $18, saves the fall-through pointer in _RAM_D172_, and resumes parsing at the target.',
  },
  0xFC: {
    role: 'repeat_or_fallthrough',
    handler: '_LABEL_976D_',
    operandBytes: 0,
    summary: 'Decrements _RAM_D16F_; either falls through or resumes from _RAM_D174_.',
  },
  0xFB: {
    role: 'set_repeat_count_and_save_pointer',
    handler: '_LABEL_977B_',
    operandBytes: 1,
    summary: 'Reads one repeat-count byte into _RAM_D16F_, saves the following pointer in _RAM_D174_, and resumes parsing.',
  },
  0xFA: {
    role: 'delay_and_resume',
    handler: '_LABEL_9785_',
    operandBytes: 1,
    summary: 'Reads one delay byte into _RAM_D15E_, saves _RAM_D170_, and returns.',
  },
};

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readWord(rom, offset) {
  return rom[offset] | (rom[offset + 1] << 8);
}

function bank2Z80ToRom(z80Pointer) {
  return z80Pointer >= 0x8000 && z80Pointer < 0xC000 ? z80Pointer : null;
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function findRam(mapData, address) {
  return (mapData.ram || []).find(entry => (entry.address || '').toUpperCase() === address.toUpperCase()) || null;
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

function regionForOffset(mapData, offset) {
  return (mapData.regions || []).find(region => {
    const start = parseInt(region.offset, 16);
    return offset >= start && offset < start + (region.size || 0);
  }) || null;
}

function pointerRef(mapData, z80Pointer, role) {
  const romOffset = bank2Z80ToRom(z80Pointer);
  return {
    role: role.role,
    destinationRam: role.destinationRam,
    consumer: role.consumer,
    z80Pointer: hex(z80Pointer, 4),
    targetOffset: romOffset == null ? null : hex(romOffset),
    validBank2Pointer: romOffset != null,
    targetWithinBundle: romOffset != null && romOffset >= bundleOffset && romOffset <= bundleEndInclusive,
    targetRegion: romOffset == null ? null : regionRef(regionForOffset(mapData, romOffset)),
  };
}

function controlRef(rom, mapData, opcode, offset) {
  const def = controlOpcodes[opcode] || {
    role: 'unmapped_control_opcode',
    handler: null,
    operandBytes: 0,
    summary: 'Opcode is in the control range but has not been mapped to a local handler.',
  };
  const item = {
    opcode: hex(opcode, 2),
    offset: hex(offset),
    role: def.role,
    handler: def.handler,
    operandBytes: def.operandBytes,
    summary: def.summary,
  };
  if (opcode === 0xFD && offset + 2 < rom.length) {
    const z80Pointer = readWord(rom, offset + 1);
    const targetOffset = bank2Z80ToRom(z80Pointer);
    item.pointerOperand = {
      operandOffset: hex(offset + 1),
      z80Pointer: hex(z80Pointer, 4),
      targetOffset: targetOffset == null ? null : hex(targetOffset),
      validBank2Pointer: targetOffset != null,
      targetWithinBundle: targetOffset != null && targetOffset >= bundleOffset && targetOffset <= bundleEndInclusive,
      targetRegion: targetOffset == null ? null : regionRef(regionForOffset(mapData, targetOffset)),
    };
  } else if (def.operandBytes) {
    item.operand = {
      offset: hex(offset + 1),
      byteCount: def.operandBytes,
      valueStored: false,
      note: 'Operand byte value is intentionally not embedded; only the structure and destination role are recorded.',
    };
  }
  return item;
}

function decodeStateRecord(rom, mapData, offset) {
  const controls = [];
  const warnings = [];
  let pc = offset;

  for (let step = 0; step < 16; step++) {
    if (pc < bundleOffset || pc > bundleEndInclusive) {
      warnings.push(`state parser left _DATA_9AE0_ bundle at ${hex(pc)}`);
      return {
        recordOffset: hex(offset),
        kind: 'invalid',
        controls,
        warnings,
      };
    }

    const opcode = rom[pc];
    if (opcode < 0xF1) {
      if (pc + 6 >= rom.length) {
        warnings.push(`normal state record at ${hex(pc)} is truncated`);
        return {
          recordOffset: hex(offset),
          kind: 'invalid',
          controls,
          warnings,
        };
      }

      const pointers = pointerRoles.map((role, index) => pointerRef(mapData, readWord(rom, pc + 1 + index * 2), role));
      const invalidPointers = pointers.filter(pointer => !pointer.validBank2Pointer || !pointer.targetWithinBundle);
      if (invalidPointers.length) warnings.push(`${invalidPointers.length} pointer(s) do not resolve inside the bank-2 stream bundle`);
      return {
        recordOffset: hex(offset),
        kind: controls.length ? 'control_prefixed_normal_record' : 'normal_record',
        controls,
        normalRecord: {
          offset: hex(pc),
          delayByte: 'present_not_embedded',
          pointerRoles: pointers,
          consumedBytes: pc + 7 - offset,
          endExclusive: hex(pc + 7),
        },
        warnings,
      };
    }

    const control = controlRef(rom, mapData, opcode, pc);
    controls.push(control);

    if (opcode === 0xFB) {
      pc += 2;
      continue;
    }
    if (opcode === 0xFD && control.pointerOperand?.targetWithinBundle) {
      pc = parseInt(control.pointerOperand.targetOffset, 16);
      continue;
    }
    if (opcode === 0xFA || opcode === 0xFF || opcode === 0xFE || opcode === 0xFC) {
      return {
        recordOffset: hex(offset),
        kind: 'control_record',
        controls,
        normalRecord: null,
        warnings,
      };
    }

    warnings.push(`unmapped control opcode ${hex(opcode, 2)} at ${hex(pc)}`);
    return {
      recordOffset: hex(offset),
      kind: 'invalid',
      controls,
      normalRecord: null,
      warnings,
    };
  }

  warnings.push(`state record parser exceeded step limit at ${hex(offset)}`);
  return {
    recordOffset: hex(offset),
    kind: 'invalid',
    controls,
    normalRecord: null,
    warnings,
  };
}

function readStatePointerTable(rom, mapData, rootEntry) {
  const tableOffset = rootEntry.targetOffset == null ? null : parseInt(rootEntry.targetOffset, 16);
  const pointerEntries = [];
  if (tableOffset == null) {
    return {
      rootIndex: rootEntry.index,
      tableOffset: null,
      entryCount: 0,
      byteLength: 0,
      pointerEntries,
      records: [],
      warnings: ['root entry does not resolve to a bank-2 table pointer'],
    };
  }

  let pos = tableOffset;
  while (pos + 1 <= bundleEndInclusive && pointerEntries.length < 128) {
    const z80Pointer = readWord(rom, pos);
    const recordOffset = bank2Z80ToRom(z80Pointer);
    if (recordOffset == null || recordOffset < bundleOffset || recordOffset > bundleEndInclusive) break;
    pointerEntries.push({
      index: pointerEntries.length,
      pointerEntryOffset: hex(pos),
      z80Pointer: hex(z80Pointer, 4),
      recordOffset: hex(recordOffset),
      recordRegion: regionRef(regionForOffset(mapData, recordOffset)),
    });
    pos += 2;
  }

  const records = pointerEntries.map(entry => ({
    ...entry,
    decoded: decodeStateRecord(rom, mapData, parseInt(entry.recordOffset, 16)),
  }));
  const warnings = [];
  for (const record of records) {
    for (const warning of record.decoded.warnings || []) warnings.push(`entry ${record.index}: ${warning}`);
  }

  return {
    rootIndex: rootEntry.index,
    tableOffset: hex(tableOffset),
    entryCount: pointerEntries.length,
    byteLength: pointerEntries.length * 2,
    pointerEntries,
    records,
    warnings,
  };
}

function summarizeStateRecordTables(tables) {
  const allRecords = tables.flatMap(table => table.records);
  const controlCounts = {};
  const roleTargets = new Map();
  let normalRecords = 0;
  let controlPrefixedNormalRecords = 0;
  let controlOnlyRecords = 0;
  let invalidRecords = 0;
  let pointerRoleRefs = 0;
  let pointerRoleRefsInsideBundle = 0;

  for (const record of allRecords) {
    const decoded = record.decoded;
    if (decoded.kind === 'normal_record') normalRecords++;
    else if (decoded.kind === 'control_prefixed_normal_record') controlPrefixedNormalRecords++;
    else if (decoded.kind === 'control_record') controlOnlyRecords++;
    else invalidRecords++;

    for (const control of decoded.controls || []) {
      controlCounts[control.opcode] = (controlCounts[control.opcode] || 0) + 1;
    }
    for (const pointer of decoded.normalRecord?.pointerRoles || []) {
      pointerRoleRefs++;
      if (pointer.targetWithinBundle) pointerRoleRefsInsideBundle++;
      const key = `${pointer.role}|${pointer.targetOffset || 'null'}`;
      if (!roleTargets.has(key)) {
        roleTargets.set(key, {
          role: pointer.role,
          targetOffset: pointer.targetOffset,
          targetRegion: pointer.targetRegion,
          referenceCount: 0,
        });
      }
      roleTargets.get(key).referenceCount++;
    }
  }

  const uniqueTargetsByRole = {};
  for (const target of roleTargets.values()) {
    uniqueTargetsByRole[target.role] = (uniqueTargetsByRole[target.role] || 0) + 1;
  }

  return {
    statePointerTables: tables.length,
    statePointerEntries: allRecords.length,
    normalRecords,
    controlPrefixedNormalRecords,
    controlOnlyRecords,
    invalidRecords,
    controlCounts,
    pointerRoleRefs,
    pointerRoleRefsInsideBundle,
    allPointerRoleRefsInsideBundle: pointerRoleRefs === pointerRoleRefsInsideBundle,
    uniquePointerRoleTargets: roleTargets.size,
    uniqueTargetsByRole,
    warnings: tables.flatMap(table => table.warnings),
    roleTargets: [...roleTargets.values()].sort((a, b) => {
      if (a.role !== b.role) return a.role.localeCompare(b.role);
      return (a.targetOffset || '').localeCompare(b.targetOffset || '');
    }),
  };
}

function drawControlRole(opcode) {
  if (opcode === 0xFF) return 'end_segment';
  if (opcode === 0xFE) return 'next_row';
  if (opcode === 0xFD) return 'set_relative_destination';
  if (opcode === 0xFC) return 'new_destination_word';
  return 'blank_run';
}

function parseVdpDrawSegment(rom, offset) {
  const warnings = [];
  const controlCounts = {};
  let pc = offset;
  let tileWordPairs = 0;
  let blankRunControls = 0;
  let rowAdvanceControls = 0;
  let destinationAdjustControls = 0;
  let chainedDestinationControls = 0;
  let terminated = false;

  if (pc + 1 > bundleEndInclusive) {
    return {
      offset: hex(offset),
      valid: false,
      warningCount: 1,
      warnings: [`segment at ${hex(offset)} has no destination word inside bundle`],
    };
  }

  const firstDestinationWordOffset = hex(pc);
  pc += 2;

  for (let step = 0; step < 4096 && pc <= bundleEndInclusive; step++) {
    const byte = rom[pc];
    if (byte < 0xF0) {
      if (pc + 1 > bundleEndInclusive) {
        warnings.push(`tile word at ${hex(pc)} is truncated`);
        break;
      }
      tileWordPairs++;
      pc += 2;
      continue;
    }

    const opcode = byte;
    const opcodeHex = hex(opcode, 2);
    controlCounts[opcodeHex] = (controlCounts[opcodeHex] || 0) + 1;
    pc++;

    if (opcode === 0xFF) {
      terminated = true;
      break;
    }
    if (opcode === 0xFE) {
      rowAdvanceControls++;
      continue;
    }
    if (opcode === 0xFD) {
      destinationAdjustControls++;
      if (pc > bundleEndInclusive) {
        warnings.push(`relative destination operand after ${opcodeHex} is truncated`);
        break;
      }
      pc += 1;
      continue;
    }
    if (opcode === 0xFC) {
      chainedDestinationControls++;
      if (pc + 1 > bundleEndInclusive) {
        warnings.push(`new destination word after ${opcodeHex} is truncated`);
        break;
      }
      pc += 2;
      continue;
    }

    blankRunControls++;
    if (pc > bundleEndInclusive) {
      warnings.push(`blank-run operand after ${opcodeHex} is truncated`);
      break;
    }
    pc += 1;
  }

  if (!terminated && !warnings.length) warnings.push(`segment at ${hex(offset)} did not terminate before bundle end`);

  return {
    offset: hex(offset),
    valid: terminated && warnings.length === 0,
    firstDestinationWordOffset,
    destinationWordValueEmbedded: false,
    consumedBytes: pc - offset,
    endExclusive: hex(pc),
    tileWordPairs,
    controlCounts,
    blankRunControls,
    rowAdvanceControls,
    destinationAdjustControls,
    chainedDestinationControls,
    terminated,
    warningCount: warnings.length,
    warnings,
  };
}

function parseVdpDrawPointerList(rom, targetOffset) {
  const pointers = [];
  const warnings = [];
  let pc = targetOffset;
  let terminated = false;

  for (let index = 0; index < 256 && pc + 1 <= bundleEndInclusive; index++) {
    const z80Pointer = readWord(rom, pc);
    if (z80Pointer === 0) {
      terminated = true;
      pc += 2;
      break;
    }
    const segmentOffset = bank2Z80ToRom(z80Pointer);
    if (segmentOffset == null || segmentOffset < bundleOffset || segmentOffset > bundleEndInclusive) {
      warnings.push(`pointer ${index} at ${hex(pc)} does not target the bank-2 stream bundle`);
      pc += 2;
      break;
    }
    const segment = parseVdpDrawSegment(rom, segmentOffset);
    if (!segment.valid) warnings.push(`segment ${index} at ${hex(segmentOffset)} has ${segment.warningCount} warning(s)`);
    pointers.push({
      index,
      pointerEntryOffset: hex(pc),
      z80Pointer: hex(z80Pointer, 4),
      segmentOffset: hex(segmentOffset),
      segment,
    });
    pc += 2;
  }

  if (!terminated && !warnings.length) warnings.push(`VDP draw pointer list at ${hex(targetOffset)} did not terminate before bundle end`);

  const totals = pointers.reduce((acc, pointer) => {
    const segment = pointer.segment;
    acc.tileWordPairs += segment.tileWordPairs || 0;
    acc.blankRunControls += segment.blankRunControls || 0;
    acc.rowAdvanceControls += segment.rowAdvanceControls || 0;
    acc.destinationAdjustControls += segment.destinationAdjustControls || 0;
    acc.chainedDestinationControls += segment.chainedDestinationControls || 0;
    for (const [opcode, count] of Object.entries(segment.controlCounts || {})) {
      acc.controlCounts[opcode] = (acc.controlCounts[opcode] || 0) + count;
    }
    return acc;
  }, {
    tileWordPairs: 0,
    blankRunControls: 0,
    rowAdvanceControls: 0,
    destinationAdjustControls: 0,
    chainedDestinationControls: 0,
    controlCounts: {},
  });

  return {
    decoder: 'bank2_vdp_draw_pointer_list',
    valid: terminated && warnings.length === 0,
    offset: hex(targetOffset),
    pointerCount: pointers.length,
    consumedBytes: pc - targetOffset,
    endExclusive: hex(pc),
    terminated,
    pointers,
    totals,
    warningCount: warnings.length,
    warnings,
    evidence: [
      'ASM lines 19538-19549 read a word list from _RAM_D176_ and stop on a zero word.',
      'ASM lines 19554-19612 consume each pointed segment as VDP destination plus tile/name-table words.',
      'ASM lines 19648-19699 decode F0+ segment controls and return to the pointer list on 0xFF.',
    ],
  };
}

function parseObjectList(rom, targetOffset, role) {
  const warnings = [];
  let pc = targetOffset;
  let records = 0;
  let terminated = false;

  for (let index = 0; index < 512 && pc <= bundleEndInclusive; index++) {
    if (rom[pc] === 0) {
      terminated = true;
      pc += 1;
      break;
    }
    if (pc + 3 > bundleEndInclusive) {
      warnings.push(`object record ${index} at ${hex(pc)} is truncated`);
      break;
    }
    records++;
    pc += 4;
  }

  if (!terminated && !warnings.length) warnings.push(`${role} at ${hex(targetOffset)} did not terminate before bundle end`);

  return {
    decoder: role === 'object_list_pointer' ? 'bank2_object_list' : 'bank2_damage_object_list',
    valid: terminated && warnings.length === 0,
    offset: hex(targetOffset),
    recordFormat: 'one id byte plus three parameter bytes; values intentionally not embedded',
    recordCount: records,
    consumedBytes: pc - targetOffset,
    endExclusive: hex(pc),
    terminated,
    warningCount: warnings.length,
    warnings,
    evidence: [
      role === 'object_list_pointer'
        ? 'ASM lines 19794-19811 read records from _RAM_D180_, copy four bytes to _RAM_D162_, and call _LABEL_1D76_.'
        : 'ASM lines 19813-19829 read records from _RAM_D182_, copy four bytes to _RAM_D162_, and call _LABEL_1E4E_.',
    ],
  };
}

function decodePointerRoleTargets(rom, roleTargets) {
  return roleTargets.map(target => {
    const offset = target.targetOffset == null ? null : parseInt(target.targetOffset, 16);
    let decoded = null;
    if (offset != null && target.role === 'vdp_draw_pointer_list') decoded = parseVdpDrawPointerList(rom, offset);
    else if (offset != null && (target.role === 'object_list_pointer' || target.role === 'damage_object_list_pointer')) {
      decoded = parseObjectList(rom, offset, target.role);
    }
    return {
      ...target,
      decoded,
    };
  });
}

function summarizeDecodedPointerRoleTargets(decodedTargets) {
  const summary = {
    decodedTargets: decodedTargets.length,
    validDecodedTargets: decodedTargets.filter(target => target.decoded?.valid).length,
    warningCount: decodedTargets.reduce((sum, target) => sum + (target.decoded?.warningCount || 0), 0),
    vdpDrawPointerLists: 0,
    vdpDrawSegments: 0,
    vdpDrawTileWordPairs: 0,
    objectLists: 0,
    objectRecords: 0,
    damageObjectLists: 0,
    damageObjectRecords: 0,
    controlCounts: {},
  };

  for (const target of decodedTargets) {
    const decoded = target.decoded;
    if (!decoded) continue;
    if (target.role === 'vdp_draw_pointer_list') {
      summary.vdpDrawPointerLists++;
      summary.vdpDrawSegments += decoded.pointerCount || 0;
      summary.vdpDrawTileWordPairs += decoded.totals?.tileWordPairs || 0;
      for (const [opcode, count] of Object.entries(decoded.totals?.controlCounts || {})) {
        summary.controlCounts[opcode] = (summary.controlCounts[opcode] || 0) + count;
      }
    } else if (target.role === 'object_list_pointer') {
      summary.objectLists++;
      summary.objectRecords += decoded.recordCount || 0;
    } else if (target.role === 'damage_object_list_pointer') {
      summary.damageObjectLists++;
      summary.damageObjectRecords += decoded.recordCount || 0;
    }
  }

  return summary;
}

function rootEntries(rom, mapData) {
  const entries = [];
  for (let index = 0; index < rootCount; index++) {
    const pointerOffset = bundleOffset + index * 2;
    const z80Pointer = readWord(rom, pointerOffset);
    const romOffset = bank2Z80ToRom(z80Pointer);
    entries.push({
      index,
      pointerOffset: hex(pointerOffset),
      z80Pointer: hex(z80Pointer, 4),
      targetOffset: romOffset == null ? null : hex(romOffset),
      targetWithinBundle: romOffset != null && romOffset >= bundleOffset && romOffset <= bundleEndInclusive,
      setupRegion: regionRef(findRegionById(mapData, setupStates[index].regionId)),
      targetRegion: romOffset == null ? null : regionRef(regionForOffset(mapData, romOffset)),
      evidence: [
        `_DATA_9AE0_ root-table entry ${index} is selected by ${setupStates[index].label}.`,
        `Setup routine stores the selected pointer table in _RAM_D15A_ before _LABEL_96FE_ consumes it.`,
      ],
    });
  }
  return entries;
}

function buildCatalog(rom, mapData) {
  const bundleRegion = findRegionById(mapData, 'r0186');
  const roots = rootEntries(rom, mapData);
  const stateRecordTables = roots.map(entry => readStatePointerTable(rom, mapData, entry));
  const stateRecordSummary = summarizeStateRecordTables(stateRecordTables);
  const decodedPointerRoleTargets = decodePointerRoleTargets(rom, stateRecordSummary.roleTargets);
  const decodedPointerRoleSummary = summarizeDecodedPointerRoleTargets(decodedPointerRoleTargets);
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    summary: {
      rootTableEntries: rootCount,
      setupRoutines: setupStates.length,
      driverRoutines: routines.length,
      ramVariableCount: ramRoles.length,
      statePointerTableEntries: stateRecordSummary.statePointerEntries,
      normalStateRecords: stateRecordSummary.normalRecords,
      controlPrefixedStateRecords: stateRecordSummary.controlPrefixedNormalRecords,
      controlOnlyStateRecords: stateRecordSummary.controlOnlyRecords,
      invalidStateRecords: stateRecordSummary.invalidRecords,
      uniquePointerRoleTargets: stateRecordSummary.uniquePointerRoleTargets,
      decodedPointerRoleTargets: decodedPointerRoleSummary.decodedTargets,
      validDecodedPointerRoleTargets: decodedPointerRoleSummary.validDecodedTargets,
      decodedPointerRoleWarnings: decodedPointerRoleSummary.warningCount,
      vdpDrawPointerLists: decodedPointerRoleSummary.vdpDrawPointerLists,
      vdpDrawSegments: decodedPointerRoleSummary.vdpDrawSegments,
      vdpDrawTileWordPairs: decodedPointerRoleSummary.vdpDrawTileWordPairs,
      objectLists: decodedPointerRoleSummary.objectLists,
      objectRecords: decodedPointerRoleSummary.objectRecords,
      damageObjectLists: decodedPointerRoleSummary.damageObjectLists,
      damageObjectRecords: decodedPointerRoleSummary.damageObjectRecords,
      bundleRange: [hex(bundleOffset), hex(bundleEndInclusive)],
      assetPolicy: 'Metadata only: root pointer offsets, target offsets, setup routine labels, RAM addresses, and evidence. No ROM bytes, decoded screen data, graphics, text, or audio are embedded.',
    },
    bundle: {
      label: '_DATA_9AE0_',
      region: regionRef(bundleRegion),
      rootTableOffset: hex(bundleOffset),
      endInclusive: hex(bundleEndInclusive),
      role: 'bank2_vdp_stream_bundle',
      evidence: [
        'ASM lines 16376-18455 show six state setup routines selecting indexes 0..5 from _DATA_9AE0_.',
        'ASM lines 19391-19433 show _LABEL_96FE_/_LABEL_972B_ consuming the selected pointer table through _RAM_D15A_/_RAM_D15D_.',
      ],
    },
    rootEntries: roots,
    stateRecordModel: {
      normalRecord: {
        delayByte: 'present_not_embedded',
        pointerWords: pointerRoles,
        evidence: [
          'ASM lines 19421-19433: _LABEL_972B_ stores one delay byte, then three RST $10 pointer reads into _RAM_D176_, _RAM_D180_, and _RAM_D182_.',
        ],
      },
      controlOpcodes: Object.fromEntries(Object.entries(controlOpcodes).map(([opcode, def]) => [
        hex(Number(opcode), 2),
        def,
      ])),
      controlEvidence: [
        'ASM lines 19436-19441 dispatch control bytes through the six-entry jump table at _DATA_9749_ after CPL.',
        'ASM lines 19443-19485 define handlers for 0xFF, 0xFE, 0xFD, 0xFC, 0xFB, and 0xFA control paths.',
      ],
    },
    stateRecordSummary: {
      statePointerTables: stateRecordSummary.statePointerTables,
      statePointerEntries: stateRecordSummary.statePointerEntries,
      normalRecords: stateRecordSummary.normalRecords,
      controlPrefixedNormalRecords: stateRecordSummary.controlPrefixedNormalRecords,
      controlOnlyRecords: stateRecordSummary.controlOnlyRecords,
      invalidRecords: stateRecordSummary.invalidRecords,
      controlCounts: stateRecordSummary.controlCounts,
      pointerRoleRefs: stateRecordSummary.pointerRoleRefs,
      pointerRoleRefsInsideBundle: stateRecordSummary.pointerRoleRefsInsideBundle,
      allPointerRoleRefsInsideBundle: stateRecordSummary.allPointerRoleRefsInsideBundle,
      uniquePointerRoleTargets: stateRecordSummary.uniquePointerRoleTargets,
      uniqueTargetsByRole: stateRecordSummary.uniqueTargetsByRole,
      warningCount: stateRecordSummary.warnings.length,
    },
    decodedPointerRoleSummary,
    stateRecordTables,
    pointerRoleTargets: decodedPointerRoleTargets,
    setupStates: setupStates.map(state => ({
      ...state,
      region: regionRef(findRegionById(mapData, state.regionId)),
    })),
    routines: routines.map(routine => ({
      ...routine,
      region: regionRef(findRegionById(mapData, routine.regionId)),
    })),
    ramRoles: ramRoles.map(([address, role, summary, confidence]) => ({ address, role, summary, confidence })),
  };
}

function annotateRegion(region, item) {
  const before = regionRef(region);
  const previousType = region.type || 'unknown';
  if (item.name && !region.name) region.name = item.name;
  if (item.summary && !region.notes) region.notes = item.summary;
  region.analysis = region.analysis || {};
  region.analysis.bank2VdpStreamStateAudit = {
    catalogId,
    kind: item.role,
    label: item.label,
    confidence: item.confidence,
    typeBeforeAudit: previousType,
    typeAfterAudit: region.type || previousType,
    changedType: false,
    summary: item.summary,
    rootIndex: item.index,
    evidence: item.evidence,
    generatedAt: now,
    tool: toolName,
  };
  return { before, after: regionRef(region), role: item.role, confidence: item.confidence, changedType: false };
}

function annotateBundle(region, catalog) {
  const before = regionRef(region);
  const previousType = region.type || 'unknown';
  region.type = 'vdp_stream';
  if (!region.name || region.name === '_DATA_9AE0_') region.name = '_DATA_9AE0_ bank-2 VDP stream bundle';
  region.analysis = region.analysis || {};
  region.analysis.bank2VdpStreamStateAudit = {
    catalogId,
    kind: 'bank2_vdp_stream_bundle_root_table',
    confidence: 'high',
    typeBeforeAudit: previousType,
    typeAfterAudit: region.type,
    changedType: previousType !== region.type,
    rootTableEntries: rootCount,
    rootEntries: catalog.rootEntries.map(entry => ({
      index: entry.index,
      pointerOffset: entry.pointerOffset,
      z80Pointer: entry.z80Pointer,
      targetOffset: entry.targetOffset,
      targetWithinBundle: entry.targetWithinBundle,
    })),
    stateRecordSummary: {
      statePointerTableEntries: catalog.stateRecordSummary.statePointerEntries,
      normalStateRecords: catalog.stateRecordSummary.normalRecords,
      controlPrefixedStateRecords: catalog.stateRecordSummary.controlPrefixedNormalRecords,
      controlOnlyStateRecords: catalog.stateRecordSummary.controlOnlyRecords,
      invalidStateRecords: catalog.stateRecordSummary.invalidRecords,
      uniquePointerRoleTargets: catalog.stateRecordSummary.uniquePointerRoleTargets,
      warningCount: catalog.stateRecordSummary.warningCount,
    },
    decodedPointerRoleSummary: {
      decodedTargets: catalog.decodedPointerRoleSummary.decodedTargets,
      validDecodedTargets: catalog.decodedPointerRoleSummary.validDecodedTargets,
      warningCount: catalog.decodedPointerRoleSummary.warningCount,
      vdpDrawPointerLists: catalog.decodedPointerRoleSummary.vdpDrawPointerLists,
      vdpDrawSegments: catalog.decodedPointerRoleSummary.vdpDrawSegments,
      vdpDrawTileWordPairs: catalog.decodedPointerRoleSummary.vdpDrawTileWordPairs,
      objectLists: catalog.decodedPointerRoleSummary.objectLists,
      objectRecords: catalog.decodedPointerRoleSummary.objectRecords,
      damageObjectLists: catalog.decodedPointerRoleSummary.damageObjectLists,
      damageObjectRecords: catalog.decodedPointerRoleSummary.damageObjectRecords,
    },
    summary: 'Six-entry root table and stream bundle selected by the bank-2 state setup routines and decoded by _LABEL_96FE_/_LABEL_972B_.',
    evidence: catalog.bundle.evidence,
    generatedAt: now,
    tool: toolName,
  };
  return { before, after: regionRef(region), role: 'bank2_vdp_stream_bundle_root_table', confidence: 'high', changedType: previousType !== region.type };
}

function annotateRamEntry(entry, role) {
  const [address, kind, summary, confidence] = role;
  const before = {
    address: entry.address,
    size: entry.size || 0,
    type: entry.type || '',
    name: entry.name || '',
    notes: entry.notes || '',
  };
  entry.analysis = entry.analysis || {};
  entry.analysis.bank2VdpStreamStateAudit = {
    catalogId,
    kind,
    confidence,
    summary,
    generatedAt: now,
    tool: toolName,
  };
  return {
    before,
    after: {
      address: entry.address,
      size: entry.size || 0,
      type: entry.type || '',
      name: entry.name || '',
      notes: entry.notes || '',
    },
    role: kind,
    confidence,
  };
}

function applyAnnotations(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  const changedRam = [];
  const missingRam = [];

  const bundleRegion = findRegionById(mapData, 'r0186');
  if (bundleRegion) changedRegions.push(annotateBundle(bundleRegion, catalog));
  else missingRegions.push({ id: 'r0186', offset: hex(bundleOffset), role: 'bank2_vdp_stream_bundle_root_table' });

  for (const state of setupStates) {
    const region = findRegionById(mapData, state.regionId);
    if (!region) {
      missingRegions.push({ id: state.regionId, label: state.label, role: state.role });
      continue;
    }
    changedRegions.push(annotateRegion(region, state));
  }

  for (const routine of routines) {
    const region = findRegionById(mapData, routine.regionId);
    if (!region) {
      missingRegions.push({ id: routine.regionId, label: routine.label, role: routine.role });
      continue;
    }
    changedRegions.push(annotateRegion(region, routine));
  }

  for (const role of ramRoles) {
    const entry = findRam(mapData, role[0]);
    if (!entry) {
      missingRam.push({ address: role[0], role: role[1] });
      continue;
    }
    changedRam.push(annotateRamEntry(entry, role));
  }

  return { changedRegions, missingRegions, changedRam, missingRam };
}

function main() {
  const rom = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(rom, mapData);
  let changes = { changedRegions: [], missingRegions: [], changedRam: [], missingRam: [] };

  if (apply) {
    changes = applyAnnotations(mapData, catalog);
    const finalCatalog = buildCatalog(rom, mapData);
    mapData.vdpStreamCatalogs = (mapData.vdpStreamCatalogs || []).filter(item => item.id !== catalogId);
    mapData.vdpStreamCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'bank2_vdp_stream_state_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      summary: {
        ...finalCatalog.summary,
        changedRegions: changes.changedRegions.length,
        changedRegionTypes: changes.changedRegions.filter(item => item.changedType).length,
        missingRegions: changes.missingRegions.length,
        annotatedRamEntries: changes.changedRam.length,
        missingRamEntries: changes.missingRam.length,
      },
      changedRegions: changes.changedRegions,
      missingRegions: changes.missingRegions,
      annotatedRamEntries: changes.changedRam,
      missingRamEntries: changes.missingRam,
      rootEntries: finalCatalog.rootEntries,
      evidence: finalCatalog.bundle.evidence,
      nextLeads: [
        'Promote stable subranges inside _DATA_9AE0_ into named metadata overlays for root tables, state-record tables, draw pointer lists, object lists, and damage-object lists.',
        'Trace the state-specific update routines that advance _RAM_D15D_ so the stream timing can be replayed frame-by-frame.',
        'Build a read-only VDP stream preview for _DATA_9AE0_ that shows destination coverage and unresolved controls without rendering copyrighted tiles.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    rootEntries: catalog.rootEntries.map(entry => ({
      index: entry.index,
      pointerOffset: entry.pointerOffset,
      z80Pointer: entry.z80Pointer,
      targetOffset: entry.targetOffset,
      targetWithinBundle: entry.targetWithinBundle,
    })),
    stateRecordSummary: catalog.stateRecordSummary,
    decodedPointerRoleSummary: catalog.decodedPointerRoleSummary,
    stateRecordTableSummary: catalog.stateRecordTables.map(table => ({
      rootIndex: table.rootIndex,
      tableOffset: table.tableOffset,
      entryCount: table.entryCount,
      normalRecords: table.records.filter(record => record.decoded.kind === 'normal_record').length,
      controlPrefixedNormalRecords: table.records.filter(record => record.decoded.kind === 'control_prefixed_normal_record').length,
      controlOnlyRecords: table.records.filter(record => record.decoded.kind === 'control_record').length,
      invalidRecords: table.records.filter(record => record.decoded.kind === 'invalid').length,
      warningCount: table.warnings.length,
    })),
    setupStates: catalog.setupStates.map(state => ({
      index: state.index,
      regionId: state.regionId,
      label: state.label,
      role: state.role,
      confidence: state.confidence,
    })),
    routines: catalog.routines.map(routine => ({
      regionId: routine.regionId,
      label: routine.label,
      role: routine.role,
      confidence: routine.confidence,
    })),
    ramRoles: catalog.ramRoles,
    changes,
  }, null, 2));
}

main();
