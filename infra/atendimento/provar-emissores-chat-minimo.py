"""Provas de revogação integral do principal; nunca revoga ou altera a origem.

O código exportado é evidência do projeto, não um hash de implantação. O bloqueio
depende da ação administrativa integral observada e dos GET oficiais posteriores.
Não produz observações de UI, retirada SQL ou êxito de ensaio.
"""
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import uuid

sys.dont_write_bytecode = True
SHA = re.compile(r'[a-f0-9]{64}')
PROJETO = 'ab6e3d01-5ef9-4acf-aab7-416f9eedb899'
PRINCIPAL_UI = '61577990824751'
FRASE = 'Are you sure you want to revoke all tokens for API CRM?'


def exigir(condicao, codigo):
    if not condicao:
        raise RuntimeError('CHAT_MINIMO_PRINCIPAL_' + codigo)


def sha(valor):
    return hashlib.sha256(valor).hexdigest()


def data(valor):
    try:
        d = datetime.datetime.fromisoformat(valor.replace('Z', '+00:00'))
        exigir(d.tzinfo is not None, 'INSTANTE_INVALIDO')
        return d
    except (ValueError, TypeError, AttributeError):
        exigir(False, 'INSTANTE_INVALIDO')


def validar_retorno(prova, contexto, pasta, cfg, referencia, validar_base, agora):
    validar_base(prova, 'retorno-emissores-chat-minimo-preparado-v1', contexto)
    refs = prova.get('referencias', {})
    fontes = {n: referencia(pasta, refs.get(n)) for n in
              ['procedimento', 'preflight', 'observacaoRetirada', 'ensaio', 'conferenciaCredenciais']}
    proc, pre, retirada, ensaio, cred = (fontes[n] for n in
              ['procedimento', 'preflight', 'observacaoRetirada', 'ensaio', 'conferenciaCredenciais'])
    exigir(proc.get('tipo') == 'procedimento-emissores-chat-minimo-v1'
           and all(proc.get(k) == v for k, v in contexto.items())
           and proc.get('phoneId') == cfg['meta']['phoneId']
           and SHA.fullmatch(str(proc.get('sqlSha256', ''))),
           'PROCEDIMENTO_RETORNO_DIVERGENTE')
    sql_ref = proc.get('sqlReferencia', {})
    exigir(isinstance(sql_ref.get('arquivo'), str) and re.fullmatch(r'[a-zA-Z0-9_.-]{1,160}', sql_ref['arquivo'])
           and sql_ref['arquivo'] not in ['.', '..'] and sql_ref.get('sha256') == proc['sqlSha256'], 'SQL_REFERENCIA_RECUSADA')
    sql_path = pasta / sql_ref['arquivo']
    exigir(sql_path.resolve() == sql_path and sql_path.is_file() and not sql_path.is_symlink()
           and sql_path.stat().st_size <= 256 * 1024
           and (os.name == 'nt' or sql_path.stat().st_mode & 0o077 == 0), 'SQL_PRIVADO_AUSENTE')
    sql_bytes = sql_path.read_bytes()
    exigir(sha(sql_bytes) == proc['sqlSha256'], 'SQL_CONTEUDO_DIVERGENTE')
    corpos = re.findall(r'AS \$guarda\$(.*?)\$guarda\$', sql_bytes.decode(), re.S)
    exigir(len(corpos) == 2 and sha(corpos[0].encode()) == proc.get('filaSha256')
           and sha(corpos[1].encode()) == proc.get('configuracaoSha256'), 'SQL_GUARDAS_DIVERGENTES')
    exigir(pre.get('tipo') == 'preflight-emissores-chat-minimo-v1'
           and pre.get('phoneId') == cfg['meta']['phoneId']
           and all(pre.get(k) is True for k in ['claimCriterioCompativel', 'visibilidadeIntegral',
                 'podeAtualizarConfiguracoes', 'podeGuardarFila', 'podeCriarSchema'])
           and pre.get('outrosNumerosConfigurados') == 0
           and proc.get('preflightSha256') == sha(json.dumps(pre, ensure_ascii=False, separators=(',', ':')).encode()),
           'PREFLIGHT_RETORNO_DIVERGENTE')
    exigir(retirada.get('tipo') == 'observacao-emissores-chat-minimo-v1'
           and retirada.get('janelaId') == contexto['janelaId'] and retirada.get('fase') == 'bloqueada'
           and retirada.get('phoneId') == cfg['meta']['phoneId'] and retirada.get('tokensAtivos') == []
           and retirada.get('iaAtiva') == 0 and retirada.get('retornoEm') is None
           and retirada.get('claimSha256') == pre.get('claimSha256')
           and retirada.get('configuracoesOriginaisSha256') == pre.get('configuracoesSha256')
           and retirada.get('backupConfiguracaoSha256') == pre.get('configuracoesSha256')
           and prova.get('backupConfiguracaoSha256') == retirada.get('backupConfiguracaoSha256')
           and SHA.fullmatch(str(retirada.get('backupConfiguracaoSha256', ''))), 'RETORNO_SEM_BACKUP_E_RETIRADA')
    guardas = retirada.get('guardas', {})
    exigir(prova.get('guardas') == guardas and prova.get('quarentena') == retirada.get('quarentena')
           and all(guardas.get(k) is True for k in ['triggerFilaAtivo', 'triggerConfiguracaoAtivo'])
           and all(SHA.fullmatch(str(guardas.get(k, ''))) and guardas[k] == proc.get(k)
                   and guardas[k] == ensaio.get(k) for k in ['filaSha256', 'configuracaoSha256']),
           'GUARDAS_RETORNO_DIVERGENTES')
    esperados = {'retiradaToken': 0, 'processingPreservados': 4, 'claimAntigoBloqueado': 0,
                 'claimAutomacaoBloqueado': 0, 'claimHumanoNovoPermitido': 1,
                 'tokenAntigoRecusado': 'EMISSORES_CHAT_CREDENCIAL_RETORNO_DIVERGENTE',
                 'deleteQuarentenaBloqueado': 0}
    exigir(ensaio.get('tipo') == 'ensaio-emissores-chat-minimo-v1' and ensaio.get('ambiente') == 'ficticio_isolado'
           and ensaio.get('banco') == 'donatella_ensaio_origem' and type(ensaio.get('enviosExternos')) is int
           and ensaio['enviosExternos'] == 0, 'ENSAIO_RETORNO_ISOLAMENTO')
    for k, esperado in esperados.items():
        caso = ensaio.get('casos', {}).get(k, {})
        exigir(type(caso.get('verificacoes')) is int and caso['verificacoes'] > 0
               and type(caso.get('esperado')) is type(esperado) and caso['esperado'] == esperado
               and type(caso.get('observado')) is type(esperado) and caso['observado'] == esperado,
               'ENSAIO_RETORNO_INCOMPLETO')
    fingerprint = sha(cfg['meta']['accessToken'].encode())
    exigir(cred.get('tipo') == 'conferencia-credenciais-chat-minimo-v1'
           and cred.get('vpsAptaLeitura') is True and cred.get('credenciaisIndependentes') is True
           and cred.get('vps', {}).get('validoNaConferencia') is True
           and cred.get('vps', {}).get('fingerprint') == fingerprint
           and prova.get('credencialRetornoFingerprint') == fingerprint
           and all(c.get('fingerprint') != fingerprint for c in pre.get('configuracoes', [])),
           'CREDENCIAL_RETORNO_DIVERGENTE')
    exigir(all(prova.get(k) is True for k in ['origemContinuaBloqueada',
           'acessoEscritaConfiguracaoOrigemConferido', 'exigeDesarmeBackupECallback', 'filasAntigasNuncaReativadas']),
           'RETORNO_SEM_TRAVAS')
    exigir(data(retirada.get('retiradaEm')) <= data(retirada.get('conferidaEm')) <= agora
           and data(ensaio.get('concluidoEm')) <= agora and data(cred.get('verificadaEm')) <= agora,
           'RETORNO_INSTANTES_INVALIDOS')
    return fontes


def validar_principal(prova, contexto, pasta, anterior, revogacao, cfg, autorizacao,
                      referencia, validar_base, agora):
    validar_base(prova, 'inventario-principal-emissores-chat-minimo-v1', contexto)
    exigir(prova.get('projetoId') == PROJETO, 'PROJETO_DIVERGENTE')
    fontes = {n: referencia(pasta, prova.get(n)) for n in
              ['codigoExportado', 'configuracoes', 'secrets', 'alcanceMeta',
               'revogacaoMeta', 'identidadeAnterior', 'retirada']}
    codigo, banco, secrets = (fontes[n] for n in ['codigoExportado', 'configuracoes', 'secrets'])
    exigir(codigo.get('tipo') == 'inventario-codigo-projeto-chat-minimo-v1'
           and codigo.get('somenteLeitura') is True and codigo.get('codigoExecutado') is False
           and SHA.fullmatch(str(codigo.get('zip', {}).get('sha256', ''))), 'CODIGO_EXPORTADO_AUSENTE')
    # Nenhuma equivalência entre exportação e implantação é presumida aqui.
    emissores = codigo.get('emissoresDiretos', [])
    esperados = {'supabase/functions/whatsapp-sender/index.ts',
                 'supabase/functions/test-whatsapp-message/index.ts'}
    exigir(isinstance(emissores, list) and len(emissores) == 2
           and {e.get('arquivo') for e in emissores} == esperados, 'EMISSORES_DESCONHECIDOS')
    for e in emissores:
        exigir(SHA.fullmatch(str(e.get('sha256', ''))) and e.get('metodo') == 'POST'
               and e.get('credencialMetaDeEnv') is False and e.get('tokenMetaHardcodedEncontrado') is False
               and isinstance(e.get('fontesCredencial'), list) and e['fontesCredencial']
               and all(s.startswith('nina_settings.whatsapp_access_token ') for s in e['fontesCredencial'])
               and set(e.get('fontesConfiguracaoAmbiente', [])) == {'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'},
               'FONTE_CREDENCIAL_NAO_COBERTA')
    exigir(banco.get('tipo') == 'inventario-credenciais-banco-chat-minimo-v1'
           and banco.get('visibilidadeIntegral') is True and banco.get('somenteLeitura') is True,
           'BANCO_NAO_CONFERIDO')
    tokens = banco.get('tokens', [])
    exigir(isinstance(tokens, list) and len(tokens) > 0 and all(isinstance(t, dict) for t in tokens), 'TOKENS_AUSENTES')
    fps = {t.get('fingerprint') for t in tokens}
    exigir(len(fps) == len(tokens) and all(SHA.fullmatch(str(f)) for f in fps)
           and all(t.get('mesmoNumero') is True for t in tokens), 'TOKENS_DIVERGENTES')
    origens = anterior.get('origens', [])
    exigir({o.get('fingerprint') for o in origens} == fps and len(origens) == len(fps)
           and all(o.get('validadeDebug') is True and o.get('usuarioSistema') is True
                   and o.get('aplicativoCorreto') is True and o.get('numeroConferido') is True for o in origens),
           'BASELINE_NAO_COMPROVADO')
    principais = {o.get('principalHash') for o in origens}
    exigir(len(principais) == 1 and all(SHA.fullmatch(str(p)) for p in principais), 'PRINCIPAL_NAO_UNICO')
    principal = next(iter(principais))
    exigir(anterior.get('vps', {}).get('principalHash') not in principais
           and anterior.get('credenciaisIndependentes') is True, 'VPS_NAO_INDEPENDENTE')
    identidade = fontes['identidadeAnterior']
    exigir(identidade.get('tipo') == 'identidade-oficial-emissores-chat-minimo-v1'
           and identidade.get('origemPrincipalHash') == principal
           and identidade.get('origemNome') == 'API CRM'
           and identidade.get('vpsNome') == 'Donatella'
           and identidade.get('vpsPrincipalHash') == anterior.get('vps', {}).get('principalHash')
           and identidade.get('origemHttp') == 200 and identidade.get('vpsHttp') == 200
           and identidade.get('appId') == cfg['meta']['appId'], 'IDENTIDADE_OFICIAL_AUSENTE')
    exigir(secrets.get('tipo') == 'observacao-secrets-cloud-chat-minimo-v1'
           and secrets.get('projetoId') == PROJETO and secrets.get('nomes') == ['LOVABLE_API_KEY']
           and secrets.get('valoresExpostos') is False, 'SECRETS_NAO_COBERTOS')
    alcance = fontes['alcanceMeta']
    exigir(alcance.get('tipo') == 'observacao-meta-principal-chat-minimo-v1'
           and alcance.get('principalUiId') == PRINCIPAL_UI and alcance.get('nome') == 'API CRM'
           and alcance.get('confirmacaoExibida') == FRASE
           and alcance.get('aplicativosInstalados') == [cfg['meta']['appId']]
           and alcance.get('acao') == 'inspecao_cancelada', 'ALCANCE_INTEGRAL_NAO_OBSERVADO')
    acao = fontes['revogacaoMeta']
    exigir(acao.get('tipo') == 'observacao-meta-principal-chat-minimo-v1'
           and acao.get('principalUiId') == PRINCIPAL_UI and acao.get('nome') == 'API CRM'
           and acao.get('confirmacaoExibida') == FRASE
           and acao.get('acao') == 'revogacao_integral_confirmada'
           and acao.get('janelaId') == contexto['janelaId']
           and isinstance(acao.get('resultadoExibido'), str) and 1 <= len(acao['resultadoExibido']) <= 500,
           'REVOGACAO_INTEGRAL_NAO_OBSERVADA')
    exigir(data(autorizacao['inicio']) <= data(acao.get('observadaEm')) <= data(revogacao.get('verificadaEm')) <= agora,
           'REVOGACAO_FORA_JANELA')
    exigir(revogacao.get('todasOrigemRevogadas') is True and revogacao.get('vpsAptaLeitura') is True
           and revogacao.get('credenciaisIndependentes') is True
           and {o.get('fingerprint') for o in revogacao.get('origens', [])} == fps,
           'REVOGACAO_NAO_CONFIRMADA_PELA_API')
    # Retirada conferida separadamente da revogação: não carregar a nova chave na origem.
    retirada = fontes['retirada']
    exigir(retirada.get('tipo') == 'observacao-emissores-chat-minimo-v1'
           and retirada.get('janelaId') == contexto['janelaId'] and retirada.get('fase') == 'bloqueada'
           and retirada.get('phoneId') == cfg['meta']['phoneId'] and retirada.get('tokensAtivos') == []
           and retirada.get('iaAtiva') == 0 and retirada.get('retornoEm') is None
           and SHA.fullmatch(str(retirada.get('backupConfiguracaoSha256', ''))), 'ORIGEM_AINDA_CARREGADA')
    guardas, quarentena = retirada.get('guardas', {}), retirada.get('quarentena', {})
    exigir(all(guardas.get(k) is True for k in ['triggerFilaAtivo', 'triggerConfiguracaoAtivo'])
           and all(SHA.fullmatch(str(guardas.get(k, ''))) for k in ['filaSha256', 'configuracaoSha256'])
           and SHA.fullmatch(str(quarentena.get('conteudoSha256', '')))
           and type(quarentena.get('registros')) is int and quarentena['registros'] >= 0
           and type(quarentena.get('processingOriginais')) is int
           and quarentena['processingOriginais'] >= banco.get('enviosResultadoIncerto', 0),
           'QUARENTENA_NAO_COMPROVADA')
    exigir(data(autorizacao['inicio']) <= data(retirada.get('retiradaEm')) <= data(retirada.get('conferidaEm')) <= agora,
           'RETIRADA_FORA_JANELA')
    return {'principalHash': principal, 'fingerprints': sorted(fps), 'metodo': 'principal_meta_revogacao_integral'}


def main():
    # Os produtores de observação são independentes: este agregado só reúne o que existe.
    exigir(len(sys.argv) == 2, 'USO_JANELA')
    spec = importlib.util.spec_from_file_location('controle', Path(__file__).with_name('controle-corte-minimo-chat.py'))
    chat = importlib.util.module_from_spec(spec); spec.loader.exec_module(chat)
    pasta, cfg, contexto = chat.conferir_contexto(sys.argv[1])
    autorizacao = chat.util.ler(pasta / 'autorizacao.json')
    chat.validar_autorizacao(autorizacao, cfg, contexto, chat.util.agora())
    plano = chat.util.ler(pasta / 'plano-emissores.json')
    exigir(plano.get('metodo') == 'principal_meta_revogacao_integral', 'METODO_RECUSADO')
    anterior = chat.referencia(pasta, plano.get('conferenciaAnterior'))
    spec_c = importlib.util.spec_from_file_location('conferidor', Path(__file__).with_name('conferir-exclusividade-chat-minimo.py'))
    conf = importlib.util.module_from_spec(spec_c); spec_c.loader.exec_module(conf)
    tokens = chat.util.ler(pasta / 'tokens-origem.json')['tokens']
    vivo = conf.conferir(cfg['meta'], tokens, anterior)
    exigir(vivo.get('todasOrigemRevogadas') is True and vivo.get('credenciaisIndependentes') is True
           and vivo.get('vpsAptaLeitura') is True, 'CREDENCIAIS_NAO_BLOQUEADAS')
    nomes = ['codigoExportado', 'configuracoes', 'secrets', 'alcanceMeta',
             'revogacaoMeta', 'identidadeAnterior', 'retirada']
    fontes = plano.get('fontesInventario', {})
    exigir(isinstance(fontes, dict) and set(fontes) == set(nomes), 'FONTES_INVENTARIO_INCOMPLETAS')
    inventario = {'versao': 1, 'tipo': 'inventario-principal-emissores-chat-minimo-v1', **contexto,
                  'concluidoEm': chat.util.agora().isoformat(), 'projetoId': PROJETO, **fontes}
    validar_principal(inventario, contexto, pasta, anterior, vivo, cfg, autorizacao,
                      chat.referencia, chat.validar_base, chat.util.agora())
    retorno = chat.referencia(pasta, plano.get('retornoVerificado'))
    exigir(retorno.get('tipo') == 'retorno-emissores-chat-minimo-preparado-v1'
           and retorno.get('referencias', {}).get('observacaoRetirada') == inventario.get('retirada'),
           'RETORNO_ANTIGO_OU_RETIRADA_DIVERGENTE')
    chat.validar_retorno_preparado(retorno, contexto, cfg, pasta)
    nome_inventario = 'inventario-principal-' + str(uuid.uuid4()) + '.json'
    chat.util.gravar(pasta / nome_inventario, inventario, True)
    nome = 'revogacao-oficial-' + str(uuid.uuid4()) + '.json'
    chat.util.gravar(pasta / nome, vivo, True)
    prova = {'versao': 1, 'tipo': 'emissores-chat-bloqueados-v1', **contexto,
             'concluidoEm': chat.util.agora().isoformat(), 'metodo': plano['metodo'],
             'inventario': {'arquivo': nome_inventario, 'sha256': sha((pasta / nome_inventario).read_bytes())},
             'conferenciaAnterior': plano['conferenciaAnterior'],
             'conferenciaRevogacao': {'arquivo': nome, 'sha256': sha((pasta / nome).read_bytes())},
             'retornoVerificado': plano['retornoVerificado'],
             'conferidorSha256': sha(Path(__file__).with_name('conferir-exclusividade-chat-minimo.py').read_bytes())}
    chat.util.gravar(pasta / 'emissores-bloqueados.json', prova, True)
    print(json.dumps({'provaGerada': True, 'metodo': prova['metodo'], 'mutacoesMeta': 0, 'envios': 0}))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print(json.dumps({'provaGerada': False, 'erro': 'EMISSORES_NAO_COMPROVADOS'}))
        raise SystemExit(1)
