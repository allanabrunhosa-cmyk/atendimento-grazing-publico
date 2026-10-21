/** Projeções públicas de consulta. Não contêm credenciais, dados pessoais,
 * descrições brutas da loja ou autorização para alterar pedidos. */
export type PrecoSiteComercial={moeda:string;valor:string;ate?:string;tipo:'fixo'|'a_partir'|'faixa'};
export type OfertaSiteComercial={produtoId:number;variacaoId:number|null;sku:string;url:string;imagemUrl:string|null;tipo:'simples'|'variavel'|'variacao';preco:PrecoSiteComercial|null;compravel:boolean;disponibilidade:string|null;consultadoEm:string};
export type ProdutoComercial={hubId:string;nome:string;especificacao:string;motivo:string;fonteHub:{id:string;versao:string|null;consultadoEm:string};vinculo:{estado:'confirmado'|'pendente'|'ambiguo'|'divergente';motivo:string|null};oferta:OfertaSiteComercial|null};
export type ProdutosComerciaisResposta={produtos:ProdutoComercial[];consultadoEm:string;avisos:string[];mais:boolean};
export type PedidoSiteComercial={numero:string;data:string;status:{codigo:string;rotulo:string;interpretacao:string|null};itens:{nome:string;quantidade:number}[];modalidadeEntrega:'entrega'|'retirada'|'nao_informada';agendamento:string|null;rastreio:string|null;consultadoEm:string};
export type PedidosComerciaisResposta={estado:'consultado'|'verificacao_necessaria'|'indisponivel';pedidos:PedidoSiteComercial[];consultadoEm:string|null;mensagem:string|null};
export type StatusComercial={estado:'conectado'|'parcial'|'indisponivel'|'nao_configurado';ultimoSucessoEm:string|null;ultimaTentativaEm:string|null;vinculosPendentes:number;produtosVinculados:number;detalhe:string|null};
