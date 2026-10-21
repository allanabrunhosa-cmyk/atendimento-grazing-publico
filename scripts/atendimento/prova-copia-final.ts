import {createHash} from 'node:crypto';
import {ALVOS} from './sincronizacao';
import {conferirCopiaFinal,type EstadoCopiaFinal} from './copia-final-origem';
import {validarObservacaoManutencao,type ObservacaoManutencao} from './manutencao-origem';
import {versoesSnapshotFinal,type MapaMidiaFinal} from './midia-copia-final';
import type {DocumentoCarga} from '../../src/lib/atendimento/carga';
import {hashImportacaoOperacao,mapearLinhaImportacaoOperacao} from './importar-operacao';

export type ReferenciaEstadoFinal={versao:1;prefixo:string;chave:string;contexto:string;sha256:string;bytes:number};
export type RelatorioFinal={versao:1;idCopiaFinal:string;t0:string;fase:string;materializadaEm:string;tabelasConcluidas:number;documentos:number;registros:number;lacunas:unknown[];comparacaoConteudoTipado:boolean;estadoFinalR2?:ReferenciaEstadoFinal;midiaFinalR2:{id:string;prefixo:string;chave:string;sha256:string;referencias:number;conteudos:number}};
export type EntidadeConferida={alvo:string;registros:number;paginas:number;hashConteudo:string};
export type ReciboImportacaoFinal={versao:1;idCopiaFinal:string;t0:string;estado:string;fase:string;exitCode:number;runtimeSha256:string;fim:string;marcoFinal:{t0:string;idCopiaFinal:string;origemSha256:string;configCopiaSha256:string;relatorioSha256:string};resultado:{idImportacao?:string;enviosExternos:number;entidades:Record<string,{observados:number;verificados:number;divergentes:number;lacunas:number;hashConteudo:string;hashDestino:string}>;arquivos:{referencias:number;conteudosVerificados:number;bytesVerificados:number;indisponiveis:number};lacunas:Record<string,number>}};
export type PaginaConferida={alvo:string;paginaId:string;paginaSha256:string};
type FonteRegistro={paginaId:string;paginaSha256:string;registroSha256:string};
type ProvenienciaDestino={importacaoId:string;hashOrigem:string;hashDestino:string};
export type MensagemDestino={dados:Record<string,unknown>;origemId:string;destinoId:string;importacaoId:string;hashOrigem:string;hashDestino:string};
type LimiteBase={codigo:string;entidade:'mensagem'|'anexo';mensagemId:string;conversaId:string;fonteMensagem:FonteRegistro;destinoMensagem:ProvenienciaDestino};
export type LimitacaoHistorica=(LimiteBase&({tipo:'citacao_entre_conversas';citadaId:string;conversaCitadaId:string;fonteCitada:FonteRegistro;destinoCitada:ProvenienciaDestino;citadaIdDestino:null}|{tipo:'arquivo_vazio_preservado';objetoId:string;fonteObjeto:FonteRegistro;bytes:0;sha256:string;anexoIdDestino:null}))&{evidenciaSha256:string};
export type EnsaioReceptor={versao:1;tipo:'ensaio-receptor-isolado-v1';runtimeSha256:string;concluidoEm:string;banco:'donatella_ensaio_operacao';bancoEntrada:'donatella_ensaio_entrada';resultados:{assinaturaInvalidaRecusada:boolean;persistidoAntesAck:boolean;repeticaoIdempotente:boolean;retomadaAposReinicio:boolean;enviosExternos:number}};
const hash=(b:string|Buffer)=>createHash('sha256').update(b).digest('hex');
const SHA=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
function exigir(ok:unknown,codigo:string):asserts ok{if(!ok)throw Error('PRONTIDAO_FINAL_'+codigo);}
function instante(s:string){const d=Date.parse(s);exigir(typeof s==='string'&&/Z$|[+-]\d\d:\d\d$/.test(s)&&Number.isFinite(d),'INSTANTE_RECUSADO');return d;}
function natural(n:number){return Number.isSafeInteger(n)&&n>=0;}
// abrirCarga conserva números como JSON.rawJSON; a evidência da linha usa
// o lexema numérico original, jamais o objeto interno que o representa.
function serializarRegistroT0(v:unknown):string{
 const j=JSON as unknown as {isRawJSON?:(v:unknown)=>boolean};
 if(j.isRawJSON?.(v))return JSON.stringify(v);
 if(Array.isArray(v))return '['+v.map(serializarRegistroT0).join(',')+']';
 if(v!==null&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+serializarRegistroT0((v as Record<string,unknown>)[k])).join(',')+'}';
 return JSON.stringify(v)??'null';
}

export function conferirRecibosFinais({estado,origem,posterior,relatorio,importacao,ensaio,runtimeSha256,vinculos,agora}:{estado:EstadoCopiaFinal;origem:ObservacaoManutencao;posterior:ObservacaoManutencao;relatorio:RelatorioFinal;importacao:ReciboImportacaoFinal;ensaio:EnsaioReceptor;runtimeSha256:string;vinculos:{origemSha256:string;configCopiaSha256:string;relatorioSha256:string;importacaoOperacionalSha256:string};agora:string}){
 conferirCopiaFinal(estado,origem);validarObservacaoManutencao(posterior);
 exigir(SHA.test(runtimeSha256)&&Object.values(vinculos).every(v=>SHA.test(v)),'VINCULO_RECUSADO');
 exigir(estado.fase==='materializada'&&relatorio.versao===1&&relatorio.idCopiaFinal===estado.execucao&&relatorio.t0===estado.t0&&relatorio.fase==='materializada'&&relatorio.tabelasConcluidas===37&&relatorio.materializadaEm===estado.materializadaEm&&relatorio.comparacaoConteudoTipado===true,'COPIA_NAO_MATERIALIZADA');
 exigir(Array.isArray(estado.lacunas)&&estado.lacunas.length===0&&Array.isArray(relatorio.lacunas)&&relatorio.lacunas.length===0,'LACUNAS_T0_PENDENTES');
 exigir(posterior.execucao===origem.execucao&&posterior.t0===origem.t0&&instante(posterior.verificadaEm)>=instante(relatorio.materializadaEm)&&instante(posterior.verificadaEm)<=instante(agora),'ORIGEM_POSTERIOR_DIVERGENTE');
 exigir(importacao.versao===1&&importacao.idCopiaFinal===estado.execucao&&importacao.t0===estado.t0&&importacao.estado==='concluida'&&importacao.fase==='concluida'&&importacao.exitCode===0&&importacao.runtimeSha256===runtimeSha256&&instante(importacao.fim)>=instante(relatorio.materializadaEm)&&instante(importacao.fim)<=instante(agora),'IMPORTACAO_NAO_CONCLUIDA');
 const marco=importacao.marcoFinal;
 exigir(marco?.idCopiaFinal===estado.execucao&&marco.t0===estado.t0&&marco.origemSha256===vinculos.origemSha256&&marco.configCopiaSha256===vinculos.configCopiaSha256&&marco.relatorioSha256===vinculos.relatorioSha256,'IMPORTACAO_MARCO_DIVERGENTE');
 const r=importacao.resultado;
 exigir(r&&r.enviosExternos===0&&r.entidades&&['contato','conversa','mensagem','etapa','negocio','compromisso'].every(n=>Object.hasOwn(r.entidades,n))&&Object.keys(r.entidades).length<=7,'IMPORTACAO_COBERTURA_AUSENTE');
 const limites=contagensLimitacoes(r);
 for(const [nome,v]of Object.entries(r.entidades)){
  // Anexo é derivado da mensagem + CAS; o importador não emite hashConteudo
  // agregado de origem para essa entidade. Exigimos o hash tipado do destino,
  // contagens reconciliadas e a prova CAS/bytes abaixo, além da releitura R2.
  exigir(natural(v.observados)&&natural(v.verificados)&&v.observados===v.verificados&&v.divergentes===0&&v.lacunas===(nome==='mensagem'?limites.citacoes:nome==='anexo'?limites.vazios:0)&&(v.observados===0||SHA.test(v.hashDestino)&&(nome==='anexo'?v.hashConteudo===''||SHA.test(v.hashConteudo):SHA.test(v.hashConteudo))),'IMPORTACAO_CONTEUDO_OU_LACUNAS');
 }
 const a=r.arquivos,anexos=r.entidades.anexo?.observados??0;
 exigir(a&&natural(a.referencias)&&natural(a.conteudosVerificados)&&natural(a.bytesVerificados)&&a.indisponiveis===limites.vazios&&a.referencias===anexos+limites.vazios&&(anexos===0?a.conteudosVerificados===0&&a.bytesVerificados===0:a.conteudosVerificados>0&&a.conteudosVerificados<=anexos&&a.bytesVerificados>0),'IMPORTACAO_ARQUIVOS_OU_LACUNAS');
 exigir(ensaio?.versao===1&&ensaio.tipo==='ensaio-receptor-isolado-v1'&&ensaio.runtimeSha256===runtimeSha256&&ensaio.banco==='donatella_ensaio_operacao'&&ensaio.bancoEntrada==='donatella_ensaio_entrada'&&instante(ensaio.concluidoEm)<=instante(agora),'ENSAIO_RECEPTOR_AUSENTE');
 exigir(ensaio.resultados?.assinaturaInvalidaRecusada===true&&ensaio.resultados.persistidoAntesAck===true&&ensaio.resultados.repeticaoIdempotente===true&&ensaio.resultados.retomadaAposReinicio===true&&ensaio.resultados.enviosExternos===0,'ENSAIO_RECEPTOR_INCOMPLETO');
 const m=relatorio.midiaFinalR2;
 exigir(m?.id===estado.execucao&&m.prefixo==='donatella-v2/arquivos'&&m.chave===`manifestos/${estado.execucao}.bin.enc`&&SHA.test(m.sha256)&&natural(m.referencias)&&natural(m.conteudos),'MIDIA_R2_AUSENTE');
}

/** A prova é derivada de GET + decifragem de cada página e de comparação
 * tipada no banco. Contagem ou booleanos recebidos não substituem o conteúdo.
 * Nenhuma escrita de negócio, chamada de origem ou envio é feita aqui.
 */
export async function conferirConteudoFinal({estado,relatorio,abrirPagina,compararPagina,recuperarMidia,conferirAutorizacao}:{estado:EstadoCopiaFinal;relatorio:RelatorioFinal;abrirPagina:(id:string)=>Promise<{documento:DocumentoCarga;hash:string}>;compararPagina:(d:Extract<DocumentoCarga,{tipo:'snapshot'}>)=>Promise<number>;recuperarMidia:(receber:(nome:string,b:Buffer)=>Promise<void>)=>Promise<{proveniencia:string}>;conferirAutorizacao:()=>Promise<void>}){
 const entidades:EntidadeConferida[]=[],paginasConferidas:PaginaConferida[]=[],versoes=new Map<string,ReturnType<typeof versoesSnapshotFinal>[number]>();let paginas=0,registros=0;
 for(const alvo of ALVOS){
  const h=createHash('sha256'),chaves=new Set<string>();let quantidade=0;
  const ids=estado.documentos[alvo];exigir(Array.isArray(ids)&&ids.length===estado.snapshot.tabelas[alvo].paginas,'PAGINAS_DIVERGENTES');
  for(const [i,id]of ids.entries()){
   await conferirAutorizacao();const a=await abrirPagina(id),d=a.documento;
   // O RPC mantém a última chave também na página final (e apos na vazia).
   exigir(SHA.test(a.hash)&&d.tipo==='snapshot'&&d.id===id&&d.execucao===estado.execucao&&`${d.schema}.${d.tabela}`===alvo&&d.fim===(i===ids.length-1)&&(d.fim||!!d.proxima),'PAGINA_DIVERGENTE');
   for(const r of d.registros){const chave=JSON.stringify(Object.entries(r.chave).sort(([a],[b])=>a.localeCompare(b)));exigir(!chaves.has(chave),'CHAVE_REPETIDA');chaves.add(chave);}
   exigir(await compararPagina(d)===0,'CONTEUDO_DIVERGENTE');
   paginasConferidas.push({alvo,paginaId:id,paginaSha256:a.hash});
   for(const v of versoesSnapshotFinal(d)){exigir(!versoes.has(v.identidade),'MIDIA_REPETIDA');versoes.set(v.identidade,v);}
   h.update(a.hash);quantidade+=d.registros.length;paginas++;
  }
  exigir(quantidade===estado.snapshot.tabelas[alvo].registros,'REGISTROS_DIVERGENTES');registros+=quantidade;
  entidades.push({alvo,registros:quantidade,paginas:ids.length,hashConteudo:h.digest('hex')});
 }
 exigir(paginas===relatorio.documentos&&registros===relatorio.registros,'RELATORIO_DIVERGENTE');
 let mapa:MapaMidiaFinal|undefined;const conteudos=new Map<string,{sha256:string;bytes:number}>();
 const recuperado=await recuperarMidia(async(nome,b)=>{
  await conferirAutorizacao();
  if(nome==='mapa-final.json'){exigir(!mapa,'MAPA_REPETIDO');mapa=JSON.parse(b.toString());}
  else{exigir(/^midia\/[a-f0-9]{64}\.bin$/.test(nome)&&!conteudos.has(nome),'MIDIA_DESTINO_RECUSADO');const digest=hash(b);exigir(nome===`midia/${digest}.bin`,'MIDIA_HASH_DIVERGENTE');conteudos.set(nome,{sha256:digest,bytes:b.length});}
 });
 exigir(recuperado.proveniencia==='copia_real_preservada'&&mapa?.versao===1&&mapa.tipo==='midia-copia-final-v1'&&mapa.execucao===estado.execucao&&mapa.t0===estado.t0&&Array.isArray(mapa.registros)&&mapa.registros.length===versoes.size,'MIDIA_COBERTURA_DIVERGENTE');
 const vistos=new Set<string>(),destinos=new Set<string>();
 for(const r of mapa.registros){const v=versoes.get(r.versao?.identidade),c=conteudos.get(r.destino);exigir(v&&!vistos.has(v.identidade)&&JSON.stringify(v)===JSON.stringify(r.versao)&&c?.sha256===r.sha256&&c?.bytes===r.bytes&&r.bytes===v.bytes,'MIDIA_VERSAO_DIVERGENTE');vistos.add(v.identidade);destinos.add(r.destino);}
 exigir(destinos.size===conteudos.size&&versoes.size===relatorio.midiaFinalR2.referencias&&conteudos.size===relatorio.midiaFinalR2.conteudos,'MIDIA_COBERTURA_DIVERGENTE');
 return {entidades,paginasConferidas,midiasConferidas:mapa.registros,paginasVerificadas:paginas,arquivosVerificados:versoes.size,conteudosUnicos:conteudos.size,bytesArquivos:[...conteudos.values()].reduce((n,c)=>n+c.bytes,0)};
}

function contagensLimitacoes(r:ReciboImportacaoFinal['resultado']){
 exigir(r.lacunas&&Object.entries(r.lacunas).every(([k,n])=>natural(n)&&(n===0||k==='CITACAO_LEGADA_INDISPONIVEL'||k==='ANEXO_VERSAO_NAO_PRESERVADA')),'IMPORTACAO_LACUNA_NAO_RECONCILIAVEL');
 return {citacoes:r.lacunas.CITACAO_LEGADA_INDISPONIVEL??0,vazios:r.lacunas.ANEXO_VERSAO_NAO_PRESERVADA??0};
}

/** Limitações do histórico não viram perda nem são apagadas do recibo bruto.
 * Cada ocorrência só é reconciliada com páginas do MESMO T0, bytes já
 * decifrados do R2 e proveniência/conteúdo atuais da MESMA importação.
 * Não cria uma citação entre conversas nem um anexo artificial de zero bytes.
 */
export async function conferirLimitacoesHistoricas({importacao,conteudo,abrirPagina,origemStorageURL,normalizarMensagens,lerMensagemDestino}:{importacao:ReciboImportacaoFinal;conteudo:Awaited<ReturnType<typeof conferirConteudoFinal>>;abrirPagina:(id:string)=>Promise<{documento:DocumentoCarga;hash:string}>;origemStorageURL:string;normalizarMensagens:(registros:Record<string,unknown>[])=>Promise<Record<string,unknown>[]>;lerMensagemDestino:(id:string)=>Promise<MensagemDestino|null>}){
 const esperadas=contagensLimitacoes(importacao.resultado),limitacoesHistoricas:LimitacaoHistorica[]=[];
 if(esperadas.citacoes+esperadas.vazios===0)return {lacunasImportacao:{...importacao.resultado.lacunas},limitacoesHistoricas,pendentes:0};
 const importacaoId='corte-'+importacao.idCopiaFinal;
 exigir(importacao.resultado.idImportacao===importacaoId,'LIMITACAO_IMPORTACAO_DIVERGENTE');
 type Registro={dados:Record<string,unknown>;fonte:FonteRegistro};
 const autores=new Map<string,string>(),ambiguos=new Set<string>(),objetos=new Map<string,Registro>();
 type Mensagem={id:string;conversa:string;citada:unknown;midia:unknown;fonte:FonteRegistro;hashOrigem:string;campos:string[]};
 const mensagens=new Map<string,Mensagem>();
 const ler=async(alvo:string,receber:(r:Registro)=>void)=>{for(const p of conteudo.paginasConferidas.filter(p=>p.alvo===alvo)){
  const a=await abrirPagina(p.paginaId),d=a.documento;
  exigir(a.hash===p.paginaSha256&&d.tipo==='snapshot'&&d.execucao===importacao.idCopiaFinal&&d.id===p.paginaId&&`${d.schema}.${d.tabela}`===alvo,'LIMITACAO_PAGINA_DIVERGENTE');
  // Usa os tipos PostgreSQL sobre o conteúdo R2, sem reler linhas históricas
  // extras da preparação. Assim Z/+00:00 e frações equivalentes não viram
  // divergência artificial no hash de origem produzido pelo importador.
  const tipados=alvo==='public.messages'?await normalizarMensagens(d.registros.map(r=>r.dados)):d.registros.map(r=>r.dados);
  exigir(tipados.length===d.registros.length,'LIMITACAO_NORMALIZACAO_DIVERGENTE');
  for(const [i,r]of d.registros.entries()){exigir(tipados[i].id===r.dados.id,'LIMITACAO_NORMALIZACAO_DIVERGENTE');receber({dados:tipados[i],fonte:{paginaId:p.paginaId,paginaSha256:p.paginaSha256,registroSha256:hash(serializarRegistroT0(r.dados))}});}
 }};
 await ler('public.profiles',({dados:d})=>{const n=d.full_name;if(typeof n!=='string'||!n.trim()||n.length>200||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(n))return;const id=String(d.user_id);if(autores.has(id)&&autores.get(id)!==n)ambiguos.add(id);else autores.set(id,n);});
 for(const id of ambiguos)autores.delete(id);
 await ler('storage.objects',r=>{const d=r.dados;if(['whatsapp-media','audio-messages'].includes(String(d.bucket_id))){const k=d.bucket_id+'/'+String(d.name);exigir(!objetos.has(k),'LIMITACAO_OBJETO_AMBIGUO');objetos.set(k,r);}});
 await ler('public.messages',({dados:d,fonte})=>{
  const origem={...d},metadata=d.metadata;
  if(metadata!==null&&typeof metadata==='object'&&!Array.isArray(metadata)){const m=metadata as Record<string,unknown>,autor=typeof m.sender_id==='string'?m.sender_id:typeof m.user_id==='string'?m.user_id:null;origem._origemAutorNome=autor?autores.get(autor)??null:null;}
  const v=mapearLinhaImportacaoOperacao('mensagem',origem,{phoneNumberId:'12345',usuariosRevisados:{},equipesRevisadas:{}});
  exigir(v&&UUID.test(String(d.id))&&UUID.test(String(d.conversation_id))&&!mensagens.has(String(d.id)),'LIMITACAO_MENSAGEM_INVALIDA');
  mensagens.set(String(d.id),{id:String(d.id),conversa:String(d.conversation_id),citada:d.reply_to_id,midia:d.media_url,fonte,hashOrigem:hashImportacaoOperacao(origem),campos:Object.keys(v)});
 });
 const destinos=new Map<string,MensagemDestino>();
 const destino=async(m:Mensagem)=>{let d=destinos.get(m.id);if(!d){d=await lerMensagemDestino(m.id)??undefined;exigir(d&&d.importacaoId===importacaoId&&d.origemId===m.id&&d.destinoId===m.id&&d.dados.id===m.id&&d.dados.conversa_id===m.conversa&&d.dados.importada===true&&d.hashOrigem===m.hashOrigem&&SHA.test(d.hashDestino)&&hashImportacaoOperacao(Object.fromEntries(m.campos.map(k=>[k,d!.dados[k]??null])))===d.hashDestino,'LIMITACAO_DESTINO_DIVERGENTE');destinos.set(m.id,d);}return d;};
 const proveniencia=(d:MensagemDestino):ProvenienciaDestino=>({importacaoId:d.importacaoId,hashOrigem:d.hashOrigem,hashDestino:d.hashDestino});
 const registrar=(v:Omit<LimitacaoHistorica,'evidenciaSha256'>)=>{limitacoesHistoricas.push({...v,evidenciaSha256:hash(JSON.stringify(v))} as LimitacaoHistorica);};
 for(const m of mensagens.values()){
  if(m.citada){const citada=mensagens.get(String(m.citada));if(citada&&citada.conversa!==m.conversa){
   const d=await destino(m),c=await destino(citada),meta=d.dados.metadados as Record<string,unknown>;
   exigir(d.dados.citada_id===null&&meta?.origemCitacaoId===citada.id,'LIMITACAO_CITACAO_DIVERGENTE');
   registrar({tipo:'citacao_entre_conversas',codigo:'CITACAO_LEGADA_INDISPONIVEL',entidade:'mensagem',mensagemId:m.id,conversaId:m.conversa,fonteMensagem:m.fonte,destinoMensagem:proveniencia(d),citadaId:citada.id,conversaCitadaId:citada.conversa,fonteCitada:citada.fonte,destinoCitada:proveniencia(c),citadaIdDestino:null} as Omit<LimitacaoHistorica,'evidenciaSha256'>);
  }}
  if(typeof m.midia==='string'&&m.midia){
   let chave:string;try{const u=new URL(m.midia),p=u.pathname.match(/^\/storage\/v1\/object\/(?:public|sign)\/(whatsapp-media|audio-messages)\/(.+)$/);if(u.origin!==new URL(origemStorageURL).origin||!p)continue;chave=p[1]+'/'+decodeURIComponent(p[2]);}catch{continue;}
   const o=objetos.get(chave),metadata=o?.dados.metadata as Record<string,unknown>|undefined;
   if(o&&metadata&&JSON.stringify(metadata.size)==='0'){
    const midias=conteudo.midiasConferidas.filter(v=>v.versao.id===o.dados.id&&v.versao.bucket===o.dados.bucket_id&&v.versao.name===o.dados.name&&v.versao.etag===metadata.eTag);
    exigir(midias.length===1&&midias[0].bytes===0&&midias[0].versao.bytes===0&&midias[0].sha256===hash(Buffer.alloc(0)),'LIMITACAO_ARQUIVO_VAZIO_NAO_PRESERVADO');
    const d=await destino(m),meta=d.dados.metadados as Record<string,unknown>;
    exigir(d.dados.anexo_id===null&&meta?.anexoHistoricoIndisponivel===true,'LIMITACAO_ANEXO_DIVERGENTE');
    registrar({tipo:'arquivo_vazio_preservado',codigo:'ANEXO_VERSAO_NAO_PRESERVADA',entidade:'anexo',mensagemId:m.id,conversaId:m.conversa,fonteMensagem:m.fonte,destinoMensagem:proveniencia(d),objetoId:String(o.dados.id),fonteObjeto:o.fonte,bytes:0,sha256:midias[0].sha256,anexoIdDestino:null} as Omit<LimitacaoHistorica,'evidenciaSha256'>);
   }
  }
 }
 exigir(limitacoesHistoricas.filter(l=>l.tipo==='citacao_entre_conversas').length===esperadas.citacoes&&limitacoesHistoricas.filter(l=>l.tipo==='arquivo_vazio_preservado').length===esperadas.vazios,'LIMITACAO_COBERTURA_DIVERGENTE');
 return {lacunasImportacao:{...importacao.resultado.lacunas},limitacoesHistoricas,pendentes:0};
}

export function conferirReferenciaEstado(r:ReferenciaEstadoFinal,id:string){
 exigir(r?.versao===1&&UUID.test(id)&&r.prefixo==='donatella-v2/inicial'&&r.chave.startsWith(id+'/estado-')&&r.chave.endsWith('.json.enc')&&UUID.test(r.chave.slice(id.length+8,-9))&&r.contexto===`final/${id}/${r.chave.slice(id.length+8,-9)}`&&SHA.test(r.sha256)&&natural(r.bytes)&&r.bytes>0,'ESTADO_R2_RECUSADO');
}
