"""Restauração real preparada; executar somente depois da extração exclusiva R2.

Cria PostgreSQL isolado sem rede/portas e não liga aplicação, IA ou filas.
Preserva bancos e arquivos recuperados, inclusive após falha, para inspeção.
Não apaga nem restaura sobre contêineres existentes. Nenhuma chave mestra.
"""
import hashlib,json,os,re,subprocess,sys,time
from pathlib import Path


def caminho_privado(nome):
    """Exige alvo privado explícito; nunca usa caminho operacional padrão."""
    valor = os.environ.get(nome)
    if not isinstance(valor, str) or not valor or any(c in valor for c in '\r\n\0,'):
        raise RuntimeError('ATENDIMENTO_CAMINHO_PRIVADO_OBRIGATORIO_' + nome)
    caminho = Path(valor)
    if not caminho.is_absolute() or str(caminho) != valor or '..' in caminho.parts or caminho.parent == caminho:
        raise RuntimeError('ATENDIMENTO_CAMINHO_PRIVADO_INVALIDO_' + nome)
    return caminho

ROOT = caminho_privado('ATENDIMENTO_RAIZ_RECUPERACAO_OPERACAO_R2')

def run(args,stdin=None):
 p=subprocess.run(args,input=stdin,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if p.returncode:raise RuntimeError('RECUPERACAO_OPERACAO_COMANDO_FALHOU')
 return p.stdout.decode().strip()

def digest(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  while True:
   b=f.read(1024*1024)
   if not b:break
   h.update(b)
 return h.hexdigest()

def escrever(path,conteudo):
 with path.open('x') as f:json.dump(conteudo,f);f.flush();os.fsync(f.fileno())
 path.chmod(0o600)

def conferir_retomada(ins,imagem_id,nome,volume):
 if ins.get('Name','').lstrip('/')!=nome or ins.get('Image')!=imagem_id or ins.get('Config',{}).get('Labels',{}).get('grazing.finalidade')!='recuperacao-operacao-r2' or ins.get('HostConfig',{}).get('NetworkMode')!='none' or ins.get('HostConfig',{}).get('PortBindings') or not ins.get('State',{}).get('Running'):raise RuntimeError('RECUPERACAO_OPERACAO_RETOMADA_RECUSADA')
 if not any(m.get('Type')=='volume' and m.get('Name')==volume and m.get('Destination')=='/var/lib/postgresql/data' for m in ins.get('Mounts',[])):raise RuntimeError('RECUPERACAO_OPERACAO_RETOMADA_VOLUME_RECUSADO')

def executar(id,imagem,retomar=False):
 if not re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}',id):raise RuntimeError('RECUPERACAO_OPERACAO_ID_RECUSADO')
 if not re.fullmatch(r'(sha256:|[a-z0-9./_-]+@sha256:)[a-f0-9]{64}',imagem):raise RuntimeError('RECUPERACAO_OPERACAO_IMAGEM_RECUSADA')
 raiz=ROOT/id
 if raiz.resolve()!=raiz or raiz.is_symlink() or ROOT.is_symlink():raise RuntimeError('RECUPERACAO_OPERACAO_CAMINHO_RECUSADO')
 if (raiz/'restauracao-postgresql.json').exists():raise RuntimeError('RECUPERACAO_OPERACAO_JA_CONCLUIDA')
 extracao=json.loads((raiz/'extracao.json').read_text())
 if extracao.get('versao')!=2 or extracao.get('id')!=id or extracao.get('proveniencia')!='copia_real_preservada' or extracao.get('cacheLocalUsado') is not False or extracao.get('origemUsada') is not False:raise RuntimeError('RECUPERACAO_OPERACAO_EXTRACAO_RECUSADA')
 esperados={'donatella_operacao','donatella_entrada'}
 bancos=extracao.get('bancos',[])
 if {b.get('nome') for b in bancos}!=esperados or len(bancos)!=2:raise RuntimeError('RECUPERACAO_OPERACAO_ENTRADA_AUSENTE')
 for b in bancos:
  arquivo=raiz/'operacao/banco'/(b['nome'].replace('donatella_','')+'.backup')
  if arquivo.is_symlink() or not arquivo.is_file() or arquivo.stat().st_size!=b['bytes'] or digest(arquivo)!=b['sha256']:raise RuntimeError('RECUPERACAO_OPERACAO_DUMP_DIVERGENTE')
 nome='grazing-donatella-recuperacao-operacao-'+id
 existe=nome in run(['docker','ps','-a','--format','{{.Names}}']).splitlines()
 if existe and not retomar:raise RuntimeError('RECUPERACAO_OPERACAO_DESTINO_EXISTENTE')
 if retomar and not existe:raise RuntimeError('RECUPERACAO_OPERACAO_RETOMADA_DESTINO_AUSENTE')
 # Imagem informada por digest e previamente disponibilizada. Nenhuma leitura
 # do contêiner/banco operacional é necessária para restaurar os dados do R2.
 volume=nome+'-dados'
 inicio=time.monotonic()
 if retomar:
  ins=json.loads(run(['docker','inspect',nome]))[0];imagem_id=json.loads(run(['docker','image','inspect',imagem]))[0]['Id']
  conferir_retomada(ins,imagem_id,nome,volume)
 else:
  if volume in run(['docker','volume','ls','--format','{{.Name}}']).splitlines():raise RuntimeError('RECUPERACAO_OPERACAO_VOLUME_EXISTENTE')
  run(['docker','volume','create','--label','grazing.finalidade=recuperacao-operacao-r2',volume])
  run(['docker','run','-d','--pull=never','--name',nome,'--label','grazing.finalidade=recuperacao-operacao-r2','--network','none','--read-only','--restart','no','--cap-drop','ALL','--cap-add','CHOWN','--cap-add','DAC_OVERRIDE','--cap-add','FOWNER','--cap-add','SETUID','--cap-add','SETGID','--security-opt','no-new-privileges','--memory','768m','--cpus','1','--pids-limit','128','--log-opt','max-size=5m','--log-opt','max-file=2','--mount','type=volume,src='+volume+',dst=/var/lib/postgresql/data','--tmpfs','/tmp:rw,noexec,nosuid,size=32m','--tmpfs','/var/run/postgresql:rw,noexec,nosuid,size=8m','-e','POSTGRES_USER=recuperacao_operacao','-e','POSTGRES_HOST_AUTH_METHOD=trust',imagem,'-c','max_connections=16','-c','shared_buffers=64MB','-c','log_statement=none','-c','log_min_error_statement=panic'])
 for _ in range(30):
  if subprocess.run(['docker','exec',nome,'pg_isready','-U','recuperacao_operacao'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:break
  time.sleep(1)
 else:raise RuntimeError('RECUPERACAO_OPERACAO_DESTINO_NAO_PRONTO')
 fingerprints={};anexos_novos=[]
 def consultar(banco,text):return run(['docker','exec','-i',nome,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','recuperacao_operacao','-d',banco],text.encode())
 presentes=consultar('postgres',"SELECT datname FROM pg_database WHERE NOT datistemplate ORDER BY datname;").splitlines()
 if set(presentes)-{'postgres','recuperacao_operacao',*esperados}:raise RuntimeError('RECUPERACAO_OPERACAO_RETOMADA_BANCOS_RECUSADOS')
 # Conferir TODOS os bancos-alvo antes de escrever em qualquer um; uma
 # restauração parcialmente povoada nunca é sobrescrita pela retomada.
 for banco in esperados&set(presentes):
  n=consultar(banco,"SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S','f'))+(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema'));")
  if n!='0':raise RuntimeError('RECUPERACAO_OPERACAO_RETOMADA_BANCO_NAO_VAZIO')
 for b in bancos:
  banco=b['nome']
  if banco not in presentes:run(['docker','exec',nome,'createdb','-U','recuperacao_operacao',banco])
  arquivo=raiz/'operacao/banco'/(banco.replace('donatella_','')+'.backup')
  schemas=['atendimento_entrada'] if banco=='donatella_entrada' else ['atendimento_operacao','atendimento_apoio','atendimento_acesso']
  for schema in schemas:consultar(banco,'CREATE SCHEMA IF NOT EXISTS '+schema+' AUTHORIZATION recuperacao_operacao;')
  with arquivo.open('rb') as f:
   p=subprocess.run(['docker','exec','-i',nome,'pg_restore','--exit-on-error','--no-owner','--no-privileges','-U','recuperacao_operacao','-d',banco,*['--schema='+s for s in schemas]],stdin=f,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
   if p.returncode:raise RuntimeError('RECUPERACAO_OPERACAO_RESTAURACAO_FALHOU')
  def sql(text):return consultar(banco,text)
  nomes=sql("SELECT n.nspname||'.'||c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ("+','.join("'"+s+"'" for s in schemas)+") AND c.relkind='r' ORDER BY 1;").splitlines()
  for tabela in nomes:
   if not re.fullmatch(r'[a-z_]+\.[a-z_]+',tabela):raise RuntimeError('RECUPERACAO_OPERACAO_TABELA_RECUSADA')
   resultado=sql("BEGIN READ ONLY; SET LOCAL statement_timeout='30s'; SELECT json_build_object('quantidade',count(*),'conteudoMd5',md5(coalesce(string_agg(h,',' ORDER BY h),''))) FROM (SELECT md5(row_to_json(t)::text) h FROM "+tabela+" t) s; COMMIT;")
   fingerprints[banco+'/'+tabela]=json.loads(resultado)
  if banco=='donatella_operacao':
   anexos_novos=json.loads(sql("SELECT coalesce(json_agg(json_build_object('hash',hash,'bytes',tamanho)),'[]'::json) FROM atendimento_operacao.anexo WHERE NOT importado;"))
  sql('ALTER DATABASE '+banco+' SET default_transaction_read_only=on;')
 # Conferir bytes locais novos. Legados permanecem na cadeia R2 histórica,
 # cujo ponto de referência foi preservado, e exigem recuperação separada.
 midia=raiz/'operacao/midia';bytes_midia=0;quantidade=0;conteudos={}
 for arquivo in midia.rglob('*'):
  if arquivo.is_symlink():raise RuntimeError('RECUPERACAO_OPERACAO_MIDIA_RECUSADA')
  if arquivo.is_dir():continue
  if not arquivo.is_file() or not re.fullmatch(r'[a-f0-9]{64}(\.bin)?',arquivo.name):raise RuntimeError('RECUPERACAO_OPERACAO_MIDIA_DIVERGENTE')
  hash=arquivo.name.removesuffix('.bin')
  if digest(arquivo)!=hash:raise RuntimeError('RECUPERACAO_OPERACAO_MIDIA_DIVERGENTE')
  conteudos[hash]=arquivo.stat().st_size
  quantidade+=1;bytes_midia+=arquivo.stat().st_size
 if any(conteudos.get(a['hash'])!=a['bytes'] for a in anexos_novos):raise RuntimeError('RECUPERACAO_OPERACAO_ANEXO_NAO_RECUPERADO')
 resultado={'versao':2,'id':id,'manifestoSha256':extracao['manifestoSha256'],'proveniencia':'copia_real_preservada','restauracaoPostgreSQLExecutada':True,'bancos':sorted(esperados),'fingerprints':fingerprints,'midiaNova':{'arquivos':quantidade,'bytes':bytes_midia},'legadoRecuperadoPorEstaEtapa':False,'somenteR2ParaOsDados':True,'cacheLocalUsado':False,'origemUsada':False,'rede':'none','aplicacaoAtivada':False,'jobsAtivados':False,'envios':0,'coerenciaEntreBancos':'snapshots_sequenciais_pendente_reconciliacao_por_chave','duracaoRestauracaoSegundos':round(time.monotonic()-inicio,3),'restauradaEm':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
 escrever(raiz/'restauracao-postgresql.json',resultado)
 print(json.dumps({k:v for k,v in resultado.items() if k!='fingerprints'}))

if __name__=='__main__':
 try:
  if len(sys.argv) not in [3,4] or len(sys.argv)==4 and sys.argv[3]!='--retomar':raise RuntimeError('RECUPERACAO_OPERACAO_ARGUMENTO_RECUSADO')
  executar(sys.argv[1],sys.argv[2],len(sys.argv)==4)
 except Exception as e:
  m=str(e);print(m if re.fullmatch(r'RECUPERACAO_OPERACAO_[A-Z_]+',m) else 'RECUPERACAO_OPERACAO_INTERROMPIDA',file=sys.stderr);sys.exit(1)
