"""Guards locais da recuperação, sem Docker, banco ou dados operacionais."""
import importlib.util
import pathlib
import tempfile
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('recuperacao', ROOT / 'scripts/atendimento/validar-recuperacao-nativa.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ParametrosRecuperacao(unittest.TestCase):
    def test_nao_le_disco_ou_executa_comando_sem_base_explicita(self):
        for args in ([], ['--revalidar'], ['--r2'], ['--r2', '--revalidar']):
            with self.subTest(args=args), patch.object(MODULE.os, 'environ', {}), patch.object(MODULE.sys, 'argv', ['validar.py', *args]), patch.object(MODULE.subprocess, 'run') as command, patch.object(MODULE.pathlib.Path, 'resolve') as read:
                with self.assertRaisesRegex(SystemExit, '^RECUPERACAO_RAIZ_PRIVADA_OBRIGATORIA$'):
                    MODULE.main()
                command.assert_not_called()
                read.assert_not_called()

    def test_modos_usam_bases_independentes(self):
        with tempfile.TemporaryDirectory(prefix='recuperacao-fixture-') as directory:
            root = pathlib.Path(directory).resolve()
            original = root / 'original'
            r2 = root / 'r2'
            original.mkdir()
            r2.mkdir()
            env = {'ATENDIMENTO_RAIZ_RECUPERACAO': str(original), 'ATENDIMENTO_RAIZ_RECUPERACAO_R2': str(r2)}
            self.assertEqual(MODULE.raiz_privada(environment=env), original)
            self.assertEqual(MODULE.raiz_privada(True, env), r2)
            with self.assertRaises(SystemExit):
                MODULE.raiz_privada(True, {'ATENDIMENTO_RAIZ_RECUPERACAO': str(original)})

    def test_recusa_travessia_relativo_e_diretorio_raiz_antes_de_acesso(self):
        for value in ('cofre', '/', '/fixture/../cofre', '/fixture/./cofre', '/fixture//cofre', '/fixture/cofre/', '/fixture/cofre\n'):
            with self.subTest(value=value), patch.object(MODULE.pathlib.Path, 'resolve') as read:
                with self.assertRaises(SystemExit):
                    MODULE.raiz_privada(environment={'ATENDIMENTO_RAIZ_RECUPERACAO': value})
                read.assert_not_called()


if __name__ == '__main__':
    unittest.main()
