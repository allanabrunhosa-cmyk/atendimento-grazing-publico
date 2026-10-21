import {createHash} from 'node:crypto';
import {criarCifraBackup,recuperarPacoteR2} from './backup-r2';
import {criarRepositorioS3,type ConfiguracaoS3} from './repositorio-s3';

export type EntradaVerificacaoR2={backupExterno:ConfiguracaoS3;segredoTrabalho:string;referenciaInicialR2:{id:string;manifestoSha256:string;custodiaSha256:string}};
/** Releitura integral sem gravar os dados abertos, sem usar cache, Cloud ou banco.
 * Comprova integridade do ponto existente; nao cria backup das novas alteracoes,
 * nao renova a protecao por 90 dias e nao substitui a restauracao PostgreSQL.
 */
export async function verificarPontoR2(entrada:EntradaVerificacaoR2,criarRepo=criarRepositorioS3){
 const r=entrada.referenciaInicialR2;
 if(!/^[a-f0-9-]{36}$/.test(r.id)||!['manifestoSha256','custodiaSha256'].every(k=>/^[a-f0-9]{64}$/.test(r[k as 'manifestoSha256'|'custodiaSha256'])))throw Error('R2_VERIFICACAO_REFERENCIA_INVALIDA');
 const cifra=criarCifraBackup(entrada.segredoTrabalho);
 try{
  const custodia=await criarRepo({...entrada.backupExterno,prefixo:'donatella-v2'}).ler(`custodia/${r.id}.portatil.enc`,2*1024*1024);
  if(!custodia||createHash('sha256').update(custodia).digest('hex')!==r.custodiaSha256)throw Error('R2_VERIFICACAO_CUSTODIA_DIVERGENTE');
  // O cofre continua cifrado pela chave externa. A VPS nunca recebe essa chave.
  custodia.fill(0);
  const resultado=await recuperarPacoteR2({id:r.id,sha256:r.manifestoSha256,cifra,repositorio:criarRepo({...entrada.backupExterno,prefixo:'donatella-v2/inicial'}),receber:async()=>undefined});
  return {...resultado,pacote:r.id,custodiaCifradaConferida:true,cacheLocalUsado:false,novasAlteracoesProtegidasPorEstaVerificacao:false,restauracaoPostgreSQLExecutada:false,conferidoEm:new Date().toISOString()};
 }finally{cifra.fechar();}
}
