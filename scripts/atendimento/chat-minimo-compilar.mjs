import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
const pasta='.tmp-homologacao/chat-minimo';await mkdir(pasta,{recursive:true});
await build({entryPoints:['scripts/atendimento/chat-minimo-cli.ts'],outfile:pasta+'/chat-minimo.mjs',bundle:true,packages:'external',platform:'node',target:'node22',format:'esm'});
console.log(JSON.stringify({compilado:'chat-minimo.mjs',origemAlterada:false,enviosExternos:0}));
