"""Atualização estreita da candidata; --verificar não grava nem inicia serviços.

Não altera Meta/origem, não importa histórico e não autoriza uma janela. Uma
tentativa interrompida após iniciar a troca retorna à release anterior; o banco
nunca é restaurado nem a CHECK ampliada é reduzida automaticamente.
"""
import argparse
import copy
from contextlib import contextmanager
import datetime
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import time
import uuid

try:
    import fcntl
except ImportError:
    fcntl = None


def caminho_privado(nome):
    """Exige alvo privado explícito; nunca usa caminho operacional padrão."""
    valor = os.environ.get(nome)
    if not isinstance(valor, str) or not valor or any(c in valor for c in '\r\n\0,'):
        raise RuntimeError('ATENDIMENTO_CAMINHO_PRIVADO_OBRIGATORIO_' + nome)
    caminho = Path(valor)
    if not caminho.is_absolute() or str(caminho) != valor or '..' in caminho.parts or caminho.parent == caminho:
        raise RuntimeError('ATENDIMENTO_CAMINHO_PRIVADO_INVALIDO_' + nome)
    return caminho

ROOT = caminho_privado('ATENDIMENTO_RAIZ_REMOTA_OPERACAO')
APP = 'grazing-donatella-operacao-v2'
DB = APP + '-banco'
PROJECT = APP
SQL = '036-operacao-mensagem-sticker.sql'
SQL_SHA = '1136a509eb85b444e502bf33d4ffcdfdca869b8837bf97ac0c6485683ef88a43'
CHECKPOINT = caminho_privado('ATENDIMENTO_ROTINA_CHECKPOINT_OPERACAO')
CHECKPOINT_SHA = os.environ.get('ATENDIMENTO_ROTINA_CHECKPOINT_OPERACAO_SHA256', '')
if not re.fullmatch(r'[a-f0-9]{64}', CHECKPOINT_SHA):
    raise RuntimeError('CANDIDATA_CHAT_CHECKPOINT_SHA256_OBRIGATORIO')
CHECKPOINT_SERVICE = 'grazing-donatella-checkpoint-operacao-r2-v2.service'
CHECKPOINT_VOLUME = 'grazing-donatella-checkpoints-operacao-v2-estado'
def alvos_checkpoint():
    raiz = caminho_privado('ATENDIMENTO_RAIZ_CHECKPOINT_OPERACAO_R2')
    pendente, lock = raiz / 'pendente.json', raiz / 'exclusao.lock'
    for nome, esperado in [('ATENDIMENTO_CHECKPOINT_OPERACAO_PENDENTE', pendente),
                           ('ATENDIMENTO_PUBLICACAO_LOCK_CHECKPOINT', lock)]:
        if nome in os.environ and caminho_privado(nome) != esperado:
            raise RuntimeError('CANDIDATA_CHAT_CHECKPOINT_ALVO_DIVERGENTE')
    return pendente, lock


PENDENTE, LOCK_CHECKPOINT = alvos_checkpoint()
MIDIA_ORIGEM = caminho_privado('ATENDIMENTO_MIDIA_ORIGEM')
UUID = re.compile(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}')
SHA = re.compile(r'[a-f0-9]{64}')
FERRAMENTAS = ('controle-corte-programado.py', 'controle-corte-minimo-chat.py',
              'conferir-exclusividade-chat-minimo.py', 'executar-nucleo-chat-minimo.py',
              'provar-teste-real-chat-minimo.py', 'provar-emissores-chat-minimo.py',
              'provar-retorno-chat-minimo.py')
ANTERIORES = ('text', 'image', 'audio', 'document', 'video', 'template', 'unsupported')
NOVOS = ('text', 'image', 'audio', 'document', 'video', 'sticker', 'template', 'unsupported')


def exigir(ok, codigo):
    if not ok:
        raise RuntimeError('CANDIDATA_CHAT_' + codigo)


def agora():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def instante(s):
    try:
        d = datetime.datetime.fromisoformat(s.replace('Z', '+00:00'))
        exigir(d.tzinfo is not None, 'INSTANTE_INVALIDO')
        return d
    except (TypeError, ValueError, AttributeError):
        exigir(False, 'INSTANTE_INVALIDO')


def sha(b):
    return hashlib.sha256(b).hexdigest()


def serializar(d):
    return json.dumps(d, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()


def arquivo(p, privado=False):
    exigir(p.resolve() == p and p.is_file() and not p.is_symlink(), 'ARQUIVO_RECUSADO')
    s = p.stat()
    exigir(s.st_size <= 64 * 1024 * 1024, 'ARQUIVO_GRANDE')
    if privado:
        exigir((s.st_mode & 0o077) == 0, 'PERMISSAO_PRIVADA_EXIGIDA')
    return p.read_bytes()


def ler(p, privado=False):
    return json.loads(arquivo(p, privado))


def sincronizar(p):
    f = os.open(p, os.O_RDONLY)
    try:
        os.fsync(f)
    finally:
        os.close(f)


@contextmanager
def bloquear_checkpoint(permitir_pendente=False):
    # Não permitir um snapshot no meio da troca dos arquivos/configuração.
    p = LOCK_CHECKPOINT
    exigir(p.resolve() == p and not p.is_symlink(), 'LOCK_CHECKPOINT_RECUSADO')
    with p.open('a') as lock:
        os.fchmod(lock.fileno(), 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        exigir(permitir_pendente or not PENDENTE.exists(), 'CHECKPOINT_EM_FINALIZACAO')
        yield


def gravar(p, b):
    exigir(p.parent.resolve() == p.parent and not p.is_symlink(), 'DESTINO_RECUSADO')
    temp = p.with_name(p.name + '.novo-' + uuid.uuid4().hex)
    exigir(not temp.exists() and not temp.is_symlink(), 'GRAVACAO_PARCIAL_CONFERIR')
    with temp.open('xb') as f:
        os.fchmod(f.fileno(), 0o600)
        f.write(b)
        f.flush()
        os.fsync(f.fileno())
    os.replace(temp, p)
    sincronizar(p.parent)


def comando(args, entrada=None, timeout=60):
    p = subprocess.run(args, input=entrada, capture_output=True, text=True, timeout=timeout)
    # Nunca revelar stdout/stderr de docker inspect, compose ou psql.
    exigir(p.returncode == 0, 'COMANDO_RECUSADO')
    return p.stdout.strip()


def inspect(nome):
    return json.loads(comando(['docker', 'inspect', nome]))[0]


def inventario(p):
    exigir(p.resolve() == p and p.is_dir() and not p.is_symlink(), 'PASTA_RECUSADA')
    r = {}
    for f in p.rglob('*'):
        exigir(not f.is_symlink(), 'SYMLINK_RECUSADO')
        if f.is_dir():
            continue
        r[f.relative_to(p).as_posix()] = sha(arquivo(f))
    exigir(len(r) <= 7000, 'CAPACIDADE_RECUSADA')
    return r


def conferir_release(p, runtime, manifesto, minima=True):
    exigir(sha(arquivo(p / 'release.json')) == manifesto, 'MANIFESTO_DIVERGENTE')
    m = ler(p / 'release.json')
    exigir(m.get('versao') == 1 and m.get('runtimeSha256') == runtime,
           'RUNTIME_DIVERGENTE')
    esperado = {'release.json': manifesto, 'operacao.mjs': runtime}
    for pasta, chave in [('', 'executaveisSha256'), ('web/', 'webArquivosSha256'),
                         ('sql/', 'sqlSha256'), ('ferramentas/', 'ferramentasSha256')]:
        exigir(isinstance(m.get(chave), dict), 'MANIFESTO_INCOMPLETO')
        for n, h in m[chave].items():
            relativo = PurePosixPath(n)
            exigir(str(relativo) == n and not relativo.is_absolute() and '..' not in relativo.parts
                   and SHA.fullmatch(str(h)) and pasta + n not in esperado, 'CAMINHO_MANIFESTO_RECUSADO')
            esperado[pasta + n] = h
    real = inventario(p)
    exigir(real == esperado if minima else all(real.get(n) == h for n, h in esperado.items()),
           'CONTEUDO_RELEASE_DIVERGENTE')
    if minima:
        exigir(m['sqlSha256'].get(SQL) == SQL_SHA, 'SQL036_DIVERGENTE')
        exigir(all(n in m['ferramentasSha256'] for n in FERRAMENTAS), 'EXECUTOR_AUSENTE')
        exigir(all(n in m['executaveisSha256'] for n in
                   ['corte/chat-minimo.mjs', 'corte/provar-backup-chat-minimo.mjs',
                    'corte/emissores-chat-minimo.mjs']), 'EXECUTOR_AUSENTE')
    return m


def tipos_check(definicao):
    # Forma exata emitida por pg_get_constraintdef para a CHECK original/036.
    for tipos in (ANTERIORES, NOVOS):
        esperado = 'CHECK ((tipo = ANY (ARRAY[' + ', '.join("'" + t + "'::text" for t in tipos) + '])))'
        if definicao == esperado:
            return tipos
    exigir(False, 'CHECK_TIPO_DIVERGENTE')


def conferir_sql():
    exigir(inspect(DB).get('Config', {}).get('Labels', {}).get('grazing.finalidade') == 'operacao-privada',
           'BANCO_RECUSADO')
    s = comando(['docker', 'exec', DB, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
                 '-U', 'donatella_operacao_admin', '-d', 'donatella_operacao', '-c',
                 "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='atendimento_operacao.mensagem'::regclass AND conname='mensagem_tipo_check' AND contype='c' AND convalidated"])
    return tipos_check(s)


def desarmada(c):
    exigir(c.get('modo') == 'homologacao' and c.get('autoridade') == 'origem'
           and c.get('enviosHabilitados') is False and c.get('iaAutomatica') is False,
           'HOMOLOGACAO_DESARMADA_EXIGIDA')


def config_segura(c, candidata=True):
    novo = copy.deepcopy(c)
    novo.update(modo='homologacao', autoridade='origem', enviosHabilitados=False,
                iaAutomatica=False, automacoesHabilitadas=False)
    novo.setdefault('voz', {})['sinteseHabilitada'] = False
    novo.setdefault('woocommerce', {})['automacoesHabilitadas'] = False
    # Publicar código e preparar credencial não ativa o modo de recepção nem
    # cria a fase do corte. O controlador fará isso somente na nova janela.
    return novo


def compose_seguro(c):
    novo = copy.deepcopy(c)
    exigir(c.get('name') == PROJECT and set(c.get('services', {})) == {'operacao'}, 'COMPOSE_RECUSADO')
    s = novo['services']['operacao']
    exigir(s.get('container_name') == APP and s.get('command') == ['/release/operacao.mjs']
           and s.get('read_only') is True and not s.get('privileged') and not s.get('build'), 'SERVICO_RECUSADO')
    s.setdefault('environment', {}).update(ATENDIMENTO_IA_HABILITADA='false',
        ATENDIMENTO_ENVIO_HABILITADO='false', ATENDIMENTO_AUTORIDADE_ENVIO='origem')
    return novo


def conferir_mounts(x):
    labels = x.get('Config', {}).get('Labels', {})
    exigir(labels.get('com.docker.compose.project') == PROJECT
           and labels.get('com.docker.compose.service') == 'operacao', 'SERVICO_RECUSADO')
    esperados = {'/release': (str(ROOT / 'release'), False),
        '/run/secrets/operacao.json': (str(ROOT / 'configuracao/operacao.json'), False),
        '/midia': (str(ROOT / 'midia'), True),
        '/midia-ensaio': (str(ROOT / 'midia-ensaio'), True),
        '/legado/midia': (str(MIDIA_ORIGEM), False)}
    volumes = {'/legado/incrementais': 'grazing-donatella-coletor-v2-estado', '/backup-estado': CHECKPOINT_VOLUME}
    encontrados = {m['Destination']: m for m in x['Mounts']}
    exigir(set(encontrados) == set(esperados) | set(volumes), 'MOUNTS_DIVERGENTES')
    for destino, (origem, rw) in esperados.items():
        m = encontrados[destino]
        exigir(m.get('Type') == 'bind' and m.get('Source') == origem and m.get('RW') is rw, 'MOUNTS_DIVERGENTES')
    for destino, nome in volumes.items():
        m = encontrados[destino]
        exigir(m.get('Type') == 'volume' and m.get('Name') == nome and m.get('RW') is False, 'MOUNTS_DIVERGENTES')
    exigir(x.get('State', {}).get('Running') is True, 'SERVICO_PARADO')


def checkpoint_atual():
    v = Path(json.loads(comando(['docker', 'volume', 'inspect', CHECKPOINT_VOLUME]))[0]['Mountpoint'])
    p = ler(v / 'checkpoints-operacao-v2/atual.json')
    exigir(UUID.fullmatch(str(p.get('id'))) and p.get('banco') == 'donatella_operacao'
           and p.get('bancoEntrada') == 'donatella_entrada' and p.get('falha') is None
           and p.get('emExecucao') is False and p.get('spoolHorarioPreservado') is True
           and p.get('baseExternaIntegralConferida') is True
           and SHA.fullmatch(str(p.get('referencia', {}).get('sha256'))), 'CHECKPOINT_INCOMPLETO')
    exigir(instante(p['concluidoEm']) >= instante(p['criadoEm']), 'CHECKPOINT_INCOMPLETO')
    return p


def capacidade():
    exigir(sha(arquivo(CHECKPOINT).replace(b'\r\n', b'\n')) == CHECKPOINT_SHA, 'ROTINA_CHECKPOINT_DIVERGENTE')
    return json.loads(comando(['sh', str(CHECKPOINT), '--verificar']))


def sem_janela():
    legado = ROOT / 'configuracao/corte/autorizacao.json'
    if legado.exists():
        exigir(ler(legado, True).get('estado') == 'encerrada', 'JANELA_PRESENTE')
    for p in (ROOT / 'configuracao/corte-minimo-chat').glob('*/autorizacao.json'):
        estado_p = p.parent / 'estado.json'
        exigir(estado_p.exists(), 'JANELA_PRESENTE')
        e = ler(estado_p, True)
        exigir(e.get('fase') == 'encerrada' and e.get('janelaId') == p.parent.name
               and SHA.fullmatch(str(e.get('reciboSha256'))), 'JANELA_PRESENTE')
        recibos = [r for r in p.parent.glob('recibo-*.json')
                   if sha(arquivo(r, True)) == e['reciboSha256']]
        exigir(len(recibos) == 1, 'ENCERRAMENTO_NAO_COMPROVADO')
        r = ler(recibos[0], True)
        exigir(r.get('tipo') == 'execucao-chat-minimo-v1' and r.get('acao') == 'encerrar'
               and r.get('resultado', {}).get('encerramento') is True
               and all(r.get(k) == e.get(k) for k in ['janelaId', 'runtimeSha256', 'manifestoSha256']),
               'ENCERRAMENTO_NAO_COMPROVADO')


def carregar_plano(p):
    d = ler(p, True)
    exigir(d.get('versao') == 1 and d.get('tipo') == 'instalacao-candidata-chat-minimo-v1'
           and UUID.fullmatch(str(d.get('id'))) and all(SHA.fullmatch(str(d.get(k)))
           for k in ['runtimeSha256', 'manifestoSha256']), 'PLANO_INVALIDO')
    pasta = ROOT / 'configuracao/instalacao-chat-minimo' / d['id']
    exigir(p == pasta / 'plano.json', 'PLANO_CAMINHO_RECUSADO')
    if 'metaPreparada' in d:
        meta = Path(d['metaPreparada'])
        exigir(meta.parent == ROOT / 'configuracao' and re.fullmatch(
            r'meta-vps-chat-preparada-[0-9]{8}T[0-9]{6}Z\.json', meta.name), 'META_PREPARADA_CAMINHO_RECUSADO')
    return d, pasta, ROOT / 'candidatas' / d['id'] / 'release'


def conferir_meta_preparada(plano, candidata, cfg):
    if 'metaPreparada' not in plano:
        return {}
    p = Path(plano['metaPreparada'])
    b = arquivo(p, True); preparada = json.loads(b)
    meta = preparada.get('meta', {})
    atual = cfg.get('meta', {})
    exigir(preparada.get('ativa') is False and isinstance(meta.get('accessToken'), str)
           and meta['accessToken'] and all(meta.get(k) == atual.get(k) for k in ['appId', 'wabaId', 'phoneId'])
           and isinstance(atual.get('accessToken'), str) and atual['accessToken']
           and meta['accessToken'] != atual['accessToken'], 'META_PREPARADA_RECUSADA')
    nova = {**atual, 'accessToken': meta['accessToken']}
    entrada = json.dumps({'meta': nova, 'tokensOrigem': [atual['accessToken']]})
    # O conferidor do pacote já teve seus bytes validados pelo manifesto.
    r = json.loads(comando([sys.executable, '-B', str(candidata / 'ferramentas/conferir-exclusividade-chat-minimo.py')], entrada, timeout=180))
    exigir(r.get('somenteLeitura') is True and r.get('appSecretValido') is True
           and r.get('vpsAptaLeitura') is True and r.get('credenciaisIndependentes') is True
           and r.get('todasOrigemRevogadas') is False, 'META_PREPARADA_NAO_VALIDADA')
    return {'metaPreparada': str(p), 'metaPreparadaSha256': sha(b),
            'metaNovoTokenFingerprint': sha(meta['accessToken'].encode()),
            'metaOrigemTokenFingerprint': sha(atual['accessToken'].encode()),
            'metaIndependenciaConferida': True}


def preflight(plano, candidata):
    conferir_release(candidata, plano['runtimeSha256'], plano['manifestoSha256'])
    sem_janela()
    cfg = ler(ROOT / 'configuracao/operacao.json', True)
    desarmada(cfg)
    atual = inspect(APP)
    conferir_mounts(atual)
    env = dict(e.split('=', 1) for e in atual['Config']['Env'] if '=' in e)
    exigir(env.get('ATENDIMENTO_ENVIO_HABILITADO') == 'false'
           and env.get('ATENDIMENTO_AUTORIDADE_ENVIO') == 'origem', 'ENVIO_ATUAL_NAO_DESARMADO')
    compose = json.loads(comando(['docker', 'compose', '-f', str(ROOT / 'compose.operacao.yml'), 'config', '--format', 'json']))
    compose_seguro(compose)
    exigir(compose['services']['operacao']['image'] == atual['Config']['Image'], 'IMAGEM_DIVERGENTE')
    sql = conferir_sql()
    cp = checkpoint_atual()
    exigir(not PENDENTE.exists(), 'CHECKPOINT_EM_FINALIZACAO')
    cap = capacidade()
    bytes_extras = sum(p.stat().st_size for raiz in [ROOT / 'release', candidata, ROOT / 'ferramentas']
                      for p in raiz.rglob('*') if p.is_file())
    exigir(cap['estimativaAntesCompressaoBytes'] + bytes_extras + 1024 * 1024 <= 128 * 1024 * 1024,
           'BACKUP_PREPARADO_EXCEDE_RAM')
    anterior = ler(ROOT / 'release/release.json')
    conferir_release(ROOT / 'release', anterior['runtimeSha256'], sha(arquivo(ROOT / 'release/release.json')), minima=False)
    meta = conferir_meta_preparada(plano, candidata, cfg)
    r = {'versao': 1, 'tipo': 'preflight-candidata-chat-minimo-v1', 'id': plano['id'],
         'planoSha256': sha(serializar(plano)), 'runtimeSha256': plano['runtimeSha256'],
         'manifestoSha256': plano['manifestoSha256'],
         'configAntesSha256': sha(arquivo(ROOT / 'configuracao/operacao.json')),
         'composeAntesSha256': sha(arquivo(ROOT / 'compose.operacao.yml')),
         'runtimeAntesSha256': anterior['runtimeSha256'],
         'manifestoAntesSha256': sha(arquivo(ROOT / 'release/release.json')),
         'checkpointId': cp['id'], 'checkpointSha256': cp['referencia']['sha256'],
         'sql036JaAmpliada': sql == NOVOS, 'enviosHabilitados': False, 'janelaIniciada': False, **meta}
    return r, cfg, compose


def salvar_estado(pasta, estado, fase):
    estado.update(fase=fase, atualizadaEm=agora())
    gravar(pasta / 'estado.json', serializar(estado))


def preservar(pasta, prova, cfg, compose):
    b = pasta / 'anterior'
    exigir(not b.exists(), 'PREPARACAO_PARCIAL_CONFERIR')
    b.mkdir(mode=0o700)
    shutil.copytree(ROOT / 'release', b / 'release')
    (b / 'ferramentas').mkdir(mode=0o700)
    for n in FERRAMENTAS:
        p = ROOT / 'ferramentas' / n
        if p.exists():
            gravar(b / 'ferramentas' / n, arquivo(p))
    gravar(b / 'operacao.json', arquivo(ROOT / 'configuracao/operacao.json', True))
    gravar(b / 'compose.operacao.yml', arquivo(ROOT / 'compose.operacao.yml'))
    gravar(b / 'compose-normalizado.json', serializar(compose))
    gravar(b / 'config-retorno.json', serializar(config_segura(cfg, False)))
    gravar(b / 'compose-retorno.json', serializar(compose_seguro(compose)))
    nova = config_segura(cfg)
    if prova.get('metaPreparada'):
        preparada = arquivo(Path(prova['metaPreparada']), True)
        exigir(sha(preparada) == prova['metaPreparadaSha256'], 'META_PREPARADA_ALTERADA')
        nova['meta']['accessToken'] = json.loads(preparada)['meta']['accessToken']
    gravar(b / 'config-candidata.json', serializar(nova))
    gravar(b / 'compose-candidata.json', serializar(compose_seguro(compose)))
    for f in b.rglob('*'):
        f.chmod(0o700 if f.is_dir() else 0o600)
        if f.is_file():
            with f.open('r+b') as h:
                os.fsync(h.fileno())
    for d in sorted((p for p in b.rglob('*') if p.is_dir()), key=lambda p:len(p.parts), reverse=True):
        sincronizar(d)
    sincronizar(b)
    e = {'versao': 1, 'id': prova['id'], 'conferenciaSha256': sha(serializar(prova)),
         'preflight': prova, 'backupArquivosSha256': inventario(b), 'preservadaEm': agora()}
    salvar_estado(pasta, e, 'preservada')
    return e


def validar_backup_local(pasta, e):
    exigir(inventario(pasta / 'anterior') == e['backupArquivosSha256'], 'BACKUP_LOCAL_DIVERGENTE')


def conferir_config_instalada(pasta, retorno=False):
    sufixo = 'retorno' if retorno else 'candidata'
    for atual, preservado in [('configuracao/operacao.json', 'config-' + sufixo + '.json'),
                              ('compose.operacao.yml', 'compose-' + sufixo + '.json')]:
        exigir(sha(arquivo(ROOT / atual)) == sha(arquivo(pasta / 'anterior' / preservado, True)),
               'CONFIG_INSTALADA_DIVERGENTE')


def novo_checkpoint(depois):
    exigir(not PENDENTE.exists(), 'CHECKPOINT_EM_FINALIZACAO')
    capacidade()
    for tentativa in range(15):
        servico = comando(['systemctl', 'show', CHECKPOINT_SERVICE, '-p', 'ActiveState'])
        if servico in ['ActiveState=inactive', 'ActiveState=failed']:
            break
        time.sleep(2)
    else:
        exigir(False, 'CHECKPOINT_AINDA_EM_EXECUCAO')
    comando(['systemctl', 'start', '--no-block', CHECKPOINT_SERVICE])
    limite = time.monotonic() + 900
    while time.monotonic() < limite:
        estado = comando(['systemctl', 'show', CHECKPOINT_SERVICE, '-p', 'ActiveState', '-p', 'Result'])
        if 'ActiveState=inactive' in estado or 'ActiveState=failed' in estado:
            exigir('Result=success' in estado and not PENDENTE.exists(), 'CHECKPOINT_FALHOU')
            p = checkpoint_atual()
            if instante(p['criadoEm']) >= instante(depois):
                return {'id': p['id'], 'manifestoSha256': p['referencia']['sha256'],
                        'criadoEm': p['criadoEm'], 'concluidoEm': p['concluidoEm'],
                        'releituraIntegral': True, 'restauracaoRealComprovada': False}
        time.sleep(2)
    exigir(False, 'CHECKPOINT_PRAZO_EXCEDIDO')


def aplicar_sql_candidata(candidata):
    b = arquivo(candidata / 'sql' / SQL)
    exigir(sha(b) == SQL_SHA, 'SQL036_DIVERGENTE')
    tipos = conferir_sql()
    recibo = ROOT / 'configuracao/sql-aplicado.json'
    r = ler(recibo, True)
    chave = 'donatella_operacao/' + SQL
    exigir(chave not in r or r[chave] == SQL_SHA, 'SQL_RECIBO_DIVERGENTE')
    if tipos == ANTERIORES:
        comando(['docker', 'exec', '-i', DB, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
                 '-U', 'donatella_operacao_admin', '-d', 'donatella_operacao'], b.decode(), timeout=45)
    exigir(conferir_sql() == NOVOS, 'SQL036_NAO_CONFIRMADA')
    r[chave] = SQL_SHA
    gravar(recibo, serializar(r))


def trocar_release(origem, destino_retirado):
    stage = ROOT / ('release-preparada-' + destino_retirado.name)
    exigir(not stage.exists() and not destino_retirado.exists(), 'TROCA_PARCIAL_CONFERIR')
    shutil.copytree(origem, stage)
    exigir(inventario(stage) == inventario(origem), 'COPIA_RELEASE_DIVERGENTE')
    for f in stage.rglob('*'):
        if f.is_file():
            with f.open('r+b') as h:
                os.fsync(h.fileno())
    for d in sorted((p for p in stage.rglob('*') if p.is_dir()), key=lambda p:len(p.parts), reverse=True):
        sincronizar(d)
    sincronizar(stage)
    if (ROOT / 'release').exists():
        os.rename(ROOT / 'release', destino_retirado)
    os.rename(stage, ROOT / 'release')
    sincronizar(ROOT)


def iniciar():
    comando(['docker', 'compose', '-f', str(ROOT / 'compose.operacao.yml'), 'up', '-d', '--no-deps', '--force-recreate', 'operacao'])


def conferir_saude(candidata):
    js = "require('node:http').get({hostname:'127.0.0.1',port:3000,path:'/operacao/saude',headers:{Host:'atendimento.grazinghub.com.br'}},r=>{let b='';r.on('data',d=>b+=d);r.on('end',()=>{if(r.statusCode!==200)process.exit(1);process.stdout.write(b)})}).on('error',()=>process.exit(1))"
    for _ in range(20):
        try:
            p = json.loads(comando(['docker', 'exec', APP, 'node', '-e', js], timeout=5))
            exigir(p.get('modo') == 'homologacao' and p.get('autoridade') == 'origem'
                   and p.get('enviosReais') is False and p.get('iaAutomatica', False) is False
                   and p.get('sinteseHabilitada', False) is False
                   and p.get('automacoesHabilitadas', False) is False, 'SAUDE_NAO_DESARMADA')
            x = inspect(APP)
            conferir_mounts(x)
            env = dict(e.split('=', 1) for e in x['Config']['Env'] if '=' in e)
            exigir(all(env.get(k) == v for k, v in {'ATENDIMENTO_IA_HABILITADA': 'false',
                   'ATENDIMENTO_ENVIO_HABILITADO': 'false', 'ATENDIMENTO_AUTORIDADE_ENVIO': 'origem'}.items()), 'ENV_NAO_DESARMADO')
            return p
        except (RuntimeError, ValueError, subprocess.TimeoutExpired):
            time.sleep(2)
    exigir(False, 'SAUDE_NAO_CONFIRMADA')


def retornar(pasta, e):
    # O lock exclusivo prova que nenhum capturador está lendo os arquivos. Um
    # spool/marker de backup falho permanece preservado e não impede o freio.
    with bloquear_checkpoint(permitir_pendente=True):
        return retornar_bloqueado(pasta, e)


def retornar_bloqueado(pasta, e):
    validar_backup_local(pasta, e)
    sem_janela()
    desarmada(ler(ROOT / 'configuracao/operacao.json', True))
    b = pasta / 'anterior'
    exigir(sha(arquivo(ROOT / 'configuracao/operacao.json')) in
           {e['preflight']['configAntesSha256'], sha(arquivo(b / 'config-candidata.json')),
            sha(arquivo(b / 'config-retorno.json'))}, 'RETORNO_CONFIG_ALHEIA')
    exigir(sha(arquivo(ROOT / 'compose.operacao.yml')) in
           {e['preflight']['composeAntesSha256'], sha(arquivo(b / 'compose-candidata.json')),
            sha(arquivo(b / 'compose-retorno.json'))}, 'RETORNO_COMPOSE_ALHEIO')
    salvar_estado(pasta, e, 'retornando')
    comando(['docker', 'stop', '--time', '35', APP])
    trocar_release(b / 'release', ROOT / ('release-recusada-' + e['id'] + '-' + uuid.uuid4().hex))
    for n in FERRAMENTAS:
        if (b / 'ferramentas' / n).exists():
            gravar(ROOT / 'ferramentas' / n, arquivo(b / 'ferramentas' / n))
        elif (ROOT / 'ferramentas' / n).exists():
            destino = pasta / ('ferramenta-retirada-' + uuid.uuid4().hex + '-' + n)
            os.rename(ROOT / 'ferramentas' / n, destino)
    gravar(ROOT / 'configuracao/operacao.json', arquivo(b / 'config-retorno.json', True))
    gravar(ROOT / 'compose.operacao.yml', arquivo(b / 'compose-retorno.json', True))
    iniciar()
    conferir_saude(False)
    conferir_config_instalada(pasta, retorno=True)
    e.update(retornoConfirmado=True, bancoRestaurado=False, sql036Revertida=False)
    salvar_estado(pasta, e, 'retornada')
    return {'id': e['id'], 'fase': e['fase'], 'enviosHabilitados': False, 'bancoRestaurado': False}


def instalar(plano, pasta, candidata, conferencia):
    estado_p = pasta / 'estado.json'
    if estado_p.exists():
        e = ler(estado_p, True)
        exigir(e['conferenciaSha256'] == conferencia and e['preflight']['planoSha256'] == sha(serializar(plano)), 'RETOMADA_DIVERGENTE')
        if e['fase'] == 'concluida':
            validar_backup_local(pasta, e)
            conferir_config_instalada(pasta)
            conferir_release(ROOT / 'release', plano['runtimeSha256'], plano['manifestoSha256'])
            conferir_saude(True)
            return {'id': plano['id'], 'fase': 'concluida', 'repeticaoSemMudanca': True, 'enviosHabilitados': False}
        if e['fase'] == 'retornada':
            validar_backup_local(pasta, e)
            conferir_config_instalada(pasta, retorno=True)
            conferir_saude(False)
            return {'id': plano['id'], 'fase': 'retornada', 'novaInstalacaoExigeNovoId': True}
        if e['fase'] not in ['preservada', 'backup_confirmado']:
            return retornar(pasta, e)
        validar_backup_local(pasta, e)
        exigir(sha(arquivo(ROOT / 'configuracao/operacao.json')) == e['preflight']['configAntesSha256']
               and sha(arquivo(ROOT / 'compose.operacao.yml')) == e['preflight']['composeAntesSha256'], 'RETOMADA_CONFIG_ALTERADA')
    else:
        prova, cfg, compose = preflight(plano, candidata)
        exigir(sha(serializar(prova)) == conferencia, 'CONFERENCIA_PREVIA_DIVERGENTE')
        e = preservar(pasta, prova, cfg, compose)
    if e['fase'] == 'preservada':
        e['checkpointAntes'] = novo_checkpoint(e['preservadaEm'])
        salvar_estado(pasta, e, 'backup_confirmado')
    conferir_release(candidata, plano['runtimeSha256'], plano['manifestoSha256'])
    sem_janela()
    exigir(sha(arquivo(ROOT / 'configuracao/operacao.json')) == e['preflight']['configAntesSha256']
           and sha(arquivo(ROOT / 'compose.operacao.yml')) == e['preflight']['composeAntesSha256'],
           'CONFIG_ALTERADA_DURANTE_BACKUP')
    # Todo passo operacional fica depois do checkpoint completo da cópia privada.
    try:
        with bloquear_checkpoint():
            salvar_estado(pasta, e, 'sql_iniciado')
            comando(['docker', 'stop', '--time', '35', APP])
            aplicar_sql_candidata(candidata)
            salvar_estado(pasta, e, 'sql_confirmado')
            trocar_release(candidata, ROOT / ('release-retirada-' + plano['id']))
            for n in FERRAMENTAS:
                gravar(ROOT / 'ferramentas' / n, arquivo(candidata / 'ferramentas' / n))
            gravar(ROOT / 'configuracao/operacao.json', arquivo(pasta / 'anterior/config-candidata.json', True))
            gravar(ROOT / 'compose.operacao.yml', arquivo(pasta / 'anterior/compose-candidata.json', True))
            iniciar()
            conferir_saude(True)
            conferir_config_instalada(pasta)
            conferir_release(ROOT / 'release', plano['runtimeSha256'], plano['manifestoSha256'])
            salvar_estado(pasta, e, 'candidata_instalada')
        e['checkpointDepois'] = novo_checkpoint(e['atualizadaEm'])
        salvar_estado(pasta, e, 'concluida')
        return {'id': plano['id'], 'fase': e['fase'], 'runtimeSha256': plano['runtimeSha256'],
                'checkpointAntes': e['checkpointAntes'], 'checkpointDepois': e['checkpointDepois'],
                'sql036Sha256': SQL_SHA, 'enviosHabilitados': False, 'janelaIniciada': False}
    except Exception:
        if e['fase'] == 'backup_confirmado':
            raise  # Lock ocupado antes da troca: aplicação continua intacta.
        try:
            retornar(pasta, e)
        except Exception:
            # Freio final: nunca deixar execução nova sem saúde conferida.
            subprocess.run(['docker', 'stop', '--time', '35', APP], capture_output=True, timeout=50)
            salvar_estado(pasta, e, 'retorno_pendente')
            exigir(False, 'RETORNO_NAO_CONFIRMADO_APP_DESARMADA_CONFERIR')
        exigir(False, 'INSTALACAO_FALHOU_RETORNO_CONFIRMADO')


def main():
    os.umask(0o077)
    sys.dont_write_bytecode = True
    parser = argparse.ArgumentParser(description=__doc__)
    grupo = parser.add_mutually_exclusive_group(required=True)
    for modo in ['verificar', 'aplicar', 'retornar']:
        grupo.add_argument('--' + modo, action='store_true')
    parser.add_argument('plano', type=Path)
    parser.add_argument('--conferencia')
    a = parser.parse_args()
    exigir(os.name == 'posix' and fcntl is not None and ROOT.resolve() == ROOT, 'LINUX_PRIVADO_EXIGIDO')
    plano, pasta, candidata = carregar_plano(a.plano)
    if a.verificar:
        if (pasta / 'estado.json').exists():
            e = ler(pasta / 'estado.json', True)
            exigir(e['preflight']['planoSha256'] == sha(serializar(plano)), 'PLANO_ALTERADO')
            print(json.dumps({'id': plano['id'], 'fase': e['fase'], 'conferenciaSha256': e['conferenciaSha256'], 'somenteLeitura': True}))
        else:
            r, _, _ = preflight(plano, candidata)
            print(json.dumps({**r, 'conferenciaSha256': sha(serializar(r)), 'somenteLeitura': True}))
        return
    exigir(SHA.fullmatch(str(a.conferencia)), 'CONFERENCIA_PREVIA_EXIGIDA')
    # Mesmo lock do corte impede instalação concorrente com transferência real.
    with (ROOT / 'configuracao/corte/controle.lock').open('a') as lock:
        os.fchmod(lock.fileno(), 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if a.retornar:
            e = ler(pasta / 'estado.json', True)
            exigir(e['conferenciaSha256'] == a.conferencia, 'RETOMADA_DIVERGENTE')
            sem_janela()
            desarmada(ler(ROOT / 'configuracao/operacao.json', True))
            r = retornar(pasta, e)
        else:
            r = instalar(plano, pasta, candidata, a.conferencia)
        print(json.dumps(r))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        codigo = str(exc)
        print(codigo if re.fullmatch(r'CANDIDATA_CHAT_[A-Z0-9_]+', codigo)
              else 'CANDIDATA_CHAT_FALHOU_CONFERIR_ESTADO_PRIVADO', file=sys.stderr)
        sys.exit(1)
