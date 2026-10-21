"""Publicação estreita autorizada: runtime/web/SQL038, configuração preservada.

Valida antes de gravar. Guarda release/configuração e dumps privados legíveis.
Retorno troca somente código. Nunca restaura banco sobre atendimentos novos.
"""
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
BACKUP_ROOT = caminho_privado('ATENDIMENTO_RAIZ_BACKUPS_MANUAIS')
LOCK_DRIVE = caminho_privado('ATENDIMENTO_PUBLICACAO_LOCK_DRIVE')
LOCK_CHECKPOINT = lock_checkpoint()
APP='grazing-donatella-operacao-v2'
DB=APP+'-banco'
SQL='038-operacao-contatos-templates.sql'

def sha(p):
 return hashlib.sha256(p.read_bytes()).hexdigest()
def exigir(ok,codigo):
 if not ok: raise RuntimeError('PUBLICACAO_CONTATOS_'+codigo)
def cmd(a,entrada=None,timeout=60):
 r=subprocess.run(a,input=entrada,capture_output=True,text=True,timeout=timeout)
 exigir(r.returncode==0,'COMANDO_FALHOU')
 return r.stdout.strip()
def inspect():
 return json.loads(cmd(['docker','inspect',APP]))[0]
def inventario(p):
 r={}
 for f in p.rglob('*'):
  exigir(not f.is_symlink(),'SYMLINK_RECUSADO')
  if f.is_file(): r[str(f.relative_to(p))]=sha(f)
 return r
def registrar(p,d):
 p.write_text(json.dumps(d,indent=2));p.chmod(0o600)
def agora():
 return datetime.datetime.now(datetime.timezone.utc).isoformat()

parser=argparse.ArgumentParser()
parser.add_argument('--candidata',required=True)
parser.add_argument('--runtime-anterior',required=True)
parser.add_argument('--commit',required=True)
parser.add_argument('--aplicar',action='store_true')
args=parser.parse_args()
candidata=Path(args.candidata)
exigir(candidata.resolve()==candidata and candidata.is_dir() and candidata.parent==ROOT/'candidatas','CAMINHO_RECUSADO')
exigir(re.fullmatch(r'[a-f0-9]{64}',args.runtime_anterior) and re.fullmatch(r'[a-f0-9]{40}',args.commit),'HASH_INVALIDO')
release=ROOT/'release'
config=ROOT/'configuracao/operacao.json'
compose=ROOT/'compose.operacao.yml'
manifesto=json.loads((candidata/'release.json').read_text())
exigir(sha(candidata/'operacao.mjs')==manifesto['runtimeSha256'],'CANDIDATA_DIVERGENTE')
exigir(sha(candidata/'sql'/SQL)==manifesto['sqlSha256'][SQL],'SQL_DIVERGENTE')
for nome,h in manifesto['webArquivosSha256'].items():
 exigir((candidata/'web'/nome).resolve().is_relative_to(candidata/'web') and sha(candidata/'web'/nome)==h,'WEB_DIVERGENTE')
exigir(sha(release/'operacao.mjs')==args.runtime_anterior,'PUBLICACAO_PARALELA')
c=json.loads(config.read_text())
exigir(c['modo']=='operacao' and c['autoridade']=='vps' and c['escopoOperacional']=='chat_humano' and c['corteMinimoChat']['fase']=='humano' and c['enviosHabilitados'] is True and c['iaAutomatica'] is False and c['voz']['sinteseHabilitada'] is False and c['woocommerce']['automacoesHabilitadas'] is False,'CONFIGURACAO_DIVERGENTE')
x=inspect()
exigir(x['State']['Running'] and x['State'].get('Health',{}).get('Status')=='healthy','APP_NAO_SAUDAVEL')
exigir(any(m['Destination']=='/release' and m['Source']==str(release) and not m['RW'] for m in x['Mounts']),'MOUNT_DIVERGENTE')
cfgHash,composeHash=sha(config),sha(compose)
if not args.aplicar:
 print(json.dumps({'verificado':True,'runtimeAnterior':args.runtime_anterior,'runtimeNovo':manifesto['runtimeSha256'],'sql':SQL,'configuracaoPreservada':True}))
 raise SystemExit(0)

backup=BACKUP_ROOT/('contatos-templates-'+uuid.uuid4().hex)
backup.mkdir(parents=True,mode=0o700)
locks=[]
try:
 # Mesmos locks das rotinas existentes. Não interrompe nem modifica o backup.
 for p in (LOCK_DRIVE,LOCK_CHECKPOINT):
  exigir(p.parent.is_dir() and not p.is_symlink(),'LOCK_RECUSADO')
  f=p.open('a');os.fchmod(f.fileno(),0o600);fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
 exigir(sha(release/'operacao.mjs')==args.runtime_anterior and sha(config)==cfgHash and sha(compose)==composeHash,'PUBLICACAO_PARALELA')
 antes=inventario(release)
 shutil.copytree(release,backup/'release-anterior')
 shutil.copytree(ROOT/'configuracao',backup/'configuracao-anterior')
 shutil.copy2(compose,backup/'compose-anterior.yml')
 exigir(inventario(backup/'release-anterior')==antes,'BACKUP_RELEASE_DIVERGENTE')
 dumps={}
 for banco in ('donatella_operacao','donatella_entrada'):
  arquivo=backup/(banco+'.dump')
  with arquivo.open('xb') as f:
   os.fchmod(f.fileno(),0o600)
   r=subprocess.run(['docker','exec',DB,'pg_dump','-U','donatella_operacao_admin','-d',banco,'-Fc'],stdout=f,stderr=subprocess.PIPE,timeout=90)
  exigir(r.returncode==0 and arquivo.stat().st_size>1000,'BACKUP_BANCO_FALHOU')
  with arquivo.open('rb') as f:
   r=subprocess.run(['docker','exec','-i',DB,'pg_restore','--file=/dev/null'],stdin=f,capture_output=True,timeout=90)
  exigir(r.returncode==0,'BACKUP_ARQUIVO_ILEGIVEL')
  dumps[banco]={'sha256':sha(arquivo),'bytes':arquivo.stat().st_size,'leituraIntegral':True}
 registrar(backup/'prepublicacao.json',{'criadoEm':agora(),'commit':args.commit,'dumps':dumps,'runtimeAnterior':args.runtime_anterior,'configuracaoHash':cfgHash,'composeHash':composeHash})
 # Aplicação idempotente em ambos os bancos dedicados; HUB permanece intacto.
 sql=(candidata/'sql'/SQL).read_text()
 for banco in ('donatella_ensaio_operacao','donatella_operacao'):
  cmd(['docker','exec','-i',DB,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','donatella_operacao_admin','-d',banco],sql)
 novo=json.loads((release/'release.json').read_text())
 novo.update({'preparadaEm':agora(),'revisaoBase':args.commit,'ramo':'codex/atendimento-contatos-templates-20261013','runtimeSha256':manifesto['runtimeSha256'],'webArquivosSha256':manifesto['webArquivosSha256']})
 novo['sqlSha256'][SQL]=manifesto['sqlSha256'][SQL]
 stage=ROOT/('release-contatos-templates-'+uuid.uuid4().hex)
 shutil.copytree(release,stage)
 shutil.copy2(candidata/'operacao.mjs',stage/'operacao.mjs')
 shutil.copy2(candidata/'sql'/SQL,stage/'sql'/SQL)
 # Web anterior já está no backup. Renomear preserva também o estágio.
 os.rename(stage/'web',stage/'web-anterior')
 shutil.copytree(candidata/'web',stage/'web')
 (stage/'release.json').write_text(json.dumps(novo,indent=2))
 preservada=ROOT/'releases-preservadas'/('contatos-templates-'+backup.name)
 preservada.parent.mkdir(exist_ok=True)
 os.rename(release,preservada);os.rename(stage,release)
 try:
  cmd(['docker','compose','-f',str(compose),'up','-d','--no-deps','--force-recreate','operacao'])
  for _ in range(30):
   x=inspect()
   if x['State']['Running'] and x['State'].get('Health',{}).get('Status')=='healthy':break
   time.sleep(2)
  else:raise RuntimeError('PUBLICACAO_CONTATOS_SAUDE_FALHOU')
  exigir(sha(config)==cfgHash and sha(compose)==composeHash,'CONFIGURACAO_ALTERADA')
 except Exception:
  retirada=ROOT/('release-contatos-templates-recusada-'+uuid.uuid4().hex)
  os.rename(release,retirada);os.rename(preservada,release)
  cmd(['docker','compose','-f',str(compose),'up','-d','--no-deps','--force-recreate','operacao'])
  raise
 recibo={'publicadoEm':agora(),'commit':args.commit,'runtimeSha256':sha(release/'operacao.mjs'),'manifestoSha256':sha(release/'release.json'),'sqlSha256':sha(release/'sql'/SQL),'backup':str(backup),'dumps':dumps,'configuracaoPreservada':sha(config)==cfgHash,'composePreservado':sha(compose)==composeHash,'containerId':x['Id'],'iniciadoEm':x['State']['StartedAt'],'reinicios':x['RestartCount'],'saude':x['State']['Health']['Status']}
 registrar(backup/'publicacao.json',recibo)
 print(json.dumps(recibo))
finally:
 for f in reversed(locks):f.close()
