import {objetoOperacao,validarIdOperacao,validarVersaoOperacao} from './operacao-tipos';

export type AcaoLembreteConversaOperacao='agendar'|'reagendar'|'atualizar'|'concluir'|'cancelar';
export type PedidoLembreteConversaOperacao={acao:AcaoLembreteConversaOperacao;idempotencia:string;versao:number;lembreteId?:string;agendadoPara?:string;descricao?:string};
export type LembreteConversaOperacao={id:string;agendadoPara:string;descricao:string;versao:number;atrasado:boolean;conferidoEm:string;criadoPorId:string;criadoPorNome:string};
const descricaoValida=(v:unknown):v is string=>typeof v==='string'&&v.length<=1000&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v);

/** O navegador informa um instante UTC. O relógio de referência vem do PostgreSQL. */
export function validarPedidoLembreteConversaOperacao(p:Record<string,unknown>):asserts p is Record<string,unknown>&PedidoLembreteConversaOperacao{
 if(Object.keys(p).some(k=>!['acao','idempotencia','versao','lembreteId','agendadoPara','descricao'].includes(k))||!['agendar','reagendar','atualizar','concluir','cancelar'].includes(String(p.acao)))throw Error('OPERACAO_LEMBRETE_INVALIDO');
 if(p.descricao!==undefined&&!descricaoValida(p.descricao)||p.acao==='atualizar'&&p.descricao===undefined||['concluir','cancelar'].includes(String(p.acao))&&p.descricao!==undefined)throw Error('OPERACAO_LEMBRETE_DESCRICAO_INVALIDA');
 validarIdOperacao(p.idempotencia);validarVersaoOperacao(p.versao);
 if(p.acao==='agendar'){if(p.versao!==0||p.lembreteId!==undefined)throw Error('OPERACAO_LEMBRETE_INVALIDO');}
 else{validarIdOperacao(p.lembreteId);if(Number(p.versao)<1)throw Error('OPERACAO_LEMBRETE_INVALIDO');}
 if(p.acao==='agendar'||p.acao==='reagendar'){
  if(typeof p.agendadoPara!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(p.agendadoPara))throw Error('OPERACAO_LEMBRETE_DATA_INVALIDA');
  const instante=Date.parse(p.agendadoPara);if(!Number.isFinite(instante))throw Error('OPERACAO_LEMBRETE_DATA_INVALIDA');
  const canonico=p.agendadoPara.includes('.')?p.agendadoPara.replace(/\.(\d{1,3})Z$/,(_,ms:string)=>'.'+ms.padEnd(3,'0')+'Z'):p.agendadoPara.replace('Z','.000Z');
  if(new Date(instante).toISOString()!==canonico)throw Error('OPERACAO_LEMBRETE_DATA_INVALIDA');
 }else if(p.agendadoPara!==undefined)throw Error('OPERACAO_LEMBRETE_INVALIDO');
}
export function validarPrazoLembreteConversaOperacao(agendadoPara:string,agora:Date){
 const diferenca=Date.parse(agendadoPara)-agora.getTime();if(!Number.isFinite(diferenca)||diferenca<60000||diferenca>365*86400000)throw Error('OPERACAO_LEMBRETE_PRAZO_INVALIDO');
}
export function lerLembreteConversaDTO(v:unknown):LembreteConversaOperacao|null{
 if(v===null||v===undefined)return null;
 if(!objetoOperacao(v)||typeof v.id!=='string'||typeof v.agendadoPara!=='string'||typeof v.conferidoEm!=='string'||typeof v.atrasado!=='boolean'||!Number.isSafeInteger(v.versao)||Number(v.versao)<1||typeof v.criadoPorId!=='string'||typeof v.criadoPorNome!=='string')throw Error('OPERACAO_LEMBRETE_DADOS_INVALIDOS');
 const descricao=v.descricao===undefined?'':v.descricao;if(!descricaoValida(descricao))throw Error('OPERACAO_LEMBRETE_DADOS_INVALIDOS');
 return {id:v.id,agendadoPara:v.agendadoPara,descricao,versao:Number(v.versao),atrasado:v.atrasado,conferidoEm:v.conferidoEm,criadoPorId:v.criadoPorId,criadoPorNome:v.criadoPorNome};
}
/** Alias interno fixo. A projeção usa o mesmo relógio para vencimento e conferência. */
export const projecaoLembreteConversaSQL=`jsonb_build_object('id',l.id,'agendadoPara',to_char(l.agendado_para AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'descricao',l.descricao,'versao',l.versao,'atrasado',l.agendado_para<=statement_timestamp(),'conferidoEm',to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'criadoPorId',l.criado_por_id,'criadoPorNome',l.criado_por_nome)`;
export const lembreteConversaSQL=`(SELECT ${projecaoLembreteConversaSQL} FROM atendimento_operacao.lembrete_conversa l WHERE l.conversa_id=v.id AND l.estado='pendente') AS lembrete`;
