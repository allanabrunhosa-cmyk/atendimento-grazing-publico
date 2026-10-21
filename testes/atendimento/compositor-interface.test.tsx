// @vitest-environment jsdom
import React from 'react';
import {it,expect,vi,afterEach} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import ChatOperacao from '../../apps/atendimento-chat-consulta/ChatOperacao';
import {criarClienteOperacao,type MensagemOperacao,type PermissaoOperacao} from '../../apps/atendimento-chat-consulta/operacao-api';
import {LISTA_CAPACIDADES_ATENDIMENTO} from '../../src/lib/permissoes/atendimento';

const conversaId='11111111-1111-4111-8111-111111111111',originalId='22222222-2222-4222-8222-222222222222',respostaId='33333333-3333-4333-8333-333333333333',anexoId='44444444-4444-4444-8444-444444444444',em='2026-10-13T12:00:00.000Z';
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json'}});
const conversa={id:conversaId,contatoId:'contato-ficticio',nome:'Cliente fictício',telefone:'00000000',canal:'whatsapp',estado:'humano',responsavelId:'ator-ficticio',equipeId:null,tags:[],versao:1,ultimaMensagemEm:em,ficticia:true,somenteLeitura:false};
const mensagem:MensagemOperacao={id:originalId,conversaId,autor:'cliente',autorId:null,autorNome:null,conteudo:'Mensagem fictícia 🙂👍🏽',tipo:'text',estado:'recebido',criadaEm:em,anexoId:null,citadaId:null};
function fixture(registros:MensagemOperacao[]=[mensagem],permissoes:PermissaoOperacao[]=LISTA_CAPACIDADES_ATENDIMENTO){
 const buscar=vi.fn<typeof fetch>(async(url,opcoes)=>{const path=new URL(String(url),'https://fixture.invalid').pathname.split('/operacao')[1];
  if(path==='/sessao')return json({usuario:{id:'ator-ficticio',nome:'Ana Fictícia',perfilId:'perfil-ficticio',permissoes},csrf:'csrf-ficticio',modo:'homologacao',escritasReais:false});
  if(path==='/conversas')return json({registros:[conversa],mais:false,pagina:0});
  if(path==='/historico')return json({conversa,registros,notas:[],proxima:null});
  if(path==='/equipe')return json({usuarios:[],equipes:[]});
  if(path==='/rascunho')return json(opcoes?.method==='PUT'?{texto:JSON.parse(String(opcoes.body)).texto,versao:1}:{texto:'',versao:0});
  if(path==='/status')return json({modo:'homologacao',enviosReais:false,receptor:'ensaio',fila:{pendentes:0,incertos:0,falhas:0},backup:{ultimoSucessoEm:null,falha:null},agente:{modo:'desligado',modelo:'fixture',disponivel:false},atualizadoEm:em,importadoEm:em});
  if(path==='/mensagens/envio')return json({id:respostaId,estado:'aceito_simulado'});
  throw Error('ROTA_FICTICIA_AUSENTE:'+path);
 });return {buscar,cliente:criarClienteOperacao(buscar)};
}
async function abrir(){fireEvent.click(await screen.findByRole('button',{name:/Cliente fictício/}));const campo=await screen.findByRole('textbox',{name:'Mensagem'});await waitFor(()=>expect(campo).toHaveProperty('disabled',false));return campo as HTMLTextAreaElement;}
const transferencia=(arquivos:File[])=>({types:['Files'],files:arquivos,dropEffect:'none'});
const arquivoPDF=()=>new File(['%PDF-1.4\nArquivo fictício'],'arquivo-ficticio.pdf',{type:'application/pdf'});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});

it('arrastar documento anexa uma vez, mantém a legenda e só envia após confirmação explícita',async()=>{
 const {cliente,buscar}=fixture();let concluir:((v:{id:string;nome:string;mime:string;tamanho:number})=>void)|undefined;
 const upload=vi.spyOn(cliente,'anexar').mockImplementation(()=>new Promise(r=>{concluir=r;}));const tela=render(<ChatOperacao cliente={cliente}/>),campo=await abrir();
 fireEvent.change(campo,{target:{value:'Legenda com emoji 💜'}});const form=campo.form!,arquivo=arquivoPDF(),dataTransfer=transferencia([arquivo]);
 fireEvent.dragEnter(form,{dataTransfer});expect(screen.getByText('Solte o arquivo para anexar ao rascunho')).toBeTruthy();
 fireEvent.drop(form,{dataTransfer});expect(await screen.findByText('Anexando arquivo…')).toBeTruthy();
 fireEvent.drop(form,{dataTransfer});expect(upload).toHaveBeenCalledOnce();expect(buscar.mock.calls.some(([u])=>String(u).includes('/mensagens/envio'))).toBe(false);
 concluir!({id:anexoId,nome:arquivo.name,mime:arquivo.type,tamanho:arquivo.size});await screen.findByRole('group',{name:'Arquivo anexado ao rascunho'});
 expect(campo.value).toBe('Legenda com emoji 💜');fireEvent.click(screen.getByRole('button',{name:'Enviar'}));
 await waitFor(()=>expect(buscar.mock.calls.some(([u])=>String(u).endsWith('/mensagens/envio'))).toBe(true));
 const [,opcoes]=buscar.mock.calls.find(([u])=>String(u).endsWith('/mensagens/envio'))!;expect(JSON.parse(String(opcoes?.body))).toMatchObject({conversaId,tipo:'document',anexoId,texto:'Legenda com emoji 💜'});tela.unmount();
});
it('colar imagem prepara uma prévia, preserva texto e libera o blob ao remover',async()=>{
 const OriginalURL=URL,revogar=vi.fn();vi.stubGlobal('URL',class extends OriginalURL{static createObjectURL(){return 'blob:imagem-ficticia';}static revokeObjectURL(v:string){revogar(v);}});
 const {cliente,buscar}=fixture(),imagem=new File(['imagem-ficticia'],'colada.png',{type:'image/png'});const upload=vi.spyOn(cliente,'anexar').mockResolvedValue({id:anexoId,nome:imagem.name,mime:imagem.type,tamanho:imagem.size});
 render(<ChatOperacao cliente={cliente}/>);const campo=await abrir();fireEvent.change(campo,{target:{value:'Texto preservado'}});
 const evento=new Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(evento,'clipboardData',{value:{items:[{kind:'file',getAsFile:()=>imagem}]}});fireEvent(campo,evento);
 expect(evento.defaultPrevented).toBe(true);const previa=await screen.findByRole('img',{name:'Prévia do anexo colada.png'});await waitFor(()=>expect(previa).toHaveProperty('src','blob:imagem-ficticia'));expect(upload).toHaveBeenCalledOnce();expect(campo.value).toBe('Texto preservado');
 expect(buscar.mock.calls.some(([u])=>String(u).endsWith('/mensagens/envio'))).toBe(false);fireEvent.click(screen.getByRole('button',{name:'Remover anexo do rascunho'}));expect(screen.queryByRole('group',{name:'Arquivo anexado ao rascunho'})).toBeNull();expect(revogar).toHaveBeenCalledWith('blob:imagem-ficticia');
});
it('não interfere ao colar somente texto e não troca um anexo escolhido silenciosamente',async()=>{
 const {cliente}=fixture(),upload=vi.spyOn(cliente,'anexar').mockResolvedValue({id:anexoId,nome:'original.pdf',mime:'application/pdf',tamanho:30});render(<ChatOperacao cliente={cliente}/>);const campo=await abrir();
 const evento=new Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(evento,'clipboardData',{value:{items:[{kind:'string'}]}});fireEvent(campo,evento);expect(evento.defaultPrevented).toBe(false);
 fireEvent.drop(campo.form!,{dataTransfer:transferencia([arquivoPDF()])});await screen.findByText('original.pdf');fireEvent.drop(campo.form!,{dataTransfer:transferencia([arquivoPDF()])});expect(await screen.findByRole('alert')).toHaveProperty('textContent',expect.stringContaining('Remova o anexo atual'));expect(upload).toHaveBeenCalledOnce();
});
it('recusa vários arquivos, formato ativo e tamanho excessivo antes de carregar bytes',async()=>{
 const {cliente}=fixture(),upload=vi.spyOn(cliente,'anexar');render(<ChatOperacao cliente={cliente}/>);const campo=await abrir();
 for(const arquivos of [[arquivoPDF(),arquivoPDF()],[new File(['<svg/>'],'ativo.svg',{type:'image/svg+xml'})],[{name:'grande.png',type:'image/png',size:5*1024*1024+1} as File]])fireEvent.drop(campo.form!,{dataTransfer:transferencia(arquivos)});
 expect(upload).not.toHaveBeenCalled();expect(await screen.findByRole('alert')).toHaveProperty('textContent',expect.stringContaining('5 MB'));expect(screen.queryByRole('group',{name:'Arquivo anexado ao rascunho'})).toBeNull();
});
it('a falta de permissão de adicionar mensagens bloqueia também o drop',async()=>{
 const {cliente}=fixture([mensagem],['consultar','atender','mensagens.visualizar']),upload=vi.spyOn(cliente,'anexar');const {container}=render(<ChatOperacao cliente={cliente}/>);fireEvent.click(await screen.findByRole('button',{name:/Cliente fictício/}));await screen.findByText('Enviar mensagens exige a permissão Adicionar em Mensagens no HUB.');
 fireEvent.drop(container.querySelector('form.composer')!,{dataTransfer:transferencia([arquivoPDF()])});expect(upload).not.toHaveBeenCalled();expect(screen.queryByRole('textbox',{name:'Mensagem'})).toBeNull();
});
it('insere emoji na seleção e mantém emojis completos no histórico e no envio',async()=>{
 const {cliente,buscar}=fixture();render(<ChatOperacao cliente={cliente}/>);const campo=await abrir();expect(screen.getByText('Mensagem fictícia 🙂👍🏽')).toBeTruthy();fireEvent.change(campo,{target:{value:'Olá mundo'}});campo.setSelectionRange(4,4);
 fireEvent.click(screen.getByRole('button',{name:/^Emojis$/}));fireEvent.click(await screen.findByRole('button',{name:'Coração roxo 💜'}));expect(campo.value).toBe('Olá 💜mundo');fireEvent.keyDown(campo,{key:'Enter'});
 await waitFor(()=>expect(buscar.mock.calls.some(([u])=>String(u).endsWith('/mensagens/envio'))).toBe(true));expect(JSON.parse(String(buscar.mock.calls.find(([u])=>String(u).endsWith('/mensagens/envio'))![1]?.body))).toMatchObject({texto:'Olá 💜mundo'});
});
it.each(['cliente','humano'] as const)('mostra a citação de uma resposta %s mesmo fora da página carregada',async(autor)=>{
 const registros:MensagemOperacao[]=[{...mensagem,id:respostaId,autor,autorId:autor==='humano'?'ator-ficticio':null,autorNome:autor==='humano'?'Ana Fictícia':null,conteudo:'Resposta com referência',citadaId:originalId,citada:{id:originalId,autor:autor==='cliente'?'humano':'cliente',autorId:'ator-ficticio',autorNome:autor==='cliente'?'Ana Fictícia':null,conteudo:'Mensagem anterior que não está nesta página 💜',tipo:'text'}}];
 const {cliente}=fixture(registros);render(<ChatOperacao cliente={cliente}/>);await abrir();const citacao=screen.getByLabelText('Mensagem respondida');expect(within(citacao).getByText('Mensagem anterior que não está nesta página 💜')).toBeTruthy();expect(within(citacao).getByText(autor==='cliente'?'Ana Fictícia':'Cliente fictício')).toBeTruthy();expect(screen.queryByText('Resposta a uma mensagem citada.')).toBeNull();
});
it('prepara a resposta com o balão original e preserva a referência no envio',async()=>{
 const {cliente,buscar}=fixture();render(<ChatOperacao cliente={cliente}/>);const campo=await abrir();fireEvent.click(screen.getByRole('button',{name:'Responder a esta mensagem'}));
 const citacao=screen.getByLabelText('Mensagem respondida');expect(within(citacao).getByText('Cliente fictício')).toBeTruthy();expect(within(citacao).getByText(mensagem.conteudo!)).toBeTruthy();fireEvent.change(campo,{target:{value:'Resposta com citação'}});fireEvent.keyDown(campo,{key:'Enter'});
 await waitFor(()=>expect(buscar.mock.calls.some(([u])=>String(u).endsWith('/mensagens/envio'))).toBe(true));expect(JSON.parse(String(buscar.mock.calls.find(([u])=>String(u).endsWith('/mensagens/envio'))![1]?.body))).toMatchObject({citadaId:originalId,texto:'Resposta com citação'});
});
it('mostra a lacuna de citação sem inventar conteúdo e não oferece resposta sem referência oficial',async()=>{
 const {cliente}=fixture([{...mensagem,citadaId:respostaId,citadaReferenciaAusente:true,podeResponder:false}]);render(<ChatOperacao cliente={cliente}/>);await abrir();expect(screen.getByText('Mensagem original indisponível no histórico.')).toBeTruthy();expect(screen.queryByRole('button',{name:'Responder a esta mensagem'})).toBeNull();
});

it('anexo de áudio permite ouvir e só usa a fila após Enviar',async()=>{
 const revogar=vi.fn();const OriginalURL=URL;vi.stubGlobal('URL',class extends OriginalURL{static createObjectURL(){return 'blob:audio-ficticio';}static revokeObjectURL(v:string){revogar(v);}});vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});
 const {cliente,buscar}=fixture(),arquivo=new File(['audio-ficticio'],'mensagem.m4a',{type:'audio/mp4'});vi.spyOn(cliente,'anexar').mockResolvedValue({id:anexoId,nome:arquivo.name,mime:arquivo.type,tamanho:arquivo.size});
 render(<ChatOperacao cliente={cliente}/>);await abrir();fireEvent.change(screen.getByLabelText('Arquivo para anexar'),{target:{files:[arquivo]}});
 expect(await screen.findByLabelText('Ouvir áudio antes de enviar')).toHaveProperty('src','blob:audio-ficticio');expect(screen.getByRole('textbox',{name:'Mensagem'})).toHaveProperty('disabled',true);expect(buscar.mock.calls.some(([u])=>String(u).endsWith('/mensagens/envio'))).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'Enviar'}));await waitFor(()=>expect(buscar.mock.calls.some(([u])=>String(u).endsWith('/mensagens/envio'))).toBe(true));const pedido=JSON.parse(String(buscar.mock.calls.find(([u])=>String(u).endsWith('/mensagens/envio'))![1]?.body));expect(pedido).toMatchObject({tipo:'audio',anexoId});expect(pedido).not.toHaveProperty('texto');await waitFor(()=>expect(revogar).toHaveBeenCalledWith('blob:audio-ficticio'));
});
it('recusa misturar áudio e legenda sem apagar o rascunho',async()=>{const {cliente}=fixture(),upload=vi.spyOn(cliente,'anexar');render(<ChatOperacao cliente={cliente}/>);const campo=await abrir();fireEvent.change(campo,{target:{value:'Texto que deve ser preservado'}});fireEvent.change(screen.getByLabelText('Arquivo para anexar'),{target:{files:[new File(['audio'],'mensagem.mp3',{type:'audio/mpeg'})]}});expect(await screen.findByRole('alert')).toHaveProperty('textContent',expect.stringContaining('Áudio não aceita legenda'));expect(upload).not.toHaveBeenCalled();expect(campo.value).toBe('Texto que deve ser preservado');expect(screen.getByRole('button',{name:'Gravar áudio'})).toHaveProperty('disabled',true);});
