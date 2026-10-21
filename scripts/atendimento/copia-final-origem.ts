import {ALVOS,conferirEstado,estadoInicial,type EstadoSincronizacao} from './sincronizacao';
import {validarObservacaoManutencao,type ObservacaoManutencao} from './manutencao-origem';

export type EstadoCopiaFinal={versao:1;tipo:'copia-final-origem-v2';execucao:string;t0:string;iniciadaEm:string;atualizadaEm:string;fase:'copia'|'preservada'|'materializada';snapshot:EstadoSincronizacao;documentos:Record<string,string[]>;lacunas:{alvo:string;codigo:string}[];materializadaEm:string|null};
type Pagina={documento:string;registros:number;fim:boolean;lacunas?:{codigo:string}[]};
type Portas={pagina:(alvo:string,anterior:string|null)=>Promise<Pagina>;preservarEstado:(e:EstadoCopiaFinal)=>Promise<void>;materializar:(e:EstadoCopiaFinal)=>Promise<void>;agora?:()=>Date;conferirAutorizacao?:()=>Promise<void>};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export function novoEstadoCopiaFinal(execucao:string,origem:ObservacaoManutencao,agora=new Date()):EstadoCopiaFinal{
 validarObservacaoManutencao(origem);if(!uuid.test(execucao)||execucao===origem.execucao)throw Error('COPIA_FINAL_EXECUCAO_NOVA_EXIGIDA');
 const em=agora.toISOString();return {versao:1,tipo:'copia-final-origem-v2',execucao,t0:origem.t0,iniciadaEm:em,atualizadaEm:em,fase:'copia',snapshot:estadoInicial(execucao),documentos:Object.fromEntries(ALVOS.map(a=>[a,[]])),lacunas:[],materializadaEm:null};
}
export function conferirCopiaFinal(e:EstadoCopiaFinal,origem:ObservacaoManutencao){
 validarObservacaoManutencao(origem);
 if(e?.versao!==1||e.tipo!=='copia-final-origem-v2'||e.t0!==origem.t0||!uuid.test(e.execucao)||e.execucao===origem.execucao||!['copia','preservada','materializada'].includes(e.fase)||!Number.isFinite(Date.parse(e.iniciadaEm))||Date.parse(e.iniciadaEm)<Date.parse(e.t0)||!Number.isFinite(Date.parse(e.atualizadaEm))||!e.documentos||Object.keys(e.documentos).length!==37||!Array.isArray(e.lacunas)||e.lacunas.some(l=>!ALVOS.includes(l.alvo as typeof ALVOS[number])||! /^[A-Z0-9_]{3,80}$/.test(l.codigo)))throw Error('COPIA_FINAL_ESTADO_RECUSADO');
 conferirEstado(e.snapshot,e.execucao);
 const ids=new Set<string>();
 for(const a of ALVOS){const docs=e.documentos[a];if(!Array.isArray(docs)||docs.length!==e.snapshot.tabelas[a].paginas||docs.some(d=>!uuid.test(d)||ids.has(d)||!ids.add(d))||docs.at(-1)!==(e.snapshot.tabelas[a].documento??undefined))throw Error('COPIA_FINAL_DOCUMENTOS_DIVERGENTES');}
 if(e.fase!=='copia'&&!ALVOS.every(a=>e.snapshot.tabelas[a].fim))throw Error('COPIA_FINAL_INCOMPLETA');
 if(e.fase==='materializada'&&(!e.materializadaEm||!Number.isFinite(Date.parse(e.materializadaEm))))throw Error('COPIA_FINAL_MARCO_DIVERGENTE');
}

/** Uma leitura paginada da origem congelada. Nunca chama ler_lote/confirmar,
 * não exige reativar CDC e não inicia workers históricos. Cada página volta
 * somente após cifragem local + releitura R2. A retomada reaplica o mesmo estado.
 */
export async function copiarOrigemCongelada(e:EstadoCopiaFinal,origem:ObservacaoManutencao,maxPaginas:number,p:Portas){
 conferirCopiaFinal(e,origem);if(!Number.isSafeInteger(maxPaginas)||maxPaginas<1||maxPaginas>500)throw Error('COPIA_FINAL_LIMITE_RECUSADO');
 const agora=p.agora??(()=>new Date());let paginas=0;
 if(e.fase==='copia')for(const alvo of ALVOS){
  while(!e.snapshot.tabelas[alvo].fim&&paginas<maxPaginas){
   await p.conferirAutorizacao?.();
   const anterior=e.snapshot.tabelas[alvo],r=await p.pagina(alvo,anterior.documento);
   if(!uuid.test(r.documento)||Object.values(e.documentos).some(ds=>ds.includes(r.documento))||!Number.isInteger(r.registros)||r.registros<0||r.registros>500||typeof r.fim!=='boolean'||(!r.fim&&r.registros===0)||r.lacunas?.some(l=>! /^[A-Z0-9_]{3,80}$/.test(l.codigo)))throw Error('COPIA_FINAL_PAGINA_RECUSADA');
   // Conserva IDs dos documentos, sem cursors, telefones, chaves de clientes ou SQL.
   e.snapshot.tabelas[alvo]={documento:r.documento,paginas:anterior.paginas+1,registros:anterior.registros+r.registros,fim:r.fim};
   e.documentos[alvo].push(r.documento);for(const l of r.lacunas??[])e.lacunas.push({alvo,codigo:l.codigo});
   e.atualizadaEm=agora().toISOString();await p.preservarEstado(e);paginas++;
  }
  if(paginas>=maxPaginas)break;
 }
 if(e.fase==='copia'&&ALVOS.every(a=>e.snapshot.tabelas[a].fim)){e.fase='preservada';e.atualizadaEm=agora().toISOString();await p.preservarEstado(e);}
 if(e.fase==='preservada'){
  await p.conferirAutorizacao?.();
  await p.materializar(e); // A transação de todas as páginas/FKs pertence ao adaptador.
  e.fase='materializada';e.materializadaEm=agora().toISOString();e.atualizadaEm=e.materializadaEm;await p.preservarEstado(e);
 }
 return {versao:1,idCopiaFinal:e.execucao,t0:e.t0,iniciadaEm:e.iniciadaEm,materializadaEm:e.materializadaEm,duracaoMs:e.materializadaEm?Date.parse(e.materializadaEm)-Date.parse(e.iniciadaEm):null,fase:e.fase,paginasNestaRodada:paginas,tabelasConcluidas:ALVOS.filter(a=>e.snapshot.tabelas[a].fim).length,registros:Object.values(e.snapshot.tabelas).reduce((n,t)=>n+t.registros,0),documentos:Object.values(e.documentos).reduce((n,ds)=>n+ds.length,0),lacunas:e.lacunas,capturaReinstalada:false,ackOrigemExecutado:false,emissoresSuspensos:false,congelamentoPosteriorConferido:false,importacaoOperacionalExecutada:false,origemAusenteHistoricoPreservado:true};
}

export function conferirJanelaCopiaFinal(inicio:string,fim:string,agora=Date.now()){
 const de=Date.parse(inicio),ate=Date.parse(fim);
 if(!Number.isFinite(de)||!Number.isFinite(ate)||ate<=de||ate-de>8*60*60*1000||agora<de||agora>ate)throw Error('COPIA_FINAL_JANELA_RECUSADA');
}

/** O limite continua sendo por rodada. Uma execução manual autorizada pode
 * continuar a próxima rodada usando o mesmo checkpoint, sem reler páginas
 * preservadas, trocar o ID ou liberar o lock entre as rodadas. Falhas de I/O
 * interrompem a execução; não são convertidas em repetição automática.
 */
export async function copiarOrigemCongeladaAteConcluir(e:EstadoCopiaFinal,origem:ObservacaoManutencao,maxPaginas:number,p:Portas&{conferirAutorizacao:()=>Promise<void>}){
 let rodadas=0,paginasNestaExecucao=0;
 for(;;){
  await p.conferirAutorizacao();
  const resumo=await copiarOrigemCongelada(e,origem,maxPaginas,p);
  rodadas++;paginasNestaExecucao+=resumo.paginasNestaRodada;
  if(resumo.fase==='materializada')return {...resumo,rodadas,paginasNestaExecucao};
  if(resumo.paginasNestaRodada===0)throw Error('COPIA_FINAL_SEM_PROGRESSO');
 }
}
