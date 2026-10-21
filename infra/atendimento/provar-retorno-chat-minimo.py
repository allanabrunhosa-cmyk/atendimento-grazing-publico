"""Provas de retorno: somente SELECT/GET e arquivos privados; nunca troca autoridade.

Uso: provar-retorno-chat-minimo.py JANELA [--portas-pos-callback]
Pré-retorno produz retorno-pronto.json. Portas para reposição só são produzidas
depois do callback-origem confirmado pelo controlador e novamente pela Meta.
"""
import importlib.util
import json
import os
from pathlib import Path
import sys
import urllib.parse
import urllib.request
import uuid

sys.dont_write_bytecode = True


def modulo(nome):
    spec = importlib.util.spec_from_file_location(nome, Path(__file__).with_name(nome + '.py'))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    return m


def exigir(v, codigo):
    if not v:
        raise RuntimeError('CHAT_MINIMO_RETORNO_' + codigo)


SQL_FILA = """SELECT jsonb_build_object('conferidaEm',clock_timestamp(),
 'processando',count(*) FILTER(WHERE estado='processando'),
 'incertos',count(*) FILTER(WHERE estado='incerto'),
 'registros',count(*),'ultimaAlteracao',max(atualizada_em),
 'hashConteudo',encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(i) ORDER BY id)::text,'[]'),'UTF8')),'hex'),
 'hashIncertos',encode(sha256(convert_to(coalesce((jsonb_agg(to_jsonb(i) ORDER BY id) FILTER(WHERE estado='incerto'))::text,'[]'),'UTF8')),'hex'))
 FROM atendimento_operacao.intencao i"""


def consultar_fila(chat):
    return json.loads(chat.util.comando(['docker', 'exec', '-i', chat.util.DB,
        'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'donatella_operacao_backup',
        '-d', 'donatella_operacao'],
        ("BEGIN READ ONLY; SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='1s'; "
         + SQL_FILA + '; COMMIT;').encode()))


def validar_fila(chat, fila, backup):
    exigir(all(type(fila.get(k)) is int and fila[k] >= 0 for k in ['processando', 'incertos', 'registros'])
           and fila['processando'] == 0 and fila['incertos'] <= fila['registros'], 'FILA_EM_PROCESSAMENTO')
    exigir(all(chat.SHA.fullmatch(str(fila.get(k, ''))) for k in ['hashConteudo', 'hashIncertos']), 'FILA_SEM_CONTEUDO')
    exigir((fila['registros'] == 0 and fila.get('ultimaAlteracao') is None)
           or (fila['registros'] > 0 and chat.instante(fila.get('ultimaAlteracao')) <= chat.instante(backup['criadoEm'])),
           'CHECKPOINT_ANTERIOR_A_FILA')
    exigir(chat.instante(fila.get('conferidaEm')) >= chat.instante(backup['concluidoEm']), 'FILA_CONFERENCIA_ANTIGA')


def validar_credenciais_retorno(cred):
    # A revogação integral pertence ao forward, não é pré-requisito do retorno.
    exigir(cred.get('vpsAptaLeitura') is True and cred.get('credenciaisIndependentes') is True,
           'CREDENCIAIS_NAO_CONFERIDAS')


def conferir_desarme(chat, pasta, estado, contexto, pos_callback):
    exigir(all(estado.get(k) == v for k, v in contexto.items())
           and estado.get('fase') == ('retorno_callback' if pos_callback else 'desarmado'), 'FASE_DIVERGENTE')
    recibos = []
    for p in pasta.glob('recibo-*.json'):
        d = chat.util.ler(p)
        chat.validar_base(d, 'execucao-chat-minimo-v1', contexto)
        recibos.append((p, d, chat.util.sha(p.read_bytes())))
    atual = [r for r in recibos if r[2] == estado.get('reciboSha256')]
    exigir(len(atual) == 1 and atual[0][1].get('acao') == ('callback-origem' if pos_callback else 'desarmar')
           and atual[0][1]['concluidoEm'] == estado.get('atualizadaEm'), 'RECIBO_ESTADO_DIVERGENTE')
    if pos_callback:
        exigir(atual[0][1].get('resultado', {}).get('callbackConfirmado') is True, 'CALLBACK_SEM_RECIBO')
    desarmes = [r for r in recibos if r[1].get('acao') == 'desarmar'
                and chat.instante(r[1]['concluidoEm']) <= chat.instante(estado['atualizadaEm'])]
    exigir(bool(desarmes), 'DESARME_NAO_OBSERVADO')
    p, d, digest = max(desarmes, key=lambda r: chat.instante(r[1]['concluidoEm']))
    saude = d.get('resultado', {})
    exigir(saude.get('modo') == 'receber' and saude.get('autoridade') == 'nenhuma'
           and saude.get('enviosReais') is False and saude.get('iaAutomatica') is False,
           'RECIBO_DESARME_INSUFICIENTE')
    return d, {'arquivo': p.name, 'sha256': digest}


def conferir_callback(chat, cfg, pasta, contexto, pos_callback, abrir=None):
    documento = chat.util.ler(pasta / 'meta-retorno.json')
    chat.validar_callback_retorno(documento, cfg, contexto)
    anterior = pasta / 'meta-anterior.json'
    if anterior.is_file():
        base = chat.util.ler(anterior)
        exigir(all(base.get(k) == v for k, v in contexto.items())
               and base.get('retornoSha256') == chat.util.sha((pasta / 'meta-retorno.json').read_bytes()),
               'CALLBACK_ANTERIOR_DIVERGENTE')
    # Após callback-origem, exige leitura efetiva na Meta, além do recibo local.
    if pos_callback or not anterior.is_file():
        dados = chat.util.graph(cfg, cfg['meta']['phoneId'] + '?fields=webhook_configuration')
        chat.validar_callback_retorno(documento, cfg, contexto, dados.get('webhook_configuration', {}))
    desafio = 'chat-retorno-' + str(uuid.uuid4())
    query = urllib.parse.urlencode({'hub.mode': 'subscribe', 'hub.verify_token': documento['verifyToken'], 'hub.challenge': desafio})
    class SemRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    abrir = abrir or urllib.request.build_opener(SemRedirect()).open
    with abrir(documento['callback'] + '?' + query, timeout=15) as resposta:
        corpo = resposta.read(1024)
        exigir(resposta.status == 200 and corpo == desafio.encode(), 'CALLBACK_CHALLENGE_RECUSADO')
    return {'conferidaEm': chat.util.agora().isoformat(), 'http': 200,
            'desafioEnviadoSha256': chat.util.sha(desafio.encode()), 'desafioRecebidoSha256': chat.util.sha(corpo),
            'url': documento['callback'], 'urlAnteriorConferida': documento['callback'],
            'metaApontaOrigemConferida': pos_callback}


def executar(janela, pos_callback=False):
    chat = modulo('controle-corte-minimo-chat')
    pasta, cfg, contexto = chat.conferir_contexto(janela)
    with (chat.ROOT / 'configuracao/corte/controle.lock').open('a') as lock:
        os.fchmod(lock.fileno(), 0o600)
        chat.util.fcntl.flock(lock, chat.util.fcntl.LOCK_EX | chat.util.fcntl.LOCK_NB)
        autorizacao = chat.util.ler(pasta / 'autorizacao.json')
        chat.validar_autorizacao(autorizacao, cfg, contexto, chat.util.agora(), freio=True)
        exigir(cfg.get('modo') == 'receber' and cfg.get('autoridade') == 'nenhuma'
               and cfg.get('enviosHabilitados') is False, 'VPS_ARMADA')
        estado = chat.util.ler(pasta / 'estado.json')
        desarme, ref_desarme = conferir_desarme(chat, pasta, estado, contexto, pos_callback)
        saude = chat.saude_local(); chat.validar_saude(saude, cfg)
        backup = chat.prova_nome(pasta, 'backup-entrada.json', 'backup-entrada-chat-minimo-verificado-v1', contexto)
        chat.validar_backup_entrada(backup, contexto, chat.instante(desarme['concluidoEm']))
        fila = consultar_fila(chat); validar_fila(chat, fila, backup)
        plano = chat.util.ler(pasta / 'plano-emissores.json')
        baseline = chat.referencia(pasta, plano.get('conferenciaAnterior'))
        tokens = chat.util.ler(pasta / 'tokens-origem.json')['tokens']
        cred = modulo('conferir-exclusividade-chat-minimo').conferir(cfg['meta'], tokens, baseline)
        # A contingência também precisa funcionar quando a revogação não ocorreu.
        # O forward exige revogação integral; aqui a VPS está desarmada e a chave
        # de retorno deve continuar válida e pertencer ao principal independente.
        validar_credenciais_retorno(cred)
        callback = conferir_callback(chat, cfg, pasta, contexto, pos_callback)
        final = consultar_fila(chat); validar_fila(chat, final, backup)
        exigir(final['hashConteudo'] == fila['hashConteudo'] and final['registros'] == fila['registros'], 'FILA_MUDOU_DURANTE_CONFERENCIA')
        exigir(chat.util.ler(chat.ROOT / 'configuracao/operacao.json') == cfg
               and chat.util.ler(pasta / 'estado.json') == estado, 'ESTADO_MUDOU_DURANTE_CONFERENCIA')
        saude = chat.saude_local(); chat.validar_saude(saude, cfg)
        def salvar(nome, documento):
            arquivo = nome + '-' + str(uuid.uuid4()) + '.json'
            chat.util.gravar(pasta / arquivo, documento, True)
            return {'arquivo': arquivo, 'sha256': chat.util.sha((pasta / arquivo).read_bytes())}
        refs = {'desarme': ref_desarme, 'backupNovasEntradas': salvar('backup-retorno', backup),
                'filaObservada': salvar('fila-retorno', final), 'conferenciaCredenciais': salvar('credenciais-retorno', cred),
                'callbackObservado': salvar('callback-retorno', callback)}
        recibo = {'versao': 1, 'tipo': 'retorno-chat-minimo-verificado-v1', **contexto,
                  'concluidoEm': chat.util.agora().isoformat(), 'enviosVpsEmProcessamento': final['processando'],
                  'resultadoIncertoPreservado': True, 'incertos': final['incertos'],
                  'credencialOrigemRetornoVerificada': cred['vpsAptaLeitura'] and cred['credenciaisIndependentes'],
                  'backupNovasEntradas': refs['backupNovasEntradas'], 'referencias': refs,
                  'somenteLeitura': True, 'envios': 0, 'mutacoesMeta': 0}
        if pos_callback:
            portas = {'desarme': {'concluidoEm': desarme['concluidoEm'], 'saude': saude, 'enviosEmProcessamento': final['processando']},
                      'backup': backup, 'callback': callback, 'credenciais': cred,
                      'referencias': refs, 'somenteLeitura': True, 'envios': 0, 'mutacoesMeta': 0}
            salvar('portas-retorno', portas); chat.util.gravar(pasta / 'portas-retorno.json', portas)
            # Caminho fixo consumível pelo CLI; a versão com UUID permanece preservada.
            chat.util.gravar(pasta / 'credenciais-retorno.json', cred)
        else:
            salvar('retorno-pronto', recibo); chat.util.gravar(pasta / 'retorno-pronto.json', recibo)
        return {'provaGerada': True, 'portasPosCallback': pos_callback, 'envios': 0, 'mutacoesMeta': 0, 'origemAlterada': False}


if __name__ == '__main__':
    try:
        os.umask(0o077)
        exigir(len(sys.argv) in (2, 3) and (len(sys.argv) == 2 or sys.argv[2] == '--portas-pos-callback'), 'USO_RECUSADO')
        print(json.dumps(executar(sys.argv[1], len(sys.argv) == 3)))
    except Exception:
        print('CHAT_MINIMO_RETORNO_NAO_COMPROVADO', file=sys.stderr)
        sys.exit(1)
