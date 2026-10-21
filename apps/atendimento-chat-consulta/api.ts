import { avaliarContinuidade } from '../../src/lib/atendimento/observabilidade';

export type ContatoConsulta = { id:string; name:string|null; last_name:string|null; phone_number:string|null; email:string|null; last_activity:string|null; conversas:number };
export type ConversaConsulta = { id:string; contact_id:string; name:string|null; phone_number:string|null; status:string|null; is_active:boolean; last_message_at:string|null; assigned_team:string|null; responsavel:string|null };
export type MensagemConsulta = { id:string; from_type:string|null; type:string|null; content:string|null; created_at:string|null; sent_at:string|null; status:string|null; autoria:string|null; anexo:{id:string}|null; anexoIndisponivel:boolean };
export type PaginaConsulta<T> = { registros:T[]; pagina:number; mais:boolean };
export type HistoricoConsulta = { registros:MensagemConsulta[]; mais:boolean; cursor:{antes:string;id:string}|null };
export type SincronizacaoConsulta = { atualizadoEm:string|null; materializadoEm:string|null; dadosRecebidosEm:string|null; estado:{ atualizadoEm:string|null; ultimaConsultaOrigem:string|null; ultimaColetaBemSucedida:string|null; falha:string|null; pendenciasObservadas:number|null; pendenciasExatas:boolean; coletorSuspenso:boolean; capturaSuspensa:boolean } };
export class ErroConsulta extends Error { constructor(public readonly codigo:'LOGIN_NECESSARIO'|'INDISPONIVEL'|'CONTRATO_INVALIDO'|'MENSAGEM_EXCEDENTE') { super(codigo); } }
const limiteRespostaConsulta=1024*1024;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const obj=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw new ErroConsulta('CONTRATO_INVALIDO');return v as Record<string,unknown>;};
const texto=(v:unknown,max=8000)=>v===null||v===undefined?null:typeof v==='string'&&v.length<=max?v:(()=>{throw new ErroConsulta('CONTRATO_INVALIDO');})();
const id=(v:unknown)=>{if(typeof v!=='string'||!uuid.test(v))throw new ErroConsulta('CONTRATO_INVALIDO');return v;};
const data=(v:unknown)=>{const d=texto(v,64);if(d&&!Number.isFinite(Date.parse(d)))throw new ErroConsulta('CONTRATO_INVALIDO');return d;};
const numero=(v:unknown)=>{if(!Number.isSafeInteger(v)||Number(v)<0)throw new ErroConsulta('CONTRATO_INVALIDO');return Number(v);};
const bool=(v:unknown)=>{if(typeof v!=='boolean')throw new ErroConsulta('CONTRATO_INVALIDO');return v;};
const linhas=(v:unknown,max:number)=>{if(!Array.isArray(v)||v.length>max)throw new ErroConsulta('CONTRATO_INVALIDO');return v.map(obj);};
export const limparBuscaConsulta=(v:string)=>v.replace(/[\x00-\x1f\x7f]/g,'').slice(0,120);
export const nomeContatoConsulta=(v:{name:string|null;last_name?:string|null})=>[v.name,v.last_name].filter(Boolean).join(' ')||'Contato sem nome registrado';
export const dataConsulta=(d:string|null|undefined)=>d?new Date(d).toLocaleString('pt-BR'):'Não informado';
export const estadoConversaConsulta=(c:ConversaConsulta)=>c.status==='nina'?'Com Nina':c.status==='human'?'Com atendimento humano':c.status||'Estado não informado';

/** Contrato fechado dos GETs já publicados na VPS. Não possui método de escrita,
 * URL arbitrária, credencial de máquina, mídia Cloud ou persistência no navegador. */
export function criarClienteConsulta(buscar:typeof fetch=fetch){
 async function obter(caminho:string,signal?:AbortSignal){
  const controlador=new AbortController(),abortar=()=>controlador.abort();
  if(signal?.aborted)abortar();else signal?.addEventListener('abort',abortar,{once:true});
  const timer=setTimeout(abortar,10000);
  try{
  let r:Response;
  try{r=await buscar(caminho,{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal:controlador.signal});}catch(e){if(signal?.aborted)throw e;throw new ErroConsulta('INDISPONIVEL');}
  if(r.status===401||r.status===403)throw new ErroConsulta('LOGIN_NECESSARIO');
  if(r.status===413&&caminho.startsWith('/api/historico?'))throw new ErroConsulta('MENSAGEM_EXCEDENTE');
  if(!r.ok||!r.headers.get('content-type')?.startsWith('application/json'))throw new ErroConsulta('INDISPONIVEL');
  const leitor=r.body?.getReader();if(!leitor)throw new ErroConsulta('CONTRATO_INVALIDO');
  let bytes=0;const partes:Uint8Array[]=[];
  try{for(;;){const p=await leitor.read();if(p.done)break;bytes+=p.value.byteLength;if(bytes>limiteRespostaConsulta){await leitor.cancel();throw new ErroConsulta('CONTRATO_INVALIDO');}partes.push(p.value);}}finally{leitor.releaseLock();}
  try{const corpo=new Uint8Array(bytes);let offset=0;for(const p of partes){corpo.set(p,offset);offset+=p.byteLength;}return obj(JSON.parse(new TextDecoder().decode(corpo)));}catch{throw new ErroConsulta('CONTRATO_INVALIDO');}
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abortar);}
 }
 function filtro(q:string,pagina:number){if(q!==limparBuscaConsulta(q)||!Number.isSafeInteger(pagina)||pagina<0||pagina>10000)throw new ErroConsulta('CONTRATO_INVALIDO');return `q=${encodeURIComponent(q)}&pagina=${pagina}`;}
 return {
  async sessao(signal?:AbortSignal){const d=await obter('/api/sessao',signal);if(d.somenteLeitura!==true)throw new ErroConsulta('CONTRATO_INVALIDO');return {nome:texto(d.nome,200)||'Conta da homologação',somenteLeitura:true as const};},
  async contatos(q:string,pagina:number,signal?:AbortSignal):Promise<PaginaConsulta<ContatoConsulta>>{const d=await obter('/api/contatos?'+filtro(q,pagina),signal);const p=numero(d.pagina);if(p!==pagina)throw new ErroConsulta('CONTRATO_INVALIDO');return {pagina:p,mais:bool(d.mais),registros:linhas(d.registros,30).map(v=>({id:id(v.id),name:texto(v.name,500),last_name:texto(v.last_name,500),phone_number:texto(v.phone_number,100),email:texto(v.email,254),last_activity:data(v.last_activity),conversas:numero(v.conversas)}))};},
  async conversas(q:string,pagina:number,signal?:AbortSignal):Promise<PaginaConsulta<ConversaConsulta>>{const d=await obter('/api/conversas?'+filtro(q,pagina),signal);const p=numero(d.pagina);if(p!==pagina)throw new ErroConsulta('CONTRATO_INVALIDO');return {pagina:p,mais:bool(d.mais),registros:linhas(d.registros,30).map(v=>({id:id(v.id),contact_id:id(v.contact_id),name:texto(v.name,500),phone_number:texto(v.phone_number,100),status:texto(v.status,100),is_active:bool(v.is_active),last_message_at:data(v.last_message_at),assigned_team:texto(v.assigned_team,200),responsavel:texto(v.responsavel,500)}))};},
  async historico(conversa:string,cursor:HistoricoConsulta['cursor']=null,signal?:AbortSignal):Promise<HistoricoConsulta>{id(conversa);if(cursor){id(cursor.id);if(!data(cursor.antes))throw new ErroConsulta('CONTRATO_INVALIDO');}const d=await obter('/api/historico?conversa='+conversa+(cursor?'&antes='+encodeURIComponent(cursor.antes)+'&id='+cursor.id:''),signal);let proximo:HistoricoConsulta['cursor']=null;if(d.cursor!==null){const c=obj(d.cursor);proximo={antes:data(c.antes)||'',id:id(c.id)};if(!proximo.antes)throw new ErroConsulta('CONTRATO_INVALIDO');}const mais=bool(d.mais);if(mais&&!proximo)throw new ErroConsulta('CONTRATO_INVALIDO');return {mais,cursor:proximo,registros:linhas(d.registros,50).map(v=>({id:id(v.id),from_type:texto(v.from_type,100),type:texto(v.type,100),content:texto(v.content,limiteRespostaConsulta),created_at:data(v.created_at),sent_at:data(v.sent_at),status:texto(v.status,100),autoria:texto(v.autoria,500),anexo:v.anexo?{id:id(obj(v.anexo).id)}:null,anexoIndisponivel:bool(v.anexoIndisponivel)}))};},
  anexo(objetoId:string){return '/api/anexo/'+id(objetoId);},
  async sincronizacao(signal?:AbortSignal):Promise<SincronizacaoConsulta>{const d=await obter('/api/sincronizacao',signal),e=d.estado===undefined?{}:obj(d.estado);return {atualizadoEm:data(d.atualizado_em),materializadoEm:data(d.materializadoEm),dadosRecebidosEm:data(d.dadosRecebidosEm),estado:{atualizadoEm:data(e.atualizadoEm),ultimaConsultaOrigem:data(e.ultimaConsultaOrigem),ultimaColetaBemSucedida:data(e.ultimaColetaBemSucedida),falha:texto(e.falha,100),pendenciasObservadas:e.pendenciasObservadas===undefined||e.pendenciasObservadas===null?null:numero(e.pendenciasObservadas),pendenciasExatas:e.pendenciasExatas===true,coletorSuspenso:e.coletorSuspenso===true,capturaSuspensa:e.capturaSuspensa===true}};},
 };
}
export type ClienteConsulta=ReturnType<typeof criarClienteConsulta>;
export function apresentarSincronizacaoConsulta(s:SincronizacaoConsulta|null,agora:number,indisponivel=false){
 if(!s)return {nivel:'atencao',titulo:'Sincronização ainda não conferida',fila:'Pendências atuais desconhecidas.',atraso:null,telemetriaAtual:false};
 const a=avaliarContinuidade(s.estado,agora),registro=s.atualizadoEm?Date.parse(s.atualizadoEm):null;
 const telemetriaAtual=!indisponivel&&registro!==null&&registro<=agora&&agora-registro<=120000;
 const titulo=s.estado.coletorSuspenso?'Coletor suspenso':s.estado.capturaSuspensa?'Captura suspensa':indisponivel?'Conferência da sincronização indisponível':!telemetriaAtual?'Supervisão sem atualização recente':s.estado.falha?'Sincronização interrompida':a.coletaSaudavel?'Coleta concluída recentemente':'Coleta sem sucesso recente';
 const leituraAtual=a.fila.atual&&telemetriaAtual&&!s.estado.coletorSuspenso&&!s.estado.capturaSuspensa;
 const fila=a.fila.quantidade===null?'Pendências atuais desconhecidas.':leituraAtual?`${a.fila.exataAgora?'':'Pelo menos '}${a.fila.quantidade} pendências observadas em ${dataConsulta(a.fila.observadaEm)}.`:`Última observação: ${a.fila.quantidade} pendências${a.fila.exataNaLeitura?'':' ou mais'} em ${dataConsulta(a.fila.observadaEm)}. Pendências atuais desconhecidas.`;
 return {nivel:telemetriaAtual&&a.coletaSaudavel&&!s.estado.coletorSuspenso&&!s.estado.capturaSuspensa?'informacao':'atencao',titulo,fila,atraso:a.atrasoColetaSegundos,telemetriaAtual};
}
