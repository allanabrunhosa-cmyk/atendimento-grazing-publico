// Preparado, sem agendamento. Exige segundo comando + origem realmente congelada.
import {readFile,mkdir,lstat,open,rename,unlink,statfs} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {setTimeout as esperar} from 'node:timers/promises';
import {copiarOrigemCongeladaAteConcluir,conferirJanelaCopiaFinal,novoEstadoCopiaFinal,type EstadoCopiaFinal} from './copia-final-origem';
import {validarObservacaoManutencao,type ObservacaoManutencao} from './manutencao-origem';
import {criarArquivoExterno} from './arquivo-externo';
import {criarCifraBackup,criarPreservadorPacote} from './backup-r2';
import {preservarMidiaFinal} from './midia-copia-final';
import {criarCanalArquivos,type RegistroArquivoIncremental} from './arquivo-incremental-duravel';
import {versoesDaTransacao} from './arquivo-incremental';
import type {DocumentoCarga,CargaPreparada} from '../../src/lib/atendimento/carga';
import type {ConfiguracaoS3} from './repositorio-s3';
import {criarRepositorioS3} from './repositorio-s3';

type Config={versao:1;execucao:string;coletorConfiguracao:string;origemConferencia:string;autorizacao:string;estado:string;estrutura:string;repositorio:string;midiaInicial:string;indiceInicial:string;arquivosIncrementais:string;maxPaginas:number};
type ColetorConfig={DATABASE_URL:string;ATENDIMENTO_EXECUCAO_CARGA:string;ATENDIMENTO_ORIGEM_URL:string;ATENDIMENTO_ORIGEM_PUBLISHABLE_KEY:string;ATENDIMENTO_ORIGEM_COLETOR_TOKEN:string;ATENDIMENTO_CARGA_SECRET:string;backupExterno:ConfiguracaoS3};
const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const sha=/^[a-f0-9]{64}$/;
async function lerPrivado(p:string,limite=32*1024*1024,modoPrivado=true){
 if(resolve(p)!==p)throw Error('COPIA_FINAL_CAMINHO_RECUSADO');
 for(let a=dirname(p);;a=dirname(a)){const s=await lstat(a);if(!s.isDirectory()||s.isSymbolicLink())throw Error('COPIA_FINAL_CAMINHO_RECUSADO');try{await lstat(join(a,'.git'));throw Error('COPIA_FINAL_CAMINHO_RECUSADO');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}if(dirname(a)===a)break;}
 const s=await lstat(p);if(!s.isFile()||s.isSymbolicLink()||s.size>limite||(modoPrivado&&process.platform!=='win32'&&(s.mode&0o077)!==0))throw Error('COPIA_FINAL_ARQUIVO_PRIVADO_RECUSADO');
 return readFile(p);
}
async function gravar(p:string,conteudo:string){const temp=join(dirname(p),'.'+randomUUID()+'.parcial'),f=await open(temp,'wx',0o600);try{await f.writeFile(conteudo);await f.sync();}finally{await f.close();}await rename(temp,p);const d=await open(dirname(p),'r');try{await d.sync();}finally{await d.close();}}
async function executar(){
 if(process.argv.length!==4||process.argv[2]!=='--executar-copia-final'||process.platform!=='linux')throw Error('COPIA_FINAL_EXECUCAO_MANUAL_EXIGIDA');
 const c=JSON.parse((await lerPrivado(process.argv[3],64*1024)).toString()) as Config;
 if(c.versao!==1||!Number.isSafeInteger(c.maxPaginas)||c.maxPaginas<1||c.maxPaginas>500||resolve(c.estado)!==c.estado||!c.estado.startsWith('/estado/copia-final/'))throw Error('COPIA_FINAL_CONFIGURACAO_RECUSADA');
 const autorizacaoInicial=await lerPrivado(c.autorizacao,64*1024),autorizado=JSON.parse(autorizacaoInicial.toString());
 if(autorizado.versao!==1||autorizado.segundoComandoExpresso!==true||autorizado.coletorSuspenso!==true||typeof autorizado.referenciaMensagem!=='string'||!autorizado.referenciaMensagem||Date.now()<Date.parse(autorizado.inicio)||Date.now()>Date.parse(autorizado.fim)||!Number.isFinite(Date.parse(autorizado.inicio))||!Number.isFinite(Date.parse(autorizado.fim)))throw Error('COPIA_FINAL_SEGUNDO_COMANDO_OU_COLETOR_AUSENTE');
 const conferirAutorizacao=async()=>{const atual=await lerPrivado(c.autorizacao,64*1024);if(hash(atual)!==hash(autorizacaoInicial))throw Error('COPIA_FINAL_AUTORIZACAO_ALTERADA');conferirJanelaCopiaFinal(autorizado.inicio,autorizado.fim);};
 await conferirAutorizacao();
 const observacao=JSON.parse((await lerPrivado(c.origemConferencia,128*1024)).toString()) as ObservacaoManutencao;validarObservacaoManutencao(observacao);
 const cfg=JSON.parse((await lerPrivado(c.coletorConfiguracao,128*1024)).toString()) as ColetorConfig;
 const u=new URL(cfg.DATABASE_URL);if(u.pathname!=='/donatella_preparacao'||u.hostname!=='grazing-donatella-homologacao-v2-banco'||!cfg.ATENDIMENTO_CARGA_SECRET||c.execucao===cfg.ATENDIMENTO_EXECUCAO_CARGA||!cfg.backupExterno)throw Error('COPIA_FINAL_DESTINO_RECUSADO');
 const origem=new URL(cfg.ATENDIMENTO_ORIGEM_URL);if(origem.hostname!==autorizado.origemHost)throw Error('COPIA_FINAL_ORIGEM_RECUSADA');
 // O segredo abaixo é o de serviço já existente; a chave mestra do iPhone não é lida.
 process.env.DATABASE_URL=cfg.DATABASE_URL;process.env.ATENDIMENTO_CARGA_SECRET=cfg.ATENDIMENTO_CARGA_SECRET;
 const [{coletarPagina},{abrirCarga,persistirCarga,serializarCarga},{arquivarCarga},{criarMaterializador},{prisma}]=await Promise.all([import('../../src/lib/atendimento/coleta'),import('../../src/lib/atendimento/carga'),import('../../src/lib/atendimento/arquivo-carga'),import('../../src/lib/atendimento/materializacao'),import('../../src/lib/prisma')]);
 const pool=new Pool({connectionString:cfg.DATABASE_URL,max:2,connectionTimeoutMillis:5000,application_name:'donatella-copia-final-v2'});
 const cifra=criarCifraBackup(cfg.ATENDIMENTO_CARGA_SECRET),externo=criarArquivoExterno(cfg.backupExterno);if(!externo)throw Error('COPIA_FINAL_BACKUP_AUSENTE');
 await mkdir(c.estado,{recursive:true,mode:0o700});const lock=join(c.estado,'execucao.lock'),f=await open(lock,'wx',0o600);await f.writeFile(JSON.stringify({pid:process.pid,execucao:c.execucao}));await f.sync();
 try{
 const catalogo=JSON.parse((await lerPrivado(c.estrutura,8*1024*1024,false)).toString());
 const materializar=criarMaterializador(pool,catalogo.tabelas,c.execucao),checkpoint=join(c.estado,'estado.json');
 let estado:EstadoCopiaFinal;try{estado=JSON.parse((await lerPrivado(checkpoint,512*1024)).toString());}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;estado=novoEstadoCopiaFinal(c.execucao,observacao);}
 if(estado.execucao!==c.execucao)throw Error('COPIA_FINAL_EXECUCAO_DIVERGENTE');
 const registrar=async(r:RegistroArquivoIncremental)=>{const v=r.versao;await pool.query(`INSERT INTO atendimento_migracao.arquivo_versao(execucao,identidade,objeto_id,bucket,nome,etag,versao_origem,atualizado_origem,sha256,bytes,arquivo,pacote,manifesto_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING`,[c.execucao,v.identidade,v.id,v.bucket,v.name,v.etag,v.version,v.updatedAt,r.sha256,r.bytes,r.arquivo,r.referencia.id,r.referencia.sha256]);const prova=await pool.query('SELECT 1 FROM atendimento_migracao.arquivo_versao WHERE execucao=$1 AND identidade=$2 AND sha256=$3 AND bytes=$4 AND arquivo=$5',[c.execucao,v.identidade,r.sha256,r.bytes,r.arquivo]);if(prova.rowCount!==1)throw Error('COPIA_FINAL_ARQUIVO_INDICE_DIVERGENTE');};
 const canal=criarCanalArquivos({config:{...cfg.backupExterno,prefixo:'donatella-v2/arquivos'},cifra,estado:c.arquivosIncrementais,midiaInicial:c.midiaInicial,indiceInicial:c.indiceInicial,origem:cfg.ATENDIMENTO_ORIGEM_URL,credencial:cfg.ATENDIMENTO_ORIGEM_PUBLISHABLE_KEY,registrar});
 const inicial=JSON.parse((await lerPrivado(c.indiceInicial,16*1024*1024,false)).toString()) as Record<string,{arquivo:string;sha256:string;bytes:number;metadata:{eTag:string}}[]>;
 const conferirFisico=async(pasta:string,r:{arquivo:string;sha256:string;bytes:number})=>{if(!sha.test(r.sha256)||r.arquivo!==r.sha256+'.bin')throw Error('COPIA_FINAL_ARQUIVO_INDICE_DIVERGENTE');const b=await lerPrivado(join(pasta,r.arquivo),64*1024*1024,false);try{if(b.length!==r.bytes||hash(b)!==r.sha256)throw Error('COPIA_FINAL_ARQUIVO_FISICO_DIVERGENTE');}finally{b.fill(0);}};
 let lacunasPagina:{codigo:string}[]=[];
 const preservarMidia=async(carga:CargaPreparada)=>{
  const d=carga.documento;if(d.tipo!=='snapshot'||d.schema!=='storage'||d.tabela!=='objects')return;
  for(const [indice,r]of d.registros.entries()){
   if(!['whatsapp-media','audio-messages'].includes(String(r.dados.bucket_id)))continue;
   const sintetico={execucao:c.execucao,id:randomUUID(),tipo:'transacao',eventos:[{sequencia:String(indice+1),schema:'storage',tabela:'objects',operacao:'INSERT',chave_anterior:null,chave_posterior:r.chave,anterior:null,posterior:r.dados}]} satisfies DocumentoCarga;
   try{
    const [v]=versoesDaTransacao(sintetico);if(!v)throw Error('ARQUIVO_METADATA_INSUFICIENTE');
    const antigo=(inicial[v.bucket+'/'+v.name]??[]).filter(x=>x.metadata.eTag===v.etag&&x.bytes===v.bytes);
    if(antigo.length){if(antigo.some(x=>x.sha256!==antigo[0].sha256))throw Error('COPIA_FINAL_ARQUIVO_INDICE_DIVERGENTE');await conferirFisico(c.midiaInicial,antigo[0]);continue;}
    const anteriores=await pool.query<{arquivo:string;sha256:string;bytes:string}>('SELECT arquivo,sha256,bytes::text FROM atendimento_migracao.arquivo_versao WHERE objeto_id=$1 AND bucket=$2 AND nome=$3 AND etag=$4 AND bytes=$5 ORDER BY preservado_em DESC LIMIT 2',[v.id,v.bucket,v.name,v.etag,v.bytes]);
    if(anteriores.rows.length){const ant=anteriores.rows[0];if(anteriores.rows.some(x=>x.sha256!==ant.sha256))throw Error('COPIA_FINAL_ARQUIVO_INDICE_DIVERGENTE');await conferirFisico(join(c.arquivosIncrementais,'conteudos'),{...ant,bytes:Number(ant.bytes)});continue;}
    await canal.preservar(sintetico);
   }catch(e){const codigo=e instanceof Error?e.message:'';if(!['ARQUIVO_LACUNA_DE_VERSAO','ARQUIVO_METADATA_INSUFICIENTE'].includes(codigo))throw e;lacunasPagina.push({codigo});}
  }
 };
 const espaco=async()=>{const s=await statfs(c.estado,{bigint:true});if(s.bavail*s.bsize<BigInt(512*1024*1024))throw Error('COPIA_FINAL_ESPACO_INSUFICIENTE');};
 const destinos={arquivar:async(carga:CargaPreparada)=>{await preservarMidia(carga);await arquivarCarga(carga,c.estado,c.repositorio);const b=await lerPrivado(join(c.estado,c.execucao,carga.documento.id+'.json.enc'));try{await externo(c.execucao+'/'+carga.documento.id+'.json.enc',b);}finally{b.fill(0);}},persistir:async()=>undefined};
 // O RPC final mantém a autenticação e o contrato snapshot, mas exige o T0
 // congelado em vez da continuidade do CDC que pode ter sido interrompido.
 const requisitarFinal:typeof fetch=async(input,init)=>{await conferirAutorizacao();const url=new URL(String(input));if(url.origin!==origem.origin||url.pathname!=='/rest/v1/rpc/donatella_migracao_snapshot'||init?.method!=='POST'||typeof init.body!=='string')throw Error('COPIA_FINAL_REQUISICAO_RECUSADA');url.pathname='/rest/v1/rpc/donatella_migracao_copia_final';return fetch(url,{...init,body:JSON.stringify({...JSON.parse(init.body),corte:observacao.execucao})});};
 const ausenciaHistorica:Record<string,number>={};
 const resumo=await copiarOrigemCongeladaAteConcluir(estado,observacao,c.maxPaginas,{
  conferirAutorizacao,
  pagina:async(alvo,anterior)=>{await espaco();await esperar(500);const [schema,tabela]=alvo.split('.');let apos:Record<string,unknown>|null=null;lacunasPagina=[];
   if(anterior){const a=JSON.parse((await lerPrivado(join(c.estado,c.execucao,anterior+'.json.enc'))).toString());const d=abrirCarga(a.cifrado,a.hash);if(d.execucao!==c.execucao||d.id!==anterior||d.tipo!=='snapshot'||d.schema!==schema||d.tabela!==tabela||d.fim||!d.proxima)throw Error('COPIA_FINAL_RETOMADA_DIVERGENTE');apos=d.proxima;}
   const id=randomUUID(),r=await coletarPagina({execucao:c.execucao,origem:cfg.ATENDIMENTO_ORIGEM_URL,credencial:cfg.ATENDIMENTO_ORIGEM_PUBLISHABLE_KEY,tokenColetor:cfg.ATENDIMENTO_ORIGEM_COLETOR_TOKEN,capturaAprovada:true,simular:false},schema,tabela,apos,destinos,id,requisitarFinal);
   return {documento:id,registros:r.registros,fim:r.fim,lacunas:lacunasPagina};},
  preservarEstado:async(e)=>{const id=randomUUID(),contexto='final/'+c.execucao+'/'+id,chave=c.execucao+'/estado-'+id+'.json.enc',b=cifra.cifrar(Buffer.from(JSON.stringify(e)),contexto);try{const r=await criarRepositorioS3({...cfg.backupExterno,prefixo:'donatella-v2/inicial'}).preservar(chave,b);await gravar(join(c.estado,'estado-ref-r2.json'),JSON.stringify({versao:1,prefixo:'donatella-v2/inicial',chave,contexto,sha256:r.sha256,bytes:r.bytes}));}finally{b.fill(0);}await gravar(checkpoint,JSON.stringify(e));},
  materializar:async(e)=>{
   // Gravação cifrada/indexada por execução nova mantém o original e os fences antigos.
   for(const ds of Object.values(e.documentos))for(const id of ds){const a=JSON.parse((await lerPrivado(join(c.estado,c.execucao,id+'.json.enc'))).toString());const carga={documento:abrirCarga(a.cifrado,a.hash),hash:a.hash,cifrado:a.cifrado,estados:[]};await persistirCarga(carga);}
   const tx=await pool.connect();try{await tx.query('BEGIN');await tx.query("SET LOCAL statement_timeout='60s'");await tx.query("SET LOCAL lock_timeout='3s'");await tx.query('SET CONSTRAINTS ALL DEFERRED');
    for(const ds of Object.values(e.documentos))for(const id of ds){const a=JSON.parse((await lerPrivado(join(c.estado,c.execucao,id+'.json.enc'))).toString());await materializar.aplicarTx(tx,{documento:abrirCarga(a.cifrado,a.hash),hash:a.hash,cifrado:a.cifrado,estados:[]});}
    // Compara o conteúdo tipado de todas as linhas da cópia, além dos totais.
    const q=(v:string)=>'"'+v.replaceAll('"','""')+'"';
    for(const [alvo,ds] of Object.entries(e.documentos)){
     const [schema,tabela]=alvo.split('.'),t=catalogo.tabelas.find((x:{esquema:string;tabela:string})=>x.esquema===schema&&x.tabela===tabela),nome=q('donatella_'+schema)+'.'+q(tabela);
     if(!t||!Array.isArray(t.pk))throw Error('COPIA_FINAL_CATALOGO_DIVERGENTE');
     for(const id of ds){const a=JSON.parse((await lerPrivado(join(c.estado,c.execucao,id+'.json.enc'))).toString()),d=abrirCarga(a.cifrado,a.hash);if(d.tipo!=='snapshot')throw Error('COPIA_FINAL_DOCUMENTO_DIVERGENTE');
      if(d.registros.length){const r=await tx.query(`SELECT count(*)::int divergencias FROM jsonb_populate_recordset(NULL::${nome},$1::jsonb) esperado LEFT JOIN ${nome} atual ON ${t.pk.map((p:string)=>`atual.${q(p)}=esperado.${q(p)}`).join(' AND ')} WHERE to_jsonb(atual) IS DISTINCT FROM to_jsonb(esperado)`,[serializarCarga(d.registros.map(r=>r.dados))]);if(r.rows[0].divergencias!==0)throw Error('COPIA_FINAL_CONTEUDO_DIVERGENTE');}
     }
     const n=await tx.query(`SELECT count(*)::text quantidade FROM ${nome}`);const antiga=Number(n.rows[0].quantidade)-e.snapshot.tabelas[alvo].registros;if(antiga<0)throw Error('COPIA_FINAL_REGISTROS_AUSENTES');ausenciaHistorica[alvo]=antiga;
    }
    await tx.query('COMMIT');
   }catch(e){await tx.query('ROLLBACK');throw e;}finally{tx.release();}
  },
 });
 // O pacote final inclui também arquivos reaproveitados do primeiro backup.
 // O índice local sozinho não comprova sua preservação externa em T0.
 const pacoteMidia=criarPreservadorPacote({config:{...cfg.backupExterno,prefixo:'donatella-v2/arquivos'},cifra,estagio:join(c.estado,'midia-r2'),id:c.execucao});
 async function* documentosMidia(){for(const id of estado.documentos['storage.objects']){const a=JSON.parse((await lerPrivado(join(c.estado,c.execucao,id+'.json.enc'))).toString());yield abrirCarga(a.cifrado,a.hash);}}
 const midiaFinalR2=await preservarMidiaFinal({execucao:c.execucao,t0:estado.t0,criadoEm:estado.iniciadaEm,documentos:documentosMidia(),pacote:pacoteMidia,conferirAutorizacao,buscar:async(v)=>{
  const candidatos=(inicial[v.bucket+'/'+v.name]??[]).filter(x=>x.metadata.eTag===v.etag&&x.bytes===v.bytes);
  let pasta=c.midiaInicial,r=candidatos[0];
  if(candidatos.some(x=>x.sha256!==r.sha256))throw Error('COPIA_FINAL_ARQUIVO_INDICE_DIVERGENTE');
  if(!r){const antigos=await pool.query<{arquivo:string;sha256:string;bytes:string}>('SELECT arquivo,sha256,bytes::text FROM atendimento_migracao.arquivo_versao WHERE objeto_id=$1 AND bucket=$2 AND nome=$3 AND etag=$4 AND bytes=$5 ORDER BY preservado_em DESC LIMIT 2',[v.id,v.bucket,v.name,v.etag,v.bytes]);
   if(!antigos.rows.length||antigos.rows.some(x=>x.sha256!==antigos.rows[0].sha256))throw Error('COPIA_FINAL_MIDIA_AUSENTE_OU_DIVERGENTE');
   r={...antigos.rows[0],bytes:Number(antigos.rows[0].bytes),metadata:{eTag:v.etag}};pasta=join(c.arquivosIncrementais,'conteudos');
  }
  await conferirFisico(pasta,r);return lerPrivado(join(pasta,r.arquivo),64*1024*1024,false);
 }});
 // O checkpoint operacional posterior inclui este relatório e, portanto,
 // a receita estado R2 -> IDs de todas as páginas + pacote de mídia T0.
 const estadoFinalR2=JSON.parse((await lerPrivado(join(c.estado,'estado-ref-r2.json'))).toString());
 const relatorio={...resumo,linhasHistoricasForaSnapshotAtual:ausenciaHistorica,comparacaoConteudoTipado:resumo.fase==='materializada',nenhumaLinhaAntigaExcluida:true,midiaFinalR2,estadoFinalR2};
 await gravar(join(c.estado,'relatorio.json'),JSON.stringify(relatorio));console.log(JSON.stringify(relatorio));
 }finally{await f.close();await unlink(lock);cifra.fechar();await Promise.all([pool.end(),prisma.$disconnect()]);}
}
void executar().catch(e=>{console.error(JSON.stringify({erro:e instanceof Error&&/^[A-Z0-9_]{1,80}$/.test(e.message)?e.message:'COPIA_FINAL_INTERROMPIDA',dadosPreservados:true,ackOrigemExecutado:false}));process.exitCode=1;});
