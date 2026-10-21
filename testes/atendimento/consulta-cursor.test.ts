import { describe, expect, it, vi } from "vitest";
import { types } from "pg";
import { COLUNA_CURSOR_HISTORICO, cursorHistoricoDaLinha, validarCursorHistorico, type CursorHistoricoConsulta } from "../../scripts/atendimento/consulta-cursor";
import { criarClienteConsulta } from "../../apps/atendimento-chat-consulta/api";

const conversa = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const exato = "2026-10-10T01:00:00.123851Z";
type Linha = { id: string; cursor_antes: string };
const identificador = (i: number) => i.toString(16).padStart(8, "0") + "-1111-4111-8111-111111111111";
// Mesma ordem da chave SQL, com instantes UTC canônicos e UUIDs normalizados da fixture.
const comparar = (a: Linha, b: Linha) => a.cursor_antes === b.cursor_antes
  ? a.id === b.id ? 0 : a.id < b.id ? -1 : 1
  : a.cursor_antes < b.cursor_antes ? -1 : 1;
function pagina(registros: Linha[], cursor: CursorHistoricoConsulta | null = null) {
  const restantes = registros.filter(r => !cursor || comparar(r, { id: cursor.id, cursor_antes: cursor.antes }) < 0).sort((a, b) => -comparar(a, b)).slice(0, 51);
  const exibidos = restantes.slice(0, 50), ultimo = exibidos.at(-1);
  return { registros: exibidos, mais: restantes.length > 50, cursor: ultimo ? cursorHistoricoDaLinha(ultimo) : null };
}

describe("cursor do histórico conserva a chave precisa do PostgreSQL", () => {
  it("reproduz o salto do cursor Date antigo com 51 mensagens no mesmo milissegundo", () => {
    const micros = Array.from({ length: 51 }, (_, i) => BigInt(123900) - BigInt(i));
    const limite = micros[49];
    // Parser efetivamente usado por pg, sem conexão ou credencial.
    const convertido = types.getTypeParser(1184, "text")(`2026-10-10 01:00:00.${limite}+00`);
    const antigo = JSON.parse(JSON.stringify({ antes: convertido, id })).antes as string;
    expect(antigo).toBe("2026-10-10T01:00:00.123Z");
    expect(micros.filter(v => v < limite)).toHaveLength(1);
    expect(micros.filter(v => v < BigInt(new Date(antigo).getUTCMilliseconds()) * BigInt(1000))).toHaveLength(0);
    expect(cursorHistoricoDaLinha({ id, cursor_antes: exato })).toEqual({ antes: exato, id });
  });

  it.each([51, 137])("pagina %s mensagens com microssegundos e empates por UUID, sem omitir ou duplicar", quantidade => {
    const registros = Array.from({ length: quantidade }, (_, i) => ({ id: identificador(i + 1), cursor_antes: `2026-10-10T01:00:00.${123900 - Math.floor(i / 3)}Z` }));
    const recebidos: Linha[] = []; let cursor: CursorHistoricoConsulta | null = null, mais = true;
    while (mais) {
      const p = pagina(registros, cursor);
      expect(p.registros.length).toBeGreaterThan(0);
      recebidos.push(...p.registros); mais = p.mais; cursor = p.cursor;
      if (cursor) expect(validarCursorHistorico(conversa, cursor.antes, cursor.id)).toEqual({ conversa, ...cursor });
    }
    expect(recebidos.map(r => r.id)).toEqual([...registros].sort((a, b) => -comparar(a, b)).map(r => r.id));
    expect(new Set(recebidos.map(r => r.id)).size).toBe(quantidade);
  });

  it("mantém o instante textual de seis casas no cliente e no próximo GET", async () => {
    const mensagem = { id, from_type: "user", type: "text", content: "Texto fictício", created_at: "2026-10-10T01:00:00.123Z", sent_at: "2026-10-10T01:00:00.123Z", status: "sent", autoria: "Contato", anexo: null, anexoIndisponivel: false };
    const buscar = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ registros: [mensagem], mais: false, cursor: { antes: exato, id } }), { headers: { "content-type": "application/json" } }));
    const cliente = criarClienteConsulta(buscar), primeira = await cliente.historico(conversa);
    expect(primeira.cursor).toEqual({ antes: exato, id });
    await cliente.historico(conversa, primeira.cursor);
    expect(buscar.mock.calls[1][0]).toBe(`/api/historico?conversa=${conversa}&antes=${encodeURIComponent(exato)}&id=${id}`);
    const parametros = validarCursorHistorico(conversa, primeira.cursor!.antes, primeira.cursor!.id);
    expect([parametros.conversa, parametros.antes, parametros.id]).toEqual([conversa, exato, id]);
  });

  it("deriva o cursor de uma coluna textual UTC de seis casas, sem substituir created_at da mensagem", () => {
    expect(COLUNA_CURSOR_HISTORICO).toBe(`to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_antes`);
    const linha = { id, cursor_antes: exato, created_at: new Date("2026-10-10T01:00:00.123Z") };
    expect(cursorHistoricoDaLinha(linha)).toEqual({ antes: exato, id });
    expect(linha.created_at.toISOString()).toBe("2026-10-10T01:00:00.123Z");
  });

  it("permite a primeira página somente com ambos os componentes ausentes", () => {
    expect(validarCursorHistorico(conversa, null, null)).toEqual({ conversa, antes: null, id: null });
    expect(pagina([])).toEqual({ registros: [], mais: false, cursor: null });
  });

  it.each(["2026-10-10T01:00:00.123Z", exato, "2026-10-10T01:00:00Z", "2026-10-10T01:00:00.1Z", "2024-02-29T01:00:00.000000Z", "2000-02-29T01:00:00.000Z", "2026-10-10T01:00:00.123-03:00", "2026-10-10T01:00:00.123+14:00"])("aceita cursor ISO válido e preserva o valor recebido: %s", antes => {
    expect(validarCursorHistorico(conversa, antes, id)).toEqual({ conversa, antes, id });
  });

  it.each([
    [null, id], [exato, null], ["", id], [exato, ""], ["", ""],
  ] as const)("recusa cursor parcial antes=%s id=%s", (antes, identificador) => {
    expect(() => validarCursorHistorico(conversa, antes, identificador)).toThrow("CURSOR_INVALIDO");
  });

  it.each([
    "2026-10-10T01:00:00.1238519Z", "2026-10-10 01:00:00.123851+00", "2026-10-10T01:00:00.123851z",
    "2026-02-29T01:00:00.123Z", "1900-02-29T01:00:00.123Z", "2026-04-31T01:00:00.123Z",
    "0000-10-10T01:00:00.123Z", "10000-10-10T01:00:00.123Z", "2026-00-10T01:00:00.123Z", "2026-13-10T01:00:00.123Z",
    "2026-10-00T01:00:00.123Z", "2026-10-32T01:00:00.123Z", "2026-10-10T24:00:00.123Z", "2026-10-10T01:60:00.123Z", "2026-10-10T01:00:60.123Z",
    "2026-10-10T01:00:00.123+15:00", "2026-10-10T01:00:00.123-14:01", "2026-10-10T01:00:00.123+03:60", "2026-10-10T01:00:00.123+0300",
    "2026-10-10", "infinity", "2026-10-10T01:00:00.123Z' OR TRUE", "2026-10-10T01:00:00.123Z\n",
  ])("recusa instante ambíguo, inexato ou inválido: %s", antes => {
    expect(() => validarCursorHistorico(conversa, antes, id)).toThrow("CURSOR_INVALIDO");
  });

  it.each(["", "id-ficticio", "11111111-1111-4111-8111-111111111111' OR TRUE", conversa + "\n"])("recusa identificador fora do contrato %s", invalido => {
    expect(() => validarCursorHistorico(invalido, null, null)).toThrow("CURSOR_INVALIDO");
    expect(() => validarCursorHistorico(conversa, exato, invalido)).toThrow("CURSOR_INVALIDO");
  });

  it.each([undefined, null, new Date("2026-10-10T01:00:00.123Z"), "2026-10-10T01:00:00.123Z", "2026-10-10T01:00:00.123851-03:00"])("não fabrica cursor preciso quando a coluna UTC exata está ausente ou incorreta: %s", cursor_antes => {
    expect(() => cursorHistoricoDaLinha({ id, cursor_antes })).toThrow();
  });
});
