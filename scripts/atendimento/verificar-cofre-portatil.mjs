// Verificação independente: chave por stdin privado; não lê DPAPI nem salva plaintext.
import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { recuperarConfiguracao } from './cofre-portatil.mjs';
async function executar() {
  if (process.argv.length!==3 || !isAbsolute(process.argv[2])) throw new Error();
  let tamanho=0; const partes=[]; let chave, recuperado;
  try {
    for await (const parte of process.stdin) { tamanho+=parte.length; if(tamanho>256)throw new Error(); partes.push(parte); }
    const entrada=Buffer.concat(partes).toString('utf8').trim();
    if(!/^[a-fA-F0-9]{64}$/.test(entrada))throw new Error();
    chave=Buffer.from(entrada,'hex');
    recuperado=recuperarConfiguracao(await readFile(process.argv[2],'utf8'),chave);
    const config=JSON.parse(recuperado.toString('utf8'));
    if(typeof config.ATENDIMENTO_CARGA_SECRET!=='string' || !/^[a-f0-9]{64}$/.test(config.ATENDIMENTO_CARGA_SECRET) || typeof config.ATENDIMENTO_EXECUCAO_CARGA!=='string')throw new Error();
    console.log('RECUPERACAO_PORTATIL_VERIFICADA_SEM_DPAPI');
  } finally { chave?.fill(0); recuperado?.fill(0); for(const parte of partes)parte.fill(0); }
}
executar().catch(()=>{console.error('RECUPERACAO_PORTATIL_RECUSADA');process.exitCode=1;});
