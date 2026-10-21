import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { lerParametrosPublicacao, validarRepositorioPublicacao } from './parametros-publicacao.mjs';

const ambiente = {
  ATENDIMENTO_SSH_CHAVE: resolve('chave-ficticia'),
  ATENDIMENTO_SSH_DESTINO: 'operador@servidor.example.invalid',
  ATENDIMENTO_RAIZ_REMOTA_OPERACAO: '/srv/aplicacao-ficticia',
  ATENDIMENTO_RAIZ_CHECKPOINT_OPERACAO_R2: '/srv/checkpoints-ficticios',
  ATENDIMENTO_PUBLICACAO_LOCK_DRIVE: '/srv/backups-ficticios/drive.lock',
  ATENDIMENTO_PUBLICACAO_LOCK_CHECKPOINT: '/srv/checkpoints-ficticios/exclusao.lock',
};

test('aceita somente os dois repositórios autorizados e informa a origem efetiva', () => {
  for (const repositorio of ['https://github.com/allanabrunhosa-cmyk/atendimento-grazing', 'https://github.com/allanabrunhosa-cmyk/atendimento-grazing-publico']) {
    assert.equal(validarRepositorioPublicacao(repositorio), repositorio);
    assert.equal(validarRepositorioPublicacao(repositorio + '.git'), repositorio);
  }
  for (const repositorio of ['https://github.com/exemplo/outro', 'https://github.com/allanabrunhosa-cmyk/atendimento-grazing-publico-falso', 'https://credencial-ficticia@github.com/allanabrunhosa-cmyk/atendimento-grazing', undefined]) assert.throws(() => validarRepositorioPublicacao(repositorio), /REPOSITORIO_OFICIAL_EXIGIDO/);
});

test('recusa publicação sem parâmetros privados antes de qualquer operação', () => {
  assert.throws(() => lerParametrosPublicacao([], {}), /SSH_CHAVE_PRIVADA_OBRIGATORIA/);
  assert.throws(() => lerParametrosPublicacao([], { ATENDIMENTO_SSH_CHAVE: ambiente.ATENDIMENTO_SSH_CHAVE }), /SSH_DESTINO_PRIVADO_OBRIGATORIO/);
  assert.throws(() => lerParametrosPublicacao([], { ...ambiente, ATENDIMENTO_RAIZ_REMOTA_OPERACAO: undefined }), /RAIZ_REMOTA_PRIVADA_OBRIGATORIA/);
  assert.throws(() => lerParametrosPublicacao([], { ...ambiente, ATENDIMENTO_RAIZ_CHECKPOINT_OPERACAO_R2: undefined }), /RAIZ_CHECKPOINT_PRIVADA_OBRIGATORIA/);
  assert.throws(() => lerParametrosPublicacao([], { ...ambiente, ATENDIMENTO_PUBLICACAO_LOCK_DRIVE: undefined }), /LOCK_BACKUP_PRIVADO_OBRIGATORIO/);
  assert.throws(() => lerParametrosPublicacao([], { ...ambiente, ATENDIMENTO_PUBLICACAO_LOCK_CHECKPOINT: ambiente.ATENDIMENTO_PUBLICACAO_LOCK_DRIVE }), /LOCK_BACKUP_PRIVADO_DIVERGENTE/);
  assert.throws(() => lerParametrosPublicacao([], { ...ambiente, ATENDIMENTO_PUBLICACAO_LOCK_DRIVE: ambiente.ATENDIMENTO_RAIZ_REMOTA_OPERACAO + '/publicacao.lock' }), /LOCK_BACKUP_PRIVADO_DIVERGENTE/);
});

test('usa a base do checkpoint e recusa aliases válidos que apontem a outro lock', () => {
  const semAlias = { ...ambiente, ATENDIMENTO_PUBLICACAO_LOCK_CHECKPOINT: undefined };
  const parametros = lerParametrosPublicacao([], semAlias);
  assert.equal(parametros.backupLockCheckpoint, ambiente.ATENDIMENTO_RAIZ_CHECKPOINT_OPERACAO_R2 + '/exclusao.lock');
  assert.equal(lerParametrosPublicacao(['--lock-checkpoint', parametros.backupLockCheckpoint], semAlias).backupLockCheckpoint, parametros.backupLockCheckpoint);
  for (const divergente of ['/srv/outro-checkpoint/exclusao.lock', '/srv/checkpoints-ficticios/outro.lock']) {
    assert.throws(() => lerParametrosPublicacao(['--lock-checkpoint', divergente], semAlias), /LOCK_BACKUP_PRIVADO_DIVERGENTE/);
    assert.throws(() => lerParametrosPublicacao([], { ...semAlias, ATENDIMENTO_PUBLICACAO_LOCK_CHECKPOINT: divergente }), /LOCK_BACKUP_PRIVADO_DIVERGENTE/);
  }
  const outro = lerParametrosPublicacao(['--raiz-checkpoint', '/srv/segundo-checkpoint'], semAlias);
  assert.equal(outro.backupLockCheckpoint, '/srv/segundo-checkpoint/exclusao.lock');
  assert.notEqual(outro.alvoSha256, parametros.alvoSha256);
});

test('wrapper recusa lock divergente antes de SSH, Git ou operações em arquivos', () => {
  const guarda = 'data:text/javascript,' + encodeURIComponent(`
import fs from 'node:fs';import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';import {dirname,join,resolve} from 'node:path';import {fileURLToPath} from 'node:url';
const negar=()=>{throw Error('PARAMETROS_EFEITO_EXTERNO_RECUSADO')};
// O loader pode ler somente os dois módulos públicos sob teste.
const permitidos=new Set([resolve(process.argv[1]),join(dirname(resolve(process.argv[1])),'parametros-publicacao.mjs')]),ler=fs.readFileSync;
fs.readFileSync=(p,...args)=>permitidos.has(resolve(p instanceof URL?fileURLToPath(p):String(p)))?ler(p,...args):negar();
for(const nome of ['copyFileSync','mkdirSync','writeFileSync'])fs[nome]=negar;cp.execFileSync=negar;syncBuiltinESMExports();`);
  for (const argumentos of [[], ['--lock-checkpoint', '/srv/outro-checkpoint/exclusao.lock']]) {
    const resultado = spawnSync(process.execPath, ['--import', guarda, fileURLToPath(new URL('./publicar-repositorio.mjs', import.meta.url)), ...argumentos], { encoding: 'utf8', timeout: 10000, env: { ...process.env, ...ambiente, ATENDIMENTO_PUBLICACAO_LOCK_CHECKPOINT: '/srv/terceiro-checkpoint/exclusao.lock', NODE_OPTIONS: '' } });
    assert.equal(resultado.error, undefined);
    assert.notEqual(resultado.status, 0);
    assert.match(resultado.stderr, /LOCK_BACKUP_PRIVADO_DIVERGENTE/);
    assert.equal(resultado.stderr.includes('PARAMETROS_EFEITO_EXTERNO_RECUSADO'), false);
    assert.equal(resultado.stdout, '');
  }
});

test('aceita configuração privada explícita e parâmetro prevalece sobre ambiente', () => {
  const inicial = lerParametrosPublicacao([], ambiente);
  assert.equal(inicial.apply, false);
  assert.equal(inicial.host, ambiente.ATENDIMENTO_SSH_DESTINO);
  const aplicado = lerParametrosPublicacao(['--aplicar', '--destino-ssh', 'revisor@outro.example.invalid', '--chave', resolve('outra-chave-ficticia'), '--raiz-remota', '/srv/outra-aplicacao'], ambiente);
  assert.equal(aplicado.apply, true);
  assert.equal(aplicado.host, 'revisor@outro.example.invalid');
  assert.equal(aplicado.identity, resolve('outra-chave-ficticia'));
  assert.equal(aplicado.remoteRoot, '/srv/outra-aplicacao');
  assert.notEqual(aplicado.alvoSha256, inicial.alvoSha256);
  assert.equal(lerParametrosPublicacao([], ambiente).alvoSha256, inicial.alvoSha256);
  assert.notEqual(lerParametrosPublicacao(['--lock-drive', '/srv/outro-backup/drive.lock'], ambiente).alvoSha256, inicial.alvoSha256);
});

test('recusa opções duplicadas, argumentos incompletos e alvos que alteram o comando remoto', () => {
  for (const argumentos of [['--aplicar', '--aplicar'], ['--chave'], ['--desconhecido'], ['--chave', '--aplicar']]) assert.throws(() => lerParametrosPublicacao(argumentos, ambiente));
  for (const host of ['-oProxyCommand=exemplo', 'operador@host;comando', 'operador@host\ncomando', 'operador@host\n']) assert.throws(() => lerParametrosPublicacao([], { ...ambiente, ATENDIMENTO_SSH_DESTINO: host }), /SSH_DESTINO_PRIVADO_OBRIGATORIO/);
  for (const raiz of ['/srv/../outra', '/srv/./outra', '/srv/aplicacao;comando', '/srv/aplicacao com espaco', '/srv/aplicacao\n']) assert.throws(() => lerParametrosPublicacao([], { ...ambiente, ATENDIMENTO_RAIZ_REMOTA_OPERACAO: raiz }), /RAIZ_REMOTA_PRIVADA_OBRIGATORIA/);
  assert.throws(() => lerParametrosPublicacao([], { ...ambiente, ATENDIMENTO_SSH_CHAVE: 'chave-relativa' }), /SSH_CHAVE_PRIVADA_OBRIGATORIA/);
});
