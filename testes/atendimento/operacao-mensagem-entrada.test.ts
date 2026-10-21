import {describe,it,expect} from 'vitest';
import {interpretarMensagemEntradaOperacao} from '../../src/lib/atendimento/operacao-mensagem-entrada';
import {AVISO_MENSAGEM_RECEBIDA_INDISPONIVEL} from '../../src/lib/atendimento/operacao-mensagem-recebida';
describe('Resposta natural de botÃ£o, sem comando automÃ¡tico',()=>{
 it('usa o texto oficial do botÃ£o e preserva payload como metadado',()=>{
  expect(interpretarMensagemEntradaOperacao({type:'button',button:{text:'NÃ£o',payload:'encerrar'}})).toEqual({tipo:'text',conteudo:'NÃ£o',metadados:{tipoOriginal:'button',respostaBotao:true,payloadBotao:'encerrar'}});
 });
 it('aceita botÃ£o sem payload adicional e nÃ£o fabrica aÃ§Ã£o',()=>{
  expect(interpretarMensagemEntradaOperacao({type:'button',button:{text:'Falar com a equipe'}})).toEqual({tipo:'text',conteudo:'Falar com a equipe',metadados:{tipoOriginal:'button',respostaBotao:true}});
 });
 it.each(['button_reply','list_reply'])('interpreta %s pelo tÃ­tulo, mantendo o ID fora do texto',tipo=>{
  expect(interpretarMensagemEntradaOperacao({type:'interactive',interactive:{type:tipo,[tipo]:{id:'acao_ficticia',title:'Quero conversar',description:'DescriÃ§Ã£o'}}})).toEqual({tipo:'text',conteudo:'Quero conversar',metadados:{tipoOriginal:'interactive',tipoResposta:tipo,respostaBotao:true,idResposta:'acao_ficticia'}});
 });
 it.each([
  {type:'button',button:{text:'',payload:'seguir'}},
  {type:'button',button:{text:'Texto',payload:'x'.repeat(257)}},
  {type:'button',button:{text:'x'.repeat(1025)}},
  {type:'button',button:{text:'Texto\u0000'}},
  {type:'interactive',interactive:{type:'button_reply',button_reply:{title:'Texto'}}},
  {type:'interactive',interactive:{type:'nfm_reply',nfm_reply:{response_json:'{}'}}},
 ])('nÃ£o inventa texto para formato malformado/desconhecido',item=>{
  expect(interpretarMensagemEntradaOperacao(item)).toMatchObject({tipo:'unsupported',conteudo:AVISO_MENSAGEM_RECEBIDA_INDISPONIVEL});
 });
 it('preserva texto, legenda e identificaÃ§Ã£o de mÃ­dia existentes',()=>{
  expect(interpretarMensagemEntradaOperacao({type:'text',text:{body:'Mensagem original'}})).toMatchObject({tipo:'text',conteudo:'Mensagem original'});
  expect(interpretarMensagemEntradaOperacao({type:'image',image:{id:'123',mime_type:'image/jpeg',caption:'Foto'}})).toEqual({tipo:'image',conteudo:'Foto',metadados:{mediaId:'123',mime:'image/jpeg'}});
 });
 it('preserva sticker e nome de documento, recusando nomes de caminho',()=>{
  expect(interpretarMensagemEntradaOperacao({type:'sticker',sticker:{id:'12345',mime_type:'image/webp'}})).toEqual({tipo:'sticker',conteudo:'',metadados:{mediaId:'12345',mime:'image/webp'}});
  expect(interpretarMensagemEntradaOperacao({type:'document',document:{id:'12345',mime_type:'application/pdf',filename:'contrato.pdf'}}).metadados).toMatchObject({nomeArquivo:'contrato.pdf'});
  expect(interpretarMensagemEntradaOperacao({type:'document',document:{id:'12345',filename:'../contrato.pdf'}}).metadados).not.toHaveProperty('nomeArquivo');
 });

});
