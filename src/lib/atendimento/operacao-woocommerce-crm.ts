import 'server-only';
import {createHash,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {RepositorioOperacaoPg} from './operacao-repositorio-pg';
import {hashWoo,analisarPedidoWoo,IDENTIDADE_AUTOMACAO_WOO,type ConfiguracaoAutomacoesWoo} from './operacao-woocommerce-automacoes';

type Objeto=Record<string,unknown>;
const objeto=(v:unknown):v is Objeto=>!!v&&typeof v==='object'&&!Array.isArray(v);
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export type RegraCrmWoo={id:string;ativa:boolean;topic:'order.created'|'order.updated';logica:'AND'|'OR';estados:string[];etapaId:string;delayMinutos:0;cooldownHoras:0;cancelIfChanged:true};
export function normalizarRegraCrmWoo(v:unknown):RegraCrmWoo{
 if(!objeto(v)||typeof v.id!=='string'||!uuid.test(v.id)||!['order.created','order.updated'].includes(String(v.trigger_topic))||v.action_type!=='crm_update'||typeof v.active!=='boolean'||v.delay_minutes!==0||v.cooldown_hours!==0||v.cancel_if_changed!==true||!objeto(v.action_config)||Object.keys(v.action_config).some(k=>k!=='move_deal_stage_id')||typeof v.action_config.move_deal_stage_id!=='string'||!uuid.test(v.action_config.move_deal_stage_id)||!objeto(v.filters)||!['AND','OR'].includes(String(v.filters.logic))||!Array.isArray(v.filters.conditions))throw Error('WOO_CRM_REGRA_FORA_ESCOPO');
 const condicoes=v.filters.conditions;
 if(condicoes.length<1||condicoes.length>2||condicoes.some(c=>!objeto(c)||c.field!=='status'||c.operator!=='changed_to'||!['pending','cancelled','retirado-entrega','processing','completed'].includes(String(c.value))))throw Error('WOO_CRM_REGRA_FORA_ESCOPO');
 const estados=condicoes.map(c=>String((c as Objeto).value)),paga=v.trigger_topic==='order.updated'&&v.filters.logic==='OR'&&hashWoo([...estados].sort())===hashWoo(['completed','processing']);
 const unica=v.filters.logic==='AND'&&estados.length===1&&(v.trigger_topic==='order.created'&&estados[0]==='pending'||v.trigger_topic==='order.updated'&&['cancelled','retirado-entrega'].includes(estados[0]));
 if(!paga&&!unica)throw Error('WOO_CRM_REGRA_FORA_ESCOPO');
 return {id:v.id,ativa:v.active,topic:v.trigger_topic as RegraCrmWoo['topic'],logica:v.filters.logic as 'AND'|'OR',estados,etapaId:v.action_config.move_deal_stage_id,delayMinutos:0,cooldownHoras:0,cancelIfChanged:true};
}
const alvo=(r:RegraCrmWoo,s:string)=>r.logica==='OR'?r.estados.includes(s):r.estados.every(x=>x===s);
const transicao=(r:RegraCrmWoo,s:string,anterior:string|null)=>alvo(r,s)&&anterior!==s;
export async function programarCrmWooTx(tx:PoolClient,p:{empresaId:string;externalId:string;eventId:string;topic:string;status:string;anterior:string|null;payload:Objeto;agora:Date}){
 const regras=(await tx.query<{id:string;conteudo:RegraCrmWoo;hash:string}>('SELECT id,conteudo,hash FROM atendimento_operacao.woo_crm_regra WHERE empresa_id=$1 ORDER BY id FOR SHARE',[p.empresaId])).rows;let agendadas=0;
 for(const linha of regras){const r=linha.conteudo;if(linha.hash!==hashWoo(r))throw Error('WOO_CRM_REGRA_DIVERGENTE');
  if(!alvo(r,p.status))await tx.query("UPDATE atendimento_operacao.woo_crm_execucao SET estado='cancelada',codigo='STATUS_ALTERADO',atualizada_em=now() WHERE empresa_id=$1 AND external_id=$2 AND regra_id=$3 AND estado='pendente'",[p.empresaId,p.externalId,r.id]);
  if(!r.ativa||!(r.topic===p.topic||p.topic==='order.created'&&r.topic==='order.updated')||!transicao(r,p.status,p.anterior))continue;
  const q=await tx.query('INSERT INTO atendimento_operacao.woo_crm_execucao(id,empresa_id,regra_id,external_id,event_id,target_signature,regra_hash,payload,executar_em) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) ON CONFLICT(empresa_id,regra_id,external_id,target_signature) DO NOTHING',[randomUUID(),p.empresaId,r.id,p.externalId,p.eventId,r.estados.map(s=>'status='+s).sort().join('&'),linha.hash,JSON.stringify(p.payload),p.agora.toISOString()]);agendadas+=q.rowCount??0;
 }
 return agendadas;
}
export async function processarCrmWooProxima(op:{repo:RepositorioOperacaoPg;empresaId:string;canalNumeroId:string;configuracao:()=>ConfiguracaoAutomacoesWoo;agora:()=>Date}){
 const cfg=op.configuracao();if(!cfg.habilitado||cfg.modo!=='operacao'||cfg.autoridade!=='vps'||!cfg.enviosHabilitados)return {estado:'desarmado'} as const;
 return op.repo.transacao(async tx=>{
  const db=(await tx.query('SELECT current_database() nome')).rows[0]?.nome;if(!['donatella_operacao','donatella_ensaio_operacao'].includes(db)||cfg.ficticio===true&&db!=='donatella_ensaio_operacao')throw Error('WOO_CRM_BANCO_RECUSADO');
  if(!await op.repo.autorizar(IDENTIDADE_AUTOMACAO_WOO,'atender',tx))return {estado:'desarmado'} as const;
  const candidato=(await tx.query<{id:string;external_id:string}>("SELECT id,external_id FROM atendimento_operacao.woo_crm_execucao WHERE empresa_id=$1 AND estado='pendente' AND executar_em<=$2 ORDER BY executar_em,id LIMIT 1",[op.empresaId,op.agora().toISOString()])).rows[0];if(!candidato)return {estado:'sem_pendencia'} as const;
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['woo:'+op.empresaId+':'+candidato.external_id]);
  const e=(await tx.query<{id:string;regra_id:string;external_id:string;event_id:string;regra_hash:string;payload:Objeto}>("SELECT * FROM atendimento_operacao.woo_crm_execucao WHERE id=$1 AND estado='pendente' FOR UPDATE SKIP LOCKED",[candidato.id])).rows[0];if(!e)return {estado:'sem_pendencia'} as const;
  const terminar=async(estado:'cancelada'|'ignorada',codigo:string)=>{await tx.query('UPDATE atendimento_operacao.woo_crm_execucao SET estado=$2,codigo=$3,atualizada_em=now() WHERE id=$1',[e.id,estado,codigo]);return {estado,codigo} as const;};
  const linha=(await tx.query<{conteudo:RegraCrmWoo;hash:string}>('SELECT conteudo,hash FROM atendimento_operacao.woo_crm_regra WHERE empresa_id=$1 AND id=$2 FOR SHARE',[op.empresaId,e.regra_id])).rows[0];if(!linha||!linha.conteudo.ativa||linha.hash!==hashWoo(linha.conteudo)||linha.hash!==e.regra_hash)return terminar('cancelada','REGRA_ALTERADA');const r=linha.conteudo;
  const pedido=(await tx.query('SELECT status,contato_id,contato_origem_id,conteudo FROM atendimento_operacao.woo_pedido WHERE empresa_id=$1 AND external_id=$2',[op.empresaId,e.external_id])).rows[0];if(!pedido||!alvo(r,pedido.status))return terminar('cancelada','STATUS_ALTERADO');
  const evento=(await tx.query<{raw:Buffer;payload_hash:string;estado:string}>('SELECT raw,payload_hash,estado FROM atendimento_operacao.woo_evento WHERE id=$1 AND empresa_id=$2',[e.event_id,op.empresaId])).rows[0];
  if(!evento||evento.estado!=='processado'||createHash('sha256').update(evento.raw).digest('hex')!==evento.payload_hash||hashWoo(JSON.parse(evento.raw.toString('utf8')))!==hashWoo(e.payload))return terminar('cancelada','EVENTO_DIVERGENTE');
  if(!(await tx.query('SELECT 1 FROM atendimento_operacao.etapa WHERE id=$1',[r.etapaId])).rowCount)return terminar('cancelada','ETAPA_AUSENTE');
  const p=analisarPedidoWoo(pedido.conteudo);let contatoId=pedido.contato_id as string|null;
  if(pedido.contato_origem_id&&!contatoId)return terminar('ignorada','VINCULO_ORIGINAL_AUSENTE');
  // O vínculo original do pedido tem precedência. Sem ele, só identidade do
  // canal autenticado; números/nome parecidos nunca criam ou mesclam pessoas.
  if(!contatoId&&p.telefone)contatoId=(await tx.query('SELECT id FROM atendimento_operacao.contato WHERE identidade_canal=$1',[`whatsapp:${op.canalNumeroId}:${p.telefone}`])).rows[0]?.id??null;
  if(!contatoId)return terminar('ignorada','CONTATO_EXISTENTE_AUSENTE');
  const negocio=(await tx.query('SELECT id,etapa_id,versao FROM atendimento_operacao.negocio WHERE contato_id=$1 ORDER BY criada_em DESC,id DESC LIMIT 1 FOR UPDATE',[contatoId])).rows[0];if(!negocio)return terminar('ignorada','NEGOCIO_EXISTENTE_AUSENTE');
  const atualCfg=op.configuracao();if(!atualCfg.habilitado||atualCfg.modo!=='operacao'||atualCfg.autoridade!=='vps'||!atualCfg.enviosHabilitados)return {estado:'desarmado'} as const;
  if(negocio.etapa_id!==r.etapaId){await tx.query('UPDATE atendimento_operacao.negocio SET etapa_id=$2,versao=versao+1,atualizada_em=now() WHERE id=$1',[negocio.id,r.etapaId]);await op.repo.auditar(tx,IDENTIDADE_AUTOMACAO_WOO,negocio.id,'woo_crm_mover_etapa',Number(negocio.versao)+1);}
  await tx.query("UPDATE atendimento_operacao.woo_crm_execucao SET estado='aplicada',codigo=$2,negocio_id=$3,etapa_id=$4,aplicada_em=now(),atualizada_em=now() WHERE id=$1",[e.id,negocio.etapa_id===r.etapaId?'ETAPA_PRESERVADA':'ETAPA_ALTERADA',negocio.id,r.etapaId]);return {estado:'aplicada'} as const;
 });
}
