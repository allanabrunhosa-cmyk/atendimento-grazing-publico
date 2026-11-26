import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {desfragmentarAudioMp4} from '../../src/lib/atendimento/operacao-audio-mp4';
import {validarBytesMidiaOperacao} from '../../src/lib/atendimento/operacao-midia-contrato';

// Tom sintético de 440 Hz gravado pelo MediaRecorder do Chrome. Não contém voz.
const fragmentado=readFileSync(new URL('./fixtures/audio-chrome-fragmentado.m4a',import.meta.url));
const u32=(b:Buffer,o:number)=>b.readUInt32BE(o);
function caixa(b:Buffer,caminho:string[],inicio=0,fim=b.length):{inicio:number;fim:number}{
 for(let o=inicio;o+8<=fim;o+=u32(b,o))if(b.toString('latin1',o+4,o+8)===caminho[0])return caminho.length===1?{inicio:o+8,fim:o+u32(b,o)}:caixa(b,caminho.slice(1),o+8,o+u32(b,o));
 throw Error('caixa ausente: '+caminho[0]);
}
describe('áudio MP4 gravado no navegador',()=>{
 it('o arquivo de origem é fragmentado, como o gravador do Chrome entrega',()=>{expect(fragmentado.includes('moof')).toBe(true);expect(fragmentado.includes('mvex')).toBe(true);});
 it('reembala em MP4 progressivo com as mesmas amostras AAC',()=>{
  const r=desfragmentarAudioMp4(fragmentado);
  expect(r.includes('moof')).toBe(false);expect(r.includes('mvex')).toBe(false);expect(r.indexOf('moov')).toBeLessThan(r.indexOf('mdat'));
  expect(()=>validarBytesMidiaOperacao('audio','audio/mp4',r)).not.toThrow();
  const stbl=['moov','trak','mdia','minf','stbl'],stsz=caixa(r,[...stbl,'stsz']),stco=caixa(r,[...stbl,'stco']),stts=caixa(r,[...stbl,'stts']),stsc=caixa(r,[...stbl,'stsc']),mdhd=caixa(r,['moov','trak','mdia','mdhd']),mdat=caixa(r,['mdat']);
  expect(r.toString('latin1',caixa(r,[...stbl,'stsd']).inicio+12,caixa(r,[...stbl,'stsd']).inicio+16)).toBe('mp4a');
  const total=u32(r,stsz.inicio+8),tamanhos=Array.from({length:total},(_,i)=>u32(r,stsz.inicio+12+4*i));
  expect(total).toBeGreaterThan(100);expect(tamanhos.reduce((a,b)=>a+b,0)).toBe(mdat.fim-mdat.inicio);
  // Cada bloco aponta para dentro do mdat, na ordem das amostras.
  const blocos=u32(r,stco.inicio+4);let esperado=mdat.inicio,amostra=0;
  const porBloco=(n:number)=>{let v=0;for(let i=0;i<u32(r,stsc.inicio+4);i++)if(u32(r,stsc.inicio+8+12*i)<=n)v=u32(r,stsc.inicio+12+12*i);return v;};
  for(let b=1;b<=blocos;b++){expect(u32(r,stco.inicio+4+4*b)).toBe(esperado);for(let i=porBloco(b);i>0;i--)esperado+=tamanhos[amostra++];}
  expect(amostra).toBe(total);expect(esperado).toBe(mdat.fim);
  // A duração declarada é a soma das durações das amostras.
  let soma=0,contadas=0;for(let i=0;i<u32(r,stts.inicio+4);i++){const n=u32(r,stts.inicio+8+8*i);contadas+=n;soma+=n*u32(r,stts.inicio+12+8*i);}
  expect(contadas).toBe(total);const v1=r[mdhd.inicio]===1,duracao=v1?Number(r.readBigUInt64BE(mdhd.inicio+24)):u32(r,mdhd.inicio+16),escala=u32(r,mdhd.inicio+(v1?20:12));
  expect(duracao).toBe(soma);expect(duracao/escala).toBeGreaterThan(3);expect(duracao/escala).toBeLessThan(4);
 });
 it('não altera MP4 progressivo nem conteúdo que não reconhece',()=>{
  const progressivo=desfragmentarAudioMp4(fragmentado);expect(desfragmentarAudioMp4(progressivo)).toBe(progressivo);
  for(const b of [Buffer.alloc(0),Buffer.from('texto qualquer'),fragmentado.subarray(0,fragmentado.length-7),Buffer.concat([fragmentado.subarray(0,700),Buffer.alloc(900,255)])])expect(desfragmentarAudioMp4(b)).toBe(b);
 });
});
