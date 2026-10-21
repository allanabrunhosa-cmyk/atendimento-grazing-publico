import {createHash} from 'node:crypto';
import type {DocumentoCarga} from '../../src/lib/atendimento/carga';
import {versoesDaTransacao,type VersaoArquivo} from './arquivo-incremental';
import {criarPreservadorPacote,type ManifestoBackup} from './backup-r2';

export type MapaMidiaFinal={versao:1;tipo:'midia-copia-final-v1';execucao:string;t0:string;registros:{versao:VersaoArquivo;sha256:string;bytes:number;destino:string}[]};
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
export function versoesSnapshotFinal(d:DocumentoCarga){
 if(d.tipo!=='snapshot'||d.schema!=='storage'||d.tabela!=='objects')return [];
 return versoesDaTransacao({tipo:'transacao',execucao:d.execucao,id:d.id,eventos:d.registros.map((r,i)=>({sequencia:String(i+1),schema:'storage',tabela:'objects',operacao:'INSERT',chave_anterior:null,chave_posterior:r.chave,anterior:null,posterior:r.dados}))});
}
/** Pacote T0 próprio: inclusive versões reaproveitadas do CAS são preservadas
 * no R2. A retomada reutiliza partes cifradas; nenhuma releitura Cloud aqui.
 * Uma versão ausente interrompe a prova, nunca vira "arquivo conferido".
 */
export async function preservarMidiaFinal({execucao,t0,criadoEm,documentos,pacote,buscar,conferirAutorizacao}:{execucao:string;t0:string;criadoEm:string;documentos:AsyncIterable<DocumentoCarga>;pacote:ReturnType<typeof criarPreservadorPacote>;buscar:(v:VersaoArquivo)=>Promise<Buffer>;conferirAutorizacao:()=>Promise<void>}){
 const mapa:MapaMidiaFinal={versao:1,tipo:'midia-copia-final-v1',execucao,t0,registros:[]};
 const arquivos=new Map<string,ManifestoBackup['arquivos'][number]>(),identidades=new Set<string>();
 for await(const d of documentos)for(const v of versoesSnapshotFinal(d)){
  await conferirAutorizacao();
  if(identidades.has(v.identidade))throw Error('COPIA_FINAL_MIDIA_REPETIDA');
  identidades.add(v.identidade);
  const b=await buscar(v);
  try{
   if(b.length!==v.bytes)throw Error('COPIA_FINAL_MIDIA_DIVERGENTE');
   const digest=sha(b),destino='midia/'+digest+'.bin';
   if(!arquivos.has(destino))arquivos.set(destino,await pacote.adicionar(destino,b));
   mapa.registros.push({versao:v,sha256:digest,bytes:b.length,destino});
  }finally{b.fill(0);}
 }
 mapa.registros.sort((a,b)=>a.versao.identidade.localeCompare(b.versao.identidade));
 const b=Buffer.from(JSON.stringify(mapa));
 try{arquivos.set('mapa-final.json',await pacote.adicionar('mapa-final.json',b));}finally{b.fill(0);}
 await conferirAutorizacao();
 const referencia=await pacote.concluir({versao:1,id:execucao,criadoEm,proveniencia:'copia_real_preservada',arquivos:[...arquivos.values()].sort((a,b)=>a.destino.localeCompare(b.destino))});
 return {prefixo:'donatella-v2/arquivos',...referencia,referencias:mapa.registros.length,conteudos:arquivos.size-1};
}
