import {createHash} from 'node:crypto';
import {extrairCheckpointOperacaoR2} from './checkpoint-operacao-r2';
import {criarRepositorioS3,type ConfiguracaoS3} from './repositorio-s3';
import type {EntradaVerificacaoR2} from './verificacao-r2';

const prefixo='donatella-v2/incrementais/operacao';
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
type Repo=ReturnType<typeof criarRepositorioS3>;
export type ContextoProvaChat={janelaId:string;runtimeSha256:string;manifestoSha256:string};
/** Somente GET. A prova nasce depois de recuperar e autenticar todo o pacote
 * externo existente, incluindo entrada separada, configuração e arquivos.
 * Não cria checkpoint, não restaura banco, não lê chave mestra e não envia. */
export async function provarBackupEntradaChat(entrada:EntradaVerificacaoR2,id:string,digest:string,contexto:ContextoProvaChat,
  criarRepo:(c:ConfiguracaoS3)=>Repo=criarRepositorioS3){
 if(!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(contexto.janelaId)||
   ![contexto.runtimeSha256,contexto.manifestoSha256].every(s=>/^[a-f0-9]{64}$/.test(s)))throw Error('CHAT_MINIMO_CONTEXTO_RECUSADO');
 const artefatos=new Map<string,{chave:string;sha256:string;sha256Lido:string;bytes:number;bytesLidos:number}>();
 let criadoEm:string|undefined;
 const resultado=await extrairCheckpointOperacaoR2(entrada,id,digest,async(nome,b)=>{
  if(nome==='operacao.json'){
   const p=JSON.parse(b.toString());
   if(p.id!==id||p.banco!=='donatella_operacao'||p.bancoEntrada!=='donatella_entrada'||p.proveniencia!=='copia_real_preservada'
      ||typeof p.criadoEm!=='string'||!Number.isFinite(Date.parse(p.criadoEm))||Date.parse(p.criadoEm)>Date.now())throw Error('CHAT_MINIMO_CHECKPOINT_FORA_ESCOPO');
   criadoEm=p.criadoEm;
  }
 },c=>{
  if(c.prefixo!==prefixo)throw Error('CHAT_MINIMO_CHECKPOINT_FORA_ESCOPO');
  const repo=criarRepo(c);
  return {preservar:async()=>{throw Error('CHAT_MINIMO_PROVA_SOMENTE_LEITURA');},ler:async(chave,limite)=>{
   const b=await repo.ler(chave,limite);
   if(b){const hash=sha(b),completa=prefixo+'/'+chave,anterior=artefatos.get(completa);
    if(anterior&&(anterior.sha256!==hash||anterior.bytes!==b.length))throw Error('CHAT_MINIMO_R2_ALTERADO_DURANTE_PROVA');
    artefatos.set(completa,{chave:completa,sha256:hash,sha256Lido:hash,bytes:b.length,bytesLidos:b.length});}
   return b;
  }};
 });
 if(!criadoEm||!resultado.coberturaEntrada||resultado.banco!=='donatella_operacao'||resultado.bancoEntrada!=='donatella_entrada'
    ||resultado.proveniencia!=='copia_real_preservada'||!artefatos.size)throw Error('CHAT_MINIMO_CHECKPOINT_FORA_ESCOPO');
 return {versao:1,tipo:'backup-entrada-chat-minimo-verificado-v1',...contexto,concluidoEm:new Date().toISOString(),criadoEm,
  bancoEntrada:'donatella_entrada',bancoOperacao:'donatella_operacao',checkpointId:id,manifestoCheckpointSha256:digest,
  origemUsada:false,cacheLocalUsado:false,restauracaoRealComprovada:false,
  r2:{releituraIntegral:true,artefatos:[...artefatos.values()].sort((a,b)=>a.chave.localeCompare(b.chave)),pendencias:0,divergencias:0}};
}
