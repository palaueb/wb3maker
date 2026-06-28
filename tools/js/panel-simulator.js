// ═══════════════════════════════════════════════════════════════════════════
//  SMS STATE SIMULATOR
// ═══════════════════════════════════════════════════════════════════════════

function createSMSState() {
  const vram = new Uint8Array(0x4000);
  return {
    vram,  // 16KB: tile patterns [0..$37FF] + name table [$3800..$3FFF]
    cram: new Array(32).fill('#000000'),  // 32 entries: 0-15=BG palette, 16-31=SPR palette
    tileProvenance: new Array(vram.length >> 5).fill(null).map(() => ({ status: 'unresolved' })),
  };
}

function simEscapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function simFindRegionForOffset(offset) {
  if (offset == null || typeof findRegionContainingOffset !== 'function') return null;
  return findRegionContainingOffset(offset);
}

function simMarkImportedVRAMProvenance(state, label) {
  for (let slot = 0; slot < state.tileProvenance.length; slot++) {
    state.tileProvenance[slot] = {
      status: 'imported',
      vramTile: slot,
      source: label || 'Imported VRAM dump',
    };
  }
}

function simRecordTileProvenance(state, startTile, count, info) {
  if (!state.tileProvenance || count <= 0) return;
  const tileCount = state.tileProvenance.length;
  const endTile = startTile + count - 1;
  for (let i = 0; i < count; i++) {
    const tile = startTile + i;
    if (tile < 0 || tile >= tileCount) continue;
    const sourceRomOffset = info.romSrc == null ? null : info.romSrc + i * 32;
    const sourceInRange = info.status !== 'copy' ||
      (sourceRomOffset != null && sourceRomOffset + 32 <= (info.romLength || 0));
    const sourceRegion = sourceInRange ? simFindRegionForOffset(sourceRomOffset) : null;
    const status = sourceInRange ? info.status : 'unresolved';
    state.tileProvenance[tile] = {
      status,
      reason: sourceInRange ? '' : 'source-out-of-range',
      vramTile: tile,
      vramTileRange: { start: startTile, end: endTile, count },
      loaderType: info.loaderType || '',
      loaderRegionId: info.loaderRegionId || '',
      loaderRegionName: info.loaderRegionName || '',
      loaderScriptOffset: info.scriptOffset ?? null,
      loaderEntryOffset: info.entryOffset ?? null,
      entryIndex: info.entryIndex ?? null,
      transform: info.transform || '',
      remapRow: info.remapRow ?? null,
      roomSubrecordIndex: info.roomSubrecordIndex ?? null,
      entityType: info.entityType || '',
      dynamicStreamOffset: info.dynamicStreamOffset ?? null,
      sourceRomOffset: sourceInRange ? sourceRomOffset : null,
      sourceRomRange: sourceInRange && sourceRomOffset != null
        ? { start: sourceRomOffset, end: sourceRomOffset + 31 }
        : null,
      sourceRegionId: sourceRegion?.id || '',
      sourceRegionName: sourceRegion ? (sourceRegion.name || sourceRegion.id || sourceRegion.offset) : '',
    };
  }
}

function simFormatSlotList(slots, maxCount) {
  maxCount = maxCount || 24;
  const shown = slots.slice(0, maxCount)
    .map(s => '$' + s.toString(16).toUpperCase().padStart(3, '0'))
    .join(' ');
  return shown + (slots.length > maxCount ? ` ... +${slots.length - maxCount}` : '');
}

function simAnalyzeNameTableProvenance(state, cols, rows, ntBase) {
  cols = cols || 32;
  rows = rows || 28;
  ntBase = ntBase || 0x3800;
  const ntStrideCols = arguments.length >= 5 && arguments[4] ? arguments[4] : cols;
  const usedSet = new Set();
  const unresolvedSet = new Set();
  const zeroSet = new Set();
  const importedSet = new Set();
  const copySet = new Set();
  const sourceCounts = new Map();
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const ntCell = row * ntStrideCols + col;
    const lo = state.vram[ntBase + ntCell * 2];
    const hi = state.vram[ntBase + ntCell * 2 + 1];
    const tileIdx = lo | ((hi & 0x01) << 8);
    const seenBefore = usedSet.has(tileIdx);
    usedSet.add(tileIdx);
    const prov = state.tileProvenance?.[tileIdx];
    if (!prov || prov.status === 'unresolved') {
      unresolvedSet.add(tileIdx);
      continue;
    }
    if (prov.status === 'zero') zeroSet.add(tileIdx);
    else if (prov.status === 'imported') importedSet.add(tileIdx);
    else if (prov.status === 'copy') {
      copySet.add(tileIdx);
      if (seenBefore) continue;
      const source = prov.sourceRegionName || (prov.sourceRomOffset != null ? hexStr(prov.sourceRomOffset) : 'unknown source');
      const loader = prov.loaderRegionName || prov.loaderRegionId || prov.loaderType || 'unknown loader';
      const key = `${prov.loaderType || 'loader'}|${loader}|${source}`;
      const cur = sourceCounts.get(key) || { loaderType: prov.loaderType || 'loader', loader, source, count: 0 };
      cur.count++;
      sourceCounts.set(key, cur);
    }
  }
  const byNumber = (a, b) => a - b;
  return {
    usedSlots: [...usedSet].sort(byNumber),
    unresolvedSlots: [...unresolvedSet].sort(byNumber),
    zeroSlots: [...zeroSet].sort(byNumber),
    importedSlots: [...importedSet].sort(byNumber),
    copySlots: [...copySet].sort(byNumber),
    sourceCounts: [...sourceCounts.values()].sort((a, b) => b.count - a.count),
  };
}

function simAnalyzeNameTableCellsProvenance(state, cellIndexes, ntBase) {
  ntBase = ntBase || 0x3800;
  const usedSet = new Set();
  const unresolvedSet = new Set();
  const zeroSet = new Set();
  const importedSet = new Set();
  const copySet = new Set();
  const sourceCounts = new Map();
  const cells = [...cellIndexes].sort((a, b) => a - b);
  for (const ntCell of cells) {
    const lo = state.vram[ntBase + ntCell * 2];
    const hi = state.vram[ntBase + ntCell * 2 + 1];
    const tileIdx = lo | ((hi & 0x01) << 8);
    const seenBefore = usedSet.has(tileIdx);
    usedSet.add(tileIdx);
    const prov = state.tileProvenance?.[tileIdx];
    if (!prov || prov.status === 'unresolved') {
      unresolvedSet.add(tileIdx);
      continue;
    }
    if (prov.status === 'zero') zeroSet.add(tileIdx);
    else if (prov.status === 'imported') importedSet.add(tileIdx);
    else if (prov.status === 'copy') {
      copySet.add(tileIdx);
      if (seenBefore) continue;
      const source = prov.sourceRegionName || (prov.sourceRomOffset != null ? hexStr(prov.sourceRomOffset) : 'unknown source');
      const loader = prov.loaderRegionName || prov.loaderRegionId || prov.loaderType || 'unknown loader';
      const key = `${prov.loaderType || 'loader'}|${loader}|${source}`;
      const cur = sourceCounts.get(key) || { loaderType: prov.loaderType || 'loader', loader, source, count: 0 };
      cur.count++;
      sourceCounts.set(key, cur);
    }
  }
  const byNumber = (a, b) => a - b;
  return {
    usedSlots: [...usedSet].sort(byNumber),
    unresolvedSlots: [...unresolvedSet].sort(byNumber),
    zeroSlots: [...zeroSet].sort(byNumber),
    importedSlots: [...importedSet].sort(byNumber),
    copySlots: [...copySet].sort(byNumber),
    sourceCounts: [...sourceCounts.values()].sort((a, b) => b.count - a.count),
  };
}

function simProvenanceSummaryHtml(summary) {
  const resolved = summary.usedSlots.length - summary.unresolvedSlots.length;
  const status = summary.unresolvedSlots.length
    ? `<span style="color:#f87171">unresolved ${summary.unresolvedSlots.length}: ${simFormatSlotList(summary.unresolvedSlots)}</span>`
    : '<span style="color:#4ade80">all used tile slots resolved</span>';
  return ` · provenance ${resolved}/${summary.usedSlots.length} resolved · ${status}` +
    ` · copy ${summary.copySlots.length} · zero ${summary.zeroSlots.length} · imported ${summary.importedSlots.length}`;
}

function simProvenanceLogHtml(summary) {
  const lines = [
    `<div style="color:#4ade80;margin-bottom:3px">VRAM provenance: ${summary.usedSlots.length - summary.unresolvedSlots.length}/${summary.usedSlots.length} used tile slots resolved</div>`,
  ];
  if (summary.unresolvedSlots.length) {
    lines.push(`<div style="color:#f87171;margin-bottom:3px">Unresolved slots: ${simEscapeHtml(simFormatSlotList(summary.unresolvedSlots, 48))}</div>`);
  }
  if (summary.zeroSlots.length) {
    lines.push(`<div style="color:#888;margin-bottom:3px">Zero-filled slots: ${simEscapeHtml(simFormatSlotList(summary.zeroSlots, 48))}</div>`);
  }
  if (summary.sourceCounts.length) {
    lines.push('<div style="color:#4a9eff;margin-bottom:3px">Loader sources:</div>');
    for (const item of summary.sourceCounts.slice(0, 8)) {
      lines.push(`<div style="padding-left:10px;color:var(--dim)">${simEscapeHtml(item.loaderType)} · ${simEscapeHtml(item.loader)} -> ${simEscapeHtml(item.source)} · ${item.count} slot(s)</div>`);
    }
    if (summary.sourceCounts.length > 8) {
      lines.push(`<div style="padding-left:10px;color:#555">... +${summary.sourceCounts.length - 8} more source group(s)</div>`);
    }
  }
  return lines.join('');
}

function simSetProvenanceDiagnostics(summary) {
  const el = document.getElementById('sim-info');
  if (!el || !summary) return;
  const resolved = summary.usedSlots.length - summary.unresolvedSlots.length;
  el.dataset.provenanceUsedSlots = String(summary.usedSlots.length);
  el.dataset.provenanceResolvedSlots = String(resolved);
  el.dataset.provenanceUnresolvedSlots = String(summary.unresolvedSlots.length);
  el.dataset.provenanceCopySlots = String(summary.copySlots.length);
  el.dataset.provenanceZeroSlots = String(summary.zeroSlots.length);
  el.dataset.provenanceImportedSlots = String(summary.importedSlots.length);
  window.simLastProvenanceSummary = summary;
}

function simClearProvenanceDiagnostics() {
  const el = document.getElementById('sim-info');
  if (!el) return;
  delete el.dataset.provenanceUsedSlots;
  delete el.dataset.provenanceResolvedSlots;
  delete el.dataset.provenanceUnresolvedSlots;
  delete el.dataset.provenanceCopySlots;
  delete el.dataset.provenanceZeroSlots;
  delete el.dataset.provenanceImportedSlots;
  window.simLastProvenanceSummary = null;
}

function simDecompressScrollMap(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const b = src[i++];
    if (b === 0xFF) {
      if (i >= src.length || src[i] === 0xFF) { i++; break; } // FF FF = end
      const count = src[i++];
      const val = src[i++];
      for (let k = 0; k < count; k++) out.push(val);
    } else if (b >= 0xE3) {
      const count = b - 0xE0;
      const val = src[i++];
      for (let k = 0; k < count; k++) out.push(val);
    } else {
      out.push(b);
    }
  }
  return new Uint8Array(out);
}

// _LABEL_8FB_ tile pattern loader
// 5-byte entries: [count, vram_lo, vram_hi, src_lo, src_hi]
//   count=0 → END
//   vram tile slot = vram_lo | (vram_hi << 8)  →  VRAM byte offset = slot * 32
//   vram/src word $FFFF → inherit current destination/source pointer
//   bank = src_hi >> 1
//   block_index = ((src_hi & 1) << 8) | src_lo
//   ROM offset = bank * 0x4000 + block_index * 32
function simRunLoader8FB(romData, scriptOffset, state, options) {
  options = options || {};
  const log = [];
  let pc = scriptOffset;
  let entryIndex = 0;
  let curVramTile = 0;
  let curBank = 8;
  let curBlockIdx = 0;
  while (pc + 4 < romData.length) {
    const entryOffset = pc;
    const count = romData[pc++];
    if (count === 0) break;
    const vramLo = romData[pc++], vramHi = romData[pc++];
    const srcLo  = romData[pc++], srcHi  = romData[pc++];
    const vramWord = vramLo | (vramHi << 8);
    const srcWord = srcLo | (srcHi << 8);
    if (vramWord !== 0xFFFF) curVramTile = vramWord;
    if (srcWord !== 0xFFFF) {
      curBank = srcHi >> 1;
      curBlockIdx = ((srcHi & 1) << 8) | srcLo;
    }
    const tileSlot  = curVramTile;
    const vramOff   = tileSlot * 32;
    const bank      = curBank;
    const blockIdx  = curBlockIdx;
    const romOff    = bank * 0x4000 + blockIdx * 32;
    for (let i = 0; i < count * 32; i++) {
      if (vramOff + i < state.vram.length && romOff + i < romData.length)
        state.vram[vramOff + i] = romData[romOff + i];
    }
    simRecordTileProvenance(state, tileSlot, count, {
      status: 'copy',
      loaderType: 'vram_loader_8fb',
      loaderRegionId: options.regionId,
      loaderRegionName: options.regionName,
      scriptOffset,
      entryOffset,
      entryIndex,
      romSrc: romOff,
      romLength: romData.length,
    });
    log.push(`8FB tile[${tileSlot}..${tileSlot+count-1}] ← ROM $${romOff.toString(16).toUpperCase().padStart(5,'0')} (bank ${bank}, block $${blockIdx.toString(16).toUpperCase().padStart(2,'0')})`);
    curVramTile += count;
    curBlockIdx += count;
    entryIndex++;
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
function simRunLoader998(romData, scriptOffset, state, options) {
  options = options || {};
  const log = [];
  let pc = scriptOffset;
  let vramPtr = 0;
  let entryIndex = 0;
  while (pc < romData.length) {
    const entryOffset = pc;
    let b = romData[pc++];
    if (b === 0) break;
    let count = b & 0x7F;
    if (b & 0x80) {
      const tileSlot = romData[pc++];
      vramPtr = tileSlot * 32;
    }
    if (count === 0x7F) {
      const tileStart = vramPtr >> 5;
      for (let i = 0; i < 32 && vramPtr + i < state.vram.length; i++) state.vram[vramPtr + i] = 0;
      simRecordTileProvenance(state, tileStart, 1, {
        status: 'zero',
        loaderType: 'vram_loader_998',
        loaderRegionId: options.regionId,
        loaderRegionName: options.regionName,
        scriptOffset,
        entryOffset,
        entryIndex,
        romSrc: null,
        romLength: romData.length,
      });
      vramPtr += 32;
      log.push(`998 zero-fill → VRAM $${(vramPtr - 32).toString(16).toUpperCase().padStart(4,'0')}`);
      entryIndex++;
      continue;
    }
    if (count === 0) { entryIndex++; continue; } // no-op
    const srcLo = romData[pc++], srcHi = romData[pc++];
    const bank     = srcHi >> 1;
    const blockIdx = ((srcHi & 1) << 8) | srcLo;
    const romOff   = bank * 0x4000 + blockIdx * 32;
    const tileStart = vramPtr >> 5;
    for (let i = 0; i < count * 32; i++) {
      if (vramPtr + i < state.vram.length && romOff + i < romData.length)
        state.vram[vramPtr + i] = romData[romOff + i];
    }
    simRecordTileProvenance(state, tileStart, count, {
      status: 'copy',
      loaderType: 'vram_loader_998',
      loaderRegionId: options.regionId,
      loaderRegionName: options.regionName,
      scriptOffset,
      entryOffset,
      entryIndex,
      romSrc: romOff,
      romLength: romData.length,
    });
    log.push(`998 tile[${tileStart}..${tileStart+count-1}] ← ROM $${romOff.toString(16).toUpperCase().padStart(5,'0')} (bank ${bank}, block $${blockIdx.toString(16).toUpperCase().padStart(2,'0')})`);
    vramPtr += count * 32;
    entryIndex++;
  }
  return log;
}

function simA97DecodeRow(romData, sourceOffset, remapRow) {
  const remapBase = 0x00B4F + (remapRow & 0x03) * 16;
  let l = romData[sourceOffset] || 0;
  let h = romData[sourceOffset + 1] || 0;
  let c = romData[sourceOffset + 2] || 0;
  let b = romData[sourceOffset + 3] || 0;
  let outL = 0, outH = 0, outC = 0, outB = 0;
  for (let px = 0; px < 8; px++) {
    let a = 0;
    let carry = (b >> 7) & 1; b = ((b << 1) & 0xFF) | carry; a = ((a << 1) & 0xFF) | carry;
    carry = (c >> 7) & 1; c = ((c << 1) & 0xFF) | carry; a = ((a << 1) & 0xFF) | carry;
    carry = (h >> 7) & 1; h = ((h << 1) & 0xFF) | carry; a = ((a << 1) & 0xFF) | carry;
    carry = (l >> 7) & 1; l = ((l << 1) & 0xFF) | carry; a = ((a << 1) & 0xFF) | carry;
    const mapped = romData[remapBase + (a & 0x0F)] || 0;
    outL = ((outL << 1) & 0xFF) | (mapped & 1);
    outH = ((outH << 1) & 0xFF) | ((mapped >> 1) & 1);
    outC = ((outC << 1) & 0xFF) | ((mapped >> 2) & 1);
    outB = ((outB << 1) & 0xFF) | ((mapped >> 3) & 1);
  }
  return [outL, outH, outC, outB];
}

// _LABEL_A97_ dynamic tile decode/upload path
// Uses the same _LABEL_9C3_ stream format as _LABEL_998_, but transforms each
// source row through _DATA_B4F_ using the remap row selected from the table word.
function simRunDynamicTileStreamA97(romData, scriptOffset, state, options) {
  options = options || {};
  const log = [];
  let pc = scriptOffset;
  let vramPtr = (options.initialTile ?? 0x56) * 32;
  let entryIndex = 0;
  const remapRow = options.remapRow ?? 0;
  while (pc < romData.length) {
    const entryOffset = pc;
    let b = romData[pc++];
    if (b === 0) break;
    let count = b & 0x7F;
    if (b & 0x80) {
      const tileSlot = romData[pc++];
      vramPtr = tileSlot * 32;
    }
    if (count === 0x7F) {
      const tileStart = vramPtr >> 5;
      for (let i = 0; i < 32 && vramPtr + i < state.vram.length; i++) state.vram[vramPtr + i] = 0;
      simRecordTileProvenance(state, tileStart, 1, {
        status: 'zero',
        loaderType: 'dynamic_tile_loader_a97',
        loaderRegionId: options.regionId,
        loaderRegionName: options.regionName,
        scriptOffset,
        entryOffset,
        entryIndex,
        romSrc: null,
        romLength: romData.length,
        transform: 'a97_remap',
        remapRow,
        roomSubrecordIndex: options.roomSubrecordIndex,
        entityType: options.entityType,
        dynamicStreamOffset: scriptOffset,
      });
      vramPtr += 32;
      log.push(`A97 zero-fill → VRAM $${(vramPtr - 32).toString(16).toUpperCase().padStart(4,'0')}`);
      entryIndex++;
      continue;
    }
    if (count === 0) { entryIndex++; continue; }
    const srcLo = romData[pc++], srcHi = romData[pc++];
    const bank = srcHi >> 1;
    const blockIdx = ((srcHi & 1) << 8) | srcLo;
    const romOff = bank * 0x4000 + blockIdx * 32;
    const tileStart = vramPtr >> 5;
    for (let tile = 0; tile < count; tile++) {
      const srcTileOff = romOff + tile * 32;
      const dstTileOff = vramPtr + tile * 32;
      for (let row = 0; row < 8; row++) {
        const decoded = simA97DecodeRow(romData, srcTileOff + row * 4, remapRow);
        for (let i = 0; i < 4; i++) {
          const dst = dstTileOff + row * 4 + i;
          if (dst < state.vram.length) state.vram[dst] = decoded[i];
        }
      }
    }
    simRecordTileProvenance(state, tileStart, count, {
      status: 'copy',
      loaderType: 'dynamic_tile_loader_a97',
      loaderRegionId: options.regionId,
      loaderRegionName: options.regionName,
      scriptOffset,
      entryOffset,
      entryIndex,
      romSrc: romOff,
      romLength: romData.length,
      transform: 'a97_remap',
      remapRow,
      roomSubrecordIndex: options.roomSubrecordIndex,
      entityType: options.entityType,
      dynamicStreamOffset: scriptOffset,
    });
    log.push(`A97 tile[${tileStart}..${tileStart+count-1}] ← ROM $${romOff.toString(16).toUpperCase().padStart(5,'0')} remap ${remapRow}`);
    vramPtr += count * 32;
    entryIndex++;
  }
  return log;
}

function simFindRoomEntityDynamicTileCatalog() {
  return (mapData.entityDataCatalogs || []).find(c => c.id === 'world-room-entity-dynamic-tile-catalog-2026-06-25') || null;
}

function simApplyRoomEntityDynamicTiles(state, subrecordIndex) {
  if (!romData) return [];
  const catalog = simFindRoomEntityDynamicTileCatalog();
  const room = catalog?.roomSummaries?.find(item => item.subrecordIndex === subrecordIndex);
  if (!room) return [`WARN no room entity dynamic tile metadata for subrecord ${subrecordIndex}`];
  const log = [];
  for (const upload of room.uploads || []) {
    const streamOff = parseHex(upload.streamRomOffset);
    if (streamOff == null) continue;
    const initialTile = parseHex(upload.assignedTileRange?.start) ?? 0x56;
    const region = upload.streamRegion?.id ? mapData.regions.find(r => r.id === upload.streamRegion.id) : simFindRegionForOffset(streamOff);
    log.push(...simRunDynamicTileStreamA97(romData, streamOff, state, {
      initialTile,
      remapRow: upload.remapRow || 0,
      regionId: region?.id || '',
      regionName: region?.name || upload.streamRegion?.name || 'dynamic tile stream',
      roomSubrecordIndex: subrecordIndex,
      entityType: upload.entityType,
    }));
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
function renderSMSState(state, canvas, zoom, options) {
  zoom = zoom || 2;
  options = options || {};
  const COLS = options.cols || 32, ROWS = options.rows || 28, NT_BASE = options.ntBase || 0x3800;
  const NT_STRIDE_COLS = options.ntStrideCols || COLS;
  canvas.width  = COLS * 8 * zoom;
  canvas.height = ROWS * 8 * zoom;
  canvas.style.display = 'block';
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(canvas.width, canvas.height);
  const pxd = img.data;
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    const ntCell = row * NT_STRIDE_COLS + col;
    const entryLo  = state.vram[NT_BASE + ntCell * 2];
    const entryHi  = state.vram[NT_BASE + ntCell * 2 + 1];
    const tileIdx  = entryLo | ((entryHi & 0x01) << 8);
    const hflip    = (entryHi >> 1) & 1;
    const vflip    = (entryHi >> 2) & 1;
    const palSel   = (entryHi >> 3) & 1;
    const cramBase = palSel ? 16 : 0;
    const tOff     = tileIdx * 32;
    if (tOff + 32 > state.vram.length) continue;
    const pixels = decodeTile(state.vram, tOff);
    const bx = col * 8 * zoom, by = row * 8 * zoom;
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

function simGetRenderRowsFromState(state, fullMode) {
  if (!fullMode) return 28;
  const NT_BASE = 0x3800;
  let maxRow = 27;
  for (let row = 31; row >= 28; row--) {
    let hasData = false;
    for (let col = 0; col < 32; col++) {
      const i = row * 32 + col;
      const lo = state.vram[NT_BASE + i * 2];
      const hi = state.vram[NT_BASE + i * 2 + 1];
      if (lo || hi) { hasData = true; break; }
    }
    if (hasData) { maxRow = row; break; }
  }
  return Math.max(28, Math.min(32, maxRow + 1));
}

// ── Scene Gallery ─────────────────────────────────────────────────────────────
function simRecipeStepToSimStep(step) {
  const mappedType = step.sourceStepType || ({
    bg_palette: 'cram_bg',
    sprite_palette: 'cram_spr',
    vram_loader_8fb: 'vram_8fb',
    vram_loader_998: 'vram_998',
    screen_prog: 'nt_604',
  }[step.kind]);
  if (!mappedType) return null;
  return {
    type: mappedType,
    regionId: step.regionId,
    bank: step.bank ?? 7,
  };
}

function simLoadRecipe(idx) {
  const recipe = (mapData.sceneRecipes || [])[idx];
  if (!recipe) return;
  simClearProvenanceDiagnostics();
  simSteps = (recipe.steps || [])
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map(simRecipeStepToSimStep)
    .filter(Boolean);
  simRenderStepsList();
  showToast(`Recipe "${recipe.name}" loaded - ${simSteps.length} steps`);
}

function simLoadRecipeById(recipeId) {
  const idx = (mapData.sceneRecipes || []).findIndex(r => r.id === recipeId);
  if (idx < 0) return false;
  simLoadRecipe(idx);
  return true;
}

function simRenderGallery() {
  const scenes = mapData.simScenes || [];
  const recipes = mapData.sceneRecipes || [];
  const container = document.getElementById('sim-gallery');
  const empty = document.getElementById('sim-gallery-empty');
  if (!container) return;
  if (!scenes.length && !recipes.length) {
    container.innerHTML = '';
    if (empty) empty.style.display = '';
    return;
  }
  if (empty) empty.style.display = 'none';
  const sceneCards = scenes.map((sc, i) => {
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
  });
  const recipeCards = recipes.map((recipe, i) => {
    const stepSummary = (recipe.steps || []).map(s => {
      const type = s.sourceStepType || s.kind || '';
      const colors = {cram_bg:'#ffcc00',cram_spr:'#ffa500',vram_8fb:'#ff6b35',vram_998:'#ff35a0',nt_604:'#00d4ff',bg_palette:'#ffcc00',sprite_palette:'#ffa500',vram_loader_8fb:'#ff6b35',vram_loader_998:'#ff35a0',screen_prog:'#00d4ff'};
      return `<span style="color:${colors[type]||'#aaa'};font-size:9px">${simEscapeHtml(type.toUpperCase())}</span>`;
    }).join(' ');
    return `<div data-recipe-id="${simEscapeHtml(recipe.id || '')}" style="background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:4px;padding:6px;display:flex;flex-direction:column;align-items:center;gap:5px;width:140px;">
      <div style="width:128px;height:56px;background:#10151d;border:1px solid var(--border);border-radius:2px;display:flex;align-items:center;justify-content:center;font-size:10px;color:#7ee787;letter-spacing:1px">RECIPE</div>
      <div style="font-size:11px;color:var(--text);font-weight:bold;text-align:center;width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${simEscapeHtml(recipe.name)}">${simEscapeHtml(recipe.name)}</div>
      <div style="display:flex;flex-wrap:wrap;gap:2px;justify-content:center">${stepSummary}</div>
      <div style="display:flex;gap:3px;">
        <button class="btn small primary" data-recipe-load-id="${simEscapeHtml(recipe.id || '')}" onclick="simLoadRecipe(${i})" title="Load steps from this recipe">LOAD</button>
      </div>
    </div>`;
  });
  container.innerHTML = sceneCards.concat(recipeCards).join('');
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
  if (simImportedVRAM) {
    state.vram.set(simImportedVRAM.slice(0, 0x4000));
    simMarkImportedVRAMProvenance(state);
  }
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
      simRunLoader8FB(romData, off, state, { regionId: r.id, regionName: r.name || r.id });
    } else if (step.type === 'vram_998') {
      simRunLoader998(romData, off, state, { regionId: r.id, regionName: r.name || r.id });
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
  const provSummary = simAnalyzeNameTableProvenance(state, COLS, ROWS, NT_BASE);
  simSetProvenanceDiagnostics(provSummary);
  const slots = provSummary.usedSlots;
  const minSlot = slots[0] ?? 0, maxSlot = slots[slots.length-1] ?? 0;
  const minOff = minSlot * 32, maxOff = maxSlot * 32 + 31;
  const fullMode = !!document.getElementById('sim-full-nt')?.checked;
  const renderRows = simGetRenderRowsFromState(state, fullMode);

  const canvas = document.getElementById('sim-canvas');
  renderSMSState(state, canvas, 2, { rows: renderRows });

  document.getElementById('sim-info').innerHTML =
    `Room ${entry.index} · ${log.length} ops · ` +
    `<span style="color:#00d4ff">Tiles used: ${slots.length} unique · slots ${minSlot}–${maxSlot} · VRAM $${minOff.toString(16).toUpperCase().padStart(4,'0')}–$${maxOff.toString(16).toUpperCase().padStart(4,'0')}</span>` +
    ` · view ${fullMode ? `32×${renderRows}` : '32×28'}${simProvenanceSummaryHtml(provSummary)}`;
  document.getElementById('sim-log').innerHTML =
    `<div style="color:#4a9eff;margin-bottom:3px">VRAM tile slots used: [${slots.map(s=>s.toString(16).toUpperCase().padStart(2,'0')).join(' ')}]</div>` +
    simProvenanceLogHtml(provSummary) +
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
  const loaderTypes = ['vram_loader_8fb','vram_loader_998','gfx_tiles','gfx_sprites'];
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
  simClearProvenanceDiagnostics();
  if (!romData && !simImportedVRAM) { document.getElementById('sim-info').textContent = '⚠ No ROM loaded and no VRAM imported'; return; }
  const state = simBuildBaseState();
  const fullMode = !!document.getElementById('sim-full-nt')?.checked;
  if (simSteps.length === 0 && (simImportedVRAM || simImportedCRAM)) {
    // Just render the imported state
    const canvas = document.getElementById('sim-canvas');
    const renderRows = simGetRenderRowsFromState(state, fullMode);
    renderSMSState(state, canvas, 2, { rows: renderRows });
    const nzVram = state.vram.filter(b => b !== 0).length;
    const provSummary = simAnalyzeNameTableProvenance(state, 32, renderRows, 0x3800);
    simSetProvenanceDiagnostics(provSummary);
    document.getElementById('sim-info').innerHTML =
      `Imported state rendered · VRAM: ${nzVram} non-zero bytes · CRAM: ${state.cram.filter(c=>c!=='#000000').length}/32 colors · view ${fullMode ? `32×${renderRows}` : '32×28'}${simProvenanceSummaryHtml(provSummary)}`;
    document.getElementById('sim-log').innerHTML = simProvenanceLogHtml(provSummary);
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
  const renderRows = simGetRenderRowsFromState(state, fullMode);
  renderSMSState(state, canvas, 2, { rows: renderRows });
  const ntSteps = simSteps.filter(s => s.type === 'nt_604' || s.type === 'nt_604_raw').length;
  const provSummary = simAnalyzeNameTableProvenance(state, 32, renderRows, 0x3800);
  simSetProvenanceDiagnostics(provSummary);
  document.getElementById('sim-info').innerHTML =
    `${simSteps.length} step(s) · ${ntSteps} name table(s) applied · VRAM: ${state.vram.filter(b=>b!==0).length} non-zero bytes · CRAM: ${state.cram.filter(c=>c!=='#000000').length}/32 colors · view ${fullMode ? `32×${renderRows}` : '32×28'}`;
  document.getElementById('sim-info').innerHTML += simProvenanceSummaryHtml(provSummary);
  document.getElementById('sim-log').innerHTML =
    simProvenanceLogHtml(provSummary) +
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
    simClearProvenanceDiagnostics();
    document.getElementById('sim-room-info').textContent = '';
    document.getElementById('sim-import-status').style.display = 'none';
    document.getElementById('sim-vram-status').textContent = '';
    document.getElementById('sim-cram-status').textContent = '';
  });
  simRenderStepsList();
  simRenderGallery();

  document.getElementById('btn-sim-save-scene').addEventListener('click', simSaveScene);

  // Zone browser
  zoneBrowserRenderRecipePicker();
  zoneBrowserRenderEntrySeedPicker();
  document.getElementById('zone-recipe-sel').addEventListener('change', () => {
    const recipe = zoneBrowserSelectedRecipe(document.getElementById('zone-recipe-sel').value || '');
    zoneAudioSetRecipe(recipe, recipe?.dependencies?.audioRequest?.requestId);
  });
  document.getElementById('btn-zone-load-recipe').addEventListener('click', zoneBrowserLoadRecipe);
  document.getElementById('btn-zone-parse').addEventListener('click', zoneBrowserParse);
  document.getElementById('btn-zone-render').addEventListener('click', zoneBrowserRender);
  document.getElementById('btn-zone-audio-preview').addEventListener('click', zoneAudioRenderPreview);
  const audioObservationExportBtn = document.getElementById('btn-zone-audio-export-observations');
  if (audioObservationExportBtn) {
    audioObservationExportBtn.addEventListener('click', zoneAudioExportLocalObservationBundle);
    zoneAudioUpdateObservationExportButton(null);
  }
  const audioOutputModeSel = document.getElementById('zone-audio-output-mode-sel');
  if (audioOutputModeSel) {
    audioOutputModeSel.addEventListener('change', () => {
      const preview = document.getElementById('zone-audio-preview');
      if (preview?.dataset.zoneAudioPreviewEvents) zoneAudioRenderPreview();
      else zoneAudioUpdateObservationExportButton(null);
    });
  }
  const audioRequestGraphPreviewBtn = document.getElementById('btn-audio-request-graph-preview');
  if (audioRequestGraphPreviewBtn) audioRequestGraphPreviewBtn.addEventListener('click', audioRequestGraphRenderPreview);
  const audioRuntimeOutputFixturePreviewBtn = document.getElementById('btn-audio-runtime-output-fixture-preview');
  if (audioRuntimeOutputFixturePreviewBtn) audioRuntimeOutputFixturePreviewBtn.addEventListener('click', audioRuntimeOutputFixtureRenderPreview);
  const bank7SeqPreviewBtn = document.getElementById('btn-bank7-seq-preview');
  if (bank7SeqPreviewBtn) bank7SeqPreviewBtn.addEventListener('click', bank7SequenceRenderPreview);
  const roomEntityOrphanPreviewBtn = document.getElementById('btn-room-entity-orphan-preview');
  if (roomEntityOrphanPreviewBtn) roomEntityOrphanPreviewBtn.addEventListener('click', roomEntityOrphanRenderPreview);
  const roomEntityAssetPreviewBtn = document.getElementById('btn-room-entity-asset-preview');
  if (roomEntityAssetPreviewBtn) roomEntityAssetPreviewBtn.addEventListener('click', roomEntityAssetRenderPreview);
  const roomEntityDynamicPreviewBtn = document.getElementById('btn-room-entity-dynamic-preview');
  if (roomEntityDynamicPreviewBtn) roomEntityDynamicPreviewBtn.addEventListener('click', roomEntityDynamicRenderPreview);
  const dynamicRoutePriorityPreviewBtn = document.getElementById('btn-dynamic-route-priority-preview');
  if (dynamicRoutePriorityPreviewBtn) dynamicRoutePriorityPreviewBtn.addEventListener('click', dynamicRoutePriorityRenderPreview);
  const dynamicGraphicsRuntimeHookPreviewBtn = document.getElementById('btn-dynamic-graphics-runtime-hook-preview');
  if (dynamicGraphicsRuntimeHookPreviewBtn) dynamicGraphicsRuntimeHookPreviewBtn.addEventListener('click', dynamicGraphicsRuntimeHookRenderPreview);
  const dynamicGraphicsRuntimeFixturePreviewBtn = document.getElementById('btn-dynamic-graphics-runtime-fixture-preview');
  if (dynamicGraphicsRuntimeFixturePreviewBtn) dynamicGraphicsRuntimeFixturePreviewBtn.addEventListener('click', dynamicGraphicsRuntimeFixtureRenderPreview);
  const dynamic998A97FrameTracePreviewBtn = document.getElementById('btn-998-a97-frame-trace-preview');
  if (dynamic998A97FrameTracePreviewBtn) dynamic998A97FrameTracePreviewBtn.addEventListener('click', dynamic998A97FrameTraceRenderPreview);
  const a48SelectorTracePreviewBtn = document.getElementById('btn-a48-selector-trace-preview');
  if (a48SelectorTracePreviewBtn) a48SelectorTracePreviewBtn.addEventListener('click', a48SelectorTraceRenderPreview);
  const a48FrameTracePreviewBtn = document.getElementById('btn-a48-frame-trace-preview');
  if (a48FrameTracePreviewBtn) a48FrameTracePreviewBtn.addEventListener('click', a48FrameTraceRenderPreview);
  const playerA97TracePreviewBtn = document.getElementById('btn-player-a97-trace-preview');
  if (playerA97TracePreviewBtn) playerA97TracePreviewBtn.addEventListener('click', playerA97TraceRenderPreview);
  const roomEntityFrameCoveragePreviewBtn = document.getElementById('btn-room-entity-frame-coverage-preview');
  if (roomEntityFrameCoveragePreviewBtn) roomEntityFrameCoveragePreviewBtn.addEventListener('click', roomEntityFrameCoverageRenderPreview);
  const playerStateGraphPreviewBtn = document.getElementById('btn-player-state-graph-preview');
  if (playerStateGraphPreviewBtn) playerStateGraphPreviewBtn.addEventListener('click', playerStateGraphRenderPreview);
}

// ═══════════════════════════════════════════════════════════════════════════
//  AUDIO REQUEST GRAPH PREVIEW
// ═══════════════════════════════════════════════════════════════════════════

function audioRequestGraphCatalogs() {
  const audioCatalogs = mapData.audioCatalogs || [];
  return {
    taxonomy: zoneAudioRequestTaxonomyCatalog(),
    streamGraph: audioCatalogs.find(c => c.id === 'world-audio-stream-graph-catalog-2026-06-25') || null,
    streamSeed: audioCatalogs.find(c => c.id === 'world-audio-stream-seed-catalog-2026-06-25') || null,
    frameStep: audioCatalogs.find(c => c.id === 'world-audio-frame-step-model-catalog-2026-06-25') || null,
    outputRegister: audioCatalogs.find(c => c.id === 'world-audio-output-register-catalog-2026-06-25') || null,
    eventOutput: audioCatalogs.find(c => c.id === 'world-audio-event-output-phase-link-catalog-2026-06-25') || null,
    outputGap: audioCatalogs.find(c => c.id === 'world-audio-event-output-gap-catalog-2026-06-25') || null,
    parameterConsumer: audioCatalogs.find(c => c.id === 'world-audio-stream-parameter-consumer-catalog-2026-06-25') || null,
    resetSeed: audioCatalogs.find(c => c.id === 'world-audio-preview-reset-seed-catalog-2026-06-25') || null,
    zoneUsage: audioCatalogs.find(c => c.id === 'world-zone-audio-graph-link-catalog-2026-06-25') || null,
  };
}

function audioRequestGraphSummaryLine(label, value, extra) {
  return `<span style="display:inline-block;margin-right:12px"><span style="color:#7dd3fc">${simEscapeHtml(label)}</span> ${simEscapeHtml(String(value ?? 0))}${extra ? ` <span style="color:#777">${simEscapeHtml(extra)}</span>` : ''}</span>`;
}

function audioRequestGraphTable(rows) {
  if (!rows.length) return '<div style="color:#f87171">No audio request rows are available.</div>';
  const visible = rows.slice(0, 62);
  const body = visible.map(row => {
    const issues = [];
    if (!row.graph) issues.push('no graph');
    if (!row.seed) issues.push('no seed');
    if (row.missingTargets) issues.push(`${row.missingTargets} missing target(s)`);
    const issueText = issues.length ? issues.join(', ') : 'ok';
    const issueColor = issues.length ? '#fbbf24' : '#7ee787';
    return `<tr>
      <td style="padding:2px 6px;color:#7dd3fc">${simEscapeHtml(row.requestIdHex || '?')}</td>
      <td style="padding:2px 6px">${simEscapeHtml(row.kind || 'unclassified')}</td>
      <td style="padding:2px 6px;color:#999">${simEscapeHtml(row.confidence || '')}</td>
      <td style="padding:2px 6px;text-align:right">${simEscapeHtml(String(row.channelCount ?? 0))}</td>
      <td style="padding:2px 6px;text-align:right">${simEscapeHtml(String(row.reachableStreams ?? 0))}</td>
      <td style="padding:2px 6px;text-align:right">${simEscapeHtml(String(row.branchEdges ?? 0))}</td>
      <td style="padding:2px 6px;text-align:right">${simEscapeHtml(String(row.zoneRecipeCount ?? 0))}</td>
      <td style="padding:2px 6px;color:${issueColor}">${simEscapeHtml(issueText)}</td>
    </tr>`;
  }).join('');
  return `<table style="border-collapse:collapse;width:100%;font-size:10px;margin-top:8px">
    <thead>
      <tr style="color:#999;border-bottom:1px solid var(--border)">
        <th style="text-align:left;padding:2px 6px">request</th>
        <th style="text-align:left;padding:2px 6px">classification</th>
        <th style="text-align:left;padding:2px 6px">conf</th>
        <th style="text-align:right;padding:2px 6px">ch</th>
        <th style="text-align:right;padding:2px 6px">streams</th>
        <th style="text-align:right;padding:2px 6px">branches</th>
        <th style="text-align:right;padding:2px 6px">recipes</th>
        <th style="text-align:left;padding:2px 6px">status</th>
      </tr>
    </thead>
    <tbody>${body}</tbody>
  </table>`;
}

function audioRequestGraphRenderPreview() {
  const out = document.getElementById('audio-request-graph-preview');
  const info = document.getElementById('audio-request-graph-info');
  if (!out) return null;
  const catalogs = audioRequestGraphCatalogs();
  const required = ['taxonomy', 'streamGraph', 'streamSeed', 'frameStep', 'outputRegister', 'eventOutput'];
  const missingCatalogs = required.filter(key => !catalogs[key]);
  const taxonomyRequests = catalogs.taxonomy?.requests || [];
  const graphs = catalogs.streamGraph?.graphs || [];
  const seeds = catalogs.streamSeed?.requests || [];
  const usage = catalogs.zoneUsage?.usageByRequest || [];
  const graphByRequest = new Map(graphs.map(graph => [graph.requestId, graph]));
  const seedByRequest = new Map(seeds.map(seed => [seed.requestId, seed]));
  const usageByRequest = new Map(usage.map(item => [item.requestId, item]));
  const rows = taxonomyRequests.map(req => {
    const graph = graphByRequest.get(req.requestId);
    const seed = seedByRequest.get(req.requestId);
    const use = usageByRequest.get(req.requestId);
    return {
      requestId: req.requestId,
      requestIdHex: req.requestIdHex,
      kind: req.classification?.kind || '',
      confidence: req.classification?.confidence || '',
      channelCount: req.channelCount || 0,
      reachableStreams: graph?.reachableStreamCount || graph?.reachableStreams?.length || req.uniqueStreamCount || 0,
      branchEdges: graph?.branchEdgeCount || graph?.branchEdges?.length || 0,
      missingTargets: graph?.missingTargetCount || 0,
      zoneRecipeCount: use?.recipeCount || req.roomRecipeUsage?.descriptorCount || 0,
      graph,
      seed,
    };
  });
  const missingGraphCount = rows.filter(row => !row.graph).length;
  const missingSeedCount = rows.filter(row => !row.seed).length;
  const graphSummary = catalogs.streamGraph?.summary || {};
  const taxonomySummary = catalogs.taxonomy?.summary || {};
  const seedSummary = catalogs.streamSeed?.summary || {};
  const frameStepSummary = catalogs.frameStep?.summary || {};
  const outputSummary = catalogs.outputRegister?.summary || {};
  const eventOutputSummary = catalogs.eventOutput?.summary || {};
  const outputGapSummary = catalogs.outputGap?.summary || {};
  const parameterConsumerSummary = catalogs.parameterConsumer?.summary || {};
  const resetSummary = catalogs.resetSeed?.summary || {};
  const zoneUsageSummary = catalogs.zoneUsage?.summary || {};
  const validationIssueCount =
    (seedSummary.validationIssueCount || 0) +
    (frameStepSummary.validationIssueCount || 0) +
    (outputSummary.validationIssueCount || 0) +
    (eventOutputSummary.validationIssueCount || 0) +
    (resetSummary.validationIssueCount || 0);
  const warnings = [];
  if (missingCatalogs.length) warnings.push(`missing catalog(s): ${missingCatalogs.join(', ')}`);
  if (missingGraphCount) warnings.push(`${missingGraphCount} request(s) missing stream graph metadata`);
  if (missingSeedCount) warnings.push(`${missingSeedCount} request(s) missing stream seed metadata`);
  if (graphSummary.missingTargetCount) warnings.push(`${graphSummary.missingTargetCount} missing stream graph target(s)`);
  if (validationIssueCount) warnings.push(`${validationIssueCount} audio validation issue(s)`);
  if (zoneUsageSummary.missingGraphRecipeCount) warnings.push(`${zoneUsageSummary.missingGraphRecipeCount} zone recipe(s) missing graph links`);

  const classificationCounts = taxonomySummary.classificationCounts || graphSummary.classificationCounts || {};
  const classText = Object.entries(classificationCounts)
    .map(([key, value]) => `${key.replace(/_candidate$/, '')}:${value}`)
    .join(' · ');
  const summaryHtml = [
    audioRequestGraphSummaryLine('requests', taxonomySummary.requestCount || rows.length),
    audioRequestGraphSummaryLine('graphs', graphSummary.requestGraphCount || graphs.length),
    audioRequestGraphSummaryLine('streams', graphSummary.uniqueReachableStreams || 0, 'unique'),
    audioRequestGraphSummaryLine('branches', graphSummary.totalBranchEdges || 0),
    audioRequestGraphSummaryLine('zone-used', zoneUsageSummary.uniqueLinkedRequestCount || 0),
    audioRequestGraphSummaryLine('seeds', seedSummary.headerChannelSeedCount || 0, 'channels'),
    audioRequestGraphSummaryLine('output phases', outputSummary.phaseCount || 0, `${outputSummary.writeCount || 0} writes`),
    audioRequestGraphSummaryLine('event links', eventOutputSummary.linkedEventKindCount || 0, `${eventOutputSummary.totalDirectOutputPhaseLinks || 0} direct`),
    audioRequestGraphSummaryLine('output gaps', outputGapSummary.parameterOutputConsumerGapCount || 0, `${outputGapSummary.controlFlowOnlyUnlinkedEventCount || 0} control`),
    audioRequestGraphSummaryLine('indirect params', parameterConsumerSummary.linkedParameterEventKindCount || 0, `${parameterConsumerSummary.primaryOutputPhaseCount || 0} phases`),
  ].join('');
  if (info) {
    info.textContent = warnings.length
      ? `warnings: ${warnings.join('; ')}`
      : `${rows.length} request(s) · ${graphSummary.uniqueReachableStreams || 0} unique stream(s) · ${outputSummary.phaseCount || 0} output phase(s)`;
  }
  out.innerHTML = `
    <div style="color:#7dd3fc;margin-bottom:4px">Catalog-backed audio request graph preview</div>
    <div>${summaryHtml}</div>
    <div style="margin-top:4px;color:#888">classification ${simEscapeHtml(classText || 'none')}</div>
    <div style="margin-top:4px;color:#888">frame step ${simEscapeHtml(String(frameStepSummary.maxFramesPerChannel || 0))} frame cap/channel · ${simEscapeHtml(String(frameStepSummary.traceOperationCount || 0))} trace operation(s) · reset preview ${simEscapeHtml(String(resetSummary.previewedRequestCount || 0))} request(s)</div>
    ${warnings.length ? `<div style="margin-top:4px;color:#fbbf24">${warnings.map(simEscapeHtml).join('; ')}</div>` : ''}
    ${audioRequestGraphTable(rows)}
  `;
  out.dataset.audioRequestGraphCatalogBacked = missingCatalogs.length ? '0' : '1';
  out.dataset.audioRequestGraphPreviewOk = warnings.length ? '0' : '1';
  out.dataset.audioRequestGraphRequestCount = String(taxonomySummary.requestCount || rows.length);
  out.dataset.audioRequestGraphGraphCount = String(graphSummary.requestGraphCount || graphs.length);
  out.dataset.audioRequestGraphMissingGraphCount = String(missingGraphCount);
  out.dataset.audioRequestGraphMissingTargetCount = String(graphSummary.missingTargetCount || 0);
  out.dataset.audioRequestGraphUniqueStreamCount = String(graphSummary.uniqueReachableStreams || 0);
  out.dataset.audioRequestGraphBranchingRequestCount = String(graphSummary.requestGraphsWithBranches || 0);
  out.dataset.audioRequestGraphBranchEdgeCount = String(graphSummary.totalBranchEdges || 0);
  out.dataset.audioRequestGraphZoneLinkedRequestCount = String(zoneUsageSummary.uniqueLinkedRequestCount || 0);
  out.dataset.audioRequestGraphZoneMissingGraphRecipeCount = String(zoneUsageSummary.missingGraphRecipeCount || 0);
  out.dataset.audioRequestGraphSeedRequestCount = String(seedSummary.requestSeedCount || 0);
  out.dataset.audioRequestGraphSeedChannelCount = String(seedSummary.headerChannelSeedCount || 0);
  out.dataset.audioRequestGraphMissingSeedRequestCount = String(missingSeedCount);
  out.dataset.audioRequestGraphSeedValidationIssueCount = String(seedSummary.validationIssueCount || 0);
  out.dataset.audioRequestGraphFrameStepValidationIssueCount = String(frameStepSummary.validationIssueCount || 0);
  out.dataset.audioRequestGraphFrameStepMaxFramesPerChannel = String(frameStepSummary.maxFramesPerChannel || 0);
  out.dataset.audioRequestGraphTraceOperationCount = String(frameStepSummary.traceOperationCount || 0);
  out.dataset.audioRequestGraphOutputPhaseCount = String(outputSummary.phaseCount || 0);
  out.dataset.audioRequestGraphPsgPhaseCount = String(outputSummary.psgPhaseCount || 0);
  out.dataset.audioRequestGraphFmPhaseCount = String(outputSummary.fmPhaseCount || 0);
  out.dataset.audioRequestGraphOutputWriteCount = String(outputSummary.writeCount || 0);
  out.dataset.audioRequestGraphEventOutputLinkedKindCount = String(eventOutputSummary.linkedEventKindCount || 0);
  out.dataset.audioRequestGraphEventOutputDirectPhaseLinkCount = String(eventOutputSummary.totalDirectOutputPhaseLinks || 0);
  out.dataset.audioRequestGraphParameterOutputConsumerGapCount = String(outputGapSummary.parameterOutputConsumerGapCount || 0);
  out.dataset.audioRequestGraphControlFlowOnlyUnlinkedEventCount = String(outputGapSummary.controlFlowOnlyUnlinkedEventCount || 0);
  out.dataset.audioRequestGraphIndirectSupportLookupReadyEventCount = String(outputGapSummary.indirectSupportLookupReadyEventCount || 0);
  out.dataset.audioRequestGraphIndirectParameterConsumerLinkCount = String(parameterConsumerSummary.linkedParameterEventKindCount || 0);
  out.dataset.audioRequestGraphIndirectParameterPrimaryOutputPhaseCount = String(parameterConsumerSummary.primaryOutputPhaseCount || 0);
  out.dataset.audioRequestGraphIndirectParameterValidationIssueCount = String(parameterConsumerSummary.validationIssueCount || 0);
  out.dataset.audioRequestGraphResetPreviewedRequestCount = String(resetSummary.previewedRequestCount || 0);
  out.dataset.audioRequestGraphResetFrameStepUnresolvedFrameCount = String(resetSummary.frameStepUnresolvedFrameCount || 0);
  out.dataset.audioRequestGraphPersistedStreamByteCount = '0';
  out.dataset.audioRequestGraphPersistedRegisterTraceCount = '0';
  out.dataset.audioRequestGraphPersistedSampleCount = '0';
  out.dataset.audioRequestGraphAssetPolicy = 'metadata_only_no_stream_bytes_or_register_traces';
  return {
    previewOk: warnings.length === 0,
    warnings,
    requestCount: taxonomySummary.requestCount || rows.length,
    graphCount: graphSummary.requestGraphCount || graphs.length,
    missingGraphCount,
    missingSeedCount,
    missingTargetCount: graphSummary.missingTargetCount || 0,
    uniqueStreamCount: graphSummary.uniqueReachableStreams || 0,
    outputPhaseCount: outputSummary.phaseCount || 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  AUDIO RUNTIME OUTPUT FIXTURE PREVIEW
// ═══════════════════════════════════════════════════════════════════════════

function audioRuntimeOutputFixtureCatalog() {
  return (mapData.audioCatalogs || []).find(c =>
    c.id === 'world-audio-runtime-output-fixture-catalog-2026-06-26'
  ) || null;
}

function audioRuntimeOutputEventContractCatalog() {
  return (mapData.audioCatalogs || []).find(c =>
    c.id === 'world-audio-runtime-output-event-contract-catalog-2026-06-26'
  ) || null;
}

function audioRuntimeOutputLocalBundleCatalog() {
  return (mapData.audioCatalogs || []).find(c =>
    c.id === 'world-audio-runtime-output-local-bundle-catalog-2026-06-26'
  ) || null;
}

function audioRuntimeOutputFixtureClearPreviewDataset(out) {
  if (!out) return;
  for (const key of Object.keys(out.dataset)) {
    if (key.startsWith('audioRuntimeOutputFixture')) delete out.dataset[key];
  }
}

function audioRuntimeOutputFixtureSortedPhases(catalog) {
  const chipRank = { mixed: 0, psg: 1, fm: 2 };
  return (catalog?.phaseFixtures || []).slice().sort((a, b) =>
    (chipRank[a.chip] ?? 9) - (chipRank[b.chip] ?? 9) ||
    String(a.routineOffset || '').localeCompare(String(b.routineOffset || '')) ||
    String(a.sourcePhaseId || '').localeCompare(String(b.sourcePhaseId || ''))
  );
}

function audioRuntimeOutputFixtureSortedGlobals(catalog) {
  return (catalog?.globalInputFixtures || []).slice().sort((a, b) =>
    String(a.address || '').localeCompare(String(b.address || '')) ||
    String(a.role || '').localeCompare(String(b.role || ''))
  );
}

function audioRuntimeOutputFixturePhaseTable(phases) {
  const body = (phases || []).map(phase => `
    <tr style="border-bottom:1px solid rgba(255,255,255,.04)">
      <td style="padding:2px 6px;color:#cbd5e1">${simEscapeHtml(phase.sourcePhaseId || '')}</td>
      <td style="padding:2px 6px;color:${phase.chip === 'psg' ? '#7dd3fc' : phase.chip === 'fm' ? '#c084fc' : '#fbbf24'}">${simEscapeHtml(phase.chip || '')}</td>
      <td style="padding:2px 6px;color:#fbbf24">${simEscapeHtml(phase.routineOffset || '')}</td>
      <td style="padding:2px 6px;color:#a3e635">${simEscapeHtml(phase.routineRegion?.id || '')}</td>
      <td style="padding:2px 6px;text-align:right;color:#4ade80">${simEscapeHtml(String(phase.writeCount || 0))}</td>
      <td style="padding:2px 6px;color:#93c5fd">${simEscapeHtml((phase.ports || []).join(','))}</td>
      <td style="padding:2px 6px;text-align:right;color:#93c5fd">${simEscapeHtml(String((phase.directEventOutputEdgeIds || []).length))}</td>
      <td style="padding:2px 6px;color:#c4b5fd">${simEscapeHtml(a48SelectorTraceListText(phase.branchIds || [], 2))}</td>
      <td style="padding:2px 6px;color:#94a3b8">${simEscapeHtml(a48SelectorTraceListText(phase.globalInputRoles || [], 3))}</td>
    </tr>
  `).join('');
  return `
    <div style="color:#93c5fd;font-weight:bold;margin:6px 0 3px">Output phase fixtures</div>
    <table style="border-collapse:collapse;min-width:100%;margin-bottom:10px">
      <thead>
        <tr style="color:#888">
          <th style="text-align:left;padding:2px 6px">phase</th>
          <th style="text-align:left;padding:2px 6px">chip</th>
          <th style="text-align:left;padding:2px 6px">offset</th>
          <th style="text-align:left;padding:2px 6px">region</th>
          <th style="text-align:right;padding:2px 6px">writes</th>
          <th style="text-align:left;padding:2px 6px">ports</th>
          <th style="text-align:right;padding:2px 6px">events</th>
          <th style="text-align:left;padding:2px 6px">branch</th>
          <th style="text-align:left;padding:2px 6px">globals</th>
        </tr>
      </thead>
      <tbody>${body || '<tr><td colspan="9" style="padding:2px 6px;color:#888">No audio output phase fixtures</td></tr>'}</tbody>
    </table>
  `;
}

function audioRuntimeOutputFixtureGlobalTable(globals) {
  const body = (globals || []).map(input => `
    <tr style="border-bottom:1px solid rgba(255,255,255,.04)">
      <td style="padding:2px 6px;color:#cbd5e1">${simEscapeHtml(input.role || '')}</td>
      <td style="padding:2px 6px;color:#fbbf24">${simEscapeHtml(input.address || '')}</td>
      <td style="padding:2px 6px;color:#a3e635">${simEscapeHtml(input.ramCatalogEntryId || '')}</td>
      <td style="padding:2px 6px;color:#93c5fd">${simEscapeHtml(input.statusInTimeline || '')}</td>
      <td style="padding:2px 6px;color:#c4b5fd">${simEscapeHtml(input.modelingStatus || '')}</td>
      <td style="padding:2px 6px;text-align:right;color:#4ade80">${simEscapeHtml(String((input.outputPhaseIds || []).length))}</td>
      <td style="padding:2px 6px;text-align:right;color:#94a3b8">${simEscapeHtml(String(input.smokeTimelineRefCount || 0))}</td>
    </tr>
  `).join('');
  return `
    <div style="color:#93c5fd;font-weight:bold;margin:6px 0 3px">Runtime global inputs</div>
    <table style="border-collapse:collapse;min-width:100%">
      <thead>
        <tr style="color:#888">
          <th style="text-align:left;padding:2px 6px">role</th>
          <th style="text-align:left;padding:2px 6px">addr</th>
          <th style="text-align:left;padding:2px 6px">ram</th>
          <th style="text-align:left;padding:2px 6px">timeline</th>
          <th style="text-align:left;padding:2px 6px">model</th>
          <th style="text-align:right;padding:2px 6px">phases</th>
          <th style="text-align:right;padding:2px 6px">refs</th>
        </tr>
      </thead>
      <tbody>${body || '<tr><td colspan="7" style="padding:2px 6px;color:#888">No runtime global inputs</td></tr>'}</tbody>
    </table>
  `;
}

function audioRuntimeOutputEventContractSummaryHtml(contract) {
  if (!contract) return '';
  const summary = contract.summary || {};
  const eventContract = contract.eventContract || {};
  const required = eventContract.requiredEventKeys || [];
  const optional = eventContract.optionalEventKeys || [];
  const forbidden = eventContract.forbiddenPayloadKeys || [];
  const models = contract.derivedModels || [];
  const modelText = models.map(model => model.id || '').filter(Boolean).join(', ');
  const requiredText = required.slice(0, 12).join(', ');
  const optionalText = optional.slice(0, 8).join(', ');
  const forbiddenText = forbidden.slice(0, 12).join(', ');
  return `
    <div style="color:#93c5fd;font-weight:bold;margin:6px 0 3px">Runtime output event contract</div>
    <div style="color:#888;margin-bottom:4px">
      Catalog ${simEscapeHtml(contract.id || '')} · required ${simEscapeHtml(String(summary.requiredEventKeyCount || required.length || 0))} · optional ${simEscapeHtml(String(summary.optionalEventKeyCount || optional.length || 0))} · forbidden ${simEscapeHtml(String(summary.forbiddenPayloadKeyCount || forbidden.length || 0))} · models ${simEscapeHtml(String(summary.derivedModelCount || models.length || 0))}
    </div>
    <div style="padding-left:10px;color:${summary.readyForRuntimeHarness ? '#86efac' : '#fca5a5'}">
      event contract ${summary.readyForRuntimeHarness ? 'ready' : 'blocked'} · validation ${simEscapeHtml(String(summary.validationIssueCount || 0))} issue(s)
    </div>
    <div style="padding-left:10px;color:#94a3b8">required keys ${simEscapeHtml(requiredText)}${required.length > 12 ? `, +${required.length - 12}` : ''}</div>
    <div style="padding-left:10px;color:#94a3b8">optional keys ${simEscapeHtml(optionalText || 'none')}${optional.length > 8 ? `, +${optional.length - 8}` : ''}</div>
    <div style="padding-left:10px;color:#94a3b8">forbidden payload keys ${simEscapeHtml(forbiddenText)}${forbidden.length > 12 ? `, +${forbidden.length - 12}` : ''}</div>
    <div style="padding-left:10px;color:#94a3b8">derived models ${simEscapeHtml(modelText || 'none')}</div>
  `;
}

function audioRuntimeOutputLocalBundleSummaryHtml(catalog) {
  if (!catalog) return '';
  const summary = catalog.summary || {};
  const target = catalog.target || {};
  const templateCommand = target.templateCommand || 'node tools/world-audio-runtime-output-local-bundle.mjs --template --out tmp/local-audio-output-observations.template.json';
  const bundleCommand = target.bundleCommand || 'node tools/world-audio-runtime-output-local-bundle.mjs --observations tmp/local-audio-output-observations.json --out tmp/world-audio-runtime-output-events.local.json';
  const reviewedCommand = target.reviewedBundleCommand || 'node tools/world-audio-runtime-output-local-bundle.mjs --observations tmp/local-audio-output-observations.json --reviewed-runtime-observations --out tmp/world-audio-runtime-output-events.local.json';
  const guardText = [
    summary.rejectsTemplateAsRuntimeEvidence ? 'template guard' : 'template guard missing',
    summary.rejectsReviewedTemplates ? 'review guard' : 'review guard missing',
    summary.rejectsRegisterValue ? 'registerValue rejected' : 'registerValue unchecked',
    summary.rejectsPortValue ? 'portValue rejected' : 'portValue unchecked',
    summary.rejectsHash ? 'hash rejected' : 'hash unchecked',
  ].join(' · ');
  return `
    <div style="color:#93c5fd;font-weight:bold;margin:6px 0 3px">Local audio observation bundle</div>
    <div style="color:#888;margin-bottom:4px">
      Catalog ${simEscapeHtml(catalog.id || '')} · template ${simEscapeHtml(String(summary.templateObservationCount || 0))} observation(s) · phase/write ${simEscapeHtml(String(summary.phaseTemplateObservationCount || 0))}/${simEscapeHtml(String(summary.writeTemplateObservationCount || 0))} · regions ${simEscapeHtml(String(summary.regionParticipationCount || 0))}
    </div>
    <div style="padding-left:10px;color:${summary.readyForRuntimeHarness ? '#86efac' : '#fca5a5'}">
      local bundle ${summary.readyForRuntimeHarness ? 'ready' : 'blocked'} · validation ${simEscapeHtml(String(summary.validationIssueCount || 0))} issue(s) · ${simEscapeHtml(guardText)}
    </div>
    <div style="padding-left:10px;color:#94a3b8">template: ${simEscapeHtml(templateCommand)}</div>
    <div style="padding-left:10px;color:#94a3b8">bundle: ${simEscapeHtml(bundleCommand)}</div>
    <div style="padding-left:10px;color:#94a3b8">reviewed: ${simEscapeHtml(reviewedCommand)}</div>
  `;
}

function audioRuntimeOutputFixtureRenderPreview() {
  const out = document.getElementById('audio-runtime-output-fixture-preview');
  const info = document.getElementById('audio-runtime-output-fixture-info');
  if (!out) return null;
  audioRuntimeOutputFixtureClearPreviewDataset(out);

  const catalog = audioRuntimeOutputFixtureCatalog();
  const eventContract = audioRuntimeOutputEventContractCatalog();
  const localBundleCatalog = audioRuntimeOutputLocalBundleCatalog();
  const summary = catalog?.summary || {};
  const contractSummary = eventContract?.summary || {};
  const localBundleSummary = localBundleCatalog?.summary || {};
  const phases = audioRuntimeOutputFixtureSortedPhases(catalog);
  const globals = audioRuntimeOutputFixtureSortedGlobals(catalog);
  const warnings = [];
  if (!catalog) warnings.push('Audio runtime output fixture catalog is missing.');
  if (catalog && !summary.readyForRuntimeHarness) warnings.push('Audio runtime output fixture validation is not ready.');
  if (!eventContract) warnings.push('Audio runtime output event contract catalog is missing.');
  if (eventContract && !contractSummary.readyForRuntimeHarness) warnings.push('Audio runtime output event contract validation is not ready.');

  const phaseCount = Number(summary.outputPhaseFixtureCount || phases.length || 0);
  const writeCount = Number(summary.portWriteFixtureCount || 0);
  const psgPhaseCount = Number(summary.psgPhaseFixtureCount || 0);
  const fmPhaseCount = Number(summary.fmPhaseFixtureCount || 0);
  const mixedPhaseCount = Number(summary.mixedPhaseFixtureCount || 0);
  const psgWriteCount = Number(summary.psgWriteFixtureCount || 0);
  const fmWriteCount = Number(summary.fmWriteFixtureCount || 0);
  const mixedWriteCount = Number(summary.mixedWriteFixtureCount || 0);
  const eventEdges = Number(summary.directEventOutputEdgeCount || 0);
  const branchCandidates = Number(summary.branchCandidateFixtureCount || 0);
  const globalInputs = Number(summary.globalInputFixtureCount || globals.length || 0);
  const fieldInputs = Number(summary.fieldInputKeyCount || 0);
  const frameOps = Number(summary.frameStepTraceOperationCount || 0);
  const globalRefs = Number(summary.smokeTimelineGlobalInputRefCount || 0);
  const validationIssues = Number(summary.validationIssueCount || 0);
  const eventContractRequiredKeys = Number(contractSummary.requiredEventKeyCount || eventContract?.eventContract?.requiredEventKeys?.length || 0);
  const eventContractOptionalKeys = Number(contractSummary.optionalEventKeyCount || eventContract?.eventContract?.optionalEventKeys?.length || 0);
  const eventContractForbiddenKeys = Number(contractSummary.forbiddenPayloadKeyCount || eventContract?.eventContract?.forbiddenPayloadKeys?.length || 0);
  const eventContractDerivedModels = Number(contractSummary.derivedModelCount || eventContract?.derivedModels?.length || 0);
  const eventContractValidationIssues = Number(contractSummary.validationIssueCount || 0);
  const eventContractReady = eventContract && contractSummary.readyForRuntimeHarness ? 1 : 0;
  const ready = summary.readyForRuntimeHarness ? 1 : 0;
  const assetPolicy = 'metadata_only_no_saved_rom_stream_register_values_register_traces_samples_or_audio_bytes';

  out.dataset.audioRuntimeOutputFixtureCatalogBacked = catalog ? '1' : '0';
  out.dataset.audioRuntimeOutputFixtureCatalogId = catalog?.id || '';
  out.dataset.audioRuntimeOutputFixtureEventContractCatalogBacked = eventContract ? '1' : '0';
  out.dataset.audioRuntimeOutputFixtureEventContractCatalogId = eventContract?.id || '';
  out.dataset.audioRuntimeOutputFixtureEventContractRequiredKeyCount = String(eventContractRequiredKeys);
  out.dataset.audioRuntimeOutputFixtureEventContractOptionalKeyCount = String(eventContractOptionalKeys);
  out.dataset.audioRuntimeOutputFixtureEventContractForbiddenPayloadKeyCount = String(eventContractForbiddenKeys);
  out.dataset.audioRuntimeOutputFixtureEventContractDerivedModelCount = String(eventContractDerivedModels);
  out.dataset.audioRuntimeOutputFixtureEventContractValidationIssueCount = String(eventContractValidationIssues);
  out.dataset.audioRuntimeOutputFixtureEventContractReadyForRuntimeHarness = String(eventContractReady);
  out.dataset.audioRuntimeOutputFixtureLocalBundleCatalogBacked = localBundleCatalog ? '1' : '0';
  out.dataset.audioRuntimeOutputFixtureLocalBundleCatalogId = localBundleCatalog?.id || '';
  out.dataset.audioRuntimeOutputFixtureLocalBundleReady = localBundleSummary.readyForRuntimeHarness ? '1' : '0';
  out.dataset.audioRuntimeOutputFixtureLocalBundleTemplateObservationCount = String(localBundleSummary.templateObservationCount || 0);
  out.dataset.audioRuntimeOutputFixtureLocalBundlePhaseTemplateObservationCount = String(localBundleSummary.phaseTemplateObservationCount || 0);
  out.dataset.audioRuntimeOutputFixtureLocalBundleWriteTemplateObservationCount = String(localBundleSummary.writeTemplateObservationCount || 0);
  out.dataset.audioRuntimeOutputFixtureLocalBundleRejectsRegisterValue = localBundleSummary.rejectsRegisterValue ? '1' : '0';
  out.dataset.audioRuntimeOutputFixtureLocalBundleRejectsPortValue = localBundleSummary.rejectsPortValue ? '1' : '0';
  out.dataset.audioRuntimeOutputFixtureLocalBundleRejectsHash = localBundleSummary.rejectsHash ? '1' : '0';
  out.dataset.audioRuntimeOutputFixtureLocalBundleDefaultTemplatePath = localBundleSummary.defaultTemplatePath || '';
  out.dataset.audioRuntimeOutputFixtureLocalBundleDefaultBundleOutputPath = localBundleSummary.defaultBundleOutputPath || '';
  out.dataset.audioRuntimeOutputFixturePreviewOk = warnings.length ? '0' : '1';
  out.dataset.audioRuntimeOutputFixturePhaseCount = String(phaseCount);
  out.dataset.audioRuntimeOutputFixtureWriteCount = String(writeCount);
  out.dataset.audioRuntimeOutputFixturePsgPhaseCount = String(psgPhaseCount);
  out.dataset.audioRuntimeOutputFixtureFmPhaseCount = String(fmPhaseCount);
  out.dataset.audioRuntimeOutputFixtureMixedPhaseCount = String(mixedPhaseCount);
  out.dataset.audioRuntimeOutputFixturePsgWriteCount = String(psgWriteCount);
  out.dataset.audioRuntimeOutputFixtureFmWriteCount = String(fmWriteCount);
  out.dataset.audioRuntimeOutputFixtureMixedWriteCount = String(mixedWriteCount);
  out.dataset.audioRuntimeOutputFixtureEventEdgeCount = String(eventEdges);
  out.dataset.audioRuntimeOutputFixtureBranchCandidateCount = String(branchCandidates);
  out.dataset.audioRuntimeOutputFixtureGlobalInputCount = String(globalInputs);
  out.dataset.audioRuntimeOutputFixtureFieldInputKeyCount = String(fieldInputs);
  out.dataset.audioRuntimeOutputFixtureFrameStepTraceOperationCount = String(frameOps);
  out.dataset.audioRuntimeOutputFixtureSmokeTimelineGlobalInputRefCount = String(globalRefs);
  out.dataset.audioRuntimeOutputFixtureValidationIssueCount = String(validationIssues);
  out.dataset.audioRuntimeOutputFixtureReadyForRuntimeHarness = String(ready);
  out.dataset.audioRuntimeOutputFixturePersistedRomByteCount = '0';
  out.dataset.audioRuntimeOutputFixturePersistedStreamByteCount = '0';
  out.dataset.audioRuntimeOutputFixturePersistedRegisterValueCount = '0';
  out.dataset.audioRuntimeOutputFixturePersistedRegisterTraceCount = '0';
  out.dataset.audioRuntimeOutputFixturePersistedSampleCount = '0';
  out.dataset.audioRuntimeOutputFixturePersistedAudioByteCount = '0';
  out.dataset.audioRuntimeOutputFixtureAssetPolicy = assetPolicy;

  if (info) {
    info.textContent = warnings.length
      ? `${warnings.length} warning(s)`
      : `${phaseCount} phases · ${writeCount} writes · PSG ${psgPhaseCount}/${psgWriteCount} · FM ${fmPhaseCount}/${fmWriteCount} · fixture ${ready} · contract ${eventContractReady}`;
  }

  if (warnings.length && !catalog) {
    out.innerHTML = warnings.map(warning =>
      `<div style="color:#f87171">${simEscapeHtml(warning)}</div>`
    ).join('');
  } else {
    const portText = Object.entries(summary.portWriteCounts || {})
      .map(([port, count]) => `${port}:${count}`)
      .join(' ');
    out.innerHTML = `
      <div style="color:#888;margin-bottom:6px">
        Catalog ${simEscapeHtml(catalog.id)} · phases ${phaseCount} (${psgPhaseCount} PSG, ${fmPhaseCount} FM, ${mixedPhaseCount} mixed) · writes ${writeCount} (${simEscapeHtml(portText || 'no ports')})
      </div>
      <div style="color:#888;margin-bottom:6px">
        Event edges ${eventEdges}, branch candidates ${branchCandidates}, global inputs ${globalInputs}, field inputs ${fieldInputs}, frame trace ops ${frameOps}, global timeline refs ${globalRefs}. Register values, samples, stream bytes, and ROM bytes are not displayed or saved.
      </div>
      <div style="color:${validationIssues ? '#fca5a5' : '#86efac'};margin-bottom:6px">
        validation ${ready ? 'ready' : 'blocked'} · ${validationIssues} issue(s)
      </div>
      ${audioRuntimeOutputEventContractSummaryHtml(eventContract)}
      ${audioRuntimeOutputLocalBundleSummaryHtml(localBundleCatalog)}
      ${audioRuntimeOutputFixturePhaseTable(phases)}
      ${audioRuntimeOutputFixtureGlobalTable(globals)}
    `;
  }

  return {
    catalogBacked: Boolean(catalog),
    catalogId: catalog?.id || '',
    previewOk: warnings.length === 0,
    phaseCount,
    writeCount,
    psgPhaseCount,
    fmPhaseCount,
    mixedPhaseCount,
    psgWriteCount,
    fmWriteCount,
    mixedWriteCount,
    eventEdgeCount: eventEdges,
    branchCandidateCount: branchCandidates,
    globalInputCount: globalInputs,
    fieldInputKeyCount: fieldInputs,
    frameStepTraceOperationCount: frameOps,
    smokeTimelineGlobalInputRefCount: globalRefs,
    validationIssueCount: validationIssues,
    readyForRuntimeHarness: Boolean(ready),
    eventContractCatalogBacked: Boolean(eventContract),
    eventContractCatalogId: eventContract?.id || '',
    eventContractRequiredKeyCount: eventContractRequiredKeys,
    eventContractOptionalKeyCount: eventContractOptionalKeys,
    eventContractForbiddenPayloadKeyCount: eventContractForbiddenKeys,
    eventContractDerivedModelCount: eventContractDerivedModels,
    eventContractValidationIssueCount: eventContractValidationIssues,
    eventContractReadyForRuntimeHarness: Boolean(eventContractReady),
    localBundleCatalogBacked: Boolean(localBundleCatalog),
    localBundleCatalogId: localBundleCatalog?.id || '',
    localBundleReadyForRuntimeHarness: Boolean(localBundleSummary.readyForRuntimeHarness),
    localBundleTemplateObservationCount: Number(localBundleSummary.templateObservationCount || 0),
    localBundlePhaseTemplateObservationCount: Number(localBundleSummary.phaseTemplateObservationCount || 0),
    localBundleWriteTemplateObservationCount: Number(localBundleSummary.writeTemplateObservationCount || 0),
    localBundleRejectsRegisterValue: Boolean(localBundleSummary.rejectsRegisterValue),
    localBundleRejectsPortValue: Boolean(localBundleSummary.rejectsPortValue),
    localBundleRejectsHash: Boolean(localBundleSummary.rejectsHash),
    warningCount: warnings.length,
    persistedRomByteCount: 0,
    persistedStreamByteCount: 0,
    persistedRegisterValueCount: 0,
    persistedRegisterTraceCount: 0,
    persistedSampleCount: 0,
    persistedAudioByteCount: 0,
    assetPolicy,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  BANK 7 ENTITY SEQUENCE PREVIEW
// ═══════════════════════════════════════════════════════════════════════════

function bank7SequenceCatalog() {
  return (mapData.entityDataCatalogs || []).find(c =>
    c.id === 'world-bank7-entity-sequence-catalog-2026-06-25'
  ) || null;
}

function bank7SequenceOffset(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  return parseHex(value);
}

function bank7SequenceHexByte(value) {
  return '$' + (value & 0xFF).toString(16).toUpperCase().padStart(2, '0');
}

function bank7SequenceHexWord(value) {
  return '$' + (value & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
}

function bank7SequenceReadWord(offset) {
  return romData[offset] | (romData[offset + 1] << 8);
}

function bank7SequenceDecodedCount(layout) {
  const count = Number(layout?.decoded?.recordCount);
  return Number.isFinite(count) && count >= 0 ? count : 0;
}

function bank7SequenceLayoutStatus(layout, expectedKind) {
  const warnings = [];
  const start = bank7SequenceOffset(layout?.romOffset);
  const stride = Number(layout?.recordStrideBytes || layout?.decoded?.recordStrideBytes || 0);
  const count = bank7SequenceDecodedCount(layout);
  const terminatorOffset = bank7SequenceOffset(layout?.decoded?.terminatorOffset);
  if (!layout) warnings.push(`${expectedKind} layout is missing`);
  if (start == null) warnings.push(`${expectedKind} start offset is missing`);
  if (!(stride > 0)) warnings.push(`${expectedKind} record stride is missing`);
  if (!(count > 0)) warnings.push(`${expectedKind} record count is missing`);
  if (start != null && stride > 0 && count > 0 && start + stride * count > romData.length) {
    warnings.push(`${expectedKind} record range exceeds loaded ROM`);
  }
  if (terminatorOffset == null) {
    warnings.push(`${expectedKind} terminator offset is missing`);
  } else if (terminatorOffset < 0 || terminatorOffset >= romData.length) {
    warnings.push(`${expectedKind} terminator offset exceeds loaded ROM`);
  } else if (romData[terminatorOffset] !== 0xFF) {
    warnings.push(`${expectedKind} terminator byte is ${bank7SequenceHexByte(romData[terminatorOffset])}, expected $FF`);
  }
  const catalogWarnings = Array.isArray(layout?.decoded?.warnings) ? layout.decoded.warnings : [];
  for (const warning of catalogWarnings) warnings.push(`${expectedKind} catalog warning: ${warning}`);
  return { start, stride, count, terminatorOffset, warnings };
}

function bank7SequenceDecodeWaypointStream(layout) {
  const status = bank7SequenceLayoutStatus(layout, 'waypoint stream');
  const records = [];
  if (!status.warnings.length) {
    for (let index = 0; index < status.count; index++) {
      const offset = status.start + index * status.stride;
      records.push({
        index,
        offset,
        word0: bank7SequenceReadWord(offset),
        word1: bank7SequenceReadWord(offset + 2),
        word2: bank7SequenceReadWord(offset + 4),
      });
    }
  }
  return { ...status, records };
}

function bank7SequenceDecodeTimingStream(layout) {
  const status = bank7SequenceLayoutStatus(layout, 'timing stream');
  const records = [];
  if (!status.warnings.length) {
    for (let index = 0; index < status.count; index++) {
      const offset = status.start + index * status.stride;
      records.push({
        index,
        offset,
        durationReload: romData[offset],
        timingValue: romData[offset + 1],
      });
    }
  }
  return { ...status, records };
}

function bank7SequenceClearPreviewDataset(out) {
  if (!out) return;
  for (const key of Object.keys(out.dataset)) {
    if (key.startsWith('bank7Sequence')) delete out.dataset[key];
  }
}

function bank7SequenceRenderWaypointTable(decoded, layout) {
  const rows = decoded.records.map(record => `
    <tr>
      <td style="padding:2px 6px;color:#888">${record.index}</td>
      <td style="padding:2px 6px;color:#4a9eff">${hexStr(record.offset)}</td>
      <td style="padding:2px 6px">${bank7SequenceHexWord(record.word0)}</td>
      <td style="padding:2px 6px">${bank7SequenceHexWord(record.word1)}</td>
      <td style="padding:2px 6px">${bank7SequenceHexWord(record.word2)}</td>
    </tr>
  `).join('');
  return `
    <div style="color:#c084fc;font-weight:bold;margin:0 0 3px">Waypoint triplets · ${simEscapeHtml(layout?.sourceLabel || '?')} · ${decoded.records.length} record(s)</div>
    <table style="border-collapse:collapse;margin-bottom:8px">
      <thead>
        <tr style="color:#888">
          <th style="text-align:left;padding:2px 6px">#</th>
          <th style="text-align:left;padding:2px 6px">ROM</th>
          <th style="text-align:left;padding:2px 6px">word0 -> _RAM_C288_</th>
          <th style="text-align:left;padding:2px 6px">word1 -> _RAM_C28A_</th>
          <th style="text-align:left;padding:2px 6px">word2 -> _RAM_C2B8_</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="5" style="padding:2px 6px;color:#888">No decoded records</td></tr>'}</tbody>
    </table>
  `;
}

function bank7SequenceRenderTimingTable(decoded, layout) {
  const rows = decoded.records.map(record => `
    <tr>
      <td style="padding:2px 6px;color:#888">${record.index}</td>
      <td style="padding:2px 6px;color:#4a9eff">${hexStr(record.offset)}</td>
      <td style="padding:2px 6px">${bank7SequenceHexByte(record.durationReload)}</td>
      <td style="padding:2px 6px">${bank7SequenceHexByte(record.timingValue)}</td>
    </tr>
  `).join('');
  return `
    <div style="color:#c084fc;font-weight:bold;margin:0 0 3px">Timing/value pairs · ${simEscapeHtml(layout?.sourceLabel || '?')} · ${decoded.records.length} record(s)</div>
    <table style="border-collapse:collapse">
      <thead>
        <tr style="color:#888">
          <th style="text-align:left;padding:2px 6px">#</th>
          <th style="text-align:left;padding:2px 6px">ROM</th>
          <th style="text-align:left;padding:2px 6px">duration -> _RAM_C2BB_</th>
          <th style="text-align:left;padding:2px 6px">value -> _RAM_C2BA_</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="4" style="padding:2px 6px;color:#888">No decoded records</td></tr>'}</tbody>
    </table>
  `;
}

function bank7SequenceRenderPreview() {
  const out = document.getElementById('bank7-seq-preview');
  const info = document.getElementById('bank7-seq-info');
  if (!out) return null;
  bank7SequenceClearPreviewDataset(out);
  const catalog = bank7SequenceCatalog();
  const layouts = catalog?.streamLayouts || {};
  const waypointLayout = layouts.waypointTripletStream || null;
  const timingLayout = layouts.timingValueStream || null;
  const warnings = [];
  if (!romData || !romData.length) warnings.push('No ROM is loaded.');
  if (!catalog) warnings.push('Bank-7 entity sequence catalog is missing.');
  if (!waypointLayout) warnings.push('Waypoint stream layout is missing from the catalog.');
  if (!timingLayout) warnings.push('Timing stream layout is missing from the catalog.');

  let waypoint = { records: [], warnings: [] };
  let timing = { records: [], warnings: [] };
  if (!warnings.length) {
    waypoint = bank7SequenceDecodeWaypointStream(waypointLayout);
    timing = bank7SequenceDecodeTimingStream(timingLayout);
    warnings.push(...waypoint.warnings, ...timing.warnings);
  }

  const validatedStreams = (waypoint.records.length ? 1 : 0) + (timing.records.length ? 1 : 0);
  const renderedRecordCount = waypoint.records.length + timing.records.length;
  out.dataset.bank7SequenceCatalogBacked = catalog ? '1' : '0';
  out.dataset.bank7SequenceValidatedStreams = String(validatedStreams);
  out.dataset.bank7SequenceWaypointRecordCount = String(waypoint.records.length);
  out.dataset.bank7SequenceTimingRecordCount = String(timing.records.length);
  out.dataset.bank7SequenceWarningCount = String(warnings.length);
  out.dataset.bank7SequenceRenderedRecordCount = String(renderedRecordCount);
  out.dataset.bank7SequencePersistedValueCount = '0';
  out.dataset.bank7SequenceAssetPolicy = 'runtime_values_not_persisted';
  out.dataset.bank7SequenceCatalogId = catalog?.id || '';
  out.dataset.bank7SequencePreviewOk = warnings.length ? '0' : '1';

  if (info) {
    const status = warnings.length
      ? `${warnings.length} warning(s)`
      : `${validatedStreams}/2 stream(s) decoded from local ROM · values not persisted`;
    info.textContent = status;
  }

  if (warnings.length) {
    out.innerHTML = warnings.map(warning =>
      `<div style="color:#f87171">${simEscapeHtml(warning)}</div>`
    ).join('');
  } else {
    const terminators = [
      `waypoint terminator ${hexStr(waypoint.terminatorOffset)}`,
      `timing terminator ${hexStr(timing.terminatorOffset)}`,
    ].join(' · ');
    out.innerHTML =
      `<div style="color:#888;margin-bottom:6px">Catalog ${simEscapeHtml(catalog.id)} · ${simEscapeHtml(terminators)} · metadata-only persistence</div>` +
      bank7SequenceRenderWaypointTable(waypoint, waypointLayout) +
      bank7SequenceRenderTimingTable(timing, timingLayout);
  }
  return {
    catalogBacked: Boolean(catalog),
    validatedStreams,
    waypointRecordCount: waypoint.records.length,
    timingRecordCount: timing.records.length,
    warningCount: warnings.length,
    renderedRecordCount,
    persistedValueCount: 0,
    assetPolicy: 'runtime_values_not_persisted',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  ROOM ENTITY ORPHAN LIST PREVIEW
// ═══════════════════════════════════════════════════════════════════════════

function roomEntityOrphanCatalog() {
  return (mapData.entityDataCatalogs || []).find(c =>
    c.id === 'world-room-entity-orphan-list-catalog-2026-06-25'
  ) || null;
}

function roomEntityOrphanClearPreviewDataset(out) {
  if (!out) return;
  for (const key of Object.keys(out.dataset)) {
    if (key.startsWith('roomEntityOrphan')) delete out.dataset[key];
  }
}

function roomEntityOrphanTypeText(preview) {
  const types = (preview || [])
    .map(record => record.entityType)
    .filter(Boolean);
  return types.length ? types.join(' ') : 'none';
}

function roomEntityOrphanListTable(lists) {
  const rows = (lists || []).slice(0, 24).map((list, index) => `
    <tr>
      <td style="padding:2px 6px;color:#888">${index}</td>
      <td style="padding:2px 6px;color:#4a9eff">${simEscapeHtml(list.startOffset || '?')}</td>
      <td style="padding:2px 6px">${simEscapeHtml(String(list.recordCount ?? 0))}</td>
      <td style="padding:2px 6px">${simEscapeHtml(String(list.normalRecords ?? 0))}</td>
      <td style="padding:2px 6px">${simEscapeHtml(String(list.alternateRecords ?? 0))}</td>
      <td style="padding:2px 6px">${list.terminated ? '<span style="color:#4ade80">yes</span>' : '<span style="color:#f87171">no</span>'}</td>
      <td style="padding:2px 6px;color:#cbd5e1">${simEscapeHtml(roomEntityOrphanTypeText(list.recordPreview))}</td>
    </tr>
  `).join('');
  const more = (lists || []).length > 24
    ? `<div style="color:#777;margin-top:3px">... +${(lists || []).length - 24} more list(s)</div>`
    : '';
  return `
    <div style="color:#fbbf24;font-weight:bold;margin:0 0 3px">Decoded orphan lists</div>
    <table style="border-collapse:collapse;margin-bottom:4px">
      <thead>
        <tr style="color:#888">
          <th style="text-align:left;padding:2px 6px">#</th>
          <th style="text-align:left;padding:2px 6px">list ROM</th>
          <th style="text-align:left;padding:2px 6px">records</th>
          <th style="text-align:left;padding:2px 6px">normal</th>
          <th style="text-align:left;padding:2px 6px">alt</th>
          <th style="text-align:left;padding:2px 6px">term</th>
          <th style="text-align:left;padding:2px 6px">preview entity type ids</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="7" style="padding:2px 6px;color:#888">No decoded lists</td></tr>'}</tbody>
    </table>
    ${more}
  `;
}

function roomEntityOrphanTypeUsageTable(entityTypes) {
  const rows = (entityTypes || []).slice()
    .sort((a, b) => (b.occurrenceCount || 0) - (a.occurrenceCount || 0) || String(a.entityType).localeCompare(String(b.entityType)))
    .slice(0, 18)
    .map(type => `
      <tr>
        <td style="padding:2px 6px;color:#cbd5e1">${simEscapeHtml(type.entityType || '?')}</td>
        <td style="padding:2px 6px">${simEscapeHtml(type.table || '?')}</td>
        <td style="padding:2px 6px">${simEscapeHtml(String(type.tableIndex ?? '?'))}</td>
        <td style="padding:2px 6px;color:#4ade80">${simEscapeHtml(String(type.occurrenceCount ?? 0))}</td>
      </tr>
    `).join('');
  return `
    <div style="color:#fbbf24;font-weight:bold;margin:8px 0 3px">Entity type usage</div>
    <table style="border-collapse:collapse">
      <thead>
        <tr style="color:#888">
          <th style="text-align:left;padding:2px 6px">type</th>
          <th style="text-align:left;padding:2px 6px">table</th>
          <th style="text-align:left;padding:2px 6px">index</th>
          <th style="text-align:left;padding:2px 6px">count</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="4" style="padding:2px 6px;color:#888">No entity type metadata</td></tr>'}</tbody>
    </table>
  `;
}

function roomEntityOrphanRenderPreview() {
  const out = document.getElementById('room-entity-orphan-preview');
  const info = document.getElementById('room-entity-orphan-info');
  if (!out) return null;
  roomEntityOrphanClearPreviewDataset(out);

  const catalog = roomEntityOrphanCatalog();
  const summary = catalog?.summary || {};
  const warnings = [];
  if (!catalog) warnings.push('Room entity orphan-list catalog is missing.');
  if (catalog && summary.regionId !== 'r2820') warnings.push(`Unexpected orphan region id ${summary.regionId || '?'}.`);
  if (catalog && !summary.fullyCoversSpan) warnings.push('Orphan span is not fully covered by decoded lists.');
  if (catalog && summary.warningCount) warnings.push(`${summary.warningCount} catalog warning(s).`);
  if (catalog && summary.subrecordPointerRefsIntoSpan !== 0) warnings.push(`${summary.subrecordPointerRefsIntoSpan} room subrecord pointer ref(s) reach the orphan span.`);

  const listCount = Number(summary.decodedListCount || 0);
  const recordCount = Number(summary.decodedEntityRecords || 0);
  const uniqueTypeCount = Number(summary.uniqueEntityTypeBytes || 0);
  out.dataset.roomEntityOrphanCatalogBacked = catalog ? '1' : '0';
  out.dataset.roomEntityOrphanCatalogId = catalog?.id || '';
  out.dataset.roomEntityOrphanPreviewOk = warnings.length ? '0' : '1';
  out.dataset.roomEntityOrphanRegionId = summary.regionId || '';
  out.dataset.roomEntityOrphanListCount = String(listCount);
  out.dataset.roomEntityOrphanRecordCount = String(recordCount);
  out.dataset.roomEntityOrphanUniqueEntityTypeCount = String(uniqueTypeCount);
  out.dataset.roomEntityOrphanSubrecordPointerRefs = String(summary.subrecordPointerRefsIntoSpan ?? '');
  out.dataset.roomEntityOrphanWarningCount = String(warnings.length);
  out.dataset.roomEntityOrphanFullyCoversSpan = summary.fullyCoversSpan ? '1' : '0';
  out.dataset.roomEntityOrphanPersistedCoordinateCount = '0';
  out.dataset.roomEntityOrphanAssetPolicy = 'metadata_only_no_coordinates';

  if (info) {
    info.textContent = warnings.length
      ? `${warnings.length} warning(s)`
      : `${listCount} list(s), ${recordCount} entity record(s), ${uniqueTypeCount} type id(s) · no coordinates`;
  }

  if (warnings.length) {
    out.innerHTML = warnings.map(warning =>
      `<div style="color:#f87171">${simEscapeHtml(warning)}</div>`
    ).join('');
  } else {
    out.innerHTML = `
      <div style="color:#888;margin-bottom:6px">
        Catalog ${simEscapeHtml(catalog.id)} · region ${simEscapeHtml(summary.regionId || '?')} ${simEscapeHtml(summary.regionOffset || '?')}-${simEscapeHtml(summary.regionEndExclusive || '?')} · subrecord refs ${simEscapeHtml(String(summary.subrecordPointerRefsIntoSpan ?? 0))} · coordinates omitted
      </div>
      ${roomEntityOrphanListTable(catalog.decodedLists || [])}
      ${roomEntityOrphanTypeUsageTable(catalog.entityTypes || [])}
    `;
  }
  return {
    catalogBacked: Boolean(catalog),
    catalogId: catalog?.id || '',
    previewOk: warnings.length === 0,
    listCount,
    recordCount,
    uniqueEntityTypeCount: uniqueTypeCount,
    subrecordPointerRefs: Number(summary.subrecordPointerRefsIntoSpan || 0),
    warningCount: warnings.length,
    fullyCoversSpan: Boolean(summary.fullyCoversSpan),
    persistedCoordinateCount: 0,
    assetPolicy: 'metadata_only_no_coordinates',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  ROOM ENTITY ASSET LINK PREVIEW
// ═══════════════════════════════════════════════════════════════════════════

function roomEntityAssetCatalog() {
  return (mapData.metaspriteCatalogs || []).find(c =>
    c.id === 'world-room-entity-frame-asset-link-catalog-2026-06-25'
  ) || null;
}

function roomEntityAssetClearPreviewDataset(out) {
  if (!out) return;
  for (const key of Object.keys(out.dataset)) {
    if (key.startsWith('roomEntityAsset')) delete out.dataset[key];
  }
}

function roomEntityAssetStatusCounts(links) {
  return (links || []).reduce((acc, link) => {
    const status = link.frameAsset?.status || 'unknown';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
}

function roomEntityAssetDynamicText(dynamicTile) {
  if (!dynamicTile) return '';
  const parts = [
    dynamicTile.tableId || '',
    dynamicTile.tableIndex != null ? `idx ${dynamicTile.tableIndex}` : '',
    dynamicTile.streamRegion?.id ? `stream ${dynamicTile.streamRegion.id}` : '',
  ].filter(Boolean);
  return parts.join(' ');
}

function roomEntityAssetLinkTable(links) {
  const rows = (links || []).slice()
    .sort((a, b) => (a.entityType || 0) - (b.entityType || 0))
    .slice(0, 40)
    .map(link => {
      const frame = link.frameAsset || {};
      const dynamic = roomEntityAssetDynamicText(link.dynamicTile);
      return `
        <tr>
          <td style="padding:2px 6px;color:#cbd5e1">${simEscapeHtml(link.entityTypeHex || '?')}</td>
          <td style="padding:2px 6px;color:#94a3b8">${simEscapeHtml(link.dispatchSelector?.entityTypeHex || '?')}${link.dispatchSelector?.highBitVariant ? ' alt' : ''}</td>
          <td style="padding:2px 6px">${simEscapeHtml(link.usageClass || '?')}</td>
          <td style="padding:2px 6px;color:#fbbf24">${simEscapeHtml(link.dispatch?.label || '')}</td>
          <td style="padding:2px 6px;color:#5eead4">${simEscapeHtml(dynamic || 'none')}</td>
          <td style="padding:2px 6px">${simEscapeHtml(frame.status || '?')}</td>
          <td style="padding:2px 6px;color:#4ade80">${simEscapeHtml(String(frame.subrecordCount || 0))}</td>
          <td style="padding:2px 6px;color:#4ade80">${simEscapeHtml(String(frame.frameRegionCount || 0))}</td>
          <td style="padding:2px 6px;color:#4ade80">${simEscapeHtml(String(frame.pieceRecordCount || 0))}</td>
        </tr>
      `;
    }).join('');
  const more = (links || []).length > 40
    ? `<div style="color:#777;margin-top:3px">... +${(links || []).length - 40} more link(s)</div>`
    : '';
  return `
    <div style="color:#5eead4;font-weight:bold;margin:0 0 3px">Entity asset links</div>
    <table style="border-collapse:collapse;margin-bottom:4px">
      <thead>
        <tr style="color:#888">
          <th style="text-align:left;padding:2px 6px">raw</th>
          <th style="text-align:left;padding:2px 6px">selector</th>
          <th style="text-align:left;padding:2px 6px">usage</th>
          <th style="text-align:left;padding:2px 6px">dispatch</th>
          <th style="text-align:left;padding:2px 6px">dynamic tiles</th>
          <th style="text-align:left;padding:2px 6px">frame status</th>
          <th style="text-align:left;padding:2px 6px">sub</th>
          <th style="text-align:left;padding:2px 6px">regions</th>
          <th style="text-align:left;padding:2px 6px">pieces</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="9" style="padding:2px 6px;color:#888">No asset links</td></tr>'}</tbody>
    </table>
    ${more}
  `;
}

function roomEntityAssetRegionTable(regionUsage) {
  const rows = (regionUsage || []).slice()
    .sort((a, b) => (b.subrecordCount || 0) - (a.subrecordCount || 0) || String(a.region?.id || '').localeCompare(String(b.region?.id || '')))
    .slice(0, 14)
    .map(item => `
      <tr>
        <td style="padding:2px 6px;color:#4a9eff">${simEscapeHtml(item.region?.id || '?')}</td>
        <td style="padding:2px 6px;color:#94a3b8">${simEscapeHtml(item.region?.offset || '?')}</td>
        <td style="padding:2px 6px">${simEscapeHtml(String(item.selectorTypeCount || 0))}</td>
        <td style="padding:2px 6px">${simEscapeHtml(String(item.rawEntityTypeCount || 0))}</td>
        <td style="padding:2px 6px;color:#4ade80">${simEscapeHtml(String(item.subrecordCount || 0))}</td>
        <td style="padding:2px 6px;color:#4ade80">${simEscapeHtml(String(item.pieceRecordCount || 0))}</td>
      </tr>
    `).join('');
  return `
    <div style="color:#5eead4;font-weight:bold;margin:8px 0 3px">Linked frame regions</div>
    <table style="border-collapse:collapse">
      <thead>
        <tr style="color:#888">
          <th style="text-align:left;padding:2px 6px">region</th>
          <th style="text-align:left;padding:2px 6px">offset</th>
          <th style="text-align:left;padding:2px 6px">selectors</th>
          <th style="text-align:left;padding:2px 6px">raw types</th>
          <th style="text-align:left;padding:2px 6px">sub</th>
          <th style="text-align:left;padding:2px 6px">pieces</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="6" style="padding:2px 6px;color:#888">No linked frame regions</td></tr>'}</tbody>
    </table>
  `;
}

function roomEntityAssetRenderPreview() {
  const out = document.getElementById('room-entity-asset-preview');
  const info = document.getElementById('room-entity-asset-info');
  if (!out) return null;
  roomEntityAssetClearPreviewDataset(out);

  const catalog = roomEntityAssetCatalog();
  const summary = catalog?.summary || {};
  const warnings = [];
  if (!catalog) warnings.push('Room entity frame asset link catalog is missing.');
  if (catalog && summary.rawTypesWithAnimationButNoHighConfidenceFrames) {
    warnings.push(`${summary.rawTypesWithAnimationButNoHighConfidenceFrames} animated type(s) lack high-confidence frame subrecords.`);
  }
  const statusCounts = roomEntityAssetStatusCounts(catalog?.links || []);
  const frameLinked = Number(summary.rawTypesWithFrameSubrecords || 0);
  const linkCount = Number(summary.roomEntityTypeLinks || 0);
  out.dataset.roomEntityAssetCatalogBacked = catalog ? '1' : '0';
  out.dataset.roomEntityAssetCatalogId = catalog?.id || '';
  out.dataset.roomEntityAssetPreviewOk = warnings.length ? '0' : '1';
  out.dataset.roomEntityAssetLinkCount = String(linkCount);
  out.dataset.roomEntityAssetRawTypesWithFrameSubrecords = String(frameLinked);
  out.dataset.roomEntityAssetSelectorTypesWithFrameSubrecords = String(summary.selectorTypesWithFrameSubrecords || 0);
  out.dataset.roomEntityAssetAnimationFrameGapCount = String(summary.rawTypesWithAnimationButNoHighConfidenceFrames || 0);
  out.dataset.roomEntityAssetRawTypesWithoutAnimationStart = String(summary.rawTypesWithoutAnimationStart || 0);
  out.dataset.roomEntityAssetHighConfidenceFrameSubrecords = String(summary.highConfidenceFrameSubrecordsLinked || 0);
  out.dataset.roomEntityAssetFrameRegionsLinked = String(summary.frameRegionsLinked || 0);
  out.dataset.roomEntityAssetPersistedAssetByteCount = '0';
  out.dataset.roomEntityAssetPersistedCoordinateCount = '0';
  out.dataset.roomEntityAssetPolicy = 'metadata_only_no_rom_bytes_or_coordinates';

  if (info) {
    info.textContent = warnings.length
      ? `${warnings.length} warning(s)`
      : `${frameLinked}/${linkCount} raw type(s) frame-linked · ${summary.selectorTypesWithFrameSubrecords || 0} selector(s) · ${summary.frameRegionsLinked || 0} frame region(s)`;
  }

  if (warnings.length) {
    out.innerHTML = warnings.map(warning =>
      `<div style="color:#f87171">${simEscapeHtml(warning)}</div>`
    ).join('');
  } else {
    const statusText = Object.keys(statusCounts).sort().map(key => `${key}:${statusCounts[key]}`).join(' ');
    out.innerHTML = `
      <div style="color:#888;margin-bottom:6px">
        Catalog ${simEscapeHtml(catalog.id)} · ${simEscapeHtml(statusText)} · asset bytes and coordinates omitted
      </div>
      ${roomEntityAssetLinkTable(catalog.links || [])}
      ${roomEntityAssetRegionTable(catalog.regionUsage || [])}
    `;
  }
  return {
    catalogBacked: Boolean(catalog),
    catalogId: catalog?.id || '',
    previewOk: warnings.length === 0,
    linkCount,
    rawTypesWithFrameSubrecords: frameLinked,
    selectorTypesWithFrameSubrecords: Number(summary.selectorTypesWithFrameSubrecords || 0),
    animationFrameGapCount: Number(summary.rawTypesWithAnimationButNoHighConfidenceFrames || 0),
    highConfidenceFrameSubrecords: Number(summary.highConfidenceFrameSubrecordsLinked || 0),
    frameRegionsLinked: Number(summary.frameRegionsLinked || 0),
    persistedAssetByteCount: 0,
    persistedCoordinateCount: 0,
    assetPolicy: 'metadata_only_no_rom_bytes_or_coordinates',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  ROOM ENTITY DYNAMIC TILE PREVIEW
// ═══════════════════════════════════════════════════════════════════════════

function roomEntityDynamicCatalog() {
  return (mapData.entityDataCatalogs || []).find(c =>
    c.id === 'world-room-entity-dynamic-tile-catalog-2026-06-25'
  ) || null;
}

function roomEntityDynamicClearPreviewDataset(out) {
  if (!out) return;
  for (const key of Object.keys(out.dataset)) {
    if (key.startsWith('roomEntityDynamic')) delete out.dataset[key];
  }
}

function roomEntityDynamicExpectedSlotCount(room) {
  let total = 0;
  for (const upload of room?.uploads || []) {
    if (upload.assignedTileRange?.count != null) {
      total += Number(upload.assignedTileRange.count || 0);
      continue;
    }
    for (const range of upload.actualWriteRanges || []) total += Number(range.count || 0);
  }
  return total;
}

function roomEntityDynamicRuntimeReplay(catalog) {
  const result = {
    runtimeDecoded: false,
    decodedRoomCount: 0,
    roomsWithUploads: 0,
    runtimeTouchedSlots: 0,
    runtimeCopySlots: 0,
    runtimeZeroSlots: 0,
    runtimeUnresolvedSlots: 0,
    runtimeSourceRegionCount: 0,
    runtimeStreamCount: 0,
    runtimeRemapRows: {},
    catalogExpectedTileSlots: 0,
    runtimeWarningCount: 0,
    warnings: [],
    roomRows: [],
  };
  if (!catalog) return result;
  if (!romData) {
    result.warnings.push('ROM is not loaded; dynamic tile runtime replay is unavailable.');
    result.runtimeWarningCount = result.warnings.length;
    return result;
  }

  const sourceRegions = new Set();
  const streams = new Set();
  const remapRows = new Map();
  for (const room of catalog.roomSummaries || []) {
    const expectedSlots = roomEntityDynamicExpectedSlotCount(room);
    result.catalogExpectedTileSlots += expectedSlots;
    if ((room.uploads || []).length) result.roomsWithUploads++;

    const state = createSMSState();
    const log = simApplyRoomEntityDynamicTiles(state, room.subrecordIndex);
    const dynamicSlots = state.tileProvenance.filter(prov => prov?.loaderType === 'dynamic_tile_loader_a97');
    let copySlots = 0;
    let zeroSlots = 0;
    let unresolvedSlots = 0;
    for (const prov of dynamicSlots) {
      if (prov.status === 'copy') copySlots++;
      else if (prov.status === 'zero') zeroSlots++;
      else unresolvedSlots++;
      if (prov.sourceRegionId) sourceRegions.add(prov.sourceRegionId);
      if (prov.dynamicStreamOffset != null) streams.add(prov.dynamicStreamOffset);
      if (prov.remapRow != null) remapRows.set(prov.remapRow, (remapRows.get(prov.remapRow) || 0) + 1);
    }
    const logWarnings = log.filter(line => /^WARN\b/.test(line)).length;
    if (logWarnings) result.warnings.push(`Subrecord ${room.subrecordIndex} emitted ${logWarnings} warning(s) during A97 replay.`);
    if (expectedSlots !== dynamicSlots.length) {
      result.warnings.push(`Subrecord ${room.subrecordIndex} expected ${expectedSlots} dynamic tile slot(s), replay touched ${dynamicSlots.length}.`);
    }

    result.decodedRoomCount++;
    result.runtimeTouchedSlots += dynamicSlots.length;
    result.runtimeCopySlots += copySlots;
    result.runtimeZeroSlots += zeroSlots;
    result.runtimeUnresolvedSlots += unresolvedSlots;
    result.roomRows.push({
      subrecordIndex: room.subrecordIndex,
      uploadCount: (room.uploads || []).length,
      expectedSlots,
      runtimeTouchedSlots: dynamicSlots.length,
      runtimeUnresolvedSlots: unresolvedSlots,
      finalNextTile: room.finalNextTile || '',
    });
  }

  result.runtimeDecoded = true;
  result.runtimeSourceRegionCount = sourceRegions.size;
  result.runtimeStreamCount = streams.size;
  result.runtimeRemapRows = Object.fromEntries([...remapRows.entries()].sort((a, b) => Number(a[0]) - Number(b[0])));
  result.runtimeWarningCount = result.warnings.length;
  return result;
}

function roomEntityDynamicStreamTable(catalog) {
  const rows = (catalog?.streamUsage || []).slice()
    .sort((a, b) => (b.uploadCount || 0) - (a.uploadCount || 0) || String(a.streamRomOffset || '').localeCompare(String(b.streamRomOffset || '')))
    .slice(0, 18)
    .map(item => `
      <tr>
        <td style="padding:2px 6px;color:#bef264">${simEscapeHtml(item.streamRomOffset || '?')}</td>
        <td style="padding:2px 6px;color:#94a3b8">${simEscapeHtml(item.streamRegion?.id || '?')}</td>
        <td style="padding:2px 6px">${simEscapeHtml(String(item.uploadCount || 0))}</td>
        <td style="padding:2px 6px;color:#4ade80">${simEscapeHtml(String(item.uploadedTileBlocks || 0))}</td>
      </tr>
    `).join('');
  return `
    <div style="color:#bef264;font-weight:bold;margin:0 0 3px">Most used dynamic streams</div>
    <table style="border-collapse:collapse;margin-bottom:4px">
      <thead>
        <tr style="color:#888">
          <th style="text-align:left;padding:2px 6px">stream</th>
          <th style="text-align:left;padding:2px 6px">region</th>
          <th style="text-align:left;padding:2px 6px">uploads</th>
          <th style="text-align:left;padding:2px 6px">tiles</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="4" style="padding:2px 6px;color:#888">No dynamic stream usage</td></tr>'}</tbody>
    </table>
  `;
}

function roomEntityDynamicRoomTable(runtime) {
  const rows = (runtime.roomRows || []).slice()
    .filter(room => room.uploadCount || room.runtimeTouchedSlots)
    .sort((a, b) => b.runtimeTouchedSlots - a.runtimeTouchedSlots || a.subrecordIndex - b.subrecordIndex)
    .slice(0, 18)
    .map(room => `
      <tr>
        <td style="padding:2px 6px;color:#cbd5e1">${simEscapeHtml(String(room.subrecordIndex))}</td>
        <td style="padding:2px 6px">${simEscapeHtml(String(room.uploadCount || 0))}</td>
        <td style="padding:2px 6px;color:#4ade80">${simEscapeHtml(String(room.expectedSlots || 0))}</td>
        <td style="padding:2px 6px;color:#4ade80">${simEscapeHtml(String(room.runtimeTouchedSlots || 0))}</td>
        <td style="padding:2px 6px;color:${room.runtimeUnresolvedSlots ? '#f87171' : '#4ade80'}">${simEscapeHtml(String(room.runtimeUnresolvedSlots || 0))}</td>
        <td style="padding:2px 6px;color:#94a3b8">${simEscapeHtml(room.finalNextTile || '')}</td>
      </tr>
    `).join('');
  return `
    <div style="color:#bef264;font-weight:bold;margin:8px 0 3px">Room replay totals</div>
    <table style="border-collapse:collapse">
      <thead>
        <tr style="color:#888">
          <th style="text-align:left;padding:2px 6px">sub</th>
          <th style="text-align:left;padding:2px 6px">uploads</th>
          <th style="text-align:left;padding:2px 6px">catalog slots</th>
          <th style="text-align:left;padding:2px 6px">runtime slots</th>
          <th style="text-align:left;padding:2px 6px">unresolved</th>
          <th style="text-align:left;padding:2px 6px">next tile</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="6" style="padding:2px 6px;color:#888">No dynamic room uploads</td></tr>'}</tbody>
    </table>
  `;
}

function roomEntityDynamicRenderPreview() {
  const out = document.getElementById('room-entity-dynamic-preview');
  const info = document.getElementById('room-entity-dynamic-info');
  if (!out) return null;
  roomEntityDynamicClearPreviewDataset(out);

  const catalog = roomEntityDynamicCatalog();
  const summary = catalog?.summary || {};
  const runtime = roomEntityDynamicRuntimeReplay(catalog);
  const warnings = [];
  if (!catalog) warnings.push('Room entity dynamic tile catalog is missing.');
  if (catalog && Number(summary.warningCount || 0)) warnings.push(`${summary.warningCount} catalog warning(s) were recorded.`);
  warnings.push(...runtime.warnings);

  const subrecordCount = Number(summary.subrecordCount || (catalog?.roomSummaries || []).length || 0);
  const totalFirstSeenEntityUploads = Number(summary.totalFirstSeenEntityUploads || 0);
  const uniqueDynamicStreamsUsed = Number(summary.uniqueDynamicStreamsUsed || 0);
  const assetPolicy = 'metadata_only_no_rom_bytes_or_pixels';

  out.dataset.roomEntityDynamicCatalogBacked = catalog ? '1' : '0';
  out.dataset.roomEntityDynamicCatalogId = catalog?.id || '';
  out.dataset.roomEntityDynamicPreviewOk = warnings.length ? '0' : '1';
  out.dataset.roomEntityDynamicRuntimeDecoded = runtime.runtimeDecoded ? '1' : '0';
  out.dataset.roomEntityDynamicSubrecordCount = String(subrecordCount);
  out.dataset.roomEntityDynamicUploadSubrecordCount = String(runtime.roomsWithUploads || 0);
  out.dataset.roomEntityDynamicTotalFirstSeenEntityUploads = String(totalFirstSeenEntityUploads);
  out.dataset.roomEntityDynamicUniqueDynamicStreamsUsed = String(uniqueDynamicStreamsUsed);
  out.dataset.roomEntityDynamicCatalogExpectedTileSlots = String(runtime.catalogExpectedTileSlots || 0);
  out.dataset.roomEntityDynamicRuntimeTouchedSlots = String(runtime.runtimeTouchedSlots || 0);
  out.dataset.roomEntityDynamicRuntimeCopySlots = String(runtime.runtimeCopySlots || 0);
  out.dataset.roomEntityDynamicRuntimeZeroSlots = String(runtime.runtimeZeroSlots || 0);
  out.dataset.roomEntityDynamicRuntimeUnresolvedSlots = String(runtime.runtimeUnresolvedSlots || 0);
  out.dataset.roomEntityDynamicRuntimeSourceRegionCount = String(runtime.runtimeSourceRegionCount || 0);
  out.dataset.roomEntityDynamicRuntimeStreamCount = String(runtime.runtimeStreamCount || 0);
  out.dataset.roomEntityDynamicWarningCount = String(warnings.length);
  out.dataset.roomEntityDynamicPersistedTileByteCount = '0';
  out.dataset.roomEntityDynamicPersistedPixelCount = '0';
  out.dataset.roomEntityDynamicPersistedCoordinateCount = '0';
  out.dataset.roomEntityDynamicAssetPolicy = assetPolicy;

  if (info) {
    info.textContent = warnings.length
      ? `${warnings.length} warning(s)`
      : `${totalFirstSeenEntityUploads} upload(s) · ${runtime.runtimeTouchedSlots} slot write(s) · ${runtime.runtimeUnresolvedSlots} unresolved`;
  }

  if (warnings.length) {
    out.innerHTML = warnings.slice(0, 12).map(warning =>
      `<div style="color:#f87171">${simEscapeHtml(warning)}</div>`
    ).join('') + (warnings.length > 12 ? `<div style="color:#777">... +${warnings.length - 12} more warning(s)</div>` : '');
  } else {
    const rowText = Object.entries(runtime.runtimeRemapRows || {})
      .map(([row, count]) => `row${row}:${count}`)
      .join(' ');
    out.innerHTML = `
      <div style="color:#888;margin-bottom:6px">
        Catalog ${simEscapeHtml(catalog.id)} · ${subrecordCount} subrecord(s) · ${runtime.roomsWithUploads} room(s) with uploads · remap ${simEscapeHtml(rowText || 'none')} · tile bytes/pixels omitted
      </div>
      <div style="color:#888;margin-bottom:6px">
        A97 replay touched ${runtime.runtimeTouchedSlots} tile slot(s): copy ${runtime.runtimeCopySlots}, zero ${runtime.runtimeZeroSlots}, unresolved ${runtime.runtimeUnresolvedSlots}. Source regions ${runtime.runtimeSourceRegionCount}, streams ${runtime.runtimeStreamCount}.
      </div>
      ${roomEntityDynamicStreamTable(catalog)}
      ${roomEntityDynamicRoomTable(runtime)}
    `;
  }

  return {
    catalogBacked: Boolean(catalog),
    catalogId: catalog?.id || '',
    previewOk: warnings.length === 0,
    runtimeDecoded: runtime.runtimeDecoded,
    subrecordCount,
    uploadSubrecordCount: runtime.roomsWithUploads || 0,
    totalFirstSeenEntityUploads,
    uniqueDynamicStreamsUsed,
    catalogExpectedTileSlots: runtime.catalogExpectedTileSlots || 0,
    runtimeTouchedSlots: runtime.runtimeTouchedSlots || 0,
    runtimeCopySlots: runtime.runtimeCopySlots || 0,
    runtimeZeroSlots: runtime.runtimeZeroSlots || 0,
    runtimeUnresolvedSlots: runtime.runtimeUnresolvedSlots || 0,
    runtimeSourceRegionCount: runtime.runtimeSourceRegionCount || 0,
    runtimeStreamCount: runtime.runtimeStreamCount || 0,
    warningCount: warnings.length,
    persistedTileByteCount: 0,
    persistedPixelCount: 0,
    persistedCoordinateCount: 0,
    assetPolicy,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  DYNAMIC GRAPHICS ROUTE PRIORITY PREVIEW
// ═══════════════════════════════════════════════════════════════════════════

function dynamicRoutePriorityCatalog() {
  return (mapData.graphicsCatalogs || []).find(c =>
    c.id === 'world-graphics-dynamic-route-priority-catalog-2026-06-26'
  ) || null;
}

function dynamicRoutePriorityClearPreviewDataset(out) {
  if (!out) return;
  for (const key of Object.keys(out.dataset)) {
    if (key.startsWith('dynamicRoutePriority')) delete out.dataset[key];
  }
}

function dynamicRoutePriorityActionRank(action) {
  const order = {
    trace_player_a48_command_selector: 0,
    trace_accepted_a48_gap_selector: 1,
    trace_a97_dynamic_decode_route: 2,
    trace_real_consumer_before_coverage: 3,
    trace_verified_dynamic_bank_route: 4,
  };
  return order[action] ?? 99;
}

function dynamicRoutePrioritySourceBytes(entry) {
  return Number(entry?.localVerification?.sourceByteCount || entry?.range?.sizeBytes || 0);
}

function dynamicRoutePrioritySortedEntries(catalog) {
  return (catalog?.entries || []).slice().sort((a, b) => {
    const actionDelta = dynamicRoutePriorityActionRank(a.routePriority?.priorityAction) -
      dynamicRoutePriorityActionRank(b.routePriority?.priorityAction);
    if (actionDelta) return actionDelta;
    return dynamicRoutePrioritySourceBytes(b) - dynamicRoutePrioritySourceBytes(a) ||
      String(a.spanId || '').localeCompare(String(b.spanId || ''));
  });
}

function dynamicRoutePriorityCountsText(counts) {
  return Object.entries(counts || {})
    .map(([key, value]) => `${key}:${value}`)
    .join(' · ');
}

function dynamicRoutePriorityRouteLabels(entry) {
  const route = (entry.routePriority?.routeOrder || [])[0] || null;
  if (!route) return '';
  const labels = [
    ...(route.routineLabels || []),
    ...(route.callerLabels || []),
  ];
  return [...new Set(labels)].join(' ');
}

function dynamicRoutePriorityRamText(entry) {
  return (entry.routePriority?.tracePrerequisites || [])
    .map(seed => seed.symbol || seed.address || '')
    .filter(Boolean)
    .slice(0, 8)
    .join(' ');
}

function dynamicRoutePriorityBlockersText(entry) {
  const blockers = [];
  if (!entry.localVerification?.runtimeTraceConfirmed) blockers.push('runtime');
  if (!entry.localVerification?.promotionReady) blockers.push('promotion');
  const rejected = (entry.routePriority?.rejectedRoutes || []).map(route => `reject:${route.id}`);
  return [...blockers, ...rejected].join(' ');
}

function dynamicRoutePriorityTable(entries) {
  const body = (entries || []).map(entry => {
    const action = entry.routePriority?.priorityAction || '';
    const route = entry.routePriority?.primaryRouteId || '';
    const status = entry.routePriority?.status || '';
    const sourceBytes = dynamicRoutePrioritySourceBytes(entry);
    const nonzero = Number(entry.localVerification?.nonzeroByteCount || 0);
    const good = entry.localVerification?.formulaMatchesRange &&
      entry.localVerification?.allChunksInRange &&
      entry.localVerification?.allBanksMatchHighByteFormula;
    return `
      <tr style="border-bottom:1px solid rgba(255,255,255,.04)">
        <td style="padding:2px 6px;color:#cbd5e1">${simEscapeHtml(entry.spanId || '')}</td>
        <td style="padding:2px 6px;color:#a3e635">${simEscapeHtml(entry.sourceBank || '?')} ${simEscapeHtml(entry.region?.id || '')}</td>
        <td style="padding:2px 6px;color:#94a3b8">${simEscapeHtml(entry.range?.start || '?')}-${simEscapeHtml(entry.range?.endExclusive || '?')}</td>
        <td style="padding:2px 6px;color:${good ? '#4ade80' : '#f87171'}">${simEscapeHtml(String(nonzero))}/${simEscapeHtml(String(sourceBytes))}</td>
        <td style="padding:2px 6px;color:#fbbf24">${simEscapeHtml(action)}</td>
        <td style="padding:2px 6px;color:#c084fc">${simEscapeHtml(route)}</td>
        <td style="padding:2px 6px;color:#93c5fd">${simEscapeHtml(dynamicRoutePriorityRouteLabels(entry))}</td>
        <td style="padding:2px 6px;color:#94a3b8">${simEscapeHtml(dynamicRoutePriorityRamText(entry))}</td>
        <td style="padding:2px 6px;color:#fca5a5">${simEscapeHtml(dynamicRoutePriorityBlockersText(entry))}</td>
        <td style="padding:2px 6px;color:#94a3b8">${simEscapeHtml(status)}</td>
      </tr>
    `;
  }).join('');
  return `
    <table style="border-collapse:collapse;min-width:100%">
      <thead>
        <tr style="color:#888">
          <th style="text-align:left;padding:2px 6px">span</th>
          <th style="text-align:left;padding:2px 6px">bank/region</th>
          <th style="text-align:left;padding:2px 6px">range</th>
          <th style="text-align:left;padding:2px 6px">nonzero</th>
          <th style="text-align:left;padding:2px 6px">next trace</th>
          <th style="text-align:left;padding:2px 6px">primary route</th>
          <th style="text-align:left;padding:2px 6px">labels</th>
          <th style="text-align:left;padding:2px 6px">RAM</th>
          <th style="text-align:left;padding:2px 6px">blockers</th>
          <th style="text-align:left;padding:2px 6px">status</th>
        </tr>
      </thead>
      <tbody>${body || '<tr><td colspan="10" style="padding:2px 6px;color:#888">No dynamic route priorities</td></tr>'}</tbody>
    </table>
  `;
}

function dynamicRoutePriorityBankGroups(catalog) {
  return (catalog?.bankGroups || []).map(group => {
    const actionText = dynamicRoutePriorityCountsText(group.priorityActionCounts);
    const routeText = dynamicRoutePriorityCountsText(group.primaryRouteCounts);
    return `
      <div style="display:inline-block;margin:0 6px 4px 0;padding:3px 6px;border:1px solid rgba(255,255,255,.08);border-radius:3px;color:#94a3b8">
        <span style="color:#a3e635">${simEscapeHtml(group.sourceBank || '?')}</span>
        ${simEscapeHtml(String(group.entryCount || 0))} entries · ${simEscapeHtml(String(group.sourceByteCount || 0))} bytes · ${simEscapeHtml(actionText)} · ${simEscapeHtml(routeText)}
      </div>
    `;
  }).join('');
}

function dynamicRoutePriorityRenderPreview() {
  const out = document.getElementById('dynamic-route-priority-preview');
  const info = document.getElementById('dynamic-route-priority-info');
  if (!out) return null;
  dynamicRoutePriorityClearPreviewDataset(out);

  const catalog = dynamicRoutePriorityCatalog();
  const summary = catalog?.summary || {};
  const entries = dynamicRoutePrioritySortedEntries(catalog);
  const warnings = [];
  if (!catalog) warnings.push('Dynamic graphics route-priority catalog is missing.');

  const entryCount = entries.length;
  const localVerified = Number(summary.localVerifiedSeedCount || 0);
  const a48Primary = Number(summary.primaryRouteCounts?.record_derived_a48_player_animation_path || 0);
  const dynamicPrimary = Number(summary.primaryRouteCounts?.record_derived_998_or_dynamic_decode_path || 0);
  const runtimeConfirmed = Number(summary.runtimeTraceConfirmedCount || 0);
  const promotionReady = Number(summary.promotionReadyCount || 0);
  const sourceBytes = Number(summary.sourceByteCount || 0);
  const nonzeroBytes = Number(summary.localNonzeroByteCount || 0);
  const assetPolicy = 'metadata_only_no_saved_rom_bytes_pixels_hashes_audio_or_instruction_bytes';

  out.dataset.dynamicRoutePriorityCatalogBacked = catalog ? '1' : '0';
  out.dataset.dynamicRoutePriorityCatalogId = catalog?.id || '';
  out.dataset.dynamicRoutePriorityPreviewOk = warnings.length ? '0' : '1';
  out.dataset.dynamicRoutePriorityEntryCount = String(entryCount);
  out.dataset.dynamicRoutePriorityLocalVerifiedSeedCount = String(localVerified);
  out.dataset.dynamicRoutePriorityA48PrimaryCount = String(a48Primary);
  out.dataset.dynamicRoutePriorityDynamicDecodePrimaryCount = String(dynamicPrimary);
  out.dataset.dynamicRoutePriorityRuntimeTraceConfirmedCount = String(runtimeConfirmed);
  out.dataset.dynamicRoutePriorityPromotionReadyCount = String(promotionReady);
  out.dataset.dynamicRoutePrioritySourceByteCount = String(sourceBytes);
  out.dataset.dynamicRoutePriorityLocalNonzeroByteCount = String(nonzeroBytes);
  out.dataset.dynamicRoutePriorityWarningCount = String(warnings.length);
  out.dataset.dynamicRoutePriorityPersistedRomByteCount = '0';
  out.dataset.dynamicRoutePriorityPersistedPixelCount = '0';
  out.dataset.dynamicRoutePriorityPersistedHashCount = '0';
  out.dataset.dynamicRoutePriorityPersistedAudioByteCount = '0';
  out.dataset.dynamicRoutePriorityPersistedInstructionByteCount = '0';
  out.dataset.dynamicRoutePriorityAssetPolicy = assetPolicy;

  if (info) {
    info.textContent = warnings.length
      ? `${warnings.length} warning(s)`
      : `${entryCount} entries · A48 ${a48Primary} · 998/A97 ${dynamicPrimary} · runtime confirmed ${runtimeConfirmed}`;
  }

  if (warnings.length) {
    out.innerHTML = warnings.map(warning =>
      `<div style="color:#f87171">${simEscapeHtml(warning)}</div>`
    ).join('');
  } else {
    out.innerHTML = `
      <div style="color:#888;margin-bottom:6px">
        Catalog ${simEscapeHtml(catalog.id)} · local verified ${localVerified}/${entryCount} · source ${nonzeroBytes}/${sourceBytes} nonzero byte count · runtime trace ${runtimeConfirmed} · promotion ${promotionReady}
      </div>
      <div style="color:#888;margin-bottom:6px">
        Actions: ${simEscapeHtml(dynamicRoutePriorityCountsText(summary.priorityActionCounts)) || 'none'} · primary routes: ${simEscapeHtml(dynamicRoutePriorityCountsText(summary.primaryRouteCounts)) || 'none'}
      </div>
      <div style="margin-bottom:6px">${dynamicRoutePriorityBankGroups(catalog)}</div>
      ${dynamicRoutePriorityTable(entries)}
    `;
  }

  return {
    catalogBacked: Boolean(catalog),
    catalogId: catalog?.id || '',
    previewOk: warnings.length === 0,
    entryCount,
    localVerifiedSeedCount: localVerified,
    a48PrimaryCount: a48Primary,
    dynamicDecodePrimaryCount: dynamicPrimary,
    runtimeTraceConfirmedCount: runtimeConfirmed,
    promotionReadyCount: promotionReady,
    sourceByteCount: sourceBytes,
    localNonzeroByteCount: nonzeroBytes,
    warningCount: warnings.length,
    persistedRomByteCount: 0,
    persistedPixelCount: 0,
    persistedHashCount: 0,
    persistedAudioByteCount: 0,
    persistedInstructionByteCount: 0,
    assetPolicy,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  DYNAMIC GRAPHICS RUNTIME HOOK INDEX PREVIEW
// ═══════════════════════════════════════════════════════════════════════════

function dynamicGraphicsRuntimeHookCatalog() {
  return (mapData.runtimeTraceHookCatalogs || []).find(c =>
    c.id === 'world-dynamic-graphics-runtime-hook-index-catalog-2026-06-26'
  ) || null;
}

function dynamicGraphicsRuntimeHookClearPreviewDataset(out) {
  if (!out) return;
  for (const key of Object.keys(out.dataset)) {
    if (key.startsWith('dynamicGraphicsRuntimeHook')) delete out.dataset[key];
  }
}

function dynamicGraphicsRuntimeHookSourceBytes(plan) {
  return Number(plan?.sourceByteCount || plan?.range?.sizeBytes || 0);
}

function dynamicGraphicsRuntimeHookPriorityRank(plan) {
  const ranks = {
    trace_real_consumer_before_coverage: 0,
    trace_a97_dynamic_decode_route: 1,
    accepted_a48_gap_selector_trace: 2,
    trace_player_a48_command_selector: 3,
    known_a48_command_selector_trace: 3,
    trace_verified_dynamic_bank_route: 4,
  };
  return ranks[plan?.priorityClass] ?? 9;
}

function dynamicGraphicsRuntimeHookSortedPlans(catalog) {
  return (catalog?.tracePlans || []).slice().sort((a, b) => {
    const familyDelta = String(a.sourceFamily || '').localeCompare(String(b.sourceFamily || ''));
    const rankDelta = dynamicGraphicsRuntimeHookPriorityRank(a) - dynamicGraphicsRuntimeHookPriorityRank(b);
    if (rankDelta) return rankDelta;
    return familyDelta || dynamicGraphicsRuntimeHookSourceBytes(b) - dynamicGraphicsRuntimeHookSourceBytes(a) ||
      String(a.spanId || '').localeCompare(String(b.spanId || ''));
  });
}

function dynamicGraphicsRuntimeHookSortedHooks(catalog) {
  return (catalog?.hookSpecs || []).slice().sort((a, b) => {
    const classRank = a.hookClass === 'metadata_promotion_gate' ? 1 : 0;
    const otherClassRank = b.hookClass === 'metadata_promotion_gate' ? 1 : 0;
    return classRank - otherClassRank ||
      String(a.sourceFamily || '').localeCompare(String(b.sourceFamily || '')) ||
      String(a.label || '').localeCompare(String(b.label || '')) ||
      String(a.id || '').localeCompare(String(b.id || ''));
  });
}

function dynamicGraphicsRuntimeHookPlanRouteText(plan) {
  if (plan.sourceFamily === 'a48') {
    const streams = plan.routeSummary?.streamOffsets || [];
    const commandStreams = plan.routeSummary?.commandStreamOffsets || [];
    return [
      streams.length ? `a48 ${a48SelectorTraceListText(streams, 4)}` : '',
      commandStreams.length ? `cmd ${a48SelectorTraceListText(commandStreams, 4)}` : '',
    ].filter(Boolean).join(' · ') || 'a48 selector unresolved';
  }
  const routines = plan.routeSummary?.primaryRoutineLabels || [];
  const callers = plan.routeSummary?.primaryCallerLabels || [];
  return [
    a48SelectorTraceListText(routines, 4),
    callers.length ? `call ${a48SelectorTraceListText(callers, 3)}` : '',
  ].filter(Boolean).join(' · ') || '998/A97 route unresolved';
}

function dynamicGraphicsRuntimeHookPlanBlockersText(plan) {
  const blockers = [];
  if (!plan.blockers?.runtimeTraceConfirmed) blockers.push('runtime');
  if (!plan.blockers?.promotionReady) blockers.push('promotion');
  if (plan.blockers?.acceptedGapGuarded) blockers.push('a48 gap');
  if (plan.blockers?.a97DecodeGuarded) blockers.push('a97');
  if (plan.blockers?.consumerProofGuarded) blockers.push('consumer');
  return blockers.join(' ') || 'clear';
}

function dynamicGraphicsRuntimeHookHookTable(hooks) {
  const body = (hooks || []).map(hook => `
    <tr style="border-bottom:1px solid rgba(255,255,255,.04)">
      <td style="padding:2px 6px;color:#86efac">${simEscapeHtml(hook.id || '')}</td>
      <td style="padding:2px 6px;color:${hook.sourceFamily === 'a48' ? '#c084fc' : '#5eead4'}">${simEscapeHtml(hook.sourceFamily || '')}</td>
      <td style="padding:2px 6px;color:#cbd5e1">${simEscapeHtml(hook.label || '')}</td>
      <td style="padding:2px 6px;color:#a3e635">${simEscapeHtml(hook.region?.id || 'metadata')}</td>
      <td style="padding:2px 6px;color:#94a3b8">${simEscapeHtml(hook.eventKind || '')}</td>
      <td style="padding:2px 6px;color:#fbbf24">${simEscapeHtml(a48SelectorTraceListText(hook.captureFields || [], 4))}</td>
      <td style="padding:2px 6px;color:${hook.hookClass === 'metadata_promotion_gate' ? '#4ade80' : '#fca5a5'}">${simEscapeHtml(hook.runtimeHookStatus || '')}</td>
    </tr>
  `).join('');
  return `
    <table style="border-collapse:collapse;min-width:100%;margin-bottom:10px">
      <thead>
        <tr style="color:#888">
          <th style="text-align:left;padding:2px 6px">hook id</th>
          <th style="text-align:left;padding:2px 6px">family</th>
          <th style="text-align:left;padding:2px 6px">label</th>
          <th style="text-align:left;padding:2px 6px">region</th>
          <th style="text-align:left;padding:2px 6px">kind</th>
          <th style="text-align:left;padding:2px 6px">captures</th>
          <th style="text-align:left;padding:2px 6px">status</th>
        </tr>
      </thead>
      <tbody>${body || '<tr><td colspan="7" style="padding:2px 6px;color:#888">No dynamic graphics runtime hooks</td></tr>'}</tbody>
    </table>
  `;
}

function dynamicGraphicsRuntimeHookPlanTable(plans) {
  const body = (plans || []).map(plan => `
    <tr style="border-bottom:1px solid rgba(255,255,255,.04)">
      <td style="padding:2px 6px;color:#cbd5e1">${simEscapeHtml(plan.spanId || '')}</td>
      <td style="padding:2px 6px;color:${plan.sourceFamily === 'a48' ? '#c084fc' : '#5eead4'}">${simEscapeHtml(plan.sourceFamily || '')}</td>
      <td style="padding:2px 6px;color:#fbbf24">${simEscapeHtml(plan.priorityClass || '')}</td>
      <td style="padding:2px 6px;color:#a3e635">${simEscapeHtml(plan.sourceBank || '?')} ${simEscapeHtml(plan.region?.id || '')}</td>
      <td style="padding:2px 6px;color:#94a3b8">${simEscapeHtml(plan.range?.start || '?')}-${simEscapeHtml(plan.range?.endExclusive || '?')}</td>
      <td style="padding:2px 6px;color:#4ade80">${simEscapeHtml(String(plan.localNonzeroByteCount || 0))}/${simEscapeHtml(String(plan.sourceByteCount || 0))}</td>
      <td style="padding:2px 6px;color:#93c5fd">${simEscapeHtml(a48SelectorTraceListText(plan.sourceRecordWords || [], 5))}</td>
      <td style="padding:2px 6px;color:#94a3b8">${simEscapeHtml(dynamicGraphicsRuntimeHookPlanRouteText(plan))}</td>
      <td style="padding:2px 6px;color:#fca5a5">${simEscapeHtml(dynamicGraphicsRuntimeHookPlanBlockersText(plan))}</td>
      <td style="padding:2px 6px;color:#94a3b8">${simEscapeHtml(a48SelectorTraceListText(plan.traceEventPointIds || [], 4))}</td>
    </tr>
  `).join('');
  return `
    <table style="border-collapse:collapse;min-width:100%">
      <thead>
        <tr style="color:#888">
          <th style="text-align:left;padding:2px 6px">span</th>
          <th style="text-align:left;padding:2px 6px">family</th>
          <th style="text-align:left;padding:2px 6px">class</th>
          <th style="text-align:left;padding:2px 6px">bank/region</th>
          <th style="text-align:left;padding:2px 6px">range</th>
          <th style="text-align:left;padding:2px 6px">nonzero</th>
          <th style="text-align:left;padding:2px 6px">source words</th>
          <th style="text-align:left;padding:2px 6px">route</th>
          <th style="text-align:left;padding:2px 6px">blockers</th>
          <th style="text-align:left;padding:2px 6px">hooks</th>
        </tr>
      </thead>
      <tbody>${body || '<tr><td colspan="10" style="padding:2px 6px;color:#888">No dynamic graphics trace plans</td></tr>'}</tbody>
    </table>
  `;
}

function dynamicGraphicsRuntimeHookRenderPreview() {
  const out = document.getElementById('dynamic-graphics-runtime-hook-preview');
  const info = document.getElementById('dynamic-graphics-runtime-hook-info');
  if (!out) return null;
  dynamicGraphicsRuntimeHookClearPreviewDataset(out);

  const catalog = dynamicGraphicsRuntimeHookCatalog();
  const summary = catalog?.summary || {};
  const hooks = dynamicGraphicsRuntimeHookSortedHooks(catalog);
  const plans = dynamicGraphicsRuntimeHookSortedPlans(catalog);
  const warnings = [];
  if (!catalog) warnings.push('Dynamic graphics runtime hook index catalog is missing.');

  const tracePlans = plans.length;
  const runtimeHooks = Number(summary.runtimeHookSpecCount || 0);
  const promotionGates = Number(summary.promotionGateCount || 0);
  const hookSpecs = Number(summary.hookSpecCount || hooks.length || 0);
  const ramSeeds = Number(summary.ramTraceSeedCount || 0);
  const sourceBytes = Number(summary.sourceByteCount || 0);
  const nonzeroBytes = Number(summary.localNonzeroByteCount || 0);
  const a48Plans = Number(summary.a48TracePlanCount || 0);
  const dynamicPlans = Number(summary.dynamic998A97TracePlanCount || 0);
  const runtimeConfirmed = Number(summary.runtimeTraceConfirmedCount || 0);
  const promotionReady = Number(summary.promotionReadyCount || 0);
  const coverageChanged = summary.coverageChangedByThisAudit ? 1 : 0;
  const assetPolicy = 'metadata_only_no_saved_rom_bytes_pixels_hashes_audio_instruction_or_register_traces';

  out.dataset.dynamicGraphicsRuntimeHookCatalogBacked = catalog ? '1' : '0';
  out.dataset.dynamicGraphicsRuntimeHookCatalogId = catalog?.id || '';
  out.dataset.dynamicGraphicsRuntimeHookPreviewOk = warnings.length ? '0' : '1';
  out.dataset.dynamicGraphicsRuntimeHookTracePlanCount = String(tracePlans);
  out.dataset.dynamicGraphicsRuntimeHookA48PlanCount = String(a48Plans);
  out.dataset.dynamicGraphicsRuntimeHook998A97PlanCount = String(dynamicPlans);
  out.dataset.dynamicGraphicsRuntimeHookSpecCount = String(hookSpecs);
  out.dataset.dynamicGraphicsRuntimeHookRuntimeHookCount = String(runtimeHooks);
  out.dataset.dynamicGraphicsRuntimeHookPromotionGateCount = String(promotionGates);
  out.dataset.dynamicGraphicsRuntimeHookRamSeedCount = String(ramSeeds);
  out.dataset.dynamicGraphicsRuntimeHookSourceByteCount = String(sourceBytes);
  out.dataset.dynamicGraphicsRuntimeHookLocalNonzeroByteCount = String(nonzeroBytes);
  out.dataset.dynamicGraphicsRuntimeHookRuntimeTraceConfirmedCount = String(runtimeConfirmed);
  out.dataset.dynamicGraphicsRuntimeHookPromotionReadyCount = String(promotionReady);
  out.dataset.dynamicGraphicsRuntimeHookCoverageChanged = String(coverageChanged);
  out.dataset.dynamicGraphicsRuntimeHookWarningCount = String(warnings.length);
  out.dataset.dynamicGraphicsRuntimeHookPersistedRomByteCount = '0';
  out.dataset.dynamicGraphicsRuntimeHookPersistedPixelCount = '0';
  out.dataset.dynamicGraphicsRuntimeHookPersistedHashCount = '0';
  out.dataset.dynamicGraphicsRuntimeHookPersistedAudioByteCount = '0';
  out.dataset.dynamicGraphicsRuntimeHookPersistedInstructionByteCount = '0';
  out.dataset.dynamicGraphicsRuntimeHookPersistedRegisterTraceCount = '0';
  out.dataset.dynamicGraphicsRuntimeHookAssetPolicy = assetPolicy;

  if (info) {
    info.textContent = warnings.length
      ? `${warnings.length} warning(s)`
      : `${tracePlans} plans · hooks ${runtimeHooks} · gates ${promotionGates} · runtime confirmed ${runtimeConfirmed}`;
  }

  if (warnings.length) {
    out.innerHTML = warnings.map(warning =>
      `<div style="color:#f87171">${simEscapeHtml(warning)}</div>`
    ).join('');
  } else {
    out.innerHTML = `
      <div style="color:#888;margin-bottom:6px">
        Catalog ${simEscapeHtml(catalog.id)} · trace plans ${tracePlans} (${dynamicPlans} 998/A97, ${a48Plans} A48) · runtime hooks ${runtimeHooks} · gates ${promotionGates} · RAM seeds ${ramSeeds}
      </div>
      <div style="color:#888;margin-bottom:6px">
        Source ${nonzeroBytes}/${sourceBytes} nonzero byte count, runtime trace ${runtimeConfirmed}, promotion ${promotionReady}, coverage changed ${coverageChanged}. Bytes, pixels, traces, and hashes are not displayed or saved.
      </div>
      ${dynamicGraphicsRuntimeHookHookTable(hooks)}
      ${dynamicGraphicsRuntimeHookPlanTable(plans)}
    `;
  }

  return {
    catalogBacked: Boolean(catalog),
    catalogId: catalog?.id || '',
    previewOk: warnings.length === 0,
    tracePlanCount: tracePlans,
    a48PlanCount: a48Plans,
    dynamic998A97PlanCount: dynamicPlans,
    hookSpecCount: hookSpecs,
    runtimeHookCount: runtimeHooks,
    promotionGateCount: promotionGates,
    ramSeedCount: ramSeeds,
    sourceByteCount: sourceBytes,
    localNonzeroByteCount: nonzeroBytes,
    runtimeTraceConfirmedCount: runtimeConfirmed,
    promotionReadyCount: promotionReady,
    coverageChangedByThisAudit: Boolean(coverageChanged),
    warningCount: warnings.length,
    persistedRomByteCount: 0,
    persistedPixelCount: 0,
    persistedHashCount: 0,
    persistedAudioByteCount: 0,
    persistedInstructionByteCount: 0,
    persistedRegisterTraceCount: 0,
    assetPolicy,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  DYNAMIC GRAPHICS RUNTIME FIXTURE PREVIEW
// ═══════════════════════════════════════════════════════════════════════════

function dynamicGraphicsRuntimeFixtureCatalog() {
  return (mapData.runtimeTraceHookFixtureCatalogs || []).find(c =>
    c.id === 'world-dynamic-graphics-runtime-hook-fixture-catalog-2026-06-26'
  ) || null;
}

function dynamicGraphicsRuntimeFixtureClearPreviewDataset(out) {
  if (!out) return;
  for (const key of Object.keys(out.dataset)) {
    if (key.startsWith('dynamicGraphicsRuntimeFixture')) delete out.dataset[key];
  }
}

function dynamicGraphicsRuntimeFixtureSourceBytes(plan) {
  return Number(plan?.sourceByteCount || plan?.range?.sizeBytes || 0);
}

function dynamicGraphicsRuntimeFixturePlanRank(plan) {
  const ranks = {
    trace_real_consumer_before_coverage: 0,
    trace_a97_dynamic_decode_route: 1,
    accepted_a48_gap_selector_trace: 2,
    known_a48_command_selector_trace: 3,
    trace_verified_dynamic_bank_route: 4,
  };
  return ranks[plan?.priorityClass] ?? 9;
}

function dynamicGraphicsRuntimeFixtureSortedHooks(catalog) {
  return (catalog?.hookFixtures || []).slice().sort((a, b) =>
    String(a.sourceFamily || '').localeCompare(String(b.sourceFamily || '')) ||
    String(a.romOffset || '').localeCompare(String(b.romOffset || '')) ||
    String(a.eventKind || '').localeCompare(String(b.eventKind || ''))
  );
}

function dynamicGraphicsRuntimeFixtureSortedPlans(catalog) {
  return (catalog?.planFixtures || []).slice().sort((a, b) => {
    const rankDelta = dynamicGraphicsRuntimeFixturePlanRank(a) - dynamicGraphicsRuntimeFixturePlanRank(b);
    if (rankDelta) return rankDelta;
    return String(a.sourceFamily || '').localeCompare(String(b.sourceFamily || '')) ||
      dynamicGraphicsRuntimeFixtureSourceBytes(b) - dynamicGraphicsRuntimeFixtureSourceBytes(a) ||
      String(a.spanId || '').localeCompare(String(b.spanId || ''));
  });
}

function dynamicGraphicsRuntimeFixtureValidationHtml(catalog) {
  const validation = catalog?.validation || {};
  const issueCount = Number(validation.issueCount || 0);
  const ready = validation.readyForRuntimeHarness ? 'ready' : 'blocked';
  const rows = [
    ['unknown hook refs', validation.unknownHookReferences?.length || 0],
    ['plans without runtime hooks', validation.plansWithoutRuntimeHooks?.length || 0],
    ['plans without gates', validation.plansWithoutPromotionGates?.length || 0],
    ['runtime hooks without region', validation.runtimeHooksWithoutRegion?.length || 0],
    ['runtime hooks without offset', validation.runtimeHooksWithoutOffset?.length || 0],
    ['missing RAM seeds', validation.missingRamSeeds?.length || 0],
    ['duplicate ids', (validation.duplicateHookIds?.length || 0) + (validation.duplicatePlanIds?.length || 0) + (validation.duplicateFixtureIds?.length || 0)],
  ];
  const rowHtml = rows.map(([label, value]) =>
    `<span style="display:inline-block;margin-right:12px"><span style="color:#7dd3fc">${simEscapeHtml(label)}</span> ${simEscapeHtml(String(value))}</span>`
  ).join('');
  return `
    <div style="color:${issueCount ? '#fca5a5' : '#86efac'};margin-bottom:6px">
      validation ${simEscapeHtml(ready)} · ${simEscapeHtml(String(issueCount))} blocking issue(s)
    </div>
    <div style="color:#888;margin-bottom:8px">${rowHtml}</div>
  `;
}

function dynamicGraphicsRuntimeFixtureHookTable(fixtures) {
  const body = (fixtures || []).map(fixture => `
    <tr style="border-bottom:1px solid rgba(255,255,255,.04)">
      <td style="padding:2px 6px;color:#86efac">${simEscapeHtml(fixture.sourceHookId || '')}</td>
      <td style="padding:2px 6px;color:${fixture.sourceFamily === 'a48' ? '#c084fc' : '#5eead4'}">${simEscapeHtml(fixture.sourceFamily || '')}</td>
      <td style="padding:2px 6px;color:#fbbf24">${simEscapeHtml(fixture.romOffset || '')}</td>
      <td style="padding:2px 6px;color:#cbd5e1">${simEscapeHtml(fixture.eventKind || '')}</td>
      <td style="padding:2px 6px;color:#a3e635">${simEscapeHtml(fixture.region?.id || '')}</td>
      <td style="padding:2px 6px;text-align:right;color:#93c5fd">${simEscapeHtml(String((fixture.requiredByPlanIds || []).length))}</td>
      <td style="padding:2px 6px;color:#94a3b8">${simEscapeHtml(a48SelectorTraceListText(fixture.captureFields || [], 4))}</td>
      <td style="padding:2px 6px;color:${fixture.addressable ? '#4ade80' : '#fca5a5'}">${fixture.addressable ? 'yes' : 'no'}</td>
    </tr>
  `).join('');
  return `
    <div style="color:#93c5fd;font-weight:bold;margin:6px 0 3px">Runtime hook fixtures</div>
    <table style="border-collapse:collapse;min-width:100%;margin-bottom:10px">
      <thead>
        <tr style="color:#888">
          <th style="text-align:left;padding:2px 6px">hook</th>
          <th style="text-align:left;padding:2px 6px">family</th>
          <th style="text-align:left;padding:2px 6px">offset</th>
          <th style="text-align:left;padding:2px 6px">kind</th>
          <th style="text-align:left;padding:2px 6px">region</th>
          <th style="text-align:right;padding:2px 6px">plans</th>
          <th style="text-align:left;padding:2px 6px">captures</th>
          <th style="text-align:left;padding:2px 6px">addr</th>
        </tr>
      </thead>
      <tbody>${body || '<tr><td colspan="8" style="padding:2px 6px;color:#888">No runtime hook fixtures</td></tr>'}</tbody>
    </table>
  `;
}

function dynamicGraphicsRuntimeFixturePlanTable(fixtures) {
  const body = (fixtures || []).map(fixture => `
    <tr style="border-bottom:1px solid rgba(255,255,255,.04)">
      <td style="padding:2px 6px;color:#cbd5e1">${simEscapeHtml(fixture.spanId || '')}</td>
      <td style="padding:2px 6px;color:${fixture.sourceFamily === 'a48' ? '#c084fc' : '#5eead4'}">${simEscapeHtml(fixture.sourceFamily || '')}</td>
      <td style="padding:2px 6px;color:#fbbf24">${simEscapeHtml(fixture.priorityClass || '')}</td>
      <td style="padding:2px 6px;color:#a3e635">${simEscapeHtml(fixture.sourceBank || '')} ${simEscapeHtml(fixture.sourceRegion?.id || '')}</td>
      <td style="padding:2px 6px;text-align:right;color:#4ade80">${simEscapeHtml(String(fixture.localNonzeroByteCount || 0))}/${simEscapeHtml(String(fixture.sourceByteCount || 0))}</td>
      <td style="padding:2px 6px;text-align:right;color:#93c5fd">${simEscapeHtml(String((fixture.runtimeHookFixtureIds || []).length))}</td>
      <td style="padding:2px 6px;text-align:right;color:#93c5fd">${simEscapeHtml(String((fixture.promotionGateFixtureIds || []).length))}</td>
      <td style="padding:2px 6px;text-align:right;color:#c4b5fd">${simEscapeHtml(String((fixture.captureFieldNames || []).length))}</td>
      <td style="padding:2px 6px;color:#94a3b8">${simEscapeHtml(fixture.harnessStatus || '')}</td>
    </tr>
  `).join('');
  return `
    <div style="color:#93c5fd;font-weight:bold;margin:6px 0 3px">Trace plan fixtures</div>
    <table style="border-collapse:collapse;min-width:100%">
      <thead>
        <tr style="color:#888">
          <th style="text-align:left;padding:2px 6px">span</th>
          <th style="text-align:left;padding:2px 6px">family</th>
          <th style="text-align:left;padding:2px 6px">class</th>
          <th style="text-align:left;padding:2px 6px">bank/region</th>
          <th style="text-align:right;padding:2px 6px">nonzero</th>
          <th style="text-align:right;padding:2px 6px">hooks</th>
          <th style="text-align:right;padding:2px 6px">gates</th>
          <th style="text-align:right;padding:2px 6px">fields</th>
          <th style="text-align:left;padding:2px 6px">status</th>
        </tr>
      </thead>
      <tbody>${body || '<tr><td colspan="9" style="padding:2px 6px;color:#888">No trace plan fixtures</td></tr>'}</tbody>
    </table>
  `;
}

function dynamicGraphicsRuntimeFixtureRenderPreview() {
  const out = document.getElementById('dynamic-graphics-runtime-fixture-preview');
  const info = document.getElementById('dynamic-graphics-runtime-fixture-info');
  if (!out) return null;
  dynamicGraphicsRuntimeFixtureClearPreviewDataset(out);

  const catalog = dynamicGraphicsRuntimeFixtureCatalog();
  const summary = catalog?.summary || {};
  const hooks = dynamicGraphicsRuntimeFixtureSortedHooks(catalog);
  const plans = dynamicGraphicsRuntimeFixtureSortedPlans(catalog);
  const warnings = [];
  if (!catalog) warnings.push('Dynamic graphics runtime fixture catalog is missing.');
  if (catalog && !summary.readyForRuntimeHarness) warnings.push('Runtime fixture validation is not ready.');

  const tracePlans = Number(summary.tracePlanFixtureCount || plans.length || 0);
  const runtimeHooks = Number(summary.runtimeHookFixtureCount || hooks.length || 0);
  const promotionGates = Number(summary.promotionGateFixtureCount || 0);
  const planHookEdges = Number(summary.planHookEdgeCount || 0);
  const planGateEdges = Number(summary.planGateEdgeCount || 0);
  const uniqueCaptureFields = Number(summary.uniqueCaptureFieldCount || 0);
  const ramSeeds = Number(summary.ramTraceSeedCount || 0);
  const sourceBytes = Number(summary.sourceByteCount || 0);
  const nonzeroBytes = Number(summary.localNonzeroByteCount || 0);
  const addressableHooks = Number(summary.addressableRuntimeHookCount || 0);
  const unresolvedHooks = Number(summary.unresolvedRuntimeHookCount || 0);
  const hooksWithoutPlan = Number(summary.runtimeHooksWithoutPlanCount || 0);
  const validationIssues = Number(summary.validationIssueCount || 0);
  const ready = summary.readyForRuntimeHarness ? 1 : 0;
  const runtimeConfirmed = Number(summary.runtimeTraceConfirmedCount || 0);
  const promotionReady = Number(summary.promotionReadyCount || 0);
  const coverageChanged = summary.coverageChangedByThisAudit ? 1 : 0;
  const assetPolicy = 'metadata_only_no_saved_rom_bytes_pixels_hashes_audio_instruction_register_or_runtime_values';

  out.dataset.dynamicGraphicsRuntimeFixtureCatalogBacked = catalog ? '1' : '0';
  out.dataset.dynamicGraphicsRuntimeFixtureCatalogId = catalog?.id || '';
  out.dataset.dynamicGraphicsRuntimeFixturePreviewOk = warnings.length ? '0' : '1';
  out.dataset.dynamicGraphicsRuntimeFixtureTracePlanCount = String(tracePlans);
  out.dataset.dynamicGraphicsRuntimeFixtureRuntimeHookCount = String(runtimeHooks);
  out.dataset.dynamicGraphicsRuntimeFixturePromotionGateCount = String(promotionGates);
  out.dataset.dynamicGraphicsRuntimeFixturePlanHookEdgeCount = String(planHookEdges);
  out.dataset.dynamicGraphicsRuntimeFixturePlanGateEdgeCount = String(planGateEdges);
  out.dataset.dynamicGraphicsRuntimeFixtureUniqueCaptureFieldCount = String(uniqueCaptureFields);
  out.dataset.dynamicGraphicsRuntimeFixtureRamSeedCount = String(ramSeeds);
  out.dataset.dynamicGraphicsRuntimeFixtureSourceByteCount = String(sourceBytes);
  out.dataset.dynamicGraphicsRuntimeFixtureLocalNonzeroByteCount = String(nonzeroBytes);
  out.dataset.dynamicGraphicsRuntimeFixtureAddressableRuntimeHookCount = String(addressableHooks);
  out.dataset.dynamicGraphicsRuntimeFixtureUnresolvedRuntimeHookCount = String(unresolvedHooks);
  out.dataset.dynamicGraphicsRuntimeFixtureRuntimeHooksWithoutPlanCount = String(hooksWithoutPlan);
  out.dataset.dynamicGraphicsRuntimeFixtureValidationIssueCount = String(validationIssues);
  out.dataset.dynamicGraphicsRuntimeFixtureReadyForRuntimeHarness = String(ready);
  out.dataset.dynamicGraphicsRuntimeFixtureRuntimeTraceConfirmedCount = String(runtimeConfirmed);
  out.dataset.dynamicGraphicsRuntimeFixturePromotionReadyCount = String(promotionReady);
  out.dataset.dynamicGraphicsRuntimeFixtureCoverageChanged = String(coverageChanged);
  out.dataset.dynamicGraphicsRuntimeFixtureWarningCount = String(warnings.length);
  out.dataset.dynamicGraphicsRuntimeFixturePersistedRomByteCount = '0';
  out.dataset.dynamicGraphicsRuntimeFixturePersistedPixelCount = '0';
  out.dataset.dynamicGraphicsRuntimeFixturePersistedHashCount = '0';
  out.dataset.dynamicGraphicsRuntimeFixturePersistedAudioByteCount = '0';
  out.dataset.dynamicGraphicsRuntimeFixturePersistedInstructionByteCount = '0';
  out.dataset.dynamicGraphicsRuntimeFixturePersistedRegisterTraceCount = '0';
  out.dataset.dynamicGraphicsRuntimeFixturePersistedRuntimeValueCount = '0';
  out.dataset.dynamicGraphicsRuntimeFixtureAssetPolicy = assetPolicy;

  if (info) {
    info.textContent = warnings.length
      ? `${warnings.length} warning(s)`
      : `${tracePlans} plans · hooks ${runtimeHooks}/${addressableHooks} addressable · gates ${promotionGates} · ready ${ready}`;
  }

  if (warnings.length && !catalog) {
    out.innerHTML = warnings.map(warning =>
      `<div style="color:#f87171">${simEscapeHtml(warning)}</div>`
    ).join('');
  } else {
    out.innerHTML = `
      <div style="color:#888;margin-bottom:6px">
        Catalog ${simEscapeHtml(catalog.id)} · fixtures ${tracePlans} plan(s), ${runtimeHooks} runtime hook(s), ${promotionGates} gate(s) · edges ${planHookEdges} hook / ${planGateEdges} gate · capture fields ${uniqueCaptureFields}
      </div>
      <div style="color:#888;margin-bottom:6px">
        Source ${nonzeroBytes}/${sourceBytes} nonzero byte count, addressable hooks ${addressableHooks}/${runtimeHooks}, runtime trace ${runtimeConfirmed}, promotion ${promotionReady}, coverage changed ${coverageChanged}. Runtime values, bytes, pixels, traces, and hashes are not displayed or saved.
      </div>
      ${dynamicGraphicsRuntimeFixtureValidationHtml(catalog)}
      ${dynamicGraphicsRuntimeFixtureHookTable(hooks)}
      ${dynamicGraphicsRuntimeFixturePlanTable(plans)}
    `;
  }

  return {
    catalogBacked: Boolean(catalog),
    catalogId: catalog?.id || '',
    previewOk: warnings.length === 0,
    tracePlanCount: tracePlans,
    runtimeHookCount: runtimeHooks,
    promotionGateCount: promotionGates,
    planHookEdgeCount: planHookEdges,
    planGateEdgeCount: planGateEdges,
    uniqueCaptureFieldCount: uniqueCaptureFields,
    ramSeedCount: ramSeeds,
    sourceByteCount: sourceBytes,
    localNonzeroByteCount: nonzeroBytes,
    addressableRuntimeHookCount: addressableHooks,
    unresolvedRuntimeHookCount: unresolvedHooks,
    runtimeHooksWithoutPlanCount: hooksWithoutPlan,
    validationIssueCount: validationIssues,
    readyForRuntimeHarness: Boolean(ready),
    runtimeTraceConfirmedCount: runtimeConfirmed,
    promotionReadyCount: promotionReady,
    coverageChangedByThisAudit: Boolean(coverageChanged),
    warningCount: warnings.length,
    persistedRomByteCount: 0,
    persistedPixelCount: 0,
    persistedHashCount: 0,
    persistedAudioByteCount: 0,
    persistedInstructionByteCount: 0,
    persistedRegisterTraceCount: 0,
    persistedRuntimeValueCount: 0,
    assetPolicy,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  998/A97 FRAME TRACE SCAFFOLD PREVIEW
// ═══════════════════════════════════════════════════════════════════════════

function dynamic998A97FrameTraceCatalog() {
  return (mapData.graphicsCatalogs || []).find(c =>
    c.id === 'world-graphics-998-a97-frame-trace-scaffold-catalog-2026-06-26'
  ) || null;
}

function dynamic998A97FrameTraceClearPreviewDataset(out) {
  if (!out) return;
  for (const key of Object.keys(out.dataset)) {
    if (key.startsWith('dynamic998A97FrameTrace')) delete out.dataset[key];
  }
}

function dynamic998A97FrameTraceSourceBytes(plan) {
  return Number(plan?.localVerification?.sourceByteCount || plan?.range?.sizeBytes || 0);
}

function dynamic998A97FrameTracePriorityRank(plan) {
  const ranks = {
    trace_real_consumer_before_coverage: 0,
    trace_a97_dynamic_decode_route: 1,
    trace_verified_dynamic_bank_route: 2,
  };
  return ranks[plan?.priorityAction] ?? 9;
}

function dynamic998A97FrameTraceSortedPlans(catalog) {
  return (catalog?.tracePlans || []).slice().sort((a, b) => {
    const rankDelta = dynamic998A97FrameTracePriorityRank(a) - dynamic998A97FrameTracePriorityRank(b);
    if (rankDelta) return rankDelta;
    return dynamic998A97FrameTraceSourceBytes(b) - dynamic998A97FrameTraceSourceBytes(a) ||
      String(a.spanId || '').localeCompare(String(b.spanId || ''));
  });
}

function dynamic998A97FrameTraceEventPointList(catalog) {
  return (catalog?.traceEventPoints || []).map(point => {
    const label = [point.id, point.region?.id || point.label || 'metadata'].filter(Boolean).join(' ');
    return `${label} (${point.runtimeHookStatus || 'pending'})`;
  });
}

function dynamic998A97FrameTraceRoutineText(plan) {
  const routines = plan.primaryRoute?.routineLabels || [];
  const callers = plan.primaryRoute?.callerLabels || [];
  const routineText = a48SelectorTraceListText(routines, 4);
  const callerText = a48SelectorTraceListText(callers, 3);
  return [routineText, callerText ? `call ${callerText}` : ''].filter(Boolean).join(' · ') || 'unresolved';
}

function dynamic998A97FrameTraceEventText(plan) {
  return a48SelectorTraceListText(plan.traceEventPointIds || [], 5) || 'none';
}

function dynamic998A97FrameTraceRamText(plan) {
  return a48SelectorTraceListText((plan.ramTraceSeeds || []).map(seed => seed.symbol || seed.address), 6) || 'none';
}

function dynamic998A97FrameTraceProofText(plan) {
  const blockers = [];
  if (!plan.promotionGate?.runtimeTraceConfirmed) blockers.push('runtime');
  if (!plan.promotionGate?.promotionReady) blockers.push('promotion');
  if (plan.consumerProofGuard) blockers.push('consumer');
  if (plan.a97DecodeGuard) blockers.push('a97');
  const proofText = a48SelectorTraceListText(plan.promotionGate?.requiredEvidence || [], 4);
  return `${blockers.join(' ') || 'clear'} · ${proofText}`;
}

function dynamic998A97FrameTraceVdpText(plan) {
  const model = plan.expectedVdpDestinationModel || {};
  return `${model.destinationRam || '?'} ${model.bankLatchRam || '?'} ${model.rawUploadRoutine || '?'}|${model.decodedUploadRoutine || '?'}`;
}

function dynamic998A97FrameTraceEventPointTable(catalog) {
  const body = (catalog?.traceEventPoints || []).map(point => `
    <tr style="border-bottom:1px solid rgba(255,255,255,.04)">
      <td style="padding:2px 6px;color:#5eead4">${simEscapeHtml(point.id || '')}</td>
      <td style="padding:2px 6px;color:#cbd5e1">${simEscapeHtml(point.label || '')}</td>
      <td style="padding:2px 6px;color:#a3e635">${simEscapeHtml(point.region?.id || 'metadata')}</td>
      <td style="padding:2px 6px;color:#94a3b8">${simEscapeHtml(point.eventKind || '')}</td>
      <td style="padding:2px 6px;color:#fbbf24">${simEscapeHtml(a48SelectorTraceListText(point.captureFields || [], 4))}</td>
      <td style="padding:2px 6px;color:${point.runtimeHookStatus === 'runtime_hook_needed' ? '#fca5a5' : '#4ade80'}">${simEscapeHtml(point.runtimeHookStatus || '')}</td>
    </tr>
  `).join('');
  return `
    <table style="border-collapse:collapse;min-width:100%;margin-bottom:10px">
      <thead>
        <tr style="color:#888">
          <th style="text-align:left;padding:2px 6px">event</th>
          <th style="text-align:left;padding:2px 6px">label</th>
          <th style="text-align:left;padding:2px 6px">region</th>
          <th style="text-align:left;padding:2px 6px">kind</th>
          <th style="text-align:left;padding:2px 6px">captures</th>
          <th style="text-align:left;padding:2px 6px">status</th>
        </tr>
      </thead>
      <tbody>${body || '<tr><td colspan="6" style="padding:2px 6px;color:#888">No 998/A97 frame trace event points</td></tr>'}</tbody>
    </table>
  `;
}

function dynamic998A97FrameTracePlanTable(plans) {
  const body = (plans || []).map(plan => {
    const sourceBytes = dynamic998A97FrameTraceSourceBytes(plan);
    const nonzero = Number(plan.localVerification?.nonzeroByteCount || 0);
    return `
      <tr style="border-bottom:1px solid rgba(255,255,255,.04)">
        <td style="padding:2px 6px;color:#cbd5e1">${simEscapeHtml(plan.spanId || '')}</td>
        <td style="padding:2px 6px;color:${plan.priorityAction === 'trace_real_consumer_before_coverage' ? '#fbbf24' : '#5eead4'}">${simEscapeHtml(plan.priorityAction || '')}</td>
        <td style="padding:2px 6px;color:#a3e635">${simEscapeHtml(plan.sourceBank || '?')} ${simEscapeHtml(plan.region?.id || '')}</td>
        <td style="padding:2px 6px;color:#94a3b8">${simEscapeHtml(plan.range?.start || '?')}-${simEscapeHtml(plan.range?.endExclusive || '?')}</td>
        <td style="padding:2px 6px;color:#4ade80">${simEscapeHtml(String(nonzero))}/${simEscapeHtml(String(sourceBytes))}</td>
        <td style="padding:2px 6px;color:#93c5fd">${simEscapeHtml(a48SelectorTraceListText(plan.sourceRecordWords || [], 5))}</td>
        <td style="padding:2px 6px;color:#94a3b8">${simEscapeHtml(dynamic998A97FrameTraceRoutineText(plan))}</td>
        <td style="padding:2px 6px;color:#fbbf24">${simEscapeHtml(dynamic998A97FrameTraceRamText(plan))}</td>
        <td style="padding:2px 6px;color:#a7f3d0">${simEscapeHtml(dynamic998A97FrameTraceVdpText(plan))}</td>
        <td style="padding:2px 6px;color:#94a3b8">${simEscapeHtml(dynamic998A97FrameTraceEventText(plan))}</td>
        <td style="padding:2px 6px;color:#fca5a5">${simEscapeHtml(dynamic998A97FrameTraceProofText(plan))}</td>
        <td style="padding:2px 6px;color:#94a3b8">${simEscapeHtml(plan.traceStatus || '')}</td>
      </tr>
    `;
  }).join('');
  return `
    <table style="border-collapse:collapse;min-width:100%">
      <thead>
        <tr style="color:#888">
          <th style="text-align:left;padding:2px 6px">span</th>
          <th style="text-align:left;padding:2px 6px">action</th>
          <th style="text-align:left;padding:2px 6px">bank/region</th>
          <th style="text-align:left;padding:2px 6px">range</th>
          <th style="text-align:left;padding:2px 6px">nonzero</th>
          <th style="text-align:left;padding:2px 6px">source words</th>
          <th style="text-align:left;padding:2px 6px">route</th>
          <th style="text-align:left;padding:2px 6px">RAM</th>
          <th style="text-align:left;padding:2px 6px">VDP</th>
          <th style="text-align:left;padding:2px 6px">events</th>
          <th style="text-align:left;padding:2px 6px">proof gate</th>
          <th style="text-align:left;padding:2px 6px">status</th>
        </tr>
      </thead>
      <tbody>${body || '<tr><td colspan="12" style="padding:2px 6px;color:#888">No 998/A97 frame trace plans</td></tr>'}</tbody>
    </table>
  `;
}

function dynamic998A97FrameTraceRenderPreview() {
  const out = document.getElementById('998-a97-frame-trace-preview');
  const info = document.getElementById('998-a97-frame-trace-info');
  if (!out) return null;
  dynamic998A97FrameTraceClearPreviewDataset(out);

  const catalog = dynamic998A97FrameTraceCatalog();
  const summary = catalog?.summary || {};
  const plans = dynamic998A97FrameTraceSortedPlans(catalog);
  const warnings = [];
  if (!catalog) warnings.push('998/A97 frame trace scaffold catalog is missing.');

  const planCount = plans.length;
  const eventPoints = Number(summary.traceEventPointCount || 0);
  const candidatePayload = Number(summary.candidatePayloadConsumerTraceCount || 0);
  const dynamicBank = Number(summary.verifiedDynamicBankTraceCount || 0);
  const a97Entries = Number(summary.a97DynamicDecodeTraceCount || 0);
  const sourceBytes = Number(summary.sourceByteCount || 0);
  const nonzeroBytes = Number(summary.localNonzeroByteCount || 0);
  const ramSeeds = Number(summary.ramTraceSeedCount || 0);
  const runtimeConfirmed = Number(summary.runtimeTraceConfirmedCount || 0);
  const promotionReady = Number(summary.promotionReadyCount || 0);
  const coverageChanged = summary.coverageChangedByThisAudit ? 1 : 0;
  const runtimeHooksNeeded = Number(summary.runtimeHookStatusCounts?.runtime_hook_needed || 0);
  const metadataGates = Number(summary.runtimeHookStatusCounts?.metadata_gate_ready_runtime_trace_pending || 0);
  const assetPolicy = 'metadata_only_no_saved_rom_bytes_pixels_hashes_audio_instruction_or_register_traces';

  out.dataset.dynamic998A97FrameTraceCatalogBacked = catalog ? '1' : '0';
  out.dataset.dynamic998A97FrameTraceCatalogId = catalog?.id || '';
  out.dataset.dynamic998A97FrameTracePreviewOk = warnings.length ? '0' : '1';
  out.dataset.dynamic998A97FrameTracePlanCount = String(planCount);
  out.dataset.dynamic998A97FrameTraceEventPointCount = String(eventPoints);
  out.dataset.dynamic998A97FrameTraceCandidatePayloadCount = String(candidatePayload);
  out.dataset.dynamic998A97FrameTraceDynamicBankCount = String(dynamicBank);
  out.dataset.dynamic998A97FrameTraceA97Count = String(a97Entries);
  out.dataset.dynamic998A97FrameTraceSourceByteCount = String(sourceBytes);
  out.dataset.dynamic998A97FrameTraceLocalNonzeroByteCount = String(nonzeroBytes);
  out.dataset.dynamic998A97FrameTraceRamSeedCount = String(ramSeeds);
  out.dataset.dynamic998A97FrameTraceRuntimeTraceConfirmedCount = String(runtimeConfirmed);
  out.dataset.dynamic998A97FrameTracePromotionReadyCount = String(promotionReady);
  out.dataset.dynamic998A97FrameTraceCoverageChanged = String(coverageChanged);
  out.dataset.dynamic998A97FrameTraceRuntimeHooksNeeded = String(runtimeHooksNeeded);
  out.dataset.dynamic998A97FrameTraceMetadataGateCount = String(metadataGates);
  out.dataset.dynamic998A97FrameTraceWarningCount = String(warnings.length);
  out.dataset.dynamic998A97FrameTracePersistedRomByteCount = '0';
  out.dataset.dynamic998A97FrameTracePersistedPixelCount = '0';
  out.dataset.dynamic998A97FrameTracePersistedHashCount = '0';
  out.dataset.dynamic998A97FrameTracePersistedAudioByteCount = '0';
  out.dataset.dynamic998A97FrameTracePersistedInstructionByteCount = '0';
  out.dataset.dynamic998A97FrameTracePersistedRegisterTraceCount = '0';
  out.dataset.dynamic998A97FrameTraceAssetPolicy = assetPolicy;

  if (info) {
    info.textContent = warnings.length
      ? `${warnings.length} warning(s)`
      : `${planCount} plans · events ${eventPoints} · hooks needed ${runtimeHooksNeeded} · runtime confirmed ${runtimeConfirmed}`;
  }

  if (warnings.length) {
    out.innerHTML = warnings.map(warning =>
      `<div style="color:#f87171">${simEscapeHtml(warning)}</div>`
    ).join('');
  } else {
    out.innerHTML = `
      <div style="color:#888;margin-bottom:6px">
        Catalog ${simEscapeHtml(catalog.id)} · trace plans ${planCount} (${candidatePayload} consumer proof, ${dynamicBank} dynamic bank, ${a97Entries} A97) · event points ${eventPoints} · RAM seeds ${ramSeeds}
      </div>
      <div style="color:#888;margin-bottom:6px">
        Source ${nonzeroBytes}/${sourceBytes} nonzero byte count, runtime trace ${runtimeConfirmed}, promotion ${promotionReady}, coverage changed ${coverageChanged}. Bytes, pixels, traces, and hashes are not displayed or saved.
      </div>
      <div style="color:#888;margin-bottom:6px">
        Event hooks: ${simEscapeHtml(a48SelectorTraceListText(dynamic998A97FrameTraceEventPointList(catalog), 4))}
      </div>
      ${dynamic998A97FrameTraceEventPointTable(catalog)}
      ${dynamic998A97FrameTracePlanTable(plans)}
    `;
  }

  return {
    catalogBacked: Boolean(catalog),
    catalogId: catalog?.id || '',
    previewOk: warnings.length === 0,
    planCount,
    eventPointCount: eventPoints,
    candidatePayloadCount: candidatePayload,
    dynamicBankCount: dynamicBank,
    a97Count: a97Entries,
    sourceByteCount: sourceBytes,
    localNonzeroByteCount: nonzeroBytes,
    ramSeedCount: ramSeeds,
    runtimeTraceConfirmedCount: runtimeConfirmed,
    promotionReadyCount: promotionReady,
    coverageChangedByThisAudit: Boolean(coverageChanged),
    runtimeHooksNeeded,
    metadataGateCount: metadataGates,
    warningCount: warnings.length,
    persistedRomByteCount: 0,
    persistedPixelCount: 0,
    persistedHashCount: 0,
    persistedAudioByteCount: 0,
    persistedInstructionByteCount: 0,
    persistedRegisterTraceCount: 0,
    assetPolicy,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  A48 SELECTOR TRACE QUEUE PREVIEW
// ═══════════════════════════════════════════════════════════════════════════

function a48SelectorTraceCatalog() {
  return (mapData.playerCatalogs || []).find(c =>
    c.id === 'world-player-a48-selector-trace-queue-catalog-2026-06-26'
  ) || null;
}

function a48SelectorTraceClearPreviewDataset(out) {
  if (!out) return;
  for (const key of Object.keys(out.dataset)) {
    if (key.startsWith('a48SelectorTrace')) delete out.dataset[key];
  }
}

function a48SelectorTraceSourceBytes(entry) {
  return Number(entry?.localVerification?.sourceByteCount || entry?.range?.sizeBytes || 0);
}

function a48SelectorTracePriorityRank(entry) {
  const ranks = {
    high: 0,
    high_gap_resolution: 1,
    medium_high: 2,
    medium: 3,
  };
  return ranks[entry?.priority] ?? 9;
}

function a48SelectorTraceSortedEntries(catalog) {
  return (catalog?.entries || []).slice().sort((a, b) => {
    const rankDelta = a48SelectorTracePriorityRank(a) - a48SelectorTracePriorityRank(b);
    if (rankDelta) return rankDelta;
    return a48SelectorTraceSourceBytes(b) - a48SelectorTraceSourceBytes(a) ||
      String(a.spanId || '').localeCompare(String(b.spanId || ''));
  });
}

function a48SelectorTraceListText(values, max = 8) {
  const list = (values || []).filter(value => value != null && value !== '');
  if (!list.length) return '';
  const shown = list.slice(0, max).join(' ');
  return list.length > max ? `${shown} +${list.length - max}` : shown;
}

function a48SelectorTraceStreamOffsets(entry) {
  return [
    ...(entry.a48StreamEvidence?.knownStreams || []).map(stream => stream.streamOffset),
    ...(entry.a48StreamEvidence?.acceptedGapStreams || []).map(stream => stream.streamOffset),
  ].filter(Boolean);
}

function a48SelectorTraceCommandText(entry) {
  const offsets = entry.commandSelectorEvidence?.uniquePlayerCommandStreamOffsets || [];
  const pointerOffsets = entry.commandSelectorEvidence?.uniquePointerOffsets || [];
  const commandText = a48SelectorTraceListText(offsets, 5);
  const pointerText = a48SelectorTraceListText(pointerOffsets, 5);
  if (!commandText && !pointerText) return 'no command refs';
  return [commandText, pointerText ? `ptr ${pointerText}` : ''].filter(Boolean).join(' · ');
}

function a48SelectorTraceFormsText(entry) {
  const forms = entry.commandSelectorEvidence?.selectedByFormIndices || [];
  const variants = Number(entry.commandSelectorEvidence?.selectedByVariantCount || 0);
  if (!forms.length) return 'unresolved';
  return `forms ${forms.join(',')} · variants ${variants}`;
}

function a48SelectorTraceRamText(entry) {
  return a48SelectorTraceListText((entry.selectorRamTraceSeeds || []).map(seed => seed.symbol || seed.address), 8);
}

function a48SelectorTraceBlockersText(entry) {
  const blockers = [];
  if (!entry.runtimeTraceConfirmed) blockers.push('runtime');
  if (!entry.promotionReady) blockers.push('promotion');
  if (entry.queueKind === 'accepted_a48_gap_selector_trace' &&
      !Number(entry.a48StreamEvidence?.acceptedGapKnownPointerReferenceCount || 0)) {
    blockers.push('gap pointer');
  }
  if (entry.commandSelectorEvidence?.status === 'no_command_pointer_refs_for_accepted_gap_runtime_trace_required') {
    blockers.push('selector');
  }
  return blockers.join(' ');
}

function a48SelectorTraceTable(entries) {
  const body = (entries || []).map(entry => {
    const sourceBytes = a48SelectorTraceSourceBytes(entry);
    const nonzero = Number(entry.localVerification?.nonzeroByteCount || 0);
    const good = entry.localVerification?.formulaMatchesRange &&
      entry.localVerification?.allChunksInRange &&
      entry.localVerification?.allBanksMatchHighByteFormula;
    const streamText = a48SelectorTraceListText(a48SelectorTraceStreamOffsets(entry), 6);
    return `
      <tr style="border-bottom:1px solid rgba(255,255,255,.04)">
        <td style="padding:2px 6px;color:#cbd5e1">${simEscapeHtml(entry.spanId || '')}</td>
        <td style="padding:2px 6px;color:${entry.queueKind === 'accepted_a48_gap_selector_trace' ? '#fbbf24' : '#c084fc'}">${simEscapeHtml(entry.queueKind || '')}</td>
        <td style="padding:2px 6px;color:#a3e635">${simEscapeHtml(entry.sourceBank || '?')} ${simEscapeHtml(entry.region?.id || '')}</td>
        <td style="padding:2px 6px;color:#94a3b8">${simEscapeHtml(entry.range?.start || '?')}-${simEscapeHtml(entry.range?.endExclusive || '?')}</td>
        <td style="padding:2px 6px;color:${good ? '#4ade80' : '#f87171'}">${simEscapeHtml(String(nonzero))}/${simEscapeHtml(String(sourceBytes))}</td>
        <td style="padding:2px 6px;color:#93c5fd">${simEscapeHtml(streamText || 'none')}</td>
        <td style="padding:2px 6px;color:#94a3b8">${simEscapeHtml(a48SelectorTraceCommandText(entry))}</td>
        <td style="padding:2px 6px;color:#fbbf24">${simEscapeHtml(a48SelectorTraceFormsText(entry))}</td>
        <td style="padding:2px 6px;color:#94a3b8">${simEscapeHtml(a48SelectorTraceRamText(entry))}</td>
        <td style="padding:2px 6px;color:#fca5a5">${simEscapeHtml(a48SelectorTraceBlockersText(entry))}</td>
        <td style="padding:2px 6px;color:#94a3b8">${simEscapeHtml(entry.traceStatus || '')}</td>
      </tr>
    `;
  }).join('');
  return `
    <table style="border-collapse:collapse;min-width:100%">
      <thead>
        <tr style="color:#888">
          <th style="text-align:left;padding:2px 6px">span</th>
          <th style="text-align:left;padding:2px 6px">queue</th>
          <th style="text-align:left;padding:2px 6px">bank/region</th>
          <th style="text-align:left;padding:2px 6px">range</th>
          <th style="text-align:left;padding:2px 6px">nonzero</th>
          <th style="text-align:left;padding:2px 6px">A48 streams</th>
          <th style="text-align:left;padding:2px 6px">command refs</th>
          <th style="text-align:left;padding:2px 6px">forms</th>
          <th style="text-align:left;padding:2px 6px">RAM</th>
          <th style="text-align:left;padding:2px 6px">blockers</th>
          <th style="text-align:left;padding:2px 6px">status</th>
        </tr>
      </thead>
      <tbody>${body || '<tr><td colspan="11" style="padding:2px 6px;color:#888">No A48 selector trace entries</td></tr>'}</tbody>
    </table>
  `;
}

function a48SelectorTraceRenderPreview() {
  const out = document.getElementById('a48-selector-trace-preview');
  const info = document.getElementById('a48-selector-trace-info');
  if (!out) return null;
  a48SelectorTraceClearPreviewDataset(out);

  const catalog = a48SelectorTraceCatalog();
  const summary = catalog?.summary || {};
  const entries = a48SelectorTraceSortedEntries(catalog);
  const warnings = [];
  if (!catalog) warnings.push('A48 selector trace queue catalog is missing.');

  const entryCount = entries.length;
  const knownEntries = Number(summary.knownA48CommandTraceEntryCount || 0);
  const acceptedEntries = Number(summary.acceptedGapSelectorTraceEntryCount || 0);
  const knownStreams = Number(summary.knownA48StreamCount || 0);
  const acceptedStreams = Number(summary.acceptedGapCandidateStreamCount || 0);
  const commandStreams = Number(summary.uniquePlayerCommandStreamCount || 0);
  const pointerOffsets = Number(summary.uniquePointerOffsetCount || 0);
  const variants = Number(summary.selectedByVariantCount || 0);
  const sourceBytes = Number(summary.sourceByteCount || 0);
  const nonzeroBytes = Number(summary.localNonzeroByteCount || 0);
  const runtimeConfirmed = Number(summary.runtimeTraceConfirmedCount || 0);
  const promotionReady = Number(summary.promotionReadyCount || 0);
  const assetPolicy = 'metadata_only_no_saved_rom_bytes_pixels_hashes_audio_or_instruction_bytes';

  out.dataset.a48SelectorTraceCatalogBacked = catalog ? '1' : '0';
  out.dataset.a48SelectorTraceCatalogId = catalog?.id || '';
  out.dataset.a48SelectorTracePreviewOk = warnings.length ? '0' : '1';
  out.dataset.a48SelectorTraceEntryCount = String(entryCount);
  out.dataset.a48SelectorTraceKnownEntryCount = String(knownEntries);
  out.dataset.a48SelectorTraceAcceptedGapEntryCount = String(acceptedEntries);
  out.dataset.a48SelectorTraceKnownStreamCount = String(knownStreams);
  out.dataset.a48SelectorTraceAcceptedGapStreamCount = String(acceptedStreams);
  out.dataset.a48SelectorTraceCommandStreamCount = String(commandStreams);
  out.dataset.a48SelectorTracePointerOffsetCount = String(pointerOffsets);
  out.dataset.a48SelectorTraceSelectedByVariantCount = String(variants);
  out.dataset.a48SelectorTraceSourceByteCount = String(sourceBytes);
  out.dataset.a48SelectorTraceLocalNonzeroByteCount = String(nonzeroBytes);
  out.dataset.a48SelectorTraceRuntimeTraceConfirmedCount = String(runtimeConfirmed);
  out.dataset.a48SelectorTracePromotionReadyCount = String(promotionReady);
  out.dataset.a48SelectorTraceWarningCount = String(warnings.length);
  out.dataset.a48SelectorTracePersistedRomByteCount = '0';
  out.dataset.a48SelectorTracePersistedPixelCount = '0';
  out.dataset.a48SelectorTracePersistedHashCount = '0';
  out.dataset.a48SelectorTracePersistedAudioByteCount = '0';
  out.dataset.a48SelectorTracePersistedInstructionByteCount = '0';
  out.dataset.a48SelectorTraceAssetPolicy = assetPolicy;

  if (info) {
    info.textContent = warnings.length
      ? `${warnings.length} warning(s)`
      : `${entryCount} entries · known ${knownEntries} · gap ${acceptedEntries} · command streams ${commandStreams} · runtime confirmed ${runtimeConfirmed}`;
  }

  if (warnings.length) {
    out.innerHTML = warnings.map(warning =>
      `<div style="color:#f87171">${simEscapeHtml(warning)}</div>`
    ).join('');
  } else {
    out.innerHTML = `
      <div style="color:#888;margin-bottom:6px">
        Catalog ${simEscapeHtml(catalog.id)} · known command traces ${knownEntries} · accepted gap traces ${acceptedEntries} · source ${nonzeroBytes}/${sourceBytes} nonzero byte count · runtime trace ${runtimeConfirmed} · promotion ${promotionReady}
      </div>
      <div style="color:#888;margin-bottom:6px">
        A48 streams ${knownStreams}, accepted gap streams ${acceptedStreams}, command streams ${commandStreams}, pointer offsets ${pointerOffsets}, selected variants ${variants}. Bytes and pixels are not displayed or saved.
      </div>
      ${a48SelectorTraceTable(entries)}
    `;
  }

  return {
    catalogBacked: Boolean(catalog),
    catalogId: catalog?.id || '',
    previewOk: warnings.length === 0,
    entryCount,
    knownEntryCount: knownEntries,
    acceptedGapEntryCount: acceptedEntries,
    knownStreamCount: knownStreams,
    acceptedGapStreamCount: acceptedStreams,
    commandStreamCount: commandStreams,
    pointerOffsetCount: pointerOffsets,
    selectedByVariantCount: variants,
    sourceByteCount: sourceBytes,
    localNonzeroByteCount: nonzeroBytes,
    runtimeTraceConfirmedCount: runtimeConfirmed,
    promotionReadyCount: promotionReady,
    warningCount: warnings.length,
    persistedRomByteCount: 0,
    persistedPixelCount: 0,
    persistedHashCount: 0,
    persistedAudioByteCount: 0,
    persistedInstructionByteCount: 0,
    assetPolicy,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  A48 FRAME TRACE SCAFFOLD PREVIEW
// ═══════════════════════════════════════════════════════════════════════════

function a48FrameTraceCatalog() {
  return (mapData.playerCatalogs || []).find(c =>
    c.id === 'world-player-a48-frame-trace-scaffold-catalog-2026-06-26'
  ) || null;
}

function a48FrameTraceClearPreviewDataset(out) {
  if (!out) return;
  for (const key of Object.keys(out.dataset)) {
    if (key.startsWith('a48FrameTrace')) delete out.dataset[key];
  }
}

function a48FrameTraceSourceBytes(plan) {
  return Number(plan?.localVerification?.sourceByteCount || plan?.range?.sizeBytes || 0);
}

function a48FrameTracePriorityRank(plan) {
  const ranks = {
    high: 0,
    high_gap_resolution: 1,
    medium_high: 2,
    medium: 3,
  };
  return ranks[plan?.priority] ?? 9;
}

function a48FrameTraceSortedPlans(catalog) {
  return (catalog?.tracePlans || []).slice().sort((a, b) => {
    const rankDelta = a48FrameTracePriorityRank(a) - a48FrameTracePriorityRank(b);
    if (rankDelta) return rankDelta;
    return a48FrameTraceSourceBytes(b) - a48FrameTraceSourceBytes(a) ||
      String(a.spanId || '').localeCompare(String(b.spanId || ''));
  });
}

function a48FrameTraceEventPointList(catalog) {
  return (catalog?.traceEventPoints || []).map(point => {
    const label = [point.id, point.region?.id || point.label || 'metadata'].filter(Boolean).join(' ');
    return `${label} (${point.runtimeHookStatus || 'pending'})`;
  });
}

function a48FrameTraceCommandText(plan) {
  const commandStreams = plan.commandSelectorInputs?.commandStreamOffsets || [];
  const pointerOffsets = plan.commandSelectorInputs?.commandPointerOffsets || [];
  const commandText = a48SelectorTraceListText(commandStreams, 4);
  const pointerText = a48SelectorTraceListText(pointerOffsets, 4);
  if (!commandText && !pointerText) return 'selector unresolved';
  return [commandText, pointerText ? `ptr ${pointerText}` : ''].filter(Boolean).join(' · ');
}

function a48FrameTraceStreamText(plan) {
  return a48SelectorTraceListText(plan.candidateA48Streams?.allStreamOffsets || [], 6) || 'none';
}

function a48FrameTraceEventText(plan) {
  return a48SelectorTraceListText(plan.traceEventPointIds || [], 5) || 'none';
}

function a48FrameTraceProofText(plan) {
  const blockers = [];
  if (!plan.promotionGate?.runtimeTraceConfirmed) blockers.push('runtime');
  if (!plan.promotionGate?.promotionReady) blockers.push('promotion');
  if (plan.acceptedGapGuard) blockers.push('gap guard');
  const proofText = a48SelectorTraceListText(plan.promotionGate?.requiredEvidence || [], 4);
  return `${blockers.join(' ') || 'clear'} · ${proofText}`;
}

function a48FrameTraceVdpText(plan) {
  const model = plan.expectedVdpDestinationModel || {};
  return `${model.selectorRam || '?'} ${model.zeroSelectorVdpCommandHighByte || '?'}|${model.nonzeroSelectorVdpCommandHighByte || '?'}`;
}

function a48FrameTraceEventPointTable(catalog) {
  const body = (catalog?.traceEventPoints || []).map(point => `
    <tr style="border-bottom:1px solid rgba(255,255,255,.04)">
      <td style="padding:2px 6px;color:#93c5fd">${simEscapeHtml(point.id || '')}</td>
      <td style="padding:2px 6px;color:#cbd5e1">${simEscapeHtml(point.label || '')}</td>
      <td style="padding:2px 6px;color:#a3e635">${simEscapeHtml(point.region?.id || 'metadata')}</td>
      <td style="padding:2px 6px;color:#94a3b8">${simEscapeHtml(point.eventKind || '')}</td>
      <td style="padding:2px 6px;color:#fbbf24">${simEscapeHtml(a48SelectorTraceListText(point.captureFields || [], 4))}</td>
      <td style="padding:2px 6px;color:${point.runtimeHookStatus === 'runtime_hook_needed' ? '#fca5a5' : '#4ade80'}">${simEscapeHtml(point.runtimeHookStatus || '')}</td>
    </tr>
  `).join('');
  return `
    <table style="border-collapse:collapse;min-width:100%;margin-bottom:10px">
      <thead>
        <tr style="color:#888">
          <th style="text-align:left;padding:2px 6px">event</th>
          <th style="text-align:left;padding:2px 6px">label</th>
          <th style="text-align:left;padding:2px 6px">region</th>
          <th style="text-align:left;padding:2px 6px">kind</th>
          <th style="text-align:left;padding:2px 6px">captures</th>
          <th style="text-align:left;padding:2px 6px">status</th>
        </tr>
      </thead>
      <tbody>${body || '<tr><td colspan="6" style="padding:2px 6px;color:#888">No A48 frame trace event points</td></tr>'}</tbody>
    </table>
  `;
}

function a48FrameTracePlanTable(plans) {
  const body = (plans || []).map(plan => {
    const sourceBytes = a48FrameTraceSourceBytes(plan);
    const nonzero = Number(plan.localVerification?.nonzeroByteCount || 0);
    return `
      <tr style="border-bottom:1px solid rgba(255,255,255,.04)">
        <td style="padding:2px 6px;color:#cbd5e1">${simEscapeHtml(plan.spanId || '')}</td>
        <td style="padding:2px 6px;color:${plan.queueKind === 'accepted_a48_gap_selector_trace' ? '#fbbf24' : '#93c5fd'}">${simEscapeHtml(plan.queueKind || '')}</td>
        <td style="padding:2px 6px;color:#a3e635">${simEscapeHtml(plan.sourceBank || '?')} ${simEscapeHtml(plan.region?.id || '')}</td>
        <td style="padding:2px 6px;color:#94a3b8">${simEscapeHtml(plan.range?.start || '?')}-${simEscapeHtml(plan.range?.endExclusive || '?')}</td>
        <td style="padding:2px 6px;color:#4ade80">${simEscapeHtml(String(nonzero))}/${simEscapeHtml(String(sourceBytes))}</td>
        <td style="padding:2px 6px;color:#93c5fd">${simEscapeHtml(a48FrameTraceStreamText(plan))}</td>
        <td style="padding:2px 6px;color:#94a3b8">${simEscapeHtml(a48FrameTraceCommandText(plan))}</td>
        <td style="padding:2px 6px;color:#fbbf24">${simEscapeHtml(a48FrameTraceEventText(plan))}</td>
        <td style="padding:2px 6px;color:#a7f3d0">${simEscapeHtml(a48FrameTraceVdpText(plan))}</td>
        <td style="padding:2px 6px;color:#fca5a5">${simEscapeHtml(a48FrameTraceProofText(plan))}</td>
        <td style="padding:2px 6px;color:#94a3b8">${simEscapeHtml(plan.traceStatus || '')}</td>
      </tr>
    `;
  }).join('');
  return `
    <table style="border-collapse:collapse;min-width:100%">
      <thead>
        <tr style="color:#888">
          <th style="text-align:left;padding:2px 6px">span</th>
          <th style="text-align:left;padding:2px 6px">queue</th>
          <th style="text-align:left;padding:2px 6px">bank/region</th>
          <th style="text-align:left;padding:2px 6px">range</th>
          <th style="text-align:left;padding:2px 6px">nonzero</th>
          <th style="text-align:left;padding:2px 6px">A48 streams</th>
          <th style="text-align:left;padding:2px 6px">command refs</th>
          <th style="text-align:left;padding:2px 6px">events</th>
          <th style="text-align:left;padding:2px 6px">VDP</th>
          <th style="text-align:left;padding:2px 6px">proof gate</th>
          <th style="text-align:left;padding:2px 6px">status</th>
        </tr>
      </thead>
      <tbody>${body || '<tr><td colspan="11" style="padding:2px 6px;color:#888">No A48 frame trace plans</td></tr>'}</tbody>
    </table>
  `;
}

function a48FrameTraceRenderPreview() {
  const out = document.getElementById('a48-frame-trace-preview');
  const info = document.getElementById('a48-frame-trace-info');
  if (!out) return null;
  a48FrameTraceClearPreviewDataset(out);

  const catalog = a48FrameTraceCatalog();
  const summary = catalog?.summary || {};
  const plans = a48FrameTraceSortedPlans(catalog);
  const warnings = [];
  if (!catalog) warnings.push('A48 frame trace scaffold catalog is missing.');

  const planCount = plans.length;
  const knownPlans = Number(summary.knownA48TracePlanCount || 0);
  const acceptedGapPlans = Number(summary.acceptedGapTracePlanCount || 0);
  const eventPoints = Number(summary.traceEventPointCount || 0);
  const selectorRamSeeds = Number(summary.selectorRamTraceSeedCount || 0);
  const candidateStreams = Number(summary.candidateA48StreamCount || 0);
  const commandStreams = Number(summary.commandStreamCount || 0);
  const pointerOffsets = Number(summary.commandPointerOffsetCount || 0);
  const sourceBytes = Number(summary.sourceByteCount || 0);
  const nonzeroBytes = Number(summary.localNonzeroByteCount || 0);
  const runtimeConfirmed = Number(summary.runtimeTraceConfirmedCount || 0);
  const promotionReady = Number(summary.promotionReadyCount || 0);
  const coverageChanged = summary.coverageChangedByThisAudit ? 1 : 0;
  const runtimeHooksNeeded = Number(summary.runtimeHookStatusCounts?.runtime_hook_needed || 0);
  const metadataGates = Number(summary.runtimeHookStatusCounts?.metadata_gate_ready_runtime_trace_pending || 0);
  const assetPolicy = 'metadata_only_no_saved_rom_bytes_pixels_hashes_audio_instruction_or_register_traces';

  out.dataset.a48FrameTraceCatalogBacked = catalog ? '1' : '0';
  out.dataset.a48FrameTraceCatalogId = catalog?.id || '';
  out.dataset.a48FrameTracePreviewOk = warnings.length ? '0' : '1';
  out.dataset.a48FrameTracePlanCount = String(planCount);
  out.dataset.a48FrameTraceKnownPlanCount = String(knownPlans);
  out.dataset.a48FrameTraceAcceptedGapPlanCount = String(acceptedGapPlans);
  out.dataset.a48FrameTraceEventPointCount = String(eventPoints);
  out.dataset.a48FrameTraceSelectorRamSeedCount = String(selectorRamSeeds);
  out.dataset.a48FrameTraceCandidateStreamCount = String(candidateStreams);
  out.dataset.a48FrameTraceCommandStreamCount = String(commandStreams);
  out.dataset.a48FrameTracePointerOffsetCount = String(pointerOffsets);
  out.dataset.a48FrameTraceSourceByteCount = String(sourceBytes);
  out.dataset.a48FrameTraceLocalNonzeroByteCount = String(nonzeroBytes);
  out.dataset.a48FrameTraceRuntimeTraceConfirmedCount = String(runtimeConfirmed);
  out.dataset.a48FrameTracePromotionReadyCount = String(promotionReady);
  out.dataset.a48FrameTraceCoverageChanged = String(coverageChanged);
  out.dataset.a48FrameTraceRuntimeHooksNeeded = String(runtimeHooksNeeded);
  out.dataset.a48FrameTraceMetadataGateCount = String(metadataGates);
  out.dataset.a48FrameTraceWarningCount = String(warnings.length);
  out.dataset.a48FrameTracePersistedRomByteCount = '0';
  out.dataset.a48FrameTracePersistedPixelCount = '0';
  out.dataset.a48FrameTracePersistedHashCount = '0';
  out.dataset.a48FrameTracePersistedAudioByteCount = '0';
  out.dataset.a48FrameTracePersistedInstructionByteCount = '0';
  out.dataset.a48FrameTracePersistedRegisterTraceCount = '0';
  out.dataset.a48FrameTraceAssetPolicy = assetPolicy;

  if (info) {
    info.textContent = warnings.length
      ? `${warnings.length} warning(s)`
      : `${planCount} plans · events ${eventPoints} · hooks needed ${runtimeHooksNeeded} · runtime confirmed ${runtimeConfirmed}`;
  }

  if (warnings.length) {
    out.innerHTML = warnings.map(warning =>
      `<div style="color:#f87171">${simEscapeHtml(warning)}</div>`
    ).join('');
  } else {
    out.innerHTML = `
      <div style="color:#888;margin-bottom:6px">
        Catalog ${simEscapeHtml(catalog.id)} · trace plans ${planCount} (${knownPlans} known, ${acceptedGapPlans} accepted gap) · event points ${eventPoints} · RAM seeds ${selectorRamSeeds}
      </div>
      <div style="color:#888;margin-bottom:6px">
        Candidate A48 streams ${candidateStreams}, command streams ${commandStreams}, pointer offsets ${pointerOffsets}, source ${nonzeroBytes}/${sourceBytes} nonzero byte count, runtime trace ${runtimeConfirmed}, promotion ${promotionReady}, coverage changed ${coverageChanged}. Bytes, pixels, traces, and hashes are not displayed or saved.
      </div>
      <div style="color:#888;margin-bottom:6px">
        Event hooks: ${simEscapeHtml(a48SelectorTraceListText(a48FrameTraceEventPointList(catalog), 4))}
      </div>
      ${a48FrameTraceEventPointTable(catalog)}
      ${a48FrameTracePlanTable(plans)}
    `;
  }

  return {
    catalogBacked: Boolean(catalog),
    catalogId: catalog?.id || '',
    previewOk: warnings.length === 0,
    planCount,
    knownPlanCount: knownPlans,
    acceptedGapPlanCount: acceptedGapPlans,
    eventPointCount: eventPoints,
    selectorRamSeedCount: selectorRamSeeds,
    candidateStreamCount: candidateStreams,
    commandStreamCount: commandStreams,
    pointerOffsetCount: pointerOffsets,
    sourceByteCount: sourceBytes,
    localNonzeroByteCount: nonzeroBytes,
    runtimeTraceConfirmedCount: runtimeConfirmed,
    promotionReadyCount: promotionReady,
    coverageChangedByThisAudit: Boolean(coverageChanged),
    runtimeHooksNeeded,
    metadataGateCount: metadataGates,
    warningCount: warnings.length,
    persistedRomByteCount: 0,
    persistedPixelCount: 0,
    persistedHashCount: 0,
    persistedAudioByteCount: 0,
    persistedInstructionByteCount: 0,
    persistedRegisterTraceCount: 0,
    assetPolicy,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  PLAYER A97 TRACE SEED PREVIEW
// ═══════════════════════════════════════════════════════════════════════════

function playerA97TraceSeedCatalog() {
  return (mapData.graphicsCatalogs || []).find(c =>
    c.id === 'world-player-a48-nonmatch-a97-trace-seed-catalog-2026-06-26'
  ) || null;
}

function playerA97TraceClearPreviewDataset(out) {
  if (!out) return;
  for (const key of Object.keys(out.dataset)) {
    if (key.startsWith('playerA97Trace')) delete out.dataset[key];
  }
}

function playerA97TraceHex(value, pad) {
  if (!Number.isFinite(value)) return '?';
  return '0x' + Number(value).toString(16).toUpperCase().padStart(pad || 2, '0');
}

function playerA97TraceCountNonZero(start, endExclusive) {
  if (!romData || start == null || endExclusive == null) return 0;
  let count = 0;
  const end = Math.min(endExclusive, romData.length);
  for (let i = Math.max(0, start); i < end; i++) if (romData[i] !== 0) count++;
  return count;
}

function playerA97TraceDecodeStats(start, tileCount) {
  const rows = [];
  if (!romData || start == null || tileCount <= 0) return rows;
  for (let remapRow = 0; remapRow < 4; remapRow++) {
    let nonzeroDecodedBytes = 0;
    let nonzeroDecodedRows = 0;
    for (let tile = 0; tile < tileCount; tile++) {
      for (let row = 0; row < 8; row++) {
        const decoded = simA97DecodeRow(romData, start + tile * 32 + row * 4, remapRow);
        let rowNonzero = false;
        for (const value of decoded) {
          if (value !== 0) {
            nonzeroDecodedBytes++;
            rowNonzero = true;
          }
        }
        if (rowNonzero) nonzeroDecodedRows++;
      }
    }
    rows.push({
      remapRow,
      nonzeroDecodedBytes,
      nonzeroDecodedRows,
    });
  }
  return rows;
}

function playerA97TraceVerifyEntry(entry) {
  const source = entry.sourceRecord || {};
  const sourceBank = parseHex(source.sourceBank);
  const highByte = parseHex(source.sourceRecordHighByte);
  const blockStart = parseHex(source.tileBlockStart);
  const tileCount = Number(source.tileBlockCount || entry.nonblankTileCount || 0);
  const expectedBank = Number.isFinite(highByte) ? highByte >> 1 : NaN;
  const computedStart = Number.isFinite(sourceBank) && Number.isFinite(blockStart)
    ? sourceBank * 0x4000 + blockStart * 32
    : NaN;
  const computedEnd = Number.isFinite(computedStart) ? computedStart + tileCount * 32 : NaN;
  const rangeStart = parseHex(entry.range?.start);
  const rangeEnd = parseHex(entry.range?.endExclusive);
  const inRange = romData && Number.isFinite(computedStart) && computedStart >= 0 &&
    Number.isFinite(computedEnd) && computedEnd <= romData.length;
  const sourceRegion = inRange ? simFindRegionForOffset(computedStart) : null;
  const nonzeroBytes = inRange ? playerA97TraceCountNonZero(computedStart, computedEnd) : 0;
  const decodeStats = inRange ? playerA97TraceDecodeStats(computedStart, tileCount) : [];
  const decodedNonzeroRows = decodeStats.reduce((sum, item) => sum + item.nonzeroDecodedRows, 0);
  const decodedNonzeroBytes = decodeStats.reduce((sum, item) => sum + item.nonzeroDecodedBytes, 0);
  const formulaMatchesRange = Number.isFinite(computedStart) && Number.isFinite(rangeStart) &&
    computedStart === rangeStart && Number.isFinite(computedEnd) && Number.isFinite(rangeEnd) && computedEnd === rangeEnd;
  const bankMatches = Number.isFinite(sourceBank) && Number.isFinite(expectedBank) && sourceBank === expectedBank;
  const expectedBankText = playerA97TraceHex(expectedBank, 2);

  return {
    spanId: entry.spanId || entry.id || '',
    sourceWord: source.sourceRecordWordStart || '',
    rangeStart: entry.range?.start || playerA97TraceHex(rangeStart, 5),
    rangeEndExclusive: entry.range?.endExclusive || playerA97TraceHex(rangeEnd, 5),
    computedStart: playerA97TraceHex(computedStart, 5),
    computedEndExclusive: playerA97TraceHex(computedEnd, 5),
    tileCount,
    sourceBank: source.sourceBank || '',
    sourceRecordHighByte: source.sourceRecordHighByte || '',
    expectedBank: expectedBankText,
    expectedD0F3: source.expectedD0F3 || expectedBankText,
    expectedMapperWrite: source.expectedMapperWrite || expectedBankText,
    formulaMatchesRange,
    sourceInRange: Boolean(inRange),
    sourceRegionId: sourceRegion?.id || '',
    sourceRegionName: sourceRegion ? (sourceRegion.name || sourceRegion.id || '') : '',
    bankMatches,
    nonzeroBytes,
    nonblank: nonzeroBytes > 0,
    decodedNonzeroRows,
    decodedNonzeroBytes,
    decodeStats,
    runtimeTraceConfirmed: false,
    promotionReady: false,
    proofStatus: 'static_seed_verified_runtime_trace_pending',
  };
}

function playerA97TraceDecodeStatsText(stats) {
  return (stats || []).map(item =>
    `r${item.remapRow}:${item.nonzeroDecodedRows} rows/${item.nonzeroDecodedBytes} bytes`
  ).join(' ');
}

function playerA97TraceTable(rows) {
  const body = (rows || []).map(row => `
    <tr style="border-bottom:1px solid rgba(255,255,255,.04)">
      <td style="padding:2px 6px;color:#cbd5e1">${simEscapeHtml(row.spanId)}</td>
      <td style="padding:2px 6px;color:#c084fc">${simEscapeHtml(row.sourceWord)}</td>
      <td style="padding:2px 6px;color:${row.formulaMatchesRange ? '#4ade80' : '#f87171'}">${simEscapeHtml(row.computedStart)}-${simEscapeHtml(row.computedEndExclusive)}</td>
      <td style="padding:2px 6px;color:${row.bankMatches ? '#4ade80' : '#f87171'}">${simEscapeHtml(row.sourceRecordHighByte)} -> ${simEscapeHtml(row.expectedBank)}</td>
      <td style="padding:2px 6px;color:${row.sourceInRange ? '#4ade80' : '#f87171'}">${simEscapeHtml(row.sourceRegionId || 'out-of-range')}</td>
      <td style="padding:2px 6px;color:${row.nonblank ? '#4ade80' : '#f87171'}">${simEscapeHtml(String(row.nonzeroBytes))}/${simEscapeHtml(String(row.tileCount * 32))}</td>
      <td style="padding:2px 6px;color:#94a3b8">${simEscapeHtml(playerA97TraceDecodeStatsText(row.decodeStats))}</td>
      <td style="padding:2px 6px;color:#fbbf24">${simEscapeHtml(row.runtimeTraceConfirmed ? 'confirmed' : 'pending')}</td>
    </tr>
  `).join('');
  return `
    <table style="border-collapse:collapse;min-width:100%">
      <thead>
        <tr style="color:#888">
          <th style="text-align:left;padding:2px 6px">span</th>
          <th style="text-align:left;padding:2px 6px">word</th>
          <th style="text-align:left;padding:2px 6px">computed range</th>
          <th style="text-align:left;padding:2px 6px">bank</th>
          <th style="text-align:left;padding:2px 6px">region</th>
          <th style="text-align:left;padding:2px 6px">nonzero</th>
          <th style="text-align:left;padding:2px 6px">A97 decode counts</th>
          <th style="text-align:left;padding:2px 6px">runtime</th>
        </tr>
      </thead>
      <tbody>${body || '<tr><td colspan="8" style="padding:2px 6px;color:#888">No A97 trace seeds</td></tr>'}</tbody>
    </table>
  `;
}

function playerA97TraceRenderPreview() {
  const out = document.getElementById('player-a97-trace-preview');
  const info = document.getElementById('player-a97-trace-info');
  if (!out) return null;
  playerA97TraceClearPreviewDataset(out);

  const catalog = playerA97TraceSeedCatalog();
  const rows = catalog ? (catalog.entries || []).map(playerA97TraceVerifyEntry) : [];
  const warnings = [];
  if (!catalog) warnings.push('Player A97 trace seed catalog is missing.');
  if (catalog && !romData) warnings.push('ROM is not loaded; local source range verification is unavailable.');

  const seedCount = rows.length;
  const formulaMatchCount = rows.filter(row => row.formulaMatchesRange).length;
  const sourceInRangeCount = rows.filter(row => row.sourceInRange).length;
  const bankMatchCount = rows.filter(row => row.bankMatches).length;
  const nonblankSeedCount = rows.filter(row => row.nonblank).length;
  const decodedNonzeroRowTotal = rows.reduce((sum, row) => sum + row.decodedNonzeroRows, 0);
  const decodedNonzeroByteTotal = rows.reduce((sum, row) => sum + row.decodedNonzeroBytes, 0);
  const runtimeTraceConfirmedCount = rows.filter(row => row.runtimeTraceConfirmed).length;
  const promotionReadyCount = rows.filter(row => row.promotionReady).length;
  const assetPolicy = 'local_rom_metadata_only_no_saved_bytes_pixels_hashes_or_screenshots';

  out.dataset.playerA97TraceCatalogBacked = catalog ? '1' : '0';
  out.dataset.playerA97TraceCatalogId = catalog?.id || '';
  out.dataset.playerA97TracePreviewOk = warnings.length ? '0' : '1';
  out.dataset.playerA97TraceSeedCount = String(seedCount);
  out.dataset.playerA97TraceFormulaMatchCount = String(formulaMatchCount);
  out.dataset.playerA97TraceSourceInRangeCount = String(sourceInRangeCount);
  out.dataset.playerA97TraceBankMatchCount = String(bankMatchCount);
  out.dataset.playerA97TraceNonblankSeedCount = String(nonblankSeedCount);
  out.dataset.playerA97TraceDecodedNonzeroRowTotal = String(decodedNonzeroRowTotal);
  out.dataset.playerA97TraceDecodedNonzeroByteTotal = String(decodedNonzeroByteTotal);
  out.dataset.playerA97TraceRuntimeTraceConfirmedCount = String(runtimeTraceConfirmedCount);
  out.dataset.playerA97TracePromotionReadyCount = String(promotionReadyCount);
  out.dataset.playerA97TraceWarningCount = String(warnings.length);
  out.dataset.playerA97TracePersistedRomByteCount = '0';
  out.dataset.playerA97TracePersistedPixelCount = '0';
  out.dataset.playerA97TracePersistedHashCount = '0';
  out.dataset.playerA97TracePersistedScreenshotCount = '0';
  out.dataset.playerA97TraceAssetPolicy = assetPolicy;

  if (info) {
    info.textContent = warnings.length
      ? `${warnings.length} warning(s)`
      : `${seedCount} seed(s) · ${formulaMatchCount} formula match(es) · ${nonblankSeedCount} nonblank · runtime confirmed ${runtimeTraceConfirmedCount}`;
  }

  if (warnings.length) {
    out.innerHTML = warnings.map(warning =>
      `<div style="color:#f87171">${simEscapeHtml(warning)}</div>`
    ).join('');
  } else {
    out.innerHTML = `
      <div style="color:#888;margin-bottom:6px">
        Catalog ${simEscapeHtml(catalog.id)} · retained route ${simEscapeHtml(catalog.summary?.retainedRouteId || '')} · expected bank ${simEscapeHtml((catalog.summary?.expectedSourceBanks || []).join(', ') || '?')} · runtime trace still required
      </div>
      <div style="color:#888;margin-bottom:6px">
        Static verification: formula ${formulaMatchCount}/${seedCount}, source in range ${sourceInRangeCount}/${seedCount}, bank ${bankMatchCount}/${seedCount}, nonblank ${nonblankSeedCount}/${seedCount}, decoded nonzero rows ${decodedNonzeroRowTotal}. Bytes and pixels are not displayed or saved.
      </div>
      ${playerA97TraceTable(rows)}
    `;
  }

  return {
    catalogBacked: Boolean(catalog),
    catalogId: catalog?.id || '',
    previewOk: warnings.length === 0,
    seedCount,
    formulaMatchCount,
    sourceInRangeCount,
    bankMatchCount,
    nonblankSeedCount,
    decodedNonzeroRowTotal,
    decodedNonzeroByteTotal,
    runtimeTraceConfirmedCount,
    promotionReadyCount,
    warningCount: warnings.length,
    persistedRomByteCount: 0,
    persistedPixelCount: 0,
    persistedHashCount: 0,
    persistedScreenshotCount: 0,
    assetPolicy,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  ROOM ENTITY FRAME COVERAGE PREVIEW
// ═══════════════════════════════════════════════════════════════════════════

function roomEntityFrameCoverageCatalog() {
  return (mapData.metaspriteCatalogs || []).find(c =>
    c.id === 'world-room-entity-dynamic-frame-coverage-catalog-2026-06-25'
  ) || null;
}

function roomEntityFrameTracePriorityCatalog() {
  return (mapData.metaspriteCatalogs || []).find(c =>
    c.id === 'world-room-entity-frame-trace-priority-catalog-2026-06-25'
  ) || null;
}

function roomEntityFrameSubrecordCoverageCatalog() {
  return (mapData.metaspriteCatalogs || []).find(c =>
    c.id === 'world-room-entity-frame-subrecord-coverage-catalog-2026-06-25'
  ) || null;
}

function roomEntityRenderableFrameFixtureCatalog() {
  return (mapData.metaspriteCatalogs || []).find(c =>
    c.id === 'world-room-entity-renderable-frame-fixture-catalog-2026-06-25'
  ) || null;
}

function roomEntityOamWriterSemanticsCatalog() {
  return (mapData.metaspriteCatalogs || []).find(c =>
    c.id === 'world-metasprite-oam-writer-semantics-catalog-2026-06-25'
  ) || null;
}

function roomEntitySlotCoordinateFieldProvenanceCatalog() {
  return (mapData.entityRuntimeStructCatalogs || []).find(c =>
    c.id === 'world-entity-slot-coordinate-field-provenance-catalog-2026-06-25'
  ) || null;
}

function roomEntityPositionIntegratorCatalog() {
  return (mapData.entityRuntimeStructCatalogs || []).find(c =>
    c.id === 'world-entity-position-integrator-catalog-2026-06-25'
  ) || null;
}

function roomEntityVelocityFieldProvenanceCatalog() {
  return (mapData.entityRuntimeStructCatalogs || []).find(c =>
    c.id === 'world-entity-velocity-field-provenance-catalog-2026-06-25'
  ) || null;
}

function roomEntityMotionDeltaFieldProvenanceCatalog() {
  return (mapData.entityRuntimeStructCatalogs || []).find(c =>
    c.id === 'world-entity-motion-delta-field-provenance-catalog-2026-06-25'
  ) || null;
}

function roomEntityMotionDeltaBehaviorLinkCatalog() {
  return (mapData.entityRuntimeStructCatalogs || []).find(c =>
    c.id === 'world-entity-motion-delta-behavior-link-catalog-2026-06-25'
  ) || null;
}

function roomEntityC3c0MotionSeedFamilyCatalog() {
  return (mapData.entityBehaviorCatalogs || []).find(c =>
    c.id === 'world-entity-c3c0-motion-seed-family-catalog-2026-06-25'
  ) || null;
}

function roomEntityC3c0MotionSeedTargetLinkCatalog() {
  return (mapData.entityBehaviorCatalogs || []).find(c =>
    c.id === 'world-entity-c3c0-motion-seed-target-link-catalog-2026-06-25'
  ) || null;
}

function roomEntityC3c0BehaviorTargetSemanticsCatalog() {
  return (mapData.entityBehaviorCodeCatalogs || []).find(c =>
    c.id === 'world-entity-c3c0-behavior-target-semantics-catalog-2026-06-25'
  ) || null;
}

function roomEntityC3c0ActorFamilyCatalog() {
  return (mapData.entityBehaviorCatalogs || []).find(c =>
    c.id === 'world-entity-c3c0-actor-family-catalog-2026-06-25'
  ) || null;
}

function roomEntityC3c0RenderabilityCatalog() {
  return (mapData.entityBehaviorCatalogs || []).find(c =>
    c.id === 'world-entity-c3c0-renderability-catalog-2026-06-25'
  ) || null;
}

function roomEntityC3c0FrameStepDiagnosticCatalog() {
  return (mapData.entityBehaviorCatalogs || []).find(c =>
    c.id === 'world-entity-c3c0-frame-step-diagnostic-catalog-2026-06-25'
  ) || null;
}

function roomEntityC3c0FrameStepControlFlowCatalog() {
  return (mapData.entityBehaviorCatalogs || []).find(c =>
    c.id === 'world-entity-c3c0-frame-step-control-flow-catalog-2026-06-25'
  ) || null;
}

function roomEntityC3c0FrameStepTraceCatalog() {
  return (mapData.entityBehaviorCatalogs || []).find(c =>
    c.id === 'world-entity-c3c0-frame-step-trace-catalog-2026-06-25'
  ) || null;
}

function roomEntityC3c0FrameStepStepperPreview(catalog) {
  const summary = catalog?.summary || {};
  const stateModels = Array.isArray(catalog?.stateModels) ? catalog.stateModels : [];
  const stateRows = stateModels.map((state, index) => {
    const traceSteps = Array.isArray(state.traceSteps) ? state.traceSteps : [];
    const countByType = type => traceSteps.filter(step => step?.stepType === type).length;
    const traceStepCount = traceSteps.length || Number(state.traceStepCount || 0);
    const fieldTouchEventCount = countByType('field_touch') || Number(state.fieldTouchCount || 0);
    const helperStubEventCount = countByType('helper_stub') || Number(state.helperStubCount || 0);
    const conditionalEventCount = countByType('conditional_control') || Number(state.conditionalControlCount || 0);
    return {
      frameIndex: index,
      behaviorStateIndex: Number.isFinite(Number(state.behaviorStateIndex)) ? Number(state.behaviorStateIndex) : index,
      targetOffset: state.targetOffset || '',
      targetRegionId: state.targetRegion?.id || '',
      controlRole: state.controlRole || state.modelRole || '',
      traceStepCount,
      fieldTouchEventCount,
      helperStubEventCount,
      conditionalEventCount,
      symbolicPredicateCount: Number(state.symbolicPredicateCount || 0),
      unresolvedPredicateCount: Number(state.unresolvedPredicateCount || 0),
      firstTickGuardCount: Number(state.firstTickGuardCount || 0),
      runtimeValueReadCount: 0,
      runtimeValueWriteCount: 0,
      branchOutcomeEvaluatedCount: 0,
      helperEffectEvaluatedCount: 0,
      persistedGameplayValueCount: 0,
      status: 'symbolic_frame_no_runtime_values'
    };
  });
  const total = field => stateRows.reduce((sum, row) => sum + Number(row[field] || 0), 0);
  return {
    catalogBacked: Boolean(catalog),
    catalogId: catalog?.id || '',
    candidateEntityType: summary.candidateEntityType || '',
    candidateSeedLabel: summary.candidateSeedLabel || '',
    behaviorListSource: summary.behaviorListSource || '',
    stateCount: stateRows.length,
    frameCount: stateRows.length,
    traceStepCount: total('traceStepCount'),
    fieldTouchEventCount: total('fieldTouchEventCount'),
    helperStubEventCount: total('helperStubEventCount'),
    conditionalEventCount: total('conditionalEventCount'),
    symbolicPredicateCount: total('symbolicPredicateCount'),
    unresolvedPredicateCount: total('unresolvedPredicateCount'),
    firstTickGuardCount: total('firstTickGuardCount'),
    runtimeValueReadCount: 0,
    runtimeValueWriteCount: 0,
    branchOutcomeEvaluatedCount: 0,
    helperEffectEvaluatedCount: 0,
    persistedGameplayValueCount: 0,
    status: catalog ? 'read_only_stepper_preview_ready_no_runtime_values' : 'missing_trace_catalog',
    assetPolicy: 'metadata_only_no_runtime_values_or_rom_bytes',
    stateRows
  };
}

function roomEntityC3c0FrameStepStepperTable(preview) {
  if (!preview?.catalogBacked || !preview.stateRows?.length) return '';
  const rows = preview.stateRows.map(row => `
    <tr>
      <td style="padding:2px 6px;color:#cbd5e1">${simEscapeHtml(String(row.behaviorStateIndex))}</td>
      <td style="padding:2px 6px;color:#cbd5e1">${simEscapeHtml(row.targetOffset || '?')}</td>
      <td style="padding:2px 6px;color:#cbd5e1">${simEscapeHtml(row.controlRole || '?')}</td>
      <td style="padding:2px 6px;text-align:right">${simEscapeHtml(String(row.traceStepCount || 0))}</td>
      <td style="padding:2px 6px;text-align:right">${simEscapeHtml(String(row.fieldTouchEventCount || 0))}</td>
      <td style="padding:2px 6px;text-align:right">${simEscapeHtml(String(row.helperStubEventCount || 0))}</td>
      <td style="padding:2px 6px;text-align:right">${simEscapeHtml(String(row.conditionalEventCount || 0))}</td>
      <td style="padding:2px 6px;text-align:right">${simEscapeHtml(String(row.unresolvedPredicateCount || 0))}</td>
      <td style="padding:2px 6px;color:#94a3b8">${simEscapeHtml(row.status || '?')}</td>
    </tr>
  `).join('');
  return `
    <h4 style="margin:8px 0 4px;color:#e5e7eb">C3C0 read-only stepper preview</h4>
    <table style="border-collapse:collapse;font-size:12px;margin:0 0 10px">
      <thead>
        <tr style="color:#94a3b8">
          <th style="padding:2px 6px;text-align:left">state</th>
          <th style="padding:2px 6px;text-align:left">target</th>
          <th style="padding:2px 6px;text-align:left">role</th>
          <th style="padding:2px 6px;text-align:right">steps</th>
          <th style="padding:2px 6px;text-align:right">fields</th>
          <th style="padding:2px 6px;text-align:right">helpers</th>
          <th style="padding:2px 6px;text-align:right">branches</th>
          <th style="padding:2px 6px;text-align:right">unresolved</th>
          <th style="padding:2px 6px;text-align:left">status</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function roomEntityFrameCoverageClearPreviewDataset(out) {
  if (!out) return;
  for (const key of Object.keys(out.dataset)) {
    if (key.startsWith('roomEntityFrameCoverage')) delete out.dataset[key];
  }
}

function roomEntityFrameCoverageStatusText(status) {
  if (status === 'all_observed_uploads_cover_frame_tiles') return 'covered';
  if (status === 'needs_frame_tile_base_trace') return 'needs trace';
  if (status === 'no_high_confidence_frame_asset') return 'no frame asset';
  return status || '?';
}

function roomEntityFrameCoverageTable(catalog) {
  const rows = (catalog?.entityFrameCoverage || []).slice()
    .sort((a, b) => {
      const rank = status => status === 'needs_frame_tile_base_trace' ? 0 : status === 'all_observed_uploads_cover_frame_tiles' ? 1 : 2;
      return rank(a.coverageStatus) - rank(b.coverageStatus) || (b.uploadCount || 0) - (a.uploadCount || 0) || String(a.entityType || '').localeCompare(String(b.entityType || ''));
    })
    .slice(0, 24)
    .map(item => {
      const frameRange = item.frameTileByteRange
        ? `${item.frameTileByteRange.min || '?'}..${item.frameTileByteRange.max || '?'} / ${item.frameTileByteRange.uniqueCount || 0}`
        : 'none';
      return `
        <tr>
          <td style="padding:2px 6px;color:#cbd5e1">${simEscapeHtml(item.entityType || '?')}</td>
          <td style="padding:2px 6px;color:#94a3b8">${simEscapeHtml(item.selectorTypeHex || '?')}${item.highBitVariant ? ' alt' : ''}</td>
          <td style="padding:2px 6px;color:#fdba74">${simEscapeHtml(roomEntityFrameCoverageStatusText(item.coverageStatus))}</td>
          <td style="padding:2px 6px">${simEscapeHtml(String(item.uploadCount || 0))}</td>
          <td style="padding:2px 6px;color:#4ade80">${simEscapeHtml(String(item.coveredUploadCount || 0))}</td>
          <td style="padding:2px 6px;color:#fbbf24">${simEscapeHtml(String(item.partialCoverageUploadCount || 0))}</td>
          <td style="padding:2px 6px;color:#94a3b8">${simEscapeHtml(`${item.minAssignedTileCount || 0}..${item.maxAssignedTileCount || 0}`)}</td>
          <td style="padding:2px 6px">${simEscapeHtml(frameRange)}</td>
        </tr>
      `;
    }).join('');
  return `
    <div style="color:#fdba74;font-weight:bold;margin:0 0 3px">Entity coverage by dynamic upload range</div>
    <table style="border-collapse:collapse;margin-bottom:4px">
      <thead>
        <tr style="color:#888">
          <th style="text-align:left;padding:2px 6px">raw</th>
          <th style="text-align:left;padding:2px 6px">selector</th>
          <th style="text-align:left;padding:2px 6px">status</th>
          <th style="text-align:left;padding:2px 6px">uploads</th>
          <th style="text-align:left;padding:2px 6px">covered</th>
          <th style="text-align:left;padding:2px 6px">partial</th>
          <th style="text-align:left;padding:2px 6px">assigned</th>
          <th style="text-align:left;padding:2px 6px">frame range</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="8" style="padding:2px 6px;color:#888">No frame coverage entries</td></tr>'}</tbody>
    </table>
  `;
}

function roomEntityFrameTracePriorityTable(catalog) {
  const rows = (catalog?.priorities || []).slice(0, 12)
    .map(item => {
      const assigned = item.assignedTileCountRange
        ? `${item.assignedTileCountRange.min || 0}..${item.assignedTileCountRange.max || 0}`
        : '?';
      const frame = item.frameTileByteRange
        ? `${item.frameTileByteRange.min || '?'}..${item.frameTileByteRange.max || '?'} / ${item.frameTileByteRange.uniqueCount || 0}`
        : 'none';
      const stream = item.dynamicTile?.streamRegionId || item.dynamicTile?.streamRomOffset || '?';
      return `
        <tr>
          <td style="padding:2px 6px;color:#93c5fd">${simEscapeHtml(String(item.priorityRank || '?'))}</td>
          <td style="padding:2px 6px;color:#cbd5e1">${simEscapeHtml(item.entityType || '?')}</td>
          <td style="padding:2px 6px;color:#94a3b8">${simEscapeHtml(item.selectorTypeHex || '?')}${item.highBitVariant ? ' alt' : ''}</td>
          <td style="padding:2px 6px">${simEscapeHtml(String(item.uploadCount || 0))}</td>
          <td style="padding:2px 6px;color:#fbbf24">${simEscapeHtml(String(item.partialCoverageUploadCount || 0))}</td>
          <td style="padding:2px 6px;color:#94a3b8">${simEscapeHtml(assigned)}</td>
          <td style="padding:2px 6px">${simEscapeHtml(frame)}</td>
          <td style="padding:2px 6px;color:#94a3b8">${simEscapeHtml(stream)}</td>
        </tr>
      `;
    }).join('');
  return `
    <div style="color:#93c5fd;font-weight:bold;margin:6px 0 3px">Frame tile-base trace priority</div>
    <table style="border-collapse:collapse;margin-bottom:4px">
      <thead>
        <tr style="color:#888">
          <th style="text-align:left;padding:2px 6px">rank</th>
          <th style="text-align:left;padding:2px 6px">raw</th>
          <th style="text-align:left;padding:2px 6px">selector</th>
          <th style="text-align:left;padding:2px 6px">uploads</th>
          <th style="text-align:left;padding:2px 6px">partial</th>
          <th style="text-align:left;padding:2px 6px">assigned</th>
          <th style="text-align:left;padding:2px 6px">frame range</th>
          <th style="text-align:left;padding:2px 6px">stream</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="8" style="padding:2px 6px;color:#888">No trace priorities</td></tr>'}</tbody>
    </table>
  `;
}

function roomEntityRenderableFrameFixtureTable(catalog) {
  const rows = (catalog?.entities || []).slice(0, 12)
    .map(item => {
      const sample = (item.fixtures || []).slice(0, 3)
        .map(fixture => fixture.frameSubrecord?.id || fixture.fixtureId || '?')
        .join(', ');
      return `
        <tr>
          <td style="padding:2px 6px;color:#93c5fd">${simEscapeHtml(String(item.priorityRank || '?'))}</td>
          <td style="padding:2px 6px;color:#cbd5e1">${simEscapeHtml(item.entityType || '?')}</td>
          <td style="padding:2px 6px;color:#94a3b8">${simEscapeHtml(item.selectorTypeHex || '?')}${item.highBitVariant ? ' alt' : ''}</td>
          <td style="padding:2px 6px;color:#4ade80">${simEscapeHtml(String(item.fixtureCount || 0))}</td>
          <td style="padding:2px 6px">${simEscapeHtml(String(item.dynamicUploadBackedFixtureCount || 0))}</td>
          <td style="padding:2px 6px;color:#94a3b8">${simEscapeHtml(String(item.emptyFrameFixtureCount || 0))}</td>
          <td style="padding:2px 6px;color:#fbbf24">${simEscapeHtml(String(item.partialSubrecordCount || 0))}</td>
          <td style="padding:2px 6px;color:#f87171">${simEscapeHtml(String(item.blockedSubrecordCount || 0))}</td>
          <td style="padding:2px 6px;color:#94a3b8">${simEscapeHtml(sample || 'none')}</td>
        </tr>
      `;
    }).join('');
  return `
    <div style="color:#86efac;font-weight:bold;margin:6px 0 3px">Renderable frame fixtures</div>
    <table style="border-collapse:collapse;margin-bottom:4px">
      <thead>
        <tr style="color:#888">
          <th style="text-align:left;padding:2px 6px">rank</th>
          <th style="text-align:left;padding:2px 6px">raw</th>
          <th style="text-align:left;padding:2px 6px">selector</th>
          <th style="text-align:left;padding:2px 6px">fixtures</th>
          <th style="text-align:left;padding:2px 6px">dynamic</th>
          <th style="text-align:left;padding:2px 6px">empty</th>
          <th style="text-align:left;padding:2px 6px">partial</th>
          <th style="text-align:left;padding:2px 6px">blocked</th>
          <th style="text-align:left;padding:2px 6px">sample frames</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="9" style="padding:2px 6px;color:#888">No renderable frame fixtures</td></tr>'}</tbody>
    </table>
  `;
}

function roomEntityFindRepresentativeDynamicUpload(entityType, dynamicTile) {
  const catalog = roomEntityDynamicCatalog();
  const streamOffset = dynamicTile?.streamRomOffset || '';
  const remapRow = Number(dynamicTile?.remapRow || 0);
  for (const room of catalog?.roomSummaries || []) {
    for (const upload of room.uploads || []) {
      if (upload.entityType !== entityType) continue;
      if (streamOffset && upload.streamRomOffset !== streamOffset) continue;
      if (Number(upload.remapRow || 0) !== remapRow) continue;
      return {
        roomSubrecordIndex: room.subrecordIndex,
        upload,
      };
    }
  }
  return null;
}

function roomEntitySignedByte(value) {
  return value & 0x80 ? value - 0x100 : value;
}

function roomEntityRuntimeFramePieces(offset, recordLimit) {
  const pieces = [];
  const issues = [];
  if (!romData) return { pieces, tileBytes: [], terminated: false, issues: [{ kind: 'rom_not_loaded' }] };
  if (offset == null || offset < 0 || offset >= romData.length) {
    return { pieces, tileBytes: [], terminated: false, issues: [{ kind: 'invalid_frame_offset' }] };
  }
  let pos = offset;
  let terminated = false;
  const limit = recordLimit || 160;
  for (let index = 0; index < limit; index++) {
    if (pos >= romData.length) {
      issues.push({ kind: 'out_of_rom' });
      break;
    }
    const control = romData[pos++];
    if (control === 0x80) {
      terminated = true;
      break;
    }
    if (pos + 1 >= romData.length) {
      issues.push({ kind: 'truncated_piece_record' });
      break;
    }
    const yRaw = romData[pos++];
    const tileByte = romData[pos++];
    pieces.push({
      dx: roomEntitySignedByte(control),
      dy: roomEntitySignedByte(yRaw),
      tileByte,
    });
  }
  if (!terminated && !issues.length) issues.push({ kind: 'record_limit_reached' });
  return {
    pieces,
    tileBytes: pieces.map(piece => piece.tileByte),
    terminated,
    issues,
  };
}

function roomEntityDrawFixtureLayoutPreview(canvas, frames, zoom) {
  if (!canvas) return;
  const z = zoom || 2;
  const columns = 5;
  const cellW = 48;
  const cellH = 48;
  const rows = Math.max(1, Math.ceil(frames.length / columns));
  canvas.width = columns * cellW * z;
  canvas.height = rows * cellH * z;
  canvas.style.display = 'block';
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const palette = [
    '#080808', '#3b82f6', '#22c55e', '#eab308',
    '#ef4444', '#a855f7', '#14b8a6', '#f97316',
    '#94a3b8', '#60a5fa', '#4ade80', '#fde047',
    '#f87171', '#c084fc', '#2dd4bf', '#fb923c',
  ];
  for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
    const frame = frames[frameIndex];
    const col = frameIndex % columns;
    const row = Math.floor(frameIndex / columns);
    const cellX = col * cellW * z;
    const cellY = row * cellH * z;
    ctx.strokeStyle = '#1f2937';
    ctx.strokeRect(cellX + 0.5, cellY + 0.5, cellW * z - 1, cellH * z - 1);
    if (!frame.pieces.length) continue;
    let minX = 0, minY = 0, maxX = 8, maxY = 8;
    for (const piece of frame.pieces) {
      minX = Math.min(minX, piece.dx);
      minY = Math.min(minY, piece.dy);
      maxX = Math.max(maxX, piece.dx + 8);
      maxY = Math.max(maxY, piece.dy + 8);
    }
    const shapeW = Math.max(8, maxX - minX);
    const shapeH = Math.max(8, maxY - minY);
    const originX = cellX + Math.floor((cellW - shapeW) * z / 2) - minX * z;
    const originY = cellY + Math.floor((cellH - shapeH) * z / 2) - minY * z;
    for (const piece of frame.pieces) {
      const bx = originX + piece.dx * z;
      const by = originY + piece.dy * z;
      if (!piece.resolved) {
        ctx.fillStyle = '#450a0a';
        ctx.fillRect(bx, by, 8 * z, 8 * z);
        ctx.strokeStyle = '#f87171';
        ctx.strokeRect(bx + 0.5, by + 0.5, 8 * z - 1, 8 * z - 1);
        continue;
      }
      const pixels = decodeTile(frame.state.vram, piece.tile * 32);
      if (!pixels) continue;
      for (let py = 0; py < 8; py++) for (let px = 0; px < 8; px++) {
        const ci = pixels[py * 8 + px] || 0;
        if (ci === 0) continue;
        ctx.fillStyle = palette[ci];
        ctx.fillRect(bx + px * z, by + py * z, z, z);
      }
    }
  }
}

function roomEntityRenderableFixtureRuntimePreview(catalog, canvas) {
  const result = {
    runtimeDecoded: false,
    previewedFixtureCount: 0,
    renderedFixtureRowCount: 0,
    renderedTileCount: 0,
    renderedPieceCount: 0,
    layoutPreviewedFixtureCount: 0,
    emptyFixtureCount: 0,
    unresolvedTileRefCount: 0,
    skippedFixtureCount: 0,
    parseIssueCount: 0,
    warningCount: 0,
    coordinateMode: 'normalized_piece_offsets_without_runtime_slot_position',
    persistedTileByteCount: 0,
    persistedPixelCount: 0,
    persistedCoordinateCount: 0,
    warnings: [],
  };
  if (!catalog) return result;
  if (!romData) {
    result.warnings.push('ROM is not loaded; renderable frame fixture runtime preview is unavailable.');
    result.warningCount = result.warnings.length;
    return result;
  }

  const drawFrames = [];
  for (const fixture of catalog.fixtures || []) {
    result.previewedFixtureCount++;
    const frameOffset = parseHex(fixture.frameSubrecord?.offset);
    const parsed = roomEntityRuntimeFramePieces(frameOffset);
    if (!parsed.terminated || parsed.issues.length) result.parseIssueCount++;
    if (!parsed.pieces.length) {
      result.emptyFixtureCount++;
      continue;
    }
    const representative = roomEntityFindRepresentativeDynamicUpload(fixture.entityType, fixture.dynamicTile);
    if (!representative) {
      result.skippedFixtureCount++;
      result.warnings.push(`No representative dynamic upload found for ${fixture.fixtureId || fixture.entityType || 'fixture'}.`);
      continue;
    }
    const initialTile = parseHex(representative.upload.assignedTileRange?.start);
    const streamOffset = parseHex(representative.upload.streamRomOffset);
    if (initialTile == null || streamOffset == null) {
      result.skippedFixtureCount++;
      result.warnings.push(`Representative dynamic upload lacks tile range or stream offset for ${fixture.fixtureId || fixture.entityType || 'fixture'}.`);
      continue;
    }
    const state = createSMSState();
    const region = representative.upload.streamRegion?.id
      ? mapData.regions.find(r => r.id === representative.upload.streamRegion.id)
      : simFindRegionForOffset(streamOffset);
    simRunDynamicTileStreamA97(romData, streamOffset, state, {
      initialTile,
      remapRow: representative.upload.remapRow || 0,
      regionId: region?.id || '',
      regionName: region?.name || representative.upload.streamRegion?.name || 'dynamic tile stream',
      roomSubrecordIndex: representative.roomSubrecordIndex,
      entityType: fixture.entityType,
    });
    const pieces = parsed.pieces.map(piece => {
      const tile = (initialTile + piece.tileByte) & 0xFF;
      const prov = state.tileProvenance?.[tile];
      const resolved = Boolean(prov && prov.status !== 'unresolved');
      result.renderedPieceCount++;
      if (resolved) result.renderedTileCount++;
      else result.unresolvedTileRefCount++;
      return {
        dx: piece.dx,
        dy: piece.dy,
        tile,
        resolved,
      };
    });
    drawFrames.push({ fixtureId: fixture.fixtureId, state, pieces });
  }

  result.runtimeDecoded = true;
  result.renderedFixtureRowCount = drawFrames.length;
  result.layoutPreviewedFixtureCount = drawFrames.length;
  result.coordinateMode = 'normalized_piece_offsets_without_runtime_slot_position';
  result.warningCount = result.warnings.length;
  roomEntityDrawFixtureLayoutPreview(canvas, drawFrames, 2);
  if (canvas) {
    canvas.dataset.renderedFixtureRowCount = String(result.renderedFixtureRowCount);
    canvas.dataset.renderedTileCount = String(result.renderedTileCount);
    canvas.dataset.renderedPieceCount = String(result.renderedPieceCount);
    canvas.dataset.unresolvedTileRefCount = String(result.unresolvedTileRefCount);
  }
  return result;
}

function roomEntityFrameSubrecordCoverageTable(catalog) {
  const rows = (catalog?.entities || []).slice(0, 12)
    .map(item => `
      <tr>
        <td style="padding:2px 6px;color:#93c5fd">${simEscapeHtml(String(item.priorityRank || '?'))}</td>
        <td style="padding:2px 6px;color:#cbd5e1">${simEscapeHtml(item.entityType || '?')}</td>
        <td style="padding:2px 6px;color:#94a3b8">${simEscapeHtml(item.selectorTypeHex || '?')}${item.highBitVariant ? ' alt' : ''}</td>
        <td style="padding:2px 6px">${simEscapeHtml(String(item.frameSubrecordCount || 0))}</td>
        <td style="padding:2px 6px;color:#4ade80">${simEscapeHtml(String(item.renderableWithoutAdditionalTileTraceSubrecordCount || 0))}</td>
        <td style="padding:2px 6px;color:#fbbf24">${simEscapeHtml(String(item.mixedOrPartialSubrecordCount || 0))}</td>
        <td style="padding:2px 6px;color:#f87171">${simEscapeHtml(String(item.notCoveredSubrecordCount || 0))}</td>
        <td style="padding:2px 6px;color:#94a3b8">${simEscapeHtml(String(item.dynamicCoveredFramePercent || 0))}%</td>
      </tr>
    `).join('');
  return `
    <div style="color:#4ade80;font-weight:bold;margin:6px 0 3px">Frame subrecord dynamic coverage</div>
    <table style="border-collapse:collapse;margin-bottom:4px">
      <thead>
        <tr style="color:#888">
          <th style="text-align:left;padding:2px 6px">rank</th>
          <th style="text-align:left;padding:2px 6px">raw</th>
          <th style="text-align:left;padding:2px 6px">selector</th>
          <th style="text-align:left;padding:2px 6px">frames</th>
          <th style="text-align:left;padding:2px 6px">renderable</th>
          <th style="text-align:left;padding:2px 6px">partial</th>
          <th style="text-align:left;padding:2px 6px">blocked</th>
          <th style="text-align:left;padding:2px 6px">covered %</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="8" style="padding:2px 6px;color:#888">No frame subrecord coverage entries</td></tr>'}</tbody>
    </table>
  `;
}

function roomEntityFrameCoverageRenderPreview() {
  const out = document.getElementById('room-entity-frame-coverage-preview');
  const info = document.getElementById('room-entity-frame-coverage-info');
  if (!out) return null;
  roomEntityFrameCoverageClearPreviewDataset(out);

  const catalog = roomEntityFrameCoverageCatalog();
  const tracePriorityCatalog = roomEntityFrameTracePriorityCatalog();
  const subrecordCoverageCatalog = roomEntityFrameSubrecordCoverageCatalog();
  const fixtureCatalog = roomEntityRenderableFrameFixtureCatalog();
  const oamSemanticsCatalog = roomEntityOamWriterSemanticsCatalog();
  const slotCoordinateCatalog = roomEntitySlotCoordinateFieldProvenanceCatalog();
  const positionIntegratorCatalog = roomEntityPositionIntegratorCatalog();
  const velocityFieldCatalog = roomEntityVelocityFieldProvenanceCatalog();
  const motionDeltaCatalog = roomEntityMotionDeltaFieldProvenanceCatalog();
  const motionDeltaBehaviorCatalog = roomEntityMotionDeltaBehaviorLinkCatalog();
  const c3c0MotionSeedCatalog = roomEntityC3c0MotionSeedFamilyCatalog();
  const c3c0MotionSeedTargetCatalog = roomEntityC3c0MotionSeedTargetLinkCatalog();
  const c3c0BehaviorTargetSemanticsCatalog = roomEntityC3c0BehaviorTargetSemanticsCatalog();
  const c3c0ActorFamilyCatalog = roomEntityC3c0ActorFamilyCatalog();
  const c3c0RenderabilityCatalog = roomEntityC3c0RenderabilityCatalog();
  const c3c0FrameStepDiagnosticCatalog = roomEntityC3c0FrameStepDiagnosticCatalog();
  const c3c0FrameStepControlFlowCatalog = roomEntityC3c0FrameStepControlFlowCatalog();
  const c3c0FrameStepTraceCatalog = roomEntityC3c0FrameStepTraceCatalog();
  const summary = catalog?.summary || {};
  const traceSummary = tracePriorityCatalog?.summary || {};
  const subrecordSummary = subrecordCoverageCatalog?.summary || {};
  const fixtureSummary = fixtureCatalog?.summary || {};
  const oamSemanticsSummary = oamSemanticsCatalog?.summary || {};
  const slotCoordinateSummary = slotCoordinateCatalog?.summary || {};
  const positionIntegratorSummary = positionIntegratorCatalog?.summary || {};
  const velocityFieldSummary = velocityFieldCatalog?.summary || {};
  const motionDeltaSummary = motionDeltaCatalog?.summary || {};
  const motionDeltaBehaviorSummary = motionDeltaBehaviorCatalog?.summary || {};
  const c3c0MotionSeedSummary = c3c0MotionSeedCatalog?.summary || {};
  const c3c0MotionSeedTargetSummary = c3c0MotionSeedTargetCatalog?.summary || {};
  const c3c0BehaviorTargetSemanticsSummary = c3c0BehaviorTargetSemanticsCatalog?.summary || {};
  const c3c0ActorFamilySummary = c3c0ActorFamilyCatalog?.summary || {};
  const c3c0RenderabilitySummary = c3c0RenderabilityCatalog?.summary || {};
  const c3c0FrameStepDiagnosticSummary = c3c0FrameStepDiagnosticCatalog?.summary || {};
  const c3c0FrameStepControlFlowSummary = c3c0FrameStepControlFlowCatalog?.summary || {};
  const c3c0FrameStepTraceSummary = c3c0FrameStepTraceCatalog?.summary || {};
  const c3c0FrameStepStepperPreview = roomEntityC3c0FrameStepStepperPreview(c3c0FrameStepTraceCatalog);
  const fixtureRuntimeCanvas = document.createElement('canvas');
  fixtureRuntimeCanvas.id = 'room-entity-renderable-fixture-canvas';
  fixtureRuntimeCanvas.style.cssText = 'display:block;image-rendering:pixelated;border:1px solid #1f2937;margin:4px 0 8px;background:#000;max-width:100%;';
  const fixtureRuntime = roomEntityRenderableFixtureRuntimePreview(fixtureCatalog, fixtureRuntimeCanvas);
  const warnings = [];
  if (!catalog) warnings.push('Room entity dynamic frame coverage catalog is missing.');
  if (!tracePriorityCatalog) warnings.push('Room entity frame trace priority catalog is missing.');
  if (!subrecordCoverageCatalog) warnings.push('Room entity frame subrecord coverage catalog is missing.');
  if (!fixtureCatalog) warnings.push('Room entity renderable frame fixture catalog is missing.');
  if (!oamSemanticsCatalog) warnings.push('Metasprite OAM writer semantics catalog is missing.');
  if (!slotCoordinateCatalog) warnings.push('Entity slot coordinate field provenance catalog is missing.');
  if (!positionIntegratorCatalog) warnings.push('Entity position integrator catalog is missing.');
  if (!velocityFieldCatalog) warnings.push('Entity velocity field provenance catalog is missing.');
  if (!motionDeltaCatalog) warnings.push('Entity motion delta field provenance catalog is missing.');
  if (!motionDeltaBehaviorCatalog) warnings.push('Entity motion delta behavior link catalog is missing.');
  if (!c3c0MotionSeedCatalog) warnings.push('C3C0 motion seed family catalog is missing.');
  if (!c3c0MotionSeedTargetCatalog) warnings.push('C3C0 motion seed target-link catalog is missing.');
  if (!c3c0BehaviorTargetSemanticsCatalog) warnings.push('C3C0 behavior target semantics catalog is missing.');
  if (!c3c0ActorFamilyCatalog) warnings.push('C3C0 actor family catalog is missing.');
  if (!c3c0RenderabilityCatalog) warnings.push('C3C0 renderability catalog is missing.');
  if (!c3c0FrameStepDiagnosticCatalog) warnings.push('C3C0 frame-step diagnostic catalog is missing.');
  if (!c3c0FrameStepControlFlowCatalog) warnings.push('C3C0 frame-step control-flow catalog is missing.');
  if (!c3c0FrameStepTraceCatalog) warnings.push('C3C0 frame-step trace catalog is missing.');
  if (oamSemanticsCatalog && Number(oamSemanticsSummary.pieceRecordByteLength || 0) !== 3) {
    warnings.push(`Metasprite OAM writer piece record length is ${oamSemanticsSummary.pieceRecordByteLength || 'unknown'}, expected 3.`);
  }
  if (slotCoordinateCatalog && Number(slotCoordinateSummary.unknownReferenceCount || 0)) {
    warnings.push(`${slotCoordinateSummary.unknownReferenceCount} slot coordinate field reference(s) have unknown access type.`);
  }
  if (positionIntegratorCatalog && Number(positionIntegratorSummary.integratorRoutineCount || 0) !== 3) {
    warnings.push(`Entity position integrator catalog has ${positionIntegratorSummary.integratorRoutineCount || 0} routine(s), expected 3.`);
  }
  if (velocityFieldCatalog && Number(velocityFieldSummary.unknownReferenceCount || 0)) {
    warnings.push(`${velocityFieldSummary.unknownReferenceCount} velocity field reference(s) have unknown access type.`);
  }
  if (motionDeltaCatalog && Number(motionDeltaSummary.unknownReferenceCount || 0)) {
    warnings.push(`${motionDeltaSummary.unknownReferenceCount} motion delta field reference(s) have unknown access type.`);
  }
  if (motionDeltaBehaviorCatalog && Number(motionDeltaBehaviorSummary.unresolvedWriterRoutineCount || 0)) {
    warnings.push(`${motionDeltaBehaviorSummary.unresolvedWriterRoutineCount} motion delta writer routine(s) still lack behavior-family links.`);
  }
  if (c3c0MotionSeedCatalog && Number(c3c0MotionSeedSummary.unresolvedBehaviorListSeedRoutineCount || 0)) {
    warnings.push(`${c3c0MotionSeedSummary.unresolvedBehaviorListSeedRoutineCount} C3C0 motion seed routine(s) still lack behavior-list sources.`);
  }
  if (c3c0MotionSeedTargetCatalog && Number(c3c0MotionSeedTargetSummary.missingBehaviorListSourceCount || 0)) {
    warnings.push(`${c3c0MotionSeedTargetSummary.missingBehaviorListSourceCount} C3C0 motion seed behavior-list source(s) lack decoded target links.`);
  }
  if (catalog && Number(summary.frameParseIssueUploadCount || 0)) warnings.push(`${summary.frameParseIssueUploadCount} frame parse issue upload(s) were recorded.`);
  if (fixtureRuntime.parseIssueCount) warnings.push(`${fixtureRuntime.parseIssueCount} renderable fixture frame parse issue(s) were recorded.`);
  if (fixtureRuntime.unresolvedTileRefCount) warnings.push(`${fixtureRuntime.unresolvedTileRefCount} renderable fixture tile reference(s) were unresolved.`);
  if (fixtureRuntime.skippedFixtureCount) warnings.push(`${fixtureRuntime.skippedFixtureCount} renderable fixture(s) could not be replayed.`);
  warnings.push(...fixtureRuntime.warnings);

  const totalDynamicEntityUploads = Number(summary.totalDynamicEntityUploads || 0);
  const frameLinkedUploadCount = Number(summary.frameLinkedUploadCount || 0);
  const fullyCoveredUploadCount = Number(summary.fullyCoveredUploadCount || 0);
  const partialCoverageUploadCount = Number(summary.partialCoverageUploadCount || 0);
  const noFrameAssetUploadCount = Number(summary.noFrameAssetUploadCount || 0);
  const needsTraceEntityTypeCount = Number(summary.needsTraceEntityTypeCount || 0);
  const assetPolicy = 'metadata_only_no_rom_bytes_or_pixels';

  out.dataset.roomEntityFrameCoverageCatalogBacked = catalog ? '1' : '0';
  out.dataset.roomEntityFrameCoverageCatalogId = catalog?.id || '';
  out.dataset.roomEntityFrameCoveragePreviewOk = warnings.length ? '0' : '1';
  out.dataset.roomEntityFrameCoverageTotalDynamicEntityUploads = String(totalDynamicEntityUploads);
  out.dataset.roomEntityFrameCoverageFrameLinkedUploadCount = String(frameLinkedUploadCount);
  out.dataset.roomEntityFrameCoverageFullyCoveredUploadCount = String(fullyCoveredUploadCount);
  out.dataset.roomEntityFrameCoveragePartialCoverageUploadCount = String(partialCoverageUploadCount);
  out.dataset.roomEntityFrameCoverageNoFrameAssetUploadCount = String(noFrameAssetUploadCount);
  out.dataset.roomEntityFrameCoverageDynamicEntityTypeCount = String(summary.dynamicEntityTypeCount || 0);
  out.dataset.roomEntityFrameCoverageFrameLinkedEntityTypeCount = String(summary.frameLinkedEntityTypeCount || 0);
  out.dataset.roomEntityFrameCoverageFullyCoveredEntityTypeCount = String(summary.fullyCoveredEntityTypeCount || 0);
  out.dataset.roomEntityFrameCoverageNeedsTraceEntityTypeCount = String(needsTraceEntityTypeCount);
  out.dataset.roomEntityFrameCoverageTracePriorityCatalogBacked = tracePriorityCatalog ? '1' : '0';
  out.dataset.roomEntityFrameCoverageTracePriorityCatalogId = tracePriorityCatalog?.id || '';
  out.dataset.roomEntityFrameCoverageTracePriorityEntityTypeCount = String(traceSummary.tracePriorityEntityTypeCount || 0);
  out.dataset.roomEntityFrameCoverageTracePriorityTopEntityType = traceSummary.topEntityType || '';
  out.dataset.roomEntityFrameCoverageTracePriorityTopUploadCount = String(traceSummary.topUploadCount || 0);
  out.dataset.roomEntityFrameCoverageTracePriorityPartialUploadCount = String(traceSummary.totalPartialCoverageUploads || 0);
  out.dataset.roomEntityFrameCoverageSubrecordCatalogBacked = subrecordCoverageCatalog ? '1' : '0';
  out.dataset.roomEntityFrameCoverageSubrecordCatalogId = subrecordCoverageCatalog?.id || '';
  out.dataset.roomEntityFrameCoverageSubrecordEntityTypeCount = String(subrecordSummary.tracedPriorityEntityTypeCount || 0);
  out.dataset.roomEntityFrameCoverageSubrecordTotalFrameCount = String(subrecordSummary.totalFrameSubrecords || 0);
  out.dataset.roomEntityFrameCoverageSubrecordRenderableFrameCount = String(subrecordSummary.totalRenderableWithoutAdditionalTileTraceSubrecords || 0);
  out.dataset.roomEntityFrameCoverageSubrecordDynamicCoveredFrameCount = String(subrecordSummary.totalDynamicCoveredSubrecords || 0);
  out.dataset.roomEntityFrameCoverageSubrecordNotCoveredFrameCount = String(subrecordSummary.totalNotCoveredSubrecords || 0);
  out.dataset.roomEntityFrameCoverageSubrecordTopEntityType = subrecordSummary.topEntityType || '';
  out.dataset.roomEntityFrameCoverageSubrecordTopEntityFrameCount = String(subrecordSummary.topEntityFrameSubrecordCount || 0);
  out.dataset.roomEntityFrameCoverageSubrecordTopEntityRenderableFrameCount = String(subrecordSummary.topEntityRenderableWithoutAdditionalTileTraceSubrecordCount || 0);
  out.dataset.roomEntityFrameCoverageSubrecordTopEntityNotCoveredFrameCount = String(subrecordSummary.topEntityNotCoveredSubrecordCount || 0);
  out.dataset.roomEntityFrameCoverageSubrecordParseIssueCount = String(subrecordSummary.parseIssueSubrecordCount || 0);
  out.dataset.roomEntityFrameCoverageRenderableFixtureCatalogBacked = fixtureCatalog ? '1' : '0';
  out.dataset.roomEntityFrameCoverageRenderableFixtureCatalogId = fixtureCatalog?.id || '';
  out.dataset.roomEntityFrameCoverageRenderableFixtureEntityTypeCount = String(fixtureSummary.fixtureEntityTypeCount || 0);
  out.dataset.roomEntityFrameCoverageRenderableFixtureCount = String(fixtureSummary.fixtureCount || 0);
  out.dataset.roomEntityFrameCoverageRenderableFixtureDynamicBackedCount = String(fixtureSummary.dynamicUploadBackedFixtureCount || 0);
  out.dataset.roomEntityFrameCoverageRenderableFixtureEmptyFrameCount = String(fixtureSummary.emptyFrameFixtureCount || 0);
  out.dataset.roomEntityFrameCoverageRenderableFixtureBlockedOrPartialSubrecordCount = String(fixtureSummary.blockedOrPartialSubrecordCount || 0);
  out.dataset.roomEntityFrameCoverageRenderableFixtureTopEntityType = fixtureSummary.topEntityType || '';
  out.dataset.roomEntityFrameCoverageRenderableFixtureTopEntityFixtureCount = String(fixtureSummary.topEntityFixtureCount || 0);
  out.dataset.roomEntityFrameCoverageRenderableFixtureTopEntityBlockedSubrecordCount = String(fixtureSummary.topEntityBlockedSubrecordCount || 0);
  out.dataset.roomEntityFrameCoverageRenderableFixtureParseIssueCount = String(fixtureSummary.parseIssueSubrecordCount || 0);
  out.dataset.roomEntityFrameCoverageOamSemanticsCatalogBacked = oamSemanticsCatalog ? '1' : '0';
  out.dataset.roomEntityFrameCoverageOamSemanticsCatalogId = oamSemanticsCatalog?.id || '';
  out.dataset.roomEntityFrameCoverageOamPieceRecordByteLength = String(oamSemanticsSummary.pieceRecordByteLength || 0);
  out.dataset.roomEntityFrameCoverageOamOutputRecordByteLength = String(oamSemanticsSummary.outputRecordByteLength || 0);
  out.dataset.roomEntityFrameCoverageOamFrameStreamRoutine = oamSemanticsSummary.frameStreamRoutine || '';
  out.dataset.roomEntityFrameCoverageOamSlotScanRoutine = oamSemanticsSummary.slotScanRoutine || '';
  out.dataset.roomEntityFrameCoverageOamPositionProducerRoutine = oamSemanticsSummary.positionProducerRoutine || '';
  out.dataset.roomEntityFrameCoverageOamTileBaseField = oamSemanticsSummary.tileBaseField || '';
  out.dataset.roomEntityFrameCoverageOamXBaseRam = oamSemanticsSummary.xBaseRam || '';
  out.dataset.roomEntityFrameCoverageOamYBaseRam = oamSemanticsSummary.yBaseRam || '';
  out.dataset.roomEntityFrameCoverageOamXBaseSlotFields = oamSemanticsSummary.xBaseSlotFields || '';
  out.dataset.roomEntityFrameCoverageOamYBaseSlotFields = oamSemanticsSummary.yBaseSlotFields || '';
  out.dataset.roomEntityFrameCoverageOamXCameraRam = oamSemanticsSummary.xCameraRam || '';
  out.dataset.roomEntityFrameCoverageOamYCameraRam = oamSemanticsSummary.yCameraRam || '';
  out.dataset.roomEntityFrameCoverageOamCameraSubtractFlag = oamSemanticsSummary.cameraSubtractFlag || '';
  out.dataset.roomEntityFrameCoverageOamPersistedCoordinateCount = String(oamSemanticsSummary.persistedCoordinateCount || 0);
  out.dataset.roomEntityFrameCoverageSlotCoordinateCatalogBacked = slotCoordinateCatalog ? '1' : '0';
  out.dataset.roomEntityFrameCoverageSlotCoordinateCatalogId = slotCoordinateCatalog?.id || '';
  out.dataset.roomEntityFrameCoverageSlotCoordinateFieldCount = String(slotCoordinateSummary.fieldCount || 0);
  out.dataset.roomEntityFrameCoverageSlotCoordinateReferenceCount = String(slotCoordinateSummary.referenceCount || 0);
  out.dataset.roomEntityFrameCoverageSlotCoordinateReadReferenceCount = String(slotCoordinateSummary.readReferenceCount || 0);
  out.dataset.roomEntityFrameCoverageSlotCoordinateWriteReferenceCount = String(slotCoordinateSummary.writeReferenceCount || 0);
  out.dataset.roomEntityFrameCoverageSlotCoordinateReadWriteReferenceCount = String(slotCoordinateSummary.readWriteReferenceCount || 0);
  out.dataset.roomEntityFrameCoverageSlotCoordinateUnknownReferenceCount = String(slotCoordinateSummary.unknownReferenceCount || 0);
  out.dataset.roomEntityFrameCoverageSlotCoordinateRoutineReferenceCount = String(slotCoordinateSummary.routineReferenceCount || 0);
  out.dataset.roomEntityFrameCoverageSlotCoordinateConfirmedContextReferenceCount = String(slotCoordinateSummary.confirmedContextReferenceCount || 0);
  out.dataset.roomEntityFrameCoverageSlotCoordinateCandidateContextReferenceCount = String(slotCoordinateSummary.candidateContextReferenceCount || 0);
  out.dataset.roomEntityFrameCoverageSlotCoordinateRoomEntityInitializerLabel = slotCoordinateSummary.roomEntityInitializerLabel || '';
  out.dataset.roomEntityFrameCoverageSlotCoordinateOamPositionProducerLabel = slotCoordinateSummary.oamPositionProducerLabel || '';
  out.dataset.roomEntityFrameCoverageSlotCoordinateOamFrameStreamConsumerLabel = slotCoordinateSummary.oamFrameStreamConsumerLabel || '';
  out.dataset.roomEntityFrameCoverageSlotCoordinateXSlotFields = slotCoordinateSummary.xSlotFields || '';
  out.dataset.roomEntityFrameCoverageSlotCoordinateYSlotFields = slotCoordinateSummary.ySlotFields || '';
  out.dataset.roomEntityFrameCoverageSlotCoordinateXRoomRecordSourceFields = slotCoordinateSummary.xRoomRecordSourceFields || '';
  out.dataset.roomEntityFrameCoverageSlotCoordinateYRoomRecordSourceFields = slotCoordinateSummary.yRoomRecordSourceFields || '';
  out.dataset.roomEntityFrameCoverageSlotCoordinateXBaseOutputRam = slotCoordinateSummary.xBaseOutputRam || '';
  out.dataset.roomEntityFrameCoverageSlotCoordinateYBaseOutputRam = slotCoordinateSummary.yBaseOutputRam || '';
  out.dataset.roomEntityFrameCoverageSlotCoordinateRuntimePositionCoordinateModelStatus = slotCoordinateSummary.runtimePositionCoordinateModelStatus || '';
  out.dataset.roomEntityFrameCoverageSlotCoordinatePersistedCoordinateCount = String(slotCoordinateSummary.persistedCoordinateCount || 0);
  out.dataset.roomEntityFrameCoveragePositionIntegratorCatalogBacked = positionIntegratorCatalog ? '1' : '0';
  out.dataset.roomEntityFrameCoveragePositionIntegratorCatalogId = positionIntegratorCatalog?.id || '';
  out.dataset.roomEntityFrameCoveragePositionIntegratorRoutineCount = String(positionIntegratorSummary.integratorRoutineCount || 0);
  out.dataset.roomEntityFrameCoveragePositionIntegratorBothAxesRoutine = positionIntegratorSummary.bothAxesRoutine || '';
  out.dataset.roomEntityFrameCoveragePositionIntegratorXOnlyRoutine = positionIntegratorSummary.xOnlyRoutine || '';
  out.dataset.roomEntityFrameCoveragePositionIntegratorYOnlyRoutine = positionIntegratorSummary.yOnlyRoutine || '';
  out.dataset.roomEntityFrameCoveragePositionIntegratorBothAxisExternalCallCount = String(positionIntegratorSummary.bothAxisExternalCallCount || 0);
  out.dataset.roomEntityFrameCoveragePositionIntegratorXOnlyExternalCallCount = String(positionIntegratorSummary.xOnlyExternalCallCount || 0);
  out.dataset.roomEntityFrameCoveragePositionIntegratorYOnlyExternalCallCount = String(positionIntegratorSummary.yOnlyExternalCallCount || 0);
  out.dataset.roomEntityFrameCoveragePositionIntegratorYOnlyInternalCallCount = String(positionIntegratorSummary.yOnlyInternalCallCount || 0);
  out.dataset.roomEntityFrameCoveragePositionIntegratorTotalExternalCallCount = String(positionIntegratorSummary.totalExternalCallCount || 0);
  out.dataset.roomEntityFrameCoveragePositionIntegratorUniqueExternalCallerCount = String(positionIntegratorSummary.uniqueExternalCallerCount || 0);
  out.dataset.roomEntityFrameCoveragePositionIntegratorXVelocityFields = positionIntegratorSummary.xVelocityFields || '';
  out.dataset.roomEntityFrameCoveragePositionIntegratorYVelocityFields = positionIntegratorSummary.yVelocityFields || '';
  out.dataset.roomEntityFrameCoveragePositionIntegratorXVisibleCoordinateFields = positionIntegratorSummary.xVisibleCoordinateFields || '';
  out.dataset.roomEntityFrameCoveragePositionIntegratorYVisibleCoordinateFields = positionIntegratorSummary.yVisibleCoordinateFields || '';
  out.dataset.roomEntityFrameCoveragePositionIntegratorPersistedGameplayValueCount = String(positionIntegratorSummary.persistedGameplayValueCount || 0);
  out.dataset.roomEntityFrameCoverageVelocityFieldCatalogBacked = velocityFieldCatalog ? '1' : '0';
  out.dataset.roomEntityFrameCoverageVelocityFieldCatalogId = velocityFieldCatalog?.id || '';
  out.dataset.roomEntityFrameCoverageVelocityFieldFieldCount = String(velocityFieldSummary.fieldCount || 0);
  out.dataset.roomEntityFrameCoverageVelocityFieldReferenceCount = String(velocityFieldSummary.referenceCount || 0);
  out.dataset.roomEntityFrameCoverageVelocityFieldReadReferenceCount = String(velocityFieldSummary.readReferenceCount || 0);
  out.dataset.roomEntityFrameCoverageVelocityFieldWriteReferenceCount = String(velocityFieldSummary.writeReferenceCount || 0);
  out.dataset.roomEntityFrameCoverageVelocityFieldReadWriteReferenceCount = String(velocityFieldSummary.readWriteReferenceCount || 0);
  out.dataset.roomEntityFrameCoverageVelocityFieldUnknownReferenceCount = String(velocityFieldSummary.unknownReferenceCount || 0);
  out.dataset.roomEntityFrameCoverageVelocityFieldWriterReferenceCount = String(velocityFieldSummary.writerReferenceCount || 0);
  out.dataset.roomEntityFrameCoverageVelocityFieldReaderReferenceCount = String(velocityFieldSummary.readerReferenceCount || 0);
  out.dataset.roomEntityFrameCoverageVelocityFieldRoutineReferenceCount = String(velocityFieldSummary.routineReferenceCount || 0);
  out.dataset.roomEntityFrameCoverageVelocityFieldWriterRoutineCount = String(velocityFieldSummary.writerRoutineCount || 0);
  out.dataset.roomEntityFrameCoverageVelocityFieldReaderRoutineCount = String(velocityFieldSummary.readerRoutineCount || 0);
  out.dataset.roomEntityFrameCoverageVelocityFieldConfirmedContextReferenceCount = String(velocityFieldSummary.confirmedContextReferenceCount || 0);
  out.dataset.roomEntityFrameCoverageVelocityFieldCandidateContextReferenceCount = String(velocityFieldSummary.candidateContextReferenceCount || 0);
  out.dataset.roomEntityFrameCoverageVelocityFieldXVelocityFields = velocityFieldSummary.xVelocityFields || '';
  out.dataset.roomEntityFrameCoverageVelocityFieldYVelocityFields = velocityFieldSummary.yVelocityFields || '';
  out.dataset.roomEntityFrameCoverageVelocityFieldXIntegratorConsumer = velocityFieldSummary.xIntegratorConsumer || '';
  out.dataset.roomEntityFrameCoverageVelocityFieldYIntegratorConsumer = velocityFieldSummary.yIntegratorConsumer || '';
  out.dataset.roomEntityFrameCoverageVelocityFieldXVelocitySignedDeltaHelper = velocityFieldSummary.xVelocitySignedDeltaHelper || '';
  out.dataset.roomEntityFrameCoverageVelocityFieldYVelocitySignedDeltaHelper = velocityFieldSummary.yVelocitySignedDeltaHelper || '';
  out.dataset.roomEntityFrameCoverageVelocityFieldXContactResponseHelper = velocityFieldSummary.xContactResponseHelper || '';
  out.dataset.roomEntityFrameCoverageVelocityFieldYContactResponseHelpers = velocityFieldSummary.yContactResponseHelpers || '';
  out.dataset.roomEntityFrameCoverageVelocityFieldTableDrivenInitializer = velocityFieldSummary.tableDrivenInitializer || '';
  out.dataset.roomEntityFrameCoverageVelocityFieldPersistedGameplayValueCount = String(velocityFieldSummary.persistedGameplayValueCount || 0);
  out.dataset.roomEntityFrameCoverageMotionDeltaCatalogBacked = motionDeltaCatalog ? '1' : '0';
  out.dataset.roomEntityFrameCoverageMotionDeltaCatalogId = motionDeltaCatalog?.id || '';
  out.dataset.roomEntityFrameCoverageMotionDeltaFieldCount = String(motionDeltaSummary.fieldCount || 0);
  out.dataset.roomEntityFrameCoverageMotionDeltaReferenceCount = String(motionDeltaSummary.referenceCount || 0);
  out.dataset.roomEntityFrameCoverageMotionDeltaReadReferenceCount = String(motionDeltaSummary.readReferenceCount || 0);
  out.dataset.roomEntityFrameCoverageMotionDeltaWriteReferenceCount = String(motionDeltaSummary.writeReferenceCount || 0);
  out.dataset.roomEntityFrameCoverageMotionDeltaReadWriteReferenceCount = String(motionDeltaSummary.readWriteReferenceCount || 0);
  out.dataset.roomEntityFrameCoverageMotionDeltaUnknownReferenceCount = String(motionDeltaSummary.unknownReferenceCount || 0);
  out.dataset.roomEntityFrameCoverageMotionDeltaWriterReferenceCount = String(motionDeltaSummary.writerReferenceCount || 0);
  out.dataset.roomEntityFrameCoverageMotionDeltaReaderReferenceCount = String(motionDeltaSummary.readerReferenceCount || 0);
  out.dataset.roomEntityFrameCoverageMotionDeltaRoutineReferenceCount = String(motionDeltaSummary.routineReferenceCount || 0);
  out.dataset.roomEntityFrameCoverageMotionDeltaWriterRoutineCount = String(motionDeltaSummary.writerRoutineCount || 0);
  out.dataset.roomEntityFrameCoverageMotionDeltaReaderRoutineCount = String(motionDeltaSummary.readerRoutineCount || 0);
  out.dataset.roomEntityFrameCoverageMotionDeltaConfirmedContextReferenceCount = String(motionDeltaSummary.confirmedContextReferenceCount || 0);
  out.dataset.roomEntityFrameCoverageMotionDeltaCandidateContextReferenceCount = String(motionDeltaSummary.candidateContextReferenceCount || 0);
  out.dataset.roomEntityFrameCoverageMotionDeltaXDeltaField = motionDeltaSummary.xDeltaField || '';
  out.dataset.roomEntityFrameCoverageMotionDeltaYDeltaField = motionDeltaSummary.yDeltaField || '';
  out.dataset.roomEntityFrameCoverageMotionDeltaXVelocityDeltaConsumer = motionDeltaSummary.xVelocityDeltaConsumer || '';
  out.dataset.roomEntityFrameCoverageMotionDeltaYVelocityDeltaConsumer = motionDeltaSummary.yVelocityDeltaConsumer || '';
  out.dataset.roomEntityFrameCoverageMotionDeltaCombinedVelocityDeltaEntry = motionDeltaSummary.combinedVelocityDeltaEntry || '';
  out.dataset.roomEntityFrameCoverageMotionDeltaXGlobalAccumulatorInput = motionDeltaSummary.xGlobalAccumulatorInput || '';
  out.dataset.roomEntityFrameCoverageMotionDeltaYGlobalAccumulatorInput = motionDeltaSummary.yGlobalAccumulatorInput || '';
  out.dataset.roomEntityFrameCoverageMotionDeltaC600MotionControllerGateRoutines = motionDeltaSummary.c600MotionControllerGateRoutines || '';
  out.dataset.roomEntityFrameCoverageMotionDeltaCollisionReactionWriters = motionDeltaSummary.collisionReactionWriters || '';
  out.dataset.roomEntityFrameCoverageMotionDeltaTableDrivenInitializer = motionDeltaSummary.tableDrivenInitializer || '';
  out.dataset.roomEntityFrameCoverageMotionDeltaPersistedGameplayValueCount = String(motionDeltaSummary.persistedGameplayValueCount || 0);
  out.dataset.roomEntityFrameCoverageMotionDeltaBehaviorCatalogBacked = motionDeltaBehaviorCatalog ? '1' : '0';
  out.dataset.roomEntityFrameCoverageMotionDeltaBehaviorCatalogId = motionDeltaBehaviorCatalog?.id || '';
  out.dataset.roomEntityFrameCoverageMotionDeltaBehaviorWriterRoutineCount = String(motionDeltaBehaviorSummary.writerRoutineCount || 0);
  out.dataset.roomEntityFrameCoverageMotionDeltaBehaviorLinkedWriterRoutineCount = String(motionDeltaBehaviorSummary.linkedWriterRoutineCount || 0);
  out.dataset.roomEntityFrameCoverageMotionDeltaBehaviorBehaviorTableLinkedWriterRoutineCount = String(motionDeltaBehaviorSummary.behaviorTableLinkedWriterRoutineCount || 0);
  out.dataset.roomEntityFrameCoverageMotionDeltaBehaviorC3c0InitializerWriterRoutineCount = String(motionDeltaBehaviorSummary.c3c0InitializerWriterRoutineCount || 0);
  out.dataset.roomEntityFrameCoverageMotionDeltaBehaviorAuxiliaryActorWriterRoutineCount = String(motionDeltaBehaviorSummary.auxiliaryActorWriterRoutineCount || 0);
  out.dataset.roomEntityFrameCoverageMotionDeltaBehaviorC640PairSlotWriterRoutineCount = String(motionDeltaBehaviorSummary.c640PairSlotWriterRoutineCount || 0);
  out.dataset.roomEntityFrameCoverageMotionDeltaBehaviorC740SlotWriterRoutineCount = String(motionDeltaBehaviorSummary.c740SlotWriterRoutineCount || 0);
  out.dataset.roomEntityFrameCoverageMotionDeltaBehaviorC600RecordInitializerWriterRoutineCount = String(motionDeltaBehaviorSummary.c600RecordInitializerWriterRoutineCount || 0);
  out.dataset.roomEntityFrameCoverageMotionDeltaBehaviorC600CollisionResponseWriterRoutineCount = String(motionDeltaBehaviorSummary.c600CollisionResponseWriterRoutineCount || 0);
  out.dataset.roomEntityFrameCoverageMotionDeltaBehaviorBank2SceneWriterRoutineCount = String(motionDeltaBehaviorSummary.bank2SceneWriterRoutineCount || 0);
  out.dataset.roomEntityFrameCoverageMotionDeltaBehaviorBank2TransitionWriterRoutineCount = String(motionDeltaBehaviorSummary.bank2TransitionWriterRoutineCount || 0);
  out.dataset.roomEntityFrameCoverageMotionDeltaBehaviorGameplayLookupWriterRoutineCount = String(motionDeltaBehaviorSummary.gameplayLookupWriterRoutineCount || 0);
  out.dataset.roomEntityFrameCoverageMotionDeltaBehaviorUnresolvedWriterRoutineCount = String(motionDeltaBehaviorSummary.unresolvedWriterRoutineCount || 0);
  out.dataset.roomEntityFrameCoverageMotionDeltaBehaviorDirectOrScheduledDeltaConsumerLinkedWriterRoutineCount = String(motionDeltaBehaviorSummary.directOrScheduledDeltaConsumerLinkedWriterRoutineCount || 0);
  out.dataset.roomEntityFrameCoverageMotionDeltaBehaviorMotionSeedOnlyWriterRoutineCount = String(motionDeltaBehaviorSummary.motionSeedOnlyWriterRoutineCount || 0);
  out.dataset.roomEntityFrameCoverageMotionDeltaBehaviorWriterReferenceCount = String(motionDeltaBehaviorSummary.writerReferenceCount || 0);
  out.dataset.roomEntityFrameCoverageMotionDeltaBehaviorReaderReferenceCountInWriterRoutines = String(motionDeltaBehaviorSummary.readerReferenceCountInWriterRoutines || 0);
  out.dataset.roomEntityFrameCoverageMotionDeltaBehaviorPersistedGameplayValueCount = String(motionDeltaBehaviorSummary.persistedGameplayValueCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0MotionSeedCatalogBacked = c3c0MotionSeedCatalog ? '1' : '0';
  out.dataset.roomEntityFrameCoverageC3c0MotionSeedCatalogId = c3c0MotionSeedCatalog?.id || '';
  out.dataset.roomEntityFrameCoverageC3c0MotionSeedSeedRoutineCount = String(c3c0MotionSeedSummary.seedRoutineCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0MotionSeedBehaviorListResolvedSeedRoutineCount = String(c3c0MotionSeedSummary.behaviorListResolvedSeedRoutineCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0MotionSeedDirectInitializerBehaviorListSeedRoutineCount = String(c3c0MotionSeedSummary.directInitializerBehaviorListSeedRoutineCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0MotionSeedCallerProvidedBehaviorListSeedRoutineCount = String(c3c0MotionSeedSummary.callerProvidedBehaviorListSeedRoutineCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0MotionSeedUnresolvedBehaviorListSeedRoutineCount = String(c3c0MotionSeedSummary.unresolvedBehaviorListSeedRoutineCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0MotionSeedBehaviorListSourceCount = String(c3c0MotionSeedSummary.behaviorListSourceCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0MotionSeedUniqueBehaviorListExpressionCount = String(c3c0MotionSeedSummary.uniqueBehaviorListExpressionCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0MotionSeedPointerAdjustmentExpressionCount = String(c3c0MotionSeedSummary.pointerAdjustmentExpressionCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0MotionSeedTotalTableEntryReferences = String(c3c0MotionSeedSummary.totalTableEntryReferences || 0);
  out.dataset.roomEntityFrameCoverageC3c0MotionSeedTotalWriterReferenceCount = String(c3c0MotionSeedSummary.totalWriterReferenceCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0MotionSeedPersistedGameplayValueCount = String(c3c0MotionSeedSummary.persistedGameplayValueCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0MotionSeedTargetCatalogBacked = c3c0MotionSeedTargetCatalog ? '1' : '0';
  out.dataset.roomEntityFrameCoverageC3c0MotionSeedTargetCatalogId = c3c0MotionSeedTargetCatalog?.id || '';
  out.dataset.roomEntityFrameCoverageC3c0MotionSeedTargetSeedRoutineCount = String(c3c0MotionSeedTargetSummary.seedRoutineCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0MotionSeedTargetBehaviorListSourceCount = String(c3c0MotionSeedTargetSummary.behaviorListSourceCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0MotionSeedTargetLinkedBehaviorListSourceCount = String(c3c0MotionSeedTargetSummary.linkedBehaviorListSourceCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0MotionSeedTargetMissingBehaviorListSourceCount = String(c3c0MotionSeedTargetSummary.missingBehaviorListSourceCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0MotionSeedTargetTargetEntryCount = String(c3c0MotionSeedTargetSummary.targetEntryCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0MotionSeedTargetUniqueTargetRegionCount = String(c3c0MotionSeedTargetSummary.uniqueTargetRegionCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0MotionSeedTargetSeedRoutinesWithMultipleBehaviorLists = String(c3c0MotionSeedTargetSummary.seedRoutinesWithMultipleBehaviorLists || 0);
  out.dataset.roomEntityFrameCoverageC3c0MotionSeedTargetSeedRoutinesWithMissingBehaviorLists = String(c3c0MotionSeedTargetSummary.seedRoutinesWithMissingBehaviorLists || 0);
  out.dataset.roomEntityFrameCoverageC3c0MotionSeedTargetSeedRoutinesWithTargetLinks = String(c3c0MotionSeedTargetSummary.seedRoutinesWithTargetLinks || 0);
  out.dataset.roomEntityFrameCoverageC3c0MotionSeedTargetMaxTargetEntriesPerSeed = String(c3c0MotionSeedTargetSummary.maxTargetEntriesPerSeed || 0);
  out.dataset.roomEntityFrameCoverageC3c0MotionSeedTargetTotalTableEntryReferences = String(c3c0MotionSeedTargetSummary.totalTableEntryReferences || 0);
  out.dataset.roomEntityFrameCoverageC3c0MotionSeedTargetPersistedGameplayValueCount = String(c3c0MotionSeedTargetSummary.persistedGameplayValueCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0BehaviorTargetSemanticsCatalogBacked = c3c0BehaviorTargetSemanticsCatalog ? '1' : '0';
  out.dataset.roomEntityFrameCoverageC3c0BehaviorTargetSemanticsCatalogId = c3c0BehaviorTargetSemanticsCatalog?.id || '';
  out.dataset.roomEntityFrameCoverageC3c0BehaviorTargetSemanticsSourceTargetEntryCount = String(c3c0BehaviorTargetSemanticsSummary.sourceTargetEntryCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0BehaviorTargetSemanticsUniqueTargetOffsetCount = String(c3c0BehaviorTargetSemanticsSummary.uniqueTargetOffsetCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0BehaviorTargetSemanticsTargetRegionCount = String(c3c0BehaviorTargetSemanticsSummary.targetRegionCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0BehaviorTargetSemanticsTargetsWithKnownHelperCalls = String(c3c0BehaviorTargetSemanticsSummary.targetsWithKnownHelperCalls || 0);
  out.dataset.roomEntityFrameCoverageC3c0BehaviorTargetSemanticsTargetsWithPackedMotionDeltaConsumer = String(c3c0BehaviorTargetSemanticsSummary.targetsWithPackedMotionDeltaConsumer || 0);
  out.dataset.roomEntityFrameCoverageC3c0BehaviorTargetSemanticsTargetsWithVelocityIntegrator = String(c3c0BehaviorTargetSemanticsSummary.targetsWithVelocityIntegrator || 0);
  out.dataset.roomEntityFrameCoverageC3c0BehaviorTargetSemanticsTargetsWithCollisionPipeline = String(c3c0BehaviorTargetSemanticsSummary.targetsWithCollisionPipeline || 0);
  out.dataset.roomEntityFrameCoverageC3c0BehaviorTargetSemanticsTargetsWithAnimationTick = String(c3c0BehaviorTargetSemanticsSummary.targetsWithAnimationTick || 0);
  out.dataset.roomEntityFrameCoverageC3c0BehaviorTargetSemanticsTargetsWithBehaviorStateWrite = String(c3c0BehaviorTargetSemanticsSummary.targetsWithBehaviorStateWrite || 0);
  out.dataset.roomEntityFrameCoverageC3c0BehaviorTargetSemanticsHelperCallCount = String(c3c0BehaviorTargetSemanticsSummary.helperCallCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0BehaviorTargetSemanticsWarningTargetCount = String(c3c0BehaviorTargetSemanticsSummary.warningTargetCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0BehaviorTargetSemanticsPersistedRomByteCount = String(c3c0BehaviorTargetSemanticsSummary.persistedRomByteCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0BehaviorTargetSemanticsPersistedGameplayValueCount = String(c3c0BehaviorTargetSemanticsSummary.persistedGameplayValueCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0ActorFamilyCatalogBacked = c3c0ActorFamilyCatalog ? '1' : '0';
  out.dataset.roomEntityFrameCoverageC3c0ActorFamilyCatalogId = c3c0ActorFamilyCatalog?.id || '';
  out.dataset.roomEntityFrameCoverageC3c0ActorFamilyRawEntityTypeCount = String(c3c0ActorFamilySummary.rawEntityTypeCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0ActorFamilySelectorTypeCount = String(c3c0ActorFamilySummary.selectorTypeCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0ActorFamilyDirectSeedEntityTypeCount = String(c3c0ActorFamilySummary.directSeedEntityTypeCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0ActorFamilyTailSeedEntityTypeCount = String(c3c0ActorFamilySummary.tailSeedEntityTypeCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0ActorFamilySeedRoutineCount = String(c3c0ActorFamilySummary.seedRoutineCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0ActorFamilySeedGroupCount = String(c3c0ActorFamilySummary.seedGroupCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0ActorFamilyBehaviorListLinkedEntityTypeCount = String(c3c0ActorFamilySummary.behaviorListLinkedEntityTypeCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0ActorFamilyMissingBehaviorListSourceEntityTypeCount = String(c3c0ActorFamilySummary.missingBehaviorListSourceEntityTypeCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0ActorFamilyTargetLinkedEntityTypeCount = String(c3c0ActorFamilySummary.targetLinkedEntityTypeCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0ActorFamilyTargetEntryReferenceCount = String(c3c0ActorFamilySummary.targetEntryReferenceCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0ActorFamilyUniqueTargetOffsetCount = String(c3c0ActorFamilySummary.uniqueTargetOffsetCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0ActorFamilyActorTypesWithPackedMotionDeltaConsumer = String(c3c0ActorFamilySummary.actorTypesWithPackedMotionDeltaConsumer || 0);
  out.dataset.roomEntityFrameCoverageC3c0ActorFamilyActorTypesWithCollisionPipeline = String(c3c0ActorFamilySummary.actorTypesWithCollisionPipeline || 0);
  out.dataset.roomEntityFrameCoverageC3c0ActorFamilyActorTypesWithAnimationTick = String(c3c0ActorFamilySummary.actorTypesWithAnimationTick || 0);
  out.dataset.roomEntityFrameCoverageC3c0ActorFamilyFrameLinkedEntityTypeCount = String(c3c0ActorFamilySummary.frameLinkedEntityTypeCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0ActorFamilyDynamicUploadedEntityTypeCount = String(c3c0ActorFamilySummary.dynamicUploadedEntityTypeCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0ActorFamilyFullyCoveredEntityTypeCount = String(c3c0ActorFamilySummary.fullyCoveredEntityTypeCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0ActorFamilyPartialCoverageEntityTypeCount = String(c3c0ActorFamilySummary.partialCoverageEntityTypeCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0ActorFamilyWarningActorTypeCount = String(c3c0ActorFamilySummary.warningActorTypeCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0ActorFamilyPersistedRomByteCount = String(c3c0ActorFamilySummary.persistedRomByteCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0ActorFamilyPersistedCoordinateCount = String(c3c0ActorFamilySummary.persistedCoordinateCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0ActorFamilyPersistedPixelCount = String(c3c0ActorFamilySummary.persistedPixelCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0ActorFamilyPersistedGameplayValueCount = String(c3c0ActorFamilySummary.persistedGameplayValueCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0RenderabilityCatalogBacked = c3c0RenderabilityCatalog ? '1' : '0';
  out.dataset.roomEntityFrameCoverageC3c0RenderabilityCatalogId = c3c0RenderabilityCatalog?.id || '';
  out.dataset.roomEntityFrameCoverageC3c0RenderabilityActorTypeCount = String(c3c0RenderabilitySummary.actorTypeCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0RenderabilityFrameLinkedActorTypeCount = String(c3c0RenderabilitySummary.frameLinkedActorTypeCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0RenderabilityDynamicUploadedActorTypeCount = String(c3c0RenderabilitySummary.dynamicUploadedActorTypeCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0RenderabilityFullyRenderableActorTypeCount = String(c3c0RenderabilitySummary.fullyRenderableActorTypeCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0RenderabilityPartiallyRenderableActorTypeCount = String(c3c0RenderabilitySummary.partiallyRenderableActorTypeCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0RenderabilityBlockedPendingTileBaseTraceActorTypeCount = String(c3c0RenderabilitySummary.blockedPendingTileBaseTraceActorTypeCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0RenderabilityNoHighConfidenceFrameAssetActorTypeCount = String(c3c0RenderabilitySummary.noHighConfidenceFrameAssetActorTypeCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0RenderabilityFrameLinkedWithoutObservedDynamicUploadActorTypeCount = String(c3c0RenderabilitySummary.frameLinkedWithoutObservedDynamicUploadActorTypeCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0RenderabilityRenderableFixtureActorTypeCount = String(c3c0RenderabilitySummary.renderableFixtureActorTypeCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0RenderabilityRenderableFixtureCount = String(c3c0RenderabilitySummary.renderableFixtureCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0RenderabilityDynamicUploadBackedFixtureCount = String(c3c0RenderabilitySummary.dynamicUploadBackedFixtureCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0RenderabilitySeedGroupCount = String(c3c0RenderabilitySummary.seedGroupCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0RenderabilityPartialTraceEntityTypes = (c3c0RenderabilitySummary.c3c0PartialTraceEntityTypes || []).join(',');
  out.dataset.roomEntityFrameCoverageC3c0RenderabilityBlockedTraceEntityTypes = (c3c0RenderabilitySummary.c3c0BlockedTraceEntityTypes || []).join(',');
  out.dataset.roomEntityFrameCoverageC3c0RenderabilityBestFrameStepCandidate = c3c0RenderabilitySummary.bestFrameStepCandidate || '';
  out.dataset.roomEntityFrameCoverageC3c0RenderabilityBestFrameStepCandidateSeed = c3c0RenderabilitySummary.bestFrameStepCandidateSeed || '';
  out.dataset.roomEntityFrameCoverageC3c0RenderabilityBestFrameStepCandidateScore = String(c3c0RenderabilitySummary.bestFrameStepCandidateScore || 0);
  out.dataset.roomEntityFrameCoverageC3c0RenderabilityOamTileBaseField = c3c0RenderabilitySummary.oamTileBaseField || '';
  out.dataset.roomEntityFrameCoverageC3c0RenderabilityOamFrameStreamRoutine = c3c0RenderabilitySummary.oamFrameStreamRoutine || '';
  out.dataset.roomEntityFrameCoverageC3c0RenderabilityOamPositionProducerRoutine = c3c0RenderabilitySummary.oamPositionProducerRoutine || '';
  out.dataset.roomEntityFrameCoverageC3c0RenderabilityPersistedRomByteCount = String(c3c0RenderabilitySummary.persistedRomByteCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0RenderabilityPersistedTileByteCount = String(c3c0RenderabilitySummary.persistedTileByteCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0RenderabilityPersistedPixelCount = String(c3c0RenderabilitySummary.persistedPixelCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0RenderabilityPersistedCoordinateCount = String(c3c0RenderabilitySummary.persistedCoordinateCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0RenderabilityPersistedGameplayValueCount = String(c3c0RenderabilitySummary.persistedGameplayValueCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticCatalogBacked = c3c0FrameStepDiagnosticCatalog ? '1' : '0';
  out.dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticCatalogId = c3c0FrameStepDiagnosticCatalog?.id || '';
  out.dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticCandidateEntityType = c3c0FrameStepDiagnosticSummary.candidateEntityType || '';
  out.dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticCandidateSeedLabel = c3c0FrameStepDiagnosticSummary.candidateSeedLabel || '';
  out.dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticBehaviorListSource = c3c0FrameStepDiagnosticSummary.behaviorListSource || '';
  out.dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticBehaviorStateCount = String(c3c0FrameStepDiagnosticSummary.behaviorStateCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticTargetRegionCount = String(c3c0FrameStepDiagnosticSummary.targetRegionCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticCallPlanEntryCount = String(c3c0FrameStepDiagnosticSummary.callPlanEntryCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticUnresolvedCallPlanCount = String(c3c0FrameStepDiagnosticSummary.unresolvedCallPlanCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticHelperTargetCount = String(c3c0FrameStepDiagnosticSummary.helperTargetCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticHelperRoleResolvedTargetCount = String(c3c0FrameStepDiagnosticSummary.helperRoleResolvedTargetCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticExactSemanticsPendingHelperTargetCount = String(c3c0FrameStepDiagnosticSummary.exactSemanticsPendingHelperTargetCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticInternalHelperEntryRoleKnownTargetCount = String(c3c0FrameStepDiagnosticSummary.internalHelperEntryRoleKnownTargetCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticLocalBehaviorSubroutineRoleKnownTargetCount = String(c3c0FrameStepDiagnosticSummary.localBehaviorSubroutineRoleKnownTargetCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticRegionEntryRoleKnownTargetCount = String(c3c0FrameStepDiagnosticSummary.regionEntryRoleKnownTargetCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticBehaviorStatesWithAnimationTick = String(c3c0FrameStepDiagnosticSummary.behaviorStatesWithAnimationTick || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticBehaviorStatesWithCollisionPipeline = String(c3c0FrameStepDiagnosticSummary.behaviorStatesWithCollisionPipeline || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticBehaviorStatesWithPackedMotionDeltaConsumer = String(c3c0FrameStepDiagnosticSummary.behaviorStatesWithPackedMotionDeltaConsumer || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticBehaviorStatesWithBehaviorStateWrite = String(c3c0FrameStepDiagnosticSummary.behaviorStatesWithBehaviorStateWrite || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticBehaviorStatesWithTimerCounterWrite = String(c3c0FrameStepDiagnosticSummary.behaviorStatesWithTimerCounterWrite || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticFieldTokenCount = String(c3c0FrameStepDiagnosticSummary.fieldTokenCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticBranchPredicatePendingStateCount = String(c3c0FrameStepDiagnosticSummary.branchPredicatePendingStateCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticFrameExactStateCount = String(c3c0FrameStepDiagnosticSummary.frameExactStateCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticDiagnosticStatus = c3c0FrameStepDiagnosticSummary.diagnosticStatus || '';
  out.dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticPersistedRomByteCount = String(c3c0FrameStepDiagnosticSummary.persistedRomByteCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticPersistedInstructionByteCount = String(c3c0FrameStepDiagnosticSummary.persistedInstructionByteCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticPersistedTileByteCount = String(c3c0FrameStepDiagnosticSummary.persistedTileByteCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticPersistedPixelCount = String(c3c0FrameStepDiagnosticSummary.persistedPixelCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticPersistedCoordinateCount = String(c3c0FrameStepDiagnosticSummary.persistedCoordinateCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepDiagnosticPersistedGameplayValueCount = String(c3c0FrameStepDiagnosticSummary.persistedGameplayValueCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowCatalogBacked = c3c0FrameStepControlFlowCatalog ? '1' : '0';
  out.dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowCatalogId = c3c0FrameStepControlFlowCatalog?.id || '';
  out.dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowCandidateEntityType = c3c0FrameStepControlFlowSummary.candidateEntityType || '';
  out.dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowCandidateSeedLabel = c3c0FrameStepControlFlowSummary.candidateSeedLabel || '';
  out.dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowBehaviorListSource = c3c0FrameStepControlFlowSummary.behaviorListSource || '';
  out.dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowBehaviorStateCount = String(c3c0FrameStepControlFlowSummary.behaviorStateCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowRelativeBranchCount = String(c3c0FrameStepControlFlowSummary.relativeBranchCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowConditionalBranchCount = String(c3c0FrameStepControlFlowSummary.conditionalBranchCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowConditionalExitCount = String(c3c0FrameStepControlFlowSummary.conditionalExitCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowConditionalControlCount = String(c3c0FrameStepControlFlowSummary.conditionalControlCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowSymbolicPredicateCount = String(c3c0FrameStepControlFlowSummary.symbolicPredicateCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowUnclassifiedConditionalControlCount = String(c3c0FrameStepControlFlowSummary.unclassifiedConditionalControlCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowSymbolicPredicateStateCount = String(c3c0FrameStepControlFlowSummary.symbolicPredicateStateCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowFirstTickGuardStateCount = String(c3c0FrameStepControlFlowSummary.firstTickGuardStateCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowBehaviorStateOperationStateCount = String(c3c0FrameStepControlFlowSummary.behaviorStateOperationStateCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowBehaviorStateWriteStateCount = String(c3c0FrameStepControlFlowSummary.behaviorStateWriteStateCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowTimerOperationStateCount = String(c3c0FrameStepControlFlowSummary.timerOperationStateCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowCountdownOperationStateCount = String(c3c0FrameStepControlFlowSummary.countdownOperationStateCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowTimerOperationCount = String(c3c0FrameStepControlFlowSummary.timerOperationCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowCountdownOperationCount = String(c3c0FrameStepControlFlowSummary.countdownOperationCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowFieldTokenCount = String(c3c0FrameStepControlFlowSummary.fieldTokenCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowFrameExactStateCount = String(c3c0FrameStepControlFlowSummary.frameExactStateCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowDiagnosticStatus = c3c0FrameStepControlFlowSummary.diagnosticStatus || '';
  out.dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowPersistedRomByteCount = String(c3c0FrameStepControlFlowSummary.persistedRomByteCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowPersistedInstructionByteCount = String(c3c0FrameStepControlFlowSummary.persistedInstructionByteCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowPersistedTileByteCount = String(c3c0FrameStepControlFlowSummary.persistedTileByteCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowPersistedPixelCount = String(c3c0FrameStepControlFlowSummary.persistedPixelCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowPersistedCoordinateCount = String(c3c0FrameStepControlFlowSummary.persistedCoordinateCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepControlFlowPersistedGameplayValueCount = String(c3c0FrameStepControlFlowSummary.persistedGameplayValueCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepTraceCatalogBacked = c3c0FrameStepTraceCatalog ? '1' : '0';
  out.dataset.roomEntityFrameCoverageC3c0FrameStepTraceCatalogId = c3c0FrameStepTraceCatalog?.id || '';
  out.dataset.roomEntityFrameCoverageC3c0FrameStepTraceCandidateEntityType = c3c0FrameStepTraceSummary.candidateEntityType || '';
  out.dataset.roomEntityFrameCoverageC3c0FrameStepTraceCandidateSeedLabel = c3c0FrameStepTraceSummary.candidateSeedLabel || '';
  out.dataset.roomEntityFrameCoverageC3c0FrameStepTraceBehaviorListSource = c3c0FrameStepTraceSummary.behaviorListSource || '';
  out.dataset.roomEntityFrameCoverageC3c0FrameStepTraceBehaviorStateCount = String(c3c0FrameStepTraceSummary.behaviorStateCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepTraceTraceStepCount = String(c3c0FrameStepTraceSummary.traceStepCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepTraceFieldTouchCount = String(c3c0FrameStepTraceSummary.fieldTouchCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepTraceHelperStubCount = String(c3c0FrameStepTraceSummary.helperStubCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepTraceHelperRoleKnownCount = String(c3c0FrameStepTraceSummary.helperRoleKnownCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepTraceConditionalControlCount = String(c3c0FrameStepTraceSummary.conditionalControlCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepTraceSymbolicPredicateCount = String(c3c0FrameStepTraceSummary.symbolicPredicateCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepTraceUnresolvedPredicateCount = String(c3c0FrameStepTraceSummary.unresolvedPredicateCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepTraceFirstTickGuardCount = String(c3c0FrameStepTraceSummary.firstTickGuardCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepTraceBehaviorStateFieldTouchCount = String(c3c0FrameStepTraceSummary.behaviorStateFieldTouchCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepTraceTimerFieldTouchCount = String(c3c0FrameStepTraceSummary.timerFieldTouchCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepTraceLiteralWithheldFieldTouchCount = String(c3c0FrameStepTraceSummary.literalWithheldFieldTouchCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepTraceStatesWithHelperStubs = String(c3c0FrameStepTraceSummary.statesWithHelperStubs || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepTraceStatesWithFieldTouches = String(c3c0FrameStepTraceSummary.statesWithFieldTouches || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepTraceStatesWithConditionalControls = String(c3c0FrameStepTraceSummary.statesWithConditionalControls || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepTraceStatesWithAllSymbolicPredicates = String(c3c0FrameStepTraceSummary.statesWithAllSymbolicPredicates || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepTraceFieldTokenCount = String(c3c0FrameStepTraceSummary.fieldTokenCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepTraceHelperRoleCount = String(c3c0FrameStepTraceSummary.helperRoleCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepTracePredicateKindCount = String(c3c0FrameStepTraceSummary.predicateKindCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepTraceFrameExactStateCount = String(c3c0FrameStepTraceSummary.frameExactStateCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepTraceReadinessStatus = c3c0FrameStepTraceSummary.traceReadinessStatus || '';
  out.dataset.roomEntityFrameCoverageC3c0FrameStepTracePersistedRomByteCount = String(c3c0FrameStepTraceSummary.persistedRomByteCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepTracePersistedInstructionByteCount = String(c3c0FrameStepTraceSummary.persistedInstructionByteCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepTracePersistedTileByteCount = String(c3c0FrameStepTraceSummary.persistedTileByteCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepTracePersistedPixelCount = String(c3c0FrameStepTraceSummary.persistedPixelCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepTracePersistedCoordinateCount = String(c3c0FrameStepTraceSummary.persistedCoordinateCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepTracePersistedGameplayValueCount = String(c3c0FrameStepTraceSummary.persistedGameplayValueCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepStepperPreviewBacked = c3c0FrameStepStepperPreview.catalogBacked ? '1' : '0';
  out.dataset.roomEntityFrameCoverageC3c0FrameStepStepperCatalogId = c3c0FrameStepStepperPreview.catalogId || '';
  out.dataset.roomEntityFrameCoverageC3c0FrameStepStepperCandidateEntityType = c3c0FrameStepStepperPreview.candidateEntityType || '';
  out.dataset.roomEntityFrameCoverageC3c0FrameStepStepperCandidateSeedLabel = c3c0FrameStepStepperPreview.candidateSeedLabel || '';
  out.dataset.roomEntityFrameCoverageC3c0FrameStepStepperBehaviorListSource = c3c0FrameStepStepperPreview.behaviorListSource || '';
  out.dataset.roomEntityFrameCoverageC3c0FrameStepStepperStateCount = String(c3c0FrameStepStepperPreview.stateCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepStepperFrameCount = String(c3c0FrameStepStepperPreview.frameCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepStepperTraceStepCount = String(c3c0FrameStepStepperPreview.traceStepCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepStepperFieldTouchEventCount = String(c3c0FrameStepStepperPreview.fieldTouchEventCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepStepperHelperStubEventCount = String(c3c0FrameStepStepperPreview.helperStubEventCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepStepperConditionalEventCount = String(c3c0FrameStepStepperPreview.conditionalEventCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepStepperSymbolicPredicateCount = String(c3c0FrameStepStepperPreview.symbolicPredicateCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepStepperUnresolvedPredicateCount = String(c3c0FrameStepStepperPreview.unresolvedPredicateCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepStepperFirstTickGuardCount = String(c3c0FrameStepStepperPreview.firstTickGuardCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepStepperRuntimeValueReadCount = String(c3c0FrameStepStepperPreview.runtimeValueReadCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepStepperRuntimeValueWriteCount = String(c3c0FrameStepStepperPreview.runtimeValueWriteCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepStepperBranchOutcomeEvaluatedCount = String(c3c0FrameStepStepperPreview.branchOutcomeEvaluatedCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepStepperHelperEffectEvaluatedCount = String(c3c0FrameStepStepperPreview.helperEffectEvaluatedCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepStepperPersistedGameplayValueCount = String(c3c0FrameStepStepperPreview.persistedGameplayValueCount || 0);
  out.dataset.roomEntityFrameCoverageC3c0FrameStepStepperStatus = c3c0FrameStepStepperPreview.status || '';
  out.dataset.roomEntityFrameCoverageC3c0FrameStepStepperAssetPolicy = c3c0FrameStepStepperPreview.assetPolicy || '';
  out.dataset.roomEntityFrameCoverageFixtureRuntimeDecoded = fixtureRuntime.runtimeDecoded ? '1' : '0';
  out.dataset.roomEntityFrameCoverageFixtureRuntimePreviewedFixtureCount = String(fixtureRuntime.previewedFixtureCount || 0);
  out.dataset.roomEntityFrameCoverageFixtureRuntimeRenderedFixtureRowCount = String(fixtureRuntime.renderedFixtureRowCount || 0);
  out.dataset.roomEntityFrameCoverageFixtureRuntimeRenderedTileCount = String(fixtureRuntime.renderedTileCount || 0);
  out.dataset.roomEntityFrameCoverageFixtureRuntimeRenderedPieceCount = String(fixtureRuntime.renderedPieceCount || 0);
  out.dataset.roomEntityFrameCoverageFixtureRuntimeLayoutPreviewedFixtureCount = String(fixtureRuntime.layoutPreviewedFixtureCount || 0);
  out.dataset.roomEntityFrameCoverageFixtureRuntimeCoordinateMode = fixtureRuntime.coordinateMode || '';
  out.dataset.roomEntityFrameCoverageFixtureRuntimeEmptyFixtureCount = String(fixtureRuntime.emptyFixtureCount || 0);
  out.dataset.roomEntityFrameCoverageFixtureRuntimeUnresolvedTileRefCount = String(fixtureRuntime.unresolvedTileRefCount || 0);
  out.dataset.roomEntityFrameCoverageFixtureRuntimeSkippedFixtureCount = String(fixtureRuntime.skippedFixtureCount || 0);
  out.dataset.roomEntityFrameCoverageFixtureRuntimeWarningCount = String(fixtureRuntime.warningCount || 0);
  out.dataset.roomEntityFrameCoverageFixtureRuntimeParseIssueCount = String(fixtureRuntime.parseIssueCount || 0);
  out.dataset.roomEntityFrameCoverageFixtureRuntimePersistedTileByteCount = '0';
  out.dataset.roomEntityFrameCoverageFixtureRuntimePersistedPixelCount = '0';
  out.dataset.roomEntityFrameCoverageFixtureRuntimePersistedCoordinateCount = '0';
  out.dataset.roomEntityFrameCoveragePersistedTileByteCount = '0';
  out.dataset.roomEntityFrameCoveragePersistedPixelCount = '0';
  out.dataset.roomEntityFrameCoveragePersistedCoordinateCount = '0';
  out.dataset.roomEntityFrameCoverageAssetPolicy = assetPolicy;

  if (info) {
    info.textContent = warnings.length
      ? `${warnings.length} warning(s)`
      : `${fixtureSummary.fixtureCount || 0} renderable frame fixture(s) · ${needsTraceEntityTypeCount} entity type(s) need trace`;
  }

  if (warnings.length) {
    out.innerHTML = warnings.map(warning =>
      `<div style="color:#f87171">${simEscapeHtml(warning)}</div>`
    ).join('');
  } else {
    const statusText = Object.entries(summary.statusCounts || {})
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      .map(([key, value]) => `${key}:${value}`)
      .join(' ');
    out.innerHTML = `
      <div style="color:#888;margin-bottom:6px">
        Catalog ${simEscapeHtml(catalog.id)} · ${simEscapeHtml(statusText || 'no statuses')} · ranges/counts only
      </div>
      <div style="color:#86efac;font-weight:bold;margin:6px 0 3px">Runtime fixture OAM-layout preview</div>
      <div id="room-entity-renderable-fixture-canvas-wrap"></div>
      <div style="color:#888;margin-bottom:6px">
        Runtime preview rendered ${fixtureRuntime.renderedPieceCount} piece(s) / ${fixtureRuntime.renderedTileCount} resolved tile reference(s) from ${fixtureRuntime.layoutPreviewedFixtureCount} fixture layout(s); ${fixtureRuntime.emptyFixtureCount} empty frame fixture(s), ${fixtureRuntime.unresolvedTileRefCount} unresolved.
        OAM semantics: ${simEscapeHtml(oamSemanticsSummary.frameStreamRoutine || '?')} ${simEscapeHtml((oamSemanticsSummary.outputBufferRecordOrder || []).join('/') || 'Y/X/tile')}.
        Position bases: ${simEscapeHtml(oamSemanticsSummary.positionProducerRoutine || '?')} writes ${simEscapeHtml(oamSemanticsSummary.xBaseRam || '?')} and ${simEscapeHtml(oamSemanticsSummary.yBaseRam || '?')} from ${simEscapeHtml(oamSemanticsSummary.xBaseSlotFields || '?')}/${simEscapeHtml(oamSemanticsSummary.yBaseSlotFields || '?')} with camera subtract when ${simEscapeHtml(oamSemanticsSummary.cameraSubtractFlag || '?')}; preview mode is normalized until live slot positions are modeled.
        Slot coordinate provenance: ${simEscapeHtml(slotCoordinateCatalog?.id || '?')} tracks ${simEscapeHtml(String(slotCoordinateSummary.referenceCount || 0))} IX+3/4/6/7 reference(s) across ${simEscapeHtml(String(slotCoordinateSummary.routineReferenceCount || 0))} routine(s); confirmed path is ${simEscapeHtml(slotCoordinateSummary.roomEntityInitializerLabel || '?')} to ${simEscapeHtml(slotCoordinateSummary.oamPositionProducerLabel || '?')}, status ${simEscapeHtml(slotCoordinateSummary.runtimePositionCoordinateModelStatus || '?')}.
        Position integrators: ${simEscapeHtml(positionIntegratorSummary.bothAxesRoutine || '?')} runs ${simEscapeHtml(positionIntegratorSummary.yOnlyRoutine || '?')} then ${simEscapeHtml(positionIntegratorSummary.xOnlyRoutine || '?')}; ${simEscapeHtml(String(positionIntegratorSummary.totalExternalCallCount || 0))} external callsite(s), X ${simEscapeHtml(positionIntegratorSummary.xVelocityFields || '?')} -> ${simEscapeHtml(positionIntegratorSummary.xVisibleCoordinateFields || '?')}, Y ${simEscapeHtml(positionIntegratorSummary.yVelocityFields || '?')} -> ${simEscapeHtml(positionIntegratorSummary.yVisibleCoordinateFields || '?')}.
        Velocity provenance: ${simEscapeHtml(velocityFieldCatalog?.id || '?')} tracks ${simEscapeHtml(String(velocityFieldSummary.referenceCount || 0))} IX+8/9/10/11 reference(s), ${simEscapeHtml(String(velocityFieldSummary.writerReferenceCount || 0))} writer ref(s), ${simEscapeHtml(String(velocityFieldSummary.readerReferenceCount || 0))} reader ref(s); helpers ${simEscapeHtml(velocityFieldSummary.xVelocitySignedDeltaHelper || '?')}/${simEscapeHtml(velocityFieldSummary.yVelocitySignedDeltaHelper || '?')} feed ${simEscapeHtml(velocityFieldSummary.xIntegratorConsumer || '?')}/${simEscapeHtml(velocityFieldSummary.yIntegratorConsumer || '?')}.
        Motion delta provenance: ${simEscapeHtml(motionDeltaCatalog?.id || '?')} tracks ${simEscapeHtml(String(motionDeltaSummary.referenceCount || 0))} IX+30/31 reference(s), ${simEscapeHtml(String(motionDeltaSummary.writerReferenceCount || 0))} writer ref(s), ${simEscapeHtml(String(motionDeltaSummary.readerReferenceCount || 0))} reader ref(s); delta consumers ${simEscapeHtml(motionDeltaSummary.xVelocityDeltaConsumer || '?')}/${simEscapeHtml(motionDeltaSummary.yVelocityDeltaConsumer || '?')} and mixed C600 gates ${simEscapeHtml(motionDeltaSummary.c600MotionControllerGateRoutines || '?')}.
        Motion delta behavior links: ${simEscapeHtml(motionDeltaBehaviorCatalog?.id || '?')} classifies ${simEscapeHtml(String(motionDeltaBehaviorSummary.writerRoutineCount || 0))} writer routine(s), ${simEscapeHtml(String(motionDeltaBehaviorSummary.behaviorTableLinkedWriterRoutineCount || 0))} behavior-table linked, ${simEscapeHtml(String(motionDeltaBehaviorSummary.directOrScheduledDeltaConsumerLinkedWriterRoutineCount || 0))} with direct/scheduled delta consumers, ${simEscapeHtml(String(motionDeltaBehaviorSummary.unresolvedWriterRoutineCount || 0))} unresolved.
        C3C0 motion seed families: ${simEscapeHtml(c3c0MotionSeedCatalog?.id || '?')} resolves ${simEscapeHtml(String(c3c0MotionSeedSummary.behaviorListResolvedSeedRoutineCount || 0))}/${simEscapeHtml(String(c3c0MotionSeedSummary.seedRoutineCount || 0))} initializer seed(s) to behavior-list label sources; ${simEscapeHtml(String(c3c0MotionSeedSummary.behaviorListSourceCount || 0))} source expression(s), ${simEscapeHtml(String(c3c0MotionSeedSummary.unresolvedBehaviorListSeedRoutineCount || 0))} unresolved.
        C3C0 target links: ${simEscapeHtml(c3c0MotionSeedTargetCatalog?.id || '?')} links ${simEscapeHtml(String(c3c0MotionSeedTargetSummary.linkedBehaviorListSourceCount || 0))}/${simEscapeHtml(String(c3c0MotionSeedTargetSummary.behaviorListSourceCount || 0))} behavior-list source(s) to ${simEscapeHtml(String(c3c0MotionSeedTargetSummary.targetEntryCount || 0))} target entr${Number(c3c0MotionSeedTargetSummary.targetEntryCount || 0) === 1 ? 'y' : 'ies'} across ${simEscapeHtml(String(c3c0MotionSeedTargetSummary.uniqueTargetRegionCount || 0))} region(s).
        C3C0 target semantics: ${simEscapeHtml(c3c0BehaviorTargetSemanticsCatalog?.id || '?')} classifies ${simEscapeHtml(String(c3c0BehaviorTargetSemanticsSummary.uniqueTargetOffsetCount || 0))} unique target offset(s), ${simEscapeHtml(String(c3c0BehaviorTargetSemanticsSummary.targetsWithKnownHelperCalls || 0))} with known helper calls, ${simEscapeHtml(String(c3c0BehaviorTargetSemanticsSummary.targetsWithPackedMotionDeltaConsumer || 0))} with packed motion-delta consumption, ${simEscapeHtml(String(c3c0BehaviorTargetSemanticsSummary.warningTargetCount || 0))} bounded-scan warning target(s).
        C3C0 actor families: ${simEscapeHtml(c3c0ActorFamilyCatalog?.id || '?')} joins ${simEscapeHtml(String(c3c0ActorFamilySummary.rawEntityTypeCount || 0))} raw entity type(s) to ${simEscapeHtml(String(c3c0ActorFamilySummary.seedRoutineCount || 0))} seed routine(s), ${simEscapeHtml(String(c3c0ActorFamilySummary.targetLinkedEntityTypeCount || 0))} target-linked type(s), ${simEscapeHtml(String(c3c0ActorFamilySummary.frameLinkedEntityTypeCount || 0))} frame-linked type(s), and ${simEscapeHtml(String(c3c0ActorFamilySummary.missingBehaviorListSourceEntityTypeCount || 0))} type(s) with a missing behavior-list source.
        C3C0 renderability: ${simEscapeHtml(c3c0RenderabilityCatalog?.id || '?')} marks ${simEscapeHtml(String(c3c0RenderabilitySummary.fullyRenderableActorTypeCount || 0))} fully renderable actor type(s), ${simEscapeHtml(String(c3c0RenderabilitySummary.partiallyRenderableActorTypeCount || 0))} partial, ${simEscapeHtml(String(c3c0RenderabilitySummary.blockedPendingTileBaseTraceActorTypeCount || 0))} blocked on tile-base trace, best frame-step candidate ${simEscapeHtml(c3c0RenderabilitySummary.bestFrameStepCandidate || '?')} via ${simEscapeHtml(c3c0RenderabilitySummary.bestFrameStepCandidateSeed || '?')}.
        C3C0 frame-step diagnostic: ${simEscapeHtml(c3c0FrameStepDiagnosticCatalog?.id || '?')} builds ${simEscapeHtml(String(c3c0FrameStepDiagnosticSummary.behaviorStateCount || 0))} behavior-state call plan(s), ${simEscapeHtml(String(c3c0FrameStepDiagnosticSummary.callPlanEntryCount || 0))} call-plan entr${Number(c3c0FrameStepDiagnosticSummary.callPlanEntryCount || 0) === 1 ? 'y' : 'ies'}, ${simEscapeHtml(String(c3c0FrameStepDiagnosticSummary.unresolvedCallPlanCount || 0))} unresolved, ${simEscapeHtml(String(c3c0FrameStepDiagnosticSummary.exactSemanticsPendingHelperTargetCount || 0))} exact-helper pending; status ${simEscapeHtml(c3c0FrameStepDiagnosticSummary.diagnosticStatus || '?')}.
        C3C0 control flow: ${simEscapeHtml(c3c0FrameStepControlFlowCatalog?.id || '?')} classifies ${simEscapeHtml(String(c3c0FrameStepControlFlowSummary.conditionalControlCount || 0))} conditional control(s), ${simEscapeHtml(String(c3c0FrameStepControlFlowSummary.symbolicPredicateCount || 0))} symbolic predicate(s), ${simEscapeHtml(String(c3c0FrameStepControlFlowSummary.unclassifiedConditionalControlCount || 0))} source-pending, ${simEscapeHtml(String(c3c0FrameStepControlFlowSummary.timerOperationCount || 0))} timer op(s), and ${simEscapeHtml(String(c3c0FrameStepControlFlowSummary.behaviorStateWriteStateCount || 0))} behavior-state writer state(s); status ${simEscapeHtml(c3c0FrameStepControlFlowSummary.diagnosticStatus || '?')}.
        C3C0 trace skeleton: ${simEscapeHtml(c3c0FrameStepTraceCatalog?.id || '?')} orders ${simEscapeHtml(String(c3c0FrameStepTraceSummary.traceStepCount || 0))} trace step(s): ${simEscapeHtml(String(c3c0FrameStepTraceSummary.fieldTouchCount || 0))} field touch(es), ${simEscapeHtml(String(c3c0FrameStepTraceSummary.helperStubCount || 0))} helper stub(s), ${simEscapeHtml(String(c3c0FrameStepTraceSummary.conditionalControlCount || 0))} conditional control(s), ${simEscapeHtml(String(c3c0FrameStepTraceSummary.unresolvedPredicateCount || 0))} unresolved predicate(s); status ${simEscapeHtml(c3c0FrameStepTraceSummary.traceReadinessStatus || '?')}.
        C3C0 stepper preview: ${simEscapeHtml(c3c0FrameStepStepperPreview.catalogId || '?')} builds ${simEscapeHtml(String(c3c0FrameStepStepperPreview.frameCount || 0))} symbolic frame(s) from ${simEscapeHtml(String(c3c0FrameStepStepperPreview.traceStepCount || 0))} trace step(s); runtime reads ${simEscapeHtml(String(c3c0FrameStepStepperPreview.runtimeValueReadCount || 0))}, runtime writes ${simEscapeHtml(String(c3c0FrameStepStepperPreview.runtimeValueWriteCount || 0))}, evaluated branch outcomes ${simEscapeHtml(String(c3c0FrameStepStepperPreview.branchOutcomeEvaluatedCount || 0))}, helper effects ${simEscapeHtml(String(c3c0FrameStepStepperPreview.helperEffectEvaluatedCount || 0))}; status ${simEscapeHtml(c3c0FrameStepStepperPreview.status || '?')}.
      </div>
      ${roomEntityRenderableFrameFixtureTable(fixtureCatalog)}
      ${roomEntityFrameTracePriorityTable(tracePriorityCatalog)}
      ${roomEntityFrameSubrecordCoverageTable(subrecordCoverageCatalog)}
      ${roomEntityFrameCoverageTable(catalog)}
      ${roomEntityC3c0FrameStepStepperTable(c3c0FrameStepStepperPreview)}
    `;
    const canvasWrap = document.getElementById('room-entity-renderable-fixture-canvas-wrap');
    if (canvasWrap) canvasWrap.appendChild(fixtureRuntimeCanvas);
  }

  return {
    catalogBacked: Boolean(catalog),
    catalogId: catalog?.id || '',
    previewOk: warnings.length === 0,
    totalDynamicEntityUploads,
    frameLinkedUploadCount,
    fullyCoveredUploadCount,
    partialCoverageUploadCount,
    noFrameAssetUploadCount,
    dynamicEntityTypeCount: Number(summary.dynamicEntityTypeCount || 0),
    frameLinkedEntityTypeCount: Number(summary.frameLinkedEntityTypeCount || 0),
    fullyCoveredEntityTypeCount: Number(summary.fullyCoveredEntityTypeCount || 0),
    needsTraceEntityTypeCount,
    tracePriorityCatalogBacked: Boolean(tracePriorityCatalog),
    tracePriorityEntityTypeCount: Number(traceSummary.tracePriorityEntityTypeCount || 0),
    tracePriorityTopEntityType: traceSummary.topEntityType || '',
    tracePriorityTopUploadCount: Number(traceSummary.topUploadCount || 0),
    tracePriorityPartialUploadCount: Number(traceSummary.totalPartialCoverageUploads || 0),
    subrecordCoverageCatalogBacked: Boolean(subrecordCoverageCatalog),
    subrecordCoverageEntityTypeCount: Number(subrecordSummary.tracedPriorityEntityTypeCount || 0),
    subrecordCoverageTotalFrameCount: Number(subrecordSummary.totalFrameSubrecords || 0),
    subrecordCoverageRenderableFrameCount: Number(subrecordSummary.totalRenderableWithoutAdditionalTileTraceSubrecords || 0),
    subrecordCoverageDynamicCoveredFrameCount: Number(subrecordSummary.totalDynamicCoveredSubrecords || 0),
    subrecordCoverageNotCoveredFrameCount: Number(subrecordSummary.totalNotCoveredSubrecords || 0),
    subrecordCoverageTopEntityType: subrecordSummary.topEntityType || '',
    subrecordCoverageTopEntityFrameCount: Number(subrecordSummary.topEntityFrameSubrecordCount || 0),
    subrecordCoverageTopEntityRenderableFrameCount: Number(subrecordSummary.topEntityRenderableWithoutAdditionalTileTraceSubrecordCount || 0),
    subrecordCoverageTopEntityNotCoveredFrameCount: Number(subrecordSummary.topEntityNotCoveredSubrecordCount || 0),
    subrecordCoverageParseIssueCount: Number(subrecordSummary.parseIssueSubrecordCount || 0),
    renderableFixtureCatalogBacked: Boolean(fixtureCatalog),
    renderableFixtureCatalogId: fixtureCatalog?.id || '',
    renderableFixtureEntityTypeCount: Number(fixtureSummary.fixtureEntityTypeCount || 0),
    renderableFixtureCount: Number(fixtureSummary.fixtureCount || 0),
    renderableFixtureDynamicBackedCount: Number(fixtureSummary.dynamicUploadBackedFixtureCount || 0),
    renderableFixtureEmptyFrameCount: Number(fixtureSummary.emptyFrameFixtureCount || 0),
    renderableFixtureBlockedOrPartialSubrecordCount: Number(fixtureSummary.blockedOrPartialSubrecordCount || 0),
    renderableFixtureTopEntityType: fixtureSummary.topEntityType || '',
    renderableFixtureTopEntityFixtureCount: Number(fixtureSummary.topEntityFixtureCount || 0),
    renderableFixtureTopEntityBlockedSubrecordCount: Number(fixtureSummary.topEntityBlockedSubrecordCount || 0),
    renderableFixtureParseIssueCount: Number(fixtureSummary.parseIssueSubrecordCount || 0),
    oamSemanticsCatalogBacked: Boolean(oamSemanticsCatalog),
    oamSemanticsCatalogId: oamSemanticsCatalog?.id || '',
    oamPieceRecordByteLength: Number(oamSemanticsSummary.pieceRecordByteLength || 0),
    oamOutputRecordByteLength: Number(oamSemanticsSummary.outputRecordByteLength || 0),
    oamFrameStreamRoutine: oamSemanticsSummary.frameStreamRoutine || '',
    oamSlotScanRoutine: oamSemanticsSummary.slotScanRoutine || '',
    oamPositionProducerRoutine: oamSemanticsSummary.positionProducerRoutine || '',
    oamTileBaseField: oamSemanticsSummary.tileBaseField || '',
    oamXBaseRam: oamSemanticsSummary.xBaseRam || '',
    oamYBaseRam: oamSemanticsSummary.yBaseRam || '',
    oamXBaseSlotFields: oamSemanticsSummary.xBaseSlotFields || '',
    oamYBaseSlotFields: oamSemanticsSummary.yBaseSlotFields || '',
    oamXCameraRam: oamSemanticsSummary.xCameraRam || '',
    oamYCameraRam: oamSemanticsSummary.yCameraRam || '',
    oamCameraSubtractFlag: oamSemanticsSummary.cameraSubtractFlag || '',
    oamPersistedCoordinateCount: Number(oamSemanticsSummary.persistedCoordinateCount || 0),
    slotCoordinateCatalogBacked: Boolean(slotCoordinateCatalog),
    slotCoordinateCatalogId: slotCoordinateCatalog?.id || '',
    slotCoordinateFieldCount: Number(slotCoordinateSummary.fieldCount || 0),
    slotCoordinateReferenceCount: Number(slotCoordinateSummary.referenceCount || 0),
    slotCoordinateReadReferenceCount: Number(slotCoordinateSummary.readReferenceCount || 0),
    slotCoordinateWriteReferenceCount: Number(slotCoordinateSummary.writeReferenceCount || 0),
    slotCoordinateReadWriteReferenceCount: Number(slotCoordinateSummary.readWriteReferenceCount || 0),
    slotCoordinateUnknownReferenceCount: Number(slotCoordinateSummary.unknownReferenceCount || 0),
    slotCoordinateRoutineReferenceCount: Number(slotCoordinateSummary.routineReferenceCount || 0),
    slotCoordinateConfirmedContextReferenceCount: Number(slotCoordinateSummary.confirmedContextReferenceCount || 0),
    slotCoordinateCandidateContextReferenceCount: Number(slotCoordinateSummary.candidateContextReferenceCount || 0),
    slotCoordinateRoomEntityInitializerLabel: slotCoordinateSummary.roomEntityInitializerLabel || '',
    slotCoordinateOamPositionProducerLabel: slotCoordinateSummary.oamPositionProducerLabel || '',
    slotCoordinateOamFrameStreamConsumerLabel: slotCoordinateSummary.oamFrameStreamConsumerLabel || '',
    slotCoordinateXSlotFields: slotCoordinateSummary.xSlotFields || '',
    slotCoordinateYSlotFields: slotCoordinateSummary.ySlotFields || '',
    slotCoordinateXRoomRecordSourceFields: slotCoordinateSummary.xRoomRecordSourceFields || '',
    slotCoordinateYRoomRecordSourceFields: slotCoordinateSummary.yRoomRecordSourceFields || '',
    slotCoordinateXBaseOutputRam: slotCoordinateSummary.xBaseOutputRam || '',
    slotCoordinateYBaseOutputRam: slotCoordinateSummary.yBaseOutputRam || '',
    slotCoordinateRuntimePositionCoordinateModelStatus: slotCoordinateSummary.runtimePositionCoordinateModelStatus || '',
    slotCoordinatePersistedCoordinateCount: Number(slotCoordinateSummary.persistedCoordinateCount || 0),
    positionIntegratorCatalogBacked: Boolean(positionIntegratorCatalog),
    positionIntegratorCatalogId: positionIntegratorCatalog?.id || '',
    positionIntegratorRoutineCount: Number(positionIntegratorSummary.integratorRoutineCount || 0),
    positionIntegratorBothAxesRoutine: positionIntegratorSummary.bothAxesRoutine || '',
    positionIntegratorXOnlyRoutine: positionIntegratorSummary.xOnlyRoutine || '',
    positionIntegratorYOnlyRoutine: positionIntegratorSummary.yOnlyRoutine || '',
    positionIntegratorBothAxisExternalCallCount: Number(positionIntegratorSummary.bothAxisExternalCallCount || 0),
    positionIntegratorXOnlyExternalCallCount: Number(positionIntegratorSummary.xOnlyExternalCallCount || 0),
    positionIntegratorYOnlyExternalCallCount: Number(positionIntegratorSummary.yOnlyExternalCallCount || 0),
    positionIntegratorYOnlyInternalCallCount: Number(positionIntegratorSummary.yOnlyInternalCallCount || 0),
    positionIntegratorTotalExternalCallCount: Number(positionIntegratorSummary.totalExternalCallCount || 0),
    positionIntegratorUniqueExternalCallerCount: Number(positionIntegratorSummary.uniqueExternalCallerCount || 0),
    positionIntegratorXVelocityFields: positionIntegratorSummary.xVelocityFields || '',
    positionIntegratorYVelocityFields: positionIntegratorSummary.yVelocityFields || '',
    positionIntegratorXVisibleCoordinateFields: positionIntegratorSummary.xVisibleCoordinateFields || '',
    positionIntegratorYVisibleCoordinateFields: positionIntegratorSummary.yVisibleCoordinateFields || '',
    positionIntegratorPersistedGameplayValueCount: Number(positionIntegratorSummary.persistedGameplayValueCount || 0),
    velocityFieldCatalogBacked: Boolean(velocityFieldCatalog),
    velocityFieldCatalogId: velocityFieldCatalog?.id || '',
    velocityFieldFieldCount: Number(velocityFieldSummary.fieldCount || 0),
    velocityFieldReferenceCount: Number(velocityFieldSummary.referenceCount || 0),
    velocityFieldReadReferenceCount: Number(velocityFieldSummary.readReferenceCount || 0),
    velocityFieldWriteReferenceCount: Number(velocityFieldSummary.writeReferenceCount || 0),
    velocityFieldReadWriteReferenceCount: Number(velocityFieldSummary.readWriteReferenceCount || 0),
    velocityFieldUnknownReferenceCount: Number(velocityFieldSummary.unknownReferenceCount || 0),
    velocityFieldWriterReferenceCount: Number(velocityFieldSummary.writerReferenceCount || 0),
    velocityFieldReaderReferenceCount: Number(velocityFieldSummary.readerReferenceCount || 0),
    velocityFieldRoutineReferenceCount: Number(velocityFieldSummary.routineReferenceCount || 0),
    velocityFieldWriterRoutineCount: Number(velocityFieldSummary.writerRoutineCount || 0),
    velocityFieldReaderRoutineCount: Number(velocityFieldSummary.readerRoutineCount || 0),
    velocityFieldConfirmedContextReferenceCount: Number(velocityFieldSummary.confirmedContextReferenceCount || 0),
    velocityFieldCandidateContextReferenceCount: Number(velocityFieldSummary.candidateContextReferenceCount || 0),
    velocityFieldXVelocityFields: velocityFieldSummary.xVelocityFields || '',
    velocityFieldYVelocityFields: velocityFieldSummary.yVelocityFields || '',
    velocityFieldXIntegratorConsumer: velocityFieldSummary.xIntegratorConsumer || '',
    velocityFieldYIntegratorConsumer: velocityFieldSummary.yIntegratorConsumer || '',
    velocityFieldXVelocitySignedDeltaHelper: velocityFieldSummary.xVelocitySignedDeltaHelper || '',
    velocityFieldYVelocitySignedDeltaHelper: velocityFieldSummary.yVelocitySignedDeltaHelper || '',
    velocityFieldXContactResponseHelper: velocityFieldSummary.xContactResponseHelper || '',
    velocityFieldYContactResponseHelpers: velocityFieldSummary.yContactResponseHelpers || '',
    velocityFieldTableDrivenInitializer: velocityFieldSummary.tableDrivenInitializer || '',
    velocityFieldPersistedGameplayValueCount: Number(velocityFieldSummary.persistedGameplayValueCount || 0),
    motionDeltaCatalogBacked: Boolean(motionDeltaCatalog),
    motionDeltaCatalogId: motionDeltaCatalog?.id || '',
    motionDeltaFieldCount: Number(motionDeltaSummary.fieldCount || 0),
    motionDeltaReferenceCount: Number(motionDeltaSummary.referenceCount || 0),
    motionDeltaReadReferenceCount: Number(motionDeltaSummary.readReferenceCount || 0),
    motionDeltaWriteReferenceCount: Number(motionDeltaSummary.writeReferenceCount || 0),
    motionDeltaReadWriteReferenceCount: Number(motionDeltaSummary.readWriteReferenceCount || 0),
    motionDeltaUnknownReferenceCount: Number(motionDeltaSummary.unknownReferenceCount || 0),
    motionDeltaWriterReferenceCount: Number(motionDeltaSummary.writerReferenceCount || 0),
    motionDeltaReaderReferenceCount: Number(motionDeltaSummary.readerReferenceCount || 0),
    motionDeltaRoutineReferenceCount: Number(motionDeltaSummary.routineReferenceCount || 0),
    motionDeltaWriterRoutineCount: Number(motionDeltaSummary.writerRoutineCount || 0),
    motionDeltaReaderRoutineCount: Number(motionDeltaSummary.readerRoutineCount || 0),
    motionDeltaConfirmedContextReferenceCount: Number(motionDeltaSummary.confirmedContextReferenceCount || 0),
    motionDeltaCandidateContextReferenceCount: Number(motionDeltaSummary.candidateContextReferenceCount || 0),
    motionDeltaXDeltaField: motionDeltaSummary.xDeltaField || '',
    motionDeltaYDeltaField: motionDeltaSummary.yDeltaField || '',
    motionDeltaXVelocityDeltaConsumer: motionDeltaSummary.xVelocityDeltaConsumer || '',
    motionDeltaYVelocityDeltaConsumer: motionDeltaSummary.yVelocityDeltaConsumer || '',
    motionDeltaCombinedVelocityDeltaEntry: motionDeltaSummary.combinedVelocityDeltaEntry || '',
    motionDeltaXGlobalAccumulatorInput: motionDeltaSummary.xGlobalAccumulatorInput || '',
    motionDeltaYGlobalAccumulatorInput: motionDeltaSummary.yGlobalAccumulatorInput || '',
    motionDeltaC600MotionControllerGateRoutines: motionDeltaSummary.c600MotionControllerGateRoutines || '',
    motionDeltaCollisionReactionWriters: motionDeltaSummary.collisionReactionWriters || '',
    motionDeltaTableDrivenInitializer: motionDeltaSummary.tableDrivenInitializer || '',
    motionDeltaPersistedGameplayValueCount: Number(motionDeltaSummary.persistedGameplayValueCount || 0),
    motionDeltaBehaviorCatalogBacked: Boolean(motionDeltaBehaviorCatalog),
    motionDeltaBehaviorCatalogId: motionDeltaBehaviorCatalog?.id || '',
    motionDeltaBehaviorWriterRoutineCount: Number(motionDeltaBehaviorSummary.writerRoutineCount || 0),
    motionDeltaBehaviorLinkedWriterRoutineCount: Number(motionDeltaBehaviorSummary.linkedWriterRoutineCount || 0),
    motionDeltaBehaviorBehaviorTableLinkedWriterRoutineCount: Number(motionDeltaBehaviorSummary.behaviorTableLinkedWriterRoutineCount || 0),
    motionDeltaBehaviorC3c0InitializerWriterRoutineCount: Number(motionDeltaBehaviorSummary.c3c0InitializerWriterRoutineCount || 0),
    motionDeltaBehaviorAuxiliaryActorWriterRoutineCount: Number(motionDeltaBehaviorSummary.auxiliaryActorWriterRoutineCount || 0),
    motionDeltaBehaviorC640PairSlotWriterRoutineCount: Number(motionDeltaBehaviorSummary.c640PairSlotWriterRoutineCount || 0),
    motionDeltaBehaviorC740SlotWriterRoutineCount: Number(motionDeltaBehaviorSummary.c740SlotWriterRoutineCount || 0),
    motionDeltaBehaviorC600RecordInitializerWriterRoutineCount: Number(motionDeltaBehaviorSummary.c600RecordInitializerWriterRoutineCount || 0),
    motionDeltaBehaviorC600CollisionResponseWriterRoutineCount: Number(motionDeltaBehaviorSummary.c600CollisionResponseWriterRoutineCount || 0),
    motionDeltaBehaviorBank2SceneWriterRoutineCount: Number(motionDeltaBehaviorSummary.bank2SceneWriterRoutineCount || 0),
    motionDeltaBehaviorBank2TransitionWriterRoutineCount: Number(motionDeltaBehaviorSummary.bank2TransitionWriterRoutineCount || 0),
    motionDeltaBehaviorGameplayLookupWriterRoutineCount: Number(motionDeltaBehaviorSummary.gameplayLookupWriterRoutineCount || 0),
    motionDeltaBehaviorUnresolvedWriterRoutineCount: Number(motionDeltaBehaviorSummary.unresolvedWriterRoutineCount || 0),
    motionDeltaBehaviorDirectOrScheduledDeltaConsumerLinkedWriterRoutineCount: Number(motionDeltaBehaviorSummary.directOrScheduledDeltaConsumerLinkedWriterRoutineCount || 0),
    motionDeltaBehaviorMotionSeedOnlyWriterRoutineCount: Number(motionDeltaBehaviorSummary.motionSeedOnlyWriterRoutineCount || 0),
    motionDeltaBehaviorWriterReferenceCount: Number(motionDeltaBehaviorSummary.writerReferenceCount || 0),
    motionDeltaBehaviorReaderReferenceCountInWriterRoutines: Number(motionDeltaBehaviorSummary.readerReferenceCountInWriterRoutines || 0),
    motionDeltaBehaviorPersistedGameplayValueCount: Number(motionDeltaBehaviorSummary.persistedGameplayValueCount || 0),
    c3c0MotionSeedCatalogBacked: Boolean(c3c0MotionSeedCatalog),
    c3c0MotionSeedCatalogId: c3c0MotionSeedCatalog?.id || '',
    c3c0MotionSeedSeedRoutineCount: Number(c3c0MotionSeedSummary.seedRoutineCount || 0),
    c3c0MotionSeedBehaviorListResolvedSeedRoutineCount: Number(c3c0MotionSeedSummary.behaviorListResolvedSeedRoutineCount || 0),
    c3c0MotionSeedDirectInitializerBehaviorListSeedRoutineCount: Number(c3c0MotionSeedSummary.directInitializerBehaviorListSeedRoutineCount || 0),
    c3c0MotionSeedCallerProvidedBehaviorListSeedRoutineCount: Number(c3c0MotionSeedSummary.callerProvidedBehaviorListSeedRoutineCount || 0),
    c3c0MotionSeedUnresolvedBehaviorListSeedRoutineCount: Number(c3c0MotionSeedSummary.unresolvedBehaviorListSeedRoutineCount || 0),
    c3c0MotionSeedBehaviorListSourceCount: Number(c3c0MotionSeedSummary.behaviorListSourceCount || 0),
    c3c0MotionSeedUniqueBehaviorListExpressionCount: Number(c3c0MotionSeedSummary.uniqueBehaviorListExpressionCount || 0),
    c3c0MotionSeedPointerAdjustmentExpressionCount: Number(c3c0MotionSeedSummary.pointerAdjustmentExpressionCount || 0),
    c3c0MotionSeedTotalTableEntryReferences: Number(c3c0MotionSeedSummary.totalTableEntryReferences || 0),
    c3c0MotionSeedTotalWriterReferenceCount: Number(c3c0MotionSeedSummary.totalWriterReferenceCount || 0),
    c3c0MotionSeedPersistedGameplayValueCount: Number(c3c0MotionSeedSummary.persistedGameplayValueCount || 0),
    c3c0MotionSeedTargetCatalogBacked: Boolean(c3c0MotionSeedTargetCatalog),
    c3c0MotionSeedTargetCatalogId: c3c0MotionSeedTargetCatalog?.id || '',
    c3c0MotionSeedTargetSeedRoutineCount: Number(c3c0MotionSeedTargetSummary.seedRoutineCount || 0),
    c3c0MotionSeedTargetBehaviorListSourceCount: Number(c3c0MotionSeedTargetSummary.behaviorListSourceCount || 0),
    c3c0MotionSeedTargetLinkedBehaviorListSourceCount: Number(c3c0MotionSeedTargetSummary.linkedBehaviorListSourceCount || 0),
    c3c0MotionSeedTargetMissingBehaviorListSourceCount: Number(c3c0MotionSeedTargetSummary.missingBehaviorListSourceCount || 0),
    c3c0MotionSeedTargetTargetEntryCount: Number(c3c0MotionSeedTargetSummary.targetEntryCount || 0),
    c3c0MotionSeedTargetUniqueTargetRegionCount: Number(c3c0MotionSeedTargetSummary.uniqueTargetRegionCount || 0),
    c3c0MotionSeedTargetSeedRoutinesWithMultipleBehaviorLists: Number(c3c0MotionSeedTargetSummary.seedRoutinesWithMultipleBehaviorLists || 0),
    c3c0MotionSeedTargetSeedRoutinesWithMissingBehaviorLists: Number(c3c0MotionSeedTargetSummary.seedRoutinesWithMissingBehaviorLists || 0),
    c3c0MotionSeedTargetSeedRoutinesWithTargetLinks: Number(c3c0MotionSeedTargetSummary.seedRoutinesWithTargetLinks || 0),
    c3c0MotionSeedTargetMaxTargetEntriesPerSeed: Number(c3c0MotionSeedTargetSummary.maxTargetEntriesPerSeed || 0),
    c3c0MotionSeedTargetTotalTableEntryReferences: Number(c3c0MotionSeedTargetSummary.totalTableEntryReferences || 0),
    c3c0MotionSeedTargetPersistedGameplayValueCount: Number(c3c0MotionSeedTargetSummary.persistedGameplayValueCount || 0),
    c3c0BehaviorTargetSemanticsCatalogBacked: Boolean(c3c0BehaviorTargetSemanticsCatalog),
    c3c0BehaviorTargetSemanticsCatalogId: c3c0BehaviorTargetSemanticsCatalog?.id || '',
    c3c0BehaviorTargetSemanticsSourceTargetEntryCount: Number(c3c0BehaviorTargetSemanticsSummary.sourceTargetEntryCount || 0),
    c3c0BehaviorTargetSemanticsUniqueTargetOffsetCount: Number(c3c0BehaviorTargetSemanticsSummary.uniqueTargetOffsetCount || 0),
    c3c0BehaviorTargetSemanticsTargetRegionCount: Number(c3c0BehaviorTargetSemanticsSummary.targetRegionCount || 0),
    c3c0BehaviorTargetSemanticsTargetsWithKnownHelperCalls: Number(c3c0BehaviorTargetSemanticsSummary.targetsWithKnownHelperCalls || 0),
    c3c0BehaviorTargetSemanticsTargetsWithPackedMotionDeltaConsumer: Number(c3c0BehaviorTargetSemanticsSummary.targetsWithPackedMotionDeltaConsumer || 0),
    c3c0BehaviorTargetSemanticsTargetsWithVelocityIntegrator: Number(c3c0BehaviorTargetSemanticsSummary.targetsWithVelocityIntegrator || 0),
    c3c0BehaviorTargetSemanticsTargetsWithCollisionPipeline: Number(c3c0BehaviorTargetSemanticsSummary.targetsWithCollisionPipeline || 0),
    c3c0BehaviorTargetSemanticsTargetsWithAnimationTick: Number(c3c0BehaviorTargetSemanticsSummary.targetsWithAnimationTick || 0),
    c3c0BehaviorTargetSemanticsTargetsWithBehaviorStateWrite: Number(c3c0BehaviorTargetSemanticsSummary.targetsWithBehaviorStateWrite || 0),
    c3c0BehaviorTargetSemanticsHelperCallCount: Number(c3c0BehaviorTargetSemanticsSummary.helperCallCount || 0),
    c3c0BehaviorTargetSemanticsWarningTargetCount: Number(c3c0BehaviorTargetSemanticsSummary.warningTargetCount || 0),
    c3c0BehaviorTargetSemanticsPersistedRomByteCount: Number(c3c0BehaviorTargetSemanticsSummary.persistedRomByteCount || 0),
    c3c0BehaviorTargetSemanticsPersistedGameplayValueCount: Number(c3c0BehaviorTargetSemanticsSummary.persistedGameplayValueCount || 0),
    c3c0ActorFamilyCatalogBacked: Boolean(c3c0ActorFamilyCatalog),
    c3c0ActorFamilyCatalogId: c3c0ActorFamilyCatalog?.id || '',
    c3c0ActorFamilyRawEntityTypeCount: Number(c3c0ActorFamilySummary.rawEntityTypeCount || 0),
    c3c0ActorFamilySelectorTypeCount: Number(c3c0ActorFamilySummary.selectorTypeCount || 0),
    c3c0ActorFamilyDirectSeedEntityTypeCount: Number(c3c0ActorFamilySummary.directSeedEntityTypeCount || 0),
    c3c0ActorFamilyTailSeedEntityTypeCount: Number(c3c0ActorFamilySummary.tailSeedEntityTypeCount || 0),
    c3c0ActorFamilySeedRoutineCount: Number(c3c0ActorFamilySummary.seedRoutineCount || 0),
    c3c0ActorFamilySeedGroupCount: Number(c3c0ActorFamilySummary.seedGroupCount || 0),
    c3c0ActorFamilyBehaviorListLinkedEntityTypeCount: Number(c3c0ActorFamilySummary.behaviorListLinkedEntityTypeCount || 0),
    c3c0ActorFamilyMissingBehaviorListSourceEntityTypeCount: Number(c3c0ActorFamilySummary.missingBehaviorListSourceEntityTypeCount || 0),
    c3c0ActorFamilyTargetLinkedEntityTypeCount: Number(c3c0ActorFamilySummary.targetLinkedEntityTypeCount || 0),
    c3c0ActorFamilyTargetEntryReferenceCount: Number(c3c0ActorFamilySummary.targetEntryReferenceCount || 0),
    c3c0ActorFamilyUniqueTargetOffsetCount: Number(c3c0ActorFamilySummary.uniqueTargetOffsetCount || 0),
    c3c0ActorFamilyActorTypesWithPackedMotionDeltaConsumer: Number(c3c0ActorFamilySummary.actorTypesWithPackedMotionDeltaConsumer || 0),
    c3c0ActorFamilyActorTypesWithCollisionPipeline: Number(c3c0ActorFamilySummary.actorTypesWithCollisionPipeline || 0),
    c3c0ActorFamilyActorTypesWithAnimationTick: Number(c3c0ActorFamilySummary.actorTypesWithAnimationTick || 0),
    c3c0ActorFamilyFrameLinkedEntityTypeCount: Number(c3c0ActorFamilySummary.frameLinkedEntityTypeCount || 0),
    c3c0ActorFamilyDynamicUploadedEntityTypeCount: Number(c3c0ActorFamilySummary.dynamicUploadedEntityTypeCount || 0),
    c3c0ActorFamilyFullyCoveredEntityTypeCount: Number(c3c0ActorFamilySummary.fullyCoveredEntityTypeCount || 0),
    c3c0ActorFamilyPartialCoverageEntityTypeCount: Number(c3c0ActorFamilySummary.partialCoverageEntityTypeCount || 0),
    c3c0ActorFamilyWarningActorTypeCount: Number(c3c0ActorFamilySummary.warningActorTypeCount || 0),
    c3c0ActorFamilyPersistedRomByteCount: Number(c3c0ActorFamilySummary.persistedRomByteCount || 0),
    c3c0ActorFamilyPersistedCoordinateCount: Number(c3c0ActorFamilySummary.persistedCoordinateCount || 0),
    c3c0ActorFamilyPersistedPixelCount: Number(c3c0ActorFamilySummary.persistedPixelCount || 0),
    c3c0ActorFamilyPersistedGameplayValueCount: Number(c3c0ActorFamilySummary.persistedGameplayValueCount || 0),
    c3c0RenderabilityCatalogBacked: Boolean(c3c0RenderabilityCatalog),
    c3c0RenderabilityCatalogId: c3c0RenderabilityCatalog?.id || '',
    c3c0RenderabilityActorTypeCount: Number(c3c0RenderabilitySummary.actorTypeCount || 0),
    c3c0RenderabilityFrameLinkedActorTypeCount: Number(c3c0RenderabilitySummary.frameLinkedActorTypeCount || 0),
    c3c0RenderabilityDynamicUploadedActorTypeCount: Number(c3c0RenderabilitySummary.dynamicUploadedActorTypeCount || 0),
    c3c0RenderabilityFullyRenderableActorTypeCount: Number(c3c0RenderabilitySummary.fullyRenderableActorTypeCount || 0),
    c3c0RenderabilityPartiallyRenderableActorTypeCount: Number(c3c0RenderabilitySummary.partiallyRenderableActorTypeCount || 0),
    c3c0RenderabilityBlockedPendingTileBaseTraceActorTypeCount: Number(c3c0RenderabilitySummary.blockedPendingTileBaseTraceActorTypeCount || 0),
    c3c0RenderabilityNoHighConfidenceFrameAssetActorTypeCount: Number(c3c0RenderabilitySummary.noHighConfidenceFrameAssetActorTypeCount || 0),
    c3c0RenderabilityFrameLinkedWithoutObservedDynamicUploadActorTypeCount: Number(c3c0RenderabilitySummary.frameLinkedWithoutObservedDynamicUploadActorTypeCount || 0),
    c3c0RenderabilityRenderableFixtureActorTypeCount: Number(c3c0RenderabilitySummary.renderableFixtureActorTypeCount || 0),
    c3c0RenderabilityRenderableFixtureCount: Number(c3c0RenderabilitySummary.renderableFixtureCount || 0),
    c3c0RenderabilityDynamicUploadBackedFixtureCount: Number(c3c0RenderabilitySummary.dynamicUploadBackedFixtureCount || 0),
    c3c0RenderabilitySeedGroupCount: Number(c3c0RenderabilitySummary.seedGroupCount || 0),
    c3c0RenderabilityPartialTraceEntityTypes: (c3c0RenderabilitySummary.c3c0PartialTraceEntityTypes || []).join(','),
    c3c0RenderabilityBlockedTraceEntityTypes: (c3c0RenderabilitySummary.c3c0BlockedTraceEntityTypes || []).join(','),
    c3c0RenderabilityBestFrameStepCandidate: c3c0RenderabilitySummary.bestFrameStepCandidate || '',
    c3c0RenderabilityBestFrameStepCandidateSeed: c3c0RenderabilitySummary.bestFrameStepCandidateSeed || '',
    c3c0RenderabilityBestFrameStepCandidateScore: Number(c3c0RenderabilitySummary.bestFrameStepCandidateScore || 0),
    c3c0RenderabilityOamTileBaseField: c3c0RenderabilitySummary.oamTileBaseField || '',
    c3c0RenderabilityOamFrameStreamRoutine: c3c0RenderabilitySummary.oamFrameStreamRoutine || '',
    c3c0RenderabilityOamPositionProducerRoutine: c3c0RenderabilitySummary.oamPositionProducerRoutine || '',
    c3c0RenderabilityPersistedRomByteCount: Number(c3c0RenderabilitySummary.persistedRomByteCount || 0),
    c3c0RenderabilityPersistedTileByteCount: Number(c3c0RenderabilitySummary.persistedTileByteCount || 0),
    c3c0RenderabilityPersistedPixelCount: Number(c3c0RenderabilitySummary.persistedPixelCount || 0),
    c3c0RenderabilityPersistedCoordinateCount: Number(c3c0RenderabilitySummary.persistedCoordinateCount || 0),
    c3c0RenderabilityPersistedGameplayValueCount: Number(c3c0RenderabilitySummary.persistedGameplayValueCount || 0),
    c3c0FrameStepDiagnosticCatalogBacked: Boolean(c3c0FrameStepDiagnosticCatalog),
    c3c0FrameStepDiagnosticCatalogId: c3c0FrameStepDiagnosticCatalog?.id || '',
    c3c0FrameStepDiagnosticCandidateEntityType: c3c0FrameStepDiagnosticSummary.candidateEntityType || '',
    c3c0FrameStepDiagnosticCandidateSeedLabel: c3c0FrameStepDiagnosticSummary.candidateSeedLabel || '',
    c3c0FrameStepDiagnosticBehaviorListSource: c3c0FrameStepDiagnosticSummary.behaviorListSource || '',
    c3c0FrameStepDiagnosticBehaviorStateCount: Number(c3c0FrameStepDiagnosticSummary.behaviorStateCount || 0),
    c3c0FrameStepDiagnosticTargetRegionCount: Number(c3c0FrameStepDiagnosticSummary.targetRegionCount || 0),
    c3c0FrameStepDiagnosticCallPlanEntryCount: Number(c3c0FrameStepDiagnosticSummary.callPlanEntryCount || 0),
    c3c0FrameStepDiagnosticUnresolvedCallPlanCount: Number(c3c0FrameStepDiagnosticSummary.unresolvedCallPlanCount || 0),
    c3c0FrameStepDiagnosticHelperTargetCount: Number(c3c0FrameStepDiagnosticSummary.helperTargetCount || 0),
    c3c0FrameStepDiagnosticHelperRoleResolvedTargetCount: Number(c3c0FrameStepDiagnosticSummary.helperRoleResolvedTargetCount || 0),
    c3c0FrameStepDiagnosticExactSemanticsPendingHelperTargetCount: Number(c3c0FrameStepDiagnosticSummary.exactSemanticsPendingHelperTargetCount || 0),
    c3c0FrameStepDiagnosticInternalHelperEntryRoleKnownTargetCount: Number(c3c0FrameStepDiagnosticSummary.internalHelperEntryRoleKnownTargetCount || 0),
    c3c0FrameStepDiagnosticLocalBehaviorSubroutineRoleKnownTargetCount: Number(c3c0FrameStepDiagnosticSummary.localBehaviorSubroutineRoleKnownTargetCount || 0),
    c3c0FrameStepDiagnosticRegionEntryRoleKnownTargetCount: Number(c3c0FrameStepDiagnosticSummary.regionEntryRoleKnownTargetCount || 0),
    c3c0FrameStepDiagnosticBehaviorStatesWithAnimationTick: Number(c3c0FrameStepDiagnosticSummary.behaviorStatesWithAnimationTick || 0),
    c3c0FrameStepDiagnosticBehaviorStatesWithCollisionPipeline: Number(c3c0FrameStepDiagnosticSummary.behaviorStatesWithCollisionPipeline || 0),
    c3c0FrameStepDiagnosticBehaviorStatesWithPackedMotionDeltaConsumer: Number(c3c0FrameStepDiagnosticSummary.behaviorStatesWithPackedMotionDeltaConsumer || 0),
    c3c0FrameStepDiagnosticBehaviorStatesWithBehaviorStateWrite: Number(c3c0FrameStepDiagnosticSummary.behaviorStatesWithBehaviorStateWrite || 0),
    c3c0FrameStepDiagnosticBehaviorStatesWithTimerCounterWrite: Number(c3c0FrameStepDiagnosticSummary.behaviorStatesWithTimerCounterWrite || 0),
    c3c0FrameStepDiagnosticFieldTokenCount: Number(c3c0FrameStepDiagnosticSummary.fieldTokenCount || 0),
    c3c0FrameStepDiagnosticBranchPredicatePendingStateCount: Number(c3c0FrameStepDiagnosticSummary.branchPredicatePendingStateCount || 0),
    c3c0FrameStepDiagnosticFrameExactStateCount: Number(c3c0FrameStepDiagnosticSummary.frameExactStateCount || 0),
    c3c0FrameStepDiagnosticDiagnosticStatus: c3c0FrameStepDiagnosticSummary.diagnosticStatus || '',
    c3c0FrameStepDiagnosticPersistedRomByteCount: Number(c3c0FrameStepDiagnosticSummary.persistedRomByteCount || 0),
    c3c0FrameStepDiagnosticPersistedInstructionByteCount: Number(c3c0FrameStepDiagnosticSummary.persistedInstructionByteCount || 0),
    c3c0FrameStepDiagnosticPersistedTileByteCount: Number(c3c0FrameStepDiagnosticSummary.persistedTileByteCount || 0),
    c3c0FrameStepDiagnosticPersistedPixelCount: Number(c3c0FrameStepDiagnosticSummary.persistedPixelCount || 0),
    c3c0FrameStepDiagnosticPersistedCoordinateCount: Number(c3c0FrameStepDiagnosticSummary.persistedCoordinateCount || 0),
    c3c0FrameStepDiagnosticPersistedGameplayValueCount: Number(c3c0FrameStepDiagnosticSummary.persistedGameplayValueCount || 0),
    c3c0FrameStepControlFlowCatalogBacked: Boolean(c3c0FrameStepControlFlowCatalog),
    c3c0FrameStepControlFlowCatalogId: c3c0FrameStepControlFlowCatalog?.id || '',
    c3c0FrameStepControlFlowCandidateEntityType: c3c0FrameStepControlFlowSummary.candidateEntityType || '',
    c3c0FrameStepControlFlowCandidateSeedLabel: c3c0FrameStepControlFlowSummary.candidateSeedLabel || '',
    c3c0FrameStepControlFlowBehaviorListSource: c3c0FrameStepControlFlowSummary.behaviorListSource || '',
    c3c0FrameStepControlFlowBehaviorStateCount: Number(c3c0FrameStepControlFlowSummary.behaviorStateCount || 0),
    c3c0FrameStepControlFlowRelativeBranchCount: Number(c3c0FrameStepControlFlowSummary.relativeBranchCount || 0),
    c3c0FrameStepControlFlowConditionalBranchCount: Number(c3c0FrameStepControlFlowSummary.conditionalBranchCount || 0),
    c3c0FrameStepControlFlowConditionalExitCount: Number(c3c0FrameStepControlFlowSummary.conditionalExitCount || 0),
    c3c0FrameStepControlFlowConditionalControlCount: Number(c3c0FrameStepControlFlowSummary.conditionalControlCount || 0),
    c3c0FrameStepControlFlowSymbolicPredicateCount: Number(c3c0FrameStepControlFlowSummary.symbolicPredicateCount || 0),
    c3c0FrameStepControlFlowUnclassifiedConditionalControlCount: Number(c3c0FrameStepControlFlowSummary.unclassifiedConditionalControlCount || 0),
    c3c0FrameStepControlFlowSymbolicPredicateStateCount: Number(c3c0FrameStepControlFlowSummary.symbolicPredicateStateCount || 0),
    c3c0FrameStepControlFlowFirstTickGuardStateCount: Number(c3c0FrameStepControlFlowSummary.firstTickGuardStateCount || 0),
    c3c0FrameStepControlFlowBehaviorStateOperationStateCount: Number(c3c0FrameStepControlFlowSummary.behaviorStateOperationStateCount || 0),
    c3c0FrameStepControlFlowBehaviorStateWriteStateCount: Number(c3c0FrameStepControlFlowSummary.behaviorStateWriteStateCount || 0),
    c3c0FrameStepControlFlowTimerOperationStateCount: Number(c3c0FrameStepControlFlowSummary.timerOperationStateCount || 0),
    c3c0FrameStepControlFlowCountdownOperationStateCount: Number(c3c0FrameStepControlFlowSummary.countdownOperationStateCount || 0),
    c3c0FrameStepControlFlowTimerOperationCount: Number(c3c0FrameStepControlFlowSummary.timerOperationCount || 0),
    c3c0FrameStepControlFlowCountdownOperationCount: Number(c3c0FrameStepControlFlowSummary.countdownOperationCount || 0),
    c3c0FrameStepControlFlowFieldTokenCount: Number(c3c0FrameStepControlFlowSummary.fieldTokenCount || 0),
    c3c0FrameStepControlFlowFrameExactStateCount: Number(c3c0FrameStepControlFlowSummary.frameExactStateCount || 0),
    c3c0FrameStepControlFlowDiagnosticStatus: c3c0FrameStepControlFlowSummary.diagnosticStatus || '',
    c3c0FrameStepControlFlowPersistedRomByteCount: Number(c3c0FrameStepControlFlowSummary.persistedRomByteCount || 0),
    c3c0FrameStepControlFlowPersistedInstructionByteCount: Number(c3c0FrameStepControlFlowSummary.persistedInstructionByteCount || 0),
    c3c0FrameStepControlFlowPersistedTileByteCount: Number(c3c0FrameStepControlFlowSummary.persistedTileByteCount || 0),
    c3c0FrameStepControlFlowPersistedPixelCount: Number(c3c0FrameStepControlFlowSummary.persistedPixelCount || 0),
    c3c0FrameStepControlFlowPersistedCoordinateCount: Number(c3c0FrameStepControlFlowSummary.persistedCoordinateCount || 0),
    c3c0FrameStepControlFlowPersistedGameplayValueCount: Number(c3c0FrameStepControlFlowSummary.persistedGameplayValueCount || 0),
    c3c0FrameStepTraceCatalogBacked: Boolean(c3c0FrameStepTraceCatalog),
    c3c0FrameStepTraceCatalogId: c3c0FrameStepTraceCatalog?.id || '',
    c3c0FrameStepTraceCandidateEntityType: c3c0FrameStepTraceSummary.candidateEntityType || '',
    c3c0FrameStepTraceCandidateSeedLabel: c3c0FrameStepTraceSummary.candidateSeedLabel || '',
    c3c0FrameStepTraceBehaviorListSource: c3c0FrameStepTraceSummary.behaviorListSource || '',
    c3c0FrameStepTraceBehaviorStateCount: Number(c3c0FrameStepTraceSummary.behaviorStateCount || 0),
    c3c0FrameStepTraceTraceStepCount: Number(c3c0FrameStepTraceSummary.traceStepCount || 0),
    c3c0FrameStepTraceFieldTouchCount: Number(c3c0FrameStepTraceSummary.fieldTouchCount || 0),
    c3c0FrameStepTraceHelperStubCount: Number(c3c0FrameStepTraceSummary.helperStubCount || 0),
    c3c0FrameStepTraceHelperRoleKnownCount: Number(c3c0FrameStepTraceSummary.helperRoleKnownCount || 0),
    c3c0FrameStepTraceConditionalControlCount: Number(c3c0FrameStepTraceSummary.conditionalControlCount || 0),
    c3c0FrameStepTraceSymbolicPredicateCount: Number(c3c0FrameStepTraceSummary.symbolicPredicateCount || 0),
    c3c0FrameStepTraceUnresolvedPredicateCount: Number(c3c0FrameStepTraceSummary.unresolvedPredicateCount || 0),
    c3c0FrameStepTraceFirstTickGuardCount: Number(c3c0FrameStepTraceSummary.firstTickGuardCount || 0),
    c3c0FrameStepTraceBehaviorStateFieldTouchCount: Number(c3c0FrameStepTraceSummary.behaviorStateFieldTouchCount || 0),
    c3c0FrameStepTraceTimerFieldTouchCount: Number(c3c0FrameStepTraceSummary.timerFieldTouchCount || 0),
    c3c0FrameStepTraceLiteralWithheldFieldTouchCount: Number(c3c0FrameStepTraceSummary.literalWithheldFieldTouchCount || 0),
    c3c0FrameStepTraceStatesWithHelperStubs: Number(c3c0FrameStepTraceSummary.statesWithHelperStubs || 0),
    c3c0FrameStepTraceStatesWithFieldTouches: Number(c3c0FrameStepTraceSummary.statesWithFieldTouches || 0),
    c3c0FrameStepTraceStatesWithConditionalControls: Number(c3c0FrameStepTraceSummary.statesWithConditionalControls || 0),
    c3c0FrameStepTraceStatesWithAllSymbolicPredicates: Number(c3c0FrameStepTraceSummary.statesWithAllSymbolicPredicates || 0),
    c3c0FrameStepTraceFieldTokenCount: Number(c3c0FrameStepTraceSummary.fieldTokenCount || 0),
    c3c0FrameStepTraceHelperRoleCount: Number(c3c0FrameStepTraceSummary.helperRoleCount || 0),
    c3c0FrameStepTracePredicateKindCount: Number(c3c0FrameStepTraceSummary.predicateKindCount || 0),
    c3c0FrameStepTraceFrameExactStateCount: Number(c3c0FrameStepTraceSummary.frameExactStateCount || 0),
    c3c0FrameStepTraceReadinessStatus: c3c0FrameStepTraceSummary.traceReadinessStatus || '',
    c3c0FrameStepTracePersistedRomByteCount: Number(c3c0FrameStepTraceSummary.persistedRomByteCount || 0),
    c3c0FrameStepTracePersistedInstructionByteCount: Number(c3c0FrameStepTraceSummary.persistedInstructionByteCount || 0),
    c3c0FrameStepTracePersistedTileByteCount: Number(c3c0FrameStepTraceSummary.persistedTileByteCount || 0),
    c3c0FrameStepTracePersistedPixelCount: Number(c3c0FrameStepTraceSummary.persistedPixelCount || 0),
    c3c0FrameStepTracePersistedCoordinateCount: Number(c3c0FrameStepTraceSummary.persistedCoordinateCount || 0),
    c3c0FrameStepTracePersistedGameplayValueCount: Number(c3c0FrameStepTraceSummary.persistedGameplayValueCount || 0),
    c3c0FrameStepStepperPreviewBacked: Boolean(c3c0FrameStepStepperPreview.catalogBacked),
    c3c0FrameStepStepperCatalogId: c3c0FrameStepStepperPreview.catalogId || '',
    c3c0FrameStepStepperCandidateEntityType: c3c0FrameStepStepperPreview.candidateEntityType || '',
    c3c0FrameStepStepperCandidateSeedLabel: c3c0FrameStepStepperPreview.candidateSeedLabel || '',
    c3c0FrameStepStepperBehaviorListSource: c3c0FrameStepStepperPreview.behaviorListSource || '',
    c3c0FrameStepStepperStateCount: Number(c3c0FrameStepStepperPreview.stateCount || 0),
    c3c0FrameStepStepperFrameCount: Number(c3c0FrameStepStepperPreview.frameCount || 0),
    c3c0FrameStepStepperTraceStepCount: Number(c3c0FrameStepStepperPreview.traceStepCount || 0),
    c3c0FrameStepStepperFieldTouchEventCount: Number(c3c0FrameStepStepperPreview.fieldTouchEventCount || 0),
    c3c0FrameStepStepperHelperStubEventCount: Number(c3c0FrameStepStepperPreview.helperStubEventCount || 0),
    c3c0FrameStepStepperConditionalEventCount: Number(c3c0FrameStepStepperPreview.conditionalEventCount || 0),
    c3c0FrameStepStepperSymbolicPredicateCount: Number(c3c0FrameStepStepperPreview.symbolicPredicateCount || 0),
    c3c0FrameStepStepperUnresolvedPredicateCount: Number(c3c0FrameStepStepperPreview.unresolvedPredicateCount || 0),
    c3c0FrameStepStepperFirstTickGuardCount: Number(c3c0FrameStepStepperPreview.firstTickGuardCount || 0),
    c3c0FrameStepStepperRuntimeValueReadCount: Number(c3c0FrameStepStepperPreview.runtimeValueReadCount || 0),
    c3c0FrameStepStepperRuntimeValueWriteCount: Number(c3c0FrameStepStepperPreview.runtimeValueWriteCount || 0),
    c3c0FrameStepStepperBranchOutcomeEvaluatedCount: Number(c3c0FrameStepStepperPreview.branchOutcomeEvaluatedCount || 0),
    c3c0FrameStepStepperHelperEffectEvaluatedCount: Number(c3c0FrameStepStepperPreview.helperEffectEvaluatedCount || 0),
    c3c0FrameStepStepperPersistedGameplayValueCount: Number(c3c0FrameStepStepperPreview.persistedGameplayValueCount || 0),
    c3c0FrameStepStepperStatus: c3c0FrameStepStepperPreview.status || '',
    c3c0FrameStepStepperAssetPolicy: c3c0FrameStepStepperPreview.assetPolicy || '',
    fixtureRuntimeDecoded: fixtureRuntime.runtimeDecoded,
    fixtureRuntimePreviewedFixtureCount: fixtureRuntime.previewedFixtureCount || 0,
    fixtureRuntimeRenderedFixtureRowCount: fixtureRuntime.renderedFixtureRowCount || 0,
    fixtureRuntimeRenderedTileCount: fixtureRuntime.renderedTileCount || 0,
    fixtureRuntimeRenderedPieceCount: fixtureRuntime.renderedPieceCount || 0,
    fixtureRuntimeLayoutPreviewedFixtureCount: fixtureRuntime.layoutPreviewedFixtureCount || 0,
    fixtureRuntimeCoordinateMode: fixtureRuntime.coordinateMode || '',
    fixtureRuntimeEmptyFixtureCount: fixtureRuntime.emptyFixtureCount || 0,
    fixtureRuntimeUnresolvedTileRefCount: fixtureRuntime.unresolvedTileRefCount || 0,
    fixtureRuntimeSkippedFixtureCount: fixtureRuntime.skippedFixtureCount || 0,
    fixtureRuntimeWarningCount: fixtureRuntime.warningCount || 0,
    fixtureRuntimeParseIssueCount: fixtureRuntime.parseIssueCount || 0,
    fixtureRuntimePersistedTileByteCount: 0,
    fixtureRuntimePersistedPixelCount: 0,
    fixtureRuntimePersistedCoordinateCount: 0,
    persistedTileByteCount: 0,
    persistedPixelCount: 0,
    persistedCoordinateCount: 0,
    assetPolicy,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  PLAYER STATE GRAPH PREVIEW
// ═══════════════════════════════════════════════════════════════════════════

function playerStateGraphCatalog() {
  return (mapData.playerCatalogs || []).find(c =>
    c.id === 'world-player-engine-state-graph-catalog-2026-06-25'
  ) || null;
}

function playerStateGraphClearPreviewDataset(out) {
  if (!out) return;
  for (const key of Object.keys(out.dataset)) {
    if (key.startsWith('playerStateGraph')) delete out.dataset[key];
  }
}

function playerStateGraphStateText(node) {
  if (!node) return '?';
  if (node.stateSlot != null) return `$${Number(node.stateSlot).toString(16).toUpperCase().padStart(2, '0')}`;
  const match = String(node.id || '').match(/vector_substate_(\d+)/);
  return match ? `C271:${match[1]}` : 'sub';
}

function playerStateGraphDriversText(node) {
  const parts = [];
  if (node?.inputDriven) parts.push(`input:${node.inputReadCount || 0}`);
  if (node?.contactDriven) parts.push(`contact:${node.contactReadCount || 0}`);
  if (node?.environmentFlagDriven) parts.push(`env:${node.environmentFlagReadCount || 0}`);
  return parts.join(' ') || 'none';
}

function playerStateGraphNodeSortValue(node) {
  if (node?.stateSlot != null) return Number(node.stateSlot);
  const match = String(node?.id || '').match(/vector_substate_(\d+)/);
  return match ? 0x100 + Number(match[1]) : 0x200;
}

function playerStateGraphNodeTable(nodes) {
  const rows = (nodes || []).slice()
    .sort((a, b) => playerStateGraphNodeSortValue(a) - playerStateGraphNodeSortValue(b) || String(a.id || '').localeCompare(String(b.id || '')))
    .slice(0, 32)
    .map(node => {
      const physics = (node.physicsCategories || []).join(' ');
      const transitions = (node.transitionTargets || []).join(' ');
      return `
        <tr>
          <td style="padding:2px 6px;color:#cbd5e1">${simEscapeHtml(playerStateGraphStateText(node))}</td>
          <td style="padding:2px 6px;color:#94a3b8">${simEscapeHtml(node.id || '?')}</td>
          <td style="padding:2px 6px">${simEscapeHtml(node.mechanicGroup || '?')}</td>
          <td style="padding:2px 6px;color:#fbbf24">${simEscapeHtml(node.primaryLabel || '')}</td>
          <td style="padding:2px 6px;color:#93c5fd">${simEscapeHtml(transitions || 'none')}</td>
          <td style="padding:2px 6px;color:#4ade80">${simEscapeHtml(physics || 'none')}</td>
          <td style="padding:2px 6px">${simEscapeHtml(playerStateGraphDriversText(node))}</td>
        </tr>
      `;
    }).join('');
  const more = (nodes || []).length > 32
    ? `<div style="color:#777;margin-top:3px">... +${(nodes || []).length - 32} more node(s)</div>`
    : '';
  return `
    <div style="color:#93c5fd;font-weight:bold;margin:0 0 3px">State and substate nodes</div>
    <table style="border-collapse:collapse;margin-bottom:4px">
      <thead>
        <tr style="color:#888">
          <th style="text-align:left;padding:2px 6px">state</th>
          <th style="text-align:left;padding:2px 6px">flow</th>
          <th style="text-align:left;padding:2px 6px">group</th>
          <th style="text-align:left;padding:2px 6px">primary</th>
          <th style="text-align:left;padding:2px 6px">transitions</th>
          <th style="text-align:left;padding:2px 6px">physics</th>
          <th style="text-align:left;padding:2px 6px">drivers</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="7" style="padding:2px 6px;color:#888">No player state graph nodes</td></tr>'}</tbody>
    </table>
    ${more}
  `;
}

function playerStateGraphAmbiguousEdgeTable(edges) {
  const ambiguous = (edges || []).filter(edge => (edge.possibleTargetFlowIds || []).length > 1);
  const rows = ambiguous.slice(0, 20).map(edge => `
    <tr>
      <td style="padding:2px 6px;color:#94a3b8">${simEscapeHtml(edge.fromFlowId || '?')}</td>
      <td style="padding:2px 6px;color:#cbd5e1">${simEscapeHtml(edge.targetValue || '?')}</td>
      <td style="padding:2px 6px">${simEscapeHtml(String(edge.targetStateSlot ?? '?'))}</td>
      <td style="padding:2px 6px;color:#fbbf24">${simEscapeHtml((edge.possibleTargetFlowIds || []).join(' '))}</td>
      <td style="padding:2px 6px;color:#4ade80">${simEscapeHtml(edge.confidence || '?')}</td>
    </tr>
  `).join('');
  const more = ambiguous.length > 20
    ? `<div style="color:#777;margin-top:3px">... +${ambiguous.length - 20} more ambiguous edge(s)</div>`
    : '';
  return `
    <div style="color:#93c5fd;font-weight:bold;margin:8px 0 3px">Ambiguous state-slot targets</div>
    <table style="border-collapse:collapse">
      <thead>
        <tr style="color:#888">
          <th style="text-align:left;padding:2px 6px">from</th>
          <th style="text-align:left;padding:2px 6px">value</th>
          <th style="text-align:left;padding:2px 6px">slot</th>
          <th style="text-align:left;padding:2px 6px">possible flows</th>
          <th style="text-align:left;padding:2px 6px">confidence</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="5" style="padding:2px 6px;color:#888">No ambiguous edges</td></tr>'}</tbody>
    </table>
    ${more}
  `;
}

function playerStateGraphCountsHtml(summary) {
  const mechanics = Object.entries(summary.mechanicGroupCounts || {})
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    .map(([key, value]) => `${key}:${value}`)
    .join(' ');
  const physics = Object.entries(summary.physicsCategoryNodeCounts || {})
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    .map(([key, value]) => `${key}:${value}`)
    .join(' ');
  return `
    <div style="color:#888;margin-bottom:6px">
      Mechanics ${simEscapeHtml(mechanics || 'none')}<br>
      Physics ${simEscapeHtml(physics || 'none')}
    </div>
  `;
}

function playerStateGraphRenderPreview() {
  const out = document.getElementById('player-state-graph-preview');
  const info = document.getElementById('player-state-graph-info');
  if (!out) return null;
  playerStateGraphClearPreviewDataset(out);

  const catalog = playerStateGraphCatalog();
  const summary = catalog?.summary || {};
  const model = catalog?.transitionModel || {};
  const warnings = [];
  if (!catalog) warnings.push('Player state graph catalog is missing.');
  if (catalog && !(Number(summary.nodeCount || 0) >= 18)) warnings.push(`Expected at least 18 state graph nodes, got ${summary.nodeCount || 0}.`);
  if (catalog && !(Number(summary.transitionEdgeCount || 0) >= 55)) warnings.push(`Expected at least 55 transition edges, got ${summary.transitionEdgeCount || 0}.`);
  if (catalog && Number(summary.vectorSubstateNodeCount || 0) < 4) warnings.push('Vector substate graph is incomplete.');

  const nodeCount = Number(summary.nodeCount || (catalog?.nodes || []).length || 0);
  const innerStateNodeCount = Number(summary.innerStateNodeCount || 0);
  const vectorSubstateNodeCount = Number(summary.vectorSubstateNodeCount || 0);
  const transitionEdgeCount = Number(summary.transitionEdgeCount || (catalog?.edges || []).length || 0);
  const uniqueTransitionTargetCount = Number(summary.uniqueTransitionTargetCount || 0);
  const ambiguousTargetEdgeCount = Number(summary.ambiguousTargetEdgeCount || 0);
  const inputDrivenNodeCount = Number(summary.inputDrivenNodeCount || 0);
  const contactDrivenNodeCount = Number(summary.contactDrivenNodeCount || 0);
  const environmentFlagDrivenNodeCount = Number(summary.environmentFlagDrivenNodeCount || 0);
  const assetPolicy = 'metadata_only_no_rom_bytes_or_gameplay_tables';

  out.dataset.playerStateGraphCatalogBacked = catalog ? '1' : '0';
  out.dataset.playerStateGraphCatalogId = catalog?.id || '';
  out.dataset.playerStateGraphPreviewOk = warnings.length ? '0' : '1';
  out.dataset.playerStateGraphNodeCount = String(nodeCount);
  out.dataset.playerStateGraphInnerStateNodeCount = String(innerStateNodeCount);
  out.dataset.playerStateGraphVectorSubstateNodeCount = String(vectorSubstateNodeCount);
  out.dataset.playerStateGraphTransitionEdgeCount = String(transitionEdgeCount);
  out.dataset.playerStateGraphUniqueTransitionTargetCount = String(uniqueTransitionTargetCount);
  out.dataset.playerStateGraphAmbiguousTargetEdgeCount = String(ambiguousTargetEdgeCount);
  out.dataset.playerStateGraphInputDrivenNodeCount = String(inputDrivenNodeCount);
  out.dataset.playerStateGraphContactDrivenNodeCount = String(contactDrivenNodeCount);
  out.dataset.playerStateGraphEnvironmentFlagDrivenNodeCount = String(environmentFlagDrivenNodeCount);
  out.dataset.playerStateGraphPersistedGameplayValueCount = '0';
  out.dataset.playerStateGraphAssetPolicy = assetPolicy;

  if (info) {
    info.textContent = warnings.length
      ? `${warnings.length} warning(s)`
      : `${nodeCount} node(s) · ${transitionEdgeCount} edge(s) · ${ambiguousTargetEdgeCount} ambiguous target(s)`;
  }

  if (warnings.length) {
    out.innerHTML = warnings.map(warning =>
      `<div style="color:#f87171">${simEscapeHtml(warning)}</div>`
    ).join('');
  } else {
    out.innerHTML = `
      <div style="color:#888;margin-bottom:6px">
        Catalog ${simEscapeHtml(catalog.id)} · ${simEscapeHtml(model.stateRegister || '_RAM_C260_')} ${simEscapeHtml(model.stateRegisterAddress || '$C260')} · vector ${simEscapeHtml(model.vectorSubstateRegister || '_RAM_C271_')} · gameplay tables omitted
      </div>
      ${playerStateGraphCountsHtml(summary)}
      ${playerStateGraphNodeTable(catalog.nodes || [])}
      ${playerStateGraphAmbiguousEdgeTable(catalog.edges || [])}
    `;
  }

  return {
    catalogBacked: Boolean(catalog),
    catalogId: catalog?.id || '',
    previewOk: warnings.length === 0,
    nodeCount,
    innerStateNodeCount,
    vectorSubstateNodeCount,
    transitionEdgeCount,
    uniqueTransitionTargetCount,
    ambiguousTargetEdgeCount,
    inputDrivenNodeCount,
    contactDrivenNodeCount,
    environmentFlagDrivenNodeCount,
    persistedGameplayValueCount: 0,
    assetPolicy,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  ZONE BROWSER
// ═══════════════════════════════════════════════════════════════════════════

let _zoneParsed = null; // parsed descriptor + sub-record data

function zoneRecipeOffset(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  return parseHex(value);
}

function zoneAllRecipes() {
  return [
    ...(mapData.zoneRecipes || []),
    ...(mapData.inlineTransitionRecipes || []),
  ];
}

function zoneRecipeForDescriptor(descOff) {
  return zoneAllRecipes().find(recipe =>
    zoneRecipeOffset(recipe.descriptor?.romOffset) === descOff
  ) || null;
}

function zoneRecipeLabel(recipe) {
  const descOff = zoneRecipeOffset(recipe.descriptor?.romOffset);
  const loaderOff = zoneRecipeOffset(recipe.dependencies?.vramLoader8fb?.romOffset);
  const extra998 = recipe.dependencies?.extra998 || {};
  const audio = recipe.dependencies?.audioRequest || {};
  const extra = extra998.status === 'required'
    ? ` · 998 ${extra998.regionId || extra998.sourceLabel || 'required'}`
    : '';
  const pal = recipe.subrecord?.bgPaletteIndex ?? recipe.subrecord?.paletteIndex ?? '?';
  const audioId = audio.requestIdHex || (typeof audio.requestId === 'number' ? '0x' + audio.requestId.toString(16).toUpperCase().padStart(2,'0') : '?');
  const audioKind = audio.taxonomy?.classification?.kind ? ` · ${audio.taxonomy.classification.kind}` : '';
  const typePrefix = recipe.recipeType === 'inline_transition_room_zone_render' ? 'inline · ' : '';
  const branch = recipe.sourceTriggerRecord?.branch ? ` · ${recipe.sourceTriggerRecord.branch}` : '';
  return `${typePrefix}${descOff == null ? '?????' : '0x' + descOff.toString(16).toUpperCase().padStart(5,'0')}${branch} · pal ${pal} · audio ${audioId}${audioKind} · 8FB ${loaderOff == null ? '?' : '0x' + loaderOff.toString(16).toUpperCase().padStart(5,'0')}${extra}`;
}

function zoneBrowserRenderRecipePicker() {
  const sel = document.getElementById('zone-recipe-sel');
  const countEl = document.getElementById('zone-recipe-count');
  if (!sel) return;
  const recipes = zoneAllRecipes();
  const previous = sel.value;
  sel.innerHTML = '<option value="">— descriptor offset —</option>' + recipes.map(recipe =>
    `<option value="${simEscapeHtml(recipe.id || '')}">${simEscapeHtml(zoneRecipeLabel(recipe))}</option>`
  ).join('');
  if (previous && recipes.some(recipe => recipe.id === previous)) sel.value = previous;
  if (countEl) {
    const graphCount = (mapData.zoneRecipes || []).length;
    const inlineCount = (mapData.inlineTransitionRecipes || []).length;
    countEl.textContent = recipes.length ? `${graphCount} zone recipes · ${inlineCount} inline transition recipes` : 'No zone recipes loaded';
  }
  const selected = zoneBrowserSelectedRecipe(sel.value || '');
  zoneAudioSetRecipe(selected, selected?.dependencies?.audioRequest?.requestId);
}

function zoneBrowserSelectedRecipe(recipeId) {
  if (!recipeId) return null;
  return zoneAllRecipes().find(recipe => recipe.id === recipeId) || null;
}

function zoneEntrySeedCatalog() {
  return (mapData.sceneRecipeCatalogs || []).find(c =>
    c.id === 'world-sprite-palette-entry-scene-catalog-2026-06-25'
  ) || null;
}

function zoneEntrySeedRecipes() {
  const catalog = zoneEntrySeedCatalog();
  return Array.isArray(catalog?.entryRecipes) ? catalog.entryRecipes : [];
}

function zoneEntrySeedLabel(seed) {
  const caller = seed?.caller?.label || 'entry';
  const spriteIndex = seed?.stateEffects?.spritePalette?.index;
  const loadSteps = (seed?.steps || []).filter(step => step.kind === 'vram_loader_8fb' || step.kind === 'vram_loader_998');
  const loads = loadSteps.map(step => step.sourceLabel || step.region?.id || step.kind).join(' + ');
  return `${caller} · SPR ${spriteIndex == null ? '?' : spriteIndex} · ${loads || 'no loaders'}`;
}

function zoneBrowserRenderEntrySeedPicker() {
  const sel = document.getElementById('zone-entry-seed-sel');
  const countEl = document.getElementById('zone-entry-seed-count');
  if (!sel) return;
  const seeds = zoneEntrySeedRecipes();
  const previous = sel.value;
  sel.innerHTML = '<option value="">— none —</option>' + seeds.map(seed =>
    `<option value="${simEscapeHtml(seed.id || '')}">${simEscapeHtml(zoneEntrySeedLabel(seed))}</option>`
  ).join('');
  if (previous && seeds.some(seed => seed.id === previous)) sel.value = previous;
  if (countEl) {
    countEl.textContent = seeds.length
      ? `${seeds.length} metadata seed(s), optional`
      : 'No entry seed metadata';
  }
}

function zoneBrowserSelectedEntrySeed(seedId) {
  if (!seedId) return null;
  return zoneEntrySeedRecipes().find(seed => seed.id === seedId) || null;
}

function zoneCommonPrereqCatalog() {
  return (mapData.roomDataCatalogs || []).find(c =>
    c.id === 'world-zone-common-prereq-provenance-catalog-2026-06-25'
  ) || null;
}

function zoneCommonPrereqSteps() {
  const catalog = zoneCommonPrereqCatalog();
  if (!catalog || catalog.renderModel?.dependencyStatus !== 'simulation_only') return [];
  return Array.isArray(catalog.prerequisiteSteps) ? catalog.prerequisiteSteps : [];
}

function zonePaletteTableCatalog() {
  return (mapData.paletteCatalogs || []).find(c =>
    c.id === 'world-palette-table-catalog-2026-06-24'
  ) || null;
}

function zoneSpritePaletteInheritanceCatalog() {
  return (mapData.paletteCatalogs || []).find(c =>
    c.id === 'world-sprite-palette-inheritance-catalog-2026-06-25'
  ) || null;
}

function zoneSpritePaletteWriterCatalog() {
  return (mapData.paletteCatalogs || []).find(c =>
    c.id === 'world-sprite-palette-writer-catalog-2026-06-25'
  ) || null;
}

function zoneEntrySeedWriter(seed) {
  const catalog = zoneSpritePaletteWriterCatalog();
  if (!catalog || !seed) return null;
  const caller = seed.caller?.label || '';
  const paletteStep = (seed.steps || []).find(step => step.kind === 'palette_state_write');
  const callLine = paletteStep?.callLine || seed.caller?.line || null;
  return (catalog.writerCallsites || []).find(writer =>
    writer.caller?.label === caller &&
    (callLine == null || Number(writer.caller?.line || 0) === Number(callLine))
  ) || null;
}

function zonePaletteRecordForIndex(index) {
  const catalog = zonePaletteTableCatalog();
  if (!catalog || index == null) return null;
  return (catalog.records || []).find(record => record.index === index) || null;
}

function zoneBrowserApplyPalette(state, recipe, parsedPaletteIndex) {
  const index = recipe?.dependencies?.palette?.index ?? parsedPaletteIndex;
  const result = {
    applied: false,
    index: index ?? null,
    regionId: '',
    regionName: '',
    romOffset: '',
    nonBlackColorCount: 0,
    warnings: [],
  };
  if (index == null) {
    result.warnings.push('missing palette index');
    return result;
  }
  const record = zonePaletteRecordForIndex(index);
  if (!record) {
    result.warnings.push(`palette record ${index} not found`);
    return result;
  }
  const off = zoneRecipeOffset(record.offset);
  if (off == null || off < 0 || off + 15 >= romData.length) {
    result.warnings.push(`palette record ${index} offset out of range`);
    return result;
  }
  simLoadCRAM(romData, off, 16, 0, state);
  result.applied = true;
  result.regionId = record.region?.id || '';
  result.regionName = record.region?.name || '';
  result.romOffset = record.offset || '';
  result.nonBlackColorCount = state.cram.slice(0, 16).filter(color => color && color !== '#000000').length;
  return result;
}

function zoneBrowserSpritePaletteStatus(recipe) {
  const sprite = recipe?.dependencies?.palette?.spritePalette || null;
  if (sprite?.status === 'preserve_existing') {
    const inheritance = sprite.inheritance || null;
    const catalog = inheritance?.catalogId ? zoneSpritePaletteInheritanceCatalog() : null;
    const stateRam = inheritance?.stateRam || catalog?.stateModel?.spritePaletteRam || '_RAM_CFF6_';
    const ownerStatus = inheritance?.ownerStatus || catalog?.recipeInheritanceModel?.ownerStatus || 'runtime_prior_state';
    const ownerLabel = ownerStatus.replace(/_/g, ' ');
    const pathClassCounts = catalog?.summary?.runtimePriorPathClassCounts || {};
    const runtimePathClassCount = Object.keys(pathClassCounts).length;
    return {
      status: 'preserve_existing',
      label: `SPR palette preserved from ${stateRam} (${ownerLabel})`,
      source: sprite.source || 'H=$FF before _LABEL_8B2_',
      inheritanceCatalogId: inheritance?.catalogId || catalog?.id || '',
      inheritanceOwnerStatus: ownerStatus,
      inheritanceStateRam: stateRam,
      inheritanceCatalogBacked: Boolean(inheritance?.catalogId && catalog),
      inheritanceRuntimePathClassCount: runtimePathClassCount,
      inheritanceClassifiedRuntimePriorCallsiteCount: catalog?.summary?.classifiedRuntimePriorStateRoomLoadCallsiteCount || 0,
      inheritancePointerFlowBackedRuntimePriorCallsiteCount: catalog?.summary?.pointerFlowBackedRuntimePriorCallsiteCount || 0,
    };
  }
  return {
    status: recipe ? 'unresolved' : 'no_recipe',
    label: recipe ? 'SPR palette unresolved' : 'SPR palette needs recipe metadata',
    source: '',
    inheritanceCatalogId: '',
    inheritanceOwnerStatus: '',
    inheritanceStateRam: '',
    inheritanceCatalogBacked: false,
    inheritanceRuntimePathClassCount: 0,
    inheritanceClassifiedRuntimePriorCallsiteCount: 0,
    inheritancePointerFlowBackedRuntimePriorCallsiteCount: 0,
  };
}

function zoneCommonPrereqSummaryHtml(recipe) {
  const sim = recipe?.commonPrereqRenderSimulation || null;
  const steps = zoneCommonPrereqSteps();
  if (!sim && !steps.length) return '';
  const stepText = steps.length
    ? steps.map(step => `${simEscapeHtml(step.label || step.region?.id || '?')} ${simEscapeHtml(step.loaderType || '')}`).join(' → ')
    : 'metadata missing';
  const before = sim?.baselineUnresolvedSlotCount ?? '?';
  const after = sim?.simulatedUnresolvedSlotCount ?? '?';
  const resolved = sim?.resolvedByCommonPrereqSlotCount ?? '?';
  const slots = (sim?.resolvedByCommonPrereqSlots || []).slice(0, 12).join(' ');
  return `
      <div style="grid-column:1/-1;color:#9ae6b4">
        <span style="color:var(--dim)">Common prereq simulation:</span>
        ${simEscapeHtml(String(before))} unresolved → ${simEscapeHtml(String(after))}
        · resolved ${simEscapeHtml(String(resolved))} slot(s)
        ${slots ? `· ${simEscapeHtml(slots)}` : ''}
      </div>
      <div style="grid-column:1/-1;color:var(--dim)">
        Standalone render preload (simulation-only): ${stepText}
      </div>`;
}

function zoneAudioRequestTaxonomyCatalog() {
  const catalogs = mapData.audioRequestTaxonomyCatalogs || [];
  return catalogs.find(c => c.id === 'world-audio-request-taxonomy-catalog-2026-06-25') || catalogs[0] || null;
}

function zoneAudioRequestTaxonomy(requestId) {
  if (requestId == null) return null;
  const catalog = zoneAudioRequestTaxonomyCatalog();
  if (!catalog || !Array.isArray(catalog.requests)) return null;
  return catalog.requests.find(req => req.requestId === requestId) || null;
}

function zoneRecipeAudioDiagnostic(recipe, parsedAudioRequestId) {
  const audio = recipe?.dependencies?.audioRequest || null;
  const requestId = audio?.requestId ?? parsedAudioRequestId;
  const taxonomy = zoneAudioRequestTaxonomy(requestId) || audio?.taxonomy || null;
  const usage = taxonomy?.roomRecipeUsage || audio?.taxonomy?.roomRecipeUsage || null;
  return {
    requestId,
    requestIdHex: taxonomy?.requestIdHex || audio?.requestIdHex ||
      (typeof requestId === 'number' ? _fmt2(requestId) : '?'),
    classification: taxonomy?.classification?.kind || audio?.taxonomy?.classification?.kind || '',
    confidence: taxonomy?.classification?.confidence || audio?.taxonomy?.classification?.confidence || '',
    headerOffset: taxonomy?.headerOffset || audio?.taxonomy?.headerOffset || '',
    usage,
    streamGraph: audio?.streamGraph || null,
  };
}

function zoneRecipeAudioGraphText(streamGraph) {
  if (!streamGraph) return '';
  const parts = [];
  if (streamGraph.graphId) parts.push(streamGraph.graphId);
  if (streamGraph.reachableStreamCount != null) parts.push(`${streamGraph.reachableStreamCount} stream(s)`);
  if (streamGraph.branchEdgeCount != null) parts.push(`${streamGraph.branchEdgeCount} branch edge(s)`);
  const f6 = streamGraph.immediatePointerCallEdgeCount;
  const fa = streamGraph.jumpPointerEdgeCount;
  if (f6 != null || fa != null) parts.push(`F6 ${f6 ?? 0} / FA ${fa ?? 0}`);
  if (streamGraph.maxBranchDepth != null) parts.push(`depth ${streamGraph.maxBranchDepth}`);
  if (streamGraph.missingTargetCount) parts.push(`${streamGraph.missingTargetCount} missing target(s)`);
  return parts.join(' · ');
}

function zoneRecipeAudioInfoLine(recipe, parsedAudioRequestId) {
  const audio = zoneRecipeAudioDiagnostic(recipe, parsedAudioRequestId);
  const graphText = zoneRecipeAudioGraphText(audio.streamGraph);
  if (!audio.requestIdHex && !graphText) return '';
  return `audio ${audio.requestIdHex || '?'}${audio.classification ? ` ${audio.classification}` : ''}${graphText ? ` · graph ${graphText}` : ''}`;
}

function zoneRoomEventKeySemanticsCatalog() {
  return (mapData.roomDataCatalogs || []).find(c =>
    c.id === 'world-room-event-key-semantics-catalog-2026-06-26'
  ) || null;
}

function zoneCountMapSummary(counts, limit = 4) {
  const entries = Object.entries(counts || {}).filter(([, count]) => Number(count) > 0);
  if (!entries.length) return '';
  const shown = entries.slice(0, limit).map(([key, count]) => `${key} ${count}`);
  const extra = entries.length > shown.length ? ` +${entries.length - shown.length}` : '';
  return shown.join(' · ') + extra;
}

function zoneRoomEventKeyModelText(catalog) {
  const formulas = catalog?.formulas || [];
  const x = formulas.find(item => item.id === 'event_table_key_x');
  const y = formulas.find(item => item.id === 'event_table_key_y');
  if (!x && !y) return '';
  const parts = [];
  if (x?.meaning) parts.push(`byte0 ${x.meaning}`);
  if (y?.meaning) parts.push(`byte1 ${y.meaning}`);
  return parts.join(' · ');
}

function zoneRecipeEventTableDiagnostic(recipe) {
  const table = recipe?.dependencies?.roomEventTable || null;
  const decoded = table?.decoded || null;
  const selectorStats = decoded?.knownD025ValueStats || null;
  const keyCatalog = zoneRoomEventKeySemanticsCatalog();
  return {
    status: table?.status || '',
    romOffset: table?.romOffset || '',
    z80Pointer: table?.z80Pointer || '',
    regionId: table?.region?.id || '',
    hasRecords: Boolean(table?.hasRecords),
    recordCount: Number(decoded?.recordCount || 0),
    byteLength: Number(decoded?.byteLength || 0),
    warningCount: Number(decoded?.warningCount || 0),
    recordKindText: zoneCountMapSummary(decoded?.recordKindCounts || {}),
    selectorOutcomeText: zoneCountMapSummary(decoded?.selectorOutcomeCounts || {}, 3),
    acceptedSelectorCount: Number(selectorStats?.selectorAcceptedAfterMaskCount || 0),
    rejectedSelectorCount: Number(selectorStats?.selectorRejectedAfterMaskCount || 0),
    keySemanticsCatalogId: keyCatalog?.id || '',
    keyModelText: zoneRoomEventKeyModelText(keyCatalog),
  };
}

function zoneAudioStreamGraphCatalog() {
  return (mapData.audioCatalogs || []).find(c =>
    c.id === 'world-audio-stream-graph-catalog-2026-06-25'
  ) || null;
}

function zoneAudioOpcodeEffectCatalog() {
  return (mapData.audioCatalogs || []).find(c =>
    c.id === 'world-audio-opcode-state-effect-catalog-2026-06-25'
  ) || null;
}

function zoneAudioRamStateCatalog() {
  return (mapData.audioCatalogs || []).find(c =>
    c.id === 'world-audio-ram-state-catalog-2026-06-25'
  ) || null;
}

function zoneAudioEventRamLinkCatalog() {
  return (mapData.audioCatalogs || []).find(c =>
    c.id === 'world-audio-event-ram-link-catalog-2026-06-25'
  ) || null;
}

function zoneAudioOutputRegisterCatalog() {
  return (mapData.audioCatalogs || []).find(c =>
    c.id === 'world-audio-output-register-catalog-2026-06-25'
  ) || null;
}

function zoneAudioRuntimeGlobalFlowCatalog() {
  return (mapData.audioCatalogs || []).find(c =>
    c.id === 'world-audio-runtime-global-flow-catalog-2026-06-25'
  ) || null;
}

function zoneAudioRuntimeGlobalFlowForRole(role) {
  const catalog = zoneAudioRuntimeGlobalFlowCatalog();
  const flow = (catalog?.globalFlows || []).find(item => item.role === role) || null;
  return flow ? { ...flow, catalogId: catalog.id } : null;
}

function zoneAudioOutputModeBranchCatalog() {
  return (mapData.audioCatalogs || []).find(c =>
    c.id === 'world-audio-output-mode-branch-catalog-2026-06-25'
  ) || null;
}

function zoneAudioOutputModeBranchForPhase(phaseId) {
  const catalog = zoneAudioOutputModeBranchCatalog();
  const candidate = (catalog?.phaseBranchCandidates || [])
    .find(item => item.phaseId === phaseId) || null;
  return candidate ? { ...candidate, catalogId: catalog.id } : null;
}

function zoneAudioStreamParameterConsumerCatalog() {
  return (mapData.audioCatalogs || []).find(c =>
    c.id === 'world-audio-stream-parameter-consumer-catalog-2026-06-25'
  ) || null;
}

function zoneAudioEventOutputPhaseLinkCatalog() {
  return (mapData.audioCatalogs || []).find(c =>
    c.id === 'world-audio-event-output-phase-link-catalog-2026-06-25'
  ) || null;
}

function zoneAudioEventTraceSemanticsCatalog() {
  return (mapData.audioCatalogs || []).find(c =>
    c.id === 'world-audio-event-trace-semantics-catalog-2026-06-25'
  ) || null;
}

function zoneAudioTraceModelCatalog() {
  return (mapData.audioCatalogs || []).find(c =>
    c.id === 'world-audio-trace-model-catalog-2026-06-25'
  ) || null;
}

function zoneAudioTraceModelRule(kind) {
  const catalog = zoneAudioTraceModelCatalog();
  return (catalog?.applicationRules || []).find(rule => rule.operationKind === kind) || null;
}

function zoneAudioSupportTableCatalog() {
  return (mapData.audioCatalogs || []).find(c =>
    c.id === 'world-audio-support-table-catalog-2026-06-25'
  ) || null;
}

function zoneAudioSupportTableUseCatalog() {
  return (mapData.audioCatalogs || []).find(c =>
    c.id === 'world-audio-support-table-use-catalog-2026-06-25'
  ) || null;
}

function zoneAudioNoteTimingSupportCatalog() {
  return (mapData.audioCatalogs || []).find(c =>
    c.id === 'world-audio-note-timing-support-catalog-2026-06-25'
  ) || null;
}

function zoneAudioFrameGateCatalog() {
  return (mapData.audioCatalogs || []).find(c =>
    c.id === 'world-audio-frame-gate-catalog-2026-06-25'
  ) || null;
}

function zoneAudioStreamSeedCatalog() {
  return (mapData.audioCatalogs || []).find(c =>
    c.id === 'world-audio-stream-seed-catalog-2026-06-25'
  ) || null;
}

function zoneAudioSupportLookup(lookupId, index) {
  const catalog = zoneAudioSupportTableCatalog();
  const table = (catalog?.supportTables || []).find(item => item.lookupId === lookupId || item.id === lookupId);
  if (!table) return null;
  const min = table.handlerAddressableIndexRange?.min ?? table.indexRange?.min ?? 0;
  const max = table.handlerAddressableIndexRange?.max ?? table.indexRange?.max ?? -1;
  const romBase = zoneRecipeOffset(table.romOffset);
  const z80Base = zoneAudioParseRamAddress(table.z80Address);
  const result = {
    lookupId,
    tableId: table.id || '',
    status: 'unresolved',
    index,
    indexHex: Number.isInteger(index) ? _fmt2(index) : '',
    romOffset: null,
    romOffsetHex: '',
    z80Address: null,
    z80AddressHex: '',
    value: null,
    valueHex: '',
  };
  if (!Number.isInteger(index)) {
    result.status = 'missing-index';
    return result;
  }
  if (index < min || index > max) {
    result.status = 'out-of-range';
    return result;
  }
  if (romBase == null) {
    result.status = 'missing-table-offset';
    return result;
  }
  result.romOffset = romBase + index;
  result.romOffsetHex = _fmt5(result.romOffset);
  if (z80Base != null) {
    result.z80Address = z80Base + index;
    result.z80AddressHex = _fmt4(result.z80Address);
  }
  if (!romData || result.romOffset < 0 || result.romOffset >= romData.length) {
    result.status = 'needs-rom';
    return result;
  }
  result.value = romData[result.romOffset];
  result.valueHex = _fmt2(result.value);
  result.status = 'resolved';
  return result;
}

function zoneAudioLookupValueText(lookup) {
  if (!lookup) return '';
  if (lookup.status === 'resolved') return `=${lookup.valueHex}@${lookup.romOffsetHex}`;
  if (lookup.status === 'out-of-range') return `=${lookup.indexHex || 'index?'} out-of-range`;
  if (lookup.status === 'needs-rom') return `=${lookup.indexHex || 'index?'} needs ROM`;
  return '';
}

function zoneAudioSupportTableUseSummaryHtml() {
  const catalog = zoneAudioSupportTableUseCatalog();
  const summary = catalog?.summary;
  if (!summary) return '';
  const parts = [
    `unique $F5 ${summary.uniqueStreamF5EventCount ?? 0}`,
    `valid ${summary.validF5EventCount ?? 0}`,
    `prefix ${summary.embeddedPrefixF5EventCount ?? 0}`,
    `prefix escapes ${summary.prefixEscapeF5EventCount ?? 0}`,
    `out-of-window ${summary.outOfRangeF5EventCount ?? 0}`,
  ];
  return `<div style="padding-left:10px;color:#888">support lookup use ${simEscapeHtml(parts.join(' · '))}</div>`;
}

function zoneAudioNoteTimingSummaryHtml() {
  const catalog = zoneAudioNoteTimingSupportCatalog();
  const summary = catalog?.summary;
  if (!summary) return '';
  const parts = [
    `table ${summary.timingTableBytes || 0} bytes`,
    `${summary.supportTransformCaseCount || 0} transforms`,
    `${summary.outputFieldCount || 0} fields`,
  ];
  return `<div style="padding-left:10px;color:#888">high-bit note timing ${simEscapeHtml(parts.join(' · '))}</div>`;
}

function zoneAudioFrameGateSummaryHtml() {
  const catalog = zoneAudioFrameGateCatalog();
  const summary = catalog?.summary;
  if (!summary) return '';
  const parts = [
    `${summary.gateCount || 0} gates`,
    `delay ${summary.delayGateCount || 0}`,
    `reset clears ${summary.resetClearedFieldCount || 0}`,
  ];
  return `<div style="padding-left:10px;color:#888">frame gate ${simEscapeHtml(parts.join(' · '))}</div>`;
}

function zoneAudioStreamSeedSummaryHtml() {
  const catalog = zoneAudioStreamSeedCatalog();
  const summary = catalog?.summary;
  if (!summary) return '';
  const parts = [
    `${summary.requestSeedCount || 0} requests`,
    `${summary.headerChannelSeedCount || 0} channel seeds`,
    `${(summary.distinctPriorityValues || []).length} priority values`,
  ];
  return `<div style="padding-left:10px;color:#888">stream seed ${simEscapeHtml(parts.join(' · '))}</div>`;
}

function zoneAudioOpcodeInfo(opcodeByte) {
  const opcode = '$' + opcodeByte.toString(16).toUpperCase().padStart(2, '0');
  const catalog = zoneAudioOpcodeEffectCatalog();
  const entry = (catalog?.opcodes || []).find(item => item.opcode === opcode);
  if (entry) return entry;
  const fallback = {
    0xF0: ['instrument_or_effect_select', 1, 'continue'],
    0xF1: ['stream_parameter_pair_store', 2, 'continue'],
    0xF2: ['stream_parameter_pair_add', 2, 'continue'],
    0xF3: ['stream_parameter_store', 1, 'continue'],
    0xF4: ['stream_parameter_add_or_clamp', 1, 'continue'],
    0xF5: ['indexed_support_table_load', 1, 'continue'],
    0xF6: ['call_stream_pointer', 2, 'enqueue_target_and_continue'],
    0xF7: ['shared_repeat_or_end_handler', 0, 'continue'],
    0xF8: ['repeat_counter_setup', 1, 'continue'],
    0xF9: ['repeat_or_loop_end', 0, 'stop_segment'],
    0xFA: ['jump_stream_pointer', 2, 'branch_and_stop_segment'],
    0xFB: ['shared_repeat_or_end_handler', 0, 'continue'],
    0xFC: ['shared_repeat_or_end_handler', 0, 'continue'],
    0xFD: ['shared_repeat_or_end_handler', 0, 'continue'],
    0xFE: ['shared_repeat_or_end_handler', 0, 'continue'],
    0xFF: ['stream_end_or_shared_repeat_handler', 0, 'stop_segment'],
  }[opcodeByte];
  if (!fallback) return { opcode, name: 'unknown_control_opcode', argBytes: 0, metadataParserAction: 'continue' };
  return { opcode, name: fallback[0], argBytes: fallback[1], metadataParserAction: fallback[2] };
}

function zoneAudioParseRamAddress(value) {
  if (typeof value === 'number') return value;
  const match = String(value || '').match(/^(?:0x|\$)?([0-9a-f]+)$/i);
  return match ? parseInt(match[1], 16) : null;
}

function zoneAudioRamFieldByName(fields, name) {
  return (fields || []).find(field => field.name === name) || null;
}

function zoneAudioStreamChannelRef(channel) {
  const catalog = zoneAudioRamStateCatalog();
  const channelId = channel?.channelId;
  const channels = catalog?.streamChannelStruct?.channels || [];
  if (channelId == null) return null;
  return channels.find(item => item.index === channelId) || null;
}

function zoneAudioHardwareShadowRef(channel) {
  const catalog = zoneAudioRamStateCatalog();
  const channelId = channel?.channelId;
  const shadows = catalog?.hardwareShadowStruct?.channels || [];
  if (channelId == null) return null;
  return shadows.find(item => item.index === (channelId & 3)) || null;
}

function zoneAudioRamFieldRef(kind, channel, fieldName) {
  const catalog = zoneAudioRamStateCatalog();
  if (!catalog) return null;
  if (kind === 'stream') {
    const channelRef = zoneAudioStreamChannelRef(channel);
    const field = zoneAudioRamFieldByName(catalog.streamChannelStruct?.fields, fieldName);
    const base = zoneAudioParseRamAddress(channelRef?.baseAddress);
    if (!channelRef || !field || base == null) return null;
    const offset = field.offset || 0;
    return {
      kind: 'stream_field',
      name: field.name,
      address: _fmt4(base + offset),
      baseAddress: channelRef.baseAddress,
      offset: '+$' + offset.toString(16).toUpperCase().padStart(2, '0'),
      confidence: field.confidence || '',
      summary: field.summary || '',
    };
  }
  if (kind === 'hardware') {
    const shadowRef = zoneAudioHardwareShadowRef(channel);
    const field = zoneAudioRamFieldByName(catalog.hardwareShadowStruct?.fields, fieldName);
    const base = zoneAudioParseRamAddress(shadowRef?.baseAddress);
    if (!shadowRef || !field || base == null) return null;
    const offset = field.offset || 0;
    return {
      kind: 'hardware_shadow_field',
      name: field.name,
      address: _fmt4(base + offset),
      baseAddress: shadowRef.baseAddress,
      offset: '+$' + offset.toString(16).toUpperCase().padStart(2, '0'),
      confidence: field.confidence || '',
      summary: field.summary || '',
    };
  }
  return null;
}

function zoneAudioGlobalRamRef(role) {
  const catalog = zoneAudioRamStateCatalog();
  const item = (catalog?.globalRam || []).find(entry => entry.role === role);
  if (!item) return null;
  return {
    kind: 'global_ram',
    name: item.role,
    address: item.address,
    confidence: item.confidence || '',
    summary: item.summary || '',
  };
}

function zoneAudioResolveRamLinkRef(template, channel) {
  if (!template) return null;
  if (template.kind === 'stream_field') {
    const ref = zoneAudioRamFieldRef('stream', channel, template.fieldName);
    return ref ? { ...ref, relationship: template.relationship || '', linkConfidence: template.confidence || ref.confidence || '' } : null;
  }
  if (template.kind === 'hardware_shadow_field') {
    const ref = zoneAudioRamFieldRef('hardware', channel, template.fieldName);
    return ref ? { ...ref, relationship: template.relationship || '', linkConfidence: template.confidence || ref.confidence || '' } : null;
  }
  if (template.kind === 'global_ram') {
    const ref = zoneAudioGlobalRamRef(template.role);
    return ref ? { ...ref, relationship: template.relationship || '', linkConfidence: template.confidence || ref.confidence || '' } : null;
  }
  return null;
}

function zoneAudioCatalogEventLinks(event) {
  const catalog = zoneAudioEventRamLinkCatalog();
  if (!catalog) return null;
  if (event.kind === 'note' || event.kind === 'rest_or_special') return catalog.noteOrRest || null;
  if (event.kind === 'control') {
    return (catalog.opcodeLinks || []).find(link => link.opcode === event.opcode) || null;
  }
  return null;
}

function zoneAudioFallbackEventLinks(event) {
  if (event.kind === 'note' || event.kind === 'rest_or_special') {
    return {
      fieldRefs: [
        { kind: 'stream_field', fieldName: 'note_delay_counter' },
        { kind: 'stream_field', fieldName: 'current_stream_pointer' },
        { kind: 'hardware_shadow_field', fieldName: 'volume_or_attenuation' },
        { kind: 'hardware_shadow_field', fieldName: 'pitch_delta_or_step' },
        { kind: 'global_ram', role: 'active_audio_channel_index' },
      ],
      unresolvedRefs: [],
    };
  }
  if (event.kind !== 'control') return { fieldRefs: [], unresolvedRefs: [] };
  const refs = [
    { kind: 'stream_field', fieldName: 'current_stream_pointer' },
    { kind: 'global_ram', role: 'active_audio_channel_index' },
  ];
  const unresolvedRefs = [];
  if (event.opcode === '$F0') {
    refs.push({ kind: 'stream_field', fieldName: 'psg_instrument_or_effect_cache' });
    refs.push({ kind: 'hardware_shadow_field', fieldName: 'instrument_or_effect_id' });
  } else if (['$F1', '$F2', '$F3', '$F4', '$F5', '$F6', '$F7', '$F8', '$F9', '$FB', '$FC', '$FD', '$FE', '$FF'].includes(event.opcode)) {
    unresolvedRefs.push({ kind: 'unresolved_stream_field', fieldName: 'hl_relative_stream_state', relationship: 'exact field offset not yet named', confidence: 'medium' });
  }
  return { fieldRefs: refs, unresolvedRefs };
}

function zoneAudioEventFieldRefs(event, channel) {
  const refs = [];
  const add = ref => { if (ref && !refs.some(existing => existing.kind === ref.kind && existing.address === ref.address && existing.name === ref.name)) refs.push(ref); };
  const links = zoneAudioCatalogEventLinks(event) || zoneAudioFallbackEventLinks(event);
  for (const template of links?.fieldRefs || []) add(zoneAudioResolveRamLinkRef(template, channel));
  return refs;
}

function zoneAudioEventUnresolvedRefs(event) {
  const links = zoneAudioCatalogEventLinks(event) || zoneAudioFallbackEventLinks(event);
  return links?.unresolvedRefs || [];
}

function zoneAudioCatalogEventOutputLinks(event) {
  const catalog = zoneAudioEventOutputPhaseLinkCatalog();
  if (!catalog) return null;
  const key = event?.kind === 'control' ? event.opcode : 'note_or_rest_byte';
  return (catalog.eventOutputLinks || []).find(link => link.eventKey === key) || null;
}

function zoneAudioEventOutputPhaseLinks(event) {
  const link = zoneAudioCatalogEventOutputLinks(event);
  return link?.matchedOutputPhases || [];
}

function zoneAudioOutputPhaseById(phaseId) {
  const catalog = zoneAudioOutputRegisterCatalog();
  return (catalog?.outputPhases || []).find(phase => phase.id === phaseId) || null;
}

function zoneAudioRuntimeOutputFixtureLink(phaseId) {
  const empty = (status, catalogId = '') => ({
    status,
    catalogId,
    phaseFixtureId: '',
    writeFixtureIds: [],
    writeFixtureCount: 0,
    writeFixtures: [],
    fieldInputRefs: [],
    fieldInputKeys: [],
    branchIds: [],
    globalInputRoles: [],
    sourceRegion: null,
    sourceRoutineOffset: '',
    sourceRoutineLabel: '',
  });
  const catalog = audioRuntimeOutputFixtureCatalog();
  if (!catalog) return empty('fixture_catalog_missing');
  const phaseFixture = (catalog.phaseFixtures || []).find(phase => phase.sourcePhaseId === phaseId);
  if (!phaseFixture) return empty('phase_fixture_missing', catalog.id || '');

  const writeIds = phaseFixture.writeFixtureIds || [];
  const writeById = new Map((catalog.portWriteFixtures || []).map(write => [write.id, write]));
  const writeFixtures = writeIds
    .map(id => writeById.get(id))
    .filter(Boolean)
    .map(write => ({
      id: write.id || '',
      sourcePhaseId: write.sourcePhaseId || '',
      writeIndex: Number.isInteger(write.writeIndex) ? write.writeIndex : null,
      port: write.port || '',
      purpose: write.purpose || '',
      routineLabel: write.routineLabel || '',
      routineOffset: write.routineOffset || '',
      region: write.region || null,
      asmLine: Number.isInteger(write.asmLine) ? write.asmLine : null,
      valuePolicy: write.valuePolicy || 'runtime_port_value_not_persisted',
    }));

  return {
    status: 'fixture_linked_metadata_only',
    catalogId: catalog.id || '',
    phaseFixtureId: phaseFixture.id || '',
    sourcePhaseId: phaseFixture.sourcePhaseId || '',
    writeFixtureIds: writeIds.slice(),
    writeFixtureCount: writeIds.length,
    writeFixtures,
    fieldInputRefs: phaseFixture.fieldInputRefs || [],
    fieldInputKeys: (phaseFixture.fieldInputRefs || []).map(ref => ref.key || ref.label || '').filter(Boolean),
    branchIds: phaseFixture.branchIds || [],
    globalInputRoles: phaseFixture.globalInputRoles || [],
    sourceRegion: phaseFixture.routineRegion || null,
    sourceRoutineOffset: phaseFixture.routineOffset || '',
    sourceRoutineLabel: phaseFixture.routineLabel || '',
  };
}

function zoneAudioCreateRuntimeOutputEventSink(recipe, audio, outputModeFilter) {
  return {
    id: `zone_audio_runtime_output_event_sink_${Date.now()}`,
    recipeId: recipe?.id || '',
    requestId: audio?.requestIdHex || '',
    outputModeFilter: outputModeFilter || 'all',
    events: [],
    summary: {
      eventCount: 0,
      phaseEventCount: 0,
      writeEventCount: 0,
      selectedPhaseEventCount: 0,
      selectedWriteEventCount: 0,
      missingPhaseFixtureCount: 0,
      missingWriteFixtureCount: 0,
      psgEventCount: 0,
      fmEventCount: 0,
      mixedEventCount: 0,
      frameLinkedEventCount: 0,
      frameUnlinkedEventCount: 0,
      persistedRegisterValueCount: 0,
      persistedRegisterTraceCount: 0,
      persistedSampleCount: 0,
      persistedAudioByteCount: 0,
      persistedRomByteCount: 0,
      assetPolicy: 'metadata_only_runtime_event_ids_no_register_values_or_samples',
    },
  };
}

function zoneAudioRuntimeOutputEventContractForbiddenKeyCount(value, forbiddenSet) {
  if (!value || typeof value !== 'object') return 0;
  let count = 0;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenSet.has(key)) count++;
    if (child && typeof child === 'object') {
      count += zoneAudioRuntimeOutputEventContractForbiddenKeyCount(child, forbiddenSet);
    }
  }
  return count;
}

function zoneAudioRuntimeOutputEventContractModelMap(sink, derivedModels) {
  return {
    runtime_output_event_sink: sink,
    runtime_output_state_accumulator: derivedModels?.runtimeOutputAccumulator || null,
    runtime_output_frame_timeline: derivedModels?.runtimeOutputFrameTimeline || null,
    runtime_output_register_intent: derivedModels?.runtimeOutputRegisterIntent || null,
    runtime_output_channel_port_intent: derivedModels?.runtimeOutputChannelPortIntent || null,
  };
}

function zoneAudioValidateRuntimeOutputEventContract(sink, derivedModels) {
  const contract = audioRuntimeOutputEventContractCatalog();
  const eventContract = contract?.eventContract || {};
  const requiredKeys = eventContract.requiredEventKeys || [];
  const forbiddenKeys = eventContract.forbiddenPayloadKeys || [];
  const forbiddenSet = new Set(forbiddenKeys);
  const allowedKinds = new Set(eventContract.eventKinds || []);
  const modelMap = zoneAudioRuntimeOutputEventContractModelMap(sink, derivedModels);
  const summary = {
    catalogBacked: Boolean(contract),
    catalogId: contract?.id || '',
    catalogReady: contract?.summary?.readyForRuntimeHarness === true,
    requiredEventKeyCount: requiredKeys.length,
    optionalEventKeyCount: (eventContract.optionalEventKeys || []).length,
    forbiddenPayloadKeyCount: forbiddenKeys.length,
    derivedModelCount: (contract?.derivedModels || []).length,
    eventCount: (sink?.events || []).length,
    eventMissingRequiredKeyCount: 0,
    eventForbiddenPayloadKeyCount: 0,
    invalidEventKindCount: 0,
    modelMissingSummaryKeyCount: 0,
    modelForbiddenPayloadKeyCount: 0,
    missingModelCount: 0,
    nonZeroPersistedPayloadCount: 0,
    validationIssueCount: 0,
    readyForRuntimeHarness: false,
    assetPolicy: 'metadata_only_audio_runtime_output_event_contract_validation',
  };

  if (!contract) {
    summary.validationIssueCount = 1;
    return { catalog: null, summary, issues: ['audio runtime output event contract catalog missing'] };
  }

  const issues = [];
  for (const event of sink?.events || []) {
    const missing = requiredKeys.filter(key => !Object.prototype.hasOwnProperty.call(event, key));
    summary.eventMissingRequiredKeyCount += missing.length;
    if (missing.length) issues.push(`event ${event.kind || '?'} missing ${missing.join(',')}`);
    const forbiddenCount = zoneAudioRuntimeOutputEventContractForbiddenKeyCount(event, forbiddenSet);
    summary.eventForbiddenPayloadKeyCount += forbiddenCount;
    if (forbiddenCount) issues.push(`event ${event.kind || '?'} has ${forbiddenCount} forbidden payload key(s)`);
    if (allowedKinds.size && !allowedKinds.has(event.kind || '')) {
      summary.invalidEventKindCount++;
      issues.push(`event kind ${event.kind || '?'} is not allowed by contract`);
    }
  }

  for (const modelContract of contract.derivedModels || []) {
    const model = modelMap[modelContract.id] || null;
    if (!model) {
      summary.missingModelCount++;
      issues.push(`derived model ${modelContract.id || '?'} is missing`);
      continue;
    }
    const modelSummary = model.summary || {};
    for (const key of modelContract.requiredSummaryKeys || []) {
      if (!Object.prototype.hasOwnProperty.call(modelSummary, key)) {
        summary.modelMissingSummaryKeyCount++;
        issues.push(`derived model ${modelContract.id || '?'} missing summary ${key}`);
      }
    }
    const forbiddenCount = zoneAudioRuntimeOutputEventContractForbiddenKeyCount(model, forbiddenSet);
    summary.modelForbiddenPayloadKeyCount += forbiddenCount;
    if (forbiddenCount) issues.push(`derived model ${modelContract.id || '?'} has ${forbiddenCount} forbidden payload key(s)`);
    for (const [key, value] of Object.entries(modelSummary)) {
      if (key.startsWith('persisted') && Number(value || 0) !== 0) {
        summary.nonZeroPersistedPayloadCount += Number(value || 0);
        issues.push(`derived model ${modelContract.id || '?'} ${key} is ${value}`);
      }
    }
  }

  summary.validationIssueCount = issues.length;
  summary.readyForRuntimeHarness = summary.catalogReady && issues.length === 0;
  return { catalog: contract, summary, issues };
}

function zoneAudioRuntimeOutputEventContractValidationSummaryHtml(validation) {
  if (!validation?.summary?.catalogBacked) return '';
  const summary = validation.summary;
  const parts = [
    `catalog ${summary.catalogReady ? 'ready' : 'blocked'}`,
    `events ${summary.eventCount || 0}`,
    `required ${summary.requiredEventKeyCount || 0}`,
    `forbidden ${summary.forbiddenPayloadKeyCount || 0}`,
    `models ${summary.derivedModelCount || 0}`,
    `issues ${summary.validationIssueCount || 0}`,
  ];
  if (summary.eventMissingRequiredKeyCount) parts.push(`missing keys ${summary.eventMissingRequiredKeyCount}`);
  if (summary.eventForbiddenPayloadKeyCount || summary.modelForbiddenPayloadKeyCount) {
    parts.push(`forbidden keys ${(summary.eventForbiddenPayloadKeyCount || 0) + (summary.modelForbiddenPayloadKeyCount || 0)}`);
  }
  if (summary.nonZeroPersistedPayloadCount) parts.push(`persisted payloads ${summary.nonZeroPersistedPayloadCount}`);
  return `<div style="padding-left:10px;color:${summary.readyForRuntimeHarness ? '#86efac' : '#fca5a5'}">runtime output event contract ${simEscapeHtml(parts.join(' · '))}</div>`;
}

function zoneAudioRuntimeOutputInputFieldKeys(entry) {
  const keys = new Set();
  for (const key of entry.fieldInputKeys || []) if (key) keys.add(key);
  for (const ref of entry.globalInputRefs || []) {
    if (ref.role) keys.add(`global:${ref.role}`);
    else if (ref.address) keys.add(`global:${ref.address}`);
  }
  return [...keys].sort();
}

function zoneAudioRuntimeOutputSourceEventRole(event) {
  if (!event) return '';
  if (event.kind === 'control') return event.role || 'control_event';
  if (event.kind === 'note' || event.kind === 'rest_or_special') return 'note_or_rest_byte';
  return event.kind || '';
}

function zoneAudioRuntimeOutputSourceTraceMetadata(event) {
  const traceOperationKinds = new Set();
  const traceTargetLabels = new Set();
  const ramFieldKeys = new Set();
  const unresolvedRamFieldKeys = new Set();
  for (const operation of event?.traceOperations || []) {
    if (operation.kind) traceOperationKinds.add(operation.kind);
    if (operation.targetLabel) traceTargetLabels.add(operation.targetLabel);
  }
  for (const ref of event?.ramFieldRefs || []) {
    const key = [ref.kind || '', ref.name || ''].filter(Boolean).join(':');
    if (key) ramFieldKeys.add(key);
  }
  for (const ref of event?.unresolvedRamRefs || []) {
    const key = [ref.kind || 'unresolved', ref.fieldName || ref.relationship || ''].filter(Boolean).join(':');
    if (key) unresolvedRamFieldKeys.add(key);
  }
  return {
    sourceEventKind: event?.kind || '',
    sourceEventRole: zoneAudioRuntimeOutputSourceEventRole(event),
    sourceParserAction: event?.parserAction || '',
    sourceTraceOperationKinds: [...traceOperationKinds].sort(),
    sourceTraceTargetLabels: [...traceTargetLabels].sort(),
    sourceRamFieldKeys: [...ramFieldKeys].sort(),
    sourceUnresolvedRamFieldKeys: [...unresolvedRamFieldKeys].sort(),
  };
}

function zoneAudioRuntimeOutputEventBase(entry, channel, selectedByOutputModeFilter) {
  return {
    phaseFixtureId: entry.phaseFixtureId || '',
    writeFixtureId: '',
    frame: Number.isInteger(entry.frameIndex) ? entry.frameIndex : null,
    frameStatus: entry.frameStatus || '',
    pc: entry.eventOffsetHex || '',
    chip: entry.chip || '',
    port: '',
    activeChannel: channel?.channelIdHex || (channel?.channelId == null ? '' : String(channel.channelId)),
    inputFieldKeys: zoneAudioRuntimeOutputInputFieldKeys(entry),
    branchId: entry.modeBranchCandidate?.branchId || (entry.branchIds || [])[0] || '',
    selectedByOutputModeFilter: Boolean(selectedByOutputModeFilter),
    fixtureCatalogId: entry.fixtureCatalogId || '',
    sourcePhaseId: entry.phaseId || '',
    sourceRoutineLabel: entry.sourceRoutineLabel || entry.routineLabel || '',
    sourceRoutineOffset: entry.sourceRoutineOffset || '',
    sourceRegionId: entry.sourceRegion?.id || '',
    sourceEventKind: entry.sourceEventKind || '',
    sourceEventRole: entry.sourceEventRole || '',
    sourceParserAction: entry.sourceParserAction || '',
    sourceTraceOperationKinds: entry.sourceTraceOperationKinds || [],
    sourceTraceTargetLabels: entry.sourceTraceTargetLabels || [],
    sourceRamFieldKeys: entry.sourceRamFieldKeys || [],
    sourceUnresolvedRamFieldKeys: entry.sourceUnresolvedRamFieldKeys || [],
    valuePolicy: 'runtime_port_value_not_persisted',
    assetPolicy: 'metadata_only_runtime_event_ids_no_register_values_or_samples',
  };
}

function zoneAudioAppendRuntimeOutputEvent(sink, event) {
  sink.events.push(event);
  sink.summary.eventCount++;
  if (event.frameStatus === 'frame_step_linked') sink.summary.frameLinkedEventCount++;
  else sink.summary.frameUnlinkedEventCount++;
  if (event.chip === 'psg') sink.summary.psgEventCount++;
  else if (event.chip === 'fm') sink.summary.fmEventCount++;
  else sink.summary.mixedEventCount++;
}

function zoneAudioEmitRuntimeOutputFixtureEvents(sink, entries, channel) {
  if (!sink) return;
  const mode = sink.outputModeFilter || 'all';
  for (const entry of entries || []) {
    const selected = zoneAudioOutputModeFilterAllowsEntry(entry, mode);
    if (!entry.phaseFixtureId) {
      sink.summary.missingPhaseFixtureCount++;
      continue;
    }

    const phaseEvent = {
      kind: 'audio_output_phase_fixture',
      ...zoneAudioRuntimeOutputEventBase(entry, channel, selected),
    };
    zoneAudioAppendRuntimeOutputEvent(sink, phaseEvent);
    sink.summary.phaseEventCount++;
    if (selected) sink.summary.selectedPhaseEventCount++;

    const writes = entry.writeFixtures?.length
      ? entry.writeFixtures
      : (entry.writeFixtureIds || []).map((id, index) => ({ id, writeIndex: index, port: '' }));
    if (!writes.length && (entry.writeCount || 0)) sink.summary.missingWriteFixtureCount += entry.writeCount || 0;
    for (const write of writes) {
      if (!write?.id) sink.summary.missingWriteFixtureCount++;
      const writeEvent = {
        kind: 'audio_port_write_fixture',
        ...zoneAudioRuntimeOutputEventBase(entry, channel, selected),
        writeFixtureId: write?.id || '',
        writeIndex: Number.isInteger(write?.writeIndex) ? write.writeIndex : null,
        port: write?.port || '',
        asmLine: Number.isInteger(write?.asmLine) ? write.asmLine : null,
        purpose: write?.purpose || '',
      };
      zoneAudioAppendRuntimeOutputEvent(sink, writeEvent);
      sink.summary.writeEventCount++;
      if (selected) sink.summary.selectedWriteEventCount++;
    }
  }
}

function zoneAudioRuntimeOutputEventSinkSummaryHtml(sink) {
  if (!sink?.summary?.eventCount) return '';
  const summary = sink.summary;
  const parts = [
    `${summary.eventCount || 0} event(s)`,
    `${summary.phaseEventCount || 0} phase`,
    `${summary.writeEventCount || 0} write`,
    `selected ${summary.selectedPhaseEventCount || 0}/${summary.selectedWriteEventCount || 0}`,
  ];
  if (summary.missingPhaseFixtureCount) parts.push(`missing phase fixtures ${summary.missingPhaseFixtureCount}`);
  if (summary.missingWriteFixtureCount) parts.push(`missing write fixtures ${summary.missingWriteFixtureCount}`);
  parts.push('metadata only');
  return `<div style="padding-left:10px;color:#67e8f9">runtime output event sink ${simEscapeHtml(parts.join(' · '))}</div>`;
}

const ZONE_AUDIO_LOCAL_OBSERVATION_FORBIDDEN_KEYS = new Set([
  'romByte',
  'romBytes',
  'streamByte',
  'streamBytes',
  'opcode',
  'opcodes',
  'arg',
  'args',
  'argHex',
  'argsHex',
  'byteHex',
  'encodedHex',
  'registerValue',
  'registerValues',
  'registerTrace',
  'registerTraces',
  'portValue',
  'sample',
  'samples',
  'audioByte',
  'audioBytes',
  'value',
  'values',
  'payload',
  'payloads',
  'raw',
  'rawValue',
  'rawValues',
  'rawByte',
  'rawBytes',
  'byte',
  'bytes',
  'data',
  'register',
  'registers',
  'trace',
  'traces',
  'snapshot',
  'snapshots',
  'hash',
  'hashes',
  'tileId',
  'tileIds',
  'paletteValue',
  'paletteValues',
  'vdpPortValue',
  'vdpRegisterValue',
  'decodedPixels',
  'pixels',
  'screenshot',
  'screenshots',
  'instructionByte',
  'instructionBytes',
]);

function zoneAudioRuntimeOutputForbiddenObservationKeys(value, path, found) {
  found = found || [];
  if (!value || typeof value !== 'object') return found;
  if (Array.isArray(value)) {
    value.forEach((item, index) => zoneAudioRuntimeOutputForbiddenObservationKeys(item, `${path || 'observations'}[${index}]`, found));
    return found;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (ZONE_AUDIO_LOCAL_OBSERVATION_FORBIDDEN_KEYS.has(key)) found.push(childPath);
    if (child && typeof child === 'object') zoneAudioRuntimeOutputForbiddenObservationKeys(child, childPath, found);
  }
  return found;
}

function zoneAudioRuntimeOutputLocalObservationFromEvent(event) {
  const isWrite = event?.kind === 'audio_port_write_fixture';
  const isPhase = event?.kind === 'audio_output_phase_fixture';
  const observation = {
    kind: isWrite ? 'write' : 'phase',
    frame: Number.isInteger(event?.frame) ? event.frame : null,
    frameStatus: event?.frameStatus || '',
    pc: event?.pc || '',
    activeChannel: event?.activeChannel || '',
    inputFieldKeys: (event?.inputFieldKeys || []).slice().sort(),
    branchId: event?.branchId || '',
    selectedByOutputModeFilter: Boolean(event?.selectedByOutputModeFilter),
    sourceEventKind: event?.sourceEventKind || '',
    sourceEventRole: event?.sourceEventRole || '',
    sourceParserAction: event?.sourceParserAction || '',
    sourceTraceOperationKinds: (event?.sourceTraceOperationKinds || []).slice().sort(),
    sourceTraceTargetLabels: (event?.sourceTraceTargetLabels || []).slice().sort(),
    sourceRamFieldKeys: (event?.sourceRamFieldKeys || []).slice().sort(),
    sourceUnresolvedRamFieldKeys: (event?.sourceUnresolvedRamFieldKeys || []).slice().sort(),
  };
  if (isWrite) observation.writeFixtureId = event.writeFixtureId || '';
  else if (isPhase) observation.phaseFixtureId = event.phaseFixtureId || '';
  return observation;
}

function zoneAudioBuildRuntimeOutputLocalObservationBundle(sink, recipe, audio, contractValidation) {
  const catalog = audioRuntimeOutputLocalBundleCatalog();
  const observations = (sink?.events || [])
    .filter(event => event?.kind === 'audio_output_phase_fixture' || event?.kind === 'audio_port_write_fixture')
    .map(zoneAudioRuntimeOutputLocalObservationFromEvent);
  const forbiddenPayloadKeys = zoneAudioRuntimeOutputForbiddenObservationKeys(observations).sort();
  const phaseObservationCount = observations.filter(item => item.kind === 'phase').length;
  const writeObservationCount = observations.filter(item => item.kind === 'write').length;
  const missingFixtureObservationCount = observations.filter(item =>
    (item.kind === 'phase' && !item.phaseFixtureId) ||
    (item.kind === 'write' && !item.writeFixtureId)
  ).length;
  const contractReady = contractValidation?.summary?.readyForRuntimeHarness === true;
  const catalogReady = catalog?.summary?.readyForRuntimeHarness === true;
  const ready = observations.length > 0 &&
    forbiddenPayloadKeys.length === 0 &&
    missingFixtureObservationCount === 0 &&
    contractReady &&
    catalogReady;
  return {
    schemaVersion: 1,
    eventKind: 'wb3_audio_runtime_output_observations',
    templateOnly: false,
    generatedBy: 'tools/rom-analyzer.html#zoneAudioRenderPreview',
    source: 'browser_zone_audio_preview_metadata_only',
    sourceCatalogs: [
      'world-audio-runtime-output-fixture-catalog-2026-06-26',
      'world-audio-runtime-output-event-contract-catalog-2026-06-26',
      'world-audio-runtime-output-local-bundle-catalog-2026-06-26',
    ],
    recipeId: recipe?.id || '',
    audioRequestId: audio?.requestIdHex || '',
    outputModeFilter: sink?.outputModeFilter || 'all',
    reviewStatus: 'unreviewed_runtime_observations',
    reviewPolicy: 'Use this browser-built metadata-only observation bundle as review input. Mark reviewed only after confirming it came from the intended local ROM preview and contains no register values, port values, samples, stream bytes, ROM bytes, screenshots, or hashes.',
    assetPolicy: 'Metadata-only browser audio output observations. Fixture ids, frame ids, offsets, field names, branch ids, and source labels may be copied to tmp/local-audio-output-observations.json. Runtime register values, port values, register traces, opcodes, stream bytes, ROM bytes, samples, screenshots, and hashes are not stored.',
    summary: {
      observationCount: observations.length,
      phaseObservationCount,
      writeObservationCount,
      selectedObservationCount: observations.filter(item => item.selectedByOutputModeFilter).length,
      missingFixtureObservationCount,
      forbiddenPayloadKeyCount: forbiddenPayloadKeys.length,
      contractReady,
      localBundleCatalogReady: catalogReady,
      readyForLocalBundle: ready,
      defaultFilledObservationPath: catalog?.summary?.defaultFilledObservationPath || 'tmp/local-audio-output-observations.json',
      defaultBundleOutputPath: catalog?.summary?.defaultBundleOutputPath || 'tmp/world-audio-runtime-output-events.local.json',
      bundleCommand: catalog?.target?.bundleCommand || 'node tools/world-audio-runtime-output-local-bundle.mjs --observations tmp/local-audio-output-observations.json --out tmp/world-audio-runtime-output-events.local.json',
      reviewedBundleCommand: catalog?.target?.reviewedBundleCommand || 'node tools/world-audio-runtime-output-local-bundle.mjs --observations tmp/local-audio-output-observations.json --reviewed-runtime-observations --out tmp/world-audio-runtime-output-events.local.json',
      persistedRomByteCount: 0,
      persistedStreamByteCount: 0,
      persistedRegisterValueCount: 0,
      persistedRegisterTraceCount: 0,
      persistedPortValueCount: 0,
      persistedSampleCount: 0,
      persistedAudioByteCount: 0,
      persistedHashCount: 0,
    },
    forbiddenPayloadKeys,
    observations,
  };
}

function zoneAudioRuntimeOutputLocalObservationBundleSummaryHtml(bundle) {
  if (!bundle?.summary?.observationCount) return '';
  const summary = bundle.summary;
  const parts = [
    `${summary.observationCount || 0} observation(s)`,
    `${summary.phaseObservationCount || 0} phase`,
    `${summary.writeObservationCount || 0} write`,
    `selected ${summary.selectedObservationCount || 0}`,
    `forbidden ${summary.forbiddenPayloadKeyCount || 0}`,
  ];
  if (summary.missingFixtureObservationCount) parts.push(`missing fixture ${summary.missingFixtureObservationCount}`);
  parts.push(summary.readyForLocalBundle ? 'ready for local bundle' : 'not ready');
  return `
    <div style="padding-left:10px;color:${summary.readyForLocalBundle ? '#86efac' : '#fca5a5'}">runtime local observation bundle ${simEscapeHtml(parts.join(' · '))}</div>
    <div style="padding-left:20px;color:#94a3b8">write observations to ${simEscapeHtml(summary.defaultFilledObservationPath || 'tmp/local-audio-output-observations.json')}</div>
    <div style="padding-left:20px;color:#94a3b8">${simEscapeHtml(summary.bundleCommand || '')}</div>
  `;
}

function zoneAudioLocalObservationExportFileName() {
  return 'local-audio-output-observations.json';
}

function zoneAudioLocalObservationExportPayload(bundle) {
  return {
    schemaVersion: 1,
    eventKind: bundle?.eventKind || 'wb3_audio_runtime_output_observations',
    templateOnly: false,
    generatedBy: 'tools/rom-analyzer.html#zoneAudioExportLocalObservationBundle',
    source: 'browser_zone_audio_preview_metadata_only_export',
    sourceCatalogs: (bundle?.sourceCatalogs || []).slice(),
    recipeId: bundle?.recipeId || '',
    audioRequestId: bundle?.audioRequestId || '',
    outputModeFilter: bundle?.outputModeFilter || 'all',
    reviewStatus: bundle?.reviewStatus || 'unreviewed_runtime_observations',
    reviewPolicy: bundle?.reviewPolicy || 'Review metadata-only observations before marking them as reviewed runtime evidence.',
    assetPolicy: bundle?.assetPolicy || 'Metadata-only audio output observations. No ROM bytes, stream bytes, opcodes, register values, port values, register traces, audio bytes, samples, screenshots, or hashes are exported.',
    summary: {
      ...(bundle?.summary || {}),
      browserExportedObservationCount: (bundle?.observations || []).length,
      persistedRomByteCount: 0,
      persistedStreamByteCount: 0,
      persistedRegisterValueCount: 0,
      persistedRegisterTraceCount: 0,
      persistedPortValueCount: 0,
      persistedSampleCount: 0,
      persistedAudioByteCount: 0,
      persistedHashCount: 0,
    },
    forbiddenPayloadKeys: (bundle?.forbiddenPayloadKeys || []).slice(),
    observations: (bundle?.observations || []).map(observation => ({ ...observation })),
  };
}

function zoneAudioValidateLocalObservationExport(bundle) {
  const issues = [];
  if (!bundle) {
    issues.push('No browser audio observation bundle is available. Preview events first.');
    return issues;
  }
  const summary = bundle.summary || {};
  if (!summary.readyForLocalBundle) issues.push('Current observation bundle is not ready for local bundling.');
  if (!Array.isArray(bundle.observations) || !bundle.observations.length) issues.push('Current observation bundle has no observations.');
  if (summary.forbiddenPayloadKeyCount) issues.push(`Current observation bundle has ${summary.forbiddenPayloadKeyCount} forbidden payload key(s).`);
  if (summary.missingFixtureObservationCount) issues.push(`Current observation bundle has ${summary.missingFixtureObservationCount} missing fixture observation(s).`);
  for (const [key, value] of Object.entries(summary)) {
    if (key.startsWith('persisted') && Number(value || 0) !== 0) issues.push(`Current observation bundle ${key} is ${value}.`);
  }
  const payload = zoneAudioLocalObservationExportPayload(bundle);
  const forbidden = zoneAudioRuntimeOutputForbiddenObservationKeys(payload).sort();
  if (forbidden.length) issues.push(`Export payload contains forbidden key(s): ${forbidden.slice(0, 8).join(', ')}${forbidden.length > 8 ? `, +${forbidden.length - 8}` : ''}.`);
  return issues;
}

function zoneAudioUpdateObservationExportButton(bundle) {
  const btn = document.getElementById('btn-zone-audio-export-observations');
  const info = document.getElementById('zone-audio-export-info');
  if (!btn) return;
  const issues = zoneAudioValidateLocalObservationExport(bundle);
  const ready = issues.length === 0;
  const summary = bundle?.summary || {};
  btn.disabled = !ready;
  btn.dataset.zoneAudioObservationExportReady = ready ? '1' : '0';
  btn.dataset.zoneAudioObservationExportObservationCount = String(summary.observationCount || 0);
  btn.dataset.zoneAudioObservationExportPhaseCount = String(summary.phaseObservationCount || 0);
  btn.dataset.zoneAudioObservationExportWriteCount = String(summary.writeObservationCount || 0);
  btn.dataset.zoneAudioObservationExportForbiddenPayloadKeyCount = String(summary.forbiddenPayloadKeyCount || 0);
  btn.dataset.zoneAudioObservationExportFileName = zoneAudioLocalObservationExportFileName();
  btn.title = ready
    ? `Export ${summary.observationCount || 0} metadata-only audio observation(s)`
    : (issues[0] || 'Preview events before exporting observations');
  if (info) {
    info.textContent = ready
      ? `export ready · ${summary.observationCount || 0} obs · ${zoneAudioLocalObservationExportFileName()}`
      : (bundle ? `export blocked · ${issues.length} issue(s)` : 'preview first to export observations');
    info.style.color = ready ? '#86efac' : 'var(--dim)';
  }
}

function zoneAudioExportLocalObservationBundle() {
  const bundle = typeof window !== 'undefined' ? window.zoneAudioLastRuntimeOutputLocalObservationBundle : null;
  const issues = zoneAudioValidateLocalObservationExport(bundle);
  zoneAudioUpdateObservationExportButton(bundle);
  if (issues.length) {
    showToast(issues[0], true);
    return null;
  }
  const payload = zoneAudioLocalObservationExportPayload(bundle);
  const filename = zoneAudioLocalObservationExportFileName();
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`Exported ${filename} (${payload.observations.length} observations)`);
  return payload;
}

function zoneAudioCountObjectKey(object, key, amount = 1) {
  const normalized = key || 'unclassified';
  object[normalized] = (object[normalized] || 0) + amount;
}

function zoneAudioRuntimeFrameKey(event) {
  return Number.isInteger(event.frame) ? `f${event.frame}` : (event.frameStatus || 'linear');
}

function zoneAudioBuildRuntimeOutputStateAccumulator(sink) {
  const frameGroups = new Map();
  const phaseFixtureIds = new Set();
  const writeFixtureIds = new Set();
  const branchIds = new Set();
  const inputFieldKeys = new Set();
  const activeChannels = new Set();
  const summary = {
    eventCount: 0,
    phaseEventCount: 0,
    writeEventCount: 0,
    selectedEventCount: 0,
    selectedPhaseEventCount: 0,
    selectedWriteEventCount: 0,
    psgEventCount: 0,
    fmEventCount: 0,
    mixedEventCount: 0,
    psgWriteEventCount: 0,
    fmWriteEventCount: 0,
    mixedWriteEventCount: 0,
    frameGroupCount: 0,
    frameLinkedGroupCount: 0,
    frameUnlinkedGroupCount: 0,
    uniquePhaseFixtureCount: 0,
    uniqueWriteFixtureCount: 0,
    portKindCount: 0,
    branchKindCount: 0,
    inputFieldKeyCount: 0,
    activeChannelCount: 0,
    chipCounts: {},
    portCounts: {},
    branchCounts: {},
    activeChannelCounts: {},
    inputFieldKeyCounts: {},
    persistedRegisterValueCount: 0,
    persistedRegisterTraceCount: 0,
    persistedSampleCount: 0,
    persistedAudioByteCount: 0,
    persistedRomByteCount: 0,
    assetPolicy: 'metadata_only_psg_fm_accumulator_no_values_or_samples',
  };

  for (const event of sink?.events || []) {
    const isPhase = event.kind === 'audio_output_phase_fixture';
    const isWrite = event.kind === 'audio_port_write_fixture';
    const selected = Boolean(event.selectedByOutputModeFilter);
    const frameKey = zoneAudioRuntimeFrameKey(event);
    let frame = frameGroups.get(frameKey);
    if (!frame) {
      frame = {
        frame: Number.isInteger(event.frame) ? event.frame : null,
        frameKey,
        frameStatus: event.frameStatus || '',
        eventCount: 0,
        phaseEventCount: 0,
        writeEventCount: 0,
        selectedEventCount: 0,
        selectedPhaseEventCount: 0,
        selectedWriteEventCount: 0,
        psgEventCount: 0,
        fmEventCount: 0,
        mixedEventCount: 0,
        portCounts: {},
        branchCounts: {},
        activeChannelCounts: {},
        inputFieldKeyCounts: {},
        phaseFixtureIds: new Set(),
        writeFixtureIds: new Set(),
      };
      frameGroups.set(frameKey, frame);
    }

    summary.eventCount++;
    frame.eventCount++;
    if (selected) {
      summary.selectedEventCount++;
      frame.selectedEventCount++;
    }
    if (isPhase) {
      summary.phaseEventCount++;
      frame.phaseEventCount++;
      if (selected) {
        summary.selectedPhaseEventCount++;
        frame.selectedPhaseEventCount++;
      }
    } else if (isWrite) {
      summary.writeEventCount++;
      frame.writeEventCount++;
      if (selected) {
        summary.selectedWriteEventCount++;
        frame.selectedWriteEventCount++;
      }
    }

    if (event.chip === 'psg') {
      summary.psgEventCount++;
      frame.psgEventCount++;
      if (isWrite) summary.psgWriteEventCount++;
    } else if (event.chip === 'fm') {
      summary.fmEventCount++;
      frame.fmEventCount++;
      if (isWrite) summary.fmWriteEventCount++;
    } else {
      summary.mixedEventCount++;
      frame.mixedEventCount++;
      if (isWrite) summary.mixedWriteEventCount++;
    }
    zoneAudioCountObjectKey(summary.chipCounts, event.chip || 'mixed');

    if (event.port) {
      zoneAudioCountObjectKey(summary.portCounts, event.port);
      zoneAudioCountObjectKey(frame.portCounts, event.port);
    }
    if (event.branchId) {
      zoneAudioCountObjectKey(summary.branchCounts, event.branchId);
      zoneAudioCountObjectKey(frame.branchCounts, event.branchId);
      branchIds.add(event.branchId);
    }
    if (event.activeChannel) {
      zoneAudioCountObjectKey(summary.activeChannelCounts, event.activeChannel);
      zoneAudioCountObjectKey(frame.activeChannelCounts, event.activeChannel);
      activeChannels.add(event.activeChannel);
    }
    for (const key of event.inputFieldKeys || []) {
      zoneAudioCountObjectKey(summary.inputFieldKeyCounts, key);
      zoneAudioCountObjectKey(frame.inputFieldKeyCounts, key);
      inputFieldKeys.add(key);
    }
    if (event.phaseFixtureId) {
      phaseFixtureIds.add(event.phaseFixtureId);
      frame.phaseFixtureIds.add(event.phaseFixtureId);
    }
    if (event.writeFixtureId) {
      writeFixtureIds.add(event.writeFixtureId);
      frame.writeFixtureIds.add(event.writeFixtureId);
    }
  }

  summary.frameGroupCount = frameGroups.size;
  summary.frameLinkedGroupCount = [...frameGroups.values()].filter(frame => frame.frameStatus === 'frame_step_linked').length;
  summary.frameUnlinkedGroupCount = frameGroups.size - summary.frameLinkedGroupCount;
  summary.uniquePhaseFixtureCount = phaseFixtureIds.size;
  summary.uniqueWriteFixtureCount = writeFixtureIds.size;
  summary.portKindCount = Object.keys(summary.portCounts).length;
  summary.branchKindCount = branchIds.size;
  summary.inputFieldKeyCount = inputFieldKeys.size;
  summary.activeChannelCount = activeChannels.size;

  return {
    id: `zone_audio_runtime_output_state_accumulator_${Date.now()}`,
    sinkId: sink?.id || '',
    recipeId: sink?.recipeId || '',
    requestId: sink?.requestId || '',
    outputModeFilter: sink?.outputModeFilter || 'all',
    frameGroups: [...frameGroups.values()].map(frame => ({
      ...frame,
      phaseFixtureIds: [...frame.phaseFixtureIds].sort(),
      writeFixtureIds: [...frame.writeFixtureIds].sort(),
    })),
    summary,
    assetPolicy: summary.assetPolicy,
  };
}

function zoneAudioRuntimeOutputStateAccumulatorSummaryHtml(accumulator) {
  if (!accumulator?.summary?.eventCount) return '';
  const summary = accumulator.summary;
  const portText = Object.keys(summary.portCounts || {}).sort()
    .map(port => `${port}:${summary.portCounts[port]}`)
    .join(' ');
  const parts = [
    `${summary.eventCount || 0} event(s)`,
    `frames ${summary.frameGroupCount || 0}`,
    `phase/write ${summary.phaseEventCount || 0}/${summary.writeEventCount || 0}`,
    `fixtures ${summary.uniquePhaseFixtureCount || 0}/${summary.uniqueWriteFixtureCount || 0}`,
    `chips ${summary.psgEventCount || 0} PSG/${summary.fmEventCount || 0} FM`,
  ];
  if (portText) parts.push(portText);
  parts.push('no values');
  return `<div style="padding-left:10px;color:#5eead4">runtime PSG/FM accumulator ${simEscapeHtml(parts.join(' · '))}</div>`;
}

function zoneAudioBuildRuntimeOutputFrameTimeline(accumulator) {
  const frames = (accumulator?.frameGroups || []).slice().sort((a, b) => {
    const af = Number.isInteger(a.frame) ? a.frame : Number.MAX_SAFE_INTEGER;
    const bf = Number.isInteger(b.frame) ? b.frame : Number.MAX_SAFE_INTEGER;
    return af - bf || String(a.frameKey || '').localeCompare(String(b.frameKey || ''));
  });
  const phaseFixtureIds = new Set();
  const writeFixtureIds = new Set();
  const ports = new Set();
  const branches = new Set();
  const inputFieldKeys = new Set();
  const activeChannels = new Set();
  const summary = {
    frameCount: frames.length,
    frameLinkedCount: 0,
    frameUnlinkedCount: 0,
    eventCount: 0,
    phaseEventCount: 0,
    writeEventCount: 0,
    selectedEventCount: 0,
    selectedPhaseEventCount: 0,
    selectedWriteEventCount: 0,
    psgEventCount: 0,
    fmEventCount: 0,
    mixedEventCount: 0,
    psgWriteEventCount: 0,
    fmWriteEventCount: 0,
    mixedWriteEventCount: 0,
    uniquePhaseFixtureCount: 0,
    uniqueWriteFixtureCount: 0,
    portKindCount: 0,
    branchKindCount: 0,
    inputFieldKeyCount: 0,
    activeChannelCount: 0,
    persistedRegisterValueCount: 0,
    persistedRegisterTraceCount: 0,
    persistedSampleCount: 0,
    persistedAudioByteCount: 0,
    persistedRomByteCount: 0,
    assetPolicy: 'metadata_only_output_frame_timeline_no_values_or_samples',
  };

  const timelineFrames = frames.map((frame, index) => {
    if (frame.frameStatus === 'frame_step_linked') summary.frameLinkedCount++;
    else summary.frameUnlinkedCount++;
    summary.eventCount += frame.eventCount || 0;
    summary.phaseEventCount += frame.phaseEventCount || 0;
    summary.writeEventCount += frame.writeEventCount || 0;
    summary.selectedEventCount += frame.selectedEventCount || 0;
    summary.selectedPhaseEventCount += frame.selectedPhaseEventCount || 0;
    summary.selectedWriteEventCount += frame.selectedWriteEventCount || 0;
    summary.psgEventCount += frame.psgEventCount || 0;
    summary.fmEventCount += frame.fmEventCount || 0;
    summary.mixedEventCount += frame.mixedEventCount || 0;

    const portCounts = frame.portCounts || {};
    const branchCounts = frame.branchCounts || {};
    const inputCounts = frame.inputFieldKeyCounts || {};
    const activeChannelCounts = frame.activeChannelCounts || {};
    const psgWriteEventCount = Object.keys(portCounts)
      .filter(port => port === 'Port_PSG')
      .reduce((sum, port) => sum + (portCounts[port] || 0), 0);
    const fmWriteEventCount = Object.keys(portCounts)
      .filter(port => port === 'Port_FMAddress' || port === 'Port_FMData')
      .reduce((sum, port) => sum + (portCounts[port] || 0), 0);
    const mixedWriteEventCount = Math.max(0, (frame.writeEventCount || 0) - psgWriteEventCount - fmWriteEventCount);
    summary.psgWriteEventCount += psgWriteEventCount;
    summary.fmWriteEventCount += fmWriteEventCount;
    summary.mixedWriteEventCount += mixedWriteEventCount;

    for (const port of Object.keys(portCounts)) ports.add(port);
    for (const branch of Object.keys(branchCounts)) branches.add(branch);
    for (const key of Object.keys(inputCounts)) inputFieldKeys.add(key);
    for (const channel of Object.keys(activeChannelCounts)) activeChannels.add(channel);
    for (const id of frame.phaseFixtureIds || []) phaseFixtureIds.add(id);
    for (const id of frame.writeFixtureIds || []) writeFixtureIds.add(id);

    return {
      index,
      frame: Number.isInteger(frame.frame) ? frame.frame : null,
      frameKey: frame.frameKey || '',
      frameStatus: frame.frameStatus || '',
      eventCount: frame.eventCount || 0,
      phaseEventCount: frame.phaseEventCount || 0,
      writeEventCount: frame.writeEventCount || 0,
      selectedEventCount: frame.selectedEventCount || 0,
      selectedPhaseEventCount: frame.selectedPhaseEventCount || 0,
      selectedWriteEventCount: frame.selectedWriteEventCount || 0,
      psgEventCount: frame.psgEventCount || 0,
      fmEventCount: frame.fmEventCount || 0,
      mixedEventCount: frame.mixedEventCount || 0,
      psgWriteEventCount,
      fmWriteEventCount,
      mixedWriteEventCount,
      portCounts,
      branchCounts,
      inputFieldKeyCounts: inputCounts,
      activeChannelCounts,
      phaseFixtureIds: frame.phaseFixtureIds || [],
      writeFixtureIds: frame.writeFixtureIds || [],
      assetPolicy: 'metadata_only_output_frame_timeline_no_values_or_samples',
    };
  });

  summary.uniquePhaseFixtureCount = phaseFixtureIds.size;
  summary.uniqueWriteFixtureCount = writeFixtureIds.size;
  summary.portKindCount = ports.size;
  summary.branchKindCount = branches.size;
  summary.inputFieldKeyCount = inputFieldKeys.size;
  summary.activeChannelCount = activeChannels.size;

  return {
    id: `zone_audio_runtime_output_frame_timeline_${Date.now()}`,
    accumulatorId: accumulator?.id || '',
    recipeId: accumulator?.recipeId || '',
    requestId: accumulator?.requestId || '',
    outputModeFilter: accumulator?.outputModeFilter || 'all',
    frames: timelineFrames,
    summary,
    assetPolicy: summary.assetPolicy,
  };
}

function zoneAudioRuntimeOutputFrameTimelineSummaryHtml(timeline) {
  if (!timeline?.summary?.eventCount) return '';
  const summary = timeline.summary;
  const visible = (timeline.frames || []).slice(0, 5)
    .map(frame => `${frame.frameKey || '?'} ${frame.writeEventCount || 0}w ${frame.psgWriteEventCount || 0}psg/${frame.fmWriteEventCount || 0}fm`)
    .join(' ; ');
  const parts = [
    `${summary.frameCount || 0} frame group(s)`,
    `${summary.frameLinkedCount || 0} linked/${summary.frameUnlinkedCount || 0} linear`,
    `events ${summary.eventCount || 0}`,
    `writes ${summary.writeEventCount || 0}`,
    `PSG/FM ${summary.psgWriteEventCount || 0}/${summary.fmWriteEventCount || 0}`,
    `ports ${summary.portKindCount || 0}`,
  ];
  const lines = [
    `<div style="padding-left:10px;color:#2dd4bf">runtime output frame timeline ${simEscapeHtml(parts.join(' · '))}</div>`,
  ];
  if (visible) lines.push(`<div style="padding-left:20px;color:#777">${simEscapeHtml(visible)}${timeline.frames.length > 5 ? ` ; +${timeline.frames.length - 5}` : ''}</div>`);
  return lines.join('');
}

function zoneAudioRuntimeOutputRegisterIntentKind(frame) {
  const writeCount = frame?.writeEventCount || 0;
  const psgWrites = frame?.psgWriteEventCount || 0;
  const fmWrites = frame?.fmWriteEventCount || 0;
  const mixedWrites = frame?.mixedWriteEventCount || 0;
  if (!writeCount) return 'no_writes';
  if (psgWrites && !fmWrites && !mixedWrites) return 'psg_only';
  if (fmWrites && !psgWrites && !mixedWrites) return 'fm_only';
  return 'mixed_psg_fm';
}

function zoneAudioBuildRuntimeOutputRegisterIntentModel(frameTimeline) {
  const phaseFixtureIds = new Set();
  const writeFixtureIds = new Set();
  const ports = new Set();
  const branches = new Set();
  const inputFieldKeys = new Set();
  const activeChannels = new Set();
  const summary = {
    frameCount: 0,
    psgOnlyFrameCount: 0,
    fmOnlyFrameCount: 0,
    mixedFrameCount: 0,
    noWriteFrameCount: 0,
    eventCount: 0,
    phaseEventCount: 0,
    writeEventCount: 0,
    selectedEventCount: 0,
    selectedPhaseEventCount: 0,
    selectedWriteEventCount: 0,
    psgEventCount: 0,
    fmEventCount: 0,
    mixedEventCount: 0,
    psgWriteEventCount: 0,
    fmWriteEventCount: 0,
    mixedWriteEventCount: 0,
    uniquePhaseFixtureCount: 0,
    uniqueWriteFixtureCount: 0,
    portKindCount: 0,
    branchKindCount: 0,
    inputFieldKeyCount: 0,
    activeChannelCount: 0,
    intentKindCounts: {},
    portCounts: {},
    branchCounts: {},
    activeChannelCounts: {},
    inputFieldKeyCounts: {},
    persistedRegisterValueCount: 0,
    persistedRegisterTraceCount: 0,
    persistedSampleCount: 0,
    persistedAudioByteCount: 0,
    persistedRomByteCount: 0,
    assetPolicy: 'metadata_only_register_intent_no_values_or_samples',
  };

  const frames = (frameTimeline?.frames || []).map((frame, index) => {
    const intentKind = zoneAudioRuntimeOutputRegisterIntentKind(frame);
    summary.frameCount++;
    if (intentKind === 'psg_only') summary.psgOnlyFrameCount++;
    else if (intentKind === 'fm_only') summary.fmOnlyFrameCount++;
    else if (intentKind === 'mixed_psg_fm') summary.mixedFrameCount++;
    else summary.noWriteFrameCount++;
    zoneAudioCountObjectKey(summary.intentKindCounts, intentKind);

    summary.eventCount += frame.eventCount || 0;
    summary.phaseEventCount += frame.phaseEventCount || 0;
    summary.writeEventCount += frame.writeEventCount || 0;
    summary.selectedEventCount += frame.selectedEventCount || 0;
    summary.selectedPhaseEventCount += frame.selectedPhaseEventCount || 0;
    summary.selectedWriteEventCount += frame.selectedWriteEventCount || 0;
    summary.psgEventCount += frame.psgEventCount || 0;
    summary.fmEventCount += frame.fmEventCount || 0;
    summary.mixedEventCount += frame.mixedEventCount || 0;
    summary.psgWriteEventCount += frame.psgWriteEventCount || 0;
    summary.fmWriteEventCount += frame.fmWriteEventCount || 0;
    summary.mixedWriteEventCount += frame.mixedWriteEventCount || 0;

    const portCounts = { ...(frame.portCounts || {}) };
    const branchCounts = { ...(frame.branchCounts || {}) };
    const inputCounts = { ...(frame.inputFieldKeyCounts || {}) };
    const activeChannelCounts = { ...(frame.activeChannelCounts || {}) };
    for (const [port, count] of Object.entries(portCounts)) {
      ports.add(port);
      zoneAudioCountObjectKey(summary.portCounts, port, count || 0);
    }
    for (const [branch, count] of Object.entries(branchCounts)) {
      branches.add(branch);
      zoneAudioCountObjectKey(summary.branchCounts, branch, count || 0);
    }
    for (const [key, count] of Object.entries(inputCounts)) {
      inputFieldKeys.add(key);
      zoneAudioCountObjectKey(summary.inputFieldKeyCounts, key, count || 0);
    }
    for (const [channel, count] of Object.entries(activeChannelCounts)) {
      activeChannels.add(channel);
      zoneAudioCountObjectKey(summary.activeChannelCounts, channel, count || 0);
    }
    for (const id of frame.phaseFixtureIds || []) phaseFixtureIds.add(id);
    for (const id of frame.writeFixtureIds || []) writeFixtureIds.add(id);

    return {
      index: Number.isInteger(frame.index) ? frame.index : index,
      frame: Number.isInteger(frame.frame) ? frame.frame : null,
      frameKey: frame.frameKey || '',
      frameStatus: frame.frameStatus || '',
      intentKind,
      eventCount: frame.eventCount || 0,
      phaseEventCount: frame.phaseEventCount || 0,
      writeEventCount: frame.writeEventCount || 0,
      selectedEventCount: frame.selectedEventCount || 0,
      selectedPhaseEventCount: frame.selectedPhaseEventCount || 0,
      selectedWriteEventCount: frame.selectedWriteEventCount || 0,
      psgEventCount: frame.psgEventCount || 0,
      fmEventCount: frame.fmEventCount || 0,
      mixedEventCount: frame.mixedEventCount || 0,
      psgWriteEventCount: frame.psgWriteEventCount || 0,
      fmWriteEventCount: frame.fmWriteEventCount || 0,
      mixedWriteEventCount: frame.mixedWriteEventCount || 0,
      portCounts,
      branchCounts,
      inputFieldKeyCounts: inputCounts,
      activeChannelCounts,
      phaseFixtureIds: (frame.phaseFixtureIds || []).slice().sort(),
      writeFixtureIds: (frame.writeFixtureIds || []).slice().sort(),
      assetPolicy: 'metadata_only_register_intent_no_values_or_samples',
    };
  });

  summary.uniquePhaseFixtureCount = phaseFixtureIds.size;
  summary.uniqueWriteFixtureCount = writeFixtureIds.size;
  summary.portKindCount = ports.size;
  summary.branchKindCount = branches.size;
  summary.inputFieldKeyCount = inputFieldKeys.size;
  summary.activeChannelCount = activeChannels.size;

  return {
    id: `zone_audio_runtime_output_register_intent_${Date.now()}`,
    frameTimelineId: frameTimeline?.id || '',
    recipeId: frameTimeline?.recipeId || '',
    requestId: frameTimeline?.requestId || '',
    outputModeFilter: frameTimeline?.outputModeFilter || 'all',
    frames,
    summary,
    assetPolicy: summary.assetPolicy,
  };
}

function zoneAudioRuntimeOutputRegisterIntentSummaryHtml(model) {
  if (!model?.summary?.eventCount) return '';
  const summary = model.summary;
  const parts = [
    `${summary.frameCount || 0} frame intent(s)`,
    `PSG/FM/mixed/idle ${summary.psgOnlyFrameCount || 0}/${summary.fmOnlyFrameCount || 0}/${summary.mixedFrameCount || 0}/${summary.noWriteFrameCount || 0}`,
    `writes ${summary.writeEventCount || 0}`,
    `PSG/FM ${summary.psgWriteEventCount || 0}/${summary.fmWriteEventCount || 0}`,
    `fixtures ${summary.uniquePhaseFixtureCount || 0}/${summary.uniqueWriteFixtureCount || 0}`,
    `inputs ${summary.inputFieldKeyCount || 0}`,
    'no values',
  ];
  return `<div style="padding-left:10px;color:#38bdf8">runtime PSG/FM register intent ${simEscapeHtml(parts.join(' · '))}</div>`;
}

function zoneAudioRuntimeOutputPortPhaseKind(port) {
  if (port === 'Port_PSG') return 'psg_data';
  if (port === 'Port_FMAddress') return 'fm_address';
  if (port === 'Port_FMData') return 'fm_data';
  return port ? 'other_port' : 'unresolved_port';
}

function zoneAudioRuntimeOutputChannelPortGroupKey(event) {
  return [
    zoneAudioRuntimeFrameKey(event),
    event.activeChannel || 'unclassified_channel',
    event.chip || 'mixed',
    event.port || 'unresolved_port',
    zoneAudioRuntimeOutputPortPhaseKind(event.port || ''),
    event.branchId || 'unclassified_branch',
  ].join('|');
}

function zoneAudioBuildRuntimeOutputChannelPortIntentModel(sink) {
  const groups = new Map();
  const frames = new Set();
  const phaseFixtureIds = new Set();
  const writeFixtureIds = new Set();
  const ports = new Set();
  const branches = new Set();
  const inputFieldKeys = new Set();
  const activeChannels = new Set();
  const phaseKinds = new Set();
  const sourceEventKinds = new Set();
  const sourceEventRoles = new Set();
  const sourceTraceOperationKinds = new Set();
  const sourceTraceTargets = new Set();
  const sourceRamFieldKeys = new Set();
  const sourceUnresolvedRamFieldKeys = new Set();
  const summary = {
    groupCount: 0,
    frameCount: 0,
    frameLinkedGroupCount: 0,
    frameUnlinkedGroupCount: 0,
    writeEventCount: 0,
    selectedWriteEventCount: 0,
    psgWriteEventCount: 0,
    fmWriteEventCount: 0,
    fmAddressWriteEventCount: 0,
    fmDataWriteEventCount: 0,
    mixedWriteEventCount: 0,
    uniquePhaseFixtureCount: 0,
    uniqueWriteFixtureCount: 0,
    portKindCount: 0,
    branchKindCount: 0,
    inputFieldKeyCount: 0,
    activeChannelCount: 0,
    phaseKindCount: 0,
    sourceEventKindCount: 0,
    sourceEventRoleCount: 0,
    sourceTraceOperationKindCount: 0,
    sourceTraceTargetCount: 0,
    sourceRamFieldKeyCount: 0,
    sourceUnresolvedRamFieldKeyCount: 0,
    sourceTraceLinkedWriteCount: 0,
    sourceRamLinkedWriteCount: 0,
    sourceUnresolvedRamLinkedWriteCount: 0,
    portCounts: {},
    branchCounts: {},
    activeChannelCounts: {},
    inputFieldKeyCounts: {},
    phaseKindCounts: {},
    sourceEventKindCounts: {},
    sourceEventRoleCounts: {},
    sourceTraceOperationKindCounts: {},
    sourceTraceTargetCounts: {},
    sourceRamFieldKeyCounts: {},
    sourceUnresolvedRamFieldKeyCounts: {},
    persistedRegisterValueCount: 0,
    persistedRegisterTraceCount: 0,
    persistedSampleCount: 0,
    persistedAudioByteCount: 0,
    persistedRomByteCount: 0,
    assetPolicy: 'metadata_only_channel_port_intent_no_values_or_samples',
  };

  for (const event of sink?.events || []) {
    if (event.kind !== 'audio_port_write_fixture') continue;
    const frameKey = zoneAudioRuntimeFrameKey(event);
    const phaseKind = zoneAudioRuntimeOutputPortPhaseKind(event.port || '');
    const groupKey = zoneAudioRuntimeOutputChannelPortGroupKey(event);
    let group = groups.get(groupKey);
    if (!group) {
      group = {
        groupKey,
        frame: Number.isInteger(event.frame) ? event.frame : null,
        frameKey,
        frameStatus: event.frameStatus || '',
        activeChannel: event.activeChannel || '',
        chip: event.chip || '',
        port: event.port || '',
        phaseKind,
        branchId: event.branchId || '',
        writeEventCount: 0,
        selectedWriteEventCount: 0,
        psgWriteEventCount: 0,
        fmWriteEventCount: 0,
        fmAddressWriteEventCount: 0,
        fmDataWriteEventCount: 0,
        mixedWriteEventCount: 0,
        inputFieldKeyCounts: {},
        sourceEventKindCounts: {},
        sourceEventRoleCounts: {},
        sourceTraceOperationKindCounts: {},
        sourceTraceTargetCounts: {},
        sourceRamFieldKeyCounts: {},
        sourceUnresolvedRamFieldKeyCounts: {},
        phaseFixtureIds: new Set(),
        writeFixtureIds: new Set(),
      };
      groups.set(groupKey, group);
      if (group.frameStatus === 'frame_step_linked') summary.frameLinkedGroupCount++;
      else summary.frameUnlinkedGroupCount++;
    }

    frames.add(frameKey);
    summary.writeEventCount++;
    group.writeEventCount++;
    if (event.selectedByOutputModeFilter) {
      summary.selectedWriteEventCount++;
      group.selectedWriteEventCount++;
    }

    if (event.chip === 'psg') {
      summary.psgWriteEventCount++;
      group.psgWriteEventCount++;
    } else if (event.chip === 'fm') {
      summary.fmWriteEventCount++;
      group.fmWriteEventCount++;
    } else {
      summary.mixedWriteEventCount++;
      group.mixedWriteEventCount++;
    }
    if (phaseKind === 'fm_address') {
      summary.fmAddressWriteEventCount++;
      group.fmAddressWriteEventCount++;
    } else if (phaseKind === 'fm_data') {
      summary.fmDataWriteEventCount++;
      group.fmDataWriteEventCount++;
    }

    if (event.port) {
      ports.add(event.port);
      zoneAudioCountObjectKey(summary.portCounts, event.port);
    }
    if (event.branchId) {
      branches.add(event.branchId);
      zoneAudioCountObjectKey(summary.branchCounts, event.branchId);
    }
    if (event.activeChannel) {
      activeChannels.add(event.activeChannel);
      zoneAudioCountObjectKey(summary.activeChannelCounts, event.activeChannel);
    }
    phaseKinds.add(phaseKind);
    zoneAudioCountObjectKey(summary.phaseKindCounts, phaseKind);
    if (event.sourceEventKind) {
      sourceEventKinds.add(event.sourceEventKind);
      zoneAudioCountObjectKey(summary.sourceEventKindCounts, event.sourceEventKind);
      zoneAudioCountObjectKey(group.sourceEventKindCounts, event.sourceEventKind);
    }
    if (event.sourceEventRole) {
      sourceEventRoles.add(event.sourceEventRole);
      zoneAudioCountObjectKey(summary.sourceEventRoleCounts, event.sourceEventRole);
      zoneAudioCountObjectKey(group.sourceEventRoleCounts, event.sourceEventRole);
    }
    if ((event.sourceTraceOperationKinds || []).length || (event.sourceTraceTargetLabels || []).length) {
      summary.sourceTraceLinkedWriteCount++;
    }
    if ((event.sourceRamFieldKeys || []).length) {
      summary.sourceRamLinkedWriteCount++;
    }
    if ((event.sourceUnresolvedRamFieldKeys || []).length) {
      summary.sourceUnresolvedRamLinkedWriteCount++;
    }
    for (const kind of event.sourceTraceOperationKinds || []) {
      sourceTraceOperationKinds.add(kind);
      zoneAudioCountObjectKey(summary.sourceTraceOperationKindCounts, kind);
      zoneAudioCountObjectKey(group.sourceTraceOperationKindCounts, kind);
    }
    for (const target of event.sourceTraceTargetLabels || []) {
      sourceTraceTargets.add(target);
      zoneAudioCountObjectKey(summary.sourceTraceTargetCounts, target);
      zoneAudioCountObjectKey(group.sourceTraceTargetCounts, target);
    }
    for (const key of event.sourceRamFieldKeys || []) {
      sourceRamFieldKeys.add(key);
      zoneAudioCountObjectKey(summary.sourceRamFieldKeyCounts, key);
      zoneAudioCountObjectKey(group.sourceRamFieldKeyCounts, key);
    }
    for (const key of event.sourceUnresolvedRamFieldKeys || []) {
      sourceUnresolvedRamFieldKeys.add(key);
      zoneAudioCountObjectKey(summary.sourceUnresolvedRamFieldKeyCounts, key);
      zoneAudioCountObjectKey(group.sourceUnresolvedRamFieldKeyCounts, key);
    }
    for (const key of event.inputFieldKeys || []) {
      inputFieldKeys.add(key);
      zoneAudioCountObjectKey(summary.inputFieldKeyCounts, key);
      zoneAudioCountObjectKey(group.inputFieldKeyCounts, key);
    }
    if (event.phaseFixtureId) {
      phaseFixtureIds.add(event.phaseFixtureId);
      group.phaseFixtureIds.add(event.phaseFixtureId);
    }
    if (event.writeFixtureId) {
      writeFixtureIds.add(event.writeFixtureId);
      group.writeFixtureIds.add(event.writeFixtureId);
    }
  }

  summary.groupCount = groups.size;
  summary.frameCount = frames.size;
  summary.uniquePhaseFixtureCount = phaseFixtureIds.size;
  summary.uniqueWriteFixtureCount = writeFixtureIds.size;
  summary.portKindCount = ports.size;
  summary.branchKindCount = branches.size;
  summary.inputFieldKeyCount = inputFieldKeys.size;
  summary.activeChannelCount = activeChannels.size;
  summary.phaseKindCount = phaseKinds.size;
  summary.sourceEventKindCount = sourceEventKinds.size;
  summary.sourceEventRoleCount = sourceEventRoles.size;
  summary.sourceTraceOperationKindCount = sourceTraceOperationKinds.size;
  summary.sourceTraceTargetCount = sourceTraceTargets.size;
  summary.sourceRamFieldKeyCount = sourceRamFieldKeys.size;
  summary.sourceUnresolvedRamFieldKeyCount = sourceUnresolvedRamFieldKeys.size;

  const sortedGroups = [...groups.values()].sort((a, b) => {
    const af = Number.isInteger(a.frame) ? a.frame : Number.MAX_SAFE_INTEGER;
    const bf = Number.isInteger(b.frame) ? b.frame : Number.MAX_SAFE_INTEGER;
    return af - bf ||
      String(a.frameKey || '').localeCompare(String(b.frameKey || '')) ||
      String(a.activeChannel || '').localeCompare(String(b.activeChannel || '')) ||
      String(a.port || '').localeCompare(String(b.port || '')) ||
      String(a.branchId || '').localeCompare(String(b.branchId || ''));
  }).map((group, index) => ({
    index,
    groupKey: group.groupKey,
    frame: group.frame,
    frameKey: group.frameKey,
    frameStatus: group.frameStatus,
    activeChannel: group.activeChannel,
    chip: group.chip,
    port: group.port,
    phaseKind: group.phaseKind,
    branchId: group.branchId,
    writeEventCount: group.writeEventCount,
    selectedWriteEventCount: group.selectedWriteEventCount,
    psgWriteEventCount: group.psgWriteEventCount,
    fmWriteEventCount: group.fmWriteEventCount,
    fmAddressWriteEventCount: group.fmAddressWriteEventCount,
    fmDataWriteEventCount: group.fmDataWriteEventCount,
    mixedWriteEventCount: group.mixedWriteEventCount,
    inputFieldKeyCounts: group.inputFieldKeyCounts,
    sourceEventKindCounts: group.sourceEventKindCounts,
    sourceEventRoleCounts: group.sourceEventRoleCounts,
    sourceTraceOperationKindCounts: group.sourceTraceOperationKindCounts,
    sourceTraceTargetCounts: group.sourceTraceTargetCounts,
    sourceRamFieldKeyCounts: group.sourceRamFieldKeyCounts,
    sourceUnresolvedRamFieldKeyCounts: group.sourceUnresolvedRamFieldKeyCounts,
    phaseFixtureIds: [...group.phaseFixtureIds].sort(),
    writeFixtureIds: [...group.writeFixtureIds].sort(),
    assetPolicy: 'metadata_only_channel_port_intent_no_values_or_samples',
  }));

  return {
    id: `zone_audio_runtime_output_channel_port_intent_${Date.now()}`,
    sinkId: sink?.id || '',
    recipeId: sink?.recipeId || '',
    requestId: sink?.requestId || '',
    outputModeFilter: sink?.outputModeFilter || 'all',
    groups: sortedGroups,
    summary,
    assetPolicy: summary.assetPolicy,
  };
}

function zoneAudioRuntimeOutputChannelPortIntentSummaryHtml(model) {
  if (!model?.summary?.writeEventCount) return '';
  const summary = model.summary;
  const parts = [
    `${summary.groupCount || 0} channel/port group(s)`,
    `frames ${summary.frameCount || 0}`,
    `writes ${summary.writeEventCount || 0}`,
    `PSG/FM ${summary.psgWriteEventCount || 0}/${summary.fmWriteEventCount || 0}`,
    `FM addr/data ${summary.fmAddressWriteEventCount || 0}/${summary.fmDataWriteEventCount || 0}`,
    `channels ${summary.activeChannelCount || 0}`,
    `source roles ${summary.sourceEventRoleCount || 0}`,
    `trace ${summary.sourceTraceOperationKindCount || 0}/${summary.sourceRamFieldKeyCount || 0}`,
    `fixtures ${summary.uniquePhaseFixtureCount || 0}/${summary.uniqueWriteFixtureCount || 0}`,
    'no values',
  ];
  return `<div style="padding-left:10px;color:#93c5fd">runtime channel/port intent ${simEscapeHtml(parts.join(' · '))}</div>`;
}

function zoneAudioCatalogEventTraceSemantics(event) {
  const catalog = zoneAudioEventTraceSemanticsCatalog();
  if (!catalog) return null;
  const key = event?.kind === 'control' ? event.opcode : 'note_or_rest_byte';
  return (catalog.traceSemantics || []).find(entry => entry.eventKey === key) || null;
}

function zoneAudioResolveTraceTarget(target, channel) {
  if (!target) return null;
  if (target.kind === 'stream_field') return zoneAudioRamFieldRef('stream', channel, target.fieldName);
  if (target.kind === 'hardware_shadow_field') return zoneAudioRamFieldRef('hardware', channel, target.fieldName);
  if (target.kind === 'global_ram') return zoneAudioGlobalRamRef(target.role);
  return null;
}

function zoneAudioTraceTargetLabel(target, resolved) {
  if (resolved?.address && resolved?.name) return `${resolved.address} ${resolved.name}`;
  if (!target) return '?';
  if (target.kind === 'stream_field') return `stream.${target.fieldName || '?'}`;
  if (target.kind === 'hardware_shadow_field') return `hardware.${target.fieldName || '?'}`;
  if (target.kind === 'global_ram') return `global.${target.role || '?'}`;
  return target.kind || '?';
}

function zoneAudioTraceValueText(operation, event) {
  if (!operation || !event) return '';
  if (operation.argIndex != null) {
    const value = event.argsHex?.[operation.argIndex];
    return value ? `=${value}` : '=arg?';
  }
  if (Array.isArray(operation.argIndices)) {
    if (event.branchTarget?.z80TargetHex) return `=${event.branchTarget.z80TargetHex}`;
    const parts = operation.argIndices.map(index => event.argsHex?.[index] || '??');
    return parts.length ? `=${parts.join(' ')}` : '=ptr?';
  }
  if (operation.kind === 'advance_stream_pointer' && event.nextZ80PointerHex) return `=${event.nextZ80PointerHex}`;
  if (operation.kind === 'advance_or_loop_stream_pointer') return event.nextZ80PointerHex ? `=${event.nextZ80PointerHex}/loop` : '=advance/loop';
  if (operation.kind === 'branch_pointer_arg' && event.branchTarget?.z80TargetHex) return `=${event.branchTarget.z80TargetHex}`;
  if (operation.kind === 'add_arg_clamped' && operation.clampMax != null) return `<=${_fmt2(operation.clampMax)}`;
  if (operation.valueSource) return `=${operation.valueSource}`;
  return '';
}

function zoneAudioTraceOperationVerb(kind) {
  const labels = {
    reload_or_decrement_delay: 'delay',
    advance_stream_pointer: 'advance',
    touch_output_volume: 'touch',
    touch_output_pitch_step: 'touch',
    store_arg: 'store',
    conditional_store_arg: 'store?',
    touch_compare_cache: 'touch',
    add_arg: 'add',
    add_arg_clamped: 'add/clamp',
    lookup_store: 'lookup',
    save_pointer_context: 'save',
    store_context_byte: 'store',
    branch_pointer_arg: 'branch',
    test_decrement: 'dec?',
    maybe_reload_pointer: 'reload?',
    maybe_clear: 'clear?',
    advance_or_loop_stream_pointer: 'advance?',
  };
  return labels[kind] || kind || 'op';
}

function zoneAudioEventTraceOperations(event, channel) {
  const semantics = zoneAudioCatalogEventTraceSemantics(event);
  const operations = [];
  for (const operation of semantics?.operations || []) {
    const resolved = zoneAudioResolveTraceTarget(operation.target, channel);
    const modelRule = zoneAudioTraceModelRule(operation.kind);
    const lookupIndex = operation.lookup && operation.argIndex != null
      ? zoneAudioTraceKnownArg(event, operation.argIndex)
      : null;
    const lookupResolution = operation.lookup
      ? zoneAudioSupportLookup(operation.lookup, lookupIndex)
      : null;
    const lookupValueText = zoneAudioLookupValueText(lookupResolution);
    operations.push({
      kind: operation.kind || 'trace',
      verb: zoneAudioTraceOperationVerb(operation.kind),
      target: operation.target || null,
      targetRef: resolved,
      targetLabel: zoneAudioTraceTargetLabel(operation.target, resolved),
      valueText: lookupValueText || zoneAudioTraceValueText(operation, event),
      argIndex: operation.argIndex,
      argIndices: Array.isArray(operation.argIndices) ? [...operation.argIndices] : null,
      clampMax: operation.clampMax,
      lookup: operation.lookup || '',
      lookupResolution,
      valueSource: operation.valueSource || modelRule?.valueSource || '',
      modelRule,
      application: modelRule?.application || '',
      certainty: modelRule?.certainty || '',
      confidence: operation.confidence || '',
      summary: operation.summary || '',
      condition: operation.condition || '',
    });
  }
  return operations;
}

function zoneAudioTraceFieldKey(operation) {
  const ref = operation?.targetRef;
  if (ref?.kind && ref?.address && ref?.name) return `${ref.kind}|${ref.address}|${ref.name}`;
  return `unresolved|${operation?.targetLabel || '?'}`;
}

function zoneAudioTraceFieldLabel(operation) {
  const ref = operation?.targetRef;
  if (ref?.address && ref?.name) return `${ref.address} ${ref.name}`;
  return operation?.targetLabel || '?';
}

function zoneAudioTraceKnownArg(event, argIndex) {
  if (argIndex == null || !Array.isArray(event?.args)) return null;
  const value = event.args[argIndex];
  return Number.isInteger(value) ? (value & 0xFF) : null;
}

function zoneAudioTraceKnownPointerFromArgs(event) {
  if (event?.branchTarget?.z80TargetHex) return event.branchTarget.z80TargetHex;
  const indices = event?.tracePointerArgIndices || [];
  if (indices.length < 2 || !Array.isArray(event?.args)) return '';
  const lo = event.args[indices[0]];
  const hi = event.args[indices[1]];
  if (!Number.isInteger(lo) || !Number.isInteger(hi)) return '';
  return _fmt4((lo & 0xFF) | ((hi & 0xFF) << 8));
}

function zoneAudioTraceApplyValue(operation, event, previousField) {
  const application = operation.application || operation.modelRule?.application || operation.kind || '';
  const arg = zoneAudioTraceKnownArg(event, operation.argIndex);
  const argText = arg == null ? 'arg?' : _fmt2(arg);
  const previousKnownByte = previousField?.valueType === 'byte' &&
    previousField?.status === 'known' &&
    Number.isInteger(previousField.numericValue);

  if (application === 'write_known_byte') {
    return arg == null
      ? { status: 'unresolved', valueType: 'byte', valueText: 'arg?' }
      : { status: 'known', valueType: 'byte', valueText: _fmt2(arg), numericValue: arg };
  }

  if (application === 'write_known_byte_if_condition_matches') {
    return arg == null
      ? { status: 'conditional', valueType: 'byte', valueText: 'arg?', conditional: true }
      : { status: 'conditional', valueType: 'byte', valueText: `${_fmt2(arg)}?`, numericValue: arg, conditional: true };
  }

  if (application === 'add_known_delta' || application === 'add_known_delta_with_clamp') {
    if (arg == null) return { status: 'unresolved', valueType: 'byte', valueText: '+=arg?' };
    if (previousKnownByte) {
      let value = (previousField.numericValue + arg) & 0xFF;
      if (application === 'add_known_delta_with_clamp' && operation.clampMax != null) {
        value = Math.min(value, operation.clampMax & 0xFF);
      }
      return { status: 'known', valueType: 'byte', valueText: _fmt2(value), numericValue: value };
    }
    const clamp = application === 'add_known_delta_with_clamp' && operation.clampMax != null
      ? ` <=${_fmt2(operation.clampMax)}`
      : '';
    return { status: 'symbolic', valueType: 'byte', valueText: `+=${argText}${clamp}` };
  }

  if (application === 'write_known_pointer') {
    const pointer = operation.kind === 'branch_pointer_arg'
      ? (event.branchTarget?.z80TargetHex || zoneAudioTraceKnownPointerFromArgs({ ...event, tracePointerArgIndices: operation.argIndices || [] }))
      : event.nextZ80PointerHex;
    return pointer
      ? { status: 'known', valueType: 'pointer', valueText: pointer }
      : { status: 'unresolved', valueType: 'pointer', valueText: 'ptr?' };
  }

  if (application === 'write_conditional_pointer_candidate') {
    return {
      status: 'conditional',
      valueType: 'pointer',
      valueText: event.nextZ80PointerHex ? `${event.nextZ80PointerHex}/loop?` : 'advance/loop?',
      conditional: true,
    };
  }

  if (application === 'save_pointer_context') {
    return {
      status: 'contextual',
      valueType: 'pointer',
      valueText: event.nextZ80PointerHex ? `ctx ${event.nextZ80PointerHex}` : 'ctx ptr?',
    };
  }

  if (application === 'mark_context_byte_write') {
    return { status: 'unresolved', valueType: 'byte', valueText: 'context byte' };
  }

  if (application === 'test_and_decrement_previous_value') {
    if (previousKnownByte) {
      const value = (previousField.numericValue - 1) & 0xFF;
      return { status: 'conditional', valueType: 'byte', valueText: `${_fmt2(value)}?`, numericValue: value, conditional: true };
    }
    return { status: 'conditional', valueType: 'byte', valueText: 'dec?', conditional: true };
  }

  if (application === 'conditional_pointer_reload') {
    return { status: 'conditional', valueType: 'pointer', valueText: 'reload source?', conditional: true };
  }

  if (application === 'conditional_clear') {
    return { status: 'conditional', valueType: 'byte', valueText: '0?', numericValue: 0, conditional: true };
  }

  if (application === 'mark_lookup_result') {
    const lookup = operation.lookupResolution || zoneAudioSupportLookup(operation.lookup, arg);
    if (lookup?.status === 'resolved') {
      return { status: 'known', valueType: 'byte', valueText: lookup.valueHex, numericValue: lookup.value };
    }
    const detail = lookup?.status && lookup.status !== 'unresolved' ? ` ${lookup.status}` : '';
    return { status: 'unresolved', valueType: 'byte', valueText: `lookup(${argText}${detail})` };
  }

  if (application === 'mark_delay_update') {
    return { status: 'unresolved', valueType: 'byte', valueText: 'timing update' };
  }

  if (application === 'mark_output_consumer_touch' || application === 'mark_compare_cache_touch') {
    return { status: 'touched', valueType: 'touch', valueText: 'touched' };
  }

  return { status: 'unresolved', valueType: 'unknown', valueText: operation.valueText || 'op?' };
}

function zoneAudioRecordTraceStateValue(fields, summary, operation, event, value) {
  summary.operationCount++;
  const key = zoneAudioTraceFieldKey(operation);
  const previous = fields.get(key) || null;
  const keepPreviousValue = value.status === 'touched' && previous;
  const field = {
    key,
    label: zoneAudioTraceFieldLabel(operation),
    targetKind: operation.targetRef?.kind || operation.target?.kind || '',
    operationCount: (previous?.operationCount || 0) + 1,
    status: keepPreviousValue ? previous.status : (value.status || previous?.status || 'unresolved'),
    valueType: keepPreviousValue ? previous.valueType : (value.valueType || previous?.valueType || ''),
    valueText: keepPreviousValue ? previous.valueText : (value.valueText || previous?.valueText || ''),
    numericValue: keepPreviousValue
      ? previous.numericValue
      : (Number.isInteger(value.numericValue) ? value.numericValue : undefined),
    lastEventOffset: event?.offsetHex || '',
    lastOperationKind: operation.kind || '',
    lastApplication: operation.application || '',
    conditional: Boolean(value.conditional || previous?.conditional || operation.modelRule?.conditional),
  };
  fields.set(key, field);

  if (value.status === 'known') summary.knownOperationCount++;
  else if (value.status === 'conditional') summary.conditionalOperationCount++;
  else if (value.status === 'touched') summary.touchedOperationCount++;
  else summary.unresolvedOperationCount++;
  return field;
}

function zoneAudioTraceOperationForStreamField(channel, fieldName, kind, application) {
  const target = { kind: 'stream_field', fieldName };
  const targetRef = zoneAudioRamFieldRef('stream', channel, fieldName);
  return {
    kind,
    target,
    targetRef,
    targetLabel: zoneAudioTraceTargetLabel(target, targetRef),
    application,
    modelRule: { conditional: false },
  };
}

function zoneAudioTraceOperationForHardwareField(channel, fieldName, kind, application) {
  const target = { kind: 'hardware_shadow_field', fieldName };
  const targetRef = zoneAudioRamFieldRef('hardware', channel, fieldName);
  return {
    kind,
    target,
    targetRef,
    targetLabel: zoneAudioTraceTargetLabel(target, targetRef),
    application,
    modelRule: { conditional: false },
  };
}

function zoneAudioTraceStateField(fields, channel, fieldName) {
  const operation = zoneAudioTraceOperationForStreamField(channel, fieldName, 'trace_field_read', 'read_synthetic_field');
  return fields.get(zoneAudioTraceFieldKey(operation)) || null;
}

function zoneAudioTraceStateResolvedField(fields, channel, kind, fieldName) {
  const operation = kind === 'hardware_shadow_field'
    ? zoneAudioTraceOperationForHardwareField(channel, fieldName, 'trace_field_read', 'read_synthetic_field')
    : zoneAudioTraceOperationForStreamField(channel, fieldName, 'trace_field_read', 'read_synthetic_field');
  return fields.get(zoneAudioTraceFieldKey(operation)) || null;
}

function zoneAudioTraceStateFieldByMatchedRef(fields, channel, matchedRef) {
  const key = matchedRef?.key || '';
  const match = String(key).match(/^(hardware|stream):(.+)$/);
  if (!match) return null;
  const kind = match[1] === 'hardware' ? 'hardware_shadow_field' : 'stream_field';
  return zoneAudioTraceStateResolvedField(fields, channel, kind, match[2]);
}

function zoneAudioTraceKnownByteField(fields, channel, fieldName) {
  const field = zoneAudioTraceStateField(fields, channel, fieldName);
  if (field?.status === 'known' && Number.isInteger(field.numericValue)) {
    const value = field.numericValue & 0xFF;
    return {
      known: true,
      field,
      value,
      valueHex: _fmt2(value),
    };
  }
  return {
    known: false,
    field,
    reason: field ? `${field.status || 'unknown'} ${field.valueText || ''}`.trim() : 'missing',
  };
}

function zoneAudioAnalyzeFrameGate(fields, channel) {
  const catalog = zoneAudioFrameGateCatalog();
  if (!catalog) return null;
  const result = {
    status: 'unresolved',
    source: 'preview_final_trace_state',
    catalogId: catalog.id || '',
    outcome: 'unresolved',
    fetchEvent: false,
    waitGate: '',
    reason: '',
    activeGateStatus: 'unknown',
    resetPath: false,
    primaryBeforeHex: '',
    primaryAfterHex: '',
    secondaryBeforeHex: '',
    secondaryAfterHex: '',
    streamFlagsHex: '',
  };

  const flags = zoneAudioTraceKnownByteField(fields, channel, 'stream_flags');
  if (flags.known) {
    result.streamFlagsHex = flags.valueHex;
    if ((flags.value & 0x01) === 0) {
      return {
        ...result,
        status: 'known',
        activeGateStatus: 'inactive',
        outcome: 'inactive_stream_flag',
        reason: 'stream_flags bit 0 clear',
      };
    }
    result.activeGateStatus = 'active';
    if (flags.value & 0x10) {
      return {
        ...result,
        status: 'known',
        outcome: 'fetch_reset_path',
        fetchEvent: true,
        resetPath: true,
        reason: 'stream_flags bit 4 set',
      };
    }
  } else {
    result.activeGateReason = flags.reason;
  }

  const primary = zoneAudioTraceKnownByteField(fields, channel, 'note_delay_counter');
  if (!primary.known) {
    result.reason = `note_delay_counter ${primary.reason}`;
    return result;
  }
  result.primaryBeforeHex = primary.valueHex;
  if (primary.value > 1) {
    const secondary = zoneAudioTraceKnownByteField(fields, channel, 'secondary_delay_counter');
    result.primaryAfterHex = _fmt2((primary.value - 1) & 0xFF);
    if (secondary.known) {
      result.secondaryBeforeHex = secondary.valueHex;
      result.secondaryAfterHex = _fmt2((secondary.value - 1) & 0xFF);
    } else {
      result.secondaryReason = secondary.reason;
    }
    return {
      ...result,
      status: 'known',
      outcome: 'wait_primary_delay',
      waitGate: 'primary',
      reason: 'primary delay remains nonzero after decrement',
    };
  }

  result.primaryAfterHex = _fmt2(primary.value === 1 ? 0 : primary.value);
  const secondary = zoneAudioTraceKnownByteField(fields, channel, 'secondary_delay_counter');
  if (!secondary.known) {
    result.reason = `secondary_delay_counter ${secondary.reason}`;
    return result;
  }
  result.secondaryBeforeHex = secondary.valueHex;
  if (secondary.value > 1) {
    result.secondaryAfterHex = _fmt2((secondary.value - 1) & 0xFF);
    return {
      ...result,
      status: 'known',
      outcome: 'wait_secondary_delay',
      waitGate: 'secondary',
      reason: 'secondary delay remains nonzero after decrement',
    };
  }

  result.secondaryAfterHex = _fmt2(secondary.value === 1 ? 0 : secondary.value);
  return {
    ...result,
    status: 'known',
    outcome: 'fetch_event',
    fetchEvent: true,
    reason: 'both delay gates allow event fetch',
  };
}

function zoneAudioFrameGateText(gate) {
  if (!gate) return '';
  if (gate.status !== 'known') return `gate unresolved ${gate.reason || 'state unknown'}`;
  if (gate.outcome === 'inactive_stream_flag') return `gate wait inactive`;
  if (gate.outcome === 'fetch_reset_path') return `gate fetch reset`;
  const primary = gate.primaryBeforeHex ? `p ${gate.primaryBeforeHex}->${gate.primaryAfterHex || '?'}` : '';
  const secondary = gate.secondaryBeforeHex ? `s ${gate.secondaryBeforeHex}->${gate.secondaryAfterHex || '?'}` : '';
  const counters = [primary, secondary].filter(Boolean).join(' ');
  if (gate.fetchEvent) return `gate fetch${counters ? ` ${counters}` : ''}`;
  return `gate wait ${gate.waitGate || '?'}${counters ? ` ${counters}` : ''}`;
}

function zoneAudioRequestSeed(requestId) {
  if (requestId == null) return null;
  const catalog = zoneAudioStreamSeedCatalog();
  if (!catalog) return null;
  return (catalog.requests || []).find(request =>
    request.requestId === requestId || request.requestIdHex === _fmt2(requestId)
  ) || null;
}

function zoneAudioChannelSeed(requestSeed, channel) {
  if (!requestSeed || !channel) return null;
  const channelId = channel.channelId;
  const root = channel.rootStreamOffset || '';
  return (requestSeed.seedChannels || []).find(seed =>
    seed.channelId === channelId && seed.streamPointer?.romOffset === root
  ) || (requestSeed.seedChannels || []).find(seed => seed.channelId === channelId) || null;
}

function zoneAudioSeedWriteByField(seed, fieldName) {
  return (seed?.immediateRequestLoader?.streamWrites || []).find(write => write.fieldName === fieldName) || null;
}

function zoneAudioSeedText(seed) {
  if (!seed) return '';
  const flags = zoneAudioSeedWriteByField(seed, 'stream_flags');
  const pointer = zoneAudioSeedWriteByField(seed, 'current_stream_pointer');
  const priority = seed.immediateRequestLoader?.priorityWrite || null;
  const gate = seed.initialFrameGateImplication?.expectedOutcome || '';
  const parts = [];
  if (flags) parts.push(`flags ${flags.value}@${flags.address || '?'}`);
  if (pointer) parts.push(`ptr ${pointer.value || '?'}${pointer.romOffset ? `/${pointer.romOffset}` : ''}@${pointer.address || '?'}`);
  if (priority) parts.push(`priority ${priority.value || '?'}@${priority.address || '?'}`);
  if (gate) parts.push(`first gate ${gate}`);
  return parts.join(' · ');
}

function zoneAudioSeedHtml(seed) {
  const text = zoneAudioSeedText(seed);
  if (!text) return '';
  return `<div style="padding-left:10px;color:#9ae6b4">seed ${simEscapeHtml(text)}</div>`;
}

function zoneAudioRecordKnownStreamByte(fields, summary, channel, fieldName, value, event, kind) {
  const operation = zoneAudioTraceOperationForStreamField(
    channel,
    fieldName,
    kind || 'frame_step_state',
    'write_known_byte'
  );
  return zoneAudioRecordTraceStateValue(fields, summary, operation, event || null, {
    status: 'known',
    valueType: 'byte',
    valueText: _fmt2(value & 0xFF),
    numericValue: value & 0xFF,
  });
}

function zoneAudioRecordKnownHardwareByte(fields, summary, channel, fieldName, value, event, kind) {
  const operation = zoneAudioTraceOperationForHardwareField(
    channel,
    fieldName,
    kind || 'hardware_shadow_state',
    'write_known_byte'
  );
  return zoneAudioRecordTraceStateValue(fields, summary, operation, event || null, {
    status: 'known',
    valueType: 'byte',
    valueText: _fmt2(value & 0xFF),
    numericValue: value & 0xFF,
  });
}

function zoneAudioRecordConditionalHardwareByte(fields, summary, channel, fieldName, valueText, event, kind, numericValue) {
  const operation = zoneAudioTraceOperationForHardwareField(
    channel,
    fieldName,
    kind || 'hardware_shadow_conditional_state',
    'write_conditional_byte'
  );
  return zoneAudioRecordTraceStateValue(fields, summary, operation, event || null, {
    status: 'conditional',
    valueType: 'byte',
    valueText,
    numericValue: Number.isInteger(numericValue) ? (numericValue & 0xFF) : undefined,
    conditional: true,
  });
}

function zoneAudioRecordKnownHardwareWord(fields, summary, channel, fieldName, value, event, kind) {
  const operation = zoneAudioTraceOperationForHardwareField(
    channel,
    fieldName,
    kind || 'hardware_shadow_state',
    'write_known_word'
  );
  return zoneAudioRecordTraceStateValue(fields, summary, operation, event || null, {
    status: 'known',
    valueType: 'word',
    valueText: _fmt4(value & 0xFFFF),
    numericValue: value & 0xFFFF,
  });
}

function zoneAudioRecordUnresolvedHardwareValue(fields, summary, channel, fieldName, valueType, reason, event, kind) {
  const operation = zoneAudioTraceOperationForHardwareField(
    channel,
    fieldName,
    kind || 'hardware_shadow_unresolved_state',
    'mark_unresolved_value'
  );
  return zoneAudioRecordTraceStateValue(fields, summary, operation, event || null, {
    status: 'unresolved',
    valueType: valueType || 'byte',
    valueText: reason || 'source?',
  });
}

function zoneAudioRecordKnownStreamPointer(fields, summary, channel, fieldName, z80Pointer, event, kind) {
  const operation = zoneAudioTraceOperationForStreamField(
    channel,
    fieldName,
    kind || 'frame_step_pointer',
    'write_known_pointer'
  );
  return zoneAudioRecordTraceStateValue(fields, summary, operation, event || null, {
    status: 'known',
    valueType: 'pointer',
    valueText: Number.isInteger(z80Pointer) ? _fmt4(z80Pointer) : 'ptr?',
    numericValue: Number.isInteger(z80Pointer) ? z80Pointer : undefined,
  });
}

function zoneAudioTraceKnownPointerField(fields, channel, fieldName) {
  const field = zoneAudioTraceStateField(fields, channel, fieldName);
  const z80 = zoneAudioParseRamAddress(field?.valueText || '');
  if (field?.status === 'known' && z80 != null) {
    const rom = zoneAudioZ80ToBank3Rom(z80);
    return {
      known: rom != null,
      field,
      z80,
      z80Hex: _fmt4(z80),
      rom,
      romHex: rom == null ? '' : _fmt5(rom),
      reason: rom == null ? 'non-bank3-pointer' : '',
    };
  }
  return {
    known: false,
    field,
    reason: field ? `${field.status || 'unknown'} ${field.valueText || ''}`.trim() : 'missing',
  };
}

function zoneAudioCreateFrameStepState(seed, channel) {
  const fields = new Map();
  const summary = {
    channelId: channel?.channelId,
    operationCount: 0,
    knownOperationCount: 0,
    conditionalOperationCount: 0,
    unresolvedOperationCount: 0,
    touchedOperationCount: 0,
  };
  const seedEvent = {
    offsetHex: seed?.recordOffset || '',
  };
  const flagsWrite = zoneAudioSeedWriteByField(seed, 'stream_flags');
  const pointerWrite = zoneAudioSeedWriteByField(seed, 'current_stream_pointer');
  const flags = zoneAudioParseRamAddress(flagsWrite?.value || '') ?? 0x11;
  const z80Pointer = zoneAudioParseRamAddress(pointerWrite?.value || seed?.streamPointer?.z80Address || '');
  const romPointer = zoneRecipeOffset(pointerWrite?.romOffset || seed?.streamPointer?.romOffset || '');
  if (flagsWrite) zoneAudioRecordKnownStreamByte(fields, summary, channel, 'stream_flags', flags, seedEvent, 'stream_seed_flags');
  if (z80Pointer != null) zoneAudioRecordKnownStreamPointer(fields, summary, channel, 'current_stream_pointer', z80Pointer, seedEvent, 'stream_seed_pointer');
  return {
    fields,
    summary,
    channel,
    seed,
    pc: romPointer,
    ended: false,
    warnings: [],
  };
}

function zoneAudioApplyFrameStepResetPath(state, frameEvent) {
  const flags = zoneAudioTraceKnownByteField(state.fields, state.channel, 'stream_flags');
  const nextFlags = flags.known ? (flags.value & 0xEF) : 0x01;
  zoneAudioRecordKnownStreamByte(state.fields, state.summary, state.channel, 'stream_flags', nextFlags, frameEvent, 'frame_step_reset_clear');
  for (const fieldName of [
    'single_stream_parameter',
    'support_table_output_or_note_shift',
    'period_high_base_or_pair_param_1',
    'period_low_base_or_pair_param_0',
    'stream_instrument_or_effect_selector',
    'call_repeat_control_counter',
  ]) {
    zoneAudioRecordKnownStreamByte(state.fields, state.summary, state.channel, fieldName, 0, frameEvent, 'frame_step_reset_clear');
  }
}

function zoneAudioFrameStepGate(state, frameIndex) {
  const frameEvent = { offsetHex: `frame ${frameIndex}` };
  const result = {
    status: 'unresolved',
    source: 'frame_step_seeded_state',
    outcome: 'unresolved',
    fetchEvent: false,
    waitGate: '',
    reason: '',
    pcBefore: state.pc,
    pcBeforeHex: state.pc == null ? '' : _fmt5(state.pc),
    primaryBeforeHex: '',
    primaryAfterHex: '',
    secondaryBeforeHex: '',
    secondaryAfterHex: '',
    streamFlagsHex: '',
  };
  const flags = zoneAudioTraceKnownByteField(state.fields, state.channel, 'stream_flags');
  if (!flags.known) {
    result.reason = `stream_flags ${flags.reason}`;
    return result;
  }
  result.streamFlagsHex = flags.valueHex;
  if ((flags.value & 0x01) === 0) {
    result.status = 'known';
    result.outcome = 'inactive_stream_flag';
    result.reason = 'stream_flags bit 0 clear';
    return result;
  }
  if (flags.value & 0x10) {
    zoneAudioApplyFrameStepResetPath(state, frameEvent);
    const pointer = zoneAudioTraceKnownPointerField(state.fields, state.channel, 'current_stream_pointer');
    if (pointer.known) state.pc = pointer.rom;
    result.status = pointer.known ? 'known' : 'unresolved';
    result.outcome = pointer.known ? 'fetch_reset_path' : 'reset_path_pointer_unresolved';
    result.fetchEvent = pointer.known;
    result.reason = pointer.known ? 'reset bit set; pointer reloaded' : `reset pointer ${pointer.reason}`;
    result.pcBefore = state.pc;
    result.pcBeforeHex = state.pc == null ? '' : _fmt5(state.pc);
    return result;
  }

  const primary = zoneAudioTraceKnownByteField(state.fields, state.channel, 'note_delay_counter');
  if (!primary.known) {
    result.reason = `note_delay_counter ${primary.reason}`;
    return result;
  }
  result.primaryBeforeHex = primary.valueHex;
  if (primary.value > 1) {
    const primaryAfter = (primary.value - 1) & 0xFF;
    zoneAudioRecordKnownStreamByte(state.fields, state.summary, state.channel, 'note_delay_counter', primaryAfter, frameEvent, 'frame_step_delay_decrement');
    result.primaryAfterHex = _fmt2(primaryAfter);
    const secondary = zoneAudioTraceKnownByteField(state.fields, state.channel, 'secondary_delay_counter');
    if (secondary.known) {
      const secondaryAfter = (secondary.value - 1) & 0xFF;
      zoneAudioRecordKnownStreamByte(state.fields, state.summary, state.channel, 'secondary_delay_counter', secondaryAfter, frameEvent, 'frame_step_primary_wait_side_decrement');
      result.secondaryBeforeHex = secondary.valueHex;
      result.secondaryAfterHex = _fmt2(secondaryAfter);
    } else {
      result.secondaryReason = secondary.reason;
    }
    result.status = 'known';
    result.outcome = 'wait_primary_delay';
    result.waitGate = 'primary';
    result.reason = 'primary delay remains nonzero after decrement';
    return result;
  }
  result.primaryAfterHex = _fmt2(primary.value === 1 ? 0 : primary.value);
  if (primary.value === 1) {
    zoneAudioRecordKnownStreamByte(state.fields, state.summary, state.channel, 'note_delay_counter', 0, frameEvent, 'frame_step_delay_decrement');
  }

  const secondary = zoneAudioTraceKnownByteField(state.fields, state.channel, 'secondary_delay_counter');
  if (!secondary.known) {
    result.reason = `secondary_delay_counter ${secondary.reason}`;
    return result;
  }
  result.secondaryBeforeHex = secondary.valueHex;
  if (secondary.value > 1) {
    const secondaryAfter = (secondary.value - 1) & 0xFF;
    zoneAudioRecordKnownStreamByte(state.fields, state.summary, state.channel, 'secondary_delay_counter', secondaryAfter, frameEvent, 'frame_step_delay_decrement');
    result.secondaryAfterHex = _fmt2(secondaryAfter);
    result.status = 'known';
    result.outcome = 'wait_secondary_delay';
    result.waitGate = 'secondary';
    result.reason = 'secondary delay remains nonzero after decrement';
    return result;
  }
  result.secondaryAfterHex = _fmt2(secondary.value === 1 ? 0 : secondary.value);
  if (secondary.value === 1) {
    zoneAudioRecordKnownStreamByte(state.fields, state.summary, state.channel, 'secondary_delay_counter', 0, frameEvent, 'frame_step_delay_decrement');
  }
  const pointer = zoneAudioTraceKnownPointerField(state.fields, state.channel, 'current_stream_pointer');
  if (pointer.known) state.pc = pointer.rom;
  result.status = pointer.known ? 'known' : 'unresolved';
  result.outcome = pointer.known ? 'fetch_event' : 'fetch_pointer_unresolved';
  result.fetchEvent = pointer.known;
  result.reason = pointer.known ? 'both delay gates allow event fetch' : `fetch pointer ${pointer.reason}`;
  result.pcBefore = state.pc;
  result.pcBeforeHex = state.pc == null ? '' : _fmt5(state.pc);
  return result;
}

function zoneAudioFrameStepNextPcFromState(state, event) {
  const pointer = zoneAudioTraceKnownPointerField(state.fields, state.channel, 'current_stream_pointer');
  if (pointer.known) return pointer.rom;
  if (Number.isInteger(event?.nextOffset)) return event.nextOffset;
  return null;
}

function zoneAudioEventLabel(event) {
  if (!event) return '';
  if (event.kind === 'control') return `${event.offsetHex} ${event.opcode}`;
  return `${event.offsetHex} ${event.kind}`;
}

function zoneAudioFrameStepContinuesSameFrame(event, decoded) {
  if (!event || event.kind !== 'control') return false;
  if (event.opcode === '$FF') return false;
  const action = event.parserAction || decoded?.endReason || '';
  if (action === 'stop_segment' || action === 'loop-or-repeat-end' || decoded?.endReason === 'ff-end') return false;
  return true;
}

function zoneAudioBuildFrameStepPreview(seed, channel, maxFrames) {
  if (!seed || !romData) return null;
  maxFrames = maxFrames || 16;
  const maxEventsPerFrame = 24;
  const state = zoneAudioCreateFrameStepState(seed, channel);
  const frames = [];
  const summary = {
    frameCount: 0,
    fetchFrameCount: 0,
    waitFrameCount: 0,
    unresolvedFrameCount: 0,
    eventCount: 0,
    resetFetchCount: 0,
    ended: false,
    endReason: '',
  };
  for (let frameIndex = 0; frameIndex < maxFrames; frameIndex++) {
    if (state.ended) break;
    const gate = zoneAudioFrameStepGate(state, frameIndex);
    const record = {
      frame: frameIndex,
      gate,
      event: null,
      events: [],
      eventLabel: '',
      pcBeforeHex: gate.pcBeforeHex || '',
      pcAfterHex: '',
      endReason: '',
    };
    summary.frameCount++;
    if (gate.status !== 'known') summary.unresolvedFrameCount++;
    else if (gate.fetchEvent) {
      summary.fetchFrameCount++;
      if (gate.outcome === 'fetch_reset_path') summary.resetFetchCount++;
    } else {
      summary.waitFrameCount++;
    }
    if (gate.fetchEvent) {
      for (let eventIndex = 0; eventIndex < maxEventsPerFrame; eventIndex++) {
        const decoded = zoneAudioDecodeStreamEvents(state.pc, 1, channel);
        const event = decoded.events[0] || null;
        if (!event) {
          state.ended = true;
          state.warnings.push(...(decoded.warnings || []));
          record.endReason = decoded.endReason || 'no-event';
          break;
        }
        zoneAudioApplyTraceEventToState(state.fields, state.summary, event, channel);
        state.pc = zoneAudioFrameStepNextPcFromState(state, event);
        record.events.push(event);
        if (!record.event) record.event = event;
        record.pcAfterHex = state.pc == null ? '' : _fmt5(state.pc);
        summary.eventCount++;
        if (event.opcode === '$FF' || decoded.endReason === 'ff-end' || decoded.endReason === 'loop-or-repeat-end') {
          state.ended = true;
          record.endReason = decoded.endReason;
          break;
        }
        if (!zoneAudioFrameStepContinuesSameFrame(event, decoded)) break;
        if (state.pc == null) {
          record.endReason = 'pointer-unresolved';
          break;
        }
      }
      if (record.events.length >= maxEventsPerFrame && zoneAudioFrameStepContinuesSameFrame(record.events[record.events.length - 1], null)) {
        record.endReason = 'event-cap';
      }
      record.eventLabel = record.events.map(zoneAudioEventLabel).join(' ');
      if (!record.events.length) {
        state.ended = true;
      }
    }
    frames.push(record);
    if (gate.status !== 'known') break;
  }
  summary.ended = state.ended;
  summary.endReason = frames[frames.length - 1]?.endReason || '';
  const fieldList = [...state.fields.values()].sort((a, b) => a.label.localeCompare(b.label));
  return {
    frames,
    fields: fieldList,
    summary,
    warnings: state.warnings,
  };
}

function zoneAudioFrameStepText(frameStep) {
  if (!frameStep) return '';
  return (frameStep.frames || []).slice(0, 10).map(frame => {
    const gate = zoneAudioFrameGateText(frame.gate);
    const event = frame.eventLabel ? ` ${frame.eventLabel}` : '';
    const end = frame.endReason ? ` ${frame.endReason}` : '';
    return `f${frame.frame}:${gate}${event}${end}`;
  }).join(' · ');
}

function zoneAudioFrameStepHtml(frameStep) {
  if (!frameStep) return '';
  const summary = frameStep.summary || {};
  const parts = [
    `${summary.frameCount || 0} frame(s)`,
    `fetch ${summary.fetchFrameCount || 0}`,
    `wait ${summary.waitFrameCount || 0}`,
    `events ${summary.eventCount || 0}`,
  ];
  if (summary.unresolvedFrameCount) parts.push(`unresolved ${summary.unresolvedFrameCount}`);
  if (summary.resetFetchCount) parts.push(`reset ${summary.resetFetchCount}`);
  if (summary.ended) parts.push(`ended ${summary.endReason || '?'}`);
  const text = zoneAudioFrameStepText(frameStep);
  const lines = [
    `<div style="padding-left:10px;color:#fbbf24">frame-step ${simEscapeHtml(parts.join(' · '))}</div>`,
  ];
  if (text) lines.push(`<div style="padding-left:20px;color:#888">${simEscapeHtml(text)}</div>`);
  return lines.join('');
}

function zoneAudioHighBitNoteTimingLookup(event) {
  const catalog = zoneAudioNoteTimingSupportCatalog();
  const table = catalog?.timingTable;
  if (!event?.highFlag || !table) return null;
  const index = Number.isInteger(event.encoded) ? event.encoded : zoneAudioParseRamAddress(event.encodedHex);
  const romBase = zoneRecipeOffset(table.romOffset);
  const min = table.indexRange?.min ?? 0;
  const max = table.indexRange?.max ?? -1;
  const result = {
    status: 'unresolved',
    index,
    indexHex: Number.isInteger(index) ? _fmt2(index) : '',
    romOffset: null,
    romOffsetHex: '',
    baseTiming: null,
    baseTimingHex: '',
  };
  if (!Number.isInteger(index)) {
    result.status = 'missing-index';
    return result;
  }
  if (index < min || index > max) {
    result.status = 'out-of-range';
    return result;
  }
  if (romBase == null) {
    result.status = 'missing-table-offset';
    return result;
  }
  result.romOffset = romBase + index;
  result.romOffsetHex = _fmt5(result.romOffset);
  if (!romData || result.romOffset < 0 || result.romOffset >= romData.length) {
    result.status = 'needs-rom';
    return result;
  }
  result.baseTiming = romData[result.romOffset];
  result.baseTimingHex = _fmt2(result.baseTiming);
  result.status = 'resolved';
  return result;
}

function zoneAudioTransformHighBitNoteTiming(baseTiming, supportValue) {
  if (!Number.isInteger(baseTiming) || !Number.isInteger(supportValue)) return null;
  const base = baseTiming & 0xFF;
  const support = supportValue & 0xFF;
  if (support === 0) return { primary: base, secondary: base, formula: 'base' };
  if (support === 1) return { primary: base >> 1, secondary: base, formula: 'base>>1' };
  if (support === 2) return { primary: base >> 2, secondary: base, formula: 'base>>2' };
  return { primary: (base - (base >> 2)) & 0xFF, secondary: base, formula: 'base-(base>>2)' };
}

function zoneAudioApplyHighBitNoteTiming(fields, summary, event, channel) {
  if (!event?.highFlag) return;
  summary.noteTimingEventCount = (summary.noteTimingEventCount || 0) + 1;
  const lookup = zoneAudioHighBitNoteTimingLookup(event);
  const supportField = zoneAudioTraceStateField(fields, channel, 'support_table_output_or_note_shift');
  const supportKnown = supportField?.status === 'known' && Number.isInteger(supportField.numericValue);
  const transformed = lookup?.status === 'resolved' && supportKnown
    ? zoneAudioTransformHighBitNoteTiming(lookup.baseTiming, supportField.numericValue)
    : null;
  event.noteTimingPreview = {
    status: transformed ? 'resolved' : 'unresolved',
    indexHex: lookup?.indexHex || '',
    tableOffsetHex: lookup?.romOffsetHex || '',
    baseTimingHex: lookup?.baseTimingHex || '',
    supportHex: supportKnown ? _fmt2(supportField.numericValue) : '',
    primaryDelayHex: transformed ? _fmt2(transformed.primary) : '',
    secondaryDelayHex: transformed ? _fmt2(transformed.secondary) : '',
    formula: transformed?.formula || '',
    reason: transformed ? '' : (lookup?.status || (supportField ? 'support-not-known' : 'support-missing')),
  };

  const outputFields = [
    ['note_delay_counter', 'primary'],
    ['note_delay_reload_or_low_period_seed', 'primary'],
    ['secondary_delay_counter', 'secondary'],
    ['secondary_delay_reload', 'secondary'],
  ];
  for (const [fieldName, role] of outputFields) {
    const operation = zoneAudioTraceOperationForStreamField(
      channel,
      fieldName,
      'high_bit_note_timing',
      transformed ? 'write_known_byte' : 'mark_delay_update'
    );
    const value = transformed
      ? {
        status: 'known',
        valueType: 'byte',
        valueText: _fmt2(transformed[role]),
        numericValue: transformed[role],
      }
      : {
        status: 'unresolved',
        valueType: 'byte',
        valueText: event.noteTimingPreview.reason || 'timing?',
      };
    zoneAudioRecordTraceStateValue(fields, summary, operation, event, value);
  }
  if (transformed) summary.noteTimingResolvedEventCount = (summary.noteTimingResolvedEventCount || 0) + 1;
  else summary.noteTimingUnresolvedEventCount = (summary.noteTimingUnresolvedEventCount || 0) + 1;
}

function zoneAudioApplyNormalNoteDelayReload(fields, summary, event, channel) {
  if (!event || event.kind === 'control' || event.highFlag) return;
  const pairs = [
    ['note_delay_reload_or_low_period_seed', 'note_delay_counter'],
    ['secondary_delay_reload', 'secondary_delay_counter'],
  ];
  let copied = 0;
  summary.noteTimingReloadEventCount = (summary.noteTimingReloadEventCount || 0) + 1;
  for (const [sourceName, targetName] of pairs) {
    const sourceField = zoneAudioTraceStateField(fields, channel, sourceName);
    const sourceKnown = sourceField?.status === 'known' && Number.isInteger(sourceField.numericValue);
    const operation = zoneAudioTraceOperationForStreamField(
      channel,
      targetName,
      'normal_note_delay_reload',
      sourceKnown ? 'write_known_byte' : 'mark_delay_update'
    );
    const value = sourceKnown
      ? {
        status: 'known',
        valueType: 'byte',
        valueText: _fmt2(sourceField.numericValue),
        numericValue: sourceField.numericValue,
      }
      : {
        status: 'unresolved',
        valueType: 'byte',
        valueText: `${sourceName}?`,
      };
    zoneAudioRecordTraceStateValue(fields, summary, operation, event, value);
    if (sourceKnown) copied++;
  }
  event.noteTimingPreview = event.noteTimingPreview || {
    status: copied === pairs.length ? 'reload' : 'reload-unresolved',
    reason: copied === pairs.length ? '' : 'reload-source-missing',
  };
  if (copied === pairs.length) {
    event.noteTimingPreview.status = 'reload';
    event.noteTimingPreview.primaryDelayHex = zoneAudioTraceStateField(fields, channel, 'note_delay_counter')?.valueText || '';
    event.noteTimingPreview.secondaryDelayHex = zoneAudioTraceStateField(fields, channel, 'secondary_delay_counter')?.valueText || '';
    summary.noteTimingReloadResolvedEventCount = (summary.noteTimingReloadResolvedEventCount || 0) + 1;
  } else {
    summary.noteTimingReloadUnresolvedEventCount = (summary.noteTimingReloadUnresolvedEventCount || 0) + 1;
  }
}

function zoneAudioDecodedPeriodBase(event) {
  if (!event || event.kind === 'control') return null;
  const encoded = Number.isInteger(event.encoded) ? event.encoded & 0x3F : null;
  if (encoded == null) return null;
  const octave = (encoded & 0x30) >> 4;
  return ((encoded & 0x0F) + octave * 12) & 0xFF;
}

function zoneAudioAttachParameterOutputReadiness(summary, event, mirror) {
  const catalog = zoneAudioStreamParameterConsumerCatalog();
  const phases = [];
  const statusCounts = {
    resolved_input: 0,
    conditional_input: 0,
    unresolved_input: 0,
  };
  for (const consumer of catalog?.consumers || []) {
    const fields = consumer.primaryOutputFields || [];
    const role = fields.includes('pitch_accumulator_or_period')
      ? 'pitch'
      : (fields.includes('volume_or_attenuation') ? 'volume' : '');
    if (!role) continue;
    const status = role === 'pitch'
      ? (mirror.pitchStatus === 'resolved' ? 'resolved_input' : 'unresolved_input')
      : (mirror.volumeStatus === 'conditional' ? 'conditional_input' : 'unresolved_input');
    const phaseIds = consumer.primaryOutputPhaseIds ||
      (consumer.primaryOutputPhases || []).map(phase => phase.phaseId).filter(Boolean);
    for (const phaseId of phaseIds) {
      const directPhase = (event.outputPhaseLinks || []).find(phase => phase.phaseId === phaseId) || null;
      phases.push({
        phaseId,
        chip: directPhase?.chip || '',
        role,
        status,
        sourceCatalogId: catalog.id || '',
        confidence: consumer.confidence || '',
      });
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    }
  }
  if (!phases.length) return;
  event.parameterOutputReadiness = {
    sourceCatalogId: catalog?.id || '',
    phaseCount: phases.length,
    statusCounts,
    phases,
  };
  summary.parameterOutputReadinessPhaseCount = (summary.parameterOutputReadinessPhaseCount || 0) + phases.length;
  summary.parameterOutputReadinessResolvedInputCount = (summary.parameterOutputReadinessResolvedInputCount || 0) + statusCounts.resolved_input;
  summary.parameterOutputReadinessConditionalInputCount = (summary.parameterOutputReadinessConditionalInputCount || 0) + statusCounts.conditional_input;
  summary.parameterOutputReadinessUnresolvedInputCount = (summary.parameterOutputReadinessUnresolvedInputCount || 0) + statusCounts.unresolved_input;
}

function zoneAudioOutputPhaseScheduleStatus(fieldRefs, parameterPhase) {
  let missing = 0;
  let unresolved = 0;
  let conditional = 0;
  let touched = 0;
  let known = 0;
  for (const ref of fieldRefs || []) {
    const status = ref.status || 'missing';
    if (status === 'known') known++;
    else if (status === 'conditional' || status === 'symbolic' || status === 'contextual') conditional++;
    else if (status === 'touched') touched++;
    else if (status === 'missing') missing++;
    else unresolved++;
  }
  const parameterStatus = parameterPhase?.status || '';
  if (parameterStatus === 'unresolved_input') unresolved++;
  if (parameterStatus === 'conditional_input') conditional++;
  if (parameterStatus === 'resolved_input') known++;
  if (missing || unresolved) return 'partial_input';
  if (conditional || touched) return 'conditional_input';
  if (known) return 'resolved_input';
  return 'metadata_only';
}

function zoneAudioGlobalInputStatus(ref, channel, source) {
  const role = ref?.name || '';
  if (role === 'active_audio_channel_index') {
    const channelId = Number.isInteger(channel?.channelId) ? (channel.channelId & 3) : null;
    return {
      status: 'known_context',
      valueText: channelId == null ? '' : _fmt2(channelId),
      reason: 'hardware output channel index inferred from the channel context',
      source,
    };
  }
  if (role === 'audio_output_mode_select') {
    return {
      status: 'conditional_runtime_global',
      valueText: '',
      reason: 'bit 0 selects the note/rest volume mirror path before IY+1 is consumed',
      source,
    };
  }
  if (role === 'psg_volume_bias_shared_byte') {
    return {
      status: 'unresolved_runtime_global',
      valueText: '',
      reason: 'runtime PSG attenuation bias is not modeled yet',
      source,
    };
  }
  return {
    status: 'unresolved_runtime_global',
    valueText: '',
    reason: 'runtime global RAM value is not modeled yet',
    source,
  };
}

function zoneAudioOutputPhaseGlobalInputRefs(fullPhase, channel, parameterPhase) {
  const refs = [];
  const add = (template, source) => {
    const ref = zoneAudioGlobalRamRef(template?.role || template?.name);
    if (!ref) return;
    if (refs.some(existing => existing.role === ref.name && existing.source === source)) return;
    const status = zoneAudioGlobalInputStatus(ref, channel, source);
    const flow = zoneAudioRuntimeGlobalFlowForRole(ref.name);
    refs.push({
      role: ref.name,
      address: ref.address,
      confidence: template?.confidence || ref.confidence || '',
      relationship: template?.relationship || '',
      summary: ref.summary || '',
      source,
      status: status.status,
      valueText: status.valueText,
      reason: status.reason,
      flowCatalogBacked: Boolean(flow),
      flowCatalogId: flow?.catalogId || '',
      flowStatus: flow?.flowStatus || '',
      writerSiteCount: flow?.accessSummary?.writeSiteCount || 0,
      readerSiteCount: flow?.accessSummary?.readSiteCount || 0,
      flowMappedRegionCount: flow?.accessSummary?.uniqueRegionCount || 0,
    });
  };

  for (const template of fullPhase?.fieldRefs || []) {
    if (template?.kind === 'global_ram') add(template, 'output_phase_catalog');
  }
  if (parameterPhase?.role === 'volume') {
    add({
      role: 'audio_output_mode_select',
      confidence: 'high',
      relationship: 'selects direct versus shared-bias note/rest volume mirror path before IY+1 is written',
    }, 'note_rest_volume_mirror');
  }
  return refs;
}

function zoneAudioAttachOutputPhaseSchedule(fields, summary, event, channel) {
  const links = event?.outputPhaseLinks || [];
  if (!links.length) return;
  const parameterPhases = event.parameterOutputReadiness?.phases || [];
  const schedule = [];
  const statusCounts = {
    resolved_input: 0,
    conditional_input: 0,
    partial_input: 0,
    metadata_only: 0,
  };
  for (const link of links) {
    const fullPhase = zoneAudioOutputPhaseById(link.phaseId) || link;
    const matchedFieldRefs = [];
    for (const matchedRef of link.matchedRefs || []) {
      const stateField = zoneAudioTraceStateFieldByMatchedRef(fields, channel, matchedRef);
      matchedFieldRefs.push({
        key: matchedRef.key || '',
        label: matchedRef.label || '',
        status: stateField?.status || 'missing',
        valueType: stateField?.valueType || '',
        valueText: stateField?.valueText || '',
      });
    }
    const parameterPhase = parameterPhases.find(phase => phase.phaseId === link.phaseId) || null;
    const readiness = zoneAudioOutputPhaseScheduleStatus(matchedFieldRefs, parameterPhase);
    statusCounts[readiness] = (statusCounts[readiness] || 0) + 1;
    const writes = fullPhase.writes || [];
    const ports = [...new Set(writes.map(write => write.port).filter(Boolean))].sort();
    const globalInputRefs = zoneAudioOutputPhaseGlobalInputRefs(fullPhase, channel, parameterPhase);
    const modeBranchCandidate = zoneAudioOutputModeBranchForPhase(link.phaseId || fullPhase.id || '');
    schedule.push({
      phaseId: link.phaseId || fullPhase.id || '',
      chip: fullPhase.chip || link.chip || '',
      routineLabel: fullPhase.routineLabel || link.routineLabel || '',
      registerFamily: fullPhase.registerFamily || link.registerFamily || '',
      writeCount: fullPhase.writeCount || link.writeCount || 0,
      ports,
      readiness,
      matchedFieldRefs,
      globalInputRefs,
      modeBranchCandidate,
      parameterInputStatus: parameterPhase?.status || '',
      parameterInputRole: parameterPhase?.role || '',
      confidence: fullPhase.confidence || link.confidence || '',
    });
  }
  event.outputPhaseSchedule = {
    phaseCount: schedule.length,
    statusCounts,
    phases: schedule,
    assetPolicy: 'metadata_only_no_register_values',
  };
  summary.outputPhaseScheduleEventCount = (summary.outputPhaseScheduleEventCount || 0) + 1;
  summary.outputPhaseSchedulePhaseCount = (summary.outputPhaseSchedulePhaseCount || 0) + schedule.length;
  summary.outputPhaseScheduleWriteCount = (summary.outputPhaseScheduleWriteCount || 0) +
    schedule.reduce((sum, phase) => sum + (phase.writeCount || 0), 0);
  for (const phase of schedule) {
    const key = `outputPhaseSchedule${phase.readiness.replace(/(^|_)([a-z])/g, (_, __, c) => c.toUpperCase())}Count`;
    summary[key] = (summary[key] || 0) + 1;
    if (phase.chip === 'psg') summary.outputPhaseSchedulePsgPhaseCount = (summary.outputPhaseSchedulePsgPhaseCount || 0) + 1;
    else if (phase.chip === 'fm') summary.outputPhaseScheduleFmPhaseCount = (summary.outputPhaseScheduleFmPhaseCount || 0) + 1;
    else summary.outputPhaseScheduleMixedPhaseCount = (summary.outputPhaseScheduleMixedPhaseCount || 0) + 1;
    for (const ref of phase.globalInputRefs || []) {
      summary.outputPhaseScheduleGlobalInputRefCount = (summary.outputPhaseScheduleGlobalInputRefCount || 0) + 1;
      if (ref.status === 'known_context') summary.outputPhaseScheduleKnownGlobalInputCount = (summary.outputPhaseScheduleKnownGlobalInputCount || 0) + 1;
      else if (ref.status === 'conditional_runtime_global') summary.outputPhaseScheduleConditionalGlobalInputCount = (summary.outputPhaseScheduleConditionalGlobalInputCount || 0) + 1;
      else summary.outputPhaseScheduleUnresolvedGlobalInputCount = (summary.outputPhaseScheduleUnresolvedGlobalInputCount || 0) + 1;
      if (ref.flowCatalogBacked) summary.outputPhaseScheduleGlobalFlowCatalogBackedCount = (summary.outputPhaseScheduleGlobalFlowCatalogBackedCount || 0) + 1;
      if (ref.role === 'active_audio_channel_index') summary.outputPhaseScheduleActiveChannelContextCount = (summary.outputPhaseScheduleActiveChannelContextCount || 0) + 1;
      if (ref.role === 'audio_output_mode_select') summary.outputPhaseScheduleAudioOutputModeSelectConditionalCount = (summary.outputPhaseScheduleAudioOutputModeSelectConditionalCount || 0) + 1;
      if (ref.role === 'psg_volume_bias_shared_byte') summary.outputPhaseSchedulePsgVolumeBiasUnresolvedCount = (summary.outputPhaseSchedulePsgVolumeBiasUnresolvedCount || 0) + 1;
    }
    if (phase.modeBranchCandidate) {
      summary.outputPhaseScheduleModeBranchCandidateCount = (summary.outputPhaseScheduleModeBranchCandidateCount || 0) + 1;
      if (phase.modeBranchCandidate.branchId === 'c232_bit0_clear_psg_output') {
        summary.outputPhaseSchedulePsgModeBranchCandidateCount = (summary.outputPhaseSchedulePsgModeBranchCandidateCount || 0) + 1;
      } else if (phase.modeBranchCandidate.branchId === 'c232_bit0_set_fm_output') {
        summary.outputPhaseScheduleFmModeBranchCandidateCount = (summary.outputPhaseScheduleFmModeBranchCandidateCount || 0) + 1;
      } else {
        summary.outputPhaseScheduleModeIndependentCandidateCount = (summary.outputPhaseScheduleModeIndependentCandidateCount || 0) + 1;
      }
    }
  }
}

function zoneAudioFrameStepEventMap(frameStep) {
  const map = new Map();
  for (const frame of frameStep?.frames || []) {
    for (const event of frame.events || []) {
      const key = event.offsetHex || '';
      if (!key) continue;
      const current = map.get(key) || {
        firstFrame: frame.frame,
        frames: [],
        eventCount: 0,
      };
      if (!current.frames.includes(frame.frame)) current.frames.push(frame.frame);
      current.eventCount++;
      map.set(key, current);
    }
  }
  return map;
}

function zoneAudioBuildOutputRegisterTimelineSkeleton(events, frameStep, channel) {
  const frameMap = zoneAudioFrameStepEventMap(frameStep);
  const entries = [];
  const fixtureCatalog = audioRuntimeOutputFixtureCatalog();
  const summary = {
    channelId: channel?.channelId,
    eventCount: 0,
    entryCount: 0,
    frameLinkedEntryCount: 0,
    frameUnlinkedEntryCount: 0,
    psgEntryCount: 0,
    fmEntryCount: 0,
    mixedEntryCount: 0,
    writeCount: 0,
    resolvedInputCount: 0,
    conditionalInputCount: 0,
    partialInputCount: 0,
    metadataOnlyCount: 0,
    fixtureCatalogId: fixtureCatalog?.id || '',
    fixtureCatalogBacked: Boolean(fixtureCatalog),
    fixtureLinkedEntryCount: 0,
    fixtureMissingEntryCount: 0,
    fixtureLinkedWriteCount: 0,
    fixtureWriteMismatchEntryCount: 0,
    persistedRegisterValueCount: 0,
    persistedSampleCount: 0,
    assetPolicy: 'metadata_only_no_register_values_or_samples',
  };

  for (let eventIndex = 0; eventIndex < (events || []).length; eventIndex++) {
    const event = events[eventIndex];
    const phases = event?.outputPhaseSchedule?.phases || [];
    if (!phases.length) continue;
    const frameInfo = frameMap.get(event.offsetHex || '');
    const sourceTraceMetadata = zoneAudioRuntimeOutputSourceTraceMetadata(event);
    const eventEntries = [];
    summary.eventCount++;
    for (let phaseIndex = 0; phaseIndex < phases.length; phaseIndex++) {
      const phase = phases[phaseIndex];
      const fixtureLink = zoneAudioRuntimeOutputFixtureLink(phase.phaseId || '');
      const entry = {
        frameIndex: Number.isInteger(frameInfo?.firstFrame) ? frameInfo.firstFrame : null,
        frameStatus: frameInfo ? 'frame_step_linked' : 'linear_event_preview',
        eventIndex,
        eventOffsetHex: event.offsetHex || '',
        eventKind: event.kind || '',
        opcode: event.opcode || '',
        ...sourceTraceMetadata,
        phaseIndex,
        phaseId: phase.phaseId || '',
        chip: phase.chip || '',
        routineLabel: phase.routineLabel || '',
        registerFamily: phase.registerFamily || '',
        writeCount: phase.writeCount || 0,
        ports: phase.ports || [],
        readiness: phase.readiness || '',
        globalInputRefs: phase.globalInputRefs || [],
        modeBranchCandidate: phase.modeBranchCandidate || null,
        fixtureCatalogId: fixtureLink.catalogId,
        fixtureStatus: fixtureLink.status,
        phaseFixtureId: fixtureLink.phaseFixtureId,
        writeFixtureIds: fixtureLink.writeFixtureIds,
        writeFixtureCount: fixtureLink.writeFixtureCount,
        writeFixtures: fixtureLink.writeFixtures,
        fieldInputRefs: fixtureLink.fieldInputRefs,
        fieldInputKeys: fixtureLink.fieldInputKeys,
        branchIds: fixtureLink.branchIds,
        globalInputRoles: fixtureLink.globalInputRoles,
        sourceRegion: fixtureLink.sourceRegion,
        sourceRoutineOffset: fixtureLink.sourceRoutineOffset,
        sourceRoutineLabel: fixtureLink.sourceRoutineLabel,
        assetPolicy: 'metadata_only_no_register_values_or_samples',
      };
      entries.push(entry);
      eventEntries.push(entry);
      summary.entryCount++;
      summary.writeCount += entry.writeCount;
      if (frameInfo) summary.frameLinkedEntryCount++;
      else summary.frameUnlinkedEntryCount++;
      if (entry.chip === 'psg') summary.psgEntryCount++;
      else if (entry.chip === 'fm') summary.fmEntryCount++;
      else summary.mixedEntryCount++;
      if (entry.readiness === 'resolved_input') summary.resolvedInputCount++;
      else if (entry.readiness === 'conditional_input') summary.conditionalInputCount++;
      else if (entry.readiness === 'partial_input') summary.partialInputCount++;
      else summary.metadataOnlyCount++;
      if (entry.phaseFixtureId) {
        summary.fixtureLinkedEntryCount++;
        summary.fixtureLinkedWriteCount += entry.writeFixtureCount || 0;
      } else {
        summary.fixtureMissingEntryCount++;
      }
      if ((entry.writeFixtureCount || 0) !== (entry.writeCount || 0)) summary.fixtureWriteMismatchEntryCount++;
      for (const ref of entry.globalInputRefs || []) {
        summary.globalInputRefCount = (summary.globalInputRefCount || 0) + 1;
        if (ref.status === 'known_context') summary.knownGlobalInputCount = (summary.knownGlobalInputCount || 0) + 1;
        else if (ref.status === 'conditional_runtime_global') summary.conditionalGlobalInputCount = (summary.conditionalGlobalInputCount || 0) + 1;
        else summary.unresolvedGlobalInputCount = (summary.unresolvedGlobalInputCount || 0) + 1;
        if (ref.flowCatalogBacked) summary.globalFlowCatalogBackedCount = (summary.globalFlowCatalogBackedCount || 0) + 1;
        if (ref.role === 'active_audio_channel_index') summary.activeChannelContextCount = (summary.activeChannelContextCount || 0) + 1;
        if (ref.role === 'audio_output_mode_select') summary.audioOutputModeSelectConditionalCount = (summary.audioOutputModeSelectConditionalCount || 0) + 1;
        if (ref.role === 'psg_volume_bias_shared_byte') summary.psgVolumeBiasUnresolvedCount = (summary.psgVolumeBiasUnresolvedCount || 0) + 1;
      }
      if (entry.modeBranchCandidate) {
        summary.modeBranchCandidateCount = (summary.modeBranchCandidateCount || 0) + 1;
        if (entry.modeBranchCandidate.branchId === 'c232_bit0_clear_psg_output') {
          summary.psgModeBranchCandidateCount = (summary.psgModeBranchCandidateCount || 0) + 1;
          summary.psgModeAlternativeEntryCount = (summary.psgModeAlternativeEntryCount || 0) + 1;
          summary.psgModeAlternativeWriteCount = (summary.psgModeAlternativeWriteCount || 0) + entry.writeCount;
        } else if (entry.modeBranchCandidate.branchId === 'c232_bit0_set_fm_output') {
          summary.fmModeBranchCandidateCount = (summary.fmModeBranchCandidateCount || 0) + 1;
          summary.fmModeAlternativeEntryCount = (summary.fmModeAlternativeEntryCount || 0) + 1;
          summary.fmModeAlternativeWriteCount = (summary.fmModeAlternativeWriteCount || 0) + entry.writeCount;
        } else {
          summary.modeIndependentCandidateCount = (summary.modeIndependentCandidateCount || 0) + 1;
          summary.psgModeAlternativeEntryCount = (summary.psgModeAlternativeEntryCount || 0) + 1;
          summary.psgModeAlternativeWriteCount = (summary.psgModeAlternativeWriteCount || 0) + entry.writeCount;
          summary.fmModeAlternativeEntryCount = (summary.fmModeAlternativeEntryCount || 0) + 1;
          summary.fmModeAlternativeWriteCount = (summary.fmModeAlternativeWriteCount || 0) + entry.writeCount;
        }
      }
    }
    event.outputRegisterTimeline = {
      entryCount: eventEntries.length,
      frameIndex: Number.isInteger(frameInfo?.firstFrame) ? frameInfo.firstFrame : null,
      frameStatus: frameInfo ? 'frame_step_linked' : 'linear_event_preview',
      fixtureCatalogId: fixtureCatalog?.id || '',
      fixtureLinkedEntryCount: eventEntries.filter(entry => entry.phaseFixtureId).length,
      fixtureMissingEntryCount: eventEntries.filter(entry => !entry.phaseFixtureId).length,
      fixtureLinkedWriteCount: eventEntries.reduce((sum, entry) => sum + (entry.writeFixtureCount || 0), 0),
      entries: eventEntries,
      assetPolicy: 'metadata_only_no_register_values_or_samples',
    };
  }

  return { entries, summary };
}

function zoneAudioApplyNoteRestParameterMirrors(fields, summary, event, channel) {
  if (!event || event.kind === 'control') return;
  summary.noteRestParameterMirrorEventCount = (summary.noteRestParameterMirrorEventCount || 0) + 1;

  const noteBase = zoneAudioDecodedPeriodBase(event);
  const highBase = zoneAudioTraceKnownByteField(fields, channel, 'period_high_base_or_pair_param_1');
  const lowBase = zoneAudioTraceKnownByteField(fields, channel, 'period_low_base_or_pair_param_0');
  const mirror = {
    pitchStatus: 'unresolved',
    pitchWordHex: '',
    noteBaseHex: noteBase == null ? '' : _fmt2(noteBase),
    highBaseHex: highBase.known ? highBase.valueHex : '',
    lowBaseHex: lowBase.known ? lowBase.valueHex : '',
    volumeStatus: 'unresolved',
    volumeText: '',
    reason: '',
  };

  if (noteBase != null && highBase.known && lowBase.known) {
    const highCurrent = (noteBase + highBase.value) & 0xFF;
    const lowCurrent = lowBase.value & 0xFF;
    const word = lowCurrent | (highCurrent << 8);
    zoneAudioRecordKnownStreamByte(fields, summary, channel, 'period_high_current', highCurrent, event, 'note_rest_pitch_high_mirror');
    zoneAudioRecordKnownStreamByte(fields, summary, channel, 'period_low_current', lowCurrent, event, 'note_rest_pitch_low_mirror');
    zoneAudioRecordKnownHardwareWord(fields, summary, channel, 'pitch_accumulator_or_period', word, event, 'note_rest_pitch_hardware_mirror');
    mirror.pitchStatus = 'resolved';
    mirror.pitchWordHex = _fmt4(word);
    mirror.highCurrentHex = _fmt2(highCurrent);
    mirror.lowCurrentHex = _fmt2(lowCurrent);
    summary.noteRestPitchMirrorResolvedCount = (summary.noteRestPitchMirrorResolvedCount || 0) + 1;
  } else {
    const reason = [
      noteBase == null ? 'note base missing' : '',
      highBase.known ? '' : `high ${highBase.reason}`,
      lowBase.known ? '' : `low ${lowBase.reason}`,
    ].filter(Boolean).join('; ');
    zoneAudioRecordUnresolvedHardwareValue(fields, summary, channel, 'pitch_accumulator_or_period', 'word', reason || 'period base?', event, 'note_rest_pitch_hardware_mirror');
    mirror.reason = reason || 'period base?';
    summary.noteRestPitchMirrorUnresolvedCount = (summary.noteRestPitchMirrorUnresolvedCount || 0) + 1;
  }

  const volumeSource = zoneAudioTraceKnownByteField(fields, channel, 'single_stream_parameter');
  if (volumeSource.known) {
    const volumeText = `${volumeSource.valueHex} direct/clamp+bias`;
    zoneAudioRecordConditionalHardwareByte(
      fields,
      summary,
      channel,
      'volume_or_attenuation',
      volumeText,
      event,
      'note_rest_volume_hardware_mirror',
      volumeSource.value
    );
    mirror.volumeStatus = 'conditional';
    mirror.volumeText = volumeText;
    summary.noteRestVolumeMirrorConditionalCount = (summary.noteRestVolumeMirrorConditionalCount || 0) + 1;
  } else {
    zoneAudioRecordUnresolvedHardwareValue(
      fields,
      summary,
      channel,
      'volume_or_attenuation',
      'byte',
      volumeSource.reason || 'single parameter?',
      event,
      'note_rest_volume_hardware_mirror'
    );
    mirror.volumeStatus = 'unresolved';
    mirror.volumeText = volumeSource.reason || 'single parameter?';
    summary.noteRestVolumeMirrorUnresolvedCount = (summary.noteRestVolumeMirrorUnresolvedCount || 0) + 1;
  }

  event.parameterMirrorPreview = mirror;
  zoneAudioAttachParameterOutputReadiness(summary, event, mirror);
}

function zoneAudioApplyTraceEventToState(fields, summary, event, channel) {
  for (const operation of event?.traceOperations || []) {
    const previous = fields.get(zoneAudioTraceFieldKey(operation)) || null;
    const value = zoneAudioTraceApplyValue(operation, event, previous);
    zoneAudioRecordTraceStateValue(fields, summary, operation, event, value);
  }
  zoneAudioApplyHighBitNoteTiming(fields, summary, event, channel);
  zoneAudioApplyNormalNoteDelayReload(fields, summary, event, channel);
  zoneAudioApplyNoteRestParameterMirrors(fields, summary, event, channel);
  zoneAudioAttachOutputPhaseSchedule(fields, summary, event, channel);
}

function zoneAudioCreateEmptyTraceSummary(channel) {
  return {
    channelId: channel?.channelId,
    operationCount: 0,
    knownOperationCount: 0,
    conditionalOperationCount: 0,
    unresolvedOperationCount: 0,
    touchedOperationCount: 0,
  };
}

function zoneAudioSeedTraceState(seed, channel) {
  const fields = new Map();
  const summary = zoneAudioCreateEmptyTraceSummary(channel);
  if (!seed) return { fields, summary };

  const seedEvent = {
    offsetHex: seed.recordOffset || '',
  };
  const flagsWrite = zoneAudioSeedWriteByField(seed, 'stream_flags');
  const pointerWrite = zoneAudioSeedWriteByField(seed, 'current_stream_pointer');
  const flags = zoneAudioParseRamAddress(flagsWrite?.value || '') ?? 0x11;
  const z80Pointer = zoneAudioParseRamAddress(pointerWrite?.value || seed?.streamPointer?.z80Address || '');
  if (flagsWrite) zoneAudioRecordKnownStreamByte(fields, summary, channel, 'stream_flags', flags, seedEvent, 'trace_seed_flags');
  if (z80Pointer != null) zoneAudioRecordKnownStreamPointer(fields, summary, channel, 'current_stream_pointer', z80Pointer, seedEvent, 'trace_seed_pointer');
  if (seed.initialFrameGateImplication?.expectedOutcome === 'fetch_reset_path') {
    zoneAudioApplyFrameStepResetPath(
      { fields, summary, channel },
      { offsetHex: seed.recordOffset || 'reset seed' }
    );
  }
  return { fields, summary };
}

function zoneAudioBuildTraceState(events, channel, seed) {
  const seeded = zoneAudioSeedTraceState(seed, channel);
  const fields = seeded.fields;
  const summary = seeded.summary;

  for (const event of events || []) {
    zoneAudioApplyTraceEventToState(fields, summary, event, channel);
  }

  summary.frameGate = zoneAudioAnalyzeFrameGate(fields, channel);
  const fieldList = [...fields.values()].sort((a, b) => a.label.localeCompare(b.label));
  summary.fieldCount = fieldList.length;
  summary.knownFieldCount = fieldList.filter(field => field.status === 'known').length;
  summary.conditionalFieldCount = fieldList.filter(field => field.status === 'conditional').length;
  summary.unresolvedFieldCount = fieldList.filter(field =>
    field.status === 'unresolved' || field.status === 'symbolic' || field.status === 'contextual'
  ).length;
  summary.touchedFieldCount = fieldList.filter(field => field.status === 'touched').length;
  return { fields: fieldList, summary };
}

function zoneAudioTraceStateFieldsText(fields, maxFields) {
  maxFields = maxFields || 4;
  const visible = (fields || []).slice(0, maxFields);
  if (!visible.length) return '';
  return visible
    .map(field => `${field.label}=${field.valueText || field.status}`)
    .join(' ; ') + (fields.length > maxFields ? ` ; +${fields.length - maxFields}` : '');
}

function zoneAudioTraceStateHtml(traceState) {
  const summary = traceState?.summary;
  if (!summary || !summary.operationCount) return '';
  const parts = [
    `${summary.fieldCount || 0} fields`,
    `known ${summary.knownFieldCount || 0}`,
    `conditional ${summary.conditionalFieldCount || 0}`,
    `unresolved ${summary.unresolvedFieldCount || 0}`,
    `touched ${summary.touchedFieldCount || 0}`,
  ];
  if (summary.noteTimingEventCount) {
    parts.push(`timing ${summary.noteTimingResolvedEventCount || 0}/${summary.noteTimingEventCount}`);
  }
  if (summary.noteTimingReloadEventCount) {
    parts.push(`reload ${summary.noteTimingReloadResolvedEventCount || 0}/${summary.noteTimingReloadEventCount}`);
  }
  if (summary.noteRestParameterMirrorEventCount) {
    parts.push(`mirror pitch ${summary.noteRestPitchMirrorResolvedCount || 0}/${summary.noteRestParameterMirrorEventCount}`);
    parts.push(`vol ${summary.noteRestVolumeMirrorConditionalCount || 0}/${summary.noteRestParameterMirrorEventCount}`);
  }
  if (summary.parameterOutputReadinessPhaseCount) {
    parts.push(`phase inputs ${summary.parameterOutputReadinessResolvedInputCount || 0} resolved/${summary.parameterOutputReadinessConditionalInputCount || 0} conditional`);
  }
  if (summary.outputPhaseSchedulePhaseCount) {
    parts.push(`schedule ${summary.outputPhaseSchedulePhaseCount || 0} phase(s)`);
  }
  if (summary.outputPhaseScheduleGlobalInputRefCount) {
    parts.push(`globals ${summary.outputPhaseScheduleKnownGlobalInputCount || 0} known/${summary.outputPhaseScheduleConditionalGlobalInputCount || 0} conditional/${summary.outputPhaseScheduleUnresolvedGlobalInputCount || 0} unresolved`);
  }
  if (summary.outputPhaseScheduleModeBranchCandidateCount) {
    parts.push(`mode ${summary.outputPhaseSchedulePsgModeBranchCandidateCount || 0} PSG/${summary.outputPhaseScheduleFmModeBranchCandidateCount || 0} FM`);
  }
  const gateText = zoneAudioFrameGateText(summary.frameGate);
  if (gateText) parts.push(gateText);
  const knownText = zoneAudioTraceStateFieldsText((traceState.fields || []).filter(field => field.status === 'known'));
  const uncertainText = zoneAudioTraceStateFieldsText((traceState.fields || []).filter(field => field.status !== 'known'), 3);
  const lines = [
    `<div style="padding-left:10px;color:#a78bfa">trace state: ${simEscapeHtml(parts.join(' · '))}</div>`,
  ];
  if (knownText) lines.push(`<div style="padding-left:20px;color:#888">known ${simEscapeHtml(knownText)}</div>`);
  if (uncertainText) lines.push(`<div style="padding-left:20px;color:#777">pending ${simEscapeHtml(uncertainText)}</div>`);
  return lines.join('');
}

function zoneAudioFieldRefsText(refs, maxRefs) {
  maxRefs = maxRefs || 4;
  if (!refs || !refs.length) return '';
  return refs.slice(0, maxRefs)
    .map(ref => `${ref.address} ${ref.name}`)
    .join(' ; ') + (refs.length > maxRefs ? ` ; +${refs.length - maxRefs}` : '');
}

function zoneAudioUnresolvedRefsText(refs, maxRefs) {
  maxRefs = maxRefs || 3;
  if (!refs || !refs.length) return '';
  return refs.slice(0, maxRefs)
    .map(ref => `${ref.fieldName || 'unresolved'}${ref.confidence ? ` ${ref.confidence}` : ''}`)
    .join(' ; ') + (refs.length > maxRefs ? ` ; +${refs.length - maxRefs}` : '');
}

function zoneAudioOutputPhaseLinksText(links, maxLinks) {
  maxLinks = maxLinks || 4;
  if (!links || !links.length) return '';
  const chipOrder = { psg: 0, fm: 1, mixed: 2 };
  return [...links].sort((a, b) =>
    (chipOrder[a.chip] ?? 9) - (chipOrder[b.chip] ?? 9) ||
    String(a.phaseId || '').localeCompare(String(b.phaseId || ''))
  ).slice(0, maxLinks)
    .map(link => `${link.chip || '?'}:${link.phaseId || '?'}`)
    .join(' ; ') + (links.length > maxLinks ? ` ; +${links.length - maxLinks}` : '');
}

function zoneAudioTraceOperationsText(operations, maxOps) {
  maxOps = maxOps || 4;
  if (!operations || !operations.length) return '';
  return operations.slice(0, maxOps)
    .map(op => `${op.verb} ${op.targetLabel}${op.valueText || ''}`)
    .join(' ; ') + (operations.length > maxOps ? ` ; +${operations.length - maxOps}` : '');
}

function zoneAudioNoteTimingText(event) {
  const timing = event?.noteTimingPreview;
  if (!timing) return '';
  if (timing.status === 'resolved') {
    return `idx ${timing.indexHex} base ${timing.baseTimingHex} support ${timing.supportHex} primary ${timing.primaryDelayHex} secondary ${timing.secondaryDelayHex}`;
  }
  if (timing.status === 'reload') {
    return `reload primary ${timing.primaryDelayHex || '?'} secondary ${timing.secondaryDelayHex || '?'}`;
  }
  return `idx ${timing.indexHex || '?'} ${timing.reason || 'unresolved'}`;
}

function zoneAudioParameterMirrorText(event) {
  const mirror = event?.parameterMirrorPreview;
  if (!mirror) return '';
  const pitch = mirror.pitchStatus === 'resolved'
    ? `pitch ${mirror.pitchWordHex} base ${mirror.noteBaseHex || '?'}+${mirror.highBaseHex || '?'} low ${mirror.lowBaseHex || '?'}`
    : `pitch ${mirror.reason || 'unresolved'}`;
  const volume = mirror.volumeStatus === 'conditional'
    ? `vol ${mirror.volumeText || 'conditional'}`
    : `vol ${mirror.volumeText || 'unresolved'}`;
  return `${pitch} ; ${volume}`;
}

function zoneAudioParameterOutputReadinessText(event) {
  const readiness = event?.parameterOutputReadiness;
  if (!readiness?.phaseCount) return '';
  const counts = readiness.statusCounts || {};
  const phaseText = (readiness.phases || []).slice(0, 4)
    .map(phase => `${phase.chip || '?'}:${phase.phaseId || '?'} ${phase.role || '?'} ${phase.status || '?'}`)
    .join(' ; ');
  const more = readiness.phases?.length > 4 ? ` ; +${readiness.phases.length - 4}` : '';
  return `${counts.resolved_input || 0} resolved · ${counts.conditional_input || 0} conditional · ${counts.unresolved_input || 0} unresolved${phaseText ? ` · ${phaseText}${more}` : ''}`;
}

function zoneAudioOutputPhaseScheduleText(event) {
  const schedule = event?.outputPhaseSchedule;
  if (!schedule?.phaseCount) return '';
  const counts = schedule.statusCounts || {};
  let globalCount = 0;
  let knownGlobal = 0;
  let conditionalGlobal = 0;
  let unresolvedGlobal = 0;
  for (const phase of schedule.phases || []) {
    for (const ref of phase.globalInputRefs || []) {
      globalCount++;
      if (ref.status === 'known_context') knownGlobal++;
      else if (ref.status === 'conditional_runtime_global') conditionalGlobal++;
      else unresolvedGlobal++;
    }
  }
  const phaseText = (schedule.phases || []).slice(0, 4)
    .map(phase => {
      const roles = (phase.globalInputRefs || [])
        .map(ref => ref.address || ref.role || '')
        .filter(Boolean);
      const roleText = roles.length
        ? ` g(${roles.slice(0, 2).join(',')}${roles.length > 2 ? ',+' + (roles.length - 2) : ''})`
        : '';
      const modeText = phase.modeBranchCandidate?.branchId === 'c232_bit0_clear_psg_output'
        ? ' m:psg'
        : (phase.modeBranchCandidate?.branchId === 'c232_bit0_set_fm_output' ? ' m:fm' : '');
      return `${phase.chip || '?'}:${phase.phaseId || '?'} ${phase.readiness || '?'}${roleText}${modeText}`;
    })
    .join(' ; ');
  const more = schedule.phases?.length > 4 ? ` ; +${schedule.phases.length - 4}` : '';
  const globalText = globalCount ? ` · globals ${knownGlobal}/${conditionalGlobal}/${unresolvedGlobal}` : '';
  return `${schedule.phaseCount || 0} phase(s) · ${counts.resolved_input || 0} resolved · ${counts.conditional_input || 0} conditional · ${counts.partial_input || 0} partial${globalText}${phaseText ? ` · ${phaseText}${more}` : ''}`;
}

function zoneAudioFixtureShortId(id) {
  return String(id || '')
    .replace(/^audio_output_phase_fixture_/, 'phase:')
    .replace(/^audio_port_write_fixture_/, 'write:');
}

function zoneAudioOutputRegisterTimelineText(event) {
  const timeline = event?.outputRegisterTimeline;
  if (!timeline?.entryCount) return '';
  const frame = timeline.frameIndex == null ? 'linear' : `f${timeline.frameIndex}`;
  const fixtureCount = timeline.fixtureLinkedEntryCount || 0;
  const phaseText = (timeline.entries || []).slice(0, 3)
    .map(entry => {
      const fixture = entry.phaseFixtureId ? ` fx:${entry.writeFixtureCount || 0}` : ` fx:${entry.fixtureStatus || 'missing'}`;
      return `${entry.chip || '?'}:${entry.phaseId || '?'} ${entry.readiness || '?'}${fixture}`;
    })
    .join(' ; ');
  const more = timeline.entries?.length > 3 ? ` ; +${timeline.entries.length - 3}` : '';
  let globalCount = 0;
  for (const entry of timeline.entries || []) globalCount += entry.globalInputRefs?.length || 0;
  return `${frame} · ${timeline.entryCount} phase(s) · fixtures ${fixtureCount}/${timeline.entryCount}${globalCount ? ` · globals ${globalCount}` : ''}${phaseText ? ` · ${phaseText}${more}` : ''}`;
}

function zoneAudioSelectedOutputModeFilter() {
  const sel = document.getElementById('zone-audio-output-mode-sel');
  const value = sel?.value || 'all';
  return value === 'psg' || value === 'fm' ? value : 'all';
}

function zoneAudioOutputModeFilterLabel(mode) {
  if (mode === 'psg') return 'PSG path ($C232 bit0=0)';
  if (mode === 'fm') return 'FM path ($C232 bit0=1)';
  return 'all candidates ($C232 unresolved)';
}

function zoneAudioOutputModeFilterAllowsEntry(entry, mode) {
  if (mode === 'psg') {
    return entry?.modeBranchCandidate?.branchId === 'c232_bit0_clear_psg_output' ||
      entry?.modeBranchCandidate?.branchId === 'mode_independent_mixed_init';
  }
  if (mode === 'fm') {
    return entry?.modeBranchCandidate?.branchId === 'c232_bit0_set_fm_output' ||
      entry?.modeBranchCandidate?.branchId === 'mode_independent_mixed_init';
  }
  return true;
}

function zoneAudioOutputModeFilterSummary(timeline, mode) {
  const entries = timeline?.entries || [];
  const filteredEntries = [];
  const summary = {
    mode: mode === 'psg' || mode === 'fm' ? mode : 'all',
    label: zoneAudioOutputModeFilterLabel(mode),
    sourceEntryCount: entries.length,
    sourceWriteCount: 0,
    entryCount: 0,
    writeCount: 0,
    droppedEntryCount: 0,
    droppedWriteCount: 0,
    psgBranchEntryCount: 0,
    fmBranchEntryCount: 0,
    modeIndependentEntryCount: 0,
    fixtureLinkedEntryCount: 0,
    fixtureMissingEntryCount: 0,
    fixtureLinkedWriteCount: 0,
    assetPolicy: 'metadata_only_no_register_values_or_samples',
    entries: filteredEntries,
  };
  for (const entry of entries) {
    const writes = entry?.writeCount || 0;
    summary.sourceWriteCount += writes;
    const branchId = entry?.modeBranchCandidate?.branchId || '';
    if (branchId === 'c232_bit0_clear_psg_output') summary.psgBranchEntryCount++;
    else if (branchId === 'c232_bit0_set_fm_output') summary.fmBranchEntryCount++;
    else if (branchId) summary.modeIndependentEntryCount++;
    if (!zoneAudioOutputModeFilterAllowsEntry(entry, summary.mode)) {
      summary.droppedEntryCount++;
      summary.droppedWriteCount += writes;
      continue;
    }
    filteredEntries.push(entry);
    summary.entryCount++;
    summary.writeCount += writes;
    if (entry.phaseFixtureId) {
      summary.fixtureLinkedEntryCount++;
      summary.fixtureLinkedWriteCount += entry.writeFixtureCount || 0;
    } else {
      summary.fixtureMissingEntryCount++;
    }
  }
  return summary;
}

function zoneAudioOutputModeFilterSummaryHtml(filter) {
  if (!filter) return '';
  const parts = [
    zoneAudioOutputModeFilterLabel(filter.mode),
    `${filter.entryCount || 0}/${filter.sourceEntryCount || 0} phase entry(s)`,
    `writes ${filter.writeCount || 0}/${filter.sourceWriteCount || 0}`,
    `fixtures ${filter.fixtureLinkedEntryCount || 0}/${filter.entryCount || 0}`,
  ];
  if (filter.droppedEntryCount) parts.push(`hidden ${filter.droppedEntryCount}`);
  return `<div style="padding-left:10px;color:#bfdbfe">output mode filter ${simEscapeHtml(parts.join(' · '))}</div>`;
}

function zoneAudioOutputRegisterTimelineHtml(timeline, outputModeFilter) {
  if (!timeline?.summary?.entryCount) return '';
  const summary = timeline.summary || {};
  const filter = zoneAudioOutputModeFilterSummary(timeline, outputModeFilter || zoneAudioSelectedOutputModeFilter());
  const parts = [
    `${summary.eventCount || 0} event(s)`,
    `${summary.entryCount || 0} phase entry(s)`,
    `writes ${summary.writeCount || 0}`,
    `frame-linked ${summary.frameLinkedEntryCount || 0}`,
  ];
  if (summary.frameUnlinkedEntryCount) parts.push(`linear ${summary.frameUnlinkedEntryCount}`);
  if (summary.conditionalInputCount) parts.push(`conditional ${summary.conditionalInputCount}`);
  if (summary.partialInputCount) parts.push(`partial ${summary.partialInputCount}`);
  parts.push(`fixtures ${summary.fixtureLinkedEntryCount || 0}/${summary.entryCount || 0}`);
  if (summary.fixtureLinkedWriteCount) parts.push(`fixture writes ${summary.fixtureLinkedWriteCount}`);
  if (summary.fixtureMissingEntryCount) parts.push(`fixture missing ${summary.fixtureMissingEntryCount}`);
  if (summary.fixtureWriteMismatchEntryCount) parts.push(`fixture mismatches ${summary.fixtureWriteMismatchEntryCount}`);
  if (summary.globalInputRefCount) {
    parts.push(`globals ${summary.knownGlobalInputCount || 0}/${summary.conditionalGlobalInputCount || 0}/${summary.unresolvedGlobalInputCount || 0}`);
  }
  if (summary.modeBranchCandidateCount) {
    parts.push(`mode ${summary.psgModeBranchCandidateCount || 0} PSG/${summary.fmModeBranchCandidateCount || 0} FM`);
    parts.push(`filtered ${summary.psgModeAlternativeEntryCount || 0}/${summary.fmModeAlternativeEntryCount || 0}`);
  }
  const visibleEntries = filter.mode === 'all' ? (timeline.entries || []) : filter.entries;
  const visible = visibleEntries.slice(0, 6)
    .map(entry => {
      const frame = entry.frameIndex == null ? 'linear' : `f${entry.frameIndex}`;
      const roles = (entry.globalInputRefs || [])
        .map(ref => ref.address || ref.role || '')
        .filter(Boolean);
      const globals = roles.length
        ? ` g(${roles.slice(0, 2).join(',')}${roles.length > 2 ? ',+' + (roles.length - 2) : ''})`
        : '';
      const mode = entry.modeBranchCandidate?.branchId === 'c232_bit0_clear_psg_output'
        ? ' m:psg'
        : (entry.modeBranchCandidate?.branchId === 'c232_bit0_set_fm_output' ? ' m:fm' : '');
      const fixture = entry.phaseFixtureId
        ? ` fx:${zoneAudioFixtureShortId(entry.phaseFixtureId)} w:${entry.writeFixtureCount || 0}`
        : ` fx:${entry.fixtureStatus || 'missing'}`;
      return `${frame} ${entry.chip || '?'}:${entry.phaseId || '?'} ${entry.readiness || '?'}${globals}${mode}${fixture}`;
    })
    .join(' ; ');
  const lines = [
    `<div style="padding-left:10px;color:#93c5fd">register timeline skeleton ${simEscapeHtml(parts.join(' · '))}</div>`,
  ];
  if (filter.mode !== 'all') lines.push(zoneAudioOutputModeFilterSummaryHtml(filter));
  if (visible) {
    const hidden = visibleEntries.length > 6 ? ` ; +${visibleEntries.length - 6}` : '';
    lines.push(`<div style="padding-left:20px;color:#777">${simEscapeHtml(visible)}${simEscapeHtml(hidden)}</div>`);
  }
  return lines.join('');
}

function zoneAudioOutputPhaseSummaryHtml() {
  const catalog = zoneAudioOutputRegisterCatalog();
  const summary = catalog?.summary;
  if (!summary) return '';
  const ports = summary.portWriteCounts || {};
  const portText = Object.keys(ports).sort().map(port => `${port}:${ports[port]}`).join(' ');
  const chipText = [
    summary.psgPhaseCount != null ? `PSG ${summary.psgPhaseCount}` : '',
    summary.fmPhaseCount != null ? `FM ${summary.fmPhaseCount}` : '',
    summary.mixedPhaseCount != null ? `init/mixed ${summary.mixedPhaseCount}` : '',
  ].filter(Boolean).join(' · ');
  return `<div style="padding-left:10px;color:#888">output phases ${simEscapeHtml(String(summary.phaseCount || 0))} (${simEscapeHtml(chipText || 'unclassified')}) · writes ${simEscapeHtml(String(summary.writeCount || 0))}${portText ? ` · ${simEscapeHtml(portText)}` : ''}</div>`;
}

function zoneAudioFullGraph(streamGraph) {
  if (!streamGraph) return null;
  const catalog = zoneAudioStreamGraphCatalog();
  if (!catalog || !Array.isArray(catalog.graphs)) return null;
  return catalog.graphs.find(graph =>
    graph.id === streamGraph.graphId || graph.requestId === streamGraph.requestId
  ) || null;
}

function zoneAudioSelectedRecipe() {
  if (_zoneParsed?.recipe) return _zoneParsed.recipe;
  const sel = document.getElementById('zone-recipe-sel');
  return zoneBrowserSelectedRecipe(sel?.value || '');
}

function zoneAudioZ80ToBank3Rom(z80Ptr) {
  return z80Ptr >= 0x8000 && z80Ptr < 0xC000 ? z80Ptr + 0x4000 : null;
}

function zoneAudioBank3RomToZ80(romOffset) {
  return romOffset >= 0x0C000 && romOffset < 0x10000 ? romOffset - 0x4000 : null;
}

function zoneAudioStreamGraphForRecipe(recipe, parsedAudioRequestId) {
  const audio = zoneRecipeAudioDiagnostic(recipe, parsedAudioRequestId);
  const compact = audio.streamGraph || null;
  const full = zoneAudioFullGraph(compact) || compact;
  return { audio, compact, graph: full };
}

function zoneAudioSetRecipe(recipe, parsedAudioRequestId) {
  const section = document.getElementById('zone-audio-section');
  const info = document.getElementById('zone-audio-info');
  const preview = document.getElementById('zone-audio-preview');
  if (!section || !info || !preview) return;
  if (typeof window !== 'undefined') window.zoneAudioLastRuntimeOutputLocalObservationBundle = null;
  zoneAudioUpdateObservationExportButton(null);
  if (!recipe) {
    section.style.display = 'none';
    info.textContent = '';
    preview.innerHTML = '';
    return;
  }
  const { audio, compact, graph } = zoneAudioStreamGraphForRecipe(recipe, parsedAudioRequestId);
  if (!audio.requestIdHex && !compact && !graph) {
    section.style.display = 'none';
    info.textContent = '';
    preview.innerHTML = '';
    return;
  }
  section.style.display = '';
  const graphText = zoneRecipeAudioGraphText(compact || graph);
  info.textContent = `${audio.requestIdHex || '?'}${audio.classification ? ` · ${audio.classification}` : ''}${graphText ? ` · ${graphText}` : ''}`;
  preview.innerHTML = romData
    ? '<span style="color:#555">Click PREVIEW EVENTS to decode stream events from the loaded ROM.</span>'
    : '<span style="color:#fbbf24">Load the local ROM to decode stream events. Graph metadata is available without ROM bytes.</span>';
  preview.dataset.zoneAudioRequestId = audio.requestIdHex || '';
  preview.dataset.zoneAudioStreamGraphId = (compact || graph)?.graphId || graph?.id || '';
}

function zoneAudioDecodeStreamEvents(startOffset, maxEvents, channel) {
  maxEvents = maxEvents || 28;
  const start = zoneRecipeOffset(startOffset);
  const events = [];
  const warnings = [];
  if (start == null || start < 0 || !romData || start >= romData.length) {
    return { startOffset: startOffset || '', events, warnings: ['stream offset unavailable or out of range'], endReason: 'invalid-start' };
  }
  let pc = start;
  let endReason = 'event-limit';
  const attachTrace = event => {
    event.traceOperations = zoneAudioEventTraceOperations(event, channel);
    return event;
  };
  for (let i = 0; i < maxEvents && pc < romData.length; i++) {
    const eventOffset = pc;
    const b = romData[pc++];
    if (b >= 0xF0) {
      const info = zoneAudioOpcodeInfo(b);
      const argBytes = info.argBytes ?? 0;
      const args = [];
      if (pc + argBytes > romData.length) {
        warnings.push(`${_fmt5(eventOffset)} ${info.opcode}: truncated argument data`);
        endReason = 'truncated';
        break;
      }
      for (let k = 0; k < argBytes; k++) args.push(romData[pc + k]);
      let branchTarget = null;
      if ((b === 0xF6 || b === 0xFA) && args.length >= 2) {
        const z80Target = args[0] | (args[1] << 8);
        const romTarget = zoneAudioZ80ToBank3Rom(z80Target);
        branchTarget = {
          z80Target,
          z80TargetHex: _fmt4(z80Target),
          romTarget,
          romTargetHex: romTarget == null ? '' : _fmt5(romTarget),
        };
      }
      pc += argBytes;
      const nextZ80 = zoneAudioBank3RomToZ80(pc);
      events.push(attachTrace({
        kind: 'control',
        offset: eventOffset,
        offsetHex: _fmt5(eventOffset),
        nextOffset: pc,
        nextOffsetHex: _fmt5(pc),
        nextZ80Pointer: nextZ80,
        nextZ80PointerHex: nextZ80 == null ? '' : _fmt4(nextZ80),
        opcode: info.opcode || _fmt2(b),
        role: info.name || info.role || info.metadataRole || '',
        argBytes,
        args,
        argsHex: args.map(v => _fmt2(v)),
        parserAction: info.metadataParserAction || info.parserAction || '',
        branchTarget,
        streamStructEffects: info.streamStructEffects || [],
        hardwareShadowEffects: info.hardwareShadowEffects || [],
        ramFieldRefs: zoneAudioEventFieldRefs({ kind: 'control', opcode: info.opcode || _fmt2(b) }, channel),
        unresolvedRamRefs: zoneAudioEventUnresolvedRefs({ kind: 'control', opcode: info.opcode || _fmt2(b) }),
        outputPhaseLinks: zoneAudioEventOutputPhaseLinks({ kind: 'control', opcode: info.opcode || _fmt2(b) }),
      }));
      const parserAction = info.metadataParserAction || info.parserAction || '';
      if (b === 0xFF || parserAction === 'stop_segment') {
        endReason = b === 0xFF ? 'ff-end' : 'loop-or-repeat-end';
        break;
      }
      if (parserAction === 'branch_and_stop_segment') {
        endReason = `${info.opcode || _fmt2(b)}-branch`;
        break;
      }
      continue;
    }

    const encoded = b >= 0x80 ? (b & 0x3F) : b;
    const kind = (encoded & 0x0F) >= 0x0C ? 'rest_or_special' : 'note';
    const nextZ80 = zoneAudioBank3RomToZ80(pc);
    events.push(attachTrace({
      kind,
      offset: eventOffset,
      offsetHex: _fmt5(eventOffset),
      nextOffset: pc,
      nextOffsetHex: _fmt5(pc),
      nextZ80Pointer: nextZ80,
      nextZ80PointerHex: nextZ80 == null ? '' : _fmt4(nextZ80),
      byteHex: _fmt2(b),
      encoded,
      encodedHex: _fmt2(encoded),
      highFlag: b >= 0x80,
      ramFieldRefs: zoneAudioEventFieldRefs({ kind }, channel),
      unresolvedRamRefs: zoneAudioEventUnresolvedRefs({ kind }),
      outputPhaseLinks: zoneAudioEventOutputPhaseLinks({ kind }),
    }));
  }
  return {
    startOffset: _fmt5(start),
    endOffset: _fmt5(pc),
    events,
    warnings,
    endReason,
  };
}

function zoneAudioEventHtml(event) {
  const refs = zoneAudioFieldRefsText(event.ramFieldRefs);
  const refHtml = refs ? ` <span style="color:#888">[${simEscapeHtml(refs)}]</span>` : '';
  const unresolved = zoneAudioUnresolvedRefsText(event.unresolvedRamRefs);
  const unresolvedHtml = unresolved ? ` <span style="color:#b45309">[unresolved ${simEscapeHtml(unresolved)}]</span>` : '';
  const phaseLinks = zoneAudioOutputPhaseLinksText(event.outputPhaseLinks);
  const phaseHtml = phaseLinks ? ` <span style="color:#60a5fa">[out ${simEscapeHtml(phaseLinks)}]</span>` : '';
  const traceText = zoneAudioTraceOperationsText(event.traceOperations);
  const traceHtml = traceText ? ` <span style="color:#a78bfa">[trace ${simEscapeHtml(traceText)}]</span>` : '';
  const timingText = zoneAudioNoteTimingText(event);
  const timingHtml = timingText ? ` <span style="color:#f472b6">[timing ${simEscapeHtml(timingText)}]</span>` : '';
  const mirrorText = zoneAudioParameterMirrorText(event);
  const mirrorHtml = mirrorText ? ` <span style="color:#22d3ee">[mirror ${simEscapeHtml(mirrorText)}]</span>` : '';
  const readinessText = zoneAudioParameterOutputReadinessText(event);
  const readinessHtml = readinessText ? ` <span style="color:#38bdf8">[phase-input ${simEscapeHtml(readinessText)}]</span>` : '';
  const scheduleText = zoneAudioOutputPhaseScheduleText(event);
  const scheduleHtml = scheduleText ? ` <span style="color:#93c5fd">[schedule ${simEscapeHtml(scheduleText)}]</span>` : '';
  const timelineText = zoneAudioOutputRegisterTimelineText(event);
  const timelineHtml = timelineText ? ` <span style="color:#bfdbfe">[timeline ${simEscapeHtml(timelineText)}]</span>` : '';
  if (event.kind === 'control') {
    const args = event.argsHex.length ? ` args ${event.argsHex.map(simEscapeHtml).join(' ')}` : '';
    const target = event.branchTarget?.romTargetHex
      ? ` -> ${simEscapeHtml(event.branchTarget.romTargetHex)}`
      : '';
    const action = event.parserAction ? ` · ${simEscapeHtml(event.parserAction)}` : '';
    const effects = [
      ...(event.streamStructEffects || []),
      ...(event.hardwareShadowEffects || []),
    ].slice(0, 2);
    const effectsHtml = effects.length
      ? `<div style="padding-left:14px;color:#777">${effects.map(simEscapeHtml).join(' ')}</div>`
      : '';
    return `<div><span style="color:#4a9eff">${simEscapeHtml(event.offsetHex)}</span> <span style="color:#fbbf24">${simEscapeHtml(event.opcode)}</span> ${simEscapeHtml(event.role || 'control')}${args}${target}${action}${refHtml}${phaseHtml}${traceHtml}${timingHtml}${mirrorHtml}${readinessHtml}${scheduleHtml}${timelineHtml}${unresolvedHtml}</div>${effectsHtml}`;
  }
  return `<div><span style="color:#4a9eff">${simEscapeHtml(event.offsetHex)}</span> <span style="color:#9ae6b4">${simEscapeHtml(event.kind)}</span> byte ${simEscapeHtml(event.byteHex)} encoded ${simEscapeHtml(event.encodedHex)}${event.highFlag ? ' high-flag' : ''}${refHtml}${phaseHtml}${traceHtml}${timingHtml}${mirrorHtml}${readinessHtml}${scheduleHtml}${timelineHtml}${unresolvedHtml}</div>`;
}

function zoneAudioRenderPreview() {
  const recipe = zoneAudioSelectedRecipe();
  const out = document.getElementById('zone-audio-preview');
  if (!out) return;
  if (!recipe) {
    showToast('Select a zone recipe first', true);
    return;
  }
  zoneAudioSetRecipe(recipe, recipe.dependencies?.audioRequest?.requestId);
  if (!romData) {
    out.innerHTML = '<span style="color:#f87171">Load the local ROM to decode stream events.</span>';
    return;
  }
  const { audio, compact, graph } = zoneAudioStreamGraphForRecipe(recipe, recipe.dependencies?.audioRequest?.requestId);
  const rootChannels = graph?.rootChannels || compact?.rootChannels || [];
  if (!rootChannels.length) {
    out.innerHTML = '<span style="color:#f87171">No root stream channels are available for this recipe audio graph.</span>';
    return;
  }
  let totalEvents = 0;
  let eventsWithRamRefs = 0;
  let eventsWithUnresolvedRefs = 0;
  let eventsWithOutputPhaseLinks = 0;
  let eventsWithTraceOps = 0;
  const ramRefKeys = new Set();
  const unresolvedRefKeys = new Set();
  const outputPhaseKeys = new Set();
  const traceOpKeys = new Set();
  const traceStateFieldKeys = new Set();
  const traceStateKnownFieldKeys = new Set();
  const traceStateConditionalFieldKeys = new Set();
  let traceStateKnownOperations = 0;
  let traceStateConditionalOperations = 0;
  let traceStateUnresolvedOperations = 0;
  let traceStateTouchedOperations = 0;
  let noteTimingEvents = 0;
  let noteTimingResolvedEvents = 0;
  let noteTimingUnresolvedEvents = 0;
  let noteTimingReloadEvents = 0;
  let noteTimingReloadResolvedEvents = 0;
  let noteTimingReloadUnresolvedEvents = 0;
  let parameterMirrorEvents = 0;
  let parameterMirrorPitchResolvedEvents = 0;
  let parameterMirrorPitchUnresolvedEvents = 0;
  let parameterMirrorVolumeConditionalEvents = 0;
  let parameterMirrorVolumeUnresolvedEvents = 0;
  let parameterOutputReadinessPhaseCount = 0;
  let parameterOutputReadinessResolvedInputCount = 0;
  let parameterOutputReadinessConditionalInputCount = 0;
  let parameterOutputReadinessUnresolvedInputCount = 0;
  let outputPhaseScheduleEventCount = 0;
  let outputPhaseSchedulePhaseCount = 0;
  let outputPhaseScheduleWriteCount = 0;
  let outputPhaseScheduleResolvedInputCount = 0;
  let outputPhaseScheduleConditionalInputCount = 0;
  let outputPhaseSchedulePartialInputCount = 0;
  let outputPhaseScheduleMetadataOnlyCount = 0;
  let outputPhaseSchedulePsgPhaseCount = 0;
  let outputPhaseScheduleFmPhaseCount = 0;
  let outputPhaseScheduleMixedPhaseCount = 0;
  let outputPhaseScheduleGlobalInputRefCount = 0;
  let outputPhaseScheduleKnownGlobalInputCount = 0;
  let outputPhaseScheduleConditionalGlobalInputCount = 0;
  let outputPhaseScheduleUnresolvedGlobalInputCount = 0;
  let outputPhaseScheduleGlobalFlowCatalogBackedCount = 0;
  let outputPhaseScheduleActiveChannelContextCount = 0;
  let outputPhaseScheduleAudioOutputModeSelectConditionalCount = 0;
  let outputPhaseSchedulePsgVolumeBiasUnresolvedCount = 0;
  let outputPhaseScheduleModeBranchCandidateCount = 0;
  let outputPhaseSchedulePsgModeBranchCandidateCount = 0;
  let outputPhaseScheduleFmModeBranchCandidateCount = 0;
  let outputPhaseScheduleModeIndependentCandidateCount = 0;
  let outputRegisterTimelineEventCount = 0;
  let outputRegisterTimelineEntryCount = 0;
  let outputRegisterTimelineFrameLinkedEntryCount = 0;
  let outputRegisterTimelineFrameUnlinkedEntryCount = 0;
  let outputRegisterTimelineWriteCount = 0;
  let outputRegisterTimelinePsgEntryCount = 0;
  let outputRegisterTimelineFmEntryCount = 0;
  let outputRegisterTimelineMixedEntryCount = 0;
  let outputRegisterTimelineResolvedInputCount = 0;
  let outputRegisterTimelineConditionalInputCount = 0;
  let outputRegisterTimelinePartialInputCount = 0;
  let outputRegisterTimelineMetadataOnlyCount = 0;
  let outputRegisterTimelineFixtureLinkedEntryCount = 0;
  let outputRegisterTimelineFixtureMissingEntryCount = 0;
  let outputRegisterTimelineFixtureLinkedWriteCount = 0;
  let outputRegisterTimelineFixtureWriteMismatchEntryCount = 0;
  let outputRegisterTimelineGlobalInputRefCount = 0;
  let outputRegisterTimelineKnownGlobalInputCount = 0;
  let outputRegisterTimelineConditionalGlobalInputCount = 0;
  let outputRegisterTimelineUnresolvedGlobalInputCount = 0;
  let outputRegisterTimelineGlobalFlowCatalogBackedCount = 0;
  let outputRegisterTimelineActiveChannelContextCount = 0;
  let outputRegisterTimelineAudioOutputModeSelectConditionalCount = 0;
  let outputRegisterTimelinePsgVolumeBiasUnresolvedCount = 0;
  let outputRegisterTimelineModeBranchCandidateCount = 0;
  let outputRegisterTimelinePsgModeBranchCandidateCount = 0;
  let outputRegisterTimelineFmModeBranchCandidateCount = 0;
  let outputRegisterTimelineModeIndependentCandidateCount = 0;
  let outputRegisterTimelinePsgModeAlternativeEntryCount = 0;
  let outputRegisterTimelinePsgModeAlternativeWriteCount = 0;
  let outputRegisterTimelineFmModeAlternativeEntryCount = 0;
  let outputRegisterTimelineFmModeAlternativeWriteCount = 0;
  let outputRegisterTimelineFilteredEntryCount = 0;
  let outputRegisterTimelineFilteredWriteCount = 0;
  let outputRegisterTimelineFilteredDroppedEntryCount = 0;
  let outputRegisterTimelineFilteredDroppedWriteCount = 0;
  let outputRegisterTimelineFilteredFixtureLinkedEntryCount = 0;
  let outputRegisterTimelineFilteredFixtureMissingEntryCount = 0;
  let outputRegisterTimelineFilteredFixtureLinkedWriteCount = 0;
  let frameGateKnownChannels = 0;
  let frameGateFetchChannels = 0;
  let frameGateWaitChannels = 0;
  let frameGateUnresolvedChannels = 0;
  let seedResolvedChannels = 0;
  let seedMissingChannels = 0;
  let seedInitialFetchChannels = 0;
  let frameStepChannels = 0;
  let frameStepFrames = 0;
  let frameStepFetchFrames = 0;
  let frameStepWaitFrames = 0;
  let frameStepEventFrames = 0;
  let frameStepResetFetchFrames = 0;
  let frameStepUnresolvedFrames = 0;
  let frameStepEndedChannels = 0;
  const requestSeed = zoneAudioRequestSeed(audio.requestId);
  const outputModeFilter = zoneAudioSelectedOutputModeFilter();
  const runtimeOutputSink = zoneAudioCreateRuntimeOutputEventSink(recipe, audio, outputModeFilter);
  const chunks = [];
  chunks.push(`<div style="color:#4a9eff;margin-bottom:4px">Request ${simEscapeHtml(audio.requestIdHex || '?')} · ${simEscapeHtml((compact || graph)?.graphId || graph?.id || 'graph')} · ${rootChannels.length} channel(s)</div>`);
  chunks.push(`<div style="padding-left:10px;color:#bfdbfe">output mode filter ${simEscapeHtml(zoneAudioOutputModeFilterLabel(outputModeFilter))} · metadata only</div>`);
  const outputPhaseSummary = zoneAudioOutputPhaseSummaryHtml();
  if (outputPhaseSummary) chunks.push(outputPhaseSummary);
  const supportUseSummary = zoneAudioSupportTableUseSummaryHtml();
  if (supportUseSummary) chunks.push(supportUseSummary);
  const noteTimingSummary = zoneAudioNoteTimingSummaryHtml();
  if (noteTimingSummary) chunks.push(noteTimingSummary);
  const frameGateSummary = zoneAudioFrameGateSummaryHtml();
  if (frameGateSummary) chunks.push(frameGateSummary);
  const seedSummary = zoneAudioStreamSeedSummaryHtml();
  if (seedSummary) chunks.push(seedSummary);
  for (const channel of rootChannels.slice(0, 8)) {
    const seed = zoneAudioChannelSeed(requestSeed, channel);
    if (seed) {
      seedResolvedChannels++;
      if (seed.initialFrameGateImplication?.expectedOutcome === 'fetch_reset_path') seedInitialFetchChannels++;
    } else {
      seedMissingChannels++;
    }
    const frameStep = seed ? zoneAudioBuildFrameStepPreview(seed, channel, 16) : null;
    if (frameStep) {
      frameStepChannels++;
      frameStepFrames += frameStep.summary.frameCount || 0;
      frameStepFetchFrames += frameStep.summary.fetchFrameCount || 0;
      frameStepWaitFrames += frameStep.summary.waitFrameCount || 0;
      frameStepEventFrames += frameStep.summary.eventCount || 0;
      frameStepResetFetchFrames += frameStep.summary.resetFetchCount || 0;
      frameStepUnresolvedFrames += frameStep.summary.unresolvedFrameCount || 0;
      if (frameStep.summary.ended) frameStepEndedChannels++;
    }
    const decoded = zoneAudioDecodeStreamEvents(channel.rootStreamOffset, 28, channel);
    const traceState = zoneAudioBuildTraceState(decoded.events, channel, seed);
    const registerTimeline = zoneAudioBuildOutputRegisterTimelineSkeleton(decoded.events, frameStep, channel);
    zoneAudioEmitRuntimeOutputFixtureEvents(runtimeOutputSink, registerTimeline.entries, channel);
    totalEvents += decoded.events.length;
    traceStateKnownOperations += traceState.summary.knownOperationCount || 0;
    traceStateConditionalOperations += traceState.summary.conditionalOperationCount || 0;
    traceStateUnresolvedOperations += traceState.summary.unresolvedOperationCount || 0;
    traceStateTouchedOperations += traceState.summary.touchedOperationCount || 0;
    noteTimingEvents += traceState.summary.noteTimingEventCount || 0;
    noteTimingResolvedEvents += traceState.summary.noteTimingResolvedEventCount || 0;
    noteTimingUnresolvedEvents += traceState.summary.noteTimingUnresolvedEventCount || 0;
    noteTimingReloadEvents += traceState.summary.noteTimingReloadEventCount || 0;
    noteTimingReloadResolvedEvents += traceState.summary.noteTimingReloadResolvedEventCount || 0;
    noteTimingReloadUnresolvedEvents += traceState.summary.noteTimingReloadUnresolvedEventCount || 0;
    parameterMirrorEvents += traceState.summary.noteRestParameterMirrorEventCount || 0;
    parameterMirrorPitchResolvedEvents += traceState.summary.noteRestPitchMirrorResolvedCount || 0;
    parameterMirrorPitchUnresolvedEvents += traceState.summary.noteRestPitchMirrorUnresolvedCount || 0;
    parameterMirrorVolumeConditionalEvents += traceState.summary.noteRestVolumeMirrorConditionalCount || 0;
    parameterMirrorVolumeUnresolvedEvents += traceState.summary.noteRestVolumeMirrorUnresolvedCount || 0;
    parameterOutputReadinessPhaseCount += traceState.summary.parameterOutputReadinessPhaseCount || 0;
    parameterOutputReadinessResolvedInputCount += traceState.summary.parameterOutputReadinessResolvedInputCount || 0;
    parameterOutputReadinessConditionalInputCount += traceState.summary.parameterOutputReadinessConditionalInputCount || 0;
    parameterOutputReadinessUnresolvedInputCount += traceState.summary.parameterOutputReadinessUnresolvedInputCount || 0;
    outputPhaseScheduleEventCount += traceState.summary.outputPhaseScheduleEventCount || 0;
    outputPhaseSchedulePhaseCount += traceState.summary.outputPhaseSchedulePhaseCount || 0;
    outputPhaseScheduleWriteCount += traceState.summary.outputPhaseScheduleWriteCount || 0;
    outputPhaseScheduleResolvedInputCount += traceState.summary.outputPhaseScheduleResolvedInputCount || 0;
    outputPhaseScheduleConditionalInputCount += traceState.summary.outputPhaseScheduleConditionalInputCount || 0;
    outputPhaseSchedulePartialInputCount += traceState.summary.outputPhaseSchedulePartialInputCount || 0;
    outputPhaseScheduleMetadataOnlyCount += traceState.summary.outputPhaseScheduleMetadataOnlyCount || 0;
    outputPhaseSchedulePsgPhaseCount += traceState.summary.outputPhaseSchedulePsgPhaseCount || 0;
    outputPhaseScheduleFmPhaseCount += traceState.summary.outputPhaseScheduleFmPhaseCount || 0;
    outputPhaseScheduleMixedPhaseCount += traceState.summary.outputPhaseScheduleMixedPhaseCount || 0;
    outputPhaseScheduleGlobalInputRefCount += traceState.summary.outputPhaseScheduleGlobalInputRefCount || 0;
    outputPhaseScheduleKnownGlobalInputCount += traceState.summary.outputPhaseScheduleKnownGlobalInputCount || 0;
    outputPhaseScheduleConditionalGlobalInputCount += traceState.summary.outputPhaseScheduleConditionalGlobalInputCount || 0;
    outputPhaseScheduleUnresolvedGlobalInputCount += traceState.summary.outputPhaseScheduleUnresolvedGlobalInputCount || 0;
    outputPhaseScheduleGlobalFlowCatalogBackedCount += traceState.summary.outputPhaseScheduleGlobalFlowCatalogBackedCount || 0;
    outputPhaseScheduleActiveChannelContextCount += traceState.summary.outputPhaseScheduleActiveChannelContextCount || 0;
    outputPhaseScheduleAudioOutputModeSelectConditionalCount += traceState.summary.outputPhaseScheduleAudioOutputModeSelectConditionalCount || 0;
    outputPhaseSchedulePsgVolumeBiasUnresolvedCount += traceState.summary.outputPhaseSchedulePsgVolumeBiasUnresolvedCount || 0;
    outputPhaseScheduleModeBranchCandidateCount += traceState.summary.outputPhaseScheduleModeBranchCandidateCount || 0;
    outputPhaseSchedulePsgModeBranchCandidateCount += traceState.summary.outputPhaseSchedulePsgModeBranchCandidateCount || 0;
    outputPhaseScheduleFmModeBranchCandidateCount += traceState.summary.outputPhaseScheduleFmModeBranchCandidateCount || 0;
    outputPhaseScheduleModeIndependentCandidateCount += traceState.summary.outputPhaseScheduleModeIndependentCandidateCount || 0;
    outputRegisterTimelineEventCount += registerTimeline.summary.eventCount || 0;
    outputRegisterTimelineEntryCount += registerTimeline.summary.entryCount || 0;
    outputRegisterTimelineFrameLinkedEntryCount += registerTimeline.summary.frameLinkedEntryCount || 0;
    outputRegisterTimelineFrameUnlinkedEntryCount += registerTimeline.summary.frameUnlinkedEntryCount || 0;
    outputRegisterTimelineWriteCount += registerTimeline.summary.writeCount || 0;
    outputRegisterTimelinePsgEntryCount += registerTimeline.summary.psgEntryCount || 0;
    outputRegisterTimelineFmEntryCount += registerTimeline.summary.fmEntryCount || 0;
    outputRegisterTimelineMixedEntryCount += registerTimeline.summary.mixedEntryCount || 0;
    outputRegisterTimelineResolvedInputCount += registerTimeline.summary.resolvedInputCount || 0;
    outputRegisterTimelineConditionalInputCount += registerTimeline.summary.conditionalInputCount || 0;
    outputRegisterTimelinePartialInputCount += registerTimeline.summary.partialInputCount || 0;
    outputRegisterTimelineMetadataOnlyCount += registerTimeline.summary.metadataOnlyCount || 0;
    outputRegisterTimelineFixtureLinkedEntryCount += registerTimeline.summary.fixtureLinkedEntryCount || 0;
    outputRegisterTimelineFixtureMissingEntryCount += registerTimeline.summary.fixtureMissingEntryCount || 0;
    outputRegisterTimelineFixtureLinkedWriteCount += registerTimeline.summary.fixtureLinkedWriteCount || 0;
    outputRegisterTimelineFixtureWriteMismatchEntryCount += registerTimeline.summary.fixtureWriteMismatchEntryCount || 0;
    outputRegisterTimelineGlobalInputRefCount += registerTimeline.summary.globalInputRefCount || 0;
    outputRegisterTimelineKnownGlobalInputCount += registerTimeline.summary.knownGlobalInputCount || 0;
    outputRegisterTimelineConditionalGlobalInputCount += registerTimeline.summary.conditionalGlobalInputCount || 0;
    outputRegisterTimelineUnresolvedGlobalInputCount += registerTimeline.summary.unresolvedGlobalInputCount || 0;
    outputRegisterTimelineGlobalFlowCatalogBackedCount += registerTimeline.summary.globalFlowCatalogBackedCount || 0;
    outputRegisterTimelineActiveChannelContextCount += registerTimeline.summary.activeChannelContextCount || 0;
    outputRegisterTimelineAudioOutputModeSelectConditionalCount += registerTimeline.summary.audioOutputModeSelectConditionalCount || 0;
    outputRegisterTimelinePsgVolumeBiasUnresolvedCount += registerTimeline.summary.psgVolumeBiasUnresolvedCount || 0;
    outputRegisterTimelineModeBranchCandidateCount += registerTimeline.summary.modeBranchCandidateCount || 0;
    outputRegisterTimelinePsgModeBranchCandidateCount += registerTimeline.summary.psgModeBranchCandidateCount || 0;
    outputRegisterTimelineFmModeBranchCandidateCount += registerTimeline.summary.fmModeBranchCandidateCount || 0;
    outputRegisterTimelineModeIndependentCandidateCount += registerTimeline.summary.modeIndependentCandidateCount || 0;
    outputRegisterTimelinePsgModeAlternativeEntryCount += registerTimeline.summary.psgModeAlternativeEntryCount || 0;
    outputRegisterTimelinePsgModeAlternativeWriteCount += registerTimeline.summary.psgModeAlternativeWriteCount || 0;
    outputRegisterTimelineFmModeAlternativeEntryCount += registerTimeline.summary.fmModeAlternativeEntryCount || 0;
    outputRegisterTimelineFmModeAlternativeWriteCount += registerTimeline.summary.fmModeAlternativeWriteCount || 0;
    const registerTimelineFilter = zoneAudioOutputModeFilterSummary(registerTimeline, outputModeFilter);
    outputRegisterTimelineFilteredEntryCount += registerTimelineFilter.entryCount || 0;
    outputRegisterTimelineFilteredWriteCount += registerTimelineFilter.writeCount || 0;
    outputRegisterTimelineFilteredDroppedEntryCount += registerTimelineFilter.droppedEntryCount || 0;
    outputRegisterTimelineFilteredDroppedWriteCount += registerTimelineFilter.droppedWriteCount || 0;
    outputRegisterTimelineFilteredFixtureLinkedEntryCount += registerTimelineFilter.fixtureLinkedEntryCount || 0;
    outputRegisterTimelineFilteredFixtureMissingEntryCount += registerTimelineFilter.fixtureMissingEntryCount || 0;
    outputRegisterTimelineFilteredFixtureLinkedWriteCount += registerTimelineFilter.fixtureLinkedWriteCount || 0;
    const frameGate = traceState.summary.frameGate;
    if (frameGate) {
      if (frameGate.status === 'known') {
        frameGateKnownChannels++;
        if (frameGate.fetchEvent) frameGateFetchChannels++;
        else frameGateWaitChannels++;
      } else {
        frameGateUnresolvedChannels++;
      }
    }
    for (const field of traceState.fields || []) {
      const fieldKey = `${channel.channelIdHex || channel.channelId || '?'}|${field.key}`;
      traceStateFieldKeys.add(fieldKey);
      if (field.status === 'known') traceStateKnownFieldKeys.add(fieldKey);
      if (field.status === 'conditional') traceStateConditionalFieldKeys.add(fieldKey);
    }
    for (const event of decoded.events) {
      if (event.ramFieldRefs?.length) eventsWithRamRefs++;
      for (const ref of event.ramFieldRefs || []) ramRefKeys.add(`${ref.kind}|${ref.address}|${ref.name}`);
      if (event.unresolvedRamRefs?.length) eventsWithUnresolvedRefs++;
      for (const ref of event.unresolvedRamRefs || []) unresolvedRefKeys.add(`${ref.kind}|${ref.fieldName}`);
      if (event.outputPhaseLinks?.length) eventsWithOutputPhaseLinks++;
      for (const phase of event.outputPhaseLinks || []) outputPhaseKeys.add(phase.phaseId || '');
      if (event.traceOperations?.length) eventsWithTraceOps++;
      for (const op of event.traceOperations || []) traceOpKeys.add(`${op.kind}|${op.targetLabel}`);
    }
    const streamRef = zoneAudioStreamChannelRef(channel);
    const shadowRef = zoneAudioHardwareShadowRef(channel);
    const ramContext = streamRef || shadowRef
      ? ` · stream ${simEscapeHtml(streamRef?.baseAddress || '?')} · shadow ${simEscapeHtml(shadowRef?.baseAddress || '?')}`
      : '';
    chunks.push(`<div style="margin-top:6px;color:#7ee787">Channel ${simEscapeHtml(channel.channelIdHex || String(channel.channelId ?? '?'))} · priority ${simEscapeHtml(channel.priorityHex || '?')} · root ${simEscapeHtml(channel.rootStreamOffset || '?')} · ${decoded.events.length} event(s) · ${simEscapeHtml(decoded.endReason)}</div>`);
    if (ramContext) chunks.push(`<div style="padding-left:10px;color:#888">${ramContext.slice(3)}</div>`);
    const seedHtml = zoneAudioSeedHtml(seed);
    if (seedHtml) chunks.push(seedHtml);
    const frameStepHtml = zoneAudioFrameStepHtml(frameStep);
    if (frameStepHtml) chunks.push(frameStepHtml);
    chunks.push(zoneAudioTraceStateHtml(traceState));
    const registerTimelineHtml = zoneAudioOutputRegisterTimelineHtml(registerTimeline, outputModeFilter);
    if (registerTimelineHtml) chunks.push(registerTimelineHtml);
    chunks.push(decoded.events.slice(0, 28).map(zoneAudioEventHtml).join(''));
    if (decoded.warnings.length) {
      chunks.push(`<div style="color:#f87171">${decoded.warnings.map(simEscapeHtml).join('; ')}</div>`);
    }
  }
  const runtimeSinkHtml = zoneAudioRuntimeOutputEventSinkSummaryHtml(runtimeOutputSink);
  if (runtimeSinkHtml) chunks.push(runtimeSinkHtml);
  const runtimeOutputAccumulator = zoneAudioBuildRuntimeOutputStateAccumulator(runtimeOutputSink);
  const runtimeAccumulatorHtml = zoneAudioRuntimeOutputStateAccumulatorSummaryHtml(runtimeOutputAccumulator);
  if (runtimeAccumulatorHtml) chunks.push(runtimeAccumulatorHtml);
  const runtimeOutputFrameTimeline = zoneAudioBuildRuntimeOutputFrameTimeline(runtimeOutputAccumulator);
  const runtimeFrameTimelineHtml = zoneAudioRuntimeOutputFrameTimelineSummaryHtml(runtimeOutputFrameTimeline);
  if (runtimeFrameTimelineHtml) chunks.push(runtimeFrameTimelineHtml);
  const runtimeOutputRegisterIntent = zoneAudioBuildRuntimeOutputRegisterIntentModel(runtimeOutputFrameTimeline);
  const runtimeRegisterIntentHtml = zoneAudioRuntimeOutputRegisterIntentSummaryHtml(runtimeOutputRegisterIntent);
  if (runtimeRegisterIntentHtml) chunks.push(runtimeRegisterIntentHtml);
  const runtimeOutputChannelPortIntent = zoneAudioBuildRuntimeOutputChannelPortIntentModel(runtimeOutputSink);
  const runtimeChannelPortIntentHtml = zoneAudioRuntimeOutputChannelPortIntentSummaryHtml(runtimeOutputChannelPortIntent);
  if (runtimeChannelPortIntentHtml) chunks.push(runtimeChannelPortIntentHtml);
  const runtimeOutputEventContractValidation = zoneAudioValidateRuntimeOutputEventContract(runtimeOutputSink, {
    runtimeOutputAccumulator,
    runtimeOutputFrameTimeline,
    runtimeOutputRegisterIntent,
    runtimeOutputChannelPortIntent,
  });
  const runtimeOutputEventContractHtml = zoneAudioRuntimeOutputEventContractValidationSummaryHtml(runtimeOutputEventContractValidation);
  if (runtimeOutputEventContractHtml) chunks.push(runtimeOutputEventContractHtml);
  const runtimeOutputLocalObservationBundle = zoneAudioBuildRuntimeOutputLocalObservationBundle(
    runtimeOutputSink,
    recipe,
    audio,
    runtimeOutputEventContractValidation
  );
  const runtimeOutputLocalObservationHtml = zoneAudioRuntimeOutputLocalObservationBundleSummaryHtml(runtimeOutputLocalObservationBundle);
  if (runtimeOutputLocalObservationHtml) chunks.push(runtimeOutputLocalObservationHtml);
  zoneAudioUpdateObservationExportButton(runtimeOutputLocalObservationBundle);
  if (typeof window !== 'undefined') {
    window.zoneAudioLastRuntimeOutputEventSink = runtimeOutputSink;
    window.zoneAudioLastRuntimeOutputStateAccumulator = runtimeOutputAccumulator;
    window.zoneAudioLastRuntimeOutputFrameTimeline = runtimeOutputFrameTimeline;
    window.zoneAudioLastRuntimeOutputRegisterIntentModel = runtimeOutputRegisterIntent;
    window.zoneAudioLastRuntimeOutputChannelPortIntentModel = runtimeOutputChannelPortIntent;
    window.zoneAudioLastRuntimeOutputEventContractValidation = runtimeOutputEventContractValidation;
    window.zoneAudioLastRuntimeOutputLocalObservationBundle = runtimeOutputLocalObservationBundle;
  }
  out.dataset.zoneAudioRequestId = audio.requestIdHex || '';
  out.dataset.zoneAudioStreamGraphId = (compact || graph)?.graphId || graph?.id || '';
  out.dataset.zoneAudioPreviewChannels = String(rootChannels.length);
  out.dataset.zoneAudioPreviewEvents = String(totalEvents);
  out.dataset.zoneAudioPreviewEventsWithRamRefs = String(eventsWithRamRefs);
  out.dataset.zoneAudioPreviewRamRefCount = String(ramRefKeys.size);
  out.dataset.zoneAudioPreviewEventsWithUnresolvedRefs = String(eventsWithUnresolvedRefs);
  out.dataset.zoneAudioPreviewUnresolvedRefCount = String(unresolvedRefKeys.size);
  out.dataset.zoneAudioPreviewEventsWithOutputPhaseLinks = String(eventsWithOutputPhaseLinks);
  out.dataset.zoneAudioPreviewDirectOutputPhaseLinkCount = String(outputPhaseKeys.size);
  out.dataset.zoneAudioPreviewEventsWithTraceOps = String(eventsWithTraceOps);
  out.dataset.zoneAudioPreviewTraceOpCount = String(traceOpKeys.size);
  out.dataset.zoneAudioPreviewTraceStateFieldCount = String(traceStateFieldKeys.size);
  out.dataset.zoneAudioPreviewTraceKnownFieldCount = String(traceStateKnownFieldKeys.size);
  out.dataset.zoneAudioPreviewTraceConditionalFieldCount = String(traceStateConditionalFieldKeys.size);
  out.dataset.zoneAudioPreviewTraceKnownOperationCount = String(traceStateKnownOperations);
  out.dataset.zoneAudioPreviewTraceConditionalOperationCount = String(traceStateConditionalOperations);
  out.dataset.zoneAudioPreviewTraceUnresolvedOperationCount = String(traceStateUnresolvedOperations);
  out.dataset.zoneAudioPreviewTraceTouchedOperationCount = String(traceStateTouchedOperations);
  out.dataset.zoneAudioTraceModelRuleCount = String(zoneAudioTraceModelCatalog()?.summary?.applicationRuleCount || 0);
  const supportUseCatalog = zoneAudioSupportTableUseCatalog();
  out.dataset.zoneAudioSupportUseUniqueF5EventCount = String(supportUseCatalog?.summary?.uniqueStreamF5EventCount || 0);
  out.dataset.zoneAudioSupportUsePrefixEscapeF5EventCount = String(supportUseCatalog?.summary?.prefixEscapeF5EventCount || 0);
  out.dataset.zoneAudioSupportUseOutOfRangeF5EventCount = String(supportUseCatalog?.summary?.outOfRangeF5EventCount || 0);
  const noteTimingCatalog = zoneAudioNoteTimingSupportCatalog();
  out.dataset.zoneAudioNoteTimingTableBytes = String(noteTimingCatalog?.summary?.timingTableBytes || 0);
  out.dataset.zoneAudioPreviewNoteTimingEvents = String(noteTimingEvents);
  out.dataset.zoneAudioPreviewNoteTimingResolvedEvents = String(noteTimingResolvedEvents);
  out.dataset.zoneAudioPreviewNoteTimingUnresolvedEvents = String(noteTimingUnresolvedEvents);
  out.dataset.zoneAudioPreviewNoteTimingReloadEvents = String(noteTimingReloadEvents);
  out.dataset.zoneAudioPreviewNoteTimingReloadResolvedEvents = String(noteTimingReloadResolvedEvents);
  out.dataset.zoneAudioPreviewNoteTimingReloadUnresolvedEvents = String(noteTimingReloadUnresolvedEvents);
  out.dataset.zoneAudioPreviewParameterMirrorEvents = String(parameterMirrorEvents);
  out.dataset.zoneAudioPreviewParameterMirrorPitchResolvedEvents = String(parameterMirrorPitchResolvedEvents);
  out.dataset.zoneAudioPreviewParameterMirrorPitchUnresolvedEvents = String(parameterMirrorPitchUnresolvedEvents);
  out.dataset.zoneAudioPreviewParameterMirrorVolumeConditionalEvents = String(parameterMirrorVolumeConditionalEvents);
  out.dataset.zoneAudioPreviewParameterMirrorVolumeUnresolvedEvents = String(parameterMirrorVolumeUnresolvedEvents);
  out.dataset.zoneAudioPreviewParameterOutputReadinessPhaseCount = String(parameterOutputReadinessPhaseCount);
  out.dataset.zoneAudioPreviewParameterOutputReadinessResolvedInputCount = String(parameterOutputReadinessResolvedInputCount);
  out.dataset.zoneAudioPreviewParameterOutputReadinessConditionalInputCount = String(parameterOutputReadinessConditionalInputCount);
  out.dataset.zoneAudioPreviewParameterOutputReadinessUnresolvedInputCount = String(parameterOutputReadinessUnresolvedInputCount);
  out.dataset.zoneAudioPreviewOutputPhaseScheduleEventCount = String(outputPhaseScheduleEventCount);
  out.dataset.zoneAudioPreviewOutputPhaseSchedulePhaseCount = String(outputPhaseSchedulePhaseCount);
  out.dataset.zoneAudioPreviewOutputPhaseScheduleWriteCount = String(outputPhaseScheduleWriteCount);
  out.dataset.zoneAudioPreviewOutputPhaseScheduleResolvedInputCount = String(outputPhaseScheduleResolvedInputCount);
  out.dataset.zoneAudioPreviewOutputPhaseScheduleConditionalInputCount = String(outputPhaseScheduleConditionalInputCount);
  out.dataset.zoneAudioPreviewOutputPhaseSchedulePartialInputCount = String(outputPhaseSchedulePartialInputCount);
  out.dataset.zoneAudioPreviewOutputPhaseScheduleMetadataOnlyCount = String(outputPhaseScheduleMetadataOnlyCount);
  out.dataset.zoneAudioPreviewOutputPhaseSchedulePsgPhaseCount = String(outputPhaseSchedulePsgPhaseCount);
  out.dataset.zoneAudioPreviewOutputPhaseScheduleFmPhaseCount = String(outputPhaseScheduleFmPhaseCount);
  out.dataset.zoneAudioPreviewOutputPhaseScheduleMixedPhaseCount = String(outputPhaseScheduleMixedPhaseCount);
  out.dataset.zoneAudioPreviewOutputPhaseScheduleGlobalInputRefCount = String(outputPhaseScheduleGlobalInputRefCount);
  out.dataset.zoneAudioPreviewOutputPhaseScheduleKnownGlobalInputCount = String(outputPhaseScheduleKnownGlobalInputCount);
  out.dataset.zoneAudioPreviewOutputPhaseScheduleConditionalGlobalInputCount = String(outputPhaseScheduleConditionalGlobalInputCount);
  out.dataset.zoneAudioPreviewOutputPhaseScheduleUnresolvedGlobalInputCount = String(outputPhaseScheduleUnresolvedGlobalInputCount);
  out.dataset.zoneAudioPreviewOutputPhaseScheduleGlobalFlowCatalogBackedCount = String(outputPhaseScheduleGlobalFlowCatalogBackedCount);
  out.dataset.zoneAudioPreviewOutputPhaseScheduleActiveChannelContextCount = String(outputPhaseScheduleActiveChannelContextCount);
  out.dataset.zoneAudioPreviewOutputPhaseScheduleAudioOutputModeSelectConditionalCount = String(outputPhaseScheduleAudioOutputModeSelectConditionalCount);
  out.dataset.zoneAudioPreviewOutputPhaseSchedulePsgVolumeBiasUnresolvedCount = String(outputPhaseSchedulePsgVolumeBiasUnresolvedCount);
  out.dataset.zoneAudioPreviewOutputPhaseScheduleModeBranchCandidateCount = String(outputPhaseScheduleModeBranchCandidateCount);
  out.dataset.zoneAudioPreviewOutputPhaseSchedulePsgModeBranchCandidateCount = String(outputPhaseSchedulePsgModeBranchCandidateCount);
  out.dataset.zoneAudioPreviewOutputPhaseScheduleFmModeBranchCandidateCount = String(outputPhaseScheduleFmModeBranchCandidateCount);
  out.dataset.zoneAudioPreviewOutputPhaseScheduleModeIndependentCandidateCount = String(outputPhaseScheduleModeIndependentCandidateCount);
  out.dataset.zoneAudioPreviewOutputRegisterTimelineEventCount = String(outputRegisterTimelineEventCount);
  out.dataset.zoneAudioPreviewOutputRegisterTimelineEntryCount = String(outputRegisterTimelineEntryCount);
  out.dataset.zoneAudioPreviewOutputRegisterTimelineFrameLinkedEntryCount = String(outputRegisterTimelineFrameLinkedEntryCount);
  out.dataset.zoneAudioPreviewOutputRegisterTimelineFrameUnlinkedEntryCount = String(outputRegisterTimelineFrameUnlinkedEntryCount);
  out.dataset.zoneAudioPreviewOutputRegisterTimelineWriteCount = String(outputRegisterTimelineWriteCount);
  out.dataset.zoneAudioPreviewOutputRegisterTimelinePsgEntryCount = String(outputRegisterTimelinePsgEntryCount);
  out.dataset.zoneAudioPreviewOutputRegisterTimelineFmEntryCount = String(outputRegisterTimelineFmEntryCount);
  out.dataset.zoneAudioPreviewOutputRegisterTimelineMixedEntryCount = String(outputRegisterTimelineMixedEntryCount);
  out.dataset.zoneAudioPreviewOutputRegisterTimelineResolvedInputCount = String(outputRegisterTimelineResolvedInputCount);
  out.dataset.zoneAudioPreviewOutputRegisterTimelineConditionalInputCount = String(outputRegisterTimelineConditionalInputCount);
  out.dataset.zoneAudioPreviewOutputRegisterTimelinePartialInputCount = String(outputRegisterTimelinePartialInputCount);
  out.dataset.zoneAudioPreviewOutputRegisterTimelineMetadataOnlyCount = String(outputRegisterTimelineMetadataOnlyCount);
  out.dataset.zoneAudioPreviewOutputRegisterTimelineFixtureLinkedEntryCount = String(outputRegisterTimelineFixtureLinkedEntryCount);
  out.dataset.zoneAudioPreviewOutputRegisterTimelineFixtureMissingEntryCount = String(outputRegisterTimelineFixtureMissingEntryCount);
  out.dataset.zoneAudioPreviewOutputRegisterTimelineFixtureLinkedWriteCount = String(outputRegisterTimelineFixtureLinkedWriteCount);
  out.dataset.zoneAudioPreviewOutputRegisterTimelineFixtureWriteMismatchEntryCount = String(outputRegisterTimelineFixtureWriteMismatchEntryCount);
  const runtimeOutputFixtureCatalog = audioRuntimeOutputFixtureCatalog();
  out.dataset.zoneAudioPreviewOutputRegisterTimelineFixtureCatalogBacked = runtimeOutputFixtureCatalog ? '1' : '0';
  out.dataset.zoneAudioPreviewOutputRegisterTimelineFixtureCatalogId = runtimeOutputFixtureCatalog?.id || '';
  out.dataset.zoneAudioPreviewOutputRegisterTimelineGlobalInputRefCount = String(outputRegisterTimelineGlobalInputRefCount);
  out.dataset.zoneAudioPreviewOutputRegisterTimelineKnownGlobalInputCount = String(outputRegisterTimelineKnownGlobalInputCount);
  out.dataset.zoneAudioPreviewOutputRegisterTimelineConditionalGlobalInputCount = String(outputRegisterTimelineConditionalGlobalInputCount);
  out.dataset.zoneAudioPreviewOutputRegisterTimelineUnresolvedGlobalInputCount = String(outputRegisterTimelineUnresolvedGlobalInputCount);
  out.dataset.zoneAudioPreviewOutputRegisterTimelineGlobalFlowCatalogBackedCount = String(outputRegisterTimelineGlobalFlowCatalogBackedCount);
  out.dataset.zoneAudioPreviewOutputRegisterTimelineActiveChannelContextCount = String(outputRegisterTimelineActiveChannelContextCount);
  out.dataset.zoneAudioPreviewOutputRegisterTimelineAudioOutputModeSelectConditionalCount = String(outputRegisterTimelineAudioOutputModeSelectConditionalCount);
  out.dataset.zoneAudioPreviewOutputRegisterTimelinePsgVolumeBiasUnresolvedCount = String(outputRegisterTimelinePsgVolumeBiasUnresolvedCount);
  out.dataset.zoneAudioPreviewOutputRegisterTimelineModeBranchCandidateCount = String(outputRegisterTimelineModeBranchCandidateCount);
  out.dataset.zoneAudioPreviewOutputRegisterTimelinePsgModeBranchCandidateCount = String(outputRegisterTimelinePsgModeBranchCandidateCount);
  out.dataset.zoneAudioPreviewOutputRegisterTimelineFmModeBranchCandidateCount = String(outputRegisterTimelineFmModeBranchCandidateCount);
  out.dataset.zoneAudioPreviewOutputRegisterTimelineModeIndependentCandidateCount = String(outputRegisterTimelineModeIndependentCandidateCount);
  out.dataset.zoneAudioPreviewOutputRegisterTimelinePsgModeAlternativeEntryCount = String(outputRegisterTimelinePsgModeAlternativeEntryCount);
  out.dataset.zoneAudioPreviewOutputRegisterTimelinePsgModeAlternativeWriteCount = String(outputRegisterTimelinePsgModeAlternativeWriteCount);
  out.dataset.zoneAudioPreviewOutputRegisterTimelineFmModeAlternativeEntryCount = String(outputRegisterTimelineFmModeAlternativeEntryCount);
  out.dataset.zoneAudioPreviewOutputRegisterTimelineFmModeAlternativeWriteCount = String(outputRegisterTimelineFmModeAlternativeWriteCount);
  out.dataset.zoneAudioPreviewOutputModeFilter = outputModeFilter;
  out.dataset.zoneAudioPreviewOutputRegisterTimelineFilteredEntryCount = String(outputRegisterTimelineFilteredEntryCount);
  out.dataset.zoneAudioPreviewOutputRegisterTimelineFilteredWriteCount = String(outputRegisterTimelineFilteredWriteCount);
  out.dataset.zoneAudioPreviewOutputRegisterTimelineFilteredDroppedEntryCount = String(outputRegisterTimelineFilteredDroppedEntryCount);
  out.dataset.zoneAudioPreviewOutputRegisterTimelineFilteredDroppedWriteCount = String(outputRegisterTimelineFilteredDroppedWriteCount);
  out.dataset.zoneAudioPreviewOutputRegisterTimelineFilteredFixtureLinkedEntryCount = String(outputRegisterTimelineFilteredFixtureLinkedEntryCount);
  out.dataset.zoneAudioPreviewOutputRegisterTimelineFilteredFixtureMissingEntryCount = String(outputRegisterTimelineFilteredFixtureMissingEntryCount);
  out.dataset.zoneAudioPreviewOutputRegisterTimelineFilteredFixtureLinkedWriteCount = String(outputRegisterTimelineFilteredFixtureLinkedWriteCount);
  out.dataset.zoneAudioPreviewRuntimeOutputSinkReady = runtimeOutputSink.summary.eventCount ? '1' : '0';
  out.dataset.zoneAudioPreviewRuntimeOutputSinkEventCount = String(runtimeOutputSink.summary.eventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputSinkPhaseEventCount = String(runtimeOutputSink.summary.phaseEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputSinkWriteEventCount = String(runtimeOutputSink.summary.writeEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputSinkSelectedPhaseEventCount = String(runtimeOutputSink.summary.selectedPhaseEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputSinkSelectedWriteEventCount = String(runtimeOutputSink.summary.selectedWriteEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputSinkMissingPhaseFixtureCount = String(runtimeOutputSink.summary.missingPhaseFixtureCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputSinkMissingWriteFixtureCount = String(runtimeOutputSink.summary.missingWriteFixtureCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputSinkFrameLinkedEventCount = String(runtimeOutputSink.summary.frameLinkedEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputSinkFrameUnlinkedEventCount = String(runtimeOutputSink.summary.frameUnlinkedEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputSinkPsgEventCount = String(runtimeOutputSink.summary.psgEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputSinkFmEventCount = String(runtimeOutputSink.summary.fmEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputSinkMixedEventCount = String(runtimeOutputSink.summary.mixedEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputSinkPersistedRegisterValueCount = String(runtimeOutputSink.summary.persistedRegisterValueCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputSinkPersistedRegisterTraceCount = String(runtimeOutputSink.summary.persistedRegisterTraceCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputSinkPersistedSampleCount = String(runtimeOutputSink.summary.persistedSampleCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputSinkPersistedAudioByteCount = String(runtimeOutputSink.summary.persistedAudioByteCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputSinkPersistedRomByteCount = String(runtimeOutputSink.summary.persistedRomByteCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputSinkAssetPolicy = runtimeOutputSink.summary.assetPolicy;
  out.dataset.zoneAudioPreviewRuntimeOutputEventContractCatalogBacked = runtimeOutputEventContractValidation.summary.catalogBacked ? '1' : '0';
  out.dataset.zoneAudioPreviewRuntimeOutputEventContractCatalogId = runtimeOutputEventContractValidation.summary.catalogId || '';
  out.dataset.zoneAudioPreviewRuntimeOutputEventContractReady = runtimeOutputEventContractValidation.summary.readyForRuntimeHarness ? '1' : '0';
  out.dataset.zoneAudioPreviewRuntimeOutputEventContractRequiredKeyCount = String(runtimeOutputEventContractValidation.summary.requiredEventKeyCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputEventContractOptionalKeyCount = String(runtimeOutputEventContractValidation.summary.optionalEventKeyCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputEventContractForbiddenPayloadKeyCount = String(runtimeOutputEventContractValidation.summary.forbiddenPayloadKeyCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputEventContractDerivedModelCount = String(runtimeOutputEventContractValidation.summary.derivedModelCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputEventContractEventCount = String(runtimeOutputEventContractValidation.summary.eventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputEventContractMissingRequiredKeyCount = String(runtimeOutputEventContractValidation.summary.eventMissingRequiredKeyCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputEventContractEventForbiddenPayloadKeyCount = String(runtimeOutputEventContractValidation.summary.eventForbiddenPayloadKeyCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputEventContractModelForbiddenPayloadKeyCount = String(runtimeOutputEventContractValidation.summary.modelForbiddenPayloadKeyCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputEventContractInvalidEventKindCount = String(runtimeOutputEventContractValidation.summary.invalidEventKindCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputEventContractMissingModelCount = String(runtimeOutputEventContractValidation.summary.missingModelCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputEventContractMissingModelSummaryKeyCount = String(runtimeOutputEventContractValidation.summary.modelMissingSummaryKeyCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputEventContractNonZeroPersistedPayloadCount = String(runtimeOutputEventContractValidation.summary.nonZeroPersistedPayloadCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputEventContractValidationIssueCount = String(runtimeOutputEventContractValidation.summary.validationIssueCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputEventContractAssetPolicy = runtimeOutputEventContractValidation.summary.assetPolicy;
  out.dataset.zoneAudioPreviewRuntimeOutputLocalObservationReady = runtimeOutputLocalObservationBundle.summary.readyForLocalBundle ? '1' : '0';
  out.dataset.zoneAudioPreviewRuntimeOutputLocalObservationEventKind = runtimeOutputLocalObservationBundle.eventKind || '';
  out.dataset.zoneAudioPreviewRuntimeOutputLocalObservationCount = String(runtimeOutputLocalObservationBundle.summary.observationCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputLocalObservationPhaseCount = String(runtimeOutputLocalObservationBundle.summary.phaseObservationCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputLocalObservationWriteCount = String(runtimeOutputLocalObservationBundle.summary.writeObservationCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputLocalObservationSelectedCount = String(runtimeOutputLocalObservationBundle.summary.selectedObservationCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputLocalObservationMissingFixtureCount = String(runtimeOutputLocalObservationBundle.summary.missingFixtureObservationCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputLocalObservationForbiddenPayloadKeyCount = String(runtimeOutputLocalObservationBundle.summary.forbiddenPayloadKeyCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputLocalObservationDefaultInputPath = runtimeOutputLocalObservationBundle.summary.defaultFilledObservationPath || '';
  out.dataset.zoneAudioPreviewRuntimeOutputLocalObservationDefaultBundleOutputPath = runtimeOutputLocalObservationBundle.summary.defaultBundleOutputPath || '';
  out.dataset.zoneAudioPreviewRuntimeOutputLocalObservationBundleCommand = runtimeOutputLocalObservationBundle.summary.bundleCommand || '';
  out.dataset.zoneAudioPreviewRuntimeOutputLocalObservationReviewedBundleCommand = runtimeOutputLocalObservationBundle.summary.reviewedBundleCommand || '';
  out.dataset.zoneAudioPreviewRuntimeOutputLocalObservationPersistedRegisterValueCount = String(runtimeOutputLocalObservationBundle.summary.persistedRegisterValueCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputLocalObservationPersistedRegisterTraceCount = String(runtimeOutputLocalObservationBundle.summary.persistedRegisterTraceCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputLocalObservationPersistedPortValueCount = String(runtimeOutputLocalObservationBundle.summary.persistedPortValueCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputLocalObservationPersistedSampleCount = String(runtimeOutputLocalObservationBundle.summary.persistedSampleCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputLocalObservationPersistedAudioByteCount = String(runtimeOutputLocalObservationBundle.summary.persistedAudioByteCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputLocalObservationPersistedRomByteCount = String(runtimeOutputLocalObservationBundle.summary.persistedRomByteCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputLocalObservationPersistedHashCount = String(runtimeOutputLocalObservationBundle.summary.persistedHashCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputLocalObservationAssetPolicy = runtimeOutputLocalObservationBundle.assetPolicy || '';
  out.dataset.zoneAudioPreviewRuntimeOutputAccumulatorReady = runtimeOutputAccumulator.summary.eventCount ? '1' : '0';
  out.dataset.zoneAudioPreviewRuntimeOutputAccumulatorEventCount = String(runtimeOutputAccumulator.summary.eventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputAccumulatorPhaseEventCount = String(runtimeOutputAccumulator.summary.phaseEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputAccumulatorWriteEventCount = String(runtimeOutputAccumulator.summary.writeEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputAccumulatorSelectedEventCount = String(runtimeOutputAccumulator.summary.selectedEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputAccumulatorSelectedPhaseEventCount = String(runtimeOutputAccumulator.summary.selectedPhaseEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputAccumulatorSelectedWriteEventCount = String(runtimeOutputAccumulator.summary.selectedWriteEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputAccumulatorFrameGroupCount = String(runtimeOutputAccumulator.summary.frameGroupCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputAccumulatorFrameLinkedGroupCount = String(runtimeOutputAccumulator.summary.frameLinkedGroupCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputAccumulatorFrameUnlinkedGroupCount = String(runtimeOutputAccumulator.summary.frameUnlinkedGroupCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputAccumulatorUniquePhaseFixtureCount = String(runtimeOutputAccumulator.summary.uniquePhaseFixtureCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputAccumulatorUniqueWriteFixtureCount = String(runtimeOutputAccumulator.summary.uniqueWriteFixtureCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputAccumulatorPortKindCount = String(runtimeOutputAccumulator.summary.portKindCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputAccumulatorBranchKindCount = String(runtimeOutputAccumulator.summary.branchKindCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputAccumulatorInputFieldKeyCount = String(runtimeOutputAccumulator.summary.inputFieldKeyCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputAccumulatorActiveChannelCount = String(runtimeOutputAccumulator.summary.activeChannelCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputAccumulatorPsgEventCount = String(runtimeOutputAccumulator.summary.psgEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputAccumulatorFmEventCount = String(runtimeOutputAccumulator.summary.fmEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputAccumulatorMixedEventCount = String(runtimeOutputAccumulator.summary.mixedEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputAccumulatorPsgWriteEventCount = String(runtimeOutputAccumulator.summary.psgWriteEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputAccumulatorFmWriteEventCount = String(runtimeOutputAccumulator.summary.fmWriteEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputAccumulatorMixedWriteEventCount = String(runtimeOutputAccumulator.summary.mixedWriteEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputAccumulatorPersistedRegisterValueCount = String(runtimeOutputAccumulator.summary.persistedRegisterValueCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputAccumulatorPersistedRegisterTraceCount = String(runtimeOutputAccumulator.summary.persistedRegisterTraceCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputAccumulatorPersistedSampleCount = String(runtimeOutputAccumulator.summary.persistedSampleCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputAccumulatorPersistedAudioByteCount = String(runtimeOutputAccumulator.summary.persistedAudioByteCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputAccumulatorPersistedRomByteCount = String(runtimeOutputAccumulator.summary.persistedRomByteCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputAccumulatorAssetPolicy = runtimeOutputAccumulator.summary.assetPolicy;
  out.dataset.zoneAudioPreviewRuntimeOutputFrameTimelineReady = runtimeOutputFrameTimeline.summary.eventCount ? '1' : '0';
  out.dataset.zoneAudioPreviewRuntimeOutputFrameTimelineFrameCount = String(runtimeOutputFrameTimeline.summary.frameCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputFrameTimelineFrameLinkedCount = String(runtimeOutputFrameTimeline.summary.frameLinkedCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputFrameTimelineFrameUnlinkedCount = String(runtimeOutputFrameTimeline.summary.frameUnlinkedCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputFrameTimelineEventCount = String(runtimeOutputFrameTimeline.summary.eventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputFrameTimelinePhaseEventCount = String(runtimeOutputFrameTimeline.summary.phaseEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputFrameTimelineWriteEventCount = String(runtimeOutputFrameTimeline.summary.writeEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputFrameTimelineSelectedEventCount = String(runtimeOutputFrameTimeline.summary.selectedEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputFrameTimelineSelectedPhaseEventCount = String(runtimeOutputFrameTimeline.summary.selectedPhaseEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputFrameTimelineSelectedWriteEventCount = String(runtimeOutputFrameTimeline.summary.selectedWriteEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputFrameTimelinePsgEventCount = String(runtimeOutputFrameTimeline.summary.psgEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputFrameTimelineFmEventCount = String(runtimeOutputFrameTimeline.summary.fmEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputFrameTimelineMixedEventCount = String(runtimeOutputFrameTimeline.summary.mixedEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputFrameTimelinePsgWriteEventCount = String(runtimeOutputFrameTimeline.summary.psgWriteEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputFrameTimelineFmWriteEventCount = String(runtimeOutputFrameTimeline.summary.fmWriteEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputFrameTimelineMixedWriteEventCount = String(runtimeOutputFrameTimeline.summary.mixedWriteEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputFrameTimelineUniquePhaseFixtureCount = String(runtimeOutputFrameTimeline.summary.uniquePhaseFixtureCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputFrameTimelineUniqueWriteFixtureCount = String(runtimeOutputFrameTimeline.summary.uniqueWriteFixtureCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputFrameTimelinePortKindCount = String(runtimeOutputFrameTimeline.summary.portKindCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputFrameTimelineBranchKindCount = String(runtimeOutputFrameTimeline.summary.branchKindCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputFrameTimelineInputFieldKeyCount = String(runtimeOutputFrameTimeline.summary.inputFieldKeyCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputFrameTimelineActiveChannelCount = String(runtimeOutputFrameTimeline.summary.activeChannelCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputFrameTimelinePersistedRegisterValueCount = String(runtimeOutputFrameTimeline.summary.persistedRegisterValueCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputFrameTimelinePersistedRegisterTraceCount = String(runtimeOutputFrameTimeline.summary.persistedRegisterTraceCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputFrameTimelinePersistedSampleCount = String(runtimeOutputFrameTimeline.summary.persistedSampleCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputFrameTimelinePersistedAudioByteCount = String(runtimeOutputFrameTimeline.summary.persistedAudioByteCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputFrameTimelinePersistedRomByteCount = String(runtimeOutputFrameTimeline.summary.persistedRomByteCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputFrameTimelineAssetPolicy = runtimeOutputFrameTimeline.summary.assetPolicy;
  out.dataset.zoneAudioPreviewRuntimeOutputRegisterIntentReady = runtimeOutputRegisterIntent.summary.eventCount ? '1' : '0';
  out.dataset.zoneAudioPreviewRuntimeOutputRegisterIntentFrameCount = String(runtimeOutputRegisterIntent.summary.frameCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputRegisterIntentPsgOnlyFrameCount = String(runtimeOutputRegisterIntent.summary.psgOnlyFrameCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputRegisterIntentFmOnlyFrameCount = String(runtimeOutputRegisterIntent.summary.fmOnlyFrameCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputRegisterIntentMixedFrameCount = String(runtimeOutputRegisterIntent.summary.mixedFrameCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputRegisterIntentNoWriteFrameCount = String(runtimeOutputRegisterIntent.summary.noWriteFrameCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputRegisterIntentEventCount = String(runtimeOutputRegisterIntent.summary.eventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputRegisterIntentPhaseEventCount = String(runtimeOutputRegisterIntent.summary.phaseEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputRegisterIntentWriteEventCount = String(runtimeOutputRegisterIntent.summary.writeEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputRegisterIntentSelectedEventCount = String(runtimeOutputRegisterIntent.summary.selectedEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputRegisterIntentSelectedPhaseEventCount = String(runtimeOutputRegisterIntent.summary.selectedPhaseEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputRegisterIntentSelectedWriteEventCount = String(runtimeOutputRegisterIntent.summary.selectedWriteEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputRegisterIntentPsgEventCount = String(runtimeOutputRegisterIntent.summary.psgEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputRegisterIntentFmEventCount = String(runtimeOutputRegisterIntent.summary.fmEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputRegisterIntentMixedEventCount = String(runtimeOutputRegisterIntent.summary.mixedEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputRegisterIntentPsgWriteEventCount = String(runtimeOutputRegisterIntent.summary.psgWriteEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputRegisterIntentFmWriteEventCount = String(runtimeOutputRegisterIntent.summary.fmWriteEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputRegisterIntentMixedWriteEventCount = String(runtimeOutputRegisterIntent.summary.mixedWriteEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputRegisterIntentUniquePhaseFixtureCount = String(runtimeOutputRegisterIntent.summary.uniquePhaseFixtureCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputRegisterIntentUniqueWriteFixtureCount = String(runtimeOutputRegisterIntent.summary.uniqueWriteFixtureCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputRegisterIntentPortKindCount = String(runtimeOutputRegisterIntent.summary.portKindCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputRegisterIntentBranchKindCount = String(runtimeOutputRegisterIntent.summary.branchKindCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputRegisterIntentInputFieldKeyCount = String(runtimeOutputRegisterIntent.summary.inputFieldKeyCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputRegisterIntentActiveChannelCount = String(runtimeOutputRegisterIntent.summary.activeChannelCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputRegisterIntentPersistedRegisterValueCount = String(runtimeOutputRegisterIntent.summary.persistedRegisterValueCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputRegisterIntentPersistedRegisterTraceCount = String(runtimeOutputRegisterIntent.summary.persistedRegisterTraceCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputRegisterIntentPersistedSampleCount = String(runtimeOutputRegisterIntent.summary.persistedSampleCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputRegisterIntentPersistedAudioByteCount = String(runtimeOutputRegisterIntent.summary.persistedAudioByteCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputRegisterIntentPersistedRomByteCount = String(runtimeOutputRegisterIntent.summary.persistedRomByteCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputRegisterIntentAssetPolicy = runtimeOutputRegisterIntent.summary.assetPolicy;
  out.dataset.zoneAudioPreviewRuntimeOutputChannelPortIntentReady = runtimeOutputChannelPortIntent.summary.writeEventCount ? '1' : '0';
  out.dataset.zoneAudioPreviewRuntimeOutputChannelPortIntentGroupCount = String(runtimeOutputChannelPortIntent.summary.groupCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputChannelPortIntentFrameCount = String(runtimeOutputChannelPortIntent.summary.frameCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputChannelPortIntentFrameLinkedGroupCount = String(runtimeOutputChannelPortIntent.summary.frameLinkedGroupCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputChannelPortIntentFrameUnlinkedGroupCount = String(runtimeOutputChannelPortIntent.summary.frameUnlinkedGroupCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputChannelPortIntentWriteEventCount = String(runtimeOutputChannelPortIntent.summary.writeEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputChannelPortIntentSelectedWriteEventCount = String(runtimeOutputChannelPortIntent.summary.selectedWriteEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputChannelPortIntentPsgWriteEventCount = String(runtimeOutputChannelPortIntent.summary.psgWriteEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputChannelPortIntentFmWriteEventCount = String(runtimeOutputChannelPortIntent.summary.fmWriteEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputChannelPortIntentFmAddressWriteEventCount = String(runtimeOutputChannelPortIntent.summary.fmAddressWriteEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputChannelPortIntentFmDataWriteEventCount = String(runtimeOutputChannelPortIntent.summary.fmDataWriteEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputChannelPortIntentMixedWriteEventCount = String(runtimeOutputChannelPortIntent.summary.mixedWriteEventCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputChannelPortIntentUniquePhaseFixtureCount = String(runtimeOutputChannelPortIntent.summary.uniquePhaseFixtureCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputChannelPortIntentUniqueWriteFixtureCount = String(runtimeOutputChannelPortIntent.summary.uniqueWriteFixtureCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputChannelPortIntentPortKindCount = String(runtimeOutputChannelPortIntent.summary.portKindCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputChannelPortIntentBranchKindCount = String(runtimeOutputChannelPortIntent.summary.branchKindCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputChannelPortIntentInputFieldKeyCount = String(runtimeOutputChannelPortIntent.summary.inputFieldKeyCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputChannelPortIntentActiveChannelCount = String(runtimeOutputChannelPortIntent.summary.activeChannelCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputChannelPortIntentPhaseKindCount = String(runtimeOutputChannelPortIntent.summary.phaseKindCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputChannelPortIntentSourceEventKindCount = String(runtimeOutputChannelPortIntent.summary.sourceEventKindCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputChannelPortIntentSourceEventRoleCount = String(runtimeOutputChannelPortIntent.summary.sourceEventRoleCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputChannelPortIntentSourceTraceOperationKindCount = String(runtimeOutputChannelPortIntent.summary.sourceTraceOperationKindCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputChannelPortIntentSourceTraceTargetCount = String(runtimeOutputChannelPortIntent.summary.sourceTraceTargetCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputChannelPortIntentSourceRamFieldKeyCount = String(runtimeOutputChannelPortIntent.summary.sourceRamFieldKeyCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputChannelPortIntentSourceUnresolvedRamFieldKeyCount = String(runtimeOutputChannelPortIntent.summary.sourceUnresolvedRamFieldKeyCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputChannelPortIntentSourceTraceLinkedWriteCount = String(runtimeOutputChannelPortIntent.summary.sourceTraceLinkedWriteCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputChannelPortIntentSourceRamLinkedWriteCount = String(runtimeOutputChannelPortIntent.summary.sourceRamLinkedWriteCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputChannelPortIntentSourceUnresolvedRamLinkedWriteCount = String(runtimeOutputChannelPortIntent.summary.sourceUnresolvedRamLinkedWriteCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputChannelPortIntentPersistedRegisterValueCount = String(runtimeOutputChannelPortIntent.summary.persistedRegisterValueCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputChannelPortIntentPersistedRegisterTraceCount = String(runtimeOutputChannelPortIntent.summary.persistedRegisterTraceCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputChannelPortIntentPersistedSampleCount = String(runtimeOutputChannelPortIntent.summary.persistedSampleCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputChannelPortIntentPersistedAudioByteCount = String(runtimeOutputChannelPortIntent.summary.persistedAudioByteCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputChannelPortIntentPersistedRomByteCount = String(runtimeOutputChannelPortIntent.summary.persistedRomByteCount || 0);
  out.dataset.zoneAudioPreviewRuntimeOutputChannelPortIntentAssetPolicy = runtimeOutputChannelPortIntent.summary.assetPolicy;
  out.dataset.zoneAudioPreviewOutputRegisterTimelinePersistedRegisterValueCount = '0';
  out.dataset.zoneAudioPreviewOutputRegisterTimelinePersistedSampleCount = '0';
  out.dataset.zoneAudioPreviewOutputRegisterTimelineAssetPolicy = 'metadata_only_no_register_values_or_samples';
  const frameGateCatalog = zoneAudioFrameGateCatalog();
  out.dataset.zoneAudioFrameGateCatalogGateCount = String(frameGateCatalog?.summary?.gateCount || 0);
  out.dataset.zoneAudioPreviewFrameGateKnownChannels = String(frameGateKnownChannels);
  out.dataset.zoneAudioPreviewFrameGateFetchChannels = String(frameGateFetchChannels);
  out.dataset.zoneAudioPreviewFrameGateWaitChannels = String(frameGateWaitChannels);
  out.dataset.zoneAudioPreviewFrameGateUnresolvedChannels = String(frameGateUnresolvedChannels);
  const seedCatalog = zoneAudioStreamSeedCatalog();
  out.dataset.zoneAudioStreamSeedRequestCount = String(seedCatalog?.summary?.requestSeedCount || 0);
  out.dataset.zoneAudioStreamSeedChannelCount = String(seedCatalog?.summary?.headerChannelSeedCount || 0);
  out.dataset.zoneAudioPreviewSeedResolvedChannels = String(seedResolvedChannels);
  out.dataset.zoneAudioPreviewSeedMissingChannels = String(seedMissingChannels);
  out.dataset.zoneAudioPreviewSeedInitialFetchChannels = String(seedInitialFetchChannels);
  out.dataset.zoneAudioPreviewFrameStepChannels = String(frameStepChannels);
  out.dataset.zoneAudioPreviewFrameStepFrames = String(frameStepFrames);
  out.dataset.zoneAudioPreviewFrameStepFetchFrames = String(frameStepFetchFrames);
  out.dataset.zoneAudioPreviewFrameStepWaitFrames = String(frameStepWaitFrames);
  out.dataset.zoneAudioPreviewFrameStepEventFrames = String(frameStepEventFrames);
  out.dataset.zoneAudioPreviewFrameStepResetFetchFrames = String(frameStepResetFetchFrames);
  out.dataset.zoneAudioPreviewFrameStepUnresolvedFrames = String(frameStepUnresolvedFrames);
  out.dataset.zoneAudioPreviewFrameStepEndedChannels = String(frameStepEndedChannels);
  const outputCatalog = zoneAudioOutputRegisterCatalog();
  out.dataset.zoneAudioOutputPhaseCount = String(outputCatalog?.summary?.phaseCount || 0);
  out.dataset.zoneAudioOutputWriteCount = String(outputCatalog?.summary?.writeCount || 0);
  out.innerHTML = chunks.join('');
}

function zoneAnchorSummaryText(anchor) {
  if (!anchor) return '';
  const parts = [];
  if (anchor.scrollAnchorWord) parts.push(`anchor ${anchor.scrollAnchorWord}`);
  else if (anchor.scrollAnchorRange) {
    parts.push(`anchor ${anchor.scrollAnchorRange.minWord}-${anchor.scrollAnchorRange.maxWord}`);
  }
  if (anchor.scrollAnchorPixels != null) parts.push(`${anchor.scrollAnchorPixels}px`);
  if (anchor.clampCase) parts.push(String(anchor.clampCase).replace(/_/g, ' '));
  else if (Array.isArray(anchor.clampCases) && anchor.clampCases.length) {
    parts.push(anchor.clampCases.map(v => String(v).replace(/_/g, ' ')).join('/'));
  }
  if (anchor.redrawTargetColumnHex) parts.push(`redraw ${anchor.redrawTargetColumnHex}`);
  else if (anchor.redrawTargetColumnRange) {
    parts.push(`redraw ${anchor.redrawTargetColumnRange.minHex}-${anchor.redrawTargetColumnRange.maxHex}`);
  }
  return parts.join(' · ');
}

function zoneRecipeCameraInfoLine(recipe) {
  const camera = recipe?.dependencies?.cameraScroll || null;
  if (!camera) return '';
  const initial = camera.descriptorInitialWorldX || null;
  const nominal = camera.nominalInitialAnchor || null;
  const transition = camera.transitionAdjustment || null;
  const transitionDelta = camera.transitionDelta || null;
  const parts = [];
  if (initial?.word) parts.push(`worldX ${initial.word}`);
  const anchorText = zoneAnchorSummaryText(nominal);
  if (anchorText) parts.push(anchorText);
  const inboundCount = transition?.confirmedInboundTriggerAdjustmentCount ?? 0;
  if (inboundCount) parts.push(`${inboundCount} inbound transition adjustment(s)`);
  if (transitionDelta && transitionDelta.applies === false) parts.push('transition delta none');
  return parts.length ? `camera ${parts.join(' · ')}` : '';
}

function zoneRecipeTransitionSamplesText(camera) {
  const transition = camera?.transitionAdjustment || null;
  const samples = transition?.confirmedInboundTriggerAdjustments || [];
  if (!samples.length) return '';
  return samples.slice(0, 2).map(edge => {
    const adjusted = edge.adjustedCameraAnchor || {};
    const anchor = zoneAnchorSummaryText(adjusted);
    const source = edge.sourceRecipeId || edge.sourceDescriptorId || '?';
    const opcode = edge.rawOpcode || '?';
    return `${source} ${opcode}${edge.deltaWord ? ` ${edge.deltaWord}` : ''}${anchor ? ` ${anchor}` : ''}`;
  }).join(' ; ');
}

function zoneRecipeDiagnosticsHtml(recipe, parsedAudioRequestId) {
  if (!recipe) return '';
  const deps = recipe.dependencies || {};
  const camera = deps.cameraScroll || null;
  const collision = deps.collisionBuffer || camera?.collisionBufferRef || null;
  const audio = zoneRecipeAudioDiagnostic(recipe, parsedAudioRequestId);
  const roomEvents = zoneRecipeEventTableDiagnostic(recipe);
  const rows = [];

  if (collision) {
    const active = collision.activeDc2PrefixCount ?? '?';
    const columns = collision.acceptedCellColumns ?? collision.activeCellsPerRow ?? '?';
    const bound = collision.finalBoundWord || collision.finalHighByte || '?';
    const decoded = collision.decodedWrittenCells != null ? ` · ${collision.decodedWrittenCells} decoded cell(s)` : '';
    rows.push(`
      <div style="grid-column:1/-1;color:#9ae6b4">
        <span style="color:var(--dim)">Collision buffer:</span>
        ${simEscapeHtml(String(active))} active DC2 stream(s) · ${simEscapeHtml(String(columns))} accepted column(s) · bound ${simEscapeHtml(bound)}${decoded}
      </div>`);
  }

  if (camera) {
    const initial = camera.descriptorInitialWorldX || null;
    const nominalText = zoneAnchorSummaryText(camera.nominalInitialAnchor);
    const initialText = initial
      ? `${simEscapeHtml(initial.raw || '?')} -> ${simEscapeHtml(initial.word || '?')}${initial.pixels != null ? ` (${simEscapeHtml(String(initial.pixels))}px)` : ''}`
      : 'metadata missing';
    rows.push(`
      <div style="grid-column:1/-1;color:#7ee787">
        <span style="color:var(--dim)">Camera anchor:</span>
        descriptor ${initialText}${nominalText ? ` · ${simEscapeHtml(nominalText)}` : ''}
      </div>`);
    if (camera.loadPath?.loaderPath) {
      rows.push(`
        <div style="grid-column:1/-1;color:var(--dim)">
          Transition load path: ${simEscapeHtml(camera.loadPath.loaderPath)}
        </div>`);
    }
    const transition = camera.transitionAdjustment || null;
    if (transition) {
      const count = transition.confirmedInboundTriggerAdjustmentCount ?? 0;
      const samples = zoneRecipeTransitionSamplesText(camera);
      rows.push(`
        <div style="grid-column:1/-1;color:var(--dim)">
          Transition camera adjustment: ${simEscapeHtml(String(count))} confirmed inbound trigger edge(s)${samples ? ` · ${simEscapeHtml(samples)}` : ''}
        </div>`);
    }
    if (camera.transitionDelta) {
      const applies = camera.transitionDelta.applies === false ? 'not applied' : 'applied';
      rows.push(`
        <div style="grid-column:1/-1;color:var(--dim)">
          Inline transition delta: ${simEscapeHtml(applies)}${camera.transitionDelta.reason ? ` · ${simEscapeHtml(camera.transitionDelta.reason)}` : ''}
        </div>`);
    }
  }

  if (roomEvents.status) {
    const eventColor = roomEvents.hasRecords ? '#9ae6b4' : 'var(--dim)';
    const acceptedRejected = roomEvents.recordCount
      ? ` · selectors ${roomEvents.acceptedSelectorCount} accepted / ${roomEvents.rejectedSelectorCount} rejected`
      : '';
    rows.push(`
      <div style="grid-column:1/-1;color:${eventColor}">
        <span style="color:var(--dim)">Room events:</span>
        ${simEscapeHtml(roomEvents.romOffset || '?')} · ${simEscapeHtml(String(roomEvents.recordCount))} record(s)${acceptedRejected}
        ${roomEvents.recordKindText ? ` · ${simEscapeHtml(roomEvents.recordKindText)}` : ''}
        ${roomEvents.warningCount ? ` · ${simEscapeHtml(String(roomEvents.warningCount))} warning(s)` : ''}
      </div>`);
    if (roomEvents.selectorOutcomeText) {
      rows.push(`
        <div style="grid-column:1/-1;color:var(--dim)">
          Room event selector outcomes: ${simEscapeHtml(roomEvents.selectorOutcomeText)}
        </div>`);
    }
    if (roomEvents.keyModelText) {
      rows.push(`
        <div style="grid-column:1/-1;color:var(--dim)">
          Room event key model: ${simEscapeHtml(roomEvents.keyModelText)}
        </div>`);
    }
  }

  if (audio.requestId != null) {
    const usage = audio.usage || {};
    const usageText = usage.descriptorCount != null
      ? ` · recipes ${usage.descriptorCount} total / ${usage.zoneRecipeDescriptorCount ?? 0} zone / ${usage.inlineTransitionRecipeDescriptorCount ?? 0} inline`
      : '';
    rows.push(`
      <div style="grid-column:1/-1;color:var(--dim)">
        Audio taxonomy: ${simEscapeHtml(audio.requestIdHex)}${audio.classification ? ` · ${simEscapeHtml(audio.classification)}` : ''}${audio.confidence ? ` · ${simEscapeHtml(audio.confidence)}` : ''}${audio.headerOffset ? ` · header ${simEscapeHtml(audio.headerOffset)}` : ''}${usageText}
      </div>`);
    if (audio.streamGraph) {
      const graphText = zoneRecipeAudioGraphText(audio.streamGraph);
      const streamRegions = (audio.streamGraph.streamRegionIds || []).slice(0, 8).join(' ');
      rows.push(`
        <div style="grid-column:1/-1;color:#9ae6b4">
          <span style="color:var(--dim)">Audio stream graph:</span>
          ${simEscapeHtml(graphText || 'metadata missing')}${streamRegions ? ` · regions ${simEscapeHtml(streamRegions)}` : ''}
        </div>`);
    }
  }

  return rows.join('');
}

function zoneSetRecipeDiagnosticDataset(el, recipe, parsedAudioRequestId) {
  if (!el) return;
  const camera = recipe?.dependencies?.cameraScroll || null;
  const nominal = camera?.nominalInitialAnchor || null;
  const transition = camera?.transitionAdjustment || null;
  const transitionDelta = camera?.transitionDelta || null;
  const collision = recipe?.dependencies?.collisionBuffer || camera?.collisionBufferRef || null;
  const audio = zoneRecipeAudioDiagnostic(recipe, parsedAudioRequestId);
  const roomEvents = zoneRecipeEventTableDiagnostic(recipe);
  el.dataset.zoneCameraSummary = zoneRecipeCameraInfoLine(recipe);
  el.dataset.zoneCameraAnchor = nominal?.scrollAnchorWord || '';
  el.dataset.zoneCameraAnchorRange = nominal?.scrollAnchorRange
    ? `${nominal.scrollAnchorRange.minWord}-${nominal.scrollAnchorRange.maxWord}`
    : '';
  el.dataset.zoneCameraClampCase = nominal?.clampCase || '';
  el.dataset.zoneCameraRedrawColumn = nominal?.redrawTargetColumnHex || '';
  el.dataset.zoneTransitionInboundCount = String(transition?.confirmedInboundTriggerAdjustmentCount ?? 0);
  el.dataset.zoneInlineTransitionDelta = transitionDelta ? String(transitionDelta.applies !== false) : '';
  el.dataset.zoneCollisionActiveDc2PrefixCount = String(collision?.activeDc2PrefixCount ?? '');
  el.dataset.zoneCollisionAcceptedColumns = String(collision?.acceptedCellColumns ?? collision?.activeCellsPerRow ?? '');
  el.dataset.zoneRoomEventTableOffset = roomEvents.romOffset || '';
  el.dataset.zoneRoomEventTableStatus = roomEvents.status || '';
  el.dataset.zoneRoomEventTableRecords = String(roomEvents.recordCount ?? '');
  el.dataset.zoneRoomEventTableHasRecords = roomEvents.hasRecords ? '1' : '0';
  el.dataset.zoneRoomEventTableAcceptedSelectors = String(roomEvents.acceptedSelectorCount ?? '');
  el.dataset.zoneRoomEventTableRejectedSelectors = String(roomEvents.rejectedSelectorCount ?? '');
  el.dataset.zoneRoomEventKeySemanticsCatalog = roomEvents.keySemanticsCatalogId || '';
  el.dataset.zoneAudioRequestId = audio.requestIdHex || '';
  el.dataset.zoneAudioRecipeUsage = audio.usage?.descriptorCount != null ? String(audio.usage.descriptorCount) : '';
  el.dataset.zoneAudioInlineUsage = audio.usage?.inlineTransitionRecipeDescriptorCount != null
    ? String(audio.usage.inlineTransitionRecipeDescriptorCount)
    : '';
  el.dataset.zoneAudioStreamGraphId = audio.streamGraph?.graphId || '';
  el.dataset.zoneAudioReachableStreams = audio.streamGraph?.reachableStreamCount != null
    ? String(audio.streamGraph.reachableStreamCount)
    : '';
  el.dataset.zoneAudioBranchEdges = audio.streamGraph?.branchEdgeCount != null
    ? String(audio.streamGraph.branchEdgeCount)
    : '';
  el.dataset.zoneAudioPointerCallEdges = audio.streamGraph?.immediatePointerCallEdgeCount != null
    ? String(audio.streamGraph.immediatePointerCallEdgeCount)
    : '';
  el.dataset.zoneAudioJumpEdges = audio.streamGraph?.jumpPointerEdgeCount != null
    ? String(audio.streamGraph.jumpPointerEdgeCount)
    : '';
  el.dataset.zoneAudioMaxBranchDepth = audio.streamGraph?.maxBranchDepth != null
    ? String(audio.streamGraph.maxBranchDepth)
    : '';
  el.dataset.zoneAudioMissingGraphTargets = audio.streamGraph?.missingTargetCount != null
    ? String(audio.streamGraph.missingTargetCount)
    : '';
}

function zoneBrowserApplyCommonPrereqs(state) {
  const steps = zoneCommonPrereqSteps();
  const result = { stepCount: steps.length, entryCount: 0, applied: [], warnings: [] };
  for (const step of steps) {
    const off = zoneRecipeOffset(step.romOffset);
    const label = step.label || step.region?.name || step.region?.id || 'common prerequisite';
    const regionName = `Common prereq ${label}`;
    if (off == null || off < 0 || off >= romData.length) {
      result.warnings.push(`${label}: offset out of range`);
      continue;
    }
    let log = [];
    if (step.loaderType === 'vram_loader_8fb') {
      log = simRunLoader8FB(romData, off, state, {
        regionId: step.region?.id || '',
        regionName,
      });
    } else if (step.loaderType === 'vram_loader_998') {
      log = simRunLoader998(romData, off, state, {
        regionId: step.region?.id || '',
        regionName,
      });
    } else {
      result.warnings.push(`${label}: unsupported loader type ${step.loaderType || '?'}`);
      continue;
    }
    result.entryCount += log.length;
    result.applied.push({
      label,
      loaderType: step.loaderType,
      regionId: step.region?.id || '',
      romOffset: step.romOffset || '',
      entryCount: log.length,
    });
  }
  return result;
}

function zoneBrowserApplyEntrySeed(state) {
  const sel = document.getElementById('zone-entry-seed-sel');
  const seed = zoneBrowserSelectedEntrySeed(sel?.value || '');
  const writerCatalog = zoneSpritePaletteWriterCatalog();
  const writer = zoneEntrySeedWriter(seed);
  const writerSprite = writer?.stateEffects?.spritePalette || null;
  const result = {
    selected: Boolean(seed),
    seedId: seed?.id || '',
    caller: seed?.caller?.label || '',
    writerCatalogId: writerCatalog?.id || '',
    writerCatalogBacked: Boolean(writer),
    writerId: writer?.id || '',
    writerAction: writer?.action || '',
    writerContextRole: writer?.contextRole || '',
    writerSpritePaletteStatus: writerSprite?.status || '',
    writerSpritePaletteRecordRegionId: writerSprite?.record?.region?.id || '',
    stepCount: 0,
    loaderEntryCount: 0,
    spritePaletteApplied: false,
    spritePaletteIndex: seed?.stateEffects?.spritePalette?.index ?? null,
    spritePaletteRegionId: '',
    spritePaletteOffset: '',
    warnings: [],
    applied: [],
  };
  if (!seed) return result;

  const spriteIndex = seed.stateEffects?.spritePalette?.index;
  if (spriteIndex == null) {
    result.warnings.push(`${seed.id}: missing sprite palette index`);
  } else {
    const record = zonePaletteRecordForIndex(spriteIndex);
    const off = zoneRecipeOffset(record?.offset || '');
    if (!record || off == null || off < 0 || off + 15 >= romData.length) {
      result.warnings.push(`${seed.id}: sprite palette record ${spriteIndex} unavailable`);
    } else {
      simLoadCRAM(romData, off, 16, 16, state);
      result.spritePaletteApplied = true;
      result.spritePaletteRegionId = record.region?.id || '';
      result.spritePaletteOffset = record.offset || '';
      result.applied.push({
        kind: 'sprite_palette',
        index: spriteIndex,
        regionId: result.spritePaletteRegionId,
        romOffset: result.spritePaletteOffset,
      });
    }
  }

  for (const step of seed.steps || []) {
    if (step.kind === 'palette_state_write') {
      result.stepCount++;
      continue;
    }
    const off = zoneRecipeOffset(step.romOffset);
    const label = step.sourceLabel || step.region?.name || step.region?.id || step.kind || 'entry seed';
    if (off == null || off < 0 || off >= romData.length) {
      result.warnings.push(`${label}: offset out of range`);
      continue;
    }
    let log = [];
    if (step.kind === 'vram_loader_8fb') {
      log = simRunLoader8FB(romData, off, state, {
        regionId: step.region?.id || '',
        regionName: `Entry seed ${label}`,
      });
    } else if (step.kind === 'vram_loader_998') {
      log = simRunLoader998(romData, off, state, {
        regionId: step.region?.id || '',
        regionName: `Entry seed ${label}`,
      });
    } else {
      result.warnings.push(`${label}: unsupported entry seed step ${step.kind || '?'}`);
      continue;
    }
    result.stepCount++;
    result.loaderEntryCount += log.length;
    result.applied.push({
      kind: step.kind,
      label,
      regionId: step.region?.id || '',
      romOffset: step.romOffset || '',
      entryCount: log.length,
    });
  }
  return result;
}

function zoneBrowserLoadRecipe() {
  const sel = document.getElementById('zone-recipe-sel');
  const recipe = zoneBrowserSelectedRecipe(sel?.value || '');
  if (!recipe) { showToast('Select a zone recipe first', true); return; }
  const descOff = zoneRecipeOffset(recipe.descriptor?.romOffset);
  if (descOff == null) { showToast('Selected recipe has no descriptor offset', true); return; }
  document.getElementById('zone-desc-off').value = '0x' + descOff.toString(16).toUpperCase();
  zoneBrowserParse(recipe.id);
}

function zoneBrowserParse(recipeId) {
  if (!romData) { showToast('Load a ROM first', true); return; }
  if (typeof recipeId !== 'string') recipeId = '';

  const descOff = parseHex(document.getElementById('zone-desc-off').value);
  if (descOff == null || descOff < 0 || descOff + 6 > romData.length) {
    showToast('Invalid descriptor offset', true); return;
  }
  const recipe = zoneBrowserSelectedRecipe(recipeId) || zoneRecipeForDescriptor(descOff);

  // ── Parse 6-byte zone descriptor ───────────────────────────────────────
  const scrollX = romData[descOff];
  const scrollY = romData[descOff + 1];
  const camX    = romData[descOff + 2];
  const camY    = romData[descOff + 3];
  const subZ80  = romData[descOff + 4] | (romData[descOff + 5] << 8);

  // Sub-record is in bank 4: rom = z80 + $8000
  const subRomOff = subZ80 + 0x8000;
  if (subRomOff < 0 || subRomOff + 18 > romData.length) {
    showToast(`Sub-record out of range: ROM $${subRomOff.toString(16).toUpperCase().padStart(5,'0')}`, true);
    return;
  }

  // ── Parse 18-byte sub-record ────────────────────────────────────────────
  const doorZ80      = romData[subRomOff]     | (romData[subRomOff + 1] << 8);
  const p2Z80        = romData[subRomOff + 8] | (romData[subRomOff + 9] << 8);
  const dc2Indices   = Array.from(romData.slice(subRomOff + 10, subRomOff + 16));
  const flags        = romData[subRomOff + 16];
  const paletteIdx   = flags & 0x3F;
  const audioRequestId = romData[subRomOff + 17];

  // Both door table and P2 are also in bank 4
  const doorRomOff = doorZ80 + 0x8000;
  const p2RomOff   = p2Z80  + 0x8000;

  _zoneParsed = { descOff, scrollX, scrollY, camX, camY, subZ80, subRomOff,
                  doorZ80, doorRomOff, p2Z80, p2RomOff, dc2Indices, flags, paletteIdx, audioRequestId, recipe };
  const sel = document.getElementById('zone-recipe-sel');
  if (sel) sel.value = recipe?.id || '';

  _zoneRenderParsedInfo();
  _zoneRenderDoorTable();
  _zoneDecompressDC2();
  document.getElementById('zone-render-section').style.display = '';
}

function _fmt5(v) { return '$' + v.toString(16).toUpperCase().padStart(5,'0'); }
function _fmt4(v) { return '$' + v.toString(16).toUpperCase().padStart(4,'0'); }
function _fmt2(v) { return '$' + v.toString(16).toUpperCase().padStart(2,'0'); }

function _zoneRenderParsedInfo() {
  const z = _zoneParsed;
  const recipe = z.recipe || null;
  const extra998 = recipe?.dependencies?.extra998 || null;
  const audioRequest = recipe?.dependencies?.audioRequest || null;
  const audioRequestId = audioRequest?.requestId ?? z.audioRequestId;
  const audioRequestHex = audioRequest?.requestIdHex || _fmt2(audioRequestId);
  const audioTaxonomy = audioRequest?.taxonomy || null;
  const audioClass = audioTaxonomy?.classification?.kind || null;
  const audioHeader = audioTaxonomy?.headerOffset || null;
  const commonPrereqHtml = zoneCommonPrereqSummaryHtml(recipe);
  const diagnosticsHtml = zoneRecipeDiagnosticsHtml(recipe, z.audioRequestId);
  const cameraLine = zoneRecipeCameraInfoLine(recipe);
  const audioLine = zoneRecipeAudioInfoLine(recipe, z.audioRequestId);
  const recipeHtml = recipe ? `
      <div style="grid-column:1/-1;color:#7ee787"><span style="color:var(--dim)">Recipe:</span> ${simEscapeHtml(recipe.id || '')} · ${simEscapeHtml(recipe.confidence || 'unknown')} confidence</div>
      <div style="grid-column:1/-1;color:var(--dim)">
        8FB recipe ${simEscapeHtml(recipe.dependencies?.vramLoader8fb?.region?.id || recipe.dependencies?.vramLoader8fb?.regionId || '')}
        @ ${simEscapeHtml(recipe.dependencies?.vramLoader8fb?.romOffset || '?')}
        ${extra998?.status === 'required' ? ` · extra 998 ${simEscapeHtml(extra998.regionId || extra998.sourceLabel || '')} @ ${simEscapeHtml(extra998.romOffset || '?')}` : ''}
      </div>
      <div style="grid-column:1/-1;color:var(--dim)">
        Audio request ${simEscapeHtml(audioRequestHex)}${audioClass ? ` · ${simEscapeHtml(audioClass)}` : ''}${audioHeader ? ` · header ${simEscapeHtml(audioHeader)}` : ''}
      </div>
      ${commonPrereqHtml}
      ${diagnosticsHtml}` : '';
  const infoEl = document.getElementById('zone-recipe-info');
  if (infoEl) {
    zoneSetRecipeDiagnosticDataset(infoEl, recipe, z.audioRequestId);
    infoEl.innerHTML = recipe
      ? `Recipe ${simEscapeHtml(recipe.id || '')} selected · render pipeline: common prereq simulation → 8FB → DC2 lookup → ${extra998?.status === 'required' ? 'extra 998 → ' : ''}SMS state${audioLine ? ` · ${simEscapeHtml(audioLine)}` : ` · audio ${simEscapeHtml(audioRequestHex)}${audioClass ? ` ${simEscapeHtml(audioClass)}` : ''}`}${cameraLine ? ` · ${simEscapeHtml(cameraLine)}` : ''}`
      : 'No recipe matched this descriptor; parsing direct ROM descriptor only.';
  }
  zoneAudioSetRecipe(recipe, z.audioRequestId);
  document.getElementById('zone-parsed').style.display = '';
  document.getElementById('zone-parsed').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 20px;">
      <div><span style="color:var(--dim)">Scroll X:</span> ${_fmt2(z.scrollX)}${z.scrollX===0xFF?' <span style="color:#555">(keep)</span>':''}</div>
      <div><span style="color:var(--dim)">Camera X:</span> ${_fmt2(z.camX)}${z.camX===0x80?' <span style="color:#555">(keep)</span>':''}</div>
      <div><span style="color:var(--dim)">Scroll Y:</span> ${_fmt2(z.scrollY)}${z.scrollY===0xFF?' <span style="color:#555">(keep)</span>':''}</div>
      <div><span style="color:var(--dim)">Camera Y:</span> ${_fmt2(z.camY)}${z.camY===0x80?' <span style="color:#555">(keep)</span>':''}</div>
      <div><span style="color:var(--dim)">Sub-record:</span> Z80 ${_fmt4(z.subZ80)} → ROM ${_fmt5(z.subRomOff)}</div>
      <div><span style="color:var(--dim)">Door table:</span> Z80 ${_fmt4(z.doorZ80)} → ROM ${_fmt5(z.doorRomOff)}</div>
      <div><span style="color:var(--dim)">8FB data (P2):</span> Z80 ${_fmt4(z.p2Z80)} → ROM ${_fmt5(z.p2RomOff)}</div>
      <div><span style="color:var(--dim)">Flags/palette byte:</span> ${_fmt2(z.flags)} &nbsp; <span style="color:var(--dim)">Palette idx:</span> ${z.paletteIdx}</div>
      <div><span style="color:var(--dim)">Audio request byte:</span> ${_fmt2(z.audioRequestId)}${audioClass ? ` <span style="color:#555">(${simEscapeHtml(audioClass)})</span>` : ''}</div>
      <div style="grid-column:1/-1"><span style="color:var(--dim)">DC2 indices:</span>
        ${z.dc2Indices.map((v,i) => `<span style="color:#4ade80">[${i}]</span>${_fmt2(v)}`).join(' ')}
      </div>
      ${recipeHtml}
    </div>`;
}

function _zoneRenderDoorTable() {
  const z = _zoneParsed;
  const sec = document.getElementById('zone-door-section');
  const el  = document.getElementById('zone-door-table');
  sec.style.display = '';

  if (!romData || z.doorRomOff < 0 || z.doorRomOff >= romData.length) {
    el.innerHTML = '<div style="font-size:11px;color:#f87171">Door table ROM offset out of range</div>';
    return;
  }

  const doors = [];
  let off = z.doorRomOff;
  for (let i = 0; i < 32 && off + 6 < romData.length; i++) {
    if (romData[off] === 0xFF) break;
    const scrollPos = romData[off] * 8;
    const param     = romData[off + 1];
    const threshold = romData[off + 2] | (romData[off + 3] << 8);
    const roomType  = romData[off + 4] & 0x1F;
    const destZ80   = romData[off + 5] | (romData[off + 6] << 8);
    const destRom   = destZ80 + 0x8000;
    doors.push({ scrollPos, param, threshold, roomType, destZ80, destRom });
    off += 7;
  }

  if (!doors.length) {
    el.innerHTML = '<div style="font-size:11px;color:var(--dim);font-style:italic">No door entries ($FF terminator at start)</div>';
    return;
  }

  el.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:10px;font-family:var(--mono)">
    <thead><tr style="color:var(--dim);border-bottom:1px solid var(--border)">
      <th style="text-align:left;padding:2px 6px">ScrollX</th>
      <th style="text-align:left;padding:2px 6px">Type</th>
      <th style="text-align:left;padding:2px 6px">Threshold</th>
      <th style="text-align:left;padding:2px 6px">Dest Z80</th>
      <th style="text-align:left;padding:2px 6px">Dest ROM</th>
      <th style="text-align:left;padding:2px 6px"></th>
    </tr></thead>
    <tbody>${doors.map(d => `
    <tr style="border-bottom:1px solid rgba(255,255,255,.04)">
      <td style="padding:2px 6px;color:#4ade80">${d.scrollPos}px</td>
      <td style="padding:2px 6px;color:#ffcc00">${d.roomType}</td>
      <td style="padding:2px 6px">${_fmt4(d.threshold)}</td>
      <td style="padding:2px 6px">${_fmt4(d.destZ80)}</td>
      <td style="padding:2px 6px;color:#4a9eff">${_fmt5(d.destRom)}</td>
      <td style="padding:2px 6px"><button class="btn small" onclick="document.getElementById('zone-desc-off').value='${_fmt5(d.destRom)}';zoneBrowserParse()">FOLLOW →</button></td>
    </tr>`).join('')}</tbody>
  </table>`;
}

function _zoneDecompressDC2() {
  const z = _zoneParsed;
  const DC2_TABLE = 0x14000; // _DATA_14000_, bank 5: rom = z80 + $C000
  const DC2_BANK5 = 0xC000;

  const streams = [];
  for (let i = 0; i < 6; i++) {
    const idx    = z.dc2Indices[i];
    if (idx === 0xFF) { streams.push(null); continue; }
    const ptrOff = DC2_TABLE + idx * 2;
    if (ptrOff + 1 >= romData.length) { streams.push(null); continue; }
    const z80Ptr = romData[ptrOff] | (romData[ptrOff + 1] << 8);
    const romOff = z80Ptr + DC2_BANK5;
    if (romOff < 0 || romOff >= romData.length) { streams.push(null); continue; }
    const src = romData.slice(romOff, Math.min(romOff + 512, romData.length));
    const data = simDecompressScrollMap(src);
    streams.push({ idx, z80Ptr, romOff, data });
  }
  _zoneParsed.dc2Streams = streams;

  // ── Render color-coded DC2 index grid ──────────────────────────────────
  const sec    = document.getElementById('zone-dc2-section');
  const infoEl = document.getElementById('zone-dc2-info');
  const canvas = document.getElementById('zone-dc2-canvas');
  sec.style.display = '';

  const maxRows = Math.max(0, ...streams.filter(Boolean).map(s => s.data.length));
  const ROWS = Math.min(maxRows, 64), COLS = 6, CELL = 14;
  canvas.width  = COLS * CELL;
  canvas.height = ROWS * CELL;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#111'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = '8px monospace';

  streams.forEach((s, col) => {
    if (!s) {
      ctx.fillStyle = '#f87171';
      ctx.fillRect(col * CELL, 0, CELL - 1, ROWS * CELL);
      return;
    }
    for (let row = 0; row < Math.min(s.data.length, ROWS); row++) {
      const val = s.data[row];
      const hue = (val * 137) % 360;
      ctx.fillStyle = `hsl(${hue},65%,38%)`;
      ctx.fillRect(col * CELL, row * CELL, CELL - 1, CELL - 1);
      ctx.fillStyle = '#fff';
      ctx.fillText(val.toString(16).toUpperCase().padStart(2,'0'), col * CELL + 1, row * CELL + CELL - 3);
    }
  });

  infoEl.innerHTML = streams.map((s, i) => s
    ? `<span style="color:#4ade80">S${i}</span>&nbsp;idx=${_fmt2(s.idx)}&nbsp;${_fmt4(s.z80Ptr)}&nbsp;(${s.data.length}B)`
    : `<span style="color:#f87171">S${i}:err</span>`
  ).join(' &nbsp;·&nbsp; ');
}

function zoneBrowserRender() {
  const z = _zoneParsed;
  if (!z || !z.dc2Streams || !romData) { showToast('Parse a zone first', true); return; }

  const LOOKUP_BASE = 0x18000; // _DATA_18000_, bank 6: rom = z80 + $10000
  const NT_BASE = 0x3800;
  const COLS = 12, ROWS = 22;

  // Build state: common INIT steps, optional entry-scene seed, then zone loaders.
  const state = simBuildBaseState();
  const commonPrereq = zoneBrowserApplyCommonPrereqs(state);
  const entrySeed = zoneBrowserApplyEntrySeed(state);
  const loader8fb = z.recipe?.dependencies?.vramLoader8fb || null;
  const log8fb = simRunLoader8FB(romData, z.p2RomOff, state, {
    regionId: loader8fb?.region?.id || loader8fb?.regionId || '',
    regionName: loader8fb?.region?.name || `Zone 8FB @ ${_fmt5(z.p2RomOff)}`,
  });
  let log998 = [];
  let extra998Status = 'not required';
  const extra998 = z.recipe?.dependencies?.extra998 || null;
  if (extra998?.status === 'required') {
    const extraOff = zoneRecipeOffset(extra998.romOffset);
    if (extraOff != null && extraOff >= 0 && extraOff < romData.length) {
      log998 = simRunLoader998(romData, extraOff, state, {
        regionId: extra998.regionId || '',
        regionName: extra998.sourceLabel || extra998.regionId || `Zone extra 998 @ ${_fmt5(extraOff)}`,
      });
      extra998Status = `${log998.length} entries loaded`;
    } else {
      extra998Status = 'metadata offset out of range';
    }
  }
  const paletteLoad = zoneBrowserApplyPalette(state, z.recipe, z.paletteIdx);
  const spritePalette = zoneBrowserSpritePaletteStatus(z.recipe);

  // Build name table from DC2 streams + _DATA_18000_ lookup
  // Each DC2 stream (pair P = 0-5) → 11 tile indices
  // Each tile index → 8 bytes in _DATA_18000_:
  //   bytes 0-3 = 2 NT words for even screen column (pair*2)
  //   bytes 4-7 = 2 NT words for odd screen column  (pair*2+1)
  // The 2 NT words map to 2 consecutive screen rows (row*2, row*2+1)
  const writtenCells = new Set();
  z.dc2Streams.forEach((s, pair) => {
    if (!s) return;
    const evenCol = pair * 2;
    const oddCol  = pair * 2 + 1;
    const rowCount = Math.min(s.data.length, 11);
    for (let row = 0; row < rowCount; row++) {
      const tileIdx  = s.data[row];
      const lookupOff = LOOKUP_BASE + tileIdx * 8;
      if (lookupOff + 8 > romData.length) continue;

      const ew0 = romData[lookupOff]     | (romData[lookupOff + 1] << 8);
      const ew1 = romData[lookupOff + 2] | (romData[lookupOff + 3] << 8);
      const ow0 = romData[lookupOff + 4] | (romData[lookupOff + 5] << 8);
      const ow1 = romData[lookupOff + 6] | (romData[lookupOff + 7] << 8);

      const ntRowA = row * 2, ntRowB = row * 2 + 1;
      // even column
      let addr = NT_BASE + ntRowA * 64 + evenCol * 2;
      if (addr + 1 < state.vram.length) { state.vram[addr] = ew0 & 0xFF; state.vram[addr+1] = (ew0>>8)&0xFF; writtenCells.add(ntRowA * 32 + evenCol); }
      addr = NT_BASE + ntRowB * 64 + evenCol * 2;
      if (addr + 1 < state.vram.length) { state.vram[addr] = ew1 & 0xFF; state.vram[addr+1] = (ew1>>8)&0xFF; writtenCells.add(ntRowB * 32 + evenCol); }
      // odd column
      addr = NT_BASE + ntRowA * 64 + oddCol * 2;
      if (addr + 1 < state.vram.length) { state.vram[addr] = ow0 & 0xFF; state.vram[addr+1] = (ow0>>8)&0xFF; writtenCells.add(ntRowA * 32 + oddCol); }
      addr = NT_BASE + ntRowB * 64 + oddCol * 2;
      if (addr + 1 < state.vram.length) { state.vram[addr] = ow1 & 0xFF; state.vram[addr+1] = (ow1>>8)&0xFF; writtenCells.add(ntRowB * 32 + oddCol); }
    }
  });

  const canvas = document.getElementById('zone-render-canvas');
  renderSMSState(state, canvas, 2, { cols: COLS, rows: ROWS, ntBase: NT_BASE, ntStrideCols: 32 });
  canvas.style.display = 'block';

  const provSummary = simAnalyzeNameTableCellsProvenance(state, writtenCells, NT_BASE);
  const infoEl = document.getElementById('zone-render-info');
  infoEl.dataset.zoneRecipeId = z.recipe?.id || '';
  zoneSetRecipeDiagnosticDataset(infoEl, z.recipe, z.audioRequestId);
  infoEl.dataset.commonPrereqSteps = String(commonPrereq.stepCount);
  infoEl.dataset.commonPrereqEntries = String(commonPrereq.entryCount);
  infoEl.dataset.zoneEntrySeedSelected = entrySeed.selected ? '1' : '0';
  infoEl.dataset.zoneEntrySeedId = entrySeed.seedId || '';
  infoEl.dataset.zoneEntrySeedCaller = entrySeed.caller || '';
  infoEl.dataset.zoneEntrySeedWriterCatalogId = entrySeed.writerCatalogId || '';
  infoEl.dataset.zoneEntrySeedWriterCatalogBacked = entrySeed.writerCatalogBacked ? '1' : '0';
  infoEl.dataset.zoneEntrySeedWriterId = entrySeed.writerId || '';
  infoEl.dataset.zoneEntrySeedWriterAction = entrySeed.writerAction || '';
  infoEl.dataset.zoneEntrySeedWriterContextRole = entrySeed.writerContextRole || '';
  infoEl.dataset.zoneEntrySeedWriterSpritePaletteStatus = entrySeed.writerSpritePaletteStatus || '';
  infoEl.dataset.zoneEntrySeedWriterSpritePaletteRecordRegionId = entrySeed.writerSpritePaletteRecordRegionId || '';
  infoEl.dataset.zoneEntrySeedSteps = String(entrySeed.stepCount || 0);
  infoEl.dataset.zoneEntrySeedLoaderEntries = String(entrySeed.loaderEntryCount || 0);
  infoEl.dataset.zoneEntrySeedSpritePaletteApplied = entrySeed.spritePaletteApplied ? '1' : '0';
  infoEl.dataset.zoneEntrySeedSpritePaletteIndex = entrySeed.spritePaletteIndex == null ? '' : String(entrySeed.spritePaletteIndex);
  infoEl.dataset.zoneEntrySeedSpritePaletteRegionId = entrySeed.spritePaletteRegionId || '';
  infoEl.dataset.zoneEntrySeedWarnings = String(entrySeed.warnings.length);
  infoEl.dataset.zone8fbEntries = String(log8fb.length);
  infoEl.dataset.zone998Entries = String(log998.length);
  infoEl.dataset.zonePaletteApplied = paletteLoad.applied ? '1' : '0';
  infoEl.dataset.zonePaletteIndex = paletteLoad.index == null ? '' : String(paletteLoad.index);
  infoEl.dataset.zonePaletteRegionId = paletteLoad.regionId || '';
  infoEl.dataset.zonePaletteOffset = paletteLoad.romOffset || '';
  infoEl.dataset.zonePaletteNonBlackColors = String(paletteLoad.nonBlackColorCount || 0);
  infoEl.dataset.zoneSpritePaletteStatus = spritePalette.status || '';
  infoEl.dataset.zoneSpritePaletteSource = spritePalette.source || '';
  infoEl.dataset.zoneSpritePaletteInheritanceCatalogId = spritePalette.inheritanceCatalogId || '';
  infoEl.dataset.zoneSpritePaletteInheritanceOwnerStatus = spritePalette.inheritanceOwnerStatus || '';
  infoEl.dataset.zoneSpritePaletteInheritanceStateRam = spritePalette.inheritanceStateRam || '';
  infoEl.dataset.zoneSpritePaletteInheritanceCatalogBacked = spritePalette.inheritanceCatalogBacked ? '1' : '0';
  infoEl.dataset.zoneSpritePaletteInheritanceRuntimePathClassCount = String(spritePalette.inheritanceRuntimePathClassCount || 0);
  infoEl.dataset.zoneSpritePaletteInheritanceClassifiedRuntimePriorCallsites = String(spritePalette.inheritanceClassifiedRuntimePriorCallsiteCount || 0);
  infoEl.dataset.zoneSpritePaletteInheritancePointerFlowBackedRuntimePriorCallsites = String(spritePalette.inheritancePointerFlowBackedRuntimePriorCallsiteCount || 0);
  infoEl.dataset.provenanceUsedSlots = String(provSummary.usedSlots.length);
  infoEl.dataset.provenanceUnresolvedSlots = String(provSummary.unresolvedSlots.length);
  infoEl.dataset.provenanceResolvedSlots = String(provSummary.usedSlots.length - provSummary.unresolvedSlots.length);
  const commonStatus = commonPrereq.stepCount
    ? `${commonPrereq.stepCount} simulation-only step(s), ${commonPrereq.entryCount} entries`
    : 'not available';
  const commonWarn = commonPrereq.warnings.length
    ? ` · warnings: ${simEscapeHtml(commonPrereq.warnings.slice(0, 3).join('; '))}`
    : '';
  const entrySeedText = entrySeed.selected
    ? `${entrySeed.seedId || 'entry seed'} · ${entrySeed.stepCount} step(s), ${entrySeed.loaderEntryCount} loader entries${entrySeed.spritePaletteApplied ? `, SPR ${entrySeed.spritePaletteIndex}` : ''}${entrySeed.writerId ? `, writer ${entrySeed.writerId}` : ''}`
    : 'none';
  const entrySeedWarn = entrySeed.warnings.length
    ? ` · seed warnings: ${simEscapeHtml(entrySeed.warnings.slice(0, 3).join('; '))}`
    : '';
  const cameraLine = zoneRecipeCameraInfoLine(z.recipe);
  const audioLine = zoneRecipeAudioInfoLine(z.recipe, z.audioRequestId);
  const paletteText = paletteLoad.applied
    ? `palette ${paletteLoad.index} ${paletteLoad.regionId || paletteLoad.romOffset} · ${paletteLoad.nonBlackColorCount}/16 non-black`
    : `palette unavailable${paletteLoad.warnings.length ? ` (${paletteLoad.warnings.slice(0, 2).join('; ')})` : ''}`;
  const spritePaletteText = spritePalette.label || 'SPR palette unresolved';
  infoEl.innerHTML =
    `Recipe: ${simEscapeHtml(z.recipe?.id || 'direct descriptor')} · common prereq: ${simEscapeHtml(commonStatus)}${commonWarn} · entry seed: ${simEscapeHtml(entrySeedText)}${entrySeedWarn} · 8FB: ${log8fb.length} entries loaded · 998: ${simEscapeHtml(extra998Status)} · ${simEscapeHtml(paletteText)} · ${simEscapeHtml(spritePaletteText)} · VRAM tile slots used: ${provSummary.usedSlots.length} unique${audioLine ? ` · ${simEscapeHtml(audioLine)}` : ''}${cameraLine ? ` · ${simEscapeHtml(cameraLine)}` : ''} · render ${COLS}×${ROWS}` +
    simProvenanceSummaryHtml(provSummary);
}
