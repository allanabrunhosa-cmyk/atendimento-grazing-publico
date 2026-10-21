import {build} from 'esbuild';
import {mkdir,readFile,writeFile,copyFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import {validarRepositorioPublicacao} from './parametros-publicacao.mjs';
const repositorioOrigem=validarRepositorioPublicacao(execFileSync('git',['remote','get-url','origin'],{encoding:'utf8'}).trim());
const destino='.tmp-homologacao/operacao-release';
await mkdir(destino,{recursive:true});
// O modo operacional define as URLs /operacao/ e o diretório da própria
// release. Copiar um build de /consulta/ deixaria a tela dependente de outro
// serviço e de assets que não pertencem a esta revisão.
execFileSync(process.execPath,['node_modules/vite/bin/vite.js','build','--config','apps/atendimento-chat-consulta/vite.config.mts','--mode','operacao'],{stdio:['ignore','pipe','pipe']});
const webHtml=await readFile(destino+'/web/index.html','utf8');
if(!webHtml.includes('/operacao/assets/')||webHtml.includes('/consulta/assets/'))throw Error('INTERFACE_OPERACIONAL_BASE_INVALIDA');
// O login usa os componentes e o CSS oficiais do HUB. Renderização somente
// durante o build; React não se torna dependência do serviço privado da VPS.
const loginModulo='.tmp-homologacao/operacao-login-render.cjs';
await build({entryPoints:['scripts/atendimento/operacao-login.tsx'],outfile:loginModulo,bundle:true,packages:'external',alias:{'@':resolve('src')},platform:'node',target:'node22',format:'cjs',jsx:'automatic'});
const {loginHtml,loginJs,loginTemaCss}=createRequire(import.meta.url)(resolve(loginModulo));
const loginCssEntrada=resolve('scripts/atendimento/operacao-login.css');
const loginCss=await postcss([tailwindcss({base:process.cwd(),optimize:true})]).process(await readFile(loginCssEntrada,'utf8'),{from:loginCssEntrada,to:resolve(destino+'/web/login.css'),map:false});
const faviconSvg=await readFile('apps/atendimento-chat-consulta/favicon.svg','utf8');
const faviconLogin='<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,'+encodeURIComponent(faviconSvg)+'">';
await writeFile(destino+'/web/login.html',loginHtml().replace('</head>',faviconLogin+'</head>'));
await writeFile(destino+'/web/login.js',loginJs);
await writeFile(destino+'/web/login.css',loginTemaCss()+'\n'+loginCss.css);
const webArquivos={};
async function conferirWeb(pasta,relativo=''){
 for(const entrada of await readdir(pasta,{withFileTypes:true})){
  const nome=relativo+entrada.name;
  if(entrada.isDirectory())await conferirWeb(pasta+'/'+entrada.name,nome+'/');
  else if(entrada.isFile())webArquivos[nome]=createHash('sha256').update(await readFile(pasta+'/'+entrada.name)).digest('hex');
  else throw Error('INTERFACE_OPERACIONAL_ARQUIVO_RECUSADO');
 }
}
await conferirWeb(destino+'/web');
await build({entryPoints:['scripts/atendimento/operacao-runtime.ts'],outfile:destino+'/operacao.mjs',bundle:true,platform:'node',target:'node22',format:'esm',external:['pg'],plugins:[{name:'server-only-cli',setup(b){b.onResolve({filter:/^server-only$/},()=>({path:'server-only',namespace:'noop'}));b.onLoad({filter:/.*/,namespace:'noop'},()=>({contents:'',loader:'js'}));}}]});
await build({entryPoints:['scripts/atendimento/importar-woocommerce-automacoes.ts'],outfile:destino+'/importar-woocommerce-automacoes.mjs',bundle:true,platform:'node',target:'node22',format:'esm',external:['pg'],plugins:[{name:'server-only-cli',setup(b){b.onResolve({filter:/^server-only$/},()=>({path:'server-only',namespace:'noop'}));b.onLoad({filter:/.*/,namespace:'noop'},()=>({contents:'',loader:'js'}));}}]});
await build({entryPoints:['scripts/atendimento/configurar-agente-corte.ts'],outfile:destino+'/configurar-agente-corte.mjs',bundle:true,platform:'node',target:'node22',format:'esm',external:['pg'],plugins:[{name:'server-only-cli',setup(b){b.onResolve({filter:/^server-only$/},()=>({path:'server-only',namespace:'noop'}));b.onLoad({filter:/.*/,namespace:'noop'},()=>({contents:'',loader:'js'}));}}]});
await mkdir(destino+'/corte',{recursive:true});
for(const [entrada,nome] of [['copia-final-origem-cli.ts','copia-final-origem.mjs'],['manutencao-origem-cli.ts','manutencao-origem.mjs'],['importar-operacao-cli.ts','importar-operacao.mjs'],['verificar-prontidao-final-cli.ts','verificar-prontidao-final.mjs'],['chat-minimo-cli.ts','chat-minimo.mjs'],['provar-backup-chat-minimo-cli.ts','provar-backup-chat-minimo.mjs'],['emissores-chat-minimo-cli.ts','emissores-chat-minimo.mjs']]){
 await build({entryPoints:['scripts/atendimento/'+entrada],outfile:destino+'/corte/'+nome,bundle:true,packages:'external',platform:'node',target:'node22',format:'esm',plugins:[{name:'server-only-cli',setup(b){b.onResolve({filter:/^server-only$/},()=>({path:'server-only',namespace:'noop'}));b.onLoad({filter:/.*/,namespace:'noop'},()=>({contents:'',loader:'js'}));}}]});
}
await mkdir(destino+'/provas',{recursive:true});
await build({entryPoints:['testes/atendimento/receptor-isolado-banco.ts'],outfile:destino+'/provas/receptor-isolado.mjs',bundle:true,packages:'external',platform:'node',target:'node22',format:'esm',plugins:[{name:'server-only-cli',setup(b){b.onResolve({filter:/^server-only$/},()=>({path:'server-only',namespace:'noop'}));b.onLoad({filter:/.*/,namespace:'noop'},()=>({contents:'',loader:'js'}));}}]});
await mkdir(destino+'/sql',{recursive:true});
for(const [entrada,nome] of [['chat-minimo-banco.ts','chat-minimo-banco.mjs'],['operacao-banco.ts','operacao-banco.mjs'],['emissores-chat-minimo-banco.ts','emissores-chat-minimo-banco.mjs'],['contatos-templates-banco.ts','contatos-templates-banco.mjs']]){
 await build({entryPoints:['testes/atendimento/'+entrada],outfile:destino+'/provas/'+nome,bundle:true,packages:'external',platform:'node',target:'node22',format:'esm',plugins:[{name:'server-only-cli',setup(b){b.onResolve({filter:/^server-only$/},()=>({path:'server-only',namespace:'noop'}));b.onLoad({filter:/.*/,namespace:'noop'},()=>({contents:'',loader:'js'}));}}]});
}
const sqlSha256={};
for(const nome of await readdir('scripts/atendimento/sql')){
 if (/^(019|025|026|027|028|029|030|031|032|033|034|035|036|037|038|039)-.*\.sql$/.test(nome)){
  await copyFile('scripts/atendimento/sql/'+nome,destino+'/sql/'+nome);
  sqlSha256[nome]=createHash('sha256').update(await readFile(destino+'/sql/'+nome)).digest('hex');
 }
}
// O checkpoint já copia release/ recursivamente. Manter aqui também as
// ferramentas necessárias à recuperação/corte, sem colocar configurações.
await mkdir(destino+'/ferramentas',{recursive:true});
const ferramentas={};
for(const nome of ['controle-corte-programado.py','conferir-copia-final-programada.py','executar-copia-final-programada.sh','importar-operacao-final-programada.py','ensaiar-recuperacao-operacao-r2.py','ensaiar-receptor-isolado.py','verificar-prontidao-final-programada.py','importar-woocommerce-preservado.sh','preparar-acesso-importacao-woo.py','aplicar-operacao-destino.py','preparar-banco-operacao.py','controle-corte-minimo-chat.py','ensaiar-chat-minimo.py','provar-teste-real-chat-minimo.py','provar-emissores-chat-minimo.py','provar-retorno-chat-minimo.py','executar-nucleo-chat-minimo.py','instalar-candidata-chat-minimo.py']){
 await writeFile(destino+'/ferramentas/'+nome,(await readFile('infra/atendimento/'+nome,'utf8')).replaceAll('\r\n','\n'));
 ferramentas[nome]=createHash('sha256').update(await readFile(destino+'/ferramentas/'+nome)).digest('hex');
}
const sha=createHash('sha256').update(await readFile(destino+'/operacao.mjs')).digest('hex');
for(const [pasta,nome] of [['scripts/atendimento','conferir-exclusividade-chat-minimo.py'],['infra/atendimento','reunir-ensaio-chat-minimo.py']]){
 await writeFile(destino+'/ferramentas/'+nome,(await readFile(pasta+'/'+nome,'utf8')).replaceAll('\r\n','\n'));
 ferramentas[nome]=createHash('sha256').update(await readFile(destino+'/ferramentas/'+nome)).digest('hex');
}
const executaveisSha256={};
for(const nome of ['configurar-agente-corte.mjs','importar-woocommerce-automacoes.mjs','corte/copia-final-origem.mjs','corte/manutencao-origem.mjs','corte/importar-operacao.mjs','corte/verificar-prontidao-final.mjs','corte/chat-minimo.mjs','corte/provar-backup-chat-minimo.mjs','corte/emissores-chat-minimo.mjs','provas/receptor-isolado.mjs','provas/chat-minimo-banco.mjs','provas/operacao-banco.mjs','provas/emissores-chat-minimo-banco.mjs']){
 executaveisSha256[nome]=createHash('sha256').update(await readFile(destino+'/'+nome)).digest('hex');
}
await writeFile(destino+'/release.json',JSON.stringify({versao:1,preparadaEm:new Date().toISOString(),repositorioOrigem,revisaoBase:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),runtimeSha256:sha,sqlSha256,ferramentasSha256:ferramentas,executaveisSha256,webArquivosSha256:webArquivos,ramo:execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),enviosReaisHabilitados:false},null,2));
console.log(JSON.stringify({runtimeCompilado:true,sha256:sha,interfaceModoOperacional:true,arquivosWebConferidos:Object.keys(webArquivos).length,credenciaisIncluidas:false}));
