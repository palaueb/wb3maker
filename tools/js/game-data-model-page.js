'use strict';

(function () {
  const MODEL_URL = '../projects/WORLD/map.json';

  let currentModel = null;
  let currentMap = null;
  let currentAssets = [];

  const DEFAULT_DOMAINS = [
    {
      id: 'rooms_screens',
      label: 'Rooms & Screens',
      purpose: 'Scenes, screen_prog streams, room data, zone recipes, maps, events and transitions.',
      kinds: ['scene_recipe', 'screen', 'room_data', 'vram_load_plan'],
    },
    {
      id: 'graphics_tiles',
      label: 'Graphics & Tiles',
      purpose: 'Raw tile source regions, tile loaders, dynamic tile uploads and VRAM slot provenance.',
      kinds: ['graphics_data', 'vram_load_plan'],
    },
    {
      id: 'sprites_animation',
      label: 'Sprites & Animation',
      purpose: 'Metasprites, animated sprite frame streams, entity graphics, player forms and OAM-facing data.',
      kinds: ['entity_data'],
      keywords: ['sprite', 'animation', 'metasprite', 'entity', 'player form'],
    },
    {
      id: 'palettes_effects',
      label: 'Palettes & Effects',
      purpose: 'BG/SPR palettes, palette scripts, palette effects, VDP streams and visual runtime effects.',
      kinds: ['palette_data'],
      keywords: ['palette', 'cram', 'vdp', 'effect'],
    },
    {
      id: 'audio',
      label: 'Music & Sound Effects',
      purpose: 'Music entries, SFX streams, audio driver data, PSG/FM events and playback models.',
      kinds: ['audio_data'],
      keywords: ['audio', 'music', 'sfx', 'sound', 'psg', 'fm'],
    },
    {
      id: 'code_mechanics',
      label: 'Code & Mechanics',
      purpose: 'ASM routines grouped by gameplay mechanic and later clean JavaScript engine modules.',
      kinds: ['gameplay_routine', 'rom_region'],
      keywords: ['routine', 'mechanic', 'code', 'label'],
    },
    {
      id: 'ram_state',
      label: 'RAM & Game State',
      purpose: 'RAM symbols, runtime state fields, player state, room state, inventory and mapper state.',
      kinds: ['ram_symbol'],
      keywords: ['ram', 'state', 'life', 'form', 'zone'],
    },
    {
      id: 'runtime_observations',
      label: 'Runtime Observations',
      purpose: 'Watchpoints, debugger traces, unresolved regions, runtime proof plans and closure evidence.',
      kinds: ['runtime_observation'],
      keywords: ['watch', 'trace', 'runtime', 'residual', 'observation'],
    },
    {
      id: 'debug_cheats',
      label: 'Debug & Cheats',
      purpose: 'Local trainer/debug recipes for reaching states faster without patching or distributing ROM data.',
      kinds: ['cheat_recipe'],
      keywords: ['cheat', 'debug', 'trainer'],
    },
  ];

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

  function classifyStage(asset) {
    const status = String(asset.status || '').toLowerCase();
    if (status.includes('render') || status.includes('harness') || status.includes('debug_tool')) return 'usable';
    if (status.includes('confirmed')) return 'confirmed';
    if (status.includes('pending')) return 'pending';
    if (status.includes('partial')) return 'partial';
    return 'mapped';
  }

  function getDomains() {
    const configured = currentMap?.gameDataModel?.domains;
    return Array.isArray(configured) && configured.length ? configured : DEFAULT_DOMAINS;
  }

  function assetMatchesDomain(asset, domain) {
    if ((domain.kinds || []).includes(asset.kind)) return true;
    const text = assetSearchText(asset);
    return (domain.keywords || []).some(word => text.includes(String(word).toLowerCase()));
  }

  function renderStats(model) {
    const summary = model.summary;
    const configuredAssetCount = Array.isArray(currentMap?.gameDataModel?.assets) ? currentMap.gameDataModel.assets.length : 0;
    const derivedAssetCount = Math.max(0, summary.assetCount - configuredAssetCount);
    const decoderCoverage = typeof wb3BuildDecoderCoverage === 'function'
      ? wb3BuildDecoderCoverage(currentMap, model)
      : null;
    const stageCounts = {};
    for (const asset of model.assets) {
      const stage = classifyStage(asset);
      stageCounts[stage] = (stageCounts[stage] || 0) + 1;
    }
    $('gdm-stats').innerHTML = [
      stat('Working Assets', summary.assetCount),
      stat('Curated Seeds', configuredAssetCount),
      stat('Derived Assets', derivedAssetCount),
      stat('Decoder Done', decoderCoverage ? `${decoderCoverage.summary.weightedImplementationPercent}%` : 'n/a'),
      stat('Asset Types', summary.assetKindCount),
      stat('References', `${summary.resolvedReferenceCount}/${summary.referenceCount}`),
      stat('ROM Regions', summary.regionCount),
      stat('Need Labels', decoderCoverage ? decoderCoverage.summary.labelQueueNeedsLabelUniqueRegionCount : 'n/a'),
      stat('Visual Decoders', decoderCoverage ? decoderCoverage.summary.visualPreviewDecoderCount : 'n/a'),
      stat('Audio Probes', decoderCoverage ? decoderCoverage.summary.audioPreviewDecoderCount : 'n/a'),
      stat('Usable Now', stageCounts.usable || 0),
    ].join('');
  }

  function renderDecoderControl(model) {
    const wrap = $('gdm-decoder-control');
    if (!wrap) return;
    if (typeof gdmRenderDecoderControl !== 'function') {
      wrap.className = 'empty error';
      wrap.innerHTML = 'Decoder control renderer is not available.';
      return;
    }
    wrap.className = '';
    wrap.innerHTML = gdmRenderDecoderControl(model, currentMap);
  }

  function populateKindFilter(model) {
    const select = $('kind-filter');
    const kinds = [...new Set(model.assets.map(asset => asset.kind))].sort();
    select.innerHTML = '<option value="">ALL ASSET TYPES</option>' + kinds.map(kind => {
      const meta = gdmAssetTypeMeta(kind);
      return `<option value="${esc(kind)}">${esc(meta.label)}</option>`;
    }).join('');
    select.disabled = false;
  }

  function assetSearchText(asset) {
    return [
      asset.id,
      asset.kind,
      asset.name,
      asset.status,
      asset.confidence,
      asset.notes,
      asset.summary,
      ...(asset.evidence || []),
      ...(asset.references || []).map(ref => `${ref.kind} ${ref.id || ref.address || ''} ${ref.role || ''} ${ref.label || ''}`),
    ].join(' ').toLowerCase();
  }

  function renderRef(ref) {
    const ok = ref.resolved ? 'ok' : 'warn';
    const id = ref.id || ref.address || '';
    return `<div><span class="pill ${ok}">${ref.resolved ? 'OK' : 'MISSING'}</span> <code>${esc(ref.kind)}</code> ${esc(id)} <span>${esc(ref.role || '')}</span><br><span>${esc(ref.label || '')}</span></div>`;
  }

  function renderAsset(asset) {
    const meta = gdmAssetTypeMeta(asset.kind);
    const stage = classifyStage(asset);
    const evidence = (asset.evidence || []).slice(0, 2).map(e => `<div>${esc(e)}</div>`).join('');
    return `<article class="asset" data-kind="${esc(asset.kind)}">
      <div class="asset-head">
        <div>
          <div class="asset-kind">${esc(meta.label)}</div>
          <div class="asset-name">${esc(asset.name || asset.id)}</div>
        </div>
        <span class="pill ${stage === 'pending' ? 'warn' : 'ok'}">${esc(stage.toUpperCase())}</span>
      </div>
      <div class="notes">
        <code>${esc(asset.id)}</code><br>
        status: ${esc(asset.status)} · confidence: ${esc(asset.confidence)}<br>
        source: ${esc(asset.source || (asset.derived ? 'derived' : 'curated'))}
      </div>
      <div class="notes">${esc(asset.notes || asset.summary || '')}</div>
      ${evidence ? `<div class="refs">${evidence}</div>` : ''}
      <div class="refs">${(asset.references || []).map(renderRef).join('')}</div>
    </article>`;
  }

  function renderDomain(domain, assets) {
    const stageCounts = {};
    for (const asset of assets) {
      const stage = classifyStage(asset);
      stageCounts[stage] = (stageCounts[stage] || 0) + 1;
    }
    const counts = [
      `<span class="pill ok">${assets.length} ASSETS</span>`,
      `<span class="pill">${stageCounts.confirmed || 0} CONFIRMED</span>`,
      `<span class="pill">${stageCounts.usable || 0} USABLE</span>`,
      `<span class="pill ${stageCounts.pending ? 'warn' : ''}">${stageCounts.pending || 0} PENDING</span>`,
    ].join('');
    const content = assets.length
      ? `<div class="domain-assets">${assets.map(renderAsset).join('')}</div>`
      : `<div class="empty">No assets in this section yet.</div>`;
    return `<section class="domain" id="domain-${esc(domain.id)}">
      <div class="domain-head">
        <div>
          <div class="domain-title">${esc(domain.label)}</div>
          <div class="domain-purpose">${esc(domain.purpose || '')}</div>
        </div>
        <div class="domain-counts">${counts}</div>
      </div>
      ${content}
    </section>`;
  }

  function applyFilters() {
    const kind = $('kind-filter').value;
    const query = $('asset-search').value.trim().toLowerCase();
    const filtered = currentAssets.filter(asset => {
      if (kind && asset.kind !== kind) return false;
      if (query && !assetSearchText(asset).includes(query)) return false;
      return true;
    });
    const wrap = $('gdm-assets');
    if (!filtered.length) {
      wrap.className = 'empty';
      wrap.innerHTML = 'No assets match the current filter.';
      return;
    }
    const assigned = new Set();
    const sections = getDomains().map(domain => {
      const assets = filtered.filter(asset => assetMatchesDomain(asset, domain));
      for (const asset of assets) assigned.add(asset.id);
      return renderDomain(domain, assets);
    });
    const otherAssets = filtered.filter(asset => !assigned.has(asset.id));
    if (otherAssets.length) {
      sections.push(renderDomain({
        id: 'other',
        label: 'Other / Unclassified',
        purpose: 'Assets that need a domain assignment before they can move through the reconstruction pipeline.',
      }, otherAssets));
    }
    wrap.className = 'domain-list';
    wrap.innerHTML = sections.join('');
  }

  async function loadWorldModel() {
    const wrap = $('gdm-assets');
    wrap.className = 'empty';
      wrap.innerHTML = 'Loading WORLD asset inventory...';
    try {
      const response = await fetch(MODEL_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const map = await response.json();
      currentMap = map;
      currentModel = buildGameDataModel(map);
      currentAssets = currentModel.assets;
      renderStats(currentModel);
      renderDecoderControl(currentModel);
      populateKindFilter(currentModel);
      $('asset-search').disabled = false;
      applyFilters();
    } catch (err) {
      wrap.className = 'empty error';
      wrap.innerHTML = `Could not load <code>${esc(MODEL_URL)}</code>. Run the local server from the repo root and open this page through it. ${esc(err.message || err)}`;
    }
  }

  $('btn-load-gdm').addEventListener('click', loadWorldModel);
  $('kind-filter').addEventListener('change', applyFilters);
  $('asset-search').addEventListener('input', applyFilters);

  loadWorldModel();
}());
