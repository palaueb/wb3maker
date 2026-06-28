#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const romPath = path.join(repoRoot, 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).sms');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const toolName = 'tools/world-blank-metasprite-target-audit.mjs';
const catalogId = 'world-blank-metasprite-target-catalog-2026-06-26';
const reportId = 'blank-metasprite-target-audit-2026-06-26';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseHex(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const match = String(value).match(/^(?:0x|\$)?([0-9a-f]+)$/i);
  return match ? parseInt(match[1], 16) : null;
}

function hex(value, pad = 5) {
  return `0x${(value >>> 0).toString(16).toUpperCase().padStart(pad, '0')}`;
}

function regionStart(region) {
  return parseHex(region.offset ?? region.start);
}

function regionSize(region) {
  if (Number.isFinite(region.size)) return region.size;
  const start = regionStart(region);
  const end = parseHex(region.end);
  if (start == null || end == null || end < start) return null;
  return end - start + 1;
}

function regionEndExclusive(region) {
  const start = regionStart(region);
  const size = regionSize(region);
  if (start == null || size == null) return null;
  return start + size;
}

function byteStats(rom, region) {
  const start = regionStart(region);
  const size = regionSize(region);
  if (start == null || size == null || size < 0 || start + size > rom.length) return null;
  let zeroBytes = 0;
  let nonzeroBytes = 0;
  for (let offset = start; offset < start + size; offset++) {
    if (rom[offset] === 0) zeroBytes++;
    else nonzeroBytes++;
  }
  return {
    size,
    zeroBytes,
    nonzeroBytes,
    allZero: nonzeroBytes === 0,
    zeroRatio: Number((zeroBytes / Math.max(1, size)).toFixed(4)),
  };
}

function directiveCounts(region) {
  return region.analysis?.asmDataLabelCensusAudit?.directiveCounts || {};
}

function labelEvidence(region) {
  return (region.analysis?.asmDataLabelCensusAudit?.labels || []).map(label => ({
    label: label.label,
    offset: label.offset,
    asmLine: label.asmLine,
    approxSize: label.approxSize,
    directiveCounts: label.directiveCounts || {},
    incomingRefCount: label.incomingRefCount,
  }));
}

function hasDsbZeroFill(region) {
  const counts = directiveCounts(region);
  return Number(counts['.dsb'] || 0) > 0;
}

function classifyRegion(region, stats) {
  const roles = [];
  const frameStreams = region.analysis?.animationFrameStreamAudit?.frameStreams || [];
  const hasQuarantinedFrameStream = frameStreams.some(stream =>
    stream.quarantined ||
    stream.termination?.kind === 'blank_metasprite_target_quarantined'
  );
  const hasUnboundedFrameStream = frameStreams.some(stream =>
    stream.termination?.kind === 'record_limit_reached' ||
    (stream.issueCount || 0) > 0
  );
  if (region.analysis?.c34eMetaspriteFamilyAudit) roles.push('c34e_pointer_table_blank_target');
  if (region.analysis?.playerA48TileStreamAudit) roles.push('player_a48_noop_stream_region');
  if (region.analysis?.animationBehaviorFamilyAudit) roles.push('behavior_animation_blank_frame_target');
  if (hasUnboundedFrameStream) roles.push('quarantine_unbounded_zero_frame_stream_decode');
  else if (hasQuarantinedFrameStream) roles.push('quarantined_blank_frame_stream_target');
  else if (frameStreams.length) roles.push('frame_stream_reference_target');
  if (region.analysis?.metaspriteAudit) roles.push('metasprite_reference_target');
  if (!roles.length) roles.push('all_zero_metasprite_typed_region');

  const dsb = hasDsbZeroFill(region);
  const incbin = Number(directiveCounts(region)['.incbin'] || 0) > 0;
  const confidence = dsb ? 'high' : (incbin ? 'medium' : 'medium_high');
  const kind = dsb
    ? 'declared_zero_fill_metasprite_target'
    : 'all_zero_metasprite_fragment';

  const decodePolicy = roles.includes('quarantine_unbounded_zero_frame_stream_decode') || roles.includes('quarantined_blank_frame_stream_target')
    ? 'Do not expand as a normal frame stream without stronger runtime evidence; zero-filled streams can hit parser limits because _LABEL_792_ terminates on 0x80, not on 0x00.'
    : 'Treat as blank/no-op graphics payload unless a consumer-specific decoder proves a bounded non-blank interpretation.';

  return {
    kind,
    roles,
    confidence,
    decodePolicy,
    declaredZeroFill: dsb,
    incbinFragment: incbin,
    allZero: stats.allZero,
  };
}

function summarizeTargetOffsets(region) {
  const offsets = new Set();
  for (const offset of region.analysis?.metaspriteAudit?.detail?.targetOffsets || []) offsets.add(offset);
  for (const stream of region.analysis?.animationFrameStreamAudit?.frameStreams || []) {
    if (stream.frameOffset) offsets.add(stream.frameOffset);
  }
  return [...offsets].sort();
}

function buildEntry(region, rom) {
  const stats = byteStats(rom, region);
  if (!stats?.allZero) return null;
  const start = regionStart(region);
  const endExclusive = regionEndExclusive(region);
  const classification = classifyRegion(region, stats);
  const frameStreams = region.analysis?.animationFrameStreamAudit?.frameStreams || [];
  const unboundedFrameStreams = frameStreams.filter(stream =>
    stream.termination?.kind === 'record_limit_reached' ||
    (stream.issueCount || 0) > 0
  );

  return {
    region: {
      id: region.id,
      offset: hex(start),
      endExclusive: hex(endExclusive),
      size: stats.size,
      type: region.type,
      name: region.name || null,
    },
    kind: classification.kind,
    roles: classification.roles,
    confidence: classification.confidence,
    byteClass: {
      allZero: true,
      zeroBytes: stats.zeroBytes,
      nonzeroBytes: stats.nonzeroBytes,
      zeroRatio: stats.zeroRatio,
    },
    directiveEvidence: {
      directiveCounts: directiveCounts(region),
      labels: labelEvidence(region),
    },
    referenceSummary: {
      metaspriteReferenceCount: Number(region.analysis?.metaspriteAudit?.detail?.referenceCount || 0),
      targetOffsetCount: summarizeTargetOffsets(region).length,
      targetOffsets: summarizeTargetOffsets(region),
      c34eTableIndex: region.analysis?.c34eMetaspriteFamilyAudit?.tableIndex ?? null,
      animationFamilyCount: (region.analysis?.animationBehaviorFamilyAudit?.families || []).length,
      frameStreamCount: frameStreams.length,
      unboundedFrameStreamCount: unboundedFrameStreams.length,
      playerA48StreamRegion: Boolean(region.analysis?.playerA48TileStreamAudit),
    },
    decodePolicy: classification.decodePolicy,
    evidence: [
      `Local ROM byte-class scan confirms ${stats.size} bytes in ${region.id} are all zero.`,
      hasDsbZeroFill(region)
        ? 'ASM data-label census records a .dsb zero-fill directive for this mapped region.'
        : 'ASM data-label census and local ROM byte-class scan identify this as an all-zero mapped fragment.',
      'This audit stores offsets, counts, labels, and provenance only; no ROM bytes or decoded graphics are embedded.',
    ],
  };
}

function buildCatalog(mapData, rom) {
  const entries = (mapData.regions || [])
    .filter(region => region.type === 'meta_sprite')
    .map(region => buildEntry(region, rom))
    .filter(Boolean)
    .sort((a, b) => parseHex(a.region.offset) - parseHex(b.region.offset));

  const totalBytes = entries.reduce((sum, entry) => sum + entry.byteClass.zeroBytes, 0);
  const roleCounts = new Map();
  const confidenceCounts = new Map();
  for (const entry of entries) {
    confidenceCounts.set(entry.confidence, (confidenceCounts.get(entry.confidence) || 0) + 1);
    for (const role of entry.roles) roleCounts.set(role, (roleCounts.get(role) || 0) + 1);
  }

  return {
    id: catalogId,
    generatedAt: now,
    tool: toolName,
    type: 'blank_metasprite_target_catalog',
    source: 'local_rom_and_world_map_metadata',
    summary: {
      allZeroMetaspriteRegionCount: entries.length,
      declaredZeroFillRegionCount: entries.filter(entry => entry.kind === 'declared_zero_fill_metasprite_target').length,
      allZeroFragmentRegionCount: entries.filter(entry => entry.kind === 'all_zero_metasprite_fragment').length,
      totalAllZeroBytes: totalBytes,
      roleCounts: Object.fromEntries([...roleCounts.entries()].sort()),
      confidenceCounts: Object.fromEntries([...confidenceCounts.entries()].sort()),
      unboundedZeroFrameStreamRegionCount: entries.filter(entry => entry.referenceSummary.unboundedFrameStreamCount > 0).length,
      persistedRomByteCount: 0,
      persistedTileByteCount: 0,
      persistedPixelCount: 0,
      assetPolicy: 'Metadata only: all-zero byte counts, offsets, labels, reference counts, and decoder policy. No ROM bytes, decoded sprites, graphics, pixels, screenshots, coordinates, music, text, or gameplay payloads are embedded.',
    },
    entries,
    evidence: [
      'The audit reads the local user-supplied ROM and stores only aggregate byte-class counts.',
      'ASM data-label census metadata supplies labels, directive counts, and incoming reference counts.',
      'All-zero metasprite-typed regions should be treated as blank/no-op targets or quarantined parser leads until a bounded consumer-specific interpretation is proven.',
    ],
    nextLeads: [
      'Teach frame-stream audits to skip or quarantine all-zero metasprite target regions unless a runtime trace proves the zero-filled data is intentionally consumed.',
      'Separate declared blank targets from true sprite graphics in browser render summaries so unresolved sprite tiles are not hidden by zero-filled placeholders.',
      'Trace the _DATA_1071A_/_RAM_C34E_ table selection states to distinguish player form blank targets from normal metasprite family targets.',
    ],
  };
}

function annotateRegion(region, entry) {
  region.analysis = region.analysis || {};
  region.analysis.blankMetaspriteTargetAudit = {
    catalogId,
    kind: entry.kind,
    confidence: entry.confidence,
    roles: entry.roles,
    allZero: true,
    byteClass: entry.byteClass,
    referenceSummary: entry.referenceSummary,
    decodePolicy: entry.decodePolicy,
    typeBeforeAudit: region.type,
    typeAfterAudit: region.type,
    changedType: false,
    summary: entry.kind === 'declared_zero_fill_metasprite_target'
      ? 'Declared zero-filled metasprite target; preserve as a blank/no-op target rather than decoded sprite graphics.'
      : 'All-zero metasprite-classified fragment; preserve as a blank/quarantined asset lead until consumer-specific evidence proves otherwise.',
    evidence: entry.evidence,
    generatedAt: now,
    tool: toolName,
  };

  const note = entry.kind === 'declared_zero_fill_metasprite_target'
    ? 'Audit: confirmed all-zero metasprite target/no-op stream; metadata only.'
    : 'Audit: all-zero metasprite fragment; quarantined from normal frame decoding pending stronger consumer evidence.';
  if (!String(region.notes || '').includes(note)) {
    region.notes = `${region.notes || ''}${region.notes ? ' ' : ''}${note}`;
  }
}

function applyCatalog(mapData, catalog) {
  let annotatedRegionCount = 0;
  for (const entry of catalog.entries) {
    const region = (mapData.regions || []).find(candidate => candidate.id === entry.region.id);
    if (!region) continue;
    annotateRegion(region, entry);
    annotatedRegionCount++;
  }

  mapData.metaspriteCatalogs = (mapData.metaspriteCatalogs || []).filter(item => item.id !== catalogId);
  mapData.metaspriteCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    generatedAt: now,
    tool: `${toolName} --apply`,
    type: 'blank_metasprite_target_audit',
    summary: {
      ...catalog.summary,
      annotatedRegionCount,
    },
    evidence: catalog.evidence,
    nextLeads: catalog.nextLeads,
  });
  return { annotatedRegionCount };
}

function main() {
  const mapData = readJson(mapPath);
  const rom = fs.readFileSync(romPath);
  const catalog = buildCatalog(mapData, rom);
  const result = apply ? applyCatalog(mapData, catalog) : { annotatedRegionCount: 0 };
  if (apply) fs.writeFileSync(mapPath, `${JSON.stringify(mapData, null, 2)}\n`);
  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: {
      ...catalog.summary,
      ...result,
    },
    entries: catalog.entries.map(entry => ({
      region: entry.region,
      kind: entry.kind,
      roles: entry.roles,
      confidence: entry.confidence,
      referenceSummary: entry.referenceSummary,
    })),
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
}
