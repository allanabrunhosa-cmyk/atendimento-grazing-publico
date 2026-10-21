import type {IdentidadeOperacao} from './operacao-tipos';

export type CorteMinimoChat={fase:'receber'|'teste'|'humano';destinatariosTeste:string[]};
export type EscopoChat={escopoOperacional?:'completo'|'chat_humano';corteMinimoChat?:CorteMinimoChat;painelDonatellaPreparado?:boolean};
type ConfiguracaoChat=EscopoChat&{iaAutomatica?:boolean;voz?:{sinteseHabilitada?:boolean};woocommerce?:{automacoesHabilitadas?:boolean};automacoesHabilitadas?:boolean};
export function validarEscopoChat(c:ConfiguracaoChat){
 if(c.escopoOperacional!==undefined&&!['completo','chat_humano'].includes(c.escopoOperacional))throw Error('CHAT_ESCOPO_RECUSADO');
 if(c.escopoOperacional!=='chat_humano'){
  if(c.corteMinimoChat!==undefined)throw Error('CHAT_ESCOPO_RECUSADO');
  return false;
 }
 const p=c.corteMinimoChat;
 if(!p||!['receber','teste','humano'].includes(p.fase)||!Array.isArray(p.destinatariosTeste)||p.destinatariosTeste.length>3||p.destinatariosTeste.some(t=>typeof t!=='string'||!/^[1-9]\d{7,14}$/.test(t))||new Set(p.destinatariosTeste).size!==p.destinatariosTeste.length||p.fase==='teste'&&!p.destinatariosTeste.length)throw Error('CHAT_FASE_RECUSADA');
 if(c.iaAutomatica!==false||c.voz?.sinteseHabilitada!==false||c.woocommerce?.automacoesHabilitadas!==false||c.automacoesHabilitadas===true)throw Error('CHAT_AUTOMACOES_DEVEM_ESTAR_DESARMADAS');
 if(c.painelDonatellaPreparado!==undefined&&typeof c.painelDonatellaPreparado!=='boolean'||c.painelDonatellaPreparado===true&&p.fase!=='humano')throw Error('CHAT_PAINEL_FASE_RECUSADA');
 return true;
}
/** Guarda independente de botões, worker e modo de homologação. */
export function conferirEnvioChat(c:EscopoChat,autor:string,telefone:string,i:IdentidadeOperacao){
 if(c.escopoOperacional!=='chat_humano')return;
 const p=c.corteMinimoChat;
 // Capacidade preparada não liga a IA. O serviço e o worker conferem o modo
 // persistido, a revisão da tarefa e a autoridade da conversa antes do envio.
 if(c.painelDonatellaPreparado===true&&p?.fase==='humano'&&autor==='ia'&&i.tipo==='ia'&&i.id==='service:donatella-ia')return;
 if(!p||!['teste','humano'].includes(p.fase)||autor!=='humano'||i.tipo!==undefined&&i.tipo!=='usuario')throw Error('CHAT_ENVIO_RECUSADO');
 if(p.fase==='teste'&&(!Array.isArray(p.destinatariosTeste)||!p.destinatariosTeste.includes(telefone)))throw Error('CHAT_DESTINATARIO_TESTE_RECUSADO');
}

export function escritaChatPermitida(path:string,corpo:Record<string,unknown>){
 return /^\/conversa\/[a-f0-9-]{36}\/abertura$/i.test(path)||['/contatos/editar','/contatos/criar','/contatos/iniciar-conversa','/templates/salvar','/templates/excluir','/templates/sincronizar','/atalhos/salvar','/atalhos/excluir'].includes(path)||/^\/conversa\/[a-f0-9-]{36}\/(leitura|lembrete)$/i.test(path)||['/mensagens/envio','/mensagens/tentar-novamente','/anexos','/rascunho'].includes(path)||/^\/conversa\/[a-f0-9-]{36}\/acao$/i.test(path)&&['assumir','transferir','encerrar','reabrir','nota','etiquetas','pausar'].includes(String(corpo.acao));
}

/** Amplia somente a administração da agente e o apoio interno existente. */
export function escritaPainelDonatellaPermitida(path:string,corpo:Record<string,unknown>){
 return ['/comercial/vinculos/salvar','/agente/configurar','/agente/controle','/agente/reconciliar','/agente/testar','/agente/skills/configurar','/agente/tom/configurar','/conhecimento/sugerir','/conhecimento/revisar','/conhecimento/revogar','/conhecimento/substituir','/duvidas/responder','/duvidas/assumir','/duvidas/preparar','/duvidas/enfileirar','/duvidas/encerrar','/configuracao'].includes(path)||/^\/conversa\/[a-f0-9-]{36}\/acao$/i.test(path)&&corpo.acao==='ia';
}
