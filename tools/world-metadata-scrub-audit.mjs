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
const reportId = 'metadata-byte-preview-scrub-2026-06-24';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hex(n, pad = 5) {
  return '0x' + n.toString(16).toUpperCase().padStart(pad, '0');
}

function rawHexBytes(note) {
  const text = (note || '').trim();
  if (!/^(?:[0-9A-F]{2})(?: [0-9A-F]{2})+$/i.test(text)) return null;
  return text.split(/\s+/);
}

function paletteRecordIndex(region) {
  const start = parseInt(region.offset, 16);
  if (start < 0x1C5B0 || start >= 0x1C800) return null;
  if ((start - 0x1C5B0) % 16 !== 0) return null;
  return (start - 0x1C5B0) / 16;
}

function replacementNote(region, byteCount) {
  const index = paletteRecordIndex(region);
  const indexPart = index == null ? '' : ` index ${index}`;
  return `${byteCount}-byte ${region.type || 'data'} record${indexPart}; raw byte preview removed by metadata scrub audit.`;
}

function scrubCandidates(mapData) {
  return (mapData.regions || [])
    .map(region => {
      const bytes = rawHexBytes(region.notes);
      if (!bytes) return null;
      return {
        id: region.id,
        offset: region.offset,
        size: region.size || 0,
        type: region.type || 'unknown',
        name: region.name || '',
        byteCount: bytes.length,
        replacementNote: replacementNote(region, bytes.length),
      };
    })
    .filter(Boolean);
}

function applyScrub(mapData, candidates) {
  const byId = new Map(candidates.map(candidate => [candidate.id, candidate]));
  const scrubbed = [];
  for (const region of mapData.regions || []) {
    const candidate = byId.get(region.id);
    if (!candidate) continue;
    region.notes = candidate.replacementNote;
    region.analysis = region.analysis || {};
    region.analysis.metadataScrubAudit = {
      reportId,
      kind: 'raw_hex_byte_preview_removed',
      confidence: 'high',
      byteCount: candidate.byteCount,
      summary: 'Removed a raw ROM byte preview from region notes; structural metadata remains in region fields and type-specific catalogs.',
      preservedMetadata: {
        id: region.id,
        offset: region.offset,
        size: region.size || 0,
        type: region.type || 'unknown',
        name: region.name || '',
        paletteRecordIndex: paletteRecordIndex(region),
      },
      evidence: [
        'The previous note matched a pure space-separated hex byte preview.',
        'The replacement note stores byte count and structural context only, not byte values.',
        'Palette record indices and loader evidence are preserved in paletteCatalogs and region analysis.',
      ],
      generatedAt: now,
      tool: 'tools/world-metadata-scrub-audit.mjs',
    };
    scrubbed.push({
      id: region.id,
      offset: region.offset,
      type: region.type || 'unknown',
      byteCount: candidate.byteCount,
      replacementNote: region.notes,
    });
  }
  return scrubbed;
}

function main() {
  const mapData = readJson(mapPath);
  const candidates = scrubCandidates(mapData);
  const scrubbed = apply ? applyScrub(mapData, candidates) : candidates.map(candidate => ({
    id: candidate.id,
    offset: candidate.offset,
    type: candidate.type,
    byteCount: candidate.byteCount,
    replacementNote: candidate.replacementNote,
  }));
  const summary = {
    candidateNotes: candidates.length,
    scrubbedNotes: scrubbed.length,
    totalPreviewBytes: candidates.reduce((sum, candidate) => sum + candidate.byteCount, 0),
    assetPolicy: 'Metadata scrub only: removes raw byte previews from notes and stores byte counts, offsets, ids, types, and evidence. No ROM bytes are embedded.',
  };

  if (apply) {
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'metadata_byte_preview_scrub',
      generatedAt: now,
      tool: 'tools/world-metadata-scrub-audit.mjs --apply',
      schemaVersion: 1,
      summary,
      scrubbedRegions: scrubbed,
      nextLeads: [
        'Keep generated analysis reports metadata-only; do not add raw byte previews to region notes.',
        'Use type-specific catalogs for record indices, counts, and provenance instead of embedded bytes.',
        'Add analyzer UI previews from the user-loaded local ROM at runtime rather than storing bytes in project JSON.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    reportId,
    summary,
    scrubbedRegions: scrubbed.map(region => ({
      id: region.id,
      offset: region.offset,
      type: region.type,
      byteCount: region.byteCount,
      replacementNote: region.replacementNote,
    })),
    remainingRawHexNoteCount: apply ? scrubCandidates(mapData).length : candidates.length,
    tableRange: { start: hex(0x1C5B0), endExclusive: hex(0x1C800) },
  }, null, 2));
}

main();
