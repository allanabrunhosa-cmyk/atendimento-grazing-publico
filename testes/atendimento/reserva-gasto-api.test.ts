import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { gastoEstimadoCentavos } from '../../src/lib/atendimento/ia-modelos';
import { orquestrarIA, type ContextoIA, type FonteIA, type PortasIA, type TarefaIA } from '../../src/lib/atendimento/ia-orquestrador';

describe('gasto estimado de uma chamada ao modelo', () => {
  it('conta os tokens pelo preço do modelo, com folga, em centavos arredondados para cima', () => {
    // Sonnet 4.5 (US$ 3/15 por milhão): 5.000 de entrada e 300 de saída = US$ 0,02325 → com folga, 3 centavos.
    expect(gastoEstimadoCentavos('anthropic', 'claude-sonnet-4-5-20250929', { observado: true, tokensEntrada: 5000, tokensSaida: 300 })).toBe(3);
    expect(gastoEstimadoCentavos('anthropic', 'claude-sonnet-5-5', { observado: true, tokensEntrada: 5000, tokensSaida: 300 })).toBe(2);
    // A maior entrada aceita (64 KiB, uns 16 mil tokens) e 512 de saída ainda cabem bem abaixo da reserva de 50.
    expect(gastoEstimadoCentavos(undefined, 'claude-sonnet-4-5-20250929', { observado: true, tokensEntrada: 16000, tokensSaida: 512 })).toBe(9);
    // Cache entra como gravação; nunca fica abaixo de 1 centavo.
    expect(gastoEstimadoCentavos('anthropic', 'claude-sonnet-5-5', { observado: true, tokensEntrada: 100, tokensSaida: 10, tokensCacheLeitura: 20000 })).toBe(7);
    expect(gastoEstimadoCentavos('anthropic', 'claude-haiku-5-5', { observado: true, tokensEntrada: 200, tokensSaida: 40 })).toBe(1);
  });
  it('sem base para estimar, devolve null e a reserva fica inteira', () => {
    expect(gastoEstimadoCentavos('anthropic', 'claude-sonnet-5-5', { observado: false })).toBeNull();
    expect(gastoEstimadoCentavos('anthropic', 'claude-sonnet-5-5', { observado: true, tokensEntrada: 5000 })).toBeNull();
    expect(gastoEstimadoCentavos('anthropic', 'modelo-sem-preco', { observado: true, tokensEntrada: 5000, tokensSaida: 300 })).toBeNull();
    expect(gastoEstimadoCentavos('google', 'claude-sonnet-5-5', { observado: true, tokensEntrada: 5000, tokensSaida: 300 })).toBeNull();
    expect(gastoEstimadoCentavos('anthropic', 'constructor', { observado: true, tokensEntrada: 1, tokensSaida: 1 })).toBeNull();
    expect(gastoEstimadoCentavos('anthropic', 'claude-sonnet-5-5', { observado: true, tokensEntrada: 5000, tokensSaida: 300, tokensCacheLeitura: -1 })).toBeNull();
  });
});

describe('consultas não gastam o limite diário da API', () => {
  const limites = { maxChamadas: 3, custoPorChamadaCentavos: 50, maxCustoCentavos: 150, maxDuracaoMs: 5000, timeoutChamadaMs: 1500 };
  async function ensaio(tema: TarefaIA['tema'], pergunta: string) {
    const t: TarefaIA = { id: 'tarefa-reserva', atorId: 'service:donatella-ia', empresaId: 'grazing', conversaId: 'conversa-reserva', clienteId: 'cliente-reserva', versao: 1, mensagemOrigemId: 'mensagem-reserva', pergunta, tema };
    const contexto: ContextoIA = { ...t, estado: 'ia', modo: 'rascunho' };
    const fonte: FonteIA = { id: 'fonte-reserva', versao: 1, empresaId: 'grazing', clienteId: t.clienteId, tema, origem: tema === 'procedimento' ? 'conhecimento' : 'ferramenta', estado: 'aprovado', inicio: 0, fim: Date.now() + 60000, conteudo: 'Orientação fictícia aprovada para o ensaio.' };
    const reservas: (boolean | undefined)[] = [];
    const portas: PortasIA = {
      respostaRedigida: false, autorizar: async () => true, revalidarFontes: async () => true,
      conhecimento: async () => tema === 'procedimento' ? [fonte] : [], ferramenta: async () => [fonte],
      provedor: async p => ({ selecoes: [{ id: p.fontes[0].id, versao: p.fontes[0].versao }], pedirApoio: false }),
      solicitarApoio: async () => ({ id: 'apoio' }),
      repositorio: { contexto: async () => contexto, reservar: async () => ({ lease: 'lease' }), reservarChamada: async (_id, _l, _lim, _agora, semCustoApi) => { reservas.push(semCustoApi); return true; }, preservarApoio: async (_t, _l, d) => d, concluir: async (_t, _l, d) => d },
    };
    const r = await orquestrarIA(t, limites, portas);
    return { r, reservas };
  }
  it('a consulta à ferramenta e ao conhecimento é marcada sem custo; a chamada ao modelo não', async () => {
    for (const [tema, pergunta] of [['produto', 'Quero uma tábua para 4'], ['procedimento', 'Como funciona a retirada?']] as const) {
      const { r, reservas } = await ensaio(tema, pergunta);
      expect(r, tema).toMatchObject({ estado: 'rascunho' });
      expect(reservas, tema).toEqual([true, false]);
    }
  });
});
