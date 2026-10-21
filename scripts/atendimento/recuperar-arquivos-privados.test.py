import importlib.util
import hashlib
import json
import pathlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('recovery', pathlib.Path(__file__).with_name('recuperar-arquivos-privados.py'))
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)


class RecuperacaoArquivos(unittest.TestCase):
    def fixture(self, root, data=b'arquivo ficticio', tag_multipart=False, name='pasta/arquivo.bin'):
        sha = hashlib.sha256(data).hexdigest()
        md5 = hashlib.md5(data).digest()
        tag = hashlib.md5(md5).hexdigest() + '-1' if tag_multipart else md5.hex()
        obj = {'id': 'id-ficticio', 'bucket': 'whatsapp-media', 'name': name,
               'metadata': {'size': len(data), 'eTag': '"' + tag + '"'}}
        (root / 'midia' / (sha + '.bin')).write_bytes(data)
        row = {**obj, 'bytes': len(data), 'sha256': sha, 'arquivo': sha + '.bin', 'tamanhoCoincide': True}
        with (root / 'midia' / 'manifesto-inicial.jsonl').open('a', encoding='utf-8') as output:
            output.write(json.dumps(row) + '\n')
        return {'objetos': [obj]}

    def temp(self):
        directory = tempfile.TemporaryDirectory(prefix='donatella-recuperacao-ficticia-')
        self.addCleanup(directory.cleanup)
        root = pathlib.Path(directory.name)
        (root / 'midia').mkdir()
        (root / 'banco').mkdir()
        return root

    def test_recupera_versoes_e_bytes_na_mesma_chave_sem_sobrescrever(self):
        root = self.temp()
        old = self.fixture(root)
        new = self.fixture(root, b'nova versao ficticia', tag_multipart=True)
        proof, path = recovery.recuperar(root, [old, new])
        self.assertEqual((path / 'snapshot/whatsapp-media/pasta/arquivo.bin').read_bytes(), b'arquivo ficticio')
        self.assertEqual((path / 'atual/whatsapp-media/pasta/arquivo.bin').read_bytes(), b'nova versao ficticia')
        self.assertEqual(proof['snapshots'][1]['etagMultipartUmaParteVerificado'], 1)
        self.assertTrue((path / 'recuperacao-fisica.json').is_file())

    def test_corrupcao_e_etag_divergente_bloqueiam_comprovante(self):
        root = self.temp()
        snapshot = self.fixture(root)
        file = next((root / 'midia').glob('*.bin'))
        file.write_bytes(b'corrompido')
        with self.assertRaises(ValueError):
            recovery.recuperar(root, [snapshot])
        self.assertFalse(list(root.glob('arquivos-restaurados-*/recuperacao-fisica.json')))
        file.write_bytes(b'arquivo ficticio')
        row = json.loads((root / 'midia/manifesto-inicial.jsonl').read_text())
        row['metadata']['eTag'] = '"' + '0' * 32 + '"'
        snapshot['objetos'][0]['metadata']['eTag'] = row['metadata']['eTag']
        (root / 'midia/manifesto-inicial.jsonl').write_text(json.dumps(row) + '\n')
        with self.assertRaises(ValueError):
            recovery.recuperar(root, [snapshot])
        self.assertFalse(list(root.glob('arquivos-restaurados-*/recuperacao-fisica.json')))

    def test_caminhos_escapando_e_atalhos_recusados(self):
        for name in ('../fora', '/fora', 'a//b', 'a/../b', '..\\fora'):
            with self.assertRaises(ValueError):
                recovery.chave({'bucket': 'whatsapp-media', 'name': name})
        root = self.temp()
        snapshot = self.fixture(root)
        file = next((root / 'midia').glob('*.bin'))
        if hasattr(pathlib.Path, 'symlink_to'):
            file.unlink()
            try:
                file.symlink_to(root / 'midia/manifesto-inicial.jsonl')
            except OSError:
                return  # Windows sem privilégio; caminho também é conferido no runtime Linux.
            with self.assertRaises(ValueError):
                recovery.recuperar(root, [snapshot])

    def test_etag_multipart_exige_get_independente_com_mesmos_bytes(self):
        root = self.temp()
        snapshot = self.fixture(root)
        row = json.loads((root / 'midia/manifesto-inicial.jsonl').read_text())
        tag = '"' + '1' * 32 + '-2"'
        row['metadata']['eTag'] = tag
        snapshot['objetos'][0]['metadata']['eTag'] = tag
        (root / 'midia/manifesto-inicial.jsonl').write_text(json.dumps(row) + '\n')
        proof = {**snapshot['objetos'][0], 'etagEsperado': tag, 'etagRecebido': tag,
                 'bytes': row['bytes'], 'sha256': '0' * 64, 'coincide': True}
        file = root / 'midia/conferencia-etags-ficticia.json'
        file.write_text(json.dumps({'provas': [proof]}))
        with self.assertRaises(ValueError):
            recovery.recuperar(root, [snapshot])
        proof['sha256'] = row['sha256']
        file.write_text(json.dumps({'provas': [proof]}))
        result, _ = recovery.recuperar(root, [snapshot])
        self.assertEqual(result['snapshots'][0]['etagMultipartHttpSha256Verificado'], 1)


if __name__ == '__main__':
    unittest.main()
