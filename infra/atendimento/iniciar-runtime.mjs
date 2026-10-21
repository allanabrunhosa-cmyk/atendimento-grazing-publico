import {readFile} from 'node:fs/promises';
const config=JSON.parse(await readFile('/run/secrets/coletor.json','utf8'));
for(const nome of ['DATABASE_URL','ATENDIMENTO_CARGA_SECRET'])process.env[nome]=config[nome];
await import('/release/runtime.mjs');
