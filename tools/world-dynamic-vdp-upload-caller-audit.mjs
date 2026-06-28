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
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-dynamic-vdp-upload-caller-audit.mjs';
const catalogId = 'world-dynamic-vdp-upload-caller-catalog-2026-06-26';
const reportId = 'dynamic-vdp-upload-caller-audit-2026-06-26';
const schemaVersion = 1;

const dynamicBankCatalogId = 'world-dynamic-vdp-bank-variable-catalog-2026-06-26';
const targets = new Set(['_LABEL_A48_', '_LABEL_99B_', '_LABEL_A97_']);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(value, pad = 5) {
  if (!Number.isFinite(value)) return null;
  return `0x${Number(value).toString(16).toUpperCase().padStart(pad, '0')}`;
}

function parseHex(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseInt(value.replace(/^\$/, '0x'), 16);
  return NaN;
}

function regionStart(region) {
  return parseHex(region.offset);
}

function regionEnd(region) {
  return regionStart(region) + Number(region.size || 0);
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

function containingRegion(mapData, offset) {
  if (!Number.isFinite(offset)) return null;
  return (mapData.regions || [])
    .filter(region => offset >= regionStart(region) && offset < regionEnd(region))
    .sort((a, b) => Number(a.size || 0) - Number(b.size || 0)
      || String(a.id).localeCompare(String(b.id)))[0] || null;
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === id);
    if (found) return found;
  }
  return null;
}

function labelOffset(label) {
  const match = /^_(?:LABEL|DATA)_([0-9A-F]+)_$/i.exec(label || '');
  return match ? parseInt(match[1], 16) : null;
}

function stripComment(line) {
  return String(line || '').split(';')[0].trim();
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items || []) {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function parseAsm(asmText, mapData) {
  const lines = asmText.split(/\r?\n/);
  const lineContext = [];
  let current = null;
  for (const [index, line] of lines.entries()) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*):\s*$/.exec(line);
    if (match) {
      const offset = labelOffset(match[1]);
      current = {
        label: match[1],
        offset,
        line: index + 1,
        region: compactRegion(containingRegion(mapData, offset)),
      };
    }
    lineContext[index] = current;
  }
  return { lines, lineContext };
}

function classifyCallsite(target, context) {
  const label = context?.label || '';
  if (target === '_LABEL_A48_' && label === '_LABEL_13A6_') {
    return {
      kind: 'player_animation_stream_tile_upload_call',
      confidence: 'high',
      callerRole: 'player_animation_script_decoder',
      uploadRoutineRole: 'animation_tile_stream_direct_mapper_bank_switch',
      selectorState: ['_RAM_C250_', '_RAM_C252_', '_RAM_C24C_', '_RAM_C27F_', '_RAM_CFE3_'],
      sourceContext: 'The caller decodes player animation script records, updates the animation stream pointer, and calls _LABEL_A48_ to upload animation tiles.',
      bankContext: '_LABEL_A48_ derives the source bank directly from each stream record high byte and restores the previous bank from _RAM_DFFF_.',
      evidenceLines: [3794, 3795, 3818, 3821, 3837, 3838],
    };
  }
  if (target === '_LABEL_99B_' && label === '_LABEL_1BE0_') {
    return {
      kind: 'item_vram_record_loader_call',
      confidence: 'high',
      callerRole: 'item_vram_record_loader_by_id',
      uploadRoutineRole: 'vram_loader_998_wrapper_uses_D0F3',
      selectorState: ['A item id', '_RAM_D02A_ destination'],
      sourceContext: 'The caller bounds item id A below 0x48, switches to bank 4, chooses inline or bank-4 table records, sets DE from _RAM_D02A_, then jumps into _LABEL_99B_.',
      bankContext: '_LABEL_99B_ and _LABEL_9C3_ use _RAM_D0F3_; _LABEL_9C3_ derives it from the high source-record byte.',
      evidenceLines: [4965, 4969, 4974, 4986, 4993, 4998, 4999],
    };
  }
  if (target === '_LABEL_A97_' && label === '_LABEL_29E6_') {
    return {
      kind: 'entity_dynamic_tile_decode_upload_call',
      confidence: 'high',
      callerRole: 'entity_dynamic_tile_upload_caller',
      uploadRoutineRole: 'dynamic_tile_decode_upload_uses_D0F3',
      selectorState: ['_RAM_D0E0_', '_RAM_D0E1_', '_RAM_D0E2_', '_RAM_D0EC_', '_RAM_D0ED_'],
      sourceContext: 'The caller switches to bank 7 for entity frame data, derives _RAM_D0EC_ from high pointer bits, converts _RAM_D0E1_ through _LABEL_B8F_, and calls _LABEL_A97_.',
      bankContext: '_LABEL_A97_ reuses the _LABEL_9C3_ source-record parser and switches to _RAM_D0F3_ before decoding rows to VDP.',
      evidenceLines: [6904, 6905, 6909, 6920, 6921, 6924, 6925, 6926, 6935],
    };
  }
  return {
    kind: 'unclassified_dynamic_upload_call',
    confidence: 'low',
    callerRole: label || 'unknown',
    uploadRoutineRole: target,
    selectorState: [],
    sourceContext: 'No caller classification rule matched this dynamic upload callsite.',
    bankContext: '',
    evidenceLines: [],
  };
}

function collectCallsites(lines, lineContext) {
  const callsites = [];
  for (const [index, line] of lines.entries()) {
    const code = stripComment(line);
    const match = /^(call|jp)\s+(_[A-Za-z0-9_]+_)$/i.exec(code);
    if (!match || !targets.has(match[2])) continue;
    const context = lineContext[index] || null;
    const classification = classifyCallsite(match[2], context);
    callsites.push({
      line: index + 1,
      instructionKind: match[1].toLowerCase(),
      target: match[2],
      callerLabel: context?.label || '',
      callerOffset: hex(context?.offset),
      callerRegion: context?.region || null,
      classification,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
    });
  }
  return callsites;
}

function buildRegionSummaries(callsites) {
  const byRegion = new Map();
  for (const item of callsites) {
    if (!item.callerRegion?.id) continue;
    if (!byRegion.has(item.callerRegion.id)) {
      byRegion.set(item.callerRegion.id, {
        region: item.callerRegion,
        callsiteCount: 0,
        targetCounts: {},
        classificationCounts: {},
        selectorState: new Set(),
        callsites: [],
      });
    }
    const group = byRegion.get(item.callerRegion.id);
    group.callsiteCount++;
    group.targetCounts[item.target] = (group.targetCounts[item.target] || 0) + 1;
    group.classificationCounts[item.classification.kind] = (group.classificationCounts[item.classification.kind] || 0) + 1;
    for (const state of item.classification.selectorState || []) group.selectorState.add(state);
    group.callsites.push({
      line: item.line,
      instructionKind: item.instructionKind,
      target: item.target,
      classification: item.classification.kind,
      confidence: item.classification.confidence,
      evidenceLines: item.classification.evidenceLines,
    });
  }
  return [...byRegion.values()]
    .map(group => ({
      ...group,
      selectorState: [...group.selectorState].sort(),
    }))
    .sort((a, b) => parseHex(a.region.offset) - parseHex(b.region.offset));
}

function buildCatalog(mapData, asmText) {
  const { lines, lineContext } = parseAsm(asmText, mapData);
  const dynamicBankCatalog = findCatalog(mapData, dynamicBankCatalogId);
  const callsites = collectCallsites(lines, lineContext);
  const regions = buildRegionSummaries(callsites);
  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [dynamicBankCatalogId],
    summary: {
      dynamicBankCatalogPresent: Boolean(dynamicBankCatalog),
      callsiteCount: callsites.length,
      callerRegionCount: regions.length,
      targetCounts: countBy(callsites, item => item.target),
      classificationCounts: countBy(callsites, item => item.classification.kind),
      confidenceCounts: countBy(callsites, item => item.classification.confidence),
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
      assetPolicy: 'Metadata only: labels, offsets, line numbers, call targets, RAM selector names, roles, and evidence line numbers. No ROM bytes, decoded graphics, screenshots, audio, or ASM instruction payloads are embedded.',
    },
    callsites,
    regions,
    evidence: [
      'The ASM has exactly three direct call/jump sites into the dynamic tile upload routines _LABEL_A48_, _LABEL_99B_, and _LABEL_A97_.',
      `${dynamicBankCatalogId} supplies the source-bank formula and bank restore semantics used by these callees.`,
      'Caller contexts are classified from labels, call targets, nearby RAM selector roles, and line-number evidence only.',
      'No ROM bytes, decoded assets, screenshots, audio, or ASM instruction payloads are stored.',
    ],
    nextLeads: [
      'Resolve the player animation stream tables feeding _LABEL_13A6_ to connect _LABEL_A48_ tile uploads to player/form graphics coverage.',
      'Resolve _LABEL_1BE0_ item-id selector records and _DATA_13C00_/_DATA_13C0A_ bank-4 tables to link item graphics uploads.',
      'Trace the entity frame data feeding _LABEL_29E6_ to connect _LABEL_A97_ dynamic decode uploads to enemy/entity graphics banks.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const changedRegions = [];
  for (const group of catalog.regions) {
    const region = findRegionById(mapData, group.region.id);
    if (!region) continue;
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.dynamicVdpUploadCallerAudit = {
        catalogId,
        kind: 'dynamic_vdp_upload_caller',
        confidence: 'high',
        summary: 'Caller context for a dynamic tile upload routine.',
        detail: {
          callsiteCount: group.callsiteCount,
          targetCounts: group.targetCounts,
          classificationCounts: group.classificationCounts,
          selectorState: group.selectorState,
          callsites: group.callsites,
        },
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type,
      name: region.name || '',
      callsiteCount: group.callsiteCount,
      targetCounts: group.targetCounts,
      classificationCounts: group.classificationCounts,
    });
  }
  return { changedRegions };
}

function main() {
  const mapData = readJson(mapPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const catalog = buildCatalog(mapData, asmText);
  const annotation = annotateMap(mapData, catalog);

  if (apply) {
    mapData.vdpRenderRoutineCatalogs = (mapData.vdpRenderRoutineCatalogs || []).filter(item => item.id !== catalogId);
    mapData.vdpRenderRoutineCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'dynamic_vdp_upload_caller_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: {
        ...catalog.summary,
        changedRegionCount: annotation.changedRegions.length,
      },
      changedRegions: annotation.changedRegions,
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      changedRegionCount: annotation.changedRegions.length,
    },
    changedRegions: annotation.changedRegions,
  }, null, 2));
}

main();
