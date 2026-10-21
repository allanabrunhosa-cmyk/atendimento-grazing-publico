#!/bin/sh
# Somente banco privado de preparação. Segredos chegam por stdin, nunca por argv.
set -eu
umask 077
[ "$(id -u)" = 0 ]
raiz=${1:?Informe o diretorio remoto privado da homologacao.}
[ -f "$raiz/compose.homologacao.yml" ]
[ -f "$raiz/005-carga-destino.sql" ]
IFS= read -r administrador
IFS= read -r coletor
for segredo in "$administrador" "$coletor"; do
  [ "${#segredo}" = 64 ] || exit 1
  case "$segredo" in *[!a-f0-9]*) exit 1;; esac
done
if [ -e "$raiz/postgres.secret" ]; then
  [ "$(cat "$raiz/postgres.secret")" = "$administrador" ] || exit 1
else
  printf '%s' "$administrador" > "$raiz/postgres.secret"
fi
chmod 600 "$raiz/postgres.secret"
docker compose -f "$raiz/compose.homologacao.yml" up -d --pull never
banco=grazing-donatella-homologacao-v2-banco
pronto=0
for rodada in $(seq 1 30); do
  if docker exec "$banco" pg_isready -U donatella_homologacao_admin -d donatella_preparacao >/dev/null 2>&1; then pronto=1; break; fi
  sleep 1
done
[ "$pronto" = 1 ]
# Logs particulares: nunca devolver consulta que possa conter segredo ao terminal.
if ! docker exec -i "$banco" psql -U donatella_homologacao_admin -d donatella_preparacao -v ON_ERROR_STOP=1 > "$raiz/bootstrap.log" 2>&1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='donatella_coletor') THEN
    CREATE ROLE donatella_coletor LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '$coletor';
  END IF;
END \$\$;
SELECT 'CREATE DATABASE donatella_ensaio_restauracao' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname='donatella_ensaio_restauracao') \gexec
SQL
then printf '%s\n' 'Bootstrap interrompido; revisar log privado.'; exit 1; fi
for db in donatella_preparacao donatella_ensaio_restauracao; do
  existe=$(docker exec "$banco" psql -U donatella_homologacao_admin -d "$db" -Atc "SELECT to_regclass('atendimento_migracao.carga_documento') IS NOT NULL")
  if [ "$existe" = f ]; then
    docker exec -i "$banco" psql -U donatella_homologacao_admin -d "$db" -v ON_ERROR_STOP=1 < "$raiz/005-carga-destino.sql" > "$raiz/schema-$db.log" 2>&1
  fi
  docker exec -i "$banco" psql -U donatella_homologacao_admin -d "$db" -v ON_ERROR_STOP=1 >> "$raiz/schema-$db.log" 2>&1 <<SQL
REVOKE CONNECT ON DATABASE $db FROM PUBLIC;
GRANT CONNECT ON DATABASE $db TO donatella_coletor;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA atendimento_migracao TO donatella_coletor;
GRANT SELECT, INSERT, UPDATE ON atendimento_migracao.carga_documento, atendimento_migracao.carga_registro TO donatella_coletor;
SQL
done
printf '%s\n' 'Preparação privada concluída; nenhum dado da origem foi acessado.'
