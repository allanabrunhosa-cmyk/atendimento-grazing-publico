#!/usr/bin/env python3
"""Publicação restrita do reader existente; não executa sem --aplicar.

Clona a release existente e substitui somente consulta.mjs. Não lê banco,
credenciais nem conteúdo dos arquivos privados montados. Saídas são técnicas.
"""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys


def caminho_privado(nome):
    """Exige alvo privado explícito; nunca usa caminho operacional padrão."""
    valor = os.environ.get(nome)
    if not isinstance(valor, str) or not valor or any(c in valor for c in '\r\n\0,'):
        raise RuntimeError('ATENDIMENTO_CAMINHO_PRIVADO_OBRIGATORIO_' + nome)
    caminho = Path(valor)
    if not caminho.is_absolute() or str(caminho) != valor or '..' in caminho.parts or caminho.parent == caminho:
        raise RuntimeError('ATENDIMENTO_CAMINHO_PRIVADO_INVALIDO_' + nome)
    return caminho

BASE = str(caminho_privado('ATENDIMENTO_RAIZ_REMOTA_HOMOLOGACAO'))
PROJETO = "grazing-donatella-consulta-v2"
CONSULTA = "grazing-donatella-consulta-v2"
IMAGEM = "grazing-donatella-consulta-v2:20261008-a"
RELEASE_ORIGEM = str(caminho_privado('ATENDIMENTO_RELEASE_CONSULTA_ORIGEM'))
MIDIA_ORIGEM = str(caminho_privado('ATENDIMENTO_MIDIA_ORIGEM'))
INDICE_MIDIA = str(caminho_privado('ATENDIMENTO_INDICE_MIDIA'))
OUTROS = ["grazing-donatella-coletor-v2", "grazing-donatella-preview-v2",
          "grazing-donatella-laboratorio-v2", "grazing-donatella-homologacao-v2-banco"]


class Recusado(Exception):
    pass


def exigir(condicao, codigo):
    if not condicao:
        raise Recusado(codigo)


def validar_nome(valor, tipo):
    p = PurePosixPath(valor)
    padroes = {"release": r"release(?:-[a-z0-9]+)*",
               "compose": r"compose\.consulta(?:-[a-z0-9]+)*\.yml",
               "bundle": r"consulta-reader-[a-f0-9]{12}\.mjs"}
    exigir(str(p) == valor and str(p.parent) == BASE and
           re.fullmatch(padroes[tipo], p.name) is not None,
           "CONSULTA_CAMINHO_RECUSADO")
    return p


def caminho_existente(valor, tipo, diretorio=False):
    validar_nome(valor, tipo)
    p = Path(valor)
    exigir(p.resolve(strict=True) == p and not p.is_symlink() and
           (p.is_dir() if diretorio else p.is_file()), "CONSULTA_CAMINHO_RECUSADO")
    return p


def docker(*args):
    # Nunca devolver stderr/JSON cru: a configuração efetiva pode ser sensível.
    r = subprocess.run(["docker", *args], capture_output=True, text=True, check=False)
    exigir(r.returncode == 0, "CONSULTA_COMANDO_DOCKER_FALHOU")
    return r.stdout


def inspect(nome):
    return json.loads(docker("inspect", nome))[0]


def memoria(valor):
    if isinstance(valor, int):
        return valor
    m = re.fullmatch(r"([0-9]+)([kmg]?)", str(valor).lower())
    exigir(m is not None, "CONSULTA_LIMITE_RECUSADO")
    return int(m[1]) * {"": 1, "k": 1024, "m": 1024 ** 2, "g": 1024 ** 3}[m[2]]


def labels_publicas(labels):
    return {k: v for k, v in (labels or {}).items() if not k.startswith("com.docker.compose.")}


def configurar_consulta(config, atual, nova_release):
    """Conserva o service real e recusa deriva; saída não inclui outros services."""
    validar_nome(nova_release, "release")
    exigir(config.get("name") == PROJETO and "consulta" in config.get("services", {}),
           "CONSULTA_PROJETO_RECUSADO")
    s = copy.deepcopy(config["services"]["consulta"])
    c, h = atual["Config"], atual["HostConfig"]
    exigir(s.get("image") == IMAGEM == c.get("Image") and
           s.get("container_name") == CONSULTA and
           s.get("command") == c.get("Cmd") == ["/release/consulta.mjs"],
           "CONSULTA_IMAGEM_COMANDO_DIVERGENTE")
    exigir(not s.get("environment") and not s.get("env_file") and not s.get("build") and
           not s.get("ports") and not s.get("devices") and not s.get("privileged") and
           not s.get("depends_on") and not s.get("network_mode") and
           not s.get("secrets") and not s.get("configs"), "CONSULTA_SERVICO_FORA_DO_CONTRATO")
    exigir(s.get("read_only") is True and h.get("ReadonlyRootfs") is True and
           set(s.get("cap_drop", [])) == set(h.get("CapDrop", [])) == {"ALL"} and
           set(s.get("security_opt", [])) == set(h.get("SecurityOpt", [])) == {"no-new-privileges:true"} and
           h.get("Privileged") is False and s.get("restart") == h.get("RestartPolicy", {}).get("Name") == "unless-stopped",
           "CONSULTA_PERMISSOES_DIVERGENTES")
    exigir(memoria(s.get("mem_limit")) == h.get("Memory") and
           int(float(s.get("cpus", 0)) * 1_000_000_000) == h.get("NanoCpus") and
           s.get("pids_limit") == h.get("PidsLimit"), "CONSULTA_LIMITES_DIVERGENTES")
    l = s.get("logging", {})
    exigir(l.get("driver") == h.get("LogConfig", {}).get("Type") and
           l.get("options", {}) == h.get("LogConfig", {}).get("Config", {}) and
           labels_publicas(s.get("labels")) == labels_publicas(c.get("Labels")),
           "CONSULTA_LABELS_LOG_DIVERGENTES")
    # Compose normalizado usa mapas para redes; os nomes existentes são externos.
    redes = s.get("networks", {})
    exigir(isinstance(redes, dict) and len(redes) == 2, "CONSULTA_REDES_RECUSADAS")
    nomes_redes = set()
    redes_saida = {}
    for chave in redes:
        n = config.get("networks", {}).get(chave, {})
        exigir(n.get("external") is True and n.get("name") in
               {"grazing-donatella-homologacao-v2-privada", "dokploy-network"}, "CONSULTA_REDE_NAO_EXISTENTE")
        nomes_redes.add(n["name"])
        redes_saida[chave] = copy.deepcopy(n)
    exigir(nomes_redes == set(atual.get("NetworkSettings", {}).get("Networks", {})), "CONSULTA_REDES_DIVERGENTES")
    mounts = {}
    for m in atual.get("Mounts", []):
        exigir(m["Destination"] not in mounts and m.get("RW") is False, "CONSULTA_MONTAGEM_RECUSADA")
        mounts[m["Destination"]] = m
    volumes_saida = {}
    encontrados = set()
    for v in s.get("volumes", []):
        exigir(isinstance(v, dict) and v.get("read_only") is True and
               v.get("target") not in encontrados, "CONSULTA_VOLUME_RECUSADO")
        target = v["target"]
        encontrados.add(target)
        m = mounts.get(target, {})
        exigir(v.get("type") == m.get("Type"), "CONSULTA_MONTAGEM_DIVERGENTE")
        if v["type"] == "bind":
            exigir(v.get("source") == m.get("Source"), "CONSULTA_MONTAGEM_DIVERGENTE")
            if target == "/release":
                exigir(v["source"] == RELEASE_ORIGEM, "CONSULTA_RELEASE_ATUAL_DIVERGENTE")
                v["source"] = nova_release
            else:
                esperados = {"/run/secrets/consulta.json": BASE + "/consulta/consulta.json",
                             "/run/secrets/conta-hub.json": BASE + "/consulta/conta-hub.json",
                             "/run/secrets/media-index.json": INDICE_MIDIA,
                             "/midia": MIDIA_ORIGEM}
                exigir(esperados.get(target) == v["source"], "CONSULTA_BIND_RECUSADO")
        else:
            n = config.get("volumes", {}).get(v.get("source"), {})
            exigir(v["type"] == "volume" and target == "/incrementais" and
                   n.get("external") is True and n.get("name") == m.get("Name") ==
                   "grazing-donatella-coletor-v2-estado", "CONSULTA_VOLUME_NAO_EXISTENTE")
            volumes_saida[v["source"]] = copy.deepcopy(n)
    exigir(encontrados == set(mounts) == {"/release", "/run/secrets/consulta.json", "/run/secrets/conta-hub.json", "/run/secrets/media-index.json", "/midia", "/incrementais"}, "CONSULTA_MONTAGENS_DIVERGENTES")
    tmpfs = s.get("tmpfs", [])
    exigir(tmpfs == ["/tmp:rw,noexec,nosuid,size=64m"] and
           h.get("Tmpfs") == {"/tmp": "rw,noexec,nosuid,size=64m"}, "CONSULTA_TMPFS_DIVERGENTE")
    exigir(s.get("healthcheck", {}).get("test") == c.get("Healthcheck", {}).get("Test"), "CONSULTA_HEALTHCHECK_DIVERGENTE")
    return {"name": PROJETO, "services": {"consulta": s}, "networks": redes_saida, "volumes": volumes_saida}


def estado_outros():
    return {n: {"id": (a := inspect(n))["Id"], "inicio": a["State"]["StartedAt"],
                "reinicios": a["RestartCount"], "status": a["State"]["Status"]} for n in OUTROS}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--sha256", required=True)
    p.add_argument("--aplicar", action="store_true")
    args = p.parse_args()
    exigir(re.fullmatch(r"[a-f0-9]{64}", args.sha256) is not None, "CONSULTA_HASH_RECUSADO")
    prefixo = args.sha256[:12]
    bundle = caminho_existente(BASE + "/consulta-reader-" + prefixo + ".mjs", "bundle")
    exigir(0 < bundle.stat().st_size < 64 * 1024 * 1024 and
           hashlib.sha256(bundle.read_bytes()).hexdigest() == args.sha256, "CONSULTA_BUNDLE_DIVERGENTE")
    origem = caminho_existente(RELEASE_ORIGEM, "release", diretorio=True)
    stage = Path(BASE + "/release-consulta-" + prefixo)
    compose = Path(BASE + "/compose.consulta-reader-" + prefixo + ".yml")
    exigir(not stage.exists() and not stage.is_symlink() and not compose.exists() and not compose.is_symlink(), "CONSULTA_DESTINO_JA_EXISTE")
    exigir(shutil.disk_usage(BASE).free > 5_000_000_000, "CONSULTA_ESPACO_REQUER_REVISAO")
    # Recusar links no clone antes de copiar qualquer byte.
    for caminho in origem.rglob("*"):
        exigir(not caminho.is_symlink() and (caminho.is_dir() or caminho.is_file()), "CONSULTA_RELEASE_CONTEM_LINK_OU_ESPECIAL")
    atual = inspect(CONSULTA)
    exigir(atual["State"]["Status"] == "running" and
           atual["State"].get("Health", {}).get("Status") == "healthy", "CONSULTA_NAO_SAUDAVEL")
    exigir(inspect(IMAGEM)["Id"] == atual["Image"], "CONSULTA_IMAGEM_LOCAL_DIVERGENTE")
    compose_antiga = caminho_existente(atual["Config"]["Labels"].get("com.docker.compose.project.config_files", ""), "compose")
    config = json.loads(docker("compose", "-f", str(compose_antiga), "config", "--format", "json"))
    nova = configurar_consulta(config, atual, str(stage))
    antes = estado_outros()
    if not args.aplicar:
        print(json.dumps({"conferencia": "apta", "aplicado": False, "bundleSha256": args.sha256,
                          "servico": "consulta", "release": str(stage), "compose": str(compose)}))
        return
    os.umask(0o077)
    shutil.copytree(origem, stage)
    os.chmod(stage, 0o700)
    shutil.copyfile(bundle, stage / "consulta.mjs")
    os.chmod(stage / "consulta.mjs", 0o600)
    exigir(hashlib.sha256((stage / "consulta.mjs").read_bytes()).hexdigest() == args.sha256, "CONSULTA_OVERLAY_DIVERGENTE")
    with compose.open("x") as f:
        json.dump(nova, f, indent=2)
        f.flush()
        os.fsync(f.fileno())
    docker("compose", "-f", str(compose), "config", "--quiet")
    # Zero pull, somente reader. Não é rotina de virada nem reinício de coletor.
    docker("compose", "-f", str(compose), "up", "-d", "--no-deps", "--pull", "never", "consulta")
    exigir(estado_outros() == antes, "CONSULTA_OUTRO_SERVICO_ALTERADO_REQUER_REVISAO")
    publicado = inspect(CONSULTA)
    exigir(any(m.get("Source") == str(stage) and m.get("Destination") == "/release" and m.get("RW") is False
               for m in publicado["Mounts"]), "CONSULTA_RELEASE_PUBLICADA_DIVERGENTE")
    print(json.dumps({"aplicado": True, "bundleSha256": args.sha256, "servico": "consulta",
                      "release": str(stage), "compose": str(compose), "outrosServicosPreservados": True,
                      "estado": publicado["State"]["Status"], "homologacaoFuncionalComprovada": False}))


if __name__ == "__main__":
    try:
        main()
    except (Recusado, OSError, ValueError, KeyError, TypeError) as e:
        print(str(e) if isinstance(e, Recusado) else "CONSULTA_PUBLICACAO_FALHOU_SEM_DETALHE_SENSIVEL", file=sys.stderr)
        sys.exit(1)
