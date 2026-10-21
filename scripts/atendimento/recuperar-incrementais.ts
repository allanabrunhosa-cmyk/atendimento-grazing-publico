// Restauração REAL da cópia operacional cifrada em container novo, sem acesso à origem.
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {abrirCarga,persistirCarga} from '../../src/lib/atendimento/carga';
import {criarMaterializador} from '../../src/lib/atendimento/materializacao';
import {prisma} from '../../src/lib/prisma';
const config=JSON.parse(await readFile('/run/secrets/coletor.json','utf8'));
const modoR2=process.argv.slice(2).length===1&&process.argv[2]==='--r2';
if(process.argv.slice(2).length&&!modoR2)throw Error('RECUPERACAO_ARGUMENTO_RECUSADO');
let pacoteR2:string|undefined;
if(modoR2){
 const prova=JSON.parse(await readFile('/prova/prova-r2.json','utf8'));
 if(prova.origemExclusiva!=='R2'||prova.cacheLocalUsado!==false||prova.configuracoesPortateisRecuperadas!==5||!/^[a-f0-9-]{36}$/.test(prova.id))throw Error('RECUPERACAO_R2_NAO_COMPROVADA');
 pacoteR2=prova.id;
}
const url=new URL(config.DATABASE_URL);
const host=modoR2?'grazing-donatella-recuperacao-incremental-r2-v2-banco':'grazing-donatella-recuperacao-incremental-v2-banco';
if(url.hostname!==host||url.pathname!=='/donatella_preparacao'||url.username!=='donatella_coletor')throw Error('RECUPERACAO_ISOLADA_EXIGIDA');
const pool=new Pool({connectionString:url.href,max:1,statement_timeout:60_000}),catalogo=JSON.parse(await readFile('/release/estrutura.json','utf8'));
const materializar=criarMaterializador(pool,catalogo.tabelas,config.ATENDIMENTO_EXECUCAO_CARGA);
try{
 const arquivos=(await readdir('/copias')).filter(n=>/^[a-f0-9-]{36}\.json\.enc$/.test(n)).sort();
 const existente=await pool.query('SELECT count(*)::integer n FROM atendimento_migracao.carga_documento');
 if(existente.rows[0].n!==0)throw Error('RECUPERACAO_EXIGE_BASE_NOVA');
 let snapshots=0,transacoes=0,eventos=0;
 for(const arquivo of arquivos){
  const a=JSON.parse(await readFile('/copias/'+arquivo,'utf8'));
  const documento=abrirCarga(a.cifrado,a.hash);
  if(documento.execucao!==config.ATENDIMENTO_EXECUCAO_CARGA||documento.id+'.json.enc'!==arquivo)throw Error('ARQUIVO_DIVERGENTE');
  const c={documento,hash:a.hash,cifrado:a.cifrado,estados:[]};
  await persistirCarga(c);await materializar(c);
  if(documento.tipo==='snapshot')snapshots++;else{transacoes++;eventos+=documento.eventos.length;}
 }
 if(!arquivos.length||!snapshots)throw Error('RECUPERACAO_INCREMENTAIS_INCOMPLETA');
 const prova={instante:new Date().toISOString(),real:true,documentos:arquivos.length,snapshots,transacoes,eventos,origemAcessada:false,semJobsEnvios:true,proveniencia:modoR2?'R2':'arquivos_cifrados_fora_da_VPS',...(modoR2?{pacoteR2,cacheLocalUsado:false}:{}),ordemReproducao:'UUID; fences por registro protegem snapshots e transacoes tardios'};
 await writeFile('/estado/recuperacao-incrementais.json',JSON.stringify(prova),{mode:0o600});console.log(JSON.stringify(prova));
}catch(e){const erro=e as {code?:string;table?:string;column?:string};console.error(JSON.stringify({falha:'RECUPERACAO_INCREMENTAIS_INTERROMPIDA',codigo:erro.code??null,tabela:erro.table??null,coluna:erro.column??null}));process.exitCode=1;}
finally{await pool.end();await prisma.$disconnect();}
