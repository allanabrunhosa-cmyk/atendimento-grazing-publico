"""Controle preparado para o SEGUNDO comando, sem execução/agendamento automático.

Lê somente alvos privados informados pelo operador. Nenhuma chave aparece nos argumentos/saída.
Não congela a origem, não importa histórico, não registra número e não exclui dados.
"""
import base64,copy,datetime,hashlib,hmac,json,importlib.util,os,re,subprocess,sys,types,urllib.error,urllib.parse,urllib.request,uuid
try:import fcntl
except ImportError:fcntl=None # Somente validações puras são ensaiadas no Windows.
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
APP='grazing-donatella-operacao-v2'
CALLBACK='https://atendimento.grazinghub.com.br/api/atendimento/webhook'
CALLBACK_WOO='https://atendimento.grazinghub.com.br/api/atendimento/woocommerce/webhook'
SHA=re.compile(r'[a-f0-9]{64}')

def erro(codigo):raise RuntimeError(codigo)
def instante(s):
 try:
  d=datetime.datetime.fromisoformat(s.replace('Z','+00:00'))
  if d.tzinfo is None:erro('CORTE_INSTANTE_RECUSADO')
  return d
 except (AttributeError,ValueError):erro('CORTE_INSTANTE_RECUSADO')
def agora():return datetime.datetime.now(datetime.timezone.utc)
def sha(b):return hashlib.sha256(b).hexdigest()
def ler(path,limite=128*1024):
 if path.is_symlink() or not path.is_file() or path.stat().st_size>limite:erro('CORTE_ARQUIVO_PRIVADO_RECUSADO')
 if path.stat().st_mode&0o077:erro('CORTE_PERMISSOES_PRIVADAS_RECUSADAS')
 return json.loads(path.read_text())
def sincronizar_pasta(path):
 fd=os.open(path,os.O_RDONLY)
 try:os.fsync(fd)
 finally:os.close(fd)
def gravar(path,value,exclusivo=False):
 path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
 if path.parent.is_symlink() or path.is_symlink():erro('CORTE_CAMINHO_RECUSADO')
 if exclusivo:
  with path.open('x') as f:json.dump(value,f);f.flush();os.fsync(f.fileno())
  path.chmod(0o600)
 else:
  temporario=path.parent/('.'+str(uuid.uuid4())+'.tmp')
  with temporario.open('x') as f:os.fchmod(f.fileno(),0o600);json.dump(value,f);f.flush();os.fsync(f.fileno())
  os.replace(temporario,path)
 sincronizar_pasta(path.parent)
def comando(args,entrada=None):
 try:p=subprocess.run(args,input=entrada,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=45)
 except (OSError,subprocess.TimeoutExpired):erro('CORTE_COMANDO_NAO_CONFIRMADO')
 if p.returncode:erro('CORTE_COMANDO_RECUSADO')
 return p.stdout.decode().strip()
def validar_config(c):
 if c.get('versao')!=1 or c.get('modo') not in ['homologacao','receber','operacao'] or c.get('autoridade') not in ['origem','nenhuma','vps']:erro('CORTE_CONFIGURACAO_RECUSADA')
 for chave,banco in [('databaseUrl','donatella_operacao'),('entradaDatabaseUrl','donatella_entrada')]:
  u=urllib.parse.urlparse(c.get(chave,''))
  if u.scheme!='postgresql' or u.hostname!=DB or u.path!='/'+banco or not u.password or u.query or u.fragment:erro('CORTE_BANCO_RECUSADO')
 m=c.get('meta',{})
 if not all(isinstance(m.get(k),str) and m[k] for k in ['accessToken','appSecret','verifyToken','appId','wabaId','phoneId','graphVersion']):erro('CORTE_META_INCOMPLETA')
 if not all(re.fullmatch(r'\d{5,25}',m[k]) for k in ['appId','wabaId','phoneId']) or not re.fullmatch(r'v\d{1,2}\.0',m['graphVersion']):erro('CORTE_META_ESCOPO_RECUSADO')
def validar_autorizacao(a,c,release,em,para_desarmar=False):
 if a.get('versao')!=1 or a.get('segundoComandoExpresso') is not True or not isinstance(a.get('referenciaMensagem'),str) or not 1<=len(a['referenciaMensagem'])<=200:erro('CORTE_SEGUNDO_COMANDO_AUSENTE')
 if not SHA.fullmatch(str(a.get('runtimeSha256',''))) or a['runtimeSha256']!=release:erro('CORTE_RELEASE_DIVERGENTE')
 if a.get('wabaId')!=c['meta']['wabaId'] or a.get('phoneId')!=c['meta']['phoneId']:erro('CORTE_META_ESCOPO_RECUSADO')
 inicio,fim=instante(a.get('inicio')),instante(a.get('fim'))
 # O freio conserva a vinculação/segundo comando original, mas não depende
 # de a janela ainda estar aberta. Não autoriza callback nem novo emissor.
 if fim<=inicio or fim-inicio>datetime.timedelta(hours=8) or em<inicio or (em>fim and not para_desarmar):erro('CORTE_FORA_DA_JANELA')
def validar_origem(p,a):
 if p.get('tipo')!='manutencao-origem-v2' or p.get('origemSuspensa') is not True or p.get('emissoresSuspensos') is not True or not isinstance(p.get('escritoresConferidos'),list) or not p['escritoresConferidos'] or not SHA.fullmatch(str(p.get('sqlFingerprint',''))):erro('CORTE_ORIGEM_NAO_CONGELADA')
 t0=instante(p.get('t0'));verificada=instante(p.get('verificadaEm'))
 if not instante(a['inicio'])<=t0<=verificada<=instante(a['fim']):erro('CORTE_MARCO_ORIGEM_RECUSADO')
def validar_copia(p,origem):
 if p.get('versao')!=1 or p.get('t0')!=origem['t0'] or not re.fullmatch(r'[a-f0-9-]{36}',str(p.get('idCopiaFinal',''))):erro('CORTE_COPIA_FINAL_NAO_CONFERIDA')
 for k in ['copiaFinalConferida','entradaSeparada','importadorSuspenso','filasHistoricasSegregadas','bancoConsistente','receptorPersistenciaTestada']:
  if p.get(k) is not True:erro('CORTE_PRE_REQUISITO_'+k.upper())

# O formulário de prontidão continua útil para a sequência humana, mas não é
# prova de preservação. O verificador produz evidência ligada aos arquivos reais,
# após GET/decifragem do R2, conferência de conteúdo e do congelamento posterior.
ALVOS_COPIA_FINAL=frozenset(['auth.users','storage.buckets','storage.objects']+[
 'public.'+n for n in ('appointments','automation_executions','automation_logs','automation_rules','automation_scheduled','contact_cooldowns','contacts','conversation_activities','conversation_states','conversations','deal_activities','deals','message_grouping_queue','message_processing_queue','messages','nina_processing_queue','nina_settings','notifications','orders','pipeline_stages','product_catalog_audit','profiles','send_queue','support_cases','system_settings','tag_definitions','team_business_hours','team_functions','team_holidays','team_members','teams','user_roles','webhook_events','whatsapp_templates')])
def natural(v):return type(v) is int and 0<=v<=2**53-1
def conferir_arquivo_prova(pasta,referencia,esperado=None,limite=128*1024):
 if not isinstance(referencia,dict) or not SHA.fullmatch(str(referencia.get('sha256',''))):erro('CORTE_PROVA_REFERENCIA_RECUSADA')
 nome=referencia.get('arquivo')
 if not isinstance(nome,str) or not re.fullmatch(r'[a-zA-Z0-9_.-]+(?:/[a-zA-Z0-9_.-]+)*',nome) or any(p in ['.','..'] for p in nome.split('/')) or (esperado is not None and nome!=esperado):erro('CORTE_PROVA_CAMINHO_RECUSADO')
 p=pasta/nome
 for parente in [p,*p.parents]:
  if parente==pasta.parent:break
  if parente.is_symlink():erro('CORTE_PROVA_CAMINHO_RECUSADO')
 if not p.is_file():erro('CORTE_PROVA_ARQUIVO_AUSENTE')
 v=ler(p,limite)
 if sha(p.read_bytes())!=referencia['sha256']:erro('CORTE_PROVA_HASH_DIVERGENTE')
 return v
def conferir_limitacoes_historicas(reconciliacao,importacao,entidades,id):
 # O recibo bruto nunca é apagado. Só estas provas individuais de preservação
 # podem explicar uma limitação; código/contagem isolados não liberam o corte.
 paginas=reconciliacao.get('paginasConferidas');limites=reconciliacao.get('limitacoesHistoricas')
 if not isinstance(paginas,list) or len(paginas)>5000 or len(paginas)!=sum(e['paginas'] for e in entidades) or not isinstance(limites,list) or len(limites)>500:erro('CORTE_PROVA_RECONCILIACAO_PAGINAS_AUSENTES')
 uuid_ok=lambda v:isinstance(v,str) and re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}',v)
 catalogo={};por_alvo={e['alvo']:[] for e in entidades}
 for p in paginas:
  if not isinstance(p,dict) or set(p)!={'alvo','paginaId','paginaSha256'} or p['alvo'] not in por_alvo or not uuid_ok(p['paginaId']) or not SHA.fullmatch(str(p['paginaSha256'])) or p['paginaId'] in catalogo:erro('CORTE_PROVA_RECONCILIACAO_PAGINA_INVALIDA')
  catalogo[p['paginaId']]=p;por_alvo[p['alvo']].append(p['paginaSha256'])
 for e in entidades:
  hashes=por_alvo[e['alvo']]
  if len(hashes)!=e['paginas'] or sha(''.join(hashes).encode())!=e['hashConteudo']:erro('CORTE_PROVA_RECONCILIACAO_DIGEST_DIVERGENTE')
 def fonte(f,alvo):
  if not isinstance(f,dict) or set(f)!={'paginaId','paginaSha256','registroSha256'} or not SHA.fullmatch(str(f.get('registroSha256',''))):erro('CORTE_PROVA_LIMITACAO_FONTE_INVALIDA')
  p=catalogo.get(f['paginaId'])
  if not p or p['alvo']!=alvo or p['paginaSha256']!=f['paginaSha256']:erro('CORTE_PROVA_LIMITACAO_FORA_SNAPSHOT')
 def destino(d):
  if not isinstance(d,dict) or set(d)!={'importacaoId','hashOrigem','hashDestino'} or d['importacaoId']!='corte-'+id or any(not SHA.fullmatch(str(d.get(k,''))) for k in ['hashOrigem','hashDestino']):erro('CORTE_PROVA_LIMITACAO_DESTINO_INVALIDO')
 por_codigo={};por_entidade={};vistas=set();identidades={};base={'tipo','codigo','entidade','mensagemId','conversaId','fonteMensagem','destinoMensagem','evidenciaSha256'}
 def identidade(alvo,chave,prova):
  k=(alvo,chave)
  if k in identidades and identidades[k]!=prova:erro('CORTE_PROVA_LIMITACAO_IDENTIDADE_DIVERGENTE')
  identidades[k]=prova
 for l in limites:
  if not isinstance(l,dict) or not uuid_ok(l.get('mensagemId')) or not uuid_ok(l.get('conversaId')):erro('CORTE_PROVA_LIMITACAO_IDENTIDADE_INVALIDA')
  evidencia={k:v for k,v in l.items() if k!='evidenciaSha256'}
  if sha(json.dumps(evidencia,ensure_ascii=False,separators=(',',':')).encode())!=l.get('evidenciaSha256'):erro('CORTE_PROVA_LIMITACAO_HASH_DIVERGENTE')
  chave=(l.get('tipo'),l['mensagemId'])
  if chave in vistas:erro('CORTE_PROVA_LIMITACAO_DUPLICADA')
  vistas.add(chave);fonte(l.get('fonteMensagem'),'public.messages');destino(l.get('destinoMensagem'));identidade('public.messages',l['mensagemId'],[l['conversaId'],l['fonteMensagem'],l['destinoMensagem']])
  if l.get('tipo')=='arquivo_vazio_preservado':
   if set(l)!=base|{'objetoId','fonteObjeto','bytes','sha256','anexoIdDestino'} or l.get('codigo')!='ANEXO_VERSAO_NAO_PRESERVADA' or l.get('entidade')!='anexo' or not uuid_ok(l.get('objetoId')) or type(l.get('bytes')) is not int or l['bytes']!=0 or l.get('sha256')!=sha(b'') or l.get('anexoIdDestino') is not None:erro('CORTE_PROVA_LIMITACAO_ARQUIVO_NAO_CONFERIDA')
   fonte(l.get('fonteObjeto'),'storage.objects');identidade('storage.objects',l['objetoId'],l['fonteObjeto'])
  elif l.get('tipo')=='citacao_entre_conversas':
   if set(l)!=base|{'citadaId','conversaCitadaId','fonteCitada','destinoCitada','citadaIdDestino'} or l.get('codigo')!='CITACAO_LEGADA_INDISPONIVEL' or l.get('entidade')!='mensagem' or not uuid_ok(l.get('citadaId')) or not uuid_ok(l.get('conversaCitadaId')) or l['citadaId']==l['mensagemId'] or l['conversaCitadaId']==l['conversaId'] or l.get('citadaIdDestino') is not None:erro('CORTE_PROVA_LIMITACAO_CITACAO_NAO_CONFERIDA')
   fonte(l.get('fonteCitada'),'public.messages');destino(l.get('destinoCitada'));identidade('public.messages',l['citadaId'],[l['conversaCitadaId'],l['fonteCitada'],l['destinoCitada']])
  else:erro('CORTE_PROVA_LIMITACAO_TIPO_RECUSADO')
  por_codigo[l['codigo']]=por_codigo.get(l['codigo'],0)+1;por_entidade[l['entidade']]=por_entidade.get(l['entidade'],0)+1
 for alvo in ['public.messages','storage.objects']:
  if sum(k[0]==alvo for k in identidades)>next(e['registros'] for e in entidades if e['alvo']==alvo):erro('CORTE_PROVA_LIMITACAO_FORA_SNAPSHOT')
 resultado=importacao.get('resultado',{});brutas=resultado.get('lacunas')
 if not isinstance(brutas,dict) or any(not isinstance(k,str) or not natural(v) for k,v in brutas.items()) or reconciliacao.get('lacunasImportacao')!=brutas or {k:v for k,v in brutas.items() if v}!=por_codigo:erro('CORTE_PROVA_RECONCILIACAO_LACUNAS_NAO_COBERTAS')
 totais=resultado.get('entidades');obrigatorias={'contato','conversa','mensagem','etapa','negocio','compromisso'}
 if not isinstance(totais,dict) or not obrigatorias<=set(totais) or set(totais)-obrigatorias-{'anexo'} or type(resultado.get('enviosExternos')) is not int or resultado['enviosExternos']!=0:erro('CORTE_PROVA_RECONCILIACAO_IMPORTACAO_INVALIDA')
 for nome,t in totais.items():
  if not isinstance(t,dict) or any(not natural(t.get(k)) for k in ['observados','verificados','divergentes','lacunas']) or t['observados']!=t['verificados'] or t['divergentes']!=0 or t['lacunas']!=por_entidade.get(nome,0):erro('CORTE_PROVA_RECONCILIACAO_ENTIDADE_DIVERGENTE')
  if t['observados'] and (not SHA.fullmatch(str(t.get('hashDestino',''))) or nome!='anexo' and not SHA.fullmatch(str(t.get('hashConteudo','')))):erro('CORTE_PROVA_RECONCILIACAO_ENTIDADE_DIVERGENTE')
 if any(nome not in totais for nome in por_entidade):erro('CORTE_PROVA_RECONCILIACAO_ENTIDADE_DIVERGENTE')
 if totais['mensagem']['verificados']<sum(k[0]=='public.messages' for k in identidades):erro('CORTE_PROVA_RECONCILIACAO_ENTIDADE_DIVERGENTE')
 a=resultado.get('arquivos',{});anexos=totais.get('anexo',{}).get('observados',0);vazios=por_entidade.get('anexo',0)
 if any(not natural(a.get(k)) for k in ['referencias','conteudosVerificados','bytesVerificados','indisponiveis']) or a['indisponiveis']!=vazios or a['referencias']!=anexos+vazios or (anexos==0 and (a['conteudosVerificados']!=0 or a['bytesVerificados']!=0)) or (anexos>0 and (not 0<a['conteudosVerificados']<=anexos or a['bytesVerificados']<1)):erro('CORTE_PROVA_RECONCILIACAO_ANEXOS_DIVERGENTES')
def conferir_prontidao_final(acao,pasta,cfg,copia,origem,release,autorizacao):
 # Receber e trocar o callback Meta precedem a cópia; o freio permanece livre
 # desta prova. Nenhum desses três passos concede autoridade de responder.
 if acao not in ['habilitar-humano','habilitar-agente']:return
 if not isinstance(cfg.get('voz'),dict) or cfg['voz'].get('sinteseHabilitada') is not False:erro('CORTE_RESPOSTAS_SOMENTE_TEXTO_EXIGIDAS')
 validar_copia(copia,origem)
 id=copia['idCopiaFinal']
 if not re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}',id):erro('CORTE_PROVA_MARCO_DIVERGENTE')
 prova=conferir_arquivo_prova(pasta,copia.get('provaFinal'),'verificacoes/'+id+'-prontidao.json')
 if prova.get('versao')!=1 or prova.get('tipo')!='prontidao-final-verificada-v1' or prova.get('idCopiaFinal')!=id or prova.get('t0')!=origem['t0'] or prova.get('runtimeSha256')!=release:erro('CORTE_PROVA_MARCO_DIVERGENTE')
 nomes={'origemSha256':'origem-congelada.json','configCopiaSha256':'copia-final.json','relatorioSha256':'executor/'+id+'-relatorio.json','importacaoOperacionalSha256':'importacoes-operacao/'+id+'-recibo.json'}
 vinculos=prova.get('vinculos')
 if not isinstance(vinculos,dict):erro('CORTE_PROVA_VINCULOS_AUSENTES')
 documentos={k:conferir_arquivo_prova(pasta,{'arquivo':n,'sha256':vinculos.get(k)},n) for k,n in nomes.items()}
 rel=documentos['relatorioSha256'];importacao=documentos['importacaoOperacionalSha256']
 if documentos['origemSha256']!=origem or documentos['configCopiaSha256'].get('execucao')!=id:erro('CORTE_PROVA_MARCO_DIVERGENTE')
 if rel.get('idCopiaFinal')!=id or rel.get('t0')!=origem['t0'] or rel.get('fase')!='materializada' or rel.get('tabelasConcluidas')!=37 or rel.get('comparacaoConteudoTipado') is not True or rel.get('ackOrigemExecutado') is not False or rel.get('lacunas')!=[]:erro('CORTE_PROVA_COPIA_INCOMPLETA')
 if importacao.get('estado')!='concluida' or importacao.get('fase')!='concluida' or importacao.get('idCopiaFinal')!=id or importacao.get('t0')!=origem['t0'] or importacao.get('exitCode')!=0:erro('CORTE_PROVA_IMPORTACAO_INCOMPLETA')
 t0=instante(origem['t0']);materializada=instante(rel.get('materializadaEm'));verificada=instante(prova.get('verificadaEm'))
 if not t0<=materializada<=verificada<=agora() or not instante(autorizacao['inicio'])<=verificada<=instante(autorizacao['fim']):erro('CORTE_PROVA_INSTANTE_DIVERGENTE')
 dados=prova.get('copia',{});entidades=dados.get('entidades')
 if dados.get('tabelasConcluidas')!=37 or dados.get('comparacaoConteudoTipado') is not True or not isinstance(entidades,list) or len(entidades)!=37 or any(not isinstance(e,dict) for e in entidades) or {e.get('alvo') for e in entidades}!=ALVOS_COPIA_FINAL:erro('CORTE_PROVA_COBERTURA_INCOMPLETA')
 for e in entidades:
  if not natural(e.get('registros')) or not natural(e.get('paginas')) or e['paginas']<1 or not SHA.fullmatch(str(e.get('hashConteudo',''))):erro('CORTE_PROVA_CONTEUDO_RECUSADO')
 if rel.get('registros')!=sum(e['registros'] for e in entidades) or rel.get('documentos')!=sum(e['paginas'] for e in entidades):erro('CORTE_PROVA_CONTAGENS_DIVERGENTES')
 r2=prova.get('r2',{});estado=r2.get('estado',{})
 if not all(natural(r2.get(k)) for k in ['objetosVerificados','bytesVerificados','paginasVerificadas','arquivosVerificados','pendencias','divergencias']) or r2['objetosVerificados']<r2['paginasVerificadas']+1 or r2['bytesVerificados']<1 or r2['pendencias']!=0 or r2['divergencias']!=0 or r2['paginasVerificadas']!=sum(e['paginas'] for e in entidades) or not materializada<=instante(r2.get('verificadoEm'))<=verificada:erro('CORTE_PROVA_R2_INCOMPLETA')
 if estado.get('versao')!=1 or estado.get('prefixo')!='donatella-v2/inicial' or not isinstance(estado.get('chave'),str) or not re.fullmatch(re.escape(id)+r'/estado-[a-f0-9-]{36}\.json\.enc',estado['chave']) or not isinstance(estado.get('contexto'),str) or not estado['contexto'].startswith('final/'+id+'/') or not SHA.fullmatch(str(estado.get('sha256',''))) or not natural(estado.get('bytes')) or estado['bytes']<1:erro('CORTE_PROVA_ESTADO_R2_RECUSADO')
 # Esse elo já pertence ao relatório preservado no checkpoint externo; não
 # depende de esperar o próximo backup para recuperar a lista de páginas T0.
 if rel.get('estadoFinalR2')!=estado:erro('CORTE_PROVA_RECUPERACAO_T0_NAO_VINCULADA')
 posterior=prova.get('origemPosterior',{});o=conferir_arquivo_prova(pasta,posterior,'verificacoes/'+id+'-origem-posterior.json')
 if o.get('tipo')!='manutencao-origem-v2' or o.get('execucao')!=origem.get('execucao') or o.get('t0')!=origem['t0'] or o.get('guardas')!=37 or o.get('verificadaEm')!=posterior.get('verificadaEm') or not materializada<=instante(o.get('verificadaEm'))<=verificada or any(o.get(k) is not True for k in ['origemSuspensa','credenciaisDesarmadas','iaDesarmada','regrasDesarmadas','cronSuspenso']):erro('CORTE_PROVA_ORIGEM_POSTERIOR_NAO_CONFERIDA')
 entrada=prova.get('entrada',{});checkpoint=entrada.get('checkpointR2',{})
 if entrada.get('banco')!='donatella_entrada' or entrada.get('runtimeSha256')!=release or entrada.get('tipoProva')!='ensaio_ficticio_isolado' or entrada.get('proveniencia')!='copia_real_preservada':erro('CORTE_PROVA_ENTRADA_NAO_PROTEGIDA')
 ensaio=conferir_arquivo_prova(pasta,{'arquivo':entrada.get('arquivoProva'),'sha256':entrada.get('sha256Prova')})
 if ensaio.get('versao')!=1 or ensaio.get('tipo')!='ensaio-receptor-isolado-v1' or ensaio.get('runtimeSha256')!=release or ensaio.get('banco')!='donatella_ensaio_operacao' or ensaio.get('bancoEntrada')!='donatella_ensaio_entrada' or not instante(ensaio.get('concluidoEm'))<=verificada:erro('CORTE_PROVA_ENSAIO_ENTRADA_NAO_CONFERIDO')
 resultados=ensaio.get('resultados',{})
 if any(resultados.get(k) is not True for k in ['assinaturaInvalidaRecusada','persistidoAntesAck','repeticaoIdempotente','retomadaAposReinicio']) or type(resultados.get('enviosExternos')) is not int or resultados['enviosExternos']!=0:erro('CORTE_PROVA_ENSAIO_ENTRADA_NAO_CONFERIDO')
 if not re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}',str(checkpoint.get('id',''))) or not SHA.fullmatch(str(checkpoint.get('manifestoSha256',''))) or not t0<=instante(checkpoint.get('criadoEm'))<=instante(checkpoint.get('concluidoEm'))<=verificada:erro('CORTE_PROVA_ENTRADA_R2_NAO_CONFERIDA')
 lacunas=prova.get('lacunas',{})
 if type(lacunas.get('pendentes')) is not int or lacunas['pendentes']!=0:erro('CORTE_PROVA_LACUNAS_PENDENTES')
 reconciliacao=conferir_arquivo_prova(pasta,{'arquivo':lacunas.get('reconciliacaoArquivo'),'sha256':lacunas.get('reconciliacaoSha256')},'verificacoes/'+id+'-reconciliacao.json',1024*1024)
 if reconciliacao.get('versao')!=1 or reconciliacao.get('tipo')!='reconciliacao-final-conteudo-v1' or reconciliacao.get('idCopiaFinal')!=id or reconciliacao.get('t0')!=origem['t0'] or reconciliacao.get('runtimeSha256')!=release or reconciliacao.get('relatorioSha256')!=vinculos['relatorioSha256'] or reconciliacao.get('importacaoOperacionalSha256')!=vinculos['importacaoOperacionalSha256'] or reconciliacao.get('verificadaEm')!=prova['verificadaEm'] or reconciliacao.get('entidades')!=entidades or reconciliacao.get('lacunasSnapshot')!=[] or type(reconciliacao.get('pendentes')) is not int or reconciliacao['pendentes']!=0:erro('CORTE_PROVA_RECONCILIACAO_INCOMPLETA')
 conferir_limitacoes_historicas(reconciliacao,importacao,entidades,id)
 arquivos=reconciliacao.get('arquivos',{})
 if any(not natural(arquivos.get(k)) for k in ['referencias','conteudosVerificados','indisponiveis']) or arquivos['indisponiveis']!=0 or arquivos['referencias']!=arquivos['conteudosVerificados'] or arquivos['referencias']!=r2['arquivosVerificados']:erro('CORTE_PROVA_ARQUIVOS_INCOMPLETOS')
 return {'idCopiaFinal':id,'t0':origem['t0'],'provaFinalSha256':copia['provaFinal']['sha256'],'respostasSomenteTexto':True}

WOO_IMPORTACAO_LABEL='importacao-woo-preservada-v2'
WOO_IMPORTACAO_PREFIXO='grazing-donatella-importacao-woo-'
UUID_WOO=re.compile(r'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}')
def validar_resultado_importacao_woo(d,completo=False):
 if not isinstance(d,dict) or d.get('fase')!='woo_regras_estado_preservados':erro('CORTE_WOO_IMPORTACAO_RESULTADO_RECUSADO')
 for chave,valor in [('regras',3),('eventosCriados',0),('filasImportadas',0),('enviosExternos',0),('fornecedoresChamados',0)]:
  if type(d.get(chave)) is not int or d[chave]!=valor:erro('CORTE_WOO_IMPORTACAO_RESULTADO_RECUSADO')
 if completo or d.get('baselineHash') is not None:
  if type(d.get('regrasCrm')) is not int or d['regrasCrm']!=4 or type(d.get('regrasAtivasOrigem')) is not int or d['regrasAtivasOrigem']!=7 or d.get('acoesPendentes')!=[] or not SHA.fullmatch(str(d.get('baselineHash',''))) or not isinstance(d.get('baselineId'),str) or not UUID_WOO.fullmatch(d['baselineId']):erro('CORTE_WOO_IMPORTACAO_BASELINE_NAO_CONFERIDO')
def inspecao_importacao_woo(c):
 nome=c.get('Name','').removeprefix('/')
 id=nome.removeprefix(WOO_IMPORTACAO_PREFIXO)
 if c.get('Config',{}).get('Labels',{}).get('grazing.finalidade')!=WOO_IMPORTACAO_LABEL or not nome.startswith(WOO_IMPORTACAO_PREFIXO) or not UUID_WOO.fullmatch(id):erro('CORTE_WOO_IMPORTACAO_CONTAINER_RECUSADO')
 s=c.get('State',{})
 if s.get('Running') is not False or s.get('Restarting') is not False or s.get('Paused') is not False or s.get('Dead') is not False or s.get('Status') not in ['created','exited']:erro('CORTE_WOO_IMPORTACAO_ATIVA_OU_INCERTA')
 if type(s.get('ExitCode')) is not int:erro('CORTE_WOO_IMPORTACAO_CONTAINER_RECUSADO')
 return id,{'container':nome,'estado':s['Status'],'exitCode':s['ExitCode']}
def vinculo_importacao_woo(pasta):
 """Preparação sem origem congelada não simula o marco final. Depois de T0,
 exige a cópia realmente materializada e preserva seus hashes, sem ler payloads."""
 op=pasta/'origem-congelada.json'
 if not op.exists():return None
 o=ler(op)
 if o.get('tipo')!='manutencao-origem-v2' or o.get('origemSuspensa') is not True or o.get('emissoresSuspensos') is not True:erro('CORTE_WOO_IMPORTACAO_ORIGEM_NAO_CONFERIDA')
 t0=instante(o.get('t0'));cp=pasta/'copia-final.json';c=ler(cp);id=c.get('execucao')
 if c.get('versao')!=1 or not isinstance(id,str) or not UUID_WOO.fullmatch(id):erro('CORTE_WOO_IMPORTACAO_MARCO_RECUSADO')
 rp=pasta/'executor'/(id+'-relatorio.json');r=ler(rp)
 if r.get('versao')!=1 or r.get('idCopiaFinal')!=id or r.get('t0')!=o['t0'] or r.get('fase')!='materializada' or r.get('tabelasConcluidas')!=37 or r.get('ackOrigemExecutado') is not False or r.get('importacaoOperacionalExecutada') is not False or not isinstance(r.get('lacunas'),list):erro('CORTE_WOO_IMPORTACAO_COPIA_FINAL_NAO_CONFERIDA')
 if not t0<=instante(r.get('materializadaEm'))<=agora():erro('CORTE_WOO_IMPORTACAO_MARCO_RECUSADO')
 if not isinstance(o.get('execucao'),str) or not UUID_WOO.fullmatch(o['execucao']) or type(o.get('quantidadeRegrasAtivasOriginais')) is not int or o['quantidadeRegrasAtivasOriginais']!=7 or not re.fullmatch(r'[a-f0-9]{32}',str(o.get('regrasAtivasOriginaisHash',''))):erro('CORTE_WOO_IMPORTACAO_REGRAS_ORIGINAIS_NAO_CONFERIDAS')
 verificada=instante(o.get('verificadaEm'))
 if not t0<=verificada<=instante(r['materializadaEm']):erro('CORTE_WOO_IMPORTACAO_MARCO_RECUSADO')
 return {'t0':o['t0'],'idCopiaFinal':id,'origemSha256':sha(op.read_bytes()),'configCopiaSha256':sha(cp.read_bytes()),'relatorioSha256':sha(rp.read_bytes()),'wooMarcoFinal':{'t0':o['t0'],'idCopiaFinal':id,'manutencaoExecucao':o['execucao'],'verificadaEm':o['verificadaEm'],'materializadaEm':r['materializadaEm'],'emissoresSuspensos':True,'quantidadeRegrasAtivasOriginais':o['quantidadeRegrasAtivasOriginais'],'regrasAtivasOriginaisHash':o['regrasAtivasOriginaisHash']}}
def conferir_importacoes_woo(raiz=None,ignorar=None,marco=None):
 """Só inspeciona jobs próprios e recibos privados. Nunca apaga, inicia ou para
 contêineres. Uma falha precisa de conciliação separada e ligada à inspeção."""
 raiz=ROOT if raiz is None else raiz
 if ignorar is not None and not UUID_WOO.fullmatch(ignorar):erro('CORTE_WOO_IMPORTACAO_ID_RECUSADO')
 ids=comando(['docker','ps','-a','--filter','label=grazing.finalidade='+WOO_IMPORTACAO_LABEL,'--format','{{.ID}}']).splitlines()
 if len(ids)>1000 or any(not re.fullmatch(r'[a-f0-9]{12,64}',i) for i in ids):erro('CORTE_WOO_IMPORTACAO_CONTAINER_RECUSADO')
 jobs={}
 if ids:
  ins=json.loads(comando(['docker','inspect',*ids]))
  if not isinstance(ins,list) or len(ins)!=len(ids):erro('CORTE_WOO_IMPORTACAO_CONTAINER_RECUSADO')
  for c in ins:
   # O job criado pelo próprio wrapper ainda não iniciou. Os demais sempre
   # passam pela recusa de atividade, inclusive se o processo pai já morreu.
   nome=c.get('Name','').removeprefix('/')
   if ignorar and nome==WOO_IMPORTACAO_PREFIXO+ignorar and c.get('Config',{}).get('Labels',{}).get('grazing.finalidade')==WOO_IMPORTACAO_LABEL and c.get('State',{}).get('Status')=='created':continue
   id,j=inspecao_importacao_woo(c)
   if id in jobs:erro('CORTE_WOO_IMPORTACAO_CONTAINER_RECUSADO')
   jobs[id]=j
 registro=raiz/'importacoes-woo';recibos=[];vistos=set()
 if registro.exists():
  if not registro.is_dir() or registro.is_symlink():erro('CORTE_WOO_IMPORTACAO_REGISTRO_RECUSADO')
  arquivos=list(registro.glob('*.json'))
  if len(arquivos)>1000:erro('CORTE_WOO_IMPORTACAO_REGISTRO_RECUSADO')
  for p in arquivos:
   if p.stem==ignorar:continue
   r=ler(p);id=r.get('id')
   if r.get('versao')!=1 or not isinstance(id,str) or not UUID_WOO.fullmatch(id) or p.stem!=id or r.get('container')!=WOO_IMPORTACAO_PREFIXO+id:erro('CORTE_WOO_IMPORTACAO_RECIBO_RECUSADO')
   vistos.add(id);j=jobs.get(id,{'container':r['container'],'estado':'ausente','exitCode':None})
   if r.get('estado')=='concluida':
    validar_resultado_importacao_woo(r.get('resultado'))
    if j['estado']!='exited' or j['exitCode']!=0:erro('CORTE_WOO_IMPORTACAO_CONCLUSAO_NAO_CONFERIDA')
    if instante(r.get('fim'))<instante(r.get('inicio')):erro('CORTE_WOO_IMPORTACAO_RECIBO_RECUSADO')
    recibos.append(r);continue
   conc=registro/'conciliacoes'/(id+'.json')
   if conc.parent.is_symlink():erro('CORTE_WOO_IMPORTACAO_CONCILIACAO_DIVERGENTE')
   if not conc.exists():erro('CORTE_WOO_IMPORTACAO_INCONCLUSIVA_CONFERIR')
   v=ler(conc)
   if v.get('versao')!=1 or v.get('idImportacao')!=id or v.get('reciboSha256')!=sha(p.read_bytes()) or v.get('inspecao')!=j or v.get('decisao')!='falha_conferida_sem_repeticao' or not isinstance(v.get('responsavel'),str) or not 1<=len(v['responsavel'])<=200 or not isinstance(v.get('motivo'),str) or not 1<=len(v['motivo'])<=500:erro('CORTE_WOO_IMPORTACAO_CONCILIACAO_DIVERGENTE')
   if not instante(r.get('inicio'))<=instante(v.get('conferidaEm'))<=agora():erro('CORTE_WOO_IMPORTACAO_CONCILIACAO_DIVERGENTE')
 if set(jobs)-vistos:erro('CORTE_WOO_IMPORTACAO_SEM_RECIBO_CONFERIR')
 if marco is not None:
  finais=[r for r in recibos if r.get('marcoFinal')==marco]
  if not finais:erro('CORTE_WOO_IMPORTACAO_FINAL_NAO_CONFERIDA')
  baseline=raiz/'configuracao/woocommerce-baseline/regras.json'
  if not baseline.is_file() or baseline.is_symlink() or baseline.parent.is_symlink() or baseline.stat().st_size>2*1024*1024:erro('CORTE_WOO_IMPORTACAO_BASELINE_NAO_CONFERIDO')
  h=sha(baseline.read_bytes())
  for r in finais:
   validar_resultado_importacao_woo(r['resultado'],completo=True)
   if r.get('baselineArquivoSha256')!=h:erro('CORTE_WOO_IMPORTACAO_BASELINE_DIVERGENTE')
 return recibos
def conferir_importacoes_operacionais(raiz,marco=None):
 # Reutiliza a guarda do executor, somente leitura: não cria, retoma ou
 # encerra importadores. Uma conclusão de preparação não comprova T0.
 caminho=Path(__file__).with_name('importar-operacao-final-programada.py')
 if caminho.is_symlink() or not caminho.is_file():erro('CORTE_IMPORTADOR_OPERACIONAL_AUSENTE')
 spec=importlib.util.spec_from_file_location('importacao_operacional_final',caminho)
 if spec is None or spec.loader is None:erro('CORTE_IMPORTADOR_OPERACIONAL_AUSENTE')
 modulo=importlib.util.module_from_spec(spec);spec.loader.exec_module(modulo)
 return modulo.conferir_importacoes_operacionais(types.SimpleNamespace(ler=ler,instante=instante),runner=comando,raiz=raiz,marco=marco)

def guardas_importacao_woo(acao,pasta,origem=None,copia=None):
 if acao not in ['callback-vps','callback-origem','callback-woo-vps','callback-woo-origem','habilitar-humano','habilitar-agente']:return
 marco=None
 if acao in ['callback-woo-vps','habilitar-humano','habilitar-agente']:
  marco=vinculo_importacao_woo(pasta)
  if marco is None or not isinstance(origem,dict) or not isinstance(copia,dict) or marco['t0']!=origem.get('t0') or marco['t0']!=copia.get('t0') or marco['idCopiaFinal']!=copia.get('idCopiaFinal'):erro('CORTE_WOO_IMPORTACAO_MARCO_DIVERGENTE')
 conferir_importacoes_operacionais(pasta.parents[1],marco=marco)
 conferir_importacoes_woo(pasta.parents[1],marco=marco)

def plano_modo(c,acao):
 n=copy.deepcopy(c)
 if acao in ['receber','desarmar']:n.update(modo='receber',autoridade='nenhuma',enviosHabilitados=False,iaAutomatica=False,automacoesHabilitadas=acao=='receber')
 elif acao=='habilitar-humano':
  if c['modo']!='receber' or c['enviosHabilitados'] is True:erro('CORTE_ORDEM_RECUSADA')
  n.update(modo='operacao',autoridade='vps',enviosHabilitados=True,iaAutomatica=False,automacoesHabilitadas=True)
 elif acao=='habilitar-agente':
  if c['modo']!='operacao' or c['autoridade']!='vps' or c['enviosHabilitados'] is not True or not isinstance(c.get('orcamentoIAcentavos'),int) or c['orcamentoIAcentavos']<=0:erro('CORTE_AGENTE_PRE_REQUISITO_AUSENTE')
  n['iaAutomatica']=True
 else:erro('CORTE_ACAO_RECUSADA')
 return n
class SemRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args):erro('CORTE_REDIRECT_RECUSADO')
def http(url,headers,body=None,metodo=None,servico='META'):
 if servico not in ['META','WOO'] or metodo not in [None,'GET','PUT']:erro('CORTE_HTTP_METODO_RECUSADO')
 req=urllib.request.Request(url,headers=headers,data=None if body is None else json.dumps(body).encode(),method=metodo or ('GET' if body is None else 'POST'))
 try:
  with urllib.request.build_opener(SemRedirect()).open(req,timeout=15) as r:
   b=r.read(1024*1024+1)
   if len(b)>1024*1024:erro('CORTE_'+servico+'_RESPOSTA_RECUSADA')
   j=json.loads(b)
   if not isinstance(j,dict):erro('CORTE_'+servico+'_RESPOSTA_RECUSADA')
   return j
 except urllib.error.HTTPError as e:erro('CORTE_'+servico+'_HTTP_'+str(e.code))
 except (OSError,TimeoutError,json.JSONDecodeError,UnicodeDecodeError):erro('CORTE_'+servico+('_RESULTADO_INCERTO' if body is not None else '_LEITURA_FALHOU'))

def url_woo(s):
 if not isinstance(s,str) or not 1<=len(s)<=2048:erro('CORTE_WOO_URL_RECUSADA')
 try:
  u=urllib.parse.urlsplit(s);porta=u.port
 except ValueError:erro('CORTE_WOO_URL_RECUSADA')
 if u.scheme!='https' or not u.hostname or u.username or u.password or u.query or u.fragment or porta not in [None,443] or re.search(r'[\x00-\x20\\]',s):erro('CORTE_WOO_URL_RECUSADA')
 return u

def id_woo(valor):
 # O runtime Node preserva IDs como strings; a API oficial usa inteiros.
 # Canonicalização local não escreve a configuração/snapshot privados.
 if type(valor) is str:
  if not re.fullmatch(r'[1-9][0-9]{0,15}',valor):erro('CORTE_WOO_ESCOPO_RECUSADO')
  valor=int(valor)
 if type(valor) is not int or not 1<=valor<=9007199254740991:erro('CORTE_WOO_ESCOPO_RECUSADO')
 return valor

def ids_woo(valores):
 if not isinstance(valores,list) or len(valores)!=2:erro('CORTE_WOO_ESCOPO_RECUSADO')
 ids=[id_woo(i) for i in valores]
 if len(set(ids))!=2:erro('CORTE_WOO_ESCOPO_RECUSADO')
 return ids

def validar_woo(c,anterior):
 w=c.get('woocommerce',{})
 if not isinstance(w,dict):erro('CORTE_WOO_CONFIGURACAO_RECUSADA')
 u=url_woo(w.get('url'))
 if u.path not in ['','/']:erro('CORTE_WOO_URL_RECUSADA')
 for k in ['consumerKey','consumerSecret','webhookSecret']:
  if not isinstance(w.get(k),str) or not 1<=len(w[k])<=2048 or re.search(r'[\x00-\x1f\x7f]',w[k]):erro('CORTE_WOO_CREDENCIAL_AUSENTE')
 if ':' in w['consumerKey']:erro('CORTE_WOO_CREDENCIAL_RECUSADA')
 ids=ids_woo(w.get('webhookIds'))
 if not isinstance(anterior,dict) or anterior.get('versao')!=1 or ids_woo(anterior.get('webhookIds'))!=ids or not isinstance(anterior.get('webhooks'),list) or len(anterior['webhooks'])!=2:erro('CORTE_WOO_ANTERIOR_RECUSADO')
 instante(anterior.get('conferidaEm'))
 if any(not isinstance(x,dict) for x in anterior['webhooks']):erro('CORTE_WOO_ANTERIOR_RECUSADO')
 hooks=[estado_woo(x,x.get('id')) for x in anterior['webhooks']]
 if {x['id'] for x in hooks}!=set(ids) or {x['topic'] for x in hooks}!={'order.created','order.updated'}:erro('CORTE_WOO_ESCOPO_RECUSADO')
 if any(x['status']!=('active' if x['topic']=='order.created' else 'disabled') or x['delivery_url']==CALLBACK_WOO for x in hooks):erro('CORTE_WOO_ANTERIOR_RECUSADO')
 return hooks

def estado_woo(j,id):
 id=id_woo(id)
 if not isinstance(j,dict) or id_woo(j.get('id'))!=id or j.get('topic') not in ['order.created','order.updated'] or j.get('status') not in ['active','paused','disabled']:erro('CORTE_WOO_RESPOSTA_RECUSADA')
 url_woo(j.get('delivery_url'))
 return {'id':id,**{k:j[k] for k in ['topic','delivery_url','status']}}

def woo(c,id,body=None):
 w=c['woocommerce']
 id=id_woo(id)
 if id not in ids_woo(w['webhookIds']):erro('CORTE_WOO_ESCOPO_RECUSADO')
 if body is not None and (not isinstance(body,dict) or set(body)-{'delivery_url','status'}):erro('CORTE_WOO_ALTERACAO_RECUSADA')
 if body is not None:
  if 'delivery_url' in body:url_woo(body['delivery_url'])
  if 'status' in body and body['status'] not in ['active','paused','disabled']:erro('CORTE_WOO_ALTERACAO_RECUSADA')
 token=base64.b64encode((w['consumerKey']+':'+w['consumerSecret']).encode()).decode()
 j=http(w['url'].rstrip('/')+'/wp-json/wc/v3/webhooks/'+str(id),{'Authorization':'Basic '+token,'Content-Type':'application/json'},body,metodo='GET' if body is None else 'PUT',servico='WOO')
 return estado_woo(j,id)

def destino_woo(h,acao,a):
 n=copy.deepcopy(h)
 if acao=='suspender-woo':n['status']='paused'
 elif acao=='callback-woo-vps':
  n.update(delivery_url=CALLBACK_WOO,status='active' if h['topic']=='order.created' or a.get('autorizaReativarAtualizacoesWoo') is True else h['status'])
 elif acao!='callback-woo-origem':erro('CORTE_ACAO_RECUSADA')
 return n

def validar_sequencia_woo(c,acao,a,release,em,origem=None,copia=None):
 validar_autorizacao(a,c,release,em)
 if acao=='suspender-woo':return
 if acao=='callback-woo-vps':
  validar_origem(origem or {},a);validar_copia(copia or {},origem)
  if c['modo']!='receber' or c['autoridade']!='nenhuma' or c.get('enviosHabilitados') is not False or c.get('iaAutomatica') is not False or c.get('automacoesHabilitadas') is not True:erro('CORTE_WOO_RECEPCAO_SEM_RESPOSTA_EXIGIDA')
 elif acao=='callback-woo-origem':
  if c['autoridade']!='nenhuma' or c.get('enviosHabilitados') is not False or c.get('iaAutomatica') is not False or c.get('automacoesHabilitadas') is not False:erro('CORTE_DESARMAR_VPS_ANTES_DO_RETORNO')
 else:erro('CORTE_ACAO_RECUSADA')

def leitura_woo(c,pasta):
 anterior=ler(pasta/'woo-anterior.json');hooks=validar_woo(c,anterior)
 atuais=[woo(c,x['id']) for x in hooks]
 if any(x['topic']!=h['topic'] for x,h in zip(atuais,hooks)):erro('CORTE_WOO_ESCOPO_DIVERGENTE')
 return hooks,atuais

def conferir_woo(c,pasta):
 hooks,atuais=leitura_woo(c,pasta)
 return {'webhooksConferidos':2,'preflightCoincidente':atuais==hooks,'webhooksSuspensos':all(x['status']=='paused' for x in atuais),'callbacksVps':sum(x['delivery_url']==CALLBACK_WOO for x in atuais),'webhookAlterado':False}

def guardar_estado_woo(pasta,id,acao,atual,pendente=None):
 recibo={'versao':1,'acao':acao,'confirmado':atual,'confirmadaEm':agora().isoformat()}
 gravar(pasta/('woo-recibo-'+str(id)+'-'+str(uuid.uuid4())+'.json'),recibo,True)
 gravar(pasta/('woo-estado-'+str(id)+'.json'),recibo)
 if pendente is not None:
  os.replace(pendente,pasta/('woo-conciliada-'+str(id)+'-'+str(uuid.uuid4())+'.json'))
  sincronizar_pasta(pasta)

def trocar_woo(c,acao,pasta,a,release,origem=None,copia=None):
 validar_sequencia_woo(c,acao,a,release,agora(),origem,copia)
 hooks,atuais=leitura_woo(c,pasta)
 segredo=sha(c['woocommerce']['webhookSecret'].encode());captura=pasta/'woo-capturada.json'
 if not captura.exists():
  if atuais!=hooks:erro('CORTE_WOO_PREFLIGHT_DIVERGENTE')
  gravar(captura,{'versao':1,'webhooks':atuais,'segredoSha256':segredo,'runtimeSha256':release,'capturadaEm':agora().isoformat()},True)
 anterior=ler(captura)
 if anterior.get('versao')!=1 or anterior.get('webhooks')!=hooks or anterior.get('segredoSha256')!=segredo or anterior.get('runtimeSha256')!=release:erro('CORTE_WOO_RETORNO_DIVERGENTE')
 puts=0;conciliadas=0
 for hook in hooks:
  validar_autorizacao(a,c,release,agora())
  id=hook['id'];pendente=pasta/('woo-pendente-'+str(id)+'.json');atual=woo(c,id)
  if atual['topic']!=hook['topic']:erro('CORTE_WOO_ESCOPO_DIVERGENTE')
  if pendente.exists():
   intento=ler(pendente)
   if intento.get('versao')!=1 or intento.get('id')!=id or intento.get('acao') not in ['suspender-woo','callback-woo-vps','callback-woo-origem'] or intento.get('runtimeSha256')!=release or intento.get('segredoSha256')!=segredo or intento.get('destino')!=atual:erro('CORTE_WOO_RESULTADO_INCERTO_CONFERIR_ANTES_DE_REPETIR')
   guardar_estado_woo(pasta,id,intento['acao'],atual,pendente);conciliadas+=1
  estado=pasta/('woo-estado-'+str(id)+'.json')
  esperado=ler(estado)['confirmado'] if estado.exists() else hook
  if atual!=esperado:erro('CORTE_WOO_ESTADO_MUDOU_REQUER_CONFERENCIA')
  destino=destino_woo(hook,acao,a)
  if atual==destino:continue
  # Intenção durável ANTES de PUT. Timeout/erro conserva-a para GET posterior.
  gravar(pendente,{'versao':1,'id':id,'acao':acao,'anterior':atual,'destino':destino,'segredoSha256':segredo,'runtimeSha256':release,'inicio':agora().isoformat()},True)
  validar_autorizacao(a,c,release,agora())
  try:
   resposta=woo(c,id,{k:destino[k] for k in ['delivery_url','status'] if destino[k]!=atual[k]})
   puts+=1
   if resposta!=destino or woo(c,id)!=destino:erro('CORTE_WOO_ALTERACAO_NAO_CONFIRMADA')
   guardar_estado_woo(pasta,id,acao,destino,pendente)
  except Exception as e:
   codigo=str(e);codigo=codigo if re.fullmatch(r'CORTE_[A-Z0-9_]+',codigo) else 'CORTE_WOO_RESULTADO_INCERTO'
   gravar(pasta/('woo-falha-'+str(id)+'-'+str(uuid.uuid4())+'.json'),{'acao':acao,'id':id,'em':agora().isoformat(),'codigo':codigo},True)
   erro(codigo)
 finais=[woo(c,h['id']) for h in hooks]
 if finais!=[destino_woo(h,acao,a) for h in hooks]:erro('CORTE_WOO_ESTADO_FINAL_DIVERGENTE')
 return {'webhooksConfirmados':2,'putsExecutados':puts,'pendenciasConciliadas':conciliadas,'estadoOriginalRestaurado':acao=='callback-woo-origem','atualizacoesAtivadasPorAutorizacao':acao=='callback-woo-vps' and a.get('autorizaReativarAtualizacoesWoo') is True,'segredoAlterado':False}
def graph(c,rota,body=None):
 m=c['meta'];proof=hmac.new(m['appSecret'].encode(),m['accessToken'].encode(),hashlib.sha256).hexdigest()
 url=urllib.parse.urlsplit('https://graph.facebook.com/'+m['graphVersion']+'/'+rota)
 parametros=urllib.parse.parse_qsl(url.query)+[('appsecret_proof',proof)]
 return http(urllib.parse.urlunsplit(url._replace(query=urllib.parse.urlencode(parametros))),{'Authorization':'Bearer '+m['accessToken'],'Content-Type':'application/json'},body)
def inscricao(c):
 j=graph(c,c['meta']['wabaId']+'/subscribed_apps')
 if not isinstance(j.get('data'),list) or j.get('paging',{}).get('next'):erro('CORTE_META_PAGINACAO_REQUER_CONFERENCIA')
 registros=[x for x in j['data'] if x.get('whatsapp_business_api_data',{}).get('id')==c['meta']['appId']]
 if len(registros)!=1:erro('CORTE_META_INSCRICAO_AUSENTE_OU_AMBIGUA')
 return registros[0]
def conferir_escopo(c):
 j=graph(c,c['meta']['wabaId']+'/phone_numbers')
 if j.get('paging',{}).get('next') or [x.get('id') for x in j.get('data',[])]!=[c['meta']['phoneId']]:erro('CORTE_WABA_OUTROS_NUMEROS_REQUER_DECISAO')
 # Override por número tem precedência; não ignorá-lo ao configurar o da WABA.
 m=c['meta'];p=graph(c,m['phoneId']+'?fields=webhook_configuration')
 if p.get('webhook_configuration',{}).get('phone_number'):erro('CORTE_OVERRIDE_NUMERO_REQUER_CONFERENCIA')
 return inscricao(c)
def trocar_callback(c,acao,pasta):
 atual=conferir_escopo(c);ante=pasta/'meta-anterior.json'
 if acao=='callback-vps':
  if c['modo']!='receber' or c['enviosHabilitados'] is True:erro('CORTE_RECEPCAO_SEM_RESPOSTA_EXIGIDA')
  if not ante.exists() and atual.get('override_callback_uri')==CALLBACK:erro('CORTE_RETORNO_ANTERIOR_NAO_PRESERVADO')
  if not ante.exists():gravar(ante,{'versao':1,'inscricao':atual,'capturadaEm':agora().isoformat()},True)
  destino=CALLBACK;body={'override_callback_uri':destino,'verify_token':c['meta']['verifyToken']}
 else:
  anterior=ler(ante)['inscricao'];destino=anterior.get('override_callback_uri')
  if c['autoridade']!='nenhuma' or c['enviosHabilitados'] is True:erro('CORTE_DESARMAR_VPS_ANTES_DO_RETORNO')
  body={'override_callback_uri':destino,'verify_token':c['meta']['verifyToken']} if destino else {}
 pendente=pasta/'meta-pendente.json'
 if atual.get('override_callback_uri')==destino:
  if pendente.exists():os.replace(pendente,pasta/('meta-conciliada-'+str(uuid.uuid4())+'.json'))
  return {'callbackConfirmado':True,'postExecutado':False}
 if pendente.exists():erro('CORTE_META_RESULTADO_INCERTO_CONFERIR_ANTES_DE_REPETIR')
 gravar(pendente,{'acao':acao,'inicio':agora().isoformat()},True)
 r=graph(c,c['meta']['wabaId']+'/subscribed_apps',body)
 if r.get('success') is not True:erro('CORTE_META_ALTERACAO_NAO_CONFIRMADA')
 if inscricao(c).get('override_callback_uri')!=destino:erro('CORTE_META_CALLBACK_DIVERGENTE')
 # Preserva o intento, inclusive após confirmação, sem apagá-lo.
 os.replace(pendente,pasta/('meta-confirmada-'+str(uuid.uuid4())+'.json'))
 return {'callbackConfirmado':True,'postExecutado':True}
def aplicar_modo(c,acao,pasta,a=None):
 n=plano_modo(c,acao)
 if acao=='habilitar-humano' and inscricao(c).get('override_callback_uri')!=CALLBACK:erro('CORTE_CALLBACK_VPS_NAO_CONFIRMADO')
 if acao=='habilitar-humano':
  hooks,atuais=leitura_woo(c,pasta)
  if atuais!=[destino_woo(h,'callback-woo-vps',a or {}) for h in hooks]:erro('CORTE_WOO_CALLBACK_VPS_NAO_CONFIRMADO')
 if acao=='habilitar-agente':
  p=ler(pasta/'agente-pronto.json')
  if p.get('modoPG')!='automatico' or p.get('autoridadeAutomaticaPG') is not True or p.get('tetoCentavosDia')!=c['orcamentoIAcentavos'] or p.get('validacaoExternaHumanaConcluida') is not True:erro('CORTE_AGENTE_PG_NAO_PREPARADO')
 gravar(pasta/('config-anterior-'+str(uuid.uuid4())+'.json'),c,True)
 # Retirar um emissor antes de alterar a autoridade. Não presume que stop
 # cancela um POST já transmitido; intentos em processamento devem ser conciliados.
 comando(['docker','stop','--time','35',APP])
 gravar(ROOT/'configuracao/operacao.json',n)
 override=pasta/'compose-autoridade.json'
 gravar(override,{'services':{'operacao':{'environment':{'ATENDIMENTO_ENVIO_HABILITADO':'true' if n['enviosHabilitados'] else 'false','ATENDIMENTO_AUTORIDADE_ENVIO':n['autoridade'],'ATENDIMENTO_IA_HABILITADA':'true'}}}})
 comando(['docker','compose','-f',str(ROOT/'compose.operacao.yml'),'-f',str(override),'up','-d','--no-deps','--force-recreate','operacao'])
 return {'modo':n['modo'],'autoridade':n['autoridade'],'enviosHabilitados':n['enviosHabilitados'],'iaAutomatica':n['iaAutomatica'],'automacoesHabilitadas':n['automacoesHabilitadas'],'requerConferenciaDeSaude':True}
def executar(acao):
 if os.name!='posix' or fcntl is None or ROOT.is_symlink() or ROOT.resolve()!=ROOT:erro('CORTE_AMBIENTE_RECUSADO')
 if (ROOT/'configuracao').resolve()!=ROOT/'configuracao' or (ROOT/'release').resolve()!=ROOT/'release' or (ROOT/'release/operacao.mjs').is_symlink():erro('CORTE_CAMINHO_RECUSADO')
 cfg=ler(ROOT/'configuracao/operacao.json');validar_config(cfg)
 release=sha((ROOT/'release/operacao.mjs').read_bytes())
 pasta=ROOT/'configuracao/corte';pasta.mkdir(mode=0o700,exist_ok=True)
 if pasta.is_symlink():erro('CORTE_CAMINHO_RECUSADO')
 ins=json.loads(comando(['docker','inspect',DB]))[0]
 if ins['Config'].get('Labels',{}).get('grazing.finalidade')!='operacao-privada':erro('CORTE_BANCO_RECUSADO')
 app=json.loads(comando(['docker','inspect',APP]))[0]
 if app['Config'].get('Labels',{}).get('com.docker.compose.project')!='grazing-donatella-operacao-v2' or app['Config'].get('Labels',{}).get('com.docker.compose.service')!='operacao':erro('CORTE_SERVICO_RECUSADO')
 with (pasta/'controle.lock').open('a') as lock:
  os.fchmod(lock.fileno(),0o600);fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  if acao=='verificar':return {'modo':cfg['modo'],'autoridade':cfg['autoridade'],'enviosHabilitados':cfg.get('enviosHabilitados') is True,'runtimeSha256':release,'viradaExecutada':False}
  if acao=='conferir-meta':return {'inscricaoConfirmada':bool(conferir_escopo(cfg)),'webhookAlterado':False}
  if acao=='conferir-woo':return conferir_woo(cfg,pasta)
  a=ler(pasta/'autorizacao.json');validar_autorizacao(a,cfg,release,agora(),para_desarmar=acao=='desarmar')
  origem=None;copia=None
  if acao!='suspender-woo':origem=ler(pasta/'origem-congelada.json');validar_origem(origem,a)
  if acao in ['habilitar-humano','habilitar-agente','callback-woo-vps']:copia=ler(pasta/'prontidao-final.json');validar_copia(copia,origem)
  prontidao=conferir_prontidao_final(acao,pasta,cfg,copia,origem,release,a)
  guardas_importacao_woo(acao,pasta,origem,copia)
  if acao in ['suspender-woo','callback-woo-vps','callback-woo-origem']:r=trocar_woo(cfg,acao,pasta,a,release,origem,copia)
  elif acao in ['callback-vps','callback-origem']:r=trocar_callback(cfg,acao,pasta)
  elif acao in ['receber','habilitar-humano','habilitar-agente','desarmar']:r=aplicar_modo(cfg,acao,pasta,a)
  else:erro('CORTE_ACAO_RECUSADA')
  if prontidao is not None:r={**r,'prontidaoFinal':prontidao}
  gravar(pasta/('recibo-'+str(uuid.uuid4())+'.json'),{'acao':acao,'em':agora().isoformat(),'runtimeSha256':release,**r},True)
  return r
if __name__=='__main__':
 try:
  os.umask(0o077)
  if len(sys.argv)!=2:erro('CORTE_ARGUMENTO_RECUSADO')
  print(json.dumps(executar(sys.argv[1])))
 except Exception as e:
  s=str(e);print(s if re.fullmatch(r'CORTE_[A-Z0-9_]+',s) else 'CORTE_INTERROMPIDO_CONFERIR_ESTADO',file=sys.stderr);sys.exit(1)
