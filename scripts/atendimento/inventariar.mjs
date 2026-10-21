import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, relative } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

// Inventário estático: nunca conecta ao Cloud nem importa registros ou segredos.
export function inventariar(raiz) {
  const raizGit = execFileSync("git", ["-C", raiz, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  if (resolve(raizGit).toLowerCase() !== resolve(raiz).toLowerCase()) throw new Error("Informe o checkout independente da origem; a cópia não comprova a revisão original.");
  const ler = arquivo => readFileSync(resolve(raiz, arquivo), "utf8");
  const arquivos = [];
  function visitar(pasta) {
    for (const item of readdirSync(resolve(raiz, pasta), { withFileTypes: true })) {
      const arquivo = `${pasta}/${item.name}`;
      if (item.isSymbolicLink()) throw new Error("Referência simbólica não permitida no inventário.");
      if (item.isDirectory()) visitar(arquivo);
      else arquivos.push(arquivo);
    }
  }
  // Lista positiva; não percorre subprojetos/planilhas de terceiros, .env ou .git.
  for (const pasta of ["src", "public", "supabase/functions", "supabase/migrations", "drizzle/migrations"]) visitar(pasta);
  arquivos.sort();
  const tipos = ler("src/integrations/supabase/types.ts");
  const secao = (inicio, fim) => tipos.split(inicio)[1]?.split(fim)[0] ?? "";
  const nomes = texto => [...texto.matchAll(/^      ([a-z_]+): \{/gm)].map(item => item[1]);
  const textos = arquivos.filter(a => /\.(ts|tsx|sql)$/.test(a)).map(arquivo => ({ arquivo, texto: ler(arquivo) }));
  const usos = padrao => textos.flatMap(({ arquivo, texto }) => [...texto.matchAll(padrao)].map(m => ({ nome: m[1], arquivo })));
  return {
    revisao: execFileSync("git", ["-C", raiz, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    fonte: "https://github.com/gaabrielpereiira/sdrgrazing",
    natureza: "Referência de código; não comprova schema efetivo, uso ou volume em produção.",
    rotas: [...ler("src/App.tsx").matchAll(/<Route path="([^"]+)"/g)].map(m => m[1]),
    tabelas: nomes(secao("    Tables: {", "    Views: {")),
    views: nomes(secao("    Views: {", "    Functions: {")),
    rpcTipadas: nomes(secao("    Functions: {", "    Enums: {")),
    funcoesServidor: readdirSync(resolve(raiz, "supabase/functions"), { withFileTypes: true }).filter(i => i.isDirectory() && i.name !== "_shared").map(i => i.name).sort(),
    migrations: { supabase: arquivos.filter(a => a.startsWith("supabase/migrations/")), drizzle: arquivos.filter(a => a.startsWith("drizzle/migrations/") && a.endsWith(".sql")) },
    consultas: usos(/\.from\(['"]([a-z_]+)['"]\)/g),
    rpcsChamadas: usos(/\.rpc\(['"]([a-z_]+)['"]/g),
    funcoesChamadas: usos(/\.invoke\(['"]([a-z_-]+)['"]/g),
    realtime: usos(/table:\s*['"]([a-z_]+)['"]/g),
    nomesSegredos: usos(/Deno\.env\.get\(['"]([A-Z_]+)['"]\)/g),
    manifesto: arquivos.map(arquivo => ({ arquivo, sha256: createHash("sha256").update(readFileSync(resolve(raiz, arquivo))).digest("hex") })),
  };
}

if (process.argv[1] && relative(process.cwd(), process.argv[1]).replaceAll("\\", "/").endsWith("scripts/atendimento/inventariar.mjs")) {
  if (!process.argv[2]) throw new Error("Informe o caminho do checkout independente da origem.");
  const raiz = resolve(process.argv[2]);
  const destino = resolve(process.argv[3] ?? "docs/features/donatella-crm/INVENTARIO-CODIGO.json");
  mkdirSync(resolve(destino, ".."), { recursive: true });
  const inventario = inventariar(raiz);
  writeFileSync(destino, JSON.stringify(inventario, null, 2) + "\n");
  console.log(JSON.stringify({ revisao: inventario.revisao, rotas: inventario.rotas.length, tabelas: inventario.tabelas.length, views: inventario.views.length, funcoes: inventario.funcoesServidor.length, arquivos: inventario.manifesto.length }));
}
