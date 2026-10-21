#!/bin/sh
# Somente recuperação real autorizada, em volume novo. Nunca usa o banco do HUB.
set -eu
umask 077
validar_caminho_privado() {
 case "$1" in /*) ;; *) echo CAMINHO_PRIVADO_RECUSADO >&2; exit 1;; esac
 case "$1" in /|*[!A-Za-z0-9_./-]*|*//*|*/./*|*/../*|*/.|*/..|*/) echo CAMINHO_PRIVADO_RECUSADO >&2; exit 1;; esac
}
raiz=${ATENDIMENTO_RAIZ_RECUPERACAO:-}
nome=grazing-donatella-recuperacao-v2-banco
volume=grazing-donatella-recuperacao-v2-dados
finalidade=donatella-recuperacao-v2
# Novo ensaio exclusivamente R2: nomes fixos distintos, sem reaproveitar o banco
# ou volume da recuperacao anterior. Os bytes devem vir da extracao R2 validada.
if test "${1:-}" = --r2; then
  raiz=${ATENDIMENTO_RAIZ_RECUPERACAO_R2:?ATENDIMENTO_RAIZ_RECUPERACAO_R2_OBRIGATORIA}
  validar_caminho_privado "$raiz"
  nome=grazing-donatella-recuperacao-r2-v2-banco
  volume=grazing-donatella-recuperacao-r2-v2-dados
  finalidade=donatella-recuperacao-r2-v2
  shift
  test -f "$raiz/prova-r2.json" && test ! -L "$raiz/prova-r2.json"
fi
: "${raiz:?ATENDIMENTO_RAIZ_RECUPERACAO_OBRIGATORIA}"
validar_caminho_privado "$raiz"
imagem=supabase/postgres@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00
test "$(id -u)" = 0
test -d "$raiz" && test ! -L "$raiz"
test "$(stat -c %a "$raiz")" = 700
test -f "$raiz/export.backup" && test ! -L "$raiz/export.backup"
test -f "$raiz/schema-completo.sql"
retomar_transacao=0
if test "${1:-}" = --retomar-transacao-revertida; then
  test ! -e "$raiz/restauracao.concluida"
  test "$(docker inspect "$nome" --format '{{.HostConfig.NetworkMode}}')" = none
  test "$(docker inspect "$nome" --format '{{range .Mounts}}{{if eq .Destination "/recuperacao"}}{{.Name}}{{end}}{{end}}')" = "$volume"
  test "$(docker volume inspect "$volume" --format '{{index .Labels "grazing.finalidade"}}')" = "$finalidade"
  test "$(docker exec "$nome" psql -X -qAt -h /tmp -U postgres -d postgres -c "SELECT count(*) FROM pg_namespace WHERE nspname NOT IN ('public','information_schema') AND nspname NOT LIKE 'pg_%'")" = 0
  sha256sum -c "$raiz/restauracao.sha256" > "$raiz/integridade-retomada-transacao.log"
  tentativa=$(date -u +%Y%m%dT%H%M%SZ)
  test ! -e "$raiz/restauracao-$tentativa.log"
  mv "$raiz/restauracao.log" "$raiz/restauracao-$tentativa.log"
  docker logs "$nome" > "$raiz/servidor-$tentativa.log" 2>&1
  docker stop "$nome" >/dev/null
  docker rm "$nome" >/dev/null
  retomar_transacao=1
elif docker container inspect "$nome" >/dev/null 2>&1; then
  echo 'Recuperação existente: interrompido sem alterar banco/volume.' >&2
  exit 1
fi
if test "$retomar_transacao" = 1; then
  :
elif test "${1:-}" = --retomar-volume-vazio; then
  # Exclusivamente falha anterior ao initdb; nunca reimporta banco existente.
  test -f "$raiz/restauracao.iniciada" && test ! -e "$raiz/initdb.log"
  test "$(docker volume inspect "$volume" --format '{{index .Labels "grazing.finalidade"}}')" = "$finalidade"
  sha256sum -c "$raiz/restauracao.sha256" > "$raiz/integridade-retomada.log"
else
  test -z "${1:-}" && test ! -e "$raiz/restauracao.iniciada"
  if docker volume inspect "$volume" >/dev/null 2>&1; then exit 1; fi
  # Marcador também bloqueia repetição após falha; investigar sem apagar prova.
  date -u +%FT%TZ > "$raiz/restauracao.iniciada"
  sha256sum "$raiz/export.backup" > "$raiz/restauracao.sha256"
  docker volume create --label "grazing.finalidade=$finalidade" "$volume" > "$raiz/volume.log"
fi
if test "$retomar_transacao" = 0; then
docker run --rm --network none --read-only --cap-drop ALL --cap-add CHOWN \
  --security-opt no-new-privileges --user 0:0 --entrypoint sh \
  --mount "type=volume,src=$volume,dst=/recuperacao" "$imagem" \
  -c 'set -e; test -z "$(ls -A /recuperacao)"; chown 0:0 /recuperacao; chmod 700 /recuperacao; chown 100:101 /recuperacao'
# Não usa entrypoint/migrations/configuração operacional da imagem Supabase.
docker run --rm --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --user 100:101 --memory 512m --cpus 1 \
  --mount "type=volume,src=$volume,dst=/recuperacao" --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --entrypoint initdb "$imagem" -D /recuperacao -U postgres \
  --auth-local=trust --auth-host=reject --encoding=UTF8 \
  > "$raiz/initdb.log" 2>&1
fi
docker run -d --name "$nome" --label "grazing.finalidade=$finalidade" \
  --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
  --user 100:101 --memory 1g --cpus 2 --pids-limit 128 --restart no \
  --mount "type=volume,src=$volume,dst=/recuperacao" \
  --tmpfs /tmp:rw,noexec,nosuid,size=128m \
  --entrypoint postgres "$imagem" -D /recuperacao \
  -c listen_addresses= -c unix_socket_directories=/tmp \
  -c shared_preload_libraries=pg_cron,pg_stat_statements,pg_net \
  -c max_worker_processes=0 -c max_parallel_workers=0 \
  -c max_parallel_workers_per_gather=0 -c max_parallel_maintenance_workers=0 \
  -c cron.database_name=postgres -c cron.launch_active_jobs=off \
  -c cron.enable_superuser_jobs=off -c cron.log_statement=off \
  -c session_preload_libraries= -c local_preload_libraries= \
  -c log_statement=none -c log_min_error_statement=panic -c log_error_verbosity=terse \
  -c shared_buffers=128MB -c max_connections=20 > "$raiz/container.log"
i=0
until docker exec "$nome" pg_isready -h /tmp -U postgres -d postgres >/dev/null 2>&1; do
  i=$((i + 1)); test "$i" -lt 30; sleep 1
done
# Native pg_dump não inclui CREATE ROLE/atributos globais. Nomes/owners/ACLs
# recuperados; papéis auxiliares NOLOGIN. supabase_admin precisa SUPERUSER somente
# nesta cópia isolada para receber a propriedade dos event triggers nativos.
if test "$retomar_transacao" = 0; then
docker exec -i "$nome" psql -X -q -v ON_ERROR_STOP=1 -h /tmp -U postgres -d postgres \
  > "$raiz/papeis.log" 2>&1 <<'SQL'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE dashboard_user NOLOGIN;
CREATE ROLE pgbouncer NOLOGIN;
CREATE ROLE sandbox_exec NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE ROLE supabase_admin NOLOGIN SUPERUSER;
CREATE ROLE supabase_auth_admin NOLOGIN;
CREATE ROLE supabase_functions_admin NOLOGIN;
CREATE ROLE supabase_realtime_admin NOLOGIN;
CREATE ROLE supabase_storage_admin NOLOGIN;
SQL
fi
docker exec -i "$nome" psql -X -q -v ON_ERROR_STOP=1 -h /tmp -U postgres -d postgres \
  > "$raiz/papel-event-triggers.log" 2>&1 <<'SQL'
ALTER ROLE supabase_admin NOLOGIN SUPERUSER;
SQL
# Extensões carregadas para compatibilidade, mas zero vagas de background workers
# e cron globalmente desativado ANTES de importar registros. Nenhum worker HTTP.
# Post-data (triggers) vem após COPY; preserva owners/ACLs, sem --clean.
docker exec -i "$nome" pg_restore --single-transaction --exit-on-error \
  --host=/tmp --username=postgres --dbname=postgres < "$raiz/export.backup" \
  > "$raiz/restauracao.log" 2>&1
sha256sum -c "$raiz/restauracao.sha256" > "$raiz/integridade-pos-restauracao.log"
date -u +%FT%TZ > "$raiz/restauracao.concluida"
echo 'Restauração real concluída; validação e arquivos físicos ainda necessários.'
