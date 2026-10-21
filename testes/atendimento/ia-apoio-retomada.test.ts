import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
vi.mock("server-only", () => ({}));
import { RepositorioHomologacaoIAArquivo } from "../../src/lib/atendimento/homologacao-ia-arquivo";
import { ServicoDuvidas } from "../../src/lib/atendimento/duvidas-aprendizagem";
import { RepositorioDuvidasArquivoFicticio } from "../../src/lib/atendimento/repositorio-duvidas-arquivo-ficticio";
import { orquestrarIA, type FonteIA, type PortasIA, type TarefaIA } from "../../src/lib/atendimento/ia-orquestrador";
let raiz: string, ia: RepositorioHomologacaoIAArquivo, duvidas: ServicoDuvidas;
const ator = { id: "demo-allan", empresaId: "demo-grazing", versaoSessao: 1 };
const t: TarefaIA = { id: "demo-pedido-apoio", atorId: ator.id, empresaId: ator.empresaId, conversaId: "demo-conversa", clienteId: "demo-cliente", versao: 1, mensagemOrigemId: "demo-mensagem", pergunta: "Qual o preço fictício vigente?", tema: "preco" };
const limites = { maxChamadas: 2, custoPorChamadaCentavos: 10, maxCustoCentavos: 20, maxDuracaoMs: 1000, timeoutChamadaMs: 50 };
const fontes: FonteIA[] = [{ id: "demo-preco", versao: 7, empresaId: t.empresaId, clienteId: t.clienteId, tema: "preco", origem: "ferramenta", estado: "aprovado", inicio: 0, fim: 100000, conteudo: "Preço fictício: R$ 189,90." }];
const refs = [{ id: "demo-preco", versao: 7 }];
function adapters() {
  ia = new RepositorioHomologacaoIAArquivo(join(raiz, "donatella-ia-ficticia"));
  duvidas = new ServicoDuvidas({
    repositorio: new RepositorioDuvidasArquivoFicticio(join(raiz, "donatella-duvidas-ficticias")),
    autorizar: async () => true,
    contextoConversa: async () => { const c = await ia.contexto(t); return c ? { empresaId: c.empresaId, conversaId: c.conversaId, clienteId: c.clienteId, versao: c.versao, estado: "aberta", autoridade: c.estado === "ia" ? "ia" : "humano", janelaClienteAte: new Date(Date.now() + 3600000).toISOString(), revisaoRegras: 1 } : null; },
  });
}
function portas(solicitarApoio: PortasIA["solicitarApoio"]): PortasIA {
  return { repositorio: ia, autorizar: async () => true, conhecimento: vi.fn(async () => []), ferramenta: vi.fn(async () => fontes), provedor: vi.fn(async () => ({ selecoes: [{ id: "demo-referencia-inventada", versao: 1 }] })), revalidarFontes: vi.fn(async () => true), solicitarApoio, agora: () => 100 };
}
const solicitar: PortasIA["solicitarApoio"] = async (tarefa, _motivo, referencias) => duvidas.solicitarApoio(ator, { empresaId: tarefa.empresaId, conversaId: tarefa.conversaId, versaoConversa: tarefa.versao, mensagemOrigemId: tarefa.mensagemOrigemId, pergunta: tarefa.pergunta, contextoFactual: "Ensaio fictício.", dadosNecessarios: "Validar a fonte fictícia.", fontes: referencias, motivo: "fonte_insuficiente", equipeId: "demo-equipe", prioridade: "normal", expiraEm: new Date(Date.now() + 86400000).toISOString() });
beforeEach(async () => { raiz = await mkdtemp(join(tmpdir(), "donatella-laboratorio-ficticio-")); adapters(); await ia.definirContexto({ ...t, estado: "ia", modo: "rascunho" }); });
afterEach(async () => { if (!resolve(raiz).startsWith(resolve(tmpdir()) + sep + "donatella-laboratorio-ficticio-")) throw Error("TEMPORARIO_FORA_DO_ESCOPO"); await rm(raiz, { recursive: true, force: true }); });
it.each(["antes", "apos_commit"])("falha %s da criação persiste e retoma após reinício dos dois adapters, sem repetir chamadas pagas", async momento => {
  let tentativa = 0, casoConfirmado: string | undefined;
  const apoio = vi.fn<PortasIA["solicitarApoio"]>(async (...args) => {
    tentativa++;
    if (tentativa === 1 && momento === "antes") throw Error("FALHA_TRANSITORIA");
    const caso = await solicitar(...args); casoConfirmado = caso.id;
    if (tentativa === 1) throw Error("RESPOSTA_DO_ADAPTER_PERDIDA_APOS_COMMIT");
    return caso;
  });
  const p = portas(apoio), primeira = await orquestrarIA(t, limites, p);
  expect(primeira).toEqual({ estado: "apoio_pendente", motivo: "RESPOSTA_SEM_FUNDAMENTO", falha: "APOIO_INDISPONIVEL", fontes: refs, enviosReais: false });
  expect((await ia.registros())[0]).toMatchObject({ tarefa: t, chamadas: 2, custoReservadoCentavos: 20, decisao: primeira });
  const idAnterior = casoConfirmado; adapters();
  const segunda = await orquestrarIA(t, limites, { ...p, repositorio: ia });
  expect(segunda).toMatchObject({ estado: "aguardando_apoio", motivo: "RESPOSTA_SEM_FUNDAMENTO", fontes: refs, casoId: casoConfirmado, enviosReais: false });
  if (idAnterior) expect(casoConfirmado).toBe(idAnterior);
  const casos = await duvidas.listarCasos(ator); expect(casos).toHaveLength(1);
  expect(casos[0]).toMatchObject({ id: casoConfirmado, mensagemOrigemId: t.mensagemOrigemId, versaoConversa: t.versao, fontes: refs });
  expect(apoio).toHaveBeenNthCalledWith(1, t, "RESPOSTA_SEM_FUNDAMENTO", refs);
  expect(apoio).toHaveBeenNthCalledWith(2, t, "RESPOSTA_SEM_FUNDAMENTO", refs);
  expect(p.ferramenta).toHaveBeenCalledTimes(1); expect(p.provedor).toHaveBeenCalledTimes(1);
  expect((await ia.registros())[0]).toMatchObject({ chamadas: 2, custoReservadoCentavos: 20 });
  expect(await orquestrarIA(t, limites, { ...p, repositorio: ia })).toEqual(segunda);
  expect(apoio).toHaveBeenCalledTimes(2);
});
it("duas retomadas concorrentes preservam uma única criação de caso e orçamento já consumido", async () => {
  const apoio = vi.fn<PortasIA["solicitarApoio"]>().mockRejectedValueOnce(Error("TRANSITORIA")).mockImplementation(solicitar);
  const p = portas(apoio); await orquestrarIA(t, limites, p);
  const resultados = await Promise.all([orquestrarIA(t, limites, { ...p, repositorio: new RepositorioHomologacaoIAArquivo(join(raiz, "donatella-ia-ficticia")) }), orquestrarIA(t, limites, { ...p, repositorio: new RepositorioHomologacaoIAArquivo(join(raiz, "donatella-ia-ficticia")) })]);
  expect(resultados.some(r => r.estado === "aguardando_apoio")).toBe(true);
  expect(await duvidas.listarCasos(ator)).toHaveLength(1);
  expect(apoio).toHaveBeenCalledTimes(2); expect(p.ferramenta).toHaveBeenCalledTimes(1); expect(p.provedor).toHaveBeenCalledTimes(1);
});
it("nenhuma criação é confirmada sem ID válido; revogação impede a retomada", async () => {
  const apoio = vi.fn<PortasIA["solicitarApoio"]>(async () => ({ id: "" })), p = portas(apoio);
  expect(await orquestrarIA(t, limites, p)).toMatchObject({ estado: "apoio_pendente", falha: "APOIO_INDISPONIVEL" });
  expect(await orquestrarIA(t, limites, { ...p, autorizar: async () => false })).toMatchObject({ estado: "invalidado" });
  expect(apoio).toHaveBeenCalledTimes(1); expect(p.ferramenta).toHaveBeenCalledTimes(1); expect(p.provedor).toHaveBeenCalledTimes(1);
});
it("checkpoint de apoio existe antes de chamar o adapter e usa fencing entre tentativas", async () => {
  const apoio = vi.fn<PortasIA["solicitarApoio"]>(async (...args) => {
    const registro = (await ia.registros())[0];
    expect(registro.decisao).toMatchObject({ estado: "apoio_pendente", motivo: "RESPOSTA_SEM_FUNDAMENTO", fontes: refs });
    expect(registro.leaseAte).toBeGreaterThan(100);
    return solicitar(...args);
  });
  const p = portas(apoio);
  expect(await orquestrarIA(t, limites, p)).toMatchObject({ estado: "aguardando_apoio" });
  expect(apoio).toHaveBeenCalledTimes(1);
});
it("registro legado sem caso é retomável com limite explícito do motivo perdido, sem reinferência", async () => {
  const reserva = await ia.reservar(t, 100, 1000);
  await ia.reservarChamada(t.id, reserva!.lease, limites, 101);
  await ia.reservarChamada(t.id, reserva!.lease, limites, 102);
  const arquivo = join(raiz, "donatella-ia-ficticia", "estado.json");
  const anterior = JSON.parse(await readFile(arquivo, "utf8"));
  anterior.trabalhos[t.id].decisao = { estado: "aguardando_apoio", motivo: "APOIO_INDISPONIVEL", fontes: refs, enviosReais: false };
  await writeFile(arquivo, JSON.stringify(anterior)); adapters();
  expect((await ia.registros())[0].decisao).toMatchObject({ estado: "apoio_pendente", motivo: "MOTIVO_ORIGINAL_NAO_PRESERVADO", motivoOriginalNaoPreservado: true, fontes: refs });
  const apoio = vi.fn(solicitar), p = portas(apoio);
  expect(await orquestrarIA(t, limites, p)).toMatchObject({ estado: "aguardando_apoio", motivo: "MOTIVO_ORIGINAL_NAO_PRESERVADO" });
  expect(p.ferramenta).not.toHaveBeenCalled(); expect(p.provedor).not.toHaveBeenCalled();
  expect((await ia.registros())[0]).toMatchObject({ chamadas: 2, custoReservadoCentavos: 20 });
  expect(await duvidas.listarCasos(ator)).toHaveLength(1);
});
