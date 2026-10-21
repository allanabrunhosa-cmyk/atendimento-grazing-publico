"""Corte mínimo do Chat humano. Preparar/verificar são somente leitura.

Este controlador não autoriza uma janela, não produz provas de êxito e não chama
WooCommerce, IA, registro de telefone, importação ou revogação de credenciais.
As mutações precisam de uma autorização NOVA e de provas produzidas pelos
executores próprios. Os recibos do corte completo não servem neste protocolo.
"""
import copy
import datetime
import hashlib
import importlib.util
import json
import os
import re
import sys
import time
import uuid
import urllib.parse
import urllib.request
from pathlib import Path

sys.dont_write_bytecode = True
_spec = importlib.util.spec_from_file_location(
    'util_corte_programado', Path(__file__).with_name('controle-corte-programado.py'))
util = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(util)

ROOT = util.ROOT
SHA = util.SHA
UUID = re.compile(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}')
E164 = re.compile(r'55\d{10,11}')
ALVOS_NUCLEO = frozenset(['public.contacts', 'public.conversations', 'public.messages',
    'public.conversation_states', 'public.conversation_activities', 'public.profiles',
    'public.send_queue', 'storage.buckets', 'storage.objects'])
CALLBACK = util.CALLBACK
ESCOPO = 'chat_humano'
ACOES = frozenset(['preparar', 'verificar', 'receber', 'callback-vps',
                  'habilitar-teste-humano', 'liberar-humano', 'desarmar',
                  'callback-origem', 'encerrar'])
FASES = {'receber': ('preparado', 'receber'),
         'callback-vps': ('receber', 'callback_vps'),
         'habilitar-teste-humano': ('callback_vps', 'teste'),
         'liberar-humano': ('teste', 'humano'),
         'callback-origem': ('desarmado', 'retorno_callback')}


def erro(codigo):
    raise RuntimeError('CHAT_MINIMO_' + codigo)


def instante(valor):
    try:
        return util.instante(valor)
    except RuntimeError:
        erro('INSTANTE_INVALIDO')


def hash_json(valor):
    return util.sha(json.dumps(valor, sort_keys=True, separators=(',', ':'),
                               ensure_ascii=False).encode())


def natural(valor):
    return type(valor) is int and 0 <= valor <= 2**53 - 1


def validar_autorizacao(a, cfg, contexto, em, freio=False):
    if (a.get('versao') != 1 or a.get('tipo') != 'autorizacao-corte-minimo-chat-v1'
            or a.get('escopo') != ESCOPO or a.get('estado') != 'aberta'
            or a.get('comandoExpresso') is not True
            or not isinstance(a.get('referenciaMensagem'), str)
            or not 1 <= len(a['referenciaMensagem']) <= 200):
        erro('NOVA_AUTORIZACAO_OBRIGATORIA')
    for chave in ['janelaId', 'runtimeSha256', 'manifestoSha256']:
        if a.get(chave) != contexto[chave]:
            erro('AUTORIZACAO_RELEASE_JANELA_DIVERGENTE')
    if not UUID.fullmatch(str(a.get('janelaId', ''))):
        erro('JANELA_INVALIDA')
    if any(a.get(k) != cfg['meta'][k] for k in ['appId', 'wabaId', 'phoneId']):
        erro('AUTORIZACAO_META_DIVERGENTE')
    numero = a.get('numeroE164', '')
    if not isinstance(numero, str) or not E164.fullmatch(numero) or not numero.endswith('930898899'):
        erro('NUMERO_COMERCIAL_DIVERGENTE')
    inicio, fim = instante(a.get('inicio')), instante(a.get('fim'))
    if (fim <= inicio or fim - inicio > datetime.timedelta(hours=6)
            or em < inicio or (em > fim and not freio)):
        erro('FORA_DA_JANELA')
    equipe = a.get('destinatariosTeste')
    if (not isinstance(equipe, list) or not 1 <= len(equipe) <= 3
            or any(not isinstance(n, str) or not E164.fullmatch(n) or n == numero for n in equipe)
            or len(set(equipe)) != len(equipe)
            or a.get('equipeInterrompeuOrigem') is not True):
        erro('INTERLOCUTORES_EQUIPE_NAO_AUTORIZADOS')


def validar_base(prova, tipo, contexto, depois=None, em=None):
    if prova.get('versao') != 1 or prova.get('tipo') != tipo:
        erro('TIPO_PROVA_RECUSADO')
    for chave in ['janelaId', 'runtimeSha256', 'manifestoSha256']:
        if prova.get(chave) != contexto[chave]:
            erro('PROVA_JANELA_RELEASE_DIVERGENTE')
    concluida = instante(prova.get('concluidoEm'))
    if concluida > (em or util.agora()) or depois and concluida < depois:
        erro('PROVA_INSTANTE_DIVERGENTE')
    return concluida


def referencia(pasta, ref):
    # A leitura comum recusa links, permissões abertas, travessia e hash diverso.
    return util.conferir_arquivo_prova(pasta, ref, limite=8 * 1024 * 1024)


def prova_nome(pasta, nome, tipo, contexto):
    documento = util.ler(pasta / nome, 8 * 1024 * 1024)
    validar_base(documento, tipo, contexto)
    return documento


def validar_ensaio(prova, contexto):
    validar_base(prova, 'ensaio-chat-minimo-isolado-v1', contexto)
    if (prova.get('banco') != 'donatella_ensaio_operacao'
            or prova.get('bancoEntrada') != 'donatella_ensaio_entrada'
            or prova.get('ambiente') != 'ficticio_isolado'
            or type(prova.get('enviosExternos')) is not int or prova['enviosExternos'] != 0):
        erro('ENSAIO_ISOLAMENTO_NAO_COMPROVADO')
    casos = prova.get('casos', {})
    obrigatorios = ['autenticacaoHub', 'permissoesServidor', 'persistenciaAntesAck',
                    'assinaturaInvalidaRecusada', 'entradaIdempotente', 'importacaoIsolada',
                    'filaHumana', 'envioDuplicadoBloqueado', 'retomadaAposReinicio',
                    'statusEnvio', 'audioImagemVideoDocumento', 'destinatarioTesteRestrito',
                    'iaAutomacoesDesligadas']
    if any(not isinstance(casos.get(k), dict) or casos[k].get('estado') != 'passou'
           or not natural(casos[k].get('verificacoes')) or casos[k]['verificacoes'] < 1
           or not isinstance(casos[k].get('evidencias'), list) or not casos[k]['evidencias']
           or casos[k].get('resultadoSha256') != hash_json(casos[k]['evidencias']) for k in obrigatorios):
        erro('ENSAIO_FUNCIONAL_INCOMPLETO')


def validar_artefatos_r2(r2):
    artefatos = r2.get('artefatos')
    if (r2.get('releituraIntegral') is not True or not isinstance(artefatos, list)
            or not 1 <= len(artefatos) <= 10000):
        erro('R2_RELEITURA_NAO_COMPROVADA')
    chaves = set()
    for a in artefatos:
        if (not isinstance(a, dict) or not isinstance(a.get('chave'), str)
                or not a['chave'].startswith('donatella-v2/')
                or a['chave'] in chaves or '..' in a['chave'].split('/')
                or not SHA.fullmatch(str(a.get('sha256', '')))
                or a.get('sha256Lido') != a['sha256']
                or not natural(a.get('bytes')) or a.get('bytesLidos') != a['bytes']):
            erro('R2_CONTEUDO_NAO_COMPROVADO')
        chaves.add(a['chave'])
    if r2.get('pendencias', 0) != 0 or r2.get('divergencias', 0) != 0:
        erro('R2_PENDENTE_OU_DIVERGENTE')


def validar_copia(prova, contexto, pasta, autorizacao):
    concluida = validar_base(prova, 'copia-nucleo-chat-verificada-v1', contexto,
                             instante(autorizacao['inicio']))
    if not UUID.fullmatch(str(prova.get('execucao', ''))) or prova.get('fase') != 'preservada':
        erro('COPIA_NUCLEO_INCOMPLETA')
    t0 = instante(prova.get('t0'))
    if not instante(autorizacao['inicio']) <= t0 <= concluida <= instante(autorizacao['fim']):
        erro('COPIA_NUCLEO_FORA_JANELA')
    fonte = referencia(pasta, prova.get('snapshot'))
    if (fonte.get('tipo') != 'snapshot-nucleo-chat-v1' or fonte.get('execucao') != prova['execucao']
            or fonte.get('t0') != prova['t0'] or fonte.get('isolamento') != 'repeatable read'
            or fonte.get('janelaId') != contexto['janelaId']):
        erro('SNAPSHOT_NUCLEO_NAO_CONSISTENTE')
    entidades = prova.get('entidades')
    if (not isinstance(entidades, list) or not entidades
            or fonte.get('entidades') != entidades
            or any(not isinstance(e, dict) for e in entidades)
            or len(entidades) != len(ALVOS_NUCLEO)
            or {e.get('alvo') for e in entidades} != ALVOS_NUCLEO
            or any(not natural(e.get('registros')) or not SHA.fullmatch(str(e.get('hashConteudo', '')))
                   for e in entidades)):
        erro('NUCLEO_CONTEUDO_INCOMPLETO')
    r2 = referencia(pasta, prova.get('verificacaoR2'))
    validar_base(r2, 'r2-nucleo-chat-verificado-v1', contexto, t0)
    if r2.get('execucao') != prova['execucao'] or r2.get('snapshotSha256') != prova['snapshot']['sha256']:
        erro('R2_SNAPSHOT_DIVERGENTE')
    validar_artefatos_r2(r2)
    limites = prova.get('lacunasHistoricas')
    if not isinstance(limites, list) or any(
            not isinstance(l, dict) or not isinstance(l.get('codigo'), str)
            or not SHA.fullmatch(str(l.get('referenciaSha256', ''))) for l in limites):
        erro('LACUNAS_HISTORICAS_NAO_REGISTRADAS')
    return prova


def validar_importacao(prova, contexto, copia, copia_sha):
    validar_base(prova, 'importacao-nucleo-chat-v1', contexto, instante(copia['t0']))
    if (prova.get('execucao') != copia['execucao'] or prova.get('copiaSha256') != copia_sha
            or prova.get('fase') != 'concluida' or prova.get('entradaIsolada') is not True
            or prova.get('bancoEntrada') != 'donatella_entrada'
            or prova.get('bancoDestino') != 'donatella_operacao'
            or type(prova.get('filasHistoricasReprocessadas')) is not int
            or prova['filasHistoricasReprocessadas'] != 0
            or type(prova.get('enviosExternos')) is not int or prova['enviosExternos'] != 0):
        erro('IMPORTACAO_NUCLEO_NAO_COMPROVADA')
    novos = prova.get('preservacaoNovasEntradas', {})
    if (not SHA.fullmatch(str(novos.get('antesSha256', '')))
            or novos.get('depoisSha256') != novos['antesSha256']
            or not natural(novos.get('registrosAntes'))
            or not natural(novos.get('registrosDepois'))
            or novos['registrosDepois'] < novos['registrosAntes']
            or novos.get('subconjuntoPreservado') is not True
            or novos.get('registrosSubconjuntoDepois') != novos['registrosAntes']
            or prova.get('filaHistoricaExecutavel') is not False):
        erro('NOVAS_ENTRADAS_NAO_PRESERVADAS')
    if (not isinstance(prova.get('resultado'), dict)
            or not isinstance(prova['resultado'].get('entidades'), list)
            or len(prova['resultado']['entidades']) != 4
            or any(not isinstance(e, dict) for e in prova['resultado']['entidades'])
            or {e.get('entidade') for e in prova['resultado']['entidades']} != {'contato', 'conversa', 'mensagem', 'anexo'}
            or not isinstance(prova['resultado'].get('lacunasHistoricas'), list)):
        erro('IMPORTACAO_RESULTADO_AUSENTE')
    for e in prova['resultado']['entidades']:
        if (not natural(e.get('verificados')) or not SHA.fullmatch(str(e.get('hashDestino', '')))
                or e.get('divergenciasNaoExplicadas') != 0):
            erro('IMPORTACAO_CONTEUDO_DIVERGENTE')


def validar_backup_entrada(prova, contexto, depois):
    validar_base(prova, 'backup-entrada-chat-minimo-verificado-v1', contexto, depois)
    if (prova.get('bancoEntrada') != 'donatella_entrada'
            or prova.get('bancoOperacao') != 'donatella_operacao'
            or not SHA.fullmatch(str(prova.get('manifestoCheckpointSha256', '')))
            or not UUID.fullmatch(str(prova.get('checkpointId', '')))
            or instante(prova.get('criadoEm')) < depois):
        erro('BACKUP_NOVAS_ENTRADAS_NAO_COMPROVADO')
    validar_artefatos_r2(prova.get('r2', {}))


def validar_testes_externos(prova, contexto, autorizacao, pasta):
    concluida = validar_base(prova, 'teste-real-chat-minimo-v1', contexto,
                             instante(autorizacao['inicio']))
    if prova.get('destinatario') not in autorizacao['destinatariosTeste']:
        erro('TESTE_FORA_DA_EQUIPE')
    if prova.get('phoneId') != autorizacao['phoneId'] or prova.get('appId') != autorizacao['appId']:
        erro('TESTE_META_DIVERGENTE')
    banco = referencia(pasta, prova.get('recepcaoPersistida'))
    validar_base(banco, 'mensagens-teste-chat-persistidas-v1', contexto, instante(autorizacao['inicio']))
    if (banco.get('tipo') != 'mensagens-teste-chat-persistidas-v1'
            or banco.get('bancoEntrada') != 'donatella_entrada'
            or banco.get('bancoOperacao') != 'donatella_operacao'
            or banco.get('janelaId') != contexto['janelaId']):
        erro('TESTE_RECEPCAO_NAO_PERSISTIDA')
    mensagens = banco.get('mensagens', [])
    if not {'text', 'audio', 'image'} <= {m.get('tipo') for m in mensagens}:
        erro('TESTE_MIDIAS_INCOMPLETO')
    for m in mensagens:
        if (not SHA.fullmatch(str(m.get('wamidSha256', '')))
                or not SHA.fullmatch(str(m.get('conteudoSha256', '')))
                or m.get('destinatario') != prova['destinatario']
                or not UUID.fullmatch(str(m.get('idOperacional', '')))
                or m.get('tipo') in ['audio', 'image'] and m.get('aberturaConfirmadaEquipe') is not True):
            erro('TESTE_RECEPCAO_NAO_COMPROVADA')
    envio = referencia(pasta, prova.get('respostaHumana'))
    validar_base(envio, 'resposta-humana-chat-confirmada-v1', contexto, instante(autorizacao['inicio']))
    if (envio.get('tipo') != 'resposta-humana-chat-confirmada-v1'
            or envio.get('janelaId') != contexto['janelaId']
            or envio.get('destinatario') != prova['destinatario']
            or envio.get('autorTipo') != 'humano'
            or not UUID.fullmatch(str(envio.get('idOperacional', '')))
            or not SHA.fullmatch(str(envio.get('wamidSha256', '')))
            or envio.get('estadoMeta') not in ['delivered', 'read']
            or envio.get('recebimentoConfirmadoEquipe') is not True
            or not SHA.fullmatch(str(envio.get('statusPersistidoSha256', '')))):
        erro('TESTE_RESPOSTA_HUMANA_NAO_CONFIRMADA')
    ack = referencia(pasta, prova.get('confirmacaoEquipe'))
    if (ack.get('versao') != 1 or ack.get('tipo') != 'confirmacao-equipe-chat-minimo-v1'
            or ack.get('janelaId') != contexto['janelaId'] or ack.get('destinatario') != prova['destinatario']
            or any(ack.get(k) is not True for k in ['audioReproduzido','imagemAberta','respostaHumanaRecebida'])
            or not isinstance(ack.get('referenciaMensagem'), str) or not 1 <= len(ack['referenciaMensagem']) <= 500
            or not instante(autorizacao['inicio']) <= instante(ack.get('confirmadaEm')) <= concluida
            or ack.get('mensagemResposta') != envio['idOperacional']
            or ack.get('mensagensRecebidas') != {m['tipo']:m['idOperacional'] for m in mensagens}):
        erro('TESTE_CONFIRMACAO_EQUIPE_AUSENTE_OU_DIVERGENTE')
    if prova.get('origemBloqueioProvaSha256') != util.sha((pasta / 'emissores-bloqueados.json').read_bytes()):
        erro('TESTE_ORIGEM_BLOQUEIO_DIVERGENTE')
    return concluida


def plano_configuracao(cfg, acao, autorizacao):
    novo = copy.deepcopy(cfg)
    novo.update(escopoOperacional=ESCOPO, iaAutomatica=False, automacoesHabilitadas=False)
    novo.setdefault('voz', {})['sinteseHabilitada'] = False
    novo.setdefault('woocommerce', {})['automacoesHabilitadas'] = False
    fase = {'receber': 'receber', 'desarmar': 'receber',
            'habilitar-teste-humano': 'teste', 'liberar-humano': 'humano'}.get(acao)
    if fase is None:
        erro('ACAO_CONFIGURACAO_RECUSADA')
    habilitar = fase in ['teste', 'humano']
    novo.update(modo='operacao' if habilitar else 'receber',
                autoridade='vps' if habilitar else 'nenhuma', enviosHabilitados=habilitar)
    novo['corteMinimoChat'] = {'fase': fase, 'destinatariosTeste': autorizacao['destinatariosTeste']}
    return novo


def validar_saude(saude, cfg):
    esperado = {'aplicacao': 'operacional', 'modo': cfg['modo'], 'autoridade': cfg['autoridade'],
                'enviosReais': cfg['enviosHabilitados'], 'escopoOperacional': ESCOPO,
                'corteMinimoChatFase': cfg['corteMinimoChat']['fase'], 'iaAutomatica': False,
                'sinteseHabilitada': False, 'automacoesHabilitadas': False}
    if any(saude.get(k) != v or isinstance(v, bool) and type(saude.get(k)) is not bool
           for k, v in esperado.items()):
        erro('SAUDE_AUTORIDADE_DIVERGENTE')


def saude_local():
    codigo = ("require('node:http').get({hostname:'127.0.0.1',port:3000,path:'/operacao/saude',"
              "headers:{Host:'atendimento.grazinghub.com.br'}},r=>{let s='';r.on('data',b=>s+=b);"
              "r.on('end',()=>{if(r.statusCode!==200)process.exit(1);console.log(s)})})"
              ".on('error',()=>process.exit(1))")
    return json.loads(util.comando(['docker', 'exec', util.APP, 'node', '-e', codigo]))


def conferir_meta(cfg, autorizacao=None):
    inscricao = util.conferir_escopo(cfg)
    dados = util.graph(cfg, cfg['meta']['phoneId'] + '?fields=id,display_phone_number')
    numero = re.sub(r'\D', '', str(dados.get('display_phone_number', '')))
    if dados.get('id') != cfg['meta']['phoneId'] or not E164.fullmatch(numero) or not numero.endswith('930898899'):
        erro('NUMERO_META_DIVERGENTE')
    if autorizacao and numero != autorizacao['numeroE164']:
        erro('NUMERO_META_AUTORIZACAO_DIVERGENTE')
    return inscricao


def aplicar_configuracao(cfg, novo, pasta):
    util.gravar(pasta / ('config-anterior-' + str(uuid.uuid4()) + '.json'), cfg, True)
    util.comando(['docker', 'stop', '--time', '35', util.APP])
    util.gravar(ROOT / 'configuracao/operacao.json', novo)
    override = pasta / 'compose-chat-minimo.json'
    util.gravar(override, {'services': {'operacao': {'environment': {
        'ATENDIMENTO_ENVIO_HABILITADO': 'true' if novo['enviosHabilitados'] else 'false',
        'ATENDIMENTO_AUTORIDADE_ENVIO': novo['autoridade'], 'ATENDIMENTO_IA_HABILITADA': 'false'}}}})
    util.comando(['docker', 'compose', '-f', str(ROOT / 'compose.operacao.yml'), '-f', str(override),
                  'up', '-d', '--no-deps', '--force-recreate', 'operacao'])
    ultimo = None
    for tentativa in range(6):
        try:
            resultado = saude_local()
            validar_saude(resultado, novo)
            return resultado
        except (RuntimeError, ValueError) as exc:
            ultimo = exc
            if tentativa != 5:
                time.sleep(2)
    # Nunca declara sucesso por ter escrito um arquivo. O freio é operacional;
    # se falhar, o intento continua pendente e a saída informa resultado incerto.
    util.comando(['docker', 'stop', '--time', '35', util.APP])
    raise ultimo


def validar_estado(estado, acao, contexto):
    if estado is None:
        estado = {'fase': 'preparado', **contexto}
    if any(estado.get(k) != contexto[k] for k in contexto):
        erro('ESTADO_JANELA_RELEASE_DIVERGENTE')
    if estado.get('fase') == 'encerrada':
        erro('JANELA_ENCERRADA')
    if acao in FASES and estado.get('fase') != FASES[acao][0]:
        erro('ORDEM_RECUSADA')
    if acao == 'encerrar' and estado.get('fase') not in ['humano', 'retorno_callback', 'desarmado']:
        erro('ENCERRAMENTO_NAO_CONFIRMADO')
    return estado


def conferir_contexto(janela):
    if not UUID.fullmatch(janela):
        erro('JANELA_INVALIDA')
    if (os.name != 'posix' or util.fcntl is None or ROOT.resolve() != ROOT
            or (ROOT / 'configuracao').resolve() != ROOT / 'configuracao'
            or (ROOT / 'release').resolve() != ROOT / 'release'):
        erro('AMBIENTE_PRIVADO_RECUSADO')
    for n in ['operacao.mjs', 'release.json']:
        if (ROOT / 'release' / n).is_symlink() or not (ROOT / 'release' / n).is_file():
            erro('RELEASE_NAO_CONFERIDA')
    contexto = {'janelaId': janela,
                'runtimeSha256': util.sha((ROOT / 'release/operacao.mjs').read_bytes()),
                'manifestoSha256': util.sha((ROOT / 'release/release.json').read_bytes())}
    manifesto = json.loads((ROOT / 'release/release.json').read_text())
    if manifesto.get('runtimeSha256') != contexto['runtimeSha256']:
        erro('RUNTIME_MANIFESTO_DIVERGENTE')
    for nome in ['controle-corte-minimo-chat.py', 'controle-corte-programado.py',
                 'conferir-exclusividade-chat-minimo.py', 'provar-emissores-chat-minimo.py',
                 'provar-retorno-chat-minimo.py']:
        for pasta_ferramenta in [ROOT / 'ferramentas', ROOT / 'release/ferramentas']:
            arquivo = pasta_ferramenta / nome
            if (arquivo.is_symlink() or not arquivo.is_file()
                    or util.sha(arquivo.read_bytes()) != manifesto.get('ferramentasSha256', {}).get(nome)):
                erro('FERRAMENTA_MANIFESTO_DIVERGENTE')
    pasta = ROOT / 'configuracao/corte-minimo-chat' / janela
    if not pasta.is_dir() or pasta.resolve() != pasta:
        erro('PASTA_JANELA_AUSENTE')
    cfg = util.ler(ROOT / 'configuracao/operacao.json')
    util.validar_config(cfg)
    app = json.loads(util.comando(['docker', 'inspect', util.APP]))[0]
    labels = app.get('Config', {}).get('Labels', {})
    if (labels.get('com.docker.compose.project') != 'grazing-donatella-operacao-v2'
            or labels.get('com.docker.compose.service') != 'operacao'):
        erro('SERVICO_DIVERGENTE')
    mounts = {m.get('Destination'): m.get('Source') for m in app.get('Mounts', [])}
    if (mounts.get('/release') != str(ROOT / 'release')
            or mounts.get('/run/secrets/operacao.json') != str(ROOT / 'configuracao/operacao.json')):
        erro('MONTAGEM_RELEASE_CONFIG_DIVERGENTE')
    banco = json.loads(util.comando(['docker', 'inspect', util.DB]))[0]
    if banco.get('Config', {}).get('Labels', {}).get('grazing.finalidade') != 'operacao-privada':
        erro('BANCO_DIVERGENTE')
    return pasta, cfg, contexto


def executar(acao, janela):
    if acao not in ACOES:
        erro('ACAO_RECUSADA')
    pasta, cfg, contexto = conferir_contexto(janela)
    if acao in ['preparar', 'verificar']:
        return {'tipo': 'observacao-preparacao-chat-minimo-v1', **contexto,
                'escopo': ESCOPO, 'modo': cfg['modo'], 'autoridade': cfg['autoridade'],
                'enviosHabilitados': cfg.get('enviosHabilitados') is True,
                'autorizacaoPresente': (pasta / 'autorizacao.json').is_file(),
                'janelaIniciada': False, 'provasGeradas': False,
                'estado': util.ler(pasta / 'estado.json') if (pasta / 'estado.json').exists() else None}
    # Mesmo lock do controlador completo, mas autorização/estado/recibos próprios.
    with (ROOT / 'configuracao/corte/controle.lock').open('a') as lock:
        os.fchmod(lock.fileno(), 0o600)
        util.fcntl.flock(lock, util.fcntl.LOCK_EX | util.fcntl.LOCK_NB)
        if util.ler(ROOT / 'configuracao/operacao.json') != cfg:
            erro('CONFIGURACAO_ALTERADA_DURANTE_CONFERENCIA')
        autorizacao = util.ler(pasta / 'autorizacao.json')
        validar_autorizacao(autorizacao, cfg, contexto, util.agora(), freio=acao in ['desarmar', 'encerrar'])
        estado = validar_estado(util.ler(pasta / 'estado.json') if (pasta / 'estado.json').exists() else None,
                                acao, contexto)
        pendentes = list(pasta.glob('intento-*.json'))
        # Uma tentativa incerta nunca permite avançar/habilitar. O freio e o
        # retorno continuam possíveis, preservando os intentos sem reenvio.
        if pendentes and acao not in ['desarmar', 'callback-origem', 'encerrar']:
            erro('RESULTADO_INCERTO_CONCILIAR_ANTES')
        validar_travas(acao, pasta, cfg, contexto, autorizacao, estado)
        validar_autorizacao(autorizacao, cfg, contexto, util.agora(), freio=acao in ['desarmar', 'encerrar'])
        intento_id = str(uuid.uuid4())
        pendente = pasta / ('intento-' + intento_id + '.json')
        util.gravar(pendente, {'versao': 1, 'tipo': 'intento-chat-minimo-v1', **contexto,
                              'acao': acao, 'inicio': util.agora().isoformat(),
                              'configAntesSha256': hash_json(cfg)}, True)
        if acao in ['receber', 'habilitar-teste-humano', 'liberar-humano', 'desarmar']:
            resultado = aplicar_configuracao(cfg, plano_configuracao(cfg, acao, autorizacao), pasta)
        elif acao in ['callback-vps', 'callback-origem']:
            conferir_meta(cfg, autorizacao)
            # Somente override WABA pertinente. Utilitário não toca o callback do app.
            resultado = trocar_callback(cfg, acao, pasta, contexto)
        else:
            resultado = {'encerramento': True, 'estadoOperacional': estado['fase'],
                         'intentosIncertosPreservados': [p.name for p in pendentes]}
        fase = 'desarmado' if acao == 'desarmar' else 'encerrada' if acao == 'encerrar' else FASES[acao][1]
        fim = util.agora().isoformat()
        recibo = {'versao': 1, 'tipo': 'execucao-chat-minimo-v1', **contexto,
                  'escopo': ESCOPO, 'acao': acao, 'concluidoEm': fim, 'resultado': resultado}
        util.gravar(pasta / ('recibo-' + intento_id + '.json'), recibo, True)
        util.gravar(pasta / 'estado.json', {**contexto, 'fase': fase, 'atualizadaEm': fim,
                                          'reciboSha256': util.sha((pasta / ('recibo-' + intento_id + '.json')).read_bytes())})
        os.replace(pendente, pasta / ('intento-confirmado-' + intento_id + '.registro'))
        util.sincronizar_pasta(pasta)
        return {'acao': acao, 'fase': fase, 'em': fim, 'escopo': ESCOPO}


def validar_travas(acao, pasta, cfg, contexto, autorizacao, estado):
    if acao in ['desarmar', 'encerrar']:
        return
    if acao == 'callback-origem':
        if cfg.get('enviosHabilitados') is not False or cfg.get('autoridade') != 'nenhuma':
            erro('DESARMAR_ANTES_DO_RETORNO')
        validar_saude(saude_local(), cfg)
        retorno = prova_nome(pasta, 'retorno-pronto.json', 'retorno-chat-minimo-verificado-v1', contexto)
        if (retorno.get('enviosVpsEmProcessamento') != 0
                or retorno.get('resultadoIncertoPreservado') is not True
                or retorno.get('credencialOrigemRetornoVerificada') is not True):
            erro('RETORNO_NAO_PREPARADO')
        backup = referencia(pasta, retorno.get('backupNovasEntradas'))
        validar_backup_entrada(backup, contexto, instante(estado['atualizadaEm']))
        return
    ensaio = prova_nome(pasta, 'ensaio-isolado.json', 'ensaio-chat-minimo-isolado-v1', contexto)
    validar_ensaio(ensaio, contexto)
    conferir_meta(cfg, autorizacao)
    if acao == 'receber':
        if cfg.get('enviosHabilitados') is not False or cfg.get('autoridade') not in ['origem', 'nenhuma']:
            erro('RECEBER_EXIGE_ENVIO_DESARMADO')
        return
    validar_saude(saude_local(), cfg)
    conferir_emissores(pasta, cfg, contexto, autorizacao)
    copia = prova_nome(pasta, 'copia-nucleo.json', 'copia-nucleo-chat-verificada-v1', contexto)
    validar_copia(copia, contexto, pasta, autorizacao)
    if acao == 'callback-vps':
        conferir_retorno_callback(cfg, pasta, contexto)
        return
    if conferir_meta(cfg, autorizacao).get('override_callback_uri') != CALLBACK:
        erro('CALLBACK_VPS_NAO_CONFIRMADO')
    importacao = prova_nome(pasta, 'importacao-nucleo.json', 'importacao-nucleo-chat-v1', contexto)
    validar_importacao(importacao, contexto, copia, util.sha((pasta / 'copia-nucleo.json').read_bytes()))
    # A saída original do importador é preservada; a normalização tem sua
    # própria referência e não é confundida com o formato bruto.
    referencia(pasta, importacao.get('resultadoBruto'))
    bruto = referencia(pasta, importacao.get('resultadoVerificado'))
    if bruto != importacao['resultado']:
        erro('IMPORTACAO_RESULTADO_BRUTO_DIVERGENTE')
    depois = instante(estado['atualizadaEm'])
    if acao == 'habilitar-teste-humano':
        depois = max(depois, instante(importacao['concluidoEm']))
    if acao == 'liberar-humano':
        testes = prova_nome(pasta, 'teste-real.json', 'teste-real-chat-minimo-v1', contexto)
        depois = validar_testes_externos(testes, contexto, autorizacao, pasta)
    backup = prova_nome(pasta, 'backup-entrada.json', 'backup-entrada-chat-minimo-verificado-v1', contexto)
    validar_backup_entrada(backup, contexto, depois)


def conferir_emissores(pasta, cfg, contexto, autorizacao):
    prova = prova_nome(pasta, 'emissores-bloqueados.json', 'emissores-chat-bloqueados-v1', contexto)
    validar_base(prova, 'emissores-chat-bloqueados-v1', contexto, instante(autorizacao['inicio']))
    if prova.get('metodo') not in ['credenciais_independentes_revogacao', 'principal_meta_revogacao_integral']:
        erro('METODO_EMISSORES_NAO_IMPLEMENTADO')
    inventario = referencia(pasta, prova.get('inventario'))
    anterior = referencia(pasta, prova.get('conferenciaAnterior'))
    revogacao = referencia(pasta, prova.get('conferenciaRevogacao'))
    retorno = referencia(pasta, prova.get('retornoVerificado'))
    tokens = util.ler(pasta / 'tokens-origem.json')
    if (tokens.get('versao') != 1 or not isinstance(tokens.get('tokens'), list)
            or not 1 <= len(tokens['tokens']) <= 50
            or any(not isinstance(t, str) or not 20 <= len(t) <= 8192 for t in tokens['tokens'])):
        erro('CATALOGO_TOKENS_ORIGEM_RECUSADO')
    fingerprints = {util.sha(t.encode()) for t in tokens['tokens']}
    if len(fingerprints) != len(tokens['tokens']):
        erro('CATALOGO_TOKENS_ORIGEM_DUPLICADO')
    if prova['metodo'] == 'credenciais_independentes_revogacao':
        validar_inventario_emissores(inventario, contexto, fingerprints)
    else:
        caminho_principal = Path(__file__).with_name('provar-emissores-chat-minimo.py')
        spec_p = importlib.util.spec_from_file_location('prova_principal', caminho_principal)
        produtor = importlib.util.module_from_spec(spec_p)
        spec_p.loader.exec_module(produtor)
        detalhe = produtor.validar_principal(inventario, contexto, pasta, anterior, revogacao,
            cfg, autorizacao, referencia, validar_base, util.agora())
        if set(detalhe['fingerprints']) != fingerprints:
            erro('INVENTARIO_TOKENS_INCOMPLETO')
        if (retorno.get('tipo') != 'retorno-emissores-chat-minimo-preparado-v1'
                or retorno.get('referencias', {}).get('observacaoRetirada') != inventario.get('retirada')):
            erro('RETORNO_ANTIGO_OU_RETIRADA_DIVERGENTE')
    for relatorio in [anterior, revogacao]:
        if (relatorio.get('tipo') != 'conferencia-credenciais-chat-minimo-v1'
                or any(relatorio.get(k) != cfg['meta'][k] for k in ['appId', 'wabaId', 'phoneId'])
                or {o.get('fingerprint') for o in relatorio.get('origens', [])} != fingerprints):
            erro('CONFERENCIA_CREDENCIAIS_DIVERGENTE')
    if (not instante(autorizacao['inicio']) <= instante(revogacao.get('verificadaEm')) <= util.agora()
            or revogacao.get('todasOrigemRevogadas') is not True
            or revogacao.get('credenciaisIndependentes') is not True
            or revogacao.get('vpsAptaLeitura') is not True):
        erro('REVOGACAO_ORIGEM_NAO_COMPROVADA')
    validar_retorno_preparado(retorno, contexto, cfg, pasta)
    # Mesmo relatório preservado não substitui os GET atuais. Só leituras:
    # debug_token e telefone com todas as chaves antigas e com a chave da VPS.
    caminho = ROOT / 'ferramentas/conferir-exclusividade-chat-minimo.py'
    if not caminho.exists():
        caminho = Path(__file__).resolve().parents[2] / 'scripts/atendimento/conferir-exclusividade-chat-minimo.py'
    if caminho.is_symlink() or not caminho.is_file():
        erro('CONFERIDOR_CREDENCIAIS_AUSENTE')
    if util.sha(caminho.read_bytes()) != prova.get('conferidorSha256'):
        erro('CONFERIDOR_CREDENCIAIS_DIVERGENTE')
    spec = importlib.util.spec_from_file_location('conferidor_chat_minimo', caminho)
    conferidor = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(conferidor)
    vivo = conferidor.conferir(cfg['meta'], tokens['tokens'], anterior)
    if (vivo.get('todasOrigemRevogadas') is not True or vivo.get('credenciaisIndependentes') is not True
            or vivo.get('vpsAptaLeitura') is not True
            or {o.get('fingerprint') for o in vivo.get('origens', [])} != fingerprints):
        erro('EMISSORES_ORIGEM_AINDA_PODEM_RESPONDER')
    return vivo


def validar_inventario_emissores(prova, contexto, fingerprints):
    validar_base(prova, 'inventario-emissores-chat-minimo-v1', contexto)
    if (prova.get('projetoId') != 'ab6e3d01-5ef9-4acf-aab7-416f9eedb899'
            or not SHA.fullmatch(str(prova.get('manifestoFuncoesPublicadasSha256', '')))
            or not SHA.fullmatch(str(prova.get('consultaConfiguracoesSha256', '')))
            or not SHA.fullmatch(str(prova.get('conferenciaSecretsSha256', '')))):
        erro('INVENTARIO_ORIGEM_NAO_COMPROVADO')
    caminhos = prova.get('caminhosSaida')
    if (not isinstance(caminhos, list)
            or {c.get('nome') for c in caminhos} != {'whatsapp-sender', 'test-whatsapp-message'}
            or len(caminhos) != 2):
        erro('CAMINHOS_SAIDA_DIVERGENTES_REVISAR_CODIGO')
    usados = set()
    for caminho in caminhos:
        if (not SHA.fullmatch(str(caminho.get('codigoPublicadoSha256', '')))
                or not isinstance(caminho.get('credenciaisFingerprints'), list)
                or not caminho['credenciaisFingerprints']
                or any(not SHA.fullmatch(str(f)) for f in caminho['credenciaisFingerprints'])):
            erro('CAMINHOS_SAIDA_NAO_COMPROVADOS')
        usados.update(caminho['credenciaisFingerprints'])
    if usados != fingerprints or set(prova.get('catalogoCredenciaisFingerprints', [])) != fingerprints:
        erro('INVENTARIO_TOKENS_INCOMPLETO')
    if prova.get('enviosIncertosPreservados') is not True or prova.get('reenviarIncertosAutomaticamente') is not False:
        erro('ENVIOS_INCERTOS_NAO_PRESERVADOS')


def validar_retorno_preparado(prova, contexto, cfg, pasta=None):
    if prova.get('tipo') == 'retorno-emissores-chat-minimo-preparado-v1':
        if pasta is None:
            erro('RETORNO_REFERENCIAS_AUSENTES')
        spec_p = importlib.util.spec_from_file_location('retorno_principal',
                    Path(__file__).with_name('provar-emissores-chat-minimo.py'))
        produtor = importlib.util.module_from_spec(spec_p)
        spec_p.loader.exec_module(produtor)
        produtor.validar_retorno(prova, contexto, pasta, cfg, referencia, validar_base, util.agora())
        return
    validar_base(prova, 'retorno-chat-minimo-preparado-v1', contexto)
    if (not SHA.fullmatch(str(prova.get('procedimentoSha256', '')))
            or not SHA.fullmatch(str(prova.get('backupConfiguracaoSha256', '')))
            or not SHA.fullmatch(str(prova.get('ensaioProcedimentoSha256', '')))
            or prova.get('credencialRetornoFingerprint') != util.sha(cfg['meta']['accessToken'].encode())
            or prova.get('restaurarSomenteAposDesarmarVps') is not True
            or prova.get('acessoEscritaConfiguracaoOrigemConferido') is not True
            or prova.get('credencialDisponivelNaOrigem') is not False):
        erro('RETORNO_INDEPENDENTE_NAO_PREPARADO')


def validar_callback_retorno(documento, cfg, contexto, configuracao=None):
    if (documento.get('versao') != 1 or documento.get('tipo') != 'retorno-callback-chat-minimo-v1'
            or documento.get('janelaId') != contexto['janelaId']
            or any(documento.get(k) != cfg['meta'][k] for k in ['appId', 'wabaId', 'phoneId'])):
        erro('CALLBACK_RETORNO_ESCOPO_DIVERGENTE')
    url = urllib.parse.urlsplit(str(documento.get('callback', '')))
    # URLs privadas/IPs/portas customizadas não são destinos da origem conhecida.
    # A igualdade com o GET oficial abaixo é a fonte da URL, não o formulário.
    if (url.scheme != 'https' or not url.hostname or url.port or url.username or url.password
            or url.query or url.fragment or documento.get('callback') == CALLBACK
            or not isinstance(documento.get('verifyToken'), str)
            or not 1 <= len(documento['verifyToken']) <= 256
            or any(ord(c) < 32 for c in documento['verifyToken'])):
        erro('CALLBACK_RETORNO_INVALIDO')
    if configuracao is not None:
        if configuracao.get('phone_number'):
            erro('CALLBACK_NUMERO_OVERRIDE_RECUSADO')
        efetivo = configuracao.get('whatsapp_business_account') or configuracao.get('application')
        if efetivo != documento['callback']:
            erro('CALLBACK_RETORNO_NAO_E_ORIGEM_ATUAL')
    return documento


def conferir_retorno_callback(cfg, pasta, contexto, comparar_atual=True):
    documento = util.ler(pasta / 'meta-retorno.json')
    configuracao = None
    if comparar_atual:
        dados = util.graph(cfg, cfg['meta']['phoneId'] + '?fields=webhook_configuration')
        configuracao = dados.get('webhook_configuration', {})
    validar_callback_retorno(documento, cfg, contexto, configuracao)
    desafio = 'chat-minimo-' + str(uuid.uuid4())
    query = urllib.parse.urlencode({'hub.mode': 'subscribe', 'hub.verify_token': documento['verifyToken'],
                                    'hub.challenge': desafio})
    # Não segue redirects: o token pertence exclusivamente ao callback conferido.
    class SemRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    try:
        with urllib.request.build_opener(SemRedirect).open(documento['callback'] + '?' + query, timeout=15) as resposta:
            if resposta.status != 200 or resposta.read(1024).decode() != desafio:
                erro('CALLBACK_RETORNO_CHALLENGE_RECUSADO')
    except Exception:
        erro('CALLBACK_RETORNO_CHALLENGE_RECUSADO')
    return documento


def trocar_callback(cfg, acao, pasta, contexto):
    atual = conferir_meta(cfg)
    anterior_path = pasta / 'meta-anterior.json'
    if acao == 'callback-vps':
        if cfg['modo'] != 'receber' or cfg.get('enviosHabilitados') is not False:
            erro('CALLBACK_EXIGE_RECEPCAO_SEM_RESPOSTA')
        retorno = conferir_retorno_callback(cfg, pasta, contexto)
        if not anterior_path.exists():
            util.gravar(anterior_path, {'versao': 1, **contexto, 'inscricao': atual,
                'retornoSha256': util.sha((pasta / 'meta-retorno.json').read_bytes()),
                'capturadaEm': util.agora().isoformat()}, True)
        destino, token = CALLBACK, cfg['meta']['verifyToken']
    else:
        if cfg.get('autoridade') != 'nenhuma' or cfg.get('enviosHabilitados') is not False:
            erro('DESARMAR_ANTES_DO_RETORNO')
        anterior = util.ler(anterior_path)
        if (any(anterior.get(k) != contexto[k] for k in contexto)
                or anterior.get('retornoSha256') != util.sha((pasta / 'meta-retorno.json').read_bytes())):
            erro('CALLBACK_RETORNO_ARQUIVO_DIVERGENTE')
        retorno = conferir_retorno_callback(cfg, pasta, contexto, comparar_atual=False)
        destino, token = retorno['callback'], retorno['verifyToken']
    pendente = pasta / 'meta-pendente.json'
    if atual.get('override_callback_uri') == destino:
        if pendente.exists():
            os.replace(pendente, pasta / ('meta-conciliada-' + str(uuid.uuid4()) + '.registro'))
            util.sincronizar_pasta(pasta)
        return {'callbackConfirmado': True, 'postExecutado': False, 'overrideWabaExplicito': True}
    if pendente.exists():
        if acao != 'callback-origem':
            erro('CALLBACK_RESULTADO_INCERTO_CONCILIAR_ANTES')
        # O GET atual já identificou o roteamento, e a VPS foi desarmada. A
        # contingência é uma mudança para a origem, não repetição da tentativa.
        # Nunca renomeia a tentativa anterior como confirmada.
        os.replace(pendente, pasta / ('meta-incerta-no-retorno-' + str(uuid.uuid4()) + '.registro'))
        util.sincronizar_pasta(pasta)
    util.gravar(pendente, {'versao': 1, **contexto, 'acao': acao,
                          'destino': destino, 'inicio': util.agora().isoformat()}, True)
    resultado = util.graph(cfg, cfg['meta']['wabaId'] + '/subscribed_apps',
                           {'override_callback_uri': destino, 'verify_token': token})
    if resultado.get('success') is not True or conferir_meta(cfg).get('override_callback_uri') != destino:
        erro('CALLBACK_RESULTADO_NAO_CONFIRMADO')
    os.replace(pendente, pasta / ('meta-confirmada-' + str(uuid.uuid4()) + '.registro'))
    util.sincronizar_pasta(pasta)
    return {'callbackConfirmado': True, 'postExecutado': True, 'overrideWabaExplicito': True,
            'callbackGlobalAlterado': False}


if __name__ == '__main__':
    try:
        os.umask(0o077)
        if len(sys.argv) != 3:
            erro('USO_ACAO_E_JANELA_UUID')
        print(json.dumps(executar(sys.argv[1], sys.argv[2])))
    except Exception as exc:
        codigo = str(exc)
        print(codigo if re.fullmatch(r'(?:CHAT_MINIMO|CORTE)_[A-Z0-9_]+', codigo)
              else 'CHAT_MINIMO_INTERROMPIDO_CONFERIR_ESTADO', file=sys.stderr)
        sys.exit(1)
