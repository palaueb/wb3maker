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
const toolName = 'tools/world-palette-cf65-writer-audit.mjs';
const catalogId = 'world-palette-cf65-writer-catalog-2026-06-26';
const reportId = 'palette-cf65-writer-audit-2026-06-26';
const paletteScriptCatalogId = 'world-palette-script-catalog-2026-06-24';
const paletteTailLayoutCatalogId = 'world-palette-tail-layout-refinement-catalog-2026-06-25';
const residualProofCatalogId = 'world-residual-proof-consumer-catalog-2026-06-26';
const targetIndex = 25;
const targetScriptLabel = '_DATA_1CABB_';
const targetTailRegionIds = ['r2815', 'r2816', 'r2817'];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function hex(value, pad = 5) {
  return `0x${Number(value).toString(16).toUpperCase().padStart(pad, '0')}`;
}

function parseHex(value) {
  const match = /^0x([0-9A-F]+)$/i.exec(String(value || ''));
  return match ? parseInt(match[1], 16) : null;
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const catalog = value.find(item => item?.id === id);
    if (catalog) return catalog;
  }
  return null;
}

function requireCatalog(mapData, id) {
  const catalog = findCatalog(mapData, id);
  if (!catalog) throw new Error(`Missing required catalog ${id}`);
  return catalog;
}

function findRam(mapData, address) {
  return (mapData.ram || []).find(entry => String(entry.address || '').toUpperCase() === address) || null;
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

function compactWrite(write, scriptByIndex) {
  const script = write.directIndexState === 'table_entry' ? scriptByIndex.get(write.directIndex) : null;
  return {
    line: write.line,
    callerLabel: write.callerLabel || null,
    callerOffset: write.callerOffset || null,
    directIndex: write.directIndex,
    directIndexState: write.directIndexState,
    sourceLine: write.sourceLine || null,
    sourceMode: write.sourceMode || 'dynamic',
    targetScript: script ? {
      index: script.index,
      targetOffset: script.pointerEntry?.targetOffset || null,
      parsedStart: script.range?.start || null,
      parsedEndExclusive: script.range?.endExclusive || null,
      endReason: script.endReason || null,
    } : null,
  };
}

function tailBoundaryForRegion(region, script) {
  const start = parseHex(region?.offset);
  const scriptEnd = parseHex(script?.range?.endExclusive);
  return {
    region: compactRegion(region),
    startsAfterPaletteParser: start != null && scriptEnd != null && start >= scriptEnd,
    distanceFromParsedEndBytes: start == null || scriptEnd == null ? null : start - scriptEnd,
  };
}

function buildCatalog(mapData) {
  const paletteCatalog = requireCatalog(mapData, paletteScriptCatalogId);
  requireCatalog(mapData, paletteTailLayoutCatalogId);
  requireCatalog(mapData, residualProofCatalogId);
  const scriptByIndex = new Map((paletteCatalog.scripts || []).map(script => [script.index, script]));
  const targetScript = scriptByIndex.get(targetIndex);
  if (!targetScript) throw new Error(`Missing palette script index ${targetIndex}`);

  const writes = (paletteCatalog.indexWrites || []).map(write => compactWrite(write, scriptByIndex));
  const targetWrites = writes.filter(write => write.directIndex === targetIndex && write.directIndexState === 'table_entry');
  const dynamicWrites = writes.filter(write => write.directIndexState === 'dynamic');
  const sentinelWrites = writes.filter(write => write.directIndexState === 'sentinel');
  const tableWrites = writes.filter(write => write.directIndexState === 'table_entry');
  const tailRegions = targetTailRegionIds.map(id => tailBoundaryForRegion(findRegion(mapData, id), targetScript));
  const allTailAfterParser = tailRegions.every(item => item.startsAfterPaletteParser);
  const status = targetWrites.length && allTailAfterParser
    ? 'entry_25_directly_selected_but_tail_not_consumed_by_palette_parser'
    : 'entry_25_selector_requires_followup';

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [paletteScriptCatalogId, paletteTailLayoutCatalogId, residualProofCatalogId],
    assetPolicy: 'Metadata only: RAM label, selector indices, ASM line numbers, script offsets, parser boundaries, region ids, and status counts. No ROM bytes, palette values, decoded colors, rendered pixels, screenshots, audio, or instruction bytes are embedded.',
    summary: {
      indexRam: '_RAM_CF65_',
      pointerTable: '_DATA_1C800_',
      totalWriterCount: writes.length,
      tableEntryWriterCount: tableWrites.length,
      dynamicWriterCount: dynamicWrites.length,
      sentinelWriterCount: sentinelWrites.length,
      targetIndex,
      targetScriptLabel,
      targetIndexDirectWriterCount: targetWrites.length,
      targetIndexWriterLines: targetWrites.map(write => write.line),
      targetScriptParsedStart: targetScript.range?.start || null,
      targetScriptParsedEndExclusive: targetScript.range?.endExclusive || null,
      targetScriptEndReason: targetScript.endReason || null,
      tailRegionCount: tailRegions.length,
      tailRegionsAfterParserCount: tailRegions.filter(item => item.startsAfterPaletteParser).length,
      writerStateCounts: countBy(writes, write => write.directIndexState),
      directIndexCounts: countBy(tableWrites, write => String(write.directIndex).padStart(2, '0')),
      status,
      persistedRomByteCount: 0,
      persistedPaletteByteCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
    },
    targetScript: {
      index: targetIndex,
      label: targetScriptLabel,
      pointerEntry: targetScript.pointerEntry || null,
      range: targetScript.range || null,
      endReason: targetScript.endReason || null,
      loopTarget: targetScript.loopTarget || null,
      directIndexWriteCount: targetScript.directIndexWriteCount || 0,
    },
    writers: writes,
    targetIndexWriters: targetWrites,
    dynamicWriters: dynamicWrites,
    sentinelWriters: sentinelWrites,
    tailRegions,
    evidence: [
      `${paletteScriptCatalogId} models _LABEL_10BC_ selecting _DATA_1C800_ through _RAM_CF65_.`,
      `Palette script index ${targetIndex} targets ${targetScriptLabel}; its parsed range ends at ${targetScript.range?.endExclusive || 'unknown'} with ${targetScript.endReason || 'unknown end reason'}.`,
      `The three quarantined tail regions ${targetTailRegionIds.join(', ')} all start after the parsed palette-script range.`,
      'This audit proves selector reachability for the parent script, not tail consumption; promotion still requires a consumer beyond the palette parser.',
    ],
    nextLeads: [
      'Runtime trace _RAM_CF65_ writers to identify scene/menu context for the direct entry-25 selector.',
      'Instrument _LABEL_10BC_ around the F0 jump in entry 25 and confirm execution returns to 0x1CAC9 rather than walking into r2815-r2817.',
      'Keep r2815-r2817 quarantined unless a non-palette parser consumer is found for 0x1CBB9-0x1CCBF.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  const ramEntry = findRam(mapData, '$CF65');
  if (ramEntry) {
    ramEntry.analysis = ramEntry.analysis || {};
    ramEntry.analysis.paletteCf65WriterAudit = {
      catalogId,
      kind: 'palette_script_selector_writer_index',
      status: catalog.summary.status,
      confidence: 'high_for_selector_reachability_medium_for_shared_ram_role',
      targetIndex,
      targetIndexDirectWriterCount: catalog.summary.targetIndexDirectWriterCount,
      targetIndexWriterLines: catalog.summary.targetIndexWriterLines,
      totalWriterCount: catalog.summary.totalWriterCount,
      dynamicWriterCount: catalog.summary.dynamicWriterCount,
      sentinelWriterCount: catalog.summary.sentinelWriterCount,
      summary: `_RAM_CF65_ has ${catalog.summary.targetIndexDirectWriterCount} direct static writer(s) selecting ${targetScriptLabel}; the parsed palette script still ends before the quarantined tail regions.`,
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
      generatedAt: now,
      tool: toolName,
    };
  }

  const annotatedTailRegions = [];
  for (const item of catalog.tailRegions) {
    const region = item.region ? findRegion(mapData, item.region.id) : null;
    if (!region) continue;
    region.analysis = region.analysis || {};
    region.analysis.paletteCf65WriterAudit = {
      catalogId,
      kind: 'palette_tail_selector_boundary_link',
      status: catalog.summary.status,
      confidence: 'medium',
      targetIndex,
      targetScriptLabel,
      targetIndexDirectWriterCount: catalog.summary.targetIndexDirectWriterCount,
      targetScriptParsedEndExclusive: catalog.summary.targetScriptParsedEndExclusive,
      startsAfterPaletteParser: item.startsAfterPaletteParser,
      distanceFromParsedEndBytes: item.distanceFromParsedEndBytes,
      summary: `${region.id} is after the parsed ${targetScriptLabel} palette script even though _RAM_CF65_ can directly select that parent script.`,
      evidence: catalog.evidence,
      generatedAt: now,
      tool: toolName,
    };
    annotatedTailRegions.push({
      id: region.id,
      offset: region.offset,
      startsAfterPaletteParser: item.startsAfterPaletteParser,
      distanceFromParsedEndBytes: item.distanceFromParsedEndBytes,
    });
  }
  return { ramAnnotated: Boolean(ramEntry), annotatedTailRegions };
}

function updateStaticMap(catalog) {
  if (!fs.existsSync(staticMapPath)) return;
  const staticMap = readJson(staticMapPath);
  staticMap.analyzedAt = now;
  staticMap.summary = staticMap.summary || {};
  staticMap.summary.paletteCf65WriterCatalog = catalogId;
  staticMap.summary.paletteCf65WriterTotalWriters = catalog.summary.totalWriterCount;
  staticMap.summary.paletteCf65WriterTargetIndex = targetIndex;
  staticMap.summary.paletteCf65WriterTargetIndexDirectWriters = catalog.summary.targetIndexDirectWriterCount;
  staticMap.summary.paletteCf65WriterTailRegionsAfterParser = catalog.summary.tailRegionsAfterParserCount;
  staticMap.primaryCatalogs = staticMap.primaryCatalogs || {};
  staticMap.primaryCatalogs.rendering = insertAfter(
    staticMap.primaryCatalogs.rendering,
    'world-runtime-ram-trace-seed-catalog-2026-06-26',
    catalogId
  );
  staticMap.nextLeads = (staticMap.nextLeads || []).filter(note => !note.includes(catalogId));
  staticMap.nextLeads.push('Use world-palette-cf65-writer-catalog-2026-06-26 to trace the direct _RAM_CF65_ entry-25 writer and prove runtime palette-tail boundaries for r2815-r2817.');
  writeJson(staticMapPath, staticMap);
}

function reportTailRegions(catalog) {
  return catalog.tailRegions.map(item => ({
    id: item.region?.id || null,
    offset: item.region?.offset || null,
    size: item.region?.size || 0,
    startsAfterPaletteParser: item.startsAfterPaletteParser,
    distanceFromParsedEndBytes: item.distanceFromParsedEndBytes,
  }));
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  let appliedAnnotations = { ramAnnotated: false, annotatedTailRegions: [] };

  if (apply) {
    appliedAnnotations = applyCatalog(mapData, catalog);
    mapData.paletteCatalogs = (mapData.paletteCatalogs || []).filter(item => item.id !== catalogId);
    mapData.paletteCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'palette_cf65_writer_audit',
      schemaVersion: 1,
      generatedAt: now,
      tool: `${toolName} --apply`,
      catalogId,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: {
        ...catalog.summary,
        ramAnnotated: appliedAnnotations.ramAnnotated,
        annotatedTailRegionCount: appliedAnnotations.annotatedTailRegions.length,
      },
      targetScript: catalog.targetScript,
      targetIndexWriters: catalog.targetIndexWriters,
      tailRegions: reportTailRegions(catalog),
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
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
      ramAnnotated: appliedAnnotations.ramAnnotated,
      annotatedTailRegionCount: appliedAnnotations.annotatedTailRegions.length,
    },
    targetIndexWriters: catalog.targetIndexWriters,
    tailRegions: reportTailRegions(catalog),
  }, null, 2));
}

main();
