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
const toolName = 'tools/world-item-vram-spawn-caller-audit.mjs';
const catalogId = 'world-item-vram-spawn-caller-catalog-2026-06-26';
const reportId = 'item-vram-spawn-caller-audit-2026-06-26';
const schemaVersion = 1;
const itemSelectorCatalogId = 'world-item-vram-selector-catalog-2026-06-26';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function findCatalog(mapData, id) {
  for (const value of Object.values(mapData)) {
    if (!Array.isArray(value)) continue;
    const found = value.find(item => item && item.id === id);
    if (found) return found;
  }
  return null;
}

function findRegionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function findRamByAddress(mapData, address) {
  return (mapData.ram || []).find(entry => String(entry.address || '').toUpperCase() === address.toUpperCase()) || null;
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

function compactRam(entry) {
  if (!entry) return null;
  return {
    id: entry.id || '',
    address: entry.address || '',
    size: Number(entry.size || 0),
    type: entry.type || 'unknown',
    name: entry.name || '',
  };
}

function buildCatalog(mapData) {
  const itemSelectorCatalog = findCatalog(mapData, itemSelectorCatalogId);
  const callerRegion = compactRegion(findRegionById(mapData, 'r1820'));
  const ramRefs = {
    pendingRewardObjectId: compactRam(findRamByAddress(mapData, '$D025')),
    pendingSpawnX: compactRam(findRamByAddress(mapData, '$D026')),
    pendingSpawnY: compactRam(findRamByAddress(mapData, '$D028')),
    pendingSpawnDirection: compactRam(findRamByAddress(mapData, '$D029')),
    itemVramDestination: compactRam(findRamByAddress(mapData, '$D02A')),
    slotTileBaseScratch: compactRam(findRamByAddress(mapData, '$D0FE')),
  };

  const slotConfigurations = [
    {
      slotIndex: 0,
      ixBase: '_RAM_C340_',
      destinationVramAddress: '0x0480',
      tileBase: '0x24',
      setupLines: [13607, 13608, 13609, 13610, 13611, 13612],
      role: 'first_reward_object_slot',
    },
    {
      slotIndex: 1,
      ixBase: '_RAM_C380_',
      destinationVramAddress: '0x0500',
      tileBase: '0x28',
      setupLines: [13613, 13614, 13615, 13616, 13617, 13618],
      role: 'second_reward_object_slot',
    },
  ];

  const formulas = [
    {
      id: 'pending_reward_id_to_item_vram_selector',
      expression: 'itemVramSelectorId = _RAM_D025_ & 0x7F',
      target: '_LABEL_1BE0_ input A',
      confidence: 'high',
      evidenceLines: [13626, 13629, 13654, 13655, 13656],
    },
    {
      id: 'pending_reward_id_to_animation_child_selector',
      expression: 'animationChildSelector = (_RAM_D025_ & 0x70) >> 4',
      target: 'IX+15',
      confidence: 'high',
      evidenceLines: [13629, 13630, 13631, 13632, 13633, 13634, 13635],
    },
    {
      id: 'reward_animation_root_selector',
      expression: 'animationRootSelector = 0x05',
      target: 'IX+14',
      confidence: 'high',
      evidenceLines: [13636],
    },
    {
      id: 'item_vram_destination_by_slot',
      expression: '_RAM_D02A_ = 0x0480 for _RAM_C340_, 0x0500 for _RAM_C380_',
      target: '_LABEL_99B_ destination DE via _LABEL_1BE0_',
      confidence: 'high',
      evidenceLines: [13607, 13608, 13609, 13613, 13614, 13615, 4998, 4999],
    },
    {
      id: 'pending_reward_clear_after_two_slots',
      expression: '_RAM_D025_ = 0xFF after both reward object slots are serviced',
      target: '_RAM_D025_ pending object id',
      confidence: 'high',
      evidenceLines: [13619, 13620, 13621],
    },
  ];

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [itemSelectorCatalogId],
    summary: {
      itemSelectorCatalogPresent: Boolean(itemSelectorCatalog),
      callerLabel: '_LABEL_5C4A_',
      callerRegionId: callerRegion?.id || '',
      itemSelectorCallCount: 1,
      itemSelectorCallLine: 13656,
      slotConfigurationCount: slotConfigurations.length,
      formulaCount: formulas.length,
      ramRefCount: Object.values(ramRefs).filter(Boolean).length,
      acceptedItemVramSelectorRangeFromCallee: itemSelectorCatalog?.summary?.itemIdAcceptedRange || 'unknown',
      rejectedSelectorThresholdFromCallee: itemSelectorCatalog?.summary?.itemIdRejectsAtOrAbove || 'unknown',
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
      assetPolicy: 'Metadata only: labels, RAM symbols, field formulas, line numbers, slot destinations, and catalog links. No ROM bytes, decoded graphics, screenshots, audio, or rendered assets are embedded.',
    },
    caller: {
      label: '_LABEL_5C4A_',
      region: callerRegion,
      role: 'reward_object_slot_pair_dispatcher_feeding_item_vram_selector',
      confidence: 'high',
      itemSelectorCall: {
        target: '_LABEL_1BE0_',
        line: 13656,
        inputExpression: '(IX+62) & 0x7F, where IX+62 was copied from _RAM_D025_',
      },
      slotConfigurations,
      formulas,
      ramRefs,
    },
    evidence: [
      'ASM lines 13607-13618 configure two reward/object slots with distinct IX bases, VRAM destinations, and tile bases.',
      'ASM lines 13626-13636 copy _RAM_D025_ into IX+62, derive IX+15 from bits 4-6, and set animation root IX+14 to 0x05.',
      'ASM lines 13654-13656 pass (IX+62 & 0x7F) as A to _LABEL_1BE0_, connecting pending reward/object ids to item VRAM loader selection.',
      'ASM lines 13619-13621 clear _RAM_D025_ to 0xFF after both reward/object slots are serviced.',
      `${itemSelectorCatalogId} supplies the downstream _LABEL_1BE0_ selector and _LABEL_99B_ loader record decoding.`,
      'No ROM bytes, decoded graphics, screenshots, audio, or rendered assets are stored.',
    ],
    nextLeads: [
      'Trace writers of _RAM_D025_ to enumerate concrete reward/object ids that can trigger item VRAM uploads.',
      'Link IX+14=0x05 and IX+15 derived from _RAM_D025_ to animation frame families for reward object sprites.',
      'Use _RAM_D02A_ destination metadata when adding VRAM slot provenance for item/reward object tiles.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const changedRegions = [];
  const changedRam = [];
  const region = findRegionById(mapData, 'r1820');
  if (region) {
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.itemVramSpawnCallerAudit = {
        catalogId,
        kind: 'reward_object_spawn_caller_feeds_item_vram_selector',
        confidence: 'high',
        summary: 'Maps _RAM_D025_ pending reward/object id into _LABEL_1BE0_ item VRAM selector input and _RAM_D02A_ destination slots.',
        detail: catalog.caller,
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRegions.push({
      id: region.id,
      offset: region.offset,
      type: region.type,
      name: region.name || '',
      role: 'reward_object_spawn_caller_feeds_item_vram_selector',
      confidence: 'high',
    });
  }

  const ramRoles = [
    ['$D025', 'pending_reward_object_id_feeds_item_vram_selector'],
    ['$D026', 'pending_reward_spawn_x_copied_to_object_slot'],
    ['$D028', 'pending_reward_spawn_y_copied_to_object_slot'],
    ['$D029', 'pending_reward_spawn_direction_copied_to_object_slot'],
    ['$D02A', 'item_vram_destination_address_for_label_99b'],
    ['$D0FE', 'reward_object_tile_base_scratch'],
  ];
  for (const [address, role] of ramRoles) {
    const entry = findRamByAddress(mapData, address);
    if (!entry) continue;
    if (apply) {
      entry.analysis = entry.analysis || {};
      entry.analysis.itemVramSpawnCallerAudit = {
        catalogId,
        kind: role,
        confidence: 'high',
        summary: `RAM ${address} participates in _LABEL_5C4A_ reward/object spawn setup for item VRAM uploads.`,
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRam.push({
      id: entry.id,
      address: entry.address,
      name: entry.name || '',
      role,
      confidence: 'high',
    });
  }

  return { changedRegions, changedRam };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  const annotation = annotateMap(mapData, catalog);

  if (apply) {
    mapData.itemDataCatalogs = (mapData.itemDataCatalogs || []).filter(item => item.id !== catalogId);
    mapData.itemDataCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'item_vram_spawn_caller_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: {
        ...catalog.summary,
        changedRegionCount: annotation.changedRegions.length,
        changedRamCount: annotation.changedRam.length,
      },
      changedRegions: annotation.changedRegions,
      changedRam: annotation.changedRam,
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
      changedRamCount: annotation.changedRam.length,
    },
    changedRegions: annotation.changedRegions,
    changedRam: annotation.changedRam,
  }, null, 2));
}

main();
