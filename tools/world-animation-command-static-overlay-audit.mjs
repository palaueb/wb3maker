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
const catalogId = 'world-animation-command-static-overlay-catalog-2026-06-25';
const reportId = 'animation-command-static-overlay-audit-2026-06-25';
const toolName = 'tools/world-animation-command-static-overlay-audit.mjs';

const staticCatalogId = 'world-animation-static-stream-catalog-2026-06-25';
const commandCatalogId = 'world-animation-command-stream-catalog-2026-06-25';

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

function parseHex(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const match = String(value).match(/^(?:0x|\$)?([0-9a-f]+)$/i);
  return match ? parseInt(match[1], 16) : null;
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

function requireCatalog(mapData, key, id) {
  const catalog = (mapData[key] || []).find(item => item.id === id);
  if (!catalog) throw new Error(`Missing required catalog ${key}.${id}`);
  return catalog;
}

function sumIssueCounts(issueCounts) {
  return Object.values(issueCounts || {}).reduce((sum, count) => sum + count, 0);
}

function countBy(items, getter) {
  const counts = {};
  for (const item of items) {
    const key = getter(item) || 'none';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function addIssueCounts(target, issueCounts) {
  for (const [kind, count] of Object.entries(issueCounts || {})) {
    target[kind] = (target[kind] || 0) + count;
  }
}

function confidenceRank(confidence) {
  if (confidence === 'high') return 3;
  if (confidence === 'medium') return 2;
  if (confidence === 'low') return 1;
  return 0;
}

function overlayKindFor(oldParser) {
  if (!oldParser) return 'new_static_stream_not_in_command_stream_catalog';
  const issueCount = oldParser.issueCount ?? sumIssueCounts(oldParser.issueCounts);
  const terminationKind = oldParser.termination?.kind || 'unknown';
  if (terminationKind === 'fell_into_visited_offset') return 'static_control_zero_explains_linear_fallthrough';
  if (terminationKind === 'invalid_jump_pointer') return 'static_control_zero_explains_invalid_jump_parser_tail';
  if (issueCount > 0) return 'static_control_zero_explains_old_parser_issues';
  if (terminationKind === 'loop_jump' && oldParser.termination?.normal) return 'static_prefix_of_looping_command_stream';
  return 'static_prefix_of_existing_command_stream_parse';
}

function compactSelectorRefs(stream) {
  return (stream.selectedBy || []).slice(0, 16).map(ref => ({
    selectorPair: ref.childEntry?.selectorPair || null,
    variantIndex: ref.variantIndex,
    childTable: ref.childTable?.label || null,
    childEntryOffset: ref.childEntry?.entryOffset || null,
    variantPointerOffset: ref.variantPointerOffset,
    streamZ80Pointer: ref.streamZ80Pointer,
  }));
}

function compactOldParser(oldParser) {
  if (!oldParser) return null;
  return {
    sourceCatalog: commandCatalogId,
    offset: normOffset(oldParser.offset),
    confidence: oldParser.confidence || 'unknown',
    termination: oldParser.termination || null,
    commandCount: oldParser.commandCount ?? null,
    jumpCount: oldParser.jumpCount ?? null,
    frameTargetCount: oldParser.frameTargetCount ?? null,
    issueCount: oldParser.issueCount ?? sumIssueCounts(oldParser.issueCounts),
    issueCounts: oldParser.issueCounts || {},
  };
}

function correctedStaticInterpretation(stream) {
  return {
    sourceCatalog: staticCatalogId,
    confidence: stream.confidence || 'high',
    commandCount: 1,
    frameTargetCount: 1,
    command: {
      commandOffset: stream.command?.commandOffset || stream.offset,
      control: '0x00',
      delay: 0,
      hasMotionWords: false,
      framePointerOffset: stream.command?.framePointerOffset || null,
      frameZ80Pointer: stream.command?.frameZ80Pointer || null,
      frameOffset: stream.frame?.frameOffset || stream.command?.frameOffset || null,
    },
    termination: {
      kind: 'static_control_zero',
      normal: true,
      atOffset: stream.offset,
      runtimeReason: '_LABEL_1330_ returns while IX+16 is zero; no 0xFF loop terminator is required for this selected static frame.',
    },
    frame: {
      frameOffset: stream.frame?.frameOffset || stream.command?.frameOffset || null,
      region: stream.frame?.region || stream.command?.frameRegion || null,
      pieceRecordCount: stream.frame?.pieceRecordCount ?? null,
      tileByteRange: stream.frame?.tileByteRange || null,
      tileByteSegments: (stream.frame?.tileByteSegments || []).slice(0, 32),
      termination: stream.frame?.termination || null,
    },
  };
}

function buildOverlayEntry(mapData, stream, commandByOffset) {
  const offset = normOffset(stream.offset);
  const oldParser = commandByOffset.get(offset) || stream.existingCommandStreamCatalogEntry || null;
  const oldSummary = compactOldParser(oldParser);
  const kind = overlayKindFor(oldSummary);
  const issueCount = oldSummary?.issueCount || 0;
  const confidence = stream.confidence === 'high'
    ? 'high'
    : confidenceRank(stream.confidence) > 0 ? stream.confidence : 'medium';
  return {
    id: `command_static_overlay_${offset.replace(/^0x/i, '')}`,
    kind,
    streamOffset: offset,
    streamRegion: stream.region || regionRef(findContainingRegion(mapData, parseHex(offset))),
    selectedByCount: stream.selectedByCount || (stream.selectedBy || []).length,
    selectorSamples: compactSelectorRefs(stream),
    oldParser: oldSummary,
    correctedStaticInterpretation: correctedStaticInterpretation(stream),
    explainedOldParserIssues: oldSummary ? {
      oldParserIssueCount: issueCount,
      oldParserIssueCounts: oldSummary.issueCounts,
      oldTerminationKind: oldSummary.termination?.kind || null,
      oldConfidence: oldSummary.confidence,
      explanation: issueCount > 0 || oldSummary.confidence === 'low'
        ? 'The older command-stream parser continued through bytes after the selected control 0x00. Runtime _LABEL_1330_ returns before those bytes are interpreted as commands on this selector path.'
        : 'The static selector path is a one-frame prefix of a valid command-stream region; runtime selector semantics decide which entry offset is active.',
    } : null,
    evidence: [
      'Static-stream catalog resolved this selector path as control byte 0x00 followed by one bank-6 frame pointer.',
      '_LABEL_1347_ writes control&0x7F into IX+16 and stores the following frame pointer into IX+12/IX+13.',
      '_LABEL_1330_ returns immediately while IX+16 is zero, so the selected frame is static and does not need a 0xFF loop terminator.',
      '_LABEL_792_ consumes the selected frame stream and terminates it on 0x80.',
    ],
    confidence,
  };
}

function buildCatalog(mapData) {
  const staticCatalog = requireCatalog(mapData, 'animationStaticStreamCatalogs', staticCatalogId);
  const commandCatalog = requireCatalog(mapData, 'animationCommandStreamCatalogs', commandCatalogId);
  const commandByOffset = new Map((commandCatalog.streams || []).map(stream => [normOffset(stream.offset), stream]));
  const overlays = (staticCatalog.staticStreams || [])
    .map(stream => buildOverlayEntry(mapData, stream, commandByOffset))
    .sort((a, b) => a.streamOffset.localeCompare(b.streamOffset));

  const explainedIssueCounts = {};
  for (const overlay of overlays) {
    if (overlay.oldParser) addIssueCounts(explainedIssueCounts, overlay.oldParser.issueCounts);
  }

  const existingOverlays = overlays.filter(overlay => overlay.oldParser);
  const oldIssueOverlays = existingOverlays.filter(overlay => (overlay.oldParser.issueCount || 0) > 0);
  const oldLowOrMediumOverlays = existingOverlays.filter(overlay => ['low', 'medium'].includes(overlay.oldParser.confidence));

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [staticCatalogId, commandCatalogId],
    assetPolicy: 'Metadata only: selector paths, stream/frame offsets, old parser statuses, aggregate counts, region ids, and evidence. No ROM bytes, decoded sprites, graphics, audio, or text payloads are embedded.',
    purpose: 'Overlay zero-control static animation semantics onto older command-stream parser results so tooling can distinguish real command streams from selector-specific static frame prefixes.',
    semantics: {
      correctedRuntimeRule: '_LABEL_1330_ returns immediately when IX+16 is zero; _LABEL_1347_ sets IX+16 to control&0x7F, so control byte 0x00 selects a static frame and stops command advancement.',
      oldParserCaution: 'The command-stream catalog is preserved as a linear parser snapshot. This overlay explains entries where that parser walked beyond a valid selected static command.',
      frameConsumer: '_LABEL_792_ consumes the selected frame stream and stops on 0x80.',
    },
    overlays,
    summary: {
      overlayCount: overlays.length,
      existingCommandCatalogOverlays: existingOverlays.length,
      newStaticStreamsNotInCommandCatalog: overlays.length - existingOverlays.length,
      oldIssueOverlays: oldIssueOverlays.length,
      oldLowOrMediumConfidenceOverlays: oldLowOrMediumOverlays.length,
      overlayKindCounts: countBy(overlays, overlay => overlay.kind),
      oldTerminationKindCounts: countBy(existingOverlays, overlay => overlay.oldParser?.termination?.kind),
      explainedOldParserIssueCounts: explainedIssueCounts,
      affectedStreamRegions: new Set(overlays.map(overlay => overlay.streamRegion?.id).filter(Boolean)).size,
      assetPolicy: 'Metadata only: no ROM bytes, decoded sprites, graphics, audio, or text payloads are embedded.',
    },
  };
}

function compactOverlayRef(overlay) {
  return {
    catalogId,
    id: overlay.id,
    kind: overlay.kind,
    streamOffset: overlay.streamOffset,
    selectedByCount: overlay.selectedByCount,
    selectorSamples: overlay.selectorSamples,
    oldParser: overlay.oldParser,
    correctedStaticInterpretation: overlay.correctedStaticInterpretation,
    explainedOldParserIssues: overlay.explainedOldParserIssues,
    confidence: overlay.confidence,
  };
}

function annotateMap(mapData, catalog) {
  const refsByRegionId = new Map();
  const missingRegions = [];

  function addRef(regionLike, fallbackOffset, ref) {
    let region = regionLike?.id ? findRegionById(mapData, regionLike.id) : null;
    const fallback = parseHex(fallbackOffset);
    if (!region && fallback != null) region = findContainingRegion(mapData, fallback);
    if (!region) {
      missingRegions.push({ streamOffset: fallbackOffset, refId: ref.id });
      return;
    }
    if (!refsByRegionId.has(region.id)) refsByRegionId.set(region.id, { region, refs: [] });
    refsByRegionId.get(region.id).refs.push(ref);
  }

  for (const overlay of catalog.overlays) {
    addRef(overlay.streamRegion, overlay.streamOffset, compactOverlayRef(overlay));
  }

  const annotatedRegions = [];
  for (const { region, refs } of refsByRegionId.values()) {
    region.analysis = region.analysis || {};
    const existing = region.analysis.animationCommandStaticOverlayAudit || {};
    const preserved = (existing.overlays || []).filter(ref => ref.catalogId !== catalogId);
    const overlays = [...preserved, ...refs].sort((a, b) => a.streamOffset.localeCompare(b.streamOffset)).slice(0, 96);
    region.analysis.animationCommandStaticOverlayAudit = {
      kind: 'animation_command_static_overlay_region',
      catalogId,
      confidence: overlays.some(ref => ref.confidence === 'low') ? 'low' : overlays.some(ref => ref.confidence === 'medium') ? 'medium' : 'high',
      summary: 'Region contains animation stream offsets where zero-control static selector semantics explain or supplement the command-stream parser.',
      overlays,
      evidence: [
        '_LABEL_1347_ stores control&0x7F in IX+16 and stores the frame pointer in IX+12/IX+13.',
        '_LABEL_1330_ returns while IX+16 is zero, preventing linear fall-through after a selected static control byte 0x00.',
        '_LABEL_792_ frame streams terminate on 0x80; this annotation stores offsets and aggregate metadata only.',
      ],
      generatedAt: now,
      tool: toolName,
    };
    annotatedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type || 'unknown',
      name: region.name || '',
      overlayRefs: refs.length,
    });
  }
  return { annotatedRegions, missingRegions };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  let annotation = { annotatedRegions: [], missingRegions: [] };

  if (apply) {
    annotation = annotateMap(mapData, catalog);
    const finalCatalog = buildCatalog(mapData);
    mapData.animationCommandStaticOverlayCatalogs = (mapData.animationCommandStaticOverlayCatalogs || []).filter(item => item.id !== catalogId);
    mapData.animationCommandStaticOverlayCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'animation_command_static_overlay_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      sourceCatalogs: finalCatalog.sourceCatalogs,
      summary: {
        ...finalCatalog.summary,
        annotatedRegions: annotation.annotatedRegions.length,
        missingRegions: annotation.missingRegions.length,
      },
      semantics: finalCatalog.semantics,
      overlaySamples: finalCatalog.overlays.slice(0, 96),
      annotatedRegions: annotation.annotatedRegions,
      missingRegions: annotation.missingRegions,
      nextLeads: [
        'Teach the browser animation inspector to prefer animationCommandStaticOverlayCatalogs for selector paths whose control byte is 0x00.',
        'Separate true non-bank6 frame-pointer problems from bytes reached only by obsolete linear fall-through in command-stream summaries.',
        'Use the overlay to drive sprite tile-base provenance for static player and enemy pose previews.',
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
