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
const catalogId = 'world-zone-trigger-destination-role-catalog-2026-06-25';
const reportId = 'zone-trigger-destination-role-audit-2026-06-25';
const toolName = 'tools/world-zone-trigger-destination-role-audit.mjs';

const triggerCatalogId = 'world-zone-trigger-record-catalog-2026-06-25';
const pointerFlowCatalogId = 'world-zone-descriptor-pointer-flow-catalog-2026-06-25';
const playerRuntimeCatalogId = 'world-player-runtime-routine-catalog-2026-06-25';
const bank2TransitionCatalogId = 'world-bank2-transition-routine-catalog-2026-06-25';

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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

function findRamByAddress(mapData, address) {
  return (mapData.ram || []).find(entry =>
    String(entry.address || '').toUpperCase() === String(address || '').toUpperCase()
  ) || null;
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === id);
    if (found) return found;
  }
  return null;
}

function inBank4Z80(z80) {
  return z80 >= 0x8000 && z80 < 0xC000;
}

function bank4Z80ToRom(z80) {
  return z80 + 0x8000;
}

function z80FromBank4Rom(offset) {
  return offset - 0x8000;
}

function parseOffset(text) {
  return parseInt(String(text || '0').replace(/^0x/i, ''), 16);
}

function transitionEntryMap(pointerFlowCatalog) {
  const table = (pointerFlowCatalog?.dispatchTables || []).find(item => item.label === '_DATA_4CAD_');
  const byTriggerOpcode = new Map();
  for (const entry of table?.entries || []) {
    byTriggerOpcode.set(entry.index + 1, entry);
  }
  return byTriggerOpcode;
}

function descriptorOffsetSet(mapData) {
  const graph = (mapData.zoneGraphs || [])[0] || null;
  return new Set((graph?.descriptors || []).map(descriptor => descriptor.descriptorOffset));
}

function parseRoomDescriptorShape(rom, mapData, offset) {
  const warnings = [];
  if (offset < 0 || offset + 5 >= rom.length) {
    return {
      romOffset: hex(offset),
      validShape: false,
      warnings: ['descriptor offset out of ROM range'],
    };
  }
  const subZ80 = rom[offset + 4] | (rom[offset + 5] << 8);
  const subRomOffset = inBank4Z80(subZ80) ? bank4Z80ToRom(subZ80) : null;
  if (!inBank4Z80(subZ80)) warnings.push(`subrecord pointer ${hex(subZ80, 4)} outside bank 4 window`);
  if (subRomOffset == null || subRomOffset + 17 >= rom.length) warnings.push('subrecord offset outside ROM range');

  let doorZ80 = null;
  let vramLoader8fbZ80 = null;
  let dc2Indices = [];
  let flags = null;
  let audioRequestId = null;
  if (subRomOffset != null && subRomOffset + 17 < rom.length) {
    doorZ80 = rom[subRomOffset] | (rom[subRomOffset + 1] << 8);
    vramLoader8fbZ80 = rom[subRomOffset + 8] | (rom[subRomOffset + 9] << 8);
    dc2Indices = Array.from(rom.slice(subRomOffset + 10, subRomOffset + 16)).map(value => hex(value, 2));
    flags = rom[subRomOffset + 16];
    audioRequestId = rom[subRomOffset + 17];
    if (!inBank4Z80(doorZ80)) warnings.push(`trigger table pointer ${hex(doorZ80, 4)} outside bank 4 window`);
    if (!inBank4Z80(vramLoader8fbZ80)) warnings.push(`8FB loader pointer ${hex(vramLoader8fbZ80, 4)} outside bank 4 window`);
  }

  const descriptorOffsetText = hex(offset);
  return {
    romOffset: descriptorOffsetText,
    z80Pointer: hex(z80FromBank4Rom(offset), 4),
    region: regionRef(findContainingRegion(mapData, offset)),
    validShape: warnings.length === 0,
    inZoneGraph: descriptorOffsetSet(mapData).has(descriptorOffsetText),
    scroll: {
      xRaw: hex(rom[offset], 2),
      xPixels: rom[offset] * 8,
      yRaw: hex(rom[offset + 1], 2),
    },
    camera: {
      xRaw: hex(rom[offset + 2], 2),
      yRaw: hex(rom[offset + 3], 2),
    },
    subrecord: {
      z80Pointer: hex(subZ80, 4),
      romOffset: subRomOffset == null ? null : hex(subRomOffset),
      triggerTableZ80: doorZ80 == null ? null : hex(doorZ80, 4),
      triggerTableRomOffset: doorZ80 == null || !inBank4Z80(doorZ80) ? null : hex(bank4Z80ToRom(doorZ80)),
      vramLoader8fbZ80: vramLoader8fbZ80 == null ? null : hex(vramLoader8fbZ80, 4),
      vramLoader8fbRomOffset: vramLoader8fbZ80 == null || !inBank4Z80(vramLoader8fbZ80) ? null : hex(bank4Z80ToRom(vramLoader8fbZ80)),
      dc2Indices,
      flags: flags == null ? null : hex(flags, 2),
      paletteIndex: flags == null ? null : flags & 0x3F,
      audioRequestId,
      audioRequestIdHex: audioRequestId == null ? null : hex(audioRequestId, 2),
    },
    warnings,
  };
}

function parsePositionRecord(rom, offset) {
  if (offset < 0 || offset + 2 >= rom.length) {
    return {
      format: 'room_transition_position_restore_record',
      romOffset: hex(offset),
      validShape: false,
      warnings: ['position record offset out of ROM range'],
    };
  }
  const x = rom[offset] | (rom[offset + 1] << 8);
  const y = rom[offset + 2];
  return {
    format: 'room_transition_position_restore_record',
    romOffset: hex(offset),
    validShape: true,
    playerX: x,
    playerY: y,
    consumedBy: '_LABEL_4D3A_',
    writes: ['_RAM_C243_', '_RAM_C246_'],
    warnings: [],
  };
}

function parseMenuSourceList(rom, offset) {
  if (offset < 0 || offset + 3 >= rom.length) {
    return {
      format: 'equipment_menu_source_list_4_slots',
      romOffset: hex(offset),
      validShape: false,
      warnings: ['menu source list offset out of ROM range'],
    };
  }
  return {
    format: 'equipment_menu_source_list_4_slots',
    romOffset: hex(offset),
    validShape: true,
    slotCount: 4,
    slotValues: Array.from(rom.slice(offset, offset + 4)).map((value, slot) => ({
      slot,
      valueHex: hex(value, 2),
      special: value === 0xFE || value === 0xFF,
    })),
    consumedBy: '_LABEL_3105_ via _LABEL_332D_',
    writes: ['_RAM_CFFE_', '_RAM_D133_', '_RAM_D10E_'],
    warnings: [],
  };
}

function parseTriggerSequenceStart(rom, offset) {
  if (offset < 0 || offset >= rom.length) {
    return {
      format: 'room_trigger_sequence_start',
      romOffset: hex(offset),
      validShape: false,
      warnings: ['sequence start offset out of ROM range'],
    };
  }
  return {
    format: 'room_trigger_sequence_start',
    romOffset: hex(offset),
    validShape: true,
    sequenceId: rom[offset],
    sequenceIdHex: hex(rom[offset], 2),
    continuationOffset: hex(offset + 1),
    consumedBy: '_LABEL_4995_',
    writes: ['_RAM_D1B0_', '_RAM_D1B1_', '_RAM_D1BA_'],
    warnings: [],
  };
}

function parseStageTransitionRecord(rom, mapData, offset) {
  if (offset < 0 || offset + 12 >= rom.length) {
    return {
      format: 'form_stage_transition_record',
      romOffset: hex(offset),
      validShape: false,
      warnings: ['stage transition record offset out of ROM range'],
    };
  }
  const stageSelector = rom[offset];
  const firstDescriptor = parseRoomDescriptorShape(rom, mapData, offset + 1);
  const secondDescriptor = parseRoomDescriptorShape(rom, mapData, offset + 7);
  const warnings = [
    ...firstDescriptor.warnings.map(item => `first descriptor: ${item}`),
    ...secondDescriptor.warnings.map(item => `second descriptor: ${item}`),
  ];
  return {
    format: 'form_stage_transition_record',
    romOffset: hex(offset),
    validShape: warnings.length === 0,
    stageSelector,
    stageSelectorHex: hex(stageSelector, 2),
    consumedBy: '_LABEL_4E49_ and _LABEL_B44F_',
    semantics: 'If selector is zero or greater than _RAM_CF5B_, _LABEL_4E49_ queues bank-2 transition state and leaves _RAM_C26C_ at the first inline descriptor; otherwise it skips to the second inline descriptor and loads it immediately.',
    firstInlineDescriptor: firstDescriptor,
    secondInlineDescriptor: secondDescriptor,
    warnings,
  };
}

function directDescriptorPayload(record) {
  return {
    format: 'room_descriptor_pointer',
    romOffset: record.destination.romOffset,
    z80Pointer: record.destination.z80Pointer,
    descriptorId: record.destination.descriptorId,
    inZoneGraph: record.destination.inZoneGraph,
    validShape: record.destination.inZoneGraph,
  };
}

function transitionEntryForRecord(record, transitionByOpcode) {
  const opcode = record.opcode.index;
  if (opcode <= 0) return null;
  return transitionByOpcode.get(opcode) || null;
}

function classifyRecord(rom, mapData, record, transitionByOpcode) {
  const opcode = record.opcode.index;
  const triggerKind = record.opcode.classification?.kind || 'unknown';
  const transitionEntry = transitionEntryForRecord(record, transitionByOpcode);
  const destinationOffset = record.destination.romOffset == null ? null : parseOffset(record.destination.romOffset);

  if (triggerKind === 'immediate_room_load_via_cffa') {
    return {
      role: 'room_descriptor_direct_cffa',
      confidence: record.destination.inZoneGraph ? 'high' : 'low',
      consumer: '_LABEL_4903_',
      triggerOpcode: opcode,
      transitionDispatch: null,
      payload: directDescriptorPayload(record),
      evidence: ['_LABEL_4903_ loads HL from _RAM_CFFA_ and calls _LABEL_2620_.'],
    };
  }

  if (opcode === 16 && triggerKind === 'other_trigger_effect') {
    return {
      role: 'room_trigger_sequence_start',
      confidence: 'high',
      consumer: '_LABEL_4995_',
      triggerOpcode: opcode,
      transitionDispatch: null,
      payload: parseTriggerSequenceStart(rom, destinationOffset),
      evidence: ['_LABEL_4995_ reads one byte from DE into _RAM_D1B0_ and stores DE+1 into _RAM_D1B1_.'],
    };
  }

  if (['other_trigger_effect', 'bank2_transition_request_cf6a_1', 'bank2_transition_request_cf6a_3'].includes(triggerKind)) {
    return {
      role: 'record_tail_pointer_unused_by_trigger_handler',
      confidence: 'high',
      consumer: record.opcode.dispatchTargetLabel,
      triggerOpcode: opcode,
      transitionDispatch: null,
      payload: {
        format: 'unused_bank4_pointer',
        romOffset: record.destination.romOffset,
        z80Pointer: record.destination.z80Pointer,
        note: 'The trigger handler for this opcode does not read DE or store _RAM_C26C_/_RAM_CFFA_.',
      },
      evidence: [`${record.opcode.dispatchTargetLabel} does not consume the trigger-record destination pointer.`],
    };
  }

  if (opcode === 2 || opcode === 10 || opcode === 12) {
    return {
      role: 'equipment_menu_source_list',
      confidence: 'high',
      consumer: '_LABEL_4D72_ -> _LABEL_3105_',
      triggerOpcode: opcode,
      transitionDispatch: transitionEntry ? {
        table: '_DATA_4CAD_',
        index: transitionEntry.index,
        targetLabel: transitionEntry.targetLabel,
        classification: transitionEntry.classification,
      } : null,
      payload: parseMenuSourceList(rom, destinationOffset),
      evidence: ['_LABEL_4D72_ loads HL from _RAM_C26C_ and calls _LABEL_3105_; _LABEL_332D_ copies four source bytes into _RAM_D133_/_RAM_D10E_.'],
    };
  }

  if (opcode === 3) {
    return {
      role: 'transition_pointer_unused_shop_purchase',
      confidence: 'high',
      consumer: '_LABEL_4E05_',
      triggerOpcode: opcode,
      transitionDispatch: transitionEntry ? {
        table: '_DATA_4CAD_',
        index: transitionEntry.index,
        targetLabel: transitionEntry.targetLabel,
        classification: transitionEntry.classification,
      } : null,
      payload: {
        format: 'unused_bank4_pointer',
        romOffset: record.destination.romOffset,
        z80Pointer: record.destination.z80Pointer,
        note: '_LABEL_4E05_ opens the shop purchase/menu controller and does not read _RAM_C26C_.',
      },
      evidence: ['_LABEL_4E05_ calls _LABEL_383B_ between common context capture/restore helpers and does not load HL from _RAM_C26C_.'],
    };
  }

  if (opcode === 5) {
    return {
      role: 'transition_pointer_unused_password_screen',
      confidence: 'high',
      consumer: '_LABEL_4E25_',
      triggerOpcode: opcode,
      transitionDispatch: transitionEntry ? {
        table: '_DATA_4CAD_',
        index: transitionEntry.index,
        targetLabel: transitionEntry.targetLabel,
        classification: transitionEntry.classification,
      } : null,
      payload: {
        format: 'unused_bank4_pointer',
        romOffset: record.destination.romOffset,
        z80Pointer: record.destination.z80Pointer,
        note: '_LABEL_4E25_ opens the password display controller and does not read _RAM_C26C_.',
      },
      evidence: ['_LABEL_4E25_ calls _LABEL_3ACF_ between common context capture/restore helpers and does not load HL from _RAM_C26C_.'],
    };
  }

  if (opcode === 14) {
    return {
      role: 'player_position_restore_record',
      confidence: 'high',
      consumer: '_LABEL_4D3A_',
      triggerOpcode: opcode,
      transitionDispatch: transitionEntry ? {
        table: '_DATA_4CAD_',
        index: transitionEntry.index,
        targetLabel: transitionEntry.targetLabel,
        classification: transitionEntry.classification,
      } : null,
      payload: parsePositionRecord(rom, destinationOffset),
      evidence: ['_LABEL_4D3A_ reads a word and a byte from _RAM_C26C_ into _RAM_C243_ and _RAM_C246_.'],
    };
  }

  if (opcode === 4 || opcode === 15) {
    return {
      role: 'form_stage_transition_record',
      confidence: 'high',
      consumer: '_LABEL_4E49_',
      triggerOpcode: opcode,
      transitionDispatch: transitionEntry ? {
        table: '_DATA_4CAD_',
        index: transitionEntry.index,
        targetLabel: transitionEntry.targetLabel,
        classification: transitionEntry.classification,
      } : null,
      payload: parseStageTransitionRecord(rom, mapData, destinationOffset),
      evidence: ['_LABEL_4E49_ reads one selector byte from _RAM_C26C_, then either queues _RAM_CF6A_=2 or skips six bytes and calls _LABEL_2620_ from the second inline descriptor.'],
    };
  }

  if (transitionEntry?.classification?.zoneLoaderConsumer || ['_LABEL_4CE9_', '_LABEL_4EB0_'].includes(transitionEntry?.targetLabel)) {
    return {
      role: 'room_descriptor_deferred_c26c',
      confidence: record.destination.inZoneGraph ? 'high' : 'low',
      consumer: transitionEntry.targetLabel,
      triggerOpcode: opcode,
      transitionDispatch: {
        table: '_DATA_4CAD_',
        index: transitionEntry.index,
        targetLabel: transitionEntry.targetLabel,
        classification: transitionEntry.classification,
      },
      payload: directDescriptorPayload(record),
      evidence: [`${transitionEntry.targetLabel} consumes _RAM_C26C_ in a path that calls _LABEL_2620_.`],
    };
  }

  return {
    role: 'unclassified_trigger_destination',
    confidence: 'low',
    consumer: record.opcode.dispatchTargetLabel || transitionEntry?.targetLabel || null,
    triggerOpcode: opcode,
    transitionDispatch: transitionEntry ? {
      table: '_DATA_4CAD_',
      index: transitionEntry.index,
      targetLabel: transitionEntry.targetLabel,
      classification: transitionEntry.classification,
    } : null,
    payload: {
      format: 'unknown_bank4_pointer',
      romOffset: record.destination.romOffset,
      z80Pointer: record.destination.z80Pointer,
    },
    evidence: ['No supported destination role was matched for this trigger opcode in the current audit.'],
  };
}

function buildRecordRoles(mapData, rom, triggerCatalog, transitionByOpcode) {
  const roles = [];
  for (const table of triggerCatalog.triggerTables || []) {
    for (const record of table.records || []) {
      const classified = classifyRecord(rom, mapData, record, transitionByOpcode);
      roles.push({
        triggerTableId: table.id,
        triggerTableOffset: table.romOffset,
        recordIndex: record.index,
        entryOffset: record.entryOffset,
        rawOpcode: record.opcode.raw,
        opcodeIndex: record.opcode.index,
        triggerDispatchTarget: record.opcode.dispatchTargetLabel,
        sourceDescriptorCount: table.usedByDescriptorCount,
        sourceDescriptorSample: (table.usedByDescriptors || []).slice(0, 8),
        destination: {
          z80Pointer: record.destination.z80Pointer,
          romOffset: record.destination.romOffset,
          inZoneGraph: record.destination.inZoneGraph,
          descriptorId: record.destination.descriptorId,
        },
        ...classified,
      });
    }
  }
  return roles;
}

function summarizeRoles(roles) {
  const byRole = new Map();
  for (const role of roles) {
    const entry = byRole.get(role.role) || {
      role: role.role,
      count: 0,
      opcodeIndices: new Set(),
      consumers: new Set(),
      validPayloadCount: 0,
      warningCount: 0,
      samples: [],
    };
    entry.count++;
    entry.opcodeIndices.add(role.opcodeIndex);
    if (role.consumer) entry.consumers.add(role.consumer);
    if (role.payload?.validShape !== false) entry.validPayloadCount++;
    entry.warningCount += role.payload?.warnings?.length || 0;
    if (entry.samples.length < 12) {
      entry.samples.push({
        entryOffset: role.entryOffset,
        opcodeIndex: role.opcodeIndex,
        rawOpcode: role.rawOpcode,
        destinationOffset: role.destination.romOffset,
        consumer: role.consumer,
      });
    }
    byRole.set(role.role, entry);
  }
  return [...byRole.values()]
    .sort((a, b) => b.count - a.count || a.role.localeCompare(b.role))
    .map(entry => ({
      role: entry.role,
      count: entry.count,
      opcodeIndices: [...entry.opcodeIndices].sort((a, b) => a - b),
      consumers: [...entry.consumers].sort(),
      validPayloadCount: entry.validPayloadCount,
      warningCount: entry.warningCount,
      samples: entry.samples,
    }));
}

function buildCatalog(mapData, rom) {
  const triggerCatalog = findCatalog(mapData, triggerCatalogId);
  if (!triggerCatalog) throw new Error(`Missing trigger catalog ${triggerCatalogId}`);
  const pointerFlowCatalog = findCatalog(mapData, pointerFlowCatalogId);
  const transitionByOpcode = transitionEntryMap(pointerFlowCatalog);
  const roles = buildRecordRoles(mapData, rom, triggerCatalog, transitionByOpcode);
  const roleSummary = summarizeRoles(roles);
  const warningCount = roleSummary.reduce((sum, role) => sum + role.warningCount, 0);
  const unclassifiedCount = roles.filter(role => role.role === 'unclassified_trigger_destination').length;
  const inlineDescriptors = roles
    .filter(role => role.role === 'form_stage_transition_record')
    .flatMap(role => [role.payload.firstInlineDescriptor, role.payload.secondInlineDescriptor])
    .filter(Boolean);
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [triggerCatalogId, pointerFlowCatalogId, playerRuntimeCatalogId, bank2TransitionCatalogId],
    sourceCatalogPresence: {
      [triggerCatalogId]: Boolean(triggerCatalog),
      [pointerFlowCatalogId]: Boolean(pointerFlowCatalog),
      [playerRuntimeCatalogId]: Boolean(findCatalog(mapData, playerRuntimeCatalogId)),
      [bank2TransitionCatalogId]: Boolean(findCatalog(mapData, bank2TransitionCatalogId)),
    },
    summary: {
      triggerRecordCount: roles.length,
      roleKindCount: roleSummary.length,
      unclassifiedDestinationCount: unclassifiedCount,
      warningCount,
      directRoomDescriptorCount: roles.filter(role => role.role === 'room_descriptor_direct_cffa' || role.role === 'room_descriptor_deferred_c26c').length,
      stagedTransitionRecordCount: roles.filter(role => role.role === 'form_stage_transition_record').length,
      inlineTransitionDescriptorCount: inlineDescriptors.length,
      inlineTransitionDescriptorValidShapeCount: inlineDescriptors.filter(descriptor => descriptor.validShape).length,
      menuSourceListCount: roles.filter(role => role.role === 'equipment_menu_source_list').length,
      positionRestoreRecordCount: roles.filter(role => role.role === 'player_position_restore_record').length,
      triggerSequenceStartCount: roles.filter(role => role.role === 'room_trigger_sequence_start').length,
      unusedPointerCount: roles.filter(role => role.role.startsWith('record_tail_pointer_unused') || role.role.startsWith('transition_pointer_unused')).length,
      assetPolicy: 'Metadata only: trigger offsets, roles, opcode classes, scalar payload fields, descriptor offsets, and ASM consumers. No ROM bytes, decoded graphics/maps/audio/text, or rendered assets are embedded.',
    },
    roleSummary,
    recordRoles: roles,
    evidence: [
      'Immediate trigger opcodes reaching _LABEL_4903_ consume the destination through _RAM_CFFA_ and call _LABEL_2620_.',
      'Deferred trigger opcodes reaching _LABEL_492B_ or conditional tails store the destination in _RAM_C26C_; _LABEL_4C32_ dispatches _RAM_C26E_ through _DATA_4CAD_.',
      '_LABEL_4D72_ passes _RAM_C26C_ to _LABEL_3105_, whose initializer copies four source-list bytes into _RAM_D133_/_RAM_D10E_.',
      '_LABEL_4D3A_ reads a word and byte from _RAM_C26C_ into player X/Y state.',
      '_LABEL_4E49_ interprets _RAM_C26C_ as a selector plus two inline six-byte room descriptors for staged form transitions.',
      '_LABEL_4995_ reads the destination pointer as a room-trigger sequence start rather than a room descriptor.',
    ],
  };
}

function annotateRegion(mapData, catalog) {
  const regions = new Map();
  for (const role of catalog.recordRoles) {
    const offset = parseOffset(role.destination.romOffset);
    const region = findContainingRegion(mapData, offset);
    if (!region) continue;
    const item = regions.get(region.id) || {
      region,
      roleCounts: {},
      recordCount: 0,
    };
    item.recordCount++;
    item.roleCounts[role.role] = (item.roleCounts[role.role] || 0) + 1;
    regions.set(region.id, item);
  }

  const annotated = [];
  for (const item of regions.values()) {
    item.region.analysis = item.region.analysis || {};
    item.region.analysis.zoneTriggerDestinationRoleAudit = {
      catalogId,
      kind: 'trigger_destination_role_region',
      confidence: catalog.summary.unclassifiedDestinationCount === 0 && catalog.summary.warningCount === 0 ? 'high' : 'medium',
      summary: `Contains trigger destination payloads for ${item.recordCount} parsed trigger records.`,
      roleCounts: item.roleCounts,
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotated.push({
      id: item.region.id,
      offset: item.region.offset,
      type: item.region.type || 'unknown',
      name: item.region.name || '',
      recordCount: item.recordCount,
      roleCounts: item.roleCounts,
    });
  }
  return annotated;
}

const ramAnnotations = [
  ['$C26C', '_RAM_C26C_', 'Deferred trigger destination pointer; this audit classifies the payload formats consumed through it.'],
  ['$CFFE', '_RAM_CFFE_', 'Menu source-list pointer saved by _LABEL_3105_ when _LABEL_4D72_ passes _RAM_C26C_.'],
  ['$D133', '_RAM_D133_', 'Four-slot menu source list populated from _RAM_C26C_ payloads by _LABEL_332D_.'],
  ['$D10E', '_RAM_D10E_', 'Mirror of the four-slot menu source list populated by _LABEL_332D_.'],
  ['$C243', '_RAM_C243_', 'Player X position written from _RAM_C26C_ position records by _LABEL_4D3A_.'],
  ['$C246', '_RAM_C246_', 'Player Y position written from _RAM_C26C_ position records by _LABEL_4D3A_.'],
  ['$D1AE', '_RAM_D1AE_', 'Bank-2 transition branch/state selected from staged transition payloads by _LABEL_4E49_.'],
  ['$D1AF', '_RAM_D1AF_', 'Bank-2 transition initialization flag set by _LABEL_4E49_.'],
  ['$D1B0', '_RAM_D1B0_', 'Room-trigger sequence id read from opcode-16 destination payloads by _LABEL_4995_.'],
  ['$D1B1', '_RAM_D1B1_', 'Room-trigger sequence continuation pointer set to DE+1 by _LABEL_4995_.'],
  ['$D1BA', '_RAM_D1BA_', 'Room-trigger sequence active flag set by _LABEL_4995_.'],
];

function annotateRam(mapData, catalog) {
  const annotated = [];
  for (const [address, label, summary] of ramAnnotations) {
    const entry = findRamByAddress(mapData, address);
    if (!entry) continue;
    entry.analysis = entry.analysis || {};
    entry.analysis.zoneTriggerDestinationRoleAudit = {
      catalogId,
      kind: 'trigger_destination_payload_ram',
      confidence: 'high',
      label,
      summary,
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotated.push({
      id: entry.id,
      address: entry.address,
      name: entry.name || '',
      label,
    });
  }
  return annotated;
}

function main() {
  const mapData = readJson(mapPath);
  const rom = fs.readFileSync(romPath);
  const catalog = buildCatalog(mapData, rom);
  let annotatedRegions = [];
  let annotatedRam = [];

  if (apply) {
    annotatedRegions = annotateRegion(mapData, catalog);
    annotatedRam = annotateRam(mapData, catalog);
    mapData.roomDataCatalogs = (mapData.roomDataCatalogs || []).filter(item => item.id !== catalogId);
    mapData.roomDataCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'zone_trigger_destination_role_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      sourceCatalogs: catalog.sourceCatalogs,
      sourceCatalogPresence: catalog.sourceCatalogPresence,
      summary: {
        ...catalog.summary,
        annotatedRegionCount: annotatedRegions.length,
        annotatedRamCount: annotatedRam.length,
      },
      roleSummary: catalog.roleSummary,
      recordRoleSamples: catalog.recordRoles.slice(0, 60),
      annotatedRegions,
      annotatedRam,
      evidence: catalog.evidence,
      nextLeads: [
        'Promote valid inline transition descriptors into a dedicated transition-room-descriptor catalog and feed them into scene recipe rendering.',
        'Trace opcode-16 _RAM_D1B0_/_RAM_D1B1_ sequence consumers to decode room-trigger effect scripts.',
        'Resolve menu source-list slot values against item/equipment catalogs so shop and equipment transitions can be reproduced cleanly.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      annotatedRegionCount: annotatedRegions.length,
      annotatedRamCount: annotatedRam.length,
    },
    roleSummary: catalog.roleSummary.map(role => ({
      role: role.role,
      count: role.count,
      opcodeIndices: role.opcodeIndices,
      consumers: role.consumers,
      validPayloadCount: role.validPayloadCount,
      warningCount: role.warningCount,
    })),
  }, null, 2));
}

main();
