// @vitest-environment jsdom
import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import CartaoContatoCompartilhado from '../../apps/atendimento-chat-consulta/CartaoContatoCompartilhado';
import ContatosCompartilhadosMensagem from '../../apps/atendimento-chat-consulta/ContatosCompartilhadosMensagem';
import ChatOperacao from '../../apps/atendimento-chat-consulta/ChatOperacao';
import {ErroOperacao,criarClienteOperacao,type ContatoCompartilhadoOperacao,type ContatoOperacao,type ConversaOperacao,type PermissaoOperacao} from '../../apps/atendimento-chat-consulta/operacao-api';

const permissoes:PermissaoOperacao[]=['consultar','atender','contatos.visualizar','contatos.adicionar','conversas.visualizar','conversas.adicionar','mensagens.visualizar','mensagens.adicionar'];
const compartilhado:ContatoCompartilhadoOperacao={nome:'Pessoa compartilhada fictícia',telefones:[{numero:'+5511912345678',tipo:'Celular'}],emails:['email inválido','ficticio@example.invalid'],empresa:'Empresa fictícia'};
const contato:ContatoOperacao={id:'11111111-1111-4111-8111-111111111111',nome:'Nome existente fictício',telefone:'5511912345678',email:null,tags:[],hubClienteId:null,descricao:'Descrição existente',classificacao:'cliente',versao:4,conversaId:null};
const conversa:ConversaOperacao={id:'22222222-2222-4222-8222-222222222222',contatoId:contato.id,nome:contato.nome,telefone:contato.telefone,canal:'whatsapp',estado:'humano',responsavelId:null,equipeId:null,tags:[],versao:2,ultimaMensagemEm:null,ficticia:true,somenteLeitura:false};
function fixture(){
 const buscar=vi.fn<typeof fetch>(()=>Promise.reject(Error('SEM_REDE_NO_TESTE'))),cliente=criarClienteOperacao(buscar);
 const criar=vi.spyOn(cliente,'criarContato').mockResolvedValue({contato,reutilizado:true}),iniciar=vi.spyOn(cliente,'iniciarConversaContato').mockResolvedValue({contato,conversa,reutilizada:true}),enviar=vi.spyOn(cliente,'enviar');
 const abrir=vi.fn(),falhar=vi.fn();return {cliente,buscar,criar,iniciar,enviar,abrir,falhar};
}
function cartao(f:ReturnType<typeof fixture>,dados=compartilhado,capacidades:PermissaoOperacao[]=permissoes){return <CartaoContatoCompartilhado contato={dados} cliente={f.cliente} permissoes={capacidades} abrirConversa={f.abrir} falhar={f.falhar}/>;}
afterEach(()=>{cleanup();vi.restoreAllMocks();history.replaceState(null,'','/operacao/chat');});

it('exibe nome, empresa e telefone legível no cartão, sem executar ação ao renderizar',()=>{
 const f=fixture();render(cartao(f));expect(screen.getByRole('region',{name:'Contato compartilhado: Pessoa compartilhada fictícia'})).toBeTruthy();expect(screen.getByText('+55 (11) 91234-5678')).toBeTruthy();expect(screen.getByText('Empresa fictícia')).toBeTruthy();expect(screen.getByRole('button',{name:'Salvar contato'})).toHaveProperty('disabled',false);expect(screen.getByRole('button',{name:'Iniciar conversa'})).toHaveProperty('disabled',false);expect(f.criar).not.toHaveBeenCalled();expect(f.iniciar).not.toHaveBeenCalled();expect(f.enviar).not.toHaveBeenCalled();
});

it('abre o cadastro preenchido, permite revisão e salva sem iniciar ou enviar',async()=>{
 const f=fixture();render(cartao(f));fireEvent.click(screen.getByRole('button',{name:'Salvar contato'}));const modal=screen.getByRole('dialog',{name:'Novo contato'});expect(within(modal).getByLabelText('Nome')).toHaveProperty('value',compartilhado.nome);expect(within(modal).getByLabelText('Telefone')).toHaveProperty('value','+55 (11) 91234-5678');expect(within(modal).getByLabelText('E-mail (opcional)')).toHaveProperty('value','ficticio@example.invalid');expect(within(modal).getByLabelText('Descrição breve (opcional)')).toHaveProperty('value','Empresa fictícia');
 fireEvent.change(within(modal).getByLabelText('Nome'),{target:{value:'Nome revisado fictício'}});fireEvent.click(within(modal).getByRole('button',{name:'Salvar contato'}));await screen.findByText('Este telefone já tem cadastro. Os dados existentes foram preservados.');expect(f.criar).toHaveBeenCalledWith(expect.objectContaining({nome:'Nome revisado fictício',telefone:'+55 (11) 91234-5678',email:'ficticio@example.invalid',descricao:'Empresa fictícia',classificacao:'lead'}));expect(f.iniciar).not.toHaveBeenCalled();expect(f.enviar).not.toHaveBeenCalled();
});

it('inicia pelo cadastro retornado e preserva o contato existente, sem enviar mensagem',async()=>{
 const f=fixture();render(cartao(f));fireEvent.click(screen.getByRole('button',{name:'Iniciar conversa'}));await waitFor(()=>expect(f.abrir).toHaveBeenCalledWith(conversa));expect(f.criar).toHaveBeenCalledWith(expect.objectContaining({nome:compartilhado.nome,telefone:'+5511912345678',email:'ficticio@example.invalid'}));expect(f.iniciar).toHaveBeenCalledWith({contatoId:contato.id,versaoContato:4,idempotencia:expect.any(String)});expect(f.enviar).not.toHaveBeenCalled();expect(f.buscar).not.toHaveBeenCalled();
});

it('não reutiliza no cartão o cadastro de outro telefone escolhido no formulário',async()=>{
 const f=fixture();f.criar.mockResolvedValueOnce({contato:{...contato,id:'55555555-5555-4555-8555-555555555555',telefone:'5511987654321'},reutilizado:false});render(cartao(f));fireEvent.click(screen.getByRole('button',{name:'Salvar contato'}));const modal=screen.getByRole('dialog',{name:'Novo contato'});fireEvent.change(within(modal).getByLabelText('Telefone'),{target:{value:'+5511987654321'}});fireEvent.click(within(modal).getByRole('button',{name:'Salvar contato'}));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());fireEvent.click(screen.getByRole('button',{name:'Iniciar conversa'}));await waitFor(()=>expect(f.abrir).toHaveBeenCalledWith(conversa));expect(f.criar).toHaveBeenCalledTimes(2);expect(f.criar.mock.calls[1][0].telefone).toBe('+5511912345678');expect(f.iniciar).toHaveBeenCalledWith(expect.objectContaining({contatoId:contato.id}));expect(f.enviar).not.toHaveBeenCalled();
});

it('oferece todos os contatos do compartilhamento em blocos de20 sem truncar o último',()=>{
 const f=fixture();const contatos=Array.from({length:21},(_,i)=>({...compartilhado,nome:'Contato fictício '+(i+1)}));render(<ContatosCompartilhadosMensagem contatos={contatos} cliente={f.cliente} permissoes={permissoes} abrirConversa={f.abrir} falhar={f.falhar}/>);expect(screen.getAllByRole('region',{name:/Contato compartilhado:/})).toHaveLength(20);expect(screen.queryByRole('region',{name:'Contato compartilhado: Contato fictício 21'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Mostrar mais contatos'}));expect(screen.getAllByRole('region',{name:/Contato compartilhado:/})).toHaveLength(21);expect(screen.getByRole('region',{name:'Contato compartilhado: Contato fictício 21'})).toBeTruthy();expect(screen.queryByRole('button',{name:'Mostrar mais contatos'})).toBeNull();expect(f.criar).not.toHaveBeenCalled();expect(f.enviar).not.toHaveBeenCalled();
});

it('exige a escolha explícita entre telefones válidos e mantém os inválidos visíveis',async()=>{
 const f=fixture();f.criar.mockResolvedValue({contato:{...contato,telefone:'12025550123'},reutilizado:false});render(cartao(f,{...compartilhado,telefones:[...compartilhado.telefones,{numero:'+12025550123',tipo:'Trabalho'},{numero:'123',tipo:'Outro'}]}));expect(screen.getByText('123')).toBeTruthy();expect(screen.getByRole('button',{name:'Iniciar conversa'})).toHaveProperty('disabled',true);fireEvent.click(screen.getByRole('combobox',{name:/Telefone do contato/}));const opcao=await screen.findByRole('option',{name:'+12025550123'});fireEvent.pointerDown(opcao,{pointerType:'mouse'});fireEvent.click(opcao);fireEvent.click(screen.getByRole('button',{name:'Iniciar conversa'}));await waitFor(()=>expect(f.abrir).toHaveBeenCalled());expect(f.criar).toHaveBeenCalledWith(expect.objectContaining({telefone:'+12025550123'}));
});

it.each([{telefones:[]},{telefones:[{numero:'123',tipo:'Celular'}]}])('explica a indisponibilidade sem telefone válido',({telefones})=>{
 const f=fixture();render(cartao(f,{...compartilhado,telefones}));expect(screen.getByText(/não tem telefone válido/)).toBeTruthy();expect(screen.getByRole('button',{name:'Salvar contato'})).toHaveProperty('disabled',true);expect(screen.getByRole('button',{name:'Iniciar conversa'})).toHaveProperty('disabled',true);expect(f.criar).not.toHaveBeenCalled();
});

it.each(permissoes.filter(p=>p!=='atender'))('não inicia sem a permissão %s',permissao=>{
 const f=fixture();render(cartao(f,compartilhado,permissoes.filter(p=>p!==permissao)));fireEvent.click(screen.getByRole('button',{name:'Iniciar conversa'}));expect(f.criar).not.toHaveBeenCalled();expect(f.iniciar).not.toHaveBeenCalled();if(['contatos.adicionar','contatos.visualizar'].includes(permissao))expect(screen.getByRole('button',{name:'Salvar contato'})).toHaveProperty('disabled',true);
});

it('evita comando duplicado ao clicar duas vezes e ignora retorno após desmontagem',async()=>{
 const f=fixture();let liberar:(v:{contato:ContatoOperacao;reutilizado:boolean})=>void=()=>undefined;f.criar.mockImplementation(()=>new Promise(r=>{liberar=r;}));const tela=render(cartao(f));const botao=screen.getByRole('button',{name:'Iniciar conversa'});fireEvent.click(botao);fireEvent.click(botao);expect(f.criar).toHaveBeenCalledTimes(1);tela.unmount();await act(async()=>{liberar({contato,reutilizado:true});});expect(f.iniciar).not.toHaveBeenCalled();expect(f.abrir).not.toHaveBeenCalled();
});

it('não continua o início depois da perda de permissão durante o cadastro',async()=>{
 const f=fixture();let liberar:(v:{contato:ContatoOperacao;reutilizado:boolean})=>void=()=>undefined;f.criar.mockImplementation(()=>new Promise(r=>{liberar=r;}));const tela=render(cartao(f));fireEvent.click(screen.getByRole('button',{name:'Iniciar conversa'}));tela.rerender(cartao(f,compartilhado,['consultar']));await act(async()=>{liberar({contato,reutilizado:true});});expect(f.iniciar).not.toHaveBeenCalled();expect(f.abrir).not.toHaveBeenCalled();
});

it('não navega se a conversa de origem sai da tela durante a confirmação do início',async()=>{
 const f=fixture();let liberar:(v:{contato:ContatoOperacao;conversa:ConversaOperacao;reutilizada:boolean})=>void=()=>undefined;f.iniciar.mockImplementation(()=>new Promise(r=>{liberar=r;}));const tela=render(cartao(f));fireEvent.click(screen.getByRole('button',{name:'Iniciar conversa'}));await waitFor(()=>expect(f.iniciar).toHaveBeenCalledTimes(1));tela.unmount();await act(async()=>{liberar({contato,conversa,reutilizada:true});});expect(f.abrir).not.toHaveBeenCalled();expect(f.enviar).not.toHaveBeenCalled();
});

it('repete o mesmo cadastro quando a confirmação fica incerta',async()=>{
 const f=fixture();f.criar.mockRejectedValueOnce(new ErroOperacao('RESULTADO_INCERTO'));render(cartao(f));fireEvent.click(screen.getByRole('button',{name:'Iniciar conversa'}));fireEvent.click(await screen.findByRole('button',{name:'Conferir conversa'}));await waitFor(()=>expect(f.abrir).toHaveBeenCalled());expect(f.criar.mock.calls[1][0]).toEqual(f.criar.mock.calls[0][0]);expect(f.iniciar).toHaveBeenCalledTimes(1);expect(f.enviar).not.toHaveBeenCalled();
});

it('repete o mesmo início incerto sem recadastrar o contato',async()=>{
 const f=fixture();f.iniciar.mockRejectedValueOnce(new ErroOperacao('RESULTADO_INCERTO'));render(cartao(f));fireEvent.click(screen.getByRole('button',{name:'Iniciar conversa'}));fireEvent.click(await screen.findByRole('button',{name:'Conferir conversa'}));await waitFor(()=>expect(f.abrir).toHaveBeenCalled());expect(f.criar).toHaveBeenCalledTimes(1);expect(f.iniciar.mock.calls[1][0]).toEqual(f.iniciar.mock.calls[0][0]);expect(f.enviar).not.toHaveBeenCalled();
});

it('não abre outro telefone se o retorno do cadastro for inconsistente',async()=>{
 const f=fixture();f.criar.mockResolvedValue({contato:{...contato,telefone:'5511987654321'},reutilizado:true});render(cartao(f));fireEvent.click(screen.getByRole('button',{name:'Iniciar conversa'}));await screen.findByRole('button',{name:'Conferir conversa'});expect(f.iniciar).not.toHaveBeenCalled();expect(f.abrir).not.toHaveBeenCalled();
});

it('renderiza cartões no histórico e abre o destino ao iniciar sem qualquer envio',async()=>{
 const f=fixture();const origem={...conversa,id:'33333333-3333-4333-8333-333333333333',nome:'Cliente de origem fictício',estado:'encerrada' as const};
 vi.spyOn(f.cliente,'sessao').mockResolvedValue({usuario:{id:'usuario-ficticio',nome:'Atendente fictício',perfilId:'perfil-ficticio',permissoes},csrf:'csrf-ficticio',modo:'homologacao',escritasReais:false});
 vi.spyOn(f.cliente,'status').mockResolvedValue({modo:'homologacao',enviosReais:false,receptor:'desarmado',fila:{pendentes:0,incertos:0,falhas:0},backup:{ultimoSucessoEm:null,falha:null},agente:{modo:'desligado',modelo:'modelo-ficticio',disponivel:false},woocommerce:null,meta:null,atualizadoEm:'2026-10-15T14:00:00.000Z',importadoEm:null});
 vi.spyOn(f.cliente,'conversas').mockResolvedValue({registros:[origem],mais:false,pagina:0,contagens:null,contagensConferidasEm:null});vi.spyOn(f.cliente,'observarChat').mockImplementation(()=>()=>undefined);vi.spyOn(f.cliente,'abrirConversa').mockResolvedValue({registrada:true});vi.spyOn(f.cliente,'rascunho').mockResolvedValue({texto:'',versao:0});
 const historico=vi.spyOn(f.cliente,'historico').mockImplementation(async id=>({conversa:id===origem.id?origem:conversa,registros:id===origem.id?[{id:'44444444-4444-4444-8444-444444444444',conversaId:origem.id,autor:'cliente',autorId:null,autorNome:null,conteudo:'Contato compartilhado: Pessoa compartilhada fictícia',tipo:'contacts',estado:'recebido',criadaEm:'2026-10-15T14:00:00.000Z',anexoId:null,citadaId:null,contatosCompartilhados:[compartilhado]}]:[],notas:[],proxima:null}));
 render(<ChatOperacao cliente={f.cliente}/>);fireEvent.click(await screen.findByRole('button',{name:/Cliente de origem fictício/},{timeout:10000}));await screen.findByRole('region',{name:/Contato compartilhado:/});expect(screen.queryByText('Contato compartilhado: Pessoa compartilhada fictícia')).toBeNull();expect(screen.getByText('+55 (11) 91234-5678')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Iniciar conversa'}));await waitFor(()=>expect(historico).toHaveBeenCalledWith(conversa.id,null,expect.any(AbortSignal)));expect(f.iniciar).toHaveBeenCalledTimes(1);expect(f.enviar).not.toHaveBeenCalled();
});
