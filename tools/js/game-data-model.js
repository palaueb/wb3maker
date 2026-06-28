'use strict';

// Canonical, metadata-only view over projects/WORLD/map.json.
// This is intentionally a normalizer/indexer: it does not decode ROM bytes or
// persist derived graphics/audio/pixels.

var GDM_ASSET_TYPES = [
  { kind: 'rom_region', label: 'ROM Region', description: 'A typed ROM interval with confidence and evidence.' },
  { kind: 'ram_symbol', label: 'RAM Symbol', description: 'A named RAM address/range and its known runtime role.' },
  { kind: 'scene_recipe', label: 'Scene Recipe', description: 'A reproducible scene made from loaders, palettes and screen_prog streams.' },
  { kind: 'vram_load_plan', label: 'VRAM Load Plan', description: 'A synthetic VRAM loading plan and provenance summary.' },
  { kind: 'screen', label: 'Screen', description: 'A rendered logical screen or menu surface built from screen_prog data.' },
  { kind: 'room_data', label: 'Room Data', description: 'Zone, room, event or overlay data used by room loading.' },
  { kind: 'graphics_data', label: 'Graphics Data', description: 'Tile/source graphics metadata and loader provenance.' },
  { kind: 'palette_data', label: 'Palette Data', description: 'Palette regions, palette scripts or palette provenance.' },
  { kind: 'entity_data', label: 'Entity Data', description: 'Enemy, item, sprite, metasprite or entity-runtime data.' },
  { kind: 'audio_data', label: 'Audio Data', description: 'Music, SFX, driver or PSG/FM runtime metadata.' },
  { kind: 'gameplay_routine', label: 'Gameplay Routine', description: 'ASM routine or routine family used by reconstructed mechanics.' },
  { kind: 'runtime_observation', label: 'Runtime Observation', description: 'Debugger/watchpoint evidence and pending runtime proof plans.' },
  { kind: 'cheat_recipe', label: 'Cheat Recipe', description: 'Local debugger/trainer RAM operation metadata.' },
];

var gameDataModelState = null;

function gdmAssetTypeMeta(kind) {
  return GDM_ASSET_TYPES.find(t => t.kind === kind) || { kind, label: kind || 'Unknown', description: '' };
}

function gdmArray(value) {
  return Array.isArray(value) ? value : [];
}

function gdmObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function gdmBuildIndexes(sourceMap) {
  const map = gdmObject(sourceMap);
  const indexes = {
    regionsById: new Map(),
    recipesById: new Map(),
    ramById: new Map(),
    ramByAddress: new Map(),
    catalogById: new Map(),
    catalogCollectionById: new Map(),
    regionTypeCounts: {},
    confidenceCounts: {},
  };

  for (const region of gdmArray(map.regions)) {
    if (!region || !region.id) continue;
    indexes.regionsById.set(region.id, region);
    const type = region.type || 'unknown';
    indexes.regionTypeCounts[type] = (indexes.regionTypeCounts[type] || 0) + 1;
    const confidence = region.confidence || 'unknown';
    indexes.confidenceCounts[confidence] = (indexes.confidenceCounts[confidence] || 0) + 1;
  }

  for (const recipe of gdmArray(map.sceneRecipes)) {
    if (recipe && recipe.id) indexes.recipesById.set(recipe.id, recipe);
  }

  for (const ram of gdmArray(map.ram)) {
    if (!ram) continue;
    if (ram.id) indexes.ramById.set(ram.id, ram);
    if (ram.address) indexes.ramByAddress.set(String(ram.address).toUpperCase(), ram);
  }

  for (const [key, value] of Object.entries(map)) {
    if (!/Catalogs$/.test(key) || !Array.isArray(value)) continue;
    for (const catalog of value) {
      if (!catalog || !catalog.id) continue;
      indexes.catalogById.set(catalog.id, catalog);
      indexes.catalogCollectionById.set(catalog.id, key);
    }
  }

  return indexes;
}

function gdmResolveReference(ref, indexes) {
  const r = gdmObject(ref);
  const kind = r.kind || r.type || '';
  const id = r.id || r.regionId || r.recipeId || r.catalogId || r.ramId || '';
  if (kind === 'region') return indexes.regionsById.get(id) || null;
  if (kind === 'sceneRecipe') return indexes.recipesById.get(id) || null;
  if (kind === 'catalog') return indexes.catalogById.get(id) || null;
  if (kind === 'ram') {
    if (id && indexes.ramById.has(id)) return indexes.ramById.get(id);
    if (r.address) return indexes.ramByAddress.get(String(r.address).toUpperCase()) || null;
  }
  return null;
}

function gdmReferenceLabel(ref, indexes) {
  const r = gdmObject(ref);
  const kind = r.kind || r.type || 'ref';
  const id = r.id || r.regionId || r.recipeId || r.catalogId || r.ramId || r.address || '';
  const resolved = gdmResolveReference(r, indexes);
  if (kind === 'region' && resolved) return `${id} ${resolved.name || resolved.type || ''}`.trim();
  if (kind === 'sceneRecipe' && resolved) return `${id} ${resolved.name || ''}`.trim();
  if (kind === 'ram' && resolved) return `${resolved.address || id} ${resolved.name || ''}`.trim();
  if (kind === 'catalog' && resolved) return `${id} (${indexes.catalogCollectionById.get(id) || 'catalog'})`;
  return id ? `${kind}:${id}` : kind;
}

function gdmNormalizeAsset(asset, indexes) {
  const src = gdmObject(asset);
  const refs = gdmArray(src.references).map(ref => {
    const normalized = Object.assign({}, ref);
    normalized.resolved = !!gdmResolveReference(normalized, indexes);
    normalized.label = gdmReferenceLabel(normalized, indexes);
    return normalized;
  });
  const missingRefs = refs.filter(ref => !ref.resolved && ref.required !== false);
  return Object.assign({}, src, {
    id: src.id || `asset_${Math.random().toString(36).slice(2)}`,
    kind: src.kind || 'rom_region',
    status: src.status || 'draft',
    confidence: src.confidence || 'unknown',
    references: refs,
    missingReferenceCount: missingRefs.length,
  });
}

function gdmRegionAssetKind(region) {
  const type = region?.type || 'unknown';
  if (type === 'code') return 'gameplay_routine';
  if (type === 'music' || type === 'audio_driver_data') return 'audio_data';
  if (type === 'screen_prog') return 'screen';
  if (type === 'room_data' || type === 'room_subrecord' || type === 'room_seq_table' || type === 'scroll_map' || type === 'map_screens') return 'room_data';
  if (type === 'palette' || type === 'palette_script' || type === 'palette_script_table' || type === 'vdp_stream' || type === 'effect_script') return 'palette_data';
  if (type === 'gfx_tiles' || type === 'gfx_sprites' || type === 'tile_map' || type === 'dynamic_tile_loader') return 'graphics_data';
  if (type === 'vram_loader_8fb' || type === 'vram_loader_998') return 'vram_load_plan';
  if (type === 'entity_data' || type === 'entity_behavior_table' || type === 'entity_anim_table' || type === 'entity_anim_script' || type === 'meta_sprite' || type === 'item_data') return 'entity_data';
  return 'rom_region';
}

function gdmRegionAssetStatus(region) {
  const type = region?.type || 'unknown';
  const confidence = region?.confidence || '';
  if (type === 'unknown' || type === 'null') return 'pending_classification';
  if (confidence === 'high') return 'confirmed';
  if (confidence === 'low') return 'mapped_low_confidence';
  if (confidence === 'medium' || confidence === 'medium_high') return 'mapped';
  return 'mapped';
}

function gdmCatalogKind(collectionName, catalog) {
  const text = `${collectionName} ${catalog?.id || ''}`.toLowerCase();
  if (text.includes('audio')) return 'audio_data';
  if (text.includes('palette') || text.includes('vdp') || text.includes('effect')) return 'palette_data';
  if (text.includes('sprite') || text.includes('animation') || text.includes('entity') || text.includes('item')) return 'entity_data';
  if (text.includes('room') || text.includes('zone') || text.includes('screen')) return 'room_data';
  if (text.includes('graphics') || text.includes('tile')) return 'graphics_data';
  if (text.includes('player') || text.includes('mechanic') || text.includes('collision') || text.includes('runtime')) return 'runtime_observation';
  return 'runtime_observation';
}

function gdmCatalogSummaryText(catalog) {
  if (typeof catalog?.summary === 'string') return catalog.summary;
  if (catalog?.summary && typeof catalog.summary === 'object') {
    const bits = [];
    for (const [key, value] of Object.entries(catalog.summary).slice(0, 8)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') bits.push(`${key}: ${value}`);
    }
    return bits.join('; ');
  }
  return '';
}

function gdmBuildDerivedAssets(map, indexes, configuredIds) {
  const assets = [];
  for (const region of gdmArray(map.regions)) {
    if (!region || !region.id) continue;
    const type = region.type || 'unknown';
    const offset = region.offset || '';
    const size = region.size ?? '';
    assets.push({
      id: `gdm.derived.region.${region.id}`,
      kind: gdmRegionAssetKind(region),
      name: region.name || `${type} ${region.id}`,
      status: gdmRegionAssetStatus(region),
      confidence: region.confidence || 'unknown',
      derived: true,
      source: 'regions',
      references: [{ kind: 'region', id: region.id, role: 'source_region' }],
      summary: `${type} region at ${offset}, size ${size}`,
      notes: region.notes || '',
    });
  }

  for (const ram of gdmArray(map.ram)) {
    if (!ram || !ram.id) continue;
    assets.push({
      id: `gdm.derived.ram.${ram.id}`,
      kind: 'ram_symbol',
      name: ram.name || `${ram.address || ''} RAM symbol`,
      status: ram.confidence === 'high' ? 'confirmed' : 'mapped',
      confidence: ram.confidence || 'unknown',
      derived: true,
      source: 'ram',
      references: [{ kind: 'ram', id: ram.id, address: ram.address, role: 'ram_symbol' }],
      summary: `${ram.type || 'ram'} ${ram.address || ''}, size ${ram.size ?? ''}`,
      notes: ram.notes || '',
    });
  }

  for (const recipe of gdmArray(map.sceneRecipes)) {
    if (!recipe || !recipe.id) continue;
    assets.push({
      id: `gdm.derived.scene.${recipe.id}`,
      kind: 'scene_recipe',
      name: recipe.name || recipe.id,
      status: 'mapped',
      confidence: recipe.confidence || 'unknown',
      derived: true,
      source: 'sceneRecipes',
      references: [{ kind: 'sceneRecipe', id: recipe.id, role: 'scene_recipe' }],
      summary: `${gdmArray(recipe.steps).length} scene setup steps`,
      notes: recipe.notes || '',
    });
  }

  for (const [collectionName, value] of Object.entries(map)) {
    if (!/Catalogs$/.test(collectionName) || !Array.isArray(value)) continue;
    for (const catalog of value) {
      if (!catalog || !catalog.id) continue;
      assets.push({
        id: `gdm.derived.catalog.${catalog.id}`,
        kind: gdmCatalogKind(collectionName, catalog),
        name: catalog.name || catalog.id,
        status: catalog.confidence === 'high' ? 'confirmed' : 'evidence_catalog',
        confidence: catalog.confidence || 'unknown',
        derived: true,
        source: collectionName,
        references: [{ kind: 'catalog', id: catalog.id, role: 'evidence_catalog' }],
        summary: gdmCatalogSummaryText(catalog),
        notes: catalog.tool ? `Generated by ${catalog.tool}` : '',
      });
    }
  }

  return assets.filter(asset => !configuredIds.has(asset.id));
}

function gdmBuildSummary(sourceMap, indexes, assets) {
  const map = gdmObject(sourceMap);
  const byKind = {};
  const byStatus = {};
  let referenceCount = 0;
  let resolvedReferenceCount = 0;
  for (const asset of assets) {
    byKind[asset.kind] = (byKind[asset.kind] || 0) + 1;
    byStatus[asset.status] = (byStatus[asset.status] || 0) + 1;
    for (const ref of gdmArray(asset.references)) {
      referenceCount++;
      if (ref.resolved) resolvedReferenceCount++;
    }
  }
  return {
    regionCount: gdmArray(map.regions).length,
    ramSymbolCount: gdmArray(map.ram).length,
    sceneRecipeCount: gdmArray(map.sceneRecipes).length,
    catalogCount: indexes.catalogById.size,
    assetCount: assets.length,
    assetKindCount: Object.keys(byKind).length,
    referenceCount,
    resolvedReferenceCount,
    missingReferenceCount: referenceCount - resolvedReferenceCount,
    byKind,
    byStatus,
    regionTypeCounts: indexes.regionTypeCounts,
    confidenceCounts: indexes.confidenceCounts,
  };
}

function buildGameDataModel(sourceMap) {
  const map = gdmObject(sourceMap);
  const configured = gdmObject(map.gameDataModel);
  const indexes = gdmBuildIndexes(map);
  const configuredAssets = gdmArray(configured.assets).map(asset => gdmNormalizeAsset(asset, indexes));
  const configuredIds = new Set(configuredAssets.map(asset => asset.id));
  const derivedAssets = gdmBuildDerivedAssets(map, indexes, configuredIds).map(asset => gdmNormalizeAsset(asset, indexes));
  const assets = configuredAssets.concat(derivedAssets);
  const diagnostics = [];
  for (const asset of assets) {
    if (!asset.id) diagnostics.push({ level: 'error', message: 'Asset without id' });
    if (!asset.kind) diagnostics.push({ level: 'error', assetId: asset.id, message: 'Asset without kind' });
    if (asset.missingReferenceCount) {
      diagnostics.push({
        level: 'warning',
        assetId: asset.id,
        message: `${asset.missingReferenceCount} unresolved required reference(s)`,
      });
    }
  }

  return {
    schemaVersion: 1,
    sourceSchemaVersion: configured.schemaVersion || 0,
    generatedAt: new Date().toISOString(),
    policy: configured.policy || 'Metadata only; no ROM bytes or decoded assets.',
    domains: gdmArray(configured.domains),
    assetTypes: GDM_ASSET_TYPES,
    assets,
    summary: gdmBuildSummary(map, indexes, assets),
    diagnostics,
    indexes,
  };
}

function gdmRefreshModel() {
  gameDataModelState = buildGameDataModel(mapData);
  return gameDataModelState;
}

function gdmEscape(text) {
  return String(text ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function gdmRenderStat(label, value, title) {
  return `<div class="info-item" title="${gdmEscape(title || '')}">
    <div class="info-label">${gdmEscape(label)}</div>
    <div class="info-value">${gdmEscape(value)}</div>
  </div>`;
}

function gdmRenderPill(text, cls) {
  return `<span class="gdm-pill ${gdmEscape(cls || '')}">${gdmEscape(text)}</span>`;
}

function gdmRenderPct(percent) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  return `<div class="gdm-pct" title="${value}% implemented"><div class="gdm-pct-fill" style="width:${value}%"></div><span>${value}%</span></div>`;
}

function gdmDecoderStatusClass(status) {
  if (status === 'implemented') return 'ok';
  if (status === 'partial' || status === 'experimental') return 'progress';
  if (status === 'metadata_only') return '';
  return 'warn';
}

function gdmDecoderCapabilityPills(decoder) {
  const caps = gdmArray(decoder?.previewCapabilities);
  if (!caps.length) return gdmRenderPill('NO PREVIEW', 'warn');
  return caps.map(cap => {
    const cls = cap === 'visual' ? 'ok' : (cap === 'audio' || cap === 'timeline') ? 'progress' : '';
    return gdmRenderPill(cap.toUpperCase(), cls);
  }).join(' ');
}

function gdmAssetBrowserUrl(params) {
  const pairs = Object.entries(params || {})
    .filter(([, value]) => value != null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return `asset-data-browsers.html${pairs.length ? `?${pairs.join('&')}` : ''}`;
}

function gdmRenderDecoderFamilyRow(family) {
  return `<tr>
    <td><b>${gdmEscape(family.label || family.id)}</b><br><code>${gdmEscape(family.id)}</code></td>
    <td>${gdmRenderPct(family.completionPercent)}</td>
    <td>${gdmEscape(family.decoderCount || 0)} decoders<br><span style="color:var(--dim)">${gdmEscape(family.assetCount || 0)} assets</span></td>
    <td>${gdmEscape(family.matchedRegionCount || 0)} regions<br><span style="color:var(--dim)">${gdmEscape(family.needsLabelCount || 0)} need labels</span></td>
    <td>${gdmRenderPill(`${family.visualPreviewCount || 0} VISUAL`, family.visualPreviewCount ? 'ok' : '')} ${gdmRenderPill(`${family.audioPreviewCount || 0} AUDIO`, family.audioPreviewCount ? 'progress' : '')}</td>
  </tr>`;
}

function gdmRenderDecoderRow(decoder) {
  const openUrl = gdmAssetBrowserUrl({ decoder: decoder.id });
  const labelUrl = gdmAssetBrowserUrl({ decoder: decoder.id, labels: 'needed' });
  const audioUrl = gdmArray(decoder.previewCapabilities).includes('audio')
    ? gdmAssetBrowserUrl({ decoder: decoder.id, capability: 'audio' })
    : '';
  return `<tr>
    <td><b>${gdmEscape(decoder.label || decoder.id)}</b><br><code>${gdmEscape(decoder.id)}</code></td>
    <td>${gdmEscape(decoder.familyLabel || decoder.familyId || '')}</td>
    <td>${gdmRenderPct(decoder.implementationPercent)}</td>
    <td>${gdmRenderPill(String(decoder.status || 'unknown').toUpperCase(), gdmDecoderStatusClass(decoder.status))}<br>${gdmDecoderCapabilityPills(decoder)}</td>
    <td>${gdmEscape(decoder.matchedRegionCount || 0)} regions<br><span style="color:var(--dim)">${gdmEscape(decoder.matchedAssetCount || 0)} assets · ${gdmEscape(decoder.needsLabelCount || 0)} need labels</span></td>
    <td>${gdmEscape(decoder.remainingWork || '')}</td>
    <td>
      <a class="gdm-link" href="${gdmEscape(openUrl)}">OPEN</a>
      <a class="gdm-link" href="${gdmEscape(labelUrl)}">LABELS</a>
      ${audioUrl ? `<a class="gdm-link audio" href="${gdmEscape(audioUrl)}">LISTEN</a>` : ''}
    </td>
  </tr>`;
}

function gdmRenderDecoderControl(model, sourceMapOverride) {
  if (typeof wb3BuildDecoderCoverage !== 'function') {
    return `<div class="trace-summary" style="display:block;margin-top:12px"><span class="warn">Decoder registry is not loaded in this analyzer page.</span></div>`;
  }
  const sourceMap = sourceMapOverride || ((typeof mapData !== 'undefined' && mapData) ? mapData : {});
  const coverage = wb3BuildDecoderCoverage(sourceMap, model);
  const families = gdmArray(coverage.families);
  const familyLabels = new Map(families.map(family => [family.id, family.label]));
  const decoders = gdmArray(coverage.decoders)
    .map(decoder => Object.assign({}, decoder, { familyLabel: familyLabels.get(decoder.familyId) || decoder.familyId }))
    .sort((a, b) => String(a.familyLabel).localeCompare(String(b.familyLabel)) || String(a.id).localeCompare(String(b.id)));
  const summary = coverage.summary || {};
  return `<section class="gdm-decoder-control">
    <div class="gdm-decoder-head">
      <div>
        <div class="gdm-decoder-title">Decoder Implementation Control</div>
        <div class="gdm-decoder-note">Percentages track implementation readiness, not ROM byte coverage. Derived assets are generated from regions, RAM, recipes and catalogs at load time; curated seeds are only the manual starting list. OPEN jumps to the working asset browser, LABELS filters the ROM label queue, and LISTEN opens audio-capable probes.</div>
      </div>
      <div class="gdm-decoder-pills">
        ${gdmRenderPill(`${summary.weightedImplementationPercent || 0}% WEIGHTED`, 'progress')}
        ${gdmRenderPill(`${summary.decoderCount || decoders.length} DECODERS`, 'ok')}
        ${gdmRenderPill(`${summary.visualPreviewDecoderCount || 0} VISUAL`, 'ok')}
        ${gdmRenderPill(`${summary.audioPreviewDecoderCount || 0} AUDIO`, 'progress')}
        ${gdmRenderPill(`${summary.labelQueueNeedsLabelUniqueRegionCount || 0} NEED LABELS`, 'warn')}
      </div>
    </div>
    <div class="gdm-decoder-grid">
      <div>
        <div class="gdm-subtitle">Family Readiness</div>
        <div class="gdm-table-wrap compact">
          <table class="region-table">
            <thead><tr><th>FAMILY</th><th>DONE</th><th>INVENTORY</th><th>REGIONS</th><th>PREVIEWS</th></tr></thead>
            <tbody>${families.map(gdmRenderDecoderFamilyRow).join('')}</tbody>
          </table>
        </div>
      </div>
      <div>
        <div class="gdm-subtitle">All Decoders</div>
        <div class="gdm-table-wrap compact">
          <table class="region-table">
            <thead><tr><th>DECODER</th><th>FAMILY</th><th>DONE</th><th>STATUS</th><th>MAPPED</th><th>REMAINING WORK</th><th>WORKBENCH</th></tr></thead>
            <tbody>${decoders.map(gdmRenderDecoderRow).join('')}</tbody>
          </table>
        </div>
      </div>
    </div>
  </section>`;
}

function gdmRenderAssetRow(asset) {
  const meta = gdmAssetTypeMeta(asset.kind);
  const refs = gdmArray(asset.references).slice(0, 5).map(ref => {
    const cls = ref.resolved ? 'ok' : 'warn';
    return `<span class="${cls}" title="${gdmEscape(ref.role || '')}">${gdmEscape(ref.label)}</span>`;
  }).join('<br>');
  const more = asset.references.length > 5 ? `<br><span style="color:var(--dim)">+${asset.references.length - 5} more</span>` : '';
  return `<tr>
    <td><span style="color:var(--accent2)">${gdmEscape(meta.label)}</span><br><code>${gdmEscape(asset.kind)}</code></td>
    <td><b>${gdmEscape(asset.name || asset.id)}</b><br><code>${gdmEscape(asset.id)}</code></td>
    <td>${gdmEscape(asset.status)}<br><span style="color:var(--dim)">${gdmEscape(asset.confidence)}</span></td>
    <td>${refs}${more || ''}</td>
    <td>${gdmEscape(asset.notes || asset.summary || '')}</td>
  </tr>`;
}

function gdmRenderPanel(model) {
  const wrap = document.getElementById('gdm-panel-body');
  if (!wrap) return;
  const m = model || gdmRefreshModel();
  const s = m.summary;
  const sourceMap = (typeof mapData !== 'undefined' && mapData) ? mapData : {};
  const configuredAssetCount = gdmArray(gdmObject(sourceMap.gameDataModel).assets).length;
  const derivedAssetCount = Math.max(0, s.assetCount - configuredAssetCount);
  const decoderControl = gdmRenderDecoderControl(m, sourceMap);
  const kindSummary = Object.entries(s.byKind)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([kind, count]) => `<span style="display:inline-block;margin:0 6px 6px 0;color:var(--accent2)">${gdmEscape(kind)} <b>${count}</b></span>`)
    .join('');
  const diagnostics = m.diagnostics.length
    ? `<div class="trace-summary" style="display:block;margin-top:10px">${m.diagnostics.map(d =>
        `<div class="${d.level === 'error' ? 'warn' : ''}">${gdmEscape(d.level.toUpperCase())}: ${gdmEscape(d.assetId || '')} ${gdmEscape(d.message)}</div>`
      ).join('')}</div>`
    : `<div class="trace-summary" style="display:block;margin-top:10px"><span class="ok">All Game Data Model asset references resolve.</span></div>`;

  wrap.innerHTML = `
    <div style="font-size:11px;color:var(--dim);margin-bottom:10px">${gdmEscape(m.policy)}</div>
    <div class="info-grid">
      ${gdmRenderStat('Working Assets', s.assetCount, 'Curated plus derived Game Data Model assets')}
      ${gdmRenderStat('Curated Seeds', configuredAssetCount, 'Manual assets stored in map.json gameDataModel.assets')}
      ${gdmRenderStat('Derived Assets', derivedAssetCount, 'Generated at load time from regions, RAM, scene recipes and catalogs')}
      ${gdmRenderStat('Asset Types', s.assetKindCount, 'Distinct configured asset kinds')}
      ${gdmRenderStat('Refs OK', `${s.resolvedReferenceCount}/${s.referenceCount}`, 'Resolved asset references')}
      ${gdmRenderStat('Regions', s.regionCount, 'Raw mapped ROM regions available to the model')}
      ${gdmRenderStat('RAM Symbols', s.ramSymbolCount, 'RAM entries available to the model')}
      ${gdmRenderStat('Catalogs', s.catalogCount, 'Top-level generated catalog entries indexed by id')}
    </div>
    ${decoderControl}
    <div style="margin-top:10px;font-size:11px">${kindSummary || '<span style="color:var(--dim)">No configured assets yet.</span>'}</div>
    ${diagnostics}
    <div style="overflow:auto;max-height:380px;margin-top:12px">
      <table class="region-table">
        <thead><tr><th>TYPE</th><th>ASSET</th><th>STATUS</th><th>REFERENCES</th><th>NOTES</th></tr></thead>
        <tbody>${m.assets.map(gdmRenderAssetRow).join('')}</tbody>
      </table>
    </div>`;
}

function gdmRefreshUI() {
  const model = gdmRefreshModel();
  gdmRenderPanel(model);
  return model;
}
