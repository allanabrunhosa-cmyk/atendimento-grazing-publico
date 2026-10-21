import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
const destino = ".tmp-homologacao/laboratorio-release";
await mkdir(`${destino}/web`, { recursive: true });
await build({ entryPoints: ["scripts/atendimento/laboratorio-servidor.ts"], outfile: `${destino}/laboratorio.mjs`, bundle: true, platform: "node", target: "node22", format: "esm", plugins: [{ name: "server-only-no-navegador", setup(b) { b.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "vazio" })); b.onLoad({ filter: /.*/, namespace: "vazio" }, () => ({ contents: "export {};" })); } }] });
for (const nome of ["index.html", "lab.js", "lab.css"]) await copyFile(`apps/atendimento/laboratorio/${nome}`, `${destino}/web/${nome}`);
console.log("Laboratório fictício compilado; nenhuma configuração privada ou credencial incorporada.");
