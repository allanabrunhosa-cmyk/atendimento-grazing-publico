import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {Pool} from 'pg';
import {RepositorioOperacaoPg} from '../../src/lib/atendimento/operacao-repositorio-pg';
import {ServicoAgenteOperacional,type ConfiguracaoPrivadaAgente} from '../../src/lib/atendimento/operacao-agente';
import type {AcaoOperacao,IdentidadeOperacao} from '../../src/lib/atendimento/operacao-tipos';
import type {PedidoSalvarAgente,PedidoControleAgente} from '../../src/lib/atendimento/operacao-agente-painel';
import {criarHandlerOperacao} from '../../scripts/atendimento/operacao-servidor';
import {criarExtensaoAgenteOperacional} from '../../src/lib/atendimento/operacao-agente-http';
import {criarClienteOperacao,ErroOperacao} from '../../apps/atendimento-chat-consulta/operacao-api';
import type {RepositorioEntradaPg} from '../../src/lib/atendimento/operacao-repositorio-pg';

const endereco=process.env.OPERACAO_BANCO_TESTE??'',url=new URL(endereco);
if(url.protocol!=='postgresql:'||url.pathname!=='/donatella_ensaio_operacao'||!['127.0.0.1','localhost'].includes(url.hostname))throw Error('ENSAIO_ISOLADO_EXIGIDO');
const pool=new Pool({connectionString:endereco,max:5}),modelo='claude-sonnet-4-5-20250929';
const ana:IdentidadeOperacao={id:'fixture-reconciliacao-ana',nome:'Ana Fictícia',perfilId:'fixture',sessaoVersao:1,permissoes:[],tipo:'usuario'},bia={...ana,id:'fixture-reconciliacao-bia',nome:'Bia Fictícia'};
let permissoes=true,assercoes=0,chamadasExternas=0;
const direitos=new Set<AcaoOperacao>(['consultar','ia.visualizar','ia.editar']);
const autorizar=async(i:IdentidadeOperacao,a:AcaoOperacao)=>permissoes&&[ana.id,bia.id].includes(i.id)&&direitos.has(a);
const repo=new RepositorioOperacaoPg(pool,autorizar,()=> 'homologacao','/tmp/reconciliacao-ficticia');
const privada:ConfiguracaoPrivadaAgente={empresaId:'grazing',anthropic:{chave:'chave-ficticia',modelo,maxTokens:512},custoVozCentavos:0,orcamentoMaximoCentavosDia:500,autoridadeAutomatica:true,inferenciaHabilitada:true,painelHabilitado:true,consumoOperacaoAutorizado:true,creditoApiConfirmado:true,testesAutorizados:false,orcamentoTestesTotalCentavos:1000,reservaHistoricaTestesCentavos:450,enviosHumanosHabilitados:true,sinteseVozHabilitada:false,automacoesApoioHabilitadas:false,capacidadesProvedores:[{id:'anthropic',disponivel:true,modelos:[{id:modelo,nome:modelo,disponivel:true,testado:true}]}]};
const fetchLoopback=globalThis.fetch;
globalThis.fetch=async()=>{chamadasExternas++;throw Error('TRANSPORTE_EXTERNO_PROIBIDO');};
const agente=new ServicoAgenteOperacional({operacao:repo,configuracao:privada,carregarMidia:async()=>null});
const igual=(a:unknown,b:unknown)=>{assert.deepEqual(a,b);assercoes++;},ok=(v:unknown)=>{assert.ok(v);assercoes++;};
const recusar=async(f:()=>Promise<unknown>,codigo:string)=>{await assert.rejects(f,new RegExp(codigo));assercoes++;};
const atual=()=>agente.repositorio.configuracao();
const fotografia=async()=>(await pool.query(`SELECT
 (SELECT jsonb_agg(jsonb_build_object('chave',chave,'conteudo',conteudo,'versao',versao) ORDER BY chave) FROM atendimento_operacao.configuracao) configuracoes,
 (SELECT count(*)::int FROM atendimento_operacao.comando) comandos,
 (SELECT count(*)::int FROM atendimento_operacao.auditoria) auditorias,
 (SELECT count(*)::int FROM atendimento_operacao.agente_tarefa) tarefas,
 (SELECT count(*)::int FROM atendimento_operacao.intencao) intencoes,
 (SELECT count(*)::int FROM atendimento_operacao.mensagem) mensagens,
 (SELECT jsonb_agg(to_jsonb(c)) FROM atendimento_operacao.agente_controle c) controle`)).rows[0];
try{
 const inicial=await atual();igual(inicial.configuracao.modo,'desligado');
 await pool.query("INSERT INTO atendimento_operacao.configuracao(chave,conteudo) VALUES('agente_legado',$1::jsonb)",[JSON.stringify({horarios:{timezone:'America/Sao_Paulo',inicio:'00:00',fim:'23:59',dias:[0,1,2,3,4,5,6],equipes:[],feriados:[],respostaForaHorario:'Retorno da equipe no horário de atendimento.',cooldownMinutos:60}})]);
 const salvar:PedidoSalvarAgente={conteudo:{...inicial.configuracao,modelo,maxTokens:512,custoCentavosDia:500,limites:{maxChamadas:3,custoPorChamadaCentavos:50,maxCustoCentavos:150,maxDuracaoMs:45000,timeoutChamadaMs:15000}},versao:inicial.versao,idempotencia:randomUUID()};
 const antes=await fotografia();igual(await agente.reconciliar(ana,{tipo:'salvar',pedido:salvar}),{estado:'nao_registrada',versao:null});igual(await fotografia(),antes);
 const salvo=await agente.configurar(ana,salvar),aposSalvar=await fotografia();igual(await agente.reconciliar(ana,{tipo:'salvar',pedido:salvar}),{estado:'confirmada',versao:salvo.versao});igual(await fotografia(),aposSalvar);
 igual(await agente.reconciliar(ana,{tipo:'salvar',pedido:{...salvar,conteudo:{...salvar.conteudo,maxTokens:256}}}),{estado:'nao_registrada',versao:null});igual(await agente.reconciliar(bia,{tipo:'salvar',pedido:salvar}),{estado:'nao_registrada',versao:null});igual(await agente.reconciliar(ana,{tipo:'controle',pedido:{acao:'pausar',versao:salvar.versao,idempotencia:salvar.idempotencia}}),{estado:'nao_registrada',versao:null});igual(await fotografia(),aposSalvar);
 permissoes=false;await recusar(()=>agente.reconciliar(ana,{tipo:'salvar',pedido:salvar}),'ACESSO_NEGADO');permissoes=true;await recusar(()=>agente.reconciliar({...ana,tipo:'ia'},{tipo:'salvar',pedido:salvar}),'ACESSO_NEGADO');
 const recusada:PedidoSalvarAgente={...salvar,conteudo:{...salvar.conteudo,modo:'automatico',autoridadeAutomatica:true},versao:salvo.versao,idempotencia:randomUUID()};await recusar(()=>agente.configurar(ana,recusada),'USE_CONTROLE');const antesRecusada=await fotografia();igual(await agente.reconciliar(ana,{tipo:'salvar',pedido:recusada}),{estado:'nao_registrada',versao:null});igual(await fotografia(),antesRecusada);
 let estado=await agente.estado(ana);igual(estado.estadoEfetivo,'desligada');igual(estado.enviosHumanosHabilitados,true);igual(estado.enviosReais,false);igual(estado.modo,'desligado');
 const ligar:PedidoControleAgente={acao:'ligar',versao:(await atual()).versao,idempotencia:randomUUID()};igual(await agente.reconciliar(ana,{tipo:'controle',pedido:ligar}),{estado:'nao_registrada',versao:null});const ligada=await agente.controlar(ana,ligar),fotoLigada=await fotografia();igual(await agente.reconciliar(ana,{tipo:'controle',pedido:ligar}),{estado:'confirmada',versao:ligada.versao});igual(await fotografia(),fotoLigada);igual(await agente.controlar(ana,ligar),ligada);
 estado=await agente.estado(ana);igual(estado.estadoEfetivo,'ligada');igual(estado.modo,'automatico');igual(estado.enviosHumanosHabilitados,true);ok(estado.controle.ativadaEm);
 privada.autoridadeAutomatica=false;estado=await agente.estado(ana);igual(estado.estadoEfetivo,'bloqueada');igual(estado.modo,'automatico');igual(estado.enviosHumanosHabilitados,true);igual(estado.enviosReais,false);privada.autoridadeAutomatica=true;
 // Sem marco a configuração salva não é prova de uma ativação efetiva.
 const marco=(await pool.query('SELECT ativada_em FROM atendimento_operacao.agente_controle WHERE empresa_id=$1',['grazing'])).rows[0].ativada_em;await pool.query('UPDATE atendimento_operacao.agente_controle SET ativada_em=NULL WHERE empresa_id=$1',['grazing']);igual((await agente.estado(ana)).estadoEfetivo,'bloqueada');await pool.query('UPDATE atendimento_operacao.agente_controle SET ativada_em=$2 WHERE empresa_id=$1',['grazing',marco]);
 const pausar:PedidoControleAgente={acao:'pausar',versao:(await atual()).versao,idempotencia:randomUUID()},pausada=await agente.controlar(ana,pausar);igual(await agente.reconciliar(ana,{tipo:'controle',pedido:pausar}),{estado:'confirmada',versao:pausada.versao});const pausadaFoto=await fotografia();igual(await agente.reconciliar(ana,{tipo:'controle',pedido:ligar}),{estado:'confirmada',versao:ligada.versao});igual(await fotografia(),pausadaFoto);igual((await agente.estado(ana)).estadoEfetivo,'desligada');igual((await atual()).configuracao.modo,'desligado');igual(chamadasExternas,0);
 // A mesma trava do gravador impede uma leitura de ausência antes do commit.
 const bloqueio=await pool.connect(),testeConcorrente:PedidoControleAgente={acao:'pausar',versao:pausada.versao,idempotencia:randomUUID()};
 try{await bloqueio.query('BEGIN');await bloqueio.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['comando:'+testeConcorrente.idempotencia]);let concluiu=false;const consulta=agente.reconciliar(ana,{tipo:'controle',pedido:testeConcorrente}).then(r=>{concluiu=true;return r;});await new Promise(r=>setTimeout(r,80));igual(concluiu,false);await bloqueio.query('ROLLBACK');igual(await consulta,{estado:'nao_registrada',versao:null});}finally{await bloqueio.query('ROLLBACK').catch(()=>undefined);bloqueio.release();}
 igual(await fotografia(),pausadaFoto);igual(chamadasExternas,0);
 // Cliente publicado → HTTP real em loopback → serviço e PostgreSQL reais.
 // O transporte geral continua bloqueado; só esta referência permite loopback.
 let origemHttp='',handler:ReturnType<typeof criarHandlerOperacao>|undefined,pedidosHttp=0,perderRota='',perderMetodo='POST';
 const servidor=createServer((req,res)=>{pedidosHttp++;void handler!(req,res).then(atendida=>{if(!atendida){res.writeHead(404);res.end();}}).catch(()=>{res.writeHead(500);res.end();});});
 await new Promise<void>((resolve,reject)=>{servidor.once('error',reject);servidor.listen(0,'127.0.0.1',resolve);});
 try{
  const enderecoHttp=servidor.address();assert.ok(enderecoHttp&&typeof enderecoHttp==='object');origemHttp='http://127.0.0.1:'+enderecoHttp.port;
  handler=criarHandlerOperacao({repo,entrada:{} as RepositorioEntradaPg,webhook:null,origem:origemHttp,somenteChatHumano:true,painelDonatellaPreparado:true,autenticar:async()=>({...ana,permissoes:[...direitos]}),conferirCsrf:async req=>req.headers['x-csrf-token']==='csrf-ficticio',sessao:async()=>({csrf:'csrf-ficticio'}),listarEquipe:async()=>({usuarios:[],equipes:[]}),registrarErroAgente:()=>undefined,extensao:criarExtensaoAgenteOperacional(agente,'grazing')});
  const transporteLocal:typeof fetch=async(input,init)=>{const alvo=new URL(String(input),origemHttp);if(alvo.origin!==origemHttp||alvo.hostname!=='127.0.0.1')throw Error('LOOPBACK_EXIGIDO');const headers=new Headers(init?.headers);headers.set('Origin',origemHttp);const r=await fetchLoopback(alvo,{...init,headers});if(alvo.pathname.endsWith(perderRota)&&perderRota&&(init?.method??'GET')===perderMetodo){perderRota='';await r.arrayBuffer();throw Error('RESPOSTA_PERDIDA_SIMULADA');}return r;};
  const cliente=criarClienteOperacao(transporteLocal,'ensaio');await cliente.sessao();let visto=await cliente.agente();igual(visto.estadoEfetivo,'desligada');igual(visto.enviosHumanosHabilitados,true);
  const escritaHttp:PedidoSalvarAgente={conteudo:{...(await atual()).configuracao,maxTokens:384},versao:visto.versao,idempotencia:randomUUID()},fotoAntesHttp=await fotografia();
  perderRota='/agente/configurar';await recusar(()=>cliente.configurarAgente(escritaHttp),'RESULTADO_INCERTO');const fotoDepoisHttp=await fotografia();igual(fotoDepoisHttp.comandos,fotoAntesHttp.comandos+1);igual((await atual()).configuracao.maxTokens,384);
  igual(await cliente.reconciliarAgente({tipo:'salvar',pedido:escritaHttp}),{estado:'confirmada',versao:escritaHttp.versao+1});igual(await fotografia(),fotoDepoisHttp);visto=await cliente.agente();igual(visto.versao,escritaHttp.versao+1);igual(visto.estadoEfetivo,'desligada');
  // O replay usa o recibo original; nunca cria uma nova versão da configuração.
  igual(await cliente.configurarAgente(escritaHttp),{versao:escritaHttp.versao+1});igual(await fotografia(),fotoDepoisHttp);
  const ativarHttp:PedidoControleAgente={acao:'ligar',versao:visto.versao,idempotencia:randomUUID()};perderRota='/agente/controle';await recusar(()=>cliente.controlarAgente(ativarHttp),'RESULTADO_INCERTO');const fotoAtivadaHttp=await fotografia();igual(await cliente.reconciliarAgente({tipo:'controle',pedido:ativarHttp}),{estado:'confirmada',versao:ativarHttp.versao+1});igual(await fotografia(),fotoAtivadaHttp);visto=await cliente.agente();igual(visto.estadoEfetivo,'ligada');igual(visto.versao,ativarHttp.versao+1);igual(visto.enviosHumanosHabilitados,true);igual(await cliente.controlarAgente(ativarHttp),{versao:ativarHttp.versao+1});igual(await fotografia(),fotoAtivadaHttp);
  // Uma falha no GET seguinte não desfaz nem repete o POST já confirmado.
  const pausarHttp:PedidoControleAgente={acao:'pausar',versao:visto.versao,idempotencia:randomUUID()};igual(await cliente.controlarAgente(pausarHttp),{versao:pausarHttp.versao+1});const fotoPausadaHttp=await fotografia();perderRota='/agente';perderMetodo='GET';await recusar(()=>cliente.agente(),'INDISPONIVEL');igual(await cliente.reconciliarAgente({tipo:'controle',pedido:pausarHttp}),{estado:'confirmada',versao:pausarHttp.versao+1});igual(await fotografia(),fotoPausadaHttp);visto=await cliente.agente();igual(visto.estadoEfetivo,'desligada');igual(visto.versao,pausarHttp.versao+1);
  const nuncaEnviado:PedidoControleAgente={acao:'pausar',versao:visto.versao,idempotencia:randomUUID()};igual(await cliente.reconciliarAgente({tipo:'controle',pedido:nuncaEnviado}),{estado:'nao_registrada',versao:null});igual(await fotografia(),fotoPausadaHttp);
  direitos.delete('ia.editar');await assert.rejects(()=>cliente.reconciliarAgente({tipo:'controle',pedido:pausarHttp}),e=>e instanceof ErroOperacao&&e.codigo==='PERMISSAO'&&e.status===403);assercoes++;direitos.add('ia.editar');igual(await fotografia(),fotoPausadaHttp);
  await assert.rejects(()=>cliente.configurarAgente({...escritaHttp,conteudo:{...escritaHttp.conteudo,modo:'automatico',autoridadeAutomatica:true},versao:visto.versao,idempotencia:randomUUID()}),e=>e instanceof ErroOperacao&&e.codigo==='AGENTE_CONTROLE'&&e.status===409);assercoes++;igual(await fotografia(),fotoPausadaHttp);igual(pedidosHttp,17);igual(chamadasExternas,0);igual((await atual()).configuracao.modo,'desligado');
 }finally{handler?.encerrarEventos();await new Promise<void>((resolve,reject)=>servidor.close(e=>e?reject(e):resolve()));}
 console.log(JSON.stringify({ensaio:'agente-reconciliacao',assercoes,consultas:'sem_efeitos',autorizacao:'conferida',hashAutor:'exatos',trava:'aguarda_commit_ou_rollback',http:{pedidos:pedidosHttp,transporte:'loopback_real',cliente:'publicado',respostaPerdida:['salvar','ligar'],atualizacaoPerdida:'GET_apos_pausar',replay:'mesmo_uuid_sem_nova_gravacao'},modoFinal:'desligado',estadoHumano:'independente',chamadasExternas,dados:'ficticios'}));
}finally{await pool.end();}
