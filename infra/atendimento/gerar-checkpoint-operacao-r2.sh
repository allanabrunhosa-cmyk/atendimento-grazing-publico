#!/bin/sh
# Preparado, não instalado/ativado: bancos operação/entrada separados e bytes do destino.
# Nenhum HUB, preparação/origem, chave mestra, trigger ou envio.
set -eu
umask 077
validar_caminho_privado() {
 case "$1" in /*) ;; *) echo CAMINHO_PRIVADO_RECUSADO >&2; exit 1;; esac
 case "$1" in /|*[!A-Za-z0-9_./-]*|*//*|*/./*|*/../*|*/.|*/..|*/) echo CAMINHO_PRIVADO_RECUSADO >&2; exit 1;; esac
}
raiz=${ATENDIMENTO_RAIZ_CHECKPOINT_OPERACAO_R2:?ATENDIMENTO_RAIZ_CHECKPOINT_OPERACAO_R2_OBRIGATORIA}
fontes=${ATENDIMENTO_RAIZ_REMOTA_OPERACAO:?ATENDIMENTO_RAIZ_REMOTA_OPERACAO_OBRIGATORIA}
cofre=${ATENDIMENTO_CONFIG_CHECKPOINT_R2:?ATENDIMENTO_CONFIG_CHECKPOINT_R2_OBRIGATORIA}
homologacao=${ATENDIMENTO_RAIZ_REMOTA_HOMOLOGACAO:?ATENDIMENTO_RAIZ_REMOTA_HOMOLOGACAO_OBRIGATORIA}
release="$homologacao/checkpoints-operacao-r2/release"
for p in "$raiz" "$fontes" "$cofre" "$homologacao"; do validar_caminho_privado "$p"; done
banco=grazing-donatella-operacao-v2-banco
codigo_falha=CHECKPOINT_OPERACAO_ROTINA_INTERROMPIDA
montado=0
entrada=
falhar() { codigo_falha="$1"; echo "$codigo_falha" >&2; exit 1; }
desmontar() { if [ "$montado" = 1 ]; then umount "$entrada" || return 1; montado=0; fi; if [ -n "$entrada" ]; then rmdir "$entrada"; entrada=; fi; }
ao_sair() {
 resultado=$?
 trap - EXIT HUP INT TERM
 if [ "$montado" = 1 ]; then desmontar || resultado=1; fi
 if [ "$resultado" -ne 0 ] && [ "${1:-}" != --verificar ] && [ "$codigo_falha" != CHECKPOINT_OPERACAO_JA_EM_EXECUCAO ] && [ -s "$release/gerar-checkpoint-operacao-r2.mjs" ]; then
  # Somente código técnico fixo. Preserva último sucesso/cópias, sem rede/chaves.
  timeout 20s docker run --rm --pull=never --name grazing-donatella-checkpoint-operacao-r2-v2-status --read-only --cap-drop ALL --security-opt no-new-privileges --memory 128m --cpus 0.25 --pids-limit 32 --network none --mount "type=bind,src=$release,dst=/release,readonly" --mount type=volume,src=grazing-donatella-checkpoints-operacao-v2-estado,dst=/estado grazing-donatella-consulta-v2:20261008-a /release/gerar-checkpoint-operacao-r2.mjs --registrar-falha "$codigo_falha" || echo CHECKPOINT_OPERACAO_ALERTA_LOCAL_NAO_GRAVADO >&2
 fi
 exit "$resultado"
}
modo_verificar=${1:-}
trap 'ao_sair "$modo_verificar"' EXIT
trap 'exit 1' HUP INT TERM
publicar_spool() {
 docker run --rm --pull=never --name grazing-donatella-checkpoint-operacao-r2-v2 --label grazing.finalidade=checkpoint-operacao-r2-v2 --read-only --cap-drop ALL --security-opt no-new-privileges --memory 3072m --cpus 0.5 --pids-limit 64 --network grazing-donatella-coletor-v2-saida --mount "type=bind,src=$release,dst=/release,readonly" --mount "type=bind,src=$cofre,dst=/run/secrets/checkpoint.json,readonly" --mount type=volume,src=grazing-donatella-checkpoints-operacao-v2-estado,dst=/estado --tmpfs /tmp:rw,noexec,nosuid,size=16m grazing-donatella-consulta-v2:20261008-a /release/gerar-checkpoint-operacao-r2.mjs --publicar-spool "$id"
 mv "$raiz/pendente.json" "$raiz/historico/$id-concluido.json"
 python3 - "$raiz" <<'PY'
import os,sys
for p in [sys.argv[1],sys.argv[1]+'/historico']:
 f=os.open(p,os.O_RDONLY)
 try:os.fsync(f)
 finally:os.close(f)
PY
}
# Publicação pendente selada não depende do banco, fontes ou RAM descartada.
if [ "${1:-}" != --verificar ] && [ -f "$raiz/pendente.json" ]; then
 test "$#" -eq 0 && test ! -L "$raiz/pendente.json" && test ! -L "$raiz" && test -d "$raiz/historico" && test ! -L "$raiz/historico" && test ! -L "$release" && test -s "$release/gerar-checkpoint-operacao-r2.mjs" && test ! -L "$cofre" && test -s "$cofre" || { echo CHECKPOINT_OPERACAO_ESTADO_RECUSADO >&2; exit 1; }
 exec 9>"$raiz/exclusao.lock"
 flock -n 9 || falhar CHECKPOINT_OPERACAO_JA_EM_EXECUCAO
 id=$(python3 - "$raiz/pendente.json" <<'PY'
import json,sys,uuid
p=json.load(open(sys.argv[1]))
if p.get('versao')!=3 or p.get('tipo')!='temporario-horario-v1' or p.get('fase')!='selado':raise SystemExit('CHECKPOINT_OPERACAO_SELAGEM_INCOMPLETA_CONFERIR')
print(str(uuid.UUID(p['id'])))
PY
 )
 publicar_spool
 exit 0
fi
docker inspect "$banco" >/dev/null 2>&1 || { echo CHECKPOINT_OPERACAO_BANCO_AUSENTE >&2; exit 1; }
[ "$(docker inspect "$banco" --format '{{index .Config.Labels "grazing.finalidade"}}')" = operacao-privada ] || { echo CHECKPOINT_OPERACAO_BANCO_RECUSADO >&2; exit 1; }
for p in "$fontes" "$fontes/configuracao" "$fontes/release" "$fontes/midia" "$release"; do
 test -d "$p" && test ! -L "$p" || { echo CHECKPOINT_OPERACAO_FONTE_AUSENTE >&2; exit 1; }
done
test -s "$fontes/configuracao/cobertura.json" && test ! -L "$cofre" && test -s "$cofre" || { echo CHECKPOINT_OPERACAO_COBERTURA_AUSENTE >&2; exit 1; }
# Atestação técnica da configuração preparada é conferida junto ao banco abaixo.
python3 - "$fontes/configuracao/cobertura.json" <<'PY'
import json,sys
p=json.load(open(sys.argv[1]))
esperado={'conversas_mensagens','filas_e_idempotencia_envio','webhooks','casos_respostas_apoio','candidatos_versoes_conhecimento','auditoria','identidades_permissoes','anexos_destino_bytes','configuracoes_cifradas','custodia_recuperavel','entrada_duravel_separada'}
if p.get('versao')!=2 or p.get('banco')!='donatella_operacao' or p.get('bancoEntrada')!='donatella_entrada' or p.get('entradaDuravelSeparada') is not True or set(p.get('cobertura',[]))!=esperado or p.get('arquivosImutaveis') is not True or p.get('exclusaoArquivosBloqueada') is not True:raise SystemExit('CHECKPOINT_OPERACAO_COBERTURA_INCOMPLETA')
PY
livre_kib=$(df -Pk /var/lib/docker | awk 'NR==2 {print $4}')
test "$livre_kib" -ge 10485760 || falhar CHECKPOINT_OPERACAO_ESPACO_REQUER_REVISAO
operacao_bytes=$(docker exec "$banco" psql -X -qAt -v ON_ERROR_STOP=1 -U donatella_operacao_backup -d donatella_operacao -c 'SELECT pg_database_size(current_database())')
entrada_bytes=$(docker exec "$banco" psql -X -qAt -v ON_ERROR_STOP=1 -U donatella_operacao_backup -d donatella_entrada -c 'SELECT pg_database_size(current_database())')
banco_bytes=$((operacao_bytes + entrada_bytes))
test "$banco_bytes" -le 1073741824 || { echo CHECKPOINT_OPERACAO_CAPACIDADE_REQUER_REVISAO >&2; exit 1; }
estimativa=$(python3 - "$fontes" "$operacao_bytes" "$entrada_bytes" <<'PY'
from pathlib import Path
import sys,json
total=int(sys.argv[2])+int(sys.argv[3]);quantidade=0;bytes_fontes=0
for grupo in ['configuracao','release','midia']:
 for p in (Path(sys.argv[1])/grupo).rglob('*'):
  if p.is_symlink():raise SystemExit('CHECKPOINT_OPERACAO_FONTE_INVALIDA')
  if p.is_dir():continue
  if not p.is_file() or p.stat().st_size>64*1024*1024:raise SystemExit('CHECKPOINT_OPERACAO_CAPACIDADE_REQUER_REVISAO')
  quantidade+=1;total+=p.stat().st_size;bytes_fontes+=p.stat().st_size
if quantidade>9000 or total>2*1024*1024*1024:raise SystemExit('CHECKPOINT_OPERACAO_CAPACIDADE_REQUER_REVISAO')
print(json.dumps({'bancoOperacaoBytes':int(sys.argv[2]),'bancoEntradaBytes':int(sys.argv[3]),'fontesBytes':bytes_fontes,'arquivosFonte':quantidade,'estimativaAntesCompressaoBytes':total,'limiteBytes':2*1024*1024*1024,'observacao':'estimativa previa; confirmar bytes reais cifrados apos o primeiro ponto'}))
PY
)
test "$(docker exec "$banco" psql -X -qAt -v ON_ERROR_STOP=1 -U donatella_operacao_backup -d donatella_operacao -c "SELECT count(*) FROM pg_namespace WHERE nspname='atendimento_apoio'")" = 1 || { echo CHECKPOINT_OPERACAO_SCHEMA_AUSENTE >&2; exit 1; }
test "$(docker exec "$banco" psql -X -qAt -v ON_ERROR_STOP=1 -U donatella_operacao_backup -d donatella_entrada -c "SELECT count(*) FROM pg_namespace WHERE nspname='atendimento_entrada'")" = 1 || { echo CHECKPOINT_OPERACAO_ENTRADA_AUSENTE >&2; exit 1; }
if [ "${1:-}" = --verificar ]; then echo "$estimativa"; exit 0; fi
test "$#" -eq 0 || { echo CHECKPOINT_OPERACAO_ARGUMENTO_RECUSADO >&2; exit 1; }
mkdir -p "$raiz/temporarios-horarios" "$raiz/historico"
chmod 700 "$raiz" "$raiz/temporarios-horarios" "$raiz/historico"
exec 9>"$raiz/exclusao.lock"
flock -n 9 || falhar CHECKPOINT_OPERACAO_JA_EM_EXECUCAO
if [ ! -f "$raiz/pendente.json" ]; then
 # Crescimento do T0 conferido em 12/10: teto revisado do protocolo de 2 GiB.
 # As duas tmpfs têm teto próprio; reserva livre obrigatória antes da captura.
 python3 - "$estimativa" <<'PY'
import json,sys
if json.loads(sys.argv[1])['estimativaAntesCompressaoBytes']>2*1024*1024*1024:raise SystemExit('CHECKPOINT_OPERACAO_RAM_REQUER_REVISAO')
memoria={linha.split(':',1)[0]:int(linha.split()[1])*1024 for linha in open('/proc/meminfo') if linha.startswith('MemAvailable:')}
if memoria.get('MemAvailable',0)<8*1024*1024*1024:raise SystemExit('CHECKPOINT_OPERACAO_RAM_LIVRE_INSUFICIENTE')
PY
 python3 - "$raiz" <<'PY'
import json,sys,uuid,datetime,os
from pathlib import Path
r=Path(sys.argv[1]);p={'versao':3,'tipo':'temporario-horario-v1','fase':'preparando','id':str(uuid.uuid4()),'criadoEm':datetime.datetime.now(datetime.timezone.utc).isoformat(),'banco':'donatella_operacao','bancoEntrada':'donatella_entrada','coerenciaEntreBancos':'snapshots_sequenciais_reconciliar_por_chave'}
with (r/'pendente.json').open('x') as f:json.dump(p,f);f.flush();os.fsync(f.fileno())
d=os.open(r,os.O_RDONLY)
try:os.fsync(d)
finally:os.close(d)
PY
 id=$(python3 -c 'import json,sys,uuid;print(str(uuid.UUID(json.load(open(sys.argv[1]))["id"])))' "$raiz/pendente.json")
 entrada="$raiz/temporarios-horarios/$id"
 mkdir -m 700 "$entrada"
 mount -t tmpfs -o size=3072m,mode=0700,nosuid,nodev,noexec tmpfs "$entrada"
 montado=1
 mkdir -m 700 "$entrada/banco" "$entrada/configuracao" "$entrada/release" "$entrada/midia"
 # Copiar somente diretórios próprios. Symlinks são recusados depois pelo gerador.
 cp -a "$fontes/configuracao/." "$entrada/configuracao/"
 cp -a "$fontes/release/." "$entrada/release/"
 # Snapshot de entrada primeiro: recibos duráveis não são apagados. Os bancos
 # têm snapshots sequenciais, não uma transação distribuída. A recuperação
 # reconciliará chaves/leases; nenhum worker é ligado durante a prova.
 for nome_banco in entrada operacao; do
  docker exec "$banco" pg_dump -U donatella_operacao_backup -d "donatella_$nome_banco" --lock-wait-timeout=3s -Fc > "$entrada/$nome_banco.backup" 2> "$raiz/historico/$id-$nome_banco-dump.log"
  test -s "$entrada/$nome_banco.backup"
  python3 - "$entrada/$nome_banco.backup" "$entrada/banco" "$nome_banco" <<'PY'
import json,hashlib,sys,os
from pathlib import Path
origem=Path(sys.argv[1]);destino=Path(sys.argv[2]);nome_banco=sys.argv[3]
if nome_banco not in ['operacao','entrada']:raise SystemExit('CHECKPOINT_OPERACAO_BANCO_RECUSADO')
inteiro=hashlib.sha256();total=0;partes=[]
with origem.open('rb') as f:
 while True:
  b=f.read(32*1024*1024)
  if not b:break
  nome=nome_banco+'.backup.part-'+str(len(partes)).zfill(5)
  with (destino/nome).open('xb') as o:o.write(b);o.flush();os.fsync(o.fileno())
  inteiro.update(b);total+=len(b);partes.append({'nome':nome,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()})
with (destino/(nome_banco+'.indice.json')).open('x') as f:json.dump({'versao':1,'arquivo':nome_banco+'.backup','bytes':total,'sha256':inteiro.hexdigest(),'partes':partes},f);f.flush();os.fsync(f.fileno())
PY
 done
 # Copiar mídia depois de ambos dumps, preservando CAS imutável sem exclusão.
 cp -a "$fontes/midia/." "$entrada/midia/"
 python3 - "$raiz/pendente.json" "$entrada/congelado.json" <<'PY'
import json,sys
p=json.load(open(sys.argv[1]));p['versao']=2
with open(sys.argv[2],'x') as f:json.dump(p,f)
PY
 # Selagem integral cifrada durável antes de qualquer PUT do ponto.
 docker run --rm --pull=never --name grazing-donatella-checkpoint-operacao-r2-v2 --label grazing.finalidade=checkpoint-operacao-r2-v2 --read-only --cap-drop ALL --security-opt no-new-privileges --memory 3072m --cpus 0.5 --pids-limit 64 --network grazing-donatella-coletor-v2-saida --mount "type=bind,src=$release,dst=/release,readonly" --mount "type=bind,src=$cofre,dst=/run/secrets/checkpoint.json,readonly" --mount "type=bind,src=$entrada,dst=/entrada,readonly" --mount type=volume,src=grazing-donatella-checkpoints-operacao-v2-estado,dst=/estado --tmpfs /tmp:rw,noexec,nosuid,size=16m --tmpfs /cifra-temporaria:rw,noexec,nosuid,nodev,size=3072m,mode=0700 grazing-donatella-consulta-v2:20261008-a /release/gerar-checkpoint-operacao-r2.mjs --selar-spool
 python3 - "$raiz/pendente.json" <<'PY'
import json,sys,os
from pathlib import Path
p=Path(sys.argv[1]);j=json.loads(p.read_text());j['fase']='selado';t=p.with_name('pendente-selado.tmp')
with t.open('x') as f:json.dump(j,f);f.flush();os.fsync(f.fileno())
os.replace(t,p)
d=os.open(p.parent,os.O_RDONLY)
try:os.fsync(d)
finally:os.close(d)
PY
 desmontar
else
 id=$(python3 -c 'import json,sys,uuid;print(str(uuid.UUID(json.load(open(sys.argv[1]))["id"])))' "$raiz/pendente.json")
 # Não mexer em snapshots/pontos antigos. Selagem parcial exige conferência.
 python3 - "$raiz/pendente.json" <<'PY'
import json,sys
p=json.load(open(sys.argv[1]))
if p.get('versao')!=3 or p.get('tipo')!='temporario-horario-v1' or p.get('fase')!='selado':raise SystemExit('CHECKPOINT_OPERACAO_SELAGEM_INCOMPLETA_CONFERIR')
PY
fi
publicar_spool
