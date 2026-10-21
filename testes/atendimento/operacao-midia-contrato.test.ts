import {describe,it,expect} from 'vitest';
import {base64MidiaValida,informacaoStickerWebp,tipoMidiaOperacao,validarBytesMidiaOperacao,validarMetadadosMidiaOperacao} from '../../src/lib/atendimento/operacao-midia-contrato';
import {pngFicticio,webpFicticio,webpAnimadoFicticio,amrFicticio,mp4Ficticio,pdfFicticio} from './fixtures-midia';

describe('contrato de mídia antes do upload oficial',()=>{
 it.each([4,20])('valida Base64 de %s MB sem esgotar a pilha',(mb)=>{const texto=Buffer.alloc(mb*1024*1024,65).toString('base64');expect(base64MidiaValida(texto)).toBe(true);});
 it('mantém teto, alfabeto, grupos e padding do Base64',()=>{
  for(const valor of ['TQ==','TWE=','AAAA'])expect(base64MidiaValida(valor)).toBe(true);
  for(const valor of ['',null,'AAAA\n','AAA=AAAA','TQ===','AA','%PDF', 'A'.repeat(4*Math.ceil(20*1024*1024/3)+4)])expect(base64MidiaValida(valor)).toBe(false);
 });
 it.each([['image','image/png',pngFicticio],['audio','audio/amr',amrFicticio],['video','video/mp4',mp4Ficticio],['sticker','image/webp',webpFicticio],['sticker','image/webp',webpAnimadoFicticio],['document','application/pdf',pdfFicticio]] as const)('valida %s com MIME e assinatura próprios', (tipo,mime,bytes)=>expect(()=>validarBytesMidiaOperacao(tipo,mime,bytes)).not.toThrow());
 it.each([['image','image/png',5],['audio','audio/amr',16],['video','video/mp4',16],['document','application/pdf',20]] as const)('limite de %s é aplicado em bytes antes de envio',(tipo,mime,mb)=>{
  expect(()=>validarMetadadosMidiaOperacao(tipo,mime,mb*1024*1024)).not.toThrow();
  expect(()=>validarMetadadosMidiaOperacao(tipo,mime,mb*1024*1024+1)).toThrow('GRANDE');
 });
 it('não envia PDF declarado imagem, áudio declarado vídeo, GIF ou SVG',()=>{
  expect(()=>validarBytesMidiaOperacao('image','application/pdf',pdfFicticio)).toThrow('TIPO_DIVERGENTE');
  expect(()=>validarBytesMidiaOperacao('image','image/png',pdfFicticio)).toThrow('INVALIDA');
  expect(()=>validarBytesMidiaOperacao('video','audio/amr',amrFicticio)).toThrow('TIPO_DIVERGENTE');
  expect(tipoMidiaOperacao('image/gif')).toBeUndefined();expect(tipoMidiaOperacao('image/svg+xml')).toBeUndefined();
 });
 it('confere WebP estático/animado de 512px e recusa contêiner truncado',()=>{
  expect(informacaoStickerWebp(webpFicticio)).toEqual({largura:512,altura:512,animado:false});
  expect(informacaoStickerWebp(webpAnimadoFicticio)).toEqual({largura:512,altura:512,animado:true});
  expect(()=>validarBytesMidiaOperacao('sticker','image/webp',webpAnimadoFicticio.subarray(0,50))).toThrow('STICKER_INVALIDO');
  const outro=Buffer.from(webpAnimadoFicticio);outro.writeUIntLE(254,24,3);
  expect(()=>validarBytesMidiaOperacao('sticker','image/webp',outro)).toThrow('STICKER_INVALIDO');
 });
 it('diferencia teto estático 100KiB do animado 500KiB',()=>{
  function ampliar(origem:Buffer,tamanho:number){const b=Buffer.alloc(tamanho);origem.copy(b);b.write('JUNK',origem.length);b.writeUInt32LE(tamanho-origem.length-8,origem.length+4);b.writeUInt32LE(tamanho-8,4);return b;}
  expect(()=>validarBytesMidiaOperacao('sticker','image/webp',ampliar(webpFicticio,100*1024))).not.toThrow();
  expect(()=>validarBytesMidiaOperacao('sticker','image/webp',ampliar(webpFicticio,102*1024))).toThrow('GRANDE');
  expect(()=>validarBytesMidiaOperacao('sticker','image/webp',ampliar(webpAnimadoFicticio,500*1024))).not.toThrow();
  expect(()=>validarBytesMidiaOperacao('sticker','image/webp',ampliar(webpAnimadoFicticio,502*1024))).toThrow('GRANDE');
 });
 it('exige Opus para áudio Ogg e preserva bloqueio de bytes ativos disfarçados',()=>{
  const ogg=Buffer.alloc(60);ogg.write('OggS');ogg[26]=1;ogg[27]=19;ogg.write('OpusHead',28);
  expect(()=>validarBytesMidiaOperacao('audio','audio/ogg',ogg)).not.toThrow();
  expect(()=>validarBytesMidiaOperacao('audio','audio/ogg; codecs=opus',ogg)).not.toThrow();
  expect(tipoMidiaOperacao('audio/ogg; codecs=vorbis')).toBeUndefined();
  expect(tipoMidiaOperacao('audio/ogg; codecs=opus; extra=1')).toBeUndefined();
  ogg.write('vorbis!!',28);expect(()=>validarBytesMidiaOperacao('audio','audio/ogg',ogg)).toThrow('CODEC_RECUSADO');
  expect(()=>validarBytesMidiaOperacao('audio','audio/ogg; codecs=opus',ogg)).toThrow('CODEC_RECUSADO');
  expect(()=>validarBytesMidiaOperacao('document','application/pdf',Buffer.from('<script/>'))).toThrow('INVALIDA');
 });
});
