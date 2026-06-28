#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-24T00:00:00Z';
const catalogId = 'world-loader-boundary-catalog-2026-06-24';
const reportId = 'loader-boundary-audit-2026-06-24';
const tileSourceCatalogId = 'world-tile-source-catalog-2026-06-24';

const SPLITS = [
  {
    sourceOffset: 0x12337,
    originalEndExclusive: 0x12486,
    loaderType: 'vram_loader_8fb',
    loaderRole: 'confirmed_8fb_loader_prefix',
    tailType: 'data_table',
    tailRole: 'unresolved_data_after_8fb_loader_prefix',
    confidence: 'high',
    evidence: [
      'ASM line 28661 loads HL with _DATA_12337_.',
      'ASM line 28662 calls _LABEL_8FB_ with that HL source.',
      'tile-source audit decodes the _DATA_12337_ 8FB stream as terminated at 0x123FF.',
      'Bytes after the 8FB terminator are not consumed by _LABEL_8FB_ and need a separate consumer/decoder before getting a semantic asset type.',
    ],
  },
];

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function offsetOf(region) {
  return parseInt(region.offset, 16);
}

function findExactRegion(mapData, offset) {
  return (mapData.regions || []).find(region => offsetOf(region) === offset) || null;
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

function nextRegionNumber(mapData) {
  let maxId = 0;
  for (const region of mapData.regions || []) {
    const match = /^r(\d+)$/.exec(region.id || '');
    if (match) maxId = Math.max(maxId, Number(match[1]));
  }
  return maxId + 1;
}

function formatRegionId(number) {
  return 'r' + String(number).padStart(4, '0');
}

function loaderEntryFor(mapData, sourceOffset) {
  const catalog = (mapData.tileSourceCatalogs || []).find(item => item.id === tileSourceCatalogId);
  const sourceHex = hex(sourceOffset);
  return (catalog?.loaderEntries || []).find(entry => entry.loaderRegion?.offset === sourceHex) || null;
}

function buildSplit(mapData, def) {
  const sourceRegion = findExactRegion(mapData, def.sourceOffset);
  const loaderEntry = loaderEntryFor(mapData, def.sourceOffset);
  const consumedBytes = loaderEntry?.consumedBytes || 0;
  const loaderEndExclusive = def.sourceOffset + consumedBytes;
  const tailRegion = consumedBytes > 0 ? findExactRegion(mapData, loaderEndExclusive) : null;
  const originalSize = def.originalEndExclusive - def.sourceOffset;
  const tailSize = def.originalEndExclusive - loaderEndExclusive;
  const canSplit = Boolean(
    sourceRegion &&
    sourceRegion.size === originalSize &&
    consumedBytes > 0 &&
    tailSize > 0 &&
    !tailRegion &&
    (sourceRegion.type || 'unknown') === def.loaderType
  );
  const alreadySplit = Boolean(
    sourceRegion &&
    consumedBytes > 0 &&
    sourceRegion.size === consumedBytes &&
    tailRegion &&
    tailRegion.size === tailSize
  );
  const blockedReasons = [];
  if (!sourceRegion) blockedReasons.push(`No exact loader region at ${hex(def.sourceOffset)}.`);
  if (!loaderEntry) blockedReasons.push(`No tile-source catalog entry for ${hex(def.sourceOffset)}.`);
  if (loaderEntry && !loaderEntry.terminated) blockedReasons.push(`Tile-source loader entry is not terminated: ${loaderEntry.endReason || 'unknown reason'}.`);
  if (sourceRegion && sourceRegion.size !== originalSize && sourceRegion.size !== consumedBytes) {
    blockedReasons.push(`Unexpected source region size ${sourceRegion.size}; expected ${originalSize} before split or ${consumedBytes} after split.`);
  }
  if (sourceRegion && (sourceRegion.type || 'unknown') !== def.loaderType) {
    blockedReasons.push(`Source region type is ${sourceRegion.type || 'unknown'}, not ${def.loaderType}.`);
  }
  if (tailRegion && !alreadySplit) blockedReasons.push(`Tail target ${hex(loaderEndExclusive)} already has region ${tailRegion.id}.`);

  return {
    sourceOffset: hex(def.sourceOffset),
    originalEndExclusive: hex(def.originalEndExclusive),
    originalSize,
    consumedBytes,
    loaderEndExclusive: consumedBytes > 0 ? hex(loaderEndExclusive) : null,
    loaderEndInclusive: consumedBytes > 0 ? hex(loaderEndExclusive - 1) : null,
    tail: consumedBytes > 0 && tailSize > 0 ? {
      offset: hex(loaderEndExclusive),
      size: tailSize,
      type: def.tailType,
      role: def.tailRole,
    } : null,
    sourceRegion: regionRef(sourceRegion),
    tailRegion: regionRef(tailRegion),
    canSplit,
    alreadySplit,
    blockedReasons,
    evidence: def.evidence,
  };
}

function buildCatalog(mapData) {
  const splits = SPLITS.map(def => buildSplit(mapData, def));
  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-loader-boundary-audit.mjs',
    summary: {
      auditedLoaders: splits.length,
      canSplit: splits.filter(item => item.canSplit).length,
      alreadySplit: splits.filter(item => item.alreadySplit).length,
      blocked: splits.filter(item => item.blockedReasons.length && !item.alreadySplit).length,
      assetPolicy: 'Metadata only: loader offsets, decoded consumed lengths, split boundaries, region ids, and evidence. No ROM bytes or decoded graphics are embedded.',
    },
    splits,
  };
}

function annotateRegion(region, audit) {
  region.analysis = region.analysis || {};
  region.analysis.loaderBoundaryAudit = audit;
}

function applySplits(mapData, catalog) {
  const changed = [];
  const evidenceOnly = [];
  const blocked = [];
  let nextId = nextRegionNumber(mapData);

  for (const split of catalog.splits) {
    const def = SPLITS.find(item => hex(item.sourceOffset) === split.sourceOffset);
    const sourceOffset = parseInt(split.sourceOffset, 16);
    const sourceRegion = findExactRegion(mapData, sourceOffset);
    if (split.canSplit && sourceRegion && split.tail) {
      const typeBefore = sourceRegion.type || 'unknown';
      const sizeBefore = sourceRegion.size || 0;
      sourceRegion.size = split.consumedBytes;
      annotateRegion(sourceRegion, {
        catalogId,
        kind: def.loaderRole,
        confidence: def.confidence,
        typeBeforeAudit: typeBefore,
        typeAfterAudit: sourceRegion.type || typeBefore,
        sizeBeforeAudit: sizeBefore,
        sizeAfterAudit: sourceRegion.size,
        changedType: false,
        changedSize: sizeBefore !== sourceRegion.size,
        decodedTerminator: split.loaderEndInclusive,
        summary: 'Loader region trimmed to the bytes consumed by the confirmed _LABEL_8FB_ stream.',
        evidence: split.evidence,
        generatedAt: now,
        tool: 'tools/world-loader-boundary-audit.mjs',
      });
      changed.push(regionRef(sourceRegion));

      const newRegion = {
        id: formatRegionId(nextId++),
        offset: split.tail.offset,
        size: split.tail.size,
        type: split.tail.type,
        name: 'unresolved data after _DATA_12337_ 8FB loader @ ' + split.tail.offset,
        confidence: 'low',
        notes: 'Tail after decoded _LABEL_8FB_ loader terminator; consumer not identified yet.',
        analysis: {
          loaderBoundaryAudit: {
            catalogId,
            kind: split.tail.role,
            confidence: 'low',
            typeBeforeAudit: 'covered_by_overwide_loader_region',
            typeAfterAudit: split.tail.type,
            sizeBeforeAudit: 0,
            sizeAfterAudit: split.tail.size,
            changedType: true,
            changedSize: true,
            decodedTerminator: split.loaderEndInclusive,
            summary: 'Preserved bytes after the confirmed 8FB loader terminator as unresolved data metadata.',
            evidence: split.evidence,
            generatedAt: now,
            tool: 'tools/world-loader-boundary-audit.mjs',
          },
        },
      };
      mapData.regions.push(newRegion);
      mapData.regions.sort((a, b) => offsetOf(a) - offsetOf(b) || (a.size || 0) - (b.size || 0));
      changed.push(regionRef(newRegion));
    } else if (split.alreadySplit && sourceRegion && split.tailRegion) {
      annotateRegion(sourceRegion, {
        catalogId,
        kind: def.loaderRole,
        confidence: def.confidence,
        typeBeforeAudit: sourceRegion.type || 'unknown',
        typeAfterAudit: sourceRegion.type || 'unknown',
        sizeBeforeAudit: sourceRegion.size || 0,
        sizeAfterAudit: sourceRegion.size || 0,
        changedType: false,
        changedSize: false,
        decodedTerminator: split.loaderEndInclusive,
        summary: 'Loader boundary split already applied.',
        evidence: split.evidence,
        generatedAt: now,
        tool: 'tools/world-loader-boundary-audit.mjs',
      });
      evidenceOnly.push(regionRef(sourceRegion), split.tailRegion);
    } else {
      blocked.push({
        sourceOffset: split.sourceOffset,
        blockedReasons: split.blockedReasons,
        sourceRegion: split.sourceRegion,
        tailRegion: split.tailRegion,
      });
    }
  }
  return { changed, evidenceOnly, blocked };
}

function changedRegionRefs(mapData) {
  return (mapData.regions || [])
    .filter(region => region.analysis?.loaderBoundaryAudit?.catalogId === catalogId)
    .map(region => ({
      id: region.id,
      offset: region.offset,
      size: region.size || 0,
      type: region.type || 'unknown',
      name: region.name || '',
      kind: region.analysis.loaderBoundaryAudit.kind,
      confidence: region.analysis.loaderBoundaryAudit.confidence,
    }));
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const changes = applySplits(mapData, catalog);

  if (apply) {
    const finalCatalog = buildCatalog(mapData);
    mapData.tileSourceCatalogs = (mapData.tileSourceCatalogs || []).filter(item => item.id !== catalogId);
    mapData.tileSourceCatalogs.push(finalCatalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'loader_boundary_audit',
      generatedAt: now,
      tool: 'tools/world-loader-boundary-audit.mjs --apply',
      schemaVersion: 1,
      summary: {
        ...finalCatalog.summary,
        changedRegions: changedRegionRefs(mapData).length,
        changedThisRun: changes.changed.length,
        evidenceOnlyRegions: changes.evidenceOnly.length,
        blockedSplits: changes.blocked.length,
      },
      changedRegions: changedRegionRefs(mapData),
      changedThisRun: changes.changed,
      evidenceOnlyRegions: changes.evidenceOnly,
      blockedSplits: changes.blocked,
      nextLeads: [
        'Find a consumer or decoder for the new 0x12400-0x12485 unresolved data tail.',
        'Trace the larger 0x12486 tail after _DATA_12337_ before retyping it away from screen_prog.',
        'Generalize loader-boundary checks to every 8FB/998 region whose declared size exceeds decoded consumed bytes.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    changed: changes.changed,
    evidenceOnly: changes.evidenceOnly,
    blocked: changes.blocked,
  }, null, 2));
}

main();
