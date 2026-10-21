// @vitest-environment jsdom
import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import NovoContatoOperacao from '../../apps/atendimento-chat-consulta/NovoContatoOperacao';
import ContatosOperacao from '../../apps/atendimento-chat-consulta/ContatosOperacao';
import ChatOperacao from '../../apps/atendimento-chat-consulta/ChatOperacao';
import {criarClienteOperacao,type ContatoOperacao,type ConversaOperacao,type PermissaoOperacao} from '../../apps/atendimento-chat-consulta/operacao-api';

const idContato='11111111-1111-4111-8111-111111111111',idConversa='22222222-2222-4222-8222-222222222222';
const permissoes:PermissaoOperacao[]=['consultar','atender','contatos.visualizar','contatos.adicionar','contatos.editar','conversas.visualizar','conversas.adicionar','mensagens.visualizar','mensagens.adicionar','modelos.visualizar'];
const contatoBase:ContatoOperacao={id:idContato,nome:'Pessoa fictícia',telefone:'5511912345678',email:null,tags:[],hubClienteId:null,descricao:'Empresa fictícia',classificacao:'lead',notas:'',versao:3,conversaId:null,canal:'whatsapp'};
const conversaBase:ConversaOperacao={id:idConversa,contatoId:idContato,nome:contatoBase.nome,telefone:contatoBase.telefone,canal:'whatsapp',estado:'humano',responsavelId:'atendente-ficticio',equipeId:null,tags:[],versao:1,ultimaMensagemEm:null,janelaRespostaAberta:false,ficticia:true,somenteLeitura:false};
const json=(valor:unknown,status=200)=>new Response(JSON.stringify(valor),{status,headers:{'content-type':'application/json'}});
function fixture(opcoes:{contato?:Partial<ContatoOperacao>;conversa?:Partial<ConversaOperacao>;permissoes?:PermissaoOperacao[];aceitarEnvioTemplate?:boolean;responderCriacao?:(dados:Record<string,unknown>)=>Response|Promise<Response>;responderInicio?:(dados:Record<string,unknown>)=>Response|Promise<Response>}={}){
 const contato={...contatoBase,...opcoes.contato},conversa={...conversaBase,...opcoes.conversa};let criada=false;
 const buscar=vi.fn<typeof fetch>(async(entrada,init)=>{
  const u=new URL(String(entrada),'https://ficticio.invalid'),caminho=u.pathname.replace('/api/atendimento/operacao','');
  if(caminho==='/sessao')return json({usuario:{id:'atendente-ficticio',nome:'Atendente fictício',perfilId:'perfil-ficticio',permissoes:opcoes.permissoes??permissoes},csrf:'csrf-ficticio',modo:'homologacao',escritasReais:false});
  if(caminho==='/contatos')return json({registros:[contato],mais:false,pagina:0});
  if(caminho==='/contato')return json({contato});
  if(caminho==='/contatos/criar'){const dados=JSON.parse(String(init?.body)) as Record<string,unknown>;return opcoes.responderCriacao?opcoes.responderCriacao(dados):json({contato,reutilizado:false},201);}
  if(caminho==='/contatos/iniciar-conversa'){const dados=JSON.parse(String(init?.body)) as Record<string,unknown>;if(opcoes.responderInicio)return opcoes.responderInicio(dados);criada=true;return json({contato:{...contato,conversaId:idConversa},conversa,reutilizada:false});}
  if(caminho==='/conversas')return json({registros:criada||contato.conversaId?[conversa]:[],mais:false,pagina:0});
  if(caminho==='/historico')return json({conversa,registros:[],notas:[],proxima:null});
  if(caminho.endsWith('/abertura'))return json({registrada:true});
  if(caminho==='/rascunho')return json({texto:'Rascunho fictício preservado',versao:1});
  if(caminho==='/modelos')return json({registros:[{id:'template-ficticio',nome:'inicio_ficticio',idioma:'pt_BR',estado:'APPROVED',suportado:true,variaveis:[],componentes:[{type:'BODY',text:'Mensagem de template fictícia.'}],versao:1}]});
  if(caminho==='/mensagens/envio'&&opcoes.aceitarEnvioTemplate)return json({id:'33333333-3333-4333-8333-333333333333',estado:'aceito_simulado'});
  if(caminho==='/status')return json({modo:'homologacao',enviosReais:false,receptor:'desarmado',fila:{pendentes:0,incertos:0,falhas:0},backup:{ultimoSucessoEm:null,falha:null},agente:{modo:'desligado',modelo:'modelo-ficticio',disponivel:false},atualizadoEm:'2026-10-14T14:00:00.000Z',importadoEm:null});
  throw Error('ENDPOINT_FICTICIO_NAO_PREVISTO:'+caminho);
 });
 const cliente=criarClienteOperacao(buscar);cliente.observarChat=()=>()=>undefined;return {cliente,buscar};
}
const escritas=(buscar:ReturnType<typeof fixture>['buscar'],caminho:string)=>buscar.mock.calls.filter(([u,init])=>String(u).endsWith(caminho)&&init?.method==='POST');
const preencher=()=>{fireEvent.change(screen.getByLabelText('Nome'),{target:{value:'Pessoa nova fictícia'}});fireEvent.change(screen.getByLabelText('Telefone'),{target:{value:'(11) 91234-5678'}});};
afterEach(()=>{cleanup();vi.restoreAllMocks();history.replaceState(null,'','/operacao/chat');});

it('valida telefone com Input oficial, DDI visível e conferência canônica sem salvar ao perder foco',async()=>{
 const {cliente,buscar}=fixture();await cliente.sessao();render(<NovoContatoOperacao podeSalvar cliente={cliente} fechar={()=>undefined} salvo={()=>undefined} falhar={()=>undefined}/>);
 const telefone=screen.getByLabelText('Telefone');expect(telefone.getAttribute('maxlength')).toBe('19');expect(screen.getByText(/Brasil: DDI \+55/)).toBeTruthy();
 expect(fireEvent.keyDown(telefone,{key:'a'})).toBe(false);expect(fireEvent.paste(telefone,{clipboardData:{getData:()=>'(11) letras'}})).toBe(false);
 preencher();expect(screen.getByText('+5511912345678')).toBeTruthy();fireEvent.change(telefone,{target:{value:'abc'}});expect(telefone).toHaveProperty('value','(11) 91234-5678');fireEvent.blur(telefone);expect(escritas(buscar,'/contatos/criar')).toHaveLength(0);
});

it.each(['(11) 12345','(20) 91234-5678','+5500199999999','+1','(11) 91234-56789012345'])('não salva telefone inválido %s',async(telefone)=>{
 const {cliente,buscar}=fixture();await cliente.sessao();render(<NovoContatoOperacao podeSalvar cliente={cliente} fechar={()=>undefined} salvo={()=>undefined} falhar={()=>undefined}/>);fireEvent.change(screen.getByLabelText('Nome'),{target:{value:'Nome fictício'}});fireEvent.change(screen.getByLabelText('Telefone'),{target:{value:telefone}});fireEvent.blur(screen.getByLabelText('Telefone'));expect(screen.getByRole('button',{name:'Salvar contato'})).toHaveProperty('disabled',true);expect(screen.getByText('Confira o DDD, o DDI e a quantidade de dígitos do telefone.')).toBeTruthy();expect(escritas(buscar,'/contatos/criar')).toHaveLength(0);
});

it.each([['(55) 91234-5678','(55) 91234-5678','+5555912345678'],['(11) 2345-6789','(11) 2345-6789','+551123456789'],['+1 (202) 555-0123','+12025550123','+12025550123'],['+5511912345678','+55 (11) 91234-5678','+5511912345678']])('preserva dígitos informados e permite formato %s',async(telefone,formatado,canonico)=>{
 const {cliente}=fixture();await cliente.sessao();render(<NovoContatoOperacao podeSalvar cliente={cliente} fechar={()=>undefined} salvo={()=>undefined} falhar={()=>undefined}/>);fireEvent.change(screen.getByLabelText('Nome'),{target:{value:'Nome fictício'}});fireEvent.change(screen.getByLabelText('Telefone'),{target:{value:telefone}});expect(screen.getByText(canonico)).toBeTruthy();expect(screen.getByLabelText('Telefone')).toHaveProperty('value',formatado);expect(screen.getByRole('button',{name:'Salvar contato'})).toHaveProperty('disabled',false);
});

it('salva explicitamente uma vez e não inicia conversa nem envia mensagem no cadastro',async()=>{
 let liberar:(r:Response)=>void=()=>undefined;const {cliente,buscar}=fixture({responderCriacao:()=>new Promise<Response>(r=>{liberar=r;})});await cliente.sessao();const salvo=vi.fn();render(<NovoContatoOperacao podeSalvar cliente={cliente} fechar={()=>undefined} salvo={salvo} falhar={()=>undefined}/>);preencher();const salvar=screen.getByRole('button',{name:'Salvar contato'});fireEvent.click(salvar);fireEvent.click(salvar);await waitFor(()=>expect(escritas(buscar,'/contatos/criar')).toHaveLength(1));expect(screen.getByLabelText('Telefone')).toHaveProperty('disabled',true);liberar(json({contato:contatoBase,reutilizado:false},201));await waitFor(()=>expect(salvo).toHaveBeenCalledWith(contatoBase,false));const dados=JSON.parse(String(escritas(buscar,'/contatos/criar')[0][1]?.body));expect(dados).toMatchObject({nome:'Pessoa nova fictícia',telefone:'(11) 91234-5678',ddi:'55',classificacao:'lead',idempotencia:expect.any(String)});expect(escritas(buscar,'/contatos/iniciar-conversa')).toHaveLength(0);expect(escritas(buscar,'/mensagens/envio')).toHaveLength(0);
});

it('confere cadastro incerto com o mesmo pedido, sem nova chave ou edição silenciosa',async()=>{
 let chamadas=0;const {cliente,buscar}=fixture({responderCriacao:()=>{chamadas++;return chamadas===1?Promise.reject(Error('REDE_FICTICIA')):json({contato:contatoBase,reutilizado:true},201);}});await cliente.sessao();const salvo=vi.fn();render(<NovoContatoOperacao podeSalvar cliente={cliente} fechar={()=>undefined} salvo={salvo} falhar={()=>undefined}/>);preencher();fireEvent.click(screen.getByRole('button',{name:'Salvar contato'}));const conferir=await screen.findByRole('button',{name:'Conferir cadastro'});expect(screen.getByLabelText('Nome')).toHaveProperty('disabled',true);fireEvent.click(conferir);await waitFor(()=>expect(salvo).toHaveBeenCalled());const pedidos=escritas(buscar,'/contatos/criar');expect(pedidos).toHaveLength(2);expect(pedidos[1][1]?.body).toBe(pedidos[0][1]?.body);
});

it('não oferece Novo contato nem permite Iniciar sem as capacidades atuais',async()=>{
 const {cliente,buscar}=fixture();await cliente.sessao();render(<ContatosOperacao cliente={cliente} busca="" revisao={0} falhar={()=>undefined} pesquisar={()=>undefined} permissoes={['consultar','contatos.visualizar','mensagens.visualizar']} abrirConversa={()=>undefined}/>);fireEvent.click(await screen.findByRole('button',{name:/Pessoa fictícia/}));expect(screen.queryByRole('button',{name:'Novo contato'})).toBeNull();expect(screen.getByRole('button',{name:'Iniciar conversa'})).toHaveProperty('disabled',true);expect(escritas(buscar,'/contatos/iniciar-conversa')).toHaveLength(0);
});

it('contato duplicado fica selecionado com dados preservados e aviso, sem início automático',async()=>{
 const {cliente,buscar}=fixture({responderCriacao:()=>json({contato:contatoBase,reutilizado:true},201)});await cliente.sessao();render(<ContatosOperacao cliente={cliente} busca="" revisao={0} falhar={()=>undefined} pesquisar={()=>undefined} permissoes={permissoes} abrirConversa={()=>undefined}/>);fireEvent.click(screen.getByRole('button',{name:'Novo contato'}));preencher();fireEvent.click(screen.getByRole('button',{name:'Salvar contato'}));await screen.findByText('Este telefone já tem cadastro. Abrimos o contato existente e preservamos seus dados.');expect(screen.queryByRole('dialog')).toBeNull();expect(within(screen.getByRole('region',{name:'Contato selecionado'})).getByRole('heading',{name:'Pessoa fictícia'})).toBeTruthy();expect(escritas(buscar,'/contatos/iniciar-conversa')).toHaveLength(0);
});

it('abre conversa existente pelo ID do contato como leitura e preserva estado/responsável',async()=>{
 const {cliente,buscar}=fixture({contato:{conversaId:idConversa},conversa:{estado:'pausado',responsavelId:'outro-atendente-ficticio'}});await cliente.sessao();const abrir=vi.fn();render(<ContatosOperacao cliente={cliente} busca="" revisao={0} falhar={()=>undefined} pesquisar={()=>undefined} permissoes={['consultar','contatos.visualizar','mensagens.visualizar']} abrirConversa={abrir}/>);fireEvent.click(await screen.findByRole('button',{name:/Pessoa fictícia/}));fireEvent.click(screen.getByRole('button',{name:'Abrir conversa'}));await waitFor(()=>expect(abrir).toHaveBeenCalledWith(expect.objectContaining({id:idConversa,contatoId:idContato,estado:'pausado',responsavelId:'outro-atendente-ficticio'})));expect(escritas(buscar,'/contatos/iniciar-conversa')).toHaveLength(0);expect(buscar.mock.calls.some(([u])=>String(u).includes('/historico?conversaId='+idConversa))).toBe(true);
});

it.each(['instagram','facebook'] as const)('não inicia WhatsApp em contato vinculado ao %s',async(canal)=>{
 const {cliente,buscar}=fixture({contato:{canal}});await cliente.sessao();render(<ContatosOperacao cliente={cliente} busca="" revisao={0} falhar={()=>undefined} pesquisar={()=>undefined} permissoes={permissoes} abrirConversa={()=>undefined}/>);fireEvent.click(await screen.findByRole('button',{name:/Pessoa fictícia/}));expect(screen.getByRole('button',{name:'Iniciar conversa'})).toHaveProperty('disabled',true);expect(escritas(buscar,'/contatos/iniciar-conversa')).toHaveLength(0);
});

it('resultado incerto ao iniciar repete exatamente o pedido após ação explícita Conferir conversa',async()=>{
 let chamadas=0;const {cliente,buscar}=fixture({responderInicio:()=>{chamadas++;return chamadas===1?Promise.reject(Error('REDE_FICTICIA')):json({contato:{...contatoBase,conversaId:idConversa},conversa:conversaBase,reutilizada:true});}});await cliente.sessao();const abrir=vi.fn();render(<ContatosOperacao cliente={cliente} busca="" revisao={0} falhar={()=>undefined} pesquisar={()=>undefined} permissoes={permissoes} abrirConversa={abrir}/>);fireEvent.click(await screen.findByRole('button',{name:/Pessoa fictícia/}));fireEvent.click(screen.getByRole('button',{name:'Iniciar conversa'}));fireEvent.click(await screen.findByRole('button',{name:'Conferir conversa'}));await waitFor(()=>expect(abrir).toHaveBeenCalled());const pedidos=escritas(buscar,'/contatos/iniciar-conversa');expect(pedidos).toHaveLength(2);expect(pedidos[1][1]?.body).toBe(pedidos[0][1]?.body);expect(JSON.parse(String(pedidos[0][1]?.body))).toMatchObject({contatoId:idContato,versaoContato:3,idempotencia:expect.any(String)});expect(escritas(buscar,'/mensagens/envio')).toHaveLength(0);
});

it('inicia no Chat pelo ID correto e exige ação explícita de template sem liberar envio livre',async()=>{
 const {cliente,buscar}=fixture();render(<ChatOperacao cliente={cliente}/>);fireEvent.click(await screen.findByRole('tab',{name:'Contatos'}));fireEvent.click(await screen.findByRole('button',{name:/Pessoa fictícia/}));fireEvent.click(screen.getByRole('button',{name:'Iniciar conversa'}));await screen.findByText('Envie um template aprovado para iniciar ou retomar o contato. Mensagens livres ficam disponíveis quando o cliente responder.');expect(screen.getByRole('tab',{name:'Conversas'}).getAttribute('aria-selected')).toBe('true');expect(screen.getByRole('textbox',{name:'Mensagem'})).toHaveProperty('value','Rascunho fictício preservado');expect(screen.getByRole('button',{name:'Enviar'})).toHaveProperty('disabled',true);fireEvent.keyDown(screen.getByRole('textbox',{name:'Mensagem'}),{key:'Enter'});expect(escritas(buscar,'/mensagens/envio')).toHaveLength(0);fireEvent.click(screen.getByRole('button',{name:'Escolher template'}));await screen.findByRole('dialog',{name:'Enviar template'});expect(escritas(buscar,'/mensagens/envio')).toHaveLength(0);expect(escritas(buscar,'/contatos/iniciar-conversa')).toHaveLength(1);
});

it('recusa de telefone no servidor preserva o formulário e mostra motivo claro',async()=>{
 const {cliente,buscar}=fixture({responderCriacao:()=>json({erro:'OPERACAO_TELEFONE_INVALIDO'},400)});await cliente.sessao();render(<NovoContatoOperacao podeSalvar cliente={cliente} fechar={()=>undefined} salvo={()=>undefined} falhar={()=>undefined}/>);preencher();fireEvent.click(screen.getByRole('button',{name:'Salvar contato'}));expect((await screen.findByRole('alert')).textContent).toBe('O telefone é inválido. Confira o DDI, o DDD e os dígitos do número.');expect(screen.getByLabelText('Nome')).toHaveProperty('value','Pessoa nova fictícia');expect(screen.getByLabelText('Telefone')).toHaveProperty('value','(11) 91234-5678');expect(escritas(buscar,'/contatos/criar')).toHaveLength(1);
});

it('início com retorno de outro contato não abre a identidade errada',async()=>{
 const {cliente,buscar}=fixture({responderInicio:()=>json({contato:{...contatoBase,id:'outro-contato-ficticio'},conversa:conversaBase,reutilizada:true})});await cliente.sessao();const abrir=vi.fn();render(<ContatosOperacao cliente={cliente} busca="" revisao={0} falhar={()=>undefined} pesquisar={()=>undefined} permissoes={permissoes} abrirConversa={abrir}/>);fireEvent.click(await screen.findByRole('button',{name:/Pessoa fictícia/}));fireEvent.click(screen.getByRole('button',{name:'Iniciar conversa'}));await screen.findByRole('button',{name:'Conferir conversa'});expect(abrir).not.toHaveBeenCalled();expect(escritas(buscar,'/contatos/iniciar-conversa')).toHaveLength(1);
});

it('clique duplo em Iniciar conserva um comando e não envia mensagem',async()=>{
 let liberar:(r:Response)=>void=()=>undefined;const {cliente,buscar}=fixture({responderInicio:()=>new Promise<Response>(r=>{liberar=r;})});await cliente.sessao();const abrir=vi.fn();render(<ContatosOperacao cliente={cliente} busca="" revisao={0} falhar={()=>undefined} pesquisar={()=>undefined} permissoes={permissoes} abrirConversa={abrir}/>);fireEvent.click(await screen.findByRole('button',{name:/Pessoa fictícia/}));const inicio=screen.getByRole('button',{name:'Iniciar conversa'});fireEvent.click(inicio);fireEvent.click(inicio);await waitFor(()=>expect(escritas(buscar,'/contatos/iniciar-conversa')).toHaveLength(1));liberar(json({contato:contatoBase,conversa:conversaBase,reutilizada:false}));await waitFor(()=>expect(abrir).toHaveBeenCalled());expect(escritas(buscar,'/mensagens/envio')).toHaveLength(0);
});

it('enviar template por ação explícita não abre a janela de mensagens livres',async()=>{
 const {cliente,buscar}=fixture({aceitarEnvioTemplate:true});render(<ChatOperacao cliente={cliente}/>);fireEvent.click(await screen.findByRole('tab',{name:'Contatos'}));fireEvent.click(await screen.findByRole('button',{name:/Pessoa fictícia/}));fireEvent.click(screen.getByRole('button',{name:'Iniciar conversa'}));fireEvent.click(await screen.findByRole('button',{name:'Escolher template'}));const popup=await screen.findByRole('dialog',{name:'Enviar template'});fireEvent.click(await within(popup).findByRole('radio',{name:/inicio_ficticio/}));fireEvent.click(within(popup).getByRole('button',{name:'Enviar template'}));await screen.findByText(/Mensagem registrada com transporte de teste/);expect(screen.getByRole('button',{name:'Enviar'})).toHaveProperty('disabled',true);const envios=escritas(buscar,'/mensagens/envio');expect(envios).toHaveLength(1);expect(JSON.parse(String(envios[0][1]?.body)).tipo).toBe('template');expect(screen.getByRole('textbox',{name:'Mensagem'})).toHaveProperty('value','Rascunho fictício preservado');
});
