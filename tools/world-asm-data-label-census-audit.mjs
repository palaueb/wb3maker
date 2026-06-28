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
const catalogId = 'world-asm-data-label-census-catalog-2026-06-25';
const reportId = 'asm-data-label-census-audit-2026-06-25';
const toolName = 'tools/world-asm-data-label-census-audit.mjs';

const streamLikeTypes = new Set([
  'screen_prog',
  'vdp_stream',
  'music',
  'audio_driver_data',
  'vram_loader_8fb',
  'vram_loader_998',
  'entity_anim_script',
  'input_script',
  'palette_script',
  'effect_script',
]);

const assetLikeTypes = new Set([
  'gfx_tiles',
  'tile_map',
  'meta_sprite',
  'music',
  'vdp_stream',
  'input_script',
  'room_data',
  'entity_anim_script',
  'data_table',
  'screen_prog',
  'vram_loader_8fb',
  'audio_driver_data',
  'room_subrecord',
  'entity_data',
  'item_data',
  'pointer_table',
  'palette_script',
  'palette',
  'entity_behavior_table',
  'vram_loader_998',
  'entity_anim_table',
  'text',
  'effect_script',
  'screen_prog_table',
  'palette_script_table',
  'room_seq_table',
]);

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function cleanCode(line) {
  return line.split(';')[0].trim();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function labelOffset(label) {
  const match = /^_(?:LABEL|DATA)_([0-9A-F]+)_$/i.exec(label || '');
  return match ? parseInt(match[1], 16) : null;
}

function offsetOf(region) {
  return typeof region.offset === 'number' ? region.offset : parseInt(region.offset, 16);
}

function regionBounds(region) {
  const start = offsetOf(region);
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

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function addCount(counts, key, amount = 1) {
  counts[key] = (counts[key] || 0) + amount;
}

function directiveName(code) {
  const match = /^\s*\.(\w+)/.exec(code);
  return match ? `.${match[1].toLowerCase()}` : null;
}

function isLocalAsmLabel(code) {
  return /^[+-]+:$/.test(code) || /^[+-]+$/.test(code);
}

function referenceKind(code, targetLabel) {
  if (/^\.dw\b/i.test(code)) return 'dw';
  if (/^\.db\b/i.test(code)) return 'db';
  if (new RegExp(`\\bcall\\s+${targetLabel}\\b`, 'i').test(code)) return 'call';
  if (new RegExp(`\\bjp\\s+${targetLabel}\\b`, 'i').test(code)) return 'jp';
  if (new RegExp(`\\bjr\\s+${targetLabel}\\b`, 'i').test(code)) return 'jr';
  if (/\bld\b/i.test(code)) return 'ld';
  if (/\brst\b/i.test(code)) return 'rst';
  return 'ref';
}

function buildAsmCensus(asmText) {
  const lines = asmText.split(/\r?\n/);
  const blocks = [];
  const refsByLabel = new Map();
  let current = null;
  let currentScope = '';

  function pushCurrent(endLine, endOffsetExclusive) {
    if (!current) return;
    current.endLine = endLine;
    current.endOffsetExclusive = endOffsetExclusive;
    current.approxSize = endOffsetExclusive == null || current.offset == null
      ? null
      : Math.max(0, endOffsetExclusive - current.offset);
    current.directiveOnly = current.directiveLines > 0 && current.instructionLines === 0;
    current.mixedCodeAndData = current.directiveLines > 0 && current.instructionLines > 0;
    current.dwOnly = current.directiveLines > 0
      && (current.directiveCounts['.dw'] || 0) > 0
      && Object.entries(current.directiveCounts).every(([name, count]) => name === '.dw' || count === 0);
    current.outgoingLabels = uniqueBy(current.outgoingLabels, item => `${item.label}:${item.line}:${item.kind}`);
    blocks.push(current);
  }

  for (let i = 0; i < lines.length; i++) {
    const code = cleanCode(lines[i]);
    const labelMatch = /^(_(?:LABEL|DATA)_[0-9A-F]+_):/i.exec(code);
    if (labelMatch) {
      const nextOffset = labelOffset(labelMatch[1]);
      pushCurrent(i, nextOffset);
      currentScope = labelMatch[1];
      current = {
        label: labelMatch[1],
        labelKind: /^_DATA_/i.test(labelMatch[1]) ? 'data' : 'label',
        offset: nextOffset,
        asmLine: i + 1,
        endLine: i + 1,
        endOffsetExclusive: null,
        approxSize: null,
        directiveLines: 0,
        instructionLines: 0,
        blankOrCommentLines: 0,
        directiveCounts: {},
        outgoingLabels: [],
        directiveOnly: false,
        mixedCodeAndData: false,
        dwOnly: false,
      };
      continue;
    }

    if (current) {
      if (!code || isLocalAsmLabel(code)) {
        current.blankOrCommentLines++;
      } else {
        const directive = directiveName(code);
        if (directive) {
          current.directiveLines++;
          addCount(current.directiveCounts, directive);
          const labelRe = /_(?:LABEL|DATA)_[0-9A-F]+_/gi;
          let targetMatch;
          while ((targetMatch = labelRe.exec(code)) !== null) {
            current.outgoingLabels.push({
              line: i + 1,
              label: targetMatch[0],
              kind: directive === '.dw' ? 'dw_target' : 'directive_ref',
            });
          }
        } else {
          current.instructionLines++;
        }
      }
    }

    if (!code) continue;
    const refRe = /_(?:LABEL|DATA)_[0-9A-F]+_/gi;
    let refMatch;
    while ((refMatch = refRe.exec(code)) !== null) {
      const target = refMatch[0];
      if (target === currentScope && code.startsWith(`${target}:`)) continue;
      if (!refsByLabel.has(target)) refsByLabel.set(target, []);
      const refs = refsByLabel.get(target);
      if (refs.length < 64) {
        refs.push({
          line: i + 1,
          sourceLabel: currentScope,
          kind: referenceKind(code, target),
        });
      }
    }
  }

  pushCurrent(lines.length, null);
  return { blocks, refsByLabel };
}

function analysisKeysFor(region) {
  return Object.keys(region?.analysis || {}).sort();
}

function incomingRefSummary(refs) {
  const safeRefs = refs || [];
  return {
    count: safeRefs.length,
    kinds: countBy(safeRefs, ref => ref.kind),
    sourceLabels: uniqueBy(safeRefs.map(ref => ref.sourceLabel).filter(Boolean), value => value).slice(0, 24),
    sample: safeRefs.slice(0, 12),
  };
}

function compactBlock(mapData, block, refsByLabel) {
  const region = block.offset == null ? null : findContainingRegion(mapData, block.offset);
  const bounds = region ? regionBounds(region) : null;
  const refs = incomingRefSummary(refsByLabel.get(block.label) || []);
  const nestedInRegion = Boolean(region && block.offset !== bounds.start);
  const regionType = region?.type || 'unmapped';
  const falseDwOrSplitCandidate = block.directiveOnly && nestedInRegion && streamLikeTypes.has(regionType);
  const pointerTableCandidate = block.directiveOnly
    && block.dwOnly
    && !nestedInRegion
    && regionType !== 'pointer_table'
    && !streamLikeTypes.has(regionType)
    && block.outgoingLabels.length > 0;
  const directiveOnlyCodeRegion = block.directiveOnly && regionType === 'code';
  const analysisKeys = analysisKeysFor(region);
  const uncatalogedAssetRegion = block.directiveOnly
    && assetLikeTypes.has(regionType)
    && analysisKeys.length === 0;

  return {
    label: block.label,
    labelKind: block.labelKind,
    offset: block.offset == null ? null : hex(block.offset),
    bank: block.offset == null ? null : Math.floor(block.offset / 0x4000),
    asmLine: block.asmLine,
    lineRange: { start: block.asmLine, end: block.endLine },
    approxSize: block.approxSize,
    directiveLines: block.directiveLines,
    instructionLines: block.instructionLines,
    directiveCounts: block.directiveCounts,
    directiveOnly: block.directiveOnly,
    mixedCodeAndData: block.mixedCodeAndData,
    dwOnly: block.dwOnly,
    outgoingLabels: block.outgoingLabels.slice(0, 24),
    outgoingLabelCount: block.outgoingLabels.length,
    incomingRefs: refs,
    region: regionRef(region),
    nestedInRegion,
    exactRegionStart: Boolean(region && block.offset === bounds.start),
    regionAnalysisKeys: analysisKeys,
    flags: {
      falseDwOrSplitCandidate,
      pointerTableCandidate,
      directiveOnlyCodeRegion,
      uncatalogedAssetRegion,
    },
    evidence: [
      `ASM line ${block.asmLine}: ${block.label} block starts at ${block.offset == null ? 'unknown offset' : hex(block.offset)}.`,
      region
        ? `Current map region ${region.id} covers this label as type ${regionType}.`
        : 'No current map region covers this label offset.',
      block.directiveOnly
        ? 'Block contains assembler directives and no decoded instructions.'
        : block.mixedCodeAndData
          ? 'Block contains both decoded instructions and assembler directives.'
          : 'Block contains decoded instructions only.',
    ],
  };
}

function buildCatalog(mapData, asmText) {
  const census = buildAsmCensus(asmText);
  const labelBlocks = census.blocks.map(block => compactBlock(mapData, block, census.refsByLabel));
  const dataBlocks = labelBlocks.filter(block => block.directiveLines > 0);
  const directiveOnlyBlocks = dataBlocks.filter(block => block.directiveOnly);
  const mixedBlocks = dataBlocks.filter(block => block.mixedCodeAndData);
  const nestedBlocks = dataBlocks.filter(block => block.nestedInRegion);
  const falseDwOrSplitCandidates = dataBlocks.filter(block => block.flags.falseDwOrSplitCandidate);
  const pointerTableCandidates = dataBlocks.filter(block => block.flags.pointerTableCandidate);
  const directiveOnlyCodeRegions = dataBlocks.filter(block => block.flags.directiveOnlyCodeRegion);
  const uncatalogedAssetRegions = dataBlocks.filter(block => block.flags.uncatalogedAssetRegion);
  const unmappedBlocks = dataBlocks.filter(block => !block.region);

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    summary: {
      totalAsmLabelBlocks: labelBlocks.length,
      dataDirectiveBlocks: dataBlocks.length,
      directiveOnlyBlocks: directiveOnlyBlocks.length,
      mixedCodeAndDataBlocks: mixedBlocks.length,
      nestedDataBlocks: nestedBlocks.length,
      falseDwOrSplitCandidates: falseDwOrSplitCandidates.length,
      pointerTableCandidates: pointerTableCandidates.length,
      directiveOnlyCodeRegions: directiveOnlyCodeRegions.length,
      uncatalogedAssetRegions: uncatalogedAssetRegions.length,
      unmappedDataBlocks: unmappedBlocks.length,
      dataBlocksByRegionType: countBy(dataBlocks, block => block.region?.type || 'unmapped'),
      dataBlocksByBank: countBy(dataBlocks, block => block.bank == null ? 'unknown' : `bank_${String(block.bank).padStart(2, '0')}`),
      assetPolicy: 'Metadata only: ASM labels, offsets, directive counts, line numbers, current map region types, and reference summaries. No ROM bytes, decoded graphics, music, text, or asset payloads are embedded.',
    },
    labelBlocks: dataBlocks,
    leads: {
      largestDataDirectiveBlocks: [...dataBlocks]
        .filter(block => block.approxSize != null)
        .sort((a, b) => b.approxSize - a.approxSize)
        .slice(0, 40)
        .map(compactLead),
      falseDwOrSplitCandidates: falseDwOrSplitCandidates.slice(0, 80).map(compactLead),
      pointerTableCandidates: pointerTableCandidates.slice(0, 80).map(compactLead),
      directiveOnlyCodeRegions: directiveOnlyCodeRegions.slice(0, 80).map(compactLead),
      uncatalogedAssetRegions: uncatalogedAssetRegions.slice(0, 80).map(compactLead),
      unmappedDataBlocks: unmappedBlocks.slice(0, 80).map(compactLead),
    },
    validationIssues: unmappedBlocks.map(block => `No mapped region covers ASM data block ${block.label} at ${block.offset}.`),
    evidence: [
      'The ASM was scanned label-by-label and only directive counts, offsets, labels, and reference summaries were retained.',
      'Nested directive labels inside stream-like regions are flagged as likely disassembler split/false .dw candidates and are not retyped.',
      'Pointer-table candidates are leads only; no region type is changed without a confirmed dispatcher or pointer consumer.',
    ],
  };
}

function compactLead(block) {
  return {
    label: block.label,
    offset: block.offset,
    approxSize: block.approxSize,
    directiveCounts: block.directiveCounts,
    region: block.region,
    nestedInRegion: block.nestedInRegion,
    incomingRefCount: block.incomingRefs.count,
    outgoingLabelCount: block.outgoingLabelCount,
    flags: block.flags,
  };
}

function compactRegionLabel(block) {
  return {
    label: block.label,
    offset: block.offset,
    asmLine: block.asmLine,
    approxSize: block.approxSize,
    directiveCounts: block.directiveCounts,
    directiveOnly: block.directiveOnly,
    mixedCodeAndData: block.mixedCodeAndData,
    nestedInRegion: block.nestedInRegion,
    incomingRefCount: block.incomingRefs.count,
    outgoingLabelCount: block.outgoingLabelCount,
    flags: block.flags,
  };
}

function annotateMap(mapData, catalog) {
  const blocksByRegionId = new Map();
  for (const block of catalog.labelBlocks) {
    if (!block.region) continue;
    if (!blocksByRegionId.has(block.region.id)) blocksByRegionId.set(block.region.id, []);
    blocksByRegionId.get(block.region.id).push(block);
  }

  const annotatedRegions = [];
  for (const [regionId, blocks] of blocksByRegionId.entries()) {
    const region = (mapData.regions || []).find(item => item.id === regionId);
    if (!region) continue;
    const directiveCounts = {};
    for (const block of blocks) {
      for (const [directive, count] of Object.entries(block.directiveCounts)) addCount(directiveCounts, directive, count);
    }
    region.analysis = region.analysis || {};
    region.analysis.asmDataLabelCensusAudit = {
      catalogId,
      kind: 'asm_data_label_census_region',
      confidence: 'high',
      summary: 'ASM data-label census for labels and directive blocks covered by this mapped region.',
      labelCount: blocks.length,
      directiveOnlyLabelCount: blocks.filter(block => block.directiveOnly).length,
      mixedCodeAndDataLabelCount: blocks.filter(block => block.mixedCodeAndData).length,
      nestedLabelCount: blocks.filter(block => block.nestedInRegion).length,
      falseDwOrSplitCandidateCount: blocks.filter(block => block.flags.falseDwOrSplitCandidate).length,
      pointerTableCandidateCount: blocks.filter(block => block.flags.pointerTableCandidate).length,
      directiveCounts,
      labels: blocks.slice(0, 64).map(compactRegionLabel),
      truncatedLabelCount: Math.max(0, blocks.length - 64),
      evidence: [
        `${blocks.length} ASM data-directive label(s) fall inside this mapped region.`,
        'The census stores labels, offsets, directive counts, and reference counts only.',
      ],
      generatedAt: now,
      tool: toolName,
    };
    annotatedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type || 'unknown',
      name: region.name || '',
      labelCount: blocks.length,
      nestedLabelCount: blocks.filter(block => block.nestedInRegion).length,
      falseDwOrSplitCandidateCount: blocks.filter(block => block.flags.falseDwOrSplitCandidate).length,
      pointerTableCandidateCount: blocks.filter(block => block.flags.pointerTableCandidate).length,
    });
  }
  return annotatedRegions;
}

function main() {
  const mapData = readJson(mapPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const catalog = buildCatalog(mapData, asmText);
  const annotatedRegions = apply ? annotateMap(mapData, catalog) : [];

  if (apply) {
    mapData.asmDataLabelCatalogs = (mapData.asmDataLabelCatalogs || []).filter(item => item.id !== catalogId);
    mapData.asmDataLabelCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'asm_data_label_census_audit',
      generatedAt: now,
      schemaVersion: 1,
      tool: `${toolName} --apply`,
      summary: {
        ...catalog.summary,
        annotatedRegions: annotatedRegions.length,
      },
      validationIssues: catalog.validationIssues,
      annotatedRegions,
      leads: catalog.leads,
      nextLeads: [
        'Review pointerTableCandidates with their consumer routines before retyping; directive-only .dw blocks are not enough evidence by themselves.',
        'Use falseDwOrSplitCandidates to avoid treating disassembler-created labels inside screen/audio/loader streams as standalone pointer tables.',
        'Prioritize the largest data directive blocks by current map type when adding format-specific decoders for remaining asset families.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      annotatedRegions: annotatedRegions.length,
    },
    validationIssues: catalog.validationIssues,
    leadPreview: {
      largestDataDirectiveBlocks: catalog.leads.largestDataDirectiveBlocks.slice(0, 8),
      falseDwOrSplitCandidates: catalog.leads.falseDwOrSplitCandidates.slice(0, 8),
      pointerTableCandidates: catalog.leads.pointerTableCandidates.slice(0, 8),
      directiveOnlyCodeRegions: catalog.leads.directiveOnlyCodeRegions.slice(0, 8),
      unmappedDataBlocks: catalog.leads.unmappedDataBlocks.slice(0, 8),
    },
  }, null, 2));
}

main();
