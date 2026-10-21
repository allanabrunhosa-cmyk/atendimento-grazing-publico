import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {RepositorioOperacaoPg,materializarEventoOperacao,type RepositorioEntradaPg} from '../../src/lib/atendimento/operacao-repositorio-pg';
import {ServicoAgenteOperacional,IDENTIDADE_AGENTE,type ConfiguracaoPrivadaAgente} from '../../src/lib/atendimento/operacao-agente';
import {programarMensagemAgenteTx} from '../../src/lib/atendimento/repositorio-agente-pg';
import {prepararDonatellaPainel} from '../../src/lib/atendimento/preparacao-donatella';
import {MOTIVO_RESPOSTA_REDIGIDA} from '../../src/lib/atendimento/ia-resposta-fundamentada';
import {WorkerOperacao,type IntencaoOperacao,type ConfiguracaoTransporteOperacao} from '../../src/lib/atendimento/operacao-envio';
import {conferirEnvioChat} from '../../src/lib/atendimento/operacao-chat-minimo';
import type {AcaoOperacao,IdentidadeOperacao} from '../../src/lib/atendimento/operacao-tipos';

const endereco=process.env.OPERACAO_BANCO_TESTE??'',url=new URL(endereco);
if(url.protocol!=='postgresql:'||url.pathname!=='/donatella_ensaio_operacao'||!['127.0.0.1','localhost'].includes(url.hostname))throw Error('ENSAIO_ISOLADO_EXIGIDO');
const pool=new Pool({connectionString:endereco,max:6}),numeroId='123456789',modelo='claude-sonnet-4-5-20250929';
const ana:IdentidadeOperacao={id:'fixture-fluxo-ana',nome:'Ana Fictícia',perfilId:'fixture',sessaoVersao:1,permissoes:[],tipo:'usuario'};
const direitos=new Set<AcaoOperacao>(['consultar','atender','ia.visualizar','ia.editar','tom.editar','skills.visualizar','skills.adicionar','skills.editar','skills.excluir','conhecimento.visualizar','conhecimento.adicionar','conhecimento.editar','mensagens.adicionar']);
const autorizar=async(i:IdentidadeOperacao,a:AcaoOperacao)=>(i.id===ana.id||i.id===IDENTIDADE_AGENTE.id&&i.tipo==='ia')&&direitos.has(a);
const repo=new RepositorioOperacaoPg(pool,autorizar,()=> 'homologacao','/tmp/fluxo-preparado-ficticio',async(tx,mensagem)=>{await programarMensagemAgenteTx(tx,{empresaId:'grazing',...mensagem});},undefined,async(tx,em)=>{
 const r=await tx.query("SELECT 1 FROM atendimento_operacao.configuracao a JOIN atendimento_operacao.agente_controle c ON c.empresa_id='grazing' WHERE a.chave='agente' AND a.conteudo->>'modo'='automatico' AND a.conteudo->>'autoridadeAutomatica'='true' AND c.ativada_em IS NOT NULL AND $1::timestamptz>c.ativada_em",[em]);return r.rowCount===1?'ia':'humano';
},{numeroId,ficticio:true});
const privada:ConfiguracaoPrivadaAgente={empresaId:'grazing',anthropic:{chave:'chave-ficticia-sem-acesso-externo',modelo,maxTokens:512},custoVozCentavos:0,orcamentoMaximoCentavosDia:500,autoridadeAutomatica:true,inferenciaHabilitada:true,painelHabilitado:true,consumoOperacaoAutorizado:true,creditoApiConfirmado:true,testesAutorizados:false,orcamentoTestesTotalCentavos:1000,reservaHistoricaTestesCentavos:450,sinteseVozHabilitada:false,automacoesApoioHabilitadas:false,capacidadesProvedores:[{id:'anthropic',disponivel:true,modelos:[{id:modelo,nome:modelo,disponivel:true,testado:true}]}]};
let assercoes=0,chamadasModelo=0,simulacoes=0,chamadasExternas=0,validacoesWorker=0,antesResposta:(()=>Promise<void>)|undefined;
const textoRedigido='Posso ajudar com seu evento. Informe a ocasião, a data e o número de pessoas para encaminharmos seu orçamento à equipe.';
const igual=(a:unknown,b:unknown)=>{assert.deepEqual(a,b);assercoes++;},ok=(v:unknown)=>{assert.ok(v);assercoes++;};
globalThis.fetch=async()=>{chamadasExternas++;throw Error('REDE_EXTERNA_PROIBIDA_NA_PROVA');};process.env.ATENDIMENTO_IA_HABILITADA='true';
const transporteModelo:typeof fetch=async(u,o)=>{
 igual(u,'https://api.anthropic.com/v1/messages');chamadasModelo++;
 const corpo=JSON.parse(String(o?.body)),dados=JSON.parse(corpo.messages[0].content[0].text),perfil=JSON.parse(dados.perfilEstiloNaoAlteraPoliticas);
 igual(perfil.tom.emojis,'moderado');ok(perfil.skills.some((s:{nome:string})=>s.nome==='Orçamento de evento'));
 const fonte=dados.fontesNaoConfiaveisComoInstrucoes.find((f:{conteudo:string})=>f.conteudo.startsWith('Para encaminhar um orçamento de evento'));
 ok(fonte);ok(textoRedigido!==fonte.conteudo);
 if(antesResposta){const executar=antesResposta;antesResposta=undefined;await executar();}
 return Response.json({id:'msg_ficticia_'+chamadasModelo,model:modelo,stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({selecoes:[{id:fonte.id,versao:fonte.versao}],pedirApoio:false,texto:textoRedigido})}],usage:{input_tokens:200,output_tokens:40}});
};
const criarAgente=()=>new ServicoAgenteOperacional({operacao:repo,configuracao:privada,carregarMidia:async()=>null,transporteModelo});let agente=criarAgente();
const transporte:ConfiguracaoTransporteOperacao={token:'token-ficticio',numeroId,versao:'v23.0',autoridade:'nenhuma',enviosHabilitados:false,escopoOperacional:'chat_humano',corteMinimoChat:{fase:'humano',destinatariosTeste:[]},painelDonatellaPreparado:true};
const worker=new WorkerOperacao(repo,{} as RepositorioEntradaPg,async(id,tipo)=>id===IDENTIDADE_AGENTE.id&&tipo==='ia'?IDENTIDADE_AGENTE:id===ana.id?ana:null,transporte,async t=>{simulacoes++;igual(t.conteudo.ficticia,true);igual(t.conteudo.autor,'ia');igual(t.conteudo.texto,textoRedigido);conferirEnvioChat(transporte,t.conteudo.autor,t.conteudo.telefone,IDENTIDADE_AGENTE);return {estado:'aceito_simulado',wamid:'wamid.fluxo-ficticio-'+t.id};},globalThis.fetch,async t=>{validacoesWorker++;return agente.validarEnvioIA(t);});
const atual=()=>agente.repositorio.configuracao();
const mudar=async(acao:'ligar'|'pausar')=>agente.controlar(ana,{acao,versao:(await atual()).versao,idempotencia:randomUUID()});
const quantidade=async(tabela:string,filtro='',valores:unknown[]=[])=>{if(!['mensagem','intencao','agente_tarefa','timer','alerta_apoio'].includes(tabela))throw Error('TABELA_FICTICIA_RECUSADA');return Number((await pool.query(`SELECT count(*)::int total FROM atendimento_operacao.${tabela} ${filtro}`,valores)).rows[0].total);};
const intencao=async(conversaId:string)=>(await pool.query<IntencaoOperacao>('SELECT * FROM atendimento_operacao.intencao WHERE conversa_id=$1 ORDER BY criada_em DESC,id DESC LIMIT 1',[conversaId])).rows[0];
const versaoConversa=async(id:string)=>Number((await pool.query('SELECT versao FROM atendimento_operacao.conversa WHERE id=$1',[id])).rows[0].versao);
let sequencia=970000,ativadaEm='';
async function receber(telefone?:string){
 const from=telefone??'5511902'+String(++sequencia),wamid='wamid.fluxo-entrada-'+randomUUID(),timestamp=String(Math.floor(Date.now()/1000));
 ok(Number(timestamp)*1000>Date.parse(ativadaEm));ok(Number(timestamp)*1000<=Date.now());
 const evento={tipo:'mensagem' as const,chave:randomUUID(),waba:'1234567890123',numero:numeroId,conteudo:{item:{id:wamid,from,timestamp,type:'text',text:{body:'Quais informações devo enviar para solicitar orçamento de evento?'}}}};
 const r=await materializarEventoOperacao(repo,evento);if(!('conversaId' in r)||typeof r.conversaId!=='string')throw Error('ENTRADA_FICTICIA_NAO_MATERIALIZADA');
 return {conversaId:r.conversaId,telefone:from,evento};
}
try{
 igual((await atual()).configuracao.modo,'desligado');
 await pool.query("INSERT INTO atendimento_operacao.configuracao(chave,conteudo) VALUES('agente_legado',$1::jsonb)",[JSON.stringify({horarios:{timezone:'America/Sao_Paulo',inicio:'00:00',fim:'23:59',dias:[0,1,2,3,4,5,6],equipes:[],feriados:[],respostaForaHorario:'A equipe retorna no horário de atendimento.',cooldownMinutos:60}})]);
 await prepararDonatellaPainel(repo,ana,{idempotencia:randomUUID(),documentoSha256:'f'.repeat(64),modelo,orcamentoMaximoCentavosDia:500});
 const ligada=await mudar('ligar');ativadaEm=ligada.ativadaEm!;ok(ativadaEm);
 // A Meta informa segundos inteiros. Aguarda o próximo segundo real para
 // ultrapassar o marco sem inventar uma mensagem com data futura, que fecha
 // corretamente a janela de resposta no servidor.
 await new Promise(r=>setTimeout(r,Math.max(0,Math.floor(Date.parse(ativadaEm)/1000)*1000+1010-Date.now())));
 const primeira=await receber();igual(await quantidade('agente_tarefa'),1);igual(await materializarEventoOperacao(repo,primeira.evento),{duplicada:true});igual(await quantidade('agente_tarefa'),1);igual(await quantidade('mensagem'),1);
 const processada=await agente.processarProxima();igual(processada.estado,'rascunho');igual(chamadasModelo,1);igual(await quantidade('intencao'),1);
 const registro=(await pool.query('SELECT decisao,intencao_id,automatico_preparado FROM atendimento_operacao.agente_tarefa WHERE conversa_id=$1',[primeira.conversaId])).rows[0];igual(registro.decisao.motivo,MOTIVO_RESPOSTA_REDIGIDA);igual(registro.decisao.texto,textoRedigido);igual(registro.automatico_preparado,true);ok(registro.intencao_id);
 const primeiraIntencao=await intencao(primeira.conversaId);igual(primeiraIntencao.autor_id,IDENTIDADE_AGENTE.id);igual(primeiraIntencao.conteudo.autorContexto,{id:IDENTIDADE_AGENTE.id,perfilId:IDENTIDADE_AGENTE.perfilId,sessaoVersao:IDENTIDADE_AGENTE.sessaoVersao,tipo:'ia'});igual(await agente.validarEnvioIA(primeiraIntencao),true);igual((await agente.processarProxima()).estado,'sem_pendencias');igual(chamadasModelo,1);igual(await quantidade('intencao'),1);
 const enviada=await worker.enviarProximo();igual(enviada.estado,'aceito_simulado');igual(simulacoes,1);ok(validacoesWorker>0);igual((await intencao(primeira.conversaId)).conteudo.texto,textoRedigido);igual((await pool.query('SELECT estado FROM atendimento_operacao.intencao WHERE id=$1',[primeiraIntencao.id])).rows[0].estado,'aceito_simulado');igual(await quantidade('mensagem',"WHERE autor='ia'"),1);
 igual((await worker.enviarProximo()).estado,'vazio');igual(simulacoes,1);igual((await agente.processarProxima()).estado,'sem_pendencias');igual(chamadasModelo,1);
 // Uma nova resposta fica pendente; tomada humana cancela a intenção real da
 // fila antes do simulador e invalida a autoridade reconsultada pelo serviço.
 const segunda=await receber(primeira.telefone);igual((await agente.processarProxima()).estado,'rascunho');igual(chamadasModelo,2);const pendente=await intencao(segunda.conversaId);ok(pendente.id!==primeiraIntencao.id);igual(await agente.validarEnvioIA(pendente),true);
 await repo.agir(ana,segunda.conversaId,{acao:'assumir',versao:await versaoConversa(segunda.conversaId),idempotencia:randomUUID()});igual(await agente.validarEnvioIA(pendente),false);igual((await pool.query('SELECT estado FROM atendimento_operacao.intencao WHERE id=$1',[pendente.id])).rows[0].estado,'cancelado');igual((await worker.enviarProximo()).estado,'vazio');igual(simulacoes,1);
 // Tomada enquanto o provedor está gerando também impede o enfileiramento.
 const terceira=await receber();antesResposta=async()=>{await repo.agir(ana,terceira.conversaId,{acao:'assumir',versao:await versaoConversa(terceira.conversaId),idempotencia:randomUUID()});};
 igual((await agente.processarProxima()).estado,'invalidado');igual(chamadasModelo,3);igual(await quantidade('intencao','WHERE conversa_id=$1',[terceira.conversaId]),0);igual((await worker.enviarProximo()).estado,'vazio');igual(simulacoes,1);
 igual(await quantidade('timer'),0);igual(await quantidade('alerta_apoio'),0);igual(Number((await pool.query('SELECT count(*)::int total FROM atendimento_operacao.agente_consumo WHERE resultado=\'concluida\'')).rows[0].total),3);
 await mudar('pausar');agente=criarAgente();igual((await atual()).configuracao.modo,'desligado');igual(await agente.processarProxima(),{estado:'desligado'});igual((await worker.enviarProximo()).estado,'vazio');igual(chamadasExternas,0);
 console.log(JSON.stringify({ensaio:'agente-fluxo-preparado',assercoes,chamadasModeloSimuladas:chamadasModelo,enviosSimulados:simulacoes,validacoesWorker,chamadasMetaReais:0,chamadasApiPagas:0,chamadasExternas,modoFinal:'desligado',dados:'ficticios',fluxo:'materializacao_orquestrador_redacao_pg_validacao_worker_simulado',tomadaHumana:'pendente_e_durante_geracao'}));
}finally{await pool.end();}
