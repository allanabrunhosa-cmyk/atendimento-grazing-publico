"""Prepara SQL/capacidades com a IA OFF. Não reinicia, infere ou envia.

O publicador oficial instala o código em etapa separada. Este utilitário exige
backup Drive atual e relido, preserva cópias privadas locais e nunca restaura DB.
"""
import argparse
import copy
import datetime
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
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

def lock_checkpoint():
    raiz = caminho_privado('ATENDIMENTO_RAIZ_CHECKPOINT_OPERACAO_R2')
    lock = raiz / 'exclusao.lock'
    nome = 'ATENDIMENTO_PUBLICACAO_LOCK_CHECKPOINT'
    if nome in os.environ and caminho_privado(nome) != lock:
        raise RuntimeError('ATENDIMENTO_LOCK_CHECKPOINT_DIVERGENTE')
    return lock


ROOT = caminho_privado('ATENDIMENTO_RAIZ_REMOTA_OPERACAO')
APP = 'grazing-donatella-operacao-v2'
DB = APP + '-banco'
SQL = '041-agente-controle-painel.sql'
MARKER = 'preparacao_painel_sql041'
DATABASES = ['donatella_ensaio_operacao', 'donatella_operacao']
DIARY = caminho_privado('ATENDIMENTO_DIARIO_RESERVAS')
DRIVE_STATE = caminho_privado('ATENDIMENTO_ESTADO_DRIVE')
LOCKS = [ROOT / 'publicacao.lock', caminho_privado('ATENDIMENTO_PUBLICACAO_LOCK_DRIVE'),
         lock_checkpoint()]


def require(ok, code):
    if not ok:
        raise RuntimeError('PAINEL_DONATELLA_' + code)


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def regular(path):
    require(path.is_absolute() and path.resolve() == path and path.is_file() and
            not path.is_symlink(), 'ARQUIVO_RECUSADO')


def run(args, data=None, timeout=90):
    r = subprocess.run(args, input=data, capture_output=True, text=True, timeout=timeout)
    require(r.returncode == 0, 'COMANDO_FALHOU')
    return r.stdout.strip()


def atomic(path, data):
    temporary = path.with_name(path.name + '.painel-pendente')
    require(not temporary.exists(), 'ARQUIVO_PENDENTE_CONFERIR')
    with temporary.open('xb') as target:
        os.fchmod(target.fileno(), 0o600)
        target.write(data)
        target.flush()
        os.fsync(target.fileno())
    os.replace(temporary, path)
    fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def private_json(path, value):
    atomic(path, (json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode())


def psql(database, text, readonly=False):
    require(database in DATABASES + ['donatella_entrada'], 'BANCO_RECUSADO')
    script = ('BEGIN READ ONLY;\n' + text + '\nROLLBACK;' if readonly else text)
    return run(['docker', 'exec', '-i', DB, 'psql', '-X', '-qAt', '-v',
                'ON_ERROR_STOP=1', '-U', 'donatella_operacao_admin', '-d', database], script)


def agent_off(database):
    value = psql(database, "SELECT count(*)=1 AND bool_and(conteudo->>'modo'='desligado' AND conteudo->>'autoridadeAutomatica'='false') FROM atendimento_operacao.configuracao WHERE chave='agente';", True)
    require(value == 't', 'AGENTE_NAO_ESTA_OFF')


def rehearsal_state():
    text = psql('donatella_ensaio_operacao', "SELECT json_build_object('versao',versao,'conteudo',conteudo) FROM atendimento_operacao.configuracao WHERE chave='agente';", True)
    value = json.loads(text)
    content = value.get('conteudo', {})
    require(isinstance(value.get('versao'), int) and value['versao'] > 0 and
            content.get('modo') in ['desligado', 'rascunho', 'automatico'] and
            isinstance(content.get('autoridadeAutomatica'), bool), 'ENSAIO_CONFIGURACAO_INVALIDA')
    return {**value, 'necessitaPausa': content['modo'] != 'desligado' or content['autoridadeAutomatica']}


def pause_rehearsal(previous, expected_sql):
    # Estado anterior completo fica só no backup privado. O comando recebe um
    # hash estável e um UUID determinístico; uma retomada não incrementa versão.
    identity = str(uuid.uuid5(uuid.NAMESPACE_URL, 'grazing:preparar-ensaio-off:' + expected_sql))
    canonical = json.dumps(previous, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
    fingerprint = hashlib.sha256(canonical.encode()).hexdigest()
    content = json.dumps(previous['conteudo'], ensure_ascii=False).replace("'", "''")
    version = previous['versao']
    actor = 'service:preparacao-donatella'
    script = """BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
DO $pausa$ DECLARE atual record; anterior record; nova_versao bigint;
BEGIN
 IF current_database()<>'donatella_ensaio_operacao' THEN
  RAISE EXCEPTION 'PAINEL_DONATELLA_PAUSA_FORA_ENSAIO_RECUSADA';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('preparacao-donatella-ensaio-off',0));
 SELECT * INTO STRICT atual FROM atendimento_operacao.configuracao WHERE chave='agente' FOR UPDATE;
 SELECT * INTO anterior FROM atendimento_operacao.comando WHERE id='__ID__'::uuid;
 IF FOUND THEN
  IF anterior.autor_id<>'__ACTOR__' OR anterior.hash<>'__HASH__' OR atual.conteudo->>'modo'<>'desligado' OR atual.conteudo->>'autoridadeAutomatica'<>'false' THEN
   RAISE EXCEPTION 'PAINEL_DONATELLA_PAUSA_ENSAIO_DIVERGENTE';
  END IF;
  RETURN;
 END IF;
 IF atual.versao<>__VERSION__ OR atual.conteudo IS DISTINCT FROM '__CONTENT__'::jsonb THEN
  RAISE EXCEPTION 'PAINEL_DONATELLA_ENSAIO_ALTERADO';
 END IF;
 UPDATE atendimento_operacao.configuracao SET conteudo=jsonb_set(jsonb_set(conteudo,'{modo}','"desligado"'::jsonb),'{autoridadeAutomatica}','false'::jsonb),versao=versao+1,atualizada_em=now() WHERE chave='agente' RETURNING versao INTO nova_versao;
 -- Mesma invalidação de invalidarConfiguracaoAgenteTx. Só intenções/timers
 -- pendentes são cancelados. Recibos aceitos/processando permanecem preservados.
 WITH canceladas AS (
  UPDATE atendimento_operacao.intencao i SET estado='cancelado',codigo='AGENTE_CONFIGURACAO_ALTERADA',atualizada_em=now()
  WHERE i.estado='pendente' AND i.autor_id='service:donatella-ia' AND (
   EXISTS(SELECT 1 FROM atendimento_operacao.agente_tarefa a WHERE a.empresa_id='grazing' AND a.intencao_id=i.id) OR
   EXISTS(SELECT 1 FROM atendimento_operacao.timer t JOIN atendimento_operacao.agente_tarefa a ON a.id=(t.conteudo->>'tarefaId')::uuid WHERE a.empresa_id='grazing' AND t.intencao_id=i.id) OR
   EXISTS(SELECT 1 FROM atendimento_operacao.alerta_apoio a WHERE a.empresa_id='grazing' AND a.intencao_id=i.id)) RETURNING mensagem_id
 ) UPDATE atendimento_operacao.mensagem SET estado='cancelado' WHERE id IN (SELECT mensagem_id FROM canceladas);
 UPDATE atendimento_operacao.agente_tarefa a SET decisao_invalidada=coalesce(a.decisao_invalidada,a.decisao),decisao='{"estado":"invalidado","motivo":"AGENTE_CONFIGURACAO_ALTERADA","fontes":[],"enviosReais":false}'::jsonb,lease=NULL,lease_ate=NULL,automatico_preparado=false,atualizada_em=now()
 WHERE a.empresa_id='grazing' AND a.configuracao_versao<>nova_versao AND (a.decisao IS NULL OR a.decisao->>'estado' IN ('apoio_pendente','aguardando_apoio') OR a.decisao->>'estado'='rascunho' AND (a.intencao_id IS NULL OR EXISTS(SELECT 1 FROM atendimento_operacao.intencao i WHERE i.id=a.intencao_id AND i.estado IN ('pendente','processando','cancelado'))));
 UPDATE atendimento_operacao.timer t SET estado='cancelado',codigo='AGENTE_CONFIGURACAO_ALTERADA' FROM atendimento_operacao.agente_tarefa a WHERE a.empresa_id='grazing' AND a.id=(t.conteudo->>'tarefaId')::uuid AND t.estado='pendente';
 UPDATE atendimento_operacao.alerta_apoio SET estado='cancelado',codigo='AGENTE_CONFIGURACAO_ALTERADA',atualizada_em=now() WHERE empresa_id='grazing' AND estado='pendente';
 IF to_regclass('atendimento_operacao.agente_controle') IS NOT NULL THEN
  EXECUTE 'UPDATE atendimento_operacao.agente_controle SET ativada_em=NULL,alterada_em=now(),autor_id=$1,configuracao_versao=$2 WHERE empresa_id=''grazing''' USING '__ACTOR__',nova_versao;
 END IF;
 INSERT INTO atendimento_operacao.auditoria(id,autor_id,autor_nome,entidade_id,acao,versao) VALUES('__ID__'::uuid,'__ACTOR__','Preparação Donatella — ensaio','agente','preparar_ensaio_desligado',nova_versao);
 INSERT INTO atendimento_operacao.comando(id,autor_id,hash,resultado) VALUES('__ID__'::uuid,'__ACTOR__','__HASH__',jsonb_build_object('ensaioPausado',true,'versaoAnterior',atual.versao,'versaoNova',nova_versao,'modo','desligado','autoridadeAutomatica',false));
END $pausa$;
COMMIT;
""".replace('__ID__', identity).replace('__ACTOR__', actor).replace('__HASH__', fingerprint).replace('__VERSION__', str(version)).replace('__CONTENT__', content)
    psql('donatella_ensaio_operacao', script)
    agent_off('donatella_ensaio_operacao')
    return {'idempotencia': identity, 'ensaioPausado': True, 'versaoAnterior': version,
            'banco': 'donatella_ensaio_operacao', 'producaoAlterada': False}


def private_configuration(value):
    require(isinstance(value, dict) and value.get('versao') == 1 and
            value.get('modo') == 'operacao' and value.get('autoridade') == 'vps' and
            value.get('enviosHabilitados') is True and
            value.get('escopoOperacional') == 'chat_humano' and
            value.get('corteMinimoChat', {}).get('fase') == 'humano' and
            value.get('iaAutomatica') is False and
            value.get('voz', {}).get('sinteseHabilitada') is False and
            value.get('woocommerce', {}).get('automacoesHabilitadas') is False and
            value.get('automacoesHabilitadas') is not True, 'CONFIGURACAO_FORA_ESCOPO')
    require(value.get('orcamentoIAcentavos') == 500 and
            value.get('autorizacaoOrcamentoIA', {}).get('testesCentavosUSD') == 1000 and
            value.get('autorizacaoOrcamentoIA', {}).get('diarioFuturoCentavosUSD') == 500,
            'ORCAMENTO_DIVERGENTE')
    require(isinstance(value.get('ia', {}).get('apiKey'), str) and
            bool(value['ia']['apiKey']) and bool(value['ia'].get('model')), 'IA_NAO_CONFIGURADA')


def prepare_configuration(before):
    private_configuration(before)
    require(before['autorizacaoOrcamentoIA'].get('reservaHistoricaTestesCentavosUSD') in [None, 450],
            'RESERVA_HISTORICA_DIVERGENTE')
    result = copy.deepcopy(before)
    result['painelDonatellaPreparado'] = True
    result['autorizacaoOrcamentoIA']['reservaHistoricaTestesCentavosUSD'] = 450
    conference = result.setdefault('conferenciaIA', {}).setdefault('anthropic', {})
    conference['creditoApiConfirmado'] = True
    conference['fonteCreditoApi'] = 'confirmado_proprietario_20261019'
    private_configuration(result)
    return result


def verify_diary(expected):
    regular(DIARY)
    require(sha(DIARY) == expected, 'DIARIO_ALTERADO')
    diary = json.loads(DIARY.read_text())
    require(isinstance(diary, list) and len(diary) == 9 and
            all(isinstance(v, dict) and v.get('reservadoCentavosUSD') == 50 for v in diary) and
            sum(v['reservadoCentavosUSD'] for v in diary) == 450, 'DIARIO_DIVERGENTE')
    authorization = DIARY.parent.parent / 'prova.json'
    regular(authorization)
    private = json.loads(authorization.read_text())
    require(private.get('autorizacao') == 'testes-ficticios-USD10-20261010' and
            private.get('tetoCentavosUSD') == 1000, 'AUTORIZACAO_TESTES_DIVERGENTE')


def verify_drive(snapshot, config_hash, compose_hash):
    receipt_path = DRIVE_STATE / 'operation-latest.json'
    regular(receipt_path)
    receipt = json.loads(receipt_path.read_text())
    cutover = DRIVE_STATE / 'cutover.json'
    regular(cutover)
    require(json.loads(cutover.read_text()).get('driveOnly') is True, 'DRIVE_NAO_EXCLUSIVO')
    require(receipt.get('system') == 'operation' and receipt.get('snapshot') == snapshot and
            receipt.get('externalReadVerified') is True and receipt.get('failure') is None,
            'BACKUP_DRIVE_NAO_COMPROVADO')
    verified = datetime.datetime.fromisoformat(receipt['verifiedAt'].replace('Z', '+00:00'))
    age = (datetime.datetime.now(datetime.timezone.utc) - verified).total_seconds()
    require(0 <= age <= 7200, 'BACKUP_DRIVE_DESATUALIZADO')
    dumps = {v.get('database'): v for v in receipt.get('dumps', []) if v.get('database')}
    require(all(name in dumps and re.fullmatch('[a-f0-9]{64}', dumps[name].get('sha256', '')) and
                dumps[name].get('bytes', 0) > 1000 for name in ['donatella_operacao', 'donatella_entrada']),
            'BACKUP_DRIVE_DUMPS_AUSENTES')
    helper = Path('/usr/local/lib/grazing-backups-drive/drive_common.py')
    regular(helper)
    spec = importlib.util.spec_from_file_location('drive_common_painel', helper)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    repo = module.Restic('operation')
    # Bytes secretos ficam apenas em memória. Nenhuma chave ou conteúdo é impresso.
    for remote, expected in [('/configuracao/operacao.json', config_hash),
                             ('/metadata/compose.operacao.yml', compose_hash)]:
        require(hashlib.sha256(repo.read(snapshot, remote)).hexdigest() == expected,
                'BACKUP_DRIVE_CONFIGURACAO_DIVERGENTE')
    return {'snapshot': snapshot, 'verificadoEm': receipt['verifiedAt'],
            'releituraConfigCompose': True, 'dumpsExternosVerificados': True}


def copy_private(source, target):
    require(not target.exists(), 'BACKUP_DESTINO_EXISTENTE')
    if source.is_dir():
        require(not source.is_symlink() and not any(p.is_symlink() for p in source.rglob('*')),
                'BACKUP_SYMLINK_RECUSADO')
        shutil.copytree(source, target)
        for path in [target, *target.rglob('*')]:
            path.chmod(0o700 if path.is_dir() else 0o600)
    else:
        regular(source)
        shutil.copy2(source, target)
        target.chmod(0o600)


def inventory(folder):
    require(not folder.is_symlink() and not any(p.is_symlink() for p in folder.rglob('*')),
            'BACKUP_SYMLINK_RECUSADO')
    return {str(path.relative_to(folder)): sha(path) for path in folder.rglob('*') if path.is_file()}


def dump_database(database, backup):
    path = backup / (database + '.dump')
    with path.open('xb') as target:
        os.fchmod(target.fileno(), 0o600)
        r = subprocess.run(['docker', 'exec', DB, 'pg_dump', '-U', 'donatella_operacao_admin',
                            '-d', database, '-Fc', '--lock-wait-timeout=3s'], stdout=target,
                           stderr=subprocess.PIPE, timeout=180)
        target.flush()
        os.fsync(target.fileno())
    require(r.returncode == 0 and path.stat().st_size > 1000, 'BACKUP_FALHOU')
    with path.open('rb') as source:
        r = subprocess.run(['docker', 'exec', '-i', DB, 'pg_restore', '--file=/dev/null'],
                           stdin=source, capture_output=True, timeout=180)
    require(r.returncode == 0, 'BACKUP_ILEGIVEL')
    return {'sha256': sha(path), 'bytes': path.stat().st_size, 'leituraIntegral': True}


def marker(database):
    text = psql(database, "SELECT coalesce((SELECT conteudo->>'sha256' FROM atendimento_operacao.configuracao WHERE chave='" + MARKER + "'),'');", True)
    return text


def apply_sql(database, text, expected):
    agent_off(database)
    previous = marker(database)
    if previous:
        require(previous == expected, 'SQL_REGISTRO_DIVERGENTE')
        return False
    require(psql(database, "SELECT to_regclass('atendimento_operacao.agente_controle') IS NULL AND to_regclass('atendimento_operacao.agente_teste') IS NULL;", True) == 't',
            'SQL_SEM_REGISTRO_CONFERIR')
    require(text.strip().endswith('COMMIT;') and text.count('COMMIT;') == 1, 'SQL_TRANSACAO_INVALIDA')
    require(text.count('BEGIN;') == 1, 'SQL_TRANSACAO_INVALIDA')
    guard = """BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
SELECT versao FROM atendimento_operacao.configuracao WHERE chave='agente' FOR UPDATE;
DO $painel$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM atendimento_operacao.configuracao WHERE chave='agente' AND conteudo->>'modo'='desligado' AND conteudo->>'autoridadeAutomatica'='false') THEN
  RAISE EXCEPTION 'PAINEL_DONATELLA_AGENTE_NAO_ESTA_OFF';
 END IF;
END $painel$;
"""
    text = text.replace('BEGIN;', guard, 1)
    # Marcador e DDL pertencem ao mesmo commit. Uma interrupção não reaplica DDL.
    registration = "\nINSERT INTO atendimento_operacao.configuracao(chave,conteudo) VALUES('" + MARKER + "',jsonb_build_object('sha256','" + expected + "','arquivo','" + SQL + "','aplicadaEm',clock_timestamp()));\nCOMMIT;\n"
    psql(database, text[:text.rfind('COMMIT;')] + registration)
    require(marker(database) == expected, 'SQL_REGISTRO_AUSENTE')
    return True


def verify_schema(database, expected, require_off=True):
    require(marker(database) == expected, 'SQL_REGISTRO_AUSENTE')
    value = psql(database, """SELECT
      to_regclass('atendimento_operacao.agente_controle') IS NOT NULL AND
      to_regclass('atendimento_operacao.agente_teste') IS NOT NULL AND
      NOT EXISTS(SELECT 1 FROM (VALUES('atendimento_operacao.agente_controle'),('atendimento_operacao.agente_teste')) t(nome) CROSS JOIN (VALUES('SELECT'),('INSERT'),('UPDATE')) p(privilegio) WHERE NOT has_table_privilege('donatella_operacao_app',t.nome,p.privilegio)) AND
      has_table_privilege('donatella_operacao_backup','atendimento_operacao.agente_controle','SELECT') AND
      has_table_privilege('donatella_operacao_backup','atendimento_operacao.agente_teste','SELECT');""", True)
    require(value == 't', 'SQL_GRANTS_OU_ESTADO_DIVERGENTE')
    if require_off:
        require(psql(database, 'SELECT NOT EXISTS(SELECT 1 FROM atendimento_operacao.agente_controle WHERE ativada_em IS NOT NULL);', True) == 't', 'SQL_CONTROLE_NAO_ESTA_OFF')
        agent_off(database)


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    for name in ['sql', 'sha256', 'manifesto-anterior', 'configuracao-anterior',
                 'compose-anterior', 'diario-sha256', 'backup-drive-snapshot']:
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--aplicar', action='store_true')
    parser.add_argument('--pausar-ensaio', action='store_true',
                        help='Autoriza somente deixar o banco fictício de ensaio OFF após backup. Produção deve estar OFF.')
    args = parser.parse_args()
    for value in [args.sha256, args.manifesto_anterior, args.configuracao_anterior,
                  args.compose_anterior, args.diario_sha256, args.backup_drive_snapshot]:
        require(re.fullmatch('[a-f0-9]{64}', value), 'HASH_INVALIDO')
    sql = Path(args.sql)
    regular(sql)
    require(sql.name == SQL and sql.parent.parent == ROOT / 'candidatas' and
            sha(sql) == args.sha256, 'SQL_CAMINHO_OU_HASH_DIVERGENTE')
    sql_bytes = sql.read_bytes()
    require(hashlib.sha256(sql_bytes).hexdigest() == args.sha256, 'SQL_ALTERADO')
    sql_text = sql_bytes.decode('utf-8')
    config, compose, manifest = ROOT / 'configuracao/operacao.json', ROOT / 'compose.operacao.yml', ROOT / 'release/release.json'
    for path in [config, compose, manifest]:
        regular(path)
    expected = {'manifesto': args.manifesto_anterior, 'configuracao': args.configuracao_anterior,
                'compose': args.compose_anterior, 'sql': args.sha256, 'diario': args.diario_sha256,
                'snapshotDrive': args.backup_drive_snapshot, 'pausarEnsaio': args.pausar_ensaio}
    backup = ROOT / 'backups-prepublicacao' / ('painel-donatella-' + args.sha256[:16])
    require(backup.resolve() == backup and (not backup.exists() or backup.is_dir()),
            'BACKUP_CAMINHO_RECUSADO')
    journal_path = backup / 'preparacao.json'
    if journal_path.exists():
        regular(journal_path)
    journal = json.loads(journal_path.read_text()) if journal_path.exists() else None
    require(not journal or journal.get('origem') == expected, 'RETOMADA_DIVERGENTE')
    if journal and journal.get('fase') == 'concluida':
        require(sha(config) == journal['configuracaoNovaSha256'] and
                sha(compose) == journal['composeNovoSha256'] and
                sha(manifest) == journal['manifestoNovoSha256'], 'PREPARACAO_POSTERIOR_ALTERADA')
        for database in DATABASES:
            verify_schema(database, args.sha256)
        print(json.dumps(journal['recibo']))
        return
    locks = []
    try:
        for path in LOCKS:
            require(path.parent.is_dir() and not path.is_symlink(), 'LOCK_RECUSADO')
            handle = path.open('a')
            locks.append(handle)
            os.fchmod(handle.fileno(), 0o600)
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        require(sha(manifest) == args.manifesto_anterior or
                journal and sha(manifest) == journal.get('manifestoNovoSha256'), 'MANIFESTO_ALTERADO')
        old_config = backup / 'configuracao-anterior/operacao.json' if journal else config
        old_compose = backup / 'compose-anterior.yml' if journal else compose
        require(sha(old_config) == args.configuracao_anterior and sha(old_compose) == args.compose_anterior,
                'CONFIGURACAO_ORIGINAL_DIVERGENTE')
        before = json.loads(old_config.read_text())
        prepared = (json.dumps(prepare_configuration(before), indent=2, ensure_ascii=False) + '\n').encode()
        config_new = hashlib.sha256(prepared).hexdigest()
        compose_new = args.compose_anterior
        require(sha(config) in [args.configuracao_anterior, config_new] and
                sha(compose) in [args.compose_anterior, compose_new], 'CONFIGURACAO_PARALELA')
        verify_diary(args.diario_sha256)
        drive = verify_drive(args.backup_drive_snapshot, args.configuracao_anterior, args.compose_anterior)
        state = json.loads(run(['docker', 'inspect', APP]))[0]
        require(state['State']['Running'] and state['State'].get('Health', {}).get('Status') == 'healthy', 'APP_NAO_SAUDAVEL')
        env = state.get('Config', {}).get('Env', [])
        require('ATENDIMENTO_ENVIO_HABILITADO=true' in env and 'ATENDIMENTO_AUTORIDADE_ENVIO=vps' in env,
                'ENVIO_HUMANO_NAO_CONFIRMADO')
        agent_off('donatella_operacao')
        rehearsal = rehearsal_state()
        for database in DATABASES:
            registered = marker(database)
            if registered:
                require(registered == args.sha256, 'SQL_REGISTRO_DIVERGENTE')
                verify_schema(database, args.sha256, database == 'donatella_operacao' or not rehearsal['necessitaPausa'])
            else:
                require(psql(database, "SELECT to_regclass('atendimento_operacao.agente_controle') IS NULL AND to_regclass('atendimento_operacao.agente_teste') IS NULL;", True) == 't',
                        'SQL_SEM_REGISTRO_CONFERIR')
        if not args.aplicar:
            print(json.dumps({'verificado': True, 'backupDrive': drive, 'iaAutomatica': False,
                              'ensaioRequerPausa': rehearsal['necessitaPausa'],
                              'pausaEnsaioAutorizada': args.pausar_ensaio,
                              'aplicacaoPermitida': not rehearsal['necessitaPausa'] or args.pausar_ensaio,
                              'sqlExecutado': False, 'configuracaoAlterada': False, 'restartExecutado': False}))
            return
        require(not rehearsal['necessitaPausa'] or args.pausar_ensaio, 'PAUSAR_ENSAIO_EXPLICITO_EXIGIDO')
        if not journal:
            sizes = sum(int(psql(database, 'SELECT pg_database_size(current_database());', True))
                        for database in ['donatella_operacao', 'donatella_entrada', 'donatella_ensaio_operacao'])
            files = sum(path.stat().st_size for name in ['release', 'configuracao']
                        for path in (ROOT / name).rglob('*') if path.is_file())
            require(shutil.disk_usage(ROOT).free >= max(10 * 1024**3, 8 * 1024**3 + sizes * 2 + files * 2),
                    'ESPACO_LOCAL_INSUFICIENTE')
            backup.mkdir(parents=True, mode=0o700)
            copy_private(ROOT / 'release', backup / 'release-anterior')
            copy_private(ROOT / 'configuracao', backup / 'configuracao-anterior')
            copy_private(compose, backup / 'compose-anterior.yml')
            require(sha(backup / 'release-anterior/release.json') == args.manifesto_anterior and
                    sha(backup / 'configuracao-anterior/operacao.json') == args.configuracao_anterior and
                    sha(backup / 'compose-anterior.yml') == args.compose_anterior and
                    inventory(ROOT / 'release') == inventory(backup / 'release-anterior') and
                    inventory(ROOT / 'configuracao') == inventory(backup / 'configuracao-anterior'),
                    'BACKUP_CONFIGURACAO_DIVERGENTE')
            dumps = {database: dump_database(database, backup) for database in ['donatella_operacao', 'donatella_entrada', 'donatella_ensaio_operacao']}
            private_json(backup / 'agente-ensaio-anterior.json', rehearsal)
            journal = {'fase': 'backup_verificado', 'origem': expected, 'backupDrive': drive, 'dumps': dumps,
                       'ensaioAnterior': rehearsal,
                       'configuracaoNovaSha256': config_new, 'composeNovoSha256': compose_new}
            private_json(journal_path, journal)
        else:
            for database, proof in journal['dumps'].items():
                require(sha(backup / (database + '.dump')) == proof['sha256'], 'BACKUP_RETOMADA_DIVERGENTE')
        require('donatella_ensaio_operacao' in journal['dumps'] and
                sha(backup / 'agente-ensaio-anterior.json') == hashlib.sha256((json.dumps(journal['ensaioAnterior'], indent=2, ensure_ascii=False) + '\n').encode()).hexdigest(),
                'BACKUP_ENSAIO_AUSENTE_OU_DIVERGENTE')
        # A partir daqui, qualquer falha conserva backups, marcadores e bytes.
        # Nunca restaura DB/configuração nem repete uma migração já confirmada.
        agent_off('donatella_operacao')
        if journal['ensaioAnterior']['necessitaPausa']:
            require(args.pausar_ensaio, 'PAUSAR_ENSAIO_EXPLICITO_EXIGIDO')
            pause = pause_rehearsal(journal['ensaioAnterior'], args.sha256)
            journal['pausaEnsaio'] = pause
            journal['fase'] = 'ensaio_off_confirmado'
            private_json(journal_path, journal)
        agent_off('donatella_ensaio_operacao')
        for database in DATABASES:
            apply_sql(database, sql_text, args.sha256)
            verify_schema(database, args.sha256)
        verify_diary(args.diario_sha256)
        require(sha(config) in [args.configuracao_anterior, config_new] and
                sha(compose) in [args.compose_anterior, compose_new], 'CONFIGURACAO_PARALELA')
        require(sha(manifest) == args.manifesto_anterior or
                sha(manifest) == journal.get('manifestoNovoSha256'), 'MANIFESTO_ALTERADO')
        if sha(config) != config_new:
            atomic(config, prepared)
        destination_sql = ROOT / 'release/sql' / SQL
        if destination_sql.exists():
            require(sha(destination_sql) == args.sha256, 'SQL_RELEASE_DIVERGENTE')
        else:
            atomic(destination_sql, sql_bytes)
        current = json.loads(manifest.read_text())
        current.setdefault('sqlSha256', {})[SQL] = args.sha256
        target_manifest = (json.dumps(current, indent=2) + '\n').encode()
        journal['manifestoNovoSha256'] = hashlib.sha256(target_manifest).hexdigest()
        private_json(journal_path, journal)
        if sha(manifest) != journal['manifestoNovoSha256']:
            atomic(manifest, target_manifest)
        for database in DATABASES:
            verify_schema(database, args.sha256)
        after_state = json.loads(run(['docker', 'inspect', APP]))[0]
        require(after_state['Id'] == state['Id'] and
                after_state['State']['StartedAt'] == state['State']['StartedAt'], 'APP_REINICIADO_EXTERNAMENTE')
        private_configuration(json.loads(config.read_text()))
        receipt = {'preparadaEm': now(), 'sqlRegistrado': SQL, 'sqlSha256': args.sha256,
                   'manifestoSha256': sha(manifest), 'configuracaoSha256': sha(config), 'composeSha256': sha(compose),
                   'backup': str(backup), 'backupDriveAnterior': drive, 'dumps': journal['dumps'],
                   'iaAutomatica': False, 'modoPersistido': 'desligado', 'capacidadePainelPreparada': True,
                   'reservaHistoricaTestesCentavosUSD': 450, 'numeroWebhookCredenciaisPreservados': True,
                   'bancoRestaurado': False, 'restartExecutado': False, 'inferenciaExecutada': False,
                   'envioExecutado': False, 'composePreservado': sha(compose) == args.compose_anterior,
                   'pausaEnsaio': journal.get('pausaEnsaio', {'ensaioJaEstavaOff': True}),
                   'capacidadeIaPeloRuntime': 'configuracao_privada_preparada_com_modo_pg_off'}
        journal.update(fase='concluida', recibo=receipt)
        private_json(journal_path, journal)
        print(json.dumps(receipt))
    finally:
        for handle in reversed(locks):
            handle.close()


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'erro': str(error) if isinstance(error, RuntimeError) else type(error).__name__,
                          'preservacao': 'Não houve restauração, reinício, inferência ou envio por este utilitário.'}))
        raise SystemExit(1)
