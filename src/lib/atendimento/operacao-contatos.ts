import {nomeContatoOperacao} from './operacao-nomes';
import { validarIdOperacao, validarTextoOperacao, validarVersaoOperacao,type PedidoCriarContatoOperacao } from './operacao-tipos';

export type EdicaoContatoOperacao = { id:string; nome:string; email:string; descricao:string; classificacao:'cliente'|'lead'; tags:string[]; notas:string; versao:number; idempotencia:string };
export function validarCriacaoContatoOperacao(p:Record<string,unknown>):asserts p is Record<string,unknown>&PedidoCriarContatoOperacao{
 const campos=['nome','telefone','ddi','email','descricao','classificacao','idempotencia'];
 if(Object.keys(p).some(k=>!campos.includes(k)))throw Error('OPERACAO_CONTATO_CAMPO_INVALIDO');
 validarEdicaoContatoOperacao({id:p.idempotencia,nome:p.nome,email:p.email??'',descricao:p.descricao??'',classificacao:p.classificacao??'lead',tags:[],notas:'',versao:0,idempotencia:p.idempotencia});
}
export function validarEdicaoContatoOperacao(p:Record<string,unknown>):asserts p is Record<string,unknown>&EdicaoContatoOperacao {
 const campos=['id','nome','email','descricao','classificacao','tags','notas','versao','idempotencia'];
 if(Object.keys(p).some(k=>!campos.includes(k)))throw Error('OPERACAO_CONTATO_CAMPO_INVALIDO');
 validarIdOperacao(p.id);validarIdOperacao(p.idempotencia);validarVersaoOperacao(p.versao);
 validarTextoOperacao(p.nome,200);validarTextoOperacao(p.email,254,true);validarTextoOperacao(p.descricao,200,true);validarTextoOperacao(p.notas,8000,true);
 if(/[\r\n\t\x7f]/.test(p.nome+p.email+p.descricao)||p.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)||!['cliente','lead'].includes(String(p.classificacao)))throw Error('OPERACAO_CONTATO_INVALIDO');
 if(!Array.isArray(p.tags)||p.tags.length>30||p.tags.some(t=>typeof t!=='string'||!t.trim()||t.length>60||/[\x00-\x1f\x7f]/.test(t)))throw Error('OPERACAO_ETIQUETAS_INVALIDAS');
}
export function contatoDTO(v:Record<string,unknown>) {
 return {id:v.id,nome:nomeContatoOperacao(v.nome,v.nome_manual),telefone:v.telefone,email:v.email,tags:v.tags,hubClienteId:v.hub_cliente_id,descricao:v.descricao??'',classificacao:v.hub_cliente_id||v.cliente_confirmado?'cliente':v.classificacao??'lead',notas:v.notas??'',versao:Number(v.versao??1),conversaId:v.conversa_id??null,canal:typeof v.canal==='string'?v.canal:'nao_identificado'};
}
