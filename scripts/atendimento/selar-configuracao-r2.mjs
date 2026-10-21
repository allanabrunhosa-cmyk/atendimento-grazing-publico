import { readFile } from 'node:fs/promises';
import { analisarConfiguracaoR2 } from './configuracao-r2.mjs';
import { selarConfiguracao, recuperarConfiguracao } from './cofre-portatil.mjs';
// Recebe chave e formulário exclusivamente pelo stdin. O arquivo é aberto com wx.
import { open, lstat, realpath } from 'node:fs/promises';
import { dirname, resolve, parse } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
let chave, conteudo;
try {
  const destino = resolve(process.argv[2] ?? '');
  if (process.argv.length !== 3 || !destino.endsWith('.portatil.enc')) throw Error('R2_DESTINO_PRIVADO_INVALIDO');
  let pasta = dirname(destino);
  const resolvido = await realpath(pasta);
  if ((process.platform === 'win32' ? resolvido.toLowerCase() !== pasta.toLowerCase() : resolvido !== pasta)) throw Error('R2_DESTINO_PRIVADO_INVALIDO');
  while (true) {
    try { await lstat(resolve(pasta, '.git')); throw Error('R2_DESTINO_NO_GIT'); } catch (erro) { if (erro.code !== 'ENOENT') throw erro; }
    if (pasta === parse(pasta).root) break;
    pasta = dirname(pasta);
  }
  const partes = []; let tamanho = 0;
  for await (const parte of process.stdin) { tamanho += parte.length; if (tamanho > 16384) throw Error('R2_ENTRADA_INVALIDA'); partes.push(parte); }
  const entrada = JSON.parse(Buffer.concat(partes).toString('utf8'));
  chave = Buffer.from(entrada.chave ?? '', 'base64');
  if (chave.length !== 32) throw Error('R2_CHAVE_INVALIDA');
  conteudo = Buffer.from(JSON.stringify({ ...analisarConfiguracaoR2(entrada.formulario), preservadoEm: new Date().toISOString() }));
  const cifrado = selarConfiguracao(conteudo, chave);
  const arquivo = await open(destino, 'wx', 0o600);
  try { await arquivo.writeFile(cifrado); await arquivo.sync(); } finally { await arquivo.close(); }
  const recuperado = recuperarConfiguracao(await readFile(destino, 'utf8'), chave);
  try { if (!timingSafeEqual(conteudo, recuperado)) throw Error('R2_RECUPERACAO_DIVERGENTE'); } finally { recuperado.fill(0); }
  process.stdout.write('R2_CONFIGURACAO_CIFRADA_E_RECUPERADA\n');
} catch (erro) { const codigo = erro?.message; process.stderr.write((/^R2_[A-Z_]+$/.test(codigo ?? '') ? codigo : 'R2_SELAGEM_RECUSADA_FORMULARIO_PRESERVADO')+'\n'); process.exitCode = 1; }
finally { chave?.fill(0); conteudo?.fill(0); }
