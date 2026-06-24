// ═══════════════════════════════════════════════════════
//  PROJECT SYSTEM
// ═══════════════════════════════════════════════════════
var API = '../api.php';
let activeProject = null;
let _autoSaveTimer = null;

async function apiGet(params) {
  const url = API + '?' + new URLSearchParams(params);
  const r = await fetch(url);
  return r.json();
}

async function loadProjects() {
  try {
    const data = await apiGet({ action: 'list_projects' });
    if (!data.ok) { renderProjectList([]); return; }
    renderProjectList(data.projects);
  } catch {
    document.getElementById('project-list').innerHTML =
      '<div style="color:var(--dim);font-size:11px">⚠ API not available — running without project support (open index.html via php -S)</div>';
  }
}

function renderProjectList(projects) {
  const wrap = document.getElementById('project-list');
  if (!projects.length) {
    wrap.innerHTML = '<div style="color:var(--dim);font-size:11px;font-style:italic">No projects yet. Create one below.</div>';
    return;
  }
  wrap.innerHTML = '';
  for (const p of projects) {
    const card = document.createElement('div');
    card.className = 'project-card' + (p.name === activeProject ? ' active' : '');
    card.dataset.project = p.name;
    const romTag  = `<span class="file-tag ${p.romFile  ? 'present' : 'missing'}">${p.romFile ? 'ROM ✓' : 'ROM —'}</span>`;
    const asmTag  = `<span class="file-tag ${p.asmFile  ? 'present' : 'missing'}">${p.asmFile ? 'ASM ✓' : 'ASM —'}</span>`;
    const jsonTag = `<span class="file-tag ${p.hasJson  ? 'present' : 'missing'}">${p.hasJson ? 'MAP ✓' : 'MAP —'}</span>`;
    const saved   = p.jsonSaved ? `<div class="project-save-indicator">saved ${p.jsonSaved}</div>` : '';
    card.innerHTML = `<div class="project-card-name">${p.name}</div><div class="project-card-files">${romTag}${asmTag}${jsonTag}</div>${saved}`;
    card.addEventListener('click', () => loadProject(p.name, p));
    wrap.appendChild(card);
  }
}

async function loadProject(name, meta) {
  // Don't set activeProject yet — prevents autosave from firing with empty data during load
  document.getElementById('btn-save-project').disabled = true;
  document.getElementById('project-upload-wrap').style.display = 'flex';
  showToast(`Loading project "${name}"…`);

  // Highlight active card
  document.querySelectorAll('.project-card').forEach(c => c.classList.toggle('active', c.dataset.project === name));

  // If meta not passed, fetch it
  if (!meta) {
    const info = await apiGet({ action: 'project_info', project: name });
    if (!info.ok) { showToast('Could not load project info', true); return; }
    meta = info;
  }

  // Load ROM
  if (meta.romFile) {
    try {
      const resp = await fetch(`${API}?action=get_file&project=${name}&type=rom`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ROM`);
      const buf = await resp.arrayBuffer();
      if (meta.romFile.toLowerCase().endsWith('.zip')) {
        const sms = await extractSmsFromZip(buf);
        await loadRom(sms.data.buffer, sms.name);
      } else {
        await loadRom(buf, meta.romFile);
      }
    } catch(e) { showToast('Error loading ROM: ' + e.message, true); console.error(e); }
  }

  // Load JSON map — must be after ROM so romMD5 is available for validation
  if (meta.hasJson) {
    try {
      const resp = await fetch(`${API}?action=get_file&project=${name}&type=json`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching map`);
      const text = await resp.text();
      loadMapJson(text, 'map.json');
    } catch(e) { showToast('Error loading map: ' + e.message, true); console.error(e); }
  }

  // Force UI refresh regardless (handles edge cases where panels are already open)
  if (romData) {
    ['panel-info','panel-banks','panel-map','panel-palettes','panel-viewer','panel-composer','panel-simulator','panel-ram'].forEach(id =>
      document.getElementById(id).classList.remove('hidden'));
    refreshMapUI();
    doRender();
  }

  // Only now set activeProject — autosave is safe from this point
  activeProject = name;
  document.getElementById('btn-save-project').disabled = false;

  // Load ASM in background (non-blocking, not critical for display)
  if (meta.asmFile) {
    fetch(`${API}?action=get_file&project=${name}&type=asm`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
      .then(text => loadAsmFile(text, meta.asmFile, {silent: true}))
      .catch(e => console.warn('ASM load skipped:', e.message));
  }

  showToast(`Project "${name}" loaded — ${mapData.regions.length} regions`);
  await loadProjects();  // refresh card states
}

async function saveProject() {
  if (!activeProject) { showToast('No active project', true); return; }
  if (!mapData.regions.length && !romMD5) { showToast('Nothing to save', true); return; }

  const json = JSON.stringify({ ...mapData, savedAt: new Date().toISOString() }, null, 2);
  try {
    const r = await fetch(`${API}?action=save_json&project=${encodeURIComponent(activeProject)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: json,
    });
    const data = await r.json();
    if (!data.ok) throw new Error(data.error);
    // Flash indicator
    const msg = document.getElementById('autosave-msg');
    msg.classList.add('show');
    setTimeout(() => msg.classList.remove('show'), 2500);
    await loadProjects();
  } catch(e) {
    showToast('Save failed: ' + e.message, true);
  }
}

// Auto-save hook: called at the end of refreshMapUI
function triggerAutoSave() {
  if (!activeProject) return;
  clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(saveProject, 3000);  // 3s debounce
}

// Manual save button
document.getElementById('btn-save-project').addEventListener('click', saveProject);

// Create project
document.getElementById('btn-create-project').addEventListener('click', async () => {
  const name = document.getElementById('new-project-name').value.trim().replace(/[^a-zA-Z0-9_\-]/g,'');
  if (!name) { showToast('Enter a project name', true); return; }
  const data = await apiGet({ action: 'create_project', project: name });
  if (!data.ok) { showToast(data.error, true); return; }
  document.getElementById('new-project-name').value = '';
  showToast(`Project "${name}" created`);
  await loadProjects();
});

// Upload files to active project
async function uploadToProject(file) {
  if (!activeProject) { showToast('Select a project first', true); return; }
  const fd = new FormData();
  fd.append('file', file);
  try {
    const r = await fetch(`${API}?action=upload_file&project=${encodeURIComponent(activeProject)}`, {
      method: 'POST', body: fd,
    });
    const data = await r.json();
    if (!data.ok) throw new Error(data.error);
    showToast(`Uploaded: ${data.file} (${(data.bytes/1024).toFixed(0)} KB)`);
    // Auto-load after upload
    const info = await apiGet({ action: 'project_info', project: activeProject });
    if (info.ok) await loadProject(activeProject, info);
    else await loadProjects();
  } catch(e) { showToast('Upload failed: ' + e.message, true); }
}

document.getElementById('upload-rom-input').addEventListener('change', e => {
  if (e.target.files[0]) uploadToProject(e.target.files[0]);
  e.target.value = '';
});
document.getElementById('upload-asm-input').addEventListener('change', e => {
  if (e.target.files[0]) uploadToProject(e.target.files[0]);
  e.target.value = '';
});


// ═══════════════════════════════════════════════════════
//  RAM MAP
// ═══════════════════════════════════════════════════════
let _ramIdCounter = 1;

const RAM_TYPES = {
  byte:    {label:'byte',    color:'#ffcc00'},
  word:    {label:'word',    color:'#00d4ff'},
  flag:    {label:'flag',    color:'#00ff88'},
  counter: {label:'counter', color:'#ff6b35'},
  pointer: {label:'pointer', color:'#9b59ff'},
  buffer:  {label:'buffer',  color:'#ff35a0'},
  other:   {label:'other',   color:'#60608a'},
};

function ramNormalizeAddr(s) {
  s = s.trim().replace(/^(\$|0x)/i,'');
  const n = parseInt(s, 16);
  if (isNaN(n)) return null;
  return '$' + n.toString(16).toUpperCase().padStart(4,'0');
}

function ramEsc(s) {
  return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function ramRenderTable() {
  const tbody = document.getElementById('ram-tbody');
  const empty = document.getElementById('ram-empty');
  const entries = mapData.ram || [];

  if (!entries.length) {
    tbody.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  const sorted = [...entries].sort((a, b) => {
    const pa = parseInt(a.address.replace('$',''), 16);
    const pb = parseInt(b.address.replace('$',''), 16);
    return pa - pb;
  });

  tbody.innerHTML = sorted.map(e => {
    const meta = RAM_TYPES[e.type] || RAM_TYPES.other;
    return `<tr data-id="${e.id}">
      <td class="ram-addr">${ramEsc(e.address)}</td>
      <td contenteditable="true" class="ram-editable ram-size-cell"
          data-id="${e.id}" data-field="size"
          style="color:var(--dim);text-align:right;padding-right:16px;min-width:36px">${e.size}</td>
      <td>
        <select class="type-select ram-type-sel" data-id="${e.id}"
          style="border-color:${meta.color};color:${meta.color}">
          ${Object.entries(RAM_TYPES).map(([k,v])=>
            `<option value="${k}"${k===e.type?' selected':''}>${v.label}</option>`).join('')}
        </select>
      </td>
      <td contenteditable="true" class="ram-editable" data-id="${e.id}" data-field="name">${ramEsc(e.name||'')}</td>
      <td contenteditable="true" class="ram-editable" data-id="${e.id}" data-field="notes"
        style="color:var(--dim);font-size:11px">${ramEsc(e.notes||'')}</td>
      <td><button class="btn small danger ram-del-btn" data-id="${e.id}">✕</button></td>
    </tr>`;
  }).join('');

  // Delete
  tbody.querySelectorAll('.ram-del-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      mapData.ram = mapData.ram.filter(e => e.id !== btn.dataset.id);
      ramRenderTable();
      triggerAutoSave();
    });
  });

  // Inline type change
  tbody.querySelectorAll('.ram-type-sel').forEach(sel => {
    sel.addEventListener('change', () => {
      const entry = mapData.ram.find(e => e.id === sel.dataset.id);
      if (entry) {
        entry.type = sel.value;
        const meta = RAM_TYPES[sel.value] || RAM_TYPES.other;
        sel.style.borderColor = meta.color;
        sel.style.color = meta.color;
        triggerAutoSave();
      }
    });
  });

  // Inline edit size — with overlap eviction
  tbody.querySelectorAll('.ram-size-cell').forEach(cell => {
    cell.addEventListener('blur', () => {
      const entry = mapData.ram.find(e => e.id === cell.dataset.id);
      if (!entry) return;
      const newSize = parseInt(cell.textContent.trim(), 10);
      if (!newSize || newSize < 1) { cell.textContent = entry.size; return; }
      if (newSize === entry.size) return;
      const base = parseInt(entry.address.replace('$',''), 16);
      const end  = base + newSize; // exclusive
      // Remove any other entry whose start address falls within [base+1, end-1]
      const evicted = mapData.ram.filter(e => {
        if (e.id === entry.id) return false;
        const a = parseInt(e.address.replace('$',''), 16);
        return a > base && a < end;
      });
      entry.size = newSize;
      if (evicted.length) {
        const ids = new Set(evicted.map(e => e.id));
        mapData.ram = mapData.ram.filter(e => !ids.has(e.id));
        showToast(`Size → ${newSize} · removed ${evicted.length} overlapping entr${evicted.length===1?'y':'ies'}`);
      }
      triggerAutoSave();
      ramRenderTable();
    });
    cell.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); cell.blur(); }
    });
  });

  // Inline edit name / notes
  tbody.querySelectorAll('.ram-editable:not(.ram-size-cell)').forEach(cell => {
    cell.addEventListener('blur', () => {
      const entry = mapData.ram.find(e => e.id === cell.dataset.id);
      if (entry) {
        entry[cell.dataset.field] = cell.textContent.trim();
        triggerAutoSave();
      }
    });
    cell.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); cell.blur(); }
    });
  });
}

// Toggle add form
document.getElementById('btn-ram-add-toggle').addEventListener('click', () => {
  const form = document.getElementById('ram-add-form');
  const open = form.classList.toggle('open');
  if (open) document.getElementById('ram-frm-addr').focus();
});

// Confirm add
document.getElementById('btn-ram-confirm').addEventListener('click', () => {
  const addrRaw = document.getElementById('ram-frm-addr').value;
  const addr = ramNormalizeAddr(addrRaw);
  if (!addr) { showToast('Invalid address — use hex like $C000 or C000', true); return; }
  const size = parseInt(document.getElementById('ram-frm-size').value) || 1;
  const type = document.getElementById('ram-frm-type').value;
  const name = document.getElementById('ram-frm-name').value.trim();
  const notes = document.getElementById('ram-frm-notes').value.trim();

  if (!mapData.ram) mapData.ram = [];
  mapData.ram.push({
    id: 'ram' + ((_ramIdCounter++).toString().padStart(4,'0')),
    address: addr, size, type, name, notes,
  });

  // Reset form
  document.getElementById('ram-frm-addr').value = '';
  document.getElementById('ram-frm-size').value = '1';
  document.getElementById('ram-frm-name').value = '';
  document.getElementById('ram-frm-notes').value = '';
  document.getElementById('ram-add-form').classList.remove('open');

  ramRenderTable();
  triggerAutoSave();
  showToast(`RAM entry added: ${addr}`);
});

// Submit on Enter in the form inputs
['ram-frm-addr','ram-frm-size','ram-frm-name','ram-frm-notes'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-ram-confirm').click();
  });
});
