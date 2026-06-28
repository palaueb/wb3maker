#!/usr/bin/env node
'use strict';

import { chromium } from 'playwright';

const port = process.env.WB3_SMOKE_PORT || '8174';
const url = process.env.WB3_SMOKE_URL || `http://127.0.0.1:${port}/tools/rom-analyzer.html`;

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const messages = [];
  const errors = [];
  page.on('console', message => {
    if (message.type() === 'error') messages.push(message.text());
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const result = await page.evaluate(async () => {
    const response = await fetch('/projects/WORLD/map.json');
    if (!response.ok) throw new Error(`map fetch failed: ${response.status}`);
    const map = await response.json();
    window.loadMapJson(JSON.stringify(map), 'map.json');
    window.renderResidualTraceSummary();
    const summary = document.querySelector('#residual-trace-summary');
    const details = summary ? [...summary.querySelectorAll('.trace-summary-checklist')] : [];
    const captureDetails = details.find(item => item.querySelector('summary')?.innerText.includes('Residual capture checklist'));
    const liveClosureDetails = details.find(item => item.querySelector('summary')?.innerText.includes('Residual live closure queue'));
    return {
      title: document.title,
      hasSummary: Boolean(summary),
      display: summary ? getComputedStyle(summary).display : '',
      text: summary ? summary.innerText : '',
      captureChecklistRowCount: captureDetails ? captureDetails.querySelectorAll('.trace-summary-table tbody tr').length : 0,
      liveClosureRowCount: liveClosureDetails ? liveClosureDetails.querySelectorAll('.trace-summary-table tbody tr').length : 0,
      liveClosureSummaryText: liveClosureDetails?.querySelector('summary')?.innerText || '',
      checklistHookCount: captureDetails ? captureDetails.querySelectorAll('.trace-summary-hook').length : 0,
      regionTemplateCommandCount: summary ? summary.querySelectorAll('.trace-summary-copy[data-template-command]').length : 0,
      regionTemplateCopyButtonCount: summary ? summary.querySelectorAll('.trace-summary-copy[data-template-command]').length : 0,
      focusedTraceCommandCount: summary ? summary.querySelectorAll('.trace-summary-copy[data-trace-command]').length : 0,
      focusedTemplateExportButtonCount: summary ? summary.querySelectorAll('.trace-summary-copy[data-template-export-region]').length : 0,
      regionTemplateCommands: summary
        ? [...summary.querySelectorAll('.trace-summary-copy[data-template-command]')].map(btn => btn.dataset.templateCommand)
        : [],
      focusedTraceCommands: summary
        ? [...summary.querySelectorAll('.trace-summary-copy[data-trace-command]')].map(btn => btn.dataset.traceCommand)
        : [],
      focusedTemplateExportRegions: summary
        ? [...summary.querySelectorAll('.trace-summary-copy[data-template-export-region]')].map(btn => btn.dataset.templateExportRegion)
        : [],
      regionCount: window.mapData?.regions?.length || 0,
      hookBridgeCatalogCount: window.mapData?.runtimeTraceHookBridgeCatalogs?.length || 0,
      confirmationCatalogCount: window.mapData?.runtimeTraceConfirmationCatalogs?.length || 0,
      proofUpdatePlanCatalogCount: window.mapData?.residualProofUpdatePlanCatalogs?.length || 0,
      semanticDispositionPlanCatalogCount: window.mapData?.residualSemanticDispositionPlanCatalogs?.length || 0,
      closurePipelineCatalogCount: window.mapData?.residualRuntimeClosurePipelineCatalogs?.length || 0,
      captureChecklistCatalogCount: window.mapData?.residualRuntimeCaptureChecklistCatalogs?.length || 0,
      liveClosureStatusCatalogCount: window.mapData?.residualLiveClosureStatusCatalogs?.length || 0,
    };
  });
  await page.evaluate(() => {
    const button = document.querySelector('.trace-summary-copy[data-template-export-region="r2813"]');
    if (!button) throw new Error('missing r2813 focused template export button');
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  const exportSummary = await page.evaluate(() => {
    const exported = window.mapLastResidualTemplateExport || {};
    const exportedTemplate = exported.payload || {};
    return {
      suggestedFilename: exported.fileName || '',
      regionId: exported.regionId || '',
    eventKind: exportedTemplate.eventKind,
    templateOnly: exportedTemplate.templateOnly,
    regionFilter: exportedTemplate.summary?.regionFilter || [],
    observationCount: exportedTemplate.summary?.observationCount || 0,
    tracePlanCount: exportedTemplate.summary?.tracePlanCount || 0,
    firstHookId: exportedTemplate.observations?.[0]?.hookId || '',
    hasRomBytesProperty: JSON.stringify(exportedTemplate).includes('"romBytes"'),
    hasEventsProperty: Object.prototype.hasOwnProperty.call(exportedTemplate, 'events'),
    commandRunPipeline: exportedTemplate.commands?.runPipeline || '',
    };
  });
  const ok = Boolean(
    result.title &&
    result.hasSummary &&
    result.display !== 'none' &&
    result.text.includes('Residual runtime trace bridge') &&
    result.text.includes('tmp/local-hook-observations.template.json') &&
    result.text.includes('tmp/world-residual-runtime-trace-observation-audit.local.json') &&
    result.text.includes('tmp/world-residual-runtime-trace-events.local.json') &&
    result.text.includes('tmp/world-residual-runtime-proof-update-plan.local.json') &&
    result.text.includes('tmp/world-residual-runtime-closure-pipeline.local.json') &&
    result.text.includes('--template-pack --out tmp/local-hook-observations.templates') &&
    result.text.includes('world-residual-runtime-proof-update-plan-audit.mjs') &&
    result.text.includes('world-residual-runtime-closure-pipeline-audit.mjs') &&
    result.text.includes('world-residual-runtime-capture-checklist-audit.mjs') &&
    result.text.includes('5Runtime gated') &&
    result.text.includes('Semantic ready') &&
    result.text.includes('Pipeline') &&
    result.text.includes('Checklist obs') &&
    result.text.includes('Template guard') &&
    result.text.includes('ONTemplate guard') &&
    result.text.includes('Field guard') &&
    result.text.includes('ONField guard') &&
    result.text.includes('Live ready') &&
    result.text.includes('Live wait') &&
    result.text.includes('Candidate only') &&
    result.text.includes('Read hits') &&
    result.text.includes('Unbound hits') &&
    result.text.includes('Residual capture checklist') &&
    result.text.includes('Residual live closure queue') &&
    result.text.includes('capture_palette_parser_entry_and_physical_source_same_frame') &&
    result.text.includes('capture_cf64_index_and_room_overlay_loader_execution_hooks_same_frame') &&
    result.text.includes('find_route_and_capture_bank7_sidecar_execution_read_hooks_same_frame') &&
    result.text.includes('read_range_reached_without_clean_hook_binding') &&
    result.text.includes('--template --region r2813') &&
    result.text.includes('--region r2813 --out tmp/world-residual-runtime-trace-observation-audit.local.json') &&
    result.text.includes('--events tmp/world-residual-runtime-trace-events.local.json --region r2813') &&
    result.text.includes('--region r2813 --out tmp/world-residual-runtime-proof-update-plan.local.json') &&
    result.text.includes('--region r2813 --out tmp/world-residual-runtime-closure-pipeline.local.json') &&
    result.text.includes('local-hook-observations.r2813.template.json') &&
    result.text.includes('--template --region r0749') &&
    result.text.includes('r2813') &&
    result.text.includes('residual_overlay_cf64_index_read') &&
    result.text.includes('residual_palette_tail_cursor_watch') &&
    result.text.includes('residual_bank7_sidecar_direct_watch') &&
    result.text.includes('direct_consumer') &&
    result.text.includes('waiting_for_observation_input') &&
    result.text.includes('Pending') &&
    result.text.includes('Planned') &&
    result.regionCount > 0 &&
    result.hookBridgeCatalogCount > 0 &&
    result.confirmationCatalogCount > 0 &&
    result.proofUpdatePlanCatalogCount > 0 &&
    result.semanticDispositionPlanCatalogCount > 0 &&
    result.closurePipelineCatalogCount > 0 &&
    result.captureChecklistCatalogCount > 0 &&
    result.liveClosureStatusCatalogCount > 0 &&
    result.captureChecklistRowCount === 5 &&
    result.liveClosureRowCount === 5 &&
    result.liveClosureSummaryText.includes('r2815, r2816, r2817, r2813, r0749') &&
    result.checklistHookCount === 16 &&
    result.regionTemplateCommandCount === 5 &&
    result.regionTemplateCopyButtonCount === 5 &&
    result.focusedTraceCommandCount === 30 &&
    result.focusedTemplateExportButtonCount === 5 &&
    result.regionTemplateCommands.includes('node tools/world-residual-runtime-trace-local-bundle.mjs --template --region r2813 --out tmp/local-hook-observations.r2813.template.json') &&
    result.regionTemplateCommands.includes('node tools/world-residual-runtime-trace-local-bundle.mjs --template --region r0749 --out tmp/local-hook-observations.r0749.template.json') &&
    result.focusedTraceCommands.includes('node tools/world-residual-runtime-trace-local-bundle.mjs --observations tmp/local-hook-observations.json --region r2813 --out tmp/world-residual-runtime-trace-events.local.json') &&
    result.focusedTraceCommands.includes('node tools/world-residual-runtime-trace-local-bundle.mjs --observations tmp/local-hook-observations.json --reviewed-runtime-observations --region r2813 --out tmp/world-residual-runtime-trace-events.local.json') &&
    result.focusedTraceCommands.includes('node tools/world-residual-runtime-closure-pipeline-audit.mjs --observations tmp/local-hook-observations.json --region r2813 --out tmp/world-residual-runtime-closure-pipeline.local.json') &&
    result.focusedTraceCommands.includes('node tools/world-residual-runtime-proof-update-plan-audit.mjs --events tmp/world-residual-runtime-trace-events.local.json --region r0749 --out tmp/world-residual-runtime-proof-update-plan.local.json') &&
    result.focusedTemplateExportRegions.includes('r2813') &&
    result.focusedTemplateExportRegions.includes('r0749') &&
    exportSummary.suggestedFilename === 'local-hook-observations.r2813.template.json' &&
    exportSummary.regionId === 'r2813' &&
    exportSummary.eventKind === 'wb3_residual_runtime_trace_observation_template' &&
    exportSummary.templateOnly === true &&
    exportSummary.regionFilter.length === 1 &&
    exportSummary.regionFilter[0] === 'r2813' &&
    exportSummary.observationCount === 3 &&
    exportSummary.tracePlanCount === 1 &&
    exportSummary.firstHookId === 'residual_overlay_cf64_index_read' &&
    exportSummary.hasRomBytesProperty === false &&
    exportSummary.hasEventsProperty === false &&
    exportSummary.commandRunPipeline.includes('--region r2813') &&
    messages.length === 0 &&
    errors.length === 0
  );
  console.log(JSON.stringify({ ok, url, result, exportSummary, messages, errors }, null, 2));
  if (!ok) process.exitCode = 1;
} finally {
  await browser.close();
}
