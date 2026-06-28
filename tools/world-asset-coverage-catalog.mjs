#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const apply = process.argv.includes('--apply');
const now = '2026-06-25T00:00:00Z';
const catalogId = 'world-asset-coverage-catalog-2026-06-25';
const reportId = 'asset-coverage-audit-2026-06-25';
const toolName = 'tools/world-asset-coverage-catalog.mjs';

const assetFamilies = [
  {
    id: 'background_graphics_and_tilemaps',
    label: 'Background graphics and tilemaps',
    types: ['gfx_tiles', 'tile_map', 'screen_prog', 'screen_prog_table', 'vram_loader_8fb', 'vram_loader_998', 'dynamic_tile_loader', 'vdp_stream'],
  },
  {
    id: 'palettes',
    label: 'Palettes',
    types: ['palette', 'palette_script', 'palette_script_table'],
  },
  {
    id: 'rooms_and_world_structure',
    label: 'Rooms and world structure',
    types: ['room_data', 'room_subrecord', 'room_seq_table', 'item_data', 'input_script'],
  },
  {
    id: 'sprites_entities_and_animation',
    label: 'Sprites, entities, and animation',
    types: ['meta_sprite', 'entity_anim_script', 'entity_anim_table', 'entity_data', 'entity_behavior_table', 'effect_script'],
  },
  {
    id: 'audio_music_and_sound_driver_data',
    label: 'Audio, music, and sound-driver data',
    types: ['music', 'audio_driver_data'],
  },
  {
    id: 'text_pointer_and_support_data',
    label: 'Text, pointer, and support data',
    types: ['text', 'pointer_table', 'data_table'],
  },
];

const fmtHex = (value, width = 5) => `0x${value.toString(16).toUpperCase().padStart(width, '0')}`;

function parseHex(value) {
  if (typeof value === 'number') return value;
  const match = String(value || '').match(/^(?:0x|\$)?([0-9a-f]+)$/i);
  return match ? parseInt(match[1], 16) : null;
}

function bankForOffset(offset) {
  return Math.floor(offset / 0x4000);
}

function regionEvidence(region) {
  const analysisKeys = Object.keys(region.analysis || {}).sort();
  return {
    regionId: region.id || '',
    type: region.type || '',
    offset: typeof region.offset === 'string' ? region.offset : fmtHex(region.offset || 0),
    size: region.size || 0,
    name: region.name || '',
    analysisKeyCount: analysisKeys.length,
    analysisKeys: analysisKeys.slice(0, 6),
  };
}

function summarizeRegions(regions) {
  const regionCount = regions.length;
  const bytes = regions.reduce((sum, region) => sum + (region.size || 0), 0);
  const byType = new Map();
  const byBank = new Map();
  let analysisBackedRegionCount = 0;

  for (const region of regions) {
    const type = region.type || 'untyped';
    byType.set(type, (byType.get(type) || 0) + 1);
    const offset = parseHex(region.offset);
    const bank = offset == null ? 'unknown' : String(bankForOffset(offset)).padStart(2, '0');
    const currentBank = byBank.get(bank) || { regionCount: 0, bytes: 0, types: {} };
    currentBank.regionCount++;
    currentBank.bytes += region.size || 0;
    currentBank.types[type] = (currentBank.types[type] || 0) + 1;
    byBank.set(bank, currentBank);
    if (region.analysis && Object.keys(region.analysis).length) analysisBackedRegionCount++;
  }

  return {
    regionCount,
    bytes,
    analysisBackedRegionCount,
    byType: Object.fromEntries([...byType.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    byBank: Object.fromEntries([...byBank.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    evidenceSamples: regions
      .slice()
      .sort((a, b) => (parseHex(a.offset) ?? 0) - (parseHex(b.offset) ?? 0))
      .slice(0, 12)
      .map(regionEvidence),
  };
}

function buildCatalog(mapData) {
  const regions = mapData.regions || [];
  const typeToFamily = new Map();
  for (const family of assetFamilies) {
    for (const type of family.types) typeToFamily.set(type, family.id);
  }

  const familyRegions = new Map(assetFamilies.map(family => [family.id, []]));
  const nonAssetTypeCounts = new Map();
  for (const region of regions) {
    const familyId = typeToFamily.get(region.type || '');
    if (familyId) familyRegions.get(familyId).push(region);
    else nonAssetTypeCounts.set(region.type || 'untyped', (nonAssetTypeCounts.get(region.type || 'untyped') || 0) + 1);
  }

  const families = assetFamilies.map(family => {
    const familyRegionList = familyRegions.get(family.id) || [];
    return {
      id: family.id,
      label: family.label,
      mappedTypes: family.types,
      ...summarizeRegions(familyRegionList),
      evidence: [
        'Derived only from projects/WORLD/map.json region ids, offsets, sizes, types, names, and existing analysis-key presence.',
        'No ROM bytes, decoded graphics, music streams, screen pixels, coordinates, or generated assets are embedded.',
      ],
    };
  });

  const totalAssetRegions = families.reduce((sum, family) => sum + family.regionCount, 0);
  const totalAssetBytes = families.reduce((sum, family) => sum + family.bytes, 0);
  const totalAnalysisBackedAssetRegions = families.reduce((sum, family) => sum + family.analysisBackedRegionCount, 0);
  const unmappedAssetFamilyCount = families.filter(family => family.regionCount === 0).length;

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    source: {
      map: 'projects/WORLD/map.json',
      regionCount: regions.length,
      schemaVersion: mapData.schemaVersion,
      romSizeBytes: mapData.romSizeBytes,
      romMD5: mapData.romMD5,
    },
    assetPolicy: 'Metadata only: region ids, offsets, sizes, types, counts, bank summaries, and analysis-key names. No ROM bytes, decoded assets, pixels, samples, or coordinates are embedded.',
    semantics: {
      classification: 'This catalog groups already-mapped region types into asset families; it does not introduce new byte classification claims.',
      evidenceRule: 'Each family summary carries source region ids and offsets as evidence back to map.json regions.',
      excludedTypes: 'code and null are intentionally excluded from asset totals; pointer/data support regions are grouped separately when already typed as pointer_table, data_table, or text.',
    },
    summary: {
      familyCount: families.length,
      unmappedAssetFamilyCount,
      totalAssetRegions,
      totalAssetBytes,
      totalAnalysisBackedAssetRegions,
      totalAssetAnalysisBackedPercent: totalAssetRegions ? Number(((totalAnalysisBackedAssetRegions / totalAssetRegions) * 100).toFixed(2)) : 0,
      nonAssetTypeCounts: Object.fromEntries([...nonAssetTypeCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    },
    families,
    nextLeads: [
      'Promote family-level counts into analyzer filters so asset classes can be browsed by bank and region type.',
      'Cross-link audio_music_and_sound_driver_data entries to stream graph/request metadata so music/SFX assets have consumer references.',
      'Cross-link sprites_entities_and_animation entries to dynamic tile upload and animation frame coverage catalogs to expose remaining frame trace gaps.',
    ],
  };
}

function applyCatalog(catalog) {
  const mapData = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  mapData.assetCoverageCatalogs = (mapData.assetCoverageCatalogs || []).filter(item => item.id !== catalog.id);
  mapData.assetCoverageCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'asset_coverage_audit',
    schemaVersion: 1,
    generatedAt: now,
    tool: `${toolName} --apply`,
    sourceCatalogs: [catalog.id],
    summary: catalog.summary,
    evidence: [
      'Catalog was generated from existing projects/WORLD/map.json region metadata.',
      'Family evidence samples list region ids, offsets, types, and analysis-key counts.',
    ],
    nextLeads: catalog.nextLeads,
  });
  fs.writeFileSync(mapPath, `${JSON.stringify(mapData, null, 2)}\n`);
}

const mapData = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
const catalog = buildCatalog(mapData);
if (apply) applyCatalog(catalog);

console.log(JSON.stringify({
  applied: apply,
  id: catalog.id,
  summary: catalog.summary,
  families: catalog.families.map(family => ({
    id: family.id,
    regionCount: family.regionCount,
    bytes: family.bytes,
    analysisBackedRegionCount: family.analysisBackedRegionCount,
    byType: family.byType,
  })),
}, null, 2));
