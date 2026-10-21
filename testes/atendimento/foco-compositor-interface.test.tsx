// @vitest-environment jsdom
import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import ChatOperacao from '../../apps/atendimento-chat-consulta/ChatOperacao';
import {criarClienteOperacao,type PermissaoOperacao} from '../../apps/atendimento-chat-consulta/operacao-api';

const conversaA='11111111-1111-4111-8111-111111111111',conversaB='22222222-2222-4222-8222-222222222222',mensagemId='33333333-3333-4333-8333-333333333333';
const em='2026-10-15T14:00:00.000Z';
const permissoes:PermissaoOperacao[]=['consultar','atender','mensagens.visualizar','mensagens.adicionar','contatos.visualizar','atalhos.visualizar','equipe.visualizar','modelos.visualizar','notas.visualizar','notas.adicionar'];
const json=(valor:unknown,status=200)=>new Response(JSON.stringify(valor),{status,headers:{'content-type':'application/json'}});
const conversa=(id:string)=>({id,contatoId:'contato-'+id,nome:id===conversaA?'Cliente A fictício':'Cliente B fictício',telefone:'00000000',canal:'whatsapp',estado:'humano',responsavelId:'atendente-ficticio',equipeId:null,tags:[],versao:1,ultimaMensagemEm:em,janelaRespostaAberta:true,ficticia:true,somenteLeitura:false});
function pendente<T>(){let resolver:(valor:T)=>void=()=>undefined;const promessa=new Promise<T>(r=>{resolver=r;});return {promessa,resolver};}
function fixture(opcoes:{rascunhos?:Record<string,string>;rascunho?:(id:string)=>Response|Promise<Response>;envio?:()=>Response|Promise<Response>}={}){
 const buscar=vi.fn<typeof fetch>(async(entrada,init)=>{
  const u=new URL(String(entrada),'https://ficticio.invalid'),caminho=u.pathname.replace('/api/atendimento/operacao','');
  if(caminho==='/sessao')return json({usuario:{id:'atendente-ficticio',nome:'Atendente fictício',perfilId:'perfil-ficticio',permissoes},csrf:'csrf-ficticio',modo:'homologacao',escritasReais:false});
  if(caminho==='/conversas')return json({registros:[conversa(conversaA),conversa(conversaB)],mais:false,pagina:0});
  if(caminho==='/historico'){const id=u.searchParams.get('conversaId')!;return json({conversa:conversa(id),registros:[{id:mensagemId,conversaId:id,autor:'cliente',autorId:null,autorNome:null,conteudo:'Mensagem de teste',tipo:'text',estado:'recebido',criadaEm:em,anexoId:null,citadaId:null}],notas:[],proxima:null});}
  if(caminho==='/equipe')return json({usuarios:[{id:'atendente-ficticio',nome:'Atendente fictício'}],equipes:[]});
  if(caminho==='/rascunho'){if(init?.method==='PUT')return json({texto:JSON.parse(String(init.body)).texto,versao:2});const id=u.searchParams.get('conversaId')!;return opcoes.rascunho?opcoes.rascunho(id):json({texto:opcoes.rascunhos?.[id]??'',versao:1});}
  if(caminho.endsWith('/abertura'))return json({registrada:true});
  if(caminho==='/mensagens/envio')return opcoes.envio?opcoes.envio():json({id:mensagemId,estado:'aceito_simulado'});
  if(caminho==='/modelos')return json({registros:[]});
  if(caminho==='/atalhos')return json({versao:1,registros:[{id:'44444444-4444-4444-8444-444444444444',nome:'retorno',texto:'Retorno fictício preparado.'}]});
  if(caminho==='/status')return json({modo:'homologacao',enviosReais:false,receptor:'ensaio',fila:{pendentes:0,incertos:0,falhas:0},backup:{ultimoSucessoEm:null,falha:null},agente:{modo:'desligado',modelo:'modelo-ficticio',disponivel:false},atualizadoEm:em,importadoEm:null});
  throw Error('ENDPOINT_FICTICIO_NAO_PREVISTO:'+caminho);
 });
 const cliente=criarClienteOperacao(buscar);let notificar:(nova:boolean)=>void=()=>undefined;
 vi.spyOn(cliente,'observarChat').mockImplementation(f=>{notificar=f;return()=>undefined;});
 return {cliente,buscar,notificar:(nova=false)=>notificar(nova)};
}
const campoMensagem=()=>screen.getByRole('textbox',{name:'Mensagem'}) as HTMLTextAreaElement;
const chamadas=(f:ReturnType<typeof fixture>,caminho:string)=>f.buscar.mock.calls.filter(([u])=>new URL(String(u),'https://ficticio.invalid').pathname.endsWith(caminho));
function simularPerdaFocoAoDesabilitar(campo:HTMLTextAreaElement){
 // O navegador desfoca um campo desabilitado; o JSDOM pode manter activeElement.
 campo.blur();if(document.activeElement===campo){const tabIndex=document.body.getAttribute('tabindex');document.body.tabIndex=-1;document.body.focus();if(tabIndex===null)document.body.removeAttribute('tabindex');else document.body.setAttribute('tabindex',tabIndex);}
 expect(document.activeElement).toBe(document.body);
}
async function selecionar(nome='Cliente A fictício'){
 const lista=await screen.findByRole('region',{name:'Lista de conversas'}),botao=await within(lista).findByRole('button',{name:new RegExp(nome)});
 botao.focus();fireEvent.click(botao);const campo=await screen.findByRole('textbox',{name:'Mensagem'}) as HTMLTextAreaElement;await waitFor(()=>expect(campo.disabled).toBe(false));return campo;
}
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();history.replaceState(null,'','/operacao/chat');});

it('foca a mensagem depois de selecionar a conversa e carregar o rascunho',async()=>{
 const rascunho=pendente<Response>(),f=fixture({rascunho:()=>rascunho.promessa});render(<ChatOperacao cliente={f.cliente}/>);
 const botao=await screen.findByRole('button',{name:/Cliente A fictício/});botao.focus();fireEvent.click(botao);const campo=await screen.findByRole('textbox',{name:'Mensagem'});expect(campo).toHaveProperty('disabled',true);expect(document.activeElement).not.toBe(campo);
 await act(async()=>{rascunho.resolver(json({texto:'Rascunho recuperado',versao:1}));});await waitFor(()=>expect(document.activeElement).toBe(campo));expect(campo).toHaveProperty('value','Rascunho recuperado');expect(f.buscar.mock.calls.some(([,init])=>init?.method==='POST'&&String(init.body).includes('Rascunho recuperado'))).toBe(false);
});

it('restaura o foco depois de concluir um envio por Enter e permite continuar digitando',async()=>{
 const envio=pendente<Response>(),f=fixture({envio:()=>envio.promessa});render(<ChatOperacao cliente={f.cliente}/>);const campo=await selecionar();campo.focus();fireEvent.change(campo,{target:{value:'Primeira mensagem fictícia'}});fireEvent.keyDown(campo,{key:'Enter'});
 await waitFor(()=>expect(campo.disabled).toBe(true));simularPerdaFocoAoDesabilitar(campo);
 await act(async()=>{envio.resolver(json({id:mensagemId,estado:'aceito_simulado'}));});await waitFor(()=>{expect(campo.disabled).toBe(false);expect(campo.value).toBe('');expect(document.activeElement).toBe(campo);});
 fireEvent.change(campo,{target:{value:'Próxima mensagem fictícia'}});expect(campo.value).toBe('Próxima mensagem fictícia');expect(chamadas(f,'/mensagens/envio')).toHaveLength(1);
});

it('seleciona atalho por Enter sem enviar e só o próximo Enter explícito envia o rascunho',async()=>{
 const f=fixture();render(<ChatOperacao cliente={f.cliente}/>);const campo=await selecionar();
 expect(screen.getByRole('button',{name:'Gerenciar atalhos de texto'})).toBeTruthy();campo.focus();fireEvent.change(campo,{target:{value:'/ret'}});
 await screen.findByRole('option',{name:/retorno/});expect(screen.queryByRole('button',{name:'Gerenciar atalhos de texto'})).toBeNull();
 fireEvent.keyDown(campo,{key:'ArrowDown'});fireEvent.keyDown(campo,{key:'Enter'});
 await waitFor(()=>{expect(campo.value).toBe('Retorno fictício preparado.');expect(document.activeElement).toBe(campo);});expect(chamadas(f,'/mensagens/envio')).toHaveLength(0);
 fireEvent.keyDown(campo,{key:'Enter'});await waitFor(()=>expect(chamadas(f,'/mensagens/envio')).toHaveLength(1));
 const enviado=JSON.parse(String(chamadas(f,'/mensagens/envio')[0][1]?.body));expect(enviado.texto).toContain('Retorno fictício preparado.');
 await waitFor(()=>{expect(campo.value).toBe('');expect(document.activeElement).toBe(campo);});
});

it('restaura o foco após falha recuperável e preserva o texto sem repetir o envio',async()=>{
 const envio=pendente<Response>(),f=fixture({envio:()=>envio.promessa});render(<ChatOperacao cliente={f.cliente}/>);const campo=await selecionar();campo.focus();fireEvent.change(campo,{target:{value:'Texto que precisa de revisão'}});fireEvent.keyDown(campo,{key:'Enter'});await waitFor(()=>expect(campo.disabled).toBe(true));simularPerdaFocoAoDesabilitar(campo);
 await act(async()=>{envio.resolver(json({erro:'OPERACAO_CONFLITO'},409));});await screen.findByRole('alert');await waitFor(()=>{expect(campo.disabled).toBe(false);expect(document.activeElement).toBe(campo);});expect(campo.value).toBe('Texto que precisa de revisão');expect(chamadas(f,'/mensagens/envio')).toHaveLength(1);
});

it('troca de conversa carrega o rascunho correto e foca uma vez por seleção',async()=>{
 const f=fixture({rascunhos:{[conversaA]:'Rascunho A',[conversaB]:'Rascunho B'}}),focar=vi.spyOn(HTMLTextAreaElement.prototype,'focus');render(<ChatOperacao cliente={f.cliente}/>);const campo=await selecionar();await waitFor(()=>expect(document.activeElement).toBe(campo));expect(campo.value).toBe('Rascunho A');focar.mockClear();
 const outro=await selecionar('Cliente B fictício');await waitFor(()=>expect(document.activeElement).toBe(outro));expect(outro.value).toBe('Rascunho B');expect(focar.mock.contexts.filter(e=>e===outro)).toHaveLength(1);
 const antes=chamadas(f,'/historico').length;act(()=>f.notificar());await waitFor(()=>expect(chamadas(f,'/historico').length).toBeGreaterThan(antes));expect(outro.value).toBe('Rascunho B');expect(focar.mock.contexts.filter(e=>e===outro)).toHaveLength(1);
});

it('preserva o foco da busca durante atualização de histórico por evento',async()=>{
 const f=fixture();render(<ChatOperacao cliente={f.cliente}/>);await selecionar();const busca=screen.getByRole('textbox',{name:'Buscar por nome ou telefone'});busca.focus();fireEvent.change(busca,{target:{value:'Cliente'}});const antes=chamadas(f,'/historico').length;
 act(()=>f.notificar());await waitFor(()=>expect(chamadas(f,'/historico').length).toBeGreaterThan(antes));expect(document.activeElement).toBe(busca);expect(busca).toHaveProperty('value','Cliente');
});

it('preserva o foco da busca durante a atualização periódica',async()=>{
 const intervalos=vi.spyOn(globalThis,'setInterval'),f=fixture();render(<ChatOperacao cliente={f.cliente}/>);await selecionar();const busca=screen.getByRole('textbox',{name:'Buscar por nome ou telefone'});busca.focus();const antes=chamadas(f,'/historico').length,callback=intervalos.mock.calls.findLast(([,duracao])=>duracao===15000)?.[0];expect(typeof callback).toBe('function');
 act(()=>{if(typeof callback==='function')callback();});await waitFor(()=>expect(chamadas(f,'/historico').length).toBeGreaterThan(antes));expect(document.activeElement).toBe(busca);
});

it.each([{shiftKey:true},{isComposing:true},{keyCode:229}])('preserva composição e quebra de linha sem enviar com Enter %j',async modificadores=>{
 const f=fixture();render(<ChatOperacao cliente={f.cliente}/>);const campo=await selecionar();campo.focus();fireEvent.change(campo,{target:{value:'Texto em composição'}});const evento=new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true,...modificadores});if('keyCode' in modificadores)Object.defineProperty(evento,'keyCode',{value:modificadores.keyCode});fireEvent(campo,evento);expect(evento.defaultPrevented).toBe(false);expect(campo.value).toBe('Texto em composição');expect(document.activeElement).toBe(campo);expect(chamadas(f,'/mensagens/envio')).toHaveLength(0);
});

it('não retira o foco da nota interna quando o rascunho termina de carregar',async()=>{
 const rascunho=pendente<Response>(),f=fixture({rascunho:()=>rascunho.promessa});render(<ChatOperacao cliente={f.cliente}/>);fireEvent.click(await screen.findByRole('button',{name:/Cliente A fictício/}));const campo=await screen.findByRole('textbox',{name:'Mensagem'});expect(campo).toHaveProperty('disabled',true);
 fireEvent.click(screen.getByRole('button',{name:'Mais ações da conversa'}));fireEvent.click(await screen.findByRole('button',{name:'Nota interna'}));const popup=await screen.findByRole('dialog',{name:'Nota interna'}),nota=within(popup).getByRole('textbox',{name:'Texto da nota'});nota.focus();await act(async()=>{rascunho.resolver(json({texto:'Rascunho preservado',versao:1}));});await waitFor(()=>expect(campo).toHaveProperty('disabled',false));expect(document.activeElement).toBe(nota);expect(nota).toHaveProperty('value','');expect(chamadas(f,'/mensagens/envio')).toHaveLength(0);
});

it('não retira o foco da busca escolhida pelo usuário enquanto o rascunho carrega',async()=>{
 const rascunho=pendente<Response>(),f=fixture({rascunho:()=>rascunho.promessa});render(<ChatOperacao cliente={f.cliente}/>);fireEvent.click(await screen.findByRole('button',{name:/Cliente A fictício/}));const campo=await screen.findByRole('textbox',{name:'Mensagem'}),busca=screen.getByRole('textbox',{name:'Buscar por nome ou telefone'});busca.focus();fireEvent.change(busca,{target:{value:'Cliente'}});await act(async()=>{rascunho.resolver(json({texto:'Rascunho recuperado',versao:1}));});await waitFor(()=>expect(campo).toHaveProperty('disabled',false));expect(document.activeElement).toBe(busca);
});
