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
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-item-vram-id-producer-audit.mjs';
const catalogId = 'world-item-vram-id-producer-catalog-2026-06-26';
const reportId = 'item-vram-id-producer-audit-2026-06-26';
const schemaVersion = 1;

const selectorCatalogId = 'world-item-vram-selector-catalog-2026-06-26';
const spawnCallerCatalogId = 'world-item-vram-spawn-caller-catalog-2026-06-26';
const gameplayLookupCatalogId = 'world-gameplay-lookup-data-catalog-2026-06-25';

const lookupTableOffset = 0x063E2;
const lookupTableEntryCount = 31;
const sequencePointerTableOffset = 0x13E01;
const sequencePointerTableEntryCount = 21;
const bank4 = 4;

const directRewardConstants = [
  {
    id: 'threshold_reward_43',
    value: 0x43,
    producerLabel: '_LABEL_608F_',
    producerRegionId: 'r2394',
    conditionSummary: '_LABEL_61C2_ threshold check permits the room reward request.',
    evidenceLines: [14180, 14181, 14182, 14218, 14219],
  },
  {
    id: 'cf49_clear_reward_c1',
    value: 0xC1,
    producerLabel: '_LABEL_608F_',
    producerRegionId: 'r2394',
    conditionSummary: '_RAM_CF49_ masked with 0x7F is zero before spawning this reward id.',
    evidenceLines: [14186, 14187, 14188, 14189, 14190, 14218, 14219],
  },
  {
    id: 'cf25_clear_reward_85',
    value: 0x85,
    producerLabel: '_LABEL_608F_',
    producerRegionId: 'r2394',
    conditionSummary: '_RAM_CF25_ is zero for _RAM_D1B0_ selector 0x09.',
    evidenceLines: [14194, 14195, 14196, 14197, 14198, 14199, 14218, 14219],
  },
  {
    id: 'cf26_clear_reward_86',
    value: 0x86,
    producerLabel: '_LABEL_608F_',
    producerRegionId: 'r2394',
    conditionSummary: '_RAM_CF26_ is zero for _RAM_D1B0_ selector 0x0A.',
    evidenceLines: [14203, 14204, 14205, 14206, 14207, 14208, 14218, 14219],
  },
  {
    id: 'cf20_clear_reward_80',
    value: 0x80,
    producerLabel: '_LABEL_608F_',
    producerRegionId: 'r2394',
    conditionSummary: '_RAM_CF20_ is zero for _RAM_D1B0_ selector 0x0B.',
    evidenceLines: [14212, 14213, 14214, 14215, 14216, 14217, 14218, 14219],
  },
];

const d025WriteEvents = [
  {
    id: 'room_load_clear',
    kind: 'clear_pending_id',
    label: '_LABEL_291F_',
    regionId: 'r2085',
    writeValue: '0xFF',
    sourceExpression: 'xor a; dec a; ld (_RAM_D025_), a',
    evidenceLines: [6432, 6433, 6434, 6435, 6436, 6437],
    confidence: 'medium_high',
    summary: 'Room/player state reset clears the pending reward/object id before gameplay resumes.',
  },
  {
    id: 'spawn_dispatcher_clear_after_two_slots',
    kind: 'clear_pending_id',
    label: '_LABEL_5C4A_',
    regionId: 'r1820',
    writeValue: '0xFF',
    sourceExpression: 'ld a, 0xFF; ld (_RAM_D025_), a',
    evidenceLines: [13619, 13620, 13621],
    confidence: 'high',
    summary: 'Reward/object slot dispatcher clears the pending id after both object slots are serviced.',
  },
  {
    id: 'spawn_dispatcher_claim_clear',
    kind: 'clear_pending_id',
    label: '_LABEL_5C4A_',
    regionId: 'r1820',
    writeValue: '0xFF',
    sourceExpression: 'ld a, 0xFF; ld (_RAM_D025_), a',
    evidenceLines: [13636, 13637, 13638, 13639],
    confidence: 'high',
    summary: 'Reward/object slot dispatcher clears the pending id after a free slot claims it.',
  },
  {
    id: 'room_reward_writer',
    kind: 'producer',
    label: '_LABEL_6166_',
    regionId: 'r2398',
    sourceExpression: 'caller-supplied A from _LABEL_608F_ direct constants or _LABEL_6141_ sequence bytes',
    evidenceLines: [14263, 14271, 14272, 14273, 14274, 14275, 14276, 14277, 14278],
    confidence: 'high',
    summary: 'Room reward writer stores A into _RAM_D025_ and copies spawn position/direction side data.',
  },
  {
    id: 'room_event_lookup_writer',
    kind: 'producer',
    label: '_LABEL_635D_',
    regionId: 'r2405',
    sourceExpression: '_DATA_63E2_[eventItemIndex - 1] or constant 0x5B for event byte 0xFF',
    evidenceLines: [14549, 14550, 14553, 14555, 14558, 14559, 14560, 14567, 14568, 14569, 14570, 14571, 14572],
    confidence: 'high',
    summary: 'Room event helper writes a lookup-table or special constant reward/object id to _RAM_D025_.',
  },
  {
    id: 'room_event_special_pointer_writer',
    kind: 'producer',
    label: '_LABEL_635D_',
    regionId: 'r2405',
    sourceExpression: 'constant 0x46 when matched event object byte is zero',
    evidenceLines: [14549, 14550, 14551, 14552, 14575, 14576, 14577, 14578, 14579, 14580, 14581, 14582],
    confidence: 'high',
    summary: 'Room event helper writes constant 0x46 to _RAM_D025_ and also captures an extra pointer payload.',
  },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(value, pad = 2) {
  if (!Number.isFinite(value)) return null;
  return `0x${Number(value).toString(16).toUpperCase().padStart(pad, '0')}`;
}

function parseHex(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseInt(value.replace(/^\$/, '0x'), 16);
  return NaN;
}

function regionStart(region) {
  return parseHex(region.offset);
}

function regionEnd(region) {
  return regionStart(region) + Number(region.size || 0);
}

function readWordLE(rom, offset) {
  return rom[offset] | (rom[offset + 1] << 8);
}

function z80BankedPointerToRomOffset(word, bank) {
  if (word < 0x8000 || word > 0xBFFF) return null;
  return bank * 0x4000 + (word - 0x8000);
}

function compactRegion(region) {
  if (!region) return null;
  return {
    id: region.id || '',
    offset: region.offset || '',
    size: Number(region.size || 0),
    type: region.type || 'unknown',
    name: region.name || '',
  };
}

function compactRam(entry) {
  if (!entry) return null;
  return {
    id: entry.id || '',
    address: entry.address || '',
    size: Number(entry.size || 0),
    type: entry.type || 'unknown',
    name: entry.name || '',
  };
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function containingRegion(mapData, offset) {
  if (!Number.isFinite(offset)) return null;
  return (mapData.regions || [])
    .filter(region => offset >= regionStart(region) && offset < regionEnd(region))
    .sort((a, b) => Number(a.size || 0) - Number(b.size || 0)
      || String(a.id).localeCompare(String(b.id)))[0] || null;
}

function findRamByAddress(mapData, address) {
  return (mapData.ram || []).find(entry => String(entry.address || '').toUpperCase() === address.toUpperCase()) || null;
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === id);
    if (found) return found;
  }
  return null;
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items || []) {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function selectorGroup(selectorId) {
  if (selectorId < 0x10) return 'inline_00_0f';
  if (selectorId < 0x20) return 'inline_10_1f';
  if (selectorId < 0x30) return 'inline_20_2f';
  if (selectorId < 0x40) return 'bank4_window_13c00_30_3f';
  if (selectorId < 0x48) return 'bank4_window_13c0a_40_47';
  return 'rejected_48_7f';
}

function classifyD025Value(value) {
  const selectorId = value & 0x7F;
  return {
    highBitSet: Boolean(value & 0x80),
    selectorId,
    itemVramSelectorAccepted: selectorId < 0x48,
    selectorGroup: selectorGroup(selectorId),
  };
}

function classifyValueForCatalog(value) {
  const classification = classifyD025Value(value);
  return {
    value: hex(value, 2),
    selectorIdAfterMask: hex(classification.selectorId, 2),
    highBitSet: classification.highBitSet,
    itemVramSelectorAccepted: classification.itemVramSelectorAccepted,
    selectorGroup: classification.selectorGroup,
  };
}

function valueStats(values) {
  const classifications = values.map(value => classifyD025Value(value));
  const accepted = classifications.filter(item => item.itemVramSelectorAccepted);
  const rejected = classifications.filter(item => !item.itemVramSelectorAccepted);
  return {
    valueCount: values.length,
    highBitSetCount: classifications.filter(item => item.highBitSet).length,
    selectorAcceptedAfterMaskCount: accepted.length,
    selectorRejectedAfterMaskCount: rejected.length,
    uniqueSelectorIdAfterMaskCount: new Set(classifications.map(item => item.selectorId)).size,
    selectorGroupCounts: countBy(classifications, item => item.selectorGroup),
  };
}

function decodeRewardSequences(mapData, rom) {
  const entries = [];
  const sequenceValues = [];
  const pointerRegion = compactRegion(containingRegion(mapData, sequencePointerTableOffset));

  for (let index = 0; index < sequencePointerTableEntryCount; index++) {
    const pointerEntryOffset = sequencePointerTableOffset + index * 2;
    const pointerWord = readWordLE(rom, pointerEntryOffset);
    const targetOffset = z80BankedPointerToRomOffset(pointerWord, bank4);
    const targetRegion = targetOffset == null ? null : compactRegion(containingRegion(mapData, targetOffset));
    const regionLimit = targetRegion ? regionEnd(findRegionById(mapData, targetRegion.id) || targetRegion) : rom.length;
    const values = [];
    let pc = targetOffset;
    let terminated = false;
    let terminatorOffset = null;
    let warning = null;

    if (targetOffset == null) {
      warning = 'Pointer word does not map into bank-4 $8000-$BFFF slot.';
    } else {
      for (let guard = 0; guard < 0x100 && pc < rom.length && pc < regionLimit; guard++) {
        const value = rom[pc++];
        if (value === 0xFF) {
          terminated = true;
          terminatorOffset = pc - 1;
          break;
        }
        values.push(value);
      }
      if (!terminated) warning = `Sequence reached ${hex(Math.min(pc, regionLimit), 5)} before terminator.`;
    }

    sequenceValues.push(...values);
    entries.push({
      index,
      pointerEntryOffset: hex(pointerEntryOffset, 5),
      pointerWord: hex(pointerWord, 4),
      pointerRegion,
      targetOffset: targetOffset == null ? null : hex(targetOffset, 5),
      targetRegion,
      eventCountBeforeTerminator: values.length,
      byteLengthIncludingTerminator: terminated ? values.length + 1 : values.length,
      terminated,
      terminatorOffset: terminatorOffset == null ? null : hex(terminatorOffset, 5),
      valueClassStats: valueStats(values),
      warning,
    });
  }

  return {
    pointerTable: {
      label: '_DATA_13E01_',
      offset: hex(sequencePointerTableOffset, 5),
      region: pointerRegion,
      bank: bank4,
      entryCount: sequencePointerTableEntryCount,
      runtimeIndexExpression: '_RAM_D1B0_ - 0x10, or 0x17 - 0x10 for the _RAM_CF20_ already-set branch',
      evidenceLines: [14225, 14226, 14227, 14228, 14229, 14237, 14238, 14239, 14240, 14241, 14242, 14243, 24831, 24832, 24833, 24834, 24835],
    },
    entries,
    summary: {
      sequenceCount: entries.length,
      terminatedSequenceCount: entries.filter(entry => entry.terminated).length,
      totalSpawnEventCount: sequenceValues.length,
      minSpawnEventsPerSequence: Math.min(...entries.map(entry => entry.eventCountBeforeTerminator)),
      maxSpawnEventsPerSequence: Math.max(...entries.map(entry => entry.eventCountBeforeTerminator)),
      valueClassStats: valueStats(sequenceValues),
      sequenceRegionCount: new Set(entries.map(entry => entry.targetRegion?.id).filter(Boolean)).size,
    },
  };
}

function lookupTableStats(mapData, rom) {
  const values = [...rom.subarray(lookupTableOffset, lookupTableOffset + lookupTableEntryCount)];
  return {
    label: '_DATA_63E2_',
    offset: hex(lookupTableOffset, 5),
    region: compactRegion(containingRegion(mapData, lookupTableOffset)),
    entryCount: lookupTableEntryCount,
    indexExpression: 'event object byte minus 1 after collection-flag check at _RAM_D1EB_',
    valueClassStats: valueStats(values),
    evidenceLines: [14558, 14559, 14560, 14561, 14562, 14563, 14564, 14565, 14566, 14567, 14568, 14569, 14570, 14571, 14572, 14596, 14597, 14598, 14599],
  };
}

function buildCatalog(mapData, rom) {
  const selectorCatalog = findCatalog(mapData, selectorCatalogId);
  const spawnCallerCatalog = findCatalog(mapData, spawnCallerCatalogId);
  const gameplayLookupCatalog = findCatalog(mapData, gameplayLookupCatalogId);
  const lookup = lookupTableStats(mapData, rom);
  const sequences = decodeRewardSequences(mapData, rom);
  const directRequests = directRewardConstants.map(item => ({
    id: item.id,
    value: hex(item.value, 2),
    producerLabel: item.producerLabel,
    producerRegionId: item.producerRegionId,
    conditionSummary: item.conditionSummary,
    evidenceLines: item.evidenceLines,
    region: compactRegion(findRegionById(mapData, item.producerRegionId)),
    d025ValueClass: classifyValueForCatalog(item.value),
  }));
  const specialEventConstants = [
    {
      id: 'room_event_ff_constant_5b',
      value: '0x5B',
      selectorIdAfterMask: '0x5B',
      itemVramSelectorAccepted: false,
      selectorGroup: 'rejected_48_7f',
      evidenceLines: [14553, 14554, 14555, 14556, 14571, 14572],
    },
    {
      id: 'room_event_zero_constant_46',
      value: '0x46',
      selectorIdAfterMask: '0x46',
      itemVramSelectorAccepted: true,
      selectorGroup: 'bank4_window_13c0a_40_47',
      evidenceLines: [14550, 14551, 14552, 14575, 14576, 14577],
    },
  ];
  const directValues = directRewardConstants.map(item => item.value);
  const specialValues = specialEventConstants.map(item => parseHex(item.value));

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [selectorCatalogId, spawnCallerCatalogId, gameplayLookupCatalogId],
    summary: {
      selectorCatalogPresent: Boolean(selectorCatalog),
      spawnCallerCatalogPresent: Boolean(spawnCallerCatalog),
      gameplayLookupCatalogPresent: Boolean(gameplayLookupCatalog),
      pendingIdRam: '_RAM_D025_',
      downstreamSelectorFormula: '_LABEL_5C4A_ passes (_RAM_D025_ & 0x7F) to _LABEL_1BE0_',
      producerWriteEventCount: d025WriteEvents.filter(event => event.kind === 'producer').length,
      clearWriteEventCount: d025WriteEvents.filter(event => event.kind === 'clear_pending_id').length,
      directRewardConstantCount: directRewardConstants.length,
      lookupTableEntryCount: lookup.entryCount,
      roomEventSpecialConstantCount: specialEventConstants.length,
      rewardSequencePointerCount: sequences.summary.sequenceCount,
      rewardSequenceEventCount: sequences.summary.totalSpawnEventCount,
      rewardSequenceRegionCount: sequences.summary.sequenceRegionCount,
      directRewardValueStats: valueStats(directValues),
      lookupTableValueStats: lookup.valueClassStats,
      roomEventSpecialConstantValueStats: valueStats(specialValues),
      rewardSequenceValueStats: sequences.summary.valueClassStats,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
      assetPolicy: 'Metadata only: labels, offsets, pointer words, counts, formulas, value-class counts, RAM symbols, region ids, and evidence line numbers. No ROM bytes, decoded graphics, screenshots, audio, rendered assets, or table byte lists are embedded.',
    },
    writeEvents: d025WriteEvents.map(event => ({
      ...event,
      region: compactRegion(findRegionById(mapData, event.regionId)),
    })),
    producerRoutines: [
      {
        label: '_LABEL_608F_',
        region: compactRegion(findRegionById(mapData, 'r2394')),
        role: 'room_reward_sequence_controller',
        confidence: 'high',
        output: 'Calls _LABEL_6166_ with direct constants, or starts _DATA_13E01_ sequence playback through _LABEL_611C_/_LABEL_6141_.',
        evidenceLines: [14145, 14146, 14149, 14150, 14218, 14219, 14225, 14226, 14227],
      },
      {
        label: '_LABEL_611C_',
        region: compactRegion(findRegionById(mapData, 'r2396')),
        role: 'reward_sequence_pointer_start',
        confidence: 'high',
        output: 'Selects a bank-4 _DATA_13E01_ pointer-table entry and stores it in _RAM_D1B3_ for delayed playback.',
        evidenceLines: [14227, 14228, 14229, 14236, 14237, 14238, 14239, 14240, 14241, 14242, 14243, 14244, 14245],
      },
      {
        label: '_LABEL_6141_',
        region: compactRegion(findRegionById(mapData, 'r2397')),
        role: 'reward_sequence_step_to_spawn_writer',
        confidence: 'high',
        output: 'Every 16 frames, reads the next byte from _RAM_D1B3_, stops on 0xFF, otherwise calls _LABEL_6166_.',
        evidenceLines: [14248, 14249, 14250, 14251, 14252, 14253, 14254, 14255, 14256, 14257, 14258, 14259, 14260, 14261, 14262, 14263],
      },
      {
        label: '_LABEL_6166_',
        region: compactRegion(findRegionById(mapData, 'r2398')),
        role: 'pending_reward_object_id_writer',
        confidence: 'high',
        output: 'Writes A to _RAM_D025_, copies _RAM_D1B7_ to _RAM_D026_, copies _RAM_D1B9_ to _RAM_D028_, and sets _RAM_D029_ to 0x01.',
        evidenceLines: [14271, 14272, 14273, 14274, 14275, 14276, 14277, 14278],
      },
      {
        label: '_LABEL_635D_',
        region: compactRegion(findRegionById(mapData, 'r2405')),
        role: 'room_event_lookup_pending_object_id_writer',
        confidence: 'high',
        output: 'Scans the bank-4 room event table pointed to by _RAM_CF60_, checks _RAM_D1EB_ collection flags, writes _RAM_D025_, and computes spawn position side data.',
        evidenceLines: [14506, 14521, 14522, 14523, 14549, 14550, 14560, 14567, 14568, 14571, 14572, 14575, 14576, 14577, 14584, 14589, 14590, 14591, 14592, 14593],
      },
    ],
    directRewardRequests: directRequests,
    roomEventLookupTable: lookup,
    roomEventSpecialConstants: specialEventConstants,
    rewardSequences: sequences,
    ramRefs: {
      pendingObjectId: compactRam(findRamByAddress(mapData, '$D025')),
      pendingSpawnX: compactRam(findRamByAddress(mapData, '$D026')),
      pendingSpawnY: compactRam(findRamByAddress(mapData, '$D028')),
      pendingSpawnDirection: compactRam(findRamByAddress(mapData, '$D029')),
      rewardSequenceState: compactRam(findRamByAddress(mapData, '$D1B0')),
      rewardSequencePointer: compactRam(findRamByAddress(mapData, '$D1B3')),
      rewardSequenceTimer: compactRam(findRamByAddress(mapData, '$D1B5')),
      directRewardSpawnX: compactRam(findRamByAddress(mapData, '$D1B7')),
      directRewardSpawnY: compactRam(findRamByAddress(mapData, '$D1B9')),
      oneShotSequenceFlagBase: compactRam(findRamByAddress(mapData, '$D1BB')),
      collectionFlagBase: compactRam(findRamByAddress(mapData, '$D1EB')),
      roomEventTablePointer: compactRam(findRamByAddress(mapData, '$CF60')),
      currentRoomEventX: compactRam(findRamByAddress(mapData, '$D21E')),
      currentRoomEventY: compactRam(findRamByAddress(mapData, '$D220')),
      playerFacingForPickup: compactRam(findRamByAddress(mapData, '$C251')),
      mapperBankRegister: compactRam(findRamByAddress(mapData, '$FFFF')),
    },
    evidence: [
      'ASM lines 13654-13656 in _LABEL_5C4A_ pass (IX+62 & 0x7F), originally copied from _RAM_D025_, to _LABEL_1BE0_.',
      'ASM lines 14182-14219 in _LABEL_608F_ supply direct reward constants to _LABEL_6166_.',
      'ASM lines 14227-14243 in _LABEL_611C_ select a bank-4 _DATA_13E01_ reward sequence pointer and store it in _RAM_D1B3_.',
      'ASM lines 14248-14263 in _LABEL_6141_ step through that sequence and call _LABEL_6166_ for each byte until 0xFF.',
      'ASM lines 14271-14278 in _LABEL_6166_ write A to _RAM_D025_ and copy pending spawn position side data.',
      'ASM lines 14549-14577 in _LABEL_635D_ write _RAM_D025_ from _DATA_63E2_ or special constants after scanning the bank-4 room event table.',
      `${selectorCatalogId} defines the downstream _LABEL_1BE0_ accepted selector range 0x00-0x47 and rejection threshold 0x48.`,
      'No ROM bytes, decoded graphics, screenshots, audio, rendered assets, or table byte lists are stored.',
    ],
    nextLeads: [
      'Decode the bank-4 room event table pointed to by _RAM_CF60_ so _LABEL_635D_ object ids can be tied to room coordinates and collection flags.',
      'Resolve which reward sequence indexes in _DATA_13E01_ are reachable from _RAM_D1B0_ room state values and name each sequence by gameplay event.',
      'Feed accepted _RAM_D025_ selector ids into the VRAM provenance layer so reward/item object tiles are attributed to _LABEL_1BE0_ and _LABEL_99B_ records.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const changedRegions = [];
  const changedRam = [];
  const regionRoles = new Map();
  const addRegionRole = (region, payload) => {
    if (!region) return;
    if (!regionRoles.has(region.id)) regionRoles.set(region.id, { region, roles: [] });
    regionRoles.get(region.id).roles.push(payload);
  };

  for (const routine of catalog.producerRoutines) {
    addRegionRole(findRegionById(mapData, routine.region?.id), {
      role: routine.role,
      confidence: routine.confidence,
      summary: routine.output,
      detail: routine,
    });
  }
  addRegionRole(findRegionById(mapData, 'r0112'), {
    role: 'room_event_pickup_object_id_lookup_table',
    confidence: 'high',
    summary: '_DATA_63E2_ maps room-event pickup indexes to pending _RAM_D025_ object ids; value bytes are not persisted.',
    detail: catalog.roomEventLookupTable,
  });
  addRegionRole(findRegionById(mapData, 'r0363'), {
    role: 'reward_sequence_pointer_table',
    confidence: 'high',
    summary: '_DATA_13E01_ is the bank-4 pointer table selected by _LABEL_611C_ for delayed reward object id sequences.',
    detail: catalog.rewardSequences.pointerTable,
  });
  for (const entry of catalog.rewardSequences.entries) {
    addRegionRole(findRegionById(mapData, entry.targetRegion?.id), {
      role: 'reward_sequence_object_id_stream',
      confidence: entry.terminated ? 'high' : 'medium',
      summary: 'Reward/event sequence byte stream consumed by _LABEL_6141_; values feed _LABEL_6166_ and then _RAM_D025_.',
      detail: {
        index: entry.index,
        pointerEntryOffset: entry.pointerEntryOffset,
        pointerWord: entry.pointerWord,
        eventCountBeforeTerminator: entry.eventCountBeforeTerminator,
        terminated: entry.terminated,
        valueClassStats: entry.valueClassStats,
        warning: entry.warning,
      },
    });
  }

  for (const { region, roles } of regionRoles.values()) {
    const confidence = roles.every(role => role.confidence === 'high') ? 'high' : 'medium';
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.itemVramIdProducerAudit = {
        catalogId,
        kind: 'item_vram_id_producer_region_overlay',
        confidence,
        roles: [...new Set(roles.map(role => role.role))],
        roleCounts: countBy(roles, role => role.role),
        summaries: roles.map(role => role.summary),
        details: roles.map(role => ({
          role: role.role,
          confidence: role.confidence,
          summary: role.summary,
          detail: role.detail,
        })),
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type,
      name: region.name || '',
      roles: [...new Set(roles.map(role => role.role))],
      roleCounts: countBy(roles, role => role.role),
      confidence,
    });
  }

  const ramRoles = [
    ['$D025', 'pending_object_id_written_by_room_reward_and_event_producers'],
    ['$D026', 'pending_spawn_x_written_with_pending_object_id'],
    ['$D028', 'pending_spawn_y_written_with_pending_object_id'],
    ['$D029', 'pending_spawn_direction_written_with_pending_object_id'],
    ['$D1B0', 'room_reward_sequence_state_and_direct_reward_selector'],
    ['$D1B3', 'reward_sequence_stream_pointer'],
    ['$D1B5', 'reward_sequence_frame_timer'],
    ['$D1B7', 'direct_reward_spawn_x_source'],
    ['$D1B9', 'direct_reward_spawn_y_source'],
    ['$D1BB', 'reward_sequence_one_shot_flag_base'],
    ['$D1EB', 'room_event_pickup_collection_flag_base'],
    ['$CF60', 'bank4_room_event_table_pointer_for_label_635d'],
    ['$D21E', 'room_event_spawn_x_source_for_label_635d'],
    ['$D220', 'room_event_spawn_y_source_for_label_635d'],
    ['$C251', 'player_facing_source_for_room_event_spawn_direction'],
    ['$FFFF', 'bank4_mapper_register_used_by_reward_event_producers'],
  ];
  for (const [address, role] of ramRoles) {
    const entry = findRamByAddress(mapData, address);
    if (!entry) continue;
    if (apply) {
      entry.analysis = entry.analysis || {};
      entry.analysis.itemVramIdProducerAudit = {
        catalogId,
        kind: role,
        confidence: ['D1B0', 'D1BB'].some(part => address.includes(part)) ? 'medium_high' : 'high',
        summary: `RAM ${address} participates in the producer side of _RAM_D025_ reward/object id flow.`,
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRam.push({
      id: entry.id,
      address: entry.address,
      name: entry.name || '',
      role,
      confidence: ['D1B0', 'D1BB'].some(part => address.includes(part)) ? 'medium_high' : 'high',
    });
  }

  return { changedRegions, changedRam };
}

function main() {
  const mapData = readJson(mapPath);
  const rom = fs.readFileSync(romPath);
  const catalog = buildCatalog(mapData, rom);
  const annotation = annotateMap(mapData, catalog);

  if (apply) {
    mapData.itemDataCatalogs = (mapData.itemDataCatalogs || []).filter(item => item.id !== catalogId);
    mapData.itemDataCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'item_vram_id_producer_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: {
        ...catalog.summary,
        changedRegionCount: annotation.changedRegions.length,
        changedRamCount: annotation.changedRam.length,
      },
      changedRegions: annotation.changedRegions,
      changedRam: annotation.changedRam,
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      changedRegionCount: annotation.changedRegions.length,
      changedRamCount: annotation.changedRam.length,
    },
    changedRegions: annotation.changedRegions,
    changedRam: annotation.changedRam,
  }, null, 2));
}

main();
