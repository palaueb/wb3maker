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
const reportId = 'stale-screen-prog-metadata-audit-2026-06-25';

const staleKeys = ['screenProgAudit', 'screenProgReachabilityAudit'];
const activeRenderParamKeys = ['screenProg', 'format', 'loaderFormat', 'palRegionId', 'bank', 'overrideBank'];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function staleCandidates(mapData) {
  return (mapData.regions || [])
    .map(region => {
      if ((region.type || 'unknown') === 'screen_prog') return null;
      const presentKeys = staleKeys.filter(key => region.analysis?.[key]);
      if (!presentKeys.length) return null;
      return {
        id: region.id,
        offset: region.offset,
        size: region.size || 0,
        type: region.type || 'unknown',
        name: region.name || '',
        presentKeys,
        removedSummaries: presentKeys.map(key => ({
          key,
          catalogId: region.analysis[key]?.catalogId || '',
          kind: region.analysis[key]?.kind || '',
          confidence: region.analysis[key]?.confidence || '',
          summary: region.analysis[key]?.summary || '',
        })),
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
    region.analysis = region.analysis || {};
    const removedSummaries = [];
    for (const key of candidate.presentKeys) {
      const entry = region.analysis[key];
      removedSummaries.push({
        key,
        catalogId: entry?.catalogId || '',
        kind: entry?.kind || '',
        confidence: entry?.confidence || '',
        summary: entry?.summary || '',
      });
      delete region.analysis[key];
    }
    region.analysis.staleScreenProgMetadataAudit = {
      reportId,
      kind: 'removed_generated_screen_prog_metadata_from_non_screen_region',
      confidence: 'high',
      currentType: region.type || 'unknown',
      removedKeys: candidate.presentKeys,
      removedSummaries,
      summary: 'Removed stale generated screen-program analysis from a region whose current semantic type is not screen_prog.',
      evidence: [
        `Current region type is ${region.type || 'unknown'}, not screen_prog.`,
        'The active screenProgCatalogs are regenerated from regions currently typed screen_prog.',
        'The removed entries were generated decoder/reachability metadata and are summarized here without retaining the stale claim.',
      ],
      generatedAt: now,
      tool: 'tools/world-stale-screen-prog-metadata-audit.mjs',
    };
    scrubbed.push({
      id: region.id,
      offset: region.offset,
      size: region.size || 0,
      type: region.type || 'unknown',
      removedKeys: candidate.presentKeys,
    });
  }
  return scrubbed;
}

function staleActiveParamCandidates(mapData) {
  return (mapData.regions || [])
    .map(region => {
      if ((region.type || 'unknown') === 'screen_prog') return null;
      const existing = region.analysis?.staleActiveScreenProgParamQuarantine;
      const hasActiveScreenProgParam = Boolean(region.params?.screenProg);
      if (!hasActiveScreenProgParam && existing?.reportId !== reportId) return null;
      if (hasActiveScreenProgParam && !region.analysis?.staleScreenProgMetadataAudit) return null;
      const activeKeys = activeRenderParamKeys.filter(key => region.params?.[key] !== undefined);
      return {
        id: region.id,
        offset: region.offset,
        size: region.size || 0,
        type: region.type || 'unknown',
        name: region.name || '',
        activeKeys: activeKeys.length ? activeKeys : existing?.removedParamKeys || [],
      };
    })
    .filter(Boolean);
}

function quarantineActiveParams(mapData, candidates) {
  const byId = new Map(candidates.map(candidate => [candidate.id, candidate]));
  const quarantined = [];
  for (const region of mapData.regions || []) {
    const candidate = byId.get(region.id);
    if (!candidate) continue;
    region.analysis = region.analysis || {};
    const activeParams = {};
    for (const key of activeRenderParamKeys) {
      if (region.params?.[key] !== undefined) activeParams[key] = region.params[key];
    }
    const existing = region.analysis.staleActiveScreenProgParamQuarantine;
    if (Object.keys(activeParams).length) {
      region.analysis.staleActiveScreenProgParamQuarantine = {
        reportId,
        kind: 'quarantined_active_render_params_from_non_screen_region',
        confidence: 'high',
        currentType: region.type || 'unknown',
        removedParamKeys: Object.keys(activeParams).map(key => `params.${key}`),
        quarantinedParams: activeParams,
        summary: 'Quarantined active render params from a region already proven not to be a screen_prog root.',
        evidence: [
          `Current region type is ${region.type || 'unknown'}, not screen_prog.`,
          'This region already carries staleScreenProgMetadataAudit evidence from generated screen-program metadata cleanup.',
          'The active params are preserved under this quarantine entry and removed from params so analyzer UI does not consume them as live render inputs.',
        ],
        generatedAt: now,
        tool: 'tools/world-stale-screen-prog-metadata-audit.mjs',
      };
      for (const key of Object.keys(activeParams)) delete region.params[key];
      if (!Object.keys(region.params).length) delete region.params;
    }
    quarantined.push({
      id: region.id,
      offset: region.offset,
      size: region.size || 0,
      type: region.type || 'unknown',
      removedParamKeys: Object.keys(activeParams).length
        ? Object.keys(activeParams).map(key => `params.${key}`)
        : existing?.removedParamKeys || candidate.activeKeys.map(key => `params.${key}`),
    });
  }
  return quarantined;
}

function main() {
  const mapData = readJson(mapPath);
  const candidates = staleCandidates(mapData);
  const paramCandidates = staleActiveParamCandidates(mapData);
  const scrubbed = apply ? applyScrub(mapData, candidates) : candidates;
  const quarantinedActiveParams = apply ? quarantineActiveParams(mapData, paramCandidates) : paramCandidates;
  const summary = {
    candidateRegions: candidates.length,
    scrubbedRegions: scrubbed.length,
    activeRenderParamCandidateRegions: paramCandidates.length,
    quarantinedActiveRenderParamRegions: quarantinedActiveParams.length,
    affectedBytes: candidates.reduce((sum, candidate) => sum + candidate.size, 0),
    removedScreenProgAuditCount: candidates.filter(candidate => candidate.presentKeys.includes('screenProgAudit')).length,
    removedScreenProgReachabilityAuditCount: candidates.filter(candidate => candidate.presentKeys.includes('screenProgReachabilityAudit')).length,
    assetPolicy: 'Metadata cleanup only: removes stale generated screen-program claims from non-screen regions and stores compact summaries. No ROM bytes or decoded assets are embedded.',
  };

  if (apply) {
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'stale_screen_prog_metadata_audit',
      generatedAt: now,
      tool: 'tools/world-stale-screen-prog-metadata-audit.mjs --apply',
      schemaVersion: 1,
      summary,
      scrubbedRegions: scrubbed,
      quarantinedActiveParams,
      nextLeads: [
        'Keep screenProgAudit and screenProgReachabilityAudit scoped to active screen_prog regions only.',
        'When retyping false screen-program candidates, preserve replacement evidence in the semantic audit that performs the retype.',
        'Only quarantine params.screenProg when the region already has stale-screen-program evidence or a stronger replacement classification.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    reportId,
    summary,
    candidates: scrubbed.slice(0, 120).map(candidate => ({
      id: candidate.id,
      offset: candidate.offset,
      size: candidate.size,
      type: candidate.type,
      removedKeys: candidate.presentKeys || candidate.removedKeys,
    })),
    activeRenderParamCandidates: quarantinedActiveParams.slice(0, 120).map(candidate => ({
      id: candidate.id,
      offset: candidate.offset,
      size: candidate.size,
      type: candidate.type,
      removedParamKeys: candidate.activeKeys?.map(key => `params.${key}`) || candidate.removedParamKeys,
    })),
    remainingCandidateRegions: apply ? staleCandidates(mapData).length : candidates.length,
    remainingActiveRenderParamCandidates: apply ? staleActiveParamCandidates(mapData).filter(candidate => {
      const region = (mapData.regions || []).find(item => item.id === candidate.id);
      return Boolean(region?.params?.screenProg);
    }).length : paramCandidates.length,
  }, null, 2));
}

main();
