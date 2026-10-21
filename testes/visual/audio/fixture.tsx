import React from 'react';
import {createRoot} from 'react-dom/client';
import ChatOperacao from '../../../apps/atendimento-chat-consulta/ChatOperacao';
import {criarClienteOperacao} from '../../../apps/atendimento-chat-consulta/operacao-api';
import {LISTA_CAPACIDADES_ATENDIMENTO} from '../../../src/lib/permissoes/atendimento';
import {aplicarIdentidadePreview} from '../../../apps/atendimento/preview/identidade';
import '../../../apps/atendimento/preview/preview.css';
import '../../../apps/atendimento-chat-consulta/consulta.css';
import '../../../apps/atendimento-chat-consulta/operacao.css';
// Somente dados fictícios. Nenhum endpoint externo ou banco é acessado.
aplicarIdentidadePreview(document.documentElement);
if(new URLSearchParams(location.search).get('tema')==='dark')document.documentElement.classList.add('dark');
let avisar:(novaMensagem?:boolean)=>void=()=>{};
const em='2026-10-13T15:00:00.000Z',id='11111111-1111-4111-8111-111111111111';
const conversa={id,contatoId:id,nome:'Pessoa fictícia da Empresa de Demonstração',descricao:'Cargo e empresa fictícios',telefone:'000-000',canal:'whatsapp',estado:'humano',responsavelId:null,equipeId:null,tags:[],versao:1,ultimaMensagemEm:em,ficticia:true,somenteLeitura:false,janelaRespostaAberta:true,pendentesResposta:1,naoLidas:1};
const modelo={id:'1111111111',nome:'retomar_atendimento_ficticio_com_nome_longo_para_conferencia',idioma:'pt_BR',estado:'APPROVED',suportado:true,variaveis:[],componentes:[{type:'BODY',text:'Olá, podemos retomar o atendimento?'}],versao:1};
const cliente=criarClienteOperacao(async entrada=>{
 const p=new URL(String(entrada),'https://ficticio.invalid').pathname.replace('/api/atendimento/operacao','');
 const resposta=p==='/sessao'?{usuario:{id:'equipe-som-ficticia',nome:'Equipe fictícia',perfilId:'fixture',permissoes:LISTA_CAPACIDADES_ATENDIMENTO},csrf:'fixture',modo:'homologacao',escritasReais:false}:p==='/conversas'?{registros:[conversa],mais:false,pagina:0,contagens:{total:1,ia:0,humano:1,pausado:0,encerrada:0},contagensConferidasEm:em}:p==='/modelos'?{registros:[modelo]}:p==='/equipe'?{usuarios:[],equipes:[]}:p==='/status'?{modo:'homologacao',enviosReais:false,receptor:'desarmado',fila:{pendentes:0,incertos:0,falhas:0},backup:{ultimoSucessoEm:null,falha:null},agente:{modo:'desligado',modelo:'fixture',disponivel:false},atualizadoEm:em,importadoEm:null}:p==='/historico'?{conversa,registros:[],notas:[],proxima:null}:p==='/rascunho'?{texto:'',versao:1}:p==='/mensagens/envio'?{id:'22222222-2222-4222-8222-222222222222',estado:'aceito_simulado'}:{gravada:true};
 return new Response(JSON.stringify(resposta),{status:200,headers:{'content-type':'application/json'}});
});
cliente.observarChat=(f,conexao)=>{avisar=f;conexao(true);return()=>{};};
cliente.anexar=async(_conversaId,arquivo)=>({id:'33333333-3333-4333-8333-333333333333',nome:arquivo.name,mime:arquivo.type,tamanho:arquivo.size});
createRoot(document.getElementById('root')!).render(<ChatOperacao cliente={cliente}/>);
