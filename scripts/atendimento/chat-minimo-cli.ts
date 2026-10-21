// Executor manual do núcleo. Não altera webhook, credenciais, Woo ou envios.
import {readFile,lstat,mkdir,open,link,unlink} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {publicarMidiaChat} from './chat-minimo-arquivos';
import type {DocumentoCarga} from '../../src/lib/atendimento/carga';
import {criarCifraBackup,criarPreservadorPacote,recuperarPacoteR2,type ManifestoBackup} from './backup-r2';
import {criarRepositorioS3,type ConfiguracaoS3} from './repositorio-s3';
import {lerVersaoFisica,versoesDaTransacao,type VersaoArquivo} from './arquivo-incremental';
import {importarOperacao,type ConfiguracaoImportacaoOperacao} from './importar-operacao';
import {ALVOS_CHAT_MINIMO,serializarJsonChat,decodificarJsonChat,artefatosR2Chat,conferirCoberturaChat,conferirPaginaChat,materializarChatMinimo,schemaChat,shaChat,sqlSnapshotChatMinimo,sqlPrepararSchemaChat,validarPaginaChat,validarSnapshotChat,type PaginaChat,type SnapshotChat} from './chat-minimo-nucleo';
type Config={versao:1;janelaId:string;execucao:string;autorizacao:string;coletorConfiguracao:string;operacaoConfiguracao:string;estado:string;indiceInicial:string;midiaInicial:string;midiaDestino:string;arquivosIncrementais:string;runtime:string;manifesto:string;importacao:Pick<ConfiguracaoImportacaoOperacao,'usuariosRevisados'|'equipesRevisadas'>};
type Coletor={DATABASE_URL:string;ATENDIMENTO_ORIGEM_URL:string;ATENDIMENTO_ORIGEM_PUBLISHABLE_KEY:string;ATENDIMENTO_ORIGEM_COLETOR_TOKEN:string;ATENDIMENTO_CARGA_SECRET:string;backupExterno:ConfiguracaoS3};
type Operacao={databaseUrl:string;entradaDatabaseUrl:string;modo:string;autoridade:string;enviosReaisHabilitados?:boolean;iaAutomaticaHabilitada?:boolean;meta:{phoneId:string}};
type Indice=Record<string,{arquivo:string;sha256:string;bytes:number;metadata:{eTag:string}}[]>;
function erro(c:string):never{throw Error('CHAT_MINIMO_'+c);}
async function privado(p:string,max=16*1024*1024,estrito=true){
 if(resolve(p)!==p)erro('CAMINHO_RECUSADO');
 for(let a=dirname(p);;a=dirname(a)){const s=await lstat(a);if(!s.isDirectory()||s.isSymbolicLink())erro('CAMINHO_RECUSADO');try{await lstat(join(a,'.git'));erro('CAMINHO_EM_GIT');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}if(a===dirname(a))break;}
 const s=await lstat(p);if(!s.isFile()||s.isSymbolicLink()||s.size>max||(estrito&&(s.mode&0o077)!==0))erro('ARQUIVO_PRIVADO_RECUSADO');return readFile(p);
}
async function exclusivo(p:string,b:Buffer){
 await mkdir(dirname(p),{recursive:true,mode:0o700});const tmp=join(dirname(p),'.'+randomUUID()+'.tmp'),f=await open(tmp,'wx',0o600);
 try{await f.writeFile(b);await f.sync();await f.close();try{await link(tmp,p);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}const a=await privado(p,Math.max(b.length,1));if(!a.equals(b))erro('ARTEFATO_EXISTENTE_DIVERGENTE');const d=await open(dirname(p),'r');try{await d.sync();}finally{await d.close();}}finally{await f.close().catch(()=>undefined);await unlink(tmp);}
}
const json=(v:unknown)=>Buffer.from(serializarJsonChat(v));
async function salvar(p:string,v:unknown){const b=json(v);await exclusivo(p,b);return{arquivo:p.split('/').at(-1)!,sha256:shaChat(b)};}
async function executar(){
 if(process.argv[2]==='--sql'&&process.argv.length===5){process.stdout.write(sqlSnapshotChatMinimo(process.argv[3],process.argv[4]));return;}
 if(process.argv[2]==='--sql-destino'&&process.argv.length===5){process.stdout.write(sqlPrepararSchemaChat(process.argv[3],process.argv[4]));return;}
 if(process.platform!=='linux'||!['--preservar','--importar'].includes(process.argv[2])||process.argv.length!==4)erro('EXECUCAO_MANUAL_EXIGIDA');
 const base=process.env.ATENDIMENTO_RAIZ_REMOTA_OPERACAO;
 if(!base||!/^\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/.test(base)||resolve(base)!==base||/\s/.test(base))erro('RAIZ_PRIVADA_OBRIGATORIA');
 const raiz=join(base,'configuracao/corte-minimo-chat');
 const c=JSON.parse((await privado(process.argv[3])).toString()) as Config;
 schemaChat(c.janelaId);schemaChat(c.execucao);
 if(c.versao!==1||c.janelaId===c.execucao||c.estado!==join(raiz,c.janelaId)||c.autorizacao!==join(c.estado,'autorizacao.json')||c.midiaDestino!=='/midia')erro('CONFIGURACAO_RECUSADA');
 const authBytes=await privado(c.autorizacao),a=JSON.parse(authBytes.toString()),runtimeSha256=shaChat(await privado(c.runtime,20*1024*1024,false)),manifestoSha256=shaChat(await privado(c.manifesto,4*1024*1024,false));
 const autorizar=async()=>{if(shaChat(await privado(c.autorizacao))!==shaChat(authBytes))erro('AUTORIZACAO_ALTERADA');const inicio=Date.parse(a.inicio),fim=Date.parse(a.fim);if(a.versao!==1||a.tipo!=='autorizacao-corte-minimo-chat-v1'||a.escopo!=='chat_humano'||a.janelaId!==c.janelaId||a.runtimeSha256!==runtimeSha256||a.manifestoSha256!==manifestoSha256||a.comandoExpresso!==true||a.estado!=='aberta'||typeof a.referenciaMensagem!=='string'||!a.referenciaMensagem||!Number.isFinite(inicio)||!Number.isFinite(fim)||fim<=inicio||fim-inicio>6*3600000||Date.now()<inicio||Date.now()>fim)erro('NOVA_JANELA_AUTORIZADA_EXIGIDA');};
 await autorizar();
 const cfg=JSON.parse((await privado(c.coletorConfiguracao,128*1024)).toString()) as Coletor,op=JSON.parse((await privado(c.operacaoConfiguracao,256*1024)).toString()) as Operacao;
 const db=new URL(cfg.DATABASE_URL),dbOp=new URL(op.databaseUrl),dbEntrada=new URL(op.entradaDatabaseUrl),origem=new URL(cfg.ATENDIMENTO_ORIGEM_URL);
 if(db.hostname!=='grazing-donatella-homologacao-v2-banco'||db.pathname!=='/donatella_preparacao'||dbOp.hostname!=='grazing-donatella-operacao-v2-banco'||dbOp.pathname!=='/donatella_operacao'||dbEntrada.hostname!==dbOp.hostname||dbEntrada.pathname!=='/donatella_entrada'||origem.hostname!==a.origemHost||origem.protocol!=='https:'||op.meta.phoneId!==a.phoneId)erro('DESTINO_OU_ORIGEM_RECUSADO');
 const pool=new Pool({connectionString:cfg.DATABASE_URL,max:1,application_name:'donatella-chat-minimo'}),destino=new Pool({connectionString:op.databaseUrl,max:1,application_name:'donatella-chat-minimo-importacao'}),entrada=new Pool({connectionString:op.entradaDatabaseUrl,max:1,application_name:'donatella-chat-minimo-prova-entrada'}),s=await pool.connect();
 const cifra=criarCifraBackup(cfg.ATENDIMENTO_CARGA_SECRET),prefixo='donatella-v2/inicial',repoBase=criarRepositorioS3({...cfg.backupExterno,prefixo}),leiturasR2=new Map<string,{sha256:string;bytes:number}>();
 const repo={...repoBase,ler:async(chave:string,limite?:number)=>{const b=await repoBase.ler(chave,limite);if(b)leiturasR2.set(chave,{sha256:shaChat(b),bytes:b.length});return b;}};
 const pacote=criarPreservadorPacote({config:{...cfg.backupExterno,prefixo},cifra,estagio:join(c.estado,'r2'),id:c.execucao, repositorio:repo});
 const lock=await open(join(c.estado,'executor.lock'),'wx',0o600);await lock.writeFile(json({pid:process.pid,execucao:c.execucao}));await lock.sync();
 try{
  await s.query("SET timezone='UTC'");
  const nomeDb=(await s.query('SELECT current_database() nome')).rows[0].nome;if(nomeDb!=='donatella_preparacao')erro('BANCO_RECUSADO');
  async function rpc(parametros:Record<string,unknown>){await autorizar();const res=await fetch(new URL('/rest/v1/rpc/donatella_chat_minimo_snapshot',origem),{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{apikey:cfg.ATENDIMENTO_ORIGEM_PUBLISHABLE_KEY,'x-donatella-coletor':cfg.ATENDIMENTO_ORIGEM_COLETOR_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({janela:c.janelaId,copia:c.execucao,...parametros})});if(!res.ok||!res.body)erro('ORIGEM_LEITURA_FALHOU');const reader=res.body.getReader(),partes:Uint8Array[]=[];let n=0;try{for(;;){const r=await reader.read();if(r.done)break;n+=r.value.length;if(n>8*1024*1024){await reader.cancel();erro('PAGINA_EXCEDE_LIMITE');}partes.push(r.value);}}finally{reader.releaseLock();}return parametros.alvo===null?JSON.parse(Buffer.concat(partes).toString()):decodificarJsonChat(Buffer.concat(partes).toString());}
  if(process.argv[2]==='--preservar'){
   const snapshot=await rpc({alvo:null}) as SnapshotChat;validarSnapshotChat(snapshot);if(snapshot.execucao!==c.execucao||snapshot.janelaId!==c.janelaId||Date.parse(snapshot.t0)<Date.parse(a.inicio)||Date.parse(snapshot.tFim)>Date.now())erro('SNAPSHOT_JANELA_DIVERGENTE');
   const arquivos:ManifestoBackup['arquivos']=[],paginas:PaginaChat[]=[];
   arquivos.push(await pacote.adicionar('snapshot.json',json(snapshot)));
   for(const alvo of ALVOS_CHAT_MINIMO){let apos:string|null=null;for(let numero=0;;numero++){
    await autorizar();const nome=`paginas/${alvo.replace('.','_')}-${String(numero).padStart(6,'0')}.json`,cache=join(c.estado,nome+'.enc'),ctx=`chat/${c.execucao}/${shaChat(nome)}`;let p:PaginaChat;
    try{const b=cifra.abrir(await privado(cache),ctx);try{p=decodificarJsonChat(b.toString()) as PaginaChat;}finally{b.fill(0);}}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;p=await rpc({alvo,apos,limite:250}) as PaginaChat;validarPaginaChat(p,alvo,apos);await conferirPaginaChat(p,s);await exclusivo(cache,cifra.cifrar(json(p),ctx));}
    validarPaginaChat(p,alvo,apos);await conferirPaginaChat(p,s);arquivos.push(await pacote.adicionar(nome,json(p)));paginas.push(p);apos=p.proxima;if(p.fim)break;
   }}
   conferirCoberturaChat(snapshot,paginas);const entidades=snapshot.entidades,inicial=JSON.parse((await privado(c.indiceInicial,32*1024*1024,false)).toString()) as Indice;
   const indice:Indice={},lacunasHistoricas:{codigo:string;referenciaSha256:string}[]=[],vistos=new Set<string>();
   const anteriores=await s.query('SELECT objeto_id,bucket,nome,etag,arquivo,sha256,bytes::text FROM atendimento_migracao.arquivo_versao');
   for(const p of paginas.filter(p=>p.alvo==='storage.objects'))for(const r of p.registros){
    await autorizar();let v:VersaoArquivo;try{[v]=versoesDaTransacao({tipo:'transacao',execucao:c.execucao,id:c.execucao,eventos:[{sequencia:'1',schema:'storage',tabela:'objects',operacao:'INSERT',chave_anterior:null,chave_posterior:{id:r.id},anterior:null,posterior:r.dados}]} satisfies DocumentoCarga);}catch(e){if((e as Error).message!=='ARQUIVO_METADATA_INSUFICIENTE')throw e;lacunasHistoricas.push({codigo:'ARQUIVO_METADATA_INSUFICIENTE',referenciaSha256:r.sha256});continue;}
    let bytes:Buffer|undefined;
    try{
     const ant=(inicial[v.bucket+'/'+v.name]??[]).filter(x=>x.metadata.eTag===v.etag&&x.bytes===v.bytes),incs=anteriores.rows.filter(x=>x.objeto_id===v.id&&x.bucket===v.bucket&&x.nome===v.name&&x.etag===v.etag&&Number(x.bytes)===v.bytes),candidatos=ant.length?ant:incs;
     if(candidatos.length){const first=candidatos[0];if(candidatos.some(x=>x.sha256!==first.sha256)||first.arquivo!==first.sha256+'.bin')erro('MIDIA_INDICE_DIVERGENTE');bytes=await privado(join(ant.length?c.midiaInicial:join(c.arquivosIncrementais,'conteudos'),first.arquivo),64*1024*1024,false);if(bytes.length!==v.bytes||shaChat(bytes)!==first.sha256)erro('MIDIA_CONTEUDO_DIVERGENTE');}
     else bytes=(await lerVersaoFisica({origem:cfg.ATENDIMENTO_ORIGEM_URL,credencial:cfg.ATENDIMENTO_ORIGEM_PUBLISHABLE_KEY,versao:v})).bytes;
     const hash=shaChat(bytes),nome='midia/'+hash+'.bin';
     if(!vistos.has(hash)){arquivos.push(await pacote.adicionar(nome,bytes));vistos.add(hash);}
     indice[v.bucket+'/'+v.name]=[{arquivo:hash+'.bin',sha256:hash,bytes:bytes.length,metadata:{eTag:v.etag}}];
     if(bytes.length===0)lacunasHistoricas.push({codigo:'ARQUIVO_VAZIO_PRESERVADO',referenciaSha256:r.sha256});
    }catch(e){if((e as Error).message!=='ARQUIVO_LACUNA_DE_VERSAO')throw e;lacunasHistoricas.push({codigo:'ARQUIVO_LACUNA_DE_VERSAO',referenciaSha256:r.sha256});}finally{bytes?.fill(0);}
   }
   arquivos.push(await pacote.adicionar('indice-midia.json',json(indice)));arquivos.push(await pacote.adicionar('lacunas-historicas.json',json(lacunasHistoricas)));
   const manifesto:ManifestoBackup={versao:1,id:c.execucao,criadoEm:snapshot.t0,proveniencia:'copia_real_preservada',arquivos};const ref=await pacote.concluir(manifesto);
   // R2 -> decifragem -> JSONB -> hash de conteúdo. Não usa páginas locais como prova externa.
   const recuperadas:PaginaChat[]=[],hashesRecuperados=new Map<string,string>();let snapshotR2:SnapshotChat|undefined;
   await recuperarPacoteR2({id:c.execucao,sha256:ref.sha256,cifra,repositorio:repo,receber:async(nome,b)=>{await autorizar();hashesRecuperados.set(nome,shaChat(b));if(nome==='snapshot.json')snapshotR2=JSON.parse(b.toString());if(nome.startsWith('paginas/')){const p=decodificarJsonChat(b.toString()) as PaginaChat;await conferirPaginaChat(p,s);recuperadas.push(p);}if(nome.startsWith('midia/'))await exclusivo(join(c.estado,nome),b);}});
   if(!snapshotR2||shaChat(json(snapshotR2))!==shaChat(json(snapshot))||arquivos.some(f=>hashesRecuperados.get(f.destino)!==f.sha256))erro('R2_CONTEUDO_DIVERGENTE');conferirCoberturaChat(snapshotR2,recuperadas);
   const fonteSnapshot=await salvar(join(c.estado,'snapshot.json'),snapshot),concluidoEm=new Date().toISOString();
   await salvar(join(c.estado,'indice-midia.json'),indice);await salvar(join(c.estado,'lacunas-historicas.json'),lacunasHistoricas);
   const manifestoR2=await repo.ler(ref.chave);if(!manifestoR2||shaChat(manifestoR2)!==ref.sha256)erro('R2_MANIFESTO_DIVERGENTE');
   const r2={versao:1,tipo:'r2-nucleo-chat-verificado-v1',janelaId:c.janelaId,execucao:c.execucao,runtimeSha256,manifestoSha256,concluidoEm,snapshotSha256:fonteSnapshot.sha256,prefixo,releituraIntegral:true,artefatos:[...artefatosR2Chat(manifesto,prefixo,leiturasR2),{chave:prefixo+'/'+ref.chave,sha256:ref.sha256,bytes:manifestoR2.length,sha256Lido:shaChat(manifestoR2),bytesLidos:manifestoR2.length}],manifesto:{chave:prefixo+'/'+ref.chave,sha256:ref.sha256,bytes:manifestoR2.length},arquivos:arquivos.map(f=>({destino:f.destino,sha256:f.sha256,bytes:f.bytes}))};
   const provaR2=await salvar(join(c.estado,'r2-verificacao.json'),r2);
   await salvar(join(c.estado,'copia-nucleo.json'),{versao:1,tipo:'copia-nucleo-chat-verificada-v1',janelaId:c.janelaId,execucao:c.execucao,t0:snapshot.t0,tFim:snapshot.tFim,runtimeSha256,manifestoSha256,concluidoEm,fase:'preservada',snapshot:fonteSnapshot,verificacaoR2:provaR2,entidades,lacunasHistoricas,enviosIncertos:snapshot.enviosIncertos,filasHistoricasReprocessadas:0,enviosExternos:0});
   console.log(JSON.stringify({tipo:'copia-nucleo-chat-verificada-v1',execucao:c.execucao,t0:snapshot.t0,entidades:entidades.map(e=>({alvo:e.alvo,registros:e.registros})),arquivos:arquivos.length,lacunasHistoricas:lacunasHistoricas.length,enviosExternos:0}));
  }else{
   await autorizar();const cfgAtual=JSON.parse((await privado(c.operacaoConfiguracao)).toString());
   if(cfgAtual.enviosHabilitados!==false||cfgAtual.iaAutomatica!==false||!['homologacao','receber'].includes(cfgAtual.modo))erro('IMPORTACAO_EXIGE_EMISSORES_DESLIGADOS');
   const copiaBytes=await privado(join(c.estado,'copia-nucleo.json')),copia=JSON.parse(copiaBytes.toString()),r2Bytes=await privado(join(c.estado,'r2-verificacao.json')),r2=JSON.parse(r2Bytes.toString());
   if(copia.tipo!=='copia-nucleo-chat-verificada-v1'||copia.janelaId!==c.janelaId||copia.execucao!==c.execucao||copia.runtimeSha256!==runtimeSha256||copia.manifestoSha256!==manifestoSha256||copia.verificacaoR2?.sha256!==shaChat(r2Bytes)||copia.fase!=='preservada')erro('COPIA_NAO_COMPROVADA');
   const paginas:PaginaChat[]=[];let snapshot:SnapshotChat|undefined;let midiasPublicadas=0;
   await recuperarPacoteR2({id:c.execucao,sha256:r2.manifesto.sha256,cifra,repositorio:repo,receber:async(nome,b)=>{await autorizar();if(nome==='snapshot.json')snapshot=JSON.parse(b.toString());else if(nome.startsWith('paginas/'))paginas.push(decodificarJsonChat(b.toString()) as PaginaChat);else if(nome.startsWith('midia/')){const m=/^midia\/([a-f0-9]{64})\.bin$/.exec(nome);if(!m)erro('MIDIA_NOME_RECUSADO');await exclusivo(join(c.estado,nome),b);await publicarMidiaChat(c.midiaDestino,m[1],b);midiasPublicadas++;}else if(nome==='indice-midia.json')await exclusivo(join(c.estado,nome),b);}});
   if(!snapshot||shaChat(json(snapshot))!==copia.snapshot.sha256)erro('SNAPSHOT_R2_DIVERGENTE');
   const preparacao=await materializarChatMinimo(snapshot,paginas,s);
   // Seleciona IDs já presentes na entrada e confere esses mesmos corpos depois.
   // Entradas novas durante a importação são permitidas, mas nunca UPDATE/DELETE.
   const recebidos=await entrada.query<{id:string;hash:string}>("SELECT id::text,encode(sha256(corpo),'hex') hash FROM atendimento_entrada.recibo ORDER BY id");
   const antesHash=shaChat(JSON.stringify(recebidos.rows));
   const novasAntes=await destino.query("SELECT 'mensagem' tipo,id::text,encode(sha256(convert_to(to_jsonb(m)::text,'UTF8')),'hex') hash FROM atendimento_operacao.mensagem m WHERE NOT importada UNION ALL SELECT 'conversa',id::text,encode(sha256(convert_to(to_jsonb(c)::text,'UTF8')),'hex') FROM atendimento_operacao.conversa c WHERE NOT importada ORDER BY tipo,id");
   const resultado=await importarOperacao({origemDatabaseUrl:cfg.DATABASE_URL,destinoDatabaseUrl:op.databaseUrl,origemStorageURL:cfg.ATENDIMENTO_ORIGEM_URL,phoneNumberId:op.meta.phoneId,...c.importacao,manifestoInicial:join(c.estado,'indice-midia.json'),midiaLegadaRaiz:join(c.estado,'midia'),midiaIncrementalRaiz:join(c.arquivosIncrementais,'conteudos'),marcador:snapshot.t0,idImportacao:'chat-'+c.execucao,nucleoChat:{schema:preparacao.schema}});
   const recebidosApos=await entrada.query("SELECT id::text,encode(sha256(corpo),'hex') hash FROM atendimento_entrada.recibo WHERE id=ANY($1::uuid[]) ORDER BY id",[recebidos.rows.map(r=>r.id)]),depoisHash=shaChat(JSON.stringify(recebidosApos.rows));
   const totalRecebidosApos=Number((await entrada.query('SELECT count(*)::text n FROM atendimento_entrada.recibo')).rows[0].n);
   const novasDepois=await destino.query("SELECT 'mensagem' tipo,id::text,encode(sha256(convert_to(to_jsonb(m)::text,'UTF8')),'hex') hash FROM atendimento_operacao.mensagem m WHERE id=ANY($1::uuid[]) UNION ALL SELECT 'conversa',id::text,encode(sha256(convert_to(to_jsonb(c)::text,'UTF8')),'hex') FROM atendimento_operacao.conversa c WHERE id=ANY($2::uuid[]) ORDER BY tipo,id",[novasAntes.rows.filter(r=>r.tipo==='mensagem').map(r=>r.id),novasAntes.rows.filter(r=>r.tipo==='conversa').map(r=>r.id)]);
   if(antesHash!==depoisHash||shaChat(json(novasAntes.rows))!==shaChat(json(novasDepois.rows))||Object.values(resultado.entidades).some(e=>e.divergentes!==0))erro('NOVAS_ENTRADAS_OU_DESTINO_DIVERGENTE');
   const bruto=await salvar(join(c.estado,'importacao-resultado.json'),resultado);
   const entidades=['contato','conversa','mensagem','anexo'].map(entidade=>{const v=resultado.entidades[entidade];return{entidade,observados:v?.observados??0,verificados:v?.verificados??0,hashDestino:v?.hashDestino||shaChat(''),divergenciasNaoExplicadas:v?.divergentes??0,preservados:v?.preservados??0};});
   const lacunasHistoricas=Object.entries(resultado.lacunas).map(([codigo,quantidade])=>({codigo,quantidade,referenciaSha256:bruto.sha256}));
   const normalizado={entidades,lacunasHistoricas},resultadoVerificado=await salvar(join(c.estado,'importacao-normalizada.json'),normalizado);
   await autorizar();await salvar(join(c.estado,'importacao-nucleo.json'),{versao:1,tipo:'importacao-nucleo-chat-v1',janelaId:c.janelaId,execucao:c.execucao,t0:snapshot.t0,runtimeSha256,manifestoSha256,concluidoEm:new Date().toISOString(),fase:'concluida',copiaSha256:shaChat(copiaBytes),entradaIsolada:true,bancoEntrada:'donatella_entrada',bancoDestino:'donatella_operacao',preservacaoNovasEntradas:{registrosAntes:recebidos.rows.length,registrosDepois:totalRecebidosApos,subconjuntoPreservado:true,registrosSubconjuntoDepois:recebidosApos.rows.length,antesSha256:antesHash,depoisSha256:depoisHash},anterioresNovosHash:shaChat(json(novasAntes.rows)),depoisNovosHash:shaChat(json(novasDepois.rows)),filaHistoricaExecutavel:false,filasHistoricasReprocessadas:0,enviosExternos:0,midiasCasOperacional:{raiz:'/midia',conteudos:midiasPublicadas,preservadasAntesRecibo:true},resultadoBruto:bruto,resultadoVerificado,resultado:normalizado});
   console.log(JSON.stringify({tipo:'importacao-nucleo-chat-v1',execucao:c.execucao,entidades:resultado.entidades,lacunas:resultado.lacunas,midiasPublicadasCasOperacional:midiasPublicadas,enviosExternos:0}));
  }
 }finally{await lock.close();await unlink(join(c.estado,'executor.lock'));s.release();cifra.fechar();await Promise.all([pool.end(),destino.end(),entrada.end()]);}
}
void executar().catch(e=>{console.error(JSON.stringify({erro:e instanceof Error&&/^[A-Z0-9_]{1,100}$/.test(e.message)?e.message:'CHAT_MINIMO_EXECUCAO_INTERROMPIDA',enviosExternos:0,dadosPreservados:true}));process.exitCode=1;});
