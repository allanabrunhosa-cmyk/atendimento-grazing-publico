"""Recupera os bytes nas chaves originais, sem publicar buckets/serviços."""
import hashlib
import json
import os
import pathlib
import re
import sys
import uuid
from datetime import datetime, timezone

BUCKETS = {'whatsapp-media', 'audio-messages'}


def hashes(path):
    if path.is_symlink() or not path.is_file():
        raise ValueError('Arquivo físico inválido.')
    sha = hashlib.sha256()
    md5 = hashlib.md5()  # Compatibilidade com ETag; SHA-256 é o hash do backup.
    size = 0
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            sha.update(chunk)
            md5.update(chunk)
            size += len(chunk)
    digest = md5.digest()
    return size, sha.hexdigest(), digest.hex(), hashlib.md5(digest).hexdigest() + '-1'


def chave(obj):
    name = obj.get('name')
    bucket = obj.get('bucket')
    if bucket not in BUCKETS or not isinstance(name, str) or not name or len(name) > 2048:
        raise ValueError('Objeto inválido.')
    if '\x00' in name or '\\' in name or any(p in ('', '.', '..') for p in name.split('/')):
        raise ValueError('Caminho inválido.')
    return bucket, name


def recuperar(root, snapshots):
    if root.is_symlink() or not root.is_absolute() or any(p.is_symlink() for p in root.parents):
        raise ValueError('Atalho/raiz recusado.')
    root = root.resolve(strict=True)
    for ancestor in [root, *root.parents]:
        if (ancestor / '.git').exists():
            raise ValueError('Recuperação dentro de Git recusada.')
    for subdir in ('midia', 'banco'):
        if (root / subdir).is_symlink() or not (root / subdir).is_dir():
            raise ValueError('Diretório privado inválido.')
    records = []
    for name in ('manifesto-inicial.jsonl', 'manifesto-atual.jsonl'):
        file = root / 'midia' / name
        if file.is_symlink():
            raise ValueError('Manifesto inválido.')
        if file.exists():
            records += [json.loads(line) for line in file.read_text(encoding='utf-8').splitlines() if line]
    index = {}
    for row in records:
        bucket, name = chave(row)
        tag = row.get('metadata', {}).get('eTag')
        index[(bucket, name, row.get('id'), tag, row.get('bytes'))] = row
    http_proofs = {}
    for file in (root / 'midia').glob('conferencia-etags-*.json'):
        if file.is_symlink():
            raise ValueError('Comprovante HTTP inválido.')
        for proof in json.loads(file.read_text(encoding='utf-8'))['provas']:
            key = (*chave(proof), proof.get('id'), proof.get('etagEsperado'), proof.get('bytes'))
            if proof.get('coincide') and proof.get('etagRecebido') == proof.get('etagEsperado'):
                http_proofs[key] = proof.get('sha256')
    recovery = root / ('arquivos-restaurados-' + str(uuid.uuid4()))
    recovery.mkdir(mode=0o700)
    cache = {}
    results = []
    for position, snapshot in enumerate(snapshots):
        seen = set()
        total = 0
        simple = 0
        multipart = 0
        multipart_http = 0
        for obj in snapshot['objetos']:
            bucket, name = chave(obj)
            if (bucket, name) in seen:
                raise ValueError('Chave duplicada no snapshot.')
            seen.add((bucket, name))
            size = obj['metadata']['size']
            if not isinstance(size, int) or size < 0:
                raise ValueError('Tamanho inválido.')
            tag = obj['metadata']['eTag']
            row = index.get((bucket, name, obj['id'], tag, size))
            if not row or not row.get('tamanhoCoincide'):
                raise ValueError('Versão física não preservada.')
            filename = row.get('arquivo', '')
            if not re.fullmatch(r'[a-f0-9]{64}\.bin', filename) or filename != row['sha256'] + '.bin':
                raise ValueError('Hash/caminho de manifesto inválido.')
            source = root / 'midia' / filename
            if filename not in cache:
                cache[filename] = hashes(source)
            actual_size, sha, md5, md5_one_part = cache[filename]
            if actual_size != size or sha != row['sha256']:
                raise ValueError('Arquivo físico corrompido.')
            # Apenas formatos efetivamente verificáveis; outros não são aceitos.
            if tag == '"' + md5 + '"':
                simple += 1
            elif tag == '"' + md5_one_part + '"':
                multipart += 1
            elif re.fullmatch(r'"[a-f0-9]{32}-[1-9][0-9]{0,4}"', tag) and http_proofs.get((bucket, name, obj['id'], tag, size)) == sha:
                # Multipart de várias partes: sem limites de parte não recalcular MD5.
                # GET nativo independente comprovou ETag e SHA dos bytes preservados.
                multipart_http += 1
            else:
                raise ValueError('Conteúdo não coincide com ETag da origem.')
            target = recovery / ('snapshot' if position == 0 else 'atual') / bucket / name
            if not target.resolve().is_relative_to(recovery):
                raise ValueError('Caminho fora da recuperação.')
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            os.link(source, target)
            # Ler os bytes pela chave restaurada, não apenas os metadados/inode.
            restored_size, restored_sha, _, _ = hashes(target)
            if restored_size != size or restored_sha != sha:
                raise ValueError('Recuperação física divergente.')
            total += size
        results.append({'objetos': len(seen), 'bytesLogicos': total,
                        'etagMd5Verificado': simple, 'etagMultipartUmaParteVerificado': multipart,
                        'etagMultipartHttpSha256Verificado': multipart_http})
    proof = {'time': datetime.now(timezone.utc).isoformat(), 'snapshots': results,
             'arquivosFisicosDistintos': len(cache),
             'bytesFisicosDistintos': sum(value[0] for value in cache.values()),
             'recuperacaoPorChaveOriginal': True, 'nenhumServicoIniciado': True,
             'capturaInstalada': False, 'continuidadeMigracaoComprovada': False}
    with (recovery / 'recuperacao-fisica.json').open('x', encoding='utf-8') as output:
        json.dump(proof, output)
        output.flush()
        os.fsync(output.fileno())
    return proof, recovery


def main():
    os.umask(0o077)
    if len(sys.argv) != 3 or not re.fullmatch(r'storage-live-[a-f0-9-]{36}\.json', sys.argv[2]):
        raise ValueError('Argumentos inválidos.')
    raw_root = pathlib.Path(sys.argv[1])
    if raw_root.is_symlink() or not raw_root.is_absolute():
        raise ValueError('Raiz inválida.')
    for parent in [raw_root, *raw_root.parents]:
        if parent.is_symlink():
            raise ValueError('Atalho recusado.')
    snapshots = []
    for filename in ('storage-export-privado.json', sys.argv[2]):
        file = raw_root / 'banco' / filename
        if file.is_symlink():
            raise ValueError('Atalho recusado.')
        snapshots.append(json.loads(file.read_text(encoding='utf-8')))
    proof, directory = recuperar(raw_root, snapshots)
    print(json.dumps({**proof, 'diretorioProva': directory.name}))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('RECUPERACAO_FISICA_INCOMPLETA: conferir cópias privadas; não liberar captura.', file=sys.stderr)
        sys.exit(1)
