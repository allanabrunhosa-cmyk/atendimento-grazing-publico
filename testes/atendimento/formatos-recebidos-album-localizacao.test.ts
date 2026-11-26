import {describe,it,expect} from 'vitest';
import {interpretarMensagemEntradaOperacao} from '../../src/lib/atendimento/operacao-mensagem-entrada';
import {normalizarProjecaoRecebidaOperacao,textoMensagemRecebidaOperacao,AVISO_ALBUM_RECEBIDO,AVISO_META_FORMATO_NAO_SUPORTADO,AVISO_MENSAGEM_RECEBIDA_INDISPONIVEL} from '../../src/lib/atendimento/operacao-mensagem-recebida';

const erro131051=[{code:131051,title:'Message type unknown',error_data:{details:'PRIVATE-DETAIL'}}];
describe('álbum, localização e troca de número recebidos',()=>{
 it('álbum não pede reenvio: as mídias chegam em mensagens próprias',()=>{
  const r=interpretarMensagemEntradaOperacao({type:'unsupported',errors:erro131051,unsupported:{type:'album',raw_type:'album'}});
  expect(r).toEqual({tipo:'unsupported',conteudo:AVISO_ALBUM_RECEBIDO,metadados:{tipoOriginal:'unsupported',projecaoRecebida:{versao:1,formato:'album'}}});
  expect(r.conteudo).not.toMatch(/reenviar/);expect(JSON.stringify(r)).not.toContain('PRIVATE');
  expect(normalizarProjecaoRecebidaOperacao({conteudo:'PRIVATE',metadados:r.metadados})).toEqual({conteudo:AVISO_ALBUM_RECEBIDO,metadados:r.metadados});
  expect(textoMensagemRecebidaOperacao({conteudo:'',metadados:r.metadados})).toBe(AVISO_ALBUM_RECEBIDO);
 });
 it.each([{type:'unknown',raw_type:'unknown'},{type:'outro'},undefined,'album'])('formato sem conteúdo entregue pela Meta mantém o aviso honesto: %j',unsupported=>{
  expect(interpretarMensagemEntradaOperacao({type:'unsupported',errors:erro131051,unsupported}).conteudo).toBe(AVISO_META_FORMATO_NAO_SUPORTADO);
 });
 it('mostra a localização com nome, endereço e link do mapa',()=>{
  const r=interpretarMensagemEntradaOperacao({type:'location',location:{latitude:-23.5614,longitude:-46.6559,name:'Local Fictício',address:'Rua Fictícia, 100',url:'https://privado.invalid'}});
  expect(r).toEqual({tipo:'unsupported',conteudo:'Localização compartilhada — Local Fictício — Rua Fictícia, 100\nhttps://www.google.com/maps?q=-23.5614,-46.6559',metadados:{tipoOriginal:'location',localizacao:{latitude:-23.5614,longitude:-46.6559,nome:'Local Fictício',endereco:'Rua Fictícia, 100'}}});
  expect(JSON.stringify(r)).not.toContain('privado');
 });
 it('localização sem nome mostra apenas o link do mapa',()=>{
  expect(interpretarMensagemEntradaOperacao({type:'location',location:{latitude:0,longitude:180}}).conteudo).toBe('Localização compartilhada\nhttps://www.google.com/maps?q=0,180');
 });
 it.each([undefined,null,{},{latitude:'-23',longitude:'-46'},{latitude:91,longitude:0},{latitude:0,longitude:181},{latitude:NaN,longitude:0},{latitude:1}])('coordenada inválida vira aviso geral: %j',location=>{
  expect(interpretarMensagemEntradaOperacao({type:'location',location}).conteudo).toBe(AVISO_MENSAGEM_RECEBIDA_INDISPONIVEL);
 });
 it('informa a troca de número sem repassar o texto livre da Meta',()=>{
  const r=interpretarMensagemEntradaOperacao({type:'system',system:{type:'user_changed_number',body:'PRIVATE',wa_id:'5511900000001',user_id:'PRIVATE'}});
  expect(r).toEqual({tipo:'unsupported',conteudo:'O WhatsApp informou que este contato trocou de número. Novo número: +5511900000001',metadados:{tipoOriginal:'system',trocaNumero:{novoNumero:'5511900000001'}}});
 });
 it.each([undefined,{type:'outro',wa_id:'5511900000001'},{type:'user_changed_number',wa_id:'abc'},{type:'user_changed_number'}])('evento de sistema desconhecido vira aviso geral: %j',system=>{
  expect(interpretarMensagemEntradaOperacao({type:'system',system}).conteudo).toBe(AVISO_MENSAGEM_RECEBIDA_INDISPONIVEL);
 });
});
