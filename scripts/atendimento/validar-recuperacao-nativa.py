"""Compara COPY do export real com banco isolado; registros nunca saem em stdout."""
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys
import traceback
import uuid
from datetime import datetime, timezone

ROOT = None
NAME = 'grazing-donatella-recuperacao-v2-banco'


def raiz_privada(r2=False, environment=None):
    environment = os.environ if environment is None else environment
    variable = 'ATENDIMENTO_RAIZ_RECUPERACAO_R2' if r2 else 'ATENDIMENTO_RAIZ_RECUPERACAO'
    value = environment.get(variable, '')
    candidate = pathlib.Path(value)
    if not value or value == '/' or not candidate.is_absolute() or str(candidate) != value or '..' in candidate.parts or any(c.isspace() for c in value):
        raise SystemExit('RECUPERACAO_RAIZ_PRIVADA_OBRIGATORIA')
    if candidate.resolve(strict=True) != candidate or not candidate.is_dir() or candidate.is_symlink():
        raise SystemExit('RECUPERACAO_RAIZ_PRIVADA_RECUSADA')
    return candidate


def query(sql):
    result = subprocess.run(
        ['docker', 'exec', '-i', NAME, 'psql', '-X', '-qAt', '-v',
         'ON_ERROR_STOP=1', '-h', '/tmp', '-U', 'postgres', '-d', 'postgres'],
        input=sql.encode(), capture_output=True, check=False,
    )
    if result.returncode:
        with open(ROOT / 'validacao-erro-privado.log', 'ab') as output:
            os.chmod(output.name, 0o600)
            output.write(result.stderr)
        raise RuntimeError('Consulta de recuperação falhou; diagnóstico privado preservado.')
    return result.stdout


def digest(rows):
    value = hashlib.sha256()
    for row in sorted(rows):
        value.update(row + b'\n')
    return value.hexdigest()


def main():
    global ROOT, NAME
    os.umask(0o077)
    args = sys.argv[1:]
    r2 = bool(args and args[0] == '--r2')
    ROOT = raiz_privada(r2)
    if r2:
        NAME = 'grazing-donatella-recuperacao-r2-v2-banco'
        args = args[1:]
        r2_proof = json.loads((ROOT / 'prova-r2.json').read_text(encoding='utf-8'))
        assert r2_proof['origemExclusiva'] == 'R2' and r2_proof['cacheLocalUsado'] is False
    assert ROOT.is_dir() and not ROOT.is_symlink()
    assert (ROOT / 'restauracao.concluida').is_file()
    assert args in ([], ['--revalidar']), 'Argumento inválido.'
    proof_path = ROOT / ('recuperacao-revalidada-' + str(uuid.uuid4()) + '.json' if args else 'recuperacao-validada.json')
    assert not proof_path.exists(), 'Comprovante existente: não sobrescrever.'
    settings = json.loads(query("""
      SELECT json_build_object(
        'workers',current_setting('max_worker_processes')::int,
        'cron',current_setting('cron.launch_active_jobs'),
        'listen',current_setting('listen_addresses'),
        'workersOperacionais',(SELECT count(*) FROM pg_stat_activity
          WHERE backend_type ILIKE '%pg_net%' OR backend_type ILIKE '%cron%'));
    """))
    assert settings == {'workers': 0, 'cron': 'off', 'listen': '', 'workersOperacionais': 0}
    inspect = json.loads(subprocess.check_output(['docker', 'inspect', NAME]))[0]
    assert inspect['HostConfig']['NetworkMode'] == 'none'
    assert not inspect['HostConfig']['PortBindings']
    data_path = ROOT / ('dados-export-privados-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '.sql')
    assert not data_path.exists()
    with open(data_path, 'xb') as output, open(ROOT / 'export.backup', 'rb') as source:
        result = subprocess.run(
            ['docker', 'exec', '-i', NAME, 'pg_restore', '--data-only', '--file=-'],
            stdin=source, stdout=output, stderr=subprocess.PIPE, check=False,
        )
        if result.returncode:
            with open(ROOT / 'extracao-erro-privado.log', 'ab') as output:
                os.chmod(output.name, 0o600)
                output.write(result.stderr)
            raise RuntimeError('Extração privada do archive falhou.')
    tables = []
    with open(data_path, 'rb') as source:
        for line in source:
            if not line.startswith(b'COPY '):
                continue
            header = line.decode().strip()
            assert re.fullmatch(r'COPY [\w".]+ \([\w", ]+\) FROM stdin;', header)
            rows = []
            for row in source:
                if row.rstrip(b'\r\n') == b'\\.':
                    break
                rows.append(row.rstrip(b'\n'))
            else:
                raise RuntimeError('COPY incompleto no arquivo real.')
            recovered = query(
                "BEGIN READ ONLY; SET search_path=''; SET timezone='UTC'; SET datestyle='ISO'; "
                "SET extra_float_digits=3; SET bytea_output='hex'; "
                + header.replace('FROM stdin;', 'TO STDOUT;') + ' ROLLBACK;'
            ).splitlines()
            expected_hash = digest(rows)
            recovered_hash = digest(recovered)
            tables.append({'table': header.split(' (')[0][5:], 'count': len(rows),
                           'restoredCount': len(recovered), 'sha256': expected_hash,
                           'restoredSha256': recovered_hash,
                           'equal': len(rows) == len(recovered) and expected_hash == recovered_hash})
    health = json.loads(query("""
      SELECT json_build_object(
        'publicTables',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relkind='r'),
        'invalidIndexes',(SELECT count(*) FROM pg_index WHERE NOT indisvalid),
        'notValidatedConstraints',(SELECT count(*) FROM pg_constraint WHERE NOT convalidated),
        'realtimePayloadCheckViolations',(SELECT count(*) FROM realtime.messages
          WHERE payload IS NOT NULL AND binary_payload IS NOT NULL),
        'vaultSecrets',(SELECT count(*) FROM vault.secrets),
        'cronJobs',(SELECT count(*) FROM cron.job),
        'cronRunsAfterRestore',(SELECT count(*) FROM cron.job_run_details
          WHERE start_time >= pg_postmaster_start_time()),
        'httpQueue',(SELECT count(*) FROM net.http_request_queue),
        'authUsers',(SELECT count(*) FROM auth.users),
        'storageObjects',(SELECT count(*) FROM storage.objects),
        'tableTriggers',(SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal),
        'policies',(SELECT count(*) FROM pg_policy),
        'eventTriggers',(SELECT count(*) FROM pg_event_trigger));
    """))
    sequences = []
    with open(data_path, 'r', encoding='utf-8') as source:
        for line in source:
            match = re.fullmatch(r"SELECT pg_catalog.setval\('([\w.\"]+)', (-?\d+), (true|false)\);\n", line)
            if match:
                name, value, called = match.groups()
                actual = query(f'SELECT last_value,is_called FROM {name};').decode().strip().split('|')
                sequences.append({'sequence': name, 'equal': actual == [value, 't' if called == 'true' else 'f']})
    assert sequences, 'Nenhuma sequence comparada.'
    proof = {'timeUTC': datetime.now(timezone.utc).isoformat(), 'realNativeRestore': True,
             'sourceR2Only': r2,
             'equalAllTableData': bool(tables) and all(t['equal'] for t in tables),
             'tables': tables, 'sequences': sequences, 'health': health, 'isolation': settings,
             'storagePhysicalFilesIncluded': False,
             'globalRoleAttributesIncludedInNativeExport': False,
             'ownerAndAclRestored': True,
             'isolatedRoles': 'Auxiliares NOLOGIN; postgres/supabase_admin superusuários somente nesta recuperação.'}
    with open(proof_path, 'x', encoding='utf-8') as output:
        json.dump(proof, output, ensure_ascii=False, indent=2)
    print(json.dumps({'realNativeRestore': True, 'tablesCompared': len(tables),
                      'equalAllTableData': proof['equalAllTableData'],
                      'differentTables': [t['table'] for t in tables if not t['equal']],
                      'sequencesCompared': len(sequences), 'equalAllSequences': all(s['equal'] for s in sequences),
                      'totalRecords': sum(t['count'] for t in tables), 'health': health}))
    if not proof['equalAllTableData'] or not all(s['equal'] for s in sequences) or health['invalidIndexes'] or health['cronRunsAfterRestore'] or health['realtimePayloadCheckViolations']:
        raise RuntimeError('Recuperação ainda não passou todas as verificações.')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        if ROOT is not None:
            with open(ROOT / 'validacao-diagnostico-privado.log', 'a', encoding='utf-8') as output:
                os.chmod(output.name, 0o600)
                traceback.print_exc(file=output)
        print('Validação não concluída; investigar evidência privada antes de prosseguir.', file=sys.stderr)
        print(json.dumps({'type': type(error).__name__, 'line': traceback.extract_tb(error.__traceback__)[-1].lineno}), file=sys.stderr)
        sys.exit(1)
