#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const asmPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).asm');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const staticMapPath = path.join(repoRoot, 'data/rom-maps/world.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-room-overlay-tail-static-bound-proof-audit.mjs';
const catalogId = 'world-room-overlay-tail-static-bound-proof-catalog-2026-06-26';
const reportId = 'room-overlay-tail-static-bound-proof-audit-2026-06-26';

const sourceCatalogs = [
  'world-room-overlay-record-catalog-2026-06-25',
  'world-room-overlay-tail-refinement-catalog-2026-06-25',
  'world-room-overlay-index-bound-catalog-2026-06-25',
  'world-runtime-ram-trace-seed-catalog-2026-06-26',
  'world-residual-proof-consumer-catalog-2026-06-26',
  'world-low-confidence-residual-triage-catalog-2026-06-26',
  'world-room-event-table-catalog-2026-06-26',
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

function findRam(mapData, address) {
  return (mapData.ram || []).find(entry => String(entry.address || '').toUpperCase() === address.toUpperCase()) || null;
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

function compactRam(entry) {
  if (!entry) return null;
  return {
    id: entry.id,
    address: entry.address,
    size: entry.size || 0,
    type: entry.type || '',
    name: entry.name || '',
  };
}

function stripComment(line) {
  return line.split(';')[0].trim();
}

function asmLines(asmText) {
  return asmText.split(/\r?\n/).map((text, index) => ({
    line: index + 1,
    text,
    code: stripComment(text),
  }));
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function labelDefinitionRefs(lines, label) {
  const colon = new RegExp(`^${escapeRegExp(label)}\\s*:`);
  const ramStyle = new RegExp(`^${escapeRegExp(label)}\\s+(db|dw|dsb|rb|rw|equ|=)\\b`, 'i');
  return lines
    .filter(item => colon.test(item.code) || ramStyle.test(item.code))
    .map(item => ({ line: item.line, kind: 'definition' }));
}

function labelReferenceRefs(lines, label) {
  const token = new RegExp(`(^|[^A-Za-z0-9_])${escapeRegExp(label)}([^A-Za-z0-9_]|$)`);
  const colon = new RegExp(`^${escapeRegExp(label)}\\s*:`);
  const ramStyle = new RegExp(`^${escapeRegExp(label)}\\s+(db|dw|dsb|rb|rw|equ|=)\\b`, 'i');
  return lines
    .filter(item => (
      item.code &&
      token.test(item.code) &&
      !colon.test(item.code) &&
      !ramStyle.test(item.code) &&
      !/^\.incbin\b/i.test(item.code)
    ))
    .map(item => ({
      line: item.line,
      kind: classifyRef(item.code, label),
      code: item.code,
    }));
}

function classifyRef(code, label) {
  const escaped = escapeRegExp(label);
  if (new RegExp(`^ld\\s+a,\\s*\\(${escaped}\\)$`, 'i').test(code)) return 'direct_ram_read';
  if (new RegExp(`^ld\\s*\\(${escaped}\\),`, 'i').test(code)) return 'direct_ram_write';
  if (/^call\s+/i.test(code)) return 'callsite';
  if (/^ld\s+hl,/i.test(code)) return 'hl_load';
  if (/^ld\s+/i.test(code)) return 'load_or_store';
  if (/^\.dw\b/i.test(code)) return 'word_record_or_pointer_table';
  return 'other_ref';
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

function callsiteRefs(lines, label) {
  const call = new RegExp(`^call\\s+${escapeRegExp(label)}\\b`, 'i');
  return lines
    .filter(item => call.test(item.code))
    .map(item => ({ line: item.line, kind: 'callsite' }));
}

function insertAfter(list, afterId, newId) {
  const out = (list || []).filter(id => id !== newId);
  const index = out.indexOf(afterId);
  if (index === -1) out.push(newId);
  else out.splice(index + 1, 0, newId);
  return out;
}

function compactSourceGroup(group) {
  return {
    name: group.name,
    source: group.source,
    sourceCount: group.sourceCount,
    validSourceCount: group.validSourceCount,
    minObservedIndex: group.minObservedIndex,
    maxObservedIndex: group.maxObservedIndex,
    uniqueIndexCount: group.uniqueIndexCount,
    tailIndexRefCount: group.tailIndexRefCount,
    outOfBoundsIndexCount: group.outOfBoundsIndexCount,
  };
}

function catalogEntryForRegion(catalog, regionId) {
  return (catalog.entries || []).find(entry => entry.region?.id === regionId) || null;
}

function seedForLabel(catalog, label) {
  return (catalog.seeds || []).find(seed => seed.label === label) || null;
}

function buildCatalog(mapData, asmText) {
  const recordCatalog = requireCatalog(mapData, 'world-room-overlay-record-catalog-2026-06-25');
  const tailCatalog = requireCatalog(mapData, 'world-room-overlay-tail-refinement-catalog-2026-06-25');
  const indexCatalog = requireCatalog(mapData, 'world-room-overlay-index-bound-catalog-2026-06-25');
  const runtimeSeedCatalog = requireCatalog(mapData, 'world-runtime-ram-trace-seed-catalog-2026-06-26');
  const residualCatalog = requireCatalog(mapData, 'world-residual-proof-consumer-catalog-2026-06-26');
  requireCatalog(mapData, 'world-low-confidence-residual-triage-catalog-2026-06-26');
  requireCatalog(mapData, 'world-room-event-table-catalog-2026-06-26');

  const lines = asmLines(asmText);
  const overlayRegion = findRegion(mapData, 'r0339');
  const tailRegion = findRegion(mapData, 'r2813');
  const nextRegion = findRegion(mapData, 'r0340');
  const cf64 = findRam(mapData, '$CF64');
  const cf64Definitions = labelDefinitionRefs(lines, '_RAM_CF64_');
  const cf64Refs = labelReferenceRefs(lines, '_RAM_CF64_');
  const label11f4Definitions = labelDefinitionRefs(lines, '_LABEL_11F4_');
  const label26f4Definitions = labelDefinitionRefs(lines, '_LABEL_26F4_');
  const label26f4Callsites = callsiteRefs(lines, '_LABEL_26F4_');
  const residualEntry = catalogEntryForRegion(residualCatalog, 'r2813');
  const runtimeSeed = seedForLabel(runtimeSeedCatalog, '_RAM_CF64_');

  const indexSummary = indexCatalog.summary || {};
  const tailSummary = tailCatalog.summary || {};
  const recordSummary = recordCatalog.summary || {};
  const cf64RefKindCounts = countBy(cf64Refs, ref => ref.kind);
  const directReadCount = cf64RefKindCounts.direct_ram_read || 0;
  const directWriteCount = cf64RefKindCounts.direct_ram_write || 0;
  const groupSummaries = (indexCatalog.cf64Sources?.groups || []).map(compactSourceGroup);
  const staticSourcesExcludeTail = (
    indexSummary.status === 'cataloged_cf64_sources_do_not_select_overlay_tail' &&
    indexSummary.combinedTailIndexRefCount === 0 &&
    indexSummary.combinedOutOfBoundsIndexCount === 0 &&
    directWriteCount === 0 &&
    tailSummary.directTargetAsmRefCount === 0 &&
    residualEntry?.proofStatus === 'static_cf64_read_known_runtime_source_value_unproven'
  );
  const status = staticSourcesExcludeTail
    ? 'cataloged_static_sources_exclude_overlay_tail_runtime_trace_required'
    : 'room_overlay_tail_static_bound_needs_review';

  const evidence = [
    `The room overlay record catalog consumes ${recordSummary.recordCount} complete ${recordSummary.recordStride}-byte records from ${recordSummary.sourceOffset} through 0x10717, leaving r2813 as a two-byte tail before r0340.`,
    `_LABEL_11F4_ reads _RAM_CF64_ and indexes _DATA_10000_ by ${indexSummary.overlayRecordStride || 8}-byte records; the first index that would reach r2813 is ${indexSummary.tailSelectingIndex}.`,
    `_LABEL_26F4_ copies eight bytes from the selected room-loader source into _RAM_CF5E_.._RAM_CF65_; _RAM_CF64_ is source byte +${indexSummary.cf64SourceByteOffset}.`,
    `Across ${indexSummary.combinedSourceCount} cataloged source offsets, byte +${indexSummary.cf64SourceByteOffset} ranges from ${indexSummary.combinedMinObservedIndex} to ${indexSummary.combinedMaxObservedIndex}, with zero index-${indexSummary.tailSelectingIndex} hits and zero out-of-table hits.`,
    `ASM static scan found ${directWriteCount} direct _RAM_CF64_ write(s), ${directReadCount} direct read(s), and ${tailSummary.directTargetAsmRefCount} direct bank-4 tail ASM reference(s).`,
    'The runtime trace seed catalog already marks _RAM_CF64_ as the required residual proof seed, so r2813 remains quarantined until runtime source values are observed.',
  ];

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs,
    assetPolicy: 'Metadata only: offsets, region ids, record counts, scalar index bounds, label names, ASM line numbers/reference kinds, catalog ids, and evidence. No ROM bytes, decoded graphics, tile values, rendered pixels, palette values, audio, hashes, instruction bytes, or register traces are embedded.',
    summary: {
      status,
      confidence: staticSourcesExcludeTail ? 'high_for_cataloged_sources_medium_for_global_runtime' : 'low',
      overlayTableRegionId: 'r0339',
      overlayTableOffset: recordSummary.sourceOffset,
      overlayTableEndInclusive: indexSummary.overlayTableEndInclusive,
      overlayRecordStride: indexSummary.overlayRecordStride,
      overlayRecordCount: indexSummary.overlayRecordCount,
      tailRegionId: 'r2813',
      tailOffset: indexSummary.tailOffset,
      tailEndInclusive: indexSummary.tailEndInclusive,
      tailSelectingIndex: indexSummary.tailSelectingIndex,
      cf64SourceByteOffset: indexSummary.cf64SourceByteOffset,
      catalogedSourceCount: indexSummary.combinedSourceCount,
      observedIndexMin: indexSummary.combinedMinObservedIndex,
      observedIndexMax: indexSummary.combinedMaxObservedIndex,
      observedUniqueIndexCount: indexSummary.combinedUniqueIndexCount,
      tailIndexRefCount: indexSummary.combinedTailIndexRefCount,
      outOfBoundsIndexCount: indexSummary.combinedOutOfBoundsIndexCount,
      directTailAsmRefCount: tailSummary.directTargetAsmRefCount,
      bankAliasAsmRefCount: tailSummary.bank6AliasAsmRefCount,
      rawZ80WordHitCount: tailSummary.rawZ80WordHitCount,
      cf64DefinitionCount: cf64Definitions.length,
      cf64DirectReadCount: directReadCount,
      cf64DirectWriteCount: directWriteCount,
      cf64ReferenceCount: cf64Refs.length,
      label11f4DefinitionCount: label11f4Definitions.length,
      label26f4DefinitionCount: label26f4Definitions.length,
      label26f4CallsiteCount: label26f4Callsites.length,
      runtimeTraceSeedPresent: Boolean(runtimeSeed),
      promotionAllowed: false,
      runtimeTraceRequired: true,
      defaultDecoderExcluded: true,
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedTileValueCount: 0,
      persistedPaletteByteCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
      persistedRegisterTraceCount: 0,
    },
    regions: {
      overlayTable: compactRegion(overlayRegion),
      tail: compactRegion(tailRegion),
      nextPointerTable: compactRegion(nextRegion),
    },
    ram: {
      cf64: compactRam(cf64),
      definitions: cf64Definitions,
      references: cf64Refs,
      referenceKindCounts: cf64RefKindCounts,
    },
    routines: {
      label11f4Definitions,
      label26f4Definitions,
      label26f4Callsites,
    },
    sourceClosure: {
      groups: groupSummaries,
      sourceCatalogId: indexCatalog.id,
      summary: {
        catalogedSourceCount: indexSummary.combinedSourceCount,
        observedIndexMin: indexSummary.combinedMinObservedIndex,
        observedIndexMax: indexSummary.combinedMaxObservedIndex,
        observedUniqueIndexCount: indexSummary.combinedUniqueIndexCount,
        tailIndexRefCount: indexSummary.combinedTailIndexRefCount,
        outOfBoundsIndexCount: indexSummary.combinedOutOfBoundsIndexCount,
      },
    },
    residualDisposition: {
      proofStatus: residualEntry?.proofStatus || null,
      disposition: residualEntry?.disposition || null,
      promotionAllowed: false,
      runtimeTraceRequired: true,
      defaultDecoderExcluded: true,
      runtimeSeedCatalogId: runtimeSeedCatalog.id,
      runtimeSeedLabel: runtimeSeed?.label || null,
      runtimeSeedRole: runtimeSeed?.traceRole || runtimeSeed?.kind || null,
    },
    evidence,
    nextLeads: [
      'Keep r2813 excluded from the room-overlay record decoder unless a runtime trace shows _RAM_CF64_ selecting index 227.',
      'Instrument _LABEL_26F4_ and _LABEL_11F4_ so the source record and copied byte +6 can be logged per room transition without storing ROM payload bytes.',
      'After runtime traces are available, either promote r2813 to a proven tail role or keep it as a quarantined nonpadding trailer with runtime non-selection evidence.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  const annotated = [];
  const overlayRegion = findRegion(mapData, 'r0339');
  const tailRegion = findRegion(mapData, 'r2813');
  const cf64 = findRam(mapData, '$CF64');
  const shared = {
    catalogId,
    status: catalog.summary.status,
    confidence: catalog.summary.confidence,
    tailSelectingIndex: catalog.summary.tailSelectingIndex,
    catalogedSourceCount: catalog.summary.catalogedSourceCount,
    observedIndexRange: {
      min: catalog.summary.observedIndexMin,
      max: catalog.summary.observedIndexMax,
    },
    tailIndexRefCount: catalog.summary.tailIndexRefCount,
    outOfBoundsIndexCount: catalog.summary.outOfBoundsIndexCount,
    cf64DirectWriteCount: catalog.summary.cf64DirectWriteCount,
    runtimeTraceRequired: catalog.summary.runtimeTraceRequired,
    promotionAllowed: catalog.summary.promotionAllowed,
    defaultDecoderExcluded: catalog.summary.defaultDecoderExcluded,
    evidence: catalog.evidence,
    generatedAt: now,
    tool: toolName,
  };

  if (tailRegion) {
    tailRegion.analysis = tailRegion.analysis || {};
    tailRegion.analysis.roomOverlayTailStaticBoundProofAudit = {
      kind: 'room_overlay_tail_static_bound_proof',
      ...shared,
      summary: 'Cataloged static _RAM_CF64_ sources do not select r2813; the tail remains quarantined pending runtime index tracing.',
    };
    if (tailRegion.analysis.lowConfidenceResidualTriageAudit) {
      tailRegion.analysis.lowConfidenceResidualTriageAudit.latestStaticBoundProofAudit = catalogId;
      tailRegion.analysis.lowConfidenceResidualTriageAudit.latestStaticBoundProofStatus = catalog.summary.status;
    }
    if (tailRegion.analysis.residualProofConsumerAudit) {
      tailRegion.analysis.residualProofConsumerAudit.roomOverlayTailStaticBoundProofAudit = catalogId;
      tailRegion.analysis.residualProofConsumerAudit.roomOverlayTailStaticBoundProofStatus = catalog.summary.status;
    }
    annotated.push({ id: tailRegion.id, offset: tailRegion.offset, analysisKey: 'roomOverlayTailStaticBoundProofAudit' });
  }

  if (overlayRegion) {
    overlayRegion.analysis = overlayRegion.analysis || {};
    overlayRegion.analysis.roomOverlayTailStaticBoundProofAudit = {
      kind: 'room_overlay_table_static_bound_proof',
      ...shared,
      recordStride: catalog.summary.overlayRecordStride,
      recordCount: catalog.summary.overlayRecordCount,
      summary: 'The confirmed _DATA_10000_ overlay table remains bounded to 227 records; cataloged selectors stay in range and do not select the r2813 tail.',
    };
    annotated.push({ id: overlayRegion.id, offset: overlayRegion.offset, analysisKey: 'roomOverlayTailStaticBoundProofAudit' });
  }

  if (cf64) {
    cf64.analysis = cf64.analysis || {};
    cf64.analysis.roomOverlayTailStaticBoundProofAudit = {
      kind: 'ram_cf64_overlay_tail_static_bound_proof',
      ...shared,
      referenceKindCounts: catalog.ram.referenceKindCounts,
      summary: '_RAM_CF64_ is the room-overlay index proof seed; static cataloged values do not reach the r2813 tail index.',
    };
    annotated.push({ id: cf64.id, address: cf64.address, analysisKey: 'roomOverlayTailStaticBoundProofAudit' });
  }

  return annotated;
}

function updateStaticMap(catalog) {
  if (!fs.existsSync(staticMapPath)) return;
  const staticMap = readJson(staticMapPath);
  staticMap.analyzedAt = now;
  staticMap.summary = staticMap.summary || {};
  staticMap.summary.roomOverlayTailStaticBoundProofCatalog = catalogId;
  staticMap.summary.roomOverlayTailStaticBoundProofStatus = catalog.summary.status;
  staticMap.summary.roomOverlayTailStaticBoundProofCatalogedSources = catalog.summary.catalogedSourceCount;
  staticMap.summary.roomOverlayTailStaticBoundProofTailIndexRefs = catalog.summary.tailIndexRefCount;
  staticMap.summary.roomOverlayTailStaticBoundProofOutOfBoundsRefs = catalog.summary.outOfBoundsIndexCount;
  staticMap.summary.roomOverlayTailStaticBoundProofRuntimeTraceRequired = catalog.summary.runtimeTraceRequired;
  staticMap.summary.roomOverlayTailStaticBoundProofDefaultDecoderExcluded = catalog.summary.defaultDecoderExcluded;
  staticMap.primaryCatalogs = staticMap.primaryCatalogs || {};
  staticMap.primaryCatalogs.rooms = insertAfter(
    staticMap.primaryCatalogs.rooms,
    'world-room-event-key-semantics-catalog-2026-06-26',
    catalogId
  );
  staticMap.primaryCatalogs.rendering = insertAfter(
    staticMap.primaryCatalogs.rendering,
    'world-runtime-ram-trace-seed-catalog-2026-06-26',
    catalogId
  );
  staticMap.primaryCatalogs.coverage = insertAfter(
    staticMap.primaryCatalogs.coverage,
    'world-residual-proof-consumer-catalog-2026-06-26',
    catalogId
  );
  staticMap.nextLeads = (staticMap.nextLeads || []).filter(note => !note.includes(catalogId));
  staticMap.nextLeads.push('Use world-room-overlay-tail-static-bound-proof-catalog-2026-06-26 as the static disposition for r2813; promotion still requires runtime _RAM_CF64_ index tracing.');
  writeJson(staticMapPath, staticMap);
}

function main() {
  const mapData = readJson(mapPath);
  const asmText = fs.readFileSync(asmPath, 'utf8');
  const catalog = buildCatalog(mapData, asmText);
  const annotated = apply ? applyCatalog(mapData, catalog) : [];

  if (apply) {
    mapData.roomDataCatalogs = (mapData.roomDataCatalogs || []).filter(item => item.id !== catalogId);
    mapData.roomDataCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'room_overlay_tail_static_bound_proof_audit',
      schemaVersion: 1,
      generatedAt: now,
      tool: `${toolName} --apply`,
      catalogId,
      sourceCatalogs,
      summary: {
        ...catalog.summary,
        annotatedEntries: annotated.length,
      },
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
      annotatedEntries: annotated,
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
      annotatedEntries: annotated.length,
    },
    sourceClosure: catalog.sourceClosure.summary,
    ramReferenceKindCounts: catalog.ram.referenceKindCounts,
  }, null, 2));
}

main();
