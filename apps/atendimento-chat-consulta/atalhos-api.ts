import {ErroOperacao,limparTextoOperacao} from './operacao-api';

export const LIMITE_NOME_ATALHO=50,LIMITE_TEXTO_ATALHO=4096,LIMITE_ATALHOS=200;
export type AtalhoTextoOperacao={id:string;nome:string;texto:string};
export type ListaAtalhosOperacao={versao:number;registros:AtalhoTextoOperacao[]};
export type PedidoSalvarAtalho={id?:string;nome:string;texto:string;versao:number;idempotencia:string};
export type PedidoExcluirAtalho={id:string;versao:number;idempotencia:string};
export type ClienteAtalhosOperacao={consultarAtalhos:(signal?:AbortSignal)=>Promise<unknown>;alterarAtalho:(caminho:'/atalhos/salvar'|'/atalhos/excluir',dados:PedidoSalvarAtalho|PedidoExcluirAtalho)=>Promise<unknown>};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,nomeValido=/^[a-z0-9][a-z0-9_-]{0,49}$/;
function objeto(v:unknown){if(!v||typeof v!=='object'||Array.isArray(v))throw new ErroOperacao('INVALIDO');return v as Record<string,unknown>;}
function versao(v:unknown){if(!Number.isSafeInteger(v)||Number(v)<0)throw new ErroOperacao('INVALIDO');return Number(v);}
function registro(v:unknown):AtalhoTextoOperacao{const r=objeto(v);if(typeof r.id!=='string'||!uuid.test(r.id)||typeof r.nome!=='string'||!nomeValido.test(r.nome)||typeof r.texto!=='string'||!r.texto.trim()||r.texto.length>LIMITE_TEXTO_ATALHO||limparTextoOperacao(r.texto,LIMITE_TEXTO_ATALHO)!==r.texto)throw new ErroOperacao('INVALIDO');return {id:r.id,nome:r.nome,texto:r.texto};}
export function normalizarNomeAtalho(v:string){return v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s/g,'-').replace(/[^a-z0-9_-]/g,'').replace(/^[-_]+/,'').slice(0,LIMITE_NOME_ATALHO);}
export function validarListaAtalhos(v:unknown):ListaAtalhosOperacao{const r=objeto(v);if(!Array.isArray(r.registros)||r.registros.length>LIMITE_ATALHOS)throw new ErroOperacao('INVALIDO');const registros=r.registros.map(registro);if(new Set(registros.map(a=>a.id)).size!==registros.length||new Set(registros.map(a=>a.nome)).size!==registros.length)throw new ErroOperacao('INVALIDO');return {versao:versao(r.versao),registros};}
export async function salvarAtalho(cliente:ClienteAtalhosOperacao,pedido:PedidoSalvarAtalho):Promise<{versao:number;atalho:AtalhoTextoOperacao}>{const resposta=await cliente.alterarAtalho('/atalhos/salvar',pedido);try{const r=objeto(resposta),atalho=registro(r.atalho),novaVersao=versao(r.versao);if(novaVersao<=pedido.versao||pedido.id&&atalho.id!==pedido.id||atalho.nome!==pedido.nome||atalho.texto!==pedido.texto)throw new Error();return {versao:novaVersao,atalho};}catch{throw new ErroOperacao('RESULTADO_INCERTO');}}
export async function excluirAtalho(cliente:ClienteAtalhosOperacao,pedido:PedidoExcluirAtalho):Promise<{versao:number;id:string}>{const resposta=await cliente.alterarAtalho('/atalhos/excluir',pedido);try{const r=objeto(resposta),novaVersao=versao(r.versao);if(r.id!==pedido.id||novaVersao<=pedido.versao)throw new Error();return {versao:novaVersao,id:pedido.id};}catch{throw new ErroOperacao('RESULTADO_INCERTO');}}
