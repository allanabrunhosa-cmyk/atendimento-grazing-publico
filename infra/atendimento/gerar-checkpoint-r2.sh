#!/bin/sh
# Apenas banco de preparacao isolado e arquivos da Donatella. Nunca banco HUB.
set -eu
umask 077
validar_caminho_privado() {
 case "$1" in /*) ;; *) echo CAMINHO_PRIVADO_RECUSADO >&2; exit 1;; esac
 case "$1" in /|*[!A-Za-z0-9_./-]*|*//*|*/./*|*/../*|*/.|*/..|*/) echo CAMINHO_PRIVADO_RECUSADO >&2; exit 1;; esac
}
raiz=${ATENDIMENTO_RAIZ_CHECKPOINT_R2:?ATENDIMENTO_RAIZ_CHECKPOINT_R2_OBRIGATORIA}
config=${ATENDIMENTO_RAIZ_REMOTA_HOMOLOGACAO:?ATENDIMENTO_RAIZ_REMOTA_HOMOLOGACAO_OBRIGATORIA}
cofre=${ATENDIMENTO_CONFIG_CHECKPOINT_R2:?ATENDIMENTO_CONFIG_CHECKPOINT_R2_OBRIGATORIA}
release="$config/checkpoints-r2/release"
for p in "$raiz" "$config" "$cofre"; do validar_caminho_privado "$p"; done
mkdir -p "$raiz/entradas" "$raiz/historico"
chmod 700 "$raiz" "$raiz/entradas" "$raiz/historico"
[ "$(docker inspect grazing-donatella-homologacao-v2-banco --format '{{index .Config.Labels "grazing.finalidade"}}')" = preparacao-privada ]
# Reserva compartilhada com o HUB: falhar antes de criar outro dump, sem limpar
# volumes/copias. Crescimento acima da capacidade requer nova estimativa.
livre_kib=$(df -Pk "$raiz" | awk 'NR==2 {print $4}')
test "$livre_kib" -ge 10485760 || { echo CHECKPOINT_ESPACO_REQUER_REVISAO >&2; exit 1; }
banco_bytes=$(docker exec grazing-donatella-homologacao-v2-banco psql -X -qAt -v ON_ERROR_STOP=1 -U donatella_homologacao_admin -d donatella_preparacao -c 'SELECT pg_database_size(current_database())')
test "$banco_bytes" -le 1073741824 || { echo CHECKPOINT_CAPACIDADE_REQUER_REVISAO >&2; exit 1; }
if [ ! -f "$raiz/pendente.json" ]; then
 coletor_config=$(docker inspect grazing-donatella-coletor-v2 --format '{{range .Mounts}}{{if eq .Destination "/run/secrets/coletor.json"}}{{.Source}}{{end}}{{end}}')
 release_atual=$(docker inspect grazing-donatella-coletor-v2 --format '{{range .Mounts}}{{if eq .Destination "/release"}}{{.Source}}{{end}}{{end}}')
 compose_atual=$(docker inspect grazing-donatella-coletor-v2 --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}')
 consulta_release=$(docker inspect grazing-donatella-consulta-v2 --format '{{range .Mounts}}{{if eq .Destination "/release"}}{{.Source}}{{end}}{{end}}')
 consulta_compose=$(docker inspect grazing-donatella-consulta-v2 --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}')
 # Somente filhos imediatos da raiz conhecida; recusar travessia, links e listas
 # de compose. O reader pode usar release/compose distintas do coletor.
 python3 - "$config" "$coletor_config" "$release_atual" "$compose_atual" "$consulta_release" "$consulta_compose" <<'PY'
import sys,re
from pathlib import Path
base=Path(sys.argv[1])
contratos=[(base/'consulta',r'coletor(?:-[a-z0-9]+)*\.json',False),(base,r'release(?:-[a-z0-9]+)*',True),(base,r'compose\.consulta(?:-[a-z0-9]+)*\.yml',False),(base,r'release(?:-[a-z0-9]+)*',True),(base,r'compose\.consulta(?:-[a-z0-9]+)*\.yml',False)]
try:
 for valor,(pai,padrao,diretorio) in zip(sys.argv[2:],contratos,strict=True):
  p=Path(valor)
  if str(p)!=valor or p.parent!=pai or not re.fullmatch(padrao,p.name) or p.resolve(strict=True)!=p or p.is_symlink() or (not p.is_dir() if diretorio else not p.is_file()):raise ValueError()
 for nome in ['consulta.json','conta-hub.json','media-index.json']:
  p=base/'consulta'/nome
  if p.resolve(strict=True)!=p or p.is_symlink() or not p.is_file():raise ValueError()
except (ValueError,OSError,RuntimeError):raise SystemExit('CHECKPOINT_COMPONENTE_RECUSADO')
PY
 python3 - "$raiz" <<'PY'
import json,os,sys,uuid,datetime
from pathlib import Path
r=Path(sys.argv[1])
p={'versao':1,'id':str(uuid.uuid4()),'criadoEm':datetime.datetime.now(datetime.timezone.utc).isoformat()}
with (r/'pendente.json').open('x') as f:json.dump(p,f);f.flush();os.fsync(f.fileno())
PY
 id=$(python3 -c 'import json,sys,uuid; p=json.load(open(sys.argv[1])); print(str(uuid.UUID(p["id"])))' "$raiz/pendente.json")
 entrada="$raiz/entradas/$id"
 mkdir -m 700 "$entrada" "$entrada/banco" "$entrada/configuracao" "$entrada/release"
 cp -a "$coletor_config" "$entrada/configuracao/coletor.json"
 cp -a "$config/consulta/consulta.json" "$entrada/configuracao/consulta.json"
 cp -a "$config/consulta/conta-hub.json" "$entrada/configuracao/conta-hub.json"
 cp -a "$config/consulta/media-index.json" "$entrada/configuracao/media-index.json"
 cp -a "$compose_atual" "$entrada/configuracao/compose.yml"
 cp -a "$release_atual/." "$entrada/release/"
 # O protocolo existente percorre release/ recursivamente e cifra cada arquivo.
 # Preservar o reader real em pasta própria evita substituir o runtime do coletor.
 test ! -e "$entrada/release/consulta-isolada"
 mkdir -m 700 "$entrada/release/consulta-isolada"
 cp -a "$consulta_release/." "$entrada/release/consulta-isolada/"
 cp -a "$consulta_compose" "$entrada/configuracao/compose-consulta.yml"
 python3 - "$entrada/configuracao/componentes.json" "$release_atual" "$compose_atual" "$consulta_release" "$consulta_compose" <<'PY'
import json,sys,os
p={'versao':1,'coletor':{'release':'novos/release','compose':'novos/configuracao/compose.yml','origemRelease':sys.argv[2],'origemCompose':sys.argv[3]},'consulta':{'release':'novos/release/consulta-isolada','compose':'novos/configuracao/compose-consulta.yml','origemRelease':sys.argv[4],'origemCompose':sys.argv[5]}}
with open(sys.argv[1],'x') as f:json.dump(p,f);f.flush();os.fsync(f.fileno())
PY
 # pg_dump usa snapshot consistente; so o historico da preparacao e copiado.
 docker exec grazing-donatella-homologacao-v2-banco pg_dump -U donatella_homologacao_admin -d donatella_preparacao -Fc > "$raiz/historico/$id-preparacao.backup" 2> "$raiz/historico/$id-dump.log"
 test -s "$raiz/historico/$id-preparacao.backup"
 # Partes limitadas pelo protocolo, com hash integral para reconstituir o dump.
 python3 - "$raiz/historico/$id-preparacao.backup" "$entrada/banco" <<'PY'
import json,hashlib,sys,os
from pathlib import Path
origem=Path(sys.argv[1]);destino=Path(sys.argv[2]);total=0;inteiro=hashlib.sha256();partes=[]
with origem.open('rb') as f:
 while True:
  b=f.read(32*1024*1024)
  if not b:break
  nome='preparacao.backup.part-'+str(len(partes)).zfill(5)
  with (destino/nome).open('xb') as o:o.write(b);o.flush();os.fsync(o.fileno())
  inteiro.update(b);total+=len(b);partes.append({'nome':nome,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()})
with (destino/'preparacao.indice.json').open('x') as f:
 json.dump({'versao':1,'arquivo':'preparacao.backup','bytes':total,'sha256':inteiro.hexdigest(),'partes':partes},f);f.flush();os.fsync(f.fileno())
PY
 cp "$raiz/pendente.json" "$entrada/congelado.json"
else
 id=$(python3 -c 'import json,sys,uuid; p=json.load(open(sys.argv[1])); print(str(uuid.UUID(p["id"])))' "$raiz/pendente.json")
 entrada="$raiz/entradas/$id"
 # Nenhuma substituicao silenciosa de dump/fonte da mesma intencao.
 test -s "$entrada/congelado.json" || { echo CHECKPOINT_SNAPSHOT_INCOMPLETO >&2; exit 1; }
fi
docker run --rm --name grazing-donatella-checkpoint-r2-v2 --label grazing.finalidade=checkpoint-r2-v2 --read-only --cap-drop ALL --security-opt no-new-privileges --memory 768m --cpus 0.5 --pids-limit 64 --network grazing-donatella-coletor-v2-saida --mount "type=bind,src=$release,dst=/release,readonly" --mount "type=bind,src=$cofre,dst=/run/secrets/checkpoint.json,readonly" --mount "type=bind,src=$entrada,dst=/entrada,readonly" --mount type=volume,src=grazing-donatella-coletor-v2-estado,dst=/incrementais,readonly --mount type=volume,src=grazing-donatella-checkpoints-v2-estado,dst=/estado --tmpfs /tmp:rw,noexec,nosuid,size=16m grazing-donatella-consulta-v2:20261008-a /release/gerar-checkpoint-r2.mjs
mv "$raiz/pendente.json" "$raiz/historico/$id-concluido.json"
