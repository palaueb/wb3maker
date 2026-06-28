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
const catalogId = 'world-audio-trace-model-catalog-2026-06-25';
const reportId = 'audio-trace-model-audit-2026-06-25';
const toolName = 'tools/world-audio-trace-model-audit.mjs';

const traceSemanticsCatalogId = 'world-audio-event-trace-semantics-catalog-2026-06-25';
const ramCatalogId = 'world-audio-ram-state-catalog-2026-06-25';

const RULES = [
  {
    operationKind: 'store_arg',
    application: 'write_known_byte',
    valueSource: 'decoded event argument byte from the locally loaded ROM',
    certainty: 'known',
    conditional: false,
    summary: 'Store the referenced event argument byte into the target RAM field.',
  },
  {
    operationKind: 'conditional_store_arg',
    application: 'write_known_byte_if_condition_matches',
    valueSource: 'decoded event argument byte from the locally loaded ROM',
    certainty: 'conditional',
    conditional: true,
    summary: 'Store the referenced event argument byte only when the handler condition is true.',
  },
  {
    operationKind: 'add_arg',
    application: 'add_known_delta',
    valueSource: 'decoded event argument byte plus previous synthetic field value',
    certainty: 'known_if_previous_value_known',
    conditional: false,
    summary: 'Add the referenced event argument byte to the prior synthetic byte value when that prior value is known.',
  },
  {
    operationKind: 'add_arg_clamped',
    application: 'add_known_delta_with_clamp',
    valueSource: 'decoded event argument byte plus previous synthetic field value and clamp metadata',
    certainty: 'known_if_previous_value_known',
    conditional: false,
    summary: 'Add the referenced event argument byte and clamp using the operation clamp metadata when the prior value is known.',
  },
  {
    operationKind: 'lookup_store',
    application: 'mark_lookup_result',
    valueSource: 'ROM support-table lookup identified by metadata; table value is not modeled by this trace pass',
    certainty: 'unresolved_value',
    conditional: false,
    summary: 'Mark the target field as written by a ROM lookup without embedding or resolving the lookup byte.',
  },
  {
    operationKind: 'advance_stream_pointer',
    application: 'write_known_pointer',
    valueSource: 'post-event continuation pointer calculated by the browser decoder',
    certainty: 'known',
    conditional: false,
    summary: 'Write the next stream pointer after the decoded event bytes.',
  },
  {
    operationKind: 'advance_or_loop_stream_pointer',
    application: 'write_conditional_pointer_candidate',
    valueSource: 'post-event continuation pointer or saved loop pointer depending on repeat state',
    certainty: 'conditional',
    conditional: true,
    summary: 'Record the fall-through pointer while preserving that repeat handling may reload a saved loop pointer.',
  },
  {
    operationKind: 'branch_pointer_arg',
    application: 'write_known_pointer',
    valueSource: 'two-byte pointer argument decoded from the locally loaded ROM',
    certainty: 'known',
    conditional: false,
    summary: 'Write the immediate branch/call pointer argument into the stream pointer target.',
  },
  {
    operationKind: 'save_pointer_context',
    application: 'save_pointer_context',
    valueSource: 'current interpreter continuation pointer context',
    certainty: 'contextual_pointer',
    conditional: false,
    summary: 'Mark a saved return/repeat pointer context; exact execution context is not cycle-interpreted here.',
  },
  {
    operationKind: 'store_context_byte',
    application: 'mark_context_byte_write',
    valueSource: 'handler-context byte not yet exposed by the static event decoder',
    certainty: 'unresolved_value',
    conditional: false,
    summary: 'Mark the target byte as written by handler context that is not decoded as a normal event argument yet.',
  },
  {
    operationKind: 'test_decrement',
    application: 'test_and_decrement_previous_value',
    valueSource: 'previous synthetic field value',
    certainty: 'known_if_previous_value_known',
    conditional: true,
    summary: 'Record a test/decrement operation; exact value is known only when the prior synthetic value is known.',
  },
  {
    operationKind: 'maybe_reload_pointer',
    application: 'conditional_pointer_reload',
    valueSource: 'saved pointer field selected by handler branch state',
    certainty: 'conditional',
    conditional: true,
    summary: 'Record a conditional pointer reload from a saved pointer field.',
  },
  {
    operationKind: 'maybe_clear',
    application: 'conditional_clear',
    valueSource: 'handler branch state',
    certainty: 'conditional',
    conditional: true,
    summary: 'Record a conditional clear-to-zero of the target field.',
  },
  {
    operationKind: 'reload_or_decrement_delay',
    application: 'mark_delay_update',
    valueSource: 'decoded note/rest timing path',
    certainty: 'unresolved_value',
    conditional: true,
    summary: 'Record the delay counter timing update without modeling the note table path.',
  },
  {
    operationKind: 'touch_output_volume',
    application: 'mark_output_consumer_touch',
    valueSource: 'decoded output volume path',
    certainty: 'unresolved_value',
    conditional: false,
    summary: 'Mark a hardware-shadow output field touched by note/rest handling.',
  },
  {
    operationKind: 'touch_output_pitch_step',
    application: 'mark_output_consumer_touch',
    valueSource: 'decoded output pitch path',
    certainty: 'unresolved_value',
    conditional: false,
    summary: 'Mark a hardware-shadow output field touched by note/rest handling.',
  },
  {
    operationKind: 'touch_compare_cache',
    application: 'mark_compare_cache_touch',
    valueSource: 'later PSG/FM update comparison path',
    certainty: 'unresolved_value',
    conditional: false,
    summary: 'Mark a cache/compare field touched by the event and consumed by later output update logic.',
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

function countBy(items, keyFn) {
  const out = {};
  for (const item of items) {
    const key = keyFn(item) || 'unknown';
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function buildCatalog(mapData) {
  const traceCatalog = requireCatalog(mapData, traceSemanticsCatalogId);
  const ramCatalog = requireCatalog(mapData, ramCatalogId);
  const operationKinds = new Map();
  for (const event of traceCatalog.traceSemantics || []) {
    for (const operation of event.operations || []) {
      const kind = operation.kind || 'unknown';
      const entry = operationKinds.get(kind) || { operationKind: kind, count: 0, eventKeys: [] };
      entry.count++;
      if (!entry.eventKeys.includes(event.eventKey)) entry.eventKeys.push(event.eventKey);
      operationKinds.set(kind, entry);
    }
  }

  const ruleByKind = new Map(RULES.map(rule => [rule.operationKind, rule]));
  const validationIssues = [];
  for (const kind of operationKinds.keys()) {
    if (!ruleByKind.has(kind)) validationIssues.push(`Missing trace model rule for operation kind ${kind}`);
  }
  for (const rule of RULES) {
    if (!operationKinds.has(rule.operationKind)) validationIssues.push(`Trace model rule ${rule.operationKind} is not used by ${traceSemanticsCatalogId}`);
  }

  const operationKindUsage = [...operationKinds.values()].sort((a, b) =>
    a.operationKind.localeCompare(b.operationKind)
  );
  const applicationRules = RULES.map(rule => ({
    ...rule,
    observedOperationCount: operationKinds.get(rule.operationKind)?.count || 0,
    observedEventKeys: operationKinds.get(rule.operationKind)?.eventKeys || [],
  })).sort((a, b) => a.operationKind.localeCompare(b.operationKind));

  const summary = {
    operationKindCount: operationKinds.size,
    applicationRuleCount: applicationRules.length,
    validationIssueCount: validationIssues.length,
    operationCount: traceCatalog.summary?.operationCount || operationKindUsage.reduce((sum, item) => sum + item.count, 0),
    streamFieldCount: ramCatalog.streamChannelStruct?.fields?.length || 0,
    hardwareShadowFieldCount: ramCatalog.hardwareShadowStruct?.fields?.length || 0,
    certaintyCounts: countBy(applicationRules, rule => rule.certainty),
    applicationCounts: countBy(applicationRules, rule => rule.application),
    conditionalRuleCount: applicationRules.filter(rule => rule.conditional).length,
    assetPolicy: 'Metadata only: operation kinds, application semantics, field categories, counts, and evidence refs. No ROM bytes, decoded stream argument values, audio samples, PSG/FM register data, or copyrighted assets are embedded.',
  };

  return {
    id: catalogId,
    schemaVersion: 1,
    generatedAt: now,
    tool: toolName,
    sourceCatalogs: [traceSemanticsCatalogId, ramCatalogId],
    assetPolicy: summary.assetPolicy,
    runtimePolicy: {
      purpose: 'Defines how the browser analyzer may apply event trace operations to a synthetic audio state preview after the user loads a local ROM.',
      valuePolicy: 'ROM-derived argument bytes and computed field values are live preview data only and must not be written back into project metadata.',
      caveat: 'This is a static, branch-aware metadata model for diagnostics, not a cycle-accurate audio driver interpreter.',
    },
    summary,
    operationKindUsage,
    applicationRules,
    validationIssues,
    evidence: [
      `${traceSemanticsCatalogId} enumerates the operation kinds and event-to-RAM targets modeled here.`,
      `${ramCatalogId} defines the stream-channel and hardware-shadow field names used as trace targets.`,
      'Rules distinguish exact event-argument writes from branch-conditional, lookup-derived, context-derived, and output-consumer touches.',
    ],
  };
}

function main() {
  const mapData = readJson(mapPath);
  const catalog = buildCatalog(mapData);

  if (apply) {
    mapData.audioCatalogs = (mapData.audioCatalogs || []).filter(item => item.id !== catalogId);
    mapData.audioCatalogs.push(catalog);
    mapData.analysisReports = (mapData.analysisReports || []).filter(report => report.id !== reportId);
    mapData.analysisReports.push({
      id: reportId,
      type: 'audio_trace_model_audit',
      generatedAt: now,
      tool: `${toolName} --apply`,
      schemaVersion: 1,
      sourceCatalogs: catalog.sourceCatalogs,
      summary: catalog.summary,
      validationIssues: catalog.validationIssues,
      nextLeads: [
        'Use this model in the analyzer to summarize known, conditional, and unresolved synthetic audio state per decoded stream channel.',
        'Resolve lookup_store by modeling the bank 3 support table referenced by opcode $F5 without persisting lookup bytes.',
        'Promote branch and repeat handling from diagnostic state touches to a small interpreter once loop/call execution order is verified.',
      ],
    });
    fs.writeFileSync(mapPath, JSON.stringify(mapData, null, 2) + '\n');
  }

  console.log(JSON.stringify({
    applied: apply,
    catalogId,
    summary: catalog.summary,
    validationIssues: catalog.validationIssues,
  }, null, 2));
}

main();
