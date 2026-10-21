"""Preparação aditiva autorizada. Sem restauração HUB, origem, callback ou envios."""
import hashlib,json,os,secrets,subprocess,time
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

ROOT = caminho_privado('ATENDIMENTO_RAIZ_REMOTA_OPERACAO')
DB='grazing-donatella-operacao-v2-banco'
HUB='postgres-index-optical-alarm-pzjdxf'
def run(args,stdin=None):
    p=subprocess.run(args,input=stdin,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    if p.returncode: raise RuntimeError('PREPARACAO_BANCO_RECUSADA')
    return p.stdout.strip()
def put(path,content):
    path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    if path.is_symlink(): raise RuntimeError('CAMINHO_RECUSADO')
    with path.open('x') as f: f.write(content);f.flush();os.fsync(f.fileno())
    path.chmod(0o600)
def sql(container,user,db,text):
    return run(['docker','exec','-i',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U',user,'-d',db],text)
def quote(s):return "'"+s.replace("'","''")+"'"

configuracao_origem = caminho_privado('ATENDIMENTO_CONFIG_PREPARACAO_BANCO')
backupRoot = caminho_privado('ATENDIMENTO_RAIZ_PREPARACAO_BANCO_BACKUP')
if not configuracao_origem.is_file():raise RuntimeError('PRECONDICOES_AUSENTES')
ROOT.mkdir(mode=0o700,exist_ok=True)
for n in ['configuracao','release','midia']: (ROOT/n).mkdir(mode=0o700,exist_ok=True)
if (ROOT/'configuracao/bancos.json').exists():raise RuntimeError('BANCOS_JA_PREPARADOS_CONFERIR_SEM_REINSTALAR')
config=json.loads(configuracao_origem.read_text())
uid=config['hubUsuarioId']
if not uid or len(uid)>100 or not all(c.isalnum() or c in '_-' for c in uid):raise RuntimeError('IDENTIDADE_RECUSADA')
ids=run(['docker','ps','-q','--filter','label=com.docker.swarm.service.name='+HUB]).splitlines()
if len(ids)!=1:raise RuntimeError('HUB_BANCO_UNICO_AUSENTE')
hub=ids[0]; hc=json.loads(run(['docker','inspect',hub]))[0]; he=dict(x.split('=',1) for x in hc['Config']['Env'] if '=' in x)
hu=he.get('POSTGRES_USER','postgres');hd=he.get('POSTGRES_DB','postgres')
identidade=sql(hub,hu,hd,'SELECT count(*) FROM "Usuario" WHERE id='+quote(uid)+' AND ativo AND "excluidoEm" IS NULL;')
if identidade!='1':raise RuntimeError('IDENTIDADE_NAO_CONFIRMADA')
# Backup privado do HUB antes da única mudança aditiva de integração.
backupRoot.mkdir(mode=0o700,exist_ok=True)
back=backupRoot/'hub-antes-identidade.backup'
with back.open('xb') as f:
    p=subprocess.run(['docker','exec',hub,'pg_dump','-U',hu,'-d',hd,'-Fc','--lock-wait-timeout=3s'],stdout=f,stderr=subprocess.PIPE)
    if p.returncode:raise RuntimeError('BACKUP_HUB_NAO_CONCLUIDO')
    f.flush();os.fsync(f.fileno())
back.chmod(0o600)
with back.open('rb') as f:
    p=subprocess.run(['docker','exec','-i',hub,'pg_restore','--list'],stdin=f,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    if p.returncode:raise RuntimeError('BACKUP_HUB_INDICE_INVALIDO')
put(backupRoot/'hub-antes-identidade.sha256',hashlib.sha256(back.read_bytes()).hexdigest())
password=secrets.token_urlsafe(36);authpassword=secrets.token_urlsafe(36);appPassword=secrets.token_urlsafe(36);inPassword=secrets.token_urlsafe(36);backupPassword=secrets.token_urlsafe(36)
put(ROOT/'configuracao/postgres-password',password)
image=json.loads(run(['docker','inspect','grazing-donatella-homologacao-v2-banco']))[0]['Image']
net='grazing-donatella-operacao-v2-privada'
existing=run(['docker','network','ls','--format','{{.Name}}']).splitlines()
if net not in existing:run(['docker','network','create','--internal',net])
if DB in run(['docker','ps','-a','--format','{{.Names}}']).splitlines():raise RuntimeError('CONTAINER_EXISTENTE_CONFERIR')
run(['docker','volume','create','grazing-donatella-operacao-v2-dados'])
run(['docker','run','-d','--pull=never','--name',DB,'--label','grazing.finalidade=operacao-privada','--restart','unless-stopped','--network',net,'--read-only','--cap-drop','ALL','--cap-add','CHOWN','--cap-add','DAC_OVERRIDE','--cap-add','FOWNER','--cap-add','SETUID','--cap-add','SETGID','--security-opt','no-new-privileges','--memory','768m','--cpus','1','--pids-limit','128','--log-opt','max-size=10m','--log-opt','max-file=3','--mount','type=volume,src=grazing-donatella-operacao-v2-dados,dst=/var/lib/postgresql/data','--mount','type=bind,src='+str(ROOT/'configuracao/postgres-password')+',dst=/run/secrets/postgres-password,readonly','--tmpfs','/tmp:rw,noexec,nosuid,size=32m','--tmpfs','/var/run/postgresql:rw,noexec,nosuid,size=8m','-e','POSTGRES_USER=donatella_operacao_admin','-e','POSTGRES_PASSWORD_FILE=/run/secrets/postgres-password',image,'-c','max_connections=30','-c','shared_buffers=64MB','-c','log_statement=none','-c','log_min_error_statement=panic'])
for i in range(30):
    if subprocess.run(['docker','exec',DB,'pg_isready','-U','donatella_operacao_admin'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:break
    time.sleep(1)
else:raise RuntimeError('BANCO_NAO_PRONTO')
for db in ['donatella_operacao','donatella_entrada','donatella_ensaio_operacao','donatella_ensaio_entrada']:
    run(['docker','exec',DB,'createdb','-U','donatella_operacao_admin',db])
sql(DB,'donatella_operacao_admin','postgres',f"CREATE ROLE donatella_operacao_app LOGIN PASSWORD {quote(appPassword)} CONNECTION LIMIT 4; CREATE ROLE donatella_entrada_app LOGIN PASSWORD {quote(inPassword)} CONNECTION LIMIT 3; CREATE ROLE donatella_operacao_backup LOGIN PASSWORD {quote(backupPassword)} CONNECTION LIMIT 2; ALTER ROLE donatella_operacao_backup SET default_transaction_read_only=on;")
sql(hub,hu,hd,f'''BEGIN;
CREATE SCHEMA IF NOT EXISTS atendimento_integracao;
REVOKE ALL ON SCHEMA atendimento_integracao FROM PUBLIC;
CREATE VIEW atendimento_integracao.identidade WITH (security_barrier=true) AS SELECT u.id,u.nome,u.email,u."senhaHash",u.ativo,(u."excluidoEm" IS NOT NULL) AS excluido,u."sessaoVersao",u."perfilAcessoId" AS "perfilId",p.sistema AS "perfilSistema",p.permissoes,u."permissoesPersonalizadas" AS excecoes,u."senhaDefinida",u."emailVerificadoEm",EXISTS (SELECT 1 FROM "McpEvento" WHERE id='atendimento-permissoes-granulares-20261013') AS "permissoesGranulares" FROM "Usuario" u LEFT JOIN "PerfilAcesso" p ON p.id=u."perfilAcessoId" WHERE u."excluidoEm" IS NULL AND (p.sistema='ADMINISTRADOR' OR CASE WHEN (p.permissoes ? 'crm.atendimento') OR ((u."permissoesPersonalizadas"->'crm.atendimento') ? 'visualizar') THEN COALESCE((u."permissoesPersonalizadas"->'crm.atendimento'->>'visualizar')::boolean,(p.permissoes->'crm.atendimento') ? 'visualizar',false) ELSE COALESCE((u."permissoesPersonalizadas"->'crm'->>'visualizar')::boolean,(p.permissoes->'crm') ? 'visualizar',false) END);
REVOKE ALL ON atendimento_integracao.identidade FROM PUBLIC;
CREATE ROLE donatella_identidade_operacao LOGIN PASSWORD {quote(authpassword)} CONNECTION LIMIT 3;
ALTER ROLE donatella_identidade_operacao SET default_transaction_read_only=on;
GRANT CONNECT ON DATABASE "{hd}" TO donatella_identidade_operacao;
GRANT USAGE ON SCHEMA atendimento_integracao TO donatella_identidade_operacao;
GRANT SELECT ON atendimento_integracao.identidade TO donatella_identidade_operacao;
COMMIT;''')
bancos={'versao':1,'hubUsuarioId':uid,'centralDatabaseUrl':f'postgresql://donatella_identidade_operacao:{authpassword}@{HUB}:5432/{hd}','databaseUrl':f'postgresql://donatella_operacao_app:{appPassword}@{DB}:5432/donatella_operacao','entradaDatabaseUrl':f'postgresql://donatella_entrada_app:{inPassword}@{DB}:5432/donatella_entrada','testeDatabaseUrl':f'postgresql://donatella_operacao_app:{appPassword}@{DB}:5432/donatella_ensaio_operacao','testeEntradaDatabaseUrl':f'postgresql://donatella_entrada_app:{inPassword}@{DB}:5432/donatella_ensaio_entrada','csrfSecret':secrets.token_urlsafe(48)}
put(ROOT/'configuracao/bancos.json',json.dumps(bancos))
print(json.dumps({'bancoOperacionalPreparado':True,'bancoEntradaSeparado':True,'contaHubAtual':True,'hashesCopiados':False,'perfilAlterado':False,'backupHubIntegridade':True,'envios':0,'webhookAlterado':False}))
