import { build } from "esbuild";
import { mkdirSync,copyFileSync } from "node:fs";
import { resolve } from "node:path";
const destino=resolve(".tmp-compatibilidade-atendimento");
mkdirSync(destino,{recursive:true});
copyFileSync("testes/atendimento/compatibilidade-postgrest.sql",resolve(destino,"fixture.sql"));
await build({entryPoints:["testes/atendimento/compatibilidade-postgrest.ts"],outfile:resolve(destino,"ensaio.mjs"),bundle:true,platform:"node",target:"node22",format:"esm"});
console.log("Contrato preparado somente para banco fictício e endereço loopback.");
