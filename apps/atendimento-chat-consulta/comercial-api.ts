import {ErroOperacao,type ClienteOperacao} from './operacao-api';
import type {OfertaSiteComercial,PedidoSiteComercial,PedidosComerciaisResposta,PrecoSiteComercial,ProdutoComercial,ProdutosComerciaisResposta,StatusComercial} from '../../src/lib/atendimento/comercial-tipos';
export type {ProdutoComercial,ProdutosComerciaisResposta,PedidosComerciaisResposta,StatusComercial};
type Transporte=Pick<ClienteOperacao,'consultarComercial'>;
const invalido=():never=>{throw new ErroOperacao('INVALIDO');};
function objeto(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))return invalido();return v as Record<string,unknown>;}
function texto(v:unknown,max:number){if(typeof v!=='string'||v.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v))return invalido();return v;}
function opcional(v:unknown,max:number){return v===null?null:texto(v,max);}
function numero(v:unknown,min=0){if(!Number.isSafeInteger(v)||Number(v)<min)return invalido();return Number(v);}
function booleano(v:unknown){if(typeof v!=='boolean')return invalido();return v;}
function lista(v:unknown,max:number){if(!Array.isArray(v)||v.length>max)return invalido();return v;}
function instante(v:unknown){const s=texto(v,64);if(!Number.isFinite(Date.parse(s)))return invalido();return s;}
function dataOpcional(v:unknown){return v===null?null:instante(v);}
/** Defesa de apresentação. O servidor confere também identidade e host canônico. */
export function linkCompraComercial(v:unknown){
 const s=texto(v,2048);let u:URL;try{u=new URL(s);}catch{return invalido();}
 if(u.protocol!=='https:'||u.username||u.password||u.port||!['grazingtable.com.br','www.grazingtable.com.br'].includes(u.hostname)||/^\/(?:wp-admin|wp-json|wp-login|checkout|carrinho|cart)(?:\/|\.|$)/i.test(u.pathname)||[...u.searchParams.keys()].some(k=>/^(?:preview|key|order-pay|pay_for_order|add-to-cart|consumer_key|consumer_secret)$/i.test(k)))return invalido();return u.href;
}
function imagem(v:unknown){if(v===null)return null;const s=texto(v,2048);let u:URL;try{u=new URL(s);}catch{return invalido();}if(u.protocol!=='https:'||u.username||u.password||u.port)return invalido();return u.href;}
function preco(v:unknown):PrecoSiteComercial|null{
 if(v===null)return null;const p=objeto(v),moeda=texto(p.moeda,3),valor=texto(p.valor,20),ate=p.ate===undefined?undefined:texto(p.ate,20);if(!/^[A-Z]{3}$/.test(moeda)||!/^\d{1,10}(?:\.\d{1,4})?$/.test(valor)||ate!==undefined&&!/^\d{1,10}(?:\.\d{1,4})?$/.test(ate)||!['fixo','a_partir','faixa'].includes(String(p.tipo))||p.tipo==='faixa'&&(ate===undefined||Number(ate)<Number(valor)))return invalido();return {moeda,valor,...(ate===undefined?{}:{ate}),tipo:p.tipo as PrecoSiteComercial['tipo']};
}
function oferta(v:unknown):OfertaSiteComercial|null{
 if(v===null)return null;const o=objeto(v);if(!['simples','variavel','variacao'].includes(String(o.tipo)))return invalido();return {produtoId:numero(o.produtoId,1),variacaoId:o.variacaoId===null?null:numero(o.variacaoId,1),sku:texto(o.sku,200),url:linkCompraComercial(o.url),imagemUrl:imagem(o.imagemUrl),tipo:o.tipo as OfertaSiteComercial['tipo'],preco:preco(o.preco),compravel:booleano(o.compravel),disponibilidade:opcional(o.disponibilidade,200),consultadoEm:instante(o.consultadoEm)};
}
function produto(v:unknown):ProdutoComercial{
 const p=objeto(v),f=objeto(p.fonteHub),a=objeto(p.vinculo);if(!['confirmado','pendente','ambiguo','divergente'].includes(String(a.estado)))return invalido();return {hubId:texto(p.hubId,128),nome:texto(p.nome,200),especificacao:texto(p.especificacao,4000),motivo:texto(p.motivo,1000),fonteHub:{id:texto(f.id,128),versao:opcional(f.versao,100),consultadoEm:instante(f.consultadoEm)},vinculo:{estado:a.estado as ProdutoComercial['vinculo']['estado'],motivo:opcional(a.motivo,500)},oferta:oferta(p.oferta)};
}
function pedido(v:unknown):PedidoSiteComercial{
 const p=objeto(v),s=objeto(p.status);if(!['entrega','retirada','nao_informada'].includes(String(p.modalidadeEntrega)))return invalido();return {numero:texto(p.numero,80),data:instante(p.data),status:{codigo:texto(s.codigo,100),rotulo:texto(s.rotulo,150),interpretacao:opcional(s.interpretacao,500)},itens:lista(p.itens,100).map(v=>{const i=objeto(v);return {nome:texto(i.nome,200),quantidade:numero(i.quantidade,1)};}),modalidadeEntrega:p.modalidadeEntrega as PedidoSiteComercial['modalidadeEntrega'],agendamento:opcional(p.agendamento,300),rastreio:opcional(p.rastreio,500),consultadoEm:instante(p.consultadoEm)};
}
export function criarClienteComercial(cliente:Transporte){
 return {
  async comercialStatus(signal?:AbortSignal):Promise<StatusComercial>{const d=objeto(await cliente.consultarComercial('/comercial/status',signal));if(!['conectado','parcial','indisponivel','nao_configurado'].includes(String(d.estado)))return invalido();return {estado:d.estado as StatusComercial['estado'],ultimoSucessoEm:dataOpcional(d.ultimoSucessoEm),ultimaTentativaEm:dataOpcional(d.ultimaTentativaEm),vinculosPendentes:numero(d.vinculosPendentes),produtosVinculados:numero(d.produtosVinculados),detalhe:opcional(d.detalhe,1000)};},
  async comercialProdutos(busca:string,signal?:AbortSignal):Promise<ProdutosComerciaisResposta>{const q=texto(busca,200).trim();const d=objeto(await cliente.consultarComercial('/comercial/produtos?'+new URLSearchParams({busca:q}),signal));return {produtos:lista(d.produtos,30).map(produto),consultadoEm:instante(d.consultadoEm),avisos:lista(d.avisos,20).map(v=>texto(v,500)),mais:booleano(d.mais)};},
  async comercialPedidos(conversaId:string,numeroPedido='',signal?:AbortSignal):Promise<PedidosComerciaisResposta>{const id=texto(conversaId,128),n=texto(numeroPedido,40).trim();if(!/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/.test(id)||!(/^[A-Za-z0-9#_-]*$/.test(n)))return invalido();const q=new URLSearchParams({conversaId:id,...(n?{numero:n}:{})}),d=objeto(await cliente.consultarComercial('/comercial/pedidos?'+q,signal));if(!['consultado','verificacao_necessaria','indisponivel'].includes(String(d.estado)))return invalido();const pedidos=lista(d.pedidos,20).map(pedido);if(d.estado!=='consultado'&&pedidos.length||d.estado==='consultado'&&d.consultadoEm===null)return invalido();return {estado:d.estado as PedidosComerciaisResposta['estado'],pedidos,consultadoEm:dataOpcional(d.consultadoEm),mensagem:opcional(d.mensagem,1000)};},
 };
}
export type ClienteComercial=ReturnType<typeof criarClienteComercial>;
