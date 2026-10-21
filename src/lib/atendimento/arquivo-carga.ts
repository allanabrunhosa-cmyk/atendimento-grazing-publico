import "server-only";
import { mkdir, lstat, open, readFile, link, unlink } from "node:fs/promises";
import { isAbsolute, resolve, join, dirname, relative } from "node:path";
import { randomUUID } from "node:crypto";
import { abrirCarga, serializarCarga, type CargaPreparada } from "./carga";

export async function arquivarCarga(carga: CargaPreparada, diretorio: string, repositorio: string) {
  if (serializarCarga(abrirCarga(carga.cifrado,carga.hash))!==serializarCarga(carga.documento)) throw new Error("CARGA_DIVERGENTE");
  if (!isAbsolute(diretorio)) throw new Error("BACKUP_EXIGE_CAMINHO_PRIVADO_ABSOLUTO");
  const raiz=resolve(diretorio); const rel=relative(resolve(repositorio),raiz);
  if (!rel || (!rel.startsWith("..") && !isAbsolute(rel))) throw new Error("BACKUP_NAO_PODE_FICAR_NO_REPOSITORIO");
  // Evitar seguir links para outro destino ou arquivar dados em uma pasta pública por engano.
  let ancestral=raiz;
  while (true) {
    try { const estado=await lstat(ancestral); if (estado.isSymbolicLink() || !estado.isDirectory()) throw new Error("DIRETORIO_BACKUP_INVALIDO"); }
    catch (erro) { if ((erro as NodeJS.ErrnoException).code !== "ENOENT") throw erro; }
    try { await lstat(join(ancestral,".git")); throw new Error("BACKUP_NAO_PODE_FICAR_NO_REPOSITORIO"); }
    catch (erro) { if ((erro as NodeJS.ErrnoException).code !== "ENOENT") throw erro; }
    if (dirname(ancestral)===ancestral) break; ancestral=dirname(ancestral);
  }
  await mkdir(raiz,{ recursive:true,mode:0o700 });
  const pasta=join(raiz,carga.documento.execucao); await mkdir(pasta,{mode:0o700,recursive:true});
  if ((await lstat(pasta)).isSymbolicLink()) throw new Error("DIRETORIO_BACKUP_INVALIDO");
  const destino=join(pasta,`${carga.documento.id}.json.enc`);
  const conferir = async () => {
    if ((await lstat(destino)).isSymbolicLink()) throw new Error("ARQUIVO_BACKUP_INVALIDO");
    const anterior=JSON.parse(await readFile(destino,"utf8")) as {hash:string;cifrado:string};
    const documento=abrirCarga(anterior.cifrado,anterior.hash);
    if (anterior.hash!==carga.hash || documento.id!==carga.documento.id || documento.execucao!==carga.documento.execucao) throw new Error("BACKUP_DIVERGENTE");
  };
  try { await conferir(); return; } catch (erro) { if ((erro as NodeJS.ErrnoException).code !== "ENOENT") throw erro; }
  const temporario=join(pasta,`.${randomUUID()}.parcial`);
  const arquivo=await open(temporario,"wx",0o600);
  try { await arquivo.writeFile(JSON.stringify({versao:2,hash:carga.hash,cifrado:carga.cifrado})); await arquivo.sync(); }
  finally { await arquivo.close(); }
  try {
    try { await link(temporario,destino); }
    catch (erro) { if ((erro as NodeJS.ErrnoException).code !== "EEXIST") throw erro; }
    await conferir();
    // Metadados duráveis em POSIX. Windows sincroniza os bytes pelo handle acima;
    // backup externo/retenção/restore são pré-condições distintas, ainda não demonstradas.
    if (process.platform !== "win32") { const dir=await open(pasta,"r"); try { await dir.sync(); } finally { await dir.close(); } }
  } finally { await unlink(temporario); }
}
