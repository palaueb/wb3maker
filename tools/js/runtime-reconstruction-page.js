'use strict';

(function () {
  const MODEL_URL = '../projects/WORLD/map.json';

  const FALLBACK_AREAS = [
    { id: 'sms_render_core', phase: '3A', title: 'SMS-like Render Core', purpose: 'Synthetic VRAM/CRAM, tile decoding, name table rendering and provenance overlays.', assetKinds: ['screen', 'vram_load_plan', 'graphics_data', 'palette_data'], keywords: ['render', 'vdp', 'vram', 'cram', 'tile'] },
    { id: 'room_zone_loader', phase: '3B', title: 'Room and Zone Loader', purpose: 'Zone recipes, room descriptors, loaders, scroll maps and transitions.', assetKinds: ['room_data', 'scene_recipe', 'screen', 'vram_load_plan'], keywords: ['room', 'zone', 'loader', 'transition'] },
    { id: 'camera_scroll_collision', phase: '3C', title: 'Camera, Scroll, and Collision', purpose: 'Camera anchors, scroll flags, collision buffers and bounds.', assetKinds: ['gameplay_routine', 'ram_symbol', 'runtime_observation', 'room_data'], keywords: ['collision', 'camera', 'scroll'] },
    { id: 'player_runtime', phase: '3D', title: 'Player Runtime', purpose: 'Forms, state machine, motion physics, damage, knockback and placement.', assetKinds: ['gameplay_routine', 'ram_symbol', 'runtime_observation'], keywords: ['player', 'physics', 'movement', 'damage'] },
    { id: 'entity_runtime', phase: '3E', title: 'Entity Runtime', purpose: 'Entity records, animation, behavior families and dynamic tile uploads.', assetKinds: ['entity_data', 'graphics_data', 'gameplay_routine', 'runtime_observation'], keywords: ['entity', 'enemy', 'sprite', 'animation'] },
    { id: 'audio_runtime', phase: '3F', title: 'Audio Runtime', purpose: 'Music/SFX requests, stream decoder and output abstraction.', assetKinds: ['audio_data', 'runtime_observation'], keywords: ['audio', 'music', 'sfx', 'psg', 'fm'] },
    { id: 'ui_hud_game_state', phase: '3G', title: 'UI, HUD, and Game State', purpose: 'HUD, menus, password/save/progression and transition screens.', assetKinds: ['gameplay_routine', 'ram_symbol', 'screen', 'runtime_observation'], keywords: ['hud', 'menu', 'password', 'status'] },
  ];

  let currentMap = null;
  let currentModel = null;
  let currentAreas = [];

  function $(id) {
    return document.getElementById(id);
  }

  function esc(text) {
    return String(text ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function arr(value) {
    return Array.isArray(value) ? value : [];
  }

  function stat(label, value) {
    return `<div class="stat"><div class="stat-label">${esc(label)}</div><div class="stat-value">${esc(value)}</div></div>`;
  }

  function catalogById(map) {
    const out = new Map();
    for (const [key, value] of Object.entries(map || {})) {
      if (!/Catalogs$/.test(key) || !Array.isArray(value)) continue;
      for (const catalog of value) if (catalog && catalog.id) out.set(catalog.id, { collection: key, catalog });
    }
    return out;
  }

  function textForAsset(asset) {
    return [
      asset.id,
      asset.kind,
      asset.name,
      asset.status,
      asset.confidence,
      asset.summary,
      asset.notes,
      asset.source,
      ...(asset.evidence || []),
      ...(asset.references || []).map(ref => `${ref.kind} ${ref.id || ref.address || ''} ${ref.role || ''} ${ref.label || ''}`),
    ].join(' ').toLowerCase();
  }

  function areaMatchesAsset(area, asset) {
    if (arr(area.assetKinds).includes(asset.kind)) return true;
    const text = textForAsset(asset);
    return arr(area.keywords).some(word => text.includes(String(word).toLowerCase()));
  }

  function catalogSummary(catalog) {
    if (!catalog) return '';
    if (typeof catalog.summary === 'string') return catalog.summary;
    if (catalog.summary && typeof catalog.summary === 'object') {
      const bits = [];
      for (const [key, value] of Object.entries(catalog.summary)) {
        if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') bits.push(`${key}: ${value}`);
        if (bits.length >= 6) break;
      }
      return bits.join('; ');
    }
    return catalog.tool || '';
  }

  function areaSearchText(areaState) {
    const area = areaState.area;
    return [
      area.id,
      area.phase,
      area.title,
      area.purpose,
      area.status,
      ...arr(area.moduleTargets),
      ...arr(area.existingCode),
      ...arr(area.nextActions),
      ...areaState.evidence.map(item => `${item.id} ${item.collection} ${catalogSummary(item.catalog)}`),
      ...areaState.assets.slice(0, 120).map(textForAsset),
    ].join(' ').toLowerCase();
  }

  function buildAreaState(area, assets, catalogIndex) {
    const matchedAssets = assets.filter(asset => areaMatchesAsset(area, asset));
    const evidence = arr(area.evidenceCatalogIds).map(id => {
      const found = catalogIndex.get(id);
      return { id, collection: found?.collection || '', catalog: found?.catalog || null, resolved: !!found };
    });
    const implementedModuleCount = arr(area.existingCode).length;
    const targetModuleCount = arr(area.moduleTargets).length;
    const pendingModuleCount = Math.max(0, targetModuleCount - implementedModuleCount);
    return {
      area,
      assets: matchedAssets,
      evidence,
      implementedModuleCount,
      targetModuleCount,
      pendingModuleCount,
      resolvedEvidenceCount: evidence.filter(item => item.resolved).length,
    };
  }

  function renderStats(areaStates) {
    const implemented = areaStates.reduce((n, s) => n + s.implementedModuleCount, 0);
    const targets = areaStates.reduce((n, s) => n + s.targetModuleCount, 0);
    const evidence = areaStates.reduce((n, s) => n + s.evidence.length, 0);
    const resolvedEvidence = areaStates.reduce((n, s) => n + s.resolvedEvidenceCount, 0);
    const linkedAssets = areaStates.reduce((n, s) => n + s.assets.length, 0);
    $('runtime-stats').innerHTML = [
      stat('Runtime Areas', areaStates.length),
      stat('Module Targets', targets),
      stat('Existing Code Links', implemented),
      stat('Pending Modules', Math.max(0, targets - implemented)),
      stat('Evidence Catalogs', `${resolvedEvidence}/${evidence}`),
      stat('Linked Assets', linkedAssets),
      stat('GDM Assets', currentModel?.summary?.assetCount || 0),
      stat('ROM Regions', currentModel?.summary?.regionCount || 0),
    ].join('');
  }

  function statusClass(status) {
    const s = String(status || '').toLowerCase();
    if (s.includes('shared') || s.includes('partial')) return 'progress';
    if (s.includes('pending') || s.includes('no_shared')) return 'warn';
    return 'ok';
  }

  function renderLines(items, emptyText, itemRenderer) {
    if (!items.length) return `<div class="line dim">${esc(emptyText)}</div>`;
    return items.map(itemRenderer).join('');
  }

  function renderArea(state) {
    const area = state.area;
    const counts = [
      `<span class="pill progress">${esc(area.status || 'mapped')}</span>`,
      `<span class="pill ok">${state.assets.length} ASSETS</span>`,
      `<span class="pill">${state.implementedModuleCount}/${state.targetModuleCount} CODE LINKS</span>`,
      `<span class="pill ${state.resolvedEvidenceCount === state.evidence.length ? 'ok' : 'warn'}">${state.resolvedEvidenceCount}/${state.evidence.length} EVIDENCE</span>`,
    ].join('');
    const topKinds = Object.entries(state.assets.reduce((acc, asset) => {
      acc[asset.kind] = (acc[asset.kind] || 0) + 1;
      return acc;
    }, {})).sort((a, b) => b[1] - a[1]).slice(0, 8);
    return `<section class="area" id="area-${esc(area.id)}">
      <div class="area-head">
        <div>
          <div class="area-title"><span>${esc(area.phase || '')}</span><span>${esc(area.title || area.id)}</span></div>
          <div class="area-purpose">${esc(area.purpose || '')}</div>
        </div>
        <div class="area-counts">${counts}</div>
      </div>
      <div class="area-grid">
        <div class="box">
          <div class="box-title">Module Targets</div>
          ${renderLines(arr(area.moduleTargets), 'No module targets declared.', path => `<div class="line"><code>${esc(path)}</code></div>`)}
        </div>
        <div class="box">
          <div class="box-title">Existing Code</div>
          ${renderLines(arr(area.existingCode), 'No linked code yet.', path => `<div class="line"><code>${esc(path)}</code></div>`)}
        </div>
        <div class="box">
          <div class="box-title">Evidence Catalogs</div>
          ${renderLines(state.evidence, 'No evidence catalogs declared.', item => `<div class="line"><span class="pill ${item.resolved ? 'ok' : 'warn'}">${item.resolved ? 'OK' : 'MISSING'}</span> <code>${esc(item.id)}</code><br><span class="dim">${esc(item.collection || 'not found')}</span><br>${esc(catalogSummary(item.catalog))}</div>`)}
        </div>
        <div class="box">
          <div class="box-title">Linked Asset Kinds</div>
          ${renderLines(topKinds, 'No matching GDM assets.', ([kind, count]) => `<div class="line"><code>${esc(kind)}</code> ${count}</div>`)}
        </div>
        <div class="box">
          <div class="box-title">Next Actions</div>
          ${renderLines(arr(area.nextActions), 'No next actions declared.', item => `<div class="line">${esc(item)}</div>`)}
        </div>
      </div>
    </section>`;
  }

  function populateFilter(areaStates) {
    const select = $('area-filter');
    select.innerHTML = '<option value="">ALL RUNTIME AREAS</option>' + areaStates.map(state =>
      `<option value="${esc(state.area.id)}">${esc(state.area.phase || '')} ${esc(state.area.title || state.area.id)}</option>`
    ).join('');
    select.disabled = false;
  }

  function applyFilters() {
    const areaId = $('area-filter').value;
    const query = $('runtime-search').value.trim().toLowerCase();
    const filtered = currentAreas.filter(state => {
      if (areaId && state.area.id !== areaId) return false;
      if (query && !areaSearchText(state).includes(query)) return false;
      return true;
    });
    const wrap = $('runtime-areas');
    if (!filtered.length) {
      wrap.className = 'empty';
      wrap.innerHTML = 'No runtime areas match the current filter.';
      return;
    }
    wrap.className = 'area-list';
    wrap.innerHTML = filtered.map(renderArea).join('');
  }

  async function loadRuntimeState() {
    const wrap = $('runtime-areas');
    wrap.className = 'empty';
    wrap.innerHTML = 'Loading WORLD runtime reconstruction state...';
    try {
      const response = await fetch(MODEL_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      currentMap = await response.json();
      currentModel = buildGameDataModel(currentMap);
      const catalogIndex = catalogById(currentMap);
      const areas = arr(currentMap.runtimeReconstruction?.areas).length ? currentMap.runtimeReconstruction.areas : FALLBACK_AREAS;
      currentAreas = areas.map(area => buildAreaState(area, currentModel.assets, catalogIndex));
      renderStats(currentAreas);
      populateFilter(currentAreas);
      $('runtime-search').disabled = false;
      applyFilters();
    } catch (err) {
      wrap.className = 'empty error';
      wrap.innerHTML = `Could not load <code>${esc(MODEL_URL)}</code>. Run the local server from the repo root and open this page through it. ${esc(err.message || err)}`;
    }
  }

  $('btn-load-runtime').addEventListener('click', loadRuntimeState);
  $('area-filter').addEventListener('change', applyFilters);
  $('runtime-search').addEventListener('input', applyFilters);

  loadRuntimeState();
}());
