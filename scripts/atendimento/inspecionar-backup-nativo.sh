#!/bin/sh
# Inspeção de arquivo real já copiado para o diretório privado da recuperação.
# Não restaura nem executa objetos do dump; nenhuma porta ou rede é disponibilizada.
set -eu
umask 077
validar_caminho_privado() {
 case "$1" in /*) ;; *) echo CAMINHO_PRIVADO_RECUSADO >&2; exit 1;; esac
 case "$1" in /|*[!A-Za-z0-9_./-]*|*//*|*/./*|*/../*|*/.|*/..|*/) echo CAMINHO_PRIVADO_RECUSADO >&2; exit 1;; esac
}
raiz=${ATENDIMENTO_RAIZ_RECUPERACAO:?ATENDIMENTO_RAIZ_RECUPERACAO_OBRIGATORIA}
validar_caminho_privado "$raiz"
[ "$(id -u)" = 0 ]
arquivo="$raiz/export.backup"
imagem=postgres:17-bookworm@sha256:3645570cccdfa447589da9f57dd740faa29b30938e861289a5574b6ca6b03826
[ -d "$raiz" ] && [ ! -L "$raiz" ] && [ -f "$arquivo" ] && [ ! -L "$arquivo" ]
[ "$(stat -c %a "$raiz")" = 700 ] && [ "$(stat -c %u "$raiz")" = 0 ]
[ "$(stat -c %a "$arquivo")" = 600 ] && [ "$(stat -c %u "$arquivo")" = 0 ]
[ "$(head -c 5 "$arquivo")" = PGDMP ] || { printf '%s\n' 'Arquivo não é PostgreSQL custom; extrair somente o invólucro ZIP em local privado.'; exit 1; }
[ ! -e "$raiz/toc.txt" ] && [ ! -e "$raiz/inspecao.log" ] && [ ! -e "$raiz/export.sha256" ]
sha256sum "$arquivo" > "$raiz/export.sha256"
if ! docker run --rm --pull never --network none --read-only --cap-drop ALL --security-opt no-new-privileges --memory 256m --cpus 1 \
  --mount "type=bind,src=$arquivo,dst=/backup/export.backup,readonly" \
  "$imagem" pg_restore --list /backup/export.backup > "$raiz/toc.txt" 2> "$raiz/inspecao.log"; then
  printf '%s\n' 'Inspeção interrompida; conferir diagnóstico privado. Nenhum objeto restaurado.'
  exit 1
fi
sha256sum --check --status "$raiz/export.sha256" || { printf '%s\n' 'Arquivo mudou durante a inspeção; conferência recusada.'; exit 1; }
printf '%s\n' 'TOC e hash preservados em local privado. A restauração depende da revisão dos objetos/extensões/roles; não foi executada.'
