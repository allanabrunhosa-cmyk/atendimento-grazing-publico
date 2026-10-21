import {build} from 'esbuild';
import {mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';
const destino='.tmp-homologacao/agente-ensaio';
await mkdir(destino+'/scripts/atendimento/sql',{recursive:true});
await build({entryPoints:['testes/atendimento/agente-operacional-banco.ts'],outfile:destino+'/agente-operacional-banco.mjs',bundle:true,platform:'node',target:'node22',format:'esm',packages:'external',plugins:[{name:'servidor-cli',setup(b){b.onResolve({filter:/^server-only$/},()=>({path:'server-only',namespace:'noop'}));b.onLoad({filter:/.*/,namespace:'noop'},()=>({contents:'',loader:'js'}));}}]});
await build({entryPoints:['scripts/atendimento/importar-agente-legado.ts'],outfile:destino+'/importar-agente-legado.mjs',bundle:true,platform:'node',target:'node22',format:'esm',packages:'external'});
for(const [entrada,nome] of [['testes/atendimento/followup-operacional-banco.ts','followup-operacional-banco'],['testes/atendimento/alerta-apoio-operacional-banco.ts','alerta-apoio-operacional-banco'],['testes/atendimento/modelos-meta-operacional-banco.ts','modelos-meta-operacional-banco'],['testes/atendimento/tomada-duvidas-agente-banco.ts','tomada-duvidas-agente-banco'],['testes/atendimento/woocommerce-automacoes-banco.ts','woocommerce-automacoes-banco'],['scripts/atendimento/importar-woocommerce-automacoes.ts','importar-woocommerce-automacoes'],['scripts/atendimento/importar-modelos-meta.ts','importar-modelos-meta'],['scripts/atendimento/configurar-agente-corte.ts','configurar-agente-corte']])await build({entryPoints:[entrada],outfile:destino+'/'+nome+'.mjs',bundle:true,platform:'node',target:'node22',format:'esm',external:['pg'],plugins:[{name:'servidor-cli',setup(b){b.onResolve({filter:/^server-only$/},()=>({path:'server-only',namespace:'noop'}));b.onLoad({filter:/.*/,namespace:'noop'},()=>({contents:'',loader:'js'}));}}]});
await copyFile('scripts/atendimento/sql/027-agente-operacional.sql',destino+'/scripts/atendimento/sql/027-agente-operacional.sql');
await copyFile('scripts/atendimento/sql/030-followup-operacional.sql',destino+'/scripts/atendimento/sql/030-followup-operacional.sql');
await copyFile('scripts/atendimento/sql/032-alerta-apoio-operacional.sql',destino+'/scripts/atendimento/sql/032-alerta-apoio-operacional.sql');
await copyFile('scripts/atendimento/sql/033-woocommerce-automacoes-operacionais.sql',destino+'/scripts/atendimento/sql/033-woocommerce-automacoes-operacionais.sql');
await copyFile('scripts/atendimento/sql/034-woocommerce-crm-baseline.sql',destino+'/scripts/atendimento/sql/034-woocommerce-crm-baseline.sql');
const origem=await readFile('scripts/atendimento/sql/019-duvidas-aprendizagem-destino.sql','utf8');
const guard="('donatella_operacao','donatella_ensaio_duvidas')";
if(!origem.includes(guard))throw Error('GUARD_ENSAIO_DUVIDAS_DIVERGENTE');
// A SQL aplicada permanece intacta. Apenas a cópia de ensaio inclui o banco
// fictício dedicado onde o mesmo serviço operacional será exercitado.
await writeFile(destino+'/scripts/atendimento/sql/019-duvidas-aprendizagem-ensaio.sql',origem.replace(guard,"('donatella_ensaio_operacao')"));
console.log('Ensaio do agente compilado com PostgreSQL real e fornecedores fictícios; nenhum segredo incluído.');
