// Execução manual privada: node --conditions=react-server --import tsx scripts/atendimento/coletar.ts
// Sem .env automático e sem loop/agendador; padrão é somente simulação.
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { coletarLote, coletarPagina, drenarColeta, type ConfiguracaoColeta } from "../../src/lib/atendimento/coleta";
import { persistirCarga, abrirCarga } from "../../src/lib/atendimento/carga";
import { arquivarCarga } from "../../src/lib/atendimento/arquivo-carga";
import { prisma } from "../../src/lib/prisma";

async function executar() {
  const argumentos=process.argv.slice(2);
  if (argumentos.some(a=>a!=="--aplicar" && !/^--snapshot=(public|auth|storage)\.[a-z_]+$/.test(a) && !/^--retomar=[a-f0-9-]{36}$/.test(a) && !/^--drenar=\d{1,2}$/.test(a))) throw new Error("ARGUMENTO_INVALIDO");
  const aplicar=argumentos.includes("--aplicar"); const execucao=process.env.ATENDIMENTO_EXECUCAO_CARGA ?? "";
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(execucao)) throw new Error("EXECUCAO_EXIGE_UUID_ESTAVEL");
  const diretorio=process.env.ATENDIMENTO_BACKUP_PRIVADO ?? "";
  if (aplicar && (!diretorio || !process.env.DATABASE_URL || process.env.ATENDIMENTO_BACKUP_EXTERNO_VERIFICADO!=="1")) throw new Error("DESTINO_E_BACKUP_NAO_COMPROVADOS");
  const config: ConfiguracaoColeta={execucao,origem:process.env.ATENDIMENTO_ORIGEM_URL??"",credencial:process.env.ATENDIMENTO_ORIGEM_SERVICE_ROLE_KEY||process.env.ATENDIMENTO_ORIGEM_PUBLISHABLE_KEY||"",tokenColetor:process.env.ATENDIMENTO_ORIGEM_COLETOR_TOKEN,capturaAprovada:process.env.ATENDIMENTO_CAPTURA_APROVADA==="1",simular:!aplicar};
  const destinos={arquivar:async (carga: Parameters<typeof arquivarCarga>[0])=>{await arquivarCarga(carga,diretorio,resolve(process.cwd()));},persistir:persistirCarga};
  const alvo=argumentos.find(a=>a.startsWith("--snapshot="))?.slice(11);
  const drenar=argumentos.filter(a=>a.startsWith("--drenar="));
  if(drenar.length){if(drenar.length!==1||alvo||argumentos.some(a=>a.startsWith("--retomar=")))throw new Error("ARGUMENTO_INVALIDO");console.log(JSON.stringify(await drenarColeta(config,destinos,Number(drenar[0].slice(9)))));return;}
  if (!alvo) { if (argumentos.some(a=>a.startsWith("--retomar="))) throw new Error("RETOMADA_EXIGE_SNAPSHOT"); console.log(JSON.stringify(await coletarLote(config,destinos))); return; }
  const [schema,tabela]=alvo.split("."); let apos: Record<string,unknown>|null=null;
  const retomar=argumentos.find(a=>a.startsWith("--retomar="))?.slice(10);
  if (retomar) {
    const arquivo=JSON.parse(await readFile(join(diretorio,execucao,`${retomar}.json.enc`),"utf8")) as {cifrado:string;hash:string};
    const anterior=abrirCarga(arquivo.cifrado,arquivo.hash);
    if (anterior.execucao!==execucao || anterior.id!==retomar || anterior.tipo!=="snapshot" || anterior.schema!==schema || anterior.tabela!==tabela) throw new Error("RETOMADA_DIVERGENTE");
    // Arquivo pode ter sido gravado antes de um reinício/rollback no destino.
    if (aplicar) await persistirCarga({documento:anterior,hash:arquivo.hash,cifrado:arquivo.cifrado,estados:[]});
    if (anterior.fim) { console.log(JSON.stringify({simulacao:!aplicar,fim:true,documento:retomar})); return; }
    apos=anterior.proxima;
  }
  const id=randomUUID(); const pagina=await coletarPagina(config,schema,tabela,apos,destinos,id);
  console.log(JSON.stringify({simulacao:!aplicar,registros:pagina.registros,fim:pagina.fim,documento:aplicar?id:null})); // Nunca imprimir cursor/registro/chave.
}
async function principal() {
  try { await executar(); }
  catch { console.error("COLETA_INTERROMPIDA: confira privadamente as pré-condições; nenhum payload/segredo é registrado aqui."); process.exitCode=1; }
  finally { await prisma.$disconnect(); }
}
void principal();
