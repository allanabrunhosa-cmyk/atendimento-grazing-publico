#!/usr/bin/env python3
"""Prova fictícia em PostgreSQL exclusivo, sem rede/portas ou reinício produtivo."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
import uuid


def caminho_privado(nome):
    """Exige alvo privado explícito; nunca usa caminho operacional padrão."""
    valor = os.environ.get(nome)
    if not isinstance(valor, str) or not valor or any(c in valor for c in '\r\n\0,'):
        raise RuntimeError('ATENDIMENTO_CAMINHO_PRIVADO_OBRIGATORIO_' + nome)
    caminho = Path(valor)
    if not caminho.is_absolute() or str(caminho) != valor or '..' in caminho.parts or caminho.parent == caminho:
        raise RuntimeError('ATENDIMENTO_CAMINHO_PRIVADO_INVALIDO_' + nome)
    return caminho

IMAGEM_PG = 'sha256:3645570cccdfa447589da9f57dd740faa29b30938e861289a5574b6ca6b03826'
IMAGEM_NODE = 'sha256:4573af7c8fe8bc48827e88e39358fb5170e6ea319d1938152db5edad349a0ede'
USUARIO = 'donatella_receptor_ensaio_admin'
BANCOS = ('donatella_ensaio_operacao', 'donatella_ensaio_entrada')
FINALIDADE = 'ensaio-receptor-isolado-v1'


def sha(caminho):
    return hashlib.sha256(caminho.read_bytes()).hexdigest()


def conferir_release(base=None):
    if base is None:
        base = caminho_privado('ATENDIMENTO_RAIZ_REMOTA_OPERACAO')
    release = base / 'release'
    nomes = ['release.json', 'operacao.mjs', 'provas/receptor-isolado.mjs',
             'sql/025-operacao-destino.sql', 'sql/026-entrada-duravel-destino.sql']
    for nome in nomes:
        p = release / nome
        if not p.is_file() or p.is_symlink() or p.resolve() != p:
            raise RuntimeError('PROVA_RECEPTOR_RELEASE_RECUSADA')
    manifesto = json.loads((release / 'release.json').read_text())
    runtime = sha(release / 'operacao.mjs')
    if manifesto.get('runtimeSha256') != runtime:
        raise RuntimeError('PROVA_RECEPTOR_RUNTIME_DIVERGENTE')
    if manifesto.get('executaveisSha256', {}).get('provas/receptor-isolado.mjs') != sha(release / 'provas/receptor-isolado.mjs'):
        raise RuntimeError('PROVA_RECEPTOR_RUNNER_DIVERGENTE')
    for nome in nomes[3:]:
        if manifesto.get('sqlSha256', {}).get(Path(nome).name) != sha(release / nome):
            raise RuntimeError('PROVA_RECEPTOR_SQL_DIVERGENTE')
    return runtime


def comando(args, entrada=None, timeout=90):
    r = subprocess.run(args, input=entrada, text=True, capture_output=True, timeout=timeout)
    if r.returncode:
        # Não contém configurações reais; ainda assim o erro público é fixo.
        raise RuntimeError('PROVA_RECEPTOR_COMANDO_FALHOU')
    return r.stdout.strip()


def conferir_container(nome, identificador=None):
    if not re.fullmatch(r'donatella-receptor-prova-[a-f0-9]{32}', nome):
        raise RuntimeError('PROVA_RECEPTOR_CONTAINER_RECUSADO')
    d = json.loads(comando(['docker', 'inspect', nome]))[0]
    if d['Config'].get('Labels', {}).get('grazing.finalidade') != FINALIDADE or d['HostConfig']['NetworkMode'] != 'none' or d['HostConfig'].get('PortBindings'):
        raise RuntimeError('PROVA_RECEPTOR_ISOLAMENTO_RECUSADO')
    if identificador is not None and d['Id'] != identificador:
        raise RuntimeError('PROVA_RECEPTOR_CONTAINER_DIVERGENTE')
    return d


def esperar(nome, identificador):
    for _ in range(45):
        conferir_container(nome, identificador)
        r = subprocess.run(['docker', 'exec', nome, 'pg_isready', '-h', '/socket', '-U', USUARIO, '-d', 'postgres'], capture_output=True, timeout=5)
        postmaster = subprocess.run(['docker', 'exec', nome, 'cat', '/proc/1/comm'], capture_output=True, timeout=5)
        if r.returncode == 0 and postmaster.returncode == 0 and postmaster.stdout.strip() == b'postgres':
            # Não aceitar servidor temporário de initdb: após readiness o mesmo
            # postmaster precisa continuar vivo, pronto para criar os bancos.
            time.sleep(1)
            q = subprocess.run(['docker', 'exec', nome, 'psql', '-X', '-qAt', '-h', '/socket', '-U', USUARIO, '-d', 'postgres', '-c', 'SELECT 1'], capture_output=True, timeout=5)
            if q.returncode == 0 and q.stdout.strip() == b'1':
                return
        time.sleep(1)
    raise RuntimeError('PROVA_RECEPTOR_BANCO_INDISPONIVEL')


def plano_banco(nome, volume, socket):
    return ['docker', 'run', '--pull=never', '-d', '--name', nome,
            '--label', 'grazing.finalidade=' + FINALIDADE, '--network', 'none',
            '--read-only', '--security-opt', 'no-new-privileges', '--memory', '512m',
            '--cpus', '0.5', '--pids-limit', '128', '--log-opt', 'max-size=5m', '--log-opt', 'max-file=2',
            '--mount', 'type=volume,src=' + volume + ',dst=/var/lib/postgresql/data',
            '--mount', 'type=bind,src=' + str(socket) + ',dst=/socket',
            '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m',
            '--tmpfs', '/var/run/postgresql:rw,noexec,nosuid,size=16m',
            '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_USER=' + USUARIO,
            '-e', 'POSTGRES_DB=postgres', IMAGEM_PG, 'postgres',
            # O entrypoint do PostgreSQL inicializa via socket padrão; o runner
            # usa /socket. Ambos ficam locais, sem escuta TCP nem portas.
            '-c', 'listen_addresses=', '-c', 'unix_socket_directories=/socket,/var/run/postgresql',
            '-c', 'max_connections=16', '-c', 'shared_buffers=64MB',
            '-c', 'log_statement=none', '-c', 'log_min_error_statement=panic']


def plano_runner(nome, fase, release, estagio):
    if fase not in ('--preparar', '--retomada'):
        raise RuntimeError('PROVA_RECEPTOR_FASE_RECUSADA')
    return ['docker', 'run', '--pull=never', '--name', nome, '--network', 'none',
            '--label', 'grazing.finalidade=' + FINALIDADE, '--read-only', '--cap-drop', 'ALL',
            '--security-opt', 'no-new-privileges', '--memory', '512m', '--cpus', '0.5', '--pids-limit', '64',
            '-e', 'DONATELLA_PROVA_RECEPTOR_ISOLADA=1',
            '--mount', 'type=bind,src=' + str(release) + ',dst=/release,readonly',
            '--mount', 'type=bind,src=' + str(estagio / 'socket') + ',dst=/socket',
            '--mount', 'type=bind,src=' + str(estagio / 'prova') + ',dst=/prova',
            '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m', IMAGEM_NODE,
            '/release/provas/receptor-isolado.mjs', fase]


def salvar_exclusivo(caminho, dados):
    with caminho.open('x') as f:
        os.chmod(caminho, 0o600)
        json.dump(dados, f)
        f.flush()
        os.fsync(f.fileno())


def executar():
    BASE = caminho_privado('ATENDIMENTO_RAIZ_REMOTA_OPERACAO')
    RAIZ = caminho_privado('ATENDIMENTO_RAIZ_ENSAIO_RECEPTOR')
    os.umask(0o077)
    runtime = conferir_release()
    for imagem in (IMAGEM_PG, IMAGEM_NODE):
        if comando(['docker', 'image', 'inspect', imagem, '--format', '{{.Id}}']) != imagem:
            raise RuntimeError('PROVA_RECEPTOR_IMAGEM_DIVERGENTE')
    if shutil.disk_usage('/var/lib').free < 10 * 1024 ** 3:
        raise RuntimeError('PROVA_RECEPTOR_ESPACO_INSUFICIENTE')
    provas = BASE / 'configuracao/corte/verificacoes'
    provas.mkdir(mode=0o700, parents=True, exist_ok=True)
    destino = provas / ('ensaio-receptor-' + runtime + '.json')
    if destino.exists():
        raise RuntimeError('PROVA_RECEPTOR_RECIBO_JA_EXISTE')
    identificador = uuid.uuid4().hex
    nome = 'donatella-receptor-prova-' + identificador
    volume = nome + '-dados'
    estagio = RAIZ / identificador
    estagio.mkdir(mode=0o700, parents=True, exist_ok=False)
    (estagio / 'socket').mkdir(mode=0o777)
    (estagio / 'socket').chmod(0o777)  # A raiz 0700 protege o socket no host.
    (estagio / 'prova').mkdir(mode=0o700)
    salvar_exclusivo(estagio / 'intencao.json', {'runtimeSha256': runtime, 'container': nome, 'volume': volume})
    comando(['docker', 'volume', 'create', '--label', 'grazing.finalidade=' + FINALIDADE, volume])
    container_id = comando(plano_banco(nome, volume, estagio / 'socket'))
    try:
        esperar(nome, container_id)
        for banco in BANCOS:
            comando(['docker', 'exec', nome, 'createdb', '-h', '/socket', '-U', USUARIO, banco])
        comando(plano_runner(nome + '-antes', '--preparar', BASE / 'release', estagio), timeout=120)
        antes = conferir_container(nome, container_id)['State']['StartedAt']
        comando(['docker', 'restart', nome])
        esperar(nome, container_id)
        depois = conferir_container(nome, container_id)['State']['StartedAt']
        if depois == antes:
            raise RuntimeError('PROVA_RECEPTOR_REINICIO_NAO_COMPROVADO')
        comando(plano_runner(nome + '-depois', '--retomada', BASE / 'release', estagio), timeout=120)
        prova = json.loads((estagio / 'prova/depois.json').read_text())
        esperados = ['assinaturaInvalidaRecusada', 'persistidoAntesAck', 'repeticaoIdempotente', 'retomadaAposReinicio', 'falhaPersistenciaSemAck']
        if prova.get('runtimeSha256') != runtime or any(prova.get('resultados', {}).get(k) is not True for k in esperados) or prova['resultados'].get('enviosExternos') != 0:
            raise RuntimeError('PROVA_RECEPTOR_RESULTADO_RECUSADO')
        if conferir_release() != runtime:
            raise RuntimeError('PROVA_RECEPTOR_RELEASE_ALTERADA')
        prova['isolamento'] = {'container': nome, 'containerId': container_id, 'rede': 'none', 'portas': 0, 'reinicioSomenteProva': True, 'iniciadaAntes': antes, 'iniciadaDepois': depois}
        salvar_exclusivo(destino, prova)
        print(json.dumps({'reciboCriado': True, 'runtimeSha256': runtime, 'assercoes': prova['assercoes'], 'enviosExternos': 0, 'reinicioSomenteProva': True}))
    finally:
        # Não remove container/volume/bytes e jamais aponta para banco operacional.
        conferir_container(nome, container_id)
        comando(['docker', 'stop', nome])


if __name__ == '__main__':
    try:
        # Um flag posicional é lido sem ambiguidade e sem argumentos livres.
        import sys
        if len(sys.argv) != 2 or sys.argv[1] not in ('--verificar', '--executar-ensaio-isolado'):
            raise RuntimeError('PROVA_RECEPTOR_ARGUMENTO_RECUSADO')
        if sys.argv[1] == '--verificar':
            print(json.dumps({'runtimeSha256': conferir_release(), 'recursosCriados': False, 'redeExterna': False}))
        else:
            executar()
    except Exception as e:
        codigo = str(e)
        print(codigo if re.fullmatch(r'PROVA_RECEPTOR_[A-Z_]+', codigo) else 'PROVA_RECEPTOR_FALHOU')
        raise SystemExit(1)
