#!/bin/sh
# Importa configuração e estado-base preservados. Não recebe eventos, não envia,
# não altera callbacks e não reproduz filas antigas. Pode ser usado na preparação
# e novamente após a cópia final materializada, antes de conectar os callbacks.
set -eu
umask 077
validar_caminho_privado() {
 case "$1" in /*) ;; *) echo CAMINHO_PRIVADO_RECUSADO >&2; exit 1;; esac
 case "$1" in /|*[!A-Za-z0-9_./-]*|*//*|*/./*|*/../*|*/.|*/..|*/) echo CAMINHO_PRIVADO_RECUSADO >&2; exit 1;; esac
}
test "$#" -eq 1 && test "$1" = --importar-configuracao-preservada || { echo WOO_IMPORTACAO_MANUAL_EXIGIDA >&2; exit 1; }
raiz=${ATENDIMENTO_RAIZ_REMOTA_OPERACAO:?ATENDIMENTO_RAIZ_REMOTA_OPERACAO_OBRIGATORIA}
validar_caminho_privado "$raiz"
python3 - "$raiz" <<'PY'
import datetime,fcntl,importlib.util,json,os,re,subprocess,sys,uuid
from pathlib import Path
r=Path(sys.argv[1])
if not r.is_absolute() or str(r)!=sys.argv[1] or r.resolve(strict=True)!=r or r.is_symlink():raise SystemExit('WOO_IMPORTACAO_RAIZ_RECUSADA')
c=r/'configuracao/importacao-woocommerce.json';codigo=r/'release/importar-woocommerce-automacoes.mjs';controle=r/'ferramentas/controle-corte-programado.py'
for p in (c,codigo,r/'configuracao/operacao.json',controle):
 if not p.is_file() or p.is_symlink():raise SystemExit('WOO_IMPORTACAO_ARQUIVO_RECUSADO')
if json.loads(c.read_text()).get('preparada') is not True:raise SystemExit('WOO_IMPORTACAO_ACESSO_NAO_CONFERIDO')
pasta=r/'configuracao/corte';lockpath=pasta/'controle.lock'
if not pasta.is_dir() or pasta.is_symlink() or lockpath.is_symlink():raise SystemExit('WOO_IMPORTACAO_LOCK_RECUSADO')
lock=lockpath.open('a');os.fchmod(lock.fileno(),0o600)
fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
spec=importlib.util.spec_from_file_location('controle_importacao_woo',controle)
ctl=importlib.util.module_from_spec(spec);spec.loader.exec_module(ctl)
ctl.conferir_importacoes_woo(r)
marco=ctl.vinculo_importacao_woo(pasta)
cfg=ctl.ler(c)
if cfg.get('baselineRegras')!='/baseline/regras.json':raise SystemExit('WOO_IMPORTACAO_BASELINE_CAMINHO_RECUSADO')
baselinepasta=r/'configuracao/woocommerce-baseline';baselinepasta.mkdir(mode=0o700,exist_ok=True)
if baselinepasta.is_symlink() or not baselinepasta.is_dir():raise SystemExit('WOO_IMPORTACAO_BASELINE_CAMINHO_RECUSADO')
baseline=baselinepasta/'regras.json'
if baseline.exists() and (not baseline.is_file() or baseline.is_symlink() or baseline.stat().st_size>2*1024*1024):raise SystemExit('WOO_IMPORTACAO_BASELINE_ARQUIVO_RECUSADO')
baseline_anterior=ctl.sha(baseline.read_bytes()) if baseline.exists() else None
if marco:
 if baseline_anterior is None:raise SystemExit('WOO_IMPORTACAO_BASELINE_ANTERIOR_EXIGIDO')
 if cfg.get('wooMarcoFinal') is not None and cfg['wooMarcoFinal']!=marco['wooMarcoFinal']:raise SystemExit('WOO_IMPORTACAO_MARCO_CONFIGURADO_DIVERGENTE')
 cfg['wooMarcoFinal']=marco['wooMarcoFinal']
elif cfg.get('wooMarcoFinal') is not None:raise SystemExit('WOO_IMPORTACAO_MARCO_ANTECIPADO_RECUSADO')
def conferir_gate():
 gate=json.loads((r/'configuracao/operacao.json').read_text())
 if gate.get('enviosHabilitados') or gate.get('iaAutomatica') or gate.get('autoridade')=='vps' or gate.get('modo') not in ('homologacao','receber'):
  raise SystemExit('WOO_IMPORTACAO_EXIGE_DESTINO_DESARMADO')
conferir_gate()
class FalhaComando(Exception):
 def __init__(self,codigo,sqlstate=None):self.codigo=codigo;self.sqlstate=sqlstate;super().__init__(codigo)
def executar(args,timeout=45):
 try:p=subprocess.run(args,text=True,capture_output=True,timeout=timeout)
 except (OSError,subprocess.TimeoutExpired):raise FalhaComando('WOO_IMPORTACAO_COMANDO_NAO_CONFIRMADO')
 if p.returncode:
  seguro=re.search(r'(?m)^WOO_IMPORTACAO_BANCO_([A-Z0-9]{5})\s*$',p.stderr)
  raise FalhaComando('WOO_IMPORTACAO_COMANDO_RECUSADO',seguro.group(1) if seguro else None)
 return p.stdout.strip()
for rede in ('grazing-donatella-operacao-v2-privada','grazing-donatella-homologacao-v2-privada'):
 if executar(['docker','network','inspect',rede,'--format','{{.Internal}}'])!='true':raise SystemExit('WOO_IMPORTACAO_REDE_EXTERNA_RECUSADA')
registro=r/'importacoes-woo';registro.mkdir(mode=0o700,exist_ok=True)
if registro.is_symlink():raise SystemExit('WOO_IMPORTACAO_REGISTRO_RECUSADO')
id=str(uuid.uuid4());nome='grazing-donatella-importacao-woo-'+id
recibo=registro/(id+'.json')
def gravar(obj):
 tmp=registro/('.'+str(uuid.uuid4())+'.tmp')
 with tmp.open('x') as f:json.dump(obj,f);f.flush();os.fsync(f.fileno())
 os.replace(tmp,recibo)
 d=os.open(registro,os.O_RDONLY)
 try:os.fsync(d)
 finally:os.close(d)
obj={'versao':1,'id':id,'inicio':datetime.datetime.now(datetime.timezone.utc).isoformat(),'estado':'iniciada','fase':'preparada','container':nome,'enviosExternos':0,'marcoFinal':marco,'configuracaoSha256':ctl.sha(c.read_bytes()),'bundleSha256':ctl.sha(codigo.read_bytes())}
gravar(obj)
try:
 obj['fase']='preparar_configuracao_job';gravar(obj)
 config_job=registro/'configuracoes'/(id+'.json');ctl.gravar(config_job,cfg,True);obj['configuracaoJobSha256']=ctl.sha(config_job.read_bytes());gravar(obj)
 obj['fase']='criar_container';gravar(obj)
 executar(['docker','create','--name',nome,'--label','grazing.finalidade=importacao-woo-preservada-v2','--restart=no','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','256m','--cpus','0.75','--pids-limit','64','--network','grazing-donatella-operacao-v2-privada','-e','DONATELLA_IMPORTACAO_CONFIG=/run/secrets/importacao.json','--mount','type=bind,src='+str(config_job)+',dst=/run/secrets/importacao.json,readonly','--mount','type=bind,src='+str(baselinepasta)+',dst=/baseline'+(',readonly' if marco else ''),'--mount','type=bind,src='+str(r/'release')+',dst=/release,readonly','--workdir','/release','--log-driver','json-file','--log-opt','max-size=1m','--log-opt','max-file=2','grazing-donatella-consulta-v2:20261008-a','/release/importar-woocommerce-automacoes.mjs'])
 obj['fase']='conectar_rede';gravar(obj)
 executar(['docker','network','connect','grazing-donatella-homologacao-v2-privada',nome])
 obj['fase']='executar_importacao';gravar(obj)
 conferir_gate()
 ctl.conferir_importacoes_woo(r,ignorar=id)
 if ctl.vinculo_importacao_woo(pasta)!=marco or ctl.sha(c.read_bytes())!=obj['configuracaoSha256'] or ctl.sha(config_job.read_bytes())!=obj['configuracaoJobSha256'] or ctl.sha(codigo.read_bytes())!=obj['bundleSha256'] or marco and ctl.sha(baseline.read_bytes())!=baseline_anterior:raise ValueError('marco_alterado')
 dados=json.loads(executar(['docker','start','-a',nome],timeout=1800))
 obj['fase']='conferir_resultado';gravar(obj)
 if executar(['docker','inspect',nome,'--format','{{.State.Status}} {{.State.ExitCode}}'])!='exited 0':raise ValueError('falhou')
 ctl.validar_resultado_importacao_woo(dados,completo=True)
 if ctl.vinculo_importacao_woo(pasta)!=marco:raise ValueError('marco_alterado')
 if not baseline.is_file() or baseline.is_symlink() or baseline.stat().st_size>2*1024*1024:raise ValueError('baseline_nao_confirmado')
 baselinehash=ctl.sha(baseline.read_bytes())
 if marco and baselinehash!=baseline_anterior:raise ValueError('baseline_alterado')
 obj['baselineArquivoSha256']=baselinehash
 obj.update(estado='concluida',fase='concluida',fim=datetime.datetime.now(datetime.timezone.utc).isoformat(),resultado=dados);gravar(obj)
 print(json.dumps(obj))
except (Exception,SystemExit) as e:
 codigo=e.codigo if isinstance(e,FalhaComando) else str(e) if re.fullmatch(r'(?:CORTE|WOO)_[A-Z0-9_]{1,80}',str(e)) else 'WOO_IMPORTACAO_RESULTADO_NAO_CONFIRMADO'
 obj.update(estado='falhou_conferir_sem_repetir',fim=datetime.datetime.now(datetime.timezone.utc).isoformat(),erro=codigo,sqlstate=e.sqlstate if isinstance(e,FalhaComando) else None);gravar(obj)
 raise SystemExit('WOO_IMPORTACAO_FALHOU_RECIBO_E_CONTAINER_PRESERVADOS')
PY
