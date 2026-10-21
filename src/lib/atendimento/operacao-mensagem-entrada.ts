import {objetoOperacao} from './operacao-tipos';
import {normalizarContatosCompartilhadosOperacao,resumoContatosCompartilhadosOperacao} from './operacao-contatos-compartilhados';
import {projetarMensagemRecebidaOperacao} from './operacao-mensagem-recebida';

export type MensagemInterpretadaOperacao={tipo:'text'|'image'|'audio'|'document'|'video'|'sticker'|'unsupported';conteudo:string;metadados:Record<string,unknown>};
const textoCurto=(v:unknown,max:number):v is string=>typeof v==='string'&&!!v.trim()&&v.length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v);
const indisponivel=(item:Record<string,unknown>):MensagemInterpretadaOperacao=>({tipo:'unsupported',...projetarMensagemRecebidaOperacao(item)});

/** Os bytes originais já estão no recibo durável. Uma resposta de botão é
 * texto natural do cliente; payload/id preservados não são comandos. */
export function interpretarMensagemEntradaOperacao(item:Record<string,unknown>):MensagemInterpretadaOperacao{
 if(item.type==='contacts'){
  const contatosCompartilhados=normalizarContatosCompartilhadosOperacao(item.contacts);
  return {tipo:'unsupported',conteudo:resumoContatosCompartilhadosOperacao(contatosCompartilhados),metadados:{tipoOriginal:'contacts',contatosCompartilhados}};
 }
 if(item.type==='button'){
  const b=item.button;if(!objetoOperacao(b)||!textoCurto(b.text,1024)||b.payload!==undefined&&!textoCurto(b.payload,256))return indisponivel(item);
  return {tipo:'text',conteudo:b.text,metadados:{tipoOriginal:'button',respostaBotao:true,...(typeof b.payload==='string'?{payloadBotao:b.payload}:{})}};
 }
 if(item.type==='interactive'){
  const a=item.interactive;if(!objetoOperacao(a)||!['button_reply','list_reply'].includes(String(a.type)))return indisponivel(item);
  const b=a[String(a.type)];if(!objetoOperacao(b)||!textoCurto(b.title,1024)||!textoCurto(b.id,256))return indisponivel(item);
  return {tipo:'text',conteudo:b.title,metadados:{tipoOriginal:'interactive',tipoResposta:a.type,respostaBotao:true,idResposta:b.id}};
 }
 if(!['text','image','audio','document','video','sticker'].includes(String(item.type)))return indisponivel(item);
 const tipo=item.type as Exclude<MensagemInterpretadaOperacao['tipo'],'unsupported'>,media=item[tipo];
 const conteudo=objetoOperacao(media)&&typeof media.body==='string'?media.body.slice(0,65536):objetoOperacao(media)&&typeof media.caption==='string'?media.caption.slice(0,65536):'';
 return {tipo,conteudo,metadados:objetoOperacao(media)?{mediaId:media.id??null,mime:media.mime_type??null,...(textoCurto(media.filename,160)&&!/[\\/]/.test(media.filename)?{nomeArquivo:media.filename}:{})}:{}};
}
