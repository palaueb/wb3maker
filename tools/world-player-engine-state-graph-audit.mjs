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
const catalogId = 'world-player-engine-state-graph-catalog-2026-06-25';
const reportId = 'player-engine-state-graph-audit-2026-06-25';
const toolName = 'tools/world-player-engine-state-graph-audit.mjs';

const sourceIds = [
  'world-player-state-physics-flow-catalog-2026-06-25',
  'world-player-struct-catalog-2026-06-25',
  'world-player-physics-state-effect-catalog-2026-06-25',
  'world-player-runtime-routine-catalog-2026-06-25',
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function requirePlayerCatalog(mapData, id) {
  const catalog = (mapData.playerCatalogs || []).find(item => item.id === id)
    || (mapData.playerRuntimeCatalogs || []).find(item => item.id === id);
  if (!catalog) throw new Error(`Missing required player catalog ${id}`);
  return catalog;
}

function parseDollarByte(value) {
  if (typeof value !== 'string' || !/^\$[0-9a-f]{1,2}$/i.test(value)) return null;
  return parseInt(value.slice(1), 16);
}

function mechanicGroup(flow) {
  const text = `${flow.flowId || ''} ${flow.role || ''} ${flow.summary || ''}`.toLowerCase();
  if (String(flow.flowId || '').startsWith('vector_substate_')) return 'vector_substate';
  if (text.includes('damage') || text.includes('knockback')) return 'damage_knockback';
  if (text.includes('room-transition') || text.includes('room transition')) return 'room_transition';
  if (text.includes('vector restore')) return 'vector_restore';
  if (text.includes('vector transition') || text.includes('vector extra') || text.includes('vector jump') || text.includes('extra_vector') || text.includes('extra state-8')) return 'vector_motion';
  if (text.includes('jump') || text.includes('fall') || text.includes('airborne')) return 'airborne_motion';
  if (text.includes('grounded') || text.includes('idle')) return 'grounded_motion';
  if (text.includes('action') || text.includes('attack')) return 'action_attack';
  return 'player_state';
}

function unique(items) {
  return [...new Set((items || []).filter(Boolean))];
}

function buildTargetFlowIndex(flows) {
  const byState = new Map();
  for (const flow of flows || []) {
    if (!Number.isInteger(flow.stateSlot)) continue;
    if (!byState.has(flow.stateSlot)) byState.set(flow.stateSlot, []);
    byState.get(flow.stateSlot).push(flow.flowId);
  }
  return byState;
}

function compactPhysicsCalls(flow) {
  return (flow.uniquePhysicsEffects || []).map(effect => ({
    label: effect.label || '',
    role: effect.role || '',
    category: effect.category || '',
  }));
}

function buildEdges(flow, byState) {
  const edges = [];
  for (const target of flow.transitionTargets || []) {
    const value = parseDollarByte(target);
    if (value == null) continue;
    const targetStateSlot = value & 0x7F;
    edges.push({
      fromFlowId: flow.flowId,
      fromStateSlot: Number.isInteger(flow.stateSlot) ? flow.stateSlot : null,
      targetValue: target,
      targetStateSlot,
      entryFlagSet: Boolean(value & 0x80),
      possibleTargetFlowIds: byState.get(targetStateSlot) || [],
      confidence: (byState.get(targetStateSlot) || []).length ? 'high' : 'medium',
    });
  }
  return edges;
}

function buildNode(flow, byState) {
  const physicsCategories = Object.keys(flow.physicsCategoryCounts || {}).sort();
  const inputReadCount = (flow.inputReads || []).length;
  const contactReadCount = (flow.contactFlagReads || []).length;
  const environmentReadCount = (flow.environmentFlagReads || []).length;
  return {
    id: flow.flowId,
    stateSlot: Number.isInteger(flow.stateSlot) ? flow.stateSlot : null,
    primaryLabel: flow.primaryLabel || '',
    componentLabels: flow.componentLabels || [],
    role: flow.role || '',
    mechanicGroup: mechanicGroup(flow),
    summary: flow.summary || '',
    physicsCategories,
    physicsEffects: compactPhysicsCalls(flow),
    transitionTargets: flow.transitionTargets || [],
    transitionEdges: buildEdges(flow, byState),
    transitionWriteCount: (flow.transitionWrites || []).length,
    entryFlagWriteCount: (flow.transitionWrites || []).filter(write => write.entryFlagWrite).length,
    motionWrites: (flow.motionWrites || []).map(write => ({
      label: write.label || '',
      address: write.address || '',
      sourceKind: write.sourceKind || '',
      source: write.source || '',
      componentLabel: write.componentLabel || '',
      line: write.line || null,
    })),
    inputDriven: inputReadCount > 0,
    contactDriven: contactReadCount > 0,
    environmentFlagDriven: environmentReadCount > 0,
    inputReadCount,
    contactReadCount,
    environmentFlagReadCount: environmentReadCount,
    dataRefs: flow.dataRefs || [],
    evidence: flow.evidence || [],
    confidence: flow.confidence || 'medium',
  };
}

function buildCatalog(mapData) {
  const flowCatalog = requirePlayerCatalog(mapData, sourceIds[0]);
  requirePlayerCatalog(mapData, sourceIds[1]);
  requirePlayerCatalog(mapData, sourceIds[2]);
  requirePlayerCatalog(mapData, sourceIds[3]);

  const flows = flowCatalog.flows || [];
  const byState = buildTargetFlowIndex(flows);
  const nodes = flows.map(flow => buildNode(flow, byState));
  const edges = nodes.flatMap(node => node.transitionEdges);
  const edgeTargets = new Set(edges.map(edge => `${edge.targetValue}:${edge.targetStateSlot}`));
  const mechanicCounts = nodes.reduce((acc, node) => {
    acc[node.mechanicGroup] = (acc[node.mechanicGroup] || 0) + 1;
    return acc;
  }, {});
  const physicsCategoryCounts = nodes.reduce((acc, node) => {
    for (const category of node.physicsCategories || []) acc[category] = (acc[category] || 0) + 1;
    return acc;
  }, {});
  const ambiguousTargetEdges = edges.filter(edge => edge.possibleTargetFlowIds.length > 1).length;

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: sourceIds,
    summary: {
      nodeCount: nodes.length,
      innerStateNodeCount: nodes.filter(node => Number.isInteger(node.stateSlot)).length,
      vectorSubstateNodeCount: nodes.filter(node => node.mechanicGroup === 'vector_substate').length,
      transitionEdgeCount: edges.length,
      uniqueTransitionTargetCount: edgeTargets.size,
      ambiguousTargetEdgeCount: ambiguousTargetEdges,
      inputDrivenNodeCount: nodes.filter(node => node.inputDriven).length,
      contactDrivenNodeCount: nodes.filter(node => node.contactDriven).length,
      environmentFlagDrivenNodeCount: nodes.filter(node => node.environmentFlagDriven).length,
      mechanicGroupCounts: mechanicCounts,
      physicsCategoryNodeCounts: physicsCategoryCounts,
      assetPolicy: 'Metadata only: player state ids, routine labels, transition constants, RAM labels, physics categories, and evidence. No ROM bytes, gameplay tables, graphics, music, or decoded asset payloads are embedded.',
    },
    transitionModel: {
      stateRegister: '_RAM_C260_',
      stateRegisterAddress: '$C260',
      targetNormalization: 'literal target byte & 0x7F gives inner state slot; bit 7 is retained as entryFlagSet.',
      ambiguityPolicy: 'If multiple flow nodes share the same state slot, possibleTargetFlowIds lists all known variants until outer form/dispatcher context is modeled.',
      vectorSubstateRegister: '_RAM_C271_',
    },
    nodes,
    edges,
    evidence: [
      'world-player-state-physics-flow-catalog-2026-06-25 supplies ASM-backed flow components, _RAM_C260_ transition writes, physics calls, and input/contact/environment reads.',
      'world-player-struct-catalog-2026-06-25 supplies the $C240-$C27F player struct field map used by the flow catalog.',
      'world-player-physics-state-effect-catalog-2026-06-25 supplies categories for the direct physics-effect calls in each flow.',
      'world-player-runtime-routine-catalog-2026-06-25 supplies the runtime dispatcher context for the player state handlers.',
    ],
    nextLeads: [
      'Resolve outer dispatcher/form context for state slots 3 and 8 so ambiguous target edges can point to one concrete flow at runtime.',
      'Trace _RAM_C248/_RAM_C24A/_RAM_C25E/_RAM_C25F axis semantics frame-by-frame through the motion integrators.',
      'Use this graph as the source skeleton for future player-state.js and player-physics.js modules after per-frame constants are verified.',
    ],
  };
}

function applyCatalog(mapData, catalog) {
  mapData.playerCatalogs = (mapData.playerCatalogs || []).filter(item => item.id !== catalogId);
  mapData.playerCatalogs.push(catalog);
  mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
  mapData.analysisReports.push({
    id: reportId,
    type: 'player_engine_state_graph_audit',
    generatedAt: now,
    tool: `${toolName} --apply`,
    schemaVersion: 1,
    sourceCatalogs: catalog.sourceCatalogs,
    summary: catalog.summary,
    transitionModel: catalog.transitionModel,
    sampleNodes: catalog.nodes.slice(0, 8).map(node => ({
      id: node.id,
      stateSlot: node.stateSlot,
      mechanicGroup: node.mechanicGroup,
      primaryLabel: node.primaryLabel,
      transitionTargets: node.transitionTargets,
      physicsCategories: node.physicsCategories,
      inputDriven: node.inputDriven,
      contactDriven: node.contactDriven,
      environmentFlagDriven: node.environmentFlagDriven,
    })),
    evidence: catalog.evidence,
    nextLeads: catalog.nextLeads,
  });
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);
  if (apply) {
    applyCatalog(mapData, catalog);
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }
  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    sampleNodes: catalog.nodes.slice(0, 6).map(node => ({
      id: node.id,
      stateSlot: node.stateSlot,
      mechanicGroup: node.mechanicGroup,
      transitionTargets: node.transitionTargets,
      physicsCategories: node.physicsCategories,
    })),
  }, null, 2));
}

main();
