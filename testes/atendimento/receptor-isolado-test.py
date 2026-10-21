import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('receptor_isolado', ROOT / 'infra/atendimento/ensaiar-receptor-isolado.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ProvaReceptor(unittest.TestCase):
    def test_banco_novo_sem_rede_portas_credenciais_ou_pull(self):
        p = m.plano_banco('donatella-receptor-prova-' + 'a' * 32, 'prova-dados', Path('/prova/socket'))
        self.assertIn('--pull=never', p)
        self.assertIn(m.IMAGEM_PG, p)
        self.assertEqual(p[p.index('--network') + 1], 'none')
        self.assertNotIn('-p', p)
        self.assertFalse(any('operacao.json' in s or 'configuracao/' in s for s in p))
        self.assertIn('listen_addresses=', p)

    def test_runner_sem_rede_mount_privado_real_ou_worker(self):
        for fase in ('--preparar', '--retomada'):
            p = m.plano_runner('runner', fase, Path('/release-fixture'), Path('/prova-fixture'))
            self.assertEqual(p[p.index('--network') + 1], 'none')
            self.assertIn('--pull=never', p)
            self.assertIn(m.IMAGEM_NODE, p)
            self.assertEqual(p[-2:], ['/release/provas/receptor-isolado.mjs', fase])
            self.assertFalse(any('run/secrets' in s or 'operacao.mjs' in s for s in p))
        with self.assertRaisesRegex(RuntimeError, 'FASE_RECUSADA'):
            m.plano_runner('runner', '--habilitar', Path('/release'), Path('/prova'))

    def test_socket_padrao_do_initdb_e_compartilhado_do_runner_sem_tcp(self):
        p = m.plano_banco('donatella-receptor-prova-' + 'c' * 32, 'prova-dados', Path('/prova/socket'))
        self.assertIn('unix_socket_directories=/socket,/var/run/postgresql', p)
        self.assertIn('/var/run/postgresql:rw,noexec,nosuid,size=16m', p)
        self.assertIn('type=bind,src=' + str(Path('/prova/socket')) + ',dst=/socket', p)
        self.assertIn('listen_addresses=', p)
        self.assertEqual(p[p.index('--network') + 1], 'none')
        self.assertNotIn('-p', p)

    def test_banco_produtivo_nunca_eh_alvo_de_conferencia_ou_reinicio(self):
        with patch.object(m, 'comando') as run:
            for nome in ('grazing-donatella-operacao-v2-banco', 'grazing-donatella-homologacao-v2-banco', 'donatella-receptor-prova-../real'):
                with self.assertRaisesRegex(RuntimeError, 'CONTAINER_RECUSADO'):
                    m.conferir_container(nome)
            run.assert_not_called()

    def test_container_exige_finalidade_rede_e_identidade(self):
        d = {'Id': 'id-ficticio', 'Config': {'Labels': {'grazing.finalidade': m.FINALIDADE}}, 'HostConfig': {'NetworkMode': 'none', 'PortBindings': {}}}
        nome = 'donatella-receptor-prova-' + 'b' * 32
        with patch.object(m, 'comando', return_value=json.dumps([d])):
            self.assertEqual(m.conferir_container(nome, 'id-ficticio')['Id'], 'id-ficticio')
            with self.assertRaisesRegex(RuntimeError, 'DIVERGENTE'):
                m.conferir_container(nome, 'outro-id')
        for alteracao in ({'NetworkMode': 'bridge'}, {'PortBindings': {'5432/tcp': [{'HostPort': '5432'}]}}):
            outro = {**d, 'HostConfig': {**d['HostConfig'], **alteracao}}
            with patch.object(m, 'comando', return_value=json.dumps([outro])):
                with self.assertRaisesRegex(RuntimeError, 'ISOLAMENTO_RECUSADO'):
                    m.conferir_container(nome)

    def test_release_divergente_recusada_antes_de_criar_recursos(self):
        with tempfile.TemporaryDirectory() as t:
            raiz = Path(t).resolve()
            r = raiz / 'release'
            (r / 'provas').mkdir(parents=True)
            (r / 'sql').mkdir()
            (r / 'operacao.mjs').write_text('runtime ficticio')
            (r / 'provas/receptor-isolado.mjs').write_text('ensaio ficticio')
            nomes = ('025-operacao-destino.sql', '026-entrada-duravel-destino.sql')
            for n in nomes:
                (r / 'sql' / n).write_text('select 1;')
            manifest = {'runtimeSha256': m.sha(r / 'operacao.mjs'), 'executaveisSha256': {'provas/receptor-isolado.mjs': m.sha(r / 'provas/receptor-isolado.mjs')}, 'sqlSha256': {n: m.sha(r / 'sql' / n) for n in nomes}}
            (r / 'release.json').write_text(json.dumps(manifest))
            self.assertEqual(m.conferir_release(raiz), manifest['runtimeSha256'])
            (r / 'provas/receptor-isolado.mjs').write_text('outro ensaio')
            with self.assertRaisesRegex(RuntimeError, 'RUNNER_DIVERGENTE'):
                m.conferir_release(raiz)


if __name__ == '__main__':
    unittest.main()
