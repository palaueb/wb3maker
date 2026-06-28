#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapPath = path.join(repoRoot, 'projects/WORLD/map.json');
const htmlPath = path.join(repoRoot, 'tools/rom-analyzer.html');
const mapPanelPath = path.join(repoRoot, 'tools/js/panel-map.js');
const labPanelPath = path.join(repoRoot, 'tools/js/panel-lab.js');
const cssPath = path.join(repoRoot, 'tools/rom-analyzer.css');
const apply = process.argv.includes('--apply');
const now = '2026-06-26T00:00:00Z';
const reportId = 'analyzer-guard-ui-audit-2026-06-26';
const toolName = 'tools/world-analyzer-guard-ui-audit.mjs';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function falseSplitLabels(region) {
  const labels = region.analysis?.asmFalseSplitLabelAudit?.labels || [];
  return labels.filter(label => label.pointerPromotionAction === 'reject_standalone_pointer_table_promotion');
}

function hasPointerGuard(region) {
  return region.analysis?.asmPointerCandidateResolutionAudit?.genericPointerTableDecision?.action === 'reject_generic_pointer_table_retype';
}

function hasResidualProofGuard(region) {
  return Boolean(region.analysis?.lowConfidenceResidualTriageAudit?.proofPlan);
}

function presenceChecks(html, mapPanel, labPanel, css) {
  return [
    {
      id: 'html_split_guard_filter',
      path: 'tools/rom-analyzer.html',
      requiredText: 'id="chk-split-guard"',
      present: html.includes('id="chk-split-guard"'),
    },
    {
      id: 'html_pointer_guard_filter',
      path: 'tools/rom-analyzer.html',
      requiredText: 'id="chk-pointer-guard"',
      present: html.includes('id="chk-pointer-guard"'),
    },
    {
      id: 'html_residual_proof_filter',
      path: 'tools/rom-analyzer.html',
      requiredText: 'id="chk-residual-proof"',
      present: html.includes('id="chk-residual-proof"'),
    },
    {
      id: 'panel_split_guard_predicate',
      path: 'tools/js/panel-map.js',
      requiredText: 'mapHasFalseSplitGuard',
      present: mapPanel.includes('mapHasFalseSplitGuard'),
    },
    {
      id: 'panel_pointer_guard_predicate',
      path: 'tools/js/panel-map.js',
      requiredText: 'mapHasPointerGuard',
      present: mapPanel.includes('mapHasPointerGuard'),
    },
    {
      id: 'panel_residual_proof_predicate',
      path: 'tools/js/panel-map.js',
      requiredText: 'mapHasResidualProofGuard',
      present: mapPanel.includes('mapHasResidualProofGuard'),
    },
    {
      id: 'panel_split_guard_badge',
      path: 'tools/js/panel-map.js',
      requiredText: 'split guard',
      present: mapPanel.includes('split guard'),
    },
    {
      id: 'panel_pointer_guard_badge',
      path: 'tools/js/panel-map.js',
      requiredText: 'table keep',
      present: mapPanel.includes('table keep'),
    },
    {
      id: 'panel_residual_proof_badge',
      path: 'tools/js/panel-map.js',
      requiredText: 'proof wait',
      present: mapPanel.includes('proof wait'),
    },
    {
      id: 'panel_residual_focused_command_renderer',
      path: 'tools/js/panel-map.js',
      requiredText: 'mapResidualFocusedCommandsHtml',
      present: mapPanel.includes('mapResidualFocusedCommandsHtml'),
    },
    {
      id: 'panel_residual_focused_audit_command',
      path: 'tools/js/panel-map.js',
      requiredText: 'focusedObservationAuditCommand',
      present: mapPanel.includes('focusedObservationAuditCommand'),
    },
    {
      id: 'panel_residual_focused_bundle_command',
      path: 'tools/js/panel-map.js',
      requiredText: 'focusedBundleCommand',
      present: mapPanel.includes('focusedBundleCommand'),
    },
    {
      id: 'panel_residual_focused_reviewed_bundle_command',
      path: 'tools/js/panel-map.js',
      requiredText: 'focusedReviewedBundleCommand',
      present: mapPanel.includes('focusedReviewedBundleCommand'),
    },
    {
      id: 'panel_residual_focused_closure_command',
      path: 'tools/js/panel-map.js',
      requiredText: 'focusedClosurePipelineCommand',
      present: mapPanel.includes('focusedClosurePipelineCommand'),
    },
    {
      id: 'panel_residual_focused_trace_copy',
      path: 'tools/js/panel-map.js',
      requiredText: 'data-trace-command',
      present: mapPanel.includes('data-trace-command'),
    },
    {
      id: 'panel_residual_template_export_button',
      path: 'tools/js/panel-map.js',
      requiredText: 'data-template-export-region',
      present: mapPanel.includes('data-template-export-region'),
    },
    {
      id: 'panel_residual_template_export_builder',
      path: 'tools/js/panel-map.js',
      requiredText: 'mapResidualObservationTemplate',
      present: mapPanel.includes('mapResidualObservationTemplate'),
    },
    {
      id: 'html_lab_guard_panel',
      path: 'tools/rom-analyzer.html',
      requiredText: 'id="lab-guard-panel"',
      present: html.includes('id="lab-guard-panel"'),
    },
    {
      id: 'lab_guard_panel_renderer',
      path: 'tools/js/panel-lab.js',
      requiredText: 'labRenderGuardPanel',
      present: labPanel.includes('labRenderGuardPanel'),
    },
    {
      id: 'lab_guard_confirmation',
      path: 'tools/js/panel-lab.js',
      requiredText: 'labConfirmGuardedAction',
      present: labPanel.includes('labConfirmGuardedAction'),
    },
    {
      id: 'lab_guard_analysis_preserve',
      path: 'tools/js/panel-lab.js',
      requiredText: 'labProtectedGuardAnalysis',
      present: labPanel.includes('labProtectedGuardAnalysis'),
    },
    {
      id: 'lab_guard_analysis_clean',
      path: 'tools/js/panel-lab.js',
      requiredText: 'labRemoveProtectedGuardAnalysis',
      present: labPanel.includes('labRemoveProtectedGuardAnalysis'),
    },
    {
      id: 'css_lab_guard_panel',
      path: 'tools/rom-analyzer.css',
      requiredText: '.lab-guard-panel',
      present: css.includes('.lab-guard-panel'),
    },
    {
      id: 'css_lab_type_guard_risk',
      path: 'tools/rom-analyzer.css',
      requiredText: '.lab-type-btn.guard-risk',
      present: css.includes('.lab-type-btn.guard-risk'),
    },
    {
      id: 'css_split_guard_badge',
      path: 'tools/rom-analyzer.css',
      requiredText: '.src-badge.guard-split',
      present: css.includes('.src-badge.guard-split'),
    },
    {
      id: 'css_pointer_guard_badge',
      path: 'tools/rom-analyzer.css',
      requiredText: '.src-badge.guard-pointer',
      present: css.includes('.src-badge.guard-pointer'),
    },
    {
      id: 'css_residual_proof_badge',
      path: 'tools/rom-analyzer.css',
      requiredText: '.src-badge.guard-residual',
      present: css.includes('.src-badge.guard-residual'),
    },
    {
      id: 'css_residual_focused_command_list',
      path: 'tools/rom-analyzer.css',
      requiredText: '.trace-summary-command-list',
      present: css.includes('.trace-summary-command-list'),
    },
    {
      id: 'css_residual_focused_command_label',
      path: 'tools/rom-analyzer.css',
      requiredText: '.trace-summary-command-label',
      present: css.includes('.trace-summary-command-label'),
    },
    {
      id: 'css_residual_template_export_row',
      path: 'tools/rom-analyzer.css',
      requiredText: '.trace-summary-export-row',
      present: css.includes('.trace-summary-export-row'),
    },
  ];
}

function buildReport(mapData, html, mapPanel, labPanel, css) {
  const regions = mapData.regions || [];
  const splitGuardRegions = regions.filter(region => falseSplitLabels(region).length);
  const pointerGuardRegions = regions.filter(hasPointerGuard);
  const residualProofRegions = regions.filter(hasResidualProofGuard);
  const checks = presenceChecks(html, mapPanel, labPanel, css);
  const missingChecks = checks.filter(check => !check.present);

  return {
    id: reportId,
    type: 'analyzer_guard_ui_audit',
    generatedAt: now,
    schemaVersion: 1,
    tool: `${toolName}${apply ? ' --apply' : ''}`,
    summary: {
      splitGuardRegionCount: splitGuardRegions.length,
      splitGuardLabelCount: splitGuardRegions.reduce((sum, region) => sum + falseSplitLabels(region).length, 0),
      pointerGuardRegionCount: pointerGuardRegions.length,
      residualProofGuardRegionCount: residualProofRegions.length,
      uiPresenceCheckCount: checks.length,
      uiPresenceChecksPassed: checks.filter(check => check.present).length,
      residualFocusedCommandUiCheckCount: checks.filter(check => check.id.includes('residual_focused')).length,
      residualFocusedCommandUiChecksPassed: checks.filter(check => check.id.includes('residual_focused') && check.present).length,
      residualTemplateExportUiCheckCount: checks.filter(check => check.id.includes('residual_template_export')).length,
      residualTemplateExportUiChecksPassed: checks.filter(check => check.id.includes('residual_template_export') && check.present).length,
      labPresenceCheckCount: checks.filter(check => check.path === 'tools/js/panel-lab.js' || check.id.startsWith('html_lab_') || check.id.startsWith('css_lab_')).length,
      missingUiPresenceCheckCount: missingChecks.length,
      readyForAnalyzerUse: missingChecks.length === 0 && splitGuardRegions.length === 6 && pointerGuardRegions.length === 19 && residualProofRegions.length === 5,
      persistedRomByteCount: 0,
      persistedPixelCount: 0,
      persistedAudioByteCount: 0,
      persistedInstructionByteCount: 0,
    },
    guardedRegions: {
      falseSplit: splitGuardRegions.map(region => ({
        id: region.id,
        offset: region.offset,
        type: region.type || 'unknown',
        labels: falseSplitLabels(region).map(label => ({
          label: label.label,
          offset: label.offset,
          pointerPromotionAction: label.pointerPromotionAction,
        })),
      })),
      pointerPreservation: pointerGuardRegions.map(region => ({
        id: region.id,
        offset: region.offset,
        type: region.type || 'unknown',
        label: region.analysis?.asmPointerCandidateResolutionAudit?.label || null,
        genericPointerTableAction: region.analysis?.asmPointerCandidateResolutionAudit?.genericPointerTableDecision?.action || null,
      })),
      residualProof: residualProofRegions.map(region => ({
        id: region.id,
        offset: region.offset,
        type: region.type || 'unknown',
        kind: region.analysis?.lowConfidenceResidualTriageAudit?.kind || null,
        status: region.analysis?.lowConfidenceResidualTriageAudit?.status || null,
        traceKind: region.analysis?.lowConfidenceResidualTriageAudit?.proofPlan?.traceKind || null,
      })),
    },
    uiChecks: checks,
    validationIssues: missingChecks.map(check => `Missing ${check.requiredText} in ${check.path}.`),
    evidence: [
      'False-split guard counts come from region.analysis.asmFalseSplitLabelAudit labels with reject_standalone_pointer_table_promotion.',
      'Pointer-preservation guard counts come from region.analysis.asmPointerCandidateResolutionAudit genericPointerTableDecision actions.',
      'Residual proof guard counts come from region.analysis.lowConfidenceResidualTriageAudit proof plans for quarantined low-confidence residuals.',
      'UI presence checks inspect tools/rom-analyzer.html, tools/js/panel-map.js, and tools/rom-analyzer.css for controls, predicates, badges, and styles.',
      'Focused residual command checks verify that the analyzer renders per-region observation-audit, confirmation, proof-plan, and closure-pipeline commands from the capture checklist metadata.',
      'Residual template export checks verify that the analyzer can emit a focused metadata-only observation template from capture checklist metadata without ROM payloads.',
      'Laboratory presence checks inspect tools/js/panel-lab.js for guarded split/retype confirmation and top-level audit preservation helpers.',
    ],
    nextLeads: [
      'Use these UI filters before running broad pointer scans or manual map edits over stream-like regions.',
      'Use the Laboratory guard panel before manual split/retype edits over protected stream-like or specialized-table regions.',
      'Use the RESIDUAL? filter and proof plans before promoting the final low-confidence residual fragments into any default asset decoder.',
      'Use focused residual command copy controls to run one region-scoped capture and closure workflow at a time.',
      'Use focused template export controls when browser-native template generation is faster than running the CLI template command.',
      'Keep this audit metadata-only; do not persist ROM bytes, decoded pixels, audio payloads, or instruction bytes.',
    ],
  };
}

function main() {
  const mapData = readJson(mapPath);
  const html = readText(htmlPath);
  const mapPanel = readText(mapPanelPath);
  const labPanel = readText(labPanelPath);
  const css = readText(cssPath);
  const report = buildReport(mapData, html, mapPanel, labPanel, css);

  if (apply) {
    mapData.analysisReports = (mapData.analysisReports || []).filter(item => item.id !== reportId);
    mapData.analysisReports.push(report);
    fs.writeFileSync(mapPath, `${JSON.stringify(mapData, null, 2)}\n`);
  }

  console.log(JSON.stringify({
    applied: apply,
    reportId,
    summary: report.summary,
    validationIssues: report.validationIssues,
  }, null, 2));
}

main();
