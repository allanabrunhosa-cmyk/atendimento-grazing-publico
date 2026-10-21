"""Ensaio fictício do núcleo em contêiner novo, sem rede ou acesso produtivo."""
import hashlib,json,os,re,shutil,subprocess,sys,time,uuid
from pathlib import Path

PG='sha256:3645570cccdfa447589da9f57dd740faa29b30938e861289a5574b6ca6b03826'
NODE='sha256:4573af7c8fe8bc48827e88e39358fb5170e6ea319d1938152db5edad349a0ede'

def caminho_privado(nome):
    """Exige alvo privado explícito; nunca usa caminho operacional padrão."""
    valor = os.environ.get(nome)
    if not isinstance(valor, str) or not valor or any(c in valor for c in '\r\n\0,'):
        raise RuntimeError('ATENDIMENTO_CAMINHO_PRIVADO_OBRIGATORIO_' + nome)
    caminho = Path(valor)
    if not caminho.is_absolute() or str(caminho) != valor or '..' in caminho.parts or caminho.parent == caminho:
        raise RuntimeError('ATENDIMENTO_CAMINHO_PRIVADO_INVALIDO_' + nome)
    return caminho

ROOT = caminho_privado('ATENDIMENTO_RAIZ_ENSAIO_CHAT_MINIMO')
USER='donatella_receptor_ensaio_admin'
FINALIDADE='ensaio-chat-minimo-nucleo-v1'

def cmd(args,timeout=90):
 r=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
 if r.returncode:
  # Somente este ensaio sem dados reais; mantém diagnóstico privado no estágio.
  (stage/'falha-ensaio.txt').write_text(r.stderr+r.stdout)
  raise RuntimeError('ENSAIO_CHAT_COMANDO_FALHOU')
 return r.stdout.strip()

def conferir(nome):
 if not re.fullmatch(r'donatella-chat-minimo-prova-[a-f0-9]{32}',nome):raise RuntimeError('ENSAIO_CHAT_NOME_RECUSADO')
 d=json.loads(cmd(['docker','inspect',nome]))[0]
 if d['Config'].get('Labels',{}).get('grazing.finalidade')!=FINALIDADE or d['HostConfig']['NetworkMode']!='none' or d['HostConfig'].get('PortBindings'):raise RuntimeError('ENSAIO_CHAT_ISOLAMENTO_RECUSADO')
 return d

def pronto(nome):
 for _ in range(45):
  conferir(nome)
  r=subprocess.run(['docker','exec',nome,'pg_isready','-h','/socket','-U',USER,'-d','postgres'],capture_output=True,timeout=5)
  p=subprocess.run(['docker','exec',nome,'cat','/proc/1/comm'],capture_output=True,timeout=5)
  if r.returncode==0 and p.stdout.strip()==b'postgres':time.sleep(1);return
  time.sleep(1)
 raise RuntimeError('ENSAIO_CHAT_BANCO_INDISPONIVEL')

def executar():
 if shutil.disk_usage('/var/lib').free<10*1024**3:raise RuntimeError('ENSAIO_CHAT_ESPACO_INSUFICIENTE')
 for imagem in (PG,NODE):
  if cmd(['docker','image','inspect',imagem,'--format','{{.Id}}'])!=imagem:raise RuntimeError('ENSAIO_CHAT_IMAGEM_DIVERGENTE')
 for nome in ('chat-minimo-banco.mjs','sql/025-operacao-destino.sql','sql/029-proveniencia-importacao-operacao.sql'):
  p=stage/'release'/nome
  if not p.is_file() or p.is_symlink() or p.resolve()!=p:raise RuntimeError('ENSAIO_CHAT_ARTEFATO_RECUSADO')
 ident=uuid.uuid4().hex;nome='donatella-chat-minimo-prova-'+ident;volume=nome+'-dados'
 (stage/'socket').mkdir(mode=0o777);(stage/'socket').chmod(0o777);(stage/'prova').mkdir(mode=0o700)
 cmd(['docker','volume','create','--label','grazing.finalidade='+FINALIDADE,volume])
 cid=cmd(['docker','run','--pull=never','-d','--name',nome,'--label','grazing.finalidade='+FINALIDADE,'--network','none','--read-only','--security-opt','no-new-privileges','--memory','512m','--cpus','0.5','--pids-limit','128','--mount','type=volume,src='+volume+',dst=/var/lib/postgresql/data','--mount','type=bind,src='+str(stage/'socket')+',dst=/socket','--tmpfs','/tmp:rw,noexec,nosuid,size=16m','--tmpfs','/var/run/postgresql:rw,noexec,nosuid,size=16m','-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_USER='+USER,'-e','POSTGRES_DB=postgres',PG,'postgres','-c','listen_addresses=','-c','unix_socket_directories=/socket,/var/run/postgresql','-c','max_connections=16','-c','shared_buffers=64MB','-c','log_statement=none'])
 try:
  pronto(nome)
  for banco in ('donatella_ensaio_origem','donatella_ensaio_operacao'):cmd(['docker','exec',nome,'createdb','-h','/socket','-U',USER,banco])
  def rodar(fase):
   return cmd(['docker','run','--pull=never','--name',nome+'-'+fase,'--network','none','--label','grazing.finalidade='+FINALIDADE,'--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','512m','--cpus','0.5','--pids-limit','64','-e','DONATELLA_ENSAIO_CHAT_MINIMO=1','--mount','type=bind,src='+str(stage/'release')+',dst=/release,readonly','--mount','type=bind,src='+str(stage/'socket')+',dst=/socket','--mount','type=bind,src='+str(stage/'prova')+',dst=/prova','--tmpfs','/tmp:rw,noexec,nosuid,size=16m',NODE,'/release/chat-minimo-banco.mjs','--'+fase],timeout=180)
  rodar('preparar');antes=conferir(nome)['State']['StartedAt'];cmd(['docker','restart',nome]);pronto(nome);depois=conferir(nome)['State']['StartedAt']
  if antes==depois:raise RuntimeError('ENSAIO_CHAT_REINICIO_NAO_COMPROVADO')
  rodar('retomada');r=json.loads((stage/'prova/depois.json').read_text());r['isolamento']={'container':nome,'containerId':cid,'rede':'none','portas':0,'reinicioSomenteProva':True};r['runnerSha256']=hashlib.sha256((stage/'release/chat-minimo-banco.mjs').read_bytes()).hexdigest();(stage/'resultado.json').write_text(json.dumps(r));print(json.dumps(r))
 finally:
  if conferir(nome)['Id']!=cid:raise RuntimeError('ENSAIO_CHAT_CONTAINER_DIVERGENTE')
  cmd(['docker','stop',nome])

if __name__=='__main__':
 os.umask(0o077)
 if len(sys.argv)!=2 or not re.fullmatch(r'[a-f0-9]{32}',sys.argv[1]):raise SystemExit('ENSAIO_CHAT_ESTAGIO_RECUSADO')
 stage=ROOT/sys.argv[1]
 if not stage.is_dir() or stage.is_symlink() or stage.resolve()!=stage:raise SystemExit('ENSAIO_CHAT_ESTAGIO_RECUSADO')
 executar()
