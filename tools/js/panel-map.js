'use strict';

function populateMapTypeFilter(){
  const sel=document.getElementById('map-type-filter');
  if(!sel)return;
  const current=sel.value||'';
  const options=['<option value="">ALL TYPES</option>']
    .concat(Object.entries(TYPE_META).map(([value,meta])=>`<option value="${value}">${meta.label}</option>`));
  sel.innerHTML=options.join('');
  sel.value=current;
}

function mapEscapeAttr(value){
  return String(value ?? '')
    .replace(/&/g,'&amp;')
    .replace(/"/g,'&quot;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;');
}

function mapFalseSplitLabels(r){
  const audit=r.analysis?.asmFalseSplitLabelAudit;
  const labels=Array.isArray(audit?.labels)?audit.labels:[];
  return labels.filter(label=>label.pointerPromotionAction==='reject_standalone_pointer_table_promotion');
}

function mapHasFalseSplitGuard(r){
  return mapFalseSplitLabels(r).length>0;
}

function mapHasPointerGuard(r){
  const decision=r.analysis?.asmPointerCandidateResolutionAudit?.genericPointerTableDecision;
  return decision?.action==='reject_generic_pointer_table_retype';
}

function mapHasResidualProofGuard(r){
  return Boolean(r.analysis?.lowConfidenceResidualTriageAudit?.proofPlan);
}

function mapLatestCatalog(list){
  return Array.isArray(list)&&list.length?list[list.length-1]:null;
}

function mapCountDecision(decisions, decision){
  return (decisions||[]).filter(item=>item.decision===decision).length;
}

function mapResidualTraceRegions(){
  return (mapData.regions||[]).filter(r=>
    r.analysis?.residualRuntimeProofClosureIndexAudit ||
    r.analysis?.lowConfidenceResidualTriageAudit?.proofPlan ||
    r.analysis?.residualLiveClosureStatusIndexAudit ||
    r.analysis?.residualRuntimeTraceConfirmationAudit ||
    r.analysis?.residualSemanticDispositionPlanAudit ||
    r.analysis?.residualRuntimeClosurePipelineAudit ||
    r.analysis?.residualRuntimeCaptureChecklistAudit
  );
}

function mapTraceDecisionClass(decision){
  if(decision==='confirmed_direct_consumer_ready_for_residual_update')return'confirmed';
  if(decision==='confirmed_field_or_alias_rejection_keep_quarantined'||decision==='rejected_for_forbidden_payload')return'rejected';
  return'pending';
}

function mapCompactList(values, limit=4){
  const list=(values||[]).filter(Boolean).map(value=>String(value));
  if(!list.length)return'';
  const shown=list.slice(0,limit).map(mapEscapeAttr).join(', ');
  const rest=list.length-limit;
  return rest>0?`${shown} +${rest}`:shown;
}

function mapChecklistCriteria(values){
  const list=(values||[]).filter(Boolean);
  if(!list.length)return'';
  const title=list.map(item=>`- ${item}`).join('\n');
  return `<span title="${mapEscapeAttr(title)}">${mapEscapeAttr(list[0])}${list.length>1?` <span class="trace-summary-muted">+${list.length-1}</span>`:''}</span>`;
}

function mapResidualLiveClass(record){
  if(record?.closureReady||record?.semanticPromotionReady)return'confirmed';
  if(record?.readRangeUnbound)return'rejected';
  return'pending';
}

function mapResidualLiveClosureHtml(catalog){
  if(!catalog)return'';
  const records=Array.isArray(catalog.records)?catalog.records:[];
  if(!records.length)return'';
  const rows=records.map(record=>{
    const region=record.region||{};
    const blocked=mapCompactList(record.blockedReasons,3)||'none';
    const commandKeys=mapCompactList(record.commandKeys,4)||'not cataloged';
    const title=[
      record.status,
      `Next evidence: ${record.nextRequiredEvidence||'unknown'}`,
      `Blocked: ${(record.blockedReasons||[]).join(', ')||'none'}`,
      `Commands: ${(record.commandKeys||[]).join(', ')||'not cataloged'}`
    ].filter(Boolean).join('\n');
    return `<tr title="${mapEscapeAttr(title)}">
      <td>
        <div class="trace-summary-region">${mapEscapeAttr(region.id||'')} <span>${mapEscapeAttr(region.offset||'')}</span></div>
        <div class="trace-summary-muted">${mapEscapeAttr(record.residualFamily||'')} · priority ${mapEscapeAttr(String(record.priorityBucket??'?'))}</div>
      </td>
      <td>${mapEscapeAttr(record.liveClosureStatus||'waiting')}</td>
      <td>${mapEscapeAttr(record.nextRequiredEvidence||'unknown')}</td>
      <td>${mapEscapeAttr(record.readRangeStatus||'unknown')}${record.readRangeHitObserved?' · hit':''}${record.readRangeUnbound?' · unbound':''}</td>
      <td>${mapEscapeAttr(blocked)}</td>
      <td>${mapEscapeAttr(commandKeys)}</td>
    </tr>`;
  }).join('');
  const summary=catalog.summary||{};
  const priority=(summary.priorityOrderRegionIds||[]).join(', ')||records.map(record=>record.region?.id).filter(Boolean).join(', ');
  return `<details class="trace-summary-checklist" open>
    <summary>Residual live closure queue · ${mapEscapeAttr(String(summary.residualRegionCount??records.length))} target(s) · ${mapEscapeAttr(String(summary.waitingForLiveEvidenceCount??0))} waiting · priority ${mapEscapeAttr(priority||'not cataloged')}</summary>
    <div class="trace-summary-table-wrap">
      <table class="trace-summary-table">
        <thead><tr><th>Target</th><th>Status</th><th>Next evidence</th><th>Read range</th><th>Blocked by</th><th>Command keys</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </details>`;
}

function mapRegionTemplateCommand(item){
  const regionId=item?.region?.id||'';
  return item?.regionTemplateCommand||
    (regionId?`node tools/world-residual-runtime-trace-local-bundle.mjs --template --region ${regionId} --out tmp/local-hook-observations.${regionId}.template.json`:'');
}

function mapResidualTemplateFileName(item){
  const regionId=item?.region?.id||'residual';
  return `local-hook-observations.${regionId}.template.json`;
}

function mapResidualTemplateFieldValue(field,item,hook){
  const region=item?.region||{};
  const targetOffset=(item?.targetOffsets||[])[0]||region.offset||null;
  if(field==='same_frame_trace_id')return item?.sameFrameTraceTemplateId||`residual-${region.id||'target'}-template-0001`;
  if(field==='target_region_id')return region.id||null;
  if(field==='target_offset')return targetOffset;
  if(field==='runtime_trace_kind')return null;
  if(field==='direct_consumer_confirmed')return false;
  if(field==='field_or_alias_only_rejected')return false;
  if(field==='promotion_ready')return false;
  if(field==='loader_source_region_id')return region.id||null;
  if(field==='loader_source_offset')return targetOffset;
  if(field==='cursor_region_id')return region.id||null;
  if(field==='read_region_id')return region.id||null;
  if(field.endsWith('_offset')||field==='computed_record_end_exclusive')return targetOffset;
  if(field==='consumer_label')return hook?.label||null;
  if(field==='access_role')return null;
  return null;
}

function mapResidualObservationTemplate(item){
  const region=item?.region||{};
  const traceId=item?.sameFrameTraceTemplateId||`residual-${region.id||'target'}-template-0001`;
  const observations=(item?.hookChecklist||[]).map(hook=>{
    const observation={hookId:hook.hookId,same_frame_trace_id:traceId};
    if(hook.hookId==='residual_runtime_promotion_gate'){
      observation.kind='promotion_gate';
      observation.regionId=region.id||null;
    }
    (hook.captureFields||[]).forEach(field=>{
      const value=mapResidualTemplateFieldValue(field,item,hook);
      if(value!==undefined)observation[field]=value;
    });
    return observation;
  });
  return {
    schemaVersion:1,
    eventKind:'wb3_residual_runtime_trace_observation_template',
    templateOnly:true,
    sourceCatalog:'world-residual-runtime-capture-checklist-catalog-2026-06-26',
    generatedBy:'tools/rom-analyzer.html residual checklist export',
    assetPolicy:'Metadata-only local observation template. It contains hook ids, region ids, offsets, allowed capture field names, booleans, null placeholders, and command paths only. Do not add ROM bytes, stream bytes, tile ids, palette values, VDP port values, register traces, decoded pixels, screenshots, hashes, instruction bytes, audio bytes, or samples.',
    instructions:[
      'Use this file as a focused starting point for tmp/local-hook-observations.json.',
      'Keep same_frame_trace_id identical across observations that prove the same runtime frame/path.',
      'Replace null placeholders with metadata-only values observed by the clean runtime.',
      'Do not add forbidden raw payload fields or copied template placeholders as runtime evidence.',
    ],
    summary:{
      tracePlanCount:1,
      regionFilter:region.id?[region.id]:[],
      observationCount:observations.length,
      requiredObservationCount:item?.requiredObservationCount||observations.length,
      defaultFilledObservationPath:item?.filledObservationPath||'tmp/local-hook-observations.json',
      defaultObservationAuditOutputPath:'tmp/world-residual-runtime-trace-observation-audit.local.json',
      defaultBundleOutputPath:'tmp/world-residual-runtime-trace-events.local.json',
      persistedRomByteCount:0,
      persistedStreamByteCount:0,
      persistedTileIdCount:0,
      persistedPaletteByteCount:0,
      persistedPortValueCount:0,
      persistedRegisterTraceCount:0,
      persistedPixelCount:0,
      persistedAudioByteCount:0,
      persistedInstructionByteCount:0,
    },
    traceGroups:[{
      planId:item?.planId||null,
      regionId:region.id||null,
      classId:item?.classId||'',
      targetOffsets:item?.targetOffsets||[],
      same_frame_trace_id:traceId,
      requiredRuntimeHookIds:item?.requiredRuntimeHookIds||[],
      observationIndexes:observations.map((_,index)=>index),
    }],
    commands:{
      validateObservations:item?.focusedObservationAuditCommand||'',
      buildBundle:item?.focusedBundleCommand||item?.bundleCommand||'',
      buildReviewedBundle:item?.focusedReviewedBundleCommand||item?.reviewedBundleCommand||'',
      confirmBundle:item?.focusedConfirmationCommand||'',
      writePlan:item?.focusedProofPlanCommand||'',
      runPipeline:item?.focusedClosurePipelineCommand||'',
    },
    observations,
  };
}

function mapDownloadJsonFile(filename,payload){
  const blob=new Blob([`${JSON.stringify(payload,null,2)}\n`],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;
  link.download=filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function mapTraceCommandControlHtml(command, label, title, datasetName='trace-command'){
  if(!command)return'';
  const dataAttr=datasetName==='template-command'?'data-template-command':'data-trace-command';
  return `<div class="trace-summary-template-control trace-summary-command-control">
    <button class="trace-summary-copy" type="button" ${dataAttr}="${mapEscapeAttr(command)}" title="${mapEscapeAttr(title||`Copy ${label} command`)}">COPY</button>
    <div>
      <div class="trace-summary-command-label">${mapEscapeAttr(label||'command')}</div>
      <div class="trace-summary-template-command" title="${mapEscapeAttr(command)}">${mapEscapeAttr(command)}</div>
    </div>
  </div>`;
}

function mapResidualTemplateCommandHtml(item){
  const command=mapRegionTemplateCommand(item);
  if(!command)return'<span class="trace-summary-muted">not cataloged</span>';
  const regionId=item?.region?.id||'';
  const exportButton=regionId?`<button class="trace-summary-copy trace-summary-export" type="button" data-template-export-region="${mapEscapeAttr(regionId)}" title="Export metadata-only focused observation template">EXPORT</button>`:'';
  return `${mapTraceCommandControlHtml(command,'template','Copy region-scoped template command','template-command')}
    <div class="trace-summary-export-row">${exportButton}<span class="trace-summary-muted">${mapEscapeAttr(mapResidualTemplateFileName(item))}</span></div>`;
}

function mapResidualFocusedCommandsHtml(item){
  const commands=[
    ['audit',item.focusedObservationAuditCommand,'Copy focused observation-audit command'],
    ['bundle',item.focusedBundleCommand,'Copy focused bundle command'],
    ['reviewed bundle',item.focusedReviewedBundleCommand,'Copy focused reviewed-bundle command'],
    ['confirm',item.focusedConfirmationCommand,'Copy focused confirmation command'],
    ['proof',item.focusedProofPlanCommand,'Copy focused proof-plan command'],
    ['closure',item.focusedClosurePipelineCommand,'Copy focused closure-pipeline command'],
  ].filter(entry=>entry[1]);
  if(!commands.length)return'<span class="trace-summary-muted">not cataloged</span>';
  return `<div class="trace-summary-command-list">${commands.map(([label,command,title])=>
    mapTraceCommandControlHtml(command,label,title)
  ).join('')}</div>`;
}

function mapBindResidualTemplateControls(root){
  if(!root)return;
  root.querySelectorAll('[data-template-command],[data-trace-command]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const command=btn.dataset.templateCommand||btn.dataset.traceCommand||'';
      const done=()=>{
        const old=btn.textContent;
        btn.textContent='COPIED';
        setTimeout(()=>{btn.textContent=old||'COPY';},1200);
      };
      if(navigator.clipboard?.writeText){
        navigator.clipboard.writeText(command).then(done).catch(()=>{
          showToast('Unable to copy command',true);
        });
      }else{
        const area=document.createElement('textarea');
        area.value=command;
        area.style.position='fixed';
        area.style.left='-9999px';
        document.body.appendChild(area);
        area.focus();
        area.select();
        try{
          document.execCommand('copy');
          done();
        }catch(e){
          showToast('Unable to copy command',true);
        }
        document.body.removeChild(area);
      }
    });
  });
  root.querySelectorAll('[data-template-export-region]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const regionId=btn.dataset.templateExportRegion||'';
      const item=window.mapResidualCaptureChecklistByRegion?.[regionId];
      if(!item){
        showToast('Template metadata not found',true);
        return;
      }
      const fileName=mapResidualTemplateFileName(item);
      const payload=mapResidualObservationTemplate(item);
      window.mapLastResidualTemplateExport={regionId,fileName,payload};
      mapDownloadJsonFile(fileName,payload);
      const old=btn.textContent;
      btn.textContent='EXPORTED';
      setTimeout(()=>{btn.textContent=old||'EXPORT';},1200);
    });
  });
}

function mapResidualCaptureChecklistHtml(catalog){
  const items=Array.isArray(catalog?.checklists)?catalog.checklists:[];
  if(!items.length)return'';
  window.mapResidualCaptureChecklistByRegion=Object.fromEntries(items
    .map(item=>[item?.region?.id,item])
    .filter(entry=>entry[0]));
  const rows=items.map(item=>{
    const region=item.region||{};
    const hooks=(item.hookChecklist||[]).map(hook=>{
      const fields=mapCompactList(hook.captureFields||[],5);
      const hookTitle=[
        hook.hookId||'',
        hook.label?`label ${hook.label}`:'',
        hook.offset?`offset ${hook.offset}`:'',
        fields?`fields ${fields}`:'',
      ].filter(Boolean).join('; ');
      return `<div class="trace-summary-hook" title="${mapEscapeAttr(hookTitle)}">
        <span class="trace-summary-hook-id">${mapEscapeAttr(hook.hookId||'')}</span>
        <span class="trace-summary-hook-meta">${mapEscapeAttr(hook.label||hook.offset||'')}</span>
        <span class="trace-summary-hook-fields">${fields}</span>
      </div>`;
    }).join('');
    return `<tr>
      <td>
        <div class="trace-summary-region">${mapEscapeAttr(region.id||'')} <span>${mapEscapeAttr(region.offset||'')}</span></div>
        <div class="trace-summary-muted">${mapEscapeAttr(item.classId||'')} · ${mapEscapeAttr(region.type||'')} · ${mapEscapeAttr(region.confidence||'')}</div>
      </td>
      <td>${mapEscapeAttr((item.targetOffsets||[]).join(', '))}</td>
      <td>${mapEscapeAttr(String(item.requiredObservationCount??((item.requiredRuntimeHookIds||[]).length||0)))}</td>
      <td>${hooks}</td>
      <td>${mapResidualTemplateCommandHtml(item)}</td>
      <td>${mapResidualFocusedCommandsHtml(item)}</td>
      <td>${mapChecklistCriteria(item.confirmationCriteria)}</td>
      <td>${mapChecklistCriteria(item.rejectionCriteria)}</td>
    </tr>`;
  }).join('');
  const summary=catalog.summary||{};
  return `<details class="trace-summary-checklist" open>
    <summary>Residual capture checklist · ${mapEscapeAttr(String(summary.targetRegionCount??items.length))} target(s) · ${mapEscapeAttr(String(summary.requiredObservationCount??0))} observation(s)</summary>
    <div class="trace-summary-table-wrap">
      <table class="trace-summary-table">
        <thead><tr><th>Target</th><th>Offset</th><th>Obs</th><th>Required hooks</th><th>Template</th><th>Focused flow</th><th>Confirm</th><th>Reject / keep</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </details>`;
}

function renderResidualTraceSummary(){
  const wrap=document.getElementById('residual-trace-summary');
  if(!wrap)return;
  const bridge=mapLatestCatalog(mapData.runtimeTraceHookBridgeCatalogs);
  const observation=mapLatestCatalog(mapData.runtimeTraceObservationAuditCatalogs);
  const confirmation=mapLatestCatalog(mapData.runtimeTraceConfirmationCatalogs);
  const proofPlan=mapLatestCatalog(mapData.residualProofUpdatePlanCatalogs);
  const semanticPlan=mapLatestCatalog(mapData.residualSemanticDispositionPlanCatalogs);
  const closurePipeline=mapLatestCatalog(mapData.residualRuntimeClosurePipelineCatalogs);
  const captureChecklist=mapLatestCatalog(mapData.residualRuntimeCaptureChecklistCatalogs);
  const liveClosure=mapLatestCatalog(mapData.residualLiveClosureStatusCatalogs);
  const residuals=mapResidualTraceRegions();
  if(!bridge&&!confirmation&&!proofPlan&&!semanticPlan&&!closurePipeline&&!captureChecklist&&!liveClosure&&!residuals.length){
    wrap.style.display='none';
    wrap.innerHTML='';
    return;
  }

  const bridgeSummary=bridge?.summary||{};
  const confirmationSummary=confirmation?.summary||{};
  const decisions=confirmation?.decisions||[];
  const confirmed=mapCountDecision(decisions,'confirmed_direct_consumer_ready_for_residual_update');
  const rejected=mapCountDecision(decisions,'confirmed_field_or_alias_rejection_keep_quarantined')+
    mapCountDecision(decisions,'rejected_for_forbidden_payload');
  const pending=confirmationSummary.pendingInsufficientCount??mapCountDecision(decisions,'pending_insufficient_runtime_evidence');
  const ready=bridgeSummary.readyForCleanRuntimeBridge===true;
  const observationSummary=observation?.summary||{};
  const templatePlaceholderGuard=observationSummary.rejectsCopiedTemplatePlaceholders===true;
  const requiredFieldGuard=observationSummary.rejectsMissingRequiredCaptureFields===true;
  const localTemplate=observationSummary.defaultTemplatePath||bridgeSummary.localObservationTemplateDefaultOutput||'tmp/local-hook-observations.template.json';
  const localAudit=observationSummary.defaultObservationAuditOutputPath||bridgeSummary.localObservationAuditDefaultOutput||'tmp/world-residual-runtime-trace-observation-audit.local.json';
  const localOut=observationSummary.defaultBundleOutputPath||bridgeSummary.localBundleDefaultOutput||'tmp/world-residual-runtime-trace-events.local.json';
  const templateCommand=`node tools/world-residual-runtime-trace-local-bundle.mjs --template --out ${localTemplate}`;
  const auditCommand=`node tools/world-residual-runtime-trace-observation-audit.mjs --observations tmp/local-hook-observations.json --out ${localAudit}`;
  const command=`node tools/world-residual-runtime-trace-local-bundle.mjs --observations tmp/local-hook-observations.json --out ${localOut}`;
  const proofSummary=proofPlan?.summary||{};
  const proofOut=proofSummary.defaultPlanOutputPath||'tmp/world-residual-runtime-proof-update-plan.local.json';
  const proofCommand=proofPlan?.commands?.writePlan||`node tools/world-residual-runtime-proof-update-plan-audit.mjs --events ${localOut} --out ${proofOut}`;
  const semanticSummary=semanticPlan?.summary||{};
  const closureSummary=closurePipeline?.summary||{};
  const closureInput=closureSummary.defaultObservationInputPath||'tmp/local-hook-observations.json';
  const closureOut=closureSummary.defaultPipelineOutputPath||'tmp/world-residual-runtime-closure-pipeline.local.json';
  const closureCommand=closurePipeline?.commands?.runPipeline||`node tools/world-residual-runtime-closure-pipeline-audit.mjs --observations ${closureInput} --out ${closureOut}`;
  const checklistSummary=captureChecklist?.summary||{};
  const checklistCommand=captureChecklist?.commands?.runChecklistAudit||'node tools/world-residual-runtime-capture-checklist-audit.mjs --apply';
  const templatePackCommand=captureChecklist?.commands?.generateRegionTemplatePack||'node tools/world-residual-runtime-trace-local-bundle.mjs --template-pack --out tmp/local-hook-observations.templates';
  const checklistHtml=mapResidualCaptureChecklistHtml(captureChecklist);
  const liveSummary=liveClosure?.summary||{};
  const liveClosureHtml=mapResidualLiveClosureHtml(liveClosure);
  const chips=residuals.map(r=>{
    const decision=r.analysis?.residualRuntimeTraceConfirmationAudit?.detail?.decision||
      (decisions.find(item=>item.regionId===r.id)?.decision)||
      'pending_insufficient_runtime_evidence';
    const liveAudit=r.analysis?.residualLiveClosureStatusIndexAudit;
    const klass=liveAudit?mapResidualLiveClass(liveAudit):mapTraceDecisionClass(decision);
    const title=liveAudit?
      `${decision}\nLive closure: ${liveAudit.liveClosureStatus||'waiting'}\nNext evidence: ${liveAudit.nextRequiredEvidence||'unknown'}\nBlocked: ${(liveAudit.blockedReasons||[]).join(', ')||'none'}`:
      decision;
    return `<span class="trace-summary-chip ${klass}" title="${mapEscapeAttr(title)}">${r.id} ${r.offset}</span>`;
  }).join('');

  wrap.innerHTML=`
    <div class="trace-summary-head">
      <div class="trace-summary-title">Residual runtime trace bridge</div>
      <div class="trace-summary-status">${ready?'ready for metadata bundles':'not ready'} · live queue ${mapEscapeAttr(String(liveSummary.waitingForLiveEvidenceCount??'not cataloged'))} waiting · checklist ${mapEscapeAttr(String(checklistSummary.targetRegionCount??'not cataloged'))} target(s) · pipeline ${mapEscapeAttr(closureSummary.guardStatus||'not cataloged')} · ${mapEscapeAttr(bridge?.id||'no bridge catalog')}</div>
    </div>
    <div class="trace-summary-grid">
      <div class="trace-summary-stat"><div class="trace-summary-value ${ready?'ok':'warn'}">${ready?'YES':'NO'}</div><div class="trace-summary-label">Bridge ready</div></div>
      <div class="trace-summary-stat"><div class="trace-summary-value">${bridgeSummary.hookCount??0}</div><div class="trace-summary-label">Hooks</div></div>
      <div class="trace-summary-stat"><div class="trace-summary-value bad">${residuals.length}</div><div class="trace-summary-label">Runtime gated</div></div>
      <div class="trace-summary-stat"><div class="trace-summary-value ok">${confirmed||0}</div><div class="trace-summary-label">Confirmed</div></div>
      <div class="trace-summary-stat"><div class="trace-summary-value warn">${pending||0}</div><div class="trace-summary-label">Pending</div></div>
      <div class="trace-summary-stat"><div class="trace-summary-value bad">${rejected||0}</div><div class="trace-summary-label">Rejected</div></div>
      <div class="trace-summary-stat"><div class="trace-summary-value ${proofSummary.proposedRegionUpdateCount?'ok':'warn'}">${proofSummary.proposedRegionUpdateCount??0}</div><div class="trace-summary-label">Planned</div></div>
      <div class="trace-summary-stat"><div class="trace-summary-value ${semanticSummary.semanticPromotionReadyCount?'ok':'warn'}">${semanticSummary.semanticPromotionReadyCount??0}</div><div class="trace-summary-label">Semantic ready</div></div>
      <div class="trace-summary-stat"><div class="trace-summary-value ${closureSummary.pipelineReady?'ok':'warn'}">${closureSummary.pipelineReady?'READY':'WAIT'}</div><div class="trace-summary-label">Pipeline</div></div>
      <div class="trace-summary-stat"><div class="trace-summary-value ${checklistSummary.targetRegionCount?'ok':'warn'}">${checklistSummary.requiredObservationCount??0}</div><div class="trace-summary-label">Checklist obs</div></div>
      <div class="trace-summary-stat"><div class="trace-summary-value ${templatePlaceholderGuard?'ok':'warn'}">${templatePlaceholderGuard?'ON':'OFF'}</div><div class="trace-summary-label">Template guard</div></div>
      <div class="trace-summary-stat"><div class="trace-summary-value ${requiredFieldGuard?'ok':'warn'}">${requiredFieldGuard?'ON':'OFF'}</div><div class="trace-summary-label">Field guard</div></div>
      <div class="trace-summary-stat"><div class="trace-summary-value ${liveSummary.liveClosureReadyCount?'ok':'warn'}">${liveSummary.liveClosureReadyCount??0}</div><div class="trace-summary-label">Live ready</div></div>
      <div class="trace-summary-stat"><div class="trace-summary-value warn">${liveSummary.waitingForLiveEvidenceCount??0}</div><div class="trace-summary-label">Live wait</div></div>
      <div class="trace-summary-stat"><div class="trace-summary-value ${liveSummary.outputCandidateOnlyCount?'warn':'ok'}">${liveSummary.outputCandidateOnlyCount??0}</div><div class="trace-summary-label">Candidate only</div></div>
      <div class="trace-summary-stat"><div class="trace-summary-value ${liveSummary.readRangeHitObservedCount?'ok':'warn'}">${liveSummary.readRangeHitObservedCount??0}</div><div class="trace-summary-label">Read hits</div></div>
      <div class="trace-summary-stat"><div class="trace-summary-value ${liveSummary.unboundReadRangeHitCount?'bad':'ok'}">${liveSummary.unboundReadRangeHitCount??0}</div><div class="trace-summary-label">Unbound hits</div></div>
    </div>
    <div class="trace-summary-command" title="Run from repository root">${mapEscapeAttr(templateCommand)}</div>
    <div class="trace-summary-command" title="Run from repository root after filling real observations">${mapEscapeAttr(auditCommand)}</div>
    <div class="trace-summary-command" title="Run from repository root after filling real observations">${mapEscapeAttr(command)}</div>
    <div class="trace-summary-command" title="Run from repository root after building a real event bundle">${mapEscapeAttr(proofCommand)}</div>
    <div class="trace-summary-command" title="Run from repository root for end-to-end residual closure">${mapEscapeAttr(closureCommand)}</div>
    <div class="trace-summary-command" title="Run from repository root to generate one focused template per residual target">${mapEscapeAttr(templatePackCommand)}</div>
    <div class="trace-summary-command" title="Run from repository root to refresh the residual capture checklist">${mapEscapeAttr(checklistCommand)}</div>
    ${checklistHtml}
    ${liveClosureHtml}
    <div class="trace-summary-list">${chips}</div>`;
  wrap.style.display='';
  mapBindResidualTemplateControls(wrap);
}

function mapRegionAnalysisBadges(r){
  const badges=[];
  if(r.source==='asm')badges.push('<span class="src-badge">asm</span>');
  if(r.analysis)badges.push('<span class="src-badge" title="Has structured ROM-control metadata">meta</span>');
  const falseSplitLabels=mapFalseSplitLabels(r);
  if(falseSplitLabels.length){
    const labelText=falseSplitLabels.map(label=>`${label.label} @ ${label.offset}`).join('; ');
    const title=`Nested ASM split label(s) kept inside this stream; standalone pointer-table promotion rejected: ${labelText}`;
    badges.push(`<span class="src-badge guard-split" title="${mapEscapeAttr(title)}">split guard</span>`);
  }
  const pointerAudit=r.analysis?.asmPointerCandidateResolutionAudit;
  if(mapHasPointerGuard(r)){
    const decision=pointerAudit.genericPointerTableDecision||{};
    const targetText=pointerAudit.parsedFromAsm?.uniqueTargetCount??'?';
    const entryText=pointerAudit.parsedFromAsm?.entryCount??'?';
    const title=`Specialized ${r.type||'table'} preserved; generic pointer_table retype rejected. ${entryText} .dw entr${entryText===1?'y':'ies'}, ${targetText} unique target(s). ${decision.reason||''}`;
    badges.push(`<span class="src-badge guard-pointer" title="${mapEscapeAttr(title)}">table keep</span>`);
  }
  const residualAudit=r.analysis?.lowConfidenceResidualTriageAudit;
  if(mapHasResidualProofGuard(r)){
    const traceKind=residualAudit.proofPlan?.traceKind||'consumer trace';
    const requiredProof=residualAudit.proofPlan?.requiredProof||residualAudit.requiredNextTrace||'Direct consumer proof required before promotion.';
    const proofAudit=r.analysis?.residualProofConsumerAudit;
    const proofStatus=proofAudit?` Static proof audit: ${proofAudit.status||'status unknown'}; ${proofAudit.disposition||'disposition unknown'}.`:'';
    const title=`Quarantined residual: ${residualAudit.kind||'low-confidence residual'}; ${traceKind}. ${requiredProof}${proofStatus}`;
    badges.push(`<span class="src-badge guard-residual" title="${mapEscapeAttr(title)}">proof wait</span>`);
  }
  const residualClosure=r.analysis?.residualRuntimeProofClosureIndexAudit;
  if(residualClosure){
    const gate=residualClosure.runtimeGate||{};
    const title=`${residualClosure.closureStatus||'runtime proof required'}; default decoder excluded: ${residualClosure.defaultDecoderExcluded?'yes':'no'}; ${gate.traceKind||'runtime trace'}; ${gate.requiredProof||''}`;
    badges.push(`<span class="src-badge guard-residual" title="${mapEscapeAttr(title)}">runtime gate</span>`);
  }
  const residualHookPlan=r.analysis?.residualRuntimeTraceHookPlanAudit;
  if(residualHookPlan){
    const roles=(residualHookPlan.roles||[residualHookPlan.role]).filter(Boolean).join(', ')||'trace participant';
    const hooks=(residualHookPlan.hookIds||[residualHookPlan.hookId]).filter(Boolean).join(', ');
    const plans=(residualHookPlan.tracePlanIds||[residualHookPlan.tracePlanId]).filter(Boolean).join(', ');
    const title=`Residual runtime trace hook plan: ${roles}; ${hooks?`hooks ${hooks}; `:''}${plans?`plans ${plans}; `:''}promotion ready: ${residualHookPlan.promotionReady?'yes':'no'}`;
    badges.push(`<span class="src-badge guard-residual" title="${mapEscapeAttr(title)}">trace hook</span>`);
  }
  const residualTraceContract=r.analysis?.residualRuntimeTraceEventContractAudit;
  if(residualTraceContract){
    const hooks=(residualTraceContract.hookIds||[]).join(', ');
    const plans=(residualTraceContract.tracePlanIds||[]).join(', ');
    const title=`Residual runtime trace event contract: fields ${residualTraceContract.allowedFieldCount||0}; forbidden keys ${residualTraceContract.forbiddenPayloadKeyCount||0}; ${hooks?`hooks ${hooks}; `:''}${plans?`plans ${plans}; `:''}policy rejects payloads: ${residualTraceContract.policyRejectsForbiddenPayloads?'yes':'no'}`;
    badges.push(`<span class="src-badge guard-residual" title="${mapEscapeAttr(title)}">trace event</span>`);
  }
  const residualTraceBridge=r.analysis?.residualRuntimeTraceHookBridgeAudit;
  if(residualTraceBridge){
    const hooks=(residualTraceBridge.hookIds||[]).join(', ');
    const plans=(residualTraceBridge.tracePlanIds||[]).join(', ');
    const title=`Residual runtime trace hook bridge: ready ${residualTraceBridge.readyForCleanRuntimeBridge?'yes':'no'}; capture issues ${residualTraceBridge.captureFieldIssueCount||0}; ${hooks?`hooks ${hooks}; `:''}${plans?`plans ${plans}; `:''}${residualTraceBridge.bridgeModule||''}`;
    badges.push(`<span class="src-badge guard-residual" title="${mapEscapeAttr(title)}">trace bridge</span>`);
  }
  const residualTraceEval=r.analysis?.residualRuntimeTraceEvaluatorAudit;
  if(residualTraceEval){
    const title=`Residual runtime trace evaluator: ${residualTraceEval.finalStatus||'pending'}; confirmed ${residualTraceEval.runtimeTraceConfirmed?'yes':'no'}; rejected ${residualTraceEval.fieldOrAliasOnlyRejected?'yes':'no'}; event source ${residualTraceEval.eventSource||'none'}`;
    badges.push(`<span class="src-badge guard-residual" title="${mapEscapeAttr(title)}">trace eval</span>`);
  }
  const residualTraceConfirm=r.analysis?.residualRuntimeTraceConfirmationAudit;
  if(residualTraceConfirm){
    const detail=residualTraceConfirm.detail||{};
    const title=`Residual runtime trace confirmation: ${detail.decision||'pending'}; ${detail.reason||''}; semantic disposition mutated: ${detail.residualSemanticDispositionMutated?'yes':'no'}`;
    badges.push(`<span class="src-badge guard-residual" title="${mapEscapeAttr(title)}">trace decision</span>`);
  }
  const residualProofPlan=r.analysis?.residualRuntimeProofUpdatePlanAudit;
  if(residualProofPlan){
    const title=`Residual runtime proof update plan: ${residualProofPlan.status||'pending'}; ${residualProofPlan.decision||'no decision'}; mutation eligible: ${residualProofPlan.mutationEligible?'yes':'no'}; event source ${residualProofPlan.eventSource||'none'}`;
    badges.push(`<span class="src-badge guard-residual" title="${mapEscapeAttr(title)}">proof plan</span>`);
  }
  const residualSemanticPlan=r.analysis?.residualSemanticDispositionPlanAudit;
  if(residualSemanticPlan){
    const title=`Residual semantic disposition plan: ${residualSemanticPlan.status||'pending'}; action ${residualSemanticPlan.proposedAction||'wait'}; class ${residualSemanticPlan.classId||'unknown'}; semantic ready: ${residualSemanticPlan.semanticPromotionReady?'yes':'no'}; event source ${residualSemanticPlan.eventSource||'none'}`;
    badges.push(`<span class="src-badge guard-residual" title="${mapEscapeAttr(title)}">semantic plan</span>`);
  }
  const residualClosurePipeline=r.analysis?.residualRuntimeClosurePipelineAudit;
  if(residualClosurePipeline){
    const title=`Residual closure pipeline: ${residualClosurePipeline.status||'waiting'}; input ${residualClosurePipeline.defaultObservationInputPath||'tmp/local-hook-observations.json'}; output ${residualClosurePipeline.defaultPipelineOutputPath||'tmp/world-residual-runtime-closure-pipeline.local.json'}; real map mutated: ${residualClosurePipeline.realMapMutatedByThisPipeline?'yes':'no'}`;
    badges.push(`<span class="src-badge guard-residual" title="${mapEscapeAttr(title)}">closure pipe</span>`);
  }
  const residualLiveClosure=r.analysis?.residualLiveClosureStatusIndexAudit;
  if(residualLiveClosure){
    const title=`Residual live closure: ${residualLiveClosure.liveClosureStatus||'waiting'}; next evidence ${residualLiveClosure.nextRequiredEvidence||'unknown'}; priority ${residualLiveClosure.priorityBucket??'?'}; closure ready ${residualLiveClosure.closureReady?'yes':'no'}; candidate only ${residualLiveClosure.outputCandidateOnly?'yes':'no'}; blocked ${(residualLiveClosure.blockedReasons||[]).join(', ')||'none'}`;
    badges.push(`<span class="src-badge guard-residual" title="${mapEscapeAttr(title)}">${residualLiveClosure.closureReady?'live ready':'live wait'}</span>`);
  }
  const residualCaptureChecklist=r.analysis?.residualRuntimeCaptureChecklistAudit;
  if(residualCaptureChecklist){
    const title=`Residual capture checklist: ${residualCaptureChecklist.status||'waiting'}; plan ${residualCaptureChecklist.planId||'unknown'}; required observations ${residualCaptureChecklist.requiredObservationCount??'?'}; input ${residualCaptureChecklist.defaultObservationInputPath||'tmp/local-hook-observations.json'}`;
    badges.push(`<span class="src-badge guard-residual" title="${mapEscapeAttr(title)}">capture list</span>`);
  }
  const embeddedScreen=r.analysis?.screenProgEmbeddedContinuationProofAudit;
  if(embeddedScreen){
    const roots=(embeddedScreen.rootRegionIds||[]).join(', ')||'root unknown';
    const title=`Embedded screen_prog continuation; group under root stream(s): ${roots}; ${embeddedScreen.defaultDecoderAction||'group under root'}`;
    badges.push(`<span class="src-badge" title="${mapEscapeAttr(title)}">screen cont</span>`);
  }
  const blankMeta=r.analysis?.blankMetaspriteQuarantineProofAudit;
  if(blankMeta){
    const title=`${blankMeta.status||'blank metasprite quarantine'}; runtime selector: ${blankMeta.runtimeSelectionStateConfidence||'unresolved'}; default decoder excluded: ${blankMeta.defaultDecoderExcluded?'yes':'no'}`;
    badges.push(`<span class="src-badge" title="${mapEscapeAttr(title)}">blank/noop</span>`);
  }
  const consumer=r.analysis?.unresolvedAssetConsumerAudit;
  if(consumer){
    const status=consumer.consumerStatus||'consumer status unknown';
    const isUnresolved=String(status).startsWith('consumer_unresolved');
    const loaderHits=consumer.loaderSourceHitCount??0;
    const medPtrs=consumer.mediumConfidencePointerRefCount??0;
    const lowPtrs=consumer.lowConfidencePointerRefCount??0;
    const title=`${status}; loader source hits ${loaderHits}; pointer leads ${medPtrs} medium / ${lowPtrs} low`;
    const label=isUnresolved?'consumer?':'consumer lead';
    badges.push(`<span class="src-badge" title="${mapEscapeAttr(title)}">${label}</span>`);
  }
  const pauseCoverage=r.analysis?.pauseStatusCandidateCoverageDisambiguation;
  if(pauseCoverage){
    const bytes=pauseCoverage.candidateUniqueBytes??0;
    const spans=pauseCoverage.candidateUniqueSpanCount??0;
    const title=`Pause/status 998-shaped coverage is candidate-only, not confirmed loader coverage; ${bytes} byte(s), ${spans} span(s)`;
    badges.push(`<span class="src-badge" title="${mapEscapeAttr(title)}">candidate gfx</span>`);
  }
  const pauseStream=r.analysis?.pauseStatusStreamLoaderDisambiguationAudit;
  if(pauseStream){
    const title=`${pauseStream.vdpStreamStatus||'VDP stream status unknown'}; ${pauseStream.loader998Status||'998 loader status unknown'}`;
    badges.push(`<span class="src-badge" title="${mapEscapeAttr(title)}">vdp/998?</span>`);
  }
  const dynamicTile=r.analysis?.dynamicTileSourceTableAudit;
  if(dynamicTile){
    const title=`${dynamicTile.kind||'dynamic tile source metadata'}; ${dynamicTile.summary||''}`;
    badges.push(`<span class="src-badge" title="${mapEscapeAttr(title)}">dyn tiles</span>`);
  }
  const entityDynamicTile=r.analysis?.roomEntityDynamicTileAudit;
  if(entityDynamicTile){
    const title=`${entityDynamicTile.kind||'room entity dynamic tile metadata'}; ${entityDynamicTile.summary||''}`;
    badges.push(`<span class="src-badge" title="${mapEscapeAttr(title)}">entity dyn</span>`);
  }
  return badges.join('');
}

// ═══════════════════════════════════════════════════════
//  REGIONS TABLE
// ═══════════════════════════════════════════════════════
function renderRegionsTable(){
  const tbody=document.getElementById('regions-tbody');
  const empty=document.getElementById('regions-empty');
  const label=document.getElementById('region-count-label');
  tbody.innerHTML='';
  const mapped=mapData.regions.filter(r=>r.type!=='unknown').length;
  const total=mapData.regions.length;

  // Apply filters
  const filterText=(document.getElementById('map-filter')?.value||'').toLowerCase().trim();
  const typeFilter=(document.getElementById('map-type-filter')?.value||'').trim();
  const unknownOnly=document.getElementById('chk-unknown-only')?.checked||false;
  const consumerUnresolvedOnly=document.getElementById('chk-consumer-unresolved')?.checked||false;
  const splitGuardOnly=document.getElementById('chk-split-guard')?.checked||false;
  const pointerGuardOnly=document.getElementById('chk-pointer-guard')?.checked||false;
  const residualProofOnly=document.getElementById('chk-residual-proof')?.checked||false;
  const visible=mapData.regions.filter(r=>{
    if(typeFilter&&r.type!==typeFilter)return false;
    if(unknownOnly&&r.type!=='unknown')return false;
    if(consumerUnresolvedOnly&&!String(r.analysis?.unresolvedAssetConsumerAudit?.consumerStatus||'').startsWith('consumer_unresolved'))return false;
    if(splitGuardOnly&&!mapHasFalseSplitGuard(r))return false;
    if(pointerGuardOnly&&!mapHasPointerGuard(r))return false;
    if(residualProofOnly&&!mapHasResidualProofGuard(r))return false;
    if(filterText){
      const haystack=(
        r.name+' '+
        r.offset+' '+
        (r.notes||'')+' '+
        (r.asmLabel||'')+' '+
        JSON.stringify(r.analysis||{})+' '+
        JSON.stringify(r.params||{})
      ).toLowerCase();
      if(!haystack.includes(filterText))return false;
    }
    return true;
  });

  const filterActive=filterText||unknownOnly||typeFilter||consumerUnresolvedOnly||splitGuardOnly||pointerGuardOnly||residualProofOnly;
  label.textContent=total
    ?(filterActive?`Showing ${visible.length} / ${total} — ${mapped} labeled, ${total-mapped} unknown`:`${total} regions — ${mapped} labeled, ${total-mapped} unknown`)
    :'';
  if(!total){empty.style.display='block';return;}
  empty.style.display=visible.length?'none':'block';
  if(!visible.length){empty.textContent='No regions match the current filter.';return;}
  empty.textContent='No regions defined yet.';

  // Build type options HTML once
  const typeOpts=Object.entries(TYPE_META).map(([v,m])=>`<option value="${v}">${m.label}</option>`).join('');

  for(const r of visible){
    const meta=TYPE_META[r.type]??TYPE_META.unknown;
    const rOff=parseHex(r.offset)??0;
    const isUnknown=r.type==='unknown';
    const isQueued=_mergeList.includes(r.id);
    const tr=document.createElement('tr');
    tr.dataset.id=r.id;
    tr.dataset.bank=bankOf(rOff);
    if(r.id===_labId)tr.classList.add('row-active');
    if(isQueued)tr.classList.add('row-queued');
    tr.innerHTML=`
      <td class="merge-cell"><input class="merge-check" type="checkbox" data-id="${r.id}"${isQueued?' checked':''} title="Queue region for merge"></td>
      <td style="color:var(--accent);white-space:nowrap">${r.offset}</td>
      <td style="color:var(--yellow);white-space:nowrap;font-size:11px">${bankAddrStr(rOff)}</td>
      <td style="color:var(--dim);white-space:nowrap">${(r.size??0).toLocaleString()}b</td>
      <td>
        <select class="type-select" data-id="${r.id}" style="border-color:${meta.color};color:${meta.color}">
          ${Object.entries(TYPE_META).map(([v,m])=>`<option value="${v}"${v===r.type?' selected':''}>${m.label}</option>`).join('')}
        </select>
        ${mapRegionAnalysisBadges(r)}
      </td>
      <td style="color:${isUnknown?'var(--dim)':'var(--text)'}">${r.name||'<span style="color:var(--dim);font-style:italic">unlabeled</span>'}</td>
      <td style="color:var(--dim);font-size:11px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.notes||''}">${r.notes||''}</td>
      <td style="white-space:nowrap">
        <button class="btn small${isUnknown?' primary':''}" data-view="${r.id}" style="margin-right:4px">${isUnknown?'⚗ LAB':'VIEW'}</button><button class="btn small" data-edit="${r.id}" title="Edit name / notes / type">✏</button>
      </td>`;
    tbody.appendChild(tr);
  }

  // Inline type change
  tbody.querySelectorAll('.type-select').forEach(sel=>sel.addEventListener('change',()=>{
    const r=mapData.regions.find(x=>x.id===sel.dataset.id);
    if(!r)return;
    r.type=sel.value;
    const meta=TYPE_META[sel.value]??TYPE_META.unknown;
    sel.style.borderColor=meta.color;sel.style.color=meta.color;
    refreshMapUI();
    showToast(`Type changed to "${meta.label}"`);
  }));

  tbody.querySelectorAll('.merge-check').forEach(chk=>chk.addEventListener('change',()=>{
    toggleMergeRegion(chk.dataset.id, chk.checked);
  }));

  // VIEW/LAB button
  tbody.querySelectorAll('[data-view]').forEach(btn=>btn.addEventListener('click',()=>{
    viewRegion(btn.dataset.view);
  }));
  // EDIT button — always opens lab regardless of type
  tbody.querySelectorAll('[data-edit]').forEach(btn=>btn.addEventListener('click',()=>{
    openLaboratory(btn.dataset.edit);
  }));
}


// ═══════════════════════════════════════════════════════
//  VIEW ROUTING
// ═══════════════════════════════════════════════════════
function viewRegion(id){
  const r=mapData.regions.find(x=>x.id===id);
  if(!r)return;
  const type=r.type;
  if(type==='gfx_tiles'||type==='gfx_sprites'){
    // Jump to tile viewer with correct offset + count
    const tileCount=Math.max(1,Math.min(512,Math.floor((r.size??0)/32)));
    document.getElementById('ctrl-offset').value=r.offset;
    document.getElementById('ctrl-count').value=tileCount||256;
    doRender();renderBanksGrid();
    document.getElementById('panel-viewer').scrollIntoView({behavior:'smooth'});
  } else if(type==='palette'){
    renderPaletteRegistry();
    document.getElementById('panel-palettes').scrollIntoView({behavior:'smooth'});
  } else if(type==='palette_manual'){
    // Open in Laboratory so the slot editor (labRenderTypePreview) is shown
    openLaboratory(id);
  } else {
    // unknown / code / map_screens / music / text → Laboratory
    openLaboratory(id);
  }
}


// ═══════════════════════════════════════════════════════
//  ADD REGION / CARVE
// ═══════════════════════════════════════════════════════
function addRegion(r){r.id=genId();mapData.regions.push(r);refreshMapUI();}

// Carve a new region out of any overlapping existing regions.
// Before/after fragments of split regions are kept; fully-consumed ones are removed.
function carveRegion(r) {
  r.id = genId();
  const newStart = parseHex(r.offset) ?? parseInt(r.offset, 10) ?? 0;
  const newEnd   = newStart + (r.size ?? 0);
  if (newEnd <= newStart) { showToast('Size must be > 0', true); return; }

  let splitCount = 0;
  const kept = [];
  for (const e of mapData.regions) {
    const eStart = parseHex(e.offset) ?? 0;
    const eEnd   = eStart + (e.size ?? 0);
    if (eEnd <= newStart || eStart >= newEnd) { kept.push(e); continue; } // no overlap
    // Before fragment
    if (eStart < newStart) kept.push({ ...e, id: genId(), size: newStart - eStart, analysis: undefined });
    // After fragment
    if (eEnd > newEnd)     kept.push({ ...e, id: genId(), offset: hexStr(newEnd), size: eEnd - newEnd, analysis: undefined });
    splitCount++;
  }
  kept.push(r);
  kept.sort((a, b) => (parseHex(a.offset) ?? 0) - (parseHex(b.offset) ?? 0));
  mapData.regions = kept;
  const note = splitCount ? ` · split ${splitCount} region${splitCount > 1 ? 's' : ''}` : '';
  showToast(`"${r.name || TYPE_META[r.type]?.label || r.type}" carved${note}`);
  refreshMapUI();
}


// ═══════════════════════════════════════════════════════
//  REFRESH MAP UI
// ═══════════════════════════════════════════════════════
function refreshMapUI(){
  renderResidualTraceSummary();
  renderRegionsTable();
  renderBankJumps();
  renderPaletteRegistry();
  updateProgress();
  renderRomMap();
  renderRomMapLegend();
  renderBanksGrid();
  compUpdateRegionSelects();
  compRenderSavedList();
  refreshViewerPalSelect();
  simRefreshStepTypeRegionFilter();
  triggerAutoSave();
}


// ═══════════════════════════════════════════════════════
//  ADD REGION FORM event bindings
// ═══════════════════════════════════════════════════════
document.getElementById('map-filter').addEventListener('input',renderRegionsTable);
document.getElementById('map-type-filter').addEventListener('change',renderRegionsTable);
document.getElementById('chk-unknown-only').addEventListener('change',renderRegionsTable);
document.getElementById('chk-consumer-unresolved').addEventListener('change',renderRegionsTable);
document.getElementById('chk-split-guard').addEventListener('change',renderRegionsTable);
document.getElementById('chk-pointer-guard').addEventListener('change',renderRegionsTable);
document.getElementById('chk-residual-proof').addEventListener('change',renderRegionsTable);
populateMapTypeFilter();
document.getElementById('btn-map-empty-merge').addEventListener('click',()=>clearMergeList());
document.getElementById('btn-map-do-merge').addEventListener('click',()=>performMergeQueuedRegions());

document.getElementById('btn-toggle-add').addEventListener('click',()=>{
  const f=document.getElementById('add-region-form');
  const open=f.classList.toggle('open');
  document.getElementById('btn-toggle-add').textContent=open?'− CANCEL':'+ ADD REGION';
  if(open&&romData)document.getElementById('btn-quickfill').style.display='';
});
document.getElementById('btn-cancel-add').addEventListener('click',()=>{
  document.getElementById('add-region-form').classList.remove('open');
  document.getElementById('btn-toggle-add').textContent='+ ADD REGION';
});
document.getElementById('btn-quickfill').addEventListener('click',()=>{
  document.getElementById('frm-offset').value=document.getElementById('ctrl-offset').value;
  document.getElementById('frm-size').value=(parseInt(document.getElementById('ctrl-count').value)||256)*32;
});
document.getElementById('frm-type').addEventListener('change',()=>{
  const t=document.getElementById('frm-type').value;
  if(t==='palette')  document.getElementById('frm-size').value=32;
  if(t==='tile_map') document.getElementById('frm-size').value=1792; // 32×28×2 bytes
  if(t==='null') document.getElementById('frm-name').value='NULL BYTES';
});
document.getElementById('frm-end').addEventListener('input', () => {
  const rawOff = document.getElementById('frm-offset').value.trim();
  const rawEnd = document.getElementById('frm-end').value.trim();
  const start  = parseHex(rawOff) ?? parseInt(rawOff, 10);
  const end    = parseHex(rawEnd) ?? parseInt(rawEnd, 10);
  if (!isNaN(start) && !isNaN(end) && end > start)
    document.getElementById('frm-size').value = end - start;
});
document.getElementById('btn-add-region').addEventListener('click',()=>{
  const rawOff=document.getElementById('frm-offset').value.trim();
  const off=parseHex(rawOff)??parseInt(rawOff,10);
  let size=parseInt(document.getElementById('frm-size').value)||0;
  // If size still 0, try computing from end offset field
  if(!size){
    const rawEnd=document.getElementById('frm-end').value.trim();
    const end=parseHex(rawEnd)??parseInt(rawEnd,10);
    if(!isNaN(off)&&!isNaN(end)&&end>off)size=end-off;
  }
  const type=document.getElementById('frm-type').value;
  const name=document.getElementById('frm-name').value.trim();
  const notes=document.getElementById('frm-notes').value.trim();
  if(isNaN(off)||off<0){showToast('Invalid offset',true);return;}
  if(size<=0){showToast('Size must be > 0',true);return;}
  carveRegion({offset:hexStr(off),size,type,name,notes});
  document.getElementById('frm-offset').value='';
  document.getElementById('frm-size').value='';
  document.getElementById('frm-end').value='';
  document.getElementById('frm-name').value='';
  document.getElementById('frm-notes').value='';
});
document.getElementById('btn-add-from-viewer').addEventListener('click',()=>{
  document.getElementById('frm-offset').value=document.getElementById('ctrl-offset').value;
  document.getElementById('frm-size').value=(parseInt(document.getElementById('ctrl-count').value)||256)*32;
  document.getElementById('add-region-form').classList.add('open');
  document.getElementById('btn-toggle-add').textContent='− CANCEL';
  document.getElementById('btn-quickfill').style.display='';
  document.getElementById('panel-map').scrollIntoView({behavior:'smooth'});
});

document.getElementById('btn-fill-gaps').addEventListener('click', () => {
  if (!romData) return;
  const romSize = romData.length;
  // Build sorted list of covered intervals
  const intervals = mapData.regions
    .map(r => ({ start: parseHex(r.offset) ?? 0, end: (parseHex(r.offset) ?? 0) + (r.size ?? 0) }))
    .sort((a, b) => a.start - b.start);
  // Find gaps and create unknown regions for them
  let filled = 0;
  let prev = 0;
  const gaps = [];
  for (const iv of intervals) {
    if (iv.start > prev) gaps.push({ start: prev, end: iv.start });
    if (iv.end > prev) prev = iv.end;
  }
  if (prev < romSize) gaps.push({ start: prev, end: romSize });
  for (const g of gaps) {
    mapData.regions.push({ id: genId(), offset: hexStr(g.start), size: g.end - g.start, type: 'unknown', name: '', notes: '', source: 'gap' });
    filled++;
  }
  if (!filled) { showToast('No gaps found — ROM fully covered'); return; }
  mapData.regions.sort((a, b) => (parseHex(a.offset) ?? 0) - (parseHex(b.offset) ?? 0));
  refreshMapUI();
  showToast(`Filled ${filled} gap${filled > 1 ? 's' : ''} as Unknown regions`);
});
