import { createHash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';

const repositorios = new Set([
  'https://github.com/allanabrunhosa-cmyk/atendimento-grazing',
  'https://github.com/allanabrunhosa-cmyk/atendimento-grazing-publico',
]);

export function validarRepositorioPublicacao(entrada) {
  if (typeof entrada !== 'string') throw Error('REPOSITORIO_OFICIAL_EXIGIDO');
  const repositorio = entrada.replace(/\.git$/, '');
  if (!repositorios.has(repositorio)) throw Error('REPOSITORIO_OFICIAL_EXIGIDO');
  return repositorio;
}

export function lerParametrosPublicacao(argumentos, ambiente = process.env) {
  const valores = new Map();
  const permitidos = new Set(['--aplicar', '--chave', '--destino-ssh', '--raiz-remota', '--raiz-checkpoint', '--lock-drive', '--lock-checkpoint']);
  for (let i = 0; i < argumentos.length; i++) {
    const nome = argumentos[i];
    if (!permitidos.has(nome) || valores.has(nome)) throw Error('ARGUMENTO_INVALIDO');
    if (nome === '--aplicar') valores.set(nome, true);
    else {
      const valor = argumentos[++i];
      if (typeof valor !== 'string' || !valor.trim() || valor.startsWith('--')) throw Error('ARGUMENTO_OBRIGATORIO');
      valores.set(nome, valor);
    }
  }
  const identity = valores.get('--chave') ?? ambiente.ATENDIMENTO_SSH_CHAVE;
  const host = valores.get('--destino-ssh') ?? ambiente.ATENDIMENTO_SSH_DESTINO;
  const remoteRoot = valores.get('--raiz-remota') ?? ambiente.ATENDIMENTO_RAIZ_REMOTA_OPERACAO;
  const checkpointRoot = valores.get('--raiz-checkpoint') ?? ambiente.ATENDIMENTO_RAIZ_CHECKPOINT_OPERACAO_R2;
  const backupLockDrive = valores.get('--lock-drive') ?? ambiente.ATENDIMENTO_PUBLICACAO_LOCK_DRIVE;
  const backupLockCheckpoint = valores.get('--lock-checkpoint') ?? ambiente.ATENDIMENTO_PUBLICACAO_LOCK_CHECKPOINT ?? checkpointRoot + '/exclusao.lock';
  if (typeof identity !== 'string' || !identity.trim() || !isAbsolute(identity)) throw Error('SSH_CHAVE_PRIVADA_OBRIGATORIA');
  if (typeof host !== 'string' || host !== host.trim() || !/^[A-Za-z_][A-Za-z0-9_-]*@[A-Za-z0-9][A-Za-z0-9.-]*$/.test(host)) throw Error('SSH_DESTINO_PRIVADO_OBRIGATORIO');
  function caminhoRemoto(valor, codigo) {
    if (typeof valor !== 'string' || valor !== valor.trim() || !/^\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/.test(valor) || valor.split('/').some(p => p === '..' || p === '.')) throw Error(codigo);
    return valor;
  }
  caminhoRemoto(remoteRoot, 'RAIZ_REMOTA_PRIVADA_OBRIGATORIA');
  caminhoRemoto(checkpointRoot, 'RAIZ_CHECKPOINT_PRIVADA_OBRIGATORIA');
  caminhoRemoto(backupLockDrive, 'LOCK_BACKUP_PRIVADO_OBRIGATORIO');
  caminhoRemoto(backupLockCheckpoint, 'LOCK_BACKUP_PRIVADO_OBRIGATORIO');
  if (backupLockCheckpoint !== checkpointRoot + '/exclusao.lock' || backupLockDrive === backupLockCheckpoint || [backupLockDrive, backupLockCheckpoint].includes(remoteRoot + '/publicacao.lock')) throw Error('LOCK_BACKUP_PRIVADO_DIVERGENTE');
  const alvoSha256 = createHash('sha256').update([host, remoteRoot, backupLockDrive, backupLockCheckpoint].join('\n')).digest('hex');
  return { identity: resolve(identity), host, remoteRoot, checkpointRoot, backupLockDrive, backupLockCheckpoint, apply: valores.has('--aplicar'), alvoSha256 };
}
