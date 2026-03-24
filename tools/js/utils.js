'use strict';

// ═══════════════════════════════════════════════════════
//  MD5
// ═══════════════════════════════════════════════════════
function computeMD5(buffer) {
  const bytes=new Uint8Array(buffer);
  let [a0,b0,c0,d0]=[0x67452301,0xEFCDAB89,0x98BADCFE,0x10325476];
  const S=[7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  const K=new Int32Array(64);
  for(let i=0;i<64;i++)K[i]=(Math.abs(Math.sin(i+1))*0x100000000)>>>0;
  const msgLen=bytes.length,bitLen=msgLen*8;
  const padLen=(msgLen%64<56)?(56-msgLen%64):(120-msgLen%64);
  const padded=new Uint8Array(msgLen+padLen+8);
  padded.set(bytes);padded[msgLen]=0x80;
  const dv=new DataView(padded.buffer);
  dv.setUint32(msgLen+padLen,bitLen>>>0,true);
  dv.setUint32(msgLen+padLen+4,Math.floor(bitLen/0x100000000),true);
  for(let off=0;off<padded.length;off+=64){
    const M=new Int32Array(padded.buffer,off,16);
    let[A,B,C,D]=[a0,b0,c0,d0];
    for(let i=0;i<64;i++){
      let F,g;
      if(i<16){F=(B&C)|(~B&D);g=i;}
      else if(i<32){F=(D&B)|(~D&C);g=(5*i+1)%16;}
      else if(i<48){F=B^C^D;g=(3*i+5)%16;}
      else{F=C^(B|~D);g=(7*i)%16;}
      F=(F+A+K[i]+M[g])|0;A=D;D=C;C=B;
      B=(B+((F<<S[i])|(F>>>(32-S[i]))))|0;
    }
    a0=(a0+A)|0;b0=(b0+B)|0;c0=(c0+C)|0;d0=(d0+D)|0;
  }
  const le=(n)=>{const u=n>>>0;return[u&0xff,(u>>8)&0xff,(u>>16)&0xff,(u>>24)&0xff].map(b=>b.toString(16).padStart(2,'0')).join('');};
  return le(a0)+le(b0)+le(c0)+le(d0);
}


// ═══════════════════════════════════════════════════════
//  CRC32
// ═══════════════════════════════════════════════════════
var _CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();
function computeCRC32(buffer) {
  const bytes = new Uint8Array(buffer);
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = _CRC32_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return ((crc ^ 0xFFFFFFFF) >>> 0).toString(16).toUpperCase().padStart(8, '0');
}


// ═══════════════════════════════════════════════════════
//  ZIP EXTRACTOR
// ═══════════════════════════════════════════════════════
async function extractSmsFromZip(buf) {
  const bytes=new Uint8Array(buf),view=new DataView(buf);
  let eocd=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)
    if(view.getUint32(i,true)===0x06054b50){eocd=i;break;}
  if(eocd<0)throw new Error('Not a valid ZIP file');
  const num=view.getUint16(eocd+10,true),cdOff=view.getUint32(eocd+16,true);
  const smsFiles=[];let ptr=cdOff;
  for(let e=0;e<num;e++){
    if(view.getUint32(ptr,true)!==0x02014b50)break;
    const comp=view.getUint16(ptr+10,true),csz=view.getUint32(ptr+20,true),
          usz=view.getUint32(ptr+24,true),fnLen=view.getUint16(ptr+28,true),
          exLen=view.getUint16(ptr+30,true),cmLen=view.getUint16(ptr+32,true),
          lOff=view.getUint32(ptr+42,true);
    const name=new TextDecoder().decode(bytes.subarray(ptr+46,ptr+46+fnLen));
    ptr+=46+fnLen+exLen+cmLen;
    if(!name.toLowerCase().endsWith('.sms')||name.endsWith('/'))continue;
    const lfn=view.getUint16(lOff+26,true),lex=view.getUint16(lOff+28,true);
    const ds=lOff+30+lfn+lex,cd=bytes.subarray(ds,ds+csz);
    let data;
    if(comp===0){data=cd.slice();}
    else if(comp===8){
      if(!DecompressionStream)throw new Error('DecompressionStream not supported');
      const s=new DecompressionStream('deflate-raw'),w=s.writable.getWriter(),r=s.readable.getReader();
      w.write(cd);w.close();
      const chunks=[];while(true){const{done,value}=await r.read();if(done)break;chunks.push(value);}
      const tot=chunks.reduce((a,c)=>a+c.length,0);data=new Uint8Array(tot);
      let p=0;for(const c of chunks){data.set(c,p);p+=c.length;}
    }else throw new Error(`Unsupported ZIP compression: ${comp}`);
    smsFiles.push({name:name.replace(/\\/g,'/').split('/').pop(),data});
  }
  if(!smsFiles.length)throw new Error('No .sms file found inside ZIP.');
  return smsFiles[0];
}


// ═══════════════════════════════════════════════════════
//  SMS TILE DECODE (4bpp planar)
// ═══════════════════════════════════════════════════════
function decodeTile(rom,offset){
  if(offset+32>rom.length)return null;
  const px=new Uint8Array(64);
  for(let row=0;row<8;row++){
    const b=offset+row*4,p0=rom[b],p1=rom[b+1],p2=rom[b+2],p3=rom[b+3];
    for(let bit=7;bit>=0;bit--){
      const col=7-bit;
      px[row*8+col]=((p0>>bit)&1)|(((p1>>bit)&1)<<1)|(((p2>>bit)&1)<<2)|(((p3>>bit)&1)<<3);
    }
  }
  return px;
}


// ═══════════════════════════════════════════════════════
//  SMS PALETTE DECODE (00BBGGRR, 2 bits per channel)
// ═══════════════════════════════════════════════════════
function smsColorToHex(b){
  const r=(b&3)*85,g=((b>>2)&3)*85,bv=((b>>4)&3)*85;
  return '#'+[r,g,bv].map(v=>v.toString(16).padStart(2,'0')).join('');
}
function decodePaletteAt(rom,offset,count=32){
  const colors=[];
  for(let i=0;i<count;i++){
    if(offset+i>=rom.length)break;
    colors.push(smsColorToHex(rom[offset+i]));
  }
  return colors;
}


// ═══════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════
function parseHex(s){const n=parseInt(String(s).trim().replace(/^0x/i,''),16);return isNaN(n)?null:n;}
function hexStr(n,pad=5){return '0x'+n.toString(16).toUpperCase().padStart(pad,'0');}
function bankOf(offset){return Math.floor(offset/BANK_SIZE);}
// Returns Emulicious-style "BB:ZZZZ" address (bank + Z80 page-relative address)
function bankAddrStr(offset){
  const bank=bankOf(offset);
  const pageBase=bank===0?0x0000:bank===1?0x4000:0x8000;
  const z80=pageBase+(offset%BANK_SIZE);
  return bank.toString(16).toUpperCase().padStart(2,'0')+':'+z80.toString(16).toUpperCase().padStart(4,'0');
}
function genId(){return 'r'+((_idCounter++).toString().padStart(4,'0'));}

function getCoveredBytes(){
  if(!romData)return{covered:0,total:0};
  const cov=new Uint8Array(romData.length);
  for(const r of mapData.regions){
    if(r.type==='unknown')continue; // unknown = not yet analyzed
    const off=parseHex(r.offset)??0,sz=r.size??0,end=Math.min(off+sz,romData.length);
    for(let i=off;i<end;i++)cov[i]=1;
  }
  return{covered:cov.reduce((s,v)=>s+v,0),total:romData.length};
}

function getBankCoverage(bankN){
  if(!romData)return 0;
  const start=bankN*BANK_SIZE,end=Math.min(start+BANK_SIZE,romData.length);
  let covered=0;
  for(const r of mapData.regions){
    if(r.type==='unknown')continue; // unknown regions don't count as analyzed
    const rOff=parseHex(r.offset)??0,rEnd=rOff+(r.size??0);
    const lo=Math.max(rOff,start),hi=Math.min(rEnd,end);
    if(hi>lo)covered+=hi-lo;
  }
  return covered/(end-start);
}

// Compute Z80 address from ROM offset (SMS Sega Mapper)
function romOffsetToZ80(offset) {
  const bank = bankOf(offset);
  const pageBase = bank === 0 ? 0x0000 : bank === 1 ? 0x4000 : 0x8000;
  return pageBase + (offset % BANK_SIZE);
}

function vdpCtrlWordToVram(vdp16) {
  return (vdp16 & 0xFF) | (((vdp16 >> 8) & 0x3F) << 8);
}

function screenProg604Z80ToRom(z80, bank8000) {
  if (z80 < 0x8000) return z80;
  if (z80 < 0xC000) return bank8000 * 0x4000 + (z80 - 0x8000);
  return -1;
}

function z80PointerToRomOffset(z80, tableOffset) {
  const tableBank = bankOf(tableOffset);
  if (z80 < 0x4000) return z80;
  if (z80 < 0x8000) return BANK_SIZE + (z80 - 0x4000);
  if (z80 < 0xC000) return tableBank * BANK_SIZE + (z80 - 0x8000);
  return -1;
}

function decodePointerTableLE(bytes, baseOffset, options) {
  options = options || {};
  const stride = options.stride || 2;
  const limit = options.limit || Math.floor(bytes.length / stride);
  const entries = [];
  let validTargets = 0;
  for (let i = 0; i < limit; i++) {
    const off = i * stride;
    if (off + 1 >= bytes.length) break;
    const word = bytes[off] | (bytes[off + 1] << 8);
    const romTarget = z80PointerToRomOffset(word, baseOffset);
    if (romTarget >= 0) validTargets++;
    entries.push({
      index: i,
      entryOffset: baseOffset + off,
      z80: word,
      romTarget,
    });
  }
  return {
    entries,
    stats: {
      entries: entries.length,
      validTargets,
      validRatio: entries.length ? (validTargets / entries.length) : 0,
    },
  };
}

function decodeScreenProg604(rom, scriptOffset, bank8000, options) {
  options = options || {};
  const cols = options.cols || 32;
  const rows = options.rows || 28;
  const ntBase = options.ntBase || 0x3800;
  const maxOps = options.maxOps || 4096;
  const maxPcVisits = options.maxPcVisits || 64;
  const cells = new Array(cols * rows).fill(null).map(() => ({
    tileIdx: 0,
    attr: 0,
    writes: 0,
    lastRomOffset: -1,
    source: '',
  }));
  const trace = [];
  const warnings = [];
  const visitedOffsets = [];
  const visitedSet = new Set();
  const pcVisits = new Map();
  let pc = scriptOffset;
  let storedVDPaddr = 0x7800;
  let vramAddr = ntBase;
  let currentAttr = 0;
  let endReason = 'Reached max ops';
  let ops = 0;

  function markVisited(start, len) {
    for (let i = 0; i < len; i++) {
      const off = start + i;
      if (off < 0 || off >= rom.length || visitedSet.has(off)) continue;
      visitedSet.add(off);
      visitedOffsets.push(off);
    }
  }

  function posFromVram(addr) {
    const cell = (addr - ntBase) >> 1;
    return {
      cell,
      col: cell % cols,
      row: Math.floor(cell / cols),
      inBounds: cell >= 0 && cell < cols * rows,
    };
  }

  function posLabel(addr) {
    const pos = posFromVram(addr);
    const rc = pos.inBounds ? `col ${pos.col}, row ${pos.row}` : 'outside name table';
    return `VRAM $${addr.toString(16).toUpperCase().padStart(4, '0')} · ${rc}`;
  }

  function attrFlags(attr) {
    const flags = [];
    if (attr & 0x01) flags.push('tile+256');
    if (attr & 0x02) flags.push('hflip');
    if (attr & 0x04) flags.push('vflip');
    if (attr & 0x08) flags.push('spr-pal');
    if (attr & 0x10) flags.push('priority');
    return flags.length ? flags.join(', ') : 'none';
  }

  function pushTrace(entry) {
    trace.push(entry);
  }

  function writeCell(addr, tileIdx, attr, source, romOffset) {
    const pos = posFromVram(addr);
    if (!pos.inBounds) return;
    const cell = cells[pos.cell];
    cell.tileIdx = tileIdx & 0xFF;
    cell.attr = attr & 0xFF;
    cell.writes++;
    cell.lastRomOffset = romOffset;
    cell.source = source || '';
  }

  function readByte() {
    if (pc >= rom.length) return null;
    return rom[pc++];
  }

  while (pc < rom.length && ops < maxOps) {
    const visitCount = (pcVisits.get(pc) || 0) + 1;
    pcVisits.set(pc, visitCount);
    if (visitCount > maxPcVisits) {
      endReason = `Loop guard: ROM $${pc.toString(16).toUpperCase().padStart(5, '0')} visited ${visitCount} times`;
      warnings.push(endReason);
      break;
    }

    const start = pc;
    const b = readByte();
    if (b === null) {
      endReason = 'Unexpected EOF';
      warnings.push(endReason);
      break;
    }
    markVisited(start, 1);
    ops++;

    if (b < 0xF0) {
      const before = vramAddr;
      writeCell(before, b, currentAttr, 'direct', start);
      vramAddr += 2;
      pushTrace({
        kind: 'tile',
        romOffset: start,
        length: 1,
        bytes: [b],
        detail: `tile=$${b.toString(16).toUpperCase().padStart(2, '0')} @ ${posLabel(before)} attr=$${currentAttr.toString(16).toUpperCase().padStart(2, '0')}`,
      });
      continue;
    }

    switch (b & 0x07) {
      case 0: {
        endReason = `$${b.toString(16).toUpperCase()} END @ ROM $${start.toString(16).toUpperCase().padStart(5, '0')}`;
        pushTrace({
          kind: 'end',
          romOffset: start,
          length: 1,
          bytes: [b],
          detail: endReason,
        });
        pc = rom.length;
        break;
      }
      case 1: {
        const attr = readByte();
        if (attr === null) {
          endReason = `$F1 truncated @ ROM $${start.toString(16).toUpperCase().padStart(5, '0')}`;
          warnings.push(endReason);
          pc = rom.length;
          break;
        }
        markVisited(start + 1, 1);
        currentAttr = attr;
        pushTrace({
          kind: 'attr',
          romOffset: start,
          length: 2,
          bytes: [b, attr],
          detail: `attr=$${attr.toString(16).toUpperCase().padStart(2, '0')} · ${attrFlags(attr)}`,
        });
        break;
      }
      case 2: {
        const lo = readByte();
        const hi = readByte();
        if (lo === null || hi === null) {
          endReason = `$F2 truncated @ ROM $${start.toString(16).toUpperCase().padStart(5, '0')}`;
          warnings.push(endReason);
          pc = rom.length;
          break;
        }
        markVisited(start + 1, 2);
        storedVDPaddr = lo | (hi << 8);
        vramAddr = vdpCtrlWordToVram(storedVDPaddr);
        pushTrace({
          kind: 'addr',
          romOffset: start,
          length: 3,
          bytes: [b, lo, hi],
          detail: `${posLabel(vramAddr)} (VDP $${storedVDPaddr.toString(16).toUpperCase().padStart(4, '0')})`,
        });
        break;
      }
      case 3: {
        const tile = readByte();
        if (tile === null) {
          endReason = `$F3 truncated @ ROM $${start.toString(16).toUpperCase().padStart(5, '0')}`;
          warnings.push(endReason);
          pc = rom.length;
          break;
        }
        markVisited(start + 1, 1);
        const before = vramAddr;
        writeCell(before, tile, currentAttr, 'literal', start);
        vramAddr += 2;
        pushTrace({
          kind: 'literal',
          romOffset: start,
          length: 2,
          bytes: [b, tile],
          detail: `tile=$${tile.toString(16).toUpperCase().padStart(2, '0')} @ ${posLabel(before)} attr=$${currentAttr.toString(16).toUpperCase().padStart(2, '0')}`,
        });
        break;
      }
      case 4: {
        const lo = readByte();
        const hi = readByte();
        if (lo === null || hi === null) {
          endReason = `$F4 truncated @ ROM $${start.toString(16).toUpperCase().padStart(5, '0')}`;
          warnings.push(endReason);
          pc = rom.length;
          break;
        }
        markVisited(start + 1, 2);
        const z80 = lo | (hi << 8);
        const target = screenProg604Z80ToRom(z80, bank8000);
        pushTrace({
          kind: 'jump',
          romOffset: start,
          length: 3,
          bytes: [b, lo, hi],
          detail: `Z80 $${z80.toString(16).toUpperCase().padStart(4, '0')} → ${target < 0 ? 'invalid' : 'ROM $' + target.toString(16).toUpperCase().padStart(5, '0')}`,
          jumpTarget: target,
          jumpZ80: z80,
        });
        if (target < 0 || target >= rom.length) {
          endReason = `$F4 JUMP out of range (Z80 $${z80.toString(16).toUpperCase().padStart(4, '0')})`;
          warnings.push(endReason);
          pc = rom.length;
        } else {
          pc = target;
        }
        break;
      }
      case 5: {
        const count = readByte();
        const tile = readByte();
        if (count === null || tile === null) {
          endReason = `$F5 truncated @ ROM $${start.toString(16).toUpperCase().padStart(5, '0')}`;
          warnings.push(endReason);
          pc = rom.length;
          break;
        }
        markVisited(start + 1, 2);
        const before = vramAddr;
        for (let i = 0; i < count; i++) {
          writeCell(vramAddr, tile, currentAttr, 'fill', start);
          vramAddr += 2;
        }
        pushTrace({
          kind: 'fill',
          romOffset: start,
          length: 3,
          bytes: [b, count, tile],
          detail: `count=${count} tile=$${tile.toString(16).toUpperCase().padStart(2, '0')} from ${posLabel(before)}`,
        });
        break;
      }
      case 6: {
        storedVDPaddr = (storedVDPaddr + 0x0040) & 0xFFFF;
        if ((storedVDPaddr >> 8) >= 0x7F) storedVDPaddr = (storedVDPaddr & 0x00FF) | 0x7800;
        vramAddr = vdpCtrlWordToVram(storedVDPaddr);
        for (let i = 0; i < cols; i++) {
          writeCell(vramAddr + i * 2, 0x20, 0x08, 'row-prefill', start);
        }
        pushTrace({
          kind: 'row',
          romOffset: start,
          length: 1,
          bytes: [b],
          detail: `${posLabel(vramAddr)} · prefill ${cols} cells with tile=$20 attr=$08`,
        });
        break;
      }
    }
  }

  if (ops >= maxOps && endReason === 'Reached max ops') {
    warnings.push(endReason);
  }

  let writtenCells = 0;
  let bgWrites = 0;
  let sprWrites = 0;
  let minCol = cols, minRow = rows, maxCol = -1, maxRow = -1;
  const uniqueTiles = new Set();
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (!cell.writes) continue;
    writtenCells++;
    uniqueTiles.add((cell.tileIdx | ((cell.attr & 0x01) << 8)) & 0x1FF);
    if (cell.attr & 0x08) sprWrites++;
    else bgWrites++;
    const row = Math.floor(i / cols);
    const col = i % cols;
    if (row < minRow) minRow = row;
    if (row > maxRow) maxRow = row;
    if (col < minCol) minCol = col;
    if (col > maxCol) maxCol = col;
  }

  return {
    scriptOffset,
    bank8000,
    cols,
    rows,
    ntBase,
    cells,
    trace,
    warnings,
    visitedOffsets,
    currentAttr,
    finalVramAddr: vramAddr,
    endReason,
    stats: {
      ops,
      writtenCells,
      uniqueTiles: uniqueTiles.size,
      bgWrites,
      sprWrites,
      jumps: trace.filter(t => t.kind === 'jump').length,
      bbox: writtenCells ? { minCol, minRow, maxCol, maxRow } : null,
    },
  };
}

function decodeVramLoader8FBData(bytes, options) {
  options = options || {};
  const inheritFF = options.inheritFF !== false;
  const defaultBank = options.defaultBank || 0;
  const romLength = options.romLength || 0;
  const entries = [];
  const warnings = [];
  let pc = 0;
  let curVramTile = 0;
  let curBank = defaultBank;
  let curBlockIdx = 0;
  let terminated = false;
  let endReason = 'Unexpected EOF';
  let totalTiles = 0;
  let maxVramTile = -1;
  let invalidSources = 0;

  while (pc < bytes.length) {
    const start = pc;
    const count = bytes[pc++];
    if (count === 0) {
      terminated = true;
      endReason = `END @ +$${start.toString(16).toUpperCase().padStart(2, '0')}`;
      break;
    }
    if (pc + 3 >= bytes.length) {
      endReason = `Truncated 8FB entry @ +$${start.toString(16).toUpperCase().padStart(2, '0')}`;
      warnings.push(endReason);
      pc = bytes.length;
      break;
    }
    const vlo = bytes[pc++], vhi = bytes[pc++], slo = bytes[pc++], shi = bytes[pc++];
    if (inheritFF) {
      if (vlo !== 0xFF || vhi !== 0xFF) curVramTile = vlo | (vhi << 8);
      if (slo !== 0xFF || shi !== 0xFF) {
        curBank = shi >> 1;
        curBlockIdx = ((shi & 1) << 8) | slo;
      }
    } else {
      curVramTile = vlo | (vhi << 8);
      curBank = shi >> 1;
      curBlockIdx = ((shi & 1) << 8) | slo;
    }
    const romSrc = curBank * 0x4000 + curBlockIdx * 32;
    if (romLength && (romSrc < 0 || romSrc + count * 32 > romLength)) invalidSources++;
    entries.push({
      kind: 'copy',
      start,
      length: 5,
      count,
      vramTile: curVramTile,
      vramAddr: curVramTile * 32,
      bank: curBank,
      blockIndex: curBlockIdx,
      romSrc,
      bytes: [count, vlo, vhi, slo, shi],
    });
    totalTiles += count;
    maxVramTile = Math.max(maxVramTile, curVramTile + count - 1);
    curVramTile += count;
    curBlockIdx += count;
  }

  return {
    format: '8fb',
    entries,
    warnings,
    terminated,
    endReason,
    consumedBytes: pc,
    stats: {
      entries: entries.length,
      totalTiles,
      maxVramTile,
      invalidSources,
    },
  };
}

function decodeVramLoader998Data(bytes, options) {
  options = options || {};
  const defaultBank = options.defaultBank || 0;
  const forceBank = options.forceBank;
  const romLength = options.romLength || 0;
  const maxOps = options.maxOps || 4096;
  const entries = [];
  const warnings = [];
  let pc = 0;
  let vramPtr = 0;
  let terminated = false;
  let endReason = 'Unexpected EOF';
  let totalTiles = 0;
  let maxVramTile = -1;
  let invalidSources = 0;
  let ops = 0;

  while (pc < bytes.length && ops < maxOps) {
    const start = pc;
    const b = bytes[pc++];
    ops++;
    if (b === 0) {
      terminated = true;
      endReason = `END @ +$${start.toString(16).toUpperCase().padStart(2, '0')}`;
      break;
    }
    const hasSetPos = !!(b & 0x80);
    const count = b & 0x7F;
    let tileSlot = null;
    if (hasSetPos) {
      if (pc >= bytes.length) {
        endReason = `Truncated 998 set-pos @ +$${start.toString(16).toUpperCase().padStart(2, '0')}`;
        warnings.push(endReason);
        pc = bytes.length;
        break;
      }
      tileSlot = bytes[pc++];
      vramPtr = tileSlot * 32;
    }
    if (count === 0x7F) {
      entries.push({
        kind: 'zero',
        start,
        length: hasSetPos ? 2 : 1,
        count: 1,
        vramTile: vramPtr >> 5,
        vramAddr: vramPtr,
        bank: null,
        blockIndex: null,
        romSrc: null,
        setPos: hasSetPos,
        tileSlot,
        bytes: Array.from(bytes.subarray(start, pc)),
      });
      totalTiles += 1;
      maxVramTile = Math.max(maxVramTile, vramPtr >> 5);
      vramPtr += 32;
      continue;
    }
    if (count === 0) {
      entries.push({
        kind: 'noop',
        start,
        length: hasSetPos ? 2 : 1,
        count: 0,
        vramTile: vramPtr >> 5,
        vramAddr: vramPtr,
        bank: null,
        blockIndex: null,
        romSrc: null,
        setPos: hasSetPos,
        tileSlot,
        bytes: Array.from(bytes.subarray(start, pc)),
      });
      continue;
    }
    if (pc + 1 >= bytes.length) {
      endReason = `Truncated 998 copy @ +$${start.toString(16).toUpperCase().padStart(2, '0')}`;
      warnings.push(endReason);
      pc = bytes.length;
      break;
    }
    const srcLo = bytes[pc++], srcHi = bytes[pc++];
    const bank = forceBank != null ? forceBank : (srcHi >> 1);
    const blockIndex = ((srcHi & 1) << 8) | srcLo;
    const romSrc = bank * 0x4000 + blockIndex * 32;
    if (romLength && (romSrc < 0 || romSrc + count * 32 > romLength)) invalidSources++;
    entries.push({
      kind: 'copy',
      start,
      length: pc - start,
      count,
      vramTile: vramPtr >> 5,
      vramAddr: vramPtr,
      bank,
      blockIndex,
      romSrc,
      setPos: hasSetPos,
      tileSlot,
      bytes: Array.from(bytes.subarray(start, pc)),
    });
    totalTiles += count;
    maxVramTile = Math.max(maxVramTile, (vramPtr >> 5) + count - 1);
    vramPtr += count * 32;
  }

  if (ops >= maxOps && !terminated) {
    endReason = 'Reached max ops';
    warnings.push(endReason);
  }

  return {
    format: '998',
    entries,
    warnings,
    terminated,
    endReason,
    consumedBytes: pc,
    stats: {
      entries: entries.length,
      totalTiles,
      maxVramTile,
      invalidSources,
    },
  };
}
