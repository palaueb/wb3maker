'use strict';

// ═══════════════════════════════════════════════════════
//  LABORATORY
// ═══════════════════════════════════════════════════════
let _labId = null;
let _mergeList = [];
let _labAsmByteMap = null;
let _labCurrentPaletteColors = [];

function updateMergeUI() {
  const n = _mergeList.length;
  const inList = _labId && _mergeList.includes(_labId);
  const addBtn = document.getElementById('btn-lab-add-merge');
  addBtn.textContent = inList ? '✓ ADDED' : '+ ADD';
  addBtn.className   = 'btn small' + (inList ? ' success' : '');
  document.getElementById('btn-lab-do-merge').textContent = `MERGE (${n})`;
  document.getElementById('btn-lab-do-merge').disabled = n < 2;
  document.querySelectorAll('#regions-tbody tr').forEach(tr => {
    tr.classList.toggle('row-queued', _mergeList.includes(tr.dataset.id));
  });
}

function openLaboratory(id){
  const r=mapData.regions.find(x=>x.id===id);
  if(!r||!romData){showToast('Load a ROM first',true);return;}
  _labId=id;

  document.getElementById('lab-split-offset').value='';
  document.getElementById('lab-split-preview').style.display='none';

  document.querySelectorAll('#regions-tbody tr').forEach(tr=>tr.classList.remove('row-active'));
  const activeRow=document.querySelector(`#regions-tbody tr[data-id="${id}"]`);
  if(activeRow){activeRow.classList.add('row-active');activeRow.scrollIntoView({block:'nearest',behavior:'smooth'});}
  const idx=mapData.regions.findIndex(r=>r.id===id);
  const total=mapData.regions.length;
  document.getElementById('lab-nav-count').textContent=`${idx+1} / ${total}`;
  document.getElementById('btn-lab-prev').disabled=idx<=0;
  document.getElementById('btn-lab-next').disabled=idx>=total-1;
  updateMergeUI();

  const offset=parseHex(r.offset)??0;
  const size=r.size??0;
  const bytes=romData.subarray(offset,Math.min(offset+size,romData.length));

  document.getElementById('lab-title').textContent=
    `${r.name||'unlabeled'}  ·  ${r.offset}  ·  ${bankAddrStr(offset)}  ·  ${size.toLocaleString()} bytes`;

  labRenderHex(bytes,offset);
  labRenderAsmContext(r,offset);
  labRenderXrefs(r);
  labRenderTiles(bytes);
  labRenderPalette(bytes);
  labRenderStats(bytes,size);
  labRenderTypePreview(r.type, bytes, offset);
  labRenderClassify(r);
  labShowSidePanels(r.type);

  const toViewer=document.getElementById('btn-lab-to-viewer');
  if(r.type==='gfx_tiles'||r.type==='gfx_sprites'){
    toViewer.style.display='';
  } else {
    toViewer.style.display='none';
  }

  document.getElementById('panel-lab').classList.remove('hidden');
  document.getElementById('panel-lab').scrollIntoView({behavior:'smooth'});
}

// ── Z80 instruction size decoder ──────────────────────────────────────────────
function z80InstrSize(bytes, off) {
  if (off >= bytes.length) return 1;
  const b = bytes[off];
  if (b === 0xCB) return 2;
  if (b === 0xED) {
    if (off + 1 >= bytes.length) return 2;
    const b1 = bytes[off+1];
    return (b1===0x43||b1===0x4B||b1===0x53||b1===0x5B||b1===0x63||b1===0x6B||b1===0x73||b1===0x7B) ? 4 : 2;
  }
  if (b === 0xDD || b === 0xFD) {
    if (off + 1 >= bytes.length) return 2;
    const b1 = bytes[off+1];
    if (b1 === 0xCB) return 4;
    if (b1===0x21||b1===0x22||b1===0x2A) return 4;
    if (b1===0x36) return 4;
    const withD=[0x34,0x35,0x46,0x4E,0x56,0x5E,0x66,0x6E,0x70,0x71,0x72,0x73,0x74,0x75,0x77,0x7E,0x86,0x8E,0x96,0x9E,0xA6,0xAE,0xB6,0xBE,0x26,0x2E];
    return withD.includes(b1) ? 3 : 2;
  }
  const S=[
    1,3,1,1,1,1,2,1,1,1,1,1,1,1,2,1,
    2,3,1,1,1,1,2,1,2,1,1,1,1,1,2,1,
    2,3,3,1,1,1,2,1,2,1,3,1,1,1,2,1,
    2,3,3,1,1,1,2,1,2,1,3,1,1,1,2,1,
    1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,
    1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,
    1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,
    1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,
    1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,
    1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,
    1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,
    1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,
    1,1,3,3,3,1,2,1,1,1,3,2,3,3,2,1,
    1,1,3,2,3,1,2,1,1,1,3,2,3,2,2,1,
    1,1,3,1,3,1,2,1,1,1,3,1,3,2,2,1,
    1,1,3,1,3,1,2,1,1,1,3,1,3,2,2,1,
  ];
  return S[b] || 1;
}

function buildAsmByteMap(bytes, asmLines) {
  const byteToLine = new Int32Array(bytes.length).fill(-1);
  const lineToBytes = new Map();
  let byteOff = 0;
  for (let li = 0; li < asmLines.length; li++) {
    if (byteOff >= bytes.length) break;
    const l = asmLines[li].trim();
    if (!l || l.startsWith(';')) continue;
    if (l.match(/^[A-Z_@][A-Z0-9_@.]*:\s*(;.*)?$/i)) continue;
    const dbm = l.match(/^\.(DB)\s+(.+?)(\s*;.*)?$/i);
    if (dbm) {
      const n = dbm[2].split(',').length;
      lineToBytes.set(li, {start:byteOff, end:byteOff+n});
      for (let i=byteOff; i<byteOff+n && i<bytes.length; i++) byteToLine[i]=li;
      byteOff += n; continue;
    }
    const dwm = l.match(/^\.(DW)\s+(.+?)(\s*;.*)?$/i);
    if (dwm) {
      const n = dwm[2].split(',').length * 2;
      lineToBytes.set(li, {start:byteOff, end:byteOff+n});
      for (let i=byteOff; i<byteOff+n && i<bytes.length; i++) byteToLine[i]=li;
      byteOff += n; continue;
    }
    if (l.startsWith('.')) continue;
    const size = z80InstrSize(bytes, byteOff);
    lineToBytes.set(li, {start:byteOff, end:byteOff+size});
    for (let i=byteOff; i<byteOff+size && i<bytes.length; i++) byteToLine[i]=li;
    byteOff += size;
  }
  return {lineToBytes, byteToLine};
}

function labRenderHex(bytes,baseOffset){
  const totalRows=Math.ceil(bytes.length/16);
  const lines=[];
  for(let row=0;row<totalRows;row++){
    const off=row*16;
    const slice=bytes.subarray(off,off+16);
    const hexSpans=Array.from(slice).map((b,i)=>{
      const byteOff=baseOffset+off+i;
      return `<span class="hex-byte" data-boff="${byteOff}">${b.toString(16).padStart(2,'0').toUpperCase()}</span>`;
    }).join(' ');
    const asciiSpans=Array.from(slice).map((b,i)=>{
      const byteOff=baseOffset+off+i;
      const ch=(b>=32&&b<127)?String.fromCharCode(b).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'):'.';
      return `<span class="hex-ascii-char" data-boff="${byteOff}">${ch}</span>`;
    }).join('');
    const absOff=hexStr(baseOffset+off);
    const bankOff=bankAddrStr(baseOffset+off);
    lines.push(`<div class="hex-row"><span class="hex-off" data-off="${absOff}" title="Click to set split point"><span>${absOff}</span><span class="hex-off-sep">·</span><span class="hex-off-bank">${bankOff}</span></span><span class="hex-bytes">${hexSpans}</span><span class="hex-ascii">${asciiSpans}</span></div>`);
  }
  const el=document.getElementById('lab-hex-dump');
  el.innerHTML=lines.join('');

  const addrBar=document.getElementById('lab-hex-addr');
  el.onmouseover=e=>{
    const b=e.target.closest('.hex-byte'),a=e.target.closest('.hex-ascii-char');
    const boffStr=b?.dataset.boff??a?.dataset.boff;
    if(!boffStr)return;
    el.querySelector(`.hex-byte[data-boff="${boffStr}"]`)?.classList.add('hl');
    el.querySelector(`.hex-ascii-char[data-boff="${boffStr}"]`)?.classList.add('hl');
    const n=parseInt(boffStr,10);
    addrBar.textContent=`${hexStr(n)}  ·  ${bankAddrStr(n)}`;
    if(_labAsmByteMap){
      const relOff=n-baseOffset;
      const li=relOff>=0&&relOff<_labAsmByteMap.byteToLine.length?_labAsmByteMap.byteToLine[relOff]:-1;
      if(li>=0){
        const asmEl=document.querySelector(`#lab-type-preview .asm-line-preview[data-li="${li}"]`);
        if(asmEl){asmEl.classList.add('hl-asm');asmEl.scrollIntoView({block:'nearest',behavior:'smooth'});}
      }
    }
  };
  el.onmouseout=e=>{
    const b=e.target.closest('.hex-byte'),a=e.target.closest('.hex-ascii-char');
    if(!b&&!a)return;
    el.querySelectorAll('.hex-byte.hl,.hex-ascii-char.hl').forEach(s=>s.classList.remove('hl'));
    document.querySelectorAll('#lab-type-preview .asm-line-preview.hl-asm').forEach(s=>s.classList.remove('hl-asm'));
    addrBar.textContent='';
  };

  el.onclick=e=>{
    const offSpan=e.target.closest('.hex-off');
    const byteSpan=e.target.closest('.hex-byte');
    if(!offSpan&&!byteSpan)return;
    el.querySelectorAll('.hex-off.split-target,.hex-byte.split-target').forEach(s=>s.classList.remove('split-target'));
    let splitVal;
    if(offSpan){
      splitVal=offSpan.dataset.off;
      offSpan.classList.add('split-target');
    } else {
      const boff=parseInt(byteSpan.dataset.boff,10);
      splitVal=hexStr(boff+1);
      byteSpan.classList.add('split-target');
    }
    document.getElementById('lab-split-offset').value=splitVal;
    updateSplitPreview();
  };
}

function updateSplitPreview(){
  const preview=document.getElementById('lab-split-preview');
  const raw=document.getElementById('lab-split-offset').value.trim();
  const splitOff=parseHex(raw)??parseInt(raw,10);
  if(!_labId||isNaN(splitOff)){preview.style.display='none';return;}
  const r=mapData.regions.find(x=>x.id===_labId);
  if(!r){preview.style.display='none';return;}
  const start=parseHex(r.offset)??0;
  const end=start+(r.size??0);
  if(splitOff<=start||splitOff>=end){
    preview.style.display='block';
    preview.innerHTML=`<span style="color:var(--red)">✗ ${hexStr(splitOff)} is outside this region (${hexStr(start)}–${hexStr(end-1)})</span>`;
    return;
  }
  const s1=splitOff-start, s2=end-splitOff;
  preview.style.display='block';
  preview.innerHTML=
    `<span style="color:var(--text)">Block 1:</span> ${hexStr(start)} `+
    `<span style="color:var(--yellow);font-size:10px">${bankAddrStr(start)}</span>`+
    ` → ${hexStr(splitOff-1)} <span style="color:var(--accent)">(${s1.toLocaleString()} bytes)</span>`+
    `<span style="color:var(--border2);margin:0 10px">│</span>`+
    `<span style="color:var(--accent2)">▶ ${hexStr(splitOff)} `+
    `<span style="font-size:10px">${bankAddrStr(splitOff)}</span></span>`+
    ` <span style="color:var(--text)">Block 2:</span> → ${hexStr(end-1)} `+
    `<span style="color:var(--accent)">(${s2.toLocaleString()} bytes)</span>`;
}

function splitRegionAt(id,splitOffset){
  const r=mapData.regions.find(x=>x.id===id);
  if(!r){showToast('Region not found',true);return;}
  const start=parseHex(r.offset)??0;
  const end=start+(r.size??0);
  if(splitOffset<=start||splitOffset>=end){
    showToast(`Split offset must be inside the region (${hexStr(start)}–${hexStr(end-1)})`,true);return;
  }
  const part1={...r,id:genId(),size:splitOffset-start};
  const part2={...r,id:genId(),offset:hexStr(splitOffset),size:end-splitOffset};
  mapData.regions=mapData.regions.filter(x=>x.id!==id);
  mapData.regions.push(part1,part2);
  mapData.regions.sort((a,b)=>(parseHex(a.offset)??0)-(parseHex(b.offset)??0));
  refreshMapUI();
  openLaboratory(part1.id);
  document.getElementById('lab-split-offset').value='';
  document.getElementById('lab-split-hint').textContent='← click any offset above to fill';
  showToast(`Split: ${part1.size.toLocaleString()}b + ${part2.size.toLocaleString()}b`);
}

function splitRegionByLabels(id){
  const r=mapData.regions.find(x=>x.id===id);
  if(!r){showToast('Region not found',true);return;}
  if(!asmText){showToast('No .asm file loaded',true);return;}
  const regionStart=parseHex(r.offset)??0;
  const regionEnd=regionStart+(r.size??0);
  const asmLines=getAsmLinesForRegion(regionStart,regionEnd);
  if(!asmLines||!asmLines.length){showToast('No ASM found for this region',true);return;}

  const bank=bankOf(regionStart);
  const pageBase=bank===0?0x0000:bank===1?0x4000:0x8000;
  const splitOffsets=new Set();
  const pat=/_(LABEL|CODE|DATA)_([0-9A-Fa-f]+)_:/g;
  for(const line of asmLines){
    let m;
    pat.lastIndex=0;
    while((m=pat.exec(line))!==null){
      const z80=parseInt(m[2],16);
      const romOff=bank*BANK_SIZE+(z80-pageBase);
      if(romOff>regionStart&&romOff<regionEnd)splitOffsets.add(romOff);
    }
  }
  if(!splitOffsets.size){showToast('No label boundaries found inside this region',true);return;}

  const sorted=[...splitOffsets].sort((a,b)=>a-b);
  const parts=[];
  let prev=regionStart;
  for(const sp of sorted){
    parts.push({...r,id:genId(),offset:hexStr(prev),size:sp-prev});
    prev=sp;
  }
  parts.push({...r,id:genId(),offset:hexStr(prev),size:regionEnd-prev});
  mapData.regions=mapData.regions.filter(x=>x.id!==id);
  for(const p of parts)mapData.regions.push(p);
  mapData.regions.sort((a,b)=>(parseHex(a.offset)??0)-(parseHex(b.offset)??0));
  refreshMapUI();
  openLaboratory(parts[0].id);
  showToast(`Split into ${parts.length} sub-regions at ${sorted.length} label boundary${sorted.length!==1?'s':''}`);
}

document.getElementById('lab-split-offset').addEventListener('input', updateSplitPreview);
document.getElementById('btn-lab-split').addEventListener('click',()=>{
  if(!_labId){showToast('No region open',true);return;}
  const raw=document.getElementById('lab-split-offset').value.trim();
  const off=parseHex(raw)??parseInt(raw,10);
  if(isNaN(off)||off<0){showToast('Invalid offset',true);return;}
  splitRegionAt(_labId,off);
});

function labRenderAsmContext(region,offset){
  const titleEl=document.getElementById('lab-asm-title');
  const ctxEl=document.getElementById('lab-asm-context');
  const meta=getAsmMetaForRegion(region);
  if(!asmText||(!meta&&region.type!=='code')){
    titleEl.style.display='none';ctxEl.classList.remove('visible');return;
  }
  titleEl.style.display='';
  const lines=asmText.split('\n');
  let bestLine=-1;
  const z80Addr=romOffsetToZ80(offset);
  const z80H=z80Addr.toString(16).toUpperCase();
  const z80H4=z80Addr.toString(16).toUpperCase().padStart(4,'0');
  const hexOff=offset.toString(16).toUpperCase();
  const patterns=[
    new RegExp(`_DATA_${hexOff}_:`,'i'),
    new RegExp(`from ${hexOff} to`,'i'),
    new RegExp(`_LABEL_${z80H}_:`,'i'),
    new RegExp(`_LABEL_${z80H4}_:`,'i'),
    new RegExp(`\\.BANK\\s+${bankOf(offset)}\\b`,'i'),
  ];
  for(let i=0;i<lines.length;i++){
    for(const p of patterns){if(p.test(lines[i])){bestLine=i;break;}}
    if(bestLine>=0)break;
  }
  if(bestLine<0){ctxEl.classList.remove('visible');titleEl.style.display='none';return;}
  const start=Math.max(0,bestLine-2);
  const end=Math.min(lines.length,bestLine+30);
  const html=lines.slice(start,end).map((l,i)=>{
    const lineNo=start+i;
    const hi=lineNo===bestLine||lineNo===bestLine+1?'asm-hi':'';
    return `<div class="asm-line ${hi}">${l.replace(/</g,'&lt;')}</div>`;
  }).join('');
  ctxEl.innerHTML=html;ctxEl.classList.add('visible');
}

function renderXrefGroup(title, refs){
  const items=refs.length
    ?refs.map(ref=>{
      const off=parseHex(ref.offset)??0;
      const text=`${ref.kind} ${ref.label} @ ${ref.offset}${ref.count>1?` ×${ref.count}`:''}`;
      return `<button class="lab-xref-chip" data-off="${off}" title="${text}">${text}</button>`;
    }).join('')
    :'<span class="lab-xref-chip dim">none</span>';
  return `<div class="lab-xref-group"><div class="lab-xref-label">${title}</div><div class="lab-xref-items">${items}</div></div>`;
}

function labRenderXrefs(region){
  const titleEl=document.getElementById('lab-xrefs-title');
  const wrap=document.getElementById('lab-xrefs');
  const meta=getAsmMetaForRegion(region);
  if(!meta){
    titleEl.style.display='none';
    wrap.classList.remove('visible');
    wrap.innerHTML='';
    return;
  }
  titleEl.style.display='';
  const labelLine=meta.asmLabel
    ?`<div class="lab-xref-group"><div class="lab-xref-label">Label</div><div class="lab-xref-items"><span class="lab-xref-chip dim">${meta.asmLabel} @ ${meta.offset}</span></div></div>`
    :'';
  wrap.innerHTML=
    labelLine+
    renderXrefGroup('Incoming',meta.xrefsIn||[])+
    renderXrefGroup('Outgoing',meta.xrefsOut||[]);
  wrap.classList.add('visible');
  wrap.querySelectorAll('[data-off]').forEach(btn=>btn.addEventListener('click',()=>{
    const off=parseInt(btn.dataset.off,10);
    const target=findRegionContainingOffset(off);
    if(target){openLaboratory(target.id);return;}
    showToast(`No mapped region at ${hexStr(off)}`,true);
  }));
}

function labRenderTiles(bytes){
  const canvas=document.getElementById('lab-tile-canvas');
  if(bytes.length<32){canvas.width=0;canvas.height=0;return;}
  const count=Math.min(Math.floor(bytes.length/32),64);
  const perRow=Math.min(16,count);
  const zoom=3;
  const tw=8*zoom,th=8*zoom,rows=Math.ceil(count/perRow),W=perRow*tw,H=rows*th;
  canvas.width=W;canvas.height=H;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#000';ctx.fillRect(0,0,W,H);
  const img=ctx.createImageData(W,H),px=img.data;
  const pR=new Uint8Array(16),pG=new Uint8Array(16),pB=new Uint8Array(16);
  for(let i=0;i<16;i++){const c=viewerPalette[(i+paletteRotation)%16]||'#000';pR[i]=parseInt(c.slice(1,3),16);pG[i]=parseInt(c.slice(3,5),16);pB[i]=parseInt(c.slice(5,7),16);}
  for(let t=0;t<count;t++){
    const ro=t*32;if(ro+32>bytes.length)break;
    const tile=new Uint8Array(64);
    for(let row=0;row<8;row++){
      const b=ro+row*4,p0=bytes[b],p1=bytes[b+1],p2=bytes[b+2],p3=bytes[b+3];
      for(let bit=7;bit>=0;bit--){const col=7-bit;tile[row*8+col]=((p0>>bit)&1)|(((p1>>bit)&1)<<1)|(((p2>>bit)&1)<<2)|(((p3>>bit)&1)<<3);}
    }
    const tc=t%perRow,tr_=Math.floor(t/perRow),bx=tc*tw,by=tr_*th;
    for(let py=0;py<8;py++)for(let px_=0;px_<8;px_++){
      const ci=tile[py*8+px_],r=pR[ci],g=pG[ci],b=pB[ci];
      for(let zy=0;zy<zoom;zy++)for(let zx=0;zx<zoom;zx++){
        const idx=((by+py*zoom+zy)*W+(bx+px_*zoom+zx))*4;
        px[idx]=r;px[idx+1]=g;px[idx+2]=b;px[idx+3]=255;
      }
    }
  }
  ctx.putImageData(img,0,0);
  ctx.strokeStyle='rgba(255,255,255,.06)';ctx.lineWidth=1;
  for(let r=0;r<=rows;r++){ctx.beginPath();ctx.moveTo(0,r*th);ctx.lineTo(W,r*th);ctx.stroke();}
  for(let c=0;c<=perRow;c++){ctx.beginPath();ctx.moveTo(c*tw,0);ctx.lineTo(c*tw,H);ctx.stroke();}
}

function labRenderPalette(bytes){
  const wrap=document.getElementById('lab-pal-swatches');
  if(bytes.length<1){wrap.innerHTML='<span style="color:var(--dim);font-size:11px">No data</span>';_labCurrentPaletteColors=[];return;}
  const bgC=[],sprC=[];
  for(let i=0;i<Math.min(16,bytes.length);i++)bgC.push(smsColorToHex(bytes[i]));
  for(let i=16;i<Math.min(32,bytes.length);i++)sprC.push(smsColorToHex(bytes[i]));
  _labCurrentPaletteColors=[...bgC,...sprC];
  const row=(cols,lbl)=>`<div style="display:flex;align-items:center;gap:3px;margin-bottom:4px">
    <span style="font-size:9px;color:var(--dim);min-width:28px">${lbl}</span>
    ${cols.map((c,i)=>`<div style="width:20px;height:20px;background:${c};border:1px solid rgba(255,255,255,.1);flex-shrink:0" title="${i}: ${c}"></div>`).join('')}
  </div>`;
  wrap.innerHTML=row(bgC,'BG')+(sprC.length?row(sprC,'SPR'):'');

  const regWrap=document.getElementById('lab-pal-from-registry');
  const palRegions=mapData.regions.filter(r=>r.type==='palette');
  const outerWrap=document.getElementById('lab-pal-from-registry-wrap');
  if(!palRegions.length){outerWrap.style.display='none';return;}
  outerWrap.style.display='';
  regWrap.innerHTML='';
  for(const pr of palRegions){
    const btn=document.createElement('button');
    btn.className='btn small';btn.textContent=pr.name||pr.offset;
    btn.addEventListener('click',()=>{
      if(!romData)return;
      const colors=decodePaletteAt(romData,parseHex(pr.offset)??0,16);
      viewerPalette=[...colors,...Array(16).fill('#000000')].slice(0,16);
      while(viewerPalette.length<16)viewerPalette.push('#000000');
      buildPaletteUI();
      labRenderTiles(romData.subarray(parseHex(mapData.regions.find(x=>x.id===_labId)?.offset)??0));
      showToast(`Palette "${pr.name||pr.offset}" applied`);
    });
    regWrap.appendChild(btn);
  }
}

function labRenderStats(bytes,size){
  const sample=bytes.subarray(0,Math.min(bytes.length,4096));
  const freq=new Array(256).fill(0);
  for(const b of sample)freq[b]++;
  const unique=freq.filter(f=>f>0).length;
  let entropy=0;
  for(const f of freq){if(f>0){const p=f/sample.length;entropy-=p*Math.log2(p);}}
  let maxF=0,maxB=0;
  for(let i=0;i<256;i++)if(freq[i]>maxF){maxF=freq[i];maxB=i;}
  const nullPct=((freq[0]/sample.length)*100).toFixed(1);
  const tileOk=size%32===0;
  const palOk=size>=16&&size<=32;
  let hint='',hintColor='var(--dim)';
  if(entropy>7.0){hint='High entropy — likely raw GFX or music';hintColor='var(--accent2)';}
  else if(entropy>5.5){hint='Medium entropy — structured data or GFX';hintColor='var(--yellow)';}
  else if(entropy<2.0){hint='Very low entropy — padding or repeating pattern';hintColor='var(--dim)';}
  else if(palOk&&unique<=20){hint='Low unique values, small size — possible palette';hintColor='var(--yellow)';}
  const sampled=sample.length<size?`<div class="lab-stat" style="border-color:var(--dim)"><div class="lab-stat-val warn">4096b</div><div class="lab-stat-lbl">SAMPLE (of ${size.toLocaleString()})</div></div>`:'';
  document.getElementById('lab-stats').innerHTML=`
    <div class="lab-stat"><div class="lab-stat-val">${size.toLocaleString()}</div><div class="lab-stat-lbl">TOTAL BYTES</div></div>
    <div class="lab-stat"><div class="lab-stat-val">${unique}</div><div class="lab-stat-lbl">UNIQUE VALUES</div></div>
    <div class="lab-stat"><div class="lab-stat-val">${entropy.toFixed(2)}</div><div class="lab-stat-lbl">ENTROPY /8</div></div>
    <div class="lab-stat"><div class="lab-stat-val">${nullPct}%</div><div class="lab-stat-lbl">NULL BYTES</div></div>
    <div class="lab-stat"><div class="lab-stat-val ${tileOk?'ok':'warn'}">${tileOk?'YES':'NO'}</div><div class="lab-stat-lbl">TILE-ALIGNED (÷32)</div></div>
    <div class="lab-stat"><div class="lab-stat-val">0x${maxB.toString(16).toUpperCase().padStart(2,'0')}</div><div class="lab-stat-lbl">MOST COMMON (×${maxF})</div></div>
    ${sampled}
    ${hint?`<div class="lab-stat" style="flex:1;border-color:${hintColor}"><div class="lab-stat-val" style="color:${hintColor};font-size:12px">${hint}</div><div class="lab-stat-lbl">HINT</div></div>`:''}`;
}

function labRenderTypePreview(type, bytes, baseOffset) {
  const el = document.getElementById('lab-type-preview');
  el.innerHTML = '';
  _labAsmByteMap = null;
  const activeRegion = _labId ? mapData.regions.find(x=>x.id===_labId) : null;
  const asmCodeMeta = getAsmMetaForRegion(activeRegion);

  if (type === 'code' || asmCodeMeta) {
    const titleRow = document.createElement('div');
    titleRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;';
    const title = document.createElement('div');
    title.className = 'lab-section-title';
    title.style.margin = '0';
    title.textContent = 'CODE — ASM PREVIEW';
    titleRow.appendChild(title);

    const box = document.createElement('div');
    box.className = 'type-preview-box';

    if (!asmText) {
      box.innerHTML = '<div class="preview-warn">⚠ No .asm file loaded — use "+ Import disassembly" in Memory Map</div>';
      el.appendChild(titleRow);
    } else {
      const asmLines = getAsmLinesForRegion(baseOffset, baseOffset + bytes.length);
      if (!asmLines || !asmLines.length) {
        box.innerHTML = `<div class="preview-warn">⚠ No .asm entry found for ${hexStr(baseOffset)}</div>`;
        el.appendChild(titleRow);
      } else {
        const btnBar = document.createElement('div');
        btnBar.style.cssText = 'display:flex;gap:5px;align-items:center;';
        const copyBtn = document.createElement('button');
        copyBtn.textContent = 'COPY';
        copyBtn.style.cssText = 'font-family:var(--mono);font-size:10px;padding:2px 8px;background:transparent;border:1px solid var(--border2);color:var(--dim);cursor:pointer;letter-spacing:1px;';
        copyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(asmLines.join('\n')).then(() => {
            copyBtn.textContent = 'COPIED!';
            setTimeout(() => copyBtn.textContent = 'COPY', 1500);
          });
        });
        const splitLblBtn = document.createElement('button');
        splitLblBtn.textContent = '⚡ SPLIT BY LABELS';
        splitLblBtn.title = 'Split this region at every _LABEL_/_CODE_/_DATA_ boundary found in the ASM';
        splitLblBtn.style.cssText = 'font-family:var(--mono);font-size:10px;padding:2px 8px;background:transparent;border:1px solid var(--accent2);color:var(--accent2);cursor:pointer;letter-spacing:1px;';
        splitLblBtn.addEventListener('click', () => splitRegionByLabels(_labId));
        btnBar.appendChild(copyBtn);
        btnBar.appendChild(splitLblBtn);
        titleRow.appendChild(btnBar);
        el.appendChild(titleRow);
        _labAsmByteMap = buildAsmByteMap(bytes, asmLines);
        box.innerHTML = asmLines.map((l, li) => {
          const esc = l.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
          let cls = 'comment';
          if (l.match(/^\s*\.(BANK|ORG|INCBIN|DB|DW)\b/i)) cls = 'directive';
          else if (l.match(/^\s*[A-Z_][A-Z0-9_]*:/i)) cls = 'label';
          else if (!l.startsWith(';') && !l.startsWith('.') && l.trim()) cls = 'code';
          const hasBytes = _labAsmByteMap.lineToBytes.has(li);
          return `<div class="asm-line-preview ${cls}" data-li="${li}"${hasBytes?' style="cursor:crosshair"':''}>${esc}</div>`;
        }).join('');
        box.addEventListener('mouseover', ev => {
          const lineEl = ev.target.closest('.asm-line-preview[data-li]');
          if (!lineEl || !_labAsmByteMap) return;
          const li = parseInt(lineEl.dataset.li);
          const range = _labAsmByteMap.lineToBytes.get(li);
          if (!range) return;
          const hexDump = document.getElementById('lab-hex-dump');
          for (let r = range.start; r < range.end; r++) {
            const byteEl = hexDump.querySelector(`.hex-byte[data-boff="${baseOffset+r}"]`);
            if (byteEl) { byteEl.classList.add('hl-asm'); if (r===range.start) byteEl.scrollIntoView({block:'nearest',behavior:'smooth'}); }
          }
        });
        box.addEventListener('mouseout', ev => {
          if (!ev.target.closest('.asm-line-preview[data-li]')) return;
          document.querySelectorAll('#lab-hex-dump .hex-byte.hl-asm').forEach(s=>s.classList.remove('hl-asm'));
        });
      }
    }
    el.appendChild(box);
    return;
  }

  if (type === 'tile_map') {
    const numEntries=Math.floor(bytes.length/2);
    const cols=32;
    const rows=Math.ceil(numEntries/cols);

    const title=document.createElement('div');
    title.className='lab-section-title';
    title.textContent=`TILE MAP — ${cols}×${rows} (${numEntries} entries, ${bytes.length} bytes)`;
    el.appendChild(title);

    const ctrlRow=document.createElement('div');
    ctrlRow.style.cssText='display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap;';

    const tileLbl=document.createElement('span');
    tileLbl.style.cssText='font-size:10px;color:var(--dim);letter-spacing:1px;white-space:nowrap';
    tileLbl.textContent='TILES:';
    const tileSel=document.createElement('select');
    tileSel.className='region-input';
    tileSel.style.cssText='font-size:11px;padding:2px 4px;flex:1;min-width:100px;';
    tileSel.innerHTML='<option value="">— none —</option>';

    const palLbl=document.createElement('span');
    palLbl.style.cssText='font-size:10px;color:var(--dim);letter-spacing:1px;white-space:nowrap';
    palLbl.textContent='PALETTE:';
    const palSel=document.createElement('select');
    palSel.className='region-input';
    palSel.style.cssText='font-size:11px;padding:2px 4px;flex:1;min-width:100px;';
    palSel.innerHTML='<option value="">Viewer palette</option>';

    let defaultTileId='', defaultPalId='';
    for(const r of mapData.regions){
      if(r.type==='gfx_tiles'||r.type==='gfx_sprites'){
        const o=document.createElement('option');
        o.value=r.id; o.textContent=r.name||r.offset;
        tileSel.appendChild(o);
        if(!defaultTileId) defaultTileId=r.id;
      }
      if(r.type==='palette'||r.type==='palette_manual'){
        const o=document.createElement('option');
        o.value=r.id; o.textContent=r.name||r.offset;
        palSel.appendChild(o);
        if(!defaultPalId) defaultPalId=r.id;
      }
    }
    tileSel.value=defaultTileId;
    palSel.value=defaultPalId;

    ctrlRow.appendChild(tileLbl); ctrlRow.appendChild(tileSel);
    ctrlRow.appendChild(palLbl); ctrlRow.appendChild(palSel);
    el.appendChild(ctrlRow);

    const info=document.createElement('div');
    info.className='preview-info';
    const canvas=document.createElement('canvas');
    canvas.style.cssText='display:block;image-rendering:pixelated;max-width:100%;border:1px solid var(--border)';
    const warnBox=document.createElement('div');
    warnBox.className='type-preview-box';
    el.appendChild(info); el.appendChild(canvas); el.appendChild(warnBox);

    function renderTileMapPreview(){
      const tileId=tileSel.value;
      const palId=palSel.value;
      const tileReg=tileId?mapData.regions.find(r=>r.id===tileId):null;
      const palReg=palId?mapData.regions.find(r=>r.id===palId):null;

      if(!tileReg||!romData){
        canvas.style.display='none'; info.style.display='none'; warnBox.style.display='';
        const rowsHtml=[];
        for(let row=0;row<rows;row++){
          const cells=[];
          for(let col=0;col<cols&&(row*cols+col)<numEntries;col++){
            const i2=row*cols+col;
            const entry=bytes[i2*2]|(bytes[i2*2+1]<<8);
            const idx=entry&0x1FF;
            cells.push(`<span style="color:${idx===0?'var(--border2)':'var(--text)'};font-size:9px">${idx.toString(16).toUpperCase().padStart(3,'0')}</span>`);
          }
          rowsHtml.push(`<div style="display:flex;gap:2px;line-height:1.4">${cells.join(' ')}</div>`);
        }
        warnBox.innerHTML='<div class="preview-warn">⚠ Select a GFX Tiles region to render. Tile indices:</div>'+rowsHtml.join('');
        return;
      }

      canvas.style.display='block'; info.style.display='block'; warnBox.style.display='none';
      const tOff=parseHex(tileReg.offset)??0;
      const tBytes=romData.subarray(tOff,tOff+(tileReg.size??0));
      const palColors=palReg
        ?(palReg.type==='palette_manual'?resolvePaletteManualColors(palReg):decodePaletteAt(romData,parseHex(palReg.offset)??0,16))
        :viewerPalette;

      const zoom=2;
      canvas.width=cols*8*zoom; canvas.height=rows*8*zoom;
      const ctx=canvas.getContext('2d');
      ctx.fillStyle='#000'; ctx.fillRect(0,0,canvas.width,canvas.height);
      const img=ctx.createImageData(canvas.width,canvas.height);
      const pxd=img.data;

      for(let i=0;i<numEntries;i++){
        const entry=bytes[i*2]|(bytes[i*2+1]<<8);
        const tileIdx=entry&0x1FF;
        const hflip=(entry>>9)&1, vflip=(entry>>10)&1;
        const palOff=(entry>>11)&1;
        const tileOff=tileIdx*32;
        if(tileOff+32>tBytes.length) continue;
        const pixels=decodeTile(tBytes,tileOff);
        const bx=(i%cols)*8*zoom, by=Math.floor(i/cols)*8*zoom;
        for(let py=0;py<8;py++) for(let px=0;px<8;px++){
          const sx=hflip?7-px:px, sy=vflip?7-py:py;
          const ci=(pixels[sy*8+sx]+palOff*16)%16;
          const hex=palColors[ci]||viewerPalette[ci]||'#000';
          const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b2=parseInt(hex.slice(5,7),16);
          for(let zy=0;zy<zoom;zy++) for(let zx=0;zx<zoom;zx++){
            const idx=((by+py*zoom+zy)*canvas.width+(bx+px*zoom+zx))*4;
            pxd[idx]=r;pxd[idx+1]=g;pxd[idx+2]=b2;pxd[idx+3]=255;
          }
        }
      }
      ctx.putImageData(img,0,0);
      info.textContent=`Tiles from ${tileReg.offset} (${tileReg.name||'gfx_tiles'})${palReg?' · palette '+palReg.offset:' · viewer palette'}`;
    }

    tileSel.addEventListener('change', renderTileMapPreview);
    palSel.addEventListener('change', renderTileMapPreview);
    renderTileMapPreview();
    return;
  }

  if (type === 'screen_prog') {
    const title = document.createElement('div');
    title.className = 'lab-section-title';
    title.textContent = `SCREEN BYTECODE — ${bytes.length} bytes @ ${hexStr(baseOffset)}`;
    el.appendChild(title);

    const ctrlRow = document.createElement('div');
    ctrlRow.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:4px;flex-wrap:wrap;';
    const ctrlRow2 = document.createElement('div');
    ctrlRow2.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap;';

    const tileLbl = document.createElement('span');
    tileLbl.style.cssText = 'font-size:10px;color:var(--dim);letter-spacing:1px;white-space:nowrap';
    tileLbl.textContent = 'TILES:';
    const tileSel = document.createElement('select');
    tileSel.className = 'region-input';
    tileSel.style.cssText = 'font-size:11px;padding:2px 4px;min-width:120px;';
    tileSel.innerHTML = '<option value="">— none —</option>';

    const tileOffLbl = document.createElement('span');
    tileOffLbl.style.cssText = 'font-size:10px;color:var(--dim);letter-spacing:1px;white-space:nowrap';
    tileOffLbl.textContent = 'TILE OFFSET:';
    const tileOffInput = document.createElement('input');
    tileOffInput.type = 'text';
    tileOffInput.placeholder = '0x00000';
    tileOffInput.style.cssText = 'font-size:11px;padding:2px 6px;width:90px;';
    tileOffInput.title = 'ROM offset of the tile data (hex). Auto-fills from region; can be edited directly.';
    const tileOffDec = document.createElement('button');
    tileOffDec.className = 'btn small';
    tileOffDec.textContent = '◀';
    tileOffDec.title = 'Decrease tile offset by 1 tile (32 bytes)';
    tileOffDec.style.cssText = 'padding:2px 5px;font-size:11px;';
    const tileOffInc = document.createElement('button');
    tileOffInc.className = 'btn small';
    tileOffInc.textContent = '▶';
    tileOffInc.title = 'Increase tile offset by 1 tile (32 bytes)';
    tileOffInc.style.cssText = 'padding:2px 5px;font-size:11px;';
    tileOffDec.addEventListener('click', () => {
      const v = parseHex(tileOffInput.value.trim());
      if (v !== null && v >= 32) { tileOffInput.value = '0x' + (v - 32).toString(16).toUpperCase().padStart(5,'0'); renderScreenProg(); }
    });
    tileOffInc.addEventListener('click', () => {
      const v = parseHex(tileOffInput.value.trim());
      if (v !== null) { tileOffInput.value = '0x' + (v + 32).toString(16).toUpperCase().padStart(5,'0'); renderScreenProg(); }
    });

    const palLbl = document.createElement('span');
    palLbl.style.cssText = 'font-size:10px;color:var(--dim);letter-spacing:1px;white-space:nowrap';
    palLbl.textContent = 'PAL BG:';
    const palSel = document.createElement('select');
    palSel.className = 'region-input';
    palSel.style.cssText = 'font-size:11px;padding:2px 4px;min-width:120px;';
    palSel.innerHTML = '<option value="">Viewer palette</option>';

    const palSprLbl = document.createElement('span');
    palSprLbl.style.cssText = 'font-size:10px;color:var(--accent2);letter-spacing:1px;white-space:nowrap';
    palSprLbl.textContent = 'PAL SPR:';
    const palSprSel = document.createElement('select');
    palSprSel.className = 'region-input';
    palSprSel.style.cssText = 'font-size:11px;padding:2px 4px;min-width:120px;border-color:var(--accent2);';
    palSprSel.innerHTML = '<option value="">same as BG</option>';

    const bankLbl = document.createElement('span');
    bankLbl.style.cssText = 'font-size:10px;color:var(--dim);letter-spacing:1px;white-space:nowrap';
    bankLbl.textContent = 'BANK $8000:';
    bankLbl.title = 'Bank mapped at $8000–$BFFF. Only used to resolve $F4 JUMP opcodes.';
    const bankSel = document.createElement('select');
    bankSel.className = 'region-input';
    bankSel.style.cssText = 'font-size:11px;padding:2px 4px;min-width:80px;';
    bankSel.title = 'Only affects $F4 JUMP resolution — does not change tile loading.';
    const defaultBank = Math.floor(baseOffset / 0x4000);
    for (let b = 0; b < 16; b++) {
      const o = document.createElement('option');
      o.value = b;
      o.textContent = `${b} ($${(b*0x4000).toString(16).toUpperCase().padStart(5,'0')})`;
      if (b === defaultBank) o.selected = true;
      bankSel.appendChild(o);
    }

    let defaultTileId = '', defaultPalId = '';
    for (const r of mapData.regions) {
      if (r.type === 'gfx_tiles' || r.type === 'gfx_sprites') {
        const o = document.createElement('option');
        o.value = r.id; o.textContent = r.name || r.offset;
        tileSel.appendChild(o);
        if (!defaultTileId) defaultTileId = r.id;
      }
      if (r.type === 'palette' || r.type === 'palette_manual') {
        const o1 = document.createElement('option');
        o1.value = r.id; o1.textContent = r.name || r.offset;
        palSel.appendChild(o1);
        const o2 = document.createElement('option');
        o2.value = r.id; o2.textContent = r.name || r.offset;
        palSprSel.appendChild(o2);
        if (!defaultPalId) defaultPalId = r.id;
      }
    }
    tileSel.value = defaultTileId;
    palSel.value = defaultPalId;
    function syncTileOffset() {
      const r = mapData.regions.find(x => x.id === tileSel.value);
      if (r) tileOffInput.value = r.offset;
    }
    tileSel.addEventListener('change', () => { syncTileOffset(); renderScreenProg(); });
    syncTileOffset();

    ctrlRow.appendChild(tileLbl); ctrlRow.appendChild(tileSel);
    ctrlRow.appendChild(tileOffLbl); ctrlRow.appendChild(tileOffDec); ctrlRow.appendChild(tileOffInput); ctrlRow.appendChild(tileOffInc);
    ctrlRow.appendChild(bankLbl); ctrlRow.appendChild(bankSel);
    const forceSprLabel = document.createElement('label');
    forceSprLabel.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:10px;color:var(--accent2);letter-spacing:1px;cursor:pointer;white-space:nowrap;user-select:none;margin-left:6px;';
    const forceSprChk = document.createElement('input');
    forceSprChk.type = 'checkbox';
    forceSprChk.title = 'Force SPR palette on all tiles (ignores attr bit3)';
    forceSprLabel.appendChild(forceSprChk);
    forceSprLabel.appendChild(document.createTextNode('FORCE SPR'));

    ctrlRow2.appendChild(palLbl); ctrlRow2.appendChild(palSel);
    ctrlRow2.appendChild(palSprLbl); ctrlRow2.appendChild(palSprSel);
    ctrlRow2.appendChild(forceSprLabel);
    el.appendChild(ctrlRow);
    el.appendChild(ctrlRow2);

    const info = document.createElement('div');
    info.className = 'preview-info';
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;image-rendering:pixelated;max-width:100%;border:1px solid var(--border);margin-top:4px';
    const logBox = document.createElement('div');
    logBox.style.cssText = 'font-family:var(--mono);font-size:10px;color:var(--dim);margin-top:6px;max-height:100px;overflow-y:auto;line-height:1.5;';
    el.appendChild(info); el.appendChild(canvas); el.appendChild(logBox);

    function z80ToRom(z80, bank8000) {
      if (z80 < 0x8000) return z80;
      if (z80 < 0xC000) return bank8000 * 0x4000 + (z80 - 0x8000);
      return -1;
    }

    function runDecoder() {
      const bank8000 = parseInt(bankSel.value);
      const COLS = 32, ROWS = 28, NT_BASE = 0x3800;
      const nt = new Array(COLS * ROWS).fill(null).map(() => ({tileIdx: 0, attr: 0}));
      let pc = baseOffset;
      let storedVDPaddr = (0x78 << 8) | 0x00;
      let vramAddr = NT_BASE;

      function vdpPairToVram(vdp16) {
        return (vdp16 & 0xFF) | (((vdp16 >> 8) & 0x3F) << 8);
      }
      function posLabel(va) {
        const p = (va - NT_BASE) >> 1;
        return `VRAM $${va.toString(16).toUpperCase().padStart(4,'0')} · col ${p % COLS}, row ${Math.floor(p / COLS)}`;
      }

      let currentAttr = 0;
      const MAX = 50000;
      let iter = 0, tilesWritten = 0;
      let endReason = 'max iterations reached';
      const log = [];

      while (iter++ < MAX && romData && pc < romData.length) {
        const b = romData[pc++];

        if (b < 0xF0) {
          const pos = (vramAddr - NT_BASE) >> 1;
          if (pos >= 0 && pos < COLS * ROWS) { nt[pos].tileIdx = b; nt[pos].attr = currentAttr; tilesWritten++; }
          vramAddr += 2;
          continue;
        }

        switch (b & 0x07) {
          case 0:
            endReason = `$${b.toString(16).toUpperCase()} END @ ROM $${(pc-1).toString(16).toUpperCase().padStart(5,'0')}`;
            iter = MAX;
            break;
          case 1: {
            currentAttr = romData[pc++];
            log.push(`$F1 ATTR ← $${currentAttr.toString(16).toUpperCase().padStart(2,'0')}`);
            break;
          }
          case 2: {
            const lo = romData[pc++], hi = romData[pc++];
            storedVDPaddr = lo | (hi << 8);
            vramAddr = vdpPairToVram(storedVDPaddr);
            log.push(`$F2 ${posLabel(vramAddr)}`);
            break;
          }
          case 3: {
            const t = romData[pc++];
            const pos = (vramAddr - NT_BASE) >> 1;
            if (pos >= 0 && pos < COLS * ROWS) { nt[pos].tileIdx = t; nt[pos].attr = currentAttr; tilesWritten++; }
            vramAddr += 2;
            break;
          }
          case 4: {
            const lo = romData[pc++], hi = romData[pc++];
            const z80 = lo | (hi << 8);
            const newPc = z80ToRom(z80, bank8000);
            log.push(`$F4 JUMP Z80 $${z80.toString(16).toUpperCase().padStart(4,'0')} → ROM $${newPc < 0 ? '???' : newPc.toString(16).toUpperCase().padStart(5,'0')}`);
            if (newPc < 0 || newPc >= romData.length) { endReason = `$F4 JUMP out of range (Z80 $${z80.toString(16).toUpperCase()})`; iter = MAX; }
            else pc = newPc;
            break;
          }
          case 5: {
            const count = romData[pc++], tileIdx = romData[pc++];
            log.push(`$F5 FILL ×${count} tile=$${tileIdx.toString(16).toUpperCase().padStart(2,'0')} @ ${posLabel(vramAddr)}`);
            for (let i = 0; i < count; i++) {
              const pos = (vramAddr - NT_BASE) >> 1;
              if (pos >= 0 && pos < COLS * ROWS) { nt[pos].tileIdx = tileIdx; nt[pos].attr = currentAttr; tilesWritten++; }
              vramAddr += 2;
            }
            break;
          }
          case 6: {
            storedVDPaddr = (storedVDPaddr + 0x0040) & 0xFFFF;
            if ((storedVDPaddr >> 8) >= 0x7F) storedVDPaddr = (storedVDPaddr & 0x00FF) | (0x78 << 8);
            vramAddr = vdpPairToVram(storedVDPaddr);
            log.push(`$F6 NEXT ROW → ${posLabel(vramAddr)}`);
            break;
          }
        }
      }
      return { nt, tilesWritten, endReason, log, iter };
    }

    function renderScreenProg() {
      if (!romData) { info.textContent = '⚠ No ROM loaded'; canvas.style.display = 'none'; return; }
      const { nt, tilesWritten, endReason, log } = runDecoder();

      const COLS = 32, ROWS = 28, zoom = 2;
      canvas.width = COLS * 8 * zoom;
      canvas.height = ROWS * 8 * zoom;
      canvas.style.display = 'block';
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const tileId = tileSel.value;
      const tileReg = tileId ? mapData.regions.find(r => r.id === tileId) : null;
      const manualTileOff = parseHex(tileOffInput.value.trim());

      const palId = palSel.value;
      const palSprId = palSprSel.value;
      const palReg = palId ? mapData.regions.find(r => r.id === palId) : null;
      const palSprReg = palSprId ? mapData.regions.find(r => r.id === palSprId) : null;
      const getPalColors = (reg) => reg
        ? (reg.type === 'palette_manual' ? resolvePaletteManualColors(reg) : decodePaletteAt(romData, parseHex(reg.offset) ?? 0, 16))
        : viewerPalette;
      const palColorsBG  = getPalColors(palReg);
      const palColorsSPR = palSprId ? getPalColors(palSprReg) : palColorsBG;
      const forceSpr = forceSprChk.checked;

      const hasTiles = tileReg || manualTileOff !== null;
      if (hasTiles) {
        const tOff = manualTileOff !== null ? manualTileOff : (parseHex(tileReg.offset) ?? 0);
        const tSize = (tileReg && tileReg.size) ? tileReg.size : (romData.length - tOff);
        const tBytes = romData.subarray(tOff, tOff + tSize);
        const img = ctx.createImageData(canvas.width, canvas.height);
        const pxd = img.data;

        for (let i = 0; i < COLS * ROWS; i++) {
          const {tileIdx, attr} = nt[i];
          const ti = tileIdx | ((attr & 0x01) << 8);
          const hflip = (attr >> 1) & 1;
          const vflip = (attr >> 2) & 1;
          const useSprPal = forceSpr ? 1 : ((attr >> 3) & 1);
          const tOff2 = ti * 32;
          if (tOff2 + 32 > tBytes.length) continue;
          const pixels = decodeTile(tBytes, tOff2);
          const palColors = useSprPal ? palColorsSPR : palColorsBG;
          const bx = (i % COLS) * 8 * zoom, by = Math.floor(i / COLS) * 8 * zoom;
          for (let py = 0; py < 8; py++) for (let px = 0; px < 8; px++) {
            const sx = hflip ? 7 - px : px, sy = vflip ? 7 - py : py;
            const ci = pixels[sy * 8 + sx];
            const hex = palColors[ci] || viewerPalette[ci] || '#000000';
            const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), bv = parseInt(hex.slice(5,7),16);
            for (let zy = 0; zy < zoom; zy++) for (let zx = 0; zx < zoom; zx++) {
              const idx = ((by + py*zoom + zy) * canvas.width + (bx + px*zoom + zx)) * 4;
              pxd[idx] = r; pxd[idx+1] = g; pxd[idx+2] = bv; pxd[idx+3] = 255;
            }
          }
        }
        ctx.putImageData(img, 0, 0);
      } else {
        ctx.fillStyle = '#111'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.font = `${zoom*3}px monospace`;
        for (let i = 0; i < COLS * ROWS; i++) {
          const {tileIdx} = nt[i];
          if (!tileIdx) continue;
          ctx.fillStyle = `hsl(${(tileIdx * 37) % 360},60%,50%)`;
          ctx.fillText(tileIdx.toString(16).toUpperCase().padStart(2,'0'),
            (i % COLS) * 8 * zoom, Math.floor(i / COLS) * 8 * zoom + zoom * 7);
        }
      }

      let nBG = 0, nSPR = 0;
      for (let i = 0; i < COLS * ROWS; i++) {
        const a = nt[i].attr;
        if (nt[i].tileIdx === 0 && a === 0) continue;
        if ((a >> 3) & 1) nSPR++; else nBG++;
      }
      const sprWarn = (nSPR === 0 && palSprSel.value)
        ? ' · <span style="color:#ffcc00">⚠ PAL SPR unused — bytecode never sets bit3 ($F1 attr & 8)</span>'
        : '';
      info.innerHTML = `${tilesWritten} tiles written · BG pal: ${nBG} · SPR pal: ${nSPR}${forceSpr?' [FORCE SPR]':''}${sprWarn} · end: ${endReason}`;
      logBox.innerHTML = log.map(l => `<div>${l.replace(/</g,'&lt;')}</div>`).join('');
    }

    tileOffInput.addEventListener('change', renderScreenProg);
    tileOffInput.addEventListener('keydown', e => { if (e.key === 'Enter') renderScreenProg(); });
    palSel.addEventListener('change', renderScreenProg);
    palSprSel.addEventListener('change', renderScreenProg);
    forceSprChk.addEventListener('change', renderScreenProg);
    bankSel.addEventListener('change', renderScreenProg);
    renderScreenProg();
    return;
  }

  if (type === 'vram_loader') {
    const title = document.createElement('div');
    title.className = 'lab-section-title';
    title.textContent = `VRAM LOADER (_LABEL_8FB_) — ${bytes.length} bytes @ ${hexStr(baseOffset)}`;
    el.appendChild(title);

    const ctrlRow = document.createElement('div');
    ctrlRow.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap;';

    const palLbl = document.createElement('span');
    palLbl.style.cssText = 'font-size:10px;color:var(--dim);letter-spacing:1px;white-space:nowrap';
    palLbl.textContent = 'PAL:';
    const palSel = document.createElement('select');
    palSel.className = 'region-input';
    palSel.style.cssText = 'font-size:11px;padding:2px 4px;flex:1;min-width:100px;';
    palSel.innerHTML = '<option value="">Viewer palette</option>';

    const bankLbl = document.createElement('span');
    bankLbl.style.cssText = 'font-size:10px;color:var(--dim);letter-spacing:1px;white-space:nowrap';
    bankLbl.textContent = 'BANK:';
    const bankSel = document.createElement('select');
    bankSel.className = 'region-input';
    bankSel.style.cssText = 'font-size:11px;padding:2px 4px;min-width:55px;';
    for (let b = 0; b < 16; b++) {
      const o = document.createElement('option');
      o.value = b; o.textContent = `${b}`;
      if (b === 8) o.selected = true;
      bankSel.appendChild(o);
    }

    const overrideLbl = document.createElement('label');
    overrideLbl.style.cssText = 'font-size:10px;color:var(--dim);display:flex;align-items:center;gap:3px;cursor:pointer;white-space:nowrap';
    const overrideChk = document.createElement('input');
    overrideChk.type = 'checkbox';
    overrideChk.title = 'Force all entries to use this bank instead of the per-entry encoded bank';
    overrideLbl.appendChild(overrideChk);
    overrideLbl.appendChild(document.createTextNode('OVERRIDE'));

    for (const r of mapData.regions) {
      if (r.type === 'palette' || r.type === 'palette_manual') {
        const o = document.createElement('option');
        o.value = r.id; o.textContent = r.name || r.offset;
        palSel.appendChild(o);
      }
    }

    const _loaderRegion = mapData.regions.find(x => x.id === _labId);
    const _savedParams = _loaderRegion?.params || {};
    if (_savedParams.palRegionId !== undefined) palSel.value = _savedParams.palRegionId;
    else if (palSel.options.length > 1) palSel.selectedIndex = 1;
    if (_savedParams.bank !== undefined) bankSel.value = _savedParams.bank;
    if (_savedParams.overrideBank) overrideChk.checked = true;

    function persistParams() {
      const reg = mapData.regions.find(x => x.id === _labId);
      if (reg) reg.params = { palRegionId: palSel.value, bank: parseInt(bankSel.value), overrideBank: overrideChk.checked };
    }

    ctrlRow.appendChild(palLbl); ctrlRow.appendChild(palSel);
    ctrlRow.appendChild(bankLbl); ctrlRow.appendChild(bankSel);
    ctrlRow.appendChild(overrideLbl);
    el.appendChild(ctrlRow);

    const tableWrap = document.createElement('div');
    tableWrap.style.cssText = 'overflow-x:auto;margin-bottom:8px;';
    const table = document.createElement('table');
    table.style.cssText = 'font-size:10px;border-collapse:collapse;width:100%;';
    table.innerHTML = `<thead><tr style="color:var(--dim);border-bottom:1px solid var(--border)">
      <th style="padding:2px 6px;text-align:left">#</th>
      <th style="padding:2px 6px;text-align:right">COUNT</th>
      <th style="padding:2px 6px;text-align:right">VRAM TILE</th>
      <th style="padding:2px 6px;text-align:right">VRAM ADDR</th>
      <th style="padding:2px 6px;text-align:right">BANK · ROM SRC</th>
      <th style="padding:2px 6px;text-align:right"></th>
    </tr></thead>`;
    const tbody = document.createElement('tbody');
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    el.appendChild(tableWrap);

    const canvasInfo = document.createElement('div');
    canvasInfo.className = 'preview-info';
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;image-rendering:pixelated;max-width:100%;border:1px solid var(--border);margin-top:4px';
    el.appendChild(canvasInfo); el.appendChild(canvas);

    function parseEntries() {
      const forceBank = overrideChk.checked ? parseInt(bankSel.value) : null;
      const entries = [];
      let pc = 0;
      let curVramTile = 0, curBank = parseInt(bankSel.value), curBlockIdx = 0;
      while (pc + 5 <= bytes.length) {
        const count = bytes[pc];
        if (count === 0) break;
        const vlo = bytes[pc+1], vhi = bytes[pc+2];
        const slo = bytes[pc+3], shi = bytes[pc+4];
        pc += 5;

        if (vlo !== 0xFF || vhi !== 0xFF) {
          curVramTile = vlo | (vhi << 8);
        }
        if (slo !== 0xFF || shi !== 0xFF) {
          curBank     = (forceBank !== null) ? forceBank : (shi >> 1);
          curBlockIdx = ((shi & 1) << 8) | slo;
        } else if (forceBank !== null) {
          curBank = forceBank;
        }
        const vramByteAddr = curVramTile * 32;
        const romSrcOffset = curBank * 0x4000 + curBlockIdx * 32;

        entries.push({ count, vramTile: curVramTile, vramAddr: vramByteAddr, bank: curBank, romSrc: romSrcOffset });

        curVramTile += count;
        curBlockIdx += count;
      }
      return entries;
    }

    function renderCanvas(entries, palColors, highlightIdx) {
      if (!romData || entries.length === 0) return;
      const TILES_PER_ROW = 32;
      const zoom = 2;
      let maxTile = 0;
      entries.forEach(e => { maxTile = Math.max(maxTile, e.vramTile + e.count); });
      const rows = Math.ceil(maxTile / TILES_PER_ROW);
      canvas.width  = TILES_PER_ROW * 8 * zoom;
      canvas.height = rows * 8 * zoom;
      canvas.style.display = 'block';
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#111'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      const img = ctx.createImageData(canvas.width, canvas.height);
      const pxd = img.data;

      entries.forEach((e, ei) => {
        const isHL = (highlightIdx === -1 || highlightIdx === ei);
        for (let t = 0; t < e.count; t++) {
          const vramTile = e.vramTile + t;
          const romOff = e.romSrc + t * 32;
          if (romOff + 32 > romData.length) continue;
          const pixels = decodeTile(romData, romOff);
          const bx = (vramTile % TILES_PER_ROW) * 8 * zoom;
          const by = Math.floor(vramTile / TILES_PER_ROW) * 8 * zoom;
          for (let py = 0; py < 8; py++) for (let px = 0; px < 8; px++) {
            const ci = pixels[py * 8 + px];
            let r = 0x22, g = 0x22, bv = 0x22;
            if (isHL) {
              const hex = palColors[ci] || viewerPalette[ci] || '#222222';
              r = parseInt(hex.slice(1,3),16); g = parseInt(hex.slice(3,5),16); bv = parseInt(hex.slice(5,7),16);
            } else {
              const hex = palColors[ci] || viewerPalette[ci] || '#222222';
              r = parseInt(hex.slice(1,3),16) >> 2; g = parseInt(hex.slice(3,5),16) >> 2; bv = parseInt(hex.slice(5,7),16) >> 2;
            }
            for (let zy = 0; zy < zoom; zy++) for (let zx = 0; zx < zoom; zx++) {
              const idx = ((by + py*zoom + zy) * canvas.width + (bx + px*zoom + zx)) * 4;
              pxd[idx] = r; pxd[idx+1] = g; pxd[idx+2] = bv; pxd[idx+3] = 255;
            }
          }
        }
      });
      ctx.putImageData(img, 0, 0);

      if (highlightIdx >= 0 && highlightIdx < entries.length) {
        const e = entries[highlightIdx];
        ctx.strokeStyle = '#d4a0ff';
        ctx.lineWidth = 1;
        const x0 = (e.vramTile % TILES_PER_ROW) * 8 * zoom;
        const y0 = Math.floor(e.vramTile / TILES_PER_ROW) * 8 * zoom;
        ctx.strokeRect(x0, y0, 8 * zoom, 8 * zoom);
      }
    }

    function render() {
      if (!romData) { canvasInfo.textContent = '⚠ No ROM loaded'; return; }
      const palId = palSel.value;
      const palReg = palId ? mapData.regions.find(r => r.id === palId) : null;
      const palColors = palReg
        ? (palReg.type === 'palette_manual' ? resolvePaletteManualColors(palReg) : decodePaletteAt(romData, parseHex(palReg.offset) ?? 0, 16))
        : viewerPalette;

      const entries = parseEntries();
      tbody.innerHTML = '';
      let totalTiles = 0;
      let maxVramTile = 0;

      entries.forEach((e, i) => {
        totalTiles += e.count;
        maxVramTile = Math.max(maxVramTile, e.vramTile + e.count - 1);
        const tr = document.createElement('tr');
        tr.style.cssText = `border-bottom:1px solid var(--border);cursor:pointer;`;
        tr.innerHTML = `
          <td style="padding:2px 6px;color:var(--dim)">${i+1}</td>
          <td style="padding:2px 6px;text-align:right">${e.count}</td>
          <td style="padding:2px 6px;text-align:right;font-family:var(--mono)">$${e.vramTile.toString(16).toUpperCase().padStart(3,'0')}</td>
          <td style="padding:2px 6px;text-align:right;font-family:var(--mono)">$${e.vramAddr.toString(16).toUpperCase().padStart(4,'0')}</td>
          <td style="padding:2px 6px;text-align:right;font-family:var(--mono)">BK${e.bank} · $${e.romSrc.toString(16).toUpperCase().padStart(5,'0')}</td>
          <td style="padding:2px 6px;text-align:right;color:var(--dim)">—</td>`;
        tr.addEventListener('mouseenter', () => { tr.style.background = 'var(--hover)'; renderCanvas(entries, palColors, i); });
        tr.addEventListener('mouseleave', () => { tr.style.background = ''; renderCanvas(entries, palColors, -1); });
        tr.addEventListener('click', () => renderCanvas(entries, palColors, i));
        tbody.appendChild(tr);
      });

      canvasInfo.textContent = `${entries.length} entries · ${totalTiles} tiles total · VRAM $${(maxVramTile*32).toString(16).toUpperCase().padStart(4,'0')} max`;
      renderCanvas(entries, palColors, -1);
    }

    palSel.addEventListener('change', () => { persistParams(); render(); });
    bankSel.addEventListener('change', () => { persistParams(); render(); });
    overrideChk.addEventListener('change', () => { persistParams(); render(); });
    render();
    return;
  }

  if (type === 'data_table' || type === 'data_array') {
    const region = _labId ? mapData.regions.find(r => r.id === _labId) : null;

    let schema = (region && region.schema) ? JSON.parse(JSON.stringify(region.schema))
      : { fields: [{name:'Field 1', bytes:1}, {name:'Field 2', bytes:1}], rowNotes:[] };
    if (!schema.rowNotes) schema.rowNotes = [];

    const title = document.createElement('div');
    title.className = 'lab-section-title';
    el.appendChild(title);

    const schemaSection = document.createElement('div');
    schemaSection.style.cssText = 'margin-bottom:10px;';
    const schemaHdr = document.createElement('div');
    schemaHdr.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;';
    const schemaLbl = document.createElement('span');
    schemaLbl.style.cssText = 'font-size:10px;color:var(--dim);letter-spacing:1px';
    schemaLbl.textContent = 'SCHEMA';
    const addFieldBtn = document.createElement('button');
    addFieldBtn.className = 'btn small';
    addFieldBtn.textContent = '+ FIELD';
    const saveSchemaBtn = document.createElement('button');
    saveSchemaBtn.className = 'btn small success';
    saveSchemaBtn.textContent = 'SAVE SCHEMA';
    schemaHdr.appendChild(schemaLbl);
    schemaHdr.appendChild(addFieldBtn);
    schemaHdr.appendChild(saveSchemaBtn);
    schemaSection.appendChild(schemaHdr);

    const fieldsWrap = document.createElement('div');
    fieldsWrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
    schemaSection.appendChild(fieldsWrap);
    el.appendChild(schemaSection);

    const tableWrap = document.createElement('div');
    tableWrap.style.cssText = 'overflow-x:auto;';
    el.appendChild(tableWrap);

    function renderFieldRows() {
      fieldsWrap.innerHTML = '';
      schema.fields.forEach((f, idx) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:4px;align-items:center;';

        const nameIn = document.createElement('input');
        nameIn.type = 'text'; nameIn.value = f.name; nameIn.placeholder = 'Name';
        nameIn.style.cssText = 'flex:2;font-family:var(--mono);font-size:11px;padding:2px 4px;background:var(--bg2);border:1px solid var(--border2);color:var(--text);min-width:60px;';
        nameIn.addEventListener('input', () => { schema.fields[idx].name = nameIn.value; renderPreview(); });

        const bytesIn = document.createElement('input');
        bytesIn.type = 'number'; bytesIn.value = f.bytes; bytesIn.min = 1; bytesIn.max = 16;
        bytesIn.title = 'Size in bytes';
        bytesIn.style.cssText = 'width:44px;font-family:var(--mono);font-size:11px;padding:2px 4px;background:var(--bg2);border:1px solid var(--border2);color:var(--yellow);text-align:center;';
        bytesIn.addEventListener('input', () => { schema.fields[idx].bytes = Math.max(1, parseInt(bytesIn.value)||1); renderPreview(); });

        const bytesLbl = document.createElement('span');
        bytesLbl.style.cssText = 'font-size:10px;color:var(--dim);white-space:nowrap';
        bytesLbl.textContent = 'B';

        const delBtn = document.createElement('button');
        delBtn.className = 'btn small danger'; delBtn.textContent = '×';
        delBtn.addEventListener('click', () => {
          schema.fields.splice(idx, 1);
          if (!schema.fields.length) schema.fields.push({name:'Field 1', bytes:1});
          renderFieldRows(); renderPreview();
        });

        row.appendChild(nameIn); row.appendChild(bytesIn); row.appendChild(bytesLbl);
        row.appendChild(delBtn);
        fieldsWrap.appendChild(row);
      });
    }

    function renderPreview() {
      const stride = schema.fields.reduce((s, f) => s + (f.bytes||1), 0);
      const numRows = stride > 0 ? Math.floor(bytes.length / stride) : 0;
      const leftover = stride > 0 ? bytes.length % stride : 0;
      title.textContent = `DATA TABLE — ${bytes.length} bytes · ${numRows} rows × ${stride} bytes/row${leftover?' · '+leftover+' leftover':''}`;

      const fieldColors = ['var(--yellow)','var(--accent2)','var(--accent)','#a855f7','#ff6b35','#00ff88','#ff35a0'];

      let html = `<table style="border-collapse:collapse;font-family:var(--mono);font-size:11px;width:100%">
        <thead><tr style="color:var(--dim);border-bottom:1px solid var(--border2)">
          <th style="text-align:left;padding:2px 8px 2px 0;font-size:10px">OFFSET</th>`;
      schema.fields.forEach((f, fi) => {
        const col = fieldColors[fi % fieldColors.length];
        const bLabel = f.bytes > 1 ? ` (${f.bytes}B)` : '';
        html += `<th style="padding:2px 6px;color:${col};white-space:nowrap">${f.name||'?'}${bLabel}</th>`;
      });
      html += `<th style="padding:2px 6px;color:var(--dim);white-space:nowrap;text-align:left">NOTES</th>`;
      html += `</tr></thead><tbody>`;

      for (let ri = 0; ri < numRows; ri++) {
        const rowOff = ri * stride;
        const offHex = '0x'+(baseOffset+rowOff).toString(16).toUpperCase().padStart(5,'0');
        html += `<tr style="border-bottom:1px solid #1a1a2e">
          <td style="padding:2px 8px 2px 0;color:var(--dim);white-space:nowrap;font-size:10px">${offHex}</td>`;
        let byteOff = rowOff;
        schema.fields.forEach((f, fi) => {
          const col = fieldColors[fi % fieldColors.length];
          const nb = f.bytes || 1;
          let val = 0;
          for (let b = 0; b < nb && byteOff+b < bytes.length; b++) val |= (bytes[byteOff+b] << (b*8));
          byteOff += nb;
          const hexVal = val.toString(16).toUpperCase().padStart(nb*2, '0');
          html += `<td style="padding:2px 6px;color:${col};text-align:center">$${hexVal}</td>`;
        });
        const noteVal = (schema.rowNotes[ri]||'').replace(/"/g,'&quot;');
        html += `<td style="padding:2px 4px"><input class="dt-rn" data-ri="${ri}" type="text" value="${noteVal}" placeholder="…" style="width:100%;min-width:100px;font-family:var(--mono);font-size:11px;padding:2px 4px;background:transparent;border:none;border-bottom:1px solid var(--border2);color:var(--dim);outline:none;"></td>`;
        html += `</tr>`;
      }
      html += `</tbody></table>`;
      if (leftover) html += `<div style="font-size:10px;color:var(--dim);margin-top:4px">+${leftover} leftover bytes not fitting a full row</div>`;
      tableWrap.innerHTML = html;
      tableWrap.querySelectorAll('input.dt-rn').forEach(inp => {
        inp.addEventListener('input', () => {
          schema.rowNotes[parseInt(inp.dataset.ri)] = inp.value;
        });
      });
    }

    addFieldBtn.addEventListener('click', () => {
      schema.fields.push({name:`Field ${schema.fields.length+1}`, bytes:1});
      renderFieldRows(); renderPreview();
    });

    saveSchemaBtn.addEventListener('click', () => {
      if (!region) { showToast('No active region', true); return; }
      region.schema = JSON.parse(JSON.stringify(schema));
      triggerAutoSave();
      showToast('Schema saved');
    });

    renderFieldRows();
    renderPreview();
    return;
  }

  if (type === 'text') {
    const title = document.createElement('div');
    title.className = 'lab-section-title';
    title.textContent = 'TEXT DECODE';
    el.appendChild(title);

    const printable = Array.from(bytes).filter(b => b >= 0x20 && b < 0x7F).length;
    const pct = bytes.length ? Math.round(printable / bytes.length * 100) : 0;
    const quality = pct > 70 ? `<span style="color:var(--green)">${pct}% printable ASCII ✓</span>` :
                    pct > 30 ? `<span style="color:var(--yellow)">${pct}% printable ASCII — mixed</span>` :
                               `<span style="color:var(--red)">${pct}% printable — likely not text</span>`;

    const chars = Array.from(bytes).map(b => {
      if (b >= 0x20 && b < 0x7F) {
        const ch = String.fromCharCode(b).replace(/&/g,'&amp;').replace(/</g,'&lt;');
        return `<span class="txt-print">${ch}</span>`;
      }
      if (b === 0x00) return `<span class="txt-null">·</span>`;
      if (b === 0x0A) return `<span class="txt-ctrl">↵\n</span>`;
      if (b === 0x0D) return '';
      return `<span class="txt-ctrl">[${b.toString(16).toUpperCase().padStart(2,'0')}]</span>`;
    }).join('');

    const box = document.createElement('div');
    box.className = 'type-preview-box';
    box.style.whiteSpace = 'pre-wrap';
    box.style.wordBreak = 'break-all';
    box.innerHTML = `<div class="preview-info">${quality}</div>${chars}`;
    el.innerHTML = '';
    el.appendChild(title);
    el.appendChild(box);
    return;
  }

  if (type === 'palette_manual') {
    const r = mapData.regions.find(x => x.id === _labId);
    if (!r) return;
    if (!r.slots) r.slots = Array(16).fill('');

    const title = document.createElement('div');
    title.className = 'lab-section-title';
    title.textContent = 'PALETTE (CUSTOM) — SLOT EDITOR';
    el.appendChild(title);

    const info = document.createElement('div');
    info.className = 'preview-info';
    info.textContent = 'Assign a ROM offset to each color slot. The byte at that offset is decoded as SMS color (00BBGGRR).';
    el.appendChild(info);

    const grid = document.createElement('div');
    grid.className = 'pal-slots-grid';

    const inputs = [];

    function resolveColor(slotIdx) {
      const hexOff = r.slots[slotIdx];
      if (!hexOff || !romData) return '#111122';
      const off = parseHex(hexOff);
      if (off == null || off >= romData.length) return '#331100';
      return smsColorToHex(romData[off]);
    }

    for (let i = 0; i < 16; i++) {
      const row = document.createElement('div');
      row.className = 'pal-slot-row';

      const num = document.createElement('span');
      num.className = 'pal-slot-num';
      num.textContent = i.toString(16).toUpperCase();

      const swatch = document.createElement('div');
      swatch.className = 'pal-slot-swatch';
      swatch.style.background = resolveColor(i);

      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'pal-slot-input' + (r.slots[i] ? ' has-val' : '');
      inp.placeholder = 'offset…';
      inp.value = r.slots[i] || '';
      inp.spellcheck = false;

      inp.addEventListener('input', () => {
        const v = inp.value.trim();
        r.slots[i] = v;
        inp.classList.toggle('has-val', !!v);
        swatch.style.background = resolveColor(i);
      });

      inputs.push(inp);
      row.appendChild(num);
      row.appendChild(swatch);
      row.appendChild(inp);
      grid.appendChild(row);
    }

    el.appendChild(grid);

    const applyBtn = document.createElement('button');
    applyBtn.className = 'btn small primary';
    applyBtn.style.marginTop = '10px';
    applyBtn.textContent = 'APPLY TO VIEWER';
    applyBtn.addEventListener('click', () => {
      viewerPalette = Array.from({length:16}, (_,i) => resolveColor(i));
      buildPaletteUI(); doRender();
      showToast(`Custom palette "${r.name||r.offset}" applied`);
    });
    el.appendChild(applyBtn);
    return;
  }

  if (type === 'meta_sprite') {
    const r = mapData.regions.find(x => x.id === _labId);
    if (!r) return;

    if (!r.msFormat)        r.msFormat    = 'dy_dx_tile';
    if (!r.msMode)          r.msMode      = '8x16';
    if (!r.msTermX)         r.msTermX     = '0x80';
    if (r.msTileReg  === undefined) r.msTileReg  = '';
    if (r.msPalReg   === undefined) r.msPalReg   = '';
    if (r.msTileBase === undefined) r.msTileBase = '0';

    const title = document.createElement('div');
    title.className = 'lab-section-title';
    title.textContent = 'METASPRITE VIEWER';
    el.appendChild(title);

    const ctrl = document.createElement('div');
    ctrl.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin-bottom:10px;font-size:11px';

    const fmtLabel = document.createElement('div');
    fmtLabel.style.cssText = 'display:flex;flex-direction:column;gap:3px';
    fmtLabel.innerHTML = '<span style="font-size:9px;color:var(--dim);letter-spacing:1px">ENTRY FORMAT</span>';
    const fmtSel = document.createElement('select');
    fmtSel.style.cssText = 'background:var(--bg3);border:1px solid var(--border2);color:var(--text);font-family:var(--mono);font-size:11px;padding:3px 6px';
    [['dy_dx_tile','dy, dx, tile (3B)'],['dx_dy_tile','dx, dy, tile (3B)'],
     ['tile_dx_dy','tile, dx, dy (3B)'],['tile_attr_x_y','tile, attr, x, y (4B - SAT)']
    ].forEach(([v,l]) => { const o = document.createElement('option'); o.value=v; o.textContent=l; if(v===r.msFormat)o.selected=true; fmtSel.appendChild(o); });
    fmtLabel.appendChild(fmtSel);
    ctrl.appendChild(fmtLabel);

    const sizeLabel = document.createElement('div');
    sizeLabel.style.cssText = 'display:flex;flex-direction:column;gap:3px';
    sizeLabel.innerHTML = '<span style="font-size:9px;color:var(--dim);letter-spacing:1px">SPRITE SIZE</span>';
    const sizeSel = document.createElement('select');
    sizeSel.style.cssText = fmtSel.style.cssText;
    [['8x8','8×8'],['8x16','8×16']].forEach(([v,l]) => {
      const o = document.createElement('option'); o.value=v; o.textContent=l; if(v===r.msMode)o.selected=true; sizeSel.appendChild(o);
    });
    sizeLabel.appendChild(sizeSel);
    ctrl.appendChild(sizeLabel);

    const termLabel = document.createElement('div');
    termLabel.style.cssText = 'display:flex;flex-direction:column;gap:3px';
    termLabel.innerHTML = '<span style="font-size:9px;color:var(--dim);letter-spacing:1px">TERMINATOR (dx)</span>';
    const termInp = document.createElement('input');
    termInp.type='text'; termInp.value=r.msTermX; termInp.style.cssText='width:65px;'+fmtSel.style.cssText;
    termLabel.appendChild(termInp);
    ctrl.appendChild(termLabel);

    const tbaseLabel = document.createElement('div');
    tbaseLabel.style.cssText = 'display:flex;flex-direction:column;gap:3px';
    tbaseLabel.innerHTML = '<span style="font-size:9px;color:var(--dim);letter-spacing:1px">TILE BASE (index)</span>';
    const tbaseRow = document.createElement('div');
    tbaseRow.style.cssText = 'display:flex;gap:3px;align-items:center';
    const tbaseDec = document.createElement('button');
    tbaseDec.textContent = '−'; tbaseDec.className = 'btn small';
    tbaseDec.style.cssText = 'padding:2px 7px;font-size:13px;line-height:1';
    const tbaseInp = document.createElement('input');
    tbaseInp.type='text'; tbaseInp.value=r.msTileBase;
    tbaseInp.style.cssText='width:58px;'+fmtSel.style.cssText;
    tbaseInp.title='Tile index offset: shifts all tile lookups by this amount';
    const tbaseInc = document.createElement('button');
    tbaseInc.textContent = '+'; tbaseInc.className = 'btn small';
    tbaseInc.style.cssText = 'padding:2px 7px;font-size:13px;line-height:1';
    tbaseDec.addEventListener('click', () => { const v = parseInt(tbaseInp.value) || 0; tbaseInp.value = v - 1; renderMs(); });
    tbaseInc.addEventListener('click', () => { const v = parseInt(tbaseInp.value) || 0; tbaseInp.value = v + 1; renderMs(); });
    tbaseRow.appendChild(tbaseDec); tbaseRow.appendChild(tbaseInp); tbaseRow.appendChild(tbaseInc);
    tbaseLabel.appendChild(tbaseRow);
    ctrl.appendChild(tbaseLabel);

    const tileLabel = document.createElement('div');
    tileLabel.style.cssText = 'display:flex;flex-direction:column;gap:3px';
    tileLabel.innerHTML = '<span style="font-size:9px;color:var(--dim);letter-spacing:1px">TILE REGION</span>';
    const tileSel = document.createElement('select');
    tileSel.style.cssText = 'min-width:140px;'+fmtSel.style.cssText;
    tileSel.innerHTML = '<option value="">— none —</option>';
    mapData.regions.filter(x=>x.type==='gfx_tiles'||x.type==='gfx_sprites').forEach(x=>{
      tileSel.innerHTML += `<option value="${x.id}"${x.id===r.msTileReg?' selected':''}>${x.name||x.offset}</option>`;
    });
    tileLabel.appendChild(tileSel);
    ctrl.appendChild(tileLabel);

    const palLabel = document.createElement('div');
    palLabel.style.cssText = 'display:flex;flex-direction:column;gap:3px';
    palLabel.innerHTML = '<span style="font-size:9px;color:var(--dim);letter-spacing:1px">PALETTE</span>';
    const palSel = document.createElement('select');
    palSel.style.cssText = 'min-width:140px;'+fmtSel.style.cssText;
    palSel.innerHTML = '<option value="">Viewer palette</option>';
    mapData.regions.filter(x=>x.type==='palette'||x.type==='palette_manual').forEach(x=>{
      palSel.innerHTML += `<option value="${x.id}"${x.id===r.msPalReg?' selected':''}>${x.name||x.offset}</option>`;
    });
    palLabel.appendChild(palSel);
    ctrl.appendChild(palLabel);

    el.appendChild(ctrl);

    const layout = document.createElement('div');
    layout.style.cssText = 'display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap';

    const canvasWrap = document.createElement('div');
    canvasWrap.style.cssText = 'background:#000;border:1px solid var(--border);flex-shrink:0';
    const msCanvas = document.createElement('canvas');
    msCanvas.style.cssText = 'display:block;image-rendering:pixelated';
    canvasWrap.appendChild(msCanvas);
    layout.appendChild(canvasWrap);

    const entryTable = document.createElement('div');
    entryTable.style.cssText = 'font-size:10px;color:var(--dim);overflow-y:auto;max-height:260px';
    layout.appendChild(entryTable);
    el.appendChild(layout);

    function parseMsEntries() {
      const fmt   = fmtSel.value;
      const term  = parseHex(termInp.value) ?? 0x80;
      const step  = fmt === 'tile_attr_x_y' ? 4 : 3;
      const entries = [];
      for (let i = 0; i + step - 1 < bytes.length; i += step) {
        let dy, dx, tile;
        if (fmt === 'dy_dx_tile')    { dy=bytes[i]; dx=bytes[i+1]; tile=bytes[i+2]; }
        else if(fmt === 'dx_dy_tile'){ dx=bytes[i]; dy=bytes[i+1]; tile=bytes[i+2]; }
        else if(fmt === 'tile_dx_dy'){ tile=bytes[i]; dx=bytes[i+1]; dy=bytes[i+2]; }
        else                         { tile=bytes[i]; dx=bytes[i+1]; dy=bytes[i+2]; }
        if (dx === term) break;
        if (dy > 127) dy -= 256;
        if (dx > 127) dx -= 256;
        entries.push({dy, dx, tile});
      }
      return entries;
    }

    function renderMs() {
      r.msFormat    = fmtSel.value;
      r.msMode      = sizeSel.value;
      r.msTermX     = termInp.value;
      r.msTileBase  = tbaseInp.value;
      r.msTileReg   = tileSel.value;
      r.msPalReg    = palSel.value;

      const tileBase = parseInt(tbaseInp.value) || (parseHex(tbaseInp.value) ?? 0);

      const entries = parseMsEntries();
      const is16 = sizeSel.value === '8x16';
      const sprH = is16 ? 16 : 8;
      const zoom = 4;

      const tId = tileSel.value;
      const tReg = tId ? mapData.regions.find(x=>x.id===tId) : null;
      const tBytes = (tReg && romData) ? romData.subarray(parseHex(tReg.offset)??0, (parseHex(tReg.offset)??0)+(tReg.size??0)) : null;

      const pId = palSel.value;
      let pal = viewerPalette;
      if (pId) {
        const pReg = mapData.regions.find(x=>x.id===pId);
        if (pReg) pal = pReg.type==='palette_manual' ? resolvePaletteManualColors(pReg)
                                                      : decodePaletteAt(romData, parseHex(pReg.offset)??0, 16);
      }

      if (!entries.length) {
        msCanvas.width = 64; msCanvas.height = 64;
        const ctx = msCanvas.getContext('2d');
        ctx.fillStyle='#111'; ctx.fillRect(0,0,64,64);
        ctx.fillStyle='#555'; ctx.font='10px Courier New'; ctx.fillText('no entries',4,30);
        entryTable.innerHTML = '<span style="color:var(--red)">No entries parsed. Check format / terminator.</span>';
        return;
      }

      const xs = entries.map(e=>e.dx), ys = entries.map(e=>e.dy);
      const minX = Math.min(...xs), maxX = Math.max(...xs) + 8;
      const minY = Math.min(...ys), maxY = Math.max(...ys) + sprH;
      const W = (maxX - minX) * zoom, H = (maxY - minY) * zoom;
      msCanvas.width  = Math.max(W, 8); msCanvas.height = Math.max(H, 8);
      const ctx = msCanvas.getContext('2d');
      ctx.fillStyle = '#000'; ctx.fillRect(0,0,msCanvas.width,msCanvas.height);

      entries.forEach(({dy, dx, tile}) => {
        const bx = (dx - minX) * zoom, by = (dy - minY) * zoom;
        const tileTop = is16 ? ((tile + tileBase) & ~1) : (tile + tileBase);
        const tilesToDraw = is16 ? [tileTop, tileTop+1] : [tileTop];
        tilesToDraw.forEach((t, row) => {
          if (!tBytes) {
            ctx.strokeStyle='#333'; ctx.strokeRect(bx, by+row*8*zoom, 8*zoom, 8*zoom);
            return;
          }
          const off = t * 32;
          if (off + 32 > tBytes.length) return;
          const pixels = decodeTile(tBytes, off);
          for (let py=0; py<8; py++) for (let px=0; px<8; px++) {
            const ci = pixels[py*8+px];
            if (ci === 0) continue;
            ctx.fillStyle = pal[ci] || '#000';
            ctx.fillRect(bx+px*zoom, by+(row*8+py)*zoom, zoom, zoom);
          }
        });
        ctx.strokeStyle='rgba(0,212,255,.3)'; ctx.lineWidth=1;
        ctx.strokeRect(bx+.5, by+.5, 8*zoom-1, sprH*zoom-1);
      });

      const step = fmtSel.value==='tile_attr_x_y'?4:3;
      let html = `<table style="border-collapse:collapse;font-size:10px">
        <tr style="color:var(--accent)"><th style="padding:2px 6px">#</th><th>dy</th><th>dx</th><th>tile (raw)</th>${tileBase?'<th>tile (+base)</th>':''}<th>hex</th></tr>`;
      entries.forEach(({dy,dx,tile},i)=>{
        const raw = Array.from(bytes.subarray(i*step, i*step+step))
                      .map(b=>b.toString(16).toUpperCase().padStart(2,'0')).join(' ');
        const resolved = tile + tileBase;
        html += `<tr style="border-bottom:1px solid var(--border)">
          <td style="padding:1px 6px;color:var(--dim)">${i}</td>
          <td style="padding:1px 6px;color:var(--green)">${dy>=0?'+':''}${dy}</td>
          <td style="padding:1px 6px;color:var(--green)">${dx>=0?'+':''}${dx}</td>
          <td style="padding:1px 6px;color:var(--yellow)">0x${tile.toString(16).toUpperCase().padStart(2,'0')}</td>
          ${tileBase?`<td style="padding:1px 6px;color:var(--accent)">0x${resolved.toString(16).toUpperCase().padStart(2,'0')}</td>`:''}
          <td style="padding:1px 6px;color:var(--dim)">${raw}</td>
        </tr>`;
      });
      html += '</table>';
      entryTable.innerHTML = html;
    }

    fmtSel.addEventListener('change', renderMs);
    sizeSel.addEventListener('change', renderMs);
    termInp.addEventListener('change', renderMs);
    tbaseInp.addEventListener('change', renderMs);
    tileSel.addEventListener('change', renderMs);
    palSel.addEventListener('change', renderMs);

    renderMs();
    return;
  }
}

function labShowSidePanels(type){
  const isTile = type==='gfx_tiles'||type==='gfx_sprites';
  const isPal  = type==='palette'||type==='palette_manual';
  document.getElementById('lab-tiles-section').style.display   = isTile ? '' : 'none';
  document.getElementById('lab-palette-section').style.display = isPal  ? '' : 'none';
}

function labRenderClassify(region){
  const wrap=document.getElementById('lab-type-btns');
  wrap.innerHTML='';
  for(const[type,meta]of Object.entries(TYPE_META)){
    const btn=document.createElement('button');
    btn.className='lab-type-btn'+(region.type===type?' selected':'');
    btn.style.cssText=`color:${meta.color};border-color:${meta.color}`;
    btn.textContent=meta.label;btn.dataset.type=type;
    btn.addEventListener('click',()=>{
      wrap.querySelectorAll('.lab-type-btn').forEach(b=>b.classList.remove('selected'));
      btn.classList.add('selected');
      if(type==='null') document.getElementById('lab-name').value='NULL BYTES';
      document.getElementById('btn-lab-to-viewer').style.display=
        (type==='gfx_tiles'||type==='gfx_sprites')?'':'none';
      labShowSidePanels(type);
      if(_labId){
        const r=mapData.regions.find(x=>x.id===_labId);
        if(r&&romData){
          const off=parseHex(r.offset)??0;
          labRenderTypePreview(type, romData.subarray(off,Math.min(off+(r.size??0),romData.length)), off);
        }
      }
    });
    wrap.appendChild(btn);
  }
  document.getElementById('lab-name').value=region.name||'';
  document.getElementById('lab-notes').value=region.notes||'';
}

// ── Lab event listeners ───────────────────────────────────────────────────────

document.getElementById('btn-lab-apply-pal').addEventListener('click',()=>{
  if(!_labCurrentPaletteColors.length){showToast('No palette data in this region',true);return;}
  viewerPalette=[..._labCurrentPaletteColors,...Array(16).fill('#000000')].slice(0,16);
  while(viewerPalette.length<16)viewerPalette.push('#000000');
  buildPaletteUI();
  const r=mapData.regions.find(x=>x.id===_labId);
  if(r&&romData){
    const off=parseHex(r.offset)??0;
    labRenderTiles(romData.subarray(off,Math.min(off+(r.size??0),romData.length)));
  }
  showToast('Palette applied to viewer + lab preview');
});

document.getElementById('btn-lab-save').addEventListener('click',()=>{
  const r=mapData.regions.find(x=>x.id===_labId);
  if(!r)return;
  const selType=document.querySelector('#lab-type-btns .lab-type-btn.selected')?.dataset.type;
  if(selType)r.type=selType;
  r.name=document.getElementById('lab-name').value.trim();
  r.notes=document.getElementById('lab-notes').value.trim();
  refreshMapUI();
  document.getElementById('panel-lab').classList.add('hidden');
  showToast(`"${r.name||r.offset}" saved as ${TYPE_META[r.type]?.label||r.type}`);
  _labId=null;
});

document.getElementById('btn-close-lab').addEventListener('click',()=>{
  document.getElementById('panel-lab').classList.add('hidden');
  document.querySelectorAll('#regions-tbody tr').forEach(tr=>tr.classList.remove('row-active'));
  _labId=null;
});

document.getElementById('btn-lab-prev').addEventListener('click',()=>{
  const idx=mapData.regions.findIndex(r=>r.id===_labId);
  if(idx>0)openLaboratory(mapData.regions[idx-1].id);
});

document.getElementById('btn-lab-next').addEventListener('click',()=>{
  const idx=mapData.regions.findIndex(r=>r.id===_labId);
  if(idx<mapData.regions.length-1)openLaboratory(mapData.regions[idx+1].id);
});

document.getElementById('btn-lab-to-table').addEventListener('click',()=>{
  document.getElementById('panel-map').scrollIntoView({behavior:'smooth'});
  const activeRow=document.querySelector('#regions-tbody tr.row-active');
  if(activeRow)setTimeout(()=>activeRow.scrollIntoView({block:'center',behavior:'smooth'}),350);
});

document.getElementById('btn-lab-add-merge').addEventListener('click',()=>{
  if(!_labId)return;
  const idx=_mergeList.indexOf(_labId);
  if(idx===-1) _mergeList.push(_labId);
  else         _mergeList.splice(idx,1);
  updateMergeUI();
});

document.getElementById('btn-lab-empty-merge').addEventListener('click',()=>{
  _mergeList=[];
  updateMergeUI();
});

document.getElementById('btn-lab-do-merge').addEventListener('click',()=>{
  if(_mergeList.length<2){showToast('Add at least 2 regions to merge',true);return;}
  const regions=_mergeList.map(id=>mapData.regions.find(r=>r.id===id)).filter(Boolean);
  if(regions.length<2){showToast('Some queued regions were not found',true);return;}

  const minOffset=Math.min(...regions.map(r=>parseHex(r.offset)??0));
  const maxEnd   =Math.max(...regions.map(r=>(parseHex(r.offset)??0)+(r.size??0)));
  const mergeIds =new Set(_mergeList);

  mapData.regions=mapData.regions.filter(r=>!mergeIds.has(r.id));

  const merged={
    id:genId(),
    offset:hexStr(minOffset),
    size:maxEnd-minOffset,
    type:'unknown',
    name:'',
    notes:`Merged: ${regions.map(r=>r.name||r.offset).join(', ')}`,
  };
  mapData.regions.push(merged);
  mapData.regions.sort((a,b)=>(parseHex(a.offset)??0)-(parseHex(b.offset)??0));

  _mergeList=[];
  refreshMapUI();
  openLaboratory(merged.id);
  showToast(`${regions.length} regions merged → ${merged.size.toLocaleString()} bytes`);
});

document.getElementById('btn-lab-delete').addEventListener('click',()=>{
  const r=mapData.regions.find(x=>x.id===_labId);
  if(!r)return;
  const label=r.name||r.offset;
  if(!confirm(`Delete region "${label}"?\n\nThis cannot be undone.`))return;
  mapData.regions=mapData.regions.filter(x=>x.id!==_labId);
  document.getElementById('panel-lab').classList.add('hidden');
  _labId=null;
  refreshMapUI();
  showToast(`Region "${label}" deleted`);
});

document.getElementById('btn-lab-to-viewer').addEventListener('click',()=>{
  const r=mapData.regions.find(x=>x.id===_labId);
  if(!r)return;
  document.getElementById('ctrl-offset').value=r.offset;
  document.getElementById('ctrl-count').value=Math.min(512,Math.floor((r.size??0)/32))||256;
  doRender();renderBanksGrid();
  document.getElementById('panel-viewer').scrollIntoView({behavior:'smooth'});
});
