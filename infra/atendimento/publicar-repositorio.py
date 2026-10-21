"""Troca apenas código da operação existente. Não executa SQL nem restaura banco."""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time

APP = 'grazing-donatella-operacao-v2'
REPOSITORY = 'https://github.com/allanabrunhosa-cmyk/atendimento-grazing'
REPOSITORIES = {REPOSITORY, 'https://github.com/allanabrunhosa-cmyk/atendimento-grazing-publico'}

def require(ok, code):
    if not ok:
        raise RuntimeError('PUBLICACAO_REPOSITORIO_' + code)

def private_path(value, code):
    require(isinstance(value, str) and value and not any(c in value for c in '\r\n\0'), code)
    path = Path(value)
    require(path.is_absolute() and str(path) == value and '..' not in path.parts and path.parent != path, code)
    return path

def publication_targets(args, environment):
    root = private_path(args.raiz_remota or environment.get('ATENDIMENTO_RAIZ_REMOTA_OPERACAO'), 'RAIZ_PRIVADA_OBRIGATORIA')
    checkpoint_root = private_path(args.raiz_checkpoint or environment.get('ATENDIMENTO_RAIZ_CHECKPOINT_OPERACAO_R2'), 'RAIZ_CHECKPOINT_PRIVADA_OBRIGATORIA')
    locks = [
        private_path(args.lock_drive or environment.get('ATENDIMENTO_PUBLICACAO_LOCK_DRIVE'), 'LOCK_PRIVADO_OBRIGATORIO'),
        private_path(args.lock_checkpoint or environment.get('ATENDIMENTO_PUBLICACAO_LOCK_CHECKPOINT') or str(checkpoint_root / 'exclusao.lock'), 'LOCK_PRIVADO_OBRIGATORIO'),
    ]
    require(locks[1] == checkpoint_root / 'exclusao.lock' and len(set(locks)) == len(locks) and root / 'publicacao.lock' not in locks, 'LOCK_PRIVADO_DIVERGENTE')
    return root, locks

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def run(args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=90)
    require(result.returncode == 0, 'COMANDO_FALHOU')
    return result.stdout.strip()

def inventory(folder):
    result = {}
    for path in folder.rglob('*'):
        require(not path.is_symlink(), 'SYMLINK_RECUSADO')
        if path.is_file():
            result[path.relative_to(folder).as_posix()] = sha(path)
    return result

def inspect():
    return json.loads(run(['docker', 'inspect', APP]))[0]

def require_sending_flags(configuration, state):
    require(isinstance(configuration, dict), 'CONFIGURACAO_INVALIDA')
    if not (configuration.get('modo') == 'operacao' and configuration.get('autoridade') == 'vps' and configuration.get('enviosHabilitados') is True):
        return
    # A saúde HTTP não comprova que o transporte tem autoridade para enviar.
    # Não corrige flags nem exibe valores privados; exige a operação já coerente.
    environment = state.get('Config', {}).get('Env', [])
    require(isinstance(environment, list), 'ENVIO_FLAGS_DIVERGENTES')
    expected = {'ATENDIMENTO_ENVIO_HABILITADO': 'true', 'ATENDIMENTO_AUTORIDADE_ENVIO': 'vps'}
    for name, value in expected.items():
        values = [entry.split('=', 1)[1] for entry in environment if isinstance(entry, str) and entry.startswith(name + '=')]
        require(values == [value], 'ENVIO_FLAGS_DIVERGENTES')

def write_private(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')
    path.chmod(0o600)

def wait_health():
    for _ in range(45):
        state = inspect()
        if state['State']['Running'] and state['State'].get('Health', {}).get('Status') == 'healthy':
            return state
        time.sleep(2)
    raise RuntimeError('PUBLICACAO_REPOSITORIO_SAUDE_FALHOU')

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--raiz-remota')
    parser.add_argument('--raiz-checkpoint')
    parser.add_argument('--lock-drive')
    parser.add_argument('--lock-checkpoint')
    parser.add_argument('--candidata', required=True)
    parser.add_argument('--manifesto-anterior', required=True)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--aplicar', action='store_true')
    args = parser.parse_args()
    root, backup_locks = publication_targets(args, os.environ)
    require(re.fullmatch(r'[a-f0-9]{64}', args.manifesto_anterior) and re.fullmatch(r'[a-f0-9]{40}', args.commit), 'HASH_INVALIDO')
    candidate = Path(args.candidata)
    require(candidate.resolve() == candidate and candidate.parent == root / 'candidatas' and candidate.is_dir(), 'CAMINHO_RECUSADO')
    release = root / 'release'
    config = root / 'configuracao/operacao.json'
    compose = root / 'compose.operacao.yml'
    origin = root / 'publicacao-origem.json'
    manifest = json.loads((candidate / 'release.json').read_text())
    repository = manifest.get('repositorioOrigem')
    require(repository in REPOSITORIES and manifest['revisaoBase'] == args.commit, 'ORIGEM_INVALIDA')
    require(sha(candidate / 'operacao.mjs') == manifest['runtimeSha256'], 'RUNTIME_DIVERGENTE')
    require(inventory(candidate / 'web') == manifest['webArquivosSha256'], 'WEB_DIVERGENTE')
    require(sha(release / 'release.json') == args.manifesto_anterior, 'PUBLICACAO_PARALELA')
    before_state = inspect()
    require(before_state['State']['Running'] and before_state['State'].get('Health', {}).get('Status') == 'healthy', 'APP_NAO_SAUDAVEL')
    require(any(m['Destination'] == '/release' and m['Source'] == str(release) and not m['RW'] for m in before_state['Mounts']), 'MOUNT_DIVERGENTE')
    config_hash, compose_hash = sha(config), sha(compose)
    configuration = json.loads(config.read_text())
    require_sending_flags(configuration, before_state)
    if not args.aplicar:
        print(json.dumps({'verificado': True, 'repositorio': repository, 'commit': args.commit, 'sqlExecutado': False, 'configuracaoPreservada': True}))
        return
    locks = []
    try:
        for path in [root / 'publicacao.lock', *backup_locks]:
            require(path.parent.is_dir() and not path.is_symlink(), 'LOCK_RECUSADO')
            handle = path.open('a')
            locks.append(handle)
            os.fchmod(handle.fileno(), 0o600)
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        require(sha(release / 'release.json') == args.manifesto_anterior and sha(config) == config_hash and sha(compose) == compose_hash, 'PUBLICACAO_PARALELA')
        prior = root / 'releases-preservadas' / ('repositorio-' + args.commit)
        stage = root / ('release-repositorio-' + args.commit)
        require(not prior.exists() and not stage.exists(), 'DESTINO_EXISTENTE')
        old_inventory = inventory(release)
        shutil.copytree(release, stage)
        require(inventory(stage) == old_inventory, 'COPIA_DIVERGENTE')
        os.rename(stage / 'web', stage / ('web-preservada-' + args.commit[:12]))
        shutil.copytree(candidate / 'web', stage / 'web')
        shutil.copy2(candidate / 'operacao.mjs', stage / 'operacao.mjs')
        current = json.loads((release / 'release.json').read_text())
        current.update({'preparadaEm': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'repositorioOrigem': repository, 'revisaoBase': args.commit, 'ramo': 'main', 'runtimeSha256': manifest['runtimeSha256'], 'webArquivosSha256': manifest['webArquivosSha256'], 'publicacaoEscopo': 'separacao_repositorio_codigo', 'auxiliaresPreservadosDaRelease': {'manifestoSha256': args.manifesto_anterior, 'revisaoBase': current['revisaoBase']}})
        write_private(stage / 'release.json', current)
        prior.parent.mkdir(exist_ok=True)
        old_origin = origin.read_bytes() if origin.exists() else None
        os.rename(release, prior)
        try:
            os.rename(stage, release)
            # Reutiliza o contêiner, a imagem, redes, mounts e configuração existentes.
            # Não cria serviços, não executa migrations nem aciona mensagens.
            run(['docker', 'restart', '--time', '30', APP])
            state = wait_health()
            require(sha(config) == config_hash and sha(compose) == compose_hash, 'CONFIGURACAO_ALTERADA')
            require_sending_flags(configuration, state)
            write_private(origin, {'repositorio': repository, 'branch': 'main', 'commit': args.commit, 'comando': 'npm run publicar -- --aplicar', 'retornoCodigo': str(prior), 'bancoRestaurado': False})
            shutil.copy2(Path(__file__), root / 'publicar-repositorio.py')
            (root / 'publicar-repositorio.py').chmod(0o600)
        except Exception:
            rejected = root / ('release-recusada-repositorio-' + args.commit)
            if release.exists():
                os.rename(release, rejected)
            os.rename(prior, release)
            if old_origin is not None:
                origin.write_bytes(old_origin)
            elif origin.exists():
                origin.unlink()
            run(['docker', 'restart', '--time', '30', APP])
            wait_health()
            raise
        receipt = {'publicadoEm': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'repositorio': repository, 'commit': args.commit, 'runtimeSha256': sha(release / 'operacao.mjs'), 'manifestoSha256': sha(release / 'release.json'), 'retornoCodigo': str(prior), 'sqlExecutado': False, 'bancoRestaurado': False, 'configuracaoPreservada': sha(config) == config_hash, 'composePreservado': sha(compose) == compose_hash, 'containerId': state['Id'], 'saude': state['State']['Health']['Status']}
        write_private(candidate / 'publicacao.json', receipt)
        print(json.dumps(receipt))
    finally:
        for handle in reversed(locks):
            handle.close()

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Saídas de comandos ou detalhes privados não entram nos logs do cliente.
        print(json.dumps({'erro': str(error) if isinstance(error, RuntimeError) else type(error).__name__}))
        raise SystemExit(1)
