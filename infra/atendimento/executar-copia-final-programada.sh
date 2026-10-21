#!/bin/sh
# Manual, exclusivo do SEGUNDO comando. Não parar coletor, alterar callback,
# reinstalar CDC, importar operação, enviar, ligar IA ou excluir cópias.
set -eu
umask 077
validar_caminho_privado() {
 case "$1" in /*) ;; *) echo CAMINHO_PRIVADO_RECUSADO >&2; exit 1;; esac
 case "$1" in /|*[!A-Za-z0-9_./-]*|*//*|*/./*|*/../*|*/.|*/..|*/) echo CAMINHO_PRIVADO_RECUSADO >&2; exit 1;; esac
}
test "$#" -eq 1 && test "$1" = --executar-copia-final || { echo COPIA_FINAL_SEGUNDO_COMANDO_MANUAL_EXIGIDO >&2; exit 1; }
raiz=${ATENDIMENTO_RAIZ_REMOTA_OPERACAO:?ATENDIMENTO_RAIZ_REMOTA_OPERACAO_OBRIGATORIA}
ferramenta="$raiz/ferramentas/conferir-copia-final-programada.py"
coletor=grazing-donatella-coletor-v2
imagem=grazing-donatella-consulta-v2:20261008-a
saida=grazing-donatella-coletor-v2-saida
privada=grazing-donatella-homologacao-v2-privada
release=${ATENDIMENTO_RELEASE_CONTROLE:?ATENDIMENTO_RELEASE_CONTROLE_OBRIGATORIA}
homologacao=${ATENDIMENTO_RAIZ_REMOTA_HOMOLOGACAO:?ATENDIMENTO_RAIZ_REMOTA_HOMOLOGACAO_OBRIGATORIA}
consulta="$homologacao/consulta"
cofre=${ATENDIMENTO_CONFIG_COLETOR:?ATENDIMENTO_CONFIG_COLETOR_OBRIGATORIA}
indice=${ATENDIMENTO_INDICE_MIDIA:?ATENDIMENTO_INDICE_MIDIA_OBRIGATORIA}
midia=${ATENDIMENTO_MIDIA_ORIGEM:?ATENDIMENTO_MIDIA_ORIGEM_OBRIGATORIA}
for p in "$raiz" "$release" "$homologacao" "$cofre" "$indice" "$midia"; do validar_caminho_privado "$p"; done
corte="$raiz/configuracao/corte"
registro="$corte/executor"
for p in "$raiz" "$raiz/ferramentas" "$raiz/copia-final" "$release" "$consulta" "$corte" "$midia"; do
 test -d "$p" && test ! -L "$p" || { echo COPIA_FINAL_MONTAGEM_AUSENTE >&2; exit 1; }
done
test -s "$ferramenta" && test ! -L "$ferramenta" && test -s "$raiz/copia-final/copia-final-origem.mjs" && test ! -L "$raiz/copia-final/copia-final-origem.mjs" && test -s "$indice" && test ! -L "$indice" && test -s "$cofre" && test ! -L "$cofre" || { echo COPIA_FINAL_FERRAMENTA_AUSENTE >&2; exit 1; }
# Tudo acima é leitura. Sem autorização privada válida, nem cria contêiner.
autorizado=$(python3 "$ferramenta" --conferir)
id=${autorizado%% *}
segundos=${autorizado#* }
nome="grazing-donatella-copia-final-v2-$id"
mkdir -m 700 -p "$registro"
test ! -L "$registro" && test ! -L "$registro/exclusao.lock" || { echo COPIA_FINAL_ESTADO_RECUSADO >&2; exit 1; }
exec 9>"$registro/exclusao.lock"
flock -n 9 || { echo COPIA_FINAL_JA_EM_EXECUCAO >&2; exit 1; }
docker inspect "$coletor" | python3 "$ferramenta" --coletor
ativos=$(docker ps -q --filter label=grazing.finalidade=copia-final-programada-v2 --filter status=running)
test -z "$ativos" || { echo COPIA_FINAL_OUTRO_EXECUTOR_ATIVO_CONFERIR >&2; exit 1; }
if docker inspect "$nome" >/dev/null 2>&1 || [ -e "$registro/$id-intento.json" ]; then
 echo COPIA_FINAL_EXECUCAO_EXISTENTE_CONFERIR_SEM_REPETIR >&2
 exit 1
fi
test ! -e "$registro/$id-processo.log" && test ! -L "$registro/$id-processo.log" || { echo COPIA_FINAL_LOG_EXISTENTE_CONFERIR >&2; exit 1; }
test "$(docker image inspect "$imagem" --format '{{json .Config.Entrypoint}}')" = '["node"]' || { echo COPIA_FINAL_IMAGEM_RECUSADA >&2; exit 1; }
docker network inspect "$saida" >/dev/null
test "$(docker network inspect "$privada" --format '{{.Internal}}')" = true || { echo COPIA_FINAL_REDE_PRIVADA_RECUSADA >&2; exit 1; }
docker volume inspect grazing-donatella-coletor-v2-estado >/dev/null
# Intenção exclusiva e fsync antes de criar/iniciar. Nunca remove intenção,
# relatório, logs, contêiner ou volume para facilitar uma repetição.
python3 - "$registro" "$id" <<'PY'
import datetime,json,os,sys
from pathlib import Path
p=Path(sys.argv[1]);id=sys.argv[2]
with (p/(id+'-intento.json')).open('x') as f:
 json.dump({'versao':1,'tipo':'executor-copia-final-programada-v1','execucao':id,'iniciadaEm':datetime.datetime.now(datetime.timezone.utc).isoformat(),'segundoComandoConferido':True,'coletorParadoConferido':True,'container':'grazing-donatella-copia-final-v2-'+id},f);f.flush();os.fsync(f.fileno())
d=os.open(p,os.O_RDONLY)
try:os.fsync(d)
finally:os.close(d)
PY
docker create --pull=never --name "$nome" --label grazing.finalidade=copia-final-programada-v2 --label "grazing.execucao=$id" --restart=no --read-only --cap-drop ALL --security-opt no-new-privileges --memory 768m --cpus 0.75 --pids-limit 128 --stop-timeout 60 --network "$saida" --workdir /release --mount "type=bind,src=$raiz/copia-final,dst=/copia-final,readonly" --mount "type=bind,src=$release,dst=/release,readonly" --mount "type=bind,src=$corte,dst=/run/secrets/corte,readonly" --mount "type=bind,src=$cofre,dst=/run/secrets/coletor.json,readonly" --mount "type=bind,src=$indice,dst=/run/secrets/media-index.json,readonly" --mount "type=bind,src=$midia,dst=/midia,readonly" --mount type=volume,src=grazing-donatella-coletor-v2-estado,dst=/estado --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 "$imagem" /copia-final/copia-final-origem.mjs --executar-copia-final /run/secrets/corte/copia-final.json >/dev/null
docker network connect "$privada" "$nome"
# Revalidar janela/escopo e parada imediatamente antes de iniciar.
revalidado=$(python3 "$ferramenta" --conferir)
test "${revalidado%% *}" = "$id" || { echo COPIA_FINAL_AUTORIZACAO_DIVERGENTE >&2; exit 1; }
segundos=${revalidado#* }
docker inspect "$coletor" | python3 "$ferramenta" --coletor
iniciado=0
frear() {
 trap - EXIT HUP INT TERM
 if [ "$iniciado" = 1 ] && [ "$(docker inspect "$nome" --format '{{index .Config.Labels "grazing.execucao"}}')" = "$id" ] && [ "$(docker inspect "$nome" --format '{{index .Config.Labels "grazing.finalidade"}}')" = copia-final-programada-v2 ]; then
  docker stop --time 60 "$nome" >/dev/null || echo COPIA_FINAL_PARADA_NAO_CONFIRMADA >&2
 fi
}
trap frear EXIT
trap 'exit 1' HUP INT TERM
iniciado=1
resultado=0
timeout --foreground --signal=TERM "$segundos" docker start -a "$nome" > "$registro/$id-processo.log" 2>&1 || resultado=$?
if [ "$resultado" -ne 0 ]; then echo COPIA_FINAL_PROCESSO_INTERROMPIDO_CONFERIR >&2; exit 1; fi
test "$(docker inspect "$nome" --format '{{.State.Status}} {{.State.ExitCode}}')" = 'exited 0' || { echo COPIA_FINAL_PROCESSO_FALHOU_CONFERIR >&2; exit 1; }
iniciado=0
trap - EXIT HUP INT TERM
test ! -e "$registro/$id-relatorio.json" && test ! -L "$registro/$id-relatorio.json" || { echo COPIA_FINAL_RELATORIO_EXISTENTE_CONFERIR >&2; exit 1; }
docker cp "$nome:/estado/copia-final/$id/relatorio.json" "$registro/$id-relatorio.json"
chmod 600 "$registro/$id-relatorio.json"
python3 "$ferramenta" --resultado "$id"
echo COPIA_FINAL_PREPARACAO_MATERIALIZADA_CONFERIR_LACUNAS_E_IMPORTAR_OPERACAO
