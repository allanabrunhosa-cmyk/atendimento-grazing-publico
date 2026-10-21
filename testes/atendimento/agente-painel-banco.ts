import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {RepositorioOperacaoPg,materializarEventoOperacao} from '../../src/lib/atendimento/operacao-repositorio-pg';
import {ServicoAgenteOperacional,type ConfiguracaoPrivadaAgente} from '../../src/lib/atendimento/operacao-agente';
import {programarMensagemAgenteTx,hashTarefaAgente,type ConfiguracaoAgente} from '../../src/lib/atendimento/repositorio-agente-pg';
import type {IdentidadeOperacao,AcaoOperacao} from '../../src/lib/atendimento/operacao-tipos';
import type {TarefaIA} from '../../src/lib/atendimento/ia-orquestrador';
import {prepararDonatellaPainel,DOCUMENTO_PREPARACAO_DONATELLA} from '../../src/lib/atendimento/preparacao-donatella';

const endereco=process.env.OPERACAO_BANCO_TESTE??'',url=new URL(endereco);
if(url.protocol!=='postgresql:'||url.pathname!=='/donatella_ensaio_operacao'||!['127.0.0.1','localhost'].includes(url.hostname))throw Error('ENSAIO_ISOLADO_EXIGIDO');
const pool=new Pool({connectionString:endereco,max:5}),ana:IdentidadeOperacao={id:'fixture-agente-ana',nome:'Ana Fictícia',perfilId:'fixture',sessaoVersao:1,permissoes:[]};
let autorizado=true,assercoes=0,modelos=0,metas=0,retornoModelo='concluido',duranteModelo:(()=>Promise<void>)|undefined;
const direitos=new Set<AcaoOperacao>(['consultar','configurar','configuracao.visualizar','ia.visualizar','ia.editar','tom.visualizar','tom.editar','skills.visualizar','skills.adicionar','skills.editar','skills.excluir','atender','mensagens.adicionar','mensagens.visualizar','contatos.visualizar','conhecimento.visualizar','conhecimento.adicionar','conhecimento.editar']);
const autorizar=async(i:IdentidadeOperacao,a:AcaoOperacao)=>autorizado&&(i.id===ana.id||i.tipo==='ia')&&direitos.has(a);
const repo=new RepositorioOperacaoPg(pool,autorizar,()=> 'homologacao','/tmp/agente-painel-ficticio');
const numeroId='123456789';
// Exercita a mesma seleção de estado usada no caminho operacional do runtime.
// A base, o canal e todos os contatos desta prova são fictícios e isolados.
const recepcao=new RepositorioOperacaoPg(pool,autorizar,()=> 'homologacao','/tmp/agente-recepcao-ficticia',async(tx,mensagem)=>{await programarMensagemAgenteTx(tx,{empresaId:'grazing',...mensagem});},undefined,async(tx,em)=>{
 const r=await tx.query("SELECT 1 FROM atendimento_operacao.configuracao a JOIN atendimento_operacao.agente_controle c ON c.empresa_id='grazing' WHERE a.chave='agente' AND a.conteudo->>'modo'='automatico' AND a.conteudo->>'autoridadeAutomatica'='true' AND c.ativada_em IS NOT NULL AND $1::timestamptz>c.ativada_em",[em]);return r.rowCount===1?'ia':'humano';
},{numeroId,ficticio:true});
const modelo='claude-sonnet-4-5-20250929';
const privada:ConfiguracaoPrivadaAgente={empresaId:'grazing',anthropic:{chave:'chave-ficticia',modelo,maxTokens:512},custoVozCentavos:50,orcamentoMaximoCentavosDia:500,autoridadeAutomatica:true,inferenciaHabilitada:true,painelHabilitado:true,consumoOperacaoAutorizado:true,creditoApiConfirmado:true,testesAutorizados:true,orcamentoTestesTotalCentavos:1000,reservaHistoricaTestesCentavos:450,sinteseVozHabilitada:false,automacoesApoioHabilitadas:false,capacidadesProvedores:[{id:'anthropic',disponivel:true,modelos:[{id:modelo,nome:modelo,disponivel:true,testado:true}]}]};
const transporte:typeof fetch=async(u,o)=>{assert.equal(u,'https://api.anthropic.com/v1/messages');modelos++;const corpo=JSON.parse(String(o?.body)),dados=JSON.parse(corpo.messages[0].content[0].text);assert.ok(dados.perfilEstiloNaoAlteraPoliticas);if(duranteModelo){const f=duranteModelo;duranteModelo=undefined;await f();}if(retornoModelo==='incerto')throw Error('falha-ficticia');const fonte=dados.fontesNaoConfiaveisComoInstrucoes[0];return Response.json({id:'msg_ficticia',model:modelo,stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({selecoes:[{id:fonte.id,versao:fonte.versao}],pedirApoio:false,texto:'Neste teste fictício, posso coletar a ocasião, a data e o número de pessoas para encaminhar sua solicitação à equipe.'})}],usage:{input_tokens:100,output_tokens:40}});};
globalThis.fetch=async()=>{metas++;throw Error('TRANSPORTE_REAL_PROIBIDO');};process.env.ATENDIMENTO_IA_HABILITADA='true';
const servico=()=>new ServicoAgenteOperacional({operacao:repo,configuracao:privada,carregarMidia:async()=>null,transporteModelo:transporte});let agente=servico();
const igual=(a:unknown,b:unknown)=>{assert.deepEqual(a,b);assercoes++;},ok=(v:unknown)=>{assert.ok(v);assercoes++;};
const recusar=async(f:()=>Promise<unknown>,codigo:string)=>{await assert.rejects(f,new RegExp(codigo));assercoes++;};
const atual=()=>agente.repositorio.configuracao();
const mudar=async(acao:'ligar'|'pausar',idempotencia=randomUUID())=>agente.controlar(ana,{acao,versao:(await atual()).versao,idempotencia});
const testar=async(pergunta='Como funciona o atendimento neste ensaio?',idempotencia=randomUUID())=>agente.testar(ana,{pergunta,versao:(await atual()).versao,idempotencia});
const efeitos=async()=>(await pool.query('SELECT (SELECT count(*) FROM atendimento_operacao.contato)::int contatos,(SELECT count(*) FROM atendimento_operacao.conversa)::int conversas,(SELECT count(*) FROM atendimento_operacao.mensagem)::int mensagens,(SELECT count(*) FROM atendimento_operacao.intencao)::int intencoes')).rows[0];
async function entrada(antiga=false,estado='ia'){
 const contatoId=randomUUID(),conversaId=randomUUID(),mensagemId=randomUUID(),conteudo='Mensagem fictícia';
 await pool.query('INSERT INTO atendimento_operacao.contato(id,nome,telefone) VALUES($1,$2,$3)',[contatoId,'Contato fictício','5511900'+String(Math.floor(Math.random()*1e6)).padStart(6,'0')]);
 await pool.query('INSERT INTO atendimento_operacao.conversa(id,contato_id,estado,ficticia) VALUES($1,$2,$3,true)',[conversaId,contatoId,estado]);
 await pool.query("INSERT INTO atendimento_operacao.mensagem(id,conversa_id,autor,conteudo,tipo,estado,criada_em) VALUES($1,$2,'cliente',$3,'text','recebido',clock_timestamp()+($4::int*interval '1 day'))",[mensagemId,conversaId,conteudo,antiga?-1:1]);
 const r=await repo.transacao(tx=>programarMensagemAgenteTx(tx,{empresaId:'grazing',conversaId,mensagemId,versao:1,conteudo,tipo:'text'}));return {r,conversaId,mensagemId,contatoId};
}
let sequenciaEntrada=940000;
const telefoneFicticio=()=>'5511901'+String(++sequenciaEntrada).padStart(6,'0');
const evento=(telefone:string,em:string,wamid='wamid.fixture-painel-'+randomUUID())=>({tipo:'mensagem' as const,chave:randomUUID(),waba:'1234567890123',numero:numeroId,conteudo:{item:{id:wamid,from:telefone,timestamp:String(Math.floor(Date.parse(em)/1000)),type:'text',text:{body:'Entrada fictícia para conferir autoridade'}}}});
const lerConversa=async(id:string)=>(await pool.query('SELECT id,estado,responsavel_id,versao FROM atendimento_operacao.conversa WHERE id=$1',[id])).rows[0];
const tarefasConversa=async(id:string)=>Number((await pool.query('SELECT count(*)::int total FROM atendimento_operacao.agente_tarefa WHERE conversa_id=$1',[id])).rows[0].total);
async function conversaHumanaFicticia(estado='humano'){
 const telefone=telefoneFicticio(),contatoId=randomUUID(),conversaId=randomUUID(),mensagemId=randomUUID();
 await pool.query('INSERT INTO atendimento_operacao.contato(id,nome,telefone,identidade_canal) VALUES($1,$2,$3,$4)',[contatoId,'Contato humano fictício',telefone,`whatsapp:${numeroId}:${telefone}`]);
 await pool.query('INSERT INTO atendimento_operacao.conversa(id,contato_id,estado,responsavel_id,ficticia) VALUES($1,$2,$3,$4,true)',[conversaId,contatoId,estado,ana.id]);
 await pool.query("INSERT INTO atendimento_operacao.mensagem(id,conversa_id,autor,conteudo,tipo,estado,criada_em) VALUES($1,$2,'cliente','Histórico fictício preservado','text','recebido',now()-interval '1 day')",[mensagemId,conversaId]);
 return {telefone,conversaId,mensagemId};
}
try{
 const grants=(await pool.query("SELECT has_table_privilege('donatella_operacao_app','atendimento_operacao.agente_teste','INSERT') inserir,has_table_privilege('donatella_operacao_app','atendimento_operacao.agente_teste','DELETE') excluir,has_table_privilege('donatella_operacao_backup','atendimento_operacao.agente_teste','SELECT') backup_ler")).rows[0];igual(grants,{inserir:true,excluir:false,backup_ler:true});
 const primeiro=await atual();igual(primeiro.configuracao.modo,'desligado');
 const conteudo:ConfiguracaoAgente={...primeiro.configuracao,modelo,maxTokens:512,custoCentavosDia:500,limites:{maxChamadas:3,custoPorChamadaCentavos:50,maxCustoCentavos:150,maxDuracaoMs:45000,timeoutChamadaMs:15000}};
 await agente.configurar(ana,{conteudo,versao:primeiro.versao,idempotencia:randomUUID()});igual((await atual()).configuracao.modo,'desligado');
 igual((await agente.estado(ana)).prontoParaLigar,false);await recusar(()=>mudar('ligar'),'NAO_PRONTO');
 await pool.query("INSERT INTO atendimento_operacao.configuracao(chave,conteudo) VALUES('agente_legado',$1::jsonb) ON CONFLICT(chave) DO UPDATE SET conteudo=excluded.conteudo",[JSON.stringify({horarios:{timezone:'America/Sao_Paulo',inicio:'09:00',fim:'18:00',dias:[1,2,3,4,5],equipes:[],feriados:[],respostaForaHorario:'A equipe retornará no próximo horário de atendimento.',cooldownMinutos:60}})]);
 // Alterar o horário não apaga condições revisadas nem habilita automações.
 const atendimentoPreservado={agente:{modo:'desligado',modelo},automacoes:false,horarios:{inicio:'09:00',fim:'18:00',dias:[1,2,3,4,5]},condicoesEntrega:'Condição fictícia revisada.',entregaAprovada:true,campoPreservado:{origem:'fixture',versao:7}};
 await pool.query("INSERT INTO atendimento_operacao.configuracao(chave,conteudo) VALUES('atendimento',$1::jsonb) ON CONFLICT(chave) DO UPDATE SET conteudo=excluded.conteudo",[JSON.stringify(atendimentoPreservado)]);
 const web=await repo.configuracaoWeb(ana),pedidoWeb={...web,agente:{modo:'desligado',modelo},horarios:{inicio:'10:00',fim:'17:00',dias:[1,2,3,4,5]},automacoes:false,idempotencia:randomUUID()};
 await repo.salvarConfiguracaoWeb(ana,pedidoWeb);
 const atendimentoSalvo=(await pool.query("SELECT conteudo FROM atendimento_operacao.configuracao WHERE chave='atendimento'")).rows[0].conteudo;
 igual(atendimentoSalvo.condicoesEntrega,atendimentoPreservado.condicoesEntrega);igual(atendimentoSalvo.entregaAprovada,true);igual(atendimentoSalvo.campoPreservado,atendimentoPreservado.campoPreservado);igual(atendimentoSalvo.horarios,pedidoWeb.horarios);igual((await atual()).configuracao.modo,'desligado');
 const novaVersaoWeb=(await repo.configuracaoWeb(ana)).versao;
 await recusar(()=>repo.salvarConfiguracaoWeb(ana,{...pedidoWeb,versao:novaVersaoWeb,idempotencia:randomUUID(),agente:{modo:'automatico',modelo}}),'CONTROLE_DEDICADO');
 await recusar(()=>repo.salvarConfiguracaoWeb(ana,{...pedidoWeb,versao:novaVersaoWeb,idempotencia:randomUUID(),automacoes:true}),'CONTROLE_DEDICADO');
 await recusar(()=>repo.salvarConfiguracaoWeb(ana,{...pedidoWeb,versao:novaVersaoWeb,idempotencia:randomUUID(),horarios:{...pedidoWeb.horarios,dias:[]}}),'CONFIGURACAO_INVALIDA');
 await recusar(()=>repo.salvarConfiguracaoWeb(ana,{...pedidoWeb,versao:novaVersaoWeb,idempotencia:randomUUID(),horarios:{...pedidoWeb.horarios,inicio:'18:00',fim:'09:00'}}),'CONFIGURACAO_INVALIDA');
 igual((await repo.configuracaoWeb(ana)).versao,novaVersaoWeb);
 await recusar(async()=>agente.configurar(ana,{conteudo:{...conteudo,modo:'automatico',autoridadeAutomatica:true},versao:(await atual()).versao,idempotencia:randomUUID()}),'USE_CONTROLE');
 // Operação usa o limite diário próprio. Seu histórico não consome outra vez
 // o orçamento total de ensaios reconciliado em 450 centavos.
 await pool.query("INSERT INTO atendimento_operacao.agente_orcamento(empresa_id,dia,reservado_centavos) VALUES('grazing','2000-01-01',600)");
 let estado=await agente.estado(ana);igual(estado.prontoParaLigar,true);igual(estado.teste.reservadoCentavos,450);igual(estado.consumo.totalReservadoCentavos,600);igual(estado.controle.ativadaEm,null);igual(estado.controle.habilitada,false);
 const antes=await efeitos(),pTeste={pergunta:'Como funciona o atendimento neste ensaio?',versao:(await atual()).versao,idempotencia:randomUUID()};
 const r=await agente.testar(ana,pTeste);igual(r.estado,'concluido');igual(r.enviosReais,false);igual(r.reservaCentavos,50);ok(r.texto.includes('fictício'));igual(r.consumo?.tokensEntrada,100);igual(await efeitos(),antes);igual((await atual()).configuracao.modo,'desligado');igual(modelos,1);
 igual(await agente.testar(ana,pTeste),r);igual(modelos,1);await recusar(()=>agente.testar(ana,{...pTeste,pergunta:'Outro ensaio'}),'IDEMPOTENCIA');
 const apoio=await testar('Quero falar com um atendente humano');igual(apoio.estado,'apoio');igual(apoio.motivo,'HUMANO_SOLICITADO');igual(apoio.reservaCentavos,0);igual(modelos,1);igual(await efeitos(),antes);
 const preco=await testar('Qual o preço e o prazo?');igual(preco.estado,'apoio');igual(preco.reservaCentavos,0);igual(modelos,1);
 autorizado=false;await recusar(()=>mudar('ligar'),'ACESSO_NEGADO');await recusar(()=>agente.testar(ana,pTeste),'ACESSO_NEGADO');autorizado=true;
 await recusar(async()=>agente.controlar({...ana,tipo:'ia'},{acao:'ligar',versao:(await atual()).versao,idempotencia:randomUUID()}),'ACESSO_NEGADO');
 privada.creditoApiConfirmado=false;estado=await agente.estado(ana);igual(estado.prontoParaLigar,false);ok(estado.pendencias.some(v=>v.includes('Crédito')));await recusar(()=>mudar('ligar'),'NAO_PRONTO');privada.creditoApiConfirmado=true;
 igual((await entrada(true)).r.agendada,false);igual((await entrada(false)).r.agendada,false);
 const ligar={acao:'ligar' as const,versao:(await atual()).versao,idempotencia:randomUUID()},ligada=await agente.controlar(ana,ligar);igual(ligada.modo,'automatico');ok(ligada.ativadaEm);igual(await agente.controlar(ana,ligar),ligada);igual((await agente.estado(ana)).controle.habilitada,true);
 // Materialização real do webhook: marco da Meta, nova entrada, autoria e
 // reabertura usam a mesma fila persistente, sem chamar transporte algum.
 const depoisMarco=new Date(Date.parse(ligada.ativadaEm!)+5000).toISOString(),antesMarco=new Date(Date.parse(ligada.ativadaEm!)-86400000).toISOString();
 const eventoNovo=evento(telefoneFicticio(),depoisMarco),recebida=await materializarEventoOperacao(recepcao,eventoNovo);ok('conversaId' in recebida);
 if(!('conversaId' in recebida)||typeof recebida.conversaId!=='string')throw Error('CONVERSA_FICTICIA_AUSENTE');
 const idRecebida=recebida.conversaId;igual((await lerConversa(idRecebida)).estado,'ia');igual(await tarefasConversa(idRecebida),1);
 const quantidadeMensagens=Number((await pool.query('SELECT count(*)::int total FROM atendimento_operacao.mensagem WHERE conversa_id=$1',[idRecebida])).rows[0].total);
 igual(await materializarEventoOperacao(recepcao,eventoNovo),{duplicada:true});igual(await tarefasConversa(idRecebida),1);igual(Number((await pool.query('SELECT count(*)::int total FROM atendimento_operacao.mensagem WHERE conversa_id=$1',[idRecebida])).rows[0].total),quantidadeMensagens);
 const humanaExistente=await conversaHumanaFicticia();const mensagemHumana=await materializarEventoOperacao(recepcao,evento(humanaExistente.telefone,depoisMarco));ok('conversaId' in mensagemHumana&&mensagemHumana.conversaId===humanaExistente.conversaId);igual((await lerConversa(humanaExistente.conversaId)).estado,'humano');igual((await lerConversa(humanaExistente.conversaId)).responsavel_id,ana.id);igual(await tarefasConversa(humanaExistente.conversaId),0);
 const antigaRecebida=await materializarEventoOperacao(recepcao,evento(telefoneFicticio(),antesMarco));ok('conversaId' in antigaRecebida);
 if(!('conversaId' in antigaRecebida)||typeof antigaRecebida.conversaId!=='string')throw Error('CONVERSA_ANTIGA_FICTICIA_AUSENTE');igual((await lerConversa(antigaRecebida.conversaId)).estado,'humano');igual(await tarefasConversa(antigaRecebida.conversaId),0);
 const tarefasAntesStatus=Number((await pool.query('SELECT count(*)::int total FROM atendimento_operacao.agente_tarefa')).rows[0].total);
 igual(await materializarEventoOperacao(recepcao,{tipo:'status',chave:randomUUID(),waba:'1234567890123',numero:numeroId,conteudo:{item:{id:'wamid.fixture-painel-status',status:'delivered',timestamp:String(Math.floor(Date.parse(depoisMarco)/1000))}}}),{statusPreservado:true});igual(Number((await pool.query('SELECT count(*)::int total FROM atendimento_operacao.agente_tarefa')).rows[0].total),tarefasAntesStatus);
 const encerrada=await conversaHumanaFicticia('encerrada'),reaberta=await materializarEventoOperacao(recepcao,evento(encerrada.telefone,depoisMarco));ok('conversaId' in reaberta&&reaberta.conversaId===encerrada.conversaId);igual((await lerConversa(encerrada.conversaId)).estado,'humano');igual((await lerConversa(encerrada.conversaId)).responsavel_id,ana.id);igual(await tarefasConversa(encerrada.conversaId),0);
 const historicoReaberto=(await pool.query('SELECT id,conteudo FROM atendimento_operacao.mensagem WHERE conversa_id=$1 ORDER BY criada_em,id',[encerrada.conversaId])).rows;igual(historicoReaberto.length,2);ok(historicoReaberto.some(v=>v.id===encerrada.mensagemId&&v.conteudo==='Histórico fictício preservado'));ok(historicoReaberto.some(v=>v.conteudo==='Entrada fictícia para conferir autoridade'));
 igual((await entrada(true)).r.agendada,false);igual((await entrada(false,'humano')).r.agendada,false);const nova=await entrada(false);igual(nova.r.agendada,true);
 const tarefa=(await pool.query<{tarefa:TarefaIA}>('SELECT tarefa FROM atendimento_operacao.agente_tarefa WHERE mensagem_id=$1',[nova.mensagemId])).rows[0].tarefa;
 igual(await agente.repositorio.configuracaoVigente(tarefa),true);igual(hashTarefaAgente(tarefa).length,64);
 // Uma resposta pendente perde autoridade ao pausar; histórico e conversa ficam.
 const envio=await repo.enfileirar({id:'service:donatella-ia',nome:'Donatella',perfilId:'servico-donatella',sessaoVersao:1,permissoes:[],tipo:'ia'},{conversaId:nova.conversaId,versao:1,idempotencia:randomUUID(),tipo:'text',texto:'Resposta fictícia'},'ia').catch(()=>null);
 // A fixture não recebe janela válida por esta inserção direta; cria intenção
 // mínima quando a validação de janela a recusa, para testar cancelamento real.
 let intencaoId=envio?.id;
 if(!intencaoId){intencaoId=randomUUID();const mensagemId=randomUUID();await pool.query("INSERT INTO atendimento_operacao.mensagem(id,conversa_id,autor,conteudo,tipo,estado) VALUES($1,$2,'ia','Resposta fictícia','text','pendente')",[mensagemId,nova.conversaId]);await pool.query("INSERT INTO atendimento_operacao.intencao(id,conversa_id,mensagem_id,autor_id,versao_conversa,hash,conteudo) VALUES($1,$2,$3,'service:donatella-ia',1,$4,$5::jsonb)",[intencaoId,nova.conversaId,mensagemId,'a'.repeat(64),JSON.stringify({autor:'ia',tipo:'text'})]);}
 await pool.query('UPDATE atendimento_operacao.agente_tarefa SET intencao_id=$2 WHERE mensagem_id=$1',[nova.mensagemId,intencaoId]);
 const pausada=await mudar('pausar');igual(pausada.modo,'desligado');igual(pausada.ativadaEm,null);ok(pausada.intencoesCanceladas>=1);igual((await pool.query('SELECT estado FROM atendimento_operacao.intencao WHERE id=$1',[intencaoId])).rows[0].estado,'cancelado');igual(await agente.repositorio.configuracaoVigente(tarefa),false);
 agente=servico();igual((await atual()).configuracao.modo,'desligado');igual((await agente.estado(ana)).controle.ativadaEm,null);igual(await agente.processarProxima(),{estado:'desligado'});
 const cfgAntes=await atual();duranteModelo=async()=>{await mudar('pausar');};const obsoleta=await testar();igual(obsoleta.estado,'falha');igual(obsoleta.reservaCentavos,50);ok((await atual()).versao>cfgAntes.versao);igual((await atual()).configuracao.modo,'desligado');
 retornoModelo='incerto';const pIncerto={pergunta:pTeste.pergunta,versao:(await atual()).versao,idempotencia:randomUUID()},incerto=await agente.testar(ana,pIncerto);igual(incerto.estado,'incerto');igual(incerto.reservaCentavos,50);const antesReplay=modelos;igual(await agente.testar(ana,pIncerto),incerto);igual(modelos,antesReplay);retornoModelo='concluido';
 privada.orcamentoTestesTotalCentavos=600;const limite=await testar();igual(limite.estado,'apoio');igual(limite.reservaCentavos,0);igual(modelos,antesReplay);privada.orcamentoTestesTotalCentavos=1000;
 const auditoria=(await pool.query("SELECT acao,autor_id FROM atendimento_operacao.auditoria WHERE entidade_id='agente' AND acao IN ('ligar_donatella','pausar_donatella')")).rows;ok(auditoria.some(v=>v.acao==='ligar_donatella'&&v.autor_id===ana.id));ok(auditoria.some(v=>v.acao==='pausar_donatella'&&v.autor_id===ana.id));
 // Conhecimento inicial vem do documento do proprietário. Não finge uma
 // conversa nem promove o prompt legado como fonte comercial aprovada.
 const preparacao={idempotencia:randomUUID(),documentoSha256:'d'.repeat(64),modelo,orcamentoMaximoCentavosDia:500};
 const efeitosPreparo=await efeitos(),apoiosAntes=Number((await pool.query('SELECT count(*)::int total FROM atendimento_apoio.casos')).rows[0].total),reservasAntes=(await agente.estado(ana)).teste.reservadoCentavos;
 direitos.delete('conhecimento.editar');await recusar(()=>prepararDonatellaPainel(repo,ana,preparacao),'ACESSO_NEGADO');direitos.add('conhecimento.editar');
 await mudar('ligar');await recusar(()=>prepararDonatellaPainel(repo,ana,preparacao),'EXIGE_DESLIGADA');await mudar('pausar');
 await pool.query("UPDATE atendimento_operacao.configuracao SET conteudo=conteudo||'{\"promptReferencia\":\"Referência histórica fictícia preservada\"}'::jsonb WHERE chave='agente_legado'");
 const preparado=await prepararDonatellaPainel(repo,ana,preparacao);igual(preparado.modo,'desligado');igual(preparado.autoridadeAutomatica,false);igual(preparado.conhecimentosCriados,4);igual(preparado.enviosExternos,0);igual(preparado.inferencias,0);igual(await efeitos(),efeitosPreparo);igual(Number((await pool.query('SELECT count(*)::int total FROM atendimento_apoio.casos')).rows[0].total),apoiosAntes);igual((await agente.estado(ana)).teste.reservadoCentavos,reservasAntes);
 const conhecimentos=(await pool.query('SELECT conteudo FROM atendimento_apoio.candidatos')).rows;igual(conhecimentos.length,4);ok(conhecimentos.every(v=>{const f=v.conteudo.versoes.at(-1);return f.estado==='aprovado'&&f.escopo==='oficial'&&f.minimizacaoRevisada===true&&f.fonteCasoId==='documento:'+DOCUMENTO_PREPARACAO_DONATELLA&&f.fonteDocumento.nome===DOCUMENTO_PREPARACAO_DONATELLA&&f.fonteDocumento.sha256===preparacao.documentoSha256&&!f.clienteId&&!f.conversaId;}));igual(Number((await pool.query("SELECT count(*)::int total FROM atendimento_apoio.revisoes WHERE colecao='candidatos'")).rows[0].total),4);
 const tomPreparado=await agente.tom(ana),skillsPreparadas=await agente.skills(ana);igual(tomPreparado.conteudo.nome,'Donatella');igual(tomPreparado.conteudo.emojis,'moderado');ok(skillsPreparadas.conteudo.skills.some(s=>s.id==='eventos'&&s.habilitada));ok(skillsPreparadas.conteudo.skills.filter(s=>['pedido','entrega','agenda'].includes(s.id)).every(s=>!s.habilitada));ok(skillsPreparadas.conteudo.skills.find(s=>s.id==='catalogo')?.ferramentas.includes('consultar_conhecimento'));
 const fontesOficiais=await agente.duvidas(ana).consultarConhecimento({id:ana.id,empresaId:'grazing',versaoSessao:ana.sessaoVersao},{empresaId:'grazing',tema:'produto'});ok(fontesOficiais.length>0);ok(fontesOficiais.every(f=>f.escopo==='oficial'&&f.fonteCasoId.startsWith('documento:')));
 const versaoPreparo=(await atual()).versao,auditoriasPreparo=Number((await pool.query('SELECT count(*)::int total FROM atendimento_operacao.auditoria')).rows[0].total);igual(await prepararDonatellaPainel(repo,ana,preparacao),preparado);igual((await atual()).versao,versaoPreparo);igual(Number((await pool.query('SELECT count(*)::int total FROM atendimento_operacao.auditoria')).rows[0].total),auditoriasPreparo);igual((await pool.query("SELECT conteudo->>'promptReferencia' referencia FROM atendimento_operacao.configuracao WHERE chave='agente_legado'")).rows[0].referencia,'Referência histórica fictícia preservada');
 const reutilizada=await prepararDonatellaPainel(repo,ana,{...preparacao,idempotencia:randomUUID()});igual(reutilizada.conhecimentosCriados,0);igual(reutilizada.conhecimentosReutilizados,4);igual((await atual()).versao,versaoPreparo);igual((await atual()).configuracao.modo,'desligado');igual((await atual()).configuracao.custoCentavosDia,500);
 igual(metas,0);igual((await atual()).configuracao.modo,'desligado');console.log(JSON.stringify({ensaio:'agente-painel',assercoes,chamadasModeloSimuladas:modelos,chamadasMeta:metas,modoFinal:'desligado',dados:'ficticios'}));
}finally{await pool.end();}
