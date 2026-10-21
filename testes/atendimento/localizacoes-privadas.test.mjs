import assert from 'node:assert/strict';
import {after,before,test} from 'node:test';
import {mkdtemp,mkdir,readdir,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=fileURLToPath(new URL('../..',import.meta.url));
const base=join(root,'.tmp-homologacao');
const bash=process.env.ATENDIMENTO_BASH_TESTE??(process.platform==='win32'?join(process.env.ProgramFiles??'C:/Program Files','Git/bin/bash.exe'):'/bin/bash');
const contracts=[
 ['infra/atendimento/gerar-checkpoint-r2.sh',[],['ATENDIMENTO_RAIZ_CHECKPOINT_R2','ATENDIMENTO_RAIZ_REMOTA_HOMOLOGACAO','ATENDIMENTO_CONFIG_CHECKPOINT_R2']],
 ['infra/atendimento/gerar-checkpoint-operacao-r2.sh',[],['ATENDIMENTO_RAIZ_CHECKPOINT_OPERACAO_R2','ATENDIMENTO_RAIZ_REMOTA_OPERACAO','ATENDIMENTO_CONFIG_CHECKPOINT_R2','ATENDIMENTO_RAIZ_REMOTA_HOMOLOGACAO']],
 ['infra/atendimento/executar-copia-final-programada.sh',['--executar-copia-final'],['ATENDIMENTO_RAIZ_REMOTA_OPERACAO','ATENDIMENTO_RELEASE_CONTROLE','ATENDIMENTO_RAIZ_REMOTA_HOMOLOGACAO','ATENDIMENTO_CONFIG_COLETOR','ATENDIMENTO_INDICE_MIDIA','ATENDIMENTO_MIDIA_ORIGEM']],
 ['infra/atendimento/importar-woocommerce-preservado.sh',['--importar-configuracao-preservada'],['ATENDIMENTO_RAIZ_REMOTA_OPERACAO']],
 ['scripts/atendimento/inspecionar-backup-nativo.sh',[],['ATENDIMENTO_RAIZ_RECUPERACAO']],
 ['scripts/atendimento/restaurar-backup-nativo-isolado.sh',[],['ATENDIMENTO_RAIZ_RECUPERACAO']],
 ['scripts/atendimento/restaurar-backup-nativo-isolado.sh',['--r2'],['ATENDIMENTO_RAIZ_RECUPERACAO_R2']],
];
let temporary;
before(async()=>{await mkdir(base,{recursive:true});temporary=await mkdtemp(join(base,'guards-privados-'));});
after(async()=>{if(temporary){assert.ok(resolve(temporary).startsWith(resolve(base)+sep+'guards-privados-'));await rm(temporary,{recursive:true});}});
function execute(file,args,variables,override){
 const env={...process.env,PATH:temporary};
 for(const name of Object.keys(env))if(name.startsWith('ATENDIMENTO_'))delete env[name];
 for(const name of variables)env[name]='/fixture/privado/'+name.toLowerCase();
 Object.assign(env,override);
 return spawnSync(bash,['--noprofile','--norc',join(root,file).replaceAll('\\','/'),...args],{cwd:temporary,env,encoding:'utf8',timeout:10000});
}
for(const [file,args,variables] of contracts){
 test(`${file} ${args.join(' ')} exige cada alvo antes de acessar arquivos ou executar ferramentas`,async()=>{
  for(const name of variables){
   const result=execute(file,args,variables,{[name]:''});
   assert.equal(result.error,undefined);
   assert.notEqual(result.status,0);
   assert.ok(result.stderr.includes(name+'_OBRIGATORIA'),result.stderr);
   assert.equal(result.stdout,'');
   assert.deepEqual(await readdir(temporary),[]);
  }
 });
 test(`${file} ${args.join(' ')} recusa caminho não canônico antes de operações`,async()=>{
  for(const value of ['relativo','/','/fixture/../cofre','/fixture/./cofre','/fixture//cofre','/fixture/cofre/','/fixture/cofre,extra','/fixture/cofre\n']){
   const result=execute(file,args,variables,{[variables[0]]:value});
   assert.equal(result.error,undefined);
   assert.notEqual(result.status,0);
   assert.match(result.stderr,/CAMINHO_PRIVADO_RECUSADO/);
   assert.equal(result.stdout,'');
   assert.deepEqual(await readdir(temporary),[]);
  }
 });
}
