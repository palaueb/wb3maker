'use strict';

import {
  RESIDUAL_TRACE_EVENT_FIELDS,
  collectForbiddenTracePayloadKeys,
  createResidualRuntimeTraceCollector,
} from './residual-runtime-trace-events.js';

const allowedEventFields = new Set(RESIDUAL_TRACE_EVENT_FIELDS);

function uniqueSorted(values) {
  return [...new Set((values || []).filter(Boolean))].sort();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function buildResidualRuntimeTraceHookManifest(eventContractCatalog) {
  const hooks = eventContractCatalog?.hooks || [];
  const tracePlans = eventContractCatalog?.tracePlans || [];
  const knownHookIds = uniqueSorted(hooks.map(hook => hook.id));
  const captureFieldIssues = [];

  const manifestHooks = hooks.map(hook => {
    const unsupportedCaptureFields = (hook.captureFields || []).filter(field => !allowedEventFields.has(field));
    for (const field of unsupportedCaptureFields) {
      captureFieldIssues.push({ hookId: hook.id, field, kind: 'unsupported_capture_field' });
    }
    return {
      hookId: hook.id,
      label: hook.label || null,
      offset: hook.offset || null,
      regionId: hook.regionId || null,
      eventKind: hook.eventKind || '',
      hookClass: hook.hookClass || '',
      appliesToRegionIds: hook.appliesToRegionIds || [],
      captureFields: (hook.captureFields || []).filter(field => allowedEventFields.has(field)),
      mcpBreakpointOffsets: hook.mcpBreakpointOffsets || [],
      unsupportedCaptureFields,
    };
  });

  return {
    schemaVersion: 1,
    eventKind: 'wb3_residual_runtime_trace_hook_manifest',
    hookCount: manifestHooks.length,
    runtimeHookCount: manifestHooks.filter(hook => hook.hookClass === 'runtime_trace_hook').length,
    promotionGateCount: manifestHooks.filter(hook => hook.hookClass === 'metadata_promotion_gate').length,
    tracePlanCount: tracePlans.length,
    knownHookIds,
    hooks: manifestHooks,
    tracePlans: tracePlans.map(plan => ({
      planId: plan.id,
      regionId: plan.regionId,
      classId: plan.classId,
      targetOffsets: plan.targetOffsets || [],
      requiredRuntimeHookIds: plan.requiredRuntimeHookIds || [],
      optionalRuntimeHookIds: plan.optionalRuntimeHookIds || [],
    })),
    captureFieldIssues,
    readyForCleanRuntimeBridge: captureFieldIssues.length === 0 && manifestHooks.length > 0,
    assetPolicy: 'Metadata-only hook manifest. It contains hook ids, labels, offsets, region ids, and allowed capture field names only; no ROM bytes, decoded assets, register traces, VDP port values, pixels, screenshots, hashes, audio bytes, or samples.',
  };
}

export function createResidualRuntimeTraceHookBridge(eventContractCatalog, options = {}) {
  const manifest = buildResidualRuntimeTraceHookManifest(eventContractCatalog);
  const hookById = new Map(manifest.hooks.map(hook => [hook.hookId, hook]));
  const collector = options.collector || createResidualRuntimeTraceCollector({
    tracePrefix: options.tracePrefix || 'residual-runtime',
    knownHookIds: manifest.knownHookIds,
  });

  function traceIdFrom(snapshot, fallback = null) {
    return snapshot?.same_frame_trace_id
      || snapshot?.traceId
      || snapshot?.frameTraceId
      || fallback
      || collector.nextTraceId();
  }

  function eventFieldsForHook(hook, snapshot = {}) {
    const fields = {};
    for (const field of hook.captureFields || []) {
      if (field === 'same_frame_trace_id') continue;
      if (Object.prototype.hasOwnProperty.call(snapshot, field)) fields[field] = snapshot[field];
    }
    return fields;
  }

  return {
    manifest: clone(manifest),
    knownHookIds: manifest.knownHookIds.slice(),
    collector,
    emitHook(hookId, snapshot = {}, sameFrameTraceId = null) {
      const hook = hookById.get(hookId);
      if (!hook) {
        return {
          event: {},
          droppedFields: [],
          validationIssues: [{ kind: 'unknown_hook_id', hookId }],
        };
      }
      const forbiddenPayloadKeys = collectForbiddenTracePayloadKeys(snapshot);
      if (forbiddenPayloadKeys.length) {
        return {
          event: {},
          droppedFields: [],
          validationIssues: forbiddenPayloadKeys.map(field => ({
            kind: 'forbidden_payload_key',
            field,
            hookId,
          })),
          forbiddenPayloadKeys,
        };
      }
      return collector.emit(hookId, eventFieldsForHook(hook, snapshot), traceIdFrom(snapshot, sameFrameTraceId));
    },
    emitPromotionGate(regionId, fields = {}, sameFrameTraceId = null) {
      const forbiddenPayloadKeys = collectForbiddenTracePayloadKeys(fields);
      if (forbiddenPayloadKeys.length) {
        return {
          event: {},
          droppedFields: [],
          validationIssues: forbiddenPayloadKeys.map(field => ({
            kind: 'forbidden_payload_key',
            field,
            hookId: 'residual_runtime_promotion_gate',
          })),
          forbiddenPayloadKeys,
        };
      }
      return collector.emit('residual_runtime_promotion_gate', {
        ...fields,
        target_region_id: regionId,
      }, traceIdFrom(fields, sameFrameTraceId));
    },
    events() {
      return collector.events();
    },
    bundle(extra = {}) {
      return collector.bundle({
        source: 'residual_runtime_trace_hook_bridge',
        hookManifestReady: manifest.readyForCleanRuntimeBridge,
        hookManifestHookCount: manifest.hookCount,
        ...extra,
      });
    },
  };
}
