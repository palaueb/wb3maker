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
const now = '2026-06-24T00:00:00Z';
const catalogId = 'world-screen-prog-reachability-catalog-2026-06-24';
const reportId = 'screen-prog-reachability-audit-2026-06-24';
const decoderCatalogId = 'world-screen-prog-catalog-2026-06-24';
const tableCatalogId = 'world-screen-prog-table-catalog-2026-06-24';

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function cleanCode(line) {
  return line.split(';')[0].trim();
}

function labelOffset(label) {
  const match = /^_DATA_([0-9A-F]+)_$/i.exec(label || '') || /^_LABEL_([0-9A-F]+)_$/i.exec(label || '');
  return match ? parseInt(match[1], 16) : null;
}

function regionBounds(region) {
  const start = parseInt(region.offset, 16);
  return { start, end: start + (region.size || 0) };
}

function findContainingRegion(mapData, offset) {
  return (mapData.regions || []).find(region => {
    const bounds = regionBounds(region);
    return offset >= bounds.start && offset < bounds.end;
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

function asmOffsetName(offset) {
  return offset.toString(16).toUpperCase();
}

function romToZ80Address(offset) {
  const bank = Math.floor(offset / 0x4000);
  const inBank = offset & 0x3FFF;
  return bank < 2 ? offset : 0x8000 + inBank;
}

function parseLabelReference(label) {
  const offset = labelOffset(label);
  return offset == null ? null : {
    label,
    offset: hex(offset),
  };
}

function labelCandidatesForRegion(region) {
  const start = parseInt(region.offset, 16);
  const offsetName = asmOffsetName(start);
  const labels = new Set([
    `_DATA_${offsetName}_`,
    `_LABEL_${offsetName}_`,
  ]);
  if (/^_(DATA|LABEL)_[0-9A-F]+_$/i.test(region.name || '')) {
    labels.add(region.name);
  }
  return [...labels];
}

function lineSummary(line, index, kind, detail = {}) {
  return {
    line: index + 1,
    kind,
    text: line.trim().slice(0, 160),
    ...detail,
  };
}

function pushLimited(list, item, limit = 12) {
  if (list.length < limit) list.push(item);
}

function scanAsmReferences(lines, region) {
  const start = parseInt(region.offset, 16);
  const startLabels = new Set([
    `_DATA_${asmOffsetName(start)}_`,
    `_LABEL_${asmOffsetName(start)}_`,
  ]);
  const parentLabels = new Set();
  if (/^_(DATA|LABEL)_[0-9A-F]+_$/i.test(region.name || '')) {
    const namedOffset = labelOffset(region.name);
    if (namedOffset === start) startLabels.add(region.name);
    else parentLabels.add(region.name);
  }
  const labels = [...new Set([...startLabels, ...parentLabels])];
  const z80Address = romToZ80Address(start);
  const z80Hex = z80Address.toString(16).toUpperCase().padStart(4, '0');
  const offsetHex = asmOffsetName(start);
  const refs = {
    labelCandidates: labelCandidatesForRegion(region).map(label => parseLabelReference(label)).filter(Boolean),
    z80Address: hex(z80Address, 4),
    exactLabelDefinitions: [],
    exactCodeReferences: [],
    exactDataReferences: [],
    exactCommentReferences: [],
    parentLabelReferences: [],
    incbinReferences: [],
    z80CodeReferences: [],
    offsetCommentReferences: [],
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const code = cleanCode(raw);
    const comment = raw.includes(';') ? raw.slice(raw.indexOf(';') + 1) : '';
    for (const label of labels) {
      if (!raw.includes(label)) continue;
      if (new RegExp(`^${label}:`).test(raw.trim())) {
        pushLimited(refs.exactLabelDefinitions, lineSummary(raw, i, 'label_definition', { label }));
      } else if (code.includes(label)) {
        if (/^\s*\.incbin\b/i.test(code)) {
          pushLimited(refs.incbinReferences, lineSummary(raw, i, 'incbin_filename_reference', { label }));
        } else if (parentLabels.has(label)) {
          pushLimited(refs.parentLabelReferences, lineSummary(raw, i, 'parent_label_reference', { label }));
        } else {
          const kind = /^\s*\.(dw|db|word|byte)\b/i.test(code) ? 'data_reference' : 'code_reference';
          const list = kind === 'data_reference' ? refs.exactDataReferences : refs.exactCodeReferences;
          pushLimited(list, lineSummary(raw, i, kind, { label }));
        }
      } else if (comment.includes(label)) {
        pushLimited(refs.exactCommentReferences, lineSummary(raw, i, 'comment_reference', { label }));
      }
    }

    if (code && new RegExp(`\\$${z80Hex}\\b|\\b${z80Hex}h\\b`, 'i').test(code)) {
      pushLimited(refs.z80CodeReferences, lineSummary(raw, i, 'z80_immediate_reference', {
        z80Address: hex(z80Address, 4),
      }));
    }
    if (!code && new RegExp(`\\b${offsetHex}\\b`, 'i').test(comment)) {
      pushLimited(refs.offsetCommentReferences, lineSummary(raw, i, 'offset_comment_reference', {
        offset: hex(start),
      }));
    }
  }

  return refs;
}

function classifyUnresolvedRegion(region, decoderSummary, asmReferences) {
  const start = parseInt(region.offset, 16);
  const notes = region.notes || '';
  const reasons = ['no_reachability_root'];
  const evidence = [
    'No direct _LABEL_604_ BC source, _DATA_1CCC0_ pointer-table target, or decoded root continuation currently reaches this region.',
  ];
  const parentLabel = /^_(DATA|LABEL)_([0-9A-F]+)_$/i.exec(region.name || '');
  const parentLabelOffset = parentLabel ? parseInt(parentLabel[2], 16) : null;
  const hasExactCodeReference = asmReferences.exactCodeReferences.length > 0 || asmReferences.z80CodeReferences.length > 0;
  const hasExactDataReference = asmReferences.exactDataReferences.length > 0;
  const hasPointerComment = /Pointer Table/i.test(notes)
    || asmReferences.offsetCommentReferences.some(ref => /Pointer Table/i.test(ref.text));

  if (!hasExactCodeReference && !hasExactDataReference) {
    reasons.push('no_exact_asm_consumer');
    evidence.push('No exact label/data reference or Z80 immediate reference to this region start was found in executable ASM text.');
  }
  if (asmReferences.parentLabelReferences.length && !hasExactCodeReference && !hasExactDataReference) {
    reasons.push('parent_label_only_reference');
    evidence.push('References found for the enclosing ASM label do not prove this split offset is an independent consumer target.');
  }
  if (hasPointerComment) {
    reasons.push('assembler_pointer_comment_only');
    evidence.push('ASM/comments describe this offset as pointer/table data, but no executable consumer has been confirmed yet.');
  }
  if (parentLabelOffset != null && parentLabelOffset !== start) {
    reasons.push('split_inside_named_asm_data_block');
    evidence.push(`Map region starts at ${region.offset}, inside named ASM data label ${region.name} (${hex(parentLabelOffset)}).`);
  }
  if ((decoderSummary?.outsideRegionBytes || 0) > 0) {
    reasons.push('decoder_walks_outside_region');
    evidence.push(`The screen_prog decoder visits ${decoderSummary.outsideRegionBytes} byte(s) outside the mapped region, so byte-shape alone is not reliable evidence.`);
  }
  if (decoderSummary?.confidence === 'high' && !(decoderSummary?.outsideRegionBytes || 0)) {
    reasons.push('screen_like_byte_shape_unrooted');
    evidence.push('The byte stream decodes cleanly with the screen_prog model, but still lacks a confirmed runtime screen-program consumer.');
  }

  let suspectedKind = 'unresolved_screen_prog_candidate';
  if (hasPointerComment && (region.size || 0) <= 4) suspectedKind = 'pointer_table_candidate';
  else if (hasPointerComment) suspectedKind = 'table_or_table_payload_candidate';
  else if (parentLabelOffset != null && parentLabelOffset !== start) suspectedKind = 'split_data_tail_candidate';
  else if ((decoderSummary?.outsideRegionBytes || 0) > 0) suspectedKind = 'false_positive_decode_candidate';

  return {
    status: 'unconfirmed',
    suspectedKind,
    reasons,
    confidence: 'low',
    asmReferences,
    guidance: 'Do not render or promote this region as an independent screen_prog root until a runtime consumer is traced.',
    evidence,
  };
}

function decoderEntries(mapData) {
  const catalog = (mapData.screenProgCatalogs || []).find(item => item.id === decoderCatalogId);
  return catalog?.entries || [];
}

function decoderEntryByRegion(mapData) {
  const entries = decoderEntries(mapData);
  const byId = new Map();
  for (const entry of entries) {
    if (entry.region?.id) byId.set(entry.region.id, entry);
  }
  return byId;
}

function tableEntries(mapData) {
  const catalog = (mapData.screenProgCatalogs || []).find(item => item.id === tableCatalogId);
  return catalog?.entries || [];
}

function scanDirectDecoderCalls(asmText, mapData) {
  const lines = asmText.split(/\r?\n/);
  const calls = [];
  let currentLabel = null;

  function findBcSource(lineIndex) {
    for (let i = lineIndex - 1; i >= 0 && i >= lineIndex - 10; i--) {
      const labelMatch = /^(_LABEL_[0-9A-F]+_):/.exec(lines[i]);
      if (labelMatch) break;
      const code = cleanCode(lines[i]);
      const source = /\bld\s+bc,\s*(_DATA_[0-9A-F]+_)\b/i.exec(code);
      if (source) return { label: source[1], line: i + 1 };
      if (/\bld\s+b,\s*d\b/i.test(code) || /\bld\s+c,\s*e\b/i.test(code)) {
        return null;
      }
    }
    return null;
  }

  for (let i = 0; i < lines.length; i++) {
    const labelMatch = /^(_LABEL_[0-9A-F]+_):/.exec(lines[i]);
    if (labelMatch) {
      currentLabel = labelMatch[1];
      continue;
    }
    if (!/\bcall\s+_LABEL_604_\b/i.test(cleanCode(lines[i]))) continue;
    const source = findBcSource(i);
    if (!source) continue;
    const offset = labelOffset(source.label);
    const region = offset == null ? null : findContainingRegion(mapData, offset);
    calls.push({
      callLine: i + 1,
      sourceLine: source.line,
      callerLabel: currentLabel,
      sourceLabel: source.label,
      sourceOffset: offset == null ? null : hex(offset),
      region: regionRef(region),
      evidence: [
        `ASM line ${source.line} loads BC with ${source.label}.`,
        `ASM line ${i + 1} calls _LABEL_604_ with that BC source.`,
      ],
    });
  }
  return calls;
}

function buildRootMap(mapData, directCalls) {
  const roots = new Map();
  for (const call of directCalls) {
    if (!call.region?.id) continue;
    const item = roots.get(call.region.id) || {
      region: call.region,
      sources: [],
    };
    item.sources.push({
      kind: 'direct_bc_call',
      callerLabel: call.callerLabel,
      sourceLabel: call.sourceLabel,
      sourceLine: call.sourceLine,
      callLine: call.callLine,
      evidence: call.evidence,
    });
    roots.set(call.region.id, item);
  }
  for (const entry of tableEntries(mapData)) {
    if (!entry.targetRegion?.id) continue;
    const item = roots.get(entry.targetRegion.id) || {
      region: entry.targetRegion,
      sources: [],
    };
    item.sources.push({
      kind: 'screen_prog_pointer_table',
      tableLabel: '_DATA_1CCC0_',
      tableIndex: entry.index,
      pointerOffset: entry.pointerOffset,
      targetOffset: entry.targetOffset,
      evidence: entry.evidence || [],
    });
    roots.set(entry.targetRegion.id, item);
  }
  return roots;
}

function parseHexMaybe(value) {
  if (!value) return null;
  return parseInt(value, 16);
}

function findContinuationSources(screenRegions, rootIds, decoderById) {
  const continuations = new Map();
  for (const rootId of rootIds) {
    const rootEntry = decoderById.get(rootId);
    const range = rootEntry?.visitedRange;
    const start = parseHexMaybe(range?.start);
    const end = parseHexMaybe(range?.endInclusive);
    if (start == null || end == null) continue;
    for (const region of screenRegions) {
      if (region.id === rootId) continue;
      const bounds = regionBounds(region);
      if (bounds.start < start || bounds.start > end) continue;
      const list = continuations.get(region.id) || [];
      list.push({
        rootRegion: rootEntry.region,
        rootCatalogEntryId: rootEntry.id,
        visitedRange: range,
        evidence: [
          `Decoded root ${rootEntry.region.offset} visits ${range.start}-${range.endInclusive}.`,
          `Region ${region.offset} starts inside that visited range, so it is reachable as an embedded/continued screen_prog fragment.`,
        ],
      });
      continuations.set(region.id, list);
    }
  }
  return continuations;
}

function buildCatalog(mapData, asmText) {
  const lines = asmText.split(/\r?\n/);
  const screenRegions = (mapData.regions || [])
    .filter(region => region.type === 'screen_prog')
    .sort((a, b) => parseInt(a.offset, 16) - parseInt(b.offset, 16));
  const decoderById = decoderEntryByRegion(mapData);
  const directCalls = scanDirectDecoderCalls(asmText, mapData);
  const roots = buildRootMap(mapData, directCalls);
  const continuations = findContinuationSources(screenRegions, roots.keys(), decoderById);
  const entries = screenRegions.map(region => {
    const root = roots.get(region.id);
    const continuation = continuations.get(region.id) || [];
    const decoder = decoderById.get(region.id) || null;
    let reachability = 'unexplained';
    let confidence = 'low';
    if (root) {
      reachability = 'root';
      confidence = 'high';
    } else if (continuation.length) {
      reachability = 'embedded_continuation';
      confidence = 'medium';
    }
    const unresolvedAnalysis = reachability === 'unexplained'
      ? classifyUnresolvedRegion(region, decoder ? {
        confidence: decoder.confidence,
        outsideRegionBytes: decoder.visitedRange?.outsideRegionBytes || 0,
      } : null, scanAsmReferences(lines, region))
      : null;
    return {
      id: `${region.id}_screen_reachability_${parseInt(region.offset, 16).toString(16).toUpperCase()}`,
      region: regionRef(region),
      reachability,
      confidence,
      rootSources: root?.sources || [],
      continuationSources: continuation,
      decoderSummary: decoder ? {
        confidence: decoder.confidence,
        terminated: decoder.terminated,
        endReason: decoder.endReason,
        ops: decoder.stats?.ops || 0,
        writtenCells: decoder.stats?.writtenCells || 0,
        outsideRegionBytes: decoder.visitedRange?.outsideRegionBytes || 0,
        warningCount: (decoder.warnings || []).length,
        visitedRange: decoder.visitedRange || null,
      } : null,
      unresolvedAnalysis,
      evidence: root
        ? root.sources.flatMap(source => source.evidence || [])
        : continuation.length
          ? continuation.flatMap(source => source.evidence || [])
          : unresolvedAnalysis?.evidence || [],
    };
  });
  const summary = entries.reduce((acc, entry) => {
    acc.regions++;
    acc.reachabilityCounts[entry.reachability] = (acc.reachabilityCounts[entry.reachability] || 0) + 1;
    acc.confidenceCounts[entry.confidence] = (acc.confidenceCounts[entry.confidence] || 0) + 1;
    return acc;
  }, {
    regions: 0,
    directDecoderCalls: directCalls.length,
    tableTargets: tableEntries(mapData).filter(entry => entry.targetRegion?.type === 'screen_prog').length,
    reachabilityCounts: {},
    confidenceCounts: {},
    assetPolicy: 'Metadata only: ASM line references, offsets, region ids, decoder summaries, and reachability classifications. No ROM bytes, tile ids, or rendered screen data are embedded.',
  });
  return {
    id: catalogId,
    schemaVersion: 2,
    generatedAt: now,
    tool: 'tools/world-screen-prog-reachability-audit.mjs',
    summary,
    decoder: {
      label: '_LABEL_604_',
      directCallModel: 'BC points at the screen/name-table bytecode source before call _LABEL_604_.',
      tableModel: '_LABEL_5EB_ indexes _DATA_1CCC0_, loads BC from the selected pointer, then calls _LABEL_604_.',
    },
    directCalls,
    entries,
  };
}

function annotateMap(mapData, catalog) {
  const annotated = [];
  for (const entry of catalog.entries) {
    const region = mapData.regions.find(item => item.id === entry.region.id);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.screenProgReachabilityAudit = {
      catalogId,
      kind: entry.reachability,
      confidence: entry.confidence,
      rootSources: entry.rootSources,
      continuationSources: entry.continuationSources.map(source => ({
        rootRegion: source.rootRegion,
        rootCatalogEntryId: source.rootCatalogEntryId,
        visitedRange: source.visitedRange,
      })),
      decoderSummary: entry.decoderSummary,
      unresolvedAnalysis: entry.unresolvedAnalysis,
      summary: entry.reachability === 'unexplained'
        ? `${entry.unresolvedAnalysis?.suspectedKind || 'unresolved_screen_prog_candidate'}: no confirmed runtime screen_prog consumer yet.`
        : `Screen_prog reachability classified as ${entry.reachability}.`,
      evidence: entry.evidence,
      generatedAt: now,
      tool: 'tools/world-screen-prog-reachability-audit.mjs',
    };
    annotated.push({
      id: region.id,
      offset: region.offset,
      type: region.type || 'unknown',
      reachability: entry.reachability,
      confidence: entry.confidence,
    });
  }
  return annotated;
}

function main() {
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData, asmText);
  const annotatedRegions = apply ? annotateMap(mapData, catalog) : catalog.entries.map(entry => ({
    id: entry.region.id,
    offset: entry.region.offset,
    type: entry.region.type,
    reachability: entry.reachability,
    confidence: entry.confidence,
  }));

  if (apply) {
    mapData.screenProgCatalogs = (mapData.screenProgCatalogs || []).filter(item => item.id !== catalogId);
    mapData.screenProgCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'screen_prog_reachability_audit',
      generatedAt: now,
      tool: 'tools/world-screen-prog-reachability-audit.mjs --apply',
      schemaVersion: 2,
      summary: catalog.summary,
      decoder: catalog.decoder,
      annotatedRegions,
      unexplainedRegions: catalog.entries
        .filter(entry => entry.reachability === 'unexplained')
        .map(entry => ({
          id: entry.region.id,
          offset: entry.region.offset,
          size: entry.region.size,
          name: entry.region.name || '',
          decoderSummary: entry.decoderSummary,
          unresolvedAnalysis: entry.unresolvedAnalysis,
        })),
      nextLeads: [
        'Inspect unexplained screen_prog regions with high outsideRegionBytes first; many are likely false positives inside code or data streams.',
        'Promote confirmed embedded continuations into explicit child/alias metadata instead of independent screen root claims.',
        'Trace additional indirect callers of _LABEL_604_ if any are found through register-pair propagation outside the current BC immediate model.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    directCalls: catalog.directCalls.map(call => ({
      callLine: call.callLine,
      sourceLine: call.sourceLine,
      callerLabel: call.callerLabel,
      sourceLabel: call.sourceLabel,
      sourceOffset: call.sourceOffset,
      region: call.region,
    })),
    reachabilityCounts: catalog.summary.reachabilityCounts,
    unexplainedRegions: catalog.entries
      .filter(entry => entry.reachability === 'unexplained')
      .slice(0, 80)
      .map(entry => ({
        id: entry.region.id,
        offset: entry.region.offset,
        size: entry.region.size,
        name: entry.region.name || '',
        decoderConfidence: entry.decoderSummary?.confidence || null,
        outsideRegionBytes: entry.decoderSummary?.outsideRegionBytes || 0,
        suspectedKind: entry.unresolvedAnalysis?.suspectedKind || null,
        unresolvedReasons: entry.unresolvedAnalysis?.reasons || [],
      })),
    annotatedRegions: annotatedRegions.slice(0, 80),
  }, null, 2));
}

main();
