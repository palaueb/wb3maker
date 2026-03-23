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
