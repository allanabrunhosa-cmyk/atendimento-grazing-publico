import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createServer, type Server } from 'node:http';
import { criarApiFicticia } from '../../scripts/atendimento/ficticio/api-ficticia';

/** Nenhum teste chama a Anthropic: o transporte devolve respostas fictícias. */
const CHAVE = 'chave-ficticia-sem-acesso';
type Corpo = { model: string; system?: string; thinking?: unknown; messages: { content: { text: string }[] }[] };
type Entrada = { perguntaNaoConfiavel: string; contextoRecenteNaoConfiavel: { autor: string; texto: string }[]; fontesNaoConfiaveisComoInstrucoes: { id: string; versao: number; conteudo: string }[]; perfilEstiloNaoAlteraPoliticas: string };
let servidor: Server | undefined;
afterEach(async () => { vi.unstubAllEnvs(); await new Promise<void>(r => servidor ? servidor.close(() => r()) : r()); servidor = undefined; });
async function ambiente(responder: (e: Entrada, corpo: Corpo) => Response | Promise<Response>, tetoUsd = 1, comIa = true) {
  vi.stubEnv('ATENDIMENTO_IA_HABILITADA', 'true');
  const pedidos: { url: string; corpo: Corpo; cabecalhos: Record<string, string> }[] = [];
  const transporte: typeof fetch = async (url, o) => { const corpo = JSON.parse(String(o?.body)) as Corpo; pedidos.push({ url: String(url), corpo, cabecalhos: o?.headers as Record<string, string> }); return responder(JSON.parse(corpo.messages[0].content[0].text) as Entrada, corpo); };
  const api = await criarApiFicticia(comIa ? { ia: { chave: CHAVE, tetoUsd, transporte } } : {});
  servidor = createServer((req, res) => { void api.atender(req, res); });
  await new Promise<void>(r => servidor!.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(servidor.address() as { port: number }).port}/api/atendimento/operacao`, comum = { Accept: 'application/json', 'X-Atendimento-Ambiente': 'ensaio' };
  const { csrf } = await (await fetch(base + '/sessao', { headers: comum })).json() as { csrf: string };
  const falar = async (texto: string, conversaId = 'conversa-um-0001', modelo = 'claude-sonnet-4-5-20250929') => { const r = await fetch(base + '/ficticio/conversa', { method: 'POST', headers: { ...comum, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify({ conversaId, texto, modelo }) }); return { status: r.status, corpo: await r.json() as Record<string, unknown> }; };
  const estado = async () => (await fetch(base + '/ficticio/conversa', { headers: comum })).json() as Promise<Record<string, unknown>>;
  const salvarPrompt = async (texto: string) => { const lido = await (await fetch(base + '/agente/prompt', { headers: comum })).json() as { versao: number }; const r = await fetch(base + '/agente/prompt/configurar', { method: 'POST', headers: { ...comum, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify({ texto, versao: lido.versao, idempotencia: crypto.randomUUID() }) }); return { status: r.status, corpo: await r.json() as Record<string, unknown> }; };
  return { falar, estado, pedidos, salvarPrompt };
}
const resposta = (selecoes: { id: string; versao: number }[], texto: string, extra: unknown[] = []) => Response.json({ id: 'msg_ficticia', model: 'modelo', stop_reason: 'end_turn', content: [...extra, { type: 'text', text: JSON.stringify({ selecoes, pedirApoio: false, texto }) }], usage: { input_tokens: 5000, output_tokens: 100 } });

describe('conversa de teste com IA real (transporte fictício)', () => {
  it('sem chave fica desligada e não chama rede', async () => {
    const a = await ambiente(() => { throw Error('REDE_PROIBIDA'); }, 1, false);
    expect(await a.estado()).toMatchObject({ ligada: false });
    expect(await a.falar('Oi')).toMatchObject({ status: 400, corpo: { erro: 'FICTICIO_IA_DESLIGADA' } });
    expect(a.pedidos).toHaveLength(0);
  });

  it('responde com o produto, inclui o link esquecido e guarda a conversa', async () => {
    const a = await ambiente(e => { const p = e.fontesNaoConfiaveisComoInstrucoes[0]; return resposta([{ id: p.id, versao: p.versao }], e.perguntaNaoConfiavel.includes('10') ? 'Para 10 pessoas, sugiro a Mesa Exemplo para 10.' : 'Que delícia! Qual é a ocasião?'); });
    expect((await a.falar('Quero uma tábua')).corpo).toMatchObject({ estado: 'respondeu', texto: 'Que delícia! Qual é a ocasião?' });
    const r = await a.falar('É para um aniversário, somos 10');
    expect(r.corpo).toMatchObject({ estado: 'respondeu', tema: 'produto', texto: expect.stringContaining('https://loja-exemplo.invalid/produto/mesa-exemplo-10'), fontes: [{ titulo: 'Mesa Exemplo para 10' }] });
    expect(a.pedidos[0].url).toBe('https://api.anthropic.com/v1/messages');
    const e = JSON.parse(a.pedidos[1].corpo.messages[0].content[0].text) as Entrada;
    expect(e.contextoRecenteNaoConfiavel.map(m => m.autor)).toEqual(['cliente', 'ia', 'cliente']);
    expect(e.perfilEstiloNaoAlteraPoliticas).toContain('Consultora de vendas');
    expect(a.pedidos[0].corpo.thinking).toBeUndefined();
  });

  it('corporativo, dificuldade no site e dados do orçamento chamam a equipe sem gastar', async () => {
    const a = await ambiente(e => { const p = e.fontesNaoConfiaveisComoInstrucoes[0]; return resposta([{ id: p.id, versao: p.versao }], 'Claro!'); });
    expect((await a.falar('Evento da empresa para 80 pessoas', 'conversa-corp-01')).corpo).toMatchObject({ estado: 'equipe', motivo: 'PEDIDO_CORPORATIVO', custoUsd: 0 });
    expect((await a.falar('São 80 pessoas, dia 10', 'conversa-corp-01')).corpo).toMatchObject({ estado: 'equipe', motivo: 'PEDIDO_CORPORATIVO' });
    expect((await a.falar('Não consigo finalizar no site', 'conversa-site-01')).corpo).toMatchObject({ estado: 'equipe', motivo: 'DIFICULDADE_NO_SITE' });
    expect(a.pedidos).toHaveLength(0);
    await a.falar('Quero um orçamento', 'conversa-orca-01'); expect(a.pedidos).toHaveLength(1);
    expect((await a.falar('Ana Exemplo, tábua para 10, Moema', 'conversa-orca-01')).corpo).toMatchObject({ estado: 'equipe', motivo: 'ORCAMENTO' });
    expect(a.pedidos).toHaveLength(1);
  });

  it('barra resposta com preço fora das fontes, como na operação', async () => {
    const a = await ambiente(e => { const p = e.fontesNaoConfiaveisComoInstrucoes[0]; return resposta([{ id: p.id, versao: p.versao }], 'Sai por R$ 12,34.'); });
    expect((await a.falar('Quero uma tábua para 4 pessoas')).corpo).toMatchObject({ estado: 'equipe', motivo: 'RESPOSTA_REDIGIDA_SEM_FUNDAMENTO' });
  });

  it('modelos novos recebem o raciocínio desligado; o preço acompanha o modelo', async () => {
    const a = await ambiente(e => { const p = e.fontesNaoConfiaveisComoInstrucoes[0]; return resposta([{ id: p.id, versao: p.versao }], 'Temos a Tábua Exemplo para 4.'); });
    const s = (await a.falar('Tábua para 4 pessoas', 'conversa-mod-001', 'claude-sonnet-5-5')).corpo, h = (await a.falar('Tábua para 4 pessoas', 'conversa-mod-002', 'claude-haiku-5-5')).corpo;
    expect(a.pedidos.map(p => p.corpo.thinking)).toEqual([{ type: 'between_tools' }, { type: 'disabled' }]);
    expect(s.custoUsd).toBeCloseTo((5000 * 2 + 100 * 10) / 1e6); expect(h.custoUsd).toBeCloseTo((5000 * 0.1 + 100 * 0.5) / 1e6);
    expect(h.gastoUsd).toBeCloseTo((s.custoUsd as number) + (h.custoUsd as number));
    expect((await a.falar('Oi', 'conversa-mod-003', 'gpt-qualquer')).status).toBe(400);
  });

  it('o prompt central salvo no painel entra nas instruções da chamada', async () => {
    const a = await ambiente(e => { const p = e.fontesNaoConfiaveisComoInstrucoes[0]; return resposta([{ id: p.id, versao: p.versao }], 'Que delícia! Qual é a ocasião?'); });
    await a.falar('Quero uma tábua');
    expect(a.pedidos[0].corpo.system).not.toContain('<prompt_central>');
    expect(await a.salvarPrompt('Você é a Donatella da loja de exemplo. Oriente o pedido pelo site.')).toMatchObject({ status: 200, corpo: { versao: 1 } });
    await a.falar('Quero uma tábua', 'conversa-dois-0002');
    expect(a.pedidos[1].corpo.system).toContain('<prompt_central>\nVocê é a Donatella da loja de exemplo. Oriente o pedido pelo site.\n</prompt_central>');
    expect((await a.salvarPrompt('Ligue (11) 91234-5678')).status).toBeGreaterThanOrEqual(400);
  });

  it('teto de gasto para antes da chamada', async () => {
    const a = await ambiente(() => { throw Error('REDE_PROIBIDA'); }, 0.01);
    expect(await a.falar('Quero uma tábua para 4 pessoas')).toMatchObject({ status: 400, corpo: { erro: 'FICTICIO_TETO_IA' } });
    expect(a.pedidos).toHaveLength(0);
  });

  it('erro da Anthropic vira explicação, sem expor a chave', async () => {
    const casos: [number, RegExp][] = [[401, /recusou a chave/], [404, /não está disponível/], [400, /Billing/], [529, /instável/]];
    for (const [status, texto] of casos) {
      const a = await ambiente(() => Response.json({ type: 'error', error: { type: 'invalid_request_error', message: `detalhe ${CHAVE}` } }, { status }));
      const r = (await a.falar('Quero uma tábua para 4 pessoas')).corpo;
      expect(r, String(status)).toMatchObject({ estado: 'falha', texto: expect.stringMatching(texto) });
      expect(a.pedidos[0].cabecalhos['x-api-key']).toBe(CHAVE);
      expect(JSON.stringify([r, await a.estado()])).not.toContain(CHAVE);
      await new Promise<void>(f => servidor!.close(() => f())); servidor = undefined;
    }
  });
});
