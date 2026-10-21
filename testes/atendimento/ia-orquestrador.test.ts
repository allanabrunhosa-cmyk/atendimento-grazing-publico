import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
vi.mock("server-only", () => ({}));
import { CENARIOS_IA, executarCenarioIA } from "./fixtures/ia-cenarios";
const temporarios: string[] = [];
afterEach(async () => {
  for (const raiz of temporarios.splice(0)) {
    if (!resolve(raiz).startsWith(resolve(tmpdir()) + sep + "donatella-ia-ficticia-")) throw Error("TEMPORARIO_FORA_DO_ESCOPO");
    await rm(raiz, { recursive: true, force: true });
  }
});
describe("avaliação factual da Donatella com provedor e clientes fictícios", () => {
  it("mantém ao menos trinta cenários independentes de estilo", () => { expect(CENARIOS_IA.length).toBeGreaterThanOrEqual(30); });
  it.each(CENARIOS_IA)("$id — $descricao", async cenario => {
    const raiz = await mkdtemp(join(tmpdir(), "donatella-ia-ficticia-")); temporarios.push(raiz);
    const observacao = await executarCenarioIA(cenario, raiz);
    expect(observacao.metricas).toEqual({ desfecho: true, fatos: true, ferramenta: true, encaminhamento: true });
    expect("enviosReais" in observacao.resultado && observacao.resultado.enviosReais).toBe(false);
  });
});
