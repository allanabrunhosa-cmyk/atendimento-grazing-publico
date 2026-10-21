import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { urlObjeto as pura } from '../../scripts/atendimento/storage-objeto.mjs';
import { urlObjeto as compativel } from '../../scripts/atendimento/backup-arquivos.mjs';

const raiz=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const base=join(raiz,'.tmp-homologacao');
const janela='11111111-1111-4111-8111-111111111111',copia='22222222-2222-4222-8222-222222222222';
let pasta,bundle,guarda,entradas;
before(async()=>{
  await mkdir(base,{recursive:true});pasta=await mkdtemp(join(base,'smoke-chat-cli-'));bundle=join(pasta,'chat-minimo.mjs');guarda=join(pasta,'sem-efeitos.mjs');
  const r=await build({absWorkingDir:raiz,entryPoints:['scripts/atendimento/chat-minimo-cli.ts'],outfile:bundle,bundle:true,packages:'external',platform:'node',target:'node22',format:'esm',metafile:true,plugins:[{name:'server-only-cli',setup(b){b.onResolve({filter:/^server-only$/},()=>({path:'server-only',namespace:'noop'}));b.onLoad({filter:/.*/,namespace:'noop'},()=>({contents:'',loader:'js'}));}}]});
  entradas=Object.keys(r.metafile.inputs);
  // O processo filho recebe o bundle real. Qualquer caminho acidental de escrita,
  // rede ou abertura de banco falha, sem usar credenciais ou dados operacionais.
  await writeFile(guarda,`import fs from 'node:fs';import fsp from 'node:fs/promises';import net from 'node:net';import tls from 'node:tls';import http from 'node:http';import https from 'node:https';import {syncBuiltinESMExports} from 'node:module';
const negar=()=>{throw Error('SMOKE_EFEITO_EXTERNO_RECUSADO')};
for(const k of ['mkdir','writeFile','appendFile','rename','unlink','rm','rmdir','link','symlink','copyFile','chmod','chown','truncate']){if(k in fsp)fsp[k]=negar;if(k in fs)fs[k]=negar;if(k+'Sync' in fs)fs[k+'Sync']=negar;}
for(const [obj,k] of [[fs,'open'],[fs,'openSync'],[fsp,'open']]){const original=obj[k].bind(obj);obj[k]=(...a)=>a[1]==='r'||a[1]===0?original(...a):negar();}
fs.createWriteStream=negar;net.connect=negar;net.createConnection=negar;net.Socket.prototype.connect=negar;tls.connect=negar;http.request=negar;http.get=negar;https.request=negar;https.get=negar;globalThis.fetch=negar;syncBuiltinESMExports();`);
});
after(async()=>{if(pasta){assert.ok(resolve(pasta).startsWith(resolve(base)+sep+'smoke-chat-cli-'));await rm(pasta,{recursive:true});}});

test('mantém o export público anterior sem embutir o executável de backup no núcleo',async()=>{
  assert.equal(pura,compativel);
  assert.equal(entradas.some(p=>p.endsWith('/backup-arquivos.mjs')),false);
  assert.ok(entradas.some(p=>p.endsWith('/storage-objeto.mjs')));
  assert.equal((await readFile(bundle,'utf8')).includes('BACKUP_ARQUIVOS_INTERROMPIDO'),false);
});
for(const modo of ['--sql','--sql-destino'])test(`bundle ${modo}: sai com zero, stderr vazio e sem efeitos externos`,async()=>{
  const antes=await readdir(pasta);
  const resultado=spawnSync(process.execPath,['--import',pathToFileURL(guarda).href,bundle,modo,janela,copia],{cwd:pasta,encoding:'utf8',timeout:15000,env:{...process.env,ATENDIMENTO_RAIZ_REMOTA_OPERACAO:'',ATENDIMENTO_ORIGEM_URL:'',ATENDIMENTO_ORIGEM_PUBLISHABLE_KEY:'',DATABASE_URL:''}});
  assert.equal(resultado.error,undefined);
  assert.equal(resultado.status,0,resultado.stderr);
  assert.equal(resultado.stderr,'');
  assert.ok(resultado.stdout.includes(janela)&&resultado.stdout.includes(copia));
  assert.match(resultado.stdout,/COMMIT;/);
  assert.match(resultado.stdout,modo==='--sql'?/BEGIN ISOLATION LEVEL REPEATABLE READ;/:/CREATE SCHEMA chat_minimo_22222222222242228222222222222222;/);
  assert.deepEqual(await readdir(pasta),antes);
});
