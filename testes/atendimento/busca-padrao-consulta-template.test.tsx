// @vitest-environment jsdom
import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import ChatConsulta from '../../apps/atendimento-chat-consulta/ChatConsulta';
import EnvioTemplateOperacao from '../../apps/atendimento-chat-consulta/EnvioTemplateOperacao';
import type {ClienteConsulta,ContatoConsulta,ConversaConsulta,SincronizacaoConsulta} from '../../apps/atendimento-chat-consulta/api';
import type {ModeloOperacao} from '../../apps/atendimento-chat-consulta/operacao-api';

const instante='2026-10-15T12:00:00.000Z';
const conversa:ConversaConsulta={id:'11111111-1111-4111-8111-111111111111',contact_id:'22222222-2222-4222-8222-222222222222',name:'Conversa fictícia inicial',phone_number:null,status:'human',is_active:true,last_message_at:instante,assigned_team:null,responsavel:null};
const contato:ContatoConsulta={id:'22222222-2222-4222-8222-222222222222',name:'Contato fictício inicial',last_name:null,phone_number:null,email:null,last_activity:instante,conversas:1};
const sincronizacao:SincronizacaoConsulta={atualizadoEm:instante,materializadoEm:instante,dadosRecebidosEm:instante,estado:{atualizadoEm:instante,ultimaConsultaOrigem:instante,ultimaColetaBemSucedida:instante,falha:null,pendenciasObservadas:0,pendenciasExatas:true,coletorSuspenso:false,capturaSuspensa:false}};
function fixture(telaInicial:'chat'|'contatos'='chat'){
 const conversas=vi.fn<ClienteConsulta['conversas']>(async(_busca,pagina)=>({registros:[conversa],pagina,mais:pagina===0}));
 const contatos=vi.fn<ClienteConsulta['contatos']>(async(_busca,pagina)=>({registros:[contato],pagina,mais:pagina===0}));
 const cliente:ClienteConsulta={conversas,contatos,sessao:vi.fn(async()=>({nome:'Atendente fictício',somenteLeitura:true as const})),sincronizacao:vi.fn(async()=>sincronizacao),historico:vi.fn(async()=>({registros:[],mais:false,cursor:null})),anexo:vi.fn(()=>'/anexo-ficticio')};
 render(<ChatConsulta cliente={cliente} telaInicial={telaInicial}/>);
 return {cliente,consulta:telaInicial==='chat'?conversas:contatos};
}
async function avancar(ms:number){await act(async()=>{vi.advanceTimersByTime(ms);});}
async function inicial(tela:'chat'|'contatos'='chat'){
 const f=fixture(tela);await act(async()=>{});await screen.findByRole('button',{name:new RegExp(tela==='chat'?'Conversa fictícia inicial':'Contato fictício inicial')});
 vi.useFakeTimers();return {...f,campo:screen.getByRole('textbox',{name:'Buscar por nome ou telefone'})};
}
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();history.replaceState(null,'','/consulta/chat');});

it.each(['chat','contatos'] as const)('busca automaticamente na consulta de %s após 300 ms sem novas teclas',async(tela)=>{
 const f=await inicial(tela);expect(screen.queryByRole('button',{name:'Pesquisar'})).toBeNull();
 fireEvent.change(f.campo,{target:{value:'Pe'}});await avancar(200);expect(f.consulta).toHaveBeenCalledTimes(1);
 fireEvent.change(f.campo,{target:{value:'Pessoa fictícia'}});await avancar(299);expect(f.consulta).toHaveBeenCalledTimes(1);
 await avancar(1);expect(f.consulta).toHaveBeenLastCalledWith('Pessoa fictícia',0,expect.any(AbortSignal));expect(f.consulta).toHaveBeenCalledTimes(2);
 expect(f.campo.getAttribute('maxlength')).toBe('120');expect(screen.getByRole('button',{name:'Limpar busca'})).toBeTruthy();
});

it('limpa imediatamente, devolve o foco e cancela o texto que aguardava a busca',async()=>{
 const f=await inicial();fireEvent.change(f.campo,{target:{value:'Pessoa fictícia'}});await avancar(300);
 fireEvent.change(f.campo,{target:{value:'Texto fictício pendente'}});
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Limpar busca'})));
 expect(f.consulta).toHaveBeenLastCalledWith('',0,expect.any(AbortSignal));expect(f.consulta).toHaveBeenCalledTimes(3);
 expect(f.campo).toHaveProperty('value','');expect(document.activeElement).toBe(f.campo);expect(screen.queryByRole('button',{name:'Limpar busca'})).toBeNull();
 await avancar(300);expect(f.consulta).toHaveBeenCalledTimes(3);
});

it('aplica Enter imediatamente sem repetir a mesma busca ao vencer o atraso',async()=>{
 const f=await inicial();fireEvent.change(f.campo,{target:{value:'  Pessoa fictícia  '}});
 await act(async()=>fireEvent.submit(f.campo.closest('form')!));
 expect(f.consulta).toHaveBeenLastCalledWith('Pessoa fictícia',0,expect.any(AbortSignal));expect(f.consulta).toHaveBeenCalledTimes(2);
 await avancar(300);expect(f.consulta).toHaveBeenCalledTimes(2);
});

it('preserva a paginação histórica, reinicia a página ao buscar e mantém Atualizar lista',async()=>{
 const f=await inicial();await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Próxima página'})));
 expect(f.consulta).toHaveBeenLastCalledWith('',1,expect.any(AbortSignal));expect(screen.getByRole('button',{name:'Página anterior'})).toHaveProperty('disabled',false);
 fireEvent.change(f.campo,{target:{value:'Pessoa fictícia'}});await avancar(300);
 expect(f.consulta).toHaveBeenLastCalledWith('Pessoa fictícia',0,expect.any(AbortSignal));expect(screen.getByRole('button',{name:'Página anterior'})).toHaveProperty('disabled',true);
 const anteriores=f.consulta.mock.calls.length;await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Atualizar lista'})));
 expect(f.consulta).toHaveBeenCalledTimes(anteriores+1);expect(f.consulta).toHaveBeenLastCalledWith('Pessoa fictícia',0,expect.any(AbortSignal));
});

it('filtra templates ao digitar e usa X para limpar sem mudar seleção ou variáveis',()=>{
 const modelos:ModeloOperacao[]=[
  {id:'template-ficticio-boas-vindas',nome:'Boas vindas fictícias',idioma:'pt_BR',estado:'APPROVED',variaveis:['1'],suportado:true,componentes:[{type:'BODY',text:'Olá {{1}}, exemplo fictício.'}]},
  {id:'template-ficticio-entrega',nome:'Entrega fictícia',idioma:'pt_BR',estado:'APPROVED',variaveis:[],suportado:true,componentes:[{type:'BODY',text:'Informação fictícia da entrega.'}]},
 ];
 const selecionar=vi.fn(),alterar=vi.fn();
 render(<EnvioTemplateOperacao modelos={modelos} selecionado={modelos[0].id} selecionar={selecionar} variaveis={{'1':'Pessoa fictícia'}} alterar={alterar} carregando={false} ocupado={false}/>);
 const campo=screen.getByRole('textbox',{name:'Buscar template'});expect(campo.getAttribute('maxlength')).toBe('120');
 fireEvent.change(campo,{target:{value:'entrega'}});expect(screen.getAllByRole('radio')).toHaveLength(1);expect(screen.getByRole('radio',{name:/Entrega fictícia/})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Limpar busca'}));expect(screen.getAllByRole('radio')).toHaveLength(2);
 expect(screen.getByRole('radio',{name:/Boas vindas fictícias/})).toHaveProperty('checked',true);expect(screen.getByRole('textbox',{name:'Mensagem — variável 1'})).toHaveProperty('value','Pessoa fictícia');
 expect(document.activeElement).toBe(campo);expect(campo).toHaveProperty('value','');expect(selecionar).not.toHaveBeenCalled();expect(alterar).not.toHaveBeenCalled();
});
