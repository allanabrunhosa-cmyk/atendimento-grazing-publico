import { build as compilar } from 'esbuild';
import { build as compilarWeb } from 'vite';
import { mkdir } from 'node:fs/promises';
const destino='.tmp-homologacao/chat-consulta-release';
await mkdir(destino,{recursive:true});
await compilarWeb({configFile:'apps/atendimento-chat-consulta/vite.config.mts'});
await compilar({entryPoints:['scripts/atendimento/consulta-chat-servidor.ts'],outfile:`${destino}/chat-consulta.mjs`,bundle:true,platform:'node',target:'node22',format:'esm'});
console.log('Chat de consulta compilado em release isolada, sem dados, credenciais ou configurações privadas.');
