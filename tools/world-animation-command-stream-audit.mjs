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
const catalogId = 'world-animation-command-stream-catalog-2026-06-25';
const reportId = 'animation-command-stream-audit-2026-06-25';
const toolName = 'tools/world-animation-command-stream-audit.mjs';

const BANK6_START = 0x18000;
const BANK6_END = 0x1BFFF;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function normOffset(value) {
  if (value == null) return null;
  if (typeof value === 'number') return hex(value);
  return '0x' + String(value).replace(/^0x/i, '').toUpperCase().padStart(5, '0');
}

function readWord(rom, offset) {
  return rom[offset] | (rom[offset + 1] << 8);
}

function isBank6Ptr(z80) {
  return z80 >= 0x8000 && z80 < 0xC000;
}

function bank6Z80ToRom(z80) {
  return z80 + 0x10000;
}

function isBank6Offset(offset) {
  return offset >= BANK6_START && offset <= BANK6_END;
}

function offsetOf(region) {
  return typeof region.offset === 'number' ? region.offset : parseInt(region.offset, 16);
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

function regionRefAt(mapData, offset) {
  const normalized = normOffset(offset);
  if (normalized == null) return null;
  return regionRef(findContainingRegion(mapData, parseInt(normalized, 16)));
}

function catalogById(mapData, key, id) {
  return (mapData[key] || []).find(item => item.id === id) || null;
}

function addStreamRef(refsByOffset, offset, ref) {
  const normalized = normOffset(offset);
  if (!normalized) return;
  if (!refsByOffset.has(normalized)) refsByOffset.set(normalized, []);
  refsByOffset.get(normalized).push(ref);
}

function collectFamilyStreamRefs(mapData) {
  const refsByOffset = new Map();
  const immediate = catalogById(mapData, 'animationFamilyCatalogs', 'world-animation-family-catalog-2026-06-25');
  const behavior = catalogById(mapData, 'animationBehaviorFamilyCatalogs', 'world-animation-behavior-family-catalog-2026-06-25');

  for (const family of immediate?.families || []) {
    for (const stream of family.streams || []) {
      addStreamRef(refsByOffset, stream.offset, {
        sourceCatalog: immediate.id,
        familyId: family.id,
        familyKind: family.kind,
        selectorPair: family.selectorPair,
        streamOffset: normOffset(stream.offset),
      });
    }
  }

  for (const family of behavior?.families || []) {
    for (const stream of family.selectedTarget?.streams || []) {
      addStreamRef(refsByOffset, stream.offset, {
        sourceCatalog: behavior.id,
        familyId: family.id,
        familyKind: family.kind,
        entityType: family.entityType,
        dispatchLabel: family.dispatchLabel,
        selectorPair: family.selectorProvenance?.selectorPair || null,
        streamOffset: normOffset(stream.offset),
      });
    }
  }

  return refsByOffset;
}

function issue(kind, severity, message, detail = {}) {
  return { kind, severity, message, ...detail };
}

function parseCommandStream(rom, mapData, startOffset) {
  const commands = [];
  const jumps = [];
  const frameTargets = [];
  const issues = [];
  const visited = new Set();
  let pos = startOffset;
  let termination = null;

  for (let commandIndex = 0; commandIndex < 256; commandIndex++) {
    if (!isBank6Offset(pos) || pos >= rom.length) {
      termination = { kind: 'left_bank6_range', normal: false, atOffset: hex(pos) };
      issues.push(issue('left_bank6_range', 'high', `stream left bank-6 ROM range at ${hex(pos)}`, { atOffset: hex(pos) }));
      break;
    }
    if (visited.has(pos)) {
      termination = { kind: 'fell_into_visited_offset', normal: false, atOffset: hex(pos) };
      issues.push(issue('fell_into_visited_offset', 'medium', `stream control flow reached visited offset ${hex(pos)} without a direct 0xFF loop edge`, { atOffset: hex(pos) }));
      break;
    }
    visited.add(pos);
    const commandOffset = pos;
    const control = rom[pos++];

    if (control === 0xFF) {
      if (pos + 1 >= rom.length) {
        termination = { kind: 'truncated_jump', normal: false, atOffset: hex(commandOffset) };
        issues.push(issue('truncated_jump', 'high', `truncated jump at ${hex(commandOffset)}`, { commandOffset: hex(commandOffset) }));
        break;
      }
      const pointerOffset = pos;
      const z80Pointer = readWord(rom, pos);
      pos += 2;
      const romOffset = isBank6Ptr(z80Pointer) ? bank6Z80ToRom(z80Pointer) : null;
      const jump = {
        commandOffset: hex(commandOffset),
        pointerOffset: hex(pointerOffset),
        z80Pointer: hex(z80Pointer, 4),
        romOffset: romOffset == null ? null : hex(romOffset),
        region: romOffset == null ? null : regionRefAt(mapData, romOffset),
      };
      jumps.push(jump);
      if (romOffset == null || !isBank6Offset(romOffset)) {
        termination = { kind: 'invalid_jump_pointer', normal: false, atOffset: hex(commandOffset), z80Pointer: hex(z80Pointer, 4) };
        issues.push(issue('invalid_jump_pointer', 'high', `jump ${hex(z80Pointer, 4)} at ${hex(commandOffset)} is not a bank-6 ROM pointer`, jump));
        break;
      }
      if (visited.has(romOffset)) {
        termination = {
          kind: 'loop_jump',
          normal: true,
          atOffset: hex(commandOffset),
          loopTarget: hex(romOffset),
          z80Pointer: hex(z80Pointer, 4),
        };
        break;
      }
      pos = romOffset;
      continue;
    }

    const hasMotionWords = (control & 0x80) !== 0;
    const command = {
      index: commands.length,
      offset: hex(commandOffset),
      control: hex(control, 2),
      delay: control & 0x7F,
      hasMotionWords,
      motionWordCount: hasMotionWords ? 2 : 0,
    };
    if (hasMotionWords) {
      if (pos + 3 >= rom.length) {
        termination = { kind: 'truncated_motion_words', normal: false, atOffset: hex(commandOffset) };
        issues.push(issue('truncated_motion_words', 'high', `truncated motion words at ${hex(commandOffset)}`, { commandOffset: hex(commandOffset) }));
        break;
      }
      command.motionWordsOffset = hex(pos);
      pos += 4;
    }

    if (pos + 1 >= rom.length) {
      termination = { kind: 'truncated_frame_pointer', normal: false, atOffset: hex(commandOffset) };
      issues.push(issue('truncated_frame_pointer', 'high', `truncated frame pointer at ${hex(commandOffset)}`, { commandOffset: hex(commandOffset) }));
      break;
    }
    const pointerOffset = pos;
    const z80Pointer = readWord(rom, pos);
    pos += 2;
    const romOffset = isBank6Ptr(z80Pointer) ? bank6Z80ToRom(z80Pointer) : null;
    command.framePointer = {
      pointerOffset: hex(pointerOffset),
      z80Pointer: hex(z80Pointer, 4),
      romOffset: romOffset == null ? null : hex(romOffset),
      region: romOffset == null ? null : regionRefAt(mapData, romOffset),
      bank6Pointer: romOffset != null && isBank6Offset(romOffset),
    };
    commands.push(command);
    if (command.framePointer.bank6Pointer) {
      frameTargets.push({
        sourceCommandOffset: hex(commandOffset),
        pointerOffset: hex(pointerOffset),
        z80Pointer: hex(z80Pointer, 4),
        romOffset: hex(romOffset),
        region: command.framePointer.region,
      });
    } else {
      issues.push(issue('non_bank6_frame_pointer', 'medium', `frame pointer ${hex(z80Pointer, 4)} at ${hex(pointerOffset)} is not a bank-6 ROM pointer`, {
        sourceCommandOffset: hex(commandOffset),
        pointerOffset: hex(pointerOffset),
        z80Pointer: hex(z80Pointer, 4),
      }));
    }

    if ((control & 0x7F) === 0) {
      termination = {
        kind: 'terminal_hold_0x00',
        normal: true,
        atOffset: hex(commandOffset),
        nextCommandOffset: hex(pos),
        framePointer: command.framePointer,
      };
      break;
    }
  }

  if (!termination) {
    termination = { kind: 'command_limit_reached', normal: false, commandLimit: 256 };
    issues.push(issue('command_limit_reached', 'high', 'stream reached command parse limit before a loop or terminal issue', { commandLimit: 256 }));
  }

  const issueCounts = issues.reduce((acc, item) => {
    acc[item.kind] = (acc[item.kind] || 0) + 1;
    return acc;
  }, {});
  return {
    offset: hex(startOffset),
    region: regionRefAt(mapData, startOffset),
    termination,
    commandCount: commands.length,
    jumpCount: jumps.length,
    frameTargetCount: frameTargets.length,
    issueCount: issues.length,
    issueCounts,
    commands: commands.slice(0, 24),
    jumps: jumps.slice(0, 16),
    frameTargets,
    issues: issues.slice(0, 24),
    confidence: termination.normal && !issues.length ? 'high' : termination.normal ? 'medium' : 'low',
  };
}

function groupFrameTargets(frameTargets) {
  const byRegion = new Map();
  for (const target of frameTargets) {
    const regionId = target.region?.id || `unmapped:${target.romOffset || 'unknown'}`;
    if (!byRegion.has(regionId)) {
      byRegion.set(regionId, {
        region: target.region || null,
        referenceCount: 0,
        targetOffsets: new Set(),
      });
    }
    const item = byRegion.get(regionId);
    item.referenceCount++;
    if (target.romOffset) item.targetOffsets.add(normOffset(target.romOffset));
  }
  return [...byRegion.values()].sort((a, b) => (a.region?.offset || '').localeCompare(b.region?.offset || '')).map(item => ({
    region: item.region,
    referenceCount: item.referenceCount,
    uniqueTargetOffsets: item.targetOffsets.size,
    targetOffsets: [...item.targetOffsets].sort().slice(0, 32),
  }));
}

function buildCatalog(rom, mapData) {
  const refsByOffset = collectFamilyStreamRefs(mapData);
  const streams = [...refsByOffset.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([offset, refs]) => {
    const parsed = parseCommandStream(rom, mapData, parseInt(offset, 16));
    return {
      ...parsed,
      sourceFamilies: refs,
      sourceFamilyCount: refs.length,
      frameTargetRegions: groupFrameTargets(parsed.frameTargets),
    };
  });
  const allFrameTargets = streams.flatMap(stream => stream.frameTargets.map(target => ({
    ...target,
    sourceStreamOffset: stream.offset,
  })));
  const issueCounts = {};
  for (const stream of streams) {
    for (const [kind, count] of Object.entries(stream.issueCounts)) {
      issueCounts[kind] = (issueCounts[kind] || 0) + count;
    }
  }
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [
      'world-animation-family-catalog-2026-06-25',
      'world-animation-behavior-family-catalog-2026-06-25',
    ],
    assetPolicy: 'Metadata only: command offsets, delay/control summaries, pointer offsets/targets, loop status, source family ids, and issue counts. No ROM bytes, decoded sprites, graphics, music, or text payloads are embedded.',
    parserSemantics: {
      routine: '_LABEL_1347_',
      loopOpcode: '0xFF followed by a bank-6 pointer; a jump to an already visited command offset is a normal animation loop terminator.',
      commandShape: 'control/delay byte; optional two motion words when bit 7 is set; then a frame/metasprite pointer stored in IX+12/IX+13.',
      terminalHoldOpcode: 'A command whose low 7 delay bits are zero is a terminal hold: _LABEL_1347_ stores zero in IX+16, and _LABEL_1330_ returns while IX+16 is zero.',
      frameStreamDecoder: '_LABEL_792_ consumes the selected frame stream and stops on byte 0x80; frame stream byte layout is not decoded by this audit.',
    },
    streams,
    frameTargetRegions: groupFrameTargets(allFrameTargets),
    summary: {
      streamCount: streams.length,
      normalLoopStreams: streams.filter(stream => stream.termination.normal).length,
      issueStreams: streams.filter(stream => stream.issueCount > 0).length,
      highConfidenceStreams: streams.filter(stream => stream.confidence === 'high').length,
      mediumConfidenceStreams: streams.filter(stream => stream.confidence === 'medium').length,
      lowConfidenceStreams: streams.filter(stream => stream.confidence === 'low').length,
      parsedCommands: streams.reduce((sum, stream) => sum + stream.commandCount, 0),
      jumps: streams.reduce((sum, stream) => sum + stream.jumpCount, 0),
      framePointerReferences: allFrameTargets.length,
      frameTargetRegions: groupFrameTargets(allFrameTargets).length,
      issueCounts,
      assetPolicy: 'Metadata only: command offsets, delay/control summaries, pointer offsets/targets, loop status, source family ids, and issue counts. No ROM bytes, decoded sprites, graphics, music, or text payloads are embedded.',
    },
  };
}

function addRegionAnnotation(region, refs) {
  region.analysis = region.analysis || {};
  const existing = region.analysis.animationCommandStreamAudit || {};
  const preserved = (existing.streams || []).filter(ref => ref.catalogId !== catalogId);
  const streams = [...preserved, ...refs].slice(0, 96);
  region.analysis.animationCommandStreamAudit = {
    kind: 'normalized_animation_command_stream_region',
    catalogId,
    confidence: streams.some(ref => ref.confidence === 'low') ? 'low' : streams.some(ref => ref.confidence === 'medium') ? 'medium' : 'high',
    summary: 'Region contains normalized _LABEL_1347_ animation command stream metadata.',
    streams,
    evidence: [
      '_LABEL_1347_ treats 0xFF plus a bank-6 pointer as an animation command-stream jump; loop-back jumps are normal terminators.',
      '_LABEL_792_ decodes the selected frame stream separately and terminates frame streams on 0x80.',
      'No ROM bytes, decoded sprites, graphics, music, or text payloads are embedded.',
    ],
    generatedAt: now,
    tool: toolName,
  };
  return {
    id: region.id,
    offset: region.offset,
    type: region.type || 'unknown',
    name: region.name || '',
    streamRefs: refs.length,
  };
}

function annotateMap(mapData, catalog) {
  const refsByRegionId = new Map();
  const missingRegions = [];

  for (const region of mapData.regions || []) {
    if (region.analysis?.animationCommandStreamAudit?.catalogId === catalogId) {
      delete region.analysis.animationCommandStreamAudit;
    }
  }

  function addRef(regionLike, fallbackOffset, ref) {
    let region = regionLike?.id ? findRegionById(mapData, regionLike.id) : null;
    if (!region && fallbackOffset != null) region = findContainingRegion(mapData, parseInt(normOffset(fallbackOffset), 16));
    if (!region) {
      missingRegions.push({ offset: fallbackOffset == null ? null : normOffset(fallbackOffset), role: ref.role, streamOffset: ref.streamOffset });
      return;
    }
    if (!refsByRegionId.has(region.id)) refsByRegionId.set(region.id, { region, refs: [] });
    refsByRegionId.get(region.id).refs.push(ref);
  }

  for (const stream of catalog.streams) {
    addRef(stream.region, stream.offset, {
      catalogId,
      role: 'animation_command_stream',
      streamOffset: stream.offset,
      confidence: stream.confidence,
      termination: stream.termination,
      commandCount: stream.commandCount,
      jumpCount: stream.jumpCount,
      frameTargetCount: stream.frameTargetCount,
      issueCount: stream.issueCount,
      issueCounts: stream.issueCounts,
      sourceFamilyCount: stream.sourceFamilyCount,
      sourceFamilies: stream.sourceFamilies.slice(0, 16),
    });
  }

  const annotatedRegions = [];
  for (const { region, refs } of refsByRegionId.values()) annotatedRegions.push(addRegionAnnotation(region, refs));
  return { annotatedRegions, missingRegions };
}

function main() {
  const rom = fs.readFileSync(romPath);
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(rom, mapData);
  let annotation = { annotatedRegions: [], missingRegions: [] };

  if (apply) {
    annotation = annotateMap(mapData, catalog);
    const finalCatalog = buildCatalog(rom, mapData);
    mapData.animationCommandStreamCatalogs = (mapData.animationCommandStreamCatalogs || []).filter(item => item.id !== catalogId);
    mapData.animationCommandStreamCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'animation_command_stream_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      sourceCatalogs: finalCatalog.sourceCatalogs,
      summary: {
        ...finalCatalog.summary,
        annotatedRegions: annotation.annotatedRegions.length,
        missingRegions: annotation.missingRegions.length,
      },
      parserSemantics: finalCatalog.parserSemantics,
      streamSummary: finalCatalog.streams.map(stream => ({
        offset: stream.offset,
        region: stream.region,
        confidence: stream.confidence,
        termination: stream.termination,
        commandCount: stream.commandCount,
        jumpCount: stream.jumpCount,
        frameTargetCount: stream.frameTargetCount,
        issueCount: stream.issueCount,
        issueCounts: stream.issueCounts,
        sourceFamilyCount: stream.sourceFamilyCount,
        sourceFamilies: stream.sourceFamilies.slice(0, 8),
      })),
      frameTargetRegions: finalCatalog.frameTargetRegions,
      annotatedRegions: annotation.annotatedRegions,
      missingRegions: annotation.missingRegions,
      nextLeads: [
        'Use normalized command stream terminations to update animation family confidence without treating loop-back jumps as parser warnings.',
        'Decode _LABEL_792_ frame stream records so non-bank6 frame-pointer issues can be separated from true frame-stream payload boundaries.',
        'Feed normalized command-stream command counts into the browser animation inspector for per-family previews.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    annotatedRegions: annotation.annotatedRegions.length,
    missingRegions: annotation.missingRegions.length,
  }, null, 2));
}

main();
