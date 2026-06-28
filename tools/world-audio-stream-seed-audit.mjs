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
const catalogId = 'world-audio-stream-seed-catalog-2026-06-25';
const reportId = 'audio-stream-seed-audit-2026-06-25';
const toolName = 'tools/world-audio-stream-seed-audit.mjs';

const audioCatalogId = 'world-audio-catalog-2026-06-24';
const graphCatalogId = 'world-audio-stream-graph-catalog-2026-06-25';
const ramCatalogId = 'world-audio-ram-state-catalog-2026-06-25';
const frameGateCatalogId = 'world-audio-frame-gate-catalog-2026-06-25';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === id);
    if (found) return found;
  }
  return null;
}

function requireCatalog(mapData, id) {
  const catalog = findCatalog(mapData, id);
  if (!catalog) throw new Error(`Missing required catalog ${id}`);
  return catalog;
}

function parseHex(value) {
  if (typeof value === 'number') return value;
  const match = String(value || '').match(/^(?:0x|\$)?([0-9a-f]+)$/i);
  return match ? parseInt(match[1], 16) : null;
}

function hex(value, pad = 5) {
  return `0x${value.toString(16).toUpperCase().padStart(pad, '0')}`;
}

function ramHex(value) {
  return `$${value.toString(16).toUpperCase().padStart(4, '0')}`;
}

function fieldByName(ramCatalog, name) {
  return (ramCatalog.streamChannelStruct?.fields || []).find(field => field.name === name) || null;
}

function streamChannelBase(channelId) {
  return 0xC100 + channelId * 0x20;
}

function priorityAddress(channelId) {
  return 0xC233 + channelId;
}

function streamFieldRef(ramCatalog, channelId, fieldName) {
  const field = fieldByName(ramCatalog, fieldName);
  const base = streamChannelBase(channelId);
  const offset = field?.offset ?? null;
  return {
    kind: 'stream_field',
    channelId,
    channelIdHex: hex(channelId, 2),
    fieldName,
    offset,
    size: field?.size || 1,
    address: offset == null ? null : ramHex(base + offset),
    confidence: field?.confidence || 'medium',
  };
}

function priorityFieldRef(channelId) {
  return {
    kind: 'priority_table_member',
    channelId,
    channelIdHex: hex(channelId, 2),
    address: ramHex(priorityAddress(channelId)),
    tableBase: '$C233',
    relationship: 'priority byte compared/stored by immediate request loader before stream takeover',
    confidence: 'high',
  };
}

function graphByRequestId(graphCatalog) {
  const out = new Map();
  for (const graph of graphCatalog.graphs || []) out.set(graph.requestId, graph);
  return out;
}

function rootChannelById(graph) {
  const out = new Map();
  for (const channel of graph?.rootChannels || []) out.set(channel.channelId, channel);
  return out;
}

function buildChannelSeed(song, channel, graphChannel, ramCatalog) {
  const channelId = channel.channelId;
  const streamRomOffset = parseHex(channel.streamRomOffset);
  const streamZ80 = parseHex(channel.streamZ80);
  const validChannel = Number.isInteger(channelId) && channelId >= 0 && channelId < 8;
  const streamFlags = validChannel ? streamFieldRef(ramCatalog, channelId, 'stream_flags') : null;
  const currentPointer = validChannel ? streamFieldRef(ramCatalog, channelId, 'current_stream_pointer') : null;

  return {
    requestId: song.index,
    requestIdHex: hex(song.index, 2),
    headerOffset: song.romOffset,
    headerRegion: song.region || null,
    recordIndex: channel.index,
    recordOffset: channel.headerOffset,
    channelId,
    channelIdHex: channel.channelIdHex,
    validChannel,
    streamBaseAddress: validChannel ? ramHex(streamChannelBase(channelId)) : null,
    hardwareShadowIndex: validChannel ? channelId & 0x03 : null,
    priority: channel.priority,
    priorityHex: channel.priorityHex,
    streamPointer: {
      z80Address: channel.streamZ80,
      romOffset: channel.streamRomOffset,
      streamRegion: channel.streamRegion || null,
      rootMatchesGraph: graphChannel?.rootStreamOffset === channel.streamRomOffset,
    },
    immediateRequestLoader: {
      routineLabel: '_LABEL_C04D_',
      acceptanceRule: 'accept when current_priority <= request_priority; skip this record when current_priority > request_priority',
      priorityRead: validChannel ? priorityFieldRef(channelId) : null,
      priorityWrite: validChannel ? {
        ...priorityFieldRef(channelId),
        value: channel.priorityHex,
        valueMeaning: 'request priority from header record byte 1',
        condition: 'record accepted by priority comparison',
      } : null,
      streamWrites: validChannel ? [
        {
          ...streamFlags,
          value: '0x11',
          valueMeaning: 'bit 0 active and bit 4 reset/pointer reload pending',
          condition: 'record accepted by priority comparison',
        },
        {
          ...currentPointer,
          value: channel.streamZ80,
          romOffset: streamRomOffset == null ? null : hex(streamRomOffset),
          valueMeaning: 'bank-3 stream pointer copied from header record bytes 2-3',
          condition: 'record accepted by priority comparison',
        },
      ] : [],
    },
    queuedRequestLoader: {
      routineLabel: '_LABEL_C09F_',
      priorityComparison: 'not performed in the queued request loop',
      streamWrites: validChannel ? [
        {
          ...streamFlags,
          value: '0x11',
          valueMeaning: 'bit 0 active and bit 4 reset/pointer reload pending',
        },
        {
          ...currentPointer,
          value: channel.streamZ80,
          romOffset: streamRomOffset == null ? null : hex(streamRomOffset),
          valueMeaning: 'bank-3 stream pointer copied from header record bytes 2-3',
        },
      ] : [],
    },
    initialFrameGateImplication: {
      sourceCatalogId: frameGateCatalogId,
      expectedOutcome: 'fetch_reset_path',
      reason: 'Seeded stream_flags value 0x11 has active bit 0 and reset bit 4 set; _LABEL_C191_ clears reset fields and fetches from current_stream_pointer on the next channel update.',
      confidence: 'high',
    },
    validation: {
      streamZ80IsBank3Pointer: streamZ80 != null && streamZ80 >= 0x8000 && streamZ80 < 0xC000,
      streamRomOffsetMatchesZ80: streamZ80 == null || streamRomOffset == null
        ? false
        : streamRomOffset === streamZ80 + 0x4000,
      graphRootMatchesHeader: graphChannel?.rootStreamOffset === channel.streamRomOffset,
    },
  };
}

function buildCatalog(mapData) {
  const audioCatalog = requireCatalog(mapData, audioCatalogId);
  const graphCatalog = requireCatalog(mapData, graphCatalogId);
  const ramCatalog = requireCatalog(mapData, ramCatalogId);
  requireCatalog(mapData, frameGateCatalogId);

  const graphs = graphByRequestId(graphCatalog);
  const requests = [];
  const validationIssues = [];
  let headerChannelSeedCount = 0;
  let invalidChannelIdCount = 0;
  let graphRootMismatchCount = 0;
  let nonBank3PointerCount = 0;
  let requestWithNoChannelCount = 0;
  const seededChannelIds = new Set();
  const priorityValues = new Set();

  for (const song of audioCatalog.songs || []) {
    const graph = graphs.get(song.index) || null;
    if (!graph) validationIssues.push(`Missing stream graph for request ${hex(song.index, 2)}`);
    const graphChannels = rootChannelById(graph);
    const seedChannels = [];
    for (const channel of song.header?.channels || []) {
      const seed = buildChannelSeed(song, channel, graphChannels.get(channel.channelId), ramCatalog);
      seedChannels.push(seed);
      headerChannelSeedCount++;
      if (seed.validChannel) seededChannelIds.add(seed.channelId);
      else invalidChannelIdCount++;
      if (channel.priorityHex) priorityValues.add(channel.priorityHex);
      if (!seed.validation.graphRootMatchesHeader) graphRootMismatchCount++;
      if (!seed.validation.streamZ80IsBank3Pointer || !seed.validation.streamRomOffsetMatchesZ80) nonBank3PointerCount++;
    }
    if (!seedChannels.length) requestWithNoChannelCount++;
    requests.push({
      requestId: song.index,
      requestIdHex: hex(song.index, 2),
      tableEntryOffset: song.tableEntryOffset,
      headerOffset: song.romOffset,
      headerRegion: song.region || null,
      headerBytes: song.header?.headerBytes ?? null,
      terminatorOffset: song.header?.terminatorOffset || null,
      terminatorByte: song.header?.terminatorByte || null,
      channelSeedCount: seedChannels.length,
      classification: graph?.classification || null,
      seedChannels,
    });
  }

  if (invalidChannelIdCount) validationIssues.push(`${invalidChannelIdCount} header channel id(s) are outside 0-7`);
  if (graphRootMismatchCount) validationIssues.push(`${graphRootMismatchCount} header stream pointer(s) do not match stream graph roots`);
  if (nonBank3PointerCount) validationIssues.push(`${nonBank3PointerCount} stream pointer(s) are not validated bank-3 ROM pointers`);

  const loaderSemantics = {
    immediateRequestLoader: {
      routineLabel: '_LABEL_C04D_',
      routineRomOffset: '0x0C04D',
      busyFlag: {
        address: '$C23B',
        setValue: '0x01',
        clearValue: '0x00',
        evidence: [
          'ASM lines 21589-21591 set _RAM_C23B_ before immediate request loading.',
          'ASM lines 21652-21655 clear _RAM_C23B_ after the header terminator is reached.',
        ],
      },
      requestTable: {
        label: '_DATA_D139_',
        romOffset: '0x0D139',
        entrySize: 2,
        requestIndexSource: 'C register',
        evidence: [
          'ASM lines 21592-21600 index _DATA_D139_ with C*2 and follow the selected request header pointer.',
        ],
      },
      headerLoop: {
        recordSize: 4,
        terminator: 'record byte 0 with high nibble 0xF0',
        priorityRule: 'accept when current_priority <= request_priority; skip when current_priority > request_priority',
        evidence: [
          'ASM lines 21602-21607 stop the header loop when record byte 0 has high nibble 0xF0.',
          'ASM lines 21608-21627 compute $C233 + channel_id, compare the existing priority with header byte 1, and store the accepted priority.',
          'ASM lines 21628-21648 compute $C100 + channel_id*0x20, write stream_flags=0x11, and copy the stream pointer into fields +5/+6.',
        ],
      },
    },
    queuedRequestLoader: {
      routineLabel: '_LABEL_C09F_',
      routineRomOffset: '0x0C09F',
      queueCountRam: '$C221',
      queueIdsBaseRam: '$C222',
      priorityRule: 'queued request loop seeds stream flags and pointer without the immediate priority comparison path',
      evidence: [
        'ASM lines 21657-21668 read _RAM_C221_ as queued request count and iterate _RAM_C222_ request ids.',
        'ASM lines 21670-21683 index _DATA_D139_ through each queued request id.',
        'ASM lines 21684-21713 walk header records, skip the priority byte, write stream_flags=0x11, and copy the stream pointer into fields +5/+6.',
        'ASM lines 21715-21719 clear _RAM_C221_ after queued requests are applied.',
      ],
    },
    firstInterpreterFrame: {
      routineLabel: '_LABEL_C191_',
      sourceCatalogId: frameGateCatalogId,
      summary: 'Seeded stream_flags=0x11 makes the next stream update active and routes through the reset-bit path before fetching the first event.',
      evidence: [
        'ASM lines 21779-21799 test active bit 0, copy stream_flags into I, and clear reset bit 4 when it is set.',
        'ASM lines 21801-21821 clear reset-time fields and load BC from current_stream_pointer +5/+6.',
        'world-audio-frame-gate-catalog-2026-06-25 models this reset path as fetch_reset_path.',
      ],
    },
  };

  const summary = {
    requestSeedCount: requests.length,
    headerChannelSeedCount,
    uniqueSeededChannelIds: [...seededChannelIds].sort((a, b) => a - b).map(id => hex(id, 2)),
    distinctPriorityValues: [...priorityValues].sort(),
    requestWithNoChannelCount,
    invalidChannelIdCount,
    graphRootMismatchCount,
    nonBank3PointerCount,
    validationIssueCount: validationIssues.length,
    assetPolicy: 'Metadata only: request ids, header offsets, RAM addresses, field names, pointer offsets, priority values, formulas, and ASM evidence. No ROM bytes, decoded music, audio samples, or generated audio are embedded.',
  };

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [audioCatalogId, graphCatalogId, ramCatalogId, frameGateCatalogId],
    assetPolicy: summary.assetPolicy,
    summary,
    loaderSemantics,
    requests,
    validationIssues,
    evidence: [
      'world-audio-catalog-2026-06-24 parses _DATA_D139_ request headers into channel id, priority, and stream pointer metadata.',
      'world-audio-ram-state-catalog-2026-06-25 names the stream_flags and current_stream_pointer fields seeded by the loaders.',
      'world-audio-stream-graph-catalog-2026-06-25 validates that header stream pointers are graph roots.',
      'The catalog stores offsets and formulas only; it does not store stream bytes or decoded audio data.',
    ],
  };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);

  if (apply) {
    mapData.audioCatalogs = (mapData.audioCatalogs || []).filter(item => item.id !== catalogId);
    mapData.audioCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'audio_stream_seed_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: catalog.summary,
      loaderSemantics: catalog.loaderSemantics,
      validationIssues: catalog.validationIssues,
      nextLeads: [
        'Use seedChannels to initialize a frame-stepped preview before consuming the first stream event.',
        'Apply the immediate loader priority comparison when simulating overlapping music/SFX request playback.',
        'Use stream_flags=0x11 plus the frame-gate catalog to model the first update as a reset-path fetch.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    validationIssues: catalog.validationIssues,
  }, null, 2));
}

main();
