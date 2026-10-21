"""Travas privadas do executor manual; não executa Docker, RPC ou escrita de dados."""
import datetime,json,math,os,re,stat,sys,urllib.parse,uuid
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

RAIZ = caminho_privado('ATENDIMENTO_RAIZ_REMOTA_OPERACAO')
CONSULTA = caminho_privado('ATENDIMENTO_CONFIG_COLETOR')
REPOSITORIO = caminho_privado('ATENDIMENTO_RELEASE_CONTROLE')
COLETOR='grazing-donatella-coletor-v2'
PADRAO_UUID=re.compile(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}')

def falhar(codigo):raise RuntimeError(codigo)

def instante(valor):
 try:
  d=datetime.datetime.fromisoformat(valor.replace('Z','+00:00'))
  if d.tzinfo is None:falhar('COPIA_FINAL_JANELA_RECUSADA')
  return d
 except (AttributeError,ValueError):falhar('COPIA_FINAL_JANELA_RECUSADA')

def validar_modo(modo,exato=False):
 if (stat.S_IMODE(modo)!=0o600 if exato else stat.S_IMODE(modo)&0o077):falhar('COPIA_FINAL_PERMISSOES_PRIVADAS_RECUSADAS')

def ler_privado(caminho,limite=128*1024,modo=True,exato=False):
 for p in [caminho,*caminho.parents]:
  if p.is_symlink():falhar('COPIA_FINAL_LINK_RECUSADO')
 with caminho.open('rb') as f:
  s=os.fstat(f.fileno())
  if not stat.S_ISREG(s.st_mode) or s.st_size>limite:falhar('COPIA_FINAL_ARQUIVO_RECUSADO')
  if modo:validar_modo(s.st_mode,exato)
  return json.loads(f.read(limite+1))

def validar_configuracao(c,a,o,coletor,catalogo,em):
 id=c.get('execucao','')
 if c.get('versao')!=1 or not isinstance(id,str) or not PADRAO_UUID.fullmatch(id) or type(c.get('maxPaginas')) is not int or not 1<=c['maxPaginas']<=500:falhar('COPIA_FINAL_CONFIGURACAO_RECUSADA')
 caminhos={'coletorConfiguracao':'/run/secrets/coletor.json','origemConferencia':'/run/secrets/corte/origem-congelada.json','autorizacao':'/run/secrets/corte/autorizacao-copia-final.json','estado':'/estado/copia-final/'+id,'estrutura':'/release/estrutura.json','repositorio':'/release','midiaInicial':'/midia','indiceInicial':'/run/secrets/media-index.json','arquivosIncrementais':'/estado/arquivos'}
 if any(c.get(k)!=v for k,v in caminhos.items()):falhar('COPIA_FINAL_MONTAGEM_DIVERGENTE')
 if a.get('versao')!=1 or a.get('segundoComandoExpresso') is not True or a.get('coletorSuspenso') is not True or not isinstance(a.get('referenciaMensagem'),str) or not 1<=len(a['referenciaMensagem'].strip())<=200:falhar('COPIA_FINAL_SEGUNDO_COMANDO_AUSENTE')
 if 'execucao' in a and a['execucao']!=id:falhar('COPIA_FINAL_AUTORIZACAO_DIVERGENTE')
 inicio,fim=instante(a.get('inicio')),instante(a.get('fim'))
 if fim<=inicio or fim-inicio>datetime.timedelta(hours=8) or not inicio<=em<fim:falhar('COPIA_FINAL_FORA_DA_JANELA')
 u=urllib.parse.urlparse(coletor.get('DATABASE_URL',''))
 if u.scheme not in ['postgres','postgresql'] or u.hostname!='grazing-donatella-homologacao-v2-banco' or u.path!='/donatella_preparacao':falhar('COPIA_FINAL_DESTINO_RECUSADO')
 origem=urllib.parse.urlparse(coletor.get('ATENDIMENTO_ORIGEM_URL',''))
 if origem.scheme!='https' or not origem.hostname or origem.hostname!=a.get('origemHost') or origem.username or origem.password:falhar('COPIA_FINAL_ORIGEM_RECUSADA')
 if not coletor.get('ATENDIMENTO_CARGA_SECRET') or not coletor.get('backupExterno'):falhar('COPIA_FINAL_PRESERVACAO_AUSENTE')
 if id in [o.get('execucao'),coletor.get('ATENDIMENTO_EXECUCAO_CARGA')]:falhar('COPIA_FINAL_EXECUCAO_NOVA_EXIGIDA')
 if o.get('tipo')!='manutencao-origem-v2' or not isinstance(o.get('execucao'),str) or not PADRAO_UUID.fullmatch(o['execucao']) or not isinstance(o.get('sqlFingerprint'),str) or not re.fullmatch(r'[a-f0-9]{64}',o['sqlFingerprint']):falhar('COPIA_FINAL_ORIGEM_NAO_CONFERIDA')
 for k in ['origemSuspensa','emissoresSuspensos','credenciaisDesarmadas','iaDesarmada','regrasDesarmadas','cronSuspenso']:
  if o.get(k) is not True:falhar('COPIA_FINAL_ORIGEM_NAO_CONFERIDA')
 if o.get('guardas')!=37 or any(type(o.get(k)) is not int or o[k]<0 for k in ['enviosProcessing','enviosProcessingT0']):falhar('COPIA_FINAL_ORIGEM_NAO_CONFERIDA')
 tabelas=catalogo.get('tabelas');escritores=o.get('escritoresConferidos')
 if not isinstance(tabelas,list) or not isinstance(escritores,list) or any(not isinstance(v,str) for v in escritores):falhar('COPIA_FINAL_ESCRITORES_NAO_CONFERIDOS')
 alvos={str(t.get('esquema'))+'.'+str(t.get('tabela')) for t in tabelas if isinstance(t,dict)}
 if len(alvos)!=37 or not alvos.issubset(set(escritores)):falhar('COPIA_FINAL_ESCRITORES_NAO_CONFERIDOS')
 t0,conferida=instante(o.get('t0')),instante(o.get('verificadaEm'))
 if not inicio<=t0<=conferida<=em<fim:falhar('COPIA_FINAL_MARCO_RECUSADO')
 segundos=math.floor((fim-em).total_seconds())
 if segundos<1:falhar('COPIA_FINAL_FORA_DA_JANELA')
 return id,segundos

def conferir():
 pasta=RAIZ/'configuracao/corte'
 c=ler_privado(pasta/'copia-final.json',64*1024)
 a=ler_privado(pasta/'autorizacao-copia-final.json',64*1024,exato=True)
 o=ler_privado(pasta/'origem-congelada.json')
 cfg=ler_privado(CONSULTA)
 catalogo=ler_privado(REPOSITORIO/'estrutura.json',8*1024*1024,modo=False)
 return validar_configuracao(c,a,o,cfg,catalogo,datetime.datetime.now(datetime.timezone.utc))

def validar_coletor(inspecao):
 if not isinstance(inspecao,list) or len(inspecao)!=1:falhar('COPIA_FINAL_COLETOR_NAO_CONFERIDO')
 c=inspecao[0];s=c.get('State',{})
 if c.get('Name')!='/'+COLETOR or s.get('Status')!='exited' or s.get('Running') is not False or s.get('Restarting') is not False or s.get('Paused') is not False or s.get('Dead') is True:falhar('COPIA_FINAL_COLETOR_ATIVO_OU_INCERTO')
 return True

def validar_resultado(r,id):
 if not isinstance(r,dict) or r.get('versao')!=1 or r.get('idCopiaFinal')!=id:falhar('COPIA_FINAL_RELATORIO_DIVERGENTE')
 if r.get('fase')!='materializada' or r.get('tabelasConcluidas')!=37 or not r.get('materializadaEm'):falhar('COPIA_FINAL_PARCIAL_CONFERIR')
 if r.get('ackOrigemExecutado') is not False or r.get('importacaoOperacionalExecutada') is not False or not isinstance(r.get('lacunas'),list):falhar('COPIA_FINAL_RELATORIO_DIVERGENTE')
 return True

def principal(args):
 if args==['--conferir']:
  id,segundos=conferir();print(id,segundos)
 elif args==['--coletor']:
  b=sys.stdin.buffer.read(1024*1024+1)
  if len(b)>1024*1024:falhar('COPIA_FINAL_COLETOR_NAO_CONFERIDO')
  validar_coletor(json.loads(b))
 elif len(args)==2 and args[0]=='--resultado' and PADRAO_UUID.fullmatch(args[1]):
  r=ler_privado(RAIZ/'configuracao/corte/executor'/(args[1]+'-relatorio.json'));validar_resultado(r,args[1])
 else:falhar('COPIA_FINAL_ARGUMENTO_RECUSADO')

if __name__=='__main__':
 try:principal(sys.argv[1:])
 except Exception as e:
  codigo=str(e);print(codigo if re.fullmatch(r'COPIA_FINAL_[A-Z_]+',codigo) else 'COPIA_FINAL_CONFERENCIA_INTERROMPIDA',file=sys.stderr);sys.exit(1)
