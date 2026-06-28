#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-graphics-dynamic-source-trace-seed-audit.mjs';
const catalogId = 'world-graphics-dynamic-source-trace-seed-catalog-2026-06-26';
const reportId = 'graphics-dynamic-source-trace-seed-audit-2026-06-26';
const schemaVersion = 1;
const bankSize = 0x4000;
const tileSize = 32;

const sourceCatalogIds = {
  graphicsTraceQueue: 'world-graphics-source-trace-queue-catalog-2026-06-26',
  dynamicBank: 'world-dynamic-vdp-bank-variable-catalog-2026-06-26',
  dynamicUploadCaller: 'world-dynamic-vdp-upload-caller-catalog-2026-06-26',
  bankedUploaderCallsite: 'world-banked-vdp-uploader-callsite-catalog-2026-06-26',
  playerA48TileStream: 'world-player-a48-tile-stream-catalog-2026-06-26',
  playerA48GapCandidate: 'world-player-a48-gap-candidate-catalog-2026-06-26',
};

const uploaderTraceRoutes = [
  {
    id: 'record_derived_8fb_path',
    routineLabels: ['_LABEL_919_'],
    parserLabels: ['_LABEL_919_'],
    callerLabels: [],
    bankFormula: '_RAM_D0F3_ = sourceRecordHighByte >> 1; _LABEL_1023_ switches to _RAM_D0F3_.',
    traceStatus: 'static_loader_record_trace_required',
  },
  {
    id: 'record_derived_998_or_dynamic_decode_path',
    routineLabels: ['_LABEL_99B_', '_LABEL_9C3_', '_LABEL_A97_'],
    parserLabels: ['_LABEL_9C3_'],
    callerLabels: ['_LABEL_1BE0_', '_LABEL_29E6_'],
    bankFormula: '_LABEL_9C3_ sets _RAM_D0F3_ = sourceRecordHighByte >> 1; _LABEL_99B_ and _LABEL_A97_ switch through _LABEL_1023_.',
    traceStatus: 'caller_selector_and_record_trace_required',
  },
  {
    id: 'record_derived_a48_player_animation_path',
    routineLabels: ['_LABEL_A48_'],
    parserLabels: ['_LABEL_A48_'],
    callerLabels: ['_LABEL_13A6_'],
    bankFormula: '_LABEL_A48_ writes _RAM_FFFF_ directly from sourceRecordHighByte >> 1 and restores the saved _RAM_DFFF_ value.',
    traceStatus: 'player_command_or_variant_trace_required',
  },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(value, pad = 2) {
  if (!Number.isFinite(value)) return null;
  return `0x${Number(value).toString(16).toUpperCase().padStart(pad, '0')}`;
}

function parseHex(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseInt(value.replace(/^\$/, '0x'), 16);
  return NaN;
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

function sumBy(items, valueFn) {
  return (items || []).reduce((sum, item) => sum + valueFn(item), 0);
}

function uniqueSorted(items) {
  return [...new Set(items.filter(Boolean))].sort();
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
  if (!catalog) throw new Error(`Missing required catalog: ${id}`);
  return catalog;
}

function optionalCatalog(mapData, id) {
  return findCatalog(mapData, id);
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function findRamByAddress(mapData, address) {
  const normalized = String(address || '').toUpperCase().replace(/^0X/, '$');
  return (mapData.ram || []).find(entry => String(entry.address || '').toUpperCase() === normalized) || null;
}

function ramAddressFromSymbol(symbol) {
  const match = /^_RAM_([0-9A-F]{4})_$/i.exec(symbol || '');
  return match ? `$${match[1].toUpperCase()}` : null;
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

function recordWordChunks(startOffset, endExclusive) {
  const sourceBank = Math.floor(startOffset / bankSize);
  const bankStart = sourceBank * bankSize;
  const startBlock = Math.floor((startOffset - bankStart) / tileSize);
  const endBlockExclusive = Math.ceil((endExclusive - bankStart) / tileSize);
  const chunks = [];
  let block = startBlock;
  while (block < endBlockExclusive) {
    const highBit = block >> 8;
    const chunkEndBlock = Math.min(endBlockExclusive, (highBit + 1) << 8);
    const sourceRecordHighByte = (sourceBank << 1) | highBit;
    chunks.push({
      sourceBank: hex(sourceBank, 2),
      sourceRecordHighByte: hex(sourceRecordHighByte, 2),
      tileBlockStart: hex(block, 3),
      tileBlockEndExclusive: hex(chunkEndBlock, 3),
      sourceRecordWordStart: hex((sourceRecordHighByte << 8) | (block & 0xFF), 4),
      sourceRecordWordEndInclusive: hex((sourceRecordHighByte << 8) | ((chunkEndBlock - 1) & 0xFF), 4),
      tileBlockCount: chunkEndBlock - block,
    });
    block = chunkEndBlock;
  }
  return chunks;
}

function seedKind(entry) {
  if (entry.recommendedAction === 'trace_real_consumer_before_coverage') return 'candidate_payload_consumer_trace';
  if (entry.recommendedAction === 'trace_dynamic_bank_or_decompression_path') return 'record_derived_dynamic_bank_trace';
  return 'nondefault_trace_seed';
}

function candidateRoutesForSeed(seed) {
  if (seed.kind === 'candidate_payload_consumer_trace') {
    return uploaderTraceRoutes.filter(route => route.id !== 'record_derived_8fb_path');
  }
  return uploaderTraceRoutes;
}

function buildSeed(entry) {
  const start = parseHex(entry.range?.start);
  const endExclusive = parseHex(entry.range?.endExclusive);
  const chunks = recordWordChunks(start, endExclusive);
  const kind = seedKind(entry);
  const requiredBanks = uniqueSorted(chunks.map(chunk => chunk.sourceBank));
  return {
    id: `${entry.spanId}_dynamic_source_trace_seed`,
    spanId: entry.spanId,
    kind,
    region: entry.region,
    range: entry.range,
    tileCount: entry.tileCount || 0,
    nonblankTileCount: entry.nonblankTileCount || 0,
    recommendedAction: entry.recommendedAction,
    actionConfidence: entry.actionConfidence,
    sourceBank: requiredBanks[0] || entry.directSourceAddress?.bank || '',
    sourceRecordHighBytes: uniqueSorted(chunks.map(chunk => chunk.sourceRecordHighByte)),
    sourceRecordWordChunks: chunks,
    directSourceAddressEvidence: entry.directSourceAddress ? {
      bank: entry.directSourceAddress.bank || '',
      z80Range: entry.directSourceAddress.z80Range || null,
      classification: entry.directSourceAddress.classification || null,
      directAddressCounts: entry.directSourceAddress.directAddressCounts || {},
      uploaderStatus: entry.directSourceAddress.uploaderEvidence?.status || '',
    } : null,
    structuredFinalTriage: entry.structuredFinalTriage ? {
      finalDisposition: entry.structuredFinalTriage.finalDisposition || '',
      priority: entry.structuredFinalTriage.priority || '',
      nonKnownOccurrenceCount: entry.structuredFinalTriage.nonKnownOccurrenceCount || 0,
      sourceRegionCounts: entry.structuredFinalTriage.sourceRegionCounts || {},
    } : null,
    candidateRoutes: candidateRoutesForSeed({ kind }).map(route => route.id),
    traceQuestions: [
      `Which stream record or runtime producer emits sourceRecordHighByte ${uniqueSorted(chunks.map(chunk => chunk.sourceRecordHighByte)).join('/')} for this span?`,
      'Which caller selected the stream: player animation, item VRAM record, entity dynamic decode, or a room/static loader path?',
      'Does the runtime path write the expected mapper bank immediately before copying or decoding these tile blocks?',
    ],
    persistedRomByteCount: 0,
    persistedHashCount: 0,
    persistedPixelCount: 0,
    evidenceCatalogs: [
      sourceCatalogIds.graphicsTraceQueue,
      sourceCatalogIds.dynamicBank,
      sourceCatalogIds.dynamicUploadCaller,
      sourceCatalogIds.bankedUploaderCallsite,
    ],
  };
}

function buildBankGroups(seeds) {
  const groups = new Map();
  for (const seed of seeds) {
    const key = seed.sourceBank || 'unknown';
    if (!groups.has(key)) {
      groups.set(key, {
        sourceBank: key,
        seedCount: 0,
        spanCount: 0,
        regionCount: 0,
        tileCount: 0,
        nonblankTileCount: 0,
        sourceRecordHighBytes: new Set(),
        recommendedActionCounts: {},
        kindCounts: {},
        regions: new Set(),
        topSeeds: [],
      });
    }
    const group = groups.get(key);
    group.seedCount++;
    group.spanCount++;
    group.tileCount += seed.tileCount;
    group.nonblankTileCount += seed.nonblankTileCount;
    group.regions.add(seed.region?.id || '');
    for (const highByte of seed.sourceRecordHighBytes) group.sourceRecordHighBytes.add(highByte);
    group.recommendedActionCounts[seed.recommendedAction] = (group.recommendedActionCounts[seed.recommendedAction] || 0) + 1;
    group.kindCounts[seed.kind] = (group.kindCounts[seed.kind] || 0) + 1;
    group.topSeeds.push({
      seedId: seed.id,
      spanId: seed.spanId,
      region: seed.region,
      range: seed.range,
      nonblankTileCount: seed.nonblankTileCount,
      sourceRecordHighBytes: seed.sourceRecordHighBytes,
      recommendedAction: seed.recommendedAction,
    });
  }

  return [...groups.values()]
    .map(group => ({
      ...group,
      regionCount: [...group.regions].filter(Boolean).length,
      regions: [...group.regions].filter(Boolean).sort(),
      sourceRecordHighBytes: [...group.sourceRecordHighBytes].sort(),
      topSeeds: group.topSeeds
        .sort((a, b) => b.nonblankTileCount - a.nonblankTileCount || parseHex(a.range.start) - parseHex(b.range.start))
        .slice(0, 8),
    }))
    .sort((a, b) => b.nonblankTileCount - a.nonblankTileCount || parseHex(a.sourceBank) - parseHex(b.sourceBank));
}

function routeEntries(dynamicBankCatalog, dynamicUploadCallerCatalog) {
  const routinesByLabel = new Map((dynamicBankCatalog.uploadRoutines || []).map(routine => [routine.label, routine]));
  const callsitesByTarget = new Map();
  const callsitesByCaller = new Map();
  for (const callsite of dynamicUploadCallerCatalog.callsites || []) {
    if (!callsitesByTarget.has(callsite.target)) callsitesByTarget.set(callsite.target, []);
    callsitesByTarget.get(callsite.target).push(callsite);
    if (!callsitesByCaller.has(callsite.callerLabel)) callsitesByCaller.set(callsite.callerLabel, []);
    callsitesByCaller.get(callsite.callerLabel).push(callsite);
  }
  return uploaderTraceRoutes.map(route => {
    const routines = route.routineLabels.map(label => routinesByLabel.get(label)).filter(Boolean);
    const rawCallsites = [
      ...route.routineLabels.flatMap(label => callsitesByTarget.get(label) || []),
      ...route.callerLabels.flatMap(label => callsitesByCaller.get(label) || []),
    ];
    const callsites = [...new Map(rawCallsites.map(callsite => [
      `${callsite.callerLabel}:${callsite.target}:${callsite.line}`,
      callsite,
    ])).values()];
    return {
      ...route,
      routines: routines.map(routine => ({
        label: routine.label,
        region: routine.region,
        role: routine.role,
        eventCounts: routine.eventCounts || {},
        classificationCounts: routine.classificationCounts || {},
      })),
      callsites: callsites.map(callsite => ({
        callerLabel: callsite.callerLabel,
        callerRegion: callsite.callerRegion,
        target: callsite.target,
        line: callsite.line,
        classification: callsite.classification?.kind || '',
        selectorState: callsite.classification?.selectorState || [],
        bankContext: callsite.classification?.bankContext || '',
      })),
      selectorState: uniqueSorted(callsites.flatMap(callsite => callsite.classification?.selectorState || [])),
      confidence: routines.length || callsites.length ? 'high' : 'medium',
    };
  });
}

function collectRamSeeds(routes) {
  const symbols = new Set(['_RAM_D0F3_', '_RAM_DFFF_', '_RAM_FFFF_']);
  for (const route of routes) {
    for (const state of route.selectorState || []) {
      const address = ramAddressFromSymbol(state);
      if (address) symbols.add(state);
    }
  }
  return [...symbols].sort();
}

function buildCatalog(mapData) {
  const graphicsTraceQueue = requireCatalog(mapData, sourceCatalogIds.graphicsTraceQueue);
  const dynamicBank = requireCatalog(mapData, sourceCatalogIds.dynamicBank);
  const dynamicUploadCaller = requireCatalog(mapData, sourceCatalogIds.dynamicUploadCaller);
  const bankedUploaderCallsite = requireCatalog(mapData, sourceCatalogIds.bankedUploaderCallsite);
  optionalCatalog(mapData, sourceCatalogIds.playerA48TileStream);
  optionalCatalog(mapData, sourceCatalogIds.playerA48GapCandidate);

  const actionableQueue = (graphicsTraceQueue.queue || [])
    .filter(entry => entry.nonblankTileCount > 0)
    .filter(entry => entry.recommendedAction !== 'deprioritize_padding_or_shape');
  const seeds = actionableQueue.map(buildSeed)
    .sort((a, b) => b.nonblankTileCount - a.nonblankTileCount || parseHex(a.range.start) - parseHex(b.range.start));
  const bankGroups = buildBankGroups(seeds);
  const routes = routeEntries(dynamicBank, dynamicUploadCaller);
  const ramTraceSeeds = collectRamSeeds(routes);

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: Object.values(sourceCatalogIds),
    assetPolicy: 'Metadata only: span offsets, source-bank ids, source-record word ranges, labels, RAM symbols, line numbers, region ids, counts, and trace questions. No ROM bytes, hashes, decoded graphics, pixels, screenshots, rendered tiles, audio, text, or ASM instruction bytes are embedded.',
    summary: {
      actionableSeedCount: seeds.length,
      actionableRegionCount: new Set(seeds.map(seed => seed.region?.id).filter(Boolean)).size,
      actionableSourceBankCount: bankGroups.length,
      actionableTileCount: sumBy(seeds, seed => seed.tileCount),
      actionableNonblankTileCount: sumBy(seeds, seed => seed.nonblankTileCount),
      recommendedActionCounts: countBy(seeds, seed => seed.recommendedAction),
      seedKindCounts: countBy(seeds, seed => seed.kind),
      sourceBankSeedCounts: countBy(seeds, seed => seed.sourceBank),
      sourceBankNonblankTileCounts: Object.fromEntries(bankGroups.map(group => [group.sourceBank, group.nonblankTileCount])),
      routeCount: routes.length,
      ramTraceSeedCount: ramTraceSeeds.length,
      immediateBankUploaderContextSpanCount: (graphicsTraceQueue.queue || [])
        .filter(entry => entry.directSourceAddress?.uploaderEvidence?.status === 'immediate_bank_uploader_context_exists').length,
      confirmedCoverageContributorCount: 0,
      coverageChangedByThisAudit: false,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
    },
    bankGroups,
    routes,
    ramTraceSeeds: ramTraceSeeds.map(symbol => ({
      symbol,
      address: ramAddressFromSymbol(symbol),
      role: symbol === '_RAM_D0F3_' ? 'record_derived_source_bank_latch'
        : symbol === '_RAM_DFFF_' ? 'previous_bank_restore_context'
          : symbol === '_RAM_FFFF_' ? 'mapper_page2_bank_write'
            : 'dynamic_upload_caller_selector_state',
      confidence: ['_RAM_D0F3_', '_RAM_FFFF_'].includes(symbol) ? 'high' : 'medium_high',
    })),
    seeds,
    topSeeds: seeds.slice(0, 16),
    evidence: [
      `${sourceCatalogIds.graphicsTraceQueue} supplies the remaining nonblank graphics spans and proves they are not covered by current static/dynamic source catalogs.`,
      `${sourceCatalogIds.dynamicBank} proves the shared source-bank formula: sourceRecordHighByte >> 1 feeds _RAM_D0F3_ or direct _RAM_FFFF_ writes.`,
      `${sourceCatalogIds.dynamicUploadCaller} supplies the three caller contexts for _LABEL_A48_, _LABEL_99B_, and _LABEL_A97_.`,
      `${sourceCatalogIds.bankedUploaderCallsite} shows there is no immediate-bank uploader context for the remaining graphics spans; record-derived bank tracing is therefore required.`,
      'This catalog derives trace seeds only; it does not persist bytes or promote any graphics span to confirmed coverage.',
    ],
    nextLeads: [
      'Trace sourceRecordHighByte values 0x12/0x13, 0x16/0x17, 0x18/0x19, 0x1C/0x1D, and 0x1E/0x1F through _LABEL_919_, _LABEL_9C3_, and _LABEL_A48_.',
      'For bank 0x0B seeds, prioritize _LABEL_A48_ player command/variant selectors and _LABEL_A97_ entity dynamic decode selectors before promoting source coverage.',
      'For bank 0x09 and 0x0C seeds, trace _LABEL_9C3_ records from item/entity/static-loader callers and confirm the mapper bank immediately before tile upload.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  const regionDetails = new Map();
  for (const group of catalog.bankGroups) {
    for (const regionId of group.regions) {
      if (!regionDetails.has(regionId)) {
        regionDetails.set(regionId, {
          sourceBanks: new Set(),
          seedCount: 0,
          nonblankTileCount: 0,
          recommendedActionCounts: {},
        });
      }
      const detail = regionDetails.get(regionId);
      detail.sourceBanks.add(group.sourceBank);
    }
  }
  for (const seed of catalog.seeds) {
    const detail = regionDetails.get(seed.region?.id);
    if (!detail) continue;
    detail.seedCount++;
    detail.nonblankTileCount += seed.nonblankTileCount;
    detail.recommendedActionCounts[seed.recommendedAction] = (detail.recommendedActionCounts[seed.recommendedAction] || 0) + 1;
  }

  for (const [regionId, detail] of regionDetails) {
    const region = findRegionById(mapData, regionId);
    if (!region) {
      missingRegions.push({ id: regionId, role: 'dynamic_graphics_source_trace_seed_region' });
      continue;
    }
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.graphicsDynamicSourceTraceSeedAudit = {
        catalogId,
        role: 'dynamic_graphics_source_trace_seed_region',
        confidence: 'medium',
        summary: 'Graphics region has remaining nonblank source spans that require record-derived dynamic bank tracing.',
        detail: {
          sourceBanks: [...detail.sourceBanks].sort(),
          seedCount: detail.seedCount,
          nonblankTileCount: detail.nonblankTileCount,
          recommendedActionCounts: detail.recommendedActionCounts,
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
      sourceBanks: [...detail.sourceBanks].sort(),
      seedCount: detail.seedCount,
      nonblankTileCount: detail.nonblankTileCount,
    });
  }

  for (const route of catalog.routes) {
    for (const routine of route.routines || []) {
      const region = findRegionById(mapData, routine.region?.id);
      if (!region) continue;
      if (apply) {
        region.analysis = region.analysis || {};
        region.analysis.graphicsDynamicSourceTraceSeedAudit = {
          catalogId,
          role: 'dynamic_graphics_upload_routine',
          confidence: route.confidence,
          summary: 'Upload routine is a candidate trace path for remaining unconfirmed graphics source spans.',
          detail: {
            routeId: route.id,
            bankFormula: route.bankFormula,
            traceStatus: route.traceStatus,
            routineLabels: route.routineLabels,
            callerLabels: route.callerLabels,
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
        role: 'dynamic_graphics_upload_routine',
        routeId: route.id,
      });
    }
    for (const callsite of route.callsites || []) {
      const region = findRegionById(mapData, callsite.callerRegion?.id);
      if (!region) continue;
      if (apply) {
        region.analysis = region.analysis || {};
        region.analysis.graphicsDynamicSourceTraceSeedAudit = {
          catalogId,
          role: 'dynamic_graphics_upload_caller',
          confidence: route.confidence,
          summary: 'Caller selects state that may feed a dynamic graphics upload trace seed.',
          detail: {
            routeId: route.id,
            target: callsite.target,
            line: callsite.line,
            classification: callsite.classification,
            selectorState: callsite.selectorState,
            bankContext: callsite.bankContext,
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
        role: 'dynamic_graphics_upload_caller',
        routeId: route.id,
      });
    }
  }

  const changedRam = [];
  for (const seed of catalog.ramTraceSeeds) {
    const ramEntry = findRamByAddress(mapData, seed.address);
    if (!ramEntry) continue;
    if (apply) {
      ramEntry.analysis = ramEntry.analysis || {};
      ramEntry.analysis.graphicsDynamicSourceTraceSeedAudit = {
        catalogId,
        symbol: seed.symbol,
        role: seed.role,
        confidence: seed.confidence,
        summary: 'RAM value participates in tracing remaining dynamic graphics source paths.',
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRam.push({
      id: ramEntry.id,
      address: ramEntry.address,
      name: ramEntry.name || '',
      symbol: seed.symbol,
      role: seed.role,
      confidence: seed.confidence,
    });
  }

  return { changedRegions, missingRegions, changedRam };
}

function reportSample(catalog) {
  return {
    summary: catalog.summary,
    bankGroups: catalog.bankGroups.map(group => ({
      sourceBank: group.sourceBank,
      seedCount: group.seedCount,
      nonblankTileCount: group.nonblankTileCount,
      sourceRecordHighBytes: group.sourceRecordHighBytes,
      recommendedActionCounts: group.recommendedActionCounts,
    })),
    topSeeds: catalog.topSeeds.slice(0, 8).map(seed => ({
      spanId: seed.spanId,
      region: seed.region,
      range: seed.range,
      sourceBank: seed.sourceBank,
      sourceRecordHighBytes: seed.sourceRecordHighBytes,
      nonblankTileCount: seed.nonblankTileCount,
      recommendedAction: seed.recommendedAction,
    })),
  };
}

function applyCatalog(mapData, catalog, annotation) {
  mapData.graphicsCatalogs = (mapData.graphicsCatalogs || []).filter(item => item.id !== catalogId);
  mapData.graphicsCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'graphics_dynamic_source_trace_seed_audit',
    generatedAt: now,
    tool: `${toolName} --apply`,
    schemaVersion,
    catalogId,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: catalog.summary,
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
    changedRam: annotation.changedRam,
    sample: reportSample(catalog),
    assetPolicy: catalog.assetPolicy,
    nextLeads: catalog.nextLeads,
  });
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const annotation = annotateMap(mapData, catalog);
  if (apply) {
    applyCatalog(mapData, catalog, annotation);
    fs.writeFileSync(mapPath, `${JSON.stringify(mapData, null, 2)}\n`);
  }
  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    reportId,
    summary: catalog.summary,
    sample: reportSample(catalog),
    changedRegions: annotation.changedRegions,
    missingRegions: annotation.missingRegions,
    changedRam: annotation.changedRam,
  }, null, 2));
}

main();
