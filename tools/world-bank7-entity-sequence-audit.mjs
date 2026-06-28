#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const romPath = path.join(repoRoot, "projects/WORLD/Wonder Boy III - The Dragon's Trap (World) (Digital).sms");
const apply = process.argv.includes('--apply');
const now = '2026-06-25T00:00:00Z';
const catalogId = 'world-bank7-entity-sequence-catalog-2026-06-25';
const reportId = 'bank7-entity-sequence-audit-2026-06-25';
const spritePaletteWriterCatalogId = 'world-sprite-palette-writer-catalog-2026-06-25';
const bank7PaletteWriterId = 'sprite_palette_writer_1E200_28669';
const bank7GraphicsLoaderOffset = 0x12337;

const tables = [
  {
    regionId: 'r0749',
    offset: 0x1E337,
    type: 'data_table',
    role: 'unresolved_adjacent_data_before_entity_sequence',
    name: 'unresolved data before bank-7 entity sequence tables',
    confidence: 'low',
    summary: 'Adjacent 41-byte block before the confirmed bank-7 entity sequence tables; no direct consumer is confirmed yet.',
    evidence: [
      'ASM lines 28778-28782 define _DATA_1E337_ immediately before _DATA_1E360_.',
      'Text search finds no executable reference to _DATA_1E337_ outside its definition/current inferred adjacency.',
      'The existing pause-data audit already removed stale screen_prog classification for this block.',
    ],
  },
  {
    regionId: 'r0750',
    offset: 0x1E360,
    type: 'entity_data',
    role: 'bank7_entity_waypoint_triplet_stream',
    name: '_DATA_1E360_ bank-7 entity waypoint triplet stream',
    confidence: 'high',
    summary: '25-byte entity waypoint stream parsed as four 3-word records plus a terminator by _LABEL_1E38A_.',
    evidence: [
      'ASM lines 28723-28724 initialize _RAM_C2B0_ with _DATA_1E360_.',
      'ASM lines 28794-28808 read three words from the _RAM_C2B0_ stream into _RAM_C288_, _RAM_C28A_, and _RAM_C2B8_, then advance _RAM_C2B0_.',
      'ASM lines 28796-28799 reset the stream back to _DATA_1E360_ when a 0xFF terminator is encountered.',
    ],
  },
  {
    regionId: 'r0751',
    offset: 0x1E379,
    type: 'entity_data',
    role: 'bank7_entity_timing_value_stream',
    name: '_DATA_1E379_ bank-7 entity timing/value stream',
    confidence: 'high',
    summary: '17-byte entity timing/value stream parsed as eight byte pairs plus a terminator by _LABEL_1E3A8_.',
    evidence: [
      'ASM lines 28725-28726 initialize _RAM_C2B4_ with _DATA_1E379_.',
      'ASM lines 28818-28831 read duration/value pairs from _RAM_C2B4_ into _RAM_C2BB_ and _RAM_C2BA_, then advance _RAM_C2B4_.',
      'ASM lines 28819-28823 terminate the sequence when a 0xFF byte is reached.',
    ],
  },
];

const routines = [
  {
    regionId: 'r1907',
    role: 'bank7_entity_sequence_controller',
    name: '_LABEL_1E200_ bank-7 entity sequence controller',
    confidence: 'high',
    summary: 'Initializes the bank-7 special entity/cutscene sequence, loads its graphics and palette context, seeds _RAM_C280_ entity state, installs the waypoint/timing streams, and runs the sequence loop until completion.',
    evidence: [
      'ASM lines 28678-28709 load _DATA_12337_ through _LABEL_8FB_, set palette index $19 through _LABEL_10BC_, initialize player/entity coordinates, and rebuild sprites.',
      'ASM lines 28713-28731 initialize _RAM_C280_ entity fields, store _DATA_1E360_ in _RAM_C2B0_, store _DATA_1E379_ in _RAM_C2B4_, and call _LABEL_1E38A_.',
      'ASM lines 28733-28742 loop through _LABEL_1392_, _LABEL_1E3A8_, and _LABEL_6E7_ until _RAM_C280_ bit 0 marks the sequence complete.',
    ],
  },
  {
    regionId: 'r1908',
    role: 'bank7_entity_waypoint_loader',
    name: '_LABEL_1E38A_ bank-7 entity waypoint loader',
    confidence: 'high',
    summary: 'Loads the next three-word waypoint record into entity work fields and wraps at the stream terminator.',
    evidence: [
      'ASM lines 28794-28808 read the _RAM_C2B0_ waypoint stream and update _RAM_C288_, _RAM_C28A_, _RAM_C2B8_, and _RAM_C2B0_.',
    ],
  },
  {
    regionId: 'r2638',
    role: 'bank7_entity_timing_driver',
    name: '_LABEL_1E3A8_ bank-7 entity timing driver',
    confidence: 'high',
    summary: 'Ticks the active timing counter, advances the timing/value stream, updates the entity, and requests sound/effect $2F.',
    evidence: [
      'ASM lines 28810-28817 tick IX+51 and IX+58/_RAM_C2BB_.',
      'ASM lines 28818-28831 parse the next _DATA_1E379_ pair into _RAM_C2BB_ and _RAM_C2BA_.',
      'ASM lines 28833-28850 update movement, request sound/effect $2F, cycle IX+50, and load the next waypoint when the target is reached.',
    ],
  },
];

const ramRoles = [
  ['$C2B0', 'bank7_entity_waypoint_stream_pointer', 'Pointer to the active _DATA_1E360_ waypoint stream.', 'high'],
  ['$C288', 'bank7_entity_waypoint_word_a', 'First word loaded from the active waypoint triplet.', 'high'],
  ['$C28A', 'bank7_entity_waypoint_word_b', 'Second word loaded from the active waypoint triplet.', 'high'],
  ['$C2B8', 'bank7_entity_waypoint_word_c', 'Third word loaded from the active waypoint triplet.', 'high'],
  ['$C2B4', 'bank7_entity_timing_stream_pointer', 'Pointer to the active _DATA_1E379_ timing/value stream.', 'high'],
  ['$C2BB', 'bank7_entity_timing_countdown_reload', 'Timing/countdown value loaded from the timing stream.', 'high'],
  ['$C2BA', 'bank7_entity_timing_value', 'Value loaded from the timing stream and used by the entity update path.', 'high'],
  ['$C2B3', 'bank7_entity_timing_countdown_active', 'Active timing counter copied from _RAM_C2BB_ by the timing driver.', 'medium'],
];

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function hex2(n) {
  return '0x' + n.toString(16).toUpperCase().padStart(2, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function findRegionContainingOffset(mapData, offset) {
  return (mapData.regions || []).find(region => {
    const start = parseInt(String(region.offset || '0').replace(/^0x/i, ''), 16);
    return offset >= start && offset < start + (region.size || 0);
  }) || null;
}

function findRam(mapData, address) {
  return (mapData.ram || []).find(entry => (entry.address || '').toUpperCase() === address.toUpperCase()) || null;
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === id);
    if (found) return found;
  }
  return null;
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

function paletteStateRef(state) {
  if (!state) return null;
  return {
    status: state.status || '',
    index: state.index ?? null,
    indexHex: state.indexHex || null,
    ram: state.ram || '',
    destRam: state.destRam || '',
    record: state.record ? {
      index: state.record.index,
      offset: state.record.offset,
      size: state.record.size,
      region: state.record.region || null,
      confidence: state.record.confidence || 'medium',
    } : null,
  };
}

function writerRef(mapData) {
  const catalog = findCatalog(mapData, spritePaletteWriterCatalogId);
  const writer = (catalog?.writerCallsites || []).find(item => item.id === bank7PaletteWriterId) || null;
  if (!writer) {
    return {
      catalogId: spritePaletteWriterCatalogId,
      writerId: bank7PaletteWriterId,
      found: false,
    };
  }
  return {
    catalogId: spritePaletteWriterCatalogId,
    writerId: writer.id,
    found: true,
    caller: writer.caller,
    action: writer.action,
    contextRole: writer.contextRole,
    contextFamily: writer.contextFamily,
    bgPalette: paletteStateRef(writer.stateEffects?.bgPalette),
    spritePalette: paletteStateRef(writer.stateEffects?.spritePalette),
    evidence: (writer.evidence || []).slice(0, 4),
  };
}

function buildSequenceSetup(mapData) {
  const loaderRegion = findRegionContainingOffset(mapData, bank7GraphicsLoaderOffset);
  const paletteWriter = writerRef(mapData);
  return {
    graphicsLoader: {
      kind: 'vram_loader_8fb',
      routine: '_LABEL_8FB_',
      routineOffset: '0x008FB',
      sourceLabel: '_DATA_12337_',
      romOffset: hex(bank7GraphicsLoaderOffset),
      region: regionRef(loaderRegion),
      callLine: 28662,
      confidence: loaderRegion?.type === 'vram_loader_8fb' ? 'high' : 'medium',
      evidence: [
        'ASM line 28661 loads HL with _DATA_12337_.',
        'ASM line 28662 calls _LABEL_8FB_.',
      ],
    },
    paletteWriter: {
      ...paletteWriter,
      rawHL: '0x0A0A',
      callLine: 28669,
      confidence: paletteWriter.found ? 'high' : 'medium',
      evidence: [
        'ASM line 28668 loads HL with $0A0A.',
        'ASM line 28669 calls _LABEL_8B2_.',
        ...(paletteWriter.evidence || []),
      ],
    },
    paletteScriptState: {
      ram: '_RAM_CF65_',
      value: '0x19',
      routine: '_LABEL_10BC_',
      routineOffset: '0x010BC',
      storeLine: 28675,
      callLine: 28676,
      confidence: 'high',
      evidence: [
        'ASM lines 28674-28676 store $19 in _RAM_CF65_ and call _LABEL_10BC_.',
      ],
    },
    audioOrEffectRequest: {
      requestId: '0x17',
      routine: '_LABEL_5EB_',
      routineOffset: '0x005EB',
      callLine: 28673,
      confidence: 'medium',
      evidence: [
        'ASM lines 28672-28673 load A=$17 and call _LABEL_5EB_; exact sound/effect semantics remain owned by the audio request catalogs.',
      ],
    },
    sequenceStateInit: {
      entityBase: '_RAM_C280_',
      waypointStreamPointerRam: '_RAM_C2B0_',
      waypointStreamLabel: '_DATA_1E360_',
      timingStreamPointerRam: '_RAM_C2B4_',
      timingStreamLabel: '_DATA_1E379_',
      lineRange: '28708-28734',
      confidence: 'high',
      evidence: [
        'ASM lines 28708-28722 initialize the _RAM_C280_ entity object fields.',
        'ASM lines 28723-28726 store _DATA_1E360_ and _DATA_1E379_ stream pointers.',
        'ASM line 28734 calls _LABEL_1E38A_ to load the first waypoint triplet.',
      ],
    },
  };
}

function decodeFixedStrideTerminatedStream(romBytes, start, regionSize, recordStride) {
  const warnings = [];
  if (!romBytes || !romBytes.length) {
    return {
      validated: false,
      status: 'rom_not_loaded',
      recordCount: 0,
      dataBytes: 0,
      terminatorOffset: '',
      terminator: hex2(0xFF),
      warnings: ['ROM bytes were not loaded; stream layout was not validated.'],
    };
  }
  const endExclusive = start + regionSize;
  if (start < 0 || endExclusive > romBytes.length) {
    return {
      validated: false,
      status: 'out_of_range',
      recordCount: 0,
      dataBytes: 0,
      terminatorOffset: '',
      terminator: hex2(0xFF),
      warnings: [`Stream range ${hex(start)}-${hex(endExclusive - 1)} is outside the loaded ROM.`],
    };
  }

  let cursor = start;
  let recordCount = 0;
  while (cursor < endExclusive) {
    if (romBytes[cursor] === 0xFF) {
      const dataBytes = cursor - start;
      if (dataBytes !== recordCount * recordStride) {
        warnings.push(`Decoded byte count ${dataBytes} did not equal ${recordCount} * stride ${recordStride}.`);
      }
      if (cursor !== endExclusive - 1) {
        warnings.push(`Terminator found before the mapped region end (${hex(cursor)} vs ${hex(endExclusive - 1)}).`);
      }
      return {
        validated: warnings.length === 0,
        status: warnings.length ? 'validated_with_warnings' : 'validated',
        recordCount,
        dataBytes,
        recordStrideBytes: recordStride,
        terminatorOffset: hex(cursor),
        endExclusive: hex(cursor + 1),
        terminator: hex2(0xFF),
        warnings,
      };
    }
    if (cursor + recordStride > endExclusive) {
      warnings.push(`Record at ${hex(cursor)} would exceed mapped region end ${hex(endExclusive)}.`);
      break;
    }
    recordCount++;
    cursor += recordStride;
  }

  warnings.push(`No ${hex2(0xFF)} terminator found before mapped region end ${hex(endExclusive)}.`);
  return {
    validated: false,
    status: 'unterminated',
    recordCount,
    dataBytes: Math.max(0, cursor - start),
    recordStrideBytes: recordStride,
    terminatorOffset: '',
    endExclusive: hex(endExclusive),
    terminator: hex2(0xFF),
    warnings,
  };
}

function buildStreamLayouts(mapData, romBytes) {
  const waypointRegion = findRegionById(mapData, 'r0750');
  const timingRegion = findRegionById(mapData, 'r0751');
  const waypointOffset = 0x1E360;
  const timingOffset = 0x1E379;
  const waypointDecoded = decodeFixedStrideTerminatedStream(romBytes, waypointOffset, waypointRegion?.size || 25, 6);
  const timingDecoded = decodeFixedStrideTerminatedStream(romBytes, timingOffset, timingRegion?.size || 17, 2);
  const layouts = {
    waypointTripletStream: {
      sourceLabel: '_DATA_1E360_',
      romOffset: hex(waypointOffset),
      region: regionRef(waypointRegion),
      consumerRoutine: '_LABEL_1E38A_',
      consumerRoutineOffset: '0x1E38A',
      pointerRam: '_RAM_C2B0_',
      recordStrideBytes: 6,
      recordLayout: [
        { field: 'word0', sizeBytes: 2, readBy: 'rst $10 / _LABEL_10_', destinationRam: '_RAM_C288_' },
        { field: 'word1', sizeBytes: 2, readBy: 'rst $10 / _LABEL_10_', destinationRam: '_RAM_C28A_' },
        { field: 'word2', sizeBytes: 2, readBy: 'rst $10 / _LABEL_10_', destinationRam: '_RAM_C2B8_' },
      ],
      terminator: hex2(0xFF),
      decoded: waypointDecoded,
      storedValues: 'omitted_metadata_only',
      confidence: waypointDecoded.validated ? 'high' : 'medium',
      evidence: [
        'ASM lines 28794-28808: _LABEL_1E38A_ reads a 0xFF terminator check, then three little-endian words via rst $10.',
        `ROM-local validation found ${waypointDecoded.recordCount} six-byte waypoint triplet record(s) before the terminator.`,
      ],
    },
    timingValueStream: {
      sourceLabel: '_DATA_1E379_',
      romOffset: hex(timingOffset),
      region: regionRef(timingRegion),
      consumerRoutine: '_LABEL_1E3A8_',
      consumerRoutineOffset: '0x1E3A8',
      pointerRam: '_RAM_C2B4_',
      recordStrideBytes: 2,
      recordLayout: [
        { field: 'durationReload', sizeBytes: 1, destinationRam: '_RAM_C2BB_' },
        { field: 'timingValue', sizeBytes: 1, destinationRam: '_RAM_C2BA_' },
      ],
      terminator: hex2(0xFF),
      decoded: timingDecoded,
      storedValues: 'omitted_metadata_only',
      confidence: timingDecoded.validated ? 'high' : 'medium',
      evidence: [
        'ASM lines 28818-28831: _LABEL_1E3A8_ reads a 0xFF terminator check, then duration/value bytes into _RAM_C2BB_ and _RAM_C2BA_.',
        `ROM-local validation found ${timingDecoded.recordCount} two-byte timing/value record(s) before the terminator.`,
      ],
    },
  };
  return {
    ...layouts,
    byRegionId: {
      r0750: layouts.waypointTripletStream,
      r0751: layouts.timingValueStream,
    },
    summary: {
      validatedStreamCount: [waypointDecoded, timingDecoded].filter(decoded => decoded.validated).length,
      streamCount: 2,
      waypointRecordCount: waypointDecoded.recordCount,
      timingRecordCount: timingDecoded.recordCount,
      warningCount: waypointDecoded.warnings.length + timingDecoded.warnings.length,
      assetPolicy: 'Stream layouts and counts only. Record values are decoded transiently for validation and not persisted.',
    },
  };
}

function buildCatalog(mapData, romBytes) {
  const sequenceSetup = buildSequenceSetup(mapData);
  const streamLayouts = buildStreamLayouts(mapData, romBytes);
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-bank7-entity-sequence-audit.mjs',
    sourceCatalogs: [
      ...(sequenceSetup.paletteWriter.found ? [spritePaletteWriterCatalogId] : []),
    ],
    summary: {
      dataRegions: tables.length,
      promotedEntityDataRegions: tables.filter(table => table.type === 'entity_data').length,
      routineCount: routines.length,
      ramVariableCount: ramRoles.length,
      setupStepCount: Object.keys(sequenceSetup).length,
      streamCount: streamLayouts.summary.streamCount,
      validatedStreamCount: streamLayouts.summary.validatedStreamCount,
      streamWarningCount: streamLayouts.summary.warningCount,
      waypointRecordCount: streamLayouts.summary.waypointRecordCount,
      timingRecordCount: streamLayouts.summary.timingRecordCount,
      graphicsLoaderRegionId: sequenceSetup.graphicsLoader.region?.id || '',
      paletteWriterLinked: sequenceSetup.paletteWriter.found,
      paletteWriterId: sequenceSetup.paletteWriter.writerId,
      directBgPaletteIndex: sequenceSetup.paletteWriter.bgPalette?.index ?? null,
      directSpritePaletteIndex: sequenceSetup.paletteWriter.spritePalette?.index ?? null,
      assetPolicy: 'Metadata only: offsets, stream layouts, routine labels, RAM addresses, and evidence. No ROM bytes, decoded graphics, or rendered sequence data are embedded.',
    },
    sequenceSetup,
    streamLayouts: {
      waypointTripletStream: streamLayouts.waypointTripletStream,
      timingValueStream: streamLayouts.timingValueStream,
      summary: streamLayouts.summary,
    },
    tables: tables.map(table => ({
      ...table,
      offset: hex(table.offset),
      streamLayout: streamLayouts.byRegionId[table.regionId],
      region: regionRef(findRegionById(mapData, table.regionId)),
    })),
    routines: routines.map(routine => ({
      ...routine,
      setup: routine.role === 'bank7_entity_sequence_controller' ? sequenceSetup : undefined,
      region: regionRef(findRegionById(mapData, routine.regionId)),
    })),
    ramRoles: ramRoles.map(([address, role, summary, confidence]) => ({ address, role, summary, confidence })),
    evidence: [
      'ASM lines 28660-28676 show the sequence setup path: reset/build state, load _DATA_12337_ through _LABEL_8FB_, set the direct $0A0A palette pair through _LABEL_8B2_, request $17 through _LABEL_5EB_, and run _LABEL_10BC_ with _RAM_CF65_=$19.',
      'ASM lines 28723-28726 store _DATA_1E360_ and _DATA_1E379_ pointers in entity work RAM.',
      'ASM lines 28794-28808 parse _DATA_1E360_ as a three-word waypoint stream.',
      'ASM lines 28818-28831 parse _DATA_1E379_ as timing/value byte pairs.',
      'The audit script validates both stream terminators and record counts from the local ROM, but persists no record values.',
    ],
  };
}

function annotateRegion(region, item) {
  const before = regionRef(region);
  const previousType = region.type || 'unknown';
  if (item.type) region.type = item.type;
  if (item.name && (!region.name || /^_DATA_/.test(region.name))) region.name = item.name;
  if (item.confidence && !region.confidence) region.confidence = item.confidence;
  if (item.summary && (!region.notes || /^Data from /.test(region.notes))) region.notes = item.summary;
  region.analysis = region.analysis || {};
  region.analysis.bank7EntitySequenceAudit = {
    catalogId,
    kind: item.role,
    confidence: item.confidence,
    typeBeforeAudit: previousType,
    typeAfterAudit: region.type || previousType,
    changedType: previousType !== (region.type || previousType),
    summary: item.summary,
    evidence: item.evidence,
    generatedAt: now,
    tool: 'tools/world-bank7-entity-sequence-audit.mjs',
  };
  if (item.setup) {
    region.analysis.bank7EntitySequenceAudit.setup = item.setup;
  }
  if (item.streamLayout) {
    region.analysis.bank7EntitySequenceAudit.streamLayout = item.streamLayout;
  }
  return {
    before,
    after: regionRef(region),
    role: item.role,
    confidence: item.confidence,
    changedType: previousType !== (region.type || previousType),
  };
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
  entry.analysis.bank7EntitySequenceAudit = {
    catalogId,
    kind,
    confidence,
    summary,
    generatedAt: now,
    tool: 'tools/world-bank7-entity-sequence-audit.mjs',
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

function applyAnnotations(mapData, romBytes) {
  const changedRegions = [];
  const missingRegions = [];
  const changedRam = [];
  const missingRam = [];
  const streamLayouts = buildStreamLayouts(mapData, romBytes);

  for (const table of tables) {
    const region = findRegionById(mapData, table.regionId);
    if (!region) {
      missingRegions.push({ id: table.regionId, offset: hex(table.offset), role: table.role });
      continue;
    }
    changedRegions.push(annotateRegion(region, {
      ...table,
      streamLayout: streamLayouts.byRegionId[table.regionId],
    }));
  }

  const sequenceSetup = buildSequenceSetup(mapData);
  for (const routine of routines) {
    const region = findRegionById(mapData, routine.regionId);
    if (!region) {
      missingRegions.push({ id: routine.regionId, role: routine.role });
      continue;
    }
    changedRegions.push(annotateRegion(region, {
      ...routine,
      type: 'code',
      setup: routine.role === 'bank7_entity_sequence_controller' ? sequenceSetup : undefined,
    }));
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
  const mapData = readJson(mapPath);
  const romBytes = fs.readFileSync(romPath);
  const catalog = buildCatalog(mapData, romBytes);
  let changes = { changedRegions: [], missingRegions: [], changedRam: [], missingRam: [] };

  if (apply) {
    changes = applyAnnotations(mapData, romBytes);
    const finalCatalog = buildCatalog(mapData, romBytes);
    mapData.entityDataCatalogs = (mapData.entityDataCatalogs || []).filter(item => item.id !== catalogId);
    mapData.entityDataCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'bank7_entity_sequence_audit',
      generatedAt: now,
      tool: 'tools/world-bank7-entity-sequence-audit.mjs --apply',
      schemaVersion: 1,
      summary: {
        ...finalCatalog.summary,
        changedRegions: changes.changedRegions.length,
        changedRegionTypes: changes.changedRegions.filter(item => item.changedType).length,
        missingRegions: changes.missingRegions.length,
        annotatedRamEntries: changes.changedRam.length,
        missingRamEntries: changes.missingRam.length,
      },
      streamLayouts: finalCatalog.streamLayouts,
      changedRegions: changes.changedRegions,
      missingRegions: changes.missingRegions,
      annotatedRamEntries: changes.changedRam,
      missingRamEntries: changes.missingRam,
      evidence: finalCatalog.evidence,
      nextLeads: [
        'Trace the caller context around _LABEL_1E200_ to name the exact cutscene/entity sequence using these tables.',
        'Resolve _DATA_1E337_ before promoting it beyond low-confidence data_table.',
        'Use the validated stream layouts to build a browser-side decoder/preview that computes values from the local ROM without saving them in map metadata.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    streamLayouts: catalog.streamLayouts,
    tables: catalog.tables.map(table => ({
      regionId: table.regionId,
      offset: table.offset,
      type: table.type,
      role: table.role,
      confidence: table.confidence,
    })),
    routines: catalog.routines.map(routine => ({
      regionId: routine.regionId,
      role: routine.role,
      confidence: routine.confidence,
    })),
    ramRoles: catalog.ramRoles.map(role => ({
      address: role.address,
      role: role.role,
      confidence: role.confidence,
    })),
    changes,
  }, null, 2));
}

main();
