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
const catalogId = 'world-pause-status-stream-loader-disambiguation-catalog-2026-06-25';
const reportId = 'pause-status-stream-loader-disambiguation-audit-2026-06-25';
const toolName = 'tools/world-pause-status-stream-loader-disambiguation-audit.mjs';

const streamRegionIds = ['r2713', 'r2749', 'r2717', 'r2719', 'r2720', 'r2747', 'r2715', 'r2748'];
const bank7BundleFragmentIds = new Set(['r2749', 'r2717', 'r2719', 'r2720']);
const bank7BundleFragmentNames = {
  r2749: '_DATA_1DE20_ pause/status candidate data bundle',
  r2717: 'pause/status candidate data bundle fragment @ 0x1DE9F',
  r2719: 'pause/status candidate data bundle fragment @ 0x1DEAF',
  r2720: 'pause/status candidate data bundle fragment @ 0x1DF2A',
};
const aliasZ80Pointer = '0x9D64';
const bank2AliasRomOffset = '0x09D64';
const bank7AliasRomOffset = '0x1DD64';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function pauseStatusCandidateGraphicsRegions(mapData) {
  return (mapData.regions || [])
    .filter(region => region.analysis?.pauseStatusLoaderSourceCoverage)
    .sort((a, b) => parseInt(a.offset, 16) - parseInt(b.offset, 16));
}

function bank2AliasResolution(mapData) {
  const targetRegion = (mapData.regions || []).find(region => {
    const start = parseInt(region.offset, 16);
    return start <= 0x09D64 && start + (region.size || 0) > 0x09D64;
  }) || null;
  const targetRefs = [];
  const statePointerRefs = [];

  for (const catalog of mapData.vdpStreamCatalogs || []) {
    for (const target of catalog.streamTargets || []) {
      if (target.offset === bank2AliasRomOffset || target.id === 'vdp_stream_9D64') {
        targetRefs.push({
          catalogId: catalog.id,
          targetId: target.id || null,
          offset: target.offset || null,
          references: (target.references || []).slice(0, 8),
        });
      }
    }
    for (const table of catalog.stateRecordTables || []) {
      for (const entry of table.pointerEntries || []) {
        if (entry.z80Pointer === aliasZ80Pointer) {
          statePointerRefs.push({
            catalogId: catalog.id,
            tableId: table.id || table.tableId || null,
            index: entry.index ?? null,
            z80Pointer: entry.z80Pointer,
            recordOffset: entry.recordOffset || null,
          });
        }
      }
    }
  }

  return {
    status: targetRefs.length || statePointerRefs.length
      ? 'known_stream_state_alias_resolves_to_bank2_not_bank7'
      : 'no_bank2_alias_catalog_entry_found',
    z80Pointer: aliasZ80Pointer,
    bank2RomOffset: bank2AliasRomOffset,
    bank7RomOffset: bank7AliasRomOffset,
    bank2ContainingRegion: regionRef(targetRegion),
    bank2StreamTargetRefCount: targetRefs.reduce((sum, target) => sum + (target.references?.length || 0), 0),
    bank2StreamTargets: targetRefs,
    bank2StatePointerRefCount: statePointerRefs.length,
    bank2StatePointerRefs: statePointerRefs.slice(0, 12),
    evidence: [
      `Banked Z80 pointer ${aliasZ80Pointer} can name ROM ${bank2AliasRomOffset} in the bank-2 stream bundle or ROM ${bank7AliasRomOffset} in bank 7.`,
      'world-vdp-stream-catalog-2026-06-24 resolves the known stream target vdp_stream_9D64 to ROM 0x09D64 inside r0186.',
      'world-bank2-vdp-stream-state-catalog-2026-06-25 records state-table entries with z80Pointer 0x9D64 in the bank-2 VDP stream context.',
      'No equivalent executable path has been confirmed that feeds bank-7 ROM 0x1DD64 into _RAM_D176_.',
    ],
  };
}

function buildCatalog(mapData) {
  const streamRegions = streamRegionIds
    .map(id => findRegionById(mapData, id))
    .filter(Boolean);
  const graphicsRegions = pauseStatusCandidateGraphicsRegions(mapData);
  const candidateUniqueBytes = graphicsRegions.reduce((sum, region) => {
    return sum + (region.analysis.pauseStatusLoaderSourceCoverage.uniqueBytes || 0);
  }, 0);
  const aliasResolution = bank2AliasResolution(mapData);
  const supersededBank7VdpClaims = streamRegions.filter(region => (
    bank7BundleFragmentIds.has(region.id) && region.analysis?.bank7VdpStreamAudit
  )).length;

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    summary: {
      streamOrPointerRegions: streamRegions.length,
      graphicsCandidateRegions: graphicsRegions.length,
      graphicsCandidateUniqueBytes: candidateUniqueBytes,
      bankAliasStatus: aliasResolution.status,
      supersededBank7VdpClaims,
      interpretation: 'The 0x1DE20 bytes are shape-compatible with _LABEL_998_ records, but no executable _LABEL_998_ consumer is confirmed. Known 0x9D64 VDP-stream state pointers resolve to bank-2 ROM 0x09D64, not bank-7 ROM 0x1DD64.',
      assetPolicy: 'Metadata only: region ids, offsets, routine labels, status flags, source span counts, and evidence. No ROM bytes, decoded graphics, screenshots, or rendered assets are embedded.',
    },
    hypotheses: [
      {
        id: 'bank_alias_resolution',
        status: aliasResolution.status,
        confidence: aliasResolution.status === 'known_stream_state_alias_resolves_to_bank2_not_bank7' ? 'high' : 'medium',
        summary: 'The known stream-state 0x9D64 references are bank-2 stream-bundle targets, so they do not prove bank-7 _DATA_1DD64_ is consumed.',
        evidence: aliasResolution.evidence,
      },
      {
        id: 'vdp_stream_pointer_interpreter',
        status: 'interpreter_confirmed_bank7_pointer_feed_unresolved',
        confidence: 'high',
        summary: '_LABEL_97D9_/_LABEL_9812_ is a real VDP/name-table stream interpreter fed through _RAM_D176_, but the known 0x9D64 stream-state references point to bank-2 0x09D64 rather than bank-7 _DATA_1DD64_.',
        evidence: [
          'ASM lines 19538-19549 load HL from _RAM_D176_, scan pointer records, and stop on a zero word.',
          'ASM lines 19554-19566 add destination offsets to _RAM_D17A_/_RAM_D17B_ and store the resolved VDP destination in _RAM_D178_.',
          'ASM lines 19583-19612 write two-byte tile/name-table words to Port_VDPData.',
          'ASM lines 19648-19699 decode F0+ controls and resume the pointer-record stream.',
        ],
      },
      {
        id: 'vram_loader_998_shape',
        status: 'shape_compatible_no_confirmed_consumer',
        confidence: 'medium',
        summary: '_DATA_1DE20_ can be decoded as zero-terminated _LABEL_998_-compatible records, but no direct executable load/call path to _LABEL_998_ is known.',
        evidence: [
          'world-pause-status-loader-bundle-catalog-2026-06-25 decodes 44 zero-terminated 998-compatible records from 0x1DE20-0x1E14D.',
          'The same audit marks the consumer unresolved and preserves existing region types.',
          'No direct executable ld hl/bc/de reference to _DATA_1DD64_, _DATA_1DE04_, or _DATA_1DE20_ followed by _LABEL_998_ has been confirmed.',
        ],
      },
    ],
    aliasResolution,
    streamRegions: streamRegions.map(region => ({
      region: regionRef(region),
      currentType: region.type || 'unknown',
      bank7VdpStreamKind: region.analysis?.bank7VdpStreamAudit?.kind || null,
      pauseStatusLoaderBundleKind: region.analysis?.pauseStatusLoaderBundleAudit?.kind || null,
      unresolvedConsumerKind: region.analysis?.unresolvedAssetConsumerAudit?.kind || null,
    })),
    graphicsCandidateRegions: graphicsRegions.map(region => {
      const coverage = region.analysis.pauseStatusLoaderSourceCoverage;
      return {
        region: regionRef(region),
        candidateUniqueBytes: coverage.uniqueBytes || 0,
        candidateUniqueSpanCount: coverage.uniqueSpanCount || 0,
        rawRangeCount: coverage.rawRangeCount || 0,
        consumerStatus: coverage.consumerStatus || 'unknown',
        spanPreview: coverage.spanPreview || [],
      };
    }),
    evidence: [
      'This audit resolves terminology only: candidate 998-shaped coverage is not promoted to confirmed graphics-loader coverage.',
      'Graphics regions retain their existing graphicsUnreferencedSpanAudit results until an executable consumer or direct tile-upload path is traced.',
      'The VDP stream interpreter evidence remains useful for screen/name-table rendering, but it does not decode graphics tile source bytes.',
    ],
    nextLeads: [
      'Trace writes to _RAM_D176_ from _LABEL_972B_ state records and identify whether any selected stream pointer resolves to _DATA_1DD64_.',
      'If a _LABEL_998_ consumer is found for 0x1DE20, split the bundle into confirmed vram_loader_998 records and rerun tile-source and graphics coverage audits.',
      'Otherwise, keep 0x1DE20 as pause/status VDP/name-table stream metadata and remove candidate graphics coverage from future confirmed-coverage calculations.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const annotatedStreamRegions = [];
  for (const entry of catalog.streamRegions) {
    const region = findRegionById(mapData, entry.region.id);
    if (!region) continue;
    const typeBefore = region.type || 'unknown';
    const supersededTypeClaim = bank7BundleFragmentIds.has(region.id) && region.analysis?.bank7VdpStreamAudit
      ? (region.analysis.bank7VdpStreamAudit.typeAfterAudit || 'vdp_stream')
      : null;
    if (bank7BundleFragmentIds.has(region.id) && region.type === 'vdp_stream') {
      region.type = 'data_table';
      region.confidence = 'medium';
      region.notes = region.notes || 'Candidate pause/status data bundle; bank-7 VDP/998 consumer remains unconfirmed after bank-alias disambiguation.';
    }
    if (bank7BundleFragmentIds.has(region.id)) {
      region.name = bank7BundleFragmentNames[region.id] || region.name;
    }
    region.analysis = region.analysis || {};
    region.analysis.pauseStatusStreamLoaderDisambiguationAudit = {
      catalogId,
      kind: 'pause_status_stream_loader_interpretation_boundary',
      confidence: 'high',
      typeBeforeAudit: typeBefore,
      typeAfterAudit: region.type || typeBefore,
      changedType: typeBefore !== (region.type || typeBefore),
      supersededTypeClaim,
      typeCorrectionStatus: supersededTypeClaim === 'vdp_stream' && (region.type || typeBefore) === 'data_table'
        ? 'superseded_vdp_stream_claim_reclassified_data_table'
        : 'no_type_correction_needed',
      bankAliasStatus: catalog.aliasResolution.status,
      vdpStreamStatus: 'interpreter_confirmed_bank7_pointer_feed_unresolved',
      loader998Status: 'shape_compatible_no_confirmed_consumer',
      summary: 'Preserves the distinction between confirmed bank-2 VDP/name-table stream interpreter semantics, bank-7 alias risk, and unconfirmed _LABEL_998_-shaped loader decoding.',
      evidence: catalog.hypotheses.flatMap(item => item.evidence).slice(0, 8),
      generatedAt: now,
      tool: toolName,
    };
    if (region.analysis.bank7VdpStreamAudit) {
      region.analysis.bank7VdpStreamAudit.disambiguationStatus = 'bank_alias_conflict_not_confirmed_consumer';
      region.analysis.bank7VdpStreamAudit.supersededBy = catalogId;
      region.analysis.bank7VdpStreamAudit.supersededReason = 'Known 0x9D64 VDP stream-state references resolve to bank-2 ROM 0x09D64 inside r0186, not bank-7 ROM 0x1DD64; no confirmed _RAM_D176_ feed for this bank-7 data is currently traced.';
    }
    if (region.analysis.pauseStatusLoaderBundleAudit) {
      region.analysis.pauseStatusLoaderBundleAudit.disambiguationStatus = 'shape_compatible_only_not_confirmed_loader_coverage';
    }
    annotatedStreamRegions.push({
      ...regionRef(region),
      typeBefore,
      typeAfter: region.type || typeBefore,
      changedType: typeBefore !== (region.type || typeBefore),
      supersededTypeClaim,
    });
  }

  const annotatedGraphicsRegions = [];
  for (const entry of catalog.graphicsCandidateRegions) {
    const region = findRegionById(mapData, entry.region.id);
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.pauseStatusCandidateCoverageDisambiguation = {
      catalogId,
      kind: 'pause_status_candidate_998_source_overlay',
      confidence: 'high',
      candidateCoverageStatus: 'shape_compatible_only_not_confirmed_loader_coverage',
      confirmedGraphicsCoverage: false,
      candidateUniqueBytes: entry.candidateUniqueBytes,
      candidateUniqueSpanCount: entry.candidateUniqueSpanCount,
      rawRangeCount: entry.rawRangeCount,
      summary: 'Pause/status 998-shaped source spans overlap this graphics region, but they are not confirmed _LABEL_8FB_/_LABEL_998_ loader coverage.',
      evidence: [
        'The source spans come from shape-compatible decoding of _DATA_1DE20_, whose executable loader consumer remains unresolved.',
        'Keep graphicsUnreferencedSpanAudit active for confirmed-loader coverage until a real consumer path is traced.',
      ],
      generatedAt: now,
      tool: toolName,
    };
    if (region.analysis.pauseStatusLoaderSourceCoverage) {
      region.analysis.pauseStatusLoaderSourceCoverage.disambiguationStatus = 'shape_compatible_only_not_confirmed_loader_coverage';
      region.analysis.pauseStatusLoaderSourceCoverage.confirmedGraphicsCoverage = false;
    }
    annotatedGraphicsRegions.push(regionRef(region));
  }

  return { annotatedStreamRegions, annotatedGraphicsRegions };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  let annotations = { annotatedStreamRegions: [], annotatedGraphicsRegions: [] };

  if (apply) {
    annotations = annotateMap(mapData, catalog);
    mapData.graphicsCatalogs = (mapData.graphicsCatalogs || []).filter(item => item.id !== catalogId);
    mapData.graphicsCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'pause_status_stream_loader_disambiguation_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      summary: {
        ...catalog.summary,
        annotatedStreamRegions: annotations.annotatedStreamRegions.length,
        annotatedGraphicsRegions: annotations.annotatedGraphicsRegions.length,
      },
      hypotheses: catalog.hypotheses,
      aliasResolution: catalog.aliasResolution,
      annotatedStreamRegions: annotations.annotatedStreamRegions,
      annotatedGraphicsRegions: annotations.annotatedGraphicsRegions,
      nextLeads: catalog.nextLeads,
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    hypotheses: catalog.hypotheses.map(item => ({
      id: item.id,
      status: item.status,
      confidence: item.confidence,
    })),
    aliasResolution: {
      status: catalog.aliasResolution.status,
      bank2StreamTargetRefCount: catalog.aliasResolution.bank2StreamTargetRefCount,
      bank2StatePointerRefCount: catalog.aliasResolution.bank2StatePointerRefCount,
      bank2ContainingRegion: catalog.aliasResolution.bank2ContainingRegion,
    },
    graphicsCandidateRegions: catalog.graphicsCandidateRegions.map(item => ({
      region: item.region,
      candidateUniqueBytes: item.candidateUniqueBytes,
      candidateUniqueSpanCount: item.candidateUniqueSpanCount,
      consumerStatus: item.consumerStatus,
    })),
    annotations,
  }, null, 2));
}

main();
