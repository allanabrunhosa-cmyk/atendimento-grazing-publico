import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const raiz='.tmp-homologacao/copia-final';await mkdir(raiz,{recursive:true});
const plugins=[{name:'server-only-cli',setup(b){b.onResolve({filter:/^server-only$/},()=>({path:'server-only',namespace:'noop'}));b.onLoad({filter:/.*/,namespace:'noop'},()=>({contents:'',loader:'js'}));}}];
for(const [entrada,nome]of [['scripts/atendimento/copia-final-origem-cli.ts','copia-final-origem.mjs'],['scripts/atendimento/manutencao-origem-cli.ts','manutencao-origem.mjs'],['testes/atendimento/manutencao-origem-banco.ts','manutencao-origem-banco.mjs']])await build({entryPoints:[entrada],outfile:raiz+'/'+nome,bundle:true,packages:'external',platform:'node',target:'node22',format:'esm',plugins});
// Consulta legível já preparada; sua execução é somente leitura.
await writeFile('scripts/atendimento/sql/031-preflight-manutencao-origem-leitura.sql',execFileSync('node',[raiz+'/manutencao-origem.mjs','--preflight'],{encoding:'utf8'}));
console.log(JSON.stringify({compilada:'copia-final-manual',origemAlterada:false,segredosIncluidos:false}));
