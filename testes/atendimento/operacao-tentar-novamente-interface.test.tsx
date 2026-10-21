// @vitest-environment jsdom
import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import ChatOperacao from '../../apps/atendimento-chat-consulta/ChatOperacao';
import {criarClienteOperacao,type MensagemOperacao,type PermissaoOperacao,type ConversaOperacao} from '../../apps/atendimento-chat-consulta/operacao-api';

const conversaId='11111111-1111-4111-8111-111111111111',mensagemId='22222222-2222-4222-8222-222222222222',intencaoId='33333333-3333-4333-8333-333333333333',novaIntencaoId='44444444-4444-4444-8444-444444444444';
const em='2026-10-14T12:00:00.000Z';
const json=(valor:unknown,status=200)=>new Response(JSON.stringify(valor),{status,headers:{'content-type':'application/json'}});
const mensagemBase:MensagemOperacao={id:mensagemId,conversaId,autor:'humano',autorId:'atendente-ficticio',autorNome:'Atendente fictício',conteudo:'Resposta original fictícia',tipo:'text',estado:'recusado',falhaCodigo:'TRANSPORTE_RECUSADO',intencaoId,podeTentarNovamente:true,criadaEm:em,anexoId:null,citadaId:null};
const conversaBase:ConversaOperacao={id:conversaId,contatoId:'contato-ficticio',nome:'Conversa fictícia',telefone:null,canal:'whatsapp',estado:'humano',responsavelId:'atendente-ficticio',equipeId:null,tags:[],versao:7,ultimaMensagemEm:em,ficticia:true,somenteLeitura:false};
const permissoes:PermissaoOperacao[]=['consultar','atender','mensagens.visualizar','mensagens.adicionar'];

function fixture(opcoes:{mensagem?:Partial<MensagemOperacao>;conversa?:Partial<ConversaOperacao>;permissoes?:PermissaoOperacao[];ocultarMensagemDepoisDeAbrir?:boolean;responderTentativa?:(dados:Record<string,unknown>)=>Response|Promise<Response>}={}){
 let registro={...mensagemBase,...opcoes.mensagem},leiturasHistorico=0;
 let avisar:()=>void=()=>undefined;
 const conversa={...conversaBase,...opcoes.conversa};
 const buscar=vi.fn<typeof fetch>(async(entrada,init)=>{
  const url=new URL(String(entrada),'https://ficticio.invalid'),caminho=url.pathname.replace('/api/atendimento/operacao','');
  if(caminho==='/sessao')return json({usuario:{id:'atendente-ficticio',nome:'Atendente fictício',perfilId:'perfil-ficticio',permissoes:opcoes.permissoes??permissoes},csrf:'csrf-ficticio',modo:'homologacao',escritasReais:false});
  if(caminho==='/conversas')return json({registros:[conversa],mais:false,pagina:0});
  if(caminho==='/historico'){leiturasHistorico++;return json({conversa,registros:opcoes.ocultarMensagemDepoisDeAbrir&&leiturasHistorico>1?[]:[registro],notas:[],proxima:null});}
  if(caminho==='/mensagens/estado')return json({mensagemId:registro.id,intencaoId:registro.intencaoId,estado:registro.estado,falhaCodigo:registro.falhaCodigo,podeTentarNovamente:registro.podeTentarNovamente});
  if(caminho==='/rascunho')return json({texto:'Rascunho separado da nova mensagem',versao:2});
  if(caminho.endsWith('/abertura'))return json({registrada:true});
  if(caminho==='/mensagens/tentar-novamente'){
   const dados=JSON.parse(String(init?.body)) as Record<string,unknown>;
   if(opcoes.responderTentativa)return opcoes.responderTentativa(dados);
   registro={...registro,estado:'pendente',intencaoId:novaIntencaoId,podeTentarNovamente:false,falhaCodigo:null};return json({id:novaIntencaoId,mensagemId,estado:'pendente'},202);
  }
  if(caminho==='/status')return json({modo:'homologacao',enviosReais:false,receptor:'desarmado',fila:{pendentes:0,incertos:0,falhas:0},backup:{ultimoSucessoEm:null,falha:null},agente:{modo:'desligado',modelo:'modelo-ficticio',disponivel:false},atualizadoEm:em,importadoEm:em});
  throw new Error('ENDPOINT_FICTICIO_NAO_PREVISTO:'+caminho);
 });
 const cliente=criarClienteOperacao(buscar);
 cliente.observarChat=(atualizar)=>{avisar=()=>atualizar(false);return()=>undefined;};
 return {cliente,buscar,atualizar:(alteracao:Partial<MensagemOperacao>)=>{registro={...registro,...alteracao};avisar();},atualizarConversa:(alteracao:Partial<ConversaOperacao>)=>{Object.assign(conversa,alteracao);avisar();}};
}
async function abrir(){const lista=await screen.findByRole('region',{name:'Lista de conversas'});fireEvent.click(await within(lista).findByRole('button',{name:/Conversa fictícia/}));await screen.findByText('Resposta original fictícia');}
const botoesTentativa=()=>screen.queryAllByRole('button',{name:/Tentar novamente a mensagem de/});
const pedidosTentativa=(buscar:ReturnType<typeof fixture>['buscar'])=>buscar.mock.calls.filter(([url])=>String(url).endsWith('/mensagens/tentar-novamente'));
afterEach(()=>{cleanup();vi.restoreAllMocks();history.replaceState(null,'','/operacao/chat');});

it('tenta a mesma mensagem sem duplicar a bolha nem alterar o rascunho ou a citação do compositor',async()=>{
 const {cliente,buscar,atualizar}=fixture();const {container}=render(<ChatOperacao cliente={cliente}/>);await abrir();
 const campo=await screen.findByRole('textbox',{name:'Mensagem'});fireEvent.click(screen.getByRole('button',{name:'Responder a esta mensagem'}));
 const citacao=container.querySelector('.citacao-rascunho');fireEvent.click(botoesTentativa()[0]);
 await screen.findByText('Nova tentativa registrada. A mensagem será atualizada nesta conversa.');
 expect(container.querySelectorAll('article.balao')).toHaveLength(1);expect(screen.getAllByText('Resposta original fictícia')).toHaveLength(2);
 expect(campo).toHaveProperty('value','Rascunho separado da nova mensagem');expect(container.querySelector('.citacao-rascunho')).toBe(citacao);
 expect(pedidosTentativa(buscar)).toHaveLength(1);const pedido=pedidosTentativa(buscar)[0][1];
 expect(JSON.parse(String(pedido?.body))).toEqual({conversaId,mensagemId,intencaoId,versao:7,idempotencia:expect.any(String)});
 expect(pedido?.headers).toEqual({'Content-Type':'application/json','X-CSRF-Token':'csrf-ficticio'});
 expect(buscar.mock.calls.some(([url,init])=>String(url).endsWith('/mensagens/envio')||String(url).endsWith('/rascunho')&&init?.method==='PUT')).toBe(false);
 expect(botoesTentativa()).toHaveLength(0);atualizar({estado:'entregue'});await screen.findByLabelText('Estado da mensagem: entregue');expect(container.querySelectorAll('article.balao')).toHaveLength(1);
});

it('bloqueia clique duplo e o compositor durante a tentativa',async()=>{
 let liberar:(valor:Response)=>void=()=>undefined;const {cliente,buscar,atualizar}=fixture({responderTentativa:()=>new Promise<Response>(resolve=>{liberar=resolve;})});render(<ChatOperacao cliente={cliente}/>);await abrir();
 const botao=botoesTentativa()[0];fireEvent.click(botao);fireEvent.click(botao);await waitFor(()=>expect(pedidosTentativa(buscar)).toHaveLength(1));
 expect(botao).toHaveProperty('disabled',true);expect(botao.getAttribute('aria-busy')).toBe('true');expect(botao.textContent).toContain('Tentando novamente');expect(screen.getByRole('button',{name:'Enviar'})).toHaveProperty('disabled',true);
 atualizar({estado:'pendente',intencaoId:novaIntencaoId,podeTentarNovamente:false});liberar(json({id:novaIntencaoId,mensagemId,estado:'pendente'},202));await screen.findByText('Nova tentativa registrada. A mensagem será atualizada nesta conversa.');expect(botoesTentativa()).toHaveLength(0);
});

it.each(['recebido','aceito','aceito_simulado','sent','entregue','lido','delivered','read','pendente','processando','incerto'])('não oferece nova tentativa para estado %s mesmo com DTO permissivo',async(estado)=>{
 const {cliente,buscar}=fixture({mensagem:{estado}});render(<ChatOperacao cliente={cliente}/>);await abrir();expect(botoesTentativa()).toHaveLength(0);expect(pedidosTentativa(buscar)).toHaveLength(0);
});

it.each(['cliente','ia','automacao'] as const)('não oferece nova tentativa para autoria %s',async(autor)=>{
 const {cliente}=fixture({mensagem:{autor}});render(<ChatOperacao cliente={cliente}/>);await abrir();expect(botoesTentativa()).toHaveLength(0);
});

it.each([{podeTentarNovamente:false},{podeTentarNovamente:undefined},{intencaoId:null}])('não infere autorização para reenviar: %j',async(mensagem)=>{
 const {cliente}=fixture({mensagem});render(<ChatOperacao cliente={cliente}/>);await abrir();expect(botoesTentativa()).toHaveLength(0);
});

it.each([{estado:'encerrada' as const},{estado:'ia' as const},{estado:'pausado' as const},{somenteLeitura:true}])('não oferece nova tentativa para conversa bloqueada: %j',async(conversa)=>{
 const {cliente}=fixture({conversa});render(<ChatOperacao cliente={cliente}/>);await abrir();expect(botoesTentativa()).toHaveLength(0);
});

it('não oferece nova tentativa sem permissão de adicionar mensagens',async()=>{
 const {cliente}=fixture({permissoes:['consultar','atender','mensagens.visualizar']});render(<ChatOperacao cliente={cliente}/>);await abrir();expect(botoesTentativa()).toHaveLength(0);
});

it('mostra o bloqueio de 24h ao lado da mesma mensagem e preserva o compositor',async()=>{
 const {cliente,buscar}=fixture({responderTentativa:()=>json({erro:'OPERACAO_JANELA_FECHADA'},409)});const {container}=render(<ChatOperacao cliente={cliente}/>);await abrir();fireEvent.click(botoesTentativa()[0]);
 const alerta=await screen.findByRole('alert');expect(alerta.textContent).toContain('Use um template aprovado para retomar o contato.');expect(alerta.closest('article.balao')).toBeTruthy();expect(container.querySelectorAll('article.balao')).toHaveLength(1);expect(screen.getByRole('textbox',{name:'Mensagem'})).toHaveProperty('value','Rascunho separado da nova mensagem');expect(pedidosTentativa(buscar)).toHaveLength(1);
});

it('resultado incerto bloqueia somente a nova tentativa e aguarda confirmação sem envio automático',async()=>{
 const {cliente,buscar,atualizar}=fixture({responderTentativa:()=>Promise.reject(new Error('REDE_FICTICIA'))});const {container}=render(<ChatOperacao cliente={cliente}/>);await abrir();fireEvent.click(botoesTentativa()[0]);
 await screen.findByText('A confirmação da tentativa não chegou. Aguarde a atualização da mensagem antes de tentar novamente.');expect(botoesTentativa()).toHaveLength(0);expect(screen.getByRole('img',{name:/Envio sem confirmação/})).toBeTruthy();expect(screen.getByRole('textbox',{name:'Mensagem'})).toHaveProperty('value','Rascunho separado da nova mensagem');expect(pedidosTentativa(buscar)).toHaveLength(1);
 atualizar({falhaCodigo:'TRANSPORTE_RECUSADO'});await new Promise(resolve=>setTimeout(resolve,450));expect(botoesTentativa()).toHaveLength(0);expect(pedidosTentativa(buscar)).toHaveLength(1);
 atualizar({estado:'pendente',intencaoId:novaIntencaoId,podeTentarNovamente:false});await screen.findByLabelText('Estado da mensagem: pendente');await waitFor(()=>expect(screen.queryByText('A confirmação da tentativa não chegou. Aguarde a atualização da mensagem antes de tentar novamente.')).toBeNull());expect(container.querySelectorAll('article.balao')).toHaveLength(1);expect(pedidosTentativa(buscar)).toHaveLength(1);
});

it('retorno incompatível é incerto e não libera um novo clique',async()=>{
 const {cliente,buscar}=fixture({responderTentativa:()=>json({id:novaIntencaoId,mensagemId:'outra-mensagem-ficticia',estado:'pendente'},202)});render(<ChatOperacao cliente={cliente}/>);await abrir();fireEvent.click(botoesTentativa()[0]);await screen.findByText('A confirmação da tentativa não chegou. Aguarde a atualização da mensagem antes de tentar novamente.');expect(botoesTentativa()).toHaveLength(0);expect(pedidosTentativa(buscar)).toHaveLength(1);
});

it('conferência manual repete o pedido incerto com a mesma chave e versão original',async()=>{
 let tentativas=0;const dados=fixture({responderTentativa:()=>{tentativas++;if(tentativas===1)return Promise.reject(new Error('REDE_FICTICIA'));dados.atualizar({estado:'pendente',intencaoId:novaIntencaoId,podeTentarNovamente:false});return json({id:novaIntencaoId,mensagemId,estado:'pendente'},202);}});
 const {container}=render(<ChatOperacao cliente={dados.cliente}/>);await abrir();fireEvent.click(botoesTentativa()[0]);await screen.findByText('A confirmação da tentativa não chegou. Aguarde a atualização da mensagem antes de tentar novamente.');
 expect(pedidosTentativa(dados.buscar)).toHaveLength(1);const conferir=await screen.findByRole('button',{name:/Conferir tentativa da mensagem de/});expect(botoesTentativa()).toHaveLength(0);fireEvent.click(conferir);
 await screen.findByText('Nova tentativa registrada. A mensagem será atualizada nesta conversa.');const pedidos=pedidosTentativa(dados.buscar);expect(pedidos).toHaveLength(2);expect(pedidos[1][1]?.body).toBe(pedidos[0][1]?.body);expect(container.querySelectorAll('article.balao')).toHaveLength(1);expect(screen.getByRole('textbox',{name:'Mensagem'})).toHaveProperty('value','Rascunho separado da nova mensagem');
});

it('consulta o estado da mensagem fora da página recente e atualiza a mesma bolha até a entrega',async()=>{
 const {cliente,buscar,atualizar}=fixture({ocultarMensagemDepoisDeAbrir:true});const {container}=render(<ChatOperacao cliente={cliente}/>);await abrir();fireEvent.click(botoesTentativa()[0]);
 await screen.findByLabelText('Estado da mensagem: pendente');expect(buscar.mock.calls.some(([url])=>String(url).includes('/mensagens/estado?'))).toBe(true);expect(container.querySelectorAll('article.balao')).toHaveLength(1);
 atualizar({estado:'entregue',podeTentarNovamente:false});await screen.findByLabelText('Estado da mensagem: entregue');expect(container.querySelectorAll('article.balao')).toHaveLength(1);expect(screen.getByText('Resposta original fictícia')).toBeTruthy();expect(botoesTentativa()).toHaveLength(0);
});

it('rejeição definitiva da conferência permite uma nova tentativa deliberada após consultar o estado',async()=>{
 let tentativas=0;const {cliente,buscar,atualizarConversa}=fixture({responderTentativa:()=>{tentativas++;return tentativas===1?Promise.reject(new Error('REDE_FICTICIA')):json({erro:'OPERACAO_CONTEXTO_ALTERADO'},409);}});render(<ChatOperacao cliente={cliente}/>);await abrir();fireEvent.click(botoesTentativa()[0]);
 await screen.findByRole('button',{name:/Conferir tentativa da mensagem de/});atualizarConversa({versao:8});await screen.findByText(/Revisão 8/);
 fireEvent.click(await screen.findByRole('button',{name:/Conferir tentativa da mensagem de/}));await screen.findByText(/Outro atendimento alterou este registro/);expect(screen.queryByRole('button',{name:/Conferir tentativa da mensagem de/})).toBeNull();expect(botoesTentativa()).toHaveLength(1);
 fireEvent.click(botoesTentativa()[0]);await waitFor(()=>expect(pedidosTentativa(buscar)).toHaveLength(3));const pedidos=pedidosTentativa(buscar);expect(pedidos[1][1]?.body).toBe(pedidos[0][1]?.body);expect(JSON.parse(String(pedidos[2][1]?.body)).idempotencia).not.toBe(JSON.parse(String(pedidos[0][1]?.body)).idempotencia);expect(JSON.parse(String(pedidos[2][1]?.body)).versao).toBe(8);
});

it('falha ao ler a confirmação HTTP mantém a tentativa incerta',async()=>{
 const {cliente,buscar}=fixture({responderTentativa:()=>new Response(new ReadableStream({start(controlador){controlador.error(new Error('RESPOSTA_INTERROMPIDA_FICTICIA'));}}),{status:202,headers:{'content-type':'application/json'}})});render(<ChatOperacao cliente={cliente}/>);await abrir();fireEvent.click(botoesTentativa()[0]);await screen.findByText('A confirmação da tentativa não chegou. Aguarde a atualização da mensagem antes de tentar novamente.');expect(botoesTentativa()).toHaveLength(0);expect(await screen.findByRole('button',{name:/Conferir tentativa da mensagem de/})).toBeTruthy();expect(pedidosTentativa(buscar)).toHaveLength(1);
});

it.each(['cancelado','cancelled'])('uma saída cancelada só permite tentativa quando o servidor confirma que não saiu: %s',async(estado)=>{
 const {cliente}=fixture({mensagem:{estado,podeTentarNovamente:true}});render(<ChatOperacao cliente={cliente}/>);await abrir();expect(botoesTentativa()).toHaveLength(1);
});

it.each(['entregue','lido'])('uma confirmação %s da intenção anterior atualiza a bolha e encerra a conferência pendente',async(estado)=>{
 const {cliente,buscar,atualizar}=fixture({ocultarMensagemDepoisDeAbrir:true,responderTentativa:()=>Promise.reject(new Error('CONFIRMACAO_FICTICIA_NAO_RECEBIDA'))});const {container}=render(<ChatOperacao cliente={cliente}/>);await abrir();fireEvent.click(botoesTentativa()[0]);
 await screen.findByRole('button',{name:/Conferir tentativa da mensagem de/});atualizar({estado,intencaoId,podeTentarNovamente:false,falhaCodigo:'TENTATIVA_ANTERIOR_CONFIRMADA'});await screen.findByLabelText('Estado da mensagem: '+estado);
 await waitFor(()=>expect(screen.queryByRole('button',{name:/Conferir tentativa da mensagem de/})).toBeNull());expect(screen.queryByText('A confirmação da tentativa não chegou. Aguarde a atualização da mensagem antes de tentar novamente.')).toBeNull();expect(botoesTentativa()).toHaveLength(0);expect(container.querySelectorAll('article.balao')).toHaveLength(1);expect(screen.getByText('Resposta original fictícia')).toBeTruthy();expect(pedidosTentativa(buscar)).toHaveLength(1);
 const consultas=buscar.mock.calls.filter(([url])=>String(url).includes('/mensagens/estado?')).length,historicos=buscar.mock.calls.filter(([url])=>String(url).includes('/historico?')).length;atualizar({estado});await waitFor(()=>expect(buscar.mock.calls.filter(([url])=>String(url).includes('/historico?')).length).toBeGreaterThan(historicos));expect(buscar.mock.calls.filter(([url])=>String(url).includes('/mensagens/estado?'))).toHaveLength(consultas);
});
