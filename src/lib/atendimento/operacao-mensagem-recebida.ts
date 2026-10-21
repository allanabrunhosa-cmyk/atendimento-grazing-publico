import {objetoOperacao} from './operacao-tipos';
import type {PedidoContatosCompartilhadosOperacao} from './operacao-contatos-compartilhados';

export const AVISO_REACAO_INDISPONIVEL='Reação recebida, mas não foi possível identificar o emoji.';
export const AVISO_META_FORMATO_NAO_SUPORTADO='O WhatsApp informou que esta mensagem usa um formato não suportado e não entregou conteúdo utilizável. Peça ao cliente para reenviar como texto, áudio ou arquivo.';
export const AVISO_MENSAGEM_RECEBIDA_INDISPONIVEL='O conteúdo desta mensagem não está disponível neste atendimento. Peça ao cliente para reenviar como texto, áudio ou arquivo.';
type SnapshotRecebida={versao:1;formato:'reaction';estado:'emoji'|'removida'|'invalida';emoji?:string}|{versao:1;formato:'meta_nao_suportada'|'indisponivel'};
export type ProjecaoMensagemRecebidaOperacao={conteudo:string;metadados:{tipoOriginal:string;projecaoRecebida:SnapshotRecebida}};
export type PedidoProjecaoRecebidaOperacao=PedidoContatosCompartilhadosOperacao;
export type LeitorProjecoesRecebidasOperacao=(pedidos:PedidoProjecaoRecebidaOperacao[])=>Promise<Map<string,ProjecaoMensagemRecebidaOperacao>>;
const tipoSeguro=(v:unknown)=>typeof v==='string'&&/^[a-z_]{1,80}$/.test(v)?v:'desconhecido';
const emojiValido=(v:unknown):v is string=>typeof v==='string'&&v.length<=128&&/[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(v)&&/^[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Component}\u200d]+$/u.test(v);
const textoSnapshot=(p:SnapshotRecebida)=>p.formato==='reaction'?p.estado==='emoji'?`Reagiu com ${p.emoji}`:p.estado==='removida'?'Reação removida.':AVISO_REACAO_INDISPONIVEL:p.formato==='meta_nao_suportada'?AVISO_META_FORMATO_NAO_SUPORTADO:AVISO_MENSAGEM_RECEBIDA_INDISPONIVEL;
/** Somente campos conhecidos viram projeção. O recibo durável conserva o original. */
export function projetarMensagemRecebidaOperacao(item:Record<string,unknown>):ProjecaoMensagemRecebidaOperacao{
 const tipoOriginal=tipoSeguro(item.type);let projecaoRecebida:SnapshotRecebida={versao:1,formato:'indisponivel'};
 if(item.type==='reaction'){
  const r=objetoOperacao(item.reaction)?item.reaction:{},alvo=typeof r.message_id==='string'&&/^wamid\.[A-Za-z0-9_+/=-]{1,500}$/.test(r.message_id);
  projecaoRecebida={versao:1,formato:'reaction',estado:'invalida'};
  if(alvo&&r.emoji==='')projecaoRecebida={versao:1,formato:'reaction',estado:'removida'};
  else if(alvo&&emojiValido(r.emoji))projecaoRecebida={versao:1,formato:'reaction',estado:'emoji',emoji:r.emoji};
 }else if(item.type==='unsupported'&&Array.isArray(item.errors)&&item.errors.some(e=>objetoOperacao(e)&&(e.code===131051||e.code==='131051')))projecaoRecebida={versao:1,formato:'meta_nao_suportada'};
 return {conteudo:textoSnapshot(projecaoRecebida),metadados:{tipoOriginal,projecaoRecebida}};
}
/** O leitor externo não pode impor texto livre nem ampliar o DTO com o JSON original. */
export function normalizarProjecaoRecebidaOperacao(v:unknown):ProjecaoMensagemRecebidaOperacao|null{
 if(!objetoOperacao(v)||!objetoOperacao(v.metadados)||!objetoOperacao(v.metadados.projecaoRecebida))return null;
 const p=v.metadados.projecaoRecebida;if(p.versao!==1)return null;let snapshot:SnapshotRecebida;
 if(p.formato==='reaction')snapshot=p.estado==='removida'?{versao:1,formato:'reaction',estado:'removida'}:p.estado==='emoji'&&emojiValido(p.emoji)?{versao:1,formato:'reaction',estado:'emoji',emoji:p.emoji}:{versao:1,formato:'reaction',estado:'invalida'};
 else if(p.formato==='meta_nao_suportada'||p.formato==='indisponivel')snapshot={versao:1,formato:p.formato};else return null;
 return {conteudo:textoSnapshot(snapshot),metadados:{tipoOriginal:tipoSeguro(v.metadados.tipoOriginal),projecaoRecebida:snapshot}};
}
export function textoMensagemRecebidaOperacao(v:Record<string,unknown>){
 if(typeof v.conteudo==='string'&&v.conteudo.trim())return v.conteudo;
 const projetada=normalizarProjecaoRecebidaOperacao(v);if(projetada)return projetada.conteudo;
 return objetoOperacao(v.metadados)&&v.metadados.tipoOriginal==='reaction'?AVISO_REACAO_INDISPONIVEL:AVISO_MENSAGEM_RECEBIDA_INDISPONIVEL;
}
