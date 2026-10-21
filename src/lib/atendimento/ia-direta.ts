import 'server-only';
import {responderAnthropicIA} from './ia-provedor-anthropic';
import {responderOpenAIIA} from './ia-provedor-openai';
import {responderGoogleIA} from './ia-provedor-google';
import type {PedidoIADireta,RespostaIADireta} from './ia-provedor-tipos';
export type {ImagemIA,ProvedorIA,PedidoIADireta,RespostaIADireta,ConsumoIA,ObservacaoConsumoIA,RegistrarConsumoIA,MensagemIA,ChamadaIA,FerramentaIA,ContinuidadeIA} from './ia-provedor-tipos';
export {mensagemAssistenteIA,continuarPedidoIADireta,FalhaProvedorIA} from './ia-provedor-tipos';
export {modeloCompativelIA} from './ia-provedor-comum';

/** O padrão mantém a Anthropic existente. Seleção explícita usa endpoint e
 * credencial próprios; nenhum fallback, retry, ferramenta ou envio externo. */
export async function responderIADireta(pedido:PedidoIADireta,fetchImpl:typeof fetch=fetch):Promise<RespostaIADireta>{
 switch(pedido.provedor??'anthropic'){
  case 'anthropic':return responderAnthropicIA(pedido,fetchImpl);
  case 'google':return responderGoogleIA(pedido,fetchImpl);
  case 'openai':return responderOpenAIIA(pedido,fetchImpl);
  default:throw Error('IA_PROVEDOR_INVALIDO');
 }
}
