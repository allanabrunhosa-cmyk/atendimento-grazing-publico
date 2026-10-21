import { build } from "esbuild";
import { mkdir } from "node:fs/promises";

const destino = ".tmp-homologacao/preview-release";
await mkdir(destino, { recursive: true });
await build({
  entryPoints: ["scripts/atendimento/preview-servidor.ts"],
  outfile: `${destino}/preview.mjs`, bundle: true, platform: "node", target: "node22", format: "esm",
});
console.log("Servidor da prévia compilado, sem configurações privadas ou serviços operacionais.");
