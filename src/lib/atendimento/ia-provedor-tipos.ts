import 'server-only';

export type ProvedorIA='anthropic'|'google'|'openai';
export type ImagemIA={mime:'image/jpeg'|'image/png'|'image/webp'|'image/gif';base64:string};
export type ChamadaIA={id:string;type:'function';function:{name:string;arguments:string}};
/** Itens opacos da resposta anterior. Somente o servidor os guarda para o
 * próximo passo; não são instruções, ferramentas adicionais ou logs públicos. */
export type ContinuidadeIA={provedor:ProvedorIA;modelo:string;itens:Record<string,unknown>[]};
export type MensagemIA={role:'user'|'assistant'|'tool';content:string|null;tool_calls?:ChamadaIA[];tool_call_id?:string;continuidade?:ContinuidadeIA;imagem?:ImagemIA};
export type FerramentaIA={type:'function';function:{name:string;description:string;parameters:Record<string,unknown>}};
export type PedidoIADireta={provedor?:ProvedorIA;chave:string;modelo:string;sistema:string;mensagens:MensagemIA[];ferramentas?:FerramentaIA[];maxTokens:number;imagem?:ImagemIA;signal?:AbortSignal};
export type ConsumoIA={observado:boolean;tokensEntrada?:number;tokensSaida?:number;tokensTotal?:number;tokensCacheLeitura?:number;tokensCacheGravacao?:number;tokensRaciocinio?:number;tokensFerramentas?:number;modeloObservado?:string;respostaId?:string;requisicaoId?:string};
export type ObservacaoConsumoIA={provedor:ProvedorIA;modelo:string;resultado:'concluida'|'truncada'|'incerta'|'recusada';consumo:ConsumoIA};
export type RegistrarConsumoIA=(observacao:ObservacaoConsumoIA)=>Promise<void>|void;
export type RespostaIADireta={conteudo:string;chamadas:ChamadaIA[];truncada:boolean;modelo:string;provedor:ProvedorIA;consumo:ConsumoIA;continuidade?:ContinuidadeIA};
export class FalhaProvedorIA extends Error{
 constructor(readonly provedor:ProvedorIA,readonly modelo:string,readonly resultado:'incerto'|'recusado',readonly consumo:ConsumoIA={observado:false}){super('IA_INDISPONIVEL');this.name='FalhaProvedorIA';}
}
export function mensagemAssistenteIA(resposta:RespostaIADireta):MensagemIA{
 return {role:'assistant',content:resposta.conteudo||null,...(resposta.chamadas.length?{tool_calls:structuredClone(resposta.chamadas)}:{}),...(resposta.continuidade?{continuidade:structuredClone(resposta.continuidade)}:{})};
}
/** Continuação explícita, mesmo provedor e mesmo modelo. Preserva a imagem do
 * turno anterior e os itens nativos; não executa funções nem retransmite falhas. */
export function continuarPedidoIADireta(pedido:PedidoIADireta,resposta:RespostaIADireta,resultados:{id:string;conteudo:string}[]):PedidoIADireta{
 if(resposta.truncada||!resposta.chamadas.length||resposta.provedor!==(pedido.provedor??'anthropic')||resposta.modelo!==pedido.modelo||resultados.length!==resposta.chamadas.length||new Set(resultados.map(r=>r.id)).size!==resultados.length||resultados.some(r=>!resposta.chamadas.some(c=>c.id===r.id)||typeof r.conteudo!=='string'||r.conteudo.length>64000))throw Error('IA_CONTINUIDADE_INVALIDA');
 const mensagens=structuredClone(pedido.mensagens);if(pedido.imagem){const ultima=mensagens.at(-1);if(!ultima||ultima.role!=='user'||ultima.imagem)throw Error('IA_CONTINUIDADE_INVALIDA');ultima.imagem=structuredClone(pedido.imagem);}
 return {...pedido,imagem:undefined,mensagens:[...mensagens,mensagemAssistenteIA(resposta),...resultados.map(r=>({role:'tool' as const,tool_call_id:r.id,content:r.conteudo}))]};
}
