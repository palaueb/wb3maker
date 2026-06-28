#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const asmPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).asm');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-25T00:00:00Z';
const catalogId = 'world-audio-request-taxonomy-catalog-2026-06-25';
const reportId = 'audio-request-taxonomy-audit-2026-06-25';
const toolName = 'tools/world-audio-request-taxonomy-audit.mjs';

const audioCatalogId = 'world-audio-catalog-2026-06-24';
const zoneRecipeCatalogId = 'world-zone-recipe-catalog-2026-06-25';
const inlineTransitionRecipeCatalogId = 'world-inline-transition-recipe-catalog-2026-06-25';
const requestWrapperLabel = '_LABEL_104B_';
const requestTableLabel = '_DATA_D139_';
const requestTableOffset = 0x0D139;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function hexByte(n) {
  return hex(n & 0xff, 2);
}

function parseHex(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const match = String(value).match(/^(?:0x|\$)?([0-9a-f]+)$/i);
  return match ? parseInt(match[1], 16) : null;
}

function offsetOf(region) {
  return typeof region.offset === 'number' ? region.offset : parseInt(region.offset, 16);
}

function labelOffset(label) {
  const match = /^_LABEL_([0-9A-F]+)_$/i.exec(label || '');
  return match ? parseInt(match[1], 16) : null;
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
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

function requireCatalog(mapData, key, id) {
  const catalog = (mapData[key] || []).find(item => item.id === id);
  if (!catalog) throw new Error(`Missing required catalog ${key}.${id}`);
  return catalog;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(value => value != null))].sort((a, b) => a - b);
}

function uniqueSortedStrings(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function countBy(items, getter) {
  const counts = {};
  for (const item of items) {
    const key = getter(item) || 'none';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function emptyRecipeUsage(requestId) {
  return {
    requestId,
    requestIdHex: hexByte(requestId),
    descriptorCount: 0,
    zoneRecipeDescriptorCount: 0,
    inlineTransitionRecipeDescriptorCount: 0,
    sourceCatalogIds: [],
    sampleRecipeIds: [],
    sampleDescriptorOffsets: [],
    sampleZoneRecipeIds: [],
    sampleZoneDescriptorOffsets: [],
    sampleInlineTransitionRecipeIds: [],
    sampleInlineTransitionDescriptorOffsets: [],
  };
}

function noteSourceCatalog(usage, catalogId) {
  if (catalogId && !usage.sourceCatalogIds.includes(catalogId)) usage.sourceCatalogIds.push(catalogId);
  usage.sourceCatalogId = usage.sourceCatalogIds[0] || null;
}

function pushSample(list, value, limit = 12) {
  if (value && list.length < limit && !list.includes(value)) list.push(value);
}

function buildRecipeUsage(mapData) {
  const usageByRequest = new Map();
  for (const recipe of mapData.zoneRecipes || []) {
    const requestId = recipe.dependencies?.audioRequest?.requestId;
    if (requestId == null) continue;
    if (!usageByRequest.has(requestId)) usageByRequest.set(requestId, emptyRecipeUsage(requestId));
    const usage = usageByRequest.get(requestId);
    noteSourceCatalog(usage, zoneRecipeCatalogId);
    usage.descriptorCount++;
    usage.zoneRecipeDescriptorCount++;
    pushSample(usage.sampleRecipeIds, recipe.id);
    pushSample(usage.sampleZoneRecipeIds, recipe.id);
    const descriptorOffset = recipe.descriptor?.romOffset || null;
    pushSample(usage.sampleDescriptorOffsets, descriptorOffset);
    pushSample(usage.sampleZoneDescriptorOffsets, descriptorOffset);
  }

  for (const recipe of mapData.inlineTransitionRecipes || []) {
    const requestId = recipe.dependencies?.audioRequest?.requestId;
    if (requestId == null) continue;
    if (!usageByRequest.has(requestId)) usageByRequest.set(requestId, emptyRecipeUsage(requestId));
    const usage = usageByRequest.get(requestId);
    noteSourceCatalog(usage, inlineTransitionRecipeCatalogId);
    usage.descriptorCount++;
    usage.inlineTransitionRecipeDescriptorCount++;
    pushSample(usage.sampleRecipeIds, recipe.id);
    pushSample(usage.sampleInlineTransitionRecipeIds, recipe.id);
    const descriptorOffset = recipe.descriptor?.romOffset || null;
    pushSample(usage.sampleDescriptorOffsets, descriptorOffset);
    pushSample(usage.sampleInlineTransitionDescriptorOffsets, descriptorOffset);
  }

  for (const usage of usageByRequest.values()) usage.sourceCatalogIds.sort();
  return usageByRequest;
}

function cleanCode(line) {
  return line.split(';')[0].trim();
}

function parseImmediateA(code) {
  if (/^\s*xor\s+a\s*$/i.test(code)) return 0;
  const match = /^\s*ld\s+a,\s*(?:\$([0-9a-f]{1,2})|([0-9]+))\s*$/i.exec(code);
  if (!match) return null;
  return match[1] ? parseInt(match[1], 16) : parseInt(match[2], 10);
}

function parseRegisterImmediate(code, registerName) {
  const escaped = registerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^\\s*ld\\s+${escaped},\\s*(?:\\$([0-9a-f]{1,2})|([0-9]+))\\s*$`, 'i').exec(code);
  if (!match) return null;
  return match[1] ? parseInt(match[1], 16) : parseInt(match[2], 10);
}

function parseRegisterMoveToA(code) {
  const match = /^\s*ld\s+a,\s*([bcdehl])\s*$/i.exec(code);
  return match ? match[1].toLowerCase() : null;
}

function collectRamWrites(asmText, mapData, ramLabel) {
  const lines = asmText.split(/\r?\n/);
  const writes = [];
  let currentLabel = null;
  let currentLabelOffset = null;
  const writeRe = new RegExp(`\\bld\\s+\\(${ramLabel}\\),\\s*a\\b`, 'i');

  for (let i = 0; i < lines.length; i++) {
    const labelMatch = /^(_LABEL_[0-9A-F]+_):/.exec(lines[i]);
    if (labelMatch) {
      currentLabel = labelMatch[1];
      currentLabelOffset = labelOffset(currentLabel);
    }
    const code = cleanCode(lines[i]);
    if (!writeRe.test(code)) continue;

    let sourceLine = null;
    let sourceCode = null;
    let valueKind = 'unknown';
    let value = null;
    for (let j = i - 1; j >= Math.max(0, i - 8); j--) {
      const previous = cleanCode(lines[j]);
      if (!previous) continue;
      const immediate = parseImmediateA(previous);
      if (immediate != null) {
        sourceLine = j + 1;
        sourceCode = previous;
        valueKind = 'immediate_request_id';
        value = immediate;
        break;
      }
      if (/^\s*ld\s+a,\s*\(hl\)\s*$/i.test(previous)) {
        sourceLine = j + 1;
        sourceCode = previous;
        valueKind = 'stream_byte_at_hl';
        break;
      }
      const ramReadMatch = /^\s*ld\s+a,\s*\((_RAM_[0-9A-F]+_)\)\s*$/i.exec(previous);
      if (ramReadMatch) {
        sourceLine = j + 1;
        sourceCode = previous;
        valueKind = 'ram_byte';
        value = ramReadMatch[1];
        break;
      }
      if (/\b(call|jp|ret)\b/i.test(previous)) break;
    }

    const sourceRegion = currentLabelOffset == null ? null : regionRef(findContainingRegion(mapData, currentLabelOffset));
    writes.push({
      line: i + 1,
      code,
      sourceLine,
      sourceCode,
      valueKind,
      value: typeof value === 'number' ? value : value,
      valueHex: typeof value === 'number' ? hexByte(value) : null,
      sourceLabel: currentLabel,
      sourceLabelOffset: currentLabelOffset == null ? null : hex(currentLabelOffset),
      sourceRegion,
      confidence: valueKind === 'unknown' ? 'low' : valueKind === 'stream_byte_at_hl' ? 'medium' : 'high',
    });
  }
  return writes;
}

function compactRamWrite(write) {
  return {
    line: write.line,
    code: write.code,
    sourceLine: write.sourceLine,
    sourceCode: write.sourceCode,
    valueKind: write.valueKind,
    value: write.value,
    valueHex: write.valueHex,
    sourceLabel: write.sourceLabel,
    sourceLabelOffset: write.sourceLabelOffset,
    sourceRegion: write.sourceRegion,
    confidence: write.confidence,
  };
}

function resolveDynamicProducer(site, ramWriteCatalogs) {
  const sourceCode = site.dynamicSource?.code || '';
  if ((site.candidateRequestIds || []).length) {
    return {
      kind: 'conditional_register_request_candidate',
      confidence: 'medium',
      candidateRequestIds: site.candidateRequestIds,
      candidateRequestIdsHex: site.candidateRequestIdsHex,
      sourceRegister: site.dynamicSource?.sourceRegister || null,
      summary: 'Nearby register setup gives a small candidate request-id set, but control-flow determines the exact id at runtime.',
      evidence: site.evidence,
    };
  }

  if (site.sourceLabel === '_LABEL_26F4_' && /^\s*ld\s+a,\s*\(hl\)\s*$/i.test(sourceCode)) {
    return {
      kind: 'room_asset_stream_audio_request_byte',
      confidence: 'high',
      sourceRam: '_RAM_D0FE_',
      cacheRam: '_RAM_CFF9_',
      summary: 'Room asset loader reads an audio request byte from the room payload pointer, caches it in _RAM_CFF9_, and calls _LABEL_104B_ when the request changed.',
      suppressWhenSceneSelector: ['0x0D', '0x09', '0x0F', '0x1E'],
      producerWrites: (ramWriteCatalogs._RAM_CFF9_ || []).filter(write => write.sourceLabel === '_LABEL_26F4_').map(compactRamWrite),
      evidence: [
        'ASM lines 6477-6485 store the post-header room payload pointer in _RAM_D0FE_.',
        'ASM lines 6503-6508 read a byte from (_RAM_D0FE_), compare against _RAM_CFF9_, and cache changed values into _RAM_CFF9_.',
        'ASM lines 6509-6520 suppress specific _RAM_C26E_ scene selectors, otherwise reload the room byte from HL and call _LABEL_104B_.',
      ],
    };
  }

  const cff9Read = /^\s*ld\s+a,\s*\(_RAM_CFF9_\)\s*$/i.test(sourceCode);
  if (cff9Read) {
    return {
      kind: 'cached_room_or_transition_audio_request_replay',
      confidence: 'medium',
      sourceRam: '_RAM_CFF9_',
      summary: 'Routine replays the cached audio request byte rather than loading a literal request id at the call site.',
      knownProducerWrites: (ramWriteCatalogs._RAM_CFF9_ || []).map(compactRamWrite),
      evidence: [
        '_RAM_CFF9_ is written by _LABEL_26F4_ from the room asset stream and replayed by room/transition routines after waits or menu/transition flows.',
        'Bank-2 transition/finale routines also write immediate values 0x09 and 0x0A to _RAM_CFF9_ before calling _LABEL_104B_.',
        'The exact request id at replay sites is therefore state-dependent and should be traced through the cached producer path.',
      ],
    };
  }

  return null;
}

function compactStream(stream) {
  if (!stream) return null;
  return {
    id: stream.id,
    startOffset: stream.startOffset,
    endOffset: stream.endOffset,
    consumedBytes: stream.consumedBytes,
    noteBytes: stream.noteBytes,
    highFlagNoteBytes: stream.highFlagNoteBytes,
    restOrSpecialBytes: stream.restOrSpecialBytes,
    opcodeCounts: stream.opcodeCounts || {},
    endReason: stream.endReason,
    warningCount: (stream.warnings || []).length,
  };
}

function streamLooksSilent(stream) {
  if (!stream) return false;
  const counts = stream.opcodeCounts || {};
  return stream.noteBytes === 0 &&
    stream.highFlagNoteBytes === 0 &&
    stream.restOrSpecialBytes === 0 &&
    Object.keys(counts).length === 1 &&
    counts.$FF === 1 &&
    stream.consumedBytes === 1;
}

function classifyRequest(song, streamByOffset) {
  const channels = song.header?.channels || [];
  const channelIds = uniqueSorted(channels.map(channel => channel.channelId));
  const priorityValues = uniqueSorted(channels.map(channel => channel.priority));
  const streamOffsets = uniqueSortedStrings(channels.map(channel => channel.streamRomOffset));
  const streams = streamOffsets.map(offset => streamByOffset.get(offset)).filter(Boolean);
  const allSilentStreams = streamOffsets.length > 0 && streams.length === streamOffsets.length && streams.every(streamLooksSilent);
  const usesMusicVoices = channelIds.some(id => id >= 0 && id <= 3);
  const usesEffectVoices = channelIds.some(id => id >= 4 && id <= 7);
  const onlyMusicVoices = channelIds.length > 0 && channelIds.every(id => id >= 0 && id <= 3);
  const onlyEffectVoices = channelIds.length > 0 && channelIds.every(id => id >= 4 && id <= 7);
  const channelShape = channelIds.map(id => hexByte(id)).join(',');
  const priorityShape = priorityValues.map(value => hexByte(value)).join(',');

  if (!channels.length) {
    return {
      kind: 'empty_or_global_stop_request',
      confidence: 'high',
      reason: 'Header terminates immediately without channel records.',
    };
  }
  if (allSilentStreams && channelIds.length === 8) {
    return {
      kind: 'all_channel_silence_request',
      confidence: 'high',
      reason: 'All eight channel records point at a one-byte $FF stream segment.',
    };
  }
  if (allSilentStreams) {
    return {
      kind: 'channel_group_silence_request',
      confidence: 'high',
      reason: 'Every referenced stream for this channel group is a one-byte $FF segment.',
    };
  }
  if (onlyMusicVoices && channels.length >= 4 && priorityValues.length === 1 && priorityValues[0] === 0x00) {
    return {
      kind: 'bgm_music_request_candidate',
      confidence: 'medium',
      reason: 'Four logical music voices 0-3 use priority 0x00 and distinct stream starts; call-site naming is still needed before assigning a title.',
    };
  }
  if (onlyEffectVoices && channels.length >= 3) {
    return {
      kind: 'multi_voice_sfx_or_jingle_candidate',
      confidence: 'medium',
      reason: `Uses effect voice group ${channelShape} with priority set ${priorityShape}.`,
    };
  }
  if (usesEffectVoices && channels.length <= 2) {
    return {
      kind: 'sfx_request_candidate',
      confidence: 'medium',
      reason: `Uses one or two effect-oriented voices ${channelShape}; semantic name requires gameplay call-site tracing.`,
    };
  }
  if (usesMusicVoices && usesEffectVoices) {
    return {
      kind: 'mixed_voice_request_candidate',
      confidence: 'low',
      reason: `Mixes music and effect voice groups ${channelShape}; runtime priority behavior needs trace confirmation.`,
    };
  }
  return {
    kind: 'unclassified_audio_request',
    confidence: 'low',
    reason: `Unusual channel/priority shape channels=${channelShape || 'none'} priorities=${priorityShape || 'none'}.`,
  };
}

function collectCallSites(asmText, mapData) {
  const lines = asmText.split(/\r?\n/);
  const ramWriteCatalogs = {
    _RAM_CFF9_: collectRamWrites(asmText, mapData, '_RAM_CFF9_'),
  };
  const callSites = [];
  let currentLabel = null;
  let currentLabelOffset = null;

  for (let i = 0; i < lines.length; i++) {
    const labelMatch = /^(_LABEL_[0-9A-F]+_):/.exec(lines[i]);
    if (labelMatch) {
      currentLabel = labelMatch[1];
      currentLabelOffset = labelOffset(currentLabel);
    }
    const code = cleanCode(lines[i]);
    if (!/\bcall\s+_LABEL_104B_\b/i.test(code)) continue;

    let immediate = null;
    let assignmentLine = null;
    let assignmentCode = null;
    let dynamicSource = null;
    let candidateRequestIds = [];
    let registerSource = null;
    for (let j = i - 1; j >= Math.max(0, i - 8); j--) {
      const previous = cleanCode(lines[j]);
      if (!previous) continue;
      const parsed = parseImmediateA(previous);
      if (parsed != null) {
        immediate = parsed;
        assignmentLine = j + 1;
        assignmentCode = previous;
        break;
      }
      const registerMove = parseRegisterMoveToA(previous);
      if (registerMove) {
        registerSource = registerMove;
        let sawIncrement = false;
        for (let k = j - 1; k >= Math.max(0, j - 8); k--) {
          const registerPrevious = cleanCode(lines[k]);
          if (!registerPrevious) continue;
          if (new RegExp(`^\\s*inc\\s+${registerSource}\\s*$`, 'i').test(registerPrevious)) {
            sawIncrement = true;
            continue;
          }
          const registerImmediate = parseRegisterImmediate(registerPrevious, registerSource);
          if (registerImmediate != null) {
            candidateRequestIds = sawIncrement
              ? uniqueSorted([registerImmediate, (registerImmediate + 1) & 0xff])
              : [registerImmediate];
            assignmentLine = k + 1;
            assignmentCode = registerPrevious;
            dynamicSource = {
              line: j + 1,
              code: previous,
              sourceRegister: registerSource,
              conditionalIncrementSeen: sawIncrement,
            };
            break;
          }
          if (/\b(call|jp|ret)\b/i.test(registerPrevious)) break;
        }
        if (candidateRequestIds.length === 1) {
          immediate = candidateRequestIds[0];
          candidateRequestIds = [];
          break;
        }
        if (candidateRequestIds.length) break;
      }
      if (/^\s*ld\s+a,/i.test(previous) || /\badd\s+a,|\bsub\s+/i.test(previous)) {
        dynamicSource = dynamicSource || { line: j + 1, code: previous };
      }
      if (/\b(call|jp|ret)\b/i.test(previous)) break;
    }

    const sourceRegion = currentLabelOffset == null ? null : regionRef(findContainingRegion(mapData, currentLabelOffset));
    const site = {
      line: i + 1,
      call: requestWrapperLabel,
      sourceLabel: currentLabel,
      sourceLabelOffset: currentLabelOffset == null ? null : hex(currentLabelOffset),
      sourceRegion,
      requestId: immediate == null ? null : immediate,
      requestIdHex: immediate == null ? null : hexByte(immediate),
      candidateRequestIds,
      candidateRequestIdsHex: candidateRequestIds.map(hexByte),
      assignmentLine,
      assignmentCode,
      dynamicSource,
      confidence: immediate == null ? candidateRequestIds.length ? 'medium' : 'low' : 'high',
      evidence: immediate == null && !candidateRequestIds.length
        ? [`ASM line ${i + 1} calls ${requestWrapperLabel}, but the request id in A is dynamic or outside the short look-back window.`]
        : immediate != null
          ? [`ASM line ${assignmentLine} loads request id ${hexByte(immediate)} into A; ASM line ${i + 1} calls ${requestWrapperLabel}, which copies A to C before calling _LABEL_C003_.`]
          : [`ASM line ${assignmentLine} loads ${registerSource?.toUpperCase() || 'a register'} before ASM line ${i + 1} calls ${requestWrapperLabel}; nearby control flow leaves candidate request ids ${candidateRequestIds.map(hexByte).join(' or ')}.`],
    };
    site.dynamicProducer = resolveDynamicProducer(site, ramWriteCatalogs);
    if (site.dynamicProducer && site.requestId == null && !(site.candidateRequestIds || []).length) {
      site.confidence = site.dynamicProducer.confidence;
      site.evidence = site.dynamicProducer.evidence;
    }
    callSites.push(site);
  }
  return callSites;
}

function buildRequestEntries(mapData, audioCatalog, callSites, recipeUsageByRequest) {
  const streamByOffset = new Map((audioCatalog.streams || []).map(stream => [stream.startOffset, stream]));
  const callSitesByRequest = new Map();
  const candidateCallSitesByRequest = new Map();
  for (const site of callSites) {
    if (site.requestId == null) continue;
    if (!callSitesByRequest.has(site.requestId)) callSitesByRequest.set(site.requestId, []);
    callSitesByRequest.get(site.requestId).push(site);
  }
  for (const site of callSites) {
    for (const requestId of site.candidateRequestIds || []) {
      if (!candidateCallSitesByRequest.has(requestId)) candidateCallSitesByRequest.set(requestId, []);
      candidateCallSitesByRequest.get(requestId).push(site);
    }
  }

  return (audioCatalog.songs || []).map(song => {
    const channels = song.header?.channels || [];
    const channelIds = uniqueSorted(channels.map(channel => channel.channelId));
    const priorities = uniqueSorted(channels.map(channel => channel.priority));
    const streamOffsets = uniqueSortedStrings(channels.map(channel => channel.streamRomOffset));
    const streamSummaries = streamOffsets.map(offset => compactStream(streamByOffset.get(offset))).filter(Boolean);
    const classification = classifyRequest(song, streamByOffset);
    const requestCallSites = callSitesByRequest.get(song.index) || [];
    const candidateCallSites = candidateCallSitesByRequest.get(song.index) || [];
    const roomRecipeUsage = recipeUsageByRequest.get(song.index) || null;
    const region = song.region?.id ? findRegionById(mapData, song.region.id) : findContainingRegion(mapData, parseHex(song.romOffset));
    return {
      id: `audio_request_${song.index.toString().padStart(2, '0')}`,
      requestId: song.index,
      requestIdHex: hexByte(song.index),
      tableEntryOffset: song.tableEntryOffset,
      z80Pointer: song.z80Pointer,
      headerOffset: song.romOffset,
      headerRegion: regionRef(region),
      headerBytes: song.header?.headerBytes ?? null,
      terminatorOffset: song.header?.terminatorOffset || null,
      terminatorByte: song.header?.terminatorByte || null,
      channelCount: channels.length,
      channelIds: channelIds.map(hexByte),
      priorityValues: priorities.map(hexByte),
      uniqueStreamCount: streamOffsets.length,
      streamOffsets,
      streamSummaries,
      classification,
      immediateCallSiteCount: requestCallSites.length,
      candidateCallSiteCount: candidateCallSites.length,
      roomRecipeUsage,
      immediateCallSites: requestCallSites.slice(0, 32).map(site => ({
        line: site.line,
        sourceLabel: site.sourceLabel,
        sourceLabelOffset: site.sourceLabelOffset,
        sourceRegion: site.sourceRegion,
        assignmentLine: site.assignmentLine,
        assignmentCode: site.assignmentCode,
        confidence: site.confidence,
      })),
      candidateCallSites: candidateCallSites.slice(0, 32).map(site => ({
        line: site.line,
        sourceLabel: site.sourceLabel,
        sourceLabelOffset: site.sourceLabelOffset,
        sourceRegion: site.sourceRegion,
        assignmentLine: site.assignmentLine,
        assignmentCode: site.assignmentCode,
        candidateRequestIds: site.candidateRequestIds,
        candidateRequestIdsHex: site.candidateRequestIdsHex,
        dynamicSource: site.dynamicSource,
        confidence: site.confidence,
      })),
      warningCount: (song.warnings || []).length + (song.header?.warnings || []).length,
      warnings: [...(song.warnings || []), ...(song.header?.warnings || [])],
      evidence: [
        `${requestTableLabel} entry ${song.index} at ${song.tableEntryOffset} points to header ${song.romOffset}.`,
        '_LABEL_C04D_ and _LABEL_C09F_ index _DATA_D139_ using the active request id from _RAM_C222_/C.',
        `${requestWrapperLabel} copies A into C before bank-switching to _LABEL_C003_, so nearby immediate loads into A identify direct request call sites.`,
      ],
    };
  });
}

function summarizeRequests(requests, callSites) {
  const immediateSites = callSites.filter(site => site.requestId != null);
  const candidateSites = callSites.filter(site => site.requestId == null && (site.candidateRequestIds || []).length > 0);
  const outOfRangeImmediateSites = immediateSites.filter(site => site.requestId < 0 || site.requestId >= requests.length);
  const dynamicSites = callSites.filter(site => site.requestId == null && !(site.candidateRequestIds || []).length);
  const dynamicProducerSites = callSites.filter(site => site.dynamicProducer);
  const unresolvedDynamicSites = dynamicSites.filter(site => !site.dynamicProducer);
  const requestsWithRoomRecipeUsage = requests.filter(request => request.roomRecipeUsage?.descriptorCount > 0);
  const requestsWithInlineTransitionRecipeUsage = requests.filter(request => (request.roomRecipeUsage?.inlineTransitionRecipeDescriptorCount || 0) > 0);
  return {
    requestCount: requests.length,
    requestTable: requestTableLabel,
    requestTableOffset: hex(requestTableOffset),
    immediateCallSites: immediateSites.length,
    candidateCallSites: candidateSites.length,
    dynamicCallSites: dynamicSites.length,
    dynamicProducerResolvedCallSites: dynamicProducerSites.length,
    unresolvedDynamicCallSites: unresolvedDynamicSites.length,
    outOfRangeImmediateCallSites: outOfRangeImmediateSites.length,
    requestsWithImmediateCallSites: requests.filter(request => request.immediateCallSiteCount > 0).length,
    requestsWithCandidateCallSites: requests.filter(request => request.candidateCallSiteCount > 0).length,
    requestsWithRoomRecipeUsage: requestsWithRoomRecipeUsage.length,
    roomRecipeDescriptorCount: requestsWithRoomRecipeUsage.reduce((sum, request) => sum + request.roomRecipeUsage.descriptorCount, 0),
    zoneRecipeDescriptorCount: requestsWithRoomRecipeUsage.reduce((sum, request) => sum + (request.roomRecipeUsage.zoneRecipeDescriptorCount || 0), 0),
    requestsWithInlineTransitionRecipeUsage: requestsWithInlineTransitionRecipeUsage.length,
    inlineTransitionRecipeDescriptorCount: requestsWithRoomRecipeUsage.reduce((sum, request) => sum + (request.roomRecipeUsage.inlineTransitionRecipeDescriptorCount || 0), 0),
    classificationCounts: countBy(requests, request => request.classification.kind),
    confidenceCounts: countBy(requests, request => request.classification.confidence),
    channelCountHistogram: countBy(requests, request => String(request.channelCount)),
    priorityShapeCounts: countBy(requests, request => request.priorityValues.join(',') || 'none'),
    dynamicProducerKindCounts: countBy(dynamicProducerSites, site => site.dynamicProducer.kind),
    assetPolicy: 'Metadata only: request ids, offsets, channel counts, priority values, stream offsets/counts, ASM line references, and evidence. No ROM bytes, decoded music, or audio samples are embedded.',
  };
}

function buildCatalog(mapData, asmText) {
  const audioCatalog = requireCatalog(mapData, 'audioCatalogs', audioCatalogId);
  const callSites = collectCallSites(asmText, mapData);
  const recipeUsageByRequest = buildRecipeUsage(mapData);
  const hasZoneUsage = [...recipeUsageByRequest.values()].some(usage => usage.zoneRecipeDescriptorCount > 0);
  const hasInlineUsage = [...recipeUsageByRequest.values()].some(usage => usage.inlineTransitionRecipeDescriptorCount > 0);
  const requests = buildRequestEntries(mapData, audioCatalog, callSites, recipeUsageByRequest);
  const ramWriteCatalogs = {
    _RAM_CFF9_: collectRamWrites(asmText, mapData, '_RAM_CFF9_'),
  };
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [
      audioCatalogId,
      ...(hasZoneUsage ? [zoneRecipeCatalogId] : []),
      ...(hasInlineUsage ? [inlineTransitionRecipeCatalogId] : []),
    ],
    assetPolicy: 'Metadata only: request ids, offsets, channel/priorities, stream offsets/counts, call-site line refs, and evidence. No ROM bytes, decoded music, or audio samples are embedded.',
    semantics: {
      requestWrapper: `${requestWrapperLabel} copies A to C, switches to bank 3, calls _LABEL_C003_, restores the previous bank, and clears _RAM_C23C_.`,
      requestTable: `${requestTableLabel} is the 62-entry bank-3 audio request table consumed by _LABEL_C04D_/_LABEL_C09F_.`,
      cachedRequestRam: '_RAM_CFF9_ caches a room/transition audio request byte that can be replayed by later transition code through _LABEL_104B_.',
      roomRecipeUsage: 'Generated zone recipes and inline transition recipes provide descriptor counts for audio request ids read from room subrecord byte +17.',
      classificationCaution: 'Request kind names are structural candidates based on channel shape and stream summaries; they are not user-facing sound names.',
    },
    requests,
    callSites,
    dynamicProducerCatalogs: [
      {
        id: 'audio_request_cache_ram_CFF9',
        ramLabel: '_RAM_CFF9_',
        address: '$CFF9',
        role: 'cached_room_or_transition_audio_request_id',
        summary: '_RAM_CFF9_ caches the current room/transition audio request byte; routines replay it through _LABEL_104B_ when transitions finish or room handlers resume.',
        writes: ramWriteCatalogs._RAM_CFF9_.map(compactRamWrite),
        evidence: [
          '_LABEL_26F4_ writes _RAM_CFF9_ from a room payload byte and then calls _LABEL_104B_ when allowed by the scene selector.',
          '_LABEL_3E1_, _LABEL_3F8_, and _LABEL_B3D3_ clear _RAM_CFF9_ with request id 0x00 semantics.',
          'Bank-2 transition/finale routines write literal request ids 0x09 and 0x0A to _RAM_CFF9_ before requesting audio.',
        ],
        confidence: 'medium',
      },
    ],
    summary: summarizeRequests(requests, callSites),
  };
}

function compactRequestRef(request) {
  return {
    catalogId,
    requestId: request.requestId,
    requestIdHex: request.requestIdHex,
    tableEntryOffset: request.tableEntryOffset,
    headerOffset: request.headerOffset,
    channelCount: request.channelCount,
    channelIds: request.channelIds,
    priorityValues: request.priorityValues,
    uniqueStreamCount: request.uniqueStreamCount,
    classification: request.classification,
    immediateCallSiteCount: request.immediateCallSiteCount,
    candidateCallSiteCount: request.candidateCallSiteCount,
    roomRecipeUsage: request.roomRecipeUsage || null,
    confidence: request.classification.confidence,
  };
}

function compactCallSiteRef(site) {
  return {
    catalogId,
    line: site.line,
    call: site.call,
    sourceLabel: site.sourceLabel,
    sourceLabelOffset: site.sourceLabelOffset,
    requestId: site.requestId,
    requestIdHex: site.requestIdHex,
    candidateRequestIds: site.candidateRequestIds,
    candidateRequestIdsHex: site.candidateRequestIdsHex,
    assignmentLine: site.assignmentLine,
    assignmentCode: site.assignmentCode,
    dynamicSource: site.dynamicSource,
    dynamicProducer: site.dynamicProducer,
    confidence: site.confidence,
  };
}

function annotateMap(mapData, catalog) {
  const missingRegions = [];
  const annotatedHeaderRegions = [];
  const annotatedSourceRegions = [];
  const annotatedRamEntries = [];

  const requestRefsByRegion = new Map();
  function addRequestRef(regionLike, fallbackOffset, ref) {
    let region = regionLike?.id ? findRegionById(mapData, regionLike.id) : null;
    const fallback = parseHex(fallbackOffset);
    if (!region && fallback != null) region = findContainingRegion(mapData, fallback);
    if (!region) {
      missingRegions.push({ role: 'audio_request_header', offset: fallbackOffset, requestId: ref.requestId });
      return;
    }
    if (!requestRefsByRegion.has(region.id)) requestRefsByRegion.set(region.id, { region, refs: [] });
    requestRefsByRegion.get(region.id).refs.push(ref);
  }

  for (const request of catalog.requests) {
    addRequestRef(request.headerRegion, request.headerOffset, compactRequestRef(request));
  }

  for (const { region, refs } of requestRefsByRegion.values()) {
    region.analysis = region.analysis || {};
    const existing = region.analysis.audioRequestTaxonomyAudit || {};
    const preserved = (existing.requests || []).filter(ref => ref.catalogId !== catalogId);
    const requests = [...preserved, ...refs].sort((a, b) => a.requestId - b.requestId).slice(0, 96);
    region.analysis.audioRequestTaxonomyAudit = {
      kind: 'audio_request_header_region',
      catalogId,
      confidence: requests.some(ref => ref.confidence === 'low') ? 'low' : requests.some(ref => ref.confidence === 'medium') ? 'medium' : 'high',
      summary: 'Region contains one or more _DATA_D139_ audio request headers classified by channel shape and stream references.',
      requests,
      evidence: [
        '_LABEL_C04D_ and _LABEL_C09F_ index _DATA_D139_ using active audio request ids.',
        'Header records are already parsed by world-audio-catalog-2026-06-24; this audit stores only offsets, counts, channel ids, priorities, and call-site references.',
      ],
      generatedAt: now,
      tool: toolName,
    };
    annotatedHeaderRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type || 'unknown',
      name: region.name || '',
      requestRefs: refs.length,
    });
  }

  const callRefsByRegion = new Map();
  function addCallRef(site) {
    let region = site.sourceRegion?.id ? findRegionById(mapData, site.sourceRegion.id) : null;
    const fallback = parseHex(site.sourceLabelOffset);
    if (!region && fallback != null) region = findContainingRegion(mapData, fallback);
    if (!region) {
      missingRegions.push({ role: 'audio_request_callsite', line: site.line, requestId: site.requestId });
      return;
    }
    if (!callRefsByRegion.has(region.id)) callRefsByRegion.set(region.id, { region, refs: [] });
    callRefsByRegion.get(region.id).refs.push(compactCallSiteRef(site));
  }

  for (const site of catalog.callSites) addCallRef(site);

  for (const { region, refs } of callRefsByRegion.values()) {
    region.analysis = region.analysis || {};
    const existing = region.analysis.audioRequestCallsiteAudit || {};
    const preserved = (existing.callSites || []).filter(ref => ref.catalogId !== catalogId);
    const callSites = [...preserved, ...refs].sort((a, b) => a.line - b.line).slice(0, 96);
    region.analysis.audioRequestCallsiteAudit = {
      kind: 'audio_request_callsite_region',
      catalogId,
      confidence: callSites.some(ref => ref.confidence === 'low') ? 'low' : 'high',
      summary: 'Region contains call sites that request bank-3 audio through _LABEL_104B_.',
      callSites,
      evidence: [
        '_LABEL_104B_ copies A into C and calls _LABEL_C003_, so immediate A loads near the call identify direct audio request ids.',
        'Dynamic request call sites carry producer metadata when the source is a cached RAM byte, room payload byte, or small candidate register set.',
      ],
      generatedAt: now,
      tool: toolName,
    };
    annotatedSourceRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type || 'unknown',
      name: region.name || '',
      callSiteRefs: refs.length,
    });
  }

  for (const producer of catalog.dynamicProducerCatalogs || []) {
    const entry = (mapData.ram || []).find(item => item.address === producer.address || item.name === producer.ramLabel.replace(/^_RAM_|_$/g, ''));
    if (!entry) {
      missingRegions.push({ role: 'audio_request_ram_producer', ramLabel: producer.ramLabel, address: producer.address });
      continue;
    }
    entry.analysis = entry.analysis || {};
    entry.analysis.audioRequestProducerAudit = {
      catalogId,
      kind: producer.role,
      ramLabel: producer.ramLabel,
      summary: producer.summary,
      confidence: producer.confidence,
      writes: producer.writes,
      evidence: producer.evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotatedRamEntries.push({
      id: entry.id,
      address: entry.address,
      name: entry.name || '',
      role: producer.role,
      writeRefs: producer.writes.length,
    });
  }

  return { annotatedHeaderRegions, annotatedSourceRegions, annotatedRamEntries, missingRegions };
}

function main() {
  const mapData = readJson(mapPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const catalog = buildCatalog(mapData, asmText);
  let annotation = { annotatedHeaderRegions: [], annotatedSourceRegions: [], annotatedRamEntries: [], missingRegions: [] };

  if (apply) {
    annotation = annotateMap(mapData, catalog);
    const finalCatalog = buildCatalog(mapData, asmText);
    mapData.audioRequestTaxonomyCatalogs = (mapData.audioRequestTaxonomyCatalogs || []).filter(item => item.id !== catalogId);
    mapData.audioRequestTaxonomyCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'audio_request_taxonomy_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      sourceCatalogs: finalCatalog.sourceCatalogs,
      summary: {
        ...finalCatalog.summary,
        annotatedHeaderRegions: annotation.annotatedHeaderRegions.length,
        annotatedSourceRegions: annotation.annotatedSourceRegions.length,
        annotatedRamEntries: annotation.annotatedRamEntries.length,
        missingRegions: annotation.missingRegions.length,
      },
      semantics: finalCatalog.semantics,
      dynamicProducerCatalogs: finalCatalog.dynamicProducerCatalogs,
      requestSummary: finalCatalog.requests.map(request => ({
        requestId: request.requestId,
        requestIdHex: request.requestIdHex,
        headerOffset: request.headerOffset,
        channelCount: request.channelCount,
        channelIds: request.channelIds,
        priorityValues: request.priorityValues,
        uniqueStreamCount: request.uniqueStreamCount,
        classification: request.classification,
        immediateCallSiteCount: request.immediateCallSiteCount,
        candidateCallSiteCount: request.candidateCallSiteCount,
        roomRecipeUsage: request.roomRecipeUsage || null,
      })),
      immediateCallSites: finalCatalog.callSites.filter(site => site.requestId != null),
      candidateCallSites: finalCatalog.callSites.filter(site => site.requestId == null && (site.candidateRequestIds || []).length > 0),
      dynamicCallSites: finalCatalog.callSites.filter(site => site.requestId == null && !(site.candidateRequestIds || []).length),
      dynamicProducerResolvedCallSites: finalCatalog.callSites.filter(site => site.dynamicProducer),
      unresolvedDynamicCallSites: finalCatalog.callSites.filter(site => site.requestId == null && !(site.candidateRequestIds || []).length && !site.dynamicProducer),
      annotatedHeaderRegions: annotation.annotatedHeaderRegions,
      annotatedSourceRegions: annotation.annotatedSourceRegions,
      annotatedRamEntries: annotation.annotatedRamEntries,
      missingRegions: annotation.missingRegions,
      nextLeads: [
        'Trace room payload records that feed _LABEL_26F4_ so cached _RAM_CFF9_ replay sites can be tied to specific room/scene request ids.',
        'Use request taxonomy to label SFX-producing gameplay routines without assigning user-facing sound names until behavior is confirmed.',
        'Build a read-only per-frame audio request trace that shows queued request id, channel records, and PSG/FM write effects without playing decoded audio.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    annotatedHeaderRegions: annotation.annotatedHeaderRegions.length,
    annotatedSourceRegions: annotation.annotatedSourceRegions.length,
    annotatedRamEntries: annotation.annotatedRamEntries.length,
    missingRegions: annotation.missingRegions.length,
  }, null, 2));
}

main();
