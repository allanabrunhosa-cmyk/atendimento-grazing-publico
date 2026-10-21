// @vitest-environment jsdom
import React from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import ChatOperacao from '../../apps/atendimento-chat-consulta/ChatOperacao';
import {criarClienteOperacao,type ConversaOperacao,type PermissaoOperacao} from '../../apps/atendimento-chat-consulta/operacao-api';

const conversaId='11111111-1111-4111-8111-111111111111',lembreteId='22222222-2222-4222-8222-222222222222',mensagemId='33333333-3333-4333-8333-333333333333';
const agora=Date.parse('2026-10-19T12:00:00.000Z'),em='2026-10-19T12:00:00.000Z';
const permissoes:PermissaoOperacao[]=['consultar','atender','lembretes.visualizar','lembretes.adicionar','lembretes.editar','lembretes.excluir','mensagens.visualizar','mensagens.adicionar'];
const vencido={id:lembreteId,agendadoPara:'2026-10-19T11:00:00.000Z',versao:1,atrasado:true,conferidoEm:em,criadoPorId:'atendente-ficticio',criadoPorNome:'Atendente fictício'};
type LembreteRaw=typeof vencido;
const json=(valor:unknown)=>new Response(JSON.stringify(valor),{headers:{'content-type':'application/json'}});
function pendente<T>(){let resolver:(valor:T)=>void=()=>undefined;const promessa=new Promise<T>(r=>{resolver=r;});return {promessa,resolver};}
function fixture(opcoes:{permissoes?:PermissaoOperacao[];estado?:ConversaOperacao['estado'];somenteLeitura?:boolean;lembrete?:LembreteRaw|null;atrasarHistorico?:boolean;pendentesResposta?:number;naoLidas?:number}={}){
 let atual=opcoes.lembrete??null,historicos=0,notificar:(nova:boolean)=>void=()=>undefined,sinalAntigo:AbortSignal|undefined;
 const antigo=pendente<Response>();let respostaAntiga:Response|undefined;
 const conversa=()=>({id:conversaId,contatoId:'contato-ficticio',nome:'Pessoa fictícia',telefone:'00000000',canal:'whatsapp',estado:opcoes.estado??'humano',responsavelId:'atendente-ficticio',equipeId:null,tags:[],versao:1,ultimaMensagemEm:em,janelaRespostaAberta:true,ficticia:true,somenteLeitura:opcoes.somenteLeitura??false,lembrete:atual,pendentesResposta:opcoes.pendentesResposta??0,naoLidas:opcoes.naoLidas??0});
 const historico=()=>({conversa:conversa(),registros:[{id:mensagemId,conversaId,autor:'cliente',autorId:null,autorNome:null,conteudo:'Mensagem fictícia preservada',tipo:'text',estado:'recebido',criadaEm:em,anexoId:null,citadaId:null}],notas:[],proxima:null});
 const buscar=vi.fn<typeof fetch>(async(entrada,init)=>{
  const u=new URL(String(entrada),'https://ficticio.invalid'),p=u.pathname.replace('/api/atendimento/operacao','');
  if(p==='/sessao')return json({usuario:{id:'atendente-ficticio',nome:'Atendente fictício',perfilId:'perfil-ficticio',permissoes:opcoes.permissoes??permissoes},csrf:'csrf-ficticio',modo:'homologacao',escritasReais:false});
  if(p==='/conversas'){const fechada=opcoes.estado==='encerrada',mostrar=!fechada||u.searchParams.get('estado')==='encerrada';return json({registros:mostrar?[conversa()]:[],mais:false,pagina:0,contagens:{total:fechada?0:1,ia:0,humano:fechada?0:1,pausado:0,encerrada:fechada?1:0},contagensConferidasEm:em});}
  if(p==='/historico'){historicos++;if(opcoes.atrasarHistorico&&historicos===2){respostaAntiga=json(historico());sinalAntigo=init?.signal??undefined;return antigo.promessa;}return json(historico());}
  if(p==='/rascunho')return json({texto:init?.method==='PUT'?JSON.parse(String(init.body)).texto:'Rascunho fictício preservado',versao:1});
  if(p.endsWith('/abertura'))return json({registrada:true});
  if(p.endsWith('/lembrete')){const dados=JSON.parse(String(init?.body));atual=['cancelar','concluir'].includes(dados.acao)?null:{...vencido,agendadoPara:dados.agendadoPara,versao:(atual?.versao??0)+1,atrasado:false};return json({lembrete:atual});}
  if(p==='/status')return json({modo:'homologacao',enviosReais:false,receptor:'desarmado',fila:{pendentes:0,incertos:0,falhas:0},backup:{ultimoSucessoEm:null,falha:null},agente:{modo:'desligado',modelo:'modelo-ficticio',disponivel:false},atualizadoEm:em,importadoEm:null});
  throw Error('ENDPOINT_FICTICIO_NAO_PREVISTO:'+p);
 });
 const cliente=criarClienteOperacao(buscar);vi.spyOn(cliente,'observarChat').mockImplementation(f=>{notificar=f;return()=>undefined;});
 return {cliente,buscar,notificar:()=>notificar(false),historicos:()=>historicos,sinalAntigo:()=>sinalAntigo,liberarAntigo:()=>{if(!respostaAntiga)throw Error('HISTORICO_ANTIGO_NAO_INICIADO');antigo.resolver(respostaAntiga);}};
}
const lista=()=>screen.getByRole('region',{name:'Lista de conversas'});
async function abrir(fechada=false){if(fechada)fireEvent.click(await screen.findByRole('button',{name:'Encerrado 1'}));fireEvent.click(await within(await screen.findByRole('region',{name:'Lista de conversas'})).findByRole('button',{name:/Pessoa fictícia/}));await screen.findByRole('group',{name:'Ações do atendimento'});}
const postsLembrete=(f:ReturnType<typeof fixture>)=>f.buscar.mock.calls.filter(([u,init])=>String(u).endsWith('/lembrete')&&init?.method==='POST');
beforeEach(()=>{vi.spyOn(Date,'now').mockReturnValue(agora);vi.spyOn(performance,'now').mockReturnValue(1000);});
afterEach(()=>{cleanup();vi.restoreAllMocks();history.replaceState(null,'','/operacao/chat');});

it('mostra o follow-up cadastrado no rodapé e passa a piscar ao vencer, sem novo GET',async()=>{
 const intervalos=vi.spyOn(globalThis,'setInterval'),f=fixture({lembrete:{...vencido,agendadoPara:'2026-10-19T12:00:30.000Z',atrasado:false}});render(<ChatOperacao cliente={f.cliente}/>);await within(await screen.findByRole('region',{name:'Lista de conversas'})).findByRole('button',{name:/Pessoa fictícia/});
 const agendado=within(lista()).getByRole('img',{name:/Follow-up agendado/});expect(agendado.closest('.conversa-alertas')).toBeTruthy();expect(agendado.closest('.conversa-indicadores')).toBeNull();expect(agendado.classList.contains('atrasado')).toBe(false);expect(agendado.title).toContain('Brasília');
 const antes=f.buscar.mock.calls.length;vi.mocked(performance.now).mockReturnValue(31000);const tick=intervalos.mock.calls.filter(([,tempo])=>tempo===15000).at(-1)?.[0];expect(typeof tick).toBe('function');act(()=>{if(typeof tick==='function')tick();});const indicador=await within(lista()).findByRole('img',{name:/Follow-up pendente/});expect(indicador).toBe(agendado);expect(indicador.classList.contains('atrasado')).toBe(true);expect(indicador.querySelector('svg')).toBeTruthy();expect(f.buscar.mock.calls).toHaveLength(antes);
});

it.each([0,2])('preserva aguardando resposta ou não lidas junto do follow-up (%s não lidas)',async naoLidas=>{
 const f=fixture({lembrete:{...vencido,agendadoPara:'2026-10-20T12:00:00.000Z',atrasado:false},pendentesResposta:2,naoLidas});render(<ChatOperacao cliente={f.cliente}/>);
 const linha=await within(await screen.findByRole('region',{name:'Lista de conversas'})).findByRole('button',{name:/Pessoa fictícia/}),indicador=within(linha).getByRole('img',{name:/Follow-up agendado/}),pendencia=naoLidas?within(linha).getByLabelText('2 mensagens não lidas; 2 pendentes de resposta'):within(linha).getByRole('img',{name:'2 mensagens lidas aguardando resposta'});
 expect(indicador.parentElement).toBe(pendencia.parentElement);expect(pendencia.previousElementSibling).toBe(indicador);expect(indicador.closest('.conversa-rodape')?.querySelector('.zona-tags-conversa')).toBeTruthy();expect(linha.querySelector('.conversa-indicadores .indicador-followup')).toBeNull();if(naoLidas)expect(pendencia.textContent).toBe('2');
});

it('permite agendar em conversa encerrada com consultar e atender, sem exigir envio',async()=>{
 const f=fixture({estado:'encerrada',permissoes:['consultar','lembretes.visualizar','lembretes.adicionar']});render(<ChatOperacao cliente={f.cliente}/>);await abrir(true);fireEvent.click(screen.getByRole('button',{name:'Agendar alerta de follow-up'}));await screen.findByRole('dialog',{name:'Alerta de follow-up'});expect(screen.queryByRole('textbox',{name:'Mensagem'})).toBeNull();expect(postsLembrete(f)).toHaveLength(0);
});

it('não oferece o botão sem atender, mesmo com permissão de consultar',async()=>{
 const f=fixture({permissoes:['consultar','mensagens.visualizar']});render(<ChatOperacao cliente={f.cliente}/>);await abrir();expect(screen.queryByRole('button',{name:'Agendar alerta de follow-up'})).toBeNull();expect(postsLembrete(f)).toHaveLength(0);
});

it('não oferece o botão quando a conta não pode consultar o Chat',async()=>{
 const f=fixture({permissoes:['atender']});render(<ChatOperacao cliente={f.cliente}/>);await screen.findByRole('heading',{name:'Acesso à área'});expect(screen.queryByRole('button',{name:'Agendar alerta de follow-up'})).toBeNull();expect(postsLembrete(f)).toHaveLength(0);
});

it('não oferece agendamento em histórico somente para leitura',async()=>{
 const f=fixture({somenteLeitura:true});render(<ChatOperacao cliente={f.cliente}/>);await abrir();await screen.findByText(/Histórico real protegido/);expect(screen.queryByRole('button',{name:'Agendar alerta de follow-up'})).toBeNull();expect(postsLembrete(f)).toHaveLength(0);
});

it('salvar atualiza o botão, mantém o rascunho e devolve o foco sem enviar mensagem',async()=>{
 const f=fixture();render(<ChatOperacao cliente={f.cliente}/>);await abrir();const campo=await screen.findByRole('textbox',{name:'Mensagem'});await waitFor(()=>expect(campo).toHaveProperty('disabled',false));expect(campo).toHaveProperty('value','Rascunho fictício preservado');const botao=screen.getByRole('button',{name:'Agendar alerta de follow-up'});botao.focus();fireEvent.click(botao);const modal=await screen.findByRole('dialog',{name:'Alerta de follow-up'}),dataHora=within(modal).getByLabelText('Data e hora');dataHora.focus();expect(document.activeElement).toBe(dataHora);fireEvent.click(within(modal).getByRole('button',{name:'Em 1 hora'}));fireEvent.click(within(modal).getByRole('button',{name:'Agendar alerta'}));await screen.findByRole('button',{name:'Gerenciar alerta de follow-up'});await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(campo).toHaveProperty('value','Rascunho fictício preservado');expect(campo).toHaveProperty('disabled',false);await waitFor(()=>expect(document.activeElement).toBe(botao));expect(postsLembrete(f)).toHaveLength(1);expect(f.buscar.mock.calls.some(([u])=>String(u).endsWith('/mensagens/envio'))).toBe(false);
});

it.each(['agendar','cancelar'] as const)('histórico iniciado antes de%s não sobrescreve o lembrete confirmado depois',async acao=>{
 const f=fixture({lembrete:acao==='cancelar'?vencido:null,atrasarHistorico:true});render(<ChatOperacao cliente={f.cliente}/>);await abrir();await waitFor(()=>expect(screen.getByRole('textbox',{name:'Mensagem'})).toHaveProperty('disabled',false));act(()=>f.notificar());await waitFor(()=>expect(f.historicos()).toBe(2));expect(f.sinalAntigo()?.aborted).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:acao==='cancelar'?'Gerenciar alerta de follow-up':'Agendar alerta de follow-up'}));const modal=await screen.findByRole('dialog',{name:'Alerta de follow-up'});if(acao==='agendar'){fireEvent.click(within(modal).getByRole('button',{name:'Em 1 hora'}));fireEvent.click(within(modal).getByRole('button',{name:'Agendar alerta'}));}else{fireEvent.click(within(modal).getByRole('button',{name:'Cancelar agendamento'}));fireEvent.click(await screen.findByRole('button',{name:'Confirmar cancelamento do agendamento'}));}
 const rotulo=acao==='agendar'?'Gerenciar alerta de follow-up':'Agendar alerta de follow-up';await screen.findByRole('button',{name:rotulo});await waitFor(()=>expect(f.historicos()).toBeGreaterThanOrEqual(3));expect(f.sinalAntigo()?.aborted).toBe(true);await act(async()=>{f.liberarAntigo();await Promise.resolve();await Promise.resolve();});expect(screen.getByRole('button',{name:rotulo})).toBeTruthy();expect(!!within(lista()).queryByRole('img',{name:/Follow-up (pendente|agendado)/})).toBe(acao==='agendar');expect(screen.getByRole('textbox',{name:'Mensagem'})).toHaveProperty('value','Rascunho fictício preservado');expect(postsLembrete(f)).toHaveLength(1);
});
