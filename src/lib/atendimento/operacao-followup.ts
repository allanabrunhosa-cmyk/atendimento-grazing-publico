import 'server-only';
import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {IdentidadeOperacao} from './operacao-tipos';
import type {RepositorioOperacaoPg} from './operacao-repositorio-pg';
import type {IntencaoOperacao} from './operacao-envio';
import type {TarefaIA} from './ia-orquestrador';

export type ConfiguracaoFollowup={habilitado:boolean;minutos:number;texto:string};
export function validarConfiguracaoFollowup(p:unknown):asserts p is ConfiguracaoFollowup{
 if(!p||typeof p!=='object'||Array.isArray(p))throw Error('FOLLOWUP_CONFIGURACAO_INVALIDA');
 const v=p as Record<string,unknown>;
 if(Object.keys(v).some(k=>!['habilitado','minutos','texto'].includes(k))||typeof v.habilitado!=='boolean'||!Number.isInteger(v.minutos)||Number(v.minutos)<5||Number(v.minutos)>1440||typeof v.texto!=='string'||v.texto.length>4096||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v.texto)||v.habilitado&&!v.texto.trim())throw Error('FOLLOWUP_CONFIGURACAO_INVALIDA');
}
export function hashConfiguracaoFollowup(p:ConfiguracaoFollowup){return createHash('sha256').update(JSON.stringify([p.habilitado,p.minutos,p.texto])).digest('hex');}
function idEstavel(s:string){const h=createHash('sha256').update(s).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;}
export async function configuracaoFollowupTx(tx:PoolClient):Promise<{configuracao:ConfiguracaoFollowup;versao:number;origem:string}>{
 const local=(await tx.query("SELECT conteudo,versao FROM atendimento_operacao.configuracao WHERE chave='agente_followup' FOR SHARE")).rows[0];
 const legado=local?null:(await tx.query("SELECT conteudo,versao FROM atendimento_operacao.configuracao WHERE chave='agente_legado' FOR SHARE")).rows[0];
 const p=local?.conteudo??legado?.conteudo.followup??{habilitado:false,minutos:60,texto:''};validarConfiguracaoFollowup(p);
 return {configuracao:p,versao:Number(local?.versao??0),origem:local?'local':legado?'legado':'ausente'};
}
/** Apenas uma saudação nova da agente pode criar um timer. Histórico e busca
 * de conversas antigas não são disparadores. Uma linha cancelada não reabre. */
export async function agendarFollowupTx(tx:PoolClient,p:{tarefa:TarefaIA;intencaoId:string;mensagemId:string;fontes:{id:string;versao:number}[]}){
 if(!p.fontes.some(f=>f.id==='donatella_saudacao_v1'&&f.versao===1))return {agendado:false};
 const {configuracao:c}=await configuracaoFollowupTx(tx);if(!c.habilitado)return {agendado:false};
 const v=(await tx.query('SELECT estado,fila,versao FROM atendimento_operacao.conversa WHERE id=$1 FOR UPDATE',[p.tarefa.conversaId])).rows[0];
 if(!v||v.estado!=='ia'||!['novos','sales'].includes(v.fila)||Number(v.versao)!==p.tarefa.versao)return {agendado:false};
 const mensagens=await tx.query("SELECT count(*)::int n FROM atendimento_operacao.mensagem WHERE conversa_id=$1 AND autor='cliente'",[p.tarefa.conversaId]);if(mensagens.rows[0].n!==1)return {agendado:false};
 const r=await tx.query("INSERT INTO atendimento_operacao.timer(id,conversa_id,tipo,executar_em,versao_conversa,origem_mensagem_id,origem_intencao_id,conteudo) VALUES($1,$2,'welcome_followup',now()+($3::int*interval '1 minute'),$4,$5,$6,$7::jsonb) ON CONFLICT DO NOTHING RETURNING id",[idEstavel('welcome-followup:'+p.tarefa.conversaId),p.tarefa.conversaId,c.minutos,p.tarefa.versao,p.mensagemId,p.intencaoId,JSON.stringify({texto:c.texto,minutos:c.minutos,configHash:hashConfiguracaoFollowup(c),tarefaId:p.tarefa.id})]);
 if(r.rowCount===1)await tx.query("INSERT INTO atendimento_operacao.auditoria(id,autor_id,entidade_id,acao,versao) VALUES($1,$2,$3,'followup_agendar',$4)",[idEstavel('auditar-followup:'+p.tarefa.conversaId),p.tarefa.atorId,r.rows[0].id,p.tarefa.versao]);return {agendado:r.rowCount===1};
}
type TimerFollowup={id:string;conversa_id:string;versao_conversa:string;origem_mensagem_id:string;origem_intencao_id:string;intencao_id:string|null;conteudo:{texto:string;minutos:number;configHash:string;tarefaId:string}};
async function contextoFollowupTx(tx:PoolClient,t:TimerFollowup,p:{ignorarMensagemId?:string;permitirSaudacaoPendente?:boolean}={}){
 const c=(await tx.query('SELECT estado,fila,versao,ultima_cliente_em FROM atendimento_operacao.conversa WHERE id=$1 FOR UPDATE',[t.conversa_id])).rows[0];
 if(!c||c.estado!=='ia'||!['novos','sales'].includes(c.fila)||Number(c.versao)!==Number(t.versao_conversa)||!c.ultima_cliente_em||Date.now()-new Date(c.ultima_cliente_em).getTime()>86400000)return false;
 const original=(await tx.query('SELECT estado,conversa_id,mensagem_id FROM atendimento_operacao.intencao WHERE id=$1',[t.origem_intencao_id])).rows[0];if(!original||original.conversa_id!==t.conversa_id||original.mensagem_id!==t.origem_mensagem_id||!['aceito','aceito_simulado','entregue','lido'].includes(original.estado)&&!(p.permitirSaudacaoPendente&&['pendente','processando'].includes(original.estado)))return false;
 const ultima=(await tx.query('SELECT id,autor FROM atendimento_operacao.mensagem WHERE conversa_id=$1 AND ($2::uuid IS NULL OR id<>$2::uuid) ORDER BY criada_em DESC,id DESC LIMIT 1',[t.conversa_id,p.ignorarMensagemId??null])).rows[0];
 return !!ultima&&ultima.id===t.origem_mensagem_id&&ultima.autor==='ia';
}
export async function processarFollowup(repo:RepositorioOperacaoPg,i:IdentidadeOperacao,horario:(t:TarefaIA)=>Promise<boolean>,empresaId:string){
 // A consulta fora de transação não reserva nada. A autoridade, configuração,
 // versão e o envio são conferidos outra vez sob lock na transação efetiva.
 const candidato=(await repo.pool.query("SELECT t.*,a.tarefa FROM atendimento_operacao.timer t JOIN atendimento_operacao.agente_tarefa a ON a.id=(t.conteudo->>'tarefaId')::uuid JOIN atendimento_operacao.conversa c ON c.id=t.conversa_id WHERE t.tipo='welcome_followup' AND t.estado='pendente' AND t.executar_em<=now() AND a.empresa_id=$2 AND ($1='operacao' OR c.ficticia) ORDER BY t.executar_em,t.id LIMIT 1",[repo.modo(),empresaId])).rows[0];if(!candidato)return {estado:'sem_timer'} as const;
 const horarioPermitido=await horario(candidato.tarefa);
 return repo.transacao(async tx=>{
  const t=(await tx.query<TimerFollowup>("SELECT * FROM atendimento_operacao.timer WHERE id=$1 AND estado='pendente' FOR UPDATE SKIP LOCKED",[candidato.id])).rows[0];if(!t)return {estado:'timer_ocupado'} as const;
  const agente=(await tx.query("SELECT conteudo FROM atendimento_operacao.configuracao WHERE chave='agente' FOR SHARE")).rows[0]?.conteudo;
  if(!agente||agente.modo!=='automatico'||!agente.autoridadeAutomatica||!await repo.autorizar(i,'atender',tx))return {estado:'timer_desarmado'} as const;
  const cancelar=async(codigo:string)=>{await tx.query("UPDATE atendimento_operacao.timer SET estado='cancelado',codigo=$2 WHERE id=$1",[t.id,codigo]);await repo.auditar(tx,i,t.id,'followup_cancelar',Number(t.versao_conversa));return {estado:'timer_cancelado',codigo} as const;};
  const {configuracao:cfg}=await configuracaoFollowupTx(tx);if(!cfg.habilitado||hashConfiguracaoFollowup(cfg)!==t.conteudo.configHash)return cancelar('CONFIGURACAO_ALTERADA');
  if(!horarioPermitido)return cancelar('FORA_HORARIO');
  const original=(await tx.query('SELECT estado FROM atendimento_operacao.intencao WHERE id=$1',[t.origem_intencao_id])).rows[0];if(original&&['pendente','processando'].includes(original.estado)){if(!await contextoFollowupTx(tx,t,{permitirSaudacaoPendente:true}))return cancelar('CONTEXTO_ALTERADO');await tx.query("UPDATE atendimento_operacao.timer SET executar_em=now()+interval '1 minute' WHERE id=$1",[t.id]);return {estado:'aguardando_saudacao'} as const;}
  if(!await contextoFollowupTx(tx,t))return cancelar('CONTEXTO_ALTERADO');
  const envio=await repo.enfileirarTx(tx,i,{conversaId:t.conversa_id,versao:Number(t.versao_conversa),idempotencia:idEstavel('welcome-followup-envio:'+t.id),tipo:'text',texto:cfg.texto},'ia');
  await tx.query("UPDATE atendimento_operacao.timer SET estado='concluido',intencao_id=$2,codigo='ENFILEIRADO' WHERE id=$1",[t.id,envio.id]);return {estado:'timer_enfileirado',intencaoId:envio.id} as const;
 });
}
export async function validarEnvioFollowupTx(tx:PoolClient,p:IntencaoOperacao):Promise<boolean|null>{
 const t=(await tx.query<TimerFollowup>("SELECT * FROM atendimento_operacao.timer WHERE intencao_id=$1 AND tipo='welcome_followup'",[p.id])).rows[0];if(!t)return null;
 const {configuracao:cfg}=await configuracaoFollowupTx(tx);
 return cfg.habilitado&&hashConfiguracaoFollowup(cfg)===t.conteudo.configHash&&p.conteudo.texto===cfg.texto&&p.conversa_id===t.conversa_id&&Number(p.versao_conversa)===Number(t.versao_conversa)&&await contextoFollowupTx(tx,t,{ignorarMensagemId:p.mensagem_id});
}
