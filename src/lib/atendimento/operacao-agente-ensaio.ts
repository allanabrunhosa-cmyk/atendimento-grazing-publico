import 'server-only';
import type {ProdutoComercial} from './comercial-tipos';
import type {FerramentaIA,FonteIA,TarefaIA} from './ia-orquestrador';
import {fontesProdutosComerciais} from './operacao-comercial';

export const AVISO_ENSAIO_DONATELLA='Ensaio fictício — dados simulados; nenhuma consulta ao HUB ou à loja real.';

/** Dados exclusivos do botão de ensaio. A projeção comercial é a mesma da
 * operação, mas estes dados não recebem pool, transporte ou configuração real. */
export function fontesFerramentaEnsaio(nome:FerramentaIA,t:TarefaIA,agora=Date.now()):FonteIA[]{
 if(nome==='search_products'){
  const consultadoEm=new Date(agora).toISOString();
  const produtos:ProdutoComercial[]=[1,2,4].map(pessoas=>{
   const id='produto_ensaio_'+pessoas;
   return {hubId:id,nome:`Seleção para ${pessoas} — produto fictício`,especificacao:`Ensaio fictício de catálogo do HUB. Tábua de queijos e frutas. Rendimento informado: ${pessoas} ${pessoas===1?'pessoa':'pessoas'} como refeição leve. Todos os produtos e condições deste cenário são simulados. A ocasião e o tipo de refeição podem ser esclarecidos com o cliente antes da recomendação.`,motivo:'Rendimento do produto fictício informado no catálogo de ensaio.',fonteHub:{id,versao:'1',consultadoEm},vinculo:{estado:'confirmado',motivo:null},oferta:{produtoId:100+pessoas,variacaoId:null,sku:'ENSAIO-'+pessoas,url:`https://loja.example/produto/selecao-para-${pessoas}-ficticia/`,imagemUrl:null,tipo:'simples',preco:{valor:String(pessoas*60)+'.00',moeda:'BRL',tipo:'fixo'},compravel:true,disponibilidade:'instock',consultadoEm}};
  });
  return fontesProdutosComerciais(t,produtos,agora);
 }
 if(nome==='get_order')return [{id:'pedido_ensaio_ficticio',versao:1,empresaId:t.empresaId,clienteId:t.clienteId,tema:t.tema,origem:'ferramenta',estado:'aprovado',inicio:agora,fim:agora+60000,conteudo:'Ensaio fictício de pedido autorizado para o contato fictício. Pedido #ENS-1001, feito em 2026-10-01: Processando na loja (processing). Itens comprados: 1 × Seleção para 2 — produto fictício. Modalidade: retirada. Agendamento não informado. Rastreio não informado. Processando não comprova preparo físico; concluído não comprova recebimento. Todos os dados deste pedido são simulados.'}];
 // Agenda e frete continuam sem evidência neste cenário. Um catálogo
 // fictício não autoriza inventar compromissos ou condições de entrega.
 return [];
}

export function fontesConhecimentoEnsaio(t:TarefaIA,agora=Date.now()):FonteIA[]{
 return [{id:'conhecimento_ensaio_ficticio',versao:1,empresaId:t.empresaId,clienteId:t.clienteId,tema:t.tema,origem:'conhecimento',estado:'aprovado',inicio:agora,fim:agora+60000,conteudo:'Ensaio fictício de atendimento. A assistente esclarece a ocasião, a quantidade de pessoas e o tipo de refeição com o próprio cliente. Usa o rendimento descrito de cada produto para recomendar. Uma pergunta de esclarecimento não exige encaminhamento à equipe. Dúvidas importantes sem evidência e solicitações de atendimento humano seguem para apoio. Todos os dados deste cenário são simulados.'}];
}
