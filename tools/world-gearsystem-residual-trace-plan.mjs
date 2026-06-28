#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const defaultOutputPath = path.join(repoRoot, 'gearsystem/world-residual-mcp-trace-plan.json');
const now = '2026-06-26T00:00:00Z';

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] || null;
}

function resolveRepoPath(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.resolve(repoRoot, filePath);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function latest(list) {
  return Array.isArray(list) && list.length ? list[list.length - 1] : null;
}

function regionById(mapData, id) {
  return (mapData.regions || []).find(region => region.id === id) || null;
}

function tracePlanCommands(entry) {
  return {
    generateTemplate: entry.regionTemplateCommand || '',
    auditFocusedObservations: entry.focusedObservationAuditCommand || '',
    buildFocusedBundle: entry.focusedBundleCommand || '',
    buildFocusedReviewedBundle: entry.focusedReviewedBundleCommand || '',
    confirmFocusedBundle: entry.focusedConfirmationCommand || '',
    planFocusedProofUpdate: entry.focusedProofPlanCommand || '',
    runFocusedClosurePipeline: entry.focusedClosurePipelineCommand || '',
  };
}

function buildPlan(mapData) {
  const checklist = latest(mapData.residualRuntimeCaptureChecklistCatalogs) || {};
  const residuals = checklist.checklists || checklist.residuals || [];
  const targets = residuals.map(entry => {
    const region = regionById(mapData, entry.region?.id);
    const closure = region?.analysis?.residualRuntimeProofClosureIndexAudit || {};
    const proofUpdate = region?.analysis?.residualRuntimeProofUpdatePlanAudit || {};
    return {
      regionId: entry.region?.id || '',
      offset: entry.region?.offset || region?.offset || '',
      size: entry.region?.size || region?.size || null,
      type: entry.region?.type || region?.type || 'unknown',
      classId: entry.classId || '',
      status: entry.status || 'waiting_for_real_metadata_only_runtime_observation',
      traceKind: closure.runtimeGate?.traceKind || region?.analysis?.lowConfidenceResidualTriageAudit?.proofPlan?.traceKind || '',
      targetOffsets: entry.targetOffsets || [],
      requiredRuntimeHookIds: entry.requiredRuntimeHookIds || [],
      hookChecklist: (entry.hookChecklist || []).map(hook => ({
        hookId: hook.hookId,
        label: hook.label || null,
        offset: hook.offset || null,
        mcpBreakpointOffsets: hook.mcpBreakpointOffsets || [],
        regionId: hook.regionId || null,
        required: hook.required === true,
        captureFields: hook.captureFields || [],
        requiredCaptureFields: hook.requiredCaptureFields || [],
      })),
      proofStatus: {
        proofUpdateStatus: proofUpdate.status || '',
        proofMetadataAppliedByThisTool: proofUpdate.proofMetadataAppliedByThisTool === true,
        applyCatalogIntegrityOk: proofUpdate.applyCatalogIntegrityOk === true,
        closurePromotionReady: closure.promotionReady === true,
        closurePromotionBlockedBy: closure.promotionBlockedBy || '',
      },
      commands: tracePlanCommands(entry),
    };
  });
  return {
    schemaVersion: 1,
    generatedAt: now,
    tool: 'tools/world-gearsystem-residual-trace-plan.mjs',
    emulator: {
      binary: 'gearsystem/Gearsystem-3.9.10-desktop-ubuntu24.04-x64/gearsystem',
      launchCommand: 'node tools/world-gearsystem-launch.mjs --port 7777',
      mcpProbeCommand: 'node tools/world-gearsystem-mcp-probe.mjs --port 7777',
      symbolBuildCommand: 'node tools/world-gearsystem-symbols.mjs',
      symbolFile: 'gearsystem/wb3-world.sym',
      romPath: 'projects/WORLD/Wonder Boy III - The Dragon\'s Trap (World) (Digital).sms',
      mcpMode: 'http',
      mcpAddress: '127.0.0.1',
      mcpPort: 7777,
      requiredRuntimeDependency: 'libSDL3.so.0',
    },
    summary: {
      targetCount: targets.length,
      requiredObservationCount: targets.reduce((sum, target) => sum + target.requiredRuntimeHookIds.length, 0),
      readyForMcpRuntimeTracing: targets.length === 5,
      persistedRomByteCount: 0,
      persistedStreamByteCount: 0,
      persistedTileIdCount: 0,
      persistedPaletteByteCount: 0,
      persistedPortValueCount: 0,
      persistedRegisterTraceCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
    },
    targets,
    workflow: [
      'Run node tools/world-gearsystem-symbols.mjs to generate Gearsystem debug symbols.',
      'Start Gearsystem MCP with node tools/world-gearsystem-launch.mjs --port 7777 after libSDL3.so.0 is available.',
      'Use MCP breakpoints/watchpoints to gather only the metadata fields named in hookChecklist.captureFields.',
      'Write observations to tmp/local-hook-observations.json, then run each target commands.runFocusedClosurePipeline.',
      'Only run commands.buildFocusedReviewedBundle and proof update apply after reviewing a clean observation audit.',
    ],
    assetPolicy: 'Metadata only: emulator path, command paths, hook ids, labels, offsets, region ids, capture field names, booleans, counts, and workflow text. No ROM bytes, decoded assets, register traces, VDP port values, pixels, screenshots, audio bytes, samples, or instruction bytes are written.',
  };
}

function main() {
  const outputPath = resolveRepoPath(argValue('--out')) || defaultOutputPath;
  const mapData = readJson(mapPath);
  const plan = buildPlan(mapData);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(plan, null, 2)}\n`);
  console.log(JSON.stringify({
    ok: true,
    output: path.relative(repoRoot, outputPath),
    targetCount: plan.summary.targetCount,
    readyForMcpRuntimeTracing: plan.summary.readyForMcpRuntimeTracing,
  }, null, 2));
}

main();
