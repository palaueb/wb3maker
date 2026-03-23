// ═══════════════════════════════════════════════════════
//  PANEL COLLAPSE
// ═══════════════════════════════════════════════════════
function initPanelCollapse(){
  document.querySelectorAll('.panel[id]').forEach(panel=>{
    const ph=panel.querySelector('.ph');
    if(!ph)return;
    const btn=document.createElement('button');
    btn.className='btn-collapse';
    btn.title='Collapse / expand panel';
    const stored=localStorage.getItem('wb3_panel_'+panel.id);
    if(stored==='1'){panel.classList.add('collapsed');btn.textContent='▶';}
    else btn.textContent='▼';
    let actions=ph.querySelector('.ph-actions');
    if(!actions){actions=document.createElement('div');actions.className='ph-actions';ph.appendChild(actions);}
    actions.appendChild(btn);
    btn.addEventListener('click',e=>{
      e.stopPropagation();
      const collapsed=panel.classList.toggle('collapsed');
      btn.textContent=collapsed?'▶':'▼';
      localStorage.setItem('wb3_panel_'+panel.id,collapsed?'1':'0');
    });
  });
}


// ═══════════════════════════════════════════════════════
//  UNIFIED REFRESH
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
//  ROM TEXT SEARCH
// ═══════════════════════════════════════════════════════
function searchTextInRom(query){
  if(!romData||!query)return[];
  const bytes=[];
  for(let i=0;i<query.length;i++)bytes.push(query.charCodeAt(i));
  const results=[];
  const limit=500;
  const len=romData.length-bytes.length+1;
  outer:for(let i=0;i<len;i++){
    for(let j=0;j<bytes.length;j++){
      if(romData[i+j]!==bytes[j])continue outer;
    }
    results.push(i);
    if(results.length>=limit)break;
  }
  return results;
}

function renderTextSearchResults(query,offsets){
  const wrap=document.getElementById('textsearch-results');
  const status=document.getElementById('textsearch-status');
  const clearBtn=document.getElementById('btn-textsearch-clear');
  if(!offsets.length){
    wrap.style.display='none';
    status.textContent='No matches found.';
    status.style.color='var(--red)';
    clearBtn.style.display='';
    return;
  }
  const limited=offsets.length>=500;
  status.textContent=limited?`≥500 matches (showing first 500)`:`${offsets.length} match${offsets.length===1?'':'es'}`;
  status.style.color='var(--green)';
  clearBtn.style.display='';
  const ctxLen=12;
  let html='<table style="width:100%;border-collapse:collapse;font-size:11px">';
  html+='<thead><tr style="background:var(--bg4)"><th style="padding:4px 8px;color:var(--dim);text-align:left;font-weight:normal;letter-spacing:1px">OFFSET</th><th style="padding:4px 8px;color:var(--dim);text-align:left;font-weight:normal;letter-spacing:1px">Z80</th><th style="padding:4px 8px;color:var(--dim);text-align:left;font-weight:normal;letter-spacing:1px">CONTEXT</th><th style="padding:4px 8px;color:var(--dim);text-align:left;font-weight:normal;letter-spacing:1px"></th></tr></thead><tbody>';
  for(const off of offsets){
    const hexOff='0x'+off.toString(16).toUpperCase().padStart(5,'0');
    const z80=bankAddrStr(off);
    const start=Math.max(0,off-ctxLen);
    const end=Math.min(romData.length,off+query.length+ctxLen);
    let ctx='';
    for(let i=start;i<end;i++){
      const b=romData[i];
      const ch=(b>=32&&b<127)?String.fromCharCode(b):'.';
      if(i>=off&&i<off+query.length){
        ctx+=`<span style="color:var(--bg);background:var(--yellow);font-weight:bold">${ch}</span>`;
      } else {
        ctx+=`<span style="color:var(--dim)">${ch}</span>`;
      }
    }
    html+=`<tr style="border-bottom:1px solid var(--border)" data-offset="${off}">
      <td style="padding:3px 8px;color:var(--accent);white-space:nowrap;cursor:pointer" class="tsr-offset">${hexOff}</td>
      <td style="padding:3px 8px;color:var(--yellow);white-space:nowrap">${z80}</td>
      <td style="padding:3px 8px;font-family:var(--mono);letter-spacing:.5px">${ctx}</td>
      <td style="padding:3px 8px;white-space:nowrap"><button class="btn small tsr-carve" data-offset="${hexOff}" data-size="${query.length}" title="Pre-fill CARVE form with this offset">CARVE</button></td>
    </tr>`;
  }
  html+='</tbody></table>';
  wrap.innerHTML=html;
  wrap.style.display='block';
  wrap.querySelectorAll('.tsr-carve').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.getElementById('frm-offset').value=btn.dataset.offset;
      document.getElementById('frm-size').value=btn.dataset.size;
      const f=document.getElementById('add-region-form');
      if(!f.classList.contains('open')){
        f.classList.add('open');
        document.getElementById('btn-toggle-add').textContent='− CANCEL';
        if(romData)document.getElementById('btn-quickfill').style.display='';
      }
      document.getElementById('frm-type').value='text';
      document.getElementById('frm-name').focus();
      f.scrollIntoView({behavior:'smooth',block:'nearest'});
    });
  });
}

function doTextSearch(){
  const q=document.getElementById('map-textsearch').value.trim();
  if(!q){showToast('Enter a search string',true);return;}
  if(!romData){showToast('Load a ROM first',true);return;}
  const results=searchTextInRom(q);
  renderTextSearchResults(q,results);
}

function clearTextSearch(){
  document.getElementById('textsearch-results').style.display='none';
  document.getElementById('textsearch-status').textContent='';
  document.getElementById('textsearch-status').style.color='var(--dim)';
  document.getElementById('btn-textsearch-clear').style.display='none';
  document.getElementById('map-textsearch').value='';
}

// ADD REGION FORM event listeners
document.getElementById('map-filter').addEventListener('input',renderRegionsTable);
document.getElementById('chk-unknown-only').addEventListener('change',renderRegionsTable);
document.getElementById('btn-textsearch').addEventListener('click',doTextSearch);
document.getElementById('btn-textsearch-clear').addEventListener('click',clearTextSearch);
document.getElementById('map-textsearch').addEventListener('keydown',e=>{if(e.key==='Enter')doTextSearch();});

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
  if(t==='tile_map') document.getElementById('frm-size').value=1792;
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


// ═══════════════════════════════════════════════════════
//  FILE LOADING
// ═══════════════════════════════════════════════════════
function updateBadges(){
  const wrap=document.getElementById('loaded-files');wrap.innerHTML='';
  if(romName){const b=document.createElement('div');b.className='loaded-badge rom';b.textContent='▤ '+romName;wrap.appendChild(b);}
  if(mapData.regions.length){const b=document.createElement('div');b.className='loaded-badge';b.textContent=`⊞ ${mapData.regions.length} regions`;wrap.appendChild(b);}
  if(asmFileName){const b=document.createElement('div');b.className='loaded-badge asm-badge';b.textContent=`⊞ ${asmFileName}`;wrap.appendChild(b);}
  document.getElementById('btn-load-json').style.display=romData?'':'none';
  document.getElementById('btn-load-asm').style.display=romData?'':'none';
  document.getElementById('btn-fill-gaps').style.display=romData?'':'none';
  document.getElementById('btn-review-asm-splits').disabled=!(asmAnalysis&&mapData.regions.length);
}

async function loadRom(arrayBuffer,fileName){
  clearError();
  const bytes=new Uint8Array(arrayBuffer);
  asmText=null;
  asmAnalysis=null;
  asmFileName='';
  _pendingAsmRegions=null;
  _pendingAsmSplitPlan=null;
  document.getElementById('import-preview').classList.remove('open');
  document.getElementById('asm-split-review').classList.remove('open');
  romData=bytes;romName=fileName;romMD5=computeMD5(arrayBuffer);romCRC32=computeCRC32(arrayBuffer);
  mapData.romMD5=romMD5;mapData.romName=fileName;mapData.romSizeBytes=bytes.length;

  document.getElementById('info-file').textContent=fileName;
  document.getElementById('info-size').textContent=`${bytes.length.toLocaleString()} bytes (${(bytes.length/1024).toFixed(0)} KB)`;
  let checksumsHTML=`<span style="color:var(--dim);font-size:10px">MD5</span> ${romMD5} &nbsp;&nbsp; <span style="color:var(--dim);font-size:10px">CRC32</span> ${romCRC32}`;
  if(bytes.length>0x8000){
    const REGION_NAMES={0x3:'SMS Japan',0x4:'SMS Export',0x5:'GG Japan',0x6:'GG Export',0x7:'GG International'};
    const ROM_SIZES={0xa:'8KB',0xb:'16KB',0xc:'32KB',0xd:'48KB',0xe:'64KB',0xf:'128KB',0x0:'256KB',0x1:'512KB',0x2:'1MB'};
    const tmrBytes=bytes.subarray(0x7FF0,0x7FF8);
    const tmrValid=String.fromCharCode(...tmrBytes)==='TMR SEGA';
    const bcd0=bytes[0x7FFC],bcd1=bytes[0x7FFD],bcdHi=(bytes[0x7FFE]>>4)&0xF;
    const prodCode=bcdHi.toString(16).toUpperCase()+(bcd1.toString(16).padStart(2,'0')+bcd0.toString(16).padStart(2,'0')).toUpperCase();
    const romVer=bytes[0x7FFE]&0xF;
    const regionNib=(bytes[0x7FFF]>>4)&0xF;
    const sizeNib=bytes[0x7FFF]&0xF;
    const headerChk=(bytes[0x7FFA]|(bytes[0x7FFB]<<8))>>>0;
    document.getElementById('info-tmr').innerHTML=tmrValid?'<span class="ok">✓ TMR SEGA</span>':'<span class="warn">✗ missing</span>';
    const regionStr=REGION_NAMES[regionNib]??`Unknown (0x${regionNib.toString(16).toUpperCase()})`;
    const romSizeStr=ROM_SIZES[sizeNib]??`Unknown (0x${sizeNib.toString(16).toUpperCase()})`;
    document.getElementById('info-product').textContent=`${prodCode} · ${regionStr}`;
    document.getElementById('info-version').textContent=`v${romVer}`;
    document.getElementById('info-size').textContent+=` · header: ${romSizeStr}`;
    checksumsHTML+=` &nbsp;&nbsp; <span style="color:var(--dim);font-size:10px">HEADER CHK</span> 0x${headerChk.toString(16).toUpperCase().padStart(4,'0')}`;
  }
  document.getElementById('info-checksums').innerHTML=checksumsHTML;

  ['panel-info','panel-banks','panel-map','panel-palettes','panel-viewer','panel-composer','panel-simulator','panel-ram'].forEach(id=>
    document.getElementById(id).classList.remove('hidden'));

  refreshMapUI();doRender();
  showToast(`ROM loaded: ${fileName} (${(bytes.length/1024).toFixed(0)} KB)`);
  updateBadges();
}

function loadMapJson(jsonText,fileName){
  let data;try{data=JSON.parse(jsonText);}catch(e){showToast('Invalid JSON',true);return;}
  if(romData&&data.romMD5&&data.romMD5!==romMD5){
    showToast(`MD5 mismatch! JSON is for ${data.romMD5.slice(0,8)}… current ROM is ${romMD5.slice(0,8)}…`,true);return;
  }
  mapData.schemaVersion=data.schemaVersion??1;
  mapData.romVersion=data.romVersion??'unknown';
  if(data.romMD5)mapData.romMD5=data.romMD5;
  if(data.romName)mapData.romName=data.romName;
  mapData.romSizeBytes=data.romSizeBytes??mapData.romSizeBytes;
  mapData.regions=data.regions??[];
  mapData.compositions=data.compositions??[];
  mapData.ram=data.ram??[];
  mapData.notes=data.notes??'';
  _pendingAsmSplitPlan=null;
  document.getElementById('asm-split-review').classList.remove('open');
  let maxId=0;
  for(const r of mapData.regions){const n=parseInt((r.id||'r0').replace(/\D/g,''),10);if(n>maxId)maxId=n;}
  _idCounter=maxId+1;
  let maxRamId=0;
  for(const e of mapData.ram){const n=parseInt((e.id||'ram0').replace(/\D/g,''),10);if(n>maxRamId)maxRamId=n;}
  _ramIdCounter=maxRamId+1;
  if(romData){
    ['panel-banks','panel-map','panel-palettes','panel-viewer','panel-composer','panel-simulator','panel-ram'].forEach(id=>document.getElementById(id).classList.remove('hidden'));
    refreshMapUI();doRender();ramRenderTable();
  }
  showToast(`Map loaded: ${fileName} — ${mapData.regions.length} regions`);
  updateBadges();
}

async function loadAsmFile(text, fileName, {silent=false}={}) {
  asmText = text;
  asmAnalysis = buildAsmAnalysis(text);
  asmFileName = fileName;
  _pendingAsmSplitPlan=null;
  document.getElementById('asm-split-review').classList.remove('open');
  if (silent) {
    updateBadges();
    showToast(`ASM loaded (${fileName})`);
    return;
  }
  showToast('Parsing disassembly…');
  const regions = asmAnalysis.regions;
  if (!regions.length) { showToast('No regions found in ASM file', true); return; }
  showImportPreview(regions);
  updateBadges();
  document.getElementById('panel-map').scrollIntoView({behavior:'smooth'});
  showToast(`Found ${regions.length} regions — review import below`);
}

async function handleFile(file){
  const name=file.name.toLowerCase();
  try{
    if(name.endsWith('.sms')){await loadRom(await file.arrayBuffer(),file.name);}
    else if(name.endsWith('.zip')){showToast('Extracting ZIP…');const sms=await extractSmsFromZip(await file.arrayBuffer());await loadRom(sms.data.buffer,sms.name);}
    else if(name.endsWith('.json')){loadMapJson(await file.text(),file.name);}
    else if(name.endsWith('.asm')){await loadAsmFile(await file.text(),file.name);}
    else{showToast(`Unsupported: ${file.name}`,true);}
  }catch(err){showError(`Error loading "${file.name}": ${err.message}`);console.error(err);}
}

async function handleFiles(files){
  clearError();
  const arr=Array.from(files);
  const romFile=arr.find(f=>/\.(sms|zip)$/i.test(f.name));
  const jsonFile=arr.find(f=>/\.json$/i.test(f.name));
  const asmFile=arr.find(f=>/\.asm$/i.test(f.name));
  if(romFile)await handleFile(romFile);
  if(jsonFile)await handleFile(jsonFile);
  if(asmFile)await handleFile(asmFile);
  if(!romFile&&!jsonFile&&!asmFile&&arr.length)showToast('No .sms/.zip/.json/.asm found',true);
}

const dz=document.getElementById('drop-zone');
dz.addEventListener('dragenter',(e)=>{e.preventDefault();dz.classList.add('drag-over');});
dz.addEventListener('dragleave',(e)=>{if(!dz.contains(e.relatedTarget))dz.classList.remove('drag-over');});
dz.addEventListener('dragover',(e)=>e.preventDefault());
dz.addEventListener('drop',(e)=>{e.preventDefault();dz.classList.remove('drag-over');handleFiles(e.dataTransfer.files);});
document.getElementById('file-input').addEventListener('change',(e)=>{handleFiles(e.target.files);e.target.value='';});
document.getElementById('btn-load-json').addEventListener('click',()=>document.getElementById('json-input').click());
document.getElementById('json-input').addEventListener('change',(e)=>{if(e.target.files[0])handleFile(e.target.files[0]);e.target.value='';});
document.getElementById('btn-load-asm').addEventListener('click',()=>document.getElementById('asm-input').click());
document.getElementById('asm-input').addEventListener('change',(e)=>{if(e.target.files[0])handleFile(e.target.files[0]);e.target.value='';});


// ═══════════════════════════════════════════════════════
//  EXPORT
// ═══════════════════════════════════════════════════════
document.getElementById('btn-export-json').addEventListener('click',()=>{
  if(!romData&&!mapData.regions.length){showToast('Nothing to export',true);return;}
  const out={...mapData,analyzedAt:new Date().toISOString()};
  const blob=new Blob([JSON.stringify(out,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=`${mapData.romVersion||'rom-map'}.json`;a.click();
  URL.revokeObjectURL(url);
  showToast(`Exported ${a.download}`);
});


// ═══════════════════════════════════════════════════════
//  MISC
// ═══════════════════════════════════════════════════════
function showError(msg){const e=document.getElementById('error-msg');e.textContent=msg;e.classList.add('visible');}
function clearError(){document.getElementById('error-msg').classList.remove('visible');}
let _toastTimer=null;
function showToast(msg,err=false){
  const t=document.getElementById('toast');t.textContent=msg;t.className='show'+(err?' err':'');
  clearTimeout(_toastTimer);_toastTimer=setTimeout(()=>t.className='',3000);
}
window.addEventListener('resize',()=>{if(romData)renderRomMap();});


// ═══════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════
buildPaletteUI();
_compCells = Array(_compW * _compH).fill(-1);
initSimulatorPanel();
initPanelCollapse();
loadProjects();
