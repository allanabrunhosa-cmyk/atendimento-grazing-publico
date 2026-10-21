import {build} from 'esbuild';
import {mkdir,copyFile} from 'node:fs/promises';
const argumentos=process.argv.slice(2);
if(argumentos.length>1||(argumentos.length===1&&argumentos[0]!=='--somente-coletor'))throw Error('ESCOPO_COMPILACAO_INVALIDO');
const somenteColetor=argumentos[0]==='--somente-coletor';
const destino=somenteColetor?'.tmp-homologacao/release-coletor':'.tmp-homologacao/release';
await mkdir(destino,{recursive:true});
const entradas=[['scripts/atendimento/runtime.ts','runtime.mjs'],['scripts/atendimento/saude-coletor.ts','saude-coletor.mjs']];
if(!somenteColetor)entradas.push(['scripts/atendimento/consulta-servidor.ts','consulta.mjs']);
for(const [origem,nome]of entradas){
 await build({entryPoints:[origem],outfile:destino+'/'+nome,bundle:true,platform:'node',target:'node22',format:'esm',packages:'external',plugins:[{name:'servidor-cli',setup(b){b.onResolve({filter:/^server-only$/},()=>({path:'server-only',namespace:'noop'}));b.onLoad({filter:/.*/,namespace:'noop'},()=>({contents:'',loader:'js'}));}}]});
}
await copyFile('infra/atendimento/iniciar-runtime.mjs',destino+'/iniciar-runtime.mjs');
await copyFile('.tmp-homologacao/estrutura.json',destino+'/estrutura.json');
console.log(somenteColetor?'Coletor isolado compilado; serviço de consulta não recompilado.':'Serviços isolados compilados, sem configurações privadas no pacote.');
