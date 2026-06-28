'use strict';

(function () {
  const MODEL_URL = '../projects/WORLD/map.json';
  const MUSIC_SONG_TABLE_OFF = 0x0D139;
  const MUSIC_SONG_COUNT = 62;
  const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const TILE_PREVIEW_COLORS = [
    '#050505', '#1b2632', '#2f3f5d', '#3f5f75',
    '#4b6f4b', '#6f8f4b', '#9a9f5a', '#c8b866',
    '#d78a4a', '#c75e54', '#a64f70', '#72518f',
    '#4f5fb5', '#4f8fc3', '#89cfc2', '#f2f0d8',
  ];

  let currentMap = null;
  let currentModel = null;
  let currentCoverage = null;
  let currentAssets = [];
  let currentRegionIndex = new Map();
  let currentRom = null;
  let currentRomName = '';
  let currentPreviewPlayer = null;
  const decoderBoardFilters = {
    family: '',
    status: '',
    capability: '',
    needsLabels: '',
    query: '',
  };
  const labelQueueFilters = {
    family: '',
    decoder: '',
    labelState: '',
    capability: '',
    tag: '',
    query: '',
    targetOnly: false,
    regionIds: null,
    regionListLabel: '',
  };
  const workbenchTargetDecoderIds = [
    'entity_item_records',
    'collision_runtime_catalogs',
    'text_menu_status_records',
    'room_zone_records',
  ];
  const validationResults = new Map();

  function $(id) {
    return document.getElementById(id);
  }

  function esc(text) {
    return String(text ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function stat(label, value) {
    return `<div class="stat"><div class="stat-label">${esc(label)}</div><div class="stat-value">${esc(value)}</div></div>`;
  }

  function configuredAssetCount() {
    return Array.isArray(currentMap?.gameDataModel?.assets) ? currentMap.gameDataModel.assets.length : 0;
  }

  function pctBar(percent) {
    const value = Math.max(0, Math.min(100, Number(percent) || 0));
    return `<div class="pct"><div class="pct-fill" style="width:${value}%"></div><span>${value}%</span></div>`;
  }

  function uiParseOffset(value) {
    if (typeof parseHex === 'function') return parseHex(value);
    const n = Number.parseInt(String(value || '').replace(/^0x/i, ''), 16);
    return Number.isFinite(n) ? n : null;
  }

  function uiHex(value, pad) {
    if (typeof hexStr === 'function') return hexStr(value, pad || 5);
    return '0x' + Number(value || 0).toString(16).toUpperCase().padStart(pad || 5, '0');
  }

  function uiBankOfOffset(offset) {
    return Math.floor(Number(offset || 0) / 0x4000);
  }

  function uiLogicalAddress(offset) {
    const bank = uiBankOfOffset(offset);
    const pageBase = bank === 0 ? 0x0000 : bank === 1 ? 0x4000 : 0x8000;
    return pageBase + (Number(offset || 0) % 0x4000);
  }

  function pill(text, cls) {
    return `<span class="pill ${cls || ''}">${esc(text)}</span>`;
  }

  function regionForAsset(asset) {
    return wb3ResolveAssetRegion(asset, currentMap);
  }

  function decoderById(decoderId) {
    return currentCoverage?.decoders?.find(item => item.id === decoderId) || null;
  }

  function familyById(familyId) {
    return currentCoverage?.families?.find(item => item.id === familyId) || WB3_DECODER_FAMILY_DEFS.find(item => item.id === familyId) || null;
  }

  function visualCollectRegionIds(value, out, depth) {
    if (!value || depth > 7) return out;
    if (Array.isArray(value)) {
      for (const item of value) visualCollectRegionIds(item, out, depth + 1);
      return out;
    }
    if (typeof value !== 'object') return out;
    if (typeof value.regionId === 'string') out.add(value.regionId);
    if (value.region && typeof value.region.id === 'string') out.add(value.region.id);
    for (const [key, child] of Object.entries(value)) {
      if (/catalog|evidence|notes|source|summary/i.test(key)) continue;
      visualCollectRegionIds(child, out, depth + 1);
    }
    return out;
  }

  function visualRecipeRegionIds(recipe) {
    return [...visualCollectRegionIds(recipe, new Set(), 0)].filter(Boolean);
  }

  function visualStepPills(steps) {
    return (steps || []).slice(0, 8).map(step => {
      const kind = step.kind || step.type || '?';
      const cls = /palette|cram/i.test(kind) ? 'ok' : /screen|nt_604/i.test(kind) ? 'progress' : '';
      return pill(String(kind).toUpperCase(), cls);
    }).join(' ');
  }

  function visualZoneStatus(recipe) {
    const bgPalette = recipe?.dependencies?.palette?.index ?? recipe?.subrecord?.bgPaletteIndex ?? recipe?.subrecord?.paletteIndex;
    const spritePalette = recipe?.dependencies?.palette?.spritePalette || null;
    const loader = recipe?.dependencies?.vramLoader8fb || null;
    const extra998 = recipe?.dependencies?.extra998 || null;
    return {
      bgPalette: bgPalette == null ? 'unknown' : String(bgPalette),
      spritePalette: spritePalette?.status || 'unresolved',
      loaderText: loader ? `${loader.region?.id || loader.regionId || '?'} · ${loader.entries ?? '?'} entries` : 'missing 8FB',
      extraText: extra998?.status === 'required' ? `${extra998.regionId || extra998.sourceLabel || '998'} required` : 'no extra 998',
    };
  }

  function renderVisualWorkbench() {
    const el = $('visual-workbench');
    if (!el) return;
    if (!currentMap || !currentCoverage) {
      el.innerHTML = '<div class="browser-title">Visual Rooms & Scenes</div><div class="browser-purpose">Load the WORLD metadata first.</div>';
      return;
    }
    const scenes = currentMap.simScenes || [];
    const sceneRecipes = currentMap.sceneRecipes || [];
    const zoneRecipes = currentMap.zoneRecipes || [];
    const sceneCards = scenes.slice(0, 6).map(scene => {
      const recipe = sceneRecipes.find(item => item.sourceSceneId === scene.id || item.id === `recipe_${scene.id}`) || null;
      const thumb = scene.thumb
        ? `<img class="visual-thumb" src="${esc(scene.thumb)}" alt="">`
        : '<div class="visual-empty-thumb">no render</div>';
      return `<div class="visual-card">
        ${thumb}
        <div class="visual-card-title" title="${esc(scene.name || scene.id)}">${esc(scene.name || scene.id)}</div>
        <div class="visual-card-meta">${visualStepPills(scene.steps)}<br>${esc(recipe ? `recipe ${recipe.id}` : 'saved simulator scene')}</div>
        <div class="decoder-toolbar compact">
          <button class="btn mini visual-scene-open" data-scene-id="${esc(scene.id)}">VIEW</button>
        </div>
      </div>`;
    }).join('');
    const zoneCards = zoneRecipes.slice(0, 8).map(recipe => {
      const status = visualZoneStatus(recipe);
      return `<div class="visual-card">
        <div class="visual-empty-thumb">room recipe</div>
        <div class="visual-card-title" title="${esc(recipe.name || recipe.id)}">${esc(recipe.descriptor?.region?.name || recipe.name || recipe.id)}</div>
        <div class="visual-card-meta">
          BG palette ${esc(status.bgPalette)} · SPR ${esc(status.spritePalette)}<br>
          8FB ${esc(status.loaderText)} · ${esc(status.extraText)}
        </div>
        <div class="decoder-toolbar compact">
          <button class="btn mini visual-zone-open" data-recipe-id="${esc(recipe.id)}">VIEW</button>
          <button class="btn mini visual-zone-focus" data-recipe-id="${esc(recipe.id)}">FOCUS REGIONS</button>
        </div>
      </div>`;
    }).join('');
    el.innerHTML = `
      <div class="browser-head">
        <div>
          <div class="browser-title">Visual Rooms & Scenes</div>
          <div class="browser-purpose">Start here for visual identification. Saved scenes are image previews. Zone recipes are room background render plans; sprite overlay is still a reconstruction task.</div>
        </div>
        <div class="browser-counts">
          ${pill(`${scenes.length} SAVED SCENES`, scenes.length ? 'ok' : 'warn')}
          ${pill(`${zoneRecipes.length} ROOM RECIPES`, 'progress')}
          ${pill(currentRom ? 'ROM LOADED' : 'ROM NEEDED', currentRom ? 'ok' : 'warn')}
        </div>
      </div>
      <div class="visual-status-grid">
        <div class="visual-status"><b>Scene Renders</b><div>${esc(scenes.length)} saved simulator render(s) can be opened here.</div></div>
        <div class="visual-status"><b>Room BG</b><div>${esc(zoneRecipes.length)} zone recipe(s) have tile-loader, DC2 and BG palette metadata.</div></div>
        <div class="visual-status"><b>Sprites</b><div>Entity/sprite data is decoded separately; full room sprite overlay is not integrated in this page yet.</div></div>
        <div class="visual-status"><b>Palettes</b><div>BG palette indices are mapped; many SPR palettes are preserved from runtime state.</div></div>
      </div>
      <div class="box-title">Saved Scene Previews</div>
      <div class="visual-grid">${sceneCards || '<div class="line dim">No saved scene previews in map.json yet.</div>'}</div>
      <div class="box-title" style="margin-top:12px">Room Background Recipes</div>
      <div class="visual-grid">${zoneCards || '<div class="line dim">No zone recipes in map.json yet.</div>'}</div>`;
  }

  function showVisualScene(sceneId) {
    const scene = (currentMap?.simScenes || []).find(item => item.id === sceneId);
    if (!scene) return;
    const recipe = (currentMap?.sceneRecipes || []).find(item => item.sourceSceneId === scene.id || item.id === `recipe_${scene.id}`) || null;
    const rows = (scene.steps || []).map(step => `<tr>
      <td>${esc(step.type || step.kind || '')}</td>
      <td><code>${esc(step.regionId || '')}</code></td>
      <td>${esc(step.bank ?? '')}</td>
    </tr>`).join('');
    $('preview-body').innerHTML = `
      <div class="preview-title">${esc(scene.name || scene.id)}</div>
      ${scene.thumb ? `<img class="visual-thumb" src="${esc(scene.thumb)}" alt="">` : '<div class="visual-empty-thumb">no render</div>'}
      <div class="line">Scene recipe: <code>${esc(recipe?.id || 'not linked')}</code></div>
      <div class="line dim">This is an existing saved simulator preview. It is useful for visual identification, but it is not proof that every gameplay room/sprite overlay is complete.</div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Step</th><th>Region</th><th>Bank</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="3" class="dim">No scene steps recorded.</td></tr>'}</tbody>
      </table></div>`;
  }

  function showVisualZone(recipeId) {
    const recipe = (currentMap?.zoneRecipes || []).find(item => item.id === recipeId);
    if (!recipe) return;
    const status = visualZoneStatus(recipe);
    const regionIds = visualRecipeRegionIds(recipe);
    const regionRows = regionIds.slice(0, 18).map(id => {
      const region = currentRegionIndex.get(id);
      return `<tr><td><code>${esc(id)}</code></td><td>${esc(region?.type || '')}</td><td>${esc(region?.offset || '')}</td><td>${esc(region?.name || '')}</td></tr>`;
    }).join('');
    $('preview-body').innerHTML = `
      <div class="preview-title">${esc(recipe.descriptor?.region?.name || recipe.name || recipe.id)}</div>
      <div class="line">Recipe: <code>${esc(recipe.id)}</code> · descriptor ${esc(recipe.descriptor?.romOffset || '')}</div>
      <div class="line">BG palette ${esc(status.bgPalette)} · SPR palette ${esc(status.spritePalette)} · ${esc(status.loaderText)} · ${esc(status.extraText)}</div>
      <div class="line dim">This is a room background recipe. Correct BG/palette render is handled by the simulator pipeline; full sprite overlay is not finished in this page yet.</div>
      <div class="decoder-toolbar compact">
        <a class="btn mini" href="rom-analyzer.html">OPEN VISUAL SIMULATOR</a>
        <button class="btn mini visual-zone-focus" data-recipe-id="${esc(recipe.id)}">FOCUS REGIONS</button>
      </div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Region</th><th>Type</th><th>Offset</th><th>Name</th></tr></thead>
        <tbody>${regionRows || '<tr><td colspan="4" class="dim">No linked regions found.</td></tr>'}</tbody>
      </table></div>`;
  }

  function focusVisualZone(recipeId) {
    const recipe = (currentMap?.zoneRecipes || []).find(item => item.id === recipeId);
    const regionIds = recipe ? visualRecipeRegionIds(recipe) : [];
    if (!regionIds.length) return;
    labelQueueFilters.targetOnly = false;
    labelQueueFilters.family = '';
    labelQueueFilters.decoder = '';
    labelQueueFilters.labelState = '';
    labelQueueFilters.capability = '';
    labelQueueFilters.tag = '';
    labelQueueFilters.query = '';
    labelQueueFilters.regionIds = regionIds;
    labelQueueFilters.regionListLabel = `${recipeId} visual recipe regions`;
    renderLabelQueue();
    $('label-queue').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function regionAssetKindForDecoder(decoder, region) {
    const preferred = (decoder?.assetKinds || []).find(kind => !['ram_symbol', 'cheat_recipe'].includes(kind));
    if (preferred) return preferred;
    const type = region?.type || '';
    if (type.includes('screen_prog')) return 'screen';
    if (type.includes('vram_loader')) return 'vram_load_plan';
    if (type.includes('palette')) return 'palette_data';
    if (type.includes('music') || type.includes('audio')) return 'audio_data';
    if (type.includes('entity')) return 'entity_data';
    if (type.includes('room')) return 'room_data';
    if (type === 'code') return 'gameplay_routine';
    return 'rom_region';
  }

  function regionPreviewAsset(region, decoder) {
    return {
      id: `region:${region.id}`,
      kind: regionAssetKindForDecoder(decoder, region),
      name: region.name || region.id,
      status: region.type || 'mapped_region',
      confidence: region.confidence || '',
      summary: region.notes || '',
      notes: region.notes || '',
      source: 'mapped_region',
      references: [{ kind: 'region', id: region.id, role: 'label_queue_target' }],
    };
  }

  function assetSearchText(asset) {
    const region = regionForAsset(asset);
    const decoders = wb3DecodersForAsset(asset, region);
    return [
      asset.id,
      asset.kind,
      asset.name,
      asset.status,
      asset.confidence,
      asset.summary,
      asset.notes,
      region?.id,
      region?.type,
      region?.name,
      region?.offset,
      ...decoders.map(decoder => `${decoder.id} ${decoder.label} ${decoder.status}`),
      ...((asset.references || []).map(ref => `${ref.kind || ref.type} ${ref.id || ''} ${ref.role || ''} ${ref.label || ''}`)),
    ].join(' ').toLowerCase();
  }

  function decoderClass(decoder) {
    if (!decoder) return 'warn';
    if (decoder.status === 'implemented') return 'ok';
    if (decoder.status === 'experimental' || decoder.status === 'partial') return 'progress';
    if (decoder.status === 'metadata_only') return '';
    return 'warn';
  }

  function previewText(decoder) {
    const caps = decoder?.previewCapabilities || [];
    if (caps.includes('audio')) return 'LISTEN PROBE';
    if (caps.includes('visual')) return 'VISUAL';
    if (caps.includes('timeline')) return 'TIMELINE';
    if (caps.includes('text')) return 'TEXT';
    return 'METADATA';
  }

  function selectedAttr(value, current) {
    return value === current ? ' selected' : '';
  }

  function capabilityClass(capability) {
    if (capability === 'visual') return 'ok';
    if (capability === 'audio' || capability === 'timeline') return 'progress';
    return '';
  }

  function renderCapabilityPills(decoder) {
    const caps = decoder?.previewCapabilities || [];
    return caps.length
      ? caps.map(capability => pill(capability.toUpperCase(), capabilityClass(capability))).join(' ')
      : pill('NONE', 'warn');
  }

  function incrementCount(target, key) {
    const value = key || '(none)';
    target[value] = (target[value] || 0) + 1;
  }

  function sortedCountText(counts) {
    return Object.entries(counts || {})
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([key, count]) => `${key}:${count}`)
      .join(' · ');
  }

  function decoderMatchesBoardFilters(decoder) {
    if (decoderBoardFilters.family && decoder.familyId !== decoderBoardFilters.family) return false;
    if (decoderBoardFilters.status && decoder.status !== decoderBoardFilters.status) return false;
    if (decoderBoardFilters.capability && !(decoder.previewCapabilities || []).includes(decoderBoardFilters.capability)) return false;
    if (decoderBoardFilters.needsLabels === 'needed' && !Number(decoder.needsLabelCount || 0)) return false;
    if (decoderBoardFilters.needsLabels === 'semantic' && !Number(decoder.semanticLabelCount || 0)) return false;
    if (decoderBoardFilters.query) {
      const family = familyById(decoder.familyId);
      const text = [
        decoder.id,
        decoder.label,
        decoder.status,
        decoder.familyId,
        family?.label,
        decoder.remainingWork,
        ...(decoder.previewCapabilities || []),
        ...(decoder.regionTypes || []),
        ...(decoder.assetKinds || []),
        ...(decoder.evidence || []),
      ].join(' ').toLowerCase();
      if (!text.includes(decoderBoardFilters.query)) return false;
    }
    return true;
  }

  function assetMatchesDecoder(asset, decoderId) {
    if (!decoderId) return true;
    const region = regionForAsset(asset);
    return wb3DecodersForAsset(asset, region).some(decoder => decoder.id === decoderId);
  }

  function renderStats() {
    const summary = currentCoverage.summary;
    const modelSummary = currentModel.summary;
    const curated = configuredAssetCount();
    const derived = Math.max(0, modelSummary.assetCount - curated);
    $('browser-stats').innerHTML = [
      stat('Working Assets', modelSummary.assetCount),
      stat('Curated Seeds', curated),
      stat('Derived Assets', derived),
      stat('Decoder Families', summary.familyCount),
      stat('Decoders', summary.decoderCount),
      stat('Weighted Done', `${summary.weightedImplementationPercent}%`),
      stat('Visual Decoders', summary.visualPreviewDecoderCount),
      stat('Audio Probes', summary.audioPreviewDecoderCount),
      stat('Decoder Regions', summary.labelQueueUniqueRegionCount),
      stat('Need Labels', summary.labelQueueNeedsLabelUniqueRegionCount),
      stat('Region Types', summary.regionTypeCount),
      stat('Local ROM', currentRom ? currentRomName : 'not loaded'),
    ].join('');
  }

  function populateFilters() {
    const browserSel = $('browser-filter');
    const kindSel = $('kind-filter');
    const sourceSel = $('source-filter');
    const decoderSel = $('decoder-filter');
    browserSel.innerHTML = '<option value="">ALL BROWSERS</option>' + (currentMap.assetDataBrowsers?.browsers || [])
      .map(browser => `<option value="${esc(browser.id)}">${esc(browser.label)}</option>`).join('');
    const kinds = [...new Set(currentAssets.map(asset => asset.kind))].sort();
    kindSel.innerHTML = '<option value="">ALL ASSET KINDS</option>' + kinds
      .map(kind => `<option value="${esc(kind)}">${esc(kind)}</option>`).join('');
    const sources = [...new Set(currentAssets.map(asset => asset.source || (asset.derived ? 'derived' : 'curated')))].sort();
    sourceSel.innerHTML = '<option value="">ALL SOURCES</option>' + sources
      .map(source => `<option value="${esc(source)}">${esc(source)}</option>`).join('');
    decoderSel.innerHTML = '<option value="">ALL DECODERS</option>' + currentCoverage.decoders
      .slice()
      .sort((a, b) => a.familyId.localeCompare(b.familyId) || b.implementationPercent - a.implementationPercent || a.id.localeCompare(b.id))
      .map(decoder => `<option value="${esc(decoder.id)}">${esc(decoder.label)} · ${esc(decoder.implementationPercent)}%</option>`).join('');
    browserSel.disabled = false;
    kindSel.disabled = false;
    sourceSel.disabled = false;
    decoderSel.disabled = false;
    $('browser-search').disabled = false;
  }

  function renderDecoderBoard() {
    const statuses = [...new Set(currentCoverage.decoders.map(decoder => decoder.status))].sort();
    const capabilities = [...new Set(currentCoverage.decoders.flatMap(decoder => decoder.previewCapabilities || []))].sort();
    const visibleDecoders = currentCoverage.decoders
      .slice()
      .filter(decoderMatchesBoardFilters)
      .sort((a, b) => a.familyId.localeCompare(b.familyId) || a.id.localeCompare(b.id));
    const rows = currentCoverage.decoders
      .slice()
      .filter(decoderMatchesBoardFilters)
      .sort((a, b) => a.familyId.localeCompare(b.familyId) || a.id.localeCompare(b.id))
      .map(decoder => {
        const family = WB3_DECODER_FAMILY_DEFS.find(item => item.id === decoder.familyId);
        const hasAudio = (decoder.previewCapabilities || []).includes('audio');
        return `<tr>
          <td><b>${esc(decoder.label)}</b><br><code>${esc(decoder.id)}</code></td>
          <td>${esc(family?.label || decoder.familyId)}</td>
          <td>${pctBar(decoder.implementationPercent)}</td>
          <td>${pill(decoder.status.toUpperCase(), decoderClass(decoder))}<br>${renderCapabilityPills(decoder)}</td>
          <td>${esc(decoder.matchedRegionCount)} regions<br><span class="dim">${esc(decoder.matchedAssetCount)} assets · ${esc(decoder.needsLabelCount || 0)} need labels · ${esc(decoder.semanticLabelCount || 0)} labeled</span></td>
          <td>${esc(decoder.regionTypes.join(', ') || decoder.assetKinds.join(', '))}</td>
          <td>${esc((decoder.evidence || []).join(' · '))}</td>
          <td>${esc(decoder.remainingWork || '')}</td>
          <td>
            <button class="btn mini decoder-focus" data-decoder-id="${esc(decoder.id)}">ASSETS</button>
            ${hasAudio ? `<button class="btn mini decoder-focus" data-decoder-id="${esc(decoder.id)}">LISTEN</button>` : ''}
            <button class="btn mini decoder-region-focus" data-decoder-id="${esc(decoder.id)}">REGIONS</button>
            <button class="btn mini decoder-label-focus" data-decoder-id="${esc(decoder.id)}">LABELS</button>
            <button class="btn mini decoder-validate" data-decoder-id="${esc(decoder.id)}">VALIDATE</button>
          </td>
        </tr>`;
      }).join('');
    $('decoder-board').innerHTML = `
      <div class="browser-head">
        <div>
          <div class="browser-title">Decoder Implementation Control</div>
          <div class="browser-purpose">Percentages are implementation readiness, not ROM coverage. Use SHOW ASSETS to review and label the ROM regions each decoder can currently handle.</div>
        </div>
        <div class="browser-counts">
          ${pill(`${currentCoverage.summary.weightedImplementationPercent}% WEIGHTED`, 'progress')}
          ${pill(`${currentCoverage.summary.visualPreviewDecoderCount} VISUAL`, 'ok')}
          ${pill(`${currentCoverage.summary.audioPreviewDecoderCount} AUDIO`, 'progress')}
          ${pill(`${currentCoverage.summary.labelQueueNeedsLabelUniqueRegionCount} NEED LABELS`, 'warn')}
          ${pill(`${visibleDecoders.length}/${currentCoverage.decoders.length} SHOWN`)}
        </div>
      </div>
      <div class="decoder-toolbar">
        <select class="decoder-board-control" data-filter="family">
          <option value="">ALL FAMILIES</option>
          ${currentCoverage.families.map(family => `<option value="${esc(family.id)}"${selectedAttr(family.id, decoderBoardFilters.family)}>${esc(family.label)} · ${esc(family.completionPercent)}%</option>`).join('')}
        </select>
        <select class="decoder-board-control" data-filter="status">
          <option value="">ALL STATUSES</option>
          ${statuses.map(status => `<option value="${esc(status)}"${selectedAttr(status, decoderBoardFilters.status)}>${esc(status.toUpperCase())}</option>`).join('')}
        </select>
        <select class="decoder-board-control" data-filter="capability">
          <option value="">ALL PREVIEWS</option>
          ${capabilities.map(capability => `<option value="${esc(capability)}"${selectedAttr(capability, decoderBoardFilters.capability)}>${esc(capability.toUpperCase())}</option>`).join('')}
        </select>
        <select class="decoder-board-control" data-filter="needsLabels">
          <option value="">ALL LABEL COVERAGE</option>
          <option value="needed"${selectedAttr('needed', decoderBoardFilters.needsLabels)}>NEEDS LABELS</option>
          <option value="semantic"${selectedAttr('semantic', decoderBoardFilters.needsLabels)}>HAS SEMANTIC LABELS</option>
        </select>
        <input class="decoder-board-search" id="decoder-board-search" type="search" placeholder="filter decoders / evidence / remaining work" value="${esc(decoderBoardFilters.query)}">
      </div>
      <div class="table-wrap">
        <table class="asset-table">
          <thead><tr><th>Decoder</th><th>Family</th><th>Done</th><th>Status / Preview</th><th>Mapped</th><th>Types</th><th>Evidence</th><th>Remaining Work</th><th>Queue</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="9" class="dim">No decoders match the active filters.</td></tr>'}</tbody>
        </table>
      </div>`;
  }

  function decoderRegionQueue(decoder) {
    if (!decoder || !currentMap) return [];
    return (currentMap.regions || []).filter(region => wb3DecoderMatchesRegion(decoder, region));
  }

  function validateDecoder(decoderId) {
    const decoder = decoderById(decoderId) || WB3_DECODER_DEFS.find(item => item.id === decoderId);
    if (!decoder) return null;
    const regions = decoderRegionQueue(decoder);
    const result = {
      decoderId,
      decoderLabel: decoder.label || decoderId,
      familyId: decoder.familyId || '',
      implementationPercent: decoder.implementationPercent || 0,
      regionCount: regions.length,
      statusCounts: {},
      readinessCounts: {},
      partialBlockerCounts: {},
      partialBlockerRegionIds: {},
      partialBlockerReadinessCounts: {},
      coreBlockerCounts: {},
      coreBlockerRegionIds: [],
      externalOwnershipCounts: {},
      externalOwnershipRegionIds: {},
      reconstructionProofCounts: {},
      reconstructionProofRegionIds: {},
      reconstructionProofTargetCounts: {},
      reconstructionProofLabels: {},
      reconstructionProofNextSteps: {},
      coreReconstructionProofCounts: {},
      coreReconstructionProofRegionIds: {},
      coreReconstructionProofTargetCounts: {},
      coreReconstructionProofLabels: {},
      coreReconstructionProofNextSteps: {},
      previewKindCounts: {},
      formatCounts: {},
      warningResultCount: 0,
      warningCount: 0,
      exceptionCount: 0,
      noRom: !currentRom,
      samples: [],
      generatedAt: new Date().toISOString(),
    };
    if (!currentRom) {
      result.summary = 'Load the local ROM to validate decoder previews.';
      validationResults.set(decoderId, result);
      return result;
    }
    for (const region of regions) {
      try {
        const asset = regionPreviewAsset(region, decoder);
        const decoded = wb3DecodeAsset(asset, currentRom, currentMap, {
          decoderId,
          region,
          includeTransientPreview: true,
        });
        incrementCount(result.statusCounts, decoded.status);
        const readiness = decoded.metrics?.decodeReadiness || (decoded.status === 'decoded' ? 'decoded_structural' : '(none)');
        const partialBlocker = decoded.metrics?.partialBlocker || 'partial_unspecified';
        incrementCount(result.readinessCounts, readiness);
        if (decoded.status === 'partial') {
          incrementCount(result.partialBlockerCounts, partialBlocker);
          if (!result.partialBlockerRegionIds[partialBlocker]) result.partialBlockerRegionIds[partialBlocker] = [];
          result.partialBlockerRegionIds[partialBlocker].push(region.id || '');
          if (!result.partialBlockerReadinessCounts[partialBlocker]) result.partialBlockerReadinessCounts[partialBlocker] = {};
          incrementCount(result.partialBlockerReadinessCounts[partialBlocker], readiness);
          if (/^owned_by_/.test(partialBlocker)) {
            incrementCount(result.externalOwnershipCounts, partialBlocker);
            if (!result.externalOwnershipRegionIds[partialBlocker]) result.externalOwnershipRegionIds[partialBlocker] = [];
            result.externalOwnershipRegionIds[partialBlocker].push(region.id || '');
          }
        }
        const isCorePartial = decoded.status === 'partial' && !/^owned_by_/.test(partialBlocker);
        for (const proof of decoded.transientPreview?.aggregate?.reconstructionChecklist || []) {
          const proofStatus = proof.status || 'missing';
          const proofKey = proof.key || 'unknown_proof';
          const proofBucket = `${proofStatus}:${proofKey}`;
          incrementCount(result.reconstructionProofCounts, proofBucket);
          if (!result.reconstructionProofRegionIds[proofBucket]) result.reconstructionProofRegionIds[proofBucket] = [];
          result.reconstructionProofRegionIds[proofBucket].push(region.id || '');
          if (!result.reconstructionProofTargetCounts[proofBucket]) result.reconstructionProofTargetCounts[proofBucket] = {};
          incrementCount(result.reconstructionProofTargetCounts[proofBucket], proof.targetModule || decoded.metrics?.reconstructionTargetModule || '(none)');
          if (!result.reconstructionProofLabels[proofBucket]) result.reconstructionProofLabels[proofBucket] = proof.label || proofKey;
          if (!result.reconstructionProofNextSteps[proofBucket]) result.reconstructionProofNextSteps[proofBucket] = proof.nextStep || '';
          if (isCorePartial) {
            incrementCount(result.coreReconstructionProofCounts, proofBucket);
            if (!result.coreReconstructionProofRegionIds[proofBucket]) result.coreReconstructionProofRegionIds[proofBucket] = [];
            result.coreReconstructionProofRegionIds[proofBucket].push(region.id || '');
            if (!result.coreReconstructionProofTargetCounts[proofBucket]) result.coreReconstructionProofTargetCounts[proofBucket] = {};
            incrementCount(result.coreReconstructionProofTargetCounts[proofBucket], proof.targetModule || decoded.metrics?.reconstructionTargetModule || '(none)');
            if (!result.coreReconstructionProofLabels[proofBucket]) result.coreReconstructionProofLabels[proofBucket] = proof.label || proofKey;
            if (!result.coreReconstructionProofNextSteps[proofBucket]) result.coreReconstructionProofNextSteps[proofBucket] = proof.nextStep || '';
          }
        }
        incrementCount(result.previewKindCounts, decoded.transientPreview?.kind || '(none)');
        incrementCount(result.formatCounts, decoded.metrics?.format || '(none)');
        const warningCount = (decoded.warnings || []).length;
        if (warningCount || decoded.status === 'partial') {
          result.warningResultCount++;
          result.warningCount += warningCount;
          if (result.samples.length < 12) {
            result.samples.push({
              regionId: region.id || '',
              offset: region.offset || '',
              type: region.type || '',
              status: decoded.status || '',
              readiness: decoded.metrics?.decodeReadiness || '',
              partialBlocker: decoded.metrics?.partialBlocker || '',
              reconstructionTarget: decoded.metrics?.reconstructionTargetModule || '',
              reconstructionProofs: `${decoded.metrics?.reconstructionProofReadyCount ?? 0}/${(decoded.metrics?.reconstructionProofReadyCount ?? 0) + (decoded.metrics?.reconstructionProofWarningCount ?? 0) + (decoded.metrics?.reconstructionProofMissingCount ?? 0)} ready`,
              previewKind: decoded.transientPreview?.kind || '',
              warningCount,
              summary: decoded.summary || '',
            });
          }
        }
      } catch (err) {
        result.exceptionCount++;
        incrementCount(result.statusCounts, 'exception');
        if (result.samples.length < 8) {
          result.samples.push({
            regionId: region.id || '',
            offset: region.offset || '',
            type: region.type || '',
            status: 'exception',
            summary: err?.message || String(err),
          });
        }
      }
    }
    const decodedCount = result.statusCounts.decoded || 0;
    const partialCount = result.statusCounts.partial || 0;
    const metadataOnlyCount = result.statusCounts.metadata_only || 0;
    result.externalOwnedPartialCount = Object.values(result.externalOwnershipCounts).reduce((sum, count) => sum + Number(count || 0), 0);
    result.coreRegionCount = Math.max(0, result.regionCount - result.externalOwnedPartialCount);
    result.corePartialCount = Math.max(0, partialCount - result.externalOwnedPartialCount);
    result.coreDecodedCount = Math.min(decodedCount, result.coreRegionCount);
    const coreBlockerRegionIds = new Set();
    for (const [blocker, count] of Object.entries(result.partialBlockerCounts || {})) {
      if (/^owned_by_/.test(blocker)) continue;
      result.coreBlockerCounts[blocker] = count;
      for (const regionId of result.partialBlockerRegionIds?.[blocker] || []) {
        if (regionId) coreBlockerRegionIds.add(regionId);
      }
    }
    result.coreBlockerRegionIds = [...coreBlockerRegionIds];
    const topCoreBlocker = Object.entries(result.coreBlockerCounts || {})
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] || null;
    result.topCoreBlocker = topCoreBlocker ? topCoreBlocker[0] : '';
    result.topCoreBlockerCount = topCoreBlocker ? topCoreBlocker[1] : 0;
    result.regionCompletionPercent = result.regionCount ? Math.round((decodedCount / result.regionCount) * 100) : 0;
    result.coreCompletionPercent = result.coreRegionCount ? Math.round((result.coreDecodedCount / result.coreRegionCount) * 100) : 0;
    result.allRegionsRunnable = result.exceptionCount === 0 && result.warningCount === 0 && !result.statusCounts.needs_rom && !result.statusCounts.no_decoder;
    result.allRegionsDecoded = result.regionCount > 0 && decodedCount === result.regionCount && result.allRegionsRunnable;
    result.allCoreRegionsDecoded = result.coreRegionCount > 0 && result.coreDecodedCount === result.coreRegionCount && result.allRegionsRunnable;
    result.summary = result.allRegionsDecoded
      ? `${decodedCount}/${result.regionCount} decoded with no warnings or exceptions.`
      : `${decodedCount} decoded, ${partialCount} partial (${result.corePartialCount} core, ${result.externalOwnedPartialCount} external), ${metadataOnlyCount} metadata-only, ${result.warningCount} warning(s), ${result.exceptionCount} exception(s).`;
    validationResults.set(decoderId, result);
    return result;
  }

  function validateTargetDecoders() {
    for (const decoderId of workbenchTargetDecoderIds) validateDecoder(decoderId);
    renderValidationWorkbench();
  }

  function showWorkbenchTargetLabels(query) {
    labelQueueFilters.targetOnly = true;
    labelQueueFilters.family = '';
    labelQueueFilters.decoder = '';
    labelQueueFilters.labelState = 'needs_any';
    labelQueueFilters.capability = '';
    labelQueueFilters.tag = '';
    labelQueueFilters.regionIds = null;
    labelQueueFilters.regionListLabel = '';
    labelQueueFilters.query = String(query || '').trim().toLowerCase();
    renderLabelQueue();
    $('label-queue').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function showValidationBlockerRegions(decoderId, blocker) {
    const result = validationResults.get(decoderId);
    const regionIds = (result?.partialBlockerRegionIds?.[blocker] || []).filter(Boolean);
    if (!regionIds.length) return;
    labelQueueFilters.targetOnly = false;
    labelQueueFilters.family = '';
    labelQueueFilters.decoder = decoderId;
    labelQueueFilters.labelState = '';
    labelQueueFilters.capability = '';
    labelQueueFilters.tag = '';
    labelQueueFilters.query = '';
    labelQueueFilters.regionIds = regionIds;
    labelQueueFilters.regionListLabel = `${decoderId} · ${blocker}`;
    renderLabelQueue();
    $('label-queue').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function showValidationCoreBlockerRegions(decoderId) {
    const result = validationResults.get(decoderId);
    const regionIds = (result?.coreBlockerRegionIds || []).filter(Boolean);
    if (!regionIds.length) return;
    labelQueueFilters.targetOnly = false;
    labelQueueFilters.family = '';
    labelQueueFilters.decoder = decoderId;
    labelQueueFilters.labelState = '';
    labelQueueFilters.capability = '';
    labelQueueFilters.tag = '';
    labelQueueFilters.query = '';
    labelQueueFilters.regionIds = regionIds;
    labelQueueFilters.regionListLabel = `${decoderId} · core blockers`;
    renderLabelQueue();
    $('label-queue').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function showValidationProofRegions(decoderId, proofBucket) {
    const result = validationResults.get(decoderId);
    const regionIds = (result?.reconstructionProofRegionIds?.[proofBucket] || []).filter(Boolean);
    if (!regionIds.length) return;
    labelQueueFilters.targetOnly = false;
    labelQueueFilters.family = '';
    labelQueueFilters.decoder = decoderId;
    labelQueueFilters.labelState = '';
    labelQueueFilters.capability = '';
    labelQueueFilters.tag = '';
    labelQueueFilters.query = '';
    labelQueueFilters.regionIds = regionIds;
    labelQueueFilters.regionListLabel = `${decoderId} · ${proofBucket}`;
    renderLabelQueue();
    $('label-queue').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function showValidationCoreProofRegions(decoderId, proofBucket) {
    const result = validationResults.get(decoderId);
    const regionIds = (result?.coreReconstructionProofRegionIds?.[proofBucket] || []).filter(Boolean);
    if (!regionIds.length) return;
    labelQueueFilters.targetOnly = false;
    labelQueueFilters.family = '';
    labelQueueFilters.decoder = decoderId;
    labelQueueFilters.labelState = '';
    labelQueueFilters.capability = '';
    labelQueueFilters.tag = '';
    labelQueueFilters.query = '';
    labelQueueFilters.regionIds = regionIds;
    labelQueueFilters.regionListLabel = `${decoderId} · core proof · ${proofBucket}`;
    renderLabelQueue();
    $('label-queue').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function validationClass(result) {
    if (!result || result.noRom) return 'warn';
    if (result.allRegionsDecoded) return 'ok';
    if (result.allCoreRegionsDecoded) return 'ok';
    if (result.allRegionsRunnable) return 'progress';
    return 'warn';
  }

  function validationStatusLabel(result) {
    if (!result) return 'NOT RUN';
    if (result.noRom) return 'NEEDS ROM';
    if (result.allRegionsDecoded) return 'PASS';
    if (result.allCoreRegionsDecoded) return 'CORE PASS';
    if (result.allRegionsRunnable) return 'RUNNABLE GAPS';
    return 'ATTENTION';
  }

  function renderValidationBlockerRows() {
    return [...validationResults.values()]
      .filter(result => workbenchTargetDecoderIds.includes(result.decoderId))
      .flatMap(result => Object.entries(result.partialBlockerCounts || {})
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([blocker, count]) => {
          const readinessText = sortedCountText(result.partialBlockerReadinessCounts?.[blocker] || {});
          const regionCount = (result.partialBlockerRegionIds?.[blocker] || []).filter(Boolean).length;
          return `<tr>
            <td><code>${esc(result.decoderId)}</code><br><span class="dim">${esc(result.decoderLabel || '')}</span></td>
            <td>${esc(blocker)}</td>
            <td>${esc(count)}</td>
            <td>${esc(readinessText || '')}</td>
            <td>${esc(regionCount)}</td>
            <td><button class="btn mini validation-blocker-focus" data-decoder-id="${esc(result.decoderId)}" data-blocker="${esc(blocker)}">SHOW REGIONS</button></td>
          </tr>`;
        }))
      .join('');
  }

  function renderValidationProofRows() {
    return [...validationResults.values()]
      .filter(result => workbenchTargetDecoderIds.includes(result.decoderId))
      .flatMap(result => Object.entries(result.reconstructionProofCounts || {})
        .filter(([bucket]) => !bucket.startsWith('ready:'))
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([bucket, count]) => {
          const splitAt = bucket.indexOf(':');
          const proofStatus = splitAt >= 0 ? bucket.slice(0, splitAt) : '';
          const proofKey = splitAt >= 0 ? bucket.slice(splitAt + 1) : bucket;
          const regionCount = (result.reconstructionProofRegionIds?.[bucket] || []).filter(Boolean).length;
          const targetText = sortedCountText(result.reconstructionProofTargetCounts?.[bucket] || {});
          const nextStep = result.reconstructionProofNextSteps?.[bucket] || '';
          const cls = proofStatus === 'warning' ? 'progress' : 'warn';
          return `<tr>
            <td><code>${esc(result.decoderId)}</code><br><span class="dim">${esc(result.decoderLabel || '')}</span></td>
            <td>${esc(result.reconstructionProofLabels?.[bucket] || proofKey)}<br><code>${esc(proofKey)}</code></td>
            <td>${pill(String(proofStatus || 'missing').toUpperCase(), cls)}</td>
            <td>${esc(count)}</td>
            <td>${esc(targetText || '')}</td>
            <td>${esc(nextStep)}</td>
            <td><button class="btn mini validation-proof-focus" data-decoder-id="${esc(result.decoderId)}" data-proof-bucket="${esc(bucket)}">SHOW REGIONS</button></td>
          </tr>`;
        }))
      .join('');
  }

  function renderValidationCoreProofRows() {
    return [...validationResults.values()]
      .filter(result => workbenchTargetDecoderIds.includes(result.decoderId))
      .flatMap(result => Object.entries(result.coreReconstructionProofCounts || {})
        .filter(([bucket]) => !bucket.startsWith('ready:'))
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([bucket, count]) => {
          const splitAt = bucket.indexOf(':');
          const proofStatus = splitAt >= 0 ? bucket.slice(0, splitAt) : '';
          const proofKey = splitAt >= 0 ? bucket.slice(splitAt + 1) : bucket;
          const regionCount = (result.coreReconstructionProofRegionIds?.[bucket] || []).filter(Boolean).length;
          const targetText = sortedCountText(result.coreReconstructionProofTargetCounts?.[bucket] || {});
          const nextStep = result.coreReconstructionProofNextSteps?.[bucket] || '';
          const cls = proofStatus === 'warning' ? 'progress' : 'warn';
          return `<tr>
            <td><code>${esc(result.decoderId)}</code><br><span class="dim">${esc(result.decoderLabel || '')}</span></td>
            <td>${esc(result.coreReconstructionProofLabels?.[bucket] || proofKey)}<br><code>${esc(proofKey)}</code></td>
            <td>${pill(String(proofStatus || 'missing').toUpperCase(), cls)}</td>
            <td>${esc(count)}</td>
            <td>${esc(regionCount)}</td>
            <td>${esc(targetText || '')}</td>
            <td>${esc(nextStep)}</td>
            <td><button class="btn mini validation-core-proof-focus" data-decoder-id="${esc(result.decoderId)}" data-proof-bucket="${esc(bucket)}">SHOW CORE REGIONS</button></td>
          </tr>`;
        }))
      .join('');
  }

  function renderValidationCompletionBoard(targetDecoders) {
    const validated = targetDecoders
      .map(decoder => validationResults.get(decoder.id))
      .filter(Boolean);
    const totalCoreRegions = validated.reduce((sum, result) => sum + Number(result.coreRegionCount || 0), 0);
    const totalCoreDecoded = validated.reduce((sum, result) => sum + Number(result.coreDecodedCount || 0), 0);
    const totalCoreBlockers = validated.reduce((sum, result) => sum + Number(result.corePartialCount || 0), 0);
    const totalExternal = validated.reduce((sum, result) => sum + Number(result.externalOwnedPartialCount || 0), 0);
    const corePercent = totalCoreRegions ? Math.round((totalCoreDecoded / totalCoreRegions) * 100) : 0;
    const liveCoreAverage = validated.length
      ? Math.round(validated.reduce((sum, result) => sum + Number(result.coreCompletionPercent || 0), 0) / validated.length)
      : 0;
    const registryAverage = targetDecoders.length
      ? Math.round(targetDecoders.reduce((sum, decoder) => sum + Number(decoder.implementationPercent || 0), 0) / targetDecoders.length)
      : 0;
    const rows = targetDecoders.map(decoder => {
      const result = validationResults.get(decoder.id);
      const queueButton = result?.coreBlockerRegionIds?.length
        ? `<button class="btn mini validation-core-focus" data-decoder-id="${esc(decoder.id)}">SHOW CORE BLOCKERS</button>`
        : '<span class="dim">No core blocker queue</span>';
      const topBlocker = result?.topCoreBlocker
        ? `${result.topCoreBlocker} (${result.topCoreBlockerCount})`
        : (result ? 'none' : 'not validated');
      const livePercent = result ? result.coreCompletionPercent : decoder.implementationPercent;
      return `<tr>
        <td><b>${esc(decoder.label)}</b><br><code>${esc(decoder.id)}</code></td>
        <td>${pctBar(decoder.implementationPercent)}<br><span class="dim">${esc(decoder.status || '')}</span></td>
        <td>${pctBar(livePercent)}<br><span class="dim">${result ? `${esc(result.coreDecodedCount || 0)}/${esc(result.coreRegionCount || 0)} core decoded` : 'Run validation for live core percent'}</span></td>
        <td>${result ? esc(result.corePartialCount || 0) : ''}</td>
        <td>${result ? esc(result.externalOwnedPartialCount || 0) : ''}</td>
        <td>${esc(topBlocker)}</td>
        <td>${queueButton}</td>
      </tr>`;
    }).join('');
    return `
      <div class="box-title" style="margin-top:10px">Decoder Completion Board</div>
      <div class="browser-counts compact">
        ${pill(validated.length ? `${corePercent}% CORE VALIDATED` : 'RUN VALIDATION', validated.length ? 'progress' : 'warn')}
        ${pill(`${registryAverage}% REGISTRY AVG`, 'progress')}
        ${pill(validated.length ? `${liveCoreAverage}% LIVE CORE AVG` : 'NO SESSION COUNTS', validated.length ? 'progress' : 'warn')}
        ${pill(`${totalCoreDecoded}/${totalCoreRegions || 0} CORE REGIONS`, totalCoreBlockers ? 'progress' : 'ok')}
        ${pill(`${totalCoreBlockers} CORE BLOCKERS`, totalCoreBlockers ? 'warn' : 'ok')}
        ${pill(`${totalExternal} EXTERNAL`, totalExternal ? 'progress' : '')}
      </div>
      <div class="table-wrap">
        <table class="asset-table">
          <thead><tr><th>Decoder</th><th>Registry %</th><th>Live Core %</th><th>Core Left</th><th>External</th><th>Top Core Blocker</th><th>Queue</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="7" class="dim">No target decoders found.</td></tr>'}</tbody>
        </table>
      </div>`;
  }

  function renderValidationWorkbench() {
    if (!$('validation-workbench') || !currentCoverage) return;
    const targetDecoders = workbenchTargetDecoderIds
      .map(decoderById)
      .filter(Boolean);
    const rows = targetDecoders.map(decoder => {
      const result = validationResults.get(decoder.id);
      const status = validationStatusLabel(result);
      return `<tr>
        <td><b>${esc(decoder.label)}</b><br><code>${esc(decoder.id)}</code></td>
        <td>${pctBar(decoder.implementationPercent)}<br><span class="dim">${esc(decoder.status)}</span></td>
        <td>${pill(status, validationClass(result))}<br><span class="dim">${esc(result?.summary || 'Not validated in this browser session.')}</span></td>
        <td>${esc(result ? sortedCountText(result.statusCounts) : '')}</td>
        <td>${result ? `${esc(result.coreDecodedCount || 0)}/${esc(result.coreRegionCount || 0)} core decoded<br><span class="dim">${esc(result.externalOwnedPartialCount || 0)} external</span>` : ''}</td>
        <td>${esc(result ? sortedCountText(result.readinessCounts) : '')}</td>
        <td>${esc(result ? sortedCountText(result.partialBlockerCounts) : '')}</td>
        <td>${esc(result ? sortedCountText(result.previewKindCounts) : '')}</td>
        <td>${esc(result ? sortedCountText(result.formatCounts) : '')}</td>
        <td>${esc(result?.warningCount ?? '')}</td>
        <td>${esc(result?.exceptionCount ?? '')}</td>
        <td><button class="btn mini workbench-validate-decoder" data-decoder-id="${esc(decoder.id)}">VALIDATE</button></td>
      </tr>`;
    }).join('');
    const sampleRows = [...validationResults.values()]
      .filter(result => workbenchTargetDecoderIds.includes(result.decoderId))
      .flatMap(result => (result.samples || []).map(sample => Object.assign({ decoderId: result.decoderId }, sample)))
      .slice(0, 16)
      .map(sample => `<tr>
        <td><code>${esc(sample.decoderId)}</code></td>
        <td><code>${esc(sample.regionId)}</code><br><span class="dim">${esc(sample.type)} · ${esc(sample.offset)}</span></td>
        <td>${esc(sample.status || '')}</td>
        <td>${esc(sample.readiness || '')}</td>
        <td>${esc(sample.partialBlocker || '')}</td>
        <td>${esc(sample.reconstructionProofs || '')}<br><span class="dim">${esc(sample.reconstructionTarget || '')}</span></td>
        <td>${esc(sample.previewKind || '')}</td>
        <td>${esc(sample.warningCount ?? '')}</td>
        <td>${esc(sample.summary || '')}</td>
      </tr>`).join('');
    const blockerRows = renderValidationBlockerRows();
    const coreProofRows = renderValidationCoreProofRows();
    const proofRows = renderValidationProofRows();
    $('validation-workbench').innerHTML = `
      <div class="browser-head">
        <div>
          <div class="browser-title">Asset Workbench Validation</div>
          <div class="browser-purpose">ROM-local decoder smoke checks for the current Asset Workbench targets. Results are session-only counts and metadata; no decoded asset bytes are persisted.</div>
        </div>
        <div class="browser-counts">
          ${pill(`${targetDecoders.length} TARGET DECODERS`, 'progress')}
          ${pill(currentRom ? 'ROM LOADED' : 'ROM REQUIRED', currentRom ? 'ok' : 'warn')}
        </div>
      </div>
      <div class="decoder-toolbar">
        <button class="btn primary" id="btn-validate-workbench-targets">VALIDATE TARGET DECODERS</button>
        <button class="btn" id="btn-workbench-labels">SHOW TARGET LABELS</button>
        <input class="label-queue-search" id="workbench-target-search" type="search" placeholder="filter target decoder labels / offsets / notes">
      </div>
      ${renderValidationCompletionBoard(targetDecoders)}
      <div class="table-wrap">
        <table class="asset-table">
          <thead><tr><th>Decoder</th><th>Registry</th><th>Validation</th><th>Status Counts</th><th>Core Scope</th><th>Readiness</th><th>Partial Blockers</th><th>Preview Kinds</th><th>Formats</th><th>Warnings</th><th>Exceptions</th><th>Run</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="12" class="dim">No target decoders found.</td></tr>'}</tbody>
        </table>
      </div>
      <div class="box-title" style="margin-top:10px">Partial Blocker Drilldown</div>
      <div class="table-wrap">
        <table class="asset-table">
          <thead><tr><th>Decoder</th><th>Blocker</th><th>Count</th><th>Readiness</th><th>Regions</th><th>Queue</th></tr></thead>
          <tbody>${blockerRows || '<tr><td colspan="6" class="dim">Run target validation to build blocker-specific region queues.</td></tr>'}</tbody>
        </table>
      </div>
      <div class="box-title" style="margin-top:10px">Core Proof Queue</div>
      <div class="table-wrap">
        <table class="asset-table">
          <thead><tr><th>Decoder</th><th>Proof</th><th>Status</th><th>Count</th><th>Regions</th><th>Targets</th><th>Next Step</th><th>Queue</th></tr></thead>
          <tbody>${coreProofRows || '<tr><td colspan="8" class="dim">Run target validation to build proof queues for core blockers only.</td></tr>'}</tbody>
        </table>
      </div>
      <div class="box-title" style="margin-top:10px">Reconstruction Proof Drilldown</div>
      <div class="table-wrap">
        <table class="asset-table">
          <thead><tr><th>Decoder</th><th>Proof</th><th>Status</th><th>Count</th><th>Targets</th><th>Next Step</th><th>Queue</th></tr></thead>
          <tbody>${proofRows || '<tr><td colspan="7" class="dim">Run target validation to build proof-specific region queues.</td></tr>'}</tbody>
        </table>
      </div>
      <div class="box-title" style="margin-top:10px">Validation Attention Samples</div>
      <div class="table-wrap">
        <table class="asset-table">
          <thead><tr><th>Decoder</th><th>Region</th><th>Status</th><th>Readiness</th><th>Blocker</th><th>Proofs</th><th>Preview</th><th>Warnings</th><th>Summary</th></tr></thead>
          <tbody>${sampleRows || '<tr><td colspan="9" class="dim">No partials, warnings or exceptions captured for validated target decoders.</td></tr>'}</tbody>
        </table>
      </div>`;
  }

  function labelStateText(state) {
    if (state === 'needs_type') return 'NEEDS TYPE';
    if (state === 'needs_label') return 'NEEDS LABEL';
    if (state === 'needs_name') return 'NEEDS NAME';
    if (state === 'needs_notes') return 'NEEDS NOTES';
    if (state === 'semantic_label') return 'LABELED';
    return String(state || 'UNKNOWN').toUpperCase();
  }

  function labelStateClass(state) {
    if (state === 'semantic_label') return 'ok';
    if (state === 'needs_type' || state === 'needs_label') return 'warn';
    return 'progress';
  }

  function labelQueueSearchText(item) {
    return [
      item.decoderId,
      item.decoderLabel,
      item.familyId,
      item.regionId,
      item.regionType,
      item.offset,
      item.name,
      item.confidence,
      item.labelState,
      item.notes,
      ...(item.tags || []),
    ].join(' ').toLowerCase();
  }

  function labelQueueMatchesFilters(item) {
    if (labelQueueFilters.targetOnly && !workbenchTargetDecoderIds.includes(item.decoderId)) return false;
    if (labelQueueFilters.regionIds?.length && !labelQueueFilters.regionIds.includes(item.regionId)) return false;
    if (labelQueueFilters.family && item.familyId !== labelQueueFilters.family) return false;
    if (labelQueueFilters.decoder && item.decoderId !== labelQueueFilters.decoder) return false;
    if (labelQueueFilters.labelState === 'needs_any' && !item.needsLabel) return false;
    if (labelQueueFilters.labelState && labelQueueFilters.labelState !== 'needs_any' && item.labelState !== labelQueueFilters.labelState) return false;
    if (labelQueueFilters.capability && !(item.previewCapabilities || []).includes(labelQueueFilters.capability)) return false;
    if (labelQueueFilters.tag && !(item.tags || []).includes(labelQueueFilters.tag)) return false;
    if (labelQueueFilters.query && !labelQueueSearchText(item).includes(labelQueueFilters.query)) return false;
    return true;
  }

  function labelQueueDebugAction(item) {
    const type = item?.regionType || '';
    if (type === 'code') return 'exec';
    if (/table|data|map|stream|script|palette|loader|screen_prog|tile|entity|room|item|pointer/i.test(type)) return 'read';
    return 'watch';
  }

  function labelQueueProbeItems(visible) {
    const seen = new Set();
    return (visible || [])
      .filter(item => {
        if (!item?.regionId || seen.has(item.regionId)) return false;
        seen.add(item.regionId);
        return true;
      })
      .map(item => {
        const start = uiParseOffset(item.offset);
        const size = Number(item.size || 0);
        const end = Number.isFinite(start) && size > 0 ? start + size - 1 : null;
        return Object.assign({}, item, {
          start,
          end,
          bank: Number.isFinite(start) ? uiBankOfOffset(start) : null,
          logical: Number.isFinite(start) ? uiLogicalAddress(start) : null,
          action: labelQueueDebugAction(item),
        });
      });
  }

  function debugProbeLine(probe) {
    const absRange = Number.isFinite(probe.start)
      ? `${uiHex(probe.start, 5)}-${uiHex(probe.end ?? probe.start, 5)}`
      : String(probe.offset || '?');
    const bankText = probe.bank === null ? '??' : probe.bank.toString(16).toUpperCase().padStart(2, '0');
    const logicalText = probe.logical === null ? '????' : uiHex(probe.logical, 4);
    const name = String(probe.name || probe.regionId || '').replace(/\s+/g, ' ').trim();
    return `${probe.regionId} action ${probe.action} abs ${absRange} bank ${bankText} logical ${logicalText} type ${probe.regionType || 'unknown'} decoder ${probe.decoderId || ''} label ${name}`;
  }

  function renderDebugProbeBatch(action, probes) {
    if (!probes.length) return '';
    const lines = probes.map(debugProbeLine);
    const shown = lines.slice(0, 180).join('\n');
    const more = lines.length > 180 ? `\n# ${lines.length - 180} more probe line(s) hidden by UI preview limit; narrow the queue filters for smaller batches.` : '';
    const title = action.toUpperCase();
    return `<div class="debug-probe-card">
      <div class="debug-probe-title">${esc(title)} batch · ${esc(probes.length)} region(s)</div>
      <textarea class="debug-probe-plan" readonly rows="7">${esc(`# ${labelQueueFilters.regionListLabel || 'filtered region queue'}\n# ${title} probes. Metadata only: region ids, offsets, banks, logical addresses, types and labels.\n${shown}${more}`)}</textarea>
    </div>`;
  }

  function renderDebugProbePlan(visible) {
    if (!labelQueueFilters.regionIds?.length) return '';
    const probes = labelQueueProbeItems(visible);
    const actionCounts = {};
    for (const probe of probes) actionCounts[probe.action] = (actionCounts[probe.action] || 0) + 1;
    const targetRows = probes.slice(0, 10).map(probe => {
      const absRange = Number.isFinite(probe.start)
        ? `${uiHex(probe.start, 5)}-${uiHex(probe.end ?? probe.start, 5)}`
        : String(probe.offset || '?');
      const bankText = probe.bank === null ? '??' : probe.bank.toString(16).toUpperCase().padStart(2, '0');
      const logicalText = probe.logical === null ? '????' : uiHex(probe.logical, 4);
      return `<tr>
        <td><code>${esc(probe.regionId)}</code><br>${pill(String(probe.action || 'watch').toUpperCase(), probe.action === 'exec' ? 'warn' : 'progress')}</td>
        <td><code>${esc(absRange)}</code><br><span class="dim">bank ${esc(bankText)} · logical ${esc(logicalText)}</span></td>
        <td>${esc(probe.regionType || 'unknown')}</td>
        <td>${esc(probe.name || probe.regionId || '')}</td>
      </tr>`;
    }).join('');
    const batches = ['exec', 'read', 'watch']
      .map(action => renderDebugProbeBatch(action, probes.filter(probe => probe.action === action)))
      .join('');
    return `
      <div class="box-title" style="margin-top:10px">Debugger Probe Plan</div>
      <div class="browser-counts compact">
        ${pill(`${probes.length} UNIQUE REGIONS`, probes.length ? 'progress' : 'warn')}
        ${pill(`${actionCounts.exec || 0} EXEC`, actionCounts.exec ? 'warn' : '')}
        ${pill(`${actionCounts.read || 0} READ`, actionCounts.read ? 'progress' : '')}
        ${pill(`${actionCounts.watch || 0} WATCH`, actionCounts.watch ? 'progress' : '')}
      </div>
      <div class="table-wrap">
        <table class="asset-table">
          <thead><tr><th>Probe</th><th>Address</th><th>Type</th><th>Current Label</th></tr></thead>
          <tbody>${targetRows || '<tr><td colspan="4" class="dim">No probe targets in the active queue.</td></tr>'}</tbody>
        </table>
      </div>
      <div class="debug-probe-grid">${batches || '<div class="line dim">No probe batches in the active queue.</div>'}</div>`;
  }

  function renderLabelQueue() {
    if (!currentCoverage) return;
    const queue = currentCoverage.labelQueue || [];
    const states = [...new Set(queue.map(item => item.labelState))].sort();
    const capabilities = [...new Set(queue.flatMap(item => item.previewCapabilities || []))].sort();
    const tags = [...new Set(queue.flatMap(item => item.tags || []))].sort();
    const visible = queue.filter(labelQueueMatchesFilters);
    const regionListActive = Boolean(labelQueueFilters.regionIds?.length);
    const rows = visible.slice(0, 220).map(item => {
      const decoder = decoderById(item.decoderId);
      const family = familyById(item.familyId);
      const previewCls = (item.previewCapabilities || []).includes('audio') ? 'progress' : (item.previewCapabilities || []).includes('visual') ? 'ok' : '';
      const tagText = (item.tags || []).slice(0, 6).join(' ');
      return `<tr>
        <td><code>${esc(item.regionId)}</code><br><span class="dim">${esc(item.regionType)} · ${esc(item.offset)} · ${esc(item.size)}b</span></td>
        <td><b>${esc(item.name || item.regionId)}</b><br><span class="dim">${esc(item.notes || '')}</span><br><span class="dim">${esc(tagText)}</span></td>
        <td>${pill(labelStateText(item.labelState), labelStateClass(item.labelState))}<br><span class="dim">${esc(item.confidence || '')}</span></td>
        <td><b>${esc(decoder?.label || item.decoderLabel)}</b><br><span class="dim">${esc(family?.label || item.familyId)}</span></td>
        <td>${pctBar(item.implementationPercent)}<br>${renderCapabilityPills(decoder)}</td>
        <td><button class="btn mini asset-preview" data-asset-id="region:${esc(item.regionId)}" data-decoder-id="${esc(item.decoderId)}">${esc(previewText(decoder))}</button><br>${pill(previewText(decoder), previewCls)}</td>
      </tr>`;
    }).join('');
    const more = visible.length > 220
      ? `<div class="line dim">Showing first 220 of ${visible.length}. Use filters or search to narrow the labeling queue.</div>`
      : '';
    const debugProbePlan = renderDebugProbePlan(visible);
    $('label-queue').innerHTML = `
      <div class="browser-head">
        <div>
          <div class="browser-title">Region Label Queue</div>
          <div class="browser-purpose">This is the real ROM work queue behind the curated assets: every mapped region currently matched by a decoder, sorted so generic labels and missing notes are first.</div>
        </div>
        <div class="browser-counts">
          ${pill(`${currentCoverage.summary.labelQueueUniqueRegionCount} UNIQUE REGIONS`, 'ok')}
          ${pill(`${currentCoverage.summary.labelQueueNeedsLabelUniqueRegionCount} NEED LABELS`, 'warn')}
          ${pill(`${currentCoverage.summary.labelQueueVisualEntryCount} VISUAL`, 'ok')}
          ${pill(`${currentCoverage.summary.labelQueueAudioEntryCount} AUDIO`, 'progress')}
          ${pill(`${visible.length}/${queue.length} SHOWN`)}
        </div>
      </div>
      <div class="decoder-toolbar">
        <select class="label-queue-control" data-filter="family">
          <option value="">ALL FAMILIES</option>
          ${currentCoverage.families.map(family => `<option value="${esc(family.id)}"${selectedAttr(family.id, labelQueueFilters.family)}>${esc(family.label)} · ${esc(family.needsLabelCount || 0)} need labels</option>`).join('')}
        </select>
        <select class="label-queue-control" data-filter="decoder">
          <option value="">ALL DECODERS</option>
          ${currentCoverage.decoders.map(decoder => `<option value="${esc(decoder.id)}"${selectedAttr(decoder.id, labelQueueFilters.decoder)}>${esc(decoder.label)} · ${esc(decoder.needsLabelCount || 0)} need labels</option>`).join('')}
        </select>
        <select class="label-queue-control" data-filter="labelState">
          <option value="">ALL LABEL STATES</option>
          <option value="needs_any"${selectedAttr('needs_any', labelQueueFilters.labelState)}>NEEDS ANY LABEL WORK</option>
          ${states.map(state => `<option value="${esc(state)}"${selectedAttr(state, labelQueueFilters.labelState)}>${esc(labelStateText(state))}</option>`).join('')}
        </select>
        <select class="label-queue-control" data-filter="capability">
          <option value="">ALL PREVIEWS</option>
          ${capabilities.map(capability => `<option value="${esc(capability)}"${selectedAttr(capability, labelQueueFilters.capability)}>${esc(capability.toUpperCase())}</option>`).join('')}
        </select>
        <select class="label-queue-control" data-filter="tag">
          <option value="">ALL TAGS</option>
          ${tags.map(tag => `<option value="${esc(tag)}"${selectedAttr(tag, labelQueueFilters.tag)}>${esc(tag)}</option>`).join('')}
        </select>
        <input class="label-queue-search" id="label-queue-search" type="search" placeholder="filter regions / decoder / offset / notes" value="${esc(labelQueueFilters.query)}">
        ${labelQueueFilters.targetOnly ? '<button class="btn mini label-queue-clear-targets">CLEAR TARGETS</button>' : ''}
        ${regionListActive ? '<button class="btn mini label-queue-clear-region-list">CLEAR REGION LIST</button>' : ''}
      </div>
      ${regionListActive ? `<div class="line compact">Region list: <code>${esc(labelQueueFilters.regionListLabel || 'validation drilldown')}</code> · ${esc(labelQueueFilters.regionIds.length)} region(s)</div>` : ''}
      ${debugProbePlan}
      <div class="table-wrap">
        <table class="asset-table">
          <thead><tr><th>Region</th><th>Current Label</th><th>Label State</th><th>Decoder</th><th>Done / Preview</th><th>Open</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="6" class="dim">No regions match the active label queue filters.</td></tr>'}</tbody>
        </table>
      </div>
      ${more}`;
  }

  function assetMatchesFilters(asset, browser) {
    const kind = $('kind-filter').value;
    const source = $('source-filter').value;
    const decoderId = $('decoder-filter').value;
    const query = $('browser-search').value.trim().toLowerCase();
    if (kind && asset.kind !== kind) return false;
    if (source && (asset.source || (asset.derived ? 'derived' : 'curated')) !== source) return false;
    if (decoderId && !assetMatchesDecoder(asset, decoderId)) return false;
    if (browser && !wb3AssetMatchesBrowser(asset, browser, currentMap)) return false;
    if (query && !assetSearchText(asset).includes(query)) return false;
    return true;
  }

  function renderAssetRow(asset, browserId) {
    const region = regionForAsset(asset);
    const activeDecoderId = $('decoder-filter')?.value || '';
    const decoder = wb3PreferredDecoderForAsset(asset, region, activeDecoderId) || wb3PreferredDecoderForAsset(asset, region);
    const offset = region ? `${region.offset || '?'} · ${region.size || 0}b` : 'metadata';
    const decoderLine = decoder
      ? `${decoder.label} · ${decoder.implementationPercent}%`
      : 'No decoder';
    const previewCls = decoder?.previewCapabilities?.includes('audio') ? 'progress' : decoder?.previewCapabilities?.includes('visual') ? 'ok' : '';
    return `<tr>
      <td><b>${esc(asset.name || asset.id)}</b><br><code>${esc(asset.id)}</code></td>
      <td>${esc(asset.kind)}<br><span class="dim">${esc(asset.status || '')} · ${esc(asset.confidence || '')}</span></td>
      <td>${region ? `<code>${esc(region.id)}</code> ${esc(region.type || '')}<br><span class="dim">${esc(offset)}</span>` : '<span class="dim">No ROM region</span>'}</td>
      <td>${decoder ? pctBar(decoder.implementationPercent) : pill('0%', 'warn')}<br><span class="dim">${esc(decoderLine)}</span></td>
      <td><button class="btn mini asset-preview" data-asset-id="${esc(asset.id)}" data-browser-id="${esc(browserId || '')}" data-decoder-id="${esc(decoder?.id || '')}">${esc(previewText(decoder))}</button><br>${pill(decoder ? decoder.status.toUpperCase() : 'NO DECODER', decoderClass(decoder))} ${pill(previewText(decoder), previewCls)}</td>
    </tr>`;
  }

  function renderBrowser(browser) {
    const family = currentCoverage.families.find(item => item.id === browser.id);
    const filtered = currentAssets.filter(asset => assetMatchesFilters(asset, browser));
    const rows = filtered.slice(0, 140).map(asset => renderAssetRow(asset, browser.id)).join('');
    const more = filtered.length > 140
      ? `<div class="line dim">Showing first 140 of ${filtered.length}. Use search or asset kind filters to narrow this browser.</div>`
      : '';
    const blockers = (family?.blockers || []).slice(0, 4).map(text => `<div class="line">${esc(text)}</div>`).join('');
    return `<section class="browser">
      <div class="browser-head">
        <div>
          <div class="browser-title">${esc(browser.label)}</div>
          <div class="browser-purpose">${esc(browser.purpose || '')}</div>
        </div>
        <div class="browser-counts">
          ${pill(`${family?.completionPercent ?? 0}% DONE`, 'progress')}
          ${pill(`${filtered.length} ASSETS`, 'ok')}
          ${pill(`${family?.needsLabelCount ?? 0} NEED LABELS`, (family?.needsLabelCount || 0) ? 'warn' : 'ok')}
          ${pill(`${family?.decoderCount ?? 0} DECODERS`)}
          ${family?.audioPreviewCount ? pill(`${family.audioPreviewCount} AUDIO`, 'progress') : ''}
        </div>
      </div>
      <div class="browser-grid">
        <div class="box">
          <div class="box-title">Readiness</div>
          ${pctBar(family?.completionPercent || 0)}
          <div class="line">Preview status: ${esc(browser.previewStatus || '')}</div>
          <div class="line">Region types: <span class="dim">${esc((browser.regionTypes || []).join(', ') || 'none')}</span></div>
          <div class="box-title" style="margin-top:12px">Main blockers</div>
          ${blockers || '<div class="line dim">No blocker registered for this family.</div>'}
        </div>
        <div class="box">
          <div class="box-title">Assets</div>
          <div class="table-wrap">
            <table class="asset-table">
              <thead><tr><th>Asset</th><th>Kind</th><th>Region</th><th>Decoder</th><th>Preview</th></tr></thead>
              <tbody>${rows || '<tr><td colspan="5" class="dim">No assets match the active filters.</td></tr>'}</tbody>
            </table>
          </div>
          ${more}
        </div>
      </div>
    </section>`;
  }

  function applyFilters() {
    if (!currentMap) return;
    const browserId = $('browser-filter').value;
    const browsers = (currentMap.assetDataBrowsers?.browsers || [])
      .filter(browser => !browserId || browser.id === browserId);
    $('browser-list').className = 'browser-list';
    $('browser-list').innerHTML = browsers.map(renderBrowser).join('');
  }

  function readRomFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const data = new Uint8Array(reader.result);
      currentRom = data;
      currentRomName = file.name;
      $('rom-status').textContent = `${file.name} · ${data.length} bytes · previews enabled`;
      renderStats();
      renderVisualWorkbench();
      renderValidationWorkbench();
      $('preview-body').innerHTML = '<div class="line">ROM loaded. Select any asset preview button.</div>';
    };
    reader.readAsArrayBuffer(file);
  }

  function drawTileGrid(canvas, rom, offset, tileCount, colors) {
    const count = Math.max(0, Math.min(tileCount, 96));
    const cols = 16;
    const zoom = 3;
    const rows = Math.max(1, Math.ceil(count / cols));
    canvas.width = cols * 8 * zoom;
    canvas.height = rows * 8 * zoom;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#050508';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const img = ctx.createImageData(canvas.width, canvas.height);
    const pxd = img.data;
    for (let t = 0; t < count; t++) {
      if (offset + t * 32 + 31 >= rom.length) break;
      const pixels = decodeTile(rom, offset + t * 32);
      const bx = (t % cols) * 8 * zoom;
      const by = Math.floor(t / cols) * 8 * zoom;
      for (let py = 0; py < 8; py++) for (let px = 0; px < 8; px++) {
        const ci = pixels[py * 8 + px];
        const hex = colors[ci] || TILE_PREVIEW_COLORS[ci] || '#000000';
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        for (let zy = 0; zy < zoom; zy++) for (let zx = 0; zx < zoom; zx++) {
          const idx = ((by + py * zoom + zy) * canvas.width + (bx + px * zoom + zx)) * 4;
          pxd[idx] = r; pxd[idx + 1] = g; pxd[idx + 2] = b; pxd[idx + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function drawStatusTileUploadStrip(canvas, rom, ranges) {
    const items = (ranges || []).filter(item => Number.isFinite(Number(item.sourceOffset)) && Number(item.tileCount || 0) > 0).slice(0, 16);
    const tileCols = Math.max(2, items.reduce((max, item) => Math.max(max, Number(item.tileCount || 0)), 2));
    const zoom = 3;
    const rowGap = 2 * zoom;
    const labelWidth = 0;
    canvas.width = labelWidth + tileCols * 8 * zoom;
    canvas.height = Math.max(1, items.length) * 8 * zoom + Math.max(0, items.length - 1) * rowGap;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#050508';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const img = ctx.createImageData(canvas.width, canvas.height);
    const pxd = img.data;
    items.forEach((item, row) => {
      for (let t = 0; t < Number(item.tileCount || 0); t++) {
        const tileOffset = Number(item.sourceOffset) + t * 32;
        if (!rom || tileOffset + 31 >= rom.length) continue;
        const pixels = decodeTile(rom, tileOffset);
        const bx = labelWidth + t * 8 * zoom;
        const by = row * (8 * zoom + rowGap);
        for (let py = 0; py < 8; py++) for (let px = 0; px < 8; px++) {
          const ci = pixels[py * 8 + px];
          const hex = TILE_PREVIEW_COLORS[ci] || '#000000';
          const r = parseInt(hex.slice(1, 3), 16);
          const g = parseInt(hex.slice(3, 5), 16);
          const b = parseInt(hex.slice(5, 7), 16);
          for (let zy = 0; zy < zoom; zy++) for (let zx = 0; zx < zoom; zx++) {
            const idx = ((by + py * zoom + zy) * canvas.width + (bx + px * zoom + zx)) * 4;
            pxd[idx] = r; pxd[idx + 1] = g; pxd[idx + 2] = b; pxd[idx + 3] = 255;
          }
        }
      }
    });
    ctx.putImageData(img, 0, 0);
  }

  function drawTimedEffectTimeline(canvas, records) {
    const rows = (records || []).slice(0, 160);
    const frameCount = Math.max(1, rows.reduce((max, row) => Math.max(max, Number(row.frameEnd || 0)), 0));
    const width = Math.max(560, Math.min(1400, frameCount * 4));
    const height = 72;
    const pad = 18;
    const laneTop = 28;
    const laneHeight = 22;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#050508';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#292947';
    ctx.strokeRect(pad, laneTop, width - pad * 2, laneHeight);
    for (let f = 0; f <= frameCount; f += 16) {
      const x = pad + (f / frameCount) * (width - pad * 2);
      ctx.strokeStyle = f % 64 === 0 ? '#4a4a75' : '#24243d';
      ctx.beginPath();
      ctx.moveTo(x, laneTop - 8);
      ctx.lineTo(x, laneTop + laneHeight + 8);
      ctx.stroke();
    }
    rows.forEach(record => {
      const start = Number(record.frameStart || 0);
      const end = Math.max(start + 1, Number(record.frameEnd || start + 1));
      const x = pad + (start / frameCount) * (width - pad * 2);
      const w = Math.max(1, ((end - start) / frameCount) * (width - pad * 2));
      const hue = ((Number(record.cf95 || 0) >> 4) * 70 + Number(record.d279 || 0) * 17) % 360;
      ctx.fillStyle = `hsl(${hue}, 70%, 52%)`;
      ctx.fillRect(x, laneTop + 3, w, laneHeight - 6);
      if (record.terminatesAfterRecord) {
        ctx.fillStyle = '#ff5577';
        ctx.fillRect(x + w - 2, laneTop - 6, 3, laneHeight + 12);
      }
    });
    ctx.fillStyle = '#70709a';
    ctx.font = '11px Courier New, monospace';
    ctx.fillText(`0`, pad, 16);
    ctx.fillText(`${frameCount} frames`, Math.max(pad, width - pad - 90), 16);
  }

  function drawScreenProgHeatmap(canvas, cells, cols, rows) {
    const zoom = 4;
    canvas.width = cols * 8 * zoom;
    canvas.height = rows * 8 * zoom;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#050508';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < cols * rows; i++) {
      const cell = cells[i];
      if (!cell || !cell.writes) continue;
      const tile = cell.tileIdx | ((cell.attr & 1) << 8);
      const x = (i % cols) * 8 * zoom;
      const y = Math.floor(i / cols) * 8 * zoom;
      ctx.fillStyle = `hsl(${(tile * 37) % 360}, 62%, ${cell.attr & 8 ? 62 : 42}%)`;
      ctx.fillRect(x, y, 8 * zoom, 8 * zoom);
    }
  }

  function renderScreenProgPreview(preview, result) {
    const stats = preview.stats || {};
    const bbox = stats.bbox
      ? `${stats.bbox.minCol},${stats.bbox.minRow} to ${stats.bbox.maxCol},${stats.bbox.maxRow}`
      : 'none';
    const opRows = Object.entries(preview.opCounts || {}).sort((a, b) => a[0].localeCompare(b[0])).map(([kind, count]) => `<tr>
      <td>${esc(kind)}</td>
      <td>${esc(count)}</td>
    </tr>`).join('');
    const reach = preview.reachability || null;
    const rootRows = (reach?.rootSources || []).map(source => `<tr>
      <td>${esc(source.kind)}</td>
      <td><code>${esc(source.callerLabel || '')}</code></td>
      <td><code>${esc(source.sourceLabel || '')}</code></td>
      <td>${source.sourceLine ?? ''}</td>
      <td>${source.callLine ?? ''}</td>
    </tr>`).join('');
    const continuationRows = (reach?.continuationSources || []).map(source => `<tr>
      <td><code>${esc(source.rootRegion?.id || '')}</code></td>
      <td>${esc(source.rootRegion?.offset || '')}</td>
      <td><code>${esc(source.rootCatalogEntryId || '')}</code></td>
      <td>${esc(source.visitedRange?.start || '')}-${esc(source.visitedRange?.endInclusive || '')}</td>
    </tr>`).join('');
    const tableRows = (preview.tableRefs || []).map(ref => `<tr>
      <td>${esc(ref.index)}</td>
      <td><code>${esc(ref.pointerOffset)}</code></td>
      <td><code>${esc(ref.pointer)}</code></td>
      <td><code>${esc(ref.tableRegion?.id || '')}</code></td>
      <td>${esc(ref.screenProgSummary?.writtenCells ?? '')}</td>
      <td>${esc(ref.confidence || '')}</td>
    </tr>`).join('');
    const proof = preview.embeddedProof || null;
    const proofHtml = proof ? `<div class="subhead">Embedded Continuation Proof</div>
      <div class="line">Status ${esc(proof.status)} · role ${esc(proof.role)} · roots ${(proof.rootRegionIds || []).map(id => `<code>${esc(id)}</code>`).join(' ') || '<span class="dim">none</span>'}</div>` : '';
    const catalog = preview.catalogEntry || null;
    return `<canvas class="preview-canvas" id="asset-preview-canvas"></canvas>
      <div class="line dim">Structural name-table heatmap. Pixel-perfect render uses a scene recipe with VRAM/CRAM state.</div>
      <div class="stats-grid">
        ${stat('Cells', stats.writtenCells ?? result.metrics?.writtenCells ?? 0)}
        ${stat('Ops', result.metrics?.traceOps ?? 0)}
        ${stat('Unique Tiles', stats.uniqueTiles ?? result.metrics?.uniqueTiles ?? 0)}
        ${stat('BG / SPR Writes', `${stats.bgWrites ?? result.metrics?.bgWrites ?? 0} / ${stats.sprWrites ?? result.metrics?.sprWrites ?? 0}`)}
        ${stat('Reachability', reach?.reachability || result.metrics?.reachability || 'unknown')}
        ${stat('BBox', bbox)}
      </div>
      <div class="line">End: ${esc(preview.endReason || result.metrics?.endReason || '')}</div>
      <div class="line">Visited ${esc(preview.visitedRange?.start || '')}-${esc(preview.visitedRange?.endInclusive || '')} · ${esc(preview.visitedRange?.visitedBytes ?? 0)} byte(s) · outside region ${esc(preview.visitedRange?.outsideRegionBytes ?? 0)}</div>
      ${catalog ? `<div class="line">Catalog <code>${esc(catalog.id)}</code> · confidence ${esc(catalog.confidence || '')}</div>` : ''}
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Opcode</th><th>Count</th></tr></thead>
        <tbody>${opRows || '<tr><td colspan="2" class="dim">No opcode counts.</td></tr>'}</tbody>
      </table></div>
      <div class="subhead">Reachability</div>
      <div class="line">Catalog ${reach ? `<code>${esc(reach.catalogId)}</code>` : '<span class="dim">none</span>'} · confidence ${esc(reach?.confidence || '')}</div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Kind</th><th>Caller</th><th>Source</th><th>Source Line</th><th>Call Line</th></tr></thead>
        <tbody>${rootRows || '<tr><td colspan="5" class="dim">No direct root source for this label.</td></tr>'}</tbody>
      </table></div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Root Region</th><th>Root Offset</th><th>Root Catalog Entry</th><th>Visited Range</th></tr></thead>
        <tbody>${continuationRows || '<tr><td colspan="4" class="dim">No continuation parent recorded.</td></tr>'}</tbody>
      </table></div>
      ${proofHtml}
      <div class="subhead">Table References</div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Index</th><th>Entry ROM</th><th>Pointer</th><th>Table Region</th><th>Cells</th><th>Confidence</th></tr></thead>
        <tbody>${tableRows || '<tr><td colspan="6" class="dim">No screen_prog_table entry targets this region.</td></tr>'}</tbody>
      </table></div>`;
  }

  function renderScreenProgTablePreview(preview, result) {
    const table = preview.table || {};
    const entryRows = (preview.entries || []).map(entry => `<tr>
      <td>${esc(entry.index)}</td>
      <td><code>${esc(entry.entryOffsetHex)}</code></td>
      <td><code>${esc(entry.z80PointerHex)}</code></td>
      <td>${entry.romTargetHex ? `<code>${esc(entry.romTargetHex)}</code>` : '<span class="dim">invalid</span>'}</td>
      <td>${entry.targetRegion ? `<code>${esc(entry.targetRegion.id)}</code> ${esc(entry.targetRegion.name || entry.targetRegion.type || '')}` : '<span class="dim">none</span>'}</td>
      <td>${entry.screenProgSummary ? `${esc(entry.screenProgSummary.writtenCells)} cells, ${esc(entry.screenProgSummary.ops)} ops` : '<span class="dim">none</span>'}</td>
      <td>${esc(entry.catalogConfidence || '')}</td>
    </tr>`).join('');
    const writeRows = (preview.indexWrites || []).map(write => `<tr>
      <td><code>${esc(write.callerLabel || '')}</code></td>
      <td>${esc(write.callerOffset || '')}</td>
      <td>${esc(write.directIndex ?? '')}</td>
      <td>${esc(write.sourceMode || '')}</td>
      <td>${esc(write.evidence || '')}</td>
    </tr>`).join('');
    const evidenceRows = (preview.evidence || []).map(item => `<tr><td>${esc(item)}</td></tr>`).join('');
    return `<div class="stats-grid">
        ${stat('Entries', preview.entryCount ?? result.metrics?.entries ?? 0)}
        ${stat('Valid Targets', preview.validTargets ?? result.metrics?.validTargets ?? 0)}
        ${stat('Screen Prog Targets', preview.screenProgTargets ?? result.metrics?.screenProgTargets ?? 0)}
        ${stat('Decode Summaries', preview.targetsWithDecodeSummary ?? result.metrics?.targetsWithDecodeSummary ?? 0)}
      </div>
      <div class="line">Table <code>${esc(table.label || '')}</code> at ${esc(table.offset || '')} · index ${esc(table.indexRam || '')} · decoder ${esc(table.decoder || '')}</div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>#</th><th>Entry ROM</th><th>Z80 Ptr</th><th>ROM Target</th><th>Target Region</th><th>Decode Summary</th><th>Confidence</th></tr></thead>
        <tbody>${entryRows || '<tr><td colspan="7" class="dim">No entries.</td></tr>'}</tbody>
      </table></div>
      <div class="subhead">Index Writes</div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Caller</th><th>Caller ROM</th><th>Index</th><th>Source</th><th>Evidence</th></tr></thead>
        <tbody>${writeRows || '<tr><td colspan="5" class="dim">No direct index writes recorded.</td></tr>'}</tbody>
      </table></div>
      <div class="subhead">Evidence</div>
      <div class="table-wrap"><table class="asset-table">
        <tbody>${evidenceRows || '<tr><td class="dim">No evidence rows.</td></tr>'}</tbody>
      </table></div>`;
  }

  function renderAnalysisEntriesTable(entries, emptyText) {
    const rows = (entries || []).map(item => `<tr>
      <td><code>${esc(item.key || '')}</code></td>
      <td>${esc(item.role || '')}</td>
      <td>${esc(item.kind || '')}</td>
      <td>${esc(item.confidence || '')}</td>
      <td>${esc(item.summary || '')}</td>
    </tr>`).join('');
    return `<div class="table-wrap"><table class="asset-table">
      <thead><tr><th>Key</th><th>Role</th><th>Kind</th><th>Confidence</th><th>Summary</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5" class="dim">${esc(emptyText || 'No analysis entries.')}</td></tr>`}</tbody>
    </table></div>`;
  }

  function renderTileCanvasPreview(preview, result) {
    const metrics = result.metrics || {};
    const shape = preview.shapeStats || {};
    const metadata = preview.metadata || {};
    const coverage = metadata.coverageEntry || {};
    const combined = metadata.combinedEntry || {};
    const layout = metadata.layout || null;
    const unreferencedShape = metadata.unreferencedShape || null;
    const counts = metadata.counts || {};
    const sourceFamilies = combined.combinedSourceFamilies || layout?.combinedSourceFamilies || [];
    const rangeText = range => {
      if (!range) return '';
      const end = range.endExclusive || range.endInclusive || '';
      return `${range.start || ''}${end ? `-${end}` : ''}`;
    };
    const contributorRows = (combined.familyContributors || []).map(item => `<tr>
      <td>${esc(item.family || '')}</td>
      <td><code>${esc(item.catalogId || '')}</code></td>
      <td>${esc(item.rangeCount ?? '')}</td>
      <td>${esc(item.uniqueTiles ?? '')}</td>
      <td>${esc(item.duplicateBytes ?? '')}</td>
    </tr>`).join('');
    const sceneRows = (metadata.sceneRecipeUsages || []).map(item => `<tr>
      <td><code>${esc(item.catalogId || '')}</code></td>
      <td>${esc(item.loaderType || '')}</td>
      <td><code>${esc(item.loaderRegion?.id || '')}</code></td>
      <td>${esc(item.sourceStart || '')}</td>
      <td>${esc(item.recipeCount ?? '')}</td>
      <td>${esc(item.slotCount ?? '')}</td>
      <td>${(item.sampleRecipeIds || []).map(id => `<code>${esc(id)}</code>`).join(' ')}</td>
    </tr>`).join('');
    const sourceRows = (metadata.sourceRegionEntries || []).map(item => `<tr>
      <td>${esc(item.family || '')}</td>
      <td><code>${esc(item.catalogId || '')}</code></td>
      <td>${esc(item.arrayName || '')}</td>
      <td>${esc(item.uniqueBytes ?? '')}</td>
      <td>${esc(item.tileBlocks ?? '')}</td>
      <td>${esc(item.spanCount ?? '')}</td>
      <td>${esc(rangeText(item.sourceRange))}</td>
      <td>${esc(item.confidence || item.status || '')}</td>
    </tr>`).join('');
    const spanRows = (combined.unreferencedSpans || []).slice(0, 12).map(span => `<tr>
      <td>${esc(rangeText(span))}</td>
      <td>${esc(span.sizeBytes ?? span.size ?? '')}</td>
      <td>${esc(span.tileCount ?? '')}</td>
    </tr>`).join('');
    const layoutRows = (layout?.sourceFamilies || []).map(item => `<tr>
      <td>${esc(item.family || '')}</td>
      <td><code>${esc(item.catalogId || '')}</code></td>
      <td>${esc(item.rangeCount ?? '')}</td>
      <td>${esc(item.uniqueTiles ?? '')}</td>
      <td>${esc(item.uniqueBytes ?? '')}</td>
    </tr>`).join('');
    const colorRows = Object.entries(shape.colorUseCounts || {}).map(([color, count]) => `<tr>
      <td>${esc(color)}</td>
      <td>${esc(count)}</td>
    </tr>`).join('');
    const familyList = sourceFamilies.length
      ? sourceFamilies.map(item => `<code>${esc(item)}</code>`).join(' ')
      : '<span class="dim">none</span>';
    return `<canvas class="preview-canvas" id="asset-preview-canvas"></canvas>
      <div class="line dim">Runtime local-ROM SMS 4bpp preview. Persisted data remains metadata-only: offsets, counts, source-family provenance and evidence, not tile bytes or pixels.</div>
      <div class="stats-grid">
        ${stat('Tiles', `${metrics.previewTileCount ?? preview.tileCount ?? 0}/${metrics.tileCount ?? preview.totalTileCount ?? 0}`)}
        ${stat('Blank / Nonblank', `${shape.blankTileCount ?? metrics.blankTileCount ?? 0} / ${shape.nonblankTileCount ?? metrics.nonblankTileCount ?? 0}`)}
        ${stat('Max Color Index', shape.maxColorIndex ?? metrics.maxColorIndex ?? 0)}
        ${stat('Combined Coverage', `${metrics.combinedCoveragePercent ?? combined.coveragePercent ?? 0}%`)}
        ${stat('Unreferenced Tiles', metrics.unreferencedTiles ?? combined.unreferencedTiles ?? 0)}
        ${stat('Scene Uses', counts.sceneRecipeUsageCount ?? metrics.sceneRecipeUsageCount ?? 0)}
      </div>
      <div class="line">Source families ${familyList}</div>
      <div class="line">Static coverage ${esc(metrics.staticLoaderCoveragePercent ?? coverage.coveragePercent ?? 'n/a')}% · combined catalog <code>${esc(metadata.combinedCoverageCatalogId || '')}</code> · shape catalog <code>${esc(metadata.unreferencedShapeCatalogId || '')}</code></div>
      ${layout ? `<div class="line">Incbin layout <code>${esc(layout.layoutId || '')}</code> · ${esc(layout.coverageStatus || '')} · role ${esc(layout.segmentRole || '')} · confidence ${esc(layout.confidence || '')}</div>` : '<div class="line dim">No incbin layout entry resolved for this graphics region.</div>'}
      ${unreferencedShape ? `<div class="line">Unreferenced shape scan: ${esc(unreferencedShape.tileCount ?? 0)} tile(s), ${esc(unreferencedShape.nonblankTileCount ?? 0)} nonblank, largest ${esc(rangeText(unreferencedShape.largestSpan || {}))}</div>` : '<div class="line dim">No unresolved-shape entry for this graphics region.</div>'}
      <div class="subhead">Source Families</div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Family</th><th>Catalog</th><th>Ranges</th><th>Unique Tiles</th><th>Duplicate Bytes</th></tr></thead>
        <tbody>${contributorRows || layoutRows || '<tr><td colspan="5" class="dim">No source family contributor rows.</td></tr>'}</tbody>
      </table></div>
      <div class="subhead">Scene Recipe Usage</div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Catalog</th><th>Loader</th><th>Loader Region</th><th>Source Start</th><th>Recipes</th><th>Slots</th><th>Samples</th></tr></thead>
        <tbody>${sceneRows || '<tr><td colspan="7" class="dim">No scene recipe currently uses this region directly.</td></tr>'}</tbody>
      </table></div>
      <div class="subhead">Source Region Entries</div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Family</th><th>Catalog</th><th>Array</th><th>Unique Bytes</th><th>Tile Blocks</th><th>Spans</th><th>Range</th><th>Status</th></tr></thead>
        <tbody>${sourceRows || '<tr><td colspan="8" class="dim">No auxiliary source-region entries matched.</td></tr>'}</tbody>
      </table></div>
      <div class="subhead">Unreferenced Spans</div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Range</th><th>Bytes</th><th>Tiles</th></tr></thead>
        <tbody>${spanRows || '<tr><td colspan="3" class="dim">No unreferenced span in combined coverage.</td></tr>'}</tbody>
      </table></div>
      <div class="subhead">Color Index Counts</div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Index</th><th>Pixel Count</th></tr></thead>
        <tbody>${colorRows || '<tr><td colspan="2" class="dim">No color-index scan available.</td></tr>'}</tbody>
      </table></div>
      <div class="subhead">Analysis</div>
      ${renderAnalysisEntriesTable(metadata.analysisEntries, 'No graphics analysis entries.')}`;
  }

  function renderDc2TileMapPreview(preview, result) {
    const dc2 = preview.dc2 || {};
    const decoded = dc2.decoded || {};
    const commandRows = (decoded.commands || []).map(command => `<tr>
      <td><code>${esc(command.offsetHex)}</code></td>
      <td>${esc(command.kind)}</td>
      <td>${esc(command.encodedCellCount)}</td>
      <td>${esc(command.outputStartCell)}-${esc(command.outputEndCellExclusive)}</td>
    </tr>`).join('');
    const slotRows = (dc2.streamSlots || []).map((slot, index) => `<tr><td>${index}</td><td>${esc(slot)}</td></tr>`).join('');
    return `<div class="line">DC2 stream index ${esc(dc2.tableIndexHex || '')} · table entry ${esc(dc2.tableEntryOffsetHex || '')} · pointer ${esc(dc2.z80PointerHex || '')}</div>
      <div class="stats-grid">
        ${stat('Cells', `${decoded.writtenCells ?? 0}/${decoded.expectedCells ?? 176}`)}
        ${stat('Layout', `${decoded.columns ?? 16}x${decoded.rows ?? 11}`)}
        ${stat('Consumed Bytes', decoded.runtimeConsumedBytes ?? 0)}
        ${stat('Ops', decoded.opCount ?? 0)}
        ${stat('Max Run', decoded.maxRunLength ?? 0)}
        ${stat('Descriptors', dc2.descriptorCount ?? '')}
      </div>
      <div class="line">End reason ${esc(decoded.endReason || '')} · catalog <code>${esc(dc2.catalogId || '')}</code></div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Opcode ROM</th><th>Kind</th><th>Cells</th><th>Output Cells</th></tr></thead>
        <tbody>${commandRows || '<tr><td colspan="4" class="dim">No command preview.</td></tr>'}</tbody>
      </table></div>
      <div class="subhead">Usage Slots</div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>#</th><th>Slot</th></tr></thead>
        <tbody>${slotRows || '<tr><td colspan="2" class="dim">No stream slot usage recorded.</td></tr>'}</tbody>
      </table></div>
      <div class="subhead">Analysis</div>
      ${renderAnalysisEntriesTable(preview.analysisEntries, 'No tile-map analysis entries.')}`;
  }

  function renderDynamicTileLoaderPreview(preview, result) {
    const dynamic = preview.dynamic || {};
    const streamRows = (dynamic.streams || []).map(stream => `<tr>
      <td><code>${esc(stream.streamRomOffset)}</code></td>
      <td><code>${esc(stream.streamZ80Address)}</code></td>
      <td>${esc(stream.referencedByCount)}</td>
      <td>${esc((stream.remapRows || []).join(', '))}</td>
      <td>${esc(stream.decoded?.sourceRecordCount ?? '')}</td>
      <td>${esc(stream.decoded?.totalTileBlocks ?? '')}</td>
      <td>${esc((stream.decoded?.sourceRegionIds || []).join(', '))}</td>
    </tr>`).join('');
    return `<div class="stats-grid">
        ${stat('Streams', dynamic.totalStreamCount ?? 0)}
        ${stat('Source Records', dynamic.totalSourceRecordCount ?? 0)}
        ${stat('Tile Blocks', dynamic.totalTileBlocks ?? 0)}
        ${stat('Source Regions', (dynamic.sourceRegionIds || []).length)}
      </div>
      <div class="line">Catalog <code>${esc(dynamic.catalogId || '')}</code></div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Stream ROM</th><th>Z80</th><th>Refs</th><th>Remap Rows</th><th>Records</th><th>Blocks</th><th>Source Regions</th></tr></thead>
        <tbody>${streamRows || '<tr><td colspan="7" class="dim">No dynamic streams for this region.</td></tr>'}</tbody>
      </table></div>
      <div class="subhead">Analysis</div>
      ${renderAnalysisEntriesTable(preview.analysisEntries, 'No dynamic tile analysis entries.')}`;
  }

  function renderTileMapCatalogPreview(preview, result) {
    const model = preview.catalogModel || {};
    return `<div class="stats-grid">
        ${stat('Records', model.recordCount ?? result.metrics?.lookupRecordCount ?? 0)}
        ${stat('Used Records', model.uniqueLookupRecordIndicesUsed ?? result.metrics?.uniqueLookupRecordIndicesUsed ?? 0)}
        ${stat('DC2 Streams', model.dc2StreamsDecoded ?? result.metrics?.dc2StreamsDecoded ?? 0)}
        ${stat('Warnings', model.warningStreamCount ?? result.metrics?.warningStreamCount ?? 0)}
      </div>
      <div class="line">Catalog <code>${esc(model.catalogId || result.metrics?.catalogId || '')}</code> · lookup ${esc(model.lookupOffset || '')}</div>
      <div class="subhead">Analysis</div>
      ${renderAnalysisEntriesTable(preview.analysisEntries, 'No catalog analysis entries.')}`;
  }

  function renderPaletteVdpStreamModel(preview, result) {
    const layout = preview.layout || {};
    const summary = layout.summary || {};
    const finalDisposition = preview.finalDisposition || {};
    const finalSummary = finalDisposition.summary || {};
    const intervalRows = (layout.mergedIntervals || []).map(interval => `<tr>
      <td><code>${esc(interval.startOffset)}</code></td>
      <td><code>${esc(interval.endOffsetExclusive)}</code></td>
      <td>${esc(interval.size)}</td>
      <td>${esc((interval.kinds || []).join(', '))}</td>
    </tr>`).join('');
    const gapRows = (finalDisposition.gaps || []).map(gap => `<tr>
      <td><code>${esc(gap.range?.startOffset || '')}</code></td>
      <td><code>${esc(gap.range?.endOffsetExclusive || '')}</code></td>
      <td>${esc(gap.range?.size ?? '')}</td>
      <td>${esc(gap.finalDisposition || '')}</td>
      <td>${esc(gap.confidence || '')}</td>
      <td>${gap.unresolvedTraceLead ? 'yes' : 'no'}</td>
    </tr>`).join('');
    const runtimeRows = (preview.runtimeCatalogs || []).map(catalog => `<tr>
      <td><code>${esc(catalog.id)}</code></td>
      <td>${esc(Object.entries(catalog.summary || {}).slice(0, 6).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(',') : value}`).join('; '))}</td>
    </tr>`).join('');
    return `<div class="stats-grid">
        ${stat('Decoded Intervals', summary.decodedIntervalCount ?? result.metrics?.decodedIntervalCount ?? 0)}
        ${stat('Merged Runs', summary.mergedDecodedRuns ?? result.metrics?.mergedDecodedRunCount ?? 0)}
        ${stat('Coverage', `${Math.round(Number(summary.decodedCoverageRatio || result.metrics?.decodedCoverageRatio || 0) * 100)}%`)}
        ${stat('Residual Gaps', summary.gapCount ?? result.metrics?.gapCount ?? 0)}
        ${stat('Modeled Slots', result.metrics?.modeledEntrySlotCount ?? '')}
        ${stat('Trace Leads', finalSummary.unresolvedTraceLeadCount ?? result.metrics?.unresolvedTraceLeadCount ?? 0)}
      </div>
      <div class="line">Bundle ${esc(layout.bundle?.range?.join(' - ') || '')} · catalogs ${esc((preview.catalogIds || []).length)}</div>
      <div class="subhead">Runtime Catalogs</div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Catalog</th><th>Summary</th></tr></thead>
        <tbody>${runtimeRows || '<tr><td colspan="2" class="dim">No runtime catalogs.</td></tr>'}</tbody>
      </table></div>
      <div class="subhead">Merged Decoded Intervals</div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Start</th><th>End</th><th>Bytes</th><th>Kinds</th></tr></thead>
        <tbody>${intervalRows || '<tr><td colspan="4" class="dim">No interval preview.</td></tr>'}</tbody>
      </table></div>
      <div class="subhead">Residual Disposition</div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Start</th><th>End</th><th>Bytes</th><th>Final Disposition</th><th>Confidence</th><th>Trace Lead</th></tr></thead>
        <tbody>${gapRows || '<tr><td colspan="6" class="dim">No residual gaps.</td></tr>'}</tbody>
      </table></div>
      <div class="subhead">Analysis</div>
      ${renderAnalysisEntriesTable(preview.analysisEntries, 'No VDP stream analysis entries.')}`;
  }

  function drawTileMapHeatmap(canvas, entries, cols, rows) {
    const zoom = 4;
    const cell = 8 * zoom;
    canvas.width = Math.max(1, cols) * cell;
    canvas.height = Math.max(1, rows) * cell;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#050508';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const maxCells = Math.min(entries.length, cols * rows);
    for (let i = 0; i < maxCells; i++) {
      const entry = entries[i];
      const x = (i % cols) * cell;
      const y = Math.floor(i / cols) * cell;
      const light = entry.palette ? 58 : 42;
      ctx.fillStyle = `hsl(${(entry.tile * 37) % 360}, 62%, ${light}%)`;
      ctx.fillRect(x, y, cell, cell);
      if (entry.hflip || entry.vflip || entry.priority) {
        ctx.strokeStyle = entry.priority ? '#ffcc00' : '#d6d6ee';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 1, y + 1, cell - 2, cell - 2);
      }
    }
  }

  function drawLoaderCanvas(canvas, entries) {
    const copyEntries = entries.filter(entry => entry.kind === 'copy' || entry.kind === 'zero');
    let maxSlot = 0;
    copyEntries.forEach(entry => { maxSlot = Math.max(maxSlot, entry.vramTile + Math.max(1, entry.count)); });
    const cols = 32;
    const zoom = 2;
    const rows = Math.max(1, Math.min(24, Math.ceil(maxSlot / cols)));
    canvas.width = cols * 8 * zoom;
    canvas.height = rows * 8 * zoom;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#050508';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const entry of copyEntries) {
      for (let t = 0; t < Math.max(1, entry.count); t++) {
        const slot = entry.vramTile + t;
        if (slot >= cols * rows) continue;
        const x = (slot % cols) * 8 * zoom;
        const y = Math.floor(slot / cols) * 8 * zoom;
        if (entry.kind === 'zero' || !currentRom || entry.romSrc == null || entry.romSrc + t * 32 + 31 >= currentRom.length) {
          ctx.fillStyle = '#222';
          ctx.fillRect(x, y, 8 * zoom, 8 * zoom);
          continue;
        }
        const tmp = document.createElement('canvas');
        drawTileGrid(tmp, currentRom, entry.romSrc + t * 32, 1, TILE_PREVIEW_COLORS);
        ctx.drawImage(tmp, x, y, 8 * zoom, 8 * zoom);
      }
    }
  }

  function drawMetaspriteLayout(canvas, preview) {
    const pieces = preview.pieces || [];
    const tileSources = preview.tileRenderSources || [];
    const spriteWidth = preview.spriteWidth || 8;
    const spriteHeight = preview.spriteHeight || 16;
    const bounds = preview.bounds || { minX: 0, minY: 0, width: spriteWidth, height: spriteHeight };
    const zoom = 4;
    const pad = 8;
    canvas.width = Math.max(80, Math.ceil(bounds.width * zoom + pad * 2));
    canvas.height = Math.max(80, Math.ceil(bounds.height * zoom + pad * 2));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#050508';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#292947';
    ctx.strokeRect(pad - 0.5, pad - 0.5, bounds.width * zoom + 1, bounds.height * zoom + 1);
    ctx.font = '9px Courier New, monospace';
    ctx.textBaseline = 'top';
    function sourceForTile(tile) {
      const sorted = tileSources.slice().sort((a, b) => (a.confidence === 'high' ? -1 : 0) - (b.confidence === 'high' ? -1 : 0));
      for (const source of sorted) {
        if (tile >= source.vramStart && tile <= source.vramEnd && currentRom) {
          const romOffset = source.romStart + (tile - source.vramStart) * 32;
          if (romOffset >= 0 && romOffset + 31 < currentRom.length) return romOffset;
        }
      }
      return null;
    }
    pieces.forEach(piece => {
      const x = pad + (piece.x - bounds.minX) * zoom;
      const y = pad + (piece.y - bounds.minY) * zoom;
      const topTile = piece.resolvedTile ?? piece.tile;
      const topSource = sourceForTile(topTile);
      const bottomSource = spriteHeight > 8 ? sourceForTile((topTile + 1) & 0xff) : null;
      if (topSource != null) {
        const tmp = document.createElement('canvas');
        drawTileGrid(tmp, currentRom, topSource, 1, TILE_PREVIEW_COLORS);
        ctx.drawImage(tmp, x, y, 8 * zoom, 8 * zoom);
        if (spriteHeight > 8) {
          if (bottomSource != null) {
            drawTileGrid(tmp, currentRom, bottomSource, 1, TILE_PREVIEW_COLORS);
            ctx.drawImage(tmp, x, y + 8 * zoom, 8 * zoom, 8 * zoom);
          } else {
            ctx.fillStyle = 'rgba(255,204,0,.14)';
            ctx.fillRect(x, y + 8 * zoom, spriteWidth * zoom, 8 * zoom);
          }
        }
      } else {
        const hue = (piece.tile * 41) % 360;
        ctx.fillStyle = `hsla(${hue}, 70%, 42%, .65)`;
        ctx.fillRect(x, y, spriteWidth * zoom, spriteHeight * zoom);
      }
      ctx.strokeStyle = '#00d4ff';
      ctx.strokeRect(x + 0.5, y + 0.5, spriteWidth * zoom - 1, spriteHeight * zoom - 1);
      if (spriteHeight > 8) {
        ctx.strokeStyle = 'rgba(214,214,238,.25)';
        ctx.beginPath();
        ctx.moveTo(x, y + 8 * zoom + 0.5);
        ctx.lineTo(x + spriteWidth * zoom, y + 8 * zoom + 0.5);
        ctx.stroke();
      }
      ctx.fillStyle = '#f2f0d8';
      ctx.fillText(piece.tileHex || String(piece.tile), x + 2, y + 2);
    });
  }

  function drawEntityAnimTimeline(canvas, preview) {
    const commands = preview.commands || [];
    const zoomX = 10;
    const rowH = 18;
    const left = 78;
    const width = Math.max(360, left + Math.max(24, preview.timelineFrameCount || commands.length * 4) * zoomX + 20);
    const height = Math.max(70, 24 + commands.length * rowH + 18);
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#050508';
    ctx.fillRect(0, 0, width, height);
    ctx.font = '10px Courier New, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#70709a';
    ctx.fillText('frames', 10, 12);
    ctx.strokeStyle = '#292947';
    for (let f = 0; f <= (preview.timelineFrameCount || 0); f += 8) {
      const x = left + f * zoomX;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 20);
      ctx.lineTo(x + 0.5, height - 12);
      ctx.stroke();
      ctx.fillText(String(f), x + 2, 12);
    }
    commands.forEach((command, index) => {
      const y = 30 + index * rowH;
      const duration = Math.max(1, command.delay || 1);
      const x = left + (command.startFrame || 0) * zoomX;
      const w = Math.max(6, duration * zoomX);
      const target = command.framePointer?.romOffset || command.framePointer?.z80Pointer || command.index;
      ctx.fillStyle = `hsla(${(target * 29) % 360}, 70%, ${command.hasMotionWords ? 52 : 38}%, .78)`;
      ctx.fillRect(x, y - 6, w, 12);
      ctx.strokeStyle = command.delay === 0 ? '#ffcc00' : '#00d4ff';
      ctx.strokeRect(x + 0.5, y - 6.5, w - 1, 12);
      ctx.fillStyle = '#d6d6ee';
      ctx.fillText(`#${command.index}`, 10, y);
      ctx.fillStyle = '#ffcc00';
      ctx.fillText(command.controlHex || '', 38, y);
      ctx.fillStyle = '#f2f0d8';
      ctx.fillText(command.framePointer?.romOffsetHex || command.framePointer?.z80PointerHex || '', x + 4, y);
    });
  }

  function smsCramColor(value) {
    if (value == null || !Number.isFinite(Number(value))) return '#151520';
    const v = Number(value) & 0x3f;
    const r = (v & 0x03) * 85;
    const g = ((v >> 2) & 0x03) * 85;
    const b = ((v >> 4) & 0x03) * 85;
    return `rgb(${r},${g},${b})`;
  }

  function drawPaletteScriptBuffers(canvas, preview) {
    const buffers = preview.finalBuffers || {};
    const dests = ['_RAM_CFBB_', '_RAM_CF9B_'];
    const cols = 32;
    const cell = 18;
    const labelW = 92;
    const top = 18;
    const rowH = 30;
    canvas.width = labelW + cols * cell + 14;
    canvas.height = top + dests.length * rowH + 12;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#050508';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = '10px Courier New, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#70709a';
    ctx.fillText('slots 00-31', labelW, 8);
    dests.forEach((dest, row) => {
      const y = top + row * rowH;
      ctx.fillStyle = '#d6d6ee';
      ctx.fillText(dest, 8, y + cell / 2);
      const values = buffers[dest] || [];
      for (let slot = 0; slot < cols; slot++) {
        const x = labelW + slot * cell;
        const value = values[slot];
        ctx.fillStyle = smsCramColor(value);
        ctx.fillRect(x, y, cell - 2, cell - 2);
        ctx.strokeStyle = value == null ? '#292947' : '#d6d6ee';
        ctx.strokeRect(x + 0.5, y + 0.5, cell - 3, cell - 3);
        if (value != null && slot % 2 === 0) {
          ctx.fillStyle = '#050508';
          ctx.fillText((Number(value) & 0x3f).toString(16).toUpperCase().padStart(2, '0'), x + 2, y + cell / 2);
        }
      }
    });
  }

  function drawRoomGrid(canvas, entries, valueFn, warnFn) {
    const cols = 32;
    const cell = 14;
    const rows = Math.max(1, Math.ceil(Math.max(1, entries.length) / cols));
    canvas.width = cols * cell + 2;
    canvas.height = rows * cell + 2;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#050508';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    entries.forEach((entry, index) => {
      const value = valueFn(entry, index);
      const x = (index % cols) * cell + 1;
      const y = Math.floor(index / cols) * cell + 1;
      ctx.fillStyle = `hsl(${(value * 31) % 360}, 68%, ${warnFn(entry) ? 34 : 48}%)`;
      ctx.fillRect(x, y, cell - 2, cell - 2);
      if (warnFn(entry)) {
        ctx.strokeStyle = '#ffcc00';
        ctx.strokeRect(x + 0.5, y + 0.5, cell - 3, cell - 3);
      }
    });
  }

  function drawRoomDescriptorGrid(canvas, preview) {
    drawRoomGrid(
      canvas,
      preview.descriptors || [preview.descriptor].filter(Boolean),
      entry => entry.subrecord?.bgPaletteIndex ?? entry.subrecord?.audioRequestId ?? entry.outgoingEdgeCount ?? 0,
      entry => (entry.warnings || []).length > 0
    );
  }

  function drawRoomSubrecordGrid(canvas, preview) {
    drawRoomGrid(
      canvas,
      preview.records || [],
      entry => entry.bgPaletteIndex ?? entry.audioRequestId ?? entry.index ?? 0,
      entry => entry.status !== 'zone_graph_reached' || (entry.warnings || []).length > 0
    );
  }

  function drawRoomEntityListGrid(canvas, preview) {
    const entries = [];
    (preview.lists || []).forEach((list, listIndex) => {
      (list.records || []).forEach(record => entries.push({ list, listIndex, record }));
      if (!(list.records || []).length) entries.push({ list, listIndex, record: null });
    });
    const cols = 32;
    const cell = 14;
    const rows = Math.max(1, Math.ceil(Math.max(1, entries.length) / cols));
    canvas.width = cols * cell + 2;
    canvas.height = rows * cell + 2;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#050508';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    entries.forEach((entry, index) => {
      const record = entry.record;
      const value = record ? Number(record.entityType || 0) : entry.listIndex;
      const x = (index % cols) * cell + 1;
      const y = Math.floor(index / cols) * cell + 1;
      ctx.fillStyle = record
        ? `hsl(${(value * 29) % 360}, 68%, ${record.alternate ? 38 : 48}%)`
        : '#222238';
      ctx.fillRect(x, y, cell - 2, cell - 2);
      if (!record || record.alternate || (entry.list.warnings || []).length) {
        ctx.strokeStyle = record?.alternate ? '#ffcc00' : '#66668a';
        ctx.strokeRect(x + 0.5, y + 0.5, cell - 3, cell - 3);
      }
    });
  }

  function renderSwatches(colors) {
    return `<div class="swatches">${colors.map((color, index) =>
      `<div class="swatch" title="${index}: ${esc(color)}" style="background:${esc(color)}"></div>`
    ).join('')}</div>`;
  }

  function renderPalettePreview(preview, result) {
    const record = preview.tableRecord || {};
    const roleCounts = counts => Object.entries(counts || {})
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([role, count]) => `${role}:${count}`).join(', ') || 'none';
    const tableRows = [
      ['Region', result.regionId || ''],
      ['Palette table catalog', preview.tableCatalogId || 'not linked'],
      ['Record index', record.index != null ? `#${record.index}` : 'not linked'],
      ['Record offset', record.offset || record.region?.offset || ''],
      ['Record confidence', record.confidence || ''],
      ['Direct _LABEL_8B2_ BG uses', record.usedAsBgByDirectCallsites ?? 0],
      ['Direct _LABEL_8B2_ SPR uses', record.usedAsSpriteByDirectCallsites ?? 0],
      ['Scene recipe roles', roleCounts(preview.sceneRoleCounts)],
      ['Writer roles', roleCounts(preview.writerRoleCounts)],
    ].map(([label, value]) => `<tr><td>${esc(label)}</td><td>${esc(value)}</td></tr>`).join('');
    const sceneRows = (preview.sceneUsages || []).map(use => `<tr>
      <td><code>${esc(use.recipeId)}</code><br>${esc(use.recipeName || '')}</td>
      <td>${esc(use.role)}</td>
      <td>${esc(use.stepOrder)}</td>
      <td>${esc(use.kind || use.sourceStepType || '')}</td>
      <td>${esc(use.bank)}</td>
      <td>${esc(use.provenanceSource || '')}</td>
      <td>${esc(use.confidence || '')}</td>
    </tr>`).join('');
    const writerRows = (preview.writerUsages || []).map(use => `<tr>
      <td><code>${esc(use.callerLabel || '')}</code><br><span class="dim">${esc(use.callerOffset || '')}</span></td>
      <td>${esc(use.role)}</td>
      <td>${esc(use.action || '')}</td>
      <td>${esc(use.contextRole || '')}<br><span class="dim">${esc(use.contextFamily || '')}</span></td>
      <td>${esc(use.callLine || '')}</td>
      <td>${esc(use.sourceLine || '')}</td>
      <td>${esc(use.confidence || '')}</td>
    </tr>`).join('');
    const script = preview.scriptBridge || {};
    const scriptRows = [
      ['Palette script catalog', script.sourceCatalogId || 'not linked'],
      ['Loader routine', script.loaderLabel || ''],
      ['Pointer table', script.pointerTable || ''],
      ['Index RAM', script.indexRam || ''],
      ['Active pointer RAM', script.activePointerRam || ''],
      ['Delay RAM', script.delayRam || ''],
      ['Script count', script.scriptCount ?? 0],
      ['Direct/dynamic/sentinel writers', `${script.directIndexWrites ?? 0}/${script.dynamicIndexWrites ?? 0}/${script.sentinelIndexWrites ?? 0}`],
    ].map(([label, value]) => `<tr><td>${esc(label)}</td><td>${esc(value)}</td></tr>`).join('');
    const inheritance = preview.inheritanceSummary || {};
    const inheritanceRows = [
      ['Inheritance catalog', inheritance.sourceCatalogId || 'not linked'],
      ['Owner status', inheritance.ownerStatus || ''],
      ['Dependency path', inheritance.dependencyPath || ''],
      ['Renderer expectation', inheritance.rendererExpectation || ''],
      ['Inherited recipe refs', inheritance.inheritanceRefRecipeCount ?? 0],
      ['Preserved sprite recipes', inheritance.preservedSpritePaletteRecipeCount ?? 0],
      ['Matching initializer paths', inheritance.matchingInitializerPathCount ?? 0],
      ['Matching room-load callsites', inheritance.matchingRoomLoadCallsiteCount ?? 0],
      ['Cached restore paths', inheritance.cachedRestorePathCount ?? 0],
      ['Applies to this record', inheritance.appliesToThisRecord ? 'yes' : 'metadata only'],
    ].map(([label, value]) => `<tr><td>${esc(label)}</td><td>${esc(value)}</td></tr>`).join('');
    return `${renderSwatches(preview.colors || [])}
      <div class="line dim">${esc(preview.assetPolicy || '')}</div>
      <div class="box-title" style="margin-top:10px">Palette Provenance</div>
      <div class="table-wrap"><table class="asset-table"><tbody>${tableRows}</tbody></table></div>
      <div class="box-title" style="margin-top:10px">Scene Recipe Usage</div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Recipe</th><th>Role</th><th>Step</th><th>Kind</th><th>Bank</th><th>Source</th><th>Confidence</th></tr></thead>
        <tbody>${sceneRows || '<tr><td colspan="7" class="dim">No scene recipe currently references this palette region.</td></tr>'}</tbody>
      </table></div>
      <div class="box-title" style="margin-top:10px">Palette Writers</div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Caller</th><th>Role</th><th>Action</th><th>Context</th><th>Call Line</th><th>Source Line</th><th>Confidence</th></tr></thead>
        <tbody>${writerRows || '<tr><td colspan="7" class="dim">No direct palette writer is linked to this record yet.</td></tr>'}</tbody>
      </table></div>
      <div class="box-title" style="margin-top:10px">Palette Script Bridge</div>
      <div class="table-wrap"><table class="asset-table"><tbody>${scriptRows}</tbody></table></div>
      <div class="box-title" style="margin-top:10px">Sprite Palette Inheritance</div>
      <div class="table-wrap"><table class="asset-table"><tbody>${inheritanceRows}</tbody></table></div>`;
  }

  function renderVramLoaderPreview(preview, result) {
    const usage = preview.consumerUsage || {};
    const counts = usage.counts || {};
    const sourceRows = (preview.sourceGroups || []).map(group => `<tr>
      <td>${group.sourceRegion ? `<code>${esc(group.sourceRegion.id)}</code><br>${esc(group.sourceRegion.name || '')}` : '<span class="dim">unresolved</span>'}</td>
      <td>${esc(group.firstSourceHex || '')}..${esc(group.lastSourceEndHex || '')}</td>
      <td>${esc(group.tileCount || 0)}</td>
      <td>${esc(group.entryCount || 0)}</td>
      <td>${esc(group.vramRange || '')}</td>
      <td>${esc(group.bank ?? '')}</td>
    </tr>`).join('');
    const entryRows = (preview.entries || []).map((entry, index) => `<tr>
      <td>${index}</td>
      <td>${esc(entry.count)}</td>
      <td><code>${esc(entry.vramTileHex || '')}</code>..<code>${esc(entry.vramTileEndHex || '')}</code></td>
      <td><code>${esc(entry.romSrcHex || '')}</code></td>
      <td>${entry.sourceRegion ? `<code>${esc(entry.sourceRegion.id)}</code><br>${esc(entry.sourceRegion.name || '')}` : '<span class="dim">unresolved</span>'}</td>
      <td>${esc(entry.bank ?? '')}</td>
      <td>${esc(entry.blockIndex ?? '')}</td>
    </tr>`).join('');
    const sceneRows = (usage.sceneUsages || []).map(use => `<tr>
      <td><code>${esc(use.recipeId)}</code><br>${esc(use.recipeName || '')}</td>
      <td>${esc(use.stepOrder)}</td>
      <td>${esc(use.kind || use.sourceStepType || '')}</td>
      <td>${esc(use.bank)}</td>
      <td>${esc(use.provenanceSource || '')}</td>
      <td>${esc(use.confidence || '')}</td>
    </tr>`).join('');
    const zoneRows = (usage.zoneRecipeUsages || []).map(use => `<tr>
      <td><code>${esc(use.recipeId)}</code><br>${esc(use.name || '')}</td>
      <td>${esc(use.descriptorOffset || '')}</td>
      <td>${esc(use.subrecordOffset || '')}</td>
      <td>${esc(use.bgPaletteIndex ?? '')}</td>
      <td>${esc(use.entries ?? '')}</td>
      <td>${esc(use.totalTiles ?? '')}</td>
      <td>${esc(use.confidence || '')}</td>
    </tr>`).join('');
    const inlineRows = (usage.inlineTransitionUsages || []).map(use => `<tr>
      <td><code>${esc(use.recipeId)}</code><br>${esc(use.name || '')}</td>
      <td>${esc(use.descriptorOffset || '')}</td>
      <td>${esc(use.sourceTriggerOffset || '')}</td>
      <td>${esc(use.branchRole || '')}</td>
      <td>${esc(use.entries ?? '')}</td>
      <td>${esc(use.totalTiles ?? '')}</td>
      <td>${esc(use.confidence || '')}</td>
    </tr>`).join('');
    const callRows = (usage.directCallsites || []).map(call => `<tr>
      <td><code>${esc(call.caller || '')}</code></td>
      <td>${esc(call.line || '')}</td>
      <td>${esc(call.loadedAtLine || '')}</td>
      <td><code>${esc(call.expression || '')}</code></td>
      <td>${esc(call.instruction || '')}</td>
      <td>${esc(call.source || '')}</td>
      <td>${esc(call.confidence || '')}</td>
    </tr>`).join('');
    const specialRows = (usage.specialUsages || []).map(item => `<tr>
      <td><code>${esc(item.key || '')}</code></td>
      <td>${esc(item.role || '')}</td>
      <td>${esc(item.kind || '')}</td>
      <td>${esc(item.confidence || '')}</td>
      <td>${esc(item.summary || '')}</td>
    </tr>`).join('');
    const boundaryRows = (usage.boundaryCatalogMatches || []).map(item => `<tr>
      <td><code>${esc(item.sourceCatalogId || '')}</code></td>
      <td>${esc(item.offset || '')}..${esc(item.endInclusive || '')}</td>
      <td>${esc(item.referenceCount ?? '')}</td>
      <td>${esc(item.entries ?? '')}</td>
      <td>${esc(item.totalTiles ?? '')}</td>
      <td>${esc(item.maxVramTile || '')}</td>
    </tr>`).join('');
    const consumerRecipeRows = (usage.consumerRecipes || []).map(item => `<tr>
      <td><code>${esc(item.recipeId || '')}</code></td>
      <td>${esc(item.recipeType || '')}</td>
      <td>${esc(item.loaderOffset || '')}</td>
      <td>${esc(item.status || '')}</td>
      <td>${esc(item.totalConsumerCount ?? '')}</td>
      <td>${esc(item.reusableRecipeConsumerCount ?? '')}</td>
      <td>${esc(item.directCallsiteCount ?? '')}</td>
      <td>${esc(item.specialUsageCount ?? '')}</td>
      <td>${esc(item.confidence || '')}</td>
    </tr>`).join('');
    const renderGroupRows = (usage.renderSourceGroups || []).map(item => `<tr>
      <td><code>${esc(item.sourceCatalogId || '')}</code></td>
      <td>${item.sourceRegion ? `<code>${esc(item.sourceRegion.id)}</code><br>${esc(item.sourceRegion.name || '')}` : '<span class="dim">unresolved</span>'}</td>
      <td>${esc(item.sourceStart || '')}</td>
      <td>${esc(item.recipeCount ?? '')}</td>
      <td>${esc(item.slotCount ?? '')}</td>
      <td>${esc((item.sampleRecipeIds || []).join(', '))}</td>
    </tr>`).join('');
    const summaryRows = [
      ['Loader kind', preview.loaderKind || preview.format || ''],
      ['Entries shown', `${(preview.entries || []).length}`],
      ['Source groups', (preview.sourceGroups || []).length],
      ['Scene recipes', counts.sceneRecipeUsageCount ?? 0],
      ['Zone recipes', counts.zoneRecipeUsageCount ?? 0],
      ['Inline transition recipes', counts.inlineTransitionUsageCount ?? 0],
      ['Consumer recipes', counts.consumerRecipeCount ?? 0],
      ['Direct ASM callsites', counts.directCallsiteCount ?? 0],
      ['Special/catalog usages', counts.specialUsageCount ?? 0],
      ['Consumer resolved', counts.consumerResolved ? 'yes' : 'no'],
    ].map(([label, value]) => `<tr><td>${esc(label)}</td><td>${esc(value)}</td></tr>`).join('');
    return `<canvas class="preview-canvas" id="asset-preview-canvas"></canvas>
      <div class="line dim">VRAM slot preview from loader source offsets. Dark blocks are zero/unresolved slots.</div>
      <div class="line dim">${esc(preview.assetPolicy || '')}</div>
      <div class="box-title" style="margin-top:10px">Loader Summary</div>
      <div class="table-wrap"><table class="asset-table"><tbody>${summaryRows}</tbody></table></div>
      <div class="box-title" style="margin-top:10px">Tile Source Provenance</div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Source Region</th><th>ROM Range</th><th>Tiles</th><th>Entries</th><th>VRAM Range</th><th>Bank</th></tr></thead>
        <tbody>${sourceRows || '<tr><td colspan="6" class="dim">No source groups.</td></tr>'}</tbody>
      </table></div>
      <div class="box-title" style="margin-top:10px">Loader Entries</div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>#</th><th>Count</th><th>VRAM Tiles</th><th>Source ROM</th><th>Source Region</th><th>Bank</th><th>Block</th></tr></thead>
        <tbody>${entryRows || '<tr><td colspan="7" class="dim">No entries.</td></tr>'}</tbody>
      </table></div>
      <div class="box-title" style="margin-top:10px">Reusable Scene Recipes</div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Recipe</th><th>Step</th><th>Kind</th><th>Bank</th><th>Source</th><th>Confidence</th></tr></thead>
        <tbody>${sceneRows || '<tr><td colspan="6" class="dim">No scene recipe step currently references this loader.</td></tr>'}</tbody>
      </table></div>
      <div class="box-title" style="margin-top:10px">Zone Recipes</div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Recipe</th><th>Descriptor</th><th>Subrecord</th><th>BG Pal</th><th>Entries</th><th>Tiles</th><th>Confidence</th></tr></thead>
        <tbody>${zoneRows || '<tr><td colspan="7" class="dim">No zone recipe currently references this loader.</td></tr>'}</tbody>
      </table></div>
      <div class="box-title" style="margin-top:10px">Inline Transition Recipes</div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Recipe</th><th>Descriptor</th><th>Trigger</th><th>Branch</th><th>Entries</th><th>Tiles</th><th>Confidence</th></tr></thead>
        <tbody>${inlineRows || '<tr><td colspan="7" class="dim">No inline transition recipe currently references this loader.</td></tr>'}</tbody>
      </table></div>
      <div class="box-title" style="margin-top:10px">Scene Render Source Groups</div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Catalog</th><th>Source Region</th><th>Source Start</th><th>Recipes</th><th>Slots</th><th>Samples</th></tr></thead>
        <tbody>${renderGroupRows || '<tr><td colspan="6" class="dim">No scene render source groups.</td></tr>'}</tbody>
      </table></div>
      <div class="box-title" style="margin-top:10px">Boundary Catalog Matches</div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Catalog</th><th>Range</th><th>Refs</th><th>Entries</th><th>Tiles</th><th>Max VRAM</th></tr></thead>
        <tbody>${boundaryRows || '<tr><td colspan="6" class="dim">No boundary catalog match.</td></tr>'}</tbody>
      </table></div>
      <div class="box-title" style="margin-top:10px">Loader Consumer Recipes</div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Recipe</th><th>Type</th><th>Loader</th><th>Status</th><th>Total</th><th>Reusable</th><th>ASM</th><th>Special</th><th>Confidence</th></tr></thead>
        <tbody>${consumerRecipeRows || '<tr><td colspan="9" class="dim">No canonical consumer recipe is stored for this loader yet.</td></tr>'}</tbody>
      </table></div>
      <div class="box-title" style="margin-top:10px">Direct ASM Callsites</div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Caller</th><th>Call Line</th><th>Load Line</th><th>Operand</th><th>Instruction</th><th>Source</th><th>Confidence</th></tr></thead>
        <tbody>${callRows || '<tr><td colspan="7" class="dim">No direct ASM callsite metadata linked.</td></tr>'}</tbody>
      </table></div>
      <div class="box-title" style="margin-top:10px">Special Consumer Metadata</div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Analysis Key</th><th>Role</th><th>Kind</th><th>Confidence</th><th>Summary</th></tr></thead>
        <tbody>${specialRows || '<tr><td colspan="5" class="dim">No special consumer metadata.</td></tr>'}</tbody>
      </table></div>`;
  }

  function previewPointerTable(result) {
    const entries = result.transientPreview?.entries || [];
    const rows = entries.map(entry => `<tr>
      <td>${entry.index}</td>
      <td><code>${esc(wb3DecoderHex(entry.entryOffset))}</code></td>
      <td><code>0x${entry.z80.toString(16).toUpperCase().padStart(4, '0')}</code></td>
      <td>${entry.romTarget >= 0 ? `<code>${esc(wb3DecoderHex(entry.romTarget))}</code>` : '<span class="dim">RAM/unresolved</span>'}</td>
    </tr>`).join('');
    return `<div class="table-wrap"><table class="asset-table">
      <thead><tr><th>#</th><th>Entry ROM</th><th>Z80 Ptr</th><th>Resolved ROM</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  }

  function musicIsRomPtr(z80) {
    return z80 >= 0x8000 && z80 < 0xC000;
  }

  function musicZ80toRom(z80) {
    return z80 + 0x4000;
  }

  function musicParseSongTable(rom) {
    const songs = [];
    for (let i = 0; i < MUSIC_SONG_COUNT; i++) {
      const off = MUSIC_SONG_TABLE_OFF + i * 2;
      if (off + 1 >= rom.length) break;
      const z80 = rom[off] | (rom[off + 1] << 8);
      const romOff = musicIsRomPtr(z80) ? musicZ80toRom(z80) : null;
      songs.push({ id: i, z80, romOff });
    }
    return songs;
  }

  function musicParseHeader(rom, songRomOff) {
    const channels = [];
    let pos = songRomOff;
    while (pos + 3 < rom.length && pos < songRomOff + 64) {
      const b = rom[pos];
      if (b >= 0xf0) { pos++; break; }
      const z80ptr = rom[pos + 2] | (rom[pos + 3] << 8);
      channels.push({ id: b, z80ptr, romPtr: musicIsRomPtr(z80ptr) ? musicZ80toRom(z80ptr) : null });
      pos += 4;
    }
    return { channels, afterHeader: pos };
  }

  function musicDurationFrames(rom, selector) {
    const offset = 0x0fe44 + (Number(selector) & 0x3f);
    if (!rom || offset < 0 || offset >= rom.length) return null;
    const value = Number(rom[offset] || 0);
    return value > 0 ? value : null;
  }

  function musicNoteInfo(encoded) {
    const value = Number(encoded) & 0x7f;
    const low = value & 0x0f;
    const masked = value & 0x3f;
    const octave = (masked >> 4) & 0x03;
    const noteIndex = octave * 12 + low;
    if (low === 0x0c) return { kind: 'rest', noteIndex: null, label: 'REST' };
    if (low > 0x0b) return { kind: 'special_note', noteIndex, label: `special-${low.toString(16).toUpperCase()}` };
    return { kind: 'note', noteIndex, label: NOTE_NAMES[noteIndex % 12] + (Math.floor(noteIndex / 12) + 3) };
  }

  function musicNoteHzFromIndex(noteIndex) {
    if (noteIndex == null || !Number.isFinite(Number(noteIndex))) return 0;
    const midi = Number(noteIndex) + 48;
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function musicReadWordLE(rom, offset) {
    if (!rom || offset == null || offset < 0 || offset + 1 >= rom.length) return null;
    return rom[offset] | (rom[offset + 1] << 8);
  }

  function musicPsgPeriodFromIndex(rom, noteIndex) {
    const index = Number(noteIndex);
    if (!rom || !Number.isFinite(index)) return null;
    const pitchClass = ((index % 12) + 12) % 12;
    const octaveStep = Math.max(0, Math.floor(index / 12));
    const pointerEntry = 0x0ca85 + pitchClass * 2;
    const z80Pointer = musicReadWordLE(rom, pointerEntry);
    const rowOffset = musicIsRomPtr(z80Pointer) ? musicZ80toRom(z80Pointer) : null;
    if (rowOffset == null) return null;
    const rawWord = musicReadWordLE(rom, rowOffset);
    if (rawWord == null) return null;
    const period = (rawWord >>> octaveStep) & 0x03ff;
    return period > 0 ? period : null;
  }

  function musicPsgHzFromPeriod(period) {
    const value = Number(period);
    return Number.isFinite(value) && value > 0 ? 3579545 / (32 * value) : 0;
  }

  function musicPreviewHzFromIndex(rom, noteIndex) {
    const period = musicPsgPeriodFromIndex(rom, noteIndex);
    if (period) return musicPsgHzFromPeriod(period);
    return musicNoteHzFromIndex(noteIndex);
  }

  function musicOpcodeArgCount(byte) {
    return ({ 0xf0: 1, 0xf1: 2, 0xf2: 2, 0xf3: 1, 0xf4: 1, 0xf5: 1, 0xf6: 2, 0xf8: 1, 0xfa: 2 })[byte & 0xff] || 0;
  }

  function musicBuildTimelineForStream(rom, streamOffset, maxEvents) {
    const events = [];
    let pos = streamOffset;
    let frame = 0;
    let durationFrames = 6;
    const limit = maxEvents || 384;
    for (let guard = 0; guard < limit && pos != null && pos >= 0 && pos < rom.length; guard++) {
      const eventOffset = pos;
      const b = rom[pos];
      if (b >= 0xf0) {
        const argc = musicOpcodeArgCount(b);
        const opcode = `$${b.toString(16).toUpperCase().padStart(2, '0')}`;
        events.push({ kind: 'opcode', frameStart: frame, offset: eventOffset, opcode, argBytes: argc });
        pos += 1 + argc;
        if (b === 0xff || b === 0xf9 || b === 0xfa) break;
        continue;
      }
      if (b & 0x80) {
        const selector = b & 0x3f;
        const nextDuration = musicDurationFrames(rom, selector);
        if (nextDuration != null) durationFrames = nextDuration;
        events.push({ kind: 'duration_command', frameStart: frame, offset: eventOffset, selector, durationFrames });
        pos++;
        continue;
      }
      const note = musicNoteInfo(b);
      const event = {
        kind: note.kind,
        frameStart: frame,
        frameEnd: frame + Math.max(1, durationFrames),
        durationFrames: Math.max(1, durationFrames),
        offset: eventOffset,
        noteIndex: note.noteIndex,
        noteLabel: note.label,
      };
      events.push(event);
      frame = event.frameEnd;
      pos++;
    }
    return {
      events,
      playableEvents: events.filter(event => event.kind === 'note' || event.kind === 'rest' || event.kind === 'special_note'),
      frameCount: Math.max(1, frame),
    };
  }

  function musicBuildTimelineForSong(rom, song) {
    const parsed = musicParseHeader(rom, song.romOff);
    const sourceChannels = parsed.channels.filter(ch => ch.romPtr != null).slice(0, 4);
    const channels = sourceChannels.length ? sourceChannels : [{ id: 0, romPtr: parsed.afterHeader }];
    return channels.map((channel, index) => {
      const timeline = musicBuildTimelineForStream(rom, channel.romPtr, 512);
      return { channel, index, timeline };
    }).filter(item => item.timeline.playableEvents.length);
  }

  function stopAudioPreview() {
    if (currentPreviewPlayer) {
      currentPreviewPlayer.stop();
      currentPreviewPlayer = null;
    }
  }

  function createSimpleMusicPlayer(rom, song, statusEl) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return { play() { statusEl.textContent = 'NO AUDIO API'; }, stop() {} };
    const ctx = new AudioCtx();
    const states = musicBuildTimelineForSong(rom, song).map(item => ({
      channel: item.channel,
      events: item.timeline.playableEvents,
      frameCount: item.timeline.frameCount,
      currentIndex: -1,
    }));
    const voices = states.map((state, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 110 * Math.pow(2, index / 12);
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      return { osc, gain };
    });
    let timer = null;
    let frame = 0;

    function eventAtFrame(state, localFrame) {
      const events = state.events;
      if (!events.length) return null;
      let index = state.currentIndex >= 0 ? state.currentIndex : 0;
      while (index + 1 < events.length && events[index + 1].frameStart <= localFrame) index++;
      while (index > 0 && events[index].frameStart > localFrame) index--;
      state.currentIndex = index;
      const event = events[index];
      return event && localFrame >= event.frameStart && localFrame < event.frameEnd ? event : null;
    }

    return {
      play() {
        if (!states.length) {
          statusEl.textContent = 'NO PLAYABLE TIMELINE';
          return;
        }
        statusEl.textContent = 'PLAYING ROM PSG PITCH PREVIEW';
        timer = setInterval(() => {
          states.forEach((state, i) => {
            const localFrame = frame % Math.max(1, state.frameCount);
            const event = eventAtFrame(state, localFrame);
            if (!event || event.kind === 'rest') {
              voices[i].gain.gain.setTargetAtTime(0, ctx.currentTime, 0.01);
              return;
            }
            const hz = musicPreviewHzFromIndex(rom, event.noteIndex);
            if (!hz) {
              voices[i].gain.gain.setTargetAtTime(0, ctx.currentTime, 0.01);
              return;
            }
            voices[i].osc.frequency.setTargetAtTime(hz, ctx.currentTime, 0.004);
            voices[i].gain.gain.setTargetAtTime(0.055, ctx.currentTime, 0.01);
          });
          frame++;
        }, 1000 / 60);
      },
      stop() {
        if (timer) clearInterval(timer);
        voices.forEach(voice => {
          voice.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.01);
          voice.osc.stop(ctx.currentTime + 0.03);
        });
        setTimeout(() => ctx.close(), 80);
        statusEl.textContent = 'STOPPED';
      },
    };
  }

  function renderMusicControls(region, result) {
    if (!currentRom) return '<div class="line warn">Load the local ROM to listen.</div>';
    const songs = musicParseSongTable(currentRom);
    const defaultSong = Math.max(0, songs.findIndex(song => song.romOff != null && region && Math.abs(song.romOff - wb3DecoderParseOffset(region.offset)) < 32));
    setTimeout(() => {
      const select = $('music-song-select');
      const play = $('music-play');
      const stop = $('music-stop');
      const status = $('music-status');
      if (!select || !play || !stop || !status) return;
      play.addEventListener('click', () => {
        stopAudioPreview();
        const song = songs[Number(select.value)];
        if (!song || song.romOff == null) {
          status.textContent = 'NO ROM SONG';
          return;
        }
        currentPreviewPlayer = createSimpleMusicPlayer(currentRom, song, status);
        currentPreviewPlayer.play();
      });
      stop.addEventListener('click', stopAudioPreview);
    }, 0);
    const opts = songs.map(song => {
      const off = song.romOff == null ? 'RAM/unresolved' : wb3DecoderHex(song.romOff);
      return `<option value="${song.id}" ${song.id === defaultSong ? 'selected' : ''}>#${String(song.id).padStart(2, '0')} ${off}</option>`;
    }).join('');
    return `<div class="audio-box">
      <div class="line warn">Experimental timeline listener. It follows duration commands, note/rest events and stream control opcodes, and uses local ROM PSG pitch periods when available, but it is not exact PSG/FM playback yet.</div>
      <div class="toolbar compact">
        <select id="music-song-select">${opts}</select>
        <button class="btn mini" id="music-play">PLAY</button>
        <button class="btn mini" id="music-stop">STOP</button>
        <span id="music-status" class="dim">STOPPED</span>
      </div>
      <div class="line">${esc(result.summary)}</div>
    </div>`;
  }

  function renderMusicChannelLaneStateBlock(model) {
    if (!model) return '';
    const summary = model.summary || {};
    const laneRows = (model.lanes || []).slice(0, 48).map(lane => `<tr>
      <td><code>${esc(lane.requestIdHex || lane.requestId || '')}</code></td>
      <td>${esc(lane.channelIndex ?? '')}</td>
      <td><code>${esc(lane.channelIdHex || '')}</code></td>
      <td><code>${esc(lane.priorityHex || '')}</code></td>
      <td>${esc(lane.hardwareLaneCandidate || '')}<br><span class="dim">${esc(lane.hardwareLaneConfidence || '')}</span></td>
      <td><code>${esc(lane.streamOffset || '')}</code></td>
      <td>${esc(lane.frameCount || 0)}</td>
      <td>${esc(lane.noteSegmentCount || 0)}</td>
      <td>${esc(lane.restSegmentCount || 0)}</td>
      <td>${esc(lane.activeFrameCount || 0)}</td>
      <td>${esc(lane.restFrameCount || 0)}</td>
      <td>${esc(lane.noteRange || '')}</td>
      <td>${esc(lane.endReason || '')}</td>
    </tr>`).join('');
    const segmentRows = (model.lanes || []).flatMap(lane => (lane.segments || []).slice(0, 12).map(segment => ({ lane, segment }))).slice(0, 160).map(({ lane, segment }) => `<tr>
      <td><code>${esc(lane.requestIdHex || lane.requestId || '')}</code></td>
      <td>${esc(lane.channelIndex ?? '')}</td>
      <td><code>${esc(segment.offsetHex || '')}</code></td>
      <td>${esc(segment.frameStart ?? '')}</td>
      <td>${esc(segment.frameEnd ?? '')}</td>
      <td>${esc(segment.durationFrames ?? '')}</td>
      <td>${esc(segment.kind || '')}</td>
      <td>${esc(segment.noteLabel || '')}</td>
      <td>${esc(segment.noteIndex ?? '')}</td>
    </tr>`).join('');
    const opcodeRows = Object.entries(summary.opcodeCounts || {}).sort((a, b) => Number(b[1]) - Number(a[1]) || a[0].localeCompare(b[0])).slice(0, 24).map(([opcode, count]) => `<tr>
      <td><code>${esc(opcode)}</code></td>
      <td>${esc(count)}</td>
    </tr>`).join('');
    const durationRows = Object.entries(summary.durationSelectorCounts || {}).sort((a, b) => Number(a[0]) - Number(b[0])).slice(0, 24).map(([selector, count]) => `<tr>
      <td>${esc(selector)}</td>
      <td>${esc(count)}</td>
    </tr>`).join('');
    return `<div class="box-title" style="margin-top:10px">Music Channel Lane State</div>
      <div class="line">${esc(summary.laneCount || 0)} lane(s) · ${esc(summary.playableLaneCount || 0)} playable · ${esc(summary.noteSegmentCount || 0)} note segment(s) · ${esc(summary.restSegmentCount || 0)} rest segment(s) · exact PSG/FM lanes ${esc(summary.exactPsgFmStateLaneCount || 0)}.</div>
      <div class="line dim">${esc(model.semantics?.laneBoundary || '')}</div>
      <div class="line dim">${esc(model.assetPolicy || '')}</div>
      <div class="stats-grid">
        ${stat('Active Frames', summary.activeFrameCount || 0)}
        ${stat('Rest Frames', summary.restFrameCount || 0)}
        ${stat('Max Frames', summary.maxFrameCount || 0)}
        ${stat('Note Range', summary.noteRange || '')}
        ${stat('Duration Selectors', summary.durationSelectorCount || 0)}
        ${stat('Opcode Kinds', summary.opcodeKindCount || 0)}
        ${stat('Branch Targets', summary.branchTargetRefCount || 0)}
        ${stat('Note Labels', summary.noteLabelCount || 0)}
      </div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Request</th><th>Ch</th><th>Id</th><th>Priority</th><th>Lane Candidate</th><th>Stream</th><th>Frames</th><th>Notes</th><th>Rests</th><th>Active</th><th>Rest</th><th>Range</th><th>End</th></tr></thead>
        <tbody>${laneRows || '<tr><td colspan="13" class="dim">No lane state rows.</td></tr>'}</tbody>
      </table></div>
      <div class="box-title" style="margin-top:10px">Lane Segment Samples</div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Request</th><th>Ch</th><th>ROM</th><th>Frame</th><th>End</th><th>Dur</th><th>Kind</th><th>Note</th><th>Index</th></tr></thead>
        <tbody>${segmentRows || '<tr><td colspan="9" class="dim">No segment samples.</td></tr>'}</tbody>
      </table></div>
      <div class="box-title" style="margin-top:10px">Lane Opcode / Duration Summary</div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Opcode</th><th>Count</th></tr></thead>
        <tbody>${opcodeRows || '<tr><td colspan="2" class="dim">No opcode lanes.</td></tr>'}</tbody>
      </table></div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Duration Selector</th><th>Count</th></tr></thead>
        <tbody>${durationRows || '<tr><td colspan="2" class="dim">No duration selectors.</td></tr>'}</tbody>
      </table></div>`;
  }

  function renderMusicPitchDurationBindingBlock(model) {
    if (!model) return '';
    const summary = model.summary || {};
    const tableRows = (model.supportTables || []).map(table => `<tr>
      <td>${esc(table.role || table.id || '')}</td>
      <td><code>${esc(table.label || '')}</code></td>
      <td><code>${esc(table.z80AddressHex || '')}</code></td>
      <td><code>${esc(table.romOffsetHex || '')}</code></td>
      <td>${esc(table.entryCount || 0)}</td>
      <td>${esc(table.spanBytes || 0)}</td>
      <td>${table.availableInLocalRom ? 'yes' : 'no'}</td>
      <td>${esc(table.evidence || '')}</td>
    </tr>`).join('');
    const durationRows = (model.durationSelectors || []).slice(0, 64).map(row => `<tr>
      <td>${esc(row.selector ?? '')}</td>
      <td>${esc(row.count || 0)}</td>
      <td><code>${esc(row.lookupOffsetHex || '')}</code></td>
      <td>${row.resolvedByLocalRom ? 'yes' : 'no'}</td>
    </tr>`).join('');
    const pitchRows = (model.pitchClassBindings || []).slice(0, 16).map(row => `<tr>
      <td>${esc(row.pitchClass ?? '')}</td>
      <td>${esc(row.count || 0)}</td>
      <td><code>${esc(row.psgPointerEntryOffsetHex || '')}</code></td>
      <td>${row.psgPointerEntryResolved ? 'yes' : 'no'}</td>
      <td><code>${esc(row.psgRowOffsetHex || '')}</code></td>
      <td>${esc(row.psgRowWordCount || 0)}</td>
      <td><code>${esc(row.fmPointerEntryOffsetHex || '')}</code></td>
      <td>${row.fmPointerEntryResolved ? 'yes' : 'no'}</td>
      <td><code>${esc(row.fmRowOffsetHex || '')}</code></td>
      <td>${esc(row.fmRowWordCount || 0)}</td>
      <td>${row.exactPeriodResolved ? 'yes' : 'pending'}</td>
    </tr>`).join('');
    const noteRows = (model.noteBindings || []).slice(0, 80).map(row => `<tr>
      <td>${esc(row.noteIndex ?? '')}</td>
      <td>${esc(row.noteLabel || '')}</td>
      <td>${esc(row.count || 0)}</td>
      <td>${esc(row.pitchClass ?? '')}</td>
      <td>${esc(row.octaveStep ?? '')}</td>
      <td><code>${esc(row.psgWordOffsetHex || '')}</code></td>
      <td>${esc(row.psgTonePeriodCandidate ?? '')}</td>
      <td>${esc(row.psgFrequencyHzCandidate ?? '')}</td>
      <td><code>${esc(row.fmWordOffsetHex || '')}</code></td>
      <td><code>${esc(row.fmRegisterWordCandidateHex || '')}</code></td>
      <td>${row.exactPeriodResolved ? 'yes' : 'pending'}</td>
    </tr>`).join('');
    return `<div class="box-title" style="margin-top:10px">Music Pitch / Duration Binding</div>
      <div class="line">${esc(summary.noteIndexCount || 0)} note index(es) · ${esc(summary.pitchClassCount || 0)} pitch class(es) · ${esc(summary.octaveStepCount || 0)} octave step(s) · ${esc(summary.durationSelectorCount || 0)} duration selector(s) · base pitch candidates ${esc(summary.transientPitchValueCandidateCount || 0)} · exact period values ${esc(summary.exactPitchPeriodValueCount || 0)}.</div>
      <div class="line dim">${esc(model.semantics?.exactStateBoundary || '')}</div>
      <div class="line dim">${esc(model.assetPolicy || '')}</div>
      <div class="stats-grid">
        ${stat('Duration Resolved', `${summary.durationResolvedSelectorCount || 0}/${summary.durationSelectorCount || 0}`)}
        ${stat('PSG Pitch Entries', `${summary.psgPointerEntryResolvedCount || 0}/${summary.psgPointerEntryCandidateCount || 0}`)}
        ${stat('PSG Base Periods', summary.psgBasePeriodCandidateCount || 0)}
        ${stat('PSG Row Words', summary.psgPitchRowWordCandidateCount || 0)}
        ${stat('FM Pitch Entries', `${summary.fmPointerEntryResolvedCount || 0}/${summary.fmPointerEntryCandidateCount || 0}`)}
        ${stat('FM Base Words', summary.fmBaseRegisterWordCandidateCount || 0)}
        ${stat('FM Row Words', summary.fmPitchRowWordCandidateCount || 0)}
        ${stat('Exact PSG/FM Ready', summary.exactPsgFmStateReady ? 'yes' : 'no')}
      </div>
      <div class="box-title" style="margin-top:10px">Support Tables</div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Role</th><th>Label</th><th>Z80</th><th>ROM</th><th>Entries</th><th>Span</th><th>Local</th><th>Evidence</th></tr></thead>
        <tbody>${tableRows || '<tr><td colspan="8" class="dim">No support table metadata.</td></tr>'}</tbody>
      </table></div>
      <div class="box-title" style="margin-top:10px">Duration Selector Binding</div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Selector</th><th>Count</th><th>Lookup ROM</th><th>Resolved</th></tr></thead>
        <tbody>${durationRows || '<tr><td colspan="4" class="dim">No duration selectors.</td></tr>'}</tbody>
      </table></div>
      <div class="box-title" style="margin-top:10px">Pitch Class Binding</div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Class</th><th>Count</th><th>PSG Entry</th><th>PSG</th><th>PSG Row</th><th>Words</th><th>FM Entry</th><th>FM</th><th>FM Row</th><th>Words</th><th>Period</th></tr></thead>
        <tbody>${pitchRows || '<tr><td colspan="11" class="dim">No pitch class bindings.</td></tr>'}</tbody>
      </table></div>
      <div class="box-title" style="margin-top:10px">Note Binding Samples</div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Index</th><th>Note</th><th>Count</th><th>Class</th><th>Octave</th><th>PSG Word</th><th>PSG Period</th><th>Hz</th><th>FM Word</th><th>FM Reg</th><th>Exact</th></tr></thead>
        <tbody>${noteRows || '<tr><td colspan="11" class="dim">No note bindings.</td></tr>'}</tbody>
      </table></div>`;
  }

  function renderMusicOpcodeParameterStateBlock(model) {
    if (!model) return '';
    const summary = model.summary || {};
    const effectRows = Object.entries(summary.effectKindCounts || {}).sort((a, b) => Number(b[1]) - Number(a[1]) || a[0].localeCompare(b[0])).slice(0, 24).map(([kind, count]) => `<tr>
      <td>${esc(kind)}</td>
      <td>${esc(count)}</td>
    </tr>`).join('');
    const mutationRows = Object.entries(summary.mutationKindCounts || {}).sort((a, b) => Number(b[1]) - Number(a[1]) || a[0].localeCompare(b[0])).slice(0, 24).map(([kind, count]) => `<tr>
      <td>${esc(kind)}</td>
      <td>${esc(count)}</td>
    </tr>`).join('');
    const laneRows = (model.lanes || []).slice(0, 64).map(lane => `<tr>
      <td><code>${esc(lane.requestIdHex || lane.requestId || '')}</code></td>
      <td>${esc(lane.channelIndex ?? '')}</td>
      <td><code>${esc(lane.channelIdHex || '')}</code></td>
      <td><code>${esc(lane.streamOffset || '')}</code></td>
      <td>${esc(lane.opcodeEventCount || 0)}</td>
      <td>${esc(lane.potentialPitchOrEnvelopeMutationCount || 0)}</td>
      <td>${lane.instrumentOrEffectIdSeen ? 'yes' : 'no'}</td>
      <td>${lane.parameterPairSeen ? 'yes' : 'no'}</td>
      <td>${lane.singleParameterSeen ? 'yes' : 'no'}</td>
      <td>${lane.supportTableLoadSeen ? 'yes' : 'no'}</td>
      <td>${lane.repeatControlSeen ? 'yes' : 'no'}</td>
      <td>${lane.pointerControlSeen ? 'yes' : 'no'}</td>
      <td>${lane.exactTargetFieldsResolved ? 'yes' : 'pending'}</td>
    </tr>`).join('');
    const changeRows = (model.lanes || []).flatMap(lane => (lane.changes || []).slice(0, 12).map(change => ({ lane, change }))).slice(0, 160).map(({ lane, change }) => `<tr>
      <td><code>${esc(lane.requestIdHex || lane.requestId || '')}</code></td>
      <td>${esc(lane.channelIndex ?? '')}</td>
      <td>${esc(change.frameStart ?? '')}</td>
      <td><code>${esc(change.offsetHex || '')}</code></td>
      <td><code>${esc(change.opcode || '')}</code></td>
      <td>${esc(change.effectKind || '')}</td>
      <td>${esc(change.mutationKind || '')}</td>
      <td>${esc((change.operandHex || []).join(' '))}</td>
      <td><code>${esc(change.targetRomOffsetHex || '')}</code></td>
      <td>${change.exactTargetFieldResolved ? 'yes' : 'pending'}</td>
    </tr>`).join('');
    return `<div class="box-title" style="margin-top:10px">Music Opcode Parameter State</div>
      <div class="line">${esc(summary.opcodeEventCount || 0)} opcode event(s) · ${esc(summary.parameterMutationEventCount || 0)} parameter mutation(s) · ${esc(summary.potentialPitchOrEnvelopeMutationEventCount || 0)} potential pitch/envelope mutation(s) · exact target fields ${esc(summary.exactParameterTargetFieldCount || 0)}.</div>
      <div class="line dim">${esc(model.semantics?.parameterBoundary || '')}</div>
      <div class="line dim">${esc(model.assetPolicy || '')}</div>
      <div class="stats-grid">
        ${stat('Operand Opcodes', summary.operandBearingOpcodeEventCount || 0)}
        ${stat('Operand Bytes', summary.operandByteCount || 0)}
        ${stat('Instrument Selects', summary.instrumentOrEffectSelectEventCount || 0)}
        ${stat('Repeat Control', summary.repeatControlEventCount || 0)}
        ${stat('Pointer Control', summary.pointerControlEventCount || 0)}
        ${stat('Exact Frame State', summary.exactFramePsgFmStateReady ? 'yes' : 'no')}
      </div>
      <div class="box-title" style="margin-top:10px">Opcode Effect Summary</div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Effect</th><th>Count</th></tr></thead>
        <tbody>${effectRows || '<tr><td colspan="2" class="dim">No opcode effects.</td></tr>'}</tbody>
      </table></div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Mutation</th><th>Count</th></tr></thead>
        <tbody>${mutationRows || '<tr><td colspan="2" class="dim">No mutation kinds.</td></tr>'}</tbody>
      </table></div>
      <div class="box-title" style="margin-top:10px">Opcode Parameter Lanes</div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Request</th><th>Ch</th><th>Id</th><th>Stream</th><th>Opcodes</th><th>Pitch/Env</th><th>Inst</th><th>Pair</th><th>Single</th><th>Indexed</th><th>Repeat</th><th>Pointer</th><th>Exact</th></tr></thead>
        <tbody>${laneRows || '<tr><td colspan="13" class="dim">No opcode parameter lanes.</td></tr>'}</tbody>
      </table></div>
      <div class="box-title" style="margin-top:10px">Opcode Parameter Change Samples</div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Request</th><th>Ch</th><th>Frame</th><th>ROM</th><th>Opcode</th><th>Effect</th><th>Mutation</th><th>Operands</th><th>Target</th><th>Exact</th></tr></thead>
        <tbody>${changeRows || '<tr><td colspan="10" class="dim">No opcode parameter changes.</td></tr>'}</tbody>
      </table></div>`;
  }

  function renderAudioRuntimeOutputModelBlock(model) {
    if (!model) return '';
    const sink = model.sink?.summary || {};
    const frame = model.frameTimeline?.summary || {};
    const register = model.registerIntent?.summary || {};
    const channel = model.channelPortIntent?.summary || {};
    const validation = model.validation || {};
    const frameRows = (model.frameTimeline?.frames || []).slice(0, 24).map(row => `<tr>
      <td>${esc(row.frameKey || (row.frame ?? ''))}</td>
      <td>${esc(row.eventCount || 0)}</td>
      <td>${esc(row.writeEventCount || 0)}</td>
      <td>${esc(row.psgWriteEventCount || 0)}</td>
      <td>${esc(row.fmWriteEventCount || 0)}</td>
      <td>${esc(Object.entries(row.portCounts || {}).map(([port, count]) => `${port}:${count}`).join(', '))}</td>
      <td>${esc((row.phaseFixtureIds || []).slice(0, 3).join(', '))}</td>
    </tr>`).join('');
    const groupRows = (model.channelPortIntent?.groups || []).slice(0, 32).map(row => `<tr>
      <td>${esc(row.frameKey || (row.frame ?? ''))}</td>
      <td>${esc(row.activeChannel || '')}</td>
      <td>${esc(row.chip || '')}</td>
      <td>${esc(row.port || '')}</td>
      <td>${esc(row.phaseKind || '')}</td>
      <td>${esc(row.branchId || '')}</td>
      <td>${esc(row.writeEventCount || 0)}</td>
      <td>${esc((row.writeFixtureIds || []).slice(0, 3).join(', '))}</td>
    </tr>`).join('');
    const intentRows = Object.entries(register.intentKindCounts || {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([kind, count]) => `<tr>
      <td>${esc(kind)}</td>
      <td>${esc(count)}</td>
    </tr>`).join('');
    const validationRows = (validation.issues || []).map(issue => `<tr><td>${esc(issue)}</td></tr>`).join('');
    return `<div class="box-title" style="margin-top:10px">Runtime Output Event Model</div>
      <div class="line">${validation.readyForRuntimeHarness ? 'Ready' : 'Not ready'} · contract <code>${esc(model.eventContract?.catalogId || '')}</code> · ${esc(sink.eventCount || 0)} event(s), ${esc(sink.phaseEventCount || 0)} phase and ${esc(sink.writeEventCount || 0)} write fixture event(s).</div>
      <div class="line dim">${esc(model.assetPolicy || '')}</div>
      <div class="stats-grid">
        ${stat('Frames', frame.frameCount || 0)}
        ${stat('Register Intents', register.frameCount || 0)}
        ${stat('Channel/Port Groups', channel.groupCount || 0)}
        ${stat('PSG / FM Writes', `${channel.psgWriteEventCount || 0} / ${channel.fmWriteEventCount || 0}`)}
        ${stat('Port Kinds', channel.portKindCount || frame.portKindCount || 0)}
        ${stat('Validation Issues', validation.validationIssueCount || 0)}
      </div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Intent Kind</th><th>Frames</th></tr></thead>
        <tbody>${intentRows || '<tr><td colspan="2" class="dim">No register-intent rows.</td></tr>'}</tbody>
      </table></div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Frame</th><th>Events</th><th>Writes</th><th>PSG Writes</th><th>FM Writes</th><th>Ports</th><th>Phases</th></tr></thead>
        <tbody>${frameRows || '<tr><td colspan="7" class="dim">No output frame rows.</td></tr>'}</tbody>
      </table></div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Frame</th><th>Channel</th><th>Chip</th><th>Port</th><th>Kind</th><th>Branch</th><th>Writes</th><th>Fixtures</th></tr></thead>
        <tbody>${groupRows || '<tr><td colspan="8" class="dim">No channel/port intent groups.</td></tr>'}</tbody>
      </table></div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Validation</th></tr></thead>
        <tbody>${validationRows || '<tr><td class="dim">No runtime output validation issues.</td></tr>'}</tbody>
      </table></div>`;
  }

  function renderReconstructionChecklistBlock(preview) {
    const items = preview?.aggregate?.reconstructionChecklist || [];
    if (!items.length) return '';
    const counts = preview.aggregate?.reconstructionProofCounts || {};
    const targetModule = preview.aggregate?.reconstructionTargetModule || '';
    const rows = items.map(item => {
      const cls = item.status === 'ready' ? 'ok' : (item.status === 'warning' ? 'progress' : 'warn');
      return `<tr>
        <td>${esc(item.label || item.key || '')}<br><code>${esc(item.key || '')}</code></td>
        <td>${pill(String(item.status || 'missing').toUpperCase(), cls)}</td>
        <td>${esc(item.evidence || '')}</td>
        <td><code>${esc(item.targetModule || targetModule || '')}</code></td>
        <td>${esc(item.nextStep || '')}</td>
      </tr>`;
    }).join('');
    return `<div class="box-title" style="margin-top:10px">Routine Reconstruction Checklist</div>
      <div class="line">Target <code>${esc(targetModule || 'unassigned')}</code> · ready ${esc(counts.ready || 0)} · warning ${esc(counts.warning || 0)} · missing ${esc(counts.missing || 0)}.</div>
      <div class="line dim">Metadata-only checklist: evidence counts, labels, module targets and next steps. No ROM bytes, RAM dumps or traces are persisted.</div>
      <div class="table-wrap"><table class="asset-table">
        <thead><tr><th>Proof</th><th>Status</th><th>Evidence</th><th>Target</th><th>Next Step</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  }

  function renderPreview(assetId, decoderId) {
    stopAudioPreview();
    let asset = currentAssets.find(item => item.id === assetId);
    let region = asset ? regionForAsset(asset) : null;
    if (!asset && String(assetId || '').startsWith('region:')) {
      region = currentRegionIndex.get(String(assetId).slice('region:'.length)) || null;
      if (region) asset = regionPreviewAsset(region, decoderById(decoderId));
    }
    if (!asset) return;
    const decoder = wb3PreferredDecoderForAsset(asset, region, decoderId) || wb3PreferredDecoderForAsset(asset, region);
    const body = $('preview-body');
    const result = wb3DecodeAsset(asset, currentRom, currentMap, {
      decoderId: decoder?.id,
      includeTransientPreview: true,
      previewTileLimit: 96,
      paletteCount: 32,
      pointerPreviewLimit: 40,
      loaderPreviewLimit: 512,
      entityAnimCommandPreviewLimit: 128,
      entityAnimTablePreviewLimit: 128,
      paletteScriptCommandPreviewLimit: 180,
      paletteScriptWritePreviewLimit: 180,
      paletteScriptSegmentPreviewLimit: 96,
      paletteScriptTablePreviewLimit: 96,
      roomDescriptorPreviewLimit: 160,
      roomSubrecordPreviewLimit: 160,
      roomEdgePreviewLimit: 32,
      roomEntityListPreviewLimit: 120,
      roomEntityRecordPreviewLimit: 64,
      maxRoomEntityRecords: 128,
      entityBehaviorTablePreviewLimit: 128,
      collisionAnalysisPreviewLimit: 80,
      collisionCatalogEntryPreviewLimit: 180,
      uiAnalysisPreviewLimit: 80,
      uiCatalogEntryPreviewLimit: 160,
      uiTableRecordPreviewLimit: 96,
      audioDriverAnalysisPreviewLimit: 90,
      audioDriverCatalogEntryPreviewLimit: 180,
    });
    const head = `<div class="preview-title">${esc(asset.name || asset.id)}</div>
      <div class="line"><code>${esc(asset.id)}</code></div>
      <div class="line">Kind ${esc(asset.kind)} · decoder ${esc(decoder?.label || 'none')} · status ${esc(result.status)}</div>
      <div class="line">${region ? `Region <code>${esc(region.id)}</code> ${esc(region.type)} ${esc(region.offset || '')} ${esc(region.size || 0)}b` : 'No ROM region for this asset.'}</div>
      <div class="line">${esc(result.summary)}</div>
      ${result.warnings.length ? `<div class="line warn">${esc(result.warnings.join(' · '))}</div>` : ''}`;

    if (!currentRom && region && result.status === 'needs_rom') {
      body.innerHTML = head + '<div class="empty">Load your local ROM above to run this decoder preview.</div>';
      return;
    }

    body.innerHTML = head + '<div id="preview-extra"></div>';
    const extra = $('preview-extra');
    const preview = result.transientPreview;
    if (!preview) {
      extra.innerHTML = result.status === 'metadata_only'
        ? '<div class="line">Metadata-only item. This helps label and group the ROM, but it has no direct visual/audio preview.</div>'
        : '<div class="line dim">No live preview registered for this decoder yet.</div>';
      return;
    }
    if (preview.kind === 'palette_swatches') {
      extra.innerHTML = renderPalettePreview(preview, result);
      return;
    }
    if (preview.kind === 'tile_canvas') {
      extra.innerHTML = renderTileCanvasPreview(preview, result);
      drawTileGrid($('asset-preview-canvas'), currentRom, preview.offset, preview.tileCount, TILE_PREVIEW_COLORS);
      return;
    }
	    if (preview.kind === 'screen_prog_cells') {
	      extra.innerHTML = renderScreenProgPreview(preview, result);
	      drawScreenProgHeatmap($('asset-preview-canvas'), preview.cells, preview.cols, preview.rows);
	      return;
	    }
    if (preview.kind === 'screen_prog_table') {
      extra.innerHTML = renderScreenProgTablePreview(preview, result);
      return;
    }
    if (preview.kind === 'dc2_tile_map_stream') {
      extra.innerHTML = renderDc2TileMapPreview(preview, result);
      return;
    }
    if (preview.kind === 'dynamic_tile_loader_layout') {
      extra.innerHTML = renderDynamicTileLoaderPreview(preview, result);
      return;
    }
    if (preview.kind === 'tile_map_catalog_layout') {
      extra.innerHTML = renderTileMapCatalogPreview(preview, result);
      return;
    }
	    if (preview.kind === 'tile_map_layout') {
	      const dimRows = (preview.dimensions || []).slice(0, 6).map(dim => `<tr>
	        <td>${dim.cols}x${dim.rows}</td>
	        <td>${esc(dim.reason || '')}</td>
	      </tr>`).join('');
      const diagnosticRows = (preview.diagnostics || []).map(item => `<tr><td>${esc(item)}</td></tr>`).join('');
	      extra.innerHTML = `<canvas class="preview-canvas" id="asset-preview-canvas"></canvas>
	        <div class="line dim">Structural tile-id heatmap. Exact render still needs the owning tileset/palette route.</div>
	        <div class="line">Layout ${esc(preview.layoutKind)} · showing ${preview.entries.length}/${preview.entryCount} entries · primary ${preview.cols}x${preview.rows}</div>
	        <div class="table-wrap"><table class="asset-table">
	          <thead><tr><th>Candidate Layout</th><th>Reason</th></tr></thead>
	          <tbody>${dimRows}</tbody>
	        </table></div>
        <div class="subhead">Diagnostics</div>
        <div class="table-wrap"><table class="asset-table">
          <tbody>${diagnosticRows || '<tr><td class="dim">No structural diagnostics.</td></tr>'}</tbody>
        </table></div>
        <div class="subhead">Analysis</div>
        ${renderAnalysisEntriesTable(preview.analysisEntries, 'No tile-map analysis entries.')}`;
	      drawTileMapHeatmap($('asset-preview-canvas'), preview.entries, preview.cols, preview.rows);
	      return;
	    }
    if (preview.kind === 'vram_loader_entries') {
      extra.innerHTML = renderVramLoaderPreview(preview, result);
      drawLoaderCanvas($('asset-preview-canvas'), preview.entries);
      return;
    }
    if (preview.kind === 'palette_script_table') {
      const rows = (preview.entries || []).map(entry => `<tr>
        <td>${entry.index}</td>
        <td><code>${esc(entry.entryOffsetHex)}</code></td>
        <td><code>${esc(entry.z80PointerHex || '')}</code></td>
        <td>${entry.romOffsetHex ? `<code>${esc(entry.romOffsetHex)}</code>` : '<span class="dim">unresolved</span>'}</td>
        <td>${entry.region ? `<code>${esc(entry.region.id)}</code> ${esc(entry.region.type || '')}` : '<span class="dim">none</span>'}</td>
      </tr>`).join('');
      extra.innerHTML = `<div class="line">${preview.entryCount} entries · ${preview.validBank7Pointers} bank-7 script pointer(s)</div>
        <div class="line">Evidence: ${esc(preview.semantics.routine)} · table ${esc(preview.semantics.tableLabel)} · index ${esc(preview.semantics.indexRam)} · pointer ${esc(preview.semantics.activePointerRam)} · delay ${esc(preview.semantics.delayRam)}</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>#</th><th>Entry ROM</th><th>Z80 Ptr</th><th>ROM Target</th><th>Target Region</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5" class="dim">No entries.</td></tr>'}</tbody>
        </table></div>`;
      return;
    }
    if (preview.kind === 'palette_script') {
      const segmentRows = (preview.segments || []).map(segment => `<tr>
        <td>${segment.index}</td>
        <td>${segment.startFrame}-${segment.endFrame}</td>
        <td>${segment.delayAfter}</td>
        <td>${segment.writeCount}</td>
        <td>${segment.jumpCount}</td>
        <td>${esc(segment.reason || '')}</td>
      </tr>`).join('');
      const commandRows = (preview.commands || []).map(command => `<tr>
        <td>${command.index}</td>
        <td><code>${esc(command.offsetHex)}</code></td>
        <td>${esc(command.kind)}</td>
        <td><code>${esc(command.commandHex || '')}</code></td>
        <td>${command.valueHex ? `<code>${esc(command.valueHex)}</code>` : '<span class="dim">-</span>'}</td>
        <td>${command.dest ? `<code>${esc(command.dest)}</code>` : '<span class="dim">-</span>'}</td>
        <td>${command.slot ?? '<span class="dim">-</span>'}</td>
        <td>${command.delayAfter ?? 0}</td>
        <td>${command.romOffsetHex ? `<code>${esc(command.romOffsetHex)}</code>` : (command.z80PointerHex ? `<code>${esc(command.z80PointerHex)}</code>` : '<span class="dim">-</span>')}</td>
      </tr>`).join('');
      const jumpRows = (preview.jumps || []).map(jump => `<tr>
        <td>${jump.index}</td>
        <td><code>${esc(jump.commandOffsetHex)}</code></td>
        <td><code>${esc(jump.z80PointerHex)}</code></td>
        <td>${jump.romOffsetHex ? `<code>${esc(jump.romOffsetHex)}</code>` : '<span class="dim">unresolved</span>'}</td>
        <td>${jump.region ? `<code>${esc(jump.region.id)}</code> ${esc(jump.region.type || '')}` : '<span class="dim">none</span>'}</td>
        <td>${jump.targetAlreadyVisited ? 'loop' : 'forward'}</td>
      </tr>`).join('');
      const startRows = (preview.scriptStarts || []).slice(0, 32).map(start => `<tr>
        <td>${start.index == null ? '<span class="dim">region</span>' : start.index}</td>
        <td><code>${esc(start.offsetHex)}</code></td>
        <td>${start.pointer ? `<code>${esc(start.pointer)}</code>` : '<span class="dim">-</span>'}</td>
        <td>${esc(start.catalogEndReason || '')}</td>
        <td>${start.directIndexWriteCount}</td>
      </tr>`).join('');
      extra.innerHTML = `<canvas class="preview-canvas" id="asset-preview-canvas"></canvas>
        <div class="line">Script <code>${esc(preview.selectedScriptOffsetHex)}</code> · ${preview.stats.writeCount} write(s) · ${preview.stats.segmentCount} segment(s) · termination ${esc(preview.termination.kind)}</div>
        <div class="line">Evidence: ${esc(preview.semantics.routine)} writes ${esc(preview.semantics.slotMask)} into ${esc(preview.semantics.destinationSelect)}; ${esc(preview.semantics.jumpOpcode)}; ${esc(preview.semantics.endOpcode)} ends.</div>
        <div class="line dim">Swatches are transient values from your local ROM interpreted as SMS CRAM bytes in the two RAM palette buffers. Exact CRAM commit timing is still pending.</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Segment</th><th>Frames</th><th>Delay</th><th>Writes</th><th>Jumps</th><th>Reason</th></tr></thead>
          <tbody>${segmentRows || '<tr><td colspan="6" class="dim">No runtime segments decoded.</td></tr>'}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Commands</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>#</th><th>ROM</th><th>Kind</th><th>Cmd</th><th>Value</th><th>Dest</th><th>Slot</th><th>Delay</th><th>Target</th></tr></thead>
          <tbody>${commandRows || '<tr><td colspan="9" class="dim">No commands decoded.</td></tr>'}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Jumps</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>#</th><th>ROM</th><th>Z80 Ptr</th><th>ROM Target</th><th>Region</th><th>Shape</th></tr></thead>
          <tbody>${jumpRows || '<tr><td colspan="6" class="dim">No jumps.</td></tr>'}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Known Starts In Region</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Index</th><th>ROM</th><th>Pointer</th><th>Catalog End</th><th>Direct Uses</th></tr></thead>
          <tbody>${startRows || '<tr><td colspan="5" class="dim">No cataloged starts.</td></tr>'}</tbody>
        </table></div>`;
      drawPaletteScriptBuffers($('asset-preview-canvas'), preview);
      return;
    }
    if (preview.kind === 'palette_vdp_stream_model') {
      extra.innerHTML = renderPaletteVdpStreamModel(preview, result);
      return;
    }
	    if (preview.kind === 'palette_vdp_stream_probe') {
      const catalogRows = (preview.catalogIds || []).map(id => `<tr><td><code>${esc(id)}</code></td></tr>`).join('');
      extra.innerHTML = `<div class="line warn">Structural probe only. Exact VDP/effect opcodes are not implemented yet.</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Metric</th><th>Value</th></tr></thead>
          <tbody>
            <tr><td>Region type</td><td>${esc(preview.regionType)}</td></tr>
            <tr><td>Bytes scanned</td><td>${esc(preview.stats.size)}</td></tr>
            <tr><td>Distinct byte values</td><td>${esc(preview.stats.distinctByteCount)}</td></tr>
            <tr><td>Zero bytes</td><td>${esc(preview.stats.zeroBytes)}</td></tr>
            <tr><td>0xFF bytes</td><td>${esc(preview.stats.ffBytes)}</td></tr>
            <tr><td>High-bit bytes</td><td>${esc(preview.stats.highBitBytes)}</td></tr>
          </tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Related Catalogs</div>
        <div class="table-wrap"><table class="asset-table">
          <tbody>${catalogRows || '<tr><td class="dim">No related catalog ids.</td></tr>'}</tbody>
        </table></div>`;
      return;
    }
    if (preview.kind === 'bank2_timed_effect_script') {
      const recordRows = (preview.records || []).map(record => `<tr>
        <td>${esc(record.index)}</td>
        <td><code>${esc(record.controlOffsetHex)}</code></td>
        <td>${esc(record.frameStart)}-${esc(record.frameEnd)}</td>
        <td>${esc(record.durationFrames)}</td>
        <td><code>${esc(record.controlHex)}</code></td>
        <td><code>${esc(record.cf95Hex)}</code></td>
        <td><code>${esc(record.d279Hex)}</code></td>
        <td><code>${esc(record.nextDelayHex)}</code></td>
        <td>${record.terminatesAfterRecord ? pill('END', 'warn') : ''}</td>
      </tr>`).join('');
      const statRows = [
        ['Initial delay', preview.initialDelayHex || ''],
        ['Records', preview.stats?.recordCount ?? ''],
        ['Frames', preview.stats?.frameCount ?? ''],
        ['Consumed bytes', preview.stats?.consumedBytes ?? ''],
        ['Distinct _RAM_CF95_', preview.stats?.distinctCf95Count ?? ''],
        ['Distinct _RAM_D279_', preview.stats?.distinctD279Count ?? ''],
        ['Distinct durations', preview.stats?.distinctDurationCount ?? ''],
        ['Max duration', preview.stats?.maxDurationFrames ?? ''],
        ['Termination', preview.termination?.kind || ''],
      ].map(([label, value]) => `<tr><td>${esc(label)}</td><td>${esc(value)}</td></tr>`).join('');
      const catalog = preview.catalogEntry || {};
      extra.innerHTML = `<canvas class="preview-canvas" id="timed-effect-canvas"></canvas>
        <div class="line">Timed effect stream <code>${esc(preview.selectedScriptOffsetHex)}</code> · ${esc(preview.stats.recordCount)} record(s) · ${esc(preview.stats.frameCount)} frame(s) · termination ${esc(preview.termination.kind)}</div>
        <div class="line">Evidence: ${esc(preview.semantics.initializer)} ${esc(preview.semantics.updater)}</div>
        <div class="line dim">${esc(preview.semantics.assetPolicy)}</div>
        ${catalog.summary ? `<div class="line">Catalog: ${esc(catalog.summary)}</div>` : ''}
        <div class="table-wrap"><table class="asset-table">
          <tbody>${statRows}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Timed Records</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>#</th><th>Control ROM</th><th>Frames</th><th>Delay</th><th>Control</th><th>_RAM_CF95_</th><th>_RAM_D279_</th><th>Next Delay</th><th>End</th></tr></thead>
          <tbody>${recordRows || '<tr><td colspan="9" class="dim">No effect records decoded.</td></tr>'}</tbody>
        </table></div>`;
      drawTimedEffectTimeline($('timed-effect-canvas'), preview.records || []);
      return;
    }
    if (preview.kind === 'room_descriptor') {
      const d = preview.descriptor || {};
      const s = d.subrecord || {};
      const fieldRows = [
        ['Descriptor ROM', d.offsetHex],
        ['Scroll X', d.scroll?.x?.keep ? 'keep' : `${d.scroll?.x?.raw || ''} / ${d.scroll?.x?.pixels ?? ''}px`],
        ['Scroll Y', d.scroll?.y?.keep ? 'keep' : d.scroll?.y?.raw],
        ['Camera X', d.camera?.x?.keep ? 'keep' : `${d.camera?.x?.raw || ''} / ${d.camera?.x?.pixels ?? ''}px`],
        ['Camera Y', d.camera?.y?.keep ? 'keep' : `${d.camera?.y?.raw || ''} / ${d.camera?.y?.pixels ?? ''}px`],
        ['Subrecord', d.subrecordPointer?.romOffsetHex || 'unresolved'],
        ['Trigger Table', s.triggerTable?.romOffsetHex || 'unresolved'],
        ['Trigger Records', s.triggerTable?.preview?.recordCount ?? ''],
        ['Event Table', s.eventTable?.romOffsetHex || 'unresolved'],
        ['Event Records', s.eventTable?.preview?.recordCount ?? ''],
        ['Entity List', s.entityList?.romOffsetHex || 'unresolved'],
        ['8FB Loader', s.vramLoader8fb?.romOffsetHex || 'unresolved'],
        ['DC2 Active Prefix', s.activeDc2PrefixCount ?? ''],
        ['BG Palette', s.bgPaletteIndex ?? ''],
        ['Palette Script Index', s.paletteScriptIndexHex || ''],
        ['Overlay Index', s.overlayIndexHex || ''],
        ['Audio Request', s.audioRequestIdHex || ''],
        ['Extra 998', s.extra998?.status ? `${s.extra998.status} ${s.extra998.regionId || ''}` : ''],
      ].map(([label, value]) => `<tr><td>${esc(label)}</td><td>${String(value).startsWith('0x') ? `<code>${esc(value)}</code>` : esc(value)}</td></tr>`).join('');
      const dc2Rows = (s.dc2Indices || []).map(item => `<tr>
        <td>${item.slot}</td>
        <td><code>${esc(item.indexHex)}</code></td>
        <td>${item.disabled ? 'disabled' : 'active'}</td>
      </tr>`).join('');
      const edgeRows = (d.outgoingEdges || []).map(edge => `<tr>
        <td>${edge.doorIndex}</td>
        <td>${esc(edge.roomType ?? '')}</td>
        <td>${esc(edge.scrollPositionPixels ?? '')}</td>
        <td>${edge.destinationRomOffset ? `<code>${esc(edge.destinationRomOffset)}</code>` : '<span class="dim">unresolved</span>'}</td>
        <td>${edge.destinationValid ? 'yes' : 'no'}</td>
      </tr>`).join('');
      const triggerRows = (s.triggerTable?.preview?.records || []).map(record => `<tr>
        <td>${record.index}</td>
        <td><code>${esc(record.offsetHex)}</code></td>
        <td>${esc(record.scrollPositionPixels ?? '')}</td>
        <td>${esc(record.xSpanPixels ?? '')}</td>
        <td><code>${esc(record.triggerOpcodeHex)}</code><br><span class="dim">${esc(record.dispatch?.role || '')}</span></td>
        <td>${record.destinationRomHex ? `<code>${esc(record.destinationRomHex)}</code>` : '<span class="dim">unresolved</span>'}</td>
        <td>${esc(record.destinationStatus || '')}</td>
      </tr>`).join('');
      const eventRows = (s.eventTable?.preview?.records || []).map(record => `<tr>
        <td>${record.index}</td>
        <td><code>${esc(record.offsetHex)}</code></td>
        <td><code>${esc(record.keyXHex)}</code> / <code>${esc(record.keyYHex)}</code></td>
        <td><code>${esc(record.selectorHex)}</code></td>
        <td>${esc(record.selectorRole || '')}</td>
        <td>${record.payloadWordHex ? `<code>${esc(record.payloadWordHex)}</code> · <code>${esc(record.payloadByteHex || '')}</code>` : '<span class="dim">none</span>'}</td>
      </tr>`).join('');
      extra.innerHTML = `<canvas class="preview-canvas" id="asset-preview-canvas"></canvas>
        <div class="line">Evidence: ${esc(preview.semantics.loaderRoutine)} descriptor -> ${esc(preview.semantics.subrecordRoutine)} subrecord. ${esc(preview.semantics.descriptorShape)}.</div>
        <div class="line dim">Trigger and event rows are decoded from the local ROM in memory and are not persisted.</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Field</th><th>Value</th></tr></thead>
          <tbody>${fieldRows}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">DC2 Stream Slots</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Slot</th><th>Index</th><th>Status</th></tr></thead>
          <tbody>${dc2Rows || '<tr><td colspan="3" class="dim">No DC2 slots.</td></tr>'}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Outgoing Graph Edges</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Door</th><th>Type</th><th>Scroll px</th><th>Destination</th><th>Valid</th></tr></thead>
          <tbody>${edgeRows || '<tr><td colspan="5" class="dim">No outgoing edges in preview.</td></tr>'}</tbody>
        </table></div>`;
      extra.innerHTML += `
        <div class="box-title" style="margin-top:10px">Trigger / Door Records</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>#</th><th>ROM</th><th>X px</th><th>Width px</th><th>Opcode</th><th>Destination</th><th>Status</th></tr></thead>
          <tbody>${triggerRows || '<tr><td colspan="7" class="dim">No trigger records decoded.</td></tr>'}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Room Event Records</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>#</th><th>ROM</th><th>Key X/Y</th><th>Selector</th><th>Role</th><th>Payload</th></tr></thead>
          <tbody>${eventRows || '<tr><td colspan="6" class="dim">No event records decoded.</td></tr>'}</tbody>
        </table></div>`;
      drawRoomDescriptorGrid($('asset-preview-canvas'), preview);
      return;
    }
    if (preview.kind === 'room_descriptor_graph_region') {
      const descriptorRows = (preview.descriptors || []).map(descriptor => `<tr>
        <td><code>${esc(descriptor.offsetHex)}</code></td>
        <td>${descriptor.graphBacked ? 'yes' : 'probe'}</td>
        <td>${descriptor.subrecordPointer?.romOffsetHex ? `<code>${esc(descriptor.subrecordPointer.romOffsetHex)}</code>` : '<span class="dim">unresolved</span>'}</td>
        <td>${descriptor.subrecord?.vramLoader8fb?.romOffsetHex ? `<code>${esc(descriptor.subrecord.vramLoader8fb.romOffsetHex)}</code>` : '<span class="dim">unresolved</span>'}</td>
        <td>${descriptor.subrecord?.activeDc2PrefixCount ?? ''}</td>
        <td>${descriptor.subrecord?.bgPaletteIndex ?? ''}</td>
        <td>${descriptor.subrecord?.audioRequestIdHex ? `<code>${esc(descriptor.subrecord.audioRequestIdHex)}</code>` : ''}</td>
        <td>${descriptor.subrecord?.triggerTable?.preview?.recordCount ?? ''}</td>
        <td>${descriptor.subrecord?.eventTable?.preview?.recordCount ?? ''}</td>
        <td>${descriptor.outgoingEdgeCount}</td>
      </tr>`).join('');
      const paletteRows = Object.entries(preview.paletteCounts || {}).sort((a, b) => Number(a[0]) - Number(b[0])).map(([palette, count]) => `<tr><td>${esc(palette)}</td><td>${count}</td></tr>`).join('');
      const triggerHandlerRows = Object.entries(preview.triggerHandlerCounts || {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([handler, count]) => `<tr><td><code>${esc(handler)}</code></td><td>${count}</td></tr>`).join('');
      const eventRoleRows = Object.entries(preview.eventSelectorRoleCounts || {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([role, count]) => `<tr><td>${esc(role)}</td><td>${count}</td></tr>`).join('');
      extra.innerHTML = `<canvas class="preview-canvas" id="asset-preview-canvas"></canvas>
        <div class="line">${preview.descriptorCount} descriptor(s) · ${preview.triggerRecordCount} trigger record(s) · ${preview.eventRecordCount} event record(s) · ${preview.uniqueSubrecordCount} unique subrecord(s) · ${preview.uniqueLoader8fbCount} unique 8FB loader(s)</div>
        <div class="line">Evidence: ${esc(preview.sourceGraphId || '')} · ${esc(preview.semantics.loaderRoutine)} · ${esc(preview.semantics.subrecordRoutine)} · ${esc(preview.semantics.triggerRoutine)} · ${esc(preview.semantics.eventRoutine)}</div>
        <div class="line dim">Grid color follows BG palette/audio/edge variation; yellow outlines indicate warnings or catalog mismatch.</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Descriptor</th><th>Graph</th><th>Subrecord</th><th>8FB Loader</th><th>DC2</th><th>BG Pal</th><th>Audio</th><th>Triggers</th><th>Events</th><th>Edges</th></tr></thead>
          <tbody>${descriptorRows || '<tr><td colspan="10" class="dim">No descriptors in this region.</td></tr>'}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">BG Palette Histogram</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Palette</th><th>Descriptors</th></tr></thead>
          <tbody>${paletteRows || '<tr><td colspan="2" class="dim">No palette counts.</td></tr>'}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Trigger Handler Histogram</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Handler</th><th>Records</th></tr></thead>
          <tbody>${triggerHandlerRows || '<tr><td colspan="2" class="dim">No trigger handlers.</td></tr>'}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Event Selector Histogram</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Selector Role</th><th>Records</th></tr></thead>
          <tbody>${eventRoleRows || '<tr><td colspan="2" class="dim">No event records.</td></tr>'}</tbody>
        </table></div>`;
      drawRoomDescriptorGrid($('asset-preview-canvas'), preview);
      return;
    }
    if (preview.kind === 'room_subrecord_table') {
      const recordRows = (preview.records || []).map(record => `<tr>
        <td>${record.index}</td>
        <td><code>${esc(record.romOffsetHex)}</code></td>
        <td>${esc(record.status || '')}</td>
        <td>${record.triggerTable?.romOffsetHex ? `<code>${esc(record.triggerTable.romOffsetHex)}</code>` : '<span class="dim">unresolved</span>'}</td>
        <td>${record.eventTable?.romOffsetHex ? `<code>${esc(record.eventTable.romOffsetHex)}</code>` : '<span class="dim">unresolved</span>'}</td>
        <td>${record.entityList?.romOffsetHex ? `<code>${esc(record.entityList.romOffsetHex)}</code>` : '<span class="dim">unresolved</span>'}</td>
        <td>${record.vramLoader8fb?.romOffsetHex ? `<code>${esc(record.vramLoader8fb.romOffsetHex)}</code>` : '<span class="dim">unresolved</span>'}</td>
        <td>${record.triggerTable?.preview?.recordCount ?? ''}</td>
        <td>${record.eventTable?.preview?.recordCount ?? ''}</td>
        <td>${record.activeDc2PrefixCount}</td>
        <td>${record.bgPaletteIndex}</td>
        <td>${record.audioRequestIdHex ? `<code>${esc(record.audioRequestIdHex)}</code>` : ''}</td>
      </tr>`).join('');
      const roleRows = (preview.semantics.fieldRoles || []).map(role => `<tr><td>${esc(role)}</td></tr>`).join('');
      extra.innerHTML = `<canvas class="preview-canvas" id="asset-preview-canvas"></canvas>
        <div class="line">${preview.subrecordCount} subrecord(s) · ${preview.zoneGraphReachedSubrecords} graph reached · ${preview.triggerRecordCount} trigger record(s) · ${preview.eventRecordCount} event record(s) · ${preview.uniqueLoader8fbCount} unique 8FB loader(s)</div>
        <div class="line">Evidence: ${esc(preview.semantics.routine)} copies ${esc(preview.semantics.copiedRamRange)} before loader/DC2/palette/audio handling; ${esc(preview.semantics.triggerRoutine)} and ${esc(preview.semantics.eventRoutine)} consume the trigger/event pointers.</div>
        <div class="line dim">Yellow grid cells are structural orphan subrecords or records with parser warnings.</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>#</th><th>ROM</th><th>Status</th><th>Trigger</th><th>Event</th><th>Entity</th><th>8FB</th><th>Trig Rec</th><th>Event Rec</th><th>DC2</th><th>BG Pal</th><th>Audio</th></tr></thead>
          <tbody>${recordRows || '<tr><td colspan="12" class="dim">No records decoded.</td></tr>'}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Field Roles</div>
        <div class="table-wrap"><table class="asset-table">
          <tbody>${roleRows}</tbody>
        </table></div>`;
      drawRoomSubrecordGrid($('asset-preview-canvas'), preview);
      return;
    }
    if (preview.kind === 'room_entity_lists') {
      const listRows = (preview.lists || []).map(list => `<tr>
        <td><code>${esc(list.startOffsetHex)}</code></td>
        <td>${list.records.length}${list.records.length < (list.source?.catalogRecordCount ?? list.records.length) ? ` / ${esc(list.source.catalogRecordCount)}` : ''}</td>
        <td>${list.normalRecordCount}</td>
        <td>${list.alternateRecordCount}</td>
        <td>${list.terminated ? `<code>${esc(list.terminatorOffsetHex || '')}</code>` : '<span class="warn">no</span>'}</td>
        <td>${esc(list.source?.role || '')}</td>
        <td>${esc(list.source?.subrecordRefCount ?? 0)}</td>
      </tr>`).join('');
      const recordRows = (preview.lists || []).flatMap(list => (list.records || []).map(record => ({ list, record }))).slice(0, 128).map(({ list, record }) => {
        const dyn = record.dynamicTableEntry || {};
        const fieldText = (record.fieldBytes || []).map(field => `${field.name}: ${field.valueHex}${field.scaledValue == null ? '' : ` -> ${field.scaledValue}`}`).join(' · ');
        return `<tr>
          <td><code>${esc(list.startOffsetHex)}</code></td>
          <td><code>${esc(record.offsetHex)}</code></td>
          <td><code>${esc(record.entityTypeHex)}</code></td>
          <td>${esc(record.table)} ${record.tableIndex}</td>
          <td>${dyn.streamRomHex ? `<code>${esc(dyn.streamRomHex)}</code>` : '<span class="dim">unresolved</span>'}</td>
          <td>${dyn.streamRegion ? `<code>${esc(dyn.streamRegion.id)}</code> ${esc(dyn.streamRegion.type || '')}` : '<span class="dim">none</span>'}</td>
          <td>${esc(fieldText || 'alternate one-byte record')}</td>
        </tr>`;
      }).join('');
      const typeRows = (preview.aggregate?.topEntityTypes || []).map(item => `<tr>
        <td><code>${esc(item.entityTypeHex)}</code></td>
        <td>${item.count}</td>
      </tr>`).join('');
      const dynRows = (preview.aggregate?.topDynamicIndexes || []).map(item => `<tr>
        <td>${esc(item.table)}</td>
        <td>${item.tableIndex}</td>
        <td>${item.count}</td>
      </tr>`).join('');
      extra.innerHTML = `<canvas class="preview-canvas" id="asset-preview-canvas"></canvas>
        <div class="line">${preview.aggregate.listCount} list(s) · ${preview.aggregate.totalRecords} record(s) · ${preview.aggregate.normalRecords} normal · ${preview.aggregate.alternateRecords} alternate · ${preview.aggregate.uniqueEntityTypeCount} entity type byte(s)</div>
        <div class="line">Evidence: ${esc(preview.semantics.routine)} reads ${esc(preview.semantics.sourcePointerRam)} into ${esc(preview.semantics.outputRecordRam)}; ${esc(preview.semantics.dynamicTableRule)}.</div>
        <div class="line dim">Grid cells are decoded room entity records. Yellow outlines are alternate one-byte records; gray cells are empty/sentinel lists. Field bytes are transient from your local ROM and are not persisted.</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>List ROM</th><th>Records</th><th>Normal</th><th>Alt</th><th>Terminator</th><th>Source</th><th>Subrecord Refs</th></tr></thead>
          <tbody>${listRows || '<tr><td colspan="7" class="dim">No room entity lists decoded.</td></tr>'}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Decoded Records</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>List</th><th>Record ROM</th><th>Type</th><th>Dynamic Table</th><th>Tile Stream</th><th>Region</th><th>Transient Fields</th></tr></thead>
          <tbody>${recordRows || '<tr><td colspan="7" class="dim">No entity records in this list.</td></tr>'}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Entity Type Histogram</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Type Byte</th><th>Records</th></tr></thead>
          <tbody>${typeRows || '<tr><td colspan="2" class="dim">No entity types.</td></tr>'}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Dynamic Tile Index Histogram</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Table</th><th>Index</th><th>Records</th></tr></thead>
          <tbody>${dynRows || '<tr><td colspan="3" class="dim">No dynamic tile indexes.</td></tr>'}</tbody>
        </table></div>`;
      drawRoomEntityListGrid($('asset-preview-canvas'), preview);
      return;
    }
    if (preview.kind === 'entity_item_structural_records') {
      const layout = preview.layout || {};
      const byteStats = preview.byteStats || {};
      const rows = (preview.rows || []).map(row => {
        const fieldText = (row.fields || []).map(field => `${field.name}: ${field.valueHex}${field.signed == null ? '' : ` (${field.signed})`}`).join(' · ');
        const wordText = row.words
          ? row.words.map(word => word.wordHex || '').join(' · ')
          : (row.wordHex ? `${row.wordHex}${row.signedWord == null ? '' : ` (${row.signedWord})`}` : '');
        const byteText = row.byteHex ? row.byteHex.join(' ') : '';
        return `<tr>
          <td>${row.index}</td>
          <td><code>${esc(row.offsetHex)}</code></td>
          <td>${esc(row.recordSize || row.size || '')}</td>
          <td>${esc(row.terminator || wordText || byteText || '')}</td>
          <td>${esc(fieldText || '')}</td>
        </tr>`;
      }).join('');
      const analysisRows = (preview.analysisEntries || []).map(entry => `<tr>
        <td><code>${esc(entry.key || '')}</code></td>
        <td>${esc(entry.kind || entry.role || '')}</td>
        <td>${esc(entry.confidence || '')}</td>
        <td><code>${esc(entry.catalogId || '')}</code></td>
        <td>${esc(entry.summary || '')}</td>
      </tr>`).join('');
      const fieldRows = (layout.fieldRoles || []).map(role => `<tr><td>${esc(role)}</td></tr>`).join('');
      extra.innerHTML = `<div class="line">${esc(layout.role || '')} · ${esc(layout.streamKind || '')} · ${preview.recordCount == null ? `${esc(byteStats.byteCount || 0)} byte stream` : `${esc(preview.recordCount)} record(s)`}</div>
        <div class="line">Evidence: ${esc(layout.sourceRoutine || 'catalog-backed entity/item data')}</div>
        <div class="line dim">${esc(preview.assetPolicy || '')}</div>
        <div class="stats">
          ${stat('Distinct Bytes', byteStats.distinctByteCount ?? '')}
          ${stat('Zero Bytes', byteStats.zeroCount ?? '')}
          ${stat('FF Bytes', byteStats.ffCount ?? '')}
          ${stat('High Bit Bytes', byteStats.highBitCount ?? '')}
          ${stat('Trailing Bytes', preview.trailingByteCount ?? 0)}
        </div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>#</th><th>ROM</th><th>Size</th><th>Word / Bytes</th><th>Transient Fields</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5" class="dim">No structural rows decoded.</td></tr>'}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Field Roles</div>
        <div class="table-wrap"><table class="asset-table">
          <tbody>${fieldRows || '<tr><td class="dim">No exact field role names yet.</td></tr>'}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Evidence</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Analysis</th><th>Kind</th><th>Confidence</th><th>Catalog</th><th>Summary</th></tr></thead>
          <tbody>${analysisRows || '<tr><td colspan="5" class="dim">No entity/item analysis entry linked.</td></tr>'}</tbody>
        </table></div>`;
      return;
    }
    if (preview.kind === 'entity_behavior_pointer_table') {
      const rows = (preview.entries || []).map(entry => `<tr>
        <td>${entry.index}</td>
        <td><code>${esc(entry.entryOffsetHex)}</code></td>
        <td><code>${esc(entry.z80PointerHex || '')}</code></td>
        <td>${entry.romOffsetHex ? `<code>${esc(entry.romOffsetHex)}</code>` : '<span class="dim">unresolved</span>'}</td>
        <td>${entry.region ? `<code>${esc(entry.region.id)}</code> ${esc(entry.region.type || '')}` : '<span class="dim">none</span>'}</td>
      </tr>`).join('');
      extra.innerHTML = `<div class="line">${preview.entryCount} behavior pointer table entr${preview.entryCount === 1 ? 'y' : 'ies'}.</div>
        <div class="line dim">Target semantics come from entity behavior catalogs; this table preview is pointer validation only.</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>#</th><th>Entry ROM</th><th>Z80 Ptr</th><th>ROM Target</th><th>Region</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5" class="dim">No entries.</td></tr>'}</tbody>
        </table></div>`;
      return;
    }
    if (preview.kind === 'metasprite_frame_layout') {
      const usage = preview.usage || {};
      const tileContext = preview.tileContext || {};
      const frameRows = (preview.frames || []).slice(0, 30).map(frame => `<tr>
        <td><code>${esc(frame.offsetHex)}</code></td>
        <td>${esc(frame.pieceRecordCount)}</td>
        <td>${esc(frame.referenceCount)}</td>
        <td>${esc(frame.usageClass || '')}</td>
      </tr>`).join('');
      const pieceRows = (preview.pieces || []).map(piece => `<tr>
        <td>${piece.index}</td>
        <td><code>${esc(piece.offsetHex)}</code></td>
        <td>${piece.x >= 0 ? '+' : ''}${piece.x}</td>
        <td>${piece.y >= 0 ? '+' : ''}${piece.y}</td>
        <td><code>${esc(piece.tileHex)}</code></td>
        <td><code>0x${piece.resolvedTile.toString(16).toUpperCase().padStart(2, '0')}</code></td>
      </tr>`).join('');
      const usageRows = (usage.analysisEntries || []).map(item => `<tr>
        <td><code>${esc(item.key || '')}</code></td>
        <td>${esc(item.role || '')}</td>
        <td>${esc(item.kind || '')}</td>
        <td>${esc(item.confidence || '')}</td>
        <td>${esc(item.summary || '')}</td>
      </tr>`).join('');
      const familyRows = (usage.familyRefs || []).map(item => `<tr>
        <td><code>${esc(item.familyId || '')}</code></td>
        <td>${esc(item.kind || '')}</td>
        <td>${esc(item.selectorPair ? `${item.selectorPair.root}/${item.selectorPair.child}` : '')}</td>
        <td>${esc(item.streamCount ?? '')}</td>
        <td>${esc(item.frameTargetCount ?? '')}</td>
        <td>${esc(item.confidence || '')}</td>
      </tr>`).join('');
      const staticRows = (usage.staticRefs || []).map(item => `<tr>
        <td><code>${esc(item.streamId || '')}</code></td>
        <td><code>${esc(item.streamOffset || '')}</code></td>
        <td><code>${esc(item.frameOffset || '')}</code></td>
        <td>${esc(item.selectorCount ?? '')}</td>
        <td>${item.selected ? 'yes' : 'no'}</td>
        <td>${esc(item.confidence || '')}</td>
      </tr>`).join('');
      const sourceRows = (preview.tileRenderSources || []).map(source => `<tr>
        <td>${source.loaderRegion ? `<code>${esc(source.loaderRegion.id)}</code><br>${esc(source.loaderRegion.name || '')}` : '<span class="dim">unresolved</span>'}</td>
        <td>${esc(source.vramRange || '')}</td>
        <td><code>${esc(source.romStartHex || '')}</code></td>
        <td>${source.sourceRegion ? `<code>${esc(source.sourceRegion.id)}</code><br>${esc(source.sourceRegion.name || '')}` : '<span class="dim">unresolved</span>'}</td>
        <td>${esc(source.relation || '')}</td>
        <td>${esc(source.confidence || '')}</td>
      </tr>`).join('');
      const contextRows = (tileContext.matches || []).map(match => `<tr>
        <td><code>${esc(match.id || '')}</code></td>
        <td>${esc(match.sourceKind || '')}</td>
        <td>${esc(match.tileBase || '')}</td>
        <td>${esc(match.selectorPair ? `${match.selectorPair.root}/${match.selectorPair.child}` : '')}</td>
        <td>${esc(match.frameReferenceCount ?? '')}</td>
        <td>${esc((match.streamOffsets || []).slice(0, 6).join(', '))}</td>
      </tr>`).join('');
      extra.innerHTML = `<canvas class="preview-canvas" id="asset-preview-canvas"></canvas>
        <div class="line">Frame <code>${esc(preview.selectedFrameOffsetHex)}</code> · ${preview.pieces.length} piece(s) · ${esc(preview.format)} · ${esc(preview.endReason)}</div>
        <div class="line dim">Local ROM preview uses confirmed/candidate tile-source provenance when available; unresolved tiles fall back to structural OAM blocks.</div>
        ${preview.semantics ? `<div class="line">Evidence: ${esc(preview.semantics.frameStreamRoutine || '')} · tile base ${esc(preview.semantics.tileBaseField || '')} · input ${esc(preview.semantics.inputPointer || '')}</div>` : ''}
        ${preview.blank ? `<div class="line warn">Blank target: ${esc(preview.blankReason || '')}</div>` : ''}
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>#</th><th>ROM</th><th>X</th><th>Y</th><th>Tile</th><th>Tile + Base</th></tr></thead>
          <tbody>${pieceRows || '<tr><td colspan="6" class="dim">Empty metasprite frame.</td></tr>'}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Animation / Owner Metadata</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Analysis</th><th>Role</th><th>Kind</th><th>Confidence</th><th>Summary</th></tr></thead>
          <tbody>${usageRows || '<tr><td colspan="5" class="dim">No owner metadata linked.</td></tr>'}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Animation Families</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Family</th><th>Kind</th><th>Selector</th><th>Streams</th><th>Targets</th><th>Confidence</th></tr></thead>
          <tbody>${familyRows || '<tr><td colspan="6" class="dim">No family references linked.</td></tr>'}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Static Stream References</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Stream</th><th>Stream ROM</th><th>Frame ROM</th><th>Selectors</th><th>Selected</th><th>Confidence</th></tr></thead>
          <tbody>${staticRows || '<tr><td colspan="6" class="dim">No static stream reference linked.</td></tr>'}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Tile Base Context</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Range</th><th>Kind</th><th>Tile Base</th><th>Selector</th><th>Frame Refs</th><th>Streams</th></tr></thead>
          <tbody>${contextRows || '<tr><td colspan="6" class="dim">No tile-base range matched this frame.</td></tr>'}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Tile Source Provenance</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Loader</th><th>VRAM Range</th><th>ROM Source</th><th>Source Region</th><th>Relation</th><th>Confidence</th></tr></thead>
          <tbody>${sourceRows || '<tr><td colspan="6" class="dim">No renderable tile source resolved for this frame.</td></tr>'}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Known Frame Starts</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Frame ROM</th><th>Pieces</th><th>Refs</th><th>Usage</th></tr></thead>
          <tbody>${frameRows || '<tr><td colspan="4" class="dim">No cataloged subrecords for this region.</td></tr>'}</tbody>
        </table></div>`;
      drawMetaspriteLayout($('asset-preview-canvas'), preview);
      return;
    }
    if (preview.kind === 'entity_anim_table') {
      const rows = (preview.entries || []).map(entry => `<tr>
        <td>${entry.index}</td>
        <td><code>${esc(entry.entryOffsetHex)}</code></td>
        <td><code>${esc(entry.z80PointerHex || '')}</code></td>
        <td>${entry.romOffsetHex ? `<code>${esc(entry.romOffsetHex)}</code>` : '<span class="dim">unresolved</span>'}</td>
        <td>${entry.region ? `<code>${esc(entry.region.id)}</code> ${esc(entry.region.type || '')}` : '<span class="dim">none</span>'}</td>
      </tr>`).join('');
      extra.innerHTML = `<div class="line">${preview.entryCount} entries · ${preview.bank6PointerCount} bank-6 animation pointer(s)</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>#</th><th>Entry ROM</th><th>Z80 Ptr</th><th>ROM Target</th><th>Region</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5" class="dim">No entries.</td></tr>'}</tbody>
        </table></div>`;
      return;
    }
    if (preview.kind === 'entity_anim_script_probe') {
      const rows = (preview.streamStarts || []).slice(0, 40).map(stream => `<tr>
        <td><code>${esc(stream.offsetHex)}</code></td>
        <td>${esc(stream.sourceCatalogId || '')}</td>
        <td>${esc(stream.role || '')}</td>
        <td>${esc(stream.confidence || '')}</td>
      </tr>`).join('');
      extra.innerHTML = `<div class="line warn">Exact parser pending for this non-bank-6 script family.</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Offset</th><th>Catalog</th><th>Role</th><th>Confidence</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="4" class="dim">No cataloged stream starts in this region.</td></tr>'}</tbody>
        </table></div>`;
      return;
    }
    if (preview.kind === 'entity_anim_catalog_script') {
      const metadata = preview.metadata || {};
      const analysisRows = (metadata.analysisEntries || []).map(item => `<tr>
        <td><code>${esc(item.key || '')}</code></td>
        <td>${esc(item.role || '')}</td>
        <td>${esc(item.kind || '')}</td>
        <td>${esc(item.confidence || '')}</td>
        <td>${esc(item.summary || '')}</td>
      </tr>`).join('');
      const familyRows = (metadata.familyRefs || []).map(item => `<tr>
        <td><code>${esc(item.familyId || '')}</code></td>
        <td>${esc(item.kind || '')}</td>
        <td>${esc(item.selectorPair ? `${item.selectorPair.root}/${item.selectorPair.child}` : '')}</td>
        <td>${esc(item.streamCount ?? '')}</td>
        <td>${esc(item.frameTargetCount ?? '')}</td>
        <td>${esc(item.confidence || '')}</td>
      </tr>`).join('');
      const selectorRows = preview.itemVramSelector ? (preview.itemVramSelector.roles || []).map((role, index) => `<tr>
        <td>${esc(role)}</td>
        <td>${esc((preview.itemVramSelector.summaries || [])[index] || '')}</td>
      </tr>`).join('') : '';
      const producerRows = preview.itemVramProducer ? (preview.itemVramProducer.details || []).map(item => `<tr>
        <td>${esc(item.role || '')}</td>
        <td>${esc(item.confidence || '')}</td>
        <td>${esc(item.detail?.eventCountBeforeTerminator ?? '')}</td>
        <td>${esc(item.detail?.terminated ? 'yes' : 'no')}</td>
        <td>${esc(item.summary || '')}</td>
      </tr>`).join('') : '';
      const streamRows = (preview.streamStarts || []).slice(0, 40).map(stream => `<tr>
        <td><code>${esc(stream.offsetHex)}</code></td>
        <td>${esc(stream.streamKind || '')}</td>
        <td>${esc(stream.sourceCatalogId || '')}</td>
        <td>${esc(stream.role || '')}</td>
        <td>${esc(stream.confidence || '')}</td>
      </tr>`).join('');
      extra.innerHTML = `<div class="line">Cataloged structural script · ${esc(preview.scriptKind || preview.scriptRole || '')} · ${esc(preview.confidence || '')}</div>
        <div class="line dim">${esc(preview.summary || '')}</div>
        <div class="box-title" style="margin-top:10px">Resolved Metadata</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Analysis</th><th>Role</th><th>Kind</th><th>Confidence</th><th>Summary</th></tr></thead>
          <tbody>${analysisRows || '<tr><td colspan="5" class="dim">No metadata linked.</td></tr>'}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Animation Families</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Family</th><th>Kind</th><th>Selector</th><th>Streams</th><th>Targets</th><th>Confidence</th></tr></thead>
          <tbody>${familyRows || '<tr><td colspan="6" class="dim">No animation family reference linked.</td></tr>'}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Stream Starts</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Offset</th><th>Kind</th><th>Catalog</th><th>Role</th><th>Confidence</th></tr></thead>
          <tbody>${streamRows || '<tr><td colspan="5" class="dim">No stream starts; this region is structural selector/control data.</td></tr>'}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Item VRAM Selectors</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Role</th><th>Summary</th></tr></thead>
          <tbody>${selectorRows || '<tr><td colspan="2" class="dim">No item selector overlay.</td></tr>'}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Event / Reward Producers</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Role</th><th>Confidence</th><th>Events</th><th>Terminated</th><th>Summary</th></tr></thead>
          <tbody>${producerRows || '<tr><td colspan="5" class="dim">No event producer overlay.</td></tr>'}</tbody>
        </table></div>`;
      return;
    }
    if (preview.kind === 'entity_anim_stream') {
      const metadata = preview.metadata || {};
      const commandRows = (preview.commands || []).map(command => `<tr>
        <td>${command.index}</td>
        <td><code>${esc(command.offsetHex)}</code></td>
        <td><code>${esc(command.controlHex)}</code></td>
        <td>${command.delay}</td>
        <td>${command.startFrame}-${command.endFrame}</td>
        <td>${command.hasMotionWords ? `yes @ ${esc(command.motionWordsOffsetHex || '')}` : 'no'}</td>
        <td>${command.framePointer?.romOffsetHex ? `<code>${esc(command.framePointer.romOffsetHex)}</code>` : '<span class="dim">unresolved</span>'}</td>
        <td>${command.framePointer?.region ? `<code>${esc(command.framePointer.region.id)}</code> ${esc(command.framePointer.region.type || '')}` : '<span class="dim">none</span>'}</td>
      </tr>`).join('');
      const jumpRows = (preview.jumps || []).map(jump => `<tr>
        <td><code>${esc(jump.commandOffsetHex)}</code></td>
        <td><code>${esc(jump.z80PointerHex)}</code></td>
        <td>${jump.romOffsetHex ? `<code>${esc(jump.romOffsetHex)}</code>` : '<span class="dim">unresolved</span>'}</td>
        <td>${jump.region ? `<code>${esc(jump.region.id)}</code> ${esc(jump.region.type || '')}` : '<span class="dim">none</span>'}</td>
      </tr>`).join('');
      const streamRows = (preview.streamStarts || []).slice(0, 30).map(stream => `<tr>
        <td><code>${esc(stream.offsetHex)}</code></td>
        <td>${esc(stream.streamKind || '')}</td>
        <td>${esc(stream.commandCount ?? '')}</td>
        <td>${esc(stream.frameTargetCount ?? '')}</td>
        <td>${esc(stream.terminationKind || '')}</td>
        <td>${esc(stream.sourceCatalogId || '')}</td>
      </tr>`).join('');
      const analysisRows = (metadata.analysisEntries || []).map(item => `<tr>
        <td><code>${esc(item.key || '')}</code></td>
        <td>${esc(item.role || '')}</td>
        <td>${esc(item.kind || '')}</td>
        <td>${esc(item.confidence || '')}</td>
        <td>${esc(item.summary || '')}</td>
      </tr>`).join('');
      const parserWarningRows = (preview.parserWarnings || []).map(item => `<tr><td>${esc(item)}</td></tr>`).join('');
      extra.innerHTML = `<canvas class="preview-canvas" id="asset-preview-canvas"></canvas>
        <div class="line">Stream <code>${esc(preview.selectedStreamOffsetHex)}</code> · ${preview.commands.length} command(s) · ${preview.timelineFrameCount} frame ticks · termination ${esc(preview.termination.kind)}</div>
        <div class="line">Evidence: ${esc(preview.semantics.routine)} · ${esc(preview.semantics.loopOpcode)} · ${esc(preview.semantics.terminalHoldOpcode)}</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>#</th><th>ROM</th><th>Ctrl</th><th>Delay</th><th>Frames</th><th>Motion</th><th>Frame Target</th><th>Region</th></tr></thead>
          <tbody>${commandRows || '<tr><td colspan="8" class="dim">No commands decoded.</td></tr>'}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Jumps</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>ROM</th><th>Z80 Ptr</th><th>ROM Target</th><th>Region</th></tr></thead>
          <tbody>${jumpRows || '<tr><td colspan="4" class="dim">No jumps.</td></tr>'}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Known Stream Starts In Region</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Offset</th><th>Kind</th><th>Commands</th><th>Frames</th><th>Termination</th><th>Catalog</th></tr></thead>
          <tbody>${streamRows || '<tr><td colspan="6" class="dim">No cataloged stream starts in this region.</td></tr>'}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Animation Metadata</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Analysis</th><th>Role</th><th>Kind</th><th>Confidence</th><th>Summary</th></tr></thead>
          <tbody>${analysisRows || '<tr><td colspan="5" class="dim">No metadata linked.</td></tr>'}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Parser Issue Notes</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Note</th></tr></thead>
          <tbody>${parserWarningRows || '<tr><td class="dim">No parser issue notes.</td></tr>'}</tbody>
        </table></div>`;
      drawEntityAnimTimeline($('asset-preview-canvas'), preview);
      return;
    }
    if (preview.kind === 'pointer_table') {
      extra.innerHTML = previewPointerTable(result);
      return;
    }
    if (preview.kind === 'text_ascii') {
      extra.innerHTML = `<div class="line">Class: ${esc(preview.textClass)} · printable ${Math.round((preview.stats.printableAsciiRatio || 0) * 100)}%</div>
        <pre class="text-preview">${esc(preview.previewText)}</pre>`;
      return;
    }
    if (preview.kind === 'ui_menu_status_metadata') {
      const analysisRows = (preview.analysisEntries || []).map(entry => `<tr>
        <td>${esc(entry.key)}</td>
        <td>${esc(entry.kind || entry.role || '')}</td>
        <td>${esc(entry.confidence || '')}</td>
        <td><code>${esc(entry.catalogId || '')}</code></td>
        <td>${esc(entry.summary || '')}</td>
      </tr>`).join('');
      const catalogRows = (preview.catalogEntries || []).map(entry => `<tr>
        <td><code>${esc(entry.sourceCatalogId)}</code><br><span class="dim">${esc(entry.arrayName || '')}</span></td>
        <td>${entry.offset ? `<code>${esc(entry.offset)}</code>` : '<span class="dim">-</span>'}</td>
        <td>${esc(entry.label || '')}</td>
        <td>${esc(entry.role || '')}</td>
        <td>${esc(entry.family || '')}</td>
        <td>${esc((entry.ramRefs || []).join(', '))}</td>
        <td>${esc((entry.calls || []).slice(0, 8).join(', '))}</td>
      </tr>`).join('');
      const refRows = [
        ['RAM refs', preview.aggregate?.ramRefs || []],
        ['Calls', preview.aggregate?.calls || []],
        ['Ports', preview.aggregate?.ports || []],
        ['Catalogs', preview.aggregate?.sourceCatalogIds || []],
      ].map(([label, values]) => `<tr><td>${esc(label)}</td><td>${esc(values.join(', ') || 'none')}</td></tr>`).join('');
      const familyRows = Object.entries(preview.aggregate?.familyCounts || {})
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([family, count]) => `<tr><td>${esc(family)}</td><td>${count}</td></tr>`).join('');
      const table = preview.tableProbe || {};
      const tablePreview = preview.tablePreview || {};
      const tableRows = (tablePreview.rows || []).map(row => {
        const value = row.valueHex || row.wordHex || (row.fields || []).map(field => `${field.name}=${field.valueHex}`).join(' ');
        const target = row.targetOffsetHex
          ? `<code>${esc(row.targetOffsetHex)}</code>${row.targetRegion ? ` <span class="dim">${esc(row.targetRegion.id)} ${esc(row.targetRegion.type || '')}</span>` : ''}`
          : '<span class="dim">-</span>';
        return `<tr>
          <td>${esc(row.index)}</td>
          <td><code>${esc(row.offsetHex)}</code></td>
          <td>${esc(row.role || '')}</td>
          <td>${esc(value || '')}</td>
          <td>${esc(row.bitSummary || row.shape || '')}</td>
          <td>${target}</td>
        </tr>`;
      }).join('');
      const tableStatRows = [
        ['Status', tablePreview.status || 'none'],
        ['Rows', tablePreview.stats?.rowCount ?? ''],
        ['Shown rows', tablePreview.stats?.shownRowCount ?? ''],
        ['Record size', tablePreview.stats?.recordSize ?? table.recordSize ?? ''],
        ['Distinct values', tablePreview.stats?.distinctValueCount ?? ''],
        ['Zero values', tablePreview.stats?.zeroValueCount ?? ''],
        ['Non-zero values', tablePreview.stats?.nonZeroValueCount ?? ''],
        ['Truncated rows', tablePreview.stats?.truncatedRowCount ?? ''],
      ].map(([label, value]) => `<tr><td>${esc(label)}</td><td>${esc(value)}</td></tr>`).join('');
      const statusTileProbe = preview.statusTileProbe || null;
      let statusTileProbeHtml = '';
      if (statusTileProbe) {
        const statusRows = (statusTileProbe.rows || []).map(row => {
          const sourceRange = row.localDerivedSourceRange || row.sourceRange || null;
          const sourceText = sourceRange
            ? `<code>${esc(sourceRange.start)}-${esc(sourceRange.endExclusive)}</code>`
            : '<span class="dim">skipped</span>';
          const sourceRegion = row.sourceRegion
            ? `<span class="dim">${esc(row.sourceRegion.id)} ${esc(row.sourceRegion.type || '')}</span>`
            : '<span class="dim">-</span>';
          const catalogState = row.catalogUploadSkipped ? 'skip' : 'upload';
          const localState = row.localStatus === 'needs_rom'
            ? 'needs ROM'
            : (row.localUploadSkipped ? 'skip' : 'upload');
          const matchCls = row.matchesCatalog === false ? 'warn' : (row.matchesCatalog ? 'ok' : '');
          const matchText = row.matchesCatalog === false ? 'MISMATCH' : (row.matchesCatalog ? 'MATCH' : row.localStatus || '');
          return `<tr>
            <td>${esc(row.index)}</td>
            <td>${esc(catalogState)}</td>
            <td>${esc(localState)}</td>
            <td>${sourceText}<br>${sourceRegion}</td>
            <td><code>${esc(row.vramDestination || '')}</code><br><span class="dim">${esc(row.uploadByteCount || 0)} bytes · ${esc(row.uploadTileCount || 0)} tile(s)</span></td>
            <td>${pill(matchText, matchCls)}</td>
          </tr>`;
        }).join('');
        const statusStats = [
          ['Catalog', statusTileProbe.catalogId || ''],
          ['Region role', statusTileProbe.regionRole || ''],
          ['Selector table', statusTileProbe.selectorTableOffset || ''],
          ['Graphics source', statusTileProbe.graphicsSourceOffset || ''],
          ['Upload routine', statusTileProbe.uploadRoutine || ''],
          ['Offset helper', statusTileProbe.offsetHelper || ''],
          ['Entries', statusTileProbe.entryCount ?? ''],
          ['Local checked', statusTileProbe.localCheckedCount ?? ''],
          ['Local matches', statusTileProbe.localMatchCount ?? ''],
          ['Local mismatches', statusTileProbe.localMismatchCount ?? ''],
          ['Local uploads', statusTileProbe.localUploadCount ?? ''],
          ['Local skips', statusTileProbe.localSkippedCount ?? ''],
        ].map(([label, value]) => `<tr><td>${esc(label)}</td><td>${esc(value)}</td></tr>`).join('');
        const statusWarnings = (statusTileProbe.warnings || []).map(item => `<div class="line warn">${esc(item)}</div>`).join('');
        statusTileProbeHtml = `<div class="box-title" style="margin-top:10px">Local Status Tile Upload Probe</div>
          <div class="line">${esc(statusTileProbe.uploadByteCount)} byte upload to <code>${esc(statusTileProbe.vramDestination)}</code> · ${esc(statusTileProbe.localMatchCount)} local/catalog match(es) · ${esc(statusTileProbe.localMismatchCount)} mismatch(es).</div>
          <div class="line dim">${esc(statusTileProbe.assetPolicy || '')}</div>
          ${statusWarnings}
          ${(statusTileProbe.tilePreviewRanges || []).length ? '<canvas class="preview-canvas" id="status-tile-upload-canvas"></canvas>' : ''}
          <div class="table-wrap"><table class="asset-table">
            <thead><tr><th>#</th><th>Catalog</th><th>Local</th><th>Source Range</th><th>VRAM Upload</th><th>Status</th></tr></thead>
            <tbody>${statusRows || '<tr><td colspan="6" class="dim">No status tile selector rows.</td></tr>'}</tbody>
          </table></div>
          <div class="table-wrap"><table class="asset-table">
            <tbody>${statusStats}</tbody>
          </table></div>`;
      }
      extra.innerHTML = `<div class="line">${preview.analysisEntries.length} analysis evidence item(s) · ${preview.catalogEntries.length} catalog match(es) · ${preview.aggregate.ramRefs.length} RAM ref(s) · ${preview.aggregate.calls.length} call ref(s)</div>
        <div class="line">Structural UI status: ${result.metrics?.decodedStructuralUiRegion ? 'decoded from local ROM table/probe' : 'runtime/catalog metadata pending routine semantics'}.</div>
        <div class="line">Evidence families: ${esc(preview.semantics.families)}. Status RAM: ${esc(preview.semantics.statusRam)}. Password RAM: ${esc(preview.semantics.passwordRam)}.</div>
        ${table.role ? `<div class="line">Table probe: ${esc(table.role)} · ${table.recordCount ?? '?'} record(s) · ${table.recordSize ?? '?'} byte record size · aligned ${table.aligned === false ? 'no' : 'yes'}</div>` : ''}
        ${tablePreview.status === 'decoded' ? `<div class="line">Local UI table preview: ${esc(tablePreview.stats.shownRowCount)} shown row(s), ${esc(tablePreview.stats.distinctValueCount)} distinct value(s).</div>` : ''}
        ${tablePreview.status === 'needs_rom' ? '<div class="line warn">Load the local ROM to preview inferred UI table rows.</div>' : ''}
        <div class="line dim">${esc(preview.semantics.assetPolicy)}</div>
        ${renderReconstructionChecklistBlock(preview)}
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Analysis Key</th><th>Kind/Role</th><th>Confidence</th><th>Catalog</th><th>Summary</th></tr></thead>
          <tbody>${analysisRows || '<tr><td colspan="5" class="dim">No analysis entries.</td></tr>'}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Local UI Table Rows</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>#</th><th>ROM</th><th>Role</th><th>Value</th><th>Shape</th><th>Target</th></tr></thead>
          <tbody>${tableRows || '<tr><td colspan="6" class="dim">No local table rows decoded for this region.</td></tr>'}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Table Preview Stats</div>
        <div class="table-wrap"><table class="asset-table">
          <tbody>${tableStatRows}</tbody>
        </table></div>
        ${statusTileProbeHtml}
        <div class="box-title" style="margin-top:10px">Catalog Matches</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Catalog</th><th>Offset</th><th>Label</th><th>Role</th><th>Family</th><th>RAM</th><th>Calls</th></tr></thead>
          <tbody>${catalogRows || '<tr><td colspan="7" class="dim">No catalog matches.</td></tr>'}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Reference Summary</div>
        <div class="table-wrap"><table class="asset-table">
          <tbody>${refRows}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Family Counts</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Family</th><th>Evidence Items</th></tr></thead>
          <tbody>${familyRows || '<tr><td colspan="2" class="dim">No family counts.</td></tr>'}</tbody>
        </table></div>`;
      if (statusTileProbe?.tilePreviewRanges?.length && $('status-tile-upload-canvas')) {
        drawStatusTileUploadStrip($('status-tile-upload-canvas'), currentRom, statusTileProbe.tilePreviewRanges);
      }
      return;
    }
    if (preview.kind === 'audio_driver_runtime_metadata') {
      const fmtOffset = value => typeof value === 'number' ? wb3DecoderHex(value) : value;
      const analysisRows = (preview.analysisEntries || []).map(entry => `<tr>
        <td>${esc(entry.key)}</td>
        <td>${esc(entry.kind || entry.role || '')}</td>
        <td>${esc(entry.confidence || '')}</td>
        <td>${esc(entry.label || '')}</td>
        <td>${esc((entry.ports || []).join(', '))}</td>
        <td>${esc((entry.phaseIds || []).slice(0, 8).join(', '))}</td>
        <td>${esc((entry.ramRefs || []).slice(0, 8).join(', '))}</td>
        <td>${esc(entry.summary || '')}</td>
      </tr>`).join('');
      const catalogRows = (preview.catalogEntries || []).map(entry => `<tr>
        <td><code>${esc(entry.sourceCatalogId)}</code><br><span class="dim">${esc(entry.arrayName || '')}</span></td>
        <td>${entry.offset ? `<code>${esc(fmtOffset(entry.offset))}</code>` : '<span class="dim">-</span>'}</td>
        <td>${esc(entry.label || '')}</td>
        <td>${esc(entry.role || '')}</td>
        <td>${esc(entry.chip || '')}</td>
        <td>${esc((entry.ports || []).join(', ') || entry.port || '')}</td>
        <td>${esc(entry.writeCount ?? '')}</td>
        <td>${esc((entry.phaseIds || []).slice(0, 6).join(', '))}</td>
        <td>${esc((entry.routineLabels || []).slice(0, 5).join(', '))}</td>
      </tr>`).join('');
      const summaryRows = (preview.catalogSummaries || []).map(summary => `<tr>
        <td><code>${esc(summary.sourceCatalogId)}</code></td>
        <td>${summary.present ? 'yes' : 'missing'}</td>
        <td>${esc(summary.phaseCount)}</td>
        <td>${esc(summary.writeCount)}</td>
        <td>${esc(summary.branchCount)}</td>
        <td>${esc(summary.regionParticipationCount)}</td>
        <td>${esc(Object.entries(summary.portWriteCounts || {}).map(([port, count]) => `${port}:${count}`).join(', '))}</td>
        <td>${summary.readyForRuntimeHarness ? 'yes' : 'no'}</td>
      </tr>`).join('');
      const refRows = [
        ['Ports', preview.aggregate?.ports || []],
        ['Phases', preview.aggregate?.phaseIds || []],
        ['Fixture ids', preview.aggregate?.fixtureIds || []],
        ['RAM refs', preview.aggregate?.ramRefs || []],
        ['Calls', preview.aggregate?.calls || []],
        ['Routine labels', preview.aggregate?.routineLabels || []],
        ['Catalogs', preview.aggregate?.sourceCatalogIds || []],
      ].map(([label, values]) => `<tr><td>${esc(label)}</td><td>${esc(values.join(', ') || 'none')}</td></tr>`).join('');
      const chipRows = Object.entries(preview.aggregate?.chipCounts || {})
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([chip, count]) => `<tr><td>${esc(chip)}</td><td>${count}</td></tr>`).join('');
      const roleRows = Object.entries(preview.aggregate?.roleCounts || {})
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([role, count]) => `<tr><td>${esc(role)}</td><td>${count}</td></tr>`).join('');
      const bridge = preview.requestBridge || null;
      const bridgeSummary = bridge?.aggregate || {};
      const bridgeClassificationRows = Object.entries(bridgeSummary.classificationCounts || {})
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([kind, count]) => `<tr><td>${esc(kind)}</td><td>${esc(count)}</td></tr>`).join('');
      const bridgePortRows = Object.entries(bridgeSummary.portWriteCounts || {})
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([port, count]) => `<tr><td>${esc(port)}</td><td>${esc(count)}</td></tr>`).join('');
      const bridgeRequestRows = (bridge?.requestRows || []).map(row => `<tr>
        <td><code>${esc(row.requestIdHex || row.requestId)}</code></td>
        <td>${esc(row.classification?.kind || '')}<br><span class="dim">${esc(row.classification?.confidence || '')}</span></td>
        <td>${row.headerRegion ? `<code>${esc(row.headerRegion.id)}</code> ${esc(row.headerRegion.offset || '')}` : `<code>${esc(row.headerOffset || '')}</code>`}</td>
        <td>${esc(row.channelCount || 0)}</td>
        <td>${esc(row.uniqueStreamCount || 0)}</td>
        <td>${esc(row.immediateCallSiteCount || 0)} / ${esc(row.candidateCallSiteCount || 0)}</td>
        <td>${esc(row.roomRecipeDescriptorCount || 0)}</td>
        <td>${esc(row.reachableStreamCount || 0)}</td>
        <td>${esc(row.branchEdgeCount || 0)}</td>
        <td>${esc(row.maxBranchDepth || 0)}</td>
        <td>${esc(row.stateSeedChannelCount || 0)}</td>
        <td>${esc(row.stateSeedTimelineEventCount || 0)}</td>
      </tr>`).join('');
      extra.innerHTML = `<div class="line">${preview.analysisEntries.length} analysis evidence item(s) · ${preview.catalogEntries.length} CATALOG MATCHES · ${preview.aggregate.ports.length} port kind(s) · ${preview.aggregate.phaseIds.length} phase(s) · ${preview.aggregate.fixtureIds.length} fixture id(s)</div>
        <div class="line">Ports: ${esc(preview.semantics.outputPorts)}.</div>
        <div class="line">Selector: ${esc(preview.semantics.outputSelector)}. Loader: ${esc(preview.semantics.requestLoader)}.</div>
        <div class="line">audio output fixtures: ${esc(preview.semantics.outputFixtures)}</div>
        <div class="line dim">${esc(preview.semantics.assetPolicy)}</div>
        <div class="box-title" style="margin-top:10px">Driver Request Bridge</div>
        <div class="line">${esc(bridgeSummary.requestCount || 0)} request(s) · ${esc(bridgeSummary.bridgeRequestPreviewCount || 0)} shown · ${esc(bridgeSummary.immediateCallSiteCount || 0)} immediate callsite(s) · ${esc(bridgeSummary.dynamicCallSiteCount || 0)} dynamic callsite(s) · ${esc(bridgeSummary.outputPhaseCount || 0)} output phase(s) · ${esc(bridgeSummary.outputWriteCount || 0)} output write fixture(s).</div>
        <div class="line">Local seed: ${esc(bridgeSummary.localSeed?.channelSeedCount || 0)} channel seed(s), ${esc(bridgeSummary.localSeed?.timelineEventCount || 0)} timeline event(s), ${esc(bridgeSummary.localSeed?.validStreamPointerCount || 0)} resolved stream pointer(s).</div>
        <div class="line dim">${esc(bridge?.semantics?.outputFixtures || '')} ${esc(bridge?.semantics?.localSeedBoundary || '')}</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Request</th><th>Class</th><th>Header Region</th><th>Channels</th><th>Streams</th><th>Callsites I/C</th><th>Room Uses</th><th>Reachable</th><th>Branches</th><th>Depth</th><th>Seed Ch</th><th>Seed Events</th></tr></thead>
          <tbody>${bridgeRequestRows || '<tr><td colspan="12" class="dim">No request bridge rows.</td></tr>'}</tbody>
        </table></div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Request Classification</th><th>Count</th></tr></thead>
          <tbody>${bridgeClassificationRows || '<tr><td colspan="2" class="dim">No classification counts.</td></tr>'}</tbody>
        </table></div>
	        <div class="table-wrap"><table class="asset-table">
	          <thead><tr><th>Output Port</th><th>Write Fixture Count</th></tr></thead>
	          <tbody>${bridgePortRows || '<tr><td colspan="2" class="dim">No port write counts.</td></tr>'}</tbody>
	        </table></div>
	        ${renderAudioRuntimeOutputModelBlock(preview.runtimeOutputModel)}
	        <div class="table-wrap"><table class="asset-table">
	          <thead><tr><th>Analysis Key</th><th>Role</th><th>Confidence</th><th>Label</th><th>Ports</th><th>Phases</th><th>RAM</th><th>Summary</th></tr></thead>
	          <tbody>${analysisRows || '<tr><td colspan="8" class="dim">No analysis entries.</td></tr>'}</tbody>
	        </table></div>
        <div class="box-title" style="margin-top:10px">CATALOG MATCHES</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Catalog</th><th>Offset</th><th>Label</th><th>Role</th><th>Chip</th><th>Ports</th><th>Writes</th><th>Phases</th><th>Routines</th></tr></thead>
          <tbody>${catalogRows || '<tr><td colspan="9" class="dim">No catalog matches.</td></tr>'}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Audio Runtime Catalogs</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Catalog</th><th>Present</th><th>Phases</th><th>Writes</th><th>Branches</th><th>Regions</th><th>Port Counts</th><th>Harness</th></tr></thead>
          <tbody>${summaryRows || '<tr><td colspan="8" class="dim">No audio runtime summaries.</td></tr>'}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Reference Summary</div>
        <div class="table-wrap"><table class="asset-table">
          <tbody>${refRows}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Chip Counts</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Chip</th><th>Evidence Items</th></tr></thead>
          <tbody>${chipRows || '<tr><td colspan="2" class="dim">No chip counts.</td></tr>'}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Role Counts</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Role</th><th>Evidence Items</th></tr></thead>
          <tbody>${roleRows || '<tr><td colspan="2" class="dim">No role counts.</td></tr>'}</tbody>
        </table></div>`;
      return;
    }
    if (preview.kind === 'collision_runtime_metadata') {
      const analysisRows = (preview.analysisEntries || []).map(entry => `<tr>
        <td>${esc(entry.key)}</td>
        <td>${esc(entry.kind || entry.role || entry.category || '')}</td>
        <td>${esc(entry.confidence || '')}</td>
        <td><code>${esc(entry.catalogId || '')}</code></td>
        <td>${esc((entry.ramRefs || []).join(', '))}</td>
        <td>${esc((entry.calls || []).join(', '))}</td>
        <td>${esc(entry.summary || '')}</td>
      </tr>`).join('');
      const catalogRows = (preview.catalogEntries || []).map(entry => `<tr>
        <td><code>${esc(entry.sourceCatalogId)}</code><br><span class="dim">${esc(entry.arrayName || '')}</span></td>
        <td>${entry.offset ? `<code>${esc(entry.offset)}</code>` : '<span class="dim">-</span>'}</td>
        <td>${esc(entry.label || '')}</td>
        <td>${esc(entry.role || '')}</td>
        <td>${esc(entry.confidence || '')}</td>
        <td>${entry.activeDc2PrefixCount == null ? '<span class="dim">-</span>' : esc(entry.activeDc2PrefixCount)}</td>
        <td>${entry.acceptedCellColumns == null ? '<span class="dim">-</span>' : esc(entry.acceptedCellColumns)}</td>
        <td>${esc((entry.ramRefs || []).join(', '))}</td>
        <td>${esc((entry.calls || []).slice(0, 8).join(', '))}</td>
      </tr>`).join('');
      const refRows = [
        ['RAM refs', preview.aggregate?.ramRefs || []],
        ['Calls', preview.aggregate?.calls || []],
        ['Hook ids', preview.aggregate?.sourceHookIds || []],
        ['Fixture ids', preview.aggregate?.hookFixtureIds || []],
        ['Catalogs', preview.aggregate?.sourceCatalogIds || []],
      ].map(([label, values]) => `<tr><td>${esc(label)}</td><td>${esc(values.join(', ') || 'none')}</td></tr>`).join('');
      const widthRows = Object.entries(preview.aggregate?.widthCounts || {})
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([prefix, count]) => `<tr><td>${esc(prefix)}</td><td>${esc(Number(prefix) * 16)}</td><td>${count}</td></tr>`).join('');
      const roleRows = Object.entries(preview.aggregate?.roleCounts || {})
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([role, count]) => `<tr><td>${esc(role)}</td><td>${count}</td></tr>`).join('');
      let dc2ProbeHtml = '';
      if (preview.dc2Probe?.kind === 'dc2_stream') {
        const probe = preview.dc2Probe;
        const decoded = probe.decoded || {};
        const opRows = Object.entries(decoded.opCounts || {})
          .map(([kind, count]) => `<tr><td>${esc(kind)}</td><td>${esc(count)}</td></tr>`).join('');
        const commandRows = (decoded.commands || []).map(command => `<tr>
          <td><code>${esc(command.offsetHex || '')}</code></td>
          <td>${esc(command.kind || '')}</td>
          <td>${esc(command.encodedCellCount ?? '')}</td>
          <td>${esc(command.outputStartCell ?? '')}..${esc(command.outputEndCellExclusive ?? '')}</td>
        </tr>`).join('');
        dc2ProbeHtml = `<div class="box-title" style="margin-top:10px">Local DC2 Stream Probe</div>
          <div class="line">Index ${esc(probe.tableIndexHex || '')} · ${esc(decoded.writtenCells ?? 0)}/${esc(decoded.expectedCells ?? 0)} cells · ${esc(decoded.runtimeConsumedBytes ?? 0)} byte(s) · end ${esc(decoded.endReason || '')} · descriptors ${esc(probe.descriptorCount ?? 'unknown')}</div>
          <div class="line dim">${esc(probe.assetPolicy || '')}</div>
          <div class="table-wrap"><table class="asset-table">
            <thead><tr><th>Opcode Class</th><th>Count</th></tr></thead>
            <tbody>${opRows || '<tr><td colspan="2" class="dim">No opcode classes.</td></tr>'}</tbody>
          </table></div>
          <div class="box-title" style="margin-top:10px">Command Structure Preview</div>
          <div class="table-wrap"><table class="asset-table">
            <thead><tr><th>ROM</th><th>Kind</th><th>Cells Written</th><th>Output Cell Range</th></tr></thead>
            <tbody>${commandRows || '<tr><td colspan="4" class="dim">No command preview rows.</td></tr>'}</tbody>
          </table></div>`;
      } else if (preview.dc2Probe?.kind === 'dc2_pointer_table') {
        const probe = preview.dc2Probe;
        const rowHtml = (probe.rows || []).map(row => `<tr>
          <td>${esc(row.indexHex || '')}</td>
          <td><code>${esc(row.tableEntryOffsetHex || '')}</code></td>
          <td><code>${esc(row.romOffsetHex || '')}</code><br><span class="dim">${esc(row.regionId || '')}</span></td>
          <td>${esc(row.runtimeConsumedBytes ?? '')}</td>
          <td>${esc(row.writtenCells ?? '')}</td>
          <td>${esc(row.endReason || '')}</td>
          <td>${esc(row.warningCount ?? 0)}</td>
          <td>${esc(row.descriptorCount ?? '')}</td>
        </tr>`).join('');
        const opRows = Object.entries(probe.opTotals || {})
          .map(([kind, count]) => `<tr><td>${esc(kind)}</td><td>${esc(count)}</td></tr>`).join('');
        dc2ProbeHtml = `<div class="box-title" style="margin-top:10px">Local DC2 Pointer Table Probe</div>
          <div class="line">${esc(probe.entryCount || 0)} entries · ${esc(probe.validStreamCount || 0)} valid stream(s) · ${esc(probe.warningStreamCount || 0)} warning stream(s) · ${esc(probe.totalRuntimeConsumedBytes || 0)} byte(s) consumed by runtime parser</div>
          <div class="line dim">${esc(probe.assetPolicy || '')}</div>
          <div class="table-wrap"><table class="asset-table">
            <thead><tr><th>Opcode Class</th><th>Total Count</th></tr></thead>
            <tbody>${opRows || '<tr><td colspan="2" class="dim">No opcode totals.</td></tr>'}</tbody>
          </table></div>
          <div class="box-title" style="margin-top:10px">Table Entry Preview</div>
          <div class="table-wrap"><table class="asset-table">
            <thead><tr><th>Index</th><th>Entry ROM</th><th>Stream</th><th>Bytes</th><th>Cells</th><th>End</th><th>Warnings</th><th>Descriptors</th></tr></thead>
            <tbody>${rowHtml || '<tr><td colspan="8" class="dim">No table rows.</td></tr>'}</tbody>
          </table></div>`;
      } else if (preview.dc2Probe?.kind === 'dc2_tile_pair_lookup') {
        const probe = preview.dc2Probe;
        dc2ProbeHtml = `<div class="box-title" style="margin-top:10px">Local DC2 Tile-Pair Lookup Bridge</div>
          <div class="line">Lookup ${esc(probe.lookupOffset || '')} · ${esc(probe.recordCount ?? '')} records · stride ${esc(probe.recordStride ?? '')} · ${esc(probe.uniqueLookupRecordIndicesUsed ?? '')} lookup ids used · ${esc(probe.outOfRangeCellCount ?? '')} out-of-range cell refs.</div>
          <div class="line dim">${esc(probe.assetPolicy || '')}</div>`;
      }
      extra.innerHTML = `<div class="line">${preview.analysisEntries.length} analysis evidence item(s) · ${preview.catalogEntries.length} catalog match(es) · ${preview.aggregate.ramRefs.length} RAM ref(s) · ${preview.aggregate.calls.length} call ref(s) · ${preview.aggregate.recipeWidthSampleCount} recipe width sample(s)</div>
        <div class="line">Structural DC2 status: ${preview.dc2Probe && preview.dc2Probe.kind !== 'dc2_tile_pair_lookup' ? esc(preview.dc2Probe.kind) : esc(preview.dc2Probe?.kind || 'not a DC2 data region')} ${preview.dc2Probe ? 'validated from local ROM when warnings are zero' : 'runtime/catalog metadata only'}.</div>
        <div class="line">Buffer: ${esc(preview.semantics.buffer)}. Lookup: ${esc(preview.semantics.lookupRoutine)}.</div>
        <div class="line">Bounds: ${esc(preview.semantics.boundModel)}.</div>
        <div class="line dim">${esc(preview.semantics.assetPolicy)}</div>
        ${renderReconstructionChecklistBlock(preview)}
        ${dc2ProbeHtml}
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Analysis Key</th><th>Role</th><th>Confidence</th><th>Catalog</th><th>RAM</th><th>Calls</th><th>Summary</th></tr></thead>
          <tbody>${analysisRows || '<tr><td colspan="7" class="dim">No analysis entries.</td></tr>'}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Catalog Matches</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Catalog</th><th>Offset</th><th>Label</th><th>Role</th><th>Confidence</th><th>DC2 Prefix</th><th>Columns</th><th>RAM</th><th>Calls</th></tr></thead>
          <tbody>${catalogRows || '<tr><td colspan="9" class="dim">No catalog matches.</td></tr>'}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">DC2 Width Samples</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Active Prefix</th><th>Accepted Columns</th><th>Samples</th></tr></thead>
          <tbody>${widthRows || '<tr><td colspan="3" class="dim">No recipe width samples for this region.</td></tr>'}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Reference Summary</div>
        <div class="table-wrap"><table class="asset-table">
          <tbody>${refRows}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Role Counts</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Role</th><th>Evidence Items</th></tr></thead>
          <tbody>${roleRows || '<tr><td colspan="2" class="dim">No role counts.</td></tr>'}</tbody>
        </table></div>`;
      return;
    }
    if (preview.kind === 'input_script_bfd') {
      const rows = preview.records.map(record => `<tr>
        <td>${record.index}</td>
        <td><code>${esc(wb3DecoderHex(record.offset))}</code></td>
        <td>${record.duration}</td>
        <td><code>0x${record.command.toString(16).toUpperCase().padStart(2, '0')}</code></td>
        <td>${esc(record.directionLabel)}</td>
        <td>${esc(record.actionLabel)}</td>
      </tr>`).join('');
      extra.innerHTML = `<div class="line">Leading byte <code>0x${preview.leadingByte.toString(16).toUpperCase().padStart(2, '0')}</code> · ${preview.stats.recordCount} records · ${preview.stats.frameDurationTotal} frames · ${esc(preview.endReason)} · tail ${preview.tailBytes}b</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>#</th><th>ROM</th><th>Duration</th><th>Command</th><th>Direction</th><th>Action</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>`;
      return;
    }
    if (preview.kind === 'music_request_streams') {
      const graphRows = (preview.graphs || []).map(graph => `<tr>
        <td><code>${esc(graph.requestIdHex || graph.requestId)}</code></td>
        <td>${esc(graph.classification?.kind || '')}<br><span class="dim">${esc(graph.classification?.confidence || '')}</span></td>
        <td>${graph.channelCount}</td>
        <td>${graph.reachableStreamCount}</td>
        <td>${graph.branchEdgeCount}</td>
        <td>${graph.maxBranchDepth}</td>
        <td>${graph.roomRecipeUsage ? esc(graph.roomRecipeUsage.descriptorCount) : '<span class="dim">0</span>'}</td>
      </tr>`).join('');
      const channelRows = (preview.songs || []).flatMap(song => (song.channels || []).map(channel => ({ song, channel }))).slice(0, 96).map(({ song, channel }) => `<tr>
        <td><code>${esc(song.index)}</code></td>
        <td><code>${esc(channel.headerOffset || '')}</code></td>
        <td><code>${esc(channel.channelIdHex || channel.channelId)}</code></td>
        <td><code>${esc(channel.priorityHex || channel.priority)}</code></td>
        <td><code>${esc(channel.streamZ80 || '')}</code></td>
        <td>${channel.streamRomOffset ? `<code>${esc(channel.streamRomOffset)}</code>` : '<span class="dim">unresolved</span>'}</td>
        <td>${channel.streamRegion ? `<code>${esc(channel.streamRegion.id)}</code> ${esc(channel.streamRegion.type || '')}` : '<span class="dim">none</span>'}</td>
      </tr>`).join('');
      const streamRows = (preview.streams || []).map(stream => {
        const opcodeText = Object.entries(stream.opcodeCounts || {})
          .sort((a, b) => Number(b[1]) - Number(a[1]) || a[0].localeCompare(b[0]))
          .slice(0, 8)
          .map(([opcode, count]) => `${opcode}:${count}`)
          .join(' ');
        return `<tr>
          <td><code>${esc(stream.startOffset || '')}</code></td>
          <td>${stream.consumedBytes}</td>
          <td>${stream.noteBytes}</td>
          <td>${stream.highFlagNoteBytes}</td>
          <td>${stream.branchTargetCount}</td>
          <td>${esc(stream.endReason || '')}</td>
          <td>${esc(opcodeText)}</td>
          <td>${stream.referencedByCount}</td>
          <td>${stream.region ? `<code>${esc(stream.region.id)}</code> ${esc(stream.region.type || '')}` : '<span class="dim">none</span>'}</td>
        </tr>`;
      }).join('');
      const opcodeRows = (preview.aggregate?.topOpcodeCounts || []).map(item => `<tr>
        <td><code>${esc(item.key)}</code></td>
        <td>${item.count}</td>
      </tr>`).join('');
      const classificationRows = Object.entries(preview.aggregate?.classificationCounts || {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([kind, count]) => `<tr>
        <td>${esc(kind)}</td>
        <td>${count}</td>
      </tr>`).join('');
      const timelineRows = (preview.timelines || []).map(timeline => `<tr>
        <td><code>${esc(timeline.requestIdHex || timeline.requestId)}</code></td>
        <td>${esc(timeline.channelIndex)}</td>
        <td><code>${esc(timeline.channelIdHex || '')}</code></td>
        <td><code>${esc(timeline.streamOffset || '')}</code></td>
        <td>${esc(timeline.stats?.eventCount || 0)}</td>
        <td>${esc(timeline.stats?.noteEventCount || 0)}</td>
        <td>${esc(timeline.stats?.restEventCount || 0)}</td>
        <td>${esc(timeline.stats?.durationCommandCount || 0)}</td>
        <td>${esc(timeline.stats?.opcodeEventCount || 0)}</td>
        <td>${esc(timeline.stats?.frameCount || 0)}</td>
        <td>${esc(timeline.endReason || '')}</td>
      </tr>`).join('');
      const timelineEventRows = (preview.timelines || []).flatMap(timeline => (timeline.events || []).slice(0, 24).map(event => ({ timeline, event }))).slice(0, 160).map(({ timeline, event }) => `<tr>
        <td><code>${esc(timeline.requestIdHex || timeline.requestId)}</code></td>
        <td>${esc(timeline.channelIndex)}</td>
        <td>${esc(event.frameStart ?? '')}</td>
        <td>${esc(event.frameEnd ?? '')}</td>
        <td>${esc(event.kind || '')}</td>
        <td>${event.noteLabel ? esc(event.noteLabel) : (event.opcode ? `<code>${esc(event.opcode)}</code>` : '')}</td>
        <td>${esc(event.durationFrames ?? '')}</td>
        <td>${event.selector == null ? '' : esc(event.selector)}</td>
        <td>${esc([event.name || event.parserAction || event.source || '', (event.operandHex || []).join(' ')].filter(Boolean).join(' · '))}</td>
      </tr>`).join('');
      const stateSeed = preview.requestChannelStateProbe || null;
      const stateSeedSummary = stateSeed?.aggregate || {};
      const stateSeedRequestRows = (stateSeed?.requests || []).map(request => `<tr>
        <td><code>${esc(request.requestIdHex || request.requestId)}</code></td>
        <td><code>${esc(request.tableEntryOffset || '')}</code></td>
        <td><code>${esc(request.headerOffset || '')}</code></td>
        <td>${esc(request.classification?.kind || '')}<br><span class="dim">${esc(request.classification?.confidence || '')}</span></td>
        <td>${esc(request.channelCount || 0)} / ${esc(request.previewedChannelCount || 0)}</td>
        <td>${esc(request.uniqueStreamCount || 0)}</td>
        <td>${esc(request.reachableStreamCount || 0)}</td>
        <td>${esc(request.branchEdgeCount || 0)}</td>
        <td>${esc(request.roomRecipeDescriptorCount || 0)}</td>
      </tr>`).join('');
      const stateSeedChannelRows = (stateSeed?.channels || []).slice(0, 128).map(channel => `<tr>
        <td><code>${esc(channel.requestIdHex || channel.requestId)}</code></td>
        <td>${esc(channel.channelIndex)}</td>
        <td><code>${esc(channel.channelIdHex || '')}</code></td>
        <td><code>${esc(channel.priorityHex || '')}</code></td>
        <td><code>${esc(channel.streamRomOffset || '')}</code></td>
        <td>${channel.streamRegion ? `<code>${esc(channel.streamRegion.id)}</code> ${esc(channel.streamRegion.type || '')}` : '<span class="dim">none</span>'}</td>
        <td>${esc(channel.stateSeedStatus || '')}</td>
        <td>${esc(channel.graphReachableStreamCount || 0)}</td>
        <td>${esc(channel.graphBranchEdgeCount || 0)}</td>
        <td>${esc(channel.timelineStats?.eventCount || 0)}</td>
        <td>${esc(channel.timelineStats?.frameCount || 0)}</td>
        <td>${esc(channel.timelineEndReason || '')}</td>
      </tr>`).join('');
      extra.innerHTML = `${renderMusicControls(region, result)}
        <div class="line">${preview.aggregate.requestHeaderCount} request header(s) · ${preview.aggregate.streamSegmentCount} stream segment(s) · ${preview.aggregate.requestGraphCount} graph(s) · ${preview.aggregate.branchEdgeCount} branch edge(s) · ${preview.aggregate.timeline?.eventCount || 0} timeline event(s)</div>
        <div class="line">Evidence: ${esc(preview.semantics.requestTable)} at ${esc(preview.semantics.requestTableOffset)} · ${esc(preview.semantics.streamPointerOpcodes)} · ${esc(preview.semantics.driverRoutines)}.</div>
        <div class="line">Stream roles: ${esc(preview.semantics.streamByteRoles || '')}</div>
        <div class="line">Timing: ${esc(preview.semantics.durationLookup || '')}</div>
        <div class="line dim">Tables are structural metadata from audio catalogs plus ROM-local scan counts. Playback above uses the transient timeline and does not claim exact PSG/FM output.</div>
        <div class="box-title" style="margin-top:10px">Local Request Channel State Seed</div>
        <div class="line">${esc(stateSeedSummary.requestSeedCount || 0)} request seed(s) · ${esc(stateSeedSummary.channelSeedCount || 0)} channel seed(s) · ${esc(stateSeedSummary.validStreamPointerCount || 0)} resolved stream pointer(s) · ${esc(stateSeedSummary.unresolvedStreamPointerCount || 0)} unresolved · ${esc(stateSeedSummary.timelineEventCount || 0)} seed timeline event(s) · ${esc(stateSeedSummary.branchEdgeCount || 0)} graph branch edge(s).</div>
        <div class="line dim">${esc(stateSeed?.semantics?.stateSeedBoundary || 'Exact PSG/FM state is still pending.')}</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Request</th><th>Table Entry</th><th>Header ROM</th><th>Class</th><th>Channels</th><th>Unique Streams</th><th>Reachable</th><th>Branches</th><th>Room Uses</th></tr></thead>
          <tbody>${stateSeedRequestRows || '<tr><td colspan="9" class="dim">No request/channel seed data for this region.</td></tr>'}</tbody>
        </table></div>
	        <div class="table-wrap"><table class="asset-table">
	          <thead><tr><th>Request</th><th>Ch</th><th>Ch Id</th><th>Priority</th><th>Stream ROM</th><th>Region</th><th>Seed State</th><th>Reachable</th><th>Branches</th><th>Events</th><th>Frames</th><th>End</th></tr></thead>
	          <tbody>${stateSeedChannelRows || '<tr><td colspan="12" class="dim">No channel seed rows.</td></tr>'}</tbody>
	        </table></div>
	        ${renderMusicChannelLaneStateBlock(preview.musicChannelLaneState)}
	        ${renderMusicPitchDurationBindingBlock(preview.musicPitchDurationBinding)}
	        ${renderMusicOpcodeParameterStateBlock(preview.musicOpcodeParameterState)}
	        ${renderAudioRuntimeOutputModelBlock(preview.runtimeOutputModel)}
	        <div class="box-title" style="margin-top:10px">Timeline Channels</div>
	        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Request</th><th>Ch</th><th>Ch Id</th><th>Stream ROM</th><th>Events</th><th>Notes</th><th>Rests</th><th>Dur Cmds</th><th>Opcodes</th><th>Frames</th><th>End</th></tr></thead>
          <tbody>${timelineRows || '<tr><td colspan="11" class="dim">No transient timeline events parsed for this region.</td></tr>'}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Timeline Event Samples</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Request</th><th>Ch</th><th>Start</th><th>End</th><th>Kind</th><th>Value</th><th>Frames</th><th>Selector</th><th>Metadata</th></tr></thead>
          <tbody>${timelineEventRows || '<tr><td colspan="9" class="dim">No timeline event samples.</td></tr>'}</tbody>
        </table></div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Request</th><th>Class</th><th>Channels</th><th>Reachable Streams</th><th>Branches</th><th>Depth</th><th>Room Uses</th></tr></thead>
          <tbody>${graphRows || '<tr><td colspan="7" class="dim">No request graphs match this region.</td></tr>'}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Header Channels</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Request</th><th>Header ROM</th><th>Channel</th><th>Priority</th><th>Stream Z80</th><th>Stream ROM</th><th>Region</th></tr></thead>
          <tbody>${channelRows || '<tr><td colspan="7" class="dim">No channel headers in this region.</td></tr>'}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Stream Segments</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Stream ROM</th><th>Bytes</th><th>Notes</th><th>Flag Notes</th><th>Branches</th><th>End</th><th>Opcodes</th><th>Refs</th><th>Region</th></tr></thead>
          <tbody>${streamRows || '<tr><td colspan="9" class="dim">No stream segments in this region.</td></tr>'}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Opcode Histogram</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Opcode</th><th>Count</th></tr></thead>
          <tbody>${opcodeRows || '<tr><td colspan="2" class="dim">No opcodes cataloged.</td></tr>'}</tbody>
        </table></div>
        <div class="box-title" style="margin-top:10px">Request Class Histogram</div>
        <div class="table-wrap"><table class="asset-table">
          <thead><tr><th>Classification</th><th>Graphs</th></tr></thead>
          <tbody>${classificationRows || '<tr><td colspan="2" class="dim">No classifications.</td></tr>'}</tbody>
        </table></div>`;
      return;
    }
    if (preview.kind === 'music_probe' || preview.kind === 'music_unlinked_region_probe') {
      const classification = preview.classification || {};
      const timeline = preview.unlinkedTimeline || null;
      const falseDw = classification.falseDwTargetShape || null;
      const falseDwRows = (falseDw?.rejectedPointers || []).map(pointer => `
        <tr>
          <td>${esc(pointer.requestIdHex || pointer.requestId || '')}</td>
          <td>${esc(pointer.channelIndex ?? '')}</td>
          <td>${esc(pointer.rejectedPointerOffset || '')}</td>
          <td>${esc(pointer.falseWordZ80 || '')}</td>
          <td>${esc(pointer.actualStreamOffset || '')}</td>
          <td>${esc(pointer.actualStreamRegion?.id || '')}</td>
          <td>${esc(pointer.confidence || '')}</td>
        </tr>`).join('');
      const timelineRows = (timeline?.events || []).map(event => `
        <tr>
          <td>${esc(event.offsetHex || '')}</td>
          <td>${esc(event.kind || '')}</td>
          <td>${esc(event.frameStart ?? '')}</td>
          <td>${esc(event.frameEnd ?? '')}</td>
          <td>${esc(event.durationFrames ?? '')}</td>
          <td>${esc(event.noteLabel || event.opcode || '')}</td>
          <td>${esc(event.name || event.parserAction || '')}</td>
        </tr>`).join('');
      const classBlock = preview.kind === 'music_unlinked_region_probe' ? `
        <div class="box-title" style="margin-top:10px">Unlinked Music Classification</div>
        <div class="stats">
          ${stat('Class', classification.kind || result.metrics?.nonRequestBackedMusicClass || 'unclassified')}
          ${stat('Confidence', classification.confidence || result.metrics?.classificationConfidence || 'unknown')}
          ${stat('Standalone Stream', classification.likelyStandaloneMusicStream ? 'candidate' : 'unlikely')}
          ${stat('Confirmed Ref', classification.confirmedStreamReference ? 'yes' : 'no')}
          ${stat('Bank', classification.bank ?? result.metrics?.bank ?? '')}
          ${stat('Scanned Bytes', preview.scannedBytes ?? result.metrics?.scannedBytes ?? '')}
          ${timeline ? stat('Timeline Events', timeline.stats?.eventCount ?? '') : ''}
          ${timeline ? stat('Timeline End', timeline.endReason || '') : ''}
        </div>
        <div class="line"><b>Recommended:</b> ${esc(classification.recommendedAction || result.metrics?.recommendedLabelAction || '')}</div>
        <div class="line dim">${esc((classification.evidence || []).join(' '))}</div>
        ${falseDw ? `
          <div class="box-title" style="margin-top:10px">Rejected Header Word Evidence</div>
          <div class="table-wrap"><table class="asset-table">
            <thead><tr><th>Request</th><th>Ch</th><th>Rejected Word</th><th>False Z80</th><th>Actual Stream</th><th>Actual Region</th><th>Confidence</th></tr></thead>
            <tbody>${falseDwRows || '<tr><td colspan="7" class="dim">No rejected pointer metadata.</td></tr>'}</tbody>
          </table></div>
        ` : ''}
        ${timeline ? `
          <div class="box-title" style="margin-top:10px">Unlinked Timeline Probe</div>
          <div class="stats">
            ${stat('Consumed Bytes', timeline.stats?.consumedBytes ?? '')}
            ${stat('Frames', timeline.stats?.frameCount ?? '')}
            ${stat('Notes', timeline.stats?.noteEventCount ?? '')}
            ${stat('Duration Cmds', timeline.stats?.durationCommandCount ?? '')}
            ${stat('Opcodes', timeline.stats?.opcodeEventCount ?? '')}
          </div>
          <div class="table-wrap"><table class="asset-table">
            <thead><tr><th>Offset</th><th>Kind</th><th>Frame</th><th>End</th><th>Dur</th><th>Value</th><th>Metadata</th></tr></thead>
            <tbody>${timelineRows || '<tr><td colspan="7" class="dim">No timeline events.</td></tr>'}</tbody>
          </table></div>
        ` : ''}` : '';
      extra.innerHTML = `${renderMusicControls(region, result)}${classBlock}`;
      return;
    }
    extra.innerHTML = '<div class="line dim">Preview type not rendered by this page yet.</div>';
  }

  function focusDecoderAssets(decoderId) {
    const decoder = currentCoverage?.decoders?.find(item => item.id === decoderId);
    if (!decoder) return;
    $('decoder-filter').value = decoder.id;
    $('browser-filter').value = decoder.familyId || '';
    applyFilters();
    $('browser-list').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function focusDecoderRegions(decoderId) {
    const decoder = currentCoverage?.decoders?.find(item => item.id === decoderId);
    if (!decoder) return;
    labelQueueFilters.decoder = decoder.id;
    labelQueueFilters.family = '';
    labelQueueFilters.labelState = '';
    labelQueueFilters.tag = '';
    labelQueueFilters.regionIds = null;
    labelQueueFilters.regionListLabel = '';
    renderLabelQueue();
    $('label-queue').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function focusDecoderLabels(decoderId) {
    const decoder = currentCoverage?.decoders?.find(item => item.id === decoderId);
    if (!decoder) return;
    labelQueueFilters.decoder = decoder.id;
    labelQueueFilters.family = '';
    labelQueueFilters.labelState = 'needs_any';
    labelQueueFilters.tag = '';
    labelQueueFilters.regionIds = null;
    labelQueueFilters.regionListLabel = '';
    renderLabelQueue();
    $('label-queue').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function applyInitialUrlFilters() {
    const params = new URLSearchParams(window.location.search || '');
    const decoderId = params.get('decoder') || '';
    const familyId = params.get('family') || '';
    const capability = params.get('capability') || '';
    const labels = params.get('labels') || '';
    const query = (params.get('q') || '').trim().toLowerCase();
    if (familyId) {
      decoderBoardFilters.family = familyId;
      labelQueueFilters.family = familyId;
      if ($('browser-filter')) $('browser-filter').value = familyId;
    }
    if (capability) {
      decoderBoardFilters.capability = capability;
      labelQueueFilters.capability = capability;
    }
    if (decoderId) {
      const decoder = currentCoverage?.decoders?.find(item => item.id === decoderId);
      decoderBoardFilters.query = decoderId.toLowerCase();
      labelQueueFilters.decoder = decoderId;
      if ($('decoder-filter')) $('decoder-filter').value = decoderId;
      if (decoder && $('browser-filter')) $('browser-filter').value = decoder.familyId || '';
    }
    if (labels === 'needed') {
      decoderBoardFilters.needsLabels = 'needed';
      labelQueueFilters.labelState = 'needs_any';
    }
    if (query) {
      decoderBoardFilters.query = query;
      labelQueueFilters.query = query;
    }
  }

  async function loadWorldModel() {
    $('browser-list').className = 'empty';
    $('browser-list').innerHTML = 'Loading WORLD asset and decoder state...';
    try {
      const response = await fetch(MODEL_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      currentMap = await response.json();
      currentModel = buildGameDataModel(currentMap);
      currentAssets = currentModel.assets;
      currentRegionIndex = new Map((currentMap.regions || []).filter(region => region?.id).map(region => [region.id, region]));
      currentCoverage = wb3BuildDecoderCoverage(currentMap, currentModel);
      renderStats();
      populateFilters();
      applyInitialUrlFilters();
      renderVisualWorkbench();
      renderDecoderBoard();
      renderLabelQueue();
      renderValidationWorkbench();
      applyFilters();
      $('preview-body').innerHTML = '<div class="line">Select an asset preview. Load the local ROM first for visual/audio probes.</div>';
    } catch (err) {
      $('browser-list').className = 'empty error';
      $('browser-list').innerHTML = `Could not load <code>${esc(MODEL_URL)}</code>: ${esc(err.message || err)}`;
    }
  }

  $('btn-load-browsers').addEventListener('click', loadWorldModel);
  $('browser-filter').addEventListener('change', applyFilters);
  $('kind-filter').addEventListener('change', applyFilters);
  $('source-filter').addEventListener('change', applyFilters);
  $('decoder-filter').addEventListener('change', applyFilters);
  $('browser-search').addEventListener('input', applyFilters);
  $('visual-workbench').addEventListener('click', event => {
    const sceneButton = event.target.closest('.visual-scene-open');
    if (sceneButton) {
      showVisualScene(sceneButton.dataset.sceneId);
      return;
    }
    const zoneButton = event.target.closest('.visual-zone-open');
    if (zoneButton) {
      showVisualZone(zoneButton.dataset.recipeId);
      return;
    }
    const focusButton = event.target.closest('.visual-zone-focus');
    if (focusButton) {
      focusVisualZone(focusButton.dataset.recipeId);
    }
  });
  $('decoder-board').addEventListener('change', event => {
    const control = event.target.closest('.decoder-board-control');
    if (!control) return;
    decoderBoardFilters[control.dataset.filter] = control.value;
    renderDecoderBoard();
  });
  $('decoder-board').addEventListener('input', event => {
    const input = event.target.closest('.decoder-board-search');
    if (!input) return;
    decoderBoardFilters.query = input.value.trim().toLowerCase();
    const cursor = input.selectionStart || input.value.length;
    renderDecoderBoard();
    setTimeout(() => {
      const next = $('decoder-board-search');
      if (!next) return;
      next.focus();
      next.setSelectionRange(Math.min(cursor, next.value.length), Math.min(cursor, next.value.length));
    }, 0);
  });
  $('decoder-board').addEventListener('click', event => {
    const button = event.target.closest('.decoder-focus');
    if (button) focusDecoderAssets(button.dataset.decoderId);
    const regionButton = event.target.closest('.decoder-region-focus');
    if (regionButton) focusDecoderRegions(regionButton.dataset.decoderId);
    const labelButton = event.target.closest('.decoder-label-focus');
    if (labelButton) focusDecoderLabels(labelButton.dataset.decoderId);
    const validateButton = event.target.closest('.decoder-validate');
    if (validateButton) {
      validateDecoder(validateButton.dataset.decoderId);
      renderValidationWorkbench();
      $('validation-workbench').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
  $('validation-workbench').addEventListener('click', event => {
    if (event.target.closest('#btn-validate-workbench-targets')) {
      validateTargetDecoders();
      return;
    }
    if (event.target.closest('#btn-workbench-labels')) {
      showWorkbenchTargetLabels($('workbench-target-search')?.value || '');
      return;
    }
    const button = event.target.closest('.workbench-validate-decoder');
    if (button) {
      validateDecoder(button.dataset.decoderId);
      renderValidationWorkbench();
      return;
    }
    const blockerButton = event.target.closest('.validation-blocker-focus');
    if (blockerButton) {
      showValidationBlockerRegions(blockerButton.dataset.decoderId, blockerButton.dataset.blocker);
      return;
    }
    const proofButton = event.target.closest('.validation-proof-focus');
    if (proofButton) {
      showValidationProofRegions(proofButton.dataset.decoderId, proofButton.dataset.proofBucket);
      return;
    }
    const coreProofButton = event.target.closest('.validation-core-proof-focus');
    if (coreProofButton) {
      showValidationCoreProofRegions(coreProofButton.dataset.decoderId, coreProofButton.dataset.proofBucket);
      return;
    }
    const coreButton = event.target.closest('.validation-core-focus');
    if (coreButton) {
      showValidationCoreBlockerRegions(coreButton.dataset.decoderId);
    }
  });
  $('validation-workbench').addEventListener('input', event => {
    const input = event.target.closest('#workbench-target-search');
    if (!input) return;
    showWorkbenchTargetLabels(input.value);
  });
  $('label-queue').addEventListener('change', event => {
    const control = event.target.closest('.label-queue-control');
    if (!control) return;
    labelQueueFilters[control.dataset.filter] = control.value;
    renderLabelQueue();
  });
  $('label-queue').addEventListener('input', event => {
    const input = event.target.closest('.label-queue-search');
    if (!input) return;
    labelQueueFilters.query = input.value.trim().toLowerCase();
    renderLabelQueue();
  });
  $('label-queue').addEventListener('click', event => {
    const clearTargets = event.target.closest('.label-queue-clear-targets');
    if (clearTargets) {
      labelQueueFilters.targetOnly = false;
      renderLabelQueue();
      return;
    }
    const clearRegionList = event.target.closest('.label-queue-clear-region-list');
    if (clearRegionList) {
      labelQueueFilters.regionIds = null;
      labelQueueFilters.regionListLabel = '';
      renderLabelQueue();
      return;
    }
    const button = event.target.closest('.asset-preview');
    if (button) renderPreview(button.dataset.assetId, button.dataset.decoderId);
  });
  $('rom-file').addEventListener('change', event => readRomFile(event.target.files?.[0]));
  $('browser-list').addEventListener('click', event => {
    const button = event.target.closest('.asset-preview');
    if (button) renderPreview(button.dataset.assetId, button.dataset.decoderId);
  });
  $('preview-body').addEventListener('click', event => {
    const focusButton = event.target.closest('.visual-zone-focus');
    if (focusButton) focusVisualZone(focusButton.dataset.recipeId);
  });
  window.addEventListener('beforeunload', stopAudioPreview);

  loadWorldModel();
})();
