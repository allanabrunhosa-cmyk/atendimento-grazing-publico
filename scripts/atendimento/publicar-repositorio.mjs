import {execFileSync} from 'node:child_process';
import {copyFileSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {lerParametrosPublicacao,validarRepositorioPublicacao} from './parametros-publicacao.mjs';
const root=resolve(fileURLToPath(new URL('../..',import.meta.url)));
process.chdir(root);
const {identity,host,remoteRoot,checkpointRoot,backupLockDrive,backupLockCheckpoint,apply,alvoSha256}=lerParametrosPublicacao(process.argv.slice(2));
const output=(tool,a)=>execFileSync(tool,a,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const official=validarRepositorioPublicacao(output('git',['remote','get-url','origin']));
if(output('git',['status','--porcelain']))throw Error('CHECKOUT_LIMPO_EXIGIDO');
const commit=output('git',['rev-parse','HEAD']);
if(output('git',['ls-remote','origin','refs/heads/main']).split(/\s+/)[0]!==commit)throw Error('REVISAO_PUBLICADA_NO_GITHUB_EXIGIDA');
const ssh=['-o','BatchMode=yes','-o','ConnectTimeout=15','-i',identity];
const proofFile=join(root,'.tmp-homologacao/publicacao-verificada.json');
let proof;
if(apply){
 try{proof=JSON.parse(readFileSync(proofFile,'utf8'));}catch{throw Error('PREPUBLICACAO_EXIGIDA');}
 if(proof.repositorio!==official||proof.alvoSha256!==alvoSha256||proof.commit!==commit||!Number.isFinite(Date.parse(proof.verificadaEm))||Date.now()-Date.parse(proof.verificadaEm)>3600000)throw Error('PREPUBLICACAO_ATUAL_EXIGIDA');
}
const prior=output('ssh',[...ssh,host,`sha256sum ${remoteRoot}/release/release.json`]).split(/\s+/)[0];
if(!/^[a-f0-9]{64}$/.test(prior))throw Error('MANIFESTO_ATIVO_INVALIDO');
if(apply&&proof.manifestoAnterior!==prior)throw Error('PUBLICACAO_PARALELA_REAVALIAR_ORIGEM');
execFileSync(process.execPath,['scripts/atendimento/compilar-operacao.mjs'],{stdio:'inherit'});
const release=join(root,'.tmp-homologacao/operacao-release');
const manifest=JSON.parse(readFileSync(join(release,'release.json'),'utf8'));
if(manifest.revisaoBase!==commit||manifest.repositorioOrigem!==official)throw Error('BUILD_DIVERGENTE');
copyFileSync('infra/atendimento/publicar-repositorio.py',join(release,'publicar-repositorio.py'));
const destination=`${remoteRoot}/candidatas/repositorio-${commit}-${Date.now()}`;
const archive=join(root,'.tmp-homologacao',`publicacao-${commit}.tar.gz`);
mkdirSync(join(root,'.tmp-homologacao'),{recursive:true});
execFileSync('tar',['-czf',archive,'-C',release,'operacao.mjs','web','release.json','publicar-repositorio.py']);
output('ssh',[...ssh,host,`umask 077; mkdir -p ${destination}`]);
output('scp',[...ssh,archive,`${host}:${destination}/pacote.tar.gz`]);
output('ssh',[...ssh,host,`tar -xzf ${destination}/pacote.tar.gz -C ${destination}`]);
const command=`python3 ${destination}/publicar-repositorio.py --raiz-remota ${remoteRoot} --raiz-checkpoint ${checkpointRoot} --lock-drive ${backupLockDrive} --lock-checkpoint ${backupLockCheckpoint} --candidata ${destination} --manifesto-anterior ${prior} --commit ${commit}${apply?' --aplicar':''}`;
let receipt;
try{receipt=JSON.parse(output('ssh',[...ssh,host,command]));}catch{throw Error('PUBLICACAO_INTERROMPIDA_CONFERIR_VPS');}
if(!apply)writeFileSync(proofFile,JSON.stringify({commit,repositorio:official,alvoSha256,manifestoAnterior:prior,verificadaEm:new Date().toISOString()}));
console.log(JSON.stringify(receipt));
