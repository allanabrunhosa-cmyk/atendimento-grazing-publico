import {build} from 'esbuild';
import {mkdir,copyFile} from 'node:fs/promises';
const raiz='.tmp-homologacao/importacao-operacao';
await mkdir(`${raiz}/scripts/atendimento/sql`,{recursive:true});
await build({entryPoints:['scripts/atendimento/importar-operacao-cli.ts'],outfile:`${raiz}/importar-operacao.mjs`,bundle:true,packages:'external',platform:'node',target:'node22',format:'esm'});
await build({entryPoints:['testes/atendimento/importacao-operacao-banco.ts'],outfile:`${raiz}/importacao-operacao-banco.mjs`,bundle:true,packages:'external',platform:'node',target:'node22',format:'esm'});
for(const nome of ['025-operacao-destino.sql','029-proveniencia-importacao-operacao.sql'])await copyFile(`scripts/atendimento/sql/${nome}`,`${raiz}/scripts/atendimento/sql/${nome}`);
console.log(JSON.stringify({compilado:'importacao-operacao',segredosIncluidos:false}));
