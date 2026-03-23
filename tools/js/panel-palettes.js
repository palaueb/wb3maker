// ═══════════════════════════════════════════════════════
//  PALETTE REGISTRY
// ═══════════════════════════════════════════════════════
function resolvePaletteManualColors(r){
  if(!romData||!r.slots)return Array(16).fill('#000000');
  return Array.from({length:16},(_,i)=>{
    const off=parseHex(r.slots[i]);
    if(off==null||off>=romData.length)return '#000000';
    return smsColorToHex(romData[off]);
  });
}

function renderPaletteRegistry(){
  const body=document.getElementById('palette-registry-body');
  const pals=mapData.regions.filter(r=>r.type==='palette'||r.type==='palette_manual');
  if(!pals.length){body.innerHTML='<div class="pal-empty">No palette regions defined. Add a region of type "Palette" or "Palette (custom)" in the Memory Map above.</div>';return;}
  body.innerHTML='';
  for(const r of pals){
    const isManual=r.type==='palette_manual';
    let colors=[];
    let rawBytes=null;
    if(isManual){
      colors=resolvePaletteManualColors(r);
    } else {
      const off=parseHex(r.offset)??0;
      colors=romData?decodePaletteAt(romData,off,16):[];
      if(romData)rawBytes=Array.from({length:colors.length},(_,i)=>romData[off+i]);
    }
    const swatchTextColor=(hex)=>{
      const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
      return(r*299+g*587+b*114)/1000>128?'rgba(0,0,0,.75)':'rgba(255,255,255,.75)';
    };
    const swatchRow=(cols,rawBytes)=>cols.length?`<div style="display:flex;align-items:center;gap:3px;margin-bottom:3px;flex-wrap:wrap">
      ${cols.map((c,i)=>{
        const label=rawBytes?rawBytes[i].toString(16).toUpperCase().padStart(2,'0'):i.toString(16).toUpperCase().padStart(2,'0');
        return`<div class="pswatch" style="background:${c};color:${swatchTextColor(c)}" title="[${i}] raw:${rawBytes?'0x'+rawBytes[i].toString(16).toUpperCase():''} → ${c}">${label}</div>`;
      }).join('')}
    </div>`:'';
    const typeLabel=isManual?'<span style="font-size:9px;padding:1px 5px;border:1px solid #ffa500;color:#ffa500;margin-left:4px">CUSTOM</span>':'';
    const div=document.createElement('div');div.className='pal-entry';
    div.innerHTML=`
      <div class="pal-entry-header">
        <div class="pal-entry-name">${r.name||'Unnamed'}${typeLabel}</div>
        <div style="font-size:11px;color:var(--accent)">${r.offset}</div>
        <div style="font-size:11px;color:var(--dim)">Bank ${bankOf(parseHex(r.offset)??0)} +0x${((parseHex(r.offset)??0)%BANK_SIZE).toString(16).toUpperCase().padStart(4,'0')}</div>
        ${isManual?`<button class="btn small purple" data-edit="${r.id}">EDIT SLOTS</button>`:''}
        <button class="btn small" data-apply="${r.id}">APPLY TO VIEWER</button>
        ${!isManual?`<button class="btn small" data-goto="${r.offset}">VIEW TILES</button>`:''}
        <button class="btn small danger" data-delete="${r.id}">× DELETE</button>
      </div>
      ${colors.length?swatchRow(colors,rawBytes):'<span class="pal-empty">Load ROM to decode colors</span>'}
      ${r.notes?`<div style="font-size:10px;color:var(--dim);margin-top:5px">${r.notes}</div>`:''}`;
    body.appendChild(div);
  }
  body.querySelectorAll('[data-apply]').forEach(btn=>btn.addEventListener('click',()=>{
    const r=mapData.regions.find(x=>x.id===btn.dataset.apply);
    if(!r||!romData)return;
    let colors;
    if(r.type==='palette_manual'){
      colors=resolvePaletteManualColors(r);
    } else {
      colors=decodePaletteAt(romData,parseHex(r.offset)??0,16);
    }
    viewerPalette=[...colors,...Array(16).fill('#000000')].slice(0,16);
    while(viewerPalette.length<16)viewerPalette.push('#000000');
    buildPaletteUI();doRender();
    showToast(`Palette "${r.name||r.offset}" applied`);
  }));
  body.querySelectorAll('[data-goto]').forEach(btn=>btn.addEventListener('click',()=>{
    document.getElementById('ctrl-offset').value=btn.dataset.goto;
    doRender();renderBanksGrid();
    document.getElementById('panel-viewer').scrollIntoView({behavior:'smooth'});
  }));
  body.querySelectorAll('[data-edit]').forEach(btn=>btn.addEventListener('click',()=>{
    openLaboratory(btn.dataset.edit);
  }));
  body.querySelectorAll('[data-delete]').forEach(btn=>btn.addEventListener('click',()=>{
    const r=mapData.regions.find(x=>x.id===btn.dataset.delete);
    if(!r)return;
    if(!confirm(`Delete palette "${r.name||r.offset}"?`))return;
    mapData.regions=mapData.regions.filter(x=>x.id!==btn.dataset.delete);
    refreshMapUI();
    showToast(`Palette "${r.name||r.offset}" deleted`);
  }));
}


// Palette registry — quick-create buttons
document.getElementById('btn-new-palette-rom').addEventListener('click', () => {
  const off = parseHex(document.getElementById('ctrl-offset').value) ?? 0;
  const r = {
    id: genId(), offset: hexStr(off), size: 16, type: 'palette',
    name: 'Palette @ ' + hexStr(off), notes: '',
  };
  carveRegion(r);
  renderPaletteRegistry();
  document.getElementById('panel-palettes').scrollIntoView({behavior:'smooth'});
  showToast(`Palette region created at ${hexStr(off)}`);
});

document.getElementById('btn-new-palette-manual').addEventListener('click', () => {
  const r = {
    id: genId(), offset: hexStr(0), size: 1, type: 'palette_manual',
    name: 'Custom palette', notes: '', slots: Array(16).fill(''),
  };
  r.id = genId();
  mapData.regions.push(r);
  mapData.regions.sort((a,b)=>(parseHex(a.offset)??0)-(parseHex(b.offset)??0));
  refreshMapUI();
  openLaboratory(r.id);
  showToast('Custom palette created — assign ROM offsets to each slot');
});
