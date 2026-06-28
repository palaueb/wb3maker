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
const catalogId = 'world-audio-ram-state-catalog-2026-06-25';
const reportId = 'audio-ram-state-audit-2026-06-25';

const STREAM_CHANNEL_BASES = [
  0xC100, 0xC120, 0xC140, 0xC160,
  0xC180, 0xC1A0, 0xC1C0, 0xC1E0,
];

const HARDWARE_SHADOW_BASES = [0xC200, 0xC208, 0xC210, 0xC218];

const STREAM_FIELDS = [
  {
    offset: 0x00,
    name: 'stream_flags',
    confidence: 'high',
    summary: 'Per-stream control flags; bit 0 gates channel activity and bit 4 triggers stream reinitialization.',
    evidence: [
      'ASM line 21780 tests bit 0 at the stream base and returns if it is clear.',
      'ASM lines 21797-21822 test bit 4, clear reset-time fields, and reload BC from stream pointer field +5/+6.',
    ],
  },
  {
    offset: 0x01,
    name: 'note_delay_counter',
    confidence: 'high',
    summary: 'Per-stream delay counter decremented by the shared stream interpreter before reading the next event.',
    evidence: [
      'ASM lines 21824-21834 increment to stream field +1, decrement it, and return early while it remains nonzero.',
    ],
  },
  {
    offset: 0x02,
    name: 'note_delay_reload_or_low_period_seed',
    confidence: 'medium',
    summary: 'Per-stream value copied into the note delay/current low-period path during event parsing.',
    evidence: [
      'ASM lines 21875-21910 load a note-table value and store it into stream fields +1/+2 for high-bit note events.',
      'ASM lines 21913-21922 copy fields +4/+2 down into fields +3/+1 before continuing normal note handling.',
    ],
  },
  {
    offset: 0x03,
    name: 'secondary_delay_counter',
    confidence: 'medium',
    summary: 'Secondary per-stream delay/state counter decremented before the interpreter reloads the stream pointer.',
    evidence: [
      'ASM lines 21848-21860 test and decrement stream field +3, then return early while it remains nonzero.',
      'ASM lines 21913-21918 copy stream field +4 into field +3 as part of normal note-byte handling.',
    ],
  },
  {
    offset: 0x04,
    name: 'secondary_delay_reload',
    confidence: 'medium',
    summary: 'Reload/source byte copied into the secondary delay counter during note-byte handling.',
    evidence: [
      'ASM lines 21913-21918 read stream field +4 and copy it into stream field +3.',
      'ASM lines 21875-21910 store high-bit note-table data into fields +3/+4 before normal event handling continues.',
    ],
  },
  {
    offset: 0x05,
    size: 2,
    name: 'current_stream_pointer',
    confidence: 'high',
    summary: 'Continuation pointer seeded from song/SFX headers and rewritten by the interpreter after event bytes are consumed.',
    evidence: [
      'ASM lines 21636-21648 copy a selected song/SFX header stream pointer into stream fields +5/+6.',
      'ASM lines 21701-21711 do the same for queued audio requests during the per-frame update path.',
      'ASM lines 21812-21821 reload BC from stream fields +5/+6 after the reset flag path.',
      'ASM lines 21863-21868 load BC from stream fields +5/+6 before parsing the next stream event.',
      'ASM lines 22057-22063 store the advanced BC stream pointer back through the same +5/+6 pair for the normal note-byte path.',
    ],
  },
  {
    offset: 0x07,
    name: 'support_table_output_or_note_shift',
    confidence: 'medium',
    summary: 'Stream byte written by the $F5 support-table opcode and read as a note-table shift/control value.',
    evidence: [
      'ASM lines 21887-21899 read stream field +7 to alter the high-bit note-table value before storing fields +1/+2/+3/+4.',
      'Opcode $F5 handler at ROM 0x0C412 increments HL from the stream-pointer-high field and stores the support-table byte at stream field +7 before returning to the interpreter.',
    ],
  },
  {
    offset: 0x08,
    name: 'period_high_current',
    confidence: 'medium',
    summary: 'Current high pitch/period byte generated from the stream event and the base high-period field.',
    evidence: [
      'ASM lines 22036-22045 add a decoded note value to stream field +9 and store the result in stream field +8, then mirror it into IY+3 when the stream is not in bit-1 mode.',
    ],
  },
  {
    offset: 0x09,
    name: 'period_high_base_or_pair_param_1',
    confidence: 'medium',
    summary: 'Base high pitch/period byte; also the second field mutated by $F1/$F2 pair-parameter opcodes.',
    evidence: [
      'ASM lines 22036-22045 read stream field +9 as the high pitch/period base before writing field +8 and IY+3.',
      'Opcode $F1 handler at ROM 0x0C3C9 stores one stream byte at field +9; opcode $F2 at ROM 0x0C3DB adds one stream byte into field +9.',
    ],
  },
  {
    offset: 0x0A,
    name: 'period_low_current',
    confidence: 'medium',
    summary: 'Current low pitch/period byte copied from the low-period base field and mirrored into IY+2.',
    evidence: [
      'ASM lines 22046-22055 read stream field +11, store it into field +10, and mirror it into IY+2 when the stream is not in bit-1 mode.',
    ],
  },
  {
    offset: 0x0B,
    name: 'period_low_base_or_pair_param_0',
    confidence: 'medium',
    summary: 'Base low pitch/period byte; also the first field mutated by $F1/$F2 pair-parameter opcodes.',
    evidence: [
      'ASM lines 22046-22055 read stream field +11 as the low pitch/period source before writing field +10 and IY+2.',
      'Opcode $F1 handler at ROM 0x0C3C9 stores one stream byte at field +11; opcode $F2 at ROM 0x0C3DB adds one stream byte into field +11.',
    ],
  },
  {
    offset: 0x0C,
    name: 'stream_instrument_or_effect_selector',
    confidence: 'medium',
    summary: 'Stream-side selector written by opcode $F0 before the PSG/FM hardware shadow may be updated.',
    evidence: [
      'Opcode $F0 handler at ROM 0x0C3B1 adjusts L from entry field +6 to stream field +12 and stores the current control byte there.',
      'The same handler conditionally mirrors that selector into IY+6 when stream flag bit 1 is clear.',
    ],
  },
  {
    offset: 0x0D,
    size: 2,
    name: 'repeat_body_pointer',
    confidence: 'medium',
    summary: 'Saved stream pointer used by $F8/$F9 repeat handling.',
    evidence: [
      'Opcode $F8 handler at ROM 0x0C48D stores the current BC stream pointer into stream fields +13/+14 after loading the repeat count.',
      'Opcode $F9 handler at ROM 0x0C49F reloads BC from stream fields +13/+14 while the repeat counter remains nonzero.',
    ],
  },
  {
    offset: 0x0F,
    name: 'repeat_counter',
    confidence: 'medium',
    summary: 'Loop counter written by $F8 and decremented by $F9.',
    evidence: [
      'Opcode $F8 handler at ROM 0x0C48D stores the repeat count into stream field +15.',
      'Opcode $F9 handler at ROM 0x0C49F decrements stream field +15 before deciding whether to reload the saved repeat-body pointer.',
    ],
  },
  {
    offset: 0x10,
    name: 'single_stream_parameter',
    confidence: 'medium',
    summary: 'Single stream parameter field written or adjusted by $F3/$F4.',
    evidence: [
      'Opcode $F3 handler at ROM 0x0C3EF adjusts L from entry field +6 to stream field +16 and stores the current control byte there.',
      'Opcode $F4 handler at ROM 0x0C3FD adjusts the same field by the current control byte and clamps the result to $0F when the handler bit test requires it.',
    ],
  },
  {
    offset: 0x11,
    size: 2,
    name: 'call_return_pointer',
    confidence: 'high',
    summary: 'Saved caller continuation pointer used by $F6 call-stream and the shared $F7/$FB-$FF return/end handler.',
    evidence: [
      'Opcode $F6 handler at ROM 0x0C427 stores the current BC stream pointer into stream fields +17/+18 before loading the call target pointer.',
      'The shared $F7/$FB-$FF handler at ROM 0x0C441 reloads BC from stream fields +17/+18 on its saved-return path.',
    ],
  },
  {
    offset: 0x13,
    name: 'call_repeat_control_counter',
    confidence: 'medium',
    summary: 'Control byte shared by the $F6 call path and the $F7/$FB-$FF repeat/return/end handler.',
    evidence: [
      'Opcode $F6 handler at ROM 0x0C427 stores the byte after its pointer argument into stream field +19.',
      'The shared $F7/$FB-$FF handler at ROM 0x0C441 tests and decrements stream field +19 before choosing saved-return, stream-end, or follow-up parsing paths.',
      'ASM lines 21812-21815 clear stream field +19 during the reset flag path.',
    ],
  },
  {
    offset: 0x19,
    name: 'psg_instrument_or_effect_cache',
    confidence: 'medium',
    summary: 'PSG update cache/input field passed as HL to the PSG channel update routine for the first four hardware channels.',
    evidence: [
      'ASM lines 22155-22175 call _LABEL_C50E_ with HL set to _RAM_C119_, _RAM_C139_, _RAM_C159_, and _RAM_C179_.',
      'ASM lines 22201-22216 compare this byte with IY+6 and use it to select audio support data when it changes.',
    ],
  },
];

const HARDWARE_FIELDS = [
  {
    offset: 0x00,
    name: 'hardware_flags',
    confidence: 'high',
    summary: 'Per-hardware-channel state flags consumed by both PSG and FM update paths.',
    evidence: [
      'ASM lines 22190-22196 test IY+0 flags before the PSG update path continues.',
      'ASM lines 22651-22657 test IY+0 flags before the FM update path continues.',
    ],
  },
  {
    offset: 0x01,
    name: 'volume_or_attenuation',
    confidence: 'high',
    summary: 'Channel volume/attenuation value consumed by PSG and FM output routines.',
    evidence: [
      'ASM lines 22072-22102 write a bounded value into IY+1 from the stream interpreter.',
      'ASM lines 22391-22413 combine IY+1 with stream volume nibbles before writing Port_PSG.',
      'ASM lines 22668-22704 compare IY+1 and fold it into FM register data.',
    ],
  },
  {
    offset: 0x02,
    size: 2,
    name: 'pitch_accumulator_or_period',
    confidence: 'medium',
    summary: 'Pitch/period state used with stream pitch deltas before PSG/FM frequency writes.',
    evidence: [
      'ASM lines 22291-22325 combine IY+2/IY+3 with IY+4/IY+5 before writing the PSG tone period.',
      'ASM lines 22895-22931 combine IY+2/IY+3 with IY+4/IY+5 before writing FM pitch registers.',
    ],
  },
  {
    offset: 0x04,
    size: 2,
    name: 'pitch_delta_or_step',
    confidence: 'medium',
    summary: 'Pitch delta/step pair loaded from stream data and consumed by PSG/FM frequency update paths.',
    evidence: [
      'ASM lines 22274-22282 copy a stream triple into the active channel struct and IY+4/IY+5 for PSG pitch updates.',
      'ASM lines 22875-22883 perform the same copy for FM pitch updates.',
    ],
  },
  {
    offset: 0x06,
    name: 'instrument_or_effect_id',
    confidence: 'medium',
    summary: 'Instrument/effect selector compared against per-stream cache fields before loading support table data.',
    evidence: [
      'ASM lines 22201-22216 compare IY+6 with the PSG cache byte and index support data on changes.',
      'ASM lines 22747-22768 compare IY+6 before loading FM instrument/operator support data.',
    ],
  },
];

const GLOBAL_RAM = [
  {
    address: 0xC220,
    role: 'active_audio_channel_index',
    confidence: 'high',
    summary: 'Scratch channel index set before each stream update and used to derive PSG/FM register targets.',
    evidence: [
      'ASM lines 21721-21768 set _RAM_C220_ to 0-7 while dispatching the eight stream channels.',
      'ASM lines 22155-22175 set _RAM_C220_ to 0-3 while dispatching PSG hardware channels.',
      'ASM lines 22596-22616 set _RAM_C220_ to 0-3 while dispatching FM hardware channels.',
      'PSG/FM port writers repeatedly read _RAM_C220_ to derive channel-specific register values.',
    ],
  },
  {
    address: 0xC221,
    role: 'queued_audio_request_count',
    confidence: 'high',
    summary: 'Count of queued song/SFX requests consumed by the per-frame audio update path.',
    evidence: [
      'ASM lines 21661-21668 read _RAM_C221_ and use it as the loop count for queued audio requests.',
      'ASM lines 21715-21719 clear _RAM_C221_ after queued requests have been applied.',
    ],
  },
  {
    address: 0xC222,
    role: 'queued_audio_request_ids',
    confidence: 'high',
    summary: 'Base of queued song/SFX ids; each id indexes the _DATA_D139_ audio pointer table.',
    evidence: [
      'ASM lines 21670-21683 add the queue index to _RAM_C222_, read the selected id, index _DATA_D139_, and follow the resulting song/SFX header pointer.',
      'ASM line 23207 documents _DATA_D139_ as a 62-entry pointer table indexed by _RAM_C222_.',
    ],
  },
  {
    address: 0xC232,
    role: 'audio_output_mode_select',
    confidence: 'high',
    summary: 'Audio output path selector; bit 0 chooses between PSG and FM update dispatch after stream state has been advanced.',
    evidence: [
      'ASM lines 21769-21777 read _RAM_C232_; bit 0 clear dispatches _LABEL_C4C1_ and bit 0 set dispatches _LABEL_C78F_.',
      '_LABEL_C4C1_ writes PSG ports, and _LABEL_C78F_ dispatches FM port-writing update routines.',
    ],
  },
  {
    address: 0xC237,
    role: 'audio_priority_table_member',
    confidence: 'medium',
    summary: 'One byte inside the eight-byte priority table at $C233-$C23A used while selecting whether a new audio request may take over a channel.',
    evidence: [
      'ASM lines 21609-21627 use address $C233 plus the song header channel id as a per-channel priority byte.',
      '$C237 is the fifth byte in that $C233-$C23A priority range.',
    ],
  },
  {
    address: 0xC23B,
    role: 'audio_load_busy_flag',
    confidence: 'high',
    summary: 'Song/SFX load guard; immediate audio load sets it, and the frame update returns while bit 0 is set.',
    evidence: [
      'ASM line 21591 sets _RAM_C23B_ before immediate song/SFX header loading.',
      'ASM line 21654 clears _RAM_C23B_ after the load completes.',
      'ASM lines 21657-21660 return from the per-frame update path while bit 0 of _RAM_C23B_ is set.',
    ],
  },
  {
    address: 0xC23C,
    role: 'psg_volume_bias_shared_byte',
    confidence: 'medium',
    summary: 'Shared byte read as a PSG volume/attenuation bias by the audio driver; it is also used by non-audio palette/cycle code elsewhere.',
    evidence: [
      'ASM lines 22086-22102 add _RAM_C23C_ to the stream volume before storing IY+1.',
      'ASM lines 22398-22413 add _RAM_C23C_ before a PSG volume write.',
      'ASM lines 22428-22443 and 22570-22585 do the same in PSG refresh/envelope paths.',
      'ASM lines 2129-2148 also update _RAM_C23C_ from a non-audio lookup, so this byte should remain marked as shared.',
    ],
  },
];

const PRIORITY_TABLE = {
  address: 0xC233,
  size: 8,
  role: 'audio_channel_priority_table',
  confidence: 'high',
  summary: 'Per-channel priority bytes used by immediate song/SFX loading before overwriting channel stream state.',
  evidence: [
    'ASM lines 21602-21627 read each song/SFX header channel id, compute $C233 + channel id, compare the current priority byte, and store the accepted request priority there.',
    'The table is indexed by the same channel id that also selects the $C100 + channel*0x20 stream struct.',
  ],
};

function hex(n, pad = 4) {
  return '$' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeAddress(address) {
  return String(address || '').toUpperCase().replace(/^0X/, '$');
}

function findRamEntry(mapData, address) {
  const normalized = hex(address);
  return (mapData.ram || []).find(entry => normalizeAddress(entry.address) === normalized) || null;
}

function ramRef(entry) {
  if (!entry) return null;
  return {
    id: entry.id,
    address: entry.address,
    size: entry.size || 0,
    type: entry.type || '',
    name: entry.name || '',
  };
}

function buildStreamChannels(mapData) {
  return STREAM_CHANNEL_BASES.map((base, index) => ({
    index,
    baseAddress: hex(base),
    range: [hex(base), hex(base + 0x1F)],
    structSize: 0x20,
    hardwareShadowIndex: index & 3,
    overlayGroup: index < 4 ? 'primary_stream_group' : 'secondary_stream_group',
    baseRam: ramRef(findRamEntry(mapData, base)),
    psgCacheRam: index < 4 ? ramRef(findRamEntry(mapData, base + 0x19)) : null,
    evidence: [
      'ASM lines 21628-21635 multiply the song/SFX header channel id by 0x20 and use it as an offset from $C100.',
      'ASM lines 21721-21768 enumerate stream bases _RAM_C100_, _RAM_C120_, _RAM_C140_, _RAM_C160_, _RAM_C180_, _RAM_C1A0_, _RAM_C1C0_, and _RAM_C1E0_.',
    ],
  }));
}

function buildHardwareShadows(mapData) {
  return HARDWARE_SHADOW_BASES.map((base, index) => ({
    index,
    baseAddress: hex(base),
    range: [hex(base), hex(base + 0x07)],
    structSize: 0x08,
    streamChannels: [index, index + 4],
    baseRam: ramRef(findRamEntry(mapData, base)),
    evidence: [
      'ASM lines 21721-21768 pass IY as one of _RAM_C200_, _RAM_C208_, _RAM_C210_, or _RAM_C218_ while advancing stream state.',
      'ASM lines 22155-22175 pass the same four IY bases to the PSG update dispatcher.',
      'ASM lines 22596-22616 pass the same four IY bases to the FM update dispatcher.',
    ],
  }));
}

function buildCatalog(mapData) {
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-audio-ram-state-audit.mjs',
    driverRoutines: {
      streamInterpreter: '_LABEL_C191_',
      immediateRequestLoader: '_LABEL_C04D_',
      queuedRequestLoader: '_LABEL_C09F_',
      psgDispatch: '_LABEL_C4C1_',
      fmDispatch: '_LABEL_C78F_',
    },
    songHeaderRecord: {
      size: 4,
      fields: [
        { offset: 0, name: 'channel_id', summary: 'Selects stream struct at $C100 + channel_id * 0x20 and priority byte at $C233 + channel_id.' },
        { offset: 1, name: 'priority', summary: 'Compared with $C233 + channel_id before accepting immediate requests.' },
        { offset: 2, size: 2, name: 'stream_pointer', summary: 'Copied into stream struct fields +5/+6.' },
      ],
      terminator: 'record whose first byte has high nibble 0xF',
      evidence: [
        'ASM lines 21602-21607 end immediate header parsing when the record first byte has high nibble $F0.',
        'ASM lines 21608-21627 treat record byte 0 as channel id and record byte 1 as priority.',
        'ASM lines 21641-21648 copy record bytes 2 and 3 into stream fields +5/+6.',
        'ASM lines 21685-21712 use the same record layout for queued audio requests.',
      ],
    },
    streamChannelStruct: {
      base: '$C100',
      count: 8,
      stride: 0x20,
      fields: STREAM_FIELDS,
      channels: buildStreamChannels(mapData),
    },
    hardwareShadowStruct: {
      bases: HARDWARE_SHADOW_BASES.map(address => hex(address)),
      count: 4,
      stride: 0x08,
      fields: HARDWARE_FIELDS,
      channels: buildHardwareShadows(mapData),
    },
    priorityTable: {
      ...PRIORITY_TABLE,
      address: hex(PRIORITY_TABLE.address),
      range: [hex(PRIORITY_TABLE.address), hex(PRIORITY_TABLE.address + PRIORITY_TABLE.size - 1)],
      memberRamEntries: (mapData.ram || [])
        .filter(entry => {
          const addr = parseInt(normalizeAddress(entry.address).replace('$', ''), 16);
          return addr >= PRIORITY_TABLE.address && addr < PRIORITY_TABLE.address + PRIORITY_TABLE.size;
        })
        .map(ramRef),
    },
    globalRam: GLOBAL_RAM.map(item => ({
      ...item,
      address: hex(item.address),
      ram: ramRef(findRamEntry(mapData, item.address)),
    })),
    summary: {
      streamChannels: STREAM_CHANNEL_BASES.length,
      hardwareShadowChannels: HARDWARE_SHADOW_BASES.length,
      streamStructBytes: STREAM_CHANNEL_BASES.length * 0x20,
      hardwareShadowBytes: HARDWARE_SHADOW_BASES.length * 0x08,
      globalRamItems: GLOBAL_RAM.length,
      priorityTableBytes: PRIORITY_TABLE.size,
      assetPolicy: 'Metadata only: RAM addresses, field names, ASM line evidence, routine labels, and struct layout. No ROM bytes, decoded music, or audio samples are embedded.',
    },
  };
}

function annotateEntry(entry, audit) {
  entry.analysis = entry.analysis || {};
  entry.analysis.audioRamStateAudit = audit;
}

function annotateMap(mapData, catalog) {
  const annotated = [];
  const missing = [];

  for (const channel of catalog.streamChannelStruct.channels) {
    const address = parseInt(channel.baseAddress.replace('$', ''), 16);
    const entry = findRamEntry(mapData, address);
    if (!entry) {
      missing.push({ address: channel.baseAddress, role: 'audio_stream_channel_struct_base', index: channel.index });
      continue;
    }
    annotateEntry(entry, {
      catalogId,
      kind: 'audio_stream_channel_struct_base',
      confidence: 'high',
      channelIndex: channel.index,
      structRange: channel.range,
      structSize: channel.structSize,
      hardwareShadowIndex: channel.hardwareShadowIndex,
      overlayGroup: channel.overlayGroup,
      summary: `Base of audio stream channel ${channel.index}; struct stride is 0x20 bytes.`,
      evidence: channel.evidence,
      generatedAt: now,
      tool: 'tools/world-audio-ram-state-audit.mjs',
    });
    annotated.push({ id: entry.id, address: entry.address, kind: 'audio_stream_channel_struct_base', channelIndex: channel.index });

    if (channel.psgCacheRam) {
      const fieldEntry = findRamEntry(mapData, address + 0x19);
      annotateEntry(fieldEntry, {
        catalogId,
        kind: 'audio_stream_channel_field',
        confidence: 'medium',
        channelIndex: channel.index,
        fieldOffset: '+0x19',
        fieldName: 'psg_instrument_or_effect_cache',
        structBase: channel.baseAddress,
        summary: 'PSG cache/input field passed as HL to _LABEL_C50E_.',
        evidence: STREAM_FIELDS.find(field => field.offset === 0x19).evidence,
        generatedAt: now,
        tool: 'tools/world-audio-ram-state-audit.mjs',
      });
      annotated.push({ id: fieldEntry.id, address: fieldEntry.address, kind: 'audio_stream_channel_field', channelIndex: channel.index, fieldName: 'psg_instrument_or_effect_cache' });
    }
  }

  for (const channel of catalog.hardwareShadowStruct.channels) {
    const address = parseInt(channel.baseAddress.replace('$', ''), 16);
    const entry = findRamEntry(mapData, address);
    if (!entry) {
      missing.push({ address: channel.baseAddress, role: 'audio_hardware_shadow_struct_base', index: channel.index });
      continue;
    }
    annotateEntry(entry, {
      catalogId,
      kind: 'audio_hardware_shadow_struct_base',
      confidence: 'high',
      hardwareShadowIndex: channel.index,
      structRange: channel.range,
      structSize: channel.structSize,
      streamChannels: channel.streamChannels,
      summary: `Base of audio hardware shadow channel ${channel.index}; shared by stream channels ${channel.streamChannels.join(' and ')}.`,
      evidence: channel.evidence,
      generatedAt: now,
      tool: 'tools/world-audio-ram-state-audit.mjs',
    });
    annotated.push({ id: entry.id, address: entry.address, kind: 'audio_hardware_shadow_struct_base', hardwareShadowIndex: channel.index });
  }

  for (const item of GLOBAL_RAM) {
    const entry = findRamEntry(mapData, item.address);
    if (!entry) {
      missing.push({ address: hex(item.address), role: item.role });
      continue;
    }
    annotateEntry(entry, {
      catalogId,
      kind: item.role,
      confidence: item.confidence,
      summary: item.summary,
      evidence: item.evidence,
      generatedAt: now,
      tool: 'tools/world-audio-ram-state-audit.mjs',
    });
    annotated.push({ id: entry.id, address: entry.address, kind: item.role });
  }

  return { annotated, missing };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const changes = apply ? annotateMap(mapData, catalog) : {
    annotated: [
      ...catalog.streamChannelStruct.channels.map(channel => ({ address: channel.baseAddress, kind: 'audio_stream_channel_struct_base', channelIndex: channel.index })),
      ...catalog.hardwareShadowStruct.channels.map(channel => ({ address: channel.baseAddress, kind: 'audio_hardware_shadow_struct_base', hardwareShadowIndex: channel.index })),
      ...catalog.globalRam.map(item => ({ address: item.address, kind: item.role })),
    ],
    missing: [],
  };

  if (apply) {
    mapData.audioCatalogs = (mapData.audioCatalogs || []).filter(item => item.id !== catalogId);
    mapData.audioCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'audio_ram_state_audit',
      generatedAt: now,
      tool: 'tools/world-audio-ram-state-audit.mjs --apply',
      schemaVersion: 1,
      summary: {
        ...catalog.summary,
        annotatedRamEntries: changes.annotated.length,
        missingRamEntries: changes.missing.length,
      },
      annotatedRamEntries: changes.annotated,
      missingRamEntries: changes.missing,
      nextLeads: [
        'Resolve the remaining stream-channel field offsets in _LABEL_C191_ by tracing each IX/HL relative write through one full event parse.',
        'Connect parsed music stream opcodes to the stream struct fields they mutate, especially flags, delay, volume, and pitch-step fields.',
        'Use this RAM model to build a read-only PSG/FM frame trace before implementing a browser sound player.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    annotatedRamEntries: changes.annotated,
    missingRamEntries: changes.missing,
  }, null, 2));
}

main();
