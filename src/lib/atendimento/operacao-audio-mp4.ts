/** O gravador do Chrome entrega AAC em MP4 fragmentado (moof/mdat). A Cloud API
 * aceita o POST e depois recusa a mídia com o erro 131053. Aqui o mesmo áudio é
 * reembalado em MP4 progressivo, sem recodificar. Qualquer estrutura inesperada
 * devolve o arquivo original, que segue a validação normal do envio. */
type Caixa={tipo:string;inicio:number;cab:number;fim:number};
const AMOSTRAS_POR_BLOCO=50,LIMITE_AMOSTRAS=2_000_000;

function caixas(b:Buffer,inicio:number,fim:number):Caixa[]{
 const r:Caixa[]=[];let o=inicio;
 while(o+8<=fim){
  let n=b.readUInt32BE(o),cab=8;const tipo=b.toString('latin1',o+4,o+8);
  if(n===1){const g=b.readBigUInt64BE(o+8);if(g>BigInt(fim-o))throw Error('MP4_CAIXA');n=Number(g);cab=16;}else if(n===0)n=fim-o;
  if(n<cab||o+n>fim)throw Error('MP4_CAIXA');
  r.push({tipo,inicio:o,cab,fim:o+n});o+=n;
 }
 if(o!==fim)throw Error('MP4_CAIXA');
 return r;
}
function uma(lista:Caixa[],tipo:string){const r=lista.filter(c=>c.tipo===tipo);if(r.length!==1)throw Error('MP4_'+tipo);return r[0];}
function montar(tipo:string,...partes:Buffer[]){const cab=Buffer.alloc(8);cab.writeUInt32BE(8+partes.reduce((n,p)=>n+p.length,0),0);cab.write(tipo,4,'latin1');return Buffer.concat([cab,...partes]);}
function u32(...valores:number[]){const b=Buffer.alloc(4*valores.length);valores.forEach((v,i)=>b.writeUInt32BE(v,4*i));return b;}

export function desfragmentarAudioMp4(original:Buffer):Buffer{
 try{
  const topo=caixas(original,0,original.length),moofs=topo.filter(c=>c.tipo==='moof');
  if(!moofs.length)return original;
  const filhos=(c:Caixa)=>caixas(original,c.inicio+c.cab,c.fim),copia=(c:Caixa)=>original.subarray(c.inicio,c.fim);
  const moov=uma(topo,'moov'),fMoov=filhos(moov),trak=uma(fMoov,'trak'),fTrak=filhos(trak),mdia=uma(fTrak,'mdia'),fMdia=filhos(mdia);
  const minf=uma(fMdia,'minf'),fMinf=filhos(minf),stbl=uma(fMinf,'stbl'),stsd=uma(filhos(stbl),'stsd'),hdlr=uma(fMdia,'hdlr');
  const mvhd=uma(fMoov,'mvhd'),tkhd=uma(fTrak,'tkhd'),mdhd=uma(fMdia,'mdhd');
  if(original.toString('latin1',hdlr.inicio+hdlr.cab+8,hdlr.inicio+hdlr.cab+12)!=='soun')return original;
  const sd=stsd.inicio+stsd.cab;if(original.readUInt32BE(sd+4)!==1||original.toString('latin1',sd+12,sd+16)!=='mp4a')return original;
  let duracaoPadrao=0,tamanhoPadrao=0;const mvex=fMoov.find(c=>c.tipo==='mvex'),trex=mvex?filhos(mvex).find(c=>c.tipo==='trex'):undefined;
  if(trex){const p=trex.inicio+trex.cab;duracaoPadrao=original.readUInt32BE(p+12);tamanhoPadrao=original.readUInt32BE(p+16);}

  const duracoes:number[]=[],dados:Buffer[]=[];
  for(const moof of moofs){
   const traf=uma(filhos(moof),'traf'),fTraf=filhos(traf),tfhd=uma(fTraf,'tfhd');
   let q=tfhd.inicio+tfhd.cab;const tf=original.readUInt32BE(q)&0xffffff;q+=8;
   let base=moof.inicio,duracao=duracaoPadrao,tamanho=tamanhoPadrao;
   if(tf&0x1){base=Number(original.readBigUInt64BE(q));q+=8;}
   if(tf&0x2)q+=4;
   if(tf&0x8){duracao=original.readUInt32BE(q);q+=4;}
   if(tf&0x10){tamanho=original.readUInt32BE(q);q+=4;}
   if(q>tfhd.fim)throw Error('MP4_tfhd');
   let cursor=base;
   for(const trun of fTraf.filter(c=>c.tipo==='trun')){
    let p=trun.inicio+trun.cab;const f=original.readUInt32BE(p)&0xffffff,total=original.readUInt32BE(p+4);p+=8;
    if(f&0x1){cursor=base+original.readInt32BE(p);p+=4;}
    if(f&0x4)p+=4;
    for(let i=0;i<total;i++){
     let d=duracao,n=tamanho;
     if(f&0x100){d=original.readUInt32BE(p);p+=4;}
     if(f&0x200){n=original.readUInt32BE(p);p+=4;}
     if(f&0x400)p+=4;
     if(f&0x800)p+=4;
     if(p>trun.fim||n<1||cursor<0||cursor+n>original.length||duracoes.length>=LIMITE_AMOSTRAS)throw Error('MP4_trun');
     duracoes.push(d);dados.push(original.subarray(cursor,cursor+n));cursor+=n;
    }
   }
  }
  if(!dados.length)return original;

  const versao=(c:Caixa)=>original[c.inicio+c.cab];
  const escalaMidia=original.readUInt32BE(mdhd.inicio+mdhd.cab+(versao(mdhd)===1?20:12)),escalaFilme=original.readUInt32BE(mvhd.inicio+mvhd.cab+(versao(mvhd)===1?20:12));
  const duracaoMidia=duracoes.reduce((n,d)=>n+d,0),duracaoFilme=escalaMidia?Math.round(duracaoMidia*escalaFilme/escalaMidia):0;
  if(!escalaMidia||!duracaoMidia||duracaoMidia>0xffffffff||duracaoFilme>0xffffffff)throw Error('MP4_duracao');
  const comDuracao=(c:Caixa,v0:number,v1:number,valor:number)=>{const b=Buffer.from(copia(c));if(versao(c)===1)b.writeBigUInt64BE(BigInt(valor),c.cab+v1);else b.writeUInt32BE(valor,c.cab+v0);return b;};

  const stts:number[]=[];for(const d of duracoes){if(stts.length&&stts[stts.length-1]===d)stts[stts.length-2]++;else stts.push(1,d);}
  const blocos=Math.ceil(dados.length/AMOSTRAS_POR_BLOCO),resto=dados.length%AMOSTRAS_POR_BLOCO;
  const stsc=blocos===1?[1,dados.length,1]:resto?[1,AMOSTRAS_POR_BLOCO,1,blocos,resto,1]:[1,AMOSTRAS_POR_BLOCO,1];
  const tabelas=(inicioDados:number)=>{
   const deslocamentos:number[]=[];let o=inicioDados;dados.forEach((d,i)=>{if(i%AMOSTRAS_POR_BLOCO===0)deslocamentos.push(o);o+=d.length;});
   return montar('stbl',Buffer.from(copia(stsd)),montar('stts',u32(0,stts.length/2,...stts)),montar('stsc',u32(0,stsc.length/3,...stsc)),montar('stsz',u32(0,0,dados.length,...dados.map(d=>d.length))),montar('stco',u32(0,deslocamentos.length,...deslocamentos)));
  };
  const novoMoov=(inicioDados:number)=>montar('moov',...fMoov.filter(c=>c.tipo!=='mvex').map(c=>c===mvhd?comDuracao(c,16,24,duracaoFilme):c!==trak?copia(c):
   montar('trak',...fTrak.map(t=>t===tkhd?comDuracao(t,20,28,duracaoFilme):t!==mdia?copia(t):
    montar('mdia',...fMdia.map(m=>m===mdhd?comDuracao(m,16,24,duracaoMidia):m!==minf?copia(m):
     montar('minf',...fMinf.map(i=>i===stbl?tabelas(inicioDados):copia(i)))))))));
  const ftyp=montar('ftyp',Buffer.from('M4A \0\0\0\0M4A mp42isom','latin1'));
  const inicioDados=ftyp.length+novoMoov(0).length+8,carga=dados.reduce((n,d)=>n+d.length,0);
  if(inicioDados+carga>0xffffffff)throw Error('MP4_grande');
  return Buffer.concat([ftyp,novoMoov(inicioDados),u32(8+carga),Buffer.from('mdat','latin1'),...dados]);
 }catch{return original;}
}
