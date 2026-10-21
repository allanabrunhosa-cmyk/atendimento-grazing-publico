import { build } from "esbuild";
await build({ entryPoints: ["scripts/atendimento/avaliar-orquestrador.ts"], outfile: ".tmp-homologacao/avaliar-orquestrador.mjs", bundle: true, platform: "node", target: "node22", format: "esm", plugins: [{ name: "server-only-ensaio", setup(b) { b.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "ensaio" })); b.onLoad({ filter: /.*/, namespace: "ensaio" }, () => ({ contents: "", loader: "js" })); } }] });
console.log("Ensaio do orquestrador compilado; apenas dados e provedores fictícios.");
