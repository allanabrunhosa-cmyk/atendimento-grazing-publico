"""Provas locais de recusa, preservação e retorno. Não acessa a VPS ou bancos."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

if sys.platform == 'win32':
    sys.modules['fcntl'] = types.SimpleNamespace(LOCK_EX=1, LOCK_NB=2, flock=lambda *_: None)

FILE = Path(__file__).resolve().parents[2] / 'infra/atendimento/publicar-repositorio.py'
spec = importlib.util.spec_from_file_location('publicacao', FILE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class PublicacaoTest(unittest.TestCase):
    def setUp(self):
        if sys.platform == 'win32':
            task_chmod = patch.object(module.os, 'fchmod', lambda *_: None, create=True)
            task_chmod.start()
            self.addCleanup(task_chmod.stop)
        self.temp = tempfile.TemporaryDirectory(prefix='grazing-publicacao-ficticia-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.checkpoint_root = self.root / 'checkpoint'
        self.checkpoint_root.mkdir()
        self.backup_locks = [self.root / 'drive.lock', self.checkpoint_root / 'exclusao.lock']
        self.commit = '1' * 40
        self.candidate = self.root / 'candidatas/candidata'
        self.candidate.mkdir(parents=True)
        self.release = self.root / 'release'
        self.release.mkdir()
        for folder in [self.candidate, self.release]:
            (folder / 'web').mkdir()
            (folder / 'web/index.html').write_text('interface ficticia')
            (folder / 'operacao.mjs').write_text('runtime ficticio')
            (folder / 'release.json').write_text(json.dumps({'repositorioOrigem': module.REPOSITORY, 'revisaoBase': self.commit, 'runtimeSha256': module.sha(folder / 'operacao.mjs'), 'webArquivosSha256': module.inventory(folder / 'web')}))
        (self.release / 'auxiliar.mjs').write_text('auxiliar anterior')
        (self.root / 'configuracao').mkdir()
        self.configuration = {'modo': 'operacao', 'autoridade': 'vps', 'enviosHabilitados': True}
        (self.root / 'configuracao/operacao.json').write_text(json.dumps(self.configuration))
        (self.root / 'compose.operacao.yml').write_text('compose ficticio')
        self.previous = module.sha(self.release / 'release.json')
        self.state = {'Id': 'container-ficticio', 'State': {'Running': True, 'Health': {'Status': 'healthy'}}, 'Config': {'Env': ['ATENDIMENTO_ENVIO_HABILITADO=true', 'ATENDIMENTO_AUTORIDADE_ENVIO=vps']}, 'Mounts': [{'Destination': '/release', 'Source': str(self.release), 'RW': False}]}

    def execute(self, apply=False, previous=None):
        args = ['publicar', '--raiz-remota', str(self.root), '--raiz-checkpoint', str(self.checkpoint_root), '--lock-drive', str(self.backup_locks[0]), '--lock-checkpoint', str(self.backup_locks[1]), '--candidata', str(self.candidate), '--manifesto-anterior', previous or self.previous, '--commit', self.commit] + (['--aplicar'] if apply else [])
        with patch.object(sys, 'argv', args), patch.object(module, 'inspect', return_value=self.state), contextlib.redirect_stdout(io.StringIO()):
            module.main()

    def test_verificacao_nao_muda_codigo_configuracao_ou_dados(self):
        before = module.inventory(self.root)
        with patch.object(module, 'run', side_effect=AssertionError('comando externo inesperado')):
            self.execute()
        self.assertEqual(module.inventory(self.root), before)

    def test_alvos_privados_explicitos_sem_fallback_operacional(self):
        empty = types.SimpleNamespace(raiz_remota=None, raiz_checkpoint=None, lock_drive=None, lock_checkpoint=None)
        with self.assertRaisesRegex(RuntimeError, 'RAIZ_PRIVADA_OBRIGATORIA'):
            module.publication_targets(empty, {})
        args = types.SimpleNamespace(raiz_remota=str(self.root), raiz_checkpoint=str(self.checkpoint_root), lock_drive=None, lock_checkpoint=None)
        with self.assertRaisesRegex(RuntimeError, 'LOCK_PRIVADO_OBRIGATORIO'):
            module.publication_targets(args, {})
        environment = {'ATENDIMENTO_RAIZ_REMOTA_OPERACAO': str(self.root), 'ATENDIMENTO_RAIZ_CHECKPOINT_OPERACAO_R2': str(self.checkpoint_root), 'ATENDIMENTO_PUBLICACAO_LOCK_DRIVE': str(self.backup_locks[0]), 'ATENDIMENTO_PUBLICACAO_LOCK_CHECKPOINT': str(self.backup_locks[1])}
        self.assertEqual(module.publication_targets(empty, environment), (self.root, self.backup_locks))
        args = types.SimpleNamespace(raiz_remota=str(self.root), raiz_checkpoint=str(self.checkpoint_root), lock_drive=str(self.backup_locks[0]), lock_checkpoint=str(self.backup_locks[0]))
        with self.assertRaisesRegex(RuntimeError, 'LOCK_PRIVADO_DIVERGENTE'):
            module.publication_targets(args, {})
        args.lock_checkpoint = str(self.root / 'publicacao.lock')
        with self.assertRaisesRegex(RuntimeError, 'LOCK_PRIVADO_DIVERGENTE'):
            module.publication_targets(args, {})
        for value in ['relativo', str(self.root) + '\n', str(self.root / '..' / 'fora')]:
            args.raiz_remota = value
            with self.assertRaisesRegex(RuntimeError, 'RAIZ_PRIVADA_OBRIGATORIA'):
                module.publication_targets(args, {})

    def test_alias_divergente_do_checkpoint_recusa_antes_de_ler_candidata_ou_operar(self):
        args = ['publicar', '--raiz-remota', str(self.root), '--raiz-checkpoint', str(self.checkpoint_root), '--lock-drive', str(self.backup_locks[0]), '--lock-checkpoint', str(self.root / 'outro-checkpoint' / 'exclusao.lock'), '--candidata', str(self.candidate), '--manifesto-anterior', self.previous, '--commit', self.commit]
        with patch.object(sys, 'argv', args), patch.object(module, 'run') as command, patch.object(module, 'inspect') as remote, patch.object(Path, 'read_text') as read:
            with self.assertRaisesRegex(RuntimeError, 'LOCK_PRIVADO_DIVERGENTE'):
                module.main()
            command.assert_not_called()
            remote.assert_not_called()
            read.assert_not_called()

    def test_deriva_lock_do_checkpoint_sem_alias(self):
        args = types.SimpleNamespace(raiz_remota=str(self.root), raiz_checkpoint=str(self.checkpoint_root), lock_drive=str(self.backup_locks[0]), lock_checkpoint=None)
        self.assertEqual(module.publication_targets(args, {}), (self.root, self.backup_locks))

    def test_main_sem_alvo_recusa_antes_de_comandos_ou_leitura_privada(self):
        args = ['publicar', '--candidata', str(self.candidate), '--manifesto-anterior', self.previous, '--commit', self.commit]
        before = module.inventory(self.root)
        with patch.object(sys, 'argv', args), patch.dict(module.os.environ, {}, clear=True), patch.object(module, 'run', side_effect=AssertionError('comando externo inesperado')):
            with self.assertRaisesRegex(RuntimeError, 'RAIZ_PRIVADA_OBRIGATORIA'):
                module.main()
        self.assertEqual(module.inventory(self.root), before)

    def test_recusa_envio_desarmado_em_operacao_vps_antes_da_troca(self):
        environments = [
            ['ATENDIMENTO_ENVIO_HABILITADO=false', 'ATENDIMENTO_AUTORIDADE_ENVIO=origem'],
            ['ATENDIMENTO_ENVIO_HABILITADO=false', 'ATENDIMENTO_AUTORIDADE_ENVIO=vps'],
            ['ATENDIMENTO_ENVIO_HABILITADO=true', 'ATENDIMENTO_AUTORIDADE_ENVIO=origem'],
            ['ATENDIMENTO_ENVIO_HABILITADO=true'],
            ['ATENDIMENTO_AUTORIDADE_ENVIO=vps'],
            ['ATENDIMENTO_ENVIO_HABILITADO=true', 'ATENDIMENTO_ENVIO_HABILITADO=false', 'ATENDIMENTO_AUTORIDADE_ENVIO=vps'],
        ]
        before = module.inventory(self.root)
        for apply in [False, True]:
            for environment in environments:
                with self.subTest(apply=apply, environment=environment):
                    self.state['Config']['Env'] = environment
                    with patch.object(module, 'run', side_effect=AssertionError('comando externo inesperado')):
                        with self.assertRaisesRegex(RuntimeError, 'ENVIO_FLAGS_DIVERGENTES'):
                            self.execute(apply)
                    self.assertEqual(module.inventory(self.root), before)

    def test_permite_modos_legitimos_sem_envio_vps(self):
        self.state['Config']['Env'] = ['ATENDIMENTO_ENVIO_HABILITADO=false', 'ATENDIMENTO_AUTORIDADE_ENVIO=origem']
        configurations = [
            {**self.configuration, 'modo': 'homologacao'},
            {**self.configuration, 'modo': 'receber'},
            {**self.configuration, 'autoridade': 'origem'},
            {**self.configuration, 'autoridade': 'nenhuma'},
            {**self.configuration, 'enviosHabilitados': False},
        ]
        for configuration in configurations:
            with self.subTest(configuration=configuration):
                (self.root / 'configuracao/operacao.json').write_text(json.dumps(configuration))
                before = module.inventory(self.root)
                with patch.object(module, 'run', side_effect=AssertionError('comando externo inesperado')):
                    self.execute()
                self.assertEqual(module.inventory(self.root), before)

    def test_recusa_repo_divergente_antes_de_qualquer_operacao(self):
        manifest = json.loads((self.candidate / 'release.json').read_text())
        manifest['repositorioOrigem'] = 'https://github.com/exemplo/outro'
        (self.candidate / 'release.json').write_text(json.dumps(manifest))
        with self.assertRaisesRegex(RuntimeError, 'ORIGEM_INVALIDA'):
            self.execute(True)
        self.assertFalse((self.root / 'publicacao.lock').exists())

    def test_publicacao_do_repositorio_publico_preserva_origem_efetiva(self):
        repository = 'https://github.com/allanabrunhosa-cmyk/atendimento-grazing-publico'
        manifest = json.loads((self.candidate / 'release.json').read_text())
        manifest['repositorioOrigem'] = repository
        (self.candidate / 'release.json').write_text(json.dumps(manifest))
        with patch.object(module, 'run', return_value=''), patch.object(module, 'wait_health', return_value=self.state):
            self.execute(True)
        self.assertEqual(json.loads((self.release / 'release.json').read_text())['repositorioOrigem'], repository)
        self.assertEqual(json.loads((self.root / 'publicacao-origem.json').read_text())['repositorio'], repository)
        self.assertEqual(json.loads((self.candidate / 'publicacao.json').read_text())['repositorio'], repository)

    def test_recusa_release_paralela_e_arquivo_web_extra(self):
        with self.assertRaisesRegex(RuntimeError, 'PUBLICACAO_PARALELA'):
            self.execute(True, '2' * 64)
        (self.candidate / 'web/extra.js').write_text('nao declarado')
        with self.assertRaisesRegex(RuntimeError, 'WEB_DIVERGENTE'):
            self.execute(True)

    def test_publicacao_preserva_auxiliares_configuracao_e_nao_executa_sql(self):
        config = (self.root / 'configuracao/operacao.json').read_bytes()
        with patch.object(module, 'run', return_value='') as run, patch.object(module, 'wait_health', return_value=self.state):
            self.execute(True)
        self.assertEqual(run.call_args_list[0].args[0], ['docker', 'restart', '--time', '30', module.APP])
        self.assertEqual(run.call_count, 1)
        self.assertEqual((self.release / 'auxiliar.mjs').read_text(), 'auxiliar anterior')
        self.assertEqual((self.root / 'configuracao/operacao.json').read_bytes(), config)
        self.assertTrue((self.root / 'releases-preservadas' / ('repositorio-' + self.commit)).is_dir())
        self.assertEqual(json.loads((self.root / 'publicacao-origem.json').read_text())['repositorio'], module.REPOSITORY)

    def test_falha_de_saude_retorna_somente_codigo(self):
        before = module.inventory(self.release)
        config = (self.root / 'configuracao/operacao.json').read_bytes()
        with patch.object(module, 'run', return_value='') as run, patch.object(module, 'wait_health', side_effect=[RuntimeError('SAUDE_FALHOU'), self.state]):
            with self.assertRaisesRegex(RuntimeError, 'SAUDE_FALHOU'):
                self.execute(True)
        self.assertEqual(module.inventory(self.release), before)
        self.assertEqual((self.root / 'configuracao/operacao.json').read_bytes(), config)
        self.assertFalse((self.root / 'publicacao-origem.json').exists())
        self.assertEqual(run.call_count, 2)
        self.assertTrue(all(call.args[0][1] == 'restart' for call in run.call_args_list))

    def test_flags_divergentes_apos_restart_rejeitam_publicacao_e_retornam_codigo(self):
        before = module.inventory(self.release)
        config = (self.root / 'configuracao/operacao.json').read_bytes()
        compose = (self.root / 'compose.operacao.yml').read_bytes()
        divergent = {**self.state, 'Config': {'Env': ['ATENDIMENTO_ENVIO_HABILITADO=false', 'ATENDIMENTO_AUTORIDADE_ENVIO=origem']}}
        with patch.object(module, 'run', return_value='') as run, patch.object(module, 'wait_health', side_effect=[divergent, self.state]):
            with self.assertRaisesRegex(RuntimeError, 'ENVIO_FLAGS_DIVERGENTES'):
                self.execute(True)
        self.assertEqual(module.inventory(self.release), before)
        self.assertEqual((self.root / 'configuracao/operacao.json').read_bytes(), config)
        self.assertEqual((self.root / 'compose.operacao.yml').read_bytes(), compose)
        self.assertFalse((self.root / 'publicacao-origem.json').exists())
        self.assertEqual(run.call_count, 2)
        self.assertTrue(all(call.args[0] == ['docker', 'restart', '--time', '30', module.APP] for call in run.call_args_list))

    def test_backup_em_curso_impede_troca_de_codigo(self):
        before = module.inventory(self.release)
        with patch.object(module.fcntl, 'flock', side_effect=[None, BlockingIOError('backup ficticio em curso')]):
            with self.assertRaises(BlockingIOError):
                self.execute(True)
        self.assertEqual(module.inventory(self.release), before)
        self.assertFalse((self.root / 'publicacao-origem.json').exists())

if __name__ == '__main__':
    unittest.main()
