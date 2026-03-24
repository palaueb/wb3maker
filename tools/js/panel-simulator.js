// ═══════════════════════════════════════════════════════════════════════════
//  SMS STATE SIMULATOR
// ═══════════════════════════════════════════════════════════════════════════

function createSMSState() {
  return {
    vram: new Uint8Array(0x4000),  // 16KB: tile patterns [0..$37FF] + name table [$3800..$3FFF]
    cram: new Array(32).fill('#000000')  // 32 entries: 0-15=BG palette, 16-31=SPR palette
  };
}

// _LABEL_8FB_ tile pattern loader
// 5-byte entries: [count, vram_lo, vram_hi, src_lo, src_hi]
//   count=0 → END
//   vram tile slot = vram_lo | (vram_hi << 8)  →  VRAM byte offset = slot * 32
//   bank = src_hi >> 1
//   block_index = ((src_hi & 1) << 8) | src_lo
//   ROM offset = bank * 0x4000 + block_index * 32
function simRunLoader8FB(romData, scriptOffset, state) {
  const log = [];
  let pc = scriptOffset;
  while (pc + 4 < romData.length) {
    const count = romData[pc++];
    if (count === 0) break;
    const vramLo = romData[pc++], vramHi = romData[pc++];
    const srcLo  = romData[pc++], srcHi  = romData[pc++];
    const tileSlot  = vramLo | (vramHi << 8);
    const vramOff   = tileSlot * 32;
    const bank      = srcHi >> 1;
    const blockIdx  = ((srcHi & 1) << 8) | srcLo;
    const romOff    = bank * 0x4000 + blockIdx * 32;
    for (let i = 0; i < count * 32; i++) {
      if (vramOff + i < state.vram.length && romOff + i < romData.length)
        state.vram[vramOff + i] = romData[romOff + i];
    }
    log.push(`8FB tile[${tileSlot}..${tileSlot+count-1}] ← ROM $${romOff.toString(16).toUpperCase().padStart(5,'0')} (bank ${bank}, block $${blockIdx.toString(16).toUpperCase().padStart(2,'0')})`);
  }
  return log;
}

// _LABEL_998_ tile pattern loader
// Variable-length entries:
//   byte=0 → END
//   byte bit7=1 → SetVRAMPos: count = byte & 0x7F; next byte = tile_slot; vramPtr = tile_slot * 32
//   byte bit7=0 → count = byte (no VRAM pos change)
//   count=$7F → fill 32 bytes with 0 at vramPtr, advance vramPtr by 32 (no src bytes)
//   else → 2 src bytes [src_lo, src_hi]:
//     bank = src_hi >> 1
//     block_index = ((src_hi & 1) << 8) | src_lo
//     ROM offset = bank * 0x4000 + block_index * 32
//     copy count * 32 bytes to VRAM at vramPtr, advance vramPtr
function simRunLoader998(romData, scriptOffset, state) {
  const log = [];
  let pc = scriptOffset;
  let vramPtr = 0;
  while (pc < romData.length) {
    let b = romData[pc++];
    if (b === 0) break;
    let count = b & 0x7F;
    if (b & 0x80) {
      const tileSlot = romData[pc++];
      vramPtr = tileSlot * 32;
    }
    if (count === 0x7F) {
      for (let i = 0; i < 32 && vramPtr + i < state.vram.length; i++) state.vram[vramPtr + i] = 0;
      vramPtr += 32;
      log.push(`998 zero-fill → VRAM $${(vramPtr - 32).toString(16).toUpperCase().padStart(4,'0')}`);
      continue;
    }
    if (count === 0) continue; // no-op
    const srcLo = romData[pc++], srcHi = romData[pc++];
    const bank     = srcHi >> 1;
    const blockIdx = ((srcHi & 1) << 8) | srcLo;
    const romOff   = bank * 0x4000 + blockIdx * 32;
    const tileStart = vramPtr >> 5;
    for (let i = 0; i < count * 32; i++) {
      if (vramPtr + i < state.vram.length && romOff + i < romData.length)
        state.vram[vramPtr + i] = romData[romOff + i];
    }
    log.push(`998 tile[${tileStart}..${tileStart+count-1}] ← ROM $${romOff.toString(16).toUpperCase().padStart(5,'0')} (bank ${bank}, block $${blockIdx.toString(16).toUpperCase().padStart(2,'0')})`);
    vramPtr += count * 32;
  }
  return log;
}

// _LABEL_604_ screen_prog → writes name table entries to state.vram[$3800..]
function simRunScreenProg604(romData, scriptOffset, bank8000, state) {
  const NT_BASE = 0x3800;
  const decoded = decodeScreenProg604(romData, scriptOffset, bank8000, { ntBase: NT_BASE });
  for (let i = 0; i < decoded.cells.length; i++) {
    const cell = decoded.cells[i];
    if (!cell.writes) continue;
    state.vram[NT_BASE + i * 2] = cell.tileIdx & 0xFF;
    state.vram[NT_BASE + i * 2 + 1] = cell.attr & 0xFF;
  }
  const log = decoded.trace.map(step => {
    const hexBytes = step.bytes.map(v => v.toString(16).toUpperCase().padStart(2, '0')).join(' ');
    return `ROM $${step.romOffset.toString(16).toUpperCase().padStart(5, '0')}  ${hexBytes.padEnd(8, ' ')}  ${step.detail}`;
  });
  if (decoded.warnings.length) log.push(...decoded.warnings.map(w => `WARN ${w}`));
  return log;
}

// Load palette from ROM into CRAM
function simLoadCRAM(romData, romOffset, count, cramStart, state) {
  const log = [];
  for (let i = 0; i < count; i++) {
    if (romOffset + i < romData.length && cramStart + i < 32) {
      state.cram[cramStart + i] = smsColorToHex(romData[romOffset + i]);
    }
  }
  log.push(`CRAM[${cramStart}..${cramStart+count-1}] ← ROM $${romOffset.toString(16).toUpperCase().padStart(5,'0')}`);
  return log;
}

// Render SMS state (VRAM name table + tile patterns + CRAM) to canvas
function renderSMSState(state, canvas, zoom) {
  zoom = zoom || 2;
  const COLS = 32, ROWS = 28, NT_BASE = 0x3800;
  canvas.width  = COLS * 8 * zoom;
  canvas.height = ROWS * 8 * zoom;
  canvas.style.display = 'block';
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(canvas.width, canvas.height);
  const pxd = img.data;
  for (let i = 0; i < COLS * ROWS; i++) {
    const entryLo  = state.vram[NT_BASE + i * 2];
    const entryHi  = state.vram[NT_BASE + i * 2 + 1];
    const tileIdx  = entryLo | ((entryHi & 0x01) << 8);
    const hflip    = (entryHi >> 1) & 1;
    const vflip    = (entryHi >> 2) & 1;
    const palSel   = (entryHi >> 3) & 1;
    const cramBase = palSel ? 16 : 0;
    const tOff     = tileIdx * 32;
    if (tOff + 32 > state.vram.length) continue;
    const pixels = decodeTile(state.vram, tOff);
    const bx = (i % COLS) * 8 * zoom, by = Math.floor(i / COLS) * 8 * zoom;
    for (let py = 0; py < 8; py++) for (let px = 0; px < 8; px++) {
      const sx = hflip ? 7 - px : px, sy = vflip ? 7 - py : py;
      const ci  = pixels[sy * 8 + sx];
      const hex = state.cram[cramBase + ci] || '#000000';
      const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), bv = parseInt(hex.slice(5,7),16);
      for (let zy = 0; zy < zoom; zy++) for (let zx = 0; zx < zoom; zx++) {
        const idx = ((by + py*zoom + zy) * canvas.width + (bx + px*zoom + zx)) * 4;
        pxd[idx] = r; pxd[idx+1] = g; pxd[idx+2] = bv; pxd[idx+3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

// ── Scene Gallery ─────────────────────────────────────────────────────────────
function simRenderGallery() {
  const scenes = mapData.simScenes || [];
  const container = document.getElementById('sim-gallery');
  const empty = document.getElementById('sim-gallery-empty');
  if (!container) return;
  if (!scenes.length) {
    container.innerHTML = '';
    if (empty) empty.style.display = '';
    return;
  }
  if (empty) empty.style.display = 'none';
  container.innerHTML = scenes.map((sc, i) => {
    const thumbHtml = sc.thumb
      ? `<img src="${sc.thumb}" style="width:128px;height:auto;image-rendering:pixelated;display:block;border:1px solid var(--border);border-radius:2px;">`
      : `<div style="width:128px;height:56px;background:#0a0a0a;border:1px solid var(--border);border-radius:2px;display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--dim)">no render</div>`;
    const stepSummary = (sc.steps || []).map(s => {
      const colors = {cram_bg:'#ffcc00',cram_spr:'#ffa500',vram_8fb:'#ff6b35',vram_998:'#ff35a0',nt_604:'#00d4ff',nt_604_raw:'#00ff88'};
      return `<span style="color:${colors[s.type]||'#aaa'};font-size:9px">${s.type.toUpperCase()}</span>`;
    }).join(' ');
    return `<div style="background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:4px;padding:6px;display:flex;flex-direction:column;align-items:center;gap:5px;width:140px;">
      ${thumbHtml}
      <div style="font-size:11px;color:var(--text);font-weight:bold;text-align:center;width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${sc.name.replace(/"/g,'&quot;')}">${sc.name}</div>
      <div style="display:flex;flex-wrap:wrap;gap:2px;justify-content:center">${stepSummary}</div>
      <div style="display:flex;gap:3px;">
        <button class="btn small primary" onclick="simLoadScene(${i})" title="Load steps from this scene">LOAD</button>
        <button class="btn small" onclick="simRenameScene(${i})" title="Rename">✎</button>
        <button class="btn small danger" onclick="simDeleteScene(${i})" title="Delete">✕</button>
      </div>
    </div>`;
  }).join('');
}

function simSaveScene() {
  if (!simSteps.length) { showToast('No steps to save', true); return; }
  if (!mapData.simScenes) mapData.simScenes = [];
  const defaultName = 'Scene ' + (mapData.simScenes.length + 1);
  const name = window.prompt('Scene name:', defaultName);
  if (name === null) return;
  // Capture thumbnail: downscale the rendered canvas to 128×112
  let thumb = null;
  const canvas = document.getElementById('sim-canvas');
  if (canvas && canvas.style.display !== 'none' && canvas.width > 0) {
    const tc = document.createElement('canvas');
    tc.width = 128; tc.height = 112;
    tc.getContext('2d').drawImage(canvas, 0, 0, 128, 112);
    thumb = tc.toDataURL('image/png');
  }
  mapData.simScenes.push({
    id: 'sc' + Date.now().toString(36),
    name: name.trim() || defaultName,
    steps: JSON.parse(JSON.stringify(simSteps)),
    thumb,
  });
  simRenderGallery();
  triggerAutoSave();
  showToast(`Scene "${name.trim() || defaultName}" saved`);
}

function simLoadScene(idx) {
  const sc = (mapData.simScenes || [])[idx];
  if (!sc) return;
  simSteps = JSON.parse(JSON.stringify(sc.steps));
  simRenderStepsList();
  showToast(`Scene "${sc.name}" loaded — ${sc.steps.length} steps`);
}

function simRenameScene(idx) {
  const sc = (mapData.simScenes || [])[idx];
  if (!sc) return;
  const name = window.prompt('Rename scene:', sc.name);
  if (name === null || !name.trim()) return;
  sc.name = name.trim();
  simRenderGallery();
  triggerAutoSave();
}

function simDeleteScene(idx) {
  const sc = (mapData.simScenes || [])[idx];
  if (!sc) return;
  if (!confirm(`Delete scene "${sc.name}"?`)) return;
  mapData.simScenes.splice(idx, 1);
  simRenderGallery();
  triggerAutoSave();
}

// ── Simulator Panel ──────────────────────────────────────────────────────────
let simSteps = []; // [{type, regionId, bank}]
let simImportedVRAM = null; // Uint8Array(16384) loaded from binary file
let simImportedCRAM = null; // Array(32) of '#rrggbb' strings
let simRoomEntries = []; // [{index, z80Addr, romOff}]

// Build base state from imported data + init steps (CRAM + VRAM tiles only, no name table)
function simBuildBaseState() {
  const state = createSMSState();
  if (simImportedVRAM) state.vram.set(simImportedVRAM.slice(0, 0x4000));
  if (simImportedCRAM) simImportedCRAM.forEach((c, i) => { if (i < 32) state.cram[i] = c; });
  if (!romData) return state;
  for (const step of simSteps) {
    const r = mapData.regions.find(x => x.id === step.regionId);
    if (!r) continue;
    const off = parseHex(r.offset) ?? 0;
    if (step.type === 'cram_bg') {
      if (r.type === 'palette_manual') { const cols = resolvePaletteManualColors(r); cols.forEach((c,i) => { if(i<16) state.cram[i]=c; }); }
      else simLoadCRAM(romData, off, 16, 0, state);
    } else if (step.type === 'cram_spr') {
      if (r.type === 'palette_manual') { const cols = resolvePaletteManualColors(r); cols.forEach((c,i) => { if(i<16) state.cram[16+i]=c; }); }
      else simLoadCRAM(romData, off, 16, 16, state);
    } else if (step.type === 'vram_8fb') {
      simRunLoader8FB(romData, off, state);
    } else if (step.type === 'vram_998') {
      simRunLoader998(romData, off, state);
    }
    // nt_604 steps are applied only in simRunAll, not here
  }
  return state;
}

// ── Room Browser ──────────────────────────────────────────────────────────────
function simParseRoomTable() {
  if (!romData) { alert('Load a ROM first'); return; }
  const tableOff = parseHex(document.getElementById('sim-room-table-off').value) ?? 0x1CCC0;
  const count    = parseInt(document.getElementById('sim-room-count').value) || 31;
  const bank     = parseInt(document.getElementById('sim-room-bank').value) || 7;
  const bankBase = bank * 0x4000;   // ROM offset of bank start
  const winBase  = 0x8000;          // Z80 window where this bank is paged

  simRoomEntries = [];
  for (let i = 0; i < count; i++) {
    const wordOff = tableOff + i * 2;
    if (wordOff + 1 >= romData.length) break;
    const z80Addr = romData[wordOff] | (romData[wordOff + 1] << 8);
    const romOff  = bankBase + (z80Addr - winBase);
    if (romOff < 0 || romOff >= romData.length) continue;
    simRoomEntries.push({ index: i, z80Addr, romOff });
  }

  const sel = document.getElementById('sim-room-sel');
  sel.innerHTML = simRoomEntries.map(r =>
    `<option value="${r.index}">Room ${r.index.toString().padStart(2,' ')} · ROM $${r.romOff.toString(16).toUpperCase().padStart(5,'0')}  (Z80 ${bank.toString(16).toUpperCase().padStart(2,'0')}:${r.z80Addr.toString(16).toUpperCase().padStart(4,'0')})</option>`
  ).join('');
  sel.style.display = '';
  document.getElementById('btn-sim-render-room').style.display = '';
  document.getElementById('btn-sim-add-nt-step').style.display = '';
  document.getElementById('sim-room-info').textContent =
    `${simRoomEntries.length} rooms parsed · table @ ROM $${tableOff.toString(16).toUpperCase().padStart(5,'0')}`;
}

function simRenderRoom() {
  if (!romData) { alert('Load a ROM first'); return; }
  const idx = parseInt(document.getElementById('sim-room-sel').value);
  const entry = simRoomEntries[idx];
  if (!entry) return;
  const bank = parseInt(document.getElementById('sim-room-bank').value) || 7;

  const state = simBuildBaseState();
  const log   = simRunScreenProg604(romData, entry.romOff, bank, state);

  // Analyse which VRAM tile slots are used by this room's name table
  const NT_BASE = 0x3800, COLS = 32, ROWS = 28;
  const usedSlots = new Set();
  for (let i = 0; i < COLS * ROWS; i++) {
    const lo = state.vram[NT_BASE + i*2], hi = state.vram[NT_BASE + i*2 + 1];
    const tileIdx = lo | ((hi & 0x01) << 8);
    usedSlots.add(tileIdx);
  }
  const slots = [...usedSlots].sort((a,b) => a-b);
  const minSlot = slots[0] ?? 0, maxSlot = slots[slots.length-1] ?? 0;
  const minOff = minSlot * 32, maxOff = maxSlot * 32 + 31;

  const canvas = document.getElementById('sim-canvas');
  renderSMSState(state, canvas);

  document.getElementById('sim-info').innerHTML =
    `Room ${entry.index} · ${log.length} ops · ` +
    `<span style="color:#00d4ff">Tiles used: ${slots.length} unique · slots ${minSlot}–${maxSlot} · VRAM $${minOff.toString(16).toUpperCase().padStart(4,'0')}–$${maxOff.toString(16).toUpperCase().padStart(4,'0')}</span>`;
  document.getElementById('sim-log').innerHTML =
    `<div style="color:#4a9eff;margin-bottom:3px">VRAM tile slots used: [${slots.map(s=>s.toString(16).toUpperCase().padStart(2,'0')).join(' ')}]</div>` +
    log.slice(0, 40).map(l => `<div>${l.replace(/</g,'&lt;')}</div>`).join('') +
    (log.length > 40 ? `<div style="color:#555">… +${log.length - 40} more ops</div>` : '');
}

const SIM_STEP_HINTS = {
  cram_bg:   'Select a palette region → loads 16 colors into CRAM slots 0–15 (BG palette)',
  cram_spr:  'Select a palette region → loads 16 colors into CRAM slots 16–31 (SPR palette)',
  vram_8fb:  'Select a vram_loader DATA region (5-byte entries, e.g. _DATA_2A55_). NOT the code label.',
  vram_998:  'Select a vram_loader DATA region (variable format, e.g. _DATA_2AE2_). NOT the code label.',
  nt_604:    'Select a screen_prog region → writes name table cells to VRAM $3800–$3FFF',
};

function simGetRegionOptions(types) {
  return mapData.regions
    .filter(r => types.includes(r.type))
    .map(r => `<option value="${r.id}">${r.name || r.offset} (${r.type})</option>`)
    .join('');
}

function simRefreshStepTypeRegionFilter() {
  const type = document.getElementById('sim-step-type').value;
  const sel  = document.getElementById('sim-step-region');
  const palTypes    = ['palette','palette_manual'];
  const loaderTypes = ['vram_loader','vram_loader_8fb','vram_loader_998','gfx_tiles','gfx_sprites'];
  const ntTypes     = ['screen_prog'];
  let allowed;
  if (type === 'cram_bg' || type === 'cram_spr') allowed = palTypes;
  else if (type === 'vram_8fb' || type === 'vram_998') allowed = loaderTypes;
  else allowed = ntTypes;
  const filtered = mapData.regions.filter(r => allowed.includes(r.type));
  sel.innerHTML = '<option value="">— select region —</option>' +
    filtered.map(r => `<option value="${r.id}">${r.name||r.id} @ ${r.offset} [${r.type}]</option>`).join('');
}

function simRenderStepsList() {
  const container = document.getElementById('sim-steps');
  if (!simSteps.length) {
    container.innerHTML = '<div style="font-size:11px;color:var(--dim);font-style:italic">No steps yet. Add steps below.</div>';
    return;
  }
  container.innerHTML = simSteps.map((s, i) => {
    const typeColors = {cram_bg:'#ffcc00',cram_spr:'#ffa500',vram_8fb:'#ff6b35',vram_998:'#ff35a0',nt_604:'#00d4ff',nt_604_raw:'#00ff88'};
    const col = typeColors[s.type] || '#aaa';
    let rLabel;
    if (s.type === 'nt_604_raw') {
      rLabel = s.label || `ROM $${(s.romOff||0).toString(16).toUpperCase().padStart(5,'0')}`;
    } else {
      const r = mapData.regions.find(x => x.id === s.regionId);
      rLabel = r ? `${r.name || r.id} @ ${r.offset}` : s.regionId;
    }
    const typeLabel = s.type === 'nt_604_raw' ? 'NAME TABLE' : s.type.toUpperCase();
    return `<div style="display:flex;align-items:center;gap:6px;padding:3px 6px;background:rgba(255,255,255,.03);border-left:3px solid ${col};border-radius:2px;font-size:11px;">
      <span style="color:${col};font-weight:bold;min-width:90px;letter-spacing:.5px">${typeLabel}</span>
      <span style="flex:1;color:var(--text)">${rLabel}</span>
      ${(s.type.startsWith('vram') || s.type.startsWith('nt')) ? `<span style="color:var(--dim)">bank ${s.bank}</span>` : ''}
      <button class="btn small danger" onclick="simSteps.splice(${i},1);simRenderStepsList();" style="padding:1px 5px;font-size:10px">✕</button>
    </div>`;
  }).join('');
}

function simRunAll() {
  if (!romData && !simImportedVRAM) { document.getElementById('sim-info').textContent = '⚠ No ROM loaded and no VRAM imported'; return; }
  const state = simBuildBaseState();
  if (simSteps.length === 0 && (simImportedVRAM || simImportedCRAM)) {
    // Just render the imported state
    const canvas = document.getElementById('sim-canvas');
    renderSMSState(state, canvas);
    const nzVram = state.vram.filter(b => b !== 0).length;
    document.getElementById('sim-info').innerHTML =
      `Imported state rendered · VRAM: ${nzVram} non-zero bytes · CRAM: ${state.cram.filter(c=>c!=='#000000').length}/32 colors`;
    return;
  }
  // Base state (CRAM + VRAM) already built by simBuildBaseState above.
  // Now apply only name table steps on top.
  const allLog = [];
  for (const step of simSteps) {
    if (step.type === 'nt_604') {
      const r = mapData.regions.find(x => x.id === step.regionId);
      if (!r) { allLog.push(`⚠ region ${step.regionId} not found`); continue; }
      const off = parseHex(r.offset) ?? 0;
      const log = simRunScreenProg604(romData, off, step.bank, state);
      allLog.push(...log);
    } else if (step.type === 'nt_604_raw') {
      const log = simRunScreenProg604(romData, step.romOff, step.bank, state);
      allLog.push(...log);
    }
  }
  const canvas = document.getElementById('sim-canvas');
  renderSMSState(state, canvas);
  const ntSteps = simSteps.filter(s => s.type === 'nt_604').length;
  document.getElementById('sim-info').innerHTML =
    `${simSteps.length} step(s) · ${ntSteps} name table(s) applied · VRAM: ${state.vram.filter(b=>b!==0).length} non-zero bytes · CRAM: ${state.cram.filter(c=>c!=='#000000').length}/32 colors`;
  document.getElementById('sim-log').innerHTML =
    allLog.slice(0,80).map(l => `<div>${l.replace(/</g,'&lt;')}</div>`).join('') +
    (allLog.length > 80 ? `<div style="color:#555">… +${allLog.length-80} more</div>` : '');
}

function initSimulatorPanel() {
  // Room browser
  document.getElementById('btn-sim-parse-table').addEventListener('click', simParseRoomTable);
  document.getElementById('btn-sim-render-room').addEventListener('click', simRenderRoom);
  document.getElementById('btn-sim-add-nt-step').addEventListener('click', () => {
    const idx = parseInt(document.getElementById('sim-room-sel').value);
    const entry = simRoomEntries[idx];
    if (!entry) return;
    const bank = parseInt(document.getElementById('sim-room-bank').value) || 7;
    simSteps.push({ type: 'nt_604_raw', romOff: entry.romOff, bank, label: `Room ${entry.index} @ $${entry.romOff.toString(16).toUpperCase().padStart(5,'0')}` });
    simRenderStepsList();
  });

  // Populate bank selector
  const bankSel = document.getElementById('sim-step-bank');
  for (let b = 0; b < 16; b++) {
    const o = document.createElement('option');
    o.value = b; o.textContent = `${b}`;
    if (b === 7) o.selected = true;
    bankSel.appendChild(o);
  }
  function simUpdateHint() {
    const type = document.getElementById('sim-step-type').value;
    document.getElementById('sim-step-hint').textContent = SIM_STEP_HINTS[type] || '';
  }
  document.getElementById('sim-step-type').addEventListener('change', () => {
    simRefreshStepTypeRegionFilter();
    simUpdateHint();
  });
  simRefreshStepTypeRegionFilter();
  simUpdateHint();

  // VRAM binary import
  document.getElementById('btn-sim-import-vram').addEventListener('click', () => {
    document.getElementById('sim-vram-file').click();
  });
  document.getElementById('sim-vram-file').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const buf = new Uint8Array(ev.target.result);
      if (buf.length < 0x4000) {
        alert(`File too small: ${buf.length} bytes — expected 16384 (16KB VRAM dump)`);
        return;
      }
      simImportedVRAM = buf.slice(0, 0x4000);
      const statusEl = document.getElementById('sim-import-status');
      statusEl.style.display = 'block';
      document.getElementById('sim-vram-status').textContent =
        `✓ VRAM: ${f.name} (${buf.length >= 0x4000 ? '16KB' : buf.length + 'B'})`;
      document.getElementById('sim-info').textContent = `VRAM loaded — click RUN to render`;
    };
    reader.readAsArrayBuffer(f);
    e.target.value = '';
  });

  // CRAM hex import (paste 32 bytes as hex)
  document.getElementById('btn-sim-import-cram').addEventListener('click', () => {
    const hex = window.prompt(
      'Paste 32 CRAM bytes as hex (space-separated or continuous).\n' +
      'Example from Emulicious Color RAM: 0F 25 00 3F ...\n' +
      '(Each byte = 00BBGGRR, 2 bits/channel)',
      ''
    );
    if (!hex) return;
    const bytes = hex.trim().replace(/[^0-9a-fA-F]/g, ' ').trim().split(/\s+/)
      .filter(s => s.length > 0)
      .map(s => parseInt(s, 16));
    if (bytes.length < 1) { alert('No valid hex bytes found'); return; }
    simImportedCRAM = [];
    for (let i = 0; i < 32; i++) {
      simImportedCRAM.push(i < bytes.length ? smsColorToHex(bytes[i]) : '#000000');
    }
    const statusEl = document.getElementById('sim-import-status');
    statusEl.style.display = 'block';
    document.getElementById('sim-cram-status').textContent =
      `✓ CRAM: ${bytes.length} bytes pasted`;
    document.getElementById('sim-info').textContent = 'CRAM loaded — click RUN to render';
  });
  document.getElementById('btn-sim-add-step').addEventListener('click', () => {
    const type = document.getElementById('sim-step-type').value;
    const regionId = document.getElementById('sim-step-region').value;
    const bank = parseInt(document.getElementById('sim-step-bank').value);
    if (!regionId) { alert('Select a region first'); return; }
    simSteps.push({ type, regionId, bank });
    simRenderStepsList();
  });
  document.getElementById('btn-sim-run').addEventListener('click', simRunAll);
  document.getElementById('btn-sim-reset').addEventListener('click', () => {
    simSteps = [];
    simImportedVRAM = null;
    simImportedCRAM = null;
    simRenderStepsList();
    document.getElementById('sim-canvas').style.display = 'none';
    document.getElementById('sim-info').textContent = '';
    document.getElementById('sim-log').innerHTML = '';
    document.getElementById('sim-room-info').textContent = '';
    document.getElementById('sim-import-status').style.display = 'none';
    document.getElementById('sim-vram-status').textContent = '';
    document.getElementById('sim-cram-status').textContent = '';
  });
  simRenderStepsList();
  simRenderGallery();

  document.getElementById('btn-sim-save-scene').addEventListener('click', simSaveScene);
}
