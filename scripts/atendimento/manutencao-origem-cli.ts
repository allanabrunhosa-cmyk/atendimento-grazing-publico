import {readFile,mkdir,writeFile,lstat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {prepararManutencaoOrigem,sqlPreflightManutencao,type PreflightManutencao} from './manutencao-origem';
try{
 if(process.argv[2]==='--preflight'&&process.argv.length===3)console.log(sqlPreflightManutencao());
 else if(process.argv[2]==='--preparar'&&process.argv.length===5){
  const arquivo=resolve(process.argv[3]),pasta=resolve(process.argv[4]);if((await lstat(arquivo)).isSymbolicLink())throw Error('MANUTENCAO_CAMINHO_RECUSADO');
  const c=JSON.parse(await readFile(arquivo,'utf8')) as {preflight:PreflightManutencao;execucao:string};
  const p=prepararManutencaoOrigem(c.preflight,c.execucao);await mkdir(pasta,{recursive:true,mode:0o700});if((await lstat(pasta)).isSymbolicLink())throw Error('MANUTENCAO_CAMINHO_RECUSADO');
  // Exclusivos: repetição/confirmação desconhecida não substitui o pacote anterior.
  for(const [nome,texto] of [['MANUTENCAO-SEGUNDO-COMANDO.sql',p.sql],['CONFERIR-MANUTENCAO.sql',p.conferencia],['RETORNO-SOMENTE-APOS-DESARMAR-VPS.sql',p.retorno],['pacote-manutencao.json',JSON.stringify({versao:1,execucao:p.execucao,sqlFingerprint:p.sqlFingerprint,aplicada:false,emissoresSuspensos:false})]])await writeFile(join(pasta,nome),texto,{flag:'wx',mode:0o600});
  console.log(JSON.stringify({execucao:p.execucao,sqlFingerprint:p.sqlFingerprint,preparada:true,aplicada:false}));
 }else throw Error('MANUTENCAO_ARGUMENTO_RECUSADO');
}catch(e){console.error(e instanceof Error&&/^[A-Z0-9_]{1,80}$/.test(e.message)?e.message:'MANUTENCAO_PREPARACAO_INTERROMPIDA');process.exitCode=1;}
