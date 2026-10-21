"""Aplicação manual do SQL 039. Código usa a publicação oficial separada."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
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
LOCK_DRIVE = caminho_privado('ATENDIMENTO_PUBLICACAO_LOCK_DRIVE')
LOCK_CHECKPOINT = lock_checkpoint()
BACKUP_ROOT = caminho_privado('ATENDIMENTO_RAIZ_BACKUPS_MANUAIS')
DB = 'grazing-donatella-operacao-v2-banco'
SQL = '039-operacao-atividades-nomes.sql'

def exigir(ok, codigo):
    if not ok:
        raise RuntimeError('ATIVIDADES_' + codigo)

def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()

def cmd(args, entrada=None):
    r = subprocess.run(args, input=entrada, capture_output=True, text=True, timeout=90)
    exigir(r.returncode == 0, 'COMANDO_FALHOU')
    return r.stdout.strip()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--sql', required=True)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--manifesto-anterior', required=True)
    args = parser.parse_args()
    sql = Path(args.sql)
    exigir(sql.resolve() == sql and sql.name == SQL and sql.parent.parent == ROOT / 'candidatas', 'CAMINHO_RECUSADO')
    exigir(sha(sql) == args.sha256, 'SQL_DIVERGENTE')
    exigir(not (ROOT / 'release/sql' / SQL).exists(), 'SQL_JA_REGISTRADO')
    manifesto = ROOT / 'release/release.json'
    exigir(sha(manifesto) == args.manifesto_anterior, 'PUBLICACAO_PARALELA')
    config, compose = ROOT / 'configuracao/operacao.json', ROOT / 'compose.operacao.yml'
    config_hash, compose_hash = sha(config), sha(compose)
    estado = json.loads(cmd(['docker','inspect','grazing-donatella-operacao-v2']))[0]
    exigir(estado['State'].get('Health', {}).get('Status') == 'healthy', 'APP_NAO_SAUDAVEL')
    locks = []
    try:
        for p in [ROOT / 'publicacao.lock', LOCK_DRIVE, LOCK_CHECKPOINT]:
            exigir(p.parent.is_dir() and not p.is_symlink(), 'LOCK_RECUSADO')
            f = p.open('a')
            os.fchmod(f.fileno(), 0o600)
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            locks.append(f)
        exigir(sha(manifesto) == args.manifesto_anterior and sha(config) == config_hash and sha(compose) == compose_hash, 'PUBLICACAO_PARALELA')
        backup = BACKUP_ROOT / ('atividades-' + uuid.uuid4().hex)
        backup.mkdir(parents=True, mode=0o700)
        shutil.copytree(ROOT / 'release', backup / 'release-anterior')
        shutil.copytree(ROOT / 'configuracao', backup / 'configuracao-anterior')
        shutil.copy2(compose, backup / 'compose-anterior.yml')
        exigir(sha(backup / 'release-anterior/release.json') == args.manifesto_anterior and sha(backup / 'configuracao-anterior/operacao.json') == config_hash and sha(backup / 'compose-anterior.yml') == compose_hash, 'BACKUP_CONFIGURACAO_DIVERGENTE')
        dumps = {}
        for banco in ['donatella_operacao','donatella_entrada']:
            destino = backup / (banco + '.dump')
            with destino.open('xb') as f:
                os.fchmod(f.fileno(), 0o600)
                r = subprocess.run(['docker','exec',DB,'pg_dump','-U','donatella_operacao_admin','-d',banco,'-Fc'], stdout=f, stderr=subprocess.PIPE, timeout=90)
            exigir(r.returncode == 0 and destino.stat().st_size > 1000, 'BACKUP_FALHOU')
            with destino.open('rb') as f:
                r = subprocess.run(['docker','exec','-i',DB,'pg_restore','--file=/dev/null'], stdin=f, capture_output=True, timeout=90)
            exigir(r.returncode == 0, 'BACKUP_ILEGIVEL')
            dumps[banco] = {'sha256':sha(destino),'leituraIntegral':True}
        for banco in ['donatella_ensaio_operacao','donatella_operacao']:
            cmd(['docker','exec','-i',DB,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','donatella_operacao_admin','-d',banco], sql.read_text())
        exigir(sha(config) == config_hash and sha(compose) == compose_hash and sha(manifesto) == args.manifesto_anterior, 'ORIGEM_ALTERADA')
        # O instalador oficial preserva os auxiliares/SQL da release ativa.
        destino_sql = ROOT / 'release/sql' / SQL
        exigir(not destino_sql.exists(), 'SQL_JA_REGISTRADO')
        shutil.copy2(sql, destino_sql)
        atual = json.loads(manifesto.read_text())
        atual.setdefault('sqlSha256', {})[SQL] = sha(sql)
        manifesto.write_text(json.dumps(atual, indent=2) + '\n')
        manifesto.chmod(0o600)
        recibo = {'sqlAplicado':SQL,'sqlSha256':sha(sql),'backup':str(backup),'dumps':dumps,'configuracaoPreservada':True,'codigoPreservado':True,'bancoRestaurado':False}
        registro = backup / 'sql-aplicado.json'
        registro.write_text(json.dumps(recibo, indent=2))
        registro.chmod(0o600)
        print(json.dumps(recibo))
    finally:
        for f in reversed(locks):
            f.close()

if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(json.dumps({'erro':str(e) if isinstance(e, RuntimeError) else type(e).__name__}))
        raise SystemExit(1)
