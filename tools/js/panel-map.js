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
  const visible=mapData.regions.filter(r=>{
    if(typeFilter&&r.type!==typeFilter)return false;
    if(unknownOnly&&r.type!=='unknown')return false;
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

  const filterActive=filterText||unknownOnly||typeFilter;
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
    const tr=document.createElement('tr');
    tr.dataset.id=r.id;
    tr.dataset.bank=bankOf(rOff);
    if(r.id===_labId)tr.classList.add('row-active');
    if(_mergeList.includes(r.id))tr.classList.add('row-queued');
    tr.innerHTML=`
      <td style="color:var(--accent);white-space:nowrap">${r.offset}</td>
      <td style="color:var(--yellow);white-space:nowrap;font-size:11px">${bankAddrStr(rOff)}</td>
      <td style="color:var(--dim);white-space:nowrap">${(r.size??0).toLocaleString()}b</td>
      <td>
        <select class="type-select" data-id="${r.id}" style="border-color:${meta.color};color:${meta.color}">
          ${Object.entries(TYPE_META).map(([v,m])=>`<option value="${v}"${v===r.type?' selected':''}>${m.label}</option>`).join('')}
        </select>
        ${r.source==='asm'?'<span class="src-badge">asm</span>':''}
        ${r.analysis?'<span class="src-badge" title="Has structured ROM-control metadata">meta</span>':''}
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
populateMapTypeFilter();

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
