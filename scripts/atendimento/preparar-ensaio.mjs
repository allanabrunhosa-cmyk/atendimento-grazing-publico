import { build } from "esbuild";
import { mkdirSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
const destino = resolve(".tmp-ensaio-atendimento");
mkdirSync(destino, { recursive: true });
for (const arquivo of ["001-recebimento-destino.sql","002-captura-origem-proposta.sql","003-parar-captura-origem-proposta.sql","004-snapshot-origem-proposta.sql","005-carga-destino.sql","006-revogar-coletor-origem-proposta.sql"]) copyFileSync(resolve("scripts/atendimento/sql",arquivo),resolve(destino,arquivo));
await build({ entryPoints: ["testes/atendimento/ensaio-banco.ts"], outfile: resolve(destino,"ensaio.mjs"), bundle: true, platform: "node", target: "node22", format: "esm", external: ["pg"], alias: {
  "@/lib/prisma": resolve("testes/atendimento/prisma-ensaio.ts"),
  "@/lib/crypto": resolve("src/lib/crypto.ts"),
  "server-only": resolve("testes/atendimento/server-only-ensaio.ts"),
} });
console.log("Ensaio preparado: usa os módulos reais de recebimento, com adaptador SQL somente de teste.");
