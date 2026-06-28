#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const playerPhysicsModulePath = path.join(repoRoot, 'shared/wb3/player-physics.js');
const collisionModulePath = path.join(repoRoot, 'shared/wb3/collision.js');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const readinessCatalogId = 'world-player-physics-engine-readiness-catalog-2026-06-26';
const catalogId = 'world-player-physics-pure-helper-module-catalog-2026-06-26';
const reportId = 'player-physics-pure-helper-module-audit-2026-06-26';
const toolName = 'tools/world-player-physics-pure-helper-module-audit.mjs';
const schemaVersion = 1;

const extractionMap = [
  {
    label: '_LABEL_141F_',
    role: 'collision_tile_lookup_cb00',
    moduleTarget: 'shared/wb3/collision.js',
    exports: ['collisionBufferIndex', 'lookupCollisionTile'],
  },
  {
    label: '_LABEL_19B6_',
    role: 'coordinate_b_velocity_accel_clamp',
    moduleTarget: 'shared/wb3/player-physics.js',
    exports: ['applyCoordinateBVelocityAccelClamp', 'coordinateBGravityStep'],
  },
  {
    label: '_LABEL_1A28_',
    role: 'coordinate_b_motion_accel_wrapper',
    moduleTarget: 'shared/wb3/player-physics.js',
    exports: ['applyCoordinateBMotionAccel', 'applySignedByteAcceleration', 'motionAccelClampLimit'],
  },
  {
    label: '_LABEL_1A36_',
    role: 'coordinate_a_motion_accel_wrapper',
    moduleTarget: 'shared/wb3/player-physics.js',
    exports: ['applyCoordinateAMotionAccel', 'applySignedByteAcceleration', 'motionAccelClampLimit'],
  },
  {
    label: '_LABEL_1AB6_',
    role: 'coordinate_a_motion_damping',
    moduleTarget: 'shared/wb3/player-physics.js',
    exports: ['coordinateADampingStep', 'dampCoordinateAMotion', 'dampSignedWordTowardZero'],
  },
  {
    label: '_LABEL_1AFF_',
    role: 'coordinate_b_motion_damping',
    moduleTarget: 'shared/wb3/player-physics.js',
    exports: ['dampCoordinateBMotion', 'dampSignedWordTowardZero'],
  },
  {
    label: '_LABEL_1B25_',
    role: 'packed_motion_integrator_coordinate_b',
    moduleTarget: 'shared/wb3/player-physics.js',
    exports: ['applyPackedCoordinateBIntegrator', 'integratePackedMotion', 'packedNibbleMotionDelta'],
  },
  {
    label: '_LABEL_1B4B_',
    role: 'packed_motion_integrator_coordinate_a',
    moduleTarget: 'shared/wb3/player-physics.js',
    exports: ['applyPackedCoordinateAIntegrator', 'integratePackedMotion', 'packedNibbleMotionDelta'],
  },
];

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

function requireCatalog(mapData, id) {
  const catalog = findCatalog(mapData, id);
  if (!catalog) throw new Error(`Missing required catalog ${id}`);
  return catalog;
}

function findRegionByLabel(mapData, label) {
  return (mapData.regions || []).find(region => {
    const analysis = region.analysis || {};
    return analysis.playerPhysicsEngineReadinessAudit?.label === label
      || analysis.playerPhysicsStateEffectAudit?.label === label
      || region.name?.includes(label);
  }) || null;
}

function countBy(items, keyFn) {
  return items.reduce((counts, item) => {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

async function exportedNames(modulePath) {
  const module = await import(pathToFileURL(modulePath).href);
  return Object.keys(module).sort();
}

function readinessByLabel(readinessCatalog) {
  return new Map((readinessCatalog.effects || []).map(effect => [effect.label, effect]));
}

async function buildCatalog(mapData) {
  const readinessCatalog = requireCatalog(mapData, readinessCatalogId);
  const readinessMap = readinessByLabel(readinessCatalog);
  const playerExports = await exportedNames(playerPhysicsModulePath);
  const collisionExports = await exportedNames(collisionModulePath);
  const exportsByModule = {
    'shared/wb3/player-physics.js': playerExports,
    'shared/wb3/collision.js': collisionExports,
  };

  const extractedEffects = extractionMap.map(item => {
    const readiness = readinessMap.get(item.label);
    const region = findRegionByLabel(mapData, item.label);
    const missingExports = item.exports.filter(name => !exportsByModule[item.moduleTarget]?.includes(name));
    return {
      ...item,
      region: region ? {
        id: region.id,
        offset: region.offset,
        size: region.size || 0,
        type: region.type || '',
        name: region.name || '',
      } : null,
      readiness: readiness ? {
        catalogId: readinessCatalogId,
        engineReadiness: readiness.engineReadiness,
        readinessConfidence: readiness.readinessConfidence,
        flowUsage: readiness.flowUsage,
      } : null,
      extractionStatus: readiness?.engineReadiness === 'ready_for_pure_helper_extraction' && !missingExports.length
        ? 'extracted_from_ready_pure_helper'
        : 'extraction_metadata_needs_review',
      missingExports,
      evidence: [
        `${readinessCatalogId} marks ${item.label} as ${readiness?.engineReadiness || 'missing_readiness'}.`,
        `${item.moduleTarget} exports ${item.exports.join(', ')} for the extracted pure helper surface.`,
        'tools/world-player-physics-helper-smoke.mjs validates the helper surface with synthetic values only.',
      ],
    };
  });

  return {
    id: catalogId,
    schemaVersion,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [readinessCatalogId],
    sourceFiles: [
      'shared/package.json',
      'shared/wb3/player-physics.js',
      'shared/wb3/collision.js',
      'tools/world-player-physics-helper-smoke.mjs',
    ],
    assetPolicy: 'Metadata and engine helper code only. The extracted modules contain arithmetic/control semantics and no ROM bytes, decoded graphics, music, sound samples, tables, or copyrighted asset payloads.',
    summary: {
      extractedEffectCount: extractedEffects.length,
      extractedModuleCount: new Set(extractedEffects.map(effect => effect.moduleTarget)).size,
      moduleEffectCounts: countBy(extractedEffects, effect => effect.moduleTarget),
      statusCounts: countBy(extractedEffects, effect => effect.extractionStatus),
      missingExportCount: extractedEffects.reduce((sum, effect) => sum + effect.missingExports.length, 0),
      readyPureHelperCoverage: {
        readyPureHelperCount: readinessCatalog.summary?.readyPureHelperCount || 0,
        extractedReadyPureHelperCount: extractedEffects.filter(effect => effect.extractionStatus === 'extracted_from_ready_pure_helper').length,
      },
      persistedRomByteCount: 0,
      persistedHashCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
    },
    modules: [
      {
        path: 'shared/wb3/player-physics.js',
        exports: playerExports,
        extractedEffectLabels: extractedEffects.filter(effect => effect.moduleTarget === 'shared/wb3/player-physics.js').map(effect => effect.label),
      },
      {
        path: 'shared/wb3/collision.js',
        exports: collisionExports,
        extractedEffectLabels: extractedEffects.filter(effect => effect.moduleTarget === 'shared/wb3/collision.js').map(effect => effect.label),
      },
    ],
    extractedEffects,
    evidence: [
      `${readinessCatalogId} provides the readiness gate for pure helper extraction.`,
      'The helper modules were smoke-tested with tools/world-player-physics-helper-smoke.mjs using synthetic values.',
      'No ROM-derived byte arrays, decoded assets, screenshots, hashes, music streams, or instruction-byte payloads are stored.',
    ],
    nextLeads: [
      'Add unit tests around every edge case in _LABEL_19B6_, _LABEL_1A28_/_LABEL_1A36_, and the packed nibble integrator.',
      'Do not port _LABEL_1446_ until runtime traces confirm coordinate axis naming and collision-buffer provenance in live rooms.',
      'Use the extracted pure helpers as dependencies for later frame-traced player-state modules.',
    ],
  };
}

function annotateMap(mapData, catalog) {
  const changedRegions = [];
  const missingRegions = [];
  for (const effect of catalog.extractedEffects) {
    const region = effect.region?.id
      ? (mapData.regions || []).find(item => item.id === effect.region.id)
      : null;
    if (!region) {
      missingRegions.push({ label: effect.label, role: effect.role, moduleTarget: effect.moduleTarget });
      continue;
    }
    if (apply) {
      region.analysis = region.analysis || {};
      region.analysis.playerPhysicsPureHelperModuleAudit = {
        catalogId,
        kind: 'player_physics_pure_helper_module_extraction',
        label: effect.label,
        role: effect.role,
        moduleTarget: effect.moduleTarget,
        exports: effect.exports,
        extractionStatus: effect.extractionStatus,
        confidence: effect.readiness?.readinessConfidence || 'medium',
        readiness: effect.readiness,
        evidence: effect.evidence,
        generatedAt: now,
        tool: toolName,
      };
    }
    changedRegions.push({
      id: region.id,
      offset: region.offset,
      label: effect.label,
      moduleTarget: effect.moduleTarget,
      exports: effect.exports,
      extractionStatus: effect.extractionStatus,
    });
  }
  return { changedRegions, missingRegions };
}

async function main() {
  const mapData = readJson(mapPath);
  const catalog = await buildCatalog(mapData);
  const annotations = annotateMap(mapData, catalog);

  if (apply) {
    mapData.engineModuleCatalogs = (mapData.engineModuleCatalogs || []).filter(item => item.id !== catalogId);
    mapData.engineModuleCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'player_physics_pure_helper_module_audit',
      generatedAt: now,
      schemaVersion,
      tool: `${toolName} --apply`,
      sourceCatalogs: catalog.sourceCatalogs,
      sourceFiles: catalog.sourceFiles,
      summary: {
        ...catalog.summary,
        annotatedRegions: annotations.changedRegions.length,
        missingRegions: annotations.missingRegions.length,
      },
      changedRegions: annotations.changedRegions,
      missingRegions: annotations.missingRegions,
      evidence: catalog.evidence,
      nextLeads: catalog.nextLeads,
      assetPolicy: catalog.assetPolicy,
    });
    fs.writeFileSync(mapPath, `${JSON.stringify(mapData, null, 2)}\n`);
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    modules: catalog.modules,
    changedRegions: annotations.changedRegions,
    missingRegions: annotations.missingRegions,
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
