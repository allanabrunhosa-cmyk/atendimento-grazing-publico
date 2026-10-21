import {build} from 'esbuild';
import {mkdir,copyFile} from 'node:fs/promises';
const destino='.tmp-homologacao/operacao-ensaio';
await mkdir(destino+'/scripts/atendimento/sql',{recursive:true});
await build({entryPoints:['testes/atendimento/operacao-banco.ts'],outfile:destino+'/operacao-banco.mjs',bundle:true,platform:'node',target:'node22',format:'esm',packages:'external',plugins:[{name:'servidor-cli',setup(b){b.onResolve({filter:/^server-only$/},()=>({path:'server-only',namespace:'noop'}));b.onLoad({filter:/.*/,namespace:'noop'},()=>({contents:'',loader:'js'}));}}]});
await build({entryPoints:['testes/atendimento/operacao-concorrencia-humana-banco.ts'],outfile:destino+'/operacao-concorrencia-humana-banco.mjs',bundle:true,platform:'node',target:'node22',format:'esm',packages:'external',plugins:[{name:'servidor-cli',setup(b){b.onResolve({filter:/^server-only$/},()=>({path:'server-only',namespace:'noop'}));b.onLoad({filter:/.*/,namespace:'noop'},()=>({contents:'',loader:'js'}));}}]});
await build({entryPoints:['testes/atendimento/modelos-formatos-operacional-banco.ts'],outfile:destino+'/modelos-formatos-operacional-banco.mjs',bundle:true,platform:'node',target:'node22',format:'esm',packages:'external',plugins:[{name:'servidor-cli',setup(b){b.onResolve({filter:/^server-only$/},()=>({path:'server-only',namespace:'noop'}));b.onLoad({filter:/.*/,namespace:'noop'},()=>({contents:'',loader:'js'}));}}]});
for(const nome of ['025-operacao-destino.sql','026-entrada-duravel-destino.sql'])await copyFile('scripts/atendimento/sql/'+nome,destino+'/scripts/atendimento/sql/'+nome);
console.log('Ensaio PostgreSQL do mesmo backend operacional compilado; sem dados ou credenciais reais.');
