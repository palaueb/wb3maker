// ═══════════════════════════════════════════════════════
//  VIEWER PALETTE SELECTOR
// ═══════════════════════════════════════════════════════
function refreshViewerPalSelect(){
  const sel=document.getElementById('viewer-pal-select');
  if(!sel)return;
  const prev=sel.value;
  // Keep first option (manual)
  while(sel.options.length>1)sel.remove(1);
  const pals=mapData.regions.filter(r=>r.type==='palette'||r.type==='palette_manual');
  for(const r of pals){
    const opt=document.createElement('option');
    opt.value=r.id;
    opt.textContent=(r.name||r.offset)+(r.type==='palette_manual'?' [custom]':'');
    sel.appendChild(opt);
  }
  // Restore selection if still valid
  if(prev&&[...sel.options].some(o=>o.value===prev))sel.value=prev;
}
document.getElementById('viewer-pal-select').addEventListener('change',function(){
  const id=this.value;
  if(!id)return; // manual — do nothing, user edits swatches directly
  const r=mapData.regions.find(x=>x.id===id);
  if(!r||!romData)return;
  let colors;
  if(r.type==='palette_manual'){
    colors=resolvePaletteManualColors(r);
  } else {
    colors=decodePaletteAt(romData,parseHex(r.offset)??0,16);
  }
  viewerPalette=[...colors,...Array(16).fill('#000000')].slice(0,16);
  while(viewerPalette.length<16)viewerPalette.push('#000000');
  buildPaletteUI();doRender();
  showToast(`Palette "${r.name||r.offset}" applied`);
});


// ═══════════════════════════════════════════════════════
//  TILE VIEWER
// ═══════════════════════════════════════════════════════
function buildPaletteUI(){
  const wrap=document.getElementById('palette-swatches');wrap.innerHTML='';
  for(let i=0;i<16;i++){
    const div=document.createElement('div');div.className='pal-swatch';div.style.background=viewerPalette[i];
    const inp=document.createElement('input');inp.type='color';inp.value=viewerPalette[i];
    inp.addEventListener('input',()=>{viewerPalette[i]=inp.value;div.style.background=inp.value;if(romData)doRender();});
    div.appendChild(inp);wrap.appendChild(div);
  }
}
document.getElementById('btn-pal-reset').addEventListener('click',()=>{viewerPalette=[...DEFAULT_PALETTE];buildPaletteUI();if(romData)doRender();});
document.getElementById('btn-pal-gray').addEventListener('click',()=>{
  for(let i=0;i<16;i++){const v=Math.round(i*17).toString(16).padStart(2,'0');viewerPalette[i]=`#${v}${v}${v}`;}
  buildPaletteUI();if(romData)doRender();
});

function updateRotDisplay(){
  document.getElementById('pal-rot-display').textContent=
    paletteRotation===0?'+0':(paletteRotation>0?`+${paletteRotation}`:`${paletteRotation}`);
}
document.getElementById('btn-pal-rot-left').addEventListener('click',()=>{
  paletteRotation=(paletteRotation+15)%16; updateRotDisplay(); if(romData)doRender();
});
document.getElementById('btn-pal-rot-right').addEventListener('click',()=>{
  paletteRotation=(paletteRotation+1)%16; updateRotDisplay(); if(romData)doRender();
});
document.getElementById('btn-pal-rot-reset').addEventListener('click',()=>{
  paletteRotation=0; updateRotDisplay(); if(romData)doRender();
});

function renderTiles(ctx,rom,startOffset,count,perRow,zoom){
  const tw=8*zoom,th=8*zoom,rows=Math.ceil(count/perRow),W=perRow*tw,H=rows*th;
  ctx.canvas.width=W;ctx.canvas.height=H;
  ctx.fillStyle='#000';ctx.fillRect(0,0,W,H);
  const img=ctx.createImageData(W,H),px=img.data;
  const pR=new Uint8Array(16),pG=new Uint8Array(16),pB=new Uint8Array(16);
  for(let i=0;i<16;i++){const c=viewerPalette[(i+paletteRotation)%16]||'#000';pR[i]=parseInt(c.slice(1,3),16);pG[i]=parseInt(c.slice(3,5),16);pB[i]=parseInt(c.slice(5,7),16);}
  let rendered=0;
  for(let t=0;t<count;t++){
    const ro=startOffset+t*32;if(ro+32>rom.length)break;
    const tile=decodeTile(rom,ro);if(!tile)break;
    const tc=t%perRow,tr=Math.floor(t/perRow),bx=tc*tw,by=tr*th;
    for(let py=0;py<8;py++)for(let px_=0;px_<8;px_++){
      const ci=tile[py*8+px_],r=pR[ci],g=pG[ci],b=pB[ci];
      for(let zy=0;zy<zoom;zy++)for(let zx=0;zx<zoom;zx++){
        const idx=((by+py*zoom+zy)*W+(bx+px_*zoom+zx))*4;
        px[idx]=r;px[idx+1]=g;px[idx+2]=b;px[idx+3]=255;
      }
    }
    rendered++;
  }
  ctx.putImageData(img,0,0);
  ctx.strokeStyle='rgba(255,255,255,.05)';ctx.lineWidth=1;
  for(let r=0;r<=rows;r++){ctx.beginPath();ctx.moveTo(0,r*th);ctx.lineTo(W,r*th);ctx.stroke();}
  for(let c=0;c<=perRow;c++){ctx.beginPath();ctx.moveTo(c*tw,0);ctx.lineTo(c*tw,H);ctx.stroke();}
  return rendered;
}

function doRender(){
  if(!romData)return;
  const rawOff=document.getElementById('ctrl-offset').value;
  const offset=parseHex(rawOff)??parseInt(rawOff,10);
  if(isNaN(offset)||offset<0){showToast('Invalid offset',true);return;}
  const count=Math.max(1,Math.min(4096,parseInt(document.getElementById('ctrl-count').value)||256));
  const perRow=Math.max(1,Math.min(64,parseInt(document.getElementById('ctrl-perrow').value)||16));
  const zoom=parseInt(document.getElementById('ctrl-zoom').value)||3;
  const rendered=renderTiles(document.getElementById('tile-canvas').getContext('2d'),romData,offset,count,perRow,zoom);
  const end=offset+rendered*32;
  const bank=bankOf(offset);
  document.getElementById('status-range').textContent=`${rendered} tiles  |  ${hexStr(offset)}–${hexStr(end)}`;
  document.getElementById('status-bank').innerHTML=`<span class="bank-indicator">BANK ${bank}</span>`;
  renderBanksGrid();
}

document.getElementById('tile-canvas').addEventListener('mousemove',(e)=>{
  if(!romData)return;
  const rect=e.currentTarget.getBoundingClientRect();
  const zoom=parseInt(document.getElementById('ctrl-zoom').value)||3;
  const perRow=Math.max(1,parseInt(document.getElementById('ctrl-perrow').value)||16);
  const tileX=Math.floor((e.clientX-rect.left)/(8*zoom));
  const tileY=Math.floor((e.clientY-rect.top)/(8*zoom));
  const off=parseHex(document.getElementById('ctrl-offset').value)??0;
  const idx=tileY*perRow+tileX;
  const romOff=off+idx*32;
  const region=mapData.regions.find(r=>{const s=parseHex(r.offset)??0;return romOff>=s&&romOff<s+(r.size??0);});
  document.getElementById('status-hover').textContent=
    `Tile #${idx}  |  ${hexStr(romOff)}  |  (${tileX},${tileY})`+(region?`  |  ${region.name}`:'');
});

document.getElementById('btn-render').addEventListener('click',doRender);
document.getElementById('ctrl-zoom').addEventListener('change',doRender);
['ctrl-offset','ctrl-count','ctrl-perrow'].forEach(id=>
  document.getElementById(id).addEventListener('keydown',(e)=>{if(e.key==='Enter')doRender();}));
document.getElementById('btn-prev-page').addEventListener('click',()=>{
  const count=parseInt(document.getElementById('ctrl-count').value)||256;
  const cur=parseHex(document.getElementById('ctrl-offset').value)??0;
  document.getElementById('ctrl-offset').value=hexStr(Math.max(0,cur-count*32));
  doRender();
});
document.getElementById('btn-next-page').addEventListener('click',()=>{
  const count=parseInt(document.getElementById('ctrl-count').value)||256;
  const cur=parseHex(document.getElementById('ctrl-offset').value)??0;
  const next=cur+count*32;
  if(romData&&next<romData.length){document.getElementById('ctrl-offset').value=hexStr(next);doRender();}
});
