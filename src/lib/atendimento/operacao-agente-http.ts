import 'server-only';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ServicoDuvidas } from './duvidas-aprendizagem';
import type { IdentidadeOperacao } from './operacao-tipos';
import type { ServicoAgenteOperacional } from './operacao-agente';
import type { ConfiguracaoAgente,ConfiguracaoSkillsAgente,TomAgente } from './repositorio-agente-pg';
import type {ConfiguracaoFollowup} from './operacao-followup';
import type {PedidoReconciliacaoAgente} from './operacao-agente-painel';
const prefixo='/api/atendimento/operacao';
function enviar(res:ServerResponse,valor:unknown,head=false){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(head?undefined:JSON.stringify(valor));}
function campos(p:Record<string,unknown>|undefined,aceitos:string[]) {if(!p||Object.keys(p).some(k=>!aceitos.includes(k)))throw Error('OPERACAO_ENTRADA_INVALIDA');return p;}
/** Extensão chamada somente depois de sessão HUB, permissão, origem e CSRF do
 * handler operacional. A identidade nunca vem do JSON enviado pelo navegador. */
export function criarExtensaoAgenteOperacional(agente:ServicoAgenteOperacional,empresaId:string) {
 return async(req:IncomingMessage,res:ServerResponse,i:IdentidadeOperacao,p?:Record<string,unknown>)=>{
  const path=new URL(req.url??'/', 'https://atendimento.grazinghub.com.br').pathname.slice(prefixo.length),metodo=req.method??'GET',somente=['GET','HEAD'].includes(metodo);
  if(!['/agente','/agente/configurar','/agente/controle','/agente/reconciliar','/agente/testar','/agente/opcoes','/agente/skills','/agente/skills/configurar','/agente/tom','/agente/tom/configurar','/agente/followup','/agente/followup/configurar','/duvidas','/duvidas/responder','/duvidas/assumir','/duvidas/preparar','/duvidas/enfileirar','/duvidas/encerrar','/conhecimento','/conhecimento/sugerir','/conhecimento/revisar','/conhecimento/revogar','/conhecimento/substituir'].includes(path))return false;
  const core=agente.duvidas(i),ator={id:i.id,empresaId,versaoSessao:i.sessaoVersao};let resultado:unknown;
  if(path==='/agente'&&somente)resultado=await agente.estado(i);
  else if(path==='/agente/controle'&&metodo==='POST'){const dados=campos(p,['acao','versao','idempotencia']);resultado=await agente.controlar(i,dados as {acao:'ligar'|'pausar';versao:number;idempotencia:string});}
  else if(path==='/agente/reconciliar'&&metodo==='POST'){const dados=campos(p,['tipo','pedido']);resultado=await agente.reconciliar(i,dados as PedidoReconciliacaoAgente);}
  else if(path==='/agente/testar'&&metodo==='POST'){const dados=campos(p,['pergunta','versao','idempotencia']);resultado=await agente.testar(i,dados as {pergunta:string;versao:number;idempotencia:string});}
  else if(path==='/agente/opcoes'&&somente)resultado=await agente.opcoes(i);
  else if(path==='/agente/skills'&&somente)resultado=await agente.skills(i);
  else if(path==='/agente/tom'&&somente)resultado=await agente.tom(i);
  else if(path==='/agente/skills/configurar'&&metodo==='POST'){const dados=campos(p,['conteudo','versao','idempotencia']);resultado=await agente.configurarSkills(i,dados as {conteudo:ConfiguracaoSkillsAgente;versao:number;idempotencia:string});}
  else if(path==='/agente/tom/configurar'&&metodo==='POST'){const dados=campos(p,['conteudo','versao','idempotencia']);resultado=await agente.configurarTom(i,dados as {conteudo:TomAgente;versao:number;idempotencia:string});}
  else if(path==='/agente/followup'&&somente)resultado=await agente.followup(i);
  else if(path==='/agente/followup/configurar'&&metodo==='POST'){const dados=campos(p,['conteudo','versao','idempotencia']);resultado=await agente.configurarFollowup(i,dados as {conteudo:ConfiguracaoFollowup;versao:number;idempotencia:string});}
  else if(path==='/agente/configurar'&&metodo==='POST') {const dados=campos(p,['conteudo','versao','idempotencia']);resultado=await agente.configurar(i,dados as {conteudo:ConfiguracaoAgente;versao:number;idempotencia:string});}
  else if(path==='/duvidas'&&somente)resultado={casos:await core.listarCasos(ator)};
  else if(path==='/conhecimento'&&somente)resultado={candidatos:await core.listarConhecimentos(ator)};
  else if(path==='/duvidas/responder'&&metodo==='POST')resultado=await core.responder(ator,campos(p,['casoId','revisao','mensagemId','texto']) as Parameters<ServicoDuvidas['responder']>[1]);
  else if(path==='/duvidas/assumir'&&metodo==='POST') {const v=campos(p,['casoId','revisao']);resultado=await core.assumir(ator,v.casoId as string,v.revisao as number);}
  else if(path==='/duvidas/preparar'&&metodo==='POST')resultado=await core.prepararResposta(ator,campos(p,['casoId','revisao','textoCliente','revisaoHumana']) as Parameters<ServicoDuvidas['prepararResposta']>[1]);
  else if(path==='/duvidas/enfileirar'&&metodo==='POST')resultado=await core.enfileirarResposta(ator,campos(p,['casoId','revisao']) as Parameters<ServicoDuvidas['enfileirarResposta']>[1]);
  else if(path==='/duvidas/encerrar'&&metodo==='POST') {const v=campos(p,['casoId','revisao']);resultado=await core.encerrar(ator,v.casoId as string,v.revisao as number);}
  else if(path==='/conhecimento/sugerir'&&metodo==='POST')resultado=await core.sugerirConhecimento(ator,campos(p,['casoId','pergunta','resposta','categoria','escopo','clienteId','condicoes','vigenteDe','vigenteAte','conflitos','responsavelId']) as Parameters<ServicoDuvidas['sugerirConhecimento']>[1]);
  else if(path==='/conhecimento/revisar'&&metodo==='POST')resultado=await core.revisarConhecimento(ator,campos(p,['id','revisao','decisao','motivo','minimizacaoRevisada','conflitosResolvidos']) as Parameters<ServicoDuvidas['revisarConhecimento']>[1]);
  else if(path==='/conhecimento/revogar'&&metodo==='POST')resultado=await core.revogarConhecimento(ator,campos(p,['id','revisao','motivo']) as Parameters<ServicoDuvidas['revogarConhecimento']>[1]);
  else if(path==='/conhecimento/substituir'&&metodo==='POST')resultado=await core.substituirConhecimento(ator,campos(p,['id','revisao','resposta','motivo','vigenteAte']) as Parameters<ServicoDuvidas['substituirConhecimento']>[1]);
  else {res.writeHead(405,{'Content-Type':'application/json'});res.end(JSON.stringify({erro:'METODO_RECUSADO'}));return true;}
  enviar(res,resultado,metodo==='HEAD');return true;
 };
}
