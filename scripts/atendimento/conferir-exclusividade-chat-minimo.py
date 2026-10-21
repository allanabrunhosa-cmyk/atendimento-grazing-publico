#!/usr/bin/env python3
"""Conferência oficial somente GET; não revoga, envia, altera callback ou autoriza corte.

Entrada privada por stdin: {meta: configuração Meta da VPS, tokensOrigem: [segredos],
origemAntes: relatório anterior opcional}. A saída contém hashes, nunca tokens ou IDs
de pessoas. O chamador deve preservar o relatório antes de revogar e conferir,
separadamente, o inventário completo dos emissores/credenciais e o retorno.
"""
import hashlib
import hmac
import json
import re
import sys
from datetime import datetime, timezone
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener

APP = '1468746651147688'
WABA = '693046076807360'
PHONE = '648633368337527'
TIPO = 'conferencia-credenciais-chat-minimo-v1'
ESCOPOS = {'whatsapp_business_messaging', 'whatsapp_business_management'}
MAX_CORPO = 1024 * 1024


def sha(valor):
    return hashlib.sha256(valor.encode('utf-8')).hexdigest()


class SemRedirecionamento(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def get_oficial(url, headers):
    """Nunca inclui URL/corpo do erro em exceções públicas; limite também para HTTPError."""
    try:
        resposta = build_opener(SemRedirecionamento).open(
            Request(url, headers=headers, method='GET'), timeout=20)
    except HTTPError as erro:
        resposta = erro
    with resposta:
        corpo = resposta.read(MAX_CORPO + 1)
        if len(corpo) > MAX_CORPO:
            raise ValueError('RESPOSTA_EXCESSIVA')
        return resposta.status, json.loads(corpo), resposta.headers.get('facebook-api-version')


def validade_temporal(dados, em):
    """Preserva o que o debugger declarou; zero não é uma promessa de validade eterna."""
    campos = ('issued_at', 'expires_at', 'data_access_expires_at')
    informados = {k: dados[k] for k in campos if k in dados}
    validos = all(type(v) is int and 0 <= v <= 253402300799 for v in informados.values())
    # Valores malformados não são propagados para o relatório público.
    prazos = {k: v for k, v in informados.items() if type(v) is int and 0 <= v <= 253402300799}
    limites = [prazos[k] for k in campos[1:] if prazos.get(k, 0) > 0]
    expirada = any(limite <= em.timestamp() for limite in limites)
    emissao_futura = prazos.get('issued_at', 0) > em.timestamp()
    return {'camposInformados': list(informados), **prazos,
            'metadadosValidos': validos, 'expirada': expirada,
            'emissaoFutura': emissao_futura,
            'limiteDeclaradoUnix': min(limites) if limites else None,
            'limitesObservadosCompativeis': validos and not expirada and not emissao_futura,
            'situacao': ('metadados_invalidos' if not validos else 'expirada' if expirada
                         else 'emissao_futura' if emissao_futura else 'prazo_declarado_vigente' if limites
                         else 'sem_prazo_declarado' if informados else 'nao_informada')}


def conferir(meta, tokens_origem, origem_antes=None, requisitar=None, quando=None):
    """Retorna evidência derivada das respostas; rede/ausência/permissão não são revogação.

    O baseline válido liga o token posteriormente inválido ao principal original.
    Tokens diferentes do MESMO usuário de sistema não contam como independentes.
    GET/scopes não comprovam um envio real: esse teste pertence à janela autorizada.
    """
    if not isinstance(meta, dict) or any(str(meta.get(k)) != v for k, v in
            [('appId', APP), ('wabaId', WABA), ('phoneId', PHONE)]):
        raise ValueError('CONTA_META_DIVERGENTE')
    segredo, token_vps = meta.get('appSecret'), meta.get('accessToken')
    versao = meta.get('graphVersion')
    valido_token = lambda t: isinstance(t, str) and 20 <= len(t) <= 4096 and not re.search(r'\s', t)
    if not isinstance(segredo, str) or not re.fullmatch(r'[A-Za-z0-9_-]{32,256}', segredo):
        raise ValueError('CONFIGURACAO_PRIVADA_INVALIDA')
    if not valido_token(token_vps) or not isinstance(versao, str) or not re.fullmatch(r'v\d{1,2}\.0', versao):
        raise ValueError('CONFIGURACAO_PRIVADA_INVALIDA')
    if (not isinstance(tokens_origem, list) or not 1 <= len(tokens_origem) <= 20
            or not all(valido_token(t) for t in tokens_origem)
            or len(set(tokens_origem)) != len(tokens_origem)):
        raise ValueError('INVENTARIO_CREDENCIAIS_INVALIDO')
    requisitar = requisitar or get_oficial
    em = quando or datetime.now(timezone.utc)
    if not isinstance(em, datetime) or em.tzinfo is None or em.utcoffset() is None:
        raise ValueError('INSTANTE_CONFERENCIA_INVALIDO')
    prova = {'versao': 1, 'tipo': TIPO, 'verificadaEm': em.astimezone(timezone.utc).isoformat(),
             'appId': APP, 'wabaId': WABA, 'phoneId': PHONE, 'somenteLeitura': True,
             'envios': 0, 'mutacoes': 0, 'consultas': [], 'origens': [],
             'appSecretValido': False, 'vpsAptaLeitura': False,
             'credenciaisIndependentes': False, 'todasOrigemRevogadas': False,
             'exclusividadeCompletaComprovada': False,
             'limites': ['Inventário de código e de todas as credenciais da origem é externo.',
                        'GET não comprova envio real nem procedimento de retorno.',
                        'Não comprova inexistência de solicitações já aceitas antes da revogação.',
                        'Prazo ausente ou zero no debugger não garante validade futura.']}

    def consultar(nome, path, token, parametros=None):
        params = dict(parametros or {})
        params['appsecret_proof'] = hmac.new(segredo.encode(), token.encode(), hashlib.sha256).hexdigest()
        url = 'https://graph.facebook.com/' + versao + '/' + path + '?' + urlencode(params)
        resumo = {'consulta': nome, 'ok': False, 'http': None, 'codigoErro': None}
        corpo = None
        try:
            status, corpo, efetiva = requisitar(url, {'Authorization': 'Bearer ' + token,
                                                   'Accept': 'application/json'})
            if not isinstance(corpo, dict) or not isinstance(status, int):
                raise ValueError('RESPOSTA_INVALIDA')
            erro = corpo.get('error')
            resumo.update(http=status, ok=200 <= status < 300 and not erro,
                          apiEfetiva=efetiva if isinstance(efetiva, str) and re.fullmatch(r'v\d{1,2}\.0', efetiva) else None,
                          codigoErro=erro.get('code') if isinstance(erro, dict) and type(erro.get('code')) is int else None)
        except Exception:
            resumo['falha'] = 'REDE_OU_RESPOSTA_INVALIDA'
            corpo = None
        prova['consultas'].append(resumo)
        return corpo, resumo

    app_token = APP + '|' + segredo
    aplicativo, estado_app = consultar('aplicativo', APP, app_token, {'fields': 'id'})
    if not estado_app['ok'] or not aplicativo or aplicativo.get('id') != APP:
        return prova
    prova['appSecretValido'] = True

    def conferir_token(nome, token):
        debug, estado = consultar(nome + '_debug', 'debug_token', app_token, {'input_token': token})
        dados = debug.get('data') if isinstance(debug, dict) else None
        dados = dados if isinstance(dados, dict) and estado['ok'] else {}
        validade = dados.get('is_valid') if type(dados.get('is_valid')) is bool else None
        temporal = validade_temporal(dados, em)
        principal = dados.get('user_id')
        resultado = {'fingerprint': sha(token), 'validadeDebug': validade,
                     'validadeTemporal': temporal,
                     'validoNaConferencia': validade is True and temporal['limitesObservadosCompativeis'],
                     'aplicativoCorreto': str(dados.get('app_id')) == APP,
                     'usuarioSistema': dados.get('type') == 'SYSTEM_USER',
                     'principalHash': sha(str(principal)) if principal and re.fullmatch(r'\d{1,30}', str(principal)) else None,
                     'escoposNecessarios': isinstance(dados.get('scopes'), list)
                        and all(isinstance(s, str) for s in dados['scopes']) and ESCOPOS.issubset(dados['scopes'])}
        numero, estado_numero = consultar(nome + '_numero', PHONE, token, {'fields': 'id'})
        resultado['numeroConferido'] = bool(estado_numero['ok'] and numero and numero.get('id') == PHONE)
        resultado['numeroNegadoOAuth'] = estado_numero['http'] in (400, 401) and estado_numero['codigoErro'] == 190
        resultado['revogacaoObservada'] = validade is False and resultado['numeroNegadoOAuth']
        return resultado

    prova['vps'] = conferir_token('vps', token_vps)
    vps = prova['vps']
    numeros, estado_numeros = consultar('vps_numeros_waba', WABA + '/phone_numbers', token_vps,
                                      {'fields': 'id', 'limit': '100'})
    prova['vpsWabaConferida'] = bool(estado_numeros['ok'] and isinstance(numeros.get('data'), list)
                                    and not numeros.get('paging', {}).get('next')
                                    and any(str(n.get('id')) == PHONE for n in numeros['data'] if isinstance(n, dict))) if numeros else False
    prova['vpsAptaLeitura'] = all([vps['validoNaConferencia'], vps['aplicativoCorreto'],
                                  vps['usuarioSistema'], bool(vps['principalHash']),
                                  vps['escoposNecessarios'], vps['numeroConferido'], prova['vpsWabaConferida']])
    prova['origens'] = [conferir_token('origem_' + str(i + 1), t) for i, t in enumerate(tokens_origem)]
    baseline_valido = (isinstance(origem_antes, dict) and origem_antes.get('tipo') == TIPO
                       and origem_antes.get('appId') == APP and origem_antes.get('wabaId') == WABA
                       and origem_antes.get('phoneId') == PHONE and origem_antes.get('somenteLeitura') is True
                       and origem_antes.get('appSecretValido') is True)
    baseline = {r.get('fingerprint'): r for r in origem_antes.get('origens', []) if isinstance(r, dict)} if baseline_valido else {}
    principal_origem = []
    for origem in prova['origens']:
        anterior = baseline.get(origem['fingerprint'], {})
        identidade = origem if origem['validoNaConferencia'] else anterior
        identidade_valida = (identidade.get('validadeDebug') is True and identidade.get('aplicativoCorreto') is True
                             and identidade.get('validoNaConferencia', True) is True
                             and identidade.get('usuarioSistema') is True and identidade.get('numeroConferido') is True
                             and isinstance(identidade.get('principalHash'), str)
                             and re.fullmatch('[0-9a-f]{64}', identidade['principalHash']) is not None)
        origem['identidadeAnteriorConferida'] = identidade_valida
        principal_origem.append(identidade['principalHash'] if identidade_valida else None)
    prova['credenciaisIndependentes'] = bool(prova['vpsAptaLeitura'] and all(principal_origem)
        and vps['principalHash'] not in principal_origem and vps['fingerprint'] not in {r['fingerprint'] for r in prova['origens']})
    prova['todasOrigemRevogadas'] = all(r['revogacaoObservada'] and r['identidadeAnteriorConferida'] for r in prova['origens'])
    return prova


def main():
    if len(sys.argv) != 1:
        raise ValueError('ENTRADA_PRIVADA_SOMENTE_STDIN')
    dados = sys.stdin.buffer.read(128 * 1024 + 1)
    if len(dados) > 128 * 1024:
        raise ValueError('ENTRADA_EXCESSIVA')
    entrada = json.loads(dados)
    print(json.dumps(conferir(entrada['meta'], entrada['tokensOrigem'], entrada.get('origemAntes')), ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('CONFERENCIA_CHAT_RECUSADA: confira privadamente a configuração.', file=sys.stderr)
        sys.exit(1)
