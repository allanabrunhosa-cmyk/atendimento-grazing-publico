import { readFile, open, rename, unlink, lstat, statfs } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as pausar } from "node:timers/promises";
import { estadoInicial, conferirEstado, sincronizar } from "./sincronizacao";
import { coletarLote, coletarPagina, type ConfiguracaoColeta } from "../../src/lib/atendimento/coleta";
import { arquivarCarga } from "../../src/lib/atendimento/arquivo-carga";
import { abrirCarga, persistirCarga, prepararCarga } from "../../src/lib/atendimento/carga";
import { prisma } from "../../src/lib/prisma";

async function executar() {
  const args=process.argv.slice(2);
  if (args.length!==1 || !/^--max-paginas=\d{1,3}$/.test(args[0])) throw new Error("LIMITE_EXPLICITO_EXIGIDO");
  const execucao=process.env.ATENDIMENTO_EXECUCAO_CARGA??"",raiz=process.env.ATENDIMENTO_BACKUP_PRIVADO??"";
  if (!raiz || !process.env.DATABASE_URL || process.env.ATENDIMENTO_BACKUP_EXTERNO_VERIFICADO!=="1" || process.env.ATENDIMENTO_CAPTURA_APROVADA!=="1") throw new Error("PRECONDICOES_NAO_COMPROVADAS");
  let estado=estadoInicial(execucao);
  const checkpoint=join(raiz,`sincronizacao-${execucao}.json`),lock=join(raiz,`sincronizacao-${execucao}.lock`);
  if ((await lstat(raiz)).isSymbolicLink()) throw new Error("DIRETORIO_INVALIDO");
  const exclusao=await open(lock,"wx",0o600); // Concorrência/lock órfão exigem conferência explícita.
  await exclusao.writeFile(JSON.stringify({pid:process.pid,instante:new Date().toISOString()}));await exclusao.sync();
  try {
    try { if ((await lstat(checkpoint)).isSymbolicLink()) throw new Error("RETOMADA_INVALIDA");estado=JSON.parse(await readFile(checkpoint,"utf8")); }
    catch (erro) { if ((erro as NodeJS.ErrnoException).code!=="ENOENT") throw erro; }
    conferirEstado(estado,execucao);
    const config:ConfiguracaoColeta={execucao,origem:process.env.ATENDIMENTO_ORIGEM_URL??"",credencial:process.env.ATENDIMENTO_ORIGEM_PUBLISHABLE_KEY??"",tokenColetor:process.env.ATENDIMENTO_ORIGEM_COLETOR_TOKEN,capturaAprovada:true,simular:false};
    const destinos={arquivar:async(c:Parameters<typeof arquivarCarga>[0])=>{await arquivarCarga(c,raiz,resolve(process.cwd()));},persistir:persistirCarga};
    const conferirEspaco=async()=>{const s=await statfs(raiz,{bigint:true});if(s.bavail*s.bsize<BigInt(256*1024*1024))throw new Error("ESPACO_PRIVADO_INSUFICIENTE");};
    const resumo=await sincronizar(estado,Number(args[0].split("=")[1]),{
      pagina:async(alvo,anterior)=>{
        await conferirEspaco();await pausar(500);
        const [schema,tabela]=alvo.split(".");let apos:Record<string,unknown>|null=null;
        if (anterior) {
          const arquivo=join(raiz,execucao,`${anterior}.json.enc`);
          if((await lstat(arquivo)).isSymbolicLink())throw new Error("RETOMADA_INVALIDA");
          const copia=JSON.parse(await readFile(arquivo,"utf8")) as {hash:string;cifrado:string};
          const d=abrirCarga(copia.cifrado,copia.hash);
          if(d.id!==anterior||d.execucao!==execucao||d.tipo!=="snapshot"||d.schema!==schema||d.tabela!==tabela||d.fim||!d.proxima)throw new Error("RETOMADA_DIVERGENTE");
          await persistirCarga(prepararCarga(d));apos=d.proxima;
        }
        const id=randomUUID(),pagina=await coletarPagina(config,schema,tabela,apos,destinos,id);
        return {documento:id,registros:pagina.registros,fim:pagina.fim};
      },
      lote:async()=>{await conferirEspaco();return coletarLote(config,destinos);},
      salvar:async(d)=>{
        const temporario=join(raiz,`.sincronizacao-${randomUUID()}.parcial`),f=await open(temporario,"wx",0o600);
        try{await f.writeFile(JSON.stringify(d));await f.sync();}finally{await f.close();}
        await rename(temporario,checkpoint);
      },
      progresso:(alvo,p)=>console.log(JSON.stringify({tabela:alvo,registros:p.registros,fim:p.fim})),
    });
    console.log(JSON.stringify({...resumo,preparacaoCifrada:true,backendOperacional:false}));
  } finally {await exclusao.close();await unlink(lock);}
}
void executar().catch((erro:unknown)=>{
  const e=erro as {message?:string;code?:string;http?:number;rpc?:string;name?:string};
  // Somente códigos técnicos fechados; jamais imprimir erros SQL/URLs/payloads.
  console.error(JSON.stringify({falha:"SINCRONIZACAO_INTERROMPIDA",
    codigo:typeof e.message==="string"&&/^[A-Z_]{3,80}$/.test(e.message)?e.message:null,
    banco:typeof e.code==="string"&&/^[A-Z0-9]{2,8}$/.test(e.code)?e.code:null,
    http:Number.isInteger(e.http)?e.http:null,rpc:["snapshot","ler_lote","confirmar"].includes(e.rpc??"")?e.rpc:null,
    timeout:e.name==="TimeoutError",documentosPreservados:true}));
  process.exitCode=1;
}).finally(()=>prisma.$disconnect());
