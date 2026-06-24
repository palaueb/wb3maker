// ═══════════════════════════════════════════════════════
//  SPRITE / BG COMPOSER
// ═══════════════════════════════════════════════════════

// State
let _compCells = [];        // flat array of tile indices (-1 = empty)
let _compW = 2, _compH = 4; // grid dimensions in tiles
let _compEditingId = null;  // id of loaded composition (null = new)
let _compSelTile = -1;      // currently selected tile index in picker
let _compPickerTileCount = 128;
let _compPickerOffset = 0;  // tile index offset within the region
const COMP_CELL_ZOOM = 2;   // zoom for the composition grid cells (8px * 2 = 16px each)
const COMP_PICKER_PER_ROW = 8;
const COMP_PICKER_ZOOM = 2;

function compGetTileBytes() {
  const selId = document.getElementById('comp-tile-region').value;
  const r = selId ? mapData.regions.find(x => x.id === selId) : null;
  if (!r || !romData) return null;
  const off = parseHex(r.offset) ?? 0;
  return romData.subarray(off, off + (r.size ?? 0));
}

function compGetPalette() {
  const selId = document.getElementById('comp-palette').value;
  if (!selId) return viewerPalette;
  const r = mapData.regions.find(x => x.id === selId);
  if (!r || !romData) return viewerPalette;
  if (r.type === 'palette_manual') return resolvePaletteManualColors(r);
  return decodePaletteAt(romData, parseHex(r.offset) ?? 0, 16);
}

function compGetPaletteSpr() {
  const selId = document.getElementById('comp-palette-spr').value;
  if (!selId) return null;
  const r = mapData.regions.find(x => x.id === selId);
  if (!r || !romData) return null;
  if (r.type === 'palette_manual') return resolvePaletteManualColors(r);
  return decodePaletteAt(romData, parseHex(r.offset) ?? 0, 16);
}

function compDrawTileToCtx(ctx, tBytes, tileIdx, bx, by, zoom, pal) {
  const off = tileIdx * 32;
  if (off + 32 > tBytes.length) return;
  const pixels = decodeTile(tBytes, off);
  for (let py = 0; py < 8; py++) for (let px = 0; px < 8; px++) {
    const ci = pixels[py * 8 + px];
    ctx.fillStyle = pal[ci] || '#000000';
    ctx.fillRect(bx + px * zoom, by + py * zoom, zoom, zoom);
  }
}

// Render tile picker canvas
function compRenderPicker() {
  const tBytes = compGetTileBytes();
  const pal = compGetPalette();
  const startTile = _compPickerOffset;
  const count = _compPickerTileCount;
  const perRow = COMP_PICKER_PER_ROW;
  const zoom = COMP_PICKER_ZOOM;
  const rows = Math.ceil(count / perRow);
  const canvas = document.getElementById('comp-picker-canvas');
  canvas.width = perRow * 8 * zoom;
  canvas.height = rows * 8 * zoom;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (!tBytes) {
    ctx.fillStyle = '#555'; ctx.font = '11px Courier New';
    ctx.fillText('Select a tile region above', 4, 20); return;
  }
  for (let i = 0; i < count; i++) {
    const tIdx = startTile + i;
    const bx = (i % perRow) * 8 * zoom;
    const by = Math.floor(i / perRow) * 8 * zoom;
    compDrawTileToCtx(ctx, tBytes, tIdx, bx, by, zoom, pal);
  }
  // Highlight selected tile
  if (_compSelTile >= startTile && _compSelTile < startTile + count) {
    const i = _compSelTile - startTile;
    const bx = (i % perRow) * 8 * zoom;
    const by = Math.floor(i / perRow) * 8 * zoom;
    ctx.strokeStyle = '#00d4ff'; ctx.lineWidth = 2;
    ctx.strokeRect(bx + 1, by + 1, 8 * zoom - 2, 8 * zoom - 2);
  }
  document.getElementById('comp-sel-label').textContent =
    _compSelTile >= 0 ? `tile #${_compSelTile} (0x${_compSelTile.toString(16).toUpperCase().padStart(3,'0')})` : 'no tile selected';
}

// Render composition grid canvas
function compRenderGrid() {
  const tBytes = compGetTileBytes();
  const pal = compGetPalette();
  const zoom = COMP_CELL_ZOOM;
  const cellPx = 8 * zoom;
  const canvas = document.getElementById('comp-grid-canvas');
  canvas.width = _compW * cellPx;
  canvas.height = _compH * cellPx;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#111'; ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Grid lines
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 1;
  for (let x = 0; x <= _compW; x++) { ctx.beginPath(); ctx.moveTo(x * cellPx, 0); ctx.lineTo(x * cellPx, canvas.height); ctx.stroke(); }
  for (let y = 0; y <= _compH; y++) { ctx.beginPath(); ctx.moveTo(0, y * cellPx); ctx.lineTo(canvas.width, y * cellPx); ctx.stroke(); }

  for (let ci = 0; ci < _compW * _compH; ci++) {
    const tIdx = _compCells[ci];
    if (tIdx < 0 || !tBytes) continue;
    const bx = (ci % _compW) * cellPx;
    const by = Math.floor(ci / _compW) * cellPx;
    compDrawTileToCtx(ctx, tBytes, tIdx, bx, by, zoom, pal);
  }
}

// Render large preview canvas
function compRenderPreview() {
  const tBytes = compGetTileBytes();
  const pal = compGetPalette();
  const zoom = parseInt(document.getElementById('comp-zoom').value) || 3;
  const canvas = document.getElementById('comp-preview-canvas');
  canvas.width = _compW * 8 * zoom;
  canvas.height = _compH * 8 * zoom;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!tBytes) return;
  for (let ci = 0; ci < _compW * _compH; ci++) {
    const tIdx = _compCells[ci];
    if (tIdx < 0) continue;
    const bx = (ci % _compW) * 8 * zoom;
    const by = Math.floor(ci / _compW) * 8 * zoom;
    compDrawTileToCtx(ctx, tBytes, tIdx, bx, by, zoom, pal);
  }
}

function compRenderAll() {
  compRenderPicker();
  compRenderGrid();
  compRenderPreview();
}

function compResizeGrid() {
  const newW = Math.max(1, Math.min(64, parseInt(document.getElementById('comp-w').value) || 2));
  const newH = Math.max(1, Math.min(64, parseInt(document.getElementById('comp-h').value) || 4));
  const newCells = Array(newW * newH).fill(-1);
  // Copy existing cells that fit
  for (let y = 0; y < Math.min(_compH, newH); y++)
    for (let x = 0; x < Math.min(_compW, newW); x++)
      newCells[y * newW + x] = _compCells[y * _compW + x] ?? -1;
  _compW = newW; _compH = newH; _compCells = newCells;
  compRenderAll();
}

function compUpdateRegionSelects() {
  const tileReg = document.getElementById('comp-tile-region');
  const palSel = document.getElementById('comp-palette');
  const palSprSel = document.getElementById('comp-palette-spr');
  const tmSel = document.getElementById('comp-tilemap-region');
  const prevTile = tileReg.value, prevPal = palSel.value, prevPalSpr = palSprSel.value, prevTm = tmSel.value;

  tileReg.innerHTML = '<option value="">— none —</option>';
  palSel.innerHTML = '<option value="">Viewer palette</option>';
  palSprSel.innerHTML = '<option value="">= BG palette</option>';
  tmSel.innerHTML = '<option value="">— none —</option>';

  for (const r of mapData.regions) {
    if (r.type === 'gfx_tiles' || r.type === 'gfx_sprites') {
      tileReg.innerHTML += `<option value="${r.id}"${r.id===prevTile?' selected':''}>${r.name||r.offset} (${r.type})</option>`;
    }
    if (r.type === 'palette' || r.type === 'palette_manual') {
      palSel.innerHTML += `<option value="${r.id}"${r.id===prevPal?' selected':''}>${r.name||r.offset} (${r.type})</option>`;
      palSprSel.innerHTML += `<option value="${r.id}"${r.id===prevPalSpr?' selected':''}>${r.name||r.offset} (${r.type})</option>`;
    }
    if (r.type === 'tile_map') {
      tmSel.innerHTML += `<option value="${r.id}"${r.id===prevTm?' selected':''}>${r.name||r.offset} (tile_map)</option>`;
    }
  }
}

function compRenderSavedList() {
  const wrap = document.getElementById('comp-saved-list');
  const comps = mapData.compositions || [];
  if (!comps.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = '<div class="lab-section-title" style="margin-top:12px">SAVED COMPOSITIONS</div>';
  for (const c of comps) {
    const div = document.createElement('div');
    div.className = 'comp-saved-item';
    const dims = c.mode === 'manual' ? `${c.width}×${c.height} tiles` :
      `${c.cropW}×${c.cropH} tiles (crop)`;
    const catColors = {background_tile:'#00d4ff',sprite:'#ff6b35',enemy:'#f87171',ui:'#ffcc00',fx:'#a855f7'};
    const catLabel = c.category ? `<span style="color:${catColors[c.category]||'#aaa'};font-size:9px;border:1px solid currentColor;border-radius:2px;padding:0 3px;margin-left:4px">${c.category.replace('_',' ').toUpperCase()}</span>` : '';
    div.innerHTML = `
      <div class="comp-saved-name">${c.name||'Unnamed'}${catLabel}</div>
      <div class="comp-saved-dims">${dims} · ${c.mode.toUpperCase()}</div>
      <button class="btn small" data-load="${c.id}">LOAD</button>
      <button class="btn small danger" data-del="${c.id}">×</button>`;
    wrap.appendChild(div);
  }
  wrap.querySelectorAll('[data-load]').forEach(btn => btn.addEventListener('click', () => {
    const c = (mapData.compositions||[]).find(x => x.id === btn.dataset.load);
    if (!c) return;
    document.getElementById('comp-name').value = c.name || '';
    document.getElementById('comp-category').value = c.category || '';
    if (c.mode === 'manual') {
      document.getElementById('comp-w').value = c.width;
      document.getElementById('comp-h').value = c.height;
      _compW = c.width; _compH = c.height;
      _compCells = [...(c.cells || [])];
      if (c.tileRegionId) document.getElementById('comp-tile-region').value = c.tileRegionId;
      if (c.palRegionId) document.getElementById('comp-palette').value = c.palRegionId;
      document.querySelectorAll('.composer-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'manual'));
      document.querySelectorAll('.composer-pane').forEach(p => p.classList.toggle('active', p.id === 'comp-pane-manual'));
      compRenderAll();
    } else {
      if (c.tileRegionId) document.getElementById('comp-tile-region').value = c.tileRegionId;
      if (c.tileMapRegionId) document.getElementById('comp-tilemap-region').value = c.tileMapRegionId;
      if (c.palRegionId) document.getElementById('comp-palette').value = c.palRegionId;
      document.getElementById('comp-crop-x').value = c.cropX || 0;
      document.getElementById('comp-crop-y').value = c.cropY || 0;
      document.getElementById('comp-crop-w').value = c.cropW || 32;
      document.getElementById('comp-crop-h').value = c.cropH || 28;
      document.querySelectorAll('.composer-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'tilemap'));
      document.querySelectorAll('.composer-pane').forEach(p => p.classList.toggle('active', p.id === 'comp-pane-tilemap'));
      compRenderTileMap();
    }
    _compEditingId = c.id;
    compUpdateEditingUI();
    showToast(`Loaded "${c.name||'Unnamed'}"`);
  }));
  wrap.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', () => {
    mapData.compositions = (mapData.compositions||[]).filter(x => x.id !== btn.dataset.del);
    compRenderSavedList(); triggerAutoSave();
  }));
}

function compRenderTileMap() {
  const tmId = document.getElementById('comp-tilemap-region').value;
  const tmReg = tmId ? mapData.regions.find(x => x.id === tmId) : null;
  const tileId = document.getElementById('comp-tile-region').value;
  const tileReg = tileId ? mapData.regions.find(x => x.id === tileId) : null;

  if (!tmReg || !romData) { showToast('Select a Tile Map region', true); return; }

  const tBytes = tileReg ? romData.subarray(parseHex(tileReg.offset)??0, (parseHex(tileReg.offset)??0)+(tileReg.size??0)) : null;
  const pal = compGetPalette();
  const palSpr = compGetPaletteSpr() || pal;

  const tmOff = parseHex(tmReg.offset) ?? 0;
  const tmBytes = romData.subarray(tmOff, tmOff + (tmReg.size ?? 0));
  const cropX = Math.max(0, parseInt(document.getElementById('comp-crop-x').value)||0);
  const cropY = Math.max(0, parseInt(document.getElementById('comp-crop-y').value)||0);
  const cropW = Math.max(1, parseInt(document.getElementById('comp-crop-w').value)||32);
  const cropH = Math.max(1, parseInt(document.getElementById('comp-crop-h').value)||28);
  const mapCols = 32; // SMS BG always 32 wide
  const zoom = parseInt(document.getElementById('comp-zoom').value)||3;

  const canvas = document.getElementById('comp-tilemap-canvas');
  canvas.width = cropW * 8 * zoom;
  canvas.height = cropH * 8 * zoom;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let row = 0; row < cropH; row++) {
    for (let col = 0; col < cropW; col++) {
      const mapIdx = (cropY + row) * mapCols + (cropX + col);
      const byteOff = mapIdx * 2;
      if (byteOff + 1 >= tmBytes.length) continue;
      const entry = tmBytes[byteOff] | (tmBytes[byteOff+1] << 8);
      const tileIdx = entry & 0x1FF;
      const hflip = (entry >> 9) & 1, vflip = (entry >> 10) & 1;
      const palOff = (entry >> 11) & 1;
      if (!tBytes) continue;
      const off = tileIdx * 32;
      if (off + 32 > tBytes.length) continue;
      const pixels = decodeTile(tBytes, off);
      const bx = col * 8 * zoom, by = row * 8 * zoom;
      for (let py = 0; py < 8; py++) for (let px = 0; px < 8; px++) {
        const sx = hflip ? 7 - px : px, sy = vflip ? 7 - py : py;
        const ci = pixels[sy*8+sx];
        ctx.fillStyle = (palOff ? palSpr : pal)[ci] || '#000';
        ctx.fillRect(bx + px*zoom, by + py*zoom, zoom, zoom);
      }
    }
  }
}

// Event wiring for composer
document.querySelectorAll('.composer-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.composer-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.composer-pane').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('comp-pane-' + tab.dataset.tab).classList.add('active');
  });
});

document.getElementById('btn-comp-resize').addEventListener('click', compResizeGrid);
document.getElementById('btn-comp-clear-grid').addEventListener('click', () => {
  _compCells = Array(_compW * _compH).fill(-1);
  compRenderGrid(); compRenderPreview();
});
document.getElementById('btn-comp-picker-render').addEventListener('click', () => {
  _compPickerOffset = Math.max(0, parseInt(document.getElementById('comp-picker-start').value)||0);
  _compPickerTileCount = Math.max(1, Math.min(512, parseInt(document.getElementById('comp-picker-count').value)||128));
  compRenderPicker();
});
document.getElementById('comp-tile-region').addEventListener('change', () => {
  compRenderPicker(); compRenderGrid(); compRenderPreview();
});
document.getElementById('comp-palette').addEventListener('change', () => {
  compRenderPicker(); compRenderGrid(); compRenderPreview();
});
document.getElementById('comp-zoom').addEventListener('change', compRenderPreview);

// Tile picker — click to select a tile
document.getElementById('comp-picker-canvas').addEventListener('click', e => {
  const canvas = e.currentTarget;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const px = (e.clientX - rect.left) * scaleX;
  const py = (e.clientY - rect.top) * scaleY;
  const zoom = COMP_PICKER_ZOOM;
  const col = Math.floor(px / (8 * zoom));
  const row = Math.floor(py / (8 * zoom));
  const i = row * COMP_PICKER_PER_ROW + col;
  _compSelTile = _compPickerOffset + i;
  compRenderPicker();
});

// Composition grid — click to place, right-click to clear
const compGridCanvas = document.getElementById('comp-grid-canvas');
compGridCanvas.addEventListener('click', e => {
  if (_compSelTile < 0) { showToast('Select a tile in the picker first', true); return; }
  const rect = compGridCanvas.getBoundingClientRect();
  const scaleX = compGridCanvas.width / rect.width;
  const scaleY = compGridCanvas.height / rect.height;
  const px = (e.clientX - rect.left) * scaleX;
  const py = (e.clientY - rect.top) * scaleY;
  const cellPx = 8 * COMP_CELL_ZOOM;
  const col = Math.floor(px / cellPx);
  const row = Math.floor(py / cellPx);
  const ci = row * _compW + col;
  if (ci < 0 || ci >= _compCells.length) return;
  _compCells[ci] = _compSelTile;
  compRenderGrid(); compRenderPreview();
  document.getElementById('comp-cell-info').textContent =
    `Cell (${col},${row}) → tile #${_compSelTile}`;
});
compGridCanvas.addEventListener('contextmenu', e => {
  e.preventDefault();
  const rect = compGridCanvas.getBoundingClientRect();
  const scaleX = compGridCanvas.width / rect.width;
  const scaleY = compGridCanvas.height / rect.height;
  const px = (e.clientX - rect.left) * scaleX;
  const py = (e.clientY - rect.top) * scaleY;
  const cellPx = 8 * COMP_CELL_ZOOM;
  const ci = Math.floor(py / cellPx) * _compW + Math.floor(px / cellPx);
  if (ci >= 0 && ci < _compCells.length) {
    _compCells[ci] = -1;
    compRenderGrid(); compRenderPreview();
  }
});

document.getElementById('btn-comp-render-tilemap').addEventListener('click', compRenderTileMap);

function compUpdateEditingUI(){
  const btn=document.getElementById('btn-comp-update');
  if(_compEditingId){
    const c=(mapData.compositions||[]).find(x=>x.id===_compEditingId);
    btn.style.display=c?'':'none';
    if(c)btn.title=`Update "${c.name||'Unnamed'}" in place`;
  } else {
    btn.style.display='none';
  }
}

function compBuildPayload(id){
  const activeTab=document.querySelector('.composer-tab.active')?.dataset.tab||'manual';
  const name=document.getElementById('comp-name').value.trim()||'Unnamed';
  const tileRegionId=document.getElementById('comp-tile-region').value;
  const palRegionId=document.getElementById('comp-palette').value;
  const category=document.getElementById('comp-category').value;
  if(activeTab==='manual'){
    return{id,name,category,mode:'manual',tileRegionId,palRegionId,width:_compW,height:_compH,cells:[..._compCells]};
  } else {
    return{id,name,category,mode:'tilemap',tileRegionId,palRegionId,
      tileMapRegionId:document.getElementById('comp-tilemap-region').value,
      cropX:parseInt(document.getElementById('comp-crop-x').value)||0,
      cropY:parseInt(document.getElementById('comp-crop-y').value)||0,
      cropW:parseInt(document.getElementById('comp-crop-w').value)||32,
      cropH:parseInt(document.getElementById('comp-crop-h').value)||28};
  }
}

// Update existing composition
document.getElementById('btn-comp-update').addEventListener('click',()=>{
  if(!_compEditingId)return;
  const idx=(mapData.compositions||[]).findIndex(x=>x.id===_compEditingId);
  if(idx===-1){showToast('Composition no longer exists',true);_compEditingId=null;compUpdateEditingUI();return;}
  const comp=compBuildPayload(_compEditingId);
  mapData.compositions[idx]=comp;
  compRenderSavedList();triggerAutoSave();
  showToast(`"${comp.name}" updated`);
});

// Save as new composition
document.getElementById('btn-comp-save').addEventListener('click', () => {
  if (!mapData.compositions) mapData.compositions = [];
  const comp=compBuildPayload(genId());
  mapData.compositions.push(comp);
  _compEditingId=comp.id;
  compUpdateEditingUI();
  compRenderSavedList(); triggerAutoSave();
  showToast(`"${comp.name}" saved`);
});

// Export PNG
document.getElementById('btn-comp-export-png').addEventListener('click', () => {
  const activeTab = document.querySelector('.composer-tab.active')?.dataset.tab || 'manual';
  const canvas = activeTab === 'manual'
    ? document.getElementById('comp-preview-canvas')
    : document.getElementById('comp-tilemap-canvas');
  const a = document.createElement('a');
  a.download = (document.getElementById('comp-name').value.trim() || 'composition') + '.png';
  a.href = canvas.toDataURL('image/png');
  a.click();
});
