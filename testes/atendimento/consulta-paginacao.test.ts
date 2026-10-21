import { describe, expect, it, vi } from "vitest";
import { criarClienteConsulta, type HistoricoConsulta } from "../../apps/atendimento-chat-consulta/api";
import { HistoricoMensagemExcedente, LIMITE_BYTES_HISTORICO, paginarHistoricoPorBytes, type LinhaHistoricoPreparada, type PaginaHistoricoPorBytes } from "../../scripts/atendimento/consulta-paginacao";
import { validarCursorHistorico, type CursorHistoricoConsulta } from "../../scripts/atendimento/consulta-cursor";

const conversa = "11111111-1111-4111-8111-111111111111";
const identificador = (i: number) => i.toString(16).padStart(8, "0") + "-1111-4111-8111-111111111111";
const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v), "utf8");
function linha(i: number, content = "Texto fictício") {
  const id = identificador(i), antes = `2026-10-10T01:00:00.${(999999 - i).toString().padStart(6, "0")}Z`;
  const registro = { id, from_type: "user", type: "text", content, created_at: "2026-10-10T01:00:00.999Z", sent_at: "2026-10-10T01:00:00.999Z", status: "sent", autoria: "Contato", anexo: null, anexoIndisponivel: false };
  return { registro, cursor: { antes, id } };
}
type Registro = ReturnType<typeof linha>["registro"];
const comparar = (a: CursorHistoricoConsulta, b: CursorHistoricoConsulta) => a.antes === b.antes ? a.id === b.id ? 0 : a.id < b.id ? -1 : 1 : a.antes < b.antes ? -1 : 1;

describe("paginação do histórico preserva conteúdo com orçamento UTF-8", () => {
  it("entrega página pequena inteira em ordem cronológica, sem modificar a entrada", () => {
    const linhas = [linha(1), linha(2), linha(3)];
    const antes = structuredClone(linhas); Object.freeze(linhas);
    const p = paginarHistoricoPorBytes(linhas, false);
    expect(p).toEqual({ registros: [...linhas].reverse().map(l => l.registro), mais: false, cursor: linhas[2].cursor });
    expect(linhas).toEqual(antes); expect(bytes(p)).toBeLessThanOrEqual(LIMITE_BYTES_HISTORICO);
    expect(p.registros[0]).toBe(linhas[2].registro);
  });

  it("divide e recupera por GET e cursor os 50 textos de 25.000 caracteres, sem perda ou duplicação", async () => {
    const linhas = Array.from({ length: 50 }, (_, i) => linha(i + 1, "x".repeat(25000)));
    expect(bytes({ registros: linhas.map(l => l.registro), mais: false, cursor: linhas.at(-1)!.cursor })).toBeGreaterThan(LIMITE_BYTES_HISTORICO);
    const p = paginarHistoricoPorBytes(linhas, false);
    expect(p.registros.length).toBeGreaterThan(0); expect(p.registros.length).toBeLessThan(50);
    expect(p.mais).toBe(true); expect(bytes(p)).toBeLessThanOrEqual(LIMITE_BYTES_HISTORICO);
    expect(p.cursor).toEqual(linhas[p.registros.length - 1].cursor);
    expect(p.registros).toEqual(linhas.slice(0, p.registros.length).reverse().map(l => l.registro));
    for (const r of p.registros) expect(r.content).toBe("x".repeat(25000));

    const respostas: PaginaHistoricoPorBytes<Registro>[] = [], pedidos: (CursorHistoricoConsulta | null)[] = [];
    const buscar = vi.fn<typeof fetch>(async entrada => {
      const url = new URL(String(entrada), "https://fixture.invalid");
      expect(url.pathname).toBe("/api/historico");
      const consulta = validarCursorHistorico(url.searchParams.get("conversa") ?? "", url.searchParams.get("antes"), url.searchParams.get("id"));
      expect(consulta.conversa).toBe(conversa);
      const recebido = consulta.antes === null ? null : { antes: consulta.antes, id: consulta.id! };
      pedidos.push(recebido);
      const restantes = linhas.filter(l => !recebido || comparar(l.cursor, recebido) < 0).slice(0, 51);
      const resposta = paginarHistoricoPorBytes(restantes.slice(0, 50), restantes.length > 50);
      expect(bytes(resposta)).toBeLessThanOrEqual(LIMITE_BYTES_HISTORICO);
      respostas.push(resposta);
      return new Response(JSON.stringify(resposta), { headers: { "content-type": "application/json" } });
    });
    const cliente = criarClienteConsulta(buscar), paginas: HistoricoConsulta[] = [];
    let cursor: CursorHistoricoConsulta | null = null, mais = true;
    while (mais) {
      const pagina = await cliente.historico(conversa, cursor);
      expect(pagina.registros.length).toBeGreaterThan(0);
      paginas.push(pagina); cursor = pagina.cursor; mais = pagina.mais;
      if (paginas.length > 2) throw Error("FIXTURE_NAO_CONCLUIU_EM_DUAS_PAGINAS");
    }
    expect(paginas).toHaveLength(2); expect(respostas).toHaveLength(2);
    expect(pedidos).toEqual([null, p.cursor]);
    expect(paginas[0]).toEqual(p); expect(paginas[1].mais).toBe(false);
    expect(paginas[1].cursor).toEqual(linhas[49].cursor);
    const completos = [...paginas].reverse().flatMap(pagina => pagina.registros);
    expect(completos).toEqual([...linhas].reverse().map(l => l.registro));
    expect(new Set(completos.map(r => r.id)).size).toBe(50);
    for (const registro of completos) expect(registro.content).toBe("x".repeat(25000));
    for (const [url, opcoes] of buscar.mock.calls) {
      expect(String(url)).toMatch(/^\/api\/historico\?conversa=/);
      expect(opcoes).toMatchObject({ method: "GET", credentials: "same-origin" });
    }
  });

  it("retoma várias páginas usando cada cursor entregue, conservando IDs, textos e ordem sem duplicatas", () => {
    const origem: LinhaHistoricoPreparada<Registro>[] = Array.from({ length: 123 }, (_, i) => linha(i + 1, (i % 2 ? "Texto🙂\n" : "Texto ASCII ").repeat(4000)));
    const paginas: Registro[][] = []; let cursor: CursorHistoricoConsulta | null = null, mais = true, iteracoes = 0;
    while (mais) {
      const restantes = origem.filter(l => !cursor || comparar(l.cursor, cursor) < 0).slice(0, 51);
      const p = paginarHistoricoPorBytes(restantes.slice(0, 50), restantes.length > 50);
      expect(p.registros.length).toBeGreaterThan(0); expect(p.registros.length).toBeLessThanOrEqual(50); expect(bytes(p)).toBeLessThanOrEqual(LIMITE_BYTES_HISTORICO);
      expect(p.cursor).toEqual(restantes[p.registros.length - 1].cursor);
      paginas.push(p.registros); cursor = p.cursor; mais = p.mais;
      if (++iteracoes > 123) throw Error("PAGINACAO_NAO_AVANCOU");
    }
    const cronologicos = paginas.reverse().flat();
    expect(cronologicos).toEqual([...origem].reverse().map(l => l.registro));
    expect(new Set(cronologicos.map(r => r.id)).size).toBe(origem.length);
    expect(iteracoes).toBeGreaterThan(3);
  });

  it.each(["á", "🙂", "\n", "\u0000", '"', "\\", "ç\t🙂\n\u0001"])("conta bytes UTF-8 e escapes JSON no envelope para %j", caractere => {
    const linhas = [linha(1, caractere.repeat(100)), linha(2, caractere.repeat(100))];
    const prefixo = { registros: [linhas[0].registro], mais: true, cursor: linhas[0].cursor };
    const limite = bytes(prefixo), p = paginarHistoricoPorBytes(linhas, false, limite);
    expect(p).toEqual(prefixo); expect(bytes(p)).toBe(limite); expect(p.registros[0].content).toBe(caractere.repeat(100));
    expect(() => paginarHistoricoPorBytes(linhas, false, limite - 1)).toThrow(HistoricoMensagemExcedente);
  });

  it.each([false, true])("inclui envelope, cursor e mais=%s na fronteira exata de uma mensagem", maisNaOrigem => {
    const l = linha(1, "Mensagem fictícia"), esperado = { registros: [l.registro], mais: maisNaOrigem, cursor: l.cursor };
    const limite = bytes(esperado);
    expect(paginarHistoricoPorBytes([l], maisNaOrigem, limite)).toEqual(esperado);
    expect(() => paginarHistoricoPorBytes([l], maisNaOrigem, limite - 1)).toThrow(HistoricoMensagemExcedente);
    expect(() => paginarHistoricoPorBytes([l], maisNaOrigem, bytes({ registros: [l.registro], mais: maisNaOrigem, cursor: null }))).toThrow(HistoricoMensagemExcedente);
  });

  it("conta false um byte maior que true antes de decidir a última inclusão", () => {
    const linhas = [linha(1, "a"), linha(2, "b")];
    const completo = { registros: [linhas[1].registro, linhas[0].registro], mais: false, cursor: linhas[1].cursor };
    const falsoMenosUm = bytes(completo) - 1;
    const p = paginarHistoricoPorBytes(linhas, false, falsoMenosUm);
    expect(p).toEqual({ registros: [linhas[0].registro], mais: true, cursor: linhas[0].cursor });
    expect(bytes(p)).toBeLessThanOrEqual(falsoMenosUm);
    expect(paginarHistoricoPorBytes(linhas, false, bytes(completo))).toEqual(completo);
    expect(paginarHistoricoPorBytes(linhas, true, falsoMenosUm)).toEqual({ ...completo, mais: true });
  });

  it("erro da primeira mensagem excedente é explícito e não contém texto, ID ou cursor", () => {
    const l = linha(1, "SEGREDO_FICTICIO_".repeat(80000));
    let capturado: unknown; try { paginarHistoricoPorBytes([l], false); } catch (erro) { capturado = erro; }
    expect(capturado).toBeInstanceOf(HistoricoMensagemExcedente);
    expect((capturado as Error).message).toBe("HISTORICO_MENSAGEM_EXCEDENTE");
    expect(String(capturado)).not.toContain("SEGREDO_FICTICIO"); expect(JSON.stringify(capturado)).not.toContain(l.registro.id);
    expect(Object.keys(capturado as object)).toEqual(["name"]);
  });

  it("mensagem excedente posterior devolve só o prefixo; retomada recusa a mesma linha sem saltar", () => {
    const linhas = [linha(1), linha(2), linha(3, "x".repeat(LIMITE_BYTES_HISTORICO)), linha(4)];
    const p = paginarHistoricoPorBytes(linhas, false);
    expect(p).toEqual({ registros: [linhas[1].registro, linhas[0].registro], mais: true, cursor: linhas[1].cursor });
    const restantes = linhas.filter(l => comparar(l.cursor, p.cursor!) < 0);
    expect(restantes[0]).toBe(linhas[2]);
    expect(() => paginarHistoricoPorBytes(restantes, false)).toThrow(HistoricoMensagemExcedente);
    expect(linhas[3].registro.content).toBe("Texto fictício");
  });

  it("preserva o sinal de mais registros na origem mesmo quando todas as 50 linhas cabem", () => {
    const linhas = Array.from({ length: 50 }, (_, i) => linha(i + 1));
    const p = paginarHistoricoPorBytes(linhas, true);
    expect(p.registros).toHaveLength(50); expect(p.mais).toBe(true); expect(p.cursor).toEqual(linhas[49].cursor);
    expect(paginarHistoricoPorBytes(linhas, false).mais).toBe(false);
  });

  it("página vazia preserva cursor nulo e respeita inclusive o orçamento do envelope vazio", () => {
    const p = { registros: [], mais: false, cursor: null };
    expect(paginarHistoricoPorBytes([], false)).toEqual(p);
    expect(paginarHistoricoPorBytes([], false, bytes(p))).toEqual(p);
    expect(() => paginarHistoricoPorBytes([], false, bytes(p) - 1)).toThrow("HISTORICO_CONTRATO_INVALIDO");
    expect(() => paginarHistoricoPorBytes([], true)).toThrow("HISTORICO_CONTRATO_INVALIDO");
  });

  it.each([0, -1, 1.5, NaN, LIMITE_BYTES_HISTORICO + 1])("recusa orçamento inválido %s sem elevar o teto", limite => {
    expect(() => paginarHistoricoPorBytes([linha(1)], false, limite)).toThrow("HISTORICO_CONTRATO_INVALIDO");
  });

  it("recusa mais de 50 entradas sem truncar silenciosamente", () => {
    expect(() => paginarHistoricoPorBytes(Array.from({ length: 51 }, (_, i) => linha(i + 1)), false)).toThrow("HISTORICO_CONTRATO_INVALIDO");
  });

  it("recusa cursor inexato e registro não serializável sem vazar o conteúdo do erro", () => {
    expect(() => paginarHistoricoPorBytes([{ registro: {}, cursor: { id: identificador(1), antes: "2026-10-10T01:00:00.123Z" } }], false)).toThrow("HISTORICO_CONTRATO_INVALIDO");
    const ciclico: Record<string, unknown> = { texto: "NAO_REFLETIR" }; ciclico.self = ciclico;
    expect(() => paginarHistoricoPorBytes([{ registro: ciclico, cursor: linha(1).cursor }], false)).toThrow("HISTORICO_CONTRATO_INVALIDO");
  });

  it("cliente consome a mensagem única de 250.000 caracteres completa dentro do teto de 1 MiB", async () => {
    const l = linha(1, "x".repeat(250000)), p = paginarHistoricoPorBytes([l], false);
    const buscar = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(p), { headers: { "content-type": "application/json" } }));
    const consumido = await criarClienteConsulta(buscar).historico(conversa);
    expect(bytes(p)).toBeLessThan(LIMITE_BYTES_HISTORICO);
    expect(consumido.registros[0].content).toBe(l.registro.content);
    expect(consumido.cursor).toEqual(l.cursor); expect(consumido.mais).toBe(false);
  });
});
