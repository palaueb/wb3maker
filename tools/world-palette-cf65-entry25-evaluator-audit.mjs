#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const romPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).sms');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-palette-cf65-entry25-evaluator-audit.mjs';
const catalogId = 'world-palette-cf65-entry25-evaluator-catalog-2026-06-26';
const reportId = 'palette-cf65-entry25-evaluator-audit-2026-06-26';

const paletteScriptCatalogId = 'world-palette-script-catalog-2026-06-24';
const cf65WriterCatalogId = 'world-palette-cf65-writer-catalog-2026-06-26';
const runtimeTraceSeedCatalogId = 'world-runtime-ram-trace-seed-catalog-2026-06-26';
const targetIndex = 25;
const targetScriptLabel = '_DATA_1CABB_';
const targetTailRegionIds = ['r2815', 'r2816', 'r2817'];
const bank7Base = 0x1C000;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function hex(value, pad = 5) {
  return `0x${Number(value).toString(16).toUpperCase().padStart(pad, '0')}`;
}

function parseHex(value) {
  const match = /^0x([0-9A-F]+)$/i.exec(String(value || ''));
  return match ? parseInt(match[1], 16) : null;
}

function readWordLE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function z80ToBank7Rom(pointer) {
  if (pointer < 0x8000 || pointer >= 0xC000) return null;
  return bank7Base + (pointer - 0x8000);
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const catalog = value.find(item => item?.id === id);
    if (catalog) return catalog;
  }
  return null;
}

function requireCatalog(mapData, id) {
  const catalog = findCatalog(mapData, id);
  if (!catalog) throw new Error(`Missing required catalog ${id}`);
  return catalog;
}

function findRam(mapData, address) {
  return (mapData.ram || []).find(entry => String(entry.address || '').toUpperCase() === address) || null;
}

function findRegion(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function compactRegion(region) {
  if (!region) return null;
  return {
    id: region.id,
    offset: region.offset,
    size: region.size || 0,
    type: region.type || 'unknown',
    name: region.name || '',
    confidence: region.confidence || null,
  };
}

function regionStart(region) {
  return parseHex(region?.offset) ?? 0;
}

function regionEnd(region) {
  return regionStart(region) + Number(region?.size || 0);
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items || []) {
    const key = keyFn(item);
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function insertAfter(list, afterId, newId) {
  const out = (list || []).filter(id => id !== newId);
  const index = out.indexOf(afterId);
  if (index === -1) out.push(newId);
  else out.splice(index + 1, 0, newId);
  return out;
}

function commandClass(command) {
  if (command === 0xFF) return 'end';
  if (command === 0xF0) return 'jump';
  return (command & 0x80) ? 'delayed_write' : 'immediate_write';
}

function evaluateEntry25(rom, scriptStart, parserEndExclusive, postParserTailStart, postParserTailEndExclusive) {
  let pos = scriptStart;
  const visited = new Set();
  const commandEvents = [];
  const controlFlowEdges = [];
  const warnings = [];
  let termination = 'max_step_limit';
  let repeatedCommandOffset = null;
  let steps = 0;

  while (steps < 2048) {
    steps++;
    if (pos < 0 || pos >= rom.length) {
      termination = 'out_of_rom_bounds';
      warnings.push(`Command pointer left ROM at ${hex(pos)}.`);
      break;
    }
    if (visited.has(pos)) {
      termination = 'loop_revisited_command_offset';
      repeatedCommandOffset = pos;
      break;
    }
    visited.add(pos);
    const command = rom[pos];
    const kind = commandClass(command);
    const inPostParserTail = pos >= postParserTailStart && pos < postParserTailEndExclusive;
    const event = {
      offset: hex(pos),
      class: kind,
      inParsedPrefix: pos >= scriptStart && pos < parserEndExclusive,
      inPostParserTail,
    };

    if (kind === 'end') {
      event.nextOffset = null;
      commandEvents.push(event);
      termination = 'end_command';
      break;
    }

    if (kind === 'jump') {
      if (pos + 2 >= rom.length) {
        event.nextOffset = null;
        commandEvents.push(event);
        termination = 'truncated_jump_pointer';
        warnings.push(`Jump command at ${hex(pos)} lacks a complete pointer operand.`);
        break;
      }
      const pointer = readWordLE(rom, pos + 1);
      const target = z80ToBank7Rom(pointer);
      const fallthrough = pos + 3;
      event.jumpTarget = target == null ? null : hex(target);
      event.blockedFallthroughOffset = hex(fallthrough);
      event.jumpTargetInsideParsedPrefix = target != null && target >= scriptStart && target < parserEndExclusive;
      event.fallthroughWouldEnterPostParserTail = fallthrough >= parserEndExclusive && fallthrough < postParserTailEndExclusive;
      commandEvents.push(event);
      controlFlowEdges.push({
        from: hex(pos),
        to: target == null ? null : hex(target),
        kind: 'f0_jump',
        blockedFallthroughOffset: hex(fallthrough),
      });
      if (target == null) {
        termination = 'jump_target_outside_bank7_window';
        warnings.push(`Jump command at ${hex(pos)} points outside the bank-7 ROM window.`);
        break;
      }
      pos = target;
      continue;
    }

    const nextOffset = pos + (kind === 'delayed_write' ? 3 : 2);
    event.nextOffset = hex(nextOffset);
    event.nextOffsetInsideParsedPrefix = nextOffset >= scriptStart && nextOffset <= parserEndExclusive;
    commandEvents.push(event);
    controlFlowEdges.push({
      from: hex(pos),
      to: hex(nextOffset),
      kind: kind === 'delayed_write' ? 'delayed_resume' : 'immediate_continue',
    });
    pos = nextOffset;
  }

  const visitedOffsets = commandEvents.map(event => parseHex(event.offset)).filter(value => value != null);
  const postParserTailHits = commandEvents.filter(event => event.inPostParserTail);
  const parsedPrefixEvents = commandEvents.filter(event => event.inParsedPrefix);
  const jumpEvents = commandEvents.filter(event => event.class === 'jump');
  const blockedFallthroughs = jumpEvents
    .map(event => parseHex(event.blockedFallthroughOffset))
    .filter(value => value != null);

  return {
    termination,
    repeatedCommandOffset: repeatedCommandOffset == null ? null : hex(repeatedCommandOffset),
    visitedCommandCount: commandEvents.length,
    visitedCommandRange: visitedOffsets.length ? {
      min: hex(Math.min(...visitedOffsets)),
      max: hex(Math.max(...visitedOffsets)),
    } : null,
    parsedPrefixCommandCount: parsedPrefixEvents.length,
    postParserTailHitCount: postParserTailHits.length,
    postParserTailHits: postParserTailHits.map(event => ({ offset: event.offset, class: event.class })),
    jumpCount: jumpEvents.length,
    jumpTargets: jumpEvents.map(event => ({
      from: event.offset,
      to: event.jumpTarget,
      jumpTargetInsideParsedPrefix: event.jumpTargetInsideParsedPrefix,
      blockedFallthroughOffset: event.blockedFallthroughOffset,
      fallthroughWouldEnterPostParserTail: event.fallthroughWouldEnterPostParserTail,
    })),
    blockedFallthroughRange: blockedFallthroughs.length ? {
      min: hex(Math.min(...blockedFallthroughs)),
      max: hex(Math.max(...blockedFallthroughs)),
    } : null,
    commandClassCounts: countBy(commandEvents, event => event.class),
    commandEvents,
    controlFlowEdges,
    warnings,
  };
}

function tailBoundary(region, parserEndExclusive) {
  const start = regionStart(region);
  return {
    region: compactRegion(region),
    startsAfterParser: start >= parserEndExclusive,
    distanceFromParserEndBytes: start - parserEndExclusive,
  };
}

function buildCatalog(mapData, rom) {
  const paletteCatalog = requireCatalog(mapData, paletteScriptCatalogId);
  const writerCatalog = requireCatalog(mapData, cf65WriterCatalogId);
  requireCatalog(mapData, runtimeTraceSeedCatalogId);
  const targetScript = (paletteCatalog.scripts || []).find(script => script.index === targetIndex);
  if (!targetScript) throw new Error(`Missing palette script index ${targetIndex}`);
  const scriptStart = parseHex(targetScript.range?.start);
  const parserEndExclusive = parseHex(targetScript.range?.endExclusive);
  if (scriptStart == null || parserEndExclusive == null) throw new Error('Missing target script range.');
  const tailRegions = targetTailRegionIds.map(id => tailBoundary(findRegion(mapData, id), parserEndExclusive));
  const postParserTailStart = parserEndExclusive;
  const postParserTailEndExclusive = Math.max(...tailRegions.map(item => regionEnd(item.region)).filter(value => value > 0));
  const evaluation = evaluateEntry25(rom, scriptStart, parserEndExclusive, postParserTailStart, postParserTailEndExclusive);
  const targetWriterCount = writerCatalog.summary?.targetIndexDirectWriterCount || 0;
  const status = targetWriterCount > 0 &&
    evaluation.postParserTailHitCount === 0 &&
    evaluation.jumpTargets.every(item => item.jumpTargetInsideParsedPrefix)
    ? 'entry_25_state_loop_blocks_tail_fallthrough'
    : 'entry_25_state_evaluator_requires_trace';

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [paletteScriptCatalogId, cf65WriterCatalogId, runtimeTraceSeedCatalogId],
    assetPolicy: 'Metadata only: script indices, offsets, command classes, control-flow edges, status counts, RAM labels, and region ids. No ROM bytes, palette values, decoded colors, screenshots, pixels, audio, instruction bytes, or register traces are embedded.',
    summary: {
      targetIndex,
      targetScriptLabel,
      targetWriterCount,
      scriptStart: hex(scriptStart),
      parserEndExclusive: hex(parserEndExclusive),
      parserEndReason: targetScript.endReason || null,
      parserLoopTarget: targetScript.loopTarget || null,
      visitedCommandCount: evaluation.visitedCommandCount,
      parsedPrefixCommandCount: evaluation.parsedPrefixCommandCount,
      postParserTailHitCount: evaluation.postParserTailHitCount,
      jumpCount: evaluation.jumpCount,
      termination: evaluation.termination,
      repeatedCommandOffset: evaluation.repeatedCommandOffset,
      commandClassCounts: evaluation.commandClassCounts,
      tailRegionCount: tailRegions.length,
      tailRegionsAfterParserCount: tailRegions.filter(item => item.startsAfterParser).length,
      status,
      persistedRomByteCount: 0,
      persistedPaletteByteCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
      persistedRegisterTraceCount: 0,
    },
    targetScript: {
      index: targetIndex,
      label: targetScriptLabel,
      range: targetScript.range,
      endReason: targetScript.endReason,
      loopTarget: targetScript.loopTarget,
      directIndexWriteCount: targetScript.directIndexWriteCount || 0,
    },
    evaluation,
    tailRegions,
    evidence: [
      `${cf65WriterCatalogId} records a direct _RAM_CF65_ writer selecting entry 25 at ASM line 28675.`,
      `${paletteScriptCatalogId} parses entry 25 from ${hex(scriptStart)} through ${hex(parserEndExclusive)} with ${targetScript.endReason}.`,
      `Following _LABEL_10BC_ F0 control flow loops from ${evaluation.jumpTargets[0]?.from || 'unknown'} to ${evaluation.jumpTargets[0]?.to || 'unknown'} instead of falling through into the post-parser tail.`,
      `The evaluator visited ${evaluation.visitedCommandCount} command offset(s) and found ${evaluation.postParserTailHitCount} post-parser tail command hit(s).`,
      'Evaluator output stores command classes and offsets only; command bytes, palette values, and register traces are not persisted.',
    ],
    nextLeads: [
      'Use this control-flow evaluator as the expected-path oracle for a future live _LABEL_10BC_ frame trace.',
      'Keep r2815-r2817 quarantined unless a separate non-palette parser consumer addresses 0x1CBB9-0x1CCBF.',
      'If a browser palette timeline is added, drive it from local ROM bytes at runtime and persist only offsets/counts in project metadata.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  const ramEntry = findRam(mapData, '$CF65');
  if (ramEntry) {
    ramEntry.analysis = ramEntry.analysis || {};
    ramEntry.analysis.paletteCf65Entry25EvaluatorAudit = {
      catalogId,
      kind: 'palette_script_entry25_state_evaluator',
      status: catalog.summary.status,
      confidence: 'high_for_control_flow_boundary',
      targetIndex,
      visitedCommandCount: catalog.summary.visitedCommandCount,
      postParserTailHitCount: catalog.summary.postParserTailHitCount,
      jumpCount: catalog.summary.jumpCount,
      termination: catalog.summary.termination,
      summary: `_LABEL_10BC_ control-flow evaluation for _RAM_CF65_=25 loops inside the parsed ${targetScriptLabel} prefix and does not execute r2815-r2817 tail commands.`,
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
  }

  const annotatedTailRegions = [];
  for (const item of catalog.tailRegions) {
    const region = item.region ? findRegion(mapData, item.region.id) : null;
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.paletteCf65Entry25EvaluatorAudit = {
      catalogId,
      kind: 'palette_tail_entry25_control_flow_exclusion',
      status: catalog.summary.status,
      confidence: 'high_for_palette_parser_exclusion_medium_for_unknown_payload_role',
      targetIndex,
      startsAfterParser: item.startsAfterParser,
      distanceFromParserEndBytes: item.distanceFromParserEndBytes,
      postParserTailHitCount: catalog.summary.postParserTailHitCount,
      summary: `${region.id} is not reached by the evaluated _LABEL_10BC_ control flow for _RAM_CF65_=25.`,
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotatedTailRegions.push({
      id: region.id,
      offset: region.offset,
      startsAfterParser: item.startsAfterParser,
      distanceFromParserEndBytes: item.distanceFromParserEndBytes,
    });
  }
  return { ramAnnotated: Boolean(ramEntry), annotatedTailRegions };
}

function updateStaticMap(catalog) {
  if (!fs.existsSync(staticMapPath)) return;
  const staticMap = readJson(staticMapPath);
  staticMap.analyzedAt = now;
  staticMap.summary = staticMap.summary || {};
  staticMap.summary.paletteCf65Entry25EvaluatorCatalog = catalogId;
  staticMap.summary.paletteCf65Entry25VisitedCommands = catalog.summary.visitedCommandCount;
  staticMap.summary.paletteCf65Entry25PostParserTailHits = catalog.summary.postParserTailHitCount;
  staticMap.summary.paletteCf65Entry25JumpCount = catalog.summary.jumpCount;
  staticMap.summary.paletteCf65Entry25Status = catalog.summary.status;
  staticMap.primaryCatalogs = staticMap.primaryCatalogs || {};
  staticMap.primaryCatalogs.rendering = insertAfter(
    staticMap.primaryCatalogs.rendering,
    cf65WriterCatalogId,
    catalogId
  );
  staticMap.nextLeads = (staticMap.nextLeads || []).filter(note => !note.includes(catalogId));
  staticMap.nextLeads.push('Use world-palette-cf65-entry25-evaluator-catalog-2026-06-26 as the expected control-flow oracle when live-tracing _LABEL_10BC_ and the r2815-r2817 palette tail exclusion.');
  writeJson(staticMapPath, staticMap);
}

function reportTailRegions(catalog) {
  return catalog.tailRegions.map(item => ({
    id: item.region?.id || null,
    offset: item.region?.offset || null,
    size: item.region?.size || 0,
    startsAfterParser: item.startsAfterParser,
    distanceFromParserEndBytes: item.distanceFromParserEndBytes,
  }));
}

function main() {
  const mapData = readJson(mapPath);
  const rom = fs.readFileSync(romPath);
  const catalog = buildCatalog(mapData, rom);
  let appliedAnnotations = { ramAnnotated: false, annotatedTailRegions: [] };

  if (apply) {
    appliedAnnotations = applyCatalog(mapData, catalog);
    mapData.paletteCatalogs = (mapData.paletteCatalogs || []).filter(item => item.id !== catalogId);
    mapData.paletteCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'palette_cf65_entry25_evaluator_audit',
      schemaVersion: 1,
      generatedAt: now,
      tool: `${toolName} --apply`,
      catalogId,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: {
        ...catalog.summary,
        ramAnnotated: appliedAnnotations.ramAnnotated,
        annotatedTailRegionCount: appliedAnnotations.annotatedTailRegions.length,
      },
      targetScript: catalog.targetScript,
      evaluationSummary: {
        termination: catalog.evaluation.termination,
        repeatedCommandOffset: catalog.evaluation.repeatedCommandOffset,
        visitedCommandRange: catalog.evaluation.visitedCommandRange,
        blockedFallthroughRange: catalog.evaluation.blockedFallthroughRange,
        jumpTargets: catalog.evaluation.jumpTargets,
        commandClassCounts: catalog.evaluation.commandClassCounts,
        postParserTailHits: catalog.evaluation.postParserTailHits,
      },
      controlFlowEdges: catalog.evaluation.controlFlowEdges,
      tailRegions: reportTailRegions(catalog),
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
    });
    writeJson(mapPath, mapData);
    updateStaticMap(catalog);
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    reportId,
    summary: {
      ...catalog.summary,
      ramAnnotated: appliedAnnotations.ramAnnotated,
      annotatedTailRegionCount: appliedAnnotations.annotatedTailRegions.length,
    },
    evaluationSummary: {
      termination: catalog.evaluation.termination,
      repeatedCommandOffset: catalog.evaluation.repeatedCommandOffset,
      visitedCommandRange: catalog.evaluation.visitedCommandRange,
      blockedFallthroughRange: catalog.evaluation.blockedFallthroughRange,
      jumpTargets: catalog.evaluation.jumpTargets,
      commandClassCounts: catalog.evaluation.commandClassCounts,
      postParserTailHits: catalog.evaluation.postParserTailHits,
    },
    tailRegions: reportTailRegions(catalog),
  }, null, 2));
}

main();
