"""Importação manual do clone materializado em T0; não congela nem envia.

O job e seu recibo são preservados inclusive se o cliente expirar. Nenhum
resultado incerto é repetido automaticamente. O controlador usa a mesma trava.
"""
import copy,datetime,hashlib,importlib.util,json,math,os,re,subprocess,sys,urllib.parse
from pathlib import Path
try:import fcntl
except ImportError:fcntl=None


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
ORIGEM_DB='grazing-donatella-homologacao-v2-banco'
DESTINO_DB='grazing-donatella-operacao-v2-banco'
COLETOR='grazing-donatella-coletor-v2'
APP='grazing-donatella-operacao-v2'
REDES=('grazing-donatella-operacao-v2-privada','grazing-donatella-homologacao-v2-privada')
VOLUME='grazing-donatella-coletor-v2-estado'
INDICE = caminho_privado('ATENDIMENTO_INDICE_MIDIA')
MIDIA = caminho_privado('ATENDIMENTO_MIDIA_ORIGEM')
LABEL='importacao-operacao-final-programada-v2'
PREFIXO='grazing-donatella-importacao-operacao-'
UUID=re.compile(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}')
SHA=re.compile(r'[a-f0-9]{64}')
CODIGO=re.compile(r'(?:CORTE|IMPORTACAO_FINAL)_[A-Z0-9_]{1,100}')
ENTIDADES={'contato','conversa','mensagem','anexo','etapa','negocio','compromisso'}
CONTAGENS=('observados','inseridos','atualizados','iguais','preservados','lacunas','verificados','divergentes')

def falhar(codigo):raise RuntimeError(codigo)
def hash_arquivo(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def agora():return datetime.datetime.now(datetime.timezone.utc)
def codigo_seguro(e):
 s=str(e)
 return s if CODIGO.fullmatch(s) else 'IMPORTACAO_FINAL_ESTADO_NAO_CONFIRMADO'
def comando(args,timeout=45):
 try:r=subprocess.run(args,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout)
 except subprocess.TimeoutExpired:falhar('IMPORTACAO_FINAL_PRAZO_EXCEDIDO_JOB_PRESERVADO')
 except OSError:falhar('IMPORTACAO_FINAL_COMANDO_NAO_CONFIRMADO')
 if r.returncode:falhar('IMPORTACAO_FINAL_COMANDO_RECUSADO')
 return r.stdout.strip()
def caminho_seguro(p,diretorio=False):
 if any(v.is_symlink() for v in [p,*p.parents]) or not (p.is_dir() if diretorio else p.is_file()):falhar('IMPORTACAO_FINAL_CAMINHO_RECUSADO')

def validar_gate(c):
 if c.get('modo')!='receber' or c.get('autoridade')!='nenhuma' or c.get('enviosHabilitados') is not False or c.get('iaAutomatica') is not False:falhar('IMPORTACAO_FINAL_DESTINO_NAO_DESARMADO')

def validar_configuracao(c,gate):
 for chave,host,banco in [('origemDatabaseUrl',ORIGEM_DB,'donatella_preparacao'),('destinoDatabaseUrl',DESTINO_DB,'donatella_operacao')]:
  u=urllib.parse.urlparse(c.get(chave,''))
  if u.scheme!='postgresql' or u.hostname!=host or u.path!='/'+banco or u.port not in (None,5432) or not u.password or not u.username or u.query or u.fragment:falhar('IMPORTACAO_FINAL_BANCO_RECUSADO')
  if chave=='origemDatabaseUrl' and u.username!='donatella_importacao_operacao':falhar('IMPORTACAO_FINAL_PAPEL_LEITURA_RECUSADO')
 if c['destinoDatabaseUrl']!=gate['databaseUrl'] or c.get('phoneNumberId')!=gate['meta']['phoneId']:falhar('IMPORTACAO_FINAL_ESCOPO_DIVERGENTE')
 fixos={'manifestoInicial':'/run/secrets/media-index.json','midiaLegadaRaiz':'/legado/midia','midiaIncrementalRaiz':'/legado/incrementais/arquivos/conteudos'}
 if any(c.get(k)!=v for k,v in fixos.items()):falhar('IMPORTACAO_FINAL_MONTAGEM_RECUSADA')
 s=urllib.parse.urlparse(c.get('origemStorageURL',''))
 if s.scheme!='https' or not s.hostname or s.username or s.password or s.query or s.fragment:falhar('IMPORTACAO_FINAL_STORAGE_RECUSADO')
 for chave in ('usuariosRevisados','equipesRevisadas'):
  m=c.get(chave)
  if not isinstance(m,dict) or len(m)>1000 or any(not isinstance(k,str) or not UUID.fullmatch(k) or not isinstance(v,str) or not UUID.fullmatch(v) for k,v in m.items()):falhar('IMPORTACAO_FINAL_IDENTIDADES_RECUSADAS')
 if type(c.get('pagina',250)) is not int or not 1<=c.get('pagina',250)<=1000:falhar('IMPORTACAO_FINAL_PAGINA_RECUSADA')

def validar_coletor(i):
 if not isinstance(i,list) or len(i)!=1 or i[0].get('Name')!='/'+COLETOR:falhar('IMPORTACAO_FINAL_COLETOR_NAO_CONFERIDO')
 s=i[0].get('State',{})
 if s.get('Status')!='exited' or any(s.get(k) is not False for k in ('Running','Restarting','Paused','Dead')):falhar('IMPORTACAO_FINAL_COLETOR_ATIVO_OU_INCERTO')

def validar_job(i,nome,raiz,configjob,concluido=False):
 if not isinstance(i,list) or len(i)!=1 or i[0].get('Name')!='/'+nome:falhar('IMPORTACAO_FINAL_JOB_NAO_CONFERIDO')
 j=i[0];s=j.get('State',{});h=j.get('HostConfig',{})
 if s.get('Status')!=('exited' if concluido else 'created') or any(s.get(k) is not False for k in ('Running','Restarting','Paused','Dead')) or concluido and (type(s.get('ExitCode')) is not int or s['ExitCode']!=0):falhar('IMPORTACAO_FINAL_JOB_ATIVO_OU_INCERTO')
 if set(j.get('NetworkSettings',{}).get('Networks',{}))!=set(REDES):falhar('IMPORTACAO_FINAL_JOB_REDE_DIVERGENTE')
 if h.get('Memory')!=768*1024*1024 or h.get('ReadonlyRootfs') is not True or h.get('Privileged') is not False or h.get('RestartPolicy',{}).get('Name')!='no':falhar('IMPORTACAO_FINAL_JOB_PROTECAO_DIVERGENTE')
 esperadas={'/run/secrets/importacao.json':('bind',str(configjob)),'/run/secrets/media-index.json':('bind',str(INDICE)),'/release':('bind',str(raiz/'release')),'/legado/midia':('bind',str(MIDIA)),'/legado/incrementais':('volume',VOLUME)}
 mounts=j.get('Mounts',[])
 if not isinstance(mounts,list) or len(mounts)!=len(esperadas) or len({m.get('Destination') for m in mounts})!=len(esperadas):falhar('IMPORTACAO_FINAL_JOB_MONTAGEM_DIVERGENTE')
 for m in mounts:
  esperado=esperadas.get(m.get('Destination'))
  if esperado is None or m.get('Type')!=esperado[0] or m.get('Name' if esperado[0]=='volume' else 'Source')!=esperado[1] or m.get('RW') is not False:falhar('IMPORTACAO_FINAL_JOB_MONTAGEM_DIVERGENTE')
 if j.get('Config',{}).get('Cmd')!=['/release/corte/importar-operacao.mjs','/run/secrets/importacao.json']:falhar('IMPORTACAO_FINAL_JOB_COMANDO_DIVERGENTE')

def validar_resultado(d,id,marco):
 if not isinstance(d,dict) or d.get('id')!='corte-'+id or d.get('marcador')!=marco['t0'] or type(d.get('enviosExternos')) is not int or d['enviosExternos']!=0:falhar('IMPORTACAO_FINAL_RESULTADO_DIVERGENTE')
 e=d.get('entidades');a=d.get('arquivos');l=d.get('lacunas')
 if not isinstance(e,dict) or not (ENTIDADES-{'anexo'}).issubset(e) or set(e)-ENTIDADES or not isinstance(a,dict) or not isinstance(l,dict) or len(l)>100:falhar('IMPORTACAO_FINAL_RESULTADO_RECUSADO')
 def natural(v):return type(v) is int and 0<=v<=2**53-1
 entidades={}
 for n,v in e.items():
  if not isinstance(v,dict) or any(not natural(v.get(k)) for k in CONTAGENS) or any(not isinstance(v.get(k),str) or v[k] and not SHA.fullmatch(v[k]) for k in ('hashConteudo','hashDestino')):falhar('IMPORTACAO_FINAL_RESULTADO_RECUSADO')
  if v['divergentes']!=0:falhar('IMPORTACAO_FINAL_CONTEUDO_DIVERGENTE')
  entidades[n]={k:v[k] for k in (*CONTAGENS,'hashConteudo','hashDestino')}
 chaves_arquivo=('referencias','conteudosVerificados','bytesVerificados','indisponiveis')
 if any(not natural(a.get(k)) for k in chaves_arquivo) or any(not isinstance(k,str) or not re.fullmatch(r'[A-Z][A-Z0-9_]{0,100}',k) or not natural(v) for k,v in l.items()):falhar('IMPORTACAO_FINAL_RESULTADO_RECUSADO')
 return {'idImportacao':'corte-'+id,'marcador':marco['t0'],'entidades':entidades,'arquivos':{k:a[k] for k in chaves_arquivo},'lacunas':l,'enviosExternos':0}

def conferir_importacoes_operacionais(ctl,runner=comando,raiz=ROOT,ignorar=None,marco=None):
 """Guarda reutilizável pelo controlador: somente inspeções, sem retomada.

Um recibo inconclusivo ou um job sem recibo bloqueia habilitação e novos jobs.
"""
 if ignorar is not None and not UUID.fullmatch(ignorar):falhar('IMPORTACAO_FINAL_ID_RECUSADO')
 ids=runner(['docker','ps','-a','--filter','label=grazing.finalidade='+LABEL,'--format','{{.ID}}']).splitlines()
 if len(ids)>1000 or any(not re.fullmatch(r'[a-f0-9]{12,64}',i) for i in ids):falhar('IMPORTACAO_FINAL_INSPECAO_RECUSADA')
 jobs={}
 if ids:
  ins=json.loads(runner(['docker','inspect',*ids]))
  if not isinstance(ins,list) or len(ins)!=len(ids):falhar('IMPORTACAO_FINAL_INSPECAO_RECUSADA')
  for j in ins:
   nome=j.get('Name','').removeprefix('/');id=nome.removeprefix(PREFIXO)
   if not nome.startswith(PREFIXO) or not UUID.fullmatch(id) or j.get('Config',{}).get('Labels',{}).get('grazing.finalidade')!=LABEL or id in jobs:falhar('IMPORTACAO_FINAL_INSPECAO_RECUSADA')
   if id==ignorar:continue
   s=j.get('State',{})
   if s.get('Status')!='exited' or type(s.get('ExitCode')) is not int or s['ExitCode']!=0 or any(s.get(k) is not False for k in ('Running','Restarting','Paused','Dead')):falhar('IMPORTACAO_FINAL_JOB_ATIVO_OU_INCERTO')
   jobs[id]=j
 pasta=raiz/'configuracao/corte/importacoes-operacao';vistos=set();finais=[]
 if pasta.exists():
  caminho_seguro(pasta,True);recibos=list(pasta.glob('*-recibo.json'))
  if len(recibos)>1000:falhar('IMPORTACAO_FINAL_RECIBO_RECUSADO')
  for p in recibos:
   id=p.name.removesuffix('-recibo.json')
   if id==ignorar:continue
   r=ctl.ler(p)
   if not UUID.fullmatch(id) or r.get('versao')!=1 or r.get('idCopiaFinal')!=id or r.get('container')!=PREFIXO+id:falhar('IMPORTACAO_FINAL_RECIBO_RECUSADO')
   if r.get('estado')!='concluida' or r.get('fase')!='concluida' or type(r.get('exitCode')) is not int or r['exitCode']!=0 or id not in jobs:falhar('IMPORTACAO_FINAL_RECIBO_INCONCLUSIVO_SEM_REPETIR')
   if ctl.instante(r['fim'])<ctl.instante(r['inicio']):falhar('IMPORTACAO_FINAL_RECIBO_RECUSADO')
   validar_resultado({**r.get('resultado',{}),'id':'corte-'+id},id,r['marcoFinal'])
   vistos.add(id)
   if r.get('marcoFinal')==marco:finais.append(r)
 if set(jobs)-vistos:falhar('IMPORTACAO_FINAL_JOB_SEM_RECIBO')
 if marco is not None and not finais:falhar('IMPORTACAO_FINAL_MARCO_NAO_IMPORTADO')
 return finais

def operar(ctl,runner=comando,quando=agora,raiz=ROOT,conferir_caminhos=True):
 """Fronteira ensaiável; produção chama somente com controle.lock adquirido."""
 corte=raiz/'configuracao/corte';config=raiz/'configuracao/importacao.json';gatep=raiz/'configuracao/operacao.json'
 bundle=raiz/'release/corte/importar-operacao.mjs';runtime=raiz/'release/operacao.mjs'
 if conferir_caminhos:
  for p in (config,gatep,bundle,runtime,INDICE):caminho_seguro(p)
  caminho_seguro(MIDIA,True)
 gate=ctl.ler(gatep);ctl.validar_config(gate)
 release=hash_arquivo(runtime);auth=ctl.ler(corte/'autorizacao.json');ctl.validar_autorizacao(auth,gate,release,quando())
 if quando()>=ctl.instante(auth['fim']):falhar('IMPORTACAO_FINAL_FORA_DA_JANELA')
 validar_gate(gate)
 origem=ctl.ler(corte/'origem-congelada.json');ctl.validar_origem(origem,auth)
 marco=ctl.vinculo_importacao_woo(corte)
 if not isinstance(marco,dict) or marco.get('t0')!=origem.get('t0') or not UUID.fullmatch(str(marco.get('idCopiaFinal',''))):falhar('IMPORTACAO_FINAL_COPIA_MATERIALIZADA_EXIGIDA')
 id=marco['idCopiaFinal'];nome=PREFIXO+id;pasta=corte/'importacoes-operacao';recibo=pasta/(id+'-recibo.json');configjob=pasta/(id+'-config.json')
 if recibo.exists() or configjob.exists():falhar('IMPORTACAO_FINAL_EXECUCAO_EXISTENTE_SEM_REPETIR')
 cfg=ctl.ler(config);validar_configuracao(cfg,gate)
 anterior={'config':hash_arquivo(config),'gate':hash_arquivo(gatep),'runtime':release,'bundle':hash_arquivo(bundle),'indice':hash_arquivo(INDICE),'auth':hash_arquivo(corte/'autorizacao.json')}
 obj={'versao':1,'idCopiaFinal':id,'t0':marco['t0'],'container':nome,'inicio':quando().isoformat(),'estado':'iniciada','fase':'preflight','marcoFinal':marco,'runtimeSha256':release,'bundleSha256':anterior['bundle'],'configuracaoOriginalSha256':anterior['config'],'enviosExternos':0}
 ctl.gravar(recibo,obj,True)
 def gravar(fase):obj['fase']=fase;ctl.gravar(recibo,obj)
 def conferir():
  atual=ctl.ler(gatep);ctl.validar_config(atual);validar_gate(atual)
  ctl.validar_autorizacao(ctl.ler(corte/'autorizacao.json'),atual,hash_arquivo(runtime),quando())
  if quando()>=ctl.instante(auth['fim']):falhar('IMPORTACAO_FINAL_FORA_DA_JANELA')
  ctl.validar_origem(ctl.ler(corte/'origem-congelada.json'),auth)
  if ctl.vinculo_importacao_woo(corte)!=marco:falhar('IMPORTACAO_FINAL_MARCO_ALTERADO')
  for chave,p in [('config',config),('gate',gatep),('runtime',runtime),('bundle',bundle),('indice',INDICE),('auth',corte/'autorizacao.json')]:
   if hash_arquivo(p)!=anterior[chave]:falhar('IMPORTACAO_FINAL_ARQUIVO_ALTERADO')
  validar_coletor(json.loads(runner(['docker','inspect',COLETOR])))
  app=json.loads(runner(['docker','inspect',APP]))
  if not isinstance(app,list) or len(app)!=1 or app[0].get('Name')!='/'+APP or app[0].get('State',{}).get('Running') is not True:falhar('IMPORTACAO_FINAL_RECEPTOR_NAO_CONFERIDO')
  a=app[0];labels=a.get('Config',{}).get('Labels',{});env=dict(v.split('=',1) for v in a.get('Config',{}).get('Env',[]) if '=' in v)
  if labels.get('com.docker.compose.project')!=APP or labels.get('com.docker.compose.service')!='operacao' or env.get('ATENDIMENTO_ENVIO_HABILITADO')!='false' or env.get('ATENDIMENTO_AUTORIDADE_ENVIO')!='nenhuma':falhar('IMPORTACAO_FINAL_RECEPTOR_NAO_DESARMADO')
  montagens=[m for m in a.get('Mounts',[]) if m.get('Destination')=='/run/secrets/operacao.json']
  if len(montagens)!=1 or montagens[0].get('Source')!=str(gatep) or montagens[0].get('RW') is not False:falhar('IMPORTACAO_FINAL_RECEPTOR_CONFIGURACAO_DIVERGENTE')
 try:
  conferir_importacoes_operacionais(ctl,runner,raiz,ignorar=id)
  existentes=runner(['docker','ps','-a','--filter','name=^/'+nome+'$','--format','{{.Names}}'])
  if existentes:falhar('IMPORTACAO_FINAL_JOB_EXISTENTE_SEM_REPETIR')
  for rede in REDES:
   if runner(['docker','network','inspect',rede,'--format','{{.Internal}}'])!='true':falhar('IMPORTACAO_FINAL_REDE_EXTERNA_RECUSADA')
  volume=json.loads(runner(['docker','volume','inspect',VOLUME]))
  if not isinstance(volume,list) or len(volume)!=1 or volume[0].get('Name')!=VOLUME or volume[0].get('Mountpoint')!='/var/lib/docker/volumes/'+VOLUME+'/_data':falhar('IMPORTACAO_FINAL_VOLUME_RECUSADO')
  for banco,finalidade in [(ORIGEM_DB,'preparacao-privada'),(DESTINO_DB,'operacao-privada')]:
   ins=json.loads(runner(['docker','inspect',banco]))
   if not isinstance(ins,list) or len(ins)!=1 or ins[0].get('Name')!='/'+banco or ins[0].get('State',{}).get('Running') is not True or ins[0].get('Config',{}).get('Labels',{}).get('grazing.finalidade')!=finalidade:falhar('IMPORTACAO_FINAL_BANCO_NAO_CONFERIDO')
  conferir()
  job=copy.deepcopy(cfg);job.update(idImportacao='corte-'+id,marcador=marco['t0'])
  gravar('preparar_configuracao_job');ctl.gravar(configjob,job,True);obj['configuracaoJobSha256']=hash_arquivo(configjob);gravar('criar_container')
  runner(['docker','create','--pull=never','--name',nome,'--label','grazing.finalidade='+LABEL,'--label','grazing.execucao='+id,'--restart=no','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','768m','--cpus','0.75','--pids-limit','128','--network',REDES[0],'--mount','type=bind,src='+str(configjob)+',dst=/run/secrets/importacao.json,readonly','--mount','type=bind,src='+str(INDICE)+',dst=/run/secrets/media-index.json,readonly','--mount','type=bind,src='+str(raiz/'release')+',dst=/release,readonly','--mount','type=bind,src='+str(MIDIA)+',dst=/legado/midia,readonly','--mount','type=volume,src='+VOLUME+',dst=/legado/incrementais,readonly','--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=32m','--workdir','/release','--log-driver','json-file','--log-opt','max-size=1m','--log-opt','max-file=2','grazing-donatella-consulta-v2:20261008-a','/release/corte/importar-operacao.mjs','/run/secrets/importacao.json'])
  gravar('conectar_rede');runner(['docker','network','connect',REDES[1],nome])
  gravar('conferir_antes_inicio');conferir();conferir_importacoes_operacionais(ctl,runner,raiz,ignorar=id)
  validar_job(json.loads(runner(['docker','inspect',nome])),nome,raiz,configjob)
  if hash_arquivo(configjob)!=obj['configuracaoJobSha256']:falhar('IMPORTACAO_FINAL_CONFIGURACAO_JOB_ALTERADA')
  segundos=min(1800,math.floor((ctl.instante(auth['fim'])-quando()).total_seconds()))
  if segundos<1:falhar('IMPORTACAO_FINAL_FORA_DA_JANELA')
  gravar('executar_importacao');saida=runner(['docker','start','-a',nome],timeout=segundos)
  gravar('conferir_resultado')
  validar_job(json.loads(runner(['docker','inspect',nome])),nome,raiz,configjob,concluido=True)
  if len(saida)>128*1024:falhar('IMPORTACAO_FINAL_RESULTADO_RECUSADO')
  resultado=validar_resultado(json.loads(saida),id,marco);conferir()
  if hash_arquivo(configjob)!=obj['configuracaoJobSha256']:falhar('IMPORTACAO_FINAL_CONFIGURACAO_JOB_ALTERADA')
  obj.update(estado='concluida',fase='concluida',fim=quando().isoformat(),exitCode=0,resultado=resultado);ctl.gravar(recibo,obj)
  return {'estado':'concluida','idCopiaFinal':id,'runtimeSha256':release,'bundleSha256':anterior['bundle'],**resultado}
 except BaseException as e:
  obj.update(estado='inconclusiva_conferir_sem_repetir',fim=quando().isoformat(),erro=codigo_seguro(e));ctl.gravar(recibo,obj)
  falhar(obj['erro'])

def executar():
 if os.name!='posix' or fcntl is None:falhar('IMPORTACAO_FINAL_AMBIENTE_RECUSADO')
 caminho_seguro(ROOT,True);caminho_seguro(ROOT/'configuracao/corte',True)
 controle=ROOT/'ferramentas/controle-corte-programado.py';caminho_seguro(controle)
 spec=importlib.util.spec_from_file_location('controle_importacao_final',controle);ctl=importlib.util.module_from_spec(spec);spec.loader.exec_module(ctl)
 lockp=ROOT/'configuracao/corte/controle.lock'
 if lockp.is_symlink():falhar('IMPORTACAO_FINAL_LOCK_RECUSADO')
 with lockp.open('a') as lock:
  os.fchmod(lock.fileno(),0o600);fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  return operar(ctl)

if __name__=='__main__':
 try:
  os.umask(0o077)
  if sys.argv[1:]!=['--importar-copia-final']:falhar('IMPORTACAO_FINAL_ARGUMENTO_RECUSADO')
  print(json.dumps(executar()))
 except BaseException as e:
  print(json.dumps({'erro':codigo_seguro(e),'enviosExternos':0}),file=sys.stderr);sys.exit(1)
