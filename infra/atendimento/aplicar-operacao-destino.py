"""Migrations manuais, aditivas e com recibo no banco dedicado já preparado."""
import json,subprocess,hashlib,os
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
def run(args,entrada=None):
 p=subprocess.run(args,input=entrada,text=True,capture_output=True)
 if p.returncode:raise RuntimeError('PREPARACAO_SQL_RECUSADA')
 return p.stdout.strip()
def sql(db,text):return run(['docker','exec','-i',DB,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','donatella_operacao_admin','-d',db],text)
def quote(s):return "'"+s.replace("'","''")+"'"
if json.loads(run(['docker','inspect',DB]))[0]['Config']['Labels'].get('grazing.finalidade')!='operacao-privada':raise RuntimeError('BANCO_RECUSADO')
receipt=ROOT/'configuracao/sql-aplicado.json'
aplicadas=json.loads(receipt.read_text()) if receipt.exists() else {}
plano={'donatella_operacao':['025-operacao-destino.sql','019-duvidas-aprendizagem-destino.sql','027-agente-operacional.sql','028-acesso-operacao-destino.sql','029-proveniencia-importacao-operacao.sql','030-followup-operacional.sql','032-alerta-apoio-operacional.sql','033-woocommerce-automacoes-operacionais.sql','034-woocommerce-crm-baseline.sql'],'donatella_entrada':['026-entrada-duravel-destino.sql'],'donatella_ensaio_operacao':['028-acesso-operacao-destino.sql','029-proveniencia-importacao-operacao.sql','030-followup-operacional.sql','032-alerta-apoio-operacional.sql','033-woocommerce-automacoes-operacionais.sql','034-woocommerce-crm-baseline.sql']}
for banco in ['donatella_operacao','donatella_ensaio_operacao']:
 plano[banco].append('035-agente-configuracao-efetiva.sql')
for banco,nomes in plano.items():
 for nome in nomes:
  text=(ROOT/'operacao-ensaio/scripts/atendimento/sql'/nome).read_text();sha=hashlib.sha256(text.encode()).hexdigest();chave=banco+'/'+nome
  if chave in aplicadas:
   if aplicadas[chave]!=sha:raise RuntimeError('SQL_APLICADA_DIVERGENTE')
   continue
  sql(banco,text);aplicadas[chave]=sha
  temp=receipt.with_suffix('.tmp')
  with temp.open('w') as f:json.dump(aplicadas,f);f.flush();os.fsync(f.fileno())
  temp.chmod(0o600);os.replace(temp,receipt)
bancos=json.loads((ROOT/'configuracao/bancos.json').read_text())
uid=bancos['hubUsuarioId']
fonte=json.loads(run(['docker','inspect','grazing-donatella-homologacao-v2-banco']))[0]
env=dict(v.split('=',1) for v in fonte['Config']['Env'] if '=' in v)
v=run(['docker','exec','-i','grazing-donatella-homologacao-v2-banco','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U',env.get('POSTGRES_USER','postgres'),'-d','donatella_preparacao'],"SELECT json_build_object('id',origem_usuario_id,'revisadoEm',revisado_em) FROM atendimento_identidades.vinculos WHERE hub_usuario_id="+quote(uid)+" AND revisado_em IS NOT NULL AND revogado_em IS NULL;")
linhas=v.splitlines()
if len(linhas)>1:raise RuntimeError('VINCULO_AMBIGUO')
if linhas:vinculo=json.loads(linhas[0])
else:
 # A autorização explícita do proprietário e o perfil atual do HUB sustentam
 # este acesso. Revisão anterior de consulta não vincula uma identidade legada.
 v=run(['docker','exec','-i','grazing-donatella-homologacao-v2-banco','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U',env.get('POSTGRES_USER','postgres'),'-d','donatella_preparacao'],"SELECT json_build_object('revisadoEm',revisado_em) FROM atendimento_identidades.acessos_homologacao WHERE hub_usuario_id="+quote(uid)+" AND ativo;")
 if len(v.splitlines())!=1:raise RuntimeError('ACESSO_REVISADO_AUSENTE')
 vinculo={'id':None,**json.loads(v)}
for banco in ['donatella_operacao','donatella_ensaio_operacao']:
 sql(banco,"INSERT INTO atendimento_acesso.vinculo(hub_usuario_id,origem_usuario_id,revisado_em) VALUES("+quote(uid)+','+(quote(vinculo['id']) if vinculo['id'] else 'NULL')+','+quote(vinculo['revisadoEm'])+") ON CONFLICT(hub_usuario_id) DO NOTHING;")
 for schema in (['atendimento_operacao','atendimento_apoio','atendimento_acesso'] if banco=='donatella_operacao' else ['atendimento_operacao','atendimento_acesso']):
  sql(banco,f'GRANT USAGE ON SCHEMA {schema} TO donatella_operacao_app,donatella_operacao_backup; GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA {schema} TO donatella_operacao_app; GRANT SELECT ON ALL TABLES IN SCHEMA {schema} TO donatella_operacao_backup; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA {schema} TO donatella_operacao_app;')
for banco in ['donatella_entrada','donatella_ensaio_entrada']:
 sql(banco,'GRANT USAGE ON SCHEMA atendimento_entrada TO donatella_entrada_app,donatella_operacao_backup; GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA atendimento_entrada TO donatella_entrada_app; GRANT SELECT ON ALL TABLES IN SCHEMA atendimento_entrada TO donatella_operacao_backup;')
for banco in ['donatella_operacao','donatella_ensaio_operacao','donatella_entrada','donatella_ensaio_entrada']:
 papel='donatella_entrada_app' if banco.endswith('entrada') else 'donatella_operacao_app'
 sql('postgres',f'REVOKE CONNECT ON DATABASE {banco} FROM PUBLIC; GRANT CONNECT ON DATABASE {banco} TO {papel},donatella_operacao_backup;')
sql('postgres','ALTER ROLE donatella_operacao_app CONNECTION LIMIT 8; ALTER ROLE donatella_entrada_app CONNECTION LIMIT 6;')
print(json.dumps({'migrationsAdicionadas':len(aplicadas),'vinculoRevisadoReutilizado':True,'grantsOrigemCopiados':False,'bancoHubRestaurado':False,'envios':0,'webhookAlterado':False}))
