"""Consulta provas já gravadas dos testes autorizados; nunca envia ou modifica DB.

Uso: python3 provar-teste-real-chat-minimo.py UUID_DA_NOVA_JANELA
Lê confirmacao-equipe.json privado, cuja referência identifica a confirmação real
do interlocutor. Não substitui a interação humana por inferência de logs.
"""
import importlib.util
import json
import os
import re
import sys
import uuid
from pathlib import Path

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('chat', Path(__file__).with_name('controle-corte-minimo-chat.py'))
chat = importlib.util.module_from_spec(spec)
spec.loader.exec_module(chat)


def validar_confirmacao(ack, autorizacao, contexto):
    if (ack.get('versao') != 1 or ack.get('tipo') != 'confirmacao-equipe-chat-minimo-v1'
            or ack.get('janelaId') != contexto['janelaId']
            or ack.get('destinatario') not in autorizacao['destinatariosTeste']
            or ack.get('audioReproduzido') is not True or ack.get('imagemAberta') is not True
            or ack.get('respostaHumanaRecebida') is not True
            or not isinstance(ack.get('referenciaMensagem'), str)
            or not 1 <= len(ack['referenciaMensagem']) <= 500
            or not chat.instante(autorizacao['inicio']) <= chat.instante(ack.get('confirmadaEm')) <= chat.util.agora()):
        chat.erro('CONFIRMACAO_EQUIPE_REAL_AUSENTE')
    ids = ack.get('mensagensRecebidas')
    if (not isinstance(ids, dict) or set(ids) != {'text', 'audio', 'image'}
            or any(not chat.UUID.fullmatch(str(v)) for v in ids.values())
            or len(set(ids.values())) != 3
            or not chat.UUID.fullmatch(str(ack.get('mensagemResposta', '')))):
        chat.erro('TESTE_IDS_RECUSADOS')


def consulta(banco, sql):
    if banco not in ['donatella_operacao', 'donatella_entrada']:
        chat.erro('PROVA_BANCO_RECUSADO')
    # Usuário de backup já existente: sem credencial em argv e transação readonly.
    resultado = chat.util.comando(['docker', 'exec', '-i', chat.util.DB, 'psql', '-X', '-qAt',
        '-v', 'ON_ERROR_STOP=1', '-U', 'donatella_operacao_backup', '-d', banco],
        ("BEGIN READ ONLY; SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='1s'; " + sql + '; COMMIT;').encode())
    return json.loads(resultado)


def conferir_midia(hash_arquivo, tamanho):
    if not chat.SHA.fullmatch(str(hash_arquivo)) or not chat.natural(tamanho) or not 1 <= tamanho <= 20971520:
        chat.erro('TESTE_MIDIA_METADATA_RECUSADA')
    codigo = ("const fs=require('node:fs');const p='/midia/" + hash_arquivo + "';"
              "const s=fs.lstatSync(p);if(!s.isFile()||s.isSymbolicLink()||s.size>20971520)process.exit(1);"
              "const b=fs.readFileSync(p);console.log(JSON.stringify({bytes:b.length,sha256:"
              "require('node:crypto').createHash('sha256').update(b).digest('hex')}))")
    lido = json.loads(chat.util.comando(['docker', 'exec', chat.util.APP, 'node', '-e', codigo]))
    if lido != {'bytes': tamanho, 'sha256': hash_arquivo}:
        chat.erro('TESTE_MIDIA_BYTES_DIVERGENTES')
    return lido


def obter_observacoes(ack, autorizacao, cfg):
    ids = list(ack['mensagensRecebidas'].values()) + [ack['mensagemResposta']]
    lista = ','.join("'" + v + "'::uuid" for v in ids)
    inicio = chat.instante(autorizacao['inicio']).isoformat()
    sql = """SELECT coalesce(json_agg(x),'[]') FROM (
      SELECT m.id,m.tipo,m.autor,m.autor_id,m.importada,c.ficticia,m.criada_em,
      regexp_replace(ct.telefone,'[^0-9]','','g') destinatario,
      encode(sha256(convert_to(m.wamid,'UTF8')),'hex') wamid_sha,
      encode(sha256(convert_to(to_jsonb(m)::text,'UTF8')),'hex') conteudo_sha,
      a.hash anexo_hash,a.tamanho anexo_bytes,a.importado anexo_importado,
      (SELECT json_agg(json_build_object('estado',s.estado,'em',s.em,'hash',
        encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex')))
       FROM atendimento_operacao.status_recebido s WHERE s.wamid=m.wamid AND s.estado IN ('delivered','read')) estados
      FROM atendimento_operacao.mensagem m
      JOIN atendimento_operacao.conversa c ON c.id=m.conversa_id
      JOIN atendimento_operacao.contato ct ON ct.id=c.contato_id
      LEFT JOIN atendimento_operacao.anexo a ON a.id=m.anexo_id
      WHERE m.id IN (LISTA) AND m.criada_em >= 'INICIO'::timestamptz ORDER BY m.id
    ) x""".replace('LISTA', lista).replace('INICIO', inicio)
    mensagens = consulta('donatella_operacao', sql)
    if len(mensagens) != 4:
        chat.erro('TESTE_MENSAGENS_REAIS_AUSENTES')
    hashes = []
    for m in mensagens:
        if (m.get('destinatario') != ack['destinatario'] or m.get('importada') is not False
                or m.get('ficticia') is not False or not chat.SHA.fullmatch(str(m.get('wamid_sha', '')))
                or not chat.SHA.fullmatch(str(m.get('conteudo_sha', '')))):
            chat.erro('TESTE_MENSAGENS_FORA_ESCOPO')
        hashes.append(m['wamid_sha'])
    lista_hashes = ','.join("'" + h + "'" for h in hashes)
    sql_entrada = """SELECT coalesce(json_agg(x),'[]') FROM (
      SELECT e.tipo,e.conteudo#>>'{item,type}' tipo_mensagem,
      e.conteudo#>>'{item,status}' estado_meta,e.conteudo#>>'{item,from}' remetente,
      encode(sha256(convert_to(e.conteudo#>>'{item,id}','UTF8')),'hex') wamid_sha,
      encode(sha256(r.corpo),'hex') recibo_sha,r.hash,r.recebido_em,e.estado
      FROM atendimento_entrada.evento e JOIN atendimento_entrada.recibo r ON r.id=e.recibo_id
      WHERE encode(sha256(convert_to(e.conteudo#>>'{item,id}','UTF8')),'hex') IN (HASHES)
      AND e.waba='WABA' AND e.numero='PHONE' AND r.recebido_em >= 'INICIO'::timestamptz
    ) x""".replace('HASHES', lista_hashes).replace('INICIO', inicio).replace('WABA', cfg['meta']['wabaId']).replace('PHONE', cfg['meta']['phoneId'])
    return mensagens, consulta('donatella_entrada', sql_entrada)


def comprovar(ack, mensagens, eventos, verificar_midia=conferir_midia):
    por_id = {m['id']: m for m in mensagens}
    recebidas = []
    for tipo, ident in ack['mensagensRecebidas'].items():
        m = por_id.get(ident, {})
        originais = [e for e in eventos if e.get('wamid_sha') == m.get('wamid_sha') and e.get('tipo') == 'mensagem'
                     and e.get('tipo_mensagem') == tipo and e.get('remetente') == ack['destinatario']
                     and e.get('estado') == 'concluido' and e.get('recibo_sha') == e.get('hash')]
        if m.get('autor') != 'cliente' or m.get('tipo') != tipo or len(originais) != 1:
            chat.erro('TESTE_ENTRADA_DURAVEL_NAO_COMPROVADA')
        anexo = None
        if tipo in ['audio', 'image']:
            if m.get('anexo_importado') is not False:
                chat.erro('TESTE_MIDIA_NOVA_AUSENTE')
            anexo = verificar_midia(m.get('anexo_hash'), m.get('anexo_bytes'))
        recebidas.append({'idOperacional': ident, 'tipo': tipo, 'destinatario': ack['destinatario'],
            'wamidSha256': m['wamid_sha'], 'conteudoSha256': m['conteudo_sha'],
            'reciboSha256': originais[0]['recibo_sha'], 'anexoConferido': anexo,
            'aberturaConfirmadaEquipe': True if anexo else None})
    resposta = por_id.get(ack['mensagemResposta'], {})
    estados = resposta.get('estados') or []
    estados = [s for s in estados if s.get('estado') in ['delivered', 'read'] and chat.SHA.fullmatch(str(s.get('hash', '')))]
    if resposta.get('autor') != 'humano' or not resposta.get('autor_id') or not estados:
        chat.erro('TESTE_RESPOSTA_HUMANA_NAO_COMPROVADA')
    estado = sorted(estados, key=lambda s: s['em'])[-1]
    originais = [e for e in eventos if e.get('wamid_sha') == resposta.get('wamid_sha') and e.get('tipo') == 'status'
                 and e.get('estado_meta') == estado['estado'] and e.get('recibo_sha') == e.get('hash') and e.get('estado') == 'concluido']
    if not originais:
        chat.erro('TESTE_STATUS_META_DURAVEL_AUSENTE')
    return recebidas, {'destinatario': ack['destinatario'], 'autorTipo': 'humano', 'idOperacional':resposta['id'],
        'wamidSha256': resposta['wamid_sha'], 'estadoMeta': estado['estado'],
        'statusPersistidoSha256': estado['hash'], 'recebimentoConfirmadoEquipe': True}


def executar(janela):
    pasta, cfg, contexto = chat.conferir_contexto(janela)
    autorizacao = chat.util.ler(pasta / 'autorizacao.json')
    chat.validar_autorizacao(autorizacao, cfg, contexto, chat.util.agora())
    if (cfg.get('escopoOperacional') != 'chat_humano' or cfg.get('corteMinimoChat', {}).get('fase') != 'teste'
            or cfg.get('enviosHabilitados') is not True or cfg.get('iaAutomatica') is not False):
        chat.erro('TESTE_EXIGE_FASE_RESTRITA')
    chat.validar_saude(chat.saude_local(), cfg)
    ack = chat.util.ler(pasta / 'confirmacao-equipe.json')
    validar_confirmacao(ack, autorizacao, contexto)
    mensagens, eventos = obter_observacoes(ack, autorizacao, cfg)
    recebidas, resposta = comprovar(ack, mensagens, eventos)
    chat.conferir_emissores(pasta, cfg, contexto, autorizacao)
    concluido = chat.util.agora().isoformat()
    comum = {'versao': 1, **contexto, 'concluidoEm': concluido}
    def salvar(nome, documento):
        chat.util.gravar(pasta / nome, documento, True)
        return {'arquivo': nome, 'sha256': chat.util.sha((pasta / nome).read_bytes())}
    sufixo = str(uuid.uuid4())
    recepcao = salvar('recepcao-real-' + sufixo + '.json', {**comum, 'tipo': 'mensagens-teste-chat-persistidas-v1',
        'bancoEntrada': 'donatella_entrada', 'bancoOperacao': 'donatella_operacao', 'mensagens': recebidas})
    envio = salvar('resposta-real-' + sufixo + '.json', {**comum, 'tipo': 'resposta-humana-chat-confirmada-v1', **resposta})
    prova = {**comum, 'tipo': 'teste-real-chat-minimo-v1', 'destinatario': ack['destinatario'],
        'phoneId': cfg['meta']['phoneId'], 'appId': cfg['meta']['appId'], 'recepcaoPersistida': recepcao,
        'respostaHumana': envio, 'confirmacaoEquipe': {'arquivo': 'confirmacao-equipe.json',
        'sha256': chat.util.sha((pasta / 'confirmacao-equipe.json').read_bytes())},
        'origemBloqueioProvaSha256': chat.util.sha((pasta / 'emissores-bloqueados.json').read_bytes())}
    chat.validar_testes_externos(prova, contexto, autorizacao, pasta)
    salvar('teste-real-' + sufixo + '.json', prova)
    chat.util.gravar(pasta / 'teste-real.json', prova)
    return {'tipo': prova['tipo'], 'mensagensRecebidas': len(recebidas), 'respostaMeta': resposta['estadoMeta'],
            'midiasConferidas': 2, 'enviosEfetuadosPeloVerificador': 0}


if __name__ == '__main__':
    try:
        os.umask(0o077)
        if len(sys.argv) != 2:
            chat.erro('USO_JANELA_UUID')
        print(json.dumps(executar(sys.argv[1])))
    except Exception as exc:
        codigo = str(exc)
        print(codigo if re.fullmatch(r'(CHAT_MINIMO|CORTE)_[A-Z0-9_]+', codigo)
              else 'CHAT_MINIMO_PROVA_REAL_INTERROMPIDA', file=sys.stderr)
        sys.exit(1)
