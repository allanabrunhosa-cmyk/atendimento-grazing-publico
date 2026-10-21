"""Produtor manual da prova T0. Somente leitura de bancos/R2; sem habilitação.

Exige segundo comando, importadores concluídos, coletor parado e destino em
receber. O contêiner só escreve em uma pasta nova de resultados; não recebe
Docker, chave mestra ou acesso de escrita à configuração/estado da migração.
"""
import datetime,hashlib,importlib.util,json,math,os,re,subprocess,sys,uuid
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
CONFIG_COLETOR = caminho_privado('ATENDIMENTO_CONFIG_COLETOR')
CONFIG_CHECKPOINT = caminho_privado('ATENDIMENTO_CONFIG_CHECKPOINT_R2')
RELEASE_CONTROLE = caminho_privado('ATENDIMENTO_RELEASE_CONTROLE')
UUID=re.compile(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}')
LABEL='prontidao-final-verificacao-v1'
COLETOR='grazing-donatella-coletor-v2'
IMAGEM='grazing-donatella-consulta-v2:20261008-a'

def falhar(c):raise RuntimeError(c)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def comando(args,timeout=45):
 try:r=subprocess.run(args,text=True,capture_output=True,timeout=timeout)
 except (OSError,subprocess.TimeoutExpired):falhar('PRONTIDAO_FINAL_JOB_INCONCLUSIVO_PRESERVADO')
 if r.returncode:falhar('PRONTIDAO_FINAL_COMANDO_RECUSADO')
 return r.stdout.strip()
def caminho(p,diretorio=False):
 if any(v.is_symlink() for v in [p,*p.parents]) or not (p.is_dir() if diretorio else p.is_file()):falhar('PRONTIDAO_FINAL_CAMINHO_RECUSADO')
def validar_coletor(ins):
 if not isinstance(ins,list) or len(ins)!=1 or ins[0].get('Name')!='/'+COLETOR:falhar('PRONTIDAO_FINAL_COLETOR_NAO_CONFERIDO')
 s=ins[0].get('State',{})
 if s.get('Status')!='exited' or any(s.get(k) is not False for k in ['Running','Paused','Restarting','Dead']):falhar('PRONTIDAO_FINAL_COLETOR_ATIVO')
def validar_gate(c):
 if c.get('modo')!='receber' or c.get('autoridade')!='nenhuma' or c.get('enviosHabilitados') is not False or c.get('iaAutomatica') is not False or c.get('voz',{}).get('sinteseHabilitada') is not False:falhar('PRONTIDAO_FINAL_DESTINO_NAO_DESARMADO')
def publicar_exclusivo(origem,destino):
 caminho(origem)
 limite=1024*1024 if origem.name=='reconciliacao.json' else 128*1024
 if origem.stat().st_size>limite:falhar('PRONTIDAO_FINAL_RESULTADO_RECUSADO')
 with destino.open('xb') as f:os.fchmod(f.fileno(),0o600);f.write(origem.read_bytes());f.flush();os.fsync(f.fileno())
 fd=os.open(destino.parent,os.O_RDONLY)
 try:os.fsync(fd)
 finally:os.close(fd)

def operar(ctl,runner=comando,raiz=ROOT):
 corte=raiz/'configuracao/corte';gatep=raiz/'configuracao/operacao.json';runtime=raiz/'release/operacao.mjs';bundle=raiz/'release/corte/verificar-prontidao-final.mjs'
 for p in [gatep,runtime,bundle,corte/'autorizacao.json',corte/'prova-final.json']:caminho(p)
 auth=ctl.ler(corte/'autorizacao.json');gate=ctl.ler(gatep);runtime_hash=sha(runtime);ctl.validar_config(gate);validar_gate(gate);ctl.validar_autorizacao(auth,gate,runtime_hash,ctl.agora())
 c=ctl.ler(corte/'prova-final.json');id=c.get('execucao','')
 if c.get('versao')!=1 or not isinstance(id,str) or not UUID.fullmatch(id) or not UUID.fullmatch(str(c.get('checkpointOperacao',''))):falhar('PRONTIDAO_FINAL_CONFIGURACAO_RECUSADA')
 marco=ctl.vinculo_importacao_woo(corte)
 if not isinstance(marco,dict) or marco.get('idCopiaFinal')!=id:falhar('PRONTIDAO_FINAL_MARCO_DIVERGENTE')
 def conferir():
  atual=ctl.ler(gatep);ctl.validar_config(atual);validar_gate(atual);ctl.validar_autorizacao(ctl.ler(corte/'autorizacao.json'),atual,sha(runtime),ctl.agora())
  if sha(runtime)!=runtime_hash or atual!=gate or ctl.vinculo_importacao_woo(corte)!=marco:falhar('PRONTIDAO_FINAL_MARCO_ALTERADO')
  validar_coletor(json.loads(runner(['docker','inspect',COLETOR])))
  ctl.conferir_importacoes_operacionais(raiz,marco=marco);ctl.conferir_importacoes_woo(raiz,marco=marco)
  ativos=runner(['docker','ps','-q','--filter','label=grazing.finalidade=copia-final-programada-v2'])
  if ativos:falhar('PRONTIDAO_FINAL_COPIA_AINDA_ATIVA')
  app=json.loads(runner(['docker','inspect','grazing-donatella-operacao-v2']))
  if not isinstance(app,list) or len(app)!=1 or app[0].get('State',{}).get('Running') is not True:falhar('PRONTIDAO_FINAL_RECEPTOR_AUSENTE')
  env=dict(v.split('=',1) for v in app[0].get('Config',{}).get('Env',[]) if '=' in v)
  if env.get('ATENDIMENTO_ENVIO_HABILITADO')!='false' or env.get('ATENDIMENTO_AUTORIDADE_ENVIO')!='nenhuma':falhar('PRONTIDAO_FINAL_RECEPTOR_NAO_DESARMADO')
 conferir()
 if runner(['docker','ps','-q','--filter','label=grazing.finalidade='+LABEL]):falhar('PRONTIDAO_FINAL_JOB_ATIVO_CONFERIR_SEM_REPETIR')
 pasta=corte/'verificacoes';pasta.mkdir(mode=0o700,exist_ok=True);caminho(pasta,True)
 existentes=[p.exists() for p in [corte/'prontidao-final.json',pasta/(id+'-prontidao.json'),pasta/(id+'-reconciliacao.json')]]
 if any(existentes) and not all(existentes):falhar('PRONTIDAO_FINAL_PROVA_PARCIAL_CONFERIR_SEM_REPETIR')
 revalidacao=all(existentes);execucao=id if not revalidacao else str(uuid.uuid4());nome='grazing-donatella-prova-final-'+execucao
 saida=pasta/('execucao-'+execucao)
 if saida.exists() or runner(['docker','ps','-aq','--filter','name=^/'+nome+'$']):falhar('PRONTIDAO_FINAL_JOB_EXISTENTE_CONFERIR_SEM_REPETIR')
 if revalidacao:
  ctl.conferir_prontidao_final('habilitar-humano',corte,gate,ctl.ler(corte/'prontidao-final.json'),ctl.ler(corte/'origem-congelada.json'),runtime_hash,auth)
 for p in [pasta/(id+'-origem-posterior.json'),pasta/('ensaio-receptor-'+runtime_hash+'.json'),CONFIG_COLETOR,CONFIG_CHECKPOINT,raiz/'configuracao/importacao.json']:caminho(p)
 saida.mkdir(mode=0o700)
 args=['docker','create','--pull=never','--name',nome,'--label','grazing.finalidade='+LABEL,'--restart=no','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','768m','--cpus','0.75','--pids-limit','128','--network','grazing-donatella-coletor-v2-saida','--workdir','/release']
 mounts=[('bind',str(raiz/'release'),'/release',False),('bind',str(RELEASE_CONTROLE),'/preparacao',False),('bind',str(corte),'/corte',False),('bind',str(saida),'/resultado',True),('bind',str(gatep),'/run/secrets/operacao.json',False),('bind',str(CONFIG_COLETOR),'/run/secrets/coletor.json',False),('bind',str(CONFIG_CHECKPOINT),'/run/secrets/checkpoint.json',False),('bind',str(raiz/'configuracao/importacao.json'),'/run/secrets/importacao.json',False),('volume','grazing-donatella-coletor-v2-estado','/estado',False),('volume','grazing-donatella-checkpoints-operacao-v2-estado','/checkpoints',False)]
 for tipo,fonte,destino,rw in mounts:args+=['--mount',f'type={tipo},src={fonte},dst={destino}'+('' if rw else ',readonly')]
 args+=['--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=32m','--log-driver','json-file','--log-opt','max-size=1m','--log-opt','max-file=2',IMAGEM,'/release/corte/verificar-prontidao-final.mjs','--conferir-prontidao-final']
 ctl.gravar(saida/'intencao.json',{'versao':1,'idCopiaFinal':id,'runtimeSha256':runtime_hash,'container':nome,'inicio':ctl.agora().isoformat(),'somenteLeituraNegocio':True},True)
 runner(args)
 for rede in ['grazing-donatella-homologacao-v2-privada','grazing-donatella-operacao-v2-privada']:
  if runner(['docker','network','inspect',rede,'--format','{{.Internal}}'])!='true':falhar('PRONTIDAO_FINAL_REDE_PRIVADA_RECUSADA')
  runner(['docker','network','connect',rede,nome])
 conferir()
 segundos=math.floor((ctl.instante(auth['fim'])-ctl.agora()).total_seconds())
 if segundos<1:falhar('PRONTIDAO_FINAL_FORA_DA_JANELA')
 runner(['docker','start','-a',nome],timeout=segundos)
 ins=json.loads(runner(['docker','inspect',nome]))
 if len(ins)!=1 or ins[0].get('State',{}).get('Status')!='exited' or ins[0].get('State',{}).get('ExitCode')!=0:falhar('PRONTIDAO_FINAL_JOB_INCONCLUSIVO_PRESERVADO')
 conferir()
 if revalidacao:
  # Releitura integral nova, preservando a prova anterior e a nova em caminhos
  # exclusivos. A referência já aceita só continua válida para o mesmo marco.
  antiga=ctl.ler(pasta/(id+'-prontidao.json'));nova=ctl.ler(saida/'prova.json')
  for k in ['idCopiaFinal','t0','runtimeSha256','vinculos','copia','origemPosterior','entrada']:
   if nova.get(k)!=antiga.get(k):falhar('PRONTIDAO_FINAL_REVALIDACAO_MARCO_ALTERADO')
  if nova.get('r2',{}).get('estado')!=antiga.get('r2',{}).get('estado'):falhar('PRONTIDAO_FINAL_REVALIDACAO_MARCO_ALTERADO')
  ctl.gravar(saida/'revalidacao.json',{'versao':1,'idCopiaFinal':id,'runtimeSha256':runtime_hash,'provaOriginalSha256':sha(pasta/(id+'-prontidao.json')),'releituraSha256':sha(saida/'prova.json'),'concluidaEm':ctl.agora().isoformat()},True)
 else:
  for src,dst in [('reconciliacao.json',pasta/(id+'-reconciliacao.json')),('prova.json',pasta/(id+'-prontidao.json')),('prontidao-final.json',corte/'prontidao-final.json')]:publicar_exclusivo(saida/src,dst)
 prova=ctl.ler(corte/'prontidao-final.json');origem=ctl.ler(corte/'origem-congelada.json')
 resultado=ctl.conferir_prontidao_final('habilitar-humano',corte,gate,prova,origem,runtime_hash,auth)
 return {'provaConferida':True,'revalidacaoIntegral':revalidacao,**resultado,'enviosHabilitados':False,'webhookAlterado':False}

def principal():
 if os.name!='posix' or fcntl is None or sys.argv[1:]!=['--conferir-prontidao-final']:falhar('PRONTIDAO_FINAL_EXECUCAO_MANUAL_EXIGIDA')
 corte=ROOT/'configuracao/corte';caminho(corte,True);p=ROOT/'ferramentas/controle-corte-programado.py';caminho(p)
 spec=importlib.util.spec_from_file_location('controle_prova_final',p);ctl=importlib.util.module_from_spec(spec);spec.loader.exec_module(ctl)
 lock=corte/'controle.lock'
 if lock.is_symlink():falhar('PRONTIDAO_FINAL_CAMINHO_RECUSADO')
 with lock.open('a') as f:
  os.fchmod(f.fileno(),0o600)
  try:fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:falhar('PRONTIDAO_FINAL_CONTROLE_OCUPADO')
  print(json.dumps(operar(ctl)))
if __name__=='__main__':
 try:principal()
 except BaseException as e:
  c=str(e);print(c if re.fullmatch(r'(PRONTIDAO_FINAL|CORTE|IMPORTACAO_FINAL)_[A-Z0-9_]+',c) else 'PRONTIDAO_FINAL_INTERROMPIDA',file=sys.stderr);sys.exit(1)
