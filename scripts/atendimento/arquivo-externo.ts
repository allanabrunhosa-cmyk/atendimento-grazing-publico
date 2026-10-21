import {criarRepositorioS3,type ConfiguracaoS3} from './repositorio-s3';
type Config=ConfiguracaoS3;
export function criarArquivoExterno(configuracao:Config|undefined,requisitar:typeof fetch=fetch){
 if(!configuracao)return null;
 const repositorio=criarRepositorioS3(configuracao,{requisitar});
 return async(chave:string,conteudo:Buffer)=>{
  if(!/^[a-f0-9-]{36}\/[a-f0-9-]{36}\.json\.enc$/.test(chave))throw Error('BACKUP_CHAVE_RECUSADA');
  await repositorio.preservar(chave,conteudo);
 };
}
