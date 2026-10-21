import { readFile, lstat, open } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { conferirEstado, ALVOS, type EstadoSincronizacao } from "./sincronizacao";
import { conferirIndicesCifrados } from "../../src/lib/atendimento/carga";
import { prisma } from "../../src/lib/prisma";
let fase="precondicoes";

async function executar() {
  if(process.argv.length!==2)throw new Error("ARGUMENTO_INVALIDO");
  const raiz=process.env.ATENDIMENTO_BACKUP_PRIVADO??"",execucao=process.env.ATENDIMENTO_EXECUCAO_CARGA??"";
  const estado=JSON.parse(await readFile(join(raiz,`sincronizacao-${execucao}.json`),"utf8")) as EstadoSincronizacao;
  conferirEstado(estado,execucao);
  if(!ALVOS.every(t=>estado.tabelas[t].fim))throw new Error("SNAPSHOT_INCOMPLETO");
  // Conferência consistente, somente leitura; não disputa com uma coleta ativa.
  try{await lstat(join(raiz,`sincronizacao-${execucao}.lock`));throw new Error("COLETA_EM_ANDAMENTO");}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
  const prova=await prisma.$transaction(async tx=>{
    fase="documentos";
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    let apos="00000000-0000-0000-0000-000000000000",documentos=0,snapshots=0,transacoes=0,eventos=0;
    const esperados=new Map<string,{seq:string;doc:string;indice:number;excluido:boolean}>();
    const referencias=new Map<string,Set<string>>();
    for(;;){
      // Hash dos bytes cifrados no PostgreSQL: evita retransmitir 211 MB só
      // para comparar a cópia que já existe fora da VPS. Plaintext permanece local.
      const grupo=await tx.$queryRaw<{id:string;hash:string;cifrado_hash:string;tipo:string}[]>`SELECT id,hash,encode(sha256(convert_to(cifrado,'UTF8')),'hex') AS cifrado_hash,tipo FROM atendimento_migracao.carga_documento WHERE execucao=${execucao}::uuid AND id>${apos}::uuid ORDER BY id LIMIT 50`;
      if(!grupo.length)break;
      for(const copia of grupo){
        const arquivo=join(raiz,execucao,`${copia.id}.json.enc`);
        if((await lstat(arquivo)).isSymbolicLink())throw new Error("ARQUIVO_INVALIDO");
        const local=JSON.parse(await readFile(arquivo,"utf8")) as {hash:string;cifrado:string};
        if(local.hash!==copia.hash||typeof local.cifrado!=="string"||createHash("sha256").update(local.cifrado).digest("hex")!==copia.cifrado_hash)throw new Error("DOCUMENTO_DIVERGENTE");
        const d=conferirIndicesCifrados(local.cifrado,copia.hash);
        if(d.id!==copia.id||d.execucao!==execucao||d.tipo!==copia.tipo)throw new Error("DOCUMENTO_DIVERGENTE");
        documentos++;
        referencias.set(d.id,new Set(d.estados.map(e=>`${e.schema}.${e.tabela}/${e.chaveHash}/${e.indice}`)));
        if(d.tipo==="snapshot")snapshots++;else{transacoes++;eventos+=d.quantidade;}
        for(const e of d.estados){
          const chave=`${e.schema}.${e.tabela}/${e.chaveHash}`,anterior=esperados.get(chave);
          // Snapshot sobreposto pode ter sequência zero em mais de uma página;
          // a referência efetiva é conferida diretamente abaixo. Deltas são únicos.
          if(!anterior||BigInt(e.sequencia)>BigInt(anterior.seq))esperados.set(chave,{seq:e.sequencia,doc:d.id,indice:e.indice,excluido:e.excluido});
          else if(e.sequencia!=="0"&&e.sequencia===anterior.seq&&d.id!==anterior.doc)throw new Error("FENCE_DIVERGENTE");
        }
      }
      apos=grupo.at(-1)!.id;
      console.log(JSON.stringify({conferencia:"documentos",conferidos:documentos}));
    }
    fase="indices";
    const registros=await tx.$queryRaw<{schema_name:string;table_name:string;chave_hash:string;sequencia:string;documento_id:string;indice:number;excluido:boolean}[]>`SELECT schema_name,table_name,chave_hash,sequencia::text,documento_id,indice,excluido FROM atendimento_migracao.carga_registro WHERE execucao=${execucao}::uuid`;
    if(registros.length!==esperados.size)throw new Error("INDICES_DIVERGENTES");
    const contagens:Record<string,number>=Object.fromEntries(ALVOS.map(t=>[t,0]));
    for(const r of registros){
      const alvo=`${r.schema_name}.${r.table_name}`,e=esperados.get(`${alvo}/${r.chave_hash}`);
      if(!e||e.seq!==r.sequencia||e.excluido!==r.excluido||(r.sequencia!=="0"&&(e.doc!==r.documento_id||e.indice!==r.indice)))throw new Error("INDICE_DIVERGENTE");
      // Conferir também a chave apontada pelo índice, inclusive snapshots zero.
      if(!referencias.get(r.documento_id)?.has(`${alvo}/${r.chave_hash}/${r.indice}`))throw new Error("REFERENCIA_DIVERGENTE");
      if(!r.excluido)contagens[alvo]++;
    }
    return{documentos,snapshots,transacoes,eventos,indices:registros.length,contagens,arquivoEBancoIguais:true,indicesEFencesConferidos:true};
  },{isolationLevel:"RepeatableRead",timeout:120_000});
  const arquivo=join(raiz,`conferencia-sincronizacao-${randomUUID()}.json`),f=await open(arquivo,"wx",0o600);
  try{await f.writeFile(JSON.stringify({instante:new Date().toISOString(),execucao,...prova,comparacaoIntegralAoVivo:false,backendOperacional:false}));await f.sync();}finally{await f.close();}
  console.log(JSON.stringify({...prova,comparacaoIntegralAoVivo:false,backendOperacional:false}));
}
void executar().catch((erro:unknown)=>{
  const e=erro as {message?:string;code?:string};
  console.error(JSON.stringify({falha:"CONFERENCIA_INTERROMPIDA",fase,
    codigo:typeof e.message==="string"&&/^[A-Z_]{3,80}$/.test(e.message)?e.message:null,
    banco:typeof e.code==="string"&&/^[A-Z0-9]{2,8}$/.test(e.code)?e.code:null,dadosReconciliados:false}));
  process.exitCode=1;
}).finally(()=>prisma.$disconnect());
