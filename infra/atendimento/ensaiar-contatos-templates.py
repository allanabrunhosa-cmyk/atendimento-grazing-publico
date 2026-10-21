"""Banco exclusivo de fixtures, sem rede, portas, dados ou credenciais reais."""
import argparse
import json
import os
from pathlib import Path
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

PG = 'sha256:3645570cccdfa447589da9f57dd740faa29b30938e861289a5574b6ca6b03826'
NODE = 'sha256:4573af7c8fe8bc48827e88e39358fb5170e6ea319d1938152db5edad349a0ede'
parser = argparse.ArgumentParser()
parser.add_argument('--release', required=True)
args = parser.parse_args()
release = Path(args.release)
if not release.is_dir() or release.resolve() != release or not (release/'provas/contatos-templates-banco.mjs').is_file():
    raise RuntimeError('ENSAIO_RELEASE_RECUSADA')
identificador = uuid.uuid4().hex
stage = caminho_privado('ATENDIMENTO_RAIZ_ENSAIO_CONTATOS') / ('contatos-templates-'+identificador)
stage.mkdir(parents=True, mode=0o700)
socket = stage/'socket'
socket.mkdir(mode=0o777)
socket.chmod(0o777)
nome = 'donatella-contatos-templates-prova-'+identificador

def cmd(a, entrada=None, timeout=60):
    r = subprocess.run(a, input=entrada, text=True, capture_output=True, timeout=timeout)
    if r.returncode:
        # Apenas estes comandos e este banco têm dados fictícios.
        (stage/'erro-ficticio.log').write_text(r.stderr)
        raise RuntimeError('ENSAIO_COMANDO_FALHOU: '+a[0])
    return r.stdout.strip()

iniciado = False
try:
    cmd(['docker','run','-d','--name',nome,'--network','none','--label','grazing.finalidade=contatos-templates-fixtures',
         '--memory','384m','--cpus','0.5','--pids-limit','96','-e','POSTGRES_HOST_AUTH_METHOD=trust',
         '--mount','type=bind,src='+str(socket)+',dst=/socket',PG,'-c','listen_addresses=','-c','unix_socket_directories=/socket,/var/run/postgresql'])
    iniciado = True
    for _ in range(30):
        r = subprocess.run(['docker','exec',nome,'pg_isready','-h','/socket','-U','postgres'],capture_output=True)
        if r.returncode == 0:
            break
        time.sleep(1)
    else:
        raise RuntimeError('ENSAIO_BANCO_NAO_PRONTO')
    cmd(['docker','exec',nome,'createdb','-h','/socket','-U','postgres','donatella_ensaio_operacao'])
    cmd(['docker','exec','-i',nome,'psql','-h','/socket','-U','postgres','-d','donatella_ensaio_operacao','-v','ON_ERROR_STOP=1'],
        'CREATE ROLE donatella_operacao_app; CREATE ROLE donatella_operacao_backup;')
    for numero in ('025','033','034','036','037','038','039'):
        arquivos = list((release/'sql').glob(numero+'-*.sql'))
        if not arquivos:
            raise RuntimeError('ENSAIO_SQL_AUSENTE: '+numero)
        cmd(['docker','exec','-i',nome,'psql','-h','/socket','-U','postgres','-d','donatella_ensaio_operacao','-v','ON_ERROR_STOP=1'], arquivos[0].read_text())
    resultado = cmd(['docker','run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges',
                     '--memory','384m','--cpus','0.5','--pids-limit','64','-e','OPERACAO_BANCO_TESTE=postgresql://postgres@localhost/donatella_ensaio_operacao?host=/socket',
                     '--mount','type=bind,src='+str(socket)+',dst=/socket','--mount','type=bind,src='+str(release)+',dst=/release,readonly',
                     '--tmpfs','/tmp:rw,noexec,nosuid,size=16m',NODE,'/release/provas/contatos-templates-banco.mjs'],timeout=90)
    prova = json.loads(resultado)
    (stage/'resultado.json').write_text(json.dumps(prova,indent=2))
    print(json.dumps({**prova,'container':nome,'pasta':str(stage),'redeExterna':False}))
finally:
    if iniciado:
        # Preserva o contêiner e seus dados fictícios para inspeção. Não remove.
        cmd(['docker','stop',nome])
