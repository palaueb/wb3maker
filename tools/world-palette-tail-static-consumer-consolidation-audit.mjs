#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-palette-tail-static-consumer-consolidation-audit.mjs';
const catalogId = 'world-palette-tail-static-consumer-consolidation-catalog-2026-06-26';
const reportId = 'palette-tail-static-consumer-consolidation-audit-2026-06-26';
const sourceCatalogs = [
  'world-palette-tail-nonpalette-consumer-catalog-2026-06-26',
  'world-palette-tail-screenprog-wordshape-catalog-2026-06-26',
  'world-palette-tail-loader-wordshape-catalog-2026-06-26',
  'world-palette-cf65-entry25-evaluator-catalog-2026-06-26',
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item?.id === id);
    if (found) return found;
  }
  return null;
}

function requireCatalog(mapData, id) {
  const catalog = findCatalog(mapData, id);
  if (!catalog) throw new Error(`Missing required catalog ${id}`);
  return catalog;
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

function buildCatalog(mapData) {
  const nonpalette = requireCatalog(mapData, 'world-palette-tail-nonpalette-consumer-catalog-2026-06-26');
  const screen = requireCatalog(mapData, 'world-palette-tail-screenprog-wordshape-catalog-2026-06-26');
  const loader = requireCatalog(mapData, 'world-palette-tail-loader-wordshape-catalog-2026-06-26');
  requireCatalog(mapData, 'world-palette-cf65-entry25-evaluator-catalog-2026-06-26');

  const screenByTarget = new Map();
  for (const item of screen.classifications || []) {
    const list = screenByTarget.get(item.targetRegionId) || [];
    list.push(item);
    screenByTarget.set(item.targetRegionId, list);
  }
  const loaderByTarget = new Map();
  for (const item of loader.classifications || []) {
    const list = loaderByTarget.get(item.targetRegionId) || [];
    list.push(item);
    loaderByTarget.set(item.targetRegionId, list);
  }

  const perRegion = (nonpalette.perRegion || []).map(entry => {
    const regionId = entry.region?.id;
    const screenItems = screenByTarget.get(regionId) || [];
    const loaderItems = loaderByTarget.get(regionId) || [];
    const alignedPointerCandidates = entry.sameBankAlignedNonPalettePointerCandidateCount || 0;
    const exactAsmRefs = entry.exactAsmReferenceCount || 0;
    const unresolvedDecoderLeads = screenItems.filter(item => item.pointerDisposition !== 'screen_prog_bytecode_or_payload_not_rom_pointer').length +
      loaderItems.filter(item => item.pointerDisposition === 'unresolved_requires_manual_trace').length;
    const unresolvedNonDecoderWordShapes = (entry.sameBankNonPointerWordShapeCount || 0) +
      (entry.sameBankUnalignedPointerTableWordShapeCount || 0);
    const confirmedStaticConsumerCount = alignedPointerCandidates + exactAsmRefs;
    const status = confirmedStaticConsumerCount > 0
      ? 'static_consumer_leads_require_trace'
      : unresolvedDecoderLeads > 0
        ? 'decoder_context_partially_unresolved'
        : 'no_confirmed_static_nonpalette_consumer_after_decoder_context';
    return {
      region: entry.region,
      status,
      exactAsmReferenceCount: exactAsmRefs,
      sameBankAlignedNonPalettePointerCandidateCount: alignedPointerCandidates,
      screenProgLeadsExcluded: screenItems.filter(item => item.pointerDisposition === 'screen_prog_bytecode_or_payload_not_rom_pointer').length,
      loaderLeadsExcluded: loaderItems.filter(item => item.pointerDisposition !== 'unresolved_requires_manual_trace').length,
      unresolvedDecoderLeads,
      unresolvedNonDecoderWordShapes,
      evidenceStatus: {
        paletteParser: 'entry_25_state_loop_blocks_tail_fallthrough',
        screenProg: screenItems.length ? 'screen_prog_word_shapes_excluded_as_bytecode_payload' : 'no_screen_prog_leads',
        loader: loaderItems.length ? 'loader_word_shapes_excluded_as_control_or_source_encoding' : 'no_loader_leads',
      },
    };
  });

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs,
    assetPolicy: 'Metadata only: region ids, offsets, counts, statuses, and catalog cross-references. No ROM bytes, tile ids, decoded graphics, rendered pixels, palette values, audio, hashes, instruction bytes, or register traces are embedded.',
    summary: {
      regionCount: perRegion.length,
      statusCounts: countBy(perRegion, item => item.status),
      exactAsmReferenceCount: perRegion.reduce((sum, item) => sum + item.exactAsmReferenceCount, 0),
      alignedPointerCandidateCount: perRegion.reduce((sum, item) => sum + item.sameBankAlignedNonPalettePointerCandidateCount, 0),
      screenProgLeadsExcluded: perRegion.reduce((sum, item) => sum + item.screenProgLeadsExcluded, 0),
      loaderLeadsExcluded: perRegion.reduce((sum, item) => sum + item.loaderLeadsExcluded, 0),
      unresolvedDecoderLeads: perRegion.reduce((sum, item) => sum + item.unresolvedDecoderLeads, 0),
      unresolvedNonDecoderWordShapes: perRegion.reduce((sum, item) => sum + item.unresolvedNonDecoderWordShapes, 0),
      status: perRegion.every(item => item.status === 'no_confirmed_static_nonpalette_consumer_after_decoder_context')
        ? 'palette_tail_static_consumers_unconfirmed_after_context'
        : 'palette_tail_static_consumers_need_more_trace',
      persistedRomByteCount: 0,
      persistedTileIdCount: 0,
      persistedPaletteByteCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
      persistedRegisterTraceCount: 0,
    },
    perRegion,
    evidence: [
      'The _RAM_CF65_ entry-25 evaluator proves _LABEL_10BC_ does not fall through from _DATA_1CABB_ into r2815-r2817.',
      'The non-palette consumer scan found no exact split-tail ASM references and zero aligned same-bank non-palette pointer candidates.',
      'The screen_prog follow-up decoded four r2817 word-shaped leads as adjacent _LABEL_604_ direct tile payload bytes.',
      'The loader follow-up decoded two r2817 word-shaped leads as _LABEL_9C3_ loader control/boundary context.',
    ],
    nextLeads: [
      'Keep r2815-r2817 quarantined until a runtime trace or new static consumer directly addresses the split ranges.',
      'Move the residual proof queue to r2813/_RAM_CF64_ and r0749/_DATA_1E337_.',
      'Use this consolidation as the stopping point for palette-tail static pointer scans; further promotion requires behavioral/runtime evidence.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  const annotated = [];
  for (const entry of catalog.perRegion) {
    const region = findRegion(mapData, entry.region?.id);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.paletteTailStaticConsumerConsolidationAudit = {
      catalogId,
      kind: 'palette_tail_static_consumer_consolidation',
      status: entry.status,
      confidence: entry.status === 'no_confirmed_static_nonpalette_consumer_after_decoder_context'
        ? 'high_for_static_absence_low_for_semantic_role'
        : 'low',
      exactAsmReferenceCount: entry.exactAsmReferenceCount,
      sameBankAlignedNonPalettePointerCandidateCount: entry.sameBankAlignedNonPalettePointerCandidateCount,
      screenProgLeadsExcluded: entry.screenProgLeadsExcluded,
      loaderLeadsExcluded: entry.loaderLeadsExcluded,
      unresolvedDecoderLeads: entry.unresolvedDecoderLeads,
      unresolvedNonDecoderWordShapes: entry.unresolvedNonDecoderWordShapes,
      evidenceStatus: entry.evidenceStatus,
      summary: 'After palette-parser, same-bank pointer, screen_prog, and loader-context checks, no confirmed static non-palette consumer is known for this palette-tail split.',
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    if (region.analysis.lowConfidenceResidualTriageAudit) {
      region.analysis.lowConfidenceResidualTriageAudit.latestStaticConsumerConsolidationAudit = catalogId;
      region.analysis.lowConfidenceResidualTriageAudit.latestStaticConsumerConsolidationStatus = entry.status;
    }
    annotated.push({
      id: region.id,
      offset: region.offset,
      status: entry.status,
      screenProgLeadsExcluded: entry.screenProgLeadsExcluded,
      loaderLeadsExcluded: entry.loaderLeadsExcluded,
    });
  }
  return annotated;
}

function updateStaticMap(catalog) {
  if (!fs.existsSync(staticMapPath)) return;
  const staticMap = readJson(staticMapPath);
  staticMap.analyzedAt = now;
  staticMap.summary = staticMap.summary || {};
  staticMap.summary.paletteTailStaticConsumerConsolidationCatalog = catalogId;
  staticMap.summary.paletteTailStaticConsumerConsolidationStatus = catalog.summary.status;
  staticMap.summary.paletteTailStaticConsumerConsolidationRegions = catalog.summary.regionCount;
  staticMap.summary.paletteTailStaticConsumerConsolidationScreenProgExcluded = catalog.summary.screenProgLeadsExcluded;
  staticMap.summary.paletteTailStaticConsumerConsolidationLoaderExcluded = catalog.summary.loaderLeadsExcluded;
  staticMap.summary.paletteTailStaticConsumerConsolidationUnresolvedDecoderLeads = catalog.summary.unresolvedDecoderLeads;
  staticMap.primaryCatalogs = staticMap.primaryCatalogs || {};
  staticMap.primaryCatalogs.rendering = insertAfter(
    staticMap.primaryCatalogs.rendering,
    'world-palette-tail-loader-wordshape-catalog-2026-06-26',
    catalogId
  );
  staticMap.nextLeads = (staticMap.nextLeads || []).filter(note => !note.includes(catalogId));
  staticMap.nextLeads.push('Use world-palette-tail-static-consumer-consolidation-catalog-2026-06-26 as the current static disposition for r2815-r2817; further promotion requires runtime/behavioral proof.');
  writeJson(staticMapPath, staticMap);
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const annotated = apply ? applyCatalog(mapData, catalog) : [];

  if (apply) {
    mapData.paletteCatalogs = (mapData.paletteCatalogs || []).filter(item => item.id !== catalogId);
    mapData.paletteCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'palette_tail_static_consumer_consolidation_audit',
      schemaVersion: 1,
      generatedAt: now,
      tool: `${toolName} --apply`,
      catalogId,
      sourceCatalogs,
      summary: {
        ...catalog.summary,
        annotatedRegions: annotated.length,
      },
      perRegion: catalog.perRegion,
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
      annotatedRegions: annotated,
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
      annotatedRegions: annotated.length,
    },
    perRegion: catalog.perRegion,
  }, null, 2));
}

main();
