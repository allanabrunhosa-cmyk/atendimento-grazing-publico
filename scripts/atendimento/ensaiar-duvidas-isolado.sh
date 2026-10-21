#!/bin/sh
# Somente pacote ficticio enviado para uma pasta NOVA de ensaio.
set -eu
pacote="${1:?PASTA_ENSAIO_EXIGIDA}"
case "$pacote" in /var/tmp/donatella-duvidas-ensaio-*) ;; *) echo PASTA_ENSAIO_RECUSADA; exit 1;; esac
identificador="${pacote#/var/tmp/donatella-duvidas-ensaio-}"
case "$identificador" in ''|*[!a-f0-9]*) echo PASTA_ENSAIO_RECUSADA; exit 1;; esac
test "${#identificador}" -eq 32 || { echo PASTA_ENSAIO_RECUSADA; exit 1; }
test -f "$pacote/duvidas-banco.mjs"
test -f "$pacote/019-duvidas-aprendizagem-destino.sql"
docker image inspect postgres:17-bookworm >/dev/null
docker image inspect grazing-donatella-consulta-v2:20261008-a >/dev/null
container=donatella-ensaio-duvidas-v2
rede=donatella-ensaio-duvidas-v2-rede
if docker container inspect "$container" >/dev/null 2>&1 || docker network inspect "$rede" >/dev/null 2>&1; then echo ENSAIO_JA_EXISTE_NAO_ALTERADO; exit 1; fi
docker network create --internal "$rede" >/dev/null
trap 'docker rm -f "$container" >/dev/null 2>&1 || true; docker network rm "$rede" >/dev/null 2>&1 || true' EXIT
# Sem mounts de producao, secrets ou portas publicadas; memoria limitada. Dados
# ficticios ficam SOMENTE na subpasta nova deste pacote de ensaio.
# tmpfs nao seria prova de reinicio: seu conteudo some ao parar o container.
mkdir -m 700 "$pacote/dados-ficticios"
docker run -d --name "$container" --network "$rede" --memory 256m --cpus 1 --mount type=bind,src="$pacote/dados-ficticios",dst=/var/lib/postgresql/data -e POSTGRES_USER=fixture -e POSTGRES_DB=donatella_ensaio_duvidas -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17-bookworm >/dev/null
esperar_postgres() {
 # O servidor temporario de initdb nao escuta TCP. Somente o servidor final
 # pode liberar o ensaio, tanto na inicializacao quanto apos o reinicio.
 for i in $(seq 1 25); do
  if docker exec "$container" pg_isready -h 127.0.0.1 -U fixture -d donatella_ensaio_duvidas >/dev/null 2>&1; then return 0; fi
  sleep 1
 done
 echo POSTGRES_ENSAIO_NAO_PRONTO_APOS_25_TENTATIVAS >&2
 exit 1
}
esperar_postgres
docker exec -i "$container" psql -h 127.0.0.1 -v ON_ERROR_STOP=1 -U fixture -d donatella_ensaio_duvidas < "$pacote/019-duvidas-aprendizagem-destino.sql" >/dev/null
executar() {
 docker run --rm --network "$rede" --read-only --cap-drop ALL --security-opt no-new-privileges --memory 256m --cpus 1 -e DUVIDAS_BANCO_TESTE=postgresql://fixture@donatella-ensaio-duvidas-v2:5432/donatella_ensaio_duvidas --mount type=bind,src="$pacote",dst=/ensaio,readonly grazing-donatella-consulta-v2:20261008-a /ensaio/duvidas-banco.mjs "$@"
}
executar
# PostgreSQL reiniciado com a mesma pasta FICTICIA: testar recuperacao WAL, nao restaurar
# sobre bancos atuais nem confundir este ensaio com recuperacao a partir do R2.
docker restart "$container" >/dev/null
esperar_postgres
executar --retomada
