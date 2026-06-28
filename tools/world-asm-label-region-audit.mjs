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
const catalogId = 'world-asm-label-region-catalog-2026-06-25';
const reportId = 'asm-label-region-audit-2026-06-25';
const toolName = 'tools/world-asm-label-region-audit.mjs';
const BANK_SIZE = 0x4000;

const assetLikeTypes = new Set([
  'audio_driver_data',
  'data_table',
  'dynamic_tile_loader',
  'effect_script',
  'entity_anim_script',
  'entity_anim_table',
  'entity_behavior_table',
  'entity_data',
  'gfx_tiles',
  'input_script',
  'item_data',
  'meta_sprite',
  'music',
  'palette',
  'palette_script',
  'palette_script_table',
  'pointer_table',
  'room_data',
  'room_seq_table',
  'room_subrecord',
  'screen_prog',
  'screen_prog_table',
  'text',
  'tile_map',
  'vdp_stream',
  'vram_loader_8fb',
  'vram_loader_998',
]);

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function cleanCode(line) {
  return String(line || '').split(';')[0].trim();
}

function parseHex(value) {
  if (typeof value === 'number') return value;
  const match = /^0x([0-9A-F]+)$/i.exec(String(value || ''));
  return match ? parseInt(match[1], 16) : null;
}

function labelOffset(label) {
  const match = /^_(?:LABEL|DATA)_([0-9A-F]+)_$/i.exec(label || '');
  return match ? parseInt(match[1], 16) : null;
}

function ramAddress(label) {
  const match = /^_RAM_([0-9A-F]+)_$/i.exec(label || '');
  return match ? parseInt(match[1], 16) : null;
}

function offsetOf(region) {
  return parseHex(region.offset) ?? 0;
}

function regionBounds(region) {
  const start = offsetOf(region);
  return { start, end: start + Number(region.size || 0) };
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

function findBestRegion(mapData, offset) {
  const candidates = (mapData.regions || []).filter(region => {
    const bounds = regionBounds(region);
    return offset >= bounds.start && offset < bounds.end;
  });
  candidates.sort((a, b) => {
    const ab = regionBounds(a);
    const bb = regionBounds(b);
    const aExact = ab.start === offset ? 0 : 1;
    const bExact = bb.start === offset ? 0 : 1;
    return aExact - bExact || (a.size || 0) - (b.size || 0) || ab.start - bb.start;
  });
  return candidates[0] || null;
}

function addCount(counts, key, amount = 1) {
  if (key === '' || key == null) return;
  counts[key] = (counts[key] || 0) + amount;
}

function sortedCounts(counts) {
  return Object.fromEntries(Object.entries(counts).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items || []) addCount(counts, keyFn(item));
  return sortedCounts(counts);
}

function directiveName(code) {
  const match = /^\.(\w+)/.exec(code);
  return match ? `.${match[1].toLowerCase()}` : '';
}

function isGlobalRomLabel(code) {
  return /^_(?:LABEL|DATA)_[0-9A-F]+_:/i.test(code);
}

function isRamLabel(code) {
  return /^_RAM_[0-9A-F]+_\s+(?:db|dw|dsb)\b/i.test(code);
}

function isLocalLabel(code) {
  return /^[+-]+:?$/.test(code);
}

function blockStats(lines, startLine) {
  const directiveCounts = {};
  let directiveLineCount = 0;
  let instructionLineCount = 0;
  let localLabelCount = 0;
  for (let lineIndex = startLine; lineIndex < lines.length; lineIndex++) {
    const code = cleanCode(lines[lineIndex]);
    if (!code) continue;
    if (/^\.BANK\b/i.test(code) || isGlobalRomLabel(code)) break;
    if (isRamLabel(code)) break;
    if (isLocalLabel(code)) {
      localLabelCount++;
      continue;
    }
    const directive = directiveName(code);
    if (directive) {
      addCount(directiveCounts, directive);
      directiveLineCount++;
    } else {
      instructionLineCount++;
    }
  }
  let blockStyle = 'empty';
  if (directiveCounts['.incbin']) blockStyle = 'incbin_blob';
  else if (directiveLineCount && instructionLineCount) blockStyle = 'mixed_code_and_directives';
  else if (directiveLineCount) blockStyle = 'data_directives';
  else if (instructionLineCount) blockStyle = 'code_instructions';
  return {
    blockStyle,
    directiveCounts: sortedCounts(directiveCounts),
    directiveLineCount,
    instructionLineCount,
    localLabelCount,
  };
}

function classifyLabel(label, region, stats) {
  const labelKind = /^_DATA_/i.test(label) ? 'data_label' : 'code_label';
  const regionType = region?.type || 'unmapped';
  const nestedInRegion = region ? offsetOf(region) !== labelOffset(label) : false;
  const inAssetRegion = assetLikeTypes.has(regionType);
  let status = 'mapped';
  if (!region) status = 'unmapped_rom_label';
  else if (labelKind === 'data_label' && regionType === 'code') status = 'data_label_in_code_region';
  else if (labelKind === 'code_label' && inAssetRegion) status = 'code_label_in_asset_region';
  else if (stats.blockStyle === 'mixed_code_and_directives') status = 'mixed_code_and_data_label';
  else if (stats.blockStyle === 'incbin_blob') status = 'incbin_asset_blob_label';
  return {
    labelKind,
    nestedInRegion,
    inAssetRegion,
    status,
  };
}

function compactLabel(label) {
  return {
    label: label.label,
    offset: label.offset,
    bank: label.bank,
    line: label.line,
    labelKind: label.labelKind,
    blockStyle: label.blockStyle,
    status: label.status,
    regionId: label.region?.id || '',
    regionType: label.region?.type || 'unmapped',
    nestedInRegion: Boolean(label.nestedInRegion),
  };
}

function scanAsmLabels(mapData, asmText) {
  const lines = asmText.split(/\r?\n/);
  const romLabels = [];
  const ramLabels = [];
  let currentBank = null;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const code = cleanCode(lines[lineIndex]);
    const bankMatch = /^\.BANK\s+([0-9]+)/i.exec(code);
    if (bankMatch) currentBank = Number(bankMatch[1]);

    const ramMatch = /^(_RAM_[0-9A-F]+_)\s+(db|dw|dsb)\b/i.exec(code);
    if (ramMatch) {
      ramLabels.push({
        label: ramMatch[1],
        address: hex(ramAddress(ramMatch[1]) ?? 0, 4),
        line: lineIndex + 1,
        storage: ramMatch[2].toLowerCase(),
      });
      continue;
    }

    const labelMatch = /^(_(?:LABEL|DATA)_([0-9A-F]+)_):$/i.exec(code);
    if (!labelMatch) continue;
    const offset = parseInt(labelMatch[2], 16);
    const region = findBestRegion(mapData, offset);
    const stats = blockStats(lines, lineIndex + 1);
    const classification = classifyLabel(labelMatch[1], region, stats);
    romLabels.push({
      label: labelMatch[1],
      offset: hex(offset),
      bank: hex(Math.floor(offset / BANK_SIZE), 2),
      bankOffset: hex(offset % BANK_SIZE, 4),
      asmBank: currentBank == null ? null : hex(currentBank, 2),
      line: lineIndex + 1,
      labelKind: classification.labelKind,
      blockStyle: stats.blockStyle,
      directiveCounts: stats.directiveCounts,
      directiveLineCount: stats.directiveLineCount,
      instructionLineCount: stats.instructionLineCount,
      localLabelCount: stats.localLabelCount,
      region: compactRegion(region),
      nestedInRegion: classification.nestedInRegion,
      status: classification.status,
    });
  }
  return { romLabels, ramLabels };
}

function buildRegionSummaries(labels) {
  const byRegion = new Map();
  for (const label of labels) {
    if (!label.region?.id) continue;
    if (!byRegion.has(label.region.id)) {
      byRegion.set(label.region.id, {
        region: label.region,
        labelCount: 0,
        labelKindCounts: {},
        blockStyleCounts: {},
        statusCounts: {},
        nestedLabelCount: 0,
        labels: [],
      });
    }
    const item = byRegion.get(label.region.id);
    item.labelCount++;
    addCount(item.labelKindCounts, label.labelKind);
    addCount(item.blockStyleCounts, label.blockStyle);
    addCount(item.statusCounts, label.status);
    if (label.nestedInRegion) item.nestedLabelCount++;
    item.labels.push(compactLabel(label));
  }
  return [...byRegion.values()]
    .map(item => ({
      ...item,
      labelKindCounts: sortedCounts(item.labelKindCounts),
      blockStyleCounts: sortedCounts(item.blockStyleCounts),
      statusCounts: sortedCounts(item.statusCounts),
      labels: item.labels.slice(0, 64),
      truncatedLabelCount: Math.max(0, item.labelCount - 64),
    }))
    .sort((a, b) => parseHex(a.region.offset) - parseHex(b.region.offset) || a.region.id.localeCompare(b.region.id));
}

function buildLeads(romLabels, regionSummaries) {
  const byOffset = (a, b) => parseHex(a.offset) - parseHex(b.offset);
  return {
    unmappedRomLabels: romLabels.filter(label => label.status === 'unmapped_rom_label').sort(byOffset).map(compactLabel),
    dataLabelsInCodeRegions: romLabels.filter(label => label.status === 'data_label_in_code_region').sort(byOffset).slice(0, 80).map(compactLabel),
    codeLabelsInAssetRegions: romLabels.filter(label => label.status === 'code_label_in_asset_region').sort(byOffset).slice(0, 80).map(compactLabel),
    mixedCodeAndDataLabels: romLabels.filter(label => label.status === 'mixed_code_and_data_label').sort(byOffset).slice(0, 80).map(compactLabel),
    incbinAssetBlobLabels: romLabels.filter(label => label.status === 'incbin_asset_blob_label').sort(byOffset).map(compactLabel),
    densestRegions: regionSummaries
      .slice()
      .sort((a, b) => b.labelCount - a.labelCount || parseHex(a.region.offset) - parseHex(b.region.offset))
      .slice(0, 24)
      .map(item => ({
        region: item.region,
        labelCount: item.labelCount,
        labelKindCounts: item.labelKindCounts,
        blockStyleCounts: item.blockStyleCounts,
        statusCounts: item.statusCounts,
      })),
  };
}

function buildCatalog(mapData, asmText) {
  const { romLabels, ramLabels } = scanAsmLabels(mapData, asmText);
  const regionSummaries = buildRegionSummaries(romLabels);
  const leads = buildLeads(romLabels, regionSummaries);
  const validationIssues = [];
  if (leads.unmappedRomLabels.length) {
    validationIssues.push({
      severity: 'warning',
      kind: 'rom_label_without_region',
      count: leads.unmappedRomLabels.length,
      summary: 'One or more ROM labels from the ASM did not resolve to a mapped region.',
    });
  }
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceFiles: [
      'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).asm',
      'projects/WORLD/map.json',
    ],
    summary: {
      romLabelCount: romLabels.length,
      ramLabelCount: ramLabels.length,
      mappedRomLabelCount: romLabels.filter(label => label.region).length,
      unmappedRomLabelCount: leads.unmappedRomLabels.length,
      regionWithLabelCount: regionSummaries.length,
      dataLabelInCodeRegionCount: romLabels.filter(label => label.status === 'data_label_in_code_region').length,
      codeLabelInAssetRegionCount: romLabels.filter(label => label.status === 'code_label_in_asset_region').length,
      mixedCodeAndDataLabelCount: romLabels.filter(label => label.status === 'mixed_code_and_data_label').length,
      incbinAssetBlobLabelCount: romLabels.filter(label => label.status === 'incbin_asset_blob_label').length,
      byBank: countBy(romLabels, label => label.bank),
      byRegionType: countBy(romLabels, label => label.region?.type || 'unmapped'),
      byLabelKind: countBy(romLabels, label => label.labelKind),
      byBlockStyle: countBy(romLabels, label => label.blockStyle),
      byStatus: countBy(romLabels, label => label.status),
      assetPolicy: 'Metadata only: ASM labels, offsets, banks, line numbers, directive counts, region ids/types, and aggregate counts. No ROM bytes, decoded assets, text payloads, graphics, music, samples, coordinates, or gameplay values are embedded.',
    },
    romLabels: romLabels.map(compactLabel),
    ramLabels,
    regionSummaries,
    leads,
    validationIssues,
    evidence: [
      'The audit scans the complete WORLD ASM label set and joins ROM labels to current map regions by ROM offset.',
      'Block style is inferred from directive and instruction line counts following each label until the next label or bank directive.',
      'The catalog records metadata only and does not read or persist ROM bytes or decoded asset payloads.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const annotatedRegions = [];
  for (const summary of catalog.regionSummaries) {
    const region = (mapData.regions || []).find(item => item.id === summary.region.id);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.asmLabelRegionAudit = {
      catalogId,
      kind: 'asm_label_region_coverage',
      confidence: 'high',
      summary: 'Whole-ASM label coverage for this mapped region.',
      labelCount: summary.labelCount,
      nestedLabelCount: summary.nestedLabelCount,
      labelKindCounts: summary.labelKindCounts,
      blockStyleCounts: summary.blockStyleCounts,
      statusCounts: summary.statusCounts,
      labels: summary.labels.slice(0, 32),
      truncatedLabelCount: Math.max(0, summary.labelCount - 32),
      evidence: [
        `${summary.labelCount} ASM ROM label(s) resolve inside this region by offset.`,
        'Only label names, offsets, line numbers, block styles, and aggregate counts are stored.',
      ],
      generatedAt: now,
      tool: toolName,
    };
    annotatedRegions.push({
      region: summary.region,
      labelCount: summary.labelCount,
      nestedLabelCount: summary.nestedLabelCount,
      statusCounts: summary.statusCounts,
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
    mapData.asmLabelCatalogs = (mapData.asmLabelCatalogs || []).filter(item => item.id !== catalogId);
    mapData.asmLabelCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'asm_label_region_audit',
      generatedAt: now,
      schemaVersion: 1,
      tool: `${toolName} --apply`,
      summary: {
        ...catalog.summary,
        annotatedRegions: annotatedRegions.length,
      },
      validationIssues: catalog.validationIssues,
      annotatedRegions: annotatedRegions.slice(0, 256),
      truncatedAnnotatedRegionCount: Math.max(0, annotatedRegions.length - 256),
      leads: catalog.leads,
      nextLeads: [
        'Review data labels still inside code regions and either confirm embedded lookup data or split them with routine evidence.',
        'Review code labels inside asset-like regions before promoting them; these are often disassembler aliases or stream entry labels.',
        'Use the densest region list to prioritize format-specific parsers for remaining high-label asset blobs.',
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
      unmappedRomLabels: catalog.leads.unmappedRomLabels.slice(0, 8),
      dataLabelsInCodeRegions: catalog.leads.dataLabelsInCodeRegions.slice(0, 8),
      codeLabelsInAssetRegions: catalog.leads.codeLabelsInAssetRegions.slice(0, 8),
      mixedCodeAndDataLabels: catalog.leads.mixedCodeAndDataLabels.slice(0, 8),
      incbinAssetBlobLabels: catalog.leads.incbinAssetBlobLabels.slice(0, 8),
      densestRegions: catalog.leads.densestRegions.slice(0, 8),
    },
  }, null, 2));
}

main();
