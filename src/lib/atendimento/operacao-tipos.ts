import type {PoolClient} from 'pg';
import type {CapacidadeAtendimento,CapacidadeLegadaAtendimento} from '../permissoes/atendimento';
export type IdentidadeOperacao={id:string;nome:string;perfilId:string;sessaoVersao:number;permissoes:string[];tipo?:'usuario'|'ia'|'automacao'};
export type AcaoOperacao=CapacidadeAtendimento|CapacidadeLegadaAtendimento;
export type AutorizarOperacao=(identidade:IdentidadeOperacao,acao:AcaoOperacao,tx?:PoolClient)=>Promise<boolean>;
export type ModoOperacao='homologacao'|'receber'|'operacao';
export type CanalConversaOperacao='whatsapp'|'instagram'|'facebook'|'nao_identificado';
export type ContagensConversaOperacao={total:number;ia:number;humano:number;pausado:number;encerrada:number;pendentesResposta?:number;conversasPendentes?:number};
export const canaisConversaOperacao:readonly CanalConversaOperacao[]=['whatsapp','instagram','facebook','nao_identificado'];
export function validarCanalConversaOperacao(canal:unknown):asserts canal is CanalConversaOperacao|undefined{if(canal!==undefined&&!canaisConversaOperacao.includes(canal as CanalConversaOperacao))throw Error('OPERACAO_CANAL_INVALIDO');}
export type PedidoEnvioOperacao={conversaId:string;versao:number;idempotencia:string;tipo:'text'|'image'|'audio'|'video'|'sticker'|'document'|'template';texto?:string;citadaId?:string;anexoId?:string;modeloId?:string;variaveis?:string[]};
export type PedidoNovaTentativaOperacao={conversaId:string;mensagemId:string;intencaoId:string;versao:number;idempotencia:string};
export type PedidoCriarContatoOperacao={nome:string;telefone:string;ddi?:string;email?:string;descricao?:string;classificacao?:'cliente'|'lead';idempotencia:string};
export type PedidoIniciarConversaContatoOperacao={contatoId:string;versaoContato:number;idempotencia:string};
export type MensagemNovaOperacao={conversaId:string;mensagemId:string;versao:number;conteudo:string;tipo:string};
export const uuidOperacao=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function validarIdOperacao(id:unknown):asserts id is string{if(typeof id!=='string'||!uuidOperacao.test(id))throw Error('OPERACAO_ID_INVALIDO');}
export function validarTextoOperacao(s:unknown,max:number,vazio=false):asserts s is string{if(typeof s!=='string'||s.length>max||(!vazio&&!s.trim())||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(s))throw Error('OPERACAO_ENTRADA_INVALIDA');}
export function validarVersaoOperacao(v:unknown):asserts v is number{if(!Number.isSafeInteger(v)||Number(v)<0)throw Error('OPERACAO_VERSAO_INVALIDA');}
export function objetoOperacao(v:unknown):v is Record<string,unknown>{return !!v&&typeof v==='object'&&!Array.isArray(v);}
