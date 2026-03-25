'use strict';

// ═══════════════════════════════════════════════════════
//  DISASSEMBLY PARSER (WLA-DX / Emulicious .asm format)
// ═══════════════════════════════════════════════════════
function asmLabelOffset(label){
  const m=String(label||'').match(/^_(?:LABEL|DATA|CODE)_([0-9A-Fa-f]+)_$/);
  return m?parseInt(m[1],16):null;
}

function normalizeAsmXrefs(refs, dir){
  const grouped=new Map();
  for(const ref of refs){
    const key=dir==='out'
      ?`${ref.kind}|${ref.toOffset}|${ref.to}`
      :`${ref.kind}|${ref.fromOffset}|${ref.from}`;
    if(!grouped.has(key)){
      grouped.set(key,dir==='out'
        ?{kind:ref.kind,label:ref.to,offset:hexStr(ref.toOffset),count:0}
        :{kind:ref.kind,label:ref.from,offset:hexStr(ref.fromOffset),count:0});
    }
    grouped.get(key).count++;
  }
  return [...grouped.values()].sort((a,b)=>(parseHex(a.offset)??0)-(parseHex(b.offset)??0)||a.label.localeCompare(b.label));
}

function buildAsmAnalysis(text){
  const lines=text.split('\n');
  const dataRegions=[];
  const codeLabels=[];
  const refsRaw=[];
  const codeLabelMap=new Map();
  let currentBank=0;
  let currentCodeLabel=null;

  const rBank=/^\.BANK\s+(\d+)/i;
  const rData=/^;\s*Data from ([0-9A-Fa-f]+) to ([0-9A-Fa-f]+)\s*\((\d+)\s*bytes?\)/i;
  const rPtrTbl=/^;\s*Pointer Table from ([0-9A-Fa-f]+) to ([0-9A-Fa-f]+)\s*\((\d+)\s*entr/i;
  const rJmpTbl=/^;\s*Jump Table from ([0-9A-Fa-f]+) to ([0-9A-Fa-f]+)\s*\((\d+)\s*entr/i;
  const rIncbin=/^\.incbin\s+"[^"]*_DATA_([0-9A-Fa-f]+)_\.inc"/i;
  const rCodeLabel=/^(_LABEL_[0-9A-Fa-f]+_):/i;
  const rDataLabel=/^(_DATA_[0-9A-Fa-f]+_):/i;
  const rCodeRef=/\b(call|jp|jr|djnz)\s+(?:[a-z]{1,3}\s*,\s*)?(_LABEL_[0-9A-Fa-f]+_)\b/ig;
  const rDataRef=/(_(?:DATA|CODE)_[0-9A-Fa-f]+_)\b/ig;
  const rRstRef=/\brst\s+\$([0-9A-Fa-f]{1,2})\b(?:\s*;\s*(_LABEL_[0-9A-Fa-f]+_))?/ig;

  let lastComment=null;  // { offset, size, type, notes }

  const pushDataRegion=(region)=>{
    if(region&&Number.isFinite(region.offset)&&region.size>0)dataRegions.push(region);
  };

  for(let i=0;i<lines.length;i++){
    const rawLine=lines[i];
    const line=rawLine.trim();

    const mBank=line.match(rBank);
    if(mBank){currentBank=parseInt(mBank[1],10);currentCodeLabel=null;lastComment=null;continue;}

    const mCodeLabel=line.match(rCodeLabel);
    if(mCodeLabel){
      const label=mCodeLabel[1];
      const offset=asmLabelOffset(label);
      if(offset!==null&&!codeLabelMap.has(label)){
        const entry={label,offset,bank:bankOf(offset),lineIndex:i};
        codeLabels.push(entry);
        codeLabelMap.set(label,entry);
      }
      currentCodeLabel=label;
      lastComment=null;
      continue;
    }

    if(currentCodeLabel){
      rCodeRef.lastIndex=0;
      let mRef;
      while((mRef=rCodeRef.exec(rawLine))!==null){
        refsRaw.push({from:currentCodeLabel,to:mRef[2],kind:mRef[1].toLowerCase(),lineIndex:i});
      }
      const codePart=rawLine.split(';')[0]||rawLine;
      rDataRef.lastIndex=0;
      let mDataRef;
      while((mDataRef=rDataRef.exec(codePart))!==null){
        refsRaw.push({from:currentCodeLabel,to:mDataRef[1],kind:'use',lineIndex:i});
      }
      rRstRef.lastIndex=0;
      let mRst;
      while((mRst=rRstRef.exec(rawLine))!==null){
        if(mRst[2])refsRaw.push({from:currentCodeLabel,to:mRst[2],kind:'rst',lineIndex:i});
      }
    }

    const mData=line.match(rData);
    if(mData){
      lastComment={
        offset:parseInt(mData[1],16),
        size:parseInt(mData[3],10),
        type:'unknown',
        notes:line.replace(/^;\s*/,'')
      };
      continue;
    }

    const mPtr=line.match(rPtrTbl);
    if(mPtr){
      pushDataRegion({
        offset:parseInt(mPtr[1],16),
        size:parseInt(mPtr[3],10)*2,
        type:'pointer_table',
        bank:currentBank,
        name:`Pointer Table @ 0x${mPtr[1].toUpperCase()}`,
        notes:line.replace(/^;\s*/,''),
        source:'asm',
        asmKind:'pointer_table'
      });
      lastComment=null;
      continue;
    }

    const mJmp=line.match(rJmpTbl);
    if(mJmp){
      pushDataRegion({
        offset:parseInt(mJmp[1],16),
        size:parseInt(mJmp[3],10)*2,
        type:'code',
        bank:currentBank,
        name:`Jump Table @ 0x${mJmp[1].toUpperCase()}`,
        notes:line.replace(/^;\s*/,''),
        source:'asm',
        asmKind:'jump_table'
      });
      lastComment=null;
      continue;
    }

    if(lastComment&&line.match(rDataLabel)){
      const label=line.replace(':','');
      pushDataRegion({...lastComment,bank:currentBank,name:label,source:'asm',asmKind:'data'});
      lastComment=null;
      continue;
    }

    const mInc=line.match(rIncbin);
    if(mInc){
      if(lastComment){
        pushDataRegion({...lastComment,bank:currentBank,name:`_DATA_${mInc[1].toUpperCase()}_`,source:'asm',asmKind:'data'});
        lastComment=null;
      }
      continue;
    }

    if(lastComment&&line&&!line.startsWith(';')){
      pushDataRegion({
        ...lastComment,
        bank:currentBank,
        name:`Data @ 0x${lastComment.offset.toString(16).toUpperCase()}`,
        source:'asm',
        asmKind:'data'
      });
      lastComment=null;
    }
  }

  const uniqueDataByOffset=new Map();
  for(const r of dataRegions){
    if(!uniqueDataByOffset.has(r.offset))uniqueDataByOffset.set(r.offset,r);
  }
  const dataRegionsFinal=[...uniqueDataByOffset.values()].map(r=>{
    const hex=r.offset.toString(16).toUpperCase();
    const named=typeof r.name==='string'&&/^_(?:DATA|CODE|LABEL)_[0-9A-Fa-f]+_$/.test(r.name)?r.name:null;
    return {
      ...r,
      asmLabel:named||`_DATA_${hex}_`
    };
  });

  const boundaryOffsets=new Set(dataRegionsFinal.map(r=>r.offset));
  for(const l of codeLabels)boundaryOffsets.add(l.offset);
  const sortedBoundaries=[...boundaryOffsets].sort((a,b)=>a-b);

  const codeRegions=codeLabels
    .sort((a,b)=>a.offset-b.offset)
    .map((labelInfo,idx,arr)=>{
      const offset=labelInfo.offset;
      const bankEnd=(bankOf(offset)+1)*BANK_SIZE;
      let nextBoundary=bankEnd;
      for(let j=0;j<sortedBoundaries.length;j++){
        const boundary=sortedBoundaries[j];
        if(boundary>offset){nextBoundary=Math.min(nextBoundary,boundary);break;}
      }
      if(idx<arr.length-1){
        const nextLabelOff=arr[idx+1].offset;
        if(nextLabelOff>offset)nextBoundary=Math.min(nextBoundary,nextLabelOff);
      }
      const size=Math.max(1,nextBoundary-offset);
      return {
        offset,
        size,
        type:'code',
        bank:bankOf(offset),
        name:labelInfo.label,
        notes:'',
        source:'asm',
        asmKind:'code_label',
        asmLabel:labelInfo.label
      };
    });

  const codeRegionMap=new Map(codeRegions.map(r=>[r.asmLabel,r]));
  const allAsmRegions=[...dataRegionsFinal,...codeRegions];
  const labelRegionMap=new Map();
  for(const region of allAsmRegions){
    const labels=new Set();
    if(region.asmLabel)labels.add(region.asmLabel);
    if(typeof region.name==='string'&&/^_(?:DATA|CODE|LABEL)_[0-9A-Fa-f]+_$/.test(region.name))labels.add(region.name);
    if(Number.isFinite(region.offset)){
      const hex=region.offset.toString(16).toUpperCase();
      if(region.type==='code'||region.asmKind==='code_label')labels.add(`_LABEL_${hex}_`);
      else{
        labels.add(`_DATA_${hex}_`);
        if(region.asmKind==='jump_table')labels.add(`_CODE_${hex}_`);
      }
    }
    for(const label of labels){
      if(!labelRegionMap.has(label))labelRegionMap.set(label,region);
    }
  }
  const resolvedRefs=refsRaw
    .map(ref=>{
      const from=codeRegionMap.get(ref.from);
      const to=labelRegionMap.get(ref.to);
      if(!from||!to)return null;
      return {
        ...ref,
        from:from.asmLabel,
        to:to.asmLabel||ref.to,
        fromOffset:from.offset,
        toOffset:to.offset
      };
    })
    .filter(Boolean);

  const refsOutByLabel=new Map();
  const refsInByLabel=new Map();
  for(const ref of resolvedRefs){
    if(!refsOutByLabel.has(ref.from))refsOutByLabel.set(ref.from,[]);
    if(!refsInByLabel.has(ref.to))refsInByLabel.set(ref.to,[]);
    refsOutByLabel.get(ref.from).push(ref);
    refsInByLabel.get(ref.to).push(ref);
  }

  for(const region of allAsmRegions){
    region.xrefsOut=normalizeAsmXrefs(refsOutByLabel.get(region.asmLabel)||[],'out');
    region.xrefsIn =normalizeAsmXrefs(refsInByLabel.get(region.asmLabel)||[],'in');
  }

  const finalRegions=allAsmRegions
    .map(r=>({...r,offset:hexStr(r.offset)}))
    .sort((a,b)=>(parseHex(a.offset)??0)-(parseHex(b.offset)??0));

  return {
    regions:finalRegions,
    codeRegions:codeRegions.map(r=>({...r,offset:hexStr(r.offset)})),
    dataRegions:dataRegionsFinal.map(r=>({...r,offset:hexStr(r.offset)})),
    byOffset:new Map(allAsmRegions.map(r=>[r.offset,{...r,offset:hexStr(r.offset)}])),
    byLabel:new Map(allAsmRegions.map(r=>[r.asmLabel,{...r,offset:hexStr(r.offset)}]))
  };
}

function parseDisassembly(text) {
  return buildAsmAnalysis(text).regions;
}

// Find lines in the loaded .asm that cover [startOff, endOff)
function getAsmLinesForRegion(startOff, endOff) {
  if (!asmText) return null;
  const lines = asmText.split('\n');
  const s5 = startOff.toString(16).toUpperCase().padStart(5,'0');
  const sHex = startOff.toString(16).toUpperCase();

  // Labels in Emulicious disassembly always use ROM offsets (e.g. _LABEL_1E200_ for bank 7).
  // For banks 0-2 ROM offset == Z80 address by coincidence; for banks 3+ they differ.
  // We must search by ROM offset, not Z80 address.

  let from = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.includes(`from ${s5}`) || l.includes(`from ${sHex} `) ||
        l.includes(`_DATA_${s5}_:`) || l.includes(`_DATA_${sHex}_:`) ||
        l.includes(`_CODE_${s5}_:`) || l.includes(`_CODE_${sHex}_:`) ||
        l.includes(`_LABEL_${s5}_:`) || l.includes(`_LABEL_${sHex}_:`)) {
      from = i; break;
    }
  }
  // Fallback: find by bank + nearest ORG
  if (from < 0) {
    const bank = bankOf(startOff);
    const orgHex = ((startOff % BANK_SIZE)).toString(16).toUpperCase().padStart(4,'0');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].match(new RegExp(`\\.BANK\\s+${bank}\\b`)) &&
          i+1 < lines.length && lines[i+1].includes(orgHex)) {
        from = i; break;
      }
    }
  }
  if (from < 0) return null;

  // Collect until next region boundary or end of file.
  // All label/comment offsets in Emulicious .asm are ROM offsets — compare against endOff directly.
  let to = Math.min(lines.length, from + 300);
  for (let i = from + 1; i < lines.length; i++) {
    const m = lines[i].match(/from ([0-9A-Fa-f]{4,5}) to/);
    if (m && parseInt(m[1], 16) >= endOff) { to = i; break; }
    if (lines[i].match(/^\.BANK\s+\d/) && i > from + 1) { to = i; break; }
    // Stop at next _LABEL_/_DATA_/_CODE_ whose ROM offset is >= our end offset
    const lm = lines[i].match(/_(LABEL|DATA|CODE)_([0-9A-Fa-f]+)_:/);
    if (lm && parseInt(lm[2], 16) >= endOff) { to = i; break; }
  }
  return lines.slice(from, to);
}

function getAsmMetaForRegion(region){
  if(!region)return null;
  if(region.asmLabel||region.xrefsIn||region.xrefsOut)return region;
  const off=parseHex(region.offset);
  if(off===null||!asmAnalysis)return null;
  return asmAnalysis.byOffset.get(off)||null;
}

function findRegionContainingOffset(offset){
  return mapData.regions.find(r=>{
    const start=parseHex(r.offset)??0;
    const end=start+(r.size??0);
    return offset>=start&&offset<end;
  })||null;
}

// ═══════════════════════════════════════════════════════
//  IMPORT ASM PREVIEW
// ═══════════════════════════════════════════════════════
function showImportPreview(regions){
  _pendingAsmRegions=regions;
  document.getElementById('asm-split-review').classList.remove('open');
  document.getElementById('import-preview').classList.add('open');
  renderImportPreview();
}

function renderImportPreview(){
  if(!_pendingAsmRegions)return;
  const minSize=parseInt(document.getElementById('imp-minsize').value)||1;
  const filtered=_pendingAsmRegions.filter(r=>(r.size??0)>=minSize);

  // Summary stats
  const totalBytes=filtered.reduce((s,r)=>s+(r.size??0),0);
  const romPct=romData?(totalBytes/romData.length*100).toFixed(1):'?';
  const byType={};
  for(const r of filtered)byType[r.type]=(byType[r.type]||0)+1;

  const sum=document.getElementById('import-summary');
  sum.innerHTML=`
    <div class="import-stat"><div class="import-stat-n">${_pendingAsmRegions.length}</div><div class="import-stat-l">TOTAL FOUND</div></div>
    <div class="import-stat"><div class="import-stat-n">${filtered.length}</div><div class="import-stat-l">AFTER FILTER (≥${minSize}b)</div></div>
    <div class="import-stat"><div class="import-stat-n">${totalBytes.toLocaleString()}</div><div class="import-stat-l">BYTES COVERED</div></div>
    <div class="import-stat"><div class="import-stat-n">${romPct}%</div><div class="import-stat-l">OF ROM</div></div>`;

  const breakdown=document.getElementById('import-type-breakdown');
  breakdown.innerHTML='';
  for(const[t,n]of Object.entries(byType)){
    const meta=TYPE_META[t]??TYPE_META.unknown;
    const span=document.createElement('span');
    span.style.cssText=`font-size:11px;padding:2px 8px;border:1px solid ${meta.color};color:${meta.color}`;
    span.textContent=`${meta.label}: ${n}`;
    breakdown.appendChild(span);
  }
}

document.getElementById('imp-minsize').addEventListener('input',renderImportPreview);

function doImport(merge){
  if(!_pendingAsmRegions)return;
  const minSize=parseInt(document.getElementById('imp-minsize').value)||1;
  const filtered=_pendingAsmRegions.filter(r=>(r.size??0)>=minSize);

  // REPLACE mode: remove all existing ASM regions first, then add the new set
  if(!merge) mapData.regions=mapData.regions.filter(r=>r.source!=='asm');

  let added=0;
  for(const r of filtered){
    const off=parseHex(r.offset)??0;
    if(merge){
      // Skip if a region already exists at this offset
      if(mapData.regions.some(x=>(parseHex(x.offset)??0)===off))continue;
    }
    mapData.regions.push({...r, id:genId()});
    added++;
  }

  _pendingAsmRegions=null;
  document.getElementById('import-preview').classList.remove('open');
  refreshMapUI();
  showToast(`Imported ${added} regions from disassembly`);
}

function getAsmBoundaryOffsetsForRegion(region){
  if(!asmAnalysis)return [];
  if(region.source==='asm')return [];
  if(region.type!=='code'&&region.type!=='unknown')return [];
  const start=parseHex(region.offset)??0;
  const end=start+(region.size??0);
  if(end<=start+1)return [];
  const offsets=new Set();
  for(const asmRegion of asmAnalysis.regions){
    const off=parseHex(asmRegion.offset)??0;
    if(off>start&&off<end)offsets.add(off);
  }
  return [...offsets].sort((a,b)=>a-b);
}

function buildAsmSplitPlan(){
  const candidates=[];
  for(const region of mapData.regions){
    const splits=getAsmBoundaryOffsetsForRegion(region);
    if(!splits.length)continue;
    const start=parseHex(region.offset)??0;
    const end=start+(region.size??0);
    const boundaries=[start,...splits,end];
    const parts=[];
    for(let i=0;i<boundaries.length-1;i++){
      const partStart=boundaries[i];
      const partEnd=boundaries[i+1];
      if(partEnd<=partStart)continue;
      const keepOriginal=i===0;
      parts.push({
        ...region,
        ...(keepOriginal?{}:{id:null,offset:hexStr(partStart),name:'',notes:''}),
        offset:hexStr(partStart),
        size:partEnd-partStart,
        splitFromId:region.id,
      });
    }
    candidates.push({regionId:region.id,start,end,region,splitOffsets:splits,parts});
  }
  return candidates;
}

function renderAsmSplitReview(){
  const panel=document.getElementById('asm-split-review');
  const sum=document.getElementById('asm-split-summary');
  const list=document.getElementById('asm-split-list');
  const applyBtn=document.getElementById('btn-apply-asm-splits');
  if(!_pendingAsmSplitPlan||!_pendingAsmSplitPlan.length){
    panel.classList.remove('open');
    sum.innerHTML='';
    list.innerHTML='';
    applyBtn.disabled=true;
    return;
  }
  const regions=_pendingAsmSplitPlan.length;
  const splits=_pendingAsmSplitPlan.reduce((n,item)=>n+item.splitOffsets.length,0);
  const extraParts=_pendingAsmSplitPlan.reduce((n,item)=>n+Math.max(0,item.parts.length-1),0);
  sum.innerHTML=`
    <div class="import-stat"><div class="import-stat-n">${regions}</div><div class="import-stat-l">REGIONS TO SPLIT</div></div>
    <div class="import-stat"><div class="import-stat-n">${splits}</div><div class="import-stat-l">ASM BOUNDARIES</div></div>
    <div class="import-stat"><div class="import-stat-n">${extraParts}</div><div class="import-stat-l">NEW REGIONS</div></div>`;
  list.innerHTML=_pendingAsmSplitPlan.slice(0,120).map(item=>{
    const name=item.region.name||'(unlabeled)';
    const cuts=item.splitOffsets.map(off=>hexStr(off)).join(', ');
    return `<div class="review-item"><strong>${item.region.offset}</strong> · ${name} · ${(item.region.size??0).toLocaleString()}b → ${item.parts.length} parts<br><span style="color:var(--dim)">cuts: ${cuts}</span></div>`;
  }).join('');
  panel.classList.add('open');
  applyBtn.disabled=false;
}

function reviewAsmSplits(){
  if(!asmAnalysis){showToast('Load ASM first',true);return;}
  _pendingAsmRegions=null;
  document.getElementById('import-preview').classList.remove('open');
  _pendingAsmSplitPlan=buildAsmSplitPlan();
  if(!_pendingAsmSplitPlan.length){
    renderAsmSplitReview();
    showToast('No project regions need ASM-based splits');
    return;
  }
  renderAsmSplitReview();
  showToast(`Review ready: ${_pendingAsmSplitPlan.length} regions can be split`);
}

function applyAsmSplits(){
  if(!_pendingAsmSplitPlan||!_pendingAsmSplitPlan.length){showToast('No ASM split review ready',true);return;}
  const replace=new Map(_pendingAsmSplitPlan.map(item=>[item.regionId,item.parts]));
  const next=[];
  for(const region of mapData.regions){
    const parts=replace.get(region.id);
    if(parts){
      next.push(...parts.map((part,idx)=>idx===0?part:{...part,id:genId()}));
    }
    else next.push(region);
  }
  mapData.regions=next.sort((a,b)=>(parseHex(a.offset)??0)-(parseHex(b.offset)??0));
  const affected=_pendingAsmSplitPlan.length;
  const added=_pendingAsmSplitPlan.reduce((n,item)=>n+Math.max(0,item.parts.length-1),0);
  _pendingAsmSplitPlan=null;
  document.getElementById('asm-split-review').classList.remove('open');
  refreshMapUI();
  showToast(`Applied ASM splits: ${affected} regions, +${added} new`);
}

document.getElementById('btn-do-import').addEventListener('click',()=>doImport(false));
document.getElementById('btn-import-merge').addEventListener('click',()=>doImport(true));
document.getElementById('btn-cancel-import').addEventListener('click',()=>{
  _pendingAsmRegions=null;
  document.getElementById('import-preview').classList.remove('open');
});
document.getElementById('btn-show-import').addEventListener('click',()=>{
  if(_pendingAsmRegions){
    document.getElementById('asm-split-review').classList.remove('open');
    document.getElementById('import-preview').classList.toggle('open');
  }else{
    document.getElementById('asm-input').click();
  }
});
document.getElementById('btn-review-asm-splits').addEventListener('click',reviewAsmSplits);
document.getElementById('btn-apply-asm-splits').addEventListener('click',applyAsmSplits);
document.getElementById('btn-cancel-asm-splits').addEventListener('click',()=>{
  _pendingAsmSplitPlan=null;
  document.getElementById('asm-split-review').classList.remove('open');
});
