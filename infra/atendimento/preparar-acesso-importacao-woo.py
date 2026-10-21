"""Acesso exclusivo do importador ao clone preservado e ao destino desarmado.

SQL aditiva manual; nenhum segredo sai em argumentos, resposta ou Git.
Não altera a origem Cloud, não amplia o acesso do runtime/navegador.
"""
import datetime,json,os,subprocess,urllib.parse,uuid
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
PAPEL='donatella_woo_importacao'
def run(args,entrada=None):
 p=subprocess.run(args,input=entrada,text=True,capture_output=True)
 if p.returncode:raise RuntimeError('WOO_ACESSO_RECUSADO_CONFERIR_CONFIGURACAO_PRIVADA')
 return p.stdout.strip()
def sql(container,banco,consulta):
 env=json.loads(run(['docker','inspect',container]))[0]['Config']['Env']
 usuarios=[x.split('=',1)[1] for x in env if x.startswith('POSTGRES_USER=')]
 if len(usuarios)!=1:raise RuntimeError('WOO_ADMINISTRADOR_BANCO_AUSENTE')
 return run(['docker','exec','-i',container,'psql','-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-U',usuarios[0],'-d',banco],consulta)
def gravar(path,obj,exclusivo=False):
 with path.open('x' if exclusivo else 'w') as f:os.fchmod(f.fileno(),0o600);json.dump(obj,f);f.flush();os.fsync(f.fileno())
 d=os.open(path.parent,os.O_RDONLY)
 try:os.fsync(d)
 finally:os.close(d)
def main():
 os.umask(0o077)
 if os.name!='posix' or ROOT.is_symlink():raise RuntimeError('WOO_ACESSO_AMBIENTE_RECUSADO')
 config=ROOT/'configuracao';arquivo=config/'importacao-woocommerce.json'
 if config.is_symlink() or arquivo.exists():raise RuntimeError('WOO_ACESSO_CONFIGURACAO_EXISTENTE_CONFERIR_SEM_RECRIAR')
 gate=json.loads((config/'operacao.json').read_text())
 if gate.get('enviosHabilitados') or gate.get('iaAutomatica') or gate.get('autoridade')!='origem' or gate.get('modo')!='homologacao':raise RuntimeError('WOO_ACESSO_EXIGE_PREPARACAO_DESARMADA')
 anterior=json.loads((config/'importacao.json').read_text());destinos=[];privado={'versao':1,'preparada':False,'criadaEm':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 for chave,host,banco in [('origemDatabaseUrl','grazing-donatella-homologacao-v2-banco','donatella_preparacao'),('destinoDatabaseUrl','grazing-donatella-operacao-v2-banco','donatella_operacao')]:
  u=urllib.parse.urlparse(anterior[chave])
  if u.scheme!='postgresql' or u.hostname!=host or u.path!='/'+banco or u.query or u.fragment:raise RuntimeError('WOO_ACESSO_BANCO_RECUSADO')
  if sql(host,banco,"SELECT count(*) FROM pg_roles WHERE rolname='"+PAPEL+"';")!='0':raise RuntimeError('WOO_ACESSO_PAPEL_EXISTENTE_CONFERIR')
  senha=uuid.uuid4().hex+uuid.uuid4().hex
  privado[chave]=urllib.parse.urlunparse(u._replace(netloc=PAPEL+':'+senha+'@'+host+(':'+str(u.port) if u.port else '')))
  destinos.append((host,banco,senha))
 # Intento privado recuperável antes de criar os dois acessos. Falha não provoca
 # geração de outra senha ou repetição cega de CREATE/GRANT.
 gravar(arquivo,privado,True)
 for host,banco,senha in destinos:
  q="BEGIN; CREATE ROLE "+PAPEL+" LOGIN PASSWORD '"+senha+"' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 1 VALID UNTIL '2026-10-20T23:59:59Z'; GRANT CONNECT ON DATABASE "+banco+" TO "+PAPEL+";"
  if banco=='donatella_preparacao':
   q+=" GRANT USAGE ON SCHEMA donatella_public TO "+PAPEL+"; GRANT SELECT ON donatella_public.automation_rules TO "+PAPEL+"; GRANT SELECT(id,name,language,status,components) ON donatella_public.whatsapp_templates TO "+PAPEL+"; GRANT SELECT(id,woo_order_id,status,last_processed_status,contact_id) ON donatella_public.orders TO "+PAPEL+";"
  else:
   q+=" GRANT USAGE ON SCHEMA atendimento_operacao TO "+PAPEL+"; GRANT SELECT ON atendimento_operacao.modelo TO "+PAPEL+"; GRANT SELECT(id) ON atendimento_operacao.etapa,atendimento_operacao.contato TO "+PAPEL+"; GRANT SELECT,INSERT,UPDATE ON atendimento_operacao.woo_regra,atendimento_operacao.woo_pedido,atendimento_operacao.woo_baseline,atendimento_operacao.woo_crm_regra TO "+PAPEL+"; GRANT INSERT(id,autor_id,entidade_id,acao,versao) ON atendimento_operacao.auditoria TO "+PAPEL+";"
  sql(host,banco,q+' COMMIT;')
 privado['baselineRegras']='/baseline/regras.json';privado['preparada']=True;gravar(arquivo,privado)
 print(json.dumps({'acessoImportacaoWooPreparado':True,'limiteConexoesPorBanco':1,'tabelasOrigem':3,'tabelasDestino':8,'podeExcluir':False,'expiraEm':'2026-10-20T23:59:59Z','acessoNavegadorAmpliado':False,'origemCloudAlterada':False,'enviosExternos':0}))
if __name__=='__main__':
 try:main()
 except Exception as e:
  import re,sys
  s=str(e);print(s if re.fullmatch(r'WOO_[A-Z0-9_]+',s) else 'WOO_ACESSO_FALHOU_CONFERIR_CONFIGURACAO_PRIVADA',file=sys.stderr);sys.exit(1)
