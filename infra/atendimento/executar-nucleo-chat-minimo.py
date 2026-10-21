"""Executor manual do núcleo mínimo. --verificar é somente leitura.

Não inicia janela, para coletor, muda callback/credenciais ou liga envios. Os
jobs e tentativas ficam preservados; retomada exige inspeção, nunca retry cego.
"""
import importlib.util, json, os, re, subprocess, sys, urllib.parse, uuid
from pathlib import Path
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('chat_minimo', Path(__file__).with_name('controle-corte-minimo-chat.py'))
chat = importlib.util.module_from_spec(spec); spec.loader.exec_module(chat)
ROOT = chat.ROOT
COLETOR = 'grazing-donatella-coletor-v2'
PREPARACAO = 'grazing-donatella-homologacao-v2-banco'
REDES = ['grazing-donatella-coletor-v2-saida', 'grazing-donatella-homologacao-v2-privada', 'grazing-donatella-operacao-v2-privada']
VOLUME = 'grazing-donatella-coletor-v2-estado'

def caminho_privado(nome):
    """Exige alvo privado explícito; nunca usa caminho operacional padrão."""
    valor = os.environ.get(nome)
    if not isinstance(valor, str) or not valor or any(c in valor for c in '\r\n\0,'):
        raise RuntimeError('ATENDIMENTO_CAMINHO_PRIVADO_OBRIGATORIO_' + nome)
    caminho = Path(valor)
    if not caminho.is_absolute() or str(caminho) != valor or '..' in caminho.parts or caminho.parent == caminho:
        raise RuntimeError('ATENDIMENTO_CAMINHO_PRIVADO_INVALIDO_' + nome)
    return caminho

COFRE = caminho_privado('ATENDIMENTO_CONFIG_COLETOR')
INDICE = caminho_privado('ATENDIMENTO_INDICE_MIDIA')
MIDIA = caminho_privado('ATENDIMENTO_MIDIA_ORIGEM')

def erro(c): chat.erro(c)
def run(args): return chat.util.comando(args)
def inspecionar(nome): return json.loads(run(['docker', 'inspect', nome]))[0]
def caminho(p, diretorio=False):
    if any(a.is_symlink() for a in [p, *p.parents]) or not (p.is_dir() if diretorio else p.is_file()):
        erro('EXECUTOR_CAMINHO_RECUSADO')

def validar_config(c, janela):
    pasta = ROOT / 'configuracao/corte-minimo-chat' / janela
    fixos = {'estado': str(pasta), 'autorizacao': str(pasta/'autorizacao.json'),
             'coletorConfiguracao': '/run/secrets/coletor.json', 'operacaoConfiguracao': '/run/secrets/operacao.json',
             'indiceInicial': '/run/secrets/media-index.json', 'midiaInicial': '/legado/midia',
             'midiaDestino': '/midia', 'arquivosIncrementais': '/legado/incrementais/arquivos',
             'runtime': '/release/operacao.mjs', 'manifesto': '/release/release.json'}
    if (c.get('versao') != 1 or c.get('janelaId') != janela or not chat.UUID.fullmatch(str(c.get('execucao','')))
            or c['execucao'] == janela or any(c.get(k) != v for k,v in fixos.items())):
        erro('EXECUTOR_CONFIGURACAO_RECUSADA')
    for campo in ['usuariosRevisados', 'equipesRevisadas']:
        m = c.get('importacao', {}).get(campo)
        if not isinstance(m, dict) or len(m) > 1000 or any(not chat.UUID.fullmatch(str(k)) or not chat.UUID.fullmatch(str(v)) for k,v in m.items()):
            erro('EXECUTOR_IDENTIDADES_RECUSADAS')
    return pasta

def montagens(pasta):
    return [(ROOT/'release', '/release', True, 'bind'), (pasta, str(pasta), False, 'bind'),
            (COFRE, '/run/secrets/coletor.json', True, 'bind'),
            (ROOT/'configuracao/operacao.json', '/run/secrets/operacao.json', True, 'bind'),
            (INDICE, '/run/secrets/media-index.json', True, 'bind'),
            (MIDIA, '/legado/midia', True, 'bind'), (VOLUME, '/legado/incrementais', True, 'volume'),
            (ROOT/'midia', '/midia', False, 'bind')]

def conferir(janela):
    pasta, op, contexto = chat.conferir_contexto(janela)
    c = chat.util.ler(pasta/'config-copia-chat.json')
    validar_config(c, janela)
    if op.get('modo') not in ['homologacao','receber'] or op.get('enviosHabilitados') is not False or op.get('iaAutomatica') is not False:
        erro('EXECUTOR_DESTINO_NAO_DESARMADO')
    release = json.loads((ROOT/'release/release.json').read_text())
    for nome in ['executar-nucleo-chat-minimo.py']:
        for d in [ROOT/'ferramentas', ROOT/'release/ferramentas']:
            p=d/nome; caminho(p)
            if chat.util.sha(p.read_bytes()) != release.get('ferramentasSha256',{}).get(nome): erro('EXECUTOR_HASH_DIVERGENTE')
    bundle=ROOT/'release/corte/chat-minimo.mjs'; caminho(bundle)
    if chat.util.sha(bundle.read_bytes()) != release.get('executaveisSha256',{}).get('corte/chat-minimo.mjs'): erro('EXECUTOR_HASH_DIVERGENTE')
    for p,_,_,tipo in montagens(pasta):
        if tipo == 'bind': caminho(p, p in [ROOT/'release',pasta,MIDIA,ROOT/'midia'])
    coletor=inspecionar(COLETOR); mounts={m['Destination']:m for m in coletor['Mounts']}
    for destino,origem in [('/run/secrets/coletor.json',str(COFRE)),('/run/secrets/media-index.json',str(INDICE)),('/midia',str(MIDIA))]:
        m=mounts.get(destino,{})
        if m.get('Source')!=origem or m.get('RW') is not False: erro('EXECUTOR_FONTE_MONTAGEM_DIVERGENTE')
    if mounts.get('/estado',{}).get('Name')!=VOLUME: erro('EXECUTOR_VOLUME_DIVERGENTE')
    for rede in REDES:
        n=json.loads(run(['docker','network','inspect',rede]))[0]
        if rede!=REDES[0] and n.get('Internal') is not True: erro('EXECUTOR_REDE_NAO_PRIVADA')
    imagem=inspecionar(chat.util.APP)['Image']
    if json.loads(run(['docker','image','inspect',imagem]))[0]['Config'].get('Entrypoint')!=['node']: erro('EXECUTOR_IMAGEM_RECUSADA')
    cfg=chat.util.ler(COFRE)
    u=urllib.parse.urlparse(cfg.get('DATABASE_URL',''))
    if u.hostname!=PREPARACAO or u.path!='/donatella_preparacao' or u.username!='donatella_coletor': erro('EXECUTOR_PAPEL_PREPARACAO_RECUSADO')
    schema='chat_minimo_'+c['execucao'].replace('-','')
    marca='chat-minimo-v1;janela='+janela+';execucao='+c['execucao']
    q="SELECT json_build_object('marca',obj_description(oid,'pg_namespace'),'uso',has_schema_privilege(current_user,oid,'USAGE'),'criar',has_schema_privilege(current_user,oid,'CREATE')) FROM pg_namespace WHERE nspname='"+schema+"'"
    s=run(['docker','exec',PREPARACAO,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','donatella_coletor','-d','donatella_preparacao','-c',q])
    p=json.loads(s) if s else {}
    if p.get('marca')!=marca or p.get('uso') is not True or p.get('criar') is not True: erro('EXECUTOR_SCHEMA_RESTRITO_NAO_PREPARADO')
    return pasta, op, contexto, c, imagem

def args_create(nome,pasta,imagem,acao,c):
    args=['docker','create','--pull=never','--name',nome,'--label','grazing.finalidade=nucleo-chat-minimo',
          '--label','grazing.janela='+c['janelaId'],'--label','grazing.execucao='+c['execucao'],
          '--restart=no','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges',
          '--memory','768m','--cpus','0.75','--pids-limit','128','--stop-timeout','35',
          '--network',REDES[0],'--workdir','/release',
          '-e','ATENDIMENTO_RAIZ_REMOTA_OPERACAO='+str(ROOT),
          '--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=32m',
          '--log-opt','max-size=5m','--log-opt','max-file=2']
    for origem,destino,ro,tipo in montagens(pasta):
        args.extend(['--mount',f'type={tipo},src={origem},dst={destino}'+(',readonly' if ro else '')])
    return args+[imagem,'/release/corte/chat-minimo.mjs',acao,str(pasta/'config-copia-chat.json')]

def conferir_job(d,pasta,imagem,acao,c):
    h=d.get('HostConfig',{}); cfg=d.get('Config',{}); mounts={m['Destination']:m for m in d.get('Mounts',[])}
    raizes=[v for v in cfg.get('Env',[]) if v.startswith('ATENDIMENTO_RAIZ_REMOTA_OPERACAO=')]
    if raizes != ['ATENDIMENTO_RAIZ_REMOTA_OPERACAO='+str(ROOT)]: erro('EXECUTOR_RAIZ_PRIVADA_DIVERGENTE')
    if (d.get('Image')!=imagem or cfg.get('Entrypoint')!=['node'] or cfg.get('Cmd')!=['/release/corte/chat-minimo.mjs',acao,str(pasta/'config-copia-chat.json')]
        or h.get('ReadonlyRootfs') is not True or h.get('Memory')!=768*1024*1024 or h.get('NanoCpus')!=750000000
        or h.get('PidsLimit')!=128 or h.get('RestartPolicy',{}).get('Name')!='no'
        or set(h.get('CapDrop',[]))!={'ALL'} or not any(s.startswith('no-new-privileges') for s in h.get('SecurityOpt',[]))
        or set(d.get('NetworkSettings',{}).get('Networks',{}))!=set(REDES) or len(mounts)!=len(montagens(pasta))):
        erro('EXECUTOR_JOB_DIVERGENTE')
    for origem,destino,ro,tipo in montagens(pasta):
        m=mounts.get(destino,{})
        if m.get('Type')!=tipo or m.get('RW')!= (not ro) or m.get('Name' if tipo=='volume' else 'Source')!=str(origem): erro('EXECUTOR_JOB_MONTAGEM_DIVERGENTE')

def executar(acao,janela):
    if acao not in ['--verificar','--preservar','--importar']: erro('EXECUTOR_ACAO_RECUSADA')
    pasta,op,ctx,c,imagem=conferir(janela)
    if acao=='--verificar': return {'tipo':'executor-nucleo-chat-minimo-verificado-v1',**ctx,'schemaRestritoPreparado':True,'casOperacionalCompartilhado':True,'execucaoIniciada':False}
    auth=chat.util.ler(pasta/'autorizacao.json');chat.validar_autorizacao(auth,op,ctx,chat.util.agora())
    original=chat.util.sha((pasta/'autorizacao.json').read_bytes())
    with (ROOT/'configuracao/corte/controle.lock').open('a') as lock:
        os.fchmod(lock.fileno(),0o600);chat.util.fcntl.flock(lock,chat.util.fcntl.LOCK_EX|chat.util.fcntl.LOCK_NB)
        if (pasta/'executor.lock').exists(): erro('EXECUTOR_LOCK_RESIDUAL_CONFERIR')
        registro=pasta/('executor'+acao[1:]); caminho(pasta,True)
        if registro.exists(): erro('EXECUTOR_TENTATIVA_EXISTENTE_CONFERIR')
        nome='donatella-nucleo-chat-'+str(uuid.uuid4())
        registro.mkdir(mode=0o700)
        chat.util.gravar(registro/'intento.json',{'versao':1,**ctx,'acao':acao,'execucao':c['execucao'],'container':nome,'inicio':chat.util.agora().isoformat()},True)
        run(args_create(nome,pasta,imagem,acao,c))
        for rede in REDES[1:]: run(['docker','network','connect',rede,nome])
        conferir_job(inspecionar(nome),pasta,imagem,acao,c)
        if chat.util.sha((pasta/'autorizacao.json').read_bytes())!=original: erro('EXECUTOR_AUTORIZACAO_ALTERADA')
        chat.validar_autorizacao(auth,op,ctx,chat.util.agora())
        if chat.util.ler(ROOT/'configuracao/operacao.json')!=op: erro('EXECUTOR_CONFIGURACAO_ALTERADA')
        restante=int((chat.instante(auth['fim'])-chat.util.agora()).total_seconds())
        if restante<=0: erro('FORA_DA_JANELA')
        resultado=None
        try:
            with (registro/'processo.log').open('xb') as log:
                os.fchmod(log.fileno(),0o600)
                resultado=subprocess.run(['docker','start','-a',nome],stdout=log,stderr=log,timeout=restante)
                log.flush();os.fsync(log.fileno())
        except subprocess.TimeoutExpired: erro('EXECUTOR_PRAZO_EXCEDIDO_CONFERIR')
        finally:
            status=inspecionar(nome)['State']
            if status.get('Running') is True: run(['docker','stop','--time','35',nome])
        status=inspecionar(nome)['State']
        if resultado is None or resultado.returncode!=0 or status.get('Status')!='exited' or status.get('ExitCode')!=0: erro('EXECUTOR_RESULTADO_NAO_CONFIRMADO')
        prova=pasta/('copia-nucleo.json' if acao=='--preservar' else 'importacao-nucleo.json')
        r=chat.util.ler(prova,8*1024*1024)
        esperado=('copia-nucleo-chat-verificada-v1','preservada') if acao=='--preservar' else ('importacao-nucleo-chat-v1','concluida')
        if any(r.get(k)!=v for k,v in ctx.items()) or r.get('execucao')!=c['execucao'] or (r.get('tipo'),r.get('fase'))!=esperado: erro('EXECUTOR_PROVA_DIVERGENTE')
        fim=chat.util.agora().isoformat()
        chat.util.gravar(registro/'conclusao.json',{'versao':1,**ctx,'acao':acao,'container':nome,'exitCode':0,'fim':fim,'prova':{'arquivo':prova.name,'sha256':chat.util.sha(prova.read_bytes())}},True)
        return {'tipo':'executor-nucleo-chat-minimo-concluido-v1','acao':acao,'fim':fim,'enviosExternos':0,'callbackAlterado':False}

if __name__=='__main__':
    try:
        os.umask(0o077)
        if len(sys.argv)!=3: erro('EXECUTOR_USO_ACAO_JANELA')
        print(json.dumps(executar(sys.argv[1],sys.argv[2])))
    except Exception as e:
        c=str(e);print(c if re.fullmatch(r'(CHAT_MINIMO|CORTE)_[A-Z0-9_]+',c) else 'CHAT_MINIMO_EXECUTOR_INTERROMPIDO_CONFERIR',file=sys.stderr);sys.exit(1)
