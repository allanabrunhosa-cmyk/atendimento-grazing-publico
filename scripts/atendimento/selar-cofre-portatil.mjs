// Configuração/chave chegam exclusivamente por stdin privado, nunca por argumentos.
// Não abre o navegador nem envia dados. Recusa substituir arquivos existentes.
import { open, lstat, realpath, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, parse, join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { selarConfiguracao, recuperarConfiguracao } from './cofre-portatil.mjs';

async function executar() {
  if (process.argv.length !== 3 || !isAbsolute(process.argv[2])) throw new Error();
  const destino = resolve(process.argv[2]);
  let ancestral = dirname(destino);
  while (true) {
    if ((await lstat(ancestral)).isSymbolicLink()) throw new Error();
    if (await lstat(join(ancestral,'.git')).then(()=>true,erro=>{if(erro.code==='ENOENT')return false;throw erro;})) throw new Error();
    if (ancestral === parse(ancestral).root) break;
    ancestral = dirname(ancestral);
  }
  if ((await realpath(dirname(destino))).toLowerCase() !== dirname(destino).toLowerCase()) throw new Error();
  let tamanho = 0; const partes = [];
  try {
    for await (const parte of process.stdin) {
      tamanho += parte.length; if (tamanho > 2*1024*1024) throw new Error(); partes.push(parte);
    }
    const entrada = JSON.parse(Buffer.concat(partes).toString('utf8'));
    const chave = Buffer.from(entrada.chave,'base64');
    const conteudo = Buffer.from(entrada.conteudo,'base64');
    try {
      const arquivo = selarConfiguracao(conteudo,chave);
      const recuperado = recuperarConfiguracao(arquivo,chave);
      try { if (recuperado.length !== conteudo.length || !timingSafeEqual(recuperado,conteudo)) throw new Error(); }
      finally { recuperado.fill(0); }
      const saida = await open(destino,'wx',0o600);
      try { await saida.writeFile(arquivo,'utf8'); await saida.sync(); }
      finally { await saida.close(); }
      const persistido = recuperarConfiguracao(await readFile(destino,'utf8'),chave);
      try { if (persistido.length !== conteudo.length || !timingSafeEqual(persistido,conteudo)) throw new Error(); }
      finally { persistido.fill(0); }
      console.log('Cofre portátil cifrado e verificado sem DPAPI. Custódia externa da chave ainda precisa ser comprovada.');
    } finally { chave.fill(0); conteudo.fill(0); }
  } finally { for (const parte of partes) parte.fill(0); }
}
executar().catch(()=>{console.error('COFRE_PORTATIL_INTERROMPIDO: conferir privadamente arquivos e proteção; nenhum segredo registrado.');process.exitCode=1;});
