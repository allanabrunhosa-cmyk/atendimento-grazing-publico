import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {ServicoAgenteOperacional,IDENTIDADE_AGENTE} from '../../src/lib/atendimento/operacao-agente';
import {RepositorioOperacaoPg} from '../../src/lib/atendimento/operacao-repositorio-pg';
import {programarMensagemAgenteTx,type ConfiguracaoAgente} from '../../src/lib/atendimento/repositorio-agente-pg';
import {executarComandoAgenteCorte} from '../../src/lib/atendimento/operacao-agente-corte';
import type {IntencaoOperacao} from '../../src/lib/atendimento/operacao-envio';
const endereco=process.env.AGENTE_BANCO_TESTE;if(!endereco||process.env.DONATELLA_ENSAIO_OPERACAO!=='1')throw Error('ENSAIO_FOLLOWUP_EXIGIDO');
const u=new URL(endereco);if(u.protocol!=='postgresql:'||u.pathname!=='/donatella_ensaio_operacao'||!['grazing-donatella-operacao-v2-banco','donatella-ensaio-operacao-v2','grazing-donatella-prova-ia-v2-banco'].includes(u.hostname)||u.search||u.hash)throw Error('ENSAIO_FOLLOWUP_BANCO_RECUSADO');
const etapa=u.hostname==='grazing-donatella-prova-ia-v2-banco'?process.env.DONATELLA_ENSAIO_REGRESSAO_EXECUCAO:undefined;
if(u.hostname==='grazing-donatella-prova-ia-v2-banco'&&(!etapa||!/^r\d{1,4}$/.test(etapa)))throw Error('ENSAIO_FOLLOWUP_EXECUCAO_EXIGIDA');
const pool=new Pool({connectionString:endereco,max:3,statement_timeout:10000});
const empresaId='ensaio-followup'+(etapa?'-regressao-'+etapa:''),usuario={id:'hub-'+empresaId,nome:'Responsável fictício',perfilId:'fixture',sessaoVersao:1,permissoes:['consultar','atender','configurar'],tipo:'usuario' as const};
const repo=new RepositorioOperacaoPg(pool,async i=>i.id===usuario.id||i.id===IDENTIDADE_AGENTE.id,()=> 'homologacao','/ensaio-followup-midia');
const config:ConfiguracaoAgente={modo:'automatico',modelo:'claude-sonnet-4-5-20250929',maxTokens:512,equipeApoio:'apoio',limites:{maxChamadas:3,custoPorChamadaCentavos:1,maxCustoCentavos:10,maxDuracaoMs:5000,timeoutChamadaMs:2000},custoCentavosDia:100,autoridadeAutomatica:true,grupoExterno:'indisponivel'};
let chamadas=0,provas=0;const conferir=(v:unknown)=>{assert.ok(v,'ENSAIO_FOLLOWUP_FALHOU_'+String(provas+1));provas++;};
const a=new ServicoAgenteOperacional({operacao:repo,configuracao:{empresaId,anthropic:{chave:'fixture',modelo:config.modelo,maxTokens:512},custoVozCentavos:1,orcamentoMaximoCentavosDia:100,autoridadeAutomatica:true,inferenciaHabilitada:true},carregarMidia:async()=>null,transporteModelo:async(_url,p)=>{chamadas++;const body=JSON.parse(p!.body as string),texto=body.messages.at(-1).content.find((x:{type:string})=>x.type==='text'),pedido=JSON.parse(texto.text);return Response.json({content:[{type:'text',text:JSON.stringify({selecoes:pedido.fontesNaoConfiaveisComoInstrucoes.slice(0,1).map((f:{id:string;versao:number})=>({id:f.id,versao:f.versao})),pedirApoio:false})}],stop_reason:'end_turn'});}});
async function novaSaudacao(){const contato=randomUUID(),conversa=randomUUID(),mensagem=randomUUID();await repo.transacao(async tx=>{
 await tx.query("INSERT INTO atendimento_operacao.contato(id,nome,telefone) VALUES($1,'Contato fictício follow-up','5511000000002')",[contato]);
 await tx.query("INSERT INTO atendimento_operacao.conversa(id,contato_id,estado,ficticia,ultima_cliente_em) VALUES($1,$2,'ia',true,now())",[conversa,contato]);
 await tx.query("INSERT INTO atendimento_operacao.mensagem(id,conversa_id,autor,conteudo,tipo) VALUES($1,$2,'cliente','Oi','text')",[mensagem,conversa]);
 await programarMensagemAgenteTx(tx,{empresaId,conversaId:conversa,mensagemId:mensagem,versao:1,conteudo:'Oi',tipo:'text'});
 });conferir((await a.processarProxima()).estado==='rascunho');
 const timer=(await pool.query("SELECT t.* FROM atendimento_operacao.timer t WHERE t.conversa_id=$1 AND tipo='welcome_followup'",[conversa])).rows[0];conferir(!!timer);return {conversa,timer};}
async function vencer(id:string,aceitar=true){if(aceitar)await pool.query("UPDATE atendimento_operacao.intencao SET estado='aceito_simulado' WHERE id=(SELECT origem_intencao_id FROM atendimento_operacao.timer WHERE id=$1)",[id]);await pool.query("UPDATE atendimento_operacao.timer SET executar_em=now()-interval '1 second' WHERE id=$1",[id]);}
async function estadoTimer(id:string){return (await pool.query('SELECT * FROM atendimento_operacao.timer WHERE id=$1',[id])).rows[0];}
try{
 if(process.argv.includes('--retomada')){
  const r=await pool.query("SELECT t.estado,t.intencao_id FROM atendimento_operacao.timer t JOIN atendimento_operacao.agente_tarefa a ON a.id=(t.conteudo->>'tarefaId')::uuid WHERE a.empresa_id=$1",[empresaId]);conferir(r.rowCount===6);conferir(r.rows.filter(t=>t.estado==='concluido'&&t.intencao_id).length===1);conferir(r.rows.filter(t=>t.estado==='cancelado').length===5);conferir(chamadas===0);console.log(JSON.stringify({fase:'followup_apos_reinicio',provas,timersPersistentes:true,semNovaInferencia:true,enviosExternos:0}));
 }else{
  process.env.ATENDIMENTO_IA_HABILITADA='true';
  if((await pool.query('SELECT 1 FROM atendimento_operacao.agente_tarefa WHERE empresa_id=$1',[empresaId])).rowCount)throw Error('ENSAIO_FOLLOWUP_JA_EXISTE_USAR_RETOMADA');
  const antigas=(await pool.query("SELECT chave,conteudo,versao,atualizada_em::text atualizada_em FROM atendimento_operacao.configuracao WHERE chave IN ('agente','agente_legado','agente_followup','atendimento')")).rows;
  try{
   await pool.query("DELETE FROM atendimento_operacao.configuracao WHERE chave IN ('agente_followup','atendimento')");
   await pool.query("UPDATE atendimento_operacao.configuracao SET conteudo=$1::jsonb WHERE chave='agente'",[JSON.stringify(config)]);
   await pool.query("INSERT INTO atendimento_operacao.configuracao(chave,conteudo) VALUES('agente_legado',$1::jsonb) ON CONFLICT(chave) DO UPDATE SET conteudo=excluded.conteudo",[JSON.stringify({ensaioId:empresaId,followup:{habilitado:true,minutos:5,texto:'Retomada fictícia da conversa, sem cliente real.'},horarios:{timezone:'America/Sao_Paulo',inicio:'00:00',fim:'23:59',dias:[0,1,2,3,4,5,6],equipes:[],feriados:[],respostaForaHorario:'Fora de horário fictício.',cooldownMinutos:360}})]);
   const primeiro=await novaSaudacao();conferir((await a.processarProxima()).estado==='sem_pendencias');const antes=chamadas;await vencer(primeiro.timer.id);conferir((await a.processarProxima()).estado==='timer_enfileirado');conferir(chamadas===antes);
   const criado=await estadoTimer(primeiro.timer.id),intencao=(await pool.query<IntencaoOperacao>('SELECT * FROM atendimento_operacao.intencao WHERE id=$1',[criado.intencao_id])).rows[0];conferir(await a.validarEnvioIA(intencao));conferir((await a.processarProxima()).estado==='sem_pendencias');conferir((await estadoTimer(criado.id)).intencao_id===criado.intencao_id);
   const resposta=await novaSaudacao();const nova=randomUUID();await repo.transacao(async tx=>{await tx.query("INSERT INTO atendimento_operacao.mensagem(id,conversa_id,autor,conteudo,tipo) VALUES($1,$2,'cliente','Quero falar com humano','text')",[nova,resposta.conversa]);await tx.query('UPDATE atendimento_operacao.conversa SET versao=2,ultima_cliente_em=now() WHERE id=$1',[resposta.conversa]);await programarMensagemAgenteTx(tx,{empresaId,conversaId:resposta.conversa,mensagemId:nova,versao:2,conteudo:'Quero falar com humano',tipo:'text'});});conferir((await estadoTimer(resposta.timer.id)).estado==='cancelado');await a.processarProxima();
   const humano=await novaSaudacao();await repo.agir(usuario,humano.conversa,{acao:'assumir',versao:1,idempotencia:randomUUID()});conferir((await estadoTimer(humano.timer.id)).estado==='cancelado');
   const janela=await novaSaudacao();await vencer(janela.timer.id);await pool.query("UPDATE atendimento_operacao.conversa SET ultima_cliente_em=now()-interval '25 hours' WHERE id=$1",[janela.conversa]);conferir((await a.processarProxima()).estado==='timer_cancelado');conferir((await estadoTimer(janela.timer.id)).intencao_id===null);
   const incerta=await novaSaudacao();await vencer(incerta.timer.id,false);conferir((await a.processarProxima()).estado==='sem_pendencias');conferir((await estadoTimer(incerta.timer.id)).estado==='pendente');await pool.query("UPDATE atendimento_operacao.intencao SET estado='incerto' WHERE id=$1",[incerta.timer.origem_intencao_id]);await vencer(incerta.timer.id,false);conferir((await a.processarProxima()).estado==='timer_cancelado');
   const alterada=await novaSaudacao();const cfg=await a.followup(usuario);await a.configurarFollowup(usuario,{conteudo:{...cfg.configuracao,habilitado:false},versao:cfg.versao,idempotencia:randomUUID()});await vencer(alterada.timer.id);conferir((await a.processarProxima()).estado==='timer_cancelado');conferir(!await a.validarEnvioIA(intencao));
   const corte={habilitar:true,modoServidor:'operacao',autoridade:'vps',enviosHabilitados:true,iaAutomatica:true,comandoExpresso:true,idempotencia:randomUUID()};const c=await executarComandoAgenteCorte(a,usuario,corte),d=await executarComandoAgenteCorte(a,usuario,corte);conferir(c.versao===d.versao);conferir(Number((await pool.query("SELECT count(*) n FROM atendimento_operacao.auditoria WHERE autor_id=$1 AND acao='corte_habilitar_agente'",[usuario.id])).rows[0].n)===1);
   console.log(JSON.stringify({fase:'followup_fluxo_integrado',provas,timers:6,fornecedores:'transportes_ficticios',modeloChamadas:chamadas,enviosExternos:0,ativacaoAuditadaIdempotente:true}));
  }finally{
   await repo.transacao(async tx=>{await tx.query("DELETE FROM atendimento_operacao.configuracao WHERE chave IN ('agente','agente_legado','agente_followup','atendimento')");for(const r of antigas)await tx.query('INSERT INTO atendimento_operacao.configuracao(chave,conteudo,versao,atualizada_em) VALUES($1,$2::jsonb,$3,$4)',[r.chave,JSON.stringify(r.conteudo),r.versao,r.atualizada_em]);});
  }
 }
}finally{await pool.end();}
