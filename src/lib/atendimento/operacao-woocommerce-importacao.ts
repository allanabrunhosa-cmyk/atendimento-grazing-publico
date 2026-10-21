import 'server-only';
import type {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {hashWoo,normalizarRegraWoo,parametrosRegraWoo,analisarPedidoWoo} from './operacao-woocommerce-automacoes';
import {normalizarRegraCrmWoo} from './operacao-woocommerce-crm';
import {criarBaselineWoo,conferirBaselineWoo,reconciliarRegrasCongeladasWoo,type BaselineRegrasWoo,type MarcoFinalWoo} from './operacao-woocommerce-baseline';

/** Configuração e estado-base da cópia; nenhuma fila histórica ou ação. */
export async function importarAutomacoesWoo(origem:Pool,destino:Pool,empresaId:string,op:{baseline?:BaselineRegrasWoo;marcoFinal?:MarcoFinalWoo}={}){
 const entrada=await origem.connect(),saida=await destino.connect();
 try{
  await entrada.query('BEGIN READ ONLY');await entrada.query("SET LOCAL statement_timeout='10s'");
  const origemNome=(await entrada.query('SELECT current_database() nome')).rows[0]?.nome;
  if(!['donatella_preparacao','donatella_ensaio_woo_origem'].includes(origemNome))throw Error('WOO_ORIGEM_IMPORTACAO_RECUSADA');
  const fonte=(await entrada.query<{conteudo:Record<string,unknown>}>('SELECT to_jsonb(r) conteudo FROM donatella_public.automation_rules r ORDER BY id')).rows.map(r=>r.conteudo);
  if(op.marcoFinal&&!op.baseline)throw Error('WOO_BASELINE_FINAL_EXIGIDO');
  const todas=op.marcoFinal?reconciliarRegrasCongeladasWoo(fonte,op.baseline!,op.marcoFinal,empresaId):fonte;
  const ativas=todas.filter(r=>r.active===true),regras=ativas.filter(r=>r.action_type==='whatsapp_message'),crm=ativas.filter(r=>r.action_type==='crm_update');
  if(ativas.some(r=>!['whatsapp_message','crm_update'].includes(String(r.action_type))))throw Error('WOO_ACAO_ATIVA_NAO_CLASSIFICADA');
  if(regras.length!==3||crm.length!==4||ativas.length!==7)throw Error('WOO_QUANTIDADE_REGRAS_DIVERGENTE');
  await saida.query('BEGIN');await saida.query("SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='20s'");
  const destinoNome=(await saida.query('SELECT current_database() nome')).rows[0]?.nome;
  if(!['donatella_operacao','donatella_ensaio_operacao'].includes(destinoNome)||origemNome==='donatella_ensaio_woo_origem'&&destinoNome!=='donatella_ensaio_operacao')throw Error('WOO_DESTINO_IMPORTACAO_RECUSADO');
  await saida.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['woo-importar:'+empresaId]);
  const anteriorBaseline=(await saida.query<{conteudo:BaselineRegrasWoo;hash:string}>('SELECT conteudo,hash FROM atendimento_operacao.woo_baseline WHERE empresa_id=$1 FOR UPDATE',[empresaId])).rows[0];
  if(anteriorBaseline){conferirBaselineWoo(anteriorBaseline.conteudo,empresaId);if(anteriorBaseline.hash!==anteriorBaseline.conteudo.hash)throw Error('WOO_BASELINE_DESTINO_DIVERGENTE');}
  let baseline:BaselineRegrasWoo;
  if(op.marcoFinal){baseline=op.baseline!;if(!anteriorBaseline||anteriorBaseline.hash!==baseline.hash||anteriorBaseline.conteudo.id!==baseline.id||hashWoo(anteriorBaseline.conteudo)!==hashWoo(baseline))throw Error('WOO_BASELINE_FINAL_DESTINO_DIVERGENTE');}
  else {const nova=criarBaselineWoo(empresaId,todas);baseline=anteriorBaseline?.hash===nova.hash?anteriorBaseline.conteudo:nova;}
  let inseridas=0,preservadas=0,atualizadas=0,crmInseridas=0,crmPreservadas=0,crmAtualizadas=0;
  const classes=new Set<string>();
  for(const bruto of regras){
   const cfg=bruto.action_config as Record<string,unknown>;if(!cfg||typeof cfg.template_id!=='string')throw Error('WOO_MODELO_ORIGEM_AUSENTE');
   const modeloOrigem=(await entrada.query('SELECT id::text,name,language,status,components FROM donatella_public.whatsapp_templates WHERE id::text=$1',[cfg.template_id])).rows[0];if(!modeloOrigem)throw Error('WOO_MODELO_ORIGEM_AUSENTE');
   const modelos=(await saida.query('SELECT id,nome,idioma,estado,componentes FROM atendimento_operacao.modelo WHERE nome=$1 AND idioma=$2',[modeloOrigem.name,modeloOrigem.language])).rows;
   if(modelos.length!==1||modelos[0].estado!=='APPROVED')throw Error('WOO_MODELO_DESTINO_NAO_CONFIRMADO');
   const modelo=modelos[0],regra=normalizarRegraWoo(bruto,modelo.id),classe=regra.logica+':'+regra.delayMinutos;
   if(classes.has(classe))throw Error('WOO_REGRAS_DUPLICADAS');classes.add(classe);
   parametrosRegraWoo(regra,analisarPedidoWoo({id:1,status:regra.estados[0],billing:{first_name:'Validação fictícia',phone:'5511999999001'}}),modelo.componentes);
   const origemRegra={regra:bruto,modelo:modeloOrigem},origemHash=hashWoo(origemRegra),hash=hashWoo(regra);
   const atual=(await saida.query('SELECT hash,origem_hash,conteudo FROM atendimento_operacao.woo_regra WHERE empresa_id=$1 AND id=$2 FOR UPDATE',[empresaId,regra.id])).rows[0];
   if(atual&&atual.hash!==hashWoo(atual.conteudo))throw Error('WOO_REGRA_LOCAL_DIVERGENTE');
   if(atual?.hash===hash&&atual.origem_hash===origemHash){preservadas++;continue;}
   await saida.query('INSERT INTO atendimento_operacao.woo_regra(empresa_id,id,modelo_id,conteudo,origem,hash,origem_hash) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7) ON CONFLICT(empresa_id,id) DO UPDATE SET modelo_id=excluded.modelo_id,conteudo=excluded.conteudo,origem=excluded.origem,hash=excluded.hash,origem_hash=excluded.origem_hash,versao=atendimento_operacao.woo_regra.versao+1,importada_em=now()',[empresaId,regra.id,modelo.id,JSON.stringify(regra),JSON.stringify(origemRegra),hash,origemHash]);if(atual)atualizadas++;else inseridas++;
  }
  const classesCrm=new Set<string>();
  for(const bruto of crm){
   const regra=normalizarRegraCrmWoo(bruto),classe=regra.topic+':'+[...regra.estados].sort().join('|');if(classesCrm.has(classe))throw Error('WOO_CRM_REGRAS_DUPLICADAS');classesCrm.add(classe);
   if(!(await saida.query('SELECT 1 FROM atendimento_operacao.etapa WHERE id=$1',[regra.etapaId])).rowCount)throw Error('WOO_CRM_ETAPA_DESTINO_AUSENTE');
   const hash=hashWoo(regra),origemHash=hashWoo(bruto),atual=(await saida.query('SELECT hash,origem_hash,conteudo FROM atendimento_operacao.woo_crm_regra WHERE empresa_id=$1 AND id=$2 FOR UPDATE',[empresaId,regra.id])).rows[0];
   if(atual&&atual.hash!==hashWoo(atual.conteudo))throw Error('WOO_CRM_REGRA_LOCAL_DIVERGENTE');
   if(atual?.hash===hash&&atual.origem_hash===origemHash){crmPreservadas++;continue;}
   await saida.query('INSERT INTO atendimento_operacao.woo_crm_regra(empresa_id,id,etapa_id,conteudo,origem,hash,origem_hash) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7) ON CONFLICT(empresa_id,id) DO UPDATE SET etapa_id=excluded.etapa_id,conteudo=excluded.conteudo,origem=excluded.origem,hash=excluded.hash,origem_hash=excluded.origem_hash,versao=atendimento_operacao.woo_crm_regra.versao+1,importada_em=now()',[empresaId,regra.id,regra.etapaId,JSON.stringify(regra),JSON.stringify(bruto),hash,origemHash]);if(atual)crmAtualizadas++;else crmInseridas++;
  }
  // Regras fora da nova configuração ficam desativadas e com hash coerente.
  for(const [tabela,ids] of [['woo_regra',regras.map(r=>r.id)],['woo_crm_regra',crm.map(r=>r.id)]] as const){const antigas=(await saida.query(`SELECT id,conteudo FROM atendimento_operacao.${tabela} WHERE empresa_id=$1 AND NOT(id=ANY($2::uuid[])) AND conteudo->>'ativa'='true' FOR UPDATE`,[empresaId,ids])).rows;for(const a of antigas){const conteudo={...a.conteudo,ativa:false};await saida.query(`UPDATE atendimento_operacao.${tabela} SET conteudo=$3::jsonb,hash=$4,versao=versao+1 WHERE empresa_id=$1 AND id=$2`,[empresaId,a.id,JSON.stringify(conteudo),hashWoo(conteudo)]);}}
  const pedidos=(await entrada.query('SELECT id::text,woo_order_id::text external_id,status,last_processed_status,contact_id::text FROM donatella_public.orders WHERE woo_order_id IS NOT NULL ORDER BY woo_order_id')).rows;
  let estadosInseridos=0,estadosAtualizados=0,vinculosAusentes=0;
  for(const p of pedidos){
   if(typeof p.external_id!=='string'||!/^\d{1,20}$/.test(p.external_id)||typeof p.status!=='string'||!p.status||p.last_processed_status!==null&&typeof p.last_processed_status!=='string'||p.contact_id!==null&&(typeof p.contact_id!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(p.contact_id)))throw Error('WOO_ESTADO_ORIGEM_INVALIDO');
   const contato=p.contact_id?(await saida.query('SELECT id FROM atendimento_operacao.contato WHERE id=$1',[p.contact_id])).rows[0]?.id??null:null;if(p.contact_id&&!contato)vinculosAusentes++;
   const conteudo={origemPedidoId:p.id,id:p.external_id,status:p.status,ultimoStatusProcessado:p.last_processed_status};
   const q=await saida.query('INSERT INTO atendimento_operacao.woo_pedido(empresa_id,external_id,status,ultimo_status_processado,conteudo,importado,contato_origem_id,contato_id) VALUES($1,$2,$3,$4,$5::jsonb,true,$6,$7) ON CONFLICT(empresa_id,external_id) DO UPDATE SET status=excluded.status,ultimo_status_processado=excluded.ultimo_status_processado,conteudo=excluded.conteudo,contato_origem_id=excluded.contato_origem_id,contato_id=excluded.contato_id,versao=atendimento_operacao.woo_pedido.versao+1,atualizado_em=now() WHERE atendimento_operacao.woo_pedido.importado=true AND atendimento_operacao.woo_pedido.ultimo_evento_id IS NULL AND (atendimento_operacao.woo_pedido.status IS DISTINCT FROM excluded.status OR atendimento_operacao.woo_pedido.ultimo_status_processado IS DISTINCT FROM excluded.ultimo_status_processado OR atendimento_operacao.woo_pedido.conteudo IS DISTINCT FROM excluded.conteudo OR atendimento_operacao.woo_pedido.contato_origem_id IS DISTINCT FROM excluded.contato_origem_id OR atendimento_operacao.woo_pedido.contato_id IS DISTINCT FROM excluded.contato_id) RETURNING (xmax=0) inserido',[empresaId,p.external_id,p.status,p.last_processed_status,JSON.stringify(conteudo),p.contact_id,contato]);if(q.rows[0]?.inserido)estadosInseridos++;else if(q.rowCount)estadosAtualizados++;
  }
  if(!op.marcoFinal)await saida.query('INSERT INTO atendimento_operacao.woo_baseline(empresa_id,id,conteudo,hash,ativas_hash,quantidade_ativas,capturada_em) VALUES($1,$2,$3::jsonb,$4,$5,$6,$7) ON CONFLICT(empresa_id) DO UPDATE SET id=excluded.id,conteudo=excluded.conteudo,hash=excluded.hash,ativas_hash=excluded.ativas_hash,quantidade_ativas=excluded.quantidade_ativas,capturada_em=excluded.capturada_em',[empresaId,baseline.id,JSON.stringify(baseline),baseline.hash,baseline.ativasHash,baseline.quantidadeAtivas,baseline.capturadaEm]);
  if(inseridas||atualizadas||crmInseridas||crmAtualizadas||estadosInseridos||estadosAtualizados||anteriorBaseline?.hash!==baseline.hash)await saida.query("INSERT INTO atendimento_operacao.auditoria(id,autor_id,entidade_id,acao,versao) VALUES($1,'service:importacao-woo','woo_regras','importar_woo_sem_filas',1)",[randomUUID()]);
  await entrada.query('COMMIT');await saida.query('COMMIT');
  return {fase:'woo_regras_estado_preservados',regras:3,regrasCrm:4,inseridas,preservadas,atualizadas,crmInseridas,crmPreservadas,crmAtualizadas,regrasAtivasOrigem:7,outrasRegrasAtivas:0,acoesPendentes:[] as string[],pedidos:pedidos.length,estadosInseridos,estadosAtualizados,vinculosAusentes,baselineId:baseline.id,baselineHash:baseline.hash,baselinePrivado:baseline,marcoFinalValidado:!!op.marcoFinal,filasImportadas:0,eventosCriados:0,enviosExternos:0,fornecedoresChamados:0};
 }catch(e){await Promise.all([entrada.query('ROLLBACK').catch(()=>undefined),saida.query('ROLLBACK').catch(()=>undefined)]);throw e;}finally{entrada.release();saida.release();}
}
