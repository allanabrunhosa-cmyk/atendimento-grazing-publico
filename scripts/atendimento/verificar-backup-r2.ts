import {readFile,mkdir,open,rename,lstat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {verificarPontoR2,type EntradaVerificacaoR2} from './verificacao-r2';
const estado='/estado/verificacao-r2';
process.umask(0o077);
async function gravar(nome:string,valor:unknown){
 const bytes=JSON.stringify(valor),parcial=estado+'/.'+randomUUID()+'.parcial';
 const f=await open(parcial,'wx',0o600);try{await f.writeFile(bytes);await f.sync();}finally{await f.close();}
 await rename(parcial,estado+'/'+nome);
 const d=await open(estado,'r');try{await d.sync();}finally{await d.close();}
}
try{
 if(process.argv.length!==2)throw Error('R2_VERIFICACAO_ARGUMENTO_INVALIDO');
 const arquivo='/run/secrets/verificador-r2.json',s=await lstat(arquivo);
 if(!s.isFile()||s.isSymbolicLink()||s.size>16384)throw Error('R2_VERIFICACAO_CONFIGURACAO_INVALIDA');
 const config=JSON.parse(await readFile(arquivo,'utf8')) as EntradaVerificacaoR2;
 const inicio=new Date().toISOString();await mkdir(estado,{recursive:true,mode:0o700});
 if((await lstat(estado)).isSymbolicLink())throw Error('R2_VERIFICACAO_ESTADO_INVALIDO');
 let anterior:Record<string,unknown>={};
 try{anterior=JSON.parse(await readFile(estado+'/atual.json','utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 await gravar('atual.json',{...anterior,verificacaoEmExecucao:true,inicioTentativa:inicio});
 try{
  const resultado=await verificarPontoR2(config);
  if(resultado.proveniencia!=='copia_real_preservada')throw Error('R2_VERIFICACAO_PONTO_FICTICIO_RECUSADO');
  const prova={...resultado,inicioTentativa:inicio,verificacaoEmExecucao:false,falha:null,ultimaVerificacaoBemSucedida:resultado.conferidoEm};
  const nome='verificacao-'+randomUUID()+'.json';await gravar(nome,prova);await gravar('atual.json',prova);
  console.log(JSON.stringify({pacote:resultado.pacote,arquivos:resultado.arquivos,bytes:resultado.bytes,verificadoEm:resultado.conferidoEm,novosBackupsCriados:false}));
 }catch(e){
  const codigo=(e as Error).message;
  await gravar('atual.json',{...anterior,inicioTentativa:inicio,verificacaoEmExecucao:false,falha:/^(R2|BACKUP)_[A-Z_]+$/.test(codigo)?codigo:'R2_VERIFICACAO_INTERROMPIDA',ultimaFalha:new Date().toISOString()});
  throw e;
 }
}catch(e){
 const codigo=(e as Error).message;console.error(/^(R2|BACKUP)_[A-Z_]+$/.test(codigo)?codigo:'R2_VERIFICACAO_INTERROMPIDA');process.exitCode=1;
}
