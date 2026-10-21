"""Reúne resultados reais de ensaios fictícios; não executa operação ou banco.

Recebe manifesto privado contendo contexto, release (referência), vitest
(lista de referências), receptor, nucleo e operacao (referências). Todos os
relatórios precisam existir com hash coincidente. Log de texto não é aceito.
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
chat = importlib.util.module_from_spec(spec); spec.loader.exec_module(chat)

UNITARIOS = {
    'autenticacaoHub': [('operacao-autenticacao-hub.test.ts', 'usa a senha atual central'),
                       ('operacao-autenticacao-hub.test.ts', 'revogação/versão/inativação central'),
                       ('operacao-autenticacao-hub.test.ts', 'leitura não herda escrita')],
    'permissoesServidor': [('operacao-servidor.test.ts', 'bloqueia sessão ausente e permissões'),
                          ('operacao-servidor.test.ts', 'nega escritas com origem ou csrf inválido'),
                          ('operacao-servidor.test.ts', 'nega configurações e automações')],
    'destinatarioTesteRestrito': [('operacao-chat-minimo.test.ts', 'recusa destinatário cliente e upload'),
                                 ('operacao-chat-minimo.test.ts', 'envia uma única vez texto/emojis')],
    'iaAutomacoesDesligadas': [('operacao-chat-minimo.test.ts', 'mantém o modo completo e exige desarme explícito'),
                              ('operacao-chat-minimo.test.ts', 'fase receber impede resposta'),
                              ('operacao-chat-minimo.test.ts', 'bloqueia automações e transferência para IA')],
    'audioImagemVideoDocumento': [('operacao-midia-chat.test.ts', 'preserva áudio em CAS'),
                                  ('operacao-midia-contrato.test.ts', 'não envia PDF declarado imagem'),
                                  ('operacao-midia-contrato.test.ts', 'confere WebP estático/animado'),
                                  ('operacao-interface.test.tsx', 'abre video recebido pelo serviço autenticado')],
}


def indice_vitest(relatorios):
    testes = []
    for relatorio, ref in relatorios:
        if (relatorio.get('success') is not True or relatorio.get('numFailedTests') != 0
                or relatorio.get('numFailedTestSuites') != 0 or not isinstance(relatorio.get('testResults'), list)):
            chat.erro('ENSAIO_VITEST_FALHOU_OU_LOG_INVALIDO')
        for suite in relatorio['testResults']:
            if suite.get('status') != 'passed' or not isinstance(suite.get('assertionResults'), list):
                chat.erro('ENSAIO_SUITE_NAO_PASSOU')
            nome = str(suite.get('name', '')).replace('\\', '/').rsplit('/', 1)[-1]
            for caso in suite['assertionResults']:
                if caso.get('status') == 'passed':
                    testes.append((nome, caso.get('title', ''), ref))
    return testes


def reunir(manifesto, ler_ref):
    contexto = manifesto.get('contexto', {})
    if (manifesto.get('versao') != 1 or not chat.UUID.fullmatch(str(contexto.get('janelaId', '')))
            or any(not chat.SHA.fullmatch(str(contexto.get(k, ''))) for k in ['runtimeSha256','manifestoSha256'])):
        chat.erro('ENSAIO_CONTEXTO_INVALIDO')
    release = ler_ref(manifesto.get('release'))
    if (release.get('runtimeSha256') != contexto['runtimeSha256']
            or manifesto['release']['sha256'] != contexto['manifestoSha256']):
        chat.erro('ENSAIO_RELEASE_DIVERGENTE')
    refs = manifesto.get('vitest')
    if not isinstance(refs, list) or not 1 <= len(refs) <= 10:
        chat.erro('ENSAIO_RELATORIOS_AUSENTES')
    testes = indice_vitest([(ler_ref(ref),ref) for ref in refs])
    casos = {}
    def caso(nome, evidencias, verificacoes):
        casos[nome] = {'estado':'passou', 'verificacoes':verificacoes, 'evidencias':evidencias,
                       'resultadoSha256':chat.hash_json(evidencias)}
    for capacidade, exigidos in UNITARIOS.items():
        fontes = []
        for arquivo, titulo in exigidos:
            aprovados = [(nome, texto, ref) for nome,texto,ref in testes if nome == arquivo and titulo in texto]
            if not aprovados:
                chat.erro('ENSAIO_CASO_UNITARIO_AUSENTE')
            fontes.append({'relatorio':aprovados[0][2], 'arquivoTeste':arquivo, 'titulo':aprovados[0][1]})
        caso(capacidade, fontes, len(fontes))
    receptor = ler_ref(manifesto.get('receptor'))
    if (receptor.get('tipo') != 'ensaio-receptor-isolado-v1' or receptor.get('runtimeSha256') != contexto['runtimeSha256']
            or receptor.get('dados') != 'exclusivamente_ficticios'
            or receptor.get('banco') != 'donatella_ensaio_operacao' or receptor.get('bancoEntrada') != 'donatella_ensaio_entrada'
            or not chat.SHA.fullmatch(str(receptor.get('receptorBundleSha256','')))
            or receptor.get('receptorBundleSha256') != release.get('executaveisSha256',{}).get('provas/receptor-isolado.mjs')
            or not chat.natural(receptor.get('assercoes')) or receptor['assercoes'] < 1):
        chat.erro('ENSAIO_RECEPTOR_DIVERGENTE')
    r = receptor.get('resultados',{})
    if (r.get('enviosExternos') != 0 or type(r.get('enviosExternos')) is not int
            or any(r.get(k) is not True for k in ['assinaturaInvalidaRecusada','persistidoAntesAck',
                                                'repeticaoIdempotente','falhaPersistenciaSemAck','retomadaAposReinicio'])):
        chat.erro('ENSAIO_RECEPTOR_INCOMPLETO')
    for capacidade in ['persistenciaAntesAck','assinaturaInvalidaRecusada','entradaIdempotente','retomadaAposReinicio']:
        caso(capacidade,[{'relatorio':manifesto['receptor']}],1)
    nucleo = ler_ref(manifesto.get('nucleo'))
    if (nucleo.get('tipo') != 'ensaio-chat-minimo-nucleo-v1' or nucleo.get('conteudoReal') is not False
            or type(nucleo.get('enviosExternos')) is not int or nucleo['enviosExternos'] != 0
            or nucleo.get('filasHistoricasReprocessadas') != 0
            or any(nucleo.get(k) is not True for k in ['snapshotConsistente','escopoNoveEntidades','conteudoTipadoConferido',
                                                    'retomadaAposReinicio','novasEscritasPreservadas'])
            or not chat.natural(nucleo.get('assercoes')) or nucleo['assercoes'] < 1
            or not chat.SHA.fullmatch(str(nucleo.get('runnerSha256','')))
            or nucleo['runnerSha256'] != release.get('executaveisSha256',{}).get('provas/chat-minimo-banco.mjs')):
        chat.erro('ENSAIO_NUCLEO_INCOMPLETO_OU_DIVERGENTE')
    caso('importacaoIsolada',[{'relatorio':manifesto['nucleo']}],1)
    operacao = ler_ref(manifesto.get('operacao'))
    if (operacao.get('ensaio') != 'operacao-integrada-postgresql' or operacao.get('transporte') != 'fronteira-simulada'
            or operacao.get('conversasFicticias') is not True or type(operacao.get('enviosExternos')) is not int
            or operacao['enviosExternos'] != 0 or not chat.natural(operacao.get('assercoes')) or operacao['assercoes'] < 1
            or not chat.SHA.fullmatch(str(operacao.get('runnerSha256','')))
            or operacao['runnerSha256'] != release.get('executaveisSha256',{}).get('provas/operacao-banco.mjs')):
        chat.erro('ENSAIO_OPERACAO_PG_INCOMPLETO_OU_DIVERGENTE')
    for capacidade in ['filaHumana','envioDuplicadoBloqueado','statusEnvio']:
        caso(capacidade,[{'relatorio':manifesto['operacao']}],1)
    prova = {'versao':1,'tipo':'ensaio-chat-minimo-isolado-v1',**contexto,'concluidoEm':chat.util.agora().isoformat(),
             'banco':'donatella_ensaio_operacao','bancoEntrada':'donatella_ensaio_entrada',
             'ambiente':'ficticio_isolado','enviosExternos':0,'casos':casos,
             'limites':['Autenticação e transporte externos usam fixtures; teste real fica restrito à nova janela autorizada.']}
    chat.validar_ensaio(prova,contexto)
    return prova


def executar(caminho):
    p = Path(caminho)
    if not p.is_absolute() or p.resolve() != p or p.parent.is_symlink():
        chat.erro('ENSAIO_CAMINHO_RECUSADO')
    manifesto = chat.util.ler(p,1024*1024)
    prova = reunir(manifesto,lambda ref:chat.referencia(p.parent,ref))
    chat.util.gravar(p.parent/('ensaio-isolado-'+str(uuid.uuid4())+'.json'),prova,True)
    chat.util.gravar(p.parent/'ensaio-isolado.json',prova)
    return {'tipo':prova['tipo'],'capacidades':len(prova['casos']),'enviosExternos':0,
            'runtimeSha256':prova['runtimeSha256'],'prontidaoOperacaoReal':False}


if __name__=='__main__':
    try:
        os.umask(0o077)
        if len(sys.argv)!=2:chat.erro('USO_MANIFESTO_ENSAIOS')
        print(json.dumps(executar(sys.argv[1])))
    except Exception as exc:
        codigo=str(exc)
        print(codigo if re.fullmatch(r'(CHAT_MINIMO|CORTE)_[A-Z0-9_]+',codigo) else 'CHAT_MINIMO_ENSAIO_AGREGACAO_INTERROMPIDA',file=sys.stderr)
        sys.exit(1)
