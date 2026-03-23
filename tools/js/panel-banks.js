'use strict';

// ═══════════════════════════════════════════════════════
//  BANKS GRID UI
// ═══════════════════════════════════════════════════════
function renderBanksGrid(){
  const grid=document.getElementById('banks-grid');
  grid.innerHTML='';
  const curOff=parseHex(document.getElementById('ctrl-offset').value)??0;
  const curBank=bankOf(curOff);
  for(let b=0;b<BANK_COUNT;b++){
    const start=b*BANK_SIZE,end=start+BANK_SIZE-1;
    const regCount=mapData.regions.filter(r=>{const o=parseHex(r.offset)??0;return bankOf(o)===b;}).length;
    const cov=Math.round(getBankCoverage(b)*100);
    const cell=document.createElement('div');
    cell.className='bank-cell'+(b===curBank?' bank-active':'');
    cell.dataset.bank=b;
    cell.innerHTML=`
      <div class="bank-num">BANK ${b}</div>
      <div class="bank-range">${hexStr(start,5)}–${hexStr(end,5)}</div>
      <div class="bank-regions">${regCount?regCount+' region'+(regCount!==1?'s':''):''}</div>
      <div class="bank-coverage"><div class="bank-coverage-fill" style="width:${cov}%"></div></div>`;
    cell.addEventListener('click',()=>{
      document.getElementById('ctrl-offset').value=hexStr(start);
      doRender();
      renderBanksGrid();
    });
    grid.appendChild(cell);
  }
}


// ═══════════════════════════════════════════════════════
//  BANK JUMP BUTTONS (Memory Map panel)
// ═══════════════════════════════════════════════════════
function renderBankJumps(){
  const wrap=document.getElementById('map-bank-jumps');
  if(!wrap)return;
  wrap.innerHTML='';
  if(!romData)return;
  for(let b=0;b<BANK_COUNT;b++){
    const hasSome=mapData.regions.some(r=>bankOf(parseHex(r.offset)??0)===b);
    const btn=document.createElement('button');
    btn.className='btn small'+(hasSome?'':' disabled');
    btn.disabled=!hasSome;
    btn.textContent=b;
    btn.title=`Bank ${b}: ${hexStr(b*BANK_SIZE,5)}–${hexStr(b*BANK_SIZE+BANK_SIZE-1,5)}`;
    btn.addEventListener('click',()=>{
      const rows=document.querySelectorAll('#regions-tbody tr[data-bank]');
      const target=[...rows].find(tr=>parseInt(tr.dataset.bank)===b);
      if(!target){showToast(`No visible regions in bank ${b}`,true);return;}
      target.scrollIntoView({block:'nearest',behavior:'smooth'});
      // brief flash to help locate
      const orig=target.style.outline;
      target.style.outline='1px solid var(--accent)';
      setTimeout(()=>target.style.outline=orig,800);
    });
    wrap.appendChild(btn);
  }
}

// ═══════════════════════════════════════════════════════
//  ROM MAP VISUAL
// ═══════════════════════════════════════════════════════
function renderRomMap(){
  const canvas=document.getElementById('rommap-canvas');
  if(!romData)return;
  const W=canvas.offsetWidth||canvas.parentElement.offsetWidth||800;
  canvas.width=W;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#111120';ctx.fillRect(0,0,W,28);
  const romLen=romData.length;
  for(const r of mapData.regions){
    const off=parseHex(r.offset)??0,sz=r.size??0;
    const x1=Math.floor(off/romLen*W),x2=Math.ceil((off+sz)/romLen*W);
    ctx.fillStyle=(TYPE_META[r.type]?.color)??'#555577';
    ctx.globalAlpha=0.85;
    ctx.fillRect(x1,0,Math.max(1,x2-x1),28);
  }
  ctx.globalAlpha=1;
  // Bank dividers
  ctx.strokeStyle='rgba(255,255,255,0.12)';ctx.lineWidth=1;
  for(let b=1;b<BANK_COUNT;b++){
    const x=Math.floor(b*BANK_SIZE/romLen*W);
    ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,28);ctx.stroke();
    ctx.fillStyle='rgba(255,255,255,0.25)';ctx.font='8px Courier New';
    ctx.fillText(b,x+2,10);
  }
}

function renderRomMapLegend(){
  const wrap=document.getElementById('rommap-legend');
  wrap.innerHTML='';
  for(const[type,meta]of Object.entries(TYPE_META)){
    if(!mapData.regions.some(r=>r.type===type))continue;
    const div=document.createElement('div');div.className='legend-item';
    div.innerHTML=`<div class="legend-swatch" style="background:${meta.color}"></div>${meta.label}`;
    wrap.appendChild(div);
  }
}

function updateProgress(){
  const{covered,total}=getCoveredBytes();
  const pct=total?(covered/total*100).toFixed(1):'0.0';
  document.getElementById('prog-fill').style.width=pct+'%';
  document.getElementById('prog-label').innerHTML=`<span>${pct}%</span> mapped — ${covered.toLocaleString()} / ${total.toLocaleString()} bytes`;
}

// Tooltip
const rommapTip=document.getElementById('rommap-tooltip');
document.getElementById('rommap-canvas').addEventListener('mousemove',(e)=>{
  if(!romData)return;
  const rect=e.currentTarget.getBoundingClientRect();
  const off=Math.floor((e.clientX-rect.left)/rect.width*romData.length);
  const bank=bankOf(off);
  const region=mapData.regions.find(r=>{const s=parseHex(r.offset)??0;return off>=s&&off<s+(r.size??0);});
  rommapTip.style.display='block';
  rommapTip.style.left=(e.clientX+12)+'px';
  rommapTip.style.top=(e.clientY+12)+'px';
  rommapTip.textContent=`${hexStr(off)} · ${bankAddrStr(off)} · `+(region?`${region.name} [${region.type}]`:'unmapped');
});
document.getElementById('rommap-canvas').addEventListener('mouseleave',()=>rommapTip.style.display='none');
document.getElementById('rommap-canvas').addEventListener('click',(e)=>{
  if(!romData)return;
  const rect=e.currentTarget.getBoundingClientRect();
  const off=Math.floor((e.clientX-rect.left)/rect.width*romData.length);
  const snapped=Math.floor(off/32)*32; // align to tile
  document.getElementById('ctrl-offset').value=hexStr(snapped);
  doRender();
  renderBanksGrid();
});
