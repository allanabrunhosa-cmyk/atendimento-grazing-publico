import 'server-only';
import {createHash,createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {RepositorioOperacaoPg} from './operacao-repositorio-pg';
import type {IdentidadeOperacao,ModoOperacao} from './operacao-tipos';
import type {IntencaoOperacao} from './operacao-envio';
import {modeloTextoSuportadoOperacao,variaveisModeloOperacao,contratoModeloOperacao} from './operacao-modelos';
import {programarCrmWooTx,processarCrmWooProxima} from './operacao-woocommerce-crm';

type Objeto=Record<string,unknown>;
const objeto=(v:unknown):v is Objeto=>!!v&&typeof v==='object'&&!Array.isArray(v);
function canonico(v:unknown):unknown{if(Array.isArray(v))return v.map(canonico);if(objeto(v))return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonico(v[k])]));return v??null;}
export const hashWoo=(v:unknown)=>createHash('sha256').update(JSON.stringify(canonico(v))).digest('hex');
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const campoTexto=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v);
export const IDENTIDADE_AUTOMACAO_WOO:IdentidadeOperacao={id:'service:donatella-woocommerce',nome:'Automações WooCommerce',perfilId:'service:donatella-woocommerce',sessaoVersao:1,permissoes:['atender'],tipo:'automacao'};
export type RegraAutomacaoWoo={id:string;ativa:boolean;modeloId:string;modeloOrigemId:string;topic:'order.updated';logica:'AND'|'OR';estados:string[];delayMinutos:0|1440;cooldownHoras:0;cancelIfChanged:true;phoneField:'billing.phone';camposVariaveis:('billing.first_name'|'id')[];headerCompartilhado:true};
export type PedidoWoo={id:string;status:string;primeiroNome:string;telefone:string|null;modificadoEm:string|null;original:Objeto};
export type ConfiguracaoAutomacoesWoo={site:string;segredo:string;webhookIds:string[];habilitado:boolean;modo:ModoOperacao;autoridade:string;enviosHabilitados:boolean;ficticio?:boolean};
type ModeloWoo={id:string;nome:string;idioma:string;estado:string;componentes:unknown};
type ExecucaoWoo={id:string;empresa_id:string;regra_id:string;external_id:string;event_id:string;target_signature:string;regra_hash:string;payload:Objeto;status_agendado:string;estado:string;intencao_id:string|null;modelo_hash:string|null;config_hash:string|null;variaveis:string[]|null;telefone:string|null};
type RegraLinha={id:string;conteudo:RegraAutomacaoWoo;hash:string;modelo_id:string};
export function normalizarRegraWoo(v:unknown,modeloId:string):RegraAutomacaoWoo{
 if(!objeto(v)||!campoTexto(v.id,36)||!uuid.test(v.id)||v.trigger_topic!=='order.updated'||v.action_type!=='whatsapp_message'||typeof v.active!=='boolean'||!objeto(v.filters)||!objeto(v.action_config)||v.cooldown_hours!==0||v.cancel_if_changed!==true)throw Error('WOO_REGRA_FORA_ESCOPO');
 const filters=v.filters,cfg=v.action_config,condicoes=filters.conditions;
 if(!Array.isArray(condicoes)||condicoes.length<1||condicoes.length>2||condicoes.some(c=>!objeto(c)||c.field!=='status'||c.operator!=='changed_to'||!['processing','completed','retirado-entrega'].includes(String(c.value)))||!['OR','AND'].includes(String(filters.logic))||cfg.phone_field!=='billing.phone'||!campoTexto(cfg.template_id,80)||!cfg.template_id||!Array.isArray(cfg.variables)||cfg.variables.length<1||cfg.variables.length>2||cfg.variables.some(c=>!['billing.first_name','id'].includes(String(c)))||!campoTexto(modeloId,80)||!modeloId)throw Error('WOO_REGRA_FORA_ESCOPO');
 const estados=condicoes.map(c=>String((c as Objeto).value)),campos=cfg.variables as RegraAutomacaoWoo['camposVariaveis'];
 const paga=filters.logic==='OR'&&hashWoo([...estados].sort())===hashWoo(['completed','processing'])&&v.delay_minutes===0&&hashWoo(campos)===hashWoo(['billing.first_name','id']);
 const retirada=filters.logic==='AND'&&estados.length===1&&estados[0]==='retirado-entrega'&&(v.delay_minutes===0&&hashWoo(campos)===hashWoo(['id'])||v.delay_minutes===1440&&hashWoo(campos)===hashWoo(['billing.first_name']));
 if(!paga&&!retirada)throw Error('WOO_REGRA_FORA_ESCOPO');
 return {id:v.id,ativa:v.active,modeloId,modeloOrigemId:cfg.template_id,topic:'order.updated',logica:filters.logic as 'AND'|'OR',estados,delayMinutos:v.delay_minutes as 0|1440,cooldownHoras:0,cancelIfChanged:true,phoneField:'billing.phone',camposVariaveis:campos,headerCompartilhado:true};
}
export function assinaturaAlvoWoo(r:RegraAutomacaoWoo){return r.estados.map(s=>'status='+s).sort().join('&');}
export function correspondeTransicaoWoo(r:RegraAutomacaoWoo,atual:string,anterior:string|null){const resultados=r.estados.map(s=>atual===s&&anterior!==s);return r.logica==='OR'?resultados.some(Boolean):resultados.every(Boolean);}
export function estadoAlvoAindaValidoWoo(r:RegraAutomacaoWoo,status:string){return r.logica==='OR'?r.estados.includes(status):r.estados.every(s=>s===status);}
export function normalizarTelefoneWoo(v:unknown,pais:unknown='BR'):string|null{
 if(!campoTexto(v,40)||!/^[+\d().\-\s]+$/.test(v))return null;
 const s=v.trim(),d=s.replace(/\D/g,'');if(s.includes('+')&&!/^\+[^+]+$/.test(s)||!/^[1-9]\d{7,14}$/.test(d))return null;
 if(s.startsWith('+'))return d;
 if(d.startsWith('55')&&[12,13].includes(d.length))return d;
 if(pais!=='BR'||![10,11].includes(d.length))return null;
 return '55'+d;
}
export function analisarPedidoWoo(v:unknown):PedidoWoo{
 if(!objeto(v)||!(typeof v.id==='number'&&Number.isSafeInteger(v.id)&&v.id>0||typeof v.id==='string'&&/^[1-9]\d{0,19}$/.test(v.id))||!campoTexto(v.status,80)||!/^[a-z0-9-]+$/.test(v.status)||!objeto(v.billing)||!campoTexto(v.billing.first_name,200))throw Error('WOO_PEDIDO_INVALIDO');
 const telefone=normalizarTelefoneWoo(v.billing.phone,v.billing.country??'BR');
 let modificadoEm:string|null=null;if(v.date_modified_gmt!==undefined&&v.date_modified_gmt!==null){if(!campoTexto(v.date_modified_gmt,40)||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z?$/.test(v.date_modified_gmt))throw Error('WOO_DATA_INVALIDA');const n=Date.parse(v.date_modified_gmt.endsWith('Z')?v.date_modified_gmt:v.date_modified_gmt+'Z');if(!Number.isFinite(n))throw Error('WOO_DATA_INVALIDA');modificadoEm=new Date(n).toISOString();}
 return {id:String(v.id),status:v.status,primeiroNome:v.billing.first_name,telefone,modificadoEm,original:v};
}
export function parametrosRegraWoo(r:RegraAutomacaoWoo,p:PedidoWoo,componentes:unknown):string[]{
 if(!modeloTextoSuportadoOperacao(componentes))throw Error('WOO_MODELO_INCOMPATIVEL');
 return variaveisModeloOperacao(componentes).map(chave=>{const n=Number(chave.replace(/^header:/,''));const campo=r.camposVariaveis[n-1];if(!campo||chave.startsWith('header:')&&!r.headerCompartilhado)throw Error('WOO_MAPA_VARIAVEL_AUSENTE');const v=campo==='id'?p.id:p.primeiroNome;if(!campoTexto(v,1024)||!v.trim())throw Error('WOO_VARIAVEL_INVALIDA');return v;});
}
function siteWoo(v:string){try{const u=new URL(v);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw Error();return u.origin+u.pathname.replace(/\/$/,'');}catch{throw Error('WOO_SITE_INVALIDO');}}
export function conferirAssinaturaWoo(raw:Buffer,headers:Record<string,string|undefined>,c:ConfiguracaoAutomacoesWoo){
 if(raw.length===0||raw.length>1048576||!campoTexto(c.segredo,2048)||!c.segredo||!Array.isArray(c.webhookIds)||!c.webhookIds.length||c.webhookIds.some(v=>!/^\d{1,20}$/.test(v)))throw Error('WOO_CONFIGURACAO_ASSINATURA_INVALIDA');
 const assinatura=headers['x-wc-webhook-signature'];if(typeof assinatura!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(assinatura)||!timingSafeEqual(Buffer.from(assinatura,'base64'),createHmac('sha256',c.segredo).update(raw).digest()))throw Error('WOO_ASSINATURA_INVALIDA');
 const webhookId=headers['x-wc-webhook-id'],deliveryId=headers['x-wc-webhook-delivery-id'],topic=headers['x-wc-webhook-topic'];
 if(typeof webhookId!=='string'||!c.webhookIds.includes(webhookId)||typeof deliveryId!=='string'||!/^[A-Za-z0-9._:-]{1,200}$/.test(deliveryId)||!['order.created','order.updated'].includes(String(topic))||typeof headers['x-wc-webhook-source']!=='string'||siteWoo(headers['x-wc-webhook-source'])!==siteWoo(c.site)||headers['x-wc-webhook-resource']!==undefined&&headers['x-wc-webhook-resource']!=='order'||headers['x-wc-webhook-event']!==undefined&&headers['x-wc-webhook-event']!==topic!.split('.')[1])throw Error('WOO_ESCOPO_WEBHOOK_INVALIDO');
 return {webhookId,deliveryId,topic:topic as 'order.created'|'order.updated'};
}
/** O ping oficial não possui HMAC e não é uma entrega. Apenas confirma HTTP;
 * não grava recibos, pedidos, tarefas ou prova de autenticação. */
export function reconhecerPingWoo(raw:Buffer,headers:Record<string,string|undefined>,webhookIds:string[]){
 if(raw.length>64||headers['x-wc-webhook-signature']!==undefined||!/^application\/x-www-form-urlencoded(?:;|$)/i.test(headers['content-type']??''))return false;
 const m=/^webhook_id=(\d{1,20})$/.exec(raw.toString('utf8'));return !!m&&webhookIds.includes(m[1]);
}
const podeReceber=(c:ConfiguracaoAutomacoesWoo)=>c.habilitado&&(c.modo==='receber'&&['nenhuma','vps'].includes(c.autoridade)||c.modo==='operacao'&&c.autoridade==='vps');
const podeExecutar=(c:ConfiguracaoAutomacoesWoo)=>podeReceber(c)&&c.modo==='operacao'&&c.enviosHabilitados;
const configHash=(c:ConfiguracaoAutomacoesWoo,numero:string)=>hashWoo({site:siteWoo(c.site),webhookIds:[...c.webhookIds].sort(),numero,ficticio:c.ficticio===true});
async function exigirBanco(tx:PoolClient,c:ConfiguracaoAutomacoesWoo){const db=(await tx.query('SELECT current_database() nome')).rows[0]?.nome;if(!['donatella_operacao','donatella_ensaio_operacao'].includes(db)||c.ficticio===true&&db!=='donatella_ensaio_operacao')throw Error('WOO_BANCO_RECUSADO');}
export class ServicoAutomacoesWoo{
 constructor(readonly op:{repo:RepositorioOperacaoPg;empresaId:string;canalNumeroId:string;configuracao:()=>ConfiguracaoAutomacoesWoo;identidade?:IdentidadeOperacao;agora?:()=>Date}){if(!campoTexto(op.empresaId,100)||!op.empresaId||!/^\d{5,30}$/.test(op.canalNumeroId))throw Error('WOO_SERVICO_CONFIGURACAO_INVALIDA');}
 private get identidade(){return this.op.identidade??IDENTIDADE_AUTOMACAO_WOO;}
 private agora(){return this.op.agora?.()??new Date();}
 async receber(raw:Buffer,headers:Record<string,string|undefined>){
  const cfg=this.op.configuracao();if(reconhecerPingWoo(raw,headers,cfg.webhookIds))return {estado:'ping_nao_autenticado',agendadas:0} as const;if(!podeReceber(cfg))throw Error('WOO_RECEPCAO_DESARMADA');
  const h=conferirAssinaturaWoo(raw,headers,cfg);let parsed:unknown;try{parsed=JSON.parse(raw.toString('utf8'));}catch{throw Error('WOO_JSON_INVALIDO');}const p=analisarPedidoWoo(parsed),payloadHash=createHash('sha256').update(raw).digest('hex');
  return this.op.repo.transacao(async tx=>{
   await exigirBanco(tx,cfg);await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['woo:'+this.op.empresaId+':'+p.id]);
   const anteriorEvento=(await tx.query('SELECT payload_hash FROM atendimento_operacao.woo_evento WHERE empresa_id=$1 AND webhook_id=$2 AND delivery_id=$3',[this.op.empresaId,h.webhookId,h.deliveryId])).rows[0];if(anteriorEvento){if(anteriorEvento.payload_hash!==payloadHash)throw Error('WOO_ENTREGA_DIVERGENTE');return {estado:'duplicado',agendadas:0} as const;}
   if((await tx.query('SELECT 1 FROM atendimento_operacao.woo_evento WHERE empresa_id=$1 AND topic=$2 AND external_id=$3 AND payload_hash=$4',[this.op.empresaId,h.topic,p.id,payloadHash])).rowCount)return {estado:'duplicado',agendadas:0} as const;
   const anterior=(await tx.query('SELECT status,ultimo_status_processado,modificado_em FROM atendimento_operacao.woo_pedido WHERE empresa_id=$1 AND external_id=$2 FOR UPDATE',[this.op.empresaId,p.id])).rows[0];
   const antigo=!!(p.modificadoEm&&anterior?.modificado_em&&Date.parse(p.modificadoEm)<new Date(anterior.modificado_em).getTime()),eventId=randomUUID();
   await tx.query('INSERT INTO atendimento_operacao.woo_evento(id,empresa_id,webhook_id,delivery_id,topic,external_id,payload_hash,raw,estado,status_anterior) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[eventId,this.op.empresaId,h.webhookId,h.deliveryId,h.topic,p.id,payloadHash,raw,antigo?'antigo':'processado',anterior?.ultimo_status_processado??null]);if(antigo)return {estado:'antigo',agendadas:0} as const;
   await tx.query('INSERT INTO atendimento_operacao.woo_pedido(empresa_id,external_id,status,ultimo_status_processado,conteudo,modificado_em,importado,ultimo_evento_id) VALUES($1,$2,$3,$3,$4::jsonb,$5,false,$6) ON CONFLICT(empresa_id,external_id) DO UPDATE SET status=excluded.status,ultimo_status_processado=excluded.ultimo_status_processado,conteudo=excluded.conteudo,modificado_em=coalesce(excluded.modificado_em,atendimento_operacao.woo_pedido.modificado_em),importado=false,ultimo_evento_id=excluded.ultimo_evento_id,versao=atendimento_operacao.woo_pedido.versao+1,atualizado_em=now()',[this.op.empresaId,p.id,p.status,JSON.stringify(p.original),p.modificadoEm,eventId]);
   const regras=(await tx.query<RegraLinha>('SELECT id,conteudo,hash,modelo_id FROM atendimento_operacao.woo_regra WHERE empresa_id=$1 ORDER BY id FOR SHARE',[this.op.empresaId])).rows;let agendadas=0;
   for(const linha of regras){const r=linha.conteudo;if(linha.hash!==hashWoo(r))throw Error('WOO_REGRA_DIVERGENTE');
    if(!estadoAlvoAindaValidoWoo(r,p.status))await this.cancelarPedidoTx(tx,p.id,r.id,'STATUS_ALTERADO');
    if(!r.ativa||!correspondeTransicaoWoo(r,p.status,anterior?.ultimo_status_processado??null))continue;
    const ins=await tx.query('INSERT INTO atendimento_operacao.woo_execucao(id,empresa_id,regra_id,external_id,event_id,target_signature,regra_hash,payload,status_agendado,executar_em) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10) ON CONFLICT(empresa_id,regra_id,external_id,target_signature) DO NOTHING',[randomUUID(),this.op.empresaId,r.id,p.id,eventId,assinaturaAlvoWoo(r),linha.hash,JSON.stringify(p.original),p.status,new Date(this.agora().getTime()+r.delayMinutos*60000).toISOString()]);agendadas+=ins.rowCount??0;
   }
   const agendadasCrm=await programarCrmWooTx(tx,{empresaId:this.op.empresaId,externalId:p.id,eventId,topic:h.topic,status:p.status,anterior:anterior?.ultimo_status_processado??null,payload:p.original,agora:this.agora()});
   return {estado:'preservado',agendadas,agendadasCrm} as const;
  });
 }
 private async cancelarPedidoTx(tx:PoolClient,pedido:string,regra:string,codigo:string){
  const a=await tx.query("UPDATE atendimento_operacao.woo_execucao e SET estado='cancelada',codigo=$4,atualizada_em=now() WHERE empresa_id=$1 AND external_id=$2 AND regra_id=$3 AND (estado='pendente' OR estado='enfileirada' AND EXISTS(SELECT 1 FROM atendimento_operacao.intencao i WHERE i.id=e.intencao_id AND i.estado='pendente')) RETURNING intencao_id",[this.op.empresaId,pedido,regra,codigo]);
  for(const e of a.rows)if(e.intencao_id){const canceladas=await tx.query("UPDATE atendimento_operacao.intencao SET estado='cancelado',codigo=$2,atualizada_em=now() WHERE id=$1 AND estado='pendente' RETURNING mensagem_id",[e.intencao_id,'WOO_'+codigo]);for(const m of canceladas.rows)await tx.query("UPDATE atendimento_operacao.mensagem SET estado='cancelado' WHERE id=$1",[m.mensagem_id]);}
 }
 private async eventoIntegroTx(tx:PoolClient,e:ExecucaoWoo){
  const r=(await tx.query<{raw:Buffer;payload_hash:string;estado:string}>('SELECT raw,payload_hash,estado FROM atendimento_operacao.woo_evento WHERE id=$1 AND empresa_id=$2',[e.event_id,this.op.empresaId])).rows[0];
  try{return !!r&&r.estado==='processado'&&Buffer.isBuffer(r.raw)&&createHash('sha256').update(r.raw).digest('hex')===r.payload_hash&&hashWoo(JSON.parse(r.raw.toString('utf8')))===hashWoo(e.payload);}catch{return false;}
 }
 async processarProxima(){
  const cfg=this.op.configuracao();if(!podeExecutar(cfg))return {estado:'desarmado'} as const;
  return this.op.repo.transacao(async tx=>{
   await exigirBanco(tx,cfg);if(this.identidade.id!==IDENTIDADE_AUTOMACAO_WOO.id||this.identidade.tipo!=='automacao'||!await this.op.repo.autorizar(this.identidade,'atender',tx))return {estado:'desarmado'} as const;
   const candidato=(await tx.query<{id:string;external_id:string}>("SELECT id,external_id FROM atendimento_operacao.woo_execucao WHERE empresa_id=$1 AND estado='pendente' AND executar_em<=$2 AND proxima_tentativa<=$2 ORDER BY executar_em,id LIMIT 1",[this.op.empresaId,this.agora().toISOString()])).rows[0];if(!candidato)return {estado:'sem_pendencia'} as const;
   await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['woo:'+this.op.empresaId+':'+candidato.external_id]);
   const e=(await tx.query<ExecucaoWoo>("SELECT * FROM atendimento_operacao.woo_execucao WHERE id=$1 AND estado='pendente' FOR UPDATE SKIP LOCKED",[candidato.id])).rows[0];if(!e)return {estado:'sem_pendencia'} as const;
   const cancelar=async(codigo:string)=>{await tx.query("UPDATE atendimento_operacao.woo_execucao SET estado='cancelada',codigo=$2,atualizada_em=now() WHERE id=$1",[e.id,codigo]);return {estado:'cancelada',codigo} as const;};
   const esperar=async(codigo:string)=>{await tx.query("UPDATE atendimento_operacao.woo_execucao SET codigo=$2,proxima_tentativa=$3,atualizada_em=now() WHERE id=$1",[e.id,codigo,new Date(this.agora().getTime()+60000).toISOString()]);return {estado:'bloqueada',codigo} as const;};
   const linha=(await tx.query<RegraLinha>('SELECT id,conteudo,hash,modelo_id FROM atendimento_operacao.woo_regra WHERE empresa_id=$1 AND id=$2 FOR SHARE',[this.op.empresaId,e.regra_id])).rows[0];if(!linha||!linha.conteudo.ativa||linha.hash!==hashWoo(linha.conteudo)||linha.hash!==e.regra_hash)return cancelar('REGRA_ALTERADA');const r=linha.conteudo;
   const atual=(await tx.query('SELECT status,conteudo FROM atendimento_operacao.woo_pedido WHERE empresa_id=$1 AND external_id=$2',[this.op.empresaId,e.external_id])).rows[0];if(!atual||!estadoAlvoAindaValidoWoo(r,atual.status))return cancelar('STATUS_ALTERADO');
   const modelo=(await tx.query<ModeloWoo>("SELECT id,nome,idioma,estado,componentes FROM atendimento_operacao.modelo WHERE id=$1 AND estado='APPROVED'",[r.modeloId])).rows[0];if(!modelo)return esperar('MODELO_NAO_APROVADO');
   if(!await this.eventoIntegroTx(tx,e))return cancelar('EVENTO_DIVERGENTE');
   const p=analisarPedidoWoo(e.payload);if(!p.telefone)return esperar('DESTINATARIO_AMBIGUO');if(analisarPedidoWoo(atual.conteudo).telefone!==p.telefone)return cancelar('DESTINATARIO_ALTERADO');let variaveis:string[];try{variaveis=parametrosRegraWoo(r,p,modelo.componentes);}catch{return esperar('MODELO_OU_VARIAVEIS_INCOMPATIVEIS');}
   const canal=`whatsapp:${this.op.canalNumeroId}:${p.telefone}`;await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[canal]);
   let contato=(await tx.query('SELECT id,telefone FROM atendimento_operacao.contato WHERE identidade_canal=$1',[canal])).rows[0];if(!contato){if((await this.op.repo.contatosTelefoneExatoTx(tx,p.telefone)).length)return esperar('IDENTIDADE_CONFLITO');contato=(await tx.query('INSERT INTO atendimento_operacao.contato(id,nome,telefone,identidade_canal,memoria) VALUES($1,$2,$3,$4,$5::jsonb) RETURNING id,telefone',[randomUUID(),p.primeiroNome.trim()||'Cliente WooCommerce',p.telefone,canal,JSON.stringify({origemAutenticada:'woocommerce',pedidoOrigemId:p.id})])).rows[0];}if(contato.telefone!==p.telefone)return esperar('DESTINATARIO_ALTERADO');
   let conversa=(await tx.query('SELECT id,versao,ficticia FROM atendimento_operacao.conversa WHERE contato_id=$1 AND estado<>\'encerrada\' AND ficticia=$2 ORDER BY criada_em DESC,id LIMIT 1 FOR UPDATE',[contato.id,cfg.ficticio===true])).rows[0];if(!conversa)conversa=(await tx.query('INSERT INTO atendimento_operacao.conversa(id,contato_id,estado,ficticia) VALUES($1,$2,\'ia\',$3) RETURNING id,versao,ficticia',[randomUUID(),contato.id,cfg.ficticio===true])).rows[0];
   const envio=await this.op.repo.enfileirarTx(tx,this.identidade,{conversaId:conversa.id,versao:Number(conversa.versao),idempotencia:e.id,tipo:'template',modeloId:r.modeloId,variaveis},'automacao');
   await tx.query("UPDATE atendimento_operacao.woo_execucao SET estado='enfileirada',codigo='ENFILEIRADA',intencao_id=$2,modelo_hash=$3,config_hash=$4,variaveis=$5::jsonb,telefone=$6,enfileirada_em=now(),atualizada_em=now() WHERE id=$1",[e.id,envio.id,hashWoo(contratoModeloOperacao(modelo)),configHash(cfg,this.op.canalNumeroId),JSON.stringify(variaveis),p.telefone]);await this.op.repo.auditar(tx,this.identidade,e.id,'woo_automacao_enfileirar',Number(conversa.versao));return {estado:'enfileirada',intencaoId:envio.id} as const;
  });
 }
 async validarEnvioTx(tx:PoolClient,p:IntencaoOperacao):Promise<boolean>{
  const cfg=this.op.configuracao();if(!podeExecutar(cfg)||p.autor_id!==IDENTIDADE_AUTOMACAO_WOO.id||p.conteudo.autor!=='automacao'||p.conteudo.tipo!=='template'||p.conteudo.ficticia!==(cfg.ficticio===true))return false;
  const e=(await tx.query<ExecucaoWoo>("SELECT * FROM atendimento_operacao.woo_execucao WHERE empresa_id=$1 AND intencao_id=$2 AND estado='enfileirada'",[this.op.empresaId,p.id])).rows[0];if(!e||e.telefone!==p.conteudo.telefone||e.config_hash!==configHash(cfg,this.op.canalNumeroId)||hashWoo(e.variaveis)!==hashWoo(p.conteudo.variaveis)||!await this.eventoIntegroTx(tx,e))return false;
  const r=(await tx.query<RegraLinha>('SELECT id,conteudo,hash,modelo_id FROM atendimento_operacao.woo_regra WHERE empresa_id=$1 AND id=$2',[this.op.empresaId,e.regra_id])).rows[0],atual=(await tx.query('SELECT status,conteudo FROM atendimento_operacao.woo_pedido WHERE empresa_id=$1 AND external_id=$2',[this.op.empresaId,e.external_id])).rows[0];if(!r||!r.conteudo.ativa||r.hash!==e.regra_hash||r.hash!==hashWoo(r.conteudo)||!atual||!estadoAlvoAindaValidoWoo(r.conteudo,atual.status)||r.conteudo.modeloId!==p.conteudo.modeloId)return false;
  const m=(await tx.query<ModeloWoo>("SELECT id,nome,idioma,estado,componentes FROM atendimento_operacao.modelo WHERE id=$1 AND estado='APPROVED'",[r.conteudo.modeloId])).rows[0];if(!m||e.modelo_hash!==hashWoo(contratoModeloOperacao(m)))return false;
  try{return analisarPedidoWoo(atual.conteudo).telefone===p.conteudo.telefone&&hashWoo(parametrosRegraWoo(r.conteudo,analisarPedidoWoo(e.payload),m.componentes))===hashWoo(p.conteudo.variaveis);}catch{return false;}
 }
 async validarEnvio(p:IntencaoOperacao){if(!podeExecutar(this.op.configuracao()))return false;return this.op.repo.transacao(tx=>this.validarEnvioTx(tx,p));}
 async processarCrmProxima(){return processarCrmWooProxima({...this.op,agora:()=>this.agora()});}
 async status(){return this.op.repo.transacao(async tx=>({habilitado:this.op.configuracao().habilitado,assinaturaConfigurada:!!this.op.configuracao().segredo,webhookIdsConfigurados:this.op.configuracao().webhookIds.length,enviosLiberados:podeExecutar(this.op.configuracao()),regras:(await tx.query('SELECT ((SELECT count(*) FROM atendimento_operacao.woo_regra WHERE empresa_id=$1)+(SELECT count(*) FROM atendimento_operacao.woo_crm_regra WHERE empresa_id=$1))::int quantidade',[this.op.empresaId])).rows[0]?.quantidade??0,pendencias:(await tx.query('SELECT estado,codigo,count(*)::int quantidade,min(executar_em) mais_antiga FROM (SELECT estado,codigo,executar_em FROM atendimento_operacao.woo_execucao WHERE empresa_id=$1 UNION ALL SELECT estado,codigo,executar_em FROM atendimento_operacao.woo_crm_execucao WHERE empresa_id=$1) filas GROUP BY estado,codigo ORDER BY estado,codigo',[this.op.empresaId])).rows,ultimaRecepcao:(await tx.query('SELECT max(recebido_em) em FROM atendimento_operacao.woo_evento WHERE empresa_id=$1',[this.op.empresaId])).rows[0]?.em??null}));}
}
